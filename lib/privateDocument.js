function normalizePrivateDocumentPath(path, options = {}) {
  if (typeof path !== 'string') return null
  const bucket = options.bucket || 'tenant-documents'
  let objectPath = path.trim()
  if (!objectPath || /^(?:blob:|data:)/i.test(objectPath) || objectPath.includes('..') || /[?#]/.test(objectPath)) return null
  try {
    if (decodeURIComponent(objectPath).includes('..')) return null
  } catch {
    return null
  }
  if (/^https?:\/\//i.test(objectPath)) {
    try {
      const parsed = new URL(objectPath)
      const configured = options.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
      if (configured) {
        const configuredHost = new URL(configured).host
        if (parsed.host !== configuredHost) return null
      } else if (!/\.supabase\.(?:co|in)$/.test(parsed.host)) {
        return null
      }
      const marker = `/storage/v1/object/public/${bucket}/`
      const legacyMarker = `/storage/v1/object/${bucket}/`
      const index = parsed.pathname.indexOf(marker)
      const legacyIndex = parsed.pathname.indexOf(legacyMarker)
      if (index >= 0) objectPath = parsed.pathname.slice(index + marker.length)
      else if (legacyIndex >= 0) objectPath = parsed.pathname.slice(legacyIndex + legacyMarker.length)
      else return null
      objectPath = decodeURIComponent(objectPath)
    } catch {
      return null
    }
  }
  objectPath = objectPath.replace(/^\/+/, '')
  if (objectPath.toLowerCase().startsWith(`${bucket.toLowerCase()}/`)) objectPath = objectPath.slice(bucket.length + 1)
  if (!objectPath || objectPath.includes('..') || objectPath.length > 1024 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(objectPath) || objectPath.includes('//')) return null
  return objectPath
}

function createExpiringRequestCache({ successTtlMs, missingTtlMs, now = () => Date.now() }) {
  const values = new Map()
  const requests = new Map()
  return {
    async getOrLoad(key, loader) {
      const cached = values.get(key)
      if (cached && cached.expiresAt > now()) return cached.value
      if (cached) values.delete(key)
      if (requests.has(key)) return requests.get(key)
      let request
      request = Promise.resolve().then(loader).then(value => {
        if (requests.get(key) === request) {
          values.set(key, { value: value || null, expiresAt: now() + (value ? successTtlMs : missingTtlMs) })
        }
        return value || null
      }).finally(() => {
        if (requests.get(key) === request) requests.delete(key)
      })
      requests.set(key, request)
      return request
    },
    delete(key) { values.delete(key); requests.delete(key) },
    clear() { values.clear(); requests.clear() },
  }
}
module.exports = { normalizePrivateDocumentPath, createExpiringRequestCache }
