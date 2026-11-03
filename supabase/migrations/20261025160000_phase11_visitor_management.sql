-- Phase 11: visitor registration, approval, and audited gate entry/exit.
begin;

do $$ begin
  if to_regclass('public.students') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.gate_events') is null
     or to_regprocedure('private.is_active_security()') is null
     or to_regprocedure('private.current_student_id()') is null then
    raise exception 'Phase 11 visitors require Phase 1 profiles, Phase 2 students, Phase 3 student identity, and Phase 4 gate authorization';
  end if;
end $$;

create function private.is_active_visitor_staff() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warden','security'));
$$;
revoke all on function private.is_active_visitor_staff() from public,anon,authenticated;
grant execute on function private.is_active_visitor_staff() to authenticated;

create function private.is_active_visitor_manager() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warden'));
$$;
revoke all on function private.is_active_visitor_manager() from public,anon,authenticated;
grant execute on function private.is_active_visitor_manager() to authenticated;

create table public.visitor_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_full_name text not null check(length(trim(visitor_full_name)) between 2 and 120),
  visitor_contact text check(visitor_contact is null or visitor_contact ~ '^\+?[0-9 ()-]{7,20}$'),
  student_id uuid not null references public.students(id) on delete restrict,
  visit_purpose text not null check(length(trim(visit_purpose)) between 3 and 500),
  scheduled_entry_at timestamptz not null,
  scheduled_exit_at timestamptz not null,
  visitor_count integer not null default 1 check(visitor_count>0),
  status text not null default 'pending' check(status in ('pending','approved','rejected','checked_in','checked_out')),
  approval_status text not null default 'pending' check(approval_status in ('pending','approved','rejected')),
  identity_verified_at timestamptz,
  identity_verified_by uuid references public.profiles(id),
  entered_at timestamptz,
  checked_in_by uuid references public.profiles(id),
  exited_at timestamptz,
  checked_out_by uuid references public.profiles(id),
  overdue_reviewed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(scheduled_exit_at>scheduled_entry_at),
  check((identity_verified_at is null)=(identity_verified_by is null)),
  check((entered_at is null)=(checked_in_by is null)),
  check((exited_at is null)=(checked_out_by is null)),
  check(exited_at is null or entered_at is not null)
);
create index visitor_visits_student_created_idx on public.visitor_visits(student_id,created_at desc);
create index visitor_visits_status_scheduled_idx on public.visitor_visits(status,scheduled_entry_at);
create index visitor_visits_created_idx on public.visitor_visits(created_at desc);
create trigger visitor_visits_updated before update on public.visitor_visits
for each row execute function private.set_updated_at();

create table public.visitor_events (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.visitor_visits(id) on delete restrict,
  event_type text not null check(event_type in ('registered','identity_verified','approved','rejected','checked_in','checked_out','overdue_reviewed')),
  actor_id uuid not null references public.profiles(id),
  visibility text not null check(visibility in ('student','staff')),
  created_at timestamptz not null default now(),
  note text check(note is null or length(note)<=500)
);
create index visitor_events_visit_created_idx on public.visitor_events(visit_id,created_at desc);

alter table public.visitor_visits enable row level security;
alter table public.visitor_events enable row level security;
revoke all on public.visitor_visits,public.visitor_events from anon,authenticated;
grant all on public.visitor_visits,public.visitor_events to service_role;

create function public.visitor_student_search(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_active_security() then
    raise exception 'Active security or administrator access required' using errcode='42501';
  end if;
  if length(trim(coalesce(p_term,'')))<2 or length(p_term)>100 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(matches)),'[]'::jsonb) into result from (
    select s.id,s.full_name,s.student_id as registration_id
    from public.students s join public.profiles p on p.id=s.user_id
    where s.status='active' and p.is_active and p.role='student'
      and (s.full_name ilike '%'||trim(p_term)||'%' or s.student_id ilike '%'||trim(p_term)||'%')
    order by s.full_name limit 20
  ) matches;
  return result;
end; $$;
revoke all on function public.visitor_student_search(text) from public,anon,authenticated;
grant execute on function public.visitor_student_search(text) to authenticated;

create function public.visitor_register(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; visit public.visitor_visits;
begin
  if auth.uid() is null or not private.is_active_security() then
    raise exception 'Active security or administrator access required' using errcode='42501';
  end if;
  sid:=(p_data->>'student_id')::uuid;
  if not exists(select 1 from public.students s join public.profiles p on p.id=s.user_id where s.id=sid and s.status='active' and p.role='student' and p.is_active) then
    raise exception 'Active student record not found';
  end if;
  if (p_data->>'scheduled_exit_at')::timestamptz <= (p_data->>'scheduled_entry_at')::timestamptz then raise exception 'Visit end must be after visit start'; end if;
  insert into public.visitor_visits(visitor_full_name,visitor_contact,student_id,visit_purpose,scheduled_entry_at,scheduled_exit_at,visitor_count,created_by)
  values(trim(p_data->>'visitor_full_name'),nullif(trim(p_data->>'visitor_contact'),''),sid,trim(p_data->>'visit_purpose'),(p_data->>'scheduled_entry_at')::timestamptz,(p_data->>'scheduled_exit_at')::timestamptz,coalesce((p_data->>'visitor_count')::integer,1),auth.uid()) returning * into visit;
  insert into public.visitor_events(visit_id,event_type,actor_id,visibility) values(visit.id,'registered',auth.uid(),'student');
  return jsonb_build_object('id',visit.id,'status',visit.status,'approval_status',visit.approval_status,'created_at',visit.created_at);
end; $$;
revoke all on function public.visitor_register(jsonb) from public,anon,authenticated;
grant execute on function public.visitor_register(jsonb) to authenticated;

create function public.visitor_verify_identity(p_visit_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare visit public.visitor_visits;
begin
  if auth.uid() is null or not private.is_active_security() then raise exception 'Active security or administrator access required' using errcode='42501'; end if;
  select * into visit from public.visitor_visits where id=p_visit_id for update;
  if not found or visit.status in ('rejected','checked_out') then raise exception 'Visit is unavailable for ID verification'; end if;
  if visit.identity_verified_at is null then
    update public.visitor_visits set identity_verified_at=now(),identity_verified_by=auth.uid() where id=p_visit_id returning * into visit;
    insert into public.visitor_events(visit_id,event_type,actor_id,visibility) values(p_visit_id,'identity_verified',auth.uid(),'student');
  end if;
  return jsonb_build_object('id',visit.id,'identity_verified_at',visit.identity_verified_at);
end; $$;
revoke all on function public.visitor_verify_identity(uuid) from public,anon,authenticated;
grant execute on function public.visitor_verify_identity(uuid) to authenticated;

create function public.visitor_decide(p_visit_id uuid,p_decision text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare visit public.visitor_visits; new_status text;
begin
  if auth.uid() is null or not private.is_active_visitor_manager() then raise exception 'Active administrator or warden access required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_decision='rejected' and length(trim(coalesce(p_reason,'')))<3 then raise exception 'Provide a rejection reason'; end if;
  select * into visit from public.visitor_visits where id=p_visit_id for update;
  if not found or visit.status<>'pending' then raise exception 'Only pending visits can be reviewed'; end if;
  new_status:=p_decision;
  update public.visitor_visits set status=new_status,approval_status=new_status where id=p_visit_id returning * into visit;
  insert into public.visitor_events(visit_id,event_type,actor_id,visibility,note) values(p_visit_id,p_decision,auth.uid(),'student',case when p_decision='rejected' then left(trim(p_reason),500) else null end);
  return jsonb_build_object('id',visit.id,'status',visit.status,'approval_status',visit.approval_status);
end; $$;
revoke all on function public.visitor_decide(uuid,text,text) from public,anon,authenticated;
grant execute on function public.visitor_decide(uuid,text,text) to authenticated;

create function public.visitor_check_in(p_visit_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare visit public.visitor_visits;
begin
  if auth.uid() is null or not private.is_active_security() then raise exception 'Active security or administrator access required' using errcode='42501'; end if;
  select * into visit from public.visitor_visits where id=p_visit_id for update;
  if not found or visit.status<>'approved' or visit.approval_status<>'approved' then raise exception 'Visit is not approved or already checked in'; end if;
  if visit.identity_verified_at is null then raise exception 'Verify the visitor identity at the desk before check-in'; end if;
  if now()<visit.scheduled_entry_at or now()>visit.scheduled_exit_at then raise exception 'Current time is outside the scheduled visit window'; end if;
  update public.visitor_visits set status='checked_in',entered_at=now(),checked_in_by=auth.uid() where id=p_visit_id returning * into visit;
  insert into public.visitor_events(visit_id,event_type,actor_id,visibility) values(p_visit_id,'checked_in',auth.uid(),'student');
  return jsonb_build_object('id',visit.id,'status',visit.status,'entered_at',visit.entered_at);
end; $$;
revoke all on function public.visitor_check_in(uuid) from public,anon,authenticated;
grant execute on function public.visitor_check_in(uuid) to authenticated;

create function public.visitor_check_out(p_visit_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare visit public.visitor_visits;
begin
  if auth.uid() is null or not private.is_active_security() then raise exception 'Active security or administrator access required' using errcode='42501'; end if;
  select * into visit from public.visitor_visits where id=p_visit_id for update;
  if not found or visit.status<>'checked_in' then raise exception 'Only a checked-in visitor can be checked out'; end if;
  update public.visitor_visits set status='checked_out',exited_at=now(),checked_out_by=auth.uid() where id=p_visit_id returning * into visit;
  insert into public.visitor_events(visit_id,event_type,actor_id,visibility) values(p_visit_id,'checked_out',auth.uid(),'student');
  return jsonb_build_object('id',visit.id,'status',visit.status,'exited_at',visit.exited_at);
end; $$;
revoke all on function public.visitor_check_out(uuid) from public,anon,authenticated;
grant execute on function public.visitor_check_out(uuid) to authenticated;

create function public.visitor_mark_overdue_reviewed(p_visit_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare visit public.visitor_visits;
begin
  if auth.uid() is null or not private.is_active_visitor_manager() then raise exception 'Active administrator or warden access required' using errcode='42501'; end if;
  select * into visit from public.visitor_visits where id=p_visit_id for update;
  if not found or visit.status<>'checked_in' or visit.scheduled_exit_at>=now() then raise exception 'Visit is not overdue'; end if;
  if visit.overdue_reviewed_at is null then
    update public.visitor_visits set overdue_reviewed_at=now() where id=p_visit_id;
    insert into public.visitor_events(visit_id,event_type,actor_id,visibility) values(p_visit_id,'overdue_reviewed',auth.uid(),'staff');
  end if;
end; $$;
revoke all on function public.visitor_mark_overdue_reviewed(uuid) from public,anon,authenticated;
grant execute on function public.visitor_mark_overdue_reviewed(uuid) to authenticated;

create function public.visitor_list(
  p_search text default '',p_from date default null,p_to date default null,
  p_status text default '',p_approval text default '',p_page integer default 0,p_page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer; staff boolean; sid uuid; term text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  staff:=private.is_active_visitor_staff(); sid:=private.current_student_id();
  if not staff and sid is null then raise exception 'Visitor record access denied' using errcode='42501'; end if;
  if p_page<0 or p_page_size not between 1 and 50 then raise exception 'Invalid page'; end if;
  if p_from is not null and p_to is not null and p_from>p_to then raise exception 'Invalid date range'; end if;
  if p_status<>'' and p_status not in ('pending','approved','rejected','checked_in','checked_out') then raise exception 'Invalid visitor status'; end if;
  if p_approval<>'' and p_approval not in ('pending','approved','rejected') then raise exception 'Invalid approval status'; end if;
  term:=left(trim(coalesce(p_search,'')),100);
  select count(*) into total from public.visitor_visits v join public.students s on s.id=v.student_id
  where (staff or v.student_id=sid)
    and (p_from is null or v.scheduled_entry_at::date>=p_from)
    and (p_to is null or v.scheduled_entry_at::date<=p_to)
    and (p_status='' or v.status=p_status)
    and (p_approval='' or v.approval_status=p_approval)
    and (term='' or v.visitor_full_name ilike '%'||term||'%' or s.full_name ilike '%'||term||'%' or s.student_id ilike '%'||term||'%');
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select v.id,v.visitor_full_name,case when staff then v.visitor_contact else null end as visitor_contact,
      v.student_id,s.full_name as student_name,s.student_id as registration_id,
      v.visit_purpose,v.scheduled_entry_at,v.scheduled_exit_at,v.visitor_count,v.status,v.approval_status,
      (v.identity_verified_at is not null) as government_id_verified,
      v.entered_at,v.exited_at,v.overdue_reviewed_at,
      (v.status='checked_in' and v.scheduled_exit_at<now()) as is_overdue,
      case when staff then (select p.full_name from public.profiles p where p.id=v.checked_in_by) else null end as checked_in_by_name,
      case when staff then (select p.full_name from public.profiles p where p.id=v.checked_out_by) else null end as checked_out_by_name,
      coalesce((select jsonb_agg(jsonb_build_object('event_type',e.event_type,'created_at',e.created_at,'actor_name',case when staff then (select p.full_name from public.profiles p where p.id=e.actor_id) else null end,'staff_note',case when staff then e.note else null end) order by e.created_at)
        from public.visitor_events e where e.visit_id=v.id and (staff or e.visibility='student')),'[]'::jsonb) as events
    from public.visitor_visits v join public.students s on s.id=v.student_id
    where (staff or v.student_id=sid)
      and (p_from is null or v.scheduled_entry_at::date>=p_from)
      and (p_to is null or v.scheduled_entry_at::date<=p_to)
      and (p_status='' or v.status=p_status)
      and (p_approval='' or v.approval_status=p_approval)
      and (term='' or v.visitor_full_name ilike '%'||term||'%' or s.full_name ilike '%'||term||'%' or s.student_id ilike '%'||term||'%')
    order by v.scheduled_entry_at desc offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.visitor_list(text,date,date,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.visitor_list(text,date,date,text,text,integer,integer) to authenticated;

commit;
