// Netlify serverless function to proxy SanMar SOAP API calls (avoids CORS)
// SanMar uses SOAP/XML web services for product info, inventory, and pricing
// Docs: https://www.sanmar.com/resources/electronicintegration/integrationofferings
//
// Environment variables required:
//   SANMAR_USERNAME  — your sanmar.com web user username
//   SANMAR_PASSWORD  — your sanmar.com web user password
//
// Query parameters:
//   service  — which WSDL to call: 'product' | 'inventory' | 'pricing' | 'promostandards'
//   action   — the SOAP action/method name (e.g. 'getProductInfoByStyleColorSize')
//
// Body: raw SOAP XML envelope (POST only), OR JSON with params that get wrapped automatically

const WSDL_MAP = {
  product:        'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort',
  inventory:      'https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort',
  pricing:        'https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort',
  promostandards: 'https://ws.sanmar.com:8080/promostandards/InventoryServiceBinding',
  invoice:        'https://ws.sanmar.com:8080/SanMarWebService/InvoicePort',
};

// Build a SOAP envelope for common SanMar methods
function buildSoapEnvelope(action, params, username, password) {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(String(v ?? ''))}</${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://ws.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:${action}>
      <arg0>
        <sanMarCustomerNumber>${escapeXml(username)}</sanMarCustomerNumber>
        <sanMarUserName>${escapeXml(username)}</sanMarUserName>
        <sanMarUserPassword>${escapeXml(password)}</sanMarUserPassword>
        ${paramXml}
      </arg0>
    </web:${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

exports.handler = async (event) => {
  const username = process.env.SANMAR_USERNAME;
  const password = process.env.SANMAR_PASSWORD;
  if (!username || !password) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SANMAR_USERNAME and SANMAR_PASSWORD not configured in environment variables' }) };
  }

  const service = event.queryStringParameters?.service || 'product';
  const action = event.queryStringParameters?.action || '';
  const baseUrl = WSDL_MAP[service];
  if (!baseUrl) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Unknown service "${service}". Use: ${Object.keys(WSDL_MAP).join(', ')}` }) };
  }
  if (!action) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing "action" query parameter (e.g. getProductInfoByStyleColorSize)' }) };
  }

  let soapBody;
  if (event.body) {
    try {
      // If JSON body, auto-wrap in SOAP envelope
      const parsed = JSON.parse(event.body);
      soapBody = buildSoapEnvelope(action, parsed, username, password);
    } catch {
      // Assume raw SOAP XML
      soapBody = event.body;
    }
  } else {
    soapBody = buildSoapEnvelope(action, {}, username, password);
  }

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': action,
      },
      body: soapBody,
    });

    const data = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/xml' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `SanMar API call failed: ${error.message}` }) };
  }
};
