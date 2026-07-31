const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_PROFILE_PHOTO_SIZE = 5 * 1024 * 1024

function getProfilePhotoExtension(contentType) {
  return IMAGE_MIME_EXTENSIONS[contentType] || null
}

function validateProfilePhotoUpload({ contentType, size }) {
  const extension = getProfilePhotoExtension(contentType)
  if (!extension) return { ok: false, error: 'Profile photo must be a JPEG, PNG, or WEBP image.' }
  const byteSize = Number(size)
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_PROFILE_PHOTO_SIZE) {
    return { ok: false, error: 'Profile photo must be smaller than 5 MB.' }
  }
  return { ok: true, extension }
}

function safeProfilePhotoPath(path, propertyId) {
  if (!path || !propertyId) return ''
  const objectPath = String(path).trim()
  if (!objectPath || objectPath.startsWith('/') || objectPath.includes('..') || /^(?:https?:|blob:|data:)/i.test(objectPath)) return ''
  try {
    if (decodeURIComponent(objectPath).includes('..')) return ''
  } catch {
    return ''
  }
  const safePrefixes = [
    `${propertyId}/profile-photos/`,
    `${propertyId}/photos/`,
    `${propertyId}/imports/photos/`,
  ]
  return safePrefixes.some(prefix => objectPath.startsWith(prefix)) ? objectPath : ''
}

function buildProfilePhotoPath(propertyId, tenantId, contentType) {
  const extension = getProfilePhotoExtension(contentType)
  if (!propertyId || !tenantId || !extension) return ''
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${propertyId}/profile-photos/${tenantId}/${random}.${extension}`
}

function safeTenantProfilePhotoPath(path, propertyId, tenantId = null) {
  const objectPath = safeProfilePhotoPath(path, propertyId)
  if (!objectPath || !objectPath.startsWith(`${propertyId}/profile-photos/`)) return ''
  if (tenantId && !objectPath.startsWith(`${propertyId}/profile-photos/${tenantId}/`)) return ''
  return isIdentityDocumentPath(objectPath) ? '' : objectPath
}

function safeLegacyProfilePhotoPath(path, propertyId, sourceType = '') {
  const objectPath = safeProfilePhotoPath(path, propertyId)
  if (!objectPath || isIdentityDocumentPath(objectPath)) return ''
  if (sourceType === 'existing_tenant_import') return objectPath.startsWith(`${propertyId}/imports/photos/`) ? objectPath : ''
  if (sourceType === 'application' || sourceType === 'pre_booking') return objectPath.startsWith(`${propertyId}/photos/`) ? objectPath : ''
  return ''
}

function isIdentityDocumentPath(path = '') {
  return /(?:^|\/)(identity|id-proof|aadhaar|aadhar)(?:\/|$)/i.test(String(path))
}

module.exports = {
  IMAGE_MIME_EXTENSIONS,
  MAX_PROFILE_PHOTO_SIZE,
  getProfilePhotoExtension,
  buildProfilePhotoPath,
  validateProfilePhotoUpload,
  safeProfilePhotoPath,
  safeTenantProfilePhotoPath,
  safeLegacyProfilePhotoPath,
  isIdentityDocumentPath,
}
