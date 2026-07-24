-- Prevent property owners from directly activating or extending their own
-- HostelSet membership. Membership changes must be performed by an authorized
-- admin workflow.

create or replace function public.protect_property_membership_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.membership_active is distinct from old.membership_active
    or new.membership_expiry is distinct from old.membership_expiry
  )
  and not public.is_hostelset_admin()
  and current_user not in ('postgres', 'service_role', 'supabase_admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Not authorized to change property membership fields';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_property_membership_fields_trigger
on public.properties;

create trigger protect_property_membership_fields_trigger
before update of membership_active, membership_expiry
on public.properties
for each row
execute function public.protect_property_membership_fields();

revoke all on function public.protect_property_membership_fields() from public;