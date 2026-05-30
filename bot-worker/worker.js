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
  const m = (task.title || '').match(/PO\s*\d[\w\s.\/-]*/i);
  const poId = m ? m[0].trim() : null;
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
  return {
    target: botTargetForVendor(vendorName),
    vendor_name: vendorName || null,
    po_number: poId,
    lines,
  };
}

function buildPrompt(task, p = {}) {
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
  return tpl
    .replaceAll('{{VENDOR_NAME}}', p.vendor_name || target)
    .replaceAll('{{TARGET}}', target)
    .replaceAll('{{VENDOR_URL}}', creds.url || '(unknown — find it)')
    .replaceAll('{{VENDOR_USER}}', creds.user || '(missing)')
    .replaceAll('{{VENDOR_PASS}}', creds.pass || '(missing)')
    .replaceAll('{{PO_NUMBER}}', p.po_number || '(see task notes)')
    .replaceAll('{{LINES}}', lines)
    .replaceAll('{{TASK_NOTES}}', notes);
}

// Run Claude Code headlessly with the Playwright MCP. Returns the parsed
// {status, summary, ...} the agent emits in its final ```json block.
function runClaude(prompt) {
  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--mcp-config', join(__dirname, 'mcp.json'),
      // The agent must drive the browser without interactive approval on a
      // headless worker. Scope this down if you prefer (see SETUP.md).
      '--allowedTools', 'mcp__playwright__*',
      '--dangerously-skip-permissions',
    ];
    // Close stdin (no piped input) to avoid the "no stdin data received" wait.
    const child = spawn(CLAUDE_BIN, args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    // Safety net: kill + report a stuck run instead of hanging forever.
    const timeoutMs = parseInt(process.env.RUN_TIMEOUT_MS || '600000', 10);
    const killer = setTimeout(() => {
      log(`run exceeded ${timeoutMs}ms — terminating`);
      try { child.kill('SIGKILL'); } catch {}
      finish({ status: 'failed', summary: `Timed out after ${Math.round(timeoutMs / 1000)}s — the agent did not finish (likely stuck on the vendor site).` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(killer); finish({ status: 'failed', summary: 'Could not launch Claude: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (done) return;
      if (err.trim()) log('claude stderr:', err.trim().slice(0, 500));
      // --output-format json wraps the run; the agent's text is in `.result`.
      let resultText = out;
      try { resultText = JSON.parse(out).result ?? out; } catch { /* not JSON-wrapped */ }
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
    .eq('bot_status', 'queued')
    .select('id')
    .maybeSingle();
  if (error) { log('claim error:', error.message); return false; }
  return !!data;
}

async function processOne() {
  const { data: tasks, error } = await supabase
    .from('assigned_todos')
    .select('id,title,description,so_id,bot_payload,bot_status,status')
    .eq('assigned_to', BOT_MEMBER_ID)
    .eq('status', 'open')
    .eq('bot_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) { log('poll error:', error.message); return false; }
  const task = tasks?.[0];
  if (!task) return false;

  if (!(await claim(task))) return false; // someone else got it
  log('claimed task', task.id, '—', task.title);
  await heartbeat('working', task.id);

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
    if (order) log(`order resolved: ${order.lines.length} line(s), PO ${order.po_number || '?'}, vendor ${order.vendor_name || order.target}`);
    else log('no structured order — running from task notes');
    result = await runClaude(buildPrompt(task, order || {}));
  } catch (e) {
    result = { status: 'failed', summary: 'Worker exception: ' + (e?.message || e) };
  }

  const status = ['needs_review', 'blocked', 'failed'].includes(result.status) ? result.status : 'needs_review';
  const merged = { ...(task.bot_payload || {}), ...(order || {}), result };
  await supabase
    .from('assigned_todos')
    .update({ bot_status: status, bot_payload: merged, updated_at: new Date().toISOString() })
    .eq('id', task.id);

  const emoji = status === 'needs_review' ? '🛒' : status === 'blocked' ? '🚧' : '❌';
  const reportLines = [
    `${emoji} **Bot ${status}** — ${result.summary || ''}`,
    result.cart_url ? `Cart: ${result.cart_url}` : '',
    result.po_entered ? `PO entered: yes` : '',
    (result.issues && result.issues.length) ? `Issues: ${result.issues.join('; ')}` : '',
    status === 'needs_review' ? `Review the cart and submit it if it looks right, then close this task.` : '',
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
