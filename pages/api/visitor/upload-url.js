import crypto from 'crypto'
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
  VISITOR_UUID_PATTERN,
  buildVisitorUploadPath,
  isVisitorUploadCategory,
  isVisitorUploadSizeAllowed,
  visitorUploadExtension,
} from '../../../products/hostels/public/visitor'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

async function processUploadRequest(req, res) {
  setPrivateApiResponse(res)
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) {
    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Upload service unavailable'
      : 'Upload service unavailable: missing SUPABASE_SERVICE_ROLE_KEY'
    return res.status(503).json({ error: errorMessage })
  }

  const ip = getClientIp(req)
  if (!await enforceRateLimit(req, res, { scope: 'visitor-upload-ip', identifier: ip, limit: 12, windowSeconds: 900 })) return
  const { propertyId, category, contentType, size } = req.body || {}
  if (!VISITOR_UUID_PATTERN.test(String(propertyId || '')) || !isVisitorUploadCategory(category) || !visitorUploadExtension(contentType)) {
    return res.status(400).json({ error: 'Invalid upload request' })
  }
  if (!isVisitorUploadSizeAllowed(size)) {
    return res.status(400).json({ error: 'File must be under 5MB' })
  }
  if (category !== 'identity' && contentType === 'application/pdf') return res.status(400).json({ error: 'An image is required' })
  if (!await enforceRateLimit(req, res, { scope: 'visitor-upload-property', identifier: `${ip}:${propertyId}`, limit: 9, windowSeconds: 900 })) return

  const { data: isVisible, error: propertyError } = await supabaseAdmin.rpc('is_public_property_visible', { p_property_id: propertyId })
  if (propertyError) {
    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Upload service temporarily unavailable'
      : `Upload service temporarily unavailable: ${propertyError.message}`
    return res.status(503).json({ error: errorMessage })
  }
  if (!isVisible) return res.status(404).json({ error: 'This property is currently unavailable for applications.' })

  const path = buildVisitorUploadPath(propertyId, category, contentType, crypto.randomUUID())
  const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUploadUrl(path)
  if (error) {
    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Unable to prepare upload'
      : `Unable to prepare upload: ${error.message}`
    return res.status(502).json({ error: errorMessage })
  }
  return res.status(200).json({ path, token: data.token })
}

export default async function handler(req, res) {
  try {
    return await processUploadRequest(req, res)
  } catch (error) {
    logger.error('Visitor upload URL failure', error, { route: '/api/visitor/upload-url' })
    if (res.headersSent) return res.end()
    setPrivateApiResponse(res)
    return res.status(500).json({ error: 'Unable to prepare upload. Please try again.' })
  }
}
