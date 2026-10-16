-- Let the Unapply button handle card payments recorded on the Receive Payments page.
-- Only the payment-method check changes; the rest of the function is identical to
-- 20261008152808_unapply_invoice_payments.sql. Card rows from Stripe or the invoice Pay
-- button (no receipt_id, or a surcharge) are still refused.
create or replace function public.unapply_invoice_payment(p_invoice_id text,p_payment_ref text,p_expected_payment jsonb,p_reason text,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.invoice_payments%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_prior public.invoice_payment_unapplications%rowtype;
  v_sum numeric;
  v_qbo boolean;
  v_qbo_ids jsonb;
  v_actor text;
begin
  if current_user <> 'service_role' then raise exception 'Server authorization required'; end if;
  select name into v_actor from public.team_members where id=p_actor_id and coalesce(is_active,true)
    and id in ('00000000-0000-0000-0000-000000000001','35436542-e7f2-49db-8120-6111cf83b960','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041');
  if not found then raise exception 'Payment accounting access required'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 or length(p_reason)>1000 then raise exception 'Enter a reason (3–1000 characters)'; end if;
  -- Serialize against the existing hourly run claim. Never change its settings.
  perform 1 from public.qbo_sales_settings where company_key='national' for update;
  if exists(select 1 from public.qbo_sales_runs where company_key='national' and status='running' and lease_expires_at>now()) then
    raise exception 'QuickBooks sync is running. Retry after it finishes.';
  end if;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into v_prior from public.invoice_payment_unapplications where invoice_id=p_invoice_id and payment_ref=p_payment_ref;
  if found then
    return jsonb_build_object('already_unapplied',true,'invoice',to_jsonb(v_invoice),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.invoice_payments p where invoice_id=p_invoice_id),'receipt_id',v_prior.receipt_id,'qbo_review_required',v_prior.qbo_review_required);
  end if;
  select * into v_payment from public.invoice_payments where invoice_id=p_invoice_id and ref=p_payment_ref for update;
  if not found then raise exception 'Payment no longer exists. Reload the invoice.'; end if;
  if jsonb_build_object('amount',v_payment.amount,'method',v_payment.method,'date',v_payment.date,'receipt_id',v_payment.receipt_id)
    is distinct from p_expected_payment then raise exception 'Payment changed. Reload before unapplying.'; end if;
  -- Card is allowed only when it was entered through Receive Payments (has a receipt) with no
  -- surcharge. Stripe/older card rows have no receipt and stay blocked.
  if not (v_payment.method in ('check','ach','venmo','zelle','cash') or (v_payment.method='cc' and v_payment.receipt_id is not null))
    or v_payment.amount<=0 or coalesce(v_payment.cc_fee,0)<>0 then
    raise exception 'Only manual cash/check/ACH/Zelle/Venmo applications, and card payments entered in Receive Payments, can be unapplied here. Other card, credit, and imported payments need separate review.';
  end if;
  if lower(coalesce(v_invoice.status,''))='void' then raise exception 'Cannot unapply from a void invoice'; end if;
  select coalesce(sum(amount),0) into v_sum from public.invoice_payments where invoice_id=p_invoice_id;
  if abs(v_sum-coalesce(v_invoice.paid,0))>0.005 then raise exception 'Invoice paid total and payment history differ. Reconcile before unapplying.'; end if;
  -- Any QBO invoice link is enough to require review: a missing payment link is
  -- not proof that a previous QBO write never happened.
  v_qbo := nullif(v_invoice.qb_invoice_id,'') is not null;
  select coalesce(jsonb_agg(value::jsonb->>'qbo_id'),'[]') into v_qbo_ids from public.app_state
    where left(id,12)='_qb_link_v1_' and value is not null and left(btrim(value),1)='{'
      and value::jsonb->>'map_key'='qbPaymentMap' and value::jsonb->>'source_id'='payment:'||v_payment.id;
  v_qbo := v_qbo or jsonb_array_length(v_qbo_ids)>0 or exists(select 1 from public.app_state where left(id,12)='_qb_link_v1_' and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbInvoiceMap' and value::jsonb->>'source_id'=p_invoice_id);
  if v_payment.receipt_id is not null then
    select * into v_receipt from public.payment_receipts where id=v_payment.receipt_id for update;
    if not found then raise exception 'Original receipt is missing'; end if;
    v_qbo := v_qbo or v_receipt.qb_payment_id is not null or v_receipt.reconciliation_hold;
    update public.payment_receipts set reconciliation_hold=reconciliation_hold or v_qbo,updated_at=now()
      where id=v_receipt.id returning * into v_receipt;
  else
    insert into public.payment_receipts(id,customer_id,amount,method,ref,received_date,memo,created_by,reconciliation_hold)
      values('RCPT-UNAPPLY-'||v_payment.id,v_invoice.customer_id,v_payment.amount,v_payment.method,v_payment.ref,v_payment.date,
        'Unapplied from '||p_invoice_id||'. '||btrim(p_reason)||case when v_qbo then ' QuickBooks review required; this is not new cash received.' else '' end,v_actor,v_qbo)
      returning * into v_receipt;
  end if;
  insert into public.invoice_payment_unapplications(payment_id,invoice_id,payment_ref,receipt_id,payment,reason,actor_id,qbo_review_required)
    values(v_payment.id,p_invoice_id,p_payment_ref,v_receipt.id,to_jsonb(v_payment)||jsonb_build_object('qbo_payment_ids',v_qbo_ids),btrim(p_reason),p_actor_id,v_qbo);
  delete from public.invoice_payments where id=v_payment.id;
  perform set_config('nsa.unapply_payment','on',true);
  update public.invoices set paid=v_sum-v_payment.amount,
    status=case when v_sum-v_payment.amount>=total-0.005 then 'paid' when v_sum-v_payment.amount>0.005 then 'partial' else 'open' end,
    payment_revision=payment_revision+1 where id=p_invoice_id returning * into v_invoice;
  perform set_config('nsa.unapply_payment','off',true);
  return jsonb_build_object('invoice',to_jsonb(v_invoice),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.invoice_payments p where invoice_id=p_invoice_id),
    'receipt_id',v_receipt.id,'qbo_review_required',v_qbo);
end $$;

revoke all on function public.unapply_invoice_payment(text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.unapply_invoice_payment(text,text,jsonb,text,text) to service_role;
