begin;

-- A sales-order line may be swapped to a new SKU after it has been invoiced. Keep
-- the invoice keys that previously identified that same line so historical invoice
-- quantities continue to reconcile without mutating the posted invoice.
alter table public.so_items
  add column if not exists invoice_line_keys jsonb not null default '[]'::jsonb;

alter table public.so_items
  drop constraint if exists so_items_invoice_line_keys_is_array;

alter table public.so_items
  add constraint so_items_invoice_line_keys_is_array
  check (jsonb_typeof(invoice_line_keys) = 'array');

comment on column public.so_items.invoice_line_keys is
  'Prior sku|color|position keys retained when this sales-order line changes SKU, for invoice reconciliation.';

-- SO-2245 was changed from A1005/White to LH0083/White at item_index 1 before
-- prior-key aliases existed. Backfill that one known identity explicitly; a
-- generic position-only inference could misclassify genuinely removed billed lines.
update public.so_items
set invoice_line_keys = invoice_line_keys || jsonb_build_array('A1005|White|1')
where so_id = 'SO-2245'
  and item_index = 1
  and sku = 'LH0083'
  and color = 'White'
  and not invoice_line_keys @> jsonb_build_array('A1005|White|1');

commit;
