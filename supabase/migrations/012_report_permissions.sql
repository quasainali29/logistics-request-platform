-- Logistics Request Management Platform — Migration 012
-- Adds one permission per Reports sub-page, so the admin can grant/revoke
-- access to each report independently via the existing Roles & Permissions
-- matrix (Admin > Permissions) — same pattern as manage_projects in
-- migration 010. The top-level "view_reports" permission (migration 008)
-- still gates whether the Reports nav link/landing page shows at all;
-- these new keys gate the individual report pages underneath it.
--
-- Defaults: operational reports (throughput, SLA, projects, AMC) are
-- granted to the same roles as view_reports today (logistics_coordinator,
-- warehouse_team, logistics_manager, main_admin). Coordinator Workload
-- reports on individual staff performance, so it defaults to managers/admin
-- only, matching the manage_projects precedent — admin can loosen this
-- from the Permissions page at any time.
--
-- Safe to run multiple times from the top.

insert into public.permissions (key, label, category, sort_order) values
  ('view_report_throughput', 'View: Request Throughput & Status report', 'Reports', 50),
  ('view_report_sla', 'View: SLA / Turnaround report', 'Reports', 51),
  ('view_report_projects', 'View: Project report', 'Reports', 52),
  ('view_report_amc', 'View: AMC / Compliance report', 'Reports', 53),
  ('view_report_coordinator', 'View: Coordinator Workload report', 'Reports', 54)
on conflict (key) do nothing;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_throughput', r.name in ('logistics_coordinator', 'warehouse_team', 'logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_sla', r.name in ('logistics_coordinator', 'warehouse_team', 'logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_projects', r.name in ('logistics_coordinator', 'warehouse_team', 'logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_amc', r.name in ('logistics_coordinator', 'warehouse_team', 'logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_coordinator', r.name in ('logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;
