import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { convertReservedPrebooking } from '../../../lib/server/prebookingConversion'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/admin/delete-tenant',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Tenant archive service is unavailable' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const { tenantId, reason } = req.body || {}
  if (!UUID.test(String(tenantId || ''))) return res.status(400).json({ error: 'Invalid tenant id' })
  const cleanReason = String(reason || '').trim().slice(0, 240)
  if (!cleanReason) return res.status(400).json({ error: 'Archive reason is required' })

  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: auth, error: authError } = await caller.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' })

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('users')
      .select('id,role,is_active')
      .eq('id', auth.user.id)
      .single()
    if (adminError || admin?.role !== 'admin' || !admin?.is_active) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { data, error } = await caller.rpc('archive_tenant', {
      p_tenant_id: tenantId,
      p_reason: cleanReason,
    })
    if (error) throw error

    let conversion = null
    if (data?.occupancy_released && data?.room_id) {
      try {
        conversion = await convertReservedPrebooking({ caller, actorId: admin.id, roomId: data.room_id })
      } catch (conversionError) {
        logger.warn('Tenant archived, but reserved pre-booking conversion did not complete', { message: conversionError.message, roomId: data.room_id, requestId })
        conversion = { converted: false, error: conversionError.message || 'Pre-booking conversion failed' }
      }
    }

    return res.status(200).json({ success: true, archived: true, result: data || null, conversion })
  } catch (error) {
    logger.error('Admin tenant archive failed', error, { route: '/api/admin/delete-tenant', tenantId, requestId })
    const rawMessage = String(error?.message || '')
    const lifecycleMismatch = /constraint|tenants_status_check|violates/i.test(rawMessage)
    const message = lifecycleMismatch
      ? 'Tenant archive is unavailable until the latest lifecycle migration is applied.'
      : process.env.NODE_ENV === 'production'
        ? 'Tenant archive failed'
        : (rawMessage || 'Tenant archive failed')
    const status = /not authorized|admin access|owner/i.test(error?.message || '') ? 403
      : /not found/i.test(error?.message || '') ? 404
        : /already|inactive|invalid/i.test(error?.message || '') ? 409
          : 400
    return res.status(status).json({ error: message })
  }
}
