// Tests for click-client.mjs against the fake CLICK API. Asserts the properties that make Phase 2
// worth doing (one add call, one sizes call, correct technical-size mapping, verified write) and
// the ones that keep it safe (nothing submits, no silent quantity loss).
//
//   node click/test/client.spec.mjs

import { spawn } from 'node:child_process';
import { ClickClient, ClickError, _internal } from '../click-client.mjs';

const PORT = 4712;
const BASE = 'http://127.0.0.1:' + PORT;
const ACCOUNT = '0000270384';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond ? '' : '  — ' + detail));
  if (!cond) failures++;
};

const fake = spawn(process.execPath, [new URL('./fake-click.mjs', import.meta.url).pathname, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const calls = async () => (await fetch(BASE + '/__calls').catch(() => null)) ; // not exposed; counted client-side below

try {
  void calls;
  const seen = [];
  const countingFetch = async (url, init) => {
    seen.push({ method: init?.method || 'GET', path: new URL(url).pathname, body: init?.body ? JSON.parse(init.body) : null });
    return fetch(url, init);
  };
  const client = new ClickClient({ baseUrl: BASE, account: ACCOUNT, salesOrg: '6040', soldTo: '6017364000', fetchImpl: countingFetch });

  // ---- size-label canonicalisation (the mapping that stops 15 pcs becoming 14) ----
  check('size aliases canonicalise', _internal.canonSize('sm') === 'S' && _internal.canonSize('MD') === 'M'
    && _internal.canonSize('XXL') === '2XL' && _internal.canonSize('One Size') === 'OSFA',
    'got ' + [_internal.canonSize('sm'), _internal.canonSize('MD'), _internal.canonSize('XXL'), _internal.canonSize('One Size')].join(','));

  // ---- cart id discovery ----
  const cartId = await client.currentCartId();
  check('cart id read from the storefront call', cartId === '26182980', 'got ' + cartId);

  // ---- the main path: two articles, several sizes, one PO ----
  const report = await client.fillCart({
    cartId,
    poNumber: 'PO 57073 SFVB',
    requestedDeliveryDate: '2026-08-14',
    lines: [
      { sku: 'KA3126', sizes: { S: 2, M: 9, L: 2, XL: 2 } },
      { sku: 'IN6148', sizes: { M: 3, L: 1 } },
    ],
  });

  const addCalls = seen.filter((c) => c.path.endsWith('/materials/add'));
  const sizeCalls = seen.filter((c) => c.path.endsWith('/materials/sizes'));
  check('ONE add call for both articles', addCalls.length === 1 && addCalls[0].body.length === 2,
    addCalls.length + ' add call(s), body ' + JSON.stringify(addCalls[0]?.body));
  check('ONE sizes call for all six rows', sizeCalls.length === 1 && sizeCalls[0].body.length === 6,
    sizeCalls.length + ' sizes call(s), ' + (sizeCalls[0]?.body?.length ?? 0) + ' rows');
  check('labels mapped to technical codes', JSON.stringify(sizeCalls[0]?.body?.filter((r) => r.materialNumber === 'KA3126').map((r) => r.technicalSize)) === JSON.stringify(['210', '230', '250', '270']),
    JSON.stringify(sizeCalls[0]?.body?.map((r) => r.materialNumber + ':' + r.technicalSize)));
  check('every row carries the delivery date', (sizeCalls[0]?.body || []).every((r) => r.requestedDeliveryDate === '2026-08-14'), 'missing requestedDeliveryDate');
  // KA3126 2+9+2+2 = 15 (the captured run's line) plus IN6148 3+1 = 4.
  check('quantities preserved end to end (19 pcs)', (sizeCalls[0]?.body || []).reduce((a, r) => a + r.quantity, 0) === 19,
    'sent ' + (sizeCalls[0]?.body || []).reduce((a, r) => a + r.quantity, 0));
  check('PO number sent as personalReference', seen.some((c) => c.method === 'PATCH' && c.body?.personalReference === 'PO 57073 SFVB'), 'no PATCH with personalReference');
  check('report verifies clean', report.ok === true && report.mismatches.length === 0 && report.unresolved.length === 0,
    JSON.stringify({ ok: report.ok, mismatches: report.mismatches, unresolved: report.unresolved }));
  check('nothing was submitted', !seen.some((c) => /submit|checkout|placeOrder/i.test(c.path)), 'a submit-ish call was made');

  // ---- an unmappable size must be reported, never dropped ----
  const client2 = new ClickClient({ baseUrl: BASE, account: ACCOUNT, salesOrg: '6040', soldTo: '6017364000' });
  const built = await client2.buildSizeRows({ cartId, requestedDeliveryDate: '2026-08-14', lines: [{ sku: 'KA3126', sizes: { YXL: 5 } }] });
  check('unknown size label is reported', built.rows.length === 0 && built.problems.length === 1 && /YXL/.test(built.problems[0]),
    JSON.stringify(built));

  // ---- an unavailable size surfaces as a portal error, not a silent success ----
  let unavailErr = null;
  try {
    await client2.setSizes(cartId, [{ materialNumber: 'KA3126', technicalSize: '290', quantity: 1, requestedDeliveryDate: '2026-08-14' }]);
  } catch (e) { unavailErr = e; }
  check('unavailable size raises a named error', unavailErr instanceof ClickError && /not available/i.test(unavailErr.body || ''),
    String(unavailErr && (unavailErr.body || unavailErr.message)).slice(0, 120));

  // ---- a session rejection is explained, not left as a bare 403 ----
  const denyClient = new ClickClient({ baseUrl: BASE, account: ACCOUNT, fetchImpl: async () => new Response('denied', { status: 403 }) });
  let authErr = null;
  try { await denyClient.currentCartId(); } catch (e) { authErr = e; }
  check('403 explains the session/Akamai case', authErr instanceof ClickError && /session|Akamai/i.test(authErr.message), String(authErr && authErr.message).slice(0, 140));
} finally {
  fake.kill();
}

console.log(failures ? '\n❌ click client: ' + failures + ' failure(s)' : '\n✅ click client: all checks passed');
process.exit(failures ? 1 : 0);
