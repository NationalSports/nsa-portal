#!/usr/bin/env node
/**
 * Agron FW26 SKU loader.
 *
 * Reads data/agron-import.csv (produced by scripts/convert-agron-csv.js) and
 * upserts the rows into Supabase `products`, linking each row to the Agron
 * vendor (looked up by name; created automatically if missing).
 *
 * Idempotent: uses upsert with onConflict:'sku' so re-runs only patch
 * changed rows.
 *
 * Usage:
 *   SUPABASE_URL=https://<proj>.supabase.co \
 *   SUPABASE_ANON_KEY=<anon-or-service-key> \
 *   node scripts/import-agron-skus.js
 *
 *   # Preview only — no DB writes:
 *   DRY_RUN=true node scripts/import-agron-skus.js
 *
 * Notes:
 *   - The `products` upsert needs INSERT/UPDATE rights on the products table.
 *     RLS in supabase/migrations/00007 grants admins full access; pass an
 *     admin user's session key, the service role key, or run with the anon
 *     key after temporarily disabling RLS for the import session.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const CSV_PATH = path.resolve(__dirname, '..', 'data', 'agron-import.csv');
const VENDOR_NAME = 'Agron';
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100;

const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[AGRON] Missing SUPABASE_URL or SUPABASE_*_KEY env var');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// Parse one CSV row (handles quoted fields with embedded commas).
const parseRow = (line) => {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
};

const readCsv = (file) => {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  const header = parseRow(lines.shift()).map((h) => h.trim());
  return lines.map((line) => {
    const cells = parseRow(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
};

const ensureVendor = async () => {
  const { data: existing, error: lookupErr } = await supabase
    .from('vendors')
    .select('id, name')
    .ilike('name', VENDOR_NAME)
    .limit(1);
  if (lookupErr) throw new Error('vendor lookup: ' + lookupErr.message);
  if (existing && existing.length) {
    console.log(`[AGRON] Vendor "${existing[0].name}" found: ${existing[0].id}`);
    return existing[0].id;
  }
  if (DRY_RUN) {
    console.log('[AGRON] (dry-run) would create vendor "Agron"');
    return 'dry-run-vendor-id';
  }
  const id = 'v-agron-' + Date.now();
  const { error: insErr } = await supabase
    .from('vendors')
    .insert({
      id,
      name: VENDOR_NAME,
      vendor_type: 'upload',
      payment_terms: 'net30',
      is_active: true,
    });
  if (insErr) throw new Error('vendor create: ' + insErr.message);
  console.log(`[AGRON] Created vendor "${VENDOR_NAME}": ${id}`);
  return id;
};

const toProductRow = (r, vendorId) => ({
  sku: r.sku,
  name: r.name,
  brand: r.brand || 'Adidas',
  color: r.color || null,
  category: r.category || null,
  retail_price: parseFloat(r.retail_price) || null,
  nsa_cost: parseFloat(r.nsa_cost) || null,
  available_sizes: r.available_sizes ? r.available_sizes.split(',').map((s) => s.trim()).filter(Boolean) : null,
  vendor_id: vendorId,
  is_active: true,
});

(async () => {
  console.log(`[AGRON] CSV: ${CSV_PATH}`);
  console.log(`[AGRON] DRY_RUN=${DRY_RUN}`);
  const rows = readCsv(CSV_PATH);
  console.log(`[AGRON] Parsed ${rows.length} rows`);

  const vendorId = await ensureVendor();
  const products = rows.map((r) => toProductRow(r, vendorId));

  if (DRY_RUN) {
    console.log('[AGRON] (dry-run) sample row:', products[0]);
    console.log(`[AGRON] (dry-run) would upsert ${products.length} products`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'sku' });
    if (error) {
      console.error(`[AGRON] batch ${i}-${i + batch.length} failed:`, error.message);
      fail += batch.length;
    } else {
      ok += batch.length;
      console.log(`[AGRON] upserted ${ok}/${products.length}`);
    }
  }
  console.log(`[AGRON] Done. ${ok} upserted, ${fail} failed.`);
})().catch((e) => {
  console.error('[AGRON] FATAL:', e.message);
  process.exit(1);
});
