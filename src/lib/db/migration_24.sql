-- KlinikAid Migration 24: system_logs is written by the server, not by sessions
--
-- CONTEXT (#41)
-- The only INSERT policy on system_logs was
--
--   WITH CHECK (auth.uid() IS NOT NULL)
--
-- so an audit row could only be written by a signed-in caller. The events that
-- matter most are recorded when there is no session: a wrong password, a wrong
-- TOTP code (written right after signOut()), a deactivated account. Every one of
-- those inserts failed with 42501 and logEvent dropped it to console.error.
--
-- The policy was also too loose in the other direction: any signed-in user
-- (patients included) could insert rows through the public anon key with any
-- user_id, event_type and description -- i.e. forge audit entries attributed to
-- someone else.
--
-- FIX
-- src/lib/logger.ts now writes every audit row with the service-role client,
-- which bypasses RLS. Database-side writers (handle_new_user and friends) are
-- SECURITY DEFINER and are unaffected. With no remaining session-held writer,
-- the INSERT policy is dropped, so RLS denies INSERT to anon and authenticated.
--
-- ORDERING
-- Apply only AFTER the logger change is deployed. Applied first, every
-- logEvent from the old code is rejected and the audit trail goes dark.
--
-- Verify afterwards (as anon, with a user JWT): an INSERT into system_logs
-- fails with 42501; a failed login produces a LOGIN_FAILED row.

begin;

drop policy if exists "Authenticated users can insert system logs" on public.system_logs;

commit;
