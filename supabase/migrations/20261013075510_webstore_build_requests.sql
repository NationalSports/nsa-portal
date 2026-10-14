-- Admin-submitted store build queue. The portal only creates, reads and cancels
-- rows; an external service-role worker claims queued rows and writes results.
create table public.webstore_build_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null references public.team_members(id),
  customer_id text references public.customers(id) on delete set null,
  request_text text not null default '',
  attachment_urls jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'ready', 'failed', 'cancelled')),
  store_id uuid references public.webstores(id) on delete set null,
  result_summary text,
  error text,
  updated_at timestamptz not null default now(),
  constraint webstore_build_requests_attachments_array
    check (jsonb_typeof(attachment_urls) = 'array'),
  constraint webstore_build_requests_has_instructions
    check (length(trim(request_text)) > 0 or jsonb_array_length(attachment_urls) > 0)
);

comment on table public.webstore_build_requests is
  'Queue for an external service-role worker to build draft webstores from admin requests.';
comment on column public.webstore_build_requests.attachment_urls is
  'JSON array of Cloudinary attachments shaped as {url,name,type,size}.';
comment on column public.webstore_build_requests.status is
  'queued=awaiting worker; building=claimed; ready=draft store created; failed=worker error; cancelled=admin cancelled before claim.';

create index webstore_build_requests_recent_idx
  on public.webstore_build_requests (created_at desc);
create index webstore_build_requests_queue_idx
  on public.webstore_build_requests (created_at)
  where status = 'queued';

create trigger trg_webstore_build_requests_updated
  before update on public.webstore_build_requests
  for each row execute function public.set_updated_at();

alter table public.webstore_build_requests enable row level security;

create policy webstore_build_requests_admin_select
  on public.webstore_build_requests for select to authenticated
  using ((select public.is_admin_member()));
create policy webstore_build_requests_admin_insert
  on public.webstore_build_requests for insert to authenticated
  with check ((select public.is_admin_member()));
create policy webstore_build_requests_admin_update
  on public.webstore_build_requests for update to authenticated
  using ((select public.is_admin_member()))
  with check ((select public.is_admin_member()));

revoke all on public.webstore_build_requests from public, anon;
grant select, insert, update on public.webstore_build_requests to authenticated;
grant all on public.webstore_build_requests to service_role;
