const { createClient } = require('@supabase/supabase-js')
const {
  getLocalSupabaseEnvironment,
} = require('./local-supabase-env.cjs')

const actors = [
  {
    key: 'admin',
    email: 'qa.admin.active@example.test',
    fullName: 'QA Active Admin',
    phone: '9000000100',
    role: 'admin',
  },
  {
    key: 'owner',
    email: 'qa.owner.a@example.test',
    fullName: 'QA Owner A',
    phone: '9000000101',
    role: 'owner',
  },
  {
    key: 'tenant',
    email: 'qa.tenant.a@example.test',
    fullName: 'QA Tenant A',
    phone: '9000000102',
    role: 'tenant',
  },
]

const propertyId =
  'b2000000-0000-4000-8000-000000000001'
const roomId =
  'c2000000-0000-4000-8000-000000000001'
const tenantId =
  'd2000000-0000-4000-8000-000000000001'

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

function throwIfError(error, operation) {
  if (!error) return

  throw new Error(
    `${operation} failed: ${error.message}`
  )
}

async function readAuthUsers(client) {
  const users = []

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } =
      await client.auth.admin.listUsers({
        page,
        perPage: 100,
      })

    throwIfError(error, 'Reading local Auth users')

    const pageUsers = data?.users || []
    users.push(...pageUsers)

    if (pageUsers.length < 100) break
  }

  return users
}

async function ensureAuthActor(
  client,
  existingUsers,
  actor,
  password
) {
  const existing = existingUsers.find(
    user =>
      user.email?.toLowerCase() ===
      actor.email.toLowerCase()
  )

  const attributes = {
    email: actor.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: actor.fullName,
      role: actor.role,
      qa_test_actor: true,
    },
    app_metadata: {
      role: actor.role,
      qa_test_actor: true,
    },
  }

  if (existing) {
    const { data, error } =
      await client.auth.admin.updateUserById(
        existing.id,
        attributes
      )

    throwIfError(
      error,
      `Updating ${actor.key} Auth user`
    )

    return data.user
  }

  const { data, error } =
    await client.auth.admin.createUser(attributes)

  throwIfError(
    error,
    `Creating ${actor.key} Auth user`
  )

  return data.user
}

async function upsert(
  client,
  table,
  value,
  onConflict
) {
  const { error } = await client
    .from(table)
    .upsert(value, { onConflict })

  throwIfError(error, `Upserting ${table}`)
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10)
}

async function main() {
  const password = requirePassword()
  const environment =
    getLocalSupabaseEnvironment()

  const client = createClient(
    environment.apiUrl,
    environment.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )

  const existingUsers = await readAuthUsers(client)
  const authUsers = {}

  for (const actor of actors) {
    authUsers[actor.key] = await ensureAuthActor(
      client,
      existingUsers,
      actor,
      password
    )
  }

  await upsert(
    client,
    'users',
    actors.map(actor => ({
      id: authUsers[actor.key].id,
      email: actor.email,
      full_name: actor.fullName,
      phone: actor.phone,
      role: actor.role,
      is_active: true,
      updated_at: new Date().toISOString(),
    })),
    'id'
  )

  const now = new Date()
  const membershipExpiry = new Date(now)
  membershipExpiry.setUTCFullYear(
    membershipExpiry.getUTCFullYear() + 1
  )

  const moveIn = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1
  ))

  const nextDue = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1
  ))

  await upsert(
    client,
    'properties',
    {
      id: propertyId,
      owner_id: authUsers.owner.id,
      name: 'QA Jasmine House A',
      slug: 'qa-jasmine-house-a',
      description:
        'Local automated QA property. Contains fictional test data only.',
      address: '100 QA Test Street',
      city: 'Bengaluru',
      pincode: '560001',
      property_type: 'boys',
      amenities: ['WiFi', 'Laundry'],
      photos: [],
      contact_number: '9000000101',
      is_active: true,
      membership_active: true,
      membership_expiry:
        membershipExpiry.toISOString(),
      location_verified: true,
      lifecycle_status: 'active',
      updated_at: now.toISOString(),
    },
    'id'
  )

  await upsert(
    client,
    'owner_settings',
    {
      owner_id: authUsers.owner.id,
      property_id: propertyId,
      joining_fee: 500,
      advance_months: 1,
      due_day: 5,
      pre_booking_fee: 1000,
      application_deposit: 1000,
      updated_at: now.toISOString(),
    },
    'property_id'
  )

  await upsert(
    client,
    'rooms',
    {
      id: roomId,
      property_id: propertyId,
      room_number: 'QA-A-102 Partial',
      sharing_type: 'double',
      monthly_rent: 5000,
      capacity: 2,
      current_occupants: 1,
      status: 'vacant',
      room_audience: 'boys',
      deposit_amount: 3000,
      has_approved_prebooking: false,
      updated_at: now.toISOString(),
    },
    'id'
  )

  await upsert(
    client,
    'tenants',
    {
      id: tenantId,
      user_id: authUsers.tenant.id,
      property_id: propertyId,
      room_id: roomId,
      name: 'QA Tenant A',
      phone: '9000000102',
      email: 'qa.tenant.a@example.test',
      rent_amount: 5000,
      rent_follows_room: true,
      pending_amount: 0,
      total_paid: 5000,
      rent_status: 'paid',
      last_payment_date: dateOnly(moveIn),
      move_in_date: dateOnly(moveIn),
      paid_through_date: dateOnly(moveIn),
      current_rent_due_date: dateOnly(nextDue),
      current_rent_cycle_paid: true,
      security_deposit_amount: 3000,
      security_deposit_status: 'paid',
      security_deposit_refund_status:
        'not_refunded',
      status: 'active',
      check_out_requested: false,
      notice_period_start: null,
      notice_period_end: null,
      updated_at: now.toISOString(),
    },
    'id'
  )

  console.log(
    'ok - local QA Auth actors are ready'
  )
  console.log(
    'ok - local QA property, room, and tenant are ready'
  )
  console.log(
    'Actors: admin, owner, tenant'
  )
  console.log(
    'Safety: localhost Supabase only'
  )
}

main().catch(error => {
  console.error(`Local QA seed failed: ${error.message}`)
  process.exitCode = 1
})
