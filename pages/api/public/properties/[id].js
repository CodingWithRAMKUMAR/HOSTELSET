import { createClient } from '@supabase/supabase-js'
import { logger } from '../../../../lib/logger'
import { attachRequestContext } from '../../../../lib/server/requestContext'

const CACHE_TTL_MS = 15 * 1000
const STALE_MAX_AGE_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 250

const propertyCache = new Map()
const inFlightRequests = new Map()

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function normalizeIdentifier(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim()
  }

  return String(value || '').trim()
}

function pruneCache() {
  if (propertyCache.size <= MAX_CACHE_ENTRIES) {
    return
  }

  const entries = [...propertyCache.entries()]
    .sort((a, b) => a[1].cachedAt - b[1].cachedAt)

  const deleteCount = propertyCache.size - MAX_CACHE_ENTRIES

  for (let index = 0; index < deleteCount; index += 1) {
    propertyCache.delete(entries[index][0])
  }
}

function isMissingPublicRoomsRpc(error) {
  return (
    error?.code === 'PGRST202' ||
    /get_public_property_rooms/i.test(String(error?.message || ''))
  )
}

async function fetchPublicRooms(supabase, propertyId) {
  const rpcResult = await supabase.rpc('get_public_property_rooms', {
    p_property_id: propertyId,
  })

  if (!rpcResult.error) {
    return Array.isArray(rpcResult.data) ? rpcResult.data : []
  }

  if (!isMissingPublicRoomsRpc(rpcResult.error)) {
    throw rpcResult.error
  }

  const fallbackResult = await supabase
    .from('rooms')
    .select(
      [
        'id',
        'property_id',
        'room_number',
        'sharing_type',
        'monthly_rent',
        'capacity',
        'current_occupants',
        'status',
        'created_at',
        'updated_at',
        'room_audience',
        'deposit_amount',
        'next_vacate_date',
      ].join(',')
    )
    .eq('property_id', propertyId)
    .in('status', ['vacant', 'occupied'])
    .gt('capacity', 0)
    .order('room_number')

  if (fallbackResult.error) {
    throw fallbackResult.error
  }

  return (fallbackResult.data || []).map(room => ({
    ...room,
    has_approved_prebooking: false,
    reserved_prebooking_count: 0,
  }))
}

async function fetchSimilarProperties(supabase, property, requestId) {
  if (!property?.city) {
    return []
  }

  try {
    const { data, error } = await supabase.rpc('get_public_properties_v2')

    if (error) {
      throw error
    }

    return (Array.isArray(data) ? data : [])
      .filter(item => {
        return (
          item?.id !== property.id &&
          String(item?.city || '').toLowerCase() ===
            String(property.city || '').toLowerCase()
        )
      })
      .slice(0, 4)
  } catch (error) {
    logger.warn('Similar public properties lookup failed', {
      route: '/api/public/properties/[id]',
      requestId,
      propertyId: property?.id,
      message: error?.message,
    })
    return []
  }
}

async function fetchFreshPropertyDetails(identifier, requestId) {
  const supabase = getSupabaseClient()

  const propertyResult = await supabase
    .rpc('get_public_property_by_identifier', {
      p_identifier: identifier,
    })
    .maybeSingle()

  if (propertyResult.error) {
    throw propertyResult.error
  }

  if (!propertyResult.data) {
    const notFoundError = new Error(
      'This property is currently unavailable for public applications.'
    )
    notFoundError.statusCode = 404
    throw notFoundError
  }

  const property = propertyResult.data

  const [roomsResult, settingsResult, similarProperties] =
    await Promise.all([
      fetchPublicRooms(supabase, property.id),
      supabase
        .from('owner_settings')
        .select(
          [
            'upi_id',
            'upi_phone',
            'advance_months',
            'joining_fee',
            'pre_booking_fee',
            'application_deposit',
          ].join(',')
        )
        .eq('property_id', property.id)
        .maybeSingle(),
      fetchSimilarProperties(supabase, property, requestId),
    ])

  if (settingsResult.error) {
    logger.warn('Public property payment settings lookup failed', {
      route: '/api/public/properties/[id]',
      requestId,
      propertyId: property.id,
      message: settingsResult.error?.message,
    })
  }

  const response = {
    property,
    rooms: roomsResult,
    settings: settingsResult.error ? null : settingsResult.data,
    similarProperties,
  }

  const cachedAt = Date.now()

  propertyCache.set(identifier, {
    data: response,
    cachedAt,
  })

  if (property.id && property.id !== identifier) {
    propertyCache.set(property.id, {
      data: response,
      cachedAt,
    })
  }

  if (property.slug && property.slug !== identifier) {
    propertyCache.set(property.slug, {
      data: response,
      cachedAt,
    })
  }

  pruneCache()

  return response
}

async function getPropertyDetails(identifier, requestId) {
  const cachedEntry = propertyCache.get(identifier)
  const now = Date.now()

  if (
    cachedEntry &&
    now - cachedEntry.cachedAt < CACHE_TTL_MS
  ) {
    return {
      data: cachedEntry.data,
      cacheStatus: 'HIT',
      stale: false,
    }
  }

  if (!inFlightRequests.has(identifier)) {
    const request = fetchFreshPropertyDetails(identifier, requestId)
      .finally(() => {
        inFlightRequests.delete(identifier)
      })

    inFlightRequests.set(identifier, request)
  }

  try {
    const data = await inFlightRequests.get(identifier)

    return {
      data,
      cacheStatus: 'MISS',
      stale: false,
    }
  } catch (error) {
    const staleEntry = propertyCache.get(identifier)

    if (
      staleEntry &&
      Date.now() - staleEntry.cachedAt < STALE_MAX_AGE_MS
    ) {
      return {
        data: staleEntry.data,
        cacheStatus: 'STALE',
        stale: true,
      }
    }

    throw error
  }
}

export default async function handler(req, res) {
  const requestId = attachRequestContext(req, res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')

    return res.status(405).json({
      error: 'Method not allowed',
    })
  }

  const identifier = normalizeIdentifier(req.query.id)

  if (!identifier || identifier.length > 200) {
    res.setHeader('Cache-Control', 'no-store')

    return res.status(400).json({
      error: 'A valid property identifier is required.',
    })
  }

  try {
    const result = await getPropertyDetails(identifier, requestId)

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=15, stale-while-revalidate=60'
    )
    res.setHeader('X-HostelSet-Cache', result.cacheStatus)
    res.setHeader(
      'X-HostelSet-Stale',
      result.stale ? 'true' : 'false'
    )
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    return res.status(200).json(result.data)
  } catch (error) {
    logger.error('Public property details request failed', error, {
      route: '/api/public/properties/[id]',
      requestId,
      identifier,
      statusCode: error?.statusCode,
    })

    res.setHeader('Cache-Control', 'no-store')

    if (error?.statusCode === 404) {
      return res.status(404).json({
        error:
          'This property is currently unavailable for public applications.',
      })
    }

    return res.status(503).json({
      error:
        'Property details are temporarily unavailable. Please try again.',
    })
  }
}
