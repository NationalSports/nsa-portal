-- Persist the rep-entered decoration cost used by the webstore item's margin
-- calculator. NULL distinguishes legacy rows (which retain the $5 default) from
-- an explicit $0 cost.
alter table public.webstore_products
  add column if not exists deco_cost_estimate numeric check (deco_cost_estimate >= 0);

comment on column public.webstore_products.deco_cost_estimate is
  'Rep-entered estimated decoration cost per item used for webstore pricing and margin calculations.';
