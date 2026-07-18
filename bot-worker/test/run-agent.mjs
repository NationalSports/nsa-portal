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
const PORT = parseInt(process.env.MOCK_PORT || '4599', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const MODEL = process.env.WORKER_MODEL || 'sonnet';
const TIMEOUT_MS = parseInt(process.env.RUN_TIMEOUT_MS || '1200000', 10);

const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ---- fixture orders (what the portal task would resolve) ----
// Scenarios:  node test/run-agent.mjs [scenario]   (set MOCK_PORT to run several in parallel)
//   warehouse (default) — mixed order, default address, 14-day skip + short backorder
//   dropship            — same order, one-time delivery address
//   oos                 — one line item completely unavailable (no restock date)
//   multi               — several items, everything in stock (clean needs_review path)
//   onesize             — single SKU with exactly one size on a short (7-day) backorder
// Mock fixtures: JW6608 all in stock · JW6600 only L restocks +7d · KB5529 only M
// restocks +30d · KE9493 permanently unavailable (all hatched, no date).
const SCENARIO = ['dropship', 'oos', 'multi', 'onesize'].includes(process.argv[2]) ? process.argv[2] : 'warehouse';
const SHIP_TO = { name: 'Fresno Pacific Tennis', line1: '1717 S Chestnut Ave', city: 'Fresno', state: 'CA', zip: '93702' };
const LINES = {
  warehouse: [
    { sku: 'JW6608', name: 'Team Issue Polo', color: 'Black', qty: 23, sizes: { XS: 2, S: 11, M: 8, L: 2 } },
    { sku: 'JW6600', name: 'Tiro25 Jacket', color: 'Team Royal', qty: 10, sizes: { S: 5, L: 5 } },
    { sku: 'KB5529', name: 'Icon Pro Pant', color: 'White', qty: 15, sizes: { M: 10, L: 5 } },
  ],
  oos: [
    { sku: 'JW6608', name: 'Team Issue Polo', color: 'Black', qty: 12, sizes: { S: 4, M: 4, L: 4 } },
    { sku: 'KE9493', name: 'Legend Hoodie', color: 'Grey', qty: 10, sizes: { M: 5, L: 5 } },
  ],
  multi: [
    { sku: 'JW6608', name: 'Team Issue Polo', color: 'Black', qty: 23, sizes: { XS: 2, S: 11, M: 8, L: 2 } },
    { sku: 'JW6600', name: 'Tiro25 Jacket', color: 'Team Royal', qty: 12, sizes: { S: 6, M: 6 } },
    { sku: 'KB5529', name: 'Icon Pro Pant', color: 'White', qty: 10, sizes: { S: 5, L: 5 } },
  ],
  onesize: [
    { sku: 'JW6600', name: 'Tiro25 Jacket', color: 'Team Royal', qty: 10, sizes: { S: 5, L: 5 } },
  ],
};
LINES.dropship = LINES.warehouse;
const task = { id: 'todo-test', title: `Order PO PO 9999 TEST — fake-order dress rehearsal (${SCENARIO})` };
const order = {
  target: 'adidas_click',
  vendor_name: 'Adidas (MOCK)',
  po_number: 'PO 9999 TEST',
  drop_ship: SCENARIO === 'dropship',
  ship_to: SCENARIO === 'dropship' ? SHIP_TO : null,
  lines: LINES[SCENARIO],
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
// Per-scenario expectations. enter = exact per-size quantities the bot should
// have committed; skip = SKUs it must leave empty AND surface to the rep;
// date = expected cart delivery date; status = expected final status.
const EXPECT = {
  warehouse: {
    enter: { JW6608: { XS: 2, S: 11, M: 8, L: 2 }, JW6600: { S: 5, L: 5 } },
    skip: ['KB5529'], date: daysFromNow(7), status: 'needs_input',
  },
  dropship: {
    enter: { JW6608: { XS: 2, S: 11, M: 8, L: 2 }, JW6600: { S: 5, L: 5 } },
    skip: ['KB5529'], date: daysFromNow(7), status: 'needs_input',
  },
  oos: {
    enter: { JW6608: { S: 4, M: 4, L: 4 } },
    skip: ['KE9493'], date: daysFromNow(0), status: 'needs_input',
  },
  multi: {
    enter: { JW6608: { XS: 2, S: 11, M: 8, L: 2 }, JW6600: { S: 6, M: 6 }, KB5529: { S: 5, L: 5 } },
    skip: [], date: daysFromNow(0), status: 'needs_review',
  },
  onesize: {
    enter: { JW6600: { S: 5, L: 5 } },
    skip: [], date: daysFromNow(7), status: 'needs_review',
  },
}[SCENARIO];
const orderSkus = order.lines.map((l) => l.sku);

console.log(`\n[run-agent] grading portal state (scenario: ${SCENARIO}):`);
check('agent finished with a JSON report', !result._timeout && !result._noJson, JSON.stringify(result).slice(0, 200));
check('logged in', s.loggedIn === true);
check(`all ${orderSkus.length} SKU(s) reached the cart`, orderSkus.every((k) => s.cart.includes(k)), JSON.stringify(s.cart));
check('used add-all (single search), not per-SKU adds', s.log.some((l) => l.action === 'add_all' && l.skus.length === orderSkus.length),
  JSON.stringify(s.log.filter((l) => l.action === 'add_all' || l.action === 'add_one')));
check('PO replaced (not the pre-filled account name)', s.po === 'PO 9999 TEST', s.po);
if (SCENARIO === 'dropship') {
  check('one-time drop-ship address entered exactly', s.address.type === 'one_time'
    && s.address.line1 === SHIP_TO.line1 && s.address.city === SHIP_TO.city
    && s.address.state === SHIP_TO.state && s.address.zip === SHIP_TO.zip, JSON.stringify(s.address));
} else {
  check('delivery address left as default warehouse', s.address.type === 'default', JSON.stringify(s.address));
}
check(`delivery date is ${EXPECT.date}${EXPECT.date === daysFromNow(0) ? ' (unchanged)' : ' (shifted for short backorder)'}`,
  s.deliveryDate === EXPECT.date, s.deliveryDate);
for (const [sku, sizes] of Object.entries(EXPECT.enter)) {
  check(`${sku} quantities exact`, Object.entries(sizes).every(([sz, q]) => s.quantities[sku]?.[sz] === q)
    && Object.keys(s.quantities[sku] || {}).length === Object.keys(sizes).length, JSON.stringify(s.quantities[sku]));
}
for (const sku of EXPECT.skip) {
  check(`${sku} skipped — NO quantities entered`, !s.quantities[sku] || Object.keys(s.quantities[sku]).length === 0,
    JSON.stringify(s.quantities[sku]));
  check(`agent surfaced skipped SKU ${sku} to the rep`,
    JSON.stringify([result.skipped, result.question, result.issues] || '').includes(sku), JSON.stringify(result.skipped));
}
check('order NOT submitted', s.submitted === false);
check(`agent status is ${EXPECT.status}`, result.status === EXPECT.status, result.status);
check('agent reported po_entered', result.po_entered === true);
check('agent reported address_set', result.address_set === true);
if (EXPECT.status === 'needs_review') {
  check('no SKUs reported skipped', !(result.skipped || []).length, JSON.stringify(result.skipped));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\n🎉 Fake-order dress rehearsal PASSED');
process.exit(failures ? 1 : 0);
