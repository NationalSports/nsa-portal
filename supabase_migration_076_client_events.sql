-- Client-event telemetry (2026-07-28).
-- Forced tab reloads (deploy-reload watcher) and forced re-logins were anecdotal — "the portal
-- keeps booting reps mid-work" — with no way to measure them before/after a fix. Disruptive
-- client events now land one row each here via dbEngine._logClientEvent (fire-and-forget).
-- Events so far: deploy_reload (details.reason: safe-idle | stuck-forced | deadline | user),
-- forced_reauth. Writes are insert-only for signed-in staff; nothing updates or deletes rows
-- from the client. user_email is self-reported from the client's login state (telemetry, not
-- an audit record — audit_log remains the authoritative trail).
CREATE TABLE IF NOT EXISTS client_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email TEXT,
  event TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_events_event_at ON client_events (event, created_at);

ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_events_insert ON client_events;
CREATE POLICY client_events_insert ON client_events FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS client_events_select ON client_events;
CREATE POLICY client_events_select ON client_events FOR SELECT TO authenticated USING (true);
GRANT INSERT, SELECT ON client_events TO authenticated;
