-- ============================================================
-- NSA Portal – Enable Realtime on ALL tables
-- Migration: 00008_realtime_all_tables
--
-- The previous migration (00007) only added 8 tables to
-- supabase_realtime. This adds ALL tables so that changes
-- on any table (products, art files, etc.) propagate via
-- realtime subscriptions to all connected clients.
-- ============================================================

DO $$
BEGIN
  -- Core tables
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.customers; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_contacts; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vendors; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.products; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.product_inventory; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Estimates + children
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimates; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimate_art_files; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimate_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimate_item_decorations; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Sales Orders + children
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_orders; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_art_files; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_firm_dates; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_decorations; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_pick_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_po_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_jobs; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Invoices + children
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_payments; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_items; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Messages
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- OMG Stores
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.omg_stores; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.omg_store_products; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Issues, App State, Settings, Sequences
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.issues; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_state; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.id_sequences; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
