-- ============================================================
-- 026: Seed workflow stages + transitions for Installation / Buildup
--
-- Fixes a bug in migration 025: `requests` has a composite foreign key
-- (requests_status_fkey, added in migration 003) requiring every
-- (category, status) pair to exist in workflow_stages. Migration 025's
-- comment claimed Installation would just show an empty, admin-editable
-- Workflow tab -- that was wrong. With zero workflow_stages rows for
-- 'installation', every single new Installation request violates that FK
-- on insert (status defaults to 'submitted', which doesn't exist yet for
-- this category) and the request is never created.
--
-- This seeds the exact same 11 stages + 11 transitions the other four
-- categories already have (mirroring migration 003 verbatim), so
-- Installation behaves identically to Delivery/Labor/Maintenance/
-- Procurement out of the box. An admin can still edit/reorder/add to
-- these afterward from Admin > Workflow, same as any other category.
--
-- Idempotent: safe to re-run (on conflict / where not exists guards,
-- same as migration 003).
--
-- Also widens workflow_stages.category and workflow_transitions.category,
-- each of which carries its own separate check constraint listing only
-- the original four categories (migration 003) -- migration 025 only
-- widened the one on `requests.category` and missed these two, which
-- would otherwise reject the inserts below.
-- ============================================================

alter table public.workflow_stages drop constraint if exists workflow_stages_category_check;
alter table public.workflow_stages add constraint workflow_stages_category_check
  check (category in ('delivery','labor','maintenance','procurement','installation'));

alter table public.workflow_transitions drop constraint if exists workflow_transitions_category_check;
alter table public.workflow_transitions add constraint workflow_transitions_category_check
  check (category in ('delivery','labor','maintenance','procurement','installation'));

insert into public.workflow_stages (category, key, label, color, sort_order, is_initial, is_terminal)
values
  ('installation', 'submitted', 'Submitted', 'bg-slate-100 text-slate-700', 0, true, false),
  ('installation', 'under_review', 'Under Review', 'bg-amber-100 text-amber-800', 1, false, false),
  ('installation', 'returned_for_info', 'Returned for Info', 'bg-orange-100 text-orange-800', 2, false, false),
  ('installation', 'approved', 'Approved', 'bg-blue-100 text-blue-800', 3, false, false),
  ('installation', 'rejected', 'Rejected', 'bg-red-100 text-red-800', 4, false, true),
  ('installation', 'planning', 'Planning', 'bg-indigo-100 text-indigo-800', 5, false, false),
  ('installation', 'assigned', 'Assigned', 'bg-indigo-100 text-indigo-800', 6, false, false),
  ('installation', 'dispatched', 'Dispatched', 'bg-purple-100 text-purple-800', 7, false, false),
  ('installation', 'on_site', 'On Site', 'bg-purple-100 text-purple-800', 8, false, false),
  ('installation', 'completed', 'Completed', 'bg-emerald-100 text-emerald-800', 9, false, true),
  ('installation', 'closed', 'Closed', 'bg-slate-200 text-slate-600', 10, false, true)
on conflict (category, key) do nothing;

insert into public.workflow_transitions (category, from_key, to_key, label, variant, allowed_roles, sort_order)
select 'installation', t.from_key, t.to_key, t.label, t.variant, t.allowed_roles, t.sort_order
from (values
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
  where wt.category = 'installation' and wt.from_key = t.from_key
    and wt.to_key = t.to_key and wt.label = t.label
);
