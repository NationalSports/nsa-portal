-- Cover the remaining uniform-order relationship lookups used by the staff
-- queue (assigned rep) and customer reorder chain (parent order).
create index if not exists uniform_order_requests_assigned_rep_id_idx
  on public.uniform_order_requests (assigned_rep_id)
  where assigned_rep_id is not null;

create index if not exists uniform_order_requests_parent_order_id_idx
  on public.uniform_order_requests (parent_order_id)
  where parent_order_id is not null;
