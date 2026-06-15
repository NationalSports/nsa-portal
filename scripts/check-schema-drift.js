#!/usr/bin/env node
/**
 * Schema-drift guard — flags when a migration reaches the live Supabase DB
 * without a counterpart in this repo, so the repo stops describing production.
 * This is the recurring incident the data-persistence audits keep catching
 * ("migrations applied to the live DB that exist nowhere in this repo").
 *
 * Read-only: it never touches the database. It compares the live migration
 * history against (a) the repo's migration files and (b) a baseline of
 * already-acknowledged live versions, and alarms only on the delta — so the
 * historical naming drift doesn't drown the one new signal that matters.
 *
 * Usage:
 *   # Live list from the Supabase CLI (see .github/workflows/schema-drift.yml):
 *   supabase migration list --linked -o json | node scripts/check-schema-drift.js
 *
 *   # From a saved JSON snapshot ([{version,name}] or {migrations:[...]}):
 *   node scripts/check-schema-drift.js --live live-migrations.json
 *
 *   # Accept the current live state as the new baseline (after reviewing drift):
 *   node scripts/check-schema-drift.js --live live-migrations.json --update-baseline
 *
 * Exit code 0 = in sync, 1 = unacknowledged drift, 2 = usage/IO error.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'supabase', 'migration-baseline.json');

// Reduce a live `name` or a repo filename to the same token so they can match:
//   00116_webstore_rls_lockdown.sql -> webstore_rls_lockdown
//   supabase_migration_011_webstores.sql -> webstores
//   011_webstores (live) -> webstores
function normalize(name) {
  return String(name)
    .replace(/\.sql$/i, '')
    .replace(/^supabase_migration_/i, '')
    .replace(/^\d+[_-]+/, '')
    .replace(/^\d+[_-]+/, '')
    .toLowerCase()
    .trim();
}

function repoMigrationNames() {
  const names = new Set();
  const dir = path.join(ROOT, 'supabase', 'migrations');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.sql')) names.add(normalize(f));
  }
  for (const f of fs.readdirSync(ROOT)) {
    if (/^supabase_migration_.*\.sql$/i.test(f)) names.add(normalize(f));
  }
  return names;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return new Set();
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    return new Set((j.acknowledged || []).map((v) => String(v)));
  } catch (e) {
    console.error('Could not read baseline:', e.message);
    process.exit(2);
  }
}

function parseLive(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.error('Could not parse live migration JSON:', e.message);
    process.exit(2);
  }
  const rows = Array.isArray(data) ? data : (data.migrations || data.rows || []);
  return rows
    .map((r) => ({ version: String(r.version || r.Version || ''), name: r.name || r.Name || '' }))
    .filter((r) => r.name);
}

function readLive() {
  const idx = process.argv.indexOf('--live');
  if (idx >= 0 && process.argv[idx + 1]) return fs.readFileSync(process.argv[idx + 1], 'utf8');
  if (process.stdin.isTTY) {
    console.error('No live migration list. Pipe `supabase migration list -o json` in, or pass --live <file>.');
    process.exit(2);
  }
  return fs.readFileSync(0, 'utf8');
}

function main() {
  const live = parseLive(readLive());
  const repo = repoMigrationNames();
  const baseline = loadBaseline();

  // Drift = a live migration that is neither matched by a repo file nor already
  // acknowledged in the baseline.
  const drift = live.filter((m) => !repo.has(normalize(m.name)) && !baseline.has(m.version));

  if (process.argv.includes('--update-baseline')) {
    const acknowledged = live.map((m) => m.version).sort();
    fs.writeFileSync(BASELINE, JSON.stringify({
      _comment: 'Live Supabase migrations acknowledged as in-sync. Regenerate after reconciling drift: node scripts/check-schema-drift.js --live <file> --update-baseline',
      generated: new Date().toISOString().slice(0, 10),
      acknowledged,
    }, null, 2) + '\n');
    console.log(`Baseline updated — ${acknowledged.length} live migrations acknowledged (${path.relative(ROOT, BASELINE)}).`);
    process.exit(0);
  }

  console.log(`Schema-drift check — ${live.length} live migrations, ${repo.size} repo files, ${baseline.size} baselined.\n`);

  if (drift.length === 0) {
    console.log('✓ In sync — no unacknowledged live migrations.');
    process.exit(0);
  }

  console.log(`✗ DRIFT: ${drift.length} live migration(s) reached prod with no repo file and not baselined:\n`);
  for (const m of drift) console.log(`  • ${m.version}  ${m.name}`);
  console.log(
    '\nReconcile by committing the matching .sql to supabase/migrations/, then\n' +
    'acknowledge with:  node scripts/check-schema-drift.js --live <file> --update-baseline'
  );
  process.exit(1);
}

main();
