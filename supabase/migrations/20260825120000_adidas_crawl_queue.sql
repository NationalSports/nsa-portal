-- Adidas Cowork crawl queue + coverage — make the daily/weekly sync cadence
-- COMPUTED instead of judged.
--
-- Why: the cadence ("daily = prioritized subset, weekly = full sweep") lived only
-- as prose in the adidas-inventory-sync skill. Nothing told a run which mode it
-- was in, nothing ordered the work, and nothing measured coverage — so the weekly
-- sweep quietly stopped happening. On 2026-08-25, 3,350 of 3,637 synced SKUs
-- (92%) were more than 7 days stale and 361 SKUs were showing stock numbers whose
-- inbound delivery date had already passed.
--
-- The load-bearing fix is the ORDERING KEY. The old heuristic ("skip SKUs synced
-- in the last 24h") looks at a SKU's NEWEST row. But the sync writes per SIZE and
-- skips any size whose code is missing from the size map (Step 4.4), so a SKU can
-- have fresh core sizes and tail sizes (XS/2XS/3XL/4XL and the whole tall run)
-- rotting for weeks. IS9771 on 2026-08-25: newest row 08-16, oldest row 08-06,
-- and 6 of its 10 sizes were wrong on the portal. 1,934 SKUs (53%) had their
-- sizes spread 7+ days apart.
--
-- So: order by the SKU's OLDEST size row, never its newest. A partially-synced
-- SKU then floats up on its own, with no extra bookkeeping.
--
-- Both views are read-only and additive; nothing writes to them.

-- ── adidas_crawl_queue ────────────────────────────────────────────────────────
-- One row per in-scope Adidas SKU, most-urgent first. The sync takes the top N.
--
-- priority 1 'inbound-eta-passed' — a size's future_delivery_date is in the past,
--   so the restock either landed or slipped and the stock number is known-suspect.
--   Cheapest, highest-signal tier: on IS9771 this flagged exactly the 6 rows that
--   were actually wrong. Small (~360), so it never starves the rest of the queue.
-- priority 2 'never-synced' — no adidas_inventory rows at all. /adidas HIDES these
--   products entirely, so "never checked" is indistinguishable from "not carried".
-- priority 3 'weekly-sweep-due' — oldest size row older than 7 days. This tier is
--   what makes "full scan every week" real: work it oldest-first every day and the
--   whole catalog is covered on a rolling 7-day basis.
-- priority 4 'fresh' — everything else, still ordered oldest-first to fill the
--   daily budget.
CREATE OR REPLACE VIEW public.adidas_crawl_queue AS
WITH scope AS (
  SELECT p.sku, p.category, p.name
  FROM public.products p
  WHERE p.brand = 'Adidas'
    AND COALESCE(p.is_active, true)
    AND NOT COALESCE(p.is_archived, false)
    -- Agron accessories (socks/bags/balls) are never on Cowork; they have their
    -- own sync and would otherwise sit at the top of the queue forever.
    AND COALESCE(p.inventory_source, 'click') <> 'agron'
),
agg AS (
  SELECT i.sku,
         min(i.last_synced) AS oldest_synced,
         max(i.last_synced) AS newest_synced,
         count(*)           AS size_rows,
         -- future_delivery_date is text; the regex guards a bad value from
         -- breaking the cast for every row in the view.
         count(*) FILTER (
           WHERE i.future_delivery_date ~ '^\d{4}-\d{2}-\d{2}$'
             AND i.future_delivery_date::date < CURRENT_DATE
         ) AS past_due_rows,
         count(*) FILTER (WHERE i.stock_qty > 0) AS in_stock_sizes
  FROM public.adidas_inventory i
  GROUP BY i.sku
)
SELECT
  s.sku,
  s.category,
  s.name,
  COALESCE(a.size_rows, 0)      AS size_rows,
  COALESCE(a.in_stock_sizes, 0) AS in_stock_sizes,
  COALESCE(a.past_due_rows, 0)  AS past_due_rows,
  a.oldest_synced,
  a.newest_synced,
  -- Age of the STALEST size on the SKU. This is the number the sync sorts on.
  (CURRENT_DATE - a.oldest_synced::date) AS oldest_age_days,
  -- Sizes whose last write lags the SKU's own newest write by 2+ days: the
  -- unmapped-size-code skip leaving stale rows behind. Report-only signal.
  CASE WHEN a.oldest_synced IS NOT NULL
         AND a.newest_synced - a.oldest_synced > interval '2 days'
       THEN true ELSE false END AS has_lagging_sizes,
  CASE
    WHEN COALESCE(a.past_due_rows, 0) > 0                    THEN 1
    WHEN a.sku IS NULL                                       THEN 2
    WHEN a.oldest_synced < now() - interval '7 days'         THEN 3
    ELSE 4
  END AS priority,
  CASE
    WHEN COALESCE(a.past_due_rows, 0) > 0                    THEN 'inbound-eta-passed'
    WHEN a.sku IS NULL                                       THEN 'never-synced'
    WHEN a.oldest_synced < now() - interval '7 days'         THEN 'weekly-sweep-due'
    ELSE 'fresh'
  END AS reason
FROM scope s
LEFT JOIN agg a ON a.sku = s.sku;

-- ── adidas_crawl_coverage ─────────────────────────────────────────────────────
-- Single-row health check. The weekly sweep was missing for weeks because nobody
-- could see it was missing; this is the number that makes it visible.
-- pct_covered_7d is the one to watch — it should sit at/near 100.
CREATE OR REPLACE VIEW public.adidas_crawl_coverage AS
SELECT
  count(*)                                                   AS skus_in_scope,
  count(*) FILTER (WHERE q.reason = 'never-synced')          AS never_synced,
  count(*) FILTER (WHERE q.reason = 'inbound-eta-passed')    AS eta_passed,
  count(*) FILTER (WHERE q.has_lagging_sizes)                AS with_lagging_sizes,
  count(*) FILTER (WHERE q.oldest_age_days <= 1)             AS covered_1d,
  count(*) FILTER (WHERE q.oldest_age_days <= 7)             AS covered_7d,
  round(100.0 * count(*) FILTER (WHERE q.oldest_age_days <= 7)
        / NULLIF(count(*), 0), 1)                            AS pct_covered_7d,
  max(q.oldest_age_days)                                     AS worst_age_days,
  -- Sustained SKUs/day needed to hold a rolling 7-day full sweep.
  ceil(count(*) / 7.0)                                       AS daily_budget_for_weekly_sweep
FROM public.adidas_crawl_queue q;
