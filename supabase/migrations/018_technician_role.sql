-- Logistics Request Management Platform — Migration 018
-- Adds a Technician role: a coordinator assigns a technician to a request,
-- the technician accepts it, starts it, and marks it completed by
-- uploading photos and capturing an on-screen signature — all from their
-- own device, no printing/scanning. Coordinator/Manager still make the
-- final call to close the request (unchanged from today).
--
-- Reuses the "assigned" / "dispatched" / "on_site" stages that already
-- exist in workflow_stages for every category (seeded in migration 003)
-- but have never had a transition wired to them — this migration is what
-- finally puts real buttons on them, just relabeled for how the technician
-- flow actually reads: Assigned -> Job Accepted -> Work in Progress.
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. TECHNICIAN ROLE
-- ============================================================
insert into public.roles (name, label, description, is_staff, is_manager) values
  ('technician', 'Technician', 'Completes assigned field jobs: accepts, starts, and closes out with photos and a signature.', false, false)
on conflict (name) do nothing;

-- ============================================================
-- 2. NEW PERMISSIONS
-- ============================================================
insert into public.permissions (key, label, category, sort_order) values
  ('assign_technician',          'Assign technician',                 'Requests', 65),
  ('complete_job_as_technician', 'Complete job (technician)',         'Requests', 66)
on conflict (key) do nothing;

-- Grant assign_technician to the same roles that can already assign a
-- coordinator; grant complete_job_as_technician to the technician role only.
insert into public.role_permissions (role_name, permission_key, granted)
select r.name, p.key, case
  when p.key = 'assign_technician' then r.name in ('logistics_coordinator','logistics_manager','main_admin','managers')
  when p.key = 'complete_job_as_technician' then r.name in ('technician')
  else false
end
from public.roles r
cross join public.permissions p
where p.key in ('assign_technician','complete_job_as_technician')
on conflict (role_name, permission_key) do update set granted = excluded.granted;

-- ============================================================
-- 3. requests.assigned_technician_id
-- ============================================================
alter table public.requests
  add column if not exists assigned_technician_id uuid references public.profiles(id);

create index if not exists requests_assigned_technician_id_idx
  on public.requests (assigned_technician_id);

-- ============================================================
-- 4. request_closeouts — technician completion fields
-- (request_closeouts already exists live; these columns are additive.)
-- ============================================================
alter table public.request_closeouts
  add column if not exists technician_photos jsonb not null default '[]'::jsonb,
  add column if not exists technician_notes text,
  add column if not exists signature_url text,
  add column if not exists signed_by_name text,
  add column if not exists signed_by_role text check (signed_by_role in ('requestor','site_supervisor','other')),
  add column if not exists signed_at timestamptz,
  add column if not exists submitted_by_technician_id uuid references public.profiles(id);

-- ============================================================
-- 5. RELABEL the dormant stages for how the technician flow reads
-- (key stays the same everywhere else in the app — only the label shown
-- to users changes, exactly like "Team Assigned" already overrides
-- "Under Process" for maintenance today.)
-- ============================================================
update public.workflow_stages set label = 'Job Accepted' where key = 'dispatched';
update public.workflow_stages set label = 'Work in Progress' where key = 'on_site';

-- ============================================================
-- 6. NEW TRANSITIONS — technician-only, per category
-- ============================================================
insert into public.workflow_transitions (category, from_key, to_key, label, variant, allowed_roles, sort_order)
select c.category, t.from_key, t.to_key, t.label, t.variant, t.allowed_roles, t.sort_order
from (values ('delivery'), ('labor'), ('maintenance'), ('procurement')) as c(category)
cross join (values
  ('assigned', 'dispatched', 'Accept Job', 'primary', array['technician'], 20),
  ('dispatched', 'on_site', 'Start Job', 'primary', array['technician'], 21),
  ('on_site', 'completed', 'Mark Completed', 'primary', array['technician'], 22)
) as t(from_key, to_key, label, variant, allowed_roles, sort_order)
where not exists (
  select 1 from public.workflow_transitions wt
  where wt.category = c.category and wt.from_key = t.from_key
    and wt.to_key = t.to_key and wt.label = t.label
);

-- ============================================================
-- 7. RLS — technician can see/act on rows assigned to them, nothing else
-- (added as new, additively-OR'd policies alongside the existing
-- "requestor or staff" ones -- technician is neither, so without these
-- they'd see nothing at all, which is the safe default.)
-- ============================================================
drop policy if exists "requests select assigned technician" on public.requests;
create policy "requests select assigned technician" on public.requests
  for select using (assigned_technician_id = auth.uid());

drop policy if exists "requests update assigned technician" on public.requests;
create policy "requests update assigned technician" on public.requests
  for update using (assigned_technician_id = auth.uid());

drop policy if exists "delivery_details visible to assigned technician" on public.delivery_details;
create policy "delivery_details visible to assigned technician" on public.delivery_details
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "labor_personnel_lines visible to assigned technician" on public.labor_personnel_lines;
create policy "labor_personnel_lines visible to assigned technician" on public.labor_personnel_lines
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "maintenance_details visible to assigned technician" on public.maintenance_details;
create policy "maintenance_details visible to assigned technician" on public.maintenance_details
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "procurement_line_items visible to assigned technician" on public.procurement_line_items;
create policy "procurement_line_items visible to assigned technician" on public.procurement_line_items
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "comments visible to assigned technician" on public.comments;
create policy "comments visible to assigned technician" on public.comments
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "comments insert by assigned technician" on public.comments;
create policy "comments insert by assigned technician" on public.comments
  for insert with check (
    author_id = auth.uid() and
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "status_history visible to assigned technician" on public.status_history;
create policy "status_history visible to assigned technician" on public.status_history
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "request_closeouts visible to assigned technician" on public.request_closeouts;
create policy "request_closeouts visible to assigned technician" on public.request_closeouts
  for select using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );
