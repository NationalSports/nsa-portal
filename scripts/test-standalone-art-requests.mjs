import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE || '../sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(pathToFileURL(resolve(process.cwd(), modulePath)).href);
const db = new PGlite();
const migrationUrl = new URL('../supabase/migrations/20261002192645_standalone_art_requests.sql', import.meta.url);
const migration = await (await import('node:fs/promises')).readFile(migrationUrl, 'utf8');
const staffUid = '00000000-0000-0000-0000-000000000001';
const outsiderUid = '00000000-0000-0000-0000-000000000002';
const artId = 'art-1';
const cwBlack = { id: 'cw-black', garment_color: 'Black', inks: ['White'] };
const cwNavy = { id: 'cw-navy', garment_color: 'Navy', inks: ['Gold'] };
const originalWebLogos = [{ url: 'https://files.test/old-navy.png', name: 'old-navy.png', color_way_id: cwNavy.id, color_way: 'Navy' }];
const sourceArt = { id: artId, name: 'Mascot', status: 'approved', files: [], prod_files: [{ url: 'https://files.test/master.ai', name: 'master.ai' }], color_ways: [cwBlack, cwNavy], web_logos: originalWebLogos, web_logo_url: 'https://files.test/default.png', mockup_files: [{ url: 'https://files.test/mock.png' }] };
const ref = (obj, key) => obj.rows.find(row => row[key] != null)?.[key];
const json = (obj, key) => typeof ref(obj, key) === 'string' ? JSON.parse(ref(obj, key)) : ref(obj, key);
const call = async (fn, args) => {
  const casts = fn === 'create_standalone_art_request' ? ['jsonb'] : fn === 'sync_standalone_art_conversion' ? ['text', 'text'] : ['uuid', 'text', 'jsonb'];
  return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}::${casts[i]}`).join(',')}) as value`, args)).rows[0].value;
};
const insertRequest = async (id, overrides = {}) => call('create_standalone_art_request', [JSON.stringify({
  id, customer_id: 'cust-a', estimate_id: 'est-a', art_id: artId, art_name: 'Mascot', request_type: 'web_logo',
  color_way_id: cwBlack.id, instructions: 'Use the white ink version.', reference_files: [], requested_by: 'rep-a', requested_by_name: 'Rep A',
  ...overrides,
})]);
const expectReject = async (fn, pattern) => {
  let error;
  try { await fn(); } catch (e) { error = e; }
  assert(error, 'expected the operation to fail');
  if (pattern) assert.match(error.message, pattern);
  return error;
};
const staff = async () => { await db.query(`select set_config('request.jwt.claim.sub','${staffUid}',false)`); await db.exec('set role authenticated'); };
const outsider = async () => { await db.query(`select set_config('request.jwt.claim.sub','${outsiderUid}',false)`); await db.exec('set role authenticated'); };
const resetRole = async () => db.query('reset role');

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table public.customers(id text primary key, art_files jsonb not null default '[]');
    create table public.estimates(id text primary key, customer_id text not null, _version integer not null default 1, updated_at text not null default now()::text);
    create table public.sales_orders(id text primary key, customer_id text not null, estimate_id text, _version integer not null default 1, updated_at text not null default now()::text);
    create table public.estimate_art_files(estimate_id text not null, id text not null, name text, status text, files jsonb, prod_files jsonb, color_ways jsonb, web_logos jsonb, web_logo_url text, primary key(estimate_id,id));
    create table public.so_art_files(so_id text not null, id text not null, name text, status text, files jsonb, prod_files jsonb, color_ways jsonb, web_logos jsonb, web_logo_url text, primary key(so_id,id));
    create table public.team_members(id text primary key, role text, is_active boolean);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function public.is_team_member() returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.team_members where id=auth.uid()::text and role in ('admin','super_admin','rep','art','artist') and is_active is distinct from false) $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    grant select,insert,update on customers,estimates,sales_orders,estimate_art_files,so_art_files to authenticated,service_role;
    grant delete on estimates,sales_orders to authenticated,service_role;
    grant select on team_members to authenticated,service_role;
    insert into customers(id,art_files) values ('cust-a',jsonb_build_array(${`'${JSON.stringify(sourceArt).replaceAll("'", "''")}'`}::jsonb));
    insert into estimates(id,customer_id) values ('est-a','cust-a');
    insert into sales_orders(id,customer_id,estimate_id) values ('so-a','cust-a','est-a'),('so-b','cust-a','est-a');
    insert into estimate_art_files(estimate_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url)
    values ('est-a','${artId}','Mascot','approved','[]','${JSON.stringify(sourceArt.prod_files)}','${JSON.stringify(sourceArt.color_ways)}','${JSON.stringify(sourceArt.web_logos)}','${sourceArt.web_logo_url}');
    insert into so_art_files(so_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url)
    select so.id,a.id,a.name,a.status,a.files,a.prod_files,a.color_ways,a.web_logos,a.web_logo_url from sales_orders so cross join estimate_art_files a where a.estimate_id='est-a';
    insert into team_members(id,role,is_active) values ('${staffUid}','artist',true),('${outsiderUid}','customer',true);
  `);
  await db.exec(`create function public._test_auth_uid() returns uuid language sql as $$select auth.uid()$$;`);
  await db.exec(migration);

  await staff();
  const missingCwId = '10000000-0000-0000-0000-000000000001';
  await expectReject(() => insertRequest(missingCwId, { color_way_id: 'removed-cw' }), /current color way/);

  const id = '10000000-0000-0000-0000-000000000002';
  const created = await insertRequest(id, { source_art: { id: artId, color_ways: [] } });
  assert.equal(created.status, 'requested');
  assert.equal(created.color_way_label, 'Black');
  assert.equal(created.source_art.color_ways[0].id, cwBlack.id, 'source_art must come from the database, not stale client JSON');
  await expectReject(() => insertRequest('10000000-0000-0000-0000-000000000003'), /open request already exists/i);
  await expectReject(() => insertRequest('10000000-0000-0000-0000-000000000009', { so_id: 'so-a' }), /open request already exists/i);
  const started = await call('transition_standalone_art_request', [id, 'in_progress', '[]']);
  assert.equal(started.request.status, 'in_progress');
  const logoFile = [{ name: 'mascot-black.png', url: 'https://files.test/mascot-black.png' }];
  const completed = await call('transition_standalone_art_request', [id, 'completed', JSON.stringify(logoFile)]);
  assert.equal(completed.request.status, 'completed');
  assert.equal(completed.request.result_files[0].url, logoFile[0].url);
  const customerAfter = await db.query("select art_files from customers where id='cust-a'");
  const customerArts = json(customerAfter, 'art_files');
  const libraryArt = customerArts.find(a => a.id === artId);
  assert(libraryArt.web_logos.some(w => w.url === logoFile[0].url && w.color_way_id === cwBlack.id));
  assert(libraryArt.web_logos.some(w => w.url === originalWebLogos[0].url && w.color_way_id === cwNavy.id), 'other CW must survive');
  assert.equal(libraryArt.web_logo_url, sourceArt.web_logo_url, 'per-CW update must preserve default logo');
  assert.equal(libraryArt.status, sourceArt.status, 'completion must not approve the artwork');
  assert.deepEqual(libraryArt.mockup_files, sourceArt.mockup_files, 'completion must preserve mockups');
  const estimateAfter = await db.query("select to_jsonb(a) as art from estimate_art_files a where estimate_id='est-a' and id=$1", [artId]);
  assert(json(estimateAfter, 'art').web_logos.some(w => w.url === logoFile[0].url));
  for (const soId of ['so-a', 'so-b']) {
    const soAfter = await db.query('select to_jsonb(a) as art from so_art_files a where so_id=$1 and id=$2', [soId, artId]);
    assert(json(soAfter, 'art').web_logos.some(w => w.url === logoFile[0].url), `${soId} should receive the logo`);
  }
  const repeat = await call('transition_standalone_art_request', [id, 'completed', JSON.stringify([{ name: 'changed.png', url: 'https://files.test/changed.png' }])]);
  assert.equal(repeat.request.result_files[0].url, logoFile[0].url, 'idempotent completion must retain original result');

  const cancelId = '10000000-0000-0000-0000-000000000004';
  await insertRequest(cancelId, { color_way_id: cwNavy.id });
  await call('transition_standalone_art_request', [cancelId, 'cancelled', '[]']);
  await expectReject(() => call('transition_standalone_art_request', [cancelId, 'completed', JSON.stringify(logoFile)]), /already closed/);

  const removedId = '10000000-0000-0000-0000-000000000005';
  await insertRequest(removedId, { color_way_id: cwBlack.id });
  await call('transition_standalone_art_request', [removedId, 'in_progress', '[]']);
  await db.query("update estimate_art_files set color_ways='[]'::jsonb where estimate_id='est-a' and id=$1", [artId]);
  const beforeRollback = await db.query("select art_files from customers where id='cust-a'");
  await expectReject(() => call('transition_standalone_art_request', [removedId, 'completed', JSON.stringify([{ name: 'removed.png', url: 'https://files.test/removed.png' }])]), /color way was removed/);
  const afterRollback = await db.query("select art_files from customers where id='cust-a'");
  assert.deepEqual(json(afterRollback, 'art_files'), json(beforeRollback, 'art_files'), 'failed completion must roll back every mirror');
  const remainsOpen = await db.query('select status from standalone_art_requests where id=$1', [removedId]);
  assert.equal(ref(remainsOpen, 'status'), 'in_progress');
  await db.query("update estimate_art_files set color_ways=$2::jsonb where estimate_id='est-a' and id=$1", [artId, JSON.stringify([cwBlack, cwNavy])]);

  const createdId = '10000000-0000-0000-0000-000000000006';
  const newLogo = await insertRequest(createdId, { art_id: null, request_type: 'create_logo', color_way_id: null, color_way_label: null, art_name: 'New Falcon' });
  assert.match(newLogo.art_id, /^AR-/);
  const createdResult = [{ name: 'falcon.ai', url: 'https://files.test/falcon.ai' }];
  await call('transition_standalone_art_request', [createdId, 'in_progress', '[]']);
  const made = await call('transition_standalone_art_request', [createdId, 'completed', JSON.stringify(createdResult)]);
  assert.equal(made.request.status, 'completed');
  const customerWithNew = json(await db.query("select art_files from customers where id='cust-a'"), 'art_files');
  assert(customerWithNew.some(a => a.id === newLogo.art_id && a.prod_files.some(f => f.url === createdResult[0].url)));
  await db.query("insert into sales_orders(id,customer_id,estimate_id,_version,updated_at) values ('so-new','cust-a','est-a',1,'before-conversion')");
  const rowsBeforeSync = await db.query("select count(*)::int as n from standalone_art_requests where estimate_id='est-a'");
  const synced = await call('sync_standalone_art_conversion', ['est-a', 'so-new']);
  const rowsAfterSync = await db.query("select count(*)::int as n from standalone_art_requests where estimate_id='est-a'");
  assert.equal(rowsAfterSync.rows[0].n, rowsBeforeSync.rows[0].n, 'conversion sync must replay, not copy, request rows');
  const syncedArt = await db.query("select to_jsonb(a) as art from so_art_files a where so_id='so-new' and id=$1", [newLogo.art_id]);
  assert(json(syncedArt, 'art').prod_files.some(f => f.url === createdResult[0].url), 'conversion sync must replay a completed source-less logo to the new SO snapshot');
  assert.equal(synced.id, 'so-new');

  // A request sourced from a sales-order copy must merge with the estimate's own live
  // files instead of copying the SO's independent web logos or production files over it.
  await db.query("update estimate_art_files set prod_files=$2::jsonb,web_logos=$3::jsonb where estimate_id='est-a' and id=$1", [artId,
    JSON.stringify([{ url: 'https://files.test/estimate-only.ai', name: 'estimate-only.ai' }]),
    JSON.stringify([{ url: 'https://files.test/estimate-only.png', name: 'estimate-only.png', color_way_id: cwNavy.id }])]);
  await db.query("update so_art_files set prod_files=$2::jsonb,web_logos=$3::jsonb where so_id='so-a' and id=$1", [artId,
    JSON.stringify([{ url: 'https://files.test/so-only.ai', name: 'so-only.ai' }]),
    JSON.stringify([{ url: 'https://files.test/so-only.png', name: 'so-only.png', color_way_id: cwNavy.id }])]);
  const soRequestId = '10000000-0000-0000-0000-000000000010';
  const soRequest = await insertRequest(soRequestId, { so_id: 'so-a', request_type: 'vectorize', color_way_id: null, instructions: 'Vectorize the mark.' });
  await call('transition_standalone_art_request', [soRequestId, 'in_progress', '[]']);
  await call('transition_standalone_art_request', [soRequestId, 'completed', JSON.stringify([{ name: 'new-vector.ai', url: 'https://files.test/new-vector.ai' }])]);
  const estimatePreserved = json(await db.query("select to_jsonb(a) as art from estimate_art_files a where estimate_id='est-a' and id=$1", [artId]), 'art');
  assert(estimatePreserved.prod_files.some(f => f.url === 'https://files.test/estimate-only.ai'));
  assert(!estimatePreserved.prod_files.some(f => f.url === 'https://files.test/so-only.ai'), 'SO-only production files must not leak into the estimate');
  assert(estimatePreserved.prod_files.some(f => f.url === 'https://files.test/new-vector.ai'));
  assert(estimatePreserved.web_logos.some(f => f.url === 'https://files.test/estimate-only.png'));
  assert(!estimatePreserved.web_logos.some(f => f.url === 'https://files.test/so-only.png'), 'SO-only web logos must not leak into the estimate');

  await db.query("insert into estimates(id,customer_id) values ('est-delete','cust-a')");
  await db.query("insert into estimate_art_files(estimate_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url) values ('est-delete',$1,'Mascot','approved','[]',$2,$3,$4,$5)",
    [artId, JSON.stringify(sourceArt.prod_files), JSON.stringify(sourceArt.color_ways), JSON.stringify(sourceArt.web_logos), sourceArt.web_logo_url]);
  const pendingDeleteId = '10000000-0000-0000-0000-000000000011';
  const pendingDelete = await insertRequest(pendingDeleteId, { estimate_id: 'est-delete' });
  assert.equal(pendingDelete.source_key, 'est-delete');
  await db.query("delete from estimates where id='est-delete'");
  const survivingEstimateRequest = await db.query('select estimate_id,source_key,status from standalone_art_requests where id=$1', [pendingDeleteId]);
  assert.equal(survivingEstimateRequest.rows[0].estimate_id, null, 'deleting an estimate must preserve its open request and null the FK');
  assert.equal(ref(survivingEstimateRequest, 'source_key'), 'est-delete', 'the immutable source key must remain after estimate deletion');
  assert.equal(ref(survivingEstimateRequest, 'status'), 'requested');

  await db.query("insert into sales_orders(id,customer_id,estimate_id,_version,updated_at) values ('so-delete','cust-a',null,1,'before-delete')");
  await db.query("insert into so_art_files(so_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url) values ('so-delete',$1,'Mascot','approved','[]',$2,$3,$4,$5)",
    [artId, JSON.stringify(sourceArt.prod_files), JSON.stringify(sourceArt.color_ways), JSON.stringify(sourceArt.web_logos), sourceArt.web_logo_url]);
  const closedDeleteId = '10000000-0000-0000-0000-000000000012';
  const closedDelete = await insertRequest(closedDeleteId, { estimate_id: null, so_id: 'so-delete', request_type: 'vectorize', color_way_id: null });
  assert.equal(closedDelete.source_key, 'so-delete');
  await call('transition_standalone_art_request', [closedDeleteId, 'cancelled', '[]']);
  await db.query("delete from sales_orders where id='so-delete'");
  const survivingSORequest = await db.query('select so_id,source_key,status from standalone_art_requests where id=$1', [closedDeleteId]);
  assert.equal(survivingSORequest.rows[0].so_id, null, 'deleting an SO must preserve its closed request and null the FK');
  assert.equal(ref(survivingSORequest, 'source_key'), 'so-delete');
  assert.equal(ref(survivingSORequest, 'status'), 'cancelled');

  await resetRole();
  await db.exec("set role anon");
  await expectReject(() => db.query('select * from standalone_art_requests'), /permission denied/);
  await expectReject(() => call('create_standalone_art_request', [JSON.stringify({ id: '10000000-0000-0000-0000-000000000007', customer_id: 'cust-a', request_type: 'create_logo', art_name: 'No auth', instructions: 'x', requested_by: 'x', requested_by_name: 'x' })]), /permission denied/);
  await resetRole();
  await outsider();
  await expectReject(() => insertRequest('10000000-0000-0000-0000-000000000008'), /Active staff session required/);
  await expectReject(() => call('transition_standalone_art_request', [id, 'cancelled', '[]']), /Active staff session required/);
  const hiddenRows = await db.query('select * from standalone_art_requests');
  assert.equal(hiddenRows.rows.length, 0, 'RLS must hide requests from non-staff');
  await resetRole();
  console.log('Standalone art request migration checks passed.');
} catch (error) {
  console.error('Standalone art request migration checks failed:', error.stack || error);
  process.exitCode = 1;
} finally {
  await db.close();
}
