-- 0007_realtime_grants.sql — realtime publication + privileges for API roles

-- Push row changes to subscribed circle members. The client filters by
-- circle_id; RLS still governs what each subscriber is allowed to receive.
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.expense_splits;
alter publication supabase_realtime add table public.circle_members;
alter publication supabase_realtime add table public.settlements;

-- Base table/view privileges for the PostgREST roles. RLS still enforces
-- row-level access; these grants are the table-level prerequisite. (Supabase's
-- default-privilege grants don't reliably cover objects created by the
-- migration role, so we grant explicitly.) The security_invoker
-- circle_balances view runs as the caller, so it needs SELECT on its base
-- tables — covered here too.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant select on all tables in schema public to anon;
grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- Keep future objects in this schema grantable without another migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
