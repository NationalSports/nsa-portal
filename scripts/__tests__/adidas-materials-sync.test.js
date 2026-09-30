'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInventoryRows,
  normalizeCatalogProduct,
  projectedInventoryByCode,
  sizeObjectsFromMaterials,
} = require('../lib/adidas-materials-sync');

test('writes zero-stock sizes with restock dates and projected future quantity', () => {
  const payload = [{
    item: {
      days: [{
        '2026-07-26': {
          sizes: {
            100: { inventory: 0, restockDate: '2026-08-14T00:00:00Z' },
            110: { inventory: 0, restockDate: '2026-08-14' },
          },
        },
      }],
    },
  }];

  const result = buildInventoryRows({
    sku: 'KD5431',
    payload,
    codeLabels: { 100: 'S', 110: 'M' },
    projectedByDate: {
      '2026-08-14': { 100: 42, 110: 18 },
    },
    syncedAt: '2026-07-26T18:00:00.000Z',
  });

  assert.deepEqual(result.unmappedCodes, []);
  assert.deepEqual(result.rows, [
    {
      id: 'KD5431-S',
      sku: 'KD5431',
      size: 'S',
      stock_qty: 0,
      future_delivery_date: '2026-08-14',
      future_delivery_qty: 42,
      last_synced: '2026-07-26T18:00:00.000Z',
      source: 'api-materials',
    },
    {
      id: 'KD5431-M',
      sku: 'KD5431',
      size: 'M',
      stock_qty: 0,
      future_delivery_date: '2026-08-14',
      future_delivery_qty: 18,
      last_synced: '2026-07-26T18:00:00.000Z',
      source: 'api-materials',
    },
  ]);
});

test('writes sold-out sizeRun rows even when CLICK returns no current sizes', () => {
  const payload = [{
    item: {
      days: [{ '2026-07-26': { sizes: {} } }],
      deliveryInformation: { sizeRun: ['100', '110', '120'] },
    },
  }];

  assert.deepEqual(sizeObjectsFromMaterials(payload), [
    { code: '100', inventory: 0, restockDate: null },
    { code: '110', inventory: 0, restockDate: null },
    { code: '120', inventory: 0, restockDate: null },
  ]);

  const result = buildInventoryRows({
    sku: 'KD5434',
    payload,
    catalogCodes: ['100', '110', '120'],
    availableSizes: ['S', 'M', 'L'],
  });

  assert.deepEqual(result.rows.map((row) => ({
    size: row.size,
    stock: row.stock_qty,
    date: row.future_delivery_date,
  })), [
    { size: 'S', stock: 0, date: null },
    { size: 'M', stock: 0, date: null },
    { size: 'L', stock: 0, date: null },
  ]);
});

test('fails closed instead of writing unmapped three-digit apparel codes', () => {
  const result = buildInventoryRows({
    sku: 'KD5431',
    payload: [{
      item: {
        days: [{
          '2026-07-26': {
            sizes: { 440: { inventory: 0, restockDate: '2026-08-28' } },
          },
        }],
      },
    }],
  });

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.unmappedCodes, ['440']);
});

test('normalizes CLICK catalog metadata needed by the materials mapper', () => {
  assert.deepEqual(normalizeCatalogProduct({
    articleNumber: 'kd5431',
    conversionId: 912,
    sizes: [{ code: 100 }, { sizeCode: 110 }],
    soldOut: true,
  }), {
    sku: 'KD5431',
    conversionId: '912',
    codes: ['100', '110'],
    soldOut: true,
  });
});

test('does not turn CLICK projected-quantity sentinel into a real quantity', () => {
  const payload = [{
    item: {
      days: [{
        '2026-08-14': {
          sizes: { 100: { inventory: 9_999_999 } },
        },
      }],
    },
  }];
  const projected = projectedInventoryByCode(payload);
  const result = buildInventoryRows({
    sku: 'KD5431',
    payload: [{
      item: {
        days: [{
          '2026-07-26': {
            sizes: { 100: { inventory: 0, restockDate: '2026-08-14' } },
          },
        }],
      },
    }],
    codeLabels: { 100: 'S' },
    projectedByDate: { '2026-08-14': projected },
  });

  assert.equal(projected['100'], 9_999_999);
  assert.equal(result.rows[0].future_delivery_qty, null);
});
