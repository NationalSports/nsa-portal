const { requestOrigin, qbOAuthRedirectUri, qbPortalRedirect } = require('../../netlify/functions/_qbOAuthRedirect');

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

describe('QuickBooks authorization redirect URI', () => {
  test('forces the production custom-domain callback over a stale raw Netlify setting', () => {
    const event = { headers: { host: 'connect.nationalsportsapparel.com', 'x-forwarded-proto': 'https' } };
    expect(qbOAuthRedirectUri(event, 'https://nsa-portal.netlify.app/', 'https://nsa-portal.netlify.app'))
      .toBe('https://connect.nationalsportsapparel.com/');
  });

  test('preserves an explicit redirect outside the production custom domain', () => {
    const event = { headers: { host: 'localhost:8888', 'x-forwarded-proto': 'http' } };
    expect(qbOAuthRedirectUri(event, 'https://example.com/qb/callback', 'http://localhost:8888'))
      .toBe('https://example.com/qb/callback');
  });
});
