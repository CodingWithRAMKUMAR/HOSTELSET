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
  VISITOR_MAX_FILE_SIZE,
  hasValidVisitorSubmissionShape,
  isVisitorUploadTypeAllowed,
  normalizeVisitorPrivatePath,
  normalizeVisitorSubmissionBody,
  resolveVisitorApplicationDeposit,
  resolveVisitorPreBookingFee,
  visitorActiveStatusesForKind,
  visitorTableForKind,
  visitorUploadExtension,
} from '../../../products/hostels/public/visitor'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

function decodeFile(file, label, imageOnly = false) {
  if (!file?.data || !file?.type) throw new Error(`${label} is required`)
  if (!isVisitorUploadTypeAllowed(file.type, { imageOnly })) {
    throw new Error(`${label} has an unsupported file type`)
  }
  const match = file.data.match(/^data:([^;]+);base64,(.+)$/)
  if (!match || match[1] !== file.type) throw new Error(`${label} is invalid`)
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > VISITOR_MAX_FILE_SIZE) throw new Error(`${label} must be under 5MB`)
  return buffer
}

async function uploadPrivate(file, folder, label, imageOnly = false) {
  const buffer = decodeFile(file, label, imageOnly)
  const path = `${folder}/${crypto.randomUUID()}.${visitorUploadExtension(file.type)}`
  const { error } = await supabaseAdmin.storage.from('tenant-documents').upload(path, buffer, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error
  return path
}

async function removeFiles(paths) {
  if (paths.length) await supabaseAdmin.storage.from('tenant-documents').remove(paths)
}

async function verifyPrivateObject(path, label, imageOnly = false) {
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash)
  const name = path.slice(slash + 1)
  const { data, error } = await supabaseAdmin.storage.from('tenant-documents').list(folder, { search: name, limit: 2 })
  const object = data?.find(item => item.name === name)
  const mime = object?.metadata?.mimetype || object?.metadata?.contentType
  if (error || !object || !isVisitorUploadTypeAllowed(mime, { imageOnly }) || Number(object.metadata?.size || 0) < 1 || Number(object.metadata?.size || 0) > VISITOR_MAX_FILE_SIZE) {
    throw new Error(`${label} upload was not completed`)
  }
}

async function processVisitorSubmission(req, res) {
  setPrivateApiResponse(res)
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  if (!supabaseAdmin) return res.status(503).json({ error: 'Application service is unavailable' })
  const ip = getClientIp(req)
  if (!await enforceRateLimit(req, res, { scope: 'visitor-submit-ip', identifier: ip, limit: 8, windowSeconds: 900 })) return

  const uploaded = []
  try {
    const submission = normalizeVisitorSubmissionBody(req.body || {})
    const {
      kind,
      propertyId,
      roomId,
      files,
      expectedMoveIn,
      name,
      email,
      phone,
      message,
      bloodGroup,
      storedTransactionId,
    } = submission
    if (!hasValidVisitorSubmissionShape(submission)) {
      return res.status(400).json({ error: 'Please provide valid application details, including a UPI transaction reference.' })
    }
    if (kind === 'application' && !bloodGroup) return res.status(400).json({ error: 'Please select a valid blood group.' })
    if (!await enforceRateLimit(req, res, { scope: 'visitor-submit-identity', identifier: `${propertyId}:${email}:${phone}`, limit: 3, windowSeconds: 3600 })) return

    const { data: isVisible, error: visibilityError } = await supabaseAdmin.rpc('is_public_property_visible', { p_property_id: propertyId })
    if (visibilityError) throw visibilityError
    if (!isVisible) return res.status(404).json({ error: 'This property is currently unavailable for applications.' })

    const { data: room, error: roomError } = await supabaseAdmin.from('rooms')
      .select('id, property_id, capacity, current_occupants, monthly_rent, deposit_amount')
      .eq('id', roomId).eq('property_id', propertyId).single()
    if (roomError || !room) return res.status(404).json({ error: 'The selected room is no longer available.' })
    if (kind === 'application' && Number(room.current_occupants || 0) >= Number(room.capacity || 0)) {
      return res.status(409).json({ error: 'This room is full. Please select another room.' })
    }
    if (kind === 'prebooking') {
      const { count: activeReservationCount, error: reservationError } = await supabaseAdmin
        .from('pre_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('status', 'reserved')
        .is('deleted_at', null)
      if (reservationError) throw reservationError
      if (Number(activeReservationCount || 0) >= Number(room.capacity || 0)) return res.status(409).json({ error: 'This room has no remaining reservation capacity.' })
    }

    const table = visitorTableForKind(kind)
    const activeStatuses = visitorActiveStatusesForKind(kind)
    const [{ data: duplicatePhone }, { data: duplicateEmail }] = await Promise.all([
      supabaseAdmin.from(table).select('id').eq('property_id', propertyId).eq('phone', phone).in('status', activeStatuses).is('deleted_at', null).limit(1),
      supabaseAdmin.from(table).select('id').eq('property_id', propertyId).eq('email', email).in('status', activeStatuses).is('deleted_at', null).limit(1),
    ])
    if (duplicatePhone?.length || duplicateEmail?.length) return res.status(409).json({ error: 'An active request already exists for these details.' })

    const [
      { data: activeTenantByPhone, error: activeTenantPhoneError },
      { data: activeTenantByEmail, error: activeTenantEmailError },
    ] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('phone', phone)
        .in('status', ['active', 'notice_period', 'payment_pending'])
        .is('archived_at', null)
        .limit(1),
      supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('email', email)
        .in('status', ['active', 'notice_period', 'payment_pending'])
        .is('archived_at', null)
        .limit(1),
    ])

    if (activeTenantPhoneError) throw activeTenantPhoneError
    if (activeTenantEmailError) throw activeTenantEmailError

    if (activeTenantByPhone?.length || activeTenantByEmail?.length) {
      return res.status(409).json({
        error: 'You already have an active tenancy. Please log in to your tenant account instead.',
        code: 'ACTIVE_TENANT_EXISTS',
      })
    }

    const idPath = typeof files?.idProof === 'string' ? normalizeVisitorPrivatePath(files.idProof, propertyId, 'identity', 'ID proof') : await uploadPrivate(files?.idProof, `${propertyId}/identity`, 'ID proof')
    uploaded.push(idPath)
    const photoPath = typeof files?.photo === 'string' ? normalizeVisitorPrivatePath(files.photo, propertyId, 'photos', 'Photo') : await uploadPrivate(files?.photo, `${propertyId}/photos`, 'Photo', true)
    uploaded.push(photoPath)
    const paymentPath = typeof files?.payment === 'string' ? normalizeVisitorPrivatePath(files.payment, propertyId, 'payments', 'Payment screenshot') : await uploadPrivate(files?.payment, `${propertyId}/payments`, 'Payment screenshot', true)
    uploaded.push(paymentPath)
    await Promise.all([
      verifyPrivateObject(idPath, 'ID proof'), verifyPrivateObject(photoPath, 'Photo', true), verifyPrivateObject(paymentPath, 'Payment screenshot', true),
    ])

    if (kind === 'prebooking') {
      if (!expectedMoveIn || Number.isNaN(Date.parse(expectedMoveIn))) throw new Error('A valid move-in date is required')
      const { data: settings } = await supabaseAdmin.from('owner_settings').select('pre_booking_fee, upi_id').eq('property_id', propertyId).maybeSingle()
      if (!settings?.upi_id) throw new Error('Owner payment details are not configured')
      const preBookingFee = resolveVisitorPreBookingFee(settings, room)
      if (!Number.isFinite(preBookingFee) || preBookingFee <= 0) throw new Error('Pre-booking fee is not configured')
      const { error } = await supabaseAdmin.from('pre_bookings').insert({
        property_id: propertyId, room_id: roomId, user_id: null, name, phone, email, message,
        expected_move_in_date: expectedMoveIn, id_proof: idPath, photo: photoPath,
        status: 'pending', payment_status: 'pending', pre_booking_fee_amount: preBookingFee,
        payment_screenshot: paymentPath, payment_transaction_id: storedTransactionId,
      })
      if (error) throw error
    } else {
      const { data: settings } = await supabaseAdmin
        .from('owner_settings')
        .select('application_deposit, upi_id')
        .eq('property_id', propertyId)
        .maybeSingle()

      if (!settings?.upi_id) throw new Error('Owner payment details are not configured')
      const [{ data: byPhone }, { data: byEmail }] = await Promise.all([
        supabaseAdmin.from('users').select('id, email').eq('phone', phone).limit(1),
        supabaseAdmin.from('users').select('id, phone').eq('email', email).limit(1),
      ])
      if (byPhone?.[0] && byEmail?.[0] && byPhone[0].id !== byEmail[0].id) throw new Error('The phone and email belong to different accounts')
      const userId = byPhone?.[0]?.id || byEmail?.[0]?.id || null
      const deposit = resolveVisitorApplicationDeposit(settings)
      const { error } = await supabaseAdmin.from('applications').insert({
        user_id: userId, property_id: propertyId, room_id: roomId, name, phone, email, blood_group: bloodGroup, message,
        status: 'pending', id_proof: idPath, photo: photoPath, payment_screenshot: paymentPath,
        payment_transaction_id: storedTransactionId,
        payment_amount: deposit,
      })
      if (error) throw error
    }

    return res.status(201).json({
      success: true,
      message: kind === 'prebooking'
        ? 'Your pre-booking request has been submitted and is awaiting owner verification.'
        : 'Application submitted successfully.',
    })
  } catch (error) {
    await removeFiles(uploaded)
    logger.error('Visitor submission failed', error, { route: '/api/visitor/submit', stage: 'processing' })
    const conflict = error?.code === '23505'
    return res.status(conflict ? 409 : 400).json({ error: conflict ? 'An active request already exists.' : (error.message || 'Submission failed') })
  }
}

export default async function handler(req, res) {
  try {
    return await processVisitorSubmission(req, res)
  } catch (error) {
    logger.error('Unhandled visitor submission failure', error, { route: '/api/visitor/submit' })
    if (res.headersSent) return res.end()
    setPrivateApiResponse(res)
    return res.status(500).json({ error: 'Application submission failed. Please try again.' })
  }
}
