const { getSupabaseAdmin } = require('./_shared');
const { drainRepShipmentEmails } = require('./_repShipmentNotice');
exports.handler = async () => {
  const result = await drainRepShipmentEmails(getSupabaseAdmin());
  return { statusCode: 200, body: JSON.stringify(result) };
};
