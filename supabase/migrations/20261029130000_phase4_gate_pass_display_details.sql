-- Return only the additional display fields needed by the pass card.
-- The existing private issuer still enforces ownership and approved status.
create or replace function public.get_or_create_gate_pass(p_leave_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pass_data jsonb;
  pass_room text;
  pass_type text;
begin
  pass_data := private.get_or_create_gate_pass(p_leave_request_id);

  select lr.leave_type, r.room_number
    into pass_type, pass_room
  from public.leave_requests lr
  left join public.bed_allocations a
    on a.student_id = lr.student_id and a.status = 'active'
  left join public.beds b on b.id = a.bed_id
  left join public.rooms r on r.id = b.room_id
  where lr.id = p_leave_request_id;

  return pass_data || jsonb_build_object(
    'leave_type', pass_type,
    'room_number', pass_room
  );
end;
$$;

revoke all on function public.get_or_create_gate_pass(uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_gate_pass(uuid) to authenticated;
