#!/usr/bin/env node
/**
 * Column-parity guard — every column the client WRITES must exist in the table(s) it writes to.
 *
 * This is the recurring incident neither existing guard catches. The schema-drift guard only
 * flags migrations that reached the live DB without a repo file; it says nothing about a column
 * the client writes that no migration ever created. Two of those shipped a week apart:
 *
 *   - sample_art  — added to so_art_files (00046) but never to estimate_art_files, so every
 *                   estimate art save was rejected and silently re-sent without color_ways,
 *                   design_id, preview_url, item_mockups and eight more.
 *   - split_runs / priced_separately / price_override / split_group — shipped with split-job
 *                   pricing (#1789) with no migration at all.
 *
 * In both cases PostgREST rejects the whole batch and the client's recovery drops columns to get
 * the write through, so the failure is invisible: the save "succeeds" and the data is gone.
 *
 * Read-only: one query against information_schema.
 *
 * Works WITHOUT database credentials by default: it checks against the committed snapshot in
 * supabase/schema-columns.json, so the guard actually runs on every PR instead of skipping (the
 * pre-existing drift job silently skips when SUPABASE_DB_URL is unset, which is why it has been
 * green all along). With SUPABASE_DB_URL set it checks the live schema and is authoritative.
 *
 * Known gaps are acknowledged in supabase/column-parity-baseline.json — same convention as
 * supabase/migration-baseline.json. A baselined gap reports as a notice; anything else fails.
 *
 * Usage:
 *   node scripts/check-column-parity.js                        # committed snapshot
 *   SUPABASE_DB_URL=postgres://... node scripts/check-column-parity.js --live
 *   SUPABASE_DB_URL=postgres://... node scripts/check-column-parity.js --dump   # refresh snapshot
 *   node scripts/check-column-parity.js --schema schema.json   # {"table":["col",...]}
 *
 * Exit code 0 = no unacknowledged gap, 1 = a new gap, 2 = usage/IO error.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Which write list feeds which table(s). Keep in step with dbEngine's save paths.
const WRITES = {
  _artCols: ['estimate_art_files', 'so_art_files'],
  _itemCols: ['estimate_items', 'so_items'],
  _decoCols: ['estimate_item_decorations', 'so_item_decorations'],
  _jobCols: ['so_jobs'],
  _estCols: ['estimates'],
  _soCols: ['sales_orders'],
  _msgCols: ['messages'],
};

function writtenColumns() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'constants.js'), 'utf8');
  const out = {};
  for (const name of Object.keys(WRITES)) {
    const m = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
    if (!m) {
      console.error(`::error::could not parse ${name} out of src/constants.js`);
      process.exit(2);
    }
    out[name] = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}

const SNAPSHOT = path.join(ROOT, 'supabase', 'schema-columns.json');
const BASELINE = path.join(ROOT, 'supabase', 'column-parity-baseline.json');

function fetchLive() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL is required for --live / --dump.');
    process.exit(2);
  }
  const tables = [...new Set(Object.values(WRITES).flat())].map((t) => `'${t}'`).join(',');
  const sql = `select coalesce(json_object_agg(table_name, cols), '{}') from (
      select table_name, json_agg(column_name order by column_name) cols from information_schema.columns
      where table_schema='public' and table_name in (${tables}) group by table_name) t`;
  return JSON.parse(execFileSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8' }));
}

function schemaColumns() {
  const fileArg = process.argv.indexOf('--schema');
  if (fileArg !== -1) {
    const j = JSON.parse(fs.readFileSync(process.argv[fileArg + 1], 'utf8'));
    return j.tables || j;
  }
  if (process.argv.includes('--live') || process.argv.includes('--dump')) {
    const live = fetchLive();
    if (process.argv.includes('--dump')) {
      const cur = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
      fs.writeFileSync(SNAPSHOT, JSON.stringify({ ...cur, tables: live }, null, 1) + '\n');
      console.log(`snapshot refreshed: ${SNAPSHOT}`);
      process.exit(0);
    }
    return live;
  }
  // Default: the committed snapshot, so the guard runs with no credentials.
  return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).tables;
}

function baselined() {
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    return new Set((b.gaps || []).map((g) => `${g.list}|${g.table}|${g.column}`));
  } catch (_) { return new Set(); }
}

const written = writtenColumns();
const schema = schemaColumns();
const known = baselined();
const gaps = [];

for (const [list, tables] of Object.entries(WRITES)) {
  for (const table of tables) {
    const have = schema[table];
    if (!have) {
      gaps.push({ list, table, missing: ['<table not found>'] });
      continue;
    }
    const set = new Set(have);
    const missing = written[list].filter((c) => !set.has(c));
    const fresh = missing.filter((c) => !known.has(`${list}|${table}|${c}`));
    const ack = missing.filter((c) => known.has(`${list}|${table}|${c}`));
    if (ack.length) console.log(`ℹ️  acknowledged gap (migration pending): ${list} -> ${table}: ${ack.join(', ')}`);
    if (fresh.length) gaps.push({ list, table, missing: fresh });
  }
}

if (!gaps.length) {
  const n = Object.values(written).reduce((a, c) => a + c.length, 0);
  console.log(`✅ column parity OK — ${n} written columns across ${new Set(Object.values(WRITES).flat()).size} tables all exist.`);
  process.exit(0);
}

console.error('❌ Columns written by the client that do NOT exist in the database:\n');
for (const g of gaps) {
  console.error(`  ${g.list} -> ${g.table}`);
  for (const c of g.missing) console.error(`      ${c}`);
  console.error('');
}
console.error('Every write carrying one of these keys is rejected by PostgREST and silently retried');
console.error('with columns removed — the save reports success and the data is dropped.');
console.error('Fix: add a migration for the column, or remove it from the write list if it is session-only.');
console.error('If the gap is known and tracked, add it to supabase/column-parity-baseline.json.');
process.exit(1);
