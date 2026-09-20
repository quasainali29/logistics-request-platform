-- ============================================================
-- 025: Installation / Buildup category
--
-- Adds a 5th request category, "installation" ("Installation / Buildup"),
-- alongside the existing delivery / labor / maintenance / procurement.
-- Modeled as a hybrid of Delivery (site + schedule + item list) and Labor
-- (crew/personnel lines), since installation/buildup jobs typically need
-- both equipment/materials going on site AND a crew to put it up.
--
-- 1. `requests.category` check constraint widened to allow 'installation'.
-- 2. `installation_details` -- one row per request: site location +
--    scheduled date/time (mirrors delivery_details).
-- 3. `installation_items` -- the requester-filled table of what's being
--    installed (mirrors delivery_items exactly).
-- 4. `installation_crew_lines` -- the crew/personnel needed to do the
--    install/buildup (mirrors labor_personnel_lines exactly, including
--    reusing the same personnel_type + nature_of_work value sets).
--
-- No changes needed to workflow_stages/workflow_transitions -- Admin >
-- Workflow already lets a manager add stages/transitions for any category
-- through its own UI; it'll just show an empty "Installation / Buildup"
-- tab until someone configures it there.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Widen the category check constraint -----------------------------------
alter table public.requests drop constraint if exists requests_category_check;
alter table public.requests add constraint requests_category_check
  check (category in ('delivery','labor','maintenance','procurement','installation'));

-- 2. Installation details (site + schedule, one row per request) -----------
create table if not exists public.installation_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade unique,
  site_location text,
  scheduled_date date,
  scheduled_time time,
  files jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists installation_details_request_id_idx
  on public.installation_details (request_id);

alter table public.installation_details enable row level security;

drop policy if exists "installation_details follow request" on public.installation_details;
create policy "installation_details follow request" on public.installation_details
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- 3. Installation items (what's being installed) ---------------------------
create table if not exists public.installation_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  item_no int not null,
  item_name text not null,
  required_quantity numeric(12,2) not null default 1,
  image_url text,
  current_location text,
  created_at timestamptz not null default now()
);

create index if not exists installation_items_request_id_idx
  on public.installation_items (request_id);

alter table public.installation_items enable row level security;

drop policy if exists "installation_items follow request" on public.installation_items;
create policy "installation_items follow request" on public.installation_items
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- 4. Installation crew lines (personnel needed) -----------------------------
create table if not exists public.installation_crew_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  personnel_type text check (personnel_type in ('labor','welder','carpenter','rigger','electrician')),
  quantity int not null default 1,
  date_from date,
  date_to date,
  nature_of_work text check (nature_of_work in ('loading_unloading','setup_installation','removal_dismantling')),
  created_at timestamptz not null default now()
);

create index if not exists installation_crew_lines_request_id_idx
  on public.installation_crew_lines (request_id);

alter table public.installation_crew_lines enable row level security;

drop policy if exists "installation_crew_lines follow request" on public.installation_crew_lines;
create policy "installation_crew_lines follow request" on public.installation_crew_lines
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );
