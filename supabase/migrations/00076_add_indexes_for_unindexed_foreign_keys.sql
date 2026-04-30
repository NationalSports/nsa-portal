-- Adds covering b-tree indexes for the 13 foreign key columns flagged
-- by the unindexed_foreign_keys advisor. Without these, joins driven by
-- the FK direction and cascading delete checks fall back to sequential
-- scans on the referencing table.
--
-- All tables involved are small today (most under 10 rows; products
-- ~5.5k), so CREATE INDEX is microsecond-fast and the lock window is
-- imperceptible — no need for CONCURRENTLY. CREATE INDEX IF NOT EXISTS
-- makes this idempotent.
--
-- Naming convention: idx_<table>_<fk_column>.
--
-- Rollback (run via SQL editor if needed):
--   DROP INDEX IF EXISTS public.idx_customer_credit_usage_estimate_id;
--   DROP INDEX IF EXISTS public.idx_customer_promo_periods_program_id;
--   DROP INDEX IF EXISTS public.idx_customer_promo_usage_estimate_id;
--   DROP INDEX IF EXISTS public.idx_deco_vendor_pricing_deco_vendor_id;
--   DROP INDEX IF EXISTS public.idx_estimate_items_product_id;
--   DROP INDEX IF EXISTS public.idx_estimates_created_by;
--   DROP INDEX IF EXISTS public.idx_invoices_created_by;
--   DROP INDEX IF EXISTS public.idx_messages_author_id;
--   DROP INDEX IF EXISTS public.idx_messages_customer_id;
--   DROP INDEX IF EXISTS public.idx_omg_stores_rep_id;
--   DROP INDEX IF EXISTS public.idx_sales_orders_created_by;
--   DROP INDEX IF EXISTS public.idx_so_items_product_id;
--   DROP INDEX IF EXISTS public.idx_todo_comments_todo_id;

CREATE INDEX IF NOT EXISTS idx_customer_credit_usage_estimate_id ON public.customer_credit_usage(estimate_id);
CREATE INDEX IF NOT EXISTS idx_customer_promo_periods_program_id ON public.customer_promo_periods(program_id);
CREATE INDEX IF NOT EXISTS idx_customer_promo_usage_estimate_id  ON public.customer_promo_usage(estimate_id);
CREATE INDEX IF NOT EXISTS idx_deco_vendor_pricing_deco_vendor_id ON public.deco_vendor_pricing(deco_vendor_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_product_id          ON public.estimate_items(product_id);
CREATE INDEX IF NOT EXISTS idx_estimates_created_by               ON public.estimates(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by                ON public.invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_messages_author_id                 ON public.messages(author_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer_id               ON public.messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_omg_stores_rep_id                  ON public.omg_stores(rep_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by            ON public.sales_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_so_items_product_id                ON public.so_items(product_id);
CREATE INDEX IF NOT EXISTS idx_todo_comments_todo_id              ON public.todo_comments(todo_id);
