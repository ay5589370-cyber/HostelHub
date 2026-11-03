-- Phase 3: Day-out and night-out leave. Review before applying.
begin;

create sequence public.leave_request_number_seq;

create table public.hostel_leave_policies (
  hostel_id uuid primary key references public.hostels(id),
  max_day_out_hours integer not null default 16 check (max_day_out_hours between 1 and 72),
  max_night_out_hours integer not null default 72 check (max_night_out_hours between 1 and 336),
  emergency_contact_required boolean not null default true,
  allow_student_cancel_approved boolean not null default false,
  max_documents integer not null default 3 check (max_documents between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  request_nonce uuid not null unique,
  student_id uuid not null references public.students(id),
  leave_type text not null check (leave_type in ('day_out','night_out')),
  departure_at timestamptz not null,
  expected_return_at timestamptz not null,
  destination text not null check (length(trim(destination)) between 2 and 250),
  reason text not null check (length(trim(reason)) between 5 and 2000),
  emergency_contact text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','completed','overdue')),
  admin_remarks text check (admin_remarks is null or length(trim(admin_remarks)) <= 2000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departure_at < expected_return_at),
  check ((reviewed_by is null and reviewed_at is null) or (reviewed_by is not null and reviewed_at is not null))
);
create index leave_requests_student_created_idx on public.leave_requests(student_id, created_at desc);
create index leave_requests_status_departure_idx on public.leave_requests(status, departure_at);
create index leave_requests_pending_created_idx on public.leave_requests(created_at desc) where status = 'pending';

create table public.leave_request_documents (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  student_id uuid not null references public.students(id),
  object_path text not null unique,
  original_name text not null check (length(trim(original_name)) between 1 and 255),
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  created_at timestamptz not null default now()
);
create index leave_documents_request_idx on public.leave_request_documents(leave_request_id);

create table public.leave_request_history (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  previous_status text,
  new_status text not null check (new_status in ('pending','approved','rejected','cancelled','completed','overdue')),
  remarks text,
  actor_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index leave_history_request_idx on public.leave_request_history(leave_request_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  leave_request_id uuid references public.leave_requests(id) on delete cascade,
  event_type text not null check (event_type in ('leave_submitted','leave_approved','leave_rejected','leave_cancelled','leave_overdue')),
  title text not null check (length(title) between 1 and 200),
  message text not null check (length(message) between 1 and 1000),
  delivery_status text not null default 'in_app_created' check (delivery_status in ('in_app_created','read','failed')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(recipient_user_id, leave_request_id, event_type)
);
create index notifications_recipient_idx on public.notifications(recipient_user_id, read_at, created_at desc);

create function private.current_student_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.students s join public.profiles p on p.id=s.user_id
  where s.user_id=(select auth.uid()) and s.status='active' and p.role='student' and p.is_active
$$;
revoke all on function private.current_student_id() from public, anon, authenticated;
grant execute on function private.current_student_id() to authenticated;

create function private.leave_request_access(p_request_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_active_admin()) or exists(
    select 1 from public.leave_requests r where r.id=p_request_id and r.student_id=private.current_student_id()
  )
$$;
revoke all on function private.leave_request_access(uuid) from public, anon, authenticated;
grant execute on function private.leave_request_access(uuid) to authenticated;

create function private.leave_document_access(p_path text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpe?g|png|webp)$' then exists(
    select 1 from public.leave_requests r
    where r.id=(split_part(p_path,'/',2))::uuid
      and r.student_id=(split_part(p_path,'/',1))::uuid
      and ((select private.is_active_admin()) or (r.student_id=private.current_student_id() and (not p_write or r.status='pending')))
  ) else false end
$$;
revoke all on function private.leave_document_access(text,boolean) from public, anon, authenticated;
grant execute on function private.leave_document_access(text,boolean) to authenticated;

create function private.leave_policy(p_student_id uuid) returns public.hostel_leave_policies
language sql stable security definer set search_path = '' as $$
  select lp.* from public.bed_allocations a join public.beds b on b.id=a.bed_id
  join public.rooms r on r.id=b.room_id join public.hostel_leave_policies lp on lp.hostel_id=r.hostel_id
  where a.student_id=p_student_id and a.status='active' limit 1
$$;
revoke all on function private.leave_policy(uuid) from public, anon, authenticated;

create function private.validate_leave_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare policy public.hostel_leave_policies; max_hours integer;
begin
  if new.departure_at <= now() then raise exception 'Departure must be in the future'; end if;
  if new.departure_at >= new.expected_return_at then raise exception 'Departure must precede expected return'; end if;
  select * into policy from private.leave_policy(new.student_id);
  max_hours := case new.leave_type when 'day_out' then coalesce(policy.max_day_out_hours,16) else coalesce(policy.max_night_out_hours,72) end;
  if new.expected_return_at > new.departure_at + make_interval(hours=>max_hours) then raise exception 'Leave duration exceeds hostel policy'; end if;
  if coalesce(policy.emergency_contact_required,true) and (new.emergency_contact is null or new.emergency_contact !~ '^\+?[0-9 ()-]{7,20}$') then
    raise exception 'A valid emergency contact is required';
  end if;
  if exists(select 1 from public.leave_requests r where r.student_id=new.student_id and r.id<>new.id
    and r.status in ('pending','approved') and tstzrange(r.departure_at,r.expected_return_at,'[)') && tstzrange(new.departure_at,new.expected_return_at,'[)')) then
    raise exception 'This leave conflicts with an active request';
  end if;
  return new;
end; $$;
revoke all on function private.validate_leave_request() from public, anon, authenticated;

create function private.leave_history_and_notifications() returns trigger
language plpgsql security definer set search_path = '' as $$
declare requester uuid; ref text;
begin
  if tg_op='INSERT' then
    insert into public.leave_request_history(leave_request_id,new_status,actor_user_id)
    values(new.id,new.status,(select auth.uid()));
    select user_id into requester from public.students where id=new.student_id;
    select request_number into ref from public.leave_requests where id=new.id;
    insert into public.notifications(recipient_user_id,leave_request_id,event_type,title,message)
    select p.id,new.id,'leave_submitted','New leave request',format('%s is awaiting review.',ref)
    from public.profiles p where p.role='admin' and p.is_active on conflict do nothing;
  elsif old.status is distinct from new.status then
    insert into public.leave_request_history(leave_request_id,previous_status,new_status,remarks,actor_user_id)
    values(new.id,old.status,new.status,new.admin_remarks,(select auth.uid()));
    select user_id into requester from public.students where id=new.student_id;
    if new.status in ('approved','rejected','cancelled','overdue') then
      insert into public.notifications(recipient_user_id,leave_request_id,event_type,title,message)
      values(requester,new.id,'leave_'||new.status,
        case new.status when 'approved' then 'Leave request approved' when 'rejected' then 'Leave request rejected' when 'overdue' then 'Leave return overdue' else 'Leave request cancelled' end,
        format('%s: %s',new.request_number,coalesce(new.admin_remarks,'Check your leave request for details.')))
      on conflict do nothing;
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.leave_history_and_notifications() from public, anon, authenticated;

create trigger leave_validate before insert on public.leave_requests for each row execute function private.validate_leave_request();
create trigger leave_updated_at before update on public.leave_requests for each row execute function private.set_updated_at();
create trigger leave_history after insert or update of status on public.leave_requests for each row execute function private.leave_history_and_notifications();
create trigger leave_policy_updated_at before update on public.hostel_leave_policies for each row execute function private.set_updated_at();

create function private.submit_leave(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid uuid; request_id uuid; request_no text; nonce uuid;
begin
  sid:=private.current_student_id();
  if sid is null then raise exception 'Active student account required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext(sid::text));
  nonce:=(p_data->>'request_nonce')::uuid;
  select id,request_number into request_id,request_no from public.leave_requests where student_id=sid and request_nonce=nonce;
  if found then return jsonb_build_object('id',request_id,'request_number',request_no,'student_id',sid,'duplicate',true); end if;
  insert into public.leave_requests(request_number,request_nonce,student_id,leave_type,departure_at,expected_return_at,destination,reason,emergency_contact)
  values('LVR-'||to_char(now() at time zone 'UTC','YYYY')||'-'||lpad(nextval('public.leave_request_number_seq')::text,6,'0'),nonce,sid,
    p_data->>'leave_type',(p_data->>'departure_at')::timestamptz,(p_data->>'expected_return_at')::timestamptz,
    trim(p_data->>'destination'),trim(p_data->>'reason'),nullif(trim(p_data->>'emergency_contact'),'') )
  returning id,request_number into request_id,request_no;
  return jsonb_build_object('id',request_id,'request_number',request_no,'student_id',sid,'duplicate',false);
end; $$;
revoke all on function private.submit_leave(jsonb) from public, anon, authenticated;
grant execute on function private.submit_leave(jsonb) to authenticated;
create function public.submit_leave(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.submit_leave(p_data); $$;
revoke all on function public.submit_leave(jsonb) from public, anon, authenticated;
grant execute on function public.submit_leave(jsonb) to authenticated;

create function private.review_leave(p_request_id uuid,p_status text,p_remarks text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.leave_requests;
begin
  if auth.uid() is null or not private.is_active_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_status not in ('approved','rejected','cancelled') then raise exception 'Unsupported review decision'; end if;
  if p_status='rejected' and length(trim(coalesce(p_remarks,'')))<3 then raise exception 'A rejection reason is required'; end if;
  select * into strict request from public.leave_requests where id=p_request_id for update;
  if request.status<>'pending' and not (request.status='approved' and p_status='cancelled') then raise exception 'This request has already been decided'; end if;
  update public.leave_requests set status=p_status,admin_remarks=nullif(trim(p_remarks),''),reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id;
  return jsonb_build_object('id',p_request_id,'status',p_status);
end; $$;
revoke all on function private.review_leave(uuid,text,text) from public, anon, authenticated;
grant execute on function private.review_leave(uuid,text,text) to authenticated;
create function public.review_leave(p_request_id uuid,p_status text,p_remarks text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.review_leave(p_request_id,p_status,p_remarks); $$;
revoke all on function public.review_leave(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_leave(uuid,text,text) to authenticated;

create function private.cancel_leave(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.leave_requests;
begin
  select * into strict request from public.leave_requests where id=p_request_id for update;
  if request.student_id<>private.current_student_id() then raise exception 'Not your leave request' using errcode='42501'; end if;
  if request.status<>'pending' then raise exception 'Only pending leave requests can be cancelled by students'; end if;
  update public.leave_requests set status='cancelled' where id=p_request_id;
  return jsonb_build_object('id',p_request_id,'status','cancelled');
end; $$;
revoke all on function private.cancel_leave(uuid) from public, anon, authenticated;
grant execute on function private.cancel_leave(uuid) to authenticated;
create function public.cancel_leave(p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.cancel_leave(p_request_id); $$;
revoke all on function public.cancel_leave(uuid) from public, anon, authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;

create function private.register_leave_document(p_request_id uuid,p_path text,p_original_name text,p_content_type text,p_byte_size integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.leave_requests; limit_docs integer; result uuid;
begin
  select * into strict request from public.leave_requests where id=p_request_id for update;
  if request.student_id<>private.current_student_id() or request.status<>'pending' then raise exception 'Documents can only be attached to your pending leave request' using errcode='42501'; end if;
  select coalesce(lp.max_documents,3) into limit_docs from private.leave_policy(request.student_id) lp;
  if (select count(*) from public.leave_request_documents where leave_request_id=p_request_id)>=coalesce(limit_docs,3) then raise exception 'Document limit reached'; end if;
  if p_path !~ ('^'||request.student_id::text||'/'||request.id::text||'/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$') then raise exception 'Invalid document path'; end if;
  insert into public.leave_request_documents(leave_request_id,student_id,object_path,original_name,content_type,byte_size)
  values(p_request_id,request.student_id,p_path,p_original_name,p_content_type,p_byte_size) returning id into result;
  return result;
end; $$;
revoke all on function private.register_leave_document(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function private.register_leave_document(uuid,text,text,text,integer) to authenticated;
create function public.register_leave_document(p_request_id uuid,p_path text,p_original_name text,p_content_type text,p_byte_size integer) returns uuid language sql security invoker set search_path='' as $$ select private.register_leave_document(p_request_id,p_path,p_original_name,p_content_type,p_byte_size); $$;
revoke all on function public.register_leave_document(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.register_leave_document(uuid,text,text,text,integer) to authenticated;

create function public.refresh_leave_overdue() returns integer
language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
  update public.leave_requests set status='overdue' where status='approved' and expected_return_at<now();
  get diagnostics affected=row_count;
  return affected;
end; $$;
revoke all on function public.refresh_leave_overdue() from public, anon, authenticated;
grant execute on function public.refresh_leave_overdue() to service_role;

create function public.phase3_dashboard() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'pending',(select count(*) from public.leave_requests where status='pending'),
 'approved',(select count(*) from public.leave_requests where status='approved'),
 'upcoming',(select count(*) from public.leave_requests where status='approved' and departure_at>=now()),
 'overdue',(select count(*) from public.leave_requests where status='overdue' or (status='approved' and expected_return_at<now())),
 'recent_decisions',coalesce((select jsonb_agg(x) from (select id,request_number,status,departure_at,updated_at from public.leave_requests where status in ('approved','rejected','cancelled') order by reviewed_at desc limit 5) x),'[]'::jsonb)
); $$;
revoke all on function public.phase3_dashboard() from public, anon, authenticated;
grant execute on function public.phase3_dashboard() to authenticated;

alter table public.hostel_leave_policies enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_request_documents enable row level security;
alter table public.leave_request_history enable row level security;
alter table public.notifications enable row level security;
revoke all on public.hostel_leave_policies,public.leave_requests,public.leave_request_documents,public.leave_request_history,public.notifications from anon,authenticated;
grant select on public.leave_requests,public.leave_request_documents,public.leave_request_history to authenticated;
grant select(id,recipient_user_id,leave_request_id,event_type,title,message,delivery_status,read_at,created_at) on public.notifications to authenticated;
grant update(read_at,delivery_status) on public.notifications to authenticated;
grant all on public.hostel_leave_policies,public.leave_requests,public.leave_request_documents,public.leave_request_history,public.notifications to service_role;
create policy leave_requests_read on public.leave_requests for select to authenticated using (private.leave_request_access(id));
create policy leave_documents_read on public.leave_request_documents for select to authenticated using (private.leave_request_access(leave_request_id));
create policy leave_history_read on public.leave_request_history for select to authenticated using (private.leave_request_access(leave_request_id));
create policy notifications_read_self on public.notifications for select to authenticated using (recipient_user_id=(select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated using (recipient_user_id=(select auth.uid())) with check (recipient_user_id=(select auth.uid()) and delivery_status in ('in_app_created','read','failed'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('leave-documents','leave-documents',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=5242880, allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp'];
create policy leave_documents_read on storage.objects for select to authenticated using (bucket_id='leave-documents' and private.leave_document_access(name,false));
create policy leave_documents_insert on storage.objects for insert to authenticated with check (bucket_id='leave-documents' and private.leave_document_access(name,true));
create policy leave_documents_delete on storage.objects for delete to authenticated using (bucket_id='leave-documents' and private.leave_document_access(name,true));

alter publication supabase_realtime add table public.leave_requests,public.notifications;
commit;
