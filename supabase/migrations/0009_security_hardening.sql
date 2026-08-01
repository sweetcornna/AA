-- 0009_security_hardening.sql — enforce ledger invariants behind RPCs.

-- Membership helpers are needed by RLS but should not be callable through the
-- exposed public API schema. Moving them preserves policy dependencies while
-- keeping their SECURITY DEFINER access in a non-exposed schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_circle_member(uuid, uuid) set schema private;
alter function public.is_circle_admin(uuid, uuid) set schema private;
alter function private.is_circle_member(uuid, uuid)
  set search_path = pg_catalog, public;
alter function private.is_circle_admin(uuid, uuid)
  set search_path = pg_catalog, public;
revoke all privileges on all functions in schema private from public, anon;
grant execute on function private.is_circle_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_circle_admin(uuid, uuid) to authenticated, service_role;
alter default privileges in schema private revoke all on functions from public, anon;

-- Prevent a split from naming an expense in one circle while being aggregated
-- into another. The existing single-column FK remains useful for its cascade.
alter table public.expenses
  add constraint expenses_id_circle_id_key unique (id, circle_id);

alter table public.expense_splits
  add constraint expense_splits_expense_circle_fkey
  foreign key (expense_id, circle_id)
  references public.expenses (id, circle_id)
  on delete cascade;

-- The supported client write paths are the RPCs below. Remove permissive RLS
-- policies as well as table privileges so invariant-bearing rows cannot be
-- modified directly even if a future policy is accidentally added.
drop policy if exists "create own circle" on public.circles;
drop policy if exists "admin update member role" on public.circle_members;
drop policy if exists "leave or admin remove members" on public.circle_members;
drop policy if exists "members insert expenses" on public.expenses;
drop policy if exists "creator or admin update expenses" on public.expenses;
drop policy if exists "creator or admin delete expenses" on public.expenses;
drop policy if exists "members insert splits" on public.expense_splits;
drop policy if exists "members update splits" on public.expense_splits;
drop policy if exists "members delete splits" on public.expense_splits;
drop policy if exists "admins create invitations" on public.invitations;
drop policy if exists "admins update invitations" on public.invitations;
drop policy if exists "members create settlements" on public.settlements;
drop policy if exists "creator or admin delete settlements" on public.settlements;

revoke insert on public.circles from anon, authenticated;
revoke insert, update, delete on public.circle_members from anon, authenticated;
revoke insert, update, delete on public.expenses from anon, authenticated;
revoke insert, update, delete on public.expense_splits from anon, authenticated;
revoke insert, update, delete on public.invitations from anon, authenticated;
revoke insert, update, delete on public.settlements from anon, authenticated;

-- Validate the exact payload accepted by the shared frontend and record the
-- expense and splits atomically. Amounts stay within JavaScript's safe integer
-- range because all application clients represent minor units as numbers.
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

-- Only the debtor can attest that they paid. Both parties must still be current
-- members, and settlement metadata is derived/validated server-side.
create or replace function public.create_settlement(
  p_circle_id uuid,
  p_from_user uuid,
  p_to_user uuid,
  p_amount_minor bigint,
  p_currency char(3),
  p_note text default null
)
returns public.settlements
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_settlement public.settlements;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_from_user is null or p_from_user <> v_uid then
    raise exception using errcode = '42501', message = 'only the debtor can confirm payment';
  end if;
  if p_circle_id is null or not private.is_circle_member(p_circle_id, v_uid) then
    raise exception using errcode = '42501', message = 'not a member of this circle';
  end if;
  if p_to_user is null or p_to_user = p_from_user
     or not private.is_circle_member(p_circle_id, p_to_user) then
    raise exception using errcode = '22023', message = 'recipient is not a distinct circle member';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 9007199254740991 then
    raise exception using errcode = '22023', message = 'amount is out of range';
  end if;
  if p_currency is null or p_currency::text !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'currency must be a three-letter uppercase code';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception using errcode = '22023', message = 'settlement note is too long';
  end if;
  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id and c.default_currency = p_currency
  ) then
    raise exception using errcode = '22023', message = 'settlement currency must match the circle';
  end if;

  insert into public.settlements (
    circle_id, from_user, to_user, amount_minor, currency, note, created_by
  ) values (
    p_circle_id, p_from_user, p_to_user, p_amount_minor, p_currency, p_note, v_uid
  )
  returning * into v_settlement;

  return v_settlement;
end;
$$;

-- Serialize admissions for one token. Existing members return without consuming
-- a use; concurrent first-time joins cannot overrun max_uses.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inv public.invitations;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24}$' then
    raise exception using errcode = '22023', message = 'invalid invitation';
  end if;

  select *
  into v_inv
  from public.invitations
  where token = p_token
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'invalid invitation';
  end if;
  if v_inv.revoked then
    raise exception using errcode = '22023', message = 'invitation has been revoked';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation has expired';
  end if;
  if private.is_circle_member(v_inv.circle_id, v_uid) then
    return v_inv.circle_id;
  end if;
  if v_inv.max_uses is not null and v_inv.used_count >= v_inv.max_uses then
    raise exception using errcode = '22023', message = 'invitation has no uses left';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (v_inv.circle_id, v_uid, v_inv.role);

  update public.invitations
  set used_count = used_count + 1
  where id = v_inv.id;

  return v_inv.circle_id;
end;
$$;

-- Validate circle/invitation creation inputs while these definer functions are
-- being exposed as the only supported write paths.
create or replace function public.create_circle(
  p_name text,
  p_description text default '',
  p_currency char(3) default 'CNY'
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
  if p_name is null or char_length(btrim(p_name)) < 1 or char_length(p_name) > 100 then
    raise exception using errcode = '22023', message = 'circle name is required and must not exceed 100 characters';
  end if;
  if p_description is not null and char_length(p_description) > 1000 then
    raise exception using errcode = '22023', message = 'circle description is too long';
  end if;
  if p_currency is null or p_currency::text !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'currency must be a three-letter uppercase code';
  end if;

  insert into public.circles (name, description, default_currency, created_by)
  values (btrim(p_name), coalesce(p_description, ''), p_currency, v_uid)
  returning * into v_circle;

  insert into public.circle_members (circle_id, user_id, role)
  values (v_circle.id, v_uid, 'owner');

  return v_circle;
end;
$$;

create or replace function public.create_invitation(
  p_circle_id uuid,
  p_role text default 'member',
  p_max_uses int default null,
  p_expires_at timestamptz default null
)
returns public.invitations
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_inv public.invitations;
  v_token text;
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_circle_id is null or not private.is_circle_admin(p_circle_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'only circle owner/admin can create invitations';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception using errcode = '22023', message = 'invalid invitation role';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    raise exception using errcode = '22023', message = 'invitation max uses is out of range';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation expiry must be in the future';
  end if;

  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');

  insert into public.invitations (
    circle_id, token, created_by, role, max_uses, expires_at
  ) values (
    p_circle_id, v_token, auth.uid(), p_role, p_max_uses, p_expires_at
  )
  returning * into v_inv;

  return v_inv;
end;
$$;

-- Undo the blanket privileges/defaults introduced in 0007. Service role keeps
-- full table access for trusted server operations; clients receive only the
-- rows and writes needed by the current product.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

revoke all privileges on function private.is_circle_member(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function private.is_circle_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_circle_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_circle_admin(uuid, uuid) to authenticated, service_role;

-- Authenticated member-scoped reads. RLS remains the row-level boundary.
grant select on public.profiles to authenticated;
grant select on public.circles to authenticated;
grant select on public.circle_members to authenticated;
grant select on public.expenses to authenticated;
grant select on public.expense_splits to authenticated;
grant select on public.invitations to authenticated;
grant select on public.settlements to authenticated;
grant select on public.ai_settings to authenticated;
grant select on public.circle_balances to authenticated;

-- Supported direct client writes with restrictive RLS policies.
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.ai_settings to authenticated;

-- Exact client RPC allowlist. Trigger/RLS helpers remain unavailable as API RPCs.
grant execute on function public.create_circle(text, text, char(3)) to authenticated;
grant execute on function public.create_invitation(uuid, text, integer, timestamptz) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.create_expense(
  uuid, uuid, bigint, char(3), text, text, date, text, jsonb,
  text, text, text, text, numeric, jsonb
) to authenticated;
grant execute on function public.create_settlement(
  uuid, uuid, uuid, bigint, char(3), text
) to authenticated;
