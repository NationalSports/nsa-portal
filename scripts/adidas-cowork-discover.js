#!/usr/bin/env node
/**
 * Adidas Cowork SKU Discovery
 *
 * Browses the Adidas Cowork B2B portal to discover ALL available products/SKUs,
 * not just the ones already in our database. Outputs a CSV of discovered SKUs
 * that can be imported into the NSA portal.
 *
 * This complements adidas-cowork-sync.js (which only syncs inventory for known SKUs).
 *
 * Setup:
 *   Same env vars as adidas-cowork-sync.js:
 *     SUPABASE_URL, SUPABASE_ANON_KEY, COWORK_EMAIL, COWORK_PASSWORD
 *
 * Usage:
 *   # First run with browser visible to verify selectors:
 *   COWORK_HEADLESS=false node scripts/adidas-cowork-discover.js
 *
 *   # Headless run (outputs CSV):
 *   node scripts/adidas-cowork-discover.js
 *
 * Output:
 *   - data/adidas-cowork-discovered.csv  (all discovered SKUs)
 *   - data/adidas-cowork-new-skus.csv    (only SKUs not already in our catalog)
 *   - Screenshots saved to /tmp/cowork-discover-*.png for debugging
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── Config ───
const COWORK_URL = 'https://www.adidas.com/us/cowork';
const COWORK_LOGIN_URL = 'https://www.adidas.com/us/cowork/login';
const HEADLESS = process.env.COWORK_HEADLESS !== 'false';
const DELAY_BETWEEN_PAGES = 2500;   // ms between page navigations
const DELAY_BETWEEN_PRODUCTS = 1500; // ms between product detail loads
const TIMEOUT = 60000;
const MAX_PAGES = 200; // safety limit on pagination
const SCREENSHOT_DIR = '/tmp';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data');

// Supabase (for comparing against existing products)
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
const coworkEmail = process.env.COWORK_EMAIL || '';
const coworkPassword = process.env.COWORK_PASSWORD || '';

if (!coworkEmail || !coworkPassword) {
  console.error('[DISCOVER] Missing COWORK_EMAIL or COWORK_PASSWORD');
  process.exit(1);
}

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// ─── Helpers ───
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toLocaleString()}] ${msg}`);

// ─── Login (reused from sync script) ───
async function loginToCowork(page) {
  log('Navigating to Cowork login...');
  await page.goto(COWORK_LOGIN_URL, { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Find email input
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
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cowork-discover-login.png`, fullPage: true });
    log('ERROR: Could not find email input. Screenshot saved.');
    throw new Error('Login failed — email input not found');
  }

  await emailInput.type(coworkEmail, { delay: 50 });
  await sleep(500);

  // Find password input
  const passSelectors = [
    'input[name="password"]', 'input[type="password"]',
    'input[id="password"]', '#login-password'
  ];
  for (const sel of passSelectors) {
    const passInput = await page.$(sel);
    if (passInput) {
      await passInput.type(coworkPassword, { delay: 50 });
      break;
    }
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
  log('Logged in to Cowork');
}

// ─── Discover: Browse catalog and extract products ───
async function discoverProducts(page) {
  const discovered = [];

  // Step 1: Navigate to catalog / product listing
  // Try common B2B portal catalog URL patterns
  const catalogUrls = [
    `${COWORK_URL}/catalog`,
    `${COWORK_URL}/products`,
    `${COWORK_URL}/shop`,
    `${COWORK_URL}/assortment`,
    `${COWORK_URL}/collection`,
    `${COWORK_URL}/`,
  ];

  let catalogFound = false;
  for (const url of catalogUrls) {
    log(`Trying catalog URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // Check if we landed on a page with product listings
    const hasProducts = await page.evaluate(() => {
      const indicators = [
        '[class*="product"]', '[class*="catalog"]', '[class*="item-card"]',
        '[class*="sku"]', '[class*="article"]', '[data-product]',
        '[class*="tile"]', '[class*="grid"] [class*="card"]',
        'table tbody tr', '.product-list', '.product-grid'
      ];
      return indicators.some(sel => document.querySelectorAll(sel).length > 0);
    });

    if (hasProducts) {
      log(`Found product listings at: ${url}`);
      catalogFound = true;
      break;
    }
  }

  if (!catalogFound) {
    // Try finding catalog links from the main page
    log('No direct catalog URL worked. Looking for catalog navigation links...');
    await page.goto(COWORK_URL, { waitUntil: 'networkidle2' });
    await sleep(2000);

    const navLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .filter(a => {
          const text = a.textContent.toLowerCase();
          const href = a.href.toLowerCase();
          return ['catalog', 'product', 'shop', 'browse', 'assortment', 'collection', 'all']
            .some(k => text.includes(k) || href.includes(k));
        })
        .map(a => ({ text: a.textContent.trim(), href: a.href }));
    });

    log(`Found ${navLinks.length} potential catalog links:`);
    navLinks.forEach(l => log(`  - "${l.text}" → ${l.href}`));

    // Screenshot the main page for debugging
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cowork-discover-main.png`, fullPage: true });
    log(`Main page screenshot saved to ${SCREENSHOT_DIR}/cowork-discover-main.png`);

    if (navLinks.length > 0) {
      await page.goto(navLinks[0].href, { waitUntil: 'networkidle2' });
      await sleep(2000);
      catalogFound = true;
    }
  }

  if (!catalogFound) {
    log('WARNING: Could not locate catalog. Attempting to search for all products...');
    // Some portals have a search that returns all when empty or with *
    const searchSelectors = [
      'input[type="search"]', 'input[name="search"]', 'input[name="q"]',
      'input[placeholder*="search" i]', 'input[class*="search"]',
      '#search', '.search-input'
    ];
    for (const sel of searchSelectors) {
      const searchInput = await page.$(sel);
      if (searchInput) {
        await searchInput.type(' ', { delay: 50 });
        await page.keyboard.press('Enter');
        await sleep(3000);
        break;
      }
    }
  }

  // Screenshot current catalog page
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cowork-discover-catalog.png`, fullPage: true });
  log(`Catalog page screenshot saved to ${SCREENSHOT_DIR}/cowork-discover-catalog.png`);

  // Step 2: Check for category/sport filters and iterate through them
  const categories = await page.evaluate(() => {
    const catLinks = [];
    // Look for filter/category sidebar or nav
    const filterSelectors = [
      '[class*="filter"] a', '[class*="category"] a', '[class*="facet"] a',
      '[class*="sidebar"] a', 'nav[class*="category"] a',
      '[class*="sport"] a', '[data-category] a'
    ];
    for (const sel of filterSelectors) {
      const links = document.querySelectorAll(sel);
      links.forEach(a => {
        const text = a.textContent.trim();
        if (text && text.length < 50) {
          catLinks.push({ text, href: a.href });
        }
      });
      if (catLinks.length > 0) break;
    }
    return catLinks;
  });

  if (categories.length > 0) {
    log(`Found ${categories.length} categories to browse:`);
    categories.forEach(c => log(`  - ${c.text}`));
  }

  // Step 3: Extract products from current page(s) with pagination
  async function extractProductsFromPage() {
    return page.evaluate(() => {
      const products = [];

      // Strategy A: Product cards/tiles
      const cardSelectors = [
        '[class*="product-card"]', '[class*="product-tile"]',
        '[class*="item-card"]', '[class*="catalog-item"]',
        '[data-product-id]', '[data-sku]', '[data-article]',
        '[class*="ProductCard"]', '[class*="product_card"]'
      ];
      for (const sel of cardSelectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length === 0) continue;

        for (const card of cards) {
          const sku = card.getAttribute('data-sku')
            || card.getAttribute('data-product-id')
            || card.getAttribute('data-article')
            || card.querySelector('[class*="sku"], [class*="article"], [class*="style-number"]')?.textContent?.trim()
            || '';

          const name = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4, a')?.textContent?.trim() || '';
          const price = card.querySelector('[class*="price"]')?.textContent?.trim() || '';
          const link = card.querySelector('a[href]')?.href || '';
          const img = card.querySelector('img')?.src || '';
          const color = card.querySelector('[class*="color"]')?.textContent?.trim() || '';

          if (sku || name) {
            products.push({ sku, name, price, link, img, color });
          }
        }
        if (products.length > 0) break;
      }

      // Strategy B: Table rows
      if (products.length === 0) {
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const headers = [...table.querySelectorAll('th, thead td')].map(th => th.textContent.trim().toLowerCase());
          const skuIdx = headers.findIndex(h => h.includes('sku') || h.includes('style') || h.includes('article') || h.includes('item'));
          const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('description') || h.includes('product'));
          const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('cost') || h.includes('msrp'));

          if (skuIdx >= 0 || nameIdx >= 0) {
            const rows = table.querySelectorAll('tbody tr');
            for (const row of rows) {
              const cells = row.querySelectorAll('td');
              products.push({
                sku: skuIdx >= 0 ? cells[skuIdx]?.textContent?.trim() : '',
                name: nameIdx >= 0 ? cells[nameIdx]?.textContent?.trim() : '',
                price: priceIdx >= 0 ? cells[priceIdx]?.textContent?.trim() : '',
                link: row.querySelector('a[href]')?.href || '',
                img: '',
                color: '',
              });
            }
          }
        }
      }

      // Strategy C: Any list of links with SKU-like patterns
      if (products.length === 0) {
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        for (const a of allLinks) {
          const href = a.href;
          const text = a.textContent.trim();
          // Match patterns like /product/AB1234 or ?sku=AB1234
          const skuMatch = href.match(/(?:product|sku|style|article)[\/=]([A-Z0-9]{4,})/i)
            || text.match(/^([A-Z]{1,3}\d{2,}[\w-]*)$/);
          if (skuMatch) {
            products.push({
              sku: skuMatch[1],
              name: text,
              price: '',
              link: href,
              img: '',
              color: '',
            });
          }
        }
      }

      return products;
    });
  }

  async function getNextPageButton() {
    return page.evaluate(() => {
      const nextSelectors = [
        'a[aria-label="Next"]', 'a[aria-label="next"]',
        'button[aria-label="Next"]', 'button[aria-label="next"]',
        '[class*="next"]', '[class*="pagination"] a:last-child',
        'a:has-text("Next")', 'a:has-text("›")', 'a:has-text("»")',
        '[rel="next"]'
      ];
      for (const sel of nextSelectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled && !el.classList.contains('disabled')) {
          return sel;
        }
      }
      return null;
    });
  }

  // Browse current listing + all paginated pages
  const pagesToVisit = categories.length > 0
    ? categories.map(c => c.href)
    : [page.url()]; // just the current page if no categories

  for (const pageUrl of pagesToVisit) {
    if (pageUrl !== page.url()) {
      await page.goto(pageUrl, { waitUntil: 'networkidle2' });
      await sleep(DELAY_BETWEEN_PAGES);
    }

    let pageNum = 1;
    let hasNextPage = true;

    while (hasNextPage && pageNum <= MAX_PAGES) {
      log(`  Page ${pageNum} — extracting products...`);
      const pageProducts = await extractProductsFromPage();
      log(`  Found ${pageProducts.length} products on this page`);

      if (pageProducts.length === 0 && pageNum === 1) {
        // Take a debug screenshot on first empty page
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/cowork-discover-empty-p${pageNum}.png`,
          fullPage: true
        });
        log(`  Empty page screenshot saved for debugging`);
      }

      discovered.push(...pageProducts);

      // Try to go to next page
      const nextSel = await getNextPageButton();
      if (nextSel) {
        await page.click(nextSel);
        await sleep(DELAY_BETWEEN_PAGES);
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }
  }

  // Step 4: If we found product links, visit each to get more details
  const productsWithLinks = discovered.filter(p => p.link && !p.sku);
  if (productsWithLinks.length > 0 && productsWithLinks.length <= 500) {
    log(`Visiting ${productsWithLinks.length} product detail pages for SKU extraction...`);
    for (let i = 0; i < productsWithLinks.length; i++) {
      const prod = productsWithLinks[i];
      try {
        await page.goto(prod.link, { waitUntil: 'networkidle2' });
        await sleep(DELAY_BETWEEN_PRODUCTS);

        const details = await page.evaluate(() => {
          // Try to find SKU on detail page
          const skuSelectors = [
            '[class*="sku"]', '[class*="article"]', '[class*="style-number"]',
            '[class*="product-id"]', '[data-sku]', '[data-article]',
            'span:has-text("SKU")', 'span:has-text("Style")', 'span:has-text("Article")'
          ];
          let sku = '';
          for (const sel of skuSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              sku = el.textContent.replace(/^(SKU|Style|Article)[:\s]*/i, '').trim();
              if (sku) break;
            }
          }

          // Also check meta tags and structured data
          if (!sku) {
            const meta = document.querySelector('meta[property="product:sku"], meta[name="sku"]');
            if (meta) sku = meta.getAttribute('content') || '';
          }

          const name = document.querySelector('h1, [class*="product-name"], [class*="product-title"]')?.textContent?.trim() || '';
          const price = document.querySelector('[class*="price"]')?.textContent?.trim() || '';
          const description = document.querySelector('[class*="description"]')?.textContent?.trim() || '';
          const sizes = Array.from(document.querySelectorAll('[class*="size-option"], [class*="size-chip"], [class*="variant"]'))
            .map(el => el.textContent.trim())
            .filter(Boolean);
          const colors = Array.from(document.querySelectorAll('[class*="color-option"], [class*="color-chip"], [class*="swatch"]'))
            .map(el => el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent.trim())
            .filter(Boolean);

          return { sku, name, price, description, sizes, colors };
        });

        if (details.sku) prod.sku = details.sku;
        if (details.name) prod.name = details.name;
        if (details.price) prod.price = details.price;
        if (details.description) prod.description = details.description;
        if (details.sizes?.length) prod.sizes = details.sizes.join(';');
        if (details.colors?.length) prod.colors = details.colors.join(';');

        if ((i + 1) % 25 === 0) log(`  Progress: ${i + 1}/${productsWithLinks.length}`);
      } catch (err) {
        log(`  Error on detail page ${prod.link}: ${err.message}`);
      }
    }
  }

  return discovered;
}

// ─── Main ───
async function main() {
  log('=== Adidas Cowork SKU Discovery ===');
  log(`Headless: ${HEADLESS}`);

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(TIMEOUT);
  page.setDefaultTimeout(TIMEOUT);

  // Capture any API responses that might contain product data
  const apiProducts = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('product') || url.includes('catalog') || url.includes('article') || url.includes('assortment')) {
      if (response.headers()['content-type']?.includes('application/json')) {
        try {
          const json = await response.json();
          // If the API response contains product arrays, capture them
          const items = json.products || json.items || json.results || json.data?.products || [];
          if (Array.isArray(items) && items.length > 0) {
            log(`[API INTERCEPT] Captured ${items.length} products from: ${url}`);
            for (const item of items) {
              apiProducts.push({
                sku: item.sku || item.articleNumber || item.styleNumber || item.id || '',
                name: item.name || item.title || item.displayName || '',
                price: item.price || item.msrp || item.retailPrice || '',
                color: item.color || item.colorway || '',
                category: item.category || item.sport || '',
                img: item.image || item.imageUrl || item.thumbnail || '',
              });
            }
          }
        } catch {}
      }
    }
  });

  try {
    await loginToCowork(page);
    const discovered = await discoverProducts(page);

    // Merge page-scraped + API-intercepted products
    const allProducts = [...discovered, ...apiProducts];

    // Deduplicate by SKU
    const seen = new Set();
    const unique = allProducts.filter(p => {
      const key = p.sku || p.name || p.link;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    log(`\nTotal discovered: ${unique.length} unique products`);
    log(`  From page scraping: ${discovered.length}`);
    log(`  From API intercepts: ${apiProducts.length}`);

    // Write full discovered CSV
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const csvHeader = 'sku,name,price,color,category,link';
    const csvRows = unique.map(p => {
      const escape = (s) => `"${(s || '').toString().replace(/"/g, '""')}"`;
      return [p.sku, p.name, p.price, p.color, p.category || '', p.link || ''].map(escape).join(',');
    });

    const fullCsvPath = path.join(OUTPUT_DIR, 'adidas-cowork-discovered.csv');
    fs.writeFileSync(fullCsvPath, [csvHeader, ...csvRows].join('\n'));
    log(`Full discovery CSV written to: ${fullCsvPath} (${unique.length} products)`);

    // Compare against existing products to find new ones
    let existingSkus = new Set();
    if (supabase) {
      const { data: existing } = await supabase
        .from('products')
        .select('sku')
        .ilike('brand', 'Adidas');
      if (existing) {
        existingSkus = new Set(existing.map(p => p.sku));
        log(`Found ${existingSkus.size} existing Adidas SKUs in database`);
      }
    }

    // Also load from local CSV
    const localCsvPath = path.join(OUTPUT_DIR, 'adidas-products.csv');
    if (fs.existsSync(localCsvPath)) {
      const lines = fs.readFileSync(localCsvPath, 'utf-8').split('\n').slice(1);
      for (const line of lines) {
        const sku = line.split(',')[0]?.trim();
        if (sku) existingSkus.add(sku);
      }
      log(`Total known SKUs (DB + CSV): ${existingSkus.size}`);
    }

    const newProducts = unique.filter(p => p.sku && !existingSkus.has(p.sku));
    const newCsvPath = path.join(OUTPUT_DIR, 'adidas-cowork-new-skus.csv');
    fs.writeFileSync(newCsvPath, [csvHeader, ...newProducts.map(p => {
      const escape = (s) => `"${(s || '').toString().replace(/"/g, '""')}"`;
      return [p.sku, p.name, p.price, p.color, p.category || '', p.link || ''].map(escape).join(',');
    })].join('\n'));
    log(`New SKUs CSV written to: ${newCsvPath} (${newProducts.length} new products)`);

    // Summary
    log('\n=== SUMMARY ===');
    log(`Total unique products discovered: ${unique.length}`);
    log(`Already in catalog: ${unique.length - newProducts.length}`);
    log(`NEW products to add: ${newProducts.length}`);
    log(`\nOutput files:`);
    log(`  All discovered:  ${fullCsvPath}`);
    log(`  New SKUs only:   ${newCsvPath}`);
    log(`  Debug screenshots: ${SCREENSHOT_DIR}/cowork-discover-*.png`);

  } catch (err) {
    log('FATAL ERROR: ' + err.message);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cowork-discover-error.png`, fullPage: true }).catch(() => {});
    log(`Error screenshot saved to ${SCREENSHOT_DIR}/cowork-discover-error.png`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[DISCOVER] Unhandled error:', err);
  process.exit(1);
});
