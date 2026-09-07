const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20260902192154_invoice_credit_memos.sql'),
  'utf8',
);

describe('invoice credit memo migration', () => {
  test('creates an audited memo linked to both invoice and account credit', () => {
    expect(SQL).toMatch(/create table if not exists public\.invoice_credit_memos/);
    expect(SQL).toMatch(/invoice_id\s+text not null references public\.invoices\(id\) on delete restrict/);
    expect(SQL).toMatch(/customer_credit_id\s+text not null unique references public\.customer_credits\(id\) on delete restrict/);
    expect(SQL).toMatch(/check \(abs\(amount - \(subtotal \+ tax \+ shipping\)\) < 0\.005\)/);
  });

  test('keeps the two postings atomic and locks the invoice against concurrent over-crediting', () => {
    expect(SQL).toMatch(/create or replace function public\.create_invoice_credit_memo/);
    expect(SQL).toMatch(/from public\.invoices\s+where id = p_invoice_id\s+for update/);
    expect(SQL).toMatch(/insert into public\.customer_credits/);
    expect(SQL).toMatch(/insert into public\.invoice_credit_memos/);
    expect(SQL).toMatch(/least\(coalesce\(v_invoice\.total, 0\), coalesce\(v_invoice\.paid, 0\)\)/);
    expect(SQL).toMatch(/Credit exceeds the remaining creditable amount/);
  });

  test('rejects repeated or cumulatively over-credited invoice lines', () => {
    expect(SQL).toMatch(/v_line_index = any\(v_seen_line_indexes\)/);
    expect(SQL).toMatch(/v_original_qty - v_prior_qty/);
    expect(SQL).toMatch(/Credit quantity exceeds the remaining quantity on invoice line/);
    expect(SQL).toMatch(/subtotal does not match the selected invoice quantities/);
  });

  test('is staff-only with explicit Data API grants', () => {
    expect(SQL).toMatch(/enable row level security/);
    expect(SQL).toMatch(/public\.is_team_member\(\)/);
    expect(SQL).toMatch(/revoke all on public\.invoice_credit_memos from public, anon/);
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.invoice_credit_memos to authenticated/);
    expect(SQL).toMatch(/security invoker/);
    expect(SQL).toMatch(/grant execute on function public\.create_invoice_credit_memo[\s\S]+to authenticated, service_role/);
  });
});
