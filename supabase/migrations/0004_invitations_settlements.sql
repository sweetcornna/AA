-- 0004_invitations_settlements.sql — invite tokens, settlements, join/create RPCs

create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references public.circles(id) on delete cascade,
  token      text not null unique,
  created_by uuid not null references public.profiles(id),
  role       text not null default 'member' check (role in ('admin', 'member')),
  max_uses   int,
  used_count int not null default 0,
  expires_at timestamptz,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;
create index idx_invitations_token on public.invitations(token);

create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.circles(id) on delete cascade,
  from_user    uuid not null references public.profiles(id), -- debtor pays
  to_user      uuid not null references public.profiles(id), -- creditor receives
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null default 'CNY',
  note         text,
  settled_at   timestamptz not null default now(),
  created_by   uuid not null references public.profiles(id),
  check (from_user <> to_user)
);

alter table public.settlements enable row level security;
create index idx_settlements_circle on public.settlements(circle_id);

-- Owner/admin generates a high-entropy, URL-safe invite token.
create or replace function public.create_invitation(
  p_circle_id uuid,
  p_role text default 'member',
  p_max_uses int default null,
  p_expires_at timestamptz default null
)
returns public.invitations
language plpgsql
security definer
-- `extensions` is on the path because Supabase installs pgcrypto there, and
-- gen_random_bytes() lives in pgcrypto.
set search_path = public, extensions
as $$
declare
  v_inv public.invitations;
  v_token text;
begin
  if not public.is_circle_admin(p_circle_id, auth.uid()) then
    raise exception 'only circle owner/admin can create invitations';
  end if;

  v_token := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');

  insert into public.invitations (circle_id, token, created_by, role, max_uses, expires_at)
  values (p_circle_id, v_token, auth.uid(), coalesce(p_role, 'member'), p_max_uses, p_expires_at)
  returning * into v_inv;

  return v_inv;
end;
$$;

-- Join a circle via token. SECURITY DEFINER replaces the planned edge function:
-- it validates the token and writes circle_members (which has no open INSERT
-- policy) without needing a service-role key. Idempotent for existing members.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'must be authenticated';
  end if;

  select * into v_inv from public.invitations where token = p_token;
  if not found then
    raise exception 'invalid invitation';
  end if;
  if v_inv.revoked then
    raise exception 'invitation has been revoked';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'invitation has expired';
  end if;
  if v_inv.max_uses is not null and v_inv.used_count >= v_inv.max_uses then
    raise exception 'invitation has no uses left';
  end if;

  if public.is_circle_member(v_inv.circle_id, v_uid) then
    return v_inv.circle_id; -- already a member, no-op
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (v_inv.circle_id, v_uid, v_inv.role);

  update public.invitations set used_count = used_count + 1 where id = v_inv.id;

  return v_inv.circle_id;
end;
$$;
