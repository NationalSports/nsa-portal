// Run with a separately installed @electric-sql/pglite (no production dependency):
// PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/check-financial-expenses-schema.cjs
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
async function main() {
  const db = new PGlite();
  let checks = 0;
  const ok = condition => { assert.ok(condition); checks++; };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.team_members(id uuid primary key);
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text);
      alter table storage.objects enable row level security;
      grant usage on schema public, storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
      create policy existing_broad_policy on storage.objects for all to anon, authenticated using (true) with check (true);
      insert into public.team_members values ('00000000-0000-0000-0000-000000000001');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260908012527_financial_expenses.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260922090000_financial_card_feed.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260923033522_harden_financial_card_feed.sql'), 'utf8'));
    ok((await db.query("select relrowsecurity from pg_class where oid = 'public.financial_expenses'::regclass")).rows[0].relrowsecurity);
    ok((await db.query("select relrowsecurity from pg_class where oid = 'public.financial_recurring_expenses'::regclass")).rows[0].relrowsecurity);
    for (const table of ['financial_card_connections', 'financial_card_accounts', 'financial_card_transactions', 'financial_expense_rules']) {
      ok((await db.query(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`)).rows[0].relrowsecurity);
    }
    const schedules = (await db.query("select label, default_amount_cents, requires_accounting_split from public.financial_recurring_expenses order by label")).rows;
    ok(schedules.length === 3);
    ok(schedules.find(row => row.label === 'Tesla loan payment').default_amount_cents === 112977);
    ok(schedules.find(row => row.label === 'Rivian loan payment').default_amount_cents === 121199);
    ok(schedules.find(row => row.label === 'T-Mobile service').default_amount_cents === null);
    ok(schedules.filter(row => row.requires_accounting_split).length === 2);
    const accountNumberColumns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='financial_expenses' and column_name in ('expense_account_number','payment_account_number') order by column_name")).rows;
    ok(accountNumberColumns.length === 2);
    ok((await db.query("select public from storage.buckets where id = 'expense-receipts'")).rows[0].public === false);
    await db.exec(`insert into storage.objects values ('11111111-1111-4111-8111-111111111111','expense-receipts'), ('22222222-2222-4222-8222-222222222222','other');`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const sql of ['select * from public.financial_expenses', 'insert into public.financial_expenses(id) values (gen_random_uuid())', "update public.financial_expenses set status='posted'", 'delete from public.financial_expenses', 'select * from public.financial_recurring_expenses',
        'select * from public.financial_card_connections', 'select * from public.financial_card_accounts', 'select * from public.financial_card_transactions', 'select * from public.financial_expense_rules']) {
        await assert.rejects(db.exec(sql), /permission denied/); checks++;
      }
      await assert.rejects(db.exec("select public.financial_apply_card_sync(gen_random_uuid(),gen_random_uuid(),'[]','[]','[]','cursor')"), /permission denied/); checks++;
      const objects = (await db.query('select bucket_id from storage.objects')).rows;
      ok(objects.length === 1 && objects[0].bucket_id === 'other');
      await assert.rejects(db.exec("insert into storage.objects values (gen_random_uuid(),'expense-receipts')"), /row-level security/); checks++;
      ok((await db.query("update storage.objects set bucket_id='other' where bucket_id='expense-receipts' returning *")).rows.length === 0);
      ok((await db.query("delete from storage.objects where bucket_id='expense-receipts' returning *")).rows.length === 0);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload)
      values ('33333333-3333-4333-8333-333333333333','national','123','00000000-0000-0000-0000-000000000001','Test merchant','2026-08-31',100,'Test','business','1','Travel','2','Checking','Purchase','{}');`);
    ok((await db.query('select count(*)::int as n from public.financial_expenses')).rows[0].n === 1);
    await db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,recurring_template_id,recurring_month)
      values ('44444444-4444-4444-8444-444444444444','national','123','00000000-0000-0000-0000-000000000001','T-Mobile','2026-09-01',50000,'Monthly service','business','1','Telephone','2','Checking','Purchase','{}','a50f6e8d-1c53-4f88-9f91-dc7d3c4b74cb','2026-09-01');`);
    await assert.rejects(db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,recurring_template_id,recurring_month)
      values ('55555555-5555-4555-8555-555555555555','national','123','00000000-0000-0000-0000-000000000001','T-Mobile','2026-09-02',51000,'Monthly service','business','1','Telephone','2','Checking','Purchase','{}','a50f6e8d-1c53-4f88-9f91-dc7d3c4b74cb','2026-09-01')`), /unique constraint/); checks++;
    await db.exec("update public.financial_expenses set status='cancelled' where id='44444444-4444-4444-8444-444444444444'");
    await db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,recurring_template_id,recurring_month)
      values ('55555555-5555-4555-8555-555555555555','national','123','00000000-0000-0000-0000-000000000001','T-Mobile','2026-09-02',51000,'Monthly service','business','1','Telephone','2','Checking','Purchase','{}','a50f6e8d-1c53-4f88-9f91-dc7d3c4b74cb','2026-09-01');`);
    ok((await db.query("select count(*)::int as n from public.financial_expenses where recurring_template_id is not null")).rows[0].n === 2);
    await db.exec(`insert into public.financial_card_connections
      (id,company_key,provider_item_id,access_token_ciphertext,institution_name,created_by)
      values ('66666666-6666-4666-8666-666666666666','national','item-test','v1:ciphertext','Test Bank','00000000-0000-0000-0000-000000000001');
      insert into public.financial_card_accounts
      (id,connection_id,company_key,provider_account_id,name,account_type,qbo_payment_account_id,qbo_payment_account_name,qbo_realm_id)
      values ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','national','account-test','Business Card','credit','2','Business Card','123');
      insert into public.financial_card_transactions
      (id,connection_id,account_id,company_key,provider_transaction_id,transaction_date,description,amount_cents,status,expense_account_id,expense_account_name,purpose,expense_realm_id)
      values ('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777','national','txn-test','2026-09-20','Card charge',4852,'ready','1','Telephone','Monthly mobile service','123');
      insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,card_transaction_id)
      values ('99999999-9999-4999-8999-999999999999','national','123','00000000-0000-0000-0000-000000000001','Card charge','2026-09-20',4852,'Monthly mobile service','business','1','Telephone','2','Business Card','Purchase','{}','88888888-8888-4888-8888-888888888888');`);
    ok((await db.query("select status from public.financial_card_transactions where id='88888888-8888-4888-8888-888888888888'")).rows[0].status === 'submitted');
    await assert.rejects(db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,card_transaction_id)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','national','123','00000000-0000-0000-0000-000000000001','Duplicate','2026-09-20',4852,'Duplicate','business','1','Telephone','2','Business Card','Purchase','{}','88888888-8888-4888-8888-888888888888')`), /Card transaction or mapping changed|unique constraint/); checks++;
    const connectionId = '66666666-6666-4666-8666-666666666666';
    const lockId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const source = { account_id: 'account-test', transaction_id: 'txn-test', date: '2026-09-20', description: 'Card charge',
      amount_cents: 5000, currency: 'USD', pending: false, merchant_key: 'card charge' };
    await db.exec(`update public.financial_card_connections set sync_lock_id='${lockId}',sync_locked_until=now()+interval '2 minutes' where id='${connectionId}'`);
    await db.query('select public.financial_apply_card_sync($1,$2,$3,$4,$5,$6)', [connectionId, lockId,
      JSON.stringify([{ account_id: 'account-test', name: 'Renamed card', type: 'credit' }]), JSON.stringify([source]), '[]', 'complete-cursor']);
    const synced = (await db.query("select * from public.financial_card_transactions where provider_transaction_id='txn-test'")).rows[0];
    ok(synced.amount_cents === 5000 && synced.status === 'submitted' && synced.financial_expense_id === '99999999-9999-4999-8999-999999999999');
    ok(synced.expense_account_id === '1' && synced.purpose === 'Monthly mobile service');
    ok((await db.query("select qbo_payment_account_id from public.financial_card_accounts where provider_account_id='account-test'")).rows[0].qbo_payment_account_id === '2');
    ok((await db.query('select sync_cursor from public.financial_card_connections where id=$1', [connectionId])).rows[0].sync_cursor === 'complete-cursor');
    await assert.rejects(db.query('select public.financial_apply_card_sync($1,$2,$3,$4,$5,$6)', [connectionId, lockId, '[]', '[]', '[]', 'stale']), /lease expired/); checks++;
    await db.exec("update public.financial_expenses set status='cancelled' where id='99999999-9999-4999-8999-999999999999'");
    const cancelledCard = (await db.query("select status,financial_expense_id from public.financial_card_transactions where provider_transaction_id='txn-test'")).rows[0];
    ok(cancelledCard.status === 'ready' && cancelledCard.financial_expense_id === null);
    await assert.rejects(db.exec(`insert into public.financial_expenses
      (id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,purpose,payment_kind,expense_account_id,expense_account_name,payment_account_id,payment_account_name,qb_entity_type,qb_payload,card_transaction_id)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','national','123','00000000-0000-0000-0000-000000000001','Card charge','2026-09-20',4852,'Monthly mobile service','business','1','Telephone','2','Business Card','Purchase','{}','88888888-8888-4888-8888-888888888888')`), /Card transaction or mapping changed/); checks++;
    ok((await db.query("select count(*)::int as n from public.financial_expenses where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0].n === 0);
    await assert.rejects(db.exec("update public.financial_expenses set card_transaction_id=null where id='99999999-9999-4999-8999-999999999999'"), /source cannot be changed/); checks++;
    // A malformed later row must roll back the whole sync, including account updates and cursor.
    await db.exec(`update public.financial_card_connections set sync_lock_id='${lockId}',sync_locked_until=now()+interval '2 minutes' where id='${connectionId}'`);
    await assert.rejects(db.query('select public.financial_apply_card_sync($1,$2,$3,$4,$5,$6)', [connectionId, lockId, '[]',
      JSON.stringify([{ ...source, amount_cents: 6000 }, { ...source, transaction_id: 'bad', date: 'not-a-date' }]), '[]', 'bad-cursor']), /date/); checks++;
    ok((await db.query("select amount_cents from public.financial_card_transactions where provider_transaction_id='txn-test'")).rows[0].amount_cents === 5000);
    ok((await db.query('select sync_cursor from public.financial_card_connections where id=$1', [connectionId])).rows[0].sync_cursor === 'complete-cursor');
    await assert.rejects(db.exec("update public.financial_expenses set status='posted'"), /financial_expense_posted_identity/); checks++;
    await assert.rejects(db.exec('update public.financial_expenses set amount_cents=0'), /check constraint/); checks++;
    const claim = "update public.financial_expenses set status='posting',updated_at=now() where id='33333333-3333-4333-8333-333333333333' and (status in ('submitted','error') or (status='posting' and updated_at<now()-interval '2 minutes')) returning id";
    ok((await db.query(claim)).rows.length === 1);
    ok((await db.query(claim)).rows.length === 0);
    await db.exec("update public.financial_expenses set status='posted',qb_entity_id='900',posted_at=now() where id='33333333-3333-4333-8333-333333333333'");
    ok((await db.query("select status from public.financial_expenses where id='33333333-3333-4333-8333-333333333333'")).rows[0].status === 'posted');
    console.log(`${checks} PostgreSQL schema, access, storage, and posting-claim checks passed.`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
