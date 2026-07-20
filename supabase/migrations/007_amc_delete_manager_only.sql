-- Logistics Request Management Platform — Migration 007
-- Restrict deleting AMC locations/types to managers only. Any staff member
-- can still add new ones (unchanged), but removing one is a manager-only
-- action — it's destructive if a location/type is reused across contracts.

drop policy if exists "amc_locations writable by staff" on public.amc_locations;
create policy "amc_locations insert by staff" on public.amc_locations
  for insert with check (public.is_staff());
create policy "amc_locations update by staff" on public.amc_locations
  for update using (public.is_staff()) with check (public.is_staff());
create policy "amc_locations delete by manager" on public.amc_locations
  for delete using (public.is_manager());

drop policy if exists "amc_types writable by staff" on public.amc_types;
create policy "amc_types insert by staff" on public.amc_types
  for insert with check (public.is_staff());
create policy "amc_types update by staff" on public.amc_types
  for update using (public.is_staff()) with check (public.is_staff());
create policy "amc_types delete by manager" on public.amc_types
  for delete using (public.is_manager());
