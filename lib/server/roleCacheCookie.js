export const ROLE_CACHE_COOKIE_NAME = 'hostelset_role_cache'
export const ROLE_CACHE_MAX_AGE_SECONDS = 5 * 60

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const VALID_ROLES = new Set(['admin', 'owner', 'tenant'])

function roleCacheSecret() {
  return process.env.HOSTELSET_ROLE_CACHE_SECRET
    || process.env.SUPABASE_JWT_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || ''
}

function base64UrlEncodeBytes(bytes) {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(textEncoder.encode(value))
}

function base64UrlDecodeText(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return textDecoder.decode(bytes)
}

async function getSigningKey() {
  const secret = roleCacheSecret()
  if (!secret || !globalThis.crypto?.subtle) return null
  return globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function signValue(value) {
  const key = await getSigningKey()
  if (!key) return ''
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, textEncoder.encode(value))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

export async function hashAccessToken(accessToken) {
  if (!accessToken || !globalThis.crypto?.subtle) return ''
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(accessToken))
  return base64UrlEncodeBytes(new Uint8Array(digest))
}

export async function createRoleCacheValue({ userId, role, isActive, accessToken, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!userId || !VALID_ROLES.has(role) || !isActive || !accessToken) return ''
  const tokenHash = await hashAccessToken(accessToken)
  if (!tokenHash) return ''
  const payload = {
    sub: userId,
    role,
    active: true,
    th: tokenHash,
    exp: nowSeconds + ROLE_CACHE_MAX_AGE_SECONDS,
  }
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload))
  const signature = await signValue(encodedPayload)
  return signature ? `${encodedPayload}.${signature}` : ''
}

export async function readRoleCacheValue(value, { userId, accessToken, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (!value || !userId || !accessToken) return null
    const [encodedPayload, signature, ...extra] = String(value).split('.')
    if (!encodedPayload || !signature || extra.length) return null
    const expectedSignature = await signValue(encodedPayload)
    if (!expectedSignature || signature !== expectedSignature) return null

    const payload = JSON.parse(base64UrlDecodeText(encodedPayload))
    if (payload?.sub !== userId || !VALID_ROLES.has(payload?.role) || payload?.active !== true) return null
    if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= nowSeconds) return null

    const tokenHash = await hashAccessToken(accessToken)
    if (!tokenHash || payload.th !== tokenHash) return null
    return payload
  } catch {
    return null
  }
}
