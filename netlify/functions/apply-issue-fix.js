// Apply a Claude-proposed issue fix to live data — the write-back half of the
// Issues-page "Resolve with Claude" flow. Admin-only and deliberately narrow:
//
//   1. The fix must pass _issueFixPolicy (allowlisted table + columns only).
//   2. The target row is fetched first, so we can confirm it exists and capture a
//      before/after for the audit trail returned to the caller.
//   3. Exactly one row (matched by primary-key id) is updated.
//
// The portal only ever calls this after an explicit admin confirmation, and posts
// the resulting diff into the issue's conversation thread for a visible record.
const { corsHeaders, getSupabaseAdmin, verifyAdmin } = require('./_shared');
const { validateFix } = require('./_issueFixPolicy');

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  // Writing to live data is admin/super_admin only — stricter than the diagnose step.
  const auth = await verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad JSON' }) }; }

  const v = validateFix(body.fix);
  if (!v.ok) return { statusCode: 400, headers, body: JSON.stringify({ error: v.reason, rejected: v.rejected || [] }) };
  const { table, id, changes } = v;

  try {
    const admin = getSupabaseAdmin();
    const cols = ['id', ...Object.keys(changes)];

    const { data: current, error: readErr } = await admin.from(table).select(cols.join(',')).eq('id', id).maybeSingle();
    if (readErr) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lookup failed: ' + readErr.message }) };
    if (!current) return { statusCode: 404, headers, body: JSON.stringify({ error: `No ${table} row with id ${id}` }) };

    const before = {};
    for (const k of Object.keys(changes)) before[k] = current[k];

    const { error: updErr } = await admin.from(table).update(changes).eq('id', id);
    if (updErr) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Update failed: ' + updErr.message }) };

    // Audit to the function log; the portal also records it in the issue thread.
    console.log('[apply-issue-fix]', JSON.stringify({
      issue_id: body.issue_id || null, by: auth.teamMemberId, table, id, before, after: changes,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, table, id, before, after: changes, rejected: v.rejected || [] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
