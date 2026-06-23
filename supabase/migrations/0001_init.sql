-- 0001_init.sql — extensions, shared helpers, profiles + auto-provisioning

create extension if not exists pgcrypto;

-- Keep updated_at fresh on any row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles mirrors auth.users with app-level display fields.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '新用户',
  avatar_url   text,
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create a profile whenever an auth user is created (OTP signup).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      new.phone,
      '新用户'
    ),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
