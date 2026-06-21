-- Optimistic locking for art files so a stale tab can't overwrite another user's
-- approval status / mockups. Mirrors the _version pattern already on
-- estimates / sales_orders / customers (see 00047). The increment_version()
-- trigger function is reused.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='so_art_files' AND column_name='_version') THEN
    ALTER TABLE so_art_files ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='estimate_art_files' AND column_name='_version') THEN
    ALTER TABLE estimate_art_files ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_so_art_files_version') THEN
    CREATE TRIGGER trg_so_art_files_version BEFORE UPDATE ON so_art_files FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_art_files_version') THEN
    CREATE TRIGGER trg_estimate_art_files_version BEFORE UPDATE ON estimate_art_files FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
END$$;
