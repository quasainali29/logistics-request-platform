-- ============================================================
-- 030: Let assigned technicians see verification feedback
--
-- Migration 028's request_verifications select policy only allowed the
-- requestor or staff (is_staff()) to read a request's verification row.
-- Every sibling table (request_closeouts, comments, status_history, etc,
-- added in migration 020) also lets the assigned crew read via
-- is_request_technician(request_id) -- that OR branch was missed here.
--
-- Without it, a technician whose work was marked "Not Satisfactory" and
-- reassigned to them can't see the requester's comment/photo explaining
-- what's wrong: the row exists, but RLS silently filters it out before
-- it reaches the page (no error -- just an empty result).
--
-- Idempotent: safe to re-run.
-- ============================================================

drop policy if exists "request_verifications follow request" on public.request_verifications;
create policy "request_verifications follow request" on public.request_verifications
  for select using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
    or public.is_request_technician(request_id)
  );

-- One-time backfill: reopenForRework previously reset a request's status
-- back to "assigned" without clearing the crew's accepted_at, so any
-- request already reopened for rework before this fix is stuck (no
-- Accept button since they're already accepted, no dispatched transition
-- since status never advances). Reset acceptance only for crew on
-- requests that are currently "assigned" AND have a "not_satisfactory"
-- verification on file -- this can't touch a normal freshly-assigned
-- request, since those never have a verification row yet.
update public.request_technicians
set accepted_at = null
where request_id in (
  select r.id from public.requests r
  where r.status = 'assigned'
    and exists (
      select 1 from public.request_verifications v
      where v.request_id = r.id and v.decision = 'not_satisfactory'
    )
);
