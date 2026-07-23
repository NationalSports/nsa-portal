-- Optimistic concurrency for so_jobs — APPLIED to production 2026-07-20 via MCP
-- (migration name: so_jobs_version_cas_backstop). Verified live: so_jobs._version + trg_so_jobs_version.
--
-- Audit 2026-07-10, finding A9: so_jobs persistence is a blind whole-row upsert with no
-- version/CAS guard — unlike sales_orders/estimates/customers (00049), the art-file tables
-- (00103) and invoices (00180). A stale-closure client save can overwrite a just-merged
-- coach decision with no server rejection. The client now defends the coach columns
-- directly (dbEngine re-injects non-null coach values a stale save would null, unless the
-- save carries the deliberate-clear marker); this migration is the structural backstop the
-- audit recommends — a per-job _version the client can CAS against, mirroring the 00180
-- pattern. The trigger owns the counter; clients never write _version (not in _jobCols).
--
-- Client wiring (read _version on load, _checkVersion-style guard per job before the
-- upsert) is a follow-up that lands AFTER this is applied — until then the column simply
-- doesn't exist and nothing references it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='so_jobs' AND column_name='_version') THEN
    ALTER TABLE so_jobs ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
END$$;

-- increment_version() already exists (created by 00049).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_so_jobs_version') THEN
    CREATE TRIGGER trg_so_jobs_version BEFORE UPDATE ON so_jobs FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
END$$;
