-- Minimal stand-in for the parts of a Supabase project the migrations depend on, so the
-- security tests can run against plain Postgres. It deliberately reproduces Supabase's
-- permissive default grants: the migration has to be what locks things down.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
alter table auth.users owner to supabase_auth_admin;
grant all on auth.users to postgres;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
