-- REVIEW ONLY until approved. Depends on the unchanged Phase 1 migration.
begin;
create table public.students (
 id uuid primary key default gen_random_uuid(), user_id uuid unique not null references auth.users(id),
 student_id text unique not null check(length(student_id) between 1 and 40),
 full_name text not null check(length(trim(full_name)) between 2 and 100), date_of_birth date not null check(date_of_birth < current_date),
 gender text not null check(gender in ('female','male','other','prefer_not_to_say')),
 email text not null check(email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), phone text not null check(phone ~ '^\+?[0-9 ()-]{7,20}$'),
 course text not null check(length(trim(course)) between 1 and 200), branch text not null check(length(trim(branch)) between 1 and 200), academic_year text not null check(length(trim(academic_year)) between 1 and 200),
 semester integer not null check(semester between 1 and 20), admission_date date not null default current_date,
 permanent_address text not null check(length(trim(permanent_address)) between 1 and 500), city text not null check(length(trim(city)) between 1 and 200), state text not null check(length(trim(state)) between 1 and 200), pincode text not null check(pincode ~ '^[0-9]{6}$'),
 profile_photo_path text, status text not null default 'active' check(status in ('active','inactive','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(profile_photo_path is null or split_part(profile_photo_path,'/',1) = id::text)
);
create unique index students_email_unique on public.students(lower(email));
create index students_directory_idx on public.students(status, created_at desc, id);
create index students_course_idx on public.students(course);
create table public.guardians (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id),
 full_name text not null check(length(trim(full_name)) between 1 and 100), relationship text not null check(length(trim(relationship)) between 1 and 200), phone text not null check(phone ~ '^\+?[0-9 ()-]{7,20}$'),
 email text check(email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), emergency_contact text not null check(emergency_contact ~ '^\+?[0-9 ()-]{7,20}$'), is_primary boolean not null default true, created_at timestamptz not null default now()
);
create index guardians_student_idx on public.guardians(student_id);
create unique index guardians_primary_idx on public.guardians(student_id) where is_primary;
-- Each row is a hostel/block pair. Adding a block reuses the hostel name.
create table public.hostels (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 block text not null check(length(trim(block)) between 1 and 100), address text not null default '', status text not null default 'active' check(status in ('active','inactive')),
 created_at timestamptz not null default now(), unique(name,block)
);
create table public.rooms (
 id uuid primary key default gen_random_uuid(), hostel_id uuid not null references public.hostels(id),
 room_number text not null check(length(trim(room_number)) between 1 and 30), floor_number integer not null default 0 check(floor_number between -5 and 100),
 capacity integer not null check(capacity between 1 and 20), room_type text not null,
 status text not null default 'available' check(status in ('available','maintenance')),
 created_at timestamptz not null default now(), unique(hostel_id,room_number)
);
create table public.beds (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id), bed_number text not null,
 status text not null default 'available' check(status in ('available','maintenance')), unique(room_id,bed_number)
);
create table public.bed_allocations (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id),
 bed_id uuid not null references public.beds(id), allocated_at timestamptz not null default now(), vacated_at timestamptz,
 status text not null default 'active' check(status in ('active','vacated')),
 check((status='active' and vacated_at is null) or (status='vacated' and vacated_at >= allocated_at))
);
create unique index allocation_one_student on public.bed_allocations(student_id) where status='active';
create unique index allocation_one_bed on public.bed_allocations(bed_id) where status='active';
create index allocation_student_history on public.bed_allocations(student_id, allocated_at desc);
create index allocation_bed_history on public.bed_allocations(bed_id);
create table public.student_registrations (
 id uuid primary key, student_id uuid unique references public.students(id), auth_user_id uuid unique not null default gen_random_uuid(),
 requested_by uuid not null references public.profiles(id), payload jsonb not null,
 email text unique not null, student_number text unique not null,
 invitation_status text not null default 'pending' check(invitation_status in ('pending','sent','failed','accepted')),
 attempts integer not null default 0, last_error text, sent_at timestamptz,
 lease_token uuid, lease_until timestamptz, created_at timestamptz not null default now()
);
create index registration_admin_idx on public.student_registrations(requested_by);

create function private.own_student(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.students s join public.profiles p on p.id=s.user_id
 where s.id=p_id and s.user_id=(select auth.uid()) and s.status='active' and p.is_active and p.role='student');
$$;
revoke all on function private.own_student(uuid) from public,anon,authenticated;
grant execute on function private.own_student(uuid) to authenticated;

create function private.check_allocation() returns trigger language plpgsql security definer set search_path='' as $$
declare st text; bs text; rs text; hs text;
begin
 if new.status <> 'active' then return new; end if;
 select status into st from public.students where id=new.student_id for update;
 if st is distinct from 'active' then raise exception 'Only active students can receive allocations'; end if;
 -- Room lock serializes availability changes and allocations; unique indexes arbitrate competing beds/students.
 select r.status,h.status,b.status into rs,hs,bs from public.beds b join public.rooms r on r.id=b.room_id
 join public.hostels h on h.id=r.hostel_id where b.id=new.bed_id for update of r,h,b;
 if rs is distinct from 'available' or hs is distinct from 'active' or bs is distinct from 'available' then
 raise exception 'Selected bed is unavailable'; end if;
 return new;
end; $$;
revoke all on function private.check_allocation() from public,anon,authenticated;
create trigger allocation_guard before insert or update on public.bed_allocations for each row execute function private.check_allocation();
create function private.check_capacity() returns trigger language plpgsql set search_path='' as $$
declare cap integer; used integer;
begin
 if tg_table_name='beds' then
   if tg_op='UPDATE' and new.room_id<>old.room_id then raise exception 'Beds cannot be moved between rooms'; end if;
   select capacity into cap from public.rooms where id=new.room_id for update;
   select count(*) into used from public.beds where room_id=new.room_id and id<>new.id;
   if used >= cap then raise exception 'Room capacity exceeded'; end if;
 else
   select count(*) into used from public.beds where room_id=new.id;
   if new.capacity < used then raise exception 'Capacity cannot be below the configured bed count'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.check_capacity() from public,anon,authenticated;
create trigger bed_capacity before insert or update on public.beds for each row execute function private.check_capacity();
create trigger room_capacity before update on public.rooms for each row execute function private.check_capacity();
create trigger students_updated_at before update on public.students for each row execute function private.set_updated_at();

-- Mutations are narrowly scoped RPCs, not broad browser table grants.
create function private.manage_phase2(action text, data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result_id uuid; target public.students; cap integer; i integer;
begin
 if auth.uid() is null or not private.is_active_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 case action
 when 'hostel' then
   insert into public.hostels(name,block,address) values(trim(data->>'name'),trim(data->>'block'),coalesce(data->>'address','')) returning id into result_id;
 when 'room' then
   cap := (data->>'capacity')::integer;
   insert into public.rooms(hostel_id,room_number,floor_number,capacity,room_type)
   values((data->>'hostel_id')::uuid,trim(data->>'room_number'),(data->>'floor_number')::integer,cap,data->>'room_type') returning id into result_id;
   for i in 1..cap loop insert into public.beds(room_id,bed_number) values(result_id,i::text); end loop;
 when 'room_update' then
   result_id := (data->>'id')::uuid;
   perform 1 from public.rooms where id=result_id for update;
   if not found then raise exception 'Room not found'; end if;
   update public.rooms set status=data->>'status',capacity=(data->>'capacity')::integer where id=result_id;
   -- Growing a room generates the missing beds; shrinking below bed count is rejected.
   for i in 1..(data->>'capacity')::integer loop
     if not exists(select 1 from public.beds where room_id=result_id and bed_number=i::text) then
       insert into public.beds(room_id,bed_number) values(result_id,i::text);
     end if;
   end loop;
 when 'transfer' then
   result_id := (data->>'id')::uuid;
   perform 1 from public.students where id=result_id and status='active' for update;
   if not found then raise exception 'Active student not found'; end if;
   if exists(select 1 from public.bed_allocations where student_id=result_id and bed_id=(data->>'bed_id')::uuid and status='active') then return jsonb_build_object('id',result_id); end if;
   update public.bed_allocations set status='vacated',vacated_at=now() where student_id=result_id and status='active';
   insert into public.bed_allocations(student_id,bed_id) values(result_id,(data->>'bed_id')::uuid);
 when 'status' then
   result_id := (data->>'id')::uuid;
   select * into strict target from public.students where id=result_id for update;
   update public.students set status=data->>'status' where id=result_id;
   update public.profiles set is_active=(data->>'status'='active') where id=target.user_id;
   if data->>'status'<>'active' then
     update public.bed_allocations set status='vacated',vacated_at=now() where student_id=result_id and status='active';
   end if;
 when 'edit' then
   result_id := (data->>'id')::uuid;
   select * into strict target from public.students where id=result_id for update;
   update public.students set full_name=data->>'full_name',date_of_birth=(data->>'date_of_birth')::date,
   gender=data->>'gender',phone=data->>'phone',course=data->>'course',branch=data->>'branch',academic_year=data->>'academic_year',
   semester=(data->>'semester')::integer,permanent_address=data->>'permanent_address',city=data->>'city',state=data->>'state',pincode=data->>'pincode'
   where id=result_id;
   update public.profiles set full_name=data->>'full_name',phone=data->>'phone' where id=target.user_id;
   update public.guardians set full_name=data->>'guardian_name',relationship=data->>'relationship',phone=data->>'guardian_phone',
   email=nullif(data->>'guardian_email',''),emergency_contact=data->>'emergency_contact' where student_id=result_id and is_primary;
 when 'pending_bed' then
   result_id := (data->>'id')::uuid;
   update public.student_registrations set payload=jsonb_set(payload,'{bed_id}',to_jsonb((data->>'bed_id')::text))
   where id=result_id and student_id is null and (lease_until is null or lease_until<=now());
   if not found then raise exception 'Registration already completed or is in progress'; end if;
 else raise exception 'Unsupported action';
 end case;
 return jsonb_build_object('id',result_id);
end; $$;
revoke all on function private.manage_phase2(text,jsonb) from public,anon,authenticated;
grant execute on function private.manage_phase2(text,jsonb) to authenticated;
create function public.manage_phase2(action text,data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.manage_phase2(action,data); $$;
revoke all on function public.manage_phase2(text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_phase2(text,jsonb) to authenticated;

-- Only the Edge Function service client can claim/finalize durable registration jobs.
create function public.claim_registration(request_id uuid, actor uuid, input jsonb default null) returns public.student_registrations
language plpgsql security invoker set search_path='' as $$
declare job public.student_registrations;
begin
 if not exists(select 1 from public.profiles where id=actor and role='admin' and is_active) then raise exception 'Administrator access required'; end if;
 if input is not null then
 insert into public.student_registrations(id,requested_by,payload,email,student_number)
 values(request_id,actor,input,lower(input->>'email'),input->>'student_id') on conflict(id) do nothing;
 end if;
 select * into strict job from public.student_registrations where id=request_id for update;
 if job.lease_until>now() then raise exception 'Registration is in progress. Retry in five minutes.'; end if;
 if input is not null and job.payload<>input then
   if job.student_id is not null or job.email<>lower(input->>'email') or job.student_number<>input->>'student_id' then
     raise exception 'Request ID already used for a different student';
   end if;
   update public.student_registrations set payload=input where id=request_id;
 end if;
 if job.sent_at>now()-interval '60 seconds' then raise exception 'Please wait one minute before resending'; end if;
 if job.student_id is null then
   if exists(select 1 from public.students where student_id=job.student_number or lower(email)=job.email) then raise exception 'Student ID or email is already registered'; end if;
   if exists(select 1 from public.profiles where lower(email)=job.email and id<>job.auth_user_id) then raise exception 'Email belongs to an existing account'; end if;
   if not exists(select 1 from public.beds b join public.rooms r on r.id=b.room_id join public.hostels h on h.id=r.hostel_id
    where b.id=(coalesce(input,job.payload)->>'bed_id')::uuid and b.status='available' and r.status='available' and h.status='active'
    and not exists(select 1 from public.bed_allocations a where a.bed_id=b.id and a.status='active')
   ) then raise exception 'Selected bed is unavailable. Choose another bed and retry.'; end if;
 end if;
 update public.student_registrations set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 where id=request_id returning * into job;
 return job;
end; $$;
create function public.finish_registration(request_id uuid, token uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare job public.student_registrations; d jsonb; sid uuid;
begin
 select * into strict job from public.student_registrations where id=request_id and lease_token=token and lease_until>now() for update;
 if job.student_id is not null then return job.student_id; end if;
 d:=job.payload;
 if not exists(select 1 from public.profiles where id=job.requested_by and role='admin' and is_active) then raise exception 'Administrator no longer active'; end if;
 insert into public.students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode)
 values(job.auth_user_id,d->>'student_id',d->>'full_name',(d->>'date_of_birth')::date,d->>'gender',job.email,d->>'phone',d->>'course',d->>'branch',d->>'academic_year',(d->>'semester')::integer,d->>'permanent_address',d->>'city',d->>'state',d->>'pincode') returning id into sid;
 insert into public.guardians(student_id,full_name,relationship,phone,email,emergency_contact)
 values(sid,d->>'guardian_name',d->>'relationship',d->>'guardian_phone',nullif(d->>'guardian_email',''),d->>'emergency_contact');
 insert into public.bed_allocations(student_id,bed_id) values(sid,(d->>'bed_id')::uuid);
 update public.profiles set full_name=d->>'full_name',phone=d->>'phone' where id=job.auth_user_id;
 update public.student_registrations set student_id=sid where id=request_id;
 return sid;
end; $$;
revoke all on function public.claim_registration(uuid,uuid,jsonb),public.finish_registration(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_registration(uuid,uuid,jsonb),public.finish_registration(uuid,uuid) to service_role;
grant usage on schema private to service_role;

alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.hostels enable row level security;
alter table public.rooms enable row level security;
alter table public.beds enable row level security;
alter table public.bed_allocations enable row level security;
alter table public.student_registrations enable row level security;
revoke all on public.students,public.guardians,public.hostels,public.rooms,public.beds,public.bed_allocations,public.student_registrations from anon,authenticated;
grant select on public.students,public.guardians,public.hostels,public.rooms,public.beds,public.bed_allocations to authenticated;
grant select(id,student_id,invitation_status,attempts,last_error,sent_at,created_at) on public.student_registrations to authenticated;
grant update(phone,profile_photo_path) on public.students to authenticated;
grant all on public.students,public.guardians,public.hostels,public.rooms,public.beds,public.bed_allocations,public.student_registrations to service_role;
create policy students_read on public.students for select to authenticated using ((select private.is_active_admin()) or private.own_student(id));
create policy students_safe_edit on public.students for update to authenticated using ((select private.is_active_admin()) or private.own_student(id)) with check ((select private.is_active_admin()) or private.own_student(id));
create policy guardians_read on public.guardians for select to authenticated using ((select private.is_active_admin()) or private.own_student(student_id));
create policy allocations_read on public.bed_allocations for select to authenticated using ((select private.is_active_admin()) or private.own_student(student_id));
create policy beds_read on public.beds for select to authenticated using ((select private.is_active_admin()) or exists(select 1 from public.bed_allocations a where a.bed_id=beds.id and a.status='active' and private.own_student(a.student_id)));
create policy rooms_read on public.rooms for select to authenticated using ((select private.is_active_admin()) or exists(select 1 from public.beds b where b.room_id=rooms.id));
create policy hostels_read on public.hostels for select to authenticated using ((select private.is_active_admin()) or exists(select 1 from public.rooms r where r.hostel_id=hostels.id));
create policy registrations_read on public.student_registrations for select to authenticated using ((select private.is_active_admin()));

create view public.student_directory with (security_invoker=true) as
select s.*, h.id as hostel_id,h.name as hostel_name,h.block,r.id as room_id,r.room_number,b.bed_number,
 j.invitation_status,j.id as registration_id
from public.students s left join public.bed_allocations a on a.student_id=s.id and a.status='active'
left join public.beds b on b.id=a.bed_id left join public.rooms r on r.id=b.room_id left join public.hostels h on h.id=r.hostel_id
left join public.student_registrations j on j.student_id=s.id;
grant select on public.student_directory to authenticated;

create function private.registration_accepted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null then
  update public.student_registrations set invitation_status='accepted',last_error=null where auth_user_id=new.id and student_id is not null;
 end if;
 return new;
end; $$;
revoke all on function private.registration_accepted() from public,anon,authenticated;
create trigger registration_accepted after update of email_confirmed_at on auth.users for each row execute function private.registration_accepted();

-- A late mail-provider response must not overwrite a concurrently accepted invitation.
create function private.preserve_invitation_acceptance() returns trigger language plpgsql set search_path='' as $$
begin
 if old.invitation_status='accepted' then new.invitation_status:='accepted'; new.last_error:=null; end if;
 return new;
end; $$;
revoke all on function private.preserve_invitation_acceptance() from public,anon,authenticated;
create trigger preserve_invitation_acceptance before update on public.student_registrations for each row execute function private.preserve_invitation_acceptance();

create function public.phase2_dashboard() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'students',(select count(*) from public.students where status='active'),
 'rooms',(select count(*) from public.rooms),
 'occupied',(select count(*) from public.bed_allocations where status='active'),
 'available',(select count(*) from public.beds b join public.rooms r on r.id=b.room_id join public.hostels h on h.id=r.hostel_id where b.status='available' and r.status='available' and h.status='active' and not exists(select 1 from public.bed_allocations a where a.bed_id=b.id and a.status='active')),
 'total_beds',(select count(*) from public.beds),
 'recent',coalesce((select jsonb_agg(x) from (select id,full_name,student_id,created_at from public.students order by created_at desc limit 5) x),'[]'::jsonb),
 'hostels',coalesce((select jsonb_agg(x) from (select h.name,h.block,count(b.id) as beds,count(a.id) as occupied from public.hostels h left join public.rooms r on r.hostel_id=h.id left join public.beds b on b.room_id=r.id left join public.bed_allocations a on a.bed_id=b.id and a.status='active' group by h.id) x),'[]'::jsonb)
); $$;
revoke all on function public.phase2_dashboard() from public,anon,authenticated;
grant execute on function public.phase2_dashboard() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('student-avatars','student-avatars',false,5242880,array['image/jpeg','image/png','image/webp']);
create function private.avatar_access(path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.students s where s.id::text=split_part(path,'/',1)
 and (private.is_active_admin() or private.own_student(s.id)));
$$;
revoke all on function private.avatar_access(text) from public,anon,authenticated;
grant execute on function private.avatar_access(text) to authenticated;
create policy avatars_read on storage.objects for select to authenticated using(bucket_id='student-avatars' and private.avatar_access(name));
create policy avatars_insert on storage.objects for insert to authenticated with check(bucket_id='student-avatars' and private.avatar_access(name));
create policy avatars_update on storage.objects for update to authenticated using(bucket_id='student-avatars' and private.avatar_access(name)) with check(bucket_id='student-avatars' and private.avatar_access(name));
create policy avatars_delete on storage.objects for delete to authenticated using(bucket_id='student-avatars' and private.avatar_access(name));

-- Realtime events remain filtered by the table SELECT policies.
alter publication supabase_realtime add table public.students,public.rooms,public.beds,public.bed_allocations;
commit;
