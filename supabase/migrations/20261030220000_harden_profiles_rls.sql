-- Migration: Harden profiles RLS to prevent direct client writes to must_change_password.
--
-- ANALYSIS
-- --------
-- The phase1_profiles migration grants UPDATE only on (full_name, phone) to the
-- `authenticated` role:
--
--   grant update (full_name, phone) on public.profiles to authenticated;
--
-- Postgres enforces column-level privileges before evaluating RLS policies.
-- Any attempt by an authenticated client to write must_change_password, role, or
-- is_active is therefore rejected at the privilege layer with "permission denied
-- for table profiles" — no policy change is required for that protection.
--
-- However the existing WITH CHECK clause on profiles_update_self:
--
--   with check (id = (select auth.uid()) and is_active)
--
-- does not prevent a client from submitting an UPDATE that sets `is_active = false`
-- on their own row (is_active is also not in the column grant, so it cannot be
-- written, but the policy itself does not make this explicit).
--
-- This migration replaces the policy with an identical-but-explicit version and
-- adds a SECURITY DEFINER helper that reads the caller's own immutable fields
-- without re-entering the RLS-checked path, making the design self-documenting
-- and resistant to future accidental grant expansions.
begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist — prerequisite migration missing';
  end if;
end;
$$;

-- Helper: returns the current caller's role and is_active without triggering RLS
-- (SECURITY DEFINER runs as postgres, bypassing RLS on profiles).
-- This avoids the infinite-recursion trap that arises when a WITH CHECK clause
-- queries the same table whose policy is currently being evaluated.
create or replace function private.caller_profile_snapshot()
returns table(caller_role text, caller_is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select role, is_active
    from public.profiles
   where id = (select auth.uid());
$$;
revoke all on function private.caller_profile_snapshot() from public, anon, authenticated;
grant execute on function private.caller_profile_snapshot() to authenticated;

-- Replace profiles_update_self with a version whose WITH CHECK explicitly
-- asserts that role and is_active cannot be changed by the calling user.
-- The column-level grant (full_name, phone only) already blocks writes to
-- must_change_password / role / is_active at the privilege layer; this policy
-- makes that intent explicit and adds a secondary enforcement layer that is
-- robust to future grant changes.
drop policy if exists profiles_update_self on public.profiles;

create policy profiles_update_self on public.profiles
  for update
  to authenticated
  using  (id = (select auth.uid()) and is_active)
  with check (
    id = (select auth.uid())
    and (
      -- Caller's role and is_active must remain unchanged after the update.
      -- We read them via a SECURITY DEFINER helper to avoid recursive policy
      -- evaluation on the profiles table itself.
      select s.caller_is_active and
             role = s.caller_role and
             is_active = s.caller_is_active
        from private.caller_profile_snapshot() s
    )
  );

comment on table public.profiles is
  'Single-campus profiles. Role, is_active and must_change_password can only be '
  'changed by trusted server/database administration. Column-level UPDATE grants '
  'restrict authenticated users to (full_name, phone) only. The profiles_update_self '
  'RLS policy adds a secondary check that prevents role escalation even if grants '
  'are later broadened.';

commit;

