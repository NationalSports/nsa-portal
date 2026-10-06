const { dP, DEFAULTS } = require('../lib/decoPricing');
test('frozen name cost zero stays zero and absent ordinary name cost keeps its default', () => {
  const name = { kind: 'names', sell_override: 0, names: { M: ['STEVE'] } };
  expect(dP(DEFAULTS, { ...name, cost_each: 0 }, 1)).toMatchObject({ sell: 0, cost: 0, _nq: 1 });
  expect(dP(DEFAULTS, name, 1).cost).toBe(3);
});
test('custom DTF number cost is frozen and stocked digit roster does not add a second production cost', () => {
  const number = { kind: 'numbers', sell_override: 0, roster: { M: ['11', '12'] } };
  expect(dP(DEFAULTS, { ...number, num_method: 'dtf', cost_each: 2.75 }, 2)).toMatchObject({ sell: 0, cost: 2.75, _nq: 2 });
  expect(dP(DEFAULTS, { ...number, num_method: 'heat_press', cost_each: 0 }, 2)).toMatchObject({ sell: 0, cost: 0, _nq: 2 });
});


const fs = require('fs');
const path = require('path');
const BL = require('../businessLogic');
const safe = require('../safeHelpers');
const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const body = app.slice(app.indexOf('function dP(d,q,artFiles,cq){'), app.indexOf('// Module-scope helpers shared with pages'));
const deps = { ...BL, ...safe };
const appDP = new Function(...Object.keys(deps), body + ';return dP;')(...Object.values(deps));
test.each([['billing mirror', BL.dP], ['App billing', appDP]])('%s honors the same frozen personal print costs', (_, price) => {
  expect(price({kind:'names',names:{M:['STEVE']},cost_each:0,sell_override:0},1)).toMatchObject({cost:0,sell:0,_nq:1});
  expect(price({kind:'numbers',num_method:'dtf',roster:{M:['11','12']},cost_each:2.75,sell_override:0},2)).toMatchObject({cost:2.75,sell:0,_nq:2});
  expect(price({kind:'numbers',num_method:'heat_press',roster:{M:['11','12']},cost_each:0,sell_override:0},2)).toMatchObject({cost:0,sell:0,_nq:2});
});
