import fs from 'fs';
import path from 'path';

const SQL=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260904224604_atomic_fund_allocations.sql'),'utf8');

describe('atomic promo and credit allocation migration',()=>{
  test('gives both document types an explicit durable posting state',()=>{
    expect(SQL).toMatch(/alter table public\.sales_orders[\s\S]*fund_allocation_status/);
    expect(SQL).toMatch(/alter table public\.estimates[\s\S]*fund_allocation_status/);
    expect(SQL).toMatch(/Existing fund usage needs reconciliation/);
  });

  test('serializes a document and its shared parent-family pool',()=>{
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\('fund-document:'/);
    expect(SQL).toMatch(/v_promo_owner_id := coalesce\(v_customer\.parent_id, v_customer\.id\)/);
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\('fund-family:'/);
    expect(SQL).toMatch(/customer_promo_periods[\s\S]*for update/);
    expect(SQL).toMatch(/customer_credits[\s\S]*for update/);
  });

  test('replaces usage and balances in the same transaction for retry idempotency',()=>{
    expect(SQL).toMatch(/update public\.customer_promo_periods[\s\S]*delete from public\.customer_promo_usage[\s\S]*insert into public\.customer_promo_usage/);
    expect(SQL).toMatch(/update public\.customer_credits[\s\S]*delete from public\.customer_credit_usage[\s\S]*insert into public\.customer_credit_usage/);
    expect(SQL).toMatch(/promo funds insufficient/);
    expect(SQL).toMatch(/account credit insufficient/);
    expect(SQL).toMatch(/fund ledger counters need review before migration/);
    expect(SQL).toMatch(/promo ledger counters need review for customer/);
    expect(SQL).toMatch(/credit ledger counters need review for customer/);
    expect(SQL).not.toMatch(/set used = greatest\(0, round/);
  });

  test('makes estimate conversion unique and completes conversion with the posting',()=>{
    expect(SQL).toMatch(/create unique index if not exists uq_sales_orders_live_estimate/);
    expect(SQL).toMatch(/set status = 'converted'/);
    expect(SQL).toMatch(/fund_allocation_status = 'posted'/);
  });

  test('is staff-only on the authenticated PostgREST surface',()=>{
    expect(SQL).toMatch(/current_setting\('request\.jwt\.claims', true\)[\s\S]*v_role <> 'service_role'/);
    expect(SQL).toMatch(/auth\.uid\(\) is null or not public\.is_team_member\(\)/);
    expect(SQL).toMatch(/revoke all on function public\.set_document_fund_allocation[\s\S]*from public, anon, authenticated/);
    expect(SQL).toMatch(/grant execute on function public\.set_document_fund_allocation[\s\S]*to authenticated, service_role/);
  });
});
