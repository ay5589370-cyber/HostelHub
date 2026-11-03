-- Phase 2 registration mode: admin-issued temporary password, no Auth email.
-- Depends on Phase 1 profiles and Phase 2 registrations/student admission.
begin;

do $$ begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.student_registrations') is null
     or to_regclass('public.students') is null
     or to_regprocedure('public.finish_registration(uuid,uuid)') is null then
    raise exception 'Temporary credentials require Phase 1 profiles and Phase 2 registration tables/functions';
  end if;
end $$;

alter table public.profiles
  add column must_change_password boolean not null default false;

alter table public.student_registrations
  drop constraint student_registrations_invitation_status_check,
  add constraint student_registrations_invitation_status_check
    check (invitation_status in ('pending','sent','failed','accepted','credentials_ready','password_set'));

create function public.complete_student_password_setup() returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  update public.profiles
     set must_change_password=false
   where id=actor and role='student' and is_active and must_change_password;
  if not found then raise exception 'No pending first-login password change exists'; end if;
  update public.student_registrations
     set invitation_status='password_set',last_error=null
   where auth_user_id=actor and invitation_status='credentials_ready';
end; $$;
revoke all on function public.complete_student_password_setup() from public,anon,authenticated;
grant execute on function public.complete_student_password_setup() to authenticated;

commit;
