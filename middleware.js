import { NextResponse } from 'next/server'
import {
  ROLE_CACHE_COOKIE_NAME,
  ROLE_CACHE_MAX_AGE_SECONDS,
  createRoleCacheValue,
  readRoleCacheValue,
} from './lib/server/roleCacheCookie'

const COOKIE_NAME = 'hostelset_access_token'
const REFRESH_COOKIE_NAME = 'hostelset_refresh_token'
const TOKEN_REFRESH_WINDOW_SECONDS = 30

function loginRedirect(request, clearCookie = false, roleRequired = '') {
  const url = request.nextUrl.clone()
  url.pathname = roleRequired ? `/login/${roleRequired}` : '/login'
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  url.search = ''
  if (nextPath && nextPath !== '/login') url.searchParams.set('next', nextPath)
  const response = NextResponse.redirect(url)
  if (clearCookie) {
    response.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 })
    response.cookies.set(REFRESH_COOKIE_NAME, '', { path: '/', maxAge: 0 })
    response.cookies.set(ROLE_CACHE_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  }
  return response
}

async function setSessionCookies(response, accessToken, refreshToken, expiresIn, profile = null, userId = '') {
  const secure = process.env.NODE_ENV === 'production'
  const payload = decodeJwtPayload(accessToken)
  const secondsUntilExpiry = Number(payload?.exp || 0) - Math.floor(Date.now() / 1000)
  const accessMaxAge = Math.max(0, Math.min(3600, Number(expiresIn || secondsUntilExpiry || 0)))
  if (accessToken && accessMaxAge > 0) {
    response.cookies.set(COOKIE_NAME, accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: accessMaxAge })
  }
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 })
  }
  if (profile && userId) {
    const roleCache = await createRoleCacheValue({
      userId,
      role: profile.role,
      isActive: profile.is_active,
      accessToken,
    })
    if (roleCache) {
      response.cookies.set(ROLE_CACHE_COOKIE_NAME, roleCache, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: ROLE_CACHE_MAX_AGE_SECONDS,
      })
    }
  }
  return response
}

function dashboardFor(role) {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'owner') return '/owner/dashboard'
  return '/tenant/dashboard'
}

function requiredRole(pathname) {
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/owner')) return 'owner'
  if (pathname.startsWith('/tenant')) return 'tenant'
  return null
}

function decodeJwtPayload(token) {
  try {
    const [, encodedPayload] = String(token || '').split('.')
    if (!encodedPayload) return null
    const padded = encodedPayload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function tokenExpiresSoon(payload) {
  const expiresAt = Number(payload?.exp || 0)
  const now = Math.floor(Date.now() / 1000)
  return !Number.isFinite(expiresAt) || expiresAt - now < TOKEN_REFRESH_WINDOW_SECONDS
}

export async function middleware(request) {
  const { pathname } = request.nextUrl

  const roleRequired = requiredRole(pathname)
  if (!roleRequired) return NextResponse.next()

  let token = request.cookies.get(COOKIE_NAME)?.value
  let refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value
  if (!token && !refreshToken) return loginRedirect(request, false, roleRequired)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return loginRedirect(request, true, roleRequired)

  try {
    token = token ? decodeURIComponent(token) : ''
    refreshToken = refreshToken ? decodeURIComponent(refreshToken) : ''
    let refreshedSession = null
    let tokenPayload = decodeJwtPayload(token)

    if ((!token || !tokenPayload?.sub || tokenExpiresSoon(tokenPayload)) && refreshToken) {
      const refreshResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: 'no-store',
      })
      if (refreshResponse.ok) {
        refreshedSession = await refreshResponse.json()
        token = refreshedSession.access_token
        refreshToken = refreshedSession.refresh_token
        tokenPayload = decodeJwtPayload(token)
      }
    }

    if (!token || !tokenPayload?.sub || tokenExpiresSoon(tokenPayload)) {
      return loginRedirect(request, true, roleRequired)
    }

    const cachedRole = refreshedSession
      ? null
      : await readRoleCacheValue(request.cookies.get(ROLE_CACHE_COOKIE_NAME)?.value, {
        userId: tokenPayload.sub,
        accessToken: token,
      })

    if (cachedRole?.role) {
      if (cachedRole.role !== roleRequired) {
        const url = request.nextUrl.clone()
        url.pathname = dashboardFor(cachedRole.role)
        url.search = ''
        return NextResponse.redirect(url)
      }
      return NextResponse.next()
    }

    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(tokenPayload.sub)}&select=role,is_active&limit=1`,
      {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    )
    if (!profileResponse.ok) return loginRedirect(request, true, roleRequired)
    const [profile] = await profileResponse.json()
    if (!profile?.is_active || !['admin', 'owner', 'tenant'].includes(profile?.role)) {
      return loginRedirect(request, true, roleRequired)
    }

    if (profile.role !== roleRequired) {
      const url = request.nextUrl.clone()
      url.pathname = dashboardFor(profile.role)
      url.search = ''
      const response = NextResponse.redirect(url)
      return setSessionCookies(response, token, refreshToken, refreshedSession?.expires_in, profile, tokenPayload.sub)
    }
    const response = NextResponse.next()
    return setSessionCookies(response, token, refreshToken, refreshedSession?.expires_in, profile, tokenPayload.sub)
  } catch {
    return loginRedirect(request, true, roleRequired)
  }
}

export const config = {
  matcher: ['/admin/:path*', '/owner/:path*', '/tenant/:path*'],
}
