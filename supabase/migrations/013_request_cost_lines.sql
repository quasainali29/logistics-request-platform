-- Logistics Request Management Platform — Migration 013
-- Itemized cost lines per request, so managers can see what was actually
-- spent completing each request across every category (delivery,
-- maintenance, labor, procurement) instead of relying only on the
-- ad-hoc, category-specific fields captured today (labor's per-personnel
-- cost_per_labor, procurement's single total_value). Coordinators add cost
-- lines when closing out a request (see CloseoutForm.tsx); managers can
-- add or remove lines at any time afterward from the request detail page.
-- Feeds the new Cost report, gated the same way as every other report
-- page (see migration 012).
--
-- This is purely additive: labor_closeout_lines and
-- request_closeouts.total_value are untouched and keep working exactly as
-- before for their existing category-specific display.
--
-- Safe to run multiple times from the top.

create table if not exists public.request_cost_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  cost_category text not null default 'other' check (cost_category in ('materials', 'labor', 'transport', 'other')),
  description text,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists request_cost_lines_request_id_idx on public.request_cost_lines (request_id);

drop trigger if exists request_cost_lines_touch_updated_at on public.request_cost_lines;
create trigger request_cost_lines_touch_updated_at
  before update on public.request_cost_lines
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- RLS — cost data is internal/operational, so it's staff-only both ways
-- (a plain requestor shouldn't see what their request cost to fulfill).
-- ============================================================
alter table public.request_cost_lines enable row level security;

drop policy if exists "request_cost_lines readable by staff" on public.request_cost_lines;
create policy "request_cost_lines readable by staff" on public.request_cost_lines
  for select using (public.is_staff());

drop policy if exists "request_cost_lines writable by staff" on public.request_cost_lines;
create policy "request_cost_lines writable by staff" on public.request_cost_lines
  for all using (public.is_staff()) with check (public.is_staff());

-- New Cost report, gated like every other report page (migration 012).
-- Defaults to the same operational-report roles as throughput/SLA/projects
-- -- coordinators and warehouse staff need it as much as managers do to
-- understand what a request actually cost.
insert into public.permissions (key, label, category, sort_order) values
  ('view_report_cost', 'View: Cost report', 'Reports', 55)
on conflict (key) do nothing;

insert into public.role_permissions (role_name, permission_key, granted)
select r.name, 'view_report_cost', r.name in ('logistics_coordinator', 'warehouse_team', 'logistics_manager', 'main_admin')
from public.roles r
on conflict (role_name, permission_key) do update set granted = excluded.granted;
