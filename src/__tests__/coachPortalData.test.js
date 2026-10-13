/* Coach portal scoped load: netlify/functions/coach-portal-data.js + src/lib/coachPortalData.js.
 *
 * The portal used to boot the staff App as the anon role, load EVERY customer's documents, and
 * filter them in the browser. It now asks the server for one team's rows and assembles them with
 * the same _dbLoad. These tests run both paths over one in-memory database and require:
 *   - the scoped path renders exactly the documents the old path rendered for that team,
 *   - nothing belonging to another customer — and no staff secrets or costs — is returned,
 *   - the alpha-tag rule matches App.js's old ?portal= gate (trimmed, case-insensitive, unique),
 *   - paging past 1000 rows and chunked id lists keep every row, in query order.
 */

const mockState = { tables: {}, fromCalls: 0 };
jest.mock('@supabase/supabase-js', () => {
  const cmp = (a, b) => { const an = a == null, bn = b == null; if (an || bn) return an === bn ? 0 : (an ? 1 : -1); if (typeof a === 'number' && typeof b === 'number') return a - b; return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; };
  const makeBuilder = (table) => {
    const st = { cols: '*', filters: [], orders: [], range: null, limit: null };
    const b = {
      select: (cols) => { st.cols = cols || '*'; return b; },
      in: (c, v) => { st.filters.push((r) => v.includes(r[c])); return b; },
      eq: (c, v) => { st.filters.push((r) => r[c] === v); return b; },
      ilike: (c, p) => { const needle = p.replace(/%/g, '').toLowerCase(); st.filters.push((r) => String(r[c] || '').toLowerCase().includes(needle)); return b; },
      not: (c, op, v) => {
        if (op === 'in') { const vals = v.replace(/[()"]/g, '').split(','); st.filters.push((r) => !vals.includes(r[c])); }
        if (op === 'like') { const pre = v.replace(/\*.*$/, ''); st.filters.push((r) => !String(r[c]).startsWith(pre)); }
        return b;
      },
      or: () => b,
      order: (c, o) => { st.orders.push([c, !(o && o.ascending === false)]); return b; },
      range: (from, to) => { st.range = [from, to]; return b; },
      limit: (n) => { st.limit = n; return b; },
      maybeSingle: () => b,
      then: (resolve, reject) => {
        mockState.fromCalls++;
        let rows = (mockState.tables[table] || []).filter((r) => st.filters.every((f) => f(r)));
        rows = rows.slice().sort((x, y) => { for (const [c, asc] of st.orders) { const d = cmp(x[c], y[c]); if (d) return asc ? d : -d; } return 0; });
        if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
        if (st.limit != null) rows = rows.slice(0, st.limit);
        if (st.cols !== '*') { const keep = st.cols.split(','); rows = rows.map((r) => Object.fromEntries(keep.filter((k) => k in r).map((k) => [k, r[k]]))); }
        return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null, status: 200, count: rows.length }).then(resolve, reject);
      },
    };
    return b;
  };
  const client = {
    from: (t) => makeBuilder(t),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  return { createClient: () => client };
});

process.env.REACT_APP_SUPABASE_URL = 'https://coach-portal-test.supabase.co';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const fixture = () => ({
  team_members: [
    { id: 'r1', name: 'Rep One', email: 'r1@nsa.test', phone: '1', role: 'rep', is_active: true, auth_id: 'auth-1', commission_rate: 0.1, access: { admin: true } },
    { id: 'r2', name: 'Rep Two', email: 'r2@nsa.test', phone: '2', role: 'csr', is_active: true, auth_id: 'auth-2', commission_rate: 0.2 },
    { id: 'r3', name: 'Rep Three', email: 'r3@nsa.test', phone: '3', role: 'rep', is_active: true, commission_rate: 0.3 },
  ],
  customers: [
    { id: 'c-dept', name: 'Dept', alpha_tag: 'DEPT', parent_id: null, primary_rep_id: 'r1' },
    { id: 'c-fb', name: 'Football', alpha_tag: 'Fb ', parent_id: 'c-dept', primary_rep_id: 'r1' },
    { id: 'c-bb', name: 'Baseball', alpha_tag: 'BB', parent_id: 'c-dept', primary_rep_id: 'r1' },
    { id: 'c-other', name: 'Other School', alpha_tag: 'OTH', parent_id: null, primary_rep_id: 'r3' },
    { id: 'c-dup1', name: 'Dup A', alpha_tag: 'DUP', parent_id: null },
    { id: 'c-dup2', name: 'Dup B', alpha_tag: 'dup', parent_id: null },
  ],
  customer_contacts: [
    { id: 1, customer_id: 'c-fb', name: 'Coach F', email: 'f@school.test', sort_order: 0 },
    { id: 2, customer_id: 'c-other', name: 'Coach O', email: 'o@school.test', sort_order: 0 },
  ],
  customer_promo_programs: [{ id: 'pp1', customer_id: 'c-dept' }],
  customer_promo_periods: [{ id: 'per1', customer_id: 'c-dept', program_id: 'pp1' }, { id: 'per3', customer_id: 'c-other' }],
  customer_promo_usage: [{ id: 'u1', period_id: 'per1', so_id: 'SO-1' }, { id: 'u3', period_id: 'per3', so_id: 'SO-3' }],
  customer_credits: [{ id: 'cr1', customer_id: 'c-fb' }, { id: 'cr3', customer_id: 'c-other' }],
  customer_credit_usage: [{ id: 'cu1', credit_id: 'cr1' }, { id: 'cu3', credit_id: 'cr3' }],
  customer_pending_shipping: [{ id: 'ps1', customer_id: 'c-fb' }],
  customer_pending_shipping_usage: [{ id: 'psu1', pending_id: 'ps1', so_id: 'SO-1' }],
  sales_orders: [
    { id: 'SO-1', customer_id: 'c-fb', created_by: 'r2', memo: 'fb order' },
    { id: 'SO-2', customer_id: 'c-bb', created_by: 'r1', memo: 'bb order' },
    { id: 'SO-3', customer_id: 'c-other', created_by: 'r3', memo: 'other order' },
    { id: 'SO-4', customer_id: 'c-dept', created_by: 'r1', memo: 'dept order' },
  ],
  so_items: [
    { id: 12, so_id: 'SO-1', item_index: 0, sku: 'TEE', product_id: 'p1', sizes: { M: 2 }, nsa_cost: 4 },
    { id: 11, so_id: 'SO-1', item_index: 1, sku: 'HOOD', product_id: 'p2', sizes: { L: 1 }, nsa_cost: 9 },
    { id: 21, so_id: 'SO-2', item_index: 0, sku: 'CAP', product_id: null, sizes: { OSFA: 5 } },
    { id: 31, so_id: 'SO-3', item_index: 0, sku: 'SECRET', product_id: 'p3', sizes: { S: 1 } },
  ],
  so_item_decorations: [
    { id: 102, so_item_id: 11, deco_index: 1, kind: 'art' },
    { id: 101, so_item_id: 11, deco_index: 0, kind: 'art' },
    { id: 131, so_item_id: 31, deco_index: 0, kind: 'art' },
  ],
  so_item_po_lines: [{ id: 501, so_item_id: 11, po_id: 'PO 1', sizes: { L: 1 } }, { id: 531, so_item_id: 31, po_id: 'PO 3', sizes: {} }],
  so_item_pick_lines: [{ id: 601, so_item_id: 12, pick_id: 'IF-1', sizes: { M: 2 } }],
  so_jobs: [
    { id: 'JOB-1-02', so_id: 'SO-1', art_name: 'B', items: [] },
    { id: 'JOB-1-01', so_id: 'SO-1', art_name: 'A', items: [] },
    { id: 'JOB-3-01', so_id: 'SO-3', art_name: 'Secret', items: [] },
  ],
  so_art_files: [{ id: 'af2', so_id: 'SO-1', name: 'Front' }, { id: 'af1', so_id: 'SO-1', name: 'Back' }, { id: 'af3', so_id: 'SO-3', name: 'Secret' }],
  so_firm_dates: [{ id: 'fd1', so_id: 'SO-1', date: '2026-11-01' }],
  estimates: [{ id: 'EST-1', customer_id: 'c-fb', created_by: 'r2' }, { id: 'EST-3', customer_id: 'c-other', created_by: 'r3' }],
  estimate_items: [{ id: 71, estimate_id: 'EST-1', item_index: 0, sku: 'TEE', product_id: 'p1', sizes: { M: 1 } }, { id: 73, estimate_id: 'EST-3', item_index: 0, sku: 'SECRET' }],
  estimate_item_decorations: [{ id: 81, estimate_item_id: 71, deco_index: 0, kind: 'art' }],
  estimate_art_files: [{ id: 'eaf1', estimate_id: 'EST-1', name: 'Logo' }],
  invoices: [{ id: 'INV-1', customer_id: 'c-fb', total: 100 }, { id: 'INV-3', customer_id: 'c-other', total: 999 }],
  invoice_items: [{ id: 91, invoice_id: 'INV-1', desc: 'Tees' }, { id: 93, invoice_id: 'INV-3', desc: 'Secret' }],
  invoice_payments: [{ id: 'pay1', invoice_id: 'INV-1', amount: 50 }],
  invoice_credit_memos: [{ id: 'cm1', invoice_id: 'INV-1', created_at: '2026-10-01' }],
  products: [
    { id: 'p1', sku: 'TEE', name: 'Tee', nsa_cost: 3.5, size_costs: { S: 3 }, image_front_url: 'https://img/p1.png' },
    { id: 'p2', sku: 'HOOD', name: 'Hood', nsa_cost: 12 },
    { id: 'p3', sku: 'SECRET', name: 'Secret', nsa_cost: 1 },
    { id: 'p4', sku: 'CAP', name: 'Cap', nsa_cost: 2 },
  ],
  app_state: [
    { id: 'company_info', value: JSON.stringify({ name: 'NSA', phone: '714', addr: '1 St', city: 'Orange', state: 'CA', zip: '92865' }) },
    { id: '_pimg_p1', value: JSON.stringify({ gallery: ['https://img/p1-g.png'] }) },
    { id: '_pimg_p3', value: JSON.stringify({ gallery: ['https://img/secret.png'] }) },
    { id: 'qb_config', value: JSON.stringify({ token: 'SECRET-QB' }) },
  ],
});

let fn, client;
const reset = (tables = fixture()) => { mockState.tables = tables; mockState.fromCalls = 0; };
beforeAll(() => {
  fn = require('../../netlify/functions/coach-portal-data');
  client = require('@supabase/supabase-js').createClient();
});

// The response a coach's browser receives, as the handler serializes it.
const fetchVia = async (url, init) => {
  const res = await fn.handler({ httpMethod: 'POST', body: init.body });
  return { status: res.statusCode, ok: res.statusCode < 300, json: async () => JSON.parse(res.body) };
};

describe('which customer a portal tag opens', () => {
  test('trimmed, case-insensitive, and must be unique — the old ?portal= gate rule', async () => {
    reset();
    expect((await fn.resolvePortalCustomer(client, ' fb ')).customer.id).toBe('c-fb');
    expect((await fn.resolvePortalCustomer(client, 'FB')).customer.id).toBe('c-fb');
    expect((await fn.resolvePortalCustomer(client, 'nope')).status).toBe('not_found');
    expect((await fn.resolvePortalCustomer(client, 'DUP')).status).toBe('ambiguous');
    expect((await fn.resolvePortalCustomer(client, '  ')).status).toBe('bad_request');
    // A substring is not a match ('B' is inside 'BB' and 'DUP B' but is nobody's tag).
    expect((await fn.resolvePortalCustomer(client, 'B')).status).toBe('not_found');
  });

  test('the handler maps those outcomes to HTTP statuses', async () => {
    reset();
    const call = async (alphaTag) => (await fn.handler({ httpMethod: 'POST', body: JSON.stringify({ alphaTag }) })).statusCode;
    expect(await call('fb')).toBe(200);
    expect(await call('nope')).toBe(404);
    expect(await call('dup')).toBe(409);
    expect(await call('')).toBe(400);
    expect((await fn.handler({ httpMethod: 'GET' })).statusCode).toBe(405);
  });
});

describe('what a team portal receives', () => {
  test('a sub-team gets its own documents and its department family — nothing from other customers', async () => {
    reset();
    const r = await fn.loadPortalScope(client, 'fb');
    const t = r.tables;
    expect(t.customers.map((c) => c.id).sort()).toEqual(['c-bb', 'c-dept', 'c-fb']);
    expect(t.sales_orders.map((s) => s.id)).toEqual(['SO-1']);
    expect(t.estimates.map((s) => s.id)).toEqual(['EST-1']);
    expect(t.invoices.map((s) => s.id)).toEqual(['INV-1']);
    const all = JSON.stringify(t);
    for (const leak of ['c-other', 'SO-3', 'EST-3', 'INV-3', 'SECRET', 'Secret', 'r3', 'Other School', 'SECRET-QB', 'so_history']) expect(all).not.toContain(leak);
  });

  test('a department account also gets its sub-teams\' documents', async () => {
    reset();
    const t = (await fn.loadPortalScope(client, 'dept')).tables;
    expect(t.sales_orders.map((s) => s.id)).toEqual(['SO-1', 'SO-2', 'SO-4']);
    expect(JSON.stringify(t)).not.toContain('SO-3');
    // SO-2's cap line has no product id — its product comes by sku, after the by-id products.
    expect(t.products.map((p) => p.id)).toEqual(['p2', 'p1', 'p4']);
  });

  test('staff and products come without secrets or costs; settings rows are limited', async () => {
    reset();
    const t = (await fn.loadPortalScope(client, 'fb')).tables;
    expect(t.team_members.map((m) => m.id).sort()).toEqual(['r1', 'r2']);
    t.team_members.forEach((m) => expect(Object.keys(m).sort()).toEqual(['email', 'id', 'is_active', 'name', 'phone', 'role']));
    expect(t.products.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    t.products.forEach((p) => { expect(p).not.toHaveProperty('nsa_cost'); expect(p).not.toHaveProperty('size_costs'); });
    expect(t.app_state.map((a) => a.id).sort()).toEqual(['_pimg_p1', 'company_info']);
  });

  test('rows come back in the order the staff load queries them', async () => {
    reset();
    const t = (await fn.loadPortalScope(client, 'fb')).tables;
    expect(t.so_items.map((r) => r.id)).toEqual([12, 11]);                 // item_index, id
    expect(t.so_item_decorations.map((r) => r.id)).toEqual([101, 102]);    // deco_index, id
    expect(t.so_jobs.map((r) => r.id)).toEqual(['JOB-1-01', 'JOB-1-02']); // so_id, id
    expect(t.so_art_files.map((r) => r.id)).toEqual(['af1', 'af2']);
  });

  test('more than 1000 child rows and more than 100 parents still load completely', async () => {
    const tables = fixture();
    for (let i = 0; i < 130; i++) tables.sales_orders.push({ id: 'SO-X' + String(i).padStart(3, '0'), customer_id: 'c-fb' });
    for (let i = 0; i < 130; i++) tables.so_items.push({ id: 1000 + i, so_id: 'SO-X' + String(i).padStart(3, '0'), item_index: 0, sku: 'TEE' });
    for (let i = 0; i < 1005; i++) tables.so_item_decorations.push({ id: 5000 + i, so_item_id: 11, deco_index: 1005 - i, kind: 'art' });
    reset(tables);
    const t = (await fn.loadPortalScope(client, 'fb')).tables;
    expect(t.sales_orders).toHaveLength(131);
    expect(t.so_items).toHaveLength(132);
    const decos = t.so_item_decorations.filter((d) => d.so_item_id === 11);
    expect(decos).toHaveLength(1007);
    expect(decos.map((d) => d.deco_index)).toEqual([...decos.map((d) => d.deco_index)].sort((a, b) => a - b));
  });
});

describe('the portal shows what it showed before', () => {
  const { _dbLoad } = require('../lib/dbEngine');
  const { loadCoachPortal } = require('../lib/coachPortalData');

  test.each([['fb', ['c-fb']], ['dept', ['c-dept', 'c-fb', 'c-bb']]])('%s: same orders, estimates, invoices and customers as the full load', async (tag, ids) => {
    reset();
    const full = await _dbLoad({ fullState: true });
    const scoped = await loadCoachPortal(tag, fetchVia);
    expect(scoped.status).toBe('ok');
    const mine = (docs) => docs.filter((d) => ids.includes(d.customer_id));
    expect(scoped.sos).toEqual(mine(full.sales_orders));
    expect(scoped.ests).toEqual(mine(full.estimates));
    expect(scoped.invs).toEqual(mine(full.invoices));
    const familyIds = new Set(scoped.customers.map((c) => c.id));
    expect(scoped.customers).toEqual(full.customers.filter((c) => familyIds.has(c.id)));
    expect(scoped.customer.id).toBe(ids[0] === 'c-dept' ? 'c-dept' : 'c-fb');
    // The comparison is over fully assembled documents, not empty lists.
    const so1 = scoped.sos.find((s) => s.id === 'SO-1');
    expect(so1.items.map((i) => i.sku)).toEqual(['TEE', 'HOOD']);
    expect(so1.items[1].decorations).toHaveLength(2);
    expect(so1.items[1].po_lines.map((p) => p.po_id)).toEqual(['PO 1']);
    expect(so1.items[0].pick_lines.map((p) => p.pick_id)).toEqual(['IF-1']);
    expect([so1.jobs.length, so1.art_files.length, so1.firm_dates.length]).toEqual([2, 2, 1]);
    expect(scoped.ests.find((e) => e.id === 'EST-1').items[0].decorations).toHaveLength(1);
    expect(scoped.invs.find((i) => i.id === 'INV-1').payments).toHaveLength(1);
    const fb = scoped.customers.find((c) => c.id === 'c-fb');
    expect([fb.contacts.length, fb.credits.length, fb.credit_usage.length, fb.promo_periods.length, fb.pending_shipping_usage.length]).toEqual([1, 1, 1, 1, 1]);
    // Product images still resolve through the _pimg_ gallery fallback.
    expect(scoped.products.find((p) => p.id === 'p1').images).toEqual(['https://img/p1-g.png']);
  });

  test('assembling the scoped rows queries no tables from the browser', async () => {
    reset();
    const res = await fn.loadPortalScope(client, 'fb');
    mockState.fromCalls = 0;
    const d = await _dbLoad({ fullState: true, source: (table) => ({ data: res.tables[table] || [] }) });
    expect(mockState.fromCalls).toBe(0);
    expect(d.sales_orders.map((s) => s.id)).toEqual(['SO-1']);
  });

  test('not found and ambiguous tags come back as statuses, not errors', async () => {
    reset();
    expect((await loadCoachPortal('nope', fetchVia)).status).toBe('not_found');
    expect((await loadCoachPortal('dup', fetchVia)).status).toBe('ambiguous');
  });
});
