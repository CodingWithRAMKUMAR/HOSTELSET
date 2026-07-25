import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { getResetPasswordUrl } from '../../../lib/server/appUrl'
import { safeProfilePhotoPath } from '../../../lib/profilePhoto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }

async function inviteTenantForSetup(importRecord) {
  const redirectTo = getResetPasswordUrl()
  if (process.env.NODE_ENV !== 'production') {
    console.info('[HostelSet] reset link requested', { method: 'inviteUserByEmail', redirectTo })
  }
  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(importRecord.email, {
    redirectTo,
    data: { full_name: importRecord.full_name, phone: importRecord.phone, role: 'tenant' },
  })
  if (inviteError) throw inviteError
  return invited.user.id
}

async function replaceStaleTenantProfile(userId, importRecord) {
  const { count, error: activeTenantError } = await supabaseAdmin
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['active', 'notice_period', 'payment_pending'])
  if (activeTenantError) throw activeTenantError
  if (count > 0) throw new Error('An active tenant account already exists for these details')

  const { error: deleteProfileError } = await supabaseAdmin.from('users').delete().eq('id', userId).eq('role', 'tenant')
  if (deleteProfileError) throw deleteProfileError
  return inviteTenantForSetup(importRecord)
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/owner/approve-existing-import',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Approval service is unavailable' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' })

  const importId = String(req.body?.importId || '')
  if (!UUID.test(importId)) return res.status(400).json({ error: 'Invalid import approval request' })

  let createdUserId = null
  try {
    const { data: approver, error: approverError } = await supabaseAdmin
      .from('users')
      .select('id,role,is_active')
      .eq('id', auth.user.id)
      .single()
    if (approverError || !approver?.is_active || !['owner', 'admin'].includes(approver.role)) {
      return res.status(403).json({ error: 'Active owner access required' })
    }

    const { data: importRecord, error: importError } = await supabaseAdmin
      .from('existing_tenant_imports')
      .select('id,property_id,user_id,full_name,phone,email,status,profile_photo,properties(owner_id)')
      .eq('id', importId)
      .single()
    if (importError || !importRecord) return res.status(404).json({ error: 'Import submission not found' })
    if (importRecord.status !== 'pending_owner_review') return res.status(400).json({ error: 'Import submission has already been processed' })
    if (approver.role !== 'admin' && importRecord.properties?.owner_id !== approver.id) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    let userId = importRecord.user_id
    if (!userId) {
      const [{ data: byPhone }, { data: byEmail }] = await Promise.all([
        supabaseAdmin.from('users').select('id,role,is_active,email').eq('phone', importRecord.phone).limit(1),
        supabaseAdmin.from('users').select('id,role,is_active,phone').eq('email', importRecord.email).limit(1),
      ])
      if (byPhone?.[0] && byEmail?.[0] && byPhone[0].id !== byEmail[0].id) {
        return res.status(409).json({ error: 'The phone and email belong to different accounts.' })
      }
      const existing = byPhone?.[0] || byEmail?.[0]
      if (existing && existing.role !== 'tenant') return res.status(409).json({ error: 'These details belong to an existing non-tenant account.' })
      userId = existing?.id
    }

    let inviteEmailSent = false
    if (!userId) {
      userId = await inviteTenantForSetup(importRecord)
      createdUserId = userId
      inviteEmailSent = true
    } else {
      const { data: authUser, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (authLookupError || !authUser?.user) {
        userId = await replaceStaleTenantProfile(userId, importRecord)
        createdUserId = userId
        inviteEmailSent = true
      } else {
        const redirectTo = getResetPasswordUrl()
        if (process.env.NODE_ENV !== 'production') {
          console.info('[HostelSet] reset link requested', { method: 'resetPasswordForEmail', redirectTo })
        }
        const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(importRecord.email, {
          redirectTo,
        })
        if (resetError) logger.warn('Existing import approved, but password setup email failed', { message: resetError.message, requestId })
        else inviteEmailSent = true
      }
    }

    const { error: profileError } = await supabaseAdmin.from('users').upsert({
      id: userId,
      email: importRecord.email,
      full_name: importRecord.full_name,
      phone: importRecord.phone,
      role: 'tenant',
      is_active: true,
    }, { onConflict: 'id' })
    if (profileError) throw profileError

    const { data, error: approvalError } = await caller.rpc('approve_existing_tenant_import_with_user', {
      p_import_id: importId,
      p_user_id: userId,
    })
    if (approvalError) throw approvalError
    if (data?.tenant_id && safeProfilePhotoPath(importRecord.profile_photo, importRecord.property_id)) {
      await supabaseAdmin.from('tenants').update({ profile_photo_path: importRecord.profile_photo }).eq('id', data.tenant_id)
    }

    return res.status(200).json({ success: true, tenantId: data?.tenant_id, inviteEmailSent })
  } catch (error) {
    if (createdUserId) await supabaseAdmin.auth.admin.deleteUser(createdUserId).catch(() => {})
    logger.error('Existing tenant import approval failed', error, { route: '/api/owner/approve-existing-import', requestId })
    const message = process.env.NODE_ENV === 'production' ? 'Import approval failed' : (error.message || 'Import approval failed')
    return res.status(400).json({ error: message })
  }
}
