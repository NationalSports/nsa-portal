const { getSupabaseAdmin, resolveCustomerFamily } = require('./_shared');
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
exports.handler = async event => {
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { ok: false });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false }); }
  try {
    const admin = getSupabaseAdmin();
    const family = await resolveCustomerFamily(admin, body?.portal);
    if (family.error) return reply(family.notFound ? 403 : 500, { ok: false, error: 'Portal access could not be verified' });
    const ids = [...family.fam];
    const now = new Date().toISOString();
    // These server-assigned analytics fields are the only changes a visit may make.
    // Conditional updates make a retry safe without rewriting an existing open time.
    for (const table of ['estimates', 'sales_orders', 'invoices']) {
      const timestamp = table === 'invoices' ? 'email_opened_at' : 'email_viewed_at';
      const { error } = await admin.from(table).update({ email_status: 'opened', [timestamp]: now })
        .in('customer_id', ids).eq('email_status', 'sent').is(timestamp, null);
      if (error) throw error;
    }
    const { data: orders, error: orderError } = await admin.from('sales_orders').select('id').in('customer_id', ids);
    if (orderError) throw orderError;
    if (orders?.length) {
      const { error } = await admin.from('so_jobs').update({ coach_email_opened_at: now })
        .in('so_id', orders.map(row => row.id)).not('sent_to_coach_at', 'is', null).is('coach_email_opened_at', null);
      if (error) throw error;
    }
    return reply(200, { ok: true, viewed_at: now });
  } catch (_) { return reply(500, { ok: false, error: 'Visit could not be recorded' }); }
};
