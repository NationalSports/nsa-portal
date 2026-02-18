import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project settings
// Set them in Netlify Environment Variables or .env.local for dev
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
