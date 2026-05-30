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
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { hostname } from 'node:os';

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

// Render the line items into a readable list for the prompt.
function formatLines(lines) {
  return (lines || [])
    .map((l) => {
      const sizes = Object.entries(l.sizes || {})
        .filter(([, v]) => v > 0)
        .map(([sz, v]) => `${sz}:${v}`)
        .join(' ');
      return `- ${l.sku}${l.color ? ' (' + l.color + ')' : ''} — qty ${l.qty}${sizes ? ' [' + sizes + ']' : ''}`;
    })
    .join('\n');
}

function buildPrompt(task) {
  const p = task.bot_payload || {};
  const creds = credsForTarget(p.target);
  const tpl = readFileSync(join(__dirname, 'prompts', 'add_to_cart.md'), 'utf8');
  return tpl
    .replaceAll('{{VENDOR_NAME}}', p.vendor_name || p.target || 'vendor')
    .replaceAll('{{TARGET}}', p.target || 'unknown')
    .replaceAll('{{VENDOR_URL}}', creds.url || '(unknown — find it)')
    .replaceAll('{{VENDOR_USER}}', creds.user || '(missing)')
    .replaceAll('{{VENDOR_PASS}}', creds.pass || '(missing)')
    .replaceAll('{{PO_NUMBER}}', p.po_number || '(none)')
    .replaceAll('{{LINES}}', formatLines(p.lines));
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
    const child = spawn(CLAUDE_BIN, args, { cwd: __dirname });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ status: 'failed', summary: 'Could not launch Claude: ' + e.message }));
    child.on('close', (code) => {
      if (err.trim()) log('claude stderr:', err.trim().slice(0, 500));
      // --output-format json wraps the run; the agent's text is in `.result`.
      let resultText = out;
      try { resultText = JSON.parse(out).result ?? out; } catch { /* not JSON-wrapped */ }
      const parsed = extractJsonBlock(resultText);
      if (parsed) return resolve(parsed);
      resolve({
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
    author_id: BOT_MEMBER_ID,
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
    .select('id,title,bot_payload,bot_status,status')
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

  let result;
  try {
    result = await runClaude(buildPrompt(task));
  } catch (e) {
    result = { status: 'failed', summary: 'Worker exception: ' + (e?.message || e) };
  }

  const status = ['needs_review', 'blocked', 'failed'].includes(result.status) ? result.status : 'needs_review';
  const merged = { ...(task.bot_payload || {}), result };
  await supabase
    .from('assigned_todos')
    .update({ bot_status: status, bot_payload: merged, updated_at: new Date().toISOString() })
    .eq('id', task.id);

  const emoji = status === 'needs_review' ? '🛒' : status === 'blocked' ? '🚧' : '❌';
  const lines = [
    `${emoji} **Bot ${status}** — ${result.summary || ''}`,
    result.cart_url ? `Cart: ${result.cart_url}` : '',
    result.po_entered ? `PO entered: yes` : '',
    (result.issues && result.issues.length) ? `Issues: ${result.issues.join('; ')}` : '',
    status === 'needs_review' ? `Review the cart and submit it if it looks right, then close this task.` : '',
  ].filter(Boolean).join('\n');
  await comment(task.id, lines);

  log('finished task', task.id, '→', status);
  return true;
}

async function loop() {
  const interval = parseInt(POLL_INTERVAL_MS, 10) || 30000;
  log(`started. bot=${BOT_MEMBER_ID} interval=${interval}ms`);
  for (;;) {
    try {
      await heartbeat('idle');
      // Drain any backlog, then wait for the next poll.
      while (await processOne()) { /* keep going */ }
      await heartbeat('idle');
    } catch (e) {
      log('loop error:', e?.message || e);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (process.env.RUN_ONCE) {
  heartbeat('idle')
    .then(() => processOne())
    .then((did) => { log(did ? 'processed one task.' : 'no queued tasks.'); return heartbeat('idle'); })
    .then(() => process.exit(0));
} else {
  loop();
}
