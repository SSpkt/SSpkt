-- Keep each trainer's invite code private to that trainer.
--
-- Before this, a linked client could read their trainer's whole profile row, including
-- invite_code, and pass it on so strangers could join and use up the trainer's free client
-- slots. Row-level security cannot hide a single column, so signed-in users now get SELECT
-- on every profile column except invite_code, and a trainer reads their own code through
-- public.my_invite_code(). Safe to re-run.

revoke select on public.profiles from authenticated;
grant select (id, email, full_name, role, trainer_id, created_at, updated_at)
  on public.profiles to authenticated;

create or replace function public.my_invite_code()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select invite_code into v_code from public.profiles
  where id = (select auth.uid()) and role::text = 'trainer';
  return v_code;
end $$;

revoke all on function public.my_invite_code() from public, anon, authenticated;
grant execute on function public.my_invite_code() to authenticated;
