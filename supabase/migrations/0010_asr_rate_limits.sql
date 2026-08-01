-- 0010_asr_rate_limits.sql — atomic per-user cloud-ASR quotas.

create table public.asr_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index asr_usage_user_requested_idx
  on public.asr_usage (user_id, requested_at desc);

alter table public.asr_usage enable row level security;
revoke all on public.asr_usage from public, anon, authenticated;

create or replace function public.consume_asr_quota()
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining_ten_minutes integer,
  remaining_today integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_window_count integer;
  v_daily_count integer;
  v_retry integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1094795603));

  select count(*)::integer
  into v_window_count
  from public.asr_usage
  where user_id = v_uid
    and requested_at > v_now - interval '10 minutes';

  select count(*)::integer
  into v_daily_count
  from public.asr_usage
  where user_id = v_uid
    and requested_at >= date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  if v_window_count >= 10 then
    select greatest(
      1,
      ceil(extract(epoch from (min(requested_at) + interval '10 minutes' - v_now)))::integer
    )
    into v_retry
    from public.asr_usage
    where user_id = v_uid
      and requested_at > v_now - interval '10 minutes';

    return query select false, v_retry, 0, greatest(0, 50 - v_daily_count);
    return;
  end if;

  if v_daily_count >= 50 then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (
        (date_trunc('day', v_now at time zone 'UTC') + interval '1 day') at time zone 'UTC' - v_now
      )))::integer
    );
    return query select false, v_retry, greatest(0, 10 - v_window_count), 0;
    return;
  end if;

  insert into public.asr_usage (user_id, requested_at)
  values (v_uid, v_now);

  return query select true, 0, 9 - v_window_count, 49 - v_daily_count;
end;
$$;

revoke all privileges on function public.consume_asr_quota() from public, anon, authenticated;
grant execute on function public.consume_asr_quota() to authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
