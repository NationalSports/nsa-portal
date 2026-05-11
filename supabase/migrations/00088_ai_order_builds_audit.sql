-- Audit log for the "Build with AI" order builder on Estimates / Sales Orders.
-- Stores the raw coach input (text, image refs, or URL), the structured JSON
-- Claude returned, and which lines the user ultimately accepted into the
-- order. Lets us debug coach complaints ("the order is wrong") and tune the
-- prompt by reviewing where users had to make corrections.

CREATE TABLE IF NOT EXISTS public.ai_order_builds (
  id              BIGSERIAL PRIMARY KEY,
  estimate_id     TEXT,
  so_id           TEXT,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  input_type      TEXT NOT NULL,           -- 'text' | 'image' | 'url'
  input_payload   JSONB,                   -- {text?, image_urls?[], url?}
  raw_response    JSONB,                   -- full JSON returned by Claude
  parsed_lines    JSONB,                   -- normalized lines shown in review
  accepted_lines  JSONB,                   -- lines the user kept (set on import)
  line_count      INTEGER,
  accepted_count  INTEGER,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens   INTEGER,
  cache_create_tokens INTEGER,
  error           TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_order_builds_estimate_id
  ON public.ai_order_builds (estimate_id) WHERE estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_order_builds_so_id
  ON public.ai_order_builds (so_id) WHERE so_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_order_builds_user_id
  ON public.ai_order_builds (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_order_builds_created_at
  ON public.ai_order_builds (created_at DESC);

ALTER TABLE public.ai_order_builds ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own builds (mirrors how estimates/SOs
-- are accessed). Service role (edge function) bypasses RLS for writes.
CREATE POLICY ai_order_builds_select_own
  ON public.ai_order_builds FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY ai_order_builds_update_own
  ON public.ai_order_builds FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
