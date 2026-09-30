-- Pay-link requests are cancelled, never deleted: they are the record of what a customer was asked
-- to pay. Supabase's default table grants give `authenticated` DELETE, so take it back explicitly.
-- (Also folded into 20260930150000_invoice_pay_requests.sql for fresh environments.)
revoke delete on public.invoice_pay_requests from authenticated;
