const { decoPoCost, decoPoExpectedCost } = require('../lib/decoPoCost');
const { calcTotals } = require('../businessLogic');
const { calcOrderMargin } = require('../pricing');
const { decoPoEditTotals } = require('../lib/decoPoEdit');

const rbv = { qty: 50, unit_cost: 861, expected_cost: 861, item_costs: { 1: 17.22 }, _bill_cost: 0, po_mode: 'dtf_purchase' };

test('SO-2222 uses the committed $861 total instead of multiplying a bad default rate', () => {
  const order = { items: [], deco_pos: [rbv, { qty: 165, unit_cost: 2.5, expected_cost: 412.5 }] };
  expect(decoPoExpectedCost(rbv)).toBe(861);
  expect(decoPoCost(rbv)).toBe(861);
  expect(calcTotals(order).cost).toBe(1273.5);
  expect(calcOrderMargin(order).cost).toBe(1273.5);
});

test('billed costs take precedence while an explicit zero expected total stays zero', () => {
  expect(decoPoCost({ ...rbv, _bill_cost: 900 })).toBe(900);
  expect(decoPoCost({ ...rbv, expected_cost: 0 })).toBe(0);
  expect(decoPoExpectedCost({ ...rbv, _bill_cost: 900 })).toBe(861);
});

test('legacy POs without an expected total retain quantity times unit rate', () => {
  for (const expected_cost of [undefined, null, NaN, Infinity]) {
    expect(decoPoCost({ qty: 10, unit_cost: 2.5, expected_cost })).toBe(25);
  }
  expect(decoPoCost(null)).toBe(0);
});

test('mixed per-item rates remain authoritative when the default unit rate is zero', () => {
  expect(decoPoCost({ qty: 100, unit_cost: 0, expected_cost: 350, item_costs: { 0: 2, 1: 5 } })).toBe(350);
});

test('a commission unit-rate correction updates expected cost before it is consumed', () => {
  const po = { qty: 165, unit_cost: 2.75, expected_cost: 453.75, po_mode: 'dtf_purchase' };
  const updated = { ...po, ...decoPoEditTotals(po, { ...po, unit_cost: 2.5 }, []) };
  expect(decoPoCost(updated)).toBe(412.5);
  const mixed = { qty: 100, unit_cost: 2, expected_cost: 350, item_idxs: [0, 1], item_costs: { 1: 5 } };
  const items = [{ sizes: { M: 50 } }, { sizes: { M: 50 } }];
  const mixedUpdated = { ...mixed, ...decoPoEditTotals(mixed, { ...mixed, unit_cost: 3 }, items) };
  expect(decoPoCost(mixedUpdated)).toBe(400);
});
