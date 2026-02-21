-- ============================================================
-- NSA Portal – Slack Integration Schema
-- Migration: 00004_slack_integration
-- ============================================================

-- 1. Add Slack fields to user_profiles
alter table public.user_profiles
  add column if not exists slack_user_id     text,         -- Slack member ID (e.g. U04ABCDEF)
  add column if not exists slack_dm_channel  text,         -- Cached DM channel ID for fast sends
  add column if not exists notify_slack      boolean not null default true,  -- opt-out toggle
  add column if not exists notify_depts      text[] default '{}';           -- subscribe to dept channels, empty = all

-- Index for quick Slack lookups
create index if not exists idx_user_profiles_slack
  on public.user_profiles(slack_user_id)
  where slack_user_id is not null;

-- 2. Add mention tracking + Slack thread ID to messages
alter table public.messages
  add column if not exists mentions      uuid[] default '{}',  -- user_profile IDs mentioned
  add column if not exists slack_ts      text,                 -- Slack message timestamp (thread parent)
  add column if not exists slack_channel text;                 -- Slack channel where thread lives

-- 3. Notification log (tracks what was sent, prevents dupes)
create table public.slack_notifications (
  id              uuid primary key default uuid_generate_v4(),
  message_id      uuid not null references public.messages(id) on delete cascade,
  recipient_id    uuid not null references public.user_profiles(id) on delete cascade,
  slack_ts        text,              -- Slack message ts for the DM we sent
  slack_channel   text,              -- DM channel we sent to
  reason          text not null,     -- 'mention' | 'dept' | 'all' | 'reply'
  delivered       boolean not null default false,
  error           text,
  created_at      timestamptz not null default now(),
  unique (message_id, recipient_id)
);

create index idx_slack_notif_msg on public.slack_notifications(message_id);
create index idx_slack_notif_recipient on public.slack_notifications(recipient_id);

-- RLS for slack_notifications
alter table public.slack_notifications enable row level security;

-- Users can see their own notifications
create policy "slack_notif_select" on public.slack_notifications
  for select using (
    public.is_admin()
    or recipient_id = public.current_profile_id()
  );

-- Only server functions write notifications
create policy "slack_notif_insert" on public.slack_notifications
  for insert with check (true);

-- 4. App settings table for Slack config (admin-only)
create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select using (true);
create policy "app_settings_admin" on public.app_settings
  for all using (public.is_admin());

-- Seed Slack config placeholders
insert into public.app_settings (key, value) values
  ('slack_bot_token',      ''),     -- xoxb-... from Slack App
  ('slack_signing_secret', ''),     -- for verifying incoming requests
  ('slack_app_channel',    ''),     -- optional: default channel for all-dept messages
  ('portal_base_url',      'https://nsa-portal.netlify.app')
on conflict (key) do nothing;
