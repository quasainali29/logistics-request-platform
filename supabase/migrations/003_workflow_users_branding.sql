-- Logistics Request Management Platform — Migration 003
-- Adds: (1) a fully admin-configurable workflow builder (stages + transitions
-- per request category, replacing the hardcoded status pipeline), (2) storage
-- + settings needed for admin user invite/deactivate/delete, (3) branding
-- (logo, accent color, org name).
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. WORKFLOW STAGES (per-category, admin editable)
-- ============================================================
create table if not exists public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('delivery','labor','maintenance','procurement')),
  key text not null,
  label text not null,
  color text not null default 'bg-slate-100 text-slate-700',
  sort_order int not null default 0,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  unique (category, key)
);

-- Seed every category with the exact pipeline the app already runs today,
-- so turning this migration on changes nothing until an admin edits it.
insert into public.workflow_stages (category, key, label, color, sort_order, is_initial, is_terminal)
select c.category, s.key, s.label, s.color, s.sort_order, s.is_initial, s.is_terminal
from (values ('delivery'), ('labor'), ('maintenance'), ('procurement')) as c(category)
cross join (values
  ('submitted', 'Submitted', 'bg-slate-100 text-slate-700', 0, true, false),
  ('under_review', 'Under Review', 'bg-amber-100 text-amber-800', 1, false, false),
  ('returned_for_info', 'Returned for Info', 'bg-orange-100 text-orange-800', 2, false, false),
  ('approved', 'Approved', 'bg-blue-100 text-blue-800', 3, false, false),
  ('rejected', 'Rejected', 'bg-red-100 text-red-800', 4, false, true),
  ('planning', 'Planning', 'bg-indigo-100 text-indigo-800', 5, false, false),
  ('assigned', 'Assigned', 'bg-indigo-100 text-indigo-800', 6, false, false),
  ('dispatched', 'Dispatched', 'bg-purple-100 text-purple-800', 7, false, false),
  ('on_site', 'On Site', 'bg-purple-100 text-purple-800', 8, false, false),
  ('completed', 'Completed', 'bg-emerald-100 text-emerald-800', 9, false, true),
  ('closed', 'Closed', 'bg-slate-200 text-slate-600', 10, false, true)
) as s(key, label, color, sort_order, is_initial, is_terminal)
on conflict (category, key) do nothing;

-- ============================================================
-- 2. WORKFLOW TRANSITIONS (which button appears, who can click it)
-- ============================================================
create table if not exists public.workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('delivery','labor','maintenance','procurement')),
  from_key text not null,
  to_key text not null,
  label text not null,
  variant text not null default 'primary' check (variant in ('primary','danger','secondary')),
  allowed_roles text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (category, from_key) references public.workflow_stages(category, key) on delete cascade,
  foreign key (category, to_key) references public.workflow_stages(category, key) on delete cascade
);

-- Seed the exact transitions/role-gates that were previously hardcoded in
-- the request detail page, for every category.
insert into public.workflow_transitions (category, from_key, to_key, label, variant, allowed_roles, sort_order)
select c.category, t.from_key, t.to_key, t.label, t.variant, t.allowed_roles, t.sort_order
from (values ('delivery'), ('labor'), ('maintenance'), ('procurement')) as c(category)
cross join (values
  ('under_review', 'approved', 'Approve', 'primary', array['logistics_manager'], 0),
  ('under_review', 'rejected', 'Reject', 'danger', array['logistics_manager'], 1),
  ('submitted', 'under_review', 'Move to Under Review', 'primary', array['logistics_coordinator','logistics_manager'], 2),
  ('submitted', 'returned_for_info', 'Return for Info', 'secondary', array['logistics_coordinator','logistics_manager'], 3),
  ('under_review', 'returned_for_info', 'Return for Info', 'secondary', array['logistics_coordinator','logistics_manager'], 4),
  ('approved', 'planning', 'Move to Planning', 'primary', array['logistics_coordinator','logistics_manager'], 5),
  ('planning', 'assigned', 'Mark Resources Assigned', 'primary', array['logistics_coordinator','logistics_manager'], 6),
  ('assigned', 'dispatched', 'Mark Dispatched', 'primary', array['logistics_coordinator','warehouse_team'], 7),
  ('dispatched', 'on_site', 'Mark On Site', 'primary', array['logistics_coordinator','warehouse_team'], 8),
  ('on_site', 'completed', 'Mark Completed', 'primary', array['logistics_coordinator','warehouse_team'], 9),
  ('completed', 'closed', 'Close Request', 'primary', array['logistics_coordinator','logistics_manager'], 10)
) as t(from_key, to_key, label, variant, allowed_roles, sort_order)
where not exists (
  select 1 from public.workflow_transitions wt
  where wt.category = c.category and wt.from_key = t.from_key
    and wt.to_key = t.to_key and wt.label = t.label
);

-- Swap the fixed status check-constraint for a composite FK into
-- workflow_stages, so status is validated per-category against whatever
-- an admin has configured.
alter table public.requests drop constraint if exists requests_status_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'requests_status_fkey'
  ) then
    alter table public.requests
      add constraint requests_status_fkey foreign key (category, status)
      references public.workflow_stages(category, key);
  end if;
end $$;

-- ============================================================
-- 3. APP SETTINGS (branding) — singleton row
-- ============================================================
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  org_name text not null default 'Logistics Platform',
  logo_url text,
  accent_color text not null default '#1f4e78',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- 4. STORAGE BUCKET FOR LOGOS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding public read" on storage.objects;
create policy "branding public read" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "branding managers upload" on storage.objects;
create policy "branding managers upload" on storage.objects
  for insert with check (bucket_id = 'branding' and public.is_manager());

drop policy if exists "branding managers update" on storage.objects;
create policy "branding managers update" on storage.objects
  for update using (bucket_id = 'branding' and public.is_manager());

drop policy if exists "branding managers delete" on storage.objects;
create policy "branding managers delete" on storage.objects
  for delete using (bucket_id = 'branding' and public.is_manager());

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.workflow_stages enable row level security;
alter table public.workflow_transitions enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "workflow_stages readable by authenticated" on public.workflow_stages;
create policy "workflow_stages readable by authenticated" on public.workflow_stages
  for select using (auth.role() = 'authenticated');
drop policy if exists "workflow_stages writable by managers" on public.workflow_stages;
create policy "workflow_stages writable by managers" on public.workflow_stages
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "workflow_transitions readable by authenticated" on public.workflow_transitions;
create policy "workflow_transitions readable by authenticated" on public.workflow_transitions
  for select using (auth.role() = 'authenticated');
drop policy if exists "workflow_transitions writable by managers" on public.workflow_transitions;
create policy "workflow_transitions writable by managers" on public.workflow_transitions
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "app_settings readable by all" on public.app_settings;
create policy "app_settings readable by all" on public.app_settings
  for select using (true);
drop policy if exists "app_settings writable by managers" on public.app_settings;
create policy "app_settings writable by managers" on public.app_settings
  for update using (public.is_manager());
