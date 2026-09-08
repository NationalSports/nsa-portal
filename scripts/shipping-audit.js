#!/usr/bin/env node
/**
 * Shipping cost audit — recomputed from live data, not frozen in a document.
 *
 * The original audit (chat session, Aug 31 2026) was a one-time snapshot pasted
 * into a handoff doc. Its numbers started drifting the day it was written: the
 * Adidas single-brand count had already moved 407 -> 413 by Sep 1. This script
 * re-derives every number in that audit from the live database and rewrites the
 * generated blocks of SHIPPING_COST_HANDOFF.md, so the doc describes the data
 * as it is rather than as it was.
 *
 * It also appends a row to ship_audit_snapshots on each run, which is the part
 * that actually answers "does this get better over time": the recording gap
 * (91% of orders have no actual shipping cost) is the headline problem, and a
 * single number can't show whether a backfill is closing it. A history can.
 *
 * ── The date-parsing trap ────────────────────────────────────────────────────
 * sales_orders.created_at is TEXT holding two different formats:
 *   1,222 rows  US locale   "8/9/2026, 8:02:06 AM"
 *       3 rows  ISO         "2026-06-20 10:00:00-07"
 *       1 row   null
 * Comparing that column as a string silently drops rows instead of failing.
 * The original audit reported its window as "Jun 20 - Aug 9 2026" because
 * min()/max() on this column sort lexically: min() saw only the 3 ISO rows, and
 * max() picked "8/9/2026" over "8/31/2026" because '9' > '3'. The true range is
 * Apr 24 - Aug 31 2026. Every date here goes through SO_TS, and unparsed rows
 * are counted and reported rather than dropped quietly.
 *
 * Usage:
 *   node scripts/shipping-audit.js            # rewrite the generated doc blocks
 *   node scripts/shipping-audit.js --check    # exit 1 if the doc is stale (CI)
 *   node scripts/shipping-audit.js --json     # print the raw metrics
 *   node scripts/shipping-audit.js --no-snapshot   # skip the history row
 *   node scripts/shipping-audit.js --from-json m.json   # render a saved payload, no DB
 *
 * Needs SUPABASE_DB_URL (a Postgres connection string; read-only is enough
 * unless you want the snapshot row). Without it the script exits 0 with a
 * notice, matching scripts/check-schema-drift.js.
 *
 * Exit codes: 0 ok / 1 doc stale (--check) / 2 usage or IO error.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'SHIPPING_COST_HANDOFF.md');
const BEGIN = '<!-- BEGIN:SHIPPING-AUDIT -->';
const END = '<!-- END:SHIPPING-AUDIT -->';

// Parse sales_orders.created_at (TEXT, mixed formats) into a real timestamp.
// Anything this returns null for is counted as unparsed and surfaced in the
// report — a row we cannot date is a known unknown, not a zero.
const SO_TS = `case
      when s.created_at is null then null
      when s.created_at ~ '^\\d{4}-\\d{2}-\\d{2}'
        then substring(s.created_at from 1 for 19)::timestamp
      when s.created_at ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
        then to_timestamp(s.created_at, 'FMMM/FMDD/YYYY, FMHH12:MI:SS AM')::timestamp
      else null
    end`;

// Order quantity is the sum of the numeric values in so_items.sizes (size -> qty),
// falling back to est_qty. Mirrors how the app totals a line.
const LINE_QTY = `coalesce(nullif((
      select sum((v.value)::text::numeric) from jsonb_each(i.sizes) v
      where jsonb_typeof(v.value) = 'number'), 0), i.est_qty, 0)`;

// One query, one JSON blob. shipping_value is DOLLARS when shipping_type='flat'
// and a PERCENT when 'pct' — never sum it across types.
// The audit runs against databases at different migration levels: the no_carrier_cost
// column and ship_carrier_invoices arrive in 20260901160000. Probe for them and fold the
// answer into the query rather than keeping a second legacy copy of it in sync.
const FEATURE_SQL = `select
  (to_regclass('public.ship_carrier_invoices') is not null) as has_rebills,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='sales_orders'
           and column_name='no_carrier_cost') as has_ncc,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='ship_audit_snapshots'
           and column_name='margin_true_pct') as has_true_cost,
  (to_regclass('public.si_documents') is not null
   and to_regclass('public.so_item_po_lines') is not null) as has_si_freight,
  (to_regclass('public.ship_cost_basis') is not null) as has_cost_basis,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='ship_cost_basis'
           and column_name='size_buckets') as has_size_buckets;`;

const buildSql = (feat = {}) => `
with item_qty as (
  select i.so_id, i.brand, i.unit_sell, i.nsa_cost, ${LINE_QTY} as qty
  from so_items i
),
so_merch as (
  select so_id,
         sum(qty * coalesce(unit_sell, 0)) as merch_sell,
         sum(qty * coalesce(nsa_cost, 0))  as merch_cost,
         min(brand) filter (where brand is not null and brand <> '') as brand,
         count(distinct brand) filter (where brand is not null and brand <> '') as nbrands
  from item_qty group by so_id
),
si as (
  ${feat.has_si_freight ? `select l.so_id, sum(d.freight_amount) as si_freight, count(*) as si_docs
   from si_documents d
   join (select distinct i.so_id, l.po_id
         from so_item_po_lines l join so_items i on i.id = l.so_item_id
         where nullif(l.po_id,'') is not null) l on l.po_id = d.po_number
   where d.freight_amount is not null group by l.so_id`
   : `select null::text as so_id, null::numeric as si_freight, 0 as si_docs where false`}
),
inv as (
  ${feat.has_rebills ? `select so_id, sum(billed_amount) as billed
   from ship_carrier_invoices where so_id is not null group by so_id`
   : `select null::text as so_id, null::numeric as billed where false`}
),
base as (
  select s.id,
         ${SO_TS} as ts,
         s.created_at as raw_created,
         s.shipping_type,
         coalesce(m.merch_sell, 0) as merch_sell,
         coalesce(m.merch_cost, 0) as merch_cost,
         m.brand, m.nbrands,
         coalesce(s._shipstation_cost, s._shipping_cost) as actual_cost,
         -- A person asserted this order had no carrier cost (local/rep delivery).
         -- That is a resolved order, not a gap: without the flag a 0 is ambiguous.
         ${feat.has_ncc ? 'coalesce(s.no_carrier_cost, false)' : 'false'} as no_carrier_cost,
         coalesce(s._inbound_freight, 0) as inbound,
         -- What the carrier actually charged, falling back to the label-time
         -- quote for orders no invoice has been loaded for yet.
         coalesce(iv.billed, coalesce(s._shipstation_cost, s._shipping_cost)) as true_cost,
         (iv.billed is not null) as invoiced,
         coalesce(sif.si_freight, 0) as si_freight,
         (sif.si_freight is not null) as has_si,
         case when s.shipping_type = 'flat' then coalesce(s.shipping_value, 0)
              when s.shipping_type = 'pct'  then coalesce(s.shipping_value, 0) / 100.0 * coalesce(m.merch_sell, 0)
              else 0 end as charged
  from sales_orders s
  left join so_merch m on m.so_id = s.id
  left join inv iv on iv.so_id = s.id
  left join si sif on sif.so_id = s.id
),
ship_months as (
  select case
      when sh->>'created_at' ~ '^\\d{4}-\\d{2}-\\d{2}' then substring(sh->>'created_at' from 1 for 19)::timestamp
      when sh->>'created_at' ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
        then to_timestamp(sh->>'created_at', 'FMMM/FMDD/YYYY, FMHH12:MI:SS AM')::timestamp
      else null end as ts,
    nullif(sh->>'shipping_cost','')::numeric as cost
  from sales_orders s, jsonb_array_elements(s._shipments) sh
),
scored as (select * from base where actual_cost > 0)
select json_build_object(
  'coverage', (select json_build_object(
      'total_sos',   count(*),
      'with_charge', count(*) filter (where charged > 0),
      'with_cost',   count(*) filter (where actual_cost > 0),
      'no_carrier_cost', count(*) filter (where no_carrier_cost),
      -- coalesce, not a bare NOT: actual_cost is NULL on an unrecorded order,
      -- NULL > 0 is NULL, and a FILTER on NULL drops the row — which would silently
      -- report zero unresolved orders precisely when every order is unresolved.
      'unresolved',  count(*) filter (where charged > 0 and coalesce(actual_cost, 0) <= 0 and not no_carrier_cost),
      'scoreable',   count(*) filter (where charged > 0 and actual_cost > 0),
      'unparsed_dates', count(*) filter (where ts is null),
      'window_start', to_char(min(ts), 'YYYY-MM-DD'),
      'window_end',   to_char(max(ts), 'YYYY-MM-DD')
    ) from base),
  'margin', (select coalesce(json_agg(r order by ord, tp), '[]') from (
      select case when shipping_type is null then 1 else 0 end as ord,
             coalesce(shipping_type, 'TOTAL') as tp,
             json_build_object(
        'shipping_type', coalesce(shipping_type, 'TOTAL'),
        'n', count(*),
        'charged', round(sum(charged), 0),
        'cost',    round(sum(actual_cost), 0),
        'margin_pct', round(100 * (sum(charged) - sum(actual_cost)) / nullif(sum(charged), 0), 1),
        'losers',  count(*) filter (where charged < actual_cost),
        'inbound', round(sum(inbound), 0),
        'cost_true', round(sum(true_cost), 0),
        'margin_true_pct', round(100 * (sum(charged) - sum(true_cost)) / nullif(sum(charged), 0), 1),
        'losers_true', count(*) filter (where charged < true_cost),
        'invoiced', count(*) filter (where invoiced)
      ) as r
      from scored group by rollup(shipping_type)) t),
  'brands', (select coalesce(json_agg(r order by (r->>'avg_inbound')::numeric desc), '[]') from (
      select json_build_object(
        'brand', brand,
        'sos', count(*),
        'avg_inbound', round(avg(inbound), 2),
        'pct_of_merch_cost', round(100 * sum(inbound) / nullif(sum(merch_cost), 0), 1)
      ) as r
      from base where nbrands = 1 group by brand having count(*) >= 5) t),
  'rebills', ${feat.has_rebills ? `(select json_build_object(
      'rows',       count(*),
      'matched_so', count(*) filter (where so_id is not null),
      'quoted',     round(coalesce(sum(quoted_amount), 0), 2),
      'billed',     round(coalesce(sum(billed_amount), 0), 2),
      'adjustment', round(coalesce(sum(adjustment), 0), 2),
      'dim_weight_adj', round(coalesce(sum(adjustment) filter (where adjustment_reason = 'dim_weight'), 0), 2)
    ) from ship_carrier_invoices)` : 'null'},
  -- The measure that actually answers "is capture working": of packages that went
  -- out, how many recorded a cost. Independent of how many orders are still open.
  'ship_cohorts', (select coalesce(json_agg(r order by r->>'month'), '[]') from (
      select json_build_object('month', to_char(date_trunc('month', ts), 'YYYY-MM'),
        'shipments', count(*),
        'with_cost', count(*) filter (where cost > 0),
        'pct', round(100.0 * count(*) filter (where cost > 0) / nullif(count(*), 0), 1)) as r
      from ship_months where ts is not null group by date_trunc('month', ts)) t),
  'si_freight', (select json_build_object(
      'orders', count(*) filter (where has_si),
      'total',  round(sum(si_freight), 0),
      'recorded_inbound', round(sum(inbound), 0)
    ) from base),
  -- Coverage by the month the ORDER was created. Young months look bad because
  -- their orders have not shipped yet, not because capture regressed.
  'order_cohorts', (select coalesce(json_agg(r order by r->>'month'), '[]') from (
      select json_build_object('month', to_char(date_trunc('month', ts), 'YYYY-MM'),
        'charged', count(*) filter (where charged > 0),
        'with_cost', count(*) filter (where charged > 0 and actual_cost > 0),
        'pct', round(100.0 * count(*) filter (where charged > 0 and actual_cost > 0)
                     / nullif(count(*) filter (where charged > 0), 0), 1)) as r
      from base where ts is not null group by date_trunc('month', ts)) t),
  'adidas_bands', (select coalesce(json_agg(r order by r->>'band'), '[]') from (
      select json_build_object(
        'band', band, 'sos', count(*),
        'zero_freight', count(*) filter (where inbound = 0),
        'pct_zero', round(100.0 * count(*) filter (where inbound = 0) / count(*), 0)
      ) as r
      from (select case when merch_sell < 250 then '1. under $250'
                        when merch_sell < 1000 then '2. $250-1k'
                        when merch_sell < 5000 then '3. $1k-5k'
                        else '4. $5k+' end as band, inbound
            from base where nbrands = 1 and brand = 'Adidas') b
      group by band) t)
) as payload;
`;

function fail(msg) { console.error(msg); process.exit(2); }

// Parse the probe's one pipe-separated row. Kept separate and exported because
// the failure mode is silent: a flag added to FEATURE_SQL but not read here
// leaves the feature permanently off, and the only symptom is a column that
// stays empty forever. FEATURE_ORDER is the single list both sides agree on.
const FEATURE_ORDER = ['has_rebills', 'has_ncc', 'has_true_cost', 'has_si_freight', 'has_cost_basis', 'has_size_buckets'];

function parseFeatures(rowText) {
  const cells = String(rowText == null ? '' : rowText).trim().split('|');
  const out = {};
  FEATURE_ORDER.forEach((name, i) => { out[name] = cells[i] === 't'; });
  return out;
}

function query(url) {
  let feat = {};
  try {
    feat = parseFeatures(execFileSync('psql', [url, '-At', '-F', '|', '-c', FEATURE_SQL], { encoding: 'utf8' }));
  } catch (_) { /* pre-migration database: fall through with everything off */ }
  try {
    const metrics = JSON.parse(execFileSync('psql', [url, '-At', '-c', buildSql(feat)], { encoding: 'utf8' }));
    metrics._features = feat;
    return metrics;
  } catch (e) {
    fail(`[shipping-audit] query failed: ${e.stderr || e.message}`);
  }
}

// `dp` decimal places: whole dollars read better in the margin totals, cents
// matter in the per-brand averages where the values are small.
const money = (n, dp = 0) => '$' + Number(n || 0).toLocaleString('en-US',
  { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))
  ? 'n/a' : `${Number(n).toFixed(1)}%`);
// Share of a total, safe when the total is zero (an empty table renders 'n/a'
// rather than 'NaN%').
const share = (part, total) => (total ? pct(100 * part / total) : 'n/a');

// ── Snapshot history ────────────────────────────────────────────────────────
// One row per run. Degrades to a warning if the table is absent so the doc
// refresh still works on a database where the migration has not been applied.
function writeSnapshot(url, m) {
  const total = m.margin.find((r) => r.shipping_type === 'TOTAL');
  const c = m.coverage;
  const t = (m._features || {}).has_true_cost;
  const trueCols = t ? ', cost_true_total, margin_true_pct, invoiced_sos' : '';
  const trueVals = t
    ? `, ${total ? total.cost_true : 0}`
      + `, ${total && total.margin_true_pct !== null ? total.margin_true_pct : 'null'}`
      + `, ${total ? total.invoiced : 0}`
    : '';
  const trueUpd = t
    ? `, cost_true_total = excluded.cost_true_total,
       margin_true_pct = excluded.margin_true_pct,
       invoiced_sos = excluded.invoiced_sos`
    : '';
  const sql = `insert into ship_audit_snapshots
      (captured_on, total_sos, sos_with_charge, sos_with_cost,
       charged_total, cost_total, margin_pct, losing_sos, inbound_freight,
       window_start, window_end, unparsed_dates${trueCols})
    values (current_date, ${c.total_sos}, ${c.with_charge}, ${c.with_cost},
       ${total ? total.charged : 0}, ${total ? total.cost : 0},
       ${total && total.margin_pct !== null ? total.margin_pct : 'null'},
       ${total ? total.losers : 0}, ${total ? total.inbound : 0},
       ${c.window_start ? `'${c.window_start}'` : 'null'},
       ${c.window_end ? `'${c.window_end}'` : 'null'}, ${c.unparsed_dates}${trueVals})
    on conflict (captured_on) do update set
       total_sos = excluded.total_sos, sos_with_charge = excluded.sos_with_charge,
       sos_with_cost = excluded.sos_with_cost, charged_total = excluded.charged_total,
       cost_total = excluded.cost_total, margin_pct = excluded.margin_pct,
       losing_sos = excluded.losing_sos, inbound_freight = excluded.inbound_freight,
       window_start = excluded.window_start, window_end = excluded.window_end,
       unparsed_dates = excluded.unparsed_dates${trueUpd};`;
  try {
    execFileSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn('[shipping-audit] snapshot skipped (is ship_audit_snapshots migrated?): '
      + String(e.stderr || e.message).trim().split('\n')[0]);
    return false;
  }
}

// Recompute the order editor's shipping suggestion basis. Runs with the rest of
// the audit so the constants behind the suggestion move as the data does; the
// editor reads the row rather than carrying numbers in code.
function writeCostBasis(url, coverage, feat = {}) {
  const curveCols = feat.has_size_buckets;
  const sql = `
with item_qty as (
  select i.so_id, i.unit_sell, ${LINE_QTY} as qty from so_items i
),
m as (select so_id, sum(qty) as units, sum(qty * coalesce(unit_sell,0)) as merch from item_qty group by so_id),
scored as (
  select coalesce(m.units,0) as units, coalesce(m.merch,0) as merch,
         coalesce(s._shipstation_cost, s._shipping_cost) as cost
  from sales_orders s join m on m.so_id = s.id
  where coalesce(s._shipstation_cost, s._shipping_cost) > 0 and m.units > 0 and m.merch > 0
)
-- The cost-vs-size curve the editor actually reads. Shipping cost tracks BOX
-- COUNT, not garment count, so a single global $/unit rate overestimates large
-- orders badly; these edges give each size class its own observed median.
-- width_bucket returns 0 for units below the first edge, so bucket 0 is the
-- "< first edge" class and the labels below must stay in step with EDGES.
bucketed as (
  select width_bucket(units, array[10,25,50,100,200]) as b, units, cost from scored
),
curve as (
  select jsonb_agg(x order by x_min) as buckets from (
    select (array[0,10,25,50,100,200])[b+1]                       as x_min,
           (array[9,24,49,99,199,null])[b+1]                      as x_max,
           jsonb_build_object(
             'min_units',   (array[0,10,25,50,100,200])[b+1],
             'max_units',   (array[9,24,49,99,199,null])[b+1],
             'n',           count(*),
             'median_cost', round(percentile_cont(0.50) within group (order by cost)::numeric, 2),
             'p25_cost',    round(percentile_cont(0.25) within group (order by cost)::numeric, 2),
             'p75_cost',    round(percentile_cont(0.75) within group (order by cost)::numeric, 2)
           ) as x
    from bucketed group by b
  ) q(x_min, x_max, x)
)
insert into ship_cost_basis
  (id, sample_n, median_cost_per_unit, median_cost_pct_merch,
   p25_cost_pct_merch, p75_cost_pct_merch, median_cost,${curveCols ? ' size_buckets,' : ''}
   window_start, window_end, updated_at)
select true, count(*),
  round(percentile_cont(0.5) within group (order by cost/units)::numeric, 3),
  round(percentile_cont(0.5) within group (order by 100*cost/merch)::numeric, 2),
  round(percentile_cont(0.25) within group (order by 100*cost/merch)::numeric, 2),
  round(percentile_cont(0.75) within group (order by 100*cost/merch)::numeric, 2),
  round(percentile_cont(0.5) within group (order by cost)::numeric, 2),
  ${curveCols ? '(select buckets from curve),' : ''}
  ${coverage.window_start ? `'${coverage.window_start}'` : 'null'},
  ${coverage.window_end ? `'${coverage.window_end}'` : 'null'}, now()
from scored
on conflict (id) do update set
  sample_n = excluded.sample_n,
  median_cost_per_unit = excluded.median_cost_per_unit,${curveCols ? '\n  size_buckets = excluded.size_buckets,' : ''}
  median_cost_pct_merch = excluded.median_cost_pct_merch,
  p25_cost_pct_merch = excluded.p25_cost_pct_merch,
  p75_cost_pct_merch = excluded.p75_cost_pct_merch,
  median_cost = excluded.median_cost,
  window_start = excluded.window_start, window_end = excluded.window_end,
  updated_at = now();`;
  try {
    execFileSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn('[shipping-audit] cost basis skipped (is ship_cost_basis migrated?): '
      + String(e.stderr || e.message).trim().split('\n')[0]);
    return false;
  }
}

function readTrend(url, feat = {}) {
  const trueCols = feat.has_true_cost
    ? `, 'margin_true_pct', margin_true_pct, 'invoiced_sos', invoiced_sos` : '';
  const sql = `select coalesce(json_agg(json_build_object(
      'captured_on', to_char(captured_on, 'YYYY-MM-DD'),
      'total_sos', total_sos, 'sos_with_cost', sos_with_cost,
      'margin_pct', margin_pct, 'losing_sos', losing_sos${trueCols}) order by captured_on), '[]')
    from (select * from ship_audit_snapshots order by captured_on desc limit 12) t;`;
  try {
    return JSON.parse(execFileSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8', stdio: 'pipe' }));
  } catch (_) { return []; }
}

// ── Rendering ───────────────────────────────────────────────────────────────
function render(m, trend) {
  const c = m.coverage;
  const gap = c.total_sos ? (100 * (c.total_sos - c.with_cost) / c.total_sos) : 0;
  const total = m.margin.find((r) => r.shipping_type === 'TOTAL');
  const L = [];

  L.push('### Coverage — how much of the problem we can even see');
  L.push('');
  L.push(`Data window **${c.window_start} to ${c.window_end}** (dates parsed from`);
  L.push('`created_at`, which is TEXT in two different formats — see the note below).');
  L.push('');
  L.push('| | Orders | Share |');
  L.push('|---|---:|---:|');
  L.push(`| Sales orders in range | ${num(c.total_sos)} | 100% |`);
  L.push(`| Carrying a shipping charge | ${num(c.with_charge)} | ${share(c.with_charge, c.total_sos)} |`);
  L.push(`| With a recorded actual cost | ${num(c.with_cost)} | ${share(c.with_cost, c.total_sos)} |`);
  L.push(`| **Scoreable (charge and cost)** | **${num(c.scoreable)}** | **${share(c.scoreable, c.total_sos)}** |`);
  if (c.no_carrier_cost !== undefined && c.no_carrier_cost !== null) {
    L.push(`| Asserted "no carrier cost" | ${num(c.no_carrier_cost)} | ${share(c.no_carrier_cost, c.total_sos)} |`);
  }
  L.push('');
  const unresolved = (c.unresolved === undefined || c.unresolved === null)
    ? c.with_charge - c.scoreable : c.unresolved;
  L.push(`**${num(unresolved)} charged ${unresolved === 1 ? 'order is' : 'orders are'} still unresolved** — no`);
  L.push('recorded cost, and nobody has said they were delivered on our own truck. That is the');
  L.push('real gap; it is the number to watch in the trend table below.');
  if (c.no_carrier_cost) {
    L.push('');
    L.push(`${num(c.no_carrier_cost)} ${c.no_carrier_cost === 1 ? 'order is' : 'orders are'} resolved the other way: a person marked`);
    L.push('them as having no carrier cost. Those are answered, not missing — which is the whole');
    L.push('point of the flag, since `_shipping_cost = 0` cannot tell the two apart on its own.');
  }
  if (c.unparsed_dates > 0) {
    L.push('');
    L.push(`> ⚠️ ${c.unparsed_dates} order(s) have a \`created_at\` this script cannot parse and`);
    L.push('> are excluded from the window bounds. They are still counted in every total.');
  }
  L.push('');

  L.push('### Margin on the orders we can score');
  L.push('');
  L.push('| | Orders | Charged | Actual cost | Margin | Lost money |');
  L.push('|---|---:|---:|---:|---:|---:|');
  const label = { flat: 'Flat-rate', pct: 'Percentage', TOTAL: '**Total**' };
  for (const r of m.margin) {
    const bold = r.shipping_type === 'TOTAL';
    const w = (s) => (bold ? `**${s}**` : s);
    L.push(`| ${label[r.shipping_type] || r.shipping_type} | ${w(num(r.n))} | ${w(money(r.charged))} `
      + `| ${w(money(r.cost))} | ${w(pct(r.margin_pct))} | ${w(r.losers)} |`);
  }
  L.push('');
  if (total && total.n) {
    L.push(`Margin averages ${pct(total.margin_pct)}, but **${num(total.losers)} of ${num(total.n)} orders lost money**`);
    L.push('on shipping. The average hides a coin flip — this is a variance problem, not a');
    L.push('pricing-level problem, which is what a per-order estimate is good at fixing.');
    L.push('');
    if (total.invoiced > 0) {
      L.push('');
      L.push(`**Corrected for carrier invoices: ${money(total.cost_true)} actual cost, `
        + `${pct(total.margin_true_pct)} margin, ${num(total.losers_true)} orders losing money.** `
        + `That covers ${num(total.invoiced)} of ${num(total.n)} scored orders —`);
      L.push('the rest still use the label-time quote. The two converge as more invoices are');
      L.push('loaded, and the gap between them is what the quote was hiding.');
    } else {
      L.push('');
      L.push('This margin is computed on the label-time quote, so it is an upper bound. No');
      L.push('carrier invoice has been loaded yet — see the rebill section below.');
    }
    L.push('');
    L.push(`**Inbound freight on these same orders is ${money(total.inbound)}, against ${money(total.cost)}`);
    L.push('outbound.** Whether inbound belongs in product margin or shipping margin is an');
    L.push('accounting call for Steve and Andrea, not a code decision — do not silently roll');
    L.push('it into the shipping margin number.');
  }
  L.push('');

  L.push('### Inbound freight by brand (single-brand orders, n ≥ 5)');
  L.push('');
  L.push('| Brand | Orders | Avg inbound freight | % of merch cost |');
  L.push('|---|---:|---:|---:|');
  for (const b of m.brands) {
    L.push(`| ${b.brand} | ${num(b.sos)} | ${money(b.avg_inbound, 2)} | ${pct(b.pct_of_merch_cost)} |`);
  }
  L.push('');

  L.push('### Is there an Adidas free-freight threshold? (no)');
  L.push('');
  L.push('| Order value | Orders | Zero freight | Share |');
  L.push('|---|---:|---:|---:|');
  for (const b of m.adidas_bands) {
    L.push(`| ${b.band.replace(/^\d+\. /, '')} | ${num(b.sos)} | ${num(b.zero_freight)} | ${b.pct_zero}% |`);
  }
  L.push('');
  L.push('Zero-freight share is flat across every order-size band. If Adidas waived freight');
  L.push('above some order value, the top band would stand out; it does not. Steve’s read is');
  L.push('that these are **unrecorded, not free**, consistent with the recording gap above.');
  L.push('Treat `_inbound_freight = 0` as unknown, not as zero.');
  L.push('');

  if (m.rebills && m.rebills.rows > 0) {
    const r = m.rebills;
    L.push('### Carrier rebills — quoted versus actually billed');
    L.push('');
    L.push('| | |');
    L.push('|---|---:|');
    L.push(`| Invoice lines captured | ${num(r.rows)} |`);
    L.push(`| Matched to a sales order | ${num(r.matched_so)} |`);
    L.push(`| Quoted at label time | ${money(r.quoted, 2)} |`);
    L.push(`| Actually billed | ${money(r.billed, 2)} |`);
    L.push(`| **Adjustment** | **${money(r.adjustment, 2)}** |`);
    L.push(`| …of which dim weight | ${money(r.dim_weight_adj, 2)} |`);
    L.push('');
    L.push('A positive adjustment is money the label-time cost never showed. Until these are');
    L.push('captured, every margin figure above is an upper bound rather than a measurement.');
    L.push('');
  } else if (m.rebills !== undefined) {
    L.push('### Carrier rebills — quoted versus actually billed');
    L.push('');
    L.push('_No carrier invoice lines captured yet. Recorded shipping cost is the label-time_');
    L.push('_quote; undeclared cartons get re-measured at the hub and rebilled weeks later._');
    L.push('_Until `ship_carrier_invoices` has rows, the margin above is an upper bound._');
    L.push('');
  }
  if (m.ship_cohorts && m.ship_cohorts.length) {
    L.push('### Is capture actually working? (by month shipped)');
    L.push('');
    L.push('| Month shipped | Packages | Cost recorded | Capture |');
    L.push('|---|---:|---:|---:|');
    for (const c of m.ship_cohorts) {
      L.push(`| ${c.month} | ${num(c.shipments)} | ${num(c.with_cost)} | ${pct(c.pct)} |`);
    }
    L.push('');
    L.push('**This is the number that says whether the process works.** When a package');
    L.push('goes out through ShipStation its cost is recorded; this column shows how');
    L.push('reliably. It is independent of how many orders are still open.');
    L.push('');
  }
  if (m.order_cohorts && m.order_cohorts.length) {
    L.push('### Coverage by month the order was created');
    L.push('');
    L.push('| Month ordered | Charged | With cost | Coverage |');
    L.push('|---|---:|---:|---:|');
    for (const c of m.order_cohorts) {
      L.push(`| ${c.month} | ${num(c.charged)} | ${num(c.with_cost)} | ${pct(c.pct)} |`);
    }
    L.push('');
    L.push('**Read this one with the lag in mind.** A recent month looks poor because most');
    L.push('of its orders have not shipped yet, not because capture got worse — their cost');
    L.push('lands weeks later when the package goes out. Compare against the shipped-month');
    L.push('table above before concluding anything went backwards. The headline coverage');
    L.push('figure at the top of this document averages over the whole window, so it is');
    L.push('dominated by the older orders and understates where the process is now.');
    L.push('');
  }
  if (m.si_freight && m.si_freight.orders > 0) {
    L.push('### Inbound freight from Sports Inc bills');
    L.push('');
    L.push('| | |');
    L.push('|---|---:|');
    L.push(`| Orders reached by a Sports Inc bill | ${num(m.si_freight.orders)} |`);
    L.push(`| Freight on those bills | ${money(m.si_freight.total)} |`);
    L.push(`| Freight in \`_inbound_freight\` across all orders | ${money(m.si_freight.recorded_inbound)} |`);
    L.push('');
    L.push('Sports Inc documents are ingested continuously and carry freight per bill,');
    L.push('linked to orders through the PO lines. This figure grows on its own as bills');
    L.push('arrive — no one has to type it. Whether inbound freight belongs in product');
    L.push('margin or shipping margin is still the accounting call for Steve and Andrea,');
    L.push('so it is reported here rather than folded into the margin above.');
    L.push('');
  }
  L.push('### Trend — is the gap closing?');
  L.push('');
  if (!trend || trend.length === 0) {
    L.push('_No snapshots recorded yet. Each run of `scripts/shipping-audit.js` appends one_');
    L.push('_row to `ship_audit_snapshots`; this table fills in as those accumulate._');
  } else {
    L.push('| Captured | Orders | With actual cost | Coverage | Margin (quoted) | Margin (invoiced) | Invoiced | Lost money |');
    L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const t of trend) {
      const cov = share(t.sos_with_cost, t.total_sos);
      const mt = (t.margin_true_pct === null || t.margin_true_pct === undefined) ? '—' : pct(t.margin_true_pct);
      L.push(`| ${t.captured_on} | ${num(t.total_sos)} | ${num(t.sos_with_cost)} | ${cov} `
        + `| ${t.margin_pct === null ? 'n/a' : pct(t.margin_pct)} | ${mt} `
        + `| ${num(t.invoiced_sos || 0)} | ${num(t.losing_sos)} |`);
    }
    L.push('');
    L.push(`Coverage is the column that matters. Margin computed over a `
      + `${share(c.with_cost, c.total_sos)} sample is not a business fact yet;`);
    L.push('it becomes one as coverage climbs.');
  }
  return L.join('\n');
}

// ── Doc rewrite ─────────────────────────────────────────────────────────────
// The timestamp line is excluded when comparing so --check reports real data
// drift rather than "the clock moved".
const stamp = (body, when) => `${BEGIN}\n<!-- Generated by scripts/shipping-audit.js — do not edit by hand. -->\n\n`
  + `${body}\n\n_Last refreshed from live data: ${when}_\n${END}`;

function splice(doc, block) {
  const i = doc.indexOf(BEGIN);
  const j = doc.indexOf(END);
  if (i === -1 || j === -1 || j < i) fail(`[shipping-audit] ${DOC} is missing the ${BEGIN} / ${END} markers.`);
  return doc.slice(0, i) + block + doc.slice(j + END.length);
}

const withoutStamp = (s) => s.replace(/^_Last refreshed from live data: .*_$/m, '');

function main() {
  const argv = process.argv.slice(2);

  // --from-json renders a payload captured earlier (the shape --json emits).
  // Lets the renderer be exercised without a database, and lets the doc be
  // rebuilt from a saved capture when only an MCP/SQL console is available.
  const fromJson = argv.indexOf('--from-json');
  if (fromJson !== -1) {
    const file = argv[fromJson + 1];
    if (!file) fail('[shipping-audit] --from-json needs a file path.');
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const metrics = payload.coverage ? payload : payload.metrics;
    const block = stamp(render(metrics, payload.trend || []), new Date().toISOString().slice(0, 10));
    fs.writeFileSync(DOC, splice(fs.readFileSync(DOC, 'utf8'), block));
    console.log(`[shipping-audit] rebuilt ${path.basename(DOC)} from ${file}.`);
    return;
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.log('::notice::SUPABASE_DB_URL not set — skipping the shipping audit refresh.');
    process.exit(0);
  }

  const metrics = query(url);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  // --check is read-only: it must not write a snapshot row.
  if (!argv.includes('--no-snapshot') && !argv.includes('--check')) {
    writeSnapshot(url, metrics);
    if ((metrics._features || {}).has_cost_basis) writeCostBasis(url, metrics.coverage, metrics._features);
  }

  const block = stamp(render(metrics, readTrend(url, metrics._features)), new Date().toISOString().slice(0, 10));
  const doc = fs.readFileSync(DOC, 'utf8');
  const next = splice(doc, block);

  if (argv.includes('--check')) {
    if (withoutStamp(next) !== withoutStamp(doc)) {
      console.error('[shipping-audit] SHIPPING_COST_HANDOFF.md is out of date. '
        + 'Run: node scripts/shipping-audit.js');
      process.exit(1);
    }
    console.log('[shipping-audit] doc is current.');
    return;
  }

  if (next === doc) { console.log('[shipping-audit] no change.'); return; }
  fs.writeFileSync(DOC, next);
  const c = metrics.coverage;
  console.log(`[shipping-audit] refreshed ${path.basename(DOC)} — ${c.total_sos} orders, `
    + `${c.with_cost} with actual cost (${(100 * c.with_cost / c.total_sos).toFixed(1)}% coverage), `
    + `window ${c.window_start}..${c.window_end}.`);
}

if (require.main === module) main();

// Exported so the query and the renderer can be exercised without running the
// CLI (see scripts/pgtest/README.md for the local-Postgres harness).
module.exports = { buildSql, FEATURE_SQL, FEATURE_ORDER, parseFeatures, render, splice, stamp };
