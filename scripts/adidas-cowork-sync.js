#!/usr/bin/env node
/**
 * Adidas Cowork Inventory Sync
 *
 * Runs on Mac Mini via cron — opens Adidas Cowork, searches each Adidas SKU
 * from the portal's product list, scrapes size/qty inventory, and upserts to Supabase.
 *
 * Setup:
 *   1. npm install puppeteer @supabase/supabase-js (in this scripts folder or globally)
 *   2. Set environment variables (or create scripts/.env):
 *        SUPABASE_URL=https://hpslkvngulqirmbstlfx.supabase.co
 *        SUPABASE_ANON_KEY=your-anon-key
 *        COWORK_EMAIL=your-adidas-cowork-email
 *        COWORK_PASSWORD=your-adidas-cowork-password
 *   3. Test: node scripts/adidas-cowork-sync.js
 *   4. Schedule via cron (see bottom of file for cron examples)
 *
 * The script only checks SKUs that exist in your Products table with brand='Adidas'.
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ───
const COWORK_URL = 'https://www.adidas.com/us/cowork'; // adjust if your region differs
const COWORK_LOGIN_URL = 'https://www.adidas.com/us/cowork/login';
const HEADLESS = process.env.COWORK_HEADLESS !== 'false'; // set to 'false' to watch the browser
const DELAY_BETWEEN_SKUS = 2000; // ms between searches to avoid rate limiting
const TIMEOUT = 60000; // page navigation timeout

// Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
const coworkEmail = process.env.COWORK_EMAIL || '';
const coworkPassword = process.env.COWORK_PASSWORD || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[SYNC] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!coworkEmail || !coworkPassword) {
  console.error('[SYNC] Missing COWORK_EMAIL or COWORK_PASSWORD');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Helpers ───
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const timestamp = () => new Date().toISOString();

// Normalize a scraped restock date ("Jun 8, 2026", "6/8/2026", "2026-06-08")
// to a stable YYYY-MM-DD string using local date parts (no UTC shift). Falls
// back to the raw string if it can't be parsed.
const toISO = (s) => {
  if (!s) return null;
  const d = new Date(String(s).trim());
  if (isNaN(d.getTime())) return String(s).trim();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function log(msg) {
  const ts = new Date().toLocaleString();
  console.log(`[${ts}] ${msg}`);
}

// ─── Main ───
async function main() {
  await log('Starting Adidas Cowork inventory sync...');

  // 1. Get Adidas SKUs from portal products
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name, available_sizes')
    .ilike('brand', 'Adidas');

  if (prodErr) {
    await log('ERROR fetching products: ' + prodErr.message);
    process.exit(1);
  }

  const skus = [...new Set(products.map(p => p.sku).filter(Boolean))];
  await log(`Found ${skus.length} Adidas SKUs to check`);

  if (skus.length === 0) {
    await log('No Adidas products found — nothing to sync');
    process.exit(0);
  }

  // 2. Launch browser
  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(TIMEOUT);
  page.setDefaultTimeout(TIMEOUT);

  try {
    // 3. Login to Cowork
    await log('Navigating to Cowork login...');
    await page.goto(COWORK_LOGIN_URL, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // ── LOGIN FLOW ──
    // NOTE: You may need to adjust these selectors based on the actual Cowork login page.
    // Run with COWORK_HEADLESS=false to watch the browser and identify the right selectors.
    // Common patterns for Adidas Cowork login:

    // Try to find email input
    const emailSelectors = [
      'input[name="email"]', 'input[type="email"]', 'input[name="username"]',
      'input[id="email"]', 'input[id="username"]', '#login-email',
      'input[placeholder*="email" i]', 'input[placeholder*="user" i]'
    ];
    let emailInput = null;
    for (const sel of emailSelectors) {
      emailInput = await page.$(sel);
      if (emailInput) break;
    }

    if (!emailInput) {
      // Maybe SSO or different flow — take screenshot for debugging
      await page.screenshot({ path: '/tmp/cowork-login-page.png', fullPage: true });
      await log('WARNING: Could not find email input. Screenshot saved to /tmp/cowork-login-page.png');
      await log('You may need to adjust login selectors in this script. Run with COWORK_HEADLESS=false to debug.');
      await browser.close();
      process.exit(1);
    }

    await emailInput.type(coworkEmail, { delay: 50 });
    await sleep(500);

    // Find password input
    const passSelectors = [
      'input[name="password"]', 'input[type="password"]', 'input[id="password"]',
      '#login-password'
    ];
    let passInput = null;
    for (const sel of passSelectors) {
      passInput = await page.$(sel);
      if (passInput) break;
    }

    if (passInput) {
      await passInput.type(coworkPassword, { delay: 50 });
    }

    // Click submit
    const submitSelectors = [
      'button[type="submit"]', 'input[type="submit"]', 'button.login-btn',
      'button:has-text("Log in")', 'button:has-text("Sign in")',
      '[data-testid="login-button"]'
    ];
    for (const sel of submitSelectors) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); break; }
    }

    await sleep(3000);
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    await log('Logged in to Cowork');

    // 4. Search each SKU and scrape inventory
    const allRecords = [];
    let successCount = 0;
    let failCount = 0;

    for (const sku of skus) {
      try {
        await log(`Checking SKU: ${sku} (${successCount + failCount + 1}/${skus.length})`);

        // Navigate to search/product page
        // Adjust this URL pattern based on how Cowork product pages work:
        const searchUrl = `${COWORK_URL}/search?q=${encodeURIComponent(sku)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        await sleep(DELAY_BETWEEN_SKUS);

        // ── SCRAPE INVENTORY ──
        // This section extracts size/quantity data from the Cowork product page.
        // You WILL need to adjust selectors based on the actual page structure.
        // Run with COWORK_HEADLESS=false to inspect the page and update selectors.

        const inventory = await page.evaluate((targetSku) => {
          const results = [];

          // Known apparel sizes for reliable detection
          const APPAREL_SIZES = new Set([
            'XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL',
            'LT','XLT','2XLT','3XLT','OSFA',
            'XS/S','S/M','M/L','L/XL','XL/2XL',
            '2XS','2XS/XS','3XS',
          ]);

          // Strategy 1: Look for structured data in tables with explicit headers
          const tables = document.querySelectorAll('table');
          for (const table of tables) {
            const headers = [...table.querySelectorAll('th, thead td')].map(th => th.textContent.trim().toLowerCase());
            const sizeIdx = headers.findIndex(h => h.includes('size'));
            const qtyIdx = headers.findIndex(h => h.includes('qty') || h.includes('quantity') || h.includes('avail') || h.includes('stock') || h.includes('atp'));

            if (sizeIdx >= 0 && qtyIdx >= 0) {
              const rows = table.querySelectorAll('tbody tr');
              for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length > Math.max(sizeIdx, qtyIdx)) {
                  const size = cells[sizeIdx].textContent.trim();
                  const qty = parseInt(cells[qtyIdx].textContent.trim()) || 0;
                  if (size) results.push({ size, qty });
                }
              }
            }
          }

          // Strategy 2: Headerless tables — find size row by content, next row = quantities.
          // Uses two-pass scan: apparel sizes (S/M/L/XL) take priority over footwear (3-digit numbers)
          // to avoid misidentifying pricing/product-info rows as size rows.
          if (results.length === 0) {
            const allRows = [];
            tables.forEach(tbl => {
              tbl.querySelectorAll('tr').forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td,th')).map(c => c.textContent.trim());
                if (cells.length > 1) allRows.push(cells);
              });
            });

            // Two-pass scan: apparel match always wins over footwear
            function findSizeRow(rows) {
              let apparelIdx = -1;
              let footwearIdx = -1;

              for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                // Apparel match — stop immediately (high confidence)
                if (row.some(cell => APPAREL_SIZES.has(cell.trim()))) {
                  apparelIdx = i;
                  break;
                }

                // Footwear match (3+ cells with 3-digit numbers) — save but keep scanning
                if (footwearIdx === -1 && row.filter(cell => /^\d{3}$/.test(cell.trim())).length >= 3) {
                  footwearIdx = i;
                  // Don't break — keep looking for apparel
                }

                // Pants with inseam — treat like apparel (high confidence)
                if (apparelIdx === -1 && row.filter(cell => /^[XSML0-9]+\s*\d+"?$/.test(cell.trim())).length >= 2) {
                  apparelIdx = i;
                  break;
                }
              }

              return apparelIdx !== -1 ? apparelIdx : footwearIdx;
            }

            const sizeRowIdx = findSizeRow(allRows);
            if (sizeRowIdx !== -1 && sizeRowIdx + 1 < allRows.length) {
              const sizeRow = allRows[sizeRowIdx];
              const stockRow = allRows[sizeRowIdx + 1];
              for (let c = 0; c < sizeRow.length; c++) {
                const size = sizeRow[c].trim();
                if (!size) continue;
                const qty = parseInt(stockRow[c]?.trim()) || 0;
                results.push({ size, qty });
              }
            }
          }

          // Strategy 3: Look for size chips/badges with quantities
          if (results.length === 0) {
            const chips = document.querySelectorAll('[class*="size-chip"], [class*="size-option"], [class*="variant-option"]');
            for (const chip of chips) {
              const sizeText = chip.querySelector('[class*="label"], [class*="name"]')?.textContent?.trim();
              const qtyText = chip.querySelector('[class*="qty"], [class*="count"], [class*="stock"]')?.textContent?.trim();
              if (sizeText) {
                results.push({ size: sizeText, qty: parseInt(qtyText) || 0 });
              }
            }
          }

          // Strategy 4: Check for JSON data in page scripts (many B2B portals embed data)
          if (results.length === 0) {
            const scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
            for (const script of scripts) {
              try {
                const data = JSON.parse(script.textContent);
                // Look for inventory/variant data in JSON
                const variants = data.variants || data.skus || data.sizes || data.inventory || [];
                if (Array.isArray(variants)) {
                  for (const v of variants) {
                    const size = v.size || v.sizeName || v.sizeCode || '';
                    const qty = v.qty || v.quantity || v.stock || v.available || v.atp || 0;
                    if (size) results.push({ size, qty: parseInt(qty) || 0 });
                  }
                }
              } catch {}
            }
          }

          return results;
        }, sku);

        // ── RESTOCK / RE-STOCK DATES ──
        // When a size is out of stock, Cowork shows a "Re-stock in <date>" note
        // on that size's calendar icon (often only on hover). Capture it so the
        // out-of-stock size carries a future_delivery_date the portal surfaces on
        // the order. Two passes: (1) read any date already in the DOM
        // (title/aria-label/text); (2) hover the calendar on still-missing
        // out-of-stock sizes and read the revealed tooltip. Best-effort — any
        // failure just leaves the date null, exactly like before.
        let restockBySize = {};
        try {
          const harvest = await page.evaluate(() => {
            const APPAREL_SIZES = new Set([
              'XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL',
              'LT','XLT','2XLT','3XLT','OSFA','XS/S','S/M','M/L','L/XL','XL/2XL',
              '2XS','2XS/XS','3XS',
            ]);
            const RX = [
              /([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/, // Jun 8, 2026 / June 8 2026
              /(\d{1,2}\/\d{1,2}\/\d{2,4})/,              // 6/8/2026
              /(\d{4}-\d{2}-\d{2})/,                      // 2026-06-08
            ];
            const findDate = (t) => { if (!t) return null; for (const rx of RX) { const m = String(t).match(rx); if (m) return m[1].replace(/\s+/g, ' ').trim(); } return null; };
            const looksRestock = (t) => /re-?stock|back\s*in\s*stock|expected|incoming|delivery|due|available/i.test(t || '');
            const sizeIn = (s) => { const toks = String(s || '').replace(/[^0-9A-Za-z/]/g, ' ').trim().split(/\s+/); return toks.find((tk) => APPAREL_SIZES.has(tk)) || ''; };
            const restock = {}; // size -> { date, qty }
            const probes = [];  // { probe, size } — out-of-stock cells tagged for the hover pass

            // (1a) Size grid as a table: size header row + quantity row beneath.
            document.querySelectorAll('table').forEach((table) => {
              const rows = [...table.querySelectorAll('tr')];
              let sizeRowIdx = -1;
              for (let i = 0; i < rows.length; i++) {
                const cells = [...rows[i].querySelectorAll('td,th')];
                if (cells.some((c) => APPAREL_SIZES.has((c.textContent || '').trim()))) { sizeRowIdx = i; break; }
              }
              if (sizeRowIdx < 0) return;
              const sizeCells = [...rows[sizeRowIdx].querySelectorAll('td,th')];
              const qtyCells = rows[sizeRowIdx + 1] ? [...rows[sizeRowIdx + 1].querySelectorAll('td,th')] : [];
              sizeCells.forEach((cell, ci) => {
                const size = sizeIn(cell.textContent) || (cell.textContent || '').trim();
                if (!size) return;
                const qtyCell = qtyCells[ci];
                const qty = qtyCell ? (parseInt((qtyCell.textContent || '').replace(/[^\d-]/g, '')) || 0) : null;
                // (1) date already in the DOM for this column?
                let date = null, futQty = null;
                for (const el of [cell, qtyCell].filter(Boolean)) {
                  const texts = [el.getAttribute && el.getAttribute('title'), el.getAttribute && el.getAttribute('aria-label'), el.textContent];
                  el.querySelectorAll && el.querySelectorAll('[title],[aria-label]').forEach((d) => texts.push(d.getAttribute('title'), d.getAttribute('aria-label')));
                  for (const t of texts) {
                    if (!t || !(looksRestock(t) || findDate(t))) continue;
                    const d = findDate(t);
                    if (d) { date = d; const qm = String(t).match(/(\d+)\s*(?:units?|pcs?|pieces?)/i); if (qm) futQty = parseInt(qm[1]); break; }
                  }
                  if (date) break;
                }
                if (date) { restock[size] = { date, qty: futQty }; return; }
                // (2) out of stock and no date yet → tag the calendar for the hover pass
                if (qty != null && qty <= 0) {
                  const icon = cell.querySelector('[class*="calendar" i],[class*="cal" i],button,[role="button"],svg,img') || cell;
                  icon.setAttribute('data-nsa-restock-probe', String(probes.length));
                  probes.push({ probe: probes.length, size });
                }
              });
            });

            // (1b) Fallback: any element whose title/aria-label already carries a
            // "Re-stock in <date>" — attach to the nearest size token above it.
            document.querySelectorAll('[title],[aria-label]').forEach((el) => {
              const t = (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
              const d = findDate(t);
              if (!d || !looksRestock(t)) return;
              let node = el, size = '';
              for (let up = 0; up < 5 && node; up++) { size = sizeIn(node.textContent); if (size) break; node = node.parentElement; }
              if (size && !restock[size]) restock[size] = { date: d, qty: null };
            });

            return { restock, probes };
          });
          restockBySize = harvest.restock || {};

          // (2) Hover pass — reveal the tooltip on each tagged out-of-stock
          // calendar and read the "Re-stock in …" date from it.
          for (const { probe, size } of (harvest.probes || []).slice(0, 20)) {
            if (restockBySize[size] && restockBySize[size].date) continue;
            try {
              const el = await page.$(`[data-nsa-restock-probe="${probe}"]`);
              if (!el) continue;
              await el.hover();
              await sleep(350);
              const found = await page.evaluate(() => {
                const RX = [/([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/, /(\d{1,2}\/\d{1,2}\/\d{2,4})/, /(\d{4}-\d{2}-\d{2})/];
                const findDate = (t) => { if (!t) return null; for (const rx of RX) { const m = String(t).match(rx); if (m) return m[1].replace(/\s+/g, ' ').trim(); } return null; };
                const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                const tips = [...document.querySelectorAll('[role="tooltip"],[class*="tooltip" i],[class*="popover" i],[class*="popup" i]')].filter(visible);
                for (const e of tips) { const d = findDate(e.textContent); if (d) return d; }
                const any = [...document.querySelectorAll('body *')].find((e) => /re-?stock/i.test(e.textContent || '') && findDate(e.textContent) && visible(e));
                return any ? findDate(any.textContent) : null;
              });
              if (found) restockBySize[size] = { date: found, qty: (restockBySize[size] && restockBySize[size].qty) || null };
            } catch { /* per-size hover failure — leave this size's date null */ }
          }
        } catch (e) {
          await log(`  → ${sku}: restock-date scan skipped (${e.message})`);
        }

        if (inventory.length > 0) {
          let restockCount = 0;
          for (const item of inventory) {
            const r = restockBySize[item.size];
            const futDate = (r && r.date) ? toISO(r.date) : null;
            if (futDate) restockCount++;
            allRecords.push({
              sku,
              size: item.size,
              stock_qty: item.qty,
              future_delivery_date: futDate,
              future_delivery_qty: (r && r.qty) || null,
              last_synced: new Date().toISOString(),
            });
          }
          await log(`  → ${sku}: ${inventory.length} sizes found (${inventory.map(i => i.size + ':' + i.qty).join(', ')})${restockCount ? ` · ${restockCount} restock date(s)` : ''}`);
          successCount++;
        } else {
          await log(`  → ${sku}: No inventory data found on page`);
          failCount++;

          // Save debug screenshot for first few failures
          if (failCount <= 3) {
            await page.screenshot({ path: `/tmp/cowork-debug-${sku}.png`, fullPage: true });
            await log(`    Screenshot saved: /tmp/cowork-debug-${sku}.png`);
          }
        }
      } catch (err) {
        await log(`  → ${sku}: ERROR - ${err.message}`);
        failCount++;
      }
    }

    // 5. Upsert all records to Supabase
    if (allRecords.length > 0) {
      await log(`Upserting ${allRecords.length} inventory records to Supabase...`);
      for (let i = 0; i < allRecords.length; i += 500) {
        const batch = allRecords.slice(i, i + 500);
        const { error } = await supabase.from('adidas_inventory').upsert(batch, { onConflict: 'sku,size' });
        if (error) {
          await log(`ERROR upserting batch: ${error.message}`);
        }
      }
      await log(`Upserted ${allRecords.length} records for ${successCount} SKUs`);
    }

    await log(`\nSync complete: ${successCount} success, ${failCount} failed, ${allRecords.length} inventory records`);

  } catch (err) {
    await log('FATAL ERROR: ' + err.message);
    await page.screenshot({ path: '/tmp/cowork-error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[SYNC] Unhandled error:', err);
  process.exit(1);
});

/**
 * ─── CRON SETUP (Mac Mini) ───
 *
 * To run this automatically, add a cron job on your Mac Mini:
 *
 *   crontab -e
 *
 * Then add one of these lines:
 *
 *   # Every 6 hours (recommended):
 *   0 0,6,12,18 * * * cd /path/to/nsa-portal && SUPABASE_URL=https://hpslkvngulqirmbstlfx.supabase.co SUPABASE_ANON_KEY=your-key COWORK_EMAIL=your-email COWORK_PASSWORD=your-pass node scripts/adidas-cowork-sync.js >> /tmp/adidas-sync.log 2>&1
 *
 *   # Every morning at 7am:
 *   0 7 * * * cd /path/to/nsa-portal && ... node scripts/adidas-cowork-sync.js >> /tmp/adidas-sync.log 2>&1
 *
 *   # Twice daily (7am and 1pm):
 *   0 7,13 * * * cd /path/to/nsa-portal && ... node scripts/adidas-cowork-sync.js >> /tmp/adidas-sync.log 2>&1
 *
 * Or use a .env file instead of inline vars:
 *   0 0,6,12,18 * * * cd /path/to/nsa-portal/scripts && source .env && node adidas-cowork-sync.js >> /tmp/adidas-sync.log 2>&1
 *
 * ─── FIRST-TIME SETUP ───
 *
 * 1. Install dependencies on Mac Mini:
 *      cd /path/to/nsa-portal
 *      npm install puppeteer @supabase/supabase-js
 *
 * 2. Create scripts/.env with your credentials:
 *      SUPABASE_URL=https://hpslkvngulqirmbstlfx.supabase.co
 *      SUPABASE_ANON_KEY=your-anon-key
 *      COWORK_EMAIL=your-adidas-login
 *      COWORK_PASSWORD=your-adidas-password
 *
 * 3. Test with browser visible first:
 *      COWORK_HEADLESS=false node scripts/adidas-cowork-sync.js
 *    This lets you see the browser, verify login works, and check if
 *    the scraping selectors need adjustment for the actual page layout.
 *
 * 4. Once working, run headless (default) and set up cron.
 */
