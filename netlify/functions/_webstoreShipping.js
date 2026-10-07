// Public checkout uses only this narrow rate operation, never the staff's
// credential-bearing ShipStation proxy. Cart quantities and weights are read
// from priceCart's catalog-authoritative lines, not shopper-supplied values.
const { shipStationShipFrom } = require('../../src/lib/shipFrom');

const failure = (error) => ({ error, code: 'shipping_unavailable' });
const positive = (n) => n != null && n !== '' && Number.isFinite(Number(n)) && Number(n) > 0;

const { shippingConfig, validateShipping, ruleShipping } = require('../../src/lib/webstoreShippingRules.shared');

async function cartWeightOz(sb, store, lines) {
  const components = (lines || []).filter((l) => l.kind === 'bundle').flatMap((l) => l.components || []);
  const productIds = [...new Set(components.map((c) => c.product_id).filter(Boolean))];
  let catalog = [];
  if (components.length) {
    // Component weight belongs to the store catalog, including inactive items
    // retained by an active package. A bundle-parent weight would double-count.
    if (!productIds.length) return failure('A package is missing its garment reference. Please contact the store to correct its shipping setup.');
    const res = await sb.from('webstore_products').select('id,product_id,weight_oz')
      .eq('store_id', store.id).in('product_id', productIds).limit(1001);
    if (res.error) return failure('We could not load package weights. Please try again or contact the store.');
    if ((res.data || []).length > 1000) return failure('There are too many package offerings to verify the weight safely. Please contact the store to link exact garment offerings.');
    catalog = res.data || [];
  }
  let weight = 0;
  for (const line of lines || []) {
    if (line.kind !== 'bundle') {
      if (!positive(line.wp && line.wp.weight_oz)) return failure(`Shipping weight is missing for ${line.wp && (line.wp.display_name || line.wp.sku) || 'an item'}. Please contact the store before checkout.`);
      if (!positive(line.qty)) return failure('The cart quantity could not be verified. Please refresh your cart.');
      weight += Number(line.wp.weight_oz) * Number(line.qty);
      continue;
    }
    if (!(line.components || []).length) return failure('A package has no garments to ship. Please contact the store to correct its shipping setup.');
    for (const component of line.components) {
      const byId = component.webstore_product_id && catalog.find((c) => c.id === component.webstore_product_id);
      const candidates = catalog.filter((c) => c.product_id === component.product_id);
      const weights = [...new Set(candidates.map((c) => c.weight_oz).filter(positive).map(Number))];
      const unitWeight = byId ? byId.weight_oz : weights.length === 1 ? weights[0] : null;
      if (!positive(unitWeight)) return failure(`Shipping weight is missing or ambiguous for package garment ${component.sku || component.product_id || ''}. Please contact the store before checkout.`);
      if (!positive(component.qty)) return failure('A package garment quantity could not be verified. Please refresh your cart.');
      weight += Number(unitWeight) * Number(component.qty);
    }
  }
  return positive(weight) ? { weight_oz: weight } : failure('The package weight could not be verified. Please refresh your cart.');
}

async function quoteShipping(sb, store, lines, ship, freeShipping = false, subtotal = 0) {
  if (!store || store.delivery_mode !== 'ship_home') return { amount: 0, quote: null };
  const config = shippingConfig(store);
  const error = validateShipping({ ...config, mode: config.mode || 'flat' });
  if (error) return failure(error);
  const subtotalCents = Math.round(subtotal * 100);
  const itemCount = (lines || []).reduce((sum, l) => sum + (l.kind === 'bundle' ? (l.components || []).reduce((n, c) => n + Number(c.qty), 0) : Number(l.qty)), 0);
  freeShipping = !!freeShipping || (config.free_over_cents != null && subtotalCents >= config.free_over_cents);
  if (config.mode !== 'ups_live') {
    const amount = ruleShipping(config, store.flat_shipping, subtotalCents, itemCount, freeShipping);
    return { amount, quote: store.shipping_settings ? { mode: config.mode, amount, waived: freeShipping, subtotal_cents: subtotalCents, item_count: itemCount } : null };
  }
  if (!(ship && String(ship.street1 || '').trim() && String(ship.city || '').trim()
    && /^[A-Z]{2}$/i.test(String(ship.state || '').trim()) && /^\d{5}(-\d{4})?$/.test(String(ship.zip || '').trim()))) {
    return failure('Please complete a valid US shipping address to get your UPS rate.');
  }
  if (ship.country && String(ship.country).toUpperCase() !== 'US') return failure('This store currently ships within the United States.');
  if (!positive(config.package_weight_oz) || !positive(config.length_in) || !positive(config.width_in) || !positive(config.height_in)
    || !['OR', 'warehouse'].includes(config.origin_code) || !/^ups_[a-z0-9_]+$/.test(String(config.service_code || ''))) {
    return failure('UPS shipping setup is incomplete. The store needs package dimensions, packaging weight, an Orange warehouse origin, and a UPS service.');
  }
  const weighed = await cartWeightOz(sb, store, lines);
  if (weighed.error) return weighed;
  const weightOz = Math.ceil((weighed.weight_oz + Number(config.package_weight_oz)) * 10) / 10;
  const dimensions = { units: 'inches', length: Number(config.length_in), width: Number(config.width_in), height: Number(config.height_in) };
  const origin = shipStationShipFrom('warehouse');
  // Config is deliberately fail-closed: a missing rate never turns into $0 or a
  // guessed flat rate. Existing flat stores retain their explicit flat mode.
  const key = process.env.SHIPSTATION_API_KEY;
  const secret = process.env.SHIPSTATION_API_SECRET;
  if (!key || !secret) return failure('Live UPS shipping is not connected yet. Please contact the store or try again later.');
  const payload = {
    carrierCode: 'ups', serviceCode: config.service_code, packageCode: 'package',
    fromPostalCode: origin.postalCode, fromCity: origin.city, fromState: origin.state,
    toState: String(ship.state).trim().toUpperCase(), toCountry: 'US',
    toPostalCode: String(ship.zip).trim(), toCity: String(ship.city).trim(),
    weight: { value: weightOz, units: 'ounces' }, dimensions, confirmation: 'none', residential: true,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://ssapi.shipstation.com/shipments/getrates', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
      body: JSON.stringify(payload),
    });
    const rates = await response.json();
    if (!response.ok || !Array.isArray(rates)) return failure('UPS could not return a shipping rate. Please try again before paying.');
    const rate = rates.find((r) => r && r.serviceCode === config.service_code);
    if (!rate || rate.shipmentCost == null || rate.shipmentCost === '' || !Number.isFinite(Number(rate.shipmentCost))
      || Number(rate.shipmentCost) < 0 || (rate.otherCost != null && (!Number.isFinite(Number(rate.otherCost)) || Number(rate.otherCost) < 0))) {
      return failure('The selected UPS service is unavailable for this address. Please contact the store or try again.');
    }
    const amount = Math.round((Number(rate.shipmentCost) + Number(rate.otherCost || 0)) * 100) / 100;
    return { amount: freeShipping ? 0 : amount, quote: {
      carrier: 'ups', service_code: config.service_code, service_name: String(rate.serviceName || 'UPS').slice(0, 80),
      amount, waived: !!freeShipping, estimated: true, quoted_at: new Date().toISOString(),
      origin: { code: 'OR', city: origin.city, state: origin.state, zip: origin.postalCode },
      weight_oz: weightOz, dimensions,
    } };
  } catch (_) {
    return failure('UPS rates are temporarily unavailable. Please try again before paying.');
  } finally { clearTimeout(timeout); }
}

module.exports = { shippingConfig, cartWeightOz, quoteShipping };
