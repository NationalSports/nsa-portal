create index if not exists idx_ai_inbox_submitted_by
  on public.ai_inbox_messages (submitted_by_id)
  where submitted_by_id is not null;

create index if not exists idx_ai_inbox_command_task
  on public.ai_inbox_messages (command_task_id)
  where command_task_id is not null;
