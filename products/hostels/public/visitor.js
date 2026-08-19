import { normalizeBloodGroup } from '../../../lib/bloodGroups'
import { cleanPhoneNumber } from '../../../lib/utils'
import {
  DEFAULT_APPLICATION_DEPOSIT,
  DEFAULT_PREBOOKING_FEE,
} from './detail'

export const VISITOR_MAX_FILE_SIZE = 5 * 1024 * 1024
export const VISITOR_UPLOAD_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
export const VISITOR_ALLOWED_UPLOAD_TYPES = Object.keys(VISITOR_UPLOAD_EXTENSIONS)
export const VISITOR_ALLOWED_UPLOAD_TYPE_SET = new Set(VISITOR_ALLOWED_UPLOAD_TYPES)
export const VISITOR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const VISITOR_REQUEST_KINDS = ['application', 'prebooking']
export const VISITOR_UPLOAD_CATEGORIES = ['identity', 'photos', 'payments']
export const ACTIVE_TENANT_STATUSES = ['active', 'notice_period', 'payment_pending']
export const ACTIVE_APPLICATION_STATUSES = ['pending', 'approved']
export const ACTIVE_PREBOOKING_STATUSES = ['pending', 'reserved', 'approved']
export const VISITOR_UNAVAILABLE_MESSAGE = 'This phone number or email is associated with an active tenancy or active request. Please log in or contact the property owner.'

export const isVisitorKind = kind => VISITOR_REQUEST_KINDS.includes(kind)

export const visitorTableForKind = kind => kind === 'prebooking' ? 'pre_bookings' : 'applications'

export const visitorActiveStatusesForKind = kind => kind === 'prebooking'
  ? ACTIVE_PREBOOKING_STATUSES
  : ACTIVE_APPLICATION_STATUSES

export const normalizeVisitorSubmissionBody = body => {
  const { kind = 'application', propertyId, roomId, form, files, transactionId, expectedMoveIn } = body || {}
  return {
    kind,
    propertyId,
    roomId,
    files,
    expectedMoveIn,
    name: String(form?.name || '').trim().slice(0, 120),
    email: String(form?.email || '').trim().toLowerCase().slice(0, 254),
    phone: cleanPhoneNumber(form?.phone),
    message: String(form?.message || '').trim().slice(0, 2000) || null,
    bloodGroup: normalizeBloodGroup(form?.bloodGroup),
    normalizedTransactionId: String(transactionId || '').trim(),
    storedTransactionId: String(transactionId || '').trim().slice(0, 120) || null,
  }
}

export const hasValidVisitorSubmissionShape = submission => (
  isVisitorKind(submission.kind) &&
  VISITOR_UUID_PATTERN.test(String(submission.propertyId || '')) &&
  VISITOR_UUID_PATTERN.test(String(submission.roomId || '')) &&
  Boolean(submission.name) &&
  /^\S+@\S+\.\S+$/.test(submission.email) &&
  /^\d{10}$/.test(submission.phone) &&
  Boolean(submission.normalizedTransactionId) &&
  Boolean(submission.files) &&
  typeof submission.files === 'object'
)

export const normalizeVisitorIdentityBody = body => {
  const { propertyId, phone: rawPhone, email: rawEmail, kind = 'application' } = body || {}
  return {
    propertyId,
    kind,
    phone: rawPhone ? cleanPhoneNumber(rawPhone) : '',
    email: rawEmail ? String(rawEmail).trim().toLowerCase().slice(0, 254) : '',
  }
}

export const visitorIdentityRateLimitKey = ({ propertyId, phone, email, kind }) =>
  `${propertyId}:${phone || '-'}:${email || '-'}:${kind}`

async function hasRows(query) {
  const { data, error } = await query.limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function visitorIdentityExists(supabase, { propertyId, phone, email }) {
  const checks = []

  if (phone) {
    checks.push(
      hasRows(
        supabase
          .from('tenants')
          .select('id')
          .eq('phone', phone)
          .in('status', ACTIVE_TENANT_STATUSES)
          .is('archived_at', null)
      ),
      hasRows(
        supabase
          .from('applications')
          .select('id')
          .eq('property_id', propertyId)
          .eq('phone', phone)
          .in('status', ACTIVE_APPLICATION_STATUSES)
          .is('deleted_at', null)
      ),
      hasRows(
        supabase
          .from('pre_bookings')
          .select('id')
          .eq('property_id', propertyId)
          .eq('phone', phone)
          .in('status', ACTIVE_PREBOOKING_STATUSES)
          .is('deleted_at', null)
      )
    )
  }

  if (email) {
    checks.push(
      hasRows(
        supabase
          .from('tenants')
          .select('id')
          .eq('email', email)
          .in('status', ACTIVE_TENANT_STATUSES)
          .is('archived_at', null)
      ),
      hasRows(
        supabase
          .from('applications')
          .select('id')
          .eq('property_id', propertyId)
          .eq('email', email)
          .in('status', ACTIVE_APPLICATION_STATUSES)
          .is('deleted_at', null)
      ),
      hasRows(
        supabase
          .from('pre_bookings')
          .select('id')
          .eq('property_id', propertyId)
          .eq('email', email)
          .in('status', ACTIVE_PREBOOKING_STATUSES)
          .is('deleted_at', null)
      )
    )
  }

  const results = await Promise.all(checks)
  return results.some(Boolean)
}

export const visitorUploadExtension = contentType => VISITOR_UPLOAD_EXTENSIONS[contentType]

export const isVisitorUploadCategory = category => VISITOR_UPLOAD_CATEGORIES.includes(category)

export const isVisitorUploadTypeAllowed = (contentType, { imageOnly = false } = {}) =>
  VISITOR_ALLOWED_UPLOAD_TYPE_SET.has(contentType) && !(imageOnly && contentType === 'application/pdf')

export const isVisitorUploadSizeAllowed = size =>
  Number.isSafeInteger(Number(size)) && Number(size) >= 1 && Number(size) <= VISITOR_MAX_FILE_SIZE

export const buildVisitorUploadPath = (propertyId, category, contentType, id) =>
  `${propertyId}/${category}/${id}.${visitorUploadExtension(contentType)}`

export function normalizeVisitorPrivatePath(path, propertyId, category, label) {
  const value = String(path || '')
  if (!value.startsWith(`${propertyId}/${category}/`) || value.includes('..')) throw new Error(`${label} upload is invalid`)
  return value
}

export const resolveVisitorPreBookingFee = (settings, room) => {
  const configuredFee = Number(settings?.pre_booking_fee)
  const preBookingFee = Number.isFinite(configuredFee) && configuredFee > 0
    ? configuredFee
    : Number(room?.deposit_amount || DEFAULT_PREBOOKING_FEE)
  return preBookingFee
}

export const resolveVisitorApplicationDeposit = settings => {
  const configuredDeposit = Number(settings?.application_deposit)
  return Number.isFinite(configuredDeposit) && configuredDeposit > 0
    ? configuredDeposit
    : DEFAULT_APPLICATION_DEPOSIT
}
