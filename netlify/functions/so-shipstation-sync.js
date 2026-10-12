const { verifyUser, corsHeaders } = require('./_shared');
const { isSoNumber, importSoShipment, fetchShipmentPages } = require('./_soShipStationBridge');

exports.handler = async event => {
  const reply = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  const auth = await verifyUser(event, ["orders"]);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON' }); }
  if (!body || !isSoNumber(body.soId)) return reply(400, { error: 'Valid soId required' });
  try {
    const url = new URL('https://ssapi.shipstation.com/shipments');
    url.searchParams.set('orderNumber', body.soId);
    const shipments = await fetchShipmentPages(url);
    let matched = 0, changed = 0;
    for (const shipment of shipments) {
      // The provider's orderNumber filter is not trusted as an exact match.
      if (shipment.orderNumber !== body.soId || shipment.voided) continue;
      const result = await importSoShipment(auth.admin, shipment);
      matched++;
      if (result.changed) changed++;
    }
    return reply(200, { matched, changed });
  } catch (error) {
    console.error('[so-shipstation-sync]', error.message);
    return reply(500, { error: 'Shipment import failed; please retry' });
  }
};
