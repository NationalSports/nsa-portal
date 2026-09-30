#!/usr/bin/env node
'use strict';

/**
 * Adidas CLICK inventory sync.
 *
 * Uses CLICK's catalog + materials/information APIs from an authenticated browser
 * session. Unlike the retired DOM scraper, this writes rows for sold-out sizes
 * and preserves each size's next restock date.
 *
 * Required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Authentication (choose one):
 *   COWORK_USER_DATA_DIR=/path/to/persistent/chrome/profile
 *   COWORK_EMAIL=... COWORK_PASSWORD=...
 *
 * Useful:
 *   ADIDAS_SKUS=KD5431,KD5434       targeted recovery
 *   COWORK_HEADLESS=false           complete/inspect login
 *   ADIDAS_ACCOUNT_ID=0000270384
 */

const path = require('path');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const {
  buildInventoryRows,
  catalogProducts,
  normalizeCatalogProduct,
  projectedInventoryByCode,
  sizeObjectsFromMaterials,
} = require('./lib/adidas-materials-sync');

const PORTAL_URL = process.env.COWORK_URL || 'https://b2bportal.adidas-group.com/';
const API_ROOT = process.env.ADIDAS_API_ROOT || 'https://clapp-v2.whs.adidas.com/service';
const ACCOUNT_ID = process.env.ADIDAS_ACCOUNT_ID || '0000270384';
const SALES_ORG = process.env.ADIDAS_SALES_ORG || '6040';
const SOLD_TO = process.env.ADIDAS_SOLD_TO || '6017364000';
const BRAND = process.env.ADIDAS_BRAND || 'adidas';
const SYSTEM = process.env.ADIDAS_SYSTEM || 'CLICK';
const HEADLESS = process.env.COWORK_HEADLESS !== 'false';
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.ADIDAS_REQUEST_DELAY_MS || 250));
const TARGET_SKUS = new Set(
  String(process.env.ADIDAS_SKUS || '')
    .split(',')
    .map((sku) => sku.trim().toUpperCase())
    .filter(Boolean),
);

const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const coworkEmail = process.env.COWORK_EMAIL || '';
const coworkPassword = process.env.COWORK_PASSWORD || '';
const userDataDir = process.env.COWORK_USER_DATA_DIR
  ? path.resolve(process.env.COWORK_USER_DATA_DIR)
  : undefined;

if (!supabaseUrl || !supabaseKey) {
  console.error('[SYNC] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

async function readSid(page) {
  const value = await page.evaluate(() => {
    const direct = localStorage.getItem('sid');
    if (direct) return direct;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && /(?:^|[-_])sid$/i.test(key)) return localStorage.getItem(key);
    }
    return '';
  });
  return String(value || '').replace(/^"|"$/g, '');
}

async function ensureAuthenticated(page) {
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  let sid = await readSid(page);
  if (sid) return sid;

  if (!coworkEmail || !coworkPassword) {
    throw new Error(
      'CLICK login required. Run with COWORK_HEADLESS=false and COWORK_USER_DATA_DIR '
      + 'pointing to a persistent browser profile, sign in, then rerun.',
    );
  }

  const email = await page.$(
    'input[type="email"],input[name="email"],input[name="username"],'
    + 'input[autocomplete="username"]',
  );
  const password = await page.$(
    'input[type="password"],input[name="password"],input[autocomplete="current-password"]',
  );
  if (!email || !password) {
    throw new Error('CLICK login form was not detected; use a persistent signed-in browser profile.');
  }
  await email.type(coworkEmail, { delay: 25 });
  await password.type(coworkPassword, { delay: 25 });
  const submit = await page.$('button[type="submit"],input[type="submit"]');
  if (!submit) throw new Error('CLICK login submit button was not detected.');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null),
    submit.click(),
  ]);
  await sleep(2000);
  sid = await readSid(page);
  if (!sid) throw new Error('CLICK login completed without a usable sid token.');
  return sid;
}

async function pageJson(page, sid, url, { method = 'GET', body } = {}) {
  const result = await page.evaluate(async ({ requestUrl, requestMethod, requestBody, token }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'request-id': crypto.randomUUID(),
      },
      body: requestBody == null ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  }, {
    requestUrl: url,
    requestMethod: method,
    requestBody: body,
    token: sid,
  });

  if (result.status === 401) {
    const error = new Error('CLICK session expired (HTTP 401); sign in and resume the sync.');
    error.code = 'CLICK_AUTH_EXPIRED';
    throw error;
  }
  if (!result.ok) {
    throw new Error(`CLICK API ${result.status} for ${url}: ${JSON.stringify(result.data).slice(0, 500)}`);
  }
  if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  return result.data;
}

async function fetchAllProducts() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products')
      .select('id,sku,name,available_sizes,inventory_source,is_active,is_archived')
      .eq('brand', 'Adidas')
      .or('is_active.is.null,is_active.eq.true')
      .or('is_archived.is.null,is_archived.eq.false')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Products query failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows
    .filter((product) => (product.inventory_source || 'click') !== 'agron')
    .filter((product) => product.sku)
    .filter((product) => !TARGET_SKUS.size || TARGET_SKUS.has(String(product.sku).toUpperCase()));
}

async function fetchSizeMaps() {
  const maps = {};
  const { data, error } = await supabase
    .from('adidas_size_maps')
    .select('conversion_id,code_labels');
  if (error) throw new Error(`Size-map query failed: ${error.message}`);
  for (const row of data || []) maps[String(row.conversion_id)] = row.code_labels || {};
  return maps;
}

async function fetchOpenCartIds(page, sid) {
  const payload = await pageJson(
    page,
    sid,
    `${API_ROOT}/cart/${ACCOUNT_ID}/storefronts/1/cart`,
  );
  const carts = payload?._embedded?.cart
    || payload?.data?._embedded?.cart
    || payload?.carts
    || [];
  return (Array.isArray(carts) ? carts : [carts])
    .filter((cart) => String(cart?.status || '').toUpperCase() === 'OPEN')
    .map((cart) => String(cart?.id || cart?.cartId || '').trim())
    .filter(Boolean);
}

async function fetchCatalog(page, sid, products) {
  const bySku = {};
  for (let index = 0; index < products.length; index += 50) {
    const batch = products.slice(index, index + 50);
    const wanted = new Set(batch.map((product) => String(product.sku).toUpperCase()));
    const payload = await pageJson(
      page,
      sid,
      `${API_ROOT}/catalog/products/${SALES_ORG}/${SOLD_TO}/${BRAND}/reorder?system=${SYSTEM}`,
      {
        method: 'POST',
        body: {
          searchTerm: batch.map((product) => product.sku).join(' '),
          page: 1,
          pageSize: 50,
          orderType: 'OR',
        },
      },
    );
    for (const raw of catalogProducts(payload)) {
      const product = normalizeCatalogProduct(raw);
      if (product.sku && wanted.has(product.sku)) bySku[product.sku] = product;
    }
    log(`Catalog lookup ${Math.min(index + 50, products.length)}/${products.length}`);
  }
  return bySku;
}

async function materials(page, sid, cartId, sku, requestedDeliveryDates = []) {
  return pageJson(
    page,
    sid,
    `${API_ROOT}/cart/${ACCOUNT_ID}/cart/${encodeURIComponent(cartId)}`
      + '/materials/information?meta=delivery%2Cproduct%2Citems&context=default',
    {
      method: 'POST',
      body: [{ materialNumber: sku, requestedDeliveryDates }],
    },
  );
}

async function upsertAndVerify(sku, rows) {
  const { error } = await supabase
    .from('adidas_inventory')
    .upsert(rows, { onConflict: 'sku,size' });
  if (error) throw new Error(`Inventory upsert failed for ${sku}: ${error.message}`);

  const expected = new Set(rows.map((row) => row.size));
  const { data, error: readError } = await supabase
    .from('adidas_inventory')
    .select('size,stock_qty,future_delivery_date,future_delivery_qty,source')
    .eq('sku', sku)
    .in('size', [...expected]);
  if (readError) throw new Error(`Inventory verification failed for ${sku}: ${readError.message}`);
  const landed = new Set((data || []).map((row) => row.size));
  const missing = [...expected].filter((size) => !landed.has(size));
  if (missing.length) throw new Error(`Database guard dropped ${sku} sizes: ${missing.join(', ')}`);
  return data || [];
}

async function main() {
  const products = await fetchAllProducts();
  if (!products.length) throw new Error('No matching active Adidas CLICK products found.');
  log(`Sync scope: ${products.length} SKU${products.length === 1 ? '' : 's'}`
    + (TARGET_SKUS.size ? ' (targeted)' : ' (full CLICK catalog)'));

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    userDataDir,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(60_000);

  const stats = { synced: 0, rows: 0, notFound: [], unmapped: [], failed: [] };
  try {
    let sid = await ensureAuthenticated(page);
    const carts = await fetchOpenCartIds(page, sid);
    if (!carts.length) throw new Error('No open CLICK carts found for the configured account.');
    const sizeMaps = await fetchSizeMaps();
    const catalog = await fetchCatalog(page, sid, products);
    let cartIndex = 0;

    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      const sku = String(product.sku).trim().toUpperCase();
      const catalogItem = catalog[sku];
      if (!catalogItem) {
        stats.notFound.push(sku);
        log(`${sku}: catalog did not return this SKU; skipped`);
        continue;
      }

      try {
        const cartId = carts[cartIndex++ % carts.length];
        let current;
        try {
          current = await materials(page, sid, cartId, sku);
        } catch (error) {
          if (error.code === 'CLICK_AUTH_EXPIRED') throw error;
          // The materials endpoint intermittently fails on a busy cart. Rotate once.
          const retryCart = carts[cartIndex++ % carts.length];
          current = await materials(page, sid, retryCart, sku);
        }

        let rawSizes = sizeObjectsFromMaterials(current);
        if (!rawSizes.length && catalogItem.codes.length) {
          current = [{
            item: { deliveryInformation: { sizeRun: catalogItem.codes } },
          }];
          rawSizes = sizeObjectsFromMaterials(current);
        }

        const restockDates = [...new Set(
          rawSizes
            .filter((size) => Number(size.inventory || 0) <= 0)
            .map((size) => String(size.restockDate || '').slice(0, 10))
            .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
        )];
        const projectedByDate = {};
        for (const date of restockDates) {
          const projection = await materials(page, sid, carts[cartIndex++ % carts.length], sku, [date]);
          projectedByDate[date] = projectedInventoryByCode(projection);
        }

        const built = buildInventoryRows({
          sku,
          payload: current,
          codeLabels: sizeMaps[catalogItem.conversionId] || {},
          catalogCodes: catalogItem.codes,
          availableSizes: product.available_sizes || [],
          projectedByDate,
        });
        if (built.unmappedCodes.length) {
          stats.unmapped.push({ sku, codes: built.unmappedCodes });
        }
        if (!built.rows.length) {
          throw new Error(`No safe size rows produced; unmapped codes: ${built.unmappedCodes.join(', ') || 'none'}`);
        }

        await upsertAndVerify(sku, built.rows);
        stats.synced += 1;
        stats.rows += built.rows.length;
        const dated = built.rows.filter((row) => row.future_delivery_date).length;
        log(`${sku}: wrote ${built.rows.length} sizes (${dated} with restock dates) `
          + `[${index + 1}/${products.length}]`);
      } catch (error) {
        if (error.code === 'CLICK_AUTH_EXPIRED') throw error;
        stats.failed.push({ sku, error: error.message });
        log(`${sku}: ERROR ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  log(`Complete: ${stats.synced}/${products.length} SKUs, ${stats.rows} rows, `
    + `${stats.notFound.length} not found, ${stats.unmapped.length} map gaps, `
    + `${stats.failed.length} failed`);
  if (stats.notFound.length) log(`Not found: ${stats.notFound.join(', ')}`);
  if (stats.unmapped.length) {
    log(`Unmapped: ${stats.unmapped.map((item) => `${item.sku}[${item.codes.join(',')}]`).join(' ')}`);
  }
  if (stats.failed.length) {
    log(`Failed: ${stats.failed.map((item) => `${item.sku}[${item.error}]`).join(' ')}`);
  }
  if (stats.failed.length || stats.unmapped.length) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[SYNC] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchAllProducts,
  main,
  upsertAndVerify,
};
