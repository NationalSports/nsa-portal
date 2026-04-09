import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project settings
// Set them in Netlify Environment Variables or .env.local for dev
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
