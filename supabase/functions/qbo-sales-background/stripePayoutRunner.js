import { planStripePayout, verifyStripeDeposit } from './stripePayouts.js';
import { sha256 } from './logic.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const expectedDeposit=payload=>({payload,marker:payload.PrivateNote,amountCents:payload.Line.reduce((n,l)=>n+Math.round(Number(l.Amount)*100),0)});
const checked=result=>{if(result.error)fail('stripe_payout_source_read_failed');return result.data;};
const linkKey=(realm,mapKey,id)=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify([realm,mapKey,id]));
async function link(admin,realm,mapKey,id){
  const row=checked(await admin.from('app_state').select('value').eq('id',linkKey(realm,mapKey,id)).maybeSingle());
  let value;try{value=JSON.parse(row?.value||'null');}catch{fail('stripe_payout_mapping_invalid');}
  if(!value||value.active===false||value.realm_id!==realm||value.map_key!==mapKey||value.source_id!==id||!value.qbo_id)fail('stripe_payout_mapping_missing');
  return String(value.qbo_id);
}
async function saveState(admin,payoutId,realm,row){
  const existing=checked(await admin.from('qbo_stripe_payout_postings').select('*').eq('stripe_payout_id',payoutId).maybeSingle());
  if(existing&&existing.realm_id!==realm)fail('stripe_payout_realm_conflict');
  // Never overwrite a durable dispatch marker with a fresh proposal or a hold.
  if(existing&&['submitting','unknown','posted'].includes(existing.state)&&['proposed','held'].includes(row.state))return existing;
  checked(await admin.from('qbo_stripe_payout_postings').upsert({stripe_payout_id:payoutId,realm_id:realm,...row,updated_at:new Date().toISOString()}));
  return existing;
}
async function paymentsFor(admin,qbo,transactions,realm){
  const payments=[];
  for(const tx of transactions){
    if(!tx.payment_intent_id||!['charge','payment'].includes(tx.transaction_type))fail('stripe_payout_unsupported_activity');
    const result=await admin.from('invoice_payments').select('*',{count:'exact'}).eq('ref',`Stripe ${tx.payment_intent_id}`).limit(2);
    const rows=checked(result)||[];
    if(result.count!==1||rows.length!==1||Number(rows[0].amount)<=0)fail('stripe_payout_payment_mapping_ambiguous');
    const row=rows[0];
    const invoice=checked(await admin.from('invoices').select('id,customer_id,so_id,total,status').eq('id',row.invoice_id).single());
    if(!invoice||['void','cancelled'].includes(invoice.status))fail('stripe_payout_invoice_not_active');
    if(tx.webstore_order_id){
      const order=checked(await admin.from('webstore_orders').select('so_id,stripe_pi_id').eq('id',tx.webstore_order_id).single());
      if(order?.so_id!==invoice.so_id||order?.stripe_pi_id!==tx.payment_intent_id)fail('stripe_payout_order_mapping_conflict');
    }
    const paymentId=await link(admin,realm,'qbPaymentMap',`payment:${row.id}`);
    const invoiceId=await link(admin,realm,'qbInvoiceMap',`portal:${invoice.id}`);
    const customerId=await link(admin,realm,'custQBMap',String(invoice.customer_id));
    const liveInvoice=(await qbo.request(`/invoice/${invoiceId}`)).Invoice;
    if(!liveInvoice||String(liveInvoice.CustomerRef?.value)!==customerId||Math.round(Number(liveInvoice.TotalAmt)*100)!==Math.round(Number(invoice.total)*100))fail('stripe_payout_invoice_mapping_conflict');
    const payment=(await qbo.request(`/payment/${paymentId}`)).Payment;
    payments.push({payment_intent_id:tx.payment_intent_id,portal_payment_id:row.id,portalPayment:row,date:row.date,currency:tx.currency,qboPayment:payment,qboInvoice:liveInvoice,qboInvoiceId:invoiceId,qboCustomerId:customerId,invoiceTotal:invoice.total});
  }
  return payments;
}

// Runs under the existing sales-run lease after invoice/payment sync. Defaults
// off and previews by default. Financial uncertainty never retries a POST.
export async function runStripePayouts({admin,qbo,settings,accounts,undepositedId,runId,leaseToken,canWrite,renewLease,homeCurrency,bookCloseDate}){
  const summary={examined:0,proposed:0,posted:0,recovered:0,held:0,next_offset:0};
  if(settings.stripe_payouts_enabled!==true)return {...summary,disabled:true};
  if(!settings.stripe_payout_start_date||!settings.stripe_payout_bank_account_id||!settings.stripe_payout_fee_account_id)return {...summary,configuration_error:'stripe_payout_configuration_missing'};
  if(homeCurrency!=='USD')return {...summary,configuration_error:'stripe_payout_home_currency_not_verified'};
  const realm=String(qbo.realmId),limit=5;
  const countResult=await admin.from('stripe_payouts').select('stripe_payout_id',{count:'exact',head:true}).is('qbo_deposit_id',null).gte('arrival_date',settings.stripe_payout_start_date);
  checked(countResult);const count=countResult.count||0;if(!count)return summary;
  const offset=Math.max(0,Number(settings.continuation_cursor?.stripe_payout_offset)||0)%count;
  let query=admin.from('stripe_payouts').select('*').is('qbo_deposit_id',null).gte('arrival_date',settings.stripe_payout_start_date).order('stripe_created_at',{ascending:true}).order('stripe_payout_id',{ascending:true});
  if(settings.stripe_payout_canary_id)query=query.eq('stripe_payout_id',settings.stripe_payout_canary_id);
  const payouts=checked(await query.range(settings.stripe_payout_canary_id?0:offset,settings.stripe_payout_canary_id?0:offset+limit-1))||[];
  summary.next_offset=settings.stripe_payout_canary_id?0:(offset+payouts.length)%count;
  // Full paged inventory: a manually entered deposit on another date must not
  // become invisible to duplicate-payment checks. queryAll fails at its cap.
  let deposits=null;
  for(const payout of payouts){
    const id=payout.stripe_payout_id;let dispatched=false;
    summary.examined++;
    try{
      await renewLease();
      const existing=checked(await admin.from('qbo_stripe_payout_postings').select('*').eq('stripe_payout_id',id).maybeSingle());
      if(existing&&existing.realm_id!==realm)fail('stripe_payout_realm_conflict');
      if(!deposits)deposits=await qbo.queryAll('Deposit');
      // A persisted payload is immutable once dispatch begins. Recover it even
      // if QBO now reports those payments deposited and the planner would hold.
      if(existing&&['submitting','unknown','posted'].includes(existing.state)){
        const matches=deposits.filter(d=>d.PrivateNote===existing.payload?.PrivateNote);
        if(matches.length!==1)fail(matches.length?'stripe_payout_duplicate_deposits':'stripe_payout_dispatch_unknown');
        if(existing.qbo_deposit_id&&String(matches[0].Id)!==existing.qbo_deposit_id)fail('stripe_payout_receipt_conflict');
        verifyStripeDeposit(expectedDeposit(existing.payload),matches[0]);
        await markPosted(admin,payout,realm,existing.payload,existing.source_hash,existing.request_id,matches[0],runId);
        summary.recovered++;continue;
      }
      const txResult=await admin.from('stripe_balance_transactions').select('*',{count:'exact'}).eq('stripe_payout_id',id).order('stripe_balance_transaction_id').limit(500);
      const transactions=checked(txResult)||[];
      if(txResult.count!==transactions.length)fail('stripe_payout_too_many_transactions');
      const payments=await paymentsFor(admin,qbo,transactions,realm);
      const plan=await planStripePayout({payout,transactions,payments,accounts:{bankAccount:accounts.find(a=>String(a.Id)===settings.stripe_payout_bank_account_id),feeAccount:accounts.find(a=>String(a.Id)===settings.stripe_payout_fee_account_id),undepositedAccount:accounts.find(a=>String(a.Id)===undepositedId)},settings});
      const payload=plan.payload,hash=await sha256(JSON.stringify({payload,transactions}));
      const matches=deposits.filter(d=>d.PrivateNote===payload.PrivateNote);
      if(matches.length>1)fail('stripe_payout_duplicate_deposits');
      if(matches.length){
        verifyStripeDeposit(plan,matches[0]);
        // A matching external document is only adopted after exact read-back.
        await markPosted(admin,payout,realm,payload,hash,null,matches[0],runId);summary.recovered++;continue;
      }
      const ids=new Set(plan.paymentIds.map(String));
      if(deposits.some(d=>(d.Line||[]).some(l=>(l.LinkedTxn||[]).some(t=>t.TxnType==='Payment'&&ids.has(String(t.TxnId))))))fail('stripe_payout_payment_already_deposited');
      if(bookCloseDate&&payout.arrival_date<=bookCloseDate)fail('stripe_payout_closed_accounting_period');
      summary.proposed++;
      if(!canWrite||settings.stripe_payout_writes_enabled!==true){
        await saveState(admin,id,realm,{state:'proposed',payload,source_hash:hash,error_code:null,run_id:runId});continue;
      }
      // Recheck mutable source data after remote reads and before dispatch.
      const freshResult=await admin.from('stripe_balance_transactions').select('*',{count:'exact'}).eq('stripe_payout_id',id).order('stripe_balance_transaction_id').limit(500);
      const fresh=checked(freshResult);
      if(freshResult.count!==transactions.length)fail('stripe_payout_source_changed');
      if(await sha256(JSON.stringify({payload,transactions:fresh}))!==hash)fail('stripe_payout_source_changed');
      const requestId='nsa-sp-'+(await sha256(realm+':'+id)).slice(0,40);
      const claimed=checked(await admin.rpc('claim_qbo_stripe_payout',{p_payout_id:id,p_run_id:runId,p_lease_token:leaseToken,p_payload:payload,p_source_hash:hash,p_request_id:requestId}));
      if(claimed!==true)fail('stripe_payout_claim_refused');
      dispatched=true;
      const created=(await qbo.request(`/deposit?requestid=${requestId}`,{method:'POST',body:JSON.stringify(payload)})).Deposit;
      if(!created?.Id)fail('stripe_payout_create_unknown');
      const verified=(await qbo.request(`/deposit/${created.Id}`)).Deposit;
      verifyStripeDeposit(plan,verified);
      await markPosted(admin,payout,realm,payload,hash,requestId,verified,runId);
      deposits.push(verified);summary.posted++;
    }catch(error){
      const code=String(error?.code||'stripe_payout_failed');summary.held++;
      if(dispatched){
        checked(await admin.from('qbo_stripe_payout_postings').update({state:'unknown',error_code:code,updated_at:new Date().toISOString()}).eq('stripe_payout_id',id).neq('state','posted'));
      }else{
        await saveState(admin,id,realm,{state:'held',error_code:code,run_id:runId});
      }
    }
  }
  return summary;
}
async function markPosted(admin,payout,realm,payload,hash,requestId,deposit,runId){
  const now=new Date().toISOString();
  await saveState(admin,payout.stripe_payout_id,realm,{state:'posted',payload,source_hash:hash,request_id:requestId,qbo_deposit_id:String(deposit.Id),error_code:null,run_id:runId,posted_at:now});
  const receipt=checked(await admin.from('qbo_stripe_payout_postings').select('state,qbo_deposit_id,source_hash').eq('stripe_payout_id',payout.stripe_payout_id).single());
  if(receipt?.state!=='posted'||receipt.qbo_deposit_id!==String(deposit.Id)||receipt.source_hash!==hash)fail('stripe_payout_receipt_readback_failed');
  checked(await admin.from('stripe_payouts').update({qbo_deposit_id:String(deposit.Id),qbo_posted_at:now}).eq('stripe_payout_id',payout.stripe_payout_id));
}
