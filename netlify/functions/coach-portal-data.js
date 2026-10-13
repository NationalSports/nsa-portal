// Coach-portal read endpoint — the read twin of portal-action.js.
//
// The coach portal (?portal=<alpha_tag>) used to boot the whole staff app as the
// Supabase `anon` role and download EVERY customer's orders, estimates, invoices,
// contacts and the staff roster (~10 MB, ~9 s to first paint on 2026-10-13) only to
// render one team. This returns just the rows that portal renders, read with the
// service role, as raw table rows in the shape src/lib/dbEngine.js `_dbLoad` reads —
// src/lib/coachPortalData.js feeds them through `_dbLoad`'s `source` option, so the
// order/estimate/invoice assembly is not duplicated here.
//
// Scope mirrors src/CoachPortal.js:
//   - the portal customer is the ONE customer whose alpha_tag matches (trimmed,
//     case-insensitive) — the same rule App.js's ?portal= gate used;
//   - documents (orders, estimates, invoices) belong to `ids`: the customer, plus its
//     sub-teams when it is a top-level department account (CoachPortal `ids`/`isP`);
//   - customers: the department family — root, its sub-teams, and the customer
//     (CoachPortal reads parent, subs and `adFamily`);
//   - staff: only the people those customers/documents point at, and only
//     id/name/email/phone/role (CoachPortal shows a rep's name and email);
//   - products: only those on the documents' lines, without cost columns.
// Like portal-action, the alpha tag in the link is the credential.

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAGE = 1000;   // PostgREST max rows per request
const CHUNK = 100;   // ids per .in() filter, keeps request URLs short

// Row order per table — the order _dbLoad's _safeQuery calls request
// (src/lib/dbEngine.js: the `order` passed in _dbLoad, then _PAGE_TIEBREAK_PARENT,
// then id). The assembly keeps child rows in query order, so Postgres must sort
// them here (its en_US collation is not what a browser sort would give).
const ORDER = {
  customers: ['name'],
  team_members: ['name'],
  products: ['name'],
  estimates: ['id'], sales_orders: ['id'], invoices: ['id'],
  estimate_items: ['item_index'], so_items: ['item_index'],
  estimate_item_decorations: ['deco_index'], so_item_decorations: ['deco_index'],
  invoice_credit_memos: ['created_at'],
};
const TIEBREAK_PARENT = { so_jobs: 'so_id', so_art_files: 'so_id', estimate_art_files: 'estimate_id' };

const STAFF_COLS = 'id,name,email,phone,role,is_active';
const PRODUCT_COLS = 'id,vendor_id,sku,name,brand,color,category,retail_price,is_active,available_sizes,_colors,created_at,updated_at,image_front_url,image_back_url,color_category,is_archived,inventory_source';

const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined && v !== ''))];
const chunks = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };

// Every row of `table` whose `col` is in `values`, in ORDER, paged past 1000.
// Chunks are fetched by parent key, so each parent's children stay contiguous and
// in order (the assembly groups children per parent).
async function rowsWhereIn(admin, table, col, values, select = '*') {
  const vals = uniq(values);
  if (!vals.length) return [];
  const out = [];
  for (const part of chunks(vals)) {
    for (let from = 0; ; from += PAGE) {
      let q = admin.from(table).select(select).in(col, part);
      const order = (ORDER[table] || [])[0];
      if (order) q = q.order(order, { ascending: true });
      const parent = TIEBREAK_PARENT[table];
      if (parent && order !== parent) q = q.order(parent, { ascending: true });
      if (order !== 'id') q = q.order('id', { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(table + ': ' + error.message);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

// The customer a portal tag opens, or why it can't be opened.
async function resolvePortalCustomer(admin, alphaTag) {
  const want = String(alphaTag || '').trim().toLowerCase();
  if (!want) return { status: 'bad_request' };
  // ilike narrows the scan; the exact trimmed, case-insensitive comparison below is
  // the rule (LIKE wildcards in the tag only widen the candidate list).
  const { data, error } = await admin.from('customers').select('id,alpha_tag,parent_id').ilike('alpha_tag', '%' + want + '%');
  if (error) throw new Error('customers: ' + error.message);
  const matches = (data || []).filter((c) => String(c.alpha_tag || '').trim().toLowerCase() === want);
  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'ok', customer: matches[0] };
}

// All rows the portal for `alphaTag` renders, keyed by table name.
async function loadPortalScope(admin, alphaTag) {
  const found = await resolvePortalCustomer(admin, alphaTag);
  if (found.status !== 'ok') return found;
  const me = found.customer;
  const rootId = me.parent_id || me.id;

  const kidsOfRoot = await rowsWhereIn(admin, 'customers', 'parent_id', [rootId], 'id');
  const familyIds = uniq([rootId, me.id, ...kidsOfRoot.map((k) => k.id)]);
  const customers = await rowsWhereIn(admin, 'customers', 'id', familyIds);
  // CoachPortal `ids`: a department account sees its sub-teams' documents too.
  const docCustomerIds = me.parent_id ? [me.id] : [me.id, ...customers.filter((c) => c.parent_id === me.id).map((c) => c.id)];

  const [sales_orders, estimates, invoices] = await Promise.all([
    rowsWhereIn(admin, 'sales_orders', 'customer_id', docCustomerIds),
    rowsWhereIn(admin, 'estimates', 'customer_id', docCustomerIds),
    rowsWhereIn(admin, 'invoices', 'customer_id', docCustomerIds),
  ]);
  const soIds = sales_orders.map((r) => r.id);
  const estIds = estimates.map((r) => r.id);
  const invIds = invoices.map((r) => r.id);

  const [so_items, so_jobs, so_art_files, so_firm_dates, estimate_items, estimate_art_files,
    invoice_items, invoice_payments, invoice_credit_memos, customer_contacts, customer_promo_programs,
    customer_promo_periods, customer_credits, customer_pending_shipping] = await Promise.all([
    rowsWhereIn(admin, 'so_items', 'so_id', soIds),
    rowsWhereIn(admin, 'so_jobs', 'so_id', soIds),
    rowsWhereIn(admin, 'so_art_files', 'so_id', soIds),
    rowsWhereIn(admin, 'so_firm_dates', 'so_id', soIds),
    rowsWhereIn(admin, 'estimate_items', 'estimate_id', estIds),
    rowsWhereIn(admin, 'estimate_art_files', 'estimate_id', estIds),
    rowsWhereIn(admin, 'invoice_items', 'invoice_id', invIds),
    rowsWhereIn(admin, 'invoice_payments', 'invoice_id', invIds),
    rowsWhereIn(admin, 'invoice_credit_memos', 'invoice_id', invIds),
    rowsWhereIn(admin, 'customer_contacts', 'customer_id', familyIds),
    rowsWhereIn(admin, 'customer_promo_programs', 'customer_id', familyIds),
    rowsWhereIn(admin, 'customer_promo_periods', 'customer_id', familyIds),
    rowsWhereIn(admin, 'customer_credits', 'customer_id', familyIds),
    rowsWhereIn(admin, 'customer_pending_shipping', 'customer_id', familyIds),
  ]);
  const soItemIds = so_items.map((r) => r.id);
  const estItemIds = estimate_items.map((r) => r.id);
  // CoachPortal finds a line's product by id, else by sku — so lines without a product id
  // also bring the products carrying their sku (by-id rows first, so an id match wins).
  const lines = [...so_items, ...estimate_items];
  const productIds = lines.map((r) => r.product_id);
  const orphanSkus = lines.filter((r) => !r.product_id && r.sku).map((r) => r.sku);
  const staffIds = [
    ...customers.map((c) => c.primary_rep_id),
    ...[...sales_orders, ...estimates, ...invoices].flatMap((d) => [d.created_by, d.rep_id]),
  ];

  const [so_item_decorations, so_item_pick_lines, so_item_po_lines, estimate_item_decorations,
    customer_promo_usage, customer_credit_usage, customer_pending_shipping_usage, team_members,
    productsById, productsBySku] = await Promise.all([
    rowsWhereIn(admin, 'so_item_decorations', 'so_item_id', soItemIds),
    rowsWhereIn(admin, 'so_item_pick_lines', 'so_item_id', soItemIds),
    rowsWhereIn(admin, 'so_item_po_lines', 'so_item_id', soItemIds),
    rowsWhereIn(admin, 'estimate_item_decorations', 'estimate_item_id', estItemIds),
    rowsWhereIn(admin, 'customer_promo_usage', 'period_id', customer_promo_periods.map((r) => r.id)),
    rowsWhereIn(admin, 'customer_credit_usage', 'credit_id', customer_credits.map((r) => r.id)),
    rowsWhereIn(admin, 'customer_pending_shipping_usage', 'pending_id', customer_pending_shipping.map((r) => r.id)),
    rowsWhereIn(admin, 'team_members', 'id', staffIds, STAFF_COLS),
    rowsWhereIn(admin, 'products', 'id', productIds, PRODUCT_COLS),
    rowsWhereIn(admin, 'products', 'sku', orphanSkus, PRODUCT_COLS),
  ]);
  const seenProducts = new Set();
  const products = [...productsById, ...productsBySku].filter((p) => !seenProducts.has(p.id) && seenProducts.add(p.id));
  // company_info (document headers/footers), portal_settings (if staff ever saved one) and
  // the line products' image fallbacks.
  const app_state = await rowsWhereIn(admin, 'app_state', 'id', ['company_info', 'portal_settings', ...products.map((p) => '_pimg_' + p.id)], 'id,value');

  return {
    status: 'ok',
    customerId: me.id,
    tables: {
      customers, customer_contacts, customer_promo_programs, customer_promo_periods, customer_promo_usage,
      customer_credits, customer_credit_usage, customer_pending_shipping, customer_pending_shipping_usage,
      sales_orders, so_items, so_item_decorations, so_item_pick_lines, so_item_po_lines, so_jobs, so_art_files, so_firm_dates,
      estimates, estimate_items, estimate_item_decorations, estimate_art_files,
      invoices, invoice_items, invoice_payments, invoice_credit_memos,
      team_members, products, app_state,
    },
  };
}

const STATUS_CODE = { bad_request: 400, not_found: 404, ambiguous: 409 };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sbUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Supabase service credentials missing' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const result = await loadPortalScope(admin, body.alphaTag);
    if (result.status !== 'ok') return { statusCode: STATUS_CODE[result.status] || 400, headers: CORS, body: JSON.stringify({ error: result.status }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ customerId: result.customerId, tables: result.tables }) };
  } catch (e) {
    console.error('[coach-portal-data]', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not load this portal' }) };
  }
};

// Test surface — Netlify invokes `handler`.
module.exports.loadPortalScope = loadPortalScope;
module.exports.resolvePortalCustomer = resolvePortalCustomer;
