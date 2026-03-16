// Netlify serverless function to create quote requests (bypasses RLS using service role)
// This exists because the client-side anon key can't insert into quote_requests
// due to RLS policy requiring current_profile_id() which may not resolve correctly.

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sbUrl = process.env.REACT_APP_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { id, token, customer_id, contact_id, created_by } = body;
  if (!id || !token || !customer_id || !created_by) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: id, token, customer_id, created_by' }) };
  }

  try {
    const resp = await fetch(`${sbUrl}/rest/v1/quote_requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id,
        token,
        customer_id,
        contact_id: contact_id || null,
        created_by,
        status: 'pending',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[create-quote-request] Supabase error:', resp.status, errText);
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: errText }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('[create-quote-request] Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
