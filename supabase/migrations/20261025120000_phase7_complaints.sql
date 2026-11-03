-- Phase 7 complaints and maintenance. Depends only on Phase 1/2.
begin;

create sequence private.complaint_number_seq;
revoke all on sequence private.complaint_number_seq from public,anon,authenticated;
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  complaint_number text not null unique default ('CMP-'||lpad(nextval('private.complaint_number_seq')::text,8,'0')),
  student_id uuid not null references public.students(id),
  submission_nonce uuid not null,
  title text not null check(length(trim(title)) between 4 and 120),
  category text not null check(category in ('plumbing','electrical','cleanliness','furniture','internet','security','other')),
  description text not null check(length(trim(description)) between 10 and 3000),
  location_detail text not null default '' check(length(location_detail)<=200),
  room_label text not null,
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  status text not null default 'submitted' check(status in ('submitted','acknowledged','in_progress','on_hold','resolved','closed')),
  assigned_staff_id uuid references public.profiles(id),
  resolution text check(resolution is null or length(trim(resolution)) between 5 and 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id,submission_nonce),
  check((status in ('resolved','closed') and resolved_at is not null and resolution is not null) or (status not in ('resolved','closed') and resolved_at is null))
);
create index complaints_student_created_idx on public.complaints(student_id,created_at desc);
create index complaints_queue_idx on public.complaints(status,priority,updated_at desc);
create index complaints_assignee_idx on public.complaints(assigned_staff_id,status,updated_at desc);

create table public.complaint_messages (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id),
  author_id uuid not null references public.profiles(id),
  author_type text not null check(author_type in ('student','staff')),
  visibility text not null check(visibility in ('student','internal')),
  message text not null check(length(trim(message)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index complaint_messages_thread_idx on public.complaint_messages(complaint_id,created_at);

create table public.complaint_events (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null check(event_type in ('submitted','status_changed','assigned','priority_changed','resolution_updated','message_added','maintenance_created','maintenance_updated')),
  visibility text not null check(visibility in ('student','internal')),
  old_value text,
  new_value text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index complaint_events_thread_idx on public.complaint_events(complaint_id,created_at);

create table public.complaint_attachments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id),
  message_id uuid references public.complaint_messages(id),
  uploaded_by uuid not null references public.profiles(id),
  object_path text not null unique,
  original_name text not null check(length(original_name) between 1 and 255),
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check(byte_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  check((content_type='image/jpeg' and object_path ~ '\.jpg$') or (content_type='image/png' and object_path ~ '\.png$') or (content_type='image/webp' and object_path ~ '\.webp$'))
);
create index complaint_attachments_thread_idx on public.complaint_attachments(complaint_id,created_at);

create table public.complaint_maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null unique references public.complaints(id),
  assigned_staff_id uuid references public.profiles(id),
  status text not null default 'open' check(status in ('open','scheduled','in_progress','completed','cancelled')),
  scheduled_visit_at timestamptz,
  work_notes text not null default '' check(length(work_notes)<=3000),
  estimated_cost numeric(14,3) check(estimated_cost is null or estimated_cost>=0),
  actual_cost numeric(14,3) check(actual_cost is null or actual_cost>=0),
  cost_currency_code text check(cost_currency_code is null or cost_currency_code ~ '^[A-Z]{3}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check((estimated_cost is null and actual_cost is null and cost_currency_code is null) or cost_currency_code is not null),
  check((status='completed' and completed_at is not null) or (status<>'completed' and completed_at is null))
);
create index complaint_maintenance_queue_idx on public.complaint_maintenance_tasks(status,scheduled_visit_at);

create table public.complaint_notifications (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints(id),
  recipient_user_id uuid not null references public.profiles(id),
  event_type text not null check(event_type in ('status_changed','staff_reply','assignment_update')),
  title text not null check(length(title)<=120),
  message text not null check(length(message)<=500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index complaint_notifications_recipient_idx on public.complaint_notifications(recipient_user_id,read_at,created_at desc);

create function private.current_complaint_student_id() returns uuid language sql stable security definer set search_path='' as $$
  select s.id from public.students s join public.profiles p on p.id=s.user_id
   where s.user_id=(select auth.uid()) and s.status='active' and p.role='student' and p.is_active limit 1;
$$;
revoke all on function private.current_complaint_student_id() from public,anon,authenticated;
grant execute on function private.current_complaint_student_id() to authenticated;

create function private.is_complaint_staff() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warden'));
$$;
revoke all on function private.is_complaint_staff() from public,anon,authenticated;
grant execute on function private.is_complaint_staff() to authenticated;

create function private.complaint_attachment_access(p_path text,p_write boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare target_id uuid; is_staff boolean;
begin
  if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' then return false; end if;
  target_id:=split_part(p_path,'/',1)::uuid;
  is_staff:=private.is_complaint_staff();
  if p_write and is_staff then return false; end if;
  return exists(select 1 from public.complaints c where c.id=target_id and ((not p_write and is_staff) or (c.student_id=private.current_complaint_student_id() and (not p_write or c.status<>'closed'))));
end; $$;
revoke all on function private.complaint_attachment_access(text,boolean) from public,anon,authenticated;
grant execute on function private.complaint_attachment_access(text,boolean) to authenticated;

create function private.complaint_attachment_delete(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select private.complaint_attachment_access(p_path,false) and not exists(select 1 from public.complaint_attachments a where a.object_path=p_path);
$$;
revoke all on function private.complaint_attachment_delete(text) from public,anon,authenticated;
grant execute on function private.complaint_attachment_delete(text) to authenticated;

create function public.complaint_submit(p_data jsonb,p_nonce uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; result public.complaints; room text;
begin
  sid:=private.current_complaint_student_id();
  if sid is null then raise exception 'Active student profile required' using errcode='42501'; end if;
  if p_nonce is null then raise exception 'Submission token required'; end if;
  select coalesce(h.name||' / '||h.block||' · room '||r.room_number||' · bed '||b.bed_number,'Not currently allocated') into room
    from public.students s left join public.bed_allocations a on a.student_id=s.id and a.status='active'
    left join public.beds b on b.id=a.bed_id left join public.rooms r on r.id=b.room_id left join public.hostels h on h.id=r.hostel_id where s.id=sid;
  insert into public.complaints(student_id,submission_nonce,title,category,description,location_detail,room_label)
  values(sid,p_nonce,trim(p_data->>'title'),p_data->>'category',trim(p_data->>'description'),trim(coalesce(p_data->>'location_detail','')),room)
  on conflict(student_id,submission_nonce) do nothing returning * into result;
  if result.id is null then select * into strict result from public.complaints where student_id=sid and submission_nonce=p_nonce; end if;
  if not exists(select 1 from public.complaint_events where complaint_id=result.id and event_type='submitted') then
    insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,new_value) values(result.id,auth.uid(),'submitted','student','submitted');
  end if;
  return jsonb_build_object('id',result.id,'complaint_number',result.complaint_number,'student_id',result.student_id,'status',result.status);
end; $$;
revoke all on function public.complaint_submit(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.complaint_submit(jsonb,uuid) to authenticated;

create function public.complaint_add_message(p_complaint_id uuid,p_message text,p_visibility text default 'student') returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; staff boolean; msg uuid;
begin
  actor:=auth.uid(); staff:=private.is_complaint_staff();
  if actor is null or (not staff and private.current_complaint_student_id() is null) then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.complaints c where c.id=p_complaint_id and (staff or (c.student_id=private.current_complaint_student_id() and c.status<>'closed'))) then raise exception 'Complaint not found or closed to replies' using errcode='42501'; end if;
  if not staff and p_visibility<>'student' then raise exception 'Students can only send student-visible messages' using errcode='42501'; end if;
  if p_visibility not in ('student','internal') then raise exception 'Invalid message visibility'; end if;
  insert into public.complaint_messages(complaint_id,author_id,author_type,visibility,message) values(p_complaint_id,actor,case when staff then 'staff' else 'student' end,p_visibility,trim(p_message)) returning id into msg;
  insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,new_value) values(p_complaint_id,actor,'message_added',p_visibility,case when p_visibility='student' then 'message' else 'internal note' end);
  if p_visibility='student' and staff then
    insert into public.complaint_notifications(complaint_id,recipient_user_id,event_type,title,message)
      select p_complaint_id,s.user_id,'staff_reply','New update on '||c.complaint_number,left(trim(p_message),500) from public.complaints c join public.students s on s.id=c.student_id where c.id=p_complaint_id;
  end if;
  update public.complaints set updated_at=now() where id=p_complaint_id;
  return msg;
end; $$;
revoke all on function public.complaint_add_message(uuid,text,text) from public,anon,authenticated;
grant execute on function public.complaint_add_message(uuid,text,text) to authenticated;

create function public.complaint_register_attachments(p_complaint_id uuid,p_message_id uuid,p_items jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; item jsonb; inserted integer:=0; existing integer;
begin
  actor:=auth.uid();
  if actor is null or private.is_complaint_staff() or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>3 then raise exception 'Attachment access denied or invalid attachment batch' using errcode='42501'; end if;
  perform 1 from public.complaints c where c.id=p_complaint_id and c.student_id=private.current_complaint_student_id() and c.status<>'closed' for update;
  if not found then raise exception 'Complaint is unavailable for attachments' using errcode='42501'; end if;
  if p_message_id is not null and not exists(select 1 from public.complaint_messages m where m.id=p_message_id and m.complaint_id=p_complaint_id and m.author_id=actor and m.visibility='student') then raise exception 'Attachment message does not belong to this student'; end if;
  select count(*) into existing from public.complaint_attachments where complaint_id=p_complaint_id;
  if existing+jsonb_array_length(p_items)>6 then raise exception 'Complaint attachment limit reached'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if not private.complaint_attachment_access(item->>'path',true) or split_part(item->>'path','/',1)<>p_complaint_id::text then raise exception 'Invalid attachment path' using errcode='42501'; end if;
    if item->>'type' not in ('image/jpeg','image/png','image/webp') or (item->>'size')::integer not between 1 and 5242880 then raise exception 'Unsupported image or file size'; end if;
    insert into public.complaint_attachments(complaint_id,message_id,uploaded_by,object_path,original_name,content_type,byte_size)
    values(p_complaint_id,p_message_id,actor,item->>'path',item->>'name',item->>'type',(item->>'size')::integer);
    inserted:=inserted+1;
  end loop;
  return inserted;
end; $$;
revoke all on function public.complaint_register_attachments(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complaint_register_attachments(uuid,uuid,jsonb) to authenticated;

create function public.complaint_assign(p_complaint_id uuid,p_staff_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; old_assignee uuid; complaint_no text; student_user uuid;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  actor:=auth.uid();
  if p_staff_id is not null and not exists(select 1 from public.profiles p where p.id=p_staff_id and p.is_active and p.role in ('admin','warden')) then raise exception 'Assignee must be an active administrator or warden'; end if;
  select assigned_staff_id,complaint_number into strict old_assignee,complaint_no from public.complaints where id=p_complaint_id for update;
  if old_assignee is not distinct from p_staff_id then return; end if;
  update public.complaints set assigned_staff_id=p_staff_id,updated_at=now() where id=p_complaint_id;
  insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,old_value,new_value) values(p_complaint_id,actor,'assigned','student',case when old_assignee is null then 'unassigned' else 'staff assigned' end,case when p_staff_id is null then 'staff assignment removed' else 'staff assigned' end);
  select s.user_id into student_user from public.complaints c join public.students s on s.id=c.student_id where c.id=p_complaint_id;
  insert into public.complaint_notifications(complaint_id,recipient_user_id,event_type,title,message) values(p_complaint_id,student_user,'assignment_update','Assignment update for '||complaint_no,case when p_staff_id is null then 'The staff assignment was removed.' else 'A hostel staff member has been assigned to your complaint.' end);
end; $$;
revoke all on function public.complaint_assign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complaint_assign(uuid,uuid) to authenticated;

create function public.complaint_transition(p_complaint_id uuid,p_status text,p_resolution text default null,p_priority text default null) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.complaints;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  actor:=auth.uid();
  if p_status not in ('submitted','acknowledged','in_progress','on_hold','resolved','closed') then raise exception 'Unsupported complaint status'; end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'Unsupported priority'; end if;
  select * into strict item from public.complaints where id=p_complaint_id for update;
  if item.status<>p_status and not (
    (item.status='submitted' and p_status='acknowledged') or
    (item.status='acknowledged' and p_status in ('in_progress','on_hold','resolved')) or
    (item.status='in_progress' and p_status in ('on_hold','resolved')) or
    (item.status='on_hold' and p_status in ('in_progress','resolved')) or
    (item.status='resolved' and p_status='closed')
  ) then raise exception 'Invalid complaint status transition'; end if;
  if p_status in ('resolved','closed') and length(trim(coalesce(p_resolution,item.resolution,'')))<5 then raise exception 'Resolution details are required'; end if;
  update public.complaints set status=p_status,priority=coalesce(p_priority,priority),resolution=case when p_status in ('resolved','closed') then coalesce(nullif(trim(p_resolution),''),resolution) else null end,resolved_at=case when p_status='resolved' then coalesce(resolved_at,now()) when p_status='closed' then coalesce(resolved_at,now()) else null end,updated_at=now() where id=p_complaint_id;
  if item.status<>p_status then
    insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,old_value,new_value) values(p_complaint_id,actor,'status_changed','student',item.status,p_status);
    insert into public.complaint_notifications(complaint_id,recipient_user_id,event_type,title,message)
      select p_complaint_id,s.user_id,'status_changed','Complaint '||item.complaint_number||' updated','Your complaint status is now '||replace(p_status,'_',' ')||'.' from public.students s where s.id=item.student_id;
  end if;
  if p_priority is not null and p_priority<>item.priority then insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,old_value,new_value) values(p_complaint_id,actor,'priority_changed','internal',item.priority,p_priority); end if;
  if p_resolution is not null and p_resolution is distinct from item.resolution then insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,old_value,new_value) values(p_complaint_id,actor,'resolution_updated','student',null,'resolution updated'); end if;
end; $$;
revoke all on function public.complaint_transition(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complaint_transition(uuid,text,text,text) to authenticated;

create function public.complaint_create_maintenance(p_complaint_id uuid,p_staff_id uuid,p_visit timestamptz,p_estimated_cost numeric default null,p_currency text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result_id uuid;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  actor:=auth.uid();
  if p_staff_id is not null and not exists(select 1 from public.profiles where id=p_staff_id and is_active and role in ('admin','warden')) then raise exception 'Technician must be an active administrator or warden'; end if;
  if p_estimated_cost is not null and (p_estimated_cost<0 or p_currency !~ '^[A-Z]{3}$') then raise exception 'Cost requires a non-negative amount and explicit currency code'; end if;
  insert into public.complaint_maintenance_tasks(complaint_id,assigned_staff_id,scheduled_visit_at,estimated_cost,cost_currency_code,created_by)
    values(p_complaint_id,p_staff_id,p_visit,p_estimated_cost,p_currency,actor) on conflict(complaint_id) do nothing returning id into result_id;
  if result_id is null then select id into strict result_id from public.complaint_maintenance_tasks where complaint_id=p_complaint_id; return result_id; end if;
  insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,new_value) values(p_complaint_id,actor,'maintenance_created','internal',result_id::text);
  return result_id;
end; $$;
revoke all on function public.complaint_create_maintenance(uuid,uuid,timestamptz,numeric,text) from public,anon,authenticated;
grant execute on function public.complaint_create_maintenance(uuid,uuid,timestamptz,numeric,text) to authenticated;

create function public.complaint_update_maintenance(p_task_id uuid,p_status text,p_staff_id uuid,p_visit timestamptz,p_notes text,p_actual_cost numeric,p_currency text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.complaint_maintenance_tasks;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  actor:=auth.uid();
  if p_status not in ('open','scheduled','in_progress','completed','cancelled') then raise exception 'Unsupported maintenance status'; end if;
  if p_staff_id is not null and not exists(select 1 from public.profiles where id=p_staff_id and is_active and role in ('admin','warden')) then raise exception 'Technician must be an active administrator or warden'; end if;
  if p_actual_cost is not null and (p_actual_cost<0 or p_currency !~ '^[A-Z]{3}$') then raise exception 'Cost requires a non-negative amount and explicit currency code'; end if;
  select * into strict item from public.complaint_maintenance_tasks where id=p_task_id for update;
  if item.status<>p_status and not ((item.status='open' and p_status in ('scheduled','in_progress','cancelled')) or (item.status='scheduled' and p_status in ('in_progress','completed','cancelled')) or (item.status='in_progress' and p_status in ('scheduled','completed','cancelled'))) then raise exception 'Invalid maintenance status transition'; end if;
  update public.complaint_maintenance_tasks set status=p_status,assigned_staff_id=p_staff_id,scheduled_visit_at=p_visit,work_notes=coalesce(p_notes,''),actual_cost=p_actual_cost,cost_currency_code=case when p_actual_cost is not null then p_currency else cost_currency_code end,completed_at=case when p_status='completed' then coalesce(completed_at,now()) else null end,updated_at=now() where id=p_task_id;
  insert into public.complaint_events(complaint_id,actor_id,event_type,visibility,old_value,new_value,details) values(item.complaint_id,actor,'maintenance_updated','internal',item.status,p_status,jsonb_build_object('task_id',p_task_id));
end; $$;
revoke all on function public.complaint_update_maintenance(uuid,text,uuid,timestamptz,text,numeric,text) from public,anon,authenticated;
grant execute on function public.complaint_update_maintenance(uuid,text,uuid,timestamptz,text,numeric,text) to authenticated;

create function public.complaint_staff_list(p_search text default '',p_status text default '',p_category text default '',p_priority text default '',p_page integer default 0,p_page_size integer default 20,p_sort text default 'updated_at',p_ascending boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer; page_no integer:=greatest(0,least(coalesce(p_page,0),10000)); size_no integer:=greatest(1,least(coalesce(p_page_size,20),100)); sort_col text;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  sort_col:=case when p_sort in ('created_at','updated_at','status','priority','complaint_number') then p_sort else 'updated_at' end;
  with filtered as (
    select c.id,c.complaint_number,c.student_id,c.title,c.category,c.priority,c.status,c.room_label,c.assigned_staff_id,c.created_at,c.updated_at,c.resolved_at,
      s.full_name student_name,s.student_id registration_id,sr.id registration_record_id,
      assigned.full_name assigned_staff_name
    from public.complaints c join public.students s on s.id=c.student_id
    left join public.student_registrations sr on sr.student_id=s.id
    left join public.profiles assigned on assigned.id=c.assigned_staff_id
    where (coalesce(p_status,'')='' or c.status=p_status) and (coalesce(p_category,'')='' or c.category=p_category) and (coalesce(p_priority,'')='' or c.priority=p_priority)
      and (coalesce(trim(p_search),'')='' or c.complaint_number ilike '%'||trim(p_search)||'%' or s.full_name ilike '%'||trim(p_search)||'%' or s.student_id ilike '%'||trim(p_search)||'%' or c.title ilike '%'||trim(p_search)||'%' or c.room_label ilike '%'||trim(p_search)||'%')
  ), counted as (select count(*)::integer n from filtered), page_rows as (
    select * from filtered order by
      case when sort_col='created_at' and p_ascending then created_at end asc,
      case when sort_col='created_at' and not p_ascending then created_at end desc,
      case when sort_col='updated_at' and p_ascending then updated_at end asc,
      case when sort_col='updated_at' and not p_ascending then updated_at end desc,
      case when sort_col='status' and p_ascending then status end asc,
      case when sort_col='status' and not p_ascending then status end desc,
      case when sort_col='priority' and p_ascending then priority end asc,
      case when sort_col='priority' and not p_ascending then priority end desc,
      case when sort_col='complaint_number' and p_ascending then complaint_number end asc,
      case when sort_col='complaint_number' and not p_ascending then complaint_number end desc
      limit size_no offset page_no*size_no
  )
  select (select n from counted),coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows) ,'[]'::jsonb) into total,result;
  return jsonb_build_object('rows',result,'count',total,'page',page_no,'page_size',size_no,
    'summary',(select jsonb_build_object('submitted',count(*) filter(where status='submitted'),'acknowledged',count(*) filter(where status='acknowledged'),'in_progress',count(*) filter(where status='in_progress'),'on_hold',count(*) filter(where status='on_hold'),'resolved',count(*) filter(where status='resolved'),'closed',count(*) filter(where status='closed')) from public.complaints));
end; $$;
revoke all on function public.complaint_staff_list(text,text,text,text,integer,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.complaint_staff_list(text,text,text,text,integer,integer,text,boolean) to authenticated;

create function public.complaint_staff_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  select to_jsonb(c)||jsonb_build_object('student',jsonb_build_object('full_name',s.full_name,'student_number',s.student_id,'email',s.email,'phone',s.phone,'registration_id',sr.id,'room_label',c.room_label),'assigned_staff',case when p.id is null then null else jsonb_build_object('id',p.id,'name',p.full_name,'role',p.role) end,
    'messages',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('author_role',ap.role) order by m.created_at) from public.complaint_messages m join public.profiles ap on ap.id=m.author_id where m.complaint_id=c.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.complaint_events e where e.complaint_id=c.id),'[]'::jsonb),
    'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.complaint_attachments a where a.complaint_id=c.id),'[]'::jsonb),
    'maintenance', (select to_jsonb(t) from public.complaint_maintenance_tasks t where t.complaint_id=c.id)) into result
  from public.complaints c join public.students s on s.id=c.student_id left join public.student_registrations sr on sr.student_id=s.id left join public.profiles p on p.id=c.assigned_staff_id where c.id=p_id;
  if result is null then raise exception 'Complaint not found'; end if;
  return result;
end; $$;
revoke all on function public.complaint_staff_detail(uuid) from public,anon,authenticated;
grant execute on function public.complaint_staff_detail(uuid) to authenticated;

create function public.complaint_staff_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_complaint_staff() then raise exception 'Authorized staff access required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role) order by full_name) from public.profiles where is_active and role in ('admin','warden')),'[]'::jsonb);
end; $$;
revoke all on function public.complaint_staff_directory() from public,anon,authenticated;
grant execute on function public.complaint_staff_directory() to authenticated;

alter table public.complaints enable row level security;
alter table public.complaint_messages enable row level security;
alter table public.complaint_events enable row level security;
alter table public.complaint_attachments enable row level security;
alter table public.complaint_maintenance_tasks enable row level security;
alter table public.complaint_notifications enable row level security;
revoke all on public.complaints,public.complaint_messages,public.complaint_events,public.complaint_attachments,public.complaint_maintenance_tasks,public.complaint_notifications from anon,authenticated;
grant select(id,complaint_number,student_id,title,category,description,location_detail,room_label,priority,status,resolution,resolved_at,created_at,updated_at) on public.complaints to authenticated;
grant select(id,complaint_id,author_type,visibility,message,created_at) on public.complaint_messages to authenticated;
grant select(id,complaint_id,event_type,visibility,old_value,new_value,created_at) on public.complaint_events to authenticated;
grant select(id,complaint_id,message_id,object_path,original_name,content_type,byte_size,created_at) on public.complaint_attachments to authenticated;
grant select on public.complaint_notifications to authenticated;
grant update(read_at) on public.complaint_notifications to authenticated;
grant all on public.complaints,public.complaint_messages,public.complaint_events,public.complaint_attachments,public.complaint_maintenance_tasks,public.complaint_notifications to service_role;
create policy complaints_student_read on public.complaints for select to authenticated using (student_id=private.current_complaint_student_id());
create policy complaint_messages_student_read on public.complaint_messages for select to authenticated using (visibility='student' and exists(select 1 from public.complaints c where c.id=complaint_id and c.student_id=private.current_complaint_student_id()));
create policy complaint_events_student_read on public.complaint_events for select to authenticated using (visibility='student' and exists(select 1 from public.complaints c where c.id=complaint_id and c.student_id=private.current_complaint_student_id()));
create policy complaint_attachments_student_read on public.complaint_attachments for select to authenticated using (exists(select 1 from public.complaints c where c.id=complaint_id and c.student_id=private.current_complaint_student_id()));
create policy complaint_notifications_self_read on public.complaint_notifications for select to authenticated using (recipient_user_id=(select auth.uid()));
create policy complaint_notifications_self_update on public.complaint_notifications for update to authenticated using (recipient_user_id=(select auth.uid())) with check (recipient_user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('complaint-attachments','complaint-attachments',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy complaint_attachments_storage_read on storage.objects for select to authenticated using(bucket_id='complaint-attachments' and private.complaint_attachment_access(name,false));
create policy complaint_attachments_storage_insert on storage.objects for insert to authenticated with check(bucket_id='complaint-attachments' and private.complaint_attachment_access(name,true));
create policy complaint_attachments_storage_delete_unregistered on storage.objects for delete to authenticated using(bucket_id='complaint-attachments' and private.complaint_attachment_delete(name));

commit;
