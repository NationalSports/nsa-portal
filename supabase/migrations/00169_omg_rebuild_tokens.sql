-- Ephemeral snapshot table for OMG store rebuild links.
-- Staff create a token when they share an OMG store for rebuild; coaches/reps
-- open the link and the webstore builder fetches the token to pre-select items
-- and load the decorated mockup images from the original OMG report.
-- No sensitive data — safe for anonymous read.
CREATE TABLE IF NOT EXISTS omg_rebuild_tokens (
  token      TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(6), 'hex'),
  store_name TEXT NOT NULL DEFAULT '',
  sale_code  TEXT NOT NULL DEFAULT '',
  items      JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE omg_rebuild_tokens ENABLE ROW LEVEL SECURITY;

-- Anyone with the token URL can read the snapshot (no auth required).
CREATE POLICY "public_read_rebuild_tokens"
  ON omg_rebuild_tokens FOR SELECT
  USING (true);

-- Only authenticated staff can create tokens.
CREATE POLICY "auth_insert_rebuild_tokens"
  ON omg_rebuild_tokens FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
