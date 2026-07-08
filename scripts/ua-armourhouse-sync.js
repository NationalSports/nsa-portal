#!/usr/bin/env node
/**
 * Under Armour "Armour House" B2B Inventory Sync — PUPPETEER FALLBACK
 *
 * The PRIMARY UA sync is the COWORK skill (ua-inventory-sync), which drives
 * Armour House's JSON API from a logged-in Chrome tab — far more reliable than
 * scraping the rendered page. Use THIS script only if that API can't be found,
 * or to bootstrap/debug login + selectors. It mirrors scripts/adidas-cowork-sync.js
 * (the original adidas heuristic scraper) and writes to the SAME Supabase shape.
 *
 * It logs into armourhouse.underarmour.com, searches each Under Armour SKU from
 * the portal's product list, scrapes the size/qty table, and upserts to the
 * ua_inventory table (id `{sku}-{size}`, on conflict sku,size).
 *
 * ⚠️ Selectors are UNVERIFIED (site is behind login). Run with
 * UA_HEADLESS=false first to watch the browser and adjust the login + scrape
 * selectors to the real DOM, exactly as the adidas script documents.
 *
 * Setup:
 *   npm install puppeteer @supabase/supabase-js
 *   Env (or scripts/.env):
 *     SUPABASE_URL=https://hpslkvngulqirmbstlfx.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # same var as bot-worker/.env; anon can no longer write ua_inventory
 *     UA_EMAIL=<armour house login>          # never commit real creds
 *     UA_PASSWORD=<armour house password>
 *   Test:  UA_HEADLESS=false node scripts/ua-armourhouse-sync.js
 *   Cron:  see bottom of scripts/adidas-cowork-sync.js for the pattern.
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ───
const BASE_URL = 'https://armourhouse.underarmour.com';
const LOGIN_URL = process.env.UA_LOGIN_URL || (BASE_URL + '/login');
const SEARCH_URL = process.env.UA_SEARCH_URL || (BASE_URL + '/search?q='); // append SKU
const HEADLESS = process.env.UA_HEADLESS !== 'false';
const DELAY_BETWEEN_SKUS = 2000;
const TIMEOUT = 60000;

const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
// Service-role key REQUIRED: ua_inventory writes are RLS-locked to the service
// role (migration 00183). Same env var convention as bot-worker/worker.js.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const uaEmail = process.env.UA_EMAIL || '';
const uaPassword = process.env.UA_PASSWORD || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[UA SYNC] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('[UA SYNC] Set SUPABASE_SERVICE_ROLE_KEY (the same service-role key bot-worker/.env holds) — the anon key can no longer write ua_inventory.');
  process.exit(1);
}
if (!uaEmail || !uaPassword) { console.error('[UA SYNC] Missing UA_EMAIL or UA_PASSWORD'); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toLocaleString()}] ${msg}`);

async function main() {
  log('Starting Under Armour Armour House inventory sync...');

  // 1. UA SKUs from portal products
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('sku')
    .ilike('brand', 'under armour');
  if (prodErr) { log('ERROR fetching products: ' + prodErr.message); process.exit(1); }
  const skus = [...new Set((products || []).map((p) => p.sku).filter(Boolean))];
  log(`Found ${skus.length} Under Armour SKUs to check`);
  if (!skus.length) { log('No UA products — nothing to sync'); process.exit(0); }

  // 2. Browser
  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(TIMEOUT);
  page.setDefaultTimeout(TIMEOUT);

  try {
    // 3. Login (adjust selectors to the real Armour House login on first run)
    log('Navigating to Armour House login...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const emailSelectors = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[id*="email" i]', 'input[placeholder*="email" i]'];
    let emailInput = null;
    for (const sel of emailSelectors) { emailInput = await page.$(sel); if (emailInput) break; }
    if (!emailInput) {
      await page.screenshot({ path: '/tmp/ua-login-page.png', fullPage: true });
      log('WARNING: email input not found. Screenshot: /tmp/ua-login-page.png. Adjust selectors / handle SSO; run UA_HEADLESS=false.');
      await browser.close(); process.exit(1);
    }
    await emailInput.type(uaEmail, { delay: 50 });
    await sleep(400);
    for (const sel of ['input[type="password"]', 'input[name="password"]', 'input[id*="password" i]']) {
      const p = await page.$(sel); if (p) { await p.type(uaPassword, { delay: 50 }); break; }
    }
    for (const sel of ['button[type="submit"]', 'button[name="login"]', '[data-testid*="login" i]']) {
      const b = await page.$(sel); if (b) { await b.click(); break; }
    }
    await sleep(3000);
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    log('Logged in (verify the session before relying on results).');

    // 4. Per SKU — search + scrape the size/qty table (heuristic; same strategies
    //    as the adidas scraper). PREFER the JSON API if you can find it (see skill).
    const allRecords = [];
    let ok = 0, fail = 0;
    for (const sku of skus) {
      try {
        log(`Checking SKU: ${sku} (${ok + fail + 1}/${skus.length})`);
        await page.goto(SEARCH_URL + encodeURIComponent(sku), { waitUntil: 'networkidle2' });
        await sleep(DELAY_BETWEEN_SKUS);
        const inventory = await page.evaluate(() => {
          const results = [];
          const APPAREL = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'OSFA', 'SM', 'MD', 'LG', 'XG']);
          // Header table: a column named size + a column named qty/avail/stock
          for (const table of document.querySelectorAll('table')) {
            const headers = [...table.querySelectorAll('th, thead td')].map((th) => th.textContent.trim().toLowerCase());
            const si = headers.findIndex((h) => h.includes('size'));
            const qi = headers.findIndex((h) => h.includes('qty') || h.includes('avail') || h.includes('stock') || h.includes('ats'));
            if (si >= 0 && qi >= 0) {
              for (const row of table.querySelectorAll('tbody tr')) {
                const c = row.querySelectorAll('td');
                if (c.length > Math.max(si, qi)) { const size = c[si].textContent.trim(); const qty = parseInt(c[qi].textContent.trim()) || 0; if (size) results.push({ size, qty }); }
              }
            }
          }
          // Headerless: a row of size labels, the next row = quantities
          if (!results.length) {
            const rows = [];
            document.querySelectorAll('table tr').forEach((tr) => { const cells = [...tr.querySelectorAll('td,th')].map((c) => c.textContent.trim()); if (cells.length > 1) rows.push(cells); });
            const sizeRow = rows.findIndex((r) => r.some((c) => APPAREL.has(c.toUpperCase())));
            if (sizeRow >= 0 && rows[sizeRow + 1]) {
              const sr = rows[sizeRow], qr = rows[sizeRow + 1];
              for (let i = 0; i < sr.length; i++) { const size = sr[i].trim(); if (size) results.push({ size, qty: parseInt(qr[i]) || 0 }); }
            }
          }
          return results;
        });

        if (inventory.length) {
          for (const it of inventory) allRecords.push({ id: `${sku}-${it.size}`, sku, size: it.size, stock_qty: it.qty, last_synced: new Date().toISOString(), source: 'armourhouse' });
          log(`  → ${sku}: ${inventory.length} sizes (${inventory.map((i) => i.size + ':' + i.qty).join(', ')})`);
          ok++;
        } else {
          log(`  → ${sku}: no inventory data found`);
          if (fail < 3) await page.screenshot({ path: `/tmp/ua-debug-${sku}.png`, fullPage: true }).catch(() => {});
          fail++;
        }
      } catch (e) { log(`  → ${sku}: ERROR ${e.message}`); fail++; }
    }

    // 5. Upsert
    if (allRecords.length) {
      for (let i = 0; i < allRecords.length; i += 500) {
        const { error } = await supabase.from('ua_inventory').upsert(allRecords.slice(i, i + 500), { onConflict: 'sku,size' });
        if (error) log('ERROR upserting batch: ' + error.message);
      }
      log(`Upserted ${allRecords.length} rows for ${ok} SKUs`);
    }
    log(`Sync complete: ${ok} ok, ${fail} failed, ${allRecords.length} rows`);
  } catch (e) {
    log('FATAL: ' + e.message);
    await page.screenshot({ path: '/tmp/ua-error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('[UA SYNC] Unhandled error:', e); process.exit(1); });
