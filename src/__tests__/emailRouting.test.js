import { buildEmailBlockRegistry, checkEmailRecipients, isDeadMailboxReason, setEmailBlockRegistry, blockedDomainOf } from '../lib/emailRouting';

// Shapes taken from real sent_history entries the Brevo delivery poller wrote.
const docs = [[
  { id: 'INV-63858', sent_history: [{ sent_at: '2026-09-04', delivery: 'failed', delivery_event: 'hardBounces', delivery_to: 'mar.abencerraje@sweetwaterschools.org', delivery_reason: '550 permanent failure for one or more recipients (mar.abencerraje@sweetwaterschools.org:blocked)' }] },
  { id: 'INV-1055', sent_history: [{ sent_at: '2026-09-15', delivery: 'failed', delivery_event: 'blocked', delivery_to: 'emmerson_f@auhsd.us', delivery_reason: null }] },
  { id: 'EST-2020', sent_history: [{ sent_at: '2026-08-12', delivery: 'failed', delivery_event: 'hardBounces', delivery_to: 'h.arias@ruesd.net', delivery_reason: "550-5.1.1 The email account that you tried to reach does not exist." }] },
  { id: 'EST-9', sent_history: [{ sent_at: '2026-08-01', delivery: 'failed', delivery_event: 'blocked', delivery_to: 'coach@gmail.com', delivery_reason: 'sender blocked' }] },
]];

test('a district block covers the whole school domain', () => {
  const reg = buildEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['Julia.Rios@sweetwaterschools.org'], reg)).toEqual({ gmail: ['julia.rios@sweetwaterschools.org'], dead: [], suppressed: [], review: [] });
  expect(checkEmailRecipients([{ email: 'someone@auhsd.us' }], reg).gmail).toEqual([]);
  expect(checkEmailRecipients(['emmerson_f@auhsd.us'], reg).review).toEqual(['emmerson_f@auhsd.us']);
});

test('a mailbox that does not exist is dead, not a domain block', () => {
  const reg = buildEmailBlockRegistry(docs);
  expect(checkEmailRecipients(['h.arias@ruesd.net', 'other@ruesd.net'], reg)).toEqual({ gmail: [], dead: ['h.arias@ruesd.net'], suppressed: [], review: [] });
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
  expect(checkEmailRecipients(['ad@lincolnhs.org'])).toEqual({ gmail: [], dead: [], suppressed: [], review: [] });
  expect(['x@sangerusd.net', 'y@sweetwaterschools.org'].map((e) => blockedDomainOf(e))).toEqual(['', 'sweetwaterschools.org']);
  setEmailBlockRegistry([]);
});

test('temporary and unknown failures never reroute an entire district', () => {
  for (const reason of ['Mailbox full', 'Temporary server error', 'Unknown error']) {
    const reg = buildEmailBlockRegistry([[{ sent_history: [{ delivery: 'failed', delivery_reason: reason, delivery_to: 'a@school.edu' }] }]]);
    expect(checkEmailRecipients(['b@school.edu'], reg).gmail).toEqual([]);
  }
});
test('success clears the same address regardless of document traversal order; Gmail success does not clear a Brevo block', () => {
  const failure = { delivery: 'failed', delivery_reason: 'sender blocked', delivery_to: 'a@school.edu', sent_at: '2026-09-01' };
  const success = { delivery: 'delivered', delivery_to: 'a@school.edu', sent_at: '2026-09-02' };
  for (const history of [[failure, success], [success, failure]]) {
    expect(checkEmailRecipients(['a@school.edu'], buildEmailBlockRegistry([[{ sent_history: history }]])).gmail).toEqual([]);
  }
  expect(checkEmailRecipients(['a@school.edu'], buildEmailBlockRegistry([[{ sent_history: [failure, { ...success, messageId: 'gmail:abc' }] }]])).gmail).toEqual(['a@school.edu']);
});
test('spam complaints override a district route and cannot be bypassed', () => {
  const reg = buildEmailBlockRegistry([[{ sent_history: [
    { delivery: 'failed', delivery_to: 'a@school.edu', delivery_reason: 'sender blocked' },
    { delivery: 'failed', delivery_to: 'b@school.edu', delivery_event: 'spam' },
  ] }]]);
  expect(checkEmailRecipients(['b@school.edu'], reg).suppressed).toEqual(['b@school.edu']);
  expect(checkEmailRecipients(['b@school.edu'], reg).gmail).toEqual([]);
});

test('reasonless repeat suppression preserves a previous diagnosis, not a domain-wide guess', () => {
  const reg = buildEmailBlockRegistry([[{ sent_history: [
    { sent_at: '2026-09-01', delivery: 'failed', delivery_to: 'a@school.edu', delivery_reason: '550 sender blocked' },
    { sent_at: '2026-09-02', delivery: 'failed', delivery_to: 'a@school.edu', delivery_event: 'blocked' },
  ] }]]);
  expect(checkEmailRecipients(['a@school.edu', 'b@school.edu'], reg).gmail).toEqual(['a@school.edu', 'b@school.edu']);
});
test('generic provider suppression is held for review rather than rerouted', () => {
  const reg = buildEmailBlockRegistry([[{ sent_history: [{ delivery: 'failed', delivery_to: 'a@school.edu', delivery_reason: 'recipient in blocklist' }] }]]);
  expect(checkEmailRecipients(['a@school.edu'], reg).review).toEqual(['a@school.edu']);
  expect(checkEmailRecipients(['b@school.edu'], reg).gmail).toEqual([]);
});
