-- ============================================================
-- 031: Department-scoped managers
--
-- Today every manager-type role (logistics_manager, and any future
-- custom role with is_manager=true created via Admin > Roles) sees every
-- request in the system, everywhere -- the Requests list and Dashboard
-- only restrict plain requestors (own requests) and coordinators (owned
-- requests). This adds a second manager tier: a "department manager" is
-- assigned one or more departments via department_managers below, and
-- only sees requests whose department matches. logistics_manager (and a
-- future main_admin role, whenever that's created) is exempted from this
-- restriction in application code and continues to see everything --
-- this migration doesn't need to know that list, it just provides the
-- assignment table the app queries.
--
-- profiles.department already exists (original schema.sql) but was
-- constrained to five hardcoded values from before the Departments admin
-- table existed. requests.department's equivalent check constraint was
-- already relaxed live in Supabase when the Departments admin feature
-- shipped (that change isn't in a tracked migration -- see the Gotchas
-- section of the rebuild guide) to accept any current departments.name.
-- This does the same relaxation for profiles.department now that
-- Admin > Users will let an admin set a user's department to any
-- current department name.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.profiles drop constraint if exists profiles_department_check;

-- Which department(s) a manager is scoped to. A manager can be assigned
-- more than one department (per product decision); a department could in
-- principle have more than one manager, so this is a plain many-to-many
-- join rather than a single department_id column anywhere. Keyed by
-- departments.id rather than name -- department names are admin-
-- renameable via Admin > Departments and id is the stable identifier.
create table if not exists public.department_managers (
  department_id uuid not null references public.departments(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (department_id, manager_id)
);

create index if not exists department_managers_manager_id_idx
  on public.department_managers (manager_id);

alter table public.department_managers enable row level security;

-- Read: any staff member can see the assignment list (needed so a
-- department manager's own session can look up which departments they're
-- scoped to on every Requests/Dashboard page load).
drop policy if exists "department_managers visible to staff" on public.department_managers;
create policy "department_managers visible to staff" on public.department_managers
  for select using (public.is_staff());

-- Write: same gate as the Departments admin page itself (manage_departments
-- permission, with the usual is_manager backstop so a manager can never be
-- locked out of a page they can already see) -- enforced in application
-- code via requirePermission("manage_departments"), this is just the
-- matching RLS backstop at the DB layer.
drop policy if exists "department_managers managed by permission" on public.department_managers;
create policy "department_managers managed by permission" on public.department_managers
  for all using (
    public.is_manager()
    or exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role = rp.role_name
      where p.id = auth.uid() and rp.permission_key = 'manage_departments' and rp.granted
    )
  );
