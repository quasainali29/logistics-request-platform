-- ============================================================
-- 005: Procurement form upgrades + Labor "nature of work" per row
--
-- Labor needs no schema change: `nature_of_work` already exists as a column
-- on `labor_personnel_lines` from the original schema (it was previously
-- just set to the same request-wide value on every row) — this migration
-- only touches Procurement.
--
-- Procurement gets:
--  - A request-level `procurement_details` row for purchasing category
--    (+ a free-text "Other" specify field) and a "needed by" date, mirroring
--    the delivery_details / maintenance_details pattern from migration 004.
--  - New columns on `procurement_line_items` for the new items table
--    (Item no. | Item name | Required Quantity | Image reference |
--    Purchasing link). `item_description` doubles as "Item name" and
--    `quantity` as "Required Quantity" — no rename needed. The old
--    `unit_cost` / `purchasing_category` / `vendor` per-row columns are kept
--    for backward compatibility with existing rows but are no longer
--    written to (those now live once per request in procurement_details).
--
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists public.procurement_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade unique,
  purchasing_category text,
  purchasing_category_other text,
  vendor text,
  needed_by_date date,
  created_at timestamptz not null default now()
);

create index if not exists procurement_details_request_id_idx on public.procurement_details (request_id);

alter table public.procurement_details enable row level security;

drop policy if exists "procurement_details follow request" on public.procurement_details;
create policy "procurement_details follow request" on public.procurement_details
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

alter table public.procurement_line_items add column if not exists item_no int;
alter table public.procurement_line_items add column if not exists image_url text;
alter table public.procurement_line_items add column if not exists purchasing_link text;
