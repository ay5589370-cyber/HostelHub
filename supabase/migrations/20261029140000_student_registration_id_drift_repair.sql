-- Corrective migration for a recorded student-ID migration whose objects are absent.
-- Safe to apply only after reviewing the live catalog and this entire file.
-- Creates no duplicate public registration tables and does not delete or rewrite records.
begin;

do $$
declare required_column record;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.students') is null
     or to_regclass('public.guardians') is null
     or to_regclass('public.bed_allocations') is null
     or to_regclass('public.beds') is null
     or to_regclass('public.rooms') is null
     or to_regclass('public.hostels') is null
     or to_regclass('public.student_registrations') is null then
    raise exception 'Registration prerequisite tables are missing; no repair applied';
  end if;

  for required_column in
    select * from (values
      ('public','profiles','role'), ('public','profiles','is_active'),
      ('public','profiles','full_name'), ('public','profiles','phone'),
      ('public','students','user_id'), ('public','students','student_id'),
      ('public','students','admission_date'), ('public','students','current_address'),
      ('public','students','admission_note'), ('public','guardians','emergency_contact_name'),
      ('public','guardians','address'), ('public','bed_allocations','starts_on'),
      ('public','student_registrations','id'), ('public','student_registrations','student_id'),
      ('public','student_registrations','auth_user_id'), ('public','student_registrations','requested_by'),
      ('public','student_registrations','payload'), ('public','student_registrations','email'),
      ('public','student_registrations','student_number'), ('public','student_registrations','lease_token'),
      ('public','student_registrations','lease_until'), ('public','student_registrations','attempts')
    ) as c(table_schema, table_name, column_name)
  loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = required_column.table_schema
         and c.table_name = required_column.table_name
         and c.column_name = required_column.column_name
    ) then
      raise exception 'Required registration column %.%.% is missing; no repair applied',
        required_column.table_schema, required_column.table_name,
        required_column.column_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'students'
       and indexdef ilike 'create unique index% (student_id)%'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'student_registrations'
       and indexdef ilike 'create unique index% (student_number)%'
  ) then
    raise exception 'Student ID uniqueness constraints are missing; manual schema review required';
  end if;
end;
$$;

create schema if not exists private;
grant usage on schema private to service_role;

create sequence if not exists private.student_id_seq;

create table if not exists private.registration_student_ids (
  registration_id uuid primary key,
  student_number text not null unique,
  created_at timestamptz not null default now()
);
revoke all on private.registration_student_ids from public, anon, authenticated;
grant all on private.registration_student_ids to service_role;

do $$
begin
  if exists (
    select 1
    from public.student_registrations r
    join public.students s
      on s.student_id = r.student_number
    where r.student_number is not null
  ) then
    raise exception
      'Existing registration student number conflicts with a student ID';
  end if;

  if exists (
    select student_number
    from public.student_registrations
    where student_number is not null
    group by student_number
    having count(*) > 1
  ) then
    raise exception
      'Duplicate student numbers exist across registration records';
  end if;

  if exists (
    select 1
    from public.student_registrations
    where student_number is not null
      and student_number !~ '^HH-[0-9]{8}$'
  ) then
    raise exception
      'Existing registration contains an invalid student number format';
  end if;

  if exists (
    select 1
    from private.registration_student_ids r
    join public.students s
      on s.student_id = r.student_number
  ) then
    raise exception
      'Existing reservation conflicts with an allocated student ID';
  end if;
end;
$$;

-- Preserve IDs already attached to registration jobs, including any jobs created
-- before the reservation table existed. Never overwrite conflicting reservations.
do $$
begin
  if exists (
    select 1
      from public.student_registrations r
      join private.registration_student_ids x on x.registration_id = r.id
     where r.student_number is distinct from x.student_number
  ) then
    raise exception 'Conflicting student ID reservations exist; manual review required';
  end if;
end;
$$;

insert into private.registration_student_ids(registration_id, student_number)
select id, student_number
  from public.student_registrations
on conflict (registration_id) do nothing;

create or replace function public.reserve_registration_student_id(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_number text;
  candidate text;
  inserted_number text;
begin
  if p_registration_id is null then
    raise exception 'Registration request ID is required' using errcode = '22023';
  end if;

  -- Serialize attempts for the same request, while sequence allocation remains
  -- concurrency-safe across distinct registrations.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_registration_id::text, 0)
  );

  select r.student_number into existing_number
    from private.registration_student_ids r
   where r.registration_id = p_registration_id;
  if existing_number is not null then return existing_number; end if;

  select r.student_number into existing_number
    from public.student_registrations r
   where r.id = p_registration_id;
  if existing_number is not null then
    insert into private.registration_student_ids(registration_id, student_number)
    values (p_registration_id, existing_number)
    on conflict (registration_id) do nothing;
    select r.student_number into strict existing_number
      from private.registration_student_ids r
     where r.registration_id = p_registration_id;
    return existing_number;
  end if;

  loop
    candidate := 'HH-' || pg_catalog.lpad(
      pg_catalog.nextval('private.student_id_seq'::pg_catalog.regclass)::text,
      8,
      '0'
    );
    if exists (
      select 1 from public.students s where s.student_id = candidate
      union all
      select 1 from public.student_registrations r where r.student_number = candidate
      union all
      select 1 from private.registration_student_ids r where r.student_number = candidate
    ) then
      continue;
    end if;

    inserted_number := null;
    insert into private.registration_student_ids(registration_id, student_number)
    values (p_registration_id, candidate)
    on conflict do nothing
    returning student_number into inserted_number;
    if inserted_number is not null then return inserted_number; end if;

    -- A conflicting reservation can only be this request or an unexpected ID
    -- collision. Re-read the same request before continuing.
    select r.student_number into existing_number
      from private.registration_student_ids r
     where r.registration_id = p_registration_id;
    if existing_number is not null then return existing_number; end if;
  end loop;
end;
$$;
revoke all on function public.reserve_registration_student_id(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_registration_student_id(uuid)
  to service_role;

create or replace function public.claim_registration(
  request_id uuid,
  actor uuid,
  input jsonb default null
) returns public.student_registrations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.student_registrations;
  requested_number text;
begin
  if not exists (
    select 1 from public.profiles
     where id = actor and role = 'admin' and is_active
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if input is not null then
    requested_number := input->>'student_id';
    if requested_number is null or requested_number !~ '^HH-[0-9]{8}$' then
      raise exception 'A reserved student ID is required';
    end if;
    if not exists (
      select 1 from private.registration_student_ids r
       where r.registration_id = request_id
         and r.student_number = requested_number
    ) then
      raise exception 'Student ID was not reserved for this registration';
    end if;

    insert into public.student_registrations(
      id, requested_by, payload, email, student_number
    ) values (
      request_id, actor, input, lower(input->>'email'), requested_number
    ) on conflict (id) do nothing;
  end if;

  select * into strict job
    from public.student_registrations
   where id = request_id
   for update;

  if job.requested_by <> actor then
    raise exception 'Registration request belongs to another administrator'
      using errcode = '42501';
  end if;
  if job.lease_until > now() then
    raise exception 'Registration is in progress. Retry in five minutes.';
  end if;

  if input is not null and job.payload <> input then
    if job.student_id is not null
       or job.email <> lower(input->>'email')
       or job.student_number <> requested_number then
      raise exception 'Request ID already used for a different student';
    end if;
    update public.student_registrations set payload = input where id = request_id;
    select * into strict job from public.student_registrations where id = request_id;
  end if;

  if job.sent_at > now() - interval '60 seconds' then
    raise exception 'Please wait one minute before resending';
  end if;

  if job.student_id is null then
    if exists (
      select 1 from public.students
       where student_id = job.student_number or lower(email) = job.email
    ) then
      raise exception 'Student ID or email is already registered';
    end if;
    if exists (
      select 1 from public.profiles
       where lower(email) = job.email and id <> job.auth_user_id
    ) then
      raise exception 'Email belongs to an existing account';
    end if;
    if not exists (
      select 1
        from public.beds b
        join public.rooms r on r.id = b.room_id
        join public.hostels h on h.id = r.hostel_id
       where b.id = (coalesce(input, job.payload)->>'bed_id')::uuid
         and b.status = 'available'
         and r.status = 'available'
         and h.status = 'active'
         and not exists (
           select 1 from public.bed_allocations a
            where a.bed_id = b.id and a.status = 'active'
         )
    ) then
      raise exception 'Selected bed is unavailable. Choose another bed and retry.';
    end if;
  end if;

  update public.student_registrations
     set lease_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes',
         attempts = attempts + 1
   where id = request_id
   returning * into job;
  return job;
end;
$$;

create or replace function public.finish_registration(request_id uuid, token uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job public.student_registrations;
  d jsonb;
  sid uuid;
begin
  select * into strict job
    from public.student_registrations
   where id = request_id
     and lease_token = token
     and lease_until > now()
   for update;
  if job.student_id is not null then return job.student_id; end if;

  if job.student_number !~ '^HH-[0-9]{8}$'
     or not exists (
       select 1 from private.registration_student_ids r
        where r.registration_id = request_id
          and r.student_number = job.student_number
     ) then
    raise exception 'Registration has no valid reserved student ID';
  end if;

  d := pg_catalog.jsonb_set(
    job.payload,
    '{student_id}',
    pg_catalog.to_jsonb(job.student_number),
    true
  );
  if not exists (
    select 1 from public.profiles
     where id = job.requested_by and role = 'admin' and is_active
  ) then
    raise exception 'Administrator no longer active';
  end if;

  insert into public.students(
    user_id, student_id, full_name, date_of_birth, gender, email, phone,
    course, branch, academic_year, semester, admission_date,
    permanent_address, current_address, city, state, pincode, admission_note
  ) values (
    job.auth_user_id, job.student_number, d->>'full_name',
    (d->>'date_of_birth')::date, nullif(d->>'gender',''), job.email,
    d->>'phone', d->>'course', d->>'branch', d->>'academic_year',
    (d->>'semester')::integer, (d->>'admission_date')::date,
    d->>'permanent_address', coalesce(d->>'current_address',''),
    d->>'city', d->>'state', d->>'pincode', coalesce(d->>'admission_note','')
  ) returning id into sid;

  insert into public.guardians(
    student_id, full_name, relationship, phone, email, emergency_contact,
    emergency_contact_name, address
  ) values (
    sid, d->>'guardian_name', d->>'relationship', d->>'guardian_phone',
    nullif(d->>'guardian_email',''), d->>'emergency_contact',
    coalesce(d->>'emergency_contact_name', ''), coalesce(d->>'guardian_address','')
  );

  insert into public.bed_allocations(student_id, bed_id, starts_on)
  values (sid, (d->>'bed_id')::uuid, (d->>'allocation_start_date')::date);

  update public.profiles
     set full_name = d->>'full_name', phone = d->>'phone'
   where id = job.auth_user_id;
  update public.student_registrations
     set payload = d, student_id = sid
   where id = request_id;
  return sid;
end;
$$;

-- Keep both registration entry points service-role-only, matching Phase 2.
revoke all on function public.claim_registration(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_registration(uuid, uuid, jsonb)
  to service_role;
revoke all on function public.finish_registration(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finish_registration(uuid, uuid)
  to service_role;

commit;
