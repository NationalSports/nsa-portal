#!/usr/bin/env node
/**
 * SanMar onboarding test PO submitter (PromoStandards sendPO, TEST environment).
 *
 * Builds the exact multi-line test order SanMar asks for during onboarding — using
 * the documented Test product IDs (Guide v24.3, p.13) — and submits it to the
 * PromoStandards SendPO TEST WSDL (p.21):
 *     https://test-ws.sanmar.com:8080/promostandards/POServiceBinding
 *
 * SAFETY: dry-run by default. It prints the SOAP envelope (password redacted) and
 * does NOT contact SanMar unless you pass --submit. Credentials and the ship-to
 * address are read from env vars only — nothing secret is committed.
 *
 * Required env (TEST credentials from the SanMar Bitwarden link):
 *     SANMAR_USERNAME      your SanMar.com (Test) username  → goes in <id>
 *     SANMAR_PASSWORD      your SanMar.com (Test) password
 *
 * Ship-to (use a PRODUCTION-intent address — SanMar requires this for validation):
 *     SANMAR_SHIP_NAME       receiver first + last name (attentionTo)
 *     SANMAR_SHIP_COMPANY    company name
 *     SANMAR_SHIP_ADDRESS1   street address
 *     SANMAR_SHIP_ADDRESS2   suite / unit (optional)
 *     SANMAR_SHIP_CITY       city
 *     SANMAR_SHIP_REGION     2-char state (e.g. WA)
 *     SANMAR_SHIP_POSTAL     ZIP
 *     SANMAR_SHIP_COUNTRY    ISO country (default US)
 *     SANMAR_SHIP_EMAIL      order confirmation + shipment notification email
 *
 * Optional:
 *     SANMAR_PO_NUMBER     PO number (default: NSA-TEST-<yyyymmdd>); also via --po=XXX
 *     SANMAR_CARRIER       default UPS
 *     SANMAR_SERVICE       default Ground   (UPS: Ground, 2ND DAY, NEXTDAY, ...)
 *
 * Usage:
 *     node scripts/sanmar-test-po.js                 # dry run — prints the envelope
 *     node scripts/sanmar-test-po.js --submit        # actually submit to TEST
 *     node scripts/sanmar-test-po.js --po=NSA-1042 --submit
 *
 * On success it prints the transactionId (which contains your PO number) — email
 * that PO number to sanmarintegrations@sanmar.com to request validation.
 *
 * NOTE: settings reflect the onboarding choices — Warehouse Consolidation, no PSST,
 * UPS Ground. Adjust SANMAR_SERVICE/SANMAR_CARRIER to test other ship-vias.
 */

const PO_ENDPOINTS = {
  test: 'https://test-ws.sanmar.com:8080/promostandards/POServiceBinding',
  prod: 'https://ws.sanmar.com:8080/promostandards/POServiceBinding',
};

// SanMar documented Test product IDs (Guide v24.3, p.13). partId = Unique_Key.
const TEST_PRODUCTS = [
  { partId: '118862',  style: 'PC61',   color: 'Charcoal',       size: 'S',  qty: 2 },
  { partId: '251712',  style: 'PC61',   color: 'Brown',          size: 'S',  qty: 2 },
  { partId: '708992',  style: 'PC55',   color: 'Aquatic Blue',   size: 'S',  qty: 1 },
  { partId: '441863',  style: 'S508',   color: 'Maui Blue',      size: 'M',  qty: 1 },
  { partId: '659761',  style: 'DT5001', color: 'Kelly Green',    size: 'XS', qty: 1 },
  { partId: '1057752', style: 'T200',   color: 'White/Lime Shk', size: 'S',  qty: 1 },
];

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function contactDetails(c, withAttention) {
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

function buildEnvelope({ id, password, poNumber, orderType, carrier, service, currency, shipTo, lines }) {
  const orderDate = new Date().toISOString().slice(0, 10) + 'T00:00:00';
  const totalAmount = lines.reduce((s, l) => s + l.qty * (l.unitPrice || 0), 0).toFixed(2);
  const lineItemsXml = lines.map((l, i) => `
        <ns:LineItem>
          <ns:lineNumber>${i + 1}</ns:lineNumber>
          <shar:description>${xmlEsc([l.style, l.color, l.size].filter(Boolean).join(' '))}</shar:description>
          <ns:lineType>New</ns:lineType>
          <shar:ToleranceDetails>
            <shar:tolerance>AllowOverrun</shar:tolerance>
          </shar:ToleranceDetails>
          <ns:allowPartialShipments>false</ns:allowPartialShipments>
          <ns:lineItemTotal>${(l.qty * (l.unitPrice || 0)).toFixed(2)}</ns:lineItemTotal>
          <ns:PartArray>
            <shar:Part>
              <shar:partId>${xmlEsc(l.partId)}</shar:partId>
              <shar:customerSupplied>false</shar:customerSupplied>
              <shar:Quantity>
                <shar:uom>EA</shar:uom>
                <shar:value>${xmlEsc(l.qty)}</shar:value>
              </shar:Quantity>
            </shar:Part>
          </ns:PartArray>
        </ns:LineItem>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PO/1.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PO/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:SendPORequest>
      <shar:wsVersion>1.0.0</shar:wsVersion>
      <shar:id>${xmlEsc(id)}</shar:id>
      <shar:password>${xmlEsc(password)}</shar:password>
      <ns:PO>
        <ns:orderType>${xmlEsc(orderType)}</ns:orderType>
        <ns:orderNumber>${xmlEsc(poNumber)}</ns:orderNumber>
        <ns:orderDate>${orderDate}</ns:orderDate>
        <ns:totalAmount>${totalAmount}</ns:totalAmount>
        <ns:rush>false</ns:rush>
        <shar:currency>${xmlEsc(currency)}</shar:currency>
        <ns:OrderContactArray>
          <shar:Contact>
            <shar:contactType>Order</shar:contactType>
            ${contactDetails(shipTo, false)}
          </shar:Contact>
        </ns:OrderContactArray>
        <ns:ShipmentArray>
          <shar:Shipment>
            <shar:shipReferences>${xmlEsc(poNumber)}</shar:shipReferences>
            <shar:allowConsolidation>true</shar:allowConsolidation>
            <shar:blindShip>false</shar:blindShip>
            <shar:packingListRequired>false</shar:packingListRequired>
            <shar:FreightDetails>
              <shar:carrier>${xmlEsc(carrier)}</shar:carrier>
              <shar:service>${xmlEsc(service)}</shar:service>
            </shar:FreightDetails>
            <shar:ShipTo>
              <shar:customerPickup>false</shar:customerPickup>
              ${contactDetails(shipTo, true)}
              <shar:shipmentId>1</shar:shipmentId>
            </shar:ShipTo>
          </shar:Shipment>
        </ns:ShipmentArray>
        <ns:LineItemArray>${lineItemsXml}
        </ns:LineItemArray>
        <ns:termsAndConditions>N/A</ns:termsAndConditions>
      </ns:PO>
    </ns:SendPORequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

async function main() {
  const args = process.argv.slice(2);
  const submit = args.includes('--submit');
  const poArg = (args.find(a => a.startsWith('--po=')) || '').split('=')[1];

  const id = process.env.SANMAR_USERNAME;
  const password = process.env.SANMAR_PASSWORD;
  if (!id || !password) {
    console.error('✗ Set SANMAR_USERNAME and SANMAR_PASSWORD (TEST credentials from the SanMar Bitwarden link).');
    process.exit(1);
  }

  const shipTo = {
    attentionTo: process.env.SANMAR_SHIP_NAME,
    companyName: process.env.SANMAR_SHIP_COMPANY,
    address1:    process.env.SANMAR_SHIP_ADDRESS1,
    address2:    process.env.SANMAR_SHIP_ADDRESS2,
    city:        process.env.SANMAR_SHIP_CITY,
    region:      process.env.SANMAR_SHIP_REGION,
    postalCode:  process.env.SANMAR_SHIP_POSTAL,
    country:     process.env.SANMAR_SHIP_COUNTRY || 'US',
    email:       process.env.SANMAR_SHIP_EMAIL,
  };
  const required = ['companyName', 'address1', 'city', 'region', 'postalCode'];
  const missing = required.filter(k => !shipTo[k]);
  if (missing.length) {
    console.error(`✗ Missing ship-to env vars: ${missing.map(k => 'SANMAR_SHIP_' + ({companyName:'COMPANY',address1:'ADDRESS1',city:'CITY',region:'REGION',postalCode:'POSTAL'})[k]).join(', ')}`);
    console.error('  Use a PRODUCTION-intent address — SanMar validates onboarding against the address you will use live.');
    process.exit(1);
  }
  // SanMar uses commas as the order-file delimiter — reject any in free-text fields.
  for (const [k, v] of Object.entries(shipTo)) {
    if (typeof v === 'string' && v.includes(',')) {
      console.error(`✗ Remove the comma from SANMAR_SHIP ${k} ("${v}") — comma is SanMar's delimiter.`);
      process.exit(1);
    }
  }

  const poNumber = poArg || process.env.SANMAR_PO_NUMBER || `NSA-TEST-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const carrier = process.env.SANMAR_CARRIER || 'UPS';
  const service = process.env.SANMAR_SERVICE || 'Ground';
  // Test env pricing doesn't mirror prod; use a nominal unit price so totals reconcile.
  const lines = TEST_PRODUCTS.map(p => ({ ...p, unitPrice: 5.0 }));

  const envelope = buildEnvelope({ id, password, poNumber, orderType: 'Blank', carrier, service, currency: 'USD', shipTo, lines });

  console.log(`\nSanMar PromoStandards SendPO — ${submit ? 'LIVE SUBMIT' : 'DRY RUN'} (TEST env)`);
  console.log(`  PO number : ${poNumber}`);
  console.log(`  Ship to   : ${shipTo.companyName}, ${shipTo.address1}, ${shipTo.city} ${shipTo.region} ${shipTo.postalCode}`);
  console.log(`  Ship via  : ${carrier} ${service}`);
  console.log(`  Lines     : ${lines.length} (${lines.map(l => l.partId).join(', ')})`);
  console.log(`  Endpoint  : ${PO_ENDPOINTS.test}\n`);
  console.log('--- SOAP envelope (password redacted) ---');
  console.log(envelope.replace(xmlEsc(password), '***REDACTED***'));

  if (!submit) {
    console.log('\nDry run only — no request sent. Re-run with --submit to send to SanMar TEST.');
    return;
  }

  console.log('\nSubmitting to SanMar TEST...');
  const resp = await fetch(PO_ENDPOINTS.test, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '""' },
    body: envelope,
  });
  const xml = await resp.text();
  const transactionId = tag(xml, 'transactionId');
  const errorMessage = tag(xml, 'errorMessage') || tag(xml, 'faultstring');
  if (transactionId) {
    console.log(`\n✓ Success — transactionId: ${transactionId}`);
    console.log(`  PO number to report: ${poNumber}`);
    console.log(`\nNext: email sanmarintegrations@sanmar.com with PO ${poNumber} to request validation.`);
  } else {
    console.error(`\n✗ Submit failed (HTTP ${resp.status}): ${errorMessage || 'no transactionId returned'}`);
    console.error(xml.slice(0, 1000));
    process.exit(1);
  }
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
