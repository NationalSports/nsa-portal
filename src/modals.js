/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { _pick, SZ_ORD, SC, pantoneHex, threadHex, CATEGORIES, COLOR_CATEGORIES } from './constants';
import { safeNum, safeItems, safeSizes, safeArr, safeStr, safeDecos } from './safeHelpers';
import { Icon, Bg, calcSOStatus, SortHeader, PantoneAdder, SearchSelect } from './components';
import { CONTACT_ROLES } from './pricing';
import { invokeEdgeFn, getBillingContacts } from './utils';

function VendDetail({vendor,products,onUpdateProducts,onBack}){
  const[syncing,setSyncing]=React.useState(false);
  const syncSSPricing=async()=>{
    if(!products||syncing)return;
    setSyncing(true);
    try{
      // Find products belonging to this vendor
      const vendProds=products.filter(p=>p.vendor_id===vendor.id);
      if(!vendProds.length){alert('No products found for this vendor in catalog.\n\nS&S items added via live search get pricing automatically — no sync needed.');setSyncing(false);return}
      const uniqueSkus=[...new Set(vendProds.map(p=>p.sku))];
      let updated=0;const changes=[];const errors=[];const _costUpdates=new Map();
      for(let i=0;i<uniqueSkus.length;i++){
        const sku=uniqueSkus[i];
        try{
          // Rate limit
          if(i>0)await new Promise(r=>setTimeout(r,1200));
          let data;
          try{
            let sid=null;
            try{const st=await ssApiCall('/Styles?style='+encodeURIComponent(sku));const sa=Array.isArray(st)?st:st?[st]:[];if(sa.length>0)sid=sa[0].styleID}catch(e){}
            if(sid){data=await ssApiCall('/Products?styleID='+encodeURIComponent(sid))}
            else{data=await ssApiCall('/Products?style='+encodeURIComponent(sku))}
          }catch(e){
            try{const padded=sku.length<5&&/^\d+$/.test(sku)?sku.padStart(5,'0'):sku;data=await ssApiCall('/Products?style='+encodeURIComponent(padded))}
            catch(e2){errors.push(sku+': not found on S&S');continue}
          }
          const items=Array.isArray(data)?data:data?[data]:[];
          const prices=items.map(it=>parseFloat(it.customerPrice)||parseFloat(it.piecePrice)||0).filter(p=>p>0);
          if(!prices.length)continue;
          const newCost=Math.min(...prices);
          vendProds.filter(p=>p.sku===sku).forEach(prod=>{
            if(Math.abs((prod.nsa_cost||0)-newCost)>0.005){
              changes.push(sku+': $'+(prod.nsa_cost||0).toFixed(2)+' → $'+newCost.toFixed(2));
              _costUpdates.set(prod.id,newCost);updated++;
            }
          });
        }catch(err){errors.push(sku+': '+err.message)}
      }
      // Update products state immutably
      if(updated>0&&onUpdateProducts){
        onUpdateProducts(prev=>prev.map(p=>_costUpdates.has(p.id)?{...p,nsa_cost:_costUpdates.get(p.id)}:p));
      }
      alert('S&S Pricing Sync Complete\n\nSKUs checked: '+uniqueSkus.length+'\nPrices updated: '+updated+(changes.length?'\n\nChanges:\n'+changes.join('\n'):'')+(errors.length?'\n\nErrors:\n'+errors.join('\n'):''));
    }catch(e){alert('Sync failed: '+e.message)}finally{setSyncing(false)}
  };
  return(<div><button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Vendors</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="package" size={28}/></div>
  <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{vendor.name}</span><span className={`badge ${vendor.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{vendor.vendor_type==='api'?'API':'Upload'}</span><span className="badge badge-gray">{vendor.payment_terms?.replace('net','Net ')}</span>{vendor.nsa_carries_inventory&&<span className="badge badge-green">Stock</span>}</div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{vendor.contact_email} {vendor.rep_name&&`| Rep: ${vendor.rep_name}`}</div>{vendor.notes&&<div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{vendor.notes}</div>}</div>
  {(vendor._it||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>OWED</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${vendor._it.toLocaleString()}</div></div>}
  {vendor.api_provider==='ss_activewear'&&<div style={{display:'flex',gap:6,marginTop:8}}>
    <button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:10,border:'none'}} onClick={async()=>{try{await testSSConnection();alert('S&S API connection successful!')}catch(e){alert('S&S API connection failed: '+e.message)}}}>Test API</button>
    <button className="btn btn-sm" style={{background:'#2563eb',color:'white',fontSize:10,border:'none',opacity:syncing?0.5:1}} disabled={syncing} onClick={syncSSPricing}>{syncing?'Syncing...':'Sync Pricing Now'}</button>
  </div>}
  {vendor.api_provider==='sanmar'&&<div style={{display:'flex',gap:6,marginTop:8}}>
    <button className="btn btn-sm" style={{background:'#0891b2',color:'white',fontSize:10,border:'none'}} onClick={async()=>{try{await testSanMarConnection();alert('SanMar API connection successful!')}catch(e){alert('SanMar API connection failed: '+e.message)}}}>Test API</button>
    <button className="btn btn-sm" style={{background:'#0e7490',color:'white',fontSize:10,border:'none',opacity:syncing?0.5:1}} disabled={syncing} onClick={async()=>{
      setSyncing(true);
      try{
        const vendProds=products.filter(p=>p.vendor_id===vendor.id);
        const uniqueSkus=[...new Set(vendProds.map(p=>p.sku))];
        let updated=0;const changes=[];const errors=[];const _costUpdates=new Map();
        for(let i=0;i<uniqueSkus.length;i++){
          const sku=uniqueSkus[i];
          try{
            if(i>0)await new Promise(r=>setTimeout(r,500));
            const prData=await sanmarGetPricing(sku,'','');
            const prItems=prData?.items||[];
            const prices=prItems.map(it=>parseFloat(it.piecePrice||it.price||0)).filter(p=>p>0);
            if(!prices.length)continue;
            const newCost=Math.min(...prices);
            const matching=vendProds.filter(p=>p.sku===sku);
            for(const prod of matching){
              if(Math.abs((prod.nsa_cost||0)-newCost)>0.005){
                changes.push(sku+': $'+(prod.nsa_cost||0).toFixed(2)+' → $'+newCost.toFixed(2));
                _costUpdates.set(prod.id,newCost);updated++;
              }
            }
          }catch(e){errors.push(sku+': '+e.message)}
        }
        if(updated>0&&onUpdateProducts){
          onUpdateProducts(prev=>prev.map(p=>_costUpdates.has(p.id)?{...p,nsa_cost:_costUpdates.get(p.id)}:p));
        }
        alert('SanMar Pricing Sync Complete\n\nSKUs checked: '+uniqueSkus.length+'\nPrices updated: '+updated+(changes.length?'\n\nChanges:\n'+changes.join('\n'):'')+(errors.length?'\n\nErrors:\n'+errors.join('\n'):''));
      }catch(e){alert('Sync failed: '+e.message)}finally{setSyncing(false)}
    }}>{syncing?'Syncing...':'Sync Pricing Now'}</button>
  </div>}
  </div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Invoices</div><div className="stat-value">{vendor._oi||0}</div></div><div className="stat-card"><div className="stat-label">Current</div><div className="stat-value" style={{color:'#166534'}}>${(vendor._ac||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">30 Day</div><div className="stat-value" style={{color:(vendor._a3||0)>0?'#d97706':''}}>${(vendor._a3||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">60+</div><div className="stat-value" style={{color:(vendor._a6||0)>0?'#dc2626':''}}>${((vendor._a6||0)+(vendor._a9||0)).toLocaleString()}</div></div></div>
  <div className="card"><div className="card-header"><h2>Purchase Orders</h2></div><div className="card-body"><div className="empty">PO tracking — Phase 4</div></div></div></div>)}


// ─── TAXCLOUD SETTINGS COMPONENT ───

function TaxCloudSettings({supabase,nf,cust,setCust}){
  const[tcStatus,setTcStatus]=useState({tested:false,ok:false,msg:'',loading:false});
  const[refreshStatus,setRefreshStatus]=useState({loading:false,result:null});

  const testConnection=async()=>{
    setTcStatus({tested:false,ok:false,msg:'',loading:true});
    try{
      if(!supabase){setTcStatus({tested:true,ok:false,msg:'Supabase not configured — set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY',loading:false});return}
      const d=await invokeEdgeFn(supabase,'taxcloud-lookup',{address1:'123 Main St',city:'McKinney',state:'TX',zip5:'75001'});
      console.log('[TaxCloud test]',JSON.stringify(d));
      if(d?.ok){setTcStatus({tested:true,ok:true,msg:'Connected — test rate for TX 75001: '+d.tax_pct+'%',loading:false})}
      else{setTcStatus({tested:true,ok:false,msg:d?.error||('Lookup failed — raw response: '+JSON.stringify(d)),loading:false})}
    }catch(e){setTcStatus({tested:true,ok:false,msg:'Error: '+e.message,loading:false})}
  };

  const refreshAllRates=async()=>{
    setRefreshStatus({loading:true,result:null});
    try{
      if(!supabase){setRefreshStatus({loading:false,result:{ok:false,error:'Supabase not configured'}});return}
      const d=await invokeEdgeFn(supabase,'taxcloud-refresh',{});
      if(d?.ok){
        setRefreshStatus({loading:false,result:d});
        if(d.changes?.length>0){
          setCust(prev=>prev.map(c=>{const ch=d.changes.find(x=>x.id===c.id);return ch?{...c,tax_rate:ch.new_rate}:c}));
        }
        nf(d.updated+' customer rate(s) updated');
      }else{setRefreshStatus({loading:false,result:{ok:false,error:typeof d?.error==='string'?d.error:d?.error?.message||JSON.stringify(d?.error)||'Refresh failed'}})}
    }catch(e){setRefreshStatus({loading:false,result:{ok:false,error:e.message}})}
  };

  const taxableCusts=cust.filter(c=>c.is_active!==false&&!c.tax_exempt&&(c.tax_rate||0)>0);
  const exemptCusts=cust.filter(c=>c.is_active!==false&&c.tax_exempt);
  const noRateCusts=cust.filter(c=>c.is_active!==false&&!c.tax_exempt&&!(c.tax_rate>0)&&c.shipping_state);
  const statesUsed=[...new Set(taxableCusts.map(c=>(c.shipping_state||'').toUpperCase()).filter(Boolean))].sort();

  return<>
    {/* Connection Status */}
    <div className="card" style={{marginBottom:16}}>
      <div className="card-header"><h3>TaxCloud Connection</h3></div>
      <div className="card-body">
        <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>
          TaxCloud handles sales tax rate lookups and files returns automatically. API credentials are stored as Supabase Edge Function secrets (TAXCLOUD_API_LOGIN_ID, TAXCLOUD_API_KEY).
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}>
          <button className="btn btn-sm btn-primary" onClick={testConnection} disabled={tcStatus.loading}
            style={{fontSize:12}}>{tcStatus.loading?'Testing...':'Test Connection'}</button>
          {tcStatus.tested&&<div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:10,height:10,borderRadius:'50%',background:tcStatus.ok?'#22c55e':'#ef4444',display:'inline-block'}}/>
            <span style={{fontSize:12,color:tcStatus.ok?'#166534':'#dc2626',fontWeight:600}}>{tcStatus.ok?'Connected':'Failed'}</span>
          </div>}
        </div>
        {tcStatus.msg&&<div style={{padding:8,background:tcStatus.ok?'#f0fdf4':'#fef2f2',border:'1px solid '+(tcStatus.ok?'#bbf7d0':'#fecaca'),borderRadius:6,fontSize:11,color:tcStatus.ok?'#166534':'#991b1b'}}>{tcStatus.msg}</div>}
        <div style={{marginTop:12,padding:10,background:'#f8fafc',borderRadius:6}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>EDGE FUNCTIONS</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {[['taxcloud-lookup','Rate Lookup','Looks up tax rate for a shipping address'],['taxcloud-capture','Capture / File','Reports paid invoices for state filing'],['taxcloud-refresh','Quarterly Refresh','Batch updates all customer rates']].map(([fn,label,desc])=>
              <div key={fn} style={{flex:'1 1 180px',padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
                <div style={{fontSize:11,fontWeight:700,color:'#1e40af',fontFamily:'monospace'}}>{fn}</div>
                <div style={{fontSize:10,color:'#475569',fontWeight:600}}>{label}</div>
                <div style={{fontSize:9,color:'#94a3b8'}}>{desc}</div>
              </div>)}
          </div>
        </div>
      </div>
    </div>

    {/* Customer Rate Summary */}
    <div className="card" style={{marginBottom:16}}>
      <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h3>Customer Tax Rates</h3>
        <button className="btn btn-sm" style={{fontSize:11,background:'#7c3aed',color:'white',border:'none'}} onClick={refreshAllRates} disabled={refreshStatus.loading}>
          {refreshStatus.loading?'Refreshing...':'Refresh All Rates'}</button>
      </div>
      <div className="card-body">
        {refreshStatus.result&&<div style={{marginBottom:12,padding:10,borderRadius:6,fontSize:12,
          background:refreshStatus.result.ok?'#f0fdf4':'#fef2f2',border:'1px solid '+(refreshStatus.result.ok?'#bbf7d0':'#fecaca'),
          color:refreshStatus.result.ok?'#166534':'#991b1b'}}>
          {refreshStatus.result.ok?<>
            <strong>Refresh complete:</strong> {refreshStatus.result.total_customers} customers checked, {refreshStatus.result.updated} updated, {refreshStatus.result.skipped} skipped, {refreshStatus.result.errors} errors
            {refreshStatus.result.changes?.length>0&&<div style={{marginTop:6}}>{refreshStatus.result.changes.map((ch,i)=>
              <div key={i} style={{fontSize:11}}>{ch.name}: {(ch.old_rate*100).toFixed(3)}% → <strong>{(ch.new_rate*100).toFixed(3)}%</strong></div>)}</div>}
          </>:<>Error: {typeof refreshStatus.result.error==='string'?refreshStatus.result.error:refreshStatus.result.error?.message||JSON.stringify(refreshStatus.result.error)}</>}
        </div>}

        <div style={{display:'flex',gap:12,marginBottom:12}}>
          <div style={{padding:10,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#166534'}}>{taxableCusts.length}</div>
            <div style={{fontSize:10,color:'#64748b'}}>Taxable (rate set)</div>
          </div>
          <div style={{padding:10,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#dc2626'}}>{exemptCusts.length}</div>
            <div style={{fontSize:10,color:'#64748b'}}>Tax Exempt</div>
          </div>
          <div style={{padding:10,background:noRateCusts.length>0?'#fef3c7':'#f8fafc',border:'1px solid '+(noRateCusts.length>0?'#fde68a':'#e2e8f0'),borderRadius:8,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:noRateCusts.length>0?'#d97706':'#94a3b8'}}>{noRateCusts.length}</div>
            <div style={{fontSize:10,color:'#64748b'}}>Missing Rate</div>
          </div>
        </div>

        {noRateCusts.length>0&&<div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:'#d97706',marginBottom:4}}>Customers needing tax rate:</div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{noRateCusts.map(c=>
            <span key={c.id} style={{padding:'3px 8px',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:6,fontSize:11,color:'#92400e'}}>{c.name} ({c.shipping_state||'?'})</span>)}
          </div>
        </div>}

        {statesUsed.length>0&&<div>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>States with active tax rates:</div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{statesUsed.map(st=>{
            const count=taxableCusts.filter(c=>(c.shipping_state||'').toUpperCase()===st).length;
            const avgRate=taxableCusts.filter(c=>(c.shipping_state||'').toUpperCase()===st).reduce((a,c)=>a+(c.tax_rate||0),0)/count;
            return<span key={st} style={{padding:'4px 10px',background:'#dbeafe',border:'1px solid #93c5fd',borderRadius:6,fontSize:11,color:'#1e40af',fontWeight:600}}>
              {st} <span style={{fontSize:9,fontWeight:400}}>({count}) ~{(avgRate*100).toFixed(2)}%</span></span>})}</div>
        </div>}
      </div>
    </div>

    {/* Auto-Capture Info */}
    <div className="card" style={{marginBottom:16}}>
      <div className="card-header"><h3>Tax Filing (AuthorizedWithCapture)</h3></div>
      <div className="card-body">
        <div style={{fontSize:12,color:'#475569',lineHeight:1.6}}>
          When an invoice is fully paid, the portal automatically reports the transaction to TaxCloud via <strong>AuthorizedWithCapture</strong>. This means:
        </div>
        <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
          {[['TaxCloud calculates the exact tax for each line item based on TIC codes','#2563eb'],
            ['The transaction is authorized and captured in a single call','#7c3aed'],
            ['TaxCloud includes it in your next state filing','#166534'],
            ['Invoices show a "TC" badge once reported','#d97706']
          ].map(([text,color],i)=>
            <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>
              <span style={{fontSize:12}}>{text}</span>
            </div>)}
        </div>
        <div style={{marginTop:12,padding:8,background:'#fef3c7',borderRadius:6,fontSize:11,color:'#92400e'}}>
          <strong>TIC Code:</strong> All items default to TIC 20010 (Clothing/Apparel). TaxCloud automatically handles state-specific apparel exemptions (PA, NJ, MN, etc.).
        </div>
      </div>
    </div>
  </>;
}

// MODALS

function AddressAutocomplete({value,onChange,onPlaceSelect,placeholder,style,className}){
  const inputRef=useRef(null);const acRef=useRef(null);
  useEffect(()=>{
    if(!inputRef.current||acRef.current)return;
    const init=()=>{
      if(!window.google?.maps?.places||acRef.current)return false;
      const ac=new window.google.maps.places.Autocomplete(inputRef.current,{types:['address'],componentRestrictions:{country:'us'},fields:['address_components','formatted_address']});
      ac.addListener('place_changed',()=>{
        const place=ac.getPlace();if(!place?.address_components)return;
        const get=(type)=>{const c=place.address_components.find(x=>x.types.includes(type));return c||null};
        const num=get('street_number')?.long_name||'';
        const route=get('route')?.short_name||'';
        const city=get('locality')?.long_name||get('sublocality_level_1')?.long_name||get('neighborhood')?.long_name||'';
        const state=get('administrative_area_level_1')?.short_name||'';
        const zip=get('postal_code')?.long_name||'';
        const street=[num,route].filter(Boolean).join(' ');
        onPlaceSelect({street,city,state,zip});
      });
      acRef.current=ac;return true;
    };
    if(!init()){
      const iv=setInterval(()=>{if(init())clearInterval(iv)},500);
      const to=setTimeout(()=>clearInterval(iv),10000);
      return()=>{clearInterval(iv);clearTimeout(to)};
    }
    return()=>{if(acRef.current){window.google.maps.event.clearInstanceListeners(acRef.current);acRef.current=null}};
  },[]);// eslint-disable-line
  return <input ref={inputRef} className={className||'form-input'} placeholder={placeholder||'Street'} value={value} onChange={e=>onChange(e.target.value)} style={style}/>;
}

function SearchTagsInput({tags,onChange}){
  const[draft,setDraft]=useState('');
  const list=Array.isArray(tags)?tags:[];
  const add=()=>{const t=draft.trim();if(!t)return;const norm=t.toLowerCase();if(list.some(x=>(x||'').trim().toLowerCase()===norm)){setDraft('');return}onChange([...list,t]);setDraft('')};
  const rm=(i)=>onChange(list.filter((_,x)=>x!==i));
  return(<div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:6,background:'white',minHeight:38}}>
    {list.map((t,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,background:'#eef2ff',color:'#3730a3',border:'1px solid #c7d2fe',borderRadius:10,padding:'2px 4px 2px 8px',fontSize:11,fontWeight:600}}>
      {t}
      <button type="button" onClick={()=>rm(i)} style={{background:'none',border:'none',cursor:'pointer',color:'#6366f1',padding:'0 2px',fontSize:14,lineHeight:1}} title="Remove tag">×</button>
    </span>)}
    <input style={{flex:1,minWidth:140,border:'none',outline:'none',fontSize:12,padding:'4px 2px',background:'transparent'}} placeholder={list.length?'Add another...':'e.g. FPU baseball, WVC basketball'} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();add()}else if(e.key==='Backspace'&&!draft&&list.length){rm(list.length-1)}}} onBlur={()=>{if(draft.trim())add()}}/>
  </div>);
}

function CustModal({isOpen,onClose,onSave,customer,parents,reps,supabase,allCustomers}){
  const b={parent_id:null,name:'',alpha_tag:'',search_tags:[],contacts:[{name:'',email:'',phone:'',role:'Head Coach'}],shipping_city:'',shipping_state:'',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_exempt:false,tax_rate:0};
  const[f,setF]=useState(customer||b);const[ct,setCt]=useState(customer?.parent_id?'sub':'parent');const[err,setErr]=useState({});const[tcLook,setTcLook]=useState({loading:false,msg:''});
  const doTcLookup=async(fields)=>{if(!supabase||!fields.shipping_state||!fields.shipping_zip)return null;try{return await invokeEdgeFn(supabase,'taxcloud-lookup',{address1:fields.shipping_address_line1||'',city:fields.shipping_city||'',state:fields.shipping_state,zip5:fields.shipping_zip})}catch(e){return{ok:false,error:'Error: '+e.message}}};
  const APPAREL_EXEMPT=['MN','NJ','PA','VT','AK','DE','MT','NH','OR'];const APPAREL_THRESHOLD=['MA','NY','RI'];
  const _initRef=React.useRef(null);const _openRef=React.useRef(false);
  const sv=(k,v)=>setF(x=>({...x,[k]:v}));React.useEffect(()=>{if(!isOpen){_openRef.current=false;return}if(_openRef.current)return;_openRef.current=true;const c=customer?{...customer}:b;if(c.id&&!c.alpha_tag&&c.name)c.alpha_tag=c.name.replace(/[^a-zA-Z0-9 ]/g,'').trim().split(/\s+/).slice(0,2).join(' ').toUpperCase().slice(0,12);if(c.id&&(!c.contacts||!c.contacts.length))c.contacts=[{name:'',email:'',phone:'',role:'Head Coach'}];
    // Migrate existing alt_billing_addresses to have type field
    if(c.alt_billing_addresses){c.alt_billing_addresses=c.alt_billing_addresses.map(a=>a.type?a:{...a,type:'billing'})}
    // If editing and billing differs from shipping, migrate billing into alt_billing_addresses
    if(c.id&&c.billing_address_line1&&(c.billing_address_line1!==c.shipping_address_line1||c.billing_city!==c.shipping_city||c.billing_state!==c.shipping_state||c.billing_zip!==c.shipping_zip)){
      const alts=c.alt_billing_addresses||[];const hasBill=alts.some(a=>a.type==='billing');
      if(!hasBill){c.alt_billing_addresses=[{type:'billing',label:'Billing',street:c.billing_address_line1||'',city:c.billing_city||'',state:c.billing_state||'',zip:c.billing_zip||''},...alts]}}
    setF(c);setCt(customer?.parent_id?'sub':'parent');setErr({});setTcLook({loading:false,msg:''});_initRef.current=isOpen?JSON.stringify(c):null},[customer,isOpen]); // eslint-disable-line
  const addC=()=>sv('contacts',[...(f.contacts||[]),{name:'',email:'',phone:'',role:'Head Coach'}]);const rmC=i=>sv('contacts',(f.contacts||[]).filter((_,x)=>x!==i));
  const upC=(i,k,v)=>sv('contacts',(f.contacts||[]).map((c,x)=>x===i?{...c,[k]:v}:c));
  const[valMsg,setValMsg]=useState('');
  const ok=()=>{const e={};if(!f.name)e.n=1;if(!f.alpha_tag)e.a=1;if(!f.shipping_city)e.c=1;if(!f.shipping_state)e.s=1;if(ct==='sub'&&!f.parent_id)e.p=1;if(!(f.contacts||[])[0]?.name)e.cn=1;if(!(f.contacts||[])[0]?.email)e.ce=1;
    // Alpha tag must be unique — it's the portal URL identifier.
    const dupTag=f.alpha_tag&&(allCustomers||[]).find(c=>c.id!==f.id&&(c.alpha_tag||'').trim().toLowerCase()===f.alpha_tag.trim().toLowerCase());
    if(dupTag)e.a=1;
    setErr(e);const missing=[];if(e.n)missing.push('Name');if(e.a&&!dupTag)missing.push('Alpha Tag');if(e.c)missing.push('City');if(e.s)missing.push('State');if(e.p)missing.push('Parent');if(e.cn)missing.push('Contact Name');if(e.ce)missing.push('Contact Email');
    if(dupTag)setValMsg('Alpha Tag "'+f.alpha_tag+'" is already used by '+dupTag.name+'. Alpha tags must be unique — they identify the customer portal.');
    else if(missing.length)setValMsg('Missing: '+missing.join(', '));
    else setValMsg('');
    return!missing.length&&!dupTag;
  };
  const _isDirty=()=>_initRef.current!==null&&JSON.stringify(f)!==_initRef.current;
  const safeClose=()=>{if(_isDirty()){if(!window.confirm('You have unsaved changes. Discard?'))return}onClose()};
  if(!isOpen)return null;
  return(<div className="modal-overlay" onClick={safeClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700}}>
  <div className="modal-header"><h2>{customer?.id?'Edit':'New'} Customer</h2><button className="modal-close" onClick={safeClose}>x</button></div>
  <div className="modal-body">
    <div style={{display:'flex',gap:8,marginBottom:16}}>{['parent','sub'].map(t=><button key={t} className={`btn btn-sm ${ct===t?'btn-primary':'btn-secondary'}`} onClick={()=>{setCt(t);if(t==='parent')sv('parent_id',null)}}>{t==='parent'?'Parent':'Sub'}</button>)}</div>
    {ct==='sub'&&<div style={{marginBottom:12}}><label className="form-label">Parent *</label><SearchSelect options={parents.map(p=>({value:p.id,label:`${p.name} (${p.alpha_tag})`}))} value={f.parent_id} onChange={v=>sv('parent_id',v)} placeholder="Search parent..."/></div>}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1.4fr',gap:12}}><div><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e=>sv('name',e.target.value)} style={err.n?{borderColor:'#dc2626'}:{}}/></div>
      <div><label className="form-label">Alpha Tag *</label><input className="form-input" value={f.alpha_tag||''} onChange={e=>sv('alpha_tag',e.target.value)} style={err.a?{borderColor:'#dc2626'}:{}}/></div>
      <div><label className="form-label">Terms</label><select className="form-select" value={f.payment_terms||'net30'} onChange={e=>sv('payment_terms',e.target.value)}><option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></div>
      <div><label className="form-label">Rep</label><select className="form-select" value={f.primary_rep_id||''} onChange={e=>sv('primary_rep_id',e.target.value||null)}><option value="">— None —</option>{(reps||[]).filter(r=>['Steve Peterson','Mike Mercuriali','Jered Hunt','Chase Koissian','Gayle Peterson','Kevin McCormack','Jeff Bianchini','Sharon Day-Monroe','Kelly Bean'].includes(r.name)&&r.is_active!==false).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <div><label className="form-label">Search Tags</label><SearchTagsInput tags={f.search_tags||[]} onChange={v=>sv('search_tags',v)}/></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:8,marginBottom:6,textTransform:'uppercase'}}>Contacts</div>
    {(()=>{const inheritedBilling=ct==='sub'&&f.parent_id?getBillingContacts({parent_id:f.parent_id,contacts:[]},allCustomers).filter(b=>b._inherited_from):[];
      return inheritedBilling.length>0?<div style={{background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:6,padding:'8px 10px',marginBottom:8}}>
        <div style={{fontSize:10,fontWeight:700,color:'#6d28d9',marginBottom:4,textTransform:'uppercase'}}>Inherited Billing Contact{inheritedBilling.length>1?'s':''} (auto-CC'd from parent)</div>
        {inheritedBilling.map((b,bi)=><div key={bi} style={{fontSize:12,color:'#6d28d9'}}>
          <strong>{b.name||'—'}</strong>{b.email?' · '+b.email:''}{b.phone?' · '+b.phone:''} <span style={{fontSize:10,color:'#94a3b8'}}>(edit on {b._inherited_from})</span>
        </div>)}
      </div>:null;
    })()}
    {(f.contacts||[]).map((c,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 100px auto',gap:6,marginBottom:6}}>
      <input className="form-input" placeholder="Name *" value={c.name} onChange={e=>upC(i,'name',e.target.value)}/>
      <input className="form-input" placeholder="Email *" value={c.email} onChange={e=>upC(i,'email',e.target.value)}/>
      <input className="form-input" placeholder="Phone" value={c.phone} onChange={e=>upC(i,'phone',e.target.value)}/>
      <select className="form-select" value={c.role} onChange={e=>upC(i,'role',e.target.value)} style={{fontSize:11}}>{CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}</select>
      {i>0?<button className="btn btn-sm btn-secondary" onClick={()=>rmC(i)}><Icon name="trash" size={12}/></button>:<div/>}</div>)}
    <button className="btn btn-sm btn-secondary" onClick={addC}><Icon name="plus" size={12}/> Contact</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Shipping</div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:8}}><AddressAutocomplete placeholder="Street" value={f.shipping_address_line1||''} onChange={v=>sv('shipping_address_line1',v)} onPlaceSelect={p=>{setF(x=>({...x,shipping_address_line1:p.street,shipping_city:p.city,shipping_state:p.state,shipping_zip:p.zip}))}}/><input className="form-input" placeholder="City *" value={f.shipping_city||''} onChange={e=>sv('shipping_city',e.target.value)} style={err.c?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ST" value={f.shipping_state||''} onChange={e=>sv('shipping_state',e.target.value)} style={err.s?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ZIP" value={f.shipping_zip||''} onChange={e=>sv('shipping_zip',e.target.value)}/></div>
    <div style={{fontSize:10,color:'#64748b',marginTop:8,marginBottom:4,fontStyle:'italic'}}>Billing address defaults to shipping address above.</div>
    {(f.alt_billing_addresses||[]).length>0&&<div style={{fontSize:10,fontWeight:600,color:'#64748b',marginTop:6,marginBottom:4}}>Alternate Addresses</div>}
    {(f.alt_billing_addresses||[]).map((ab,ai)=><div key={ai} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,padding:'8px 10px',marginBottom:6}}>
      <div style={{display:'grid',gridTemplateColumns:'120px 1fr auto',gap:6,marginBottom:4}}>
        <select className="form-select" value={ab.type||'billing'} onChange={e=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,type:e.target.value};sv('alt_billing_addresses',a)}} style={{fontSize:11}}>
          <option value="shipping">Alt. Shipping</option>
          <option value="billing">Billing Address</option>
        </select>
        <input className="form-input" placeholder="Label (e.g. Coach's Home, District Office)" value={ab.label||''} onChange={e=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,label:e.target.value};sv('alt_billing_addresses',a)}} style={{fontSize:11}}/>
        <button className="btn btn-sm btn-secondary" onClick={()=>sv('alt_billing_addresses',(f.alt_billing_addresses||[]).filter((_,i)=>i!==ai))} style={{padding:'2px 6px'}}><Icon name="trash" size={12}/></button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:6}}>
        <AddressAutocomplete placeholder="Street" value={ab.street||''} onChange={v=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,street:v};sv('alt_billing_addresses',a)}} onPlaceSelect={p=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,street:p.street,city:p.city,state:p.state,zip:p.zip};sv('alt_billing_addresses',a)}} style={{fontSize:11}}/>
        <input className="form-input" placeholder="City" value={ab.city||''} onChange={e=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,city:e.target.value};sv('alt_billing_addresses',a)}} style={{fontSize:11}}/>
        <input className="form-input" placeholder="ST" value={ab.state||''} onChange={e=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,state:e.target.value};sv('alt_billing_addresses',a)}} style={{fontSize:11}}/>
        <input className="form-input" placeholder="ZIP" value={ab.zip||''} onChange={e=>{const a=[...(f.alt_billing_addresses||[])];a[ai]={...ab,zip:e.target.value};sv('alt_billing_addresses',a)}} style={{fontSize:11}}/>
      </div>
    </div>)}
    <button className="btn btn-sm btn-secondary" style={{fontSize:10,marginTop:4}} onClick={()=>sv('alt_billing_addresses',[...(f.alt_billing_addresses||[]),{type:'shipping',label:'',street:'',city:'',state:'',zip:''}])}><Icon name="plus" size={10}/> Add Alternate Address</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Pricing</div>
    <div className="form-row form-row-2"><div><label className="form-label">Tier</label><select className="form-select" value={f.adidas_ua_tier||'B'} onChange={e=>sv('adidas_ua_tier',e.target.value)}><option value="A">A - 40%</option><option value="B">B - 35%</option><option value="C">C - 30%</option></select></div>
      <div><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={f.catalog_markup||1.65} onChange={e=>sv('catalog_markup',parseFloat(e.target.value)||1.65)}/></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Tax</div>
    <div className="form-row form-row-2"><div><label className="form-label">Tax Rate (%)</label><div style={{display:'flex',gap:6}}><input className="form-input" type="number" step="0.125" min="0" max="15" value={f.tax_rate?(f.tax_rate*100).toFixed(4).replace(/0+$/,'').replace(/\.$/,''):''} onChange={e=>{const v=parseFloat(e.target.value);sv('tax_rate',v>0?v/100:0)}} placeholder="e.g. 7.875" style={{flex:1}}/><button className="btn btn-sm btn-secondary" disabled={tcLook.loading||!f.shipping_state||!f.shipping_zip} title={!f.shipping_state||!f.shipping_zip?'Enter shipping state & ZIP first':'Lookup rate from TaxCloud'} style={{whiteSpace:'nowrap',fontSize:11}} onClick={async()=>{setTcLook({loading:true,msg:''});const d=await Promise.race([doTcLookup(f),new Promise(r=>setTimeout(()=>r({ok:false,error:'Lookup timed out'}),8000))]);if(d?.ok){sv('tax_rate',d.tax_rate);setTcLook({loading:false,msg:d.tax_pct+'% (TaxCloud)'})}else{setTcLook({loading:false,msg:d?.error||'Lookup failed'})}}}>{tcLook.loading?'...':'TaxCloud'}</button></div>
    {tcLook.msg&&<div style={{fontSize:10,marginTop:3,color:tcLook.msg.includes('fail')||tcLook.msg.includes('Error')?'#dc2626':'#166534'}}>{tcLook.msg}</div>}
    {f.shipping_state&&APPAREL_EXEMPT.includes(f.shipping_state.toUpperCase())&&<div style={{fontSize:10,marginTop:3,color:'#7c3aed'}}>{f.shipping_state.toUpperCase()} does not tax apparel</div>}
    {f.shipping_state&&APPAREL_THRESHOLD.includes(f.shipping_state.toUpperCase())&&<div style={{fontSize:10,marginTop:3,color:'#b45309'}}>{f.shipping_state.toUpperCase()} exempts apparel under threshold</div>}</div>
      <div style={{paddingTop:8}}><label className="form-label">Tax Status</label><div style={{display:'flex',gap:0,borderRadius:6,overflow:'hidden',border:'1px solid #d1d5db'}}><button type="button" style={{flex:1,padding:'8px 12px',fontSize:12,fontWeight:700,border:'none',cursor:'pointer',background:!f.tax_exempt?'#166534':'#f8fafc',color:!f.tax_exempt?'#fff':'#64748b',transition:'all 0.15s'}} onClick={()=>sv('tax_exempt',false)}>Taxable</button><button type="button" style={{flex:1,padding:'8px 12px',fontSize:12,fontWeight:700,border:'none',borderLeft:'1px solid #d1d5db',cursor:'pointer',background:f.tax_exempt?'#dc2626':'#f8fafc',color:f.tax_exempt?'#fff':'#64748b',transition:'all 0.15s'}} onClick={()=>sv('tax_exempt',true)}>Tax Exempt</button></div><div style={{fontSize:10,color:f.tax_exempt?'#dc2626':'#64748b',marginTop:4}}>{f.tax_exempt?'No sales tax will be charged for this customer.':'Standard — sales tax will apply based on rate above.'}</div></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>School Colors (Pantone)</div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
      {(f.pantone_colors||[]).map((pc,i)=>{const hex=pantoneHex(pc.code)||pc.hex||'#ccc';
        return<div key={i} style={{display:'inline-flex',alignItems:'center',gap:6,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,padding:'4px 8px'}}>
          <div style={{width:18,height:18,borderRadius:4,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
          <span style={{fontSize:11,fontWeight:600}}>PMS {pc.code}</span>
          {pc.name&&<span style={{fontSize:10,color:'#64748b'}}>{pc.name}</span>}
          <button onClick={()=>sv('pantone_colors',(f.pantone_colors||[]).filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:0,marginLeft:2}}><Icon name="x" size={10}/></button>
        </div>})}
    </div>
    <PantoneAdder onAdd={(pc)=>sv('pantone_colors',[...(f.pantone_colors||[]),pc])} existingCodes={(f.pantone_colors||[]).map(c=>c.code)}/>
    <div style={{fontSize:11,fontWeight:700,color:'#7c3aed',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Thread Colors (Embroidery)</div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
      {(f.thread_colors||[]).map((tc,i)=>{const hex=threadHex(tc.name)||tc.hex||'#ccc';
        return<div key={i} style={{display:'inline-flex',alignItems:'center',gap:6,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,padding:'4px 8px'}}>
          <div style={{width:18,height:18,borderRadius:4,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
          <span style={{fontSize:11,fontWeight:600}}>{tc.name}</span>
          <button onClick={()=>sv('thread_colors',(f.thread_colors||[]).filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:0,marginLeft:2}}><Icon name="x" size={10}/></button>
        </div>})}
    </div>
    <div style={{display:'flex',gap:6,alignItems:'center'}}>
      <input className="form-input" id="thread-color-input" placeholder='e.g. Cardinal, Madeira 1728...' style={{fontSize:12,flex:1,maxWidth:220}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const v=e.target.value.trim();if(v&&!(f.thread_colors||[]).some(t=>t.name.toLowerCase()===v.toLowerCase())){sv('thread_colors',[...(f.thread_colors||[]),{name:v}]);e.target.value=''}}}}/>
      <button className="btn btn-sm btn-secondary" style={{fontSize:11,flexShrink:0}} onClick={()=>{const inp=document.getElementById('thread-color-input');const v=inp?.value?.trim();if(v&&!(f.thread_colors||[]).some(t=>t.name.toLowerCase()===v.toLowerCase())){sv('thread_colors',[...(f.thread_colors||[]),{name:v}]);inp.value=''}}}>+ Add</button>
    </div>
  </div>
  {valMsg&&<div style={{padding:'6px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,fontSize:11,color:'#dc2626',margin:'0 16px 8px'}}>{valMsg}</div>}
  <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={tcLook.loading} onClick={async()=>{if(!ok())return;const dat={...f,id:f.id||'c'+Date.now(),parent_id:ct==='sub'?f.parent_id:null,is_active:true,_oe:f._oe||0,_os:f._os||0,_oi:f._oi||0,_ob:f._ob||0};
    const billAlt=(dat.alt_billing_addresses||[]).find(a=>a.type==='billing');
    if(billAlt&&(billAlt.street||billAlt.city)){dat.billing_address_line1=billAlt.street||'';dat.billing_city=billAlt.city||'';dat.billing_state=billAlt.state||'';dat.billing_zip=billAlt.zip||''}
    else{dat.billing_address_line1=dat.shipping_address_line1||'';dat.billing_city=dat.shipping_city||'';dat.billing_state=dat.shipping_state||'';dat.billing_zip=dat.shipping_zip||''}
    if(dat.tax_exempt){dat.tax_rate=0}
    else{try{if(!(dat.tax_rate>0)&&dat.shipping_state&&dat.shipping_zip&&supabase){setTcLook({loading:true,msg:'Looking up tax rate...'});const d=await Promise.race([doTcLookup(dat),new Promise(r=>setTimeout(()=>r({ok:false,error:'timeout'}),8000))]);if(d?.ok){dat.tax_rate=d.tax_rate}}}catch(e){console.error('[CustModal] TaxCloud lookup error:',e)}finally{setTcLook({loading:false,msg:''})}}
    // Guard: converting an existing parent (with subs) into a sub would create a 3-level hierarchy
    // that the customer list view doesn't render. Promote those subs to top-level so they stay visible.
    const wasParent=customer&&!customer.parent_id&&customer.id;
    const becomingSub=ct==='sub'&&!!dat.parent_id;
    const orphans=wasParent&&becomingSub?(allCustomers||[]).filter(x=>x.parent_id===customer.id):[];
    if(orphans.length){
      const msg=orphans.length+' sub-customer'+(orphans.length===1?'':'s')+' currently roll up to '+customer.name+':\n\n'+orphans.map(o=>'• '+o.name+(o.alpha_tag?' ('+o.alpha_tag+')':'')).join('\n')+'\n\nMaking '+customer.name+' a sub would create a 3-level hierarchy that the list view does not show. Click OK to promote '+(orphans.length===1?'this account':'these accounts')+' to top-level parent'+(orphans.length===1?'':'s')+' and continue, or Cancel to abort.';
      if(!window.confirm(msg)){return}
      orphans.forEach(o=>onSave({...o,parent_id:null}));
    }
    onSave(dat);onClose()}}>{tcLook.loading?'Saving...':'Save'}</button></div></div></div>);
}

function AdjModal({isOpen,onClose,product,onSave}){const[a,setA]=useState({});const[d,setD]=useState({});const[reason,setReason]=useState('');const[adjType,setAdjType]=useState('manual');
  React.useEffect(()=>{if(product){setA({...product._inv});setD({});setReason('');setAdjType('manual')}},[product,isOpen]);if(!isOpen||!product)return null;
  const applyDelta=(sz,val)=>{const cur=product._inv?.[sz]||0;const delta=parseInt(val)||0;setD(x=>({...x,[sz]:delta}));setA(x=>({...x,[sz]:Math.max(0,cur+delta)}))};
  const hasChanges=Object.values(d).some(v=>v!==0);
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
    <div className="modal-header"><h2>Adjust Inventory</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body"><div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:16}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{product.sku}</span> {product.name}</div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{product.available_sizes.map(sz=>{const cur=product._inv?.[sz]||0;const delta=d[sz]||0;const newVal=Math.max(0,cur+delta);
        return<div key={sz} style={{textAlign:'center',minWidth:56}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:2}}>{sz}</div>
          <div style={{fontSize:18,fontWeight:800,color:'#0f172a',marginBottom:2}}>{cur}</div>
          <div style={{fontSize:9,color:'#94a3b8',marginBottom:4}}>current</div>
          <input style={{width:52,textAlign:'center',border:'2px solid '+(delta>0?'#22c55e':delta<0?'#ef4444':'#d1d5db'),borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,color:delta>0?'#166534':delta<0?'#dc2626':'#0f172a',background:delta>0?'#f0fdf4':delta<0?'#fef2f2':'white'}}
            value={delta===0?'':((delta>0?'+':'')+delta)} placeholder="±0"
            onChange={e=>{const raw=e.target.value.replace(/[^0-9\-+]/g,'');if(raw===''||raw==='-'||raw==='+'){setD(x=>({...x,[sz]:0}));setA(x=>({...x,[sz]:cur}));return}applyDelta(sz,raw)}}/>
          <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>= <strong style={{color:delta!==0?'#1e40af':'#94a3b8'}}>{newVal}</strong></div>
        </div>})}</div>
      {hasChanges&&<div style={{marginTop:16,borderTop:'1px solid #e2e8f0',paddingTop:12}}>
        <div style={{display:'flex',gap:12,marginBottom:8}}>
          <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:'#475569',display:'block',marginBottom:4}}>Type</label>
            <select className="form-select" value={adjType} onChange={e=>setAdjType(e.target.value)} style={{width:'100%'}}>
              <option value="manual">Manual Adjustment</option><option value="correction">Correction</option><option value="return">Return</option><option value="damage">Damage/Loss</option></select></div>
          <div style={{flex:2}}><label style={{fontSize:11,fontWeight:700,color:'#475569',display:'block',marginBottom:4}}>Reason / Notes</label>
            <input className="form-input" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this being adjusted?" style={{width:'100%'}}/></div>
        </div>
        <div style={{fontSize:11,color:'#64748b',background:'#fffbeb',padding:'6px 10px',borderRadius:4,border:'1px solid #fef3c7'}}>This adjustment will be logged and synced to QuickBooks.</div>
      </div>}
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!hasChanges} onClick={()=>{onSave(product.id,a,d,reason,adjType);onClose()}}>Save</button></div></div></div>);
}

// ─── STRIPE CHECKOUT ───
const CC_FEE_PORTAL=0.029;// 2.9% CC surcharge — matches admin CC_FEE_PCT


function StripeCheckoutForm({amount,onSuccess,onCancel}){
  const stripe=useStripe();const elements=useElements();
  const[processing,setProcessing]=useState(false);
  const[error,setError]=useState(null);
  const fee=Math.round(amount*CC_FEE_PORTAL*100)/100;
  const total=amount+fee;

  const handleSubmit=async(e)=>{
    e.preventDefault();
    if(!stripe||!elements){return}
    setProcessing(true);setError(null);
    const result=await stripe.confirmPayment({elements,confirmParams:{return_url:window.location.href},redirect:'if_required'});
    if(result.error){
      setError(result.error.message);setProcessing(false);
    }else if(result.paymentIntent&&result.paymentIntent.status==='succeeded'){
      onSuccess({intentId:result.paymentIntent.id,amount,fee,last4:null,brand:null});
    }else{
      setError('Payment was not completed. Please try again.');setProcessing(false);
    }
  };

  return<form onSubmit={handleSubmit}>
    <div style={{marginBottom:16}}>
      <PaymentElement options={{layout:'tabs',wallets:{applePay:'auto',googlePay:'auto'}}}/>
    </div>
    {error&&<div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#dc2626',fontSize:12,marginBottom:12}}>{error}</div>}
    <div style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:16,fontSize:12}}>
      <div style={{display:'flex',justifyContent:'space-between'}}><span>Subtotal:</span><span>${amount.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div style={{display:'flex',justifyContent:'space-between',color:'#d97706'}}><span>Processing Fee (2.9%):</span><span>+${fee.toFixed(2)}</span></div>
      <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,borderTop:'2px solid #e2e8f0',paddingTop:6,marginTop:6,fontSize:14}}><span>Total:</span><span>${total.toFixed(2)}</span></div>
    </div>
    <div style={{display:'flex',gap:8}}>
      <button type="submit" disabled={!stripe||processing} style={{flex:1,padding:'14px 20px',background:processing?'#94a3b8':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:processing?'default':'pointer'}}>
        {processing?'Processing...':'💳 Pay $'+total.toFixed(2)}
      </button>
      <button type="button" onClick={onCancel} style={{padding:'14px 16px',background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0',borderRadius:10,fontSize:14,cursor:'pointer'}}>Cancel</button>
    </div>
  </form>
}


function StripePaymentModal({invoices,customerName,customerEmail,alphaTag,onSuccess,onClose}){
  const[clientSecret,setClientSecret]=useState(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState(null);
  const totalDue=invoices.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
  const fee=Math.round(totalDue*CC_FEE_PORTAL*100)/100;
  const totalCharge=totalDue+fee;
  const invoiceIds=invoices.map(i=>i.id).join(', ');

  useEffect(()=>{
    if(!stripePromise){setError('Stripe is not configured. Please contact NSA to set up payments.');setLoading(false);return}
    (async()=>{
      try{
        const res=await fetch('/.netlify/functions/stripe-payment',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            action:'create_intent',
            amount_cents:Math.round(totalCharge*100),
            customer_name:customerName,
            customer_email:customerEmail,
            invoice_id:invoiceIds,
            invoice_memo:invoices[0]?.memo||'',
            alpha_tag:alphaTag,
          })
        });
        const data=await res.json();
        if(!res.ok)throw new Error(data.error||'Failed to create payment');
        setClientSecret(data.clientSecret);
      }catch(e){setError(e.message)}
      finally{setLoading(false)}
    })();
  },[]);

  return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,padding:16}}>
    <div style={{width:'100%',maxWidth:480,background:'white',borderRadius:16,boxShadow:'0 8px 32px rgba(0,0,0,0.2)',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
      <div style={{background:'linear-gradient(135deg,#059669,#22c55e)',color:'white',padding:'20px 24px'}}>
        <img src="/nsa-logo.svg" alt="NSA" style={{height:28,filter:'brightness(0) invert(1)',marginBottom:4}}/>
        <div style={{fontSize:20,fontWeight:800,marginTop:4}}>Secure Payment</div>
        <div style={{fontSize:13,opacity:0.8,marginTop:2}}>{customerName} · {invoiceIds}</div>
      </div>
      <div style={{padding:'20px 24px'}}>
        {loading&&<div style={{textAlign:'center',padding:40}}><div style={{fontSize:14,color:'#64748b'}}>Setting up secure checkout...</div></div>}
        {error&&<div style={{padding:20,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
          <div style={{fontSize:14,color:'#dc2626',fontWeight:600,marginBottom:4}}>{error}</div>
          <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>Please try again or contact NSA for assistance.</div>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>}
        {clientSecret&&stripePromise&&<Elements stripe={stripePromise} options={{clientSecret,appearance:{theme:'stripe',variables:{colorPrimary:'#22c55e',borderRadius:'8px'}}}}>
          <StripeCheckoutForm amount={totalDue} onCancel={onClose} onSuccess={(result)=>onSuccess({...result,invoices})}/>
        </Elements>}
      </div>
    </div>
  </div>
}

// ─── PUBLIC QUOTE FORM — no auth required, accessed via ?quote=TOKEN ───

function QuoteForm({token,supabaseClient}){
  const[loading,setLoading]=useState(true);
  const[qr,setQr]=useState(null);// quote request record
  const[custName,setCustName]=useState('');
  const[items,setItems]=useState([{item_type:'description',description:'',sku:'',color:'',sizes:{},total_qty:'',decoration_notes:'',notes:''}]);
  const[contactName,setContactName]=useState('');
  const[contactEmail,setContactEmail]=useState('');
  const[globalNotes,setGlobalNotes]=useState('');
  const[submitted,setSubmitted]=useState(false);
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState('');
  const SZS=['YXS','YS','YM','YL','YXL','XS','S','M','L','XL','2XL','3XL','4XL'];
  const[showAllSizes,setShowAllSizes]=useState(false);
  const BASIC_SZS=['S','M','L','XL','2XL'];

  useEffect(()=>{
    if(!supabaseClient||!token)return;
    (async()=>{
      const{data:qrData,error:qrErr}=await supabaseClient.from('quote_requests').select('*').eq('token',token).single();
      if(qrErr||!qrData){setError('Quote form not found or has expired.');setLoading(false);return}
      if(qrData.status==='submitted'||qrData.status==='reviewed'||qrData.status==='converted'){setSubmitted(true);setLoading(false);return}
      setQr(qrData);
      // Get customer name
      const{data:cData}=await supabaseClient.from('customers').select('name').eq('id',qrData.customer_id).single();
      if(cData)setCustName(cData.name);
      // Load existing items if any
      const{data:itemData}=await supabaseClient.from('quote_request_items').select('*').eq('quote_request_id',qrData.id).order('sort_order');
      if(itemData?.length)setItems(itemData.map(i=>({item_type:i.item_type||'description',description:i.description||'',sku:i.sku||'',color:i.color||'',sizes:i.sizes||{},total_qty:i.total_qty||'',decoration_notes:i.decoration_notes||'',notes:i.notes||''})));
      if(qrData.contact_name)setContactName(qrData.contact_name);
      if(qrData.contact_email)setContactEmail(qrData.contact_email);
      if(qrData.notes)setGlobalNotes(qrData.notes);
      setLoading(false);
    })();
  },[token,supabaseClient]);

  const addItem=()=>setItems(prev=>[...prev,{item_type:'description',description:'',sku:'',color:'',sizes:{},total_qty:'',decoration_notes:'',notes:''}]);
  const removeItem=(idx)=>setItems(prev=>prev.filter((_,i)=>i!==idx));
  const updateItem=(idx,field,val)=>setItems(prev=>prev.map((it,i)=>i===idx?{...it,[field]:val}:it));
  const updateSize=(idx,sz,val)=>setItems(prev=>prev.map((it,i)=>i===idx?{...it,sizes:{...it.sizes,[sz]:parseInt(val)||0}}:it));

  const handleSave=async(andSubmit=false)=>{
    if(!supabaseClient||!qr)return;
    setSaving(true);
    try{
      // Delete existing items then re-insert
      await supabaseClient.from('quote_request_items').delete().eq('quote_request_id',qr.id);
      const itemRows=items.filter(it=>it.sku||it.description).map((it,i)=>({
        quote_request_id:qr.id,sort_order:i,item_type:it.sku?'sku':'description',
        sku:it.sku||null,description:it.description||null,color:it.color||null,
        sizes:it.sizes||{},total_qty:it.total_qty?parseInt(it.total_qty):null,
        decoration_notes:it.decoration_notes||null,notes:it.notes||null
      }));
      if(itemRows.length)await supabaseClient.from('quote_request_items').insert(itemRows);
      const updates={contact_name:contactName||null,contact_email:contactEmail||null,notes:globalNotes||null};
      if(andSubmit){updates.status='submitted';updates.submitted_at=new Date().toISOString()}
      await supabaseClient.from('quote_requests').update(updates).eq('id',qr.id);
      if(andSubmit){
        setSubmitted(true);
        // Send notification email to rep
        try{
          const{data:repData}=await supabaseClient.from('team_members').select('email,name').eq('id',qr.created_by).single();
          if(repData?.email){
            const itemSummary=itemRows.map((it,i)=>`${i+1}. ${it.sku||it.description} - ${it.color||'no color'} - ${Object.entries(it.sizes||{}).filter(([,v])=>v>0).map(([s,v])=>s+':'+v).join(', ')||('Qty: '+(it.total_qty||'TBD'))}`).join('<br/>');
            await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'accept':'application/json','content-type':'application/json','api-key':window._brevoKeyPublic||''},
              body:JSON.stringify({sender:{name:'NSA Quote System',email:'noreply@nationalsportsapparel.com'},to:[{email:repData.email}],
                subject:'Quote Request Submitted — '+custName,
                htmlContent:`<h2>Quote Request from ${custName}</h2><p><strong>${contactName||'Customer'}</strong> has submitted their quote request.</p><h3>Items:</h3><p>${itemSummary}</p><p>${globalNotes?'<strong>Notes:</strong> '+globalNotes:''}</p><p><a href="${window.location.origin}">Open NSA Portal to review</a></p>`})});
          }
        }catch(emailErr){console.warn('Email notification failed:',emailErr)}
      }
    }catch(e){setError('Save failed: '+e.message)}
    setSaving(false);
  };

  if(loading)return<div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:32,fontWeight:900,color:'#1e3a5f',marginBottom:8}}>NSA</div><div style={{color:'#64748b'}}>Loading quote form...</div></div></div>;
  if(error)return<div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{textAlign:'center',maxWidth:400}}><div style={{fontSize:32,fontWeight:900,color:'#1e3a5f',marginBottom:8}}>NSA</div><div style={{color:'#dc2626',fontSize:14}}>{error}</div></div></div>;
  if(submitted)return<div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{textAlign:'center',maxWidth:500,padding:32}}><div style={{fontSize:48,marginBottom:16}}>&#10003;</div>
      <div style={{fontSize:24,fontWeight:700,color:'#166534',marginBottom:8}}>Quote Request Submitted!</div>
      <div style={{color:'#64748b',fontSize:14}}>Thank you! Your NSA rep will review your items and get back to you with a quote.</div></div></div>;

  const visibleSizes=showAllSizes?SZS:BASIC_SZS;
  return<div style={{minHeight:'100vh',background:'#f8fafc'}}>
    <div style={{background:'#1e3a5f',padding:'16px 24px',color:'white'}}>
      <div style={{maxWidth:900,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div><div style={{fontSize:20,fontWeight:900}}>NSA</div><div style={{fontSize:11,opacity:.7}}>National Sports Apparel</div></div>
        <div style={{textAlign:'right'}}><div style={{fontSize:14,fontWeight:600}}>Quote Request</div><div style={{fontSize:11,opacity:.7}}>{custName}</div></div>
      </div>
    </div>
    <div style={{maxWidth:900,margin:'24px auto',padding:'0 16px'}}>
      <div style={{background:'white',borderRadius:8,border:'1px solid #e2e8f0',padding:24,marginBottom:16}}>
        <h2 style={{margin:'0 0 4px',fontSize:18,color:'#1e293b'}}>Your Information</h2>
        <p style={{margin:'0 0 16px',fontSize:13,color:'#64748b'}}>Let us know who's filling this out so your rep knows who to follow up with.</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><label style={{display:'block',fontSize:12,fontWeight:600,color:'#475569',marginBottom:4}}>Your Name</label>
            <input className="form-input" value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Coach name" style={{width:'100%'}}/></div>
          <div><label style={{display:'block',fontSize:12,fontWeight:600,color:'#475569',marginBottom:4}}>Email</label>
            <input className="form-input" type="email" value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder="email@school.edu" style={{width:'100%'}}/></div>
        </div>
      </div>

      <div style={{background:'white',borderRadius:8,border:'1px solid #e2e8f0',padding:24,marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div><h2 style={{margin:0,fontSize:18,color:'#1e293b'}}>Items</h2>
            <p style={{margin:'4px 0 0',fontSize:13,color:'#64748b'}}>Add items you'd like quoted. Use SKUs if you have them, or describe what you need.</p></div>
          <label style={{fontSize:11,color:'#64748b',display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
            <input type="checkbox" checked={showAllSizes} onChange={e=>setShowAllSizes(e.target.checked)}/> Show all sizes (Youth, 3XL, 4XL)</label>
        </div>
        {items.map((item,idx)=><div key={idx} style={{border:'1px solid #e2e8f0',borderRadius:8,padding:16,marginBottom:12,background:'#fafbfc'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:700,color:'#334155'}}>Item {idx+1}</div>
            {items.length>1&&<button onClick={()=>removeItem(idx)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:18,fontWeight:700}} title="Remove item">&times;</button>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:3}}>SKU <span style={{fontWeight:400,color:'#94a3b8'}}>(if known)</span></label>
              <input className="form-input" value={item.sku} onChange={e=>updateItem(idx,'sku',e.target.value)} placeholder="e.g. PC61" style={{width:'100%',fontFamily:'monospace'}}/></div>
            <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:3}}>Or Describe Item</label>
              <input className="form-input" value={item.description} onChange={e=>updateItem(idx,'description',e.target.value)} placeholder="e.g. Fleece hoodie, dri-fit polo" style={{width:'100%'}}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:3}}>Color</label>
              <input className="form-input" value={item.color} onChange={e=>updateItem(idx,'color',e.target.value)} placeholder="e.g. Navy, Black" style={{width:'100%'}}/></div>
            <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:3}}>Decoration Notes</label>
              <input className="form-input" value={item.decoration_notes} onChange={e=>updateItem(idx,'decoration_notes',e.target.value)} placeholder="e.g. Screen print front, embroidered left chest" style={{width:'100%'}}/></div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:6}}>Sizes <span style={{fontWeight:400,color:'#94a3b8'}}>(enter quantity per size, or just total below)</span></label>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {visibleSizes.map(sz=><div key={sz} style={{textAlign:'center'}}>
                <div style={{fontSize:10,color:'#64748b',marginBottom:2}}>{sz}</div>
                <input type="number" min="0" value={item.sizes[sz]||''} onChange={e=>updateSize(idx,sz,e.target.value)}
                  style={{width:42,padding:'4px 2px',textAlign:'center',border:'1px solid #cbd5e1',borderRadius:4,fontSize:12}}/>
              </div>)}
              <div style={{textAlign:'center',borderLeft:'2px solid #cbd5e1',paddingLeft:8,marginLeft:4}}>
                <div style={{fontSize:10,color:'#64748b',marginBottom:2}}>Total</div>
                <input type="number" min="0" value={item.total_qty||''} onChange={e=>updateItem(idx,'total_qty',e.target.value)}
                  style={{width:52,padding:'4px 2px',textAlign:'center',border:'1px solid #cbd5e1',borderRadius:4,fontSize:12,fontWeight:600}}/>
              </div>
            </div>
          </div>
          <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'#475569',marginBottom:3}}>Notes</label>
            <input className="form-input" value={item.notes} onChange={e=>updateItem(idx,'notes',e.target.value)} placeholder="Any other details for this item" style={{width:'100%'}}/></div>
        </div>)}
        <button onClick={addItem} style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,padding:'8px 16px',color:'#1d4ed8',fontSize:13,fontWeight:600,cursor:'pointer',width:'100%'}}>+ Add Another Item</button>
      </div>

      <div style={{background:'white',borderRadius:8,border:'1px solid #e2e8f0',padding:24,marginBottom:16}}>
        <label style={{display:'block',fontSize:12,fontWeight:600,color:'#475569',marginBottom:4}}>Additional Notes</label>
        <textarea className="form-input" value={globalNotes} onChange={e=>setGlobalNotes(e.target.value)} placeholder="Anything else your rep should know — timeline, budget, special requests..." rows={3} style={{width:'100%',resize:'vertical'}}/>
      </div>

      <div style={{display:'flex',gap:12,justifyContent:'flex-end'}}>
        <button onClick={()=>handleSave(false)} disabled={saving} style={{background:'white',border:'1px solid #cbd5e1',borderRadius:6,padding:'10px 24px',fontSize:14,fontWeight:600,cursor:'pointer',color:'#334155'}}>
          {saving?'Saving...':'Save Draft'}</button>
        <button onClick={()=>{if(window.confirm('Submit this quote request to your NSA rep? You won\'t be able to edit after submitting.'))handleSave(true)}} disabled={saving}
          style={{background:'#1e40af',border:'none',borderRadius:6,padding:'10px 32px',fontSize:14,fontWeight:700,cursor:'pointer',color:'white'}}>
          {saving?'Submitting...':'Submit to Rep'}</button>
      </div>
      <div style={{textAlign:'center',marginTop:24,fontSize:11,color:'#94a3b8'}}>Powered by National Sports Apparel</div>
    </div>
  </div>;
}

// ─── VENDOR MODAL (create / edit) ───

function VendorModal({isOpen,onClose,onSave,vendor,allVendors}){
  const baseV={id:null,name:'',vendor_type:'upload',api_provider:'',contact_name:'',contact_email:'',contact_phone:'',website:'',rep_name:'',payment_terms:'net30',nsa_carries_inventory:false,click_automation:false,invoice_scan_enabled:false,notes:'',is_active:true};
  const[f,setF]=useState(baseV);
  const[err,setErr]=useState('');
  useEffect(()=>{if(isOpen){setF(vendor?{...baseV,...vendor}:baseV);setErr('')}},[isOpen,vendor]);
  if(!isOpen)return null;
  const sv=(k,v)=>setF(x=>({...x,[k]:v}));
  const save=()=>{
    const name=(f.name||'').trim();
    if(!name){setErr('Vendor name is required');return}
    const dup=(allVendors||[]).find(v=>v.id!==f.id&&(v.name||'').trim().toLowerCase()===name.toLowerCase());
    if(dup){setErr('A vendor with this name already exists');return}
    const out={...f,name,id:f.id||'v'+Date.now()};
    if(out.vendor_type!=='api')out.api_provider=null;
    else if(!out.api_provider)out.api_provider=null;
    // Initialize display aggregates for list page
    if(out._oi==null)out._oi=0;if(out._it==null)out._it=0;if(out._ac==null)out._ac=0;if(out._a3==null)out._a3=0;if(out._a6==null)out._a6=0;if(out._a9==null)out._a9=0;
    onSave(out);
    onClose();
  };
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:640}}>
    <div className="modal-header"><h2>{f.id?'Edit Vendor':'New Vendor'}</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body">
      {err&&<div style={{background:'#fef2f2',border:'1px solid #fca5a5',color:'#991b1b',padding:'8px 12px',borderRadius:6,fontSize:12,marginBottom:12}}>{err}</div>}
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[['upload','Upload'],['api','API']].map(([k,l])=><button key={k} className={`btn btn-sm ${f.vendor_type===k?'btn-primary':'btn-secondary'}`} onClick={()=>sv('vendor_type',k)}>{l}</button>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <div><label className="form-label">Vendor Name *</label><input className="form-input" value={f.name} onChange={e=>sv('name',e.target.value)} autoFocus/></div>
        <div><label className="form-label">Payment Terms</label><select className="form-select" value={f.payment_terms||'net30'} onChange={e=>sv('payment_terms',e.target.value)}>
          <option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net45">Net 45</option><option value="net60">Net 60</option><option value="net90">Net 90</option>
        </select></div>
      </div>
      {f.vendor_type==='api'&&<div style={{marginTop:10}}>
        <label className="form-label">API Provider</label>
        <select className="form-select" value={f.api_provider||''} onChange={e=>sv('api_provider',e.target.value)}>
          <option value="">— None —</option><option value="sanmar">SanMar</option><option value="ss_activewear">S&amp;S Activewear</option><option value="momentec">Momentec</option><option value="richardson">Richardson</option><option value="a4">A4</option>
        </select>
      </div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10}}>
        <div><label className="form-label">Contact Name</label><input className="form-input" value={f.contact_name||''} onChange={e=>sv('contact_name',e.target.value)}/></div>
        <div><label className="form-label">Rep Name</label><input className="form-input" value={f.rep_name||''} onChange={e=>sv('rep_name',e.target.value)}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10}}>
        <div><label className="form-label">Contact Email</label><input className="form-input" value={f.contact_email||''} onChange={e=>sv('contact_email',e.target.value)} placeholder="orders@vendor.com"/></div>
        <div><label className="form-label">Phone</label><input className="form-input" value={f.contact_phone||''} onChange={e=>sv('contact_phone',e.target.value)}/></div>
      </div>
      <div style={{marginTop:10}}>
        <label className="form-label">Website</label><input className="form-input" value={f.website||''} onChange={e=>sv('website',e.target.value)} placeholder="https://"/>
      </div>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:6}}>
        <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13}}><input type="checkbox" checked={!!f.nsa_carries_inventory} onChange={e=>sv('nsa_carries_inventory',e.target.checked)}/>NSA carries inventory</label>
        <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13}}><input type="checkbox" checked={!!f.click_automation} onChange={e=>sv('click_automation',e.target.checked)}/>Click automation enabled</label>
        <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13}}><input type="checkbox" checked={!!f.invoice_scan_enabled} onChange={e=>sv('invoice_scan_enabled',e.target.checked)}/>Invoice scan enabled</label>
        <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13}}><input type="checkbox" checked={f.is_active!==false} onChange={e=>sv('is_active',e.target.checked)}/>Active</label>
      </div>
      <div style={{marginTop:12}}>
        <label className="form-label">Notes</label>
        <textarea className="form-input" value={f.notes||''} onChange={e=>sv('notes',e.target.value)} style={{minHeight:70,fontSize:12}}/>
      </div>
    </div>
    <div className="modal-footer">
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save}>{f.id&&(allVendors||[]).some(v=>v.id===f.id)?'Save':'Create Vendor'}</button>
    </div>
  </div></div>);
}

// ─── STANDALONE COACH PORTAL ───


export { VendDetail, TaxCloudSettings, CustModal, AdjModal, StripeCheckoutForm, StripePaymentModal, QuoteForm, VendorModal };
