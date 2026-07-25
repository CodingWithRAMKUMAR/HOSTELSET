const REQUEST_ID_HEADER = 'x-request-id'
const RESPONSE_REQUEST_ID_HEADER = 'X-Request-ID'
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function generateRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

export function getRequestId(req) {
  const suppliedRequestId = String(
    firstHeaderValue(req?.headers?.[REQUEST_ID_HEADER]) || ''
  ).trim()

  if (VALID_REQUEST_ID.test(suppliedRequestId)) {
    return suppliedRequestId
  }

  return generateRequestId()
}

export function attachRequestContext(req, res) {
  const requestId = getRequestId(req)

  res.setHeader(RESPONSE_REQUEST_ID_HEADER, requestId)

  return requestId
}