-- Prevent authenticated clients from bypassing controlled financial,
-- occupancy and tenant-management workflows.

-- ============================================================
-- 1. Payment history
-- Owners must approve or reject rent payments through
-- review_rent_payment(), not by directly editing payment rows.
-- ============================================================

drop policy if exists "Owners can update payment history"
on public.payment_history;

-- ============================================================
-- 2. Rooms
-- Owners may still create and delete their own rooms through the
-- existing INSERT and DELETE policies.
--
-- Room changes must use update_owner_room(), which validates
-- ownership, capacity, rent and supported room values.
-- ============================================================

drop policy if exists rooms_owner_manage
on public.rooms;

drop policy if exists "Owners can update rooms"
on public.rooms;

-- ============================================================
-- 3. Tenants
-- Tenant creation, movement, archival and deletion are managed by
-- security-definer workflows. Owners only require direct SELECT.
-- ============================================================

drop policy if exists tenants_owner_manage
on public.tenants;

drop policy if exists "Owners can insert tenants"
on public.tenants;

drop policy if exists "Owners can update tenants"
on public.tenants;

drop policy if exists "Owners can delete tenants"
on public.tenants;

-- ============================================================
-- 4. Expand tenant self-update protection
-- Tenants may retain access to safe profile fields, but cannot
-- directly alter identity linkage, financial accounting, rent
-- cycles, lifecycle state, room placement or archival metadata.
-- ============================================================

create or replace function public.protect_tenant_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() = old.user_id
  and (
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.property_id is distinct from old.property_id
    or new.room_id is distinct from old.room_id
    or new.email is distinct from old.email

    or new.rent_amount is distinct from old.rent_amount
    or new.pending_amount is distinct from old.pending_amount
    or new.total_paid is distinct from old.total_paid
    or new.rent_status is distinct from old.rent_status
    or new.last_payment_date is distinct from old.last_payment_date
    or new.last_overdue_alert_sent is distinct from old.last_overdue_alert_sent
    or new.late_fee_applied is distinct from old.late_fee_applied
    or new.advance_months_paid is distinct from old.advance_months_paid
    or new.joining_fee_paid is distinct from old.joining_fee_paid

    or new.security_deposit_amount is distinct from old.security_deposit_amount
    or new.security_deposit_status is distinct from old.security_deposit_status
    or new.security_deposit_refund_status is distinct from old.security_deposit_refund_status

    or new.paid_through_date is distinct from old.paid_through_date
    or new.current_rent_due_date is distinct from old.current_rent_due_date
    or new.current_rent_cycle_paid is distinct from old.current_rent_cycle_paid

    or new.payment_screenshot is distinct from old.payment_screenshot
    or new.upi_transaction_id is distinct from old.upi_transaction_id

    or new.status is distinct from old.status
    or new.move_in_date is distinct from old.move_in_date
    or new.check_out_requested is distinct from old.check_out_requested
    or new.notice_period_start is distinct from old.notice_period_start
    or new.notice_period_end is distinct from old.notice_period_end

    or new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason
    or new.vacated_at is distinct from old.vacated_at
    or new.vacate_reason is distinct from old.vacate_reason

    or new.vacate_rating is distinct from old.vacate_rating
    or new.vacate_feedback is distinct from old.vacate_feedback
    or new.rated_at is distinct from old.rated_at

    or new.created_at is distinct from old.created_at
  )
  then
    raise exception using
      errcode = '42501',
      message =
        'Tenant-managed identity, room, rent, payment, lifecycle and archive fields cannot be changed';
  end if;

  return new;
end;
$$;

revoke all
on function public.protect_tenant_managed_fields()
from public;
