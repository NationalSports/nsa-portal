import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

// Separate per-tab lock for the coach client so it doesn't contend with the
// admin portal's lock (see lib/supabase.js for the problem this solves).
const _coachAuthLock = (() => {
  let chain = Promise.resolve();
  return async (_name, _acquireTimeout, fn) => {
    const prev = chain;
    let release;
    chain = new Promise((r) => { release = r; });
    try { await prev; return await fn(); }
    finally { release(); }
  };
})();

// Isolated Supabase client for the public coach catalog (/adidas, /livelook).
// Uses a separate storageKey so coach OTP sign-ins never overwrite the admin
// portal's session in localStorage, which would break staff-only API calls.
export const supabaseCoach = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'sb-nsa-coach-auth-token',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: _coachAuthLock,
  },
  global: {
    headers: { 'x-client-info': 'nsa-portal-coach' },
  },
  db: {
    schema: 'public',
  },
});
