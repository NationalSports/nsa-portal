// Scratch PostgreSQL proof for the per-document history migration.  This
// harness creates only its own in-memory database and never accepts a live URL.
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir)
  .filter(file => file.endsWith('_per_document_history_snapshots.sql'));
assert.equal(migrations.length, 1, `expected one per-document history migration, found ${migrations.length}`);

const migration = path.join('supabase/migrations', migrations[0]);

(async () => {
  const db = new PGlite();
  await db.waitReady;
  const exec = sql => db.exec(sql);
  const query = async (sql, values = []) => (await db.query(sql, values)).rows;
  const actor = async (role, staff) => {
    await exec('reset role');
    await exec(`set "test.staff" to '${staff ? 'true' : 'false'}'`);
    await exec(`set role ${role}`);
  };

  await exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create function public.is_team_member() returns boolean
      language sql stable
      as $$ select current_setting('test.staff', true) = 'true' $$;
    create table public.app_state (
      id text primary key,
      value text,
      updated_at timestamptz default now()
    );
    grant select, insert, update, delete on public.app_state to authenticated, service_role;
  `);

  await exec('begin');
  await exec(read(migration));
  await exec('commit');
  await exec(read('supabase/tests/document_history_snapshots_regression.sql'));
  console.log('PASS backfill, stale-blob preservation, dedupe, ordering, summary, and constraints');

  const staffEntry = JSON.stringify({
    ts: 'staff', captured_at: '2026-09-11T04:00:00Z', user: 'Staff',
    snapshot: { id: 'SO-RLS-STAFF', items: [{ sku: 'A' }] },
  });
  const directEntry = JSON.stringify({
    ts: 'direct', captured_at: '2026-09-11T04:01:00Z', user: 'Staff',
    snapshot: { id: 'SO-RLS-DIRECT', items: [] },
  });
  const nonstaffEntry = JSON.stringify({
    ts: 'nonstaff', captured_at: '2026-09-11T03:59:00Z', user: 'Coach',
    snapshot: { id: 'SO-NONSTAFF', items: [] },
  });
  const serviceEntry = JSON.stringify({
    ts: 'service', captured_at: '2026-09-11T04:02:00Z', user: 'Service',
    snapshot: { id: 'EST-RLS-SERVICE', items: [{ sku: 'B' }] },
  });

  await actor('anon', false);
  await assert.rejects(query('select * from public.document_history_snapshots'), /permission denied/);
  await assert.rejects(
    query("select public.append_document_history('so_history','SO-ANON','{\"snapshot\":{\"id\":\"SO-ANON\"}}'::jsonb)"),
    /permission denied/
  );
  await assert.rejects(
    query("insert into public.document_history_snapshots(kind,document_id,entry) values('so_history','SO-ANON','{\"snapshot\":{\"id\":\"SO-ANON\"}}')"),
    /permission denied/
  );
  await assert.rejects(query('select * from public.document_history_summary()'), /permission denied/);
  console.log('PASS anon cannot read, insert, or execute history RPCs');

  await actor('authenticated', false);
  assert.equal((await query('select * from public.document_history_snapshots')).length, 0);
  await assert.rejects(
    query('select public.append_document_history($1,$2,$3::jsonb)', ['so_history', 'SO-NONSTAFF', nonstaffEntry]),
    /row-level security|row security/
  );
  await assert.rejects(
    query("insert into public.document_history_snapshots(kind,document_id,entry) values('so_history','SO-NONSTAFF','{\"snapshot\":{\"id\":\"SO-NONSTAFF\"}}')"),
    /row-level security|row security/
  );
  console.log('PASS authenticated nonstaff sees no rows and cannot append');

  await actor('authenticated', true);
  await query('select public.append_document_history($1,$2,$3::jsonb)', ['so_history', 'SO-RLS-STAFF', staffEntry]);
  await query(
    'insert into public.document_history_snapshots(kind,document_id,entry) values($1,$2,$3::jsonb)',
    ['so_history', 'SO-RLS-DIRECT', directEntry]
  );
  assert.equal((await query('select * from public.document_history_snapshots')).length, 2);
  await assert.rejects(
    query("update public.document_history_snapshots set document_id='SO-CHANGED' where document_id='SO-RLS-STAFF'"),
    /permission denied/
  );
  await assert.rejects(
    query("delete from public.document_history_snapshots where document_id='SO-RLS-STAFF'"),
    /permission denied/
  );
  console.log('PASS staff can select and append but cannot update or delete');

  await actor('service_role', false);
  await query('select public.append_document_history($1,$2,$3::jsonb)', ['est_history', 'EST-RLS-SERVICE', serviceEntry]);
  await query(
    "insert into public.document_history_snapshots(kind,document_id,entry) values('est_history','EST-RLS-SERVICE-DIRECT','{\"snapshot\":{\"id\":\"EST-RLS-SERVICE-DIRECT\",\"items\":[]}}')"
  );
  assert.equal((await query("select count(*)::int as n from public.document_history_snapshots where document_id='EST-RLS-SERVICE'"))[0].n, 1);
  assert.equal((await query('select * from public.document_history_summary()')).length, 4);
  await assert.rejects(
    query("update public.document_history_snapshots set document_id='EST-CHANGED' where document_id='EST-RLS-SERVICE'"),
    /permission denied/
  );
  await assert.rejects(
    query("delete from public.document_history_snapshots where document_id='EST-RLS-SERVICE'"),
    /permission denied/
  );
  console.log('PASS service role has explicit read/append access without update/delete');

  await exec('reset role');
  console.log('ALL_DOCUMENT_HISTORY_SCENARIOS_PASSED');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
