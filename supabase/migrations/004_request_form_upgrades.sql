-- ============================================================
-- 004: New Request form upgrades
--
-- Adds: a free-text Project field + a general "conclude by" date on every
-- request; richer Maintenance fields (type of maintenance, scheduled
-- date/time, up to 6 photos, work permit attachment); richer Delivery
-- fields (requested time, delivery permit attachment, a repeatable items
-- table); and a public storage bucket for these request attachments,
-- mirroring the existing `branding` bucket pattern from migration 003.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Requests: general fields --------------------------------------------
alter table public.requests add column if not exists project text;
alter table public.requests add column if not exists conclude_date date;

-- 2. Maintenance details ---------------------------------------------------
alter table public.maintenance_details add column if not exists maintenance_type text;
alter table public.maintenance_details add column if not exists scheduled_date date;
alter table public.maintenance_details add column if not exists scheduled_time time;
alter table public.maintenance_details add column if not exists work_permit jsonb not null default '[]';
-- `photos` (jsonb, default '[]') already exists from schema.sql — used for
-- up to 6 uploaded photos.

-- 3. Delivery details -------------------------------------------------------
alter table public.delivery_details add column if not exists requested_time time;
-- The existing `files` (jsonb, default '[]') column is repurposed to hold
-- the delivery permit attachment.

-- 4. Delivery items table (the requester-filled table of what's needed) ----
create table if not exists public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  item_no int not null,
  item_name text not null,
  required_quantity numeric(12,2) not null default 1,
  image_url text,
  current_location text,
  created_at timestamptz not null default now()
);

create index if not exists delivery_items_request_id_idx on public.delivery_items (request_id);

alter table public.delivery_items enable row level security;

drop policy if exists "delivery_items follow request" on public.delivery_items;
create policy "delivery_items follow request" on public.delivery_items
  for all using (
    exists (select 1 from public.requests r where r.id = request_id
      and (r.requestor_id = auth.uid() or public.is_staff()))
  );

-- 5. Storage bucket for request attachments (photos, permits, item images) -
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', true)
on conflict (id) do nothing;

drop policy if exists "request-attachments public read" on storage.objects;
create policy "request-attachments public read" on storage.objects
  for select using (bucket_id = 'request-attachments');

drop policy if exists "request-attachments authenticated upload" on storage.objects;
create policy "request-attachments authenticated upload" on storage.objects
  for insert with check (bucket_id = 'request-attachments' and auth.role() = 'authenticated');

drop policy if exists "request-attachments managers update" on storage.objects;
create policy "request-attachments managers update" on storage.objects
  for update using (bucket_id = 'request-attachments' and public.is_manager());

drop policy if exists "request-attachments managers delete" on storage.objects;
create policy "request-attachments managers delete" on storage.objects
  for delete using (bucket_id = 'request-attachments' and public.is_manager());
