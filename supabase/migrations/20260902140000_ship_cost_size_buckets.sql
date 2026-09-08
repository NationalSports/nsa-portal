-- Shipping cost does not scale linearly with unit count, and the suggestion was
-- pretending it does.
--
-- ship_cost_basis stored one global median_cost_per_unit ($0.958) and the editor
-- multiplied it by the order's units. But $/unit falls roughly 20x from the
-- smallest orders to the largest, because cost is driven by BOXES, not garments:
--
--     units     n   median cost   median $/unit
--     <10       5      $35.32         8.61
--     10-24    26      $29.49         1.92
--     25-49    17      $38.70         1.09
--     50-99    22      $48.20         0.72
--     100-199  15      $74.01         0.50
--     200+     23     $114.26         0.40
--
-- The global median is dominated by small orders, so extrapolating it to a large
-- one overestimates badly: a 125-unit order was estimated at $119.75 against a
-- $74.01 observed median for its own size class.
--
-- Measured against the scored orders, the size-bucket median halves the error of
-- every alternative (mean abs error $45 vs $85 for the flat per-unit rate, $78
-- for percent-of-merch, and $89 for the max() of the two that actually shipped).
--
-- So store the curve instead of a single slope. One JSONB array of buckets, each
-- {min_units, max_units, n, median_cost, p25_cost, p75_cost}, recomputed by
-- scripts/shipping-audit.js on every run alongside the rest of the row.
alter table public.ship_cost_basis
  add column if not exists size_buckets jsonb;

comment on column public.ship_cost_basis.size_buckets is
  'Cost-vs-order-size curve: array of {min_units,max_units,n,median_cost,p25_cost,p75_cost}, '
  'recomputed by scripts/shipping-audit.js. The editor picks the bucket the order falls in '
  'rather than extrapolating a global per-unit rate, which overestimates large orders.';

-- median_cost_per_unit stays for now: the audit keeps writing it and the snapshot
-- history refers to it, but nothing reads it to build a suggestion any more.
comment on column public.ship_cost_basis.median_cost_per_unit is
  'Global median cost/unit. Descriptive only — NOT a rate to multiply by an order''s '
  'units; $/unit falls sharply with order size (see size_buckets).';
