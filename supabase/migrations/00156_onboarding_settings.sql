-- Employer info for the Wage Theft notice + Job Hire Form, editable in the
-- portal (Onboarding → Settings) instead of env vars. Single-row table.
CREATE TABLE IF NOT EXISTS onboarding_settings (
  id                   text PRIMARY KEY DEFAULT 'default',
  employer_legal_name  text,
  employer_address     text,
  employer_phone       text,
  employer_payday      text,
  workers_comp_carrier text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO onboarding_settings (id, employer_legal_name, employer_phone)
VALUES ('default', 'National Sports Apparel, LLC', '(714) 279-8777')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE onboarding_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON onboarding_settings;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
