-- Regression coverage for
-- public.protect_property_membership_fields().
begin;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values (
  'a3000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'membership-guard-owner@example.test',
  '',
  now(),
  jsonb_build_object(
    'provider',
    'email',
    'providers',
    jsonb_build_array('email')
  ),
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
);

insert into public.users (
  id,
  email,
  full_name,
  role,
  is_active
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'membership-guard-owner@example.test',
  'Membership Guard Test Owner',
  'owner',
  true
);

insert into public.properties (
  id,
  owner_id,
  name,
  address,
  city,
  membership_active,
  membership_expiry
)
values (
  'b3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'Membership Guard Test Property',
  'QA Test Address',
  'Hyderabad',
  false,
  null
);

-- Trusted server operations must be able to maintain membership state
-- without needing permission to invoke the authenticated-admin helper.
set local role service_role;

update public.properties
set membership_active = true,
    membership_expiry =
      now() + interval '30 days',
    updated_at = now()
where id =
  'b3000000-0000-4000-8000-000000000001';

reset role;

do $test$
declare
  property_record public.properties%rowtype;
begin
  select property.*
  into property_record
  from public.properties property
  where property.id =
    'b3000000-0000-4000-8000-000000000001';

  if property_record.membership_active
       is distinct from true
     or property_record.membership_expiry is null
  then
    raise exception
      'Trusted service-role membership update was not applied';
  end if;

  raise notice
    'ok - service-role membership maintenance remains authorized';
end;
$test$;

select set_config(
  'request.jwt.claim.sub',
  'a3000000-0000-4000-8000-000000000001',
  true
);

-- The property owner must still be unable to activate, revoke, or extend
-- their own HostelSet membership through a direct table update.
set local role authenticated;

do $test$
declare
  error_message text;
begin
  begin
    update public.properties
    set membership_active = false,
        membership_expiry = null,
        updated_at = now()
    where id =
      'b3000000-0000-4000-8000-000000000001';

    raise exception
      'Direct owner membership update was not blocked';
  exception
    when sqlstate '42501' then
      get stacked diagnostics
        error_message = message_text;

      if error_message is distinct from
        'Not authorized to change property membership fields'
      then
        raise exception
          'Unexpected membership protection error: %',
          error_message;
      end if;

      raise notice
        'ok - direct owner membership changes remain blocked';
  end;
end;
$test$;

reset role;

select set_config(
  'request.jwt.claim.sub',
  '',
  true
);

do $test$
declare
  property_record public.properties%rowtype;
begin
  select property.*
  into property_record
  from public.properties property
  where property.id =
    'b3000000-0000-4000-8000-000000000001';

  if property_record.membership_active
       is distinct from true
     or property_record.membership_expiry is null
  then
    raise exception
      'Blocked owner update changed membership state';
  end if;

  raise notice
    'Property membership guard database test passed';
end;
$test$;

rollback;
