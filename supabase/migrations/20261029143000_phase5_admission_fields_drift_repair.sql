-- Corrective migration: re-applies the Phase 5 admission-field schema changes.
--
-- Migration 20261024120000_phase5_student_admission_fields is recorded as applied
-- in supabase_migrations.schema_migrations, but its DDL effects are absent from the
-- live catalog. This migration restores the missing columns and the updated
-- finish_registration function using safe, idempotent DDL.
--
-- Scope: Phase 5 admission fields ONLY.  Does NOT touch student-ID reservation
-- objects (private.student_id_seq, private.registration_student_ids,
-- reserve_registration_student_id).

begin;

----------------------------------------------------------------------
-- 0. Prerequisites: the tables we modify must already exist.
----------------------------------------------------------------------
do $$
begin
  if to_regclass('public.students') is null
     or to_regclass('public.guardians') is null
     or to_regclass('public.bed_allocations') is null
     or to_regclass('public.student_registrations') is null then
    raise exception
      'Phase 5 repair aborted: prerequisite tables are missing. '
      'Phase 2 must be applied first.';
  end if;

  -- The columns we are about to add must not already exist with an
  -- incompatible type.  ADD COLUMN IF NOT EXISTS handles the happy
  -- path, but a column with the right name and a wrong type would
  -- silently pass and break later statements.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'current_address'
       and data_type <> 'text'
  ) then
    raise exception
      'students.current_address already exists with an unexpected type; manual review required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'admission_note'
       and data_type <> 'text'
  ) then
    raise exception
      'students.admission_note already exists with an unexpected type; manual review required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guardians'
       and column_name = 'emergency_contact_name'
       and data_type <> 'text'
  ) then
    raise exception
      'guardians.emergency_contact_name already exists with an unexpected type; manual review required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guardians'
       and column_name = 'address'
       and data_type <> 'text'
  ) then
    raise exception
      'guardians.address already exists with an unexpected type; manual review required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'bed_allocations'
       and column_name = 'starts_on'
       and data_type <> 'date'
  ) then
    raise exception
      'bed_allocations.starts_on already exists with an unexpected type; manual review required';
  end if;
end;
$$;

----------------------------------------------------------------------
-- 1. Add the five missing columns (idempotent).
----------------------------------------------------------------------
alter table public.students
  add column if not exists current_address text not null
    default '' check (length(current_address) <= 500);

alter table public.students
  add column if not exists admission_note text not null
    default '' check (length(admission_note) <= 1000);

alter table public.guardians
  add column if not exists emergency_contact_name text not null
    default '' check (length(emergency_contact_name) <= 100);

alter table public.guardians
  add column if not exists address text not null
    default '' check (length(address) <= 500);

alter table public.bed_allocations
  add column if not exists starts_on date not null
    default current_date;

----------------------------------------------------------------------
-- 2. Make students.gender nullable (idempotent).
--    Only act if gender is currently NOT NULL.
----------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'gender' and is_nullable = 'NO'
  ) then
    alter table public.students alter column gender drop not null;
  end if;
end;
$$;

----------------------------------------------------------------------
-- 3. Replace finish_registration with Phase 5 version.
--    - Same signature: (request_id uuid, token uuid) → uuid
--    - Same security model: SECURITY INVOKER, search_path = ''
--    - Adds: admission_date, current_address, admission_note to
--      students INSERT.
--    - Adds: emergency_contact_name, address to guardians INSERT.
--    - Adds: starts_on to bed_allocations INSERT.
--    - Uses nullif(gender,'') to handle nullable gender.
--    - Does NOT reference private.registration_student_ids or
--      reserve_registration_student_id (that is the ID-drift repair).
----------------------------------------------------------------------
create or replace function public.finish_registration(request_id uuid, token uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare job public.student_registrations; d jsonb; sid uuid;
begin
  select * into strict job from public.student_registrations
   where id = request_id and lease_token = token and lease_until > now()
   for update;
  if job.student_id is not null then return job.student_id; end if;

  d := job.payload;

  if not exists (
    select 1 from public.profiles
     where id = job.requested_by and role = 'admin' and is_active
  ) then
    raise exception 'Administrator no longer active';
  end if;

  insert into public.students(
    user_id, student_id, full_name, date_of_birth, gender,
    email, phone, course, branch, academic_year, semester,
    admission_date, permanent_address, current_address,
    city, state, pincode, admission_note
  ) values (
    job.auth_user_id, d->>'student_id', d->>'full_name',
    (d->>'date_of_birth')::date, nullif(d->>'gender', ''),
    job.email, d->>'phone', d->>'course', d->>'branch',
    d->>'academic_year', (d->>'semester')::integer,
    (d->>'admission_date')::date, d->>'permanent_address',
    coalesce(d->>'current_address', ''),
    d->>'city', d->>'state', d->>'pincode',
    coalesce(d->>'admission_note', '')
  ) returning id into sid;

  insert into public.guardians(
    student_id, full_name, relationship, phone, email,
    emergency_contact, emergency_contact_name, address
  ) values (
    sid, d->>'guardian_name', d->>'relationship', d->>'guardian_phone',
    nullif(d->>'guardian_email', ''), d->>'emergency_contact',
    coalesce(d->>'emergency_contact_name', ''), coalesce(d->>'guardian_address', '')
  );

  insert into public.bed_allocations(student_id, bed_id, starts_on)
  values (sid, (d->>'bed_id')::uuid, (d->>'allocation_start_date')::date);

  update public.profiles
     set full_name = d->>'full_name', phone = d->>'phone'
   where id = job.auth_user_id;

  update public.student_registrations
     set student_id = sid
   where id = request_id;

  return sid;
end;
$$;

-- Preserve service-role-only grants (matches Phase 2 originals).
revoke all on function public.finish_registration(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finish_registration(uuid, uuid)
  to service_role;

commit;
