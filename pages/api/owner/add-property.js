import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { cleanPhoneNumber } from '../../../lib/utils'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } }

const PROPERTY_TYPES = new Set(['boys', 'girls', 'co-ed', 'professionals'])
const SHARING_TYPES = new Set(['single', 'double', 'triple', 'four', 'five', 'custom'])

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeError(error) {
  const message = String(error?.message || '')
  if (/room number/i.test(message)) return message
  if (/capacity/i.test(message)) return message
  if (/rent/i.test(message)) return message
  if (/active owner/i.test(message)) return 'Active owner access required'
  if (/duplicated|unique/i.test(message)) return 'A room number is duplicated for this property.'
  return 'Property could not be added. Please check the details and try again.'
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/owner/add-property',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Property service is unavailable' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' })

  const cleanName = text(req.body?.property_name, 160)
  const cleanDescription = text(req.body?.description, 4000)
  const cleanAddress = text(req.body?.address, 500)
  const cleanCity = text(req.body?.city, 120)
  const cleanLocality = text(req.body?.locality, 160)
  const cleanPincode = text(req.body?.pincode, 12)
  const cleanPropertyType = PROPERTY_TYPES.has(req.body?.property_type) ? req.body.property_type : 'boys'
  const contactNumber = cleanPhoneNumber(req.body?.contact_number || '')
  const ownerUpiId = text(req.body?.owner_upi_id, 120)
  const amenities = Array.isArray(req.body?.amenities) ? req.body.amenities.map(item => text(item, 80)).filter(Boolean).slice(0, 30) : []
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 20) : []
  const latitude = Number(req.body?.location?.latitude)
  const longitude = Number(req.body?.location?.longitude)
  const formattedAddress = text(req.body?.location?.formatted_address || cleanAddress, 500)
  const locationPlaceId = text(req.body?.location?.location_place_id, 200)
  const rooms = Array.isArray(req.body?.rooms) ? req.body.rooms.slice(0, 200).map(room => ({
    room_number: text(room?.room_number, 40),
    sharing_type: SHARING_TYPES.has(room?.sharing_type) ? room.sharing_type : 'custom',
    capacity: Number(room?.capacity),
    monthly_rent: Number(room?.monthly_rent),
  })) : []

  if (!cleanName || !cleanAddress || !cleanCity) return res.status(400).json({ error: 'Please enter property name, address, and city.' })
  if (contactNumber && contactNumber.length !== 10) return res.status(400).json({ error: 'Please enter a valid 10-digit contact phone number.' })
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Please select the exact property location on the map.' })
  }
  if (!photos.every(item => { try { return new URL(item).protocol === 'https:' } catch { return false } })) return res.status(400).json({ error: 'Invalid property photo URL.' })
  if (!rooms.length) return res.status(400).json({ error: 'Please add at least one room.' })
  if (rooms.some(room => !room.room_number || !Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 50 || !Number.isFinite(room.monthly_rent) || room.monthly_rent < 0)) {
    return res.status(400).json({ error: 'Please enter valid room number, capacity, and rent for every room.' })
  }
  const roomNumbers = rooms.map(room => room.room_number.toLowerCase())
  if (new Set(roomNumbers).size !== roomNumbers.length) return res.status(400).json({ error: 'Room numbers must be unique for this property.' })

  try {
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active')
      .eq('id', auth.user.id)
      .single()
    if (ownerError || owner?.role !== 'owner' || !owner.is_active) return res.status(403).json({ error: 'Active owner access required' })

    const { data, error } = await supabaseAdmin.rpc('add_property_for_existing_owner', {
      p_owner_id: owner.id,
      p_property_name: cleanName,
      p_description: cleanDescription,
      p_address: cleanAddress,
      p_city: cleanCity,
      p_locality: cleanLocality,
      p_pincode: cleanPincode,
      p_property_type: cleanPropertyType,
      p_contact_number: contactNumber || null,
      p_owner_upi_id: ownerUpiId || null,
      p_amenities: amenities,
      p_photos: photos,
      p_latitude: latitude,
      p_longitude: longitude,
      p_formatted_address: formattedAddress,
      p_location_place_id: locationPlaceId || null,
      p_rooms: rooms,
    })
    if (error) throw error
    if (!data?.success) return res.status(400).json({ error: data?.error || 'Property could not be added.' })
    return res.status(201).json({ success: true, propertyId: data.property_id })
  } catch (error) {
    logger.error('Existing owner add property failed', error, { route: '/api/owner/add-property', requestId })
    return res.status(400).json({ error: safeError(error) })
  }
}
