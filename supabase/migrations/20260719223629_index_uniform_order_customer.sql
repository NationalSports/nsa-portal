-- Keep staff/customer order lookups covered as uniform-order volume grows.
create index if not exists uniform_order_requests_customer_id_idx
  on public.uniform_order_requests (customer_id)
  where customer_id is not null;
