const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const net = require('node:net')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'server', 'publicApiSecurity.js')

function loadPublicApiSecurity({
  supabaseAdmin = null,
  logger = { error() {} },
  env = {},
} = {}) {
  let source = fs.readFileSync(helperPath, 'utf8')

  source = source.replace(
    "import crypto from 'crypto'",
    'const crypto = __deps.crypto'
  )
  source = source.replace(
    "import net from 'net'",
    'const net = __deps.net'
  )
  source = source.replace(
    "import { supabaseAdmin } from './supabaseAdmin'",
    'const supabaseAdmin = __deps.supabaseAdmin'
  )
  source = source.replace(
    "import { logger } from '../logger'",
    'const logger = __deps.logger'
  )
  source = source.replace(/export (async )?function /g, '$1function ')
  source += [
    '',
    'module.exports = {',
    '  getClientIp,',
    '  requireJson,',
    '  allowPostOnly,',
    '  enforceRateLimit,',
    '  setPrivateApiResponse,',
    '}',
    '',
  ].join('\n')

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __deps: {
      crypto,
      net,
      supabaseAdmin,
      logger,
    },
    process: {
      env: { ...env },
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports
}

function responseRecorder() {
  const headers = {}
  const response = {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value)
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }

  return { headers, response }
}

const {
  getClientIp,
  requireJson,
  allowPostOnly,
  setPrivateApiResponse,
} = loadPublicApiSecurity()

assert.equal(
  getClientIp({
    headers: {
      'x-vercel-forwarded-for': '203.0.113.10, 10.0.0.1',
      'x-forwarded-for': '198.51.100.20',
      'x-real-ip': '192.0.2.30',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }),
  '203.0.113.10'
)

assert.equal(
  getClientIp({
    headers: {
      'x-vercel-forwarded-for': 'not-an-ip',
      'x-forwarded-for': '198.51.100.20, 10.0.0.2',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }),
  '198.51.100.20'
)

assert.equal(
  getClientIp({
    headers: {
      'x-vercel-forwarded-for': '',
      'x-forwarded-for': '',
      'x-real-ip': '192.0.2.30',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }),
  '192.0.2.30'
)

assert.equal(
  getClientIp({
    headers: {},
    socket: { remoteAddress: '198.51.100.40:4321' },
  }),
  '198.51.100.40'
)

assert.equal(
  getClientIp({
    headers: {},
    socket: { remoteAddress: '[2001:db8::1]' },
  }),
  '2001:db8::1'
)

assert.equal(
  getClientIp({
    headers: {
      'x-vercel-forwarded-for': '999.999.999.999',
      'x-forwarded-for': 'invalid',
      'x-real-ip': 'also-invalid',
    },
    socket: { remoteAddress: 'unknown' },
  }),
  'unknown'
)

console.log('ok - client IP resolution follows trusted fallback order')

const postRecorder = responseRecorder()
assert.equal(
  allowPostOnly({ method: 'POST' }, postRecorder.response),
  true
)
assert.equal(postRecorder.response.statusCode, null)

const getRecorder = responseRecorder()
assert.equal(
  allowPostOnly({ method: 'GET' }, getRecorder.response),
  false
)
assert.equal(getRecorder.headers.allow, 'POST')
assert.equal(getRecorder.response.statusCode, 405)
assert.equal(getRecorder.response.body.error, 'Method not allowed')

console.log('ok - POST-only enforcement returns Allow and 405 correctly')

for (const contentType of [
  'application/json',
  'APPLICATION/JSON',
  'application/json; charset=utf-8',
]) {
  const recorder = responseRecorder()
  assert.equal(
    requireJson(
      { headers: { 'content-type': contentType } },
      recorder.response
    ),
    true
  )
  assert.equal(recorder.response.statusCode, null)
}

for (const contentType of [undefined, '', 'text/plain', 'multipart/form-data']) {
  const recorder = responseRecorder()
  const headers = contentType === undefined
    ? {}
    : { 'content-type': contentType }

  assert.equal(requireJson({ headers }, recorder.response), false)
  assert.equal(recorder.response.statusCode, 415)
  assert.equal(
    recorder.response.body.error,
    'Content-Type must be application/json'
  )
}

const misleadingJsonRecorder = responseRecorder()
assert.equal(
  requireJson(
    { headers: { 'content-type': 'application/jsonp' } },
    misleadingJsonRecorder.response
  ),
  false,
  'a MIME type that merely starts with application/json must be rejected'
)
assert.equal(misleadingJsonRecorder.response.statusCode, 415)

const jsonPatchRecorder = responseRecorder()
assert.equal(
  requireJson(
    { headers: { 'content-type': 'application/json-patch+json' } },
    jsonPatchRecorder.response
  ),
  false
)
assert.equal(jsonPatchRecorder.response.statusCode, 415)

console.log('ok - JSON content type matching is exact and parameter-aware')

const privateRecorder = responseRecorder()
setPrivateApiResponse(privateRecorder.response)
assert.equal(
  privateRecorder.headers['cache-control'],
  'no-store, max-age=0'
)

console.log('ok - private API responses disable caching')
function createRateLimitClient(result) {
  const calls = []
  return {
    calls,
    supabaseAdmin: {
      async rpc(name, args) {
        calls.push({ name, args })
        return result
      },
    },
  }
}

;(async () => {
  const secret = '12345678901234567890123456789012'
  const identifier = '203.0.113.10'
  const options = {
    scope: 'owner-registration-ip',
    identifier,
    limit: 5,
    windowSeconds: 3600,
  }

  const allowedClient = createRateLimitClient({
    data: [{ allowed: true, remaining: 4, retry_after: 60 }],
    error: null,
  })
  const { enforceRateLimit: enforceAllowedRateLimit } =
    loadPublicApiSecurity({
      supabaseAdmin: allowedClient.supabaseAdmin,
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: secret,
      },
    })
  const allowedRecorder = responseRecorder()
  assert.equal(
    await enforceAllowedRateLimit(
      {},
      allowedRecorder.response,
      options
    ),
    true
  )
  assert.equal(allowedClient.calls.length, 1)
  assert.equal(
    allowedClient.calls[0].name,
    'consume_public_api_rate_limit'
  )
  assert.equal(
    allowedClient.calls[0].args.p_scope,
    'owner-registration-ip'
  )
  assert.equal(allowedClient.calls[0].args.p_limit, 5)
  assert.equal(allowedClient.calls[0].args.p_window_seconds, 3600)
  assert.equal(
    allowedClient.calls[0].args.p_key_hash,
    crypto.createHmac('sha256', secret).update(identifier).digest('hex')
  )
  assert.notEqual(allowedClient.calls[0].args.p_key_hash, identifier)
  assert.match(
    allowedClient.calls[0].args.p_key_hash,
    /^[a-f0-9]{64}$/
  )
  assert.equal(allowedRecorder.headers['ratelimit-limit'], '5')
  assert.equal(allowedRecorder.headers['ratelimit-remaining'], '4')
  assert.equal(allowedRecorder.headers['ratelimit-reset'], '60')
  assert.equal(allowedRecorder.response.statusCode, null)

  console.log('ok - rate-limit identifiers are HMAC hashed')

  const blockedClient = createRateLimitClient({
    data: { allowed: false, remaining: 0, retry_after: 45 },
    error: null,
  })
  const { enforceRateLimit: enforceBlockedRateLimit } =
    loadPublicApiSecurity({
      supabaseAdmin: blockedClient.supabaseAdmin,
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: secret,
      },
    })
  const blockedRecorder = responseRecorder()
  assert.equal(
    await enforceBlockedRateLimit(
      {},
      blockedRecorder.response,
      options
    ),
    false
  )
  assert.equal(blockedRecorder.headers['ratelimit-limit'], '5')
  assert.equal(blockedRecorder.headers['ratelimit-remaining'], '0')
  assert.equal(blockedRecorder.headers['ratelimit-reset'], '45')
  assert.equal(blockedRecorder.headers['retry-after'], '45')
  assert.equal(blockedRecorder.response.statusCode, 429)
  assert.equal(
    blockedRecorder.response.body.error,
    'Too many requests. Please try again later.'
  )

  console.log('ok - blocked requests receive bounded rate-limit headers')

  const { enforceRateLimit: enforceWithoutSupabase } =
    loadPublicApiSecurity({
      supabaseAdmin: null,
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: secret,
      },
    })
  const missingSupabaseRecorder = responseRecorder()
  assert.equal(
    await enforceWithoutSupabase(
      {},
      missingSupabaseRecorder.response,
      options
    ),
    false
  )
  assert.equal(missingSupabaseRecorder.response.statusCode, 503)
  assert.equal(
    missingSupabaseRecorder.response.body.error,
    'Service temporarily unavailable'
  )

  const shortSecretLogs = []
  const shortSecretClient = createRateLimitClient({
    data: [{ allowed: true, remaining: 4, retry_after: 60 }],
    error: null,
  })
  const { enforceRateLimit: enforceWithShortSecret } =
    loadPublicApiSecurity({
      supabaseAdmin: shortSecretClient.supabaseAdmin,
      logger: {
        error(...args) {
          shortSecretLogs.push(args)
        },
      },
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: 'too-short',
      },
    })
  const shortSecretRecorder = responseRecorder()
  assert.equal(
    await enforceWithShortSecret(
      {},
      shortSecretRecorder.response,
      options
    ),
    false
  )
  assert.equal(shortSecretClient.calls.length, 0)
  assert.equal(shortSecretLogs.length, 1)
  assert.equal(shortSecretRecorder.response.statusCode, 503)
  assert.equal(
    shortSecretRecorder.response.body.error,
    'Service temporarily unavailable'
  )

  const rpcFailureLogs = []
  const rpcFailureClient = createRateLimitClient({
    data: null,
    error: new Error('database unavailable'),
  })
  const { enforceRateLimit: enforceWithRpcFailure } =
    loadPublicApiSecurity({
      supabaseAdmin: rpcFailureClient.supabaseAdmin,
      logger: {
        error(...args) {
          rpcFailureLogs.push(args)
        },
      },
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: secret,
      },
    })
  const rpcFailureRecorder = responseRecorder()
  assert.equal(
    await enforceWithRpcFailure(
      {},
      rpcFailureRecorder.response,
      options
    ),
    false
  )
  assert.equal(rpcFailureLogs.length, 1)
  assert.equal(rpcFailureLogs[0][0], 'Rate limiter failure')
  assert.equal(
    rpcFailureLogs[0][2].scope,
    'owner-registration-ip'
  )
  assert.equal(rpcFailureRecorder.response.statusCode, 503)
  assert.equal(
    rpcFailureRecorder.response.body.error,
    'Service temporarily unavailable'
  )

  const emptyResultClient = createRateLimitClient({
    data: null,
    error: null,
  })
  const { enforceRateLimit: enforceWithEmptyResult } =
    loadPublicApiSecurity({
      supabaseAdmin: emptyResultClient.supabaseAdmin,
      env: {
        NODE_ENV: 'production',
        API_RATE_LIMIT_SECRET: secret,
      },
    })
  const emptyResultRecorder = responseRecorder()
  assert.equal(
    await enforceWithEmptyResult(
      {},
      emptyResultRecorder.response,
      options
    ),
    false
  )
  assert.equal(emptyResultRecorder.response.statusCode, 503)
  assert.equal(
    emptyResultRecorder.response.body.error,
    'Service temporarily unavailable'
  )

  console.log('ok - rate-limit failures remain fail-closed')
  console.log('Public API security helper tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
