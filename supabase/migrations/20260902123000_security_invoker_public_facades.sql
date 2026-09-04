-- Remove the final owner-privileged views from the public API.
--
-- Browser consumers now use allowlisted actions in webstore-checkout, whose
-- service-role client reads these views and returns only bounded, curated data.
-- Keeping the views themselves available only to service_role means callers
-- cannot use PostgREST to widen a query or bypass the endpoint's scope.

begin;

alter view public.webstores_public set (security_invoker = true);
alter view public.inventory_unified set (security_invoker = true);
alter view public.webstore_product_eta set (security_invoker = true);
alter view public.webstore_storefront_products set (security_invoker = true);
alter view public.webstore_templates_public set (security_invoker = true);
alter view public.adidas_crawl_queue set (security_invoker = true);
alter view public.adidas_crawl_coverage set (security_invoker = true);

revoke all on public.webstores_public from public, anon, authenticated;
revoke all on public.inventory_unified from public, anon, authenticated;
revoke all on public.webstore_product_eta from public, anon, authenticated;
revoke all on public.webstore_storefront_products from public, anon, authenticated;
revoke all on public.webstore_templates_public from public, anon, authenticated;
revoke all on public.adidas_crawl_queue from public, anon, authenticated;
revoke all on public.adidas_crawl_coverage from public, anon, authenticated;

grant select on public.webstores_public to service_role;
grant select on public.inventory_unified to service_role;
grant select on public.webstore_product_eta to service_role;
grant select on public.webstore_storefront_products to service_role;
grant select on public.webstore_templates_public to service_role;
grant select on public.adidas_crawl_queue to service_role;
grant select on public.adidas_crawl_coverage to service_role;

commit;
