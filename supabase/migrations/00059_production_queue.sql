-- ============================================================
-- M&R ColorPRINT Hot Folder Integration
-- production_queue  — rows the bridge script polls
-- bridge_heartbeats — liveness pings from the M&R PC
-- production-tickets storage bucket for ticket PDFs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_queue (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id              TEXT NOT NULL,                              -- e.g. "SO-1042" (sales_orders.id is text)
  art_id             TEXT NOT NULL,                              -- the art file id within the SO
  art_name           TEXT,                                       -- human label e.g. "OLU Baseball Front"
  deco_type          TEXT NOT NULL CHECK (deco_type IN ('screen_print','embroidery')),
  file_url           TEXT NOT NULL,                              -- Cloudinary/Supabase URL to the .ai or .dst
  file_name          TEXT NOT NULL,                              -- original filename
  file_ext           TEXT NOT NULL,                              -- 'ai' | 'dst'
  ticket_pdf_url     TEXT,                                       -- small job-ticket PDF w/ barcode
  barcode_value      TEXT NOT NULL,                              -- e.g. "SO-1042-af1715..."

  hot_folder_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (hot_folder_status IN ('pending','delivered','failed','cancelled')),
  delivered_at       TIMESTAMPTZ,
  delivered_by       TEXT,                                       -- hostname of bridge
  error_message      TEXT,
  retry_count        INT NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prodq_status_created  ON public.production_queue (hot_folder_status, created_at);
CREATE INDEX IF NOT EXISTS idx_prodq_barcode         ON public.production_queue (barcode_value);
CREATE INDEX IF NOT EXISTS idx_prodq_so              ON public.production_queue (so_id);

ALTER TABLE public.production_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prodq_service_all" ON public.production_queue;
CREATE POLICY "prodq_service_all" ON public.production_queue
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "prodq_auth_all" ON public.production_queue;
CREATE POLICY "prodq_auth_all" ON public.production_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.production_queue; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;


-- ─── Bridge heartbeats ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bridge_heartbeats (
  hostname  TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL,
  notes     TEXT
);

ALTER TABLE public.bridge_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hb_service_all" ON public.bridge_heartbeats;
CREATE POLICY "hb_service_all" ON public.bridge_heartbeats
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "hb_auth_read" ON public.bridge_heartbeats;
CREATE POLICY "hb_auth_read" ON public.bridge_heartbeats
  FOR SELECT TO authenticated USING (true);


-- ─── Storage bucket for ticket PDFs ─────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('production-tickets', 'production-tickets', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_upload_prod_tickets"   ON storage.objects;
CREATE POLICY "auth_upload_prod_tickets"   ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'production-tickets');

DROP POLICY IF EXISTS "auth_update_prod_tickets"   ON storage.objects;
CREATE POLICY "auth_update_prod_tickets"   ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'production-tickets');

DROP POLICY IF EXISTS "auth_delete_prod_tickets"   ON storage.objects;
CREATE POLICY "auth_delete_prod_tickets"   ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'production-tickets');

DROP POLICY IF EXISTS "public_read_prod_tickets"   ON storage.objects;
CREATE POLICY "public_read_prod_tickets"   ON storage.objects FOR SELECT USING (bucket_id = 'production-tickets');
