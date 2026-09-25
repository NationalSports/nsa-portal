import { buildEmailBlockRegistry, checkEmailRecipients, isDeadMailboxReason, setEmailBlockRegistry, blockedDomainOf } from '../lib/emailRouting';

// Shapes taken from real sent_history entries the Brevo delivery poller wrote.
const docs = [[
  { id: 'INV-63858', sent_history: [{ sent_at: '2026-09-04', delivery: 'failed', delivery_event: 'hardBounces', delivery_to: 'mar.abencerraje@sweetwaterschools.org', delivery_reason: '550 permanent failure for one or more recipients (mar.abencerraje@sweetwaterschools.org:blocked)' }] },
  { id: 'INV-1055', sent_history: [{ sent_at: '2026-09-15', delivery: 'failed', delivery_event: 'blocked', delivery_to: 'emmerson_f@auhsd.us', delivery_reason: null }] },
  { id: 'EST-2020', sent_history: [{ sent_at: '2026-08-12', delivery: 'failed', delivery_event: 'hardBounces', delivery_to: 'h.arias@ruesd.net', delivery_reason: "550-5.1.1 The email account that you tried to reach does not exist." }] },
  { id: 'EST-9', sent_history: [{ sent_at: '2026-08-01', delivery: 'failed', delivery_event: 'blocked', delivery_to: 'coach@gmail.com' }] },
]];

test('a district block covers the whole school domain', () => {
  const reg = buildEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['Julia.Rios@sweetwaterschools.org'], reg)).toEqual({ gmail: ['julia.rios@sweetwaterschools.org'], dead: [] });
  expect(checkEmailRecipients([{ email: 'someone@auhsd.us' }], reg).gmail).toEqual(['someone@auhsd.us']);
});

test('a mailbox that does not exist is dead, not a domain block', () => {
  const reg = buildEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['h.arias@ruesd.net', 'other@ruesd.net'], reg)).toEqual({ gmail: [], dead: ['h.arias@ruesd.net'] });
  expect(isDeadMailboxReason('550 permanent failure (x:blocked)')).toBe(false);
});

test('consumer domains are only blocked per address', () => {
  const reg = buildEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['coach@gmail.com', 'parent@gmail.com'], reg).gmail).toEqual(['coach@gmail.com']);
});

test('a later open clears a dead-address mark', () => {
  const reg = buildEmailBlockRegistry([[...docs[0], { id: 'EST-3', sent_history: [{ sent_at: '2026-09-01', delivery: 'opened', delivery_at: '2026-09-01', delivery_to: 'h.arias@ruesd.net' }] }]]);
  expect(checkEmailRecipients(['h.arias@ruesd.net'], reg).dead).toEqual([]);
});

test('unrelated recipients are untouched; live registry works', () => {
  setEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['ad@lincolnhs.org'])).toEqual({ gmail: [], dead: [] });
  expect(['x@sangerusd.net', 'y@sweetwaterschools.org'].map((e) => blockedDomainOf(e))).toEqual(['', 'sweetwaterschools.org']);
  setEmailBlockRegistry([]);
});
