-- ============================================================
-- 032: Hold / release requests
--
-- Lets whoever can approve or reject a request (the approve_request /
-- reject_request permissions -- same gate, no new permission key) also
-- pause it at any non-terminal stage with a required reason, and release
-- it back to normal later. Deliberately does NOT touch requests.status or
-- workflow_stages/workflow_transitions -- same additive pattern as
-- request_verifications (028): the request keeps whatever status it was
-- already in while held, and "is this request currently on hold" is
-- derived at read time as "does it have a request_holds row with
-- released_at IS NULL". Multiple rows over a request's life = a full
-- hold/release history, not just a single flag.
--
-- RLS write policy mirrors the matrix directly (logistics_manager/
-- main_admin always allowed, everyone else only if their role has
-- approve_request or reject_request granted) rather than using the old
-- "any is_manager" backstop -- this is a new policy, so it's written
-- correctly from the start instead of needing a batch-4-style fix later.
--
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists public.request_holds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  held_by uuid not null references public.profiles(id),
  held_at timestamptz not null default now(),
  hold_reason text not null,
  released_by uuid references public.profiles(id),
  released_at timestamptz,
  release_note text
);

create index if not exists request_holds_request_id_idx
  on public.request_holds (request_id);

-- Partial index -- the only query that matters at read time is "is there
-- an open (unreleased) hold for this request", and most rows will be
-- released eventually.
create index if not exists request_holds_open_idx
  on public.request_holds (request_id) where released_at is null;

alter table public.request_holds enable row level security;

drop policy if exists "request_holds visible to staff" on public.request_holds;
create policy "request_holds visible to staff" on public.request_holds
  for select using (public.is_staff());

drop policy if exists "request_holds managed by permission" on public.request_holds;
create policy "request_holds managed by permission" on public.request_holds
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('logistics_manager', 'main_admin')
    )
    or exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role = rp.role_name
      where p.id = auth.uid()
        and rp.permission_key in ('approve_request', 'reject_request')
        and rp.granted
    )
  );
