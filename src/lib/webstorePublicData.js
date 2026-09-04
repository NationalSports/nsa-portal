const ENDPOINT = '/.netlify/functions/webstore-checkout';

export async function webstorePublicData(action, payload = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Webstore data request failed (HTTP ${response.status})`);
  return body;
}

export async function fetchPublicInventory(skus) {
  const unique = [...new Set((skus || []).map((sku) => String(sku || '').trim()).filter(Boolean))];
  const rows = [];
  for (let i = 0; i < unique.length; i += 400) {
    const result = await webstorePublicData('inventory', { skus: unique.slice(i, i + 400) });
    rows.push(...(result.rows || []));
  }
  return rows;
}

export async function fetchPublicStorefrontProducts(storeId, productIds) {
  const result = await webstorePublicData('storefront_products', {
    storeId,
    ...(productIds ? { productIds: [...new Set(productIds.filter(Boolean))] } : {}),
  });
  return result.rows || [];
}

