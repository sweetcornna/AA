-- 0008_ai_settings_audit.sql — runtime AI provider switching + AI audit trail.
--
-- ai_settings drives the Edge Function provider registry. Resolution order
-- (implemented in supabase/functions/_shared/llm/registry.ts):
--   circle row (circle_id = X) > global row (circle_id is null) > env > default.
-- ai_enabled=false is the kill switch: functions fall back to the rule-based
-- provider (no external AI call) without redeploying.

create table public.ai_settings (
  id           uuid primary key default gen_random_uuid(),
  -- null = the single global row; otherwise a per-circle override.
  circle_id    uuid references public.circles(id) on delete cascade,
  llm_provider text check (llm_provider in ('claude', 'openai', 'rule')),
  asr_provider text check (asr_provider in ('openai', 'none')),
  ai_enabled   boolean not null default true,
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now(),
  -- at most one global row and one row per circle (PG15+: nulls not distinct)
  unique nulls not distinct (circle_id)
);

alter table public.ai_settings enable row level security;

create trigger ai_settings_set_updated_at
before update on public.ai_settings
for each row execute function public.set_updated_at();

-- Everyone signed in can read the global row; circle rows only for members.
create policy "read global or member ai settings"
on public.ai_settings for select
using (circle_id is null or public.is_circle_member(circle_id, auth.uid()));

-- Circle admins manage their circle's override. The global row is managed by
-- the operator (service_role / Studio) only — no authenticated policy.
create policy "admins insert circle ai settings"
on public.ai_settings for insert
with check (circle_id is not null and public.is_circle_admin(circle_id, auth.uid()));

create policy "admins update circle ai settings"
on public.ai_settings for update
using (circle_id is not null and public.is_circle_admin(circle_id, auth.uid()))
with check (circle_id is not null and public.is_circle_admin(circle_id, auth.uid()));

create policy "admins delete circle ai settings"
on public.ai_settings for delete
using (circle_id is not null and public.is_circle_admin(circle_id, auth.uid()));

-- 0007 set default privileges, but stay explicit (see that migration's note).
grant select, insert, update, delete on public.ai_settings to authenticated, service_role;
grant select on public.ai_settings to anon;

-- create_expense: accept the AI audit fields (ai_provider / asr_provider /
-- ai_confidence / ai_raw — columns reserved since 0003). Drop + recreate with
-- the wider signature instead of adding an overload, so PostgREST RPC name
-- resolution stays unambiguous.
drop function if exists public.create_expense(
  uuid, uuid, bigint, char(3), text, text, date, text, jsonb, text, text
);

create function public.create_expense(
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
  p_raw_text text default null,
  p_ai_provider text default null,
  p_asr_provider text default null,
  p_ai_confidence numeric default null,
  p_ai_raw jsonb default null
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
    spent_at, split_type, source, raw_text,
    ai_provider, asr_provider, ai_confidence, ai_raw, created_by
  ) values (
    p_circle_id, p_payer_id, p_amount_minor, coalesce(p_currency, 'CNY'),
    coalesce(p_description, ''), p_category, coalesce(p_spent_at, current_date),
    p_split_type, coalesce(p_source, 'manual'), p_raw_text,
    p_ai_provider, p_asr_provider, p_ai_confidence, p_ai_raw, auth.uid()
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

grant execute on function public.create_expense to authenticated, service_role;
