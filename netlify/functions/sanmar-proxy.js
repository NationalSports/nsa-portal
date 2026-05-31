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
  invoice:        'https://ws.sanmar.com:8080/SanMarWebService/InvoicePort',
};

// PromoStandards Purchase Order (sendPO) bindings. Onboarding/test submissions go
// to the TEST host; production submissions to the prod host. Controlled by the
// `env` query param (defaults to 'test' so an accidental call can't ship goods).
const PO_ENDPOINTS = {
  test: 'https://test-ws.sanmar.com:8080/promostandards/POServiceBinding',
  prod: 'https://ws.sanmar.com:8080/promostandards/POServiceBinding',
};

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Render a <ContactDetails> block for OrderContact / ShipTo.
function poContactDetails(c, withAttention) {
  if (!c) return '';
  const attn = withAttention && c.attentionTo ? `\n              <shar:attentionTo>${xmlEsc(c.attentionTo)}</shar:attentionTo>` : '';
  return `<shar:ContactDetails>${attn}
              <shar:companyName>${xmlEsc(c.companyName)}</shar:companyName>
              <shar:address1>${xmlEsc(c.address1)}</shar:address1>${c.address2 ? `\n              <shar:address2>${xmlEsc(c.address2)}</shar:address2>` : ''}
              <shar:city>${xmlEsc(c.city)}</shar:city>
              <shar:region>${xmlEsc(c.region)}</shar:region>
              <shar:postalCode>${xmlEsc(c.postalCode)}</shar:postalCode>
              <shar:country>${xmlEsc(c.country || 'US')}</shar:country>${c.email ? `\n              <shar:email>${xmlEsc(c.email)}</shar:email>` : ''}
            </shar:ContactDetails>`;
}

// Build the SanMar v24.3 PromoStandards SendPO SOAP envelope from a structured
// PO payload (see src/sanmarPO.js for the shape). Credentials are injected here,
// server-side only. Mirrors buildSanMarPOSoap() — keep the two in sync.
function buildSendPOEnvelope(payload, id, password) {
  const po = payload.PO || {};
  const lineItemsXml = (po.lineItems || []).map(l => `
        <ns:LineItem>
          <ns:lineNumber>${xmlEsc(l.lineNumber)}</ns:lineNumber>
          <shar:description>${xmlEsc(l.description || l.style)}</shar:description>
          <ns:lineType>${xmlEsc(po.lineType || 'New')}</ns:lineType>
          <shar:ToleranceDetails>
            <shar:tolerance>AllowOverrun</shar:tolerance>
          </shar:ToleranceDetails>
          <ns:allowPartialShipments>false</ns:allowPartialShipments>
          <ns:lineItemTotal>${xmlEsc((l.quantity * (l.unitPrice || 0)).toFixed(2))}</ns:lineItemTotal>
          <ns:PartArray>
            <shar:Part>
              <shar:partId>${xmlEsc(l.partId)}</shar:partId>
              <shar:customerSupplied>false</shar:customerSupplied>
              <shar:Quantity>
                <shar:uom>${xmlEsc(l.uom || 'EA')}</shar:uom>
                <shar:value>${xmlEsc(l.quantity)}</shar:value>
              </shar:Quantity>
            </shar:Part>
          </ns:PartArray>
        </ns:LineItem>`).join('');
  const shp = po.shipment || {};
  const shipmentXml = `
        <ns:ShipmentArray>
          <shar:Shipment>
            <shar:shipReferences>${xmlEsc(shp.shipReferences || po.orderNumber)}</shar:shipReferences>
            <shar:allowConsolidation>${shp.allowConsolidation === false ? 'false' : 'true'}</shar:allowConsolidation>
            <shar:blindShip>${shp.blindShip ? 'true' : 'false'}</shar:blindShip>
            <shar:packingListRequired>${shp.packingListRequired ? 'true' : 'false'}</shar:packingListRequired>
            <shar:FreightDetails>
              <shar:carrier>${xmlEsc(shp.carrier || 'UPS')}</shar:carrier>
              <shar:service>${xmlEsc(shp.service || 'Ground')}</shar:service>
            </shar:FreightDetails>
            <shar:ShipTo>
              <shar:customerPickup>${shp.customerPickup ? 'true' : 'false'}</shar:customerPickup>
              ${poContactDetails(shp.shipTo, true)}
              <shar:shipmentId>${xmlEsc(shp.shipmentId || 1)}</shar:shipmentId>
            </shar:ShipTo>
          </shar:Shipment>
        </ns:ShipmentArray>`;
  const orderContactXml = po.orderContact ? `
        <ns:OrderContactArray>
          <shar:Contact>
            <shar:contactType>Order</shar:contactType>
            ${poContactDetails(po.orderContact, false)}
          </shar:Contact>
        </ns:OrderContactArray>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PO/1.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PO/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:SendPORequest>
      <shar:wsVersion>${xmlEsc(payload.wsVersion || '1.0.0')}</shar:wsVersion>
      <shar:id>${xmlEsc(id)}</shar:id>
      <shar:password>${xmlEsc(password)}</shar:password>
      <ns:PO>
        <ns:orderType>${xmlEsc(po.orderType || 'Blank')}</ns:orderType>
        <ns:orderNumber>${xmlEsc(po.orderNumber || '')}</ns:orderNumber>
        <ns:orderDate>${xmlEsc(po.orderDate || '')}</ns:orderDate>
        <ns:totalAmount>${xmlEsc(Number(po.totalAmount || 0).toFixed(2))}</ns:totalAmount>
        <ns:rush>${po.rush ? 'true' : 'false'}</ns:rush>
        <shar:currency>${xmlEsc(po.currency || 'USD')}</shar:currency>${orderContactXml}${shipmentXml}
        <ns:LineItemArray>${lineItemsXml}
        </ns:LineItemArray>
        <ns:termsAndConditions>${xmlEsc(po.termsAndConditions || 'N/A')}</ns:termsAndConditions>
      </ns:PO>
    </ns:SendPORequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

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
  const username = process.env.SANMAR_USERNAME;
  const password = process.env.SANMAR_PASSWORD;
  // Customer number is often just the numeric part (e.g. "300767" from "300767-prod")
  const customerNumber = process.env.SANMAR_CUSTOMER_NUMBER || username?.replace(/-.*$/, '') || username;
  if (!username || !password) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: 'SANMAR_USERNAME and SANMAR_PASSWORD not configured in environment variables' }) };
  }

  const service = event.queryStringParameters?.service || 'product';
  const action = event.queryStringParameters?.action || '';

  // ─── PromoStandards Purchase Order (sendPO) ───
  // service=po&action=sendPO&env=test|prod  — body is a structured PO payload
  // (built by src/sanmarPO.js). Credentials are injected here, server-side.
  // The `id` is the SanMar.com username (NOT the numeric customer number).
  if (service === 'po') {
    const env = (event.queryStringParameters?.env || 'test').toLowerCase();
    const poUrl = PO_ENDPOINTS[env];
    if (!poUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown PO env "${env}". Use test or prod.` }) };
    }
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'PO submit requires a JSON body.' }) }; }
    if (!payload.PO || !(payload.PO.lineItems || []).length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'PO payload missing PO.lineItems.' }) };
    }
    const missingPart = (payload.PO.lineItems || []).find(l => !l.partId);
    if (missingPart) {
      return { statusCode: 400, headers,
        body: JSON.stringify({ error: `Line ${missingPart.lineNumber} is missing a partId (SanMar Unique_Key). Resolve all partIds before submitting.` }) };
    }
    const envelope = buildSendPOEnvelope(payload, username, password);
    try {
      console.log(`[SanMar] sendPO → ${poUrl} (env: ${env}, order: ${payload.PO.orderNumber}, lines: ${payload.PO.lineItems.length}, user: ${username})`);
      const resp = await fetch(poUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '""' },
        body: envelope,
      });
      const xml = await resp.text();
      console.log(`[SanMar] sendPO response: ${resp.status} (${xml.length} bytes)`);
      const parsed = parseXmlToJson(xml);
      const transactionId = extractTag(xml, 'transactionId');
      const errorMessage = extractTag(xml, 'errorMessage') || (parsed.error ? parsed.faultString : null);
      if (transactionId) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, env, transactionId, orderNumber: payload.PO.orderNumber }) };
      }
      console.error(`[SanMar] sendPO failed:`, errorMessage, xml.slice(0, 800));
      return { statusCode: resp.ok ? 400 : resp.status, headers,
        body: JSON.stringify({ error: errorMessage || `SanMar sendPO failed (${resp.status})`, raw: xml.slice(0, 800) }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: `SanMar sendPO call failed: ${error.message}` }) };
    }
  }

  const baseUrl = WSDL_MAP[service];
  if (!baseUrl) {
    return { statusCode: 400, headers,
      body: JSON.stringify({ error: `Unknown service "${service}". Use: ${Object.keys(WSDL_MAP).join(', ')}` }) };
  }
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

  const doRequest = async (body) => {
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
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  };

  try {
    console.log(`[SanMar] SOAP request: ${action} → ${baseUrl} (customer: ${customerNumber}, user: ${username})`);
    let result = await doRequest(soapBody);

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
