const REDACTED_KEYS = /authorization|cookie|password|token|secret|api[-_]?key|service[-_]?role/i

const sanitize = (value, depth = 0) => {
  if (depth > 4) return '[truncated]'
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value === 'string' ? value.slice(0, 2000) : value
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.slice(0, 8000) }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? '[redacted]' : sanitize(item, depth + 1)]))
  return String(value)
}

const sentryDsn = () => typeof window === 'undefined' ? process.env.SENTRY_DSN : process.env.NEXT_PUBLIC_SENTRY_DSN

const captureSentry = async (level, message, error, context) => {
  const dsn = sentryDsn()
  if (!dsn) return false
  try {
    const parsed = new URL(dsn)
    const projectId = parsed.pathname.replace(/^\//, '').split('/').pop()
    if (!parsed.username || !projectId) return false
    const eventId = globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}${Math.random().toString(16).slice(2)}`.slice(0, 32)
    const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`
    const payload = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level,
      message,
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV,
      exception: error ? { values: [{ type: error.name || 'Error', value: error.message || String(error), stacktrace: error.stack ? { frames: [{ filename: error.stack.slice(0, 8000) }] } : undefined }] } : undefined,
      contexts: { hostelset: sanitize(context || {}) },
    }
    const envelope = `${JSON.stringify({ event_id: eventId, dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(payload)}`
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${parsed.username}` }, body: envelope, keepalive: typeof window !== 'undefined' })
    return response.ok
  } catch {
    return false
  }
}

export const logger = {
  error(message, error, context) {
    const safeError = sanitize(error)
    const safeContext = sanitize(context || {})
    console.error(`[HostelSet] ${message}`, safeError, safeContext)
    return captureSentry('error', message, error instanceof Error ? error : new Error(error?.message || String(error || message)), safeContext)
  },
  warn(message, context) {
    const safeContext = sanitize(context || {})
    console.warn(`[HostelSet] ${message}`, safeContext)
    return captureSentry('warning', message, null, safeContext)
  },
  info(message, context) {
    if (process.env.NODE_ENV !== 'production') console.info(`[HostelSet] ${message}`, sanitize(context || {}))
  },
}
