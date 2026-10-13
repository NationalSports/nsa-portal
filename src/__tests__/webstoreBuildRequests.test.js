/** @jest-environment node */

const fs = require('fs');
const path = require('path');

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
