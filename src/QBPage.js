import StripePaymentVerification from './StripePaymentVerification';
import QBCustomerLinkRepair from './QBCustomerLinkRepairCard';
import QBServerReviewCard from './QBServerReviewCard';
import QBBackgroundSalesCard from './QBBackgroundSalesCard';
import QBPayableServerReviewCard from './QBPayableServerReviewCard';
import QBAuditExportCard from './QBAuditExportCard';
import {supabase} from './lib/dbEngine';
import {loadQBVendorReview,applyQBVendorReview} from './qbVendorSync';
import {buildQBProductManifest,loadQBProductItems,qbProductBatchReadiness} from './qbProductMigration';
// QuickBooks Online sync page — lifted verbatim out of App() (was `function rQB()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import React, { useEffect, useState } from 'react';
import { useAppData } from './AppContext';
import { D_V } from './constants';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP } from './App';
import { authFetch } from './utils';
import { applyQBPurchaseOrderLiveReadiness, applyQBSalesOrderLiveReadiness, buildQBCustomerManifest, buildQBCustomerMatchDiagnostic, buildQBInvoicePreviewRows, buildQBPurchaseOrderPreviewRows, buildQBSalesOrderPreviewRows, createQBSyncEngine, groupPortalPurchaseOrders, historicalPortalPurchaseOrderIds, isVoidInvoice, portalCustomerDisplayName, qbCustomerBatchReady, qbPurchaseOrderSourceFingerprint, qbResponseErrorDetail, qbSalesOrderSourceFingerprint } from './qbSyncEngine';
import { QB_ACCOUNT_MAPPING_DEFAULTS, QB_ACCOUNT_POSTING_MATRIX, QB_ACCOUNT_SPECS, QB_STATE_TAX_ACCOUNT_KEYS, buildVendorBillLines, calculateCustomerShipping, loadAllQBEntities, loadQBAccounts, manualBillAccountKey, normalizeVendorName, qbWriteAccountRef, queryQBReadOnly, readQBWithRetry, resolveQBAccountRefs } from './qbAccountMappings';
import { mergeDurableQBLinks, persistVerifiedQBCustomerLinkRecovery } from './qbLinkLedger';
import { applyQBInvoiceLiveReadiness, loadQBInvoicesForDuplicateCheck, normalizeQBInvoiceDocumentNumber, qbInvoiceSourceKey, summarizeQBInvoicePreflight } from './qbInvoiceSyncGuard';

const stripeBackfillErrorSummary=(errors=[])=>{
  const counts={};
  errors.forEach(({error})=>{
    const message=String(error||'Unknown Stripe error');
    const category=/no such payment_intent/i.test(message)?'PaymentIntent not found in the current Stripe account':
      /no balance transaction/i.test(message)?'PaymentIntent has no settled balance transaction':
      /no such charge/i.test(message)?'Charge not found in the current Stripe account':
      /rate limit|temporar|timeout|connection/i.test(message)?'Temporary Stripe/API error':'Other reconciliation error';
    counts[category]=(counts[category]||0)+1;
  });
  return Object.entries(counts);
};

const QB_BATCH_SIZES = [10, 20, 50, 100, 250, 500];

const QB_MAPPING_FIELDS = [
  ['income_account', 'Customer sales + shipping'],
  ['inventory_asset_account', 'Inventory asset'],
  ['cogs_account', 'Inventory COGS'],
  ['inventory_loss_account', 'Inventory loss / corrections'],
  ['discount_account', 'Customer discounts'],
  ['purchases_account', 'SKU purchases + supplies'],
  ['freight_account', 'Vendor freight in'],
  ['outbound_freight_account', 'Outbound UPS / FedEx'],
  ['sports_inc_fee_account', 'Sports Inc fee'],
  ['omg_fee_account', 'OMG fee (vendor invoice or deposit withheld)'],
  ['omg_card_fee_account', 'OMG credit-card fee'],
  ['deco_account', 'Outside decoration'],
  ['decoration_account', 'In-house decoration labor (reference only)'],
  ['in_house_art_account', 'In-house art labor (reference only)'],
  ['ar_account', 'Accounts Receivable'],
  ['payment_deposit_account', 'Undeposited customer payments'],
  ['operating_bank_account', 'OMG payout bank (changeable)'],
  ['ap_account', 'Accounts Payable'],
  ['tax_parent_account', 'Sales tax parent'],
  ['tax_ca_account', 'Sales tax — CA'],
  ['tax_az_account', 'Sales tax — AZ'],
  ['tax_co_account', 'Sales tax — CO'],
  ['tax_nv_account', 'Sales tax — NV'],
  ['tax_tx_account', 'Sales tax — TX'],
  ['tax_wa_account', 'Sales tax — WA'],
];

export default function QBPage(){
  const {connectQB,cust,decoVendors,disconnectQB,invAdjLog,invPOs,invs,nf,prod,persistQbLink,qbApi,qbBillAmount,qbBillDate,qbBillFile,qbBillMemo,qbBillUploading,qbBillVendor,qbConfig,qbSyncing,qbTab,setInvPOs,setInvs,setQBConfig,setQbBillAmount,setQbBillDate,setQbBillFile,setQbBillMemo,setQbBillUploading,setQbBillVendor,setQbSyncing,setQbTab,setSOs,setSubmittedBatches,setVend,sos,submittedBatches,vend}=useAppData();
  const [qbBillFreight,setQbBillFreight]=useState('');
  const [qbBillSportsFee,setQbBillSportsFee]=useState('');
  const [qbCanaryMode,setQbCanaryMode]=useState(true);
  const [qbCanaryCustomerId,setQbCanaryCustomerId]=useState('');
  const [qbCanaryInvoiceId,setQbCanaryInvoiceId]=useState('');
  const [qbCanaryProductId,setQbCanaryProductId]=useState('');
  const [qbCanarySOId,setQbCanarySOId]=useState('');
  const [qbCanaryPOId,setQbCanaryPOId]=useState('');
  const [qbReconcilePOId,setQbReconcilePOId]=useState('');
  const [qbReconcileBillId,setQbReconcileBillId]=useState('');
  const [poBillLinkReview,setPoBillLinkReview]=useState(null);
  const [poCanaryReview,setPoCanaryReview]=useState(null);
  const [qbPreflighting,setQbPreflighting]=useState(false);
  const [stripePayouts,setStripePayouts]=useState([]);
  const [stripePayoutId,setStripePayoutId]=useState('');
  const [stripePayoutDetail,setStripePayoutDetail]=useState(null);
  const [stripePayoutLoading,setStripePayoutLoading]=useState(false);
  const [stripePayoutError,setStripePayoutError]=useState('');
  const [qbAuditItemId,setQbAuditItemId]=useState('');
  const [qbItemAudit,setQbItemAudit]=useState(null);
  const [customerManifest,setCustomerManifest]=useState(null);
  const [customerReviewBusy,setCustomerReviewBusy]=useState(false);
  const [customerRecoveryApproved,setCustomerRecoveryApproved]=useState(false);
  const [productReview,setProductReview]=useState(null);
  const [productApproved,setProductApproved]=useState(false);
  const [productCreateApproved,setProductCreateApproved]=useState(false);
  const [productFilter,setProductFilter]=useState('link');
  const [productReviewBusy,setProductReviewBusy]=useState(false);
  const [customerBatchApproved,setCustomerBatchApproved]=useState(false);
  const [customerBatchLimit,setCustomerBatchLimit]=useState(20);
  const [productBatchLimit,setProductBatchLimit]=useState(20);
  const [poBatchLimit,setPoBatchLimit]=useState(20);
  const [poParkingApproved,setPoParkingApproved]=useState(false);
  const [productPoOnly,setProductPoOnly]=useState(true);
  const [customerReviewFilter,setCustomerReviewFilter]=useState('all');
  // Steve Peterson approved Net 30 (the portal's own due-date default) for blank
  // portal terms on September 6, 2026. The reviewer can still switch to Block.
  const [customerBlankTermsDefault,setCustomerBlankTermsDefault]=useState('net30');
  const [qbTaxReading,setQbTaxReading]=useState(false);
  // Washington first on purpose: 4 invoices and about $319 of collected tax, against
  // 56 invoices and about $20,455 in California. Learn QBO's behaviour on the small one.
  const [taxSetupState,setTaxSetupState]=useState('WA');
  const [taxAgencyName,setTaxAgencyName]=useState('Washington Department of Revenue');
  const [taxRateName,setTaxRateName]=useState('WA Sales Tax');
  const [taxRatePercent,setTaxRatePercent]=useState('');
  const [matchDiagnostic,setMatchDiagnostic]=useState(null);
  const [matchDiagnosticBusy,setMatchDiagnosticBusy]=useState(false);
  const [poBatchReview,setPoBatchReview]=useState(null);
  const [invoiceBatchReview,setInvoiceBatchReview]=useState(null);
  const [invoiceBatchLimit,setInvoiceBatchLimit]=useState(20);
  const [invoiceBatchApproved,setInvoiceBatchApproved]=useState(false);
  const [salesOrderBatchReview,setSalesOrderBatchReview]=useState(null);
  const [salesOrderBatchLimit,setSalesOrderBatchLimit]=useState(20);
  const [salesOrderBatchApproved,setSalesOrderBatchApproved]=useState(false);
  const [invValuationReview,setInvValuationReview]=useState(null);
  const [invValuationApproved,setInvValuationApproved]=useState(false);
  const [poBatchApproved,setPoBatchApproved]=useState(false);
  const [vendorReview,setVendorReview]=useState(null);
  const [vendorBusy,setVendorBusy]=useState(false);
  const [vendorResults,setVendorResults]=useState(null);
  const downloadVendorReview=()=>{
    if(!vendorReview)return;
    const payload={realm:qbConfig.realm_id,readAt:new Date().toISOString(),
      counts:vendorReview.reduce((acc,row)=>({...acc,[row.action]:(acc[row.action]||0)+1}),{}),rows:vendorReview};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='qbo-vendor-review-'+payload.readAt.slice(0,10)+'.json';anchor.click();
    URL.revokeObjectURL(url);
  };
  const reviewVendors=async()=>{
    setVendorBusy(true);setVendorReview(null);setVendorResults(null);
    try{setVendorReview(await loadQBVendorReview({client:supabase,qbApi,links:qbConfig.vendorQBMap||{},realmId:qbConfig.realm_id}))}
    catch(e){nf(e.message,'error')}finally{setVendorBusy(false)}
  };
  const importVendors=async()=>{
    setVendorBusy(true);
    try{
      const results=await applyQBVendorReview({client:supabase,qbApi,links:qbConfig.vendorQBMap||{},realmId:qbConfig.realm_id,reviewed:vendorReview,persistQbLink,
        onSaved:saved=>setVend(prev=>prev.some(v=>v.id===saved.id)?prev.map(v=>v.id===saved.id?{...v,...saved}:v):[...prev,saved])});
      setVendorResults(results);setVendorReview(null);
      nf(results.filter(r=>r.status==='saved').length+' vendors imported; '+results.filter(r=>r.status==='error').length+' errors');
    }catch(e){setVendorReview(null);nf(e.message,'error')}finally{setVendorBusy(false)}
  };
  const [stripeBackfill,setStripeBackfill]=useState(null);
  const [stripeWebhookStatus,setStripeWebhookStatus]=useState(null);

  const stripeReconApi=async(action,payload={})=>{
    const res=await authFetch('/.netlify/functions/stripe-reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||('Stripe reconciliation returned HTTP '+res.status));
    return data;
  };
  const loadStripePayouts=async()=>{
    setStripePayoutLoading(true);setStripePayoutError('');
    try{const data=await stripeReconApi('list_payouts');setStripePayouts(data.payouts||[])}
    catch(e){setStripePayoutError(e.message)}finally{setStripePayoutLoading(false)}
  };
  const loadStripePayoutDetail=async(id)=>{
    setStripePayoutLoading(true);setStripePayoutError('');
    try{const data=await stripeReconApi('payout_detail',{payout_id:id});setStripePayoutDetail(data)}
    catch(e){setStripePayoutError(e.message)}finally{setStripePayoutLoading(false)}
  };
  const reconcileStripePayout=async(id)=>{
    const payoutId=String(id||'').trim();
    if(!/^po_[A-Za-z0-9_]+$/.test(payoutId)){setStripePayoutError('Enter a valid Stripe payout ID (po_...).');return}
    setStripePayoutLoading(true);setStripePayoutError('');
    try{
      await stripeReconApi('reconcile_payout',{payout_id:payoutId});
      setStripePayoutId('');await loadStripePayouts();await loadStripePayoutDetail(payoutId);
      nf('Stripe payout reconciled to its balance transactions');
    }catch(e){setStripePayoutError(e.message);setStripePayoutLoading(false)}
  };
  const loadStripeWebhookStatus=async()=>{
    try{const data=await stripeReconApi('webhook_status');setStripeWebhookStatus(data);return data}
    catch(e){setStripeWebhookStatus({healthy:false,error:e.message,missing_events:[]});throw e}
  };
  const repairStripeWebhookEvents=async()=>{
    setStripePayoutLoading(true);setStripePayoutError('');
    try{const data=await stripeReconApi('repair_webhook_events');setStripeWebhookStatus(data);nf('Stripe webhook payout, refund, and dispute coverage verified')}
    catch(e){setStripePayoutError(e.message)}finally{setStripePayoutLoading(false)}
  };
  const runStripeHistoricalBackfill=async()=>{
    setStripePayoutLoading(true);setStripePayoutError('');
    const progress={phase:'orders',orders_processed:0,orders_linked:0,orders_skipped:0,payouts_processed:0,errors:[]};
    setStripeBackfill({...progress});
    try{
      let cursor=null;
      for(let page=0;page<100;page+=1){
        const batch=await stripeReconApi('backfill_orders',{starting_after:cursor,limit:10});
        progress.orders_processed+=Number(batch.processed||0);progress.orders_linked+=Number(batch.linked||0);
        progress.orders_skipped+=(batch.skipped||[]).length;
        progress.errors.push(...(batch.errors||[]));cursor=batch.next_cursor||null;setStripeBackfill({...progress});
        if(!batch.has_more||!cursor)break;
      }
      progress.phase='payouts';setStripeBackfill({...progress});
      cursor=null;let createdGte=null;
      for(let page=0;page<100;page+=1){
        const batch=await stripeReconApi('backfill_payouts',{starting_after:cursor,created_gte:createdGte,limit:5});
        createdGte=batch.created_gte||createdGte;progress.payouts_processed+=Number(batch.processed||0);
        progress.errors.push(...(batch.errors||[]));cursor=batch.next_cursor||null;setStripeBackfill({...progress});
        if(!batch.has_more||!cursor)break;
      }
      const [status,webhook,payoutData]=await Promise.all([
        stripeReconApi('reconciliation_status'),loadStripeWebhookStatus(),stripeReconApi('list_payouts'),
      ]);
      setStripePayouts(payoutData.payouts||[]);
      setStripeBackfill({...progress,phase:'done',...status,webhook_healthy:webhook.healthy});
      const reviewCount=Number(status.unlinked_card_orders||0)+Number(status.portal_payment_review_count||0)+Number(status.charge_amount_mismatch_count||0)+Number(status.actionable_automatic_payouts||0);
      nf(reviewCount===0?'Stripe historical backfill complete':'Stripe backfill complete with review items',reviewCount===0?'success':'error');
    }catch(e){setStripePayoutError(e.message);setStripeBackfill({...progress,phase:'error'});}finally{setStripePayoutLoading(false)}
  };
  const exportStripePayoutCsv=()=>{
    const detail=stripePayoutDetail;if(!detail?.payout)return;
    const head=['Payout ID','Balance Transaction','Webstore Order','Entry Type','Posting Account Key','Tax State','Amount Cents','QBO Ready'];
    const rows=(detail.qbo_entries||[]).map(e=>[detail.payout.stripe_payout_id,e.stripe_balance_transaction_id,e.webstore_order_id||'',e.entry_type,e.posting_account_key,e.tax_state||'',e.amount_cents,e.qbo_ready?'Yes':'No']);
    const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    const csv=[head,...rows].map(row=>row.map(esc).join(',')).join('\r\n');
    const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='stripe-payout-'+detail.payout.stripe_payout_id+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  useEffect(()=>{if(qbTab==='stripe'){loadStripePayouts();loadStripeWebhookStatus().catch(()=>{})}},[qbTab]);


    // Sync engine — one copy of the logic (see qbSyncEngine.js); the App-level
    // auto-sync builds the same engine from fresh state, no page visit required.
    const {syncTaxRateCanary,syncCustomerCanary,syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,syncInventoryValuation,clearInactiveProductLink,syncPortalSalesItemCanary,syncSalesOrders,syncPurchaseOrders,verifyPurchaseOrderBillLinks,reviewPurchaseOrderBillCandidate,linkPurchaseOrderBill,syncAll}=createQBSyncEngine({cust,sos,invs,prod,vend,invAdjLog,invPOs,submittedBatches,qbApi,qbConfig,persistQbLink,nf,dP,setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend});

    // Read-only live-company inspection. This is the mandatory first step and
    // performs no QBO create/update calls.
    const runQBPreflight=async()=>{
      setQbPreflighting(true);
      const log={ts:new Date().toLocaleString(),type:'live_preflight',status:'success',details:[]};
      try{
        const [company,accounts]=await Promise.all([
          readQBWithRetry(qbApi,'company_info',{}, {label:'company-info query',validate:response=>!!response?.CompanyInfo}),
          loadQBAccounts(qbApi),
        ]);
        const refs=resolveQBAccountRefs(accounts,qbConfig.mapping,Object.keys(QB_ACCOUNT_SPECS));
        const ci=company?.CompanyInfo;
        log.details.push('READ ONLY — no QuickBooks records were created or changed');
        log.details.push('Company: '+(ci?.CompanyName||qbConfig.companyName||'Unknown')+' · Realm: '+(qbConfig.realm_id||'unknown'));
        Object.entries(refs).forEach(([key,ref])=>log.details.push(key+' → '+ref.accountNumber+' '+ref.name+' (QB #'+ref.value+')'));
        // QuickBooks calls an A/P credit a VendorCredit. "BillCredit" is a
        // NetSuite-style label and is not a queryable QBO entity.
        const entities=['Customer','Vendor','Item','Invoice','Bill','VendorCredit','BillPayment','PurchaseOrder','Payment'];
        for(const entity of entities){
          try{
            const res=await queryQBReadOnly(qbApi,'SELECT count(*) FROM '+entity,entity+' count query');
            const count=res?.QueryResponse?.totalCount;
            log.details.push(entity+' records currently in QBO: '+(count==null?'count unavailable':count));
          }catch(e){log.details.push(entity+' count unavailable: '+e.message);log.status='partial'}
        }
        // The connection/account check alone is not enough to unlock invoice work.
        // Include the same live duplicate guard used by reviewed invoice batches so
        // the operator can see every create, exact match, exclusion, hold, and
        // conflict before any QBO write control becomes available.
        const qboInvoices=await loadQBInvoicesForDuplicateCheck(qbApi,invoicePreviewRows.filter(row=>row.duplicateCheckEligible));
        const invoiceRows=applyQBInvoiceLiveReadiness(invoicePreviewRows,qboInvoices);
        invoiceRows.forEach(row=>log.details.push(row.documentNumber+' — '+row.action+(row.reason?' — '+row.reason:'')));

        // These are the actual immutable Portal document numbers. The accepted
        // QBO aliases differ only by the optional NS- prefix; the guard must not
        // silently remove any other punctuation from the accounting identifier.
        const aliasNumbers=['INV-63133','INV-63199','INV-63255'];
        const aliasRows=[];
        for(const number of aliasNumbers){
          const source=invs.find(invoice=>normalizeQBInvoiceDocumentNumber(invoice.display_id||invoice.document_number||invoice.id)===number);
          if(!source){
            aliasRows.push({documentNumber:number,action:'source_not_found',reason:'No Portal source invoice has this exact normalized number'});
            continue;
          }
          const [row]=buildQBInvoicePreviewRows([{...source,qb_invoice_id:''}],cust,_custQBMap,{invoiceMap:{},taxBlockReason:()=>''});
          if(!row){aliasRows.push({documentNumber:number,action:'source_not_reviewable',reason:'Portal source invoice is void or otherwise not reviewable'});continue}
          const matches=await loadQBInvoicesForDuplicateCheck(qbApi,[{...row,duplicateCheckEligible:true}]);
          aliasRows.push(applyQBInvoiceLiveReadiness([{...row,duplicateCheckEligible:true}],matches)[0]);
        }
        aliasRows.forEach(row=>log.details.push('Alias '+row.documentNumber+' / NS-'+row.documentNumber+' — '+row.action+(row.qboId?' — QBO #'+row.qboId:'')+(row.reason?' — '+row.reason:'')));
        const summary=summarizeQBInvoicePreflight(invoiceRows,aliasRows);
        log.details.push('Invoice guard — '+JSON.stringify(summary.counts)+' · proposed for creation: '+summary.proposedCount+' · acceptance: '+(summary.passed?'PASS':'FAIL'));
        // Ready invoices are the expected input to the explicitly approved
        // reviewed-batch flow. Only conflicts, blocked rows, or alias failures
        // should keep those review controls locked. The stricter `passed` flag
        // remains false while any creation is proposed, so unattended posting
        // still fails closed.
        if(!summary.safeToReview)log.status='partial';
        const invoiceAudit={reviewedAt:new Date().toISOString(),...summary,rows:invoiceRows,aliases:aliasRows};
        setQBConfig(prev=>({...prev,preflight:{status:log.status,at:new Date().toISOString(),company:ci?.CompanyName||prev.companyName,realm_id:prev.realm_id,accounts:Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,{id:ref.value,number:ref.accountNumber,name:ref.name}])),invoiceAudit},syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Live QBO preflight complete — no records changed');
      }catch(e){
        log.status='error';log.details.push(e.message||'Preflight failed');
        setQBConfig(prev=>({...prev,preflight:{status:'error',at:new Date().toISOString(),error:e.message},syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Live QBO preflight failed — '+(e.message||'setup error'),'error');
      }finally{setQbPreflighting(false)}
    };
    // Read-only inspection of the live Sales Tax Center. Taxable invoices stay
    // blocked until accounting approves a mapping from these codes/rates; this
    // only records what QBO has so that decision can be made from evidence.
    const runTaxRateCanary=async()=>{
      const args={state:taxSetupState,agencyName:taxAgencyName,rateName:taxRateName,ratePercent:taxRatePercent};
      const result=await syncTaxRateCanary(args);
      if(result?.status!=='needs_confirmation')return;
      const approved=window.confirm('Create manual sales tax in QuickBooks for '+result.state+'?\n\n'
        +(result.agencyExists?'Reuse existing tax agency #'+result.agencyId+': ':'Create ONE new tax agency: ')+result.agency
        +'\nCreate ONE tax code and rate: '+result.rate+' at '+result.percent+'%'
        +'\n\nThis does not post any invoice. Both records are verified by API read-back.'
        +'\n\nNote: enabling manual sales tax in QuickBooks is how tax gets recorded; it is not Automated Sales Tax and does not switch it on.');
      if(!approved){nf('Tax rate setup cancelled — nothing was created in QuickBooks');return}
      await syncTaxRateCanary({...args,allowCreate:true});
    };
    const runQBTaxPreflight=async()=>{
      setQbTaxReading(true);
      const log={ts:new Date().toLocaleString(),type:'tax_preflight',status:'success',details:['READ ONLY — no QuickBooks records were created or changed']};
      try{
        const prefsRes=await queryQBReadOnly(qbApi,'SELECT * FROM Preferences','tax preferences query');
        const taxPrefs=prefsRes?.QueryResponse?.Preferences?.[0]?.TaxPrefs||{};
        const [codes,rates,agencies]=await Promise.all([
          loadAllQBEntities(qbApi,'TaxCode','*',100),
          loadAllQBEntities(qbApi,'TaxRate','*',100),
          loadAllQBEntities(qbApi,'TaxAgency','*',100),
        ]);
        const agencyName=ref=>agencies.find(a=>String(a.Id)===String(ref?.value||''))?.DisplayName||ref?.name||'';
        const rateById=new Map(rates.map(r=>[String(r.Id),r]));
        const summary=codes.slice(0,200).map(code=>({
          id:String(code.Id),name:code.Name||'',active:code.Active!==false,taxable:code.Taxable!==false,group:!!code.TaxGroup,
          rates:(code.SalesTaxRateList?.TaxRateDetail||[]).map(detail=>{const rate=rateById.get(String(detail.TaxRateRef?.value||''));
            return{id:String(detail.TaxRateRef?.value||''),name:rate?.Name||detail.TaxRateRef?.name||'',rate:rate?.RateValue??null,agency:agencyName(rate?.AgencyRef)}}),
        }));
        log.details.push('Company realm: '+(qbConfig.realm_id||'unknown'));
        log.details.push('Automated Sales Tax: '+(taxPrefs.PartnerTaxEnabled?'ENABLED':'not enabled')+' · sales tax in use: '+(taxPrefs.UsingSalesTax?'yes':'no'));
        log.details.push(codes.length+' tax codes · '+rates.length+' tax rates · '+agencies.length+' tax agencies');
        summary.filter(code=>code.active).forEach(code=>log.details.push('TaxCode #'+code.id+' '+code.name+' — '+(code.taxable?'taxable':'non-taxable')
          +(code.rates.length?' — '+code.rates.map(r=>r.name+(r.rate!=null?' '+r.rate+'%':'')+(r.agency?' ('+r.agency+')':'')).join(', '):'')));
        log.details.push('Taxable invoices remain blocked until accounting approves a tax-code mapping from this list.');
        setQBConfig(prev=>({...prev,taxPreflight:{at:new Date().toISOString(),realm_id:prev.realm_id,partnerTaxEnabled:!!taxPrefs.PartnerTaxEnabled,usingSalesTax:!!taxPrefs.UsingSalesTax,codeCount:codes.length,rateCount:rates.length,codes:summary},syncLog:[log,...(prev.syncLog||[])].slice(0,100)}));
        nf('Sales-tax setup read from QBO — no records changed');
      }catch(e){
        log.status='error';log.details.push(e.message||'Sales-tax read failed');
        setQBConfig(prev=>({...prev,syncLog:[log,...(prev.syncLog||[])].slice(0,100)}));
        nf('Sales-tax read failed — '+(e.message||'QBO error'),'error');
      }finally{setQbTaxReading(false)}
    };

    // ── BILL UPLOAD — upload vendor bill to QB ──
    const uploadBill=async()=>{
      if(qbConfig.preflight?.status!=='success'||String(qbConfig.preflight?.realm_id||'')!==String(qbConfig.realm_id||'')){nf('Run the read-only live QBO preflight before any test bill','error');return}
      if(!qbBillVendor){nf('Select a vendor','error');return}
      if(!qbBillAmount||parseFloat(qbBillAmount)<=0){nf('Enter bill amount','error');return}
      const isCanary=qbCanaryMode||!migrationUnlocked;
      const amt=parseFloat(qbBillAmount);
      const freight=parseFloat(qbBillFreight)||0;
      const sportsFee=parseFloat(qbBillSportsFee)||0;
      if(freight<0||sportsFee<0||freight+sportsFee>=amt){nf('Freight and Sports Inc fee must be positive and less than the bill total','error');return}
      if(qbBillVendor.startsWith('deco:')&&sportsFee>0){nf('Sports Inc fee cannot be added to an outside-decoration bill','error');return}

      // Decoration-vendor category is authoritative: every vendor in that category
      // routes to 52000. Merchandise vendors route to 51300.
      const isDecoVendor=manualBillAccountKey(qbBillVendor)==='deco_account';
      const selectedVendorId=qbBillVendor.replace(/^(deco|vendor):/,'');
      const vendor=isDecoVendor
        ?(decoVendors||[]).find(v=>String(v.id)===selectedVendorId)
        :(vend.find(v=>String(v.id)===selectedVendorId)||D_V.find(v=>String(v.id)===selectedVendorId));
      if(!vendor){nf('Selected vendor is no longer available','error');return}
      if(isCanary&&!window.confirm('Create exactly ONE QBO bill?\n\nVendor: '+vendor.name+'\nTotal: $'+amt.toFixed(2)+'\nBill date: '+qbBillDate+'\nPurchases/decoration: $'+(amt-freight-sportsFee).toFixed(2)+'\nFreight in (51000): $'+freight.toFixed(2)+'\nSports Inc fee (58000): $'+sportsFee.toFixed(2)+'\n\nThe bill will be verified by QBO API read-back.')){nf('Bill canary cancelled — nothing was sent');return}
      setQbBillUploading(true);
      const log={ts:new Date().toLocaleString(),type:isCanary?'bill_canary':'bill_upload',status:'success',details:[]};
      let qbVendorId=qbConfig.vendorQBMap?.[vendor.id]||vendor.qb_vendor_id;
      if(!qbVendorId){
        // Reuse an existing QBO vendor before attempting a create, so a decoration
        // vendor stored in its own portal table cannot create duplicates.
        let vRes=null;
        try{
          const qboVendors=await loadAllQBEntities(qbApi,'Vendor','Id, DisplayName, CompanyName, Active',500);
          const target=normalizeVendorName(vendor.name);
          const matches=qboVendors.filter(v=>v.Active!==false&&
            (normalizeVendorName(v.DisplayName)===target||normalizeVendorName(v.CompanyName)===target));
          if(matches.length>1)throw new Error('Multiple active QBO vendors match '+vendor.name+' after legal-name normalization.');
          if(matches.length===1)vRes={Vendor:matches[0]};
        }catch(e){
          log.details.push('Vendor duplicate preflight failed: '+e.message);log.status='error';
          setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
          setQbBillUploading(false);return;
        }
        if(!vRes?.Vendor?.Id&&isCanary){
          log.details.push('BLOCKED: vendor "'+vendor.name+'" is not linked or present in QBO; a one-bill test will not create a second QBO record.');log.status='error';
          setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Bill canary stopped — vendor must already exist in QBO','error');setQbBillUploading(false);return;
        }
        if(!vRes?.Vendor?.Id)vRes=await qbApi('upsert_vendor',{vendor:{DisplayName:vendor.name,CompanyName:vendor.name,...(vendor.contact_email?{PrimaryEmailAddr:{Address:vendor.contact_email}}:{})}});
        if(vRes?.Vendor?.Id){
          qbVendorId=vRes.Vendor.Id;
          if(!isDecoVendor)setVend(prev=>prev.map(v=>v.id===vendor.id?{...v,qb_vendor_id:qbVendorId}:v));
          log.details.push('Resolved vendor: '+vendor.name+' → QB #'+qbVendorId);
        }else{
          log.details.push('Vendor creation failed: '+(vRes?.Fault?.Error?.[0]?.Detail||'unknown'));
          log.status='error';
          setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
          setQbBillUploading(false);return;
        }
      }

      // Resolve every required account by AcctNum. Missing, inactive, duplicated,
      // or wrong-type accounts block the bill; there is no first-account fallback.
      let billLines,apAccountRef;
      try{
        const accounts=await loadQBAccounts(qbApi);
        const keys=[manualBillAccountKey(qbBillVendor),'ap_account'];
        if(freight>0)keys.push('freight_account');
        if(sportsFee>0)keys.push('sports_inc_fee_account');
        const refs=resolveQBAccountRefs(accounts,qbConfig.mapping,keys);
        apAccountRef=refs.ap_account;
        billLines=buildVendorBillLines({
          kind:isDecoVendor?'decoration':'goods',supplier:vendor.name,doc_total:amt,
          merchandise_total:amt-freight-sportsFee,freight,si_upcharge:sportsFee,items:[],po_number:qbBillMemo||'manual',
        },refs).lines;
      }catch(e){
        log.details.push(e.message||'Could not resolve QB accounts');
        log.status='error';
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf(e.message||'Could not resolve QB accounts','error');
        setQbBillUploading(false);return;
      }
      const qbBill={
        VendorRef:{value:qbVendorId},
        APAccountRef:qbWriteAccountRef(apAccountRef),
        TxnDate:qbBillDate,
        Line:billLines,
        ...((isCanary||qbBillMemo)?{PrivateNote:[isCanary?'NSA-QB-CANARY:'+new Date().toISOString():'',qbBillMemo].filter(Boolean).join(' | ')}:{}),
      };
      const billRes=await qbApi('upsert_bill',{bill:qbBill});
      if(!billRes?.Bill?.Id){
        log.details.push('Bill creation failed: '+qbResponseErrorDetail(billRes));
        log.status='error';
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Bill upload failed','error');
        setQbBillUploading(false);return;
      }
      const billId=billRes.Bill.Id;
      if(isCanary){
        try{
          const readback=await queryQBReadOnly(qbApi,"SELECT * FROM Bill WHERE Id = '"+String(billId).replace(/'/g,"\\'")+"' MAXRESULTS 1",'bill API read-back');
          const verified=readback?.QueryResponse?.Bill?.[0];
          if(!verified||String(verified.Id)!==String(billId)||String(verified.VendorRef?.value||'')!==String(qbVendorId)||Math.abs(safeNum(verified.TotalAmt)-amt)>=0.005||String(verified.TxnDate||'').slice(0,10)!==String(qbBillDate||'').slice(0,10))throw new Error('vendor, date, or total did not match');
          log.details.push('READ-BACK VERIFIED: QBO Bill #'+verified.Id+' · '+vendor.name+' · $'+safeNum(verified.TotalAmt).toFixed(2));
        }catch(e){log.details.push('VERIFY FAILED: '+e.message);log.status='error';setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Bill was created but QBO read-back verification failed — stop testing','error');setQbBillUploading(false);return}
      }
      log.details.push((isCanary?'CANARY — ':'')+'Bill created: '+vendor.name+' $'+amt.toFixed(2)+' → QB Bill #'+billId);

      // Upload attachment if file selected
      if(qbBillFile){
        try{
          const reader=new FileReader();
          const fileBase64=await new Promise((resolve,reject)=>{
            reader.onload=()=>resolve(reader.result.split(',')[1]);
            reader.onerror=reject;
            reader.readAsDataURL(qbBillFile);
          });
          const attachRes=await qbApi('upload_attachment',{
            entity_type:'Bill',entity_id:billId,
            file_name:qbBillFile.name,file_base64:fileBase64,content_type:qbBillFile.type||'application/pdf',
          });
          if(attachRes?.attachableId){
            log.details.push('Attachment uploaded: '+qbBillFile.name);
          }else{
            log.details.push('Attachment upload failed — bill was created without attachment');log.status='partial';
          }
        }catch(e){log.details.push('File read error: '+e.message);log.status='partial'}
      }

      setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf((isCanary?'Created and verified exactly one ':'Uploaded ')+'QBO bill $'+amt.toFixed(2)+' for '+vendor.name);
      setQbBillFile(null);setQbBillVendor('');setQbBillAmount('');setQbBillMemo('');setQbBillFreight('');setQbBillSportsFee('');
      setQbBillUploading(false);
    };


    // Build counts for overview
    const soMap=qbConfig.qbSOMap||{};
    const poMap=qbConfig.qbPOMap||{};
    const unsyncedSOs=sos.filter(so=>{
      const hasItems=safeItems(so).some(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
      return hasItems&&!soMap[so.id];
    });
    const parkedPurchaseOrderIds=qbConfig.parkedPurchaseOrderIds||[];
    const autoExcludedHistoricalPOIds=historicalPortalPurchaseOrderIds(sos,poMap,parkedPurchaseOrderIds);
    const unsyncedPOGroups=groupPortalPurchaseOrders(sos,poMap,vend,parkedPurchaseOrderIds);
    // Zero-dollar source records remain in portal history but are not QBO
    // accounting documents and must not keep the migration queue open.
    const unsyncedInvs=invs.filter(i=>!i.qb_invoice_id&&!(qbConfig.qbInvoiceMap||{})[qbInvoiceSourceKey(i)]&&!isVoidInvoice(i)&&safeNum(i.total)>0);
    const _custQBMap=qbConfig.custQBMap||{};
    const _prodQBMap=qbConfig.prodQBMap||{};
    const custWithQB=cust.filter(c=>_custQBMap[c.id]).length;
    const prodWithQB=prod.filter(p=>_prodQBMap[p.id]).length;
    const totalInvQty=prod.reduce((a,p)=>a+Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0),0);
    const totalInvValue=prod.reduce((a,p)=>{const qty=Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0);return a+qty*safeNum(p.nsa_cost)},0);
    const unsyncedInvPOs=invPOs.filter(p=>!p._qb_synced);
    const durableLinksReady=qbConfig._durableLinksLoaded===true;
    const migrationUnlocked=qbConfig.initialMigrationApproved===true&&durableLinksReady;
    const verifiedCanaryBills=new Set((qbConfig._qbCanaryBillIds||[]).map(String)).size;
    const livePreflightReady=durableLinksReady&&qbConfig.preflight?.status==='success'&&String(qbConfig.preflight?.realm_id||'')===String(qbConfig.realm_id||'');
    const activeCanaryCustomers=cust.filter(c=>c.is_active!==false&&!c.deleted_at).sort((a,b)=>portalCustomerDisplayName(a).localeCompare(portalCustomerDisplayName(b)));
    const canaryInvoices=[...unsyncedInvs].sort((a,b)=>String(a.display_id||a.id).localeCompare(String(b.display_id||b.id),undefined,{numeric:true}));
    const canaryProducts=[...new Map(prod.filter(p=>p.is_active!==false&&String(p.sku||'').trim()).sort((a,b)=>String(a.sku).localeCompare(String(b.sku),undefined,{numeric:true})).map(p=>[String(p.sku).trim().toUpperCase(),p])).values()];
    const canarySOs=[...unsyncedSOs].sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
    const canaryPOs=[...unsyncedPOGroups].sort((a,b)=>String(a.poId).localeCompare(String(b.poId),undefined,{numeric:true}));
    const selectedCanaryInvoice=canaryInvoices.find(inv=>String(inv.id)===String(qbCanaryInvoiceId));
    const selectedCanaryProduct=canaryProducts.find(p=>String(p.id)===String(qbCanaryProductId));
    const selectedCanarySO=canarySOs.find(so=>String(so.id)===String(qbCanarySOId));
    const selectedCanaryPO=canaryPOs.find(group=>String(group.poId)===String(qbCanaryPOId));
    const poPreviewRows=buildQBPurchaseOrderPreviewRows(sos,prod,qbConfig.prodQBMap||{},qbConfig.qbPOMap||{},vend,parkedPurchaseOrderIds);
    const poBatchRows=(poBatchReview?.rows||[]).filter(row=>row.action==='ready').slice(0,poBatchLimit);
    const poBlockedRows=(poBatchReview?.rows||[]).filter(row=>row.action==='blocked');
    const taxPreflight=qbConfig.taxPreflight&&String(qbConfig.taxPreflight.realm_id||'')===String(qbConfig.realm_id||'')?qbConfig.taxPreflight:null;
    const astTaxOn=!!taxPreflight?.partnerTaxEnabled;
    const taxableEstimateBlock=state=>{
      if(!taxPreflight)return'Taxable Estimate: read the sales-tax setup first (Settings tab) so the QBO tax mechanism is known';
      if(astTaxOn)return QB_STATE_TAX_ACCOUNT_KEYS[state]?'':'Taxable Estimate: customer state "'+(state||'blank')+'" has no approved sales-tax account';
      return(qbConfig.qbTaxRateMap||{})[state]?'':'Taxable Estimate: run the tax-rate canary for '+(state||'the customer state')+' first (Settings tab)';
    };
    const salesOrderPreviewRows=buildQBSalesOrderPreviewRows(sos,cust,_custQBMap,qbConfig.qbSOMap||{},dP,
      {partnerTaxEnabled:astTaxOn,taxBlockReason:({taxState})=>taxableEstimateBlock(taxState)});
    const salesOrderBatchRows=(salesOrderBatchReview?.rows||[]).filter(row=>row.action==='ready').slice(0,salesOrderBatchLimit);
    const poPreviewById=new Map(poPreviewRows.map(row=>[String(row.poId),row]));
    const poAccountSkus=poId=>poPreviewById.get(String(poId))?.accountSkus||[];
    const selectedInvoiceCustomer=selectedCanaryInvoice&&cust.find(c=>c.id===selectedCanaryInvoice.customer_id);
    // A taxable invoice needs a mechanism to carry the portal's own tax amount,
    // but which mechanism depends on the company file. Under manual sales tax
    // that is the state's verified TaxRate; under Automated Sales Tax no manual
    // rate can exist, so it is the CustomSalesTax override code instead. Gate on
    // whichever one actually applies, read from the stored tax preflight.
    const taxableInvoiceBlock=state=>{
      if(!taxPreflight)return'Taxable invoice: read the sales-tax setup first (Settings tab) so the right tax mechanism is known';
      // Under AST the tax posts as its own line against the state's approved
      // liability account; no QBO tax code is needed. The only precondition is
      // that the state has one, so the label says so instead of inviting a run
      // that the engine will block for the same reason.
      if(astTaxOn)return QB_STATE_TAX_ACCOUNT_KEYS[state]?'':'Taxable invoice: customer state "'+(state||'blank')+'" has no approved sales-tax account';
      return(qbConfig.qbTaxRateMap||{})[state]?'':'Taxable invoice: run the tax-rate canary for '+(state||'the customer state')+' first (Settings tab)';
    };
    // The dropdown label has to answer the same question the button does. A flat
    // "TAX BLOCKED" on every taxable invoice said nothing about whether this one
    // can post, and kept reading as blocked after the mechanism to post it existed.
    const invoiceTaxState=inv=>{const c=cust.find(cc=>cc.id===inv.customer_id);
      return String(c?.shipping_state||c?.billing_state||'').trim().toUpperCase()};
    const invoiceTaxBlocked=inv=>safeNum(inv.tax)>0&&!!taxableInvoiceBlock(invoiceTaxState(inv));
    const invoicePreviewRows=buildQBInvoicePreviewRows(invs,cust,_custQBMap,{invoiceMap:qbConfig.qbInvoiceMap||{},taxBlockReason:inv=>taxableInvoiceBlock(invoiceTaxState(inv))});
    const invoiceBatchRows=(invoiceBatchReview?.rows||[]).filter(row=>row.action==='ready').slice(0,invoiceBatchLimit);
    const selectedCanaryPreview=selectedCanaryInvoice&&invoicePreviewRows.find(row=>row.invoiceId===String(selectedCanaryInvoice.id));
    const invoiceCanaryBlock=selectedCanaryPreview&&selectedCanaryPreview.action!=='ready'?selectedCanaryPreview.reason:'';
    const selectedSalesOrderPreview=selectedCanarySO&&salesOrderPreviewRows.find(row=>row.salesOrderId===String(selectedCanarySO.id));
    const soCanaryBlock=selectedSalesOrderPreview?.action==='blocked'?selectedSalesOrderPreview.reason:'';
    const poCanaryBlock=selectedCanaryPO?.invalidReason||'';
    const runCustomerCanary=async()=>{
      if(!qbCanaryCustomerId)return;
      const result=await syncCustomerCanary(qbCanaryCustomerId,{blankTermsDefault:customerBlankTermsDefault});
      if(result?.status==='needs_confirmation'){
        const approved=window.confirm('No exact active QBO customer matches "'+result.customerName+'".\n\nCreate exactly ONE new QBO customer with its mapped QBO payment terms and verify it by API read-back?');
        if(!approved){nf('Customer test cancelled — no QBO customer was created');return}
        await syncCustomerCanary(qbCanaryCustomerId,{allowCreate:true,blankTermsDefault:customerBlankTermsDefault});
      }else if(result?.status==='needs_term_confirmation'){
        const approved=window.confirm('QBO customer #'+result.qbId+' ("'+result.customerName+'") currently has terms "'+result.currentTerm+'".\n\nUpdate exactly this ONE customer to "'+result.desiredTerm+'" and verify it by API read-back?');
        if(!approved){nf('Customer terms update cancelled — no QBO customer was changed');return}
        await syncCustomerCanary(qbCanaryCustomerId,{allowTermUpdate:true,blankTermsDefault:customerBlankTermsDefault});
      }
    };
    const runInvoiceCanary=async()=>{
      if(!selectedCanaryInvoice||invoiceCanaryBlock)return;
      const doc=selectedCanaryInvoice.display_id||selectedCanaryInvoice.id;
      if(!window.confirm('Create exactly ONE QBO invoice?\n\nInvoice: '+doc+'\nCustomer: '+(selectedInvoiceCustomer?.name||'Unknown')+'\nTotal: $'+safeNum(selectedCanaryInvoice.total).toFixed(2)+'\nPaid in portal: $'+safeNum(selectedCanaryInvoice.paid).toFixed(2)+'\n\nThis test creates no payment. QBO customer terms and the invoice will be verified by API read-back.')){nf('Invoice canary cancelled — nothing was sent');return}
      await syncInvoices({}, {}, {canaryInvoiceId:selectedCanaryInvoice.id});
    };
    const auditQBOItem=async()=>{
      const id=String(qbAuditItemId).trim();
      if(!/^\d+$/.test(id)||!livePreflightReady)return;
      setQbSyncing(true);setQbItemAudit(null);
      try{
        const response=await queryQBReadOnly(qbApi,"SELECT * FROM Item WHERE Id = '"+id+"' AND Active IN (true, false) MAXRESULTS 1",'item recovery audit');
        const item=response?.QueryResponse?.Item?.[0];
        const result=item?{realm:qbConfig.realm_id,id:item.Id,name:item.Name,sku:item.Sku,active:item.Active,type:item.Type,income:item.IncomeAccountRef,purchases:item.ExpenseAccountRef}:{realm:qbConfig.realm_id,id,not_found:true};
        setQbItemAudit(result);
        setQBConfig(prev=>({...prev,syncLog:[{ts:new Date().toLocaleString(),type:'item_recovery_audit',status:item?'success':'error',details:['READ ONLY — no QBO records changed',JSON.stringify(result)]},...(prev.syncLog||[])].slice(0,100)}));
      }catch(e){setQbItemAudit({error:e.message})}finally{setQbSyncing(false)}
    };
    const reviewCustomerMigration=async()=>{
      if(!livePreflightReady)return;
      setCustomerReviewBusy(true);setCustomerManifest(null);setCustomerBatchApproved(false);
      try{
        const terms=await loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000);
        const customers=await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, Active, SalesTermRef',1000);
        const rows=buildQBCustomerManifest(cust,customers,terms,qbConfig.custQBMap||{},{blankTermsDefault:customerBlankTermsDefault,reviewedAliases:qbConfig.custQBAliasApprovals||{}});
        const review={realm:qbConfig.realm_id,reviewedAt:new Date().toISOString(),rows,blankTermsDefault:customerBlankTermsDefault,
          counts:rows.reduce((counts,row)=>({...counts,[row.action]:(counts[row.action]||0)+1}),{}),
          termSources:rows.reduce((counts,row)=>({...counts,[row.termSource||'portal']:(counts[row.termSource||'portal']||0)+1}),{})};
        setCustomerManifest(review);
        setQBConfig(prev=>({...prev,lastCustomerReview:review}));
        nf('Customer review complete — no QBO records changed');
      }catch(e){nf('Customer review failed — '+e.message,'error')}finally{setCustomerReviewBusy(false)}
    };
    const customerRecoveryRows=(customerManifest?.rows||[]).filter(row=>row.action==='link'&&!qbConfig.custQBMap?.[row.sourceId]);
    const recoverExactCustomerLinks=async()=>{
      if(!customerRecoveryApproved||!livePreflightReady||!customerRecoveryRows.length)return;
      setCustomerReviewBusy(true);setQbSyncing(true);
      try{
        const reviewedAt=new Date().toISOString();
        const [terms,customers]=await Promise.all([
          loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000),
          loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, Active, SalesTermRef',1000),
        ]);
        const current=buildQBCustomerManifest(cust,customers,terms,qbConfig.custQBMap||{},{blankTermsDefault:customerBlankTermsDefault,reviewedAliases:qbConfig.custQBAliasApprovals||{}})
          .filter(row=>row.action==='link'&&!qbConfig.custQBMap?.[row.sourceId]);
        const reviewed=new Map(customerRecoveryRows.map(row=>[String(row.sourceId),String(row.qboId)]));
        if(current.length!==customerRecoveryRows.length||current.some(row=>reviewed.get(String(row.sourceId))!==String(row.qboId))){
          throw new Error('Exact customer matches changed since review; review customers again.');
        }
        const recovered=await persistVerifiedQBCustomerLinkRecovery(supabase,{realmId:qbConfig.realm_id,reviewedAt,
          records:current.map(row=>({sourceId:row.sourceId,qboId:row.qboId,displayName:row.displayName,termId:row.desiredTerm?.value||row.currentTerm?.value||''}))});
        const report={status:'success',at:reviewedAt,count:curren…19420 tokens truncated…flight.codeCount} tax codes · {qbConfig.taxPreflight.rateCount} tax rates</div>
              <table style={{fontSize:10,marginTop:6}}><thead><tr><th>Tax code</th><th>Type</th><th>Rates</th></tr></thead><tbody>
                {(qbConfig.taxPreflight.codes||[]).filter(code=>code.active).map(code=><tr key={code.id}><td>#{code.id} {code.name}</td><td>{code.taxable?'taxable':'non-taxable'}</td><td>{code.rates.map(r=>r.name+(r.rate!=null?' '+r.rate+'%':'')+(r.agency?' ('+r.agency+')':'')).join(', ')||'—'}</td></tr>)}
              </tbody></table>
            </div>}
          </div>
          <div style={{padding:'12px 14px',background:'#f0fdf4',borderBottom:'1px solid #bbf7d0'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:4}}>Reviewed invoice batch</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Reads live QBO under both invoice-number forms before proposing any creation. Exact matches are linked in the Portal without changing QBO; conflicts go to manual review. Zero-dollar invoices are excluded, future-dated invoices are held, and the reviewed write batch stops after its first failure. Payments remain a separate gate.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn btn-sm" disabled={qbSyncing||!livePreflightReady} onClick={reviewInvoiceBatch}>Review Invoices — No QBO Changes</button>
              <label>Batch size <select aria-label="Invoice batch size" value={invoiceBatchLimit} disabled={qbSyncing} onChange={e=>{setInvoiceBatchLimit(Number(e.target.value));setInvoiceBatchApproved(false)}}>
                {QB_BATCH_SIZES.filter(size=>size<=100).map(size=><option key={size} value={size}>{size}</option>)}
              </select></label>
            </div>
            {invoiceBatchReview&&<>
              <p>Readiness: {JSON.stringify(invoiceBatchReview.counts)}. Proposed batch: {invoiceBatchRows.length} ready invoices.</p>
              <label><input type="checkbox" checked={invoiceBatchApproved} disabled={qbSyncing||!invoiceBatchRows.length} onChange={e=>setInvoiceBatchApproved(e.target.checked)}/> I approve only the exact invoices listed in this batch.</label>
              <button className="btn btn-primary btn-sm" style={{marginLeft:8}} disabled={qbSyncing||!invoiceBatchApproved||!invoiceBatchRows.length} onClick={runInvoiceBatch}>Run Reviewed Invoice Batch</button>
              <table style={{fontSize:10,marginTop:8}}><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Total</th><th>Paid</th><th>Tax</th></tr></thead><tbody>{invoiceBatchRows.map(row=><tr key={row.invoiceId}><td>{row.documentNumber}</td><td>{row.customer}</td><td>{row.date}</td><td>${row.total.toFixed(2)}</td><td>${row.paid.toFixed(2)}</td><td>${row.tax.toFixed(2)}</td></tr>)}</tbody></table>
              {invoiceBatchReview.rows.some(row=>row.action==='manual_review')&&<><h3>Manual review — no QBO changes</h3><table style={{fontSize:10}}><thead><tr><th>Invoice</th><th>Portal</th><th>QBO record(s) and differences</th></tr></thead><tbody>{invoiceBatchReview.rows.filter(row=>row.action==='manual_review').map(row=><tr key={row.invoiceId}><td>{row.documentNumber}</td><td>{row.customer} · {row.date} · ${row.total.toFixed(2)}</td><td>{(row.conflicts||[]).map(conflict=>'#'+conflict.qboId+' '+conflict.documentNumber+' — '+conflict.differences.map(diff=>diff.field+': Portal '+diff.source+' / QBO '+diff.qbo).join(', ')).join(' | ')}</td></tr>)}</tbody></table></>}
              {invoiceBatchReview.rows.some(row=>row.action==='excluded_zero'||row.action==='held_future')&&<><h3>Excluded / held</h3><table style={{fontSize:10}}><thead><tr><th>Invoice</th><th>Disposition</th><th>Reason</th></tr></thead><tbody>{invoiceBatchReview.rows.filter(row=>row.action==='excluded_zero'||row.action==='held_future').map(row=><tr key={row.invoiceId}><td>{row.documentNumber}</td><td>{row.action}</td><td>{row.reason}</td></tr>)}</tbody></table></>}
              {invoiceBatchReview.rows.some(row=>row.action==='blocked')&&<><h3>Blocked by readiness review</h3><table style={{fontSize:10}}><thead><tr><th>Invoice</th><th>Customer</th><th>Reason</th></tr></thead><tbody>{invoiceBatchReview.rows.filter(row=>row.action==='blocked').slice(0,50).map(row=><tr key={row.invoiceId}><td>{row.documentNumber}</td><td>{row.customer}</td><td>{row.reason}</td></tr>)}</tbody></table></>}
            </>}
            {qbConfig.lastInvoiceBatch&&<><h3>Latest invoice batch: {qbConfig.lastInvoiceBatch.status}</h3><table style={{fontSize:10}}><thead><tr><th>Invoice</th><th>Result</th><th>QBO ID</th><th>Error</th></tr></thead><tbody>{(qbConfig.lastInvoiceBatch.results||[]).map(row=><tr key={row.invoiceId}><td>{row.documentNumber||row.invoiceId}</td><td>{row.result}</td><td>{row.qboId||''}</td><td>{row.error||''}</td></tr>)}</tbody></table><p>{JSON.stringify(qbConfig.lastInvoiceBatch.counts)}</p></>}
          </div>
          <div style={{padding:'12px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:4}}>Test exactly one invoice</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Creates one invoice only—never a payment—using the linked QBO customer&apos;s actual terms. Account, tax, duplicate, total, customer, and API read-back checks run before the portal link is saved.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Invoice to test in QuickBooks" style={{minWidth:420,maxWidth:700}} value={qbCanaryInvoiceId} onChange={e=>setQbCanaryInvoiceId(e.target.value)}>
                <option value="">Select one pending invoice...</option>
                {canaryInvoices.map(inv=>{const c=cust.find(cc=>cc.id===inv.customer_id);return<option key={inv.id} value={inv.id}>{inv.display_id||inv.id} — {c?.name||'Unknown'} — ${safeNum(inv.total).toFixed(2)}{safeNum(inv.tax)>0?(invoiceTaxBlocked(inv)?' — TAX BLOCKED':' — tax $'+safeNum(inv.tax).toFixed(2)):''}{!_custQBMap[inv.customer_id]?' — CUSTOMER NOT SYNCED':''}</option>})}
              </select>
              <label><input type="checkbox" checked={productCreateApproved} disabled={qbSyncing} onChange={e=>setProductCreateApproved(e.target.checked)}/> Approve creation of this one SKU if no existing item matches.</label>
              <button className="btn btn-primary btn-sm" style={{background:'#0369a1'}} disabled={qbSyncing||!livePreflightReady||!selectedCanaryInvoice||!!invoiceCanaryBlock} onClick={runInvoiceCanary}>{qbSyncing?'Testing...':'Test 1 Invoice'}</button>
            </div>
            {invoiceCanaryBlock&&<div style={{fontSize:10,color:'#b91c1c',marginTop:6,fontWeight:600}}>{invoiceCanaryBlock}</div>}
            {!livePreflightReady&&<div style={{fontSize:11,color:'#92400e',marginTop:7,fontWeight:600}}>Button disabled: open Overview and run Read-Only Live Preflight.</div>}
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr style={{background:'#f8fafc'}}><th>Invoice</th><th>Customer</th><th>SO</th><th style={{textAlign:'right'}}>Total</th><th style={{textAlign:'right'}}>Paid</th><th>QB Status</th></tr></thead>
              <tbody>
                {invs.map(inv=>{
                  const c=cust.find(cc=>cc.id===inv.customer_id);
                  return<tr key={inv.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{fontWeight:700,color:'#166534'}}>{inv.id}</td>
                    <td>{c?.name||'—'}</td>
                    <td style={{color:'#64748b'}}>{inv.so_id||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>${safeNum(inv.total).toFixed(2)}</td>
                    <td style={{textAlign:'right',color:inv.paid>=inv.total?'#16a34a':'#d97706'}}>${safeNum(inv.paid).toFixed(2)}</td>
                    <td>{inv.qb_invoice_id?<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>QB #{inv.qb_invoice_id}</span>:
                      <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span>}</td>
                  </tr>})}
              </tbody>
            </table>
          </div>
        </div>
      </>}

      {/* ── STRIPE PAYOUT RECONCILIATION TAB ── */}
      {qbTab==='stripe'&&<>
        <StripePaymentVerification />
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
            <h2>Stripe Payout Reconciliation</h2>
            <button className="btn btn-secondary btn-sm" disabled={stripePayoutLoading} onClick={loadStripePayouts}>{stripePayoutLoading?'Loading...':'Refresh'}</button>
          </div>
          <div className="card-body">
            <div style={{fontSize:11,color:'#475569',marginBottom:10}}>Each automatic payout is reconciled against every Stripe balance transaction in the batch. Exact payouts can be exported as cent-based semantic posting rows; this screen never posts a bank deposit to QuickBooks automatically.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',padding:10,marginBottom:10,background:stripeWebhookStatus?.healthy?'#f0fdf4':'#fffbeb',border:'1px solid '+(stripeWebhookStatus?.healthy?'#bbf7d0':'#fde68a'),borderRadius:7,fontSize:11}}>
              <div><strong>Live webhook:</strong> {stripeWebhookStatus?.healthy?'all payment, refund, dispute, and payout events covered':stripeWebhookStatus?.error?'could not verify — '+stripeWebhookStatus.error:stripeWebhookStatus?'missing '+(stripeWebhookStatus.missing_events||[]).join(', '):'checking Stripe configuration...'}</div>
              <div style={{display:'flex',gap:6}}>{stripeWebhookStatus&&!stripeWebhookStatus.healthy&&!stripeWebhookStatus.error&&<button className="btn btn-secondary btn-sm" disabled={stripePayoutLoading} onClick={repairStripeWebhookEvents}>Add missing events</button>}<button className="btn btn-primary btn-sm" disabled={stripePayoutLoading} onClick={runStripeHistoricalBackfill}>{stripePayoutLoading&&stripeBackfill?.phase&&stripeBackfill.phase!=='done'?'Backfill running...':'Run full historical backfill'}</button></div>
            </div>
            {stripeBackfill&&<div style={{padding:9,marginBottom:10,background:stripeBackfill.phase==='done'&&Number(stripeBackfill.unlinked_card_orders||0)+Number(stripeBackfill.portal_payment_review_count||0)+Number(stripeBackfill.charge_amount_mismatch_count||0)+Number(stripeBackfill.actionable_automatic_payouts||0)===0?'#f0fdf4':'#eff6ff',border:'1px solid #bfdbfe',borderRadius:7,fontSize:11,color:'#1e3a8a'}}>
              <strong>{stripeBackfill.phase==='done'?'Backfill complete':stripeBackfill.phase==='error'?'Backfill stopped':'Backfill '+stripeBackfill.phase+' in progress'}:</strong> {stripeBackfill.orders_linked||0} of {stripeBackfill.orders_processed||0} unlinked order records linked · {stripeBackfill.orders_skipped||0} non-succeeded PaymentIntents skipped · {stripeBackfill.payouts_processed||0} payouts reconciled · {(stripeBackfill.errors||[]).length} errors
              {stripeBackfill.phase==='done'&&<span> · {stripeBackfill.unlinked_card_orders||0} settled charge links missing · {stripeBackfill.portal_payment_review_count||0} portal payment-status reviews · {stripeBackfill.charge_amount_mismatch_count||0} Stripe activity-vs-order amount reviews · {stripeBackfill.actionable_automatic_payouts||0} actionable payouts · {stripeBackfill.unavailable_payouts||0} Instant/manual payouts not batch-reconcilable</span>}
              {stripeBackfill.phase==='done'&&stripeBackfill.card_orders&&<div style={{marginTop:6}}>Stripe-settled card charges: {stripeBackfill.settled_card_orders?.linked_count||0}/{stripeBackfill.settled_card_orders?.order_count||0} linked (${(Number(stripeBackfill.settled_card_orders?.total_cents||0)/100).toFixed(2)} actually charged) · incomplete checkout attempts: {stripeBackfill.incomplete_card_attempts?.order_count||0} (${(Number(stripeBackfill.incomplete_card_attempts?.total_cents||0)/100).toFixed(2)} intended) · SO-2313: {stripeBackfill.so_2313?.linked_count||0}/{stripeBackfill.so_2313?.order_count||0} linked (${(Number(stripeBackfill.so_2313?.linked_cents||0)/100).toFixed(2)} of ${(Number(stripeBackfill.so_2313?.total_cents||0)/100).toFixed(2)})</div>}
              {stripeBackfill.phase==='done'&&(stripeBackfill.charge_amount_mismatches||[]).length>0&&<div style={{marginTop:6,color:'#92400e'}}>Amount review: {stripeBackfill.charge_amount_mismatches.map(row=><span key={row.order_id} style={{display:'inline-block',marginRight:12}}><strong>{row.so_id||row.order_id}</strong> Stripe net activity ${(Number(row.stripe_activity_cents||0)/100).toFixed(2)} vs order ${(Number(row.portal_total_cents||0)/100).toFixed(2)} (original charge ${(Number(row.stripe_charge_cents||0)/100).toFixed(2)})</span>)}</div>}
              {stripeBackfill.phase==='done'&&(stripeBackfill.portal_payment_review||[]).length>0&&<div style={{marginTop:6,color:'#92400e'}}>Payment-status review: {stripeBackfill.portal_payment_review.map(row=><span key={row.order_id} style={{display:'inline-block',marginRight:12}}><strong>{row.so_id||row.order_id}</strong> is {row.portal_status||'non-pending'} in the portal but has no succeeded Stripe charge</span>)}</div>}
              {stripeBackfill.phase==='done'&&(stripeBackfill.errors||[]).length>0&&<div style={{marginTop:6,color:'#92400e'}}>{stripeBackfillErrorSummary(stripeBackfill.errors).map(([label,count])=><span key={label} style={{display:'inline-block',marginRight:12}}>{label}: <strong>{count}</strong></span>)}</div>}
            </div>}
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:10,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:7}}>
              <input className="form-input" style={{minWidth:300,flex:'1 1 300px'}} placeholder="Historical payout ID (po_...)" value={stripePayoutId} onChange={e=>setStripePayoutId(e.target.value)}/>
              <button className="btn btn-primary btn-sm" disabled={stripePayoutLoading||!stripePayoutId.trim()} onClick={()=>reconcileStripePayout(stripePayoutId)}>Fetch &amp; reconcile</button>
            </div>
            {stripePayoutError&&<div style={{marginTop:9,padding:8,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,color:'#b91c1c',fontSize:11,fontWeight:600}}>{stripePayoutError}</div>}
          </div>
          <div style={{padding:0,maxHeight:390,overflow:'auto'}}>
            <table style={{fontSize:11}}><thead><tr style={{background:'#f8fafc'}}><th>Payout</th><th>Arrival</th><th>Status</th><th>Reconciliation</th><th style={{textAlign:'right'}}>Activity amount</th><th style={{textAlign:'right'}}>Stripe fees</th><th style={{textAlign:'right'}}>Bank net</th><th></th></tr></thead><tbody>
              {!stripePayouts.length&&!stripePayoutLoading?<tr><td colSpan="8" style={{padding:20,textAlign:'center',color:'#94a3b8'}}>No payout ledger rows yet. Paste a historical payout ID above or wait for Stripe&apos;s next payout webhook.</td></tr>:
              stripePayouts.map(p=>{const exact=p.reconciliation_status==='exact';return<tr key={p.stripe_payout_id} style={{borderBottom:'1px solid #f1f5f9'}}>
                <td style={{fontFamily:'monospace',fontWeight:700}}>{p.stripe_payout_id}</td><td>{p.arrival_date||'—'}</td><td>{p.status}{p.method?' · '+p.method:''}</td>
                <td><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:700,background:exact?'#dcfce7':p.reconciliation_status==='mismatch'?'#fee2e2':'#fef3c7',color:exact?'#166534':p.reconciliation_status==='mismatch'?'#b91c1c':'#92400e'}}>{p.reconciliation_status}</span>{p.reconciliation_difference_cents?<span style={{marginLeft:5,color:'#b91c1c'}}>{p.reconciliation_difference_cents}¢ diff</span>:null}</td>
                <td style={{textAlign:'right'}}>${(Number(p.activity_amount_cents||0)/100).toFixed(2)}</td><td style={{textAlign:'right',color:'#b45309'}}>${(Number(p.fee_cents||0)/100).toFixed(2)}</td><td style={{textAlign:'right',fontWeight:700}}>${(Number(p.amount_cents||0)/100).toFixed(2)}</td>
                <td style={{whiteSpace:'nowrap'}}><button className="btn btn-secondary btn-sm" style={{fontSize:9,padding:'2px 6px'}} onClick={()=>loadStripePayoutDetail(p.stripe_payout_id)}>Detail</button>{!exact&&<button className="btn btn-secondary btn-sm" style={{fontSize:9,padding:'2px 6px',marginLeft:4}} onClick={()=>reconcileStripePayout(p.stripe_payout_id)}>Retry</button>}</td>
              </tr>})}
            </tbody></table>
          </div>
        </div>
        {stripePayoutDetail&&<div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><h2>QBO-ready entries — {stripePayoutDetail.payout?.stripe_payout_id}</h2><button className="btn btn-primary btn-sm" disabled={!stripePayoutDetail.qbo_entries?.length} onClick={exportStripePayoutCsv}>Export CSV</button></div>
          <div style={{padding:'9px 14px',fontSize:11,background:stripePayoutDetail.qbo_ready?'#f0fdf4':'#fffbeb',color:stripePayoutDetail.qbo_ready?'#166534':'#92400e',borderBottom:'1px solid #e2e8f0'}}>{stripePayoutDetail.qbo_ready?'All entries have deterministic semantic account routing. Resolve live QBO account IDs before posting.':'Contains review_required activity (such as an unlinked charge, refund, dispute, or amount mismatch). Resolve it before creating a QBO deposit.'}</div>
          <div style={{padding:0,maxHeight:360,overflow:'auto'}}><table style={{fontSize:10}}><thead><tr style={{background:'#f8fafc'}}><th>Balance transaction</th><th>Order</th><th>Entry</th><th>Account key</th><th>State</th><th style={{textAlign:'right'}}>Amount</th></tr></thead><tbody>
            {(stripePayoutDetail.qbo_entries||[]).map((e,i)=><tr key={e.stripe_balance_transaction_id+':'+e.entry_type+':'+i} style={{borderBottom:'1px solid #f1f5f9',background:e.qbo_ready?'#fff':'#fffbeb'}}><td style={{fontFamily:'monospace'}}>{e.stripe_balance_transaction_id}</td><td>{e.webstore_order_id||'—'}</td><td>{e.entry_type}</td><td style={{fontFamily:'monospace',color:e.qbo_ready?'#475569':'#b91c1c'}}>{e.posting_account_key}</td><td>{e.tax_state||'—'}</td><td style={{textAlign:'right',fontWeight:700}}>${(Number(e.amount_cents||0)/100).toFixed(2)}</td></tr>)}
          </tbody></table></div>
        </div>}
      </>}

      {/* ── BILL UPLOAD TAB ── */}
      {qbTab==='bills'&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div className="card">
            <div className="card-header"><h2>Upload Vendor Bill to QuickBooks</h2></div>
            <div className="card-body">
              <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>Upload a vendor bill (PDF or image) with amount. It creates the bill in QB and attaches the document.</div>
              <div style={{marginBottom:10}}>
                <label className="form-label">Vendor *</label>
                <select className="form-input" value={qbBillVendor} onChange={e=>setQbBillVendor(e.target.value)}>
                  <option value="">Select vendor...</option>
                  <optgroup label="Merchandise — 51300 Purchases">
                    {vend.filter(v=>v.is_active!==false&&!(decoVendors||[]).some(d=>d.is_active!==false&&d.vendor_id===v.id)).map(v=><option key={'vendor:'+v.id} value={'vendor:'+v.id}>{v.name}</option>)}
                  </optgroup>
                  <optgroup label="Decoration Vendors — 52000 Outside Decoration">
                    {(decoVendors||[]).filter(v=>v.is_active!==false).map(v=><option key={'deco:'+v.id} value={'deco:'+v.id}>{v.name}</option>)}
                  </optgroup>
                </select>
                {qbBillVendor&&<div style={{fontSize:10,marginTop:4,color:qbBillVendor.startsWith('deco:')?'#7c3aed':'#166534',fontWeight:600}}>
                  Auto-routes to {qbBillVendor.startsWith('deco:')?'52000 Outside Decoration':'51300 Purchases'} based on vendor category
                </div>}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div>
                  <label className="form-label">Amount *</label>
                  <input className="form-input" type="number" step="0.01" placeholder="0.00" value={qbBillAmount} onChange={e=>setQbBillAmount(e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Bill Date</label>
                  <input className="form-input" type="date" value={qbBillDate} onChange={e=>setQbBillDate(e.target.value)}/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div>
                  <label className="form-label">Freight included (optional)</label>
                  <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={qbBillFreight} onChange={e=>setQbBillFreight(e.target.value)}/>
                  <div style={{fontSize:9,color:'#64748b',marginTop:2}}>Splits to 51000 Freight In</div>
                </div>
                <div>
                  <label className="form-label">Sports Inc fee included (optional)</label>
                  <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={qbBillSportsFee} onChange={e=>setQbBillSportsFee(e.target.value)} disabled={qbBillVendor.startsWith('deco:')}/>
                  <div style={{fontSize:9,color:'#64748b',marginTop:2}}>Splits to 58000 Sports Inc Fee</div>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <label className="form-label">Memo / Description</label>
                <input className="form-input" value={qbBillMemo} onChange={e=>setQbBillMemo(e.target.value)} placeholder="e.g. Adidas team order #12345"/>
              </div>
              <div style={{marginBottom:12}}>
                <label className="form-label">Attach Document (PDF, PNG, JPG)</label>
                <div style={{border:'2px dashed #cbd5e1',borderRadius:8,padding:16,textAlign:'center',cursor:'pointer',background:qbBillFile?'#f0fdf4':'#fafafa'}}
                  onClick={()=>document.getElementById('qb-bill-file-input')?.click()}>
                  <input id="qb-bill-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:'none'}}
                    onChange={e=>{if(e.target.files?.[0])setQbBillFile(e.target.files[0])}}/>
                  {qbBillFile?<div><div style={{fontSize:13,fontWeight:600,color:'#166534'}}>{qbBillFile.name}</div><div style={{fontSize:10,color:'#64748b'}}>{(qbBillFile.size/1024).toFixed(0)} KB — click to change</div></div>:
                    <div style={{color:'#94a3b8',fontSize:12}}>Click to select file (optional)</div>}
                </div>
              </div>
              <label style={{display:'flex',gap:8,alignItems:'flex-start',padding:10,marginBottom:10,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,fontSize:11,color:'#1e3a8a'}}>
                <input type="checkbox" checked={qbCanaryMode||!migrationUnlocked} disabled={!migrationUnlocked} onChange={e=>setQbCanaryMode(e.target.checked)}/>
                <span><strong>Live canary test</strong><br/>Tags this real QBO bill with NSA-QB-CANARY for your screenshot review. Required until the initial migration is approved.</span>
              </label>
              <button className="btn btn-primary" style={{width:'100%'}} disabled={qbBillUploading||!livePreflightReady||!qbBillVendor||!qbBillAmount} onClick={uploadBill}
                title={!livePreflightReady?'Run a successful read-only live preflight first':''}>
                {qbBillUploading?'Uploading to QuickBooks...':(qbCanaryMode||!migrationUnlocked)?'Test 1 Bill':'Upload Bill to QuickBooks'}
              </button>
              {!livePreflightReady&&<div style={{fontSize:11,color:'#92400e',marginTop:7,fontWeight:600}}>Button disabled: open Overview and run Read-Only Live Preflight.</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2>Recent Bill Uploads</h2></div>
            <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
              {(qbConfig.syncLog||[]).filter(l=>l.type==='bill_upload'||l.type==='bill_canary').length===0?
                <div className="empty" style={{padding:20}}>No bills uploaded yet</div>:
              (qbConfig.syncLog||[]).filter(l=>l.type==='bill_upload'||l.type==='bill_canary').map((log,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                    background:log.status==='success'?'#dcfce7':'#fef2f2',
                    color:log.status==='success'?'#166534':'#dc2626'}}>{String(log.status||'')}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{String(log.ts||'')}</span>
                </div>
                {(log.details||[]).map((d,di)=><div key={di} style={{fontSize:11,color:'#475569',paddingLeft:4}}>&#8226; {typeof d==='string'?d:JSON.stringify(d)}</div>)}
              </div>)}
            </div>
          </div>
        </div>
      </>}

      {/* ── INVENTORY TAB ── */}
      {qbTab==='inventory'&&<>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>QBO Product Items (One per SKU)</h2>
            <button className="btn btn-primary btn-sm" disabled title="Locked until the product-item canaries are approved">Review Required Below</button>
          </div>
          <div style={{padding:'8px 16px',background:'#fffbeb',fontSize:11,color:'#92400e',borderBottom:'1px solid #fef3c7'}}>
            The portal is the inventory source of truth. QBO will receive one NonInventory purchase item per SKU using 40000 Sales and 51300 Purchases. QBO does not track quantity per item; the inventory value reaches the balance sheet through the valuation entry below. Review and approve at most 20 SKUs after the existing-item and new-item canaries pass.
          </div>
          <div style={{padding:14}}>
            <button className="btn btn-sm" disabled={qbSyncing||productReviewBusy||!livePreflightReady} onClick={reviewProducts}>Review Products — No QBO Changes</button>
            {productReview&&<>
              <p>Product review: {JSON.stringify(productReview.counts)}. Existing items are linked before any new SKU is created.</p>
              <h3>Proposed product batch ({productBatchRows.length} SKUs)</h3>
              <label style={{marginRight:12}}>Batch size <select aria-label="Product batch size" value={productBatchLimit} disabled={qbSyncing} onChange={e=>{setProductBatchLimit(Number(e.target.value));setProductApproved(false)}}>{QB_BATCH_SIZES.map(size=><option key={size} value={size}>{size}</option>)}</select></label>
              <label><input type="checkbox" checked={productPoOnly} disabled={qbSyncing} onChange={e=>{setProductPoOnly(e.target.checked);setProductApproved(false)}}/> Only SKUs on purchase orders awaiting sync ({poPendingSkus.size||'run a PO review first'})</label>
              <table><thead><tr><th>SKU</th><th>Action</th><th>QBO ID</th><th>Portal variants</th><th>Accounts</th></tr></thead><tbody>{productBatchRows.map(r=><tr key={r.sku}><td>{r.sku}</td><td>{r.action}</td><td>{r.qboId||'New'}</td><td>{r.sourceIds.length}</td><td>40000 / 51300</td></tr>)}</tbody></table>
              <label><input type="checkbox" checked={productApproved} disabled={qbSyncing} onChange={e=>setProductApproved(e.target.checked)}/> I approve this reviewed product batch.</label>
              {!productReadiness.ready&&<p style={{color:'#b91c1c',fontWeight:600}}>
                Run button disabled: the batch needs one proven link canary{productReadiness.linked?' (done)':' (still needed)'} and one proven creation canary{productReadiness.created?' (done)':' (still needed)'}.
                {!productReadiness.created&&' Use "Test 1 QBO Item" below on a SKU that is not in QuickBooks yet, with "Approve creation of this one SKU" ticked. One creation unlocks the batch.'}
              </p>}
              <button className="btn btn-sm" disabled={qbSyncing||!productApproved||!productBatchRows.length||!productReadiness.ready} onClick={runProductBatch}>Run Reviewed Product Batch</button>
              <label>Review filter <select aria-label="Product review filter" value={productFilter} onChange={e=>setProductFilter(e.target.value)}>{['link','create','blocked','excluded'].map(a=><option key={a} value={a}>{a}</option>)}</select></label>
              <table><thead><tr><th>SKU</th><th>Action</th><th>QBO ID</th><th>Reason</th></tr></thead><tbody>{productReview.rows.filter(r=>r.action===productFilter).slice(0,20).map((r,i)=><tr key={r.sku+i}><td>{r.sku}</td><td>{r.action}</td><td>{r.qboId||'New'}</td><td>{r.reason}</td></tr>)}</tbody></table>
            </>}
            {qbConfig.lastProductRun&&<><h3>Product reconciliation: {qbConfig.lastProductRun.status}</h3><button className="btn btn-sm" onClick={downloadProductEvidence}>Download Product Reconciliation</button><table><thead><tr><th>SKU</th><th>Result</th><th>QBO ID</th><th>Error</th></tr></thead><tbody>{(qbConfig.lastProductRun.results||[]).map(r=><tr key={r.sku}><td>{r.sku}</td><td>{r.result}</td><td>{r.qboId}</td><td>{r.error||''}</td></tr>)}</tbody></table><p>{JSON.stringify(qbConfig.lastProductRun.counts)}</p>{qbConfig.lastProductRun.error&&<p>{qbConfig.lastProductRun.error}</p>}</>}
          </div>
          <div style={{padding:'12px 14px',background:'#ecfdf5',borderBottom:'1px solid #a7f3d0'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:4}}>Required invoice service item</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Creates, repairs, or verifies exactly one shared QBO item named NSA Portal Sales, mapped only to 40000 Sales. It creates no invoice or payment and sends no quantity, cost, or inventory value.</div>
            <button className="btn btn-primary btn-sm" style={{background:'#047857'}} disabled={qbSyncing||!livePreflightReady} onClick={runPortalSalesItemCanary}>{qbSyncing?'Testing...':'Test NSA Portal Sales Item'}</button>
            {!livePreflightReady&&<div style={{fontSize:11,color:'#92400e',marginTop:7,fontWeight:600}}>Button disabled: open Overview and run Read-Only Live Preflight.</div>}
          </div>
          <div style={{padding:'12px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe'}}>
            <div style={{marginBottom:12}}>
              <label>Read an existing QBO item by ID <input className="form-input" aria-label="QBO item ID to audit" value={qbAuditItemId} onChange={e=>setQbAuditItemId(e.target.value)}/></label>
              <button className="btn btn-sm" disabled={qbSyncing||!livePreflightReady||!/^\d+$/.test(qbAuditItemId.trim())} onClick={auditQBOItem}>Read QBO Item — No Changes</button>
              {qbItemAudit&&<pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(qbItemAudit,null,2)}</pre>}
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:4}}>Test exactly one QBO NonInventory purchase item</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Recovers an existing SKU link, verifies NonInventory type plus 40000/51300 routing, and saves only after API read-back. New items require the one-SKU creation approval below; conflicts remain blocked.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Product SKU to test in QuickBooks" style={{minWidth:420,maxWidth:700}} value={qbCanaryProductId} onChange={e=>{setQbCanaryProductId(e.target.value);setProductCreateApproved(false)}}>
                <option value="">Select one active SKU...</option>
                {canaryProducts.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}{_prodQBMap[p.id]?' — linked QB #'+_prodQBMap[p.id]:''}</option>)}
              </select>
              <label><input type="checkbox" checked={productCreateApproved} disabled={qbSyncing} onChange={e=>setProductCreateApproved(e.target.checked)}/> Approve creation of this one SKU if no existing item matches.</label>
              <button className="btn btn-primary btn-sm" style={{background:'#0369a1'}} disabled={qbSyncing||!livePreflightReady||!selectedCanaryProduct} onClick={runProductCanary}>{qbSyncing?'Testing...':'Test 1 QBO Item'}</button>
              {selectedCanaryProduct&&_prodQBMap[selectedCanaryProduct.id]&&<button className="btn btn-sm" style={{background:'#fff7ed',border:'1px solid #fdba74',color:'#9a3412'}} disabled={qbSyncing||!livePreflightReady} onClick={runInactiveProductLinkCleanup}>{qbSyncing?'Checking...':'Clear Inactive Link'}</button>}
            </div>
            {!livePreflightReady&&<div style={{fontSize:11,color:'#92400e',marginTop:7,fontWeight:600}}>Button disabled: open Overview and run Read-Only Live Preflight.</div>}
          </div>
          <div style={{padding:'12px 14px',background:'#fff7ed',borderBottom:'1px solid #fdba74'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#9a3412',marginBottom:4}}>Inventory quantities stay in the portal</div>
            <div style={{fontSize:11,color:'#475569'}}>QBO SKU items are NonInventory purchase items, so bills and POs carry quantities without changing QBO quantity on hand or inventory value. Manual portal inventory adjustments therefore remain portal-only.</div>
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr style={{background:'#f8fafc'}}><th>SKU</th><th>Product</th><th>Brand</th><th style={{textAlign:'right'}}>Portal Qty</th><th style={{textAlign:'right'}}>Portal Value</th><th>QB Status</th></tr></thead>
              <tbody>
                {prod.filter(p=>p.is_active!==false).map(p=>{
                  const inv=p._inv||{};
                  const totalQty=Object.values(inv).reduce((a,v)=>a+safeNum(v),0);
                  const totalValue=totalQty*safeNum(p.nsa_cost);
                  return<tr key={p.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{fontWeight:700,fontFamily:'monospace'}}>{p.sku}</td>
                    <td>{p.name}{p.color?' - '+p.color:''}</td>
                    <td><span className="badge badge-gray">{p.brand}</span></td>
                    <td style={{textAlign:'right',fontWeight:600}}>{totalQty}</td>
                    <td style={{textAlign:'right',fontWeight:600,color:'#166534'}}>${totalValue.toFixed(2)}</td>
                    <td>{_prodQBMap[p.id]?<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>QB #{_prodQBMap[p.id]}</span>:
                      <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#f1f5f9',color:'#94a3b8',fontWeight:600}}>—</span>}</td>
                  </tr>})}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2>Inventory Value on the Balance Sheet</h2></div>
          <div style={{padding:'8px 16px',background:'#f0f9ff',fontSize:11,color:'#0c4a6e',borderBottom:'1px solid #bae6fd'}}>
            Values every unit in portal stock at its cost (size cost, else catalog cost) and posts one journal entry that moves {qbConfig.mapping.inventory_asset_account} Inventory Asset to that value against {qbConfig.mapping.cogs_account} Cost of Goods Sold. One entry per day, read back and receipted like every other write. Units with no cost are excluded and listed, never guessed.
          </div>
          <div style={{padding:14}}>
            <button className="btn btn-sm" disabled={qbSyncing||!livePreflightReady} onClick={reviewInventoryValuation}>Review Inventory Value — No QBO Changes</button>
            {invValuationReview&&<section role="region" aria-label="Confirm inventory valuation entry" style={{marginTop:12,padding:12,background:'#fff',border:'2px solid #0369a1',borderRadius:8}}>
              <table style={{fontSize:12}}><tbody>
                <tr><td>Portal inventory value ({invValuationReview.asOf})</td><td style={{textAlign:'right',fontWeight:700}}>${safeNum(invValuationReview.value).toFixed(2)}</td></tr>
                <tr><td>Units / products valued</td><td style={{textAlign:'right'}}>{invValuationReview.units} / {invValuationReview.products}</td></tr>
                <tr><td>QBO Inventory Asset balance now</td><td style={{textAlign:'right'}}>${safeNum(invValuationReview.currentBalance).toFixed(2)}</td></tr>
                <tr><td style={{fontWeight:700}}>Adjustment</td><td style={{textAlign:'right',fontWeight:700,color:invValuationReview.delta>=0?'#166534':'#b91c1c'}}>{invValuationReview.delta>=0?'Debit':'Credit'} Inventory Asset ${Math.abs(safeNum(invValuationReview.delta)).toFixed(2)}</td></tr>
              </tbody></table>
              {invValuationReview.unpricedCount>0&&<div style={{fontSize:11,color:'#92400e',marginTop:8}}>
                <strong>{invValuationReview.unpricedUnits} units on {invValuationReview.unpricedCount} products have no cost and are excluded.</strong> Add a cost on the product to include them: {invValuationReview.unpriced.slice(0,20).map(row=>row.sku+' ('+row.units+')').join(', ')}{invValuationReview.unpricedCount>20?' …':''}
              </div>}
              {invValuationReview.negative?.length>0&&<div style={{fontSize:11,color:'#b91c1c',marginTop:6}}>Negative stock counted as zero: {invValuationReview.negative.slice(0,20).map(row=>row.sku+' '+row.size+' ('+row.quantity+')').join(', ')}</div>}
              {invValuationReview.status==='unchanged'?<p style={{marginTop:8}}>QBO already matches the portal value. No entry is needed today.</p>:<>
                <label style={{display:'block',marginTop:10}}><input type="checkbox" checked={invValuationApproved} disabled={qbSyncing} onChange={e=>setInvValuationApproved(e.target.checked)}/> I approve posting exactly this one journal entry ({invValuationReview.docNumber}).</label>
                <button className="btn btn-primary btn-sm" style={{marginTop:8}} disabled={qbSyncing||!livePreflightReady||!invValuationApproved} onClick={postInventoryValuation}>Post Inventory Valuation Entry</button>
                <button className="btn btn-sm" style={{marginLeft:8,marginTop:8}} disabled={qbSyncing} onClick={()=>{setInvValuationReview(null);setInvValuationApproved(false);nf('Inventory valuation cancelled — nothing was sent')}}>Cancel</button>
              </>}
            </section>}
            {qbConfig.lastInventoryValuation&&<p style={{fontSize:11,color:'#475569',marginTop:10}}>Last valuation {qbConfig.lastInventoryValuation.asOf}: {qbConfig.lastInventoryValuation.status}{qbConfig.lastInventoryValuation.qboId?' (QBO journal entry #'+qbConfig.lastInventoryValuation.qboId+')':''} · portal value ${safeNum(qbConfig.lastInventoryValuation.value).toFixed(2)} · adjustment ${safeNum(qbConfig.lastInventoryValuation.delta).toFixed(2)}{qbConfig.lastInventoryValuation.unpricedUnits?' · '+qbConfig.lastInventoryValuation.unpricedUnits+' units unpriced':''}</p>}
          </div>
        </div>
      </>}

      <QBBackgroundSalesCard/>
      <QBServerReviewCard/>
      {qbConfig.lastPaymentReview&&<div className="card" style={{padding:16,marginBottom:16}}>
        <h2>Payment review</h2>
        <p>{qbConfig.lastPaymentReview.at} · {qbConfig.lastPaymentReview.status} · {(qbConfig.lastPaymentReview.rows||[]).filter(r=>r.action==='aligned').length} aligned</p>
        {(qbConfig.lastPaymentReview.details||[]).map((d,i)=><p key={i}>{d}</p>)}
        <table><thead><tr><th>Invoice</th><th>Portal total</th><th>QBO total</th><th>Portal paid</th><th>QBO paid</th><th>Next action</th></tr></thead><tbody>
          {(qbConfig.lastPaymentReview.rows||[]).filter(r=>r.action!=='aligned').map(r=><tr key={r.invoice}><td>{r.invoice}</td><td>{r.portalTotal}</td><td>{r.qboTotal??'Unavailable'}</td><td>{r.portalPaid}</td><td>{r.qboPaid??'Unavailable'}</td><td>{r.action}</td></tr>)}
        </tbody></table>
      </div>}
      {/* ── SETTINGS TAB ── */}
      {qbTab==='settings'&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div className="card">
            <div className="card-header"><h2>Account Mapping</h2></div>
            <div className="card-body">
              <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Editable account numbers. Each is matched and type-checked against QBO before use.</div>
              {QB_MAPPING_FIELDS.map(([key,label])=>
                <div key={key} style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#475569',width:150}}>{label}</span>
                  <input className="form-input" style={{flex:1,fontSize:11,padding:'4px 8px'}} value={qbConfig.mapping[key]||QB_ACCOUNT_MAPPING_DEFAULTS[key]}
                    onChange={e=>setQBConfig(prev=>({...prev,mapping:{...prev.mapping,[key]:e.target.value},preflight:null,initialMigrationApproved:false,autoSync:'manual'}))}/>
                </div>)}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2>Connection Details</h2></div>
            <div className="card-body" style={{fontSize:12}}>
              <div style={{marginBottom:6}}><strong>Realm ID:</strong> <code style={{background:'#f1f5f9',padding:'1px 4px',borderRadius:3}}>{qbConfig.realm_id||'—'}</code></div>
              <div style={{marginBottom:6}}><strong>Company:</strong> {qbConfig.companyName||'—'}</div>
              <div style={{marginBottom:6}}><strong>Connection:</strong> {qbConfig.connected?
                <span style={{color:'#16a34a',fontWeight:600}}>Connected (tokens secured server-side)</span>:
                <span style={{color:'#dc2626'}}>Not connected</span>}</div>
              <div style={{marginBottom:12}}><strong>Auto-sync:</strong> {qbConfig.autoSync}</div>
              <div style={{padding:10,background:'#f8fafc',borderRadius:6,fontSize:11,color:'#64748b'}}>
                <strong>Required Netlify env vars:</strong><br/>
                QB_CLIENT_ID — from developer.intuit.com<br/>
                QB_CLIENT_SECRET — from developer.intuit.com<br/>
                QB_REDIRECT_URI — (optional) auto-detected from site URL if not set
              </div>
            </div>
          </div>
        </div>
      </>}

      {/* ── SYNC LOG TAB ── */}
      {qbTab==='log'&&<>
        <div className="card">
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>Sync History</h2>
            <span style={{fontSize:10,color:'#64748b'}}>Latest 100 entries retained for audit</span>
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            {(qbConfig.syncLog||[]).length===0?<div className="empty" style={{padding:20}}>No sync history yet</div>:
            (qbConfig.syncLog||[]).map((log,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                  background:log.status==='success'?'#dcfce7':log.status==='partial'?'#fef3c7':log.status==='skipped'?'#f1f5f9':'#fef2f2',
                  color:log.status==='success'?'#166534':log.status==='partial'?'#92400e':log.status==='skipped'?'#64748b':'#dc2626'}}>{String(log.status||'')}</span>
                <span style={{fontSize:11,fontWeight:700}}>{log.type==='all'?'Full Sync':String(log.type||'').replace(/_/g,' ')}</span>
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{String(log.ts||'')}</span>
              </div>
              {(log.details||[]).map((d,di)=><div key={di} style={{fontSize:10,color:'#64748b',paddingLeft:8}}>&#8226; {typeof d==='string'?d:JSON.stringify(d)}</div>)}
            </div>)}
          </div>
        </div>
      </>}
      </>}

      {/* Setup info when not connected */}
      {!qbConfig.connected&&<div className="card" style={{marginTop:16}}>
        <div className="card-header"><h2>Setup Instructions</h2></div>
        <div className="card-body" style={{fontSize:12,color:'#64748b'}}>
          <div style={{marginBottom:8}}><strong>1. Create a QuickBooks Developer App:</strong></div>
          <div style={{paddingLeft:16,marginBottom:12}}>
            Go to developer.intuit.com &#8594; Create an app &#8594; Select "QuickBooks Online and Payments"<br/>
            Scope: <code>com.intuit.quickbooks.accounting</code><br/>
            Redirect URI: <code>https://your-site.netlify.app/.netlify/functions/qb-auth?action=callback</code>
          </div>
          <div style={{marginBottom:8}}><strong>2. Add Netlify environment variables:</strong></div>
          <div style={{fontFamily:'monospace',fontSize:10,background:'#f8fafc',padding:10,borderRadius:6,marginBottom:12}}>
            QB_CLIENT_ID=your_client_id<br/>
            QB_CLIENT_SECRET=your_client_secret<br/>
            QB_REDIRECT_URI (optional — auto-detected from site URL)
          </div>
          <div style={{marginBottom:8}}><strong>3. What gets synced:</strong></div>
          <div>&#8226; <strong>Customers</strong> &#8594; QB Customers (name, contact, address, order totals in notes)</div>
          <div>&#8226; <strong>Invoices</strong> &#8594; QB Invoices (total amount as single line, payments applied)</div>
          <div>&#8226; <strong>Vendor Bills</strong> &#8594; Upload bills with PDF/image attachments directly into QB</div>
          <div>&#8226; <strong>Product Items</strong> &#8594; One QBO NonInventory Item per SKU using 40000 Sales / 51300 Purchases; portal inventory is the source of truth</div>
        </div>
      </div>}
    </>);
  }
