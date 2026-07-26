alter table public.ai_inbox_messages
  add column if not exists acknowledgement_sent_at timestamptz,
  add column if not exists acknowledgement_message_id text,
  add column if not exists acknowledgement_error text;

create index if not exists idx_ai_inbox_acknowledgement_pending
  on public.ai_inbox_messages (received_at)
  where is_rep_command and acknowledgement_sent_at is null;
