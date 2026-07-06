// Coach-portal roster write endpoint (audit #11, Phase 1).
//
// The coach roster portal is a public link (?portal=<alpha_tag>) that runs as the
// Supabase `anon` role. Migration 00160 left roster_* with `FOR ALL TO anon USING(true)`,
// so ANY holder of the shipped anon key can read/write/delete ANY club's roster directly.
// This function (service role) performs roster writes on the coach portal's behalf, scoped
// to the customer family the portal's alpha_tag resolves to — the SAME ownership model as
// portal-action.js. Once the frontend is rerouted through this endpoint, a migration revokes
// direct anon/coach writes on roster_* (staff keep writing directly via is_team_member()).
//
// Every op resolves its target row up the hierarchy to a customer_id and asserts that
// customer is in the portal's family. Writes use allow-listed columns only.

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...b }) });
const bad = (code, error) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ ok: false, error }) });

// Allow-listed writable columns per table (defends against a crafted payload writing
// arbitrary columns — e.g. flipping ownership fields). id/parent keys are handled explicitly.
// Column names verified against migration 00160.
const SESSION_COLS = new Set(['name', 'status', 'season', 'deadline', 'kit_template_id', 'notes', 'kit_items', 'updated_at']);
const TEAM_COLS = new Set(['name', 'sort_order', 'locked']);
const PLAYER_COLS = new Set(['first_name', 'last_name', 'jersey_number', 'is_gk', 'is_loaner', 'sort_order', 'updated_at']);
const SIZE_COLS = new Set(['kit_slot', 'size', 'updated_at']);
const pick = (obj, allowed) => {
  const out = {};
  Object.keys(obj || {}).forEach((k) => { if (allowed.has(k)) out[k] = obj[k]; });
  return out;
};

function getAdmin() {
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Resolve the customer family (parent + sub-customers) for a portal alpha_tag.
async function resolveFamily(admin, alphaTag) {
  const { data: parents, error } = await admin.from('customers').select('id').eq('alpha_tag', alphaTag);
  if (error) return { error: error.message };
  if (!parents || !parents.length) return { error: 'Unknown portal tag', notFound: true };
  const parentIds = parents.map((p) => p.id);
  const { data: kids } = await admin.from('customers').select('id').in('parent_id', parentIds);
  return { fam: new Set([...parentIds, ...(kids || []).map((k) => k.id)]) };
}

// Walk a target row up to its owning customer_id and confirm it's in `fam`.
// Returns { ok } or { error } (403 on scope violation).
async function assertOwned(admin, fam, { sessionId, teamId, playerId }) {
  let cid = null;
  if (playerId) {
    const { data } = await admin.from('roster_players').select('team_id').eq('id', playerId).maybeSingle();
    if (!data) return { error: 'Player not found' };
    teamId = data.team_id;
  }
  if (teamId) {
    const { data } = await admin.from('roster_teams').select('session_id').eq('id', teamId).maybeSingle();
    if (!data) return { error: 'Team not found' };
    sessionId = data.session_id;
  }
  if (sessionId) {
    const { data } = await admin.from('roster_order_sessions').select('customer_id').eq('id', sessionId).maybeSingle();
    if (!data) return { error: 'Session not found' };
    cid = data.customer_id;
  }
  if (!cid || !fam.has(cid)) return { error: 'Not authorized for this roster' };
  return { ok: true };
}

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

  const famRes = await resolveFamily(admin, alphaTag);
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
          if (!owned.ok) return bad(403, owned.error);
          const { data, error } = await admin.from('roster_order_sessions')
            .update(pick(p, SESSION_COLS)).eq('id', p.id).select('id').maybeSingle();
          if (error) return bad(500, error.message);
          return ok({ id: data && data.id });
        }
        if (!customerId || !fam.has(customerId)) return bad(403, 'Not authorized for this customer');
        const row = { ...pick(p, SESSION_COLS), customer_id: customerId };
        const { data, error } = await admin.from('roster_order_sessions').insert(row).select('id').maybeSingle();
        if (error) return bad(500, error.message);
        return ok({ id: data && data.id });
      }

      // ── roster_teams ──
      case 'team_insert': {
        const owned = await assertOwned(admin, fam, { sessionId: p.session_id });
        if (!owned.ok) return bad(403, owned.error);
        const row = { ...pick(p, TEAM_COLS), session_id: p.session_id };
        const { data, error } = await admin.from('roster_teams').insert(row).select('id').maybeSingle();
        if (error) return bad(500, error.message);
        return ok({ id: data && data.id });
      }
      case 'team_update': {
        const owned = await assertOwned(admin, fam, { teamId: p.id });
        if (!owned.ok) return bad(403, owned.error);
        const { error } = await admin.from('roster_teams').update(pick(p, TEAM_COLS)).eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }
      case 'team_delete': {
        const owned = await assertOwned(admin, fam, { teamId: p.id });
        if (!owned.ok) return bad(403, owned.error);
        const { error } = await admin.from('roster_teams').delete().eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }

      // ── roster_players ──
      case 'player_insert': {
        // Accept a single player or an array; all must attach to the same team, owned by the family.
        const rows = Array.isArray(p.players) ? p.players : [p];
        const teamId = String(p.team_id || (rows[0] && rows[0].team_id) || '').trim();
        const owned = await assertOwned(admin, fam, { teamId });
        if (!owned.ok) return bad(403, owned.error);
        const ins = rows.map((r) => ({ ...pick(r, PLAYER_COLS), team_id: teamId }));
        const { data, error } = await admin.from('roster_players').insert(ins).select('id');
        if (error) return bad(500, error.message);
        return ok({ ids: (data || []).map((d) => d.id) });
      }
      case 'player_update': {
        const owned = await assertOwned(admin, fam, { playerId: p.id });
        if (!owned.ok) return bad(403, owned.error);
        const { error } = await admin.from('roster_players').update(pick(p, PLAYER_COLS)).eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }
      case 'player_delete': {
        const owned = await assertOwned(admin, fam, { playerId: p.id });
        if (!owned.ok) return bad(403, owned.error);
        const { error } = await admin.from('roster_players').delete().eq('id', p.id);
        if (error) return bad(500, error.message);
        return ok({ id: p.id });
      }

      // ── roster_player_sizes ──
      case 'sizes_upsert': {
        const playerId = String(p.player_id || '').trim();
        const owned = await assertOwned(admin, fam, { playerId });
        if (!owned.ok) return bad(403, owned.error);
        const rows = (Array.isArray(p.sizes) ? p.sizes : [p]).map((r) => ({ ...pick(r, SIZE_COLS), player_id: playerId }));
        const { error } = await admin.from('roster_player_sizes').upsert(rows, { onConflict: 'player_id,kit_slot' });
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
