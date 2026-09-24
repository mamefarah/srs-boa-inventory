-- TEST-ONLY scaffolding that stands in for Supabase-managed `auth` schema objects, so
-- migrations can be exercised against a plain local PostgreSQL instance.
--
-- Never apply this file to a real Supabase project: `auth.users`, `auth.uid()` and the
-- `anon`/`authenticated` roles already exist there, managed by Supabase Auth/PostgREST.
-- This file exists only so supabase/tests/*.test.mjs can prove the RLS/authorization
-- behavior in supabase/migrations/*.sql without a live Supabase project.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's own auth.uid() definition: reads the JWT `sub` claim that
-- PostgREST sets as a per-request Postgres setting after verifying the JWT.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- Mirrors the two non-superuser Postgres roles PostgREST switches to per request.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
