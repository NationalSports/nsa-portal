-- I-9 tracking + reminder bookkeeping on invites
ALTER TABLE onboarding_invites
  ADD COLUMN IF NOT EXISTS i9_status text NOT NULL DEFAULT 'pending',   -- pending | completed | na
  ADD COLUMN IF NOT EXISTS i9_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS i9_verified_by text,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;

-- Uploaded documents (voided check, photo ID, signed forms, certifications…).
-- Files live in the private 'onboarding-docs' storage bucket; this table is the
-- metadata index. Access is service-role only (RLS on, no policy), same as the
-- rest of the onboarding tables.
CREATE TABLE IF NOT EXISTS onboarding_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id     uuid NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'other',  -- voided_check | photo_id | signed_form | certification | other
  filename      text NOT NULL,
  storage_path  text NOT NULL,
  content_type  text,
  size_bytes    integer,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onb_docs_invite ON onboarding_documents(invite_id, uploaded_at);

ALTER TABLE onboarding_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON onboarding_documents;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Private storage bucket for the uploaded files (10 MB cap).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('onboarding-docs', 'onboarding-docs', false, 10485760)
ON CONFLICT (id) DO NOTHING;
