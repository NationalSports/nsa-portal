import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project settings
// Set them in Netlify Environment Variables or .env.local for dev
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

// In-memory promise-chain lock — serializes auth/token access within the tab
// WITHOUT the Navigator LockManager, whose browser-wide lock can time out
// ("Acquiring an exclusive Navigator LockManager lock ... timed out waiting
// 10000ms") when more than one Supabase client shares the same auth-token
// storage key in a tab. The portal (src/App.js) creates its own client AND
// imports this one, so two clients contend; this mirrors App.js's lock so
// neither blocks on the browser lock.
const _authLock = (() => {
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
    detectSessionInUrl: true, // needed for the public catalog's magic-link sign-in
    lock: _authLock,
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
