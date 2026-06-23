-- 0002_circles_members.sql — circles, membership, membership helpers, circle creation RPC

create table public.circles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text not null default '',
  default_currency char(3) not null default 'CNY',
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.circles enable row level security;

create trigger circles_set_updated_at
before update on public.circles
for each row execute function public.set_updated_at();

create table public.circle_members (
  id        uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
);

alter table public.circle_members enable row level security;

create index idx_members_user on public.circle_members(user_id);
create index idx_members_circle on public.circle_members(circle_id);

-- SECURITY DEFINER membership checks: called from RLS policies on OTHER tables,
-- and from circle_members policies. Being SECURITY DEFINER lets them read
-- circle_members without triggering that table's own RLS (avoids recursion).
create or replace function public.is_circle_member(p_circle uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = p_circle and user_id = p_user
  );
$$;

create or replace function public.is_circle_admin(p_circle uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = p_circle and user_id = p_user and role in ('owner', 'admin')
  );
$$;

-- Create a circle and make the caller its owner, atomically. SECURITY DEFINER
-- so it can insert the owner membership (circle_members has no open INSERT policy).
create or replace function public.create_circle(
  p_name text,
  p_description text default '',
  p_currency char(3) default 'CNY'
)
returns public.circles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle public.circles;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  insert into public.circles (name, description, default_currency, created_by)
  values (p_name, coalesce(p_description, ''), coalesce(p_currency, 'CNY'), auth.uid())
  returning * into v_circle;

  insert into public.circle_members (circle_id, user_id, role)
  values (v_circle.id, auth.uid(), 'owner');

  return v_circle;
end;
$$;
