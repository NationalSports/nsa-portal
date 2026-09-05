// Read-only gateway for the public coach portal. The browser may ask for one of
// the tables below, but it cannot choose the customer boundary or returned
// columns: both are derived here from the presented portal credential.
const { getSupabaseAdmin, resolveCustomerFamily } = require('./_shared');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
  Vary: 'Origin',
};
const MAX_PAGE = 1000;

const fields = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
const TABLES = {
  customers: { scope: 'family', fields: fields('id,parent_id,name,billing_address_line1,billing_address_line2,billing_city,billing_state,billing_zip,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_zip,shipping_attention,payment_terms,tax_rate,tax_exempt,primary_rep_id,is_active,alt_billing_addresses,art_files,pantone_colors,thread_colors,logo_url,school_colors,disable_cc_pay,coach_ai_builder,coach_livelook,coach_build_orders,coach_roster,uniform_discount_percent,created_at,updated_at,_version') },
  customer_contacts: { scope: 'familyCustomer', fields: fields('id,customer_id,name,email,phone,role,sort_order') },
  customer_credits: { scope: 'familyCustomer', fields: fields('id,customer_id,amount,used,source,is_fundraise,created_at') },
  customer_credit_usage: { scope: 'credit', fields: fields('id,credit_id,so_id,estimate_id,amount,description,created_at') },
  customer_promo_programs: { scope: 'familyCustomer', fields: fields('id,customer_id,type,fixed_amount,spend_percentage,is_active,notes,created_at,updated_at') },
  customer_promo_periods: { scope: 'familyCustomer', fields: fields('id,customer_id,program_id,period_start,period_end,allocated,used,notes,created_at') },
  customer_promo_usage: { scope: 'promoPeriod', fields: fields('id,period_id,so_id,estimate_id,amount,description,created_at') },

  estimates: { scope: 'familyCustomer', fields: fields('id,customer_id,memo,status,created_by,created_at,updated_at,default_markup,shipping_type,shipping_value,ship_to_id,bill_to_id,email_status,email_sent_at,email_opened_at,email_viewed_at,deleted_at,promo_applied,promo_amount,approved_by,approved_at,credit_applied,credit_amount,deco_pos,update_requests,_version') },
  estimate_items: { scope: 'estimate', fields: fields('id,estimate_id,item_index,product_id,sku,name,brand,color,retail_price,unit_sell,sizes,available_sizes,_colors,no_deco,notes,is_custom,custom_desc,custom_sell,is_promo,_pre_promo_sell,_promo_credit,_promo_partial_qty,is_free_promo,_pre_free_promo_sell,est_qty,qty_only,size_availability,is_footwear,customer_supplied') },
  estimate_item_decorations: { scope: 'estimateItem', fields: fields('id,estimate_item_id,deco_index,kind,position,type,art_file_id,art_tbd_type,tbd_colors,tbd_stitches,tbd_dtf_size,sell_override,sell_each,underbase,two_color,colors,stitches,dtf_size,num_method,num_size,num_size_back,num_font,roster,names,names_list,vendor,deco_type,notes,custom_font_art_id,print_color,front_and_back,reversible,num_qty,name_qty,name_method,color_way_id,color_way_id_b,split_group,split_sizes,split_runs,fulfillment,web_url,placement,side,color_label,transfer_code') },
  estimate_art_files: { scope: 'estimate', fields: fields('id,estimate_id,name,deco_type,ink_colors,thread_colors,stitches,art_size,art_sizes,garment_colors,color_ways,files,mockup_files,item_mockups,mock_links,design_id,sample_art,prod_files,prod_files_attached,preview_url,web_logos,web_logo_url,location,notes,status,archived,uploaded') },

  sales_orders: { scope: 'familyCustomer', fields: fields('id,customer_id,estimate_id,memo,status,created_by,created_at,updated_at,expected_date,shipping_type,shipping_value,ship_to_id,bill_to_id,default_markup,_shipping_status,_tracking_number,_carrier,_ship_date,_tracking_url,_shipped,_shipments,deleted_at,promo_applied,promo_amount,ship_preference,ship_on_date,deliver_on_date,order_type,expected_ship_date,po_number,tax_rate,tax_exempt,email_status,email_sent_at,email_opened_at,email_viewed_at,credit_applied,credit_amount,deco_pos,source,webstore_id,webstore_batch_no,webstore_batch_label,webstore_batch_cutoff,delivered,_version') },
  so_items: { scope: 'salesOrder', fields: fields('id,so_id,item_index,product_id,sku,name,brand,color,retail_price,unit_sell,sizes,available_sizes,_colors,no_deco,notes,is_custom,custom_desc,custom_sell,is_promo,_pre_promo_sell,_promo_credit,_promo_partial_qty,is_free_promo,_pre_free_promo_sell,est_qty,qty_only,size_availability,is_footwear,customer_supplied,invoice_line_keys') },
  so_item_decorations: { scope: 'salesOrderItem', fields: fields('id,so_item_id,deco_index,kind,position,type,art_file_id,art_tbd_type,tbd_colors,tbd_stitches,tbd_dtf_size,sell_override,sell_each,underbase,two_color,colors,stitches,dtf_size,num_method,num_size,num_size_back,num_font,roster,names,names_list,vendor,deco_type,notes,custom_font_art_id,print_color,front_and_back,reversible,num_qty,name_qty,name_method,color_way_id,color_way_id_b,split_group,split_sizes,split_runs,fulfillment,web_url,placement,side,color_label,transfer_code') },
  so_art_files: { scope: 'salesOrder', fields: fields('id,so_id,name,deco_type,ink_colors,thread_colors,stitches,art_size,art_sizes,garment_colors,color_ways,files,mockup_files,item_mockups,mock_links,design_id,sample_art,prod_files,prod_files_attached,preview_url,web_logos,web_logo_url,location,notes,status,archived,uploaded') },
  so_firm_dates: { scope: 'salesOrder', fields: fields('id,so_id,item_desc,date,approved') },
  so_item_pick_lines: { scope: 'salesOrderItem', fields: fields('id,so_item_id,pick_id,sizes,status,created_at,memo,ship_dest,ship_addr,deco_vendor') },
  so_item_po_lines: { scope: 'salesOrderItem', fields: fields('id,so_item_id,po_id,vendor,sizes,received,cancelled,status,created_at,expected_date,memo,tracking_numbers') },
  so_jobs: { scope: 'salesOrder', fields: fields('id,so_id,key,art_file_id,_art_ids,art_name,deco_type,deco_types,positions,art_status,item_status,prod_status,total_units,fulfilled_units,completed_at,split_from,split_open,created_at,ship_method,items,art_requests,art_messages,rejections,coach_rejected,sent_to_coach_at,coach_approved_at,coach_approval_comment,coach_email_opened_at,run_order,run1_done,run2_done,art_hidden,numbers_done,emb_names_link,link_group') },

  invoices: { scope: 'familyCustomer', fields: fields('id,customer_id,so_id,date,due_date,total,paid,memo,status,type,inv_type,deposit_pct,deposit_applied,credit_amount,tax,tax_rate,tax_exempt,shipping,cc_fee,line_items,email_status,email_sent_at,email_opened_at,created_at,updated_at,billing_name,billing_address,bill_to_id,shipping_name,shipping_address,po_number,rep_id,_version') },
  invoice_items: { scope: 'invoice', fields: fields('id,invoice_id,sku,name,qty,unit_price,total,description') },
  invoice_payments: { scope: 'invoice', fields: fields('id,invoice_id,amount,method,ref,date,cc_fee') },
};

const bad = (statusCode, error) => ({ statusCode, headers: CORS, body: JSON.stringify({ error }) });
const unique = (rows, key = 'id') => [...new Set((rows || []).map((row) => row[key]).filter((id) => id !== null && id !== undefined))];

async function selectIds(admin, table, select, column, ids) {
  if (!ids.length) return [];
  const { data, error } = await admin.from(table).select(select).in(column, ids);
  if (error) throw error;
  return data || [];
}

async function scopeFor(admin, familyIds, kind) {
  if (kind === 'family') return { column: 'id', ids: familyIds };
  if (kind === 'familyCustomer') return { column: 'customer_id', ids: familyIds };
  if (kind === 'estimate') return { column: 'estimate_id', ids: unique(await selectIds(admin, 'estimates', 'id', 'customer_id', familyIds)) };
  if (kind === 'estimateItem') {
    const estimateIds = unique(await selectIds(admin, 'estimates', 'id', 'customer_id', familyIds));
    return { column: 'estimate_item_id', ids: unique(await selectIds(admin, 'estimate_items', 'id', 'estimate_id', estimateIds)) };
  }
  if (kind === 'salesOrder') return { column: 'so_id', ids: unique(await selectIds(admin, 'sales_orders', 'id', 'customer_id', familyIds)) };
  if (kind === 'salesOrderItem') {
    const soIds = unique(await selectIds(admin, 'sales_orders', 'id', 'customer_id', familyIds));
    return { column: 'so_item_id', ids: unique(await selectIds(admin, 'so_items', 'id', 'so_id', soIds)) };
  }
  if (kind === 'invoice') return { column: 'invoice_id', ids: unique(await selectIds(admin, 'invoices', 'id', 'customer_id', familyIds)) };
  if (kind === 'credit') return { column: 'credit_id', ids: unique(await selectIds(admin, 'customer_credits', 'id', 'customer_id', familyIds)) };
  if (kind === 'promoPeriod') return { column: 'period_id', ids: unique(await selectIds(admin, 'customer_promo_periods', 'id', 'customer_id', familyIds)) };
  throw new Error('Unsupported portal scope');
}

function parseIn(raw) {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw new Error('Invalid in filter');
  // URLSearchParams has already decoded each value. Decoding a second time both
  // changes literal percent-encoded identifiers and can throw on a valid `%`.
  const values = raw.slice(1, -1).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length > 500) throw new Error('Too many filter values');
  return values;
}

function parseQuery(raw, allowedFields) {
  if (String(raw || '').length > 16 * 1024) throw new Error('Query too large');
  const params = new URLSearchParams(String(raw || ''));
  const filters = [];
  const orders = [];
  let queryLimit = null;
  let queryOffset = null;
  for (const [key, value] of params.entries()) {
    if (filters.length + orders.length > 100) throw new Error('Too many query clauses');
    if (key === 'select') continue; // response columns are fixed by TABLES
    if (key === 'limit') { queryLimit = Number(value); continue; }
    if (key === 'offset') { queryOffset = Number(value); continue; }
    if (key === 'order') {
      for (const order of value.split(',')) {
        const [column, direction = 'asc', nulls = ''] = order.split('.');
        if (!allowedFields.has(column) || !['asc', 'desc'].includes(direction) || (nulls && !['nullsfirst', 'nullslast'].includes(nulls))) throw new Error('Unsupported order');
        orders.push({ column, ascending: direction === 'asc', nullsFirst: nulls ? nulls === 'nullsfirst' : undefined });
      }
      continue;
    }
    if (!allowedFields.has(key)) throw new Error('Unsupported filter column');
    const dot = value.indexOf('.');
    if (dot < 1) throw new Error('Unsupported filter');
    const op = value.slice(0, dot); const operand = value.slice(dot + 1);
    if (op === 'eq' || op === 'neq') filters.push({ op, column: key, value: operand });
    else if (op === 'in') filters.push({ op, column: key, value: parseIn(operand) });
    else if (op === 'is' && ['null', 'true', 'false'].includes(operand)) filters.push({ op, column: key, value: operand === 'null' ? null : operand === 'true' });
    else throw new Error('Unsupported filter operator');
  }
  if (queryLimit !== null && (!Number.isInteger(queryLimit) || queryLimit < 1)) throw new Error('Invalid limit');
  if (queryOffset !== null && (!Number.isInteger(queryOffset) || queryOffset < 0)) throw new Error('Invalid offset');
  return { filters, orders, queryLimit, queryOffset };
}

function parseRange(value, queryLimit, queryOffset) {
  let start = queryOffset || 0;
  let end = start + Math.min(queryLimit === null ? MAX_PAGE : queryLimit, MAX_PAGE) - 1;
  if (value) {
    const match = /^(\d+)-(\d+)$/.exec(String(value).trim());
    if (!match) throw new Error('Invalid range');
    start = Number(match[1]); end = Number(match[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new Error('Invalid range');
  end = Math.min(end, start + MAX_PAGE - 1);
  return { start, end };
}

async function loadRows(admin, config, familyResult, body) {
  const allowed = new Set(config.fields);
  const parsed = parseQuery(body.query, allowed);
  const range = parseRange(body.range, parsed.queryLimit, parsed.queryOffset);
  const scope = await scopeFor(admin, familyResult.familyIds || [...familyResult.fam], config.scope);
  if (!scope.ids.length) return { rows: [], range, count: body.prefer?.includes('count=exact') ? 0 : null };

  const exactCount = String(body.prefer || '').includes('count=exact');
  let query = admin.from(body.table)
    .select(config.fields.join(','), exactCount ? { count: 'exact' } : undefined)
    .in(scope.column, scope.ids);
  for (const filter of parsed.filters) query = query[filter.op](filter.column, filter.value);
  for (const order of parsed.orders) query = query.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst });
  if (!parsed.orders.some((order) => order.column === 'id') && allowed.has('id')) query = query.order('id', { ascending: true });
  query = query.range(range.start, range.end);
  const { data, error, count } = await query;
  if (error) throw error;
  let rows = data || [];
  if (body.table === 'customers') {
    const owners = new Set(familyResult.ownerIds || []);
    rows = rows.map((row) => ({ ...row, _portal_owner: owners.has(row.id) }));
  }
  return { rows, range, count: exactCount ? count : null };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
  const portal = String(body.portal || '').trim();
  const config = TABLES[String(body.table || '')];
  if (!portal || portal.length > 512) return bad(400, 'Portal credential required');
  if (!config) return bad(400, 'Unsupported portal table');
  if (body.method && !['GET', 'HEAD'].includes(body.method)) return bad(405, 'Method not allowed');

  let admin;
  try { admin = getSupabaseAdmin(); } catch { return bad(500, 'Service not configured'); }
  let familyResult;
  try { familyResult = await resolveCustomerFamily(admin, portal); }
  catch (error) {
    console.error('[portal-data] credential resolution failed:', error?.message || error);
    return bad(500, 'Portal credential check failed');
  }
  if (familyResult.error) return bad(familyResult.notFound ? 403 : 500, familyResult.error);

  try {
    const { rows, range, count } = await loadRows(admin, config, familyResult, body);
    const total = Number.isInteger(count) ? count : '*';
    const contentRange = rows.length
      ? `${range.start}-${range.start + rows.length - 1}/${total}`
      : `*/${total}`;
    const headers = { ...CORS, 'Content-Range': contentRange };
    if (body.method === 'HEAD') return { statusCode: 200, headers, body: '' };
    if (String(body.accept || '').includes('application/vnd.pgrst.object+json')) {
      if (rows.length !== 1) return { statusCode: 406, headers, body: JSON.stringify({ code: 'PGRST116', message: 'Expected one row' }) };
      return { statusCode: 200, headers, body: JSON.stringify(rows[0]) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(rows) };
  } catch (error) {
    if (/^(Invalid|Unsupported|Too many)/.test(error.message || '')) return bad(400, error.message);
    console.error('[portal-data]', error);
    return bad(500, 'Portal data request failed');
  }
};

module.exports._test = { TABLES, loadRows, parseQuery, parseRange, scopeFor };
