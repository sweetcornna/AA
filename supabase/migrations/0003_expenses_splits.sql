-- 0003_expenses_splits.sql — expenses, per-person splits, atomic create RPC

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.circles(id) on delete cascade,
  payer_id     uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null default 'CNY',
  description  text not null default '',
  category     text,
  spent_at     date not null default current_date,
  split_type   text not null check (split_type in ('equal', 'exact', 'shares')),
  -- Provenance (AI layer is milestone 2; columns reserved from day one).
  source       text not null default 'manual' check (source in ('manual', 'voice', 'agent')),
  raw_text     text,
  receipt_url  text,
  ai_provider  text,
  asr_provider text,
  ai_confidence numeric,
  ai_raw       jsonb,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.expenses enable row level security;

create index idx_expenses_circle_date on public.expenses(circle_id, spent_at desc);
create index idx_expenses_payer on public.expenses(payer_id);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

create table public.expense_splits (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses(id) on delete cascade,
  circle_id   uuid not null references public.circles(id) on delete cascade, -- denormalized for RLS / aggregation
  user_id     uuid not null references public.profiles(id),
  owed_minor  bigint not null check (owed_minor >= 0), -- final, already-rounded 分
  share_units numeric, -- raw weight/percent input when split_type = 'shares'
  created_at  timestamptz not null default now(),
  unique (expense_id, user_id)
);

alter table public.expense_splits enable row level security;

create index idx_splits_circle_user on public.expense_splits(circle_id, user_id);
create index idx_splits_expense on public.expense_splits(expense_id);

-- Insert an expense and its splits atomically, validating membership and that
-- the splits sum exactly to the total. The client computes owed_minor with the
-- shared algorithm (packages/shared) and passes them in.
--   p_splits :: jsonb = [{"user_id":"uuid","owed_minor":123,"share_units":1}, ...]
create or replace function public.create_expense(
  p_circle_id uuid,
  p_payer_id uuid,
  p_amount_minor bigint,
  p_currency char(3),
  p_description text,
  p_category text,
  p_spent_at date,
  p_split_type text,
  p_splits jsonb,
  p_source text default 'manual',
  p_raw_text text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses;
  v_sum bigint;
begin
  if not public.is_circle_member(p_circle_id, auth.uid()) then
    raise exception 'not a member of this circle';
  end if;
  if not public.is_circle_member(p_circle_id, p_payer_id) then
    raise exception 'payer is not a member of this circle';
  end if;

  select coalesce(sum((s->>'owed_minor')::bigint), 0)
    into v_sum
  from jsonb_array_elements(p_splits) as s;

  if v_sum <> p_amount_minor then
    raise exception 'split sum (%) must equal amount (%)', v_sum, p_amount_minor;
  end if;

  insert into public.expenses (
    circle_id, payer_id, amount_minor, currency, description, category,
    spent_at, split_type, source, raw_text, created_by
  ) values (
    p_circle_id, p_payer_id, p_amount_minor, coalesce(p_currency, 'CNY'),
    coalesce(p_description, ''), p_category, coalesce(p_spent_at, current_date),
    p_split_type, coalesce(p_source, 'manual'), p_raw_text, auth.uid()
  )
  returning * into v_expense;

  insert into public.expense_splits (expense_id, circle_id, user_id, owed_minor, share_units)
  select
    v_expense.id,
    p_circle_id,
    (s->>'user_id')::uuid,
    (s->>'owed_minor')::bigint,
    nullif(s->>'share_units', '')::numeric
  from jsonb_array_elements(p_splits) as s;

  return v_expense;
end;
$$;
