-- A coach can name the order they build on the live-look catalog (the "Name
-- this order" field on their account). That name now rides along on the
-- request so the rep's estimate memo auto-fills from it (App.js estFromCatReq
-- → newE memo). Nullable + additive: older requests and guest carts simply
-- carry no order_name. Inserted by the catalog-order-request Netlify function
-- via service role; RLS stays locked.
ALTER TABLE public.catalog_order_requests
  ADD COLUMN IF NOT EXISTS order_name TEXT;
