const { garmentCost } = require('../businessLogic');
const { inventoryCostIssues, inventoryPickCosts, applyInventoryPullCosts } = require('../lib/inventoryCosts');
const pick = (qty, unit_cost, size = 'M') => ({ pick_id: 'IF-1', status: 'pulled', [size]: qty, _inventory_costs: { [size]: { qty, unit_cost, receipt_ids: ['receipt-1'] } } });
test('two garments consume only their two units of a 100-unit inventory PO', () => {
 const item = { sizes: { M: 2 }, nsa_cost: 20, pick_lines: [pick(2, 3)] };
 expect(garmentCost(item).cost).toBe(6);
 expect(inventoryPickCosts(item).receipts).toEqual(['receipt-1']);
});
test('mixed order PO and warehouse stock are counted once', () => {
 const item = { sizes: { M: 10 }, nsa_cost: 20, po_lines: [{ M: 6, unit_cost: 10 }], pick_lines: [pick(4, 3)] };
 expect(garmentCost(item).cost).toBe(72);
});
test('stock costs never replace costs already covered by an order PO', () => {
 const item = { sizes: { M: 2 }, nsa_cost: 20, po_lines: [{ M: 2, unit_cost: 10 }], pick_lines: [pick(2, 3)] };
 expect(garmentCost(item).cost).toBe(20);
});
test('unpulled stock stays estimated; explicit zero is valid; unknown cost stays flagged', () => {
 expect(garmentCost({ sizes: { M: 2 }, nsa_cost: 20, pick_lines: [{ ...pick(2, 3), status: 'pick' }] }).cost).toBe(40);
 expect(garmentCost({ sizes: { M: 2 }, nsa_cost: 20, pick_lines: [pick(2, 0)] }).cost).toBe(0);
 const item = { sku: 'HOOD', sizes: { M: 2 }, nsa_cost: 20, pick_lines: [pick(2, null)], decorations: [{ transfer_code: 'LOGO', inventory_cost_missing: true }] };
 expect(garmentCost(item).cost).toBe(40);
 expect(inventoryCostIssues({ items: [item] })).toHaveLength(2);
});
test('duplicate hydrated pick rows do not double count', () => {
 expect(garmentCost({ sizes: { M: 4 }, nsa_cost: 20, pick_lines: [pick(2, 3), pick(2, 3)] }).cost).toBe(46);
});
test('logo variants on the same blank keep separate pick costs', () => {
 const items = ['a','b'].map(id => ({ product_id: 'P', source_webstore_item_ids: [id], pick_lines: [{ pick_id: 'IF-1', status: 'pulled', M: 2 }] }));
 applyInventoryPullCosts(items, { rows: [{ product_id: 'P', size: 'M', pick_id: 'IF-1', source_item_ids: ['b'], inventory_cost: { qty: 2, unit_cost: 3 } }] });
 expect(items[0].pick_lines[0]._inventory_costs).toBeUndefined();
 expect(items[1].pick_lines[0]._inventory_costs.M.unit_cost).toBe(3);
});
