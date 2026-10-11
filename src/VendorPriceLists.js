import React,{useEffect,useState} from 'react';
import {priceListCall,openPriceList,uploadPriceList} from './lib/vendorPriceLists';

export function PriceListResults({result}) {
  const [error,setError]=useState('');
  const stocks=new Map();
  (result.stock||[]).forEach(r=>{const key=r.source+':'+r.sku;if(!stocks.has(key))stocks.set(key,[]);stocks.get(key).push(r);});
  return <div style={{fontSize:12,overflowWrap:'anywhere'}}>
    {error&&<p role="alert">{error}</p>}
    {!(result.matches||[]).length&&<p>No matching current price-list text found. Try a SKU or fewer product keywords.</p>}
    {(result.matches||[]).map((m,i)=><article key={m.document_id+':'+i} style={{borderBottom:'1px solid #e2e8f0',padding:'10px 0'}}>
      <strong>{m.vendor_name}</strong> · <button className="btn btn-sm btn-secondary" onClick={()=>openPriceList(m.document_id).catch(e=>setError(e.message))}>{m.file_name}</button>
      <div>{m.location} · {m.effective_date?`Effective ${m.effective_date}`:'Effective date not supplied'} · Uploaded {new Date(m.created_at).toLocaleDateString()}</div>
      <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',maxHeight:250,overflow:'auto',background:'#f8fafc',padding:8}}>{m.content}</pre>
    </article>)}
    {result.limited&&<p>Showing the first 20 sections. Narrow the search for more precise results.</p>}
    <p>Prices are source excerpts; check currency, cost versus retail, quantity breaks and terms in the original. No price is saved to a product or order.</p>
    <strong>Adidas / UA synced availability</strong>
    {!stocks.size&&<p>No exact SKU match in the available sync data. Availability is unknown; this does not mean out of stock. For UA, include the style-color code.</p>}
    {[...stocks].map(([key,rows])=><div key={key} style={{margin:'10px 0'}}>
      <strong>{rows[0].source==='ua'?'Under Armour':'Adidas'} · {rows[0].sku}</strong>{rows[0].feed&&<span> · {rows[0].feed}</span>}
      <table style={{fontSize:11,width:'100%'}}><thead><tr><th>Size</th><th>Qty</th><th>Incoming</th><th>Synced</th></tr></thead><tbody>
        {rows.map((r,i)=><tr key={i}><td>{r.size}</td><td>{r.stock_qty??'Unknown'}</td><td>{r.future_delivery_qty>0?`${r.future_delivery_qty} · ${r.future_delivery_date||'date unknown'}`:'—'}</td><td>{r.last_synced?new Date(r.last_synced).toLocaleString():'Unknown'}{(!r.last_synced||Date.now()-new Date(r.last_synced).getTime()>86400000)&&' · stale'}</td></tr>)}
      </tbody></table>
    </div>)}
    {(result.warnings||[]).map(w=><p key={w} role="alert">{w}</p>)}
  </div>;
}
export default function VendorPriceLists({vendor}) {
  const [docs,setDocs]=useState([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [effective,setEffective]=useState(''),[expires,setExpires]=useState(''),[query,setQuery]=useState(''),[result,setResult]=useState(null);
  async function refresh(){const r=await priceListCall('list',{vendor_id:vendor.id});setDocs(r.documents);}
  useEffect(()=>{let active=true;setDocs([]);setResult(null);setError('');priceListCall('list',{vendor_id:vendor.id}).then(r=>{if(active)setDocs(r.documents);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[vendor.id]);
  async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy(true);setError('');try{await uploadPriceList(vendor.id,file,{effective_date:effective,expires_on:expires},setStatus);await refresh();setResult(null);setStatus('Price list is searchable. Archive an older file below if this replaces it.');}catch(e){setError(e.message);setStatus('');}finally{setBusy(false);}}
  async function archive(doc){if(!window.confirm(`Archive ${doc.file_name}? It will no longer appear in assistant searches.`))return;setBusy(true);setError('');try{await priceListCall('archive',{id:doc.id});await refresh();setResult(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function search(e){e.preventDefault();setBusy(true);setError('');try{setResult(await priceListCall('search',{query,vendor_id:vendor.id}));}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <section className="card" style={{marginBottom:16}} aria-label="Vendor price lists"><div className="card-body">
    <h3 style={{marginTop:0}}>Price lists</h3>
    <p style={{fontSize:12,color:'#64748b'}}>Optional PDF or Excel reference files for this vendor. No catalog required. Search here or ask the portal assistant for vendor pricing and stock.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
      <label>Effective date <input aria-label="Price list effective date" className="form-input" type="date" value={effective} onChange={e=>setEffective(e.target.value)} disabled={busy}/></label>
      <label>Expires on <input aria-label="Price list expiry date" className="form-input" type="date" value={expires} onChange={e=>setExpires(e.target.value)} disabled={busy}/></label>
      <label className="btn btn-secondary">Upload price list<input aria-label="Upload vendor price list" type="file" accept=".pdf,.xls,.xlsx" onChange={upload} disabled={busy} style={{display:'block',maxWidth:240}}/></label>
    </div>
    <p style={{fontSize:11,color:'#64748b'}}>Up to 20 MB. PDFs must contain searchable text; scan-only pages need OCR first. Dates are optional. Future and expired lists stay on file but are excluded from search.</p>
    {status&&<p role="status">{status}</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    {!docs.length&&!error&&<p>No price list uploaded. This vendor can still be used normally.</p>}
    {docs.map(doc=><div key={doc.id} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'8px 0',borderBottom:'1px solid #e2e8f0'}}>
      <button className="btn btn-sm btn-secondary" disabled={busy||doc.status==='uploading'} onClick={()=>openPriceList(doc.id).catch(e=>setError(e.message))}>{doc.file_name}</button>
      <span>{doc.status==='uploading'?'Upload incomplete':doc.status} · {doc.effective_date||'No effective date'}{doc.expires_on?` · expires ${doc.expires_on}`:''}</span>
      {doc.status!=='archived'&&<button className="btn btn-sm btn-secondary" disabled={busy} onClick={()=>archive(doc)}>Archive</button>}
    </div>)}
    <form onSubmit={search} style={{display:'flex',gap:8,marginTop:14}}><input className="form-input" aria-label="Search this vendor price lists" value={query} onChange={e=>setQuery(e.target.value)} placeholder="SKU or product keywords"/><button className="btn btn-primary" disabled={busy||!query.trim()}>Search</button></form>
    {result&&<PriceListResults result={result}/>}
  </div></section>;
}
