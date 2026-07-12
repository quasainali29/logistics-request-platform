-- Logistics Request Management Platform — Migration 002
-- Adds admin-manageable dynamic roles, a role request/approval workflow,
-- and closes a self-escalation gap in the original profiles RLS policy.
--
-- Safe to run multiple times from the top — every statement is idempotent,
-- so if a previous attempt got interrupted partway (e.g. a lock/deadlock
-- error from a concurrent connection), just re-run the whole script again.

-- ============================================================
-- 1. ROLES TABLE (replaces the fixed check-constraint on profiles.role)
-- ============================================================
create table if not exists public.roles (
  name text primary key,
  label text not null,
  description text,
  is_staff boolean not null default false,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- Seed the 4 roles that already exist in the live system, so nothing breaks.
insert into public.roles (name, label, description, is_staff, is_manager) values
  ('requestor', 'Requestor', 'Can submit and track their own requests.', false, false),
  ('logistics_coordinator', 'Logistics Coordinator', 'Reviews and processes incoming requests.', true, false),
  ('logistics_manager', 'Logistics Manager', 'Full administrative access; manages roles and approvals.', true, true),
  ('warehouse_team', 'Warehouse Team', 'Handles fulfillment and warehouse operations.', true, false)
on conflict (name) do nothing;

-- Swap the old fixed check constraint for a foreign key into roles.
alter table public.profiles drop constraint if exists profiles_role_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_role_fkey foreign key (role) references public.roles(name);
  end if;
end $$;

-- Re-point is_staff() at the roles table so custom roles inherit correct access,
-- and add is_manager() for admin-only actions (role management).
create or replace function public.is_staff()
returns boolean as $$
  select coalesce(
    (select r.is_staff from public.roles r
       join public.profiles p on p.role = r.name
       where p.id = auth.uid()),
    false
  );
$$ language sql stable security definer;

create or replace function public.is_manager()
returns boolean as $$
  select coalesce(
    (select r.is_manager from public.roles r
       join public.profiles p on p.role = r.name
       where p.id = auth.uid()),
    false
  );
$$ language sql stable security definer;

-- ============================================================
-- 2. ROLE REQUESTS (self-service request + admin approve/reject)
-- ============================================================
create table if not exists public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null references public.roles(name),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text
);

-- Approve/reject atomically: updates the request row and, on approval,
-- the user's actual role — all in one call so they can't drift apart.
create or replace function public.decide_role_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns void as $$
declare
  req record;
begin
  if not public.is_manager() then
    raise exception 'Only managers can decide role requests';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into req from public.role_requests where id = p_request_id and status = 'pending';
  if req is null then
    raise exception 'Role request not found or already decided';
  end if;

  update public.role_requests
    set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    where id = p_request_id;

  if p_decision = 'approved' then
    update public.profiles set role = req.requested_role where id = req.user_id;
  end if;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 3. CLOSE THE SELF-ESCALATION GAP
-- ============================================================
-- The original "users can update their own profile" policy allowed a user to
-- update ANY column on their own row, including role — meaning anyone could
-- have promoted themselves via a direct API call. A trigger enforces the real
-- rule regardless of which RLS policy let the UPDATE through.
create or replace function public.prevent_self_role_escalation()
returns trigger as $$
begin
  if new.role is distinct from old.role and not public.is_manager() then
    raise exception 'Only managers can change roles directly. Submit a role request instead.';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists enforce_role_change_permission on public.profiles;
create trigger enforce_role_change_permission
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_escalation();

-- Managers can now update any profile (needed for direct role assignment
-- from the admin panel); self-update policy is unchanged and still safe
-- thanks to the trigger above.
drop policy if exists "managers can update any profile" on public.profiles;
create policy "managers can update any profile" on public.profiles
  for update using (public.is_manager());

-- ============================================================
-- 4. RLS FOR NEW TABLES
-- ============================================================
alter table public.roles enable row level security;
alter table public.role_requests enable row level security;

drop policy if exists "roles readable by authenticated" on public.roles;
create policy "roles readable by authenticated" on public.roles
  for select using (auth.role() = 'authenticated');

drop policy if exists "roles insertable by managers" on public.roles;
create policy "roles insertable by managers" on public.roles
  for insert with check (public.is_manager());

drop policy if exists