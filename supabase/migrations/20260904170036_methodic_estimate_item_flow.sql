-- Let Methodic custom work begin on an estimate line and follow that same
-- record onto the sales order. Item indexes are the durable client identity:
-- estimate_items / so_items rows are replaced during normal saves, so their
-- integer primary keys cannot safely be retained by this workflow.

alter table public.methodic_requests
  alter column sales_order_id drop not null,
  add column if not exists estimate_id text references public.estimates(id) on delete cascade,
  add column if not exists item_index integer check (item_index is null or item_index >= 0),
  add column if not exists mockup_files jsonb not null default '[]'::jsonb;

alter table public.methodic_requests
  drop constraint if exists methodic_request_source_document,
  add constraint methodic_request_source_document check (
    (sales_order_id is not null and estimate_id is null)
    or (sales_order_id is null and estimate_id is not null)
  ),
  drop constraint if exists methodic_request_mockup_files_array,
  add constraint methodic_request_mockup_files_array
    check (jsonb_typeof(mockup_files) = 'array');

create index if not exists methodic_requests_estimate_idx
  on public.methodic_requests (estimate_id, updated_at desc)
  where estimate_id is not null;

create index if not exists methodic_requests_source_item_idx
  on public.methodic_requests (sales_order_id, estimate_id, item_index)
  where item_index is not null;

comment on column public.methodic_requests.item_index is
  'Zero-based source document line index; survives estimate-to-sales-order conversion.';

comment on column public.methodic_requests.mockup_files is
  'Methodic mockup deliverables used before an SO art job exists.';
