-- "No invoice needed" on a sales order.
--
-- The Ready-to-invoice report lists every complete order whose portal invoices
-- do not cover its total. Some orders are legitimately never invoiced here:
-- billed in NetSuite, collected by an OMG store, a free replacement or sample.
-- Nothing could say so, so those orders sat on the list (and on the rep's TODO
-- list) forever. A rep now marks the order with a reason; the report, the
-- exposure totals and the rep TODOs skip it. Stamped with who/when so the
-- decision is auditable on the document itself, same shape as tax_exempt_*.

alter table public.sales_orders
  add column if not exists no_invoice_needed boolean not null default false,
  add column if not exists no_invoice_reason text,
  add column if not exists no_invoice_by text,
  add column if not exists no_invoice_at timestamptz;

comment on column public.sales_orders.no_invoice_needed is
  'True when this order will not be invoiced from the portal (billed in NetSuite, OMG-collected, free replacement). Ready-to-invoice reporting skips it.';
comment on column public.sales_orders.no_invoice_reason is
  'Why no portal invoice is needed. Required when no_invoice_needed is true.';
