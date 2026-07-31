const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'server', 'appUrl.js')

function loadAppUrl(env = {}) {
  let source = fs.readFileSync(helperPath, 'utf8')

  source = source.replace(
    /export function /g,
    'function '
  )

  source += [
    '',
    'module.exports = {',
    '  getAppUrl,',
    '  getResetPasswordUrl,',
    '  getLoginUrl,',
    '}',
    '',
  ].join('\n')

  const sandbox = {
    module: { exports: {} },
    exports: {},
    process: {
      env: { ...env },
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports
}

function assertGeneratedUrls(env, expectedBase) {
  const {
    getAppUrl,
    getResetPasswordUrl,
    getLoginUrl,
  } = loadAppUrl(env)

  assert.equal(getAppUrl(), expectedBase)
  assert.equal(
    getResetPasswordUrl(),
    `${expectedBase}/reset-password`
  )
  assert.equal(
    getLoginUrl(),
    `${expectedBase}/login`
  )
}

assertGeneratedUrls(
  {},
  'https://www.hostelset.com'
)

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: '' },
  'https://www.hostelset.com'
)

console.log('ok - missing application URLs use the production default')

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: 'https://hostelset.com' },
  'https://www.hostelset.com'
)

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: 'https://www.hostelset.com/' },
  'https://www.hostelset.com'
)

console.log('ok - production application URLs are canonical')

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000/' },
  'http://127.0.0.1:3000'
)

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: 'https://staging.hostelset.com/' },
  'https://staging.hostelset.com'
)

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: 'https://example.com/app/' },
  'https://example.com/app'
)

console.log('ok - local, staging, and path-based application URLs are supported')

assertGeneratedUrls(
  { NEXT_PUBLIC_APP_URL: '   ' },
  'https://www.hostelset.com'
)

assertGeneratedUrls(
  {
    NEXT_PUBLIC_APP_URL:
      '  https://staging.hostelset.com///  ',
  },
  'https://staging.hostelset.com'
)

assertGeneratedUrls(
  {
    NEXT_PUBLIC_APP_URL:
      '  https://hostelset.com///  ',
  },
  'https://www.hostelset.com'
)

console.log('ok - application URL configuration is trimmed and normalized')
console.log('Application URL helper tests passed')
