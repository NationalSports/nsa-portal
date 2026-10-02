const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { isAllSchoolRecipeOrder } = require('../lib/allSchoolJobs');
const { buildJobs } = require('../businessLogic');
const { _pickSoItem, _itemCols, _soItemCols } = require('../constants');
const recipe = { webstore_product_id: 'school-soccer', transfer_codes: ['SOCCER'] };
const item = { sku: 'PC61', sizes: { M: 1 }, recipe_snapshot: recipe, source_webstore_item_ids: ['paid-line-1'], decorations: [{ kind: 'art', position: 'Front', type: 'dtf' }] };

test('paid recipe jobs retain distinct sport identity despite identical blank and placement', () => {
  const jobs = [{ id: 'soccer-job', key: 'soccer@Front', art_status: 'art_complete', prod_status: 'hold' }, { id: 'baseball-job', key: 'baseball@Front', art_status: 'needs_art', prod_status: 'hold' }];
  const order = { items: [item, { ...item, recipe_snapshot: { ...recipe, webstore_product_id: 'school-baseball' } }], jobs };
  expect(isAllSchoolRecipeOrder(order)).toBe(true);
  expect(buildJobs(order)).toBe(jobs);
  jobs[0].prod_status = 'staging';
  expect(buildJobs(order)[0].prod_status).toBe('staging');
});

test('missing source jobs never derive guessed shared-art production jobs', () => {
  expect(buildJobs({ items: [item], jobs: [] })).toEqual([]);
});

test('ordinary orders retain their job derivation and invalid snapshots do not freeze them', () => {
  const ordinary = { id: 'SO-1', items: [{ ...item, recipe_snapshot: null }], jobs: [] };
  expect(isAllSchoolRecipeOrder(ordinary)).toBe(false);
  expect(buildJobs(ordinary)).toHaveLength(1);
  expect(isAllSchoolRecipeOrder({ items: [{ recipe_snapshot: {} }] })).toBe(false);
});

test('the persisted SO projection carries the source recipe and paid line links, estimates stay unchanged', () => {
  expect(_pickSoItem(item)).toMatchObject({ recipe_snapshot: recipe, source_webstore_item_ids: ['paid-line-1'] });
  expect(_soItemCols).toContain('recipe_snapshot');
  expect(_itemCols).not.toContain('recipe_snapshot');
});

function syncGuard(file) {
  const ast = parser.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  let guard;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'syncJobs') guard = node.init.arguments[0].body.body[0];
    Object.values(node).forEach(value => { if (Array.isArray(value)) value.forEach(walk); else if (value?.type) walk(value); });
  };
  walk(ast);
  return { type: guard.type, callee: guard.test.callee.name, argument: guard.test.arguments[0].name, result: guard.consequent.argument.callee.name };
}
test('both active editors apply the same recipe guard before any job regrouping', () => {
  const expected = { type: 'IfStatement', callee: 'isAllSchoolRecipeOrder', argument: 'o', result: 'safeJobs' };
  expect(syncGuard('OrderEditor.js')).toEqual(expected);
  expect(syncGuard('OrderEditorClassic.js')).toEqual(expected);
});
