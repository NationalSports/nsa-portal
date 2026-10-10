-- Per-rep Google connection + AI email insights ("My Email").
--
-- A rep connects their own Google account (Gmail read/compose + Calendar read)
-- from the portal. netlify/functions/rep-gmail-sync.js reads new Primary-inbox
-- mail, asks Claude which messages matter, and stores ONLY the extracted
-- summary / tasks / deadlines plus a short snippet — never the full body. The
-- rep turns a suggested task into a workspace_items reminder with one tap.
--
-- rep_google_links holds an encrypted refresh token, so it has RLS enabled and
-- NO client policies: only the service role (Netlify functions) can read it.
-- The browser learns connection status through google-connect?action=status.

create table if not exists public.rep_google_links (
  team_member_id text primary key references public.team_members(id) on delete cascade,
  google_email text not null,
  refresh_token_enc jsonb not null,
  scopes text,
  -- Gmail internalDate (ms) of the newest message already analysed.
  gmail_cursor_ms bigint,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rep_google_links enable row level security;
revoke all on table public.rep_google_links from anon, authenticated;

create table if not exists public.rep_email_insights (
  id text primary key default gen_random_uuid()::text,
  team_member_id text not null references public.team_members(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  internet_message_id text,
  references_header text,
  sender_email text,
  sender_name text,
  subject text,
  snippet text
    constraint rep_email_insights_snippet_check check (snippet is null or char_length(snippet) <= 400),
  received_at timestamptz,
  -- Tags: which account / order / quote this email is about. Set automatically
  -- by the sync (contact email, SO-/EST- numbers in the email) or by the rep.
  customer_id text references public.customers(id) on delete set null,
  so_id text references public.sales_orders(id) on delete set null,
  estimate_id text references public.estimates(id) on delete set null,
  link_source text
    constraint rep_email_insights_link_source_check check (link_source is null or link_source in ('auto', 'manual')),
  important boolean not null default false,
  importance_reason text,
  summary text,
  -- [{ "title": text, "due_date": "YYYY-MM-DD" | null }]
  tasks jsonb not null default '[]'::jsonb,
  -- [{ "label": text, "date": "YYYY-MM-DD" }]
  deadlines jsonb not null default '[]'::jsonb,
  status text not null default 'new'
    constraint rep_email_insights_status_check check (status in ('new', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rep_email_insights_msg_unique unique (team_member_id, gmail_message_id)
);

create index if not exists rep_email_insights_owner_idx
  on public.rep_email_insights (team_member_id, received_at desc);

create index if not exists rep_email_insights_customer_idx
  on public.rep_email_insights (customer_id, received_at desc)
  where customer_id is not null;

create index if not exists rep_email_insights_so_idx
  on public.rep_email_insights (so_id)
  where so_id is not null;

create index if not exists rep_email_insights_estimate_idx
  on public.rep_email_insights (estimate_id)
  where estimate_id is not null;

alter table public.rep_email_insights enable row level security;
revoke all on table public.rep_email_insights from anon;
grant select, update on table public.rep_email_insights to authenticated;

-- A rep sees and triages only their own mailbox's insights. Inserts come from
-- the sync function (service role).
drop policy if exists "rep_email_insights_owner_read" on public.rep_email_insights;
create policy "rep_email_insights_owner_read"
  on public.rep_email_insights
  for select
  to authenticated
  using (
    team_member_id = (
      select tm.id from public.team_members tm
      where tm.auth_id = (select auth.uid()) and tm.is_active is not false
      limit 1
    )
  );

drop policy if exists "rep_email_insights_owner_update" on public.rep_email_insights;
create policy "rep_email_insights_owner_update"
  on public.rep_email_insights
  for update
  to authenticated
  using (
    team_member_id = (
      select tm.id from public.team_members tm
      where tm.auth_id = (select auth.uid()) and tm.is_active is not false
      limit 1
    )
  )
  with check (
    team_member_id = (
      select tm.id from public.team_members tm
      where tm.auth_id = (select auth.uid()) and tm.is_active is not false
      limit 1
    )
  );

-- The rep may triage (status) and re-tag (customer / order / quote); the AI
-- output and message metadata are written only by the sync.
revoke update on table public.rep_email_insights from authenticated;
grant update (status, customer_id, so_id, estimate_id, link_source, updated_at)
  on table public.rep_email_insights to authenticated;
