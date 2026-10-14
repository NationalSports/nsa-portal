/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const {
  hasActiveStoreRequests,
  resolveStoreRequestPanelOpen,
  newlyReadyStoreIds,
  readyStoreIdsNeedingRefresh,
  nextCustomerPickerIndex,
} = require('../lib/webstoreBuildRequests');

const ROOT = path.resolve(__dirname, '../..');
const ui = fs.readFileSync(path.join(ROOT, 'src/Webstores.js'), 'utf8');
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

test('Webstores gates the request box to admins and only reads and writes queue rows', () => {
  const panel = ui.slice(ui.indexOf('function StoreRequestPanel('), ui.indexOf('\nfunction ListView('));
  expect(ui).toContain("(cu?.role === 'admin' || cu?.role === 'super_admin') && <StoreRequestPanel");
  expect(panel).toContain("supabase.from('webstore_build_requests')");
  expect(panel).toContain(".update({ status: 'cancelled' }).eq('id', request.id).eq('status', 'queued')");
  expect(panel).toContain("cloudUpload(file, 'nsa-webstore-build-requests')");
  expect(panel).toContain('STORE_REQUEST_MAX_FILES');
  expect(ui).toContain('STORE_REQUEST_MAX_FILE_BYTES');
  expect(panel).not.toMatch(/anthropic|openai|gemini/i);
});

test('request panel shows results, attachments, and the linked draft store', () => {
  expect(ui).toContain('<MarkdownSummary text={request.result_summary} />');
  expect(ui).toContain('attachments.map');
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

  test('shared customer picker keeps New Store and OMG wiring plus click-away close', () => {
    expect(ui).toContain('<CustomerPicker customers={sortedCust} value={customerId} onChange={setCustomerId}');
    expect(ui).toContain('<CustomerPicker customers={cust} value={f.customer_id} onChange={applyCustomer}');
    expect(ui).toContain('onBlur={() => setTimeout(() => setOpen(false), 120)}');
    expect(ui).toContain("setActiveIndex((i) => WEBSTORE_BUILD_REQUESTS.nextCustomerPickerIndex(i, e.key, matches.length))");
  });
});
