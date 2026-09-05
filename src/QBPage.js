// QuickBooks Online sync page — lifted verbatim out of App() (was `function rQB()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import { useEffect, useState } from 'react';
import { useAppData } from './AppContext';
import { D_V } from './constants';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP } from './App';
import { authFetch } from './utils';
import { createQBSyncEngine, groupPortalPurchaseOrders, portalCustomerDisplayName, qbResponseErrorDetail } from './qbSyncEngine';
import {
  QB_ACCOUNT_MAPPING_DEFAULTS,
  QB_ACCOUNT_POSTING_MATRIX,
  QB_ACCOUNT_SPECS,
  QB_STATE_TAX_ACCOUNT_KEYS,
  buildVendorBillLines,
  calculateCustomerShipping,
  loadAllQBEntities,
  loadQBAccounts,
  queryQBReadOnly,
  readQBWithRetry,
  manualBillAccountKey,
  normalizeVendorName,
  qbWriteAccountRef,
  resolveQBAccountRefs,
} from './qbAccountMappings';

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
  const [qbPreflighting,setQbPreflighting]=useState(false);
  const [stripePayouts,setStripePayouts]=useState([]);
  const [stripePayoutId,setStripePayoutId]=useState('');
  const [stripePayoutDetail,setStripePayoutDetail]=useState(null);
  const [stripePayoutLoading,setStripePayoutLoading]=useState(false);
  const [stripePayoutError,setStripePayoutError]=useState('');
  const [qbAuditItemId,setQbAuditItemId]=useState('');
  const [qbItemAudit,setQbItemAudit]=useState(null);
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
    const {syncCustomerCanary,syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,clearInactiveProductLink,syncPortalSalesItemCanary,syncSalesOrders,syncPurchaseOrders,syncAll}=createQBSyncEngine({cust,sos,invs,prod,vend,invAdjLog,invPOs,submittedBatches,qbApi,qbConfig,persistQbLink,nf,dP,setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend});

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
        const entities=['Customer','Vendor','Item','Invoice','Bill','PurchaseOrder','Payment'];
        for(const entity of entities){
          try{
            const res=await queryQBReadOnly(qbApi,'SELECT count(*) FROM '+entity,entity+' count query');
            const count=res?.QueryResponse?.totalCount;
            log.details.push(entity+' records currently in QBO: '+(count==null?'count unavailable':count));
          }catch(e){log.details.push(entity+' count unavailable: '+e.message);log.status='partial'}
        }
        setQBConfig(prev=>({...prev,preflight:{status:log.status,at:new Date().toISOString(),company:ci?.CompanyName||prev.companyName,realm_id:prev.realm_id,accounts:Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,{id:ref.value,number:ref.accountNumber,name:ref.name}]))},syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Live QBO preflight complete — no records changed');
      }catch(e){
        log.status='error';log.details.push(e.message||'Preflight failed');
        setQBConfig(prev=>({...prev,preflight:{status:'error',at:new Date().toISOString(),error:e.message},syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Live QBO preflight failed — '+(e.message||'setup error'),'error');
      }finally{setQbPreflighting(false)}
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
      let qbVendorId=vendor.qb_vendor_id;
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
    const unsyncedPOGroups=groupPortalPurchaseOrders(sos,poMap);
    const unsyncedInvs=invs.filter(i=>!i.qb_invoice_id);
    const _custQBMap=qbConfig.custQBMap||{};
    const _prodQBMap=qbConfig.prodQBMap||{};
    const custWithQB=cust.filter(c=>_custQBMap[c.id]).length;
    const prodWithQB=prod.filter(p=>_prodQBMap[p.id]).length;
    const totalInvQty=prod.reduce((a,p)=>a+Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0),0);
    const totalInvValue=prod.reduce((a,p)=>{const qty=Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0);return a+qty*safeNum(p.nsa_cost)},0);
    const unsyncedInvPOs=invPOs.filter(p=>!p._qb_synced);
    const migrationUnlocked=qbConfig.initialMigrationApproved===true;
    const verifiedCanaryBills=new Set((qbConfig._qbCanaryBillIds||[]).map(String)).size;
    const livePreflightReady=qbConfig.preflight?.status==='success'&&String(qbConfig.preflight?.realm_id||'')===String(qbConfig.realm_id||'');
    const activeCanaryCustomers=cust.filter(c=>c.is_active!==false&&!c.deleted_at).sort((a,b)=>portalCustomerDisplayName(a).localeCompare(portalCustomerDisplayName(b)));
    const canaryInvoices=[...unsyncedInvs].sort((a,b)=>String(a.display_id||a.id).localeCompare(String(b.display_id||b.id),undefined,{numeric:true}));
    const canaryProducts=[...new Map(prod.filter(p=>p.is_active!==false&&String(p.sku||'').trim()).sort((a,b)=>String(a.sku).localeCompare(String(b.sku),undefined,{numeric:true})).map(p=>[String(p.sku).trim().toUpperCase(),p])).values()];
    const canarySOs=[...unsyncedSOs].sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
    const canaryPOs=[...unsyncedPOGroups].sort((a,b)=>String(a.poId).localeCompare(String(b.poId),undefined,{numeric:true}));
    const selectedCanaryInvoice=canaryInvoices.find(inv=>String(inv.id)===String(qbCanaryInvoiceId));
    const selectedCanaryProduct=canaryProducts.find(p=>String(p.id)===String(qbCanaryProductId));
    const selectedCanarySO=canarySOs.find(so=>String(so.id)===String(qbCanarySOId));
    const selectedCanaryPO=canaryPOs.find(group=>String(group.poId)===String(qbCanaryPOId));
    const selectedInvoiceCustomer=selectedCanaryInvoice&&cust.find(c=>c.id===selectedCanaryInvoice.customer_id);
    const invoiceCanaryBlock=selectedCanaryInvoice&&!_custQBMap[selectedCanaryInvoice.customer_id]?'Sync this invoice customer first':selectedCanaryInvoice&&safeNum(selectedCanaryInvoice.tax)>0?'Taxable invoices remain blocked until QBO tax-code mapping is deployed':'';
    const soCanaryBlock=selectedCanarySO&&!_custQBMap[selectedCanarySO.customer_id]?'Sync this sales-order customer first':'';
    const poCanaryBlock=selectedCanaryPO?.invalidReason||'';
    const runCustomerCanary=async()=>{
      if(!qbCanaryCustomerId)return;
      const result=await syncCustomerCanary(qbCanaryCustomerId);
      if(result?.status==='needs_confirmation'){
        const approved=window.confirm('No exact active QBO customer matches "'+result.customerName+'".\n\nCreate exactly ONE new QBO customer with its mapped QBO payment terms and verify it by API read-back?');
        if(!approved){nf('Customer test cancelled — no QBO customer was created');return}
        await syncCustomerCanary(qbCanaryCustomerId,{allowCreate:true});
      }else if(result?.status==='needs_term_confirmation'){
        const approved=window.confirm('QBO customer #'+result.qbId+' ("'+result.customerName+'") currently has terms "'+result.currentTerm+'".\n\nUpdate exactly this ONE customer to "'+result.desiredTerm+'" and verify it by API read-back?');
        if(!approved){nf('Customer terms update cancelled — no QBO customer was changed');return}
        await syncCustomerCanary(qbCanaryCustomerId,{allowTermUpdate:true});
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
    const runProductCanary=async()=>{
      if(!selectedCanaryProduct)return;
      if(!window.confirm('Recover exactly ONE existing QBO NonInventory purchase item?\n\nSKU: '+selectedCanaryProduct.sku+'\nProduct: '+selectedCanaryProduct.name+'\nSales: 40000\nPurchases: 51300\n\nExact existing items are linked without a QBO write. Missing matches are blocked for review. The item and accounts will be verified by API read-back.')){nf('QBO NonInventory item canary cancelled — nothing was sent');return}
      await syncInventory({canaryProductId:selectedCanaryProduct.id});
    };
    const runInactiveProductLinkCleanup=async()=>{
      if(!selectedCanaryProduct||!_prodQBMap[selectedCanaryProduct.id])return;
      const result=await clearInactiveProductLink(selectedCanaryProduct.id);
      if(result?.status!=='needs_confirmation')return;
      const approved=window.confirm('Remove exactly ONE stale portal-to-QBO product link?\n\nSKU: '+result.sku+'\nQBO item: #'+result.itemId+'\n\nQBO API read-back verified this item is inactive. This removes only the portal link; it does not change or delete the QBO item.');
      if(!approved){nf('Inactive-link cleanup cancelled — no portal link was removed');return}
      await clearInactiveProductLink(selectedCanaryProduct.id,{allowUnlink:true});
    };
    const runPortalSalesItemCanary=async()=>{
      if(!window.confirm('Create or repair exactly ONE required QBO service item?\n\nName: NSA Portal Sales\nType: Service\nSales account: 40000 Sales\n\nThis item carries portal invoice totals and customer-billed shipping. No invoice, payment, quantity, cost, or inventory value will be sent. The item will be verified by API read-back.')){nf('NSA Portal Sales test cancelled — nothing was sent');return}
      await syncPortalSalesItemCanary();
    };
    const runSalesOrderCanary=async()=>{
      if(!selectedCanarySO||soCanaryBlock)return;
      const preview=buildQBSalesOrder(selectedCanarySO);
      if(!window.confirm('Create or link exactly ONE QBO Estimate?\n\nPortal sales order: '+selectedCanarySO.id+'\nCustomer: '+preview.customerRef+'\nTotal: $'+safeNum(preview.total).toFixed(2)+'\n\nThis is non-posting and will be verified by API read-back.')){nf('Sales-order canary cancelled — nothing was sent');return}
      await syncSalesOrders({}, {}, {canarySOId:selectedCanarySO.id});
    };
    const runPurchaseOrderCanary=async()=>{
      if(!selectedCanaryPO||poCanaryBlock)return;
      const total=selectedCanaryPO.entries.reduce((sum,{pl,so,it})=>sum+safeNum(buildQBPurchaseOrder(pl,so,it).total),0);
      if(!window.confirm('Create or link exactly ONE QBO Purchase Order?\n\nPortal PO: '+selectedCanaryPO.poId+'\nVendor: '+(selectedCanaryPO.vendor||'Unknown')+'\nTotal: $'+total.toFixed(2)+'\n\nThis is non-posting. The test will not create a vendor or item, and the PO will be verified by API read-back.')){nf('Purchase-order canary cancelled — nothing was sent');return}
      await syncPurchaseOrders({}, {canaryPOId:selectedCanaryPO.poId});
    };

    // Build what a QB sync would push
    const buildQBSalesOrder=(so)=>{
      const c=cust.find(x=>x.id===so.customer_id);
      const saf=safeArt(so);
      const _aq={};safeItems(so).forEach(it2=>{const q2=Object.values(safeSizes(it2)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it2).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){_aq[d2.art_file_id]=(_aq[d2.art_file_id]||0)+q2}})});
      const lines=[];
      safeItems(so).forEach(it=>{
        const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
        if(!qty)return;
        lines.push({type:'SalesItemLine',desc:it.sku+' '+it.name+(it.color?' - '+it.color:''),qty,rate:it.unit_sell,amount:qty*it.unit_sell,account:qbConfig.mapping.income_account});
        safeDecos(it).forEach(d=>{
          const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;
          const dp=dP(d,qty,saf,cq);
          const sell=dp.sell;
          const eq=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);
          if(sell>0)lines.push({type:'SalesItemLine',desc:'Decoration: '+(d.position||d.deco_type||d.kind||'Art'),qty:eq,rate:sell,amount:eq*sell,account:qbConfig.mapping.income_account});
        });
      });
      const salesSubtotal=lines.reduce((a,l)=>a+l.amount,0);
      const customerShipping=calculateCustomerShipping(so,salesSubtotal);
      if(customerShipping>0)lines.push({type:'SalesItemLine',desc:'Customer shipping',qty:1,rate:customerShipping,amount:customerShipping,account:qbConfig.mapping.income_account});
      return{docType:'SalesOrder',docNumber:so.id,customerRef:c?.name||'Unknown',date:so.created_at,memo:so.memo,lines,total:lines.reduce((a,l)=>a+l.amount,0)};
    };

    const buildQBPurchaseOrder=(pl,so,it)=>{
      const qty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
      const rate=pl.po_type==='outside_deco'?safeNum(pl.unit_cost):safeNum(it.nsa_cost);
      return{docType:'PurchaseOrder',docNumber:pl.po_id,vendorRef:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand,
        date:pl.created_at,soRef:so.id,lines:[{desc:it.sku+' '+it.name,qty,rate,amount:qty*rate}],
        account:pl.po_type==='outside_deco'?qbConfig.mapping.deco_account:qbConfig.mapping.purchases_account,
        total:qty*rate};
    };

    const buildQBInvoice=(inv)=>{
      const so=sos.find(s=>s.id===inv.so_id);
      const customer=cust.find(c=>c.id===inv.customer_id);
      const taxState=String(inv.shipping_state||customer?.shipping_state||'').trim().toUpperCase();
      const taxKey=QB_STATE_TAX_ACCOUNT_KEYS[taxState];
      return{docType:'Invoice',docNumber:inv.id,customerRef:cust.find(c=>c.id===inv.customer_id)?.name,
        date:inv.date,soRef:inv.so_id,amount:inv.total,paid:inv.paid,balance:inv.total-inv.paid,
        tax:inv.tax||0,taxAccount:taxKey?qbConfig.mapping[taxKey]:'State not mapped',
        account:qbConfig.mapping.ar_account};
    };

    // Simulate a sync
    const runSync=(type)=>{
      const log={ts:new Date().toLocaleString(),type,status:'success',details:[]};
      if(type==='all'||type==='sales_orders'){
        unsyncedSOs.forEach(so=>{
          const qbSO=buildQBSalesOrder(so);
          log.details.push('SO: '+so.id+' → QB SalesOrder ($'+qbSO.total.toFixed(2)+')');
        });
      }
      if(type==='all'||type==='purchase_orders'){
        sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).filter(pl=>!poMap[pl.po_id]).forEach(pl=>{
          const qbPO=buildQBPurchaseOrder(pl,so,it);
          log.details.push('PO: '+pl.po_id+' → QB PurchaseOrder to '+qbPO.vendorRef+' ($'+qbPO.total.toFixed(2)+')');
        })})});
        // Inventory POs
        unsyncedInvPOs.forEach(po=>{
          const totalCost=po.items.reduce((a,it)=>a+Object.values(it.sizes).reduce((a2,v)=>a2+v,0)*(it.nsa_cost||0),0);
          log.details.push('INV-PO: '+po.po_number+' → QB PurchaseOrder to '+po.vendor_name+' ($'+totalCost.toFixed(2)+')');
        });
      }
      if(type==='all'||type==='inventory_adjustments'){
        const recentAdj=invAdjLog.filter(l=>!l._qb_synced).slice(0,50);
        recentAdj.forEach(adj=>{
          log.details.push('ADJ: '+adj.sku+' '+adj.size+' '+(adj.qty_change>0?'+':'')+adj.qty_change+' ('+adj.adjustment_type+')');
        });
      }
      if(type==='all'||type==='invoices'){
        unsyncedInvs.forEach(inv=>{
          const qbInv=buildQBInvoice(inv);
          log.details.push('INV: '+inv.id+' → QB Invoice ($'+qbInv.amount.toFixed(2)+')');
        });
      }
      if(log.details.length===0){log.details.push('Nothing to sync');log.status='skipped'}
      setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,50),lastSync:new Date().toLocaleString()}));
      nf('🔄 QB Sync: '+log.details.length+' items processed');
    };

    return(<>
      {/* Deployment marker: forces a fresh lazy-loaded QBO chunk after the
          account-reference payload hardening shipped. */}
      <span hidden data-qb-payload-version="account-ref-v2" />
      {/* Connection Status */}
      <div className="card" style={{marginBottom:16,borderLeft:'4px solid '+(qbConfig.connected?'#22c55e':'#d97706')}}>
        <div className="card-body">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:48,height:48,borderRadius:12,background:qbConfig.connected?'#dcfce7':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>
              {qbConfig.connected?'✅':'⚠️'}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:qbConfig.connected?'#166534':'#92400e'}}>
                {qbConfig.connected?'Connected to QuickBooks Online':'QuickBooks Not Connected'}
              </div>
              {qbConfig.connected?
                <div style={{fontSize:12,color:'#64748b'}}>Company: {qbConfig.companyName||'Connected'} · Realm: {qbConfig.realm_id} · Last sync: {qbConfig.lastSync||'Never'}</div>:
                <div style={{fontSize:12,color:'#92400e'}}>{qbConfig.connectionError||'Connect your QBO account to sync customers, invoices, bills, and QBO items'}</div>}
            </div>
            <div style={{display:'flex',gap:6}}>
              {qbConfig.connected&&<button className="btn btn-secondary" style={{fontSize:12}} onClick={connectQB}>Reconnect</button>}
              {qbConfig.connected?
                <button className="btn btn-secondary" style={{color:'#dc2626',fontSize:12}} onClick={disconnectQB}>Disconnect</button>:
                <button className="btn btn-primary" style={{background:'#2CA01C',borderColor:'#2CA01C',padding:'10px 20px',fontSize:14,fontWeight:700}} onClick={connectQB}>Connect to QuickBooks</button>}
            </div>
          </div>
        </div>
      </div>

      {qbConfig.connected&&<>
      {/* Stats */}
      <div className="stats-row" style={{marginBottom:16}}>
        <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}><div className="stat-label">Customers in QB</div><div className="stat-value" style={{color:'#2563eb'}}>{custWithQB}/{cust.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}><div className="stat-label">Invoices to Sync</div><div className="stat-value" style={{color:'#d97706'}}>{unsyncedInvs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #16a34a'}}><div className="stat-label">SOs to Sync</div><div className="stat-value" style={{color:'#16a34a'}}>{unsyncedSOs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}><div className="stat-label">POs to Sync</div><div className="stat-value" style={{color:'#7c3aed'}}>{unsyncedPOGroups.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Products in QB</div><div className="stat-value" style={{color:'#166534'}}>{prodWithQB}/{prod.length}</div></div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{marginBottom:16}}>
        {[['overview','Overview'],['customers','Customers'],['invoices','Invoices'],['stripe','Stripe Payouts'],['bills','Bill Upload'],['inventory','QBO Items'],['settings','Settings'],['log','Sync Log']].map(([k,l])=>
          <button key={k} className={`tab ${qbTab===k?'active':''}`} onClick={()=>setQbTab(k)}>{l}</button>)}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {qbTab==='overview'&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
          <div className="card">
            <div className="card-header"><h2>Sync Controls</h2></div>
            <div className="card-body">
              <div style={{marginBottom:12}}>
                <label className="form-label">Sync Mode</label>
                <div style={{display:'flex',gap:4}}>
                  {[['manual','Manual'],['hourly','Hourly'],['daily','Daily'],['realtime','Real-time']].map(([v,l])=>
                    <button key={v} disabled={v!=='manual'} title={v!=='manual'?'Controlled migration uses manual, reconciled batches':''} className={`btn btn-sm ${qbConfig.autoSync===v?'btn-primary':'btn-secondary'}`}
                      onClick={()=>setQBConfig(prev=>({...prev,autoSync:v}))}>{l}</button>)}
                </div>
              </div>
              {!migrationUnlocked&&<div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,fontSize:11,color:'#92400e',marginBottom:10}}>
                <div>Initial-migration safety lock is active. Run the read-only live preflight, then use the one-record test on each data tab. Production batches remain locked; verified parsed supplier-bill canaries: <strong>{verifiedCanaryBills}/3 minimum</strong>.</div>
                <button className="btn btn-sm btn-secondary" style={{marginTop:8}} disabled={!livePreflightReady||verifiedCanaryBills<3}
                  title={!livePreflightReady?'Run a successful live preflight first':verifiedCanaryBills<3?'At least three live canaries must pass API read-back first':''}
                  onClick={()=>{if(window.confirm('I reviewed the verified canary bills in the correct QuickBooks company, checked the screenshots/transaction details and account impact, and approve 20-record production batches.'))setQBConfig(prev=>({...prev,initialMigrationApproved:true,autoSync:'manual'}))}}>
                  Approve Reviewed Canaries &amp; Unlock Batches
                </button>
              </div>}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-primary" style={{flex:1,background:'#0369a1'}} disabled={qbPreflighting||qbSyncing} onClick={runQBPreflight}>{qbPreflighting?'Reading live QBO...':'Read-Only Live Preflight'}</button>
                <button className="btn btn-primary" disabled title="Controlled migration: run and reconcile one entity at a time" onClick={syncAll}>{qbSyncing?'Syncing...':'Sync Everything'}</button>
                <button className="btn btn-secondary" disabled title="Locked pending durable-link reload/session verification" onClick={syncCustomers}>Customers</button>
                <button className="btn btn-secondary" disabled title="Locked pending customer links and Estimate rollout review" onClick={()=>syncSalesOrders()}>Sales Orders</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={()=>syncInvoices()}>Invoices</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncPaidFromQB}>Sync Paid</button>
                <button className="btn btn-secondary" disabled title="Locked pending native PO-to-existing-bill reconciliation" onClick={()=>syncPurchaseOrders()}>POs</button>
                <button className="btn btn-secondary" disabled title="Locked until the product-item canaries are approved">QBO Product Items Locked</button>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2>What Syncs</h2></div>
            <div className="card-body" style={{fontSize:12,color:'#475569'}}>
              <div style={{marginBottom:4}}>&#8226; <strong>Customers</strong> — name, contact, address, order totals in notes</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Sales Orders</strong> — line items + decoration as QB Estimates</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Invoices</strong> — invoice total to 40000; payments follow in a balance-based pass to avoid retry duplicates</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Purchase Orders</strong> — total quantity per SKU plus outside-decoration lines</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Bills</strong> — parsed portal vendor bills push to QBO only after account, item, total, and duplicate checks</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Bill direction</strong> — the initial migration does not auto-pull QBO bills back into portal POs</div>
              <div>&#8226; <strong>Product items</strong> — one QBO NonInventory purchase item per SKU using 40000 Sales and 51300 Purchases; portal inventory remains authoritative</div>
              <div>&#8226; <strong>Inventory quantities and adjustments</strong> — remain in the portal and are not posted to QBO</div>
            </div>
          </div>
        </div>

        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2>One-Record Tests for Non-Posting Documents</h2></div>
          <div className="card-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div style={{padding:12,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:4}}>Test exactly one sales order → QBO Estimate</div>
              <div style={{fontSize:10,color:'#475569',marginBottom:8}}>Non-posting. Requires an already-linked QBO customer and the existing NSA Portal Sales item; the test creates no QBO item.</div>
              <select className="form-input" aria-label="Sales order to test in QuickBooks" value={qbCanarySOId} onChange={e=>setQbCanarySOId(e.target.value)}>
                <option value="">Select one sales order...</option>
                {canarySOs.map(so=>{const c=cust.find(cc=>cc.id===so.customer_id);return<option key={so.id} value={so.id}>{so.id} — {c?.name||'Unknown'} — ${safeNum(buildQBSalesOrder(so).total).toFixed(2)}</option>})}
              </select>
              <button className="btn btn-primary btn-sm" style={{marginTop:8,background:'#0369a1'}} disabled={qbSyncing||!livePreflightReady||!selectedCanarySO||!!soCanaryBlock} onClick={runSalesOrderCanary}>{qbSyncing?'Testing...':'Test 1 Sales Order'}</button>
              {soCanaryBlock&&<div style={{fontSize:10,color:'#b91c1c',marginTop:6,fontWeight:600}}>{soCanaryBlock}</div>}
            </div>
            <div style={{padding:12,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'#5b21b6',marginBottom:4}}>Test exactly one purchase order</div>
              <div style={{fontSize:10,color:'#475569',marginBottom:8}}>Non-posting. The canary will not create a vendor or QBO item as a side effect.</div>
              <select className="form-input" aria-label="Purchase order to test in QuickBooks" value={qbCanaryPOId} onChange={e=>setQbCanaryPOId(e.target.value)}>
                <option value="">Select one purchase order...</option>
                {canaryPOs.map(group=><option key={group.poId} value={group.poId}>{group.poId} — {group.vendor||'Unknown'}{group.invalidReason?' — BLOCKED':''}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" style={{marginTop:8,background:'#6d28d9'}} disabled={qbSyncing||!livePreflightReady||!selectedCanaryPO||!!poCanaryBlock} onClick={runPurchaseOrderCanary}>{qbSyncing?'Testing...':'Test 1 Purchase Order'}</button>
              {poCanaryBlock&&<div style={{fontSize:10,color:'#b91c1c',marginTop:6,fontWeight:600}}>{poCanaryBlock}</div>}
            </div>
          </div>
          {!livePreflightReady&&<div style={{padding:'0 16px 12px',fontSize:11,color:'#92400e',fontWeight:600}}>Buttons disabled: run Read-Only Live Preflight first.</div>}
        </div>

        <div className="card">
          <div className="card-header"><h2>🗂️ Account Mapping</h2></div>
          <div className="card-body">
            <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Account numbers are matched to QBO AcctNum and validated before every posting transaction.</div>
            {QB_MAPPING_FIELDS.map(([key,label])=>{const live=qbConfig.preflight?.accounts?.[key];return(
              <div key={key} style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:600,color:'#475569',width:140}}>{label}</span>
                <input className="form-input" style={{width:90,fontSize:11,padding:'3px 6px'}} value={qbConfig.mapping[key]||QB_ACCOUNT_MAPPING_DEFAULTS[key]}
                  onChange={e=>setQBConfig(prev=>({...prev,mapping:{...prev.mapping,[key]:e.target.value},preflight:null,initialMigrationApproved:false,autoSync:'manual'}))}/>
                <span style={{flex:1,fontSize:10,color:live?'#166534':'#64748b'}}>{live?'✓ QBO '+live.number+' · '+live.name+' · ID '+live.id:'Not yet validated against live QBO'}</span>
              </div>)})}
          </div>
        </div>

        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2>Approved Posting Matrix</h2></div>
          <div className="card-body" style={{padding:0,overflowX:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr><th>Synced item type</th><th>Portal mapping</th><th>Posting</th><th>Other side / note</th></tr></thead>
              <tbody>{QB_ACCOUNT_POSTING_MATRIX.map(row=><tr key={row.itemType}>
                <td style={{fontWeight:600}}>{row.itemType}</td><td>{row.account}</td><td>{row.posting}</td><td style={{color:'#64748b'}}>{row.control}</td>
              </tr>)}</tbody>
            </table>
            <div style={{padding:'8px 12px',fontSize:10,color:'#92400e',background:'#fffbeb'}}>
              QBO Estimates and Purchase Orders are non-posting. 21100 A/P and 11000 A/R are control-account sides created by QBO, not bill or invoice line categories. Taxable-invoice tax codes and quarterly tax-payment automation remain deployment prerequisites and are not silently guessed.
            </div>
          </div>
        </div>

      {/* Preview — what would sync */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-header"><h2>📋 Sync Preview — What Will Go to QB</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {unsyncedSOs.length===0&&unsyncedPOGroups.length===0&&unsyncedInvs.length===0?
            <div className="empty" style={{padding:20}}>Everything is synced!</div>:
          <table style={{fontSize:11}}>
            <thead><tr style={{background:'#f8fafc'}}><th>Type</th><th>Doc #</th><th>Customer/Vendor</th><th>SO Ref</th><th>QB Account</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {unsyncedSOs.map(so=>{const qb=buildQBSalesOrder(so);
                return<tr key={so.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dbeafe',color:'#1e40af',fontWeight:600}}>Sales Order</span></td>
                  <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td>
                  <td>{qb.customerRef}</td><td>—</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping.income_account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${(Number(qb.total)||0).toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>})}
              {unsyncedPOGroups.map(group=>{
                const lines=group.entries.map(({pl,so,it})=>buildQBPurchaseOrder(pl,so,it));
                const total=lines.reduce((sum,line)=>sum+safeNum(line.total),0);
                const soRefs=[...new Set(group.entries.map(({so})=>so.id))];
                const isDeco=group.accountKey==='deco_account';
                return<tr key={group.poId} style={{borderBottom:'1px solid #f1f5f9',background:group.invalidReason?'#fef2f2':undefined}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:isDeco?'#ede9fe':'#fef3c7',
                    color:isDeco?'#7c3aed':'#92400e',fontWeight:600}}>{isDeco?'Decoration PO':'Blank Goods PO'}</span></td>
                  <td style={{fontWeight:700,color:isDeco?'#7c3aed':'#1e40af'}}>{group.poId}<div style={{fontSize:9,color:'#64748b',fontWeight:500}}>{group.entries.length} source line{group.entries.length===1?'':'s'}</div></td>
                  <td>{group.vendor||'—'}</td><td style={{fontSize:10,color:'#64748b'}}>{soRefs.join(', ')||'—'}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping[group.accountKey]}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>${total.toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:group.invalidReason?'#fee2e2':'#fef3c7',color:group.invalidReason?'#b91c1c':'#92400e',fontWeight:600}}>{group.invalidReason?'Blocked: '+group.invalidReason:'Pending'}</span></td>
                </tr>})}
              {unsyncedInvs.map(inv=>{const qb=buildQBInvoice(inv);
                return<tr key={inv.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>Invoice</span></td>
                  <td style={{fontWeight:700,color:'#166534'}}>{inv.id}</td>
                  <td>{qb.customerRef}</td><td style={{fontSize:10,color:'#64748b'}}>{qb.soRef}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping.income_account} / {qbConfig.mapping.ar_account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${(Number(qb.amount)||0).toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>})}
            </tbody>
          </table>}
        </div>
      </div>

      {/* Sync Log */}
      <div className="card">
        <div className="card-header"><h2>📜 Sync History</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:300,overflow:'auto'}}>
          {(qbConfig.syncLog||[]).length===0?<div className="empty" style={{padding:20}}>No sync history yet</div>:
          (qbConfig.syncLog||[]).map((log,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                background:log.status==='success'?'#dcfce7':log.status==='skipped'?'#f1f5f9':'#fef2f2',
                color:log.status==='success'?'#166534':log.status==='skipped'?'#64748b':'#dc2626'}}>{String(log.status||'')}</span>
              <span style={{fontSize:11,fontWeight:700}}>{log.type==='all'?'Full Sync':String(log.type||'').replace(/_/g,' ')}</span>
              <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{String(log.ts||'')}</span>
            </div>
            {(log.details||[]).map((d,di)=><div key={di} style={{fontSize:10,color:'#64748b',paddingLeft:8}}>• {typeof d==='string'?d:JSON.stringify(d)}</div>)}
          </div>)}
        </div>
      </div>
      </>}

      {/* ── CUSTOMERS TAB ── */}
      {qbTab==='customers'&&<>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>Customer Sync</h2>
            <button className="btn btn-primary btn-sm" disabled title="Locked pending durable-link reload/session verification" onClick={syncCustomers}>{qbSyncing?'Syncing...':'Customer Batches Locked'}</button>
          </div>
          <div style={{padding:'12px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:6}}>Test exactly one customer</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>An exact QBO match is linked without changing it when its terms already match. You must confirm before creating one customer or updating one customer&apos;s QBO Terms field. Bulk sync stays locked.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Customer to test in QuickBooks" style={{minWidth:320,maxWidth:520}} value={qbCanaryCustomerId} onChange={e=>setQbCanaryCustomerId(e.target.value)}>
                <option value="">Select one customer...</option>
                {activeCanaryCustomers.map(c=><option key={c.id} value={c.id}>{portalCustomerDisplayName(c)}{_custQBMap[c.id]?' — linked QB #'+_custQBMap[c.id]:''}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" style={{background:'#0369a1'}} disabled={qbSyncing||!qbCanaryCustomerId||!livePreflightReady}
                title={!livePreflightReady?'Run a successful read-only live preflight first':!qbCanaryCustomerId?'Select one customer first':''} onClick={runCustomerCanary}>
                {qbSyncing?'Testing...':'Test 1 Customer'}
              </button>
            </div>
            {!livePreflightReady&&<div style={{fontSize:11,color:'#92400e',marginTop:7,fontWeight:600}}>Button disabled: open Overview and run Read-Only Live Preflight, then return here.</div>}
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr style={{background:'#f8fafc'}}><th>Customer</th><th>Alpha</th><th>Orders</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Open Balance</th><th>QB Status</th></tr></thead>
              <tbody>
                {cust.filter(c=>c.is_active!==false).map(c=>{
                  const custInvs=invs.filter(i=>i.customer_id===c.id);
                  const rev=custInvs.reduce((a,i)=>a+(i.total??0),0);
                  const paid=custInvs.reduce((a,i)=>a+(i.paid??0),0);
                  const orders=sos.filter(s=>s.customer_id===c.id).length;
                  return<tr key={c.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{fontWeight:600}}>{c.name}</td>
                    <td><span className="badge badge-gray">{c.alpha_tag}</span></td>
                    <td>{orders}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>${rev.toFixed(0)}</td>
                    <td style={{textAlign:'right',color:rev-paid>0?'#dc2626':'#16a34a',fontWeight:600}}>${(rev-paid).toFixed(0)}</td>
                    <td>{_custQBMap[c.id]?<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>QB #{_custQBMap[c.id]}</span>:
                      <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Not synced</span>}</td>
                  </tr>})}
              </tbody>
            </table>
          </div>
        </div>
      </>}

      {/* ── INVOICES TAB ── */}
      {qbTab==='invoices'&&<>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>Invoice Sync ({unsyncedInvs.length} pending)</h2>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary btn-sm" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={syncPaidFromQB}>{qbSyncing?'Syncing...':'Sync Paid from QB'}</button>
              <button className="btn btn-secondary btn-sm" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={()=>syncInvoices()}>{qbSyncing?'Syncing...':'Push Invoices to QB'}</button>
            </div>
          </div>
          <div style={{padding:'12px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:4}}>Test exactly one invoice</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Creates one invoice only—never a payment—using the linked QBO customer&apos;s actual terms. Account, tax, duplicate, total, customer, and API read-back checks run before the portal link is saved.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Invoice to test in QuickBooks" style={{minWidth:420,maxWidth:700}} value={qbCanaryInvoiceId} onChange={e=>setQbCanaryInvoiceId(e.target.value)}>
                <option value="">Select one pending invoice...</option>
                {canaryInvoices.map(inv=>{const c=cust.find(cc=>cc.id===inv.customer_id);return<option key={inv.id} value={inv.id}>{inv.display_id||inv.id} — {c?.name||'Unknown'} — ${safeNum(inv.total).toFixed(2)}{safeNum(inv.tax)>0?' — TAX BLOCKED':''}{!_custQBMap[inv.customer_id]?' — CUSTOMER NOT SYNCED':''}</option>})}
              </select>
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
            <button className="btn btn-primary btn-sm" disabled title="Locked until the product-item canaries are approved">Product Batch Locked</button>
          </div>
          <div style={{padding:'8px 16px',background:'#fffbeb',fontSize:11,color:'#92400e',borderBottom:'1px solid #fef3c7'}}>
            The portal is the inventory source of truth. QBO will receive one NonInventory purchase item per SKU using 40000 Sales and 51300 Purchases. QBO will not receive quantity on hand or inventory value. Bulk migration remains locked until the canaries are approved.
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
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>Recovers an existing SKU link, verifies NonInventory type plus 40000/51300 routing, and saves only after API read-back. Missing matches are blocked for review.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Product SKU to test in QuickBooks" style={{minWidth:420,maxWidth:700}} value={qbCanaryProductId} onChange={e=>setQbCanaryProductId(e.target.value)}>
                <option value="">Select one active SKU...</option>
                {canaryProducts.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}{_prodQBMap[p.id]?' — linked QB #'+_prodQBMap[p.id]:''}</option>)}
              </select>
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
      </>}

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
