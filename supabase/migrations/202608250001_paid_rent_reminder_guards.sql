-- Canonical paid-cycle protection for rent reminders.
--
-- A rent reminder belongs to one rent_records cycle. Eligibility must follow
-- cycle-level payment coverage, not tenant-level rent_status/pending_amount and
-- not rent_records.status alone.

begin;

create or replace function public.is_monthly_rent_payment_method(
  p_payment_method text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(nullif(lower(trim(p_payment_method)), ''), '') not in (
    '',
    'security_deposit',
    'deposit',
    'pre_booking',
    'pre-booking',
    'prebooking',
    'pre_booking_fee',
    'pre-booking_fee',
    'application_fee',
    'application-fee',
    'joining_fee',
    'joining-fee'
  );
$function$;

create or replace function public.rent_record_received_amount(
  p_rent_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(rent.credited_amount, 0)
    + coalesce((
        select sum(payment.amount)::numeric
        from public.payment_history payment
        where payment.rent_id = rent.id
          and payment.status = 'success'
          and public.is_monthly_rent_payment_method(
            payment.payment_method
          )
      ), 0)
  from public.rent_records rent
  where rent.id = p_rent_id;
$function$;

create or replace function public.rent_record_has_pending_payment(
  p_rent_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.payment_history payment
    where payment.rent_id = p_rent_id
      and payment.status = 'payment_pending'
      and public.is_monthly_rent_payment_method(payment.payment_method)
  );
$function$;

create or replace function public.rent_record_is_fully_paid(
  p_rent_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(public.rent_record_received_amount(rent.id), 0)
    >= rent.amount
  from public.rent_records rent
  where rent.id = p_rent_id
    and rent.status <> 'cancelled';
$function$;

create or replace function public.cancel_rent_reminders_for_paid_cycles(
  p_reference_time timestamptz default now(),
  p_rent_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cancelled_count integer := 0;
begin
  with paid_cycles as (
    select rent.id
    from public.rent_records rent
    where rent.status <> 'cancelled'
      and (p_rent_id is null or rent.id = p_rent_id)
      and coalesce(public.rent_record_received_amount(rent.id), 0)
        >= rent.amount
  ),
  marked_paid as (
    update public.rent_records rent
    set status = 'paid',
        paid_at = coalesce(rent.paid_at, p_reference_time),
        updated_at = p_reference_time
    from paid_cycles
    where rent.id = paid_cycles.id
      and rent.status is distinct from 'paid'
    returning rent.id
  ),
  cancelled as (
    update public.rent_reminder_queue queue
    set status = 'cancelled',
        lock_token = null,
        locked_at = null,
        last_error = 'Rent cycle paid',
        updated_at = p_reference_time
    from paid_cycles
    where queue.rent_id = paid_cycles.id
      and queue.status in ('pending', 'failed', 'processing')
    returning queue.id
  )
  select count(*)
  into cancelled_count
  from cancelled;

  return cancelled_count;
end;
$function$;

create or replace function public.cancel_paid_rent_reminder_if_covered(
  p_reminder_id uuid,
  p_rent_id uuid,
  p_lock_token uuid,
  p_reference_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reminder_rent_id uuid;
begin
  if p_reminder_id is null or p_rent_id is null or p_lock_token is null then
    return false;
  end if;

  select queue.rent_id
  into reminder_rent_id
  from public.rent_reminder_queue queue
  where queue.id = p_reminder_id
    and queue.status = 'processing'
    and queue.lock_token = p_lock_token
  for update;

  if reminder_rent_id is null then
    select queue.rent_id
    into reminder_rent_id
    from public.rent_reminder_queue queue
    where queue.id = p_reminder_id
      and queue.status = 'cancelled';
  end if;

  if reminder_rent_id is null
     or reminder_rent_id is distinct from p_rent_id
     or not coalesce(public.rent_record_is_fully_paid(p_rent_id), false) then
    return false;
  end if;

  perform public.cancel_rent_reminders_for_paid_cycles(
    p_reference_time,
    p_rent_id
  );

  return true;
end;
$function$;

create or replace function public.reconcile_rent_record(
  p_rent_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $function$
declare
  rent_record public.rent_records%rowtype;
  received_amount numeric := 0;
begin
  select *
  into rent_record
  from public.rent_records
  where id = p_rent_id
  for update;

  if rent_record.id is null then
    return 0;
  end if;

  received_amount :=
    coalesce(public.rent_record_received_amount(rent_record.id), 0);

  if rent_record.status = 'cancelled' then
    return received_amount;
  end if;

  update public.rent_records
  set status = case
        when received_amount >= amount then 'paid'
        else 'unpaid'
      end,
      paid_at = case
        when received_amount >= amount
          then coalesce(paid_at, now())
        else null
      end,
      updated_at = now()
  where id = rent_record.id;

  if received_amount >= rent_record.amount then
    perform public.cancel_rent_reminders_for_paid_cycles(
      now(),
      rent_record.id
    );
  end if;

  return received_amount;
end;
$function$;

create or replace function public.reconcile_rent_reminder_candidate_records(
  p_reference_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_rent record;
  reconciled_count integer := 0;
begin
  for candidate_rent in
    select distinct rent.id
    from public.rent_records rent
    where rent.status <> 'cancelled'
      and (
        rent.status = 'unpaid'
        or exists (
          select 1
          from public.rent_reminder_queue queue
          where queue.rent_id = rent.id
            and queue.status in ('pending', 'failed', 'processing')
        )
      )
  loop
    perform public.reconcile_rent_record(candidate_rent.id);
    reconciled_count := reconciled_count + 1;
  end loop;

  perform public.cancel_rent_reminders_for_paid_cycles(p_reference_time);

  return reconciled_count;
end;
$function$;

create or replace function public.attach_payment_to_rent_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  explicit_rent public.rent_records%rowtype;
begin
  if not public.is_monthly_rent_payment_method(new.payment_method) then
    new.rent_id := null;
    return new;
  end if;

  if new.rent_id is not null then
    select *
    into explicit_rent
    from public.rent_records rent
    where rent.id = new.rent_id;

    if explicit_rent.id is null then
      raise exception 'Rent record not found';
    end if;

    if explicit_rent.tenant_id is distinct from new.tenant_id then
      raise exception 'Rent record does not belong to this tenant';
    end if;

    if explicit_rent.status = 'cancelled' then
      raise exception 'Cannot attach payment to a cancelled rent cycle';
    end if;

    return new;
  end if;

  select rent.id
  into new.rent_id
  from public.rent_records rent
  where rent.tenant_id = new.tenant_id
    and rent.status <> 'cancelled'
    and coalesce(public.rent_record_received_amount(rent.id), 0)
      < rent.amount
  order by rent.due_date, rent.created_at, rent.id
  limit 1;

  if new.rent_id is null then
    perform public.materialize_monthly_rent_records(current_date);

    select rent.id
    into new.rent_id
    from public.rent_records rent
    where rent.tenant_id = new.tenant_id
      and rent.status <> 'cancelled'
      and coalesce(public.rent_record_received_amount(rent.id), 0)
        < rent.amount
    order by rent.due_date, rent.created_at, rent.id
    limit 1;
  end if;

  return new;
end;
$function$;

drop trigger if exists payment_history_attach_rent
  on public.payment_history;

create trigger payment_history_attach_rent
before insert or update of tenant_id, rent_id, payment_method
on public.payment_history
for each row
execute function public.attach_payment_to_rent_record();

create or replace function public.sync_successful_payment_to_rent_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_tenant_id uuid;
  new_tenant_id uuid;
begin
  new_tenant_id := new.tenant_id;

  if tg_op = 'UPDATE' then
    old_tenant_id := old.tenant_id;

    if old.rent_id is not null
       and public.is_monthly_rent_payment_method(old.payment_method)
       and (
         new.status is distinct from old.status
         or new.rent_id is distinct from old.rent_id
         or new.amount is distinct from old.amount
         or new.tenant_id is distinct from old.tenant_id
         or new.payment_method is distinct from old.payment_method
       ) then
      perform public.reconcile_rent_record(old.rent_id);
    end if;
  end if;

  if new.rent_id is not null
     and public.is_monthly_rent_payment_method(new.payment_method)
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.rent_id is distinct from new.rent_id
       or old.amount is distinct from new.amount
       or old.tenant_id is distinct from new.tenant_id
       or old.payment_method is distinct from new.payment_method
     ) then
    if new.status = 'success' then
      perform public.reconcile_rent_record(new.rent_id);
    elsif new.status = 'payment_pending' then
      update public.rent_reminder_queue
      set status = 'cancelled',
          lock_token = null,
          locked_at = null,
          last_error = 'Rent payment pending review',
          updated_at = now()
      where rent_id = new.rent_id
        and status in ('pending', 'failed', 'processing');
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'success'
       and public.is_monthly_rent_payment_method(new.payment_method) then
      perform public.refresh_tenant_rent_summary(new_tenant_id);
    end if;

    return new;
  end if;

  if (
    old.status = 'success'
    and public.is_monthly_rent_payment_method(old.payment_method)
  ) or (
    new.status = 'success'
    and public.is_monthly_rent_payment_method(new.payment_method)
  ) then
    if old_tenant_id is not null then
      perform public.refresh_tenant_rent_summary(old_tenant_id);
    end if;

    if new_tenant_id is distinct from old_tenant_id then
      perform public.refresh_tenant_rent_summary(new_tenant_id);
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists payment_history_complete_rent
  on public.payment_history;

create trigger payment_history_complete_rent
after insert or update of status, amount, rent_id, tenant_id, payment_method
on public.payment_history
for each row
execute function public.sync_successful_payment_to_rent_record();

create or replace function public.schedule_initial_rent_reminders(
  p_rent_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  rent_record public.rent_records%rowtype;
begin
  select *
  into rent_record
  from public.rent_records
  where id = p_rent_id;

  if rent_record.id is null then
    raise exception 'Rent record not found';
  end if;

  if rent_record.status <> 'unpaid'
     or not rent_record.reminders_enabled
     or coalesce(public.rent_record_received_amount(rent_record.id), 0)
        >= rent_record.amount
     or public.rent_record_has_pending_payment(rent_record.id) then
    update public.rent_reminder_queue
    set status = 'cancelled',
        lock_token = null,
        locked_at = null,
        updated_at = now()
    where rent_id = rent_record.id
      and status in ('pending', 'processing', 'failed');

    if coalesce(public.rent_record_received_amount(rent_record.id), 0)
       >= rent_record.amount then
      perform public.cancel_rent_reminders_for_paid_cycles(
        now(),
        rent_record.id
      );
    end if;

    return;
  end if;

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at
  )
  values
    (
      rent_record.tenant_id,
      rent_record.owner_id,
      rent_record.id,
      'before_due',
      0,
      public.rent_reminder_time(
        rent_record.due_date - 3,
        rent_record.reminder_timezone
      )
    ),
    (
      rent_record.tenant_id,
      rent_record.owner_id,
      rent_record.id,
      'due_today',
      0,
      public.rent_reminder_time(
        rent_record.due_date,
        rent_record.reminder_timezone
      )
    ),
    (
      rent_record.tenant_id,
      rent_record.owner_id,
      rent_record.id,
      'overdue_2_days',
      0,
      public.rent_reminder_time(
        rent_record.due_date + 2,
        rent_record.reminder_timezone
      )
    )
  on conflict (rent_id, reminder_type, reminder_sequence) do update
  set tenant_id = excluded.tenant_id,
      owner_id = excluded.owner_id,
      scheduled_at = excluded.scheduled_at,
      status = case
        when public.rent_reminder_queue.status in ('succeeded', 'dead_letter')
          then public.rent_reminder_queue.status
        else 'pending'
      end,
      retry_count = case
        when public.rent_reminder_queue.status in ('succeeded', 'dead_letter')
          then public.rent_reminder_queue.retry_count
        else 0
      end,
      lock_token = null,
      locked_at = null,
      last_error = null,
      updated_at = now();
end;
$function$;

create or replace function public.handle_rent_record_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('paid', 'cancelled')
     or not new.reminders_enabled
     or coalesce(public.rent_record_received_amount(new.id), 0)
        >= new.amount then
    update public.rent_reminder_queue
    set status = 'cancelled',
        lock_token = null,
        locked_at = null,
        updated_at = now()
    where rent_id = new.id
      and status in ('pending', 'processing', 'failed');

    if new.status <> 'cancelled'
       and coalesce(public.rent_record_received_amount(new.id), 0)
        >= new.amount then
      perform public.cancel_rent_reminders_for_paid_cycles(now(), new.id);
    end if;
  elsif tg_op = 'INSERT'
    or old.due_date is distinct from new.due_date
    or old.reminder_timezone is distinct from new.reminder_timezone
    or old.reminders_enabled is distinct from new.reminders_enabled
    or old.status is distinct from new.status then
    perform public.schedule_initial_rent_reminders(new.id);
  end if;

  return new;
end;
$function$;

create or replace function public.schedule_weekly_overdue_reminders(
  p_reference_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer;
begin
  perform public.cancel_rent_reminders_for_paid_cycles(p_reference_time);

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at
  )
  select
    rent.tenant_id,
    rent.owner_id,
    rent.id,
    'weekly_overdue',
    greatest(
      1,
      floor(
        (
          (p_reference_time at time zone rent.reminder_timezone)::date
          - (rent.due_date + 2)
        ) / 7.0
      )::integer + 1
    ) as reminder_sequence,
    public.rent_reminder_time(
      rent.due_date + 2 + (
        greatest(
          1,
          floor(
            (
              (p_reference_time at time zone rent.reminder_timezone)::date
              - (rent.due_date + 2)
            ) / 7.0
          )::integer + 1
        ) * 7
      ),
      rent.reminder_timezone
    ) as scheduled_at
  from public.rent_records rent
  where rent.status = 'unpaid'
    and rent.reminders_enabled
    and coalesce(public.rent_record_received_amount(rent.id), 0)
      < rent.amount
    and not public.rent_record_has_pending_payment(rent.id)
    and (p_reference_time at time zone rent.reminder_timezone)::date
      >= rent.due_date + 2
    and not exists (
      select 1
      from public.rent_reminder_queue outstanding
      where outstanding.rent_id = rent.id
        and outstanding.reminder_type = 'weekly_overdue'
        and outstanding.status in ('pending', 'processing', 'failed')
    )
  on conflict (rent_id, reminder_type, reminder_sequence) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

create or replace function public.claim_due_rent_reminders(
  p_lock_token uuid,
  p_batch_size integer default 25,
  p_reference_time timestamptz default now()
)
returns table(
  id uuid,
  tenant_id uuid,
  owner_id uuid,
  rent_id uuid,
  reminder_type text,
  scheduled_at timestamptz,
  retry_count integer,
  tenant_email text,
  tenant_name text,
  amount numeric,
  due_date date
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_lock_token is null then
    raise exception 'Lock token is required';
  end if;

  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100';
  end if;

  perform public.reconcile_rent_reminder_candidate_records(
    p_reference_time
  );
  perform public.cancel_rent_reminders_for_paid_cycles(p_reference_time);

  return query
  with candidates as (
    select queue.id
    from public.rent_reminder_queue queue
    join public.rent_records rent on rent.id = queue.rent_id
    where queue.status in ('pending', 'failed')
      and queue.scheduled_at <= p_reference_time
      and queue.retry_count < queue.max_retries
      and rent.status = 'unpaid'
      and rent.reminders_enabled
      and coalesce(public.rent_record_received_amount(rent.id), 0)
        < rent.amount
      and not public.rent_record_has_pending_payment(rent.id)
    order by queue.scheduled_at, queue.id
    for update of queue skip locked
    limit p_batch_size
  ), claimed as (
    update public.rent_reminder_queue queue
    set status = 'processing',
        lock_token = p_lock_token,
        locked_at = p_reference_time,
        last_attempt_at = p_reference_time,
        updated_at = p_reference_time
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select
    claimed.id,
    claimed.tenant_id,
    claimed.owner_id,
    claimed.rent_id,
    claimed.reminder_type,
    claimed.scheduled_at,
    claimed.retry_count,
    tenant.email,
    tenant.name,
    rent.amount,
    rent.due_date
  from claimed
  join public.tenants tenant on tenant.id = claimed.tenant_id
  join public.rent_records rent on rent.id = claimed.rent_id;
end;
$function$;

create or replace function public.complete_rent_reminder(
  p_reminder_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reminder_rent_id uuid;
begin
  select queue.rent_id
  into reminder_rent_id
  from public.rent_reminder_queue queue
  where queue.id = p_reminder_id
    and queue.status = 'processing'
    and queue.lock_token = p_lock_token
  for update;

  if reminder_rent_id is null then
    select queue.rent_id
    into reminder_rent_id
    from public.rent_reminder_queue queue
    where queue.id = p_reminder_id
      and queue.status = 'cancelled';

    if reminder_rent_id is not null
       and coalesce(public.rent_record_is_fully_paid(reminder_rent_id), false) then
      return true;
    end if;

    return false;
  end if;

  if coalesce(public.rent_record_is_fully_paid(reminder_rent_id), false) then
    perform public.cancel_rent_reminders_for_paid_cycles(
      now(),
      reminder_rent_id
    );
    return true;
  end if;

  update public.rent_reminder_queue
  set status = 'succeeded',
      sent_at = now(),
      lock_token = null,
      locked_at = null,
      last_error = null,
      updated_at = now()
  where id = p_reminder_id
    and status = 'processing'
    and lock_token = p_lock_token;

  return found;
end;
$function$;

create or replace function public.run_rent_reminder_scheduler(
  p_reference_time timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  vacates_completed integer;
  materialized integer;
  reconciled_records integer;
  paid_cycle_reminders_cancelled integer;
  weekly_scheduled integer;
  stale_recovered integer;
  stale_cancelled integer;
  pending_payment_reminders_cancelled integer;
  ready_count integer;
begin
  vacates_completed := public.complete_due_vacate_requests(
    (p_reference_time at time zone 'Asia/Kolkata')::date
  );

  materialized := public.materialize_monthly_rent_records(
    (p_reference_time at time zone 'Asia/Kolkata')::date
  );

  reconciled_records := public.reconcile_rent_reminder_candidate_records(
    p_reference_time
  );

  paid_cycle_reminders_cancelled :=
    public.cancel_rent_reminders_for_paid_cycles(p_reference_time);

  update public.rent_reminder_queue queue
  set status = 'cancelled',
      lock_token = null,
      locked_at = null,
      updated_at = p_reference_time
  where queue.status in ('pending', 'failed', 'processing')
    and public.rent_record_has_pending_payment(queue.rent_id);

  get diagnostics pending_payment_reminders_cancelled = row_count;

  weekly_scheduled := public.schedule_weekly_overdue_reminders(
    p_reference_time
  );
  stale_recovered := public.recover_stale_rent_reminders(p_reference_time);
  stale_cancelled := public.cancel_stale_rent_reminders(p_reference_time);

  paid_cycle_reminders_cancelled :=
    paid_cycle_reminders_cancelled
    + public.cancel_rent_reminders_for_paid_cycles(p_reference_time);

  select count(*)
  into ready_count
  from public.rent_reminder_queue queue
  join public.rent_records rent on rent.id = queue.rent_id
  where queue.status in ('pending', 'failed')
    and queue.scheduled_at <= p_reference_time
    and queue.retry_count < queue.max_retries
    and rent.status = 'unpaid'
    and rent.reminders_enabled
    and coalesce(public.rent_record_received_amount(rent.id), 0)
      < rent.amount
    and not public.rent_record_has_pending_payment(rent.id);

  return jsonb_build_object(
    'vacates_completed', vacates_completed,
    'materialized_rents', materialized,
    'rent_records_reconciled', reconciled_records,
    'paid_cycle_reminders_cancelled', paid_cycle_reminders_cancelled,
    'weekly_reminders_scheduled', weekly_scheduled,
    'stale_locks_recovered', stale_recovered,
    'stale_reminders_cancelled', stale_cancelled,
    'pending_payment_reminders_cancelled',
      pending_payment_reminders_cancelled,
    'ready_for_delivery', ready_count
  );
end;
$function$;

select public.reconcile_rent_reminder_candidate_records(now());
select public.cancel_rent_reminders_for_paid_cycles(now());

revoke all
on function public.is_monthly_rent_payment_method(text)
from public, anon;

revoke all
on function public.rent_record_received_amount(uuid)
from public, anon;

revoke all
on function public.rent_record_has_pending_payment(uuid)
from public, anon;

revoke all
on function public.rent_record_is_fully_paid(uuid)
from public, anon;

revoke all
on function public.cancel_rent_reminders_for_paid_cycles(timestamptz, uuid)
from public, anon, authenticated;

revoke all
on function public.cancel_paid_rent_reminder_if_covered(
  uuid,
  uuid,
  uuid,
  timestamptz
)
from public, anon, authenticated;

revoke all
on function public.reconcile_rent_reminder_candidate_records(timestamptz)
from public, anon, authenticated;

revoke all
on function public.schedule_initial_rent_reminders(uuid)
from public, anon, authenticated;

revoke all
on function public.schedule_weekly_overdue_reminders(timestamptz)
from public, anon, authenticated;

revoke all
on function public.run_rent_reminder_scheduler(timestamptz)
from public, anon, authenticated;

revoke all
on function public.claim_due_rent_reminders(uuid, integer, timestamptz)
from public, anon, authenticated;

revoke all
on function public.complete_rent_reminder(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.rent_record_received_amount(uuid)
to service_role;

grant execute
on function public.rent_record_is_fully_paid(uuid)
to service_role;

grant execute
on function public.cancel_paid_rent_reminder_if_covered(
  uuid,
  uuid,
  uuid,
  timestamptz
)
to service_role;

grant execute
on function public.run_rent_reminder_scheduler(timestamptz)
to service_role;

grant execute
on function public.claim_due_rent_reminders(uuid, integer, timestamptz)
to service_role;

grant execute
on function public.complete_rent_reminder(uuid, uuid)
to service_role;

commit;
