// Sends a magic-link invite to a team member and links the resulting auth user
// to the team_members row. Admin-only. Body: { team_member_id, email }.
const { corsHeaders, getSupabaseAdmin, getSiteUrl, verifyAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const adminCheck = await verifyAdmin(event);
    if (!adminCheck.ok) {
      return { statusCode: adminCheck.status || 403, headers: corsHeaders(), body: JSON.stringify({ error: adminCheck.error || 'Not authorized' }) };
    }

    const { team_member_id, email } = JSON.parse(event.body || '{}');
    if (!team_member_id || !email) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing team_member_id or email' }) };
    }
    const cleanEmail = String(email).trim().toLowerCase();

    const admin = getSupabaseAdmin();
    const redirectTo = `${getSiteUrl(event)}/auth/setup`;

    // Look up an existing auth user with this email so we can decide invite vs. resend.
    let existing = null;
    {
      let page = 1;
      const perPage = 200;
      while (true) {
        const { data: authData, error: auErr } = await admin.auth.admin.listUsers({ page, perPage });
        if (auErr) throw auErr;
        const users = authData?.users || [];
        existing = users.find(u => (u.email || '').toLowerCase() === cleanEmail);
        if (existing || users.length < perPage) break;
        page += 1;
        if (page > 20) break;
      }
    }

    let authUserId;
    let resentExisting = false;

    if (existing) {
      // Already in auth — un-ban if previously deactivated and resend the invite.
      if (existing.banned_until) {
        await admin.auth.admin.updateUserById(existing.id, { ban_duration: 'none' });
      }
      const { error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: cleanEmail,
        options: { redirectTo }
      });
      if (linkErr) {
        // generateLink fails when the account is already confirmed; fall back to a recovery link
        // so the user can set/reset a password.
        const { error: recErr } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: cleanEmail,
          options: { redirectTo }
        });
        if (recErr) throw recErr;
      }
      authUserId = existing.id;
      resentExisting = true;
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(cleanEmail, { redirectTo });
      if (error) throw error;
      authUserId = data?.user?.id;
    }

    // Link the auth user to the team_members row and update email if it was missing/stale.
    const { error: updErr } = await admin
      .from('team_members')
      .update({
        auth_id: authUserId,
        email: cleanEmail,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', team_member_id);
    if (updErr) throw updErr;

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, auth_id: authUserId, resent: resentExisting })
    };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: e.message || 'Server error' }) };
  }
};
