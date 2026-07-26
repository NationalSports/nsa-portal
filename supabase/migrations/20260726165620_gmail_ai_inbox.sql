-- Gmail-backed AI sales inbox.
--
-- Incoming mail is written only by server-side code using the Supabase secret
-- key. Active staff may review and update messages in Connect, but there is no
-- anonymous access and the AI never sends mail directly.

create schema if not exists private;

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.auth_id = (select auth.uid())
      and coalesce(tm.is_active, true)
  );
$$;

revoke all on function private.is_active_staff() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_staff() to authenticated;

create table if not exists public.ai_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  internet_message_id text,
  references_header text,
  sender_email text not null,
  sender_name text,
  to_emails jsonb not null default '[]'::jsonb,
  cc_emails jsonb not null default '[]'::jsonb,
  subject text not null default '',
  snippet text not null default '',
  text_body text not null default '',
  html_body text,
  attachment_meta jsonb not null default '[]'::jsonb,
  received_at timestamptz,
  customer_id text references public.customers(id) on delete set null,
  intent text,
  needs_estimate boolean not null default false,
  analysis jsonb not null default '{}'::jsonb,
  stock_checks jsonb not null default '[]'::jsonb,
  draft_subject text,
  draft_body_text text,
  draft_body_html text,
  estimate_id text references public.estimates(id) on delete set null,
  gmail_draft_id text,
  status text not null default 'queued'
    check (status in (
      'queued', 'processing', 'needs_review', 'estimate_created',
      'draft_created', 'complete', 'ignored', 'failed'
    )),
  error_message text,
  processed_at timestamptz,
  reviewed_by text references public.team_members(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_inbox_status_received
  on public.ai_inbox_messages (status, received_at desc);
create index if not exists idx_ai_inbox_customer
  on public.ai_inbox_messages (customer_id, received_at desc);
create index if not exists idx_ai_inbox_thread
  on public.ai_inbox_messages (gmail_thread_id);

alter table public.estimates
  add column if not exists source_inbox_message_id uuid
  references public.ai_inbox_messages(id) on delete set null;

create index if not exists idx_estimates_source_inbox
  on public.estimates (source_inbox_message_id)
  where source_inbox_message_id is not null;

alter table public.ai_inbox_messages enable row level security;

drop policy if exists ai_inbox_staff_select on public.ai_inbox_messages;
create policy ai_inbox_staff_select
  on public.ai_inbox_messages
  for select
  to authenticated
  using ((select private.is_active_staff()));

drop policy if exists ai_inbox_staff_update on public.ai_inbox_messages;
create policy ai_inbox_staff_update
  on public.ai_inbox_messages
  for update
  to authenticated
  using ((select private.is_active_staff()))
  with check ((select private.is_active_staff()));

revoke all on table public.ai_inbox_messages from anon;
revoke insert, delete on table public.ai_inbox_messages from authenticated;
grant select, update on table public.ai_inbox_messages to authenticated;
grant select, insert, update, delete on table public.ai_inbox_messages to service_role;

do $$
begin
  alter publication supabase_realtime add table public.ai_inbox_messages;
exception
  when duplicate_object then null;
end
$$;
