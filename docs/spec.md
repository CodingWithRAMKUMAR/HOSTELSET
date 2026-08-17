# HostelSet Multi-Product Migration Specification

Status: Phases 1-3 complete. Phase 4A is next. Phase 5A follows only after Phase 4A passes.

This specification is for sequential spec-driven development. Implement one phase at a time. Do not implement multiple phases in one change.

## 1. Objective

Evolve HostelSet into a modular monolith with one shared platform and independently owned products:

- Hostels
- Rooms
- Hotels
- PGs
- Apartments
- Villas
- Co-Living
- Travel

Hostels is the existing product. The current `rooms` table represents hostel inventory and is not the future Rooms product.

## 2. Non-Negotiable Constraints

Preserve all existing:

- URLs and Pages Router routes
- API routes, request shapes, response shapes, status codes, and headers
- database schema, migrations, tables, policies, and RPCs
- authentication and authorization
- validation rules and user-facing errors
- UI appearance and interactions
- loading, empty, and error states
- notifications
- caching
- realtime behavior
- storage and document behavior
- search, filtering, sorting, pagination, and navigation

Do not introduce:

- Redux or Zustand
- TypeScript migration
- App Router migration
- monorepo restructuring
- micro-frontends
- a new framework
- speculative folders or abstractions
- database changes without explicit approval
- API or URL changes
- UI redesign

If behavior cannot be verified, mark it `UNVERIFIED`.
If no change is needed, mark it `NO CHANGE REQUIRED`.

## 3. Change-Size Rule

Every feature must have one primary owning file or module.

A normal UI change should normally have one primary product/component owner. A normal backend change should normally have one primary service, repository, or API-adapter owner. Supporting files may change only when required for compatibility, a contract, or a regression test.

Do not duplicate code to force an exact one-file change. Correctness, security, and testability take priority.

## 4. Dependency Rules

```text
pages/*              -> route adapters
products/*           -> platform, shared, design-system
platform/*           -X-> product internals
product A             -X-> product B internals
domain/services       -X-> React, CSS, browser APIs
shared/design-system  -X-> product-specific business rules
migrated product UI   -X-> direct Supabase access when an adapter exists
```

Preferred flow, only where justified:

```text
UI -> hook/state adapter -> application service -> repository/API adapter -> existing API/Supabase/RPC
```

Do not add every layer mechanically.

## 5. Existing Compatibility Surface

These routes must remain unchanged:

- `/properties`
- `/property/[id]`
- `/owner/dashboard`
- `/tenant/dashboard`
- `/admin/dashboard`
- `/register`
- `/login`

Existing API routes under `pages/api/` remain compatibility adapters. Existing exports may remain as facades until a migration is verified.

## 6. Completed Phases

### Phase 1: Public Hostel Listing Boundary

Status: COMPLETE.

Verified owner:

- `products/hostels/public/listing.js`

Compatibility route:

- `pages/properties.js`

Preserved `/properties`, `/api/public/properties`, UI behavior, caching, search, filters, map behavior, and realtime.

### Phase 2: Public Hostel Detail Boundary

Status: COMPLETE.

Verified owner:

- `products/hostels/public/detail.js`

Compatibility routes:

- `pages/property/[id].js`
- `pages/api/public/properties/[id].js`

Preserved property details, room availability, slug/UUID behavior, SEO, SSG, UI, application/pre-booking flows, uploads, payment proof, caching, and realtime.

## 7. Phase 4A: Visitor Application and Pre-Booking Boundary

Status: NOT STARTED. This is the next phase.

### Scope

Inspect and isolate only the existing Hostel visitor flow:

- `pages/property/[id].js`
- `pages/api/visitor/submit.js`
- `pages/api/visitor/check-identity.js`
- `pages/api/visitor/upload-url.js`
- `products/hostels/public/detail.js`
- related validation, storage, security, RPCs, and migrations

### Goal

Create one primary Hostel-owned visitor module only if the code proves a real boundary is needed. A possible target is:

- `products/hostels/public/visitor.js`

The module may own verified Hostel application/pre-booking orchestration and normalization. It must not own generic public API security, global logging, Supabase client construction, or unrelated platform behavior.

### Acceptance Criteria

- Existing visitor API URLs remain unchanged.
- Request and response contracts remain unchanged.
- Status codes, error messages, rate limits, upload paths, file limits, duplicate checks, and database writes remain unchanged.
- Application and pre-booking workflows remain unchanged.
- No database, auth, authorization, or UI changes.
- Existing page and API files remain usable compatibility adapters.

### Required Tests

Run focused visitor/API/security tests discovered in the repository, then:

- `npm test`
- `npm run test:api-security`
- `npm run test:e2e`
- `npm run build`

### Rollback

Restore the visitor logic to its original page/API owner and remove the new adapter/module. Revert only migration-owned changes.

## 8. Phase 5A: Shared Public API Infrastructure Boundary

Status: NOT STARTED. Start only after Phase 4A passes.

### Scope

Inspect:

- `lib/server/publicApiSecurity.js`
- `lib/server/requestContext.js`
- `lib/server/requestTelemetry.js`
- `lib/server/supabaseAdmin.js`
- `lib/logger.js`
- all public visitor API routes

### Goal

Isolate only infrastructure proven to be shared by multiple public API routes. Possible target:

- `platform/api/publicSecurity.js`

Possible shared responsibilities include method checks, JSON checks, private response headers, client IP resolution, rate-limit invocation, request context, telemetry, and logging integration.

### Acceptance Criteria

- Security behavior is identical.
- Rate-limit scopes, limits, windows, and responses are identical.
- Headers and status codes are identical.
- Request context and telemetry values are identical.
- Hostel application rules remain in the Hostels product.
- Existing imports remain supported through compatibility exports.

### Required Tests

- `npm run test:api-security`
- `npm run test:request-context`
- `npm run test:monitoring`
- `npm test`
- `npm run test:e2e`
- `npm run build`

### Rollback

Restore the old server helper imports and remove the platform facade.

## 9. Phase 6: Owner Room Inventory

Status: NOT STARTED.

### Scope

Inspect:

- `pages/owner/dashboard.js`
- `context/OwnerContext.js`
- `hooks/useOwnerRooms.js`
- owner room components/modals
- room RPCs and migrations

Isolate only room loading, adding, editing, deleting, validation, and refresh behavior. A possible owner is `products/hostels/owner/rooms.js`.

### Acceptance Criteria

Preserve `/owner/dashboard`, selected-property behavior, sorting, occupancy rules, rent rules, notifications, realtime, UI, validation, and all existing room operations.

Do not modify tenants, payments, applications, pre-bookings, complaints, notices, vacates, room changes, memberships, or admin behavior.

### Required Tests

Run all discovered room/owner tests, `npm test`, relevant E2E tests, and `npm run build`.

### Rollback

Restore the original hook/context/page ownership.

## 10. Phase 7: Remaining Owner Workflows

Status: NOT STARTED.

Implement exactly one workflow per migration step, in this order only as justified by the code:

1. tenant management
2. rent payments
3. payment history
4. applications
5. pre-bookings
6. complaints
7. notices
8. vacate requests
9. room changes
10. existing tenant imports
11. membership

For each workflow:

- inspect actual code first
- identify one primary owner
- preserve `/owner/dashboard` and query parameters
- preserve authorization, validation, UI, realtime, notifications, API/RPC behavior
- run focused tests, regression tests, and build
- stop and request approval before the next workflow

## 11. Phase 8: Tenant Workflows

Status: NOT STARTED.

Implement one tenant workflow at a time:

- profile
- payments
- complaints
- notices
- roommates
- vacate
- room change

Inspect `pages/tenant/dashboard.js`, `context/TenantContext.js`, relevant hooks/components, RPCs, APIs, and migrations.

Preserve `/tenant/dashboard`, role checks, tabs, query parameters, validation, loading/error states, notifications, realtime, uploads, and UI. Do not modify owner or admin behavior.

Run focused tests, `npm test`, relevant E2E tests, and `npm run build` after each workflow.

## 12. Phase 9: Admin Workflows

Status: NOT STARTED.

Implement one admin workflow at a time:

- properties
- owners
- users
- tenants
- payments
- applications
- pre-bookings
- complaints
- notices
- vacates
- room changes
- memberships
- analytics

Inspect `pages/admin/dashboard.js`, `context/AdminContext.js`, relevant hooks/components, APIs, RPCs, and migrations.

Preserve `/admin/dashboard`, admin authorization, tabs, query parameters, filters, sorting, pagination, loading/error states, notifications, realtime, and UI. Do not modify owner or tenant behavior.

Run focused tests, `npm test`, relevant E2E tests, and `npm run build` after each workflow.

## 13. Phase 10: Shared UI and Design-System Boundary

Status: NOT STARTED.

Extract only genuinely neutral UI primitives and layouts, such as buttons, inputs, modal primitives, tables, loading states, dashboard layout primitives, navigation primitives, and theme primitives.

Do not move components containing Hostel queries or rules for rent, tenants, complaints, notices, vacates, room changes, or memberships.

Do not redesign the UI. Preserve markup behavior, classes, accessibility, responsiveness, and existing imports.

If no safe shared extraction is justified, report `NO CHANGE REQUIRED`.

## 14. Phase 11: Product Feature Configuration

Status: NOT STARTED.

Add feature configuration only when there is a real consumer. Products must explicitly declare features and must not automatically inherit Hostel-only behavior.

Example:

```js
{
  id: 'hostels',
  features: ['listing', 'applications', 'rent', 'complaints']
}
```

Do not change visible navigation or existing routes unless required and approved.

## 15. Phase 12: Product Registry

Status: NOT STARTED.

Add a registry only when routing or navigation has a verified need. Register Hostels and preserve all existing legacy paths. Do not add unused future product entries.

If no real consumer exists, report `NO CHANGE REQUIRED`.

## 16. Phase 13: Dependency-Boundary Verification

Status: NOT STARTED.

Verify, and enforce only where practical:

- platform does not import product internals
- products do not import other product internals
- shared UI has no Hostel business rules
- domain code does not import React/CSS/browser APIs
- migrated product UI does not directly call Supabase where an adapter exists

Use the smallest reliable check. Do not introduce a large linting system for this purpose.

## 17. Phase 14: Future Product Vertical Slice

Status: NOT STARTED.

Ask the user to choose exactly one product before coding:

- Rooms
- Hotels
- PGs
- Apartments
- Villas
- Co-Living
- Travel

Do not assume requirements. Define only the selected product’s verified smallest vertical slice: routes, feature configuration, UI, domain, services, repositories/API adapters, state, validation, and tests.

Reuse platform/shared capabilities selectively. Do not copy Hostel business rules. Do not modify existing Hostel routes, APIs, schema, or workflows.

## 18. Phase 15: Final Regression Verification

Status: NOT STARTED.

Do not refactor during this phase. Verify all existing and new behavior:

- routes
- API contracts
- authentication
- authorization
- validation
- database effects
- UI behavior
- loading/error states
- notifications
- caching
- realtime
- Hostel workflows
- future product workflows, if implemented

Run all relevant available unit, API, security, database, E2E, performance, and build checks. Report exact results and mark missing coverage `UNVERIFIED`.

## 19. Standard Execution Protocol

For every phase:

1. Inspect actual files and current worktree.
2. State the smallest verified change.
3. Make one focused edit.
4. Run the narrowest relevant executable validation immediately.
5. Repair only failures caused by the current phase.
6. Run broader regression tests.
7. Run `npm run build`.
8. Report exact files, behavior, tests, risk, and rollback.
9. Stop and wait for approval before the next phase.

Never claim tests passed unless they were actually executed. Never modify unrelated user changes. Never implement later phases early.
