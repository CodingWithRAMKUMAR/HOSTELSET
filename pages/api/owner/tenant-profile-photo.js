import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { safeLegacyProfilePhotoPath, safeTenantProfilePhotoPath } from '../../../lib/profilePhoto'

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }

async function requireOwner(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) {
    const error = new Error('Authentication required'); error.statusCode = 401; throw error
  }
  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user) {
    const error = new Error('Authentication required'); error.statusCode = 401; throw error
  }
  const { data: user, error: userError } = await supabaseAdmin.from('users').select('id,role,is_active').eq('id', auth.user.id).single()
  if (userError || !user?.is_active || !['owner', 'admin'].includes(user.role)) {
    const error = new Error('Active owner access required'); error.statusCode = 403; throw error
  }
  return { caller, user }
}

async function loadOwnedTenants(user, tenantIds) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id,user_id,property_id,phone,email,status,profile_photo_path,properties(owner_id)')
    .in('id', tenantIds)
    .in('status', ['active', 'notice_period', 'payment_pending'])
  if (error) throw error
  return (data || []).filter(tenant => user.role === 'admin' || tenant.properties?.owner_id === user.id)
}

function safePath(path, tenant, source) {
  const value = String(path || '')
  if (source === 'tenant') return safeTenantProfilePhotoPath(value, tenant.property_id, tenant.id)
  if (source === 'import') return safeLegacyProfilePhotoPath(value, tenant.property_id, 'existing_tenant_import')
  return safeLegacyProfilePhotoPath(value, tenant.property_id, source)
}

async function signPath(path) {
  const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

async function loadFallbackPaths(tenants) {
  const byTenantId = new Map()
  const byUserId = new Map()
  tenants.forEach(tenant => {
    byTenantId.set(tenant.id, tenant)
    if (tenant.user_id) byUserId.set(tenant.user_id, tenant)
  })
  const tenantIds = [...byTenantId.keys()]
  const userIds = [...byUserId.keys()]
  const propertyIds = [...new Set(tenants.map(tenant => tenant.property_id))]
  const [imports, applications, preBookings] = await Promise.all([
    tenantIds.length ? supabaseAdmin.from('existing_tenant_imports').select('tenant_id,profile_photo,processed_at').in('tenant_id', tenantIds).eq('status', 'approved').order('processed_at', { ascending: false }) : Promise.resolve({ data: [] }),
    userIds.length ? supabaseAdmin.from('applications').select('user_id,property_id,photo,created_at').in('user_id', userIds).in('property_id', propertyIds).in('status', ['approved', 'pending']).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    userIds.length ? supabaseAdmin.from('pre_bookings').select('user_id,property_id,photo,created_at').in('user_id', userIds).in('property_id', propertyIds).in('status', ['approved', 'pending']).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ])
  if (imports.error) throw imports.error
  if (applications.error) throw applications.error
  if (preBookings.error) throw preBookings.error
  const fallback = new Map()
  ;(imports.data || []).forEach(record => {
    const tenant = byTenantId.get(record.tenant_id)
    if (tenant && !fallback.has(tenant.id)) fallback.set(tenant.id, safePath(record.profile_photo, tenant, 'import'))
  })
  ;[...(applications.data || []), ...(preBookings.data || [])].forEach(record => {
    const tenant = byUserId.get(record.user_id)
    if (tenant && tenant.property_id === record.property_id && !fallback.has(tenant.id)) fallback.set(tenant.id, safePath(record.photo, tenant, 'application'))
  })
  return fallback
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
    route: '/api/owner/tenant-profile-photo',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Profile photo service is unavailable' })

  try {
    const { action } = req.body || {}
    const { user } = await requireOwner(req)
    if (action === 'batch-sign') {
      const ids = Array.isArray(req.body?.tenantIds) ? [...new Set(req.body.tenantIds.map(String).filter(id => UUID.test(id)))].slice(0, 200) : []
      if (!ids.length) return res.status(200).json({ urls: {} })
      const tenants = await loadOwnedTenants(user, ids)
      const fallback = await loadFallbackPaths(tenants.filter(tenant => !safePath(tenant.profile_photo_path, tenant, 'tenant')))
      const entries = await Promise.all(tenants.map(async tenant => {
        const path = safePath(tenant.profile_photo_path, tenant, 'tenant') || fallback.get(tenant.id) || ''
        return [tenant.id, path ? await signPath(path) : null]
      }))
      return res.status(200).json({ urls: Object.fromEntries(entries) })
    }
    const tenantId = String(req.body?.tenantId || '')
    if (!UUID.test(tenantId)) return res.status(400).json({ error: 'Invalid tenant' })
    const [tenant] = await loadOwnedTenants(user, [tenantId])
    if (!tenant) return res.status(403).json({ error: 'Not authorized' })
    if (action === 'upload-url') {
      const { contentType, size } = req.body || {}
      if (!TYPES[contentType] || !Number.isSafeInteger(Number(size)) || Number(size) < 1 || Number(size) > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Profile photo must be a JPEG, PNG, or WEBP image under 5MB' })
      }
      const objectPath = `${tenant.property_id}/profile-photos/${tenant.id}/${crypto.randomUUID()}.${TYPES[contentType]}`
      const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUploadUrl(objectPath)
      if (error) throw error
      return res.status(200).json({ path: objectPath, token: data.token })
    }
    if (action === 'update') {
      const objectPath = String(req.body?.path || '')
      if (!safePath(objectPath, tenant, 'tenant')) return res.status(400).json({ error: 'Invalid profile photo path' })
      await verifyUploadedProfilePhoto(objectPath)
      const { error } = await supabaseAdmin.from('tenants').update({ profile_photo_path: objectPath }).eq('id', tenant.id)
      if (error) throw error
      return res.status(200).json({ success: true, signedUrl: await signPath(objectPath) })
    }
    return res.status(400).json({ error: 'Invalid profile photo action' })
  } catch (error) {
    logger.error('Owner tenant profile photo failed', error, { route: '/api/owner/tenant-profile-photo', requestId })
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to update profile photo. Please try again.' })
  }
}
