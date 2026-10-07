const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairPlan, effectiveCost } = require('../scripts/prepare-vendor-base-cost-repair.cjs');
test('repairs inflated base while retaining implicit larger-size cost', () => {
  const row = { id: 'test', nsa_cost: 15.31, available_sizes: ['S', 'XL', '2XL', '3XL', '4XL'], size_costs: { S: 12.31, XL: 12.31, XXL: 13.31, '4XL': 16.31 } };
  const plan = repairPlan(row);
  assert.equal(plan.new_cost, 12.31);
  assert.equal(plan.new_size_costs['3XL'], 15.31);
  assert.equal(plan.new_size_costs['2XL'], 13.31);
  for (const size of row.available_sizes) assert.equal(effectiveCost(row, size), effectiveCost({ nsa_cost: plan.new_cost, size_costs: plan.new_size_costs }, size));
});
test('repairs one-size base and rejects ambiguous aliases', () => {
  assert.equal(repairPlan({ id: 'one', nsa_cost: 5.19, size_costs: { OS: 3.74 }, available_sizes: ['OS'] }).new_size_costs, null);
  assert.throws(() => repairPlan({ id: 'bad', nsa_cost: 15, size_costs: { '2XL': 12, XXL: 13 }, available_sizes: ['2XL'] }), /Conflicting/);
});
