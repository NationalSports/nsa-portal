import React,{useEffect,useState,useRef} from 'react';
import {ProductPicker} from './components';
import {fetchVendorSizeInventory,vendorInvSource} from './vendorInventory';
const when=v=>v?new Date(v).toLocaleString(): 'time unknown';
const sizesText=s=>Object.entries(s||{}).map(([k,v])=>`${k}:${v}`).join(', ');
export function parseSizes(text){
 const sizes={};if(!text.trim())return sizes;
 for(const part of text.split(',')){const m=part.trim().match(/^([^:,]{1,20}):\s*(\d+)$/);if(!m||+m[2]<1||+m[2]>100000)throw Error('Use sizes like S:5, M:10, L:5.');const key=m[1].trim().toUpperCase();if(Object.hasOwn(sizes,key))throw Error('List each size only once.');sizes[key]=+m[2];}return sizes;
}
export default function CustomerEmailWork({row,work,call,onRefresh,onReply,onOpenEstimate,products,vendors,searchProducts}){
 const editRevision=useRef(null),dirtyRef=useRef(false);
 const [expanded,setExpanded]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[edits,setEdits]=useState([]),[dirty,setDirty]=useState(false),[live,setLive]=useState({}),[catalogQuery,setCatalogQuery]=useState({}),[catalogResults,setCatalogResults]=useState({});
 dirtyRef.current=dirty;
 useEffect(()=>{if(dirtyRef.current)return;editRevision.current=work?.revision;setEdits((work?.prepared?.lines||[]).map(l=>({...l,product_id:l.product?.id||'',sizesText:sizesText(l.sizes)})));setDirty(false);setLive({});},[work?.revision]);
 const action=async(name,extra={})=>{setBusy(name);setError('');try{const d=await call('rep-email-work',{action:name,insightId:row.id,revision:name==='save'?editRevision.current:work?.revision,...extra});if(name==='save'){dirtyRef.current=false;setDirty(false);}await onRefresh();return d}catch(e){setError(e.message);return null}finally{setBusy('')}};
 const prepare=async()=>{setExpanded(true);await action('prepare',{retry:!!work})};
 const change=(i,patch)=>{setEdits(a=>a.map((l,j)=>j===i?{...l,...patch}:l));setDirty(true);setLive({});};
 const save=async()=>{try{const lines=edits.map(l=>({product_id:l.product_id,quantity:l.quantity||null,sizes:parseSizes(l.sizesText),decoration:l.decoration}));await action('save',{lines})}catch(e){setError(e.message)}};
 const searchCatalog=async i=>{setBusy('catalog'+i);setError('');try{const d=await call('rep-email-work',{action:'search_products',insightId:row.id,query:catalogQuery[i]||''});setCatalogResults(v=>({...v,[i]:d.products||[]}));if(!d.products?.length)setError('No catalog matches. Try a shorter product name or exact SKU.');}catch(e){setError(e.message)}finally{setBusy('')}};
 const checkStock=async()=>{
  setBusy('stock');setError('');const found={};
  try{
   const d=await call('rep-email-work',{action:'stock',insightId:row.id,revision:work.revision});await onRefresh();
   for(let i=0;i<(d.work?.prepared?.lines||[]).length;i++){
    const p=d.work.prepared.lines[i].product;if(!p)continue;
    const vendor=(vendors||[]).find(v=>v.id===p.vendor_id),source=vendorInvSource(vendor,{brand:p.brand});
    if(!['ss','sm','mt','rs'].includes(source))continue;
    try{const result=await fetchVendorSizeInventory(source,p);found[i]={state:'live',source,sizes:result.sizes,as_of:new Date().toISOString(),note:source==='mt'?'Supplier reports available/unavailable, not exact quantities.':'Supplier lookup (may be cached up to 10 minutes). Not reserved.'};}catch(e){found[i]={state:'unknown',note:'Live stock check failed. Try again or check the supplier.'};}
   }
   setLive(found);
  }catch(e){setError(e.message)}finally{setBusy('')}
 };
 const draft=work?.prepared,working=work&&['queued','processing'].includes(work.status),stale=working&&Date.now()-Date.parse(work.updated_at)>10*60000;
 const ready=work?.status==='ready',accountChanged=!!work&&work.customer_id!==row.customer_id;
 return <section className="email-work" aria-label="AI prepared work">
  <div className="email-work-heading"><div><strong>{ready?'Prepared for your review':working?'Preparing in the background…':'Let AI prepare the work'}</strong><small>{ready?`${draft?.lines?.length||0} draft item(s) · ${draft?.missing?.length||0} details to review`: 'Estimate details, stock, and a suggested reply. Nothing is sent automatically.'}</small></div>
   {!work?<button className="btn btn-sm btn-primary" disabled={!!busy} onClick={prepare}>AI prepare estimate</button>:<button className="btn btn-sm btn-secondary" onClick={()=>setExpanded(v=>!v)}>{expanded?'Collapse':'Review work'}</button>}
  </div>
  {error&&<p role="alert" className="email-work-error">{error}</p>}
  {expanded&&<>
   {accountChanged&&<p>Account changed. <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={prepare}>Recalculate for this account</button></p>}
   {(work?.status==='failed'||stale)&&<p role="alert">{work.error||'Preparation is taking longer than expected.'} <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={prepare}>Retry preparation</button></p>}
   {working&&!stale&&<p role="status">You can leave this page. The prepared work will be saved here when ready.</p>}
   {ready&&<>
    <p>{draft.notes}</p>
    {work.source_insight_id!==row.id&&<p className="email-work-notice">This is the shared draft for this conversation, including the latest imported email.</p>}
    {work.estimate_id&&<p className="email-work-notice">Linked to {work.estimate_id}. Follow-ups update this preparation; your saved estimate is never overwritten. Apply revisions in the estimate editor.</p>}
    {edits.map((l,i)=>{const stock=live[i]||l.stock;return <div className="email-work-line" key={i}>
     <strong>{i+1}. {l.name||l.sku||'Requested item'}</strong>
     {l.evidence&&<blockquote>{l.evidence}</blockquote>}
     <label>Catalog product — confirm style and color<ProductPicker products={[...(catalogResults[i]||[]),...(l.candidates||[]).filter(p=>!(catalogResults[i]||[]).some(c=>c.id===p.id)),...(products||[]).filter(p=>![...(l.candidates||[]),...(catalogResults[i]||[])].some(c=>c.id===p.id))]} searchProducts={searchProducts} value={l.product_id} onPick={p=>change(i,{product_id:p.id})} placeholder="Choose the exact product…"/></label>
     <div className="email-work-catalog"><input aria-label={"Search full catalog for item "+(i+1)} placeholder="Search full catalog by SKU or name" value={catalogQuery[i]||''} onChange={e=>setCatalogQuery(v=>({...v,[i]:e.target.value}))}/><button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={()=>searchCatalog(i)}>Find products</button></div>
     <div className="email-work-inputs"><label>Total quantity<input type="number" min="1" max="100000" value={l.quantity||''} onChange={e=>change(i,{quantity:e.target.value})}/></label><label>Sizes (if known)<input placeholder="S:5, M:5, L:5" value={l.sizesText} onChange={e=>change(i,{sizesText:e.target.value})}/></label></div>
     <label>Decoration to review<input value={l.decoration||''} placeholder="Not specified" onChange={e=>change(i,{decoration:e.target.value})}/></label>
     <p>{l.pricing?.unit_sell!=null?`Garment draft price: $${l.pricing.unit_sell.toFixed(2)} each`:'Price pending product selection'} <small>· Decoration, size upcharges, tax and shipping need review.</small></p>
     <div className="email-work-stock"><b>{stock?.state==='live'?'Supplier stock':stock?.state==='snapshot'?'Saved supplier stock':'Stock unknown'}</b>{stock?.sizes&&<div>{Object.entries(stock.sizes).map(([s,q])=>`${s}: ${stock.source==='mt'?(q>0?'available':'unavailable'):q}`).join(' · ')}</div>}{stock?.as_of&&<small>As of {when(stock.as_of)} · {stock.source}</small>}<small>{stock?.note}</small></div>
    </div>})}
    {!!draft.missing?.length&&<div className="email-work-missing"><b>Needs your review</b><ul>{draft.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></div>}
    <div className="email-work-buttons">
     {dirty&&<button className="btn btn-primary" disabled={!!busy||accountChanged} onClick={save}>{busy==='save'?'Saving…':'Save reviewed details'}</button>}
     <button className="btn btn-secondary" disabled={!!busy||dirty||accountChanged||!edits.some(l=>l.product_id)} onClick={checkStock}>{busy==='stock'?'Checking…':'Check stock'}</button>
     <button className="btn btn-primary" disabled={!!busy||dirty||accountChanged||(!work.estimate_id&&(!row.customer_id||!edits.length||edits.some(l=>!l.product_id)))} onClick={async()=>{const d=await action('create_estimate');if(d?.estimateId){setBusy('open');try{await onOpenEstimate(d.estimateId)}catch(e){setError(e.message)}finally{setBusy('')}}}}>{work.estimate_id?'Open '+work.estimate_id:'Create draft estimate'}</button>
     <button className="btn btn-secondary" disabled={!!busy||dirty||accountChanged} onClick={()=>onReply(draft.reply_text)}>Review suggested reply</button>
     <button className="btn btn-secondary" disabled={!!busy||dirty} onClick={prepare}>Re-read conversation</button>
    </div>
    {dirty&&editRevision.current!==work?.revision&&<p className="email-work-error">A newer preparation is available. Your edits are preserved. <button className="btn btn-secondary" onClick={()=>{setEdits((work.prepared.lines||[]).map(l=>({...l,product_id:l.product?.id||'',sizesText:sizesText(l.sizes)})));editRevision.current=work.revision;setDirty(false);}}>Load latest prepared details</button></p>}
    {dirty&&<small>Save your reviewed details to recalculate prices and enable the next steps.</small>}
   </>}
  </>}
 </section>;
}
