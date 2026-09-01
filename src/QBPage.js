// QuickBooks Online sync page — lifted verbatim out of App() (was `function rQB()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import { useState } from 'react';
import { useAppData } from './AppContext';
import { D_V } from './constants';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP } from './App';
import { createQBSyncEngine, groupPortalPurchaseOrders } from './qbSyncEngine';
import {
  QB_ACCOUNT_MAPPING_DEFAULTS,
  QB_ACCOUNT_POSTING_MATRIX,
  QB_ACCOUNT_SPECS,
  QB_STATE_TAX_ACCOUNT_KEYS,
  buildVendorBillLines,
  calculateCustomerShipping,
  loadAllQBEntities,
  loadQBAccounts,
  manualBillAccountKey,
  normalizeVendorName,
  resolveQBAccountRefs,
} from './qbAccountMappings';

const QB_MAPPING_FIELDS = [
  ['income_account', 'Customer sales + shipping'],
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
  const {connectQB,cust,decoVendors,disconnectQB,invAdjLog,invPOs,invs,nf,prod,qbApi,qbBillAmount,qbBillDate,qbBillFile,qbBillMemo,qbBillUploading,qbBillVendor,qbConfig,qbSyncing,qbTab,setInvPOs,setInvs,setQBConfig,setQbBillAmount,setQbBillDate,setQbBillFile,setQbBillMemo,setQbBillUploading,setQbBillVendor,setQbSyncing,setQbTab,setSOs,setSubmittedBatches,setVend,sos,submittedBatches,vend}=useAppData();
  const [qbBillFreight,setQbBillFreight]=useState('');
  const [qbBillSportsFee,setQbBillSportsFee]=useState('');
  const [qbCanaryMode,setQbCanaryMode]=useState(true);
  const [qbCanaryCustomerId,setQbCanaryCustomerId]=useState('');
  const [qbPreflighting,setQbPreflighting]=useState(false);


    // Sync engine — one copy of the logic (see qbSyncEngine.js); the App-level
    // auto-sync builds the same engine from fresh state, no page visit required.
    const {syncCustomerCanary,syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,syncSalesOrders,syncPurchaseOrders,syncAll}=createQBSyncEngine({cust,sos,invs,prod,vend,invPOs,submittedBatches,qbApi,qbConfig,nf,dP,setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend});

    // Read-only live-company inspection. This is the mandatory first step and
    // performs no QBO create/update calls.
    const runQBPreflight=async()=>{
      setQbPreflighting(true);
      const log={ts:new Date().toLocaleString(),type:'live_preflight',status:'success',details:[]};
      try{
        const [company,accounts]=await Promise.all([qbApi('company_info',{}),loadQBAccounts(qbApi)]);
        const refs=resolveQBAccountRefs(accounts,qbConfig.mapping,Object.keys(QB_ACCOUNT_SPECS));
        const ci=company?.CompanyInfo;
        log.details.push('READ ONLY — no QuickBooks records were created or changed');
        log.details.push('Company: '+(ci?.CompanyName||qbConfig.companyName||'Unknown')+' · Realm: '+(qbConfig.realm_id||'unknown'));
        Object.entries(refs).forEach(([key,ref])=>log.details.push(key+' → '+ref.accountNumber+' '+ref.name+' (QB #'+ref.value+')'));
        const entities=['Customer','Vendor','Item','Invoice','Bill','PurchaseOrder','Payment'];
        for(const entity of entities){
          try{
            const res=await qbApi('query',{query:'SELECT count(*) FROM '+entity});
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
      if(!migrationUnlocked){nf('For the initial test, use Supplier Bills → Test 1 in QuickBooks. Manual bills do not carry the parsed SKU/quantity checks.','error');return}
      if(qbConfig.preflight?.status!=='success'||String(qbConfig.preflight?.realm_id||'')!==String(qbConfig.realm_id||'')){nf('Run the read-only live QBO preflight before any test bill','error');return}
      if(!qbBillVendor){nf('Select a vendor','error');return}
      if(!qbBillAmount||parseFloat(qbBillAmount)<=0){nf('Enter bill amount','error');return}
      setQbBillUploading(true);
      const log={ts:new Date().toLocaleString(),type:'bill_upload',status:'success',details:[]};

      // Decoration-vendor category is authoritative: every vendor in that category
      // routes to 52000. Merchandise vendors route to 51300.
      const isDecoVendor=manualBillAccountKey(qbBillVendor)==='deco_account';
      const selectedVendorId=qbBillVendor.replace(/^(deco|vendor):/,'');
      const vendor=isDecoVendor
        ?(decoVendors||[]).find(v=>String(v.id)===selectedVendorId)
        :(vend.find(v=>String(v.id)===selectedVendorId)||D_V.find(v=>String(v.id)===selectedVendorId));
      if(!vendor){nf('Selected vendor is no longer available','error');setQbBillUploading(false);return}
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
        if(!vRes?.Vendor?.Id)vRes=await qbApi('upsert_vendor',{vendor:{
          DisplayName:vendor.name,CompanyName:vendor.name,
          ...(vendor.contact_email?{PrimaryEmailAddr:{Address:vendor.contact_email}}:{}),
        }});
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
      const amt=parseFloat(qbBillAmount);
      const freight=parseFloat(qbBillFreight)||0;
      const sportsFee=parseFloat(qbBillSportsFee)||0;
      if(freight<0||sportsFee<0||freight+sportsFee>=amt){
        nf('Freight and Sports Inc fee must be positive and less than the bill total','error');setQbBillUploading(false);return;
      }
      if(isDecoVendor&&sportsFee>0){nf('Sports Inc fee cannot be added to an outside-decoration bill','error');setQbBillUploading(false);return}
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
        APAccountRef:apAccountRef,
        TxnDate:qbBillDate,
        Line:billLines,
        ...(((qbCanaryMode||!migrationUnlocked)||qbBillMemo)?{PrivateNote:[(qbCanaryMode||!migrationUnlocked)?'NSA-QB-CANARY:'+new Date().toISOString():'',qbBillMemo].filter(Boolean).join(' | ')}:{}),
      };
      const billRes=await qbApi('upsert_bill',{bill:qbBill});
      if(!billRes?.Bill?.Id){
        log.details.push('Bill creation failed: '+(billRes?.Fault?.Error?.[0]?.Detail||'unknown'));
        log.status='error';
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Bill upload failed','error');
        setQbBillUploading(false);return;
      }
      const billId=billRes.Bill.Id;
      log.details.push(((qbCanaryMode||!migrationUnlocked)?'CANARY — ':'')+'Bill created: '+vendor.name+' $'+amt.toFixed(2)+' → QB Bill #'+billId);

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
      nf('Bill $'+amt.toFixed(2)+' uploaded to QB for '+vendor.name);
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
    const activeCanaryCustomers=cust.filter(c=>c.is_active!==false&&!c.deleted_at).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const runCustomerCanary=async()=>{
      if(!qbCanaryCustomerId)return;
      const result=await syncCustomerCanary(qbCanaryCustomerId);
      if(result?.status!=='needs_confirmation')return;
      const approved=window.confirm('No exact active QBO customer matches "'+result.customerName+'".\n\nCreate exactly ONE new QBO customer and verify it by API read-back?');
      if(!approved){nf('Customer test cancelled — no QBO customer was created');return}
      await syncCustomerCanary(qbCanaryCustomerId,{allowCreate:true});
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
        {[['overview','Overview'],['customers','Customers'],['invoices','Invoices'],['bills','Bill Upload'],['inventory','QBO Items'],['settings','Settings'],['log','Sync Log']].map(([k,l])=>
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
                    <button key={v} disabled={!migrationUnlocked&&v!=='manual'} title={!migrationUnlocked&&v!=='manual'?'Enabled only after canary approval':''} className={`btn btn-sm ${qbConfig.autoSync===v?'btn-primary':'btn-secondary'}`}
                      onClick={()=>setQBConfig(prev=>({...prev,autoSync:v}))}>{l}</button>)}
                </div>
              </div>
              {!migrationUnlocked&&<div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,fontSize:11,color:'#92400e',marginBottom:10}}>
                <div>Initial-migration safety lock is active. Run the read-only live preflight, then use the Supplier Bills “Test 1” button. Verified bill canaries: <strong>{verifiedCanaryBills}/3 minimum</strong>.</div>
                <button className="btn btn-sm btn-secondary" style={{marginTop:8}} disabled={!livePreflightReady||verifiedCanaryBills<3}
                  title={!livePreflightReady?'Run a successful live preflight first':verifiedCanaryBills<3?'At least three live canaries must pass API read-back first':''}
                  onClick={()=>{if(window.confirm('I reviewed the verified canary bills in the correct QuickBooks company, checked the screenshots/transaction details and account impact, and approve 20-record production batches.'))setQBConfig(prev=>({...prev,initialMigrationApproved:true,autoSync:'manual'}))}}>
                  Approve Reviewed Canaries &amp; Unlock Batches
                </button>
              </div>}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-primary" style={{flex:1,background:'#0369a1'}} disabled={qbPreflighting||qbSyncing} onClick={runQBPreflight}>{qbPreflighting?'Reading live QBO...':'Read-Only Live Preflight'}</button>
                <button className="btn btn-primary" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={syncAll}>{qbSyncing?'Syncing...':'Sync Everything'}</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncCustomers}>Customers</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncSalesOrders}>Sales Orders</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncInvoices}>Invoices</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncPaidFromQB}>Sync Paid</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncPurchaseOrders}>POs</button>
                <button className="btn btn-secondary" disabled={qbSyncing||!migrationUnlocked} onClick={syncInventory}>QBO Items</button>
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
              <div>&#8226; <strong>Products</strong> — one QBO NonInventory item per SKU; size/color inventory remains in the portal</div>
            </div>
          </div>
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
            <button className="btn btn-primary btn-sm" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={syncCustomers}>{qbSyncing?'Syncing...':'Sync All Customers'}</button>
          </div>
          <div style={{padding:'12px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#1e3a8a',marginBottom:6}}>Test exactly one customer</div>
            <div style={{fontSize:11,color:'#475569',marginBottom:8}}>An existing exact QBO match is linked without changing it. If no exact match exists, you must confirm before one new QBO customer is created. Bulk sync stays locked.</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <select className="form-input" aria-label="Customer to test in QuickBooks" style={{minWidth:320,maxWidth:520}} value={qbCanaryCustomerId} onChange={e=>setQbCanaryCustomerId(e.target.value)}>
                <option value="">Select one customer...</option>
                {activeCanaryCustomers.map(c=><option key={c.id} value={c.id}>{c.name}{c.alpha_tag?' ('+c.alpha_tag+')':''}{_custQBMap[c.id]?' — linked QB #'+_custQBMap[c.id]:''}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" style={{background:'#0369a1'}} disabled={qbSyncing||!qbCanaryCustomerId||!livePreflightReady}
                title={!livePreflightReady?'Run a successful read-only live preflight first':!qbCanaryCustomerId?'Select one customer first':''} onClick={runCustomerCanary}>
                {qbSyncing?'Testing...':'Test 1 Customer'}
              </button>
            </div>
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
              <button className="btn btn-secondary btn-sm" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={syncInvoices}>{qbSyncing?'Syncing...':'Push Invoices to QB'}</button>
            </div>
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
              <button className="btn btn-primary" style={{width:'100%'}} disabled={qbBillUploading||!migrationUnlocked} onClick={uploadBill}
                title={!migrationUnlocked?'Use Supplier Bills → Test 1 so SKU quantities and bill totals are validated':''}>
                {qbBillUploading?'Uploading to QuickBooks...':!migrationUnlocked?'Use Parsed Supplier-Bill Canary':'Upload Bill to QuickBooks'}
              </button>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2>Recent Bill Uploads</h2></div>
            <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
              {(qbConfig.syncLog||[]).filter(l=>l.type==='bill_upload').length===0?
                <div className="empty" style={{padding:20}}>No bills uploaded yet</div>:
              (qbConfig.syncLog||[]).filter(l=>l.type==='bill_upload').map((log,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
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
            <button className="btn btn-primary btn-sm" disabled={qbSyncing||!migrationUnlocked} title={!migrationUnlocked?'Locked until canary approval':''} onClick={syncInventory}>{qbSyncing?'Syncing...':'Sync NonInventory Items'}</button>
          </div>
          <div style={{padding:'8px 16px',background:'#fffbeb',fontSize:11,color:'#92400e',borderBottom:'1px solid #fef3c7'}}>
            Creates one NonInventory item per SKU using 40000 Sales and 51300 Purchases. QBO does not receive size/color on-hand quantities or inventory valuation; those remain in the portal.
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr style={{background:'#f8fafc'}}><th>SKU</th><th>Product</th><th>Brand</th><th style={{textAlign:'right'}}>Portal Qty (not sent)</th><th style={{textAlign:'right'}}>Portal Value (not sent)</th><th>QB Status</th></tr></thead>
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
          <div>&#8226; <strong>Products</strong> &#8594; One QBO NonInventory Item per SKU; inventory quantities and valuation stay in Portal</div>
        </div>
      </div>}
    </>);
  }
