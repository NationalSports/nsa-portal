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
    ok((await db.query("select relrowsecurity from pg_class where oid = 'public.financial_expenses'::regclass")).rows[0].relrowsecurity);
    ok((await db.query("select relrowsecurity from pg_class where oid = 'public.financial_recurring_expenses'::regclass")).rows[0].relrowsecurity);
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
      for (const sql of ['select * from public.financial_expenses', 'insert into public.financial_expenses(id) values (gen_random_uuid())', "update public.financial_expenses set status='posted'", 'delete from public.financial_expenses', 'select * from public.financial_recurring_expenses']) {
        await assert.rejects(db.exec(sql), /permission denied/); checks++;
      }
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
