-- Logistics Request Management Platform — Migration 011
-- Makes the login page's background color and logo size admin-configurable
-- (previously hardcoded in src/app/login/page.tsx), so the admin can adjust
-- look-and-feel from the Branding page instead of needing a code change.
--
-- Safe to run multiple times from the top.

alter table public.app_settings
  add column if not exists login_bg_color text not null default '#2563eb';

alter table public.app_settings
  add column if not exists login_logo_size int not null default 80;
