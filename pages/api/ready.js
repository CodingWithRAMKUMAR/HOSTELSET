import { attachRequestContext } from '../../lib/server/requestContext'
import { supabaseAdmin } from '../../lib/server/supabaseAdmin'
import { logger } from '../../lib/logger'

export default async function handler(req, res) {
  const requestId = attachRequestContext(req, res)

  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', ['GET', 'HEAD'])

    return res.status(405).json({
      status: 'error',
      error: 'Method not allowed',
      requestId,
    })
  }

  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]

  const missing = requiredEnv.filter((name) => !process.env[name])

  if (missing.length || !supabaseAdmin) {
    logger.error(
      'Readiness check failed: missing configuration',
      new Error('Missing required environment configuration'),
      {
        route: '/api/ready',
        missing,
        requestId,
      }
    )

    return res.status(503).json({
      status: 'not_ready',
      reason: 'configuration',
      missing,
      requestId,
    })
  }

  const started = Date.now()

  try {
    const { error } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1)

    if (error) {
      throw error
    }

    const latencyMs = Date.now() - started

    if (req.method === 'HEAD') {
      return res.status(200).end()
    }

    return res.status(200).json({
      status: 'ready',
      service: 'HostelSet',
      database: 'ok',
      latencyMs,
      timestamp: new Date().toISOString(),
      requestId,
    })
  } catch (error) {
    logger.error('Readiness check failed', error, {
      route: '/api/ready',
      requestId,
    })

    if (req.method === 'HEAD') {
      return res.status(503).end()
    }

    return res.status(503).json({
      status: 'not_ready',
      database: 'failed',
      requestId,
    })
  }
}
