// Shared prompt-building logic for the NSA bot worker. Extracted from
// worker.js so the fake-order test harness (test/) runs the agent with the
// exact same prompt the production worker builds.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Real size:quantity pairs only — the sizes jsonb also carries meta keys
// (drop_ship, unit_cost, etc.) that must not be treated as sizes.
const SIZE_META = new Set(['drop_ship', 'unit_cost', 'po_type', 'vendor', 'memo', 'notes', 'status', 'ship_to', 'attention']);
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
    ? `THIS IS A DROP SHIP — the order must deliver directly to the ${s.attention ? 'decorator' : 'program'} below, NOT National Sports' default address.\n`
      + `On the cart's Delivery Location, click it and choose "Add one-time delivery location", then fill the form exactly:\n`
      + `- Attention 1: ${s.attention ? `${s.name} — ${s.attention}` : s.name}\n`
      + (s.attention ? `  (If the form has a separate "Attention 2" line, put "${s.name}" in Attention 1 and "${s.attention}" in Attention 2 instead. The "${s.attention}" reference MUST appear on an attention line either way — the decorator uses it to match the incoming blanks to their job.)\n` : '')
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
  // Prior human comments so the agent can act on answers (e.g. backorder
  // guidance) it received after a previous "needs_input" pass.
  const convo = (conversation || [])
    .map((c) => `- ${c.user_id === botMemberId ? 'Claude' : 'Human'}: ${c.text}`)
    .join('\n') || '(no prior messages)';
  return tpl
    .replaceAll('{{CONVERSATION}}', convo)
    .replaceAll('{{VENDOR_NAME}}', p.vendor_name || target)
    .replaceAll('{{TARGET}}', target)
    .replaceAll('{{VENDOR_URL}}', creds.url || '(unknown — find it)')
    .replaceAll('{{VENDOR_USER}}', creds.user || '(missing)')
    .replaceAll('{{VENDOR_PASS}}', creds.pass || '(missing)')
    .replaceAll('{{PO_NUMBER}}', p.po_number || '(see task notes)')
    .replaceAll('{{LINES}}', lines)
    .replaceAll('{{TASK_NOTES}}', notes)
    .replaceAll('{{DELIVERY}}', delivery)
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
