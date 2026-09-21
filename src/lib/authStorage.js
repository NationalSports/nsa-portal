// Resilient storage adapter for the Supabase auth token.
//
// Why this exists (NSA, 2026-09-21): a warehouse user could not sign in. Supabase
// authenticated him fine server-side (auth.users.last_sign_in_at advanced), but the
// browser threw while gotrue-js persisted the session, and Safari's DOMException
// message — "The quota has been exceeded." — surfaced verbatim on the login card.
// The same failure made a fresh password-reset link look "invalid or expired":
// detectSessionInUrl could not save the recovered session, so getSession() read back
// null. One full localStorage, two unrelated-looking errors, no way out from the UI.
//
// A quota error is NOT an AuthError, so gotrue-js rethrows it instead of returning
// { error }, which is why it escaped every normal auth error path.
//
// The auth token is a few KB. If it cannot be written, the cure is to drop a cache that
// is provably worthless — never anything that might be the only copy of someone's work.
// Eviction is therefore an ALLOW-list, not a deny-list. A deny-list shipped first and
// leaked: it would have deleted an in-progress bill review snapshot
// (nsa_bill_review_session), a roster a customer typed into the team shop (nts_roster),
// a storefront player's access token (nsa_player_<slug>) and a rep's local-only favorites
// (nsa_fav_skus) to make room, because none of those names looked like "draft" or "cart".
//
// What IS evictable: the legacy whole-table caches that dbEngine deletes on every load
// anyway (see its "One-time cleanup" block) — nsa_sos / nsa_prod / nsa_change_log and
// friends. They are multi-MB, obsolete, and the most likely reason an older device is
// full at sign-in, since the login screen runs BEFORE dbEngine's purge gets a chance.
// The list is duplicated here rather than imported because the login gate must not pull
// in dbEngine (see lib/auth.js) — keep it in sync with dbEngine's purge list.
//
// Everything else is left alone. If freeing the legacy caches isn't enough, the session
// is kept in memory: the user still signs in and can work this tab, and the login/reset
// screens tell them their storage is full so they know why a refresh will sign them out.
const EVICTABLE_EXACT = new Set([
  'nsa_auto_backup', 'nsa_auto_backup_ts', 'nsa_change_log', 'nsa_so_history', 'nsa_est_history',
  'nsa_inv_adj_log', 'nsa_cust', 'nsa_ests', 'nsa_sos', 'nsa_invs', 'nsa_msgs', 'nsa_prod', 'nsa_vend',
  'nsa_storage_probe',
]);
const EVICTABLE_PREFIX = ['nsa_snap_'];
const isEvictable = (k) => EVICTABLE_EXACT.has(k) || EVICTABLE_PREFIX.some((p) => k.startsWith(p));
const MAX_EVICTION_ROUNDS = 8;
const EVICT_PER_ROUND = 5;

const isQuotaError = (e) => !!e && (
  e.name === 'QuotaExceededError' ||
  e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
  e.code === 22 || e.code === 1014 ||
  /quota/i.test(e.message || '')
);

// Session survives here when localStorage is full, blocked (Safari private mode), or absent.
const memory = new Map();
const memoryOnly = new Set();
let warned = false;

const ls = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; }
  catch { return null; }// accessing localStorage itself can throw when storage is blocked
};

// Drop the largest evictable cache keys. Returns false when there is nothing left to give up.
const evictSome = (store) => {
  const candidates = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && isEvictable(k)) candidates.push([k, (store.getItem(k) || '').length]);
    }
  } catch { return false; }
  if (!candidates.length) return false;
  candidates.sort((a, b) => b[1] - a[1]);
  let dropped = false;
  candidates.slice(0, EVICT_PER_ROUND).forEach(([k]) => {
    try { store.removeItem(k); dropped = true; } catch {}
  });
  return dropped;
};

export const resilientAuthStorage = {
  getItem: (key) => {
    if (memoryOnly.has(key)) return memory.has(key) ? memory.get(key) : null;
    const store = ls();
    if (!store) return memory.has(key) ? memory.get(key) : null;
    try { return store.getItem(key); } catch { return memory.has(key) ? memory.get(key) : null; }
  },

  setItem: (key, value) => {
    const store = ls();
    if (store) {
      for (let round = 0; round <= MAX_EVICTION_ROUNDS; round++) {
        try {
          store.setItem(key, value);
          memoryOnly.delete(key);
          memory.delete(key);
          return;
        } catch (e) {
          if (!isQuotaError(e) || !evictSome(store)) break;
        }
      }
    }
    // Could not persist: keep the session for this tab so sign-in still works.
    memory.set(key, value);
    memoryOnly.add(key);
    if (!warned) {
      warned = true;
      console.warn('[Auth] Browser storage is full or unavailable — your session will not survive a refresh of this tab.');
    }
  },

  removeItem: (key) => {
    memory.delete(key);
    memoryOnly.delete(key);
    const store = ls();
    if (!store) return;
    try { store.removeItem(key); } catch {}
  },
};


// True when the auth token cannot be persisted right now (storage full, or blocked as in
// Safari private browsing). The login and reset screens check this so a storage failure is
// reported as what it is, instead of as a wrong password or an expired link.
export const authStorageDegraded = () => {
  if (memoryOnly.size) return true;
  const store = ls();
  if (!store) return true;
  try { store.setItem('nsa_storage_probe', '1'); store.removeItem('nsa_storage_probe'); return false; }
  catch { return true; }
};

export const _isQuotaError = isQuotaError;
export const _isEvictable = isEvictable;// exported for tests
