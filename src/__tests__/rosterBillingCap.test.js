// Numbers/names bill one application per filled roster slot, capped at the line's garment count.
// SO-1253: a 3-pc promo line (M1/L2) carried a roster with 11 numbers — its own 3 plus leftovers
// in sizes the line doesn't have (S, XL) and extra L/M slots. The editor only renders the line's
// own 3 slots ("3/3 assigned"), but every dP copy counted all 11: $5 x 11 = $55 instead of $15.
const fs = require('fs');
const path = require('path');
const DP = require('../lib/decoPricing');
const BL = require('../businessLogic');
const T = DP.DEFAULTS;

// The saved SO-1253 line, verbatim.
const LINE_QTY = 3; // sizes { L: 2, M: 1 }
const staleRoster = { L: ['23', '6', '11', '33'], M: ['41', '12', '5'], S: ['0', '40'], XL: ['24', '32'] };
const spNumbers = { kind: 'numbers', num_method: 'screen_print', position: 'Left Sleeve', sell_override: 5, num_qty: 16, front_and_back: false, roster: staleRoster };

describe('rosterCount', () => {
  test('caps filled slots at the line garment count', () => {
    expect(DP.rosterCount(staleRoster, LINE_QTY)).toBe(3);
  });
  test('counts filled slots normally when they fit the line', () => {
    expect(DP.rosterCount({ M: ['41'], L: ['23', ''] }, 3)).toBe(2);
  });
  test('unknown line qty (0) leaves the count uncapped', () => {
    expect(DP.rosterCount(staleRoster, 0)).toBe(11);
  });
  test('empty / missing roster is 0', () => {
    expect(DP.rosterCount(null, 3)).toBe(0);
    expect(DP.rosterCount({}, 3)).toBe(0);
    expect(DP.rosterCount({ M: ['', '  '] }, 3)).toBe(0);
  });
});

describe('numbers deco bills at most one number per garment per side', () => {
  test('SO-1253 line: 3 numbers at $5 = $15, not 11', () => {
    const r = DP.dP(T, spNumbers, LINE_QTY, [], LINE_QTY);
    expect(r._nq).toBe(3);
    expect(r._nq * r.sell).toBe(15);
  });
  test('front + back still doubles the capped count', () => {
    expect(DP.dP(T, { ...spNumbers, front_and_back: true }, LINE_QTY, [], LINE_QTY)._nq).toBe(6);
  });
  test('reversible still doubles the capped count', () => {
    expect(DP.dP(T, { ...spNumbers, reversible: true }, LINE_QTY, [], LINE_QTY)._nq).toBe(6);
  });
  test('every numbers method is capped', () => {
    for (const num_method of ['heat_transfer', 'embroidery', 'tackle_twill', 'sublimated']) {
      expect(DP.dP(T, { ...spNumbers, num_method }, LINE_QTY, [], LINE_QTY)._nq).toBe(3);
    }
    expect(DP.dP(T, { ...spNumbers, num_method: 'dtf', cost_each: 1, sell_each: 2 }, LINE_QTY, [], LINE_QTY)._nq).toBe(3);
  });
  test('a fully assigned roster that fits the line is unchanged', () => {
    const r = DP.dP(T, { ...spNumbers, roster: { M: ['41'], L: ['23', '6'] } }, LINE_QTY, [], LINE_QTY);
    expect(r._nq).toBe(3);
  });
  test('businessLogic.js dP copy agrees', () => {
    expect(BL.dP(spNumbers, LINE_QTY, [], LINE_QTY)._nq).toBe(3);
  });
});

describe('names deco is capped the same way', () => {
  const names = { kind: 'names', sell_override: 6, names: { M: ['A', 'B', 'C'], L: ['D', 'E'], XL: ['F'] } };
  test('decoPricing.js', () => {
    expect(DP.dP(T, names, LINE_QTY, [], LINE_QTY)._nq).toBe(3);
  });
  test('businessLogic.js', () => {
    expect(BL.dP(names, LINE_QTY, [], LINE_QTY)._nq).toBe(3);
  });
});

test('App.js dP copy counts rosters/names through rosterCount (no raw uncapped count left)', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  const body = appSrc.slice(appSrc.indexOf('function dP(d,q,artFiles,cq){'), appSrc.indexOf('export { dP,'));
  expect(body).toContain('rosterCount(d.roster,q)');
  expect(body).toContain('rosterCount(d.names,q)');
  expect(body).not.toMatch(/Object\.values\(d\.(roster|names)\)\.flat\(\)/);
});
