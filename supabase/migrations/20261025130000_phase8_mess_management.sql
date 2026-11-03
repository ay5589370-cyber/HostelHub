-- Phase 8 menus, feedback and mess notices. Requires Phase 1/2 and Phase 7 complaints.
begin;

do $$ begin
  if to_regclass('public.profiles') is null or to_regclass('public.students') is null
     or to_regclass('public.complaints') is null or to_regprocedure('private.is_active_admin()') is null
     or to_regprocedure('public.complaint_submit(jsonb,uuid)') is null then
    raise exception 'Phase 8 requires the approved Phase 1, Phase 2 and Phase 7 complaint schema';
  end if;
end $$;

alter table public.complaints drop constraint if exists complaints_category_check;
alter table public.complaints add constraint complaints_category_check check(category in (
  'plumbing','electrical','cleanliness','furniture','internet','security','other',
  'mess_food_quality','mess_hygiene','mess_menu_mismatch','mess_meal_timing','mess_service_issue','mess_other'
));

create table public.mess_menus (
  id uuid primary key default gen_random_uuid(),
  meal_date date not null,
  meal_slot text not null check(meal_slot in ('breakfast','lunch','evening_snacks','dinner')),
  title text not null check(length(trim(title)) between 2 and 120),
  description text not null default '' check(length(description)<=1000),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 30),
  serving_start time not null,
  serving_end time not null,
  status text not null default 'draft' check(status in ('draft','published','cancelled','archived')),
  announcement text not null default '' check(length(announcement)<=500),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique(meal_date,meal_slot),
  check(serving_end>serving_start),
  check(status<>'cancelled' or length(trim(announcement))>=5)
);
create index mess_menus_date_status_idx on public.mess_menus(meal_date,status,meal_slot);

create table public.mess_feedback_policy (
  singleton boolean primary key default true check(singleton),
  edit_window_hours integer not null default 0 check(edit_window_hours between 0 and 168),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.mess_feedback_policy(singleton,edit_window_hours) values(true,0);

create table public.mess_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  menu_id uuid not null references public.mess_menus(id),
  meal_date date not null,
  meal_slot text not null check(meal_slot in ('breakfast','lunch','evening_snacks','dinner')),
  rating smallint not null check(rating between 1 and 5),
  category text check(category is null or category in ('taste','quality','hygiene','variety','serving')),
  comments text not null default '' check(length(comments)<=1000),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id,meal_date,meal_slot)
);
create index mess_feedback_date_slot_idx on public.mess_feedback(meal_date,meal_slot,submitted_at desc);
create index mess_feedback_student_idx on public.mess_feedback(student_id,meal_date desc);

create table public.mess_notifications (
  id bigint generated always as identity primary key,
  menu_id uuid not null references public.mess_menus(id),
  recipient_user_id uuid not null references public.profiles(id),
  event_type text not null check(event_type in ('menu_published','menu_changed','meal_cancelled')),
  title text not null check(length(title)<=120),
  message text not null check(length(message)<=500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index mess_notifications_recipient_idx on public.mess_notifications(recipient_user_id,read_at,created_at desc);

create table public.mess_events (
  id bigint generated always as identity primary key,
  menu_id uuid references public.mess_menus(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null check(event_type in ('menu_created','menu_updated','menu_published','menu_changed','meal_cancelled','menu_archived','feedback_policy_updated')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index mess_events_menu_idx on public.mess_events(menu_id,created_at desc);

create function private.current_mess_student_id() returns uuid language sql stable security definer set search_path='' as $$
  select s.id from public.students s join public.profiles p on p.id=s.user_id
  where s.user_id=(select auth.uid()) and s.status='active' and p.role='student' and p.is_active limit 1;
$$;
revoke all on function private.current_mess_student_id() from public,anon,authenticated;
grant execute on function private.current_mess_student_id() to authenticated;

create function private.require_mess_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_active_admin() then raise exception 'Active administrator access required' using errcode='42501'; end if;
  return auth.uid();
end; $$;
revoke all on function private.require_mess_admin() from public,anon,authenticated;
grant execute on function private.require_mess_admin() to authenticated;

create function private.notify_mess_students(p_menu_id uuid,p_event text,p_title text,p_message text) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  insert into public.mess_notifications(menu_id,recipient_user_id,event_type,title,message)
  select p_menu_id,p.id,p_event,p_title,left(p_message,500) from public.profiles p join public.students s on s.user_id=p.id and s.status='active' where p.role='student' and p.is_active;
  get diagnostics affected=row_count;
  return affected;
end; $$;
revoke all on function private.notify_mess_students(uuid,text,text,text) from public,anon,authenticated;

create function public.mess_save_menu(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; menu_id uuid; old_row public.mess_menus; new_row public.mess_menus; item jsonb; changed boolean;
begin
  actor:=private.require_mess_admin();
  if p_data->>'meal_slot' not in ('breakfast','lunch','evening_snacks','dinner') then raise exception 'Invalid meal slot'; end if;
  if (p_data->>'meal_date')::date<current_date then raise exception 'Menus cannot be created or edited for a past date'; end if;
  if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 30 then raise exception 'Add between 1 and 30 menu items'; end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
    if jsonb_typeof(item)<>'object' or length(trim(coalesce(item->>'name','')))<1 or length(trim(item->>'name'))>100 or length(coalesce(item->>'description',''))>300 or (item ? 'allergens' and (jsonb_typeof(item->'allergens')<>'array' or jsonb_array_length(item->'allergens')>20)) then raise exception 'Invalid menu item or allergen list'; end if;
    if item ? 'allergens' and exists(select 1 from jsonb_array_elements_text(item->'allergens') x where length(trim(x))<1 or length(x)>50) then raise exception 'Allergen labels must be 1 to 50 characters'; end if;
  end loop;
  select * into old_row from public.mess_menus where meal_date=(p_data->>'meal_date')::date and meal_slot=p_data->>'meal_slot' for update;
  if found then
    if old_row.status='archived' then raise exception 'Archived menus cannot be edited'; end if;
    changed:=old_row.title is distinct from trim(p_data->>'title') or old_row.description is distinct from coalesce(trim(p_data->>'description'),'') or old_row.items is distinct from p_data->'items' or old_row.serving_start is distinct from (p_data->>'serving_start')::time or old_row.serving_end is distinct from (p_data->>'serving_end')::time;
    update public.mess_menus set title=trim(p_data->>'title'),description=coalesce(trim(p_data->>'description'),''),items=p_data->'items',serving_start=(p_data->>'serving_start')::time,serving_end=(p_data->>'serving_end')::time,updated_by=actor,updated_at=now()
      where id=old_row.id returning * into new_row;
    menu_id:=new_row.id;
    insert into public.mess_events(menu_id,actor_id,event_type,details) values(menu_id,actor,'menu_updated',jsonb_build_object('previous_status',old_row.status,'updated_while_published',old_row.status='published','changed',changed));
    if changed and old_row.status='published' then perform private.notify_mess_students(menu_id,'menu_changed','Menu updated: '||new_row.title,'The '||replace(new_row.meal_slot,'_',' ')||' menu for '||new_row.meal_date::text||' has changed.'); end if;
  else
    insert into public.mess_menus(meal_date,meal_slot,title,description,items,serving_start,serving_end,created_by,updated_by)
      values((p_data->>'meal_date')::date,p_data->>'meal_slot',trim(p_data->>'title'),coalesce(trim(p_data->>'description'),''),p_data->'items',(p_data->>'serving_start')::time,(p_data->>'serving_end')::time,actor,actor) returning * into new_row;
    menu_id:=new_row.id;
    insert into public.mess_events(menu_id,actor_id,event_type,details) values(menu_id,actor,'menu_created',jsonb_build_object('date',new_row.meal_date,'meal_slot',new_row.meal_slot));
  end if;
  return menu_id;
end; $$;
revoke all on function public.mess_save_menu(jsonb) from public,anon,authenticated;
grant execute on function public.mess_save_menu(jsonb) to authenticated;

create function public.mess_set_menu_status(p_menu_id uuid,p_status text,p_announcement text default '') returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.mess_menus; ev text; notice_type text; title_text text; msg text;
begin
  actor:=private.require_mess_admin();
  if p_status not in ('published','cancelled','archived') then raise exception 'Invalid menu status'; end if;
  select * into strict item from public.mess_menus where id=p_menu_id for update;
  if item.status='archived' then raise exception 'Archived menus are final'; end if;
  if p_status='published' and (item.meal_date<current_date or jsonb_array_length(item.items)<1) then raise exception 'A past or empty menu cannot be published'; end if;
  if p_status='cancelled' and length(trim(coalesce(p_announcement,'')))<5 then raise exception 'Provide a cancellation announcement'; end if;
  if item.status<>p_status and not ((item.status='draft' and p_status in ('published','cancelled','archived')) or (item.status='published' and p_status in ('published','cancelled','archived')) or (item.status='cancelled' and p_status in ('published','cancelled','archived'))) then raise exception 'Invalid menu status transition'; end if;
  update public.mess_menus set status=p_status,announcement=case when p_status='published' then coalesce(nullif(trim(p_announcement),''),'') when p_status='cancelled' then trim(p_announcement) else announcement end,published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end,updated_by=actor,updated_at=now() where id=p_menu_id;
  if p_status='archived' then ev:='menu_archived';
  elsif p_status='cancelled' then ev:='meal_cancelled';
  elsif item.status='published' then ev:='menu_changed';
  else ev:='menu_published'; end if;
  if item.status<>p_status or (p_status in ('published','cancelled') and item.announcement is distinct from coalesce(trim(p_announcement),'')) then
    insert into public.mess_events(menu_id,actor_id,event_type,details) values(p_menu_id,actor,ev,jsonb_build_object('from',item.status,'to',p_status,'announcement',case when p_status in ('published','cancelled') then trim(coalesce(p_announcement,'')) else null end));
  end if;
  if p_status in ('published','cancelled') and (item.status<>p_status or item.announcement is distinct from trim(coalesce(p_announcement,''))) then
    notice_type:=case when p_status='cancelled' then 'meal_cancelled' when item.status='published' then 'menu_changed' else 'menu_published' end;
    title_text:=case when p_status='cancelled' then 'Meal cancelled: '||item.title when item.status='published' then 'Menu changed: '||item.title else 'Menu published: '||item.title end;
    msg:=case when p_status='cancelled' then trim(p_announcement) else coalesce(nullif(trim(p_announcement),''),'Menu details are available in the HostelHub mess portal.') end;
    perform private.notify_mess_students(p_menu_id,notice_type,title_text,msg);
  end if;
end; $$;
revoke all on function public.mess_set_menu_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mess_set_menu_status(uuid,text,text) to authenticated;

create function public.mess_set_feedback_policy(p_hours integer) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=private.require_mess_admin();
  if p_hours is null or p_hours not between 0 and 168 then raise exception 'Feedback edit window must be between 0 and 168 hours'; end if;
  update public.mess_feedback_policy set edit_window_hours=p_hours,updated_by=actor,updated_at=now() where singleton;
  insert into public.mess_events(actor_id,event_type,details) values(actor,'feedback_policy_updated',jsonb_build_object('edit_window_hours',p_hours));
end; $$;
revoke all on function public.mess_set_feedback_policy(integer) from public,anon,authenticated;
grant execute on function public.mess_set_feedback_policy(integer) to authenticated;

create function public.mess_feedback_edit_window() returns integer language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_mess_student_id() is null then raise exception 'Active student profile required' using errcode='42501'; end if;
  return (select edit_window_hours from public.mess_feedback_policy where singleton);
end; $$;
revoke all on function public.mess_feedback_edit_window() from public,anon,authenticated;
grant execute on function public.mess_feedback_edit_window() to authenticated;

create function public.mess_submit_feedback(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; menu public.mess_menus; prior public.mess_feedback; result_id uuid; edit_hours integer;
begin
  sid:=private.current_mess_student_id();
  if sid is null then raise exception 'Active student profile required' using errcode='42501'; end if;
  if (p_data->>'meal_date')::date>current_date then raise exception 'Feedback can only be left for a meal that has happened'; end if;
  if p_data->>'meal_slot' not in ('breakfast','lunch','evening_snacks','dinner') then raise exception 'Invalid meal slot'; end if;
  if (p_data->>'rating')::integer not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if coalesce(p_data->>'category','')<>'' and p_data->>'category' not in ('taste','quality','hygiene','variety','serving') then raise exception 'Invalid feedback category'; end if;
  if length(coalesce(p_data->>'comments',''))>1000 then raise exception 'Feedback comment is too long'; end if;
  select * into strict menu from public.mess_menus where meal_date=(p_data->>'meal_date')::date and meal_slot=p_data->>'meal_slot' and status='published';
  select * into prior from public.mess_feedback where student_id=sid and meal_date=menu.meal_date and meal_slot=menu.meal_slot for update;
  if prior.id is not null then
    select edit_window_hours into strict edit_hours from public.mess_feedback_policy where singleton;
    if edit_hours=0 or now()>prior.submitted_at+make_interval(hours=>edit_hours) then raise exception 'Feedback is already submitted and the edit window has closed'; end if;
    update public.mess_feedback set menu_id=menu.id,rating=(p_data->>'rating')::smallint,category=nullif(p_data->>'category',''),comments=trim(coalesce(p_data->>'comments','')),updated_at=now() where id=prior.id returning id into result_id;
    return result_id;
  end if;
  insert into public.mess_feedback(student_id,menu_id,meal_date,meal_slot,rating,category,comments)
  values(sid,menu.id,menu.meal_date,menu.meal_slot,(p_data->>'rating')::smallint,nullif(p_data->>'category',''),trim(coalesce(p_data->>'comments',''))) returning id into result_id;
  return result_id;
end; $$;
revoke all on function public.mess_submit_feedback(jsonb) from public,anon,authenticated;
grant execute on function public.mess_submit_feedback(jsonb) to authenticated;

create function public.mess_admin_summary(p_from date default current_date-6,p_to date default current_date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_mess_admin();
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'Choose a valid date range of at most 367 days'; end if;
  select jsonb_build_object(
    'feedback',jsonb_build_object(
      'count',(select count(*) from public.mess_feedback where meal_date between p_from and p_to),
      'average_rating',(select round(avg(rating)::numeric,2) from public.mess_feedback where meal_date between p_from and p_to),
      'by_slot',coalesce((select jsonb_agg(to_jsonb(x) order by x.meal_slot) from (select meal_slot,count(*)::integer count,round(avg(rating)::numeric,2) average_rating from public.mess_feedback where meal_date between p_from and p_to group by meal_slot) x),'[]'::jsonb),
      'by_rating',coalesce((select jsonb_agg(to_jsonb(x) order by x.rating) from (select rating,count(*)::integer count from public.mess_feedback where meal_date between p_from and p_to group by rating) x),'[]'::jsonb),
      'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.meal_date desc,x.submitted_at desc) from (select meal_date,meal_slot,rating,category,comments,submitted_at from public.mess_feedback where meal_date between p_from and p_to order by submitted_at desc limit 10) x),'[]'::jsonb)
    ),
    'menus',jsonb_build_object(
      'published_today',(select count(*) from public.mess_menus where meal_date=current_date and status='published'),
      'upcoming_published',(select count(*) from public.mess_menus where meal_date between current_date and current_date+6 and status='published'),
      'cancelled_in_range',(select count(*) from public.mess_menus where meal_date between p_from and p_to and status='cancelled')
    ),
    'complaints',jsonb_build_object(
      'total',(select count(*) from public.complaints where category like 'mess\_%' escape '\' and created_at::date between p_from and p_to),
      'open',(select count(*) from public.complaints where category like 'mess\_%' escape '\' and status not in ('resolved','closed')),
      'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,complaint_number,title,category,status,room_label,created_at from public.complaints where category like 'mess\_%' escape '\' order by created_at desc limit 10) x),'[]'::jsonb)
    )
  ) into result;
  return result;
end; $$;
revoke all on function public.mess_admin_summary(date,date) from public,anon,authenticated;
grant execute on function public.mess_admin_summary(date,date) to authenticated;

alter table public.mess_menus enable row level security;
alter table public.mess_feedback_policy enable row level security;
alter table public.mess_feedback enable row level security;
alter table public.mess_notifications enable row level security;
alter table public.mess_events enable row level security;
revoke all on public.mess_menus,public.mess_feedback_policy,public.mess_feedback,public.mess_notifications,public.mess_events from anon,authenticated;
grant select(meal_date,meal_slot,id,title,description,items,serving_start,serving_end,status,announcement,published_at,updated_at) on public.mess_menus to authenticated;
grant select(id,menu_id,meal_date,meal_slot,rating,category,comments,submitted_at,updated_at) on public.mess_feedback to authenticated;
grant select(singleton,edit_window_hours,updated_at) on public.mess_feedback_policy to authenticated;
grant select(id,menu_id,event_type,title,message,read_at,created_at) on public.mess_notifications to authenticated;
grant update(read_at) on public.mess_notifications to authenticated;
grant select on public.mess_events to authenticated;
grant all on public.mess_menus,public.mess_feedback_policy,public.mess_feedback,public.mess_notifications,public.mess_events to service_role;
create policy mess_menus_admin_read on public.mess_menus for select to authenticated using ((select private.is_active_admin()));
create policy mess_menus_student_read on public.mess_menus for select to authenticated using (status in ('published','cancelled'));
create policy mess_feedback_read on public.mess_feedback for select to authenticated using ((select private.is_active_admin()) or student_id=private.current_mess_student_id());
create policy mess_policy_admin_read on public.mess_feedback_policy for select to authenticated using ((select private.is_active_admin()));
create policy mess_notifications_self_read on public.mess_notifications for select to authenticated using (recipient_user_id=(select auth.uid()));
create policy mess_notifications_self_update on public.mess_notifications for update to authenticated using (recipient_user_id=(select auth.uid())) with check (recipient_user_id=(select auth.uid()));
create policy mess_events_admin_read on public.mess_events for select to authenticated using ((select private.is_active_admin()));

commit;
