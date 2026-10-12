-- New All School garment POs use XPO- plus the existing atomic PO allocator.
-- Existing POs and their external supplier references are never renamed.
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.create_purchase_order(text,jsonb,jsonb)'::regprocedure);
 if position($s$then 'XPO-'$s$ in d)>0 then return; end if;
 if position($s$v_po_number := 'NSA ' || v_num;$s$ in d)=0 then
  raise exception 'Expected shared PO allocator assignment is missing';
 end if;
 d:=replace(d,$s$v_po_number := 'NSA ' || v_num;$s$,
  $s$v_po_number := case when p_po->'threshold_eval'->>'lane' = 'all_school' then 'XPO-' else 'NSA ' end || v_num;$s$);
 execute d;
end
$migration$;
