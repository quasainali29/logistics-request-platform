-- Logistics Request Management Platform — Migration 020
-- Multi-technician assignment: a request can now have a crew of
-- technicians instead of exactly one. Replaces the single
-- requests.assigned_technician_id column (left in place, frozen, for
-- historical/rollback safety -- just no longer written to or read from by
-- the app) with a proper join table so a job can have as many technicians
-- as it needs, each individually accepting before the request as a whole
-- advances to "Dispatched".
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. request_technicians
-- ============================================================
create table if not exists public.request_technicians (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  technician_id uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (request_id, technician_id)
);

create index if not exists request_technicians_request_id_idx
  on public.request_technicians (request_id);
create index if not exists request_technicians_technician_id_idx
  on public.request_technicians (technician_id);

alter table public.request_technicians enable row level security;

-- Backfill from the old single-technician column. Requests already past
-- "assigned" (dispatched/on_site/completed/closed) are treated as already
-- accepted -- there was no separate acceptance timestamp under the old
-- single-technician flow, so "the job moved forward" is the closest
-- available signal. Requests still sitting at "assigned" keep accepted_at
-- null, preserving the pending Accept Job state they were already in.
insert into public.request_technicians (request_id, technician_id, assigned_at, accepted_at)
select
  r.id,
  r.assigned_technician_id,
  now(),
  case when r.status in ('dispatched', 'on_site', 'completed', 'closed') then now() else null end
from public.requests r
where r.assigned_technician_id is not null
on conflict (request_id, technician_id) do nothing;

-- ============================================================
-- 2. Helper: is the current user one of this request's technicians?
-- (security definer, same pattern as public.is_staff() in schema.sql --
-- needed so this can be referenced from other tables' RLS policies
-- without a circular-RLS chicken-and-egg problem.)
-- ============================================================
create or replace function public.is_request_technician(target_request_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.request_technicians rt
    where rt.request_id = target_request_id and rt.technician_id = auth.uid()
  );
$$ language sql stable security definer;

-- ============================================================
-- 3. RLS for request_technicians itself
-- ============================================================
drop policy if exists "request_technicians select" on public.request_technicians;
create policy "request_technicians select" on public.request_technicians
  for select using (
    public.is_staff() or public.is_request_technician(request_id)
  );

drop policy if exists "request_technicians staff manage" on public.request_technicians;
create policy "request_technicians staff manage" on public.request_technicians
  for all using (public.is_staff()) with check (public.is_staff());

-- A technician can update their own row only -- used to set accepted_at
-- when they tap "Accept Job". OR'd with the staff policy above for the
-- UPDATE command specifically.
drop policy if exists "request_technicians technician accepts own" on public.request_technicians;
create policy "request_technicians technician accepts own" on public.request_technicians
  for update using (technician_id = auth.uid()) with check (technician_id = auth.uid());

-- ============================================================
-- 4. Repoint every RLS policy that used to check
-- "assigned_technician_id = auth.uid()" (migrations 018/019) at the new
-- table instead, via is_request_technician(). Same policy names, same
-- shape -- just a different technician-membership check underneath.
-- ============================================================
drop policy if exists "requests select assigned technician" on public.requests;
create policy "requests select assigned technician" on public.requests
  for select using (public.is_request_technician(id));

drop policy if exists "requests update assigned technician" on public.requests;
create policy "requests update assigned technician" on public.requests
  for update using (public.is_request_technician(id));

drop policy if exists "delivery_details visible to assigned technician" on public.delivery_details;
create policy "delivery_details visible to assigned technician" on public.delivery_details
  for select using (public.is_request_technician(request_id));

drop policy if exists "labor_personnel_lines visible to assigned technician" on public.labor_personnel_lines;
create policy "labor_personnel_lines visible to assigned technician" on public.labor_personnel_lines
  for select using (public.is_request_technician(request_id));

drop policy if exists "maintenance_details visible to assigned technician" on public.maintenance_details;
create policy "maintenance_details visible to assigned technician" on public.maintenance_details
  for select using (public.is_request_technician(request_id));

drop policy if exists "procurement_line_items visible to assigned technician" on public.procurement_line_items;
create policy "procurement_line_items visible to assigned technician" on public.procurement_line_items
  for select using (public.is_request_technician(request_id));

drop policy if exists "comments visible to assigned technician" on public.comments;
create policy "comments visible to assigned technician" on public.comments
  for select using (public.is_request_technician(request_id));

drop policy if exists "comments insert by assigned technician" on public.comments;
create policy "comments insert by assigned technician" on public.comments
  for insert with check (
    author_id = auth.uid() and public.is_request_technician(request_id)
  );

drop policy if exists "status_history visible to assigned technician" on public.status_history;
create policy "status_history visible to assigned technician" on public.status_history
  for select using (public.is_request_technician(request_id));

drop policy if exists "request_closeouts visible to assigned technician" on public.request_closeouts;
create policy "request_closeouts visible to assigned technician" on public.request_closeouts
  for select using (public.is_request_technician(request_id));

drop policy if exists "request_closeouts writable by assigned technician" on public.request_closeouts;
create policy "request_closeouts writable by assigned technician" on public.request_closeouts
  for insert with check (public.is_request_technician(request_id));

drop policy if exists "request_closeouts updatable by assigned technician" on public.request_closeouts;
create policy "request_closeouts updatable by assigned technician" on public.request_closeouts
  for update using (public.is_request_technician(request_id));
