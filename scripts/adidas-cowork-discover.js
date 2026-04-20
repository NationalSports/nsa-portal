#!/usr/bin/env node
/**
 * Adidas Custom Catalog SKU Scanner (OCR-based)
 *
 * Opens each flipbook catalog from https://www.adidas-custom.com/catalogs/,
 * flips through every page, takes a screenshot, runs Tesseract OCR to read
 * the text, extracts SKUs/prices, and upserts new products to Supabase.
 *
 * Naming rules:
 *   - SKU ends in W → Women's style (appended to name)
 *   - SKU ends in Y → Youth style (appended to name)
 *
 * Pricing: NSA Cost = Retail × 50% × 75% (= retail × 0.375)
 *
 * Requirements: tesseract-ocr, puppeteer
 *   apt-get install -y tesseract-ocr
 *   npm install puppeteer
 *
 * Usage:
 *   COWORK_HEADLESS=false node scripts/adidas-cowork-discover.js   # watch browser
 *   node scripts/adidas-cowork-discover.js                         # headless
 *   DRY_RUN=true node scripts/adidas-cowork-discover.js            # no DB writes
 */

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Optional Supabase
let createClient;
try { createClient = require('@supabase/supabase-js').createClient; } catch { createClient = null; }

// ─── Config ───
const CATALOGS_URL = 'https://www.adidas-custom.com/catalogs/';
const HEADLESS = process.env.COWORK_HEADLESS !== 'false';
const DRY_RUN = process.env.DRY_RUN === 'true';
const DELAY_BETWEEN_PAGES = 1500;
const TIMEOUT = 60000;
const MAX_PAGES_PER_CATALOG = 150;
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'adidas-catalog-screenshots');

const NSA_COST_MULTIPLIER = 0.50 * 0.75; // = 0.375

// Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
const supabase = (createClient && supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey) : null;

// ─── Helpers ───
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toLocaleString()}] ${msg}`);

// Run Tesseract OCR on an image file and return text
function ocr(imagePath) {
  try {
    return execSync(`tesseract "${imagePath}" stdout 2>/dev/null`, { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

// Extract Adidas custom SKUs from OCR text
// Adidas custom SKUs look like: ADQU4605W, AD04615W, ADFS4530, etc.
function extractSkus(text) {
  const skus = new Set();

  // Primary pattern: AD + letters/digits, 6-12 chars total
  // Examples from catalog: ADQU4605W, AD04615W, ADFS4530Y
  const patterns = [
    /\b(AD[A-Z0-9]{4,10})\b/gi,
  ];

  for (const pat of patterns) {
    pat.lastIndex = 0;
    let match;
    while ((match = pat.exec(text)) !== null) {
      let sku = match[1].toUpperCase();
      // Clean up common OCR artifacts
      sku = sku.replace(/[OQ](?=\d)/g, '0'); // O before digit → 0
      if (sku.length >= 6 && sku.length <= 12) {
        skus.add(sku);
      }
    }
  }

  return [...skus];
}

// Extract MSRP price from nearby text
function extractMsrp(text) {
  const match = text.match(/MSRP\s*\$\s?(\d{1,3}(?:\.\d{2})?)/i);
  if (match) return parseFloat(match[1]);
  // Fallback: any price
  const prices = [...text.matchAll(/\$\s?(\d{2,3}(?:\.\d{2})?)/g)].map(m => parseFloat(m[1]));
  return prices.length > 0 ? Math.max(...prices) : null;
}

// Extract product name from text block
function extractProductName(text) {
  // Look for product name lines (typically ALL CAPS or Title Case before SKU listing)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Match lines like "SENECA JERSEY", "PHOENIX BOTTOM", "STRIKER TOP"
    if (/^[A-Z][A-Z\s]{3,30}(JERSEY|TOP|BOTTOM|SHORT|PANT|HOODIE|POLO|TEE|JACKET|VEST|QUARTER|ZIP|KILT|SKIRT|TIGHT|SOCK|CLEAT|SHOE|WINDBREAKER|PULLOVER|CREW|JOGGER)/i.test(line)) {
      return line.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

// Determine style suffix → Women's / Youth
function getStyleSuffix(sku) {
  if (sku.endsWith('W')) return " - Women's";
  if (sku.endsWith('Y')) return ' - Youth';
  return '';
}

// Map catalog name to product category
function guessCategoryFromCatalog(catalogName) {
  const lower = catalogName.toLowerCase();
  if (lower.includes('sideline')) return 'Hoodies';
  if (lower.includes('cross country') || lower.includes('track')) return 'Shorts';
  if (lower.includes('training')) return 'Tees';
  return 'Jersey Tops';
}

// Known catalogs
const KNOWN_CATALOGS = [
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

// ─── Main ───
async function main() {
  log('=== Adidas Custom Catalog SKU Scanner (OCR) ===');
  log(`Headless: ${HEADLESS} | Dry run: ${DRY_RUN}`);
  if (!supabase) log('No Supabase credentials — will only output CSV files');

  // Verify tesseract
  try {
    execSync('tesseract --version 2>&1', { encoding: 'utf-8' });
    log('Tesseract OCR: available');
  } catch {
    log('ERROR: tesseract not installed. Run: apt-get install -y tesseract-ocr');
    process.exit(1);
  }

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1000', '--ignore-certificate-errors'],
    defaultViewport: { width: 1440, height: 1000 },
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(TIMEOUT);
  page.setDefaultTimeout(TIMEOUT);

  // All discovered products: { sku, name, catalog, category, page, retailPrice, nsaCost }
  const allProducts = [];

  try {
    // Step 1: Use known catalog list (hardcoded since the page renders links fine)
    const catalogs = KNOWN_CATALOGS;
    log(`Scanning ${catalogs.length} catalogs...`);

    // Step 2: Flip through each catalog
    for (let ci = 0; ci < catalogs.length; ci++) {
      const catalog = catalogs[ci];
      const catalogSlug = catalog.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().substring(0, 40);
      const defaultCategory = guessCategoryFromCatalog(catalog.name);
      log(`\n── Catalog ${ci + 1}/${catalogs.length}: ${catalog.name} ──`);

      try {
        await page.goto(catalog.url, { waitUntil: 'networkidle2' });
        await sleep(3000);

        // Detect total pages from the flipbook viewer
        const totalPages = await page.evaluate(() => {
          // Look for "page X of Y" in the title bar or page counter
          const allText = document.body.innerText || '';
          const match = allText.match(/(?:of|\/)\s*(\d+)/);
          if (match) return parseInt(match[1]);
          // Check title
          const titleMatch = document.title.match(/(?:of|\/)\s*(\d+)/);
          if (titleMatch) return parseInt(titleMatch[1]);
          return null;
        }) || MAX_PAGES_PER_CATALOG;

        log(`   Pages: ${totalPages}`);

        let catalogSkuCount = 0;
        let lastOcrText = ''; // track to detect stuck pages

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          // Screenshot the current page
          const screenshotPath = path.join(SCREENSHOT_DIR, `${catalogSlug}-p${pageNum}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: false });

          // OCR the screenshot
          const ocrText = ocr(screenshotPath);

          // Detect if we're stuck on the same page (end of catalog)
          if (pageNum > 3 && ocrText === lastOcrText) {
            log(`   Reached end of catalog at page ${pageNum} (duplicate content)`);
            // Clean up duplicate screenshot
            fs.unlinkSync(screenshotPath);
            break;
          }
          lastOcrText = ocrText;

          // Extract SKUs from OCR text
          const skus = extractSkus(ocrText);
          const productName = extractProductName(ocrText);
          const msrp = extractMsrp(ocrText);

          if (skus.length > 0) {
            const nsaCost = msrp ? Math.round(msrp * NSA_COST_MULTIPLIER * 100) / 100 : null;
            log(`   Page ${pageNum}: ${skus.join(', ')}${msrp ? ` | MSRP $${msrp}` : ''}${productName ? ` | ${productName}` : ''}`);

            for (const sku of skus) {
              const suffix = getStyleSuffix(sku);
              const name = productName
                ? `Adidas ${productName}${suffix}`
                : `Adidas Custom ${catalog.name.replace(/FW\d+|SS\d+/g, '').trim()}${suffix}`;

              // Determine category from product name if possible
              let category = defaultCategory;
              if (productName) {
                const pn = productName.toUpperCase();
                if (pn.includes('BOTTOM') || pn.includes('SHORT') || pn.includes('PANT') || pn.includes('TIGHT') || pn.includes('JOGGER')) category = 'Jersey Bottoms';
                else if (pn.includes('HOODIE') || pn.includes('PULLOVER')) category = 'Hoodies';
                else if (pn.includes('POLO')) category = 'Polos';
                else if (pn.includes('TEE')) category = 'Tees';
                else if (pn.includes('SOCK')) category = 'Socks';
                else if (pn.includes('SHOE') || pn.includes('CLEAT')) category = 'Footwear';
                else if (pn.includes('HAT') || pn.includes('CAP')) category = 'Hats';
                else if (pn.includes('JERSEY') || pn.includes('TOP') || pn.includes('VEST')) category = 'Jersey Tops';
                else if (pn.includes('KILT') || pn.includes('SKIRT')) category = 'Jersey Bottoms';
              }

              allProducts.push({
                sku,
                name,
                brand: 'Adidas',
                catalog: catalog.name,
                category,
                page: pageNum,
                retailPrice: msrp,
                nsaCost,
              });
              catalogSkuCount++;
            }
          } else {
            // Delete screenshots that have no SKU data to save space
            if (pageNum > 1) fs.unlinkSync(screenshotPath);
          }

          // Navigate to next page via arrow key
          if (pageNum < totalPages) {
            await page.keyboard.press('ArrowRight');
            await sleep(DELAY_BETWEEN_PAGES);
          }

          if (pageNum % 10 === 0) log(`   Progress: page ${pageNum}/${totalPages}...`);
        }

        log(`   Done: ${catalogSkuCount} SKU entries found`);

      } catch (err) {
        log(`   ERROR: ${err.message}`);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${catalogSlug}-error.png`),
          fullPage: false,
        }).catch(() => {});
      }
    }

    // Step 3: Deduplicate by SKU (keep first occurrence which has the best context)
    const seen = new Set();
    const unique = allProducts.filter(p => {
      if (seen.has(p.sku)) return false;
      seen.add(p.sku);
      return true;
    });

    log(`\n=== RESULTS ===`);
    log(`Total SKU references: ${allProducts.length}`);
    log(`Unique SKUs: ${unique.length}`);

    // Step 4: Write CSV
    const csvHeader = 'sku,name,brand,category,retail_price,nsa_cost,available_sizes,vendor_name,catalog,page';
    const escape = (s) => `"${(s || '').toString().replace(/"/g, '""')}"`;
    const toCsvRow = (p) => [
      p.sku, p.name, 'Adidas', p.category,
      p.retailPrice || '', p.nsaCost || '',
      '', 'Adidas', p.catalog, p.page
    ].map(escape).join(',');

    const allCsvPath = path.join(OUTPUT_DIR, 'adidas-catalog-skus.csv');
    fs.writeFileSync(allCsvPath, [csvHeader, ...unique.map(toCsvRow)].join('\n'));
    log(`All SKUs → ${allCsvPath}`);

    // Compare against existing
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

    const newProducts = unique.filter(p => !existingSkus.has(p.sku));
    const newCsvPath = path.join(OUTPUT_DIR, 'adidas-catalog-new-skus.csv');
    fs.writeFileSync(newCsvPath, [csvHeader, ...newProducts.map(toCsvRow)].join('\n'));
    log(`New SKUs → ${newCsvPath} (${newProducts.length} products)`);

    // Step 5: Upsert to Supabase
    if (supabase && !DRY_RUN && newProducts.length > 0) {
      log(`\nUpserting ${newProducts.length} new products to Supabase...`);

      // Find Adidas vendor_id
      let vendorId = null;
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id')
        .ilike('name', '%adidas%')
        .limit(1);
      if (vendors && vendors.length > 0) {
        vendorId = vendors[0].id;
        log(`Adidas vendor_id: ${vendorId}`);
      }

      const rows = newProducts.map(p => ({
        sku: p.sku,
        name: p.name,
        brand: 'Adidas',
        category: p.category,
        retail_price: p.retailPrice || null,
        nsa_cost: p.nsaCost || null,
        vendor_id: vendorId,
        is_active: true,
      }));

      let upsertOk = 0, upsertFail = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'sku', ignoreDuplicates: true });
        if (error) {
          log(`  Batch error: ${error.message}`);
          upsertFail += batch.length;
        } else {
          upsertOk += batch.length;
        }
      }
      log(`Supabase: ${upsertOk} inserted, ${upsertFail} failed`);
    } else if (DRY_RUN) {
      log('\nDRY RUN — skipping Supabase. Unset DRY_RUN to write to DB.');
    }

    log(`\n=== SUMMARY ===`);
    log(`Catalogs scanned: ${catalogs.length}`);
    log(`Unique SKUs discovered: ${unique.length}`);
    log(`Already in catalog: ${unique.length - newProducts.length}`);
    log(`NEW products: ${newProducts.length}`);
    log(`Pricing: MSRP × 50% × 75% = MSRP × ${NSA_COST_MULTIPLIER}`);
    log(`CSV files: ${allCsvPath}`);
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
