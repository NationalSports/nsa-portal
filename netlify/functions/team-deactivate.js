// Deactivates a team member: flips team_members.is_active=false and bans the auth user.
// Admin-only. Body: { team_member_id }.
const { corsHeaders, getSupabaseAdmin, verifyAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const adminCheck = await verifyAdmin(event);
    if (!adminCheck.ok) {
      return { statusCode: adminCheck.status || 403, headers: corsHeaders(), body: JSON.stringify({ error: adminCheck.error || 'Not authorized' }) };
    }

    const { team_member_id } = JSON.parse(event.body || '{}');
    if (!team_member_id) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing team_member_id' }) };
    }
    if (team_member_id === adminCheck.teamMemberId) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'You cannot deactivate yourself' }) };
    }

    const admin = getSupabaseAdmin();

    const { data: tm, error: tmErr } = await admin
      .from('team_members')
      .select('auth_id')
      .eq('id', team_member_id)
      .single();
    if (tmErr) throw tmErr;

    const { error: updErr } = await admin
      .from('team_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', team_member_id);
    if (updErr) throw updErr;

    if (tm?.auth_id) {
      // Long ban duration effectively blocks login. Pass 'none' to undo later.
      const { error: banErr } = await admin.auth.admin.updateUserById(tm.auth_id, { ban_duration: '876000h' });
      if (banErr) throw banErr;
    }

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: e.message || 'Server error' }) };
  }
};
