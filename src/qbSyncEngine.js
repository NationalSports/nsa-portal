// QuickBooks sync engine — the seven sync routines, extracted verbatim from QBPage
// so the App-level auto-sync interval can build and run them from CURRENT state at
// fire time. The old wiring called a ref that only a mounted QBPage assigned, so
// auto-sync silently did nothing until the page was visited that session — and after
// leaving the page it synced the stale snapshot captured at the last render. QBPage
// builds this same engine for its buttons: one copy of the logic, two callers.
import { D_V } from './constants';
import { _dbSaveSO } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { calculateCustomerShipping, loadAllQBEntities, loadQBAccounts, resolveQBAccountRefs } from './qbAccountMappings';

// ctx: every piece of app state/setters the routines touch, plus qbApi/nf/dP —
// passed fresh by the caller (QBPage per render; App per interval fire).
export function createQBSyncEngine(ctx){
  const {cust,sos,invs,prod,vend,invPOs,submittedBatches,qbApi,qbConfig,nf,dP,
    setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend}=ctx;

    let accountCache=null;
    const requiredAccountRefs=async(keys)=>{
      if(!accountCache)accountCache=await loadQBAccounts(qbApi);
      return resolveQBAccountRefs(accountCache,qbConfig.mapping,keys);
    };
    // Invoices/estimates must carry an ItemRef for their income account to be
    // deterministic. This service item is the controlled fallback when a portal
    // product does not yet have its own QBO item.
    const ensurePortalSalesItem=async(incomeAccountRef)=>{
      const name='NSA Portal Sales';
      const qRes=await qbApi('query',{query:"SELECT * FROM Item WHERE Name = 'NSA Portal Sales' MAXRESULTS 1"});
      const existing=qRes?.QueryResponse?.Item?.[0];
      if(existing?.Id&&String(existing.IncomeAccountRef?.value||'')===String(incomeAccountRef.value))return String(existing.Id);
      const item=existing?.Id
        ?{Id:existing.Id,SyncToken:existing.SyncToken,sparse:true,Name:name,IncomeAccountRef:incomeAccountRef}
        :{Name:name,Type:'Service',Description:'Portal sales and customer-billed shipping — 40000 Sales',IncomeAccountRef:incomeAccountRef};
      const res=await qbApi('upsert_item',{item});
      if(!res?.Item?.Id)throw new Error(res?.Fault?.Error?.[0]?.Detail||'Could not create or update the NSA Portal Sales item');
      return String(res.Item.Id);
    };

    // ── SYNC: Customers (name + totals) ──
    const syncCustomers=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'customers',status:'success',details:[]};
      let synced=0;
      const custQBMap={};// localId -> qbCustomerId (returned for downstream syncs)
      // Fetch existing QB customers to match by name and avoid duplicates
      let existingQBCusts=[];
      try{
        existingQBCusts=await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, SyncToken',1000);
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
      let invoiceRefs,salesItemId;
      try{
        invoiceRefs=await requiredAccountRefs(['income_account','ar_account','payment_deposit_account']);
        salesItemId=await ensurePortalSalesItem(invoiceRefs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required invoice account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Invoice sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      for(const inv of unsyncedInvs2){
        const c=cust.find(cc=>cc.id===inv.customer_id);
        const cQBId=custQBMap[inv.customer_id]||(qbConfig.custQBMap||{})[inv.customer_id];
        if(!cQBId){log.details.push((inv.display_id||inv.id)+' — skipped: customer "'+c?.name+'" not synced to QB');continue}
        const so=sos.find(s=>s.id===(inv.so_id||inv.sales_order_id));
        const invPaid=(inv.payments||[]).reduce((a,p)=>a+safeNum(p.amount),0);
        // A taxable QBO invoice needs the company's QBO TaxCode/TxnTaxDetail,
        // not a made-up revenue or liability line. Until that mapping exists,
        // fail this invoice closed so tax is never credited to 40000 by mistake.
        if(safeNum(inv.tax)>0){
          log.details.push((inv.display_id||inv.id)+' — BLOCKED: $'+safeNum(inv.tax).toFixed(2)+' sales tax requires a QBO tax-code mapping. It was not posted to 40000 or guessed into 25201.');
          log.status='partial';continue;
        }
        const qbInvoice={
          DocNumber:inv.display_id||inv.id,
          TxnDate:inv.invoice_date||new Date().toISOString().slice(0,10),
          CustomerRef:{value:cQBId},
          ARAccountRef:invoiceRefs.ar_account,
          Line:[{DetailType:'SalesItemLineDetail',Amount:inv.total??0,Description:'Invoice '+(inv.display_id||inv.id)+(so?' for '+so.id:'')+(so?.memo?' — '+so.memo:''),
            SalesItemLineDetail:{Qty:1,UnitPrice:inv.total??0,ItemRef:{value:salesItemId,name:'NSA Portal Sales'}}}],
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
              const qbPmt={CustomerRef:{value:cQBId},DepositToAccountRef:invoiceRefs.payment_deposit_account,TotalAmt:pmt.amount,
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
      let paidRefs,salesItemId;
      try{
        paidRefs=await requiredAccountRefs(['income_account','ar_account','payment_deposit_account']);
        salesItemId=await ensurePortalSalesItem(paidRefs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required payment account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Paid sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
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
            if(safeNum(inv.tax)>0){log.details.push((inv.display_id||inv.id)+' — total correction BLOCKED: taxable invoice needs QBO tax-code mapping');log.status='partial';continue}
            const upd=await qbApi('upsert_invoice',{invoice:{Id:inv.qb_invoice_id,SyncToken:qbInv.SyncToken,sparse:true,
              Line:[{DetailType:'SalesItemLineDetail',Amount:portalTotal,Description:'Invoice '+(inv.display_id||inv.id),SalesItemLineDetail:{Qty:1,UnitPrice:portalTotal,ItemRef:{value:salesItemId,name:'NSA Portal Sales'}}}]}});
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
                const qbPmt={CustomerRef:{value:cQBId},DepositToAccountRef:paidRefs.payment_deposit_account,TotalAmt:diff,
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
        const qbBills=await loadAllQBEntities(qbApi,'Bill','*',500);
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
            // One QBO bill may cover several SKU rows on the same PO. The old
            // code added the ENTIRE bill total to every matching row, multiplying
            // cost by the line count. Allocate the bill total once, weighted by
            // each row's ordered cost, with the final row taking rounding cents.
            const hits=[];
            (soHit.items||[]).forEach((it,itemIndex)=>(it.po_lines||[]).forEach((po,poIndex)=>{
              if(po.po_id!==matchedPortalPOId)return;
              const orderedQty=Object.entries(po).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+safeNum(v),0);
              hits.push({itemIndex,poIndex,weight:Math.max(0,orderedQty*safeNum(po.unit_cost||it.nsa_cost))});
            }));
            const totalWeight=hits.reduce((a,h)=>a+h.weight,0);
            let allocated=0;
            const allocations=hits.map((h,idx)=>{
              const amount=idx===hits.length-1
                ?Math.round((billTotal-allocated)*100)/100
                :Math.round((billTotal*(totalWeight>0?h.weight/totalWeight:1/hits.length))*100)/100;
              allocated=Math.round((allocated+amount)*100)/100;
              return{...h,amount};
            });
            setSOs(prev=>prev.map(s=>{
              if(s.id!==soHit.id)return s;
              const updatedItems=(s.items||[]).map((it,itemIndex)=>{
                if(!allocations.some(a=>a.itemIndex===itemIndex))return it;
                return{...it,po_lines:it.po_lines.map((po,poIndex)=>{
                  const allocation=allocations.find(a=>a.itemIndex===itemIndex&&a.poIndex===poIndex);
                  if(!allocation)return po;
                  const prevCost=safeNum(po._bill_cost||0);
                  return{...po,_bill_cost:Math.round((prevCost+allocation.amount)*100)/100,
                    _bill_details:[...(po._bill_details||[]),{...billInfo,allocated_total:allocation.amount}]};
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

    // ── SYNC: Products as QBO NonInventory items ──
    // QBO is not the quantity-on-hand system. Sizes, colors, on-hand quantity,
    // and valuation remain in the portal. QBO carries one item per SKU so POs,
    // bills, estimates, and invoices retain SKU/quantity detail.
    const syncInventory=async()=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'inventory',status:'success',details:[]};
      let synced=0;
      let incomeAcctRef,expenseAcctRef;
      try{
        const refs=await requiredAccountRefs(['income_account','purchases_account']);
        incomeAcctRef=refs.income_account;expenseAcctRef=refs.purchases_account;
      }catch(e){
        log.status='error';log.details.push(e.message||'Required product-item account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Product item sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return{};
      }
      // Query existing QB items to match by name and avoid duplicates
      let existingQBItems=[];
      try{
        existingQBItems=await loadAllQBEntities(qbApi,'Item','Id, Name, Sku, Type, SyncToken, Active',1000);
      }catch(e){console.warn('[QB] Item query failed:',e)}
      const prodQBMap={...(qbConfig.prodQBMap||{})};
      const skuGroups=new Map();
      prod.filter(p=>p.is_active!==false&&String(p.sku||'').trim()).forEach(p=>{
        const key=String(p.sku).trim().toUpperCase();
        if(!skuGroups.has(key))skuGroups.set(key,[]);
        skuGroups.get(key).push(p);
      });
      for(const [sku,products] of skuGroups){
        const p=products[0];
        const existingQBId=products.map(pp=>prodQBMap[pp.id]).find(Boolean);
        // Sanitize the name QB will display — strip control chars QB chokes on,
        // collapse whitespace, trim, cap at 100. Same for description.
        const cleanName=String(p.name||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
        const itemName=sku.slice(0,100);
        // Match existing QB item by name or stored ID
        let qbId=existingQBId;let syncToken=null;let existingType=null;
        if(qbId){
          const match=existingQBItems.find(i=>i.Id===qbId);
          if(match){syncToken=match.SyncToken;existingType=match.Type}
        }else{
          const match=existingQBItems.find(i=>String(i.Sku||'').trim().toUpperCase()===sku||String(i.Name||'').trim().toUpperCase()===sku);
          if(match){qbId=match.Id;syncToken=match.SyncToken;existingType=match.Type}
        }
        if(qbId&&existingType&&String(existingType).toLowerCase()!=='noninventory'){
          log.details.push(sku+' — BLOCKED: existing QBO item type is '+existingType+'; expected NonInventory');log.status='partial';continue;
        }
        const isUpdate=!!qbId;
        const qbItem={
          Name:itemName,
          Sku:sku,
          Description:cleanName+' | Non-inventory; size/color stock stays in Portal',
          PurchaseDesc:cleanName,
          UnitPrice:safeNum(p.retail_price||p.nsa_cost),
          PurchaseCost:safeNum(p.nsa_cost),
          IncomeAccountRef:incomeAcctRef,
          ExpenseAccountRef:expenseAcctRef,
          ...(isUpdate
            ?{Id:qbId,SyncToken:syncToken,sparse:true}
            :{Type:'NonInventory'}),
        };
        const res=await qbApi('upsert_item',{item:qbItem});
        if(res?.Item?.Id){
          products.forEach(pp=>{prodQBMap[pp.id]=res.Item.Id});
          log.details.push(sku+' → QBO NonInventory Item #'+res.Item.Id+' ('+products.length+' portal variant'+(products.length===1?'':'s')+')');synced++;
        }else{log.details.push(sku+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      log.details.unshift(synced+' product items synced');
      setQBConfig(prev=>({...prev,prodQBMap:{...prev.prodQBMap,...prodQBMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' non-inventory SKU items synced to QB');
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
      let fallbackSalesItemId;
      try{
        const refs=await requiredAccountRefs(['income_account']);
        fallbackSalesItemId=await ensurePortalSalesItem(refs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'40000 Sales could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Sales-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
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
            const eq=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);
            if(dp.sell>0){decoTotal+=eq*dp.sell;decoDescs.push((d.position||d.deco_type||d.kind||'Art')+' @$'+dp.sell.toFixed(2))}
          });
          const lineAmt=qty*(it.unit_sell||0)+decoTotal;
          const desc=it.sku+' '+it.name+(it.color?' - '+it.color:'')+(decoDescs.length?' + '+decoDescs.join(', '):'');
          lines.push({DetailType:'SalesItemLineDetail',Amount:lineAmt,
            Description:desc,
            SalesItemLineDetail:{Qty:qty,UnitPrice:lineAmt/qty,ItemRef:{value:String(itemQBId||fallbackSalesItemId)}}});
        });
        if(!lines.length)continue;
        const salesSubtotal=lines.reduce((sum,line)=>sum+safeNum(line.Amount),0);
        const customerShipping=calculateCustomerShipping(so,salesSubtotal);
        if(customerShipping>0)lines.push({DetailType:'SalesItemLineDetail',Amount:customerShipping,
          Description:'Customer shipping — 40000 Sales',
          SalesItemLineDetail:{Qty:1,UnitPrice:customerShipping,ItemRef:{value:String(fallbackSalesItemId)}}});
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
    const syncPurchaseOrders=async(prodQBMapArg={})=>{
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'purchase_orders',status:'success',details:[]};
      let synced=0;
      const poMap=qbConfig.qbPOMap||{};
      // Fetch existing QB vendors to match by name and avoid duplicates
      let existingQBVendors=[];
      try{
        existingQBVendors=await loadAllQBEntities(qbApi,'Vendor','Id, DisplayName, CompanyName, SyncToken',500);
      }catch(e){console.warn('[QB] Vendor query failed:',e)}
      const vendorQBMap={};// vendorName -> qbVendorId (cache for this sync run)
      // POs do not post to the GL, but every line still carries the approved
      // category so the PO-to-bill workflow remains deterministic.
      let poAccountRefs;
      try{
        poAccountRefs=await requiredAccountRefs(['purchases_account','deco_account']);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required purchase-order account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Purchase-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      // Group PO lines by po_id so we push one QB PO with all line items
      const poGroupMap={};
      sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{
        if(!poMap[pl.po_id]){
          if(!poGroupMap[pl.po_id])poGroupMap[pl.po_id]={poId:pl.po_id,entries:[],vendor:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand,created_at:pl.created_at,accountKey:pl.po_type==='outside_deco'?'deco_account':'purchases_account'};
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
        const effectiveProdQBMap={...(qbConfig.prodQBMap||{}),...(prodQBMapArg||{})};
        let missingSkuItem=null;
        const itemGroups=new Map();
        const qbLines=[];
        group.entries.forEach(({pl:p,so:s,it:i})=>{
          const qty=Object.entries(p).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
          const rate=p.po_type==='outside_deco'?safeNum(p.unit_cost):safeNum(i.nsa_cost);
          if(group.accountKey==='deco_account'){
            qbLines.push({DetailType:'AccountBasedExpenseLineDetail',Amount:qty*rate,
              Description:i.sku+' '+i.name+' x'+qty+' @$'+rate.toFixed(2)+' (SO: '+s.id+')',
              AccountBasedExpenseLineDetail:{AccountRef:poAccountRefs.deco_account}});return;
          }
          const sku=String(i.sku||'').trim().toUpperCase();
          const productId=i.product_id||(prod.find(pp=>String(pp.sku||'').trim().toUpperCase()===sku)||{}).id;
          const itemId=effectiveProdQBMap[productId];
          if(!sku||!itemId){missingSkuItem=sku||'(blank SKU)';return}
          const entry=itemGroups.get(sku)||{sku,itemId,qty:0,amount:0,names:new Set(),soIds:new Set()};
          entry.qty+=qty;entry.amount+=qty*rate;entry.names.add(i.name);entry.soIds.add(s.id);itemGroups.set(sku,entry);
        });
        if(missingSkuItem){log.details.push(group.poId+' — BLOCKED: QBO NonInventory item missing for '+missingSkuItem);log.status='partial';continue}
        itemGroups.forEach(entry=>qbLines.push({DetailType:'ItemBasedExpenseLineDetail',Amount:Math.round(entry.amount*100)/100,
          Description:entry.sku+' '+[...entry.names].filter(Boolean).join(' / ')+' (SO: '+[...entry.soIds].join(', ')+')',
          ItemBasedExpenseLineDetail:{ItemRef:{value:String(entry.itemId)},Qty:entry.qty,UnitPrice:Math.round((entry.amount/entry.qty)*100)/100}}));
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
      await syncPurchaseOrders(prodQBMap);
      setQbSyncing(false);
    };

    return {syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,syncSalesOrders,syncPurchaseOrders,syncAll};
}
