-- Migration: First-login password setup and temporary credentials finalization
-- Enforces service-role only execution, SECURITY INVOKER, and atomic status transitions.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.student_registrations') is null
     or to_regclass('public.students') is null
     or to_regprocedure('public.finish_registration(uuid,uuid)') is null then
    raise exception 'Prerequisite registration tables or functions are missing';
  end if;
end;
$$;

-- 1. Add must_change_password to public.profiles if not present
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- 2. Update student_registrations_invitation_status_check
alter table public.student_registrations
  drop constraint if exists student_registrations_invitation_status_check,
  add constraint student_registrations_invitation_status_check
    check (invitation_status in ('pending', 'sent', 'failed', 'accepted', 'credentials_ready', 'password_set'));

-- 3. Drop legacy 0-arg function if it exists from previous drafts
drop function if exists public.complete_student_password_setup();

-- 4. Create hardened complete_student_password_setup(p_student_auth_id uuid)
create or replace function public.complete_student_password_setup(p_student_auth_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reg_count integer;
  v_prof_count integer;
begin
  if p_student_auth_id is null then
    raise exception 'Student auth ID is required' using errcode = '22023';
  end if;

  -- Verify target profile belongs to an active student with pending setup
  if not exists (
    select 1
      from public.profiles
     where id = p_student_auth_id
       and role = 'student'
       and is_active
       and must_change_password
  ) then
    raise exception 'No pending first-login password change exists for target user' using errcode = '42501';
  end if;

  -- Transition registration status from credentials_ready to password_set
  update public.student_registrations
     set invitation_status = 'password_set',
         last_error = null
   where auth_user_id = p_student_auth_id
     and invitation_status = 'credentials_ready';
  get diagnostics v_reg_count = row_count;

  if v_reg_count <> 1 then
    raise exception 'Expected exactly one registration record with credentials_ready status, found %', v_reg_count;
  end if;

  -- Clear must_change_password flag on profiles
  update public.profiles
     set must_change_password = false
   where id = p_student_auth_id
     and role = 'student'
     and is_active
     and must_change_password;
  get diagnostics v_prof_count = row_count;

  if v_prof_count <> 1 then
    raise exception 'Failed to update student profile password status';
  end if;
end;
$$;

alter function public.complete_student_password_setup(uuid) owner to postgres;

-- 5. Revoke all from public, anon, authenticated; grant strictly to service_role
revoke all on function public.complete_student_password_setup(uuid) from public, anon, authenticated;
grant execute on function public.complete_student_password_setup(uuid) to service_role;

-- Ensure service_role has necessary table privileges for SECURITY INVOKER execution
grant select, update(must_change_password) on public.profiles to service_role;
grant select, update(invitation_status, last_error) on public.student_registrations to service_role;

commit;
