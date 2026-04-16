#!/usr/bin/env node
/**
 * Adidas Custom Catalog SKU Scanner
 *
 * Opens each flipbook catalog from https://www.adidas-custom.com/catalogs/,
 * flips through every page, extracts SKUs/product info, calculates NSA cost
 * (retail × 50% × 75%), and upserts new products into Supabase.
 *
 * No login required — these are public catalogs.
 *
 * Usage:
 *   # Watch the browser flip through catalogs:
 *   COWORK_HEADLESS=false node scripts/adidas-cowork-discover.js
 *
 *   # Headless (faster):
 *   node scripts/adidas-cowork-discover.js
 *
 *   # Dry run — discover SKUs but don't write to Supabase:
 *   DRY_RUN=true node scripts/adidas-cowork-discover.js
 *
 * Output:
 *   - data/adidas-catalog-skus.csv          (all discovered SKUs)
 *   - data/adidas-catalog-new-skus.csv      (only SKUs not in our catalog)
 *   - data/adidas-catalog-screenshots/      (page screenshots for reference)
 *   - New products upserted to Supabase products table
 *
 * Pricing: NSA Cost = Retail × 50% × 75% (i.e. retail × 0.375)
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── Config ───
const CATALOGS_URL = 'https://www.adidas-custom.com/catalogs/';
const HEADLESS = process.env.COWORK_HEADLESS !== 'false';
const DRY_RUN = process.env.DRY_RUN === 'true';
const DELAY_BETWEEN_PAGES = 2000;
const TIMEOUT = 60000;
const MAX_PAGES_PER_CATALOG = 150;
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'adidas-catalog-screenshots');

// NSA cost formula: retail × 50% × 75%
const NSA_COST_MULTIPLIER = 0.50 * 0.75; // = 0.375

// Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Adidas SKU patterns
const SKU_PATTERNS = [
  /\b([A-Z]{1,3}\d{3,}[A-Z]?(?:[-]\d{1,3})?)\b/g,
  /\b(\d{7,})\b/g,
  /\b([A-Z]{2}\d{4})\b/g,
  /\b((?:JX|AJ|EK|FI|GM|GN|HA|HB|HM|IB|IS|HK|GP|FQ|DP)\d{4})\b/g,
];

// Price pattern — matches $XX.XX or $XXX.XX near SKUs
const PRICE_PATTERN = /\$\s?(\d{1,3}(?:\.\d{2})?)/g;

// Map catalog sport to our product categories
const SPORT_CATEGORY_MAP = {
  'football':    'Jersey Tops',
  'basketball':  'Jersey Tops',
  'soccer':      'Jersey Tops',
  'volleyball':  'Jersey Tops',
  'baseball':    'Jersey Tops',
  'softball':    'Jersey Tops',
  'lacrosse':    'Jersey Tops',
  'field hockey': 'Jersey Tops',
  'cross country': 'Shorts',
  'track':       'Shorts',
  'training':    'Tees',
  'sideline':    'Hoodies',
  'esports':     'Jersey Tops',
};

// ─── Helpers ───
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toLocaleString()}] ${msg}`);

function guessCategoryFromCatalog(catalogName) {
  const lower = catalogName.toLowerCase();
  for (const [sport, category] of Object.entries(SPORT_CATEGORY_MAP)) {
    if (lower.includes(sport)) return category;
  }
  return 'Jersey Tops'; // default for custom uniforms
}

// Extract product name from surrounding text context
function extractProductName(context, sku) {
  // Look for capitalized product-like phrases near the SKU
  // e.g. "Adidas Custom Squadra Jersey" or "AEROREADY 3-Stripe Polo"
  const namePatterns = [
    // "Product Name" before or after the SKU
    /(?:adidas\s+)?(?:custom\s+)?([A-Z][A-Za-z0-9\s\-\/&']+(?:Jersey|Top|Bottom|Short|Pant|Hoodie|Polo|Tee|Jacket|Vest|Quarter|Zip|Cap|Hat|Sock|Shoe|Cleat|Ball)s?)/i,
    // General capitalized phrase near SKU
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5})/,
  ];
  for (const pat of namePatterns) {
    const match = context.match(pat);
    if (match && match[1] && !match[1].includes(sku)) {
      return match[1].trim();
    }
  }
  return '';
}

// Extract retail price from surrounding text
function extractRetailPrice(context) {
  PRICE_PATTERN.lastIndex = 0;
  const prices = [];
  let match;
  while ((match = PRICE_PATTERN.exec(context)) !== null) {
    prices.push(parseFloat(match[1]));
  }
  // Return the highest price (likely MSRP/retail, not a discounted price)
  if (prices.length > 0) {
    return Math.max(...prices);
  }
  return null;
}

// ─── Main ───
async function main() {
  log('=== Adidas Custom Catalog SKU Scanner ===');
  log(`Headless: ${HEADLESS} | Dry run: ${DRY_RUN}`);
  if (!supabase) log('WARNING: No Supabase credentials — will only output CSV files');

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1000'],
    defaultViewport: { width: 1440, height: 1000 },
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(TIMEOUT);
  page.setDefaultTimeout(TIMEOUT);

  const allSkus = []; // { sku, name, catalog, page, context, retailPrice, nsaCost, category }

  try {
    // Step 1: Get catalog links
    log('Loading catalogs page...');
    await page.goto(CATALOGS_URL, { waitUntil: 'networkidle2' });
    await sleep(2000);

    const catalogs = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .filter(a => a.href.includes('publications.adicustom.com') || a.href.includes('publication'))
        .map(a => ({
          name: a.textContent.trim()
            || a.closest('[class*="card"]')?.querySelector('h2,h3,h4,span')?.textContent?.trim()
            || a.getAttribute('title')
            || 'Unknown',
          url: a.href,
        }))
        .filter(c => c.url);
    });

    // Add known catalog URLs as fallback
    const knownCatalogs = [
      { name: 'Football FW26', url: 'https://publications.adicustom.com/view/570905273/' },
      { name: 'Field Hockey FW26', url: 'https://publications.adicustom.com/view/570444671/' },
      { name: 'Basketball FW26', url: 'https://publications.adicustom.com/view/571263071/' },
      { name: 'Soccer FW26', url: 'https://publications.adicustom.com/view/570973562/' },
      { name: 'Volleyball FW26', url: 'https://publications.adicustom.com/view/570980723/' },
      { name: 'Cross Country FW26', url: 'https://publications.adicustom.com/view/92961675/' },
      { name: 'Training Women FW26', url: 'https://publications.adicustom.com/view/31252078/' },
      { name: 'Sideline FW26', url: 'https://publications.adicustom.com/view/571183497/' },
      { name: 'Esports FW26', url: 'https://publications.adicustom.com/view/30903482/' },
      { name: 'Women Soccer SS27', url: 'https://publications.adicustom.com/view/31119340/' },
      { name: 'Men Lacrosse SS27', url: 'https://publications.adicustom.com/view/31041328/' },
      { name: 'Women Lacrosse SS27', url: 'https://publications.adicustom.com/view/30528812/' },
      { name: 'Track Field SS27', url: 'https://publications.adicustom.com/view/30538023/' },
      { name: 'Baseball SS27', url: 'https://publications.adicustom.com/view/452207082/' },
      { name: 'Softball SS27', url: 'https://publications.adicustom.com/view/657033565/' },
    ];

    const seenUrls = new Set(catalogs.map(c => c.url));
    for (const kc of knownCatalogs) {
      if (!seenUrls.has(kc.url)) {
        catalogs.push(kc);
        seenUrls.add(kc.url);
      }
    }

    log(`Found ${catalogs.length} catalogs to scan:`);
    catalogs.forEach(c => log(`  - ${c.name}: ${c.url}`));

    // Step 2: Open each catalog and flip through pages
    for (let ci = 0; ci < catalogs.length; ci++) {
      const catalog = catalogs[ci];
      const catalogSlug = catalog.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().substring(0, 40);
      const category = guessCategoryFromCatalog(catalog.name);
      log(`\n── Catalog ${ci + 1}/${catalogs.length}: ${catalog.name} (→ ${category}) ──`);

      try {
        await page.goto(catalog.url, { waitUntil: 'networkidle2' });
        await sleep(3000);

        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${catalogSlug}-cover.png`),
          fullPage: false,
        });

        // Detect flipbook navigation
        const flipbookInfo = await page.evaluate(() => {
          const pageCountEl = document.querySelector(
            '[class*="page-count"], [class*="total-pages"], [class*="pageCount"]'
          );
          const pageCount = pageCountEl
            ? parseInt(pageCountEl.textContent.replace(/[^\d]/g, ''))
            : null;

          let platform = 'unknown';
          if (document.querySelector('.publitas-viewer, [class*="publitas"]')) platform = 'publitas';
          else if (document.querySelector('#FlipHtmlContent, [class*="fliphtml"]')) platform = 'fliphtml5';
          else if (document.querySelector('.issuuembed, [class*="issuu"]')) platform = 'issuu';
          else if (document.querySelector('[class*="flipbook"], [class*="flip-book"]')) platform = 'flipbook';
          else if (document.querySelector('canvas')) platform = 'canvas-based';

          const nextSelectors = [
            '[aria-label="Next page"]', '[aria-label="next"]',
            '[class*="next-page"]', '[class*="nextPage"]', '[class*="page-next"]',
            '[class*="arrow-right"]', '[class*="nav-right"]', '[class*="right-arrow"]',
            'button[class*="next"]', 'a[class*="next"]',
            '[class*="forward"]', '.next', '#next',
          ];
          let nextButton = null;
          for (const sel of nextSelectors) {
            const el = document.querySelector(sel);
            if (el) { nextButton = sel; break; }
          }

          return { pageCount, platform, nextButton };
        });

        log(`   Platform: ${flipbookInfo.platform} | Pages: ${flipbookInfo.pageCount || '?'} | Nav: ${flipbookInfo.nextButton || 'keyboard'}`);

        const totalPages = flipbookInfo.pageCount || MAX_PAGES_PER_CATALOG;
        let catalogSkuCount = 0;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          // Extract all visible text
          const pageText = await page.evaluate(() => {
            const walker = document.createTreeWalker(
              document.body, NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  const el = node.parentElement;
                  if (!el) return NodeFilter.FILTER_REJECT;
                  const style = window.getComputedStyle(el);
                  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
                    return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );
            const texts = [];
            while (walker.nextNode()) {
              const t = walker.currentNode.textContent.trim();
              if (t) texts.push(t);
            }
            return texts.join(' ');
          });

          const extraText = await page.evaluate(() => {
            const extras = [];
            document.querySelectorAll('[data-sku], [data-style], [data-product], [data-article]').forEach(el => {
              extras.push(el.getAttribute('data-sku') || el.getAttribute('data-style') || el.getAttribute('data-product') || el.getAttribute('data-article') || '');
            });
            document.querySelectorAll('img[alt]').forEach(el => { extras.push(el.alt); });
            return extras.join(' ');
          });

          const fullText = `${pageText} ${extraText}`;

          // Extract SKUs
          const pageSkus = new Set();
          for (const pattern of SKU_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(fullText)) !== null) {
              const sku = match[1];
              if (sku.length < 4) continue;
              if (/^(2024|2025|2026|2027|2028|1800|1900)$/.test(sku)) continue;
              if (/^(100|200|300|400|500|600|700|800|900)$/.test(sku)) continue;
              pageSkus.add(sku);
            }
          }

          if (pageSkus.size > 0) {
            log(`   Page ${pageNum}: Found ${pageSkus.size} SKUs → ${[...pageSkus].join(', ')}`);
            for (const sku of pageSkus) {
              const skuIdx = fullText.indexOf(sku);
              const context = skuIdx >= 0
                ? fullText.substring(Math.max(0, skuIdx - 120), skuIdx + sku.length + 120).trim()
                : '';

              const name = extractProductName(context, sku);
              const retailPrice = extractRetailPrice(context);
              const nsaCost = retailPrice ? Math.round(retailPrice * NSA_COST_MULTIPLIER * 100) / 100 : null;

              allSkus.push({
                sku,
                name: name || `Adidas Custom ${catalog.name.replace(/FW\d+|SS\d+/g, '').trim()}`,
                catalog: catalog.name,
                category,
                page: pageNum,
                context,
                retailPrice,
                nsaCost,
              });
              catalogSkuCount++;
            }
          }

          // Screenshot every 5 pages or when SKUs are found
          if (pageNum % 5 === 0 || (pageSkus.size > 0 && pageNum <= 5)) {
            await page.screenshot({
              path: path.join(SCREENSHOT_DIR, `${catalogSlug}-p${pageNum}.png`),
              fullPage: false,
            });
          }

          // Navigate to next page
          if (pageNum < totalPages) {
            if (flipbookInfo.nextButton) {
              try { await page.click(flipbookInfo.nextButton); } catch {
                await page.keyboard.press('ArrowRight');
              }
            } else {
              await page.keyboard.press('ArrowRight');
            }
            await sleep(DELAY_BETWEEN_PAGES);

            // Detect end of catalog
            const newPageText = await page.evaluate(() => {
              const el = document.querySelector(
                '[class*="current-page"], [class*="pageNumber"], input[class*="page"]'
              );
              return el ? (el.value || el.textContent || '').trim() : '';
            });
            if (newPageText && newPageText === String(pageNum) && pageNum > 2) {
              log(`   Reached end of catalog at page ${pageNum}`);
              break;
            }
          }

          if (pageNum % 10 === 0) log(`   Progress: page ${pageNum}/${totalPages}...`);
        }

        log(`   Catalog complete: ${catalogSkuCount} SKU references`);

      } catch (err) {
        log(`   ERROR on catalog "${catalog.name}": ${err.message}`);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${catalogSlug}-error.png`),
          fullPage: false,
        }).catch(() => {});
      }
    }

    // Step 3: Deduplicate
    const seen = new Set();
    const unique = allSkus.filter(s => {
      if (seen.has(s.sku)) return false;
      seen.add(s.sku);
      return true;
    });

    log(`\n=== RESULTS ===`);
    log(`Total SKU references: ${allSkus.length}`);
    log(`Unique SKUs: ${unique.length}`);

    // Step 4: Write CSVs
    const csvHeader = 'sku,name,brand,category,retail_price,nsa_cost,catalog,page';
    const escape = (s) => `"${(s || '').toString().replace(/"/g, '""')}"`;
    const toCsvRow = (s) => [
      s.sku, s.name, 'Adidas', s.category,
      s.retailPrice || '', s.nsaCost || '',
      s.catalog, s.page
    ].map(escape).join(',');

    const allCsvPath = path.join(OUTPUT_DIR, 'adidas-catalog-skus.csv');
    fs.writeFileSync(allCsvPath, [csvHeader, ...unique.map(toCsvRow)].join('\n'));
    log(`All SKUs → ${allCsvPath}`);

    // Compare against existing catalog
    const existingSkus = new Set();
    const localCsvPath = path.join(OUTPUT_DIR, 'adidas-products.csv');
    if (fs.existsSync(localCsvPath)) {
      const lines = fs.readFileSync(localCsvPath, 'utf-8').split('\n').slice(1);
      for (const line of lines) {
        const sku = line.split(',')[0]?.trim();
        if (sku) existingSkus.add(sku);
      }
      log(`Existing catalog: ${existingSkus.size} SKUs`);
    }

    const newSkus = unique.filter(s => !existingSkus.has(s.sku));
    const newCsvPath = path.join(OUTPUT_DIR, 'adidas-catalog-new-skus.csv');
    fs.writeFileSync(newCsvPath, [csvHeader, ...newSkus.map(toCsvRow)].join('\n'));
    log(`New SKUs → ${newCsvPath} (${newSkus.length} products)`);

    // Step 5: Upsert new products to Supabase
    if (supabase && !DRY_RUN && newSkus.length > 0) {
      log(`\nUpserting ${newSkus.length} new products to Supabase...`);

      // Look up Adidas vendor_id
      let vendorId = null;
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id')
        .ilike('name', '%adidas%')
        .limit(1);
      if (vendors && vendors.length > 0) {
        vendorId = vendors[0].id;
        log(`Found Adidas vendor_id: ${vendorId}`);
      } else {
        log('WARNING: No Adidas vendor found in vendors table — products will have null vendor_id');
      }

      // Build product rows
      const productRows = newSkus.map(s => ({
        sku: s.sku,
        name: s.name,
        brand: 'Adidas',
        category: s.category,
        retail_price: s.retailPrice || null,
        nsa_cost: s.nsaCost || null,
        vendor_id: vendorId,
        is_active: true,
      }));

      // Upsert in batches of 100
      let upsertSuccess = 0;
      let upsertFail = 0;
      for (let i = 0; i < productRows.length; i += 100) {
        const batch = productRows.slice(i, i + 100);
        const { error } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'sku', ignoreDuplicates: true });
        if (error) {
          log(`  Batch ${Math.floor(i / 100) + 1} error: ${error.message}`);
          upsertFail += batch.length;
        } else {
          upsertSuccess += batch.length;
        }
      }
      log(`Supabase upsert: ${upsertSuccess} success, ${upsertFail} failed`);
    } else if (DRY_RUN) {
      log('\nDRY RUN — skipping Supabase upsert. Remove DRY_RUN=true to write to DB.');
    } else if (!supabase) {
      log('\nNo Supabase credentials — skipping DB upsert. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    }

    // Summary
    log(`\n=== SUMMARY ===`);
    log(`Catalogs scanned: ${catalogs.length}`);
    log(`Unique SKUs found: ${unique.length}`);
    log(`Already in catalog: ${unique.length - newSkus.length}`);
    log(`NEW products added: ${newSkus.length}`);
    log(`Pricing: retail × 50% × 75% = retail × ${NSA_COST_MULTIPLIER}`);
    log(`Screenshots: ${SCREENSHOT_DIR}/`);

  } catch (err) {
    log('FATAL ERROR: ' + err.message);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'fatal-error.png'),
      fullPage: false,
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[DISCOVER] Unhandled error:', err);
  process.exit(1);
});
