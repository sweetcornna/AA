create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- The pinned image runs its initial Auth schema as postgres and transfers the
-- Auth tables, but not these helper functions, to supabase_auth_admin. GoTrue
-- connects as supabase_auth_admin and replaces them in its first migration.
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;

-- Realtime executes SET search_path TO _realtime on every connection. Keep the
-- upstream 99-realtime.sql mount and make the required schema idempotently
-- available from AA's own fresh-volume prerequisites as well.
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
end
$$;
