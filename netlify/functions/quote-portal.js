// Netlify serverless function backing the public ?quote=<token> editor.
// The token editor used to read/write quote_requests + quote_request_items directly
// with the shipped anon key, which required an always-true RLS policy (full-table
// PII enumeration for anyone holding the key). This function moves those reads and
// writes behind the service role, keyed strictly on the secret token — after the
// deploy containing it is live, migration 00182 locks both tables to staff-only.
//
// No auth header: the token IS the credential. The client never supplies a row id
// as a selector — the row is always resolved server-side from the token.

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

  const { action, token } = body;
  // Tokens are generated as ~13-16 chars of base36 (createQuoteRequest in App.js).
  // Reject anything short/absent so this endpoint can't be probed with junk.
  if (typeof token !== 'string' || token.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid token' }) };
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': sbKey,
    'Authorization': `Bearer ${sbKey}`,
  };
  const rest = (path, opts = {}) =>
    fetch(`${sbUrl}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, ...(opts.headers || {}) } });

  // Resolve the quote row from the token — the only selector we ever trust.
  const findQuote = async () => {
    const resp = await rest(
      `quote_requests?token=eq.${encodeURIComponent(token)}&select=id,status,customer_id,contact_name,contact_email,notes&limit=1`
    );
    if (!resp.ok) throw new Error(`quote lookup failed: ${resp.status} ${await resp.text()}`);
    const rows = await resp.json();
    return rows[0] || null;
  };

  try {
    if (action === 'get') {
      const qr = await findQuote();
      if (!qr) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Quote form not found or has expired.' }) };
      }
      // Customer name for the header banner (previously an anon read of customers).
      let customerName = '';
      if (qr.customer_id) {
        const cResp = await rest(`customers?id=eq.${encodeURIComponent(qr.customer_id)}&select=name&limit=1`);
        if (cResp.ok) customerName = ((await cResp.json())[0] || {}).name || '';
      }
      let items = [];
      // Don't leak items for already-finalized quotes; the client shows the
      // "submitted" screen without needing them (matches the old early return).
      if (!['submitted', 'reviewed', 'converted'].includes(qr.status)) {
        const iResp = await rest(
          `quote_request_items?quote_request_id=eq.${encodeURIComponent(qr.id)}` +
          `&select=item_type,sku,description,color,sizes,total_qty,decoration_notes,notes,sort_order&order=sort_order`
        );
        if (!iResp.ok) throw new Error(`items lookup failed: ${iResp.status} ${await iResp.text()}`);
        items = await iResp.json();
      }
      // Strip what the editor doesn't need: no token echo, no customer_id,
      // no created_by. id is returned only so the client can call quote-notify.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          quote: {
            id: qr.id,
            status: qr.status,
            contact_name: qr.contact_name,
            contact_email: qr.contact_email,
            notes: qr.notes,
            customer_name: customerName,
          },
          items,
        }),
      };
    }

    if (action === 'save') {
      const qr = await findQuote();
      if (!qr) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Quote form not found or has expired.' }) };
      }
      if (['submitted', 'reviewed', 'converted'].includes(qr.status)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'This quote request has already been submitted.' }) };
      }

      const quotePatch = body.quote || {};
      const submit = body.submit === true;
      // Whitelist: exactly the columns the old anon UPDATE wrote from the editor.
      const updates = {
        contact_name: typeof quotePatch.contact_name === 'string' ? quotePatch.contact_name : null,
        contact_email: typeof quotePatch.contact_email === 'string' ? quotePatch.contact_email : null,
        notes: typeof quotePatch.notes === 'string' ? quotePatch.notes : null,
      };
      if (submit) {
        updates.status = 'submitted';
        updates.submitted_at = new Date().toISOString();
      }

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length > 200) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Too many items' }) };
      }
      // Whitelist item columns; quote_request_id + sort_order are server-assigned.
      const itemRows = rawItems.map((it, i) => ({
        quote_request_id: qr.id,
        sort_order: i,
        item_type: it.sku ? 'sku' : 'description',
        sku: it.sku || null,
        description: it.description || null,
        color: it.color || null,
        sizes: it.sizes && typeof it.sizes === 'object' && !Array.isArray(it.sizes) ? it.sizes : {},
        total_qty: it.total_qty != null && it.total_qty !== '' ? parseInt(it.total_qty, 10) || null : null,
        decoration_notes: it.decoration_notes || null,
        notes: it.notes || null,
      }));

      // Replace items: delete + insert, like the old client did, but server-side.
      const delResp = await rest(`quote_request_items?quote_request_id=eq.${encodeURIComponent(qr.id)}`, { method: 'DELETE' });
      if (!delResp.ok) throw new Error(`items delete failed: ${delResp.status} ${await delResp.text()}`);
      if (itemRows.length) {
        const insResp = await rest('quote_request_items', {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(itemRows),
        });
        if (!insResp.ok) throw new Error(`items insert failed: ${insResp.status} ${await insResp.text()}`);
      }

      const updResp = await rest(`quote_requests?id=eq.${encodeURIComponent(qr.id)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(updates),
      });
      if (!updResp.ok) throw new Error(`quote update failed: ${updResp.status} ${await updResp.text()}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (error) {
    console.error('[quote-portal] Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
