#!/usr/bin/env node
/**
 * Convert raw Agron product sheet (data/agron-skus-fw26.csv) into the
 * portal's bulk-import format (sku,name,brand,color,category,retail_price,
 * nsa_cost,available_sizes,vendor_name). Output: data/agron-import.csv
 *
 * Pricing: NSA Cost = MSRP × 50% × 75% = MSRP × 0.375 (matches Adidas Cowork
 * pattern in scripts/adidas-cowork-discover.js). Override with COST_MULT env.
 *
 * Usage: node scripts/convert-agron-csv.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'data', 'agron-skus-fw26.csv');
const OUT = path.resolve(__dirname, '..', 'data', 'agron-import.csv');
const COST_MULT = parseFloat(process.env.COST_MULT || '0.375');

const CATEGORY_MAP = {
  'Bags': 'Bags',
  'Hats': 'Hats',
  'Socks': 'Socks',
  'Socks-Team': 'Socks',
  'Sport Acc': 'Sport Accessories',
  'Underwear': 'Underwear',
};

const csvEscape = (s) => {
  const v = (s == null ? '' : String(s));
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const parsePrice = (s) => {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const cleanName = (raw) => {
  // Drop accidental "Adidas Adidas " duplication and trim.
  return (raw || '').replace(/\bAdidas\s+Adidas\b/gi, 'Adidas').trim();
};

const lines = fs.readFileSync(SRC, 'utf-8').split(/\r?\n/).filter(Boolean);
const header = lines.shift();
const cols = header.split(',');
const idx = (label) => cols.findIndex((c) => c.trim().toLowerCase() === label.toLowerCase());
const I = {
  product: idx('Product'),
  name: idx('Name'),
  color: idx('Color'),
  size: idx('Size'),
  article: idx('Article #'),
  msrp: idx('FW26 MSRP'),
  avail: idx('Availability'),
};

const out = ['sku,name,brand,color,category,retail_price,nsa_cost,available_sizes,vendor_name'];
let written = 0, skipped = 0;
for (const line of lines) {
  const f = line.split(',');
  const sku = (f[I.article] || '').trim();
  const name = cleanName(f[I.name]);
  if (!sku || !name) { skipped++; continue; }
  const color = (f[I.color] || '').trim();
  const size = (f[I.size] || '').trim();
  const cat = CATEGORY_MAP[(f[I.product] || '').trim()] || (f[I.product] || '').trim();
  const retail = parsePrice(f[I.msrp]);
  const cost = retail ? Math.round(retail * COST_MULT * 100) / 100 : 0;
  out.push([
    sku, name, 'Adidas', color, cat,
    retail.toFixed(2), cost.toFixed(2), size, 'Agron',
  ].map(csvEscape).join(','));
  written++;
}

fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`Wrote ${written} rows to ${OUT} (skipped ${skipped})`);
console.log(`Cost multiplier: ${COST_MULT} (override with COST_MULT=...)`);
