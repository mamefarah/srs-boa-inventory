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
  'Sole insert path for audit_events. No table-level INSERT grant is given to application roles.';

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
grant select, update (display_name) on public.profiles to authenticated;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_capability('admin.manage_users'));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_update_all on public.profiles
  for update to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

-- capabilities/roles/role_capabilities: readable reference data; admin-managed writes
grant select on public.capabilities to authenticated;
grant select on public.roles to authenticated;
grant select on public.role_capabilities to authenticated;
grant insert, update, delete on public.roles to authenticated;
grant insert, delete on public.role_capabilities to authenticated;

create policy capabilities_select_all on public.capabilities
  for select to authenticated
  using (true);

create policy roles_select_all on public.roles
  for select to authenticated
  using (true);

create policy roles_admin_write on public.roles
  for all to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

create policy role_capabilities_select_all on public.role_capabilities
  for select to authenticated
  using (true);

create policy role_capabilities_admin_write on public.role_capabilities
  for all to authenticated
  using (public.has_capability('admin.manage_users'))
  with check (public.has_capability('admin.manage_users'));

-- user_roles: self-read; admin-managed
grant select, insert, delete on public.user_roles to authenticated;

create policy user_roles_select_self_or_admin on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_capability('admin.manage_users'));

create policy user_roles_admin_write on public.user_roles
  for insert to authenticated
  with check (public.has_capability('admin.manage_users'));

create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated
  using (public.has_capability('admin.manage_users'));

-- warehouses: visible to users with explicit access, or master.manage/admin.manage_users
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

-- user_warehouse_access: self-read; admin/master.manage-managed
grant select, insert, delete on public.user_warehouse_access to authenticated;

create policy user_warehouse_access_select on public.user_warehouse_access
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_capability('master.manage')
    or public.has_capability('admin.manage_users')
  );

create policy user_warehouse_access_write on public.user_warehouse_access
  for insert to authenticated
  with check (public.has_capability('admin.manage_users'));

create policy user_warehouse_access_delete on public.user_warehouse_access
  for delete to authenticated
  using (public.has_capability('admin.manage_users'));

-- audit_events: read-only for admin/audit.read; no client INSERT/UPDATE/DELETE grant at all
grant select on public.audit_events to authenticated;

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.has_capability('audit.read') or public.has_capability('admin.manage_users'));

-- foundation_protected_demo: no direct client write grants; select limited to
-- creator/admin, purely so the fixture's own tests can observe what the RPC inserted
grant select on public.foundation_protected_demo to authenticated;

create policy foundation_protected_demo_select on public.foundation_protected_demo
  for select to authenticated
  using (created_by = auth.uid() or public.has_capability('admin.manage_users'));

-- explicit function grants (deny-by-default revoked all above; grant back narrowly)
grant execute on function public.has_capability(text) to authenticated;
grant execute on function public.has_warehouse_access(uuid) to authenticated;
grant execute on function public.my_capabilities() to authenticated;
grant execute on function public.my_warehouse_ids() to authenticated;
grant execute on function public.log_audit_event(text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.foundation_demo_create(text) to authenticated;

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
