-- Prevent tenants from directly modifying owner-controlled lifecycle,
-- occupancy, rent, payment, identity and archive fields.

create or replace function public.protect_tenant_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() = old.user_id and (
    new.user_id is distinct from old.user_id
    or new.property_id is distinct from old.property_id
    or new.room_id is distinct from old.room_id
    or new.email is distinct from old.email
    or new.rent_amount is distinct from old.rent_amount
    or new.pending_amount is distinct from old.pending_amount
    or new.total_paid is distinct from old.total_paid
    or new.rent_status is distinct from old.rent_status
    or new.last_payment_date is distinct from old.last_payment_date
    or new.payment_screenshot is distinct from old.payment_screenshot
    or new.upi_transaction_id is distinct from old.upi_transaction_id
    or new.status is distinct from old.status
    or new.move_in_date is distinct from old.move_in_date
    or new.check_out_requested is distinct from old.check_out_requested
    or new.notice_period_start is distinct from old.notice_period_start
    or new.notice_period_end is distinct from old.notice_period_end
    or new.archived_at is distinct from old.archived_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'Tenant-managed lifecycle, room, rent, payment, email and archive fields cannot be changed';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_tenant_managed_fields()
from public, anon, authenticated;
