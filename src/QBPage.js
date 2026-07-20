// QuickBooks Online sync page — lifted verbatim out of App() (was `function rQB()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import { useAppData } from './AppContext';
import { D_V } from './constants';
import { _dbSaveSO } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP } from './App';

export default function QBPage(){
  const {connectQB,cust,disconnectQB,invAdjLog,invPOs,invs,nf,prod,qbApi,qbBillAmount,qbBillDate,qbBillFile,qbBillMemo,qbBillUploading,qbBillVendor,qbConfig,qbSyncAllRef,qbSyncing,qbTab,setInvPOs,setInvs,setQBConfig,setQbBillAmount,setQbBillDate,setQbBillFile,setQbBillMemo,setQbBillUploading,setQbBillVendor,setQbSyncing,setQbTab,setSOs,setSubmittedBatches,setVend,sos,submittedBatches,vend}=useAppData();


    // ── SYNC: Customers (name + totals) ──
    const syncCustomers=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'customers',status:'success',details:[]};
      let synced=0;
      const custQBMap={};// localId -> qbCustomerId (returned for downstream syncs)
      // Fetch existing QB customers to match by name and avoid duplicates
      let existingQBCusts=[];
      try{
        const qRes=await qbApi('query',{query:"SELECT Id, DisplayName, CompanyName, SyncToken FROM Customer MAXRESULTS 1000"});
        existingQBCusts=qRes?.QueryResponse?.Customer||[];
      }catch(e){console.warn('[QB] Customer query failed:',e)}
      for(const c of cust.filter(c=>c.is_active!==false&&!c.deleted_at)){
        // Calculate totals
        const custSOs=sos.filter(s=>s.customer_id===c.id);
        const totalRevenue=invs.filter(i=>i.customer_id===c.id).reduce((a,i)=>a+(i.total??0),0);
        const totalPaid=invs.filter(i=>i.customer_id===c.id).reduce((a,i)=>a+(i.paid??0),0);
        const openBalance=totalRevenue-totalPaid;
        const displayName=c.name+(c.alpha_tag?' ('+c.alpha_tag+')':'');
        // Match existing QB customer by name if we don't already have a QB ID
        let qbId=c.qb_customer_id||(qbConfig.custQBMap||{})[c.id];let syncToken=null;
        if(!qbId){
          const match=existingQBCusts.find(q=>q.DisplayName===displayName||q.CompanyName===c.name||q.DisplayName===c.name);
          if(match){qbId=match.Id;syncToken=match.SyncToken}
        }else{
          const match=existingQBCusts.find(q=>q.Id===qbId);
          if(match)syncToken=match.SyncToken;
        }
        const qbCustomer={
          DisplayName:displayName,
          CompanyName:c.name,
          // QB rejects malformed emails (code 2210) and any sync attempt with a
          // bad value blocks the whole batch. Trim and regex-validate before
          // sending — omit the field entirely if the value isn't a real email.
          ...((()=>{const raw=String(c.contact_email||c.contacts?.[0]?.email||'').trim();return raw&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)?{PrimaryEmailAddr:{Address:raw}}:{}})()),
          ...((()=>{const raw=String(c.contact_phone||c.contacts?.[0]?.phone||'').trim();return raw?{PrimaryPhone:{FreeFormNumber:raw}}:{}})()),
          ...(c.billing_address_line1?{BillAddr:{Line1:c.billing_address_line1,City:c.billing_city||'',CountrySubDivisionCode:c.billing_state||'',PostalCode:c.billing_zip||''}}:{}),
          ...(c.shipping_address_line1?{ShipAddr:{Line1:c.shipping_address_line1,City:c.shipping_city||'',CountrySubDivisionCode:c.shipping_state||'',PostalCode:c.shipping_zip||''}}:{}),
          Notes:'Portal: '+custSOs.length+' orders, $'+totalRevenue.toFixed(0)+' revenue, $'+openBalance.toFixed(0)+' open balance. Tier: '+(c.adidas_ua_tier||'B')+'. Terms: '+(c.payment_terms||'net30'),
          ...(qbId?{Id:qbId,sparse:true}:{}),
          ...(syncToken?{SyncToken:syncToken}:{}),
        };
        let res;
        try{res=await qbApi('upsert_customer',{customer:qbCustomer})}catch(e){log.details.push(c.name+' — FAILED: '+e.message);log.status='partial';continue}
        if(res?.Customer?.Id){
          custQBMap[c.id]=res.Customer.Id;
          log.details.push(c.name+' → QB #'+res.Customer.Id);synced++;
        }else{
          if(qbId)custQBMap[c.id]=qbId;
          const errDetail=res?.Fault?.Error?.[0]?.Detail||res?.Fault?.Error?.[0]?.Message||res?.error||res?.message||(res?JSON.stringify(res).slice(0,120):'empty response');log.details.push(c.name+' — FAILED: '+errDetail);log.status='partial';
        }
      }
      // Include customers that already had QB IDs from previous syncs
      cust.forEach(c=>{const prev=(qbConfig.custQBMap||{})[c.id];if(prev&&!custQBMap[c.id])custQBMap[c.id]=prev});
      if(synced===0&&log.details.length>0)log.status='error';
      log.details.unshift(synced+'/'+cust.filter(c=>c.is_active!==false).length+' customers synced');
      setQBConfig(prev=>({...prev,custQBMap:{...prev.custQBMap,...custQBMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' customers synced to QB');
      setQbSyncing(false);
      return custQBMap;
    };

    // ── SYNC: Invoices (totals) ──
    const syncInvoices=async(custQBMap={},prodQBMap={})=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'invoices',status:'success',details:[]};
      let synced=0;
      const unsyncedInvs2=invs.filter(i=>!i.qb_invoice_id);
      for(const inv of unsyncedInvs2){
        const c=cust.find(cc=>cc.id===inv.customer_id);
        const cQBId=custQBMap[inv.customer_id]||(qbConfig.custQBMap||{})[inv.customer_id];
        if(!cQBId){log.details.push((inv.display_id||inv.id)+' — skipped: customer "'+c?.name+'" not synced to QB');continue}
        const so=sos.find(s=>s.id===inv.sales_order_id);
        const invPaid=(inv.payments||[]).reduce((a,p)=>a+safeNum(p.amount),0);
        const qbInvoice={
          DocNumber:inv.display_id||inv.id,
          TxnDate:inv.invoice_date||new Date().toISOString().slice(0,10),
          CustomerRef:{value:cQBId},
          Line:[{DetailType:'SalesItemLineDetail',Amount:inv.total??0,Description:'Invoice '+(inv.display_id||inv.id)+(so?' for '+so.id:'')+(so?.memo?' — '+so.memo:''),
            SalesItemLineDetail:{Qty:1,UnitPrice:inv.total??0}}],
          ...(inv.qb_invoice_id?{Id:inv.qb_invoice_id,sparse:true}:{}),
        };
        let res=await qbApi('upsert_invoice',{invoice:qbInvoice});
        // Handle duplicate DocNumber — look up existing QB invoice and retry as update
        if(!res?.Invoice?.Id&&(res?.Fault?.Error?.[0]?.code==='6140'||/duplicate/i.test(res?.Fault?.Error?.[0]?.Detail||''))){
          const docNum=inv.display_id||inv.id;
          const lookup=await qbApi('query',{query:"SELECT Id, SyncToken FROM Invoice WHERE DocNumber = '"+docNum+"'"});
          const existing=lookup?.QueryResponse?.Invoice?.[0];
          if(existing){
            res=await qbApi('upsert_invoice',{invoice:{...qbInvoice,Id:existing.Id,SyncToken:existing.SyncToken,sparse:true}});
            if(res?.Invoice?.Id)log.details.push(docNum+' — recovered from duplicate (linked to QB #'+res.Invoice.Id+')');
          }
        }
        if(res?.Invoice?.Id){
          setInvs(prev=>prev.map(ii=>ii.id===inv.id?{...ii,qb_invoice_id:res.Invoice.Id}:ii));
          log.details.push((inv.display_id||inv.id)+' → QB Invoice #'+res.Invoice.Id+' ($'+safeNum(inv.total).toFixed(2)+')');synced++;
          // Sync payments if any
          if(invPaid>0&&inv.payments?.length){
            for(const pmt of inv.payments){
              const qbPmt={CustomerRef:{value:cQBId},TotalAmt:pmt.amount,
                Line:[{Amount:pmt.amount,LinkedTxn:[{TxnId:res.Invoice.Id,TxnType:'Invoice'}]}]};
              await qbApi('upsert_payment',{payment:qbPmt});
            }
          }
        }else{log.details.push((inv.display_id||inv.id)+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&unsyncedInvs2.length>0)log.status='error';
      log.details.unshift(synced+'/'+unsyncedInvs2.length+' invoices synced');
      setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' invoices synced to QB');
      setQbSyncing(false);
    };

    // ── SYNC: Bidirectional paid status sync between QB and portal ──
    const syncPaidFromQB=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'paid_sync',status:'success',details:[]};
      let updated=0;
      // Include all QB-linked invoices (not just unpaid) so portal-paid invoices can push to QB
      const linkedInvs=invs.filter(i=>i.qb_invoice_id);
      if(linkedInvs.length===0){log.details.push('No QB-linked invoices to check');setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('No invoices to sync');setQbSyncing(false);return}
      try{
        // Query QB for all invoices and their balance
        const qbIds=linkedInvs.map(i=>i.qb_invoice_id);
        const res=await qbApi('query',{query:"SELECT Id, DocNumber, Balance, TotalAmt, SyncToken FROM Invoice WHERE Id IN ('"+qbIds.join("','")+"')"});
        const qbInvList=res?.QueryResponse?.Invoice||[];
        const qbMap={};qbInvList.forEach(qi=>{qbMap[qi.Id]=qi});
        for(const inv of linkedInvs){
          const qbInv=qbMap[inv.qb_invoice_id];
          if(!qbInv){log.details.push((inv.display_id||inv.id)+' — not found in QB');continue}
          const qbBalance=safeNum(qbInv.Balance);
          const qbTotal=safeNum(qbInv.TotalAmt);
          // Totals drift: invoices only pushed once (!qb_invoice_id filter), so a portal
          // edit after the first sync left QB stale forever. Portal is the source of truth
          // for the TOTAL — push the corrected amount, then reconcile paid on the NEXT run
          // (this run's Balance was computed against the old total).
          const portalTotal=safeNum(inv.total);
          if(portalTotal>0&&Math.abs(portalTotal-qbTotal)>0.005){
            const upd=await qbApi('upsert_invoice',{invoice:{Id:inv.qb_invoice_id,SyncToken:qbInv.SyncToken,sparse:true,
              Line:[{DetailType:'SalesItemLineDetail',Amount:portalTotal,Description:'Invoice '+(inv.display_id||inv.id),SalesItemLineDetail:{Qty:1,UnitPrice:portalTotal}}]}});
            if(upd?.Invoice?.Id){log.details.push((inv.display_id||inv.id)+' — QB total corrected $'+qbTotal.toFixed(2)+' → $'+portalTotal.toFixed(2)+' (paid re-checks next run)');updated++}
            else{log.details.push((inv.display_id||inv.id)+' — total correction FAILED: '+(upd?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
            continue;
          }
          const qbPaid=qbTotal-qbBalance;
          const portalPaid=safeNum(inv.paid);
          if(qbPaid>portalPaid){
            // QB has more paid — pull to portal
            const newStatus=qbBalance<=0?'paid':qbPaid>0?'partial':'open';
            const pmt={amount:Math.round((qbPaid-portalPaid)*100)/100,method:'qb_sync',ref:'QB Payment Sync',date:new Date().toLocaleDateString()};
            setInvs(prev=>prev.map(ii=>ii.id===inv.id?{...ii,paid:Math.round(qbPaid*100)/100,status:newStatus,payments:[...(ii.payments||[]),pmt]}:ii));
            log.details.push((inv.display_id||inv.id)+' — marked '+newStatus+' (QB paid $'+qbPaid.toFixed(2)+')');updated++;
          }else if(portalPaid>qbPaid&&qbBalance>0){
            // Portal has more paid — push payment to QB
            const diff=Math.round((portalPaid-qbPaid)*100)/100;
            const cQBId=inv.qb_customer_id||(qbConfig.custQBMap||{})[inv.customer_id];
            if(cQBId){
              try{
                const qbPmt={CustomerRef:{value:cQBId},TotalAmt:diff,
                  Line:[{Amount:diff,LinkedTxn:[{TxnId:inv.qb_invoice_id,TxnType:'Invoice'}]}]};
                await qbApi('upsert_payment',{payment:qbPmt});
                log.details.push((inv.display_id||inv.id)+' — pushed $'+diff.toFixed(2)+' payment to QB');updated++;
              }catch(pe){log.details.push((inv.display_id||inv.id)+' — failed to push payment to QB: '+pe.message);log.status='partial'}
            }else{
              log.details.push((inv.display_id||inv.id)+' — skipped push: customer not synced to QB');
            }
          }else{
            log.details.push((inv.display_id||inv.id)+' — already up to date');
          }
        }
      }catch(e){log.status='error';log.details.push('QB query failed: '+e.message)}
      log.details.unshift(updated+'/'+linkedInvs.length+' invoices synced');
      setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(updated+' invoices synced with QB');
      setQbSyncing(false);
    };

    // ── SYNC: Pull bills FROM QB back to portal (bill costs → PO costs) ──
    const syncBillsFromQB=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'bill_pull',status:'success',details:[]};
      let updated=0;
      const syncedBillIds=new Set(qbConfig._syncedBillIds||[]);
      const newSyncedBillIds=[...syncedBillIds];
      try{
        // Query all bills from QB
        const res=await qbApi('query',{query:"SELECT * FROM Bill MAXRESULTS 500"});
        const qbBills=res?.QueryResponse?.Bill||[];
        if(!qbBills.length){log.details.push('No bills found in QB');setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('No bills in QB');setQbSyncing(false);return}
        // Build reverse map: QB PO Id → portal PO id
        const poMap=qbConfig.qbPOMap||{};
        const reversePoMap={};// qbPOId → portalPOId
        Object.entries(poMap).forEach(([portalId,qbId])=>{reversePoMap[qbId]=portalId});
        // Collect all portal PO numbers for matching by DocNumber
        const allPortalPOIds=new Set();
        sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{if(pl.po_id)allPortalPOIds.add(pl.po_id)})})});
        submittedBatches.forEach(b=>{if(b.po_number)allPortalPOIds.add(b.po_number)});
        invPOs.forEach(p=>{if(p.po_number)allPortalPOIds.add(p.po_number)});
        for(const qbBill of qbBills){
          if(syncedBillIds.has(qbBill.Id))continue;
          const billTotal=safeNum(qbBill.TotalAmt);
          const billDate=qbBill.TxnDate||'';
          const billDocNum=qbBill.DocNumber||'';
          const billMemo=qbBill.PrivateNote||'';
          const vendorName=qbBill.VendorRef?.name||'';
          // Try to match to portal PO via LinkedTxn (PurchaseOrder reference)
          let matchedPortalPOId=null;
          const linkedTxns=qbBill.LinkedTxn||[];
          for(const lt of linkedTxns){
            if(lt.TxnType==='PurchaseOrder'&&reversePoMap[lt.TxnId]){
              matchedPortalPOId=reversePoMap[lt.TxnId];break;
            }
          }
          // Fallback: match by DocNumber against portal PO IDs
          if(!matchedPortalPOId&&billDocNum){
            const docLc=billDocNum.toLowerCase().replace(/\s+/g,'');
            for(const pid of allPortalPOIds){
              if(pid.toLowerCase().replace(/\s+/g,'')===docLc){matchedPortalPOId=pid;break}
            }
          }
          // Fallback: check memo for PO reference
          if(!matchedPortalPOId&&billMemo){
            const poMatch=billMemo.match(/PO[:\s]*([A-Z0-9-]+)/i);
            if(poMatch){
              const poRef=poMatch[1].toLowerCase().replace(/\s+/g,'');
              for(const pid of allPortalPOIds){
                if(pid.toLowerCase().replace(/\s+/g,'')===poRef){matchedPortalPOId=pid;break}
              }
            }
          }
          if(!matchedPortalPOId){continue}
          // Determine which PO source this matches and apply the bill cost
          const billInfo={qb_bill_id:qbBill.Id,doc_number:billDocNum,vendor:vendorName,total:billTotal,date:billDate};
          // Check SO item PO lines. The match decision happens SYNCHRONOUSLY on the current
          // array — the old version set a flag inside the setSOs updater and read it on the
          // next line, but React 18 runs updaters at batch flush, AFTER that read. Result:
          // the cost applied yet the bill was never recorded as synced, so EVERY sync run
          // re-applied it — compounding _bill_cost on the PO. Decide first, then write once.
          let appliedToSO=false;
          const soHit=sos.find(s=>(s.items||[]).some(it=>(it.po_lines||[]).some(po=>po.po_id===matchedPortalPOId)));
          if(soHit){
            setSOs(prev=>prev.map(s=>{
              if(s.id!==soHit.id)return s;
              const updatedItems=(s.items||[]).map(it=>{
                if(!(it.po_lines||[]).some(po=>po.po_id===matchedPortalPOId))return it;
                return{...it,po_lines:it.po_lines.map(po=>{
                  if(po.po_id!==matchedPortalPOId)return po;
                  const prevCost=safeNum(po._bill_cost||0);
                  return{...po,_bill_cost:Math.round((prevCost+billTotal)*100)/100,
                    _bill_details:[...(po._bill_details||[]),billInfo]};
                })};
              });
              const updatedSO={...s,items:updatedItems,updated_at:new Date().toLocaleString()};
              _dbSaveSO(updatedSO);
              return updatedSO;
            }));
            appliedToSO=true;
          }
          // Check batch POs
          if(!appliedToSO){
            const batchMatch=submittedBatches.find(b=>(b.po_number||b.id)===matchedPortalPOId);
            if(batchMatch){
              setSubmittedBatches(prev=>prev.map(sb=>{
                if((sb.po_number||sb.id)!==matchedPortalPOId)return sb;
                return{...sb,_bill_cost:Math.round((safeNum(sb._bill_cost||0)+billTotal)*100)/100,
                  _bill_details:[...(sb._bill_details||[]),billInfo]};
              }));
              appliedToSO=true;
            }
          }
          // Check inventory POs
          if(!appliedToSO){
            const invMatch=invPOs.find(p=>p.po_number===matchedPortalPOId);
            if(invMatch){
              setInvPOs(prev=>prev.map(po=>{
                if(po.po_number!==matchedPortalPOId)return po;
                return{...po,_bill_cost:Math.round((safeNum(po._bill_cost||0)+billTotal)*100)/100,
                  _bill_details:[...(po._bill_details||[]),billInfo]};
              }));
              appliedToSO=true;
            }
          }
          if(appliedToSO){
            newSyncedBillIds.push(qbBill.Id);
            log.details.push('Bill #'+billDocNum+' ('+vendorName+' $'+billTotal.toFixed(2)+') → PO '+matchedPortalPOId);
            updated++;
          }
        }
      }catch(e){log.status='error';log.details.push('QB query failed: '+e.message)}
      log.details.unshift(updated+' bills pulled from QB');
      setQBConfig(prev=>({...prev,_syncedBillIds:newSyncedBillIds,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(updated+' bill costs pulled from QB');
      setQbSyncing(false);
    };

    // ── SYNC: Inventory (totals per product as non-inventory items) ──
    const syncInventory=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'inventory',status:'success',details:[]};
      let synced=0;
      // Look up QB account IDs by name (required by QB API)
      let incomeAcctRef=null,expenseAcctRef=null;let acctLookupError=null;
      try{
        const acctRes=await qbApi('query',{query:"SELECT Id, Name, AccountType, AccountSubType FROM Account WHERE AccountType IN ('Income','Cost of Goods Sold','Expense') MAXRESULTS 200"});
        const accts=acctRes?.QueryResponse?.Account||[];
        const incomeName=qbConfig.mapping.income_account||'Sales of Product Income';
        const expenseName=qbConfig.mapping.cogs_account||'Cost of Goods Sold';
        // For Inventory items, QB requires Income account with subtype SalesOfProductIncome
        const incomeAcct=accts.find(a=>a.Name===incomeName)||accts.find(a=>a.AccountSubType==='SalesOfProductIncome')||accts.find(a=>a.AccountType==='Income');
        const expenseAcct=accts.find(a=>a.Name===expenseName)||accts.find(a=>a.AccountSubType==='SuppliesMaterialsCogs')||accts.find(a=>a.AccountType==='Cost of Goods Sold')||accts.find(a=>a.AccountType==='Expense');
        if(incomeAcct)incomeAcctRef={value:incomeAcct.Id,name:incomeAcct.Name};
        if(expenseAcct)expenseAcctRef={value:expenseAcct.Id,name:expenseAcct.Name};
        if(!incomeAcct||!expenseAcct){
          const availNames=accts.map(a=>a.Name+' ('+a.AccountType+')').join(', ');
          acctLookupError='Found '+accts.length+' accounts but none matched. Looking for Income="'+incomeName+'" and Expense="'+expenseName+'". Available: '+(availNames||'none')+'. Update your QB Account Mapping in settings to match your Chart of Accounts.';
        }
      }catch(e){console.error('[QB] Account lookup failed:',e);acctLookupError='QB API error during account lookup: '+e.message}
      if(!incomeAcctRef||!expenseAcctRef){
        log.status='error';log.details.push(acctLookupError||'Could not find QB accounts for Income ("'+(qbConfig.mapping.income_account||'Sales')+'") or Expense ("'+(qbConfig.mapping.cogs_account||'Cost of Goods Sold')+'"). Check your QB Chart of Accounts.');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Inventory sync failed — QB accounts not found','error');setQbSyncing(false);return{};
      }
      // Look up asset account for Inventory type items
      let assetAcctRef=null;
      try{
        const aRes=await qbApi('query',{query:"SELECT Id, Name FROM Account WHERE AccountType='Other Current Asset' AND AccountSubType='Inventory' MAXRESULTS 10"});
        const aa=(aRes?.QueryResponse?.Account||[])[0];
        if(aa)assetAcctRef={value:aa.Id,name:aa.Name};
      }catch{}
      if(!assetAcctRef){// fallback: search by name
        try{
          const aRes2=await qbApi('query',{query:"SELECT Id, Name FROM Account WHERE Name='Inventory Asset' MAXRESULTS 1"});
          const aa2=(aRes2?.QueryResponse?.Account||[])[0];
          if(aa2)assetAcctRef={value:aa2.Id,name:aa2.Name};
        }catch{}
      }
      // Query existing QB items to match by name and avoid duplicates
      let existingQBItems=[];
      try{
        const iRes=await qbApi('query',{query:"SELECT Id, Name, Type, SyncToken, QtyOnHand FROM Item MAXRESULTS 1000"});
        existingQBItems=iRes?.QueryResponse?.Item||[];
      }catch(e){console.warn('[QB] Item query failed:',e)}
      const prodQBMap={...(qbConfig.prodQBMap||{})};
      const today=new Date().toISOString().slice(0,10);
      // Aggregate inventory totals per product (not per size — just totals)
      for(const p of prod.filter(p=>p.is_active!==false)){
        const inv=p._inv||{};
        const totalQty=Object.values(inv).reduce((a,v)=>a+safeNum(v),0);
        const existingQBId=prodQBMap[p.id];
        if(totalQty===0&&!existingQBId)continue; // skip products with no inventory and no QB record
        const totalValue=totalQty*safeNum(p.nsa_cost);
        // Sanitize the name QB will display — strip control chars QB chokes on,
        // collapse whitespace, trim, cap at 100. Same for description.
        const cleanName=String(p.name||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
        const itemName=(p.sku+' '+cleanName).slice(0,100).trim();
        const cleanColor=String(p.color||'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
        // Match existing QB item by name or stored ID
        let qbId=existingQBId;let syncToken=null;let existingType=null;
        if(qbId){
          const match=existingQBItems.find(i=>i.Id===qbId);
          if(match){syncToken=match.SyncToken;existingType=match.Type}
        }else{
          const match=existingQBItems.find(i=>i.Name===itemName);
          if(match){qbId=match.Id;syncToken=match.SyncToken;existingType=match.Type}
        }
        const isUpdate=!!qbId;
        // QB rejects (code 2010) updates that try to change immutable properties.
        // Type / TrackQtyOnHand / QtyOnHand / InvStartDate / AssetAccountRef are
        // write-once at create. For updates we send only mutable fields; quantity
        // changes go through the InventoryAdjustment call below.
        const useInventoryType=!!assetAcctRef;
        const qbItem={
          Name:itemName,
          Description:cleanName+(cleanColor?' - '+cleanColor:'')+' | Portal Qty: '+totalQty+' | Value: $'+totalValue.toFixed(2),
          UnitPrice:safeNum(p.retail_price||p.nsa_cost),
          PurchaseCost:safeNum(p.nsa_cost),
          IncomeAccountRef:incomeAcctRef,
          ExpenseAccountRef:expenseAcctRef,
          ...(isUpdate
            ?{Id:qbId,SyncToken:syncToken,sparse:true}
            :(useInventoryType
              ?{Type:'Inventory',TrackQtyOnHand:true,QtyOnHand:totalQty,InvStartDate:today,AssetAccountRef:assetAcctRef}
              :{Type:'NonInventory'})),
        };
        const res=await qbApi('upsert_item',{item:qbItem});
        if(res?.Item?.Id){
          prodQBMap[p.id]=res.Item.Id;
          log.details.push(p.sku+' '+p.name+' → QB Item #'+res.Item.Id+' (qty: '+totalQty+', val: $'+totalValue.toFixed(2)+')');synced++;
          // For existing items, also adjust qty via InventoryAdjustment if needed
          if(qbId&&useInventoryType){
            const currentQBQty=existingQBItems.find(i=>i.Id===(res.Item.Id||qbId))?.QtyOnHand||0;
            const qtyDiff=totalQty-currentQBQty;
            if(qtyDiff!==0){
              await qbApi('inventory_adjustment',{adjustment:{
                AdjDate:today,
                AdjustAccountRef:expenseAcctRef,
                Line:[{ItemRef:{value:String(res.Item.Id||qbId),name:itemName},
                  QtyDiff:qtyDiff,DetailType:'ItemAdjustmentLineDetail',
                  ItemAdjustmentLineDetail:{Qty:qtyDiff}}]
              }});
            }
          }
        }else{log.details.push(p.sku+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      log.details.unshift(synced+' product items synced');
      setQBConfig(prev=>({...prev,prodQBMap:{...prev.prodQBMap,...prodQBMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' inventory items synced to QB');
      setQbSyncing(false);
      return prodQBMap;
    };

    // ── BILL UPLOAD — upload vendor bill to QB ──
    const uploadBill=async()=>{
      if(!qbBillVendor){nf('Select a vendor','error');return}
      if(!qbBillAmount||parseFloat(qbBillAmount)<=0){nf('Enter bill amount','error');return}
      setQbBillUploading(true);
      const log={ts:new Date().toLocaleString(),type:'bill_upload',status:'success',details:[]};

      // Find or create vendor in QB
      const vendor=vend.find(v=>v.id===qbBillVendor)||D_V.find(v=>v.id===qbBillVendor)||{name:qbBillVendor};
      let qbVendorId=vendor.qb_vendor_id;
      if(!qbVendorId){
        // Try to create vendor
        const vRes=await qbApi('upsert_vendor',{vendor:{
          DisplayName:vendor.name,CompanyName:vendor.name,
          ...(vendor.contact_email?{PrimaryEmailAddr:{Address:vendor.contact_email}}:{}),
        }});
        if(vRes?.Vendor?.Id){
          qbVendorId=vRes.Vendor.Id;
          setVend(prev=>prev.map(v=>v.id===vendor.id?{...v,qb_vendor_id:qbVendorId}:v));
          log.details.push('Created vendor: '+vendor.name+' → QB #'+qbVendorId);
        }else{
          log.details.push('Vendor creation failed: '+(vRes?.Fault?.Error?.[0]?.Detail||'unknown'));
          log.status='error';
          setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
          setQbBillUploading(false);return;
        }
      }

      // Create bill in QB — look up account ID for AccountRef
      let billAcctRef={name:qbConfig.mapping.cogs_account||'Cost of Goods Sold'};
      try{
        const acctRes=await qbApi('query',{query:"SELECT Id, Name, AccountType FROM Account WHERE AccountType IN ('Cost of Goods Sold','Expense') MAXRESULTS 200"});
        const accts=acctRes?.QueryResponse?.Account||[];
        const acctName=qbConfig.mapping.cogs_account||'Cost of Goods Sold';
        const match=accts.find(a=>a.Name===acctName)||accts.find(a=>a.Name.toLowerCase()===acctName.toLowerCase())||accts[0];
        if(match)billAcctRef={value:match.Id,name:match.Name};
      }catch(e){console.warn('[QB] Account query failed:',e)}
      if(!billAcctRef.value){
        log.details.push('Could not resolve QB expense account — no matching account found');
        log.status='error';
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Could not resolve QB expense account — check QuickBooks connection and account mapping','error');
        setQbBillUploading(false);return;
      }
      const amt=parseFloat(qbBillAmount);
      const qbBill={
        VendorRef:{value:qbVendorId},
        TxnDate:qbBillDate,
        Line:[{DetailType:'AccountBasedExpenseLineDetail',Amount:amt,Description:qbBillMemo||'Vendor bill from '+vendor.name,
          AccountBasedExpenseLineDetail:{AccountRef:billAcctRef}}],
        ...(qbBillMemo?{PrivateNote:qbBillMemo}:{}),
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
      log.details.push('Bill created: '+vendor.name+' $'+amt.toFixed(2)+' → QB Bill #'+billId);

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
      setQbBillFile(null);setQbBillVendor('');setQbBillAmount('');setQbBillMemo('');
      setQbBillUploading(false);
    };

    // ── SYNC: Sales Orders (as QB Estimates) ──
    const syncSalesOrders=async(custQBMap={},prodQBMap={})=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'sales_orders',status:'success',details:[]};
      let synced=0;
      const soMap=qbConfig.qbSOMap||{};
      const toSync=sos.filter(so=>{
        const hasItems=safeItems(so).some(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
        return hasItems&&!soMap[so.id];
      });
      for(const so of toSync){
        const c=cust.find(x=>x.id===so.customer_id);
        const cQBId=custQBMap[so.customer_id]||(qbConfig.custQBMap||{})[so.customer_id];
        if(!cQBId){log.details.push(so.id+' — skipped: customer not synced to QB');continue}
        const saf=safeArt(so);
        const _aq={};safeItems(so).forEach(it2=>{const q2=Object.values(safeSizes(it2)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it2).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){_aq[d2.art_file_id]=(_aq[d2.art_file_id]||0)+q2}})});
        const lines=[];
        safeItems(so).forEach(it=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          if(!qty)return;
          const itemQBId=prodQBMap[it.product_id||(prod.find(pp=>pp.sku===it.sku)||{}).id];
          // Calculate deco costs to include in line total
          let decoTotal=0;const decoDescs=[];
          safeDecos(it).forEach(d=>{
            const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;
            const dp=dP(d,qty,saf,cq);
            if(dp.sell>0){decoTotal+=qty*dp.sell;decoDescs.push((d.position||d.deco_type||d.kind||'Art')+' @$'+dp.sell.toFixed(2))}
          });
          const lineAmt=qty*(it.unit_sell||0)+decoTotal;
          const desc=it.sku+' '+it.name+(it.color?' - '+it.color:'')+(decoDescs.length?' + '+decoDescs.join(', '):'');
          lines.push({DetailType:'SalesItemLineDetail',Amount:lineAmt,
            Description:desc,
            SalesItemLineDetail:{Qty:qty,UnitPrice:lineAmt/qty,...(itemQBId?{ItemRef:{value:String(itemQBId)}}:{})}});
        });
        if(!lines.length)continue;
        const qbEstimate={
          DocNumber:so.id,
          TxnDate:(so.created_at||'').slice(0,10)||new Date().toISOString().slice(0,10),
          CustomerRef:{value:cQBId},
          Line:lines,
          PrivateNote:'Portal SO: '+so.id+(so.memo?' — '+so.memo:''),
          ...(soMap[so.id]?{Id:soMap[so.id],sparse:true}:{}),
        };
        const res=await qbApi('upsert_estimate',{estimate:qbEstimate});
        if(res?.Estimate?.Id){
          soMap[so.id]=res.Estimate.Id;
          log.details.push(so.id+' → QB Estimate #'+res.Estimate.Id);synced++;
        }else{log.details.push(so.id+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&toSync.length>0)log.status='error';
      log.details.unshift(synced+'/'+toSync.length+' sales orders synced');
      setQBConfig(prev=>({...prev,qbSOMap:{...prev.qbSOMap,...soMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' sales orders synced to QB');
      setQbSyncing(false);
    };

    // ── SYNC: Purchase Orders ──
    const syncPurchaseOrders=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'purchase_orders',status:'success',details:[]};
      let synced=0;
      const poMap=qbConfig.qbPOMap||{};
      // Fetch existing QB vendors to match by name and avoid duplicates
      let existingQBVendors=[];
      try{
        const vRes=await qbApi('query',{query:"SELECT Id, DisplayName, CompanyName, SyncToken FROM Vendor MAXRESULTS 500"});
        existingQBVendors=vRes?.QueryResponse?.Vendor||[];
      }catch(e){console.warn('[QB] Vendor query failed:',e)}
      const vendorQBMap={};// vendorName -> qbVendorId (cache for this sync run)
      // Look up expense accounts for PO line items
      let acctMap={};
      try{
        const acctRes=await qbApi('query',{query:"SELECT Id, Name, AccountType FROM Account WHERE AccountType IN ('Cost of Goods Sold','Expense') MAXRESULTS 200"});
        (acctRes?.QueryResponse?.Account||[]).forEach(a=>{acctMap[a.Name]={value:a.Id,name:a.Name}});
      }catch(e){console.warn('[QB] Account query failed:',e)}
      // Group PO lines by po_id so we push one QB PO with all line items
      const poGroupMap={};
      sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{
        if(!poMap[pl.po_id]){
          if(!poGroupMap[pl.po_id])poGroupMap[pl.po_id]={poId:pl.po_id,entries:[],vendor:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand,created_at:pl.created_at,account:pl.po_type==='outside_deco'?qbConfig.mapping.deco_account:qbConfig.mapping.cogs_account};
          poGroupMap[pl.po_id].entries.push({pl,so,it});
        }
      })})});
      const poGroups=Object.values(poGroupMap);
      for(const group of poGroups){
        const vendorName=group.vendor;
        if(!vendorName){log.details.push(group.poId+' — skipped: no vendor name');log.status='partial';continue}
        // Find or create vendor in QB
        let v=vend.find(x=>x.name===vendorName)||D_V.find(x=>x.name===vendorName);
        let qbVendorId=vendorQBMap[vendorName]||v?.qb_vendor_id;
        if(!qbVendorId){
          // Check existing QB vendors by name
          const match=existingQBVendors.find(q=>q.DisplayName===vendorName||q.CompanyName===vendorName);
          if(match){qbVendorId=match.Id}
          else{
            const vRes=await qbApi('upsert_vendor',{vendor:{DisplayName:vendorName,CompanyName:vendorName}});
            if(vRes?.Vendor?.Id){qbVendorId=vRes.Vendor.Id}
            else{log.details.push(group.poId+' — vendor "'+vendorName+'" creation failed: '+(vRes?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial';continue}
          }
          vendorQBMap[vendorName]=qbVendorId;
          if(v)setVend(prev=>prev.map(vv=>vv.id===v.id?{...vv,qb_vendor_id:qbVendorId}:vv));
        }
        // Build Line array with one entry per SO item on this PO
        const qbLines=group.entries.map(({pl:p,so:s,it:i})=>{
          const qty=Object.entries(p).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
          const rate=p.po_type==='outside_deco'?safeNum(p.unit_cost):safeNum(i.nsa_cost);
          return{DetailType:'AccountBasedExpenseLineDetail',Amount:qty*rate,
            Description:i.sku+' '+i.name+' x'+qty+' @$'+rate.toFixed(2)+' (SO: '+s.id+')',
            AccountBasedExpenseLineDetail:{AccountRef:acctMap[group.account]||Object.values(acctMap)[0]||{name:group.account||'Expenses'}}};
        });
        const totalAmount=qbLines.reduce((a,l)=>a+l.Amount,0);
        const soRefs=[...new Set(group.entries.map(({so:s})=>s.id))].join(', ');
        const qbPO={
          DocNumber:group.poId,
          VendorRef:{value:qbVendorId},
          TxnDate:(group.created_at||'').slice(0,10)||new Date().toISOString().slice(0,10),
          Line:qbLines,
          PrivateNote:'Portal PO for SO: '+soRefs,
          ...(poMap[group.poId]?{Id:poMap[group.poId],sparse:true}:{}),
        };
        const res=await qbApi('upsert_purchase_order',{purchase_order:qbPO});
        if(res?.PurchaseOrder?.Id){
          poMap[group.poId]=res.PurchaseOrder.Id;
          log.details.push(group.poId+' → QB PO #'+res.PurchaseOrder.Id+' ('+vendorName+' $'+totalAmount.toFixed(2)+', '+qbLines.length+' items)');synced++;
        }else{log.details.push(group.poId+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&poGroups.length>0)log.status='error';
      log.details.unshift(synced+'/'+poGroups.length+' purchase orders synced');
      setQBConfig(prev=>({...prev,qbPOMap:{...prev.qbPOMap,...poMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' purchase orders synced to QB');
      setQbSyncing(false);
    };

    // ── SYNC ALL ──
    const syncAll=async()=>{
      setQbSyncing(true);
      const custQBMap=await syncCustomers();
      const prodQBMap=await syncInventory();
      await syncSalesOrders(custQBMap,prodQBMap);
      await syncInvoices(custQBMap,prodQBMap);
      await syncPaidFromQB();
      await syncBillsFromQB();
      await syncPurchaseOrders();
      setQbSyncing(false);
    };

    // Keep ref updated for background auto-sync
    qbSyncAllRef.current=syncAll;

    // Build counts for overview
    const soMap=qbConfig.qbSOMap||{};
    const poMap=qbConfig.qbPOMap||{};
    const unsyncedSOs=sos.filter(so=>{
      const hasItems=safeItems(so).some(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
      return hasItems&&!soMap[so.id];
    });
    const unsyncedPOs=[];
    sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{if(!poMap[pl.po_id])unsyncedPOs.push({...pl,soId:so.id,sku:it.sku,itemName:it.name,vendor:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand})})})});
    const unsyncedInvs=invs.filter(i=>!i.qb_invoice_id);
    const _custQBMap=qbConfig.custQBMap||{};
    const _prodQBMap=qbConfig.prodQBMap||{};
    const custWithQB=cust.filter(c=>_custQBMap[c.id]).length;
    const prodWithQB=prod.filter(p=>_prodQBMap[p.id]).length;
    const totalInvQty=prod.reduce((a,p)=>a+Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0),0);
    const totalInvValue=prod.reduce((a,p)=>{const qty=Object.values(p._inv||{}).reduce((a2,v)=>a2+safeNum(v),0);return a+qty*safeNum(p.nsa_cost)},0);
    const unsyncedInvPOs=invPOs.filter(p=>!p._qb_synced);

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
          if(sell>0)lines.push({type:'SalesItemLine',desc:'Decoration: '+(d.position||d.deco_type||d.kind||'Art'),qty,rate:sell,amount:qty*sell,account:qbConfig.mapping.income_account});
        });
      });
      return{docType:'SalesOrder',docNumber:so.id,customerRef:c?.name||'Unknown',date:so.created_at,memo:so.memo,lines,total:lines.reduce((a,l)=>a+l.amount,0)};
    };

    const buildQBPurchaseOrder=(pl,so,it)=>{
      const qty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
      const rate=pl.po_type==='outside_deco'?safeNum(pl.unit_cost):safeNum(it.nsa_cost);
      return{docType:'PurchaseOrder',docNumber:pl.po_id,vendorRef:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand,
        date:pl.created_at,soRef:so.id,lines:[{desc:it.sku+' '+it.name,qty,rate,amount:qty*rate}],
        account:pl.po_type==='outside_deco'?qbConfig.mapping.deco_account:qbConfig.mapping.cogs_account,
        total:qty*rate};
    };

    const buildQBInvoice=(inv)=>{
      const so=sos.find(s=>s.id===inv.so_id);
      return{docType:'Invoice',docNumber:inv.id,customerRef:cust.find(c=>c.id===inv.customer_id)?.name,
        date:inv.date,soRef:inv.so_id,amount:inv.total,paid:inv.paid,balance:inv.total-inv.paid,
        tax:inv.tax||0,taxAccount:qbConfig.mapping.tax_account,
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
                <div style={{fontSize:12,color:'#92400e'}}>Connect your QBO account to sync customers, invoices, bills, and inventory</div>}
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
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}><div className="stat-label">POs to Sync</div><div className="stat-value" style={{color:'#7c3aed'}}>{unsyncedPOs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Products in QB</div><div className="stat-value" style={{color:'#166534'}}>{prodWithQB}/{prod.length}</div></div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{marginBottom:16}}>
        {[['overview','Overview'],['customers','Customers'],['invoices','Invoices'],['bills','Bill Upload'],['inventory','Inventory'],['settings','Settings'],['log','Sync Log']].map(([k,l])=>
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
                    <button key={v} className={`btn btn-sm ${qbConfig.autoSync===v?'btn-primary':'btn-secondary'}`}
                      onClick={()=>setQBConfig(prev=>({...prev,autoSync:v}))}>{l}</button>)}
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-primary" style={{flex:1}} disabled={qbSyncing} onClick={syncAll}>{qbSyncing?'Syncing...':'Sync Everything'}</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncCustomers}>Customers</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncSalesOrders}>Sales Orders</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncInvoices}>Invoices</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncPaidFromQB}>Sync Paid</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncBillsFromQB}>Bills from QB</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncPurchaseOrders}>POs</button>
                <button className="btn btn-secondary" disabled={qbSyncing} onClick={syncInventory}>Inventory</button>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2>What Syncs</h2></div>
            <div className="card-body" style={{fontSize:12,color:'#475569'}}>
              <div style={{marginBottom:4}}>&#8226; <strong>Customers</strong> — name, contact, address, order totals in notes</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Sales Orders</strong> — line items + decoration as QB Estimates</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Invoices</strong> — invoice total as single line item, payments applied; paid status syncs bidirectionally (QB ↔ portal)</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Purchase Orders</strong> — blank goods + outside deco POs to vendors</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Bills</strong> — upload vendor bills (PDF/image) to QB; bill costs auto-pull from QB back to portal POs</div>
              <div style={{marginBottom:4}}>&#8226; <strong>Bill Costs (QB → Portal)</strong> — bills received in QB matched to POs push costs back to portal daily</div>
              <div>&#8226; <strong>Inventory</strong> — product totals (qty + cost value) as non-inventory items</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>🗂️ Account Mapping</h2></div>
          <div className="card-body">
            <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Map NSA line items to your QB Chart of Accounts</div>
            {[['income_account','Item Revenue','Sales'],['cogs_account','Blank Goods COGS','Cost of Goods Sold'],['deco_account','Outside Decoration','Subcontractor - Decoration'],['ar_account','Accounts Receivable','Accounts Receivable'],['ap_account','Accounts Payable','Accounts Payable'],['tax_account','Sales Tax Payable','Sales Tax Payable']].map(([key,label,def])=>
              <div key={key} style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:600,color:'#475569',width:140}}>{label}</span>
                <input className="form-input" style={{flex:1,fontSize:11,padding:'3px 6px'}} value={qbConfig.mapping[key]||def}
                  onChange={e=>setQBConfig(prev=>({...prev,mapping:{...prev.mapping,[key]:e.target.value}}))}/>
              </div>)}
          </div>
        </div>

      {/* Preview — what would sync */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-header"><h2>📋 Sync Preview — What Will Go to QB</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {unsyncedSOs.length===0&&unsyncedPOs.length===0&&unsyncedInvs.length===0?
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
              {sos.map(so=>safeItems(so).map(it=>(it.po_lines||[]).filter(pl=>!poMap[pl.po_id]).map((pl,pi)=>{
                const qb=buildQBPurchaseOrder(pl,so,it);
                return<tr key={so.id+pl.po_id+pi} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:pl.po_type==='outside_deco'?'#ede9fe':'#fef3c7',
                    color:pl.po_type==='outside_deco'?'#7c3aed':'#92400e',fontWeight:600}}>{pl.po_type==='outside_deco'?'Deco PO':'Blank PO'}</span></td>
                  <td style={{fontWeight:700,color:pl.po_id?.startsWith('DPO')?'#7c3aed':'#1e40af'}}>{pl.po_id}</td>
                  <td>{qb.vendorRef}</td><td style={{fontSize:10,color:'#64748b'}}>{so.id}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qb.account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>${(Number(qb.total)||0).toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>}))).flat(2)}
              {unsyncedInvs.map(inv=>{const qb=buildQBInvoice(inv);
                return<tr key={inv.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>Invoice</span></td>
                  <td style={{fontWeight:700,color:'#166534'}}>{inv.id}</td>
                  <td>{qb.customerRef}</td><td style={{fontSize:10,color:'#64748b'}}>{qb.soRef}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping.ar_account}</td>
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
            <button className="btn btn-primary btn-sm" disabled={qbSyncing} onClick={syncCustomers}>{qbSyncing?'Syncing...':'Sync All Customers'}</button>
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
              <button className="btn btn-primary btn-sm" disabled={qbSyncing} onClick={syncPaidFromQB}>{qbSyncing?'Syncing...':'Sync Paid from QB'}</button>
              <button className="btn btn-secondary btn-sm" disabled={qbSyncing} onClick={syncInvoices}>{qbSyncing?'Syncing...':'Push Invoices to QB'}</button>
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
                  {vend.filter(v=>v.is_active!==false).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
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
              <button className="btn btn-primary" style={{width:'100%'}} disabled={qbBillUploading} onClick={uploadBill}>
                {qbBillUploading?'Uploading to QuickBooks...':'Upload Bill to QuickBooks'}
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
            <h2>Inventory Sync (Totals Only)</h2>
            <button className="btn btn-primary btn-sm" disabled={qbSyncing} onClick={syncInventory}>{qbSyncing?'Syncing...':'Sync Inventory'}</button>
          </div>
          <div style={{padding:'8px 16px',background:'#fffbeb',fontSize:11,color:'#92400e',borderBottom:'1px solid #fef3c7'}}>
            Syncs product totals (qty + cost value) as non-inventory items to QB. Real size-level inventory tracking stays on the portal.
          </div>
          <div className="card-body" style={{padding:0,maxHeight:500,overflow:'auto'}}>
            <table style={{fontSize:11}}>
              <thead><tr style={{background:'#f8fafc'}}><th>SKU</th><th>Product</th><th>Brand</th><th style={{textAlign:'right'}}>Total Qty</th><th style={{textAlign:'right'}}>Cost Value</th><th>QB Status</th></tr></thead>
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
              <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Map NSA data to your QB Chart of Accounts</div>
              {[['income_account','Income / Revenue','Sales'],['cogs_account','Cost of Goods Sold','Cost of Goods Sold'],['deco_account','Decoration Expense','Subcontractor - Decoration'],['ar_account','Accounts Receivable','Accounts Receivable'],['ap_account','Accounts Payable','Accounts Payable']].map(([key,label,def])=>
                <div key={key} style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#475569',width:150}}>{label}</span>
                  <input className="form-input" style={{flex:1,fontSize:11,padding:'4px 8px'}} value={qbConfig.mapping[key]||def}
                    onChange={e=>setQBConfig(prev=>({...prev,mapping:{...prev.mapping,[key]:e.target.value}}))}/>
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
            {qbConfig.syncLog.length>0&&<button className="btn btn-sm btn-secondary" onClick={()=>setQBConfig(prev=>({...prev,syncLog:[]}))}>Clear Log</button>}
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
          <div>&#8226; <strong>Inventory</strong> &#8594; Product totals as QB Items (qty + cost value — real inventory stays on portal)</div>
        </div>
      </div>}
    </>);
  }
