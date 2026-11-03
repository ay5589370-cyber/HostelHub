begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100),
  email text not null check (char_length(email) <= 320),
  role text not null default 'student' check (role in ('admin', 'student', 'warden')),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  phone text check (phone is null or char_length(phone) <= 30),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);
create index profiles_created_at_idx on public.profiles (created_at desc);

-- Owned by the migration's trusted postgres role. Never use an exposed schema here.
-- No caller-supplied user id; the caller can only check their own active admin status.
create function private.is_active_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and is_active
  );
$$;
revoke all on function private.is_active_admin() from public, anon, authenticated;
grant execute on function private.is_active_admin() to authenticated;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
revoke all on function private.set_updated_at() from public, anon, authenticated;
create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

-- All users start as students. User-supplied metadata can NEVER set a role.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data->>'full_name', ''),100), 'student');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- Auth remains the source of truth for email, including future trusted email changes.
create function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin update public.profiles set email = new.email where id = new.id; return new; end; $$;
revoke all on function private.sync_user_email() from public, anon, authenticated;
create trigger on_auth_email_updated after update of email on auth.users
for each row when (old.email is distinct from new.email) execute function private.sync_user_email();

-- Safely backfill email/password users created before this migration; never infer admins.
insert into public.profiles (id, email, full_name)
select id, email, left(coalesce(raw_user_meta_data->>'full_name',''),100)
from auth.users where email is not null on conflict (id) do nothing;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy profiles_read_self on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles for select to authenticated
using ((select private.is_active_admin()));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid()) and is_active)
with check (id = (select auth.uid()) and is_active);

comment on table public.profiles is 'Single-campus profiles. Role and active status can only be changed by trusted server/database administration.';
commit;
