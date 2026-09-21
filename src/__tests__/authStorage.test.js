import { resilientAuthStorage, authStorageDegraded } from '../lib/authStorage';

const AUTH_KEY = 'sb-hpslkvngulqirmbstlfx-auth-token';

beforeEach(() => { localStorage.clear(); resilientAuthStorage.removeItem(AUTH_KEY); });

test('a normal write round-trips through localStorage', () => {
  resilientAuthStorage.setItem(AUTH_KEY, 'token');
  expect(localStorage.getItem(AUTH_KEY)).toBe('token');
  expect(resilientAuthStorage.getItem(AUTH_KEY)).toBe('token');
});

test('the auth token is never evicted to make room for another auth token', () => {
  localStorage.setItem('sb-nsa-coach-auth-token', 'coach');
  localStorage.setItem('nsa_outbox', JSON.stringify({ 'estimates:1': { unsaved: true } }));
  localStorage.setItem('nsa_products_cache', 'y'.repeat(4000));

  const real = Storage.prototype.setItem;
  let freed = false;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
    if (k === AUTH_KEY && !freed) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    return real.call(this, k, v);
  });
  const realRemove = Storage.prototype.removeItem;
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (k) { freed = true; return realRemove.call(this, k); });

  resilientAuthStorage.setItem(AUTH_KEY, 'token');

  expect(localStorage.getItem(AUTH_KEY)).toBe('token');
  expect(localStorage.getItem('sb-nsa-coach-auth-token')).toBe('coach');// other session untouched
  expect(localStorage.getItem('nsa_outbox')).toBeTruthy();// unsaved work untouched
  expect(localStorage.getItem('nsa_products_cache')).toBeNull();// regenerable cache given up
  jest.restoreAllMocks();
});

test('with nothing evictable the session falls back to memory instead of throwing', () => {
  localStorage.setItem('nsa_outbox', 'protected');
  const real = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
    if (k === AUTH_KEY) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    return real.call(this, k, v);
  });

  expect(() => resilientAuthStorage.setItem(AUTH_KEY, 'token')).not.toThrow();
  expect(resilientAuthStorage.getItem(AUTH_KEY)).toBe('token');// sign-in works for this tab
  expect(localStorage.getItem('nsa_outbox')).toBe('protected');
  expect(authStorageDegraded()).toBe(true);// the UI can say storage is full, not "wrong password"

  jest.restoreAllMocks();
  resilientAuthStorage.removeItem(AUTH_KEY);
});

test('authStorageDegraded is false on a healthy store', () => {
  expect(authStorageDegraded()).toBe(false);
});
