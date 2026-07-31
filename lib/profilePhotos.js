import { supabase } from './supabase'

export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024

export function validateProfilePhotoFile(file) {
  if (!file) return null
  if (!PROFILE_PHOTO_TYPES.includes(file.type)) return 'Profile photo must be a JPEG, PNG, or WebP image.'
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PROFILE_PHOTO_MAX_BYTES) return 'Profile photo must be under 5MB.'
  return null
}

export async function uploadProfilePhotoWithSignedUrl(endpoint, file, body = {}) {
  const validationError = validateProfilePhotoFile(file)
  if (validationError) throw new Error(validationError)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please log in again.')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...body, action: 'upload-url', contentType: file.type, size: file.size }),
  })
  const prepared = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(prepared.error || 'Could not prepare profile photo upload.')
  const { error } = await supabase.storage.from('tenant-documents').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type })
  if (error) throw error
  return prepared.path
}

export function createBoundedPhotoUrlCache(maxEntries = 180) {
  const cache = new Map()
  const pending = new Map()
  const ttlMs = 4 * 60 * 1000
  const missingTtlMs = 90 * 1000
  const prune = () => {
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
  }
  return {
    async getBatch(key, loader) {
      const now = Date.now()
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now) return cached.value
      if (pending.has(key)) return pending.get(key)
      let promise
      promise = Promise.resolve(loader()).then(value => {
        if (pending.get(key) === promise) {
          cache.set(key, { value, expiresAt: now + (value ? ttlMs : missingTtlMs) })
          prune()
        }
        return value
      }).finally(() => {
        if (pending.get(key) === promise) pending.delete(key)
      })
      pending.set(key, promise)
      return promise
    },
    clear() {
      cache.clear()
      pending.clear()
    },
  }
}
