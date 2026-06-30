-- Audit log for the AI bill-reconciliation pass (ai-bill-matcher edge function).
-- When a supplier bill matched a PO but its line items didn't reconcile (vendor
-- size-label quirks / placeholder SKUs), Claude is given the bill lines + the
-- order's real lines and maps each bill line onto the order's actual SKU + size
-- bucket. We log the inputs and the mapping so we can debug a bad reconciliation
-- ("why did this push the wrong size?") and tune the prompt over time.
--
-- The edge function writes this best-effort: if the table is absent the function
-- still returns its mapping, so this migration is not required for the feature
-- to work — only for the audit trail.

CREATE TABLE IF NOT EXISTS public.ai_bill_matches (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  doc_number      TEXT,                    -- supplier invoice document number
  po_number       TEXT,                    -- the PO the bill matched
  model           TEXT,
  bill_lines      JSONB,                   -- the bill lines sent to Claude
  order_lines     JSONB,                   -- the matched order's lines (closed set)
  mappings        JSONB,                   -- validated bill-line -> order SKU/size mapping
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_bill_matches_doc_number
  ON public.ai_bill_matches (doc_number) WHERE doc_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_bill_matches_po_number
  ON public.ai_bill_matches (po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_bill_matches_user_id
  ON public.ai_bill_matches (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_bill_matches_created_at
  ON public.ai_bill_matches (created_at DESC);

ALTER TABLE public.ai_bill_matches ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own reconciliation records. The service
-- role (edge function) bypasses RLS for inserts.
CREATE POLICY ai_bill_matches_select_own
  ON public.ai_bill_matches FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
