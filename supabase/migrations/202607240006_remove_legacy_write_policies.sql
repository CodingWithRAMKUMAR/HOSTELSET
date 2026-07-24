-- Remove legacy permissive policies and unused direct write privileges.
-- Legitimate payment review and room editing continue through
-- security-definer RPC functions.

-- ============================================================
-- 1. Payment history
-- ============================================================

-- Financial records must not be deleted by owners.
drop policy if exists "Owners can delete payment history"
on public.payment_history;

-- This legacy policy only checks ownership and therefore weakens
-- the stricter payments_owner_insert status restrictions.
drop policy if exists "Owners can insert payment history"
on public.payment_history;

-- No active client workflow directly updates or deletes payment rows.
-- Payment review continues through review_rent_payment().
revoke update, delete
on table public.payment_history
from authenticated;

-- ============================================================
-- 2. Rooms
-- ============================================================

-- No active client workflow directly updates rooms.
-- Room editing continues through update_owner_room().
revoke update
on table public.rooms
from authenticated;

-- ============================================================
-- 3. Tenants
-- ============================================================

-- Remove the duplicate legacy PUBLIC update policy.
-- Keep tenants_self_update, which is restricted to authenticated
-- users and explicitly checks both the existing and resulting row.
drop policy if exists "Tenants can update own tenant record"
on public.tenants;
