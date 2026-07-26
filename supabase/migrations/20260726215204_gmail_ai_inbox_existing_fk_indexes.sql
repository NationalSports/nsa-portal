create index if not exists idx_ai_inbox_estimate
  on public.ai_inbox_messages (estimate_id)
  where estimate_id is not null;

create index if not exists idx_ai_inbox_reviewed_by
  on public.ai_inbox_messages (reviewed_by)
  where reviewed_by is not null;
