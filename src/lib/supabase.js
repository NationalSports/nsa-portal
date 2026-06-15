import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project settings
// Set them in Netlify Environment Variables or .env.local for dev
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // The portal is frequently open in many tabs at once (including the COWORK
    // sync tabs on the same origin). supabase-js coordinates the auth token
    // across tabs via the Web Locks API; under heavy multi-tab contention the
    // default lock times out ("Acquiring an exclusive Navigator LockManager
    // lock 'lock:sb-...-auth-token' timed out waiting 10000ms"), which broke the
    // public /adidas catalog load. Best-effort lock: serialize when the lock is
    // free, but never block the page waiting on it — fall back to running now.
    lock: async (name, _acquireTimeout, fn) => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
          return await navigator.locks.request(name, { ifAvailable: true }, async () => fn());
        }
      } catch (_) { /* fall through to lock-free execution */ }
      return await fn();
    },
  },
  realtime: {
    heartbeatIntervalMs: 30000,
    reconnectAfterMs: (tries) => Math.min(1000 * Math.pow(2, tries), 60000),
    timeout: 20000,
  },
  global: {
    headers: { 'x-client-info': 'nsa-portal' },
  },
  db: {
    schema: 'public',
  },
});
