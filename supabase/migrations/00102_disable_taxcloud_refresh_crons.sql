-- Disable the background TaxCloud rate-refresh cron jobs.
--
-- Why: these two crons re-query TaxCloud for customers that already have
-- (or already failed to get) a rate, generating large numbers of "Lookup"
-- calls that show up on the TaxCloud dashboard as $100 / "rate-refresh"
-- transactions. The quarterly job alone re-looks-up every active customer
-- (~2,100 calls per run). Rates almost never change for an existing
-- customer, so this background traffic is unnecessary.
--
-- New policy: TaxCloud is only called once per new customer, on request,
-- via the taxcloud-lookup edge function at customer create/import time.
-- Invoice filing (taxcloud-capture) is unchanged. No background refreshes.
--
-- This unschedules the jobs created by:
--   00011_taxcloud_quarterly_cron.sql
--   00066_taxcloud_daily_missing_rates_cron.sql
--   00083_reschedule_taxcloud_crons_with_vault.sql
--
-- Rollback (re-enable if ever needed): re-run 00083.

DO $$ BEGIN
  PERFORM cron.unschedule('taxcloud-quarterly-refresh');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('taxcloud-daily-missing-rates');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
