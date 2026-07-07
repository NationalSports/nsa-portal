-- Phase 2 of the CIFCS → Brevo marketing module: campaigns, per-recipient send
-- log, and the global suppression list.
--
-- Sending is throttled through the existing `scheduled_emails` queue (00076):
-- marketing-campaign-send enqueues one row per recipient with staggered send_at
-- (related_type='marketing', related_id=<campaign_id>), and the send-scheduled-emails
-- cron delivers them to Brevo at its own 25-per-15-min pace. Nothing here sends
-- directly.
--
-- marketing_suppressions is the HARD gate: campaign-send refuses to enqueue to any
-- address on it. Rows are written by the public unsubscribe endpoint and the Brevo
-- webhook (bounces/complaints) via the service role, and by staff manually.
--
-- RLS: staff-only, no anon grants — same posture as marketing_contacts (00176).

create table if not exists public.marketing_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subject       text not null,
  html_body     text not null,            -- merge-field template; footer is appended at enqueue time
  sender_name   text,
  sender_email  text,                     -- REQUIRED to send: the dedicated marketing sender, never the transactional noreply
  reply_to      text,
  segment       jsonb not null default '{}'::jsonb,  -- {contact_ids?[]} | {section_id?, sport?, role?}
  send_rate     integer not null default 60,          -- target emails/hour used to stagger send_at
  status        text not null default 'draft',        -- draft | sending | sent | cancelled
  counts        jsonb not null default '{}'::jsonb,   -- {recipients, suppressed, queued} stamped at enqueue
  send_started_at timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.marketing_sends (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.marketing_campaigns(id) on delete cascade,
  contact_id         uuid,
  email              text not null,
  scheduled_email_id uuid,               -- row in scheduled_emails carrying this send
  status             text not null default 'queued',  -- queued | sent | bounced | complaint | unsubscribed | suppressed | failed
  message_id         text,
  sent_at            timestamptz,
  opened_at          timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists idx_marketing_sends_campaign on public.marketing_sends(campaign_id);
create index if not exists idx_marketing_sends_email on public.marketing_sends(lower(email));

create table if not exists public.marketing_suppressions (
  email       text primary key,           -- stored lowercase
  reason      text not null,              -- unsubscribe | hard_bounce | complaint | blocked | manual
  campaign_id uuid,
  created_at  timestamptz not null default now()
);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_sends enable row level security;
alter table public.marketing_suppressions enable row level security;

drop policy if exists marketing_campaigns_staff_all on public.marketing_campaigns;
create policy marketing_campaigns_staff_all on public.marketing_campaigns
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

drop policy if exists marketing_sends_staff_all on public.marketing_sends;
create policy marketing_sends_staff_all on public.marketing_sends
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

drop policy if exists marketing_suppressions_staff_all on public.marketing_suppressions;
create policy marketing_suppressions_staff_all on public.marketing_suppressions
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
