-- 0005_rls_policies.sql — Row Level Security for all business tables.
-- Principle: you may only read/write rows in circles you belong to.

-- profiles ----------------------------------------------------------------
create policy "read own or co-member profiles"
on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.circle_members m_self
    join public.circle_members m_other on m_self.circle_id = m_other.circle_id
    where m_self.user_id = auth.uid() and m_other.user_id = public.profiles.id
  )
);

create policy "insert own profile"
on public.profiles for insert
with check (id = auth.uid());

create policy "update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- circles -----------------------------------------------------------------
create policy "members read circles"
on public.circles for select
using (public.is_circle_member(id, auth.uid()));

create policy "create own circle"
on public.circles for insert
with check (created_by = auth.uid());

create policy "admins update circles"
on public.circles for update
using (public.is_circle_admin(id, auth.uid()))
with check (public.is_circle_admin(id, auth.uid()));

-- circle_members ----------------------------------------------------------
-- No open INSERT: joining happens only via create_circle / accept_invitation.
create policy "members read members"
on public.circle_members for select
using (public.is_circle_member(circle_id, auth.uid()));

create policy "admin update member role"
on public.circle_members for update
using (public.is_circle_admin(circle_id, auth.uid()))
with check (public.is_circle_admin(circle_id, auth.uid()));

create policy "leave or admin remove members"
on public.circle_members for delete
using (user_id = auth.uid() or public.is_circle_admin(circle_id, auth.uid()));

-- expenses ----------------------------------------------------------------
create policy "members read expenses"
on public.expenses for select
using (public.is_circle_member(circle_id, auth.uid()));

create policy "members insert expenses"
on public.expenses for insert
with check (public.is_circle_member(circle_id, auth.uid()) and created_by = auth.uid());

create policy "creator or admin update expenses"
on public.expenses for update
using (created_by = auth.uid() or public.is_circle_admin(circle_id, auth.uid()))
with check (public.is_circle_member(circle_id, auth.uid()));

create policy "creator or admin delete expenses"
on public.expenses for delete
using (created_by = auth.uid() or public.is_circle_admin(circle_id, auth.uid()));

-- expense_splits ----------------------------------------------------------
create policy "members read splits"
on public.expense_splits for select
using (public.is_circle_member(circle_id, auth.uid()));

create policy "members insert splits"
on public.expense_splits for insert
with check (public.is_circle_member(circle_id, auth.uid()));

create policy "members update splits"
on public.expense_splits for update
using (public.is_circle_member(circle_id, auth.uid()))
with check (public.is_circle_member(circle_id, auth.uid()));

create policy "members delete splits"
on public.expense_splits for delete
using (public.is_circle_member(circle_id, auth.uid()));

-- invitations -------------------------------------------------------------
-- Reading a single invite by token for joining goes through accept_invitation
-- (SECURITY DEFINER); direct SELECT is limited to admins managing their circle.
create policy "admins read invitations"
on public.invitations for select
using (public.is_circle_admin(circle_id, auth.uid()));

create policy "admins create invitations"
on public.invitations for insert
with check (public.is_circle_admin(circle_id, auth.uid()) and created_by = auth.uid());

create policy "admins update invitations"
on public.invitations for update
using (public.is_circle_admin(circle_id, auth.uid()))
with check (public.is_circle_admin(circle_id, auth.uid()));

-- settlements -------------------------------------------------------------
create policy "members read settlements"
on public.settlements for select
using (public.is_circle_member(circle_id, auth.uid()));

create policy "members create settlements"
on public.settlements for insert
with check (public.is_circle_member(circle_id, auth.uid()) and created_by = auth.uid());

create policy "creator or admin delete settlements"
on public.settlements for delete
using (created_by = auth.uid() or public.is_circle_admin(circle_id, auth.uid()));
