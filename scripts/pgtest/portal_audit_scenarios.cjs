// Offline transaction/security regression runner. Creates independent in-memory
// PostgreSQL databases; never accepts a production connection string.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\\set .*$/gm, '');
const migration = name => read('supabase/migrations/' + name + '.sql');
async function run(name, work) {
  const db = new PGlite();
  try { await work(db); console.log('PASS ' + name); } finally { await db.close(); }
}
(async () => {
  await run('customer/invoice rollback, immutable ledger, defaults and stale versions', async db => {
    await db.exec(read('supabase/tests/atomic_persistence_schema.sql'));
    await db.exec(migration('20260904224513_atomic_customer_invoice_save'));
    await db.exec(migration('20260904231500_invoice_create_nonce_retry'));
    await db.exec(read('supabase/tests/atomic_persistence_fixture.sql'));
    await db.exec(migration('20260904230000_atomic_unpaid_invoice_split'));
    await db.exec(read('supabase/tests/atomic_unpaid_invoice_split_fixture.sql'));
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const draft = { id: 'INV-NONCE', memo: 'Original draft', client_create_id: '11111111-1111-4111-8111-111111111111' };
    const save = async value => (await db.query('select public.save_invoice_atomic($1::jsonb,null,null,null) as result', [JSON.stringify(value)])).rows[0].result;
    assert.equal((await save(draft)).ok, true);
    assert.equal((await save(draft)).idempotent, true);
    assert.equal((await save({ ...draft, memo: 'New unsaved edit' })).reason, 'STALE');
    assert.equal((await db.query("select memo from invoices where id='INV-NONCE'")).rows[0].memo, 'Original draft');
    await db.exec("update invoices set memo='Another user changed this' where id='INV-NONCE'");
    assert.equal((await save(draft)).reason, 'STALE');
    assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  });
  await run('Stripe exact cents, retry, ledger repair, authorization and full rollback', async db => {
    const marker = '-- The runner applies 20260904224514_atomic_stripe_invoice_settlement.sql here.';
    const [schema, scenarios] = read('scripts/pgtest/stripe_invoice_settlement_scenarios.sql').split(marker);
    assert(scenarios, 'Stripe fixture marker missing');
    await db.exec(schema);
    await db.exec(migration('20260904224514_atomic_stripe_invoice_settlement'));
    await db.exec(scenarios);
  });
  await run('public credentials, core RLS and configuration row restrictions', async db => {
    await db.exec(read('scripts/pgtest/portal_public_security_fixture.sql'));
    for (const name of ['20260904224715_portal_access_credentials', '20260904224722_lock_core_reads_to_staff', '20260904230554_restrict_public_app_state']) await db.exec(migration(name));
    await db.exec(read('scripts/pgtest/portal_public_security_scenarios.sql'));
  });
})().catch(error => { console.error(error.message, error.where || ''); process.exitCode = 1; });
