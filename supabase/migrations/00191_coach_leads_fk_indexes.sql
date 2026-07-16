-- coach_leads has two FK columns with no covering index (customer_id, webstore_id, added
-- in 00188_coach_leads.sql) — joins/lookups driven by either column, and the cascade-check
-- on customers/webstores deletes, would fall back to sequential scans as the table grows.
--
-- This repo has repeatedly had to clean up unindexed FKs after the advisor flags them (see
-- 00076_add_indexes_for_unindexed_foreign_keys.sql); adding these up front instead of
-- waiting for the next audit pass.
--
-- Table is tiny today, so CREATE INDEX is microsecond-fast — no need for CONCURRENTLY.
-- CREATE INDEX IF NOT EXISTS makes this idempotent. Naming convention: idx_<table>_<fk_column>.
--
-- Filename note: main's own history has already taken 00191 (00191_omg_line_sku_backfill.sql,
-- unrelated) by the time this branch merges. This repo's established convention is not to
-- renumber in-flight branch migrations to dodge that — see the existing duplicate
-- 00169/00170/00173/00177/00178 pairs already in this directory. Each migration's own applied
-- version/timestamp is the real ordering key, not the filename prefix.
--
-- Rollback (run via SQL editor if needed):
--   DROP INDEX IF EXISTS public.idx_coach_leads_customer_id;
--   DROP INDEX IF EXISTS public.idx_coach_leads_webstore_id;

CREATE INDEX IF NOT EXISTS idx_coach_leads_customer_id ON public.coach_leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_coach_leads_webstore_id ON public.coach_leads(webstore_id);
