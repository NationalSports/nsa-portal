-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 011: vendor B2B login + catalog files
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- Lets each vendor record store the B2B portal URL, account credentials,
-- and a list of catalog PDF uploads (hosted on Cloudinary). Passwords are
-- stored in plain text and visible to anyone with admin access to the
-- portal — vendors only, not employee credentials.

DO $$ BEGIN
  ALTER TABLE vendors ADD COLUMN b2b_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD COLUMN b2b_username TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD COLUMN b2b_password TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD COLUMN catalog_files JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
