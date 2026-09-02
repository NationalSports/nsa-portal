// Staff-authenticated local reconciliation after ShipStation confirms one label
// was voided. The database marker is idempotent, so this endpoint can be retried
// after a network failure without touching sibling shipments.

const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { reconcileOrderTracker, reconcileOrderCosts } = require('./shipstation-webhook');

function response(statusCode, body) {
  return { statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'POST only' });
  let auth;
  try { auth = await verifyUser(event); }
  catch (_) { return response(500, { ok: false, error: 'Authentication check failed' }); }
  if (!auth.ok) return response(auth.status, { ok: false, error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { ok: false, error: 'Invalid JSON' }); }
  const orderId = String(body.order_id || '').trim();
  const shipmentId = String(body.shipment_id || '').trim();
  if (!orderId || !shipmentId) return response(400, { ok: false, error: 'order_id and shipment_id required' });

  const sb = getSupabaseAdmin();
  try {
    const { data: order, error: orderError } = await sb.from('webstore_orders').select('*').eq('id', orderId).maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) return response(404, { ok: false, error: 'Order not found' });

    const { data: marked, error: markError } = await sb.rpc('mark_webstore_shipment_voided', {
      p_order_id: order.id,
      p_ss_shipment_id: shipmentId,
      p_actor: auth.teamMemberId || auth.userId || null,
    });
    if (markError) throw new Error(markError.message);
    if (!marked || !marked.ok) return response(409, { ok: false, error: marked?.reason || 'Shipment was not recorded' });

    await reconcileOrderTracker(sb, order, null);
    await reconcileOrderCosts(sb, order);
    const { data: active, error: activeError } = await sb.from('webstore_shipments')
      .select('ss_shipment_id').eq('order_id', order.id).is('voided_at', null)
      .order('created_at', { ascending: false }).limit(1);
    if (activeError) throw new Error(activeError.message);
    const { error: metaError } = await sb.from('webstore_orders').update({
      shipstation_shipment_id: active && active[0] ? active[0].ss_shipment_id : null,
      label_data: null,
    }).eq('id', order.id);
    if (metaError) throw new Error(metaError.message);

    return response(200, {
      ok: true,
      replayed: Boolean(marked.replayed),
      active_shipment_id: active && active[0] ? active[0].ss_shipment_id : null,
    });
  } catch (error) {
    console.error('[webstore-shipment-void-record] failed:', error.message || error);
    return response(500, { ok: false, error: 'Label was voided in ShipStation, but local reconciliation needs retry' });
  }
};
