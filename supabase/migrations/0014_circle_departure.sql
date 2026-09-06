-- Circle departure is a ledger operation: serialize all circle writes before
-- checking membership and balances. Historical ledger rows are never deleted.
create or replace function public.leave_circle(
  p_circle_id uuid,
  p_successor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_net numeric;
  v_others integer;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'must be authenticated';
  end if;
  if p_circle_id is null then
    raise exception using errcode = '22023', message = 'circle is required';
  end if;
  perform 1 from public.circles where id = p_circle_id for update;
  select role into v_role from public.circle_members
    where circle_id = p_circle_id and user_id = v_uid;
  if not found then
    -- Safe to retry after an ambiguous network response; reveals no circle data.
    return jsonb_build_object('status', 'already_left');
  end if;
  select net_minor into v_net from public.circle_balances
    where circle_id = p_circle_id and user_id = v_uid;
  if v_net is null or v_net <> 0 then
    raise exception using errcode = '22023', message = 'balance_not_zero';
  end if;
  select count(*) into v_others from public.circle_members
    where circle_id = p_circle_id and user_id <> v_uid;
  if v_role = 'owner' and v_others > 0 then
    if p_successor_user_id is null then
      raise exception using errcode = '22023', message = 'successor_required';
    end if;
    if p_successor_user_id = v_uid or not private.is_circle_member(p_circle_id, p_successor_user_id) then
      raise exception using errcode = '22023', message = 'invalid_successor';
    end if;
    update public.circle_members set role = 'owner'
      where circle_id = p_circle_id and user_id = p_successor_user_id;
  elsif p_successor_user_id is not null then
    raise exception using errcode = '22023', message = 'invalid_successor';
  end if;
  delete from public.circle_members where circle_id = p_circle_id and user_id = v_uid;
  if v_others = 0 then
    update public.invitations set revoked = true where circle_id = p_circle_id;
  end if;
  -- UPDATE events remain visible to remaining members under RLS, unlike a
  -- filtered membership DELETE. created_by stays the historical creator.
  update public.circles set updated_at = now() where id = p_circle_id;
  return jsonb_build_object('status', 'left');
end;
$$;
revoke all privileges on function public.leave_circle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_circle(uuid, uuid) to authenticated, service_role;

-- A narrow, circle-scoped identity projection. Do not broaden profile RLS:
-- historical participation must not expose email/phone to former co-members.
create or replace function public.list_circle_participants(p_circle_id uuid)
returns table(user_id uuid, display_name text, avatar_url text, active boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not private.is_circle_member(p_circle_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'not a member of this circle';
  end if;
  return query
  with identities as (
    select m.user_id as id from public.circle_members m where m.circle_id = p_circle_id
    union select e.payer_id from public.expenses e where e.circle_id = p_circle_id
    union select e.created_by from public.expenses e where e.circle_id = p_circle_id
    union select s.user_id from public.expense_splits s where s.circle_id = p_circle_id
    union select s.from_user from public.settlements s where s.circle_id = p_circle_id
    union select s.to_user from public.settlements s where s.circle_id = p_circle_id
    union select s.created_by from public.settlements s where s.circle_id = p_circle_id
  )
  select p.id, p.display_name, p.avatar_url,
    exists(select 1 from public.circle_members m where m.circle_id = p_circle_id and m.user_id = p.id)
  from identities i join public.profiles p on p.id = i.id;
end;
$$;
revoke all privileges on function public.list_circle_participants(uuid) from public, anon, authenticated;
grant execute on function public.list_circle_participants(uuid) to authenticated, service_role;

alter publication supabase_realtime add table public.circles;

-- The following replacements preserve the previous validation and ACLs, adding
-- the same circle-first lock order to every supported write path.


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
  perform 1 from public.circles where id = p_circle_id for update;
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
  perform 1 from public.circles where id = p_circle_id for update;
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
  perform 1 from public.circles where id = p_circle_id for update;
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
  perform 1 from public.circles where id = p_circle_id for update;
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

  -- Read the immutable circle id, lock circle first, then re-read/lock invite.
  select * into v_inv from public.invitations where token = p_token;
  if not found then
    raise exception using errcode = '22023', message = 'invalid invitation';
  end if;
  perform 1 from public.circles where id = v_inv.circle_id for update;
  select * into v_inv from public.invitations where token = p_token for update;

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

  update public.circles set updated_at = now() where id = v_inv.circle_id;
  return v_inv.circle_id;
end;
$$;
