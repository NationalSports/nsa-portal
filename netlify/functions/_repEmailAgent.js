const crypto = require('crypto');

const REP_ROLES = new Set(['rep', 'admin', 'super_admin']);
const CART_COMMANDS = new Set(['queue_cart', 'queue_cart_from_estimate', 'build_estimate_and_cart']);
const STOP_WORDS = new Set([
  'about', 'add', 'and', 'build', 'cart', 'click', 'customer', 'email', 'estimate',
  'for', 'forwarded', 'from', 'latest', 'order', 'please', 'process', 'ship',
  'shipping', 'status', 'the', 'this', 'to', 'when', 'will', 'with',
]);

function parseAddress(value) {
  const raw = String(value || '').trim();
  const angle = raw.match(/^(.*?)\s*<([^>]+)>$/);
  const email = angle ? angle[2] : (raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '');
  return {
    name: angle ? angle[1].replace(/^"|"$/g, '').trim() : '',
    email: String(email || '').trim().toLowerCase(),
  };
}

function extractForwardedMessage(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const marker = /(?:^|\n)(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*\n/i;
  const markerMatch = marker.exec(source);
  let instruction = '';
  let forwarded = '';

  if (markerMatch) {
    instruction = source.slice(0, markerMatch.index).trim();
    forwarded = source.slice(markerMatch.index + markerMatch[0].length).trim();
  } else {
    // Outlook-style forwards often start directly with a From/Sent/To/Subject block.
    const headerStart = /(?:^|\n)From:\s*.+\n(?:Sent|Date):\s*.+\nTo:\s*.+\n(?:Cc:\s*.+\n)?Subject:\s*.+(?:\n|$)/i.exec(source);
    if (!headerStart) {
      return {
        is_forwarded: false,
        instruction: source.trim(),
        original_sender_email: '',
        original_sender_name: '',
        original_subject: '',
        original_body: source.trim(),
      };
    }
    instruction = source.slice(0, headerStart.index).trim();
    forwarded = source.slice(headerStart.index + (source[headerStart.index] === '\n' ? 1 : 0)).trim();
  }

  const headerBlock = forwarded.match(/^([\s\S]{0,2500}?)(?:\n\s*\n|$)/)?.[1] || '';
  const fromValue = headerBlock.match(/^From:\s*(.+)$/im)?.[1] || '';
  const subject = headerBlock.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || '';
  const from = parseAddress(fromValue);
  const body = forwarded.slice(headerBlock.length).replace(/^\s+/, '').trim() || forwarded;

  return {
    is_forwarded: true,
    instruction,
    original_sender_email: from.email,
    original_sender_name: from.name,
    original_subject: subject,
    original_body: body,
  };
}

async function findAuthorizedRep(admin, email) {
  if (!email) return null;
  const { data, error } = await admin
    .from('team_members')
    .select('id,name,email,role,is_active')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false || !REP_ROLES.has(String(data.role || '').toLowerCase())) return null;
  return data;
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function searchTokens(value) {
  const raw = String(value || '');
  const tokens = normalized(raw).split(/\s+/).filter(Boolean);
  const upperAcronyms = raw.match(/\b[A-Z]{2,8}\b/g) || [];
  return [...new Set([
    ...upperAcronyms.map((x) => x.toLowerCase()),
    ...tokens.filter((x) => x.length >= 3 && !STOP_WORDS.has(x)),
  ])].slice(0, 20);
}

function textScore(haystack, tokens) {
  const h = ` ${normalized(haystack)} `;
  let score = 0;
  for (const token of tokens) {
    if (h.includes(` ${token} `)) score += token.length <= 4 ? 12 : 7;
    else if (h.includes(token)) score += 2;
  }
  return score;
}

async function resolvePortalContext(admin, input) {
  const searchable = [
    input.instruction,
    input.original_subject,
    input.original_body?.slice(0, 12000),
  ].filter(Boolean).join('\n');
  const tokens = searchTokens(searchable);
  let exactCustomerId = null;

  if (input.original_sender_email) {
    const { data: contact } = await admin
      .from('customer_contacts')
      .select('customer_id')
      .ilike('email', input.original_sender_email)
      .limit(1)
      .maybeSingle();
    exactCustomerId = contact?.customer_id || null;
  }

  const [
    { data: customers, error: customerError },
    { data: estimates, error: estimateError },
    { data: orders, error: orderError },
  ] = await Promise.all([
    admin.from('customers')
      .select('id,name,alpha_tag,parent_id,primary_rep_id,is_active')
      .eq('is_active', true)
      .limit(5000),
    admin.from('estimates')
      .select('id,customer_id,memo,status,created_at,updated_at,created_by')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    admin.from('sales_orders')
      .select('id,customer_id,estimate_id,memo,status,created_at,updated_at,expected_date,expected_ship_date,deliver_on_date,_shipping_status,_tracking_number,_carrier,_ship_date,_tracking_url,_shipped,po_number')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (customerError) throw customerError;
  if (estimateError) throw estimateError;
  if (orderError) throw orderError;

  const customerById = new Map((customers || []).map((x) => [x.id, x]));
  const candidateCustomers = (customers || []).map((customer) => {
    const exact = customer.id === exactCustomerId;
    const score = (exact ? 1000 : 0) + textScore(
      `${customer.name || ''} ${customer.alpha_tag || ''}`,
      tokens,
    );
    return { ...customer, match_score: score, match_reason: exact ? 'original_sender_email' : 'text' };
  }).filter((x) => x.match_score > 0)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 8);

  const recordScore = (row) => {
    const customer = customerById.get(row.customer_id) || {};
    return textScore(
      `${row.id || ''} ${row.memo || ''} ${row.po_number || ''} ${customer.name || ''} ${customer.alpha_tag || ''}`,
      tokens,
    ) + (row.customer_id === exactCustomerId ? 100 : 0);
  };

  const estimateMatches = (estimates || []).map((row) => ({
    ...row,
    customer_name: customerById.get(row.customer_id)?.name || '',
    customer_alpha_tag: customerById.get(row.customer_id)?.alpha_tag || '',
    match_score: recordScore(row),
  })).filter((x) => x.match_score > 0)
    .sort((a, b) => b.match_score - a.match_score || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 6);

  const orderMatches = (orders || []).map((row) => ({
    ...row,
    customer_name: customerById.get(row.customer_id)?.name || '',
    customer_alpha_tag: customerById.get(row.customer_id)?.alpha_tag || '',
    match_score: recordScore(row),
  })).filter((x) => x.match_score > 0)
    .sort((a, b) => b.match_score - a.match_score || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 6);

  if (estimateMatches.length) {
    const ids = estimateMatches.map((x) => x.id);
    const { data: items, error } = await admin
      .from('estimate_items')
      .select('estimate_id,product_id,sku,name,brand,color,vendor_id,nsa_cost,retail_price,unit_sell,sizes,notes')
      .in('estimate_id', ids)
      .order('item_index');
    if (error) throw error;
    const byEstimate = new Map();
    for (const item of items || []) {
      if (!byEstimate.has(item.estimate_id)) byEstimate.set(item.estimate_id, []);
      byEstimate.get(item.estimate_id).push(item);
    }
    estimateMatches.forEach((estimate) => { estimate.items = (byEstimate.get(estimate.id) || []).slice(0, 100); });
  }

  if (orderMatches.length) {
    const ids = orderMatches.map((x) => x.id);
    const [{ data: jobs }, { data: soItems }] = await Promise.all([
      admin.from('so_jobs')
        .select('so_id,art_name,art_status,item_status,prod_status,total_units,fulfilled_units,decorated_at,packed_at,notes')
        .in('so_id', ids),
      admin.from('so_items')
        .select('id,so_id,product_id,sku,name,brand,color,vendor_id,nsa_cost,retail_price,unit_sell,sizes,notes')
        .in('so_id', ids)
        .order('item_index'),
    ]);
    const itemIds = (soItems || []).map((x) => x.id);
    let poLines = [];
    if (itemIds.length) {
      const { data } = await admin.from('so_item_po_lines')
        .select('so_item_id,po_id,vendor,sizes,status,expected_date,tracking_numbers,shipments')
        .in('so_item_id', itemIds);
      poLines = data || [];
    }
    const itemById = new Map((soItems || []).map((x) => [x.id, x]));
    for (const order of orderMatches) {
      order.items = (soItems || []).filter((x) => x.so_id === order.id).slice(0, 100);
      order.jobs = (jobs || []).filter((x) => x.so_id === order.id).slice(0, 100);
      order.purchase_orders = poLines
        .filter((x) => itemById.get(x.so_item_id)?.so_id === order.id)
        .slice(0, 100);
    }
  }

  return {
    searched_at: new Date().toISOString(),
    search_tokens: tokens,
    exact_customer_id: exactCustomerId,
    customers: candidateCustomers,
    estimates: estimateMatches,
    orders: orderMatches,
  };
}

function cleanSizes(raw) {
  const out = {};
  for (const [size, qty] of Object.entries(raw || {})) {
    const n = Number(qty);
    if (Number.isFinite(n) && n > 0) out[size] = n;
  }
  return out;
}

function commandLines(message) {
  const parsed = Array.isArray(message?.analysis?.lines) ? message.analysis.lines : [];
  const recordId = message?.analysis?.command?.record_id || message?.command_payload?.record_id;
  const contextEstimates = message?.analysis?.portal_context?.estimates || [];
  const contextEstimate = contextEstimates.find((x) => recordId && x.id === recordId) || contextEstimates[0];
  const source = parsed.length ? parsed : (contextEstimate?.items || []);
  return source.map((line) => {
    const sizes = cleanSizes(line.sizes);
    return {
      product_id: line.product_id || null,
      sku: String(line.sku_guess || line.sku || '').trim(),
      name: line.name || '',
      brand: line.brand || '',
      color: line.color || '',
      vendor_id: line.vendor_id || null,
      qty: Object.values(sizes).reduce((sum, qty) => sum + qty, 0),
      sizes,
    };
  }).filter((line) => line.product_id && line.sku && line.qty > 0);
}

function cartPayloadForMessage(message) {
  if (!CART_COMMANDS.has(message?.command_type)) {
    throw new Error('This email does not contain a proposed cart command');
  }
  const lines = commandLines(message);
  if (!lines.length) throw new Error('No exact catalog lines with sizes are available for the cart');
  if (lines.length > 100) throw new Error('Cart commands are limited to 100 product lines');

  const unsupported = lines.filter((line) => !/adidas/i.test(`${line.brand} ${line.name}`));
  if (unsupported.length) {
    throw new Error(`CLICK cart currently supports Adidas lines only (${unsupported[0].sku} is not Adidas)`);
  }

  const recordId = message?.analysis?.command?.record_id || message?.command_payload?.record_id;
  const estimates = message?.analysis?.portal_context?.estimates || [];
  const orders = message?.analysis?.portal_context?.orders || [];
  const contextEstimate = estimates.find((x) => recordId && x.id === recordId) || estimates[0] || null;
  const contextOrder = orders.find((x) => recordId && x.id === recordId) || orders[0] || null;
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  return {
    task_type: 'add_to_cart',
    target: 'adidas_click',
    vendor_name: 'Adidas',
    po_number: contextOrder?.po_number || null,
    lines,
    totals: { line_count: lines.length, qty: totalQty },
    source_inbox_message_id: message.id,
    source_estimate_id: contextEstimate?.id || null,
    source_so_id: contextOrder?.id || null,
    requested_by_rep_id: message.submitted_by_id || null,
    approval_required: true,
  };
}

function newTodoId() {
  return `TODO-EMAIL-${crypto.randomUUID()}`;
}

module.exports = {
  CART_COMMANDS,
  parseAddress,
  extractForwardedMessage,
  findAuthorizedRep,
  resolvePortalContext,
  commandLines,
  cartPayloadForMessage,
  newTodoId,
};
