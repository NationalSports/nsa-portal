// Shared prompt-building logic for the NSA bot worker. Extracted from
// worker.js so the fake-order test harness (test/) runs the agent with the
// exact same prompt the production worker builds.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Real size:quantity pairs only — the sizes jsonb also carries meta keys
// (drop_ship, unit_cost, etc.) that must not be treated as sizes.
const SIZE_META = new Set(['drop_ship', 'unit_cost', 'po_type', 'vendor', 'memo', 'notes', 'status', 'ship_to', 'attention', 'ship_to_deco_id']);
export function cleanSizes(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (SIZE_META.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

// Render the line items into a readable list for the prompt.
export function formatLines(lines) {
  return (lines || [])
    .map((l) => {
      const sizes = Object.entries(cleanSizes(l.sizes))
        .map(([sz, v]) => `${sz}:${v}`)
        .join(' ');
      return `- ${l.sku}${l.color ? ' (' + l.color + ')' : ''} — qty ${l.qty}${sizes ? ' [' + sizes + ']' : ''}`;
    })
    .join('\n');
}

// opts.credsForTarget(target) -> {url,user,pass}; opts.botMemberId for
// attributing prior bot comments in the conversation transcript.
export function buildPrompt(task, p = {}, conversation = [], opts = {}) {
  const credsForTarget = opts.credsForTarget || (() => ({ url: '', user: '', pass: '' }));
  const botMemberId = opts.botMemberId || 'bot-claude';
  const hasLines = Array.isArray(p.lines) && p.lines.length > 0;
  // Resolved/structured order -> use its vendor. Otherwise default to Adidas
  // CLICK so creds fill in, and let Claude work from the task notes.
  const target = p.target || (hasLines ? 'unknown' : 'adidas_click');
  const creds = credsForTarget(target);
  const tpl = readFileSync(join(__dirname, 'prompts', 'add_to_cart.md'), 'utf8');
  const lines = hasLines
    ? formatLines(p.lines)
    : '(No structured line list — work from the task notes below.)';
  const notes = (task.title || task.description)
    ? `Task: ${task.title || ''}${task.description ? '\n' + task.description : ''}`
    : '(none)';
  const s = p.ship_to;
  const delivery = (p.drop_ship && s && (s.line1 || s.city))
    ? `THIS IS A DROP SHIP — the order must deliver directly to the address below, NOT National Sports' default address.\n`
      + `On the cart's Delivery Location, click it and choose "Add one-time delivery location", then fill the form exactly:\n`
      + `- Attention 1 (first line): ${s.name}\n`
      + (s.attention ? `- Attention 2 (SECOND line): ${s.attention}\n`
        + `  Put "${s.attention}" on the form's SECOND line — its "Attention 2" field, or "Address Line 2" if that's what the form has. It MUST sit on its own second line, never merged into line 1. The receiver (often a decorator) uses this reference to match the incoming shipment to their job.\n` : '')
      + `- Street Address: ${s.line1}\n`
      + `- City/Town: ${s.city}\n`
      + `- State: ${s.state}\n`
      + `- ZIP code: ${s.zip}\n`
      + `Country is United States. Then click "Use this address" so it becomes the cart's delivery location. (No PO boxes.)`
    : `Not a drop ship — the order ships to National Sports' warehouse, which is the portal's DEFAULT delivery location.\n`
      + `Verify the cart's Delivery Location shows the default National Sports address. If it shows a leftover one-time\n`
      + `address from a previous order, switch it back to the default National Sports location before continuing.`;
  const deliveryDate = p.delivery_date
    ? `Set the order's DELIVERY DATE to ${p.delivery_date}. In the cart, under the "Delivery Dates" heading, there's a date chip showing the current date (e.g. "Jun 2, 2026"). CLICK that date chip — a calendar opens — then pick ${p.delivery_date}. Confirm the chip now shows ${p.delivery_date}. (This is the ship/deliver date — you are still ordering now, not later.)`
    : `No specific delivery date requested — leave the default delivery date (the short-backorder rule above is the only reason to change it).`;
  // How to group the cart's delivery dates when ordered sizes have different
  // restock dates. The rep picks this per task (default 'complete').
  const _strat = p.delivery_strategy || 'complete';
  const deliveryStrategy = _strat === 'per_sku'
    ? `Strategy: EACH SKU TOGETHER. Keep every SKU on ONE date so it arrives complete. For a SKU with any short-backordered size, set that WHOLE SKU's sizes to that SKU's LATEST needed restock date; SKUs fully in stock stay on today. Use "Add more dates" so each SKU's quantities sit under its own single date. NEVER split one SKU across two dates — in-stock SKUs ship now, backordered SKUs ship later, each arriving complete.`
    : _strat === 'as_available'
    ? `Strategy: SHIP AS AVAILABLE. Ship each SIZE the moment it's ready: put in-stock sizes on today's date and each short-backordered size under its own restock date via "Add more dates". A single SKU MAY span two dates — that's expected and fine; the goal is the fastest partial shipments.`
    : `Strategy: SHIP COMPLETE. Set the cart's ONE delivery date to the LATEST restock date among all ordered short-backordered sizes, so the WHOLE order ships together in a single delivery. Click the "Delivery Dates" chip, pick that date, and confirm the chip shows it. (If the portal auto-splits into extra date columns you can't merge, note it in issues.)`;
  // The portal's own adidas_inventory snapshot (per SKU+size stock and restock
  // dates), captured at assign time — the agent starts from it and verifies
  // live, instead of discovering everything by hovering.
  const _av = p.availability || null;
  const _avLines = [];
  if (_av) {
    for (const l of (p.lines || [])) {
      const a = _av[l.sku];
      if (!a) continue;
      const parts = Object.entries(l.sizes || {}).map(([sz, q]) => {
        const r = a[sz];
        if (!r) return `${sz}: no portal data`;
        if ((r.stock || 0) >= q) return `${sz}: in stock (${r.stock})`;
        return `${sz}: SHORT (stock ${r.stock || 0}, restock ${r.date || 'unknown'}${r.fqty != null ? `, ~${r.fqty} coming` : ''})`;
      });
      _avLines.push(`- ${l.sku}: ${parts.join(' · ')}`);
    }
  }
  const portalAvailability = _avLines.length
    ? `Per the NSA portal's Adidas inventory sync${p.availability_synced ? ` (as of ${p.availability_synced})` : ''}:\n${_avLines.join('\n')}\n`
      + `Treat these as expectations, not truth — verify on the live portal (calendar-icon hovers). If live data disagrees, TRUST THE LIVE PORTAL and note the difference in issues.`
    : `No portal snapshot available for this order — rely entirely on the live portal.`;
  const backorderAction = p.backorder_action === 'order'
    ? `ORDER EVERYTHING. For sizes restocking beyond 14 days, do NOT skip or ask — enter the full quantities under each size's restock date (use "Add more dates"), following the delivery-date strategy. Only ask (needs_input) for a size with NO restock date at all.`
    : p.backorder_action === 'drop'
    ? `DROP LONG BACKORDERS. Order every size that's available now or restocks within 14 days; for sizes beyond 14 days (or with no date), enter nothing, list them in \`skipped\` (size-level, with dates), and do NOT ask — finish to needs_review.`
    : `None given — follow the 14-day rule above and ask via needs_input when it triggers.`;
  // Per-item schedule the rep picked at assign time — hard overrides for those
  // SKUs; the global strategy/backorder rules still govern the rest.
  const _ls = p.line_schedule || null;
  const lineSchedule = _ls && Object.keys(_ls).length
    ? Object.entries(_ls).map(([sku, sch]) => sch.mode === 'now'
      ? `- ${sku}: order ONLY the sizes in stock today. Enter nothing for short sizes; list them in \`skipped\` (size-level, with any dates) — do NOT ask about them.`
      : `- ${sku}: order ALL its sizes under delivery date ${sch.date} (use "Add more dates" so this SKU's quantities sit under that date) — even if the wait exceeds 14 days. Do NOT skip or ask.`).join('\n')
    : '(none — follow the strategy and standing decision above)';
  // Prior human comments so the agent can act on answers (e.g. backorder
  // guidance) it received after a previous "needs_input" pass.
  const convo = (conversation || [])
    .map((c) => `- ${c.user_id === botMemberId ? 'Claude' : 'Human'}: ${c.text}`)
    .join('\n') || '(no prior messages)';
  const poInstruction = p.po_number
    ? `Enter the exact Customer PO # "${p.po_number}" on the cart.`
    : `No Customer PO # was provided. Leave that field blank and do not invent one.`;
  const poSteps = p.po_number
    ? `Update the "Customer PO #" field to "${p.po_number}":
a. Click the field to focus it.
b. Press Ctrl+A, then type "${p.po_number}" to replace any pre-filled value.
c. Press Tab (or click elsewhere) to commit it.
d. Re-read the field and confirm it shows exactly "${p.po_number}".
Set \`po_entered: true\` only after confirming the exact value.`
    : `No PO exists for this request. Clear any pre-filled value from the "Customer PO #" field, leave it blank, and do not invent a number. Set \`po_entered: false\`; this is expected and is not an issue.`;
  const poVerify = p.po_number
    ? `"Customer PO #" shows exactly "${p.po_number}".`
    : `"Customer PO #" is blank; no PO was invented.`;
  // A task is a RESUME when any earlier pass already ran it: a stored result
  // (needs_input round-trip, or a timed-out pass whose result was merged into
  // bot_payload) or a prior bot comment in the thread. Resumed passes must
  // audit the existing cart instead of re-adding everything — clicking "ADD
  // ALL TO CART" on an already-filled cart duplicates rows and corrupts
  // quantities, which then burns the whole run reconciling cells.
  const priorPass = !!(p.result || task?.bot_payload?.result
    || (conversation || []).some((c) => c.user_id === botMemberId));
  const resumeMode = priorPass
    ? `THIS IS A RESUME — a previous pass already worked on this cart (its report and any
human answers are in the Conversation section). Do NOT redo the task from scratch:
- Open the ACTIVE cart now, before any searching.
- **SKIP Steps 1–2 for SKUs already in the cart. NEVER click "ADD ALL TO CART" on a
  cart that already has rows** — re-adding duplicates rows and corrupts quantities.
- Audit each existing row against the order: right sizes, right quantities, right
  variant columns. Fix ONLY the cells that are wrong; leave correct cells untouched.
- Search-and-add ONLY the SKUs missing from the cart (individually, from their
  product pages).
- Apply whatever the human's latest answer changed — usually that means touching
  ONE SKU, not rebuilding the cart.
- Verify the PO number and delivery address are still correct; re-enter only if wrong.`
    : `This should be a fresh cart run, but VERIFY that before adding anything: open the
ACTIVE cart via the cart icon. If it's empty (or only has items unrelated to this
order), proceed to Step 1 normally — note any unrelated leftovers in \`issues\` and
leave them alone. If it ALREADY contains rows for this order's SKUs (a previous pass
may have partially filled it), treat this as a resume: do NOT re-add those SKUs and
do NOT click "ADD ALL TO CART" — audit and fix the existing rows in place, and only
search-and-add the SKUs that are missing.`;
  return tpl
    .replaceAll('{{RESUME_MODE}}', resumeMode)
    .replaceAll('{{CONVERSATION}}', convo)
    .replaceAll('{{VENDOR_NAME}}', p.vendor_name || target)
    .replaceAll('{{TARGET}}', target)
    .replaceAll('{{VENDOR_URL}}', creds.url || '(unknown — find it)')
    .replaceAll('{{VENDOR_USER}}', creds.user || '(missing)')
    .replaceAll('{{VENDOR_PASS}}', creds.pass || '(missing)')
    .replaceAll('{{PO_INSTRUCTION}}', poInstruction)
    .replaceAll('{{PO_STEPS}}', poSteps)
    .replaceAll('{{PO_VERIFY}}', poVerify)
    .replaceAll('{{LINES}}', lines)
    .replaceAll('{{TASK_NOTES}}', notes)
    .replaceAll('{{DELIVERY}}', delivery)
    .replaceAll('{{PORTAL_AVAILABILITY}}', portalAvailability)
    .replaceAll('{{BACKORDER_ACTION}}', backorderAction)
    .replaceAll('{{LINE_SCHEDULE}}', lineSchedule)
    .replaceAll('{{DELIVERY_STRATEGY}}', deliveryStrategy)
    .replaceAll('{{DELIVERY_DATE}}', deliveryDate);
}

// Pull the last fenced ```json block (or trailing object) out of the agent text.
export function extractJsonBlock(text) {
  if (!text) return null;
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1][1] : null;
  for (const c of [candidate, text]) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
  }
  return null;
}
