import React,{useEffect,useRef,useState} from 'react';
import './VendorPriceLists.css';
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
  useEffect(()=>{let active=true;setLoading(true);setDocs([]);setResult(null);setError('');setStatus('');setQuery('');setEffective('');setExpires('');priceListCall('list',{vendor_id:vendor.id}).then(r=>{if(active)setDocs(r.documents);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[vendor.id]);
  const uploadLock=useRef(false);
  const [dragging,setDragging]=useState(false),[loading,setLoading]=useState(true);
  async function uploadFiles(files){
    if(busy||uploadLock.current||!files?.length)return;
    setError('');setStatus('');
    if(files.length!==1){setError('Upload one price list at a time.');return;}
    const file=files[0];
    if(!/\.(pdf|xlsx?)$/i.test(file.name)){setError('Choose a PDF, XLS or XLSX file.');return;}
    if(!file.size||file.size>20*1024*1024){setError('Choose a nonempty file up to 20 MB.');return;}
    if(effective&&expires&&expires<effective){setError('Expiry date must be on or after the effective date.');return;}
    uploadLock.current=true;setBusy(true);setStatus(`Reading ${file.name}…`);try{await uploadPriceList(vendor.id,file,{effective_date:effective,expires_on:expires},setStatus);await refresh();setResult(null);setStatus('Price list is searchable. Archive an older file below if this replaces it.');}catch(e){setError(e.message);setStatus('');}finally{uploadLock.current=false;setBusy(false);}}
  async function archive(doc){if(!window.confirm(`Archive ${doc.file_name}? It will no longer appear in assistant searches.`))return;setBusy(true);setError('');try{await priceListCall('archive',{id:doc.id});await refresh();setResult(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function search(e){e.preventDefault();setBusy(true);setError('');try{setResult(await priceListCall('search',{query,vendor_id:vendor.id}));}catch(err){setError(err.message);}finally{setBusy(false);}}
  const today=new Date().toISOString().slice(0,10);
  function availability(doc){
    if(doc.status==='archived')return 'Archived';
    if(doc.status!=='ready')return 'Upload incomplete';
    if(doc.effective_date&&doc.effective_date>today)return 'Scheduled';
    if(doc.expires_on&&doc.expires_on<today)return 'Expired';
    return 'Searchable';
  }
  return <section className="card vpl" aria-label="Vendor price lists"><div className="card-body">
    <header className="vpl-heading"><div><h3>Price lists</h3><p>Find vendor pricing by SKU or product name. No catalog required.</p></div><span className="vpl-count">{docs.filter(d=>availability(d)==='Searchable').length} searchable</span></header>
    <div className="vpl-layout">
      <div className="vpl-library">
        <form onSubmit={search} className="vpl-search"><label htmlFor={`price-search-${vendor.id}`}>Search {vendor.name} pricing</label><div><input id={`price-search-${vendor.id}`} className="form-input" aria-label="Search this vendor price lists" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Enter a SKU or product keywords"/><button className="btn btn-primary" disabled={busy||!query.trim()}>Search</button></div></form>
        <div className="vpl-files-title">Uploaded files <span>{docs.length}</span></div>
        {loading&&<p role="status">Loading price lists…</p>}
        {!loading&&!docs.length&&!error&&<div className="vpl-empty">No price list uploaded. Add a PDF or Excel file to search this vendor’s pricing.</div>}
        {docs.map(doc=><article key={doc.id} className="vpl-file">
          <span className="vpl-file-type" aria-hidden="true">{doc.file_name.split('.').pop().toUpperCase()}</span>
          <div className="vpl-file-info"><button className="vpl-filename" disabled={busy||doc.status==='uploading'} onClick={()=>openPriceList(doc.id).catch(e=>setError(e.message))} title="Open original price list">{doc.file_name}</button>
            <div className="vpl-meta">{doc.file_size?`${Math.ceil(doc.file_size/1024)} KB · `:''}{doc.effective_date?`Effective ${doc.effective_date}`:'No effective date'}{doc.expires_on?` · Expires ${doc.expires_on}`:''}</div>
            <span className={`vpl-badge ${availability(doc)==='Searchable'?'vpl-ready':''}`}>{availability(doc)}</span>
          </div>
          {doc.status!=='archived'&&<button className="btn btn-sm btn-secondary" disabled={busy} onClick={()=>archive(doc)} aria-label={`Archive ${doc.file_name}`}>Archive</button>}
        </article>)}
        <p className="vpl-hint">Open a filename to view the original. Archive older lists when replacing them.</p>
      </div>
      <aside className="vpl-upload">
        <h4>Add a price list</h4>
        <div className={`vpl-dropzone ${dragging?'vpl-dragging':''} ${busy?'vpl-disabled':''}`} data-testid="price-list-dropzone"
          onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}}
          onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);}}
          onDrop={e=>{e.preventDefault();setDragging(false);uploadFiles(e.dataTransfer.files);}}>
          <span className="vpl-upload-icon" aria-hidden="true">↑</span><strong>{busy?'Processing price list…':dragging?'Drop your file here':'Drag & drop a price list'}</strong>
          <span>PDF, XLS or XLSX · up to 20 MB</span>
          <label className="vpl-browse">Browse files<input aria-label="Upload vendor price list" type="file" accept=".pdf,.xls,.xlsx" disabled={busy} onChange={e=>{uploadFiles(e.target.files);e.target.value='';}}/></label>
        </div>
        <details className="vpl-dates"><summary>Set dates <span>Optional · applies to next upload</span></summary><div>
          <label>Effective date<input aria-label="Price list effective date" className="form-input" type="date" value={effective} onChange={e=>setEffective(e.target.value)} disabled={busy}/></label>
          <label>Expires on<input aria-label="Price list expiry date" className="form-input" type="date" min={effective||undefined} value={expires} onChange={e=>setExpires(e.target.value)} disabled={busy}/></label>
        </div><p>Future and expired lists stay on file but are excluded from search.</p></details>
        <p className="vpl-hint">Scanned PDFs are read automatically. Keep this tab open while processing and verify OCR prices against the original.</p>
      </aside>
    </div>
    {status&&<p role="status" className="vpl-notice">{status}</p>}{error&&<p role="alert" className="vpl-error">{error}</p>}
    {result&&<div className="vpl-results"><h4>Search results</h4><PriceListResults result={result}/></div>}
    <footer className="vpl-help"><strong>Use it in the portal assistant</strong><p>Ask: “Search {vendor.name}’s price list for [SKU or product].” Results include the source file and page or spreadsheet rows. Prices do not automatically update products or orders. Synced stock is available for Adidas and Under Armour; other vendor availability must be confirmed.</p></footer>
  </div></section>;
}
