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
    ok((await db.query("select public from storage.buckets where id = 'expense-receipts'")).rows[0].public === false);
    await db.exec(`insert into storage.objects values ('11111111-1111-4111-8111-111111111111','expense-receipts'), ('22222222-2222-4222-8222-222222222222','other');`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const sql of ['select * from public.financial_expenses', 'insert into public.financial_expenses(id) values (gen_random_uuid())', "update public.financial_expenses set status='posted'", 'delete from public.financial_expenses']) {
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
    await assert.rejects(db.exec("update public.financial_expenses set status='posted'"), /financial_expense_posted_identity/); checks++;
    await assert.rejects(db.exec('update public.financial_expenses set amount_cents=0'), /check constraint/); checks++;
    const claim = "update public.financial_expenses set status='posting',updated_at=now() where status in ('submitted','error') or (status='posting' and updated_at<now()-interval '2 minutes') returning id";
    ok((await db.query(claim)).rows.length === 1);
    ok((await db.query(claim)).rows.length === 0);
    await db.exec("update public.financial_expenses set status='posted',qb_entity_id='900',posted_at=now()");
    ok((await db.query('select status from public.financial_expenses')).rows[0].status === 'posted');
    console.log(`${checks} PostgreSQL schema, access, storage, and posting-claim checks passed.`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
