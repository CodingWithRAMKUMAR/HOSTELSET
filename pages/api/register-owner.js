import { supabaseAdmin } from '../../lib/server/supabaseAdmin'
import { cleanPhoneNumber } from '../../lib/utils'
import { allowPostOnly, enforceRateLimit, getClientIp, requireJson, setPrivateApiResponse } from '../../lib/server/publicApiSecurity'
import { logger } from '../../lib/logger'
import { attachRequestContext } from '../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../lib/server/requestTelemetry'

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/
const PROPERTY_TYPES = new Set(['boys', 'girls', 'co-ed'])

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)

  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/register-owner',
    requestId,
    reportServerErrors: false,
  })

  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Registration service unavailable' })
  const ip = getClientIp(req)
  if (!await enforceRateLimit(req, res, { scope: 'owner-registration-ip', identifier: ip, limit: 5, windowSeconds: 3600 })) return

  const {
    email,
    password,
    phone,
    full_name,
    property_name,
    description,
    address,
    city,
    pincode,
    property_type,
    amenities,
    photos,
    location,
  } = req.body

  const cleanEmail = text(email, 254).toLowerCase()
  const cleanName = text(full_name, 120)
  const cleanPropertyName = text(property_name, 160)
  const cleanDescription = text(description, 4000)
  const cleanAddress = text(address, 500)
  const cleanCity = text(city, 120)
  const cleanPincode = text(pincode, 12)
  const cleanPropertyType = PROPERTY_TYPES.has(property_type) ? property_type : 'boys'
  if (!EMAIL_PATTERN.test(cleanEmail) || !cleanName || !cleanPropertyName || !cleanAddress || !cleanCity || typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
    return res.status(400).json({ error: 'Please provide valid registration details' })
  }
  if (!Array.isArray(amenities) || amenities.length > 30 || amenities.some(item => typeof item !== 'string' || item.length > 80)) return res.status(400).json({ error: 'Invalid amenities' })
  if (!Array.isArray(photos) || photos.length > 20 || photos.some(item => { try { return new URL(item).protocol !== 'https:' } catch { return true } })) return res.status(400).json({ error: 'Invalid property photos' })
  if (!await enforceRateLimit(req, res, { scope: 'owner-registration-email', identifier: cleanEmail, limit: 3, windowSeconds: 86400 })) return
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'A valid property map location is required' })
  }

  const cleanPhone = cleanPhoneNumber(phone)
  if (cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Invalid phone number' })
  }

  try {
    // 1. Create Auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: cleanName, role: 'owner' },
    })

    if (authError) {
      logger.error('Owner registration auth creation failed', authError, {
        route: '/api/register-owner',
        requestId,
      })
      const duplicate = /already|registered|exists/i.test(authError.message || '')
      return res.status(duplicate ? 409 : 400).json({ error: duplicate ? 'An account already exists for these details' : 'Unable to create this account' })
    }

    const userId = authData.user.id

    // 2. Call the DB function
    const { data, error: dbError } = await supabaseAdmin.rpc('register_owner_and_property', {
      p_user_id: userId,
      p_phone: cleanPhone,
      p_email: cleanEmail,
      p_full_name: cleanName,
      p_property_name: cleanPropertyName,
      p_description: cleanDescription,
      p_address: cleanAddress,
      p_city: cleanCity,
      p_pincode: cleanPincode,
      p_property_type: cleanPropertyType,
      p_amenities: amenities || [],
      p_photos: photos || [],
    })

    // 3. Check the function result
    if (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      logger.error('Owner registration database function failed', dbError, {
        route: '/api/register-owner',
        requestId,
      })
      return res.status(500).json({ error: 'Registration could not be completed' })
    }

    if (!data || !data.success) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      logger.error(
        'Owner registration function returned failure',
        new Error(data?.error || 'Registration function failed'),
        {
          route: '/api/register-owner',
          requestId,
        }
      )
      return res.status(400).json({ error: data?.error || 'Registration failed' })
    }

    const { error: locationError } = await supabaseAdmin.from('properties').update({
      latitude,
      longitude,
      formatted_address: text(location.formatted_address || cleanAddress, 500),
      location_place_id: text(location.location_place_id, 200) || null,
      location_verified: false,
    }).eq('id', data.property_id).eq('owner_id', userId)
    if (locationError) {
      logger.error('Property location update failed', locationError, {
        route: '/api/register-owner',
        requestId,
      })
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return res.status(500).json({ error: 'Registration could not be completed' })
    }

    // Success
    return res.status(201).json({
      success: true,
      message: 'Registration successful! Please login.',
      userId: userId,
      propertyId: data.property_id
    })
  } catch (error) {
    logger.error('Owner registration failed', error, {
      route: '/api/register-owner',
      requestId,
    })
    return res.status(500).json({
      error: 'Registration failed. Please try again.'
    })
  }
}
