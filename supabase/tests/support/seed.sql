-- TEST-ONLY deterministic fixture data. Applied as the superuser/table-owner connection,
-- which bypasses RLS by design (this is how migrations and trusted seed scripts run).

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'storeclerk@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'inactive@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'noaccess@example.test');

-- public.on_auth_user_created already created a profiles row for each user above (proof
-- the bootstrap trigger works); update those rows to the fixture's intended state rather
-- than inserting new ones.
update public.profiles set display_name = 'Test Admin'
  where id = '00000000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Test Store Clerk'
  where id = '00000000-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Test Inactive User', active = false
  where id = '00000000-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Test No-Access User'
  where id = '00000000-0000-0000-0000-000000000004';

insert into public.warehouses (id, code, name) values
  ('10000000-0000-0000-0000-000000000001', 'WH-1', 'Test Warehouse One'),
  ('10000000-0000-0000-0000-000000000002', 'WH-2', 'Test Warehouse Two');

insert into public.roles (id, key, label, description) values
  ('20000000-0000-0000-0000-000000000001', 'test_store_clerk', 'Test Store Clerk', 'Fixture role for RLS tests only.');

insert into public.role_capabilities (role_id, capability_key) values
  ('20000000-0000-0000-0000-000000000001', 'inventory.view'),
  ('20000000-0000-0000-0000-000000000001', 'inventory.receive');

insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-000000000001',
   (select id from public.roles where key = 'system_admin')),
  ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001');

insert into public.user_warehouse_access (user_id, warehouse_id) values
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
-- User 3 (inactive) has the same role and warehouse grant as user 2 (active), so any
-- test difference between them isolates the "active = true" gate specifically.
