import { logger } from '../logger'

const DEFAULT_SLOW_REQUEST_MS = 1500

function elapsedMilliseconds(startedAt) {
  const duration = Date.now() - startedAt

  return Number.isFinite(duration) && duration >= 0
    ? duration
    : 0
}

export function attachRequestTelemetry(
  req,
  res,
  {
    route,
    requestId,
    slowRequestMs = DEFAULT_SLOW_REQUEST_MS,
    reportServerErrors = true,
  } = {}
) {
  const startedAt = Date.now()
  let recorded = false

  const record = () => {
    if (recorded) return
    recorded = true

    const durationMs = elapsedMilliseconds(startedAt)
    const statusCode = Number(res.statusCode || 200)

    const context = {
      route: route || req.url || 'unknown',
      method: req.method || 'UNKNOWN',
      statusCode,
      durationMs,
      requestId,
    }

    if (statusCode >= 500) {
      if (reportServerErrors) {
        logger.error(
          'API request completed with server error',
          new Error(`HTTP ${statusCode}`),
          context
        )
      }

      return
    }

    if (durationMs >= slowRequestMs) {
      logger.warn('Slow API request', context)
    }
  }

  res.once('finish', record)
  res.once('close', record)

  return {
    startedAt,
    record,
  }
}
