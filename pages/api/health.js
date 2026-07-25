import { attachRequestContext } from '../../lib/server/requestContext'

export default function handler(req, res) {
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

  if (req.method === 'HEAD') {
    return res.status(200).end()
  }

  return res.status(200).json({
    status: 'ok',
    service: 'HostelSet',
    timestamp: new Date().toISOString(),
    requestId,
  })
}
