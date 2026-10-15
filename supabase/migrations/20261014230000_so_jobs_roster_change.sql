-- Numbers/names edited on the SO after a job was lined up (In Line / In Process).
-- Set by the portal's save path; cleared when production marks the sheet reprinted.
-- Shape: {at, by, status, changes:[{kind, sku, color, size, from, to}]}
alter table public.so_jobs add column if not exists roster_change jsonb;
