alter table public.webstore_showcase_assets
  drop constraint if exists webstore_showcase_assets_status_check;

alter table public.webstore_showcase_assets
  add constraint webstore_showcase_assets_status_check
  check (status in ('queued', 'generating', 'review', 'approved', 'failed', 'canceled'));

comment on constraint webstore_showcase_assets_status_check on public.webstore_showcase_assets is
  'Showcase lifecycle including cooperative cancellation of queued or running AI work.';
