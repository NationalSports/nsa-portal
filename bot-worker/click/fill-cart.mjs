// Fill a CLICK cart from a PO — Phase 2 runner.
//
// Playwright does the one thing only a browser can (Salesforce SSO behind Akamai), then the
// mechanical work goes out as five HTTP calls via click-client.mjs. The browser run this replaces
// took 8m40s for a single line, 4m11s of it entering sizes one box at a time.
//
// Auth without guesswork: rather than reconstructing headers, this waits for the SPA's own first
// API call and reuses ITS headers (cookies included) for our requests. Those values live in memory
// only — never logged, never written to disk.
//
//   node click/fill-cart.mjs --po "PO 57073 SFVB"            # lines pulled from Supabase
//   node click/fill-cart.mjs --lines ./lines.json --po "…"   # lines from a file
//   node click/fill-cart.mjs --po "…" --dry-run              # resolve + map sizes, write nothing
//
// Stops at a filled cart. There is no submit path here or in click-client.mjs.

import 'dotenv/config';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { ClickClient, ClickError } from './click-client.mjs';

const arg = (name, def = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
};
const PO = arg('po');
const LINES_FILE = arg('lines');
const DRY = !!arg('dry-run', false);
const DELIVERY = arg('date') || new Date().toISOString().slice(0, 10);
const API_HOST = process.env.CLICK_API_HOST || 'clapp-v2.whs.adidas.com';
const PORTAL = process.env.ADIDAS_CLICK_URL || 'https://b2bportal.adidas-group.com/adidas/reorder';
const ACCOUNT = process.env.CLICK_ACCOUNT || '0000270384';
const SALES_ORG = process.env.CLICK_SALES_ORG || '6040';
const SOLD_TO = process.env.CLICK_SOLD_TO || '6017364000';

if (!PO && !LINES_FILE) {
  console.error('usage: node click/fill-cart.mjs --po "PO 12345 ABCD" [--lines file.json] [--dry-run] [--date YYYY-MM-DD]');
  process.exit(2);
}

// PO lines straight from the portal's own tables — the same source the worker uses, so the two
// paths can't disagree about what was ordered.
async function linesFromDb(poId) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY needed to look up PO lines (or pass --lines)');
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: pls, error } = await db.from('so_item_po_lines').select('so_item_id,po_id,sizes,status').ilike('po_id', poId);
  if (error) throw new Error('PO line lookup failed: ' + error.message);
  const live = (pls || []).filter((p) => p.status !== 'cancelled');
  if (!live.length) throw new Error('no PO lines found for ' + poId);
  const { data: items } = await db.from('so_items').select('id,sku,name,color').in('id', [...new Set(live.map((p) => p.so_item_id))]);
  const byId = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const merged = new Map();
  for (const pl of live) {
    const it = byId[pl.so_item_id];
    if (!it?.sku) continue;
    const sizes = merged.get(it.sku) || {};
    for (const [sz, qty] of Object.entries(pl.sizes || {})) {
      const q = Number(qty) || 0;
      if (q > 0) sizes[sz] = (sizes[sz] || 0) + q;
    }
    merged.set(it.sku, sizes);
  }
  return [...merged].map(([sku, sizes]) => ({ sku, sizes }));
}

const lines = LINES_FILE ? JSON.parse(readFileSync(LINES_FILE, 'utf8')) : await linesFromDb(PO);
const totalPcs = lines.reduce((a, l) => a + Object.values(l.sizes).reduce((b, v) => b + Number(v || 0), 0), 0);
console.log('[fill] ' + lines.length + ' line(s), ' + totalPcs + ' pcs, PO ' + (PO || '(none)') + (DRY ? ' — DRY RUN' : ''));

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

// Capture the headers of the SPA's own first API request; that's our authenticated template.
let apiHeaders = null;
context.on('request', (req) => {
  if (apiHeaders) return;
  try {
    const u = new URL(req.url());
    if (u.host === API_HOST && /^\/service|^\/services/.test(u.pathname)) {
      const h = { ...req.headers() };
      ['content-length', 'content-type', 'accept-encoding', ':method', ':path', ':authority', ':scheme'].forEach((k) => delete h[k]);
      apiHeaders = h;
    }
  } catch { /* not a URL we care about */ }
});

const t0 = Date.now();
try {
  console.log('[fill] opening the portal — sign in if prompted (SSO/MFA is a human step)');
  await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const user = process.env.ADIDAS_CLICK_USER;
  const pass = process.env.ADIDAS_CLICK_PASS;
  if (user && pass) {
    const u = page.locator('input[type="email"], input[name*="user" i], input[name*="email" i]').first();
    if (await u.isVisible({ timeout: 8000 }).catch(() => false)) {
      await u.fill(user);
      await page.locator('input[type="password"]').first().fill(pass);
      await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("LOGIN"), button:has-text("Sign in")').first().click().catch(() => {});
    }
  }
  // Wait for the SPA to make its first authenticated API call.
  const deadline = Date.now() + 180_000;
  while (!apiHeaders && Date.now() < deadline) await page.waitForTimeout(500);
  if (!apiHeaders) throw new Error('no authenticated API request seen within 3 minutes — is the portal logged in?');
  console.log('[fill] session captured after ' + Math.round((Date.now() - t0) / 1000) + 's');

  const client = new ClickClient({
    baseUrl: 'https://' + API_HOST,
    headers: apiHeaders,
    account: ACCOUNT, salesOrg: SALES_ORG, soldTo: SOLD_TO,
    log: (m) => console.log(m),
  });

  const cartId = await client.currentCartId();
  console.log('[fill] cart ' + cartId);

  if (DRY) {
    const built = await client.buildSizeRows({ cartId, lines, requestedDeliveryDate: DELIVERY });
    console.log('[fill] would send ' + built.rows.length + ' size row(s):');
    built.rows.forEach((r) => console.log('   ' + r.materialNumber + '  ' + r._label + ' → ' + r.technicalSize + '  ×' + r.quantity
      + (r._available === false ? '  ⚠ shown unavailable' : '') + (r._futureDate ? '  ⚠ future ' + r._futureDate : '')));
    built.problems.forEach((p) => console.log('   ⚠ ' + p));
    console.log('[fill] dry run — nothing written');
  } else {
    const report = await client.fillCart({ cartId, lines, poNumber: PO, requestedDeliveryDate: DELIVERY });
    console.log('[fill] sent ' + report.rows.length + ' size row(s) in one request');
    report.rows.forEach((r) => console.log('   ' + r.materialNumber + '  ' + r._label + ' → ' + r.technicalSize + '  ×' + r.quantity));
    report.unresolved.forEach((p) => console.log('   ⚠ UNRESOLVED: ' + p));
    report.mismatches.forEach((m) => console.log('   ⚠ MISMATCH: ' + m));
    console.log(report.ok
      ? '[fill] ✅ cart matches the PO — left for human review, nothing submitted'
      : '[fill] ⚠ cart does NOT fully match the PO — fix the flagged rows by hand before submitting');
    if (!report.ok) process.exitCode = 1;
  }
  console.log('[fill] total ' + Math.round((Date.now() - t0) / 1000) + 's (browser run for comparison: 520s)');
} catch (e) {
  if (e instanceof ClickError) {
    console.error('[fill] ' + e.message);
    if (e.sent) console.error('[fill] payload sent: ' + JSON.stringify(e.sent).slice(0, 400));
    if (e.body) console.error('[fill] portal said: ' + String(e.body).slice(0, 400));
  } else console.error('[fill] ' + (e?.stack || e?.message || e));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
