import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import {
  ROLE_CACHE_COOKIE_NAME,
  ROLE_CACHE_MAX_AGE_SECONDS,
  createRoleCacheValue,
} from '../../../lib/server/roleCacheCookie'

const COOKIE_NAME = 'hostelset_access_token'
const REFRESH_COOKIE_NAME = 'hostelset_refresh_token'

function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return Number(payload.exp)
  } catch {
    return 0
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', [cookie(COOKIE_NAME, '', 0), cookie(REFRESH_COOKIE_NAME, '', 0), cookie(ROLE_CACHE_COOKIE_NAME, '', 0)])
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Authentication service unavailable' })
    return
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : ''
  if (!token || token.length > 8192) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  if (!refreshToken || refreshToken.length > 8192) {
    res.status(400).json({ error: 'Invalid session' })
    return
  }

  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !auth?.user) {
    res.setHeader('Set-Cookie', [cookie(COOKIE_NAME, '', 0), cookie(REFRESH_COOKIE_NAME, '', 0), cookie(ROLE_CACHE_COOKIE_NAME, '', 0)])
    res.status(401).json({ error: 'Session expired' })
    return
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('role, is_active')
    .eq('id', auth.user.id)
    .single()
  if (profileError || !profile || !profile.is_active || !['admin', 'owner', 'tenant'].includes(profile.role)) {
    res.setHeader('Set-Cookie', [cookie(COOKIE_NAME, '', 0), cookie(REFRESH_COOKIE_NAME, '', 0), cookie(ROLE_CACHE_COOKIE_NAME, '', 0)])
    res.status(403).json({ error: 'Account is not authorized' })
    return
  }

  const expiresAt = tokenExpiry(token)
  const maxAge = Math.max(0, Math.min(3600, expiresAt - Math.floor(Date.now() / 1000)))
  if (!maxAge) {
    res.status(401).json({ error: 'Session expired' })
    return
  }

  const roleCache = await createRoleCacheValue({
    userId: auth.user.id,
    role: profile.role,
    isActive: profile.is_active,
    accessToken: token,
  })
  const cookies = [
    cookie(COOKIE_NAME, encodeURIComponent(token), maxAge),
    cookie(REFRESH_COOKIE_NAME, encodeURIComponent(refreshToken), 60 * 60 * 24 * 30),
  ]
  if (roleCache) cookies.push(cookie(ROLE_CACHE_COOKIE_NAME, roleCache, ROLE_CACHE_MAX_AGE_SECONDS))
  else cookies.push(cookie(ROLE_CACHE_COOKIE_NAME, '', 0))

  res.setHeader('Set-Cookie', cookies)
  res.status(204).end()
  return
}
