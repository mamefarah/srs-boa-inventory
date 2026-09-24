-- M1 Slice 1: identity, capability-based authorization, warehouse scope, audit foundation.
--
-- Policy-independent by design: capability keys are technical identifiers, not resolved
-- Bureau approval/signatory authorities. HB-1, HB-3, HB-4, HB-5, HB-6, HB-7, HB-8 remain
-- open (docs/M0_BLOCKER_MATRIX.md, docs/M1_POLICY_GATE.md) and nothing here encodes a real
-- Bureau title, signatory, threshold or workflow decision that depends on them.
--
-- This migration assumes it runs inside a Supabase project, where the `auth` schema,
-- `auth.users` and `auth.uid()` already exist and are managed by Supabase Auth. It must
-- never create or modify objects in the `auth` schema itself.
--
-- Rollback / forward-fix policy: this is the first migration in the project (no prior
-- state to preserve), so a local/dev environment can be rolled back by resetting the
-- database and not reapplying it. Once this migration has been applied to any shared
-- (staging/production) environment, never edit this file — ship a new, later-numbered
-- migration that alters or reverses the affected objects instead (expand/contract).
--
-- Status as of the M1 REDTEAM correction pass: this is still the only file in
-- supabase/migrations/ and has only ever been applied to ephemeral CI/local scratch
-- databases (supabase/tests/run.sh), never to a real Supabase project — per CLAUDE.md's
-- CI/CD policy, production deployment/database changes are a separate, explicit human
-- gate this session never crossed. In-place edits to this file remain safe under the
-- policy above until that changes.

-- ── profiles ────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Minimal policy-independent user profile. Does not encode unresolved Bureau approval titles (HB-4).';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ── capabilities & roles (technical, not Bureau signatory authority) ─────────────────
create table public.capabilities (
  key text primary key,
  description text not null
);

comment on table public.capabilities is
  'Technical capability keys only. Never map a Bureau-specific title/threshold here — that is HB-4/HB-5/HB-6/HB-7, still open.';

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.role_capabilities (
  role_id uuid not null references public.roles (id) on delete cascade,
  capability_key text not null references public.capabilities (key) on delete restrict,
  primary key (role_id, capability_key)
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- ── warehouses (master-data skeleton; M0 SAFE DEFAULT, not full master data) ─────────
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_warehouse_access (
  user_id uuid not null references public.profiles (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (user_id, warehouse_id)
);

-- ── audit foundation (append-only) ────────────────────────────────────────────────────
create table public.audit_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_user_id uuid references public.profiles (id),
  target_table text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only. No UPDATE/DELETE grant to any application role. Insert only via public.log_audit_event().';

-- ── non-business fixture proving the privileged-mutation pattern ─────────────────────
create table public.foundation_protected_demo (
  id bigint generated always as identity primary key,
  note text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.foundation_protected_demo is
  'Non-business fixture only. Proves RLS blocks direct writes and a SECURITY DEFINER RPC is the sole mutation path, ahead of real inventory posting functions (blocked pending M0 evidence). Never used for inventory workflows.';

-- ── helper functions (SECURITY DEFINER; each reads only auth.uid()''s own data) ──────
create or replace function public.current_profile_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_capabilities rc on rc.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and rc.capability_key = p_capability_key
      and p.active = true
  );
$$;

comment on function public.has_capability(text) is
  'Checks only the calling user''s own grants (auth.uid()); cannot be used to query another user''s capabilities.';

create or replace function public.has_warehouse_access(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_warehouse_access uwa
    join public.profiles p on p.id = uwa.user_id
    where uwa.user_id = auth.uid()
      and uwa.warehouse_id = p_warehouse_id
      and p.active = true
  );
$$;

create or replace function public.my_capabilities()
returns table (capability_key text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct rc.capability_key
  from public.user_roles ur
  join public.role_capabilities rc on rc.role_id = ur.role_id
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid()
    and p.active = true;
$$;

comment on function public.my_capabilities() is
  'Returns only the calling user''s own capability keys. Used by the app to render/gate UI; server/RLS checks still use has_capability() independently.';

create or replace function public.my_warehouse_ids()
returns table (warehouse_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select uwa.warehouse_id
  from public.user_warehouse_access uwa
  join public.profiles p on p.id = uwa.user_id
  where uwa.user_id = auth.uid()
    and p.active = true;
$$;

create or replace function public.log_audit_event(
  p_event_type text,
  p_target_table text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default auth.uid()
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.audit_events (event_type, actor_user_id, target_table, target_id, metadata)
  values (p_event_type, p_actor_user_id, p_target_table, p_target_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_audit_event(text, text, text, jsonb, uuid) is
  'Sole insert path for audit_events. Internal-only: must never be granted EXECUTE to '
  'anon/authenticated, since p_actor_user_id is caller-suppliable and unchecked. Only '
  'other SECURITY DEFINER functions/triggers owned by this migration''s applying role may '
  'call it (they run as that owner and need no separate EXECUTE grant to do so).';

create or replace function public.foundation_demo_create(p_note text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.current_profile_active() then
    raise exception 'inactive or unknown user' using errcode = '28000';
  end if;

  insert into public.foundation_protected_demo (note, created_by)
  values (p_note, auth.uid())
  returning id into v_id;

  perform public.log_audit_event(
    'foundation_demo.create',
    'foundation_protected_demo',
    v_id::text,
    jsonb_build_object('note', p_note)
  );

  return v_id;
end;
$$;

comment on function public.foundation_demo_create(text) is
  'Non-business fixture RPC. Sole mutation path for foundation_protected_demo; proves the privileged-mutation pattern only.';

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_capability('admin.manage_users') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  update public.profiles
  set active = p_active
  where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  perform public.log_audit_event(
    'admin.user_active_changed',
    'profiles',
    p_user_id::text,
    jsonb_build_object('active', p_active)
  );
end;
$$;

comment on function public.set_user_active(uuid, boolean) is
  'Sole path to change profiles.active. Requires admin.manage_users. The authenticated-role '
  'column grant on profiles deliberately covers only display_name (never active), so a '
  'self-update can never reactivate/deactivate the caller''s own row — this RPC is the only '
  'route, and it is gated on the caller''s own current grants via has_capability().';

-- ── new-user bootstrap trigger ────────────────────────────────────────────────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email, 'New User'),
    true
  );

  perform public.log_audit_event('auth.user_created', 'profiles', new.id::text, '{}'::jsonb, new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ── row level security: deny by default, explicit grants only ───────────────────────
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.capabilities enable row level security;
alter table public.capabilities force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.role_capabilities enable row level security;
alter table public.role_capabilities force row level security;
alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;
alter table public.warehouses enable row level security;
alter table public.warehouses force row level security;
alter table public.user_warehouse_access enable row level security;
alter table public.user_warehouse_access force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.foundation_protected_demo enable row level security;
alter table public.foundation_protected_demo force row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public;

-- profiles: read/update own row; admin.manage_users may read/manage all rows
-- Inactive-user fail-closed: a deactivated user's own row-ownership (id = auth.uid())
-- does not by itself grant read/update here — `active = true` is required in addition,
-- same as every other self-access policy below. No exception is made for a deactivated
-- user to read their own row: frontend/src/lib/auth/session.ts already treats "no
-- profile row returned" and "profile row returned with active = false" identically
-- (both collapse to a null session), so denying the row entirely changes nothing for the
-- app's behavior while closing the direct-API-access gap. See
-- docs/ADR/0003-capability-based-authorization-foundation.md, "Inactive-user fail-closed
-- read policy" for the full rationale. An admin (whose own active status already gates
-- has_capability()) can still read/manage any row, active or not — required to manage
-- and reactivate deactivated users.
grant select, update (display_name) on public.profiles to authenticated;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using ((id = auth.uid() and active = true) or public.has_capability('admin.manage_users'));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and active = true)
  with check (id = auth.uid() and active = true);

create policy profiles_admin_update_all on public.profiles
  for update to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

-- capabilities/roles/role_capabilities: readable reference data; admin-managed writes.
-- Inactive-user fail-closed: reference-data reads require the caller to be an active
-- profile (public.current_profile_active()), not just any authenticated role member.
-- These were previously `using (true)` — readable by any authenticated session
-- regardless of profiles.active — which is not a genuine requirement: nothing in this
-- app reads capabilities/roles/role_capabilities before/without an active session (see
-- ADR-0003 "Inactive-user fail-closed read policy"), so there is no exception to
-- justify and the safer default applies.
grant select on public.capabilities to authenticated;
grant select on public.roles to authenticated;
grant select on public.role_capabilities to authenticated;
grant insert, update, delete on public.roles to authenticated;
grant insert, delete on public.role_capabilities to authenticated;

create policy capabilities_select_all on public.capabilities
  for select to authenticated
  using (public.current_profile_active());

create policy roles_select_all on public.roles
  for select to authenticated
  using (public.current_profile_active());

create policy roles_admin_write on public.roles
  for all to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

create policy role_capabilities_select_all on public.role_capabilities
  for select to authenticated
  using (public.current_profile_active());

create policy role_capabilities_admin_write on public.role_capabilities
  for all to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

-- user_roles: self-read; admin-managed.
-- Inactive-user fail-closed: self-read requires current_profile_active(), not just row
-- ownership, so a deactivated user cannot see which role(s) they were assigned even
-- though has_capability()/my_capabilities() already treat those grants as functionally
-- inert for them — this closes the direct-table-read gap to match that functional
-- reality. Admin write/delete already implicitly requires the admin's own active status
-- via has_capability() and is intentionally NOT gated on the *target* user's active
-- status, since admins must manage a deactivated user's role assignments too.
grant select, insert, delete on public.user_roles to authenticated;

create policy user_roles_select_self_or_admin on public.user_roles
  for select to authenticated
  using (
    (user_id = auth.uid() and public.current_profile_active())
    or public.has_capability('admin.manage_users')
  );

create policy user_roles_admin_write on public.user_roles
  for insert to authenticated
  with check (public.has_capability('admin.manage_users'));

create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated
  using (public.has_capability('admin.manage_users'));

-- warehouses: visible to users with explicit access, or master.manage/admin.manage_users.
-- Already inactive-user fail-closed without further change: has_warehouse_access() and
-- has_capability() both filter `p.active = true` internally (see their definitions
-- above), so this policy needs no separate active check.
grant select, insert, update, delete on public.warehouses to authenticated;

create policy warehouses_select_scoped on public.warehouses
  for select to authenticated
  using (
    public.has_warehouse_access(id)
    or public.has_capability('master.manage')
    or public.has_capability('admin.manage_users')
  );

create policy warehouses_manage on public.warehouses
  for insert to authenticated
  with check (public.has_capability('master.manage'));

create policy warehouses_update on public.warehouses
  for update to authenticated
  using (public.has_capability('master.manage'))
  with check (public.has_capability('master.manage'));

create policy warehouses_delete on public.warehouses
  for delete to authenticated
  using (public.has_capability('master.manage'));

-- user_warehouse_access: self-read; admin/master.manage-managed.
-- Inactive-user fail-closed: same reasoning as user_roles above — self-read requires
-- current_profile_active() in addition to row ownership.
grant select, insert, delete on public.user_warehouse_access to authenticated;

create policy user_warehouse_access_select on public.user_warehouse_access
  for select to authenticated
  using (
    (user_id = auth.uid() and public.current_profile_active())
    or public.has_capability('master.manage')
    or public.has_capability('admin.manage_users')
  );

create policy user_warehouse_access_write on public.user_warehouse_access
  for insert to authenticated
  with check (public.has_capability('admin.manage_users'));

create policy user_warehouse_access_delete on public.user_warehouse_access
  for delete to authenticated
  using (public.has_capability('admin.manage_users'));

-- audit_events: read-only for admin/audit.read; no client INSERT/UPDATE/DELETE grant at all.
-- Already inactive-user fail-closed without further change: has_capability() filters
-- `p.active = true` internally, so this policy needs no separate active check.
grant select on public.audit_events to authenticated;

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.has_capability('audit.read') or public.has_capability('admin.manage_users'));

-- foundation_protected_demo: no direct client write grants; select limited to
-- creator/admin, purely so the fixture's own tests can observe what the RPC inserted.
-- Inactive-user fail-closed: same reasoning as user_roles/user_warehouse_access above —
-- a deactivated user cannot read rows they created while active.
grant select on public.foundation_protected_demo to authenticated;

create policy foundation_protected_demo_select on public.foundation_protected_demo
  for select to authenticated
  using (
    (created_by = auth.uid() and public.current_profile_active())
    or public.has_capability('admin.manage_users')
  );

-- explicit function grants (deny-by-default revoked all above; grant back narrowly)
-- Note: log_audit_event() is deliberately NOT granted to authenticated/anon. It takes an
-- unchecked, caller-suppliable actor id, so a direct client grant would let any
-- authenticated user forge audit_events rows attributed to another user. It is called
-- only from inside other SECURITY DEFINER functions/triggers, which need no separate
-- EXECUTE grant since they already run as the owning role.
-- current_profile_active() is now also referenced directly inside RLS USING clauses
-- (capabilities/roles/role_capabilities reference-data reads), so the `authenticated`
-- role needs EXECUTE on it directly, not only the implicit access it already had as a
-- nested call from within foundation_demo_create()'s SECURITY DEFINER body.
grant execute on function public.current_profile_active() to authenticated;
grant execute on function public.has_capability(text) to authenticated;
grant execute on function public.has_warehouse_access(uuid) to authenticated;
grant execute on function public.my_capabilities() to authenticated;
grant execute on function public.my_warehouse_ids() to authenticated;
grant execute on function public.foundation_demo_create(text) to authenticated;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

-- ── seed data: exactly one bootstrap role, no Bureau-specific titles/thresholds ──────
insert into public.capabilities (key, description) values
  ('inventory.view', 'View inventory positions and documents'),
  ('inventory.receive', 'Create/process goods-receipt documents'),
  ('inventory.issue', 'Post stock issue'),
  ('inventory.transfer', 'Dispatch/receive warehouse transfers'),
  ('inventory.count', 'Participate in or submit physical counts'),
  ('inventory.adjust', 'Submit stock adjustments'),
  ('inventory.approve', 'Approve configured inventory actions'),
  ('master.manage', 'Manage master data (items, warehouses, etc.)'),
  ('reports.view', 'View reports'),
  ('admin.manage_users', 'Manage users, roles and capability grants'),
  ('audit.read', 'Read audit event history');

insert into public.roles (key, label, description) values (
  'system_admin',
  'System Administrator',
  'Configuration-only bootstrap role. Per docs/ROLES_PERMISSIONS.md this role manages users/configuration and does not automatically approve inventory transactions.'
);

insert into public.role_capabilities (role_id, capability_key)
select id, 'admin.manage_users' from public.roles where key = 'system_admin';
