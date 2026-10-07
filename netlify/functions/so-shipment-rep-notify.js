const { verifyUser, corsHeaders } = require('./_shared');
const { notifyShipmentRep } = require('./_repShipmentNotice');
exports.handler = async event => {
  const reply = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON' }); }
  if (!body || !body.soId) return reply(400, { error: 'soId required' });
  if (body.shipmentIds !== undefined && (!Array.isArray(body.shipmentIds) || !body.shipmentIds.length)) return reply(400, { error: 'shipmentIds must be a nonempty array' });
  try {
    return reply(200, await notifyShipmentRep(auth.admin, { soId: String(body.soId), shipmentIds: body.shipmentIds, preview: body.preview === true }));
  } catch (err) { return reply(409, { error: err.message }); }
};
