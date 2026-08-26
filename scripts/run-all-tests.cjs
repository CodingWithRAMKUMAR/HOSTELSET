const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '..')
const isWindows = process.platform === 'win32'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'
const npxCommand = isWindows ? 'npx.cmd' : 'npx'
const dockerCommand = isWindows ? 'docker.exe' : 'docker'
const gitCommand = isWindows ? 'git.exe' : 'git'
const results = []

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function recordFailure(name, message, startedAt) {
  const durationMs = Date.now() - startedAt

  console.error(`\nFAIL - ${name}`)
  console.error(message)

  results.push({
    name,
    passed: false,
    durationMs,
  })
}

function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now()

  console.log('\n' + '='.repeat(72))
  console.log(`RUN  - ${name}`)
  console.log('='.repeat(72))

  const requiresWindowsShell =
    isWindows && /\.(cmd|bat)$/i.test(command)
  let executable = command
  let executableArgs = args

  if (requiresWindowsShell) {
    const commandParts = [command, ...args]
    const safePart = /^[a-zA-Z0-9@._:\\/-]+$/

    if (commandParts.some(part => !safePart.test(part))) {
      recordFailure(
        name,
        'Windows command contains unsupported characters',
        startedAt
      )
      return
    }

    executable = process.env.ComSpec || 'cmd.exe'
    executableArgs = [
      '/d',
      '/s',
      '/c',
      commandParts.join(' '),
    ]
  }

  const spawnOptions = {
    cwd: projectRoot,
    env: process.env,
    stdio: options.input
      ? ['pipe', 'inherit', 'inherit']
      : 'inherit',
  }

  if (options.input) {
    spawnOptions.input = options.input
  }

  const result = spawnSync(executable, executableArgs, spawnOptions)
  const durationMs = Date.now() - startedAt

  if (result.error) {
    recordFailure(
      name,
      `Could not start command: ${result.error.message}`,
      startedAt
    )
    return
  }

  const passed = result.status === 0

  console.log(
    `\n${passed ? 'PASS' : 'FAIL'} - ${name} (${formatDuration(durationMs)})`
  )

  results.push({
    name,
    passed,
    durationMs,
  })
}

function runNpmScript(name, script) {
  runCommand(name, npmCommand, ['run', script])
}

function readProjectId() {
  const configPath = path.join(
    projectRoot,
    'supabase',
    'config.toml'
  )
  const config = fs.readFileSync(configPath, 'utf8')
  const match = config.match(
    /^\s*project_id\s*=\s*"([^"]+)"\s*$/m
  )

  if (!match) {
    throw new Error(
      'Could not read project_id from supabase/config.toml'
    )
  }

  return match[1]
}

function runDatabaseTest(name, relativePath, containerName) {
  const filePath = path.join(projectRoot, relativePath)
  const startedAt = Date.now()

  if (!fs.existsSync(filePath)) {
    recordFailure(
      name,
      `Database test file is missing: ${relativePath}`,
      startedAt
    )
    return
  }

  const sql = fs.readFileSync(filePath)

  runCommand(
    name,
    dockerCommand,
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-P',
      'pager=off',
    ],
    { input: sql }
  )
}

console.log('HostelSet complete local validation')
console.log(`Node: ${process.version}`)
console.log(`Platform: ${process.platform}`)

let databaseContainer = 'supabase_db_hostelset'

try {
  databaseContainer = `supabase_db_${readProjectId()}`
} catch (error) {
  console.warn(
    `Could not derive the database container name: ${error.message}`
  )
  console.warn(
    `Using fallback container: ${databaseContainer}`
  )
}

runCommand(
  'Start or validate local Supabase',
  npxCommand,
  ['supabase@2.109.1', 'start']
)

runCommand(
  'Production dependency security audit',
  npmCommand,
  ['audit', '--audit-level', 'high', '--omit', 'dev']
)

runDatabaseTest(
  'Room-change rent database integration',
  'scripts/room-change-rent-db-tests.sql',
  databaseContainer
)

runDatabaseTest(
  'Rent reminder payment database integration',
  'scripts/rent-reminder-payment-db-tests.sql',
  databaseContainer
)

runDatabaseTest(
  'Approved vacate cancellation database integration',
  'scripts/vacate-cancellation-db-tests.sql',
  databaseContainer
)

runDatabaseTest(
  'Property membership guard database integration',
  'scripts/property-membership-guard-db-tests.sql',
  databaseContainer
)

runCommand(
  'Supabase database lint',
  npxCommand,
  [
    'supabase@2.109.1',
    'db',
    'lint',
    '--local',
    '--level',
    'warning',
  ]
)

runNpmScript('Rent and routing regression tests', 'test')
runNpmScript('Reliability tests', 'test:reliability')
runNpmScript('Monitoring logger tests', 'test:monitoring')
runNpmScript('Request context tests', 'test:request-context')
runNpmScript('Request telemetry tests', 'test:request-telemetry')
runNpmScript('Health endpoint tests', 'test:health')
runNpmScript('Public API security tests', 'test:api-security')
runNpmScript('Fetch timeout tests', 'test:fetch-timeout')
runNpmScript(
  'Profile photo client tests',
  'test:profile-photo-client'
)
runNpmScript('Application URL tests', 'test:app-url')
runNpmScript('Property slug tests', 'test:property-slug')
runNpmScript('Local Playwright tests', 'test:e2e')
runNpmScript('Production build', 'build')
runCommand(
  'Git whitespace validation',
  gitCommand,
  ['diff', '--check']
)
runNpmScript(
  'Automated coverage completeness audit',
  'test:coverage-audit:strict'
)

const passedResults = results.filter(result => result.passed)
const failedResults = results.filter(result => !result.passed)
const totalDurationMs = results.reduce(
  (total, result) => total + result.durationMs,
  0
)
const longestName = Math.max(
  ...results.map(result => result.name.length)
)

console.log('\n' + '='.repeat(72))
console.log('HOSTELSET VALIDATION SUMMARY')
console.log('='.repeat(72))

for (const result of results) {
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'}  ` +
    `${result.name.padEnd(longestName)}  ` +
    formatDuration(result.durationMs)
  )
}

console.log('-'.repeat(72))
console.log(
  `${passedResults.length}/${results.length} checks passed ` +
  `in ${formatDuration(totalDurationMs)}`
)

if (failedResults.length > 0) {
  console.error('\nFailed checks:')

  for (const result of failedResults) {
    console.error(`- ${result.name}`)
  }

  process.exitCode = 1
} else {
  console.log('\nAll HostelSet checks passed.')
}

const reportDirectory = path.join(projectRoot, 'qa-results')
fs.mkdirSync(reportDirectory, { recursive: true })
fs.writeFileSync(
  path.join(reportDirectory, 'validation-summary.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    passed: failedResults.length === 0,
    passedChecks: passedResults.length,
    failedChecks: failedResults.length,
    totalChecks: results.length,
    totalDurationMs,
    results,
  }, null, 2) + '\n'
)

console.log(
  '\nMachine-readable summary: qa-results/validation-summary.json'
)
