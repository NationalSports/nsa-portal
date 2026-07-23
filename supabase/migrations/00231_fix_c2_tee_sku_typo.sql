-- Data-fix record (applied manually 2026-07-22, committed here for auditability and
-- idempotent re-runs): three orders carried a hand-typed dropped-zero SKU '51000' for
-- the Momentec C2 TEE; the catalog SKU is '510000'. Product-verified before fixing
-- (products.sku '510000' = 'C2 TEE'; '51000' is not a catalog SKU).
update so_items set sku = '510000'
where sku = '51000' and name ilike '%C2 TEE%';
