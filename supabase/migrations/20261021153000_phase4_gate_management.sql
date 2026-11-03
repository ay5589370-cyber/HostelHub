-- Phase 4: Smart Gate Management & QR Verification. Review before applying.
begin;

-- 1. Extend profiles role check to permit 'security'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'student', 'warden', 'security'));

-- 2. Helper to check if caller is active security personnel or admin
create or replace function private.is_active_security() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('security', 'admin') and is_active
  );
$$;
revoke all on function private.is_active_security() from public, anon, authenticated;
grant execute on function private.is_active_security() to authenticated;

-- 3. Sequence for human-readable gate pass codes
create sequence if not exists public.gate_pass_code_seq start 1000;

-- 4. Gate Passes table
create table public.gate_passes (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  pass_code text not null unique,
  token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked', 'completed')),
  exit_used_at timestamptz,
  entry_used_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  revoked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gate_passes_request_idx on public.gate_passes(leave_request_id);
create index gate_passes_student_idx on public.gate_passes(student_id);
create index gate_passes_code_idx on public.gate_passes(pass_code);
create index gate_passes_status_idx on public.gate_passes(status);

-- 5. Gate Events table (Immutable audit log)
create table public.gate_events (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid references public.gate_passes(id),
  leave_request_id uuid references public.leave_requests(id),
  student_id uuid not null references public.students(id) on delete cascade,
  event_type text not null check (event_type in ('exit', 'entry')),
  verified_by uuid not null references public.profiles(id),
  outcome text not null check (outcome in ('accepted', 'rejected')),
  rejection_reason text,
  is_manual_override boolean not null default false,
  override_reason text check (not is_manual_override or (override_reason is null or length(trim(override_reason)) >= 5)),
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index gate_events_student_created_idx on public.gate_events(student_id, created_at desc);
create index gate_events_created_at_idx on public.gate_events(created_at desc);
create index gate_events_pass_idx on public.gate_events(pass_id);
create index gate_events_type_outcome_idx on public.gate_events(event_type, outcome);

-- 6. Student Presence table (Live campus presence tracking)
create table public.student_presence (
  student_id uuid primary key references public.students(id) on delete cascade,
  status text not null default 'inside' check (status in ('inside', 'outside')),
  active_leave_id uuid references public.leave_requests(id),
  active_pass_id uuid references public.gate_passes(id),
  last_exit_at timestamptz,
  last_entry_at timestamptz,
  expected_return_at timestamptz,
  last_event_id uuid references public.gate_events(id),
  updated_at timestamptz not null default now()
);
create index student_presence_status_idx on public.student_presence(status);
create index student_presence_expected_return_idx on public.student_presence(expected_return_at) where status = 'outside';

-- Populate existing students into student_presence
insert into public.student_presence(student_id, status)
select id, 'inside' from public.students
on conflict (student_id) do nothing;

-- Trigger to initialize presence for newly created students
create or replace function private.init_student_presence() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.student_presence(student_id, status) values (new.id, 'inside')
  on conflict (student_id) do nothing;
  return new;
end; $$;
revoke all on function private.init_student_presence() from public, anon, authenticated;

drop trigger if exists on_student_presence_created on public.students;
create trigger on_student_presence_created after insert on public.students
for each row execute function private.init_student_presence();

-- 7. RPC: Issue / Retrieve Gate Pass
create or replace function private.get_or_create_gate_pass(p_leave_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  req public.leave_requests;
  caller_student uuid;
  pass public.gate_passes;
  raw_token text;
  token_h text;
  generated_code text;
  exp_time timestamptz;
  stu public.students;
begin
  select * into req from public.leave_requests where id = p_leave_request_id;
  if not found then raise exception 'Leave request not found'; end if;

  caller_student := private.current_student_id();
  if not ((select private.is_active_admin()) or (caller_student is not null and caller_student = req.student_id)) then
    raise exception 'Not authorized to access gate pass for this request' using errcode = '42501';
  end if;

  if req.status <> 'approved' then
    raise exception 'Gate pass can only be issued for approved leave requests (current status: %)', req.status;
  end if;

  select * into stu from public.students where id = req.student_id;
  exp_time := req.expected_return_at + interval '4 hours';

  -- Check if pass already exists
  select * into pass from public.gate_passes
  where leave_request_id = p_leave_request_id and status in ('active', 'used', 'revoked', 'completed', 'expired');

  if found then
    if pass.status = 'revoked' then
      raise exception 'Gate pass was revoked: %', coalesce(pass.revocation_reason, 'No reason given');
    end if;
    if now() > pass.expires_at and pass.status not in ('completed', 'used') then
      update public.gate_passes set status = 'expired' where id = pass.id;
      raise exception 'Gate pass has expired';
    end if;

    -- Generate a fresh session token and update hash
    raw_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    token_h := encode(sha256(convert_to(raw_token, 'UTF8')), 'hex');
    update public.gate_passes set token_hash = token_h, updated_at = now() where id = pass.id;

    return jsonb_build_object(
      'pass_id', pass.id,
      'pass_code', pass.pass_code,
      'token', raw_token,
      'leave_request_id', req.id,
      'student_name', stu.full_name,
      'student_id', stu.student_id,
      'destination', req.destination,
      'departure_at', req.departure_at,
      'expected_return_at', req.expected_return_at,
      'expires_at', pass.expires_at,
      'status', pass.status,
      'exit_used_at', pass.exit_used_at,
      'entry_used_at', pass.entry_used_at
    );
  end if;

  -- Create fresh gate pass
  generated_code := 'GP-' || to_char(now(), 'YY') || lpad(nextval('public.gate_pass_code_seq')::text, 6, '0');
  raw_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  token_h := encode(sha256(convert_to(raw_token, 'UTF8')), 'hex');

  insert into public.gate_passes(leave_request_id, student_id, pass_code, token_hash, expires_at, status)
  values(req.id, req.student_id, generated_code, token_h, exp_time, 'active')
  returning * into pass;

  return jsonb_build_object(
    'pass_id', pass.id,
    'pass_code', pass.pass_code,
    'token', raw_token,
    'leave_request_id', req.id,
    'student_name', stu.full_name,
    'student_id', stu.student_id,
    'destination', req.destination,
    'departure_at', req.departure_at,
    'expected_return_at', req.expected_return_at,
    'expires_at', pass.expires_at,
    'status', pass.status,
    'exit_used_at', null,
    'entry_used_at', null
  );
end; $$;
revoke all on function private.get_or_create_gate_pass(uuid) from public, anon, authenticated;
grant execute on function private.get_or_create_gate_pass(uuid) to authenticated;

create or replace function public.get_or_create_gate_pass(p_leave_request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.get_or_create_gate_pass(p_leave_request_id);
$$;
revoke all on function public.get_or_create_gate_pass(uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_gate_pass(uuid) to authenticated;

-- 8. RPC: Verify Gate Scan (Atomic verification for exit or entry)
create or replace function private.verify_gate_scan(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  in_pass_id uuid;
  in_token text;
  in_code text;
  in_event text;
  in_idem text;
  pass public.gate_passes;
  req public.leave_requests;
  stu public.students;
  presence public.student_presence;
  computed_hash text;
  event_rec public.gate_events;
  alloc record;
  op_uid uuid;
  is_late boolean;
begin
  op_uid := auth.uid();
  if op_uid is null or not private.is_active_security() then
    raise exception 'Security personnel access required' using errcode = '42501';
  end if;

  in_pass_id := nullif(p_data->>'pass_id', '')::uuid;
  in_token := trim(coalesce(p_data->>'token', ''));
  in_code := upper(trim(coalesce(p_data->>'pass_code', '')));
  in_event := coalesce(p_data->>'event_type', '');
  in_idem := nullif(p_data->>'idempotency_key', '');

  if in_event not in ('exit', 'entry') then
    raise exception 'Invalid gate event type: must be exit or entry';
  end if;

  -- Idempotency check
  if in_idem is not null then
    select * into event_rec from public.gate_events where idempotency_key = in_idem;
    if found then
      select * into stu from public.students where id = event_rec.student_id;
      return jsonb_build_object(
        'outcome', event_rec.outcome,
        'event_id', event_rec.id,
        'event_type', event_rec.event_type,
        'student_name', stu.full_name,
        'student_id', stu.student_id,
        'timestamp', event_rec.created_at,
        'duplicate', true
      );
    end if;
  end if;

  -- Locate pass by id or code
  if in_pass_id is not null then
    select * into pass from public.gate_passes where id = in_pass_id for update;
  elsif in_code <> '' then
    select * into pass from public.gate_passes where pass_code = in_code for update;
  else
    raise exception 'Either QR pass token or manual pass code must be provided';
  end if;

  if not found then
    raise exception 'Gate pass not found';
  end if;

  -- If token was provided, verify hash
  if in_token <> '' then
    computed_hash := encode(sha256(convert_to(in_token, 'UTF8')), 'hex');
    if computed_hash <> pass.token_hash then
      raise exception 'Invalid pass token';
    end if;
  end if;

  -- Verify pass status
  if pass.status = 'revoked' then
    raise exception 'Gate pass has been revoked: %', coalesce(pass.revocation_reason, 'Admin revocation');
  end if;

  if now() > pass.expires_at and pass.status not in ('completed') then
    update public.gate_passes set status = 'expired' where id = pass.id;
    raise exception 'Gate pass has expired';
  end if;

  -- Verify leave request
  select * into req from public.leave_requests where id = pass.leave_request_id for update;
  if not found then raise exception 'Leave request associated with pass not found'; end if;
  if req.status not in ('approved', 'overdue') then
    raise exception 'Leave request is no longer approved (current status: %)', req.status;
  end if;

  select * into stu from public.students where id = pass.student_id;
  select * into presence from public.student_presence where student_id = pass.student_id for update;
  if not found then
    insert into public.student_presence(student_id, status) values (pass.student_id, 'inside')
    returning * into presence;
  end if;

  -- Query bed allocation for display
  select h.name as hostel_name, h.block, r.room_number, b.bed_number into alloc
  from public.bed_allocations a
  join public.beds b on b.id = a.bed_id
  join public.rooms r on r.id = b.room_id
  join public.hostels h on h.id = r.hostel_id
  where a.student_id = pass.student_id and a.status = 'active'
  limit 1;

  if in_event = 'exit' then
    if pass.exit_used_at is not null then
      raise exception 'Gate pass exit has already been verified';
    end if;
    if presence.status = 'outside' then
      raise exception 'Student is already recorded as outside';
    end if;

    -- Permitted departure window: not earlier than 2 hours before scheduled departure
    if now() < req.departure_at - interval '2 hours' then
      raise exception 'Departure window has not opened yet (scheduled: %)', req.departure_at;
    end if;

    -- Insert exit gate event
    insert into public.gate_events(pass_id, leave_request_id, student_id, event_type, verified_by, outcome, idempotency_key)
    values(pass.id, req.id, pass.student_id, 'exit', op_uid, 'accepted', in_idem)
    returning * into event_rec;

    -- Update pass
    update public.gate_passes set exit_used_at = now(), status = 'used', updated_at = now() where id = pass.id;

    -- Update presence
    update public.student_presence set
      status = 'outside',
      active_leave_id = req.id,
      active_pass_id = pass.id,
      last_exit_at = now(),
      expected_return_at = req.expected_return_at,
      last_event_id = event_rec.id,
      updated_at = now()
    where student_id = pass.student_id;

    -- In-app notification
    insert into public.notifications(recipient_user_id, leave_request_id, event_type, title, message)
    values(stu.user_id, req.id, 'leave_approved', 'Gate Exit Recorded', format('Your exit for %s was verified at %s.', req.request_number, to_char(now(), 'HH12:MI AM')))
    on conflict do nothing;

    return jsonb_build_object(
      'outcome', 'accepted',
      'event_id', event_rec.id,
      'event_type', 'exit',
      'student_name', stu.full_name,
      'student_id', stu.student_id,
      'photo_path', stu.profile_photo_path,
      'hostel_name', coalesce(alloc.hostel_name, 'Unassigned'),
      'room_number', coalesce(alloc.room_number, '—'),
      'bed_number', coalesce(alloc.bed_number, '—'),
      'destination', req.destination,
      'scheduled_return', req.expected_return_at,
      'timestamp', event_rec.created_at
    );

  elsif in_event = 'entry' then
    if presence.status <> 'outside' then
      raise exception 'Student is not recorded as outside';
    end if;

    is_late := now() > req.expected_return_at;

    -- Insert entry gate event
    insert into public.gate_events(pass_id, leave_request_id, student_id, event_type, verified_by, outcome, idempotency_key)
    values(pass.id, req.id, pass.student_id, 'entry', op_uid, 'accepted', in_idem)
    returning * into event_rec;

    -- Update pass
    update public.gate_passes set entry_used_at = now(), status = 'completed', updated_at = now() where id = pass.id;

    -- Update presence
    update public.student_presence set
      status = 'inside',
      active_leave_id = null,
      active_pass_id = null,
      last_entry_at = now(),
      last_event_id = event_rec.id,
      updated_at = now()
    where student_id = pass.student_id;

    -- Complete leave request
    update public.leave_requests set status = 'completed', updated_at = now() where id = req.id;

    -- Log status history
    insert into public.leave_request_history(leave_request_id, previous_status, new_status, remarks, actor_user_id)
    values(req.id, req.status, 'completed', case when is_late then 'Returned after expected return time' else 'Returned on schedule' end, op_uid);

    -- In-app notification
    insert into public.notifications(recipient_user_id, leave_request_id, event_type, title, message)
    values(stu.user_id, req.id, 'leave_approved', 'Gate Entry Recorded', format('Your return for %s was recorded at %s. Welcome back!', req.request_number, to_char(now(), 'HH12:MI AM')))
    on conflict do nothing;

    return jsonb_build_object(
      'outcome', 'accepted',
      'event_id', event_rec.id,
      'event_type', 'entry',
      'student_name', stu.full_name,
      'student_id', stu.student_id,
      'photo_path', stu.profile_photo_path,
      'hostel_name', coalesce(alloc.hostel_name, 'Unassigned'),
      'room_number', coalesce(alloc.room_number, '—'),
      'bed_number', coalesce(alloc.bed_number, '—'),
      'is_late', is_late,
      'timestamp', event_rec.created_at
    );
  end if;

end; $$;
revoke all on function private.verify_gate_scan(jsonb) from public, anon, authenticated;
grant execute on function private.verify_gate_scan(jsonb) to authenticated;

create or replace function public.verify_gate_scan(p_data jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.verify_gate_scan(p_data);
$$;
revoke all on function public.verify_gate_scan(jsonb) from public, anon, authenticated;
grant execute on function public.verify_gate_scan(jsonb) to authenticated;

-- 9. RPC: Manual Gate Override
create or replace function private.manual_gate_override(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  in_student_id uuid;
  in_event text;
  in_reason text;
  in_leave_id uuid;
  op_uid uuid;
  stu public.students;
  presence public.student_presence;
  event_rec public.gate_events;
begin
  op_uid := auth.uid();
  if op_uid is null or not private.is_active_security() then
    raise exception 'Security personnel access required' using errcode = '42501';
  end if;

  in_student_id := (p_data->>'student_id')::uuid;
  in_event := coalesce(p_data->>'event_type', '');
  in_reason := trim(coalesce(p_data->>'override_reason', ''));
  in_leave_id := nullif(p_data->>'leave_request_id', '')::uuid;

  if in_event not in ('exit', 'entry') then
    raise exception 'Event type must be exit or entry';
  end if;
  if length(in_reason) < 5 then
    raise exception 'A detailed override reason of at least 5 characters is required';
  end if;

  select * into stu from public.students where id = in_student_id;
  if not found then raise exception 'Student not found'; end if;

  select * into presence from public.student_presence where student_id = in_student_id for update;
  if not found then
    insert into public.student_presence(student_id, status) values (in_student_id, 'inside')
    returning * into presence;
  end if;

  -- Record manual override event
  insert into public.gate_events(
    pass_id, leave_request_id, student_id, event_type, verified_by, outcome, is_manual_override, override_reason
  )
  values(
    presence.active_pass_id, coalesce(in_leave_id, presence.active_leave_id), in_student_id, in_event, op_uid, 'accepted', true, in_reason
  )
  returning * into event_rec;

  if in_event = 'exit' then
    update public.student_presence set
      status = 'outside',
      last_exit_at = now(),
      last_event_id = event_rec.id,
      updated_at = now()
    where student_id = in_student_id;
  else
    update public.student_presence set
      status = 'inside',
      active_leave_id = null,
      active_pass_id = null,
      last_entry_at = now(),
      last_event_id = event_rec.id,
      updated_at = now()
    where student_id = in_student_id;

    if presence.active_leave_id is not null then
      update public.leave_requests set status = 'completed', updated_at = now() where id = presence.active_leave_id;
      insert into public.leave_request_history(leave_request_id, previous_status, new_status, remarks, actor_user_id)
      values(presence.active_leave_id, 'approved', 'completed', format('Manual gate entry override: %s', in_reason), op_uid);
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'accepted',
    'event_id', event_rec.id,
    'event_type', in_event,
    'student_name', stu.full_name,
    'is_manual_override', true,
    'timestamp', event_rec.created_at
  );
end; $$;
revoke all on function private.manual_gate_override(jsonb) from public, anon, authenticated;
grant execute on function private.manual_gate_override(jsonb) to authenticated;

create or replace function public.manual_gate_override(p_data jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.manual_gate_override(p_data);
$$;
revoke all on function public.manual_gate_override(jsonb) from public, anon, authenticated;
grant execute on function public.manual_gate_override(jsonb) to authenticated;

-- 10. RPC: Revoke Gate Pass (Admin only)
create or replace function private.revoke_gate_pass(p_pass_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pass public.gate_passes;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A revocation reason of at least 3 characters is required';
  end if;

  select * into pass from public.gate_passes where id = p_pass_id for update;
  if not found then raise exception 'Gate pass not found'; end if;
  if pass.status in ('completed', 'revoked') then
    raise exception 'Pass is already %', pass.status;
  end if;

  update public.gate_passes set
    status = 'revoked',
    revoked_at = now(),
    revocation_reason = trim(p_reason),
    revoked_by = auth.uid(),
    updated_at = now()
  where id = p_pass_id;

  return jsonb_build_object('id', p_pass_id, 'status', 'revoked');
end; $$;
revoke all on function private.revoke_gate_pass(uuid, text) from public, anon, authenticated;
grant execute on function private.revoke_gate_pass(uuid, text) to authenticated;

create or replace function public.revoke_gate_pass(p_pass_id uuid, p_reason text) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.revoke_gate_pass(p_pass_id, p_reason);
$$;
revoke all on function public.revoke_gate_pass(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_gate_pass(uuid, text) to authenticated;

-- 11. RPC: Gate Dashboard Metrics
create or replace function public.gate_dashboard_metrics() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'total_students', (select count(*) from public.students where status = 'active'),
  'students_inside', (select count(*) from public.student_presence where status = 'inside'),
  'students_outside', (select count(*) from public.student_presence where status = 'outside'),
  'departures_today', (select count(*) from public.leave_requests where status in ('approved', 'completed') and departure_at::date = current_date),
  'returns_today', (select count(*) from public.leave_requests where status in ('approved', 'completed', 'overdue') and expected_return_at::date = current_date),
  'overdue_count', (select count(*) from public.student_presence where status = 'outside' and expected_return_at < now()),
  'recent_events', coalesce((
    select jsonb_agg(x) from (
      select ge.id, ge.event_type, ge.outcome, ge.is_manual_override, ge.created_at,
             s.full_name as student_name, s.student_id as student_number
      from public.gate_events ge
      join public.students s on s.id = ge.student_id
      order by ge.created_at desc limit 10
    ) x
  ), '[]'::jsonb)
); $$;
revoke all on function public.gate_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.gate_dashboard_metrics() to authenticated;

-- 12. Row Level Security Policies
alter table public.gate_passes enable row level security;
alter table public.gate_events enable row level security;
alter table public.student_presence enable row level security;

revoke all on public.gate_passes, public.gate_events, public.student_presence from anon, authenticated;
grant select on public.gate_passes, public.gate_events, public.student_presence to authenticated;
grant all on public.gate_passes, public.gate_events, public.student_presence to service_role;

-- Gate Passes policies
create policy gate_passes_read on public.gate_passes for select to authenticated using (
  (select private.is_active_security()) or (student_id = private.current_student_id())
);

-- Gate Events policies
create policy gate_events_read on public.gate_events for select to authenticated using (
  (select private.is_active_security()) or (student_id = private.current_student_id())
);

-- Student Presence policies
create policy student_presence_read on public.student_presence for select to authenticated using (
  (select private.is_active_security()) or (student_id = private.current_student_id())
);

-- 13. Add to Realtime Publication
alter publication supabase_realtime add table public.gate_events, public.student_presence, public.gate_passes;

commit;
