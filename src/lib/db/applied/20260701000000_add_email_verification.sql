-- Recovered from supabase_migrations.schema_migrations (version 20260701000000, "add_email_verification").
-- Already applied to the live database; kept here as the record. Do not re-run.

-- 1. Create the email verification codes table
CREATE TABLE IF NOT EXISTS public.email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,             -- store hashed for security (SHA-256)
  expires_at timestamp with time zone NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email
  ON public.email_verification_codes (email);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at
  ON public.email_verification_codes (expires_at);

-- Enable Row Level Security (RLS)
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

-- By leaving no policies on public.email_verification_codes, all direct public
-- and authenticated user queries are blocked. Only the service_role can access it.

-- 2. Add email_verified_at to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified_at timestamp with time zone;

-- 3. Grandfather existing accounts atomically
UPDATE public.profiles
  SET email_verified_at = now()
  WHERE email_verified_at IS NULL;

-- 4. Create Postgres cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
  -- Delete expired codes older than 24 hours
  DELETE FROM public.email_verification_codes
  WHERE expires_at < now() - interval '24 hours';

  -- Delete orphan unverified auth users older than 24 hours
  -- Cascade will automatically delete their profiles row
  DELETE FROM auth.users u
  USING public.profiles p
  WHERE u.id = p.id
    AND p.email_verified_at IS NULL
    AND u.created_at < now() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Helper function to query auth.users by email (RPC helper used by Edge Functions)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_address text)
RETURNS uuid AS $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = email_address LIMIT 1;
  RETURN user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public;

REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
