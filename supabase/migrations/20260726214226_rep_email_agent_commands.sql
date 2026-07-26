-- Rep-forwarded command support for the Gmail AI inbox.
--
-- Rep email is an input channel, not an authorization to mutate vendor systems.
-- The sync records proposed actions; an authenticated rep/admin must approve a
-- cart task in Connect before the existing bot worker can touch a vendor cart.

alter table public.ai_inbox_messages
  add column if not exists is_rep_command boolean not null default false,
  add column if not exists submitted_by_id text references public.team_members(id) on delete set null,
  add column if not exists rep_instruction text,
  add column if not exists original_sender_email text,
  add column if not exists original_sender_name text,
  add column if not exists original_subject text,
  add column if not exists command_type text,
  add column if not exists command_status text not null default 'none'
    check (command_status in (
      'none', 'proposed', 'approved', 'queued', 'needs_review',
      'done', 'rejected', 'failed'
    )),
  add column if not exists command_payload jsonb not null default '{}'::jsonb,
  add column if not exists command_task_id text references public.assigned_todos(id) on delete set null;

create index if not exists idx_ai_inbox_rep_commands
  on public.ai_inbox_messages (command_status, received_at desc)
  where is_rep_command;

create unique index if not exists idx_assigned_todos_source_inbox_unique
  on public.assigned_todos ((bot_payload->>'source_inbox_message_id'))
  where bot_payload ? 'source_inbox_message_id';

-- The browser may edit review fields, but command execution state is
-- server-owned. RLS still requires an active staff member for these columns.
revoke update on table public.ai_inbox_messages from authenticated;
grant update (
  customer_id, draft_subject, draft_body_text, draft_body_html,
  status, estimate_id, reviewed_by, reviewed_at, updated_at
) on public.ai_inbox_messages to authenticated;

grant select on table public.ai_inbox_messages to authenticated;
grant select, insert, update, delete on table public.ai_inbox_messages to service_role;
