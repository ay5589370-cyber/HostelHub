-- Local proposal only. Do not apply until reviewed and approved.
-- Extends the existing Phase 2 admission model; no new tables or policies are needed.
begin;

alter table public.students
  alter column gender drop not null,
  add column current_address text not null default '' check (length(current_address) <= 500),
  add column admission_note text not null default '' check (length(admission_note) <= 1000);

alter table public.guardians
  add column emergency_contact_name text not null default '' check (length(emergency_contact_name) <= 100),
  add column address text not null default '' check (length(address) <= 500);

alter table public.bed_allocations
  add column starts_on date not null default current_date;

-- Preserve the existing service-role-only entry point and all transaction semantics.
create or replace function public.finish_registration(request_id uuid, token uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare job public.student_registrations; d jsonb; sid uuid;
begin
 select * into strict job from public.student_registrations
 where id=request_id and lease_token=token and lease_until>now() for update;
 if job.student_id is not null then return job.student_id; end if;
 d:=job.payload;
 if not exists(select 1 from public.profiles where id=job.requested_by and role='admin' and is_active) then
   raise exception 'Administrator no longer active';
 end if;
 insert into public.students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,admission_date,permanent_address,current_address,city,state,pincode,admission_note)
 values(job.auth_user_id,d->>'student_id',d->>'full_name',(d->>'date_of_birth')::date,nullif(d->>'gender',''),job.email,d->>'phone',d->>'course',d->>'branch',d->>'academic_year',(d->>'semester')::integer,(d->>'admission_date')::date,d->>'permanent_address',coalesce(d->>'current_address',''),d->>'city',d->>'state',d->>'pincode',coalesce(d->>'admission_note',''))
 returning id into sid;
 insert into public.guardians(student_id,full_name,relationship,phone,email,emergency_contact,emergency_contact_name,address)
 values(sid,d->>'guardian_name',d->>'relationship',d->>'guardian_phone',nullif(d->>'guardian_email',''),d->>'emergency_contact',d->>'emergency_contact_name',coalesce(d->>'guardian_address',''));
 insert into public.bed_allocations(student_id,bed_id,starts_on)
 values(sid,(d->>'bed_id')::uuid,(d->>'allocation_start_date')::date);
 update public.profiles set full_name=d->>'full_name',phone=d->>'phone' where id=job.auth_user_id;
 update public.student_registrations set student_id=sid where id=request_id;
 return sid;
end; $$;

revoke all on function public.finish_registration(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_registration(uuid,uuid) to service_role;
commit;
