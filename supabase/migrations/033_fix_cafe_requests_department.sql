-- ============================================================
-- 033: Move Inflata Cafe / Urban Cafe requests to Food & Beverage
--
-- One-off data fix: requests linked to the "Inflata Cafe" and
-- "Urban Cafe" projects were created while tagged with the
-- "Logistics" department. They should actually belong to
-- "Food & Beverage". Covers both project-linked rows (project_id)
-- and any legacy rows that only ever got a plain-text `project`
-- value with no project_id.
--
-- Scoped to department = 'Logistics' so it only touches the rows
-- that need fixing and leaves anything already correctly tagged
-- alone. Safe to re-run -- a second run matches zero rows.
-- ============================================================

update public.requests r
set department = 'Food & Beverage'
where r.department = 'Logistics'
  and (
    exists (
      select 1 from public.projects p
      where p.id = r.project_id
        and p.name in ('Inflata Cafe', 'Urban Cafe')
    )
    or r.project in ('Inflata Cafe', 'Urban Cafe')
  );
