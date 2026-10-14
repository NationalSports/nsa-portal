/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const {
  hasActiveStoreRequests,
  resolveStoreRequestPanelOpen,
  newlyReadyStoreIds,
  readyStoreIdsNeedingRefresh,
  nextCustomerPickerIndex,
  groupStoreRequestProducts,
  isValidOmgStoreUrl,
} = require('../lib/webstoreBuildRequests');

const ROOT = path.resolve(__dirname, '../..');
const ui = fs.readFileSync(path.join(ROOT, 'src/Webstores.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'src/App.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20261013075510_webstore_build_requests.sql'),
  'utf8',
);
const hardening = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20261013080236_harden_webstore_build_requests.sql'),
  'utf8',
);
const deletionCompatibility = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20261013084008_allow_ready_request_store_deletion.sql'),
  'utf8',
);
const selectedItemsMigration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20261014062000_add_selected_items_to_webstore_build_requests.sql'),
  'utf8',
);

test('store build queue has the documented lifecycle, links, and updated-at trigger', () => {
  expect(migration).toMatch(/create table public\.webstore_build_requests/i);
  expect(migration).toMatch(/status in \('queued', 'building', 'ready', 'failed', 'cancelled'\)/i);
  expect(migration).toMatch(/store_id uuid references public\.webstores\(id\) on delete set null/i);
  expect(migration).toMatch(/customer_id text references public\.customers\(id\) on delete set null/i);
  expect(migration).toMatch(/attachment_urls jsonb not null default '\[\]'/i);
  expect(migration).toMatch(/execute function public\.set_updated_at\(\)/i);
});

test('store build queue is browser-admin-only and service-role writable', () => {
  expect(migration).toMatch(/enable row level security/i);
  expect(migration.match(/public\.is_admin_member\(\)/gi)).toHaveLength(4);
  expect(migration).toMatch(/revoke all on public\.webstore_build_requests from public, anon/i);
  expect(migration).toMatch(/grant all on public\.webstore_build_requests to service_role/i);
  expect(migration).not.toMatch(/grant delete .* authenticated/i);
});

test('database enforces attribution, attachment limits, and queued-only admin cancellation', () => {
  expect(hardening).toMatch(/jsonb_array_length\(files\) <= 5/i);
  expect(hardening).toMatch(/20971520/);
  expect(hardening).toMatch(/https:\/\/res\[.\]cloudinary\[.\]com\//);
  expect(hardening).toMatch(/old\.status <> 'queued' or new\.status <> 'cancelled'/i);
  expect(hardening).toMatch(/created_by = \(\s*select tm\.id[^]*tm\.auth_id = \(select auth\.uid\(\)\)/i);
  expect(hardening).toMatch(/status <> 'failed'.*error/si);
  expect(deletionCompatibility).toMatch(/drop constraint if exists webstore_build_requests_ready_has_store/i);
});

test('selected catalog items and art are nullable, validated, bounded, and count as request instructions', () => {
  expect(selectedItemsMigration).toMatch(/add column selected_items jsonb/i);
  expect(selectedItemsMigration).toMatch(/add column selected_art jsonb/i);
  expect(selectedItemsMigration).toMatch(/jsonb_array_length\(items\) <= 50/i);
  expect(selectedItemsMigration).toMatch(/product_id.*sku.*name.*brand.*image_url/is);
  expect(selectedItemsMigration).toMatch(/art_id.*name.*is_main/is);
  expect(selectedItemsMigration).toMatch(/where item->>'is_main' = 'true'[^]*<= 1/i);
  expect(selectedItemsMigration).toMatch(/start_from_type in \('template', 'store'\)/i);
  expect(selectedItemsMigration).toMatch(/start_from_type = 'omg_url'/i);
  expect(selectedItemsMigration).toMatch(/itemorder\[.\]com\/shop/i);
  expect(selectedItemsMigration).toMatch(/jsonb_array_length\(coalesce\(selected_items, '\[\]'::jsonb\)\) > 0/i);
  expect(selectedItemsMigration).toMatch(/jsonb_array_length\(coalesce\(selected_art, '\[\]'::jsonb\)\) > 0/i);
});

test('dedicated request page is admin-only and the Webstores list no longer embeds the queue', () => {
  const panel = ui.slice(ui.indexOf('function StoreRequestPanel('), ui.indexOf('\nfunction ListView('));
  const listView = ui.slice(ui.indexOf('function ListView('), ui.indexOf('\nfunction StoreForm('));
  expect(ui).toContain('export function StoreRequestPage(');
  expect(ui).toContain("cu?.role === 'admin' || cu?.role === 'super_admin'");
  expect(app).toContain("if(pageId==='store_request')return accessUser.role==='admin'||accessUser.role==='super_admin'");
  expect(app).toContain("pg==='store_request'");
  expect(listView).not.toContain('<StoreRequestPanel');
  expect(panel).toContain("supabase.from('webstore_build_requests')");
  expect(panel).toContain(".update({ status: 'cancelled' }).eq('id', request.id).eq('status', 'queued')");
  expect(panel).toContain("cloudUpload(file, 'nsa-webstore-build-requests')");
  expect(panel).toContain('STORE_REQUEST_MAX_FILES');
  expect(ui).toContain('STORE_REQUEST_MAX_FILE_BYTES');
  expect(panel).toContain("fetch('/.netlify/functions/notify-store-request'");
  expect(panel).toContain('body: JSON.stringify({ request_id: data.id })');
  expect(panel).not.toMatch(/STORE_REQUEST_WEBHOOK_(URL|KEY)/);
  expect(panel).not.toMatch(/anthropic|openai|gemini/i);
});

test('request panel shows catalog item search, results, attachments, and the linked draft store', () => {
  expect(ui).toContain('<MarkdownSummary text={request.result_summary} />');
  expect(ui).toContain('attachments.map');
  expect(ui).toContain('<StoreRequestItemPicker value={selectedItems}');
  expect(ui).toContain("aria-label=\"Search catalog items\"");
  expect(ui).toContain("role=\"option\"");
  expect(ui).toContain("selected_items: selectedItems");
  expect(ui).toContain("selected_art: selectedArt");
  expect(ui).toContain("start_from_type: startFrom.type");
  expect(ui).toContain('<StoreRequestStartFromPicker templates={templates}');
  expect(ui).toContain('request.selected_items');
  expect(ui).toContain('request.selected_art');
  expect(ui).toContain('<StoreRequestArtPicker customerId={customerId}');
  expect(ui).toContain('aria-multiselectable="true"');
  expect(ui).toContain('<NewArtFolderModal saveContext="request"');
  expect(ui).toContain('Open draft store →');
  expect(ui).toContain("accept=\"application/pdf,image/*\"");
  expect(ui).toContain('htmlFor="webstore-build-request-text"');
  expect(ui).toContain('role="combobox"');
  expect(ui).toContain('role="listbox"');
});

describe('request panel behavior', () => {
  test('polling runs only while queued or building work exists', () => {
    expect(hasActiveStoreRequests([])).toBe(false);
    expect(hasActiveStoreRequests([{ status: 'ready' }, { status: 'failed' }])).toBe(false);
    expect(hasActiveStoreRequests([{ status: 'queued' }])).toBe(true);
    expect(hasActiveStoreRequests([{ status: 'cancelled' }, { status: 'building' }])).toBe(true);
    expect(ui).toContain('if (!hasActiveRequests) return undefined;');
  });

  test('collapse defaults follow active work while an explicit preference wins', () => {
    const active = [{ status: 'building' }];
    expect(resolveStoreRequestPanelOpen(null, [])).toBe(false);
    expect(resolveStoreRequestPanelOpen(null, active)).toBe(true);
    expect(resolveStoreRequestPanelOpen('closed', active)).toBe(false);
    expect(resolveStoreRequestPanelOpen('open', [])).toBe(true);
  });

  test('ready transitions identify stores that need an in-app list refresh', () => {
    const before = [{ id: 'request-1', status: 'building', store_id: null }];
    const ready = [{ id: 'request-1', status: 'ready', store_id: 'store-1' }];
    expect(newlyReadyStoreIds(before, ready)).toEqual(['store-1']);
    expect(newlyReadyStoreIds(ready, ready)).toEqual([]);
    expect(newlyReadyStoreIds([], ready)).toEqual(['store-1']);
    expect(readyStoreIdsNeedingRefresh(ready, ready, new Set())).toEqual(['store-1']);
    expect(readyStoreIdsNeedingRefresh(ready, ready, new Set(['store-1']))).toEqual([]);
    expect(readyStoreIdsNeedingRefresh(before, ready, new Set(['store-1']))).toEqual(['store-1']);
    expect(ui).toContain('onRefreshStores={refreshStoreList}');
    expect(ui).toContain('Refreshing store…');
    expect(ui).not.toContain('href={`?pg=webstores&store=');
  });

  test('customer keyboard navigation starts on the first result and wraps upward', () => {
    expect(nextCustomerPickerIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextCustomerPickerIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(nextCustomerPickerIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextCustomerPickerIndex(2, 'ArrowDown', 3)).toBe(2);
    expect(nextCustomerPickerIndex(0, 'ArrowDown', 0)).toBe(-1);
  });

  test('catalog rows collapse into style results with a thumbnail and available colors', () => {
    expect(groupStoreRequestProducts([
      { id: 'p-1', sku: 'ST350-BLACK', name: 'Sport-Tek Competitor Tee', brand: 'Sport-Tek', color: 'Black', image_front_url: '' },
      { id: 'p-2', sku: 'ST350-ROYAL', name: 'Sport-Tek Competitor Tee', brand: 'Sport-Tek', color: 'Royal', image_front_url: 'https://img.example/royal.jpg' },
    ])).toEqual([{
      product_id: 'p-2',
      sku: 'ST350',
      name: 'Sport-Tek Competitor Tee',
      brand: 'Sport-Tek',
      image_url: 'https://img.example/royal.jpg',
      colors: ['Black', 'Royal'],
    }]);
  });

  test('old OMG starting URLs are restricted to secure itemorder shop links', () => {
    expect(isValidOmgStoreUrl('https://demo.itemorder.com/shop')).toBe(true);
    expect(isValidOmgStoreUrl('https://demo.itemorder.com/shop/team')).toBe(true);
    expect(isValidOmgStoreUrl('http://demo.itemorder.com/shop')).toBe(false);
    expect(isValidOmgStoreUrl('https://itemorder.com.attacker.test/shop')).toBe(false);
  });

  test('admin New Store control exposes manual and request routes while non-admins keep the plain button', () => {
    expect(ui).toContain('New store (manual)');
    expect(ui).toContain('Start a store request');
    expect(ui).toContain("window.location.assign('?pg=store_request')");
    expect(ui).toContain(": <button className=\"btn btn-primary\" onClick={onNew}>+ New Store</button>");
  });

  test('shared customer picker keeps New Store and OMG wiring plus click-away close', () => {
    expect(ui).toContain('<CustomerPicker customers={sortedCust} value={customerId} onChange={setCustomerId}');
    expect(ui).toContain('<CustomerPicker customers={cust} value={f.customer_id} onChange={applyCustomer}');
    expect(ui).toContain('onBlur={() => setTimeout(() => setOpen(false), 120)}');
    expect(ui).toContain("setActiveIndex((i) => WEBSTORE_BUILD_REQUESTS.nextCustomerPickerIndex(i, e.key, matches.length))");
  });
});

describe('notify-store-request function', () => {
  const request = {
    id: '11111111-1111-4111-8111-111111111111',
    created_by: 'member-1',
    customer_id: 'customer-1',
    request_text: 'Build this store',
    attachment_urls: [{ url: 'https://res.cloudinary.com/demo/a.pdf' }],
    selected_items: [{ product_id: 'p-1', sku: 'ST350', name: 'Tee', brand: 'Sport-Tek', image_url: 'https://img.example/tee.jpg' }],
    selected_art: [{ art_id: 'art-1', name: 'Primary logo', is_main: true }],
    start_from_type: 'template',
    start_from_id: 'template-1',
    start_from_url: null,
    created_at: '2026-10-14T06:00:00.000Z',
    status: 'queued',
  };
  const originalEnv = process.env;
  let verifyAdmin;
  let admin;
  let maybeSingle;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    verifyAdmin = jest.fn();
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({ 'Content-Type': 'application/json' }),
      verifyAdmin,
    }));
    maybeSingle = jest.fn().mockResolvedValue({ data: request, error: null });
    admin = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle })),
        })),
      })),
    };
  });

  afterEach(() => {
    jest.dontMock('../../netlify/functions/_shared');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('rejects a caller who is not an authenticated active admin', async () => {
    verifyAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Admin role required' });
    const { handler } = require('../../netlify/functions/notify-store-request');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ request_id: request.id }) });
    expect(result.statusCode).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  test('loads a queued request and sends only the server-built payload with the secret header', async () => {
    verifyAdmin.mockResolvedValue({ ok: true, admin });
    process.env.STORE_REQUEST_WEBHOOK_URL = 'https://assistant.example/hooks/store';
    process.env.STORE_REQUEST_WEBHOOK_KEY = 'server-secret';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    const { handler } = require('../../netlify/functions/notify-store-request');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ request_id: request.id }) });
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://assistant.example/hooks/store');
    expect(options.headers.Authorization).toBe('Bearer server-secret');
    expect(JSON.parse(options.body)).toEqual({
      request_id: request.id,
      created_by: request.created_by,
      customer_id: request.customer_id,
      request_text: request.request_text,
      attachment_urls: request.attachment_urls,
      selected_items: request.selected_items,
      selected_art: request.selected_art,
      start_from_type: request.start_from_type,
      start_from_id: request.start_from_id,
      start_from_url: request.start_from_url,
      created_at: request.created_at,
    });
    expect(options.signal).toBeDefined();
  });

  test('does not notify a request that has already left the queue', async () => {
    verifyAdmin.mockResolvedValue({ ok: true, admin });
    maybeSingle.mockResolvedValue({ data: { ...request, status: 'building' }, error: null });
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const { handler } = require('../../netlify/functions/notify-store-request');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ request_id: request.id }) });
    expect(result.statusCode).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a failed assistant POST is non-fatal to the queued request', async () => {
    verifyAdmin.mockResolvedValue({ ok: true, admin });
    process.env.STORE_REQUEST_WEBHOOK_URL = 'https://assistant.example/hooks/store';
    process.env.STORE_REQUEST_WEBHOOK_KEY = 'server-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = require('../../netlify/functions/notify-store-request');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ request_id: request.id }) });
    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toMatchObject({ notified: false });
    expect(admin.from).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  test('missing webhook configuration is reported after the queued row remains intact', async () => {
    verifyAdmin.mockResolvedValue({ ok: true, admin });
    delete process.env.STORE_REQUEST_WEBHOOK_URL;
    delete process.env.STORE_REQUEST_WEBHOOK_KEY;
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const { handler } = require('../../netlify/functions/notify-store-request');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ request_id: request.id }) });
    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toMatchObject({ notified: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledWith('webstore_build_requests');
    consoleSpy.mockRestore();
  });
});
