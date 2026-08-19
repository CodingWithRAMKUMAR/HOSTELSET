const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const {
  getLocalSupabaseEnvironment,
} = require('./local-supabase-env.cjs')

const actors = [
  {
    role: 'admin',
    email: 'qa.admin.active@example.test',
    fullName: 'QA Active Admin',
  },
  {
    role: 'owner',
    email: 'qa.owner.a@example.test',
    fullName: 'QA Owner A',
  },
  {
    role: 'tenant',
    email: 'qa.tenant.a@example.test',
    fullName: 'QA Tenant A',
  },
]

const propertyId =
  'b2000000-0000-4000-8000-000000000001'

function requirePassword() {
  const password =
    process.env.HOSTELSET_LOCAL_E2E_PASSWORD

  if (!password || password.length < 16) {
    throw new Error(
      'HOSTELSET_LOCAL_E2E_PASSWORD must contain at least 16 characters'
    )
  }

  return password
}

function createLocalClient(environment) {
  return createClient(
    environment.apiUrl,
    environment.anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )
}

async function verifyRoleData(
  client,
  actor,
  authenticatedUser
) {
  const { data: profile, error: profileError } =
    await client
      .from('users')
      .select('id, full_name, role, is_active')
      .eq('id', authenticatedUser.id)
      .single()

  assert.ifError(profileError)
  assert.equal(profile.id, authenticatedUser.id)
  assert.equal(profile.full_name, actor.fullName)
  assert.equal(profile.role, actor.role)
  assert.equal(profile.is_active, true)

  if (actor.role === 'admin') {
    const {
      count,
      error,
    } = await client
      .from('users')
      .select('id', {
        count: 'exact',
        head: true,
      })

    assert.ifError(error)
    assert.ok(
      count >= 3,
      'Admin could not read the seeded user inventory'
    )
  }

  if (actor.role === 'owner') {
    const { data: property, error } =
      await client
        .from('properties')
        .select(
          'id, owner_id, name, membership_active'
        )
        .eq('id', propertyId)
        .eq('owner_id', authenticatedUser.id)
        .single()

    assert.ifError(error)
    assert.equal(property.name, 'QA Jasmine House A')
    assert.equal(property.membership_active, true)
  }

  if (actor.role === 'tenant') {
    const { data: tenant, error } =
      await client
        .from('tenants')
        .select(
          'id, user_id, name, status, property_id'
        )
        .eq('user_id', authenticatedUser.id)
        .single()

    assert.ifError(error)
    assert.equal(tenant.name, 'QA Tenant A')
    assert.equal(tenant.status, 'active')
    assert.equal(tenant.property_id, propertyId)
  }
}

async function verifyActor(
  environment,
  actor,
  password
) {
  const client = createLocalClient(environment)

  try {
    const { data, error } =
      await client.auth.signInWithPassword({
        email: actor.email,
        password,
      })

    assert.ifError(error)
    assert.ok(
      data.user?.id,
      `${actor.role} authentication returned no user`
    )
    assert.ok(
      data.session?.access_token,
      `${actor.role} authentication returned no session`
    )

    await verifyRoleData(
      client,
      actor,
      data.user
    )

    console.log(
      `ok - ${actor.role} authentication and RLS access`
    )
  } finally {
    await client.auth.signOut().catch(() => {})
  }
}

async function main() {
  const environment =
    getLocalSupabaseEnvironment()
  const password = requirePassword()

  for (const actor of actors) {
    await verifyActor(
      environment,
      actor,
      password
    )
  }

  console.log(
    'Local role authentication integration tests passed'
  )
}

main().catch(error => {
  console.error(
    `Local role authentication test failed: ${error.message}`
  )
  process.exitCode = 1
})
