import { resilientAuthStorage, authStorageDegraded, _isEvictable } from '../lib/authStorage';

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
  localStorage.setItem('nsa_prod', 'y'.repeat(4000));// legacy whole-table cache dbEngine purges anyway

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
  expect(localStorage.getItem('nsa_prod')).toBeNull();// obsolete cache given up
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

// The deny-list that shipped first would have deleted every one of these to make room.
// Each is the ONLY copy of something a person did in this browser, or a guard whose loss
// causes a repeat action. None may ever be evicted, whatever it is named.
test('keys holding local-only work are never evictable, even when they are the biggest thing in the store', () => {
  const protectedKeys = {
    nsa_bill_review_session: 'in-progress bill review (crash-recovery snapshot)',
    nts_roster: 'a roster a customer typed into the team shop',
    nts_customer: 'team shop customer selection',
    'nsa_player_spring-tigers': 'a storefront player access token',
    nsa_fav_skus: 'rep favorites, local-only',
    nsa_bill_autopull_day: 'once-a-day guard on auto-pulling bills',
    nsa_uniform_pro_autosave: 'uniform builder autosave',
    nsa_uniform_saved: 'saved uniform designs',
    nsa_uniform_orders: 'uniform builder orders',
    'nsa_cart_spring-tigers': 'storefront cart',
    nsa_outbox: 'unsaved order edits',
    nsa_save_failed_ids: 'failed-save ledger',
    'nsa-draft-journal-changed': 'draft journal signal',
    nsa_user: 'signed-in staff profile',
    nsa_settings: 'settings',
    nsa_saved_bills: 'bill history',
    nsa_recent: 'recently viewed',
    'sb-nsa-coach-auth-token': 'the coach client session',
    [AUTH_KEY]: 'this session',
  };
  Object.entries(protectedKeys).forEach(([k, why]) => {
    expect({ key: k, why, evictable: _isEvictable(k) }).toEqual({ key: k, why, evictable: false });
  });

  // And the behavioural check: with a huge protected key and NO evictable key, nothing is removed.
  localStorage.setItem('nsa_bill_review_session', 'z'.repeat(50000));
  const real = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
    if (k === AUTH_KEY) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    return real.call(this, k, v);
  });
  resilientAuthStorage.setItem(AUTH_KEY, 'token');
  expect(localStorage.getItem('nsa_bill_review_session')).toHaveLength(50000);// untouched
  expect(resilientAuthStorage.getItem(AUTH_KEY)).toBe('token');// sign-in still works, in memory
  jest.restoreAllMocks();
  resilientAuthStorage.removeItem(AUTH_KEY);
});

test('only the legacy caches dbEngine purges anyway are evictable', () => {
  ['nsa_sos', 'nsa_prod', 'nsa_cust', 'nsa_change_log', 'nsa_so_history', 'nsa_snap_2026-01-01'].forEach(k => {
    expect({ key: k, evictable: _isEvictable(k) }).toEqual({ key: k, evictable: true });
  });
});

