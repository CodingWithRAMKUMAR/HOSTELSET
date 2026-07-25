const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const loggerPath = path.join(__dirname, '..', 'lib', 'logger.js')

function loadLogger({ dsn, fetchImpl }) {
  let source = fs.readFileSync(loggerPath, 'utf8')

  const exportDeclaration = 'export const logger ='

  assert.equal(
    source.includes(exportDeclaration),
    true,
    'logger export declaration must exist'
  )

  source = source.replace(exportDeclaration, 'const logger =')
  source += '\nmodule.exports = { logger }\n'

  const sandbox = {
    module: { exports: {} },
    exports: {},
    URL,
    process: {
      env: {
        NODE_ENV: 'test',
        SENTRY_DSN: dsn || '',
      },
    },
    crypto: {
      randomUUID() {
        return '11111111-2222-4333-8444-555555555555'
      },
    },
    fetch: fetchImpl,
    console: {
      error() {},
      warn() {},
      info() {},
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: loggerPath })

  return sandbox.module.exports.logger
}

async function run() {
  let fetchCalls = 0

  const loggerWithoutDsn = loadLogger({
    dsn: '',
    fetchImpl: async () => {
      fetchCalls += 1
      return { ok: true }
    },
  })

  const missingDsnResult = await loggerWithoutDsn.error(
    'Missing DSN test',
    new Error('Expected test error'),
    { route: '/test' }
  )

  assert.equal(missingDsnResult, false)
  assert.equal(fetchCalls, 0)

  console.log('ok - missing DSN does not attempt external delivery')

  let deliveredRequest = null

  const loggerWithDsn = loadLogger({
    dsn: 'https://public-key@example.test/12345',
    fetchImpl: async (url, options) => {
      deliveredRequest = { url, options }
      return { ok: true }
    },
  })

  const deliveryResult = await loggerWithDsn.error(
    'Monitoring delivery test',
    new Error('Synthetic monitoring failure'),
    {
      route: '/api/test',
      authorization: 'Bearer should-not-appear',
      nested: {
        password: 'should-not-appear',
        apiKey: 'should-not-appear',
        visible: 'safe-value',
      },
    }
  )

  assert.equal(deliveryResult, true)
  assert.ok(deliveredRequest)

  assert.equal(
    deliveredRequest.url,
    'https://example.test/api/12345/envelope/'
  )

  assert.equal(deliveredRequest.options.method, 'POST')

  assert.equal(
    deliveredRequest.options.headers['Content-Type'],
    'application/x-sentry-envelope'
  )

  assert.match(
    deliveredRequest.options.headers['X-Sentry-Auth'],
    /sentry_key=public-key/
  )

  const envelopeLines = deliveredRequest.options.body.split('\n')

  assert.equal(envelopeLines.length, 3)

  const envelopeHeader = JSON.parse(envelopeLines[0])
  const envelopeItem = JSON.parse(envelopeLines[1])
  const payload = JSON.parse(envelopeLines[2])

  assert.equal(
    envelopeHeader.event_id,
    '11111111222243338444555555555555'
  )

  assert.equal(envelopeItem.type, 'event')
  assert.equal(payload.level, 'error')
  assert.equal(payload.message, 'Monitoring delivery test')
  assert.equal(payload.contexts.hostelset.route, '/api/test')

  assert.equal(
    payload.contexts.hostelset.authorization,
    '[redacted]'
  )

  assert.equal(
    payload.contexts.hostelset.nested.password,
    '[redacted]'
  )

  assert.equal(
    payload.contexts.hostelset.nested.apiKey,
    '[redacted]'
  )

  assert.equal(
    payload.contexts.hostelset.nested.visible,
    'safe-value'
  )

  assert.equal(
    deliveredRequest.options.body.includes('should-not-appear'),
    false
  )

  console.log('ok - Sentry envelope and endpoint are constructed correctly')
  console.log('ok - sensitive context fields are redacted')

  const loggerWithRejectedResponse = loadLogger({
    dsn: 'https://public-key@example.test/12345',
    fetchImpl: async () => ({ ok: false }),
  })

  const rejectedResponseResult =
    await loggerWithRejectedResponse.error(
      'Rejected response test',
      new Error('Synthetic rejected response')
    )

  assert.equal(rejectedResponseResult, false)

  console.log('ok - non-success HTTP response reports delivery failure')

  const loggerWithNetworkFailure = loadLogger({
    dsn: 'https://public-key@example.test/12345',
    fetchImpl: async () => {
      throw new Error('Synthetic network failure')
    },
  })

  const networkFailureResult =
    await loggerWithNetworkFailure.error(
      'Network failure test',
      new Error('Synthetic network failure')
    )

  assert.equal(networkFailureResult, false)

  console.log('ok - network failure is safely contained')

  let warningPayload = null

  const warningLogger = loadLogger({
    dsn: 'https://public-key@example.test/12345',
    fetchImpl: async (_url, options) => {
      warningPayload = JSON.parse(options.body.split('\n')[2])
      return { ok: true }
    },
  })

  const warningResult = await warningLogger.warn(
    'Synthetic warning',
    {
      route: '/api/test',
      token: 'should-not-appear',
    }
  )

  assert.equal(warningResult, true)
  assert.equal(warningPayload.level, 'warning')
  assert.equal(warningPayload.exception, undefined)

  assert.equal(
    warningPayload.contexts.hostelset.token,
    '[redacted]'
  )

  console.log('ok - warning events use warning severity and redaction')
  console.log('Monitoring logger tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})