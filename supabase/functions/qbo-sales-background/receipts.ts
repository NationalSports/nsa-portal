// Writes one received check (payment_receipts) to QBO as ONE payment — see the receipt section
// of index.ts for when this runs and logic.js (planReceiptPayment) for how `plan` is built.
// Kept apart from index.ts so it can be exercised against a fake QBO client in tests.
import {
  clean, compareReceiptPayment, money, parseDate, paymentIdentity, paymentLineTotals, receiptMarker,
  receiptPaymentLines, receiptPaymentRef, receiptPrivateNote,
} from './logic.js';

const escapeQbo=(value:unknown)=>clean(value).replaceAll("'","\\'");
const fail=(code:string,message:string,details?:unknown)=>Object.assign(new Error(message),{code,...(details?{details}:{})});

type Ctx={
  admin:any; qbo:{request:(path:string,init?:any)=>Promise<any>;query:(q:string)=>Promise<any>};
  receipt:any; plan:any; depositId:string; runId:string; sourceId:string;
  persist:(mapKey:string,sourceId:string,qboId:string,evidence:any)=>Promise<unknown>;
};

// The QBO payment is found by durable link, else by the [RCPT-…] memo marker (a previous run
// that created it but died before saving links). Every write moves QBO to the receipt's full
// target lines and is read back before any Portal link is saved.
export async function writeReceiptPayment({admin,qbo,receipt,plan,depositId,runId,sourceId,persist}:Ctx){
  const marker=receiptMarker(receipt),date=parseDate(receipt.received_date);
  let existing:any=null;
  if(plan.qboPaymentId)existing=(await qbo.request(`/payment/${plan.qboPaymentId}`)).Payment;
  else{
    const all=(await qbo.query(`SELECT * FROM Payment WHERE CustomerRef = '${escapeQbo(plan.qboCustomerId)}' MAXRESULTS 1000`))?.QueryResponse?.Payment||[];
    const marked=all.filter((p:any)=>clean(p.PrivateNote).includes(marker));
    if(marked.length>1)throw fail('receipt_payment_ambiguous','More than one QBO payment carries this receipt marker.',{qbo_ids:marked.map((p:any)=>String(p.Id))});
    if(marked.length)existing=(await qbo.request(`/payment/${marked[0].Id}`)).Payment;
  }
  if(existing&&(!clean(existing.PrivateNote).includes(marker)||String(existing.CustomerRef?.value)!==plan.qboCustomerId||money(existing.TotalAmt)!==plan.amount))
    throw fail('receipt_payment_identity_changed','The linked QBO payment no longer matches this receipt.',{qbo_id:String(existing.Id),qbo_total:money(existing.TotalAmt),portal_amount:plan.amount});
  const cmp:any=existing?compareReceiptPayment(existing,plan.lines):{state:'raise'};
  if(cmp.state==='conflict')throw fail('receipt_payment_qbo_edited','QBO applies more of this payment to an invoice than the Portal does.',cmp);
  if(cmp.state==='raise'){
    // Every dollar about to be added must fit the invoice's live QBO balance.
    const have=existing?paymentLineTotals(existing):new Map<string,number>();
    for(const line of plan.lines){
      const add=money(line.amount-(have.get(String(line.qboInvoiceId))||0));if(add<=0)continue;
      const inv=(await qbo.request(`/invoice/${line.qboInvoiceId}`)).Invoice;
      if(!inv||String(inv.CustomerRef?.value)!==plan.qboCustomerId)throw fail('receipt_invoice_customer_changed','QBO invoice changed customer before the receipt write.',{qbo_invoice_id:line.qboInvoiceId});
      if(add>money(inv.Balance)+.005)throw fail('payment_amount_conflict','Receipt line exceeds the invoice balance in QBO.',{qbo_invoice_id:line.qboInvoiceId,invoices:line.invoiceIds,adding:add,qbo_invoice_balance:money(inv.Balance)});
    }
  }
  let paymentId=existing?String(existing.Id):'',result='linked';
  if(!existing){
    const payload={CustomerRef:{value:plan.qboCustomerId},DepositToAccountRef:{value:depositId},TotalAmt:plan.amount,TxnDate:date,PaymentRefNum:receiptPaymentRef(receipt),PrivateNote:receiptPrivateNote(receipt,plan),Line:receiptPaymentLines(plan.lines)};
    const created=(await qbo.request('/payment',{method:'POST',body:JSON.stringify(payload)})).Payment;if(!created?.Id)throw new Error('QBO payment create returned no ID.');
    paymentId=String(created.Id);result='created';
  }else if(cmp.state==='raise'){
    await qbo.request('/payment',{method:'POST',body:JSON.stringify({Id:String(existing.Id),SyncToken:existing.SyncToken,sparse:true,CustomerRef:existing.CustomerRef,TotalAmt:existing.TotalAmt,Line:receiptPaymentLines(plan.lines)})});
    result='updated';
  }
  const verified=(await qbo.request(`/payment/${paymentId}`)).Payment;
  const unappliedOk=verified&&(verified.UnappliedAmt==null||Math.abs(money(verified.UnappliedAmt)-plan.unapplied)<=.005);
  if(!verified||String(verified.CustomerRef?.value)!==plan.qboCustomerId||money(verified.TotalAmt)!==plan.amount||parseDate(verified.TxnDate)!==date
    ||String(verified.DepositToAccountRef?.value)!==depositId||!clean(verified.PrivateNote).includes(marker)||compareReceiptPayment(verified,plan.lines).state!=='match'||!unappliedOk)
    throw fail('receipt_payment_readback_failed','QBO receipt payment failed read-back.',{qbo_id:paymentId,qbo_total:money(verified?.TotalAmt),qbo_unapplied:verified?.UnappliedAmt??null,portal_unapplied:plan.unapplied});
  const evidence={result,api_readback:true,run_id:runId,receipt_id:String(receipt.id),amount:plan.amount,unapplied:plan.unapplied,date,deposit_account:depositId};
  await persist('qbReceiptMap',sourceId,paymentId,evidence);
  for(const line of plan.lines)for(const row of line.rows)await persist('qbPaymentMap',paymentIdentity(row),paymentId,{...evidence,invoice_id:String(row.invoice_id),row_amount:money(row.amount)});
  const stamp=await admin.from('payment_receipts').update({qb_payment_id:paymentId}).eq('id',receipt.id).select('id');
  if(stamp.error)throw fail('receipt_stamp_failed','Receipt QBO link could not be saved on the Portal receipt.');
  return {paymentId,result};
}
