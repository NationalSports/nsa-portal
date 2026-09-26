-- Service-only durable outbox. Payloads include invoice PDFs and must never be
-- readable through an anonymous or staff browser's direct Data API access.
create table public.email_firewall_retries (
  id uuid primary key default gen_random_uuid(),
  original_message_id text unique,
  fingerprint text not null,
  payload jsonb,
  status text not null default 'prepared'
    check (status in ('prepared', 'pending', 'retrying', 'resent', 'review', 'done', 'expired')),
  retry_recipients jsonb not null default '[]'::jsonb,
  manual_recipients jsonb not null default '[]'::jsonb,
  rejection_events jsonb not null default '[]'::jsonb,
  retry_results jsonb not null default '[]'::jsonb,
  error text,
  next_check_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('pending', 'retrying', 'resent') or original_message_id is not null),
  check (jsonb_typeof(retry_recipients) = 'array' and jsonb_typeof(manual_recipients) = 'array' and jsonb_typeof(retry_results) = 'array')
);
alter table public.email_firewall_retries enable row level security;
revoke all on public.email_firewall_retries from public, anon, authenticated;
grant select, insert, update, delete on public.email_firewall_retries to service_role;
create index email_firewall_retries_due on public.email_firewall_retries (next_check_at) where status = 'pending';
create index email_firewall_retries_newer on public.email_firewall_retries (fingerprint, created_at);
create index email_firewall_retries_retention on public.email_firewall_retries (created_at);
comment on table public.email_firewall_retries is 'At-most-once Gmail fallback after confirmed permanent Brevo sender rejection; service role only. Payload retention 7 days; status retention 30 days.';
