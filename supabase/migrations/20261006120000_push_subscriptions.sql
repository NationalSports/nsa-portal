-- Web push for the installed portal app (NSA Connect). One row per device/browser
-- a staff member turned notifications on for. Written and read only by Netlify
-- functions (service role): push-subscribe stores rows, _push.js sends and
-- removes rows the push service reports as gone (404/410).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  team_member_id text not null references public.team_members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (team_member_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- One row per event already pushed (e.g. 'mention:<message id>', 'paid:<intent id>'),
-- so webhook retries and double saves never notify twice.
create table if not exists public.push_sent (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.push_sent enable row level security;
revoke all on table public.push_sent from anon, authenticated;
