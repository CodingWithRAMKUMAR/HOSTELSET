begin;

-- Privileged server operations must be recognized before calling the
-- authenticated-admin helper. This preserves owner protection while allowing
-- trusted service-role membership maintenance.
create or replace function public.protect_property_membership_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in (
    'postgres',
    'service_role',
    'supabase_admin'
  ) then
    return new;
  end if;

  if (
    new.membership_active
      is distinct from old.membership_active
    or new.membership_expiry
      is distinct from old.membership_expiry
  )
  and not public.is_hostelset_admin()
  then
    raise exception using
      errcode = '42501',
      message =
        'Not authorized to change property membership fields';
  end if;

  return new;
end;
$function$;

comment on function
  public.protect_property_membership_fields() is
  'Protects property membership fields while allowing trusted database roles and active HostelSet admins.';

commit;
