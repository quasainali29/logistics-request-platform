-- ============================================================
-- 027: Backfill conclude_date on existing requests
--
-- The app now treats "Conclude by" (conclude_date) as the real due date
-- everywhere -- Overdue flags, the Requests list "Due" column, the
-- dashboards' Due today/Due soon/Overdue widgets, and the SLA and
-- Performance reports (see the New Request form, which now auto-fills
-- Conclude by from Date required + a priority-based offset the moment
-- both are known).
--
-- Requests created before that auto-fill existed may have Date required
-- set but no Conclude by, which would make them silently vanish from all
-- of the above (no conclude_date = never overdue, never "due"). This
-- backfills conclude_date = date_required + priority offset for exactly
-- those rows, using the same offsets as the form itself:
--   low = +7 days, medium = +4 days, high = +2 days, urgent = +1 day
-- (see PRIORITY_DUE_OFFSET_DAYS in src/lib/types.ts).
--
-- Only touches rows where conclude_date is currently null and
-- date_required is set -- never overwrites a conclude_date someone
-- already has, whether auto-filled or hand-entered.
--
-- Idempotent: safe to re-run (the "is null" guard means a second run
-- finds nothing left to update).
-- ============================================================

-- date + integer = date in Postgres, so this stays a date column (no
-- interval/timestamp cast needed).
update public.requests
set conclude_date = date_required + (
  case priority
    when 'low' then 7
    when 'medium' then 4
    when 'high' then 2
    when 'urgent' then 1
    else 4
  end
)
where conclude_date is null
  and date_required is not null;
