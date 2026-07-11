// Shared coach order-history fetch — netlify/functions/teamshop-orders.js
// 'list' action (bearer coach JWT), POST { action: 'list', customer_id }.
// Single source for BOTH AccountPage.js's "Recent orders" section and the
// chat widget's "Track my order" intent (ChatWidget.js) — one fetch, no
// hand-synced copies (FABLE_SYSTEM_AUDIT rule). Throws on a non-ok response
// or network failure; callers decide how to present that.
export async function fetchTeamShopOrders(accessToken, customerId) {
  const res = await fetch('/.netlify/functions/teamshop-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'list', customer_id: customerId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return Array.isArray(json.orders) ? json.orders : [];
}
