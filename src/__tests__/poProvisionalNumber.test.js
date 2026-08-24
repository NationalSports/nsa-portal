/* eslint-disable */
// The Create-PO form shows a PROVISIONAL number — drawn when the form opens, owned by nothing until
// Create is clicked, and after a create it shows the NEXT number rather than the PO just made. Reps
// copy that number into the vendor's own order site, so a form abandoned after a copy leaves the
// vendor billing a PO the portal never created.
//
// Real cases this guards (both Augusta/ASI, both left unapplied for weeks):
//   SO-1615  portal created PO 23800 JMHF  ·  Augusta invoiced PO 23801 JMHF  ($144.78)
//   SO-1664  portal created PO 26701 LAF   ·  Augusta invoiced PO 26702 LAF   ($432.86)
//
// poIdMissingFromOrder is the predicate behind the editors' on-close warning: given the order as it
// stands when the PO form closes, did the copied number ever become a PO?
import { poIdMissingFromOrder } from '../safeHelpers';

// SO-1615 as it actually was: the Momentec/Augusta PO landed as 23800 across four line items.
const so1615 = {
  id: 'SO-1615',
  items: [
    { sku: '412700', color: 'Black', po_lines: [{ po_id: 'PO 23800 JMHF', vendor: 'Momentec' }] },
    { sku: '412700', color: 'Royal', po_lines: [{ po_id: 'PO 23800 JMHF', vendor: 'Momentec' }] },
    { sku: '462100', color: 'Black', po_lines: [{ po_id: 'PO 23800 JMHF', vendor: 'Momentec' }] },
    { sku: '462100', color: 'White', po_lines: [{ po_id: 'PO 23800 JMHF', vendor: 'Momentec' }] },
  ],
  deco_pos: [],
};

test('the incident: a copied number one above the created PO is reported missing', () => {
  // What Augusta was given. Nothing on the order owns it.
  expect(poIdMissingFromOrder(so1615, 'PO 23801 JMHF')).toBe(true);
});

test('the number that really was created does not warn', () => {
  expect(poIdMissingFromOrder(so1615, 'PO 23800 JMHF')).toBe(false);
});

test('SO-1664 shape: 26702 copied while 26701 was created', () => {
  const so1664 = { id: 'SO-1664', items: [{ sku: 'X', po_lines: [{ po_id: 'PO 26701 LAF' }] }] };
  expect(poIdMissingFromOrder(so1664, 'PO 26702 LAF')).toBe(true);
  expect(poIdMissingFromOrder(so1664, 'PO 26701 LAF')).toBe(false);
});

test('a deco PO counts as created — DPO numbers live on the order, not on line items', () => {
  const o = { items: [], deco_pos: [{ po_id: 'DPO 23801 JMHF', vendor: 'Topstar' }] };
  expect(poIdMissingFromOrder(o, 'DPO 23801 JMHF')).toBe(false);
  expect(poIdMissingFromOrder(o, 'DPO 23802 JMHF')).toBe(true);
});

test('a batch-queued PO line counts as created', () => {
  // Add-to-Batch writes a real po_line with status 'queued' before the batch is submitted.
  const o = { items: [{ po_lines: [{ po_id: 'PO 25550 JMHF', status: 'queued' }] }] };
  expect(poIdMissingFromOrder(o, 'PO 25550 JMHF')).toBe(false);
});

test('blank / missing ids never warn', () => {
  expect(poIdMissingFromOrder(so1615, '')).toBe(false);
  expect(poIdMissingFromOrder(so1615, '   ')).toBe(false);
  expect(poIdMissingFromOrder(so1615, null)).toBe(false);
  expect(poIdMissingFromOrder(so1615, undefined)).toBe(false);
});

test('surrounding whitespace does not create a false alarm', () => {
  expect(poIdMissingFromOrder(so1615, '  PO 23800 JMHF  ')).toBe(false);
  const padded = { items: [{ po_lines: [{ po_id: ' PO 23800 JMHF ' }] }] };
  expect(poIdMissingFromOrder(padded, 'PO 23800 JMHF')).toBe(false);
});

test('matching is exact — a number that merely contains the copied one still warns', () => {
  // Guards against a substring match quietly excusing a genuinely missing PO.
  expect(poIdMissingFromOrder(so1615, 'PO 2380 JMHF')).toBe(true);
  expect(poIdMissingFromOrder(so1615, 'PO 23800')).toBe(true);
  expect(poIdMissingFromOrder(so1615, 'PO 23800 SANBA')).toBe(true);
});

test('malformed orders degrade to warning rather than crashing', () => {
  expect(poIdMissingFromOrder(null, 'PO 1 X')).toBe(true);
  expect(poIdMissingFromOrder({}, 'PO 1 X')).toBe(true);
  expect(poIdMissingFromOrder({ items: null, deco_pos: null }, 'PO 1 X')).toBe(true);
  expect(poIdMissingFromOrder({ items: [null, { po_lines: [null] }] }, 'PO 1 X')).toBe(true);
});
