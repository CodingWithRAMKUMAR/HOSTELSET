const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'server', 'requestContext.js')

function loadRequestContext() {
  let source = fs.readFileSync(helperPath, 'utf8')

  source = source.replace(
    'export function getRequestId',
    'function getRequestId'
  )

  source = source.replace(
    'export function attachRequestContext',
    'function attachRequestContext'
  )

  source += '\nmodule.exports = { getRequestId, attachRequestContext }\n'

  const sandbox = {
    module: { exports: {} },
    exports: {},
    crypto: {
      randomUUID() {
        return '11111111-2222-4333-8444-555555555555'
      },
    },
    Date,
    Math,
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports
}

function responseRecorder() {
  const headers = {}

  return {
    headers,
    response: {
      setHeader(name, value) {
        headers[name] = value
      },
    },
  }
}

const { getRequestId, attachRequestContext } = loadRequestContext()

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': 'client-request-123',
    },
  }),
  'client-request-123'
)

console.log('ok - valid incoming request ID is preserved')

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': '  trimmed-request-id  ',
    },
  }),
  'trimmed-request-id'
)

console.log('ok - surrounding whitespace is removed')

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': ['first-request-id', 'second-request-id'],
    },
  }),
  'first-request-id'
)

console.log('ok - first request ID is used when header is an array')

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': 'invalid request id with spaces',
    },
  }),
  '11111111-2222-4333-8444-555555555555'
)

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': 'malicious\r\nheader',
    },
  }),
  '11111111-2222-4333-8444-555555555555'
)

assert.equal(
  getRequestId({
    headers: {
      'x-request-id': 'a'.repeat(129),
    },
  }),
  '11111111-2222-4333-8444-555555555555'
)

console.log('ok - malformed and oversized request IDs are replaced')

assert.equal(
  getRequestId({ headers: {} }),
  '11111111-2222-4333-8444-555555555555'
)

console.log('ok - missing request ID receives a generated UUID')

const recorder = responseRecorder()

const attachedRequestId = attachRequestContext(
  {
    headers: {
      'x-request-id': 'attached-request-456',
    },
  },
  recorder.response
)

assert.equal(attachedRequestId, 'attached-request-456')
assert.equal(
  recorder.headers['X-Request-ID'],
  'attached-request-456'
)

console.log('ok - response receives the matching X-Request-ID header')

const propertiesSource = fs.readFileSync(
  path.join(root, 'pages', 'api', 'public', 'properties.js'),
  'utf8'
)

assert.match(
  propertiesSource,
  /const requestId = attachRequestContext\(req, res\)/
)

assert.match(
  propertiesSource,
  /getProperties\(requestId\)/
)

assert.match(
  propertiesSource,
  /startBackgroundRefresh\(requestId\)/
)

assert.match(
  propertiesSource,
  /route: '\/api\/public\/properties',\s+requestId,/
)

console.log('ok - public properties API propagates request correlation')

const detailsSource = fs.readFileSync(
  path.join(root, 'pages', 'api', 'public', 'properties', '[id].js'),
  'utf8'
)

assert.match(
  detailsSource,
  /const requestId = attachRequestContext\(req, res\)/
)

assert.match(
  detailsSource,
  /getPropertyDetails\(identifier, requestId\)/
)

assert.match(
  detailsSource,
  /fetchFreshPropertyDetails\(identifier, requestId\)/
)

assert.match(
  detailsSource,
  /fetchSimilarProperties\(supabase, property, requestId\)/
)

assert.match(
  detailsSource,
  /route: '\/api\/public\/properties\/\[id\]',\s+requestId,/
)

console.log('ok - property-details API propagates request correlation')
console.log('Request context tests passed')