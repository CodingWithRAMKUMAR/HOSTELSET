const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'fetchWithTimeout.js')

function loadFetchWithTimeout({
  fetchImpl,
  AbortControllerImpl = AbortController,
  setTimeoutImpl,
  clearTimeoutImpl,
}) {
  let source = fs.readFileSync(helperPath, 'utf8')

  const exportStatement =
    'export async function fetchWithTimeout'

  if (source.split(exportStatement).length - 1 !== 1) {
    throw new Error(
      'Expected exactly one fetchWithTimeout export in the source file'
    )
  }

  source = source.replace(
    exportStatement,
    'async function fetchWithTimeout'
  )

  source += [
    '',
    'module.exports = { fetchWithTimeout }',
    '',
  ].join('\n')

  const sandbox = {
    module: { exports: {} },
    exports: {},
    fetch: fetchImpl,
    AbortController: AbortControllerImpl,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports.fetchWithTimeout
}

function createTimerHarness() {
  const records = []
  let nextId = 1

  return {
    records,

    setTimeout(callback, delay) {
      const record = {
        id: nextId++,
        callback,
        delay,
        cleared: false,
        fired: false,
      }

      records.push(record)
      return record.id
    },

    clearTimeout(id) {
      const record = records.find(item => item.id === id)
      if (record) record.cleared = true
    },

    fireLatest() {
      const record = records.at(-1)

      if (!record) {
        throw new Error('No timeout was scheduled')
      }

      record.fired = true
      record.callback()
      return record
    },

    activeCount() {
      return records.filter(record =>
        !record.cleared && !record.fired
      ).length
    },
  }
}

function createTrackedExternalSignal() {
  const controller = new AbortController()
  let addedListeners = 0
  let removedListeners = 0

  const signal = {
    get aborted() {
      return controller.signal.aborted
    },

    addEventListener(type, listener, options) {
      addedListeners += 1
      controller.signal.addEventListener(type, listener, options)
    },

    removeEventListener(type, listener, options) {
      removedListeners += 1
      controller.signal.removeEventListener(type, listener, options)
    },
  }

  return {
    controller,
    signal,
    stats() {
      return { addedListeners, removedListeners }
    },
  }
}

function createAbortError(message = 'fetch aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function fetchUntilAbort(captured) {
  return async (input, options) => {
    captured.input = input
    captured.options = options

    return new Promise((resolve, reject) => {
      const rejectAsAborted = () => reject(createAbortError())

      if (options.signal.aborted) {
        rejectAsAborted()
        return
      }

      options.signal.addEventListener(
        'abort',
        rejectAsAborted,
        { once: true }
      )
    })
  }
}

;(async () => {
  const successTimers = createTimerHarness()
  const successExternal = createTrackedExternalSignal()
  const expectedResponse = { ok: true, status: 200 }
  let successRequest

  const successfulFetchWithTimeout = loadFetchWithTimeout({
    fetchImpl: async (input, options) => {
      successRequest = { input, options }
      return expectedResponse
    },
    setTimeoutImpl: successTimers.setTimeout,
    clearTimeoutImpl: successTimers.clearTimeout,
  })

  const successResponse = await successfulFetchWithTimeout(
    '/api/example',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
      cache: 'no-store',
      signal: successExternal.signal,
    }
  )

  assert.equal(successResponse, expectedResponse)
  assert.equal(successRequest.input, '/api/example')
  assert.equal(successRequest.options.method, 'POST')
  assert.deepEqual(
    successRequest.options.headers,
    { 'Content-Type': 'application/json' }
  )
  assert.equal(successRequest.options.body, '{"ok":true}')
  assert.equal(successRequest.options.cache, 'no-store')
  assert.notEqual(
    successRequest.options.signal,
    successExternal.signal,
    'fetch must receive the helper-owned abort signal'
  )
  assert.equal(successTimers.records.length, 1)
  assert.equal(successTimers.records[0].delay, 15000)
  assert.equal(successTimers.records[0].cleared, true)
  assert.equal(successTimers.activeCount(), 0)
  assert.deepEqual(successExternal.stats(), {
    addedListeners: 1,
    removedListeners: 1,
  })

  console.log('ok - successful requests preserve options and clean up')

  const timeoutTimers = createTimerHarness()
  const timeoutRequestDetails = {}

  const timingOutFetchWithTimeout = loadFetchWithTimeout({
    fetchImpl: fetchUntilAbort(timeoutRequestDetails),
    setTimeoutImpl: timeoutTimers.setTimeout,
    clearTimeoutImpl: timeoutTimers.clearTimeout,
  })

  const timeoutRequest = timingOutFetchWithTimeout(
    '/api/slow',
    { method: 'GET' },
    125
  )

  await Promise.resolve()

  assert.equal(timeoutTimers.records.length, 1)
  assert.equal(timeoutTimers.records[0].delay, 125)
  timeoutTimers.fireLatest()

  await assert.rejects(
    timeoutRequest,
    error =>
      error.message ===
      'The request timed out. Check your connection and try again.'
  )

  assert.equal(timeoutRequestDetails.options.signal.aborted, true)
  assert.equal(timeoutTimers.records[0].cleared, true)
  assert.equal(timeoutTimers.activeCount(), 0)

  console.log('ok - internal deadlines return the friendly timeout error')

  const externalTimers = createTimerHarness()
  const externalSignal = createTrackedExternalSignal()
  const externalRequestDetails = {}

  const externallyCancelledFetchWithTimeout = loadFetchWithTimeout({
    fetchImpl: fetchUntilAbort(externalRequestDetails),
    setTimeoutImpl: externalTimers.setTimeout,
    clearTimeoutImpl: externalTimers.clearTimeout,
  })

  const externalRequest = externallyCancelledFetchWithTimeout(
    '/api/cancelled',
    { signal: externalSignal.signal },
    5000
  )

  await Promise.resolve()
  externalSignal.controller.abort()

  await assert.rejects(
    externalRequest,
    error =>
      error.name === 'AbortError' &&
      error.message === 'fetch aborted'
  )

  assert.equal(externalRequestDetails.options.signal.aborted, true)
  assert.equal(externalTimers.records[0].cleared, true)
  assert.equal(externalTimers.activeCount(), 0)
  assert.deepEqual(externalSignal.stats(), {
    addedListeners: 1,
    removedListeners: 1,
  })

  console.log('ok - external cancellation remains distinct from timeout')

  const alreadyAbortedTimers = createTimerHarness()
  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  let receivedAbortedSignal = false

  const alreadyAbortedFetchWithTimeout = loadFetchWithTimeout({
    fetchImpl: async (input, options) => {
      receivedAbortedSignal = options.signal.aborted
      throw createAbortError('already cancelled')
    },
    setTimeoutImpl: alreadyAbortedTimers.setTimeout,
    clearTimeoutImpl: alreadyAbortedTimers.clearTimeout,
  })

  await assert.rejects(
    alreadyAbortedFetchWithTimeout(
      '/api/already-cancelled',
      { signal: alreadyAborted.signal }
    ),
    error =>
      error.name === 'AbortError' &&
      error.message === 'already cancelled'
  )

  assert.equal(receivedAbortedSignal, true)
  assert.equal(alreadyAbortedTimers.records[0].cleared, true)
  assert.equal(alreadyAbortedTimers.activeCount(), 0)

  console.log('ok - already-aborted external signals propagate correctly')

  const failureTimers = createTimerHarness()
  const failureExternal = createTrackedExternalSignal()
  const networkError = new Error('network unavailable')

  const failingFetchWithTimeout = loadFetchWithTimeout({
    fetchImpl: async () => {
      throw networkError
    },
    setTimeoutImpl: failureTimers.setTimeout,
    clearTimeoutImpl: failureTimers.clearTimeout,
  })

  await assert.rejects(
    failingFetchWithTimeout(
      '/api/network-failure',
      { signal: failureExternal.signal }
    ),
    error => error === networkError
  )

  assert.equal(failureTimers.records[0].cleared, true)
  assert.equal(failureTimers.activeCount(), 0)
  assert.deepEqual(failureExternal.stats(), {
    addedListeners: 1,
    removedListeners: 1,
  })

  console.log('ok - network failures propagate without losing cleanup')
  console.log('Fetch-with-timeout helper tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
