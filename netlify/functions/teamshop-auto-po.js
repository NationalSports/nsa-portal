// Team Shop auto-purchase-order engine (Phase 3, migration 00202).
//
// When a paid Team Shop order is converted to a Sales Order
// (create_teamshop_sales_order, 00196/00199), this module evaluates which
// blank garments must be bought and creates DRAFT purchase orders per
// supplier through the EXISTING idempotent 00193 create_purchase_order RPC.
// It never talks to a supplier API — auto-submit is a later pass, gated by
// teamshop_auto_po_settings.auto_submit_enabled (seeded FALSE). Staff review
// the drafts in the Team Shop queue's Auto POs tab and mark them submitted
// after keying/sending the order themselves.
//
// Needs math (money path — over-ordering is the fail-safe direction):
//   * qty_needed = ordered qty (so_items.sizes) − NSA's OWN warehouse on-hand
//     (product_inventory), allocated once per (product,size) across items so
//     shared stock is never double-counted.
//   * Supplier stock (inventory_unified: click/agron/ua/nike/sanmar/
//     ss_activewear/momentec/richardson) is snapshotted per line as
//     INFORMATIONAL data (vendor_stock_qty / vendor_synced_at) — a supplier
//     having stock doesn't reduce what we must buy from them.
//   * If warehouse stock data is missing/unreadable, on-hand is treated as 0
//     (everything needs ordering) and the result says so.
//   * Costs come from products.size_costs (per-size, 011) falling back to
//     products.nsa_cost, converted to INTEGER CENTS (00193 convention).
//   * Vendor routing = products.inventory_source → teamshop_auto_po_settings
//     .inventory_sources. Unmapped sources (agron, richardson, manual, null,
//     custom items) are recorded as skip_reason='no_vendor_mapping' for the
//     staff manual-ordering list — never silently dropped.
//
// Idempotency (same converted order can NEVER double-order):
//   1. client_ref = 'tsauto:<so_id>:<vendor>' — 00193 replays an existing
//      client_ref and returns the existing PO, adding no lines.
//   2. teamshop_auto_po_needs rows are the evaluated marker: any row for the
//      so_id short-circuits generateForSo with replayed:true (zero-need
//      orders included, so a later stock change can't turn a re-fire into a
//      surprise order).
//   3. The needs upsert ignores duplicates on (so_id, so_item_id, size).
//   Two concurrent callers (convert_order + stripe-webhook) may both pass the
//   marker check; the client_ref unique index makes the loser a replay.
//
// Callers:
//   * generateForSo(admin, soId, actor) — required directly (best-effort) by
//     teamshop-checkout convert_order, stripe-webhook, and teamshop-po-review
//     approve, right after a successful conversion.
//   * HTTP handler (staff JWT via _shared.verifyUser, same as
//     teamshop-po-review): list | generate | sweep | mark_submitted.
//
// Degrades gracefully pre-migration: a missing table/RPC returns
// { enabled:false } so the queue UI shows a banner, never a blank page.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const AUTO_ACTOR_FALLBACK = 'teamshop-auto';
const SWEEP_LIMIT = 25;

// Postgres "relation/column/function does not exist" or PostgREST schema-cache
// miss — the 00193/00202 migrations aren't applied to this DB yet. Same
// detection shape TeamShopQueue.js uses.
const isMissingRelation = (e) => {
  if (!e) return false;
  const code = e.code || '';
  const msg = (e.message || '') + ' ' + (e.details || '') + ' ' + (e.hint || '');
  return code === '42P01' || code === '42703' || code === '42883' || /does not exist|could not find|schema cache/i.test(msg);
};

// ── Pure needs computation (unit-tested directly) ─────────────────────
// Inputs are plain row arrays; output is { needs, vendorGroups, notes }.
//   soItems     — so_items rows: { id, item_index, product_id, sku, sizes, is_custom }
//   products    — products rows: { id, sku, inventory_source, nsa_cost, size_costs }
//   inventory   — product_inventory rows: { product_id, size, quantity }  (NSA warehouse)
//   settings    — teamshop_auto_po_settings rows: { vendor, inventory_sources, supplier_account, min_order_cents }
//   vendorStock — inventory_unified rows: { sku, size, stock_qty, last_synced, source }
function computeNeeds({ soItems, products, inventory, settings, vendorStock }) {
  const productById = {};
  (products || []).forEach((p) => { productById[p.id] = p; });

  const vendorBySource = {};
  const settingByVendor = {};
  (settings || []).forEach((s) => {
    settingByVendor[s.vendor] = s;
    (s.inventory_sources || []).forEach((src) => { vendorBySource[src] = s.vendor; });
  });

  // Remaining warehouse on-hand per (product, size) — mutated as items claim
  // it, so two SO lines sharing a product+size never both subtract the same
  // units (under-ordering is the dangerous direction).
  const onHand = {};
  (inventory || []).forEach((r) => {
    const k = (r.product_id || '') + '\u0000' + String(r.size || '').trim().toUpperCase();
    onHand[k] = (onHand[k] || 0) + (Number(r.quantity) || 0);
  });

  const stockByKey = {};
  (vendorStock || []).forEach((r) => {
    stockByKey[(r.source || '') + '\u0000' + (r.sku || '') + '\u0000' + String(r.size || '').trim().toUpperCase()] = r;
  });

  const needs = [];
  const vendorGroups = {}; // vendor -> { lines, totals_cents, supplier_account, min_order_cents }
  const items = (soItems || []).slice().sort((a, b) => (a.item_index || 0) - (b.item_index || 0));

  for (const it of items) {
    const product = it.product_id ? productById[it.product_id] : null;
    const source = product ? (product.inventory_source || null) : null;
    const vendor = (!it.is_custom && source && vendorBySource[source]) || null;
    const sizes = it.sizes && typeof it.sizes === 'object' ? it.sizes : {};

    for (const [size, rawQty] of Object.entries(sizes)) {
      const qty = Math.max(0, Math.round(Number(rawQty) || 0));
      if (qty <= 0) continue;
      const sizeKey = String(size).trim().toUpperCase();
      const invKey = (it.product_id || '') + '\u0000' + sizeKey;
      const take = it.product_id ? Math.min(onHand[invKey] || 0, qty) : 0;
      if (take > 0) onHand[invKey] -= take;
      const needed = qty - take;

      // Per-size cost (011 size_costs) falling back to nsa_cost — dollars in
      // the products table, INTEGER CENTS everywhere downstream (00193).
      const sizeCosts = product && product.size_costs && typeof product.size_costs === 'object' ? product.size_costs : {};
      const dollarCost = Number(sizeCosts[size] != null ? sizeCosts[size] : (product ? product.nsa_cost : 0)) || 0;
      const unitCostCents = Math.round(dollarCost * 100);

      const vs = source ? stockByKey[source + '\u0000' + (it.sku || (product && product.sku) || '') + '\u0000' + sizeKey] : null;

      const row = {
        so_item_id: it.id,
        product_id: it.product_id || null,
        sku: it.sku || (product && product.sku) || null,
        size,
        qty_ordered: qty,
        qty_on_hand: take,
        qty_needed: needed,
        vendor,
        unit_cost_cents: unitCostCents,
        vendor_stock_qty: vs ? (Number(vs.stock_qty) || 0) : null,
        vendor_synced_at: vs ? (vs.last_synced || null) : null,
        skip_reason: needed === 0 ? 'in_stock' : (vendor ? null : 'no_vendor_mapping'),
      };
      needs.push(row);

      if (needed > 0 && vendor) {
        const setting = settingByVendor[vendor] || {};
        const g = vendorGroups[vendor] || (vendorGroups[vendor] = {
          lines: [], totals_cents: 0,
          supplier_account: setting.supplier_account || null,
          min_order_cents: setting.min_order_cents != null ? Number(setting.min_order_cents) : null,
        });
        g.lines.push({
          so_item_id: String(it.id),
          product_id: row.product_id,
          sku: row.sku,
          size,
          qty: needed,
          unit_cost_cents: unitCostCents,
          meta: {
            inventory_source: source,
            qty_ordered: qty,
            qty_on_hand: take,
            vendor_stock_qty: row.vendor_stock_qty,
            vendor_synced_at: row.vendor_synced_at,
          },
        });
        g.totals_cents += needed * unitCostCents;
      }
    }
  }

  return { needs, vendorGroups };
}

// ── Generator (idempotent; safe to fire any number of times) ─────────
async function generateForSo(admin, soId, actor) {
  const so = String(soId || '').trim();
  if (!so) return { ok: false, error: 'so_id required' };

  // Evaluated marker: any needs row for this SO means a prior run finished
  // (or recorded its evaluation) — return the POs it linked, change nothing.
  const probe = await admin.from('teamshop_auto_po_needs')
    .select('id,po_id').eq('so_id', so).limit(1000);
  if (probe.error) {
    if (isMissingRelation(probe.error)) return { ok: false, enabled: false, error: 'auto-PO migration (00202) not applied' };
    return { ok: false, error: probe.error.message };
  }
  if (probe.data && probe.data.length) {
    return { ok: true, replayed: true, so_id: so, po_ids: [...new Set(probe.data.map((r) => r.po_id).filter(Boolean))] };
  }

  // Team Shop guard: only SOs born from a teamshop webstore order.
  const ordRes = await admin.from('webstore_orders')
    .select('id,order_source').eq('so_id', so).limit(1);
  if (ordRes.error) return { ok: false, error: ordRes.error.message };
  const ord = ordRes.data && ordRes.data[0];
  if (!ord || ord.order_source !== 'teamshop') return { ok: false, error: 'Not a converted Team Shop order.' };

  const itemsRes = await admin.from('so_items')
    .select('id,item_index,product_id,sku,sizes,is_custom').eq('so_id', so).order('item_index');
  if (itemsRes.error) return { ok: false, error: itemsRes.error.message };
  const soItems = itemsRes.data || [];
  if (!soItems.length) return { ok: true, so_id: so, pos: [], needs_rows: 0, note: 'no items' };

  const settingsRes = await admin.from('teamshop_auto_po_settings').select('*');
  if (settingsRes.error) {
    if (isMissingRelation(settingsRes.error)) return { ok: false, enabled: false, error: 'auto-PO migration (00202) not applied' };
    return { ok: false, error: settingsRes.error.message };
  }

  const productIds = [...new Set(soItems.map((i) => i.product_id).filter(Boolean))];
  const skus = [...new Set(soItems.map((i) => i.sku).filter(Boolean))];
  const [prodRes, invRes, vsRes] = await Promise.all([
    productIds.length
      ? admin.from('products').select('id,sku,inventory_source,nsa_cost,size_costs').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? admin.from('product_inventory').select('product_id,size,quantity').in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    skus.length
      ? admin.from('inventory_unified').select('sku,size,stock_qty,last_synced,source').in('sku', skus)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (prodRes.error) return { ok: false, error: prodRes.error.message };
  // Stock data is best-effort by design: unreadable warehouse stock = treat
  // on-hand as 0 (order everything, the fail-safe direction) and say so.
  const notes = [];
  if (invRes.error) notes.push('warehouse stock unreadable (' + invRes.error.message + ') — treated all quantities as needs-ordering');
  if (vsRes.error) notes.push('supplier stock snapshot unavailable (' + vsRes.error.message + ')');

  const { needs, vendorGroups } = computeNeeds({
    soItems,
    products: prodRes.data || [],
    inventory: invRes.error ? [] : (invRes.data || []),
    settings: settingsRes.data || [],
    vendorStock: vsRes.error ? [] : (vsRes.data || []),
  });

  // One draft PO per vendor through the 00193 RPC. client_ref makes any
  // replay/race collapse onto the same PO with the same lines.
  const created = [];
  const poIdByVendor = {};
  for (const [vendor, g] of Object.entries(vendorGroups)) {
    const clientRef = 'tsauto:' + so + ':' + vendor;
    const rpc = await admin.rpc('create_purchase_order', {
      p_client_ref: clientRef,
      p_po: {
        vendor,
        supplier_account: g.supplier_account,
        status: 'draft',
        origin: 'auto',
        created_by: actor || AUTO_ACTOR_FALLBACK,
        totals_cents: g.totals_cents,
        threshold_eval: {
          so_id: so,
          lines: g.lines.length,
          totals_cents: g.totals_cents,
          min_order_cents: g.min_order_cents,
          meets_min: g.min_order_cents == null || g.totals_cents >= g.min_order_cents,
          on_hand_source: 'product_inventory',
          notes,
        },
      },
      p_lines: g.lines.map((l) => ({ ...l, so_id: so })),
    });
    if (rpc.error) {
      if (isMissingRelation(rpc.error)) return { ok: false, enabled: false, error: 'purchase-order migration (00193) not applied' };
      // Leave NO needs rows behind: the evaluated marker must only exist once
      // every vendor PO exists, so a retry re-runs the whole (replay-safe) set.
      return { ok: false, error: 'create_purchase_order failed for ' + vendor + ': ' + rpc.error.message };
    }
    const po = rpc.data && rpc.data.purchase_order;
    if (po && po.id) poIdByVendor[vendor] = po.id;
    created.push({
      vendor,
      po_id: po ? po.id : null,
      po_number: po ? po.po_number : null,
      replayed: !!(rpc.data && rpc.data.replayed),
      lines: g.lines.length,
      totals_cents: g.totals_cents,
    });
  }

  // Record the evaluation (marker + audit). ignoreDuplicates: a concurrent
  // run that lost the client_ref race may have inserted these already.
  const rows = needs.map((n) => ({
    ...n,
    so_id: so,
    po_id: (n.vendor && n.qty_needed > 0 && poIdByVendor[n.vendor]) || null,
  }));
  if (rows.length) {
    const up = await admin.from('teamshop_auto_po_needs')
      .upsert(rows, { onConflict: 'so_id,so_item_id,size', ignoreDuplicates: true });
    if (up.error) return { ok: false, error: 'needs recording failed: ' + up.error.message, pos: created };
  }

  return {
    ok: true,
    replayed: false,
    so_id: so,
    pos: created,
    needs_rows: rows.length,
    unmapped: needs.filter((n) => n.skip_reason === 'no_vendor_mapping').length,
    ...(notes.length ? { notes } : {}),
  };
}

// Best-effort wrapper for the conversion-flow hooks: never throws, logs any
// real failure (enabled:false — migration not applied yet — is an expected
// quiet no-op). One implementation so the three call sites can't drift.
async function generateForSoSafe(admin, soId, actor, tag) {
  try {
    const r = await generateForSo(admin, soId, actor);
    if (r && r.ok === false && r.enabled !== false) {
      console.error('[' + tag + '] auto-PO generation failed for ' + soId + ' (sweep from the Auto POs tab):', r.error);
    }
    return r;
  } catch (e) {
    console.error('[' + tag + '] auto-PO generation error for ' + soId + ':', e.message || String(e));
    return { ok: false, error: e.message || String(e) };
  }
}

// ── Staff actions ────────────────────────────────────────────────────
async function listAutoPos(admin) {
  const posRes = await admin.from('purchase_orders')
    .select('id,client_ref,po_number,vendor,supplier_account,status,origin,totals_cents,created_by,created_at,submitted_at,submitted_by,threshold_eval')
    .eq('origin', 'auto')
    .order('created_at', { ascending: false })
    .limit(100);
  if (posRes.error) {
    if (isMissingRelation(posRes.error)) return ok({ ok: true, enabled: false, pos: [], unmapped: [] });
    return bad(500, posRes.error.message);
  }
  const pos = posRes.data || [];
  const poIds = pos.map((p) => p.id);
  const linesRes = poIds.length
    ? await admin.from('purchase_order_lines')
        .select('id,po_id,so_id,so_item_id,sku,size,qty,unit_cost_cents,meta').in('po_id', poIds)
    : { data: [], error: null };
  if (linesRes.error) return bad(500, linesRes.error.message);
  const linesByPo = {};
  (linesRes.data || []).forEach((l) => { (linesByPo[l.po_id] = linesByPo[l.po_id] || []).push(l); });

  // Lines the engine could NOT route to a supplier — staff order these by hand.
  const unmappedRes = await admin.from('teamshop_auto_po_needs')
    .select('so_id,sku,size,qty_needed,created_at')
    .eq('skip_reason', 'no_vendor_mapping')
    .order('created_at', { ascending: false })
    .limit(200);
  const unmapped = unmappedRes.error ? [] : (unmappedRes.data || []);

  const settingsRes = await admin.from('teamshop_auto_po_settings').select('vendor,auto_submit_enabled,inventory_sources,min_order_cents');

  return ok({
    ok: true,
    enabled: true,
    pos: pos.map((p) => ({ ...p, lines: linesByPo[p.id] || [] })),
    unmapped,
    settings: settingsRes.error ? [] : (settingsRes.data || []),
  });
}

// Mark a DRAFT auto-PO as submitted to the supplier (staff keyed/sent it
// manually). Compare-and-set on status so two tabs can't double-mark; records
// who and when. Writes go through the service role (00193: no client write
// policy on purchase_orders).
async function markSubmitted(admin, body, staff) {
  const poId = String(body.po_id || '').trim();
  if (!poId) return bad(400, 'po_id required');
  const upd = await admin.from('purchase_orders')
    .update({
      status: 'created',
      submitted_at: new Date().toISOString(),
      submitted_by: (staff && staff.teamMemberId) || 'staff',
    })
    .eq('id', poId).eq('status', 'draft')
    .select('id,status,submitted_at,submitted_by');
  if (upd.error) {
    if (isMissingRelation(upd.error)) return bad(409, 'Auto-PO migration (00202) not applied yet.');
    return bad(500, upd.error.message);
  }
  if (!upd.data || !upd.data.length) return bad(409, 'PO is not a draft (already marked, or cancelled) — refresh the list.');
  return ok({ ok: true, purchase_order: upd.data[0] });
}

// Catch-up: evaluate every converted Team Shop order that has no evaluation
// yet (covers conversions from before this shipped, or hook failures).
async function sweep(admin, actor) {
  const ordersRes = await admin.from('webstore_orders')
    .select('id,so_id').eq('order_source', 'teamshop').eq('status', 'batched')
    .not('so_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (ordersRes.error) return bad(500, ordersRes.error.message);
  const soIds = [...new Set((ordersRes.data || []).map((o) => o.so_id).filter(Boolean))];
  if (!soIds.length) return ok({ ok: true, swept: [], remaining: 0 });

  const doneRes = await admin.from('teamshop_auto_po_needs').select('so_id').in('so_id', soIds);
  if (doneRes.error) {
    if (isMissingRelation(doneRes.error)) return ok({ ok: true, enabled: false, swept: [] });
    return bad(500, doneRes.error.message);
  }
  const done = new Set((doneRes.data || []).map((r) => r.so_id));
  const pending = soIds.filter((id) => !done.has(id));

  const swept = [];
  for (const soId of pending.slice(0, SWEEP_LIMIT)) {
    try {
      swept.push({ so_id: soId, ...(await generateForSo(admin, soId, actor)) });
    } catch (e) {
      swept.push({ so_id: soId, ok: false, error: e.message || String(e) });
    }
  }
  return ok({ ok: true, swept, remaining: Math.max(0, pending.length - SWEEP_LIMIT) });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    const auth = await verifyUser(event);
    if (!auth.ok) return bad(auth.status || 401, auth.error || 'Unauthorized');

    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    const actor = auth.teamMemberId || 'staff';
    if (body.action === 'list') return await listAutoPos(admin);
    if (body.action === 'mark_submitted') return await markSubmitted(admin, body, auth);
    if (body.action === 'generate') {
      const r = await generateForSo(admin, String(body.so_id || ''), actor);
      return r.ok || r.enabled === false ? ok(r) : bad(422, r.error || 'generation failed', r);
    }
    if (body.action === 'sweep') return await sweep(admin, actor);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[teamshop-auto-po] error:', e);
    return bad(500, e.message || 'Auto-PO action failed');
  }
};

// ── Test surface ─────────────────────────────────────────────────────
// Exported for src/__tests__/teamshopAutoPo.test.js (same pattern as
// teamshop-checkout / teamshop-po-review). Netlify invokes `handler`;
// generateForSo is also required directly by the conversion callers.
module.exports.computeNeeds = computeNeeds;
module.exports.generateForSo = generateForSo;
module.exports.generateForSoSafe = generateForSoSafe;
module.exports.listAutoPos = listAutoPos;
module.exports.markSubmitted = markSubmitted;
module.exports.sweep = sweep;
