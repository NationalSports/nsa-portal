import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project settings
// Set them in Netlify Environment Variables or .env.local for dev
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

// Per-tab in-memory mutex used as GoTrue's auth `lock`. It replaces the default
// Navigator LockManager, which is shared across every tab on the origin and can
// deadlock / time out auth-token reads — surfacing as:
//   "Acquiring an exclusive Navigator LockManager lock
//    'lock:sb-<ref>-auth-token' timed out waiting 10000ms"
// when many tabs are open (a backgrounded tab can hold the exclusive lock).
// Exported so App.js's client shares this EXACT mutex: both clients use the same
// Supabase storage key, so they must serialize auth ops through one in-memory
// lock rather than racing or contending on the cross-tab LockManager.
export const _sbAuthLock = (() => {
  let chain = Promise.resolve();
  return async (_name, _acquireTimeout, fn) => {
    const prev = chain;
    let release;
    chain = new Promise((r) => { release = r; });
    try { await prev; return await fn(); }
    finally { release(); }
  };
})();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: _sbAuthLock,
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
