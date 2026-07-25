import crypto from 'crypto'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { safeTenantProfilePhotoPath } from '../../../lib/profilePhoto'

const COOKIE_NAME = 'hostelset_access_token'
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  const match = cookies.map(item => item.trim()).find(item => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

async function requireTenant(req) {
  const token = readCookie(req, COOKIE_NAME) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token || token.length > 8192) {
    const error = new Error('Authentication required'); error.statusCode = 401; throw error
  }
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !auth?.user) {
    const error = new Error('Authentication required'); error.statusCode = 401; throw error
  }
  const { data: profile, error: profileError } = await supabaseAdmin.from('users').select('role,is_active').eq('id', auth.user.id).single()
  if (profileError || profile?.role !== 'tenant' || !profile?.is_active) {
    const error = new Error('Not authorized'); error.statusCode = 403; throw error
  }
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id,user_id,property_id,status')
    .eq('user_id', auth.user.id)
    .in('status', ['active', 'notice_period', 'payment_pending'])
    .maybeSingle()
  if (tenantError) throw tenantError
  if (!tenant) {
    const error = new Error('Tenant not found'); error.statusCode = 404; throw error
  }
  return { token, tenant }
}

async function verifyUploadedProfilePhoto(path) {
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash)
  const name = path.slice(slash + 1)
  const { data, error } = await supabaseAdmin.storage.from('tenant-documents').list(folder, { search: name, limit: 2 })
  const object = data?.find(item => item.name === name)
  const mime = object?.metadata?.mimetype || object?.metadata?.contentType
  if (error || !object || !TYPES[mime] || Number(object.metadata?.size || 0) < 1 || Number(object.metadata?.size || 0) > 5 * 1024 * 1024) {
    throw new Error('Profile photo upload was not completed')
  }
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/tenant/profile-photo',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Profile photo service is unavailable' })

  try {
    const { action, contentType, size, path } = req.body || {}
    const { tenant } = await requireTenant(req)
    if (action === 'upload-url') {
      if (!TYPES[contentType] || !Number.isSafeInteger(Number(size)) || Number(size) < 1 || Number(size) > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Profile photo must be a JPEG, PNG, or WEBP image under 5MB' })
      }
      const objectPath = `${tenant.property_id}/profile-photos/${tenant.id}/${crypto.randomUUID()}.${TYPES[contentType]}`
      const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUploadUrl(objectPath)
      if (error) throw error
      return res.status(200).json({ path: objectPath, token: data.token })
    }
    if (action === 'update') {
      const objectPath = String(path || '')
      if (!safeTenantProfilePhotoPath(objectPath, tenant.property_id, tenant.id)) {
        return res.status(400).json({ error: 'Invalid profile photo path' })
      }
      await verifyUploadedProfilePhoto(objectPath)
      const { data, error } = await supabaseAdmin.from('tenants').update({ profile_photo_path: objectPath }).eq('id', tenant.id).select('id,profile_photo_path,updated_at').single()
      if (error) throw error
      return res.status(200).json({ success: true, tenant: data || null })
    }
    return res.status(400).json({ error: 'Invalid profile photo action' })
  } catch (error) {
    logger.error('Tenant profile photo update failed', error, { route: '/api/tenant/profile-photo', requestId })
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to update profile photo. Please try again.' })
  }
}
