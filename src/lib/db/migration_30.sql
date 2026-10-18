-- KlinikAid Migration 30: cleanup_expired_verification_codes() deletes codes only
--
-- The function also deleted every auth.users row older than 24 hours whose
-- profiles.email_verified_at was null, on the assumption that a null meant
-- "never confirmed". It does not. Accounts created before migration 29, and
-- staff created already confirmed, have a null email_verified_at while Auth
-- holds them as confirmed, and migration 29 deliberately does not backfill it.
-- Run against the current data, the delete would remove confirmed, in-use
-- accounts and cascade to their profiles.
--
-- Auth's email_confirmed_at is the authoritative confirmation state. Removing
-- accounts that never confirmed is a retention decision with its own review,
-- not a side effect of expiring codes, so this function no longer deletes
-- accounts at all. The application has not written email_verification_codes
-- since sign-up moved to Auth's own confirmation; expiring old rows is all
-- that is left for it to do.
--
-- Signature, SECURITY DEFINER and search_path are unchanged, so the existing
-- grants from migration 26 (service_role only) carry over.
--
-- ORDERING: independent of any app change. Nothing in the app calls it.
--
-- ROLLBACK: none intended. The previous body is in
-- applied/20260701000000_add_email_verification.sql and must not be restored.

begin;

create or replace function public.cleanup_expired_verification_codes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.email_verification_codes
  where expires_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.cleanup_expired_verification_codes() from public, anon, authenticated;
grant execute on function public.cleanup_expired_verification_codes() to service_role;

commit;
