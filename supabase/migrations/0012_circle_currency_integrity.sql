-- 0012_circle_currency_integrity.sql — close circle and currency write bypasses.

-- Circle mutations must use the validated RPC below. The admin UPDATE policy
-- survived 0009, and 0007's blanket table grants still exposed the operation.
drop policy if exists "admins update circles" on public.circles;
revoke update, delete on public.circles from anon, authenticated;

create or replace function public.update_circle(
  p_circle_id uuid,
  p_name text,
  p_description text,
  p_currency char(3)
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
  if p_circle_id is null or not private.is_circle_admin(p_circle_id, v_uid) then
    raise exception using errcode = '42501', message = 'only circle owner/admin can update circle';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 1 or char_length(p_name) > 100 then
    raise exception using errcode = '22023', message = 'circle name is required and must not exceed 100 characters';
  end if;
  if p_description is not null and char_length(p_description) > 1000 then
    raise exception using errcode = '22023', message = 'circle description is too long';
  end if;
  if p_currency is null or p_currency::text !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'currency must be a three-letter uppercase code';
  end if;

  select circle.*
  into v_circle
  from public.circles circle
  where circle.id = p_circle_id
  for update;

  if v_circle.default_currency is distinct from p_currency and (
    exists (
      select 1 from public.expenses expense
      where expense.circle_id = p_circle_id
    ) or exists (
      select 1 from public.settlements settlement
      where settlement.circle_id = p_circle_id
    )
  ) then
    raise exception using errcode = '22023', message = 'circle currency cannot change after expenses or settlements exist';
  end if;

  update public.circles
  set name = btrim(p_name),
      description = coalesce(p_description, ''),
      default_currency = p_currency
  where id = p_circle_id
  returning * into v_circle;

  return v_circle;
end;
$$;

revoke all privileges on function public.update_circle(uuid, text, text, char(3))
  from public, anon, authenticated;
grant execute on function public.update_circle(uuid, text, text, char(3))
  to authenticated, service_role;

-- Preserve the complete hardened 0009 implementation while additionally
-- binding every new expense to its circle's authoritative currency.
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
  p_raw_text text default null,
  p_ai_provider text default null,
  p_asr_provider text default null,
  p_ai_confidence numeric default null,
  p_ai_raw jsonb default null
)
returns public.expenses
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_expense public.expenses;
  v_split_count integer;
  v_sum numeric;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_circle_id is null or not private.is_circle_member(p_circle_id, v_uid) then
    raise exception using errcode = '42501', message = 'not a member of this circle';
  end if;
  if p_payer_id is null or not private.is_circle_member(p_circle_id, p_payer_id) then
    raise exception using errcode = '22023', message = 'payer is not a member of this circle';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 9007199254740991 then
    raise exception using errcode = '22023', message = 'amount is out of range';
  end if;
  if p_currency is null or p_currency::text !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'currency must be a three-letter uppercase code';
  end if;
  if p_description is null or char_length(p_description) > 500 then
    raise exception using errcode = '22023', message = 'description is too long';
  end if;
  if p_category is not null and char_length(p_category) > 100 then
    raise exception using errcode = '22023', message = 'category is too long';
  end if;
  if p_spent_at is null then
    raise exception using errcode = '22023', message = 'spent_at is required';
  end if;
  if p_split_type is null or p_split_type not in ('equal', 'exact', 'shares') then
    raise exception using errcode = '22023', message = 'invalid split type';
  end if;
  if p_source is null or p_source not in ('manual', 'voice', 'agent') then
    raise exception using errcode = '22023', message = 'invalid expense source';
  end if;
  if p_raw_text is not null and char_length(p_raw_text) > 4000 then
    raise exception using errcode = '22023', message = 'raw text is too long';
  end if;
  if p_ai_provider is not null and char_length(p_ai_provider) > 100 then
    raise exception using errcode = '22023', message = 'AI provider is too long';
  end if;
  if p_asr_provider is not null and char_length(p_asr_provider) > 100 then
    raise exception using errcode = '22023', message = 'ASR provider is too long';
  end if;
  if p_ai_confidence is not null and (p_ai_confidence < 0 or p_ai_confidence > 1) then
    raise exception using errcode = '22023', message = 'AI confidence must be between zero and one';
  end if;
  if p_ai_raw is not null and octet_length(p_ai_raw::text) > 65536 then
    raise exception using errcode = '22023', message = 'AI audit payload is too large';
  end if;

  if p_splits is null or jsonb_typeof(p_splits) <> 'array' then
    raise exception using errcode = '22023', message = 'splits must be an array';
  end if;
  if octet_length(p_splits::text) > 65536 then
    raise exception using errcode = '22023', message = 'split payload is too large';
  end if;
  v_split_count := jsonb_array_length(p_splits);
  if v_split_count < 1 or v_split_count > 100 then
    raise exception using errcode = '22023', message = 'split count is out of range';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_splits) as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or not item.value ? 'user_id'
       or not item.value ? 'owed_minor'
       or item.value - array['user_id', 'owed_minor', 'share_units'] <> '{}'::jsonb
       or jsonb_typeof(item.value->'user_id') <> 'string'
       or jsonb_typeof(item.value->'owed_minor') <> 'number'
       or (item.value ? 'share_units'
           and item.value->'share_units' <> 'null'::jsonb
           and jsonb_typeof(item.value->'share_units') <> 'number')
       or (item.value->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (item.value->>'owed_minor')::numeric < 0
       or (item.value->>'owed_minor')::numeric > 9007199254740991
       or (item.value->>'owed_minor')::numeric <> trunc((item.value->>'owed_minor')::numeric)
       or (item.value->>'share_units') is not null
          and ((item.value->>'share_units')::numeric < 0
               or (item.value->>'share_units')::numeric > 1000000000)
  ) then
    raise exception using errcode = '22023', message = 'invalid split item';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_splits) as item(value)
    group by item.value->>'user_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'split participants must be unique';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_splits) as item(value)
    where not private.is_circle_member(p_circle_id, (item.value->>'user_id')::uuid)
  ) then
    raise exception using errcode = '22023', message = 'split participant is not a member of this circle';
  end if;

  select sum((item.value->>'owed_minor')::numeric)
  into v_sum
  from jsonb_array_elements(p_splits) as item(value);
  if v_sum <> p_amount_minor then
    raise exception using errcode = '22023', message = 'split sum must equal amount';
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id and c.default_currency = p_currency
  ) then
    raise exception using errcode = '22023', message = 'expense currency must match the circle';
  end if;

  insert into public.expenses (
    circle_id, payer_id, amount_minor, currency, description, category,
    spent_at, split_type, source, raw_text,
    ai_provider, asr_provider, ai_confidence, ai_raw, created_by
  ) values (
    p_circle_id, p_payer_id, p_amount_minor, p_currency,
    p_description, p_category, p_spent_at,
    p_split_type, p_source, p_raw_text,
    p_ai_provider, p_asr_provider, p_ai_confidence, p_ai_raw, v_uid
  )
  returning * into v_expense;

  insert into public.expense_splits (
    expense_id, circle_id, user_id, owed_minor, share_units
  )
  select
    v_expense.id,
    p_circle_id,
    (item.value->>'user_id')::uuid,
    (item.value->>'owed_minor')::bigint,
    nullif(item.value->>'share_units', '')::numeric
  from jsonb_array_elements(p_splits) as item(value);

  return v_expense;
end;
$$;
