const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const helperPath = path.join(
  __dirname,
  '..',
  'lib',
  'server',
  'requestTelemetry.js'
)

function loadTelemetry({ nowValues = [1000], warnCalls, errorCalls }) {
  let source = fs.readFileSync(helperPath, 'utf8')

  source = source.replace(
    "import { logger } from '../logger'",
    'const { logger } = globalThis.__dependencies'
  )

  source = source.replace(
    'export function attachRequestTelemetry',
    'function attachRequestTelemetry'
  )

  source += '\nmodule.exports = { attachRequestTelemetry }\n'

  let nowIndex = 0

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dependencies: {
      logger: {
        warn(message, context) {
          warnCalls.push({ message, context })
        },
        error(message, error, context) {
          errorCalls.push({ message, error, context })
        },
      },
    },
    Date: {
      now() {
        const index = Math.min(nowIndex, nowValues.length - 1)
        const value = nowValues[index]
        nowIndex += 1
        return value
      },
    },
    Number,
    Error,
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports.attachRequestTelemetry
}

function createResponse(statusCode = 200) {
  const listeners = new Map()

  return {
    statusCode,

    once(event, callback) {
      listeners.set(event, callback)
    },

    emit(event) {
      const callback = listeners.get(event)

      if (!callback) return

      listeners.delete(event)
      callback()
    },
  }
}

function createHarness({
  nowValues,
  statusCode = 200,
  method = 'GET',
  url = '/api/test',
  route = '/api/test',
  requestId = 'request-123',
  slowRequestMs,
} = {}) {
  const warnCalls = []
  const errorCalls = []

  const attachRequestTelemetry = loadTelemetry({
    nowValues,
    warnCalls,
    errorCalls,
  })

  const req = { method, url }
  const res = createResponse(statusCode)

  const telemetry = attachRequestTelemetry(req, res, {
    route,
    requestId,
    ...(slowRequestMs === undefined ? {} : { slowRequestMs }),
  })

  return {
    req,
    res,
    telemetry,
    warnCalls,
    errorCalls,
  }
}

{
  const harness = createHarness({
    nowValues: [1000, 1100],
    statusCode: 200,
    slowRequestMs: 1500,
  })

  harness.res.emit('finish')

  assert.equal(harness.warnCalls.length, 0)
  assert.equal(harness.errorCalls.length, 0)

  console.log('ok - fast successful request produces no telemetry alert')
}

{
  const harness = createHarness({
    nowValues: [1000, 2600],
    statusCode: 200,
    slowRequestMs: 1500,
  })

  harness.res.emit('finish')

  assert.equal(harness.warnCalls.length, 1)
  assert.equal(harness.errorCalls.length, 0)

  assert.equal(harness.warnCalls[0].message, 'Slow API request')
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.warnCalls[0].context)),
    {
      route: '/api/test',
      method: 'GET',
      statusCode: 200,
      durationMs: 1600,
      requestId: 'request-123',
    }
  )

  console.log('ok - slow successful request produces one warning')
}

{
  const harness = createHarness({
    nowValues: [1000, 1200],
    statusCode: 503,
  })

  harness.res.emit('finish')

  assert.equal(harness.warnCalls.length, 0)
  assert.equal(harness.errorCalls.length, 1)

  assert.equal(
    harness.errorCalls[0].message,
    'API request completed with server error'
  )

  assert.equal(harness.errorCalls[0].error.message, 'HTTP 503')
  assert.equal(harness.errorCalls[0].context.statusCode, 503)
  assert.equal(harness.errorCalls[0].context.durationMs, 200)

  console.log('ok - server error response produces one error event')
}

{
  const harness = createHarness({
    nowValues: [1000, 3000, 4000],
    statusCode: 500,
  })

  harness.res.emit('finish')
  harness.res.emit('close')
  harness.telemetry.record()

  assert.equal(harness.errorCalls.length, 1)
  assert.equal(harness.warnCalls.length, 0)

  console.log('ok - finish, close, and manual record cannot duplicate telemetry')
}

{
  const harness = createHarness({
    nowValues: [5000, 5100],
    statusCode: 200,
    method: null,
    url: '/api/fallback-route',
    route: null,
  })

  harness.res.emit('close')

  assert.equal(harness.warnCalls.length, 0)
  assert.equal(harness.errorCalls.length, 0)
  assert.equal(harness.telemetry.startedAt, 5000)
  assert.equal(typeof harness.telemetry.record, 'function')

  console.log('ok - helper exposes startedAt and record safely')
}

{
  const harness = createHarness({
    nowValues: [1000, 3000],
    statusCode: 200,
    method: null,
    url: '/api/fallback-route',
    route: null,
    slowRequestMs: 1500,
  })

  harness.res.emit('finish')

  assert.equal(harness.warnCalls.length, 1)
  assert.equal(
    harness.warnCalls[0].context.route,
    '/api/fallback-route'
  )
  assert.equal(
    harness.warnCalls[0].context.method,
    'UNKNOWN'
  )

  console.log('ok - missing route and method use safe fallback values')
}

{
  const harness = createHarness({
    nowValues: [2000, 1000],
    statusCode: 200,
    slowRequestMs: 0,
  })

  harness.res.emit('finish')

  assert.equal(harness.warnCalls.length, 1)
  assert.equal(harness.warnCalls[0].context.durationMs, 0)

  console.log('ok - invalid negative elapsed time is normalized to zero')
}

{
  const harness = createHarness({
    nowValues: [1000, 3000],
    statusCode: 200,
    slowRequestMs: 1500,
  })

  harness.req.body = {
    email: 'private@example.com',
    phone: '9999999999',
    password: 'do-not-log',
    token: 'do-not-log',
  }

  harness.res.emit('finish')

  const serialized = JSON.stringify(harness.warnCalls)

  assert.equal(serialized.includes('private@example.com'), false)
  assert.equal(serialized.includes('9999999999'), false)
  assert.equal(serialized.includes('do-not-log'), false)

  console.log('ok - request body and sensitive values are not recorded')
}

console.log('Request telemetry tests passed')
