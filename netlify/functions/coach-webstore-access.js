// Token-scoped coach team-store tracking and roster gateway.
// The public portal tag is a bearer credential. It is resolved server-side to a
// customer family; the browser never receives a service key and cannot choose a
// customer/store outside that family. Direct anon access is revoked by the
// companion migration once this endpoint is deployed.

const { getSupabaseAdmin, resolveCustomerFamily } = require('./_shared');
const {
  assertRosterRowInFamily,
  assertStoreInFamily,
  curateRosterRow,
  fetchCoachWebstoreSnapshot,
  fetchCoachWebstores,
  rosterInsertRow,
} = require('./_coachWebstoreAccess');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const respond = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const ok = (body = {}) => respond(200, { ok: true, ...body });
const bad = (statusCode, error) => respond(statusCode, { ok: false, error });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
  const alphaTag = String(body.alpha_tag || '').trim();
  const action = String(body.action || '').trim();
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  if (!alphaTag || alphaTag.length > 200) return bad(400, 'alpha_tag required');
  if (!action) return bad(400, 'action required');

  let admin;
  try { admin = getSupabaseAdmin(); } catch { return bad(500, 'Service not configured'); }
  const familyResult = await resolveCustomerFamily(admin, alphaTag);
  if (familyResult.error) return bad(familyResult.notFound ? 403 : 500, familyResult.error);
  const family = familyResult.fam;

  try {
    if (action === 'snapshot') {
      return ok(await fetchCoachWebstoreSnapshot(admin, family));
    }

    if (action === 'stores') {
      return ok({ stores: await fetchCoachWebstores(admin, family) });
    }

    if (action === 'roster_list') {
      const owned = await assertStoreInFamily(admin, family, payload.store_id);
      if (owned.error) return bad(owned.status, owned.error);
      const { data, error } = await admin.from('webstore_roster')
        .select('*').eq('store_id', owned.store.id).order('player_name');
      if (error) return bad(500, error.message);
      return ok({ roster: (data || []).map(curateRosterRow) });
    }

    if (action === 'roster_insert') {
      const owned = await assertStoreInFamily(admin, family, payload.store_id);
      if (owned.error) return bad(owned.status, owned.error);
      const players = Array.isArray(payload.players) ? payload.players : [];
      if (!players.length || players.length > 500) return bad(400, 'Provide 1 to 500 players');
      const rows = players.map((player) => rosterInsertRow(owned.store.id, player));
      if (rows.some((row) => !row.player_name)) return bad(400, 'Every player needs a name');
      const { data, error } = await admin.from('webstore_roster').insert(rows).select('*');
      if (error) return bad(400, error.message);
      return ok({ roster: (data || []).map(curateRosterRow) });
    }

    if (action === 'roster_update') {
      const owned = await assertRosterRowInFamily(admin, family, payload.id);
      if (owned.error) return bad(owned.status, owned.error);
      const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
      const patch = {};
      if (Object.prototype.hasOwnProperty.call(fields, 'player_name')) patch.player_name = String(fields.player_name || '').trim().slice(0, 200);
      if (Object.prototype.hasOwnProperty.call(fields, 'player_number')) patch.player_number = String(fields.player_number || '').trim().slice(0, 50) || null;
      if (Object.prototype.hasOwnProperty.call(fields, 'parent_email')) patch.parent_email = String(fields.parent_email || '').trim().slice(0, 320) || null;
      if (Object.prototype.hasOwnProperty.call(fields, 'position')) {
        const value = String(fields.position || '').trim().toLowerCase();
        patch.position = value === 'gk' || value === 'field' ? value : null;
      }
      if (!Object.keys(patch).length) return bad(400, 'No writable fields');
      if (Object.prototype.hasOwnProperty.call(patch, 'player_name') && !patch.player_name) return bad(400, 'Player name required');
      const { data, error } = await admin.from('webstore_roster')
        .update(patch).eq('id', owned.row.id).eq('store_id', owned.row.store_id).select('*').maybeSingle();
      if (error) return bad(400, error.message);
      return ok({ player: curateRosterRow(data) });
    }

    if (action === 'roster_delete') {
      const owned = await assertRosterRowInFamily(admin, family, payload.id);
      if (owned.error) return bad(owned.status, owned.error);
      const { error } = await admin.from('webstore_roster')
        .delete().eq('id', owned.row.id).eq('store_id', owned.row.store_id);
      if (error) return bad(500, error.message);
      return ok();
    }

    return bad(400, 'Unknown action');
  } catch (error) {
    console.error('[coach-webstore-access]', error);
    return bad(500, error.message || 'Request failed');
  }
};
