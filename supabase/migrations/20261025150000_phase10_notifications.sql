-- Phase 10: in-app hostel announcements with retry-safe recipient fan-out.
begin;

do $$ begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.students') is null
     or to_regprocedure('private.is_active_admin()') is null then
    raise exception 'Phase 10 announcements require Phase 1 profiles and Phase 2 students';
  end if;
end $$;

create table public.hostel_announcements (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.profiles(id),
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index hostel_announcements_created_idx on public.hostel_announcements(created_at desc);
create trigger hostel_announcements_updated before update on public.hostel_announcements
for each row execute function private.set_updated_at();

create table public.announcement_notifications (
  id bigint generated always as identity primary key,
  announcement_id uuid not null references public.hostel_announcements(id),
  recipient_user_id uuid not null references public.profiles(id),
  event_type text not null default 'hostel_announcement' check (event_type='hostel_announcement'),
  title text not null check (length(title) between 1 and 160),
  message text not null check (length(message) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (announcement_id,recipient_user_id)
);
create index announcement_notifications_recipient_idx on public.announcement_notifications(recipient_user_id,read_at,created_at desc);

alter table public.hostel_announcements enable row level security;
alter table public.announcement_notifications enable row level security;
revoke all on public.hostel_announcements,public.announcement_notifications from anon,authenticated;
grant select(id,author_user_id,title,body,status,created_at,updated_at,published_at) on public.hostel_announcements to authenticated;
grant select(id,announcement_id,recipient_user_id,event_type,title,message,read_at,created_at),update(read_at) on public.announcement_notifications to authenticated;
grant all on public.hostel_announcements,public.announcement_notifications to service_role;
create policy hostel_announcements_admin_read on public.hostel_announcements
  for select to authenticated using ((select private.is_active_admin()));
create policy announcement_notifications_self_read on public.announcement_notifications
  for select to authenticated using (recipient_user_id=(select auth.uid()));
create policy announcement_notifications_self_update on public.announcement_notifications
  for update to authenticated using (recipient_user_id=(select auth.uid()))
  with check (recipient_user_id=(select auth.uid()));

create function public.hostel_announcement_save(
  p_id uuid, p_title text, p_body text, p_action text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.hostel_announcements; recipients integer:=0;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if p_action not in ('draft','publish','archive') then raise exception 'Unsupported announcement action'; end if;
  if p_action in ('draft','publish') and (length(trim(coalesce(p_title,''))) not between 1 and 160 or length(trim(coalesce(p_body,''))) not between 1 and 4000) then
    raise exception 'Announcement title or body is invalid';
  end if;

  if p_action='draft' then
    if p_id is null then
      insert into public.hostel_announcements(author_user_id,title,body)
      values(auth.uid(),trim(p_title),trim(p_body)) returning * into item;
    else
      update public.hostel_announcements set title=trim(p_title),body=trim(p_body)
      where id=p_id and status='draft' returning * into item;
      if item.id is null then raise exception 'Draft not found or no longer editable'; end if;
    end if;
  elsif p_action='publish' then
    if p_id is null then raise exception 'Save a draft before publishing'; end if;
    update public.hostel_announcements set status='published',published_at=now(),title=trim(p_title),body=trim(p_body)
      where id=p_id and status='draft' returning * into item;
    if item.id is null then
      select * into item from public.hostel_announcements where id=p_id;
      if item.id is null or item.status not in ('published','archived') then
        raise exception 'Only a saved draft can be published';
      end if;
      return jsonb_build_object(
        'id',item.id,'status',item.status,'recipients_created',0,
        'already_published',true,
        'recipients_total',(select count(*) from public.announcement_notifications n where n.announcement_id=item.id)
      );
    end if;
    insert into public.announcement_notifications(announcement_id,recipient_user_id,title,message)
      select item.id,p.id,item.title,item.body
      from public.profiles p join public.students s on s.user_id=p.id and s.status='active'
      where p.role='student' and p.is_active
      on conflict (announcement_id,recipient_user_id) do nothing;
    get diagnostics recipients=row_count;
  else
    update public.hostel_announcements set status='archived'
      where id=p_id and status in ('draft','published') returning * into item;
    if item.id is null then raise exception 'Announcement not found'; end if;
  end if;

  return jsonb_build_object('id',item.id,'status',item.status,'recipients_created',recipients);
end; $$;
revoke all on function public.hostel_announcement_save(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.hostel_announcement_save(uuid,text,text,text) to authenticated;

create function public.hostel_announcement_list(p_page integer default 0,p_page_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if p_page<0 or p_page_size not between 1 and 50 then raise exception 'Invalid page'; end if;
  select count(*) into total from public.hostel_announcements;
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select a.id,a.title,a.body,a.status,a.created_at,a.updated_at,a.published_at,
      (select count(*) from public.announcement_notifications n where n.announcement_id=a.id) as recipient_count,
      (select count(*) from public.announcement_notifications n where n.announcement_id=a.id and n.read_at is not null) as read_count
    from public.hostel_announcements a order by a.created_at desc
    offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'total',total);
end; $$;
revoke all on function public.hostel_announcement_list(integer,integer) from public,anon,authenticated;
grant execute on function public.hostel_announcement_list(integer,integer) to authenticated;

commit;
