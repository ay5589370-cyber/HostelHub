begin;

-- Replace the legacy security role with a separate, least-privilege guard role.
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'security_guard' where role = 'security';
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'student', 'warden', 'security_guard'));

create or replace function private.is_active_security()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('security_guard', 'admin') and is_active
  );
$$;
revoke all on function private.is_active_security() from public, anon, authenticated;
grant execute on function private.is_active_security() to authenticated;

create or replace function private.is_active_visitor_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warden','security_guard'));
$$;
revoke all on function private.is_active_visitor_staff() from public, anon, authenticated;
grant execute on function private.is_active_visitor_staff() to authenticated;

-- Guards only use the scoped Edge Function. Admins and students retain their
-- existing row access; guard clients cannot read the broad audit tables.
drop policy if exists gate_passes_read on public.gate_passes;
create policy gate_passes_read on public.gate_passes for select to authenticated using (
  (select private.is_active_admin()) or student_id = (select private.current_student_id())
);
drop policy if exists gate_events_read on public.gate_events;
create policy gate_events_read on public.gate_events for select to authenticated using (
  (select private.is_active_admin()) or student_id = (select private.current_student_id())
);
drop policy if exists student_presence_read on public.student_presence;
create policy student_presence_read on public.student_presence for select to authenticated using (
  (select private.is_active_admin()) or student_id = (select private.current_student_id())
);

alter table public.gate_events
  add column if not exists gate_location text check (gate_location is null or length(trim(gate_location)) between 1 and 100),
  add column if not exists remarks text check (remarks is null or length(trim(remarks)) <= 500);

-- A leave request has one pass identity. The raw random token is only returned
-- by the existing student pass RPC; only its SHA-256 digest is stored here.
create unique index if not exists gate_passes_one_per_leave_idx on public.gate_passes(leave_request_id);
create or replace function private.issue_gate_pass_after_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare raw_token text; generated_code text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    raw_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    generated_code := 'GP-' || to_char(now(), 'YY') || lpad(nextval('public.gate_pass_code_seq')::text, 6, '0');
    insert into public.gate_passes(leave_request_id,student_id,pass_code,token_hash,expires_at,status)
    values(new.id,new.student_id,generated_code,encode(sha256(convert_to(raw_token,'UTF8')),'hex'),new.expected_return_at+interval '4 hours','active')
    on conflict (leave_request_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.issue_gate_pass_after_approval() from public, anon, authenticated;
drop trigger if exists issue_gate_pass_after_approval on public.leave_requests;
create trigger issue_gate_pass_after_approval after update of status on public.leave_requests
  for each row execute function private.issue_gate_pass_after_approval();

insert into public.gate_passes(leave_request_id,student_id,pass_code,token_hash,expires_at,status)
select r.id,r.student_id,'GP-'||to_char(now(),'YY')||lpad(nextval('public.gate_pass_code_seq')::text,6,'0'),
       encode(sha256(convert_to(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'UTF8')),'hex'),
       r.expected_return_at+interval '4 hours','active'
from public.leave_requests r
where r.status='approved' and r.expected_return_at+interval '4 hours'>now()
on conflict (leave_request_id) do nothing;

-- Do not cancel an approved leave while the student is outside on that pass.
create or replace function private.guard_leave_cancellation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'approved' and new.status = 'cancelled' and exists (
    select 1 from public.student_presence sp
    where sp.active_leave_id = old.id and sp.status = 'outside'
  ) then
    raise exception 'A leave cannot be cancelled while the student is outside; record the return first';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_leave_cancellation() from public, anon, authenticated;
drop trigger if exists leave_cancellation_guard on public.leave_requests;
create trigger leave_cancellation_guard before update of status on public.leave_requests
  for each row execute function private.guard_leave_cancellation();

create or replace function private.revoke_pass_after_leave_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('rejected', 'cancelled') and old.status is distinct from new.status then
    update public.gate_passes
       set status = 'revoked', revoked_at = now(), revocation_reason = 'Leave request ' || new.status, updated_at = now()
     where leave_request_id = new.id and status in ('active', 'used');
  end if;
  return new;
end;
$$;
revoke all on function private.revoke_pass_after_leave_change() from public, anon, authenticated;
drop trigger if exists revoke_gate_pass_after_leave_change on public.leave_requests;
create trigger revoke_gate_pass_after_leave_change after update of status on public.leave_requests
  for each row execute function private.revoke_pass_after_leave_change();

-- All guard verification and movement now passes through the authenticated
-- gate-verification Edge Function. Remove the old client-callable bypasses.
revoke all on function public.verify_gate_scan(jsonb) from public, anon, authenticated;
revoke all on function private.verify_gate_scan(jsonb) from public, anon, authenticated;
revoke all on function public.manual_gate_override(jsonb) from public, anon, authenticated;
revoke all on function private.manual_gate_override(jsonb) from public, anon, authenticated;
revoke all on function public.gate_dashboard_metrics() from public, anon, authenticated;
revoke all on function private.revoke_gate_pass(uuid, text) from public, anon, authenticated;
grant execute on function private.revoke_gate_pass(uuid, text) to authenticated;
grant execute on function public.revoke_gate_pass(uuid, text) to authenticated;
grant execute on function public.gate_dashboard_metrics() to authenticated;

create or replace function private.record_gate_movement(
  p_guard_id uuid,
  p_pass_id uuid,
  p_token text,
  p_action text,
  p_location text default null,
  p_remarks text default null,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pass public.gate_passes;
  req public.leave_requests;
  stu public.students;
  presence public.student_presence;
  alloc record;
  event_rec public.gate_events;
  action_value text := upper(trim(coalesce(p_action, '')));
  token_hash text;
  event_time timestamptz;
begin
  if p_guard_id is null or not exists (
    select 1 from public.profiles where id = p_guard_id and role = 'security_guard' and is_active
  ) then
    raise exception 'Active security guard access required' using errcode = '42501';
  end if;
  if p_pass_id is null or p_token is null or p_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invalid gate pass token';
  end if;
  if action_value not in ('VERIFY', 'OUT', 'IN') then
    raise exception 'Action must be VERIFY, OUT, or IN';
  end if;
  if length(trim(coalesce(p_location, ''))) > 100 or length(trim(coalesce(p_remarks, ''))) > 500 then
    raise exception 'Gate location or remarks are too long';
  end if;

  select * into pass from public.gate_passes where id = p_pass_id;
  if not found then raise exception 'Gate pass not found'; end if;
  if p_token is null then raise exception 'Invalid gate pass token'; end if;
  token_hash := encode(sha256(convert_to(lower(p_token), 'UTF8')), 'hex');
  select * into req from public.leave_requests where id = pass.leave_request_id for update;
  if not found or req.student_id <> pass.student_id then raise exception 'Leave request not found'; end if;
  select * into pass from public.gate_passes where id = p_pass_id for update;
  token_hash := encode(sha256(convert_to(lower(p_token), 'UTF8')), 'hex');
  if token_hash <> pass.token_hash then raise exception 'Invalid gate pass token'; end if;
  if pass.status in ('revoked', 'expired', 'completed') then
    raise exception 'Gate pass is %', pass.status;
  end if;
  if now() > pass.expires_at then
    update public.gate_passes set status = 'expired', updated_at = now() where id = pass.id;
    raise exception 'Gate pass has expired';
  end if;

  if req.status not in ('approved', 'overdue') then
    raise exception 'Leave request is no longer valid (status: %)', req.status;
  end if;
  if action_value = 'OUT' and (req.status <> 'approved' or now() < req.departure_at - interval '2 hours' or now() > req.expected_return_at) then
    raise exception 'Approved departure window is not open';
  end if;

  insert into public.student_presence(student_id, status)
    values (pass.student_id, 'inside') on conflict (student_id) do nothing;
  select * into presence from public.student_presence where student_id = pass.student_id for update;

  if action_value = 'VERIFY' then
    if req.status = 'overdue' and (presence.status <> 'outside' or presence.active_leave_id <> req.id) then
      raise exception 'Expired leave cannot be used for departure';
    end if;
  elsif action_value = 'OUT' then
    if presence.status = 'outside' then raise exception 'Student is already recorded as outside'; end if;
  else
    if presence.status <> 'outside' or presence.active_leave_id <> req.id or presence.active_pass_id <> pass.id then
      raise exception 'Student is not outside on this valid leave pass';
    end if;
  end if;

  if p_idempotency_key is not null then
    select * into event_rec from public.gate_events where idempotency_key = p_idempotency_key;
    if found then
      if event_rec.pass_id <> pass.id or event_rec.verified_by <> p_guard_id or
         event_rec.event_type <> (case action_value when 'OUT' then 'exit' else 'entry' end) then
        raise exception 'Idempotency key was already used';
      end if;
      return jsonb_build_object('outcome','accepted','event_id',event_rec.id,'event_type',event_rec.event_type,
        'timestamp',event_rec.created_at,'movement_status',presence.status);
    end if;
  end if;

  select h.name as hostel_name, r.room_number into alloc
    from public.bed_allocations a join public.beds b on b.id = a.bed_id
    join public.rooms r on r.id = b.room_id join public.hostels h on h.id = r.hostel_id
   where a.student_id = pass.student_id and a.status = 'active' limit 1;
  select * into stu from public.students where id = pass.student_id;

  if action_value = 'VERIFY' then
    return jsonb_build_object(
      'student_name',stu.full_name,'student_id',stu.student_id,'photo_path',stu.profile_photo_path,
      'room_number',coalesce(alloc.room_number,'—'),'hostel_name',coalesce(alloc.hostel_name,'Unassigned'),
      'leave_type',req.leave_type,'departure_at',req.departure_at,'expected_return_at',req.expected_return_at,
      'leave_status',req.status,'movement_status',presence.status,'expires_at',pass.expires_at
    );
  end if;

  event_time := clock_timestamp();
  insert into public.gate_events(pass_id,leave_request_id,student_id,event_type,verified_by,outcome,idempotency_key,gate_location,remarks,created_at)
  values(pass.id,req.id,pass.student_id,case action_value when 'OUT' then 'exit' else 'entry' end,p_guard_id,'accepted',p_idempotency_key,
    nullif(trim(p_location),''),nullif(trim(p_remarks),''),event_time)
  returning * into event_rec;

  if action_value = 'OUT' then
    update public.student_presence set status='outside',active_leave_id=req.id,active_pass_id=pass.id,
      last_exit_at=event_time,expected_return_at=req.expected_return_at,last_event_id=event_rec.id,updated_at=event_time
      where student_id=pass.student_id;
    update public.gate_passes set status='used',exit_used_at=event_time,updated_at=event_time where id=pass.id;
  else
    update public.student_presence set status='inside',active_leave_id=null,active_pass_id=null,
      last_entry_at=event_time,last_event_id=event_rec.id,updated_at=event_time where student_id=pass.student_id;
    update public.gate_passes set status='completed',entry_used_at=event_time,updated_at=event_time where id=pass.id;
    update public.leave_requests set status='completed',updated_at=event_time where id=req.id;
    insert into public.leave_request_history(leave_request_id,previous_status,new_status,remarks,actor_user_id)
    values(req.id,req.status,'completed',case when event_time>req.expected_return_at then 'Returned after expected return time' else 'Returned on schedule' end,p_guard_id);
  end if;

  return jsonb_build_object('outcome','accepted','event_id',event_rec.id,'event_type',event_rec.event_type,
    'student_name',stu.full_name,'timestamp',event_time,
    'movement_status',case action_value when 'OUT' then 'outside' else 'inside' end,
    'is_late',action_value='IN' and event_time>req.expected_return_at);
end;
$$;
revoke all on function private.record_gate_movement(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function private.record_gate_movement(uuid,uuid,text,text,text,text,uuid) to service_role;
create or replace function public.record_gate_movement(
  p_guard_id uuid, p_pass_id uuid, p_token text, p_action text,
  p_location text default null, p_remarks text default null, p_idempotency_key uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_gate_movement(p_guard_id,p_pass_id,p_token,p_action,p_location,p_remarks,p_idempotency_key);
$$;
revoke all on function public.record_gate_movement(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.record_gate_movement(uuid,uuid,text,text,text,text,uuid) to service_role;

create or replace function private.record_gate_override(
  p_admin_id uuid, p_student_id uuid, p_leave_request_id uuid,
  p_event_type text, p_reason text, p_location text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare req public.leave_requests; pass public.gate_passes; presence public.student_presence; event_rec public.gate_events; stu public.students; now_at timestamptz;
begin
  if not exists (select 1 from public.profiles where id=p_admin_id and role='admin' and is_active) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if p_event_type not in ('exit','entry') or length(trim(coalesce(p_reason,''))) < 5 or length(trim(coalesce(p_reason,''))) > 500 then
    raise exception 'Valid movement type and override reason required';
  end if;
  select * into req from public.leave_requests where id=p_leave_request_id and student_id=p_student_id for update;
  if not found or req.status not in ('approved','overdue') or now() > req.expected_return_at + interval '4 hours' then
    raise exception 'An approved, unexpired leave request for this student is required';
  end if;
  if p_event_type='exit' and (req.status <> 'approved' or now() < req.departure_at - interval '2 hours' or now() > req.expected_return_at) then
    raise exception 'Approved departure window is not open';
  end if;
  select * into pass from public.gate_passes where leave_request_id=req.id for update;
  if not found or pass.status in ('revoked','expired','completed') or now()>pass.expires_at then
    raise exception 'A valid leave pass is required';
  end if;
  insert into public.student_presence(student_id,status) values(p_student_id,'inside') on conflict(student_id) do nothing;
  select * into presence from public.student_presence where student_id=p_student_id for update;
  if p_event_type='exit' and presence.status='outside' then raise exception 'Student is already recorded as outside'; end if;
  if p_event_type='entry' and (presence.status<>'outside' or presence.active_leave_id<>req.id or presence.active_pass_id<>pass.id) then
    raise exception 'Student is not outside on this leave request';
  end if;
  if p_event_type='exit' and pass.status<>'active' then raise exception 'Gate pass is not available for departure'; end if;
  now_at:=clock_timestamp();
  insert into public.gate_events(pass_id,leave_request_id,student_id,event_type,verified_by,outcome,is_manual_override,override_reason,gate_location,created_at)
  values(pass.id,req.id,p_student_id,p_event_type,p_admin_id,'accepted',true,trim(p_reason),nullif(trim(p_location),''),now_at)
  returning * into event_rec;
  select * into stu from public.students where id=p_student_id;
  if p_event_type='exit' then
    update public.student_presence set status='outside',active_leave_id=req.id,active_pass_id=pass.id,last_exit_at=now_at,
      expected_return_at=req.expected_return_at,last_event_id=event_rec.id,updated_at=now_at where student_id=p_student_id;
    update public.gate_passes set status='used',exit_used_at=now_at,updated_at=now_at where id=pass.id;
  else
    update public.student_presence set status='inside',active_leave_id=null,active_pass_id=null,last_entry_at=now_at,
      last_event_id=event_rec.id,updated_at=now_at where student_id=p_student_id;
    update public.gate_passes set status='completed',entry_used_at=now_at,updated_at=now_at where id=pass.id;
    update public.leave_requests set status='completed',updated_at=now_at where id=req.id;
    insert into public.leave_request_history(leave_request_id,previous_status,new_status,remarks,actor_user_id)
    values(req.id,req.status,'completed','Administrative gate correction: '||trim(p_reason),p_admin_id);
  end if;
  return jsonb_build_object('event_id',event_rec.id,'student_name',stu.full_name,'event_type',p_event_type,
    'timestamp',now_at,'movement_status',case p_event_type when 'exit' then 'outside' else 'inside' end);
end;
$$;
revoke all on function private.record_gate_override(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function private.record_gate_override(uuid,uuid,uuid,text,text,text) to service_role;
create or replace function public.record_gate_override(
  p_admin_id uuid, p_student_id uuid, p_leave_request_id uuid,
  p_event_type text, p_reason text, p_location text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.record_gate_override(p_admin_id,p_student_id,p_leave_request_id,p_event_type,p_reason,p_location);
$$;
revoke all on function public.record_gate_override(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_gate_override(uuid,uuid,uuid,text,text,text) to service_role;

commit;
