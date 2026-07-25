import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { cleanPhoneNumber } from '../../../lib/utils'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { getResetPasswordUrl } from '../../../lib/server/appUrl'
import { normalizeBloodGroup } from '../../../lib/bloodGroups'
import { isIdentityDocumentPath, safeProfilePhotoPath } from '../../../lib/profilePhoto'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/owner/tenants',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Tenant registration service is unavailable' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' })

  const { data: owner, error: ownerError } = await supabaseAdmin.from('users')
    .select('id, role, is_active').eq('id', auth.user.id).single()
  if (ownerError || owner?.role !== 'owner' || !owner.is_active) return res.status(403).json({ error: 'Active owner access required' })

  const propertyId = cleanText(req.body?.propertyId, 36)
  const roomId = cleanText(req.body?.roomId, 36)
  const name = cleanText(req.body?.name, 120)
  const email = cleanText(req.body?.email, 254).toLowerCase()
  const phone = cleanPhoneNumber(req.body?.phone)
  const bloodGroup = normalizeBloodGroup(req.body?.bloodGroup)
  const monthlyRent = Number(req.body?.monthlyRent)
  const advanceMonths = Number(req.body?.advanceMonths)
  const joiningFee = Number(req.body?.joiningFee)
  const profilePhotoPath = cleanText(req.body?.profilePhotoPath, 1024)

  if (!UUID_PATTERN.test(propertyId) || !UUID_PATTERN.test(roomId) || !name || !EMAIL_PATTERN.test(email) || phone.length !== 10) {
    return res.status(400).json({ error: 'Provide valid tenant and room details' })
  }
  if (!bloodGroup) return res.status(400).json({ error: 'Select a valid blood group' })
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0 || monthlyRent > 10000000
    || !Number.isSafeInteger(advanceMonths) || advanceMonths < 0 || advanceMonths > 24
    || !Number.isFinite(joiningFee) || joiningFee < 0 || joiningFee > 10000000) {
    return res.status(400).json({ error: 'Provide valid rent and payment details' })
  }

  let createdUserId = null
  try {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: `${crypto.randomBytes(18).toString('base64url')}Aa1!`,
      email_confirm: true,
      user_metadata: { full_name: name, phone, role: 'tenant' },
    })
    if (createError) throw createError
    createdUserId = created.user.id

    const { data, error } = await supabaseAdmin.rpc('create_owner_tenant_atomic', {
      p_owner_id: owner.id,
      p_user_id: createdUserId,
      p_property_id: propertyId,
      p_room_id: roomId,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_blood_group: bloodGroup,
      p_monthly_rent: monthlyRent,
      p_advance_months: advanceMonths,
      p_joining_fee: joiningFee,
    })
    if (error) throw error
    if (profilePhotoPath) {
      if (isIdentityDocumentPath(profilePhotoPath) || !safeProfilePhotoPath(profilePhotoPath, propertyId)) {
        throw new Error('Profile photo upload is invalid')
      }
      const { error: photoError } = await supabaseAdmin
        .from('tenants')
        .update({ profile_photo_path: profilePhotoPath, updated_at: new Date().toISOString() })
        .eq('id', data?.tenant_id)
        .eq('property_id', propertyId)
      if (photoError) throw photoError
    }

    let emailSent = true
    const redirectTo = getResetPasswordUrl()
    if (process.env.NODE_ENV !== 'production') {
      console.info('[HostelSet] reset link requested', { method: 'resetPasswordForEmail', redirectTo })
    }
    const { error: mailError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo,
    })
    if (mailError) {
      emailSent = false
      logger.error('Owner-created tenant password email failed', mailError, { route: '/api/owner/tenants', requestId })
    }

    return res.status(201).json({ success: true, tenantId: data?.tenant_id, emailSent })
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(createdUserId)
      if (cleanupError) logger.error('Tenant auth rollback failed', cleanupError, { route: '/api/owner/tenants', requestId })
    }
    logger.error('Owner tenant registration failed', error, { route: '/api/owner/tenants', requestId })
    const conflict = error?.code === '23505' || /already|registered|exists/i.test(error?.message || '')
    const message = process.env.NODE_ENV === 'production'
      ? 'Tenant registration failed'
      : (error.message || 'Tenant registration failed')
    return res.status(conflict ? 409 : 400).json({ error: conflict ? 'A tenant account already exists for this email or phone.' : message })
  }
}
