begin;

-- Managed fields remain protected when the tenant is the authenticated actor.
-- Only the validated vacate-cancellation RPC may temporarily authorize its
-- exact tenant lifecycle update while running as the trusted function owner.
create or replace function public.protect_tenant_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  protected_field text;
  protected_fields constant text[] := array[
    'id', 'user_id', 'property_id', 'room_id', 'email',
    'rent_amount', 'rent_follows_room',
    'scheduled_rent_amount', 'scheduled_rent_effective_period',
    'pending_amount', 'total_paid', 'rent_status',
    'last_payment_date', 'last_overdue_alert_sent',
    'late_fee_applied', 'advance_months_paid', 'joining_fee_paid',
    'security_deposit_amount', 'security_deposit_status',
    'security_deposit_refund_status', 'paid_through_date',
    'current_rent_due_date', 'current_rent_cycle_paid',
    'payment_screenshot', 'upi_transaction_id', 'status',
    'move_in_date', 'check_out_requested',
    'notice_period_start', 'notice_period_end',
    'archived_at', 'archived_by', 'archive_reason',
    'vacated_at', 'vacate_reason',
    'vacate_rating', 'vacate_feedback', 'rated_at', 'created_at'
  ];
  authorized_vacate_cancellation boolean;
begin
  authorized_vacate_cancellation :=
    current_user = 'postgres'
    and coalesce(
      current_setting(
        'hostelset.authorized_tenant_managed_update',
        true
      ),
      ''
    ) = 'cancel_vacate_request';

  if auth.uid() = old.user_id
     and not authorized_vacate_cancellation then
    foreach protected_field in array protected_fields
    loop
      if to_jsonb(new) -> protected_field
         is distinct from
         to_jsonb(old) -> protected_field then
        raise exception using
          errcode = '42501',
          message =
            'Tenant-managed identity, room, rent, payment, lifecycle and archive fields cannot be changed';
      end if;
    end loop;
  end if;

  return new;
end;
$function$;

comment on function public.protect_tenant_managed_fields() is
  'Blocks tenant changes to managed fields except the narrowly authorized vacate-cancellation lifecycle update.';


create or replace function public.cancel_vacate_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_record public.check_out_requests%rowtype;
  tenant_record public.tenants%rowtype;
begin
  select request.*
  into request_record
  from public.check_out_requests request
  where request.id = p_request_id
  for update;

  if request_record.id is null then
    raise exception 'Vacate request not found';
  end if;

  select tenant.*
  into tenant_record
  from public.tenants tenant
  where tenant.id = request_record.tenant_id
  for update;

  if tenant_record.id is null
     or tenant_record.user_id is distinct from auth.uid() then
    raise exception 'Not authorized';
  end if;

  if request_record.status not in ('pending', 'approved') then
    raise exception 'This vacate request is no longer active';
  end if;

  if public.has_active_room_reservation(
    request_record.room_id
  ) then
    raise exception
      'This vacate request cannot be cancelled because the room has already been reserved for another tenant';
  end if;

  update public.check_out_requests
  set status = 'cancelled',
      processed_at = coalesce(processed_at, now()),
      updated_at = now()
  where id = request_record.id;

  perform set_config(
    'hostelset.authorized_tenant_managed_update',
    'cancel_vacate_request',
    true
  );

  update public.tenants
  set status = 'active',
      check_out_requested = false,
      notice_period_start = null,
      notice_period_end = null,
      updated_at = now()
  where id = tenant_record.id;

  perform set_config(
    'hostelset.authorized_tenant_managed_update',
    '',
    true
  );

  return jsonb_build_object(
    'success', true,
    'status', 'cancelled'
  );
end;
$function$;

comment on function public.cancel_vacate_request(uuid) is
  'Atomically cancels an eligible tenant vacate request and restores active lifecycle state.';

revoke all
on function public.cancel_vacate_request(uuid)
from public, anon;

grant execute
on function public.cancel_vacate_request(uuid)
to authenticated;

commit;
