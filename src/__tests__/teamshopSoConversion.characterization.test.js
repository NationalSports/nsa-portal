/* Stage 7 — create_teamshop_sales_order (migration 00192) characterization.
 *
 * The RPC writes sales_orders / so_items / so_item_decorations / so_jobs /
 * job_stage_events rows that MUST load cleanly through the staff portal's save
 * engine (dbEngine.js) and match what the reference client path writes
 * (Webstores.js batchOrders → App.js webstoreCreateSO → dbEngine _dbSaveSOInner).
 *
 * This is a STATIC test: it parses the migration SQL's INSERT column lists and
 * pins them against fixtures derived from that client path — the column
 * allowlists in src/constants.js (_soCols/_itemCols/_decoCols/_jobCols are
 * exactly what _dbSaveSOInner persists) plus the specific fields batchOrders
 * sets. If the migration drifts (a renamed column, a new field the client
 * can't round-trip), this fails before the branch DB ever does.
 *
 * HONESTY CONTRACT: fields the RPC deliberately does NOT write (because their
 * value could not be traced with confidence from the client path) are listed in
 * DELIBERATELY_OMITTED below and asserted absent — adding one requires
 * consciously updating both the SQL and this fixture.
 */
const fs = require('fs');
const path = require('path');
const { _soCols, _itemCols, _decoCols, _jobCols } = require('../constants');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/00192_create_teamshop_sales_order.sql'),
  'utf8'
);

// Extract the column list of `insert into <table> (col, col, ...)`.
// Column lists in this migration contain no nested parens, so a lazy match to
// the first `)` is exact.
function insertColumns(table) {
  const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\(([^)]+)\\)`, 'i');
  const m = SQL.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// Split a SQL expression list on top-level commas (values lists here contain
// case/function calls with nested parens and quoted strings).
function splitTopLevel(s) {
  const out = [];
  let depth = 0; let cur = ''; let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { cur += ch; if (ch === "'" && s[i + 1] !== "'") inStr = false; else if (ch === "'" && s[i + 1] === "'") { cur += s[++i]; } continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Extract the VALUES expression list for `insert into <table> (...) values (...)`.
function insertValues(table) {
  const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\([^)]+\\)\\s*values\\s*\\(`, 'i');
  const m = SQL.match(re);
  if (!m) return null;
  let i = m.index + m[0].length; let depth = 1; let body = '';
  while (i < SQL.length && depth > 0) {
    const ch = SQL[i];
    if (ch === '(') depth++;
    if (ch === ')') { depth--; if (depth === 0) break; }
    body += ch; i++;
  }
  return splitTopLevel(body);
}

describe('00192 migration structure', () => {
  test('adds the additive nullable so_jobs.digitizing_needed column', () => {
    expect(SQL).toMatch(/alter table public\.so_jobs add column if not exists digitizing_needed boolean;/);
    // additive + nullable: no NOT NULL, no DEFAULT rewrite
    expect(SQL).not.toMatch(/digitizing_needed boolean\s+(not null|default)/i);
  });

  test('RPC is SECURITY DEFINER, service_role-only, with rollback notes', () => {
    expect(SQL).toMatch(/create or replace function public\.create_teamshop_sales_order\(\s*p_webstore_order_id uuid\s*\)/);
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/set search_path = public/);
    expect(SQL).toMatch(/revoke all on function public\.create_teamshop_sales_order\(uuid\) from public;/);
    expect(SQL).toMatch(/revoke all on function public\.create_teamshop_sales_order\(uuid\) from anon;/);
    expect(SQL).toMatch(/revoke all on function public\.create_teamshop_sales_order\(uuid\) from authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.create_teamshop_sales_order\(uuid\) to service_role;/);
    expect(SQL).toMatch(/── Rollback/);
    expect(SQL).toMatch(/drop function if exists public\.create_teamshop_sales_order\(uuid\);/);
  });

  test('idempotency + guards: row lock, so_id replay, teamshop + paid gates, NSA_* codes', () => {
    expect(SQL).toMatch(/from webstore_orders where id = p_webstore_order_id for update/);
    expect(SQL).toMatch(/if v_ord\.so_id is not null then/);
    expect(SQL).toMatch(/'so_id', v_ord\.so_id, 'replayed', true/);
    expect(SQL).toMatch(/NSA_NOT_FOUND/);
    expect(SQL).toMatch(/<> 'teamshop'[\s\S]{0,80}NSA_BAD_SOURCE/);
    // 'paid' is the exact status webstore-checkout finalize / stripe-webhook write
    expect(SQL).toMatch(/<> 'paid'[\s\S]{0,80}NSA_NOT_PAID/);
    expect(SQL).toMatch(/NSA_BAD_INPUT/);
  });

  test('SO id mint matches the client rule (App.js nextSOId) under an advisory lock', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtext\('nsa_sales_orders_id_mint'\)\)/);
    // numeric extraction of existing ids: first digit run, /(\d+)/ — same as _maxNum/_syncDbMaxIds
    expect(SQL).toMatch(/regexp_match\(id, '\(\\d\+\)'\)\)\[1\]::bigint/);
    // floor 1000 then +1: Math.max(_maxNum(sos), _dbMaxIds.so, 1000) + 1
    expect(SQL).toMatch(/greatest\(coalesce\(max\(\(regexp_match\(id, '\(\\d\+\)'\)\)\[1\]::bigint\), 0\), 1000\) \+ 1/);
    expect(SQL).toMatch(/v_so_id := 'SO-' \|\| v_num;/);
  });

  test('links the order back exactly like batchOrders (so_id + status batched)', () => {
    expect(SQL).toMatch(/update webstore_orders\s*set so_id = v_so_id, status = 'batched'\s*where id = v_ord\.id/);
  });
});

describe('00192 column sets vs the client save engine', () => {
  // ── sales_orders ── fixture derived from App.js webstoreCreateSO's newSO
  // (minus client-only members: items/jobs/art_files/firm_dates are child
  // tables; created_by is the signed-in staff user — none exists server-side;
  // batch label/cutoff/default_markup are not set on this path either).
  const SALES_ORDERS_EXPECTED = [
    'id', 'customer_id', 'memo', 'status', 'created_at', 'updated_at',
    'expected_date', 'production_notes', 'shipping_type', 'shipping_value',
    'ship_to_id', 'tax_rate', 'tax_exempt', '_webstore_fundraise', 'source', 'webstore_id',
  ];
  // Deliberately omitted — traceable-value rule (see the migration header):
  //   created_by      — client writes cu.id (the staff session); no server analog.
  //   default_markup  — webstoreCreateSO never sets it; DB default applies.
  //   webstore_batch_no — owned by the 00177 trigger, never written by any client.
  //   _version / updated-at trigger bookkeeping — owned by 00049's trigger (DEFAULT 1 on insert).
  const SALES_ORDERS_OMITTED = ['created_by', 'default_markup', 'webstore_batch_no', '_version', 'deco_pos', 'estimate_id'];

  test('sales_orders insert = webstoreCreateSO field set, all within _soCols (dbEngine round-trip)', () => {
    const cols = insertColumns('sales_orders');
    expect(cols).toEqual(SALES_ORDERS_EXPECTED);
    cols.forEach((c) => expect(_soCols).toContain(c));
    SALES_ORDERS_OMITTED.forEach((c) => expect(cols).not.toContain(c));
  });

  // ── so_items ── fixture from batchOrders' soItems objects
  // ({sku,name,brand,color,product_id,nsa_cost,retail_price,unit_sell,sizes,
  //   available_sizes,no_deco}) + the so_id/item_index bookkeeping
  // _dbSaveSOInner injects. pick_lines/po_lines/decorations are child tables.
  const SO_ITEMS_EXPECTED = [
    'so_id', 'item_index', 'product_id', 'sku', 'name', 'brand', 'color',
    'nsa_cost', 'retail_price', 'unit_sell', 'sizes', 'available_sizes', 'no_deco',
  ];
  // Deliberately omitted: vendor_id/_colors/is_custom/custom_* etc. — batchOrders
  // never sets them on webstore→SO lines; DB defaults are the loaded truth.
  const SO_ITEMS_OMITTED = ['vendor_id', '_colors', 'is_custom', 'custom_desc', 'custom_cost', 'custom_sell', 'est_qty', 'qty_only'];

  test('so_items insert = batchOrders item shape, non-bookkeeping columns within _itemCols', () => {
    const cols = insertColumns('so_items');
    expect(cols).toEqual(SO_ITEMS_EXPECTED);
    cols.filter((c) => c !== 'so_id' && c !== 'item_index')
      .forEach((c) => expect(_itemCols).toContain(c));
    SO_ITEMS_OMITTED.forEach((c) => expect(cols).not.toContain(c));
  });

  test("so_items sizes map is batchOrders' {size: qty} jsonb (merged per size), available_sizes its keys", () => {
    // sizes: jsonb_object_agg(size, qty) with 'OS' fallback — the g.sizes[sz]+=q shape
    expect(SQL).toMatch(/jsonb_object_agg\(s\.sz, s\.q\)/);
    expect(SQL).toMatch(/coalesce\(nullif\(i2\.size, ''\), 'OS'\)/);
    expect(SQL).toMatch(/sum\(coalesce\(i2\.qty, 1\)\)::int/);
    // available_sizes = Object.keys(sizes)
    expect(SQL).toMatch(/jsonb_object_keys\(coalesce\(v_grp\.sizes, '\{\}'::jsonb\)\)/);
  });

  test('unit_sell = collected revenue ÷ units (garment + deco sell), mirroring batchOrders reconciliation', () => {
    expect(SQL).toMatch(/coalesce\(i\.unit_price, 0\) \+ coalesce\(i\.unit_deco_price, 0\)/);
    expect(SQL).toMatch(/round\(v_grp\.collected \/ greatest\(v_grp\.units, 1\), 2\)/);
  });

  // ── so_item_decorations ── batchOrders' art-deco mapping (kind 'art',
  // position via POS_LABEL, suppressed sells, 00169 web_url/placement/side/
  // color_label) + the dP pricing fields the decoSpec carries
  // (colors/underbase/stitches/dtf_size — no art file exists to hold them).
  const SO_DECO_EXPECTED = [
    'so_item_id', 'deco_index', 'kind', 'position', 'type',
    'colors', 'underbase', 'stitches', 'dtf_size',
    'sell_override', 'sell_each', 'cost_each',
    'web_url', 'placement', 'side', 'color_label',
  ];
  // Deliberately omitted:
  //   art_file_id — NO so_art_files row is created by the RPC (staff attach real
  //     art via the art pipeline; null art_file_id = 'Unassigned Art' in
  //     buildJobs/syncJobs). It is therefore not in the insert list at all.
  //   color_way_id/transfer_code/roster/names — storefront/OMG concepts with no
  //     teamshop source data.
  const SO_DECO_OMITTED = ['art_file_id', 'color_way_id', 'transfer_code', 'roster', 'names', 'art_tbd_type'];

  test('so_item_decorations insert = batchOrders deco mapping + dP fields, within _decoCols', () => {
    const cols = insertColumns('so_item_decorations');
    expect(cols).toEqual(SO_DECO_EXPECTED);
    cols.filter((c) => c !== 'so_item_id' && c !== 'deco_index')
      .forEach((c) => expect(_decoCols).toContain(c));
    SO_DECO_OMITTED.forEach((c) => expect(cols).not.toContain(c));
  });

  test("deco position uses batchOrders' exact POS_LABEL placement table with the side fallback", () => {
    expect(SQL).toMatch(/when 'left_chest'\s+then 'Left Chest'/);
    expect(SQL).toMatch(/when 'full_front'\s+then 'Front'/);
    expect(SQL).toMatch(/when 'full_back'\s+then 'Back'/);
    expect(SQL).toMatch(/when 'left_sleeve'\s+then 'Left Sleeve'/);
    expect(SQL).toMatch(/when 'right_sleeve'\s+then 'Right Sleeve'/);
    expect(SQL).toMatch(/when v_deco->>'side' = 'back' then 'Back' else 'Front'/);
  });

  test('deco sells are suppressed (0,0,0) — revenue rides on unit_sell, batchOrders style', () => {
    const vals = insertValues('so_item_decorations');
    const cols = insertColumns('so_item_decorations');
    ['sell_override', 'sell_each', 'cost_each'].forEach((c) => {
      expect(vals[cols.indexOf(c)]).toBe('0');
    });
  });

  // ── so_jobs ── syncJobs/buildJobs persisted field set + so_id +
  // the new digitizing_needed.
  const SO_JOBS_EXPECTED = [
    'so_id', 'id', 'key', 'art_file_id', '_art_ids', 'art_name', 'deco_type', 'positions',
    'art_status', 'item_status', 'prod_status', 'total_units', 'fulfilled_units',
    'split_from', 'created_at', 'ship_method', 'items', '_auto', 'digitizing_needed',
  ];
  // Deliberately omitted: workflow fields syncJobs only carries forward from an
  // existing job (assigned_machine/assigned_to/run_order/rejections/…) — a
  // brand-new job has none; DB defaults/NULLs are the loaded truth.
  const SO_JOBS_OMITTED = ['assigned_machine', 'assigned_to', 'split_group', 'rejections', 'run_order', 'coach_rejected'];

  test('so_jobs insert = syncJobs field set (+digitizing_needed), within _jobCols', () => {
    const cols = insertColumns('so_jobs');
    expect(cols).toEqual(SO_JOBS_EXPECTED);
    cols.filter((c) => c !== 'so_id' && c !== 'digitizing_needed')
      .forEach((c) => expect(_jobCols).toContain(c));
    SO_JOBS_OMITTED.forEach((c) => expect(cols).not.toContain(c));
  });

  test('jobs are born on hold with the art-pipeline entry state (needs_art / need_to_order), _auto, null art', () => {
    const cols = insertColumns('so_jobs');
    const vals = insertValues('so_jobs');
    const at = (c) => vals[cols.indexOf(c)];
    expect(at('prod_status')).toBe("'hold'");
    expect(at('art_status')).toBe("'needs_art'");
    expect(at('item_status')).toBe("'need_to_order'");
    expect(at('art_file_id')).toBe('null'); // no so_art_files row exists
    expect(at('_art_ids')).toBe("'[]'::jsonb");
    expect(at('fulfilled_units')).toBe('0');
    expect(at('split_from')).toBe('null');
    expect(at('ship_method')).toBe("'ship_customer'"); // syncJobs' non-rep-delivery default
    expect(at('_auto')).toBe('true');
  });

  test('job id + key match the client formats (JOB-<n>-NN; syncJobs signature)', () => {
    expect(SQL).toMatch(/'JOB-' \|\| v_num \|\| '-' \|\| lpad\(v_jn::text, 2, '0'\)/);
    // syncJobs sig for a null-art deco: dt + '::' + sorted 'unassigned@<pos>' parts
    expect(SQL).toMatch(/'unassigned@' \|\| d\.position/);
    expect(SQL).toMatch(/v_job\.deco_type \|\| '::' \|\| v_job\.key_parts/);
  });

  test('one job per distinct (logo ref × deco method); digitizing_needed = teamshop logo × embroidery', () => {
    expect(SQL).toMatch(/group by d\.deco_type, d\.logo_ref/);
    // logo ref normalization matches the v2 quote hash ('teamshop:<id>' | 'art:<id>')
    expect(SQL).toMatch(/'teamshop:' \|\| \(v_deco->>'teamshop_logo_id'\)/);
    expect(SQL).toMatch(/'art:'\s+\|\| \(v_deco->>'art_file_id'\)/);
    expect(SQL).toMatch(/coalesce\(v_deco->>'logo_source', ''\) = 'teamshop'\s*and v_deco->>'type' = 'embroidery'/);
  });

  test("job items carry buildJobs' per-item entry shape", () => {
    ['item_idx', 'deco_idx', 'deco_idxs', 'sku', 'name', 'color', 'units', 'fulfilled'].forEach((k) => {
      expect(SQL).toMatch(new RegExp(`'${k}',`));
    });
  });

  // ── job_stage_events ── the 00188 log, same transaction, source 'teamshop'.
  test("job_stage_events insert matches 00188's column list, event 'created', source 'teamshop'", () => {
    const cols = insertColumns('job_stage_events');
    expect(cols).toEqual(['so_id', 'job_id', 'event', 'from_state', 'to_state', 'actor', 'source', 'payload']);
    const vals = insertValues('job_stage_events');
    expect(vals[cols.indexOf('event')]).toBe("'created'");
    expect(vals[cols.indexOf('source')]).toBe("'teamshop'");
  });

  // ── dbEngine bookkeeping ── _version is trigger-owned (00049): the RPC must
  // NEVER write it; created_at/updated_at are the client's TEXT locale shapes.
  test('_version is left to the DB trigger; created_at/updated_at use the client TEXT formats', () => {
    ['sales_orders', 'so_items', 'so_item_decorations', 'so_jobs', 'job_stage_events'].forEach((t) => {
      expect(insertColumns(t)).not.toContain('_version');
    });
    // toLocaleString() shape for the SO row
    expect(SQL).toMatch(/to_char\(now\(\), 'FMMM\/FMDD\/YYYY, FMHH12:MI:SS AM'\)/);
    // toLocaleDateString() shape for jobs (syncJobs writes date-only)
    expect(SQL).toMatch(/to_char\(now\(\), 'FMMM\/FMDD\/YYYY'\)/);
  });
});
