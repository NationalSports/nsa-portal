-- The login-free coach portal (/?portal=<tag>, embedded on the marketing site at
-- /coach) reads all its data with the anon key via RLS — customers, sales_orders,
-- estimates, invoices, so_items, ... all carry *_anon_read SELECT policies.
--
-- The team-store tracking tables never got the equivalent policies, so CoachStore's
-- reads (webstores → webstore_orders → webstore_order_items + webstore_roster)
-- returned ZERO rows under anon RLS. The coach-facing store tracking therefore
-- silently rendered nothing on the public portal all along — it only ever showed
-- when staff viewed the portal inside the authenticated app — and the new Team
-- Store tab (gated on "customer has a store") would never appear for real coaches.
--
-- Add the missing SELECT-only anon policies, mirroring the portal's existing
-- pattern. Writes remain authenticated/service-role only (storefront checkout
-- writes orders via the service-role Netlify function).
drop policy if exists webstores_anon_read on public.webstores;
create policy webstores_anon_read on public.webstores
  for select to anon using (true);

drop policy if exists webstore_orders_anon_read on public.webstore_orders;
create policy webstore_orders_anon_read on public.webstore_orders
  for select to anon using (true);

drop policy if exists webstore_order_items_anon_read on public.webstore_order_items;
create policy webstore_order_items_anon_read on public.webstore_order_items
  for select to anon using (true);

drop policy if exists webstore_roster_anon_read on public.webstore_roster;
create policy webstore_roster_anon_read on public.webstore_roster
  for select to anon using (true);
