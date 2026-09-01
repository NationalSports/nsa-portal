import { qboFunctionCallbackUrl, qboProductionReconnectUrl } from '../qbOAuthCallback';

describe('QuickBooks root OAuth callback forwarding', () => {
  test('forwards a successful Intuit callback to the serverless exchange', () => {
    const target = qboFunctionCallbackUrl({
      pathname: '/',
      search: '?action=callback&code=secret-code&state=csrf-state&realmId=12345',
    });
    expect(target).toBe('/.netlify/functions/qb-auth?action=callback&code=secret-code&state=csrf-state&realmId=12345');
  });

  test('forwards an Intuit cancellation so the QB page can show the error', () => {
    const target = qboFunctionCallbackUrl({
      pathname: '/',
      search: '?action=callback&error=access_denied&state=csrf-state',
    });
    expect(target).toBe('/.netlify/functions/qb-auth?action=callback&state=csrf-state&error=access_denied');
  });

  test('does not redirect an ordinary portal URL', () => {
    expect(qboFunctionCallbackUrl({ pathname: '/', search: '?pg=qb' })).toBeNull();
    expect(qboFunctionCallbackUrl({ pathname: '/', search: '?action=callback&code=x' })).toBeNull();
  });
});

describe('QuickBooks preview reconnect routing', () => {
  test('moves a deploy-preview reconnect to the production QB page first', () => {
    expect(qboProductionReconnectUrl({
      hostname: 'deploy-preview-2041--nsa-portal.netlify.app',
      origin: 'https://deploy-preview-2041--nsa-portal.netlify.app',
    })).toBe('https://connect.nationalsportsapparel.com/?pg=qb&qb_reconnect=1');
  });

  test('does not bounce an already same-origin production reconnect', () => {
    expect(qboProductionReconnectUrl({
      hostname: 'connect.nationalsportsapparel.com',
      origin: 'https://connect.nationalsportsapparel.com',
    })).toBeNull();
  });
});
