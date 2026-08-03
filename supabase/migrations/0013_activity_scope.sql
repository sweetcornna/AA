-- 0013_activity_scope.sql — scoped, RLS-governed activity feed.

create index idx_activity_expenses_circle_created
  on public.expenses(circle_id, created_at desc, id desc);
create index idx_activity_expenses_payer_created
  on public.expenses(payer_id, created_at desc, id desc);
create index idx_activity_expenses_creator_created
  on public.expenses(created_by, created_at desc, id desc);
create index idx_activity_splits_user_expense
  on public.expense_splits(user_id, expense_id) include (owed_minor);
create index idx_activity_settlements_circle_settled
  on public.settlements(circle_id, settled_at desc, id desc);
create index idx_activity_settlements_from_settled
  on public.settlements(from_user, settled_at desc, id desc);
create index idx_activity_settlements_to_settled
  on public.settlements(to_user, settled_at desc, id desc);
create index idx_activity_settlements_creator_settled
  on public.settlements(created_by, settled_at desc, id desc);

create or replace function public.list_activity(
  p_scope text default 'all',
  p_limit integer default 25
)
returns table (
  kind text,
  id uuid,
  circle_id uuid,
  circle_name text,
  occurred_at timestamptz,
  amount_minor bigint,
  currency text,
  description text,
  category text,
  creator_id uuid,
  creator_name text,
  payer_id uuid,
  payer_name text,
  my_owed_minor bigint,
  from_user uuid,
  from_name text,
  to_user uuid,
  to_name text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_scope is null or p_scope not in ('all', 'mine') then
    raise exception using errcode = '22023', message = 'activity scope must be all or mine';
  end if;
  if p_limit is null then
    raise exception using errcode = '22023', message = 'activity limit is required';
  end if;

  v_limit := least(greatest(p_limit, 1), 100);

  return query
  with viewer_circles as materialized (
    select member.circle_id
    from public.circle_members as member
    where member.user_id = v_uid
  ),
  expense_events as (
    select
      'expense'::text as kind,
      expense.id,
      expense.circle_id,
      circle.name as circle_name,
      expense.created_at as occurred_at,
      expense.amount_minor,
      expense.currency::text,
      expense.description,
      expense.category,
      expense.created_by as creator_id,
      creator.display_name as creator_name,
      expense.payer_id,
      payer.display_name as payer_name,
      my_split.owed_minor as my_owed_minor,
      null::uuid as from_user,
      null::text as from_name,
      null::uuid as to_user,
      null::text as to_name
    from viewer_circles
    join public.expenses as expense on expense.circle_id = viewer_circles.circle_id
    join public.circles as circle on circle.id = expense.circle_id
    left join public.profiles as creator on creator.id = expense.created_by
    left join public.profiles as payer on payer.id = expense.payer_id
    left join lateral (
      select split.owed_minor
      from public.expense_splits as split
      where split.expense_id = expense.id
        and split.user_id = v_uid
      limit 1
    ) as my_split on true
    where p_scope = 'all'
      or expense.payer_id = v_uid
      or expense.created_by = v_uid
      or my_split.owed_minor is not null
  ),
  settlement_events as (
    select
      'settlement'::text as kind,
      settlement.id,
      settlement.circle_id,
      circle.name as circle_name,
      settlement.settled_at as occurred_at,
      settlement.amount_minor,
      settlement.currency::text,
      null::text as description,
      null::text as category,
      settlement.created_by as creator_id,
      creator.display_name as creator_name,
      null::uuid as payer_id,
      null::text as payer_name,
      null::bigint as my_owed_minor,
      settlement.from_user,
      sender.display_name as from_name,
      settlement.to_user,
      recipient.display_name as to_name
    from viewer_circles
    join public.settlements as settlement on settlement.circle_id = viewer_circles.circle_id
    join public.circles as circle on circle.id = settlement.circle_id
    left join public.profiles as creator on creator.id = settlement.created_by
    left join public.profiles as sender on sender.id = settlement.from_user
    left join public.profiles as recipient on recipient.id = settlement.to_user
    where p_scope = 'all'
      or settlement.from_user = v_uid
      or settlement.to_user = v_uid
      or settlement.created_by = v_uid
  ),
  events as (
    select * from expense_events
    union all
    select * from settlement_events
  )
  select events.*
  from events
  order by events.occurred_at desc, events.kind, events.id
  limit v_limit;
end;
$$;

revoke all privileges on function public.list_activity(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_activity(text, integer)
  to authenticated;
