const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const projectRoot = path.join(__dirname, '..')
const outputDirectory = path.join(projectRoot, 'qa-results')
const strict = process.argv.includes('--strict')

function coverage(status, reason, evidence) {
  return { status, reason, evidence }
}

function activeRpc(file, workflow, tests) {
  return coverage(
    'indirect',
    `Active RPC used by ${workflow}; existing automated checks exercise the caller surface, but the strict literal-name scan does not see this database function as directly referenced.`,
    [file, ...tests]
  )
}

function databaseChain(workflow, tests) {
  return coverage(
    'indirect',
    `Exercised through the ${workflow} database behavior chain; the test asserts the resulting database state instead of naming every helper or trigger function.`,
    tests
  )
}

function infrastructure(reason, evidence) {
  return coverage(
    'infrastructure',
    reason,
    evidence
  )
}

function obsolete(reason, evidence) {
  return coverage(
    'obsolete',
    reason,
    evidence
  )
}

const DATABASE_FUNCTION_COVERAGE = {
  add_property_for_existing_owner: activeRpc(
    'pages/api/owner/add-property.js',
    'owner add-property API compatibility',
    ['e2e/api-route-contracts.spec.js', 'npm run build']
  ),
  admin_approve_application: obsolete(
    'Legacy application approval wrapper retained in migrations; repository search found no current non-migration caller.',
    ['supabase/migrations/202607020002_wrap_legacy_application_approval.sql']
  ),
  admin_set_owner_membership: activeRpc(
    'hooks/useAdminMembershipManager.js',
    'admin membership management',
    ['e2e/admin-dashboard.spec.js', 'npm run build']
  ),
  approve_existing_tenant_import: obsolete(
    'Legacy one-argument import approval RPC retained for database compatibility; current API uses approve_existing_tenant_import_with_user.',
    ['pages/api/owner/approve-existing-import.js', 'supabase/migrations/202607170003_import_current_rent_answer.sql']
  ),
  approve_existing_tenant_import_with_user: activeRpc(
    'pages/api/owner/approve-existing-import.js',
    'owner existing-tenant import approval',
    ['e2e/api-route-contracts.spec.js', 'npm run build']
  ),
  approve_vacate_request: activeRpc(
    'hooks/useAdminVacate.js, hooks/useOwnerVacate.js',
    'admin and owner vacate approvals',
    ['e2e/admin-dashboard.spec.js', 'e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  archive_property: activeRpc(
    'products/hostels/admin/properties.js, pages/owner/dashboard.js',
    'admin and owner property archival',
    ['e2e/admin-dashboard.spec.js', 'e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  archive_tenant: activeRpc(
    'products/hostels/owner/tenants.js, pages/api/admin/delete-tenant.js',
    'owner and admin tenant archival',
    ['e2e/api-route-contracts.spec.js', 'e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  attach_payment_to_rent_record: databaseChain(
    'payment-to-rent allocation',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  block_reserved_vacate_delete: infrastructure(
    'Trigger guard that protects approved vacate records when a room has an active reservation.',
    ['supabase/migrations/202607200003_safe_vacate_cancellation.sql']
  ),
  calculate_import_current_rent_due_date: databaseChain(
    'existing-tenant import rent due-date calculation',
    ['pages/api/owner/approve-existing-import.js', 'npm run build']
  ),
  calculate_import_previous_rent_due_date: databaseChain(
    'existing-tenant import rent due-date calculation',
    ['pages/api/owner/approve-existing-import.js', 'npm run build']
  ),
  cancel_stale_rent_reminders: infrastructure(
    'Rent reminder scheduler maintenance function; not a user-facing RPC surface.',
    ['supabase/migrations/202606300003_enable_brevo_rent_reminders.sql']
  ),
  claim_due_rent_reminders: infrastructure(
    'Rent reminder scheduler worker claim function; covered as scheduler infrastructure rather than workflow UI.',
    ['supabase/migrations/20260721140350_pending_payment_reminder_guard.sql']
  ),
  complete_due_vacate_requests: infrastructure(
    'Scheduled vacate completion job; retained as database lifecycle infrastructure.',
    ['supabase/migrations/202607010008_final_checkout_workflow.sql']
  ),
  complete_rent_reminder: infrastructure(
    'Rent reminder scheduler completion marker; not a product RPC endpoint.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  create_notification_record: infrastructure(
    'Notification trigger helper used by database notification triggers.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  create_owner_tenant_atomic: activeRpc(
    'pages/api/owner/tenants.js',
    'owner tenant creation API',
    ['e2e/api-route-contracts.spec.js', 'e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  current_tenant_room_id: infrastructure(
    'Realtime policy helper for the current authenticated tenant room.',
    ['supabase/migrations/202606290001_enable_realtime.sql']
  ),
  enforce_approved_room_change_rent_state: databaseChain(
    'approved room-change rent integrity',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  enforce_tenant_pending_payment_submission: infrastructure(
    'Database trigger guard for tenant payment submissions.',
    ['supabase/migrations/202607180001_application_payment_and_room_reservation_repair.sql']
  ),
  enforce_vacate_rent_eligibility: infrastructure(
    'Database trigger guard that enforces rent eligibility before vacate requests.',
    ['supabase/migrations/202607010006_vacate_rent_eligibility.sql']
  ),
  fail_rent_reminder: infrastructure(
    'Rent reminder scheduler failure marker; not a user-facing RPC surface.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  get_admin_dashboard_overview_snapshot: activeRpc(
    'hooks/useAdminOverviewSnapshot.js',
    'admin dashboard overview snapshot loading',
    ['e2e/admin-dashboard.spec.js', 'npm run build']
  ),
  get_admin_dashboard_stats: activeRpc(
    'context/AdminContext.js',
    'admin dashboard aggregate stats loading',
    ['e2e/admin-dashboard.spec.js', 'npm run build']
  ),
  get_archived_tenant_history: activeRpc(
    'pages/owner/dashboard.js',
    'owner archived tenant history modal',
    ['e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  get_my_tenant_dashboard_snapshot: activeRpc(
    'context/TenantContext.js',
    'tenant dashboard snapshot loading',
    ['e2e/tenant-dashboard.spec.js', 'npm run build']
  ),
  get_my_tenant_dashboard_snapshot_impl: databaseChain(
    'tenant dashboard snapshot wrapper',
    ['context/TenantContext.js', 'e2e/tenant-dashboard.spec.js', 'npm run build']
  ),
  get_public_property_by_identifier: activeRpc(
    'pages/api/public/properties/[id].js, pages/property/[id].js',
    'public property detail lookup by slug or UUID',
    ['e2e/visitor-browse.spec.js', 'npm run test:property-slug', 'npm run build']
  ),
  get_vacate_cancellation_status: activeRpc(
    'hooks/useVacate.js',
    'tenant vacate cancellation status loading',
    ['scripts/vacate-cancellation-db-tests.sql', 'e2e/tenant-dashboard.spec.js']
  ),
  handle_rent_record_reminder_schedule: infrastructure(
    'Trigger function that schedules reminder rows when rent records change.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  has_active_room_reservation: infrastructure(
    'Internal helper used by safe vacate cancellation logic.',
    ['supabase/migrations/202607200003_safe_vacate_cancellation.sql']
  ),
  is_hostelset_admin: infrastructure(
    'Authorization helper used by database policies and admin RPCs.',
    ['supabase/migrations/202606290001_enable_realtime.sql']
  ),
  is_public_property_visible: activeRpc(
    'pages/api/visitor/check-identity.js, pages/api/visitor/submit.js, pages/api/visitor/upload-url.js',
    'public visitor API property-visibility checks',
    ['npm run test:api-security', 'e2e/api-route-contracts.spec.js']
  ),
  materialize_monthly_rent_records: databaseChain(
    'monthly rent materialization and room-change rent recalculation',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  notifications_after_application_insert: infrastructure(
    'Application insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_application_update: infrastructure(
    'Application update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_checkout_insert: infrastructure(
    'Vacate request insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_checkout_update: infrastructure(
    'Vacate request update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_complaint_insert: infrastructure(
    'Complaint insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_complaint_update: infrastructure(
    'Complaint update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_import_insert: infrastructure(
    'Existing-tenant import insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_import_update: infrastructure(
    'Existing-tenant import update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_membership_insert: infrastructure(
    'Membership request insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_notice_insert: infrastructure(
    'Notice insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_payment_insert: infrastructure(
    'Payment insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_payment_update: infrastructure(
    'Payment update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_property_insert: infrastructure(
    'Property insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_room_change_insert: infrastructure(
    'Room-change request insert notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_after_room_change_update: infrastructure(
    'Room-change request update notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notifications_before_payment_delete: infrastructure(
    'Payment delete notification trigger.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notify_admins: infrastructure(
    'Notification fan-out helper used by database triggers.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  notify_property_owner: infrastructure(
    'Notification helper used by property-scoped database triggers.',
    ['supabase/migrations/202607060003_notifications.sql']
  ),
  prepare_tenant_rent_pricing: databaseChain(
    'tenant room-rent pricing trigger chain',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  property_slug_base: infrastructure(
    'Slug normalization helper used by the property slug trigger.',
    ['supabase/migrations/202607030001_property_slugs.sql', 'npm run test:property-slug']
  ),
  protect_archived_tenant_history: infrastructure(
    'Trigger guard protecting archived tenant history fields.',
    ['supabase/migrations/202607010011_archived_tenant_history.sql']
  ),
  protect_tenant_managed_fields: infrastructure(
    'Trigger guard protecting tenant lifecycle and financial fields; exercised by tenant/rent DB regressions.',
    ['scripts/vacate-cancellation-db-tests.sql', 'scripts/room-change-rent-db-tests.sql']
  ),
  protect_user_security_fields: infrastructure(
    'Trigger guard protecting user security-sensitive fields.',
    ['supabase/migrations/202607240002_protect_user_security_fields.sql']
  ),
  reconcile_rent_record: databaseChain(
    'rent record payment reconciliation',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  record_owner_rent_collection: activeRpc(
    'pages/owner/dashboard.js',
    'owner rent collection workflow',
    ['e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  recover_stale_rent_reminders: infrastructure(
    'Rent reminder scheduler stale-claim recovery function.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  refresh_tenant_rent_summary: databaseChain(
    'tenant rent summary refresh',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  register_owner_and_property: activeRpc(
    'pages/api/register-owner.js',
    'owner registration API',
    ['e2e/api-route-contracts.spec.js', 'npm run build']
  ),
  reject_existing_tenant_import: activeRpc(
    'hooks/useExistingTenantImports.js',
    'owner existing-tenant import rejection',
    ['e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  reject_vacate_request: activeRpc(
    'hooks/useAdminVacate.js, hooks/useOwnerVacate.js',
    'admin and owner vacate rejection',
    ['e2e/admin-dashboard.spec.js', 'e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  rent_reminder_time: infrastructure(
    'Rent reminder scheduling helper; not a user-facing RPC surface.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  request_tenant_vacate: activeRpc(
    'pages/tenant/dashboard.js',
    'tenant vacate request workflow',
    ['e2e/tenant-dashboard.spec.js', 'npm run build']
  ),
  restore_property: activeRpc(
    'products/hostels/admin/properties.js',
    'admin property restoration',
    ['e2e/admin-dashboard.spec.js', 'npm run build']
  ),
  review_membership_request: activeRpc(
    'hooks/useAdminMembershipManager.js',
    'admin membership request review',
    ['e2e/admin-dashboard.spec.js', 'scripts/property-membership-guard-db-tests.sql']
  ),
  review_rent_payment: activeRpc(
    'hooks/useAdminPayments.js, hooks/useOwnerPayments.js',
    'admin and owner rent payment review',
    ['e2e/admin-dashboard.spec.js', 'e2e/owner-dashboard.spec.js', 'scripts/room-change-rent-db-tests.sql']
  ),
  rotate_existing_tenant_import_link: activeRpc(
    'hooks/useExistingTenantImports.js',
    'owner existing-tenant import link rotation',
    ['e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  run_rent_reminder_scheduler: infrastructure(
    'Rent reminder scheduler entrypoint intended for scheduled execution.',
    ['supabase/migrations/20260721140350_pending_payment_reminder_guard.sql']
  ),
  schedule_initial_rent_reminders: infrastructure(
    'Rent reminder scheduler helper invoked by rent-record triggers.',
    ['supabase/migrations/20260721140350_pending_payment_reminder_guard.sql']
  ),
  schedule_weekly_overdue_reminders: infrastructure(
    'Rent reminder scheduler helper for overdue cycles.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  set_existing_tenant_import_link_enabled: activeRpc(
    'hooks/useExistingTenantImports.js',
    'owner existing-tenant import link enablement',
    ['e2e/owner-dashboard.spec.js', 'npm run build']
  ),
  set_property_slug: infrastructure(
    'Property slug trigger function; public slug behavior is covered by property slug regression tests.',
    ['supabase/migrations/202607030001_property_slugs.sql', 'npm run test:property-slug']
  ),
  set_rent_record_updated_at: infrastructure(
    'Rent record updated_at trigger function.',
    ['supabase/migrations/202606300002_rent_reminder_infrastructure.sql']
  ),
  set_updated_at: infrastructure(
    'Shared updated_at trigger function applied by migrations across mutable tables.',
    ['supabase/migrations/202607010002_database_security_hardening.sql']
  ),
  sync_paid_tenant_rent_records: databaseChain(
    'paid tenant rent-record synchronization',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  sync_property_application_deposit: infrastructure(
    'Property application-deposit trigger synchronization.',
    ['supabase/migrations/202607190001_property_application_deposit.sql']
  ),
  sync_room_public_availability: infrastructure(
    'Room/public availability trigger synchronization for checkout and pre-booking changes.',
    ['supabase/migrations/202607010001_reliable_vacate_availability.sql']
  ),
  sync_successful_payment_to_rent_record: databaseChain(
    'successful payment-to-rent synchronization',
    ['scripts/room-change-rent-db-tests.sql']
  ),
  sync_tenant_room_public_availability: infrastructure(
    'Tenant room/public availability trigger synchronization.',
    ['supabase/migrations/202607180001_application_payment_and_room_reservation_repair.sql']
  ),
  update_my_tenant_profile_photo: obsolete(
    'Legacy tenant profile-photo RPC retained in migrations; current tenant profile-photo API updates the tenant record directly.',
    ['pages/api/tenant/profile-photo.js', 'supabase/migrations/202607140002_tenant_profile_photo_update_rpcs.sql']
  ),
  update_owned_tenant_profile_photo: obsolete(
    'Legacy owner tenant profile-photo RPC retained in migrations; current owner profile-photo API updates the tenant record directly.',
    ['pages/api/owner/tenant-profile-photo.js', 'supabase/migrations/202607140002_tenant_profile_photo_update_rpcs.sql']
  ),
  update_tenant_profile: activeRpc(
    'products/hostels/tenant/profile.js',
    'tenant profile update workflow',
    ['e2e/tenant-dashboard.spec.js', 'npm run test:profile-photo-client', 'npm run build']
  ),
}

function walk(relativeDirectory) {
  const directory = path.join(projectRoot, relativeDirectory)

  if (!fs.existsSync(directory)) return []

  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const relativePath = path.join(relativeDirectory, entry.name)

      return entry.isDirectory()
        ? walk(relativePath)
        : [relativePath.replaceAll('\\', '/')]
    })
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function readTrackedFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z'],
    { cwd: projectRoot, encoding: 'utf8' }
  )

  return new Set(
    output
      .split('\0')
      .filter(Boolean)
      .map(file => file.replaceAll('\\', '/'))
  )
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length
}

function countE2eCases(files) {
  return files.reduce((count, file) => {
    const source = read(file)
    const generatedCount = source.match(
      /const\s+GENERATED_TEST_CASE_COUNT\s*=\s*(\d+)/
    )

    if (generatedCount) {
      return count + Number(generatedCount[1])
    }

    return count + countMatches(source, /\btest\s*\(/g)
  }, 0)
}

function routeFromApiFile(file) {
  const route = file
    .slice('pages/api/'.length)
    .replace(/\.[jt]sx?$/, '')
    .replace(/\/index$/, '')

  return `/api/${route}`
}

function roleCoverage(specFiles) {
  return Object.fromEntries(
    ['visitor', 'tenant', 'owner', 'admin'].map(role => [
      role,
      specFiles.some(file =>
        path.basename(file).toLowerCase().includes(role)
      ),
    ])
  )
}

const sourceRoots = ['pages', 'components', 'context', 'hooks', 'lib']
const sourceFiles = sourceRoots
  .flatMap(walk)
  .filter(file => /\.[jt]sx?$/.test(file))

const apiFiles = walk('pages/api')
  .filter(file => /\.[jt]sx?$/.test(file))
  .sort()

const unitTestFiles = walk('scripts')
  .filter(file => /(?:test|spec)/i.test(path.basename(file)))
  .filter(file => !file.endsWith('.sql'))

const databaseTestFiles = walk('scripts')
  .filter(file => /(?:test|spec)/i.test(path.basename(file)))
  .filter(file => file.endsWith('.sql'))

const localE2eFiles = walk('e2e')
  .filter(file => /\.spec\.[jt]s$/.test(file))

const productionE2eFiles = walk('e2e-production')
  .filter(file => /\.spec\.[jt]s$/.test(file))

const migrationFiles = [
  ...walk('supabase/migrations'),
  ...walk('migrations'),
]
  .filter(file => file.endsWith('.sql'))
  .filter((file, index, files) => files.indexOf(file) === index)

const testCorpus = [
  ...unitTestFiles,
  ...databaseTestFiles,
  ...localE2eFiles,
  ...productionE2eFiles,
].map(read).join('\n')

const migrationCorpus = migrationFiles.map(read).join('\n')
const databaseFunctions = [...new Set(
  [...migrationCorpus.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|hostelset_private)\.)?([a-zA-Z0-9_]+)/gi
  )].map(match => match[1])
)].sort()

const referencedDatabaseFunctions = databaseFunctions.filter(name =>
  new RegExp(`\\b${name}\\b`, 'i').test(testCorpus)
)
const databaseFunctionCoverage = databaseFunctions.map(name => {
  const directlyReferenced = referencedDatabaseFunctions.includes(name)
  const auditedCoverage = DATABASE_FUNCTION_COVERAGE[name]

  if (directlyReferenced) {
    return {
      name,
      status: 'direct',
      reason: 'Literal database function reference found in automated test corpus.',
      evidence: [],
      directlyReferenced,
    }
  }

  if (auditedCoverage) {
    return {
      name,
      ...auditedCoverage,
      directlyReferenced,
    }
  }

  return {
    name,
    status: 'unverified',
    reason: 'No direct automated test reference or audited coverage classification.',
    evidence: [],
    directlyReferenced,
  }
})
const databaseFunctionCoverageSummary = databaseFunctionCoverage.reduce(
  (summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1
    return summary
  },
  { direct: 0, indirect: 0, infrastructure: 0, obsolete: 0, unverified: 0 }
)
const unverifiedDatabaseFunctions = databaseFunctionCoverage
  .filter(item => item.status === 'unverified')
  .map(item => item.name)
const staleDatabaseFunctionCoverage = Object.keys(DATABASE_FUNCTION_COVERAGE)
  .filter(name => !databaseFunctions.includes(name))
  .sort()

const localE2eCorpus = localE2eFiles.map(read).join('\n')
const productionE2eCorpus = productionE2eFiles.map(read).join('\n')
const localApiContractCorpus = localE2eFiles
  .filter(file => path.basename(file).includes('api-route-contract'))
  .map(read)
  .join('\n')

const apiRoutes = apiFiles.map(file => {
  const route = routeFromApiFile(file)
  const routeExpression = route.includes('[')
    ? null
    : new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  const locallyMentioned = localApiContractCorpus.includes(route)
  const productionMentioned = routeExpression
    ? routeExpression.test(productionE2eCorpus)
    : false
  const locallyMocked = routeExpression
    ? new RegExp(`page\\.route\\([^)]*${routeExpression.source}`).test(
      localE2eCorpus
    )
    : false

  return {
    route,
    file,
    localBehaviorTest: locallyMentioned,
    localUiMock: locallyMocked,
    productionBehaviorTest: productionMentioned,
    sourceReferenced: testCorpus.includes(file),
  }
})

const localBackupFiles = [
  ...walk('pages'),
  ...walk('components'),
  ...walk('context'),
  ...walk('hooks'),
  ...walk('lib'),
].filter(file => /(?:\.bak$|\.backup$|\.before[-.]|backup)/i.test(file))
const trackedFiles = readTrackedFiles()
const backupFiles = localBackupFiles.filter(file => trackedFiles.has(file))
const ignoredBackupFiles = localBackupFiles.filter(
  file => !trackedFiles.has(file)
)

const localRoles = roleCoverage(localE2eFiles)
const missingLocalRoles = Object.entries(localRoles)
  .filter(([, covered]) => !covered)
  .map(([role]) => role)
const apiRoutesWithoutLocalBehavior = apiRoutes
  .filter(route => !route.localBehaviorTest)
  .map(route => route.route)

const gates = [
  {
    name: 'Every API route has a local behavioral test',
    passed: apiRoutesWithoutLocalBehavior.length === 0,
    missing: apiRoutesWithoutLocalBehavior,
  },
  {
    name: 'Visitor, tenant, owner, and admin have local E2E coverage',
    passed: missingLocalRoles.length === 0,
    missing: missingLocalRoles,
  },
  {
    name: 'Every database function has direct or audited coverage',
    passed:
      unverifiedDatabaseFunctions.length === 0 &&
      staleDatabaseFunctionCoverage.length === 0,
    missing: [
      ...unverifiedDatabaseFunctions,
      ...staleDatabaseFunctionCoverage.map(name =>
        `stale audited classification: ${name}`
      ),
    ],
  },
  {
    name: 'No Git-tracked source backup copies are present',
    passed: backupFiles.length === 0,
    missing: backupFiles,
  },
]

const report = {
  generatedAt: new Date().toISOString(),
  strict,
  inventory: {
    sourceFiles: sourceFiles.length,
    apiRoutes: apiRoutes.length,
    databaseFunctions: databaseFunctions.length,
    unitTestFiles: unitTestFiles.length,
    databaseTestFiles: databaseTestFiles.length,
    localE2eFiles: localE2eFiles.length,
    localE2eCases: countE2eCases(localE2eFiles),
    productionE2eFiles: productionE2eFiles.length,
    productionE2eCases: countE2eCases(productionE2eFiles),
  },
  coverage: {
    localRoles,
    apiRoutes,
    referencedDatabaseFunctions,
    databaseFunctions: databaseFunctionCoverage,
    databaseFunctionSummary: databaseFunctionCoverageSummary,
    backupFiles,
    ignoredBackupFiles,
  },
  gates,
}

const markdown = [
  '# HostelSet automated coverage audit',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  'This is a surface-coverage audit, not proof that the application has no bugs.',
  'A source reference or mocked response does not count as a local behavioral API test.',
  '',
  '## Inventory',
  '',
  '| Surface | Count |',
  '| --- | ---: |',
  `| Source files | ${report.inventory.sourceFiles} |`,
  `| API routes | ${report.inventory.apiRoutes} |`,
  `| Database functions | ${report.inventory.databaseFunctions} |`,
  `| Unit/static test files | ${report.inventory.unitTestFiles} |`,
  `| Database integration test files | ${report.inventory.databaseTestFiles} |`,
  `| Local E2E cases | ${report.inventory.localE2eCases} |`,
  `| Production E2E cases | ${report.inventory.productionE2eCases} |`,
  '',
  '## Gates',
  '',
  ...gates.flatMap(gate => [
    `### ${gate.passed ? 'PASS' : 'FAIL'} - ${gate.name}`,
    '',
    gate.passed
      ? 'No missing surfaces detected.'
      : gate.missing.map(item => `- ${item}`).join('\n'),
    '',
  ]),
  '## Database Function Coverage',
  '',
  '| Category | Count |',
  '| --- | ---: |',
  `| Direct automated test reference | ${databaseFunctionCoverageSummary.direct || 0} |`,
  `| Indirectly tested but not literal-detected | ${databaseFunctionCoverageSummary.indirect || 0} |`,
  `| Intentional infrastructure-only | ${databaseFunctionCoverageSummary.infrastructure || 0} |`,
  `| Obsolete/unreachable compatibility | ${databaseFunctionCoverageSummary.obsolete || 0} |`,
  `| Unverified | ${databaseFunctionCoverageSummary.unverified || 0} |`,
  '',
  ...['indirect', 'infrastructure', 'obsolete', 'unverified'].flatMap(status => {
    const title = {
      indirect: 'Indirectly Tested But Not Literal-Detected',
      infrastructure: 'Intentional Infrastructure-Only',
      obsolete: 'Obsolete/Unreachable Compatibility',
      unverified: 'Unverified',
    }[status]
    const entries = databaseFunctionCoverage
      .filter(item => item.status === status)
      .sort((a, b) => a.name.localeCompare(b.name))

    return [
      `### ${title}`,
      '',
      entries.length === 0
        ? 'No database functions in this category.'
        : entries.map(item => {
          const evidence = item.evidence.length
            ? ` Evidence: ${item.evidence.join('; ')}.`
            : ''

          return `- \`${item.name}\` - ${item.reason}${evidence}`
        }).join('\n'),
      '',
    ]
  }),
].join('\n')

fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(
  path.join(outputDirectory, 'coverage-audit.json'),
  JSON.stringify(report, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(outputDirectory, 'coverage-audit.md'),
  markdown + '\n'
)

console.log('HostelSet automated coverage audit')
console.log('')
console.log(`Source files: ${report.inventory.sourceFiles}`)
console.log(`API routes: ${report.inventory.apiRoutes}`)
console.log(`Database functions: ${report.inventory.databaseFunctions}`)
console.log(`Local E2E cases: ${report.inventory.localE2eCases}`)
console.log(
  'Database function coverage: ' +
  `${databaseFunctionCoverageSummary.direct || 0} direct, ` +
  `${databaseFunctionCoverageSummary.indirect || 0} indirect, ` +
  `${databaseFunctionCoverageSummary.infrastructure || 0} infrastructure, ` +
  `${databaseFunctionCoverageSummary.obsolete || 0} obsolete, ` +
  `${databaseFunctionCoverageSummary.unverified || 0} unverified`
)
console.log('')

for (const gate of gates) {
  console.log(
    `${gate.passed ? 'PASS' : 'FAIL'} - ${gate.name}` +
    (gate.passed ? '' : ` (${gate.missing.length} missing)`)
  )
}

console.log('')
console.log('Reports:')
console.log('- qa-results/coverage-audit.md')
console.log('- qa-results/coverage-audit.json')

if (strict && gates.some(gate => !gate.passed)) {
  process.exitCode = 1
}
