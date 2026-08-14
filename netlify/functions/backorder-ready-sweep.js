// Backorder ready sweep — turns "stock landed" into "decoration team knows".
//
// Scheduled every 30 min (netlify.toml [functions."backorder-ready-sweep"]).
// Works over the auto-PO needs ledger (teamshop_auto_po_needs, 00202 —
// club-enabled) which records every backordered (so_item, size) on converted
// Team Shop / club store orders. For each OPEN need (qty_needed > 0, SO not
// finished) the sweep:
//
//   1. Reads house warehouse stock (product_inventory) for the need's
//      (product_id, size) and allocates it FIFO by need age within that key —
//      two orders can never count the same physical units in one pass.
//   2. Stamps ready_qty / ready_at (00236) — a SIGNAL for the dashboard, not a
//      reservation; nothing here decrements or holds stock.
//   3. Refreshes expected_date for the still-short remainder from the vendor
//      feed (products.inventory_source → inventory_unified.future_delivery_date,
//      size-matched when the feed carries sizes).
//   4. Emails the decoration team (teamshop_settings.backorder_alert_email;
//      empty = dashboard-only) every need whose coverage INCREASED since the
//      last alert — so a partial arrival alerts once, and the remainder alerts
//      again when it lands. notified_ready_qty/ready_notified_at record the
//      high-water mark; consumed stock lowers it so a re-arrival re-alerts.
//
// Release itself stays owned by the existing paths (auto-release sweep /
// Production HQ scan through the 00205 gate) — this sweep only surfaces and
// notifies. It NEVER throws: scheduled runs always return 200 with a summary.
// Staff can also POST { action:'run' } to force a pass, or { action:'list' }
// for the Backorders dashboard rows (TeamShopQueue).
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const SWEEP_ACTOR = 'backorder-sweep';
// SO statuses that mean the order is finished — its needs are no longer open.
const SO_DONE = ['complete', 'completed', 'done', 'cancelled', 'void', 'archived'];

const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });
const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error, ...(extra || {}) }) });

const isMissingRelation = (e) => {
  if (!e) return false;
  const code = e.code || '';
  const msg = (e.message || '') + ' ' + (e.details || '') + ' ' + (e.hint || '');
  return code === '42P01' || code === '42703' || code === '42883' || /does not exist|could not find|schema cache/i.test(msg);
};

// ── Pure: FIFO allocation (unit-tested directly) ─────────────────────────────
// needs: [{ id, product_id, size, qty_needed, created_at, ... }] — open needs only.
// stock: { '<product_id>|<size>': qty } — house on-hand snapshot.
// Returns Map need.id -> ready qty (0..qty_needed). Oldest need per key first;
// units allocated to one need are gone for the next, so a pass never promises
// the same shirt to two orders.
function allocateReady(needs, stock) {
  const pool = { ...stock };
  const out = new Map();
  const sorted = [...needs].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  for (const n of sorted) {
    const key = (n.product_id || '') + '|' + (n.size || '');
    const have = Math.max(0, Number(pool[key]) || 0);
    const ready = Math.min(have, Math.max(0, Number(n.qty_needed) || 0));
    out.set(n.id, ready);
    pool[key] = have - ready;
  }
  return out;
}

// ── Pure: which rows alert (coverage increased past the last alert) ──────────
function alertRows(needs, readyById) {
  return needs
    .map((n) => ({ ...n, _ready: readyById.get(n.id) || 0 }))
    .filter((n) => n._ready > (Number(n.notified_ready_qty) || 0));
}

// ── Pure: digest HTML (grouped by SO) ────────────────────────────────────────
function buildDigestHtml(groups) {
  const cell = 'padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px';
  const blocks = groups.map((g) => {
    const rows = g.rows.map((r) => `<tr>
      <td style="${cell}">${r.sku || r.product_id || ''}</td>
      <td style="${cell}">${r.size}</td>
      <td style="${cell};text-align:right">${r._ready} of ${r.qty_needed}</td>
      <td style="${cell}">${r._ready >= r.qty_needed ? 'ALL IN — ready to decorate' : 'partial — can start ' + r._ready}</td>
    </tr>`).join('');
    return `<h3 style="font-size:14px;margin:18px 0 6px">${g.so_id}${g.store_name ? ' — ' + g.store_name : ''}</h3>
    <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="${cell};text-align:left">SKU</th><th style="${cell};text-align:left">Size</th>
      <th style="${cell};text-align:right">In / needed</th><th style="${cell};text-align:left">Status</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="font-size:16px">Backordered goods are in</h2>
    <p style="font-size:13px">Warehouse stock now covers the backordered units below (FIFO by order age).
    Release still goes through Production HQ — this is the heads-up so they go out fast.</p>
    ${blocks}
    <p style="font-size:11px;color:#94a3b8;margin-top:18px">NSA backorder sweep — see the Backorders tab in the Team Shop queue for live state.</p>
  </div>`;
}

async function sendDigestEmail(toEmail, groups) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) { console.error('[backorder-ready-sweep] BREVO_API_KEY missing — cannot email digest'); return false; }
  const orders = groups.length;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Production', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: toEmail }],
      subject: `Backordered goods in — ${orders} order${orders === 1 ? '' : 's'} ready to decorate`,
      htmlContent: buildDigestHtml(groups),
    }),
  });
  if (!res.ok) { console.error('[backorder-ready-sweep] Brevo digest send failed:', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

// ── Shared loaders ───────────────────────────────────────────────────────────
// Open needs = qty_needed > 0 on an SO that isn't finished. Returns { needs,
// soInfo } where soInfo maps so_id -> { memo, status, webstore_id, store_name }.
async function loadOpenNeeds(admin, limit) {
  const needsRes = await admin.from('teamshop_auto_po_needs')
    .select('id, so_id, so_item_id, product_id, sku, size, qty_ordered, qty_needed, vendor, po_id, skip_reason, created_at, ready_qty, ready_at, notified_ready_qty, ready_notified_at, expected_date')
    .gt('qty_needed', 0)
    .order('created_at', { ascending: true })
    .limit(limit || 1000);
  if (needsRes.error) return { error: needsRes.error };
  let needs = needsRes.data || [];
  if (!needs.length) return { needs: [], soInfo: {} };

  const soIds = [...new Set(needs.map((n) => n.so_id).filter(Boolean))];
  const soRes = await admin.from('sales_orders').select('id, memo, status, webstore_id').in('id', soIds);
  if (soRes.error) return { error: soRes.error };
  const soInfo = {};
  (soRes.data || []).forEach((s) => { soInfo[s.id] = { memo: s.memo, status: s.status, webstore_id: s.webstore_id, store_name: '' }; });

  const storeIds = [...new Set((soRes.data || []).map((s) => s.webstore_id).filter(Boolean))];
  if (storeIds.length) {
    const stRes = await admin.from('webstores').select('id, name').in('id', storeIds);
    const byId = {};
    ((stRes.error ? [] : stRes.data) || []).forEach((w) => { byId[w.id] = w.name; });
    Object.values(soInfo).forEach((s) => { s.store_name = byId[s.webstore_id] || ''; });
  }

  // A finished/cancelled SO's needs are closed — exclude from open work.
  needs = needs.filter((n) => {
    const s = soInfo[n.so_id];
    return !s || !SO_DONE.includes(String(s.status || '').toLowerCase());
  });
  return { needs, soInfo };
}

// Vendor-feed expected dates for still-short needs: products.inventory_source
// routes each product to its feed; inventory_unified rows (sku+source,
// size-matched when present) carry future_delivery_date.
async function loadExpectedDates(admin, needs) {
  const out = new Map(); // need.id -> 'YYYY-MM-DD' | null
  const pids = [...new Set(needs.map((n) => n.product_id).filter(Boolean))];
  if (!pids.length) return out;
  const prodRes = await admin.from('products').select('id, sku, inventory_source').in('id', pids);
  if (prodRes.error) return out;
  const srcByPid = {}; const skuByPid = {};
  (prodRes.data || []).forEach((p) => { srcByPid[p.id] = p.inventory_source || null; skuByPid[p.id] = p.sku || null; });

  const skus = [...new Set(needs.map((n) => n.sku || skuByPid[n.product_id]).filter(Boolean))];
  if (!skus.length) return out;
  const invRes = await admin.from('inventory_unified')
    .select('sku, size, source, future_delivery_date').in('sku', skus).limit(5000);
  if (invRes.error) return out;
  const feed = invRes.data || [];
  for (const n of needs) {
    const sku = n.sku || skuByPid[n.product_id];
    const src = srcByPid[n.product_id];
    if (!sku || !src) continue;
    const rows = feed.filter((r) => r.sku === sku && r.source === src && r.future_delivery_date);
    if (!rows.length) continue;
    const sized = rows.find((r) => (r.size || '') === (n.size || ''));
    out.set(n.id, (sized || rows[0]).future_delivery_date);
  }
  return out;
}

// ── Transfer low-stock check (00238) ─────────────────────────────────────────
// Heat-transfer inventory below the transfers UI's amber threshold with nothing
// incoming, on OPEN stores only — emailed on the same ops channel, throttled to
// once per week per row. Email-only: with no alert address configured this is a
// no-op (the transfers page already shows the amber state in-app).
const LOW_STOCK_THRESHOLD = 10; // mirrors the transfers UI amber rule (Avail < 10)

function buildLowStockHtml(groups) {
  const cell = 'padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px';
  const blocks = groups.map((g) => {
    const rows = g.rows.map((t) => `<tr>
      <td style="${cell}">${t.label || t.code}</td>
      <td style="${cell}">${t.kind === 'number' ? ('#' + (t.digit != null ? t.digit : '') + ' ' + (t.tsize || '') + ' ' + (t.color || '')).trim() : 'design'}</td>
      <td style="${cell};text-align:right">${Number(t.on_hand) || 0}</td>
    </tr>`).join('');
    return `<h3 style="font-size:14px;margin:18px 0 6px">${g.store_name}</h3>
    <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="${cell};text-align:left">Transfer</th><th style="${cell};text-align:left">Variant</th>
      <th style="${cell};text-align:right">On hand</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="font-size:16px">Heat transfers running low</h2>
    <p style="font-size:13px">These transfers are under ${LOW_STOCK_THRESHOLD} on hand with nothing on order from the supplier. Reorder before club orders pull into a shortfall.</p>
    ${blocks}
    <p style="font-size:11px;color:#94a3b8;margin-top:18px">NSA backorder sweep — throttled to one alert per transfer per week.</p>
  </div>`;
}

async function checkTransferLowStock(admin, toEmail) {
  const res = await admin.from('webstore_transfers')
    .select('id, store_id, code, label, kind, tsize, color, digit, on_hand, incoming, low_stock_notified_at')
    .lt('on_hand', LOW_STOCK_THRESHOLD)
    .limit(2000);
  if (res.error) {
    if (isMissingRelation(res.error)) return 0;
    throw new Error(res.error.message);
  }
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  let rows = (res.data || [])
    .filter((t) => !(Number(t.incoming) > 0))
    .filter((t) => !t.low_stock_notified_at || new Date(t.low_stock_notified_at).getTime() < cutoff);
  if (!rows.length) return 0;

  // Open stores only — a closed store's leftover transfer stock isn't actionable.
  const storeIds = [...new Set(rows.map((t) => t.store_id).filter(Boolean))];
  const stRes = await admin.from('webstores').select('id, name, status').in('id', storeIds);
  const stores = {};
  ((stRes.error ? [] : stRes.data) || []).forEach((w) => { stores[w.id] = w; });
  rows = rows.filter((t) => { const w = stores[t.store_id]; return w && w.status === 'open'; });
  if (!rows.length) return 0;

  const byStore = new Map();
  for (const t of rows) {
    if (!byStore.has(t.store_id)) byStore.set(t.store_id, { store_name: (stores[t.store_id] || {}).name || t.store_id, rows: [] });
    byStore.get(t.store_id).rows.push(t);
  }

  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) { console.error('[backorder-ready-sweep] BREVO_API_KEY missing — cannot email low-stock alert'); return 0; }
  const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Production', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: toEmail }],
      subject: `Heat transfers running low — ${rows.length} item${rows.length === 1 ? '' : 's'} to reorder`,
      htmlContent: buildLowStockHtml([...byStore.values()]),
    }),
  });
  if (!sendRes.ok) { console.error('[backorder-ready-sweep] Brevo low-stock send failed:', sendRes.status, await sendRes.text().catch(() => '')); return 0; }

  const nowIso = new Date().toISOString();
  for (const t of rows) {
    await admin.from('webstore_transfers').update({ low_stock_notified_at: nowIso }).eq('id', t.id);
  }
  return rows.length;
}

// ── The sweep ────────────────────────────────────────────────────────────────
async function runSweep(admin, actor) {
  const summary = { ok: true, open: 0, ready_rows: 0, alerted: 0, emailed: false, transfer_low: 0, errors: [] };

  // Alert channel (shared by the backorder digest and the low-stock alert).
  let alertEmail = null;
  try {
    const setRes = await admin.from('teamshop_settings').select('backorder_alert_email').eq('id', 'global').maybeSingle();
    if (!setRes.error && setRes.data) alertEmail = (setRes.data.backorder_alert_email || '').trim() || null;
  } catch (_) { /* settings are optional */ }

  const loaded = await loadOpenNeeds(admin, 1000);
  if (loaded.error) {
    if (isMissingRelation(loaded.error)) return { ok: true, enabled: false, note: 'auto-PO migration (00202/00236) not applied' };
    return { ok: false, error: loaded.error.message };
  }
  const { needs, soInfo } = loaded;
  summary.open = needs.length;
  if (!needs.length) {
    if (alertEmail) {
      try { summary.transfer_low = await checkTransferLowStock(admin, alertEmail); }
      catch (e) { summary.errors.push('low-stock: ' + (e.message || String(e))); }
    }
    return summary;
  }

  // House stock snapshot for every (product, size) in play.
  const stock = {};
  const stockPids = [...new Set(needs.map((n) => n.product_id).filter(Boolean))];
  if (stockPids.length) {
    const invRes = await admin.from('product_inventory').select('product_id, size, quantity').in('product_id', stockPids);
    if (invRes.error) summary.errors.push('product_inventory: ' + invRes.error.message);
    else (invRes.data || []).forEach((r) => { stock[(r.product_id || '') + '|' + (r.size || '')] = Math.max(0, Number(r.quantity) || 0); });
  }

  const readyById = allocateReady(needs, stock);
  const expected = await loadExpectedDates(admin, needs.filter((n) => (readyById.get(n.id) || 0) < n.qty_needed));
  const toAlert = alertRows(needs, readyById);
  const nowIso = new Date().toISOString();

  // Stamp sweep-owned state. Alert stamps are written AFTER the digest attempt
  // so a failed email retries next pass (high-water mark unchanged).
  for (const n of needs) {
    const ready = readyById.get(n.id) || 0;
    const patch = {};
    if (ready !== (Number(n.ready_qty) || 0)) patch.ready_qty = ready;
    if (ready > 0 && !n.ready_at) patch.ready_at = nowIso;
    // Stock got used before decorating: lower the high-water mark so a
    // re-arrival re-alerts.
    if (ready < (Number(n.notified_ready_qty) || 0)) patch.notified_ready_qty = ready;
    const exp = expected.get(n.id);
    if (exp && exp !== n.expected_date) patch.expected_date = exp;
    if (Object.keys(patch).length) {
      const up = await admin.from('teamshop_auto_po_needs').update(patch).eq('id', n.id);
      if (up.error) summary.errors.push('need ' + n.id + ': ' + up.error.message);
    }
  }
  summary.ready_rows = needs.filter((n) => (readyById.get(n.id) || 0) > 0).length;

  if (toAlert.length) {
    summary.alerted = toAlert.length;
    // Group by SO for the digest.
    const bySo = new Map();
    for (const r of toAlert) {
      if (!bySo.has(r.so_id)) bySo.set(r.so_id, { so_id: r.so_id, store_name: (soInfo[r.so_id] || {}).store_name || '', rows: [] });
      bySo.get(r.so_id).rows.push(r);
    }
    const groups = [...bySo.values()];

    let emailed = false;
    if (alertEmail) {
      try { emailed = await sendDigestEmail(alertEmail, groups); }
      catch (e) { summary.errors.push('digest: ' + (e.message || String(e))); }
    }
    summary.emailed = emailed;

    // Mark notified when the digest landed, or when no email is configured
    // (dashboard-only mode: the stamped ready state IS the notification).
    if (emailed || !alertEmail) {
      for (const r of toAlert) {
        const up = await admin.from('teamshop_auto_po_needs')
          .update({ notified_ready_qty: r._ready, ready_notified_at: nowIso })
          .eq('id', r.id);
        if (up.error) summary.errors.push('notify ' + r.id + ': ' + up.error.message);
      }
    }
  }

  if (alertEmail) {
    try { summary.transfer_low = await checkTransferLowStock(admin, alertEmail); }
    catch (e) { summary.errors.push('low-stock: ' + (e.message || String(e))); }
  }

  console.log(`[backorder-ready-sweep] actor=${actor} open=${summary.open} ready=${summary.ready_rows} alerted=${summary.alerted} emailed=${summary.emailed} transfer_low=${summary.transfer_low} errors=${summary.errors.length}`);
  return summary;
}

// ── Dashboard rows (staff) ───────────────────────────────────────────────────
async function listBackorders(admin) {
  const loaded = await loadOpenNeeds(admin, 500);
  if (loaded.error) {
    if (isMissingRelation(loaded.error)) return ok({ ok: true, enabled: false, rows: [] });
    return bad(500, loaded.error.message);
  }
  const { needs, soInfo } = loaded;

  const poIds = [...new Set(needs.map((n) => n.po_id).filter(Boolean))];
  const poById = {};
  if (poIds.length) {
    const poRes = await admin.from('purchase_orders').select('id, po_number, status, submitted_at').in('id', poIds);
    ((poRes.error ? [] : poRes.data) || []).forEach((p) => { poById[p.id] = p; });
  }

  const rows = needs.map((n) => {
    const so = soInfo[n.so_id] || {};
    const po = n.po_id ? (poById[n.po_id] || null) : null;
    return {
      id: n.id, so_id: n.so_id, store_name: so.store_name || '', memo: so.memo || '',
      product_id: n.product_id, sku: n.sku, size: n.size,
      qty_needed: n.qty_needed, ready_qty: n.ready_qty || 0,
      expected_date: n.expected_date || null, ready_at: n.ready_at || null,
      vendor: n.vendor || null, skip_reason: n.skip_reason || null,
      po_number: po ? po.po_number : null, po_status: po ? (po.submitted_at ? 'submitted' : po.status) : null,
      created_at: n.created_at,
    };
  });
  return ok({ ok: true, rows });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Scheduled invocation (no auth — same posture as teamshop-auto-release).
  if (!event || event.httpMethod !== 'POST') {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Service not configured' }) }; }
    try {
      const r = await runSweep(admin, 'schedule');
      return { statusCode: 200, headers, body: JSON.stringify(r) };
    } catch (e) {
      console.error('[backorder-ready-sweep] scheduled run failed:', e.message || e);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
    }
  }

  try {
    const auth = await verifyUser(event);
    if (!auth.ok) return bad(auth.status || 401, auth.error || 'Unauthorized');
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    if (body.action === 'list') return await listBackorders(admin);
    if (body.action === 'run') return ok(await runSweep(admin, auth.teamMemberId || 'staff'));
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[backorder-ready-sweep] error:', e);
    return bad(500, e.message || 'Backorder sweep failed');
  }
};

// ── Test surface (src/__tests__/backorderReadySweep.test.js) ─────────────────
module.exports.allocateReady = allocateReady;
module.exports.alertRows = alertRows;
module.exports.buildDigestHtml = buildDigestHtml;
module.exports.runSweep = runSweep;
module.exports.listBackorders = listBackorders;
module.exports.checkTransferLowStock = checkTransferLowStock;
module.exports.buildLowStockHtml = buildLowStockHtml;
