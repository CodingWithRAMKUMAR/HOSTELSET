const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'profilePhotos.js')

function loadProfilePhotos({
  supabase,
  fetchImpl,
  DateImpl = Date,
}) {
  let source = fs.readFileSync(helperPath, 'utf8')

  const importStatement =
    "import { supabase } from './supabase'"

  if (source.split(importStatement).length - 1 !== 1) {
    throw new Error(
      'Expected exactly one Supabase import in profilePhotos.js'
    )
  }

  source = source.replace(
    importStatement,
    'const supabase = __deps.supabase'
  )
  source = source.replace(
    /export async function /g,
    'async function '
  )
  source = source.replace(
    /export function /g,
    'function '
  )
  source = source.replace(
    /export const /g,
    'const '
  )

  source += [
    '',
    'module.exports = {',
    '  PROFILE_PHOTO_TYPES,',
    '  PROFILE_PHOTO_MAX_BYTES,',
    '  validateProfilePhotoFile,',
    '  uploadProfilePhotoWithSignedUrl,',
    '  createBoundedPhotoUrlCache,',
    '}',
    '',
  ].join('\n')

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __deps: { supabase },
    fetch: fetchImpl,
    Date: DateImpl,
    Map,
    Promise,
    Error,
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports
}

function createSupabaseDouble({
  session = { access_token: 'test-access-token' },
  sessionError = null,
  uploadError = null,
} = {}) {
  const calls = {
    getSession: 0,
    storageBuckets: [],
    uploads: [],
  }

  return {
    calls,

    supabase: {
      auth: {
        async getSession() {
          calls.getSession += 1
          return {
            data: { session },
            error: sessionError,
          }
        },
      },

      storage: {
        from(bucket) {
          calls.storageBuckets.push(bucket)

          return {
            async uploadToSignedUrl(
              path,
              token,
              file,
              options
            ) {
              calls.uploads.push({
                path,
                token,
                file,
                options,
              })

              return { error: uploadError }
            },
          }
        },
      },
    },
  }
}

function createResponse({
  ok,
  body,
  jsonError = null,
}) {
  return {
    ok,

    async json() {
      if (jsonError) throw jsonError
      return body
    },
  }
}

;(async () => {
  const basicSupabase = createSupabaseDouble()
  const {
    PROFILE_PHOTO_TYPES,
    PROFILE_PHOTO_MAX_BYTES,
    validateProfilePhotoFile,
  } = loadProfilePhotos({
    supabase: basicSupabase.supabase,
    fetchImpl: async () => {
      throw new Error('fetch must not run during validation tests')
    },
  })

  assert.deepEqual(
    [...PROFILE_PHOTO_TYPES],
    ['image/jpeg', 'image/png', 'image/webp']
  )
  assert.equal(PROFILE_PHOTO_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(validateProfilePhotoFile(null), null)

  for (const type of PROFILE_PHOTO_TYPES) {
    assert.equal(
      validateProfilePhotoFile({ type, size: 1 }),
      null
    )
    assert.equal(
      validateProfilePhotoFile({
        type,
        size: PROFILE_PHOTO_MAX_BYTES,
      }),
      null
    )
  }

  for (const type of [
    '',
    'image/jpg',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'IMAGE/JPEG',
  ]) {
    assert.equal(
      validateProfilePhotoFile({ type, size: 1024 }),
      'Profile photo must be a JPEG, PNG, or WebP image.'
    )
  }

  for (const size of [
    undefined,
    null,
    NaN,
    Infinity,
    -1,
    0,
    1.5,
    '1024',
    PROFILE_PHOTO_MAX_BYTES + 1,
  ]) {
    assert.equal(
      validateProfilePhotoFile({
        type: 'image/png',
        size,
      }),
      'Profile photo must be under 5MB.',
      'profile photo size must be a finite whole-byte value within the limit'
    )
  }

  console.log('ok - profile photo file validation enforces exact boundaries')

  const uploadSupabase = createSupabaseDouble()
  const fetchCalls = []
  const preparedUpload = {
    path: 'property/profile-photos/tenant/avatar.png',
    token: 'signed-upload-token',
  }

  const { uploadProfilePhotoWithSignedUrl } =
    loadProfilePhotos({
      supabase: uploadSupabase.supabase,
      fetchImpl: async (endpoint, options) => {
        fetchCalls.push({ endpoint, options })

        return createResponse({
          ok: true,
          body: preparedUpload,
        })
      },
    })

  const file = {
    type: 'image/png',
    size: 2048,
    name: 'avatar.png',
  }

  const uploadedPath =
    await uploadProfilePhotoWithSignedUrl(
      '/api/tenant/profile-photo',
      file,
      {
        tenantId: 'tenant-1',
        action: 'incorrect-action',
        contentType: 'image/gif',
        size: 999999,
      }
    )

  assert.equal(uploadedPath, preparedUpload.path)
  assert.equal(uploadSupabase.calls.getSession, 1)
  assert.equal(fetchCalls.length, 1)
  assert.equal(
    fetchCalls[0].endpoint,
    '/api/tenant/profile-photo'
  )
  assert.equal(fetchCalls[0].options.method, 'POST')
  assert.equal(
    fetchCalls[0].options.headers['Content-Type'],
    'application/json'
  )
  assert.equal(
    fetchCalls[0].options.headers.Authorization,
    'Bearer test-access-token'
  )

  const requestBody = JSON.parse(fetchCalls[0].options.body)

  assert.deepEqual(requestBody, {
    tenantId: 'tenant-1',
    action: 'upload-url',
    contentType: 'image/png',
    size: 2048,
  })

  assert.deepEqual(
    uploadSupabase.calls.storageBuckets,
    ['tenant-documents']
  )
  assert.equal(uploadSupabase.calls.uploads.length, 1)
  assert.equal(
    uploadSupabase.calls.uploads[0].path,
    preparedUpload.path
  )
  assert.equal(
    uploadSupabase.calls.uploads[0].token,
    preparedUpload.token
  )
  assert.equal(uploadSupabase.calls.uploads[0].file, file)
  assert.equal(
    uploadSupabase.calls.uploads[0].options.contentType,
    'image/png'
  )

  console.log('ok - signed upload preserves authentication and trusted metadata')

  const missingSessionSupabase = createSupabaseDouble({
    session: null,
  })
  let missingSessionFetchCalls = 0

  const missingSessionHelpers = loadProfilePhotos({
    supabase: missingSessionSupabase.supabase,
    fetchImpl: async () => {
      missingSessionFetchCalls += 1
      throw new Error('fetch must not run without a session')
    },
  })

  await assert.rejects(
    missingSessionHelpers.uploadProfilePhotoWithSignedUrl(
      '/api/tenant/profile-photo',
      file
    ),
    /Please log in again/
  )

  assert.equal(missingSessionSupabase.calls.getSession, 1)
  assert.equal(missingSessionFetchCalls, 0)
  assert.equal(missingSessionSupabase.calls.uploads.length, 0)

  console.log('ok - missing sessions stop before API and storage calls')

  const apiFailureSupabase = createSupabaseDouble()
  const apiFailureHelpers = loadProfilePhotos({
    supabase: apiFailureSupabase.supabase,
    fetchImpl: async () =>
      createResponse({
        ok: false,
        body: { error: 'Upload permission denied.' },
      }),
  })

  await assert.rejects(
    apiFailureHelpers.uploadProfilePhotoWithSignedUrl(
      '/api/tenant/profile-photo',
      file
    ),
    /Upload permission denied/
  )

  assert.equal(apiFailureSupabase.calls.uploads.length, 0)

  const invalidJsonSupabase = createSupabaseDouble()
  const invalidJsonHelpers = loadProfilePhotos({
    supabase: invalidJsonSupabase.supabase,
    fetchImpl: async () =>
      createResponse({
        ok: false,
        jsonError: new Error('invalid JSON response'),
      }),
  })

  await assert.rejects(
    invalidJsonHelpers.uploadProfilePhotoWithSignedUrl(
      '/api/tenant/profile-photo',
      file
    ),
    /Could not prepare profile photo upload/
  )

  assert.equal(invalidJsonSupabase.calls.uploads.length, 0)

  console.log('ok - upload preparation failures remain user-safe')

  const storageError = new Error('storage upload failed')
  const storageFailureSupabase = createSupabaseDouble({
    uploadError: storageError,
  })
  const storageFailureHelpers = loadProfilePhotos({
    supabase: storageFailureSupabase.supabase,
    fetchImpl: async () =>
      createResponse({
        ok: true,
        body: preparedUpload,
      }),
  })

  await assert.rejects(
    storageFailureHelpers.uploadProfilePhotoWithSignedUrl(
      '/api/tenant/profile-photo',
      file
    ),
    error => error === storageError
  )

  assert.equal(storageFailureSupabase.calls.uploads.length, 1)

  console.log('ok - storage failures propagate to the caller')

  let cacheNow = 0
  const cacheHelpers = loadProfilePhotos({
    supabase: basicSupabase.supabase,
    fetchImpl: async () => {
      throw new Error('fetch must not run during cache tests')
    },
    DateImpl: {
      now: () => cacheNow,
    },
  })

  let successCacheCalls = 0
  const successCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const loadSuccessfulValue = async () => {
    successCacheCalls += 1
    return `signed-url-${successCacheCalls}`
  }

  assert.equal(
    await successCache.getBatch('photo', loadSuccessfulValue),
    'signed-url-1'
  )
  assert.equal(
    await successCache.getBatch('photo', loadSuccessfulValue),
    'signed-url-1'
  )
  assert.equal(successCacheCalls, 1)

  cacheNow = 239999
  assert.equal(
    await successCache.getBatch('photo', loadSuccessfulValue),
    'signed-url-1'
  )
  cacheNow = 240000
  assert.equal(
    await successCache.getBatch('photo', loadSuccessfulValue),
    'signed-url-2'
  )
  assert.equal(successCacheCalls, 2)

  console.log('ok - successful photo URLs use the four-minute TTL')

  cacheNow = 0
  let missingCacheCalls = 0
  const missingCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const loadMissingValue = async () => {
    missingCacheCalls += 1
    return null
  }

  assert.equal(
    await missingCache.getBatch('missing', loadMissingValue),
    null
  )
  cacheNow = 89999
  assert.equal(
    await missingCache.getBatch('missing', loadMissingValue),
    null
  )
  assert.equal(missingCacheCalls, 1)
  cacheNow = 90000
  assert.equal(
    await missingCache.getBatch('missing', loadMissingValue),
    null
  )
  assert.equal(missingCacheCalls, 2)

  console.log('ok - missing photo URLs use the bounded negative TTL')

  let resolveSharedValue
  let concurrentLoaderCalls = 0
  const sharedValue = new Promise(resolve => {
    resolveSharedValue = resolve
  })
  const concurrentCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const loadSharedValue = async () => {
    concurrentLoaderCalls += 1
    return sharedValue
  }

  const firstConcurrentRequest =
    concurrentCache.getBatch('same-photo', loadSharedValue)
  const secondConcurrentRequest =
    concurrentCache.getBatch('same-photo', loadSharedValue)

  assert.equal(concurrentLoaderCalls, 1)
  resolveSharedValue('shared-signed-url')
  assert.deepEqual(
    await Promise.all([
      firstConcurrentRequest,
      secondConcurrentRequest,
    ]),
    ['shared-signed-url', 'shared-signed-url']
  )

  console.log('ok - concurrent photo URL requests are deduplicated')

  let retryCalls = 0
  const retryCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const failThenRecover = async () => {
    retryCalls += 1
    if (retryCalls === 1) {
      throw new Error('expected photo loader failure')
    }
    return 'recovered-signed-url'
  }

  await assert.rejects(
    retryCache.getBatch('photo', failThenRecover),
    /expected photo loader failure/
  )
  assert.equal(
    await retryCache.getBatch('photo', failThenRecover),
    'recovered-signed-url'
  )
  assert.equal(retryCalls, 2)

  console.log('ok - rejected photo loaders can retry')

  let evictionCalls = 0
  const evictionCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const loadEvictionValue = key => async () => {
    evictionCalls += 1
    return `${key}-${evictionCalls}`
  }

  assert.equal(
    await evictionCache.getBatch(
      'first',
      loadEvictionValue('first')
    ),
    'first-1'
  )
  assert.equal(
    await evictionCache.getBatch(
      'second',
      loadEvictionValue('second')
    ),
    'second-2'
  )
  assert.equal(
    await evictionCache.getBatch(
      'third',
      loadEvictionValue('third')
    ),
    'third-3'
  )
  assert.equal(
    await evictionCache.getBatch(
      'second',
      loadEvictionValue('unexpected-second')
    ),
    'second-2'
  )
  assert.equal(
    await evictionCache.getBatch(
      'first',
      loadEvictionValue('first')
    ),
    'first-4'
  )
  assert.equal(evictionCalls, 4)

  console.log('ok - photo URL cache evicts beyond its entry limit')

  let clearCalls = 0
  const clearCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)
  const loadClearValue = async () => {
    clearCalls += 1
    return `clear-value-${clearCalls}`
  }

  assert.equal(
    await clearCache.getBatch('photo', loadClearValue),
    'clear-value-1'
  )
  clearCache.clear()
  assert.equal(
    await clearCache.getBatch('photo', loadClearValue),
    'clear-value-2'
  )
  assert.equal(clearCalls, 2)

  console.log('ok - clearing the photo URL cache invalidates values')

  let resolveStaleValue
  let markStaleStarted
  const staleStarted = new Promise(resolve => {
    markStaleStarted = resolve
  })
  const staleValue = new Promise(resolve => {
    resolveStaleValue = resolve
  })
  const raceCache =
    cacheHelpers.createBoundedPhotoUrlCache(2)

  const staleRequest = raceCache.getBatch(
    'photo',
    async () => {
      markStaleStarted()
      return staleValue
    }
  )

  await staleStarted
  raceCache.clear()
  assert.equal(
    await raceCache.getBatch(
      'photo',
      async () => 'fresh-signed-url'
    ),
    'fresh-signed-url'
  )

  resolveStaleValue('stale-signed-url')
  assert.equal(await staleRequest, 'stale-signed-url')
  assert.equal(
    await raceCache.getBatch(
      'photo',
      async () => 'unexpected-signed-url'
    ),
    'fresh-signed-url',
    'stale profile photo cache requests must not overwrite refreshed values'
  )

  console.log('ok - cleared in-flight photo URL requests stay stale')
  console.log('Profile photo client helper tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
