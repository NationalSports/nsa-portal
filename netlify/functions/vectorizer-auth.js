// Lightweight function that returns Vectorizer.AI auth token
// The actual API call happens from the browser to avoid function timeout limits
const { verifyUser } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'POST' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Staff-only: this hands out the (base64) Vectorizer.AI credential — it must
  // not be obtainable by any anonymous caller.
  const v = await verifyUser(event);
  if (!v.ok) {
    return { statusCode: v.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: v.error }) };
  }

  const apiId = process.env.VECTORIZER_AI_API_ID;
  const apiSecret = process.env.VECTORIZER_AI_API_SECRET;
  if (!apiId || !apiSecret) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Vectorizer.AI API credentials not configured.' }) };
  }

  const auth = 'Basic ' + Buffer.from(apiId + ':' + apiSecret).toString('base64');
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth }),
  };
};
