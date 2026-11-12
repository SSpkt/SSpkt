-- TrainerOps core schema, row-level security and server-side functions.
-- Safe to re-run: it adopts existing `profiles` / `workouts` tables and replaces their policies.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists role text not null default 'client';
alter table public.profiles add column if not exists trainer_id uuid;
alter table public.profiles add column if not exists invite_code text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

update public.profiles set role = 'client' where role is null or role::text not in ('client', 'trainer');
update public.profiles set full_name = left(coalesce(full_name, ''), 80)
where full_name is null or char_length(full_name) > 80;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_role_check check (role::text in ('client', 'trainer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_full_name_len' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_full_name_len check (char_length(full_name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_trainer_fk' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_trainer_fk
      foreign key (trainer_id) references public.profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_trainer_not_self' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_trainer_not_self check (trainer_id is null or trainer_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_invite_code_key' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_invite_code_key unique (invite_code);
  end if;
end $$;

create index if not exists profiles_trainer_id_idx on public.profiles (trainer_id);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  title text not null
);

alter table public.workouts add column if not exists notes text not null default '';
alter table public.workouts add column if not exists is_completed boolean not null default false;
alter table public.workouts add column if not exists completed_at timestamptz;
alter table public.workouts add column if not exists created_at timestamptz not null default now();
alter table public.workouts add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_title_len' and conrelid = 'public.workouts'::regclass) then
    alter table public.workouts add constraint workouts_title_len
      check (char_length(btrim(title)) between 1 and 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workouts_notes_len' and conrelid = 'public.workouts'::regclass) then
    alter table public.workouts add constraint workouts_notes_len check (char_length(notes) <= 4000) not valid;
  end if;
end $$;

create index if not exists workouts_client_created_idx on public.workouts (client_id, created_at desc);
create index if not exists workouts_trainer_client_idx on public.workouts (trainer_id, client_id);

-- Billing state. Written only by the Stripe webhook (service role); users can read their own row.
create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists private.join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on private.join_attempts (user_id, attempted_at);

-- ---------------------------------------------------------------------------
-- Helper functions (private schema is not exposed through the API)
-- ---------------------------------------------------------------------------

create or replace function private.free_client_limit()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function private.is_trainer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role::text = 'trainer'
  );
$$;

create or replace function private.my_trainer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select trainer_id from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_my_client(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = target and role::text = 'client' and trainer_id = (select auth.uid())
  );
$$;

create or replace function private.my_client_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles
  where trainer_id = (select auth.uid()) and role::text = 'client';
$$;

create or replace function private.has_pro(trainer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = trainer and status in ('active', 'trialing')
  );
$$;

create or replace function private.new_invite_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  loop
    -- First 10 hex digits of a v4 UUID are all random: 40 bits from the server CSPRNG.
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.profiles where invite_code = v_code);
  end loop;
  return v_code;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Auto-provision a profile from auth.users metadata. The role is whitelisted here; anything
-- other than an explicit 'trainer' becomes a client.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text := case when new.raw_user_meta_data ->> 'role' = 'trainer' then 'trainer' else 'client' end;
  v_name text := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[[:cntrl:]]', '', 'g')), 80);
begin
  insert into public.profiles (id, email, full_name, role, invite_code)
  values (
    new.id, new.email, v_name, v_role,
    case when v_role = 'trainer' then private.new_invite_code() end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function private.touch_updated_at();

-- Clients may only flip is_completed; completed_at is always set by the server.
create or replace function private.workouts_before_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and v_uid = old.client_id and v_uid <> old.trainer_id then
    if new.title is distinct from old.title or new.notes is distinct from old.notes then
      raise exception 'Clients can only mark workouts complete' using errcode = '42501';
    end if;
  end if;

  if new.is_completed is distinct from old.is_completed then
    new.completed_at := case when new.is_completed then now() end;
  else
    new.completed_at := old.completed_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists workouts_before_update on public.workouts;
create trigger workouts_before_update
  before update on public.workouts
  for each row execute function private.workouts_before_update();

-- ---------------------------------------------------------------------------
-- RPC functions (the only way to change who is linked to whom)
-- ---------------------------------------------------------------------------

create or replace function public.join_trainer(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_me public.profiles%rowtype;
  v_trainer public.profiles%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_attempts integer;
  v_clients integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_me from public.profiles where id = v_uid for update;
  if not found or v_me.role::text <> 'client' then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_CLIENT');
  end if;
  if v_me.trainer_id is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
  end if;

  delete from private.join_attempts where user_id = v_uid and attempted_at <= now() - interval '1 hour';
  select count(*) into v_attempts from private.join_attempts
  where user_id = v_uid and attempted_at > now() - interval '1 hour';
  if v_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  -- Locking the trainer row serialises concurrent joins so the capacity check cannot be raced.
  select * into v_trainer from public.profiles
  where invite_code = v_code and role::text = 'trainer' and char_length(v_code) > 0
  for update;
  if not found then
    insert into private.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if not private.has_pro(v_trainer.id) then
    select count(*) into v_clients from public.profiles where trainer_id = v_trainer.id;
    if v_clients >= private.free_client_limit() then
      return jsonb_build_object('ok', false, 'error', 'TRAINER_AT_CAPACITY');
    end if;
  end if;

  update public.profiles set trainer_id = v_trainer.id where id = v_uid;
  delete from private.join_attempts where user_id = v_uid;
  return jsonb_build_object('ok', true, 'trainer_name', v_trainer.full_name);
end $$;

create or replace function public.leave_trainer()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.profiles set trainer_id = null where id = (select auth.uid());
end $$;

create or replace function public.remove_client(p_client_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.profiles set trainer_id = null
  where id = p_client_id and trainer_id = (select auth.uid());
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

create or replace function public.regenerate_invite_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.profiles set invite_code = private.new_invite_code()
  where id = (select auth.uid()) and role::text = 'trainer'
  returning invite_code into v_code;
  if v_code is null then
    raise exception 'Only trainers have invite codes' using errcode = '42501';
  end if;
  return v_code;
end $$;

create or replace function public.my_plan()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.subscriptions%rowtype;
  v_pro boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where user_id = v_uid;
  v_pro := private.has_pro(v_uid);
  return jsonb_build_object(
    'plan', case when v_pro then 'pro' else 'free' end,
    'status', coalesce(v_sub.status, 'inactive'),
    'client_count', (select count(*) from public.profiles where trainer_id = v_uid),
    'client_limit', case when v_pro then null else private.free_client_limit() end,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false)
  );
end $$;

-- In-app account deletion (required by both app stores). Refuses while a paid subscription
-- is still running so nobody keeps being billed for an account that no longer exists.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.subscriptions
    where user_id = v_uid and status in ('active', 'trialing', 'past_due', 'unpaid')
  ) then
    raise exception 'ACTIVE_SUBSCRIPTION' using errcode = 'P0001';
  end if;
  delete from auth.users where id = v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workouts enable row level security;
alter table public.subscriptions enable row level security;
alter table private.join_attempts enable row level security;

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('profiles', 'workouts', 'subscriptions')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_my_clients on public.profiles
  for select to authenticated
  using (trainer_id = (select auth.uid()) and role::text = 'client');

create policy profiles_select_my_trainer on public.profiles
  for select to authenticated
  using (id = (select private.my_trainer_id()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- A trainer's access to a client's workouts lasts only while the two are linked. Because
-- UPDATE and DELETE can only touch rows the caller can SELECT, unlinking cuts those off too.
create policy workouts_select_participant on public.workouts
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or (trainer_id = (select auth.uid()) and client_id in (select private.my_client_ids()))
  );

create policy workouts_insert_trainer on public.workouts
  for insert to authenticated
  with check (
    trainer_id = (select auth.uid())
    and (select private.is_trainer())
    and private.is_my_client(client_id)
  );

create policy workouts_update_trainer on public.workouts
  for update to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create policy workouts_update_client on public.workouts
  for update to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

create policy workouts_delete_trainer on public.workouts
  for delete to authenticated
  using (trainer_id = (select auth.uid()));

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, grant the minimum, column by column
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.workouts, public.subscriptions from public, anon, authenticated;
revoke all on private.join_attempts from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, delete on public.workouts to authenticated;
grant insert (trainer_id, client_id, title, notes) on public.workouts to authenticated;
grant update (title, notes, is_completed) on public.workouts to authenticated;

grant select on public.subscriptions to authenticated;

grant all on public.profiles, public.workouts, public.subscriptions to service_role;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_trainer(), private.my_trainer_id(), private.is_my_client(uuid), private.my_client_ids()
to authenticated;

revoke all on function
  public.handle_new_user(),
  public.handle_user_email_change(),
  public.join_trainer(text),
  public.leave_trainer(),
  public.remove_client(uuid),
  public.regenerate_invite_code(),
  public.my_plan(),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.join_trainer(text),
  public.leave_trainer(),
  public.remove_client(uuid),
  public.regenerate_invite_code(),
  public.my_plan(),
  public.delete_my_account()
to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill for projects that already have users
-- ---------------------------------------------------------------------------

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  left(btrim(regexp_replace(coalesce(u.raw_user_meta_data ->> 'full_name', ''), '[[:cntrl:]]', '', 'g')), 80),
  case when u.raw_user_meta_data ->> 'role' = 'trainer' then 'trainer' else 'client' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set invite_code = private.new_invite_code()
where role::text = 'trainer' and invite_code is null;
