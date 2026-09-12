-- Device push tokens for the NSA Team Portal iOS app (Capacitor wrapper in
-- coach-ios/). The app is link-gated like the coach portal — a device
-- registers under the team's ?portal=<alpha_tag>, and the token is stored here
-- so order-status changes (shipped + tracking, art ready to approve, etc.) can
-- be pushed to that coach's phone.
--
-- Writes come ONLY from the service role via netlify/functions/coach-register-push.js
-- (the portal itself is anon and cannot write under RLS — same pattern as every
-- other coach action: portal-action.js, roster-write.js, coach-store-submit).
-- Nothing here is active until an APNs key + env vars are configured and the
-- sender is wired in; see coach-ios/PUSH_NOTIFICATIONS.md.
CREATE TABLE IF NOT EXISTS public.coach_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),   -- refreshed each app launch/register
  customer_id TEXT,                       -- team this device belongs to (resolved from alpha_tag)
  alpha_tag TEXT NOT NULL,                -- portal tag the device registered under
  platform TEXT NOT NULL DEFAULT 'ios',   -- ios | android
  token TEXT NOT NULL,                    -- APNs device token (hex) / FCM token
  environment TEXT NOT NULL DEFAULT 'production',  -- APNs 'production' | 'sandbox'
  app_version TEXT,
  disabled BOOLEAN NOT NULL DEFAULT false,   -- flipped true on an APNs 410 (Unregistered)
  UNIQUE (token, platform)
);

ALTER TABLE public.coach_push_tokens ENABLE ROW LEVEL SECURITY;

-- Sender lookups are by team; only send to live devices.
CREATE INDEX IF NOT EXISTS idx_coach_push_tokens_customer
  ON public.coach_push_tokens (customer_id) WHERE NOT disabled;
CREATE INDEX IF NOT EXISTS idx_coach_push_tokens_alpha
  ON public.coach_push_tokens (alpha_tag) WHERE NOT disabled;

-- Keep updated_at fresh on every write (reuses the shared trigger fn from 00039).
DROP TRIGGER IF EXISTS trg_coach_push_tokens_updated ON public.coach_push_tokens;
CREATE TRIGGER trg_coach_push_tokens_updated
  BEFORE UPDATE ON public.coach_push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Device tokens are sensitive: no anon / coach read or write policies at all.
-- Registration and sending both run as the service role (RLS-exempt). Portal
-- staff may read for support/debugging, mirroring coach_saved_orders (00129).
DROP POLICY IF EXISTS coach_push_tokens_staff_read ON public.coach_push_tokens;
CREATE POLICY coach_push_tokens_staff_read ON public.coach_push_tokens
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)));
