// Network-capture sidecar for CLICK cart runs — Phase 1 of
// ADIDAS_CLICK_FAST_ORDER_ENTRY_SPEC_2026-08-12.md.
//
// WHY THIS SHAPE: the worker doesn't drive Playwright itself; it runs Claude Code with the
// Playwright MCP server, which launches its own browser. @playwright/mcp has no HAR/trace flag
// (checked: only --save-session, which logs tool calls, not traffic). So instead of rewriting the
// run or guessing CLICK's selectors, this launches the browser, watches every request on it, and
// hands the agent the SAME browser over CDP. The agent's behaviour is unchanged; we just get to
// see the wire.
//
//   1. node capture/capture-sidecar.mjs                 → prints the CDP endpoint, starts capturing
//   2. add  "--cdp-endpoint", "http://127.0.0.1:9222"   to mcp.json's playwright args
//   3. run the normal cart task
//   4. Ctrl-C the sidecar                                → writes network.jsonl + endpoints.md
//
// SAFETY: requests whose URL looks like order submission are ABORTED in code (DENY below), so a
// capture run cannot place an order on CLICK even if the agent or a stray click tries to. This is
// a mechanism, not an instruction — see the spec's "cart-safety gate" for the rest of the
// procedure (empty cart first, ZZ-TEST-DISCOVERY PO, clean up after).
//
// PRIVACY: bodies and headers carry session material and dealer pricing. Header VALUES are never
// written (names only); request bodies are redacted for credential-ish keys and truncated;
// response bodies are reduced to their JSON key shape. Captures are gitignored.
//
// Self-test (no CLICK involved — drives the bundled mock portal and asserts both that traffic is
// captured and that submission is blocked):  node capture/capture-sidecar.mjs --self-test

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_TEST = process.argv.includes('--self-test');
const CDP_PORT = Number(process.env.CAPTURE_CDP_PORT || 9222);
const MOCK_PORT = 4601;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// Anything that could commit an order. Evaluated against the full URL, case-insensitive.
const DENY = /checkout|place_?order|submit_?order|\/submit\b|payment|purchase|confirm_?order/i;

// Request-body keys whose values must never be written to disk.
const SECRET_KEY = /pass|password|secret|token|auth|csrf|credit|card|cvv/i;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(HERE, 'captures', stamp);
mkdirSync(outDir, { recursive: true });
const wire = join(outDir, 'network.jsonl');

const seen = [];   // {method, path, statuses:Set, count}
let blocked = 0;
let captured = 0;

const pathOf = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };

// A body reduced to something safe to keep: JSON → key list (values dropped except short
// non-secret scalars); form-encoded → field names; anything else → just its length.
function shapeBody(text) {
  if (!text) return null;
  if (text.length > 200_000) return { kind: 'large', bytes: text.length };
  try {
    const j = JSON.parse(text);
    const walk = (v, depth = 0) => {
      if (depth > 3 || v === null) return typeof v;
      if (Array.isArray(v)) return v.length ? [walk(v[0], depth + 1)] : [];
      if (typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v).slice(0, 40)) o[k] = SECRET_KEY.test(k) ? '<redacted>' : walk(v[k], depth + 1);
        return o;
      }
      if (typeof v === 'string') return v.length <= 40 ? v : 'string(' + v.length + ')';
      return v;
    };
    return { kind: 'json', shape: walk(j) };
  } catch { /* not JSON */ }
  if (/^[^=&]+=[^&]*(&|$)/.test(text)) {
    const fields = {};
    for (const pair of text.split('&').slice(0, 60)) {
      const i = pair.indexOf('=');
      const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      const v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      fields[k] = SECRET_KEY.test(k) ? '<redacted>' : (v.length <= 40 ? v : 'string(' + v.length + ')');
    }
    return { kind: 'form', fields };
  }
  return { kind: 'other', bytes: text.length };
}

function note(rec) {
  captured++;
  appendFileSync(wire, JSON.stringify(rec) + '\n');
  const key = rec.method + ' ' + pathOf(rec.url);
  let row = seen.find((r) => r.key === key);
  if (!row) { row = { key, count: 0, statuses: new Set() }; seen.push(row); }
  row.count++;
  if (rec.status) row.statuses.add(rec.status);
}

// Attach to a context: block submissions, record everything else. Only XHR/fetch/document
// traffic is recorded — images/css/fonts are noise for an endpoint map.
const KEEP = new Set(['xhr', 'fetch', 'document', 'other']);
async function watch(context) {
  await context.route('**/*', async (route, request) => {
    if (DENY.test(request.url())) {
      blocked++;
      note({ t: new Date().toISOString(), method: request.method(), url: request.url(), blocked: true });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  context.on('response', async (res) => {
    const req = res.request();
    if (!KEEP.has(req.resourceType())) return;
    let body = null;
    try { body = shapeBody(await res.text()); } catch { /* opaque/streamed */ }
    let post = null;
    try { post = shapeBody(req.postData()); } catch { /* none */ }
    note({
      t: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      status: res.status(),
      requestHeaderNames: Object.keys(req.headers()),
      requestBody: post,
      responseShape: body,
    });
  });
  context.on('requestfailed', (req) => {
    if (DENY.test(req.url())) return;// already noted as blocked
    note({ t: new Date().toISOString(), method: req.method(), url: req.url(), failed: req.failure()?.errorText || 'failed' });
  });
}

function writeSummary() {
  const lines = ['# CLICK capture — ' + stamp, '',
    'Requests captured: ' + captured + ' · submissions blocked: ' + blocked, '',
    '| # | method + path | statuses |', '|---|---|---|'];
  seen.sort((a, b) => b.count - a.count).forEach((r, i) => {
    lines.push('| ' + r.count + ' | `' + r.key + '` | ' + [...r.statuses].join(', ') + ' |');
    void i;
  });
  lines.push('', 'Full detail: `network.jsonl` (header values omitted, bodies reduced to shape).');
  writeFileSync(join(outDir, 'endpoints.md'), lines.join('\n') + '\n');
  console.log('\n[capture] wrote ' + join(outDir, 'endpoints.md'));
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: SELF_TEST,// a real run stays headed so a human can clear SSO/MFA
  args: ['--remote-debugging-port=' + CDP_PORT],
});
const cdp = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
for (const ctx of cdp.contexts()) {
  await watch(ctx);
  ctx.on('page', (p) => console.log('[capture] page:', p.url()));
}
console.log('[capture] CDP endpoint: http://127.0.0.1:' + CDP_PORT);
console.log('[capture] point mcp.json at it with --cdp-endpoint, then run the cart task.');
console.log('[capture] output: ' + outDir);

if (!SELF_TEST) {
  const stop = () => { writeSummary(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  // ---- self-test: drive the bundled mock portal, assert capture + blocking ----
  const mock = spawn(process.execPath, [join(HERE, '..', 'test', 'mock-portal.mjs'), String(MOCK_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const BASE = 'http://127.0.0.1:' + MOCK_PORT;
  let failures = 0;
  const check = (name, cond, detail = '') => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond ? '' : '  — ' + detail));
    if (!cond) failures++;
  };
  try {
    const ctx = cdp.contexts()[0];
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.fill('input[name="user"]', 'testrep');
    await page.fill('input[name="pass"]', 'test123');
    await page.click('button:has-text("LOGIN")');
    await page.waitForURL('**/catalog');
    // An ordinary cart write — must be captured and allowed.
    await page.evaluate((b) => fetch(b + '/api/po', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po: 'ZZ-TEST-DISCOVERY' }),
    }).then((r) => r.text()), BASE);
    // A submission — must be blocked before it reaches the portal.
    const submitErr = await page.evaluate((b) => fetch(b + '/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(() => '', (e) => String(e)), BASE);
    await new Promise((r) => setTimeout(r, 400));
    const state = await (await fetch(BASE + '/api/state')).json();
    const log = readFileSync(wire, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    check('login page captured', log.some((r) => r.method === 'GET' && r.url === BASE + '/'), 'no GET / in log');
    check('allowed cart write captured', log.some((r) => r.url.endsWith('/api/po') && r.status === 200), 'no 200 /api/po');
    check('PO value visible in captured body', log.some((r) => JSON.stringify(r.requestBody || {}).includes('ZZ-TEST-DISCOVERY')), 'body shape lost the PO');
    check('password never written to disk', !readFileSync(wire, 'utf8').includes('test123'), 'credential leaked into capture');
    check('submission blocked in-flight', blocked >= 1 && !!submitErr, 'blocked=' + blocked + ' err=' + JSON.stringify(submitErr));
    check('portal never saw the submission', state.submitted === false, 'mock recorded submitted=true');
    writeSummary();
  } finally {
    mock.kill();
    await cdp.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  console.log(failures ? '\n❌ self-test failed (' + failures + ')' : '\n✅ self-test passed');
  process.exit(failures ? 1 : 0);
}
