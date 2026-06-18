-- Assign a CSR to a store so customer-order messages route to them.
-- (Stores already carry rep_id; this adds an optional CSR owner. Routing is
-- CSR-if-set, else the rep.)
alter table public.omg_stores add column if not exists csr_id text;
alter table public.webstores add column if not exists csr_id text;
