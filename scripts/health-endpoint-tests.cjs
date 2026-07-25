const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

const healthPath = path.join(root, 'pages', 'api', 'health.js')
const readyPath = path.join(root, 'pages', 'api', 'ready.js')

const healthSource = fs.readFileSync(healthPath, 'utf8')
const readySource = fs.readFileSync(readyPath, 'utf8')

assert.match(
  healthSource,
  /const requestId = attachRequestContext\(req, res\)/
)

assert.match(
  healthSource,
  /res\.setHeader\('Cache-Control', 'no-store'\)/
)

assert.match(
  healthSource,
  /req\.method !== 'GET' && req\.method !== 'HEAD'/
)

assert.match(
  healthSource,
  /res\.status\(405\)\.json/
)

assert.match(
  healthSource,
  /status: 'ok'/
)

assert.match(
  healthSource,
  /service: 'HostelSet'/
)

assert.match(
  healthSource,
  /timestamp: new Date\(\)\.toISOString\(\)/
)

assert.match(
  healthSource,
  /requestId,/
)

console.log('ok - health endpoint exposes liveness information safely')

assert.match(
  readySource,
  /const requestId = attachRequestContext\(req, res\)/
)

assert.match(
  readySource,
  /res\.setHeader\('Cache-Control', 'no-store'\)/
)

assert.match(
  readySource,
  /'NEXT_PUBLIC_SUPABASE_URL'/
)

assert.match(
  readySource,
  /'NEXT_PUBLIC_SUPABASE_ANON_KEY'/
)

assert.match(
  readySource,
  /'SUPABASE_SERVICE_ROLE_KEY'/
)

assert.match(
  readySource,
  /\.from\('users'\)/
)

assert.match(
  readySource,
  /\.select\('id'\)/
)

assert.match(
  readySource,
  /\.limit\(1\)/
)

assert.doesNotMatch(
  readySource,
  /\.rpc\('version'\)/
)

assert.match(
  readySource,
  /status: 'ready'/
)

assert.match(
  readySource,
  /database: 'ok'/
)

assert.match(
  readySource,
  /res\.status\(503\)/
)

assert.match(
  readySource,
  /status: 'not_ready'/
)

assert.match(
  readySource,
  /logger\.error\('Readiness check failed'/
)

console.log('ok - readiness endpoint validates configuration and database access')
console.log('Health endpoint tests passed')
