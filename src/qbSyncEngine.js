// QuickBooks sync engine — the seven sync routines, extracted verbatim from QBPage
// so the App-level auto-sync interval can build and run them from CURRENT state at
// fire time. The old wiring called a ref that only a mounted QBPage assigned, so
// auto-sync silently did nothing until the page was visited that session — and after
// leaving the page it synced the stale snapshot captured at the last render. QBPage
// builds this same engine for its buttons: one copy of the logic, two callers.
import { D_V } from './constants';
import { _dbSaveSO } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';

// ctx: every piece of app state/setters the routines touch, plus qbApi/nf/dP —
// passed fresh by the caller (QBPage per render; App per interval fire).
export function createQBSyncEngine(ctx){
  const {cust,sos,invs,prod,vend,invPOs,submittedBatches,qbApi,qbConfig,nf,dP,
    setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend}=ctx;

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

    return {syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,syncSalesOrders,syncPurchaseOrders,syncAll};
}
