const { requestOrigin, qbPortalRedirect } = require('../../netlify/functions/_qbOAuthRedirect');

describe('QuickBooks post-exchange redirect', () => {
  test('returns to the same custom portal host and opens the QB page', () => {
    const event = { headers: { host: 'connect.nationalsportsapparel.com', 'x-forwarded-proto': 'https' } };
    expect(qbPortalRedirect(event, 'https://nsa-portal.netlify.app', { qb_connected: '1', realm: '9341' }))
      .toBe('https://connect.nationalsportsapparel.com/?pg=qb#/qb?qb_connected=1&realm=9341');
  });

  test('uses the configured site when request host metadata is unavailable', () => {
    expect(qbPortalRedirect({ headers: {} }, 'https://nsa-portal.netlify.app/', { error: 'state_mismatch' }))
      .toBe('https://nsa-portal.netlify.app/?pg=qb#/qb?error=state_mismatch');
  });

  test('rejects an unsafe host value', () => {
    expect(requestOrigin({ headers: { host: 'good.example.com/evil' } }, 'https://safe.example.com'))
      .toBe('https://safe.example.com');
  });
});
