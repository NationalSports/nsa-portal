const ACTIVE_STORE_REQUEST_STATUSES = new Set(['queued', 'building']);

function hasActiveStoreRequests(requests) {
  return (Array.isArray(requests) ? requests : []).some((request) => (
    request && ACTIVE_STORE_REQUEST_STATUSES.has(request.status)
  ));
}

function resolveStoreRequestPanelOpen(savedState, requests) {
  if (savedState === 'open') return true;
  if (savedState === 'closed') return false;
  return hasActiveStoreRequests(requests);
}

function newlyReadyStoreIds(previousRequests, nextRequests) {
  const previousById = new Map((Array.isArray(previousRequests) ? previousRequests : [])
    .filter(Boolean).map((request) => [request.id, request]));
  return [...new Set((Array.isArray(nextRequests) ? nextRequests : [])
    .filter((request) => (
      request?.status === 'ready'
      && request.store_id
      && previousById.get(request.id)?.status !== 'ready'
    ))
    .map((request) => request.store_id))];
}

function readyStoreIdsNeedingRefresh(previousRequests, nextRequests, knownStoreIds) {
  const known = knownStoreIds instanceof Set ? knownStoreIds : new Set(knownStoreIds || []);
  const transitioned = newlyReadyStoreIds(previousRequests, nextRequests);
  const missing = (Array.isArray(nextRequests) ? nextRequests : [])
    .filter((request) => request?.status === 'ready' && request.store_id && !known.has(request.store_id))
    .map((request) => request.store_id);
  return [...new Set([...transitioned, ...missing])];
}

function nextCustomerPickerIndex(currentIndex, key, resultCount) {
  if (!resultCount) return -1;
  if (key === 'ArrowDown') return Math.min(currentIndex + 1, resultCount - 1);
  if (key === 'ArrowUp') return currentIndex <= 0 ? resultCount - 1 : currentIndex - 1;
  return currentIndex;
}

function groupStoreRequestProducts(rows, limit = 8) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.id) continue;
    const sku = String(row.sku || '').trim();
    const styleSku = sku.split('-')[0] || sku;
    const key = String(row.name || styleSku || row.id).trim().toLowerCase();
    const current = groups.get(key);
    const color = String(row.color || '').trim();
    if (!current) {
      groups.set(key, {
        product_id: row.id,
        sku: styleSku,
        name: row.name || styleSku || 'Catalog item',
        brand: row.brand || '',
        image_url: row.image_front_url || '',
        colors: color ? [color] : [],
      });
    } else {
      if (!current.image_url && row.image_front_url) {
        current.image_url = row.image_front_url;
        current.product_id = row.id;
      }
      if (color && !current.colors.includes(color)) current.colors.push(color);
    }
  }
  return [...groups.values()]
    .map((item) => ({ ...item, colors: item.colors.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

function isValidOmgStoreUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:'
      && (url.hostname === 'itemorder.com' || url.hostname.endsWith('.itemorder.com'))
      && /^\/shop(?:\/|$)/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

module.exports = {
  hasActiveStoreRequests,
  resolveStoreRequestPanelOpen,
  newlyReadyStoreIds,
  readyStoreIdsNeedingRefresh,
  nextCustomerPickerIndex,
  groupStoreRequestProducts,
  isValidOmgStoreUrl,
};
