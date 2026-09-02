// Netlify function: email roster players their personal store link on demand
// (from the staff admin or the coach portal). One email per player, each with
// their own /shop/<slug>?player=<token> link.
//
// The caller passes a store id and a set of roster player ids; we only ever send
// to the parent_email already stored on those rows (no caller-supplied
// recipients), and stamp invite_sent_at / invite_count so the 5-day reminder
// sweep knows an invite went out. Rows with no valid parent email are skipped
// and reported back so the UI can tell the user who needs an address.

const { getSupabaseAdmin, resolveCustomerFamily, verifyUser } = require('./_shared');
const { assertStoreInFamily } = require('./_coachWebstoreAccess');
const { sendRosterEmail } = require('./_rosterEmail');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const alphaTag = String(body.alpha_tag || '').trim();
    const storeId = String(body.store_id || '').trim();
    const ids = Array.isArray(body.player_ids) ? body.player_ids.filter(Boolean).map(String) : [];
    if (!storeId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'store_id required' }) };
    if (!ids.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'No players selected' }) };
    if (ids.length > 500) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Too many players in one send' }) };

    let sb;
    let store;
    if (alphaTag) {
      sb = getSupabaseAdmin();
      const familyResult = await resolveCustomerFamily(sb, alphaTag);
      if (familyResult.error) return { statusCode: familyResult.notFound ? 403 : 500, headers, body: JSON.stringify({ ok: false, error: familyResult.error }) };
      const owned = await assertStoreInFamily(sb, familyResult.fam, storeId);
      if (owned.error) return { statusCode: owned.status, headers, body: JSON.stringify({ ok: false, error: owned.error }) };
      store = owned.store;
    } else {
      const auth = await verifyUser(event);
      if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ ok: false, error: auth.error }) };
      sb = auth.admin;
      const { data, error } = await sb.from('webstores').select('id,name,slug,primary_color').eq('id', storeId).maybeSingle();
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      if (!data) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Store not found' }) };
      store = data;
    }

    const { data: players, error: pErr } = await sb.from('webstore_roster')
      .select('id,player_name,player_number,parent_email,token,invite_count')
      .eq('store_id', storeId).in('id', ids);
    if (pErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: pErr.message }) };

    let sent = 0; const skipped = [];
    for (const p of players || []) {
      if (!p.token) { skipped.push({ id: p.id, name: p.player_name, reason: 'no link yet' }); continue; }
      const r = await sendRosterEmail({ store, player: p, reminder: !!body.reminder });
      if (!r.ok) { skipped.push({ id: p.id, name: p.player_name, reason: r.error }); continue; }
      const now = new Date().toISOString();
      const patch = body.reminder
        ? { reminder_sent_at: now }
        : { invite_sent_at: now, invite_count: (Number(p.invite_count) || 0) + 1 };
      try { await sb.from('webstore_roster').update(patch).eq('id', p.id); } catch (e) { console.warn('[roster-invite] stamp failed:', e.message); }
      sent += 1;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent, skipped }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
