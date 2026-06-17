-- Every catalog load pages through products and customers with ORDER BY name
-- (App.js _dbLoad). The only name indexes were GIN trigram ones (for ILIKE search),
-- which cannot serve ORDER BY, so each page fetch re-sorted the whole table.
create index if not exists idx_products_name_btree on public.products (name);
create index if not exists idx_customers_name_btree on public.customers (name);
