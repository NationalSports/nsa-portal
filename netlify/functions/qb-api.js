// Netlify serverless function — QuickBooks Online API proxy
// Proxies requests from the frontend to QBO REST API
// Handles: customers, invoices, bills, inventory adjustments, purchase orders, company info
const https = require('https');

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

const QB_BASE = 'https://quickbooks.api.intuit.com'; // Production
const QB_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com'; // Sandbox

function qbRequest(method, path, accessToken, body, useSandbox) {
  const base = useSandbox ? QB_SANDBOX : QB_BASE;
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(origin), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { action, access_token, realm_id, sandbox } = body;

  if (!access_token || !realm_id) {
    return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ error: 'access_token and realm_id required' }) };
  }

  const basePath = `/v3/company/${realm_id}`;

  try {
    // ── COMPANY INFO ──
    if (action === 'company_info') {
      const res = await qbRequest('GET', `${basePath}/companyinfo/${realm_id}`, access_token, null, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── QUERY (generic) ──
    if (action === 'query') {
      const { query } = body; // e.g. "SELECT * FROM Customer MAXRESULTS 1000"
      if (!query) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'query required' }) };
      const res = await qbRequest('GET', `${basePath}/query?query=${encodeURIComponent(query)}`, access_token, null, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE CUSTOMER ──
    if (action === 'upsert_customer') {
      const { customer } = body;
      // customer: { DisplayName, CompanyName, PrimaryEmailAddr, PrimaryPhone, BillAddr, etc. }
      // If customer.Id exists, it's an update (must include SyncToken)
      const res = await qbRequest('POST', `${basePath}/customer`, access_token, customer, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE INVOICE ──
    if (action === 'upsert_invoice') {
      const { invoice } = body;
      // invoice: { CustomerRef, Line[], TxnDate, DocNumber, etc. }
      const res = await qbRequest('POST', `${basePath}/invoice`, access_token, invoice, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE SALES RECEIPT (for orders as totals) ──
    if (action === 'upsert_salesreceipt') {
      const { salesreceipt } = body;
      const res = await qbRequest('POST', `${basePath}/salesreceipt`, access_token, salesreceipt, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE ESTIMATE (for sales orders) ──
    if (action === 'upsert_estimate') {
      const { estimate } = body;
      const res = await qbRequest('POST', `${basePath}/estimate`, access_token, estimate, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE BILL (vendor bill) ──
    if (action === 'upsert_bill') {
      const { bill } = body;
      // bill: { VendorRef, Line[], TxnDate, DocNumber, etc. }
      const res = await qbRequest('POST', `${basePath}/bill`, access_token, bill, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── UPLOAD BILL ATTACHMENT ──
    if (action === 'upload_attachment') {
      const { entity_type, entity_id, file_name, file_base64, content_type } = body;
      // QBO attachable upload — two-step: create attachable metadata, then upload binary
      // Step 1: create attachable reference
      const attachable = {
        AttachableRef: [{ EntityRef: { type: entity_type || 'Bill', value: entity_id }, IncludeOnSend: false }],
        FileName: file_name,
        ContentType: content_type || 'application/pdf',
      };
      const metaRes = await qbRequest('POST', `${basePath}/attachable`, access_token, attachable, sandbox);
      if (metaRes.status !== 200 || !metaRes.data?.Attachable?.Id) {
        return { statusCode: metaRes.status, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Attachable creation failed', details: metaRes.data }) };
      }
      const attachableId = metaRes.data.Attachable.Id;

      // Step 2: upload binary content
      const uploadBase = sandbox ? QB_SANDBOX : QB_BASE;
      const uploadUrl = `${uploadBase}${basePath}/upload`;
      const boundary = '----QBBoundary' + Date.now();
      const fileBuffer = Buffer.from(file_base64, 'base64');

      const parts = [];
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_0"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({
        AttachableRef: [{ EntityRef: { type: entity_type || 'Bill', value: entity_id } }],
        FileName: file_name, ContentType: content_type || 'application/pdf',
      })}\r\n`);
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file_content_0"; filename="${file_name}"\r\nContent-Type: ${content_type || 'application/pdf'}\r\n\r\n`);

      const bodyParts = Buffer.concat([
        Buffer.from(parts[0]),
        Buffer.from(parts[1]),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const uploadRes = await new Promise((resolve, reject) => {
        const parsed = new URL(uploadUrl);
        const options = {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + access_token,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Accept': 'application/json',
            'Content-Length': bodyParts.length,
          },
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, data }); }
          });
        });
        req.on('error', reject);
        req.write(bodyParts);
        req.end();
      });

      return { statusCode: uploadRes.status, headers: corsHeaders(origin), body: JSON.stringify({ attachableId, upload: uploadRes.data }) };
    }

    // ── CREATE PURCHASE ORDER ──
    if (action === 'upsert_purchase_order') {
      const { purchase_order } = body;
      const res = await qbRequest('POST', `${basePath}/purchaseorder`, access_token, purchase_order, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE VENDOR ──
    if (action === 'upsert_vendor') {
      const { vendor } = body;
      const res = await qbRequest('POST', `${basePath}/vendor`, access_token, vendor, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── CREATE/UPDATE ITEM (for inventory) ──
    if (action === 'upsert_item') {
      const { item } = body;
      // item: { Name, Type: 'Inventory'|'NonInventory'|'Service', IncomeAccountRef, ExpenseAccountRef, QtyOnHand, etc. }
      const res = await qbRequest('POST', `${basePath}/item`, access_token, item, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── INVENTORY ADJUSTMENT ──
    if (action === 'inventory_adjustment') {
      const { adjustment } = body;
      // adjustment: { Line: [{ ItemRef, QtyDiff }], AdjustmentAccountRef }
      // Note: QBO uses InventoryAdjustment entity — create one per adjustment
      const res = await qbRequest('POST', `${basePath}/inventoryadjustment`, access_token, adjustment, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── RECORD PAYMENT ──
    if (action === 'upsert_payment') {
      const { payment } = body;
      const res = await qbRequest('POST', `${basePath}/payment`, access_token, payment, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    // ── READ SINGLE ENTITY ──
    if (action === 'read') {
      const { entity, id } = body;
      const validEntities = ['customer', 'vendor', 'invoice', 'bill', 'purchaseorder', 'item', 'payment', 'account'];
      if (!validEntities.includes(entity)) {
        return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Invalid entity: ' + entity }) };
      }
      const res = await qbRequest('GET', `${basePath}/${entity}/${id}`, access_token, null, sandbox);
      return { statusCode: res.status, headers: corsHeaders(origin), body: JSON.stringify(res.data) };
    }

    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ error: 'QB API error: ' + err.message }) };
  }
};
