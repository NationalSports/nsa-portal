// Shared helpers for team-list / team-invite / team-deactivate functions.
// Holds CORS boilerplate + admin verification using the user's JWT.
const { createClient } = require('@supabase/supabase-js');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function getSupabaseAdmin() {
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials missing');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getSiteUrl(event) {
  if (process.env.URL) return process.env.URL;
  const host = event.headers?.host || event.headers?.Host;
  return host ? `https://${host}` : '';
}

// Verify caller is signed in and has an admin (or super_admin) team_members row.
async function verifyAdmin(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Missing bearer token' };
  const token = auth.substring(7);

  const admin = getSupabaseAdmin();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: tm, error: tmErr } = await admin
    .from('team_members')
    .select('id, role, is_active')
    .eq('auth_id', userData.user.id)
    .maybeSingle();
  if (tmErr) return { ok: false, status: 500, error: tmErr.message };
  if (!tm || tm.is_active === false) return { ok: false, status: 403, error: 'Inactive account' };
  if (tm.role !== 'admin' && tm.role !== 'super_admin') return { ok: false, status: 403, error: 'Admin role required' };

  return { ok: true, userId: userData.user.id, teamMemberId: tm.id, admin };
}

module.exports = { corsHeaders, getSupabaseAdmin, getSiteUrl, verifyAdmin };
