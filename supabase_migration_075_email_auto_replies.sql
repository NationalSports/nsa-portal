-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 075: hello@ auto-responder audit log
--
-- One row per email that reaches the hello-inbound Netlify function (the
-- Brevo inbound webhook for hello@nationalsportsapparel.com). Serves three
-- jobs: idempotency (unique inbound_message_id makes webhook retries no-ops),
-- rate limiting (max auto-replies per sender per window), and an audit trail
-- to review misfires and measure deflection.
--
-- PURELY ADDITIVE: one new table, no changes to existing objects.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_auto_replies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id TEXT UNIQUE,           -- RFC Message-Id (or synthetic hash) of the inbound email
  from_email         TEXT,
  subject            TEXT,
  snippet            TEXT,                  -- first 500 chars of the body, for review
  lane               TEXT,                  -- status | problem | other | automated
  order_numbers      TEXT[],                -- numbers extracted from the email
  matched_order_ids  UUID[],                -- webstore_orders.id resolved
  action             TEXT,                  -- processing | replied_* | shadow_replied_* | ignored_* | skipped_* | error
  mode               TEXT,                  -- shadow | live | off
  reply_to_email     TEXT,                  -- where the reply actually went (shadow inbox in shadow mode)
  error              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_auto_replies_from_created
  ON email_auto_replies (from_email, created_at DESC);

ALTER TABLE email_auto_replies ENABLE ROW LEVEL SECURITY;

-- Staff can read the log in-app (future dashboard tile); writes stay
-- service-role only (the Netlify function). No anon access.
DO $$ BEGIN
  CREATE POLICY email_auto_replies_auth_read ON email_auto_replies
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
