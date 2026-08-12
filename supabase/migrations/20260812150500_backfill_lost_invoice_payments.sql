-- ============================================================
-- Backfill the payment records the client bug destroyed, so
-- commission lines sit in the month the invoice was PAID.
--
-- NOT APPLIED AUTOMATICALLY. Moving a commission line between
-- months changes statements for months that may already be paid
-- out, so this runs only on an explicit go-ahead. Review the
-- audit at the bottom first.
--
-- Companion to 20260812150000_invoice_payments_cc_fee.sql, which
-- fixes the cause. This repairs the damage already done: 158 of
-- 181 paid invoices carry no payment row, so CommissionsPage
-- falls back to the INVOICE date and books the commission in the
-- wrong month.
--
-- SOURCE OF TRUTH: audit_log. Every status change on invoices is
-- audited, so the UPDATE that first flipped an invoice to 'paid'
-- is the real payment date. Timestamps are converted to
-- America/Los_Angeles before the date is taken, so an evening
-- payment can't land on the next day (and the wrong month).
--
-- SCOPE: the 112 paid invoices that have (a) no payment row and
-- (b) an audited flip to paid. 67 of them currently commission in
-- the wrong month; the other 45 are already correct and get a row
-- anyway so their date can never drift again. The remaining 46
-- paid-with-no-row invoices are deliberately left alone --
-- verified individually: 28 were created already paid, and 18
-- predate the audit log (2026-06-24) but were last touched in
-- their own invoice month. All 46 already book to the right month
-- on the invoice-date fallback, so there is nothing to repair.
--
-- Rows are written with method 'recovered' and ref
-- 'RECOVERED-<invoice id>' -- never disguised as a check or card
-- payment, so the reconstruction stays visible on the invoice.
-- Idempotent: re-running inserts nothing (unique invoice_id,ref).
-- ============================================================

insert into public.invoice_payments (invoice_id, amount, method, ref, date, cc_fee)
select i.id,
       i.paid,
       'recovered',
       'RECOVERED-' || i.id,
       to_char((f.flipped_at at time zone 'America/Los_Angeles')::date, 'MM/DD/YYYY'),
       0
from public.invoices i
join (
  select a.row_id, min(a.changed_at) as flipped_at
  from public.audit_log a
  where a.table_name = 'invoices'
    and a.op = 'UPDATE'
    and coalesce(a.old_data->>'status','') <> 'paid'
    and a.new_data->>'status' = 'paid'
  group by a.row_id
) f on f.row_id = i.id
where i.status = 'paid'
  and i.deleted_at is null
  and coalesce(i.paid, 0) > 0
  and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id)
on conflict (invoice_id, ref) do nothing;

-- ── Audit (run before applying; read-only) ──────────────────
-- Lists every commission line this backfill moves, and where to.
--
-- with paid_inv as (
--   select i.id, i.date::date as inv_date, i.total, i.customer_id, i.so_id
--   from invoices i
--   where i.status='paid' and i.deleted_at is null
--     and not exists (select 1 from invoice_payments p where p.invoice_id=i.id)
-- ), flip as (
--   select a.row_id, min(a.changed_at) as flipped_at
--   from audit_log a
--   where a.table_name='invoices' and a.op='UPDATE'
--     and coalesce(a.old_data->>'status','') <> 'paid' and a.new_data->>'status'='paid'
--   group by a.row_id
-- )
-- select p.id, coalesce(t.name,'?') as rep, p.inv_date, p.total,
--        (f.flipped_at at time zone 'America/Los_Angeles')::date as paid_on,
--        to_char(p.inv_date,'YYYY-MM') || ' -> '
--          || to_char((f.flipped_at at time zone 'America/Los_Angeles'),'YYYY-MM') as move
-- from paid_inv p
-- join flip f on f.row_id=p.id
-- left join customers c on c.id=p.customer_id
-- left join sales_orders s on s.id=p.so_id
-- left join team_members t on t.id = coalesce(c.primary_rep_id, s.created_by)
-- where to_char(p.inv_date,'YYYY-MM')
--     <> to_char((f.flipped_at at time zone 'America/Los_Angeles'),'YYYY-MM')
-- order by f.flipped_at desc;
