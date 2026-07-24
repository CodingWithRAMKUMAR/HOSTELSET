import { createClient } from '@supabase/supabase-js'

const FRESH_CACHE_TTL_MS = 60 * 1000
const STALE_CACHE_MAX_AGE_MS = 30 * 60 * 1000
const UPSTREAM_TIMEOUT_MS = 5000

let cachedProperties = null
let cachedAt = 0
let inFlightRequest = null

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

function withTimeout(promise, timeoutMs) {
  let timeoutId

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Public properties request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

async function fetchFreshProperties() {
  const supabase = getSupabaseClient()

  const request = supabase.rpc('get_public_properties_v2')

  const { data, error } = await withTimeout(
    request,
    UPSTREAM_TIMEOUT_MS
  )

  if (error) {
    throw new Error(error.message || 'Failed to load public properties')
  }

  const properties = Array.isArray(data) ? data : []

  cachedProperties = properties
  cachedAt = Date.now()

  return properties
}

function startBackgroundRefresh() {
  if (inFlightRequest) {
    return inFlightRequest
  }

  inFlightRequest = fetchFreshProperties()
    .catch((error) => {
      console.error('[public-properties-background-refresh]', error)
      return null
    })
    .finally(() => {
      inFlightRequest = null
    })

  return inFlightRequest
}

async function getProperties() {
  const now = Date.now()
  const cacheAge = now - cachedAt
  const hasCachedData = Array.isArray(cachedProperties)

  if (hasCachedData && cacheAge < FRESH_CACHE_TTL_MS) {
    return {
      data: cachedProperties,
      cacheStatus: 'HIT',
      stale: false,
    }
  }

  /*
   * Stale-while-revalidate:
   * Return cached data immediately while refreshing in the background.
   * Visitors do not wait for Supabase during temporary network slowdowns.
   */
  if (hasCachedData && cacheAge < STALE_CACHE_MAX_AGE_MS) {
    startBackgroundRefresh()

    return {
      data: cachedProperties,
      cacheStatus: 'STALE',
      stale: true,
    }
  }

  /*
   * Cold start or cache older than the maximum stale age.
   * Only here do we wait for Supabase.
   */
  if (!inFlightRequest) {
    inFlightRequest = fetchFreshProperties().finally(() => {
      inFlightRequest = null
    })
  }

  const data = await inFlightRequest

  return {
    data,
    cacheStatus: 'MISS',
    stale: false,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')

    return res.status(405).json({
      error: 'Method not allowed',
    })
  }

  try {
    const result = await getProperties()

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300'
    )
    res.setHeader('X-HostelSet-Cache', result.cacheStatus)
    res.setHeader(
      'X-HostelSet-Stale',
      result.stale ? 'true' : 'false'
    )
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    return res.status(200).json(result.data)
  } catch (error) {
    console.error('[public-properties-api]', error)

    res.setHeader('Cache-Control', 'no-store')

    return res.status(503).json({
      error: 'Properties are temporarily unavailable. Please try again.',
    })
  }
}
