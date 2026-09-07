import {QB_MAX_REVIEWED_BATCH, queryQBReadOnly} from './qbAccountMappings';
import {mergeQBSyncLogs} from './qbLinkLedger';

export const normalizeProductSKU=value=>String(value||'').trim().toUpperCase();
export async function loadQBProductItems(qbApi){
  const items=[];
  for(let start=1;start<=100000;start+=1000){
    const response=await queryQBReadOnly(qbApi,`SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION ${start} MAXRESULTS 1000`,'product duplicate review');
    const page=response?.QueryResponse?.Item||[];items.push(...page);
    if(page.length<1000)return items;
  }
  throw new Error('Product review exceeded the pagination limit');
}

// What the product batch still needs before it may run, as data rather than a boolean,
// so the Run button can say which half is missing instead of failing on click. Reads the
// durable receipts first: syncLog keeps only the newest 100 events and drops these.
export function qbProductBatchReadiness(config={}){
  const logs=(config.syncLog||[]).filter(l=>l.type==='item_canary'&&l.status==='success');
  const linked=!!config.prodLinkCanaryVerifiedAt||logs.some(l=>l.details?.some(d=>String(d).startsWith('LINK ONLY')));
  const created=!!config.prodCreateCanaryVerifiedAt||logs.some(l=>l.details?.some(d=>String(d).startsWith('CREATED:')));
  return {linked,created,ready:linked&&created};
}

export function buildQBProductManifest(products,items,map={},refs={}){
  const groups=new Map();const excluded=[];
  products.forEach(p=>{
    const sku=normalizeProductSKU(p.sku);
    if(p.is_active===false||p.deleted_at){excluded.push({sku,sourceIds:[String(p.id)],action:'excluded',reason:'Inactive or deleted portal product'});return;}
    const key=sku||'missing:'+p.id;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
  });
  const rows=[...groups.values()].map(group=>{
    const sku=normalizeProductSKU(group[0].sku),sourceIds=group.map(p=>String(p.id)).sort();
    const ids=[...new Set(group.flatMap(p=>[map[p.id],p.qb_item_id]).filter(Boolean).map(String))];
    const matches=items.filter(i=>normalizeProductSKU(i.Sku)===sku||normalizeProductSKU(i.Name)===sku);
    const active=matches.filter(i=>i.Active!==false);
    const linked=ids.length===1?items.find(i=>String(i.Id)===ids[0]):null;
    const item=linked||active[0];
    let reason='';
    if(!sku||sku.length>100||/[\x00-\x1f\x7f]/.test(sku))reason='Missing or unsupported SKU; no truncation is allowed';
    else if(group.some(p=>!p.id)||new Set(sourceIds).size!==sourceIds.length)reason='Missing or duplicate portal source ID';
    else if(ids.length>1)reason='Portal variants have conflicting QBO IDs';
    else if(ids.length&&!linked)reason='Saved QBO item was not returned; audit the saved ID';
    else if(linked?.Active===false)reason='Linked QBO item is inactive';
    else if(active.length>1)reason='Duplicate active QBO items use this SKU/name';
    else if(item&&String(item.Type).toLowerCase()!=='noninventory')reason='Existing item type conflicts with NonInventory';
    else if(item&&(normalizeProductSKU(item.Sku)!==sku||normalizeProductSKU(item.Name)!==sku))reason='Existing item SKU/name conflicts';
    else if(item&&(String(item.IncomeAccountRef?.value)!==String(refs.income_account?.value)||String(item.ExpenseAccountRef?.value)!==String(refs.purchases_account?.value)))reason='Existing item account routing conflicts with 40000/51300';
    else if(!item&&matches.some(i=>i.Active===false))reason='Inactive matching item exists; audit before creating a replacement';
    const complete=!!item&&sourceIds.every(id=>String(map[id]||'')===String(item.Id));
    return {sku,sourceIds,qboId:item?String(item.Id):'',action:reason?'blocked':item?'link':'create',reason:reason||(item?'Existing verified item; link only':'Requires product creation approval'),complete,
      incomeAccount:String(refs.income_account?.value||''),purchasesAccount:String(refs.purchases_account?.value||'')};
  });
  const claimed=new Map();rows.forEach(r=>{if(r.qboId){const prior=claimed.get(r.qboId);if(prior&&prior.sku!==r.sku){prior.action=r.action='blocked';prior.reason=r.reason='QBO item claimed by different portal SKUs';}claimed.set(r.qboId,r);}});
  return [...rows.sort((a,b)=>Number(a.action!=='link')-Number(b.action!=='link')||a.sku.localeCompare(b.sku)),...excluded];
}

export async function runQBProductMigration({options,products,config,qbApi,requiredAccountRefs,verifyReadback,persistQbLink,setQBConfig,setQbSyncing,nf}){
  const canary=!!options.canaryProductId,manifest=options.manifest;
  const age=Date.now()-Date.parse(manifest?.reviewedAt||'');
  if(!canary){
    const {linked,created}=qbProductBatchReadiness(config);
    if(!options.approved||!linked||!created||!manifest?.rows?.length||manifest.rows.length>QB_MAX_REVIEWED_BATCH||new Set(manifest.rows.map(r=>r.sku)).size!==manifest.rows.length||manifest.rows.some(r=>!['link','create'].includes(r.action))||String(manifest.realm)!==String(config.realm_id)||!Number.isFinite(age)||age<0||age>900000){nf('Product batch blocked: approve a fresh product review of at most '+QB_MAX_REVIEWED_BATCH+' SKUs after link and create canaries','error');return {status:'blocked'};}
  }
  setQbSyncing(true);
  const report={id:'product-'+(canary?'canary-':'batch-')+new Date().toISOString(),realm:config.realm_id,status:'running',startedAt:new Date().toISOString(),results:[],counts:{created:0,linked:0,blocked:0,not_attempted:0}};
  const map={...(config.prodQBMap||{})};
  try{
    const refs=await requiredAccountRefs(['income_account','purchases_account']);
    let planned=manifest?.rows;
    // Read every QBO item and build the plan ONCE per run. Doing both per record is
    // quadratic in catalogue size and is what forced the old 20-SKU cap; each record
    // still proves itself with a full API read-back after its write, and every
    // verified item is folded back into the snapshot for the records that follow.
    let items=await loadQBProductItems(qbApi);
    let rowBySku=new Map(buildQBProductManifest(products,items,map,refs).filter(r=>r.action!=='excluded').map(r=>[r.sku,r]));
    if(canary){
      const row=[...rowBySku.values()].find(r=>r.sourceIds.includes(String(options.canaryProductId)));
      if(!row)throw new Error('Choose exactly one active portal SKU');
      planned=[row];
    }
    report.plannedRows=planned;setQBConfig(prev=>({...prev,lastProductRun:JSON.parse(JSON.stringify(report))}));
    let stopped=false;
    for(const plan of planned){
      if(stopped){report.results.push({...plan,result:'not_attempted'});report.counts.not_attempted++;continue;}
      const log={ts:new Date().toLocaleString(),type:canary?'item_canary':'product_batch_record',status:'success',details:[]};
      try{
        const row=rowBySku.get(plan.sku);
        if(!row||!['link','create'].includes(row.action))throw new Error(row?.reason||'SKU no longer eligible');
        if(!canary&&JSON.stringify([row.sku,row.sourceIds,row.qboId,row.action,row.incomeAccount,row.purchasesAccount])!==JSON.stringify([plan.sku,plan.sourceIds,plan.qboId,plan.action,plan.incomeAccount,plan.purchasesAccount]))throw new Error('Product plan changed; run a fresh review');
        if(row.action==='create'&&!(canary?options.allowCreate:options.approved))throw new Error('no active item matched; explicit creation approval is required');
        let id=row.qboId;
        if(row.action==='create'){
          const response=await qbApi('upsert_item',{item:{Name:row.sku,Sku:row.sku,Type:'NonInventory',IncomeAccountRef:refs.income_account,ExpenseAccountRef:refs.purchases_account}});
          id=String(response?.Item?.Id||'');if(!id)throw new Error(response?.Fault?.Error?.[0]?.Detail||'QBO did not return an item ID');
        }
        const verified=await verifyReadback('Item',id,{sku:row.sku});
        if(verified.Active===false||String(verified.Type).toLowerCase()!=='noninventory'||normalizeProductSKU(verified.Name)!==row.sku||normalizeProductSKU(verified.Sku)!==row.sku||String(verified.IncomeAccountRef?.value)!==row.incomeAccount||String(verified.ExpenseAccountRef?.value)!==row.purchasesAccount||verified.TrackQtyOnHand===true||Number(verified.QtyOnHand||0)!==0||verified.AssetAccountRef?.value)throw new Error('Item read-back failed SKU, NonInventory, accounts, or no-inventory checks');
        log.details=[(row.action==='link'?'LINK ONLY — no QBO item was changed: ':'CREATED: ')+row.sku+' → QBO Item #'+id,'READ-BACK VERIFIED: '+row.sku+' · NonInventory · 40000/51300'];
        await persistQbLink({mapKey:'prodQBMap',sourceIds:row.sourceIds,qboId:id,log,evidence:{sku:row.sku,result:row.action==='link'?'linked':'created',batch_id:canary?null:report.id,income_account:row.incomeAccount,purchases_account:row.purchasesAccount,api_readback:true,duplicate_preflight:'verified',no_inventory:true}});
        row.sourceIds.forEach(source=>{map[source]=id});
        const at=items.findIndex(existing=>String(existing.Id)===String(id));
        if(at>=0)items[at]=verified; else items.push(verified);
        const result=row.action==='link'?'linked':'created';report.counts[result]++;
        report.results.push({...row,qboId:id,result,apiReadback:true});
      }catch(e){stopped=true;log.status='error';log.details.push(plan.sku+' — BLOCKED: '+e.message);report.counts.blocked++;report.results.push({...plan,result:'blocked',error:e.message});}
      setQBConfig(prev=>({...prev,prodQBMap:{...prev.prodQBMap,...map},lastProductRun:JSON.parse(JSON.stringify(report)),syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
    }
    report.status=stopped?'stopped':'success';
  }catch(e){report.status='blocked';report.error=e.message;report.counts.blocked++;}
  finally{
    report.finishedAt=new Date().toISOString();
    setQBConfig(prev=>({...prev,lastProductRun:report}));
    setQbSyncing(false);nf('Product '+(canary?'canary':'batch')+' '+report.status+(report.error?' — '+report.error:''),report.status==='success'?'success':'error');
  }
  return report;
}
