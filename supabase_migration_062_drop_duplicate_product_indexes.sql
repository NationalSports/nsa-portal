-- Migration 062: Drop duplicate / unused indexes on public.products
--
-- The products table is the most heavily-upserted table in the DB (inventory syncs
-- rewrite hundreds of thousands of rows). It carried 13 indexes, 4 of which were pure
-- write-amplification with no read benefit:
--
--   * idx_products_name_trgm     - EXACT duplicate of products_name_trgm (gin name gin_trgm_ops)
--   * products_sku_trgm          - EXACT duplicate of idx_products_sku_trgm (gin sku gin_trgm_ops)
--   * idx_products_sku           - 0 scans; redundant with the products_sku_unique constraint
--   * idx_products_is_clearance  - 0 scans; unused partial index
--
-- Every upsert had to maintain all four (the two GIN trigram dups are especially costly and
-- inflate WAL, which in turn feeds Realtime's WAL-decode CPU cost). Dropping them reclaimed
-- ~22 MB of index storage and removed 4 indexes from the write path with zero loss of query
-- coverage (the surviving twin index serves every search; sku lookups use products_sku_unique).
--
-- Applied directly to production on 2026-06-25. This file records it so the schema history is
-- accurate and the duplicates are never recreated.
--
-- Reversal (only if a regression is found):
--   CREATE INDEX idx_products_name_trgm    ON public.products USING gin (name gin_trgm_ops);
--   CREATE INDEX products_sku_trgm         ON public.products USING gin (sku gin_trgm_ops);
--   CREATE INDEX idx_products_sku          ON public.products USING btree (sku);
--   CREATE INDEX idx_products_is_clearance ON public.products USING btree (is_clearance) WHERE (is_clearance = true);

DROP INDEX IF EXISTS public.idx_products_name_trgm;
DROP INDEX IF EXISTS public.products_sku_trgm;
DROP INDEX IF EXISTS public.idx_products_sku;
DROP INDEX IF EXISTS public.idx_products_is_clearance;
