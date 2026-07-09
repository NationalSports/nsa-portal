/* Sender policy used for school-district deliverability. */
const { resolveSender, defaultSenderEmail, isPreferredSender } = require('../../netlify/functions/_emailSender');

describe('resolveSender', () => {
  const prev = process.env.BREVO_DEFAULT_SENDER;
  afterEach(() => {
    if (prev === undefined) delete process.env.BREVO_DEFAULT_SENDER;
    else process.env.BREVO_DEFAULT_SENDER = prev;
  });

  test('defaults to hello@ (not noreply@)', () => {
    delete process.env.BREVO_DEFAULT_SENDER;
    expect(defaultSenderEmail()).toBe('hello@nationalsportsapparel.com');
    expect(resolveSender({ name: 'NSA' })).toEqual({
      name: 'NSA',
      email: 'hello@nationalsportsapparel.com',
    });
  });

  test('honors BREVO_DEFAULT_SENDER env override', () => {
    process.env.BREVO_DEFAULT_SENDER = 'orders@nationalsportsapparel.com';
    expect(resolveSender({})).toEqual({
      name: 'National Sports Apparel',
      email: 'orders@nationalsportsapparel.com',
    });
  });

  test('prefers an NSA rep email over the default', () => {
    expect(resolveSender({
      name: 'Jane Rep',
      email: 'jane@nationalsportsapparel.com',
    })).toEqual({ name: 'Jane Rep', email: 'jane@nationalsportsapparel.com' });
  });

  test('upgrades noreply@ to replyTo when replyTo is a preferred NSA mailbox', () => {
    expect(resolveSender({
      name: 'NSA Portal',
      email: 'noreply@nationalsportsapparel.com',
      replyTo: { email: 'jane@nationalsportsapparel.com', name: 'Jane' },
    })).toEqual({ name: 'Jane', email: 'jane@nationalsportsapparel.com' });
  });

  test('treats noreply@ as non-preferred', () => {
    expect(isPreferredSender('noreply@nationalsportsapparel.com')).toBe(false);
    expect(isPreferredSender('hello@nationalsportsapparel.com')).toBe(true);
    expect(isPreferredSender('coach@school.edu')).toBe(false);
  });

  test('does not use a non-NSA replyTo as From', () => {
    expect(resolveSender({
      replyTo: { email: 'coach@school.edu', name: 'Coach' },
    }).email).toBe('hello@nationalsportsapparel.com');
  });
});
