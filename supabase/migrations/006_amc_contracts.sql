-- Logistics Request Management Platform — Migration 006
-- Annual Maintenance Contracts (AMC) tracker: locations and AMC types are
-- admin-manageable lists (not hardcoded), contracts carry the full agreed
-- field set (supplier, schedule, financials, SLA), and every maintenance
-- visit logged against a contract auto-recalculates its next due date.
--
-- Safe to run multiple times from the top.

-- ============================================================
-- 1. LOOKUP LISTS — locations and AMC types are extensible from the UI
-- ============================================================
create table if not exists public.amc_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table if not exists public.amc_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Some AMC types (e.g. Firefighting, CCTV) carry a compliance
  -- certificate per visit; others (e.g. HVAC) usually don't. This just
  -- controls whether the compliance fields are shown/expected in the UI —
  -- it isn't enforced at the database level.
  requires_compliance boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- ============================================================
-- 2. CONTRACTS
-- ============================================================
create table if not exists public.amc_contracts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.amc_locations(id) on delete restrict,
  type_id uuid not null references public.amc_types(id) on delete restrict,

  supplier_name text not null,
  supplier_contact_name text,
  supplier_phone text,
  supplier_email text,

  frequency_months int not null default 3 check (frequency_months > 0),
  sla_response_hours int,

  payment_terms text,
  contract_value numeric(12,2),
  currency text not null default 'AED',

  contract_start date,
  contract_end date,

  internal_owner_id uuid references public.profiles(id),

  last_maintenance_date date,
  next_maintenance_date date not null,

  notes text,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists amc_contracts_location_idx on public.amc_contracts (location_id);
create index if not exists amc_contracts_type_idx on public.amc_contracts (type_id);
create index if not exists amc_contracts_next_maintenance_idx on public.amc_contracts (next_maintenance_date);

drop trigger if exists amc_contracts_touch_updated_at on public.amc_contracts;
create trigger amc_contracts_touch_updated_at
  before update on public.amc_contracts
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- 3. MAINTENANCE HISTORY (one row per visit, with the uploaded report)
-- ============================================================
create table if not exists public.amc_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.amc_contracts(id) on delete cascade,
  performed_date date not null default current_date,
  report_files jsonb not null default '[]',
  -- Only populated for AMC types where requires_compliance is true.
  compliance_certificate_no text,
  compliance_authority text,
  compliance_valid_until date,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists amc_maintenance_records_contract_idx on public.amc_maintenance_records (contract_id);

-- Every time a visit is logged, roll the parent contract's
-- last/next maintenance dates forward automatically.
create or replace function public.amc_apply_maintenance_record()
returns trigger as $$
begin
  update public.amc_contracts
  set last_maintenance_date = new.performed_date,
      next_maintenance_date = (new.performed_date + (frequency_months || ' months')::interval)::date,
      updated_at = now()
  where id = new.contract_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists amc_maintenance_record_updates_contract on public.amc_maintenance_records;
create trigger amc_maintenance_record_updates_contract
  after insert on public.amc_maintenance_records
  for each row execute procedure public.amc_apply_maintenance_record();

-- ============================================================
-- 4. RLS — readable by any authenticated user, writable by staff
-- ============================================================
alter table public.amc_locations enable row level security;
alter table public.amc_types enable row level security;
alter table public.amc_contracts enable row level security;
alter table public.amc_maintenance_records enable row level security;

drop policy if exists "amc_locations readable" on public.amc_locations;
create policy "amc_locations readable" on public.amc_locations
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_locations writable by staff" on public.amc_locations;
create policy "amc_locations writable by staff" on public.amc_locations
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "amc_types readable" on public.amc_types;
create policy "amc_types readable" on public.amc_types
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_types writable by staff" on public.amc_types;
create policy "amc_types writable by staff" on public.amc_types
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "amc_contracts readable" on public.amc_contracts;
create policy "amc_contracts readable" on public.amc_contracts
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_contracts writable by staff" on public.amc_contracts;
create policy "amc_contracts writable by staff" on public.amc_contracts
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "amc_maintenance_records readable" on public.amc_maintenance_records;
create policy "amc_maintenance_records readable" on public.amc_maintenance_records
  for select using (auth.role() = 'authenticated');
drop policy if exists "amc_maintenance_records writable by staff" on public.amc_maintenance_records;
create policy "amc_maintenance_records writable by staff" on public.amc_maintenance_records
  for all using (public.is_staff()) with check (public.is_staff());

-- ============================================================
-- 5. SEED DATA — the 3 locations and 4 AMC types already in use
-- ============================================================
insert into public.amc_locations (name) values
  ('Kids Driving School'),
  ('Inflata Cafe'),
  ('Urban Arena')
on conflict (name) do nothing;

insert into public.amc_types (name, requires_compliance) values
  ('HVAC', false),
  ('Duct Cleaning', false),
  ('Firefighting', true),
  ('CCTV', true)
on conflict (name) do nothing;
