-- Transactional regression fixture for the unpaid invoice split RPC. Run only
-- after the atomic invoice and create-nonce migrations on a disposable DB.
begin;

do $$
declare
  v_result jsonb;
  v_before_memo text;
  v_after_memo text;
  v_count integer;
  v_original jsonb := '{
    "id":"INV-SPLIT-FIXTURE","customer_id":"C-SPLIT-FIXTURE",
    "total":50,"paid":0,"status":"open","cc_fee":0,"tax":5,"shipping":5,
    "memo":"split A","line_items":[{"sku":"A","name":"A","qty":1,"rate":40,"amount":40,"desc":"A"}]
  }'::jsonb;
  v_split jsonb := '{
    "id":"INV-SPLIT-FIXTURE-B","customer_id":"C-SPLIT-FIXTURE",
    "total":50,"paid":0,"status":"open","cc_fee":0,"tax":5,"shipping":5,
    "memo":"split B","line_items":[{"sku":"B","name":"B","qty":1,"rate":40,"amount":40,"desc":"B"}]
  }'::jsonb;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.customers (id, name) values ('C-SPLIT-FIXTURE', 'Split Fixture');
  select public.save_invoice_atomic(
    '{
      "id":"INV-SPLIT-FIXTURE","customer_id":"C-SPLIT-FIXTURE",
      "total":100,"paid":0,"status":"open","cc_fee":0,"tax":10,"shipping":10,
      "memo":"before split","line_items":[
        {"sku":"A","name":"A","qty":1,"rate":40,"amount":40,"desc":"A"},
        {"sku":"B","name":"B","qty":1,"rate":40,"amount":40,"desc":"B"}
      ]
    }'::jsonb,
    null, null, null
  ) into v_result;
  assert v_result ->> 'ok' = 'true', 'fixture invoice create should succeed';

  -- Exact partition, money conservation, relational child rebuild, and fresh
  -- return payload are all part of the one RPC response.
  select public.split_unpaid_invoice_atomic(v_original, v_split, 1) into v_result;
  assert v_result ->> 'ok' = 'true', 'unpaid split should succeed';
  assert jsonb_array_length(v_result -> 'original_items') = 1, 'original items must be rebuilt from line_items';
  assert jsonb_array_length(v_result -> 'split_items') = 1, 'split items must be rebuilt from line_items';
  select count(*) into v_count from public.invoices where id in ('INV-SPLIT-FIXTURE', 'INV-SPLIT-FIXTURE-B');
  assert v_count = 2, 'split must create exactly one sibling invoice';

  -- A collision is rejected before the original is changed.
  select memo into v_before_memo from public.invoices where id = 'INV-SPLIT-FIXTURE';
  select public.split_unpaid_invoice_atomic(
    v_original || jsonb_build_object('memo', 'must not commit'),
    v_split || jsonb_build_object('id', 'INV-SPLIT-FIXTURE-B'),
    2
  ) into v_result;
  assert v_result ->> 'reason' = 'ID_EXISTS', 'existing sibling id must reject the split';
  select memo into v_after_memo from public.invoices where id = 'INV-SPLIT-FIXTURE';
  assert v_after_memo = v_before_memo, 'collision must not partially update the original invoice';
end;
$$;

rollback;
