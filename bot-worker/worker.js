// NSA bot worker — the "always-on CSR".
//
// Polls Supabase for tasks assigned to the Claude bot team member, claims one
// at a time, and runs Claude Code (with the Playwright MCP browser tools) to
// carry out the task on a vendor portal. It reports back exactly like a CSR
// would: by updating bot_status and posting a comment on the todo.
//
// It is deliberately "stop before submit": the agent fills the vendor cart and
// parks the task at bot_status='needs_review'. A human approves the submit in
// the portal. The worker itself never places an order.
//
// Run:  node worker.js            (loops forever, polling)
//       RUN_ONCE=1 node worker.js (process at most one task, then exit)

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BOT_MEMBER_ID = 'bot-claude',
  POLL_INTERVAL_MS = '30000',
  CLAUDE_BIN = 'claude',
  // Faster model for mechanical browser-driving. Sonnet is the sweet spot
  // (much quicker than Opus). Uses the 'sonnet' alias so it tracks the current
  // Sonnet without a pinned id; set WORKER_MODEL to override (e.g. 'haiku').
  WORKER_MODEL = 'sonnet',
  WORKER_HOST = hostname(),
  ADIDAS_CLICK_URL = '',
  ADIDAS_CLICK_USER = '',
  ADIDAS_CLICK_PASS = '',
} = process.env;

const WORKER_VERSION = '0.1.0';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[worker] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Copy .env.example to .env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log(new Date().toISOString(), '[worker]', ...a);

// Per-target portal credentials. Extend this map as you add vendors.
function credsForTarget(target) {
  if (target === 'adidas_click') {
    return { url: ADIDAS_CLICK_URL, user: ADIDAS_CLICK_USER, pass: ADIDAS_CLICK_PASS };
  }
  return { url: '', user: '', pass: '' };
}

// Map a vendor name to the external portal slug the worker drives.
function botTargetForVendor(vendorName) {
  const v = String(vendorName || '').toLowerCase();
  if (v.includes('adidas')) return 'adidas_click';
  if (v.includes('silver')) return 'silver_screen';
  if (v.includes('sanmar')) return 'sanmar';
  return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

// Real size:quantity pairs only — the sizes jsonb also carries meta keys
// (drop_ship, unit_cost, etc.) that must not be treated as sizes.
const SIZE_META = new Set(['drop_ship', 'unit_cost', 'po_type', 'vendor', 'memo', 'notes', 'status']);
function cleanSizes(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (SIZE_META.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

// Render the line items into a readable list for the prompt.
function formatLines(lines) {
  return (lines || [])
    .map((l) => {
      const sizes = Object.entries(cleanSizes(l.sizes))
        .map(([sz, v]) => `${sz}:${v}`)
        .join(' ');
      return `- ${l.sku}${l.color ? ' (' + l.color + ')' : ''} — qty ${l.qty}${sizes ? ' [' + sizes + ']' : ''}`;
    })
    .join('\n');
}

// Resolve the real order behind a task from the database when the task has no
// structured payload. Parses the PO number from the title (e.g. "Order PO
// PO 3108 FPUTN — ...") and pulls every line item on that PO (all SKUs, colors,
// exact per-size breakdown), scoped to the task's SO. Returns a payload-shaped
// object {target, vendor_name, po_number, lines} or null if it can't.
async function resolveOrderFromDb(task) {
  // Prefer the explicit po_id column (migration 00116); fall back to parsing title.
  const poId = task.po_id || (() => {
    const m = (task.title || '').match(/PO\s*\d[\w\s.\/-]*/i);
    return m ? m[0].trim() : null;
  })();
  if (!poId) return null;

  const { data: pls, error } = await supabase
    .from('so_item_po_lines')
    .select('so_item_id,po_id,sizes,status,vendor')
    .ilike('po_id', poId);
  if (error || !pls || !pls.length) return null;

  const ids = [...new Set(pls.map((p) => p.so_item_id))];
  const { data: items } = await supabase
    .from('so_items').select('id,sku,name,color,so_id').in('id', ids);
  const byId = Object.fromEntries((items || []).map((i) => [i.id, i]));

  const lines = pls
    .filter((p) => p.status !== 'cancelled')
    .filter((p) => !task.so_id || byId[p.so_item_id]?.so_id === task.so_id)
    .map((p) => {
      const it = byId[p.so_item_id] || {};
      const sizes = cleanSizes(p.sizes);
      const qty = Object.values(sizes).reduce((a, v) => a + v, 0);
      return {
        sku: it.sku,
        name: it.name || '',
        color: it.color || '',
        qty,
        sizes,
        unit_cost: Number((p.sizes || {}).unit_cost) || 0,
        drop_ship: (p.sizes || {}).drop_ship === true,
        vendor: p.vendor || '',
      };
    })
    .filter((l) => l.sku && l.qty > 0);
  if (!lines.length) return null;

  const vendorName = lines.find((l) => l.vendor)?.vendor
    || (lines.find((l) => /adidas/i.test(l.name)) ? 'Adidas' : (lines[0].name || ''));
  const drop_ship = lines.some((l) => l.drop_ship);
  return {
    target: botTargetForVendor(vendorName),
    vendor_name: vendorName || null,
    po_number: poId,
    lines,
    drop_ship,
    ship_to: drop_ship ? await resolveShipTo(task.so_id) : null,
  };
}

// For a drop-ship PO, resolve the program's ship-to address (the customer's
// shipping address, or an alternate ship-to customer if ship_to_id points to
// one). Returns {name,line1,city,state,zip} or null.
async function resolveShipTo(soId) {
  if (!soId) return null;
  const { data: so } = await supabase
    .from('sales_orders').select('customer_id,ship_to_id').eq('id', soId).maybeSingle();
  if (!so) return null;
  const addrCustId = (so.ship_to_id && so.ship_to_id !== 'default') ? so.ship_to_id : so.customer_id;
  const { data: c } = await supabase
    .from('customers')
    .select('name,alpha_tag,shipping_address_line1,shipping_city,shipping_state,shipping_zip')
    .eq('id', addrCustId).maybeSingle();
  if (!c || !(c.shipping_address_line1 || c.shipping_city)) return null;
  return {
    name: c.name || c.alpha_tag || '',
    line1: c.shipping_address_line1 || '',
    city: c.shipping_city || '',
    state: c.shipping_state || '',
    zip: c.shipping_zip || '',
  };
}

function buildPrompt(task, p = {}, conversation = []) {
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
    ? `THIS IS A DROP SHIP — the order must deliver directly to the program below, NOT National Sports' default address.\n`
      + `On the cart's Delivery Location, click it and choose "Add one-time delivery location", then fill the form exactly:\n`
      + `- Attention 1: ${s.name}\n`
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
    .map((c) => `- ${c.user_id === BOT_MEMBER_ID ? 'Claude' : 'Human'}: ${c.text}`)
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

// Run Claude Code headlessly with the Playwright MCP. Returns the parsed
// {status, summary, ...} the agent emits in its final ```json block.
function runClaude(prompt) {
  return new Promise((resolve) => {
    // WORKER_DEBUG=1 streams each agent step (navigate/click/type) to the
    // terminal so a run isn't a black box.
    const debug = !!process.env.WORKER_DEBUG;
    const args = [
      '-p', prompt,
      '--output-format', debug ? 'stream-json' : 'json',
      ...(debug ? ['--verbose'] : []),
      ...(WORKER_MODEL ? ['--model', WORKER_MODEL] : []),
      '--mcp-config', join(__dirname, 'mcp.json'),
      // The agent must drive the browser without interactive approval on a
      // headless worker. Scope this down if you prefer (see SETUP.md).
      '--allowedTools', 'mcp__playwright__*',
      // Block the agent from delegating to a background workflow/subagent (it
      // would hang waiting for a notification that never arrives headless).
      '--disallowedTools', 'Workflow', 'Task', 'TaskOutput', 'TaskGet', 'TaskStop',
      '--dangerously-skip-permissions',
    ];
    // Close stdin (no piped input) to avoid the "no stdin data received" wait.
    const child = spawn(CLAUDE_BIN, args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let streamResult = null;
    if (debug) {
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        const nl = buf.lastIndexOf('\n');
        if (nl < 0) return;
        for (const line of buf.slice(0, nl).split('\n')) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'assistant' && ev.message?.content) {
              for (const c of ev.message.content) {
                if (c.type === 'text' && c.text?.trim()) log('🗣 ', c.text.trim().slice(0, 200));
                if (c.type === 'tool_use') log('🔧', c.name, JSON.stringify(c.input).slice(0, 200));
              }
            } else if (ev.type === 'result') {
              streamResult = ev.result || '';
              log('✅ result:', streamResult.slice(0, 200));
            }
          } catch { /* non-JSON line */ }
        }
        buf = buf.slice(nl + 1);
      });
    }
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    // Safety net: kill + report a stuck run instead of hanging forever.
    // 20 min. The historical 10-min cap killed nearly every cart run mid-flight
    // (agent never reached the PO/address/sizes steps); the add-all search flow
    // is much faster, but give real orders room to finish.
    const timeoutMs = parseInt(process.env.RUN_TIMEOUT_MS || '1200000', 10);
    const killer = setTimeout(() => {
      log(`run exceeded ${timeoutMs}ms — terminating`);
      try { child.kill('SIGKILL'); } catch {}
      finish({ status: 'queued', summary: `Timed out after ${Math.round(timeoutMs / 1000)}s — resetting to queued for retry.` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(killer); finish({ status: 'queued', summary: 'Could not launch Claude: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (done) return;
      if (err.trim()) log('claude stderr:', err.trim().slice(0, 500));
      // --output-format json wraps the run; the agent's text is in `.result`.
      // In debug (stream-json) mode the result text came from the result event.
      let resultText = (debug && streamResult != null) ? streamResult : out;
      try { resultText = JSON.parse(resultText).result ?? resultText; } catch { /* not JSON-wrapped */ }
      const parsed = extractJsonBlock(resultText);
      if (parsed) return finish(parsed);
      finish({
        status: code === 0 ? 'needs_review' : 'failed',
        summary: (resultText || 'No output from agent.').trim().slice(0, 800),
      });
    });
  });
}

// Pull the last fenced ```json block (or trailing object) out of the agent text.
function extractJsonBlock(text) {
  if (!text) return null;
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1][1] : null;
  for (const c of [candidate, text]) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
  }
  return null;
}

// Tell the portal we're awake. status='working' while on a task, else 'idle'.
// Best-effort: a heartbeat failure must never stop the worker.
async function heartbeat(status = 'idle', currentTaskId = null) {
  const { error } = await supabase.from('bot_heartbeats').upsert(
    {
      bot_id: BOT_MEMBER_ID,
      status,
      current_task_id: currentTaskId,
      host: WORKER_HOST,
      version: WORKER_VERSION,
      last_seen: new Date().toISOString(),
    },
    { onConflict: 'bot_id' },
  );
  if (error) log('heartbeat failed:', error.message);
}

async function comment(todoId, text) {
  const { error } = await supabase.from('todo_comments').insert({
    id: 'cmt-bot-' + Date.now(),
    todo_id: todoId,
    user_id: BOT_MEMBER_ID,
    text,
    created_at: new Date().toISOString(),
  });
  if (error) log('comment insert failed:', error.message);
}

// Atomically claim a queued task so two workers never grab the same one.
async function claim(task) {
  const { data, error } = await supabase
    .from('assigned_todos')
    .update({ bot_status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', task.id)
    .in('bot_status', ['queued', 'scheduled'])
    .select('id')
    .maybeSingle();
  if (error) { log('claim error:', error.message); return false; }
  return !!data;
}

async function processOne() {
  // Pick up tasks that are ready to run: queued now, or scheduled for later
  // whose time has arrived. (needs_input/needs_review wait for a human; a reply
  // flips them back to 'queued' in the portal.)
  const { data: tasks, error } = await supabase
    .from('assigned_todos')
    .select('id,title,description,so_id,po_id,bot_payload,bot_status,status')
    .eq('assigned_to', BOT_MEMBER_ID)
    .eq('status', 'open')
    .in('bot_status', ['queued', 'scheduled'])
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) { log('poll error:', error.message); return false; }
  const now = Date.now();
  // Skip scheduled tasks whose run time hasn't arrived yet.
  const task = (tasks || []).find((t) => {
    const when = t.bot_payload?.scheduled_for;
    return !when || new Date(when).getTime() <= now;
  });
  if (!task) return false;

  if (!(await claim(task))) return false; // someone else got it
  log('claimed task', task.id, '—', task.title);
  await heartbeat('working', task.id);

  // Load the comment thread so Claude sees any human answers (e.g. how to
  // handle a backorder it asked about on a previous pass).
  let conversation = [];
  try {
    const { data: cmts } = await supabase
      .from('todo_comments').select('user_id,text,created_at')
      .eq('todo_id', task.id).order('created_at', { ascending: true });
    conversation = cmts || [];
  } catch (e) { log('comments fetch error:', e?.message || e); }

  let order = null;
  let result;
  try {
    // Prefer the structured payload (batch button); otherwise pull the real PO
    // line items from the DB; otherwise fall back to the task notes.
    order = (task.bot_payload && Array.isArray(task.bot_payload.lines) && task.bot_payload.lines.length)
      ? task.bot_payload
      : null;
    if (!order) {
      try { order = await resolveOrderFromDb(task); } catch (e) { log('resolveOrder error:', e?.message || e); }
    }
    // Drop-ship: make sure we have the program's ship-to address even when the
    // order came from a structured payload that didn't include it.
    if (order && order.drop_ship && !order.ship_to && task.so_id) {
      try { order.ship_to = await resolveShipTo(task.so_id); } catch (e) { log('resolveShipTo error:', e?.message || e); }
    }
    if (order) log(`order resolved: ${order.lines.length} line(s), PO ${order.po_number || '?'}, vendor ${order.vendor_name || order.target}${order.drop_ship ? ' · DROP SHIP' + (order.ship_to ? ' → ' + order.ship_to.name : ' (no address!)') : ''} · model ${WORKER_MODEL || 'default'}`);
    else log('no structured order — running from task notes');
    result = await runClaude(buildPrompt(task, order || {}, conversation));
  } catch (e) {
    result = { status: 'failed', summary: 'Worker exception: ' + (e?.message || e) };
  }

  // needs_input = the bot has a question (e.g. a backorder) and is waiting on a
  // human answer. Replying in the portal re-queues the task so it resumes.
  const ALLOWED = ['needs_review', 'needs_input', 'blocked', 'failed', 'queued'];
  let status = ALLOWED.includes(result.status) ? result.status : 'needs_review';

  // Sanity-check: skipped SKUs (out of stock beyond the 14-day window) always
  // need a rep decision — never let them slide through as needs_review.
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  if (status === 'needs_review' && skipped.length) {
    status = 'needs_input';
    if (!result.question) {
      result.question = 'These SKUs were skipped (sizes unavailable now and not restocking within 14 days): '
        + skipped.map((s) => `${s.sku} (${s.sizes || '?'} — restock ${s.restock || 'no date'})`).join('; ')
        + '. Wait for restock, substitute, or drop them?';
    }
  }

  // Sanity-check: if the agent says needs_review but reports 0 total qty across
  // all lines, the cart wasn't actually filled — downgrade to blocked so a human
  // investigates rather than assuming the order is ready to submit.
  if (status === 'needs_review' && Array.isArray(result.lines_added) && result.lines_added.length > 0) {
    const totalAdded = result.lines_added.reduce((a, l) => a + (l.qty || 0), 0);
    if (totalAdded === 0) {
      log('agent said needs_review but lines_added total qty is 0 — downgrading to blocked');
      status = 'blocked';
      result.summary = (result.summary || '') + ' (No quantities were entered — all size cells may be unavailable.)';
    }
  }
  const merged = { ...(task.bot_payload || {}), ...(order || {}), result };
  await supabase
    .from('assigned_todos')
    .update({ bot_status: status, bot_payload: merged, updated_at: new Date().toISOString() })
    .eq('id', task.id);

  // If reset to queued (e.g. Claude binary not found), skip the comment — it'll retry silently.
  if (status === 'queued') { log('task', task.id, 'reset to queued for retry:', result.summary); await heartbeat('idle', null); return true; }

  const emoji = status === 'needs_review' ? '🛒' : status === 'needs_input' ? '❓' : status === 'blocked' ? '🚧' : '❌';
  const reportLines = [
    `${emoji} **Bot ${status}** — ${result.summary || ''}`,
    result.question ? `**Question:** ${result.question}` : '',
    result.cart_url ? `Cart: ${result.cart_url}` : '',
    result.po_entered ? `PO entered: yes` : '',
    result.address_set ? `Delivery address set: yes` : '',
    skipped.length ? `⏭️ Skipped (rep decision needed): ${skipped.map((s) => `${s.sku} (${s.sizes || '?'} — restock ${s.restock || 'no date'})`).join('; ')}` : '',
    (result.backordered && result.backordered.length) ? `⏳ Backordered: ${result.backordered.join('; ')}` : '',
    (result.issues && result.issues.length) ? `Issues: ${result.issues.join('; ')}` : '',
    status === 'needs_review' ? `Review the cart and submit it if it looks right, then close this task.` : '',
    status === 'needs_input' ? `Reply on this task to tell Claude how to proceed — it will resume automatically.` : '',
  ].filter(Boolean).join('\n');
  await comment(task.id, reportLines);
  await heartbeat('idle', null);

  log('finished task', task.id, '→', status);
  return true;
}

async function loop() {
  const interval = parseInt(POLL_INTERVAL_MS, 10) || 30000;
  log(`started. bot=${BOT_MEMBER_ID} interval=${interval}ms`);
  for (;;) {
    try {
      await heartbeat('idle', null);
      while (await processOne()) { /* drain backlog */ }
    } catch (e) {
      log('loop error:', e?.message || e);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (process.env.RUN_ONCE) {
  processOne().then((did) => { log(did ? 'processed one task.' : 'no queued tasks.'); process.exit(0); });
} else {
  loop();
}
