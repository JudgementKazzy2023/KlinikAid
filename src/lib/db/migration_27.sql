-- KlinikAid Migration 27: sign-in attempt limits and single-use TOTP codes (#59)
--
-- Supabase Auth does not limit wrong passwords or wrong TOTP codes at the
-- volumes a single attacker needs, and it accepts the same TOTP code more than
-- once inside its validity window. The login server action enforces both, and
-- this migration holds the state it needs. The state lives in Postgres because
-- the app runs on short-lived serverless instances that share no memory.
--
-- login_attempts: one row per (email, client IP). Each sign-in submission is
--   counted *before* the password is checked; a full sign-in deletes the row.
--   After MAX attempts inside the window, that email is refused from that IP
--   until the lock expires. Keying on the IP as well means a stranger who knows
--   a clinician's email cannot lock the clinician out from elsewhere.
--
-- used_totp_codes: a code accepted for a factor is recorded and refused for
--   that factor again until it has aged out of every window GoTrue would still
--   accept it in.
--
-- Everything is service_role only: the tables have RLS on with no policies and
-- no grants to anon/authenticated, and the functions are revoked from them.
--
-- Keep LOGIN_MAX_ATTEMPTS / LOGIN_WINDOW in sync with
-- src/lib/auth/login-attempts.ts, which only uses them for the error message.
--
-- ROLLBACK
--   drop function if exists public.begin_login_attempt(text, text);
--   drop function if exists public.refund_login_attempt(text, text);
--   drop function if exists public.clear_login_attempts(text, text);
--   drop function if exists public.claim_totp_code(uuid, text);
--   drop table if exists public.login_attempts;
--   drop table if exists public.used_totp_codes;

begin;

create table if not exists public.login_attempts (
  email_key    text        not null,
  ip           text        not null,
  attempts     integer     not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  primary key (email_key, ip)
);

create index if not exists login_attempts_window_start_idx
  on public.login_attempts (window_start);

create table if not exists public.used_totp_codes (
  factor_id uuid        not null,
  code      text        not null,
  used_at   timestamptz not null default now(),
  primary key (factor_id, code)
);

alter table public.login_attempts  enable row level security;
alter table public.used_totp_codes enable row level security;

revoke all on table public.login_attempts  from public, anon, authenticated;
revoke all on table public.used_totp_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.login_attempts  to service_role;
grant select, insert, update, delete on table public.used_totp_codes to service_role;

-- Counts one sign-in attempt for (email, ip), or refuses it.
-- allowed = false means the caller must not check the password at all.
create or replace function public.begin_login_attempt(
  p_email text,
  p_ip    text,
  out allowed     boolean,
  out retry_after timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  max_attempts constant integer  := 5;
  window_len   constant interval := interval '15 minutes';
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip    text := coalesce(p_ip, '');
  r public.login_attempts;
begin
  -- Rows for emails nobody signs in with again would otherwise accumulate.
  delete from public.login_attempts
   where window_start < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.login_attempts (email_key, ip)
  values (v_email, v_ip)
  on conflict do nothing;

  -- Row lock: concurrent submissions are counted one at a time, so firing
  -- requests in parallel does not buy extra guesses.
  select * into r
    from public.login_attempts
   where email_key = v_email and ip = v_ip
     for update;

  if r.locked_until is not null and r.locked_until > now() then
    allowed := false;
    retry_after := r.locked_until;
    return;
  end if;

  -- Window over, or a lock that has been served: start counting afresh.
  if r.window_start <= now() - window_len or r.locked_until is not null then
    r.attempts := 0;
    r.window_start := now();
  end if;

  if r.attempts >= max_attempts then
    update public.login_attempts
       set locked_until = now() + window_len
     where email_key = v_email and ip = v_ip
    returning locked_until into retry_after;
    allowed := false;
    return;
  end if;

  update public.login_attempts
     set attempts = r.attempts + 1,
         window_start = r.window_start,
         locked_until = null
   where email_key = v_email and ip = v_ip;

  allowed := true;
  retry_after := null;
end;
$$;

-- Gives back the attempt counted for a submission that proved the password and
-- stopped to ask for the TOTP code. Without it, merely reaching the code step
-- would use up one of the user's code attempts.
create or replace function public.refund_login_attempt(p_email text, p_ip text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.login_attempts
     set attempts = greatest(attempts - 1, 0)
   where email_key = lower(btrim(coalesce(p_email, '')))
     and ip = coalesce(p_ip, '')
     and (locked_until is null or locked_until <= now());
$$;

-- A completed sign-in resets the counter for (email, ip).
create or replace function public.clear_login_attempts(p_email text, p_ip text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_attempts
   where email_key = lower(btrim(coalesce(p_email, '')))
     and ip = coalesce(p_ip, '');
$$;

-- Records a TOTP code that GoTrue just accepted for p_factor_id.
-- Returns false if the code was already accepted for that factor recently,
-- i.e. this is a replay. The primary key makes concurrent claims safe: exactly
-- one of two simultaneous logins with the same code gets true.
create or replace function public.claim_totp_code(p_factor_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  -- A 30-second step accepted with one step of clock skew either side is valid
  -- for at most 90 seconds; 5 minutes is comfortably past that.
  delete from public.used_totp_codes
   where used_at < now() - interval '5 minutes';

  insert into public.used_totp_codes (factor_id, code)
  values (p_factor_id, p_code)
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

revoke all on function public.begin_login_attempt(text, text)  from public, anon, authenticated;
revoke all on function public.refund_login_attempt(text, text) from public, anon, authenticated;
revoke all on function public.clear_login_attempts(text, text) from public, anon, authenticated;
revoke all on function public.claim_totp_code(uuid, text)      from public, anon, authenticated;
grant execute on function public.begin_login_attempt(text, text)  to service_role;
grant execute on function public.refund_login_attempt(text, text) to service_role;
grant execute on function public.clear_login_attempts(text, text) to service_role;
grant execute on function public.claim_totp_code(uuid, text)      to service_role;

commit;
