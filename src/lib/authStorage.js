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
// The auth token is a few KB. If it cannot be written, the cure is to drop a
// regenerable cache — never someone's unsaved work. Eviction is therefore opt-out:
// anything that looks like a draft, outbox, cart, or another auth token is protected,
// and if no evictable cache exists we keep the session in memory so the user can still
// work this tab rather than being locked out entirely.

// Keys eviction must never touch: other Supabase auth tokens (`sb-…`, including the
// coach client's) and anything holding work that exists only in this browser.
const NEVER_EVICT = /^sb-|outbox|draft|autosave|saved|cart|resume|pending|failed|nsa_user|nsa_settings/i;
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
      if (k && !NEVER_EVICT.test(k)) candidates.push([k, (store.getItem(k) || '').length]);
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

export const _isQuotaError = isQuotaError;// exported for tests
