-- Logistics Request Management Platform — Migration 010
-- Wires up the (previously unused) `projects` table + `requests.project_id`
-- into a real, admin-managed master list, per the user's request:
--   - Request form's "Project" field becomes a dropdown of active projects,
--     plus "Other" (a one-off free-text tag on that request only — it does
--     NOT get added to the master list; see requests.project below).
--   - Admin can add projects (name, client, status) from a new
--     Admin > Projects page.
--   - Admin can delete a project. Deleting is a SOFT delete (deleted_at is
--     set) rather than an actual row delete — this keeps every existing
--     request's project_id link intact (no FK errors, no orphaned data),
--     while the app displays "Unavailable Project" for any request whose
--     linked project has been deleted, and the project stops showing up
--     as a choice for new requests.
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. SOFT DELETE SUPPORT
-- ============================================================
alter table public.projects
  add column if not exists deleted_at timestamptz;

-- ============================================================
-- 2. RLS — writing to the projects master list is now a manager-gated
-- admin action (like workflow stages / permissions), not a general-staff
-- one. The app-layer check is the new "manage_projects" permission below,
-- with is_manager() kept as the RLS backstop, same pattern as migration 008.
-- ============================================================
drop policy if exists "projects writable by staff" on public.projects;
drop policy if exists "projects writable by manager" on public.projects;
create policy "projects writable by manager" on public.projects
  for all using (public.is_manager()) with check (public.is_manager());

-- ============================================================
-- 3. NEW PERMISSION — appears automatically in the existing Roles &
-- Permissions matrix (Admin > Permissions) thanks to the auto-seed trigger
-- from migration 008. Seeded on for logistics_manager + main_admin only,
-- matching the other "manage_*" admin permissions.
-- ============================================================
insert into public.permissions (key, label, category, sort_order) values
  ('manage_projects', 'Manage projects', 'Admin', 45)
on conflict (key) do nothing;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'manage_projects', r.name in ('logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;
