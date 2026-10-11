// Queue warehouse work for paid At-Once / 24/7 orders. The SQL RPC owns stock
// allocation and replay protection. This never confirms a physical pull or
// creates/submits a supplier PO. Cursor progress prevents unavailable old
// orders from starving newer ones; each completed scan wraps for new receipts.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const CURSOR = 'at_once_pick_scan';
const reply = (statusCode, body) => ({ statusCode, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

async function sweepAtOncePicks(admin, { now = () => Date.now() } = {}) {
  const started = now();
  const saved = await admin.from('app_state').select('value').eq('id', CURSOR).maybeSingle();
  if (saved.error) throw new Error(saved.error.message);
  const cursor = saved.data?.value || null;
  let query = admin.from('webstore_orders')
    .select('id,so_id,webstores!inner(org_type,source)')
    .in('webstores.org_type', ['club', 'all_school'])
    .in('status', ['paid', 'batched']).not('so_id', 'is', null)
    .order('id', { ascending: true }).limit(100);
  if (cursor) query = query.gt('id', cursor);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  const rows = result.data || [];
  const summary = { ok: true, processed: 0, created_lines: 0, assigned_units: 0, errors: [] };
  let last = cursor;
  const seen = new Set();
  for (const row of rows) {
    if (now() - started > 18000) break;
    if (row.webstores?.source !== 'omg' && !seen.has(row.so_id)) {
      seen.add(row.so_id);
      const assigned = await admin.rpc('assign_at_once_inventory_picks', { p_so_id: row.so_id });
      if (assigned.error || assigned.data?.ok !== true) {
        summary.errors.push({ so_id: row.so_id, error: assigned.error?.message || assigned.data?.error || 'Pick assignment failed' });
      } else {
        summary.created_lines += Number(assigned.data.created_lines) || 0;
        summary.assigned_units += Number(assigned.data.assigned_units) || 0;
      }
    }
    last = row.id;
    summary.processed += 1;
  }
  // A failed order remains eligible on the next full pass; successful orders
  // are idempotent, and a later stock receipt can fill their remaining demand.
  if (summary.processed === rows.length && rows.length < 100) last = null;
  const progress = await admin.from('app_state').upsert({ id: CURSOR, value: last, updated_at: new Date().toISOString() });
  if (progress.error) throw new Error(progress.error.message);
  summary.ok = summary.errors.length === 0;
  return summary;
}

exports.handler = async event => {
  if (event?.httpMethod === 'OPTIONS') return reply(200, {});
  if (event?.httpMethod && event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    if (event?.httpMethod) {
      const auth = await verifyUser(event);
      if (!auth.ok) return reply(auth.status || 401, { error: auth.error || 'Unauthorized' });
    }
    const result = await sweepAtOncePicks(getSupabaseAdmin());
    return reply(result.ok ? 200 : 500, result);
  } catch (error) { return reply(500, { ok: false, error: error.message }); }
};
exports.sweepAtOncePicks = sweepAtOncePicks;
