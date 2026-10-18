-- KlinikAid Migration 33: allocate reception queue numbers atomically (#46)
--
-- /api/reception/triage numbered a new entry as "today's rows in the department
-- plus one", read in one request and inserted in another. Concurrent triage read
-- the same count and handed several patients the same number, and nothing in
-- the database rejected it. The "one open entry per patient" guard had the same
-- shape, so concurrent triage of one patient queued them several times.
--
-- What this adds:
--
--   patient_queue.queue_date / queue_number
--     The Philippine (Asia/Manila) calendar day and the number allocated on it.
--     Nullable: every existing row keeps null and is left exactly as it is,
--     including two historical (department, day, number) duplicates that only
--     exist inside triage_notes. The unique index covers allocated rows only.
--
--   queue_number_counters
--     One row per (department, day) holding the last number handed out. The
--     row lock taken by the increment serialises concurrent allocations, and the
--     counter never goes down, so a number is not reused after its entry is
--     cancelled or deleted. RLS on, no policies, no grants: only the allocator
--     below writes it.
--
--   allocate_queue_number(department)
--     SECURITY DEFINER because callers cannot write the counter table. It checks
--     queue.manage itself. The first allocation of a day starts above whatever
--     that day already holds (row count, allocated numbers, and numbers written
--     into triage_notes by the previous code), so the day the new code ships
--     does not restart at 001 under entries the old code already numbered.
--
--   triage_patient(...)
--     SECURITY INVOKER: the patient_queue insert stays under the existing RLS
--     policies. Checks queue.manage, refuses a patient who already has an open
--     entry (SQLSTATE PT409, open department in DETAIL), allocates, and inserts
--     the row with queue_number written both to the new columns and to
--     triage_notes, where every existing reader looks for it. One transaction,
--     so a refused or failed insert also rolls back its allocation.
--
--   patient_queue_one_open_per_patient
--     A patient has at most one waiting/in_progress entry, in any department.
--     This is the rule the route already enforced, now enforced by the database
--     so that concurrent requests cannot both pass it. The migration stops,
--     changing nothing, if live data already breaks it.
--
-- EXPAND: the previous application code keeps working once this is applied. It
-- never sets the new columns, so the number index ignores its rows; its own
-- count+1 numbering is unchanged. The only behaviour it sees differently is that
-- a concurrent second open entry for the same patient is now rejected (a 500
-- from that code) instead of being inserted.
--
-- ORDERING: apply before deploying the route that calls triage_patient(). The
-- new route fails every triage until this exists.
--
-- ROLLBACK (after reverting the route to its previous code)
--   drop function if exists public.triage_patient(uuid, text, text, jsonb, text);
--   drop function if exists public.allocate_queue_number(text);
--   drop table if exists public.queue_number_counters;
--   drop index if exists public.patient_queue_one_open_per_patient;
--   drop index if exists public.patient_queue_department_day_number_key;
--   alter table public.patient_queue drop constraint if exists patient_queue_queue_number_pair;
--   alter table public.patient_queue drop column if exists queue_number, drop column if exists queue_date;
--   Dropping the columns discards allocated numbers; triage_notes still holds them.

begin;

alter table public.patient_queue
  add column if not exists queue_date date,
  add column if not exists queue_number integer;

alter table public.patient_queue drop constraint if exists patient_queue_queue_number_pair;
alter table public.patient_queue
  add constraint patient_queue_queue_number_pair
  check ((queue_date is null) = (queue_number is null) and (queue_number is null or queue_number > 0));

create unique index if not exists patient_queue_department_day_number_key
  on public.patient_queue (department, queue_date, queue_number)
  where queue_number is not null;

-- The ALTER above holds an ACCESS EXCLUSIVE lock, so nothing can open a second
-- entry between this check and the index build.
do $$
declare
  v_patients integer;
begin
  select count(*) into v_patients
  from (
    select patient_id
    from public.patient_queue
    where status in ('waiting', 'in_progress')
    group by patient_id
    having count(*) > 1
  ) d;

  if v_patients > 0 then
    raise exception 'migration 33: % patient(s) have more than one open queue entry; resolve them before applying', v_patients;
  end if;
end;
$$;

create unique index if not exists patient_queue_one_open_per_patient
  on public.patient_queue (patient_id)
  where status in ('waiting', 'in_progress');

create table if not exists public.queue_number_counters (
  department text not null check (department in ('laboratory', 'imaging', 'ultrasound', 'ecg')),
  queue_date date not null,
  last_number integer not null check (last_number > 0),
  primary key (department, queue_date)
);

alter table public.queue_number_counters enable row level security;
revoke all on table public.queue_number_counters from public, anon, authenticated;

create or replace function public.allocate_queue_number(
  p_department text,
  out allocated_date date,
  out allocated_number integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz;
  v_seed integer;
begin
  if not public.user_has_permission(auth.uid(), 'queue.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if p_department is null or p_department not in ('laboratory', 'imaging', 'ultrasound', 'ecg') then
    raise exception 'invalid department' using errcode = '22023';
  end if;

  allocated_date := (now() at time zone 'Asia/Manila')::date;

  update public.queue_number_counters c
     set last_number = c.last_number + 1
   where c.department = p_department
     and c.queue_date = allocated_date
  returning c.last_number into allocated_number;

  if found then
    return;
  end if;

  -- First allocation for this department today: start above anything the day
  -- already holds, including entries numbered by the previous code.
  v_day_start := allocated_date::timestamp at time zone 'Asia/Manila';

  select greatest(
           count(*),
           coalesce(max(q.queue_number) filter (where q.queue_date = allocated_date), 0),
           coalesce(max(substring(q.triage_notes from '"queue_number"\s*:\s*"[A-Z]+-(\d{1,9})"')::integer), 0)
         )
    into v_seed
    from public.patient_queue q
   where q.department = p_department
     and (q.queue_date = allocated_date
          or (q.created_at >= v_day_start and q.created_at < v_day_start + interval '1 day'));

  insert into public.queue_number_counters as c (department, queue_date, last_number)
  values (p_department, allocated_date, v_seed + 1)
  on conflict (department, queue_date)
    do update set last_number = c.last_number + 1
  returning c.last_number into allocated_number;
end;
$$;

revoke all on function public.allocate_queue_number(text) from public, anon;
grant execute on function public.allocate_queue_number(text) to authenticated;

create or replace function public.triage_patient(
  p_patient_id uuid,
  p_department text,
  p_priority_level text,
  p_vitals jsonb,
  p_notes text
)
returns setof public.patient_queue
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_open_department text;
  v_date date;
  v_number integer;
  v_label text;
  v_constraint text;
  v_row public.patient_queue;
begin
  if not public.user_has_permission(auth.uid(), 'queue.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select q.department into v_open_department
    from public.patient_queue q
   where q.patient_id = p_patient_id
     and q.status in ('waiting', 'in_progress')
   limit 1;

  if found then
    raise exception 'patient already has an open queue entry'
      using errcode = 'PT409', detail = v_open_department;
  end if;

  select a.allocated_date, a.allocated_number
    into v_date, v_number
    from public.allocate_queue_number(p_department) a;

  v_label := case p_department
               when 'laboratory' then 'LAB'
               when 'imaging' then 'IMG'
               when 'ultrasound' then 'ULT'
               when 'ecg' then 'ECG'
             end
             || '-' || lpad(v_number::text, greatest(3, length(v_number::text)), '0');

  begin
    insert into public.patient_queue
      (patient_id, department, status, priority_level, triage_notes, queue_date, queue_number)
    values (
      p_patient_id,
      p_department,
      'waiting',
      coalesce(p_priority_level, 'routine'),
      json_build_object('queue_number', v_label, 'vitals', p_vitals, 'notes', coalesce(p_notes, ''))::text,
      v_date,
      v_number
    )
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'patient_queue_one_open_per_patient' then
      raise;
    end if;

    -- A concurrent request opened an entry after the check above. It has
    -- committed by now (the index waited for it), so it is visible here.
    select q.department into v_open_department
      from public.patient_queue q
     where q.patient_id = p_patient_id
       and q.status in ('waiting', 'in_progress')
     limit 1;

    raise exception 'patient already has an open queue entry'
      using errcode = 'PT409', detail = coalesce(v_open_department, '');
  end;

  return next v_row;
end;
$$;

revoke all on function public.triage_patient(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.triage_patient(uuid, text, text, jsonb, text) to authenticated;

commit;
