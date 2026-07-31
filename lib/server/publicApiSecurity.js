import crypto from 'crypto'
import net from 'net'
import { supabaseAdmin } from './supabaseAdmin'
import { logger } from '../logger'

function normalizeIp(value) {
  const candidate = String(value || '').split(',')[0].trim()
  const withoutBrackets = candidate.replace(/^\[|\]$/g, '')
  const withoutPort = withoutBrackets.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1')
  return net.isIP(withoutPort) ? withoutPort : null
}

export function getClientIp(req) {
  return normalizeIp(req.headers['x-vercel-forwarded-for'])
    || normalizeIp(req.headers['x-forwarded-for'])
    || normalizeIp(req.headers['x-real-ip'])
    || normalizeIp(req.socket?.remoteAddress)
    || 'unknown'
}

function rateLimitSecret() {
  const secret = process.env.API_RATE_LIMIT_SECRET
  if (!secret || secret.length < 32) throw new Error('API_RATE_LIMIT_SECRET must contain at least 32 characters')
  return secret
}

function digest(value) {
  return crypto.createHmac('sha256', rateLimitSecret()).update(String(value)).digest('hex')
}

export function requireJson(req, res) {
  const contentType = String(req.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    res.status(415).json({ error: 'Content-Type must be application/json' })
    return false
  }
  return true
}

export function allowPostOnly(req, res) {
  if (req.method === 'POST') return true
  res.setHeader('Allow', 'POST')
  res.status(405).json({ error: 'Method not allowed' })
  return false
}

export async function enforceRateLimit(req, res, { scope, identifier, limit, windowSeconds }) {
  if (!supabaseAdmin) {
    const message = process.env.NODE_ENV === 'production'
      ? 'Service temporarily unavailable'
      : 'Service temporarily unavailable: missing SUPABASE_SERVICE_ROLE_KEY'
    res.status(503).json({ error: message })
    return false
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('consume_public_api_rate_limit', {
      p_scope: scope,
      p_key_hash: digest(identifier),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) throw error

    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new Error('Rate limiter returned no result')

    res.setHeader('RateLimit-Limit', String(limit))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, Number(result.remaining || 0))))
    res.setHeader('RateLimit-Reset', String(Math.max(1, Number(result.retry_after || 1))))

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Number(result.retry_after || windowSeconds))))
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return false
    }
    return true
  } catch (error) {
    logger.error('Rate limiter failure', error, { scope })
    const message = process.env.NODE_ENV === 'production'
      ? 'Service temporarily unavailable'
      : `Rate limiter failure: ${error.message}`
    res.status(503).json({ error: message })
    return false
  }
}

export function setPrivateApiResponse(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
}
