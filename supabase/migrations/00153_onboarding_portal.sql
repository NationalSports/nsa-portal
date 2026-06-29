-- ────────────────────────────────────────────────────────────────────────
-- Onboarding portal: invite-only new-hire packet (job hire package + handbook
-- acknowledgment + California notices), stored digitally with a full review
-- audit trail.
--
-- SECURITY MODEL — DELIBERATELY DIFFERENT FROM THE REST OF THE SCHEMA.
-- Most tables here run a permissive "Allow all" RLS policy because the browser
-- talks to them with the public anon key. These tables hold SSNs, dates of
-- birth and bank account/routing numbers, so that model is unacceptable.
--   * RLS is ENABLED with NO permissive policy → the anon AND authenticated
--     roles are denied direct access entirely.
--   * ALL access goes through the Netlify functions (onboarding-admin.js /
--     onboarding-public.js) using the SERVICE ROLE key, which bypasses RLS.
--   * The new hire is never authenticated; they are gated by a single-use
--     random token. Staff are gated by verifyAdmin() (admin/super_admin).
--   * The most sensitive fields (SSN, bank account/routing) are additionally
--     encrypted at the application layer (AES-256-GCM) before they ever reach
--     this table — see netlify/functions/_onboardingCrypto.js — so a raw row
--     read does not expose plaintext.
-- ────────────────────────────────────────────────────────────────────────

-- Invites created by staff in the portal. One row per person we're hiring.
CREATE TABLE IF NOT EXISTS onboarding_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text UNIQUE NOT NULL,
  -- Who they'll be:
  role            text,                  -- NSA role key (rep, csr, warehouse, ...)
  full_name       text NOT NULL,
  personal_email  text NOT NULL,
  nsa_email       text,                  -- future @nationalsportsapparel.com address, if applicable
  -- Position overview (prefilled by staff, shown read-only to the hire):
  position_title  text,
  supervisor      text,
  hire_date       date,
  employment_type text,                  -- 'w2_employee' | 'contractor_1099'
  pay_type        text,                  -- 'salary' | 'hourly' | 'draw_commission'
  pay_rate        text,
  commission_eligible boolean DEFAULT false,
  work_state      text DEFAULT 'CA',     -- drives which legal notices appear
  -- Lifecycle:
  status          text NOT NULL DEFAULT 'invited',  -- invited|in_progress|completed|void
  created_by      text,                  -- team member name/id who issued the invite
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  completed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onb_invites_status ON onboarding_invites(status);
CREATE INDEX IF NOT EXISTS idx_onb_invites_email  ON onboarding_invites(lower(personal_email));

-- The packet the new hire fills out. One row per invite (upserted as they go).
CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id       uuid NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  -- Non-sensitive form data (address, emergency contacts, tax elections,
  -- direct-deposit bank NAME, acknowledgment selections, etc.):
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Sensitive PII, AES-256-GCM encrypted at the app layer before storage:
  -- { ssn:{iv,tag,ct}, bank_account:{...}, bank_routing:{...} }
  sensitive       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-document typed e-signatures: { 'handbook': {name, signed_at}, ... }
  signatures      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-document/section acknowledgments: { 'handbook:section-id': {at, scrolled} }
  acknowledgments jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Progress bookkeeping:
  current_step    text,
  completed_steps text[] DEFAULT '{}',
  submitted       boolean NOT NULL DEFAULT false,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS idx_onb_sub_invite ON onboarding_submissions(invite_id);

-- Append-only audit trail. This is how HR proves the hire actually opened and
-- read every document — every section view, scroll-to-end, acknowledgment,
-- signature and download is recorded here with a timestamp.
CREATE TABLE IF NOT EXISTS onboarding_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id   uuid NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  kind        text NOT NULL,   -- start|step_view|section_view|scroll_complete|acknowledge|sign|save|submit|download
  ref         text,            -- step id / handbook section id / document id
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { dwell_ms, scroll_pct, ua, ip }
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onb_events_invite ON onboarding_events(invite_id, created_at);
CREATE INDEX IF NOT EXISTS idx_onb_events_kind   ON onboarding_events(invite_id, kind);

-- updated_at touch triggers (set_updated_at() already exists in this schema).
DO $$ BEGIN
  CREATE TRIGGER trg_onb_invites_updated
  BEFORE UPDATE ON onboarding_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_onb_submissions_updated
  BEFORE UPDATE ON onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lock everything down: RLS on, NO permissive policy. Only the service-role key
-- (used exclusively by the onboarding-* Netlify functions) can touch these.
ALTER TABLE onboarding_invites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_events      ENABLE ROW LEVEL SECURITY;

-- Defensive: drop the project-wide "Allow all" policy if some shared tooling
-- ever created one on these tables. We intentionally want zero anon access.
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON onboarding_invites;
  DROP POLICY IF EXISTS "Allow all" ON onboarding_submissions;
  DROP POLICY IF EXISTS "Allow all" ON onboarding_events;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
