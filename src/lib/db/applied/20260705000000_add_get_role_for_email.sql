-- Recovered from supabase_migrations.schema_migrations (version 20260705000000, "add_get_role_for_email").
-- Already applied to the live database; kept here as the record. Do not re-run.

-- Create the get_role_for_email function to securely lookup roles by email
CREATE OR REPLACE FUNCTION public.get_role_for_email(email_address text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  found_role text;
BEGIN
  SELECT p.role INTO found_role
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = email_address;
  
  RETURN found_role;  -- NULL for unknown, actual role for known
END;
$$;

-- Restrict execution strictly to the service_role key to prevent account/email enumeration
REVOKE ALL ON FUNCTION public.get_role_for_email(text) FROM public;

REVOKE ALL ON FUNCTION public.get_role_for_email(text) FROM anon;

REVOKE ALL ON FUNCTION public.get_role_for_email(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_role_for_email(text) TO service_role;
