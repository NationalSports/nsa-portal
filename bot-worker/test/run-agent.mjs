// Fake-order dress rehearsal: run the REAL agent (claude CLI + Playwright MCP,
// exact production prompt from lib.js/add_to_cart.md) against the mock CLICK
// portal, then grade the recorded portal state against the expected outcome.
//
// The fixture order exercises every rule at once:
//   - JW6608: fully in stock            → full quantities expected
//   - JW6600: L restocks in 7 days      → orderable; cart delivery date moves
//   - KB5529: M restocks in 30 days     → SKIP whole SKU, needs_input
//
// Run:  node test/run-agent.mjs            (uses sonnet, like production)
//       WORKER_MODEL=haiku node test/run-agent.mjs
//
// This never touches adidas — the "portal" is 127.0.0.1.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPrompt, extractJsonBlock } from '../lib.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
const MODEL = process.env.WORKER_MODEL || 'sonnet';
const TIMEOUT_MS = parseInt(process.env.RUN_TIMEOUT_MS || '1200000', 10);

const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ---- fixture order (what the portal task would resolve) ----
const task = { id: 'todo-test', title: 'Order PO PO 9999 TEST — fake-order dress rehearsal' };
const order = {
  target: 'adidas_click',
  vendor_name: 'Adidas (MOCK)',
  po_number: 'PO 9999 TEST',
  drop_ship: false,
  lines: [
    { sku: 'JW6608', name: 'Team Issue Polo', color: 'Black', qty: 23, sizes: { XS: 2, S: 11, M: 8, L: 2 } },
    { sku: 'JW6600', name: 'Tiro25 Jacket', color: 'Team Royal', qty: 10, sizes: { S: 5, L: 5 } },
    { sku: 'KB5529', name: 'Icon Pro Pant', color: 'White', qty: 15, sizes: { M: 10, L: 5 } },
  ],
};
const credsForTarget = () => ({ url: BASE, user: 'testrep', pass: 'test123' });
const prompt = buildPrompt(task, order, [], { credsForTarget });

// ---- start mock portal ----
const mock = spawn(process.execPath, [join(__dirname, 'mock-portal.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const state = async () => (await (await fetch(`${BASE}/api/state`)).json());

// ---- run the agent exactly like worker.js runClaude does ----
console.log(`[run-agent] model=${MODEL} timeout=${TIMEOUT_MS / 1000}s — streaming agent steps:`);
const result = await new Promise((resolve) => {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--model', MODEL,
    '--mcp-config', join(__dirname, 'mcp.test.json'),
    '--allowedTools', 'mcp__playwright__*',
    '--disallowedTools', 'Workflow', 'Task', 'TaskOutput', 'TaskGet', 'TaskStop',
    '--dangerously-skip-permissions',
  ];
  const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  let streamResult = '';
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
            if (c.type === 'text' && c.text?.trim()) console.log('  🗣', c.text.trim().slice(0, 160));
            if (c.type === 'tool_use') console.log('  🔧', c.name, JSON.stringify(c.input).slice(0, 140));
          }
        } else if (ev.type === 'result') streamResult = ev.result || '';
      } catch { /* non-JSON */ }
    }
    buf = buf.slice(nl + 1);
  });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ _timeout: true }); }, TIMEOUT_MS);
  child.on('close', () => {
    clearTimeout(killer);
    if (err.trim()) console.log('[run-agent] claude stderr:', err.trim().slice(0, 400));
    resolve(extractJsonBlock(streamResult) || { _noJson: true, raw: streamResult.slice(0, 800) });
  });
});

// ---- grade ----
const s = await state();
mock.kill();

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${cond ? '' : '  — ' + String(detail).slice(0, 200)}`);
  if (!cond) failures++;
};

console.log('\n[run-agent] agent result:', JSON.stringify(result, null, 2).slice(0, 1500));
console.log('\n[run-agent] portal action log:', JSON.stringify(s.log, null, 1));
console.log('\n[run-agent] grading portal state:');
check('agent finished with a JSON report', !result._timeout && !result._noJson, JSON.stringify(result).slice(0, 200));
check('logged in', s.loggedIn === true);
check('all 3 SKUs reached the cart', ['JW6608', 'JW6600', 'KB5529'].every((k) => s.cart.includes(k)), JSON.stringify(s.cart));
check('used add-all (single search), not per-SKU adds', s.log.some((l) => l.action === 'add_all' && l.skus.length === 3),
  JSON.stringify(s.log.filter((l) => l.action === 'add_all' || l.action === 'add_one')));
check('PO replaced (not the pre-filled account name)', s.po === 'PO 9999 TEST', s.po);
check('delivery address left as default warehouse', s.address.type === 'default', JSON.stringify(s.address));
check('delivery date moved to the short restock (+7d)', s.deliveryDate === daysFromNow(7), s.deliveryDate);
check('JW6608 quantities exact', s.quantities.JW6608?.XS === 2 && s.quantities.JW6608?.S === 11
  && s.quantities.JW6608?.M === 8 && s.quantities.JW6608?.L === 2, JSON.stringify(s.quantities.JW6608));
check('JW6600 quantities exact (incl. short-backorder L)', s.quantities.JW6600?.S === 5 && s.quantities.JW6600?.L === 5,
  JSON.stringify(s.quantities.JW6600));
check('KB5529 skipped — NO quantities entered', !s.quantities.KB5529 || Object.keys(s.quantities.KB5529).length === 0,
  JSON.stringify(s.quantities.KB5529));
check('order NOT submitted', s.submitted === false);
check('agent status is needs_input (skip needs the rep)', result.status === 'needs_input', result.status);
check('agent reported the skipped SKU', JSON.stringify(result.skipped || result.question || '').includes('KB5529'),
  JSON.stringify(result.skipped));
check('agent reported po_entered', result.po_entered === true);
check('agent reported address_set', result.address_set === true);

console.log(failures ? `\n${failures} check(s) FAILED` : '\n🎉 Fake-order dress rehearsal PASSED');
process.exit(failures ? 1 : 0);
