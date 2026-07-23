/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs } from './safeHelpers';
import { pantoneHex, pantoneSearch, THREAD_COLORS, threadHex, SZ_ORD, SC, ART_FILE_SC } from './constants';
// html2pdf is loaded on demand (see buildPdfAttachment below) to keep it out of the eager bundle.
import { sendBrevoEmail, _brevoKey, _smsUiEnabled, sendBrevoSms, cloudUpload, buildBrandedEmailHtml, _cloudinaryPdfThumb, _isImgUrl, _urlExt } from './utils';

// allowVector: when true the gallery also accepts vector (.ai/.eps/.svg) and .pdf
// artwork — used by the Topstar digitizing/Vector PO flow where production-ready
// vector/PDF files are the whole point. Non-image files upload via Cloudinary's
// "auto" resource type and preview through a rasterized page-1 PNG thumbnail.
const ImgGallery=({images=[],onUpdate,onError,maxImages=10,allowVector=false})=>{
  const[uploading,setUploading]=useState(false);const[drag,setDrag]=useState(false);
  const VECTOR_EXT=['ai','eps','svg','pdf'];
  const _accept=allowVector?'image/*,.ai,.eps,.svg,.pdf,application/pdf,application/postscript':'image/*';
  const _okFile=f=>{
    if(f.type&&f.type.startsWith('image/'))return true;
    if(!allowVector)return false;
    const ext=(f.name||'').split('.').pop().toLowerCase();
    return VECTOR_EXT.includes(ext)||f.type==='application/pdf'||f.type==='application/postscript';
  };
  // Source to render in a thumbnail tile: real images as-is, vector/PDF rasterized to PNG, else null (icon fallback).
  // When allowVector is off, behave exactly as before — render the url directly so image-only galleries don't regress.
  const _thumb=url=>!allowVector?url:(_isImgUrl(url)?url:_cloudinaryPdfThumb(url));
  const _noun=allowVector?'files':'images';
  const doUpload=async(files)=>{
    const ok=Array.from(files).filter(_okFile);
    if(ok.length===0){if(onError)onError(allowVector?'Please select image, PDF, or vector (.ai/.eps/.svg) files':'Please select image files');return}
    if((images||[]).length+ok.length>maxImages){if(onError)onError('Max '+maxImages+' '+_noun);return}
    setUploading(true);
    const newUrls=[];
    for(const f of ok){
      try{const u=await cloudUpload(f);newUrls.push(u)}catch(e){if(onError)onError('Upload failed: '+e.message)}
    }
    if(newUrls.length>0)onUpdate([...(images||[]),...newUrls]);
    setUploading(false);
  };
  const removeImg=(idx)=>onUpdate((images||[]).filter((_,i)=>i!==idx));
  const moveImg=(from,to)=>{const arr=[...(images||[])];const[item]=arr.splice(from,1);arr.splice(to,0,item);onUpdate(arr)};
  return<div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
      {(images||[]).map((url,i)=>{const prev=_thumb(url);const ext=(_urlExt(url)||'file').toUpperCase();return<div key={i} style={{width:72,height:72,borderRadius:6,border:'1px solid #e2e8f0',overflow:'hidden',position:'relative',background:'#f8fafc'}}>
        {prev?<img src={prev} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';e.target.nextSibling&&(e.target.nextSibling.style.display='flex')}}/>:null}
        <div style={{display:prev?'none':'flex',width:'100%',height:'100%',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,color:'#64748b'}}>
          <span style={{fontSize:18}}>{'📄'}</span>
          <span style={{fontSize:9,fontWeight:700}}>{ext}</span>
        </div>
        <div style={{position:'absolute',top:0,right:0,display:'flex',gap:1}}>
          {i>0&&<button style={{background:'rgba(0,0,0,0.5)',color:'white',border:'none',cursor:'pointer',fontSize:9,padding:'1px 3px',borderRadius:2}} onClick={()=>moveImg(i,i-1)}>\u25C0</button>}
          <button style={{background:'rgba(220,38,38,0.8)',color:'white',border:'none',cursor:'pointer',fontSize:10,padding:'1px 4px',borderRadius:2}} onClick={()=>removeImg(i)}>\u00D7</button>
        </div>
        <div style={{position:'absolute',bottom:0,left:0,background:'rgba(0,0,0,0.5)',color:'white',fontSize:8,padding:'1px 4px'}}>{i===0?'Primary':i+1}</div>
      </div>})}
    </div>
    <div style={{border:drag?'2px dashed #3b82f6':'2px dashed #d1d5db',borderRadius:8,padding:uploading?'8px':'12px 16px',textAlign:'center',
      background:drag?'#eff6ff':'#fafafa',cursor:'pointer',transition:'all 0.15s'}}
      onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);doUpload(e.dataTransfer.files)}}
      onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept=_accept;inp.multiple=true;inp.onchange=()=>doUpload(inp.files);inp.click()}}>
      {uploading?<span style={{fontSize:11,color:'#3b82f6',fontWeight:600}}>Uploading...</span>
      :<><div style={{fontSize:11,color:drag?'#2563eb':'#64748b',fontWeight:600}}>{drag?'Drop '+_noun+' here':'Click or drag & drop '+_noun}</div>
        <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>{(images||[]).length}/{maxImages} {_noun} \u00B7 {allowVector?'JPG, PNG, PDF, AI, EPS, SVG':'JPG, PNG, WebP'}</div></>}
    </div>
  </div>};

const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,copy:<><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sortDown:<path d="M7 10l5 5 5-5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,camera:<><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></>,scan:<><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></>,save:<><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,clock:<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,store:<><path d="M3 9l1.5-5.5A1 1 0 015.46 3h13.08a1 1 0 01.96.5L21 9"/><path d="M3 9v1a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0V9"/><path d="M5 13v7a1 1 0 001 1h12a1 1 0 001-1v-7"/><path d="M9 21v-5h6v5"/></>};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};

function Toast({msg,type='success'}){if(!msg)return null;return<div className={`toast toast-${type}`}>{msg}</div>}

function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}

function SearchSelect({options,value,onChange,placeholder}){const[open,setOpen]=useState(false);const[q,setQ]=useState('');const _toks=q.toLowerCase().split(/\s+/).filter(Boolean);const f=options.filter(o=>{const h=(o.label+' '+(o.searchText||'')).toLowerCase();return _toks.every(t=>h.includes(t))});const sel=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}><span style={{flex:1,color:sel?'#0f172a':'#94a3b8'}}>{sel?sel.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}><div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {f.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}{f.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}</div>}</div>)}

// Catalog product picker built on SearchSelect. Lets the user bind a row to a
// real catalog product by SKU/name/brand/color. Options are memoized so a table
// of these doesn't re-map the whole catalog on every keystroke. onPick receives
// the full product object (so callers can pull id/sku/name/color/pricing).
function ProductPicker({products,value,onPick,placeholder,searchProducts}){
  const opts=React.useMemo(()=>(products||[]).map(p=>({
    value:p.id,
    label:`${p.sku} — ${p.name||''}${p.color?' / '+p.color:''}`,
    searchText:[p.sku,p.name,p.brand,p.color].filter(Boolean).join(' '),
  })),[products]);
  return<SearchSelect options={opts} value={value||null}
    onChange={id=>{const p=(products||[]).find(pr=>pr.id===id);if(p&&onPick)onPick(p)}}
    placeholder={placeholder||'Search catalog SKU…'} />;
}

function Bg({options,value,onChange}){return<div style={{display:'flex',gap:2,flexWrap:'wrap'}}>{options.map(o=><button key={o.value} className={`btn btn-sm ${String(value)===String(o.value)?'btn-primary':'btn-secondary'}`} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}

function $In({value,onChange,w=70}){const[raw,setRaw]=React.useState(String(value));const[focused,setFocused]=React.useState(false);
  // Only sync the text box from the incoming value while it is NOT being edited.
  // For size-priced items the parent recomputes a rounded "avg" on every keystroke,
  // and syncing mid-edit would clobber what you're typing (e.g. typing 60 -> 6.50)
  // and snap a cleared field back to "0".
  React.useEffect(()=>{if(!focused&&parseFloat(raw)!==value)setRaw(String(value))},[value,focused]);return<span style={{display:'inline-flex',alignItems:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'2px 6px',background:'white'}}><span style={{fontSize:14,fontWeight:700,color:'#166534'}}>$</span><input value={raw} onFocus={()=>setFocused(true)} onChange={e=>{const v=e.target.value;if(!/^-?\d*\.?\d*$/.test(v))return;setRaw(v);if(v===''||v==='.'||v==='-')return;const n=parseFloat(v);if(!isNaN(n))onChange(n)}} onBlur={()=>{setFocused(false);const n=parseFloat(raw)||0;setRaw(String(n));onChange(n)}} style={{width:w,border:'none',outline:'none',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center',background:'transparent'}}/></span>}

function EmailBadge({e}){if(!e.email_status)return null;const s=e.email_status;return<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,padding:'2px 8px',borderRadius:10,background:s==='sent'?'#fef3c7':s==='opened'?'#dbeafe':'#dcfce7',color:s==='sent'?'#92400e':s==='opened'?'#1e40af':'#166534'}}>{s==='sent'?'✉️ Sent':s==='opened'?`👁️ Opened ${e.email_opened_at||''}`:`🔗 Viewed`}</span>}

function getAddrs(cu,all){const a=[];const add=(c,l)=>{if(c.shipping_address_line1||c.shipping_city)a.push({id:c.id,label:`${l}: ${c.shipping_address_line1||''} ${c.shipping_city||''}, ${c.shipping_state||''} ${c.shipping_zip||''}`.trim(),addr:`${c.shipping_address_line1||''} ${c.shipping_city||''}, ${c.shipping_state||''} ${c.shipping_zip||''}`.trim()})};
  const addAlts=(c)=>{(c.alt_billing_addresses||[]).filter(ab=>ab.type==='shipping'&&(ab.street||ab.city)).forEach((ab,i)=>{a.push({id:`${c.id}_alt_${i}`,label:`${ab.label||'Alt Shipping'}: ${ab.street||''} ${ab.city||''}, ${ab.state||''} ${ab.zip||''}`.trim(),addr:`${ab.street||''} ${ab.city||''}, ${ab.state||''} ${ab.zip||''}`.trim()})})};
  if(!cu)return a;add(cu,'Default');addAlts(cu);
  return a}

// Resolve the ship-to selected on an order/estimate (ship_to_id) into structured fields.
// Returns {name,text} for a custom free-text address, {name,street,city,state,zip} for an
// alternate shipping address (id format `${customerId}_alt_${i}` — see getAddrs above),
// or null when the order ships to the customer's default address.
function resolveOrderShipTo(o,cu){
  const id=o?.ship_to_id;
  if(!id||id==='default')return null;
  if(id==='custom')return o.ship_to_custom?{name:cu?.name||'',text:String(o.ship_to_custom)}:null;
  if(!cu)return null;
  const m=/_alt_(\d+)$/.exec(String(id));
  if(m&&String(id)===cu.id+'_alt_'+m[1]){
    const alts=(cu.alt_billing_addresses||[]).filter(ab=>ab.type==='shipping'&&(ab.street||ab.city));
    const ab=alts[parseInt(m[1],10)];
    if(ab)return{name:ab.label||cu.name||'',attention:ab.attention||'',street:ab.street||'',city:ab.city||'',state:ab.state||'',zip:ab.zip||''};
  }
  return null;
}

// <br/>-joined ship-to block for printed docs; '' when the order uses the customer default.
function orderShipToSub(o,cu){
  const sel=resolveOrderShipTo(o,cu);
  if(!sel)return'';
  if(sel.text)return sel.text.replace(/\n/g,'<br/>');
  const attn=sel.attention?'Attn: '+sel.attention:null;
  const cityLine=[sel.city,[sel.state,sel.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return[attn,sel.street,cityLine].filter(Boolean).join('<br/>');
}

// Default customer shipping address sub-block for printed docs (includes attention line).
function custShipAddrSub(cu){
  if(!cu)return'';
  const attn=cu.shipping_attention?'Attn: '+cu.shipping_attention:null;
  const l1=cu.shipping_address_line1||'';const l2=cu.shipping_address_line2||'';
  const cityLine=[cu.shipping_city,[(cu.shipping_state||''),(cu.shipping_zip||'')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return[attn,l1,l2,cityLine].filter(Boolean).join('<br/>');
}


// Shared control for scheduling AUTOMATED follow-up emails on a document
// (estimate / invoice / art). Controlled: value = {auto, firstDays, intervalDays,
// max, message}. When auto is on, the server (netlify/functions/followup-sweep.js)
// sends `message` + a portal link on the schedule until the doc resolves or the cap
// is hit. `defaultMessage` seeds the textarea the first time automation is enabled.
const _FU_DAYS=[1,2,3,5,7,10,14,21,30];
// Seed the panel from the doc row so a RE-send keeps whatever automation is already armed —
// without this, re-sending wrote the panel's default (off) back and silently disarmed the
// follow-ups the rep set up on the first send. Never-armed docs still get the off defaults.
const seedFollowUp=(doc)=>{const armed=!!doc?.follow_up_auto;const iv=Number(doc?.follow_up_interval_days)||0;
  return{auto:armed,firstDays:(armed&&iv)||3,intervalDays:armed?iv:0,max:doc?.follow_up_max||4,message:(armed&&doc?.follow_up_message)||''}};
function FollowUpAutoPanel({value,onChange,defaultMessage}){
  const v=value||{};const auto=!!v.auto;
  const first=v.firstDays||3;const interval=v.intervalDays||0;const max=v.max||4;
  const set=(patch)=>onChange({...v,...patch});
  const toggle=(checked)=>onChange({...v,auto:checked,message:(checked&&!v.message&&defaultMessage)?defaultMessage:v.message,firstDays:v.firstDays||3,max:v.max||4});
  const stopHint=/invoice/i.test(defaultMessage||'')?'the invoice is paid':/artwork|art/i.test(defaultMessage||'')?'the art is approved or rejected':'the estimate is approved';
  return(<div style={{padding:12,background:auto?'#faf5ff':'#f8fafc',border:'1px solid '+(auto?'#e9d5ff':'#e2e8f0'),borderRadius:8}}>
    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:auto?12:0}}>
      <input type="checkbox" checked={auto} onChange={e=>toggle(e.target.checked)} style={{width:16,height:16,accentColor:'#7c3aed'}}/>
      <span style={{fontWeight:700,fontSize:13,color:auto?'#6d28d9':'#64748b'}}>Automate follow-ups</span>
      <span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#ede9fe',color:'#6d28d9',fontWeight:600}}>Sends automatically</span>
    </label>
    {auto&&<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',fontSize:12,color:'#6d28d9',fontWeight:600}}>
        <span>Send first follow-up in</span>
        <select className="form-input" value={first} onChange={e=>set({firstDays:parseInt(e.target.value)})} style={{width:82,fontSize:12,padding:'4px 6px'}}>{_FU_DAYS.map(d=><option key={d} value={d}>{d} day{d>1?'s':''}</option>)}</select>
        <span>if no response</span>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',fontSize:12,color:'#6d28d9',fontWeight:600}}>
        <span>Then repeat</span>
        <select className="form-input" value={interval} onChange={e=>set({intervalDays:parseInt(e.target.value)})} style={{width:140,fontSize:12,padding:'4px 6px'}}><option value={0}>don't repeat</option>{_FU_DAYS.map(d=><option key={d} value={d}>every {d} day{d>1?'s':''}</option>)}</select>
        {interval>0&&<><span>up to</span><select className="form-input" value={max} onChange={e=>set({max:parseInt(e.target.value)})} style={{width:64,fontSize:12,padding:'4px 6px'}}>{[2,3,4,5,6,8,10].map(n=><option key={n} value={n}>{n}</option>)}</select><span>total</span></>}
      </div>
      <div>
        <div className="form-label" style={{fontSize:11,marginBottom:4,color:'#6d28d9'}}>Follow-up message <span style={{fontWeight:400,color:'#94a3b8'}}>(auto-sent — different from your first email; a portal link is added)</span></div>
        <textarea className="form-input" rows={4} value={v.message||''} onChange={e=>set({message:e.target.value})} style={{fontSize:12,resize:'vertical'}} placeholder="Hi, just following up..."/>
      </div>
      <div style={{fontSize:10,color:'#8b5cf6'}}>Stops automatically once {stopHint}.</div>
    </div>}
  </div>);
}

// SEND ESTIMATE MODAL

function SendModal({isOpen,onClose,estimate,customer,onSend,docType,buildAttachmentHtml,repUser,defaultFollowUpDays,companyInfo}){
  const[body,setBody]=useState('');const[attachments,setAttachments]=useState([]);
  const[checkedEmails,setCheckedEmails]=useState({});const[customEmails,setCustomEmails]=useState([]);const[addingEmail,setAddingEmail]=useState('');
  const[sending,setSending]=useState(false);const[dragOver,setDragOver]=useState(false);
  const[smsEnabled,setSmsEnabled]=useState(false);const[smsPhone,setSmsPhone]=useState('');const[smsMsg,setSmsMsg]=useState('');
  const[followUpDays,setFollowUpDays]=useState(0);
  const[followUp,setFollowUp]=useState({auto:false,firstDays:3,intervalDays:0,max:4,message:''});
  const contactEmails=[...new Set((customer?.contacts||[]).filter(c=>c.email).map(c=>c.email))];
  const allTargets=[...contactEmails,...customEmails].filter(em=>checkedEmails[em]);
  const label=docType==='so'?'Sales Order':'Estimate';
  const prevOpenRef=React.useRef(false);const sendingRef=React.useRef(false);
  // Use refs so the init effect doesn't re-run when parent re-renders (auto-save, realtime, polls)
  const customerRef=React.useRef(customer);customerRef.current=customer;
  const estimateRef=React.useRef(estimate);estimateRef.current=estimate;
  const docTypeRef=React.useRef(docType);docTypeRef.current=docType;
  const repUserRef=React.useRef(repUser);repUserRef.current=repUser;
  React.useEffect(()=>{if(isOpen&&!prevOpenRef.current){
    const cust2=customerRef.current;const est2=estimateRef.current;const dt=docTypeRef.current;
    const lbl=dt==='so'?'Sales Order':'Estimate';
    if(cust2){
    const emails=[...new Set((cust2?.contacts||[]).map(c=>c.email).filter(Boolean))];
    const primaryContact=(cust2.contacts||[])[0];
    // Greet by first name only — "Hi Jabari," not the full "Hi Jabari Carr," which reads too formal.
    const _firstName=(primaryContact?.name||'Coach').trim().split(/\s+/)[0]||'Coach';
    const initChecked={};emails.forEach(em=>{initChecked[em]=true});
    setCheckedEmails(initChecked);setCustomEmails([]);setAddingEmail('');
    const _signer=repUserRef.current?.name||'National Sports Apparel';
    // Deep-link the portal straight to this estimate (?est=<id>) / SO (?so=<id>)
    // instead of the portal home — the coach portal opens the matching view on load.
    const _dl=est2?.id?(dt==='so'?'&so='+est2.id:'&est='+est2.id):'';
    const portalLink=cust2?.alpha_tag?'https://nationalsportsapparel.com/coach?portal='+cust2.alpha_tag+_dl:'';
    setBody(`Hi ${_firstName},\n\nPlease find the attached ${lbl.toLowerCase()} for ${est2?.memo||'your order'}. You can view ${dt==='so'?'it':'and approve it'} through your portal.\n\nPortal link: ${portalLink||'https://nationalsportsapparel.com/coach?portal='+(cust2.alpha_tag||'')}\n\nLet me know if you have any questions!\n\n${_signer}\nNational Sports Apparel`);
    setSmsPhone(primaryContact?.phone||'');
    const portalUrl2=portalLink;
    setSmsMsg('Hi '+_firstName+', your '+lbl.toLowerCase()+' for '+(est2?.memo||'your order')+' is ready. View it here: '+portalUrl2);
    setSmsEnabled(_smsUiEnabled&&!!primaryContact?.phone);setFollowUpDays(0);
    setFollowUp(seedFollowUp(est2));
    setAttachments([]);setSending(false);sendingRef.current=false}}prevOpenRef.current=isOpen},[isOpen]);
  const handleFiles=(files)=>{const newFiles=Array.from(files).map(f=>({name:f.name,size:(f.size/1024).toFixed(0)+' KB',file:f}));setAttachments(a=>[...a,...newFiles])};
  const doSend=async()=>{
    if(sendingRef.current)return;// prevent double send
    const emails=allTargets;
    if(emails.length===0){alert('Please select at least one recipient');return}
    sendingRef.current=true;setSending(true);
    const subject=`National Sports ${label} - ${estimate?.id}${estimate?.memo?' - "'+estimate.memo+'"':''}`;
    const portalUrl=customer?.alpha_tag?'https://nationalsportsapparel.com/coach?portal='+customer.alpha_tag:'';
    const htmlBody=buildBrandedEmailHtml(body.replace(/\n/g,'<br/>'),companyInfo);
    if(_brevoKey){
      const toList=emails.map(e2=>({email:e2}));
      // Auto-attach estimate/SO as PDF
      const brevoAttachments=[];
      if(buildAttachmentHtml){try{
        const docHtml=buildAttachmentHtml();
        // Extract <style> and <body>, override flex→table for html2canvas compatibility
        const styleMatch=docHtml.match(/<style>([\s\S]*?)<\/style>/);
        const bodyMatch=docHtml.match(/<body>([\s\S]*?)<\/body>/);
        const pdfFixCss=`
          .header{display:table!important;width:100%!important;table-layout:fixed}
          .header>*{display:table-cell!important;vertical-align:top!important}
          .logo{width:55%!important;display:table-cell!important}
          .logo img{height:50px;vertical-align:middle;margin-right:8px;float:left}
          .doc-id{width:45%!important;display:table-cell!important;text-align:right!important}
          .bill-total{display:table!important;width:100%!important;table-layout:fixed}
          .bill-total>*{display:table-cell!important;vertical-align:top!important}
          .total-box{width:200px!important;text-align:left!important}
          .info-row{display:table!important;width:100%!important;table-layout:fixed}
          .info-cell{display:table-cell!important;vertical-align:top!important}
          .footer{display:table!important;width:100%!important}
          .footer>*{display:table-cell!important}
          .footer>*:last-child{text-align:right!important}
        `;
        const container=document.createElement('div');
        container.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:white;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4';
        const styleEl=document.createElement('style');
        styleEl.textContent=(styleMatch?styleMatch[1]:'')+pdfFixCss;
        container.appendChild(styleEl);
        const bodyDiv=document.createElement('div');bodyDiv.innerHTML=bodyMatch?bodyMatch[1]:docHtml;container.appendChild(bodyDiv);
        document.body.appendChild(container);
        await new Promise(r=>setTimeout(r,500));// allow images/fonts to load
        const _pdfName=(estimate?.id||'document')+(customer?.name?' - '+customer.name:'')+'.pdf';
        const html2pdf=(await import('html2pdf.js')).default;
        const pdfBlob=await html2pdf().set({margin:[0.4,0.4,0.4,0.4],filename:_pdfName,image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:'letter',orientation:'portrait'}}).from(bodyDiv).outputPdf('blob');
        document.body.removeChild(container);
        const pdfB64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(pdfBlob)});
        brevoAttachments.push({name:_pdfName,content:pdfB64});
      }catch(err){console.warn('Failed to build PDF attachment:',err)}}
      // Convert file attachments to base64 for Brevo
      for(const att of attachments){if(att.file){try{const b64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(att.file)});brevoAttachments.push({name:att.name,content:b64})}catch(err){console.warn('Failed to read attachment:',att.name,err)}}}
      const _fromEmail=(repUser?.email&&/@nationalsportsapparel\.com$/i.test(repUser.email))?repUser.email:'noreply@nationalsportsapparel.com';
      const res=await sendBrevoEmail({to:toList,subject,htmlContent:htmlBody,senderName:repUser?.name||'National Sports Apparel',senderEmail:_fromEmail,replyTo:repUser?.email?{email:repUser.email,name:repUser.name}:undefined,attachment:brevoAttachments.length>0?brevoAttachments:undefined});
      if(!res.ok){alert('Email send failed: '+(res.error||'Unknown error'));setSending(false);sendingRef.current=false;return}
      // Send SMS notification if enabled
      if(smsEnabled&&smsPhone){
        const smsRes=await sendBrevoSms({to:smsPhone,content:smsMsg.substring(0,160)});
        if(smsRes.ok){if(_notify)_notify('Text sent to '+smsPhone)}else{if(_notify)_notify('SMS failed: '+(smsRes.error||'Unknown'),'error');console.warn('SMS send failed:',smsRes.error)}
      }
      onSend({followUpDays,followUp:followUp.auto?followUp:null,toEmails:emails.join(', '),messageId:res.messageId});onClose();
    }else{
      const mailTo='mailto:'+emails[0]+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
      window.open(mailTo,'_blank');
      onSend({followUpDays,followUp:followUp.auto?followUp:null,toEmails:emails.join(', ')});onClose();
    }};
  if(!isOpen)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
    <div className="modal-header"><h2>Send {label}</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body">
      <div style={{marginBottom:12}}>
        <label className="form-label">To {allTargets.length>0&&<span style={{fontSize:11,fontWeight:400,color:'#64748b'}}>({allTargets.length} selected)</span>}</label>
        <div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:8,background:'#fafafa'}}>
          {contactEmails.length===0&&customEmails.length===0&&<div style={{fontSize:12,color:'#94a3b8',padding:'4px 8px'}}>No contacts on file — add an email below.</div>}
          {contactEmails.map(em=>{const ct=(customer?.contacts||[]).find(c=>c.email===em);return<label key={em} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 8px',borderRadius:6,background:checkedEmails[em]?'#dbeafe':'transparent',marginBottom:4}}>
            <input type="checkbox" checked={!!checkedEmails[em]} onChange={e=>setCheckedEmails(m=>({...m,[em]:e.target.checked}))} style={{width:14,height:14,accentColor:'#2563eb'}}/>
            <span style={{fontSize:12}}><strong>{ct?.name||'Contact'}</strong> — {em}{ct?.role?' ('+ct.role+')':''}</span>
          </label>})}
          {customEmails.map(em=><label key={em} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 8px',borderRadius:6,background:checkedEmails[em]?'#dbeafe':'transparent',marginBottom:4}}>
            <input type="checkbox" checked={!!checkedEmails[em]} onChange={e=>setCheckedEmails(m=>({...m,[em]:e.target.checked}))} style={{width:14,height:14,accentColor:'#2563eb'}}/>
            <span style={{fontSize:12}}>{em} <span style={{fontSize:10,color:'#64748b'}}>(added)</span></span>
            <button style={{marginLeft:'auto',background:'none',border:'none',color:'#94a3b8',cursor:'pointer',fontSize:14,padding:0}} onClick={()=>{setCustomEmails(arr=>arr.filter(x=>x!==em));setCheckedEmails(m=>{const c={...m};delete c[em];return c})}}>x</button>
          </label>)}
          <div style={{display:'flex',gap:6,marginTop:6}}>
            <input className="form-input" type="email" placeholder="+ Add another email..." value={addingEmail} onChange={e=>setAddingEmail(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&addingEmail.includes('@')){e.preventDefault();const em=addingEmail.trim();setCustomEmails(arr=>arr.includes(em)?arr:[...arr,em]);setCheckedEmails(m=>({...m,[em]:true}));setAddingEmail('')}}} style={{fontSize:12,flex:1}}/>
            <button className="btn btn-sm btn-secondary" disabled={!addingEmail.includes('@')} onClick={()=>{const em=addingEmail.trim();setCustomEmails(arr=>arr.includes(em)?arr:[...arr,em]);setCheckedEmails(m=>({...m,[em]:true}));setAddingEmail('')}}>Add</button>
          </div>
        </div>
      </div>
      <div style={{marginBottom:12}}><label className="form-label">Subject</label><input className="form-input" value={`National Sports ${label} - ${estimate?.id}${estimate?.memo?' - "'+estimate.memo+'"':''}`} readOnly style={{color:'#64748b'}}/></div>
      <div style={{marginBottom:12}}><label className="form-label">Message</label><textarea className="form-input" rows={8} value={body} onChange={e=>setBody(e.target.value)} style={{fontFamily:'inherit',resize:'vertical'}}/></div>
      <div style={{marginBottom:12}}><label className="form-label">Attachments</label>
        <div style={{border:'2px dashed '+(dragOver?'#3b82f6':'#d1d5db'),borderRadius:8,padding:16,textAlign:'center',cursor:'pointer',background:dragOver?'#eff6ff':'#fafafa',transition:'all 0.15s'}}
          onDragOver={e=>{e.preventDefault();e.stopPropagation();setDragOver(true)}}
          onDragLeave={e=>{e.preventDefault();e.stopPropagation();setDragOver(false)}}
          onDrop={e=>{e.preventDefault();e.stopPropagation();setDragOver(false);if(e.dataTransfer.files.length>0)handleFiles(e.dataTransfer.files)}}
          onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.onchange=()=>{if(inp.files.length>0)handleFiles(inp.files)};inp.click()}}>
          <Icon name="upload" size={20}/><div style={{fontSize:12,color:'#64748b',marginTop:4}}>Drag & drop files here or click to browse</div>
          <div style={{fontSize:10,color:'#94a3b8'}}>Include product photos, mockups, or other files</div></div>
        {attachments.length>0&&<div style={{marginTop:8}}>{attachments.map((f,i)=><div key={i} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 8px',background:'#f0fdf4',borderRadius:4,marginBottom:4}}>
          <Icon name="file" size={14}/><span style={{fontSize:12,flex:1}}>{f.name}</span><span style={{fontSize:10,color:'#94a3b8'}}>{f.size}</span>
          <button onClick={()=>setAttachments(a=>a.filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={12}/></button></div>)}</div>}
      </div>
      {/* SMS Toggle — hidden via _smsUiEnabled flag while SMS sending is unreliable */}
      {_smsUiEnabled&&<div style={{marginBottom:12,padding:12,background:smsEnabled?'#f0fdf4':'#f8fafc',border:'1px solid '+(smsEnabled?'#86efac':'#e2e8f0'),borderRadius:8}}>
        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:smsEnabled?10:0}}>
          <input type="checkbox" checked={smsEnabled} onChange={e=>setSmsEnabled(e.target.checked)} style={{width:16,height:16,accentColor:'#22c55e'}}/>
          <span style={{fontWeight:700,fontSize:13,color:smsEnabled?'#166534':'#64748b'}}>Also Text Coach</span>
          {_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600}}>Sends directly</span>}
        </label>
        {smsEnabled&&<div>
          <div style={{marginBottom:8}}><label className="form-label" style={{fontSize:11}}>Phone</label><input className="form-input" value={smsPhone} onChange={e=>setSmsPhone(e.target.value)} placeholder="Phone number" style={{fontSize:12}}/></div>
          <div><label className="form-label" style={{fontSize:11}}>Text Message <span style={{color:'#94a3b8',fontWeight:400}}>({smsMsg.length}/160)</span></label><textarea className="form-input" rows={2} value={smsMsg} onChange={e=>setSmsMsg(e.target.value)} maxLength={160} style={{fontSize:12,resize:'vertical'}}/></div>
        </div>}
      </div>}
      {/* Follow-ups — estimates get automated sends; sales orders keep the manual reminder */}
      {docType==='so'?(
        <div style={{marginBottom:12,padding:10,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>Follow up</span>
          {[1,3,7].map(d=><label key={d} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'#6d28d9',fontWeight:600}}>
            <input type="checkbox" checked={followUpDays===d} onChange={()=>setFollowUpDays(followUpDays===d?0:d)} style={{width:14,height:14,accentColor:'#6d28d9',cursor:'pointer'}}/>
            in {d} day{d>1?'s':''}
          </label>)}
          {followUpDays>0&&<span style={{fontSize:12,color:'#6d28d9'}}>if no response</span>}
        </div>
      ):(
        <div style={{marginBottom:12}}>
          <FollowUpAutoPanel value={followUp} onChange={setFollowUp} defaultMessage={`Hi ${(customer?.contacts||[])[0]?.name||'Coach'},\n\nJust following up on the ${label.toLowerCase()} we sent over${estimate?.memo?` for ${estimate.memo}`:''}. Let us know if you'd like to move forward or have any questions — we're happy to help!\n\n${repUser?.name||'National Sports Apparel'}\nNational Sports Apparel`}/>
        </div>
      )}
      <div style={{padding:8,background:'#dbeafe',borderRadius:6,fontSize:11,color:'#1e40af'}}>📎 {label} PDF will be auto-attached | 🔗 Portal link included in message{!_brevoKey&&' | ⚠️ No Brevo API key — will open email client instead'}</div>
    </div>
    <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={sending} onClick={doSend}><Icon name="send" size={14}/> {sending?'Sending...':'Send '+label}</button></div>
  </div></div>);
}

// UNIFIED ORDER EDITOR
// Auto-calculate SO status from items


function calcSOStatus(ord,opts){
  // A closed-out SO (final invoice, "Close Sales Order", promo close, or manual mark-complete) persists
  // status='complete'. That's a sticky terminal state — honor it everywhere the effective status is shown
  // so lists/dashboards don't recompute back to 'ready_to_invoice'. The SO detail page passes
  // {ignoreOverride:true} to get the pure auto-status that drives its "Reset to Auto" control.
  if(!opts?.ignoreOverride&&ord?.status==='complete')return'complete';
  // Promo orders skip the invoicing/fulfillment funnel — once Close Promo Order sets status='complete', honor it.
  if(ord?.promo_applied&&ord?.status==='complete')return'complete';
  // Booking orders stay in 'booking' status until confirmed or within alert threshold of ship date
  if(ord?.order_type==='booking'&&!ord.booking_confirmed){
    if(!ord.expected_ship_date)return'booking';
    const daysOut=Math.ceil((new Date(ord.expected_ship_date)-new Date())/(1000*60*60*24));
    const threshold=ord.booking_alert_days||100;
    if(daysOut>threshold)return'booking';
  }
  // Fully automatic SO status based on item + job state
  let totalSz=0,coveredSz=0,fulfilledSz=0;
  safeItems(ord).forEach(it=>{
    let entries=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0);
    // qty_only items hold their quantity in est_qty (sizes is empty); POs/picks track them under the 'QTY' key
    if(entries.length===0&&safeNum(it.est_qty)>0)entries=[['QTY',safeNum(it.est_qty)]];
    entries.forEach(([sz,v])=>{
      totalSz+=v;
      const picked=safePicks(it).reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const poOrd=safePOs(it).reduce((a,pk)=>a+safeNum(pk[sz])-safeNum((pk.cancelled||{})[sz]),0);
      coveredSz+=Math.min(v,picked+poOrd);
      const pulledQty=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const rcvdQty=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
      fulfilledSz+=Math.min(v,pulledQty+rcvdQty);
    });
  });
  if(totalSz===0)return'need_order';
  // Check jobs on the board (exclude drafts from status calculation)
  const boardJobs=safeJobs(ord).filter(j=>j.prod_status!=='draft');
  const hasJobs=boardJobs.length>0;
  const allJobsShipped=hasJobs&&boardJobs.every(j=>j.prod_status==='shipped');
  const allJobsDone=hasJobs&&boardJobs.every(j=>j.prod_status==='completed'||j.prod_status==='shipped');
  const anyJobActive=hasJobs&&boardJobs.some(j=>j.prod_status==='staging'||j.prod_status==='in_process');
  // Check if SO has any deco at all
  const hasAnyDeco=safeItems(ord).some(it=>!it.no_deco&&safeDecos(it).length>0);
  // Promo orders skip invoicing — go straight to complete when ready
  const isPromo=ord.promo_applied;
  // If all jobs shipped → check if all units actually shipped before marking complete
  if(allJobsShipped){
    const totalJobUnits=boardJobs.reduce((a,j)=>a+safeNum(j.total_units),0);
    const shippedUnits=(ord._shipments||[]).reduce((a,shp)=>a+(shp.items||[]).reduce((a2,it)=>a2+Object.values(it.sizes||{}).reduce((a3,v)=>a3+safeNum(v),0),0),0);
    if(shippedUnits>=totalJobUnits||!ord._shipments)return'complete';
    // Partial shipment — jobs marked shipped but units remain
    return isPromo?'complete':'ready_to_invoice';
  }
  // Delivery-preference orders: delivery is the terminal fulfillment step (the equivalent of
  // shipping). Once production is done, all goods are in, and every deliverable is marked in the
  // delivered map, the order is complete — it never passes through a 'shipped' job state.
  const isDeliveryPref=ord.ship_preference==='warehouse_delivery'||ord.ship_preference==='deliver_on_date';
  if(isDeliveryPref){
    const dlv=ord.delivered||{};
    const noActiveJobs=!hasJobs||allJobsDone;
    const allJobsDelivered=boardJobs.every(j=>dlv['job|'+j.id]);
    const noDecoDelivered=safeItems(ord).every((it,idx)=>{
      if(!it.no_deco&&safeDecos(it).length>0)return true;
      const units=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
      return units<=0||!!dlv['nd|'+idx];
    });
    if(noActiveJobs&&fulfilledSz>=totalSz&&allJobsDelivered&&noDecoDelivered)return'complete';
  }
  // No-deco orders: all items fulfilled → ready_to_invoice (or complete for promo)
  if(!hasAnyDeco&&!hasJobs&&fulfilledSz>=totalSz)return(ord.status==='complete'||isPromo)?'complete':'ready_to_invoice';
  // If all jobs completed → ready to invoice (or complete for promo)
  if(allJobsDone)return isPromo?'complete':'ready_to_invoice';
  // If any job in staging or in_process → in production
  if(anyJobActive)return'in_production';
  // If picks exist but not yet pulled → needs_pull
  const hasPendingPull=safeItems(ord).some(it=>safePicks(it).some(pk=>pk.status==='pick'));
  if(hasPendingPull)return'needs_pull';
  // If all items received → items_received
  if(fulfilledSz>=totalSz)return'items_received';
  // If all items covered (ordered/picked) but not all received → waiting
  if(coveredSz>=totalSz)return'waiting_receive';
  // Otherwise still need to order
  return'need_order';
}

// ═══════════════════════════════════════════════
// LOGIN GATE — click to login
// ═══════════════════════════════════════════════


// PANTONE COLOR ADDER — search + add Pantone colors with swatch preview

function PantoneAdder({onAdd,existingCodes=[]}){
  const[q,setQ]=useState('');const[results,setResults]=useState([]);
  const onChange=(v)=>{setQ(v);if(v.length>=1){setResults(pantoneSearch(v))}else{setResults([])}};
  const add=(code,hex)=>{if(existingCodes.some(c=>c.toUpperCase()===code.toUpperCase()))return;onAdd({code,hex});setQ('');setResults([])};
  return<div style={{display:'flex',gap:6,alignItems:'center'}}>
    <div style={{position:'relative',flex:1,maxWidth:220}}>
      <input className="form-input" value={q} onChange={e=>onChange(e.target.value)} placeholder="PMS number or color name..." style={{fontSize:12}}/>
      {results.length>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:50,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',maxHeight:240,overflowY:'auto',marginTop:2}}>
        {results.map(r=>{const exists=existingCodes.some(c=>c.toUpperCase()===r.code.toUpperCase());return<button key={r.code} onClick={()=>add(r.code,r.hex)} disabled={exists}
          style={{display:'flex',gap:8,alignItems:'center',padding:'6px 10px',width:'100%',border:'none',background:'white',cursor:exists?'default':'pointer',fontSize:12,textAlign:'left',opacity:exists?0.4:1}}
          onMouseOver={e=>{if(!exists)e.currentTarget.style.background='#f1f5f9'}} onMouseOut={e=>e.currentTarget.style.background='white'}>
          <div style={{width:18,height:18,borderRadius:3,background:r.hex,border:'1px solid #d1d5db',flexShrink:0}}/>
          <span style={{fontWeight:600}}>PMS {r.code}</span>
        </button>})}
      </div>}
    </div>
    <button onClick={()=>{const code=q.replace(/^PMS\s*/i,'').trim();if(code&&!existingCodes.some(c=>c.toUpperCase()===code.toUpperCase()))add(code,pantoneHex(code)||'#cccccc')}} className="btn btn-sm btn-secondary" style={{fontSize:11,flexShrink:0}}>+ Add</button>
  </div>}

// Pantone quick-pick chips — reusable inline component for CW ink inputs

function PantoneQuickPicks({colors,onPick}){
  if(!colors||colors.length===0)return null;
  return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:3,marginBottom:2}}>
    {colors.map((pc,i)=>{const hex=pantoneHex(pc.code)||pc.hex||'#ccc';
      return<button key={i} onClick={()=>onPick('PMS '+pc.code)} title={(pc.name?pc.name+' — ':'')+'PMS '+pc.code}
        style={{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 6px',background:'white',border:'1px solid #e2e8f0',borderRadius:4,cursor:'pointer',fontSize:10,color:'#475569',fontWeight:500}}
        onMouseOver={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.borderColor='#2563eb'}} onMouseOut={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e2e8f0'}}>
        <span style={{width:10,height:10,borderRadius:2,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
        {pc.name||('PMS '+pc.code)}
      </button>})}
  </div>}

// Thread color adder — searchable dropdown with swatch preview (like PantoneAdder but for threads)

function ThreadAdder({onAdd,existingNames=[]}){
  const[q,setQ]=useState('');const[results,setResults]=useState([]);const[focused,setFocused]=useState(false);
  const onChange=(v)=>{setQ(v);if(v.length>=1){
    const s=v.toLowerCase();
    const matches=Object.entries(THREAD_COLORS).filter(([k])=>k.includes(s)).slice(0,15).map(([name,hex])=>({name:name.charAt(0).toUpperCase()+name.slice(1),hex}));
    setResults(matches);
  }else{
    // Show all colors when empty and focused
    setResults(Object.entries(THREAD_COLORS).slice(0,20).map(([name,hex])=>({name:name.charAt(0).toUpperCase()+name.slice(1),hex})));
  }};
  const add=(name,hex)=>{if(existingNames.some(n=>n.toLowerCase()===name.toLowerCase()))return;onAdd({name,hex});setQ('');setResults([])};
  return<div style={{position:'relative',display:'flex',gap:6,alignItems:'center'}}>
    <div style={{position:'relative',flex:1,maxWidth:220}}>
      <input className="form-input" value={q} onChange={e=>onChange(e.target.value)} onFocus={()=>{setFocused(true);if(!q)onChange('')}} onBlur={()=>setTimeout(()=>setFocused(false),200)} placeholder="Search thread color..." style={{fontSize:12}}/>
      {(results.length>0&&focused)&&<div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:50,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',maxHeight:240,overflowY:'auto',marginTop:2}}>
        {results.map(r=>{const exists=existingNames.some(n=>n.toLowerCase()===r.name.toLowerCase());return<button key={r.name} onClick={()=>add(r.name,r.hex)} disabled={exists}
          style={{display:'flex',gap:8,alignItems:'center',padding:'6px 10px',width:'100%',border:'none',background:'white',cursor:exists?'default':'pointer',fontSize:12,textAlign:'left',opacity:exists?0.4:1}}
          onMouseOver={e=>{if(!exists)e.currentTarget.style.background='#f5f3ff'}} onMouseOut={e=>e.currentTarget.style.background='white'}>
          <div style={{width:18,height:18,borderRadius:3,background:r.hex,border:'1px solid #d1d5db',flexShrink:0}}/>
          <span style={{fontWeight:600}}>{r.name}</span>
          {exists&&<span style={{fontSize:9,color:'#94a3b8'}}>added</span>}
        </button>})}
      </div>}
    </div>
    <button onClick={()=>{const name=q.trim();if(name&&!existingNames.some(n=>n.toLowerCase()===name.toLowerCase()))add(name,threadHex(name)||'#cccccc')}} className="btn btn-sm btn-secondary" style={{fontSize:11,flexShrink:0}}>+ Add</button>
  </div>}

// Thread color quick-pick chips for embroidery CW inputs

function ThreadQuickPicks({colors,onPick}){
  if(!colors||colors.length===0)return null;
  return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:3,marginBottom:2}}>
    {colors.map((tc,i)=>{const hex=threadHex(tc.name)||tc.hex||'#ccc';
      return<button key={i} onClick={()=>onPick(tc.name)} title={tc.name}
        style={{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 6px',background:'white',border:'1px solid #e2e8f0',borderRadius:4,cursor:'pointer',fontSize:10,color:'#475569',fontWeight:500}}
        onMouseOver={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.borderColor='#7c3aed'}} onMouseOut={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e2e8f0'}}>
        <span style={{width:10,height:10,borderRadius:2,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
        {tc.name}
      </button>})}
  </div>}

// Color Ways editor — garment color + per-garment ink/thread list. Shared by the order
// art library (OrderEditor) and the customer art library (CustDetail) so the UI stays in
// sync. `onChange` receives the full updated color_ways array. Garment/ink swatches are a
// best-effort lookup (threadHex covers common apparel + thread names, pantoneHex for inks).

function ColorWaysEditor({colorWays,onChange,decoType,pantoneColors=[],threadColors=[],suppressWarning=false}){
  const isEmb=decoType==='embroidery';
  const isDtf=decoType==='dtf';
  const cws=colorWays||[];
  const inkLabel=isEmb?'thread':'ink';
  const updCw=(ci,patch)=>onChange(cws.map((cw,x)=>x===ci?{...cw,...patch}:cw));
  const addInk=(ci,v)=>{const inks=[...(cws[ci].inks||[])];const e=inks.findIndex(x=>!x);if(e>=0)inks[e]=v;else inks.push(v);updCw(ci,{inks})};
  return<div>
    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
      <span style={{fontSize:10,fontWeight:700,color:'#475569',letterSpacing:0.3}}>COLOR WAYS</span>
      <span style={{fontSize:9,color:'#94a3b8'}}>{isDtf?'Full-color — color ways optional':isEmb?'Thread colors per garment':'Ink colors per garment'}</span>
      {cws.length>0&&<span style={{fontSize:9,fontWeight:700,color:'#fff',background:'#94a3b8',borderRadius:8,padding:'0 7px',lineHeight:'16px'}}>{cws.length}</span>}
    </div>
    {cws.length===0&&isDtf&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#64748b',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,padding:'7px 10px',marginBottom:8,fontWeight:600}}>DTF prints full-color (CMYK) — no color ways needed. Add one only to note a specific garment color.</div>}
    {cws.length===0&&!isDtf&&!suppressWarning&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#b45309',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,padding:'7px 10px',marginBottom:8,fontWeight:600}}>⚠ Add at least one color way to specify the {inkLabel} colors for each garment color.</div>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
      {cws.map((cw,ci)=>{
        const gHex=threadHex(cw.garment_color);
        const inkCount=(cw.inks||[]).filter(x=>x&&x.trim()).length;
        return<div key={cw.id} style={{flex:'1 1 240px',minWidth:240,maxWidth:380,background:'white',border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
          {/* Header bar — CW number, garment color swatch + name, duplicate, remove */}
          <div style={{display:'flex',gap:6,alignItems:'center',padding:'8px 10px',background:'#f8fafc',borderBottom:'1px solid #eef2f6'}}>
            <span style={{fontSize:10,fontWeight:800,color:'#fff',background:'#475569',borderRadius:6,padding:'2px 7px',flexShrink:0}}>CW {ci+1}</span>
            <span title={cw.garment_color||'Set garment color'} style={{width:16,height:16,borderRadius:4,flexShrink:0,border:'1px solid #cbd5e1',background:gHex||'repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#e2e8f0 3px,#e2e8f0 6px)'}}/>
            <input className="form-input" value={cw.garment_color||''} onChange={e=>updCw(ci,{garment_color:e.target.value})} placeholder="Garment color..." style={{fontSize:12,fontWeight:600,flex:1,padding:'4px 8px'}}/>
            <button onClick={()=>onChange([...cws.slice(0,ci+1),{...cw,id:'cw'+Date.now(),inks:[...(cw.inks||[])],garment_color:''},...cws.slice(ci+1)])} title="Duplicate this color way (same colors, new garment)" style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:2,display:'flex'}}><Icon name="copy" size={13}/></button>
            <button onClick={()=>onChange(cws.filter((_,x)=>x!==ci))} title="Remove color way" style={{background:'none',border:'none',cursor:'pointer',color:'#ef4444',padding:2,display:'flex'}}><Icon name="trash" size={13}/></button>
          </div>
          {/* Ink/thread list */}
          <div style={{padding:'8px 10px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:0.3}}>{isEmb?'Thread colors':'Ink colors'}</span>
              <span style={{fontSize:9,color:'#94a3b8'}}>{inkCount} color{inkCount===1?'':'s'}</span>
            </div>
            {(cw.inks||[]).map((ink,ii)=>{const hex=isEmb?threadHex(ink):(pantoneHex(ink)||threadHex(ink));return<div key={ii} style={{display:'flex',gap:5,alignItems:'center',marginBottom:4}}>
              <span style={{fontSize:10,color:'#cbd5e1',width:12,textAlign:'right',flexShrink:0}}>{ii+1}</span>
              <span style={{width:14,height:14,borderRadius:3,flexShrink:0,border:'1px solid #d1d5db',background:hex||'#f1f5f9'}}/>
              <input className="form-input" value={ink} onChange={e=>{const inks=[...(cw.inks||[])];inks[ii]=e.target.value;updCw(ci,{inks})}} placeholder={isEmb?'Thread color...':'Ink color...'} style={{fontSize:11,flex:1,padding:'4px 8px'}}/>
              <button onClick={()=>updCw(ci,{inks:(cw.inks||[]).filter((_,x)=>x!==ii)})} title="Remove color" style={{background:'none',border:'none',cursor:'pointer',color:'#cbd5e1',padding:2,display:'flex'}} onMouseOver={e=>e.currentTarget.style.color='#ef4444'} onMouseOut={e=>e.currentTarget.style.color='#cbd5e1'}><Icon name="x" size={11}/></button>
            </div>})}
            {isEmb?<ThreadQuickPicks colors={threadColors} onPick={v=>addInk(ci,v)}/>:<PantoneQuickPicks colors={pantoneColors} onPick={v=>addInk(ci,v)}/>}
            <button onClick={()=>updCw(ci,{inks:[...(cw.inks||[]),'']})} style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'#2563eb',padding:'4px 0',fontWeight:600}}>+ Add {inkLabel} color</button>
          </div>
        </div>})}
    </div>
    <button onClick={()=>onChange([...cws,{id:'cw'+Date.now(),garment_color:'',inks:['']}])} style={{display:'inline-flex',alignItems:'center',gap:5,background:'#eff6ff',border:'1px dashed #93c5fd',borderRadius:8,cursor:'pointer',fontSize:11,color:'#1d4ed8',padding:'7px 14px',fontWeight:700}}><Icon name="plus" size={12}/> Add Color Way</button>
  </div>}

export { Icon, Toast, SortHeader, SearchSelect, ProductPicker, Bg, $In, EmailBadge, getAddrs, resolveOrderShipTo, orderShipToSub, custShipAddrSub, calcSOStatus, SendModal, FollowUpAutoPanel, seedFollowUp, PantoneAdder, PantoneQuickPicks, ThreadAdder, ThreadQuickPicks, ImgGallery, ColorWaysEditor };
