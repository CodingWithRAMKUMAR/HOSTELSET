const { randomBytes } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const {
  getLocalSupabaseEnvironment,
} = require('./local-supabase-env.cjs')

const projectRoot = path.join(__dirname, '..')
const isWindows = process.platform === 'win32'

function runCommand(
  name,
  executable,
  args,
  environment
) {
  let command = executable
  let commandArgs = args

  if (
    isWindows &&
    /\.(cmd|bat)$/i.test(executable)
  ) {
    const commandParts = [executable, ...args]
    const safePart = /^[a-zA-Z0-9@._:\\/-]+$/

    if (
      commandParts.some(
        part => !safePart.test(part)
      )
    ) {
      throw new Error(
        `${name} contains unsupported Windows command characters`
      )
    }

    command =
      process.env.ComSpec || 'cmd.exe'
    commandArgs = [
      '/d',
      '/s',
      '/c',
      commandParts.join(' '),
    ]
  }

  console.log(`\n=== ${name} ===`)

  const result = spawnSync(
    command,
    commandArgs,
    {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    }
  )

  if (result.error) {
    throw new Error(
      `${name} could not start: ${result.error.message}`
    )
  }

  if (result.status !== 0) {
    throw new Error(
      `${name} failed with exit code ${result.status}`
    )
  }
}

function localPassword() {
  const configured =
    process.env.HOSTELSET_LOCAL_E2E_PASSWORD

  if (configured) {
    if (configured.length < 16) {
      throw new Error(
        'HOSTELSET_LOCAL_E2E_PASSWORD must contain at least 16 characters'
      )
    }

    return configured
  }

  return (
    `LocalQA-${randomBytes(24).toString('base64url')}!Aa9`
  )
}

function main() {
  const npxCommand =
    isWindows ? 'npx.cmd' : 'npx'

  runCommand(
    'Start or validate full local Supabase',
    npxCommand,
    ['supabase@2.109.1', 'start'],
    process.env
  )

  const localSupabase =
    getLocalSupabaseEnvironment()

  const password = localPassword()
  const baseUrl = 'http://127.0.0.1:3000'

  const localEnvironment = {
    ...process.env,

    HOSTELSET_LOCAL_E2E_PASSWORD: password,
    HOSTELSET_LOCAL_E2E: 'true',

    NEXT_PUBLIC_APP_ENV: 'local-e2e',
    NEXT_PUBLIC_APP_URL: baseUrl,
    PLAYWRIGHT_BASE_URL: baseUrl,

    NEXT_PUBLIC_SUPABASE_URL:
      localSupabase.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      localSupabase.anonKey,

    SUPABASE_URL:
      localSupabase.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY:
      localSupabase.serviceRoleKey,

    API_RATE_LIMIT_SECRET:
      'hostelset-local-e2e-rate-limit-secret',

    BREVO_API_KEY: '',
    SENTRY_DSN: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    NEXT_PUBLIC_POSTHOG_KEY: '',
    NEXT_PUBLIC_GA_MEASUREMENT_ID: '',

    CI: process.env.CI || 'true',
    VERCEL_ENV: 'development',
  }

  runCommand(
    'Seed fictional local QA data',
    process.execPath,
    [
      path.join(
        projectRoot,
        'scripts',
        'seed-local-e2e.cjs'
      ),
    ],
    localEnvironment
  )

  runCommand(
    'Verify local Auth and RLS roles',
    process.execPath,
    [
      path.join(
        projectRoot,
        'scripts',
        'local-role-auth-tests.cjs'
      ),
    ],
    localEnvironment
  )

  const playwrightCli =
    require.resolve('@playwright/test/cli')

  runCommand(
    'Run isolated local Playwright tests',
    process.execPath,
    [
      playwrightCli,
      'test',
      '--config=playwright.config.js',
      ...process.argv.slice(2),
    ],
    localEnvironment
  )

  console.log(
    '\nAll isolated local browser tests passed.'
  )
}

try {
  main()
} catch (error) {
  console.error(
    `\nLocal browser validation failed: ${error.message}`
  )
  process.exitCode = 1
}
