-- ============================================================
-- 029: Allow 'technician' as a signed_by_role on request_closeouts
--
-- Migration 018 added request_closeouts.signed_by_role with
-- check (signed_by_role in ('requestor','site_supervisor','other')).
-- The new completion-verification flow (028) has the technician sign
-- for themselves and writes signed_by_role = 'technician', which that
-- constraint rejects ("request_closeouts_signed_by_role_check").
--
-- This drops and recreates the same check with 'technician' added to
-- the allowed list. No data is touched -- existing rows keep whatever
-- value they already have (all of which are already in the allowed set).
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.request_closeouts
  drop constraint if exists request_closeouts_signed_by_role_check;

alter table public.request_closeouts
  add constraint request_closeouts_signed_by_role_check
  check (signed_by_role in ('requestor', 'site_supervisor', 'other', 'technician'));
