-- Public storefronts (anon key) must be able to read package-component products
-- that were archived (active=false) so they live only inside a bundle.
--
-- webstore_products had ONLY an `authenticated` policy (webstore_products_authenticated_all),
-- so the anon storefront fetch in Storefront.js (the compExtras loader that pulls archived
-- bundle components straight from webstore_products) returned ZERO rows under RLS. Every
-- archived component then collapsed to its shared base-catalog image — e.g. the San Joaquin
-- "Varsity Jersey Package", which holds two distinct jerseys (navy + white) sharing one base
-- SKU, rendered the same jersey twice on the storefront card.
--
-- Add a narrow anon SELECT policy that exposes only rows referenced by a bundle item —
-- exactly the component display data shoppers are meant to see (name, image, price,
-- decorations). Standalone/archived non-component products stay hidden from anon.
-- Mirrors the existing anon read policies on products + webstore_bundle_items, but scoped
-- tighter than their blanket `using (true)`.

alter table public.webstore_products enable row level security;

drop policy if exists webstore_products_anon_read_components on public.webstore_products;
create policy webstore_products_anon_read_components
  on public.webstore_products
  for select
  to anon
  using (
    id in (
      select webstore_product_id
      from public.webstore_bundle_items
      where webstore_product_id is not null
    )
  );
