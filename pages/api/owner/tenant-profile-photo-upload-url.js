import crypto from 'crypto'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { validateProfilePhotoUpload } from '../../../lib/profilePhoto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/owner/tenant-profile-photo-upload-url',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Photo upload service is unavailable' })

  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'Authentication required' })
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ error: 'Authentication required' })
    const { data: actor, error: actorError } = await supabaseAdmin.from('users').select('id,role,is_active').eq('id', auth.user.id).single()
    if (actorError || !actor?.is_active || !['owner', 'admin'].includes(actor.role)) return res.status(403).json({ error: 'Active owner access required' })

    const tenantId = String(req.body?.tenantId || '')
    const propertyId = String(req.body?.propertyId || '')
    const validation = validateProfilePhotoUpload(req.body || {})
    if (!validation.ok) return res.status(400).json({ error: validation.error })

    let scopedPropertyId = ''
    let scopedTenantSegment = 'manual'
    if (UUID.test(tenantId)) {
      const { data: tenant, error: tenantError } = await supabaseAdmin.from('tenants').select('id,property_id,properties(owner_id)').eq('id', tenantId).maybeSingle()
      if (tenantError) throw tenantError
      if (!tenant || (actor.role !== 'admin' && tenant.properties?.owner_id !== actor.id)) return res.status(403).json({ error: 'Not authorized' })
      scopedPropertyId = tenant.property_id
      scopedTenantSegment = tenant.id
    } else {
      if (!UUID.test(propertyId)) return res.status(400).json({ error: 'Invalid property' })
      const { data: property, error: propertyError } = await supabaseAdmin.from('properties').select('id,owner_id').eq('id', propertyId).maybeSingle()
      if (propertyError) throw propertyError
      if (!property || (actor.role !== 'admin' && property.owner_id !== actor.id)) return res.status(403).json({ error: 'Not authorized' })
      scopedPropertyId = property.id
    }

    const path = `${scopedPropertyId}/profile-photos/${scopedTenantSegment}/${crypto.randomUUID()}.${validation.extension}`
    const { data, error } = await supabaseAdmin.storage.from('tenant-documents').createSignedUploadUrl(path)
    if (error) throw error
    return res.status(200).json({ path, token: data.token })
  } catch (error) {
    logger.error('Owner tenant profile photo upload URL failed', error, { route: '/api/owner/tenant-profile-photo-upload-url', requestId })
    return res.status(500).json({ error: 'Unable to prepare profile photo upload. Please try again.' })
  }
}
