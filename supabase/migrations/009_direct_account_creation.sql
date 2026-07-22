-- Logistics Request Management Platform — Migration 009
-- Supports direct (no-email-verification) account creation from the Admin
-- panel. Adds a per-account, admin-controlled flag that (when turned on)
-- forces that one user to set a new password the next time they sign in.
--
-- This is explicitly NOT mandatory/hardcoded for every account — the admin
-- decides per account when creating it, defaulting to off. See
-- src/app/(app)/admin/actions.ts (createUserDirectly) and
-- src/app/login/actions.ts (signIn) for where this is read/written.
--
-- Safe to run multiple times from the top.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
