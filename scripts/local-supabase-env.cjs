const { spawnSync } = require('node:child_process')

const isWindows = process.platform === 'win32'

function runSupabaseStatus() {
  if (isWindows) {
    const executable = process.env.ComSpec || 'cmd.exe'
    const command =
      'npx.cmd supabase@2.109.1 status -o env'

    return spawnSync(
      executable,
      ['/d', '/s', '/c', command],
      {
        encoding: 'utf8',
        windowsHide: true,
      }
    )
  }

  return spawnSync(
    'npx',
    ['supabase@2.109.1', 'status', '-o', 'env'],
    {
      encoding: 'utf8',
    }
  )
}

function parseEnvironment(source) {
  const values = {}

  for (const line of String(source || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)

    if (!match) continue

    let value = match[2].trim()

    if (
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1)
    }

    values[match[1]] = value
  }

  return values
}

function assertLocalUrl(value, label) {
  let parsed

  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }

  if (
    parsed.hostname !== '127.0.0.1' &&
    parsed.hostname !== 'localhost'
  ) {
    throw new Error(
      `${label} must point to local Supabase, not ${parsed.hostname}`
    )
  }

  return value
}

function getLocalSupabaseEnvironment() {
  const result = runSupabaseStatus()

  if (result.error) {
    throw new Error(
      `Could not run Supabase CLI: ${result.error.message}`
    )
  }

  if (result.status !== 0) {
    throw new Error(
      'Local Supabase status failed. Start Supabase before testing.'
    )
  }

  const values = parseEnvironment(result.stdout)

  const apiUrl = assertLocalUrl(
    values.API_URL,
    'Local Supabase API URL'
  )

  const databaseUrl = assertLocalUrl(
    values.DB_URL,
    'Local Supabase database URL'
  )

  const anonKey =
    values.ANON_KEY ||
    values.PUBLISHABLE_KEY

  const serviceRoleKey =
    values.SERVICE_ROLE_KEY ||
    values.SECRET_KEY

  if (!anonKey) {
    throw new Error(
      'Local Supabase anonymous/publishable key is unavailable'
    )
  }

  if (!serviceRoleKey) {
    throw new Error(
      'Local Supabase service-role/secret key is unavailable'
    )
  }

  return {
    apiUrl,
    databaseUrl,
    anonKey,
    serviceRoleKey,
  }
}

if (require.main === module) {
  try {
    const environment =
      getLocalSupabaseEnvironment()

    console.log('ok - local Supabase environment is safe')
    console.log(`API host: ${new URL(environment.apiUrl).host}`)
    console.log(
      `Database host: ${new URL(environment.databaseUrl).host}`
    )
    console.log('Anonymous key: available')
    console.log('Service-role key: available')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = {
  getLocalSupabaseEnvironment,
  parseEnvironment,
}
