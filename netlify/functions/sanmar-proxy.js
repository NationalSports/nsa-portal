// Netlify serverless function to proxy SanMar SOAP API calls (avoids CORS)
// SanMar uses SOAP/XML web services for product info, inventory, and pricing
// Docs: https://www.sanmar.com/resources/electronicintegration/integrationofferings
//
// Environment variables required:
//   SANMAR_USERNAME  — your sanmar.com web user username (account number e.g. 300767-prod)
//   SANMAR_PASSWORD  — your sanmar.com web user password
//
// Query parameters:
//   service  — which WSDL to call: 'product' | 'inventory' | 'pricing' | 'promostandards'
//   action   — the SOAP action/method name (e.g. 'getProductInfoByStyleColorSize')
//
// Body: JSON with params that get wrapped in SOAP envelope automatically
// Response: JSON (parsed from SOAP XML response)

const WSDL_MAP = {
  product:        'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort',
  inventory:      'https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort',
  pricing:        'https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort',
  promostandards: 'https://ws.sanmar.com:8080/promostandards/InventoryServiceBinding',
  po:             'https://ws.sanmar.com:8080/SanMarWebService/SanMarPOServicePort',
  invoice:        'https://ws.sanmar.com:8080/SanMarWebService/InvoicePort',
};

// SanMar exposes a separate sandbox host for order testing (test-ws.sanmar.com).
// Callers pass ?env=test to route order submissions there so no real order is placed.
function toTestHost(url) { return url.replace('://ws.sanmar.com', '://test-ws.sanmar.com'); }

// Build a SOAP envelope for SanMar methods that use complex-type args
// Product & Pricing services: product params in <arg0>, auth credentials in <arg1>
// Namespace: http://impl.webservice.integration.sanmar.com/
function buildSoapEnvelope(action, params, customerNumber, username, password) {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(String(v ?? ''))}</${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:${action}>
      <arg0>
        ${paramXml}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${escapeXml(customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${escapeXml(username)}</sanMarUserName>
        <sanMarUserPassword>${escapeXml(password)}</sanMarUserPassword>
      </arg1>
    </impl:${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Build a SOAP envelope for SanMar methods that use flat string args (e.g. inventory)
// Inventory service: arg0=customerNumber, arg1=username, arg2=password, arg3=style, arg4=color, arg5=size
// Note: Inventory service (SanMarWebServicePort) uses default xmlns on the action element
function buildFlatArgSoapEnvelope(action, args) {
  const argXml = args.map((val, i) => `<arg${i}>${escapeXml(String(val ?? ''))}</arg${i}>`).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
    <${action} xmlns="http://webservice.integration.sanmar.com/">
      ${argXml}
    </${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Build a SOAP envelope for PromoStandards InventoryService (document/literal).
// Per SanMar's WSDL (Inventory_v1_2_1): targetNamespace is
// http://www.promostandards.org/WSDL/InventoryService/1.0.0/ with
// elementFormDefault="qualified", so EVERY element (wrapper + children) is in
// that one namespace — there is no SharedObjects namespace. The request
// wrapper element for getInventoryLevels is literally named "Request" (the
// part element is tns:Request), NOT "GetInventoryLevelsRequest".
const PROMO_NS = 'http://www.promostandards.org/WSDL/InventoryService/1.0.0/';
const PROMO_REQUEST_ELEMENTS = {
  getInventoryLevels: 'Request',
  getFilterValues: 'GetFilterValuesRequest',
};
function buildPromoStandardsSoapEnvelope(action, params) {
  const wrapper = PROMO_REQUEST_ELEMENTS[action] || (action.charAt(0).toUpperCase() + action.slice(1) + 'Request');
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<ns:${k}>${escapeXml(String(v ?? ''))}</ns:${k}>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="${PROMO_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:${wrapper}>
      ${paramXml}
    </ns:${wrapper}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// SanMar Standard submitPO service (SanMarPOServicePort). Each line item carries
// style/color/size/quantity (inventoryKey + sizeIndex optional). Auth goes in
// arg1; the password is injected server-side. ⚠ Against the production endpoint
// this places a REAL order — callers gate this behind a Test/Live toggle.
// NOTE: SanMar uses commas as a delimiter in order files, so commas are stripped
// from every field per their integration guide.
function noComma(s) { return String(s ?? '').replace(/,/g, ' '); }
function buildSanMarSubmitPOEnvelope(po, customerNumber, username, password) {
  const f = v => escapeXml(noComma(v));
  const details = (po.items || []).map(it => `
        <webServicePoDetailList>
          <inventoryKey>${f(it.inventoryKey || '')}</inventoryKey>
          <sizeIndex>${f(it.sizeIndex || '')}</sizeIndex>
          <style>${f(it.style || '')}</style>
          <color>${f(it.color || '')}</color>
          <size>${f(it.size || '')}</size>
          <quantity>${f(it.quantity ?? 0)}</quantity>
          <whseNo></whseNo>
        </webServicePoDetailList>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:submitPO>
      <arg0>
        <attention>${f(po.attention || '')}</attention>
        <notes></notes>
        <poNum>${f(po.poNum || '')}</poNum>
        <shipTo>${f(po.shipTo || '')}</shipTo>
        <shipAddress1>${f(po.shipAddress1 || '')}</shipAddress1>
        <shipAddress2>${f(po.shipAddress2 || '')}</shipAddress2>
        <shipCity>${f(po.shipCity || '')}</shipCity>
        <shipState>${f(po.shipState || '')}</shipState>
        <shipZip>${f(po.shipZip || '')}</shipZip>
        <shipMethod>${f(po.shipMethod || 'UPS')}</shipMethod>
        <shipEmail>${f(po.shipEmail || '')}</shipEmail>
        <residence>${f(po.residence || 'N')}</residence>
        <department></department>${details}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${escapeXml(customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${escapeXml(username)}</sanMarUserName>
        <sanMarUserPassword>${escapeXml(password)}</sanMarUserPassword>
      </arg1>
    </web:submitPO>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Simple XML-to-JSON parser for SOAP responses (no external deps)
// Extracts the SOAP Body content and converts elements to nested objects
function parseXmlToJson(xml) {
  // Strip SOAP envelope — extract Body content (handle any namespace prefix)
  const bodyMatch = xml.match(/<(?:[\w-]+:)?Body[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Body>/i);
  const bodyXml = bodyMatch ? bodyMatch[1] : xml;

  // Check for SOAP Fault
  const faultMatch = bodyXml.match(/<(?:[\w-]+:)?Fault[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Fault>/i);
  if (faultMatch) {
    const faultStr = faultMatch[1];
    const faultCode = extractTag(faultStr, 'faultcode') || extractTag(faultStr, 'faultCode');
    const faultString = extractTag(faultStr, 'faultstring') || extractTag(faultStr, 'faultString');
    return { error: true, faultCode, faultString };
  }

  const parsed = parseElement(bodyXml);

  // Unwrap SOAP response wrapper (e.g. {getProductInfoByStyleColorSizeResponse: {items:[...]}})
  const keys = Object.keys(parsed);
  if (keys.length === 1 && typeof parsed[keys[0]] === 'object') {
    return parsed[keys[0]];
  }

  return parsed;
}

// Extract text content of a single XML tag
function extractTag(xml, tag) {
  const re = new RegExp('<(?:[\\w]+:)?' + tag + '[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?' + tag + '>', 'i');
  const m = xml.match(re);
  return m ? unescapeXml(m[1].trim()) : null;
}

// Recursively parse XML elements into JSON
function parseElement(xml) {
  const result = {};
  // Match all child elements (handles namespace prefixes)
  const tagRe = /<([\w]+:)?([\w]+)([^>]*)>([\s\S]*?)<\/\1?\2>/g;
  let match;
  let hasChildren = false;

  while ((match = tagRe.exec(xml)) !== null) {
    hasChildren = true;
    const tagName = match[2];
    const content = match[4];

    // Check if content has child elements
    const hasSubElements = /<[\w:]+[^>]*>/.test(content);
    const value = hasSubElements ? parseElement(content) : unescapeXml(content.trim());

    // Handle repeated elements → array
    if (result[tagName] !== undefined) {
      if (!Array.isArray(result[tagName])) result[tagName] = [result[tagName]];
      result[tagName].push(value);
    } else {
      result[tagName] = value;
    }
  }

  // SanMar wraps responses in <return> which may contain <listResponse> elements
  if (result.return !== undefined) {
    // Single <return> wrapping <listResponse> items (product/inventory pattern) → unwrap
    if (!Array.isArray(result.return) && result.return.items) {
      return result.return;
    }
    // Multiple <return> elements → treat each as an item
    return { items: Array.isArray(result.return) ? result.return : [result.return] };
  }

  if (result.listResponse !== undefined) {
    return { items: Array.isArray(result.listResponse) ? result.listResponse : [result.listResponse] };
  }

  return hasChildren ? result : {};
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  let username = process.env.SANMAR_USERNAME;
  let password = process.env.SANMAR_PASSWORD;
  // Customer number is often just the numeric part (e.g. "300767" from "300767-prod")
  let customerNumber = process.env.SANMAR_CUSTOMER_NUMBER || username?.replace(/-.*$/, '') || username;
  if (!username || !password) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: 'SANMAR_USERNAME and SANMAR_PASSWORD not configured in environment variables' }) };
  }

  const service = event.queryStringParameters?.service || 'product';
  const action = event.queryStringParameters?.action || '';
  const useTest = event.queryStringParameters?.env === 'test';
  // SanMar's sandbox (test-ws) is a separate account and rejects production
  // credentials. If dedicated test creds are configured, use them for test
  // submissions; otherwise fall back to prod creds (which only work against prod).
  if (useTest && process.env.SANMAR_TEST_USERNAME && process.env.SANMAR_TEST_PASSWORD) {
    username = process.env.SANMAR_TEST_USERNAME;
    password = process.env.SANMAR_TEST_PASSWORD;
    customerNumber = process.env.SANMAR_TEST_CUSTOMER_NUMBER || username?.replace(/-.*$/, '') || username;
  }
  let baseUrl = WSDL_MAP[service];
  if (!baseUrl) {
    return { statusCode: 400, headers,
      body: JSON.stringify({ error: `Unknown service "${service}". Use: ${Object.keys(WSDL_MAP).join(', ')}` }) };
  }
  // Order submissions can target SanMar's sandbox host for safe format validation.
  if (useTest && service === 'po') baseUrl = toTestHost(baseUrl);
  if (!action) {
    return { statusCode: 400, headers,
      body: JSON.stringify({ error: 'Missing "action" query parameter (e.g. getProductInfoByStyleColorSize)' }) };
  }

  let soapBody;
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      if (service === 'promostandards') {
        // getInventoryLevels Request schema enforces this exact <sequence>:
        // wsVersion, id, password, productID, productIDtype (productIDtype is
        // required). Note the casing — productID (capital D) and productIDtype.
        // SanMar's PromoStandards `id` is the web-service username (NOT the
        // numeric customer number used by the legacy SOAP services). We try the
        // username first and fall back to the customer number on auth failure.
        const { wsVersion, id, password: pwd, productId, productID, productIdType, productIDtype } = parsed;
        const promoParams = {
          wsVersion: wsVersion || '1.2.1',
          id: id || username,
          password: pwd || password,
          productID: productID || productId || '',
          productIDtype: productIDtype || productIdType || 'Supplier',
        };
        soapBody = buildPromoStandardsSoapEnvelope(action, promoParams);
      } else if (service === 'po') {
        // submitPO — client sends { poNum, ship*, items:[{style,color,size,quantity}] }.
        soapBody = buildSanMarSubmitPOEnvelope(parsed, customerNumber, username, password);
      } else if (service === 'inventory') {
        // Inventory service uses flat string args: arg0=custNum, arg1=user, arg2=pass, arg3=style, arg4=color, arg5=size
        soapBody = buildFlatArgSoapEnvelope(action, [
          customerNumber, username, password,
          parsed.style || '', parsed.color || '', parsed.size || ''
        ]);
      } else {
        soapBody = buildSoapEnvelope(action, parsed, customerNumber, username, password);
      }
    } catch {
      soapBody = event.body;
    }
  } else {
    if (service === 'promostandards') {
      soapBody = buildPromoStandardsSoapEnvelope(action, { id: customerNumber, password });
    } else if (service === 'inventory') {
      soapBody = buildFlatArgSoapEnvelope(action, [customerNumber, username, password, '', '', '']);
    } else {
      soapBody = buildSoapEnvelope(action, {}, customerNumber, username, password);
    }
  }

  const doRequest = async (body, opts = {}) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '""' },
      body,
    });
    const xml = await response.text();
    console.log(`[SanMar] SOAP response: ${response.status} (${xml.length} bytes)`);
    if (!response.ok) {
      const parsed = parseXmlToJson(xml);
      console.error(`[SanMar] SOAP error: ${parsed.faultString || response.status}`, xml.slice(0, 800));
      return { statusCode: response.status, headers,
        body: JSON.stringify({ error: parsed.faultString || `SanMar API error: ${response.status}`, raw: xml.slice(0, 800) }) };
    }
    const parsed = parseXmlToJson(xml);
    if (parsed.error) {
      // Return the fault info so caller can decide to retry
      return { fault: true, parsed, xml };
    }
    if (parsed.errorOccured === 'true' || parsed.errorOccurred === 'true') {
      console.error(`[SanMar] API error:`, parsed.message);
      return { statusCode: 400, headers,
        body: JSON.stringify({ error: parsed.message || 'SanMar returned an error', ...parsed }) };
    }
    // For PO submission, attach the raw XML so the client can confirm/debug the
    // first real order (PromoStandards sendPO responses vary in shape per supplier).
    if (opts.includeRaw && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsed._rawXml = xml.slice(0, 4000);
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  };

  try {
    console.log(`[SanMar] SOAP request: ${action} → ${baseUrl} (customer: ${customerNumber}, user: ${username})`);
    let result = await doRequest(soapBody, { includeRaw: service === 'po' });

    // PromoStandards returns a 200 with an errorMessage (not a SOAP fault) when
    // the id/password combo is wrong. The `id` can be either the web-service
    // username or the numeric customer number depending on the account, so if
    // the first attempt (username) fails auth, retry once with the other value.
    if (service === 'promostandards' && result.statusCode === 200) {
      let errMsg = '';
      try { errMsg = (JSON.parse(result.body || '{}').errorMessage) || ''; } catch {}
      if (/auth|credential/i.test(errMsg)) {
        const parsed = JSON.parse(event.body || '{}');
        const firstId = parsed.id || username;
        const altId = firstId === username ? customerNumber : username;
        console.warn(`[SanMar] PromoStandards auth failed with id="${firstId}", retrying with id="${altId}"`);
        const altBody = buildPromoStandardsSoapEnvelope(action, {
          wsVersion: parsed.wsVersion || '1.2.1',
          id: altId,
          password: parsed.password || password,
          productID: parsed.productID || parsed.productId || '',
          productIDtype: parsed.productIDtype || parsed.productIdType || 'Supplier',
        });
        const altResult = await doRequest(altBody);
        let altErr = '';
        try { altErr = (JSON.parse(altResult.body || '{}').errorMessage) || ''; } catch {}
        if (altResult.statusCode === 200 && !/auth|credential/i.test(altErr)) result = altResult;
      }
    }

    if (result.fault && service === 'inventory') {
      const faultStr = result.parsed.faultString || '';
      console.warn(`[SanMar] Inventory fault: ${faultStr}, retrying with alternate namespace...`);
      // Try without namespace (bare element)
      const parsed = JSON.parse(event.body || '{}');
      const args = [customerNumber, username, password, parsed.style || '', parsed.color || '', parsed.size || ''];
      const argXml = args.map((val, i) => `<arg${i}>${escapeXml(String(val ?? ''))}</arg${i}>`).join('\n      ');
      const altBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:${action}>
      ${argXml}
    </impl:${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
      result = await doRequest(altBody);
      if (result.fault) {
        console.error(`[SanMar] Inventory retry also failed:`, result.parsed.faultString);
        return { statusCode: 500, headers,
          body: JSON.stringify({ error: result.parsed.faultString || 'SOAP Fault', faultCode: result.parsed.faultCode }) };
      }
    } else if (result.fault) {
      console.error(`[SanMar] SOAP fault:`, result.parsed.faultCode, result.parsed.faultString);
      return { statusCode: 500, headers,
        body: JSON.stringify({ error: result.parsed.faultString || 'SOAP Fault', faultCode: result.parsed.faultCode }) };
    }

    return result;
  } catch (error) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: `SanMar API call failed: ${error.message}` }) };
  }
};
