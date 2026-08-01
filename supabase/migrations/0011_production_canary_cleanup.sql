-- 0011_production_canary_cleanup.sql — narrowly scoped production canary lifecycle.

create or replace function public.create_canary_circle(
  p_circle_id uuid,
  p_run_id text
)
returns public.circles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle public.circles;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_circle_id is null or p_run_id is null or p_run_id !~ '^[0-9a-f]{16}$' then
    raise exception using errcode = '22023', message = 'invalid canary creation request';
  end if;

  insert into public.circles (
    id, name, description, default_currency, created_by
  ) values (
    p_circle_id, 'AA-CANARY-' || p_run_id, 'production-canary:' || p_run_id, 'CNY', v_uid
  )
  on conflict (id) do nothing;

  select circle.*
  into v_circle
  from public.circles circle
  where circle.id = p_circle_id
    and circle.created_by = v_uid
    and circle.name = 'AA-CANARY-' || p_run_id
    and circle.description = 'production-canary:' || p_run_id
    and circle.default_currency = 'CNY'
    and circle.created_at >= clock_timestamp() - interval '2 hours'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'canary circle identity is not eligible';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (p_circle_id, v_uid, 'owner')
  on conflict (circle_id, user_id) do nothing;

  if not exists (
    select 1
    from public.circle_members member
    where member.circle_id = p_circle_id
      and member.user_id = v_uid
      and member.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'canary circle owner is invalid';
  end if;

  return v_circle;
end;
$$;

create or replace function public.cleanup_canary_circle(
  p_circle_id uuid,
  p_run_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted uuid;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_circle_id is null or p_run_id is null or p_run_id !~ '^[0-9a-f]{16}$' then
    raise exception using errcode = '22023', message = 'invalid canary cleanup request';
  end if;

  perform 1
  from public.circles circle
  where circle.id = p_circle_id
    and circle.created_by = v_uid
    and circle.name = 'AA-CANARY-' || p_run_id
    and circle.description = 'production-canary:' || p_run_id
    and circle.created_at >= clock_timestamp() - interval '2 hours'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'canary circle is not eligible for cleanup';
  end if;

  if not exists (
    select 1
    from public.circle_members member
    where member.circle_id = p_circle_id
      and member.user_id = v_uid
      and member.role = 'owner'
  ) or (
    select count(*)
    from public.circle_members member
    where member.circle_id = p_circle_id
  ) not between 1 and 2 or exists (
    select 1
    from public.circle_members member
    where member.circle_id = p_circle_id
      and member.user_id <> v_uid
      and member.role <> 'member'
  ) then
    raise exception using errcode = '42501', message = 'canary circle membership is not eligible for cleanup';
  end if;

  delete from public.circles circle
  where circle.id = p_circle_id
  returning circle.id into v_deleted;

  return v_deleted = p_circle_id;
end;
$$;

revoke all privileges on function public.create_canary_circle(uuid, text)
  from public, anon, authenticated;
revoke all privileges on function public.cleanup_canary_circle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_canary_circle(uuid, text)
  to authenticated, service_role;
grant execute on function public.cleanup_canary_circle(uuid, text)
  to authenticated, service_role;

alter default privileges in schema public revoke all on functions from public, anon, authenticated;
