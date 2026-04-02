// Netlify serverless function — returns all DST files for Barudan machine sync
// Called by the shop floor sync script to keep the local design folder up to date
//
// GET /.netlify/functions/dst-sync
//   → returns JSON array of { name, url, so_id, art_name, updated_at }
//
// GET /.netlify/functions/dst-sync?since=2026-03-01T00:00:00Z
//   → returns only DST files updated after the given timestamp (incremental sync)
//
// Requires: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Simple shared secret to prevent unauthorized access
  const authHeader = event.headers['authorization'] || '';
  const expectedToken = process.env.DST_SYNC_TOKEN;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const sbUrl = process.env.REACT_APP_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    // Query only APPROVED embroidery art files that have prod_files
    // DST files only appear on the Barudan when artwork is approved
    let queryUrl = `${sbUrl}/rest/v1/so_art_files?select=id,so_id,name,deco_type,prod_files,status,updated_at&deco_type=eq.embroidery&prod_files=neq.[]&status=eq.approved`;
    const since = event.queryStringParameters?.since;
    if (since) {
      queryUrl += `&updated_at=gte.${since}`;
    }

    const resp = await fetch(queryUrl, {
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: 'Supabase query failed', detail: errText }) };
    }

    const artFiles = await resp.json();

    // Extract DST files from prod_files arrays
    const dstFiles = [];
    for (const af of artFiles) {
      const prodFiles = af.prod_files || [];
      for (const f of prodFiles) {
        const name = typeof f === 'string' ? f : (f?.name || '');
        const url = typeof f === 'string' ? f : (f?.url || '');
        if (name.toLowerCase().endsWith('.dst') && url) {
          dstFiles.push({
            name,
            url,
            so_id: af.so_id,
            art_name: af.name || '',
            updated_at: af.updated_at || '',
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, count: dstFiles.length, files: dstFiles }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
