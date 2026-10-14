// Loads one coach portal's data: the team's rows from netlify/functions/coach-portal-data.js,
// assembled by the same _dbLoad the staff app boots with (its `source` option), so orders,
// estimates and invoices come out in exactly the shape CoachPortal has always received.
import { _dbLoad } from './dbEngine';
import { requestCoachPortalData, takePrefetchedCoachPortalData } from './coachPortalPrefetch';

// → {status:'ok', customer, customers, sos, ests, invs, reps, products, appState}
//   | {status:'not_found'} | {status:'ambiguous'}; throws on a failed load.
export async function loadCoachPortal(alphaTag, fetchImpl = fetch) {
  const res = await (takePrefetchedCoachPortalData(alphaTag) || requestCoachPortalData(alphaTag, fetchImpl));
  const body = await res.json().catch(() => null);
  if (res.status === 404) return { status: 'not_found' };
  if (res.status === 409) return { status: 'ambiguous' };
  if (!res.ok || !body || !body.tables) throw new Error((body && body.error) || 'HTTP ' + res.status);
  const tables = body.tables;
  const d = await _dbLoad({ fullState: true, source: (table) => ({ data: tables[table] || [] }) });
  if (!d) throw new Error('Could not assemble portal data');
  const customer = d.customers.find((c) => c.id === body.customerId);
  if (!customer) throw new Error('Portal customer missing from response');
  return {
    status: 'ok', customer, customers: d.customers, sos: d.sales_orders, ests: d.estimates, invs: d.invoices,
    reps: d.team, products: d.products, appState: d.appState || {},
  };
}
