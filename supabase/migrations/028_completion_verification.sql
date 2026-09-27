-- ============================================================
-- 028: Requester verification of completed work
--
-- Adds a step between the technician marking a job "Completed" and the
-- coordinator being able to close it: the requester must review the work
-- and either confirm it (photo + signature) or flag it "Not Satisfactory"
-- (a comment on what's pending, plus an optional photo). A "Not
-- Satisfactory" verdict routes back to the coordinator to review and
-- reassign the technician.
--
-- Deliberately does NOT touch workflow_stages/workflow_transitions or any
-- category check constraint -- no new status keys are introduced. The
-- request's `status` column keeps using the existing "completed" value
-- for this entire review window; which of the three states (pending /
-- verified / not satisfactory) it's actually in is derived at read time
-- from the latest row here, compared against request_closeouts.signed_at
-- (so a rework cycle's fresh technician completion correctly re-opens
-- verification even though an older "not satisfactory" row still exists).
-- This sidesteps the composite requests_status_fkey gotcha entirely (see
-- the Gotchas section of the rebuild guide) -- there's nothing to seed.
--
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists public.request_verifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  decision text not null check (decision in ('satisfactory', 'not_satisfactory')),
  comment text,
  photo_url text,
  signature_url text,
  verified_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists request_verifications_request_id_idx
  on public.request_verifications (request_id);

alter table public.request_verifications enable row level security;

drop policy if exists "request_verifications follow request" on public.request_verifications;
create policy "request_verifications follow request" on public.request_verifications
  for select using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- Only the request's own requester can log a verification, and only as
-- themselves -- staff review the result but don't submit it on the
-- requester's behalf.
drop policy if exists "request_verifications insert by requester" on public.request_verifications;
create policy "request_verifications insert by requester" on public.request_verifications
  for insert with check (
    verified_by = auth.uid()
    and exists (select 1 from public.requests r where r.id = request_id and r.requestor_id = auth.uid())
  );
