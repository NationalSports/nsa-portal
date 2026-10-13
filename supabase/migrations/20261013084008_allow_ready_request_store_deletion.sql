-- store_id deliberately uses ON DELETE SET NULL so request history survives a
-- later store deletion. Do not require ready rows to retain that nullable link.
alter table public.webstore_build_requests
  drop constraint if exists webstore_build_requests_ready_has_store;
