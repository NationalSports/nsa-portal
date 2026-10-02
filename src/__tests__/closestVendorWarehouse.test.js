import { planSSWarehouses } from '../lib/ssWarehouseRouting';
import { shipToCoords, warehouseCoords, milesBetween, rankWarehouses, pickConsolidatedWarehouse } from '../WarehouseChips';

const ship = { region: 'CA', postalCode: '91911' };
const lines = [{ sku: 'S', quantity: 10 }, { sku: 'M', quantity: 19 }];
const stock = { S: [{ abbr: 'NV', qty: 20 }, { abbr: 'CN', qty: 40 }, { abbr: 'KS', qty: 1000 }], M: [{ abbr: 'NV', qty: 30 }, { abbr: 'CN', qty: 19 }, { abbr: 'KS', qty: 1000 }] };

test('Reno covers the whole PO if Fresno is short, without adding transit days', () => {
  const s = { ...stock, M: stock.M.map(w => w.abbr === 'CN' ? { ...w, qty: 18 } : w) };
  const plan = planSSWarehouses(lines, s, { NV: 1, CN: 1, KS: 3 }, ship);
  expect(plan.warehouse).toBe('NV');
  expect(planSSWarehouses(lines, s, {}, ship).warehouse).toBe('NV');
  expect(Object.values(plan.expectedBySku).map(rows => rows[0].label)).toEqual(['NV', 'NV']);
});

test('does not force a slower consolidated warehouse when the closest warehouses need to split', () => {
  const s = { ...stock, M: stock.M.map(w => ['NV', 'CN'].includes(w.abbr) ? { ...w, qty: 0 } : w) };
  const plan = planSSWarehouses(lines, s, { NV: 1, CN: 1, KS: 3 }, ship);
  expect(plan.warehouse).toBe('');
  expect(plan.expectedBySku.S[0].label).toBe('CN');
  expect(plan.expectedBySku.M[0].label).toBe('KS');
});

test('checks summed demand when two SOs need the same SKU', () => {
  const plan = planSSWarehouses([{ sku: 'S', quantity: 25 }, { sku: 'S', quantity: 25 }], stock, { NV: 1, CN: 1, KS: 3 }, ship);
  expect(plan.warehouse).toBe('KS');
});

test('missing stock never restricts the order', () => {
  expect(planSSWarehouses(lines, { S: stock.S }, { NV: 1, CN: 1 }, ship).warehouse).toBe('');
});

test('ZIP coordinates distinguish Southern California from the state midpoint for SanMar', () => {
  const coords = shipToCoords(ship);
  const reno = milesBetween(coords, warehouseCoords('Reno', 4));
  const phoenix = milesBetween(coords, warehouseCoords('Phoenix', 12));
  expect(phoenix).toBeLessThan(reno);
  expect(pickConsolidatedWarehouse([{ need: 10, rows: [
    { label: 'Reno', qty: 1000, dist: reno },
    { label: 'Phoenix', qty: 10, dist: phoenix },
  ] }])).toBe('PHOENIX');
});

test('uses the next closest SanMar warehouse when the closest is short', () => {
  const rows = [{ label: 'Phoenix', qty: 5, dist: 300 }, { label: 'Reno', qty: 40, dist: 500 }, { label: 'Dallas', qty: 20000, dist: 1000 }];
  expect(rankWarehouses(rows, 20).find(r => r.primary).label).toBe('Reno');
});

test('ZIP changes re-rank the warehouse; non-US destinations do not use US coordinates', () => {
  expect(planSSWarehouses(lines, stock, {}, { region: 'KS', postalCode: '66061' }).warehouse).toBe('KS');
  expect(shipToCoords({ country: 'CA', region: 'CA', postalCode: '91911' })).toBeNull();
  expect(shipToCoords({ region: 'CA' })).toEqual([37.2, -119.3]);
});
