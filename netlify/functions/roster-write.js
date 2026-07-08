// Coach-portal roster write endpoint (audit #11, Phase 1).
//
// The coach roster portal is a public link (?portal=<alpha_tag>) that runs as the
// Supabase `anon` role. Migration 00160 left roster_* with `FOR ALL TO anon USING(true)`,
// so ANY holder of the shipped anon key can read/write/delete ANY club's roster directly.
// This function (service role) performs roster writes on the coach portal's behalf, scoped
// to the customer family the portal's alpha_tag resolves to — via the shared
// resolveCustomerFamily (same ownership model as portal-action.js). Once the frontend is
// rerouted through this endpoint, migration 00176 revokes direct anon/coach writes on
// roster_* (staff keep writing directly via is_team_member()).
//
// Every op resolves its target row up the hierarchy to a customer_id and asserts that
// customer is in the portal's family. Writes use allow-listed columns only, and the lists
// carry ONLY what the coach portal actually sends — staff-only columns (notes, deadline,
// is_loaner) go through the staff app's direct writes and stay off this surface.
// Session `status` is deliberately NOT writable here: it's server-assigned ('open' on
// create) and transitions only through roster-order-submit's guarded flip — a generic
// status patch would let any alpha_tag holder reopen a submitted session out from under
// the estimate staff built from it (same lesson as the art-decision txn, 00172).

const { getSupabaseAdmin, pickCols, resolveCustomerFamily } = require('./_shared');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...b }) });
const bad = (code, error) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ ok: false, error }) });

// Allow-listed writable columns per table — exactly the columns the coach portal sends
// (KitItemsBar/TeamRosterEditor/RosterOrdersCoach in src/RosterOrders.js). Adding a
// coach-editable column means adding it BOTH there and here, or pickCols silently drops
// it and the coach's save loses the field while staff saves keep it.
const SESSION_COLS = new Set(['name', 'season', 'kit_template_id', 'kit_items', 'created_by', 'updated_at']);
const TEAM_COLS = new Set(['name', 'sort_order', 'locked']);
const PLAYER_COLS = new Set(['first_name', 'last_name', 'jersey_number', 'is_gk', 'sort_order', 'category', 'updated_at']);
const SIZE_COLS = new Set(['kit_slot', 'size', 'qty', 'updated_at']);

function getAdmin() {
  try { return getSupabaseAdmin(); } catch { return null; }
}

// Walk a target row up to its owning customer_id and confirm it's in `fam`.
// One nested-join query per entry point (this runs on every write — the size grid
// fires a write per cell commit, so the old 3-chained-lookup walk tripled latency).
// Returns { ok } or { error } (403 on scope violation, 500 on a server/query error).
async function assertOwned(admin, fam, { sessionId, teamId, playerId }) {
  let cid = null;
  if (playerId) {
    const { data, error } = await admin.from('roster_players')
      .select('roster_teams!inner(roster_order_sessions!inner(customer_id))')
      .eq('id', playerId).maybeSingle();
    if (error) return { error: error.message, server: true };
    if (!data) return { error: 'Player not found' };
    cid = data.roster_teams?.roster_order_sessions?.customer_id;
  } else if (teamId) {
    const { data, error } = await admin.from('roster_teams')
      .select('roster_order_sessions!inner(customer_id)')
      .eq('id', teamId).maybeSingle();
    if (error) return { error: error.message, server: true };
    if (!data) return { error: 'Team not found' };
    cid = data.roster_order_sessions?.customer_id;
  } else if (sessionId) {
    const { data, error } = await admin.from('roster_order_sessions')
      .select('customer_id').eq('id', sessionId).maybeSingle();
    if (error) return { error: error.message, server: true };
    if (!data) return { error: 'Session not found' };
    cid = data.customer_id;
  }
  if (!cid || !fam.has(cid)) return { error: 'Not authorized for this roster' };
  return { ok: true };
}

const denied = (owned) => bad(owned.server ? 500 : 403, owned.error);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  const alphaTag = String(body.alpha_tag || '').trim();
  const op = String(body.op || '').trim();
  const p = body.payload || {};
  if (!alphaTag) return bad(400, 'alpha_tag required');
  if (!op) return bad(400, 'op required');

  const admin = getAdmin();
  if (!admin) return bad(500, 'Service not configured');

  const famRes = await resolveCustomerFamily(admin, alphaTag);
  if (famRes.error) return bad(famRes.notFound ? 403 : 500, famRes.error);
  const fam = famRes.fam;

  try {
    switch (op) {
      // ── roster_order_sessions ──
      case 'session_upsert': {
        // customer_id must be in the portal family (create); on update, the existing row must be too.
        const customerId = String(p.customer_id || '').trim();
        if (p.id) {
          const owned = await assertOwned(admin, fam, { sessionId: p.id });
          if (!owned.ok) return denied(owned);
          const patch = pickCols(p, SESSION_COLS);
          if (!Object.keys(patch).length) return bad(400, 'No writable fields');
          const { data, error } = await admin.from('roster_order_sessions')
            .update(patch).eq('id', p.id).select('*').maybeSingle();
          if (error) return bad(500, error.message);
          return ok({ data });
        }
        if (!customerId || !fam.has(customerId)) return bad(403, 'Not authorized for this customer');
        // status is server-assigned; transitions only via roster-order-submit.
        const row = { ...pickCols(p, SESSION_COLS), customer_id: customerId, status: 'open' };
        const { data, error } = await admin.from('roster_order_sessions').insert(row).select('*').maybeSingle();
        if (error) return bad(500, error.message);
        return ok({ data });
      }

      // ── roster_teams ──
      case 'team_insert': {
        const owned = await assertOwned(admin, fam, { sessionId: p.session_id });
        if (!owned.ok) return denied(owned);
        const row = { ...pickCols(p, TEAM_COLS), session_id: p.session_id };
        const { data, error } = await admin.from('roster_teams').insert(row).select('*').maybeSingle();
        if (error) return bad(500, error.message);
        return ok({ data });
      }
      case 'team_update': {
        const owned = await assertOwned(admin, fam, { teamId: p.id });
        if (!owned.ok) return denied(owned);
        const { error } = await admin.from('roster_teams').update(pickCols(p, TEAM_COLS)).eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }

      // ── roster_players ──
      case 'player_insert': {
        // Accept a single player or an array; all must attach to the same team, owned by the family.
        const rows = Array.isArray(p.players) ? p.players : [p];
        const teamId = String(p.team_id || (rows[0] && rows[0].team_id) || '').trim();
        const owned = await assertOwned(admin, fam, { teamId });
        if (!owned.ok) return denied(owned);
        const ins = rows.map((r) => ({ ...pickCols(r, PLAYER_COLS), team_id: teamId }));
        const { data, error } = await admin.from('roster_players').insert(ins).select('*');
        if (error) return bad(500, error.message);
        // Single row for a single insert, the array for a bulk insert — matches the
        // frontend's .single() vs .select() usage so state updates the same either way.
        return ok({ data: Array.isArray(p.players) ? (data || []) : (data && data[0]) });
      }
      case 'player_update': {
        const owned = await assertOwned(admin, fam, { playerId: p.id });
        if (!owned.ok) return denied(owned);
        const { error } = await admin.from('roster_players').update(pickCols(p, PLAYER_COLS)).eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }
      case 'player_delete': {
        const owned = await assertOwned(admin, fam, { playerId: p.id });
        if (!owned.ok) return denied(owned);
        const { error } = await admin.from('roster_players').delete().eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }

      // ── roster_player_sizes ──
      case 'sizes_upsert': {
        const playerId = String(p.player_id || '').trim();
        const owned = await assertOwned(admin, fam, { playerId });
        if (!owned.ok) return denied(owned);
        const row = { ...pickCols(p, SIZE_COLS), player_id: playerId };
        const { error } = await admin.from('roster_player_sizes').upsert(row, { onConflict: 'player_id,kit_slot' });
        if (error) return bad(500, error.message);
        return ok({ player_id: playerId });
      }

      default:
        return bad(400, `Unknown op: ${op}`);
    }
  } catch (e) {
    return bad(500, e.message);
  }
};
