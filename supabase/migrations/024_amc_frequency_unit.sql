-- Logistics Request Management Platform — Migration 024
-- AMC contract frequency used to be a single "frequency_months" integer,
-- which can only express whole-month cadences (calendar-accurate via
-- Postgres interval math, but unable to represent weekly or twice-a-month
-- schedules). Replaces it with a (frequency_unit, frequency_value) pair:
-- 'months' keeps the exact same calendar-accurate behavior as before,
-- 'days' is new and covers Weekly (7) and Twice a month (15, an
-- approximation of a ~15-day cadence rather than calendar-anchored dates
-- like the 1st/15th).
--
-- frequency_months is left in place (unused going forward) rather than
-- dropped, so this migration can't destroy data and stays reversible.
--
-- Safe to run multiple times from the top.

alter table public.amc_contracts
  add column if not exists frequency_unit text not null default 'months' check (frequency_unit in ('days', 'months')),
  add column if not exists frequency_value int;

update public.amc_contracts
set frequency_unit = 'months',
    frequency_value = frequency_months
where frequency_value is null;

alter table public.amc_contracts
  alter column frequency_value set default 1;

alter table public.amc_contracts
  add constraint amc_contracts_frequency_value_positive check (frequency_value > 0);

-- The app no longer writes frequency_months, so it can't stay NOT NULL.
alter table public.amc_contracts
  alter column frequency_months drop not null,
  alter column frequency_months drop default;

-- Recalculates next_maintenance_date using the contract's own
-- frequency_unit/frequency_value instead of always assuming months.
create or replace function public.amc_apply_maintenance_record()
returns trigger as $$
declare
  v_unit text;
  v_value int;
begin
  select frequency_unit, frequency_value into v_unit, v_value
  from public.amc_contracts
  where id = new.contract_id;

  update public.amc_contracts
  set last_maintenance_date = new.performed_date,
      next_maintenance_date = case
        when v_unit = 'days' then (new.performed_date + (v_value || ' days')::interval)::date
        else (new.performed_date + (coalesce(v_value, 1) || ' months')::interval)::date
      end,
      updated_at = now()
  where id = new.contract_id;
  return new;
end;
$$ language plpgsql security definer;
