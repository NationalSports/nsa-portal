/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { _pick, ART_FILE_SC, SZ_ORD, SC, pantoneHex, threadHex, NSA } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs, safeFirm, safeArt } from './safeHelpers';
import { Icon, Bg, calcSOStatus, PantoneAdder, PantoneQuickPicks, ThreadAdder, ThreadQuickPicks, ColorWaysEditor } from './components';
import { dP, rQ, DTF, mergeColors, calcQualifyingSpend } from './pricing';
import { fileUpload, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, printDoc, pdfDecoLabel, openFile, getBillingContacts, getAthleticDirectorContacts, sendBrevoEmail, buildBrandedEmailHtml, _brevoKey } from './utils';
import { StripePaymentModal } from './modals';
import CoachCatalogAccess from './CoachCatalogAccess';
import { supabase } from './lib/supabase';

// CUSTOMER DETAIL

function CustDetail({customer:initCust,allCustomers,allOrders,onBack,onEdit,onSelCust,onNewEst,sos,msgs,cu,onOpenSO,onOpenEst,onOpenInv,ests,invs,onSaveSO,onSaveEst,onSaveArtFiles,REPS,prod,onCopy,onDelete,onArchive,onMarkRead,onSavePromoProgram,onDeletePromoProgram,onSavePromoPeriod,onDeletePromoPeriod,onSavePromoUsage,onDeletePromoUsage,onSaveCredit,onDeleteCredit,onRefreshCustomer,onReceivePayment,nf}){
  const[tab,setTab]=useState('activity');const[oF,setOF]=useState('all');const[sF,setSF]=useState('open');const[rR,setRR]=useState('thisyear');
  const[expSOs,setExpSOs]=useState(()=>new Set());
  const toggleExpSO=id=>setExpSOs(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n});
  const[editContact,setEditContact]=useState(null);const[custLocal,setCustLocal]=useState(initCust);
  const[showInvEmail,setShowInvEmail]=useState(false);const[invEmailMsg,setInvEmailMsg]=useState('');const[invEmailOverdueOnly,setInvEmailOverdueOnly]=useState(false);const[showPortal,setShowPortal]=useState(false);
  const[showActions,setShowActions]=useState(false);const[showStatement,setShowStatement]=useState(false);const[stmtEmail,setStmtEmail]=useState('');const[stmtMsg,setStmtMsg]=useState('');const[stmtFrom,setStmtFrom]=useState('accounting');const[stmtSending,setStmtSending]=useState(false);
  const[custArtDetail,setCustArtDetail]=useState(null);
  const[custArtExpanded,setCustArtExpanded]=useState(null);// art id of expanded customer library item
  const[custArtFilter,setCustArtFilter]=useState('all');
  const[subsCollapsed,setSubsCollapsed]=useState(true);
  // Promo state
  const[promoEdit,setPromoEdit]=useState(null);// null or {type,fixed_amount,spend_percentage,notes,id?}
  const[promoNewPeriod,setPromoNewPeriod]=useState(null);// null or {program_id,allocated,notes}
  const[promoAdj,setPromoAdj]=useState(null);// null or {period_id,amount,description}
  const[promoPeriodEdit,setPromoPeriodEdit]=useState(null);// null or {id,allocated} — inline edit of a period's allocation
  // Credit state
  const[creditAdd,setCreditAdd]=useState(null);// null or {amount,source}
  const[portalJobView,setPortalJobView]=useState(null);// {job,so} when viewing a job mockup
  const[portalComment,setPortalComment]=useState('');
  const[portalContactEdit,setPortalContactEdit]=useState(null);
  const[portalContactMsg,setPortalContactMsg]=useState('');
  const[portalInvView,setPortalInvView]=useState(null);// viewing an invoice detail
  const[portalShowPay,setPortalShowPay]=useState(null);// null | 'all' | inv object
  const[portalPayLoading,setPortalPayLoading]=useState(false);// loading state for pay button
  const[portalPaySuccess,setPortalPaySuccess]=useState(null);
  const[portalApvOpen,setPortalApvOpen]=useState(false);
  const[mockupLightbox,setMockupLightbox]=useState(null);// url string for image lightbox overlay
  // NetSuite-imported (_hist) invoices keep their line items in a separate
  // table (customer_invoice_lines) that isn't loaded with the invoice header,
  // so they open with no `line_items` — both the on-screen detail and the
  // downloaded PDF then render an empty item table. Lazily fetch and attach the
  // lines the first time such an invoice is opened (at open time, not at
  // PDF-download time, so printDoc's window.open stays within the click gesture
  // and isn't blocked as a popup).
  useEffect(()=>{
    const inv=portalInvView;
    if(!inv||!inv._hist||!supabase||!inv.netsuite_internal_id||inv.line_items?.length)return;
    let cancelled=false;
    (async()=>{
      try{
        const{data,error}=await supabase
          .from('customer_invoice_lines')
          .select('line_seq,item,description,line_memo,quantity,rate,amount')
          .eq('netsuite_internal_id',inv.netsuite_internal_id)
          .order('line_seq',{ascending:true});
        if(cancelled||error||!data||!data.length)return;
        const line_items=data.map(l=>({sku:l.item||'',name:l.line_memo||l.description||'',qty:l.quantity,rate:l.rate,amount:l.amount}));
        setPortalInvView(prev=>prev&&prev.netsuite_internal_id===inv.netsuite_internal_id?{...prev,line_items}:prev);
      }catch{/* non-fatal — leave the invoice without line detail */}
    })();
    return()=>{cancelled=true};
  },[portalInvView]);
  React.useEffect(()=>setCustLocal(initCust),[initCust]);
  React.useEffect(()=>{if(!showActions)return;const close=()=>setShowActions(false);document.addEventListener('click',close);return()=>document.removeEventListener('click',close)},[showActions]);
  const customer=custLocal;
  // Auto co-op true-up: the first time this customer is opened after a period rollover (1/1 or 7/1),
  // finalize the now-current period's allocation to the full % earned from the prior half's qualifying spend.
  useEffect(()=>{
    const c=initCust;if(!c)return;
    const pId=c.parent_id||c.id;
    const pctProg=(c.promo_programs||[]).find(p=>p.is_active!==false&&p.type==='percent_of_spend'&&safeNum(p.spend_percentage)>0);
    if(!pctProg)return;const pct=safeNum(pctProg.spend_percentage);if(pct<=0)return;
    const d=new Date();const yy=d.getFullYear();const mm=d.getMonth();
    const cur=mm<6?{start:yy+'-01-01',end:yy+'-06-30'}:{start:yy+'-07-01',end:yy+'-12-31'};
    const prev=mm<6?{start:(yy-1)+'-07-01',end:(yy-1)+'-12-31'}:{start:yy+'-01-01',end:yy+'-06-30'};
    const fam=[pId,...allCustomers.filter(x=>x.parent_id===pId).map(x=>x.id)];
    const fulfilled=so=>['approved','paid','complete'].includes(so.status)||calcSOStatus(so)==='complete';
    const prevSpend=(sos||[]).filter(so=>fam.includes(so.customer_id)&&fulfilled(so)&&(()=>{const dt=(so.order_date||so.created_at||'').slice(0,10);return dt>=prev.start&&dt<=prev.end})()).reduce((a,so)=>a+calcQualifyingSpend(so),0);
    const prevEarned=Math.round(prevSpend*pct*100)/100;if(prevEarned<=0)return;
    const existing=(c.promo_periods||[]).find(p=>p.period_start===cur.start);
    const curAlloc=existing?safeNum(existing.allocated):0;
    if(prevEarned-curAlloc>0.01){
      if(existing)onSavePromoPeriod({...existing,allocated:Math.max(curAlloc,prevEarned),program_id:existing.program_id||pctProg.id,notes:existing.notes||'Auto co-op true-up'});
      else onSavePromoPeriod({id:'pp_'+pId+'_'+cur.start,customer_id:pId,program_id:pctProg.id,period_start:cur.start,period_end:cur.end,allocated:prevEarned,used:0,notes:'Auto co-op true-up',created_at:new Date().toISOString()});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initCust.id,sos]);
  const isP=!customer.parent_id;const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const tl={prepay:'Prepay',net15:'Net 15',net30:'Net 30',net60:'Net 60'};
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const custSOs=(sos||[]).filter(o=>ids.includes(o.customer_id));
  const custEsts=(ests||[]).filter(e=>ids.includes(e.customer_id));
  const orders=allOrders.filter(o=>ids.includes(o.customer_id));
  const openPortalInvs=orders.filter(o=>o.type==='invoice'&&(o.status==='open'||o.status==='partial'));
  const openInvCount=openPortalInvs.length;
  const openBalance=Math.round(openPortalInvs.reduce((a,i)=>a+safeNum(i.total)-safeNum(i.paid),0));
  const _30dAgo=new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
  const recentEsts=custEsts.filter(e=>e.status!=='approved'&&e.status!=='converted'&&(e.created_at||'').slice(0,10)>=_30dAgo);
  const fo=orders.filter(o=>{if(oF!=='all'&&o.type!==oF)return false;if(sF==='open')return['sent','draft','open','need_order','waiting_receive','needs_pull'].includes(o.status)||calcSOStatus(o)!=='complete';if(sF==='closed')return['approved','paid','complete'].includes(o.status)||calcSOStatus(o)==='complete';return true});
  const gn=id=>allCustomers.find(x=>x.id===id)?.alpha_tag||'';
  const teamName=id=>{const c=allCustomers.find(x=>x.id===id);if(!c)return'';const parent=c.parent_id?allCustomers.find(x=>x.id===c.parent_id):null;if(parent?.name&&c.name?.startsWith(parent.name))return c.name.slice(parent.name.length).trim().replace(/^[-—–]\s*/,'')||c.name;return c.name||c.alpha_tag||''};
  // Promote a sub-customer's order/estimate artwork into the parent customer's own library
  // (customer.art_files). Library art cascades to every sub-customer ("applies to all"),
  // so this is how a logo first seen on one sub-account becomes shared across the program.
  // Only meaningful when viewing a parent customer; copies the merged mockup/production
  // files so the library entry is self-contained.
  const promoteArtToLibrary=(art)=>{
    if(!isP){nf&&nf('Open the parent customer to add art to the program library','error');return}
    const nm=(art.name||'').toLowerCase();const dt=art.deco_type||'';
    const lib=customer.art_files||[];
    if(lib.some(a=>(a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt)){nf&&nf('"'+(art.name||'art')+'" is already in the program library');return}
    if(!window.confirm('Add "'+(art.name||'this art')+'" to the program library so it applies to all sub-customers?'))return;
    const mockFiles=(art._allMockups||[]).map(m=>m.file||m.url).filter(Boolean);
    const prodFiles=(art._allProd||[]).map(m=>m.file||m.url).filter(Boolean);
    const entry={id:'caf'+Date.now(),name:art.name||'',deco_type:dt||'screen_print',ink_colors:art.ink_colors||'',thread_colors:art.thread_colors||'',stitches:parseInt(art.stitches,10)||null,art_size:art.art_size||'',art_sizes:art.art_sizes||null,garment_colors:art.garment_colors||null,color_ways:art.color_ways||[],files:[],mockup_files:mockFiles,prod_files:prodFiles,notes:art.notes||'',status:art.status==='uploaded'?'needs_approval':(art.status||'approved'),uploaded:new Date().toLocaleDateString()};
    const newCust={...customer,art_files:[...lib,entry]};setCustLocal(newCust);onRefreshCustomer(newCust);
    nf&&nf('"'+(art.name||'art')+'" added to the program library — now applies to all sub-customers');
  };
  // Contact editing
  const saveContact=(idx,updated)=>{const newContacts=[...(customer.contacts||[])];newContacts[idx]=updated;const newCust={...customer,contacts:newContacts};setCustLocal(newCust);onEdit(newCust);setEditContact(null)};
  const addContact=()=>{const newContacts=[...(customer.contacts||[]),{name:'',email:'',phone:'',role:''}];setCustLocal({...customer,contacts:newContacts});setEditContact(newContacts.length-1)};
  const rmContact=(idx)=>{const newContacts=(customer.contacts||[]).filter((_,i)=>i!==idx);const newCust={...customer,contacts:newContacts};setCustLocal(newCust);onEdit(newCust)};
  // Unread messages for this customer
  const custUnread=(msgs||[]).filter(m=>custSOs.some(s=>s.id===m.so_id)&&!(m.read_by||[]).includes(cu?.id||'')).length;
  // Messages grouped by sales order — groups with unread float to the top, then by most recent message
  const isUnread=m=>!(m.read_by||[]).includes(cu?.id||'');
  const msgTs=m=>m.ts||m.created_at||'';
  const msgGroups=custSOs.map(so=>{
    const gm=(msgs||[]).filter(m=>m.so_id===so.id).slice().sort((a,b)=>(msgTs(a)||'').localeCompare(msgTs(b)||''));
    return{so,msgs:gm,unread:gm.filter(isUnread).length,last:gm.reduce((mx,m)=>{const t=msgTs(m);return t>mx?t:mx},'')};
  }).filter(g=>g.msgs.length>0)
    .sort((a,b)=>((b.unread>0)-(a.unread>0))||(b.last||'').localeCompare(a.last||''));
  const authorName=id=>{const r=(REPS||[]).find(x=>x.id===id);return r?.name||'Unknown'};
  const markGroupRead=gm=>{const ids=gm.filter(isUnread).map(m=>m.id);if(ids.length&&onMarkRead)onMarkRead(ids)};

  return(<div>
  {/* ── Mockup lightbox overlay ── */}
  {mockupLightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setMockupLightbox(null)}>
    <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setMockupLightbox(null)}>×</button>
    {_isImgUrl(mockupLightbox)?<img src={mockupLightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
    :_isPdfUrl(mockupLightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(mockupLightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
    :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
  </div>}
  <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
    <button className="btn btn-secondary" onClick={onBack}><Icon name="back" size={14}/> All Customers</button>
    {customer.parent_id&&(()=>{const par=allCustomers.find(c=>c.id===customer.parent_id);return par?<button className="btn btn-secondary" onClick={()=>onSelCust(par)}><Icon name="back" size={14}/> {par.name}</button>:null})()}
  </div>
  <div className="card" style={{marginBottom:16,overflow:'visible'}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="building" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{customer.name}</span><span className="badge badge-blue">{customer.alpha_tag}</span>{customer.adidas_ua_tier&&<span className="badge badge-green">Tier {customer.adidas_ua_tier}{({A:' (40%)',B:' (35%)',C:' (30%)'})[customer.adidas_ua_tier]||''}</span>}<span className="badge badge-gray">{tl[customer.payment_terms]||'Net 30'}</span>
      {custUnread>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{custUnread} unread</span>}
    </div>
    {(()=>{const own=(customer.search_tags||[]).filter(Boolean);const par=customer.parent_id?allCustomers.find(c=>c.id===customer.parent_id):null;const inh=(par?.search_tags||[]).filter(Boolean);return(own.length>0||inh.length>0)?<div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap',alignItems:'center'}}>
      <span style={{fontSize:10,color:'#94a3b8',fontWeight:600,textTransform:'uppercase'}}>Search Tags:</span>
      {own.map((t,i)=><span key={'st'+i} style={{display:'inline-flex',alignItems:'center',background:'#eef2ff',color:'#3730a3',border:'1px solid #c7d2fe',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:600}}>{t}</span>)}
      {inh.map((t,i)=><span key={'sti'+i} title={'Inherited from '+par.name} style={{display:'inline-flex',alignItems:'center',background:'#faf5ff',color:'#6d28d9',border:'1px dashed #d8b4fe',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:600}}>{t} <span style={{fontSize:9,marginLeft:4,opacity:.7}}>↑ parent</span></span>)}
    </div>:null})()}
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(customer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email}{i<customer.contacts.length-1&&' | '}</span>)}</div>
    {((customer.pantone_colors||[]).length>0||(customer.thread_colors||[]).length>0)&&<div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap',alignItems:'center'}}>
      {(customer.pantone_colors||[]).map((pc,i)=>{const hex=pantoneHex(pc.code)||pc.hex||'#ccc';return<span key={'p'+i} title={'PMS '+pc.code+(pc.name?' — '+pc.name:'')} style={{display:'inline-flex',alignItems:'center',gap:4,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,padding:'2px 8px 2px 4px',fontSize:10,fontWeight:600,color:'#475569'}}><span style={{width:12,height:12,borderRadius:3,background:hex,border:'1px solid #d1d5db',display:'inline-block'}}/>PMS {pc.code}</span>})}
      {(customer.thread_colors||[]).map((tc,i)=>{const hex=threadHex(tc.name)||tc.hex||'#ccc';return<span key={'t'+i} title={'Thread — '+tc.name} style={{display:'inline-flex',alignItems:'center',gap:4,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:10,padding:'2px 8px 2px 4px',fontSize:10,fontWeight:600,color:'#6d28d9'}}><span style={{width:12,height:12,borderRadius:3,background:hex,border:'1px solid #d1d5db',display:'inline-block'}}/>{tc.name}</span>})}
    </div>}
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
      <button className="btn btn-sm btn-primary" onClick={()=>onNewEst(customer)}><Icon name="file" size={12}/> Estimate</button>
      <button className="btn btn-sm btn-secondary"><Icon name="mail" size={12}/> Email</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>onEdit(customer)}><Icon name="edit" size={12}/> Edit</button>
      {(()=>{const _hasOpen=(allOrders||[]).some(o=>o.customer_id===customer.id&&(o.type==='invoice')&&o.status!=='paid'&&o.status!=='void'&&o.status!=='cancelled'&&safeNum(o.total)>safeNum(o.paid));return onReceivePayment&&_hasOpen&&<button className="btn btn-sm" style={{background:'#dcfce7',color:'#166534',border:'1px solid #86efac',fontSize:11,fontWeight:600}} onClick={()=>onReceivePayment(customer)} title="Open this customer's invoices to record a payment">💰 Receive Payment</button>})()}
      <div style={{position:'relative'}}>
        <button className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();setShowActions(!showActions)}} style={{fontSize:11}}>Actions ▾</button>
        {showActions&&<div style={{position:'absolute',top:'100%',left:0,zIndex:999,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,.12)',minWidth:180,marginTop:4,overflow:'hidden'}} onClick={()=>setShowActions(false)}>
          <div style={{padding:'8px 14px',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #f1f5f9'}} className="hover-bg" onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            onClick={()=>onCopy(customer)}><Icon name="copy" size={13}/> Copy Customer</div>
          <div style={{padding:'8px 14px',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #f1f5f9'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            onClick={()=>{const accts=getBillingContacts(customer,allCustomers);const acct=accts[0]||(customer.contacts||[])[0];setStmtEmail(accts.length>0?accts.map(a=>a.email).join(', '):(acct?.email||''));setStmtMsg('Hi '+(acct?.name||'')+',\n\nPlease find your current account statement below with all open invoices and aging details.\n\nPlease let us know if you have any questions.\n\nThank you,\nNSA Team');setStmtFrom(customer.primary_rep_id?'rep':'accounting');setShowStatement(true)}}><Icon name="file" size={13}/> Send Statement</div>
          <div style={{padding:'8px 14px',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #f1f5f9'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            onClick={()=>onArchive&&onArchive(customer)}><Icon name="archive" size={13}/> {customer.is_active===false?'Unarchive Customer':'Archive Customer'}</div>
          <div style={{padding:'8px 14px',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:8,color:'#dc2626'}} onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            onClick={()=>onDelete(customer)}><Icon name="trash" size={13}/> Delete Customer</div>
        </div>}
      </div>
      {openInvCount>0&&<>
        <span style={{width:1,background:'#e2e8f0',margin:'0 2px'}}/>
        <button className="btn btn-sm" style={{background:'#dc2626',color:'white',fontSize:11}} onClick={()=>{const _greet=getBillingContacts(customer,allCustomers)[0]?.name||(customer.contacts||[])[0]?.name||'';setInvEmailMsg('Hi '+_greet+',\n\nPlease find attached your open invoice(s). Let us know if you have any questions.\n\nThank you,\nNSA Team');setInvEmailOverdueOnly(false);setShowInvEmail(true)}}>📄 Email Invoices ({openInvCount})</button>
      </>}
      <button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:11}} onClick={()=>setShowPortal(true)}>🔗 Portal</button>
      {customer.alpha_tag&&<button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>{const url=window.location.origin+'/?portal='+customer.alpha_tag;try{navigator.clipboard&&navigator.clipboard.writeText(url)}catch(_){}window.open(url,'_blank','noopener,noreferrer')}}>📋 Open Portal Link</button>}
    </div>
  </div>
  {openBalance>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>BALANCE</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${openBalance.toLocaleString()}</div></div>}</div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Est</div><div className="stat-value">{custEsts.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Open SOs</div><div className="stat-value">{custSOs.filter(s=>calcSOStatus(s)!=='complete').length}</div></div><div className="stat-card"><div className="stat-label">Open Inv</div><div className="stat-value" style={{color:openInvCount>0?'#dc2626':''}}>{openInvCount}</div></div><div className="stat-card"><div className="stat-label">Balance</div><div className="stat-value" style={{color:openBalance>0?'#dc2626':''}}>${openBalance.toLocaleString()}</div></div></div>
  {isP&&subs.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header" style={{cursor:'pointer'}} onClick={()=>setSubsCollapsed(!subsCollapsed)}><h2>{subsCollapsed?'▶':'▼'} Sub-Customers ({subs.length})</h2></div>
  {!subsCollapsed&&<div className="card-body" style={{padding:0}}>
  {subs.map(sub=><div key={sub.id} style={{padding:'10px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>onSelCust(sub)}>
    <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{sub.name}</span><span className="badge badge-gray">{sub.alpha_tag}</span><div style={{flex:1}}/>
    {(sub._ob||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${sub._ob.toLocaleString()}</span>}</div>)}</div>}</div>}
  <div className="tabs">{['activity','messages','contacts','overview','promo','artwork','catalog','reporting'].map(t=><button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t==='activity'?'Orders':t==='messages'?'Messages'+(custUnread>0?' ('+custUnread+')':''):t==='contacts'?'Contacts'+(customer.contacts?.length?' ('+customer.contacts.length+')':''):t==='promo'?'Promo $'+(customer.promo_programs?.length||((customer.credits||[]).reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0)>0)?' ('+(customer.promo_programs?.length?customer.promo_programs.length+' promo':'')+(customer.promo_programs?.length&&(customer.credits||[]).reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0)>0?' · ':'')+(((customer.credits||[]).reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0)>0)?'$'+((customer.credits||[]).reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0)).toLocaleString()+' credit':'')+')':''):t[0].toUpperCase()+t.slice(1)}</button>)}</div>

  {/* ORDERS TAB — with live SO status */}
  {tab==='activity'&&<>
    {/* Active SOs with fulfillment progress + nested jobs. Booking SOs (still
        far from their ship date) are split into their own section below so
        they don't crowd out work-in-flight orders. */}
    {(()=>{
      const activeSOs=custSOs.filter(s=>{const st=calcSOStatus(s);return st!=='complete'&&st!=='booking'});
      const bookingSOs=custSOs.filter(s=>calcSOStatus(s)==='booking');
      const renderSORow=(so)=>{
        const st=calcSOStatus(so);const stL={booking:'Booking',need_order:'Need to Order',waiting_receive:'Waiting to Receive',needs_pull:'Needs Pull',items_received:'Items Received',in_production:'In Production',ready_to_invoice:'Ready to Invoice',complete:'Complete'};
        let totalU=0,fulU=0;
        // Count units from the size grid; for qty-only lines (no size breakdown) the count lives in est_qty.
        safeItems(so).forEach(it=>{const _szEntries=Object.entries(safeSizes(it)).filter(([,v])=>v>0);if(_szEntries.length){_szEntries.forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+(pk[sz]||0),0);const rQ=safePOs(it).reduce((a,pk)=>a+((pk.received||{})[sz]||0),0);fulU+=Math.min(v,pQ+rQ)})}else{totalU+=safeNum(it.est_qty)}});
        const pct=totalU>0?Math.round(fulU/totalU*100):0;
        const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
        const jobs=so.jobs||[];
        const subC=allCustomers.find(c=>c.id===so.customer_id);
        const rep=REPS.find(r=>r.id===(subC?.primary_rep_id||so.created_by));
        const af=safeArt(so);const aq={};safeItems(so).forEach(it2=>{const sq2=Object.values(safeSizes(it2)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it2.est_qty);safeDecos(it2).forEach(d=>{if(d.kind==='art'&&d.art_file_id){aq[d.art_file_id]=(aq[d.art_file_id]||0)+q2}})});
        let soRev=0;safeItems(so).forEach(it2=>{const sq2=Object.values(safeSizes(it2)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it2.est_qty);if(!q2)return;soRev+=q2*safeNum(it2.unit_sell);safeDecos(it2).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?aq[d.art_file_id]:q2;const dp2=dP(d,q2,af,cq);const eq=dp2._nq!=null?dp2._nq:(d.reversible?q2*2:q2);soRev+=eq*dp2.sell})});
        const soShip=so.shipping_type==='pct'?soRev*(so.shipping_value||0)/100:(so.shipping_value||0);const soTax=soRev*(subC?.tax_exempt?0:(subC?.tax_rate||0));const soGrand=soRev+soShip+soTax;
        const jobArtLabels={needs_art:'Needs Art',waiting_approval:'Wait Approval',art_complete:'Art ✓'};
        const jobProdLabels={hold:'Ready',staging:'In Line',in_process:'In Process',completed:'Done',shipped:'Shipped'};
        const jobItemLabels={need_to_order:'Need Order',partially_received:'Partial',items_received:'Received'};
        const hasJobChildren=jobs.length>0||true;// show toggle even for "no decorations" rows
        const isExp=expSOs.has(so.id);
        return<React.Fragment key={so.id}>
          <tr style={{cursor:'pointer',background:'white'}} onClick={()=>onOpenSO&&onOpenSO(so)}>
            <td style={{fontWeight:700,color:'#1e40af'}}>
              {hasJobChildren&&<button onClick={e=>{e.stopPropagation();toggleExpSO(so.id)}} title={isExp?'Hide jobs':'Show jobs'} style={{marginRight:6,padding:0,background:'transparent',border:'none',cursor:'pointer',color:'#64748b',fontSize:10,width:14,display:'inline-block',textAlign:'center'}}>{isExp?'▼':'▶'}</button>}
              {so.id}
              {jobs.length>0&&!isExp&&<span style={{marginLeft:6,fontSize:10,color:'#94a3b8',fontWeight:500}}>({jobs.length} {jobs.length===1?'job':'jobs'})</span>}
            </td>
            <td>{so.memo}</td>
            {isP&&<td><span className="badge badge-gray" title={subC?.alpha_tag||''}>{teamName(so.customer_id)||subC?.alpha_tag}</span></td>}
            {isP&&<td style={{fontSize:11,color:'#64748b'}}>{rep?.name?.split(' ')[0]||'—'}</td>}
            <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[st]?.bg,color:SC[st]?.c}}>{stL[st]}</span></td>
            <td>{safeItems(so).length} items · {totalU} units</td>
            <td><div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:60,background:'#e2e8f0',borderRadius:3,height:5,overflow:'hidden'}}><div style={{height:5,borderRadius:3,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%'}}/></div>
              <span style={{fontSize:11,fontWeight:600}}>{pct}% ({fulU}/{totalU})</span></div></td>
            <td style={{textAlign:'right',fontWeight:700,color:'#1e293b'}}>${soGrand.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td style={{color:daysOut!=null&&daysOut<=7?'#dc2626':'#64748b',fontWeight:daysOut!=null&&daysOut<=7?700:400}}>{so.expected_date||'—'}{daysOut!=null&&daysOut>=0&&<span style={{fontSize:10,color:'#94a3b8',marginLeft:4}}>({daysOut}d)</span>}</td>
          </tr>
          {/* Nested jobs under this SO — collapsed by default */}
          {isExp&&jobs.length>0&&jobs.map(j=><tr key={j.id} style={{background:'#f8fafc',cursor:'pointer'}} onClick={()=>onOpenSO&&onOpenSO(so)}>
            <td style={{paddingLeft:28,color:'#64748b',fontSize:11}}>↳ {j.id}</td>
            <td style={{fontSize:11}}>{j.art_name} <span style={{color:'#94a3b8'}}>({j.deco_type?.replace(/_/g,' ')})</span></td>
            {isP&&<td/>}{isP&&<td/>}
            <td><div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
              <span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{jobItemLabels[j.item_status]||j.item_status}</span>
              <span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{jobArtLabels[j.art_status]||j.art_status}</span>
            </div></td>
            <td style={{fontSize:11}}>{(j.items||[]).map(gi=>gi.sku).join(', ')||'—'}</td>
            <td><div style={{display:'flex',alignItems:'center',gap:4}}>
              <div style={{width:40,background:'#e2e8f0',borderRadius:3,height:4,overflow:'hidden'}}><div style={{height:4,borderRadius:3,background:j.fulfilled_units>=j.total_units?'#22c55e':j.fulfilled_units>0?'#f59e0b':'#e2e8f0',width:(j.total_units>0?j.fulfilled_units/j.total_units*100:0)+'%'}}/></div>
              <span style={{fontSize:10}}>{j.fulfilled_units}/{j.total_units}</span></div></td>
            <td/>
            <td><span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#64748b'}}>{jobProdLabels[j.prod_status]||j.prod_status}</span></td>
          </tr>)}
          {isExp&&jobs.length===0&&<tr style={{background:'#f8fafc'}}><td colSpan={isP?9:7} style={{paddingLeft:28,fontSize:10,color:'#94a3b8',fontStyle:'italic'}}>No decorations assigned yet</td></tr>}
        </React.Fragment>};
      const renderTable=(list)=><table style={{fontSize:12}}><thead><tr><th>SO</th><th>Memo</th>{isP&&<th>Customer</th>}{isP&&<th>Rep</th>}<th>Status</th><th>Items</th><th>Fulfillment</th><th style={{textAlign:'right'}}>Total</th><th>Expected</th></tr></thead><tbody>{list.map(renderSORow)}</tbody></table>;
      return<>
        {activeSOs.length>0&&<div className="card" style={{marginBottom:12}}><div className="card-header"><h2>Active Sales Orders</h2></div><div className="card-body" style={{padding:0}}>{renderTable(activeSOs)}</div></div>}
        {recentEsts.length>0&&<div className="card" style={{marginBottom:12}}><div className="card-header" style={{background:'#fdf4ff',borderBottom:'1px solid #e9d5ff'}}><h2 style={{color:'#7c3aed'}}>Open Estimates</h2><span style={{fontSize:11,color:'#a855f7',marginLeft:8}}>Pending approval — within 30 days</span></div><div className="card-body" style={{padding:0}}><table style={{fontSize:12}}><thead><tr><th>EST</th><th>Memo</th>{isP&&<th>Customer</th>}<th>Status</th><th style={{textAlign:'right'}}>Total</th><th>Created</th></tr></thead><tbody>{recentEsts.map(e=>{const o=orders.find(ord=>ord.id===e.id);const subC=allCustomers.find(c=>c.id===e.customer_id);return<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>onOpenEst&&onOpenEst(e)}><td style={{fontWeight:700,color:'#7c3aed'}}>{e.id}</td><td>{e.memo||'—'}</td>{isP&&<td><span className="badge badge-gray">{subC?.alpha_tag||''}</span></td>}<td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:e.status==='sent'?'#fef3c7':'#f1f5f9',color:e.status==='sent'?'#92400e':'#64748b'}}>{e.status==='draft'?'Draft':'Sent'}</span></td><td style={{textAlign:'right',fontWeight:700}}>{o?.total!=null?'$'+o.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td><td style={{color:'#64748b'}}>{(e.created_at||'').slice(0,10)}</td></tr>})}</tbody></table></div></div>}
        {bookingSOs.length>0&&<div className="card" style={{marginBottom:12}}><div className="card-header" style={{background:'#eef2ff',borderBottom:'1px solid #c7d2fe'}}><h2 style={{color:'#4338ca'}}>Booking Orders ({bookingSOs.length})</h2><span style={{fontSize:11,color:'#6366f1',marginLeft:8}}>Future ship dates — not yet in production</span></div><div className="card-body" style={{padding:0}}>{renderTable(bookingSOs)}</div></div>}
      </>})()}
    {/* All transactions — unified: est, SO, inv, IF, PO, payments */}
    {(()=>{
      // Build unified transaction list
      const txns=[];
      // Existing orders (est, SO, inv)
      orders.forEach(o=>{txns.push({id:o.id,type:o.type,date:o.date||o.created_at?.split(' ')[0],memo:o.memo,customer_id:o.customer_id,total:o.total,status:o.status,so_id:o.type==='sales_order'?o.id:null,_src:'order',_o:o})});
      // IFs and POs from SOs
      custSOs.forEach(so=>{
        const subC=allCustomers.find(c=>c.id===so.customer_id);
        safeItems(so).forEach(it=>{
          safePicks(it).forEach(pk=>{
            if(!pk.pick_id)return;
            const qty=Object.entries(pk).filter(([k,v])=>k!=='status'&&k!=='pick_id'&&k!=='created_at'&&k!=='memo'&&typeof v==='number'&&v>0).reduce((a,[,v])=>a+v,0);
            txns.push({id:pk.pick_id,type:'if',date:pk.created_at||'',memo:it.name+' ('+it.sku+')'+' — '+so.memo,customer_id:so.customer_id,total:null,status:pk.status,so_id:so.id,_src:'if'});
          });
          safePOs(it).forEach(po=>{
            if(!po.po_id)return;
            const qty=Object.entries(po).filter(([k,v])=>k!=='status'&&k!=='po_id'&&k!=='vendor'&&k!=='created_at'&&k!=='memo'&&k!=='received'&&k!=='ship_dates'&&k!=='drop_ship'&&typeof v==='number'&&v>0).reduce((a,[,v])=>a+v,0);
            const cost=qty*(it.unit_cost||0);
            txns.push({id:po.po_id,type:'po',date:po.created_at||'',memo:it.name+' ('+it.sku+')'+' — '+(po.vendor||'Vendor'),customer_id:so.customer_id,total:cost>0?cost:null,status:po.status,so_id:so.id,_src:'po'});
          });
        });
      });
      // Deduplicate IFs and POs by id (same IF can appear on multiple items)
      const seen=new Set();const deduped=[];
      txns.forEach(t=>{const key=t.id+t._src;if(!seen.has(key)){seen.add(key);deduped.push(t)}});

      const typeLabels={estimate:'Est',sales_order:'SO',invoice:'Inv',if:'IF',po:'PO',payment:'Pmt'};
      const typeBadge={estimate:'badge-amber',sales_order:'badge-blue',invoice:'badge-red',if:'badge-green',po:'badge-purple',payment:'badge-green'};
      const statusBadge=st=>{if(!st)return'badge-gray';if(['open','sent','waiting','needs_pull'].includes(st))return'badge-amber';if(['approved','paid','pulled','received','complete'].includes(st))return'badge-green';if(['draft','cancelled'].includes(st))return'badge-gray';return'badge-blue'};

      // Filter
      const filt=deduped.filter(t=>{
        if(oF!=='all'&&t.type!==oF)return false;
        if(sF==='open')return['sent','draft','open','waiting','needs_pull','in_production','need_order','waiting_receive','partial'].includes(t.status)||(t.type==='estimate'&&t.status==='approved');
        if(sF==='closed')return(t.type==='estimate'?['converted','cancelled']:['approved','paid','pulled','received','complete','completed','shipped','cancelled']).includes(t.status);
        return true;
      }).sort((a,b)=>(b.date||'').localeCompare(a.date||''));

      return<div className="card"><div className="card-header"><h2>All Transactions</h2><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {[['all','All'],['estimate','Est'],['sales_order','SO'],['invoice','Inv'],['if','IF'],['po','PO']].map(([v,l])=><button key={v} className={`btn btn-sm ${oF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOF(v)}>{l}</button>)}
        <span style={{width:1,background:'#e2e8f0',margin:'0 4px'}}/>
        {[['all','All'],['open','Open'],['closed','Closed']].map(([v,l])=><button key={v} className={`btn btn-sm ${sF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setSF(v)}>{l}</button>)}
      </div></div><div className="card-body" style={{padding:0}}><table style={{fontSize:12}}><thead><tr><th>ID</th><th>Type</th><th>Date</th><th>SO</th><th>Memo</th>{isP&&<th>Sub</th>}<th>Amount</th><th>Status</th></tr></thead><tbody>
        {filt.length===0?<tr><td colSpan={8} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>:
        filt.map((t,i)=><tr key={t.id+'-'+i} style={{cursor:(t._src==='order'||t.type==='estimate'||t.type==='invoice'||t.so_id)?'pointer':undefined}} onClick={()=>{if(t.type==='estimate'){const est2=(ests||[]).find(e=>e.id===t.id);if(est2&&onOpenEst)onOpenEst(est2)}else if(t.type==='invoice'){if(onOpenInv){const inv2=(invs||[]).find(x=>x.id===t.id)||t;onOpenInv(inv2)}}else if(t._src==='order'){const so2=(sos||[]).find(s=>s.id===t.id);if(so2&&onOpenSO)onOpenSO(so2)}else if(t.so_id){const so2=(sos||[]).find(s=>s.id===t.so_id);if(so2&&onOpenSO)onOpenSO(so2)}}}>
          <td style={{fontWeight:700,color:'#1e40af'}}>{t.id}</td>
          <td><span className={`badge ${typeBadge[t.type]||'badge-gray'}`}>{typeLabels[t.type]||t.type}</span></td>
          <td style={{fontSize:11,color:'#64748b'}}>{t.date}</td>
          <td style={{fontSize:11,color:'#94a3b8'}}>{t.so_id&&t._src!=='order'?t.so_id:'—'}</td>
          <td>{t.memo}</td>
          {isP&&<td><span className="badge badge-gray" title={gn(t.customer_id)}>{teamName(t.customer_id)||gn(t.customer_id)}</span></td>}
          <td style={{fontWeight:t.total?700:400,color:t.type==='invoice'&&t.status==='open'?'#dc2626':t.total?'#374151':'#94a3b8'}}>{t.total?'$'+t.total.toLocaleString():'—'}</td>
          <td><span className={`badge ${statusBadge(t.status)}`}>{t.status?.replace(/_/g,' ')||'—'}</span></td>
        </tr>)}</tbody></table></div></div>})()}
  </>}

  {/* MESSAGES TAB — grouped by sales order, unread groups first */}
  {tab==='messages'&&<div className="card"><div className="card-header"><h2>Messages{custUnread>0?' — '+custUnread+' unread':''}</h2>{custUnread>0&&<button className="btn btn-sm btn-secondary" onClick={()=>markGroupRead(msgGroups.flatMap(g=>g.msgs))}>Mark all read</button>}</div><div className="card-body">
    {msgGroups.length===0?<div style={{fontSize:13,color:'#94a3b8',fontStyle:'italic',padding:'8px 4px'}}>No messages on this customer's orders yet.</div>:
    msgGroups.map(g=><div key={g.so.id} style={{border:'1px solid #e2e8f0',borderRadius:8,marginBottom:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',flexWrap:'wrap'}}>
        <span style={{fontWeight:700,fontSize:13,color:'#1e40af',cursor:onOpenSO?'pointer':'default',textDecoration:onOpenSO?'underline':'none'}} onClick={()=>onOpenSO&&onOpenSO(g.so)}>{g.so.id}</span>
        {g.so.memo&&<span style={{fontSize:12,color:'#64748b'}}>{g.so.memo}</span>}
        <span style={{fontSize:11,color:'#94a3b8'}}>{g.msgs.length} message{g.msgs.length!==1?'s':''}</span>
        {g.unread>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{g.unread} unread</span>}
        {g.unread>0&&<button className="btn btn-sm btn-secondary" style={{marginLeft:'auto',fontSize:11}} onClick={()=>markGroupRead(g.msgs)}>Mark read</button>}
      </div>
      <div>{g.msgs.map((m,mi)=>{const un=isUnread(m);return<div key={m.id||mi} style={{padding:'8px 12px',borderBottom:mi<g.msgs.length-1?'1px solid #f1f5f9':'none',borderLeft:un?'3px solid #dc2626':'3px solid transparent',background:un?'#fef2f2':'white'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#1e40af'}}>{m.is_system?'System':authorName(m.author_id)} <span style={{fontWeight:400,color:'#94a3b8',fontSize:9}}>{msgTs(m)?new Date(msgTs(m)).toLocaleString():''}</span>{un&&<span style={{marginLeft:6,fontSize:9,color:'#dc2626',fontWeight:700}}>● NEW</span>}</div>
        <div style={{fontSize:12,color:'#334155',marginTop:2,whiteSpace:'pre-wrap'}}>{m.text}</div>
      </div>})}</div>
    </div>)}
  </div></div>}

  {/* CONTACTS TAB — editable */}
  {tab==='contacts'&&(()=>{
    const inheritedAccts=getBillingContacts(customer,allCustomers).filter(a=>a._inherited_from);
    const inheritedADs=getAthleticDirectorContacts(customer,allCustomers).filter(a=>a._inherited_from);
    const renderInherited=(items,label,roleHint)=>items.length>0&&<div style={{padding:'10px 18px',background:'#faf5ff',borderBottom:'1px solid #e9d5ff'}}>
      <div style={{fontSize:11,fontWeight:700,color:'#6d28d9',marginBottom:6}}>INHERITED {label}{items.length>1?'S':''} (from parent)</div>
      {items.map((c,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'6px 0'}}>
        <div style={{width:32,height:32,borderRadius:16,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#6d28d9',fontSize:13}}>{(c.name||'?')[0]}</div>
        <div style={{flex:1}}>
          <div><strong>{c.name}</strong> <span style={{fontSize:11,color:'#6d28d9'}}>({roleHint})</span></div>
          <div style={{fontSize:12,color:'#64748b'}}>{c.email}{c.phone&&` · ${c.phone}`}</div>
          <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>From parent: {c._inherited_from} — edit on parent to change</div>
        </div>
      </div>)}
    </div>;
    return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
    <h2>Contacts</h2><button className="btn btn-sm btn-primary" onClick={addContact}><Icon name="plus" size={12}/> Add Contact</button>
  </div><div className="card-body" style={{padding:0}}>
    {renderInherited(inheritedAccts,'BILLING CONTACT',"Billing · auto-CC'd")}
    {renderInherited(inheritedADs,'ATHLETIC DIRECTOR','Athletic Director')}
    {(customer.contacts||[]).length===0&&inheritedAccts.length===0&&inheritedADs.length===0&&<div style={{padding:20,textAlign:'center',color:'#94a3b8'}}>No contacts</div>}
    {(customer.contacts||[]).map((c,i)=>editContact===i?
      <div key={i} style={{padding:14,borderBottom:'1px solid #f1f5f9',background:'#fffbeb'}}>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Name</label><input className="form-input" value={c.name} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],name:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Role</label><input className="form-input" value={c.role} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],role:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:180}}><label className="form-label">Email</label><input className="form-input" type="email" value={c.email} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],email:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Phone</label><input className="form-input" value={c.phone||''} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],phone:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm btn-primary" onClick={()=>saveContact(i,customer.contacts[i])}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={()=>{setCustLocal(initCust);setEditContact(null)}}>Cancel</button>
          <button className="btn btn-sm" style={{background:'#dc2626',color:'white',marginLeft:'auto'}} onClick={()=>{if(window.confirm('Delete this contact?'))rmContact(i)}}>Delete</button>
        </div>
      </div>
    :<div key={i} style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:36,height:36,borderRadius:18,background:'#e0e7ff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#3730a3',fontSize:14}}>{(c.name||'?')[0]}</div>
        <div style={{flex:1}}>
          <div><strong>{c.name}</strong> <span style={{fontSize:11,color:'#64748b'}}>({c.role})</span></div>
          <div style={{fontSize:12,color:'#64748b'}}>{c.email}{c.phone&&` · ${c.phone}`}</div>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={()=>setEditContact(i)}><Icon name="edit" size={12}/></button>
      </div>)}
  </div></div>;
  })()}

  {tab==='overview'&&<div className="card"><div className="card-header"><h2>Info</h2></div><div className="card-body">
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12}}><div><div className="form-label">Billing</div><div style={{fontSize:13}}>{customer.billing_address_line1||'--'}<br/>{customer.billing_city}, {customer.billing_state} {customer.billing_zip}</div></div>
    <div><div className="form-label">Shipping</div><div style={{fontSize:13}}>{customer.shipping_address_line1||'--'}<br/>{customer.shipping_city}, {customer.shipping_state}</div></div>
    <div><div className="form-label">Tax</div><div style={{fontSize:13}}>{customer.tax_exempt?<span style={{color:'#dc2626',fontWeight:700}}>TAX EXEMPT</span>:customer.tax_rate?(customer.tax_rate*100).toFixed(3)+'%':'No rate set'}</div></div>
    <div><div className="form-label">Sales Rep</div><div style={{fontSize:13,fontWeight:600}}>{customer.primary_rep_id?REPS.find(r=>r.id===customer.primary_rep_id)?.name||'Unknown':'— Not assigned —'}</div></div></div>
  </div></div>}
  {/* SCHOOL COLORS — Pantone color management on overview tab */}
  {tab==='overview'&&(()=>{
    const colors=customer.pantone_colors||[];
    const savePantones=(newColors)=>{const newCust={...customer,pantone_colors:newColors};setCustLocal(newCust);onRefreshCustomer(newCust)};
    return<div className="card" style={{marginTop:12}}><div className="card-header"><h2>School Colors (Pantone)</h2></div><div className="card-body">
      {colors.length===0&&<div style={{fontSize:12,color:'#94a3b8',marginBottom:8}}>No Pantone colors added yet.</div>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
        {colors.map((pc,i)=>{const hex=pantoneHex(pc.code)||pc.hex||'#ccc';const isDark=(hex)=>{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return(r*299+g*587+b*114)/1000<140};
          return<div key={i} style={{display:'flex',alignItems:'center',gap:8,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'6px 10px'}}>
            <div style={{width:28,height:28,borderRadius:6,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
            <div><div style={{fontSize:12,fontWeight:700,color:'#1e293b'}}>PMS {pc.code}</div>{pc.name&&<div style={{fontSize:10,color:'#64748b'}}>{pc.name}</div>}</div>
            <button onClick={()=>savePantones(colors.filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:2,marginLeft:4}} title="Remove"><Icon name="x" size={12}/></button>
          </div>})}
      </div>
      <PantoneAdder onAdd={(pc)=>savePantones([...colors,pc])} existingCodes={colors.map(c=>c.code)}/>
    </div></div>})()}
  {/* THREAD COLORS — Embroidery thread color management on overview tab */}
  {tab==='overview'&&(()=>{
    const threads=customer.thread_colors||[];
    const saveThreads=(newColors)=>{const newCust={...customer,thread_colors:newColors};setCustLocal(newCust);onRefreshCustomer(newCust)};
    return<div className="card" style={{marginTop:12}}><div className="card-header"><h2 style={{color:'#7c3aed'}}>Thread Colors (Embroidery)</h2></div><div className="card-body">
      {threads.length===0&&<div style={{fontSize:12,color:'#94a3b8',marginBottom:8}}>No thread colors added yet.</div>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
        {threads.map((tc,i)=>{const hex=threadHex(tc.name)||tc.hex||'#ccc';
          return<div key={i} style={{display:'flex',alignItems:'center',gap:8,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'6px 10px'}}>
            <div style={{width:28,height:28,borderRadius:6,background:hex,border:'1px solid #d1d5db',flexShrink:0}}/>
            <div style={{fontSize:12,fontWeight:700,color:'#1e293b'}}>{tc.name}</div>
            <button onClick={()=>saveThreads(threads.filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:2,marginLeft:4}} title="Remove"><Icon name="x" size={12}/></button>
          </div>})}
      </div>
      <ThreadAdder onAdd={(tc)=>saveThreads([...threads,tc])} existingNames={threads.map(t=>t.name)}/>
    </div></div>})()}
  {/* PROMO DOLLARS TAB */}
  {tab==='promo'&&(()=>{
    // Promo $ is owned by the parent customer; subs inherit (data is loaded with parent's id at the App level).
    const parentId=customer.parent_id||customer.id;
    const parentCust=customer.parent_id?(allCustomers.find(c=>c.id===customer.parent_id)||customer):customer;
    const programs=customer.promo_programs||[];let periods=customer.promo_periods||[];const usage=customer.promo_usage||[];
    const now=new Date();const y=now.getFullYear();const m=now.getMonth();
    const curPeriod=m<6?{start:y+'-01-01',end:y+'-06-30',label:'H1 '+y}:{start:y+'-07-01',end:y+'-12-31',label:'H2 '+y};
    let curPeriods=periods.filter(p=>p.period_start===curPeriod.start);
    // Auto-allocate current period from fixed programs if none exists
    if(curPeriods.length===0){
      const fixedProgs=programs.filter(p=>p.is_active!==false&&p.type==='fixed'&&safeNum(p.fixed_amount)>0);
      const totalFixed=fixedProgs.reduce((a,p)=>a+safeNum(p.fixed_amount),0);
      if(totalFixed>0){
        const newPd={id:'pp_'+parentId+'_'+curPeriod.start,customer_id:parentId,period_start:curPeriod.start,period_end:curPeriod.end,allocated:totalFixed,used:0,created_at:new Date().toISOString()};
        onSavePromoPeriod(newPd);curPeriods=[newPd];periods=[...periods,newPd];
      }
    }
    const curBalance=curPeriods.reduce((a,p)=>a+(p.allocated||0)-(p.used||0),0);
    const curAllocated=curPeriods.reduce((a,p)=>a+(p.allocated||0),0);
    const curUsed=curPeriods.reduce((a,p)=>a+(p.used||0),0);
    // Split non-current periods into upcoming (future) and past so future allocations don't read as "Past".
    const otherPeriods=periods.filter(p=>p.period_start!==curPeriod.start);
    const upcomingPeriods=otherPeriods.filter(p=>(p.period_start||'')>curPeriod.start).sort((a,b)=>a.period_start.localeCompare(b.period_start));
    const pastPeriods=otherPeriods.filter(p=>(p.period_start||'')<curPeriod.start).sort((a,b)=>b.period_start.localeCompare(a.period_start));
    // Co-op earning: live % of qualifying (≥20% margin) net spend this half, destined for the next half.
    const pctProg=programs.find(p=>p.is_active!==false&&p.type==='percent_of_spend'&&safeNum(p.spend_percentage)>0);
    const pct=pctProg?safeNum(pctProg.spend_percentage):0;
    const famIds=[parentId,...allCustomers.filter(c=>c.parent_id===parentId).map(c=>c.id)];
    const _fulfilled=so=>['approved','paid','complete'].includes(so.status)||calcSOStatus(so)==='complete';
    const _spendInRange=(s,e)=>(sos||[]).filter(so=>famIds.includes(so.customer_id)&&_fulfilled(so)&&(()=>{const d=(so.order_date||so.created_at||'').slice(0,10);return d>=s&&d<=e})()).reduce((a,so)=>a+calcQualifyingSpend(so),0);
    const curHalfSpend=pct>0?_spendInRange(curPeriod.start,curPeriod.end):0;
    const curEarned=pct>0?Math.round(curHalfSpend*pct*100)/100:0;
    const nextPeriod=m<6?{start:y+'-07-01',end:y+'-12-31',label:'H2 '+y}:{start:(y+1)+'-01-01',end:(y+1)+'-06-30',label:'H1 '+(y+1)};
    const nextExisting=periods.find(p=>p.period_start===nextPeriod.start);
    const nextPulled=nextExisting?safeNum(nextExisting.allocated):0;
    const doPullForward=()=>{
      if(curEarned<=0){nf('No qualifying spend yet this half','error');return}
      if(curEarned<=nextPulled){nf('Already pulled forward — earned hasn\'t increased','error');return}
      if(nextExisting)onSavePromoPeriod({...nextExisting,allocated:Math.max(safeNum(nextExisting.allocated),curEarned),program_id:nextExisting.program_id||pctProg?.id||null,notes:nextExisting.notes||('Pulled forward from '+curPeriod.label+' spend')});
      else onSavePromoPeriod({id:'pp_'+parentId+'_'+nextPeriod.start,customer_id:parentId,program_id:pctProg?.id||null,period_start:nextPeriod.start,period_end:nextPeriod.end,allocated:curEarned,used:0,notes:'Pulled forward from '+curPeriod.label+' spend',created_at:new Date().toISOString()});
      nf('Pulled forward $'+curEarned.toLocaleString()+' to '+nextPeriod.label);
    };
    // Inline allocated cell + Edit/Delete actions for a period row (Upcoming / Past tables).
    const _allocCell=p=>(promoPeriodEdit&&promoPeriodEdit.id===p.id)
      ?<td><input className="form-input" type="number" style={{width:90}} value={promoPeriodEdit.allocated} onChange={e=>setPromoPeriodEdit({...promoPeriodEdit,allocated:parseFloat(e.target.value)||0})}/></td>
      :<td>${(p.allocated||0).toLocaleString()}</td>;
    const _periodActions=p=>{const used=safeNum(p.used);
      if(promoPeriodEdit&&promoPeriodEdit.id===p.id)return<td style={{whiteSpace:'nowrap'}}>
        <button className="btn btn-sm btn-primary" onClick={()=>{onSavePromoPeriod({...p,allocated:safeNum(promoPeriodEdit.allocated)});setPromoPeriodEdit(null)}}>Save</button>
        <button className="btn btn-sm btn-secondary" style={{marginLeft:4}} onClick={()=>setPromoPeriodEdit(null)}>Cancel</button>
      </td>;
      return<td style={{whiteSpace:'nowrap'}}>
        <button className="btn btn-sm btn-secondary" onClick={()=>setPromoPeriodEdit({id:p.id,allocated:safeNum(p.allocated)})}>Edit</button>
        <button className="btn btn-sm" style={{color:'#dc2626',marginLeft:4}} title={used>0?'$'+used.toLocaleString()+' is used by orders — remove promo from those first':'Delete period'} onClick={()=>{
          if(used>0){nf('Can\'t delete — $'+used.toLocaleString()+' is used by orders. Remove promo from those orders first.','error');return}
          if(window.confirm('Delete this promo period ($'+safeNum(p.allocated).toLocaleString()+' allocated)?'))onDeletePromoPeriod&&onDeletePromoPeriod(p.id);
        }}>× Delete</button>
      </td>;
    };
    return<div style={{display:'flex',flexDirection:'column',gap:12}}>
      {customer.parent_id&&parentCust&&parentCust.id!==customer.id&&<div style={{padding:'8px 12px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,fontSize:12,color:'#1e40af'}}>Promo $ is shared with parent account <strong style={{cursor:'pointer',textDecoration:'underline'}} onClick={()=>onSelCust&&onSelCust(parentCust)}>{parentCust.name}</strong> — changes here apply to all sub-accounts.</div>}
      {/* Current Balance */}
      <div className="card"><div className="card-header"><h2>Promo Balance — {curPeriod.label}</h2></div>
        <div className="card-body">
          <div className="stats-row">
            <div className="stat-card"><div className="stat-label">Allocated</div><div className="stat-value" style={{color:'#2563eb'}}>${curAllocated.toLocaleString()}</div></div>
            <div className="stat-card"><div className="stat-label">Used</div><div className="stat-value" style={{color:'#dc2626'}}>${curUsed.toLocaleString()}</div></div>
            <div className="stat-card"><div className="stat-label">Remaining</div><div className="stat-value" style={{color:curBalance>0?'#166534':'#94a3b8'}}>${curBalance.toLocaleString()}</div></div>
          </div>
          {curPeriods.length>0&&<div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>USAGE THIS PERIOD</div>
            {usage.filter(u=>curPeriods.some(p=>p.id===u.period_id)).length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No promo used this period</div>:
            <table style={{fontSize:12}}><thead><tr><th>Date</th><th>Order</th><th>Description</th><th>Amount</th></tr></thead><tbody>
              {usage.filter(u=>curPeriods.some(p=>p.id===u.period_id)).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).map((u,i)=>
                <tr key={i}><td style={{color:'#64748b'}}>{u.created_at?new Date(u.created_at).toLocaleDateString():'-'}</td><td style={{fontWeight:600,color:'#1e40af'}}>{u.so_id?<span style={{cursor:'pointer',textDecoration:'underline'}} onClick={()=>{const so=(sos||[]).find(s=>s.id===u.so_id);if(so&&onOpenSO)onOpenSO(so);else if(onOpenSO)onOpenSO(u.so_id)}}>{u.so_id}</span>:'-'}{u.estimate_id&&<span style={{fontSize:10,color:'#94a3b8',marginLeft:4,cursor:onOpenEst?'pointer':'default',textDecoration:onOpenEst?'underline':'none'}} onClick={()=>{if(!onOpenEst)return;const est=(ests||[]).find(e=>e.id===u.estimate_id);if(est)onOpenEst(est)}}>({u.estimate_id})</span>}</td><td>{u.description||'-'}</td><td style={{fontWeight:700,color:'#dc2626'}}>${(u.amount||0).toLocaleString()}</td></tr>)}
            </tbody></table>}
          </div>}
          {/* Manual adjustment */}
          {promoAdj?<div style={{marginTop:12,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Manual Adjustment</div>
            <div style={{display:'flex',gap:8,alignItems:'end',flexWrap:'wrap'}}>
              <div><label className="form-label">Amount ($)</label><input className="form-input" type="number" style={{width:100}} value={promoAdj.amount||''} onChange={e=>setPromoAdj({...promoAdj,amount:parseFloat(e.target.value)||0})}/></div>
              <div style={{flex:1}}><label className="form-label">Description</label><input className="form-input" value={promoAdj.description||''} onChange={e=>setPromoAdj({...promoAdj,description:e.target.value})}/></div>
              <button className="btn btn-sm btn-primary" onClick={()=>{
                if(!promoAdj.amount){nf('Enter an amount','error');return}
                const pd=curPeriods[0];if(!pd){nf('No active period — create one first','error');return}
                onSavePromoUsage({period_id:pd.id,amount:promoAdj.amount,description:promoAdj.description||'Manual adjustment',created_by:cu?.name||'System',so_id:null,estimate_id:null});
                onSavePromoPeriod({...pd,used:(pd.used||0)+promoAdj.amount});
                setPromoAdj(null);nf('Adjustment saved');
              }}>Save</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setPromoAdj(null)}>Cancel</button>
            </div>
          </div>:curPeriods.length>0&&<button className="btn btn-sm btn-secondary" style={{marginTop:8}} onClick={()=>setPromoAdj({period_id:curPeriods[0]?.id,amount:0,description:''})}>± Adjust Balance</button>}
        </div>
      </div>

      {/* Earning this half (% of spend co-op) */}
      {pctProg&&<div className="card"><div className="card-header"><h2>Earning This Half — {curPeriod.label}</h2></div>
        <div className="card-body">
          <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
            <div style={{fontSize:13,color:'#334155',flex:1,minWidth:240}}>
              Qualifying spend <span style={{fontSize:11,color:'#94a3b8'}}>(net, ≥20% margin)</span>: <strong>${curHalfSpend.toLocaleString(undefined,{maximumFractionDigits:0})}</strong>
              <span style={{margin:'0 6px',color:'#cbd5e1'}}>×</span>{(pct*100).toFixed(0)}%
              <span style={{margin:'0 6px',color:'#cbd5e1'}}>=</span>
              <strong style={{color:'#166534'}}>${curEarned.toLocaleString(undefined,{maximumFractionDigits:2})}</strong>
              <span style={{color:'#64748b'}}> earned for {nextPeriod.label}</span>
            </div>
            <button className="btn btn-sm btn-primary" disabled={curEarned<=nextPulled} onClick={doPullForward} title={curEarned<=nextPulled?'Nothing new to pull forward yet':('Make $'+(curEarned-nextPulled).toLocaleString()+' usable now')}>↪ Pull Forward to {nextPeriod.label}</button>
          </div>
          {nextPulled>0&&<div style={{fontSize:11,color:'#64748b',marginTop:8}}>${nextPulled.toLocaleString()} already pulled forward to {nextPeriod.label}{curEarned>nextPulled?(' — $'+(curEarned-nextPulled).toLocaleString()+' more available'):' (up to date)'}.</div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:6}}>Pulled-forward dollars are usable on orders now. Spend keeps accruing — the {nextPeriod.label} allocation trues up automatically when the half closes.</div>
        </div>
      </div>}

      {/* Programs */}
      <div className="card"><div className="card-header"><h2>Promo Programs</h2><button className="btn btn-sm btn-primary" onClick={()=>setPromoEdit({type:'fixed',fixed_amount:0,spend_percentage:0.10,notes:'',id:null})}>+ Add Program</button></div>
        <div className="card-body">
          {programs.length===0&&!promoEdit&&<div className="empty">No promo programs configured</div>}
          {programs.map(pg=><div key={pg.id} style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:8,display:'flex',gap:12,alignItems:'center'}}>
            <div style={{width:40,height:40,borderRadius:8,background:pg.type==='fixed'?'#dbeafe':'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{pg.type==='fixed'?'💵':'📊'}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14}}>{pg.type==='fixed'?'Fixed: $'+(pg.fixed_amount||0).toLocaleString()+' / period':((pg.spend_percentage||0)*100)+'% of Spend'}</div>
              {pg.notes&&<div style={{fontSize:11,color:'#64748b'}}>{pg.notes}</div>}
              <div style={{fontSize:10,color:'#94a3b8'}}>Created {pg.created_at?new Date(pg.created_at).toLocaleDateString():'-'}</div>
            </div>
            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:pg.is_active?'#dcfce7':'#fee2e2',color:pg.is_active?'#166534':'#dc2626'}}>{pg.is_active?'Active':'Inactive'}</span>
            <button className="btn btn-sm btn-secondary" onClick={()=>setPromoEdit({...pg})}>Edit</button>
            <button className="btn btn-sm" style={{color:'#dc2626'}} onClick={()=>{if(window.confirm('Remove this promo program?'))onDeletePromoProgram(pg.id)}}>×</button>
          </div>)}
          {promoEdit&&<div style={{padding:14,background:'#fffbeb',borderRadius:8,border:'1px solid #fde68a',marginTop:8}}>
            <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
              <div><label className="form-label">Type</label>
                <select className="form-select" value={promoEdit.type} onChange={e=>setPromoEdit({...promoEdit,type:e.target.value})}>
                  <option value="fixed">Fixed Amount</option><option value="percent_of_spend">% of Spend</option></select></div>
              {promoEdit.type==='fixed'&&<div><label className="form-label">Amount per Period ($)</label><input className="form-input" type="number" value={promoEdit.fixed_amount||''} onChange={e=>setPromoEdit({...promoEdit,fixed_amount:parseFloat(e.target.value)||0})}/></div>}
              {promoEdit.type==='percent_of_spend'&&<div><label className="form-label">Percentage (%)</label><input className="form-input" type="number" step="1" value={(promoEdit.spend_percentage||0)*100} onChange={e=>setPromoEdit({...promoEdit,spend_percentage:(parseFloat(e.target.value)||0)/100})}/></div>}
              <div style={{flex:1}}><label className="form-label">Notes</label><input className="form-input" value={promoEdit.notes||''} onChange={e=>setPromoEdit({...promoEdit,notes:e.target.value})}/></div>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{
                const prog={id:promoEdit.id||('pp'+Date.now()),customer_id:parentId,type:promoEdit.type,fixed_amount:promoEdit.fixed_amount||0,spend_percentage:promoEdit.spend_percentage||0,is_active:true,notes:promoEdit.notes||'',created_at:promoEdit.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
                onSavePromoProgram(prog);setPromoEdit(null);
              }}>{promoEdit.id?'Update':'Create'}</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setPromoEdit(null)}>Cancel</button>
            </div>
          </div>}
        </div>
      </div>

      {/* Allocate New Period */}
      <div className="card"><div className="card-header"><h2>Allocate Period</h2>
        {!promoNewPeriod&&<button className="btn btn-sm btn-primary" onClick={()=>setPromoNewPeriod({program_id:programs[0]?.id||'',allocated:0,notes:''})}>+ New Period</button>}
      </div>
      <div className="card-body">
        {promoNewPeriod?<div style={{padding:12,background:'#eff6ff',borderRadius:8,border:'1px solid #bfdbfe'}}>
          <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
            <div><label className="form-label">Program</label>
              <select className="form-select" value={promoNewPeriod.program_id||''} onChange={e=>setPromoNewPeriod({...promoNewPeriod,program_id:e.target.value})}>
                <option value="">Select...</option>{programs.map(pg=><option key={pg.id} value={pg.id}>{pg.type==='fixed'?'Fixed $'+pg.fixed_amount:pg.spend_percentage*100+'% Spend'}</option>)}</select></div>
            <div><label className="form-label">Period</label><select className="form-select" value={promoNewPeriod.period_label||curPeriod.label} onChange={e=>{
              const parts=e.target.value.split(' ');const half=parts[0];const yr=parseInt(parts[1]);
              const start=half==='H1'?yr+'-01-01':yr+'-07-01';const end=half==='H1'?yr+'-06-30':yr+'-12-31';
              setPromoNewPeriod({...promoNewPeriod,period_label:e.target.value,period_start:start,period_end:end})}}>
              {[curPeriod.label,m<6?'H2 '+y:'H1 '+(y+1),'H1 '+(y+1),'H2 '+(y+1)].map(l=><option key={l} value={l}>{l}</option>)}</select></div>
            <div><label className="form-label">Allocated ($)</label><input className="form-input" type="number" style={{width:120}} value={promoNewPeriod.allocated||''} onChange={e=>setPromoNewPeriod({...promoNewPeriod,allocated:parseFloat(e.target.value)||0})}/></div>
            <div style={{flex:1}}><label className="form-label">Notes</label><input className="form-input" value={promoNewPeriod.notes||''} onChange={e=>setPromoNewPeriod({...promoNewPeriod,notes:e.target.value})}/></div>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button className="btn btn-sm btn-primary" onClick={()=>{
              if(!promoNewPeriod.allocated){nf('Enter an allocation amount','error');return}
              const ps=promoNewPeriod.period_start||curPeriod.start;const pe=promoNewPeriod.period_end||curPeriod.end;
              const period={id:'prd'+Date.now(),customer_id:parentId,program_id:promoNewPeriod.program_id||null,period_start:ps,period_end:pe,allocated:promoNewPeriod.allocated,used:0,notes:promoNewPeriod.notes||'',created_at:new Date().toISOString()};
              onSavePromoPeriod(period);setPromoNewPeriod(null);nf('Period allocated: $'+promoNewPeriod.allocated);
            }}>Allocate</button>
            <button className="btn btn-sm btn-secondary" onClick={()=>setPromoNewPeriod(null)}>Cancel</button>
          </div>
        </div>:<div style={{fontSize:12,color:'#94a3b8'}}>Click "+ New Period" to allocate promo dollars for an upcoming period</div>}
      </div></div>

      {/* Upcoming Periods — future allocations (e.g. pulled-forward co-op), usable early on current orders */}
      {upcomingPeriods.length>0&&<div className="card"><div className="card-header"><h2>Upcoming Periods</h2></div><div className="card-body" style={{padding:0}}>
        <table style={{fontSize:12}}><thead><tr><th>Period</th><th>Allocated</th><th>Used</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>
          {upcomingPeriods.map(p=>{const rem=(p.allocated||0)-(p.used||0);return<tr key={p.id}>
            <td style={{fontWeight:600}}>{p.period_start?.slice(0,7)} — {p.period_end?.slice(0,7)}</td>
            {_allocCell(p)}
            <td style={{color:'#dc2626'}}>${(p.used||0).toLocaleString()}</td>
            <td style={{color:rem>0?'#166534':'#94a3b8'}}>${rem.toLocaleString()}</td>
            <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:rem>0?'#dcfce7':'#f1f5f9',color:rem>0?'#166534':'#94a3b8'}}>{rem>0?'Available early $'+rem.toLocaleString():'Fully Used'}</span></td>
            {_periodActions(p)}
          </tr>})}
        </tbody></table>
      </div></div>}

      {/* Past Periods */}
      {pastPeriods.length>0&&<div className="card"><div className="card-header"><h2>Past Periods</h2></div><div className="card-body" style={{padding:0}}>
        <table style={{fontSize:12}}><thead><tr><th>Period</th><th>Allocated</th><th>Used</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>
          {pastPeriods.map(p=>{const rem=(p.allocated||0)-(p.used||0);return<tr key={p.id}>
            <td style={{fontWeight:600}}>{p.period_start?.slice(0,7)} — {p.period_end?.slice(0,7)}</td>
            {_allocCell(p)}
            <td style={{color:'#dc2626'}}>${(p.used||0).toLocaleString()}</td>
            <td style={{color:rem>0?'#166534':'#94a3b8'}}>${rem.toLocaleString()}</td>
            <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:rem>0?'#fef3c7':'#f1f5f9',color:rem>0?'#92400e':'#94a3b8'}}>{rem>0?'Unused $'+rem:'Fully Used'}</span></td>
            {_periodActions(p)}
          </tr>})}
        </tbody></table>
      </div></div>}

      {/* ═══ CREDITS SECTION ═══ */}
      <div style={{borderTop:'2px solid #e2e8f0',paddingTop:12,marginTop:4}}>
        <div style={{fontSize:13,fontWeight:800,color:'#065f46',marginBottom:8}}>ACCOUNT CREDITS</div>
      </div>

      {/* Credit Balance */}
      {(()=>{const credits=customer.credits||[];const creditUsage=customer.credit_usage||[];
        const totalBalance=credits.reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0);
        const totalAllocated=credits.reduce((a,cr)=>a+(cr.amount||0),0);
        const totalUsed=credits.reduce((a,cr)=>a+(cr.used||0),0);
        return<><div className="card"><div className="card-header"><h2>Credit Balance</h2></div>
          <div className="card-body">
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Total Credits</div><div className="stat-value" style={{color:'#2563eb'}}>${totalAllocated.toLocaleString()}</div></div>
              <div className="stat-card"><div className="stat-label">Used</div><div className="stat-value" style={{color:'#dc2626'}}>${totalUsed.toLocaleString()}</div></div>
              <div className="stat-card"><div className="stat-label">Available</div><div className="stat-value" style={{color:totalBalance>0?'#166534':'#94a3b8'}}>${totalBalance.toLocaleString()}</div></div>
            </div>
          </div>
        </div>

        {/* Credit Lines */}
        <div className="card"><div className="card-header"><h2>Credit Lines</h2>
          {!creditAdd&&<button className="btn btn-sm btn-primary" onClick={()=>setCreditAdd({amount:0,source:''})}>+ Add Credit</button>}
        </div>
        <div className="card-body">
          {credits.length===0&&!creditAdd&&<div className="empty">No credits on this account</div>}
          {credits.map(cr=>{const bal=(cr.amount||0)-(cr.used||0);const usages=creditUsage.filter(u=>u.credit_id===cr.id);
            return<div key={cr.id} style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:8,display:'flex',gap:12,alignItems:'center'}}>
              <div style={{width:40,height:40,borderRadius:8,background:bal>0?'#d1fae5':'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{bal>0?'🏷️':'✓'}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>${(cr.amount||0).toLocaleString()} {cr.source&&<span style={{fontWeight:400,color:'#64748b',fontSize:12}}>— {cr.source}</span>}</div>
                <div style={{fontSize:11,color:'#64748b'}}>Used: ${(cr.used||0).toLocaleString()} · Remaining: ${bal.toLocaleString()}</div>
                <div style={{fontSize:10,color:'#94a3b8'}}>Added {cr.created_at?new Date(cr.created_at).toLocaleDateString():'-'}{cr.created_by?' by '+cr.created_by:''}</div>
                {usages.length>0&&<div style={{marginTop:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:2}}>USAGE</div>
                  {usages.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).map((u,i)=>
                    <div key={i} style={{fontSize:11,color:'#475569',display:'flex',gap:8}}>
                      <span style={{color:'#94a3b8'}}>{u.created_at?new Date(u.created_at).toLocaleDateString():'-'}</span>
                      <span style={{fontWeight:600,color:'#1e40af'}}>{u.so_id||u.estimate_id||'-'}</span>
                      <span>{u.description||'-'}</span>
                      <span style={{fontWeight:700,color:'#dc2626'}}>${(u.amount||0).toLocaleString()}</span>
                    </div>)}
                </div>}
              </div>
              <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:bal>0?'#d1fae5':'#f1f5f9',color:bal>0?'#065f46':'#94a3b8'}}>{bal>0?'$'+bal.toLocaleString()+' avail':'Fully Used'}</span>
              {bal>0&&<button className="btn btn-sm" style={{color:'#dc2626'}} onClick={()=>{if(window.confirm('Delete this credit of $'+cr.amount+'?'))onDeleteCredit(cr.id)}}>×</button>}
            </div>})}
          {creditAdd&&<div style={{padding:14,background:'#ecfdf5',borderRadius:8,border:'1px solid #a7f3d0',marginTop:8}}>
            <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
              <div><label className="form-label">Amount ($)</label><input className="form-input" type="number" style={{width:120}} value={creditAdd.amount||''} onChange={e=>setCreditAdd({...creditAdd,amount:parseFloat(e.target.value)||0})}/></div>
              <div style={{flex:1}}><label className="form-label">Source / Reason</label><input className="form-input" value={creditAdd.source||''} onChange={e=>setCreditAdd({...creditAdd,source:e.target.value})} placeholder="e.g., Fundraising, Return credit, etc."/></div>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{
                if(!creditAdd.amount||creditAdd.amount<=0){nf('Enter a credit amount','error');return}
                const credit={id:'cr_'+Date.now(),customer_id:customer.id,amount:creditAdd.amount,used:0,source:creditAdd.source||'',created_by:cu?.name||'System',created_at:new Date().toISOString()};
                onSaveCredit(credit);setCreditAdd(null);nf('Credit of $'+creditAdd.amount.toLocaleString()+' added');
              }}>Add Credit</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setCreditAdd(null)}>Cancel</button>
            </div>
          </div>}
        </div></div></>})()}
    </div>})()}

  {/* ARTWORK TAB — customer library + aggregated from SOs/Estimates */}
  {tab==='artwork'&&(()=>{
    // Aggregate art: customer-level library + parent library + SO/Estimate art
    const custOwnArt=(customer.art_files||[]).map(a=>({...a,_src:'library',_srcLabel:'Customer Library',_srcCustId:customer.id}));
    const parentCust2=customer.parent_id?allCustomers.find(c=>c.id===customer.parent_id):null;
    const parentArt=parentCust2?(parentCust2.art_files||[]).map(a=>({...a,_src:'parent',_srcLabel:parentCust2.alpha_tag||parentCust2.name||'Parent'})):[];
    const orderArt=[];
    custSOs.forEach(so=>{(so.art_files||[]).forEach(art=>{orderArt.push({...art,_src:'so',_srcLabel:so.id+(so.memo?' — '+so.memo:''),_so_id:so.id,_so_memo:so.memo||'',_srcCustId:so.customer_id})})});
    custEsts.forEach(est=>{(est.art_files||[]).forEach(art=>{if(!orderArt.some(a=>a.name===art.name&&a.deco_type===art.deco_type))orderArt.push({...art,_src:'est',_srcLabel:est.id+(est.memo?' — '+est.memo:''),_est_id:est.id,_est_memo:est.memo||'',_srcCustId:est.customer_id})})});
    const allArt=[...custOwnArt,...parentArt,...orderArt].filter(a=>!/^art\s+tbd/i.test((a.name||'').trim()));
    // De-dupe logos by name+type so one logo reused across many orders shows once — but ONLY when it has a name.
    // Freshly added / still-unnamed art has an empty name; keying those by their unique id keeps each as its own
    // card. Otherwise every blank-named art of the same type collapses into a single card and the "Add Art" button
    // appears to do nothing (the new entry merges into an existing blank card, which may not even be editable).
    const _logoKey=a=>{const nm=(a.name||'').trim().toLowerCase();return nm?nm+'||'+(a.deco_type||''):'__noname__'+(a.id||'')};
    // Group by art name+deco_type to find usage across orders
    const artGroups={};allArt.forEach(a=>{const key=_logoKey(a);if(!artGroups[key])artGroups[key]={art:a,instances:[]};artGroups[key].instances.push(a)});
    const groups=Object.values(artGroups);
    // Helper: save customer art
    const saveCustArt=(newArtFiles)=>{const newCust={...customer,art_files:newArtFiles};setCustLocal(newCust);onRefreshCustomer(newCust)};
    const ownArt=customer.art_files||[];
    const addCustArt=()=>{const newId='caf'+Date.now();saveCustArt([...ownArt,{id:newId,name:'',deco_type:'screen_print',ink_colors:'',thread_colors:'',art_size:'',color_ways:[],files:[],mockup_files:[],prod_files:[],notes:'',status:'waiting_for_art',uploaded:new Date().toLocaleDateString()}]);setCustArtExpanded(newId)};
    const uCustArt=(i,k,v)=>{saveCustArt(ownArt.map((a,x)=>x===i?{...a,[k]:v}:a))};
    const rmCustArt=(i)=>{saveCustArt(ownArt.filter((_,x)=>x!==i))};
    // Build unified list with source tags + compute usage
    const unifiedAll=allArt.map(art=>{
      const st=art.status==='uploaded'?'needs_approval':art.status||'waiting_for_art';
      // Mockups can live in mockup_files or, for rep-built quick mocks, in item_mockups (keyed by sku|color).
      const itemMocks=Object.values(art.item_mockups||{}).flat().filter(f=>f);
      const mockups=[...(art.mockup_files||[]),...itemMocks].filter(f=>f);
      const dispFiles=mockups.length?mockups:(art.files||[]).filter(f=>f);
      // Thumbnail: first renderable image across preview, mockups, then files.
      const imgUrl=[art.preview_url,...mockups,...(art.files||[])].map(f=>typeof f==='string'?f:(f?.url||'')).find(u=>u&&_isImgUrl(u))||'';
      const usedOnSOs=[];if(art._src==='so'||art._src==='est'){custSOs.forEach(so=>{(so.art_files||[]).forEach(a=>{if(a.name===art.name&&a.deco_type===art.deco_type){const items=[];(so.items||[]).forEach(it=>{(it.decorations||[]).forEach(d=>{if(d.art_file_id===a.id)items.push({sku:it.sku,name:it.name,position:d.position,deco_type:d.deco_type||a.deco_type})})});usedOnSOs.push({so_id:so.id,memo:so.memo,status:so.status,items})}})})}
      const allMockups=[];const seen=new Set();
      const allProd=[];const seenP=new Set();
      const grpKey=_logoKey(art);
      artGroups[grpKey]?.instances.forEach(inst=>{[...(inst.mockup_files||[]),...Object.values(inst.item_mockups||{}).flat(),...(inst.files||[])].filter(f=>f).forEach(f=>{const url=typeof f==='string'?f:(f?.url||'');if(url&&!seen.has(url)){seen.add(url);allMockups.push({file:f,url,src:inst._srcLabel})}})});
      artGroups[grpKey]?.instances.forEach(inst=>{(inst.prod_files||[]).filter(f=>f).forEach(f=>{const url=typeof f==='string'?f:(f?.url||'');if(url&&!seenP.has(url)){seenP.add(url);allProd.push({file:f,url,src:inst._srcLabel})}})});
      // Find index in ownArt for editable items
      const ownIdx=art._src==='library'?ownArt.findIndex(a=>a.id===art.id):-1;
      return{...art,_st:st,_mockups:dispFiles,_imgUrl:imgUrl,_usedOnSOs:usedOnSOs,_allMockups:allMockups,_allProd:allProd,_ownIdx:ownIdx};
    });
    // Collapse to one card per logo (name+deco_type) — a logo reused across multiple SOs shows once.
    const _stRank={needs_approval:3,approved:2,waiting_for_art:1};
    const _byLogo={};unifiedAll.forEach(a=>{const k=_logoKey(a);(_byLogo[k]=_byLogo[k]||[]).push(a)});
    const unified=Object.values(_byLogo).map(insts=>{
      const rep={...[...insts].sort((x,y)=>(_stRank[y._st]||0)-(_stRank[x._st]||0))[0]};
      rep._usedOnSOs=insts.reduce((m,x)=>(x._usedOnSOs||[]).length>m.length?x._usedOnSOs:m,[]);
      rep._imgUrl=insts.map(x=>x._imgUrl).find(u=>u&&_isImgUrl(u))||rep._imgUrl||(rep._allMockups[0]?.url)||'';
      rep._archived=insts.length>0&&insts.every(x=>x.archived);
      // Cascading parent art = lives in the parent's own library; everything else is tied to a sub-account's orders/estimates.
      rep._appliesToAll=insts.some(x=>x._src==='library');
      rep._srcCustIds=[...new Set(insts.map(x=>x._srcCustId).filter(Boolean))];
      return rep;
    });
    // Archive/unarchive a logo across every order it's on plus the customer library copy.
    const archiveLogo=(art,arch)=>{
      const nm=(art.name||'').toLowerCase();const dt=art.deco_type||'';
      custSOs.forEach(so=>{let changed=false;const updArt=(so.art_files||[]).map(a=>{if((a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt&&!!a.archived!==arch){changed=true;return{...a,archived:arch}}return a});if(changed&&onSaveSO)onSaveSO({...so,art_files:updArt,updated_at:new Date().toLocaleString()})});
      custEsts.forEach(est=>{let changed=false;const updArt=(est.art_files||[]).map(a=>{if((a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt&&!!a.archived!==arch){changed=true;return{...a,archived:arch}}return a});if(changed&&onSaveEst)onSaveEst({...est,art_files:updArt})});
      if((ownArt||[]).some(a=>(a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt&&!!a.archived!==arch))saveCustArt(ownArt.map(a=>(a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt?{...a,archived:arch}:a));
      nf&&nf((arch?'Archived ':'Unarchived ')+'"'+(art.name||'art')+'"');
    };
    // Status counts for filter tabs (archived excluded from the normal tabs)
    const counts={all:0,waiting_for_art:0,needs_approval:0,approved:0,archived:0};
    unified.forEach(a=>{if(a._archived){counts.archived++}else{counts.all++;if(counts[a._st]!=null)counts[a._st]++}});
    const filtered=custArtFilter==='archived'?unified.filter(a=>a._archived):unified.filter(a=>!a._archived&&(custArtFilter==='all'||a._st===custArtFilter));
    return<div className="card"><div className="card-header"><h2>Artwork Library</h2><button className="btn btn-sm btn-primary" onClick={addCustArt}><Icon name="plus" size={12}/> Add Art</button></div>
      <div className="card-body">
      {/* Status filter tabs */}
      <div style={{display:'flex',gap:0,marginBottom:12,borderBottom:'2px solid #e2e8f0'}}>
        {[['all','All'],['waiting_for_art','Waiting for Art'],['needs_approval','Needs Approval'],['approved','Approved'],['archived','Archived']].map(([k,label])=>{const ct=counts[k];const active=custArtFilter===k;
          return<button key={k} onClick={()=>setCustArtFilter(k)} style={{padding:'8px 16px',fontSize:12,fontWeight:active?700:500,color:active?k==='approved'?'#166534':k==='needs_approval'?'#92400e':k==='waiting_for_art'?'#64748b':'#1e3a5f':'#94a3b8',
            background:active?k==='approved'?'#dcfce7':k==='needs_approval'?'#fef3c7':k==='waiting_for_art'?'#f1f5f9':'white':'transparent',
            border:'none',borderBottom:active?'2px solid '+(k==='approved'?'#22c55e':k==='needs_approval'?'#f59e0b':k==='waiting_for_art'?'#94a3b8':'#2563eb'):'2px solid transparent',
            cursor:'pointer',marginBottom:-2,borderRadius:'6px 6px 0 0'}}>{label}{ct>0?' ('+ct+')':''}</button>})}
      </div>
      {/* Unified art list */}
      {(()=>{
        const renderArtCard=(art,i)=>{const isEditable=art._ownIdx>=0;const isExp=custArtExpanded===art.id;const oi=art._ownIdx;
          const _subLabel=isP&&!art._appliesToAll?(art._srcCustIds||[]).map(id=>teamName(id)).filter(Boolean).join(', '):'';
          return<div key={art.id+'-'+art._src+'-'+i} style={{background:'#f8fafc',borderRadius:8,border:art._st==='approved'?'2px solid #22c55e':art._st==='needs_approval'?'2px solid #f59e0b':'1px solid #e2e8f0',overflow:'hidden'}}>
            {/* Summary row */}
            <div style={{display:'flex',gap:10,alignItems:'center',padding:'10px 14px',cursor:'pointer'}} onClick={()=>setCustArtDetail({...art,_usedOnSOs:art._usedOnSOs,_allMockups:art._allMockups,_allProd:art._allProd})}>
              {art._imgUrl&&_isImgUrl(art._imgUrl)?<img src={art._imgUrl} alt="" style={{width:56,height:56,borderRadius:6,objectFit:'contain',flexShrink:0,background:'white',border:'1px solid #e2e8f0'}}/>:
                <div style={{width:56,height:56,borderRadius:6,background:art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':'🔥'}</div>}
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{art.name||'Untitled'}</div>
                <div style={{fontSize:11,color:'#64748b'}}>{(art.deco_type||'').replace(/_/g,' ')}{(art.color_ways||[]).length>0?' · '+art.color_ways.length+' CW'+(art.color_ways.length>1?'s':''):art.ink_colors?' · '+art.ink_colors.split('\n').filter(l=>l.trim()).length+' color(s)':art.thread_colors?' · '+art.thread_colors:''}{art.art_size?' · '+art.art_size:''}</div>
                {isP&&art._appliesToAll&&<div style={{marginTop:3}}><span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:9,fontWeight:700,background:'#dbeafe',color:'#1e40af',borderRadius:8,padding:'1px 7px'}}>↓ All sub-customers</span></div>}
                {isP&&!art._appliesToAll&&_subLabel&&<div style={{marginTop:3}}><span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:9,fontWeight:700,background:'#f3e8ff',color:'#6d28d9',borderRadius:8,padding:'1px 7px'}}>{_subLabel}</span></div>}
                <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{art._src==='so'||art._src==='est'?art._srcLabel:art._src==='parent'?parentCust2?.alpha_tag||parentCust2?.name:''}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:(ART_FILE_SC[art._st]||ART_FILE_SC.waiting_for_art).bg,color:(ART_FILE_SC[art._st]||ART_FILE_SC.waiting_for_art).c}}>{(art._st).replace(/_/g,' ')}</span>
                <button title={art._archived?'Restore to the active library':'Archive — keep in system but hide from the library and previous-art pickers'} onClick={e=>{e.stopPropagation();archiveLogo(art,!art._archived)}} style={{fontSize:9,padding:'2px 8px',borderRadius:4,border:'1px solid #cbd5e1',background:'white',color:'#64748b',cursor:'pointer',fontWeight:600}}>{art._archived?'Unarchive':'Archive'}</button>
                {isP&&!art._appliesToAll&&!art._archived&&<button title="Add to the program library so this logo applies to every sub-customer" onClick={e=>{e.stopPropagation();promoteArtToLibrary(art)}} style={{fontSize:9,padding:'2px 8px',borderRadius:4,border:'1px solid #93c5fd',background:'#eff6ff',color:'#1e40af',cursor:'pointer',fontWeight:700}}>↑ Use for program</button>}
                <div style={{display:'flex',gap:6}}>
                  {art._mockups.length>0&&<span style={{fontSize:10,color:'#2563eb'}}>{art._mockups.length} file(s)</span>}
                  {art._usedOnSOs.length>0&&<span style={{fontSize:10,color:'#64748b'}}>{art._usedOnSOs.length} order(s)</span>}
                </div>
              </div>
              {isEditable&&<button title="Edit details — name, type, size, status, delete" onClick={e=>{e.stopPropagation();setCustArtExpanded(isExp?null:art.id)}} style={{display:'flex',alignItems:'center',gap:3,fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:4,border:'1px solid #cbd5e1',background:isExp?'#0f172a':'white',color:isExp?'white':'#64748b',cursor:'pointer',whiteSpace:'nowrap'}}>Edit details <span style={{transition:'transform 0.2s',transform:isExp?'rotate(180deg)':'rotate(0deg)'}}>▼</span></button>}
            </div>
            {/* Expanded editor — only for customer library art */}
            {isEditable&&isExp&&<div style={{padding:'0 14px 14px',borderTop:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,marginTop:10}}>
                <input className="form-input" value={art.name} onChange={e=>uCustArt(oi,'name',e.target.value)} placeholder="Art group name..." style={{fontWeight:700,fontSize:14,flex:1}}/>
                <select style={{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600,flexShrink:0,border:'1px solid #e2e8f0',background:(ART_FILE_SC[art._st]||ART_FILE_SC.waiting_for_art).bg,color:(ART_FILE_SC[art._st]||ART_FILE_SC.waiting_for_art).c,cursor:'pointer'}} value={art._st} onChange={e=>uCustArt(oi,'status',e.target.value)}>
                  <option value="waiting_for_art">Waiting for Art</option><option value="needs_approval">Needs Approval</option><option value="approved">Approved</option></select>
                <button className="btn btn-sm btn-secondary" style={{fontSize:10,flexShrink:0}} onClick={e=>{e.stopPropagation();rmCustArt(oi)}}><Icon name="trash" size={10}/></button>
              </div>
              <div style={{marginBottom:6}}><span style={{fontSize:11,fontWeight:600,color:'#64748b',marginRight:6}}>Type:</span>
                <Bg options={[{value:'screen_print',label:'Screen Print'},{value:'embroidery',label:'Embroidery'},{value:'dtf',label:'DTF'}]} value={art.deco_type} onChange={v=>uCustArt(oi,'deco_type',v)}/></div>
              <div style={{display:'flex',gap:8,marginBottom:6,alignItems:'flex-end'}}>
                <div style={{width:140}}><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Size</label><input className="form-input" value={art.art_size||''} onChange={e=>uCustArt(oi,'art_size',e.target.value)} placeholder='e.g. 12" x 4"' style={{fontSize:12}}/></div>
              </div>
              {/* Color Ways */}
              <div style={{marginBottom:6}}>
                <ColorWaysEditor colorWays={art.color_ways||[]} onChange={cws=>uCustArt(oi,'color_ways',cws)} decoType={art.deco_type} pantoneColors={mergeColors(customer,allCustomers,'pantone_colors')} threadColors={mergeColors(customer,allCustomers,'thread_colors')} suppressWarning={!!art.ink_colors||!!art.thread_colors}/>
              </div>
              <div style={{marginBottom:6}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}><span style={{fontSize:10,fontWeight:700,color:'#2563eb'}}>MOCKUP FILES</span></div>
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{art._mockups.map((fn,fi)=>{const fnUrl=typeof fn==='string'?fn:(fn?.url||'');return<span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#dbeafe',borderRadius:4,fontSize:11,cursor:isUrl(fnUrl)?'pointer':'default'}} onClick={()=>openFile(fn)}>
                  <Icon name="file" size={10}/>{fileDisplayName(fn)}<button onClick={e=>{e.stopPropagation();const mf=[...art._mockups];mf.splice(fi,1);uCustArt(oi,'mockup_files',mf);if(!ownArt[oi].mockup_files)uCustArt(oi,'files',[])}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>})}</div>
                <div style={{border:'2px dashed #bfdbfe',borderRadius:6,padding:10,textAlign:'center',cursor:'pointer',background:'#eff6ff'}}
                  onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.png,.jpg,.jpeg,.ai,.eps';inp.multiple=true;inp.onchange=async()=>{let acc=[...art._mockups];for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-mockups');acc=[...acc,{url,name:f.name}];uCustArt(oi,'mockup_files',acc);if(!ownArt[oi].mockup_files)uCustArt(oi,'files',[]);nf(f.name+' uploaded')}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#dbeafe';e.currentTarget.style.borderColor='#3b82f6'}}
                  onDragLeave={e=>{e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe'}}
                  onDrop={async e=>{e.preventDefault();e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe';let acc=[...art._mockups];for(const f of Array.from(e.dataTransfer.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-mockups');acc=[...acc,{url,name:f.name}];uCustArt(oi,'mockup_files',acc);if(!ownArt[oi].mockup_files)uCustArt(oi,'files',[]);nf(f.name+' uploaded')}catch(err){nf('Upload failed: '+err.message,'error')}}}}>
                  <div style={{fontSize:11,color:'#2563eb',fontWeight:600}}>Drop mockup files or click to browse</div>
                  <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>PDF, PNG, JPG, AI, EPS</div></div>
              </div>
              <div style={{marginBottom:6}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}><span style={{fontSize:10,fontWeight:700,color:'#d97706'}}>PRODUCTION FILES</span><span style={{fontSize:9,color:'#94a3b8'}}>Internal only</span></div>
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{(art.prod_files||[]).map((fn,fi)=>{const fnUrl=typeof fn==='string'?fn:(fn?.url||'');return<span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#fef3c7',borderRadius:4,fontSize:11,cursor:isUrl(fnUrl)?'pointer':'default'}} onClick={()=>openFile(fn)}>
                  <Icon name="file" size={10}/>{fileDisplayName(fn)}<button onClick={e=>{e.stopPropagation();uCustArt(oi,'prod_files',(art.prod_files||[]).filter((_,x)=>x!==fi))}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>})}</div>
                <div style={{border:'2px dashed #fde68a',borderRadius:6,padding:10,textAlign:'center',cursor:'pointer',background:'#fffbeb'}}
                  onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.ai,.eps,.dst,.png,.jpg,.jpeg';inp.multiple=true;inp.onchange=async()=>{let acc=[...(art.prod_files||[])];for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');acc=[...acc,{url,name:f.name}];uCustArt(oi,'prod_files',acc);nf(f.name+' uploaded')}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#fef3c7';e.currentTarget.style.borderColor='#f59e0b'}}
                  onDragLeave={e=>{e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a'}}
                  onDrop={async e=>{e.preventDefault();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a';let acc=[...(art.prod_files||[])];for(const f of Array.from(e.dataTransfer.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');acc=[...acc,{url,name:f.name}];uCustArt(oi,'prod_files',acc);nf(f.name+' uploaded')}catch(err){nf('Upload failed: '+err.message,'error')}}}}>
                  <div style={{fontSize:11,color:'#d97706',fontWeight:600}}>Drop production files or click to browse</div>
                  <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>DST, AI seps, PDF, PNG, JPG</div></div>
              </div>
              <input className="form-input" value={art.notes||''} onChange={e=>uCustArt(oi,'notes',e.target.value)} placeholder="Notes..." style={{fontSize:12}}/>
            </div>}
          </div>};
        if(filtered.length===0)return<div className="empty">{custArtFilter==='all'?'No artwork found. Click "Add Art" to create art groups.':'No artwork with this status.'}</div>;
        if(!isP)return<div style={{display:'flex',flexDirection:'column',gap:8}}>{filtered.map(renderArtCard)}</div>;
        const _parentArt=filtered.filter(a=>a._appliesToAll);
        const _subArt=filtered.filter(a=>!a._appliesToAll);
        const _sect=(title,subtitle,items,accent)=>items.length>0&&<div style={{marginBottom:18}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:800,color:accent}}>{title}</span>
            <span style={{fontSize:11,fontWeight:700,color:'#fff',background:accent,borderRadius:10,padding:'1px 8px'}}>{items.length}</span>
            <span style={{fontSize:11,color:'#94a3b8'}}>{subtitle}</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>{items.map(renderArtCard)}</div>
        </div>;
        return<>
          {_sect('Applies to All Sub-Customers','Parent library — cascades to every sub-customer',_parentArt,'#2563eb')}
          {_sect('Sub-Customer Artwork','From individual sub-account orders & estimates',_subArt,'#7c3aed')}
        </>;
      })()}
      </div>
    </div>})()}
  {/* ART DETAIL MODAL */}
  {custArtDetail&&(()=>{const art=custArtDetail;const allMockups=art._allMockups||[];const usedOnSOs=art._usedOnSOs||[];
    // Persist file add/remove/tag via the lightweight art-files-only save so we don't re-persist
    // the whole order (items/POs) — which trips data-loss guards when items aren't hydrated here.
    const saveArt=onSaveArtFiles||onSaveSO;
    // If no precomputed data, compute it
    const mockups=allMockups.length>0?allMockups:(art.mockup_files||art.files||[]).filter(f=>f).map(f=>({file:f,url:typeof f==='string'?f:(f?.url||''),src:art._srcLabel||''}));
    // Remove a file from this artwork everywhere it's attached (mockups/files/prod/item_mockups)
    // across every sales order that uses this logo, then persist each changed order.
    const urlOf=f=>typeof f==='string'?f:(f?.url||'');
    // Program-library copies of this logo live in customer.art_files. File add/remove/tag must
    // also hit those so library art is self-contained (not just whatever order it came from).
    const _libMatch=a=>(a.name||'').toLowerCase()===(art.name||'').toLowerCase()&&(a.deco_type||'')===(art.deco_type||'');
    const libHasLogo=()=>(customer.art_files||[]).some(_libMatch);
    const updateLibArt=(updater)=>{const lib=customer.art_files||[];if(!lib.some(_libMatch))return false;const newCust={...customer,art_files:lib.map(a=>_libMatch(a)?updater(a):a)};setCustLocal(newCust);onRefreshCustomer(newCust);return true};
    const removeMockFromArt=(url)=>{
      if(!url)return;
      if(!window.confirm('Remove this file from "'+(art.name||'this artwork')+'" everywhere it\'s used (orders + program library)? This cannot be undone.'))return;
      const nm=(art.name||'').toLowerCase();const dt=art.deco_type||'';
      const filt=arr=>(arr||[]).filter(f=>urlOf(f)!==url);
      if(saveArt)custSOs.forEach(so=>{let changed=false;
        const updArt=(so.art_files||[]).map(a=>{
          if((a.name||'').toLowerCase()!==nm||(a.deco_type||'')!==dt)return a;
          const mf=filt(a.mockup_files),fl=filt(a.files),pf=filt(a.prod_files);
          const im={...(a.item_mockups||{})};let imCh=false;Object.keys(im).forEach(k=>{const nv=filt(im[k]);if(nv.length!==(im[k]||[]).length)imCh=true;im[k]=nv});
          if(mf.length!==(a.mockup_files||[]).length||fl.length!==(a.files||[]).length||pf.length!==(a.prod_files||[]).length||imCh){changed=true;return{...a,mockup_files:mf,files:fl,prod_files:pf,item_mockups:im}}
          return a;
        });
        if(changed)saveArt({...so,art_files:updArt,updated_at:new Date().toLocaleString()});
      });
      updateLibArt(a=>{const im={...(a.item_mockups||{})};Object.keys(im).forEach(k=>{im[k]=filt(im[k])});return{...a,mockup_files:filt(a.mockup_files),files:filt(a.files),prod_files:filt(a.prod_files),item_mockups:im}});
      setCustArtDetail(d=>d?{...d,_allMockups:(d._allMockups||[]).filter(x=>x.url!==url),_allProd:(d._allProd||[]).filter(x=>x.url!==url),mockup_files:(d.mockup_files||[]).filter(f=>urlOf(f)!==url),files:(d.files||[]).filter(f=>urlOf(f)!==url),prod_files:(d.prod_files||[]).filter(f=>urlOf(f)!==url)}:d);
      nf&&nf('File removed from '+(art.name||'artwork'));
    };
    // Upload a new mockup and attach it to this artwork — on its source order and/or the program library.
    const addMockToArt=async(fileList)=>{
      const soId=art._so_id||(usedOnSOs[0]&&usedOnSOs[0].so_id);
      const so=custSOs.find(s=>s.id===soId);
      const hasLib=libHasLogo();
      if(!so&&!hasLib){nf&&nf('No order or program-library record found to attach the mockup to','error');return}
      const nm=(art.name||'').toLowerCase();const dt=art.deco_type||'';
      const added=[];
      for(const f of Array.from(fileList||[])){nf&&nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-mockups');added.push({url,name:f.name})}catch(e){nf&&nf('Upload failed: '+e.message,'error')}}
      if(!added.length)return;
      let srcLabel='';
      if(so&&saveArt){const updArt=(so.art_files||[]).map(a=>{const match=a.id===art.id||((a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt);return match?{...a,mockup_files:[...(a.mockup_files||[]),...added]}:a});saveArt({...so,art_files:updArt,updated_at:new Date().toLocaleString()});srcLabel=so.id+(so.memo?' — '+so.memo:'')}
      if(hasLib){updateLibArt(a=>({...a,mockup_files:[...(a.mockup_files||[]),...added]}));if(!srcLabel)srcLabel='Program Library'}
      setCustArtDetail(d=>d?{...d,_allMockups:[...(d._allMockups||[]),...added.map(m=>({file:m,url:m.url,src:srcLabel}))]}:d);
      nf&&nf(added.length+' mockup'+(added.length>1?'s':'')+' added');
    };
    const pickMock=()=>{const inp=document.createElement('input');inp.type='file';inp.accept='image/*,.pdf';inp.multiple=true;inp.onchange=()=>addMockToArt(inp.files);inp.click()};
    // Upload a new production file and attach it to this artwork — on its source order and/or the program library.
    const addProdToArt=async(fileList)=>{
      const soId=art._so_id||(usedOnSOs[0]&&usedOnSOs[0].so_id);
      const so=custSOs.find(s=>s.id===soId);
      const hasLib=libHasLogo();
      if(!so&&!hasLib){nf&&nf('No order or program-library record found to attach the file to','error');return}
      const nm=(art.name||'').toLowerCase();const dt=art.deco_type||'';
      const added=[];
      for(const f of Array.from(fileList||[])){nf&&nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');added.push({url,name:f.name})}catch(e){nf&&nf('Upload failed: '+e.message,'error')}}
      if(!added.length)return;
      let srcLabel='';
      if(so&&saveArt){const updArt=(so.art_files||[]).map(a=>{const match=a.id===art.id||((a.name||'').toLowerCase()===nm&&(a.deco_type||'')===dt);return match?{...a,prod_files:[...(a.prod_files||[]),...added]}:a});saveArt({...so,art_files:updArt,updated_at:new Date().toLocaleString()});srcLabel=so.id+(so.memo?' — '+so.memo:'')}
      if(hasLib){updateLibArt(a=>({...a,prod_files:[...(a.prod_files||[]),...added]}));if(!srcLabel)srcLabel='Program Library'}
      setCustArtDetail(d=>d?{...d,_allProd:[...(d._allProd||[]),...added.map(m=>({file:m,url:m.url,src:srcLabel}))]}:d);
      nf&&nf(added.length+' production file'+(added.length>1?'s':'')+' added');
    };
    const pickProd=()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.ai,.eps,.dst,.png,.jpg,.jpeg';inp.multiple=true;inp.onchange=()=>addProdToArt(inp.files);inp.click()};
    const prodFiles=(art._allProd&&art._allProd.length)?art._allProd:(art.prod_files||[]).filter(f=>f).map(f=>({file:f,url:typeof f==='string'?f:(f?.url||''),src:art._srcLabel||''}));
    // Color ways for this artwork — from the art's color_ways, else distinct colors of items that use it.
    const _logoMatch=a=>(a.name||'').toLowerCase()===(art.name||'').toLowerCase()&&(a.deco_type||'')===(art.deco_type||'');
    const cwColors=(art.color_ways&&art.color_ways.length)
      ? [...new Set(art.color_ways.map(c=>c.garment_color||c.color||'').filter(Boolean))]
      : [...new Set(custSOs.flatMap(so=>(so.items||[]).filter(it=>(it.decorations||[]).some(d=>{const af=(so.art_files||[]).find(a=>a.id===d.art_file_id);return af&&_logoMatch(af)})).map(it=>it.color)).filter(Boolean))];
    // Tag a mock with a color way wherever this file is attached on the artwork.
    const applyMockToCW=(mock,cwColor)=>{
      if(!cwColor)return;
      const url=urlOf(mock);
      const tag=f=>{if(urlOf(f)!==url)return f;return{...(typeof f==='string'?{url:f,name:fileDisplayName(f)}:f),color_way:cwColor}};
      updateLibArt(a=>{const im={...(a.item_mockups||{})};Object.keys(im).forEach(k=>{im[k]=(im[k]||[]).map(tag)});return{...a,mockup_files:(a.mockup_files||[]).map(tag),item_mockups:im}});
      if(saveArt)custSOs.forEach(so=>{
        let soChanged=false;
        const updArt=(so.art_files||[]).map(a=>{
          if(!_logoMatch(a))return a;
          const has=(a.mockup_files||[]).some(f=>urlOf(f)===url)||Object.values(a.item_mockups||{}).flat().some(f=>urlOf(f)===url);
          if(!has)return a;
          soChanged=true;
          const im={...(a.item_mockups||{})};Object.keys(im).forEach(k=>{im[k]=(im[k]||[]).map(tag)});
          return{...a,mockup_files:(a.mockup_files||[]).map(tag),item_mockups:im};
        });
        if(soChanged)saveArt({...so,art_files:updArt,updated_at:new Date().toLocaleString()});
      });
      setCustArtDetail(d=>d?{...d,_allMockups:(d._allMockups||[]).map(x=>x.url===url?{...x,file:{...(typeof x.file==='string'?{url:x.file}:(x.file||{url})),color_way:cwColor}}:x)}:d);
      nf&&nf('Mock tagged as '+cwColor);
    };
    // Persist color-way edits for this logo across every matching art record (orders + customer library).
    // Uses the lightweight art-files save so items/POs are never re-persisted.
    const persistColorWays=(newCws)=>{
      if(saveArt)custSOs.forEach(so=>{
        let changed=false;
        const updArt=(so.art_files||[]).map(a=>{if(!_logoMatch(a))return a;changed=true;return{...a,color_ways:newCws}});
        if(changed)saveArt({...so,art_files:updArt,updated_at:new Date().toLocaleString()});
      });
      const lib=customer.art_files||[];
      if(onRefreshCustomer&&lib.some(_logoMatch))onRefreshCustomer({...customer,art_files:lib.map(a=>_logoMatch(a)?{...a,color_ways:newCws}:a)});
      setCustArtDetail(d=>d?{...d,color_ways:newCws}:d);
    };
    // For text fields: update only the modal's local state while typing (snappy, no focus loss), then
    // persist once on blur. Discrete actions (add/remove/quick-pick) call persistColorWays directly.
    const setCwsLocal=(newCws)=>setCustArtDetail(d=>d?{...d,color_ways:newCws}:d);
    const cws=art.color_ways||[];
    return<div className="modal-overlay" onClick={()=>setCustArtDetail(null)}><div className="modal" style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
      <div className="modal-header"><h2>{art.name||'Untitled'}</h2><button className="modal-close" onClick={()=>setCustArtDetail(null)}>x</button></div>
      <div className="modal-body">
        {/* Art details */}
        <div style={{display:'flex',gap:12,marginBottom:16,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',flexWrap:'wrap'}}>
          <div><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Type</span><div style={{fontSize:13,fontWeight:600}}>{(art.deco_type||'').replace(/_/g,' ')||'—'}</div></div>
          {art.art_size&&<div><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Size</span><div style={{fontSize:13,fontWeight:600}}>{art.art_size}</div></div>}
          {art.ink_colors&&<div><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Colors</span><div style={{fontSize:12}}>{art.ink_colors.split('\n').filter(l=>l.trim()).map((c,ci)=><div key={ci} style={{fontWeight:600}}>{c.trim()}</div>)}</div></div>}
          {art.thread_colors&&<div><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Thread</span><div style={{fontSize:13,fontWeight:600}}>{art.thread_colors}</div></div>}
          <div><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Status</span><div><span style={{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600,background:(ART_FILE_SC[art.status]||ART_FILE_SC.waiting_for_art).bg,color:(ART_FILE_SC[art.status]||ART_FILE_SC.waiting_for_art).c}}>{(art.status||'waiting_for_art').replace(/_/g,' ')}</span></div></div>
        </div>
        {/* Color Ways (editable) */}
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:'#475569'}}>Color Ways ({cws.length})</div>
            <span style={{fontSize:10,color:'#94a3b8'}}>{art.deco_type==='embroidery'?'Thread colors per garment':'Ink colors per garment'}</span>
          </div>
          {saveArt?<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(248px,1fr))',gap:10,marginBottom:10}}>
              {cws.map((cw,ci)=><div key={cw.id||ci} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
                <div style={{display:'flex',gap:8,alignItems:'center',padding:'8px 10px',background:'#f8fafc',borderBottom:'1px solid #eef2f7'}}>
                  <span style={{fontSize:10,fontWeight:700,color:'#fff',background:'#64748b',borderRadius:6,padding:'2px 7px',flexShrink:0}}>CW {ci+1}</span>
                  <input value={cw.garment_color||''} onChange={e=>{const n=[...cws];n[ci]={...cw,garment_color:e.target.value};setCwsLocal(n)}} onBlur={()=>persistColorWays(cws)} placeholder="Name this color way" style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:'#1e293b',border:'1px solid #e5e7eb',borderRadius:6,background:'#fff',padding:'3px 8px',outline:'none'}}/>
                  <button onClick={()=>persistColorWays(cws.filter((_,x)=>x!==ci))} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:2,flexShrink:0,display:'flex'}} title="Remove color way"><Icon name="trash" size={13}/></button>
                </div>
                <div style={{padding:'8px 10px'}}>
                  {(cw.inks||[]).length===0&&<div style={{fontSize:10,color:'#cbd5e1',fontStyle:'italic',marginBottom:6}}>No colors yet</div>}
                  {(cw.inks||[]).map((ink,ii)=><div key={ii} style={{display:'flex',gap:6,alignItems:'center',marginBottom:5}}>
                    <span style={{width:16,height:16,borderRadius:4,background:pantoneHex(ink)||'#f1f5f9',border:'1px solid #d1d5db',flexShrink:0}}/>
                    <input value={ink} onChange={e=>{const n=[...cws];const inks=[...(cw.inks||[])];inks[ii]=e.target.value;n[ci]={...cw,inks};setCwsLocal(n)}} onBlur={()=>persistColorWays(cws)} placeholder={art.deco_type==='embroidery'?'Thread color':'Ink color'} style={{flex:1,minWidth:0,fontSize:12,padding:'4px 8px',border:'1px solid #e5e7eb',borderRadius:6,background:'#fff',outline:'none'}}/>
                    <button onClick={()=>{const n=[...cws];n[ci]={...cw,inks:(cw.inks||[]).filter((_,x)=>x!==ii)};persistColorWays(n)}} style={{background:'none',border:'none',cursor:'pointer',color:'#cbd5e1',padding:2,flexShrink:0,display:'flex'}} title="Remove color"><Icon name="x" size={12}/></button>
                  </div>)}
                  <div style={{marginTop:6}}>{art.deco_type==='embroidery'?<ThreadQuickPicks colors={mergeColors(customer,allCustomers,'thread_colors')} onPick={v=>{const n=[...cws];const inks=[...(cw.inks||[])];const e2=inks.findIndex(x=>!x);if(e2>=0)inks[e2]=v;else inks.push(v);n[ci]={...cw,inks};persistColorWays(n)}}/>
                  :<PantoneQuickPicks colors={mergeColors(customer,allCustomers,'pantone_colors')} onPick={v=>{const n=[...cws];const inks=[...(cw.inks||[])];const e2=inks.findIndex(x=>!x);if(e2>=0)inks[e2]=v;else inks.push(v);n[ci]={...cw,inks};persistColorWays(n)}}/>}</div>
                  <button onClick={()=>{const n=[...cws];n[ci]={...cw,inks:[...(cw.inks||[]),'']};persistColorWays(n)}} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#2563eb',padding:'4px 0 0',fontWeight:600}}>+ Add color</button>
                </div>
              </div>)}
              <button onClick={()=>persistColorWays([...cws,{id:'cw'+Date.now(),garment_color:'',inks:['']}])} style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,minHeight:90,background:'#fafbfc',border:'2px dashed #cbd5e1',borderRadius:10,cursor:'pointer',fontSize:12,color:'#64748b',fontWeight:600}}><Icon name="plus" size={16}/>Add Color Way</button>
            </div>
          </>:(cws.length>0?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{cws.map((cw,ci)=><span key={cw.id||ci} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,padding:'3px 9px',background:'#f1f5f9',borderRadius:8,color:'#475569',fontWeight:600}}>{cw.garment_color||'CW '+(ci+1)}{(cw.inks||[]).filter(Boolean).length>0&&<span style={{display:'inline-flex',gap:2}}>{(cw.inks||[]).filter(Boolean).map((ink,ii)=><span key={ii} title={ink} style={{width:11,height:11,borderRadius:3,background:pantoneHex(ink)||'#cbd5e1',border:'1px solid #d1d5db'}}/>)}</span>}</span>)}</div>:<div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No color ways</div>)}
        </div>
        {/* All mockup versions */}
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:'#1e40af'}}>Mockup Files ({mockups.length})</div>
            {saveArt&&<button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={pickMock}><Icon name="plus" size={11}/> Add Mockup</button>}
          </div>
          {mockups.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8}}>
            {mockups.map((m,mi)=>{const url=m.url;return<div key={mi} style={{borderRadius:8,border:'1px solid #e2e8f0',overflow:'hidden',background:'white',cursor:'pointer',position:'relative'}} onClick={()=>openFile(m.file||url)}>
              {onSaveSO&&<button title="Remove this file from the artwork" onClick={e=>{e.stopPropagation();removeMockFromArt(url)}} style={{position:'absolute',top:4,right:4,zIndex:2,width:22,height:22,borderRadius:11,border:'none',background:'rgba(220,38,38,0.92)',color:'white',cursor:'pointer',fontSize:13,lineHeight:1,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}>×</button>}
              {_isImgUrl(url)?<img src={url} alt="" style={{width:'100%',height:120,objectFit:'contain',display:'block',background:'#f8fafc'}}/>
              :_isPdfUrl(url)?<div style={{height:120,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>{_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt="" style={{maxHeight:100,objectFit:'contain'}} onError={e=>{e.target.style.display='none'}}/>:<span style={{fontSize:32}}>PDF</span>}</div>
              :<div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontSize:28}}>📄</div>}
              <div style={{padding:'4px 6px',fontSize:9,color:'#64748b',borderTop:'1px solid #f1f5f9'}}>{fileDisplayName(m.file||url)}{(m.file&&m.file.color_way)&&<span style={{marginLeft:4,padding:'1px 5px',background:'#dbeafe',color:'#1e40af',borderRadius:8,fontWeight:700}}>{m.file.color_way}</span>}<br/><span style={{color:'#94a3b8'}}>{m.src}</span></div>
              {onSaveSO&&cwColors.length>0&&<select onClick={e=>e.stopPropagation()} value="" onChange={e=>{e.stopPropagation();const v=e.target.value;if(v)applyMockToCW(m.file||url,v)}} style={{width:'100%',fontSize:9,borderTop:'1px solid #f1f5f9',border:'none',borderTopWidth:1,borderTopStyle:'solid',borderTopColor:'#f1f5f9',padding:'4px',cursor:'pointer',color:'#1e40af',background:'#f8fafc',fontWeight:600}}>
                <option value="">Apply to color…</option>
                {cwColors.map(c=><option key={c} value={c}>{c}</option>)}
              </select>}
            </div>})}
          </div>}
          {saveArt&&<div style={{marginTop:8,border:'2px dashed #bfdbfe',borderRadius:6,padding:10,textAlign:'center',cursor:'pointer',background:'#eff6ff'}}
            onClick={pickMock}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#dbeafe';e.currentTarget.style.borderColor='#3b82f6'}}
            onDragLeave={e=>{e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe'}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe';if(e.dataTransfer.files&&e.dataTransfer.files.length)addMockToArt(e.dataTransfer.files)}}>
            <div style={{fontSize:11,color:'#2563eb',fontWeight:600}}>Drop mockup files or click to browse</div>
            <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>Images or PDF</div></div>}
        </div>
        {/* Production files (internal) */}
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:'#d97706'}}>Production Files ({prodFiles.length}) <span style={{fontSize:10,fontWeight:500,color:'#94a3b8'}}>Internal only</span></div>
            {saveArt&&<button className="btn btn-sm" style={{fontSize:11,background:'#f59e0b',color:'white',border:'none'}} onClick={pickProd}><Icon name="plus" size={11}/> Add Production File</button>}
          </div>
          {prodFiles.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8}}>
            {prodFiles.map((m,mi)=>{const url=m.url;return<div key={mi} style={{borderRadius:8,border:'1px solid #fde68a',overflow:'hidden',background:'#fffbeb',cursor:'pointer',position:'relative'}} onClick={()=>openFile(m.file||url)}>
              {saveArt&&<button title="Remove this file from the artwork" onClick={e=>{e.stopPropagation();removeMockFromArt(url)}} style={{position:'absolute',top:4,right:4,zIndex:2,width:22,height:22,borderRadius:11,border:'none',background:'rgba(220,38,38,0.92)',color:'white',cursor:'pointer',fontSize:13,lineHeight:1,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}>×</button>}
              {_isImgUrl(url)?<img src={url} alt="" style={{width:'100%',height:120,objectFit:'contain',display:'block',background:'#fff'}}/>
              :_isPdfUrl(url)?<div style={{height:120,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#fff'}}>{_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt="" style={{maxHeight:100,objectFit:'contain'}} onError={e=>{e.target.style.display='none'}}/>:<span style={{fontSize:32}}>PDF</span>}</div>
              :<div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center',background:'#fff',fontSize:28}}>📄</div>}
              <div style={{padding:'4px 6px',fontSize:9,color:'#64748b',borderTop:'1px solid #fef3c7'}}>{fileDisplayName(m.file||url)}<br/><span style={{color:'#94a3b8'}}>{m.src}</span></div>
            </div>})}
          </div>}
          {prodFiles.length===0&&!saveArt&&<div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No production files attached</div>}
          {saveArt&&<div style={{marginTop:8,border:'2px dashed #fde68a',borderRadius:6,padding:10,textAlign:'center',cursor:'pointer',background:'#fffbeb'}}
            onClick={pickProd}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#fef3c7';e.currentTarget.style.borderColor='#f59e0b'}}
            onDragLeave={e=>{e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a'}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a';if(e.dataTransfer.files&&e.dataTransfer.files.length)addProdToArt(e.dataTransfer.files)}}>
            <div style={{fontSize:11,color:'#d97706',fontWeight:600}}>Drop production files or click to browse</div>
            <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>DST, AI seps, PDF, PNG, JPG</div></div>}
        </div>
        {/* Jobs / orders that used this art */}
        {usedOnSOs.length>0&&<div>
          <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:8}}>Used on {usedOnSOs.length} Order(s)</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {usedOnSOs.map((u,ui)=><div key={ui} style={{padding:10,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <div><span style={{fontWeight:700,fontSize:13,color:'#1e40af',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{setCustArtDetail(null);onOpenSO(u.so_id)}}>{u.so_id}</span><span style={{fontSize:11,color:'#64748b',marginLeft:6}}>{u.memo}</span></div>
                <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:u.status==='complete'?'#dcfce7':'#dbeafe',color:u.status==='complete'?'#166534':'#1e40af'}}>{(u.status||'open').replace(/_/g,' ')}</span>
              </div>
              {u.items.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                {u.items.map((it,ii)=><span key={ii} style={{fontSize:10,padding:'2px 6px',background:'#e2e8f0',borderRadius:4,color:'#475569'}}>{it.sku||it.name} · {(it.deco_type||art.deco_type||'').replace(/_/g,' ')} · {it.position||'—'}</span>)}
              </div>}
            </div>)}
          </div>
        </div>}
        {usedOnSOs.length===0&&art._src==='library'&&<div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>Not yet used on any orders</div>}
        {art.notes&&<div style={{marginTop:12,fontSize:12,color:'#64748b',padding:8,background:'#f1f5f9',borderRadius:6}}>Notes: {art.notes}</div>}
      </div>
      <div className="modal-footer">
        {isP&&!art._appliesToAll&&<button className="btn btn-primary" style={{marginRight:'auto'}} onClick={()=>{promoteArtToLibrary(art);setCustArtDetail(null)}}><Icon name="plus" size={12}/> Use for whole program</button>}
        <button className="btn btn-secondary" onClick={()=>setCustArtDetail(null)}>Close</button></div>
    </div></div>})()}
  {tab==='catalog'&&<CoachCatalogAccess customer={customer} nf={nf} onUpdateCustomer={(nc)=>{setCustLocal(nc);onRefreshCustomer&&onRefreshCustomer(nc)}}/>}
  {tab==='reporting'&&(()=>{
    // Pull every invoice-type row out of allOrders for this customer (or parent+subs).
    // allOrders already merges portal invs with NetSuite hist_invoices, so hist rows
    // (marked _hist) report revenue and dates here even though they carry no items/margin.
    const allInvs=allOrders.filter(o=>ids.includes(o.customer_id)&&o.type==='invoice');
    const now=new Date();const curY=now.getFullYear();
    // Tolerate MM/DD/YY, ISO YYYY-MM-DD, or anything Date can parse.
    const pd=ds=>{if(!ds)return null;const m=String(ds).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if(m){let y=parseInt(m[3]);if(y<100)y+=2000;const d=new Date(y,parseInt(m[1])-1,parseInt(m[2]));return isNaN(d)?null:d}
      const d2=new Date(ds);return isNaN(d2)?null:d2};
    const inRange=(inv)=>{const d=pd(inv.date);if(!d&&rR!=='alltime')return false;
      if(rR==='thisyear')return d.getFullYear()===curY;
      if(rR==='lastyear')return d.getFullYear()===curY-1;
      if(rR==='rolling'){const cutoff=new Date(now);cutoff.setFullYear(cutoff.getFullYear()-1);return d>=cutoff}
      return true};
    const filt=allInvs.filter(inRange);
    const rev=filt.reduce((a,i)=>a+(Number(i.total)||0),0);
    const count=filt.length;
    const avg=count>0?Math.round(rev/count):0;
    const dates=filt.map(i=>pd(i.date)).filter(Boolean).sort((a,b)=>a-b);
    const first=dates[0];const last=dates[dates.length-1];
    const fmt=n=>'$'+Math.round(n).toLocaleString();
    const fmtD=d=>d?d.toISOString().slice(0,10):'—';
    const histCount=filt.filter(i=>i._hist).length;
    const sortedInvs=[...filt].sort((a,b)=>{const da=pd(a.date),db=pd(b.date);return(db?db.getTime():0)-(da?da.getTime():0)});
    return<div className="card"><div className="card-header"><h2>Reporting</h2><div style={{display:'flex',gap:4}}>{[['thisyear','This Year'],['lastyear','Last Year'],['rolling','Rolling 12'],['alltime','All']].map(([v,l])=><button key={v} className={`btn btn-sm ${rR===v?'btn-primary':'btn-secondary'}`} onClick={()=>setRR(v)}>{l}</button>)}</div></div>
      <div className="card-body">
        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{fmt(rev)}</div></div>
          <div className="stat-card"><div className="stat-label">Invoices</div><div className="stat-value">{count}</div></div>
          <div className="stat-card"><div className="stat-label">Avg Invoice</div><div className="stat-value">{fmt(avg)}</div></div>
          <div className="stat-card"><div className="stat-label">First → Last</div><div className="stat-value" style={{fontSize:13}}>{fmtD(first)} → {fmtD(last)}</div></div>
        </div>
        {histCount>0&&<div style={{fontSize:10,color:'#94a3b8',marginTop:8}}>Includes {histCount} NetSuite historical invoice{histCount===1?'':'s'} (revenue and dates only — no line items).</div>}
        {sortedInvs.length>0&&<div style={{marginTop:12}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>Invoices</div>
          <table style={{fontSize:12,width:'100%'}}><thead><tr><th style={{textAlign:'left'}}>Date</th><th style={{textAlign:'left'}}>Invoice #</th>{isP&&<th style={{textAlign:'left'}}>Sub</th>}<th style={{textAlign:'left'}}>Memo</th><th style={{textAlign:'right'}}>Total</th><th>Source</th></tr></thead><tbody>
            {sortedInvs.map((i,idx)=>{const d=pd(i.date);return<tr key={i.id+'-'+idx}>
              <td style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>{fmtD(d)}</td>
              <td style={{fontWeight:700,color:'#1e40af'}}>{i.document_number||i.id}</td>
              {isP&&<td><span className="badge badge-gray">{gn(i.customer_id)}</span></td>}
              <td style={{color:'#475569'}}>{i.memo||'—'}</td>
              <td style={{textAlign:'right',fontWeight:700}}>{fmt(Number(i.total)||0)}</td>
              <td><span className="badge" style={{background:i._hist?'#f1f5f9':'#dbeafe',color:i._hist?'#475569':'#1e40af',fontSize:9,fontWeight:600}}>{i._hist?'NetSuite':'Portal'}</span></td>
            </tr>})}
          </tbody></table>
        </div>}
      </div>
    </div>;
  })()}

  {/* EMAIL INVOICE MODAL */}
  {showInvEmail&&(()=>{
    const openInvs=allOrders.filter(oo=>ids.includes(oo.customer_id)&&oo.type==='invoice'&&oo.status==='open');
    const accts=getBillingContacts(customer,allCustomers);
    const acctContact=accts[0]||(customer.contacts||[])[0];
    const ccAccts=accts.filter(a=>a.email&&a.email!==acctContact?.email);
    const displayInvs=invEmailOverdueOnly?openInvs.filter(inv=>{const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;return age>30;}):openInvs;
    const totalDue=displayInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
    return<div className="modal-overlay" onClick={()=>setShowInvEmail(false)}><div className="modal" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
      <div className="modal-header"><h2>📄 Email Invoices</h2><button className="modal-close" onClick={()=>setShowInvEmail(false)}>×</button></div>
      <div className="modal-body">
        {/* Sending to */}
        <div style={{background:'#f8fafc',borderRadius:8,padding:12,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>SENDING TO</div>
          <div style={{fontSize:14,fontWeight:600}}>{acctContact?.name||'—'} <span style={{fontSize:12,color:'#64748b'}}>({acctContact?.role||'Primary'})</span>{acctContact?._inherited_from&&<span style={{fontSize:10,marginLeft:6,padding:'1px 6px',background:'#ede9fe',color:'#6d28d9',borderRadius:10,fontWeight:600}}>from {acctContact._inherited_from}</span>}</div>
          <div style={{fontSize:13,color:'#2563eb'}}>{acctContact?.email||'No email on file'}</div>
          {ccAccts.length>0&&<div style={{fontSize:11,color:'#64748b',marginTop:6}}><strong>CC:</strong> {ccAccts.map(a=>a.email+(a._inherited_from?' (from '+a._inherited_from+')':'')).join(', ')}</div>}
          {accts.length===0&&(customer.contacts||[]).length>1&&<div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Tip: Set a contact's role to "Billing" to auto-send invoices there{customer.parent_id?' — or set one on the parent customer to apply to all sub-customers':''}</div>}
        </div>
        {/* Invoice list */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>INVOICES TO INCLUDE</span>
            <label style={{display:'flex',alignItems:'center',gap:5,fontWeight:500,fontSize:11,color:'#dc2626',cursor:'pointer',textTransform:'none'}}>
              <input type="checkbox" checked={invEmailOverdueOnly} onChange={e=>setInvEmailOverdueOnly(e.target.checked)} style={{accentColor:'#dc2626'}}/>
              Overdue only (30+ days)
            </label>
          </div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
            {displayInvs.length===0&&<div style={{padding:'14px',textAlign:'center',fontSize:12,color:'#94a3b8'}}>No overdue invoices</div>}
            {displayInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
              return<div key={inv.id} style={{padding:'10px 14px',borderBottom:i<displayInvs.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:'#1e40af'}}>{inv.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{inv.memo||'Invoice'} · {inv.date||'—'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:700,color:'#dc2626'}}>${bal.toLocaleString()}</div>
                  <div style={{fontSize:10,color:age>30?'#dc2626':age>14?'#d97706':'#64748b'}}>{age>0?age+' days old':'Current'}</div>
                </div>
              </div>})}
            {displayInvs.length>0&&<div style={{padding:'10px 14px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:700,color:'#dc2626'}}>Total Due</span>
              <span style={{fontSize:18,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
            </div>}
          </div>
        </div>
        {/* Message */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>MESSAGE</div>
          <textarea className="form-input" rows={5} value={invEmailMsg} onChange={e=>setInvEmailMsg(e.target.value)} style={{fontFamily:'inherit',fontSize:13}}/>
        </div>
        {/* Preview */}
        <div style={{background:'#f8fafc',borderRadius:8,padding:12,marginTop:14,fontSize:11,color:'#64748b'}}>
          <strong>Preview:</strong> Email will include this message + PDF attachment{displayInvs.length>1?'s':''} for {displayInvs.length>0?displayInvs.map(i=>i.id).join(', '):'(none selected)'}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowInvEmail(false)}>Cancel</button>
        <button className="btn btn-primary" style={{background:'#dc2626'}} disabled={displayInvs.length===0} onClick={()=>{setShowInvEmail(false);const _ccLine=ccAccts.length>0?'\nCC: '+ccAccts.map(a=>a.email).join(', '):'';alert('📧 Invoice email sent to '+(acctContact?.email||'—')+_ccLine+'\n'+displayInvs.length+' invoice(s) (demo)')}}>📧 Send {displayInvs.length} Invoice{displayInvs.length!==1?'s':''}</button>
      </div>
    </div></div>})()}

  {/* SEND STATEMENT MODAL */}
  {showStatement&&(()=>{
    const allInvs=allOrders.filter(oo=>ids.includes(oo.customer_id)&&oo.type==='invoice');
    const openInvs=allInvs.filter(i=>i.status==='open');
    const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
    const now=new Date();
    const aging={current:0,over30:0,over60:0,over90:0};
    openInvs.forEach(inv=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((now-new Date(inv.date))/(1000*60*60*24)):0;if(age>90)aging.over90+=bal;else if(age>60)aging.over60+=bal;else if(age>30)aging.over30+=bal;else aging.current+=bal});
    return<div className="modal-overlay" onClick={()=>setShowStatement(false)}><div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
      <div className="modal-header"><h2>📋 Send Account Statement</h2><button className="modal-close" onClick={()=>setShowStatement(false)}>×</button></div>
      <div className="modal-body">
        {/* Customer info */}
        <div style={{background:'#f8fafc',borderRadius:8,padding:12,marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontSize:16,fontWeight:700}}>{customer.name}</div><div style={{fontSize:12,color:'#64748b'}}>{customer.alpha_tag} · {tl[customer.payment_terms]||'Net 30'}</div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#64748b'}}>Total Balance</div><div style={{fontSize:22,fontWeight:800,color:totalDue>0?'#dc2626':'#22c55e'}}>${totalDue.toLocaleString()}</div></div>
        </div>
        {/* Aging summary */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>AGING SUMMARY</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8}}>
            <div style={{padding:10,background:'#f0fdf4',borderRadius:6,textAlign:'center'}}><div style={{fontSize:10,color:'#64748b'}}>Current</div><div style={{fontSize:16,fontWeight:700,color:'#16a34a'}}>${aging.current.toLocaleString()}</div></div>
            <div style={{padding:10,background:aging.over30>0?'#fef3c7':'#f8fafc',borderRadius:6,textAlign:'center'}}><div style={{fontSize:10,color:'#64748b'}}>31-60 Days</div><div style={{fontSize:16,fontWeight:700,color:aging.over30>0?'#d97706':'#94a3b8'}}>${aging.over30.toLocaleString()}</div></div>
            <div style={{padding:10,background:aging.over60>0?'#fed7aa':'#f8fafc',borderRadius:6,textAlign:'center'}}><div style={{fontSize:10,color:'#64748b'}}>61-90 Days</div><div style={{fontSize:16,fontWeight:700,color:aging.over60>0?'#ea580c':'#94a3b8'}}>${aging.over60.toLocaleString()}</div></div>
            <div style={{padding:10,background:aging.over90>0?'#fecaca':'#f8fafc',borderRadius:6,textAlign:'center'}}><div style={{fontSize:10,color:'#64748b'}}>90+ Days</div><div style={{fontSize:16,fontWeight:700,color:aging.over90>0?'#dc2626':'#94a3b8'}}>${aging.over90.toLocaleString()}</div></div>
          </div>
        </div>
        {/* Open invoices */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>OPEN INVOICES ({openInvs.length})</div>
          {openInvs.length>0?<div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
            <table style={{fontSize:12,marginBottom:0}}><thead><tr><th>Invoice</th><th>Date</th><th>Memo</th><th style={{textAlign:'right'}}>Total</th><th style={{textAlign:'right'}}>Paid</th><th style={{textAlign:'right'}}>Balance</th><th style={{textAlign:'right'}}>Age</th></tr></thead><tbody>
            {openInvs.map(inv=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((now-new Date(inv.date))/(1000*60*60*24)):0;
              return<tr key={inv.id}><td style={{fontWeight:600,color:'#1e40af'}}>{inv.id}</td><td>{inv.date||'—'}</td><td style={{fontSize:11,color:'#64748b'}}>{inv.memo||'—'}</td><td style={{textAlign:'right'}}>${(inv.total||0).toLocaleString()}</td><td style={{textAlign:'right'}}>${(inv.paid||0).toLocaleString()}</td><td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>${bal.toLocaleString()}</td><td style={{textAlign:'right',fontSize:11,color:age>60?'#dc2626':age>30?'#d97706':'#64748b'}}>{age}d</td></tr>})}
            </tbody></table>
          </div>:<div style={{padding:16,textAlign:'center',color:'#94a3b8',fontSize:13}}>No open invoices</div>}
        </div>
        {/* From */}
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>FROM</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {(()=>{const rep=REPS.find(r=>r.id===customer.primary_rep_id);return rep?<label style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',border:'1px solid '+(stmtFrom==='rep'?'#2563eb':'#e2e8f0'),background:stmtFrom==='rep'?'#eff6ff':'white',borderRadius:6,cursor:'pointer',fontSize:12}}>
              <input type="radio" name="stmtFrom" checked={stmtFrom==='rep'} onChange={()=>setStmtFrom('rep')}/>
              <span><strong>{rep.name}</strong> <span style={{color:'#94a3b8'}}>(primary rep)</span></span>
            </label>:null})()}
            <label style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',border:'1px solid '+(stmtFrom==='accounting'?'#2563eb':'#e2e8f0'),background:stmtFrom==='accounting'?'#eff6ff':'white',borderRadius:6,cursor:'pointer',fontSize:12}}>
              <input type="radio" name="stmtFrom" checked={stmtFrom==='accounting'} onChange={()=>setStmtFrom('accounting')}/>
              <span><strong>Accounting</strong> <span style={{color:'#94a3b8'}}>accounting@nationalsportsapparel.com</span></span>
            </label>
          </div>
        </div>
        {/* Send to */}
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>SEND TO</div>
          <input className="form-input" value={stmtEmail} onChange={e=>setStmtEmail(e.target.value)} placeholder="Email address" style={{marginBottom:6}}/>
          <textarea className="form-input" rows={4} value={stmtMsg} onChange={e=>setStmtMsg(e.target.value)} style={{fontFamily:'inherit',fontSize:13}}/>
        </div>
        {!_brevoKey&&<div style={{padding:8,background:'#fef3c7',color:'#92400e',borderRadius:6,fontSize:11,marginTop:4}}>⚠ Brevo sending disabled (REACT_APP_BREVO_ENABLED=false) — using email-client fallback.</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowStatement(false)} disabled={stmtSending}>Cancel</button>
        <button className="btn btn-primary" disabled={stmtSending||!stmtEmail.trim()} onClick={async()=>{
          const toList=stmtEmail.split(',').map(s=>s.trim()).filter(s=>s&&/@/.test(s));
          if(toList.length===0){nf('Enter a valid email address','error');return}
          setStmtSending(true);
          const portalUrl=customer.alpha_tag?(window.location.origin+'/?portal='+customer.alpha_tag):'';
          const rep=REPS.find(r=>r.id===customer.primary_rep_id);
          const repEmail=rep&&cu?.email&&/@nationalsportsapparel\.com$/i.test(cu.email)?cu.email:'';
          const senderEmail=stmtFrom==='rep'&&repEmail?repEmail:'accounting@nationalsportsapparel.com';
          const senderName=stmtFrom==='rep'&&rep?rep.name+' — National Sports Apparel':'National Sports Apparel Accounting';
          const replyTo=stmtFrom==='rep'&&repEmail?{email:repEmail,name:rep?.name}:{email:'accounting@nationalsportsapparel.com',name:'NSA Accounting'};
          // Build invoice rows
          const _$=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
          const invRowsHtml=openInvs.map(inv=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((now-new Date(inv.date))/(1000*60*60*24)):0;const ageColor=age>60?'#dc2626':age>30?'#d97706':'#64748b';
            return '<tr>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#1e40af">'+inv.id+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#475569">'+(inv.date||'—')+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:12px">'+(inv.memo||'—')+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">'+_$(inv.total)+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#166534">'+_$(inv.paid)+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#dc2626">'+_$(bal)+'</td>'
              +'<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:'+ageColor+';font-size:12px">'+age+'d</td>'
              +'</tr>';
          }).join('');
          const agingCard=(label,val,bg,color)=>'<td style="padding:10px;background:'+bg+';border-radius:6px;text-align:center;width:25%"><div style="font-size:11px;color:#64748b;margin-bottom:2px">'+label+'</div><div style="font-size:16px;font-weight:700;color:'+color+'">'+_$(val)+'</div></td>';
          const inner=''
            +'<div style="white-space:pre-wrap;margin-bottom:16px">'+(stmtMsg||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>'
            +(portalUrl?'<div style="text-align:center;margin:18px 0"><a href="'+portalUrl+'" style="display:inline-block;padding:12px 28px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:700">View Statement &amp; Invoices in Your Portal</a><div style="font-size:11px;color:#94a3b8;margin-top:6px">Download PDFs, view details, and pay online</div></div>':'')
            +'<div style="background:#f8fafc;border-radius:8px;padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">'
            +'<div><div style="font-size:16px;font-weight:700">'+customer.name+'</div><div style="font-size:12px;color:#64748b">'+(customer.alpha_tag||'')+' · '+(tl[customer.payment_terms]||'Net 30')+'</div></div>'
            +'<div style="text-align:right"><div style="font-size:11px;color:#64748b">Total Balance Due</div><div style="font-size:22px;font-weight:800;color:'+(totalDue>0?'#dc2626':'#22c55e')+'">'+_$(totalDue)+'</div></div>'
            +'</div>'
            +'<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">AGING SUMMARY</div>'
            +'<table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:14px"><tr>'
            +agingCard('Current',aging.current,'#f0fdf4','#16a34a')
            +agingCard('31-60 Days',aging.over30,aging.over30>0?'#fef3c7':'#f8fafc',aging.over30>0?'#d97706':'#94a3b8')
            +agingCard('61-90 Days',aging.over60,aging.over60>0?'#fed7aa':'#f8fafc',aging.over60>0?'#ea580c':'#94a3b8')
            +agingCard('90+ Days',aging.over90,aging.over90>0?'#fecaca':'#f8fafc',aging.over90>0?'#dc2626':'#94a3b8')
            +'</tr></table>'
            +'<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">OPEN INVOICES ('+openInvs.length+')</div>'
            +(openInvs.length>0?'<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px"><thead><tr style="background:#f8fafc"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;font-weight:700">Invoice</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;font-weight:700">Date</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;font-weight:700">Memo</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#475569;font-weight:700">Total</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#475569;font-weight:700">Paid</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#475569;font-weight:700">Balance</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#475569;font-weight:700">Age</th></tr></thead><tbody>'+invRowsHtml+'</tbody></table>':'<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px">No open invoices</div>')
            +(portalUrl?'<div style="margin-top:18px;padding:12px;background:#eff6ff;border-radius:6px;font-size:12px;color:#1e40af;text-align:center">Need to download a specific invoice or pay online? Visit <a href="'+portalUrl+'" style="color:#2563eb;font-weight:700">your portal</a>.</div>':'');
          const html=buildBrandedEmailHtml(inner,NSA);
          const subject='Account Statement — '+customer.name+(totalDue>0?' — Balance Due '+_$(totalDue):'');
          const res=await sendBrevoEmail({to:toList.map(e=>({email:e})),subject,htmlContent:html,senderName,senderEmail,replyTo});
          setStmtSending(false);
          if(res.ok){nf('Statement sent to '+toList.join(', '));setShowStatement(false)}
          else{nf('Failed to send statement: '+(res.error||'Unknown error'),'error')}
        }}>{stmtSending?'Sending…':'📧 Send Statement'}</button>
      </div>
    </div></div>})()}

  {/* CUSTOMER PORTAL VIEW */}
  {showPortal&&(()=>{
    const activeSOs=custSOs.filter(s=>calcSOStatus(s)!=='complete');
    const completedSOs=custSOs.filter(s=>calcSOStatus(s)==='complete');
    const openInvs=allOrders.filter(oo=>ids.includes(oo.customer_id)&&oo.type==='invoice'&&oo.status==='open');
    const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
    const rep=REPS.find(r=>r.id===customer.primary_rep_id);
    // Collect all jobs across customer's SOs
    const allPortalJobs=[];activeSOs.forEach(so=>{safeJobs(so).forEach(j=>{allPortalJobs.push({...j,so,soMemo:so.memo})})});
    const artLabelsP={needs_art:'Art Needed',art_requested:'Art Requested',art_in_progress:'Art In Progress',waiting_approval:'Awaiting Your Approval',production_files_needed:'Art Approved — Waiting',art_complete:'Approved'};
    const prodLabelsP={hold:'On Hold',staging:'In Line',in_process:'In Production',completed:'Done',shipped:'Shipped'};

    // Job detail view inside portal
    if(portalJobView){
      const j=portalJobView.job;const so=portalJobView.so;
      const af2=safeArt(so).find(a=>a.id===j.art_file_id);
      const _jAF2=[...new Set([j.art_file_id,...(j._art_ids||[])].filter(Boolean))].map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
      const _jSkus2=new Set((j.items||[]).map(gi=>gi.sku).filter(Boolean));
      const _mf2Seen=new Set();
      const mockupFiles2=_filterDisplayable([...(af2?.mockup_files||af2?.files||[]),..._jAF2.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus2.has(k.split('|')[0])).flatMap(([,arr])=>arr||[]))]).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_mf2Seen.has(u))return false;_mf2Seen.add(u);return true});
      const items=(j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];const prd2=prod.find(pp=>pp.id===it?.product_id||pp.sku===it?.sku);return{...gi,brand:it?.brand||'',fullName:safeStr(it?.name)||gi.name,image_url:prd2?.image_url||it?._colorImage||'',back_image_url:prd2?.back_image_url||it?._colorBackImage||''}});
      return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',borderRadius:'12px 12px 0 0',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setPortalJobView(null)}>← Back</button>
          <button style={{position:'absolute',top:8,right:12,background:'none',border:'none',color:'white',fontSize:18,cursor:'pointer',opacity:0.7}} onClick={()=>{setPortalJobView(null);setShowPortal(false)}}>×</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ARTWORK PROOF</div>
            <div style={{fontSize:18,fontWeight:800}}>{j.art_name}</div>
            <div style={{fontSize:12,opacity:0.7}}>{so.memo} · {j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* Mockup artwork display */}
          {mockupFiles2.length>0&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>🖼️ Artwork Mockup</div>
            {mockupFiles2.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);
              return<div key={fi} style={{borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden',background:'white',marginBottom:8}}>
                {_isImgUrl(url)?<img src={url} alt={name} style={{width:'100%',maxHeight:500,objectFit:'contain',display:'block',cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}/>
                :_isPdfUrl(url)?<div style={{position:'relative'}}>
                  {_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt={name} style={{width:'100%',maxHeight:500,objectFit:'contain',display:'block'}} onError={e=>{e.target.style.display='none';e.target.nextSibling.style.display='flex'}}/>:null}
                  <div style={{display:_cloudinaryPdfThumb(url)?'none':'flex',flexDirection:'column',alignItems:'center',padding:40,gap:8}}>
                    <span style={{fontSize:48}}>PDF</span>
                    <span style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>{name}</span>
                  </div>
                  <button className="btn btn-sm" style={{position:'absolute',bottom:8,right:8,fontSize:11,background:'#1e40af',color:'white',border:'none',padding:'6px 14px',borderRadius:6}} onClick={()=>setMockupLightbox(url)}>Open PDF</button>
                </div>
                :<div style={{display:'flex',alignItems:'center',gap:8,padding:20,cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}>
                  <span style={{fontSize:32}}>📄</span><span style={{fontSize:14,fontWeight:600,color:'#1e40af'}}>{name}</span>
                </div>}
              </div>})}
          </div>}
          {mockupFiles2.length===0&&<div style={{padding:20,textAlign:'center',background:'#f8fafc',border:'2px dashed #d1d5db',borderRadius:10,marginBottom:16}}>
            <div style={{fontSize:36,marginBottom:6}}>🎨</div>
            <div style={{fontSize:13,color:'#94a3b8',fontWeight:600}}>Artwork mockup is being prepared</div>
          </div>}

          {/* Artwork details — pantones, sizes, locations */}
          {af2&&(()=>{const _fallback2=(af2.ink_colors||af2.thread_colors||'').split(/[,\n]/).map(c3=>c3.trim()).filter(Boolean);const _isE2=af2.deco_type==='embroidery';
            const _dp2=new Set();const numDecos2=[];const _cwColors2=new Set();(j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(it)safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id===j.art_file_id){if(d.position)_dp2.add(d.position);if(d.color_way_id&&af2.color_ways){const cw=af2.color_ways.find(c=>c.id===d.color_way_id);if(cw)cw.inks?.forEach(c=>{if(c&&c.trim())_cwColors2.add(c.trim())})}}if(d.kind==='numbers')numDecos2.push(d)})});
            const _gcColors2=new Set();(j.items||[]).forEach(gi=>{const gk2=gi.sku+'|'+(gi.color||'');const gc2=af2.garment_colors?.[gk2]||{};Object.values(gc2).flat().forEach(c=>{if(c&&c.trim())_gcColors2.add(c.trim())})});
            // Final fallback: union of all CW inks on the art file. Covers SOs where CWs are defined but
            // decorations don't carry an explicit color_way_id link — without this, colors render as empty.
            const _allCwInks2=[...new Set((af2.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
            const _cl2=_gcColors2.size>0?[..._gcColors2]:_cwColors2.size>0?[..._cwColors2]:_fallback2.length>0?_fallback2:_allCwInks2;
            const _pl2=_dp2.size>0?[..._dp2]:(j.positions||'').split(',').map(p=>p.trim()).filter(Boolean);const _as2=af2.art_sizes||{};
            const _cm2={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
            const nd=numDecos2[0];
            return<div style={{marginBottom:16,padding:'14px 16px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10}}>
              <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:10}}>Artwork Details</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{af2.deco_type?.replace(/_/g,' ')||'—'}</div></div>
                <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Location{_pl2.length>1?'s':''}</div><div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{_pl2.join(', ')||'—'}</div></div>
                {_pl2.length<=1?<div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{af2.art_size||'—'}</div></div>
                :_pl2.map((pos,pi)=><div key={pi}><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Size — {pos}</div><div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{_as2[pos]||(pi===0?af2.art_size:'')||'—'}</div></div>)}
                <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Total Units</div><div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{(j.items||[]).reduce((a,gi)=>a+(gi.units||0),0)}</div></div>
              </div>
              {_cl2.length>0&&<div style={{marginBottom:nd?10:0}}>
                <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',marginBottom:4}}>{_isE2?'Thread Colors':'Ink Colors / Pantones'} ({_cl2.length})</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {_cl2.map((cl,i)=>{const clL=cl.toLowerCase();const sw=_cm2[cl]||Object.entries(_cm2).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                    return<div key={i} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 10px',background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
                      <div style={{width:14,height:14,borderRadius:3,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                      <span style={{fontSize:11,fontWeight:600}}>{cl}</span></div>})}
                </div>
              </div>}
              {nd&&<div>
                <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',marginBottom:4}}>Numbers</div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:12}}>
                  <span><strong>{(nd.num_method||'heat_transfer').replace(/_/g,' ')}</strong></span>
                  <span>Size: <strong>{nd.num_size||'—'}</strong></span>
                  {nd.front_and_back&&<span>Back: <strong>{nd.num_size_back||nd.num_size||'—'}</strong></span>}
                  {nd.print_color&&<span>Color: <strong>{nd.print_color}</strong></span>}
                  {nd.front_and_back&&<span style={{padding:'1px 6px',borderRadius:4,background:'#7c3aed',color:'white',fontSize:10,fontWeight:700}}>Front + Back</span>}
                </div>
              </div>}
            </div>})()}

          {/* Per-item garments */}
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>👕 Garments</div>
          {items.map((gi,i)=><div key={i} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10,display:'flex',gap:14,alignItems:'center'}}>
            <div style={{display:'flex',gap:6,flexShrink:0}}>
              {gi.image_url?<img src={gi.image_url} alt="Front" style={{width:70,height:70,objectFit:'contain',borderRadius:8,border:'1px solid #e2e8f0',background:'white'}}/>
              :<div style={{width:70,height:70,background:'#f8fafc',border:'2px dashed #d1d5db',borderRadius:8,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                <div style={{fontSize:24}}>👕</div>
              </div>}
              {gi.back_image_url&&<img src={gi.back_image_url} alt="Back" style={{width:70,height:70,objectFit:'contain',borderRadius:8,border:'1px solid #e2e8f0',background:'white'}}/>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{gi.fullName}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{gi.sku} · {gi.color||'—'} {gi.brand&&'· '+gi.brand}</div>
              <div style={{fontSize:11,color:'#64748b',marginTop:2}}>📍 {j.positions} · {gi.units} units</div>
            </div>
          </div>)}

          {/* Approve / Reject */}
          {j.art_status==='waiting_approval'&&<div style={{border:'2px solid #f59e0b',background:'#fffbeb',borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontWeight:700,color:'#92400e',marginBottom:8}}>⏳ This artwork needs your approval</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center'}} onClick={()=>{
                const artId=j.art_file_id;if(artId&&onSaveSO){const updJobs2=safeJobs(so).map(jj=>jj.id===j.id?{...jj,art_status:'production_files_needed',coach_approved_at:new Date().toISOString()}:jj);const updatedSO={...so,art_files:(so.art_files||[]).map(af3=>af3.id===artId?{...af3,status:'approved'}:af3),jobs:updJobs2,updated_at:new Date().toLocaleString()};onSaveSO(updatedSO)}
                setPortalJobView(null)}}>✅ Approve</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center'}} onClick={()=>{
                if(portalComment.trim()){
                  const artId=j.art_file_id;if(artId&&onSaveSO){
                    const rej={reason:portalComment.trim(),by:'Coach',at:new Date().toISOString()};
                    const updJobs2=safeJobs(so).map(jj=>jj.id===j.id?{...jj,art_status:'art_requested',rejections:[...(jj.rejections||[]),rej]}:jj);
                    const updatedSO={...so,art_files:(so.art_files||[]).map(af3=>af3.id===artId?{...af3,status:'waiting_for_art'}:af3),jobs:updJobs2,updated_at:new Date().toLocaleString()};
                    onSaveSO(updatedSO)}
                  setPortalComment('');setPortalJobView(null)}else{alert('Please add a comment explaining what needs to change.')}
              }}>❌ Request Changes</button>
            </div>
            <textarea className="form-input" rows={2} placeholder="Tell us what needs to change..." value={portalComment} onChange={e=>setPortalComment(e.target.value)} style={{marginTop:8,fontSize:12,resize:'vertical'}}/>
          </div>}
          {j.art_status==='art_complete'||j.art_status==='production_files_needed'?<div style={{background:'#f0fdf4',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#166534',fontWeight:600}}>✅ You approved this artwork</div>:null}
          {/* Status */}
          {j.prod_status!=='hold'&&<div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:16}}>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PRODUCTION STATUS</div>
            <div style={{fontSize:14,fontWeight:700,color:'#1e40af',marginTop:2}}>{prodLabelsP[j.prod_status]||j.prod_status}</div>
          </div>}
          {/* Comments */}
          <div>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>💬 Comments</div>
            {(j.art_messages||[]).length>0?<div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:0,marginBottom:8,maxHeight:200,overflowY:'auto'}}>
              {(j.art_messages||[]).map((m,mi)=><div key={mi} style={{padding:'8px 12px',borderBottom:mi<(j.art_messages||[]).length-1?'1px solid #f1f5f9':'none',background:m.is_system?'#fffbeb':'white'}}>
                {m.is_system?<div style={{fontSize:11,color:'#92400e',fontStyle:'italic',textAlign:'center'}}>{m.text}</div>
                :<><div style={{fontSize:11,fontWeight:700,color:'#1e40af'}}>{m.from_name} <span style={{fontWeight:400,color:'#94a3b8',fontSize:9}}>{new Date(m.ts).toLocaleString()}</span></div>
                <div style={{fontSize:12,color:'#334155'}}>{m.text}</div></>}
              </div>)}
            </div>:<div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:8,marginBottom:8,minHeight:40}}>
              <div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No comments yet</div>
            </div>}
            <div style={{display:'flex',gap:6}}>
              <input className="form-input" placeholder="Add a comment..." value={portalComment} onChange={e=>setPortalComment(e.target.value)} style={{flex:1,fontSize:12}} onKeyDown={e=>{if(e.key==='Enter'&&portalComment.trim()){
                const msg={id:'AM-'+Date.now(),from_id:'coach',from_name:'Coach',from_role:'coach',text:portalComment.trim(),ts:new Date().toISOString()};
                if(onSaveSO){const updJobs2=safeJobs(so).map(jj=>jj.id===j.id?{...jj,art_messages:[...(jj.art_messages||[]),msg]}:jj);onSaveSO({...so,jobs:updJobs2,updated_at:new Date().toLocaleString()})}
                setPortalComment('')}}}/>
              <button className="btn btn-sm btn-primary" onClick={()=>{if(portalComment.trim()){
                const msg={id:'AM-'+Date.now(),from_id:'coach',from_name:'Coach',from_role:'coach',text:portalComment.trim(),ts:new Date().toISOString()};
                if(onSaveSO){const updJobs2=safeJobs(so).map(jj=>jj.id===j.id?{...jj,art_messages:[...(jj.art_messages||[]),msg]}:jj);onSaveSO({...so,jobs:updJobs2,updated_at:new Date().toLocaleString()})}
                setPortalComment('')}}}>Send</button>
            </div>
          </div>
        </div>
      </div></div>
    }

    // Invoice detail view inside portal
    if(portalInvView){
      const inv=portalInvView;const bal=(inv.total||0)-(inv.paid||0);
      const linkedSO=inv.so_id?custSOs.find(s=>s.id===inv.so_id):null;
      // Generate a printable/downloadable invoice PDF — mirrors the coach portal download
      // and the admin invoice layout, but shows the school PO number (not the internal SO).
      const downloadInvPdf=()=>{
        const _$=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        const _rep=(REPS||[]).find(r=>r.id===customer?.primary_rep_id);
        const poNum=inv._po_number||linkedSO?.po_number;
        const isDeposit=inv.inv_type==='deposit';const depPct=isDeposit?(inv.deposit_pct||50)/100:1;
        const rows=[];let subTotal=0;
        const soItems=linkedSO?safeItems(linkedSO):[];const soArt=linkedSO?safeArt(linkedSO):[];
        const _pAQ={};soItems.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
        if(soItems.length>0){
          soItems.forEach(it=>{
            const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);if(!qty)return;
            const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
            const unitPrice=safeNum(it.unit_sell);const lineAmt=Math.round(qty*unitPrice*depPct*100)/100;subTotal+=lineAmt;
            let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'');
            if(szStr)itemName+='<br/><span style="color:#555">'+szStr+'</span>';
            rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
            safeDecos(it).forEach(d=>{
              const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soArt,cq);
              const eq=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoAmt=Math.round(eq*dp2.sell*depPct*100)/100;subTotal+=decoAmt;
              const artF=soArt.find(a2=>a2.id===d.art_file_id);const posLabel=d.position?' — '+d.position:'';
              rows.push({_class:'deco-row',cells:[{value:eq,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+pdfDecoLabel(d,artF)+posLabel+'</span>'},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
            });
          });
        }else{
          // Some NetSuite-imported lines only carry an amount (no qty/rate/desc),
          // so render those columns blank rather than a misleading 0 / $0.00.
          (inv.line_items||[]).forEach(li=>{const qty=safeNum(li.qty);const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):qty*rate;subTotal+=amt;rows.push({cells:[{value:qty||'',style:'text-align:center'},{value:li._sku||li.sku||'',style:'font-weight:700'},{value:safeStr(li._name||li.name||li.desc)||'Item'},{value:rate?_$(rate):'',style:'text-align:right'},{value:_$(amt),style:'text-align:right;font-weight:600'}]})});
        }
        const _ship=inv.shipping!=null?inv.shipping:(linkedSO?(linkedSO.shipping_type==='pct'?subTotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0)):0);
        const _tax=inv.tax||0;
        const billAddr=customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':(customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':'');
        const terms=inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial Invoice':inv.inv_type==='full'?'Invoice':'Final Invoice';
        printDoc({
          title:customer?.name||'Customer',docNum:inv.id,docType:'INVOICE',date:inv.date,
          headerRight:'<div class="ta">'+_$(inv.total||0)+'</div><div class="ts">Balance Due: <strong>'+_$(bal)+'</strong></div>'+(poNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+poNum+'</div>':''),
          infoBoxes:[
            {label:'Bill To',value:customer?.name||'—',sub:billAddr||''},
            {label:'Invoice Date',value:inv.date||new Date().toLocaleDateString(),sub:inv.due_date?'Due: '+inv.due_date:''},
            {label:'PO Number',value:poNum||'—'},
            {label:'Payment Terms',value:terms,sub:'Rep: '+(_rep?.name||'—')},
          ],
          tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
            rows:[...rows,
              {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
              ...(_ship>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(_ship),style:'text-align:right;border:none'}]}]:[]),
              ...(_tax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$(_tax),style:'text-align:right;border:none'}]}]:[]),
              {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(inv.total||0)+'</strong>',style:'text-align:right'}]},
              ...(inv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$(inv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
              ...(bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$(bal)+'</strong>',style:'text-align:right'}]}]:[]),
            ]}],
          footer:inv.inv_type==='deposit'?NSA.depositTerms:NSA.terms
        });
      };
      return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:550,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{background:'linear-gradient(135deg,#991b1b,#dc2626)',color:'white',padding:'20px 24px',borderRadius:'12px 12px 0 0',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setPortalInvView(null)}>← Back</button>
          <button style={{position:'absolute',top:8,right:12,background:'none',border:'none',color:'white',fontSize:18,cursor:'pointer',opacity:0.7}} onClick={()=>{setPortalInvView(null);setShowPortal(false)}}>×</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>INVOICE</div>
            <div style={{fontSize:20,fontWeight:800}}>{inv.id}</div>
            <div style={{fontSize:13,opacity:0.8}}>{inv.memo||'—'}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Amount Due</div>
            <div style={{fontSize:36,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div>
            {inv.paid>0&&<div style={{fontSize:12,color:'#64748b'}}>Paid: ${inv.paid.toLocaleString()} of ${inv.total.toLocaleString()}</div>}
            <div style={{marginTop:14}}><button style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 6px rgba(30,58,95,0.25)'}} onClick={downloadInvPdf}>📄 Download Invoice PDF</button></div>
          </div>
          {/* Order details from linked sales order */}
          {linkedSO&&<div style={{marginBottom:16,border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden'}}>
            <div style={{padding:'10px 14px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e3a5f'}}>📦 Order Details — {linkedSO.memo||linkedSO.id}</div>
              <span style={{fontSize:10,color:'#64748b'}}>{linkedSO.id}</span>
            </div>
            {safeItems(linkedSO).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0);
              return<div key={ii} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{qty} units</div>
                    <div style={{fontSize:10,color:'#64748b'}}>${safeNum(it.unit_sell).toFixed(2)}/ea</div>
                  </div>
                </div>
                {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {sizes.sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))}).map(([sz,q])=><div key={sz} style={{textAlign:'center',padding:'2px 5px',background:'#f1f5f9',borderRadius:4,minWidth:28}}>
                    <div style={{fontSize:8,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:11,fontWeight:700,color:'#1e3a5f'}}>{q}</div>
                  </div>)}
                </div>}
              </div>})}
            {linkedSO.expected_date&&<div style={{padding:'8px 14px',background:'#f8fafc',fontSize:11,color:'#64748b',display:'flex',justifyContent:'space-between'}}>
              <span>Expected Date</span><span style={{fontWeight:600,color:'#1e3a5f'}}>{linkedSO.expected_date}</span>
            </div>}
          </div>}
          {/* Invoice line items — only shown when there's no linked SO. When an SO is
              linked, the Order Details section above already lists every item (with
              correct pricing and sizes), so we don't repeat them here. */}
          {inv.line_items?.length>0&&!linkedSO&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Invoice Line Items</div>
            {inv.line_items.map((li,i)=>{const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):safeNum(li.qty)*rate;
              return<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{safeStr(li._name||li.name||li.desc)||li._sku||li.sku||'Item'}</div><div style={{fontSize:11,color:'#64748b'}}>{[safeNum(li.qty)>0?safeNum(li.qty):null,rate>0?'$'+rate.toFixed(2):null].filter(v=>v!=null).join(' × ')}</div></div>
              <div style={{fontWeight:700,fontSize:13}}>${amt.toFixed(2)}</div>
            </div>})}
          </div>}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:'2px solid #e2e8f0'}}>
            <span style={{fontWeight:800}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#dc2626'}}>${inv.total?.toLocaleString()}</span>
          </div>
          {bal>0&&<button style={{width:'100%',marginTop:16,padding:'14px 20px',background:portalPayLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:portalPayLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:portalPayLoading?0.8:1,transition:'all 0.2s'}} disabled={portalPayLoading} onClick={()=>{setPortalPayLoading(true);setPortalShowPay(inv)}}>
            {portalPayLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay ${bal.toLocaleString()}</>}
          </button>}
          {bal<=0&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Paid in Full</div>}
        </div>
      </div></div>
    }

    return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
      {/* Portal header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'24px 28px',borderRadius:'12px 12px 0 0',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <img src="/nsa-logo.svg" alt="NSA" style={{height:32,filter:'brightness(0) invert(1)',marginBottom:6}}/>
            <div style={{fontSize:22,fontWeight:800}}>{customer.name}</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>Customer Portal</div>
          </div>
          <div style={{textAlign:'right'}}>
            {totalDue>0&&<><div style={{fontSize:10,opacity:0.7}}>BALANCE DUE</div><div style={{fontSize:24,fontWeight:800}}>${totalDue.toLocaleString()}</div></>}
          </div>
        </div>
        <button style={{position:'absolute',top:12,right:16,background:'none',border:'none',color:'white',fontSize:20,cursor:'pointer',opacity:0.7}} onClick={()=>setShowPortal(false)}>×</button>
      </div>
      <div style={{padding:'20px 28px'}}>

        {/* Payment success banner */}
        {portalPaySuccess&&<div style={{padding:16,background:'#f0fdf4',border:'2px solid #22c55e',borderRadius:12,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>&#10003;</div>
          <div style={{fontSize:18,fontWeight:800,color:'#166534',marginBottom:4}}>Payment Successful!</div>
          <div style={{fontSize:14,color:'#166534'}}>${portalPaySuccess.amount.toLocaleString(undefined,{minimumFractionDigits:2})} paid{portalPaySuccess.fee>0?' + $'+portalPaySuccess.fee.toFixed(2)+' processing fee':''}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>A receipt has been sent to the customer's email.</div>
        </div>}

        {/* Pay Now button */}
        {totalDue>0&&<div style={{marginBottom:16}}>
          <button style={{width:'100%',padding:'14px 20px',background:portalPayLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:portalPayLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:portalPayLoading?0.8:1,transition:'all 0.2s'}} disabled={portalPayLoading} onClick={()=>{setPortalPayLoading(true);setPortalShowPay('all')}}>
            {portalPayLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay Now — ${totalDue.toLocaleString()}</>}
          </button>
          <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:6}}>
            <span style={{fontSize:10,color:'#94a3b8'}}>💳 Credit Card</span>
            <span style={{fontSize:10,color:'#94a3b8'}}> Apple Pay</span>
            <span style={{fontSize:10,color:'#94a3b8'}}>🏦 ACH/Bank</span>
          </div>
        </div>}

        {/* Open Estimates */}
        {(()=>{const pEsts=custEsts.filter(e=>e.status==='sent'||e.status==='draft'||e.status==='open');
          return pEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>📋 Estimates ({pEsts.length})</div>
          {pEsts.map(est=>{const t=(est.items||[]).reduce((a,it)=>{const sqq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=sqq>0?sqq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const dp2=dP(d,qq,[],qq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);
            return<div key={est.id} style={{border:'1px solid #f59e0b',borderRadius:10,padding:14,marginBottom:10,background:'#fffbeb'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{est.memo||est.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#92400e'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                  <span className={'badge '+(est.status==='sent'?'badge-amber':'badge-gray')}>{est.status}</span></div>
              </div></div>})}
          </>})()}

        {/* Active orders with clickable jobs */}
        {activeSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f',marginBottom:10}}>📦 Active Orders</div>
          {activeSOs.map(so=>{
            let totalU=0,fulU=0;
            safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
            const pct=totalU>0?Math.round(fulU/totalU*100):0;
            const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
            const soJobs=safeJobs(so);
            return<div key={so.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{so.memo||so.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Order {so.id} · {so.created_at?.split(' ')[0]}</div>
                </div>
                {so.expected_date&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'#64748b'}}>EXPECTED</div>
                  <div style={{fontSize:14,fontWeight:700,color:daysOut!=null&&daysOut<=7?'#dc2626':'#1e3a5f'}}>{so.expected_date}</div>
                </div>}
              </div>
              {/* Progress */}
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
                  <span style={{fontSize:11,fontWeight:700,color:pct>=100?'#166534':'#1e3a5f'}}>{pct}%</span>
                </div>
                <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
                  <div style={{height:8,borderRadius:6,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>
              </div>
              {/* Items */}
              <div style={{fontSize:12,marginBottom:soJobs.length>0?10:0}}>
                {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                  return<div key={ii} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #f8fafc'}}>
                    <span>{safeStr(it.name)||'Item'} <span style={{color:'#94a3b8'}}>({safeStr(it.color)||'—'})</span></span>
                    <span style={{fontWeight:600,color:'#64748b'}}>{qty} units</span></div>})}
              </div>
              {/* Clickable jobs — artwork proofs */}
              {soJobs.length>0&&<>
                <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>🎨 Artwork & Decoration</div>
                {soJobs.map(j=>{const _paf=safeArt(so).find(a=>a.id===j.art_file_id);const _pmf=_filterDisplayable(_paf?.mockup_files||_paf?.files||[]);
                  return<div key={j.id} style={{border:'1px solid '+(j.art_status==='waiting_approval'?'#f59e0b':'#e2e8f0'),background:j.art_status==='waiting_approval'?'#fffbeb':'#fafbfc',borderRadius:8,marginBottom:6,overflow:'hidden',cursor:'pointer'}} onClick={()=>{setPortalJobView({job:j,so});setPortalComment('')}}>
                  {_pmf.length>0&&<div style={{display:'grid',gridTemplateColumns:_pmf.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
                    {_pmf.map((f,fi)=>{const _u=typeof f==='string'?f:(f?.url||'');const _ii=_isImgUrl(_u,f);const _ip=_isPdfUrl(_u,f);const _pt=_ip?_cloudinaryPdfThumb(_u):null;
                      return<div key={fi} style={{background:'white'}}>
                        {_ii&&isUrl(_u)?<img src={_u} alt="" style={{width:'100%',height:_pmf.length>1?100:150,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                        :_ip&&_pt?<img src={_pt} alt="" style={{width:'100%',height:_pmf.length>1?100:150,objectFit:'contain',display:'block',background:'#fafafa'}} onError={e=>{e.target.style.display='none'}}/>
                        :<div style={{height:_pmf.length>1?100:150,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:24}}>📄</span></div>}
                      </div>})}
                  </div>}
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px'}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:12}}>{j.art_name}</div>
                      <div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                    </div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:j.art_status==='art_complete'?'#dcfce7':j.art_status==='waiting_approval'?'#fef3c7':'#fee2e2',color:j.art_status==='art_complete'?'#166534':j.art_status==='waiting_approval'?'#92400e':'#dc2626'}}>{artLabelsP[j.art_status]}</span>
                    <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                  </div>
                </div>})}
              </>}
              {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534'}}>
                📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
            </div>})}
        </>}

        {/* Open invoices with pay buttons */}
        {openInvs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#dc2626',marginBottom:10,marginTop:16}}>💰 Open Invoices</div>
          <div style={{border:'1px solid #fecaca',borderRadius:10,overflow:'hidden'}}>
            {openInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
              return<div key={inv.id} style={{padding:'12px 16px',borderBottom:i<openInvs.length-1?'1px solid #fef2f2':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setPortalInvView(inv)}>
                <div>
                  <div style={{fontWeight:700}}>{inv.id} <span style={{fontSize:11,color:'#64748b'}}>{inv.memo}</span></div>
                  <div style={{fontSize:11,color:age>30?'#dc2626':'#64748b'}}>{inv.date} · {age>0?age+' days ago':'Current'}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:800,fontSize:16,color:'#dc2626'}}>${bal.toLocaleString()}</span>
                  <button className="btn btn-sm" style={{background:'#22c55e',color:'white',fontSize:10}} onClick={e=>{e.stopPropagation();setPortalInvView(inv)}}>View</button>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
            <div style={{padding:'12px 16px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:800,color:'#dc2626'}}>Total Balance Due</span>
              <span style={{fontSize:20,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
            </div>
          </div>
        </>}

        {/* Completed orders — below invoices for reference */}
        {completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setSoView(so)}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span className="badge badge-green">Complete</span><span style={{color:'#94a3b8',fontSize:14}}>›</span></div></div>)}
        </>}

        {/* Approved/Converted Estimates — collapsible at bottom */}
        {(()=>{const apvEsts=custEsts.filter(e=>e.status==='approved'||e.status==='converted');
          return apvEsts.length>0&&<div style={{marginTop:12}}>
          <div style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'8px 0'}} onClick={()=>setPortalApvOpen(v=>!v)}>
            <span style={{fontSize:12,color:'#64748b',transition:'transform 0.2s',display:'inline-block',transform:portalApvOpen?'rotate(90deg)':'rotate(0deg)'}}>›</span>
            <span style={{fontSize:12,fontWeight:700,color:'#64748b'}}>Past Estimates ({apvEsts.length})</span>
          </div>
          {portalApvOpen&&<div style={{paddingTop:4}}>
            {apvEsts.map(est=>{const t=(est.items||[]).reduce((a,it)=>{const sqq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=sqq>0?sqq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const dp2=dP(d,qq,[],qq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);
              return<div key={est.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:8,background:'#f8fafc'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div><div style={{fontWeight:700,fontSize:14,color:'#374151'}}>{est.memo||est.id}</div>
                    <div style={{fontSize:11,color:'#94a3b8'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                  <div style={{textAlign:'right'}}><div style={{fontSize:16,fontWeight:700,color:'#64748b'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span className={'badge '+(est.status==='approved'?'badge-green':'badge-gray')}>{est.status}</span></div>
                </div></div>})}
          </div>}
        </div>})()}

        {/* Your rep */}
        <div style={{marginTop:20,padding:14,background:'#f8fafc',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>YOUR NSA REP</div>
          <div style={{fontSize:14,fontWeight:600}}>{rep?.name||'NSA Team'}</div>
          <div style={{fontSize:12,color:'#64748b'}}>National Sports Apparel · team@nsa-teamwear.com</div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>alert('Message to '+rep?.name+' (demo)')}>💬 Message Your Rep</button>
        </div>

        {/* Contact update — sends to rep for approval */}
        <div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:6}}>📋 Update Contact / Shipping Info</div>
          {!portalContactEdit?<>
            <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Current: {(customer.contacts||[])[0]?.name} · {(customer.contacts||[])[0]?.email}{customer.shipping_city&&' · '+customer.shipping_city+', '+customer.shipping_state}</div>
            <button className="btn btn-sm btn-secondary" onClick={()=>setPortalContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})}>✏️ Request Update</button>
          </>:<>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Name" style={{flex:1,fontSize:12}} value={portalContactEdit.name} onChange={e=>setPortalContactEdit(p=>({...p,name:e.target.value}))}/><input className="form-input" placeholder="Email" style={{flex:1,fontSize:12}} value={portalContactEdit.email} onChange={e=>setPortalContactEdit(p=>({...p,email:e.target.value}))}/></div>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Phone" style={{flex:1,fontSize:12}} value={portalContactEdit.phone} onChange={e=>setPortalContactEdit(p=>({...p,phone:e.target.value}))}/><input className="form-input" placeholder="Shipping Address" style={{flex:1,fontSize:12}} value={portalContactEdit.shipping} onChange={e=>setPortalContactEdit(p=>({...p,shipping:e.target.value}))}/></div>
              <textarea className="form-input" placeholder="Notes for your rep (optional)" rows={2} style={{fontSize:12}} value={portalContactMsg} onChange={e=>setPortalContactMsg(e.target.value)}/>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{alert('📩 Update request sent to '+rep?.name+' for approval! (demo)\n\nYour rep will review and update your info.');setPortalContactEdit(null);setPortalContactMsg('')}}>Send Request</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setPortalContactEdit(null);setPortalContactMsg('')}}>Cancel</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6}}>Changes will be reviewed by your rep before updating</div>
          </>}
        </div>
      </div>
    </div>
    {/* Stripe Payment Modal */}
    {portalShowPay&&<StripePaymentModal
      invoices={portalShowPay==='all'?openInvs:[portalShowPay]}
      customerName={customer.name}
      customerEmail={(customer.contacts||[])[0]?.email||''}
      alphaTag={customer.alpha_tag}
      onSuccess={(result)=>{setPortalPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices});setPortalShowPay(null);setPortalInvView(null);setPortalPayLoading(false)}}
      onClose={()=>{setPortalShowPay(null);setPortalPayLoading(false)}}
    />}
    </div>})()}

  </div>)}

// VENDOR DETAIL


export default CustDetail;
