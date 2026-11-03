-- Phase 9 trusted aggregate metrics. Depends on Phase 1 profiles and Phase 7 complaints.
begin;

do $$ begin
  if to_regclass('public.complaints') is null
     or to_regclass('public.complaint_messages') is null
     or to_regclass('public.complaint_maintenance_tasks') is null
     or to_regprocedure('private.is_active_admin()') is null then
    raise exception 'Phase 9 reporting requires Phase 1 administrator checks and Phase 7 complaint tables';
  end if;
end $$;

create function public.admin_operations_metrics(p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if (p_from is null)<>(p_to is null) or (p_from is not null and (p_from>p_to or p_to-p_from>366)) then
    raise exception 'Provide both valid dates within a 367-day range';
  end if;

  select jsonb_build_object(
    'complaints', jsonb_build_object(
      'open', (select count(*) from public.complaints where status in ('submitted','acknowledged','in_progress','on_hold') and (p_from is null or created_at::date between p_from and p_to)),
      'resolved', (select count(*) from public.complaints where status in ('resolved','closed') and (p_from is null or created_at::date between p_from and p_to)),
      'average_first_staff_reply_minutes', (
        select round(avg(extract(epoch from (reply.first_reply_at-c.created_at))/60)::numeric,1)
        from public.complaints c
        join lateral (
          select min(m.created_at) as first_reply_at
          from public.complaint_messages m
          where m.complaint_id=c.id and m.author_type='staff' and m.visibility='student'
        ) reply on reply.first_reply_at is not null
        where p_from is null or c.created_at::date between p_from and p_to
      ),
      'average_resolution_hours', (
        select round(avg(extract(epoch from (resolved_at-created_at))/3600)::numeric,1)
        from public.complaints where resolved_at is not null and (p_from is null or created_at::date between p_from and p_to)
      )
    ),
    'maintenance', jsonb_build_object(
      'open', (select count(*) from public.complaint_maintenance_tasks where status in ('open','scheduled','in_progress') and (p_from is null or created_at::date between p_from and p_to)),
      'upcoming_visits_7_days', (select count(*) from public.complaint_maintenance_tasks where status in ('open','scheduled','in_progress') and scheduled_visit_at>=now() and scheduled_visit_at<now()+interval '7 days')
    )
  ) into result;
  return result;
end; $$;
revoke all on function public.admin_operations_metrics(date,date) from public,anon,authenticated;
grant execute on function public.admin_operations_metrics(date,date) to authenticated;

commit;
