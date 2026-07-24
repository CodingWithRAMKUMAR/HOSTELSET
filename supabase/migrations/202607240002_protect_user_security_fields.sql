-- Prevent authenticated users from changing their own authorization fields.
-- Active HostelSet admins and service-role operations remain allowed.

CREATE OR REPLACE FUNCTION public.protect_user_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Server-side service-role operations must continue working.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Active HostelSet admins may manage user roles and account status.
  IF public.is_hostelset_admin() THEN
    RETURN NEW;
  END IF;

  -- Ordinary authenticated users may update profile fields, but not security fields.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Not authorized to change protected user fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.protect_user_security_fields()
FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS protect_user_security_fields_trigger
ON public.users;

CREATE TRIGGER protect_user_security_fields_trigger
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.protect_user_security_fields();