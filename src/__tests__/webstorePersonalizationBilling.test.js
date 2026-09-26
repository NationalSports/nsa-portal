const fs = require('fs');
const path = require('path');
const { _decoCols } = require('../constants');
const pricing = require('../lib/decoPricing');

test.each(['names', 'numbers'])('%s included in checkout stays zero after persistence', kind => {
  const source = fs.readFileSync(path.join(__dirname, '../Webstores.js'), 'utf8');
  const creationLine = source.split('\n').find(line => line.includes(`decorations.push({ kind: '${kind}'`));
  expect(creationLine).toContain('sell_override: 0');
  const deco = { kind, sell_override: 0, sell_suppressed: true, sell_each: 6,
    cost_each: 3, names: { M: ['Smith', 'Jones'] }, roster: { M: ['1', '2'] } };
  const saved = JSON.parse(JSON.stringify(Object.fromEntries(
    Object.entries(deco).filter(([key]) => _decoCols.includes(key))
  )));
  expect(saved.sell_suppressed).toBeUndefined();
  const result = pricing.dP(pricing.DEFAULTS, saved, 2);
  expect(result.sell).toBe(0);
  expect(result.cost).toBeGreaterThan(0);
  expect(result._nq).toBe(2);
  // Ordinary separately billed personalization must retain its charge.
  expect(pricing.dP(pricing.DEFAULTS, { ...saved, sell_override: null }, 2).sell).toBeGreaterThan(0);
});
