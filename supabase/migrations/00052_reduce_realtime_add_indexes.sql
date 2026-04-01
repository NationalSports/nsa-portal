-- ============================================================
-- NSA Portal – Reduce Disk IO: trim realtime + add indexes
-- Migration: 00052_reduce_realtime_add_indexes
--
-- Problem: All 20+ tables were added to supabase_realtime,
-- causing write amplification on every INSERT/UPDATE/DELETE.
-- Only core tables need realtime for multi-user sync.
--
-- Also adds missing indexes on foreign key columns that are
-- scanned during polling/joins.
-- ============================================================

-- ─── 1. Remove non-essential tables from realtime publication ───
-- Keep only: estimates, sales_orders, invoices, messages, customers, products
DO $$
BEGIN
  -- Child/lookup tables that don't need realtime — parent changes trigger reloads
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.team_members; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.customer_contacts; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vendors; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.product_inventory; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.estimate_art_files; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.estimate_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.estimate_item_decorations; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_art_files; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_firm_dates; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_item_decorations; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_item_pick_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_item_po_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.so_jobs; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.invoice_payments; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.invoice_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.message_reads; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.omg_stores; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.omg_store_products; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.issues; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.app_state; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.app_settings; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.id_sequences; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.deco_vendors; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.deco_vendor_pricing; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.customer_credits; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.customer_credit_usage; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ─── 2. Add missing indexes on foreign key columns ───
-- These columns are used in JOINs/filters during every poll cycle
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_item_decorations_item_id ON estimate_item_decorations(estimate_item_id);
CREATE INDEX IF NOT EXISTS idx_so_items_so_id ON so_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_so_item_decorations_item_id ON so_item_decorations(so_item_id);
CREATE INDEX IF NOT EXISTS idx_so_item_pick_lines_item_id ON so_item_pick_lines(so_item_id);
CREATE INDEX IF NOT EXISTS idx_so_item_po_lines_item_id ON so_item_po_lines(so_item_id);
CREATE INDEX IF NOT EXISTS idx_so_jobs_so_id ON so_jobs(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_omg_store_products_store_id ON omg_store_products(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON customer_contacts(customer_id);

-- ─── 3. Add indexes on email_status columns (polled every 60s for Brevo tracking) ───
CREATE INDEX IF NOT EXISTS idx_estimates_email_status ON estimates(email_status) WHERE email_status = 'sent';
CREATE INDEX IF NOT EXISTS idx_sales_orders_email_status ON sales_orders(email_status) WHERE email_status = 'sent';
CREATE INDEX IF NOT EXISTS idx_invoices_email_status ON invoices(email_status) WHERE email_status = 'sent';
