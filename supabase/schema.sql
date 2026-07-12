-- Logistics Request Management Platform — Supabase schema
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query) on a fresh project.

create extension if not exists "btree_gist";
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES (extends Supabase Auth users with role/department)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('requestor','logistics_coordinator','logistics_manager','warehouse_team')),
  department text check (department in ('logistics','operations','it','marketing','production')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
-- New users default to 'requestor' — an admin (Logistics Manager) upgrades roles afterward.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'requestor')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: current user's role, used by RLS policies below.
create function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create function public.is_staff()
returns boolean as $$
  select public.current_role() in ('logistics_coordinator','logistics_manager','warehouse_team');
$$ language sql stable security definer;

-- ============================================================
-- 2. PROJECTS
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  status text not null default 'active' check (status in ('active','completed','on_hold')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. REQUESTS (central table)
-- ============================================================
create sequence public.request_number_seq start 1;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  request_number text unique not null default ('REQ-' || lpad(nextval('public.request_number_seq')::text, 5, '0')),
  title text not null,
  category text not null check (category in ('delivery','labor','maintenance','procurement')),
  requestor_id uuid not null references public.profiles(id),
  project_id uuid references public.projects(id),
  department text check (department in ('logistics','operations','it','marketing','production')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'submitted' check (status in (
    'submitted','under_review','returned_for_info','approved','planning',
    'assigned','dispatched','on_site','completed','closed','rejected'
  )),
  date_requested date not null default current_date,
  date_required date,
  description text,
  special_instructions text,
  owner_id uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approval_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.requests (status);
create index on public.requests (category);
create index on public.requests (requestor_id);
create index on public.requests (date_required);

-- Keep updated_at fresh.
create function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger requests_touch_updated_at
  before update on public.requests
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- 4. CATEGORY DETAIL TABLES
-- ============================================================
create table public.delivery_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  delivery_location text,
  requested_date date,
  files jsonb not null default '[]'
);

create table public.labor_personnel_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  personnel_type text check (personnel_type in ('labor','welder','carpenter','rigger','electrician')),
  quantity int not null default 1,
  date_from date,
  date_to date,
  nature_of_work text check (nature_of_work in ('loading_unloading','setup_installation','removal_dismantling'))
);

create table public.maintenance_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  location_area text,
  issue_category text,
  urgency text check (urgency in ('low','medium','high')),
  photos jsonb not null default '[]'
);

create table public.procurement_line_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  item_description text,
  quantity int not null default 1,
  unit_cost numeric(12,2),
  purchasing_category text check (purchasing_category in ('tools','it_equipment','av_equipment','electrical_equipment','other')),
  vendor text,
  approved_pr_file jsonb not null default '[]'
);

-- ============================================================
-- 5. FLEET & WAREHOUSE RESOURCES
-- ============================================================
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_name text not null,
  type text check (type in ('truck','van','forklift','other')),
  status text not null default 'available' check (status in ('available','on_trip','in_maintenance','unavailable')),
  registration_expiry date,
  insurance_expiry date,
  next_service_due date
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  license_number text,
  license_expiry date,
  status text not null default 'available' check (status in ('available','on_trip','on_leave','unavailable'))
);

create table public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  category text check (category in ('tools','it_equipment','av_equipment','electrical_equipment','other')),
  total_stock int not null default 0,
  available_stock int not null default 0,
  warehouse_location text
);

-- ============================================================
-- 6. RESOURCE ASSIGNMENTS (booking + conflict prevention)
-- ============================================================
create table public.resource_assignments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  resource_type text not null check (resource_type in ('vehicle','driver','equipment')),
  vehicle_id uuid references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  equipment_id uuid references public.equipment_items(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'reserved' check (status in ('reserved','dispatched','returned','completed')),
  logged_by uuid references public.profiles(id)
);

-- The whole point of this table: a vehicle/driver can't be double-booked for
-- an overlapping time window. Postgres enforces this at the database level.
alter table public.resource_assignments
  add constraint no_overlap_vehicle exclude using gist (
    vehicle_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (vehicle_id is not null and status not in ('returned','completed'));

alter table public.resource_assignments
  add constraint no_overlap_driver exclude using gist (
    driver_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (driver_id is not null and status not in ('returned','completed'));

-- ============================================================
-- 7. COMMENTS & AUDIT TRAIL
-- ============================================================
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  comment text not null,
  posted_at timestamptz not null default now()
);

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  status text not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  notes text
);

-- Auto-log every status change — append-only audit trail (Phase 3 design).
create function public.log_status_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into public.status_history (request_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger requests_log_status
  after insert or update on public.requests
  for each row execute procedure public.log_status_change();

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.requests enable row level security;
alter table public.delivery_details enable row level security;
alter table public.labor_personnel_lines enable row level security;
alter table public.maintenance_details enable row level security;
alter table public.procurement_line_items enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.equipment_items enable row level security;
alter table public.resource_assignments enable row level security;
alter table public.comments enable row level security;
alter table public.status_history enable row level security;

-- Profiles: everyone can read (needed to show names/assign owners); users edit only their own row.
create policy "profiles are viewable by all authenticated users" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "users can update their own profile" on public.profiles
  for update using (id = auth.uid());

-- Projects: readable by all; writable by staff.
create policy "projects readable by authenticated" on public.projects
  for select using (auth.role() = 'authenticated');
create policy "projects writable by staff" on public.projects
  for all using (public.is_staff()) with check (public.is_staff());

-- Requests: a Requestor sees their own; staff see everything.
create policy "requests select own or staff" on public.requests
  for select using (requestor_id = auth.uid() or public.is_staff());
create policy "requests insert own" on public.requests
  for insert with check (requestor_id = auth.uid());
create policy "requests update own while editable or staff" on public.requests
  for update using (
    (requestor_id = auth.uid() and status in ('submitted','returned_for_info'))
    or public.is_staff()
  );

-- Category detail tables: follow the parent request's visibility.
create policy "delivery_details follow request" on public.delivery_details
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );
create policy "labor_personnel_lines follow request" on public.labor_personnel_lines
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );
create policy "maintenance_details follow request" on public.maintenance_details
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );
create policy "procurement_line_items follow request" on public.procurement_line_items
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- Fleet & warehouse: readable by all authenticated; writable by staff.
create policy "vehicles readable" on public.vehicles for select using (auth.role() = 'authenticated');
create policy "vehicles writable by staff" on public.vehicles for all using (public.is_staff()) with check (public.is_staff());
create policy "drivers readable" on public.drivers for select using (auth.role() = 'authenticated');
create policy "drivers writable by staff" on public.drivers for all using (public.is_staff()) with check (public.is_staff());
create policy "equipment readable" on public.equipment_items for select using (auth.role() = 'authenticated');
create policy "equipment writable by staff" on public.equipment_items for all using (public.is_staff()) with check (public.is_staff());

-- Resource assignments: readable by all; writable by staff only.
create policy "resource_assignments readable" on public.resource_assignments
  for select using (auth.role() = 'authenticated');
create policy "resource_assignments writable by staff" on public.resource_assignments
  for all using (public.is_staff()) with check (public.is_staff());

-- Comments: readable/writable by anyone who can see the parent request.
create policy "comments follow request" on public.comments
  for select using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );
create policy "comments insert by visible-request participants" on public.comments
  for insert with check (
    author_id = auth.uid() and
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- Status history: read-only audit trail, visible to whoever can see the request.
create policy "status_history follow request" on public.status_history
  for select using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- ============================================================
-- 9. SEED DATA (optional — remove or edit before going live)
-- ============================================================
insert into public.vehicles (vehicle_name, type, status, registration_expiry, insurance_expiry, next_service_due) values
  ('Truck 01 - Hilux', 'truck', 'available', '2027-03-15', '2027-01-10', '2026-09-01'),
  ('Van 02 - Transit', 'van', 'available', '2026-07-25', '2026-08-05', '2026-10-15'),
  ('Forklift 01', 'forklift', 'available', null, null, '2026-08-01');

insert into public.drivers (full_name, phone, license_number, license_expiry, status) values
  ('Ahmed Khan', '+92-300-1234567', 'DL-4471', '2027-02-01', 'available'),
  ('Bilal Ahmed', '+92-300-7654321', 'DL-9987', '2026-07-30', 'available');

insert into public.equipment_items (item_name, category, total_stock, available_stock, warehouse_location) values
  ('Projector - Epson', 'av_equipment', 5, 4, 'Main Warehouse'),
  ('Cordless Drill Set', 'tools', 10, 8, 'Main Warehouse');
