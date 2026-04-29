-- Scheduled emails queue + cron-driven sender.
--
-- Lets the app insert an email payload to be sent later (e.g. an invoice the
-- customer should receive on the delivery date). A pg_cron job runs every
-- 15 minutes and invokes the `send-scheduled-emails` Edge Function, which
-- picks up any rows where status='pending' and send_at <= now() and POSTs
-- them to Brevo.
--
-- Brevo's native scheduledAt parameter only allows ~72 hours in advance, so
-- for invoices scheduled weeks/months out we hold them ourselves and send
-- on time via cron.

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Wall-clock time when this email should be released to Brevo.
  send_at         TIMESTAMPTZ NOT NULL,

  -- Brevo payload, stored as JSONB so the Edge Function can hand it to
  -- the API with minimal transformation.
  to_emails       JSONB NOT NULL,            -- [{email, name?}, ...]
  cc_emails       JSONB NOT NULL DEFAULT '[]'::JSONB,
  subject         TEXT NOT NULL,
  html_content    TEXT NOT NULL,
  sender_name     TEXT,
  sender_email    TEXT,
  reply_to        JSONB,                     -- {email, name?} or null
  attachments     JSONB NOT NULL DEFAULT '[]'::JSONB,  -- [{name, content (base64)}]

  -- What this email is for, so the UI can show "scheduled" status
  -- against the originating record.
  related_type    TEXT,                      -- 'invoice' | 'estimate' | ...
  related_id      TEXT,

  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed | cancelled
  sent_at         TIMESTAMPTZ,
  message_id      TEXT,
  error_message   TEXT,
  attempt_count   INT NOT NULL DEFAULT 0,

  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queue scan: cheap to find due rows.
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due
  ON scheduled_emails(send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_related
  ON scheduled_emails(related_type, related_id);

-- RLS matches the rest of the schema.
ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON scheduled_emails FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Cron schedule ─────────────────────────────────────────────────────────
-- pg_cron is already installed by earlier migrations (00011, 00059, etc.).
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('send-scheduled-emails');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Run every 15 minutes. Brevo doesn't promise minute-precision delivery so
-- this granularity is more than enough for invoice-on-delivery-date use.
SELECT cron.schedule(
  'send-scheduled-emails',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-scheduled-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
