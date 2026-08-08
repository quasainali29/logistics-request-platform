-- Logistics Request Management Platform — Migration 019
-- Bug fix for migration 018: technicians could SELECT their assigned
-- request's request_closeouts row, but had no INSERT/UPDATE policy on it.
-- Their "Mark Completed" submission's upsert (photos, signature, notes)
-- was therefore silently blocked by RLS, while the separate status update
-- to "completed" succeeded anyway (that one *was* correctly permitted) —
-- so the request looked done, but the photos/signature never actually
-- saved. This adds the missing write policy.
--
-- Safe to run multiple times from the top.

drop policy if exists "request_closeouts writable by assigned technician" on public.request_closeouts;
create policy "request_closeouts writable by assigned technician" on public.request_closeouts
  for insert with check (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );

drop policy if exists "request_closeouts updatable by assigned technician" on public.request_closeouts;
create policy "request_closeouts updatable by assigned technician" on public.request_closeouts
  for update using (
    exists (select 1 from public.requests r where r.id = request_id and r.assigned_technician_id = auth.uid())
  );
