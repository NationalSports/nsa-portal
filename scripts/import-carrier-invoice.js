#!/usr/bin/env node
/**
 * Carrier invoice import — the missing half of shipping margin.
 *
 * A shipment's recorded shipping_cost is the LABEL-TIME QUOTE. Ship a carton
 * without declaring dimensions and the carrier re-measures it at the hub and
 * rebills the difference weeks later on the invoice. Nothing in this system
 * held those invoices, so the rebills landed nowhere — which is why the audit's
 * margin figure is an upper bound rather than a measurement. Of 301 recorded
 * shipments only 6 carry dimensions, so this is not a rare case.
 *
 * This loads a carrier invoice CSV into ship_carrier_invoices, matching each
 * line back to a sales order by tracking number and carrying the label-time
 * quote alongside what was actually billed. `adjustment` (billed - quoted) is a
 * generated column, so the gap falls out of the join.
 *
 * ── Header mapping ──────────────────────────────────────────────────────────
 * Carrier CSV headers vary by carrier, account, and export template. Columns
 * are matched case/space/punctuation-insensitively against the alias lists in
 * FIELD_ALIASES. When a file does not match, pass explicit overrides rather
 * than editing this file:
 *
 *   --map tracking_number="Tracking Number" --map billed_amount="Net Amount"
 *
 * Run --dry-run first on any new invoice format: it prints the resolved header
 * mapping and a preview, and writes nothing.
 *
 * Usage:
 *   node scripts/import-carrier-invoice.js invoice.csv --dry-run
 *   node scripts/import-carrier-invoice.js invoice.csv --carrier ups
 *   node scripts/import-carrier-invoice.js invoice.csv --invoice-number 000123456
 *
 * Needs SUPABASE_DB_URL (Postgres connection string) unless --dry-run.
 * Re-running the same invoice is safe: rows upsert on
 * (carrier, invoice_number, tracking_number).
 *
 * Exit codes: 0 ok / 1 nothing usable in the file / 2 usage or IO error.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Papa = require('papaparse');

// Compare headers ignoring case, spaces, underscores and punctuation, so
// "Tracking Number", "tracking_number" and "Tracking#" all match.
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELD_ALIASES = {
  tracking_number: ['trackingnumber', 'tracking', 'trackingno', 'leadshipmentnumber', 'packagetrackingnumber', 'airbill', 'expressorgroundtrackingid'],
  invoice_number:  ['invoicenumber', 'invoiceno', 'invoice', 'invoicenbr'],
  invoice_date:    ['invoicedate', 'billingdate', 'invoicedt'],
  billed_amount:   ['netamount', 'netcharge', 'totalcharge', 'amount', 'billedamount', 'netamountusd', 'totalbilledamount'],
  billed_weight_lb:['billedweight', 'billableweight', 'weight', 'ratedweight', 'dimweight'],
  charge_description: ['chargedescription', 'chargeclassification', 'description', 'chargetype', 'trackingiddescription'],
};

// Carriers itemise adjustments in free text. Map the ones that change what we
// would do about them; everything else stays null rather than guessed.
const REASON_RULES = [
  [/\bdim(ensional)?\b|\bdim wt\b|\bdimensional weight\b/i, 'dim_weight'],
  [/address\s*correction/i, 'address_correction'],
  [/residential/i, 'residential'],
  [/additional\s*handling|\boversize\b|large package/i, 'additional_handling'],
  [/fuel\s*surcharge/i, 'fuel'],
  [/delivery\s*area|remote\s*area/i, 'delivery_area'],
];

const fail = (msg) => { console.error(msg); process.exit(2); };

function parseArgs(argv) {
  const out = { map: {}, flags: new Set(), file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') {
      const kv = argv[++i] || '';
      const eq = kv.indexOf('=');
      if (eq < 1) fail('[carrier-invoice] --map needs field=Column');
      out.map[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--carrier') out.carrier = argv[++i];
    else if (a === '--invoice-number') out.invoiceNumber = argv[++i];
    else if (a === '--invoice-date') out.invoiceDate = argv[++i];
    else if (a.startsWith('--')) out.flags.add(a);
    else if (!out.file) out.file = a;
  }
  return out;
}

// Resolve each logical field to an actual header in the file. Explicit --map
// wins; otherwise the first alias that matches a header.
function resolveHeaders(headers, overrides) {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const resolved = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    if (overrides[field]) {
      const want = norm(overrides[field]);
      const hit = byNorm.get(want);
      if (!hit) fail(`[carrier-invoice] --map ${field}: no column named "${overrides[field]}". Headers: ${headers.join(', ')}`);
      resolved[field] = hit;
      continue;
    }
    for (const alias of FIELD_ALIASES[field]) {
      if (byNorm.has(alias)) { resolved[field] = byNorm.get(alias); break; }
    }
  }
  return resolved;
}

const money = (v) => {
  if (v == null) return null;
  // Carrier CSVs use "$1,234.56" and "(4.20)" for credits.
  const s = String(v).trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(neg ? s.slice(1, -1) : s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
};

const num = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Carrier dates are usually MM/DD/YYYY or YYYYMMDD; return ISO or null rather
// than handing Postgres something it will guess at.
function isoDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const reasonOf = (desc) => {
  const s = String(desc == null ? '' : desc);
  for (const [re, reason] of REASON_RULES) if (re.test(s)) return reason;
  return null;
};

// One normalised row per invoice line. A line with no tracking number cannot be
// matched to an order, and a line with no amount says nothing — both are
// counted and reported rather than silently dropped.
function buildRows(records, cols, args) {
  const rows = [];
  const skipped = { no_tracking: 0, no_amount: 0 };
  for (const rec of records) {
    const tracking = String(rec[cols.tracking_number] || '').trim();
    if (!tracking) { skipped.no_tracking++; continue; }
    const billed = money(rec[cols.billed_amount]);
    if (billed == null) { skipped.no_amount++; continue; }
    rows.push({
      carrier: (args.carrier || 'ups').toLowerCase(),
      invoice_number: String(args.invoiceNumber || rec[cols.invoice_number] || '').trim(),
      invoice_date: args.invoiceDate ? isoDate(args.invoiceDate) : isoDate(rec[cols.invoice_date]),
      tracking_number: tracking,
      billed_amount: billed,
      billed_weight_lb: cols.billed_weight_lb ? num(rec[cols.billed_weight_lb]) : null,
      adjustment_reason: cols.charge_description ? reasonOf(rec[cols.charge_description]) : null,
    });
  }
  return { rows, skipped };
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Load through a temp table and COPY FROM STDIN. Invoice text is carrier-
// supplied data and must never be concatenated into a statement; COPY moves it
// as data, so quoting is the transport's problem rather than ours.
function load(url, rows) {
  const header = 'carrier,invoice_number,invoice_date,tracking_number,billed_amount,billed_weight_lb,adjustment_reason';
  const body = rows.map((r) => [
    r.carrier, r.invoice_number, r.invoice_date, r.tracking_number,
    r.billed_amount, r.billed_weight_lb, r.adjustment_reason,
  ].map(csvCell).join(',')).join('\n');

  const script = `
\\set ON_ERROR_STOP on
begin;
create temp table _inv_in (
  carrier text, invoice_number text, invoice_date date, tracking_number text,
  billed_amount numeric, billed_weight_lb numeric, adjustment_reason text
) on commit drop;
\\copy _inv_in from stdin with (format csv, header true)
${header}
${body}
\\.

-- One row per tracking number: a tracking number should belong to one shipment,
-- but distinct on keeps a duplicate from multiplying the invoice line.
create temp table _ship_lookup on commit drop as
select distinct on (tracking) tracking, so_id, quoted from (
  select s.id as so_id,
         nullif(sh->>'tracking_number','') as tracking,
         nullif(sh->>'shipping_cost','')::numeric as quoted
  from sales_orders s, jsonb_array_elements(s._shipments) sh
  where nullif(sh->>'tracking_number','') is not null
) t order by tracking, quoted desc nulls last;

insert into ship_carrier_invoices
  (carrier, invoice_number, invoice_date, tracking_number, so_id,
   quoted_amount, billed_amount, adjustment_reason, billed_weight_lb, source)
select i.carrier, i.invoice_number, i.invoice_date, i.tracking_number,
       l.so_id, l.quoted, i.billed_amount, i.adjustment_reason, i.billed_weight_lb,
       'csv_import'
from _inv_in i left join _ship_lookup l on l.tracking = i.tracking_number
on conflict (carrier, invoice_number, tracking_number) do update set
  invoice_date      = excluded.invoice_date,
  so_id             = excluded.so_id,
  quoted_amount     = excluded.quoted_amount,
  billed_amount     = excluded.billed_amount,
  adjustment_reason = excluded.adjustment_reason,
  billed_weight_lb  = excluded.billed_weight_lb,
  source            = excluded.source;

select 'LOADED ' || count(*) filter (where so_id is not null) || ' matched, '
    || count(*) filter (where so_id is null) || ' unmatched'
from ship_carrier_invoices
where (carrier, invoice_number) in (select distinct carrier, invoice_number from _inv_in);
commit;
`;
  try {
    return execFileSync('psql', [url, '-q', '-At', '-f', '-'], { input: script, encoding: 'utf8' }).trim();
  } catch (e) {
    fail(`[carrier-invoice] load failed: ${e.stderr || e.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.flags.has('--dry-run');
  if (!args.file) fail('[carrier-invoice] usage: import-carrier-invoice.js <invoice.csv> [--dry-run] [--carrier ups] [--map field=Column]');
  if (!fs.existsSync(args.file)) fail(`[carrier-invoice] no such file: ${args.file}`);

  const parsed = Papa.parse(fs.readFileSync(args.file, 'utf8'), { header: true, skipEmptyLines: true });
  const records = parsed.data || [];
  if (!records.length) fail('[carrier-invoice] no rows in file');

  const headers = parsed.meta.fields || [];
  const cols = resolveHeaders(headers, args.map);
  if (!cols.tracking_number || !cols.billed_amount) {
    console.error('[carrier-invoice] could not find the required columns.');
    console.error(`  tracking_number -> ${cols.tracking_number || 'NOT FOUND'}`);
    console.error(`  billed_amount   -> ${cols.billed_amount || 'NOT FOUND'}`);
    console.error(`  headers in file: ${headers.join(', ')}`);
    console.error('  Pass --map tracking_number="..." --map billed_amount="..." to override.');
    process.exit(2);
  }

  const { rows, skipped } = buildRows(records, cols, args);

  console.log('[carrier-invoice] header mapping:');
  for (const f of Object.keys(FIELD_ALIASES)) console.log(`  ${f.padEnd(19)} -> ${cols[f] || '(none)'}`);
  console.log(`[carrier-invoice] ${records.length} line(s) read, ${rows.length} usable`
    + `, ${skipped.no_tracking} without tracking, ${skipped.no_amount} without an amount.`);

  if (!rows.length) { console.error('[carrier-invoice] nothing usable to import.'); process.exit(1); }

  const byReason = rows.reduce((a, r) => { const k = r.adjustment_reason || '(unclassified)'; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('[carrier-invoice] billed total $' + rows.reduce((a, r) => a + r.billed_amount, 0).toFixed(2)
    + ' · reasons: ' + Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(', '));

  if (dryRun) {
    console.log('[carrier-invoice] --dry-run: preview of the first 5 rows, nothing written.');
    console.table(rows.slice(0, 5));
    return;
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.log('::notice::SUPABASE_DB_URL not set — re-run with it, or use --dry-run.');
    process.exit(0);
  }
  console.log('[carrier-invoice] ' + load(url, rows));
}

if (require.main === module) main();

module.exports = { resolveHeaders, buildRows, money, isoDate, reasonOf, FIELD_ALIASES };
