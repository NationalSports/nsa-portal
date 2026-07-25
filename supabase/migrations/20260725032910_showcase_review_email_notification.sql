-- One notification per store-level Showcase generation run.
--
-- Each product generation request advances `showcase_generation_batch_id` and
-- marks the store pending. Once no queued/generating assets remain, exactly one
-- background worker can atomically claim that batch and email the assigned rep.
alter table public.webstores
  add column if not exists showcase_generation_batch_id uuid,
  add column if not exists showcase_review_notification_status text not null default 'idle',
  add column if not exists showcase_review_notified_at timestamptz,
  add column if not exists showcase_review_notified_to text,
  add column if not exists showcase_review_notification_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.webstores'::regclass
      and conname = 'webstores_showcase_review_notification_status_check'
  ) then
    alter table public.webstores
      add constraint webstores_showcase_review_notification_status_check
      check (showcase_review_notification_status in ('idle', 'pending', 'sending', 'sent', 'failed'));
  end if;
end $$;

comment on column public.webstores.showcase_generation_batch_id is
  'Latest Showcase generation batch marker used to deduplicate rep review emails.';
comment on column public.webstores.showcase_review_notification_status is
  'Delivery state for the assigned-rep Showcase review email.';
comment on column public.webstores.showcase_review_notified_at is
  'Time the assigned rep was emailed that Showcase generation finished.';
