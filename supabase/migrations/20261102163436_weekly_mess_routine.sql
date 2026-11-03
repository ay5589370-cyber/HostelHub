-- Weekly recurring mess plan and shared meal serving times.
-- Depends on Phase 1 profiles and the active-admin helper.
begin;

do $$ begin
  if to_regclass('public.profiles') is null or to_regprocedure('private.is_active_admin()') is null
     or to_regprocedure('private.current_mess_student_id()') is null then
    raise exception 'Weekly mess routine requires the Phase 1 profiles and Phase 8 mess authorization helpers';
  end if;
end $$;

create table public.mess_weekly_routine (
  weekday smallint not null check (weekday between 0 and 6), -- PostgreSQL DOW: Sunday=0
  meal_slot text not null check (meal_slot in ('breakfast','lunch','dinner')),
  menu_text text not null default '' check (length(menu_text) <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (weekday, meal_slot)
);

create table public.mess_meal_times (
  meal_slot text primary key check (meal_slot in ('breakfast','lunch','dinner')),
  serving_start time not null,
  serving_end time not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (serving_end > serving_start)
);

insert into public.mess_weekly_routine (weekday, meal_slot)
select day, slot from generate_series(0,6) as day
cross join unnest(array['breakfast','lunch','dinner']::text[]) as slot;

insert into public.mess_meal_times (meal_slot, serving_start, serving_end) values
  ('breakfast','07:00','08:00'),
  ('lunch','12:30','14:00'),
  ('dinner','19:30','21:00');

alter table public.mess_weekly_routine enable row level security;
alter table public.mess_meal_times enable row level security;
revoke all on public.mess_weekly_routine, public.mess_meal_times from anon, authenticated;
grant select (weekday,meal_slot,menu_text,updated_at) on public.mess_weekly_routine to authenticated;
grant select (meal_slot,serving_start,serving_end,updated_at) on public.mess_meal_times to authenticated;

create policy mess_weekly_routine_active_read on public.mess_weekly_routine
  for select to authenticated using (
    private.is_active_admin() or private.current_mess_student_id() is not null
  );
create policy mess_meal_times_active_read on public.mess_meal_times
  for select to authenticated using (
    private.is_active_admin() or private.current_mess_student_id() is not null
  );

create function public.mess_save_weekly_routine(p_routine jsonb, p_times jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; item jsonb; time_item jsonb; day_value integer; slot_value text;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  actor := auth.uid();
  if jsonb_typeof(p_routine) is distinct from 'array' or jsonb_array_length(p_routine) <> 21
     or jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times) <> 3 then
    raise exception 'Provide all 21 weekly meals and all 3 meal times';
  end if;
  for item in select value from jsonb_array_elements(p_routine) loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'weekday','') !~ '^[0-6]$'
      or coalesce(item->>'meal_slot','') not in ('breakfast','lunch','dinner')
      or jsonb_typeof(item->'menu_text') is distinct from 'string'
      or length(item->>'menu_text') > 1000 then
      raise exception 'Invalid weekly meal entry';
    end if;
    day_value := (item->>'weekday')::integer;
    slot_value := item->>'meal_slot';
    if (select count(*) from jsonb_array_elements(p_routine) x
        where (x->>'weekday')::integer=day_value and x->>'meal_slot'=slot_value) <> 1 then
      raise exception 'Each weekday must have exactly one entry for each meal';
    end if;
  end loop;
  if (select count(distinct (x->>'weekday',x->>'meal_slot')) from jsonb_array_elements(p_routine) x) <> 21 then
    raise exception 'Weekly meal entries must be unique';
  end if;
  for time_item in select value from jsonb_array_elements(p_times) loop
    if jsonb_typeof(time_item) is distinct from 'object'
      or coalesce(time_item->>'meal_slot','') not in ('breakfast','lunch','dinner')
      or coalesce(time_item->>'serving_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(time_item->>'serving_end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (time_item->>'serving_end')::time <= (time_item->>'serving_start')::time then
      raise exception 'Provide valid start and end times for every meal';
    end if;
  end loop;
  if (select count(distinct x->>'meal_slot') from jsonb_array_elements(p_times) x) <> 3 then
    raise exception 'Meal time entries must include breakfast, lunch and dinner once each';
  end if;

  insert into public.mess_weekly_routine(weekday,meal_slot,menu_text,updated_by,updated_at)
  select (x->>'weekday')::smallint,x->>'meal_slot',x->>'menu_text',actor,now()
  from jsonb_array_elements(p_routine) x
  on conflict (weekday,meal_slot) do update set menu_text=excluded.menu_text,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  insert into public.mess_meal_times(meal_slot,serving_start,serving_end,updated_by,updated_at)
  select x->>'meal_slot',(x->>'serving_start')::time,(x->>'serving_end')::time,actor,now()
  from jsonb_array_elements(p_times) x
  on conflict (meal_slot) do update set serving_start=excluded.serving_start,serving_end=excluded.serving_end,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end; $$;
revoke all on function public.mess_save_weekly_routine(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.mess_save_weekly_routine(jsonb,jsonb) to authenticated;

commit;
