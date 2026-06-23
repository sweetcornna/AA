-- 0006_views_balances.sql — authoritative per-member net balance.
-- security_invoker = on so the querying user's RLS applies (PG15+/Supabase),
-- i.e. you only see balances for circles you belong to.

create view public.circle_balances
with (security_invoker = on)
as
with paid as (
  select circle_id, payer_id as user_id, sum(amount_minor) as paid_minor
  from public.expenses
  group by circle_id, payer_id
),
owed as (
  select circle_id, user_id, sum(owed_minor) as owed_minor
  from public.expense_splits
  group by circle_id, user_id
),
settle_out as (
  select circle_id, from_user as user_id, sum(amount_minor) as amt
  from public.settlements
  group by circle_id, from_user
),
settle_in as (
  select circle_id, to_user as user_id, sum(amount_minor) as amt
  from public.settlements
  group by circle_id, to_user
)
select
  m.circle_id,
  m.user_id,
  coalesce(p.paid_minor, 0)
    - coalesce(o.owed_minor, 0)
    + coalesce(so.amt, 0)
    - coalesce(si.amt, 0) as net_minor
from public.circle_members m
left join paid       p  on p.circle_id  = m.circle_id and p.user_id  = m.user_id
left join owed       o  on o.circle_id  = m.circle_id and o.user_id  = m.user_id
left join settle_out so on so.circle_id = m.circle_id and so.user_id = m.user_id
left join settle_in  si on si.circle_id = m.circle_id and si.user_id = m.user_id;
