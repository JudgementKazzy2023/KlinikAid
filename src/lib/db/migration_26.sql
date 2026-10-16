-- KlinikAid Migration 26: maintenance and lookup functions are service-role only
--
-- cleanup_expired_verification_codes() and get_user_id_by_email(text) are
-- server-side helpers. Nothing in the app calls them from a user session, so
-- execution is limited to service_role, matching get_role_for_email.
--
-- Both functions were created by the live migration 20260701000000
-- (src/lib/db/applied/), which the repo did not have until now.
--
-- ROLLBACK
--   grant execute on function public.cleanup_expired_verification_codes() to anon, authenticated;
--   grant execute on function public.get_user_id_by_email(text) to authenticated;

begin;

revoke all on function public.cleanup_expired_verification_codes() from public, anon, authenticated;
grant execute on function public.cleanup_expired_verification_codes() to service_role;

revoke all on function public.get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;

commit;
