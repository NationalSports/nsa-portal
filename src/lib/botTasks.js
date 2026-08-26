// Bot tasks — helpers for assigning work to the Chief of Staff ordering bot via the normal
// "Assign Task" flow. The bot is just another team member (role 'bot'); you
// assign it an assigned_todos row whose `bot_payload` carries the structured
// details it needs to act (e.g. add a PO's items to a vendor cart).
//
// See supabase/migrations/00099_assigned_todos_bot.sql for the schema and the
// bot_status lifecycle (queued -> in_progress -> needs_review -> done/failed).

// Keep this stable: the Mac mini and existing assigned_todos rows use this ID.
// The portal-facing identity is intentionally separate so renames never strand work.
export const BOT_MEMBER_ID = 'bot-claude';
export const BOT_DISPLAY_NAME = 'Chief of Staff';
export const BOT_TEAM_MEMBER_NAME = 'Chief of Staff (Grok Bot)';

// Only this portal user sees/uses the ordering bot (status pill, assign button,
// and the bot option in the Assign Task dropdown). Tasks themselves are
// already private to their creator/assignee; this just hides the controls from
// other reps/CSRs. Matched by team_members.id OR email, so it can't misfire if
// the logged-in profile resolves a different id than expected.
export const BOT_OWNER_ID = '00000000-0000-0000-0000-000000000001'; // Steve Peterson
export const BOT_OWNER_EMAIL = 'steve@nationalsportsapparel.com';
export const isBotOwner = (cu) =>
  !!cu && (cu.id === BOT_OWNER_ID || (cu.email || '').toLowerCase() === BOT_OWNER_EMAIL);



// Values for assigned_todos.bot_status (the worker's own progress).
export const BOT_STATUS = {
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  NEEDS_REVIEW: 'needs_review', // cart filled — stop before submit, await human OK
  DONE: 'done',
  FAILED: 'failed',
};

// Map a batch/source vendor name to the external portal the worker drives.
export function botTargetForVendor(vendorName) {
  const v = String(vendorName || '').toLowerCase();
  if (v.includes('adidas')) return 'adidas_click';
  if (v.includes('silver')) return 'silver_screen';
  if (v.includes('sanmar')) return 'sanmar';
  return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

// Flatten queued batch POs into a flat, worker-friendly line-item list.
// Each batch (bp) has { id, po_id, so_id, customer, items:[{sku,name,color,qty,unit_cost,sizes}] }.
function batchesToLines(batches) {
  const lines = [];
  (batches || []).forEach((bp) => {
    (bp.items || []).forEach((it) => {
      lines.push({
        sku: it.sku,
        name: it.name || '',
        color: it.color || '',
        qty: it.qty || 0,
        unit_cost: it.unit_cost || 0,
        sizes: it.sizes || {},
        drop_ship: it.drop_ship === true,
        ship_to: it.ship_to || null,           // write-in "new address" from the PO form
        attention: it.attention || null,       // write-in attention line (e.g. existing DPO)
        ship_to_deco_id: it.ship_to_deco_id || bp.ship_to_deco_id || null,
        item_idx: it.item_idx != null ? it.item_idx : null,
        source_batch_id: bp.id || null,
        source_po_id: bp.po_id || null,
        so_id: bp.so_id || null,
        customer: bp.customer || null,
      });
    });
  });
  return lines;
}

// Client-side mirror of the worker's resolveShipTo: for a drop-ship order,
// the delivery address is the SO's ship-to customer (ship_to_id, or the SO's
// own customer when unset/'default'). Returns {name,line1,city,state,zip} or
// null when the SO/customer has no usable shipping address.
export function resolveShipToClient(soId, allOrders, customers) {
  const so = (allOrders || []).find((s) => s.id === soId);
  if (!so) return null;
  const addrCustId = (so.ship_to_id && so.ship_to_id !== 'default') ? so.ship_to_id : so.customer_id;
  const c = (customers || []).find((x) => x.id === addrCustId);
  if (!c || !(c.shipping_address_line1 || c.shipping_city)) return null;
  return {
    name: c.name || c.alpha_tag || '',
    line1: c.shipping_address_line1 || '',
    city: c.shipping_city || '',
    state: c.shipping_state || '',
    zip: c.shipping_zip || '',
  };
}

// Which record a decorator's address actually comes from: its own saved address,
// falling back to its linked Vendor record. Returns { dv, lv, src } or null when
// neither carries one. Shared so the resolver below and the modals' decorator
// picker can never disagree about which address a decorator has.
export function decoAddressSource({ decoId, decoVendors, vendors }) {
  if (!decoId) return null;
  const dv = (decoVendors || []).find((d) => d.id === decoId);
  if (!dv) return null;
  const lv = dv.vendor_id ? (vendors || []).find((v) => v.id === dv.vendor_id) : null;
  const src = (dv.address_line1 || dv.city) ? dv : (lv && (lv.address_line1 || lv.city) ? lv : null);
  return src ? { dv, lv, src } : null;
}

// Every decorator that has a usable address, in the vendor-modal ship-to shape —
// the option list behind "Fill from a decorator" in the modals' address editor.
// Carries no attention line: the caller's own (a PO reference, say) is preserved
// when a rep picks a decorator, since the picker only fills the address itself.
export function decoShipToPresets({ decoVendors, vendors }) {
  return (decoVendors || [])
    .filter((dv) => dv.is_active !== false)
    .map((dv) => {
      const found = decoAddressSource({ decoId: dv.id, decoVendors, vendors });
      if (!found) return null;
      const { lv, src } = found;
      return {
        id: dv.id,
        label: dv.name || lv?.name || '',
        address: {
          companyName: dv.name || lv?.name || '',
          address1: src.address_line1 || '',
          address2: src.address_line2 || '',
          city: src.city || '',
          region: src.state || '',
          postalCode: src.zip || '',
          country: 'US',
        },
      };
    })
    .filter((p) => p && p.label);
}

// Decorator-bound blanks (batch ship_to_deco_id): the delivery address is the
// DECORATOR's, and the attention line must reference the deco PO (DPO number)
// so the decorator can match the incoming blanks to their job — same convention
// as the SanMar API flow (attentionTo: 'DPO <n>'). Address comes from the deco
// vendor's own saved address, falling back to its linked Vendor record. The DPO
// is found on the SO's deco_pos for that decorator (preferring one that covers
// the batch's item rows). Returns {name, attention, line1, city, state, zip}
// or null when no usable address exists.
export function resolveDecoShipToClient({ decoId, so, decoVendors, vendors, itemIdxs = null, decoPoId = null }) {
  const found = decoAddressSource({ decoId, decoVendors, vendors });
  if (!found) return null;
  const { dv, lv, src } = found;
  const dps = ((so && so.deco_pos) || []).filter((dp) => dp.deco_vendor_id === decoId);
  const dp = (decoPoId ? dps.find((d) => d.po_id === decoPoId) : null) || (itemIdxs && itemIdxs.length
    ? dps.find((d) => (d.item_idxs || []).some((ix) => itemIdxs.includes(ix)))
    : null) || dps[0] || null;
  const dpoNum = dp ? String(dp.po_id || '').replace(/^DPO\s*/i, '').trim() : '';
  return {
    name: dv.name || lv?.name || '',
    attention: dpoNum ? 'DPO ' + dpoNum : null,
    line1: src.address_line1 || '',
    line2: src.address_line2 || '',
    city: src.city || '',
    state: src.state || '',
    zip: src.zip || '',
    phone: src.phone || src.contact_phone || dv.phone || lv?.contact_phone || '',
  };
}

// Where a queued batch actually ships, in the shape the vendor order modals take
// ({companyName, attentionTo, address1, address2, city, region, postalCode}).
//
// Same precedence as the bot-cart flow above, so the API path and the bot path can
// never disagree about a destination: a line's write-in address wins, then the
// decorator the batch is bound to, then the drop-ship program address, else null
// (the modal's own NSA-warehouse default).
//
// `mixed` flags a batch whose lines belong at DIFFERENT addresses — an API order
// carries one ship-to, so everything would land at whichever address is returned.
// `unresolved` flags a batch that IS bound elsewhere but has no address on file, so
// it would quietly fall back to the NSA dock. Callers must surface both; neither is
// safe to resolve silently.
export function resolveBatchDestination({ batches, decoId = null, allOrders = [], customers = [], decoVendors = [], vendors = [] }) {
  const lines = batchesToLines(batches);
  const keyOf = (l) => {
    if (l.ship_to && (l.ship_to.line1 || l.ship_to.city)) return 'writein:' + JSON.stringify(l.ship_to);
    if (l.ship_to_deco_id) return 'deco:' + l.ship_to_deco_id;
    if (l.drop_ship) return 'so:' + (l.so_id || '');
    return 'nsa';
  };
  const keys = [...new Set(lines.map(keyOf))];
  // Prefer a real destination over the warehouse default when the batch has one.
  const lead = lines.find(l => keyOf(l) !== 'nsa') || null;
  const result = { shipTo: null, mixed: keys.length > 1, destinationCount: keys.length, unresolved: false };
  if (!lead) return result;

  // {name, attention, line1, line2, city, state, zip} → vendor modal shape.
  const toModalShape = (a) => (a && (a.line1 || a.city) ? {
    companyName: a.name || '',
    attentionTo: a.attention || '',
    address1: a.line1 || '',
    address2: a.line2 || '',
    city: a.city || '',
    region: a.state || '',
    postalCode: a.zip || '',
    country: 'US',
  } : null);

  const writeIn = lead.ship_to && (lead.ship_to.line1 || lead.ship_to.city) ? lead.ship_to : null;
  if (writeIn) {
    result.shipTo = toModalShape({ ...writeIn, attention: lead.attention || writeIn.attention || '' });
    return result;
  }
  const dId = lead.ship_to_deco_id || decoId;
  if (dId) {
    const so = (allOrders || []).find(s => s.id === lead.so_id) || null;
    const itemIdxs = lines.map(l => l.item_idx).filter(ix => ix != null);
    result.shipTo = toModalShape(resolveDecoShipToClient({ decoId: dId, so, decoVendors, vendors, itemIdxs }));
    result.unresolved = !result.shipTo;
    return result;
  }
  result.shipTo = toModalShape(resolveShipToClient(lead.so_id, allOrders, customers));
  if (result.shipTo && lead.attention) result.shipTo.attentionTo = lead.attention;
  result.unresolved = !result.shipTo;
  return result;
}

// Build the title/description/bot_payload for an "add all items to the vendor
// cart" task from a ready batch. The caller hands the result to onAssignTodo,
// which opens the standard Assign Task modal pre-filled for the ordering bot.
export function buildBotCartPayload({ poNumber, vendorName, batches, soId = null, shipTo = null, deliveryStrategy = 'complete' }) {
  const target = botTargetForVendor(vendorName);
  const lines = batchesToLines(batches);
  const totalQty = lines.reduce((a, l) => a + (l.qty || 0), 0);
  const totalCost = lines.reduce((a, l) => a + (l.qty || 0) * (l.unit_cost || 0), 0);
  const label = vendorName || target;
  const decoBound = lines.some((l) => l.ship_to_deco_id);
  const lineShipTo = lines.find((l) => l.ship_to)?.ship_to || null;   // write-in address wins
  const lineAttention = lines.find((l) => l.attention)?.attention || null; // write-in DPO/attention wins
  const dropShip = lines.some((l) => l.drop_ship) || decoBound || !!lineShipTo;
  let resolvedShipTo = dropShip ? (lineShipTo || shipTo || null) : null;
  if (resolvedShipTo && lineAttention) resolvedShipTo = { ...resolvedShipTo, attention: lineAttention };

  return {
    title: `Add ${lines.length} item${lines.length === 1 ? '' : 's'} (${totalQty} pcs) to ${label} cart · PO ${poNumber || '—'}`,
    description: `Log in to ${label}, add every line in the attached list to the cart at the given sizes/quantities, then enter PO# ${poNumber || '(none)'} on the cart.${decoBound ? ' DROP SHIP TO DECORATOR — set the delivery location to the decorator\'s address with the DPO number on the attention line.' : dropShip ? ' DROP SHIP — set the delivery location to the program address, not the NSA warehouse.' : ''} STOP before submitting — set bot_status to needs_review and comment here for approval.`,
    so_id: soId,
    bot_payload: {
      task_type: 'add_to_cart',
      target,
      vendor_name: vendorName || null,
      po_number: poNumber || null,
      lines,
      drop_ship: dropShip,
      ship_to: resolvedShipTo,
      delivery_strategy: deliveryStrategy || 'complete',
      totals: { line_count: lines.length, qty: totalQty, cost: Number(totalCost.toFixed(2)) },
    },
  };
}

// Build an "order status" task: email the SO's rep a full status of the order —
// every PO's received/shipped state — with live Adidas CLICK "My Orders" ship
// status layered onto the open Adidas POs. READ-ONLY: the worker (a Cowork/
// claude-in-chrome run reusing the inventory-sync CLICK access) never touches a
// cart. `task_type: 'track_po_status'` is what the Playwright add_to_cart worker
// skips and the Cowork tracker picks up; the full status is assembled server-side
// from the DB, so `pos` here only carries the open Adidas POs that get the live
// CLICK read (may be empty — the email still gives full portal status).
export function buildBotTrackPayload({ so, pos = [], customer = null }) {
  const poNumbers = [...new Set((pos || []).map((p) => p && p.id).filter(Boolean))];
  const n = poNumbers.length;
  const custName = (customer && (customer.name || customer.alpha_tag)) || '';
  return {
    title: `Order status — ${so?.id || ''}${custName ? ' · ' + custName : ''}`.replace(/\s+/g, ' ').trim(),
    description: `Email the rep a full status of ${so?.id || 'this order'}${custName ? ` (${custName})` : ''}: every PO's received/shipped state, plus live ship status read from Adidas CLICK "My Orders" for ${n ? `${n} open Adidas PO${n === 1 ? '' : 's'}` : 'any open Adidas POs'}. Read-only — never touches a cart.${poNumbers.length ? ' Adidas POs: ' + poNumbers.join(', ') + '.' : ''}`,
    so_id: so?.id || null,
    bot_payload: {
      task_type: 'track_po_status',
      so_id: so?.id || null,
      po_numbers: poNumbers,
      customer_name: custName || null,
      notify: true,
    },
  };
}

// Live step info for a running bot task ({step,total,label,at}) — written by
// the worker as the agent narrates PROGRESS markers; cleared when the run ends.
// Returns null unless the task is actively in_progress with a reported step.
export function botProgress(t) {
  const p = t && t.bot_status === 'in_progress' && t.bot_payload && t.bot_payload.progress;
  if (!p || p.step == null) return null;
  return { step: p.step, total: p.total || 8, label: p.label || '', at: p.at || null };
}

// Visual styling for a task row by the bot's progress. Returns null for non-bot
// tasks (render normally). The amber 'needs_review' is the human's cue that
// Chief of Staff finished and the order just needs reviewing/submitting.
export function botRowUI(botStatus) {
  switch (botStatus) {
    case 'queued':       return { label: '🤖 Queued',                  bg: '#f8fafc', bar: '#94a3b8', pillBg: '#e2e8f0', pillFg: '#475569' };
    case 'scheduled':    return { label: '🗓 Scheduled',               bg: '#faf5ff', bar: '#a855f7', pillBg: '#f3e8ff', pillFg: '#7e22ce' };
    case 'needs_input':  return { label: '❓ Needs your answer',        bg: '#fff1f2', bar: '#fb7185', pillBg: '#ffe4e6', pillFg: '#be123c' };
    case 'in_progress':  return { label: '🤖 Bot working…',            bg: '#eff6ff', bar: '#3b82f6', pillBg: '#dbeafe', pillFg: '#1e40af' };
    case 'needs_review': return { label: '🛒 Ready to review & order',  bg: '#fefce8', bar: '#f59e0b', pillBg: '#fde68a', pillFg: '#92400e' };
    case 'blocked':      return { label: '🚧 Bot blocked',             bg: '#fff7ed', bar: '#fb923c', pillBg: '#fed7aa', pillFg: '#9a3412' };
    case 'failed':       return { label: '❌ Bot failed',              bg: '#fef2f2', bar: '#ef4444', pillBg: '#fecaca', pillFg: '#b91c1c' };
    case 'done':         return { label: '✅ Bot done',                bg: '#f0fdf4', bar: '#22c55e', pillBg: '#bbf7d0', pillFg: '#166534' };
    default:             return null;
  }
}

// Guard against silently checking off a bot task the worker never finished.
// `needs_review` (cart filled, awaiting human submit) and `done` are the
// expected states to complete *from* — return null there. Any other bot_status
// (failed, blocked, in_progress, queued, scheduled, needs_input) means the bot
// did NOT place the order, so marking the task done would falsely imply the PO
// was ordered. Returns a human-readable status label to warn with, else null.
// Non-bot tasks (no bot_status) always return null.
export function botCompleteNeedsConfirm(todo) {
  const bs = todo && todo.bot_status;
  if (!bs || bs === 'done' || bs === 'needs_review') return null;
  const ui = botRowUI(bs);
  return ui ? ui.label : bs;
}
