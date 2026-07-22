-- Logistics Request Management Platform — Migration 008
-- Adds a full, open-ended permissions matrix: a `permissions` catalog
-- (rows the Admin can add to freely) and a `role_permissions` join table
-- (the checkbox grid — one row per role x permission pair). Roles were
-- already open-ended via the `roles` table added in migration 002; this
-- makes the *access* side of that table equally open-ended.
--
-- `roles.is_staff` / `roles.is_manager` are left in place — they still
-- back the existing RLS policies and nav visibility as a coarse backstop.
-- The new matrix is the source of truth for fine-grained, per-action
-- checks at the application layer (see src/lib/permissions.ts).
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. PERMISSIONS CATALOG (open-ended — Admin can add new rows)
-- ============================================================
create table if not exists public.permissions (
  key text primary key,
  label text not null,
  category text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- ============================================================
-- 2. ROLE_PERMISSIONS (the checkbox grid)
-- ============================================================
create table if not exists public.role_permissions (
  role_name text not null references public.roles(name) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (role_name, permission_key)
);

-- Whenever a new role is created, give it a (all-unchecked) row for every
-- existing permission, so the matrix never has a missing cell.
create or replace function public.seed_role_permissions_for_new_role()
returns trigger as $$
begin
  insert into public.role_permissions (role_name, permission_key, granted)
  select new.name, p.key, false
  from public.permissions p
  on conflict (role_name, permission_key) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_role_created_seed_permissions on public.roles;
create trigger on_role_created_seed_permissions
  after insert on public.roles
  for each row execute function public.seed_role_permissions_for_new_role();

-- Whenever a new permission row is added, give every existing role an
-- (unchecked) cell for it too — same symmetry in the other direction.
create or replace function public.seed_role_permissions_for_new_permission()
returns trigger as $$
begin
  insert into public.role_permissions (role_name, permission_key, granted)
  select r.name, new.key, false
  from public.roles r
  on conflict (role_name, permission_key) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_permission_created_seed_roles on public.permissions;
create trigger on_permission_created_seed_roles
  after insert on public.permissions
  for each row execute function public.seed_role_permissions_for_new_permission();

-- ============================================================
-- 3. SEED THE 23 PERMISSIONS THAT COVER EVERY ACCESS POINT IN THE APP TODAY
-- ============================================================
insert into public.permissions (key, label, category, sort_order) values
  ('create_request',            'Create request',                    'Requests', 10),
  ('edit_request',               'Edit / resubmit request',           'Requests', 20),
  ('view_all_requests',          'View all requests (not just own)',  'Requests', 30),
  ('approve_request',            'Approve request',                   'Requests', 40),
  ('reject_request',             'Reject request',                    'Requests', 50),
  ('assign_coordinator',         'Assign coordinator',                'Requests', 60),
  ('close_out_request',          'Close out request',                 'Requests', 70),
  ('delete_request',             'Delete request',                    'Requests', 80),
  ('generate_documents',         'Generate delivery note / report',   'Requests', 90),
  ('comment_on_request',         'Comment on request',                'Requests', 100),

  ('view_warehouse',             'View warehouse',                    'Fleet, warehouse & reports', 10),
  ('view_fleet',                 'View fleet',                        'Fleet, warehouse & reports', 20),
  ('view_reports',               'View reports',                      'Fleet, warehouse & reports', 30),

  ('view_amc',                   'View AMC contracts',                'AMC contracts', 10),
  ('create_edit_amc_contract',   'Create / edit AMC contract',        'AMC contracts', 20),
  ('upload_maintenance_report',  'Upload maintenance report',         'AMC contracts', 30),
  ('add_location_type',          'Add location / AMC type',           'AMC contracts', 40),
  ('delete_location_type',       'Delete location / AMC type',        'AMC contracts', 50),

  ('access_admin_panel',         'Access admin panel',                'Admin', 10),
  ('manage_users',                'Manage users',                      'Admin', 20),
  ('manage_roles_permissions',   'Manage roles & permissions',        'Admin', 30),
  ('manage_workflow_stages',     'Manage workflow stages',            'Admin', 40),
  ('manage_branding',             'Manage branding',                   'Admin', 50)
on conflict (key) do nothing;

-- ============================================================
-- 4. SEED role_permissions FOR THE 5 EXISTING ROLES
-- (The AFTER INSERT triggers above only fire for rows created *after* this
-- migration, so the initial matrix for already-existing roles/permissions
-- needs an explicit seed — matches the defaults shown to the user.)
-- ============================================================
insert into public.role_permissions (role_name, permission_key, granted)
select r.name, p.key, case
  when p.key = 'create_request' then r.name in ('requestor','logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'edit_request' then r.name in ('requestor','logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'view_all_requests' then r.name in ('logistics_coordinator','warehouse_team','logistics_manager','main_admin')
  when p.key = 'approve_request' then r.name in ('logistics_manager','main_admin')
  when p.key = 'reject_request' then r.name in ('logistics_manager','main_admin')
  when p.key = 'assign_coordinator' then r.name in ('logistics_manager','main_admin')
  when p.key = 'close_out_request' then r.name in ('logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'delete_request' then r.name in ('logistics_manager','main_admin')
  when p.key = 'generate_documents' then r.name in ('logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'comment_on_request' then true
  when p.key = 'view_warehouse' then r.name in ('logistics_coordinator','warehouse_team','logistics_manager','main_admin')
  when p.key = 'view_fleet' then r.name in ('logistics_coordinator','warehouse_team','logistics_manager','main_admin')
  when p.key = 'view_reports' then r.name in ('logistics_coordinator','warehouse_team','logistics_manager','main_admin')
  when p.key = 'view_amc' then true
  when p.key = 'create_edit_amc_contract' then r.name in ('logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'upload_maintenance_report' then r.name in ('logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'add_location_type' then r.name in ('logistics_coordinator','logistics_manager','main_admin')
  when p.key = 'delete_location_type' then r.name in ('logistics_manager','main_admin')
  when p.key = 'access_admin_panel' then r.name in ('logistics_manager','main_admin')
  when p.key = 'manage_users' then r.name in ('logistics_manager','main_admin')
  when p.key = 'manage_roles_permissions' then r.name in ('main_admin')
  when p.key = 'manage_workflow_stages' then r.name in ('logistics_manager','main_admin')
  when p.key = 'manage_branding' then r.name in ('logistics_manager','main_admin')
  else false
end
from public.roles r
cross join public.permissions p
on conflict (role_name, permission_key) do update set granted = excluded.granted;

-- ============================================================
-- 5. RLS — readable by any authenticated user, writable by managers only
-- ============================================================
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "permissions readable by authenticated" on public.permissions;
create policy "permissions readable by authenticated" on public.permissions
  for select using (auth.role() = 'authenticated');
drop policy if exists "permissions writable by manager" on public.permissions;
create policy "permissions writable by manager" on public.permissions
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "role_permissions readable by authenticated" on public.role_permissions;
create policy "role_permissions readable by authenticated" on public.role_permissions
  for select using (auth.role() = 'authenticated');
drop policy if exists "role_permissions writable by manager" on public.role_permissions;
create policy "role_permissions writable by manager" on public.role_permissions
  for all using (public.is_manager()) with check (public.is_manager());
