/* create_club_sales_order (migration 00204) characterization.
 *
 * Follows teamshopSoConversion.characterization.test.js's approach: a STATIC test
 * that parses the migration SQL's INSERT column lists and pins them against the
 * client save engine's allowlists (_soCols/_itemCols/_decoCols/_jobCols in
 * src/constants.js — exactly what _dbSaveSOInner persists), plus the specific
 * fields batchOrders sets (Webstores.js batchOrders / App.js webstoreCreateSO) —
 * the reference client path this RPC is modeled on. Unlike 00199 (one
 * so_item_decorations INSERT per deco), 00204 writes so_item_decorations from FOUR
 * distinct sources (store-catalog logo placements, transfer-code designs, numbers,
 * names) since club/storefront order items carry no per-item decoration array the
 * way Team Shop's quickorder-quote-priced items do — so the column-list helpers
 * below support multiple same-table INSERTs, in source order.
 */
const fs = require('fs');
const path = require('path');
const { _soCols, _itemCols, _decoCols, _jobCols } = require('../constants');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/00204_club_store_conversion.sql'),
  'utf8'
);
// 00207 CREATE OR REPLACEs create_club_sales_order (the SECOND function in the
// file) adding auto-art at job birth. We slice its body out so the single-INSERT
// helpers below read the CLUB function's writes, not the teamshop one above it.
const SQL207 = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/00207_auto_art.sql'),
  'utf8'
);
const CLUB207 = SQL207.slice(SQL207.indexOf('create or replace function public.create_club_sales_order'));

// ── Same lazy/top-level-comma parsing as teamshopSoConversion's helpers, but
// returning EVERY match (in source order) since 00204 has multiple same-table
// INSERTs for different deco kinds.
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
function allInsertColumns(table) {
  const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\(([^)]+)\\)`, 'gi');
  const out = []; let m;
  while ((m = re.exec(SQL))) out.push(m[1].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}
function allInsertValues(table) {
  const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\([^)]+\\)\\s*values\\s*\\(`, 'gi');
  const out = []; let m;
  while ((m = re.exec(SQL))) {
    let i = m.index + m[0].length; let depth = 1; let body = '';
    while (i < SQL.length && depth > 0) {
      const ch = SQL[i];
      if (ch === '(') depth++;
      if (ch === ')') { depth--; if (depth === 0) break; }
      body += ch; i++;
    }
    out.push(splitTopLevel(body));
  }
  return out;
}
// Single-occurrence convenience (tables written exactly once).
const insertColumns = (table) => allInsertColumns(table)[0] || null;
const insertValues = (table) => allInsertValues(table)[0] || null;

describe('00204 migration structure', () => {
  test('adds webstore_transfers.unit_cost additively (nullable) — GP parity for transfer decos', () => {
    expect(SQL).toMatch(/alter table public\.webstore_transfers add column if not exists unit_cost numeric;/);
    expect(SQL).not.toMatch(/unit_cost numeric\s+(not null|default)/i);
  });

  test('RPC is SECURITY DEFINER, service_role-only, with rollback notes', () => {
    expect(SQL).toMatch(/create or replace function public\.create_club_sales_order\(\s*p_order_id uuid\s*\)/);
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/set search_path = public/);
    expect(SQL).toMatch(/revoke all on function public\.create_club_sales_order\(uuid\) from public;/);
    expect(SQL).toMatch(/revoke all on function public\.create_club_sales_order\(uuid\) from anon;/);
    expect(SQL).toMatch(/revoke all on function public\.create_club_sales_order\(uuid\) from authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.create_club_sales_order\(uuid\) to service_role;/);
    expect(SQL).toMatch(/── Rollback/);
    expect(SQL).toMatch(/drop function if exists public\.create_club_sales_order\(uuid\);/);
  });

  test('idempotency + guards: row lock, so_id replay, club org_type + paid gates, NSA_* codes', () => {
    expect(SQL).toMatch(/from webstore_orders where id = p_order_id for update/);
    expect(SQL).toMatch(/if v_ord\.so_id is not null then/);
    expect(SQL).toMatch(/'so_id', v_ord\.so_id, 'replayed', true/);
    expect(SQL).toMatch(/NSA_NOT_FOUND/);
    // keyed on the STORE's org_type, not order_source (unlike teamshop)
    expect(SQL).toMatch(/coalesce\(v_store\.org_type, ''\) <> 'club'[\s\S]{0,40}NSA_BAD_SOURCE/);
    expect(SQL).toMatch(/<> 'paid'[\s\S]{0,80}NSA_NOT_PAID/);
    expect(SQL).toMatch(/v_store\.customer_id is null[\s\S]{0,40}NSA_BAD_INPUT/);
    expect(SQL).toMatch(/NSA_BAD_INPUT:order has no items/);
  });

  test('customer resolves from webstores.customer_id (the club), not webstore_orders.customer_id', () => {
    expect(SQL).toMatch(/select \* into v_cust from customers where id = v_store\.customer_id;/);
  });

  test('SO id mint matches the client rule (App.js nextSOId) under an advisory lock — same as 00199', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtext\('nsa_sales_orders_id_mint'\)\)/);
    expect(SQL).toMatch(/regexp_match\(id, '\(\\d\+\)'\)\)\[1\]::bigint/);
    expect(SQL).toMatch(/greatest\(coalesce\(max\(\(regexp_match\(id, '\(\\d\+\)'\)\)\[1\]::bigint\), 0\), 1000\) \+ 1/);
    expect(SQL).toMatch(/v_so_id := 'SO-' \|\| v_num;/);
  });

  test('links the order back exactly like batchOrders/00199 (so_id + status batched)', () => {
    expect(SQL).toMatch(/update webstore_orders\s*set so_id = v_so_id, status = 'batched'\s*where id = v_ord\.id/);
  });

  test('rep guard: NULL primary_rep_id raises a NOTICE (never blocks) and surfaces no_rep', () => {
    expect(SQL).toMatch(/raise notice 'CLUB_NO_REP:%', v_store\.customer_id;/);
    expect(SQL).not.toMatch(/raise exception 'CLUB_NO_REP/);
    expect(SQL).toMatch(/'invoice_id', v_inv_id, 'no_rep', v_no_rep/);
  });
});

describe('sales_orders write', () => {
  const SALES_ORDERS_EXPECTED = [
    'id', 'customer_id', 'memo', 'status', 'created_at', 'updated_at',
    'expected_date', 'production_notes', 'shipping_type', 'shipping_value',
    'ship_to_id', 'tax_rate', 'tax_exempt', '_webstore_fundraise', 'source', 'webstore_id',
  ];
  test('column set = webstoreCreateSO field set (identical shape to 00199), all within _soCols', () => {
    const cols = insertColumns('sales_orders');
    expect(cols).toEqual(SALES_ORDERS_EXPECTED);
    cols.forEach((c) => expect(_soCols).toContain(c));
  });
  test('_webstore_fundraise carries this order’s own fundraise x discount ratio (not 0, not batch-summed)', () => {
    const vals = insertValues('sales_orders');
    expect(vals[SALES_ORDERS_EXPECTED.indexOf('_webstore_fundraise')]).toBe('v_fundraise_cost');
    expect(SQL).toMatch(/v_fundraise_cost := round\(\(coalesce\(v_ord\.fundraise_amt, 0\) \* v_disc_ratio\)::numeric, 2\);/);
  });
  test('tax_exempt true, source webstore (same reconciliation posture as batched webstore SOs)', () => {
    const vals = insertValues('sales_orders');
    expect(vals[SALES_ORDERS_EXPECTED.indexOf('tax_exempt')]).toBe('true');
    expect(vals[SALES_ORDERS_EXPECTED.indexOf('source')]).toBe("'webstore'");
  });
});

describe('this order’s own discount ratio (batchOrders’ discRatio, degenerated to one order)', () => {
  test('garmentGross / clamped discount / ratio formula', () => {
    expect(SQL).toMatch(/v_garment_gross := coalesce\(v_ord\.subtotal, 0\) \+ coalesce\(v_ord\.fundraise_amt, 0\);/);
    expect(SQL).toMatch(/v_disc := least\(coalesce\(v_ord\.discount_amt, 0\), greatest\(v_garment_gross, 0\)\);/);
    expect(SQL).toMatch(/v_disc_ratio := case when v_garment_gross > 0[\s\S]{0,160}else 1 end;/);
    expect(SQL).toMatch(/greatest\(0, \(v_garment_gross - v_disc\) \/ v_garment_gross\)/);
  });
});

describe('bundle allocation (batchOrders’ weighted-by-retail-price allocation, replicated server-side)', () => {
  test('parent value + component weight scratch tables feed _club_lines’ collected $', () => {
    expect(SQL).toMatch(/create temporary table _club_bundle_parent \(bpid uuid, parent_val numeric\)/);
    expect(SQL).toMatch(/create temporary table _club_bundle_weight \(bpid uuid, wsum numeric, n int\)/);
    // weighted split when weights are known, equal split fallback otherwise
    expect(SQL).toMatch(/when bw\.wsum > 0[\s\S]{0,40}then round\(\(bp\.parent_val \* coalesce\(p\.retail_price, 0\) \/ bw\.wsum\)::numeric, 2\)/);
    expect(SQL).toMatch(/else round\(\(bp\.parent_val \/ greatest\(coalesce\(bw\.n, 1\), 1\)\)::numeric, 2\)/);
  });
});

describe('so_items write', () => {
  const SO_ITEMS_EXPECTED = [
    'so_id', 'item_index', 'product_id', 'sku', 'name', 'brand', 'color',
    'nsa_cost', 'retail_price', 'unit_sell', 'sizes', 'available_sizes', 'no_deco',
  ];
  test('column set is IDENTICAL in shape to 00199/batchOrders’ so_items, within _itemCols', () => {
    const cols = insertColumns('so_items');
    expect(cols).toEqual(SO_ITEMS_EXPECTED);
    cols.filter((c) => c !== 'so_id' && c !== 'item_index')
      .forEach((c) => expect(_itemCols).toContain(c));
  });

  test('GARMENT COST PARITY: nsa_cost is the clearance-aware costByPid rule (is_clearance+clearance_cost -> clearance_cost, else nsa_cost)', () => {
    expect(SQL).toMatch(/case when p\.is_clearance and p\.clearance_cost is not null then p\.clearance_cost else p\.nsa_cost end as cost_basis/);
    const vals = insertValues('so_items');
    expect(vals[SO_ITEMS_EXPECTED.indexOf('nsa_cost')]).toBe('coalesce(v_p.cost_basis, 0)');
  });

  test('unit_sell = collected ÷ units, scaled by this order’s own discount ratio', () => {
    expect(SQL).toMatch(/v_unit_sell := round\(\(v_grp\.collected \/ greatest\(v_grp\.units, 1\) \* v_disc_ratio\)::numeric, 2\);/);
  });

  test('sizes map merges per size (OS fallback), available_sizes = its keys — same shape as batchOrders/00199', () => {
    expect(SQL).toMatch(/jsonb_object_agg\(s\.sz, s\.q\)/);
    expect(SQL).toMatch(/coalesce\(nullif\(l2\.size, ''\), 'OS'\)/);
    expect(SQL).toMatch(/jsonb_object_keys\(coalesce\(v_grp\.sizes, '\{\}'::jsonb\)\)/);
  });

  test('no_deco is computed from the ACTUAL deco count (logo + transfer + numbers + names), not hardcoded', () => {
    expect(SQL).toMatch(/v_deco_count := jsonb_array_length\(coalesce\(v_wp\.decorations, '\[\]'::jsonb\)\)/);
    expect(SQL).toMatch(/v_no_deco := \(v_deco_count = 0\);/);
  });
});

describe('so_item_decorations — logo placements (webstore_products.decorations)', () => {
  const cols = allInsertColumns('so_item_decorations')[0];
  const EXPECTED = [
    'so_item_id', 'deco_index', 'kind', 'position', 'type',
    'colors', 'underbase', 'stitches', 'dtf_size',
    'sell_override', 'sell_each', 'cost_each',
    'web_url', 'placement', 'side', 'color_label',
  ];
  test('column set within _decoCols, art_file_id absent (00199’s precedent — no so_art_files row)', () => {
    expect(cols).toEqual(EXPECTED);
    cols.filter((c) => c !== 'so_item_id' && c !== 'deco_index').forEach((c) => expect(_decoCols).toContain(c));
    expect(cols).not.toContain('art_file_id');
  });
  test('sells suppressed (0,0,0) — revenue rides on unit_sell', () => {
    const vals = allInsertValues('so_item_decorations')[0];
    ['sell_override', 'sell_each', 'cost_each'].forEach((c) => expect(vals[EXPECTED.indexOf(c)]).toBe('0'));
  });
  test('position uses the exact POS_LABEL placement table batchOrders/00199 use', () => {
    expect(SQL).toMatch(/when 'left_chest'\s+then 'Left Chest'/);
    expect(SQL).toMatch(/when 'full_front'\s+then 'Front'/);
    expect(SQL).toMatch(/when 'full_back'\s+then 'Back'/);
    expect(SQL).toMatch(/when 'left_sleeve'\s+then 'Left Sleeve'/);
    expect(SQL).toMatch(/when 'right_sleeve'\s+then 'Right Sleeve'/);
  });
});

describe('so_item_decorations — transfer-code designs (heat-transfer GP parity, coordinator spec change)', () => {
  const cols = allInsertColumns('so_item_decorations')[1];
  const EXPECTED = ['so_item_id', 'deco_index', 'kind', 'position', 'type', 'sell_override', 'sell_each', 'cost_each', 'placement', 'side', 'color_label', 'transfer_code'];
  test('column set within _decoCols; kind art, type heat_press, transfer_code stamped, art_file_id absent', () => {
    expect(cols).toEqual(EXPECTED);
    cols.filter((c) => c !== 'so_item_id' && c !== 'deco_index').forEach((c) => expect(_decoCols).toContain(c));
    const vals = allInsertValues('so_item_decorations')[1];
    expect(vals[EXPECTED.indexOf('kind')]).toBe("'art'");
    expect(vals[EXPECTED.indexOf('type')]).toBe("'heat_press'");
    expect(vals[EXPECTED.indexOf('transfer_code')]).toBe('v_xfer_code');
  });
  test('cost_each = the transfer’s unit_cost, coalesced to 0 (a missing cost never blocks conversion)', () => {
    const vals = allInsertValues('so_item_decorations')[1];
    expect(vals[EXPECTED.indexOf('cost_each')]).toBe('coalesce(v_transfer.unit_cost, 0)');
    expect(vals[EXPECTED.indexOf('sell_override')]).toBe('0');
    expect(vals[EXPECTED.indexOf('sell_each')]).toBe('0');
  });
  test('resolved from BOTH bundle-component transfer_code and catalog transfer_codes[] (batchOrders’ union of both sources)', () => {
    expect(SQL).toMatch(/select unnest\(coalesce\(v_wp\.transfer_codes, '\{\}'::text\[\]\)\) as code/);
    expect(SQL).toMatch(/select transfer_code from webstore_bundle_items/);
  });
});

describe('so_item_decorations — numbers/names personalization', () => {
  test('numbers: sell_override is the LITERAL 0 (not null) — deterministic suppression independent of any in-memory flag', () => {
    const idx = allInsertColumns('so_item_decorations').findIndex((c) => c.includes('num_method'));
    expect(idx).toBeGreaterThan(-1);
    const cols = allInsertColumns('so_item_decorations')[idx];
    const vals = allInsertValues('so_item_decorations')[idx];
    expect(cols).toEqual(['so_item_id', 'deco_index', 'kind', 'position', 'num_method', 'num_size', 'two_color', 'sell_override', 'sell_each', 'roster']);
    expect(vals[cols.indexOf('sell_override')]).toBe('0');
    expect(vals[cols.indexOf('kind')]).toBe("'numbers'");
    expect(vals[cols.indexOf('roster')]).toBe('v_grp.numbers_roster');
    cols.filter((c) => c !== 'so_item_id' && c !== 'deco_index').forEach((c) => expect(_decoCols).toContain(c));
  });
  test('names: sell_override literal 0, cost_each real ($3 default), names roster carried', () => {
    const idx = allInsertColumns('so_item_decorations').findIndex((c) => c.includes('names') && !c.includes('num_method'));
    expect(idx).toBeGreaterThan(-1);
    const cols = allInsertColumns('so_item_decorations')[idx];
    const vals = allInsertValues('so_item_decorations')[idx];
    expect(cols).toEqual(['so_item_id', 'deco_index', 'kind', 'position', 'sell_override', 'sell_each', 'cost_each', 'names']);
    expect(vals[cols.indexOf('sell_override')]).toBe('0');
    expect(vals[cols.indexOf('kind')]).toBe("'names'");
    cols.filter((c) => c !== 'so_item_id' && c !== 'deco_index').forEach((c) => expect(_decoCols).toContain(c));
  });
  test('numbers/names rosters expand qty into per-unit arrays (generate_series), only emitted when takes_number/name AND a real value exists', () => {
    expect(SQL).toMatch(/cross join lateral generate_series\(1, greatest\(l3\.qty, 1\)\) as gs\(n\)/);
    expect(SQL).toMatch(/v_has_num  := v_takes_num and exists \(/);
    expect(SQL).toMatch(/v_has_name := v_takes_name and exists \(/);
  });
  test('no so_jobs row for numbers/names (only art-kind decos build production jobs — 00199’s precedent)', () => {
    expect(SQL).toMatch(/-- Numbers\/names personalization\.[\s\S]*?No job row — art-kind decos\s*\n\s*-- only build so_jobs \(00199's precedent\)\./);
  });
});

describe('so_jobs + job_stage_events', () => {
  const SO_JOBS_EXPECTED = [
    'so_id', 'id', 'key', 'art_file_id', '_art_ids', 'art_name', 'deco_type', 'positions',
    'art_status', 'item_status', 'prod_status', 'total_units', 'fulfilled_units',
    'split_from', 'created_at', 'ship_method', 'items', '_auto', 'digitizing_needed',
  ];
  test('column set identical in shape to 00199, within _jobCols', () => {
    const cols = insertColumns('so_jobs');
    expect(cols).toEqual(SO_JOBS_EXPECTED);
    cols.filter((c) => c !== 'so_id' && c !== 'digitizing_needed').forEach((c) => expect(_jobCols).toContain(c));
  });
  test('jobs born on hold (needs_art/need_to_order), null art_file_id, digitizing_needed always false for club', () => {
    const cols = insertColumns('so_jobs'); const vals = insertValues('so_jobs');
    const at = (c) => vals[cols.indexOf(c)];
    expect(at('prod_status')).toBe("'hold'");
    expect(at('art_status')).toBe("'needs_art'");
    expect(at('item_status')).toBe("'need_to_order'");
    expect(at('art_file_id')).toBe('null');
    expect(at('digitizing_needed')).toBe('v_job.digitizing');
    // digitizing is always literal `false` at every _ts_job_decos write site (logo +
    // transfer decos) — club logos are existing customer-library art, never a
    // coach-uploaded Team Shop logo needing a digitizing vendor route.
    const digitizingWrites = (SQL.match(/logo_name, position, digitizing\)\s*values \([\s\S]{0,260}?\);/g) || []);
    expect(digitizingWrites.length).toBeGreaterThanOrEqual(2);
    digitizingWrites.forEach((w) => expect(w.trim().endsWith('false);')).toBe(true));
  });
  test('one job per distinct (deco_type, logo_ref); grouped from BOTH logo and transfer art decos', () => {
    expect(SQL).toMatch(/group by d\.deco_type, d\.logo_ref/);
    expect(SQL).toMatch(/'art:' \|\| \(v_deco->>'art_id'\)/);
    expect(SQL).toMatch(/'xfer:' \|\| v_xfer_code/);
  });
  test('job_stage_events source is club (not teamshop), event created, same column set as 00192/00199', () => {
    const cols = insertColumns('job_stage_events');
    expect(cols).toEqual(['so_id', 'job_id', 'event', 'from_state', 'to_state', 'actor', 'source', 'payload']);
    const vals = insertValues('job_stage_events');
    expect(vals[cols.indexOf('event')]).toBe("'created'");
    expect(vals[cols.indexOf('source')]).toBe("'club'");
  });
});

describe('invoice — mirrors 00199’s block (coordinator spec change: invoices are REQUIRED, not deferred)', () => {
  const INVOICES_EXPECTED = [
    'id', 'customer_id', 'so_id', 'type', 'inv_type', 'date', 'due_date',
    'total', 'paid', 'status', 'memo', 'tax', 'tax_rate', 'tax_exempt', 'shipping',
    'line_items', 'created_at', 'updated_at',
  ];
  test('invoices insert = 00199’s field set exactly', () => {
    expect(insertColumns('invoices')).toEqual(INVOICES_EXPECTED);
  });
  test('INV id mint under its own advisory lock, same /(\\d+)/ rule as the SO mint', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtext\('nsa_invoices_id_mint'\)\)/);
    expect(SQL).toMatch(/v_inv_id := 'INV-' \|\| v_inv_num;/);
  });
  test('type invoice/full, tax 0/0/exempt, shipping 0, memo ‘Invoice — ’ prefixed', () => {
    const cols = insertColumns('invoices'); const vals = insertValues('invoices');
    const at = (c) => vals[cols.indexOf(c)];
    expect(at('type')).toBe("'invoice'");
    expect(at('inv_type')).toBe("'full'");
    expect(at('tax')).toBe('0');
    expect(at('tax_rate')).toBe('0');
    expect(at('tax_exempt')).toBe('true');
    expect(at('shipping')).toBe('0');
    expect(at('memo')).toBe("'Invoice — ' || v_memo");
  });
  test('no PO branch — club orders only ever reach this RPC ‘paid’ (unlike 00199’s po_verified widen)', () => {
    // 00199 status-gates on `not in ('paid', 'po_verified')` and branches on v_is_po;
    // 00204 has neither — only a plain <> 'paid' guard and a single settlement path.
    expect(SQL).not.toMatch(/not in \('paid', 'po_verified'\)/);
    expect(SQL).not.toMatch(/\bv_is_po\b/);
    expect(SQL).toMatch(/if coalesce\(v_ord\.status, ''\) <> 'paid' then/);
  });
  test('card-settlement clamp: min(invoice total, order collected); CLUB-prefixed payment ref', () => {
    expect(SQL).toMatch(/v_applied := round\(least\(v_inv_total, greatest\(coalesce\(v_ord\.total, 0\), 0\)\)::numeric, 2\);/);
    expect(SQL).toMatch(/'CLUB ' \|\| coalesce\(v_ord\.order_number::text, v_ord\.id::text\)/);
    const cols = insertColumns('invoice_payments');
    expect(cols).toEqual(['invoice_id', 'amount', 'method', 'ref', 'date']);
    expect(insertValues('invoice_payments')[cols.indexOf('method')]).toBe("'store'");
  });
  test('status rule matches 00199 (paid ≥ total−0.005 → paid; >0 → partial; else open)', () => {
    expect(SQL).toMatch(/case when v_applied >= v_inv_total - 0\.005 then 'paid'\s*when v_applied > 0 then 'partial'\s*else 'open' end/);
  });
  test('replay-safe: guarded by NOT EXISTS(so_id) — same as 00199', () => {
    expect(SQL).toMatch(/if not exists \(select 1 from invoices where so_id = v_so_id\) then/);
  });
  test('invoice_items = sku/name/qty only (unit_price undefined → NULL, same as 00199)', () => {
    expect(SQL).toMatch(/insert into invoice_items \(invoice_id, sku, name, qty\)/);
    expect(insertColumns('invoice_items')).not.toContain('unit_price');
  });
});

describe('_version bookkeeping is never written (trigger/DEFAULT own it)', () => {
  test('no insert touches _version on any table', () => {
    ['sales_orders', 'so_items', 'so_item_decorations', 'so_jobs', 'job_stage_events', 'invoices'].forEach((t) => {
      allInsertColumns(t).forEach((cols) => expect(cols).not.toContain('_version'));
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 00207 — auto-art for the CLUB RPC. Every 00204 write shape preserved; the ONLY
// change is the job-birth values when an 'art:<art_id>' logo resolves to a
// production-ready customer art-library entry ('xfer:' transfer jobs never do).
// ═════════════════════════════════════════════════════════════════════════════
describe('00207 preserves the 00204 club write shapes and adds auto-art', () => {
  // Single-INSERT helpers scoped to the CLUB function slice of 00207.
  const colsOf = (table) => {
    const m = CLUB207.match(new RegExp(`insert\\s+into\\s+${table}\\s*\\(([^)]+)\\)`, 'i'));
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  const valsOf = (table) => {
    const m = CLUB207.match(new RegExp(`insert\\s+into\\s+${table}\\s*\\([^)]+\\)\\s*values\\s*\\(`, 'i'));
    if (!m) return null;
    let i = m.index + m[0].length; let depth = 1; let body = '';
    while (i < CLUB207.length && depth > 0) {
      const ch = CLUB207[i];
      if (ch === '(') depth++;
      if (ch === ')') { depth--; if (depth === 0) break; }
      body += ch; i++;
    }
    return splitTopLevel(body);
  };

  test('so_jobs + job_stage_events column lists byte-identical to 00204', () => {
    ['so_jobs', 'job_stage_events'].forEach((t) => {
      expect(colsOf(t)).toEqual(insertColumns(t)); // insertColumns = 00204 (module SQL)
    });
  });

  test('service-role grants + club guards survive the replace', () => {
    expect(CLUB207).toMatch(/create or replace function public\.create_club_sales_order\(\s*p_order_id uuid\s*\)/);
    expect(CLUB207).toMatch(/coalesce\(v_store\.org_type, ''\) <> 'club'[\s\S]{0,40}NSA_BAD_SOURCE/);
    expect(CLUB207).toMatch(/grant execute on function public\.create_club_sales_order\(uuid\) to service_role;/);
  });

  test('same production-ready predicate as teamshop, resolved against the club customer’s art_files', () => {
    expect(CLUB207).toMatch(/v_art_id\s*:=\s*case when v_job\.logo_ref like 'art:%' then substring\(v_job\.logo_ref from 5\) else null end;/);
    expect(CLUB207).toMatch(/coalesce\(v_art_entry->>'status', ''\) = 'approved'/);
    expect(CLUB207).toMatch(/\(v_art_entry->>'prod_files_attached'\)::boolean is true/);
    expect(CLUB207).toMatch(/like '%\.dst'/);
  });

  test('so_jobs born art_complete/real art id/no digitizing ONLY when v_auto_art, else 00204’s exact birth', () => {
    const cols = colsOf('so_jobs'); const vals = valsOf('so_jobs');
    const at = (c) => vals[cols.indexOf(c)];
    expect(at('art_status')).toBe("case when v_auto_art then 'art_complete' else 'needs_art' end");
    expect(at('art_file_id')).toBe('case when v_auto_art then v_art_id else null end');
    expect(at('_art_ids')).toBe("case when v_auto_art then jsonb_build_array(v_art_id) else '[]'::jsonb end");
    expect(at('digitizing_needed')).toBe('case when v_auto_art then false else v_job.digitizing end');
    expect(at('item_status')).toBe("'need_to_order'");
    expect(at('prod_status')).toBe("'hold'");
  });

  test('created event source stays club and records auto_art', () => {
    const cols = colsOf('job_stage_events'); const vals = valsOf('job_stage_events');
    expect(vals[cols.indexOf('source')]).toBe("'club'");
    expect(CLUB207).toMatch(/'auto_art', v_auto_art/);
  });
});
