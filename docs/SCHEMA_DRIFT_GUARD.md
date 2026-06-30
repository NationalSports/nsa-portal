# Schema Drift Guard

A small read-only loop that catches the recurring incident the data-persistence
audits keep flagging: a migration applied straight to the live Supabase DB
(e.g. from the dashboard) that exists **nowhere in this repo**, so the repo
stops being a faithful description of production.

## How it works

`scripts/check-schema-drift.js` compares the **live migration history**
(`supabase_migrations.schema_migrations`) against:

1. the repo's migration files (`supabase/migrations/*.sql` + the legacy
   top-level `supabase_migration_*.sql`), matched by normalized name, and
2. a **baseline** of already-acknowledged live versions
   (`supabase/migration-baseline.json`).

It alarms **only on the delta** — a live migration that is neither matched by a
repo file nor baselined. The baseline exists because years of independent
naming left ~50 historical mismatches that are not real drift; baselining them
once makes the loop quiet so the *next* real out-of-band change stands out.

- Exit `0` = in sync. Exit `1` = unacknowledged drift. Exit `2` = setup error.

## The loop

`.github/workflows/schema-drift.yml` runs it daily (and on PRs that touch
migrations). The job going **red is the alarm**. It needs one repo secret:

- `SUPABASE_DB_URL` — a Postgres connection string. A read-only role is enough;
  the check runs a single `SELECT` on `supabase_migrations.schema_migrations`.

## When drift fires

1. Find the live migration it names and add the matching `.sql` to
   `supabase/migrations/` (or rename an existing file to match).
2. Re-baseline once reconciled:

   ```sh
   supabase migration list --linked -o json \
     | node scripts/check-schema-drift.js --update-baseline
   # or from a saved snapshot:
   node scripts/check-schema-drift.js --live live-migrations.json --update-baseline
   ```

## Run it locally

```sh
# Against a saved snapshot of the live list:
npm run check:schema-drift -- --live live-migrations.json
```
