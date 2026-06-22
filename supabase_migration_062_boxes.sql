-- Migration 062: warehouse box tracking ("BX-####" license plates).
--
-- ADDITIVE ONLY. Creates one new table; touches nothing else. The app reads it
-- via _safeQuery, which returns [] if this table is absent, so deploying the
-- code before/after this migration is safe in either order. Reversible with:
--   DROP TABLE IF EXISTS boxes;
--
-- Overlay model (phase 1): product inventory (_inv) remains the source of truth.
-- A box is a *location overlay* — it records which SKUs/sizes physically sit in
-- a given container. `contents` is the authoritative per-box quantity:
--   [ { sku, name, color, so_id, if_id, sizes: { "S": 3, "M": 2 } } ]

CREATE TABLE IF NOT EXISTS boxes (
  id           TEXT PRIMARY KEY,                 -- 'BX-2001'
  kind         TEXT NOT NULL DEFAULT 'fulfillment', -- stock | fulfillment | consolidation | receiving
  contents     JSONB NOT NULL DEFAULT '[]',       -- [{sku,name,color,so_id,if_id,sizes:{}}]
  source_refs  JSONB NOT NULL DEFAULT '[]',       -- [{type:'IF',id:'IF-1071'},{type:'PO',id:'NSA-4501'}]
  so_id        TEXT,
  if_id        TEXT,
  po_id        TEXT,
  status       TEXT NOT NULL DEFAULT 'staged',    -- staged | at_deco | shipped | combined | voided
  merged_into  TEXT,                              -- surviving plate when this box was absorbed
  bin          TEXT,                              -- phase 2 (bin location)
  weight       NUMERIC,
  dimensions   JSONB,
  notes        TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boxes_if_id_idx   ON boxes (if_id);
CREATE INDEX IF NOT EXISTS boxes_so_id_idx   ON boxes (so_id);
CREATE INDEX IF NOT EXISTS boxes_po_id_idx   ON boxes (po_id);
CREATE INDEX IF NOT EXISTS boxes_status_idx  ON boxes (status);
CREATE INDEX IF NOT EXISTS boxes_bin_idx      ON boxes (bin);

-- RLS — same "Allow all" convention as the other portal tables (staff app uses
-- the authenticated/anon key; access is gated in the app, not per-row here).
ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON boxes FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Monotonic box-number counter lives in app_state (key 'box_seq'); the app
-- reads/increments it when minting a new BX-#### id. Seed it once, high enough
-- to avoid any collision with hand-written ids.
INSERT INTO app_state (id, value, updated_at)
VALUES ('box_seq', '2000', now())
ON CONFLICT (id) DO NOTHING;
