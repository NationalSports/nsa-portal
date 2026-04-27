// Returns merged list of team_members + their Supabase auth status.
// Admin-only. Called when the Team Access page loads.
const { corsHeaders, getSupabaseAdmin, verifyAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };

  try {
    const adminCheck = await verifyAdmin(event);
    if (!adminCheck.ok) {
      return { statusCode: adminCheck.status || 403, headers: corsHeaders(), body: JSON.stringify({ error: adminCheck.error || 'Not authorized' }) };
    }

    const includeInactive = event.queryStringParameters?.include_inactive === '1';
    const admin = getSupabaseAdmin();

    let q = admin.from('team_members').select('*').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data: members, error: tmErr } = await q;
    if (tmErr) throw tmErr;

    // Page through auth users (Supabase caps perPage at 1000; we have well under that)
    const authByEmail = new Map();
    const authById = new Map();
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data: authData, error: auErr } = await admin.auth.admin.listUsers({ page, perPage });
      if (auErr) throw auErr;
      const users = authData?.users || [];
      for (const u of users) {
        if (u.email) authByEmail.set(u.email.toLowerCase(), u);
        authById.set(u.id, u);
      }
      if (users.length < perPage) break;
      page += 1;
      if (page > 20) break;
    }

    const merged = (members || []).map(tm => {
      const au = (tm.auth_id && authById.get(tm.auth_id)) ||
                 (tm.email && authByEmail.get(tm.email.toLowerCase())) ||
                 null;
      let status = 'not_invited';
      if (au) {
        if (au.banned_until && new Date(au.banned_until).getTime() > Date.now()) {
          status = 'disabled';
        } else if (au.last_sign_in_at) {
          status = 'active';
        } else if (au.email_confirmed_at) {
          status = 'confirmed_no_login';
        } else if (au.invited_at || au.confirmation_sent_at) {
          status = 'invited_pending';
        }
      }
      return {
        ...tm,
        auth: au ? {
          id: au.id,
          email: au.email,
          last_sign_in_at: au.last_sign_in_at,
          invited_at: au.invited_at,
          confirmation_sent_at: au.confirmation_sent_at,
          email_confirmed_at: au.email_confirmed_at,
          banned_until: au.banned_until || null,
          created_at: au.created_at
        } : null,
        status
      };
    });

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ members: merged }) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: e.message || 'Server error' }) };
  }
};
