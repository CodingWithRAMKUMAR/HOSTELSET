import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { safeLegacyProfilePhotoPath, safeTenantProfilePhotoPath } from '../../../lib/profilePhoto'

const COOKIE_NAME = 'hostelset_access_token'
const TENANT_STATUSES = ['active', 'notice_period', 'payment_pending']
const REQUEST_STATUSES = ['approved', 'pending']

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  const match = cookies.map(item => item.trim()).find(item => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

function firstPresent(record, fields) {
  for (const field of fields) {
    if (record?.[field]) return record[field]
  }
  return ''
}

function safePhotoPath(source, propertyId) {
  if (!source?.path || !propertyId) return ''
  const path = String(source.path)
  if (!path || path.startsWith('/') || path.includes('..')) return ''
  if (source.type === 'tenant_profile') {
    return safeTenantProfilePhotoPath(path, propertyId) || ''
  }
  if (source.type === 'existing_tenant_import') {
    return safeLegacyProfilePhotoPath(path, propertyId, 'existing_tenant_import') || ''
  }
  return safeLegacyProfilePhotoPath(path, propertyId, source.type) || ''
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/tenant/profile-photo-url',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return

  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Document service is unavailable' })

    const token = readCookie(req, COOKIE_NAME) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token || token.length > 8192) return res.status(401).json({ error: 'Authentication required' })

    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ error: 'Authentication required' })

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('role,is_active')
      .eq('id', auth.user.id)
      .single()
    if (profileError || profile?.role !== 'tenant' || !profile?.is_active) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id,user_id,property_id,phone,email,status,profile_photo_path')
      .eq('user_id', auth.user.id)
      .in('status', TENANT_STATUSES)
      .maybeSingle()
    if (tenantError) throw tenantError
    if (!tenant) return res.status(404).json({ error: 'Profile photo not found' })

    const [importResult, applicationResult, preBookingResult] = await Promise.all([
      supabaseAdmin
        .from('existing_tenant_imports')
        .select('id,property_id,tenant_id,user_id,status,profile_photo,processed_at')
        .eq('property_id', tenant.property_id)
        .eq('tenant_id', tenant.id)
        .eq('status', 'approved')
        .order('processed_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('applications')
        .select('id,property_id,user_id,status,photo,created_at')
        .eq('property_id', tenant.property_id)
        .eq('user_id', auth.user.id)
        .in('status', REQUEST_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('pre_bookings')
        .select('id,property_id,user_id,status,photo,created_at')
        .eq('property_id', tenant.property_id)
        .eq('user_id', auth.user.id)
        .in('status', REQUEST_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    if (importResult.error) throw importResult.error
    if (applicationResult.error) throw applicationResult.error
    if (preBookingResult.error) throw preBookingResult.error

    const imported = importResult.data?.[0]
    const application = applicationResult.data?.[0]
    const preBooking = preBookingResult.data?.[0]
    const candidates = [
      tenant.profile_photo_path && { type: 'tenant_profile', createdAt: new Date(), path: tenant.profile_photo_path },
      imported && { type: 'existing_tenant_import', createdAt: imported.processed_at, path: firstPresent(imported, ['profile_photo']) },
      application && { type: 'application', createdAt: application.created_at, path: application.photo },
      preBooking && { type: 'pre_booking', createdAt: preBooking.created_at, path: preBooking.photo },
    ].filter(Boolean).sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))

    const selected = candidates.find(candidate => safePhotoPath(candidate, tenant.property_id))
    const objectPath = safePhotoPath(selected, tenant.property_id)
    if (!objectPath) return res.status(404).json({ error: 'Profile photo not found' })

    const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUrl(objectPath, 300)
    if (error || !data?.signedUrl) throw error || new Error('Signed URL was not returned')
    return res.status(200).json({ signedUrl: data.signedUrl })
  } catch (error) {
    logger.error('Tenant profile photo signing failed', error, { route: '/api/tenant/profile-photo-url', requestId })
    return res.status(500).json({ error: 'Unable to open profile photo. Please try again.' })
  }
}
