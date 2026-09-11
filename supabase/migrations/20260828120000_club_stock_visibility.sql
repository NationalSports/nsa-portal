-- Club stock visibility
--
-- Two additive columns so a club can be shown the stock it owns at NSA, kept
-- distinct from what the vendor could supply.
--
-- 1. products.customer_id — which club owns this stock pool. Until now the only
--    link between a customer and "their" products was roster_kit_templates.items,
--    which lists only what the kit orders; stock the club owns but doesn't order
--    per-player (socks, spare tees, keeper kit) had no way to be attributed at
--    all. TEXT with no FK, matching roster_kit_templates.customer_id — customer
--    ids look like 'c-ns-3978'.
--
--    NOTE ON SCOPE: products/product_inventory both carry `anon read = true`
--    policies, so this column is an ATTRIBUTION field, not a security boundary.
--    It decides what a club is *shown*, not what the anon key can reach. Any
--    real isolation would need those RLS policies tightened first.
--
-- 2. customers.coach_stock — per-account module switch, same shape as the
--    existing coach_roster / coach_livelook / coach_build_orders toggles.
--    Defaults false: no club sees a stock panel until someone turns it on.

alter table public.products   add column if not exists customer_id  text;
alter table public.customers  add column if not exists coach_stock  boolean not null default false;

comment on column public.products.customer_id is
  'Club that owns this stock pool (customers.id). NULL = general catalog. Attribution only — not an RLS boundary.';
comment on column public.customers.coach_stock is
  'Show this account its own stock-on-hand panel in the coach portal.';

-- Partial index: the column is NULL for all ~61k general-catalog rows, so only
-- the club-owned ones are worth indexing.
create index if not exists idx_products_customer_id
  on public.products (customer_id) where customer_id is not null;

-- Backfill: the Encinitas Express pool seeded under the `p-exp-` id convention.
-- Matching on the id prefix is safe precisely because that convention is what
-- created them; new club pools should set customer_id directly instead.
update public.products
   set customer_id = 'c-ns-3978'
 where id like 'p-exp-%'
   and customer_id is distinct from 'c-ns-3978';
