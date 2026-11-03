-- Server-generated hostel IDs, reserved durably per registration request.
-- Existing student IDs and in-flight registration numbers are preserved.
begin;

create sequence private.student_id_seq;

create table private.registration_student_ids (
  registration_id uuid primary key,
  student_number text not null unique,
  created_at timestamptz not null default now()
);
revoke all on private.registration_student_ids from public, anon, authenticated;
grant all on private.registration_student_ids to service_role;

create function public.reserve_registration_student_id(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare existing_number text;
        candidate text;
begin
  select r.student_number into existing_number
    from public.student_registrations r
   where r.id = p_registration_id;
  if existing_number is not null then return existing_number; end if;

  loop
    candidate := 'HH-' || lpad(nextval('private.student_id_seq')::text, 8, '0');
    if exists (
      select 1 from public.students s where s.student_id = candidate
      union all
      select 1 from public.student_registrations sr where sr.student_number = candidate
      union all
      select 1 from private.registration_student_ids rr where rr.student_number = candidate
    ) then
      continue;
    end if;
    exit;
  end loop;

  insert into private.registration_student_ids(registration_id, student_number)
  values (p_registration_id, candidate)
  on conflict (registration_id) do nothing;

  select r.student_number into strict existing_number
    from private.registration_student_ids r
   where r.registration_id = p_registration_id;
  return existing_number;
end;
$$;
revoke all on function public.reserve_registration_student_id(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_registration_student_id(uuid)
  to service_role;

commit;
