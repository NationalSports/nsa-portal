import {
  AGRON_CART_TASK_TYPE,
  AGRON_VENDOR_ID,
  buildAgronCartTask,
  isAgronVendor,
} from '../lib/agronCartPlan';
import { botTargetForVendor, buildBotCartPayload } from '../lib/botTasks';

const sourcePayload = buildBotCartPayload({
  poNumber: 'PO 4021',
  vendorName: 'Agron',
  batches: [{
    id: 'BPO 1',
    po_id: 'PO 4021',
    so_id: 'SO-88',
    items: [{
      sku: '5155948D',
      qty: 3,
      sizes: { OSFA: 1, L: 2 },
      unit_cost: 12.5,
      item_idx: 4,
    }],
  }],
  soId: 'SO-88',
});

const poLines = {
  itemRows: [{ id: 900, so_id: 'SO-88', item_index: 4 }],
  poRows: [{
    id: 12345,
    so_item_id: 900,
    po_id: 'PO 4021',
    vendor: AGRON_VENDOR_ID,
    sizes: { batch_queue_id: 'BPO 1' },
    expected_date: '2026-11-01',
  }],
};

test('routes Agron from the PO vendor name or id, never an inventory source tag', () => {
  expect(isAgronVendor('Agron')).toBe(true);
  expect(isAgronVendor(AGRON_VENDOR_ID)).toBe(true);
  expect(isAgronVendor('Adidas')).toBe(false);
  expect(botTargetForVendor('Agron')).toBe('agron');
  expect(botTargetForVendor(AGRON_VENDOR_ID)).toBe('agron');

  const adidasPo = buildBotCartPayload({
    poNumber: 'PO2',
    vendorName: 'Adidas',
    batches: [{ items: [{ sku: 'A1', qty: 1, sizes: { S: 1 }, inventory_source: 'agron' }] }],
  });
  expect(adidasPo.bot_payload.target).toBe('adidas_click');
});

test('creates deterministic Agron rows and keeps a missing UPC row', () => {
  const payload = buildAgronCartTask({
    sourcePayload: sourcePayload.bot_payload,
    poLines,
    inventoryRows: [{
      sku: '5155948D',
      size: 'L',
      upc: '012345678905',
      product_number: '5155948',
      color_code: '5155948D',
    }],
  });

  expect(payload).toMatchObject({
    task_type: AGRON_CART_TASK_TYPE,
    vendor: 'agron',
    contract_version: 1,
    customer_po: 'PO 4021',
    ship_to: { type: 'default', address: null },
    arrive_on: '2026-11-01',
  });
  expect(payload.plan.rows).toEqual([
    {
      sku: '5155948D', size: 'OSFA', upc: null, product_number: null,
      color_code: null, qty: 1, unit_cost: 12.5, so_id: 'SO-88', po_line_id: 12345,
    },
    {
      sku: '5155948D', size: 'L', upc: '012345678905', product_number: '5155948',
      color_code: '5155948D', qty: 2, unit_cost: 12.5, so_id: 'SO-88', po_line_id: 12345,
    },
  ]);
  expect(payload.issues).toContainEqual(expect.objectContaining({
    code: 'upc_missing', sku: '5155948D', size: 'OSFA', po_line_id: 12345,
  }));
  expect(payload.lines[0]).toMatchObject({
    source_batch_id: 'BPO 1',
    source_po_id: 'PO 4021',
    po_line_id: 12345,
    po_vendor: AGRON_VENDOR_ID,
  });
});

test('uses the existing decorator/drop-ship address and flags a PO vendor mismatch', () => {
  const payload = buildAgronCartTask({
    sourcePayload: {
      ...sourcePayload.bot_payload,
      drop_ship: true,
      ship_to: { name: 'Decorator', attention: 'DPO 99', line1: '1 Main', city: 'Orange', state: 'CA', zip: '92865' },
    },
    poLines: {
      ...poLines,
      poRows: [{ ...poLines.poRows[0], vendor: 'Adidas' }],
    },
    inventoryRows: [],
  });

  expect(payload.ship_to).toEqual({
    type: 'drop_ship',
    address: expect.objectContaining({ name: 'Decorator', attention: 'DPO 99', line1: '1 Main' }),
  });
  expect(payload.issues).toContainEqual(expect.objectContaining({ code: 'po_vendor_mismatch' }));
});

test('blocks ambiguous PO row identity instead of choosing the first match', () => {
  const duplicateRows = poLines.poRows.map((row) => ({ ...row, sizes: {} }));
  duplicateRows.push({ ...duplicateRows[0], id: 12346 });
  const payload = buildAgronCartTask({
    sourcePayload: sourcePayload.bot_payload,
    poLines: { ...poLines, poRows: duplicateRows },
    inventoryRows: [],
  });

  expect(payload.plan.rows.every((row) => row.po_line_id == null)).toBe(true);
  expect(payload.issues).toContainEqual(expect.objectContaining({ code: 'po_line_ambiguous' }));
});
