-- save_sales_order_atomic is SECURITY INVOKER. Its stale-version fast path
-- reads this table after checking is_team_member(), but the quarantine migration
-- revoked all client privileges. Every stale staff save therefore failed with
-- 42501 permission denied instead of the intended 40001 edit conflict.
-- Expose only the lookup column, only to active staff. Operator notes and all
-- writes remain private; the save function keeps its existing invoker security.
begin;
grant select (document_id) on public.save_storm_quarantine to authenticated;
create policy save_storm_quarantine_staff_lookup
  on public.save_storm_quarantine
  for select to authenticated
  using ((select public.is_team_member()));
commit;
