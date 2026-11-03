-- Keep the server-side token digest out of all authenticated client queries.
-- Gate RPCs run as security-definer functions and retain access to the hash.
begin;

revoke select on public.gate_passes from authenticated;
grant select (
  id,
  leave_request_id,
  student_id,
  pass_code,
  issued_at,
  expires_at,
  status,
  exit_used_at,
  entry_used_at,
  revoked_at,
  revocation_reason,
  revoked_by,
  created_at,
  updated_at
) on public.gate_passes to authenticated;

commit;
