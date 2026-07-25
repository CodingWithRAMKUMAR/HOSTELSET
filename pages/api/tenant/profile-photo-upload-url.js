import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { buildProfilePhotoPath, validateProfilePhotoUpload } from '../../../lib/profilePhoto'

const COOKIE_NAME = 'hostelset_access_token'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  const match = cookies.map(item => item.trim()).find(item => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/tenant/profile-photo-upload-url',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Upload service is unavailable' })

  try {
    const token = readCookie(req, COOKIE_NAME) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token || token.length > 8192) return res.status(401).json({ error: 'Authentication required' })
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ error: 'Authentication required' })
    const { data: profile, error: profileError } = await supabaseAdmin.from('users').select('role,is_active').eq('id', auth.user.id).single()
    if (profileError || profile?.role !== 'tenant' || !profile?.is_active) return res.status(403).json({ error: 'Not authorized' })

    const validation = validateProfilePhotoUpload(req.body || {})
    if (!validation.ok) return res.status(400).json({ error: validation.error })
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id,property_id')
      .eq('user_id', auth.user.id)
      .in('status', ['active', 'notice_period', 'payment_pending'])
      .maybeSingle()
    if (tenantError) throw tenantError
    if (!tenant) return res.status(404).json({ error: 'Active tenant profile not found' })
    const path = buildProfilePhotoPath(tenant.property_id, tenant.id, req.body.contentType)
    const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUploadUrl(path)
    if (error || !data?.token) throw error || new Error('Signed upload URL was not returned')
    return res.status(200).json({ path, token: data.token })
  } catch (error) {
    logger.error('Tenant profile photo upload preparation failed', error, { route: '/api/tenant/profile-photo-upload-url', requestId })
    return res.status(500).json({ error: 'Unable to prepare profile photo upload. Please try again.' })
  }
}
