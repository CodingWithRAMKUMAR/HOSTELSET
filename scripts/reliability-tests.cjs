const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { calculateCanonicalRentDue, anchoredDate, formatRentDueLabel } = require('../lib/rentDue')
const { enrichTenantRentStatus, filterTenantsByRentStatus, summarizeTenantRentStatuses } = require('../lib/tenantRentStatus')
const { resolveDashboardQuery, buildDashboardHref, dashboardHrefToPath, isCanonicalDashboardQuery } = require('../lib/dashboardRouting')
const { normalizePrivateDocumentPath, createExpiringRequestCache } = require('../lib/privateDocument')
const {
  MAX_PROFILE_PHOTO_SIZE,
  buildProfilePhotoPath,
  getProfilePhotoExtension,
  isIdentityDocumentPath,
  safeLegacyProfilePhotoPath,
  safeProfilePhotoPath,
  safeTenantProfilePhotoPath,
  validateProfilePhotoUpload,
} = require('../lib/profilePhoto')
const { isDashboardPath } = require('../lib/routeScope')
const { normalizeIndianPhone, phoneLoginVariants } = require('../lib/server/phoneLogin')

const id = '123e4567-e89b-42d3-a456-426614174000'
const tenant = { move_in_date:'2026-06-16', rent_amount:10000, status:'active' }
const due = (payments, now = new Date(2026,5,20)) => calculateCanonicalRentDue(tenant, payments, now)
const payment = (overrides = {}) => ({ id:crypto.randomUUID(), status:'success', payment_method:'upi', amount:10000, payment_date:'2026-07-16', ...overrides })

// Owner and Tenant call this same helper with the same tenant-specific records.
const records = [payment()]
assert.deepEqual(calculateCanonicalRentDue(tenant, records, new Date(2026,6,20)), calculateCanonicalRentDue(tenant, records, new Date(2026,6,20)))
assert.equal(due([]).dueDate.toDateString(), new Date(2026,5,16).toDateString())
assert.equal(due([], new Date(2026,5,16)).status, 'due_today')
assert.equal(due([], new Date(2026,6,20)).dueDate.toDateString(), new Date(2026,5,16).toDateString())
assert.equal(due(records, new Date(2026,6,20)).dueDate.toDateString(), new Date(2026,6,16).toDateString())
assert.equal(calculateCanonicalRentDue({ rent_start_date:'2026-06-16', rent_amount:10000, status:'active' }, [], new Date(2026,6,14)).status, 'overdue')
assert.equal(calculateCanonicalRentDue({ rent_start_date:'2026-06-16', rent_amount:10000, status:'active' }, [], new Date(2026,6,14)).daysUntilDue, -28)
for (const excluded of [
  payment({payment_method:'security_deposit'}), payment({payment_method:'pre_booking'}), payment({payment_method:'joining_fee'}), payment({status:'payment_pending'}), payment({status:'rejected'}), payment({amount:5000}),
]) assert.equal(due([excluded]).dueDate.getMonth(), 5)
const duplicate = payment({ id:'same-payment' })
assert.equal(due([duplicate, duplicate]).dueDate.getMonth(), 6)
assert.equal(anchoredDate({year:2026,month:1,day:29},1).getDate(), 28)
assert.equal(anchoredDate({year:2026,month:1,day:30},1).getDate(), 28)
assert.equal(anchoredDate({year:2026,month:1,day:31},1).getDate(), 28)
assert.equal(anchoredDate({year:2024,month:1,day:31},1).getDate(), 29)
assert.equal(formatRentDueLabel({status:'due_soon',daysUntilDue:5}), 'Due in 5 days')
assert.equal(formatRentDueLabel({status:'due_soon',daysUntilDue:1}), 'Due tomorrow')
assert.equal(formatRentDueLabel({status:'due_today',daysUntilDue:0}), 'Due today')
assert.equal(formatRentDueLabel({status:'overdue',daysUntilDue:-1}), 'Overdue by 1 day')
assert.equal(formatRentDueLabel({status:'overdue',daysUntilDue:-3}), 'Overdue by 3 days')
assert.equal(formatRentDueLabel({status:'paid'}), 'Paid')
assert.equal(formatRentDueLabel({status:'inactive',message:'Tenancy inactive'}), 'Tenancy inactive')
assert.equal(formatRentDueLabel({status:'unknown',message:'Due date unavailable'}), 'Due date unavailable')
const rentFixture = daysUntilDue => ({ id:`tenant-${daysUntilDue}`, status:'active', dueStatus:{ status:daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : 'due_soon', dueDate:new Date(2026,6,14 + daysUntilDue), daysUntilDue, paidPeriods:0 } })
for (const days of [3,2,1]) assert.equal(enrichTenantRentStatus(rentFixture(days)).category, 'upcoming', `${days} days must be upcoming`)
assert.equal(enrichTenantRentStatus(rentFixture(0)).category, 'due')
assert.equal(enrichTenantRentStatus(rentFixture(-1)).category, 'due')
assert.equal(enrichTenantRentStatus({ id:'far-due', status:'active', dueStatus:{ status:'paid', dueDate:new Date(2026,7,16), daysUntilDue:33, paidPeriods:2 } }).category, 'paid')
assert.equal(enrichTenantRentStatus({ id:'paid', status:'active', dueStatus:{ status:'paid', dueDate:null, daysUntilDue:null, paidForCurrentCycle:true } }).category, 'paid')
assert.equal(enrichTenantRentStatus({ id:'inactive', status:'inactive', dueStatus:{ status:'inactive' } }).isActive, false)
assert.equal(enrichTenantRentStatus({ id:'paid-upcoming', status:'active', dueStatus:{ status:'due_soon', daysUntilDue:2, paidPeriods:2 } }).category, 'upcoming')
const rentRows = [rentFixture(3), rentFixture(2), rentFixture(1), rentFixture(0), rentFixture(-1), { id:'far-due', status:'active', dueStatus:{ status:'paid', daysUntilDue:20, paidPeriods:1 } }, { id:'paid', status:'active', dueStatus:{ status:'paid', paidForCurrentCycle:true } }, { id:'inactive', status:'inactive', dueStatus:{ status:'inactive' } }]
assert.equal(filterTenantsByRentStatus(rentRows, 'upcoming').length, 3)
assert.equal(filterTenantsByRentStatus(rentRows, 'due').length, 2)
assert.equal(filterTenantsByRentStatus(rentRows, 'paid').length, 2)
assert.equal(filterTenantsByRentStatus(rentRows, 'all').length, 7)
assert.deepEqual(summarizeTenantRentStatuses(rentRows), { paid:2, due:2, upcoming:3, pending_confirmation:0, pendingAmount:0, total:7 })
assert.equal(enrichTenantRentStatus(rentFixture(1)).label, 'Due tomorrow')
assert.equal(enrichTenantRentStatus(rentFixture(-5)).label, 'Overdue by 5 days')
assert.equal(enrichTenantRentStatus({ status:'active', dueStatus:{ status:'paid', daysUntilDue:10, paidPeriods:1 } }).label, 'Paid')
assert.equal(enrichTenantRentStatus({ rent_start_date:'2026-07-12', rent_amount:10000, status:'active' }, [], new Date(2026,6,14)).label, 'Overdue by 2 days')
assert.equal(enrichTenantRentStatus({ rent_start_date:'2026-07-12', rent_amount:10000, status:'active' }, [], new Date(2026,6,14)).category, 'due')
const paidPreviousCycle = [payment({ id:'paid-june-cycle', payment_date:'2026-06-16' })]
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,12)).category, 'paid')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,13)).label, 'Due in 3 days')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,13)).category, 'upcoming')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,14)).label, 'Due in 2 days')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,14)).category, 'upcoming')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,15)).label, 'Due tomorrow')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,16)).category, 'due')
assert.equal(enrichTenantRentStatus(tenant, paidPreviousCycle, new Date(2026,6,17)).label, 'Overdue by 1 day')
assert.equal(enrichTenantRentStatus(tenant, [], new Date(2026,6,14)).dueDate.toDateString(), new Date(2026,5,16).toDateString(), 'oldest unpaid cycle must not advance to the next month')
assert.equal(enrichTenantRentStatus(tenant, [], new Date(2026,6,14)).category, 'due')
assert.equal(enrichTenantRentStatus(tenant, [], new Date(2026,6,14)).label, 'Overdue by 28 days')
const importedPaidBaseline = { id:'its-me', status:'active', move_in_date:'2026-06-16', created_at:'2026-07-11T13:58:10.116607', rent_amount:8000, pending_amount:0, total_paid:0, rent_status:'paid' }
assert.equal(enrichTenantRentStatus(importedPaidBaseline, [], new Date(2026,6,14)).dueDate.toDateString(), new Date(2026,6,16).toDateString(), 'paid imported baseline must cover only cycles before import/creation')
assert.equal(enrichTenantRentStatus(importedPaidBaseline, [], new Date(2026,6,14)).category, 'upcoming')
assert.equal(enrichTenantRentStatus(importedPaidBaseline, [], new Date(2026,6,14)).label, 'Due in 2 days')
const ramFixture = { id:'ram', status:'active', move_in_date:'2026-07-12', created_at:'2026-07-12T07:52:03.040997', rent_amount:8000, pending_amount:8000, total_paid:0, rent_status:'pending' }
assert.equal(enrichTenantRentStatus(ramFixture, [payment({ payment_method:'security_deposit', amount:3000, payment_date:'2026-07-12' })], new Date(2026,6,14)).category, 'due')
assert.equal(enrichTenantRentStatus(ramFixture, [payment({ payment_method:'security_deposit', amount:3000, payment_date:'2026-07-12' })], new Date(2026,6,14)).label, 'Overdue by 2 days')
const expectedProductionRows = [importedPaidBaseline, ramFixture].map(row => ({ ...row, rentSummary: enrichTenantRentStatus(row, row.id === 'ram' ? [payment({ payment_method:'security_deposit', amount:3000, payment_date:'2026-07-12' })] : [], new Date(2026,6,14)) }))
assert.deepEqual(summarizeTenantRentStatuses(expectedProductionRows), { paid:0, due:1, upcoming:1, pending_confirmation:0, pendingAmount:16000, total:2 })

const mappings = {
  owner: { application:'applications', import:'existing-imports', payment:'rent-payments', complaint:'complaints', 'room-change':'room-change', vacate:'vacate', notice:'notices', membership:'membership', 'archived-tenant':'archived-tenants' },
  tenant: { payment:'payments', notice:'notices', complaint:'complaints', 'room-change':'room-change', vacate:'vacate' },
  admin: { property:'properties', membership:'membership', payment:'payments', application:'applications', complaint:'complaints', 'room-change':'roomchange', vacate:'vacate' },
}
const idKeys = { owner:{ applications:'application_id','existing-imports':'import_id','rent-payments':'payment_id',complaints:'complaint_id','room-change':'request_id',vacate:'request_id',notices:'notice_id',membership:'membership_id','archived-tenants':'tenant_id' }, tenant:{payments:'payment_id',notices:'notice_id',complaints:'complaint_id','room-change':'request_id',vacate:'request_id'}, admin:{properties:'property_id',membership:'membership_id',payments:'payment_id',applications:'application_id',complaints:'complaint_id',roomchange:'request_id',vacate:'request_id'} }
for (const [role, roleMappings] of Object.entries(mappings)) for (const [tab, expected] of Object.entries(roleMappings)) {
  const key = idKeys[role][expected]
  const resolved = resolveDashboardQuery(role, { tab, [key]:id })
  assert.equal(resolved.view, expected); assert.equal(resolved.recordId, id)
  assert.equal(resolveDashboardQuery(role, { tab, [key]:'not-a-uuid' }).recordId, null)
  assert.equal(resolveDashboardQuery(role, { tab:'unknown' }).view, 'overview')
}

assert.equal(normalizePrivateDocumentPath('tenant-documents/property/payments/proof.png'),'property/payments/proof.png')
assert.equal(normalizePrivateDocumentPath('tenant-documents/123e4567-e89b-42d3-a456-426614174000/imports/photos/p.png'),'123e4567-e89b-42d3-a456-426614174000/imports/photos/p.png')
assert.equal(normalizePrivateDocumentPath('https://project.supabase.co/storage/v1/object/public/tenant-documents/123e4567-e89b-42d3-a456-426614174000/imports/identity/id.pdf', { supabaseUrl:'https://project.supabase.co' }),'123e4567-e89b-42d3-a456-426614174000/imports/identity/id.pdf')
for (const bad of ['', 'https://example.com/a', 'blob:x', 'data:image/png,x', '../secret', 'bad//path', 'bad?x=1']) assert.equal(normalizePrivateDocumentPath(bad),null)
for (const bad of ['tenant-documents/../secret', 'https://project.supabase.co/storage/v1/object/public/wrong-bucket/a.png', 'https://project.supabase.co/storage/v1/object/sign/tenant-documents/a.png?token=temp', 'https://evil.supabase.co/storage/v1/object/public/tenant-documents/a.png']) assert.equal(normalizePrivateDocumentPath(bad, { supabaseUrl:'https://project.supabase.co' }),null)
// Private document path normalization edge cases.
for (const value of [null, undefined, 123, {}, []]) {
  assert.equal(
    normalizePrivateDocumentPath(value),
    null,
    'non-string document paths must be rejected'
  )
}

assert.equal(
  normalizePrivateDocumentPath('  /tenant-documents/property/payments/proof.png  '),
  'property/payments/proof.png',
  'whitespace, leading slashes, and the bucket prefix must be normalized'
)

assert.equal(
  normalizePrivateDocumentPath(
    'https://project.supabase.co/storage/v1/object/tenant-documents/property/imports/id.pdf',
    { supabaseUrl: 'https://project.supabase.co' }
  ),
  'property/imports/id.pdf',
  'legacy private storage URLs must normalize to an object path'
)

assert.equal(
  normalizePrivateDocumentPath(
    'https://project.supabase.co/storage/v1/object/public/tenant-documents/property/proof%2D1.png',
    { supabaseUrl: 'https://project.supabase.co' }
  ),
  'property/proof-1.png',
  'valid encoded path characters must be decoded'
)

assert.equal(
  normalizePrivateDocumentPath(
    'https://project.supabase.co/storage/v1/object/public/tenant-documents/property/%2e%2e/secret.pdf',
    { supabaseUrl: 'https://project.supabase.co' }
  ),
  null,
  'encoded traversal paths must be rejected'
)

assert.equal(
  normalizePrivateDocumentPath(
    'property-photos/property-1/front.png',
    { bucket: 'property-photos' }
  ),
  'property-1/front.png',
  'custom storage buckets must normalize correctly'
)

for (const value of [
  'tenant-documents/folder/file name.pdf',
  'tenant-documents/folder\\file.pdf',
  'tenant-documents/folder/\u092B\u093E\u0907\u0932.pdf',
]) {
  assert.equal(
    normalizePrivateDocumentPath(value),
    null,
    'unsupported path characters must be rejected'
  )
}

const maxPrivateDocumentPath = 'a'.repeat(1024)
assert.equal(
  normalizePrivateDocumentPath(maxPrivateDocumentPath),
  maxPrivateDocumentPath,
  'a 1024-character path must remain valid'
)
assert.equal(
  normalizePrivateDocumentPath('a'.repeat(1025)),
  null,
  'paths longer than 1024 characters must be rejected'
)

// Profile photo MIME and upload-size boundaries.
assert.equal(getProfilePhotoExtension('image/jpeg'), 'jpg')
assert.equal(getProfilePhotoExtension('image/png'), 'png')
assert.equal(getProfilePhotoExtension('image/webp'), 'webp')
assert.equal(getProfilePhotoExtension('image/jpg'), null)
assert.equal(getProfilePhotoExtension('image/gif'), null)
assert.equal(getProfilePhotoExtension('image/svg+xml'), null)

assert.deepEqual(
  validateProfilePhotoUpload({ contentType: 'image/jpeg', size: 1 }),
  { ok: true, extension: 'jpg' }
)
assert.deepEqual(
  validateProfilePhotoUpload({
    contentType: 'image/webp',
    size: MAX_PROFILE_PHOTO_SIZE,
  }),
  { ok: true, extension: 'webp' }
)

for (const contentType of [
  '',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'IMAGE/JPEG',
]) {
  assert.equal(
    validateProfilePhotoUpload({ contentType, size: 1024 }).ok,
    false,
    'unsupported profile photo MIME types must be rejected'
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
  MAX_PROFILE_PHOTO_SIZE + 1,
]) {
  assert.equal(
    validateProfilePhotoUpload({ contentType: 'image/png', size }).ok,
    false,
    'profile photo size must be a safe integer within the byte limit'
  )
}

// Profile photo path ownership and identity boundaries.
const profilePropertyId = '11111111-1111-4111-8111-111111111111'
const profileTenantId = '22222222-2222-4222-8222-222222222222'
const otherProfileTenantId = '33333333-3333-4333-8333-333333333333'
const tenantProfilePath =
  '11111111-1111-4111-8111-111111111111/profile-photos/22222222-2222-4222-8222-222222222222/avatar.png'
const generatedProfilePhotoPath = buildProfilePhotoPath(
  profilePropertyId,
  profileTenantId,
  'image/jpeg'
)

assert.equal(
  generatedProfilePhotoPath.startsWith(
    '11111111-1111-4111-8111-111111111111/profile-photos/22222222-2222-4222-8222-222222222222/'
  ),
  true
)
assert.equal(generatedProfilePhotoPath.endsWith('.jpg'), true)
assert.equal(buildProfilePhotoPath('', profileTenantId, 'image/jpeg'), '')
assert.equal(buildProfilePhotoPath(profilePropertyId, '', 'image/jpeg'), '')
assert.equal(buildProfilePhotoPath(profilePropertyId, profileTenantId, 'image/gif'), '')

assert.equal(
  safeProfilePhotoPath('  ' + tenantProfilePath + '  ', profilePropertyId),
  tenantProfilePath,
  'valid profile photo paths must be trimmed and preserved'
)
assert.equal(
  safeTenantProfilePhotoPath(tenantProfilePath, profilePropertyId, profileTenantId),
  tenantProfilePath
)
assert.equal(
  safeTenantProfilePhotoPath(tenantProfilePath, profilePropertyId),
  tenantProfilePath
)
assert.equal(
  safeTenantProfilePhotoPath(tenantProfilePath, profilePropertyId, otherProfileTenantId),
  '',
  'a tenant-specific path must not cross tenant directories'
)
assert.equal(
  safeProfilePhotoPath(tenantProfilePath, '44444444-4444-4444-8444-444444444444'),
  '',
  'a profile photo path must not cross property directories'
)

for (const unsafePath of [
  '',
  '/' + tenantProfilePath,
  'https://project.supabase.co/' + tenantProfilePath,
  'blob:' + tenantProfilePath,
  'data:image/png,' + tenantProfilePath,
  profilePropertyId + '/profile-photos/' + profileTenantId + '/../secret.png',
]) {
  assert.equal(
    safeProfilePhotoPath(unsafePath, profilePropertyId),
    '',
    'unsafe profile photo path forms must be rejected'
  )
}

const encodedTraversalPhotoPath =
  '11111111-1111-4111-8111-111111111111/profile-photos/22222222-2222-4222-8222-222222222222/%2e%2e/other/avatar.png'
assert.equal(
  safeTenantProfilePhotoPath(
    encodedTraversalPhotoPath,
    profilePropertyId,
    profileTenantId
  ),
  '',
  'encoded traversal must not pass tenant profile photo path validation'
)

const validEncodedProfilePhotoPath =
  '11111111-1111-4111-8111-111111111111/profile-photos/22222222-2222-4222-8222-222222222222/avatar%2D1.png'
assert.equal(
  safeTenantProfilePhotoPath(
    validEncodedProfilePhotoPath,
    profilePropertyId,
    profileTenantId
  ),
  validEncodedProfilePhotoPath,
  'valid encoded filename characters must remain supported'
)

const malformedEncodedProfilePhotoPath =
  '11111111-1111-4111-8111-111111111111/profile-photos/22222222-2222-4222-8222-222222222222/avatar%ZZ.png'
assert.equal(
  safeTenantProfilePhotoPath(
    malformedEncodedProfilePhotoPath,
    profilePropertyId,
    profileTenantId
  ),
  '',
  'malformed profile photo encoding must be rejected'
)

const importedProfilePhotoPath =
  '11111111-1111-4111-8111-111111111111/imports/photos/import-avatar.webp'
const applicationProfilePhotoPath =
  '11111111-1111-4111-8111-111111111111/photos/application-avatar.jpg'
assert.equal(
  safeLegacyProfilePhotoPath(
    importedProfilePhotoPath,
    profilePropertyId,
    'existing_tenant_import'
  ),
  importedProfilePhotoPath
)
assert.equal(
  safeLegacyProfilePhotoPath(
    applicationProfilePhotoPath,
    profilePropertyId,
    'application'
  ),
  applicationProfilePhotoPath
)
assert.equal(
  safeLegacyProfilePhotoPath(
    applicationProfilePhotoPath,
    profilePropertyId,
    'pre_booking'
  ),
  applicationProfilePhotoPath
)
assert.equal(
  safeLegacyProfilePhotoPath(
    importedProfilePhotoPath,
    profilePropertyId,
    'application'
  ),
  ''
)
assert.equal(
  safeLegacyProfilePhotoPath(
    applicationProfilePhotoPath,
    profilePropertyId,
    'existing_tenant_import'
  ),
  ''
)

for (const identityPath of [
  profilePropertyId + '/photos/identity/photo.jpg',
  profilePropertyId + '/photos/id-proof/photo.jpg',
  profilePropertyId + '/photos/aadhaar/photo.jpg',
  profilePropertyId + '/photos/aadhar/photo.jpg',
]) {
  assert.equal(isIdentityDocumentPath(identityPath), true)
  assert.equal(
    safeLegacyProfilePhotoPath(identityPath, profilePropertyId, 'application'),
    '',
    'identity documents must never be exposed as profile photos'
  )
}

assert.equal(dashboardHrefToPath(buildDashboardHref('owner', 'overview')), '/owner/dashboard')
assert.equal(dashboardHrefToPath(buildDashboardHref('owner', 'imports')), '/owner/dashboard?tab=existing-imports')
assert.equal(dashboardHrefToPath(buildDashboardHref('owner', 'rooms')), '/owner/dashboard?tab=rooms')
assert.equal(dashboardHrefToPath(buildDashboardHref('owner', 'tenants')), '/owner/dashboard?tab=tenants')
assert.equal(dashboardHrefToPath(buildDashboardHref('admin', 'room-change')), '/admin/dashboard?tab=roomchange')
assert.equal(dashboardHrefToPath(buildDashboardHref('tenant', 'payments')), '/tenant/dashboard?tab=payments')
assert.equal(isCanonicalDashboardQuery('owner', { tab:'imports' }), false)
assert.equal(isCanonicalDashboardQuery('owner', { tab:'existing-imports' }), true)
assert.equal(isCanonicalDashboardQuery('owner', { tab:'unknown' }), false)
assert.equal(isCanonicalDashboardQuery('owner', {}), true)
assert.equal(isDashboardPath('/owner/dashboard'), true)
assert.equal(isDashboardPath('/tenant/dashboard'), true)
assert.equal(isDashboardPath('/admin/dashboard'), true)
for (const publicPath of ['/', '/property/example', '/properties', '/login/tenant', '/register', '/faq']) assert.equal(isDashboardPath(publicPath), false)
assert.equal(normalizeIndianPhone('+91 98765-43210'), '9876543210')
assert.deepEqual(phoneLoginVariants('9876543210'), ['9876543210', '919876543210', '+919876543210'])

const source = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const roomIsAvailable = room => ['vacant', 'occupied'].includes(room.status) && room.current_occupants < room.capacity
const availabilityFixtures = Array.from({ length:9 }, (_, index) => ({ id:index, status:'vacant', current_occupants:index < 2 ? 1 : 0, capacity:2 }))
assert.equal(availabilityFixtures.filter(roomIsAvailable).length, 9, 'tenant count must not be subtracted from room count')
availabilityFixtures[0].current_occupants = 2; availabilityFixtures[1].current_occupants = 2
assert.equal(availabilityFixtures.filter(roomIsAvailable).length, 7, 'full rooms must be excluded')
assert.equal([{status:'vacant',current_occupants:0,capacity:1}].filter(roomIsAvailable).length, 1)
assert.equal([...availabilityFixtures, {status:'archived',current_occupants:0,capacity:2}].filter(roomIsAvailable).length, 7, 'inactive room states must be excluded')
const propertySource = source('pages/property/[id].js')
const ownerDashboardSource = source('pages/owner/dashboard.js')
const tenantDashboardSource = source('pages/tenant/dashboard.js')
const adminDashboardSource = source('pages/admin/dashboard.js')
const dashboardRoutingSource = source('lib/dashboardRouting.js')
const tenantContextSource = source('context/TenantContext.js')
const adminContextSource = source('context/AdminContext.js')
const tenantPaymentsSource = source('hooks/usePayments.js')
const tenantNoticesSource = source('hooks/useNotices.js')
const tenantComplaintsSource = source('hooks/useComplaints.js')
const tenantVacateSource = source('hooks/useVacate.js')
const tenantRoomChangeSource = source('hooks/useRoomChange.js')
const adminMembershipSource = source('hooks/useAdminMembershipManager.js')
const importListSource = source('components/owner/ExistingTenantImportList.js')
const importDocumentApiSource = source('pages/api/owner/import-document-url.js')
const importUploadApiSource = source('pages/api/import/upload-url.js')
const importSubmitApiSource = source('pages/api/import/submit.js')
const supabaseClientSource = source('lib/supabase.js')
const globalCssSource = source('styles/globals.css')
assert.match(globalCssSource, /\.dashboard-shell\s*\{[\s\S]*box-sizing:\s*border-box/)
assert.equal(/\.dashboard-shell\s*\{[\s\S]*max-width:\s*100vw/.test(globalCssSource), false, 'dashboard shell must not use 100vw with sidebar padding')
assert.match(ownerDashboardSource, /className="dashboard-content"/, 'desktop owner shell must wrap header and main in a single shrinkable content column')
assert.match(globalCssSource, /\.dashboard-content\s*\{[\s\S]*min-width:\s*0/, 'dashboard content column must be able to shrink')
assert.match(globalCssSource, /\.dashboard-content\s*\{[\s\S]*flex:\s*1 1 auto/, 'desktop dashboard content must take remaining sidebar width through flex')
assert.equal(/\.dashboard-shell\s*\{[^}]*padding-left:\s*15\.\d*rem/.test(globalCssSource), false, 'desktop shell must not offset fixed sidebar with content padding')
assert.equal(/\.dashboard-sidebar\s*\{[^}]*position:\s*fixed/.test(globalCssSource), false, 'desktop sidebar must not be fixed over a padded viewport shell')
for (const unsafeDashboardSelector of ['[class*="p-6"]', '[class*="text-xl"]', '[class*="space-y-6"]']) assert.equal(globalCssSource.includes(unsafeDashboardSelector), false, 'dashboard CSS must not rewrite broad nested Tailwind utility substrings')
assert.equal(ownerDashboardSource.includes('dashboard-main container mx-auto'), false, 'owner dashboard main must not use Tailwind container inside sidebar shell')
assert.equal((ownerDashboardSource.match(/renderOwnerOverview\(\)/g) || []).length <= 2, true, 'owner overview must not have duplicate detached render paths')
assert.match(ownerDashboardSource, /function useDesktopDashboard\(\)/, 'owner dashboard must gate mobile/desktop shells from one media query')
assert.match(ownerDashboardSource, /OWNER_DESKTOP_MIN_WIDTH = 1280/, 'owner desktop shell must wait for enough sidebar + content width')
assert.equal(ownerDashboardSource.includes("matchMedia('(min-width: 1024px)'"), false, 'owner dashboard must not use the unsafe 1024px desktop threshold')
assert.match(globalCssSource, /@media \(min-width:1280px\) \{[\s\S]*\.dashboard-sidebar/, 'desktop sidebar CSS must use the same safe desktop threshold')
assert.equal(/@media \(min-width:1024px\) \{[\s\S]*\.dashboard-sidebar/.test(globalCssSource), false, 'desktop sidebar must not appear at tablet widths')
assert.equal(ownerDashboardSource.includes('isDesktopDashboard === null) return <DashboardSkeleton'), false, 'owner dashboard must not show a full-page skeleton only because the shell media query is resolving')
assert.match(ownerDashboardSource, /if \(loading && !hasUsableDashboardData\)/, 'owner dashboard full-page skeleton must be limited to initial load without usable data')
assert.equal(/<OwnerMobileDashboard[\s\S]*<main className="dashboard-main[\s\S]*<OwnerMobileDashboard/.test(ownerDashboardSource), false, 'owner overview must not duplicate mobile and desktop overview render paths')
assert.match(importUploadApiSource, /storage\.from\('tenant-documents'\)\.createSignedUploadUrl\(path\)/, 'existing import uploads must target private tenant documents')
assert.match(importUploadApiSource, /return res\.status\(200\)\.json\(\{ path, token: data\.token \}\)/, 'existing import uploads must return stable path and upload token only')
assert.match(importSubmitApiSource, /id_proof: idProof, profile_photo: profilePhoto/, 'existing import submit must store stable private object paths')
assert.equal(/signedUrl|signed_url/.test(importSubmitApiSource), false, 'existing import submit must not store temporary signed URLs')
assert.match(importListSource, /onViewDocument\(item, documentType\)/, 'existing import document buttons must use secure click handler')
assert.match(importListSource, /Opening document\.\.\./, 'existing import document buttons must show opening state')
assert.equal(/href=\{item\.(profile_photo|id_proof)\}/.test(importListSource), false, 'existing import list must not open raw private paths')
assert.match(supabaseClientSource, /body:\s*JSON\.stringify\(\{\s*importId,\s*documentType/, 'existing import signing request must send import id and document type')
assert.equal(/body:\s*JSON\.stringify\(\{[\s\S]{0,160}path/.test(supabaseClientSource), false, 'browser must not supply arbitrary import document paths')
assert.match(supabaseClientSource, /openSignedPrivateDocument/, 'click-only import opening helper must request a fresh signed URL')
assert.match(supabaseClientSource, /forceRefresh:\s*true/, 'explicit document clicks must bypass stale negative cache')
assert.match(supabaseClientSource, /window\.open\('', '_blank'\)/, 'document preview window must open synchronously without noopener so the reference is retained')
assert.match(supabaseClientSource, /previewWindow\.location\.replace\(url\)/, 'document preview must navigate the retained window to the signed URL')
assert.equal(/window\.open\('', '_blank', 'noopener/.test(supabaseClientSource), false, 'document preview placeholder must not use noopener because it drops the window reference')
assert.match(importDocumentApiSource, /DOCUMENT_FIELDS\s*=\s*\{\s*id_proof:\s*'id_proof',\s*photo:\s*'profile_photo'\s*\}/, 'owner import document endpoint must restrict allowed document types')
assert.match(importDocumentApiSource, /normalizePrivateDocumentPath/, 'owner import document endpoint must normalize legacy private paths')
assert.match(importDocumentApiSource, /properties'[\s\S]*owner_id/, 'owner import document endpoint must verify property ownership')
assert.match(importDocumentApiSource, /property\?\.owner_id !== auth\.user\.id/, 'owner import document endpoint must reject cross-property access')
assert.match(importDocumentApiSource, /objectExists\(objectPath\)/, 'owner import document endpoint must distinguish missing objects safely')
assert.match(importDocumentApiSource, /storage\.from\(BUCKET\)\.createSignedUrl\(objectPath, 300\)/, 'owner import document endpoint must sign only resolved object paths')
assert.equal(/req\.body\.(path|objectPath|storagePath)/.test(importDocumentApiSource), false, 'owner import document endpoint must never trust browser-supplied storage paths')
assert.equal(source('hooks/useExistingTenantImports.js').includes('signPrivateDocumentFields'), false, 'existing imports list loading must not eagerly sign documents')
assert.equal(/window\.history\[\`\$\{mode\}State\`\]/.test(dashboardRoutingSource), false, 'dashboard section navigation must not mutate native history behind Next router')
assert.match(dashboardRoutingSource, /router\[mode\]\(href, undefined, \{ shallow: true, scroll: false \}\)/, 'dashboard history helper must use shallow Next router navigation')
assert.match(ownerDashboardSource, /pushDashboardHistory\(router, href\)/, 'owner section navigation must push shallow same-page history')
assert.match(ownerDashboardSource, /replaceDashboardHistory\(router, buildDashboardHref\('owner', resolved\.view, router\.query\)\)/, 'owner invalid tabs must normalize with replace')
assert.match(ownerDashboardSource, /nextTab === activeTab[\s\S]*return/, 'owner same-tab click must not push duplicate history')
assert.match(ownerDashboardSource, /navigateDashboardBack[\s\S]*replaceDashboardHistory\(router, buildDashboardHref\('owner', OWNER_VIEW_KEYS\.OVERVIEW[\s\S]*router\.back\(\)/, 'owner topbar back must use canonical dashboard navigation')
assert.equal(/navigateDashboardBack[\s\S]{0,600}signOut/.test(ownerDashboardSource), false, 'owner back handler must not call logout')
assert.match(tenantDashboardSource, /pushDashboardHistory\(router, href\)/, 'tenant section navigation must push shallow same-page history')
assert.match(adminDashboardSource, /pushDashboardHistory\(router, href\)/, 'admin section navigation must push shallow same-page history')
assert.equal(/navigateDashboardBack[\s\S]{0,600}signOut/.test(tenantDashboardSource), false, 'tenant back handler must not call logout')
assert.equal(/navigateDashboardBack[\s\S]{0,600}signOut/.test(adminDashboardSource), false, 'admin back handler must not call logout')
assert.match(source('pages/_app.js'), /const errorBoundaryKey = isDashboardRoute \? router\.pathname : router\.asPath/, 'dashboard error boundary must not remount on query-only navigation')
assert.match(source('pages/_app.js'), /\}, \[router\.pathname\]\)/, 'dashboard auth guard must not rerun only because tab query changed')
assert.match(tenantContextSource, /inFlightLoadRef/, 'tenant data loads must have an in-flight guard')
assert.match(tenantContextSource, /lastLoadedKeyRef/, 'tenant data loads must cache the last owner\/tenant\/property identity')
assert.match(tenantContextSource, /load-joined-in-flight/, 'tenant duplicate loads must join the existing request')
assert.match(tenantContextSource, /load-skipped-cached/, 'tenant repeated non-force loads must use cached data')
assert.match(tenantContextSource, /tenantLoadKey\(userId, tenantData\.id, tenantData\.property_id\)/, 'tenant load cache identity must include tenant and property ids after resolution')
assert.match(tenantContextSource, /loadTenantProfilePhoto\(tenantData\);[\s\S]*if \(!isBackground\) \{[\s\S]*first-usable-data[\s\S]*setLoading\(false\)/, 'tenant dashboard must become usable before profile photo and secondary data finish')
assert.equal(/setRoommates\(\[\]\)[\s\S]{0,220}isBackground/.test(tenantContextSource), false, 'tenant background refresh must not clear roommate data')
assert.equal(/scheduleRefresh[\s\S]*refreshData\(true\)/.test(tenantContextSource), false, 'tenant realtime must not schedule full core refreshes')
assert.match(tenantContextSource, /patchTenantRealtime/, 'tenant realtime must patch tenant rows locally')
assert.match(tenantContextSource, /patchRoomRealtime/, 'tenant realtime must patch room rows locally')
assert.match(tenantContextSource, /patchRoommateVacateRealtime/, 'tenant realtime must patch roommate vacate alerts locally')
assert.match(tenantContextSource, /tenant:\$\{tenant\.id\}:user:\$\{tenant\.user_id\}:property:\$\{property\.id\}:core/, 'tenant provider realtime channel must be scoped by tenant user and property')
assert.match(source('hooks/usePayments.js'), /tenant:\$\{tenant\.id\}:payments/, 'tenant payment channel name must include tenant id')
assert.match(source('hooks/useComplaints.js'), /tenant:\$\{tenant\.id\}:complaints/, 'tenant complaint channel name must include tenant id')
assert.match(tenantDashboardSource, /TENANT_PERSISTENT_TABS/, 'tenant dashboard must define persistent tab registry')
assert.match(tenantDashboardSource, /const \[mountedTabs, setMountedTabs\] = useState\(\(\) => new Set\(\['overview'\]\)\)/, 'tenant dashboard must remember visited tabs')
assert.match(tenantDashboardSource, /<TenantTabPanel key=\{tab\} tab=\{tab\} active=\{activeTab === tab\}>/, 'tenant dashboard must hide/show mounted tab panels')
assert.match(tenantDashboardSource, /data-tenant-mobile-mounted-tabs/, 'tenant mobile sections must stay mounted after first visit')
assert.equal(/if \(loading \|\| !tenant\)/.test(tenantDashboardSource), false, 'tenant full-page skeleton must not render when cached tenant data exists')
assert.match(tenantDashboardSource, /window\.requestAnimationFrame\?\.\(\(\) => pushDashboardHistory\(router, href\)\)/, 'tenant visible tab state must update before route push work')
assert.equal(/refreshData\(true\)/.test(tenantDashboardSource), false, 'tenant page actions must not trigger full core refresh')
assert.equal(/refreshData\(true\)/.test(tenantPaymentsSource), false, 'tenant payments must not trigger full core refresh after proof or realtime')
assert.equal(/refreshData\(true\)/.test(tenantRoomChangeSource), false, 'tenant room-change actions must not trigger full core refresh')
assert.equal(/payload[\s\S]{0,500}loadPayments\(\)/.test(tenantPaymentsSource), false, 'tenant payment realtime must patch payment rows instead of reloading all payments')
assert.equal(/payload[\s\S]{0,500}loadNotices\(\)/.test(tenantNoticesSource), false, 'tenant notice realtime must patch notice rows instead of reloading all notices')
assert.equal(/payload[\s\S]{0,500}loadComplaints\(\)/.test(tenantComplaintsSource), false, 'tenant complaint realtime must patch complaint rows instead of reloading all complaints')
assert.equal(/payload[\s\S]{0,500}loadVacate\(\)/.test(tenantVacateSource), false, 'tenant vacate realtime must patch request state instead of reloading all vacate state')
assert.equal(/payload[\s\S]{0,500}loadRoomChangeState\(\)/.test(tenantRoomChangeSource), false, 'tenant room-change realtime must patch request state instead of reloading all room-change state')
assert.match(adminContextSource, /inFlightStatsRef/, 'admin stats/core load must have an in-flight guard')
assert.match(adminContextSource, /lastLoadedKeyRef/, 'admin stats/core load must cache by admin identity')
assert.match(adminContextSource, /load-joined-in-flight/, 'admin duplicate stats loads must join existing request')
assert.match(adminContextSource, /load-skipped-cached/, 'admin repeated non-force stats loads must use cached data')
assert.match(adminContextSource, /hostelsetAdminPerf/, 'admin dashboard must expose opt-in performance logging')
assert.match(source('hooks/useRealtimeRefresh.js'), /duplicate-channel-prevented|createRealtimeChannel/, 'authenticated realtime hooks must use duplicate channel prevention')
assert.match(source('hooks/useRealtimeRefresh.js'), /CHANNEL_ERROR/, 'authenticated realtime hooks must reconnect after channel errors')
assert.match(source('hooks/usePublicRealtimeRefresh.js'), /public-safe/, 'public realtime hook must log public-safe refreshes')
assert.match(source('lib/realtime.js'), /hostelsetRealtimeDebug/, 'realtime diagnostics must be opt-in')
assert.match(source('lib/supabase.js'), /syncRealtimeAuth\(supabase, session\)/, 'realtime auth must be resynced after session refresh')
assert.match(adminDashboardSource, /ADMIN_PERSISTENT_TABS/, 'admin dashboard must define persistent tab registry')
assert.match(adminDashboardSource, /const \[mountedTabs, setMountedTabs\] = useState\(\(\) => new Set\(\['overview'\]\)\)/, 'admin dashboard must remember visited tabs')
assert.match(adminDashboardSource, /data-admin-mobile-mounted-tabs/, 'admin mobile sections must stay mounted after first visit')
assert.match(adminDashboardSource, /<AdminTabPanel key=\{tab\} tab=\{tab\} active=\{activeTab === tab\}>/, 'admin mobile tabs must render hidden panels instead of remounting')
assert.match(adminDashboardSource, /mountedTabs\.has\('membership'\)[\s\S]*<AdminTabPanel tab="membership"/, 'admin membership desktop tab must stay mounted after first visit')
assert.match(adminDashboardSource, /mountedTabs\.has\('enterprise'\)[\s\S]*<EnterpriseAdminConsole/, 'admin enterprise console must stay mounted after first visit')
assert.match(adminDashboardSource, /function AdminActionCenter/, 'admin overview must include an Action Center')
assert.match(adminDashboardSource, /Pending memberships/, 'admin Action Center must show pending memberships')
assert.match(adminDashboardSource, /Pending applications/, 'admin Action Center must show pending applications')
assert.match(adminDashboardSource, /Open complaints/, 'admin Action Center must show open complaints')
assert.match(adminDashboardSource, /Pending vacates/, 'admin Action Center must show pending vacate requests')
assert.match(adminDashboardSource, /Room changes/, 'admin Action Center must show pending room changes')
assert.match(adminDashboardSource, /Payment issues/, 'admin Action Center must show payment issues')
assert.match(adminDashboardSource, /membership_id/, 'admin membership cards must preserve focused membership id in URL')
assert.match(adminDashboardSource, /ADMIN_OVERVIEW_QUEUE_TABS/, 'admin overview queue data must load without opening every tab')
assert.match(adminDashboardSource, /window\.requestAnimationFrame\?\.\(\(\) => pushDashboardHistory\(router, href\)\)/, 'admin visible tab state must update before route push work')
assert.match(adminMembershipSource, /properties!properties_owner_id_fkey/, 'admin membership owner list must use explicit owner-property relationship')
assert.match(adminMembershipSource, /owner:users!membership_requests_owner_id_fkey/, 'admin membership requests must use explicit owner relationship')
assert.match(adminMembershipSource, /property:properties!membership_requests_property_id_fkey/, 'admin membership requests must use explicit property relationship')
assert.equal(/properties\(id, name, membership_active, membership_expiry\)/.test(adminMembershipSource), false, 'admin membership owner list must not use ambiguous bare properties embed')
assert.equal(/owner:owner_id\(|property:property_id\(/.test(adminMembershipSource), false, 'admin membership requests must not use ambiguous column pseudo-embeds')
assert.match(adminMembershipSource, /Unknown owner/)
assert.match(adminMembershipSource, /No property linked/)
assert.match(adminMembershipSource, /setRequests\(current => current\.filter\(request => request\.id !== requestId\)\)/, 'membership approval must patch shared request dataset immediately')
const statsCardsSource = source('components/owner/StatsCards.js')
const mobileOverviewSource = source('components/owner/mobile/OwnerMobileDashboard.js')
assert.equal(statsCardsSource.includes('sm:hidden'), false, 'desktop overview stats must not keep a hidden mobile stats tree mounted')
assert.equal(statsCardsSource.includes('bg-white/60'), false, 'overview stat groups must use opaque card backgrounds')
assert.match(mobileOverviewSource, /stablePaint/, 'mobile owner overview must avoid sticky backdrop blur compositor work')
assert.match(source('pages/_app.js'), /publicAuthEntry/, 'authenticated Back to public login/home must restore the dashboard')
assert.equal(ownerDashboardSource.includes('<div className="lg:hidden">'), false, 'owner mobile shell must not be double-gated by Tailwind lg classes')
assert.equal(ownerDashboardSource.includes('dashboard-main mx-auto hidden'), false, 'owner desktop main must not be double-gated by Tailwind lg classes')
assert.equal(ownerDashboardSource.includes('w-screen'), false, 'owner dashboard shell must not use w-screen inside sidebar layout')
assert.equal(ownerDashboardSource.includes('100vw'), false, 'owner dashboard page must not size content to viewport plus sidebar')
const ownerPhotoApiSource = source('pages/api/owner/tenant-profile-photo.js')
const tenantPhotoApiSource = source('pages/api/tenant/profile-photo.js')
const profilePhotoHelperSource = source('lib/profilePhoto.js')
assert.match(ownerPhotoApiSource, /action === 'batch-sign'/, 'owner tenant photos must be batch signed')
assert.match(ownerPhotoApiSource, /profile-photos\/\$\{tenant\.id\}/, 'owner-updated photos must be tenant scoped')
assert.match(ownerPhotoApiSource, /safeTenantProfilePhotoPath/, 'owner-updated photos must use the shared tenant profile path guard')
assert.match(ownerPhotoApiSource, /safeLegacyProfilePhotoPath/, 'owner fallback photos must use the shared legacy profile path guard')
assert.match(tenantPhotoApiSource, /eq\('user_id', auth\.user\.id\)/, 'tenant photo updates must be scoped to self')
assert.match(tenantPhotoApiSource, /profile-photos\/\$\{tenant\.id\}/, 'tenant photo uploads must be tenant scoped')
assert.match(tenantPhotoApiSource, /safeTenantProfilePhotoPath/, 'tenant photo updates must use the shared tenant profile path guard')
assert.match(profilePhotoHelperSource, /aadhaar\|aadhar/, 'identity/Aadhaar document paths must not be accepted as profile photos')
assert.equal(propertySource.includes('absolute bottom-0 left-0 w-full h-0.5'), false, 'property tabs must not render a detached cross-card divider')
assert.equal(propertySource.includes("from '../../lib/supabase'"), false, 'public property must not initialize the persisted auth client')
assert.equal(source('pages/properties.js').includes("from '../lib/supabase'"), false, 'public browse must not initialize the persisted auth client')
const publicClientSource = source('lib/publicSupabase.js')
assert.match(publicClientSource, /persistSession:false/)
assert.match(publicClientSource, /autoRefreshToken:false/)
assert.match(source('pages/index.js'), /public-login-button/)
assert.match(source('styles/globals.css'), /\.dark \.public-login-button[\s\S]*background:#fff !important/)
assert.match(source('pages/_app.js'), /if \(!isDashboardRoute\) return undefined/)
assert.match(source('next.config.js'), /devIndicators:\s*false/)
const authSource = source('lib/supabase.js')
assert.match(authSource, /if \(sessionRestorePromise\) return sessionRestorePromise/)
assert.match(authSource, /staleSessionRecoveryComplete/)
const rentDueSource = source('lib/rentDue.js')
assert.match(rentDueSource, /explicitPaidThroughFromTenant/, 'rent engine must prefer an authoritative paid-through field when present')
assert.match(rentDueSource, /dateOnlyBefore\(firstCycle, proofDate\) \? 1 : 0/, 'legacy imported paid baseline must conservatively cover at most one proven prior cycle')
assert.match(rentDueSource, /isAfterBaseline/, 'payment history must not double-count cycles already covered by import baseline')
assert.equal(rentDueSource.includes('if (confirmedPayments.length > 0) return 0'), false, 'confirmed payments after import must not disable the paid import baseline')
assert.match(source('components/tenant/mobile/TenantMobileDashboard.js'), /Total paid/, 'mobile tenant overview must label cumulative paid amount clearly')
assert.match(source('components/tenant/mobile/TenantMobileDashboard.js'), /formatRentDueDetail\(rentStatus, formatDate\)/, 'mobile tenant status must label next rent due explicitly when paid')
assert.match(source('lib/dashboardFocus.js'), /currentPanel\.contains\(activeElement\)/, 'dashboard focus helper must detect focused descendants before hiding a mounted tab')
assert.match(source('lib/dashboardFocus.js'), /inert: active \? undefined : ''/, 'hidden mounted dashboard panels must be inert')
for (const dashboard of ['pages/tenant/dashboard.js', 'pages/owner/dashboard.js', 'pages/admin/dashboard.js']) {
  const dashboardSource = source(dashboard)
  assert.match(dashboardSource, /dashboardPanelProps/, `${dashboard} must use shared accessible panel props`)
  assert.match(dashboardSource, /prepareDashboardTabFocus/, `${dashboard} must move focus before hiding active panels`)
}
const importMigration = source('supabase/migrations/202607170001_import_paid_through_date.sql')
const importCurrentAnswerMigration = source('supabase/migrations/202607170003_import_current_rent_answer.sql')
assert.match(importMigration, /existing_tenant_imports[\s\S]*paid_through_date date/, 'import migration must add paid-through date to import submissions')
assert.match(importMigration, /tenants[\s\S]*paid_through_date date/, 'import migration must copy a paid-through snapshot to tenants')
assert.match(importCurrentAnswerMigration, /current_rent_cycle_paid boolean/, 'new import migration must store the explicit current-cycle paid answer')
assert.match(importCurrentAnswerMigration, /calculate_imported_tenant_initial_rent_state/, 'new import migration must derive initial database rent fields from the current-cycle answer')
assert.match(importCurrentAnswerMigration, /rent_state\.pending_amount/, 'import approval must not hard-code paid zero rent state')
assert.equal(/current_rent,\s*0,\s*0,\s*'paid'/.test(importCurrentAnswerMigration), false, 'import approval must not always mark imported tenants paid')
assert.match(importMigration, /tenants\.total_paid remains HostelSet-recorded confirmed payment history/, 'migration must document total_paid semantics')
assert.match(source('pages/api/import/submit.js'), /currentRentDueDateFromMoveIn\(moveInDate\)/, 'import API must calculate current rent due date from hostel joined date')
assert.match(source('pages/api/import/submit.js'), /paidThroughDate > currentRentDueDate/, 'import API must reject advance paid-through baselines')
assert.match(source('pages/import/[token].js'), /Has the rent due on/, 'public import form must ask the current-cycle paid question')
assert.match(source('pages/import/[token].js'), /Hostel joined date/, 'public import form must label the tenancy start clearly')
assert.match(source('pages/import/[token].js'), /No, not paid/, 'public import form must support unpaid current-cycle imports')
const enterpriseAdminSource = source('components/admin/EnterpriseAdminConsole.js')
for (const table of ['existing_tenant_imports', 'applications', 'pre_bookings', 'payment_history', 'complaints', 'check_out_requests', 'room_change_requests', 'notices', 'tenants', 'properties', 'rooms', 'users']) {
  assert.match(enterpriseAdminSource, new RegExp(`table: '${table}'`), `enterprise admin console must refresh on ${table}`)
}
const publicAvailabilityMigration = source('supabase/migrations/202607170002_public_availability_visibility.sql')
assert.match(publicAvailabilityMigration, /from public\.rooms room/, 'public visibility must be based on safe room presence, not private tenant presence')
assert.match(publicAvailabilityMigration, /left join tenant_stats/, 'public browse RPC must include active properties with no tenants yet')
assert.match(publicAvailabilityMigration, /create or replace function public\.get_public_property_availability_rows\(\)/, 'public availability RPCs must share one canonical internal query')
assert.equal((publicAvailabilityMigration.match(/from public\.get_public_property_availability_rows\(\) availability/g) || []).length, 2, 'old and v2 public property RPCs must select from the same canonical availability rows')
const reservationMigration = source('supabase/migrations/202607170005_prebooking_reservation_workflow.sql')
assert.match(reservationMigration, /booking\.status = 'reserved'/, 'only reserved prebookings reserve public availability')
assert.match(reservationMigration, /booking\.deleted_at is null/, 'cancelled or soft-deleted prebookings must not reserve public availability')
assert.match(reservationMigration, /create or replace function public\.refresh_room_public_availability\(p_room_id uuid\)/, 'public room flags must use the same reservation semantics as public browse RPCs')
assert.match(reservationMigration, /create or replace function public\.get_public_property_rooms\(p_property_id uuid\)/, 'property detail rooms must expose derived reservation counts through a public RPC')
assert.match(reservationMigration, /booking\.status = 'reserved'[\s\S]*booking\.deleted_at is null[\s\S]*as reserved_prebooking_count/, 'property detail reserved count must be derived from active reserved prebookings')
assert.equal(/reserved_prebooking_count\s*=/.test(reservationMigration), false, 'rooms must not maintain a cached reserved_prebooking_count column')
assert.match(publicAvailabilityMigration, /available_beds_now/, 'public availability must reconcile room occupancy with approved reservations')
assert.match(reservationMigration, /room\.capacity - coalesce\(room\.current_occupants, 0\)/, 'immediate public availability must follow occupancy')
assert.equal(/room\.capacity - coalesce\(room\.current_occupants, 0\) - coalesce\(reservation\.reserved_beds, 0\)/.test(reservationMigration), false, 'future reservations must not consume immediate bed availability')
assert.match(publicAvailabilityMigration, /room\.next_vacate_date is not null and room\.next_vacate_date >= current_date/, 'upcoming public vacancy must be exposed as aggregate room state')
assert.match(publicAvailabilityMigration, /revoke all on function public\.get_public_property_availability_rows\(\) from public, anon, authenticated/, 'canonical internal availability function must not be directly executable by browser roles')
assert.match(publicAvailabilityMigration, /set search_path = ''/, 'security-definer public availability functions must use an empty search_path')
const workflowRepairMigration = source('supabase/migrations/202607170004_prebooking_owner_workflow_repair.sql')
assert.match(workflowRepairMigration, /approve_application_atomic\(p_application_id uuid, p_user_id uuid\)/, 'application approval must accept the resolved tenant user inside the transaction')
assert.match(workflowRepairMigration, /approve_prebooking_atomic\(p_booking_id uuid, p_user_id uuid\)/, 'prebooking approval must run through one canonical transaction')
assert.match(workflowRepairMigration, /reject_application/, 'application rejection must use an RPC with authorization checks')
assert.match(workflowRepairMigration, /reject_prebooking/, 'prebooking rejection must use an RPC with authorization checks')
assert.match(workflowRepairMigration, /tenants_one_active_phone_per_property_uidx/, 'active duplicate tenants must be prevented by phone per property')
assert.match(source('pages/api/visitor/submit.js'), /pre_booking_fee_amount: preBookingFee/, 'visitor submit must persist the canonical prebooking fee')
assert.match(source('pages/api/visitor/submit.js'), /activeReservationCount[\s\S]*>= Number\(room\.capacity/, 'visitor submit must block only when reservation count reaches capacity')
assert.equal(source('pages/api/visitor/submit.js').includes('pre_booking_fee_amount: Number(settings.pre_booking_fee || 0)'), false, 'visitor submit must not collapse missing prebooking settings to zero')
assert.match(source('pages/api/requests/approve.js'), /rpc\('reserve_prebooking_atomic', \{ p_booking_id: id \}\)/, 'prebooking approval must reserve without tenant creation')
assert.equal(/inviteTenantForSetup\(\{ email: booking\.email/.test(source('pages/api/requests/approve.js')), false, 'prebooking reservation must not send tenant setup invitation')
assert.match(reservationMigration, /drop index if exists public\.prebookings_one_reserved_room_uidx/, 'old one-reservation-per-room index must be removed')
assert.equal(/create unique index if not exists prebookings_one_reserved_room_uidx/.test(reservationMigration), false, 'multi-bed rooms must not use a unique room reservation index')
assert.match(reservationMigration, /active_reservations >= coalesce\(room_record\.capacity, 0\)/, 'reservation RPC must enforce reservation count against room capacity')
assert.match(reservationMigration, /convert_reserved_prebooking_to_tenant/, 'conversion must be a separate atomic operation')
assert.match(source('lib/server/prebookingConversion.js'), /resetPasswordForEmail/, 'conversion sends setup email only after conversion RPC success')
assert.match(ownerDashboardSource, /Pending Existing Tenant Imports/, 'owner overview must surface pending imports')
assert.match(ownerDashboardSource, /Pending Pre-bookings/, 'owner overview must surface pending prebookings')
assert.match(source('hooks/useOwnerPreBookings.js'), /filter: `property_id=eq\.\$\{property\.id\}`/, 'owner prebooking realtime must be property scoped')
assert.match(source('hooks/useOwnerApplications.js'), /rpc\('reject_application'/, 'owner application rejection must use server RPC')
assert.match(propertySource, /Copy UPI ID/)
assert.match(propertySource, /Copy Phone Number/)
assert.equal(propertySource.includes('Pay with UPI App'), false)
assert.equal(propertySource.includes('upi:\/\/pay'), false)
const payRentSource = source('components/tenant/modals/PayRentModal.js')
assert.equal(payRentSource.includes('Pay with UPI'), false)
assert.equal(payRentSource.includes('upi://pay'), false)
assert.match(payRentSource, /type="button" onClick=\{\(\) => copyUpiId/)
assert.match(payRentSource, /type="button" onClick=\{\(\) => copyUpiPhone/)
assert.match(propertySource, /type="button" aria-label="Copy owner UPI ID"/)
assert.match(propertySource, /type="button" aria-label="Copy owner payment phone number"/)
assert.match(propertySource, /const \[applicationConsent, setApplicationConsent\] = useState\(false\)/)
assert.match(propertySource, /if \(!applicationConsent\)/)
assert.match(propertySource, /if \(!prebookPolicyConsent\)/)
assert.equal(/JSON\.stringify\(\{[\s\S]{0,800}(applicationConsent|prebookPolicyConsent)/.test(propertySource), false, 'UI consent must not be added to visitor payloads')
const registerSource = source('pages/register.js')
assert.match(registerSource, /const \[policyConsent, setPolicyConsent\] = useState\(false\)/)
assert.match(registerSource, /if \(!policyConsent\)/)
assert.equal(/body:\s*JSON\.stringify\(\{[\s\S]{0,800}policyConsent/.test(registerSource), false, 'UI consent must not be added to registration payload')
const mobileRoomsSource = source('components/owner/mobile/OwnerMobileRooms.js')
assert.equal(mobileRoomsSource.includes('⋮</span>'), false, 'mobile three-dot control must not directly delete')
assert.match(mobileRoomsSource, /RoomActionMenu/)
assert.match(source('components/owner/RoomActionMenu.js'), /onEdit\(room\)/)
assert.match(source('components/owner/RoomActionMenu.js'), /onDelete\(room\)/)
const roomMenuSource = source('components/owner/RoomActionMenu.js')
assert.match(roomMenuSource, /createPortal/)
assert.match(roomMenuSource, /minWidth:MENU_WIDTH/)
assert.match(roomMenuSource, /maxWidth:'calc\(100vw - 24px\)'/)
assert.match(roomMenuSource, /whitespace-nowrap/)
assert.match(roomMenuSource, /aria-label="Room actions"/)
assert.match(source('components/owner/mobile/OwnerMobileRooms.js'), /confirm\(`Delete Room/)
assert.match(source('components/tenant/modals/PayRentModal.js'), /dark:bg-slate-950/)
const homeSource = source('pages/index.js')
assert.match(homeSource, /href="\/register" className="[^"]*border-orange-500[^"]*bg-orange-500[^"]*text-white/)
assert.equal(/href="\/register" className="[^"]*disabled/.test(homeSource), false)
const browseSource = source('pages/properties.js')
const browseListingSource = source('products/hostels/public/listing.js')
const publicPropertiesApiSource = source('pages/api/public/properties.js')
assert.match(publicPropertiesApiSource, /get_public_properties_v2/)
assert.match(browseSource, /products\/hostels\/public\/listing/)
assert.match(browseListingSource, /available_room_count/)
assert.match(browseSource, /room\$\{property\.availableRooms === 1 \? '' : 's'\} with availability/)
assert.equal(browseSource.includes('totalRooms - property.occupiedRooms'), false)
assert.match(browseListingSource, /hostelsetBrowseProperties:v2/, 'browse page must show cached hostel cards immediately')
assert.match(browseSource, /setRefreshing\(true\)/, 'browse background refresh must preserve existing cards')
assert.match(browseSource, /useMemo\(\(\) => \{[\s\S]*search-filter/, 'browse search/filter must use already-loaded data without refetching')
assert.match(browseSource, /useRealtimeRefresh\('public:properties:availability', \['properties', 'rooms'\]/, 'browse realtime must subscribe only to public-safe availability tables')
assert.equal(browseSource.includes("['properties', 'rooms', 'tenants']"), false, 'anonymous browse realtime must not subscribe to tenant rows')
assert.match(browseSource, /dark:bg-slate-950/, 'browse page must have explicit dark background')
assert.match(browseSource, /dark:bg-slate-900/, 'browse cards and controls must have explicit dark surfaces')
assert.match(browseSource, /xl:grid-cols-4/, 'browse cards must use a compact responsive grid')
assert.match(browseSource, /aspect-\[16\/9\]/, 'browse cards must reserve image aspect ratio to avoid layout shift')
assert.match(browseSource, /loading=\{index < 2 \? 'eager' : 'lazy'\}/, 'browse images must not block below-the-fold cards')
assert.match(browseListingSource, /hostelsetBrowsePerf/, 'browse performance diagnostics must be opt-in')
const migrationSource = source('supabase/migrations/202607120001_public_availability_and_safe_roommates.sql')
assert.match(migrationSource, /current_occupants < room\.capacity/)
assert.match(migrationSource, /tenant\.status in \('active', 'notice_period', 'payment_pending'\)/)
assert.match(migrationSource, /roommate\.property_id/)
assert.match(migrationSource, /requester\.room_id = roommate\.room_id/)
assert.match(migrationSource, /roommate\.id <> requester\.id/)
assert.match(migrationSource, /returns table \(id uuid, name text, phone text\)/)
assert.match(tenantContextSource, /rpc\('get_my_roommate_contacts'\)/)
assert.equal(tenantContextSource.includes("select('id, name, phone, email, status, room_id, move_in_date')"), false)
const roommateUiSource = source('components/tenant/RoommateContactDialog.js')
assert.match(roommateUiSource, /Phone number unavailable/)
assert.match(roommateUiSource, /href=\{`tel:/)
assert.match(roommateUiSource, /Copy Number/)
for (const privateField of ['email', 'deposit', 'payment', 'address', 'id_proof']) assert.equal(roommateUiSource.includes(privateField), false)
assert.match(publicClientSource, /storageKey:'hostelset-public-anonymous'/)
assert.match(propertySource, /No amenities have been listed for this property yet/)
assert.match(propertySource, /dark:bg-slate-900 dark:text-slate-100/)
const tenantPhotoApi = source('pages/api/tenant/profile-photo.js')
const ownerPhotoApi = source('pages/api/owner/tenant-profile-photo.js')
const tenantPhotoUrlApi = source('pages/api/tenant/profile-photo-url.js')
assert.match(tenantPhotoApi, /role !== 'tenant'|role'\)\.eq\('id', auth\.user\.id\)/)
assert.match(tenantPhotoApi, /eq\('user_id', auth\.user\.id\)/)
assert.match(tenantPhotoApi, /safeTenantProfilePhotoPath/, 'tenant profile photo path must reject non-profile-photo paths')
assert.match(ownerPhotoApi, /properties\(owner_id\)/)
assert.match(ownerPhotoApi, /owner_id/)
assert.match(ownerPhotoApi, /action === 'batch-sign'/)
assert.match(ownerPhotoApi, /safeTenantProfilePhotoPath/)
assert.match(tenantPhotoUrlApi, /profile_photo_path/)
assert.equal(/id_proof[^;]{0,120}profile_photo_path/.test(tenantPhotoUrlApi), false, 'identity document path must not be used as profile photo fallback')

;(async () => {
  let now = 0, calls = 0
  const cache = createExpiringRequestCache({ successTtlMs:100, missingTtlMs:50, now:() => now })
  const missing = async () => { calls += 1; return null }
  await Promise.all([cache.getOrLoad('missing', missing), cache.getOrLoad('missing', missing)])
  assert.equal(calls, 1, 'concurrent signing requests must deduplicate')
  await cache.getOrLoad('missing', missing); assert.equal(calls, 1, 'missing objects must be negatively cached')
  now = 51; await cache.getOrLoad('missing', missing); assert.equal(calls, 2, 'negative cache must be bounded')
  let successCacheNow = 0
  let successCalls = 0
  const successCache = createExpiringRequestCache({
    successTtlMs: 100,
    missingTtlMs: 50,
    now: () => successCacheNow,
  })
  const loadSuccess = async () => {
    successCalls += 1
    return `signed-url-${successCalls}`
  }

  assert.equal(await successCache.getOrLoad('document', loadSuccess), 'signed-url-1')
  assert.equal(await successCache.getOrLoad('document', loadSuccess), 'signed-url-1')
  assert.equal(successCalls, 1, 'successful results must be cached')
  successCacheNow = 99
  assert.equal(await successCache.getOrLoad('document', loadSuccess), 'signed-url-1')
  successCacheNow = 100
  assert.equal(await successCache.getOrLoad('document', loadSuccess), 'signed-url-2')
  assert.equal(successCalls, 2, 'successful cache entries must expire at their TTL')

  let failureCalls = 0
  const failureCache = createExpiringRequestCache({
    successTtlMs: 100,
    missingTtlMs: 50,
  })
  const failThenRecover = async () => {
    failureCalls += 1
    if (failureCalls === 1) throw new Error('expected loader failure')
    return 'recovered-url'
  }

  await assert.rejects(
    failureCache.getOrLoad('document', failThenRecover),
    /expected loader failure/
  )
  assert.equal(
    await failureCache.getOrLoad('document', failThenRecover),
    'recovered-url',
    'a rejected loader must be removed so the next request can retry'
  )
  assert.equal(failureCalls, 2)

  let invalidationCalls = 0
  const invalidationCache = createExpiringRequestCache({
    successTtlMs: 100,
    missingTtlMs: 50,
  })
  const loadInvalidationValue = async () => {
    invalidationCalls += 1
    return `value-${invalidationCalls}`
  }

  assert.equal(await invalidationCache.getOrLoad('first', loadInvalidationValue), 'value-1')
  invalidationCache.delete('first')
  assert.equal(await invalidationCache.getOrLoad('first', loadInvalidationValue), 'value-2')
  assert.equal(await invalidationCache.getOrLoad('second', loadInvalidationValue), 'value-3')
  invalidationCache.clear()
  assert.equal(await invalidationCache.getOrLoad('first', loadInvalidationValue), 'value-4')
  assert.equal(await invalidationCache.getOrLoad('second', loadInvalidationValue), 'value-5')
  assert.equal(invalidationCalls, 5, 'delete and clear must invalidate cached values')

  let resolveStaleValue
  let markStaleRequestStarted
  const staleRequestStarted = new Promise(resolve => {
    markStaleRequestStarted = resolve
  })
  const staleValue = new Promise(resolve => {
    resolveStaleValue = resolve
  })
  const raceCache = createExpiringRequestCache({
    successTtlMs: 100,
    missingTtlMs: 50,
  })

  const staleRequest = raceCache.getOrLoad('document', async () => {
    markStaleRequestStarted()
    return staleValue
  })

  await staleRequestStarted
  raceCache.delete('document')
  assert.equal(
    await raceCache.getOrLoad('document', async () => 'fresh-url'),
    'fresh-url'
  )

  resolveStaleValue('stale-url')
  assert.equal(await staleRequest, 'stale-url')
  assert.equal(
    await raceCache.getOrLoad('document', async () => 'unexpected-url'),
    'fresh-url',
    'stale in-flight cache results must not overwrite refreshed values'
  )

  console.log('Reliability helper tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
