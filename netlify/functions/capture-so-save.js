// Capture a real sales-order save for the shadow A/B harness.
//
// The staff browser posts the SO object it just saved; this records that object
// (the replay INPUT) plus a snapshot of the persisted child rows (the expected
// OUTPUT) into so_save_audit. Staff-only (verifyUser) and best-effort — the
// browser calls it fire-and-forget after a SUCCESSFUL save, so any failure here
// never affects the save itself.
const { verifyUser, getSupabaseAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, body: JSON.stringify({ error: v.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const soId = body.so_id;
  const payload = body.payload;
  if (!soId || !payload) return { statusCode: 400, body: JSON.stringify({ error: 'so_id and payload are required' }) };

  const admin = getSupabaseAdmin();
  try {
    // Snapshot the state the current (client-orchestrated) save produced, so the
    // A/B replay can diff the future transactional RPC's output against it.
    const { data: items } = await admin.from('so_items').select('*').eq('so_id', soId);
    const itemIds = (items || []).map((i) => i.id);
    const childOf = (table) => itemIds.length
      ? admin.from(table).select('*').in('so_item_id', itemIds)
      : Promise.resolve({ data: [] });
    const [decos, picks, pos, jobs, art, firm, soRow] = await Promise.all([
      childOf('so_item_decorations'),
      childOf('so_item_pick_lines'),
      childOf('so_item_po_lines'),
      admin.from('so_jobs').select('*').eq('so_id', soId),
      admin.from('so_art_files').select('*').eq('so_id', soId),
      admin.from('so_firm_dates').select('*').eq('so_id', soId),
      admin.from('sales_orders').select('*').eq('id', soId).maybeSingle(),
    ]);
    const result = {
      sales_order: soRow.data || null,
      so_items: items || [],
      so_item_decorations: decos.data || [],
      so_item_pick_lines: picks.data || [],
      so_item_po_lines: pos.data || [],
      so_jobs: jobs.data || [],
      so_art_files: art.data || [],
      so_firm_dates: firm.data || [],
    };
    const { error } = await admin.from('so_save_audit').insert({ so_id: soId, saved_by: v.userId, payload, result });
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
