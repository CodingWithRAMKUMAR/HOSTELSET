create or replace function public.update_owner_room(
  p_room_id uuid,
  p_room_number text,
  p_monthly_rent numeric,
  p_capacity integer,
  p_sharing_type text,
  p_room_audience text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  room_record public.rooms%rowtype;
  updated_room public.rooms%rowtype;
  property_owner uuid;
  effective_period date;
  scheduled_tenant_count integer := 0;
  future_records_updated integer := 0;
  updated_rent_ids uuid[] := '{}'::uuid[];
  updated_rent_id uuid;
begin
  select *
  into room_record
  from public.rooms
  where id = p_room_id
  for update;

  if room_record.id is null then
    raise exception 'Room not found';
  end if;

  select owner_id
  into property_owner
  from public.properties
  where id = room_record.property_id;

  if property_owner is distinct from auth.uid()
     and not public.is_hostelset_admin() then
    raise exception 'Not authorized to edit this room';
  end if;

  if nullif(trim(p_room_number), '') is null then
    raise exception 'Room number is required';
  end if;

  if p_monthly_rent is null or p_monthly_rent <= 0 then
    raise exception 'Monthly rent must be greater than zero';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'Capacity must be greater than zero';
  end if;

  if p_capacity < coalesce(room_record.current_occupants, 0) then
    raise exception 'Capacity cannot be lower than current occupants';
  end if;

  if p_sharing_type not in (
    'single',
    'double',
    'triple',
    'four',
    'five'
  ) then
    raise exception 'Unsupported sharing type';
  end if;

  if p_room_audience not in (
    'boys',
    'girls',
    'coliving'
  ) then
    raise exception 'Unsupported room audience';
  end if;

  if exists (
    select 1
    from public.rooms room
    where room.property_id = room_record.property_id
      and room.room_number = trim(p_room_number)
      and room.id <> room_record.id
  ) then
    raise exception 'Room number already exists in this property';
  end if;

  effective_period :=
    (
      date_trunc('month', current_date)
      + interval '1 month'
    )::date;

  update public.rooms
  set room_number = trim(p_room_number),
      monthly_rent = p_monthly_rent,
      capacity = p_capacity,
      sharing_type = p_sharing_type,
      room_audience = p_room_audience,
      status = case
        when current_occupants >= p_capacity then 'occupied'
        else 'vacant'
      end,
      updated_at = now()
  where id = room_record.id
  returning *
  into updated_room;

  if room_record.monthly_rent is distinct from p_monthly_rent then
    update public.tenants tenant
    set scheduled_rent_amount = p_monthly_rent,
        scheduled_rent_effective_period = effective_period,
        updated_at = now()
    where tenant.room_id = room_record.id
      and tenant.status in (
        'active',
        'notice_period',
        'payment_pending'
      )
      and tenant.rent_follows_room = true;

    get diagnostics scheduled_tenant_count = row_count;

    with updated_rents as (
      update public.rent_records future_rent
      set amount = p_monthly_rent,
          updated_at = now()
      where future_rent.tenant_id in (
        select tenant.id
        from public.tenants tenant
        where tenant.room_id = room_record.id
          and tenant.status in (
            'active',
            'notice_period',
            'payment_pending'
          )
          and tenant.rent_follows_room = true
      )
        and future_rent.period_start >= effective_period
        and future_rent.status = 'unpaid'
      returning future_rent.id
    )
    select coalesce(
      array_agg(updated_rents.id),
      '{}'::uuid[]
    )
    into updated_rent_ids
    from updated_rents;

    future_records_updated :=
      coalesce(cardinality(updated_rent_ids), 0);

    foreach updated_rent_id in array updated_rent_ids
    loop
      perform public.reconcile_rent_record(updated_rent_id);
    end loop;
  end if;

  return to_jsonb(updated_room)
    || jsonb_build_object(
      'rent_change_scheduled',
        room_record.monthly_rent is distinct from p_monthly_rent,
      'previous_monthly_rent',
        room_record.monthly_rent,
      'new_monthly_rent',
        p_monthly_rent,
      'rent_effective_period',
        case
          when room_record.monthly_rent is distinct from p_monthly_rent
          then effective_period
          else null
        end,
      'scheduled_tenant_count',
        scheduled_tenant_count,
      'future_records_updated',
        future_records_updated
    );
end;
$function$;
