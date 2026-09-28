const { getSupabaseAdmin } = require('./_shared');
const { drainShipmentEmails } = require('./_packetShipping');
// Netlify scheduled functions cannot be invoked by their public URL.
exports.handler = async () => {
  const result = await drainShipmentEmails(getSupabaseAdmin());
  if(result.failed) console.error('[packet-shipment-email] pending retries:',result.failed);
  return {statusCode:200,body:JSON.stringify(result)};
};
