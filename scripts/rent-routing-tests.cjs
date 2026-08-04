const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  businessTodayIsoDate,
  calculateCanonicalRentDue,
  currentRentDueDateFromMoveIn,
  formatRentDueDetail,
  formatRentDueLabel,
  isConfirmedRent,
  isPendingRentPayment,
  nextRentDueDateFromMoveIn,
  parseDateOnly,
  previousRentDueDateFromMoveIn,
  uniqueConfirmedRentPayments,
  uniquePendingRentPayments,
} = require('../lib/rentDue')
const {
  classifyTenantRent,
  enrichTenantRentStatus,
  filterTenantsByRentBucket,
  getTenantRentCounts,
  isActiveTenant,
  summarizeTenantRentStatuses,
} = require('../lib/tenantRentStatus')
const {
  buildDashboardHref,
  dashboardHrefToPath,
  pushDashboardHistory,
  replaceDashboardHistory,
  resolveDashboardQuery,
} = require('../lib/dashboardRouting')
const {
  normalizeIndianPhone,
  phoneLoginVariants,
  resolvePhoneLoginEmail,
} = require('../lib/server/phoneLogin')

const NOW = new Date(2026, 6, 16)
const tenant = (overrides = {}) => ({
  id: 'tenant-1',
  status: 'active',
  move_in_date: '2026-07-16',
  rent_amount: 1000,
  ...overrides,
})
const payment = (overrides = {}) => ({
  id: 'payment-1',
  tenant_id: 'tenant-1',
  amount: 1000,
  payment_date: '2026-07-16',
  payment_method: 'upi',
  status: 'success',
  ...overrides,
})
const localDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')
const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
const asyncTests = []

function importedTenantInitialRentState({ moveInDate, paidThroughDate, currentRent, referenceDate, currentRentCyclePaid = null }) {
  const rent = Math.max(Number(currentRent || 0), 0)
  const currentDueDate = currentRentDueDateFromMoveIn(moveInDate, referenceDate)
  if (!moveInDate || !currentDueDate || rent <= 0) return { pending_amount: 0, total_paid: 0, rent_status: 'paid' }
  let cyclePaid = currentRentCyclePaid
  if (cyclePaid === null) cyclePaid = Boolean(paidThroughDate && paidThroughDate >= currentDueDate)
  const resolvedPaidThroughDate = cyclePaid ? currentDueDate : previousRentDueDateFromMoveIn(moveInDate, currentDueDate)
  return {
    pending_amount: cyclePaid ? 0 : rent,
    total_paid: 0,
    rent_status: cyclePaid ? 'paid' : 'pending',
    paid_through_date: resolvedPaidThroughDate,
    current_rent_due_date: currentDueDate,
    current_rent_cycle_paid: cyclePaid,
  }
}

function publicAvailabilityModel({ properties = [], rooms = [], tenants = [], prebookings = [] }) {
  const visibleProperties = properties.filter(property =>
    property.is_active !== false &&
    (property.lifecycle_status || 'active') === 'active' &&
    !property.archived_at
  )
  return visibleProperties.map(property => {
    const publicRooms = rooms.filter(room =>
      room.property_id === property.id &&
      ['vacant', 'occupied'].includes(room.status) &&
      Number(room.capacity || 0) > 0
    )
    if (!publicRooms.length) return null
    const activeTenants = tenants.filter(tenant => tenant.property_id === property.id && ['active', 'notice_period', 'payment_pending'].includes(tenant.status)).length
    const roomRows = publicRooms.map(room => {
      const reservedBeds = prebookings.filter(booking =>
        booking.room_id === room.id &&
        booking.status === 'reserved' &&
        !booking.deleted_at
      ).length
      return {
        ...room,
        reservedBeds,
        availableBedsNow: Math.max(0, Number(room.capacity || 0) - Number(room.current_occupants || 0)),
      }
    })
    return {
      id: property.id,
      activeTenantCount: activeTenants,
      totalRooms: roomRows.length,
      availableRoomCount: roomRows.filter(room => room.availableBedsNow > 0).length,
      reservedRoomCount: roomRows.filter(room => room.reservedBeds > 0).length,
      upcomingVacateRoomCount: roomRows.filter(room => room.next_vacate_date && room.next_vacate_date >= '2026-07-17').length,
      totalCapacity: roomRows.reduce((sum, room) => sum + Number(room.capacity || 0), 0),
      currentOccupants: roomRows.reduce((sum, room) => sum + Number(room.current_occupants || 0), 0),
    }
  }).filter(Boolean)
}

function test(name, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      asyncTests.push(result.then(() => console.log(`ok - ${name}`)).catch(error => {
        console.error(`not ok - ${name}`)
        throw error
      }))
      return
    }
    console.log(`ok - ${name}`)
  } catch (error) {
    console.error(`not ok - ${name}`)
    throw error
  }
}

function fakeSupabase({ users = [], tenants = [] } = {}) {
  const tables = { users, tenants }
  return {
    from(tableName) {
      const rows = tables[tableName] || []
      const filters = []
      const builder = {
        select() { return builder },
        in(column, values) {
          filters.push(row => values.includes(row[column]))
          return builder
        },
        eq(column, value) {
          filters.push(row => row[column] === value)
          return builder
        },
        limit(count) {
          return Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row))).slice(0, count), error: null })
        },
        maybeSingle() {
          const matches = rows.filter(row => filters.every(filter => filter(row)))
          if (matches.length > 1) return Promise.resolve({ data: null, error: new Error('multiple rows') })
          return Promise.resolve({ data: matches[0] || null, error: null })
        },
      }
      return builder
    },
  }
}

test('unpaid due in 10 days is upcoming, not paid', () => {
  const result = calculateCanonicalRentDue(tenant({ move_in_date: '2026-07-26' }), [], NOW)
  assert.strictEqual(result.status, 'upcoming')
  assert.strictEqual(result.dueAmount, 1000)
})

test('unpaid due in 3 days is due soon', () => {
  const result = calculateCanonicalRentDue(tenant({ move_in_date: '2026-07-19' }), [], NOW)
  assert.strictEqual(result.status, 'due_soon')
})

test('unpaid due today is due today', () => {
  const result = calculateCanonicalRentDue(tenant(), [], NOW)
  assert.strictEqual(result.status, 'due_today')
})

test('unpaid due yesterday is overdue', () => {
  const result = calculateCanonicalRentDue(tenant({ move_in_date: '2026-07-15' }), [], NOW)
  assert.strictEqual(result.status, 'overdue')
})

test('confirmed full monthly rent is paid', () => {
  const result = calculateCanonicalRentDue(tenant(), [payment()], NOW)
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
})

test('partial confirmed payment leaves remaining due amount', () => {
  const result = calculateCanonicalRentDue(tenant(), [payment({ amount: 400 })], NOW)
  assert.strictEqual(result.status, 'due_today')
  assert.strictEqual(result.dueAmount, 600)
})

test('imported tenant can clear multiple already-due cycles without paying future rent', () => {
  const row = tenant({
    move_in_date: '2026-03-28',
    rent_amount: 7500,
    rent_status: 'paid',
    pending_amount: 0,
    paid_through_date: '2026-05-28',
    created_at: '2026-07-27T12:02:55.358854',
  })

  const payments = [
    payment({
      id: 'june-rent',
      amount: 7500,
      status: 'success',
      payment_method: 'upi',
      payment_date: '2026-07-28',
      created_at: '2026-07-28T05:51:49.282933',
    }),
    payment({
      id: 'july-rent',
      amount: 7500,
      status: 'success',
      payment_method: 'upi',
      payment_date: '2026-07-28',
      created_at: '2026-07-28T06:37:22.800161',
    }),
  ]

  const result = calculateCanonicalRentDue(
    row,
    payments,
    new Date(2026, 6, 28)
  )
  assert.strictEqual(result.baselinePaidPeriods, 3)
  assert.strictEqual(result.paidPeriods, 5)
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(result.currentCycleDueAmount, 0)
  assert.strictEqual(localDate(result.paidThroughDate), '2026-07-28')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-28')
})
test('pending payment proof only is pending confirmation, not paid', () => {
  const result = calculateCanonicalRentDue(tenant(), [payment({ status: 'payment_pending' })], NOW)
  assert.strictEqual(result.status, 'pending_confirmation')
  assert.strictEqual(result.dueAmount, 1000)
})

test('payment field aliases classify rent without counting non-rent methods', () => {
  const confirmedAlias = {
    payment_status: 'SUCCESS',
    paymentType: 'UPI',
    amount: 1000,
  }
  const pendingAlias = {
    payment_status: 'PENDING_OWNER_VERIFICATION',
    method: 'upi',
    amount: 1000,
  }

  assert.strictEqual(isConfirmedRent(confirmedAlias), true)
  assert.strictEqual(isPendingRentPayment(pendingAlias), true)
  assert.strictEqual(
    isConfirmedRent({ ...confirmedAlias, paymentType: 'APPLICATION_FEE' }),
    false
  )
  assert.strictEqual(
    isPendingRentPayment({ ...pendingAlias, method: undefined, type: 'DEPOSIT' }),
    false
  )
})

test('rent payment helpers deduplicate confirmed and pending records', () => {
  const confirmed = {
    payment_status: 'success',
    method: 'upi',
    amount: 1000,
    payment_date: '2026-07-16',
  }
  const pending = {
    id: 'pending-payment-1',
    payment_status: 'pending',
    payment_type: 'rent',
    amount: 1000,
    payment_date: '2026-07-16',
  }

  assert.strictEqual(
    uniqueConfirmedRentPayments([confirmed, { ...confirmed }]).length,
    1
  )
  assert.strictEqual(
    uniquePendingRentPayments([pending, { ...pending }]).length,
    1
  )
})

test('successful security deposit does not count as monthly rent', () => {
  const result = calculateCanonicalRentDue(tenant(), [payment({ payment_method: 'security_deposit' })], NOW)
  assert.strictEqual(result.status, 'due_today')
  assert.strictEqual(result.dueAmount, 1000)
})

test('archived tenant is inactive', () => {
  const result = calculateCanonicalRentDue(tenant({ status: 'inactive' }), [payment()], NOW)
  assert.strictEqual(result.status, 'inactive')
  assert.strictEqual(result.dueAmount, 0)
})

test('multiple confirmed payments are not double-counted by payment id', () => {
  const duplicate = payment({ id: 'same-id' })
  const result = calculateCanonicalRentDue(tenant(), [duplicate, { ...duplicate }], NOW)
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.confirmedAmount, 1000)
})

test('month-end anchor clamps to the last valid day', () => {
  const result = calculateCanonicalRentDue(
    tenant({ move_in_date: '2026-01-31' }),
    [payment({ payment_date: '2026-01-31' })],
    new Date(2026, 1, 20)
  )
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(localDate(result.dueDate), '2026-02-28')
})

test('date-only parsing accepts leap day and rejects invalid calendar dates', () => {
  assert.deepStrictEqual(
    parseDateOnly('2024-02-29'),
    { year: 2024, month: 2, day: 29 }
  )
  assert.strictEqual(parseDateOnly('2026-02-29'), null)
  assert.strictEqual(parseDateOnly('2026-04-31'), null)
  assert.strictEqual(parseDateOnly('not-a-date'), null)
})

test('business date changes exactly at midnight in Asia Kolkata', () => {
  assert.strictEqual(
    businessTodayIsoDate(new Date('2026-07-15T18:29:59.000Z')),
    '2026-07-15'
  )
  assert.strictEqual(
    businessTodayIsoDate(new Date('2026-07-15T18:30:00.000Z')),
    '2026-07-16'
  )
})

test('owner and tenant classification helpers return the same category', () => {
  const row = tenant({ move_in_date: '2026-07-16' })
  const owner = classifyTenantRent(row, [], NOW)
  const tenantSide = enrichTenantRentStatus(row, [], NOW)
  assert.strictEqual(owner.category, tenantSide.category)
  assert.strictEqual(owner.category, 'due')
})

test('active tenant helper accepts operational statuses and rejects closed statuses', () => {
  assert.strictEqual(isActiveTenant({ status: 'active' }), true)
  assert.strictEqual(isActiveTenant({ status: 'notice_period' }), true)
  assert.strictEqual(isActiveTenant({ status: 'payment_pending' }), true)
  assert.strictEqual(isActiveTenant({ status: 'inactive' }), false)
  assert.strictEqual(isActiveTenant({ status: 'archived' }), false)
})

test('tenant rent summary counts active buckets and pending amounts', () => {
  const rows = [
    {
      id: 'paid',
      rentSummary: {
        category: 'paid',
        isActive: true,
        hasUnpaidRent: false,
        dueAmount: 0,
      },
    },
    {
      id: 'due',
      rentSummary: {
        category: 'due',
        isActive: true,
        hasUnpaidRent: true,
        dueAmount: 600,
      },
    },
    {
      id: 'upcoming',
      rentSummary: {
        category: 'upcoming',
        isActive: true,
        hasUnpaidRent: true,
        dueAmount: 1000,
      },
    },
    {
      id: 'pending',
      rentSummary: {
        category: 'pending_confirmation',
        isActive: true,
        hasUnpaidRent: true,
        dueAmount: 1000,
      },
    },
    {
      id: 'inactive',
      rentSummary: {
        category: 'inactive',
        isActive: false,
        hasUnpaidRent: false,
        dueAmount: 0,
      },
    },
  ]

  assert.deepStrictEqual(summarizeTenantRentStatuses(rows), {
    paid: 1,
    due: 1,
    upcoming: 1,
    pending_confirmation: 1,
    pendingAmount: 2600,
    total: 4,
  })
  assert.deepStrictEqual(getTenantRentCounts(rows), {
    all: 4,
    paid: 1,
    due: 1,
    upcoming: 1,
    pending_confirmation: 1,
  })
  assert.deepStrictEqual(
    filterTenantsByRentBucket(rows, 'due').map(row => row.id),
    ['due']
  )
  assert.strictEqual(filterTenantsByRentBucket(rows, 'all').length, 4)
})

test('owner valid tab generates canonical URL', () => {
  const href = buildDashboardHref('owner', 'tenants')
  assert.strictEqual(dashboardHrefToPath(href), '/owner/dashboard?tab=tenants')
})

test('tenant valid tab generates canonical URL', () => {
  const href = buildDashboardHref('tenant', 'payments')
  assert.strictEqual(dashboardHrefToPath(href), '/tenant/dashboard?tab=payments')
})

test('unknown tab safely falls back to overview', () => {
  const resolved = resolveDashboardQuery('owner', { tab: 'not-a-tab' })
  assert.strictEqual(resolved.view, 'overview')
  assert.strictEqual(dashboardHrefToPath(buildDashboardHref('owner', resolved.view)), '/owner/dashboard')
})

test('canonical URL generation preserves matching record ids', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const href = buildDashboardHref('owner', 'room-change', { request_id: id })
  assert.strictEqual(dashboardHrefToPath(href), `/owner/dashboard?tab=room-change&request_id=${id}`)
})

test('back and forward query resolution uses router query state', () => {
  assert.strictEqual(resolveDashboardQuery('tenant', { tab: 'payments' }).view, 'payments')
  assert.strictEqual(resolveDashboardQuery('tenant', {}).view, 'overview')
})

test('clicking the same tab resolves to the same canonical path', () => {
  const current = buildDashboardHref('owner', 'rooms')
  const next = buildDashboardHref('owner', 'rooms', current.query)
  assert.strictEqual(dashboardHrefToPath(current), dashboardHrefToPath(next))
})

test('dashboard routing uses shallow Next router methods, not full reload', () => {
  const calls = []
  const router = {
    push: (href, as, options) => calls.push(['push', href, as, options]),
    replace: (href, as, options) => calls.push(['replace', href, as, options]),
  }
  pushDashboardHistory(router, buildDashboardHref('owner', 'rooms'))
  replaceDashboardHistory(router, buildDashboardHref('owner', 'overview'))
  assert.strictEqual(calls.length, 2)
  assert.deepStrictEqual(calls[0][3], { shallow: true, scroll: false })
  assert.deepStrictEqual(calls[1][3], { shallow: true, scroll: false })
})

test('tenant dashboard uses cached mounted tabs and does not blank after usable data', () => {
  const tenantDashboardSource = source('pages/tenant/dashboard.js')
  assert.match(tenantDashboardSource, /TENANT_PERSISTENT_TABS/)
  assert.match(tenantDashboardSource, /data-tenant-mobile-mounted-tabs/)
  assert.match(tenantDashboardSource, /<TenantTabPanel key=\{tab\} tab=\{tab\} active=\{activeTab === tab\}>/)
  assert.doesNotMatch(tenantDashboardSource, /if \(loading \|\| !tenant\)/)
})

test('tenant core data reloads are guarded and not used for tab actions', () => {
  const tenantContextSource = source('context/TenantContext.js')
  const tenantDashboardSource = source('pages/tenant/dashboard.js')
  assert.match(tenantContextSource, /inFlightLoadRef/)
  assert.match(tenantContextSource, /lastLoadedKeyRef/)
  assert.match(tenantContextSource, /load-skipped-cached/)
  assert.match(tenantContextSource, /load-joined-in-flight/)
  assert.doesNotMatch(tenantDashboardSource, /refreshData\(true\)/)
})

test('tenant realtime hooks patch local state instead of core refreshing', () => {
  for (const file of ['hooks/usePayments.js', 'hooks/useRoomChange.js', 'pages/tenant/dashboard.js']) {
    assert.doesNotMatch(source(file), /refreshData\(true\)/, `${file} must not full-refresh tenant core data`)
  }
  assert.doesNotMatch(source('context/TenantContext.js'), /scheduleRefresh[\s\S]*refreshData\(true\)/)
  assert.doesNotMatch(source('hooks/usePayments.js'), /if \(payload\.eventType === 'UPDATE'[\s\S]{0,160}refreshData/)
})

test('approved room changes reconcile tenant core state', () => {
  const hook = source('hooks/useRoomChange.js')

  assert.match(
    hook,
    /payload\.new\.status === 'approved'[\s\S]*refreshData\(\{[\s\S]*force:\s*true[\s\S]*reason:\s*'room-change-approved'/
  )
})

test('admin core stats load is cached and in-flight guarded', () => {
  const adminContextSource = source('context/AdminContext.js')
  assert.match(adminContextSource, /inFlightStatsRef/)
  assert.match(adminContextSource, /lastLoadedKeyRef/)
  assert.match(adminContextSource, /load-joined-in-flight/)
  assert.match(adminContextSource, /load-skipped-cached/)
  assert.match(adminContextSource, /hostelsetAdminPerf/)
})

test('admin dashboard uses mounted tabs and visible state before shallow route push', () => {
  const adminDashboardSource = source('pages/admin/dashboard.js')
  assert.match(adminDashboardSource, /ADMIN_PERSISTENT_TABS/)
  assert.match(adminDashboardSource, /const \[mountedTabs, setMountedTabs\] = useState\(\(\) => new Set\(\['overview'\]\)\)/)
  assert.match(adminDashboardSource, /data-admin-mobile-mounted-tabs/)
  assert.match(adminDashboardSource, /<AdminTabPanel key=\{tab\} tab=\{tab\} active=\{activeTab === tab\}>/)
  assert.match(adminDashboardSource, /window\.requestAnimationFrame\?\.\(\(\) => pushDashboardHistory\(router, href\)\)/)
})

test('admin overview surfaces real pending request queues', () => {
  const adminDashboardSource = source('pages/admin/dashboard.js')
  assert.match(adminDashboardSource, /function AdminActionCenter/)
  assert.match(adminDashboardSource, /Pending memberships/)
  assert.match(adminDashboardSource, /Pending applications/)
  assert.match(adminDashboardSource, /Open complaints/)
  assert.match(adminDashboardSource, /Pending vacates/)
  assert.match(adminDashboardSource, /Room changes/)
  assert.match(adminDashboardSource, /Payment issues/)
  assert.match(adminDashboardSource, /membership_id/)
})

test('admin membership queries use explicit relationship aliases', () => {
  const membershipHookSource = source('hooks/useAdminMembershipManager.js')
  assert.match(membershipHookSource, /properties!properties_owner_id_fkey/)
  assert.match(membershipHookSource, /owner:users!membership_requests_owner_id_fkey/)
  assert.match(membershipHookSource, /property:properties!membership_requests_property_id_fkey/)
  assert.doesNotMatch(membershipHookSource, /properties\(id, name, membership_active, membership_expiry\)/)
  assert.doesNotMatch(membershipHookSource, /owner:owner_id\(/)
  assert.doesNotMatch(membershipHookSource, /property:property_id\(/)
})

test('admin membership requests preserve rows and normalize missing relations', () => {
  const membershipHookSource = source('hooks/useAdminMembershipManager.js')
  assert.match(membershipHookSource, /normalizeMembershipRequest/)
  assert.match(membershipHookSource, /Unknown owner/)
  assert.match(membershipHookSource, /No property linked/)
  assert.match(membershipHookSource, /setRequests\(current => current\.filter\(request => request\.id !== requestId\)\)/)
})

test('labels expose due today and pending confirmation clearly', () => {
  assert.strictEqual(formatRentDueLabel(calculateCanonicalRentDue(tenant(), [], NOW)), 'Due today')
  assert.strictEqual(formatRentDueLabel(calculateCanonicalRentDue(tenant(), [payment({ status: 'pending' })], NOW)), 'Pending confirmation')
  assert.strictEqual(formatRentDueDetail(calculateCanonicalRentDue(tenant({ move_in_date: '2026-07-15' }), [], NOW), date => localDate(date)), 'Overdue by 1 day - Due 2026-07-15')
  assert.strictEqual(formatRentDueDetail(calculateCanonicalRentDue(tenant({ move_in_date: '2026-07-19' }), [], NOW), date => localDate(date)), 'Due in 3 days - 2026-07-19')
})

const importedJunePaidTenant = () => ({
  id: '56615b49-f02c-404f-9713-fcaae17941c4',
  rent_amount: 15000,
  pending_amount: 0,
  rent_status: 'paid',
  move_in_date: '2026-06-16',
  status: 'active',
  created_at: '2026-07-17T09:00:00.000000',
  total_paid: 15000,
})

const realJulyPayment = (overrides = {}) => ({
  id: 'a9f39d84-9d54-4a14-8d12-72494c024c74',
  tenant_id: '56615b49-f02c-404f-9713-fcaae17941c4',
  amount: 15000,
  status: 'success',
  payment_method: 'upi',
  payment_date: '2026-07-16',
  created_at: '2026-07-16T16:24:27.472385',
  ...overrides,
})

test('imported tenant baseline covers only the last paid June cycle', () => {
  const beforePayment = calculateCanonicalRentDue(importedJunePaidTenant(), [], new Date(2026, 6, 17))
  assert.strictEqual(beforePayment.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(beforePayment.paidThroughDate), '2026-06-16')
  assert.strictEqual(localDate(beforePayment.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(beforePayment.status, 'overdue')
  assert.strictEqual(beforePayment.daysUntilDue, -1)
  assert.strictEqual(beforePayment.currentCycleDueAmount, 15000)
  assert.strictEqual(beforePayment.cycleAllocations[0].baselineAmount, 15000)
  assert.strictEqual(beforePayment.cycleAllocations[1].remainingAmount, 15000)
})

test('real successful UPI payment on due date covers imported tenant July cycle without advancing to September', () => {
  const row = importedJunePaidTenant()
  const paymentRow = realJulyPayment()
  const result = calculateCanonicalRentDue(row, [paymentRow], new Date(2026, 6, 17))
  assert.strictEqual(isConfirmedRent(paymentRow), true)
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(result.currentCycleDueAmount, 0)
  assert.strictEqual(result.paidPeriods, 2)
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.paidThroughDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
  assert.notStrictEqual(localDate(result.nextDueDate), '2026-09-16')
  assert.deepStrictEqual(result.cycleAllocations[1].paymentIds, [paymentRow.id])
  assert.strictEqual(result.cycleAllocations[2].status, 'unpaid')
})

test('actual queried imported tenant and payment row shape resolves July as paid', () => {
  const actualTenant = {
    ...importedJunePaidTenant(),
    created_at: '2026-07-11T13:58:10.116607',
    updated_at: '2026-07-16T16:28:38.442385',
  }
  const actualPayment = realJulyPayment({ created_at: '2026-07-16T16:24:27.472385', updated_at: '2026-07-16T16:28:38.442385+00:00' })
  const result = calculateCanonicalRentDue(actualTenant, [actualPayment], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.currentCycleDueAmount, 0)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
})

test('import timestamp does not mark every pre-import cycle as paid', () => {
  const oldImported = importedJunePaidTenant()
  oldImported.move_in_date = '2026-05-16'
  const result = calculateCanonicalRentDue(oldImported, [], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(result.paidThroughDate), '2026-05-16')
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-06-16')
})

test('explicit paid-through date is used when available', () => {
  const row = { ...importedJunePaidTenant(), paid_through_date: '2026-06-16' }
  const result = calculateCanonicalRentDue(row, [realJulyPayment()], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
})

test('explicit paid-through allocation is unaffected by import date', () => {
  const row = { ...importedJunePaidTenant(), paid_through_date: '2026-06-16', created_at: '2026-09-30T10:00:00.000Z' }
  const result = calculateCanonicalRentDue(row, [], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(result.status, 'overdue')
})

test('paid-through date equal to July covers July without payment history', () => {
  const result = calculateCanonicalRentDue({ ...importedJunePaidTenant(), paid_through_date: '2026-07-16' }, [], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.baselinePaidPeriods, 2)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
})

test('hostel joined February 12 and last paid rent due July 12 is paid through July', () => {
  const row = {
    ...importedJunePaidTenant(),
    move_in_date: '2026-02-12',
    paid_through_date: '2026-07-12',
    rent_amount: 12000,
    total_paid: 0,
    created_at: '2026-07-17T09:00:00.000000',
  }
  const result = calculateCanonicalRentDue(row, [], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.baselinePaidPeriods, 6)
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-12')
  assert.strictEqual(localDate(result.paidThroughDate), '2026-07-12')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-12')
  assert.notStrictEqual(result.message, 'Overdue by 5 days')
  assert.deepStrictEqual(result.cycleAllocations.slice(0, 6).map(cycle => [localDate(cycle.dueDate), cycle.baselineAmount, cycle.remainingAmount]), [
    ['2026-02-12', 12000, 0],
    ['2026-03-12', 12000, 0],
    ['2026-04-12', 12000, 0],
    ['2026-05-12', 12000, 0],
    ['2026-06-12', 12000, 0],
    ['2026-07-12', 12000, 0],
  ])
})

test('null paid-through date keeps conservative legacy fallback', () => {
  const result = calculateCanonicalRentDue({ ...importedJunePaidTenant(), paid_through_date: null, created_at: '2026-09-30T10:00:00.000Z' }, [], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
})

test('baseline and confirmed payment do not cover the same cycle', () => {
  const juneHistory = realJulyPayment({ id: 'june-history', payment_date: '2026-06-16' })
  const julyHistory = realJulyPayment({ id: 'july-history', payment_date: '2026-07-16' })
  const result = calculateCanonicalRentDue({ ...importedJunePaidTenant(), paid_through_date: '2026-06-16' }, [juneHistory, julyHistory], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 1)
  assert.strictEqual(result.paidPeriods, 2)
  assert.deepStrictEqual(result.cycleAllocations[0].paymentIds, [])
  assert.deepStrictEqual(result.cycleAllocations[1].paymentIds, ['july-history'])
})

test('total_paid does not create an extra paid cycle when payment history already has July rent', () => {
  const row = { ...importedJunePaidTenant(), total_paid: 30000 }
  const result = calculateCanonicalRentDue(row, [realJulyPayment()], new Date(2026, 6, 17))
  assert.strictEqual(result.paidPeriods, 2)
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
})

test('paid status exposes separate paid current cycle and next due date', () => {
  const result = calculateCanonicalRentDue(importedJunePaidTenant(), [realJulyPayment()], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
  assert.strictEqual(formatRentDueDetail(result, date => localDate(date)), 'Next rent due: 2026-08-16')
})

test('tenant mobile UI uses next-rent wording instead of ambiguous paid-date wording', () => {
  const tenantMobileDashboard = source('components/tenant/mobile/TenantMobileDashboard.js')
  assert.match(tenantMobileDashboard, /formatRentDueDetail\(rentStatus, formatDate\)/)
  assert.match(source('lib/rentDue.js'), /Next rent due:/)
  assert.doesNotMatch(tenantMobileDashboard, /\$\{label\}.*formatDate\(rentStatus\.dueDate\)/)
})

test('import flow records and displays current rent cycle answer explicitly', () => {
  const importPage = source('pages/import/[token].js')
  const importApi = source('pages/api/import/submit.js')
  const ownerImportList = source('components/owner/ExistingTenantImportList.js')
  const adminConsole = source('components/admin/EnterpriseAdminConsole.js')
  const migration = source('supabase/migrations/202607170003_import_current_rent_answer.sql')
  const appliedMigration = source('supabase/migrations/202607170001_import_paid_through_date.sql')
  assert.match(importPage, /Hostel joined date/)
  assert.match(importPage, /Has the rent due on/)
  assert.match(importPage, /Yes, paid/)
  assert.match(importPage, /No, not paid/)
  assert.match(importPage, /current_rent_cycle_paid: form\.currentCyclePaid === 'yes'/)
  assert.match(importPage, /paid_through_date: derivedPaidThroughDate/)
  assert.doesNotMatch(importPage, /name="paidThroughDate"/)
  assert.match(importApi, /currentRentDueDateFromMoveIn\(moveInDate\)/)
  assert.match(importApi, /previousRentDueDateFromMoveIn\(moveInDate, currentRentDueDate\)/)
  assert.match(importApi, /paidThroughDate > currentRentDueDate/)
  assert.match(importApi, /paid_through_date: paidThroughDate/)
  assert.match(ownerImportList, /Hostel joined/)
  assert.match(ownerImportList, /Current rent due date:/)
  assert.match(ownerImportList, /Tenant answer:/)
  assert.match(ownerImportList, /onUpdateRentAnswer/)
  assert.match(ownerImportList, /Last paid rent due date:/)
  assert.match(adminConsole, /Last paid rent due date/)
  assert.match(adminConsole, /Tenant answer/)
  assert.match(adminConsole, /update_existing_tenant_import_rent_answer/)
  assert.match(appliedMigration, /add column if not exists paid_through_date date/)
  assert.match(migration, /add column if not exists current_rent_due_date date/)
  assert.match(migration, /add column if not exists current_rent_cycle_paid boolean/)
})

test('admin enterprise console subscribes to all displayed lifecycle queues', () => {
  const adminConsole = source('components/admin/EnterpriseAdminConsole.js')
  for (const table of ['existing_tenant_imports', 'applications', 'pre_bookings', 'payment_history', 'complaints', 'check_out_requests', 'room_change_requests', 'notices', 'tenants', 'properties', 'rooms', 'users']) {
    assert.match(adminConsole, new RegExp(`table: '${table}'`), `${table} must refresh the enterprise admin console`)
  }
})

test('public availability migration does not require active tenants for approved properties with rooms', () => {
  const migration = source('supabase/migrations/202607170002_public_availability_visibility.sql')
  assert.match(migration, /exists \([\s\S]*from public\.rooms room[\s\S]*room\.property_id = property\.id/)
  assert.match(migration, /left join tenant_stats/)
  assert.match(migration, /coalesce\(tenant_stats\.active_tenant_count, 0\)/)
  assert.match(migration, /coalesce\(room_stats\.total_rooms, 0\) > 0/)
  assert.doesNotMatch(migration, /\n\s{2}join tenant_stats on tenant_stats\.property_id = property\.id/)
})

test('public availability migration uses one canonical public availability query for old and v2 RPCs', () => {
  const migration = source('supabase/migrations/202607170002_public_availability_visibility.sql')
  assert.match(migration, /create or replace function public\.get_public_property_availability_rows\(\)/)
  assert.strictEqual((migration.match(/from public\.get_public_property_availability_rows\(\) availability/g) || []).length, 2)
  assert.match(migration, /set search_path = ''/)
  assert.strictEqual(/execute\s+[^;]*\|\|/i.test(migration), false)
  assert.match(migration, /revoke all on function public\.get_public_property_availability_rows\(\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.get_public_properties_v2\(\) to anon, authenticated/)
  assert.match(migration, /grant execute on function public\.get_public_properties\(\) to anon, authenticated/)
})

function reservationCapacity({ capacity, prebookings = [] }) {
  const activeReservations = prebookings.filter(booking => booking.status === 'reserved' && !booking.deleted_at).length
  return {
    activeReservations,
    remainingReservationSlots: Math.max(0, Number(capacity || 0) - activeReservations),
    canReserve: activeReservations < Number(capacity || 0),
  }
}

test('public availability SQL tracks reserved prebooking capacity without consuming immediate beds', () => {
  const migration = source('supabase/migrations/202607170005_prebooking_reservation_workflow.sql')
  assert.match(migration, /create or replace function public\.refresh_room_public_availability\(p_room_id uuid\)/)
  assert.match(migration, /booking\.status = 'reserved'/)
  assert.match(migration, /booking\.deleted_at is null/)
  assert.match(migration, /create or replace function public\.get_public_property_rooms\(p_property_id uuid\)/)
  assert.match(migration, /booking\.status = 'reserved'[\s\S]*booking\.deleted_at is null[\s\S]*as reserved_prebooking_count/)
  assert.doesNotMatch(migration, /reserved_prebooking_count\s*=/)
  assert.match(migration, /update public\.rooms room[\s\S]*has_approved_prebooking = \([\s\S]*select count\(\*\) > 0/)
  assert.match(migration, /room\.capacity - coalesce\(room\.current_occupants, 0\)/)
  assert.doesNotMatch(migration, /room\.capacity - coalesce\(room\.current_occupants, 0\) - coalesce\(reservation\.reserved_beds, 0\)/)
  assert.match(migration, /count\(\*\) filter \(where room\.available_beds_now > 0\)::integer as available_room_count/)
})

test('prebooking reservation capacity counts active reserved rows only', () => {
  assert.deepStrictEqual(reservationCapacity({ capacity: 1, prebookings: [] }), { activeReservations: 0, remainingReservationSlots: 1, canReserve: true })
  assert.strictEqual(reservationCapacity({ capacity: 1, prebookings: [{ status: 'reserved' }] }).canReserve, false)
  assert.strictEqual(reservationCapacity({ capacity: 4, prebookings: [{ status: 'reserved' }, { status: 'reserved' }, { status: 'reserved' }] }).canReserve, true)
  assert.strictEqual(reservationCapacity({ capacity: 4, prebookings: [{ status: 'reserved' }, { status: 'reserved' }, { status: 'reserved' }, { status: 'reserved' }] }).canReserve, false)
  assert.deepStrictEqual(reservationCapacity({ capacity: 4, prebookings: [
    { status: 'reserved' },
    { status: 'pending' },
    { status: 'rejected' },
    { status: 'cancelled' },
    { status: 'converted' },
    { status: 'reserved', deleted_at: '2026-07-17T00:00:00Z' },
  ] }), { activeReservations: 1, remainingReservationSlots: 3, canReserve: true })
})

test('public availability SQL exposes only public aggregate fields', () => {
  const migration = source('supabase/migrations/202607170002_public_availability_visibility.sql')
  assert.doesNotMatch(migration, /tenant\.(name|phone|email|id_proof|photo|payment_screenshot)/)
  assert.doesNotMatch(migration, /request\.(tenant_name|tenant_id|reason)/)
  assert.doesNotMatch(migration, /booking\.(name|phone|email|id_proof|photo|payment_screenshot|payment_transaction_id)/)
  assert.match(migration, /address text/)
  assert.match(migration, /formatted_address text/)
  assert.match(migration, /contact_number text/)
  assert.match(migration, /latitude double precision/)
  assert.match(migration, /longitude double precision/)
})

test('public availability model covers visibility, reservations, and upcoming vacancy semantics', () => {
  const baseProperty = { id: 'property-1', is_active: true, lifecycle_status: 'active', archived_at: null }
  assert.deepStrictEqual(publicAvailabilityModel({ properties: [baseProperty], rooms: [] }), [], 'property without rooms is hidden')
  assert.deepStrictEqual(publicAvailabilityModel({ properties: [{ ...baseProperty, is_active: false }], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 2, current_occupants: 0 }] }), [], 'inactive property is hidden')
  assert.deepStrictEqual(publicAvailabilityModel({ properties: [{ ...baseProperty, archived_at: '2026-07-17T00:00:00Z' }], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 2, current_occupants: 0 }] }), [], 'archived property is hidden')
  assert.deepStrictEqual(publicAvailabilityModel({ properties: [baseProperty], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'maintenance', capacity: 2, current_occupants: 0 }] }), [], 'maintenance/unavailable room statuses do not count because they are not real public room statuses')

  const activeVisible = publicAvailabilityModel({ properties: [baseProperty], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 2, current_occupants: 0 }] })[0]
  assert.strictEqual(activeVisible.totalRooms, 1)
  assert.strictEqual(activeVisible.availableRoomCount, 1)
  assert.strictEqual(activeVisible.activeTenantCount, 0)

  const full = publicAvailabilityModel({ properties: [baseProperty], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'occupied', capacity: 2, current_occupants: 2 }] })[0]
  assert.strictEqual(full.availableRoomCount, 0)

  const reserved = publicAvailabilityModel({
    properties: [baseProperty],
    rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 2, current_occupants: 1 }],
    prebookings: [{ id: 'booking-1', room_id: 'room-1', status: 'reserved', deleted_at: null }],
  })[0]
  assert.strictEqual(reserved.availableRoomCount, 1)
  assert.strictEqual(reserved.reservedRoomCount, 1)

  const convertedApprovedPrebooking = publicAvailabilityModel({
    properties: [baseProperty],
    rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 3, current_occupants: 2 }],
    tenants: [{ id: 'tenant-1', user_id: 'user-1', property_id: 'property-1', room_id: 'room-1', status: 'active' }],
    prebookings: [{ id: 'booking-1', user_id: 'user-1', room_id: 'room-1', status: 'approved', deleted_at: null }],
  })[0]
  assert.strictEqual(convertedApprovedPrebooking.availableRoomCount, 1)
  assert.strictEqual(convertedApprovedPrebooking.reservedRoomCount, 0)

  const rejectedOrCancelled = publicAvailabilityModel({
    properties: [baseProperty],
    rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 2, current_occupants: 1 }],
    prebookings: [
      { id: 'booking-1', room_id: 'room-1', status: 'rejected', deleted_at: null },
      { id: 'booking-2', room_id: 'room-1', status: 'reserved', deleted_at: '2026-07-17T00:00:00Z' },
    ],
  })[0]
  assert.strictEqual(rejectedOrCancelled.availableRoomCount, 1)
  assert.strictEqual(rejectedOrCancelled.reservedRoomCount, 0)

  const upcoming = publicAvailabilityModel({ properties: [baseProperty], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'occupied', capacity: 1, current_occupants: 1, next_vacate_date: '2026-07-20' }] })[0]
  assert.strictEqual(upcoming.availableRoomCount, 0)
  assert.strictEqual(upcoming.upcomingVacateRoomCount, 1)

  const completedVacate = publicAvailabilityModel({ properties: [baseProperty], rooms: [{ id: 'room-1', property_id: 'property-1', status: 'vacant', capacity: 1, current_occupants: 0 }] })[0]
  assert.strictEqual(completedVacate.availableRoomCount, 1)
})

test('import approval SQL initializes rent state from explicit current-cycle answer', () => {
  const migration = source('supabase/migrations/202607170003_import_current_rent_answer.sql')
  assert.match(migration, /calculate_imported_tenant_initial_rent_state/)
  assert.match(migration, /tenants\.total_paid remains HostelSet-recorded confirmed payment history/)
  assert.match(migration, /no synthetic payment_history rows/)
  assert.match(migration, /rent_state\.pending_amount/)
  assert.match(migration, /rent_state\.total_paid/)
  assert.match(migration, /rent_state\.rent_status/)
  assert.match(migration, /current_rent_cycle_paid/)
  assert.match(migration, /update_existing_tenant_import_rent_answer/)
  assert.doesNotMatch(migration, /current_rent,\s*0,\s*0,\s*'paid'/)
})

test('import approval marks current cycle paid with zero pending and August next due', () => {
  const state = importedTenantInitialRentState({
    moveInDate: '2026-02-12',
    currentRent: 12000,
    referenceDate: '2026-07-17',
    currentRentCyclePaid: true,
  })
  assert.deepStrictEqual(importedTenantInitialRentState({
    moveInDate: '2026-02-12',
    currentRent: 12000,
    referenceDate: '2026-07-17',
    currentRentCyclePaid: true,
  }), {
    pending_amount: 0,
    total_paid: 0,
    rent_status: 'paid',
    paid_through_date: '2026-07-12',
    current_rent_due_date: '2026-07-12',
    current_rent_cycle_paid: true,
  })
  assert.strictEqual(nextRentDueDateFromMoveIn('2026-02-12', state.current_rent_due_date), '2026-08-12')
})

test('import approval marks current cycle unpaid as pending and overdue by five days', () => {
  const state = importedTenantInitialRentState({
    moveInDate: '2026-02-12',
    currentRent: 12000,
    referenceDate: '2026-07-17',
    currentRentCyclePaid: false,
  })
  assert.deepStrictEqual(state, {
    pending_amount: 12000,
    total_paid: 0,
    rent_status: 'pending',
    paid_through_date: '2026-06-12',
    current_rent_due_date: '2026-07-12',
    current_rent_cycle_paid: false,
  })
  const result = calculateCanonicalRentDue({
    id: 'imported-feb',
    status: 'active',
    move_in_date: '2026-02-12',
    paid_through_date: state.paid_through_date,
    rent_status: state.rent_status,
    pending_amount: state.pending_amount,
    rent_amount: 12000,
    total_paid: 0,
  }, [], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'overdue')
  assert.strictEqual(result.daysUntilDue, -5)
})

test('import approval does not produce future or advance paid state', () => {
  const state = importedTenantInitialRentState({
    moveInDate: '2026-02-12',
    currentRent: 12000,
    referenceDate: '2026-07-17',
    currentRentCyclePaid: true,
  })
  assert.strictEqual(state.paid_through_date, state.current_rent_due_date)
  assert.notStrictEqual(state.paid_through_date, '2026-08-12')
  assert.strictEqual(nextRentDueDateFromMoveIn('2026-02-12', state.current_rent_due_date), '2026-08-12')
  const migration = source('supabase/migrations/202607170003_import_current_rent_answer.sql')
  assert.match(migration, /paid_through_date is null or current_rent_due_date is null or paid_through_date <= current_rent_due_date/)
})

test('import approval SQL null paid-through fallback is conservative', () => {
  assert.deepStrictEqual(importedTenantInitialRentState({
    moveInDate: '2026-02-12',
    paidThroughDate: null,
    currentRent: 12000,
    referenceDate: '2026-07-17',
  }), {
    pending_amount: 12000,
    total_paid: 0,
    rent_status: 'pending',
    paid_through_date: '2026-06-12',
    current_rent_due_date: '2026-07-12',
    current_rent_cycle_paid: false,
  })
})

test('both import approval RPC variants use equivalent rent initialization and preserve side effects', () => {
  const migration = source('supabase/migrations/202607170003_import_current_rent_answer.sql')
  assert.strictEqual((migration.match(/from public\.calculate_imported_tenant_initial_rent_state/g) || []).length, 2)
  assert.ok((migration.match(/rent_state\.pending_amount/g) || []).length >= 2)
  assert.ok((migration.match(/rent_state\.total_paid/g) || []).length >= 2)
  assert.ok((migration.match(/rent_state\.rent_status/g) || []).length >= 2)
  assert.match(migration, /for update/)
  assert.match(migration, /Selected room is full/)
  assert.match(migration, /Tenant already exists for this property/)
  assert.match(migration, /status = 'approved'[\s\S]*tenant_id = new_tenant_id/)
  assert.match(migration, /status = 'approved'[\s\S]*user_id = effective_user_id[\s\S]*tenant_id = new_tenant_id/)
  assert.match(migration, /profile_photo like import_record\.property_id::text \|\| '\/imports\/photos\/%'/)
  assert.match(migration, /current_occupants = coalesce\(current_occupants, 0\) \+ 1/)
  assert.match(migration, /return jsonb_build_object\('success', true, 'tenant_id', import_record\.tenant_id, 'status', 'approved'\)/)
})

test('dashboard tab focus helper prevents hidden panels retaining focus', () => {
  const helper = source('lib/dashboardFocus.js')
  for (const dashboard of ['pages/tenant/dashboard.js', 'pages/owner/dashboard.js', 'pages/admin/dashboard.js']) {
    const dashboardSource = source(dashboard)
    assert.match(dashboardSource, /dashboardPanelProps/)
    assert.match(dashboardSource, /prepareDashboardTabFocus/)
  }
  assert.match(helper, /currentPanel\.contains\(activeElement\)/)
  assert.match(helper, /activeElement\.blur\(\)/)
  assert.match(helper, /focusDashboardPanel\(scope, nextTab\)/)
  assert.match(helper, /'aria-hidden': active \? 'false' : 'true'/)
  assert.match(helper, /inert: active \? undefined : ''/)
  assert.match(helper, /tabIndex: active \? -1 : undefined/)
})

test('new non-imported tenant first payment still allocates to first cycle', () => {
  const row = tenant({ rent_amount: 15000, move_in_date: '2026-07-16', rent_status: 'pending', pending_amount: 15000, total_paid: 0 })
  const result = calculateCanonicalRentDue(row, [realJulyPayment()], new Date(2026, 6, 17))
  assert.strictEqual(result.baselinePaidPeriods, 0)
  assert.strictEqual(result.paidPeriods, 1)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(localDate(result.nextDueDate), '2026-08-16')
})

test('same-day higher-rent room change accepts split payments exactly', () => {
  const row = tenant({
    id: 'room-change-tenant',
    move_in_date: '2026-08-04',
    rent_amount: 14999,
    rent_status: 'paid',
    pending_amount: 0,
    created_at: '2026-08-04T04:00:00.000Z',
  })
  const payments = [
    payment({
      id: 'old-room-rent',
      tenant_id: row.id,
      amount: 7500,
      payment_date: '2026-08-04',
    }),
    payment({
      id: 'room-rent-difference',
      tenant_id: row.id,
      amount: 7499,
      payment_date: '2026-08-04',
    }),
  ]

  const result = calculateCanonicalRentDue(
    row,
    payments,
    new Date(2026, 7, 4, 12)
  )

  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(localDate(result.nextDueDate), '2026-09-04')
})

test('fully funded future room-rent cycle is shown as paid in advance', () => {
  const row = tenant({
    id: 'room-change-tenant',
    move_in_date: '2026-08-04',
    rent_amount: 14999,
    rent_status: 'paid',
    pending_amount: 0,
    created_at: '2026-08-04T04:00:00.000Z',
  })
  const payments = [
    payment({
      id: 'old-room-rent',
      tenant_id: row.id,
      amount: 7500,
      payment_date: '2026-08-04',
    }),
    payment({
      id: 'room-rent-difference',
      tenant_id: row.id,
      amount: 7499,
      payment_date: '2026-08-04',
    }),
    payment({
      id: 'false-one-rupee-collection',
      tenant_id: row.id,
      amount: 1,
      payment_method: 'owner_collection',
      payment_date: '2026-08-04',
    }),
    payment({
      id: 'remaining-future-rent',
      tenant_id: row.id,
      amount: 14998,
      payment_date: '2026-08-04',
    }),
  ]

  const result = calculateCanonicalRentDue(
    row,
    payments,
    new Date(2026, 7, 4, 12)
  )

  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(localDate(result.paidThroughDate), '2026-09-04')
  assert.strictEqual(localDate(result.nextDueDate), '2026-10-04')
  assert.strictEqual(
    formatRentDueDetail(result, localDate),
    'Next rent due: 2026-10-04'
  )
})

test('rent payment method casing and missing payment_type do not exclude legitimate rent', () => {
  const row = tenant({ rent_amount: 15000, move_in_date: '2026-07-16' })
  for (const method of ['upi', 'Upi', 'UPI']) {
    const result = calculateCanonicalRentDue(row, [payment({ amount: 15000, payment_method: method, status: 'success', payment_type: undefined, payment_date: '2026-07-16' })], new Date(2026, 6, 17))
    assert.strictEqual(result.status, 'paid', method)
    assert.strictEqual(result.dueAmount, 0, method)
  }
})

test('security deposit and deposit payments remain excluded from rent coverage', () => {
  const row = tenant({ rent_amount: 15000, move_in_date: '2026-07-16' })
  for (const method of ['security_deposit', 'deposit']) {
    const result = calculateCanonicalRentDue(row, [payment({ amount: 15000, payment_method: method, status: 'success', payment_date: '2026-07-16' })], new Date(2026, 6, 17))
    assert.strictEqual(result.status, 'overdue', method)
    assert.strictEqual(result.dueAmount, 15000, method)
  }
})

test('payment on due date and UTC Kolkata boundary allocate to intended cycle', () => {
  const row = tenant({ rent_amount: 15000, move_in_date: '2026-07-16' })
  const dueDatePayment = payment({ amount: 15000, payment_method: 'upi', status: 'success', payment_date: '2026-07-16', created_at: '2026-07-15T19:00:00.000Z' })
  const result = calculateCanonicalRentDue(row, [dueDatePayment], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'paid')
  assert.strictEqual(result.dueAmount, 0)
  assert.strictEqual(localDate(result.dueDate), '2026-08-16')
})

test('realtime success update recomputes tenant and owner canonical status to paid', () => {
  const row = tenant({ rent_amount: 15000, move_in_date: '2026-07-16' })
  const pending = payment({ amount: 15000, payment_method: 'upi', status: 'payment_pending', payment_date: '2026-07-16' })
  const confirmed = { ...pending, status: 'success' }
  assert.strictEqual(calculateCanonicalRentDue(row, [pending], new Date(2026, 6, 17)).status, 'pending_confirmation')
  const tenantResult = calculateCanonicalRentDue(row, [confirmed], new Date(2026, 6, 17))
  const ownerResult = enrichTenantRentStatus(row, [confirmed], new Date(2026, 6, 17))
  assert.strictEqual(tenantResult.status, 'paid')
  assert.strictEqual(ownerResult.status, 'paid')
  assert.strictEqual(ownerResult.dueAmount, 0)
})

test('partial rent payment leaves only the correct current-cycle balance', () => {
  const row = importedJunePaidTenant()
  const result = calculateCanonicalRentDue(row, [realJulyPayment({ amount: 6000 })], new Date(2026, 6, 17))
  assert.strictEqual(result.status, 'overdue')
  assert.strictEqual(result.dueAmount, 9000)
  assert.strictEqual(localDate(result.currentCycleDueDate), '2026-07-16')
  assert.strictEqual(result.paidAmountForOpenCycle, 6000)
})

test('future August payment is not allocated back to July once July is covered', () => {
  const augustPayment = realJulyPayment({ id: 'august-rent', payment_date: '2026-08-16' })
  const result = calculateCanonicalRentDue(importedJunePaidTenant(), [realJulyPayment(), augustPayment], new Date(2026, 6, 17))
  assert.strictEqual(result.paidPeriods, 2)
  assert.deepStrictEqual(result.cycleAllocations[1].paymentIds, ['a9f39d84-9d54-4a14-8d12-72494c024c74'])
  assert.deepStrictEqual(result.cycleAllocations[2].paymentIds, ['august-rent'])
})

test('tenant and owner canonical summaries agree for imported July payment and realtime success update advances once', () => {
  const row = importedJunePaidTenant()
  const pending = realJulyPayment({ status: 'payment_pending' })
  const confirmed = { ...pending, status: 'success' }
  const pendingResult = calculateCanonicalRentDue(row, [pending], new Date(2026, 6, 17))
  assert.strictEqual(pendingResult.status, 'pending_confirmation')
  assert.strictEqual(localDate(pendingResult.currentCycleDueDate), '2026-07-16')
  const tenantResult = calculateCanonicalRentDue(row, [confirmed], new Date(2026, 6, 17))
  const ownerResult = enrichTenantRentStatus(row, [confirmed], new Date(2026, 6, 17))
  assert.strictEqual(tenantResult.status, 'paid')
  assert.strictEqual(ownerResult.status, 'paid')
  assert.strictEqual(localDate(tenantResult.nextDueDate), '2026-08-16')
  assert.strictEqual(localDate(ownerResult.nextDueDate), '2026-08-16')
  assert.notStrictEqual(localDate(tenantResult.nextDueDate), '2026-09-16')
})

test('tenant dashboard distinguishes total paid from current pending amount', () => {
  const tenantDashboard = source('pages/tenant/dashboard.js')
  const tenantMobileDashboard = source('components/tenant/mobile/TenantMobileDashboard.js')
  assert.match(tenantDashboard, /Total Paid/)
  assert.match(tenantDashboard, /rentStatus\.dueAmount/)
  assert.match(tenantMobileDashboard, /Total paid/)
  assert.doesNotMatch(tenantMobileDashboard, /label="Paid"/)
})

test('phone login accepts supported Indian phone formats', () => {
  assert.strictEqual(normalizeIndianPhone('9876543210'), '9876543210')
  assert.strictEqual(normalizeIndianPhone('+91 98765-43210'), '9876543210')
  assert.strictEqual(normalizeIndianPhone('91 98765 43210'), '9876543210')
  assert.strictEqual(normalizeIndianPhone('(09876) 543210'), '9876543210')
  assert.strictEqual(normalizeIndianPhone('12345'), '')
  assert.deepStrictEqual(phoneLoginVariants('9876543210'), ['9876543210', '919876543210', '+919876543210'])
})

test('phone resolver returns a unique active users-table match', async () => {
  const result = await resolvePhoneLoginEmail({
    supabase: fakeSupabase({ users: [{ id: 'u1', email: 'user@example.com', phone: '+919876543210', is_active: true }] }),
    phone: '9876543210',
    logger: { warn() {} },
  })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.email, 'user@example.com')
  assert.strictEqual(result.source, 'users')
})

test('phone resolver falls back to an active tenant linked user', async () => {
  const result = await resolvePhoneLoginEmail({
    supabase: fakeSupabase({
      users: [{ id: 'u1', email: 'tenant@example.com', phone: '', is_active: true }],
      tenants: [{ id: 't1', user_id: 'u1', phone: '919876543210', status: 'active' }],
    }),
    phone: '+91 98765 43210',
    logger: { warn() {} },
  })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.email, 'tenant@example.com')
  assert.strictEqual(result.source, 'tenants')
})

test('phone resolver rejects duplicate active matches generically', async () => {
  const result = await resolvePhoneLoginEmail({
    supabase: fakeSupabase({
      users: [
        { id: 'u1', email: 'one@example.com', phone: '9876543210', is_active: true },
        { id: 'u2', email: 'two@example.com', phone: '+919876543210', is_active: true },
      ],
    }),
    phone: '9876543210',
    logger: { warn() {} },
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.reason, 'duplicate_active_users')
  assert.strictEqual(result.publicMessage, 'No account found with this phone number.')
})

test('phone resolver rejects inactive accounts and archived tenants', async () => {
  const inactive = await resolvePhoneLoginEmail({
    supabase: fakeSupabase({ users: [{ id: 'u1', email: 'inactive@example.com', phone: '9876543210', is_active: false }] }),
    phone: '9876543210',
    logger: { warn() {} },
  })
  assert.strictEqual(inactive.ok, false)
  const archived = await resolvePhoneLoginEmail({
    supabase: fakeSupabase({
      users: [{ id: 'u1', email: 'tenant@example.com', phone: '', is_active: true }],
      tenants: [{ id: 't1', user_id: 'u1', phone: '9876543210', status: 'archived' }],
    }),
    phone: '9876543210',
    logger: { warn() {} },
  })
  assert.strictEqual(archived.ok, false)
})

test('phone login keeps rate limiting and service role server-side', () => {
  const apiSource = source('pages/api/auth/resolve-phone.js')
  const loginSource = source('pages/login.js')
  assert.match(apiSource, /phone-resolution-ip/)
  assert.match(apiSource, /phone-resolution-phone/)
  assert.match(apiSource, /identifier: normalizedPhone/)
  assert.strictEqual(loginSource.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.strictEqual(apiSource.includes('.maybeSingle()'), false)
})

test('email login path remains unchanged and phone errors are not duplicated visibly', () => {
  const loginSource = source('pages/login.js')
  assert.match(loginSource, /const result = await signInWithEmail\(emailToUse, password\)/)
  assert.match(loginSource, /if \(isPhone\(identifier\)\)/)
  assert.match(loginSource, /else if \(!isEmail\(identifier\)\)/)
  assert.strictEqual((loginSource.match(/No account found with this phone number\./g) || []).length, 1)
})

test('mobile tenants layout does not require horizontal scrolling', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.strictEqual(mobileTenants.includes('overflow-x-auto'), false)
  assert.strictEqual(mobileTenants.includes('shrink-0 rounded-full px-3'), false)
  assert.match(mobileTenants, /grid grid-cols-3 gap-1/)
  assert.match(mobileTenants, /min-\[380px\]:grid-cols-5/)
})

test('mobile tenant summary totals are shown only once', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.strictEqual((mobileTenants.match(/role="tablist"/g) || []).length, 1)
  assert.match(mobileTenants, /SUMMARY_FILTERS\.map/)
  assert.strictEqual(mobileTenants.includes('{counts[item]}'), false)
})

test('top mobile tenant summary buttons perform filtering', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.match(mobileTenants, /const SUMMARY_FILTERS = \[/)
  assert.match(mobileTenants, /\['all', 'Total'\]/)
  assert.match(mobileTenants, /\['due', 'Due'\]/)
  assert.match(mobileTenants, /\['pending_confirmation', 'Pending'\]/)
  assert.match(mobileTenants, /\['paid', 'Paid'\]/)
  assert.match(mobileTenants, /\['upcoming', 'Upcoming'\]/)
  assert.match(mobileTenants, /onClick=\{\(\) => setFilter\(item\)\}/)
})

test('active mobile tenant summary state updates clearly', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.match(mobileTenants, /aria-selected=\{active\}/)
  assert.match(mobileTenants, /active \? 'border-orange-400 bg-orange-500 text-white'/)
})

test('mobile tenant filters remain usable at 320px width', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.match(mobileTenants, /min-h-11 min-w-0 rounded-xl/)
  assert.match(mobileTenants, /aria-label=\{`Show \$\{label\.toLowerCase\(\)\} tenants: \$\{value\}`\}/)
})

test('mobile tenant card markup is compact', () => {
  const mobileTenants = source('components/owner/mobile/OwnerMobileTenants.js')
  assert.strictEqual(mobileTenants.includes('min-h-[82px]'), false)
  assert.strictEqual(mobileTenants.includes('rounded-3xl border border-white/10 bg-white p-2.5'), false)
  assert.match(mobileTenants, /min-h-\[64px\]/)
  assert.match(mobileTenants, /h-8 w-8 shrink-0 rounded-full/)
})

test('owner section navigation keeps shell visible and avoids blank dynamic sections', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /<MobileBottomNav items=\{ownerBottomItems\}/)
  assert.match(ownerDashboard, /function OwnerSectionSkeleton/)
  assert.match(ownerDashboard, /loading: sectionLoading/)
  assert.strictEqual(ownerDashboard.includes('setLoading(true); setActiveTab'), false)
})

test('owner valid tab click updates visible tab before shallow routing', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  const openSection = ownerDashboard.match(/const openSection = \(tab\) => \{[\s\S]*?\n  \};/)?.[0] || ''
  assert.ok(openSection.indexOf('setActiveTab(nextTab);') > -1)
  assert.ok(openSection.indexOf('pushDashboardHistory(router, href)') > -1)
  assert.ok(openSection.indexOf('setActiveTab(nextTab);') < openSection.indexOf('pushDashboardHistory(router, href)'))
  assert.match(openSection, /requestAnimationFrame\(\(\) => \{[\s\S]*pushDashboardHistory\(router, href\)/)
})

test('first visit to a main owner mobile tab mounts it immediately', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /const MAIN_OWNER_MOBILE_TABS = \[/)
  assert.match(ownerDashboard, /const PERSISTENT_OWNER_MOBILE_TABS = \[/)
  assert.match(ownerDashboard, /mountedMobileTabs\.has\(tab\) \|\| tab === activeTab/)
  for (const tab of ['COMPLAINTS', 'NOTICES', 'ANALYTICS', 'MEMBERSHIP']) {
    assert.match(ownerDashboard, new RegExp(`OWNER_VIEW_KEYS\\.${tab}`))
  }
})

test('returning to a visited owner mobile tab does not remount it', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /const \[mountedMobileTabs, setMountedMobileTabs\] = useState\(\(\) => new Set/)
  assert.match(ownerDashboard, /if \(previous\.has\(activeTab\)\) return previous/)
  assert.match(ownerDashboard, /const next = new Set\(previous\)/)
})

test('switching main owner mobile tabs never renders an empty content container', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /data-owner-mobile-mounted-tabs/)
  assert.match(ownerDashboard, /data-owner-mobile-tab=\{tab\}/)
  assert.match(ownerDashboard, /<OwnerMobileTabPanel key=\{tab\} tab=\{tab\} active=\{activeTab === tab\}>/)
  assert.match(ownerDashboard, /dashboardPanelProps\('owner', tab, active\)/)
  assert.match(ownerDashboard, /PERSISTENT_OWNER_MOBILE_TABS\.includes\(activeTab\)/)
})

test('owner dashboard full-page skeleton is limited to initial load without usable data', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /const hasUsableDashboardData = Boolean\(property\?\.id\) \|\| safeRooms\.length > 0 \|\| safeTenants\.length > 0/)
  assert.match(ownerDashboard, /if \(loading && !hasUsableDashboardData\) \{[\s\S]*<DashboardSkeleton cards=\{12\}/)
  assert.strictEqual(ownerDashboard.includes('OwnerDashboardContent key='), false)
  assert.strictEqual(ownerDashboard.includes('isDesktopDashboard === null) return <DashboardSkeleton'), false)
})

test('OwnerDashboardContent does not declare hooks after early returns', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  const componentStart = ownerDashboard.indexOf('function OwnerDashboardContent()')
  assert.notStrictEqual(componentStart, -1)
  const componentSource = ownerDashboard.slice(componentStart)
  const firstEarlyReturn = componentSource.indexOf('if (loading && !hasUsableDashboardData)')
  assert.notStrictEqual(firstEarlyReturn, -1)
  const afterEarlyReturn = componentSource.slice(firstEarlyReturn)
  assert.strictEqual(/\buse(?:State|Effect|Memo|Callback|Ref|Owner|DesktopDashboard|BodyScrollLock|ExistingTenantImports|OwnerAnalytics)\s*\(/.test(afterEarlyReturn), false)
  assert.strictEqual(componentSource.includes('const ownerViewTitleFor = useCallback'), false)
})

test('owner same-tab click does not trigger reload or refetch', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  const sameTabBlock = ownerDashboard.match(/if \(!router\.isReady \|\| nextTab === activeTab\) \{[\s\S]*?\n    \}/)?.[0] || ''
  assert.match(sameTabBlock, /setMobileMenu\(null\)/)
  assert.match(sameTabBlock, /setProfileMenuOpen\(false\)/)
  assert.match(sameTabBlock, /return/)
  assert.strictEqual(sameTabBlock.includes('pushDashboardHistory'), false)
  assert.strictEqual(sameTabBlock.includes('loadData('), false)
})

test('owner browser back and forward still resolve correct section', () => {
  assert.strictEqual(resolveDashboardQuery('owner', { tab: 'rooms' }).view, 'rooms')
  assert.strictEqual(resolveDashboardQuery('owner', { tab: 'tenants' }).view, 'tenants')
  assert.strictEqual(resolveDashboardQuery('owner', { tab: 'rent-payments' }).view, 'rent-payments')
})

test('active tab changes do not refetch owner core data', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  const appSource = source('pages/_app.js')
  assert.strictEqual(/useEffect\([\s\S]*?loadData\([\s\S]*?\], \[[^\]]*activeTab/.test(ownerDashboard), false)
  assert.match(appSource, /const errorBoundaryKey = isDashboardRoute \? router\.pathname : router\.asPath/)
  assert.strictEqual(appSource.includes('<ErrorBoundary key={router.asPath}>'), false)
  assert.strictEqual(appSource.includes('[router.pathname, router.asPath]'), false)
})

test('owner core tenant data renders without waiting for signed photo URLs', () => {
  const ownerContext = source('context/OwnerContext.js')
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.strictEqual(ownerContext.includes('loadTenantPhotoUrls'), false)
  assert.strictEqual(ownerContext.includes('setTenants(await'), false)
  assert.match(ownerContext, /setTenants\(tenantsWithRoomNumber\)/)
  assert.match(ownerDashboard, /getOwnerTenantProfilePhotoUrls\(tenantRows\)/)
})

test('owner payment data is seeded by core load and refreshes without duplicate requests', () => {
  const ownerContext = source('context/OwnerContext.js')
  const ownerPayments = source('hooks/useOwnerPayments.js')
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerContext, /const \[paymentSeed, setPaymentSeed\]/)
  assert.match(ownerContext, /setPaymentSeed\(current => \(\{[\s\S]*pendingRentPayments: pendingSeed,[\s\S]*allPayments: allPaymentsResult\.data \|\| \[\]/)
  assert.match(ownerDashboard, /useOwnerPayments\(property, tenants, archivedTenants, setStats, loadData, propertyReady, paymentSeed\)/)
  assert.strictEqual(ownerDashboard.includes('refreshPayments'), false)
  assert.strictEqual(ownerPayments.includes("useRealtimeRefresh"), false)
  assert.match(ownerPayments, /const \[pendingResult, allResult\] = await Promise\.all\(\[/)
})

test('owner background refresh preserves existing data on empty or failed refresh', () => {
  const ownerContext = source('context/OwnerContext.js')
  assert.match(ownerContext, /if \(isBackground\) return null;\s*setProperty\(null\); setRooms\(\[\]\); setTenants\(\[\]\);/)
  assert.match(ownerContext, /catch \(error\) \{[\s\S]*if \(!isBackground\) toast\.error/)
})

test('owner core load is deduped by identity and in-flight requests', () => {
  const ownerContext = source('context/OwnerContext.js')
  assert.match(ownerContext, /const inFlightLoadRef = useRef\(null\)/)
  assert.match(ownerContext, /const lastLoadedKeyRef = useRef\(null\)/)
  assert.match(ownerContext, /load-joined-in-flight/)
  assert.match(ownerContext, /load-skipped-cached/)
  assert.match(ownerContext, /ownerLoadKey\(userId, requestedPropertyId\)/)
  assert.match(ownerContext, /if \(!force && lastLoadedPropertyRef\.current/)
})

test('owner realtime patches local records without full core reload', () => {
  const ownerContext = source('context/OwnerContext.js')
  const realtimeBlock = ownerContext.match(/useEffect\(\(\) => \{\s*if \(!property\?\.id\)[\s\S]*?owner:\$\{property\.owner_id\}:property:\$\{property\.id\}:core[\s\S]*?\n  \}, \[property\?\.id, property\?\.owner_id, patchPaymentRealtime, patchRoomRealtime, patchTenantRealtime\]\);/)?.[0] || ''
  assert.match(ownerContext, /const patchTenantRealtime = useCallback/)
  assert.match(ownerContext, /const patchPaymentRealtime = useCallback/)
  assert.match(ownerContext, /realtime-local-patch/)
  assert.match(ownerContext, /createRealtimeChannel\(supabase, channelName\)/)
  assert.match(ownerContext, /pendingRentConfirmations: nextPending\.length/)
  assert.strictEqual(realtimeBlock.includes('loadData('), false)
})

test('scoped realtime channels and diagnostics are used for core dashboards', () => {
  const ownerContext = source('context/OwnerContext.js')
  const tenantContext = source('context/TenantContext.js')
  const realtimeHelper = source('lib/realtime.js')
  assert.match(ownerContext, /owner:\$\{property\.owner_id\}:property:\$\{property\.id\}:core/)
  assert.match(tenantContext, /tenant:\$\{tenant\.id\}:user:\$\{tenant\.user_id\}:property:\$\{property\.id\}:core/)
  assert.match(realtimeHelper, /hostelsetRealtimeDebug/)
  assert.match(realtimeHelper, /duplicate-channel-prevented/)
  assert.match(realtimeHelper, /subscribe-status/)
  assert.match(source('lib/supabase.js'), /syncRealtimeAuth\(supabase, session\)/)
})

test('browse hostels uses SWR cache, public-safe realtime, and compact dark cards', () => {
  const browseSource = source('pages/properties.js')
  assert.match(browseSource, /hostelsetBrowseProperties:v2/)
  assert.match(browseSource, /sessionStorage\.setItem\(BROWSE_CACHE_KEY/)
  assert.match(browseSource, /setRefreshing\(true\)/)
  assert.match(browseSource, /useRealtimeRefresh\('public:properties:availability', \['properties', 'rooms'\]/)
  assert.doesNotMatch(browseSource, /\['properties', 'rooms', 'tenants'\]/)
  assert.match(browseSource, /dark:bg-slate-950/)
  assert.match(browseSource, /xl:grid-cols-4/)
  assert.match(browseSource, /aspect-\[16\/9\]/)
  assert.match(browseSource, /loading=\{index < 2 \? 'eager' : 'lazy'\}/)
  assert.match(browseSource, /hostelsetBrowsePerf/)
})

test('owner core reads independent data concurrently', () => {
  const ownerContext = source('context/OwnerContext.js')
  assert.match(ownerContext, /const \[\{ data: roomsData[\s\S]*allPaymentsResult\] = await Promise\.all\(\[/)
  for (const label of ['rooms', 'active-tenants', 'archived-tenants', 'rent-status-payments', 'pending-payments', 'payment-history']) {
    assert.match(ownerContext, new RegExp(`timedOwnerQuery\\('${label}'`))
  }
})

test('owner payments hook does not clear lists before ordinary reloads', () => {
  const ownerPayments = source('hooks/useOwnerPayments.js')
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.strictEqual(/useEffect\(\(\) => \{\s*setPendingRentPayments\(\[\]\);\s*setAllPayments\(\[\]\);/.test(ownerPayments), false)
  assert.match(ownerPayments, /loadedKeyRef\.current === nextKey/)
  assert.match(ownerPayments, /initialPayments\?\.version/)
  assert.strictEqual(ownerPayments.includes('loadData(true)'), false)
  assert.strictEqual(ownerDashboard.includes('loadData(true)'), false)
})

test('owner mobile tab data derivations are memoized instead of recomputed every render', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  for (const name of [
    'filteredRooms',
    'tenantsWithPhotos',
    'searchedTenants',
    'tenantRentCounts',
    'filteredPendingPayments',
    'filteredAllPayments',
    'searchGroups',
    'mobileOverviewCounts',
  ]) {
    assert.match(ownerDashboard, new RegExp(`const ${name} = useMemo`))
  }
  assert.strictEqual(/const filteredRooms = safeRooms\.filter/.test(ownerDashboard), false)
})

test('heavy owner mobile sections have memo boundaries for hidden mounted tabs', () => {
  for (const file of [
    'components/owner/mobile/OwnerMobileDashboard.js',
    'components/owner/mobile/OwnerMobileRooms.js',
    'components/owner/mobile/OwnerMobileTenants.js',
    'components/owner/mobile/OwnerMobilePayments.js',
  ]) {
    const mobileSource = source(file)
    assert.match(mobileSource, /import \{[^}]*memo/)
    assert.match(mobileSource, /export default memo\(/)
  }
})

test('owner mobile hidden tabs receive stable callback props where possible', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /function useStableCallback/)
  assert.match(ownerDashboard, /const openSectionStable = useStableCallback\(openSection\)/)
  assert.match(ownerDashboard, /const navigateDashboardBackStable = useStableCallback\(navigateDashboardBack\)/)
  assert.match(ownerDashboard, /onNavigate=\{openSectionStable\}/)
  assert.match(ownerDashboard, /onBack=\{navigateDashboardBackStable\}/)
})

test('owner mobile navigation profiler is opt-in and development-only', () => {
  const ownerDashboard = source('pages/owner/dashboard.js')
  assert.match(ownerDashboard, /function markOwnerPerf/)
  assert.match(ownerDashboard, /hostelsetOwnerPerf/)
  assert.match(ownerDashboard, /process\.env\.NODE_ENV === 'production' && !\['localhost', '127\.0\.0\.1'\]/)
  assert.match(ownerDashboard, /visible-commit/)
  assert.match(ownerDashboard, /router-push-start/)
  assert.match(ownerDashboard, /router-push-finish/)
})

test('rent reminder worker repairs before-due and due-today queue rows without resending completed reminders', () => {
  const repositorySource = source('supabase/functions/_shared/supabase-rent-reminder-repository.ts')
  const scheduleSource = source('supabase/functions/_shared/rent-reminder-schedule.ts')
  assert.match(repositorySource, /repairReadyInitialReminders/)
  assert.match(repositorySource, /\.in\("due_date", \[today, beforeDueDate\]\)/)
  assert.match(repositorySource, /resettable = new Set\(\["pending", "failed", "cancelled"\]\)/)
  assert.match(repositorySource, /onConflict: "rent_id,reminder_type,reminder_sequence"/)
  assert.match(scheduleSource, /reminder_type: "before_due"/)
  assert.match(scheduleSource, /reminder_type: "due_today"/)
  assert.match(scheduleSource, /rent\.due_date === beforeDueDate/)
  assert.match(scheduleSource, /rent\.due_date === today/)
})

test('rent reminder dry-run is authorized, read-only, and does not call Brevo', () => {
  const functionSource = source('supabase/functions/process-rent-reminders/index.ts')
  const dryRunSource = source('supabase/functions/_shared/rent-reminder-dry-run.ts')
  assert.match(functionSource, /if \(!authorized\(request\)\) return json\(\{ error: "Unauthorized" \}, 401\)/)
  assert.match(functionSource, /if \(body\.dryRun\)/)
  assert.ok(functionSource.indexOf('if (body.dryRun)') < functionSource.indexOf('const emailService = createBrevoEmailService'))
  assert.strictEqual(dryRunSource.includes('.upsert('), false)
  assert.strictEqual(dryRunSource.includes('.update('), false)
  assert.strictEqual(dryRunSource.includes('.insert('), false)
  assert.strictEqual(dryRunSource.includes('BREVO_API_KEY'), false)
  assert.match(dryRunSource, /tenantEmailPresent/)
  assert.match(dryRunSource, /tenantEmailDomain/)
  assert.strictEqual(dryRunSource.includes('tenantName'), false)
})

test('rent reminder template names match database and Brevo mapping', () => {
  const typesSource = source('supabase/functions/_shared/rent-reminder-types.ts')
  const brevoSource = source('supabase/functions/_shared/brevo-email-service.ts')
  const dryRunSource = source('supabase/functions/_shared/rent-reminder-dry-run.ts')
  for (const type of ['before_due', 'due_today', 'overdue_2_days', 'weekly_overdue']) {
    assert.match(typesSource, new RegExp(`"${type}"`))
    assert.match(brevoSource, new RegExp(`${type}: positiveInteger`))
    assert.match(dryRunSource, new RegExp(`${type}`))
  }
  for (const envName of ['BREVO_RENT_BEFORE_DUE_TEMPLATE_ID', 'BREVO_RENT_DUE_TODAY_TEMPLATE_ID', 'BREVO_RENT_OVERDUE_2_DAYS_TEMPLATE_ID', 'BREVO_RENT_WEEKLY_OVERDUE_TEMPLATE_ID']) {
    assert.match(brevoSource, new RegExp(envName))
    assert.match(dryRunSource, new RegExp(envName))
  }
})

test('prebooking fee displayed publicly cannot be inserted as zero by the visitor API', () => {
  const propertySource = source('pages/property/[id].js')
  const visitorSubmitSource = source('pages/api/visitor/submit.js')
  const ownerContextSource = source('context/OwnerContext.js')
  const settingsModalSource = source('components/owner/modals/SettingsModal.js')
  assert.match(propertySource, /const DEFAULT_PREBOOKING_FEE = 3000/)
  assert.match(propertySource, /pre_booking_fee: Number\(settings\?\.pre_booking_fee\) > 0 \? Number\(settings\.pre_booking_fee\) : DEFAULT_PREBOOKING_FEE/)
  assert.match(visitorSubmitSource, /const DEFAULT_PREBOOKING_FEE = 3000/)
  assert.match(visitorSubmitSource, /const preBookingFee = Number\.isFinite\(configuredFee\) && configuredFee > 0[\s\S]*Number\(room\.deposit_amount \|\| DEFAULT_PREBOOKING_FEE\)/)
  assert.match(visitorSubmitSource, /pre_booking_fee_amount: preBookingFee/)
  assert.doesNotMatch(visitorSubmitSource, /pre_booking_fee_amount:\s*Number\(settings\.pre_booking_fee \|\| 0\)/)
  assert.match(ownerContextSource, /pre_booking_fee:3000/)
  assert.match(settingsModalSource, /Pre-booking fee/)
})

test('public prebooking UI is reservation-capacity aware', () => {
  const propertySource = source('pages/property/[id].js')
  assert.match(propertySource, /buildReservationCounts/)
  assert.match(propertySource, /get_public_property_rooms/)
  assert.match(propertySource, /reserved_prebooking_count/)
  assert.match(propertySource, /unreserved bed/)
  assert.match(propertySource, /Next vacancy already booked/)
  assert.match(
    propertySource,
    /const capacity[\s\S]*const activeReservations[\s\S]*physicalAvailableSlots - activeReservations/
  )
  assert.match(propertySource, /openPrebookModal\(room\.id, roomVacate\?\.vacateDate\)/)
})

test('owner overview is the primary workspace for imports and prebookings', () => {
  const ownerDashboardSource = source('pages/owner/dashboard.js')
  const mobileOverviewSource = source('components/owner/mobile/OwnerMobileDashboard.js')
  const statsCardsSource = source('components/owner/StatsCards.js')
  assert.match(ownerDashboardSource, /Pending Existing Tenant Imports/)
  assert.match(ownerDashboardSource, /Pending Pre-bookings/)
  assert.match(ownerDashboardSource, /Quick Review/)
  assert.match(ownerDashboardSource, /existingImports\.latestPending/)
  assert.match(ownerDashboardSource, /pendingPreBookings/)
  assert.match(mobileOverviewSource, /Pre-bookings/)
  assert.match(mobileOverviewSource, /Imports/)
  assert.match(statsCardsSource, /Pre-bookings/)
})

test('owner request hooks use property-scoped realtime and server-side rejection RPCs', () => {
  const ownerApplicationsSource = source('hooks/useOwnerApplications.js')
  const ownerPrebookingsSource = source('hooks/useOwnerPreBookings.js')
  const existingImportsSource = source('hooks/useExistingTenantImports.js')
  const ownerPreBookingListSource = source('components/owner/PreBookingList.js')
  assert.match(ownerApplicationsSource, /filter: `property_id=eq\.\$\{property\.id\}`/)
  assert.match(ownerPrebookingsSource, /filter: `property_id=eq\.\$\{property\.id\}`/)
  assert.doesNotMatch(ownerPrebookingsSource, /reserved_prebooking_count/)
  assert.match(ownerPreBookingListSource, /reservedCountsByRoom/)
  assert.match(ownerPreBookingListSource, /activeReservations >= capacity/)
  assert.match(ownerPreBookingListSource, /Reservation capacity reached/)
  assert.match(ownerApplicationsSource, /rpc\('reject_application'/)
  assert.match(ownerPrebookingsSource, /rpc\('reject_prebooking'/)
  assert.match(existingImportsSource, /const \[latestPending, setLatestPending\]/)
  assert.match(existingImportsSource, /\.limit\(5\)/)
})

test('approval API delegates tenant creation to canonical RPC transaction', () => {
  const approveApiSource = source('pages/api/requests/approve.js')
  assert.match(approveApiSource, /rpc\('approve_application_atomic', \{ p_application_id: id, p_user_id: userId \}\)/)
  assert.doesNotMatch(approveApiSource, /from\('applications'\)\.update\(\{ user_id: userId \}\)/)
  assert.match(approveApiSource, /rpc\('reserve_prebooking_atomic', \{ p_booking_id: id \}\)/)
  assert.doesNotMatch(approveApiSource, /inviteTenantForSetup\(\{ email: booking\.email/)
  assert.match(approveApiSource, /These details belong to an existing non-tenant account/)
})

test('prebooking reservation migration defines isolated reservation and conversion protections', () => {
  const migrationSource = source('supabase/migrations/202607170005_prebooking_reservation_workflow.sql')
  assert.match(migrationSource, /create or replace function public\.reserve_prebooking_atomic\(p_booking_id uuid\)/)
  assert.match(migrationSource, /create or replace function public\.approve_prebooking_atomic\(p_booking_id uuid, p_user_id uuid\)[\s\S]*reserve_prebooking_atomic/)
  assert.match(migrationSource, /create or replace function public\.convert_reserved_prebooking_to_tenant/)
  assert.match(migrationSource, /drop index if exists public\.prebookings_one_reserved_room_uidx/)
  assert.doesNotMatch(migrationSource, /create unique index if not exists prebookings_one_reserved_room_uidx/)
  assert.match(migrationSource, /active_reservations >= coalesce\(room_record\.capacity, 0\)/)
  assert.match(migrationSource, /order by reserved_booking\.reserved_at asc nulls last, reserved_booking\.created_at asc, reserved_booking\.id asc/)
  assert.match(migrationSource, /payment_history_one_prebooking_payment_uidx/)
  assert.match(migrationSource, /status in \('pending','approved','rejected','reserved','converted','cancelled','refunded'\)/)
  assert.match(migrationSource, /Pre-booking fee amount is invalid/)
})

Promise.all(asyncTests).catch(error => {
  console.error(error)
  process.exitCode = 1
})
