-- Per-document tax exemption, with the reason it was granted.
--
-- `customers.tax_exempt` exempts everything a customer ever buys, which is too blunt:
-- a district is exempt on a district-funded order but not on booster-club spirit wear,
-- and a resale certificate covers goods for resale only. Reps were marking the CUSTOMER
-- exempt to get one order right, silently un-taxing every later order for them.
--
-- sales_orders already carries tax_exempt (set today by the promo and OMG flows, with no
-- UI and no justification behind it). estimates carry no tax fields at all, so a quote
-- could not be exempted before it became an order. This adds:
--   * tax_exempt on estimates, matching the sales_orders flag every tax calculation
--     already reads (calcOrderTotals, the editors, invoices, the QuickBooks sync)
--   * tax_exempt_reason / _by / _at on BOTH, so an untaxed document can answer
--     "why?" on its own, years later, without anyone's memory
--
-- All additive and nullable: existing rows read exactly as they do now (NULL and false
-- are both falsy at every read site), and nothing backfills.

alter table estimates    add column if not exists tax_exempt        boolean default false;
alter table estimates    add column if not exists tax_exempt_reason text;
alter table estimates    add column if not exists tax_exempt_by     text;
alter table estimates    add column if not exists tax_exempt_at     timestamptz;

alter table sales_orders add column if not exists tax_exempt_reason text;
alter table sales_orders add column if not exists tax_exempt_by     text;
alter table sales_orders add column if not exists tax_exempt_at     timestamptz;

comment on column estimates.tax_exempt_reason    is 'Why this document is untaxed (required when a rep exempts it). Null on a promo/OMG-driven exemption.';
comment on column sales_orders.tax_exempt_reason is 'Why this document is untaxed (required when a rep exempts it). Null on a promo/OMG-driven exemption.';
