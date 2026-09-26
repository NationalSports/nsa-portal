const { applyRoutingOverrides } = require('../../netlify/functions/_emailRoutingOverrides');
const { buildEmailBlockRegistry, checkEmailRecipients } = require('../lib/emailRouting');
const base = () => buildEmailBlockRegistry([[{ sent_history: [
  { delivery: 'failed', delivery_to: 'coach@district.edu', delivery_event: 'blocked' },
  { delivery: 'failed', delivery_to: 'optout@district.edu', delivery_event: 'spam' },
] }]]);
const override = (target, route = 'gmail') => ({ target, route, reason: 'District IT confirmed sender block', reviewUntil: '2026-10-30' });
test('explicit address review enables Gmail without overriding opt-outs', () => {
  const reg = applyRoutingOverrides(base(), JSON.stringify([override('coach@district.edu'), override('optout@district.edu')]), Date.parse('2026-09-26'));
  expect(checkEmailRecipients(['coach@district.edu'], reg).gmail).toEqual(['coach@district.edu']);
  expect(checkEmailRecipients(['optout@district.edu'], reg).suppressed).toEqual(['optout@district.edu']);
});
test('expired exceptions no longer affect routing; malformed configuration fails closed', () => {
  const reg = applyRoutingOverrides(base(), JSON.stringify([override('coach@district.edu')]), Date.parse('2026-11-01'));
  expect(checkEmailRecipients(['coach@district.edu'], reg).review).toEqual(['coach@district.edu']);
  expect(() => applyRoutingOverrides(base(), '[{"target":"x"}]')).toThrow();
});
