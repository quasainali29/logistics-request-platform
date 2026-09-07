-- Logistics Request Management Platform — Migration 023
-- Configurable email reminders for AMC contracts, sent from the existing
-- daily cron (src/app/api/cron/daily-digest/route.ts) to a manager-managed
-- list of recipient email addresses -- not tied to any particular user's
-- account, since the people who want these reminders aren't necessarily
-- platform users (e.g. a facilities inbox).
--
-- Two tables:
--  - amc_reminder_recipients: the plain list of email addresses to notify.
--  - amc_reminder_rules: one row per selectable preset (e.g. "7 days
--    before due"), each independently enabled/disabled. Seeded with every
--    preset offered in the UI so toggling is just an update, never an
--    insert/delete from the app.
--
-- Safe to run multiple times from the top.

create table if not exists public.amc_reminder_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table if not exists public.amc_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  -- due_soon: before amc_contracts.next_maintenance_date
  -- expiry:   before amc_contracts.contract_end
  -- overdue:  once, the day after next_maintenance_date passes with no
  --           visit logged -- days_before is always 0 for this type, kept
  --           only so the row shape matches the other two types.
  reminder_type text not null check (reminder_type in ('due_soon', 'expiry', 'overdue')),
  days_before int not null default 0,
  enabled boolean not null default true,
  unique (reminder_type, days_before)
);

alter table public.amc_reminder_recipients enable row level security;
alter table public.amc_reminder_rules enable row level security;

drop policy if exists "amc_reminder_recipients readable" on public.amc_reminder_recipients;
create policy "amc_reminder_recipients readable" on public.amc_reminder_recipients
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_reminder_recipients writable by manager" on public.amc_reminder_recipients;
create policy "amc_reminder_recipients writable by manager" on public.amc_reminder_recipients
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "amc_reminder_rules readable" on public.amc_reminder_rules;
create policy "amc_reminder_rules readable" on public.amc_reminder_rules
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_reminder_rules writable by manager" on public.amc_reminder_rules;
create policy "amc_reminder_rules writable by manager" on public.amc_reminder_rules
  for all using (public.is_manager()) with check (public.is_manager());

insert into public.amc_reminder_rules (reminder_type, days_before, enabled) values
  ('due_soon', 7, true),
  ('due_soon', 3, true),
  ('due_soon', 1, true),
  ('expiry', 30, true),
  ('expiry', 15, true),
  ('expiry', 7, true),
  ('overdue', 0, true)
on conflict (reminder_type, days_before) do nothing;
