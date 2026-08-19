import {
  allowPostOnly,
  enforceRateLimit,
  getClientIp,
  logger,
  requireJson,
  setPrivateApiResponse,
  supabaseAdmin,
} from '../../../platform/api/publicSecurity'
import {
  VISITOR_UNAVAILABLE_MESSAGE,
  VISITOR_UUID_PATTERN,
  isVisitorKind,
  normalizeVisitorIdentityBody,
  visitorIdentityExists,
  visitorIdentityRateLimitKey,
} from '../../../products/hostels/public/visitor'

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }

async function processIdentityCheck(req, res) {
  setPrivateApiResponse(res)
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Verification service is unavailable' })

  const ip = getClientIp(req)
  if (!await enforceRateLimit(req, res, {
    scope: 'visitor-identity-check-ip',
    identifier: ip,
    limit: 40,
    windowSeconds: 600,
  })) return

  const identity = normalizeVisitorIdentityBody(req.body || {})
  const { propertyId, phone, email, kind } = identity

  if (!VISITOR_UUID_PATTERN.test(String(propertyId || '')) || !isVisitorKind(kind)) {
    return res.status(400).json({ error: 'Invalid verification request' })
  }
  if (!phone && !email) return res.status(400).json({ error: 'Enter a phone number or email address' })
  if (phone && !/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' })
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' })

  const identityKey = visitorIdentityRateLimitKey(identity)
  if (!await enforceRateLimit(req, res, {
    scope: 'visitor-identity-check-value',
    identifier: identityKey,
    limit: 8,
    windowSeconds: 3600,
  })) return

  const { data: isVisible, error: visibilityError } = await supabaseAdmin.rpc('is_public_property_visible', {
    p_property_id: propertyId,
  })
  if (visibilityError) throw visibilityError
  if (!isVisible) return res.status(404).json({ error: 'This property is currently unavailable' })

  const exists = await visitorIdentityExists(supabaseAdmin, { propertyId, phone, email })
  return res.status(200).json(exists
    ? { available: false, message: VISITOR_UNAVAILABLE_MESSAGE }
    : { available: true })
}

export default async function handler(req, res) {
  try {
    return await processIdentityCheck(req, res)
  } catch (error) {
    logger.error('Visitor identity precheck failed', error, { route: '/api/visitor/check-identity' })
    if (res.headersSent) return res.end()
    setPrivateApiResponse(res)
    return res.status(500).json({ error: 'Could not verify these details. Please try again.' })
  }
}
