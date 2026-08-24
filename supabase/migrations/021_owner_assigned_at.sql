-- Logistics Request Management Platform — Migration 021
-- Adds owner_assigned_at, the coordinator-side equivalent of
-- request_technicians.assigned_at: a timestamp recording when a request
-- was last routed to its current coordinator (owner_id), so dashboards can
-- show "new requests" (assigned recently) rather than just "requests
-- touched recently" (updated_at changes on unrelated edits too -- cost
-- lines, comments, technician assignment -- so it can't stand in for this).
--
-- Safe to run multiple times from the top.

alter table public.requests
  add column if not exists owner_assigned_at timestamptz;

-- One-time backfill for existing rows that already have an owner: best
-- available approximation is updated_at, since we have no real history of
-- when owner_id was actually set. Only backfills currently-unset rows, so
-- rerunning this migration never clobbers a real value written after this
-- point by the app code below.
update public.requests
set owner_assigned_at = updated_at
where owner_id is not null and owner_assigned_at is null;
