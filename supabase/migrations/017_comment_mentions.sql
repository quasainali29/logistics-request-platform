-- Logistics Request Management Platform â Migration 017
-- Adds @mention support to comments: a comment can tag any number of
-- accounts (any role, any department â not limited to logistics staff),
-- and the app looks up their emails from `mentioned_user_ids` to send a
-- "you were mentioned" notification.
--
-- Safe to run multiple times from the top.

alter table public.comments
  add column if not exists mentioned_user_ids uuid[] not null default '{}';
