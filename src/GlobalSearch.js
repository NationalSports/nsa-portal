import React from 'react';
import { Icon } from './components';
import { safeItems, safePicks, safePOs, safeJobs } from './safeHelpers';

const labels={customer:'Customers',order:'Sales Orders',webstore:'Webstore Orders',estimate:'Estimates',product:'Products',txn:'Ordered Items',pick:'Item Fulfillments',po:'Purchase Orders',job:'Jobs',invoice:'Invoices',vendor:'Vendors'};
const icons={customer:'users',order:'box',webstore:'store',estimate:'dollar',product:'package',txn:'file',pick:'grid',po:'cart',job:'grid',invoice:'file',vendor:'building'};
const limits={customer:6,order:4,webstore:5,estimate:4,product:6,txn:5,pick:4,po:4,job:4,invoice:4,vendor:4};
const text=v=>String(v||'').toLowerCase();

// Keep keystroke state and search-index work out of App. App is intentionally huge, so
// controlling this input there made every character reconcile the entire portal tree.
export default React.memo(function GlobalSearch({
  customers=[],estimates=[],salesOrders=[],products=[],invoices=[],vendors=[],submittedBatches=[],inventoryPOs=[],
  searchProducts,searchTxnItems,mergeTxnItems,searchWebstoreOrders,orderSearchHay=()=>'',searchPOStatus,
  newTabHref,onSeeAll,onOpen,
}){
  const[query,setQuery]=React.useState('');
  const[open,setOpen]=React.useState(false);
  const[remote,setRemote]=React.useState({products:[],txn:[],webstore:[]});
  const deferredQuery=React.useDeferredValue(query);
  const searchActive=deferredQuery.trim().length>=2;
  const requestSeq=React.useRef(0);

  const index=React.useMemo(()=>{
    if(!searchActive)return{entries:[],customerById:new Map()};
    const customerById=new Map(customers.map(c=>[c.id,c]));
    const customerHay=new Map();
    customers.forEach(c=>{const parent=c.parent_id?customerById.get(c.parent_id):null;customerHay.set(c.id,text([c.name,c.alpha_tag,...(c.search_tags||[]),...(parent?.search_tags||[])].join(' ')))});
    const entries=[];const seenPickIds=new Set();const seenPoIds=new Set();
    customers.forEach(c=>entries.push({kind:'customer',value:c,hay:customerHay.get(c.id)||''}));
    estimates.forEach(e=>entries.push({kind:'estimate',value:e,hay:text(e.id+' '+(e.memo||''))+' '+(customerHay.get(e.customer_id)||'')}));
    salesOrders.forEach(so=>{
      const ch=customerHay.get(so.customer_id)||'';const customer=customerById.get(so.customer_id);
      entries.push({kind:'order',value:so,hay:text(so.id+' '+(so.memo||'')+' '+orderSearchHay(so))+' '+ch});
      const poById=new Map();
      safeItems(so).forEach(item=>{
        safePicks(item).forEach(pick=>{if(pick.pick_id&&!seenPickIds.has(pick.pick_id)){seenPickIds.add(pick.pick_id);entries.push({kind:'pick',value:{...pick,so,so_id:so.id},hay:text(pick.pick_id+' '+so.id)})}});
        safePOs(item).forEach(po=>{if(po.po_id&&!poById.has(po.po_id))poById.set(po.po_id,po)});
      });
      (so.deco_pos||[]).forEach(po=>{if(po.po_id&&!poById.has(po.po_id))poById.set(po.po_id,{...po,isDeco:true})});
      poById.forEach(po=>{if(seenPoIds.has(po.po_id))return;seenPoIds.add(po.po_id);entries.push({kind:'po',value:{...po,po_id:po.po_id,so,so_id:so.id,customer:customer?.alpha_tag||'',status:po.isDeco?(po.status||'waiting'):searchPOStatus(so,po.po_id)},hay:text(po.po_id+' '+(po.vendor||'')+' '+so.id)+' '+ch})});
      safeJobs(so).forEach((job,ji)=>entries.push({kind:'job',value:{...job,so,so_id:so.id,ji,customer:customer?.alpha_tag||customer?.name||''},hay:text((job.id||'')+' '+(job.art_name||'')+' '+(job.deco_type||'')+' '+so.id)}));
    });
    submittedBatches.forEach(po=>{if(!po.po_number||seenPoIds.has(po.po_number))return;seenPoIds.add(po.po_number);entries.push({kind:'po',value:{po_id:po.po_number,vendor:po.vendor_name,status:po.status||'waiting',so_id:(po.source_pos||[])[0]?.so_id||'',so:salesOrders.find(x=>x.id===((po.source_pos||[])[0]?.so_id)),customer:(po.source_pos||[])[0]?.customer||'',isBatch:true},hay:text((po.po_number||'')+' '+(po.vendor_name||'')+' '+(po.source_pos||[]).map(sp=>[(sp.po_id||''),(sp.so_id||''),(sp.customer||'')].join(' ')).join(' '))})});
    inventoryPOs.forEach(po=>{if(!po.po_number||seenPoIds.has(po.po_number))return;seenPoIds.add(po.po_number);entries.push({kind:'po',value:{po_id:po.po_number,vendor:po.vendor_name,status:po.status||'ordered',so_id:'',so:null,customer:'',isInvPO:true},hay:text((po.po_number||'')+' '+(po.vendor_name||'')+' '+(po.memo||''))})});
    invoices.forEach(inv=>entries.push({kind:'invoice',value:inv,hay:text((inv.id||'')+' '+(inv.memo||'')+' '+(customerById.get(inv.customer_id)?.name||''))}));
    vendors.forEach(v=>entries.push({kind:'vendor',value:v,hay:text((v.name||'')+' '+(v.rep_name||''))}));
    return{entries,customerById};
  },[searchActive,customers,estimates,salesOrders,invoices,vendors,submittedBatches,inventoryPOs,orderSearchHay,searchPOStatus]);

  React.useEffect(()=>{
    const q=query.trim();const seq=++requestSeq.current;
    if(q.length<2){setRemote({products:[],txn:[],webstore:[]});return undefined}
    const timer=setTimeout(async()=>{
      const [productResult,txnRows,webstoreRows]=await Promise.all([
        Promise.resolve(searchProducts?.(q,{},0,6)).catch(()=>null),
        Promise.resolve(searchTxnItems?.(q,8)).catch(()=>null),
        Promise.resolve(searchWebstoreOrders?.(q,5)).catch(()=>[]),
      ]);
      let productRows=productResult?.products;
      if(!productRows){const s=text(q);productRows=products.filter(p=>text((p.sku||'')+' '+(p.name||'')+' '+(p.brand||'')+' '+(p.color||'')).includes(s)).slice(0,6)}
      const archive=(txnRows||[]).filter(r=>!r.in_catalog);
      if(seq===requestSeq.current)setRemote({products:productRows||[],txn:mergeTxnItems?.(archive,q,5)||[],webstore:webstoreRows||[]});
    },250);
    return()=>clearTimeout(timer);
  },[query,products,searchProducts,searchTxnItems,mergeTxnItems,searchWebstoreOrders]);

  const grouped=React.useMemo(()=>{
    const q=deferredQuery.trim().toLowerCase();if(q.length<2)return{};
    const tokens=q.split(/\s+/).filter(Boolean);const out={};
    index.entries.forEach(entry=>{if(!tokens.every(token=>entry.hay.includes(token)))return;(out[entry.kind]||(out[entry.kind]=[])).push(entry.value)});
    if(out.customer)out.customer.sort((a,b)=>Number(!!a.parent_id)-Number(!!b.parent_id));
    Object.keys(out).forEach(kind=>{out[kind]=out[kind].slice(0,limits[kind]||4)});
    out.product=remote.products.slice(0,6);out.txn=remote.txn.slice(0,5);out.webstore=remote.webstore.slice(0,5);
    return out;
  },[deferredQuery,index,remote]);

  const clear=()=>{setQuery('');setOpen(false);setRemote({products:[],txn:[],webstore:[]})};
  const select=(kind,value,event)=>{if(event&&(event.ctrlKey||event.metaKey||event.shiftKey||event.button===1))return;event?.preventDefault();clear();onOpen(kind,value,index.customerById)};
  const seeAll=()=>{const q=query.trim();if(q.length<2)return;setOpen(false);onSeeAll(q)};
  const kinds=['customer','order','webstore','estimate','product','txn','pick','po','job','invoice','vendor'];
  const total=kinds.reduce((n,k)=>n+(grouped[k]?.length||0),0);
  const hrefFor=(kind,v)=>kind==='customer'?newTabHref({cust:v.id}):kind==='estimate'?newTabHref({est:v.id}):kind==='order'?newTabHref({so:v.id}):kind==='product'?newTabHref({prod:v.id}):kind==='invoice'?newTabHref({inv:v.id}):kind==='vendor'?newTabHref({vend:v.id}):(kind==='pick'||kind==='po'||kind==='job')&&v.so_id?newTabHref({so:v.so_id}):null;
  const row=(kind,v)=>{
    if(kind==='customer')return <><strong>{v.name}</strong>{v.alpha_tag&&<span className="badge badge-gray">{v.alpha_tag}</span>}</>;
    if(kind==='order'||kind==='estimate')return <><strong style={{color:'#1e40af'}}>{v.id}</strong><span>{v.memo}</span>{index.customerById.get(v.customer_id)&&<small>{index.customerById.get(v.customer_id).alpha_tag||index.customerById.get(v.customer_id).name}</small>}</>;
    if(kind==='webstore')return <><strong style={{color:'#1e40af'}}>#{v.order_number||v.omg_order_number}</strong><span>{v.buyer_name||v.buyer_email||''}</span>{v.webstores?.name&&<small>{v.webstores.name}</small>}<span className={`badge ${['paid','shipped','completed'].includes(v.status)?'badge-green':['cancelled','refunded'].includes(v.status)?'badge-gray':'badge-blue'}`}>{v.status}</span></>;
    if(kind==='product')return <><strong style={{fontFamily:'monospace',color:'#1e40af'}}>{v.sku}</strong><span>{v.name}</span>{v.color&&<small>{v.color}</small>}</>;
    if(kind==='txn')return <><strong style={{fontFamily:'monospace',color:'#475569'}}>{v.sku}</strong>{v.name&&<span>{v.name}</span>}<small style={{marginLeft:'auto'}}>{v.txns} txn{v.txns===1?'':'s'}{v.archive?.last_date?' · thru '+String(v.archive.last_date).slice(0,7):''}</small></>;
    if(kind==='pick')return <><strong style={{color:'#1e40af'}}>{v.pick_id}</strong><span>→ {v.so_id}</span><span className={`badge ${v.status==='pulled'?'badge-green':'badge-amber'}`}>{v.status}</span></>;
    if(kind==='po')return <><strong style={{fontFamily:'monospace',color:'#1e40af'}}>{v.po_id}</strong><span>{v.vendor}</span>{v.isInvPO&&<small>INV</small>}{v.so_id&&<span>→ {v.so_id}</span>}<span className={`badge ${v.status==='received'||v.status==='shipped'?'badge-green':v.status==='partial'?'badge-amber':'badge-blue'}`}>{v.status}</span></>;
    if(kind==='job')return <><strong style={{color:'#1e40af'}}>{v.id}</strong><span>{v.art_name||v.deco_type}</span><span>→ {v.so_id}</span></>;
    if(kind==='invoice')return <><strong style={{color:'#1e40af'}}>{v.id}</strong><span>{index.customerById.get(v.customer_id)?.name||''}</span><span className={`badge ${v.status==='paid'?'badge-green':v.status==='partial'?'badge-amber':'badge-blue'}`}>{v.status}</span></>;
    return <><strong>{v.name}</strong>{v.rep_name&&<small>{v.rep_name}</small>}</>;
  };

  return <>
    <div className="search-bar" data-tour-id="global-search" style={{margin:0}}><Icon name="search"/><input placeholder="Search everything... (orders, jobs, POs, invoices, customers)" value={query} onChange={e=>{const value=e.target.value;setQuery(value);setOpen(value.length>=2)}} onFocus={()=>{if(query.length>=2)setOpen(true)}} onKeyDown={e=>{if(e.key==='Enter')seeAll();else if(e.key==='Escape')setOpen(false)}}/>{query&&<button onClick={clear} style={{background:'none',border:'none',cursor:'pointer',padding:2}}><Icon name="x" size={14}/></button>}</div>
    {open&&query.length>=2&&total>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:60,maxHeight:350,overflow:'auto'}}>
      {kinds.map(kind=>(grouped[kind]?.length?<React.Fragment key={kind}><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>{labels[kind]}{kind==='txn'&&<span style={{fontWeight:400,textTransform:'none'}}> · sold before, not in catalog</span>}</div>{grouped[kind].map((value,i)=>{const href=hrefFor(kind,value);const Tag=href?'a':'div';return <Tag key={(value.id||value.po_id||value.pick_id||value.sku||i)+'-'+kind} {...(href?{href}:{})} onClick={e=>select(kind,value,e)} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center',color:'inherit',textDecoration:'none'}}><Icon name={icons[kind]} size={14}/>{row(kind,value)}</Tag>})}</React.Fragment>:null))}
      <div onClick={seeAll} style={{padding:'10px 12px',borderTop:'1px solid #e2e8f0',background:'#f8fafc',cursor:'pointer',fontSize:12,fontWeight:600,color:'#1e40af',display:'flex',alignItems:'center',gap:6}}><Icon name="search" size={12}/>See all results for "{query}" <span style={{color:'#94a3b8',fontWeight:400,marginLeft:'auto'}}>Press Enter ↵</span></div>
    </div>}
    {open&&<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:59}} onClick={()=>setOpen(false)}/>}
  </>;
});
