// Public coach pages must never load the company-wide order book directly.
// The server owns the row/column scope; this adapter only preserves the existing
// Supabase read API while sending the portal credential in a POST body.
export const PORTAL_CORE_TABLES = new Set([
  'customers', 'customer_contacts', 'customer_credits', 'customer_credit_usage',
  'customer_promo_periods', 'customer_promo_programs', 'customer_promo_usage',
  'estimates', 'estimate_items', 'estimate_art_files', 'estimate_item_decorations',
  'sales_orders', 'so_items', 'so_jobs', 'so_art_files', 'so_item_decorations',
  'so_item_pick_lines', 'so_item_po_lines', 'so_firm_dates',
  'invoices', 'invoice_items', 'invoice_payments',
]);

export function portalCredentialFromLocation() {
  try { return new URLSearchParams(window.location.search).get('portal') || ''; }
  catch (_) { return ''; }
}

export function makePortalFetch(baseFetch = (...args) => fetch(...args), options = {}) {
  const projectUrl = options.projectUrl || process.env.REACT_APP_SUPABASE_URL || '';
  const credential = options.getCredential || portalCredentialFromLocation;
  return function portalFetch(input, init = {}) {
    let url, origin;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      origin = new URL(projectUrl).origin;
    } catch (_) { return baseFetch(input, init); }
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const portal = credential();
    if (!portal || url.origin !== origin || !PORTAL_CORE_TABLES.has(table)
      || (method !== 'GET' && method !== 'HEAD')) return baseFetch(input, init);
    const headers = new Headers(init.headers || input?.headers || {});
    return baseFetch('/.netlify/functions/portal-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: init.signal || input?.signal,
      body: JSON.stringify({
        portal, table, query: url.searchParams.toString(), method,
        accept: headers.get('accept') || 'application/json',
        prefer: headers.get('prefer') || '',
        range: headers.get('range') || undefined,
      }),
    });
  };
}
