-- Logistics Request Management Platform — Migration 022
-- The "Coordinator Workload" report (migration 012's view_report_coordinator
-- permission) has been merged into a new, richer "Logistics Performance"
-- report page (src/app/(app)/reports/performance/page.tsx) with three
-- views: an org-wide Overview, a per-coordinator breakdown, and a new
-- per-technician breakdown -- all reusing the same completion/SLA/overall
-- performance KPI methodology already built for the coordinator and
-- technician dashboards.
--
-- No new permission key is introduced: the existing view_report_coordinator
-- key now gates the whole merged report page (all three views), so every
-- role/grant that already had access to Coordinator Workload keeps access
-- automatically. This migration only relabels that permission so the
-- Admin > Permissions matrix reflects its new scope.
--
-- Purely cosmetic (a label update, not a schema change) -- safe to run at
-- any time, and the report works correctly even before this runs.
-- Safe to run multiple times from the top.

update public.permissions
set label = 'View: Logistics Performance report (coordinator + technician)'
where key = 'view_report_coordinator';
