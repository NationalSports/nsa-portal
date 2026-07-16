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
// Warehouse on-hand allocation — ONE implementation shared with the delivery-
// timeline in-stock check (extracted from this file's computeNeeds; see
// _teamshopTimeline.js). Same semantics as before: per (product, size),
// mutated as items claim it.
const { makeOnHandAllocator } = require('./_teamshopTimeline');

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

// ── Auto-submit (Phase 3b) ────────────────────────────────────────────
// When teamshop_auto_po_settings.auto_submit_enabled is true for a vendor, a
// FRESHLY-drafted PO (never a replay) is emailed to that vendor's contact_email
// (00202's existing column — no schema change needed) and marked submitted the
// same way the staff mark_submitted action does (status 'created',
// submitted_at), but submitted_by='auto'. There is no supplier-email step in the
// codebase today (00193: "no supplier submission in this pass"; the queue only
// flips status), so this composes a PO email via Brevo — the same transport
// teamshop-stuck-sweep.js uses. Respects min_order_cents: a PO below the vendor's
// minimum is left draft. A missing contact_email leaves the PO draft and is
// surfaced by teamshop-stuck-sweep. NEVER throws (best-effort, like the rest of
// this module) — a submission failure only leaves the PO as a reviewable draft.
const escHtml = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const moneyCents = (cents) => '$' + ((Number(cents) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function buildPoEmailHtml(po, vendor, group) {
  const cell = 'padding:4px 10px;border:1px solid #e2e8f0';
  const rows = (group.lines || []).map((l) => `<tr>
    <td style="${cell}">${escHtml(l.sku || '')}</td>
    <td style="${cell}">${escHtml(l.size || '')}</td>
    <td style="${cell};text-align:right">${Number(l.qty) || 0}</td>
    <td style="${cell};text-align:right">${moneyCents(l.unit_cost_cents)}</td>
  </tr>`).join('');
  return `<div style="font-family:sans-serif;max-width:640px">
    <h2 style="margin-bottom:4px">Purchase Order ${escHtml(po.po_number || po.id)}</h2>
    <p style="color:#475569;margin-top:0">National Sports Apparel — ${escHtml(vendor)}${group.supplier_account ? ' · acct ' + escHtml(group.supplier_account) : ''}</p>
    <table style="border-collapse:collapse;font-size:13px;margin-top:10px">
      <thead><tr>
        <th style="${cell};text-align:left">SKU</th>
        <th style="${cell};text-align:left">Size</th>
        <th style="${cell};text-align:right">Qty</th>
        <th style="${cell};text-align:right">Unit</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:13px;margin-top:12px">Total: <strong>${moneyCents(group.totals_cents)}</strong></p>
    <p style="font-size:11px;color:#94a3b8;margin-top:18px">Auto-submitted by National Sports Apparel Team Shop.</p>
  </div>`;
}

async function sendVendorPoEmail(po, vendor, group, toEmail) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) { console.error('[teamshop-auto-po] BREVO_API_KEY missing — cannot email PO ' + (po.po_number || po.id)); return false; }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Team Shop', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: toEmail }],
      subject: 'Purchase Order ' + (po.po_number || po.id) + ' — National Sports Apparel',
      htmlContent: buildPoEmailHtml(po, vendor, group),
    }),
  });
  if (!res.ok) { console.error('[teamshop-auto-po] Brevo PO send failed:', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

// Attempt to auto-submit ONE freshly drafted PO. Returns a result; never throws.
async function autoSubmitPo(admin, { po, vendor, setting, group }) {
  try {
    if (!setting || setting.auto_submit_enabled !== true) return { submitted: false, reason: 'disabled' };
    const min = setting.min_order_cents != null ? Number(setting.min_order_cents) : null;
    if (min != null && (Number(group.totals_cents) || 0) < min) return { submitted: false, reason: 'below_min' };
    const toEmail = String(setting.contact_email || '').trim();
    if (!toEmail) return { submitted: false, reason: 'no_vendor_email' };

    // CLAIM FIRST, then email (audit fix). The old order — email, THEN compare-and-set —
    // meant a transient status-write failure AFTER a successful send left the PO 'draft',
    // so the staff Auto-PO workflow would order it AGAIN: a real double order to the vendor.
    // Claiming first (CAS draft->created) closes that window: once claimed, staff/next sweep
    // see it's no longer draft and won't re-send.
    const upd = await admin.from('purchase_orders')
      .update({ status: 'created', submitted_at: new Date().toISOString(), submitted_by: 'auto' })
      .eq('id', po.id).eq('status', 'draft')
      .select('id,status,submitted_at,submitted_by');
    if (upd.error) return { submitted: false, reason: 'mark_failed', error: upd.error.message };
    if (!upd.data || !upd.data.length) return { submitted: false, reason: 'not_draft' }; // raced with a staff mark

    const emailed = await sendVendorPoEmail(po, vendor, group, toEmail);
    if (!emailed) {
      // Roll the claim back to draft so the PO is RETRIED rather than stranded as
      // 'created' but never actually sent. Scoped to our own auto-claim (submitted_by
      // 'auto') so we never revert a PO a staffer marked created in the meantime.
      await admin.from('purchase_orders')
        .update({ status: 'draft', submitted_at: null, submitted_by: null })
        .eq('id', po.id).eq('status', 'created').eq('submitted_by', 'auto');
      return { submitted: false, reason: 'email_failed' };
    }
    return { submitted: true, emailed: true, po_id: po.id };
  } catch (e) {
    return { submitted: false, reason: 'error', error: e.message || String(e) };
  }
}

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
  const alloc = makeOnHandAllocator(inventory);

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
      const take = alloc.take(it.product_id, size, qty);
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

  // Full per-vendor setting rows (auto_submit_enabled / contact_email /
  // min_order_cents) — computeNeeds only carries a subset into vendorGroups.
  const settingByVendor = {};
  (settingsRes.data || []).forEach((s) => { settingByVendor[s.vendor] = s; });

  // One draft PO per vendor through the 00193 RPC. client_ref makes any
  // replay/race collapse onto the same PO with the same lines.
  const created = [];
  const poIdByVendor = {};
  const autoSubmits = [];
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
    const replayed = !!(rpc.data && rpc.data.replayed);

    // Auto-submit: only a FRESHLY-created draft (never a replay) for a vendor whose
    // auto_submit flag is on. A replay already went through this decision on its
    // first run, so we never re-email/re-mark it.
    let autoSubmit = null;
    const setting = settingByVendor[vendor];
    if (po && po.id && !replayed && po.status === 'draft' && setting && setting.auto_submit_enabled === true) {
      autoSubmit = await autoSubmitPo(admin, { po, vendor, setting, group: g });
      autoSubmits.push({ vendor, po_id: po.id, po_number: po.po_number, ...autoSubmit });
    }

    created.push({
      vendor,
      po_id: po ? po.id : null,
      po_number: po ? po.po_number : null,
      replayed,
      lines: g.lines.length,
      totals_cents: g.totals_cents,
      ...(autoSubmit ? { auto_submit: autoSubmit } : {}),
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
    ...(autoSubmits.length ? { auto_submits: autoSubmits, auto_submitted: autoSubmits.filter((a) => a.submitted).length } : {}),
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
  // dismissed_at is null: a staff-dismissed line (ordered by hand already, see
  // dismissUnmapped below, 00209) drops off this list without deleting the
  // audit row.
  const unmappedRes = await admin.from('teamshop_auto_po_needs')
    .select('id,so_id,sku,size,qty_needed,created_at')
    .eq('skip_reason', 'no_vendor_mapping')
    .is('dismissed_at', null)
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
    dtf: await dtfSummary(admin), // DTF lane pending vs threshold (null when unconfigured)
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

// Dismiss/resolve a "Needs manual ordering" line (00209) — staff ordered it by
// hand and it should stop showing up. Marks dismissed_at/dismissed_by rather
// than deleting the row, so the evaluation audit trail (why this line had no
// vendor mapping) is preserved. Compare-and-set on dismissed_at is null so a
// double-click can't stomp who/when a race already recorded.
async function dismissUnmapped(admin, body, staff) {
  const id = body.id;
  if (id === undefined || id === null || id === '') return bad(400, 'id required');
  const upd = await admin.from('teamshop_auto_po_needs')
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: (staff && staff.teamMemberId) || 'staff' })
    .eq('id', id).is('dismissed_at', null)
    .select('id,dismissed_at,dismissed_by');
  if (upd.error) {
    if (isMissingRelation(upd.error)) return bad(409, 'Auto-PO migration (00209) not applied yet.');
    return bad(500, upd.error.message);
  }
  if (!upd.data || !upd.data.length) return bad(409, 'Already dismissed, or the row does not exist — refresh the list.');
  return ok({ ok: true, need: upd.data[0] });
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

// ── DTF print lane (00211) ────────────────────────────────────────────
// A NEW lane keyed by deco_type='dtf' (not inventory_source). DTF transfer prints
// accumulate as per-job needs and batch into ONE draft PO to the DTF vendor once
// enough are pending — gated exactly like the garment lanes (a threshold, with an
// age backstop). Everything is default-inert: the seeded DTF vendor has no gates,
// no email, and auto-submit off, so nothing fires until staff configure it.
const DTF_DECO = 'dtf';
const DTF_ACTIVE_STATUSES = ['hold', 'ready', 'staging', 'in_process']; // pre-completion

// Pure batch gate (unit-tested directly). Threshold semantics: SUM(pending qty) is
// a print COUNT (gang-sheet area is a future refinement). Trips at the boundary
// (totalQty >= threshold). Backstop trips when the oldest pending need is at least
// max_age_days old; skipped when max_age_days is null. Both gates null → inert.
function dtfBatchDecision({ pendingNeeds, setting, now }) {
  const needs = pendingNeeds || [];
  const threshold = setting && setting.threshold_qty != null ? Number(setting.threshold_qty) : null;
  const maxAgeDays = setting && setting.max_age_days != null ? Number(setting.max_age_days) : null;
  const totalQty = needs.reduce((a, n) => a + Math.max(0, Number(n.qty) || 0), 0);
  const nowMs = (now ? new Date(now) : new Date()).getTime();
  let oldestAgeDays = 0;
  for (const n of needs) {
    const t = n.created_at ? new Date(n.created_at).getTime() : nowMs;
    if (!Number.isNaN(t)) oldestAgeDays = Math.max(oldestAgeDays, (nowMs - t) / 86400000);
  }
  const base = { totalQty, oldestAgeDays, threshold, maxAgeDays, pending: needs.length };
  if (!needs.length) return { batch: false, reason: 'no_pending', ...base };
  if (threshold == null && maxAgeDays == null) return { batch: false, reason: 'not_configured', ...base };
  if (threshold != null && totalQty >= threshold) return { batch: true, reason: 'threshold', ...base };
  if (maxAgeDays != null && oldestAgeDays >= maxAgeDays) return { batch: true, reason: 'backstop', ...base };
  return { batch: false, reason: 'below_threshold', ...base };
}

// SO ids born from a teamshop/club webstore order — the auto-PO engine's scope.
async function teamshopClubSoIds(admin) {
  const res = await admin.from('webstore_orders')
    .select('so_id, order_source').in('order_source', ['teamshop', 'club']).not('so_id', 'is', null).limit(5000);
  if (res.error) throw res.error;
  return [...new Set((res.data || []).map((r) => r.so_id).filter(Boolean))];
}

// Record a pending DTF print need per active DTF job that has none yet (idempotent
// on (so_id, job_id)). qty = the job's units at record time. Skips zero-unit jobs
// and jobs past production (completed/packed). Best-effort; returns a count.
async function recordDtfNeeds(admin) {
  const soIds = await teamshopClubSoIds(admin);
  if (!soIds.length) return { recorded: 0 };
  const jobsRes = await admin.from('so_jobs')
    .select('so_id, id, deco_type, total_units, prod_status')
    .in('so_id', soIds).eq('deco_type', DTF_DECO).in('prod_status', DTF_ACTIVE_STATUSES).limit(5000);
  if (jobsRes.error) {
    if (isMissingRelation(jobsRes.error)) return { enabled: false, recorded: 0 };
    return { recorded: 0, error: jobsRes.error.message };
  }
  const dtfJobs = (jobsRes.data || []).filter((j) => (Number(j.total_units) || 0) > 0);
  if (!dtfJobs.length) return { recorded: 0 };
  const existRes = await admin.from('teamshop_dtf_print_needs').select('so_id, job_id').in('so_id', soIds).limit(5000);
  if (existRes.error) {
    if (isMissingRelation(existRes.error)) return { enabled: false, recorded: 0 };
    return { recorded: 0, error: existRes.error.message };
  }
  const have = new Set((existRes.data || []).map((r) => r.so_id + ' ' + r.job_id));
  const rows = dtfJobs
    .filter((j) => !have.has(j.so_id + ' ' + j.id))
    .map((j) => ({ so_id: j.so_id, job_id: j.id, qty: Math.max(1, Number(j.total_units) || 0), status: 'pending' }));
  if (!rows.length) return { recorded: 0 };
  const up = await admin.from('teamshop_dtf_print_needs').upsert(rows, { onConflict: 'so_id,job_id', ignoreDuplicates: true });
  if (up.error) return { recorded: 0, error: up.error.message };
  // Stamp the job readiness signal (00212) on the newly-needed jobs. Compare-and-set
  // on dtf_prints_status is null so a job already ordered/received is never reset.
  await stampDtfStatus(admin, rows.map((r) => ({ so_id: r.so_id, job_id: r.job_id })), 'needed', true);
  return { recorded: rows.length };
}

// Write so_jobs.dtf_prints_status for a set of (so_id, job_id) pairs (00212).
// onlyIfNull restricts to jobs whose status is still null (used for 'needed' so an
// already-ordered/received job isn't reset). Best-effort — never throws; a missing
// column (pre-00212) is swallowed so the needs work still lands.
async function stampDtfStatus(admin, pairs, status, onlyIfNull) {
  const bySo = {};
  (pairs || []).forEach((p) => { if (p && p.so_id && p.job_id) (bySo[p.so_id] = bySo[p.so_id] || []).push(p.job_id); });
  for (const [soId, jobIds] of Object.entries(bySo)) {
    try {
      let q = admin.from('so_jobs').update({ dtf_prints_status: status }).eq('so_id', soId).in('id', jobIds);
      if (onlyIfNull) q = q.is('dtf_prints_status', null);
      const r = await q;
      if (r.error && !isMissingRelation(r.error)) console.error('[teamshop-auto-po] dtf_prints_status stamp failed:', r.error.message);
    } catch (e) { /* best-effort */ }
  }
}

// Sweep: record any missing DTF needs, then batch ALL pending into ONE draft PO to
// the DTF vendor when the gate trips. Never throws; degrades to enabled:false
// pre-migration. Idempotency: client_ref keys on the max need id in the batched
// set, so an immediate retry (if marking failed) replays the same PO via 00193's
// unique client_ref rather than duplicating it. Needs already 'ordered' are
// excluded from `pending`, so a later-arriving need forms its own next batch.
async function sweepDtf(admin, actor) {
  const setRes = await admin.from('teamshop_auto_po_settings').select('*').eq('deco_type', DTF_DECO).limit(1);
  if (setRes.error) {
    if (isMissingRelation(setRes.error)) return { ok: true, enabled: false, batched: false, note: 'DTF lane (00211) not applied' };
    return { ok: false, error: setRes.error.message };
  }
  const setting = (setRes.data || [])[0] || null;
  if (!setting) return { ok: true, batched: false, reason: 'no_dtf_vendor' };

  const rec = await recordDtfNeeds(admin);
  if (rec && rec.enabled === false) return { ok: true, enabled: false, batched: false, note: 'DTF needs table (00211) not applied' };

  const pendRes = await admin.from('teamshop_dtf_print_needs')
    .select('id, so_id, job_id, qty, created_at').eq('status', 'pending').is('dismissed_at', null).limit(5000);
  if (pendRes.error) {
    if (isMissingRelation(pendRes.error)) return { ok: true, enabled: false, batched: false };
    return { ok: false, error: pendRes.error.message };
  }
  const pending = pendRes.data || [];
  const decision = dtfBatchDecision({ pendingNeeds: pending, setting, now: new Date().toISOString() });
  if (!decision.batch) return { ok: true, batched: false, ...decision, recorded: rec.recorded || 0 };

  // CLAIM the needs FIRST, atomically, THEN build the PO from ONLY the rows we
  // actually claimed (audit fix). The old order — create the PO (client_ref keyed
  // on the max need id), THEN mark needs ordered — let two overlapping sweeps that
  // both read needs [1,2,3] create TWO POs (different max-id refs) both containing
  // 1,2,3 → a double DTF order. Now a concurrent sweep's claim of the same ids
  // updates zero rows (they're no longer 'pending'), so its PO can't overlap.
  const claimIds = pending.filter((n) => (Number(n.qty) || 0) > 0).map((n) => n.id);
  if (!claimIds.length) return { ok: true, batched: false, reason: 'no_pending', ...decision };
  const claimRes = await admin.from('teamshop_dtf_print_needs')
    .update({ status: 'ordered', vendor: setting.vendor, ordered_at: new Date().toISOString() })
    .in('id', claimIds).eq('status', 'pending')
    .select('id, so_id, job_id, qty');
  if (claimRes.error) return { ok: false, error: 'DTF claim failed: ' + claimRes.error.message };
  const claimed = claimRes.data || [];
  if (!claimed.length) return { ok: true, batched: false, reason: 'already_claimed', ...decision };

  const lines = claimed.map((n) => ({ so_id: n.so_id, sku: 'DTF-PRINT', size: 'PRINT', qty: Math.max(1, Number(n.qty) || 0), unit_cost_cents: 0, meta: { job_id: n.job_id, deco_type: DTF_DECO } }));
  const clientRef = 'tsdtf:' + Math.max(...claimed.map((n) => Number(n.id) || 0));
  const rpc = await admin.rpc('create_purchase_order', {
    p_client_ref: clientRef,
    p_po: {
      vendor: setting.vendor, status: 'draft', origin: 'auto',
      created_by: actor || AUTO_ACTOR_FALLBACK, totals_cents: 0,
      threshold_eval: {
        lane: 'dtf', reason: decision.reason, total_prints: decision.totalQty,
        threshold_qty: decision.threshold, max_age_days: decision.maxAgeDays,
        oldest_age_days: Math.round(decision.oldestAgeDays), needs: claimed.length,
      },
    },
    p_lines: lines,
  });
  if (rpc.error) {
    // PO creation failed — release the claim so these needs are re-swept next time,
    // not stranded as 'ordered' with no PO. Scoped to our own just-claimed rows.
    await admin.from('teamshop_dtf_print_needs')
      .update({ status: 'pending', vendor: null, ordered_at: null })
      .in('id', claimed.map((n) => n.id)).eq('status', 'ordered').is('po_id', null);
    if (isMissingRelation(rpc.error)) return { ok: true, enabled: false, batched: false };
    return { ok: false, error: 'DTF batch PO failed: ' + rpc.error.message };
  }
  const po = rpc.data && rpc.data.purchase_order;
  const replayed = !!(rpc.data && rpc.data.replayed);

  // Link the claimed needs (already 'ordered') to the PO. A failure here leaves the
  // needs ordered with a null po_id — recoverable, and never a double order.
  if (po && po.id) {
    await admin.from('teamshop_dtf_print_needs').update({ po_id: po.id }).in('id', claimed.map((n) => n.id)).is('po_id', null);
  }
  // Advance the job readiness signal (00212): these jobs' prints are on order.
  await stampDtfStatus(admin, claimed.map((n) => ({ so_id: n.so_id, job_id: n.job_id })), 'ordered', false);

  let autoSubmit = null;
  if (po && po.id && !replayed && po.status === 'draft' && setting.auto_submit_enabled === true) {
    autoSubmit = await autoSubmitPo(admin, {
      po, vendor: setting.vendor, setting,
      group: { totals_cents: 0, lines: lines.map((l) => ({ sku: l.sku, size: l.size, qty: l.qty, unit_cost_cents: l.unit_cost_cents })) },
    });
  }
  return {
    ok: true, batched: true, reason: decision.reason, po_id: po ? po.id : null, po_number: po ? po.po_number : null,
    replayed, needs: claimed.length, total_prints: decision.totalQty, recorded: rec.recorded || 0,
    ...(autoSubmit ? { auto_submit: autoSubmit } : {}),
  };
}

// Receive a DTF batch PO's prints into a bin (00212). Marks its needs 'received'
// (+ bin), advances so_jobs.dtf_prints_status → 'received' (which frees the job for
// the auto-release DTF gate), and creates a kind='receiving' box of "prints on
// hand" tagged with the bin so staff can locate them. Compare-and-set on
// status='ordered' so a double-receive is a clean 409. The box is best-effort — the
// readiness signal (the load-bearing part) lands first. Plate uses the timestamp
// fallback: next_counter is staff-scoped (is_team_member) and this runs as service
// role, so it can't mint a sequential plate — the fallback is unique and scannable
// (classifyScan accepts the alphanumeric BX- form).
async function receiveDtf(admin, body, actor) {
  const poId = String(body.po_id || '').trim();
  const bin = String(body.bin || '').trim();
  if (!poId) return bad(400, 'po_id required');

  const needsRes = await admin.from('teamshop_dtf_print_needs')
    .select('id, so_id, job_id, qty, vendor').eq('po_id', poId).eq('status', 'ordered');
  if (needsRes.error) {
    if (isMissingRelation(needsRes.error)) return bad(409, 'DTF lane (00211) not applied yet.');
    return bad(500, needsRes.error.message);
  }
  const needs = needsRes.data || [];
  if (!needs.length) return bad(409, 'No ordered DTF prints on this PO (already received, or not a DTF PO) — refresh.');

  const ids = needs.map((n) => n.id);
  const mark = await admin.from('teamshop_dtf_print_needs')
    .update({ status: 'received', received_at: new Date().toISOString(), bin: bin || null })
    .in('id', ids).eq('status', 'ordered');
  if (mark.error) return bad(500, mark.error.message);

  await stampDtfStatus(admin, needs.map((n) => ({ so_id: n.so_id, job_id: n.job_id })), 'received', false);

  // "Prints on hand" receiving box (best-effort; boxes table may not be deployed).
  let boxId = null;
  try {
    const poNumRes = await admin.from('purchase_orders').select('po_number').eq('id', poId).maybeSingle();
    const poNumber = (poNumRes.data && poNumRes.data.po_number) || poId;
    const plate = 'BX-' + Date.now().toString(36).toUpperCase().slice(-6);
    const nowIso = new Date().toISOString();
    const row = {
      id: plate, kind: 'receiving',
      contents: needs.map((n) => ({ sku: 'DTF-PRINT', name: 'DTF transfers', color: '', so_id: n.so_id, sizes: { PRINT: Math.max(1, Number(n.qty) || 0) } })),
      source_refs: [{ type: 'PO', id: poNumber }],
      po_id: poNumber, bin: bin || null, status: 'staged',
      created_by: actor || 'auto', created_at: nowIso, updated_at: nowIso,
    };
    const ins = await admin.from('boxes').insert(row).select('id').maybeSingle();
    if (!ins.error && ins.data) boxId = ins.data.id;
  } catch (_) { /* box is best-effort */ }

  return ok({ ok: true, received: needs.length, bin: bin || null, box_id: boxId, po_id: poId });
}

// DTF lane status for the Auto POs view: pending count/qty + the vendor's gates.
// Returns null when the lane isn't configured/applied (so the UI just omits it).
async function dtfSummary(admin) {
  try {
    const setRes = await admin.from('teamshop_auto_po_settings')
      .select('vendor, deco_type, threshold_qty, max_age_days, contact_email, auto_submit_enabled')
      .eq('deco_type', DTF_DECO).limit(1);
    if (setRes.error || !(setRes.data || []).length) return null;
    const setting = setRes.data[0];
    const pendRes = await admin.from('teamshop_dtf_print_needs')
      .select('qty').eq('status', 'pending').is('dismissed_at', null).limit(5000);
    const pend = pendRes.error ? [] : (pendRes.data || []);
    return {
      vendor: setting.vendor, threshold_qty: setting.threshold_qty, max_age_days: setting.max_age_days,
      pending_qty: pend.reduce((a, n) => a + (Number(n.qty) || 0), 0), pending_count: pend.length,
      contact_email: setting.contact_email, auto_submit_enabled: setting.auto_submit_enabled,
    };
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Scheduled (Netlify cron) invocation — no httpMethod / not POST — runs the DTF
  // batch sweep unattended (no auth, same posture as teamshop-auto-release /
  // teamshop-stuck-sweep; the garment lanes stay conversion-triggered + staff
  // sweep). Never throws. Only the DTF lane runs here — it's the one with a time
  // backstop that needs a clock; the seeded DTF vendor is inert until configured.
  if (!event || event.httpMethod !== 'POST') {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Service not configured' }) }; }
    try {
      const r = await sweepDtf(admin, 'schedule');
      return { statusCode: 200, headers, body: JSON.stringify(r) };
    } catch (e) {
      console.error('[teamshop-auto-po] scheduled DTF sweep failed:', e.message || e);
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

    const actor = auth.teamMemberId || 'staff';
    if (body.action === 'list') return await listAutoPos(admin);
    if (body.action === 'mark_submitted') return await markSubmitted(admin, body, auth);
    if (body.action === 'dismiss_unmapped') return await dismissUnmapped(admin, body, auth);
    if (body.action === 'generate') {
      const r = await generateForSo(admin, String(body.so_id || ''), actor);
      return r.ok || r.enabled === false ? ok(r) : bad(422, r.error || 'generation failed', r);
    }
    if (body.action === 'sweep') return await sweep(admin, actor);
    if (body.action === 'sweep_dtf') return ok(await sweepDtf(admin, actor));
    if (body.action === 'receive_dtf') return await receiveDtf(admin, body, actor);
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
module.exports.dismissUnmapped = dismissUnmapped;
module.exports.sweep = sweep;
module.exports.autoSubmitPo = autoSubmitPo;
module.exports.buildPoEmailHtml = buildPoEmailHtml;
module.exports.dtfBatchDecision = dtfBatchDecision;
module.exports.recordDtfNeeds = recordDtfNeeds;
module.exports.sweepDtf = sweepDtf;
module.exports.dtfSummary = dtfSummary;
module.exports.receiveDtf = receiveDtf;
module.exports.stampDtfStatus = stampDtfStatus;
