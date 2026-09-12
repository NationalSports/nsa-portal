# Database migrations

This directory holds the SQL migrations that define the database schema for the
NSA Portal Supabase project (`hpslkvngulqirmbstlfx`).

## Source of truth

The authoritative record of what is applied to prod is the
`supabase_migrations.schema_migrations` table on the remote project — **not**
the file list in this directory.

**Why the two can diverge:** files numbered roughly `00001`–`00040` were
applied during early development via `supabase db reset`, which materializes
the schema but does not write per-migration rows. Per-migration tracking
began on 2026-03-25; everything from that point forward should appear in
`schema_migrations`.

If you need to know whether a particular migration ran on prod, query
`schema_migrations` directly — don't infer it from the file list.

## Adding a new migration

1. Pick the next sequential prefix. Look at the highest existing number in
   this directory (excluding `_archive/`) and add 1. The CI check
   (`.github/workflows/migrations-lint.yml`) fails on duplicate prefixes.
2. Name the file `NNNNN_short_description_in_snake_case.sql`.
3. Write the migration so it is **idempotent** where reasonable
   (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, etc.). This protects against partial
   application and makes the file safe to re-run.
4. Apply via `mcp__supabase__apply_migration` (or the Supabase CLI). Verify
   the row appears in `schema_migrations`.

## Things that don't work on Supabase managed Postgres

- **`current_setting('app.settings.<name>')` / `ALTER DATABASE … SET app.settings.*`** —
  custom GUCs cannot be set on Supabase's managed instance. Use the Vault
  pattern instead:
  ```sql
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
  ```
  See `00079_reschedule_send_emails_cron_with_vault.sql` and
  `00082_schedule_daily_backup_cron.sql` for working examples.
- **Direct `INSERT INTO supabase_migrations.schema_migrations`** — only the
  apply path should write here.

## `_archive/`

Files in `_archive/` were **never successfully applied to prod** and have
been **superseded by other migrations**. They are kept for historical
reference only. Do not run them; do not remove them without a separate
discussion. Each archived file has a header comment explaining what
replaced it.

Currently archived:

| File | Replaced by |
|---|---|
| `00059_daily_backup.sql` | `00081_create_backups_bucket.sql` + `00082_schedule_daily_backup_cron.sql` + `supabase/functions/daily-backup/` |

## Known broken historical files

These files were applied (their structural changes — tables, columns,
indexes — did take effect) but contain `cron.schedule(...)` calls that
use the broken `app.settings.*` GUC pattern. The cron portion did not
actually schedule anything on prod. They are grandfathered in the lint
check (`.github/workflows/migrations-lint.yml`) so CI passes, but should
not be used as templates for new work.

| File | Broken portion | Status on prod |
|---|---|---|
| `00011_taxcloud_quarterly_cron.sql` | `taxcloud-refresh` quarterly schedule | **NOT scheduled** — fix pending |
| `00066_taxcloud_daily_missing_rates_cron.sql` | `taxcloud-refresh` daily-missing-rates schedule | **NOT scheduled** — fix pending |
| `00067_scheduled_emails.sql` | `send-scheduled-emails` schedule | Schedule fixed by `00079_reschedule_send_emails_cron_with_vault.sql` |

The taxcloud-refresh cron is a **known follow-up item** — it needs a new
migration that re-schedules the job using the Vault pattern (see
`00079` or `00082` for working examples).

## Don't do these things

- **Don't edit a migration after it has been applied.** Add a new migration
  that performs the correction. The applied file is now part of history.
- **Don't reuse a number prefix.** CI will fail; reviewers will ask you to
  rename.
- **Don't delete a migration file** even if it has been superseded — move it
  to `_archive/` with a header comment instead.
