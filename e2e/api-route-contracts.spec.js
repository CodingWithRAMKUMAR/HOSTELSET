const { test, expect } = require('@playwright/test')

// Keep this explicit so the dependency-free QA audit can count generated tests.
const GENERATED_TEST_CASE_COUNT = 31
void GENERATED_TEST_CASE_COUNT

const postOnlyRoutes = [
  { contract: '/api/admin/delete-tenant' },
  { contract: '/api/admin/send-renewal-email' },
  { contract: '/api/auth/resolve-phone' },
  { contract: '/api/import/submit' },
  { contract: '/api/import/upload-url' },
  { contract: '/api/owner/add-property' },
  { contract: '/api/owner/application-document-url' },
  { contract: '/api/owner/approve-existing-import' },
  { contract: '/api/owner/import-document-url' },
  { contract: '/api/owner/tenant-profile-photo-upload-url' },
  { contract: '/api/owner/tenant-profile-photo' },
  { contract: '/api/owner/tenant-profile-photos' },
  { contract: '/api/owner/tenants' },
  { contract: '/api/register-owner' },
  { contract: '/api/requests/approve' },
  { contract: '/api/requests/convert-reserved-prebooking' },
  { contract: '/api/tenant/profile-photo-upload-url' },
  { contract: '/api/tenant/profile-photo-url' },
  { contract: '/api/tenant/profile-photo' },
  { contract: '/api/visitor/check-identity' },
  { contract: '/api/visitor/submit' },
  { contract: '/api/visitor/upload-url' },
]

const getOnlyRoutes = [
  { contract: '/api/admin/global-search' },
  {
    contract: '/api/import/[token]',
    path: '/api/import/qa-invalid-token',
  },
  { contract: '/api/public/properties' },
  {
    contract: '/api/public/properties/[id]',
    path: '/api/public/properties/qa-invalid-property',
  },
]

const privateRoutes = new Set([
  ...postOnlyRoutes.map(route => route.contract),
  '/api/admin/global-search',
  '/api/import/[token]',
  '/api/auth/session',
])

function expectPrivateResponse(response, contract) {
  if (!privateRoutes.has(contract)) return

  expect(
    response.headers()['cache-control'],
    `${contract} must disable private API caching`
  ).toMatch(/no-store/i)
}

for (const route of postOnlyRoutes) {
  test(`${route.contract} rejects GET without side effects`, async ({
    request,
  }) => {
    const response = await request.get(route.path || route.contract)

    expect(response.status()).toBe(405)
    expect(response.headers().allow || '').toContain('POST')
    expectPrivateResponse(response, route.contract)
  })
}

for (const route of getOnlyRoutes) {
  test(`${route.contract} rejects POST without side effects`, async ({
    request,
  }) => {
    const response = await request.post(route.path || route.contract, {
      data: {},
    })

    expect(response.status()).toBe(405)
    expect(response.headers().allow || '').toContain('GET')
    expectPrivateResponse(response, route.contract)
  })
}

test('/api/auth/session rejects unsupported methods', async ({ request }) => {
  const response = await request.get('/api/auth/session')

  expect(response.status()).toBe(405)
  expect(response.headers().allow || '').toContain('POST')
  expect(response.headers().allow || '').toContain('DELETE')
  expectPrivateResponse(response, '/api/auth/session')
})

for (const route of ['/api/health', '/api/ready']) {
  test(`${route} rejects POST and advertises GET`, async ({ request }) => {
    const response = await request.post(route, { data: {} })

    expect(response.status()).toBe(405)
    expect(response.headers().allow || '').toContain('GET')
    expect(response.headers()['cache-control'] || '').toMatch(/no-store/i)
  })
}

test('/api/health returns safe liveness data', async ({ request }) => {
  const response = await request.get('/api/health')
  const body = await response.json()

  expect(response.status()).toBe(200)
  expect(body.status).toBe('ok')
  expect(body.service).toBe('HostelSet')
  expect(body.requestId).toBeTruthy()
  expect(body).not.toHaveProperty('environment')
  expect(body).not.toHaveProperty('databaseUrl')
})

test('/api/ready returns a bounded readiness contract', async ({ request }) => {
  const response = await request.get('/api/ready')
  const body = await response.json()

  expect([200, 503]).toContain(response.status())
  expect(['ready', 'not_ready']).toContain(body.status)
  expect(body.requestId).toBeTruthy()
  expect(body).not.toHaveProperty('error')
  expect(body).not.toHaveProperty('stack')
})
