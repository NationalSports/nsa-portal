/* eslint-disable */
import React, { useState, useMemo } from 'react';
import { auTierDisc, dP, calcOrderTotals } from './pricing';
import { isJobReady } from './businessLogic';
import { SZ_ORD } from './constants';

// ─── Inline Icon (same SVG paths as main app) ───
const MIcon=({name,size=20})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,menu:<><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,back:<polyline points="15 18 9 12 15 6"/>,plus:<path d="M12 5v14M5 12h14"/>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,clock:<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,scan:<><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></>,phone:<><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></>,monitor:<><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};

const safeItems=(o)=>(o?.items||[]);
const safeJobs=(o)=>(o?.jobs||[]);

// ─── STATUS BADGE STYLES ───
const statusBadge=(status)=>{
  const map={
    draft:{bg:'#f1f5f9',c:'#64748b'},pending:{bg:'#fef3c7',c:'#92400e'},sent:{bg:'#dbeafe',c:'#1e40af'},
    approved:{bg:'#dcfce7',c:'#166534'},won:{bg:'#dcfce7',c:'#166534'},lost:{bg:'#fee2e2',c:'#dc2626'},
    expired:{bg:'#f1f5f9',c:'#64748b'},new:{bg:'#dbeafe',c:'#1e40af'},in_progress:{bg:'#fef3c7',c:'#92400e'},
    production:{bg:'#e0e7ff',c:'#4338ca'},completed:{bg:'#dcfce7',c:'#166534'},shipped:{bg:'#dcfce7',c:'#166534'},
    cancelled:{bg:'#fee2e2',c:'#dc2626'},hold:{bg:'#fef3c7',c:'#92400e'},need_order:{bg:'#fef3c7',c:'#92400e'},
    paid:{bg:'#dcfce7',c:'#166534'},partial:{bg:'#fef3c7',c:'#92400e'},open:{bg:'#dbeafe',c:'#1e40af'},
    overdue:{bg:'#fee2e2',c:'#dc2626'},ready:{bg:'#dbeafe',c:'#1e40af'},staging:{bg:'#e0e7ff',c:'#4338ca'},
  };
  const s=map[status]||{bg:'#f1f5f9',c:'#64748b'};
  return{display:'inline-block',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,background:s.bg,color:s.c,textTransform:'capitalize'};
};

// ─── FORMAT HELPERS ───
const fmtDate=(d)=>{if(!d)return'—';try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'})}catch{return'—'}};
const fmtMoney=(n)=>{if(n==null)return'$0';return'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})};
const timeAgo=(d)=>{if(!d)return'';const ms=Date.now()-new Date(d).getTime();const m=ms/60000;if(m<1)return'just now';if(m<60)return Math.floor(m)+'m';if(m<1440)return Math.floor(m/60)+'h';return Math.floor(m/1440)+'d'};
const PROD_LABELS={ready:'Ready',hold:'On Hold',staging:'In Line',in_process:'In Process',completed:'Completed',shipped:'Shipped',draft:'Draft'};
const prodLabel=(j)=>PROD_LABELS[j.prod_status]||(j.prod_status||'pending').replace(/_/g,' ');

// ═══════════════════════════════════════════
// MOBILE PORTAL COMPONENT
// ═══════════════════════════════════════════
export default function MobilePortal({cu,cust,sos,ests,invs:invsPortal,histInvs=[],msgs,prod,vend,REPS,assignedTodos=[],computedTodos=[],dismissedTodos:parentDismissed,onDismissTodo,onLogout,onSwitchDesktop,onSaveEstimate,nextEstId,nf,onMsg,invPOs=[],onPullIF,onReceiveSOPO,onReceiveInvPO}){
  const[tab,setTab]=useState('home');
  const[q,setQ]=useState('');
  const[showSearch,setShowSearch]=useState(false);
  const[detail,setDetail]=useState(null);
  // Hamburger drawer
  const[drawerOpen,setDrawerOpen]=useState(false);
  // Filters & sorts (lifted to top level)
  const[ordersFilter,setOrdersFilter]=useState('active');
  const[ordersSort,setOrdersSort]=useState('newest');
  const[ordersQ,setOrdersQ]=useState('');
  const[estsFilter,setEstsFilter]=useState('pending');
  const[estsSort,setEstsSort]=useState('newest');
  const[invsFilter,setInvsFilter]=useState('open');
  const[invsSort,setInvsSort]=useState('newest');
  const[custQ,setCustQ]=useState('');
  const[moreSubPage,setMoreSubPage]=useState(null);
  const[scope,setScope]=useState('mine'); // mine | all — default reps see their own work first
  const[reportScope,setReportScope]=useState('mine'); // mine | all
  // Jobs filters
  const[jobsStatusF,setJobsStatusF]=useState('active');
  const[jobsDecoF,setJobsDecoF]=useState('all');
  const[jobsQ,setJobsQ]=useState('');
  // New estimate form
  const[newEst,setNewEst]=useState(null); // null = not creating, object = in progress
  const[newEstCustQ,setNewEstCustQ]=useState('');
  const[newEstProdQ,setNewEstProdQ]=useState('');
  const[newEstStep,setNewEstStep]=useState('customer'); // customer | details | items | sizes
  const[newEstEditItem,setNewEstEditItem]=useState(null); // index of item being edited for sizes
  // Messages filter
  const[msgFilter,setMsgFilter]=useState('for_me');
  // ─── Warehouse state ───
  const[whTab,setWhTab]=useState('if'); // if | pos
  const[whDetail,setWhDetail]=useState(null); // null | {kind:'if',soId,pickId} | {kind:'po',key}
  const[whPullQty,setWhPullQty]=useState({}); // {itemIdx:{size:qty}}
  const[whRcvQty,setWhRcvQty]=useState({}); // {lineIdx:{size:qty}}
  const[whPoFilter,setWhPoFilter]=useState('open'); // open | all
  const[whQ,setWhQ]=useState('');
  const[whSaving,setWhSaving]=useState(false);
  // Send estimate modal
  const[sendEstModal,setSendEstModal]=useState(null); // estimate object or null
  // Compose message
  const[composeMsg,setComposeMsg]=useState(null); // null | {so_id, entity_type, entity_id, replyTo}
  const[composeTxt,setComposeTxt]=useState('');
  const[composeDept,setComposeDept]=useState('all');
  const[composeMentionQ,setComposeMentionQ]=useState(null); // null or string for @mention filter

  // Derived data
  const repName=(id)=>{const r=REPS.find(x=>x.id===id);return r?r.name:'—'};
  const custObj=(id)=>cust.find(x=>x.id===id);

  // Merge portal invoices with NetSuite-imported history (customer_invoices), normalized
  // to the portal invoice shape. History is read-only; status 'void' maps to 'cancelled'
  // so it stays out of open/AR views. Paid history has no true paid_date, so we fall back
  // to the invoice date for revenue bucketing.
  const invs=useMemo(()=>{
    const norm=(histInvs||[]).filter(Boolean).map(i=>{
      const total=+i.total||0;
      const status=i.status==='void'?'cancelled':(i.status||'open');
      const date=i.invoice_date||i.date||null;
      return{id:i.id,customer_id:i.customer_id,status,total,amount_paid:status==='paid'?total:0,
        created_at:date,paid_date:status==='paid'?date:null,due_date:i.due_date||null,so_id:null,
        _hist:true,_cname:i.raw_customer_name||null};
    });
    const seen=new Set((invsPortal||[]).map(i=>i.id));
    return[...(invsPortal||[]),...norm.filter(i=>!seen.has(i.id))];
  },[invsPortal,histInvs]);

  // Rep scoping — default to the logged-in rep's own customers/work. Falls back to
  // everything when the rep has no assigned customers (e.g. admins/CSRs).
  const myCustIds=useMemo(()=>new Set((cust||[]).filter(c=>c&&c.primary_rep_id===cu.id).map(c=>c.id)),[cust,cu.id]);
  const useMine=scope==='mine'&&myCustIds.size>0;
  const inScope=(custId,createdBy)=>!useMine||myCustIds.has(custId)||createdBy===cu.id;
  // Compact Mine/All toggle for list headers
  const ScopeToggle=()=>myCustIds.size===0?null:<div style={{display:'flex',gap:4,background:'#f1f5f9',borderRadius:8,padding:2}}>
    {[['mine','Mine'],['all','All']].map(([v,l])=><button key={v} onClick={()=>setScope(v)} style={{padding:'4px 12px',borderRadius:6,border:'none',background:scope===v?'white':'transparent',color:scope===v?'#1e40af':'#64748b',fontWeight:700,fontSize:12,cursor:'pointer',boxShadow:scope===v?'0 1px 2px rgba(0,0,0,0.1)':'none'}}>{l}</button>)}
  </div>;

  // Messages computed
  const myUnreadMsgs=useMemo(()=>msgs.filter(m=>!(m.read_by||[]).includes(cu.id)&&(m.tagged_members||[]).includes(cu.id)),[msgs,cu.id]);
  const allUnreadMsgs=useMemo(()=>msgs.filter(m=>!(m.read_by||[]).includes(cu.id)),[msgs,cu.id]);
  const unreadForMeCount=myUnreadMsgs.length;
  const unreadAllCount=allUnreadMsgs.length;

  // My todos — merge assigned (manual) + computed (auto-generated from dashboard) so mobile matches desktop
  const _dismissed=parentDismissed||[];
  const dismissTodo=onDismissTodo||(()=>{});
  const myAssignedTodos=useMemo(()=>(assignedTodos||[]).filter(t=>t.status==='open'&&(t.assigned_to===cu.id||t.created_by===cu.id)).sort((a,b)=>(a.priority||9)-(b.priority||9)),[assignedTodos,cu.id]);
  const myComputedTodos=useMemo(()=>(computedTodos||[]).filter(t=>!t.isNotification&&!_dismissed.includes(t.dismissKey)).slice(0,15),[computedTodos,_dismissed]);
  const myTodos=useMemo(()=>[...myComputedTodos.map((t,i)=>({id:'computed-'+i,title:t.msg,description:t.detail,priority:t.priority,_computed:true,_action:t.action,_type:t.type,so_id:t.so?.id,_dismissKey:t.dismissKey,_date:t.date})),...myAssignedTodos].sort((a,b)=>{const da=(a._date||a.created_at)?new Date(a._date||a.created_at).getTime():0;const db=(b._date||b.created_at)?new Date(b._date||b.created_at).getTime():0;return db-da}),[myComputedTodos,myAssignedTodos]);

  // ─── SEARCH ───
  const searchResults=useMemo(()=>{
    if(!q||q.length<2)return null;
    const s=q.toLowerCase();
    return{
      customers:cust.filter(c=>(c.name+' '+(c.alpha_tag||'')+' '+(c.email||'')).toLowerCase().includes(s)).slice(0,6),
      orders:sos.filter(so=>{const cc=custObj(so.customer_id);return(so.id+' '+(so.memo||'')+' '+(cc?.name||'')+' '+(cc?.alpha_tag||'')).toLowerCase().includes(s)}).slice(0,6),
      estimates:ests.filter(e=>{const cc=custObj(e.customer_id);return(e.id+' '+(e.memo||'')+' '+(cc?.name||'')+' '+(cc?.alpha_tag||'')).toLowerCase().includes(s)}).slice(0,6),
      invoices:invs.filter(i=>(i.id+' '+(cust.find(c=>c.id===i.customer_id)?.name||'')).toLowerCase().includes(s)).slice(0,6),
    };
  },[q,cust,sos,ests,invs]);

  // ─── STATS ───
  const stats=useMemo(()=>{
    const now=new Date();const thisMonth=(d)=>{if(!d)return false;const dt=new Date(d);return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear()};
    const sScoped=sos.filter(s=>inScope(s.customer_id,s.created_by));
    const iScoped=invs.filter(i=>inScope(i.customer_id,i.created_by));
    const activeOrders=sScoped.filter(s=>!['completed','shipped','cancelled'].includes(s.status||''));
    const openInvoices=iScoped.filter(i=>i.status!=='paid'&&i.status!=='cancelled');
    // MTD sales — revenue booked this month (mirrors the desktop rep dashboard's MTD),
    // i.e. sales orders written this month rather than invoices paid this month.
    const monthRevenue=sScoped.filter(s=>(s.status||'')!=='cancelled'&&thisMonth(s.created_at)).reduce((a,s)=>{const c=custObj(s.customer_id);return a+calcOrderTotals(s,c?.tax_rate||0).rev},0);
    const urgentOrders=sScoped.filter(s=>{if(['completed','shipped','cancelled'].includes(s.status||''))return false;if(!s.expected_date)return false;const days=Math.ceil((new Date(s.expected_date)-now)/(1000*60*60*24));return days<=3&&days>=0});
    return{activeOrders:activeOrders.length,openInvoices:openInvoices.length,monthRevenue,urgentOrders:urgentOrders.length};
  },[sos,invs,scope,myCustIds]);

  // ─── SORT HELPER ───
  const sortList=(list,sortKey)=>{
    const arr=[...list];
    if(sortKey==='newest')arr.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    else if(sortKey==='oldest')arr.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
    else if(sortKey==='due_date')arr.sort((a,b)=>(a.expected_date||a.due_date||'9').localeCompare(b.expected_date||b.due_date||'9'));
    else if(sortKey==='customer')arr.sort((a,b)=>{const ca=custObj(a.customer_id);const cb=custObj(b.customer_id);return(ca?.name||'').localeCompare(cb?.name||'')});
    else if(sortKey==='amount')arr.sort((a,b)=>(b.total||0)-(a.total||0));
    return arr;
  };

  // ─── FILTERED DATA (must be above early-return gates to satisfy Rules of Hooks) ───
  const filteredOrders=useMemo(()=>{
    let list=sos.filter(s=>inScope(s.customer_id,s.created_by));
    if(ordersFilter==='active')list=list.filter(s=>!['completed','shipped','cancelled'].includes(s.status||''));
    else if(ordersFilter==='completed')list=list.filter(s=>['completed','shipped'].includes(s.status||''));
    else if(ordersFilter==='hold')list=list.filter(s=>(s.status||'')==='hold');
    if(ordersQ.length>=2){const s=ordersQ.toLowerCase();list=list.filter(so=>{const cc=custObj(so.customer_id);return(so.id+' '+(so.memo||'')+' '+(cc?.name||'')+' '+(cc?.alpha_tag||'')+' '+(so.po_number||'')).toLowerCase().includes(s)})}
    return sortList(list,ordersSort);
  },[sos,ordersFilter,ordersSort,ordersQ,scope,myCustIds]);

  const filteredCust=useMemo(()=>{
    let list=useMine?cust.filter(c=>myCustIds.has(c.id)):cust;
    if(custQ.length>=2){const s=custQ.toLowerCase();list=(useMine?cust:list).filter(c=>(c.name+' '+(c.alpha_tag||'')+' '+(c.email||'')+' '+(c.phone||'')).toLowerCase().includes(s))}
    return [...list].sort((a,b)=>a.name.localeCompare(b.name));
  },[cust,custQ,scope,myCustIds]);

  // ─── DETAIL VIEW (ORDER) ───
  const renderOrderDetail=(so)=>{
    const cc=custObj(so.customer_id);
    const items=safeItems(so);
    const jobs=safeJobs(so);
    const totalQty=items.reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((s,v)=>s+v,0),0);
    const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div className="mp-detail-id">{so.id}</div><div className="mp-detail-sub">{cc?.name||'—'}</div></div>
        <span style={statusBadge(so.status||'new')}>{so.status||'new'}</span>
      </div>
      <div className="mp-detail-body">
        <div className="mp-info-grid">
          <div className="mp-info-item"><div className="mp-info-label">Customer</div><div className="mp-info-val">{cc?.name||'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Rep</div><div className="mp-info-val">{repName(cc?.primary_rep_id||so.created_by)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Due Date</div><div className="mp-info-val" style={daysOut!=null&&daysOut<=3?{color:'#dc2626',fontWeight:700}:{}}>{fmtDate(so.expected_date)}{daysOut!=null?` (${daysOut}d)`:'  '}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Created</div><div className="mp-info-val">{fmtDate(so.created_at)}</div></div>
        </div>
        {so.memo&&<div className="mp-memo">{so.memo}</div>}
        <div style={{display:'flex',gap:8,marginTop:12,marginBottom:4}}>
          <button onClick={()=>duplicateToEstimate(so,'so')} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 12px',background:'#f1f5f9',color:'#1e293b',borderRadius:10,fontWeight:700,fontSize:13,border:'1px solid #e2e8f0',cursor:'pointer',minHeight:44}}>
            <MIcon name="file" size={16}/> Duplicate as Estimate
          </button>
        </div>
        <div className="mp-section-title">Items ({items.length}) — {totalQty} pcs</div>
        {items.map((it,idx)=>{
          const qty=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
          return<div key={idx} className="mp-item-card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{it.name||it.sku}</div>
              <div style={{fontSize:12,color:'#64748b'}}>{it.sku}{it.color?' · '+it.color:''}{it.brand?' · '+it.brand:''}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontWeight:700,fontSize:14}}>{qty} pcs</div></div>
            </div>
            <div className="mp-size-row">
              {Object.entries(it.sizes||{}).filter(([,v])=>v>0).map(([sz,v])=>
                <div key={sz} className="mp-size-chip"><span className="mp-size-label">{sz}</span><span className="mp-size-qty">{v}</span></div>
              )}
            </div>
          </div>})}
        {jobs.length>0&&<>
          <div className="mp-section-title">Jobs ({jobs.length})</div>
          {jobs.map((j,ji)=><div key={ji} className="mp-item-card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{j.id||'Job '+(ji+1)}</div>
              <div style={{fontSize:12,color:'#64748b'}}>{j.deco_type||'—'} · {j.art_name||'—'}</div></div>
              <span style={statusBadge(j.status||'pending')}>{j.status||'pending'}</span>
            </div>
          </div>)}
        </>}
        {/* Messages for this SO */}
        {(()=>{
          const soMsgs=msgs.filter(m=>m.so_id===so.id||m.entity_id===so.id).sort((a,b)=>(b.created_at||b.ts||'').localeCompare(a.created_at||a.ts||''));
          return<>
            <div className="mp-section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Messages ({soMsgs.length})</span>
              <button onClick={()=>setComposeMsg({so_id:so.id,entity_type:'so',entity_id:so.id,replyTo:null})} style={{background:'#1e40af',color:'white',border:'none',borderRadius:8,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',minHeight:32}}>
                <MIcon name="plus" size={12}/> Add
              </button>
            </div>
            {soMsgs.length===0&&<div style={{padding:12,textAlign:'center',color:'#94a3b8',fontSize:12}}>No messages yet</div>}
            {soMsgs.slice(0,5).map(m=>{
              const a=REPS.find(r=>r.id===m.author_id||r.id===m.from);
              const initials=(a?.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
              return<div key={m.id} className="mp-item-card" style={{padding:'8px 10px',cursor:'pointer'}} onClick={()=>setComposeMsg({so_id:so.id,entity_type:'so',entity_id:so.id,replyTo:null})}>
                <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#dbeafe',color:'#1e40af',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:10,flexShrink:0}}>{initials}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',gap:4,alignItems:'center',fontSize:11}}>
                      <span style={{fontWeight:700}}>{a?.name||'Unknown'}</span>
                      <span style={{color:'#94a3b8'}}>· {timeAgo(m.created_at||m.ts)}</span>
                      {m.dept&&m.dept!=='all'&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:6,background:'#f1f5f9',color:'#64748b',fontWeight:600}}>{m.dept}</span>}
                    </div>
                    <div style={{fontSize:12,color:'#475569',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(m.body||m.text||'').slice(0,80)}</div>
                  </div>
                </div>
              </div>})}
            {soMsgs.length>5&&<button onClick={()=>setComposeMsg({so_id:so.id,entity_type:'so',entity_id:so.id,replyTo:null})} style={{width:'100%',padding:8,background:'none',border:'none',color:'#2563eb',fontSize:12,fontWeight:600,cursor:'pointer'}}>View all {soMsgs.length} messages</button>}
          </>;
        })()}
      </div>
    </div>;
  };

  // ─── DETAIL VIEW (ESTIMATE) ───
  const renderEstDetail=(est)=>{
    const cc=custObj(est.customer_id);
    const items=safeItems(est);
    const totalQty=items.reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((s,v)=>s+v,0),0);
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div className="mp-detail-id">{est.id}</div><div className="mp-detail-sub">{cc?.name||'—'}</div></div>
        <span style={statusBadge(est.status||'draft')}>{est.status||'draft'}</span>
      </div>
      <div className="mp-detail-body">
        <div className="mp-info-grid">
          <div className="mp-info-item"><div className="mp-info-label">Customer</div><div className="mp-info-val">{cc?.name||'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Rep</div><div className="mp-info-val">{repName(cc?.primary_rep_id||est.created_by)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Created</div><div className="mp-info-val">{fmtDate(est.created_at)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Total</div><div className="mp-info-val">{fmtMoney(est.total)}</div></div>
        </div>
        {est.memo&&<div className="mp-memo">{est.memo}</div>}
        {/* Send Estimate button */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          <button onClick={()=>setSendEstModal(est)} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'12px 16px',background:'#1e40af',color:'white',borderRadius:10,fontWeight:700,fontSize:14,border:'none',cursor:'pointer',minHeight:44}}>
            <MIcon name="mail" size={16}/> Send Estimate
          </button>
          <button onClick={()=>duplicateToEstimate(est,'estimate')} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'12px 16px',background:'#f1f5f9',color:'#1e293b',borderRadius:10,fontWeight:700,fontSize:14,border:'1px solid #e2e8f0',cursor:'pointer',minHeight:44}}>
            <MIcon name="file" size={16}/> Duplicate
          </button>
        </div>
        <div className="mp-section-title">Items ({items.length}) — {totalQty} pcs</div>
        {items.map((it,idx)=>{
          const qty=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
          return<div key={idx} className="mp-item-card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{it.name||it.sku}</div>
              <div style={{fontSize:12,color:'#64748b'}}>{it.sku}{it.color?' · '+it.color:''}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontWeight:700}}>{qty} pcs</div>
              {it.unit_price>0&&<div style={{fontSize:12,color:'#64748b'}}>{fmtMoney(it.unit_price)} ea</div>}</div>
            </div>
          </div>})}
      </div>
    </div>;
  };

  // ─── DETAIL VIEW (CUSTOMER) ───
  const renderCustDetail=(cc)=>{
    const custSOs=sos.filter(s=>s.customer_id===cc.id).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const custEsts=ests.filter(e=>e.customer_id===cc.id).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const custInvs=invs.filter(i=>i.customer_id===cc.id).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div className="mp-detail-id">{cc.name}</div>{cc.alpha_tag&&<div className="mp-detail-sub">{cc.alpha_tag}</div>}</div>
      </div>
      <div className="mp-detail-body">
        <div className="mp-info-grid">
          <div className="mp-info-item"><div className="mp-info-label">Rep</div><div className="mp-info-val">{repName(cc.primary_rep_id)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Phone</div><div className="mp-info-val">{cc.phone?<a href={'tel:'+cc.phone} style={{color:'#1e40af',textDecoration:'none',fontWeight:700}}>{cc.phone}</a>:'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Email</div><div className="mp-info-val" style={{fontSize:12,wordBreak:'break-all'}}>{cc.email||'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Orders</div><div className="mp-info-val">{custSOs.length}</div></div>
        </div>
        {/* Action buttons */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12,marginBottom:12}}>
          {(()=>{const acct=(cc.contacts||[]).find(c=>c.role==='Billing')||(cc.contacts||[])[0];const email=acct?.email||cc.email;
            return email?<a href={'mailto:'+email+'?subject=Account Statement — '+encodeURIComponent(cc.name)+'&body='+encodeURIComponent('Hi '+(acct?.name||'')+',\n\nPlease find your current account statement with all open invoices and aging details.\n\nPlease let us know if you have any questions.\n\nThank you,\nNSA Team')} style={{flex:1,minWidth:120,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 12px',background:'#1e40af',color:'white',borderRadius:10,fontWeight:700,fontSize:13,textDecoration:'none',border:'none',cursor:'pointer'}}><MIcon name="mail" size={16}/> Email Statement</a>:null})()}
          {cc.alpha_tag&&<button onClick={()=>window.open(window.location.origin+'/?portal='+cc.alpha_tag,'_blank')} style={{flex:1,minWidth:120,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 12px',background:'#7c3aed',color:'white',borderRadius:10,fontWeight:700,fontSize:13,border:'none',cursor:'pointer'}}><MIcon name="monitor" size={16}/> Coaches Portal</button>}
          {cc.phone&&<a href={'tel:'+cc.phone} style={{flex:1,minWidth:120,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 12px',background:'#16a34a',color:'white',borderRadius:10,fontWeight:700,fontSize:13,textDecoration:'none',border:'none',cursor:'pointer'}}><MIcon name="phone" size={16}/> Call</a>}
        </div>
        {cc.notes&&<div className="mp-memo">{typeof cc.notes==='string'?cc.notes:JSON.stringify(cc.notes)}</div>}
        {(()=>{const lib=custArtLib(cc.id);if(!lib.length)return null;
          return<>
            <div className="mp-section-title">Decorations ({lib.length})</div>
            {lib.map((a,i)=><div key={a.id+'_'+i} className="mp-list-card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
                <div style={{fontSize:11,color:'#64748b',textTransform:'capitalize'}}>{(a.deco_type||'').replace('_',' ')||'—'}{a.ink_colors?' · '+a.ink_colors.split('\n').filter(l=>l.trim()).length+' colors':''}</div>
              </div>
              <span style={{fontSize:10,color:'#94a3b8',flexShrink:0,marginLeft:8}}>{a._src}</span>
            </div>)}
          </>;
        })()}
        {custSOs.length>0&&<>
          <div className="mp-section-title">Recent Orders</div>
          {custSOs.slice(0,5).map(so=><div key={so.id} className="mp-list-card" onClick={()=>setDetail({type:'order',data:so})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontWeight:700,color:'#1e40af'}}>{so.id}</div><div style={{fontSize:12,color:'#64748b'}}>{so.memo||'—'}</div></div>
              <div style={{textAlign:'right'}}><span style={statusBadge(so.status||'new')}>{so.status||'new'}</span>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>{fmtDate(so.created_at)}</div></div>
            </div>
          </div>)}
        </>}
        {custEsts.length>0&&<>
          <div className="mp-section-title">Recent Estimates</div>
          {custEsts.slice(0,3).map(e=><div key={e.id} className="mp-list-card" onClick={()=>setDetail({type:'estimate',data:e})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontWeight:700,color:'#1e40af'}}>{e.id}</div></div>
              <span style={statusBadge(e.status||'draft')}>{e.status||'draft'}</span>
            </div>
          </div>)}
        </>}
        {custInvs.length>0&&<>
          <div className="mp-section-title">Recent Invoices</div>
          {custInvs.slice(0,3).map(i=><div key={i.id} className="mp-list-card" onClick={()=>setDetail({type:'invoice',data:i})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontWeight:700,color:'#1e40af'}}>{i.id}</div><div style={{fontSize:12,color:'#64748b'}}>{fmtMoney(i.total)}</div></div>
              <span style={statusBadge(i.status||'open')}>{i.status||'open'}</span>
            </div>
          </div>)}
        </>}
      </div>
    </div>;
  };

  // ─── DETAIL VIEW (INVOICE) ───
  const renderInvDetail=(inv)=>{
    const cc=custObj(inv.customer_id);
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div className="mp-detail-id">{inv.id}</div><div className="mp-detail-sub">{cc?.name||'—'}</div></div>
        <span style={statusBadge(inv.status||'open')}>{inv.status||'open'}</span>
      </div>
      <div className="mp-detail-body">
        <div className="mp-info-grid">
          <div className="mp-info-item"><div className="mp-info-label">Total</div><div className="mp-info-val" style={{fontSize:18,fontWeight:800}}>{fmtMoney(inv.total)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Paid</div><div className="mp-info-val" style={{fontSize:18,fontWeight:800,color:'#16a34a'}}>{fmtMoney(inv.amount_paid||0)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Due Date</div><div className="mp-info-val">{fmtDate(inv.due_date)}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Created</div><div className="mp-info-val">{fmtDate(inv.created_at)}</div></div>
        </div>
        {inv.so_id&&<div className="mp-list-card" onClick={()=>{const so=sos.find(s=>s.id===inv.so_id);if(so)setDetail({type:'order',data:so})}}>
          <div style={{fontSize:12,color:'#64748b'}}>Linked Order</div>
          <div style={{fontWeight:700,color:'#1e40af'}}>{inv.so_id}</div>
        </div>}
      </div>
    </div>;
  };

  // ─── DETAIL VIEW (MESSAGE) — full-screen thread ───
  const renderMsgDetail=(msg)=>{
    // Find thread messages (same so_id or thread_id) — inline, no hooks in render functions
    let thread=[];
    if(msg.thread_id)thread=msgs.filter(m=>m.thread_id===msg.thread_id||m.id===msg.thread_id);
    else if(msg.so_id)thread=msgs.filter(m=>m.so_id===msg.so_id);
    if(!thread.find(m=>m.id===msg.id))thread=[msg];
    const threadMsgs=thread.sort((a,b)=>(a.created_at||a.ts||'').localeCompare(b.created_at||b.ts||''));
    const author=REPS.find(r=>r.id===msg.author_id||r.id===msg.from);
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}>
          <div className="mp-detail-id">{msg.so_id||'Message'}</div>
          <div className="mp-detail-sub">{threadMsgs.length} message{threadMsgs.length!==1?'s':''}</div>
        </div>
      </div>
      <div className="mp-detail-body" style={{padding:'8px 12px'}}>
        {/* Thread / conversation bubbles */}
        {threadMsgs.map(m=>{
          const isMe=m.author_id===cu.id||m.from===cu.id;
          const a=REPS.find(r=>r.id===m.author_id||r.id===m.from);
          return<div key={m.id} style={{display:'flex',flexDirection:'column',alignItems:isMe?'flex-end':'flex-start',marginBottom:12}}>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:2}}>{a?.name||'Unknown'} · {timeAgo(m.created_at)}</div>
            <div style={{maxWidth:'85%',padding:'10px 14px',borderRadius:isMe?'14px 14px 4px 14px':'14px 14px 14px 4px',background:isMe?'#1e40af':'white',color:isMe?'white':'#1e293b',fontSize:14,lineHeight:1.5,border:isMe?'none':'1px solid #e2e8f0',whiteSpace:'pre-wrap'}}>
              {m.body||m.text||'(no content)'}
            </div>
          </div>})}
        {msg.so_id&&<div className="mp-list-card" style={{marginTop:8}} onClick={()=>{const so=sos.find(s=>s.id===msg.so_id);if(so)setDetail({type:'order',data:so})}}>
          <div style={{fontSize:12,color:'#64748b'}}>Related Order</div>
          <div style={{fontWeight:700,color:'#1e40af'}}>{msg.so_id}</div>
        </div>}
      </div>
    </div>;
  };

  // ─── HELPER: round to quarter ───
  const rQ=v=>Math.round(v*4)/4;

  // ─── DECORATION CONSTANTS ───
  const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];
  const DECO_KINDS=[{k:'art',label:'Art / Print',color:'#3b82f6'},{k:'numbers',label:'Numbers',color:'#22c55e'},{k:'names',label:'Names',color:'#f59e0b'},{k:'outside_deco',label:'Outside Deco',color:'#7c3aed'}];
  const NUM_METHODS=[{k:'heat_transfer',l:'Heat Transfer'},{k:'embroidery',l:'Embroidery'},{k:'screen_print',l:'Screen Print'}];
  const OUTSIDE_TYPES=[{k:'embroidery',l:'Embroidery'},{k:'screen_print',l:'Screen Print'},{k:'dtf',l:'DTF'},{k:'heat_transfer',l:'Heat Transfer'},{k:'sublimation',l:'Sublimation'},{k:'vinyl',l:'Vinyl'}];

  // ─── DECORATION HELPERS ───
  const newDeco=(kind)=>{
    if(kind==='art')return{kind:'art',position:'Front Center',art_file_id:'__tbd',art_tbd_type:'screen_print',tbd_colors:1,sell_override:null};
    if(kind==='numbers')return{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,front_and_back:false,sell_override:null,roster:{}};
    if(kind==='names')return{kind:'names',position:'Back Center',sell_each:6,cost_each:3,sell_override:null,names:{}};
    return{kind:'outside_deco',position:'Front Center',vendor:'',deco_type:'embroidery',cost_each:0,sell_each:0,notes:'',sell_override:null};
  };
  const addDecoToItem=(idx,kind)=>{
    setNewEst(e=>{const items=[...e.items];const it={...items[idx],decorations:[...(items[idx].decorations||[]),newDeco(kind)]};items[idx]=it;return{...e,items}});
  };
  const updateDeco=(itemIdx,decoIdx,key,val)=>{
    setNewEst(e=>{const items=[...e.items];const decos=[...(items[itemIdx].decorations||[])];decos[decoIdx]={...decos[decoIdx],[key]:val};items[itemIdx]={...items[itemIdx],decorations:decos};return{...e,items}});
  };
  const removeDeco=(itemIdx,decoIdx)=>{
    setNewEst(e=>{const items=[...e.items];items[itemIdx]={...items[itemIdx],decorations:(items[itemIdx].decorations||[]).filter((_,i)=>i!==decoIdx)};return{...e,items}});
  };

  // ─── EXISTING CUSTOMER DECORATIONS ───
  // Aggregate the customer's saved logos plus art used on their prior orders/estimates
  // (and the parent account), de-duplicated by name+deco_type. Mirrors the desktop library.
  const custArtLib=(custId)=>{
    if(!custId)return[];
    const c=custObj(custId);if(!c)return[];
    const out=[];const seen=new Set();
    const add=(a,src)=>{if(!a||!a.name)return;const key=(a.name||'').toLowerCase()+'||'+(a.deco_type||'');if(seen.has(key)||a.archived)return;seen.add(key);out.push({...a,_src:src})};
    (c.art_files||[]).forEach(a=>add(a,'Library'));
    if(c.parent_id){const p=custObj(c.parent_id);(p?.art_files||[]).forEach(a=>add(a,p?.alpha_tag||p?.name||'Parent'))}
    sos.filter(s=>s.customer_id===custId).forEach(so=>(so.art_files||[]).forEach(a=>add(a,so.id)));
    ests.filter(e=>e.customer_id===custId).forEach(e=>(e.art_files||[]).forEach(a=>add(a,e.id)));
    return out;
  };
  // Attach an existing customer logo to an item: clone the art file into the estimate's
  // art_files (so pricing/render resolve it) and add an art decoration referencing it.
  const addExistingDeco=(itemIdx,art)=>{
    setNewEst(e=>{
      const af=[...(e.art_files||[])];
      if(!af.some(a=>a.id===art.id)){const clone=JSON.parse(JSON.stringify(art));delete clone._src;af.push(clone)}
      const items=[...e.items];
      const deco={kind:'art',position:'Front Center',art_file_id:art.id,_cust_art_id:art.id,art_group:art.name,sell_override:null};
      items[itemIdx]={...items[itemIdx],decorations:[...(items[itemIdx].decorations||[]),deco]};
      return{...e,items,art_files:af};
    });
  };

  // ─── LIVE ESTIMATE MATH (revenue / cost / margin) ───
  // Mirrors calcOrderTotals so the builder summary agrees with the saved estimate.
  const estMath=(est)=>{
    if(!est)return{rev:0,cost:0,qty:0,margin:0};
    const items=est.items||[];const af=est.art_files||[];
    const artQty={};
    items.forEach(it=>{const q=Object.values(it.sizes||{}).reduce((a,v)=>a+(+v||0),0);if(!q)return;(it.decorations||[]).forEach(d=>{if(d.kind==='art'&&d.art_file_id){artQty[d.art_file_id]=(artQty[d.art_file_id]||0)+q*(d.reversible?2:1)}})});
    let rev=0,cost=0,qty=0;
    items.forEach(it=>{
      const q=Object.values(it.sizes||{}).reduce((a,v)=>a+(+v||0),0);qty+=q;if(!q)return;
      rev+=q*(+it.unit_sell||0);cost+=q*(+it.nsa_cost||0);
      (it.decorations||[]).forEach(d=>{
        const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;
        const dp=dP(d,q,af,cq);
        const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);
        rev+=eq*(+dp.sell||0);cost+=eq*(+dp.cost||0);
      });
    });
    return{rev,cost,qty,margin:rev>0?(rev-cost)/rev:0};
  };

  // ─── DUPLICATE AN ORDER / ESTIMATE INTO A NEW ESTIMATE ───
  const duplicateToEstimate=(src,kind)=>{
    if(!onSaveEstimate)return;
    const clonedItems=(src.items||[]).map(it=>{const c=JSON.parse(JSON.stringify(it));delete c.pick_lines;delete c.po_lines;return c});
    const cc=src.customer_id?custObj(src.customer_id):null;
    const est={id:nextEstId(),customer_id:src.customer_id,memo:(src.memo||'')+' (copy)',status:'draft',created_by:cu.id,
      created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:src.default_markup||cc?.catalog_markup||1.65,
      shipping_type:src.shipping_type||'pct',shipping_value:src.shipping_value??5,ship_to_id:src.ship_to_id||'default',
      email_status:null,art_files:JSON.parse(JSON.stringify(src.art_files||[])),items:clonedItems};
    est.total=calcOrderTotals(est,cc?.tax_rate||0).grand;
    const saved=onSaveEstimate(est);
    if(nf)nf(saved.id+' created from '+src.id);
    setDetail({type:'estimate',data:saved});
  };

  // ─── NEW ESTIMATE FORM ───
  const startNewEstimate=()=>{
    setNewEst({customer_id:null,memo:'',items:[],art_files:[]});
    setNewEstStep('customer');setNewEstCustQ('');setNewEstProdQ('');setNewEstEditItem(null);
  };
  const addItemToEst=(p)=>{
    const cc=newEst.customer_id?custObj(newEst.customer_id):null;
    const mk=cc?.catalog_markup||1.65;
    const au=p.brand==='Adidas'||p.brand==='Under Armour'||p.brand==='New Balance';
    const repCost=p.is_clearance&&p.clearance_cost!=null?p.clearance_cost:p.nsa_cost;
    const sell=au?rQ(p.retail_price*(1-auTierDisc(cc?.adidas_ua_tier||'B',p.pricing_group))):rQ(repCost*mk);
    const item={product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,vendor_id:p.vendor_id||null,pricing_group:p.pricing_group||null,color:p.color,nsa_cost:repCost,retail_price:p.retail_price,unit_sell:sell,available_sizes:[...(p.available_sizes||['S','M','L','XL','2XL'])],sizes:{},decorations:[]};
    setNewEst(e=>({...e,items:[...e.items,item]}));
    setNewEstProdQ('');
    setNewEstEditItem(newEst.items.length); // open size editor for new item
    setNewEstStep('sizes');
  };
  const saveNewEstimate=()=>{
    if(!newEst||!onSaveEstimate)return;
    const cc=newEst.customer_id?custObj(newEst.customer_id):null;
    const mk=cc?.catalog_markup||1.65;
    const est={id:nextEstId(),customer_id:newEst.customer_id,memo:newEst.memo,status:'draft',created_by:cu.id,
      created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:mk,
      shipping_type:'pct',shipping_value:5,ship_to_id:'default',email_status:null,art_files:newEst.art_files||[],items:newEst.items};
    est.total=calcOrderTotals(est,cc?.tax_rate||0).grand;
    const saved=onSaveEstimate(est);
    setNewEst(null);
    if(nf)nf(saved.id+' created');
    setDetail({type:'estimate',data:saved});
  };

  const renderNewEstimate=()=>{
    // Step 1: Pick customer
    if(newEstStep==='customer'){
      const s=newEstCustQ.toLowerCase();
      const matches=s.length>=2?cust.filter(c=>(c.name+' '+(c.alpha_tag||'')).toLowerCase().includes(s)).slice(0,20):cust.slice(0,20);
      return<div className="mp-detail">
        <div className="mp-detail-header">
          <button className="mp-back-btn" onClick={()=>setNewEst(null)}><MIcon name="x" size={22}/></button>
          <div style={{flex:1}}><div className="mp-detail-id">New Estimate</div><div className="mp-detail-sub">Step 1: Select Customer</div></div>
        </div>
        <div className="mp-detail-body">
          <div className="mp-search-inline">
            <MIcon name="search" size={16}/>
            <input autoFocus placeholder="Search customers..." value={newEstCustQ} onChange={e=>setNewEstCustQ(e.target.value)} className="mp-search-input"/>
            {newEstCustQ&&<button onClick={()=>setNewEstCustQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
          </div>
          <button className="mp-list-card" style={{textAlign:'center',color:'#64748b',fontWeight:600,fontSize:13,border:'1px dashed #cbd5e1'}} onClick={()=>{setNewEst(e=>({...e,customer_id:null}));setNewEstStep('details')}}>
            Skip — No Customer
          </button>
          {matches.map(cc=><div key={cc.id} className="mp-list-card" onClick={()=>{setNewEst(e=>({...e,customer_id:cc.id}));setNewEstStep('details')}}>
            <div style={{fontWeight:700,fontSize:14}}>{cc.name}</div>
            {cc.alpha_tag&&<div style={{fontSize:12,color:'#64748b'}}>{cc.alpha_tag}</div>}
          </div>)}
        </div>
      </div>;
    }
    // Step 2: Memo + items list
    if(newEstStep==='details'||newEstStep==='items'){
      const cc=newEst.customer_id?custObj(newEst.customer_id):null;
      const s=newEstProdQ.toLowerCase();
      const prodMatches=s.length>=2?prod.filter(p=>(p.sku+' '+p.name+' '+(p.brand||'')+' '+(p.color||'')).toLowerCase().includes(s)).slice(0,15):[];
      return<div className="mp-detail">
        <div className="mp-detail-header">
          <button className="mp-back-btn" onClick={()=>{if(newEst.items.length===0)setNewEstStep('customer');else if(!window.confirm('Discard this estimate?'))return;else setNewEst(null)}}><MIcon name="back" size={22}/></button>
          <div style={{flex:1}}><div className="mp-detail-id">New Estimate</div><div className="mp-detail-sub">{cc?.name||'No Customer'}</div></div>
          {newEst.items.length>0&&<button style={{background:'#16a34a',color:'white',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:700,fontSize:13,cursor:'pointer'}} onClick={saveNewEstimate}>Save</button>}
        </div>
        <div className="mp-detail-body">
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:4}}>Memo / Description</div>
            <input value={newEst.memo} onChange={e=>setNewEst(x=>({...x,memo:e.target.value}))} placeholder="e.g. Fall season jerseys" className="mp-search-input" style={{background:'white',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px',width:'100%',boxSizing:'border-box',fontSize:16}}/>
          </div>
          {/* Live total & margin */}
          {newEst.items.length>0&&(()=>{const m=estMath(newEst);const marginColor=m.margin>=0.45?'#16a34a':m.margin>=0.3?'#d97706':'#dc2626';
            return<div style={{background:'#0f172a',borderRadius:12,padding:'12px 14px',marginBottom:12,color:'white'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>EST. REVENUE</div><div style={{fontSize:22,fontWeight:800}}>{fmtMoney(m.rev)}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>MARGIN</div><div style={{fontSize:22,fontWeight:800,color:marginColor}}>{Math.round(m.margin*100)}%</div></div>
              </div>
              <div style={{display:'flex',gap:16,marginTop:8,fontSize:12,color:'#cbd5e1'}}>
                <span>{m.qty} pcs</span><span>Cost {fmtMoney(m.cost)}</span><span>Profit {fmtMoney(m.rev-m.cost)}</span>
              </div>
            </div>;
          })()}
          {/* Existing items */}
          {newEst.items.length>0&&<>
            <div className="mp-section-title">Items ({newEst.items.length})</div>
            {newEst.items.map((it,idx)=>{
              const qty=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
              return<div key={idx} className="mp-item-card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div style={{flex:1,minWidth:0}} onClick={()=>{setNewEstEditItem(idx);setNewEstStep('sizes')}}>
                    <div style={{fontWeight:700,fontSize:14}}>{it.name||it.sku}</div>
                    <div style={{fontSize:12,color:'#64748b'}}>{it.sku}{it.color?' · '+it.color:''}</div>
                    {qty>0&&<div className="mp-size-row" style={{marginTop:4}}>
                      {Object.entries(it.sizes||{}).filter(([,v])=>v>0).map(([sz,v])=>
                        <div key={sz} className="mp-size-chip"><span className="mp-size-label">{sz}</span><span className="mp-size-qty">{v}</span></div>)}
                    </div>}
                    {qty===0&&<div style={{fontSize:12,color:'#d97706',marginTop:4}}>Tap to set sizes</div>}
                    {(it.decorations||[]).length>0&&<div style={{display:'flex',gap:4,marginTop:4,flexWrap:'wrap'}}>
                      {(it.decorations||[]).map((d,di)=>{const dk=DECO_KINDS.find(x=>x.k===d.kind);return<span key={di} style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:6,background:dk?.color+'20',color:dk?.color}}>{d.position} · {dk?.label}</span>})}
                    </div>}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                    <div style={{fontWeight:700}}>{qty} pcs</div>
                    <button onClick={()=>setNewEst(e=>({...e,items:e.items.filter((_,i)=>i!==idx)}))} style={{background:'none',border:'none',color:'#dc2626',fontSize:11,cursor:'pointer',padding:0}}>Remove</button>
                  </div>
                </div>
              </div>})}
          </>}
          {/* Add product search */}
          <div className="mp-section-title" style={{marginTop:16}}>Add Product</div>
          <div className="mp-search-inline">
            <MIcon name="search" size={16}/>
            <input placeholder="Search products by name, SKU..." value={newEstProdQ} onChange={e=>{setNewEstProdQ(e.target.value);setNewEstStep('items')}} className="mp-search-input"/>
            {newEstProdQ&&<button onClick={()=>setNewEstProdQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
          </div>
          {prodMatches.map(p=><div key={p.id} className="mp-list-card" onClick={()=>addItemToEst(p)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{p.sku}{p.color?' · '+p.color:''}{p.brand?' · '+p.brand:''}</div>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:'#16a34a',flexShrink:0}}>{fmtMoney(p.retail_price)}</div>
            </div>
          </div>)}
          {newEstProdQ.length>=2&&prodMatches.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:16,fontSize:13}}>No products found</div>}
        </div>
      </div>;
    }
    // Step 3: Size editor for a specific item
    if(newEstStep==='sizes'&&newEstEditItem!=null){
      const item=newEst.items[newEstEditItem];
      if(!item){setNewEstStep('details');return null}
      const sizes=item.available_sizes||['S','M','L','XL','2XL'];
      const updateSize=(sz,val)=>{
        const v=Math.max(0,parseInt(val)||0);
        setNewEst(e=>{const items=[...e.items];const it={...items[newEstEditItem],sizes:{...items[newEstEditItem].sizes,[sz]:v}};items[newEstEditItem]=it;return{...e,items}});
      };
      const totalQty=Object.values(item.sizes||{}).reduce((a,v)=>a+v,0);
      return<div className="mp-detail">
        <div className="mp-detail-header">
          <button className="mp-back-btn" onClick={()=>{setNewEstStep('details');setNewEstEditItem(null)}}><MIcon name="back" size={22}/></button>
          <div style={{flex:1}}><div className="mp-detail-id">{item.name||item.sku}</div><div className="mp-detail-sub">{item.sku}{item.color?' · '+item.color:''} — {totalQty} pcs</div></div>
          <button style={{background:'#1e40af',color:'white',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:700,fontSize:13,cursor:'pointer'}} onClick={()=>{setNewEstStep('details');setNewEstEditItem(null)}}>Done</button>
        </div>
        <div className="mp-detail-body">
          <div style={{fontSize:13,fontWeight:600,color:'#334155',marginBottom:12}}>Enter quantity per size:</div>
          <div style={{display:'flex',gap:8,overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:4}}>
            {sizes.map(sz=><div key={sz} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:10,padding:'8px 10px',textAlign:'center',minWidth:80,flexShrink:0}}>
              <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:4}}>{sz}</div>
              <input type="number" inputMode="numeric" min="0" value={item.sizes?.[sz]||''} onChange={e=>updateSize(sz,e.target.value)} placeholder="0"
                style={{width:'100%',textAlign:'center',border:'1px solid #e2e8f0',borderRadius:6,padding:'10px 4px',fontSize:18,fontWeight:700,boxSizing:'border-box',minHeight:44}}/>
            </div>)}
          </div>
          <div style={{marginTop:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:14,fontWeight:700}}>Total: {totalQty} pcs</div>
            {item.unit_sell>0&&<div style={{fontSize:13,color:'#64748b'}}>{fmtMoney(item.unit_sell)} ea · {fmtMoney(totalQty*item.unit_sell)} total</div>}
          </div>
          {/* ─── DECORATIONS ─── */}
          <div style={{marginTop:20,borderTop:'1px solid #e2e8f0',paddingTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontSize:14,fontWeight:700}}>Decorations ({(item.decorations||[]).length})</div>
            </div>
            {/* Existing decorations */}
            {(item.decorations||[]).map((d,di)=>{
              const dk=DECO_KINDS.find(x=>x.k===d.kind)||DECO_KINDS[0];
              return<div key={di} style={{background:'white',border:'2px solid '+dk.color,borderRadius:12,padding:12,marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:800,color:dk.color}}>{dk.label}</div>
                  <button onClick={()=>removeDeco(newEstEditItem,di)} style={{background:'none',border:'none',color:'#dc2626',fontSize:11,fontWeight:700,cursor:'pointer',padding:0}}>Remove</button>
                </div>
                {/* Position selector */}
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Position</div>
                  <select value={d.position||''} onChange={e=>updateDeco(newEstEditItem,di,'position',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white'}}>
                    {POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                {/* ART — existing customer logo */}
                {d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'&&(()=>{
                  const art=(newEst.art_files||[]).find(a=>a.id===d.art_file_id);
                  return<div style={{marginBottom:8,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:'#1e40af',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.art_group||art?.name||'Existing Logo'}</div>
                        <div style={{fontSize:11,color:'#64748b',textTransform:'capitalize'}}>{(art?.deco_type||'').replace('_',' ')||'On customer'}{art?.ink_colors?' · '+art.ink_colors.split('\n').filter(l=>l.trim()).length+' colors':''}</div>
                      </div>
                      <button onClick={()=>{updateDeco(newEstEditItem,di,'art_file_id','__tbd');updateDeco(newEstEditItem,di,'art_tbd_type','screen_print')}} style={{background:'none',border:'1px solid #cbd5e1',borderRadius:6,padding:'4px 8px',fontSize:11,fontWeight:600,color:'#64748b',cursor:'pointer',flexShrink:0}}>Switch to TBD</button>
                    </div>
                  </div>;
                })()}
                {/* ART decoration fields (TBD) */}
                {d.kind==='art'&&(!d.art_file_id||d.art_file_id==='__tbd')&&<>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Type (Art TBD)</div>
                    <select value={d.art_tbd_type||'screen_print'} onChange={e=>updateDeco(newEstEditItem,di,'art_tbd_type',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white'}}>
                      <option value="screen_print">Screen Print</option><option value="embroidery">Embroidery</option><option value="dtf">DTF</option><option value="heat_transfer">Heat Transfer</option>
                    </select>
                  </div>
                  {(d.art_tbd_type==='screen_print'||!d.art_tbd_type)&&<>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Colors</div>
                    <div style={{display:'flex',gap:6}}>{[1,2,3,4,5].map(n=><button key={n} onClick={()=>updateDeco(newEstEditItem,di,'tbd_colors',n)} style={{flex:1,padding:'8px 0',border:'1px solid '+(d.tbd_colors===n?'#3b82f6':'#e2e8f0'),borderRadius:8,background:d.tbd_colors===n?'#dbeafe':'white',fontWeight:700,fontSize:14,cursor:'pointer',color:d.tbd_colors===n?'#1e40af':'#334155',minHeight:44}}>{n}</button>)}</div>
                  </div>
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,marginBottom:8,minHeight:44}}><input type="checkbox" checked={!!d.underbase} onChange={e=>updateDeco(newEstEditItem,di,'underbase',e.target.checked)} style={{width:20,height:20}}/> Underbase</label>
                </>}
                {d.art_tbd_type==='embroidery'&&<div style={{marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Stitch Count</div>
                  <select value={d.tbd_stitches||8000} onChange={e=>updateDeco(newEstEditItem,di,'tbd_stitches',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white',minHeight:44}}>
                    {[5000,8000,10000,12000,15000,20000].map(s=><option key={s} value={s}>{(s/1000)+'k stitches'}</option>)}
                  </select>
                </div>}
                {(d.art_tbd_type==='dtf'||d.art_tbd_type==='heat_transfer')&&<div style={{marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Size</div>
                  <select value={d.tbd_dtf_size||0} onChange={e=>updateDeco(newEstEditItem,di,'tbd_dtf_size',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white',minHeight:44}}>
                    <option value={0}>Small (up to 5")</option><option value={1}>Medium (5-9")</option><option value={2}>Large (9-12")</option><option value={3}>Oversized (12"+)</option>
                  </select>
                </div>}
                </>}
                {/* NUMBERS decoration fields */}
                {d.kind==='numbers'&&<>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Method</div>
                    <select value={d.num_method||'heat_transfer'} onChange={e=>updateDeco(newEstEditItem,di,'num_method',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white'}}>
                      {NUM_METHODS.map(m=><option key={m.k} value={m.k}>{m.l}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Size</div>
                    <input value={d.num_size||''} onChange={e=>updateDeco(newEstEditItem,di,'num_size',e.target.value)} placeholder='e.g. 4"' style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                  </div>
                  <div style={{display:'flex',gap:12}}>
                    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><input type="checkbox" checked={!!d.two_color} onChange={e=>updateDeco(newEstEditItem,di,'two_color',e.target.checked)}/> 2-Color</label>
                    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><input type="checkbox" checked={!!d.front_and_back} onChange={e=>updateDeco(newEstEditItem,di,'front_and_back',e.target.checked)}/> Front + Back</label>
                  </div>
                </>}
                {/* NAMES decoration fields */}
                {d.kind==='names'&&<>
                  <div style={{display:'flex',gap:8,marginBottom:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Sell /ea</div>
                      <input type="number" inputMode="decimal" value={d.sell_each||''} onChange={e=>updateDeco(newEstEditItem,di,'sell_each',parseFloat(e.target.value)||0)} placeholder="6" style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Cost /ea</div>
                      <input type="number" inputMode="decimal" value={d.cost_each||''} onChange={e=>updateDeco(newEstEditItem,di,'cost_each',parseFloat(e.target.value)||0)} placeholder="3" style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                    </div>
                  </div>
                </>}
                {/* OUTSIDE DECO decoration fields */}
                {d.kind==='outside_deco'&&<>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Deco Type</div>
                    <select value={d.deco_type||'embroidery'} onChange={e=>updateDeco(newEstEditItem,di,'deco_type',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,background:'white'}}>
                      {OUTSIDE_TYPES.map(t=><option key={t.k} value={t.k}>{t.l}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Vendor</div>
                    <input value={d.vendor||''} onChange={e=>updateDeco(newEstEditItem,di,'vendor',e.target.value)} placeholder="e.g. Silver Screen" style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                  </div>
                  <div style={{display:'flex',gap:8,marginBottom:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Cost /ea</div>
                      <input type="number" inputMode="decimal" value={d.cost_each||''} onChange={e=>updateDeco(newEstEditItem,di,'cost_each',parseFloat(e.target.value)||0)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Sell /ea</div>
                      <input type="number" inputMode="decimal" value={d.sell_each||''} onChange={e=>updateDeco(newEstEditItem,di,'sell_each',parseFloat(e.target.value)||0)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:3}}>Notes</div>
                    <input value={d.notes||''} onChange={e=>updateDeco(newEstEditItem,di,'notes',e.target.value)} placeholder="Optional notes..." style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box'}}/>
                  </div>
                </>}
              </div>})}
            {/* Existing customer logos */}
            {(()=>{const lib=custArtLib(newEst.customer_id);if(!lib.length)return null;
              return<div style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:4}}>Add a logo already on this customer</div>
                <select value="" onChange={e=>{const a=lib.find(x=>x.id===e.target.value);if(a)addExistingDeco(newEstEditItem,a);e.target.value=''}} style={{width:'100%',padding:'10px 12px',border:'1px solid #3b82f6',borderRadius:8,fontSize:14,background:'white',color:'#1e40af',fontWeight:600,minHeight:44}}>
                  <option value="">＋ Use existing logo…</option>
                  {lib.map(a=><option key={a.id} value={a.id}>{a.name}{a.deco_type?' ('+a.deco_type.replace('_',' ')+')':''} · {a._src}</option>)}
                </select>
              </div>;
            })()}
            {/* Add decoration buttons */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {DECO_KINDS.map(dk=><button key={dk.k} onClick={()=>addDecoToItem(newEstEditItem,dk.k)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 8px',border:'2px dashed '+dk.color,borderRadius:10,background:'white',color:dk.color,fontWeight:700,fontSize:12,cursor:'pointer'}}>
                <MIcon name="plus" size={14}/> {dk.label}
              </button>)}
            </div>
          </div>
        </div>
      </div>;
    }
    return null;
  };

  // ─── NEW ESTIMATE GATE ───
  if(newEst)return renderNewEstimate();

  // ─── RENDER DETAIL ROUTER ───
  if(detail){
    if(detail.type==='order')return renderOrderDetail(detail.data);
    if(detail.type==='estimate')return renderEstDetail(detail.data);
    if(detail.type==='customer')return renderCustDetail(detail.data);
    if(detail.type==='invoice')return renderInvDetail(detail.data);
    if(detail.type==='message')return renderMsgDetail(detail.data);
  }

  // ─── HOME TAB ───
  const renderHome=()=>{
    const priColors={1:'#dc2626',2:'#d97706',3:'#64748b'};
    return<div className="mp-page">
      <div className="mp-greeting" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div className="mp-greeting-text">Welcome, {cu.name?.split(' ')[0]}</div>
          <div className="mp-greeting-sub">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
        </div>
        <ScopeToggle/>
      </div>
      {/* Quick stats */}
      <div className="mp-stats-grid">
        <div className="mp-stat-card" onClick={()=>setTab('orders')}>
          <div className="mp-stat-num">{stats.activeOrders}</div><div className="mp-stat-label">Active Orders</div>
        </div>
        <div className="mp-stat-card" onClick={()=>setTab('messages')}>
          <div className="mp-stat-num" style={unreadForMeCount>0?{color:'#dc2626'}:{}}>{unreadForMeCount}</div><div className="mp-stat-label">Messages</div>
        </div>
        <div className="mp-stat-card">
          <div className="mp-stat-num">{stats.openInvoices}</div><div className="mp-stat-label">Open Invoices</div>
        </div>
        <div className="mp-stat-card">
          <div className="mp-stat-num" style={{color:'#16a34a'}}>{fmtMoney(stats.monthRevenue)}</div><div className="mp-stat-label">MTD Sales</div>
        </div>
      </div>
      {/* Urgent orders */}
      {stats.urgentOrders>0&&<div className="mp-alert-banner">
        <MIcon name="alert" size={16}/><span>{stats.urgentOrders} order{stats.urgentOrders>1?'s':''} due within 3 days</span>
      </div>}
      {/* Unread messages for me */}
      {unreadForMeCount>0&&<div className="mp-msg-banner" onClick={()=>setTab('messages')}>
        <MIcon name="mail" size={16}/><span>{unreadForMeCount} unread message{unreadForMeCount>1?'s':''} for you</span>
      </div>}
      {/* To-Do List */}
      <div className="mp-section-title">To-Do ({myTodos.length})</div>
      {myTodos.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:20,fontSize:13}}>No open tasks</div>}
      {myTodos.slice(0,15).map(t=>{
        const isAssignedToMe=t.assigned_to===cu.id;
        const _dateStr=t._date||t.created_at;
        const _dateLabel=_dateStr?(()=>{try{const dt=new Date(_dateStr);if(isNaN(dt))return'';const days=Math.floor((Date.now()-dt)/864e5);return days<1?'Today':days===1?'Yesterday':days<14?days+'d ago':((dt.getMonth()+1)+'/'+dt.getDate())}catch{return''}})():'';
        return<div key={t.id} className="mp-list-card" style={{minHeight:44}}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <div style={{width:4,minHeight:36,borderRadius:2,background:priColors[t.priority]||'#94a3b8',flexShrink:0,marginTop:2}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>{t.title}</div>
              {t.description&&<div style={{fontSize:12,color:'#64748b',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.description}</div>}
              <div style={{display:'flex',gap:8,marginTop:4,fontSize:11,color:'#94a3b8',alignItems:'center',flexWrap:'wrap'}}>
                {t._computed?<span style={{fontSize:10,padding:'1px 6px',borderRadius:6,background:t._type==='art'?'#fef3c7':'#eff6ff',color:t._type==='art'?'#92400e':'#2563eb',fontWeight:600}}>{t._action}</span>
                  :<span>{isAssignedToMe?'Assigned to you':'Created by you'}</span>}
                {_dateLabel&&<span>· {_dateLabel}</span>}
                {t.so_id&&<span>· {t.so_id}</span>}
              </div>
            </div>
            {t._computed&&t._dismissKey&&<button onClick={e=>{e.stopPropagation();dismissTodo(t._dismissKey)}} style={{background:'none',border:'1px solid #e2e8f0',borderRadius:6,padding:'4px 8px',fontSize:12,color:'#94a3b8',cursor:'pointer',flexShrink:0,alignSelf:'center'}}>✕</button>}
          </div>
        </div>})}
    </div>;
  };

  // ─── ORDERS TAB ───
  const renderOrders=()=>{
    return<div className="mp-page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div className="mp-page-title">Sales Orders</div>
        <ScopeToggle/>
      </div>
      {/* Search/filter bar */}
      <div className="mp-search-inline" style={{marginBottom:8}}>
        <MIcon name="search" size={16}/>
        <input placeholder="Search by customer or SO#..." value={ordersQ} onChange={e=>setOrdersQ(e.target.value)} className="mp-search-input"/>
        {ordersQ&&<button onClick={()=>setOrdersQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
      </div>
      <div className="mp-filter-row">
        {['active','all','completed','hold'].map(f=><button key={f} className={`mp-filter-btn${ordersFilter===f?' active':''}`} onClick={()=>setOrdersFilter(f)}>{f==='active'?'Active':f==='hold'?'Hold':f==='all'?'All':'Done'}</button>)}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div className="mp-count">{filteredOrders.length} order{filteredOrders.length!==1?'s':''}</div>
        <select value={ordersSort} onChange={e=>setOrdersSort(e.target.value)} className="mp-sort-select">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="due_date">Due Date</option><option value="customer">Customer</option>
        </select>
      </div>
      {filteredOrders.map(so=>{
        const cc=custObj(so.customer_id);
        const totalQty=safeItems(so).reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((s,v)=>s+v,0),0);
        const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
        return<div key={so.id} className="mp-list-card" onClick={()=>setDetail({type:'order',data:so})}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{so.id}</span>
                <span style={statusBadge(so.status||'new')}>{(so.status||'new').replace('_',' ')}</span>
              </div>
              <div style={{fontSize:13,color:'#334155',marginTop:2}}>{cc?.name||cc?.alpha_tag||'—'}</div>
              {so.memo&&<div style={{fontSize:12,color:'#94a3b8',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {so.total>0&&<div style={{fontSize:13,fontWeight:700}}>{fmtMoney(so.total)}</div>}
              <div style={{fontSize:12,color:'#64748b'}}>{totalQty} pcs</div>
              {daysOut!=null&&<div style={{fontSize:11,fontWeight:700,color:daysOut<=3?'#dc2626':daysOut<=7?'#d97706':'#64748b'}}>{daysOut<=0?'DUE TODAY':daysOut+'d out'}</div>}
              <div style={{fontSize:11,color:'#94a3b8'}}>{fmtDate(so.expected_date)}</div>
            </div>
          </div>
        </div>})}
    </div>;
  };

  // ─── MESSAGES TAB ───
  const renderMessages=()=>{
    const filtered=useMemo?(() => {
      let list=[...msgs];
      if(msgFilter==='for_me')list=list.filter(m=>!(m.read_by||[]).includes(cu.id)&&(m.tagged_members||[]).includes(cu.id));
      else if(msgFilter==='unread')list=list.filter(m=>!(m.read_by||[]).includes(cu.id));
      return list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,40);
    })():msgs.slice(0,40);
    return<div className="mp-page">
      <div className="mp-page-title">Messages</div>
      <div className="mp-filter-row">
        {[{k:'for_me',l:'For Me ('+unreadForMeCount+')'},{k:'unread',l:'Unread ('+unreadAllCount+')'},{k:'all',l:'All'}].map(f=>
          <button key={f.k} className={`mp-filter-btn${msgFilter===f.k?' active':''}`} onClick={()=>setMsgFilter(f.k)}>{f.l}</button>)}
      </div>
      <div className="mp-count">{filtered.length} message{filtered.length!==1?'s':''}</div>
      {/* New Message button */}
      <button onClick={()=>setComposeMsg({so_id:null,entity_type:null,entity_id:null,replyTo:null})} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 16px',background:'#1e40af',color:'white',border:'none',borderRadius:10,fontWeight:700,fontSize:14,cursor:'pointer',marginBottom:8,minHeight:44}}>
        <MIcon name="plus" size={16}/> New Message
      </button>
      {filtered.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:30,fontSize:13}}>{msgFilter==='for_me'?'No unread messages for you':'No messages'}</div>}
      {filtered.map(m=>{const isUnread=!(m.read_by||[]).includes(cu.id);const isForMe=(m.tagged_members||[]).includes(cu.id);
        const author=REPS.find(r=>r.id===m.author_id||r.id===m.from);
        const initials=(author?.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        return<div key={m.id} className="mp-list-card" style={{borderLeft:isUnread?'3px solid '+(isForMe?'#dc2626':'#2563eb'):'3px solid transparent',padding:'10px 12px'}} onClick={()=>{
          // Mark as read
          if(isUnread&&onMsg){onMsg(prev=>prev.map(x=>x.id===m.id?{...x,read_by:[...(x.read_by||[]),cu.id]}:x))}
          // Open in compose view to see full thread and reply
          if(m.so_id||m.entity_id){setComposeMsg({so_id:m.so_id,entity_type:m.entity_type||'so',entity_id:m.entity_id||m.so_id,replyTo:null})}
          else{setDetail({type:'message',data:m})}
        }}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            {/* Avatar */}
            <div style={{width:36,height:36,borderRadius:'50%',background:isForMe?'#fee2e2':'#dbeafe',color:isForMe?'#dc2626':'#1e40af',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:12,flexShrink:0}}>{initials}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontWeight:isUnread?800:600,fontSize:13}}>{author?.name||repName(m.from)}</span>
                {isForMe&&isUnread&&<span style={{fontSize:9,background:'#fee2e2',color:'#dc2626',padding:'1px 6px',borderRadius:8,fontWeight:700}}>@you</span>}
                {isUnread&&!isForMe&&<span style={{width:8,height:8,borderRadius:'50%',background:'#2563eb',flexShrink:0}}/>}
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{timeAgo(m.created_at)}</span>
              </div>
              <div style={{fontSize:13,color:isUnread?'#0f172a':'#64748b',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:isUnread?600:400}}>{(m.body||m.text||'').slice(0,80)}</div>
              {m.so_id&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{m.so_id}</div>}
            </div>
          </div>
        </div>})}
    </div>;
  };

  // ─── CUSTOMERS TAB ───
  const renderCustomers=()=>{
    return<div className="mp-page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div className="mp-page-title">Customers</div>
        <ScopeToggle/>
      </div>
      <div className="mp-search-inline">
        <MIcon name="search" size={16}/>
        <input placeholder="Search customers..." value={custQ} onChange={e=>setCustQ(e.target.value)} className="mp-search-input"/>
        {custQ&&<button onClick={()=>setCustQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
      </div>
      <div className="mp-count">{filteredCust.length} customer{filteredCust.length!==1?'s':''}</div>
      {filteredCust.slice(0,50).map(cc=>{
        const soCount=sos.filter(s=>s.customer_id===cc.id).length;
        return<div key={cc.id} className="mp-list-card" onClick={()=>setDetail({type:'customer',data:cc})}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14}}>{cc.name}</div>
              {cc.alpha_tag&&<div style={{fontSize:12,color:'#64748b'}}>{cc.alpha_tag}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:12,color:'#64748b'}}>{soCount} orders</div>
              <div style={{fontSize:11,color:'#94a3b8'}}>{repName(cc.primary_rep_id)}</div>
            </div>
          </div>
        </div>})}
    </div>;
  };

  // ═══════════════════════════════════════════
  // WAREHOUSE — full IF pull + PO check-in/view
  // ═══════════════════════════════════════════
  // Extract real size keys (numeric) from a pick/po line, ordered by SZ_ORD.
  const whSizes=(obj)=>Object.keys(obj||{}).filter(k=>SZ_ORD.includes(k)&&typeof obj[k]==='number').sort((a,b)=>SZ_ORD.indexOf(a)-SZ_ORD.indexOf(b));
  const whProd=(it)=>prod.find(x=>x.id===it?.product_id)||prod.find(x=>x.sku===it?.sku)||null;

  // Open IFs (pick groups not yet fully pulled) across active orders, grouped by SO + pick_id.
  const buildOpenIFs=()=>{
    const out=[];
    sos.forEach(so=>{
      if(['completed','shipped','cancelled'].includes(so.status||''))return;
      const items=safeItems(so);const groups={};
      items.forEach((it,ii)=>{(it.pick_lines||[]).forEach(pk=>{
        if((pk.status||'pick')!=='pulled'){
          const g=groups[pk.pick_id]||(groups[pk.pick_id]={pickId:pk.pick_id,shipDest:pk.ship_dest||'in_house',decoVendor:pk.deco_vendor||'',memo:pk.memo||'',lines:[]});
          g.lines.push({itemIdx:ii,item:it,pick:pk});
        }
      })});
      Object.values(groups).forEach(g=>{
        const totalQty=g.lines.reduce((a,l)=>a+whSizes(l.pick).reduce((b,sz)=>b+(l.pick[sz]||0),0),0);
        out.push({so,soId:so.id,cust:custObj(so.customer_id),...g,totalQty});
      });
    });
    return out.sort((a,b)=>(a.so.expected_date||'9').localeCompare(b.so.expected_date||'9'));
  };

  // All POs — SO-attached blank POs (grouped by SO + po_id) plus standalone inventory POs.
  const buildPOs=()=>{
    const map={};
    sos.forEach(so=>{const cc=custObj(so.customer_id);safeItems(so).forEach((it,ii)=>{(it.po_lines||[]).forEach((po,pli)=>{
      const pid=po.po_id||'PO';const key='so|'+so.id+'|'+pid+'|'+(po.vendor||'');
      const e=map[key]||(map[key]={key,kind:'so',poId:pid,soId:so.id,cust:cc,vendor:po.vendor||'',lines:[],created_at:po.created_at||so.created_at});
      const sizes={};let ordered=0,received=0,open=0;
      whSizes(po).forEach(sz=>{const ord=po[sz]||0;const rcv=(po.received||{})[sz]||0;const can=(po.cancelled||{})[sz]||0;const o=Math.max(0,ord-rcv-can);sizes[sz]={ord,rcv,open:o};ordered+=ord;received+=rcv;open+=o});
      e.lines.push({itemIdx:ii,poLineIdx:pli,item:it,sizes,ordered,received,open});
    })})});
    (invPOs||[]).forEach(po=>{
      const lines=(po.items||[]).map((it,idx)=>{const sizes={};let ordered=0,received=0,open=0;Object.keys(it.sizes||{}).forEach(sz=>{const ord=it.sizes[sz]||0;const rcv=(it.received||{})[sz]||0;const o=Math.max(0,ord-rcv);sizes[sz]={ord,rcv,open:o};ordered+=ord;received+=rcv;open+=o});return{idx,item:it,sizes,ordered,received,open}});
      map['inv|'+po.id]={key:'inv|'+po.id,kind:'inv',poId:po.po_number,invId:po.id,vendor:po.vendor_name||'',cust:null,lines,created_at:po.created_at,_status:po.status};
    });
    return Object.values(map).map(e=>{
      const totOpen=e.lines.reduce((a,l)=>a+l.open,0),totRcv=e.lines.reduce((a,l)=>a+l.received,0),totOrd=e.lines.reduce((a,l)=>a+l.ordered,0);
      const status=e.kind==='inv'?(e._status==='received'?'received':totRcv>0?'partial':'waiting'):(totOpen<=0&&totRcv>0?'received':totRcv>0?'partial':'waiting');
      return{...e,totOpen,totRcv,totOrd,status};
    }).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  };

  const openIF=(grp)=>{const init={};grp.lines.forEach(l=>{const m={};whSizes(l.pick).forEach(sz=>{m[sz]=l.pick[sz]||0});init[l.itemIdx]=m});setWhPullQty(init);setWhDetail({kind:'if',soId:grp.soId,pickId:grp.pickId})};
  const openPO=(po)=>{const init={};po.lines.forEach((l,i)=>{const m={};Object.entries(l.sizes).forEach(([sz,s])=>{if(s.open>0)m[sz]=s.open});init[i]=m});setWhRcvQty(init);setWhDetail({kind:'po',key:po.key})};

  const confirmPull=(grp)=>{
    if(whSaving)return;
    const map={};Object.entries(whPullQty).forEach(([ii,m])=>{const mm={};Object.entries(m||{}).forEach(([sz,v])=>{const n=parseInt(v)||0;if(n>0)mm[sz]=n});if(Object.keys(mm).length)map[ii]=mm});
    const total=Object.values(map).reduce((a,m)=>a+Object.values(m).reduce((b,v)=>b+v,0),0);
    if(total===0){if(nf)nf('Enter at least one quantity to pull','error');return}
    setWhSaving(true);
    try{onPullIF&&onPullIF(grp.soId,grp.pickId,map)}finally{setWhSaving(false);setWhDetail(null);setWhPullQty({})}
  };
  const confirmReceive=(po)=>{
    if(whSaving)return;let total=0;
    if(po.kind==='so'){
      const lines=po.lines.map((l,i)=>{const rcv={};Object.entries(whRcvQty[i]||{}).forEach(([sz,v])=>{const n=parseInt(v)||0;if(n>0){rcv[sz]=n;total+=n}});return{itemIdx:l.itemIdx,poLineIdx:l.poLineIdx,rcv}}).filter(l=>Object.keys(l.rcv).length);
      if(total===0){if(nf)nf('Enter at least one quantity to receive','error');return}
      setWhSaving(true);try{onReceiveSOPO&&onReceiveSOPO(po.soId,lines)}finally{setWhSaving(false);setWhDetail(null);setWhRcvQty({})}
    }else{
      const receivedMap={};po.lines.forEach((l,i)=>{const m={};Object.entries(whRcvQty[i]||{}).forEach(([sz,v])=>{const n=parseInt(v)||0;if(n>0){m[sz]=n;total+=n}});if(Object.keys(m).length)receivedMap[l.idx]=m});
      if(total===0){if(nf)nf('Enter at least one quantity to receive','error');return}
      setWhSaving(true);try{onReceiveInvPO&&onReceiveInvPO(po.invId,receivedMap)}finally{setWhSaving(false);setWhDetail(null);setWhRcvQty({})}
    }
  };

  const PO_BADGE={waiting:{bg:'#fef3c7',c:'#92400e',l:'Waiting'},partial:{bg:'#dbeafe',c:'#1e40af',l:'Partial'},received:{bg:'#dcfce7',c:'#166534',l:'Received'}};
  const whNumInput=(val,max,onCh)=>{const over=val>max;return<input type="number" inputMode="numeric" min={0} max={max} value={val} onChange={e=>{const v=Math.max(0,parseInt(e.target.value)||0);onCh(v)}} style={{width:48,textAlign:'center',fontSize:16,fontWeight:800,border:'1px solid '+(over?'#dc2626':'#cbd5e1'),borderRadius:6,padding:'6px 0',color:over?'#dc2626':'#0f172a',boxSizing:'border-box'}}/>};

  const renderWarehouse=()=>{
    const setSubPage=setMoreSubPage;
    const openIFs=buildOpenIFs();
    const pos=buildPOs();

    // ─── IF PULL DETAIL ───
    if(whDetail?.kind==='if'){
      const grp=openIFs.find(g=>g.soId===whDetail.soId&&g.pickId===whDetail.pickId);
      if(grp){
        const shipBadge=grp.shipDest!=='in_house'?(grp.shipDest==='ship_customer'?{t:'📦 Ship to Customer',bg:'#eff6ff',c:'#1e40af'}:{t:'🚚 Ship to Deco'+(grp.decoVendor?' — '+grp.decoVendor:''),bg:'#fffbeb',c:'#92400e'}):null;
        const grandPull=Object.values(whPullQty).reduce((a,m)=>a+Object.values(m||{}).reduce((b,v)=>b+(parseInt(v)||0),0),0);
        return<div className="mp-detail">
          <div className="mp-detail-header">
            <button className="mp-back-btn" onClick={()=>{setWhDetail(null);setWhPullQty({})}}><MIcon name="back" size={22}/></button>
            <div style={{flex:1}}><div className="mp-detail-id">{grp.pickId}</div><div className="mp-detail-sub">{grp.soId} · {grp.cust?.name||grp.cust?.alpha_tag||'—'}</div></div>
            <span style={{fontSize:11,background:'#fef3c7',color:'#92400e',padding:'3px 10px',borderRadius:12,fontWeight:700}}>To Pull</span>
          </div>
          <div className="mp-detail-body">
            {shipBadge&&<div style={{padding:'10px 12px',marginBottom:12,borderRadius:10,background:shipBadge.bg,color:shipBadge.c,fontWeight:700,fontSize:13}}>{shipBadge.t}</div>}
            {grp.memo&&<div className="mp-memo">{grp.memo}</div>}
            <div className="mp-section-title">Items to Pull ({grp.lines.length})</div>
            {grp.lines.map(l=>{const p=whProd(l.item);const szs=whSizes(l.pick);
              return<div key={l.itemIdx} className="mp-item-card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div style={{minWidth:0}}><div style={{fontWeight:700,fontSize:14}}>{l.item.name||l.item.sku}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>{l.item.sku}{l.item.color?' · '+l.item.color:''}</div></div>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {szs.map(sz=>{const planned=l.pick[sz]||0;const stock=p?._inv?.[sz]||0;const v=(whPullQty[l.itemIdx]||{})[sz]??planned;
                    return<div key={sz} style={{textAlign:'center',minWidth:62,padding:'6px',borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
                      <div style={{fontSize:11,fontWeight:800,color:'#475569',marginBottom:2}}>{sz}</div>
                      <div style={{fontSize:9,color:'#94a3b8',marginBottom:4}}>need {planned}</div>
                      {whNumInput(v,planned,nv=>setWhPullQty(prev=>({...prev,[l.itemIdx]:{...(prev[l.itemIdx]||{}),[sz]:nv}})))}
                      <div style={{fontSize:9,color:stock<planned?'#dc2626':'#94a3b8',marginTop:3}}>{stock} in stock</div>
                    </div>})}
                </div>
              </div>})}
          </div>
          <div style={{position:'sticky',bottom:0,background:'white',borderTop:'1px solid #e2e8f0',padding:'12px 16px',paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}>
            <button disabled={whSaving||grandPull===0} onClick={()=>confirmPull(grp)} style={{width:'100%',padding:'14px',borderRadius:12,border:'none',background:grandPull>0&&!whSaving?'#166534':'#cbd5e1',color:'white',fontWeight:800,fontSize:15,cursor:grandPull>0&&!whSaving?'pointer':'default',minHeight:48}}>
              {whSaving?'Saving…':'✓ Mark Pulled ('+grandPull+' units)'}
            </button>
          </div>
        </div>;
      }
    }

    // ─── PO RECEIVE / VIEW DETAIL ───
    if(whDetail?.kind==='po'){
      const po=pos.find(p=>p.key===whDetail.key);
      if(po){
        const b=PO_BADGE[po.status]||PO_BADGE.waiting;
        const grandRcv=Object.values(whRcvQty).reduce((a,m)=>a+Object.values(m||{}).reduce((s,v)=>s+(parseInt(v)||0),0),0);
        const done=po.status==='received';
        return<div className="mp-detail">
          <div className="mp-detail-header">
            <button className="mp-back-btn" onClick={()=>{setWhDetail(null);setWhRcvQty({})}}><MIcon name="back" size={22}/></button>
            <div style={{flex:1}}><div className="mp-detail-id">{po.poId}</div><div className="mp-detail-sub">{po.vendor||'—'}{po.kind==='so'?' · '+po.soId+(po.cust?' · '+po.cust.name:''):' · Inventory PO'}</div></div>
            <span style={{fontSize:11,background:b.bg,color:b.c,padding:'3px 10px',borderRadius:12,fontWeight:700}}>{b.l}</span>
          </div>
          <div className="mp-detail-body">
            <div className="mp-info-grid">
              <div className="mp-info-item"><div className="mp-info-label">Ordered</div><div className="mp-info-val">{po.totOrd}</div></div>
              <div className="mp-info-item"><div className="mp-info-label">Received</div><div className="mp-info-val" style={{color:'#16a34a'}}>{po.totRcv}</div></div>
              <div className="mp-info-item"><div className="mp-info-label">Open</div><div className="mp-info-val" style={{color:po.totOpen>0?'#d97706':'#94a3b8'}}>{po.totOpen}</div></div>
              <div className="mp-info-item"><div className="mp-info-label">Type</div><div className="mp-info-val">{po.kind==='inv'?'Inventory':'Order PO'}</div></div>
            </div>
            <div className="mp-section-title">Items ({po.lines.length}){po.totOpen>0?' — enter qty received':''}</div>
            {po.lines.map((l,i)=>{const item=l.item;const szEntries=Object.entries(l.sizes).filter(([,s])=>s.ord>0);
              return<div key={i} className="mp-item-card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div style={{minWidth:0}}><div style={{fontWeight:700,fontSize:14}}>{item.name||item.sku}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>{item.sku}{item.color?' · '+item.color:''}</div></div>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {szEntries.map(([sz,s])=>{const v=(whRcvQty[i]||{})[sz]??(s.open>0?s.open:0);
                    return<div key={sz} style={{textAlign:'center',minWidth:62,padding:'6px',borderRadius:8,border:s.open>0?'1px solid #e2e8f0':'1px solid #f1f5f9',background:s.open>0?'#f8fafc':'#fafafa'}}>
                      <div style={{fontSize:11,fontWeight:800,color:'#475569',marginBottom:2}}>{sz}</div>
                      <div style={{fontSize:9,color:'#94a3b8',marginBottom:4}}>{s.rcv}/{s.ord} rcvd</div>
                      {s.open>0?whNumInput(v,s.open,nv=>setWhRcvQty(prev=>({...prev,[i]:{...(prev[i]||{}),[sz]:nv}}))):<div style={{fontSize:16,fontWeight:800,color:'#16a34a',padding:'6px 0'}}>✓</div>}
                    </div>})}
                </div>
              </div>})}
          </div>
          {!done&&<div style={{position:'sticky',bottom:0,background:'white',borderTop:'1px solid #e2e8f0',padding:'12px 16px',paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}>
            <button disabled={whSaving||grandRcv===0} onClick={()=>confirmReceive(po)} style={{width:'100%',padding:'14px',borderRadius:12,border:'none',background:grandRcv>0&&!whSaving?'#1e40af':'#cbd5e1',color:'white',fontWeight:800,fontSize:15,cursor:grandRcv>0&&!whSaving?'pointer':'default',minHeight:48}}>
              {whSaving?'Saving…':'✓ Receive ('+grandRcv+' units)'}
            </button>
          </div>}
        </div>;
      }
    }

    // ─── WAREHOUSE LIST (IFs + POs) ───
    const openPoCount=pos.filter(p=>p.status!=='received').length;
    let poList=pos;
    if(whPoFilter==='open')poList=poList.filter(p=>p.status!=='received');
    if(whQ.length>=2){const s=whQ.toLowerCase();poList=poList.filter(p=>((p.poId||'')+' '+(p.vendor||'')+' '+(p.soId||'')+' '+(p.cust?.name||'')+' '+p.lines.map(l=>(l.item?.sku||'')+' '+(l.item?.name||'')).join(' ')).toLowerCase().includes(s))}
    return<div className="mp-page">
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
        <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
        <div className="mp-page-title" style={{margin:0}}>Warehouse</div>
      </div>
      {/* Segmented tabs */}
      <div style={{display:'flex',gap:6,background:'#f1f5f9',borderRadius:10,padding:4,marginBottom:12}}>
        {[['if','Pull IFs',openIFs.length],['pos','Check In POs',openPoCount]].map(([k,l,n])=>
          <button key={k} onClick={()=>setWhTab(k)} style={{flex:1,padding:'10px 8px',borderRadius:8,border:'none',background:whTab===k?'white':'transparent',color:whTab===k?'#0f172a':'#64748b',fontWeight:700,fontSize:13,cursor:'pointer',boxShadow:whTab===k?'0 1px 2px rgba(0,0,0,0.1)':'none'}}>{l}{n>0?' ('+n+')':''}</button>)}
      </div>

      {whTab==='if'&&<>
        {openIFs.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:40,fontSize:14}}>No IFs waiting to pull 🎉</div>}
        {openIFs.map(g=><div key={g.soId+g.pickId} className="mp-list-card" onClick={()=>openIF(g)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontWeight:800,color:'#d97706',fontSize:14}}>{g.pickId}</span>
                <span style={{fontSize:11,color:'#1e40af',fontWeight:700}}>{g.soId}</span>
                {g.shipDest!=='in_house'&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:6,background:g.shipDest==='ship_customer'?'#dbeafe':'#ede9fe',color:g.shipDest==='ship_customer'?'#1e40af':'#6d28d9',fontWeight:700}}>{g.shipDest==='ship_customer'?'→ Customer':'→ Deco'}</span>}
              </div>
              <div style={{fontSize:13,color:'#334155',marginTop:2}}>{g.cust?.name||g.cust?.alpha_tag||'—'}</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{g.lines.length} item{g.lines.length!==1?'s':''} · {g.lines.map(l=>l.item.sku).slice(0,2).join(', ')}{g.lines.length>2?'…':''}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
              <div style={{fontSize:18,fontWeight:800,color:'#d97706'}}>{g.totalQty}</div>
              <div style={{fontSize:10,color:'#94a3b8'}}>to pull</div>
              {g.so.expected_date&&<div style={{fontSize:11,fontWeight:700,marginTop:2,color:(()=>{const d=Math.ceil((new Date(g.so.expected_date)-new Date())/86400000);return d<=3?'#dc2626':d<=7?'#d97706':'#64748b'})()}}>{fmtDate(g.so.expected_date)}</div>}
            </div>
          </div>
        </div>)}
      </>}

      {whTab==='pos'&&<>
        <div className="mp-search-inline" style={{marginBottom:8}}>
          <MIcon name="search" size={16}/>
          <input placeholder="Search PO #, vendor, SO, SKU…" value={whQ} onChange={e=>setWhQ(e.target.value)} className="mp-search-input"/>
          {whQ&&<button onClick={()=>setWhQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
        </div>
        <div className="mp-filter-row">
          {[['open','Open'],['all','All']].map(([k,l])=><button key={k} className={`mp-filter-btn${whPoFilter===k?' active':''}`} onClick={()=>setWhPoFilter(k)}>{l}</button>)}
        </div>
        <div className="mp-count">{poList.length} PO{poList.length!==1?'s':''}</div>
        {poList.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:40,fontSize:14}}>No POs {whPoFilter==='open'?'awaiting check-in':'found'}</div>}
        {poList.slice(0,150).map(po=>{const b=PO_BADGE[po.status]||PO_BADGE.waiting;
          return<div key={po.key} className="mp-list-card" onClick={()=>openPO(po)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{po.poId}</span>
                  <span style={{fontSize:11,background:b.bg,color:b.c,padding:'2px 8px',borderRadius:10,fontWeight:700}}>{b.l}</span>
                  {po.kind==='inv'&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:6,background:'#f1f5f9',color:'#64748b',fontWeight:700}}>INV</span>}
                </div>
                <div style={{fontSize:13,color:'#334155',marginTop:2}}>{po.vendor||'—'}</div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{po.kind==='so'?po.soId+(po.cust?' · '+po.cust.name:''):po.lines.length+' item'+(po.lines.length!==1?'s':'')}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                <div style={{fontSize:16,fontWeight:800,color:po.totOpen>0?'#d97706':'#16a34a'}}>{po.totRcv}/{po.totOrd}</div>
                <div style={{fontSize:10,color:'#94a3b8'}}>received</div>
                {po.totOpen>0&&<div style={{fontSize:11,fontWeight:700,color:'#d97706',marginTop:2}}>{po.totOpen} open</div>}
              </div>
            </div>
          </div>})}
        {poList.length>150&&<div style={{textAlign:'center',color:'#94a3b8',padding:12,fontSize:12}}>Showing first 150 of {poList.length}. Search to narrow.</div>}
      </>}
    </div>;
  };

  // ─── MORE TAB (hamburger) ───
  const renderMore=()=>{
    const subPage=moreSubPage;const setSubPage=setMoreSubPage;
    if(subPage==='estimates'){
      const filteredE=(()=>{
        let list=ests.filter(e=>inScope(e.customer_id,e.created_by));
        if(estsFilter==='pending')list=list.filter(e=>['draft','pending','sent'].includes(e.status||'draft'));
        else if(estsFilter==='won')list=list.filter(e=>e.status==='won'||e.status==='approved');
        else if(estsFilter==='lost')list=list.filter(e=>e.status==='lost'||e.status==='expired');
        return sortList(list,estsSort);
      })();
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0,flex:1}}>Estimates</div>
          <ScopeToggle/>
        </div>
        <div className="mp-filter-row">
          {['pending','all','won','lost'].map(f=><button key={f} className={`mp-filter-btn${estsFilter===f?' active':''}`} onClick={()=>setEstsFilter(f)}>{f==='pending'?'Pending':f==='all'?'All':f==='won'?'Won':'Lost'}</button>)}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div className="mp-count">{filteredE.length} estimate{filteredE.length!==1?'s':''}</div>
          <select value={estsSort} onChange={e=>setEstsSort(e.target.value)} className="mp-sort-select">
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="customer">Customer</option><option value="amount">Amount</option>
          </select>
        </div>
        {filteredE.map(est=>{const cc=custObj(est.customer_id);
          return<div key={est.id} className="mp-list-card" onClick={()=>setDetail({type:'estimate',data:est})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{est.id}</span>
                  <span style={statusBadge(est.status||'draft')}>{est.status||'draft'}</span>
                </div>
                <div style={{fontSize:13,color:'#334155',marginTop:2}}>{cc?.name||cc?.alpha_tag||'—'}</div>
                {est.memo&&<div style={{fontSize:12,color:'#94a3b8',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo}</div>}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:700}}>{fmtMoney(est.total)}</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{fmtDate(est.created_at)}</div>
              </div>
            </div>
          </div>})}
      </div>;
    }
    if(subPage==='invoices'){
      const filteredI=(()=>{
        let list=invs.filter(i=>inScope(i.customer_id,i.created_by));
        if(invsFilter==='open')list=list.filter(i=>i.status!=='paid'&&i.status!=='cancelled');
        else if(invsFilter==='paid')list=list.filter(i=>i.status==='paid');
        else if(invsFilter==='overdue')list=list.filter(i=>{if(i.status==='paid'||i.status==='cancelled')return false;if(!i.due_date)return false;return new Date(i.due_date)<new Date()});
        return sortList(list,invsSort);
      })();
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0,flex:1}}>Invoices</div>
          <ScopeToggle/>
        </div>
        <div className="mp-filter-row">
          {['open','all','paid','overdue'].map(f=><button key={f} className={`mp-filter-btn${invsFilter===f?' active':''}`} onClick={()=>setInvsFilter(f)}>{f==='open'?'Open':f==='all'?'All':f==='paid'?'Paid':'Overdue'}</button>)}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div className="mp-count">{filteredI.length} invoice{filteredI.length!==1?'s':''}</div>
          <select value={invsSort} onChange={e=>setInvsSort(e.target.value)} className="mp-sort-select">
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="due_date">Due Date</option><option value="customer">Customer</option><option value="amount">Amount</option>
          </select>
        </div>
        {filteredI.slice(0,200).map(inv=>{const cc=custObj(inv.customer_id);
          return<div key={inv.id} className="mp-list-card" onClick={()=>setDetail({type:'invoice',data:inv})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontWeight:700,color:'#1e40af'}}>{inv.id}</span>
                  <span style={statusBadge(inv.status||'open')}>{inv.status||'open'}</span>
                  {inv._hist&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:6,background:'#f1f5f9',color:'#64748b',fontWeight:700}}>NS</span>}
                </div>
                <div style={{fontSize:12,color:'#64748b'}}>{cc?.name||cc?.alpha_tag||inv._cname||'—'}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontWeight:700}}>{fmtMoney(inv.total)}</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{fmtDate(inv.due_date||inv.created_at)}</div>
              </div>
            </div>
          </div>})}
        {filteredI.length>200&&<div style={{textAlign:'center',color:'#94a3b8',padding:12,fontSize:12}}>Showing first 200 of {filteredI.length}. Use search to narrow.</div>}
      </div>;
    }
    if(subPage==='inventory'){
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Inventory ({prod.length})</div>
        </div>
        <div className="mp-search-inline">
          <MIcon name="search" size={16}/>
          <input placeholder="Search products..." id="mp-inv-q" className="mp-search-input" onChange={e=>{/* handled inline */}}/>
        </div>
        {(()=>{const iq=(document.getElementById('mp-inv-q')?.value||'').toLowerCase();
          const list=iq.length>=2?prod.filter(p=>(p.sku+' '+p.name+' '+(p.brand||'')+' '+(p.color||'')).toLowerCase().includes(iq)):prod.slice(0,30);
          return list.map(p=>{const totalStock=Object.values(p.stock||{}).reduce((a,v)=>a+v,0);
            return<div key={p.id} className="mp-list-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>{p.sku}{p.color?' · '+p.color:''}{p.brand?' · '+p.brand:''}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontWeight:700,fontSize:14}}>{totalStock}</div>
                  <div style={{fontSize:10,color:'#94a3b8'}}>in stock</div>
                </div>
              </div>
              {totalStock>0&&<div className="mp-size-row" style={{marginTop:6}}>
                {Object.entries(p.stock||{}).filter(([,v])=>v>0).map(([sz,v])=>
                  <div key={sz} className="mp-size-chip"><span className="mp-size-label">{sz}</span><span className="mp-size-qty">{v}</span></div>)}
              </div>}
            </div>})})()}
      </div>;
    }
    if(subPage==='jobs'){
      const allJobs=[];
      sos.filter(so=>inScope(so.customer_id,so.created_by)).forEach(so=>{const cc=custObj(so.customer_id);safeJobs(so).forEach(j=>{allJobs.push({...j,so,so_id:so.id,customer:cc?.name||cc?.alpha_tag||'—'})})});
      const STATUS_FILTERS=[
        {k:'active',l:'Active',f:j=>!['completed','shipped','draft'].includes(j.prod_status||'')},
        {k:'ready',l:'Ready',f:j=>(j.prod_status==='hold'&&isJobReady(j,j.so))||j.prod_status==='ready'},
        {k:'staging',l:'In Line',f:j=>j.prod_status==='staging'},
        {k:'in_process',l:'In Process',f:j=>j.prod_status==='in_process'},
        {k:'hold',l:'On Hold',f:j=>j.prod_status==='hold'},
        {k:'completed',l:'Done',f:j=>['completed','shipped'].includes(j.prod_status||'')},
        {k:'all',l:'All',f:j=>(j.prod_status||'')!=='draft'},
      ];
      const decoTypes=[...new Set(allJobs.map(j=>j.deco_type).filter(Boolean))].sort();
      const statusFn=(STATUS_FILTERS.find(s=>s.k===jobsStatusF)||STATUS_FILTERS[0]).f;
      let jobs=allJobs.filter(statusFn);
      if(jobsDecoF!=='all')jobs=jobs.filter(j=>j.deco_type===jobsDecoF);
      if(jobsQ.length>=2){const s=jobsQ.toLowerCase();jobs=jobs.filter(j=>((j.id||'')+' '+(j.art_name||'')+' '+(j.deco_type||'')+' '+(j.customer||'')+' '+(j.so_id||'')+' '+(j.assigned_to||'')).toLowerCase().includes(s))}
      jobs=jobs.sort((a,b)=>(a.so?.expected_date||'9').localeCompare(b.so?.expected_date||'9'));
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0,flex:1}}>Jobs ({jobs.length})</div>
          <ScopeToggle/>
        </div>
        <div className="mp-search-inline" style={{marginBottom:8}}>
          <MIcon name="search" size={16}/>
          <input placeholder="Search jobs by art, SO, customer..." value={jobsQ} onChange={e=>setJobsQ(e.target.value)} className="mp-search-input"/>
          {jobsQ&&<button onClick={()=>setJobsQ('')} className="mp-clear-btn"><MIcon name="x" size={14}/></button>}
        </div>
        <div className="mp-filter-row" style={{overflowX:'auto',WebkitOverflowScrolling:'touch',flexWrap:'nowrap'}}>
          {STATUS_FILTERS.map(s=><button key={s.k} className={`mp-filter-btn${jobsStatusF===s.k?' active':''}`} style={{whiteSpace:'nowrap',flexShrink:0}} onClick={()=>setJobsStatusF(s.k)}>{s.l}</button>)}
        </div>
        {decoTypes.length>1&&<select value={jobsDecoF} onChange={e=>setJobsDecoF(e.target.value)} className="mp-sort-select" style={{width:'100%',marginBottom:8}}>
          <option value="all">All Deco Types</option>
          {decoTypes.map(d=><option key={d} value={d}>{d.replace(/_/g,' ')}</option>)}
        </select>}
        {jobs.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:40,fontSize:14}}>No jobs match.</div>}
        {jobs.slice(0,80).map((j,i)=><div key={i} className="mp-list-card" onClick={()=>{if(j.so)setDetail({type:'order',data:j.so})}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontWeight:700,color:'#1e40af',fontSize:13}}>{j.id||'Job'}</span>
                <span style={statusBadge(j.prod_status||'pending')}>{prodLabel(j)}</span>
              </div>
              <div style={{fontSize:12,color:'#334155',marginTop:2}}>{(j.deco_type||'—').replace(/_/g,' ')} · {j.art_name||'—'}</div>
              <div style={{fontSize:11,color:'#94a3b8'}}>{j.customer} · {j.so_id}{j.assigned_to?' · '+j.assigned_to:''}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,marginLeft:8,fontSize:11,color:'#64748b'}}>{fmtDate(j.so?.expected_date)}</div>
          </div>
        </div>)}
        {jobs.length>80&&<div style={{textAlign:'center',color:'#94a3b8',padding:12,fontSize:12}}>Showing first 80 of {jobs.length}. Use search to narrow.</div>}
      </div>;
    }
    if(subPage==='production'){
      const allJobs=[];
      sos.filter(so=>inScope(so.customer_id,so.created_by)).forEach(so=>{const cc=custObj(so.customer_id);safeJobs(so).forEach(j=>{allJobs.push({...j,so,so_id:so.id,customer:cc?.name||cc?.alpha_tag||'—'})})});
      // Kanban columns mirror the desktop production board (driven by prod_status + isJobReady).
      const cols=[
        {id:'ready',label:'Ready for Prod',color:'#6366f1',filter:j=>(j.prod_status==='hold'&&isJobReady(j,j.so))||j.prod_status==='ready'},
        {id:'staging',label:'In Line',color:'#d97706',filter:j=>j.prod_status==='staging'},
        {id:'in_process',label:'In Process',color:'#2563eb',filter:j=>j.prod_status==='in_process'},
        {id:'completed',label:'Completed',color:'#166534',filter:j=>j.prod_status==='completed'},
      ];
      const colJobs=cols.map(c=>({...c,jobs:allJobs.filter(c.filter).sort((a,b)=>(a.so?.expected_date||'9').localeCompare(b.so?.expected_date||'9'))}));
      const total=colJobs.reduce((a,c)=>a+c.jobs.length,0);
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0,flex:1}}>Production Board ({total})</div>
          <ScopeToggle/>
        </div>
        <div className="mp-stats-grid" style={{marginBottom:12}}>
          {colJobs.map(c=><div key={c.id} className="mp-stat-card"><div className="mp-stat-num" style={{color:c.color}}>{c.jobs.length}</div><div className="mp-stat-label">{c.label}</div></div>)}
        </div>
        {total===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:40,fontSize:14}}>No jobs on the board.</div>}
        {colJobs.filter(c=>c.jobs.length>0).map(c=><div key={c.id} style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <div style={{width:10,height:10,borderRadius:3,background:c.color}}/>
            <div style={{fontWeight:800,fontSize:14,color:'#0f172a'}}>{c.label}</div>
            <div style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{c.jobs.length}</div>
          </div>
          {c.jobs.map((j,i)=><div key={c.id+i} className="mp-list-card" style={{borderLeft:'3px solid '+c.color}} onClick={()=>{if(j.so)setDetail({type:'order',data:j.so})}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>{(j.art_name||'Job')} <span style={{color:'#94a3b8',fontWeight:600}}>· {(j.deco_type||'').replace(/_/g,' ')}</span></div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{j.customer} · {j.so_id}{j.assigned_to?' · '+j.assigned_to:''}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                {j.total_units>0&&<div style={{fontSize:12,fontWeight:700}}>{j.total_units} pc</div>}
                <div style={{fontSize:11,color:'#64748b'}}>{fmtDate(j.so?.expected_date)}</div>
              </div>
            </div>
          </div>)}
        </div>)}
      </div>;
    }
    if(subPage==='warehouse')return renderWarehouse();
    if(subPage==='reports'){
      const now=new Date();
      const myCustIds=new Set(cust.filter(c=>c.primary_rep_id===cu.id).map(c=>c.id));
      const mine=reportScope==='mine'&&myCustIds.size>0;
      const inScope=(custId)=>!mine||myCustIds.has(custId);
      const sameMonth=d=>{if(!d)return false;const t=new Date(d);return t.getMonth()===now.getMonth()&&t.getFullYear()===now.getFullYear()};
      const qStart=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);
      const inQuarter=d=>{if(!d)return false;const t=new Date(d);return t>=qStart&&t<=now};
      const scopedInvs=invs.filter(i=>inScope(i.customer_id));
      const scopedSOs=sos.filter(s=>inScope(s.customer_id));
      // Revenue = sales booked (SO revenue) by period, matching the home MTD figure.
      const soRev=s=>calcOrderTotals(s,custObj(s.customer_id)?.tax_rate||0).rev;
      const booked=scopedSOs.filter(s=>(s.status||'')!=='cancelled');
      const monthRev=booked.filter(s=>sameMonth(s.created_at)).reduce((a,s)=>a+soRev(s),0);
      const qtrRev=booked.filter(s=>inQuarter(s.created_at)).reduce((a,s)=>a+soRev(s),0);
      const openSOs=scopedSOs.filter(s=>!['completed','shipped','cancelled'].includes(s.status||''));
      const statusCounts={};openSOs.forEach(s=>{const k=s.status||'new';statusCounts[k]=(statusCounts[k]||0)+1});
      const scopedEsts=ests.filter(e=>inScope(e.customer_id));
      const wonQtr=scopedEsts.filter(e=>(e.status==='won'||e.status==='approved')&&inQuarter(e.updated_at||e.created_at)).length;
      const openEsts=scopedEsts.filter(e=>['draft','pending','sent'].includes(e.status||'draft')).length;
      const revByCust={};scopedInvs.forEach(i=>{revByCust[i.customer_id]=(revByCust[i.customer_id]||0)+(i.total||0)});
      const topCust=Object.entries(revByCust).map(([id,v])=>({c:custObj(id),v})).filter(x=>x.c).sort((a,b)=>b.v-a.v).slice(0,8);
      const openInvList=scopedInvs.filter(i=>i.status!=='paid'&&i.status!=='cancelled');
      const bal=i=>(i.total||0)-(i.amount_paid||0);
      const arTotal=openInvList.reduce((a,i)=>a+bal(i),0);
      const aging={current:0,d30:0,d60:0,d90:0};
      openInvList.forEach(i=>{const due=i.due_date?new Date(i.due_date):null;const past=due?Math.floor((now-due)/(1000*60*60*24)):0;const b=bal(i);if(!due||past<=0)aging.current+=b;else if(past<=30)aging.d30+=b;else if(past<=60)aging.d60+=b;else aging.d90+=b});
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Reports</div>
        </div>
        {/* Scope toggle */}
        <div className="mp-filter-row">
          <button className={`mp-filter-btn${reportScope==='mine'?' active':''}`} onClick={()=>setReportScope('mine')}>My Customers</button>
          <button className={`mp-filter-btn${reportScope==='all'?' active':''}`} onClick={()=>setReportScope('all')}>Company</button>
        </div>
        {reportScope==='mine'&&myCustIds.size===0&&<div style={{fontSize:12,color:'#94a3b8',marginBottom:8}}>No customers assigned to you — showing company-wide.</div>}
        {/* Sales performance */}
        <div className="mp-section-title">Sales Performance</div>
        <div className="mp-stats-grid">
          <div className="mp-stat-card"><div className="mp-stat-num" style={{color:'#16a34a'}}>{fmtMoney(monthRev)}</div><div className="mp-stat-label">Revenue (Month)</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num" style={{color:'#16a34a'}}>{fmtMoney(qtrRev)}</div><div className="mp-stat-label">Revenue (Quarter)</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num">{wonQtr}</div><div className="mp-stat-label">Won Est. (Qtr)</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num">{openEsts}</div><div className="mp-stat-label">Open Estimates</div></div>
        </div>
        {/* Open orders / production */}
        <div className="mp-section-title">Open Orders ({openSOs.length})</div>
        {Object.keys(statusCounts).length===0&&<div style={{fontSize:13,color:'#94a3b8',padding:'4px 0 8px'}}>No open orders.</div>}
        {Object.keys(statusCounts).length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8}}>
          {Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).map(([st,n])=><div key={st} className="mp-list-card" style={{flex:'1 1 calc(50% - 4px)',display:'flex',justifyContent:'space-between',alignItems:'center',margin:0}}>
            <span style={statusBadge(st)}>{st.replace('_',' ')}</span><span style={{fontWeight:800,fontSize:16}}>{n}</span>
          </div>)}
        </div>}
        {/* Top customers */}
        <div className="mp-section-title">Top Customers</div>
        {topCust.length===0&&<div style={{fontSize:13,color:'#94a3b8',padding:'4px 0 8px'}}>No revenue yet.</div>}
        {topCust.map(({c,v},i)=><div key={c.id} className="mp-list-card" onClick={()=>setDetail({type:'customer',data:c})} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',gap:10,alignItems:'center',minWidth:0}}>
            <span style={{fontWeight:800,color:'#94a3b8',fontSize:13,width:18,flexShrink:0}}>{i+1}</span>
            <div style={{minWidth:0}}><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>{c.alpha_tag&&<div style={{fontSize:11,color:'#94a3b8'}}>{c.alpha_tag}</div>}</div>
          </div>
          <div style={{fontWeight:700,fontSize:14,color:'#16a34a',flexShrink:0}}>{fmtMoney(v)}</div>
        </div>)}
        {/* AR / open invoices */}
        <div className="mp-section-title">Accounts Receivable</div>
        <div style={{background:'#0f172a',borderRadius:12,padding:'12px 14px',marginBottom:8,color:'white'}}>
          <div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>OUTSTANDING ({openInvList.length} invoices)</div>
          <div style={{fontSize:24,fontWeight:800}}>{fmtMoney(arTotal)}</div>
        </div>
        <div className="mp-stats-grid">
          <div className="mp-stat-card"><div className="mp-stat-num" style={{fontSize:16}}>{fmtMoney(aging.current)}</div><div className="mp-stat-label">Current</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num" style={{fontSize:16,color:'#d97706'}}>{fmtMoney(aging.d30)}</div><div className="mp-stat-label">1–30 Past</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num" style={{fontSize:16,color:'#ea580c'}}>{fmtMoney(aging.d60)}</div><div className="mp-stat-label">31–60 Past</div></div>
          <div className="mp-stat-card"><div className="mp-stat-num" style={{fontSize:16,color:'#dc2626'}}>{fmtMoney(aging.d90)}</div><div className="mp-stat-label">60+ Past</div></div>
        </div>
      </div>;
    }
    // More menu grid
    return<div className="mp-page">
      <div className="mp-page-title">More</div>
      <div className="mp-more-grid">
        <div className="mp-more-item" onClick={()=>setSubPage('estimates')}>
          <div className="mp-more-icon"><MIcon name="dollar" size={22}/></div>
          <div>Estimates</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('invoices')}>
          <div className="mp-more-icon"><MIcon name="file" size={22}/></div>
          <div>Invoices</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('inventory')}>
          <div className="mp-more-icon" style={{color:'#16a34a'}}><MIcon name="warehouse" size={22}/></div>
          <div>Inventory</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('jobs')}>
          <div className="mp-more-icon"><MIcon name="grid" size={22}/></div>
          <div>Jobs</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('production')}>
          <div className="mp-more-icon" style={{color:'#7c3aed'}}><MIcon name="grid" size={22}/></div>
          <div>Production</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('warehouse')}>
          <div className="mp-more-icon" style={{color:'#d97706'}}><MIcon name="box" size={22}/></div>
          <div>Warehouse</div>
        </div>
        <div className="mp-more-item" onClick={()=>setSubPage('reports')}>
          <div className="mp-more-icon" style={{color:'#2563eb'}}><MIcon name="dollar" size={22}/></div>
          <div>Reports</div>
        </div>
        <div className="mp-more-item" onClick={onSwitchDesktop}>
          <div className="mp-more-icon"><MIcon name="monitor" size={22}/></div>
          <div>Desktop View</div>
        </div>
      </div>
      <div className="mp-user-card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontWeight:700,fontSize:15}}>{cu.name}</div><div style={{fontSize:12,color:'#64748b',textTransform:'capitalize'}}>{cu.role}</div></div>
          <button className="mp-logout-btn" onClick={onLogout}>Log Out</button>
        </div>
      </div>
    </div>;
  };

  // ─── SEARCH OVERLAY ───
  const renderSearch=()=>{
    return<div className="mp-search-overlay">
      <div className="mp-search-bar">
        <MIcon name="search" size={18}/>
        <input autoFocus placeholder="Search orders, customers, estimates..." value={q} onChange={e=>setQ(e.target.value)} className="mp-search-input-full"/>
        <button onClick={()=>{setShowSearch(false);setQ('')}} className="mp-search-cancel">Cancel</button>
      </div>
      {searchResults&&<div className="mp-search-results">
        {searchResults.orders.length>0&&<><div className="mp-search-section">Orders</div>
          {searchResults.orders.map(so=>{const cc=custObj(so.customer_id);return<div key={so.id} className="mp-search-item" onClick={()=>{setDetail({type:'order',data:so});setShowSearch(false);setQ('')}}>
            <span style={{fontWeight:700,color:'#1e40af'}}>{so.id}</span><span style={{color:'#64748b',marginLeft:8}}>{cc?.alpha_tag||cc?.name||''}</span>
            <span style={{...statusBadge(so.status||'new'),marginLeft:'auto'}}>{so.status||'new'}</span>
          </div>})}</>}
        {searchResults.estimates.length>0&&<><div className="mp-search-section">Estimates</div>
          {searchResults.estimates.map(e=>{const cc=custObj(e.customer_id);return<div key={e.id} className="mp-search-item" onClick={()=>{setDetail({type:'estimate',data:e});setShowSearch(false);setQ('')}}>
            <span style={{fontWeight:700,color:'#1e40af'}}>{e.id}</span><span style={{color:'#64748b',marginLeft:8}}>{cc?.alpha_tag||cc?.name||''}</span>
          </div>})}</>}
        {searchResults.customers.length>0&&<><div className="mp-search-section">Customers</div>
          {searchResults.customers.map(cc=><div key={cc.id} className="mp-search-item" onClick={()=>{setDetail({type:'customer',data:cc});setShowSearch(false);setQ('')}}>
            <span style={{fontWeight:700}}>{cc.name}</span>{cc.alpha_tag&&<span style={{color:'#64748b',marginLeft:8}}>{cc.alpha_tag}</span>}
          </div>)}</>}
        {searchResults.invoices.length>0&&<><div className="mp-search-section">Invoices</div>
          {searchResults.invoices.map(inv=><div key={inv.id} className="mp-search-item" onClick={()=>{setDetail({type:'invoice',data:inv});setShowSearch(false);setQ('')}}>
            <span style={{fontWeight:700,color:'#1e40af'}}>{inv.id}</span><span style={{color:'#64748b',marginLeft:8}}>{fmtMoney(inv.total)}</span>
            <span style={{...statusBadge(inv.status||'open'),marginLeft:'auto'}}>{inv.status||'open'}</span>
          </div>)}</>}
        {searchResults.orders.length===0&&searchResults.estimates.length===0&&searchResults.customers.length===0&&searchResults.invoices.length===0&&q.length>=2&&
          <div style={{padding:20,textAlign:'center',color:'#94a3b8',fontSize:14}}>No results found</div>}
      </div>}
    </div>;
  };

  // ─── SEND ESTIMATE MODAL ───
  const renderSendEstModal=()=>{
    if(!sendEstModal)return null;
    const est=sendEstModal;
    const cc=custObj(est.customer_id);
    const estUrl=window.location.origin+'/?estimate='+est.id;
    const copyLink=()=>{navigator.clipboard.writeText(estUrl).then(()=>{if(nf)nf('Link copied to clipboard');setSendEstModal(null)}).catch(()=>{window.prompt('Copy this link:',estUrl);setSendEstModal(null)})};
    const emailEst=()=>{
      const acct=(cc?.contacts||[]).find(c=>c.role==='Coach')||(cc?.contacts||[])[0];
      const toEmail=acct?.email||cc?.email||'';
      const subject='Estimate '+est.id+(est.memo?' — '+est.memo:'');
      const body='Hi '+(acct?.name||cc?.name||'')+',\n\nPlease review your estimate: '+estUrl+'\n\nThank you,\nNSA Team';
      window.location.href='mailto:'+toEmail+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
      setSendEstModal(null);
    };
    return<div style={{position:'fixed',inset:0,zIndex:110,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>setSendEstModal(null)}>
      <div style={{background:'white',borderRadius:'16px 16px 0 0',padding:'20px 16px',width:'100%',maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div style={{width:40,height:4,borderRadius:2,background:'#cbd5e1',margin:'0 auto 16px'}}/>
        <div style={{fontSize:16,fontWeight:800,color:'#0f172a',marginBottom:4}}>Send {est.id}</div>
        <div style={{fontSize:13,color:'#64748b',marginBottom:16}}>{cc?.name||'No customer'}{est.memo?' — '+est.memo:''}</div>
        <button onClick={emailEst} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'14px 16px',background:'#1e40af',color:'white',border:'none',borderRadius:12,fontSize:15,fontWeight:700,cursor:'pointer',marginBottom:10,minHeight:48}}>
          <MIcon name="mail" size={20}/> Email PDF
        </button>
        <button onClick={copyLink} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'14px 16px',background:'#f1f5f9',color:'#1e293b',border:'1px solid #e2e8f0',borderRadius:12,fontSize:15,fontWeight:700,cursor:'pointer',marginBottom:10,minHeight:48}}>
          <MIcon name="file" size={20}/> Copy Shareable Link
        </button>
        <button onClick={()=>setSendEstModal(null)} style={{width:'100%',padding:'12px',background:'none',border:'none',color:'#64748b',fontSize:14,fontWeight:600,cursor:'pointer'}}>Cancel</button>
      </div>
    </div>;
  };

  // ─── COMPOSE MESSAGE ───
  const DEPTS=[{id:'all',label:'All',color:'#64748b'},{id:'art',label:'Art',color:'#7c3aed'},{id:'prod',label:'Production',color:'#2563eb'},{id:'whse',label:'Warehouse',color:'#d97706'},{id:'sales',label:'Sales',color:'#166534'},{id:'acct',label:'Accounting',color:'#dc2626'}];
  const activeMembers=(REPS||[]).filter(r=>r.is_active!==false);
  const extractTaggedIds=(text)=>{const ids=[];const regex=/@(\w[\w\s]*?)(?=\s@|\s*$|[.,!?;:]|\s(?=[^@]))/g;let match;while((match=regex.exec(text))!==null){const name=match[1].trim();const member=activeMembers.find(r=>r.name.toLowerCase()===name.toLowerCase()||r.name.split(' ')[0].toLowerCase()===name.toLowerCase());if(member&&!ids.includes(member.id))ids.push(member.id)}return ids};

  const sendMessage=()=>{
    if(!composeTxt.trim()||!onMsg)return;
    const tagged=extractTaggedIds(composeTxt);
    const isSO=composeMsg?.entity_type==='so';
    const nm={id:'m'+Date.now(),so_id:isSO?composeMsg.entity_id:null,author_id:cu.id,text:composeTxt.trim(),ts:new Date().toLocaleString(),created_at:new Date().toISOString(),read_by:[cu.id],dept:composeDept,tagged_members:tagged,entity_type:composeMsg?.entity_type||'so',entity_id:composeMsg?.entity_id||null,thread_id:composeMsg?.replyTo||null};
    onMsg(prev=>Array.isArray(prev)?[...prev,nm]:[nm]);
    if(nf)nf('Message sent');
    setComposeTxt('');setComposeDept('all');setComposeMentionQ(null);
    // Stay on compose if replying in thread, otherwise close
    if(!composeMsg?.replyTo)setComposeMsg(null);
  };

  const handleComposeInput=(text)=>{
    setComposeTxt(text);
    // Detect @mention
    const atIdx=text.lastIndexOf('@');
    if(atIdx>=0){
      const after=text.slice(atIdx+1);
      if(!after.includes(' ')||after.split(' ').length<=2){setComposeMentionQ(after)}
      else{setComposeMentionQ(null)}
    }else{setComposeMentionQ(null)}
  };

  const insertMention=(member)=>{
    const atIdx=composeTxt.lastIndexOf('@');
    if(atIdx>=0){setComposeTxt(composeTxt.slice(0,atIdx)+'@'+member.name+' ')}
    else{setComposeTxt(composeTxt+'@'+member.name+' ')}
    setComposeMentionQ(null);
  };

  const renderComposeSheet=()=>{
    if(!composeMsg)return null;
    const soLabel=composeMsg.entity_id||'New Message';
    const mentionResults=composeMentionQ!=null?activeMembers.filter(r=>{const q2=composeMentionQ.toLowerCase();return r.name.toLowerCase().includes(q2)||r.name.split(' ')[0].toLowerCase().startsWith(q2)}).slice(0,6):[];
    // Show existing messages for this entity as thread context
    const threadMsgs=composeMsg.entity_id?msgs.filter(m=>(m.entity_id===composeMsg.entity_id||m.so_id===composeMsg.entity_id)).sort((a,b)=>(a.created_at||a.ts||'').localeCompare(b.created_at||b.ts||'')):[];

    return<div style={{position:'fixed',inset:0,zIndex:100,background:'white',display:'flex',flexDirection:'column'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderBottom:'1px solid #e2e8f0',background:'#f8fafc',flexShrink:0}}>
        <button onClick={()=>{setComposeMsg(null);setComposeTxt('');setComposeDept('all');setComposeMentionQ(null)}} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',padding:4}}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15}}>{soLabel}</div><div style={{fontSize:11,color:'#94a3b8'}}>{composeMsg.replyTo?'Reply':'New message'}</div></div>
      </div>
      {/* Thread context — scrollable */}
      <div style={{flex:1,overflowY:'auto',padding:'8px 12px'}}>
        {threadMsgs.length>0&&<div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',marginBottom:8}}>Conversation ({threadMsgs.length})</div>
          {threadMsgs.map(m=>{
            const isMe=m.author_id===cu.id;
            const a=REPS.find(r=>r.id===m.author_id||r.id===m.from);
            const initials=(a?.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
            return<div key={m.id} style={{display:'flex',gap:8,marginBottom:10,flexDirection:isMe?'row-reverse':'row',alignItems:'flex-start'}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:isMe?'#1e40af':'#e2e8f0',color:isMe?'white':'#475569',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:10,flexShrink:0}}>{initials}</div>
              <div style={{maxWidth:'80%'}}>
                <div style={{fontSize:10,color:'#94a3b8',marginBottom:2}}>{a?.name||'Unknown'} · {timeAgo(m.created_at||m.ts)}{m.dept&&m.dept!=='all'?' · '+m.dept:''}</div>
                <div style={{padding:'8px 12px',borderRadius:isMe?'12px 12px 2px 12px':'12px 12px 12px 2px',background:isMe?'#1e40af':'#f1f5f9',color:isMe?'white':'#1e293b',fontSize:13,lineHeight:1.5,whiteSpace:'pre-wrap'}}>{m.body||m.text||''}</div>
              </div>
            </div>})}
        </div>}
        {threadMsgs.length===0&&!composeMsg.entity_id&&<div style={{textAlign:'center',color:'#94a3b8',padding:30,fontSize:13}}>Start a new conversation</div>}
      </div>
      {/* Compose area — sticky bottom */}
      <div style={{borderTop:'1px solid #e2e8f0',background:'white',padding:'8px 12px',paddingBottom:'max(8px, env(safe-area-inset-bottom))',flexShrink:0}}>
        {/* Department chips */}
        <div style={{display:'flex',gap:4,marginBottom:8,overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
          {DEPTS.map(d=><button key={d.id} onClick={()=>setComposeDept(d.id)} style={{padding:'4px 10px',borderRadius:12,border:'1px solid '+(composeDept===d.id?d.color:'#e2e8f0'),background:composeDept===d.id?d.color+'15':'white',color:composeDept===d.id?d.color:'#94a3b8',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',minHeight:32}}>{d.label}</button>)}
        </div>
        {/* @mention suggestions */}
        {mentionResults.length>0&&<div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:10,marginBottom:6,maxHeight:160,overflowY:'auto',boxShadow:'0 -4px 12px rgba(0,0,0,0.08)'}}>
          {mentionResults.map(r=><button key={r.id} onClick={()=>insertMention(r)} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',width:'100%',background:'none',border:'none',borderBottom:'1px solid #f1f5f9',cursor:'pointer',textAlign:'left',minHeight:40}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'#dbeafe',color:'#1e40af',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:10}}>{r.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
            <div><div style={{fontSize:13,fontWeight:600}}>{r.name}</div><div style={{fontSize:10,color:'#94a3b8',textTransform:'capitalize'}}>{r.role}</div></div>
          </button>)}
        </div>}
        {/* Input + send */}
        <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
          <textarea value={composeTxt} onChange={e=>handleComposeInput(e.target.value)} placeholder="Type a message... Use @ to mention" rows={2}
            style={{flex:1,border:'1px solid #e2e8f0',borderRadius:12,padding:'10px 12px',fontSize:14,resize:'none',minHeight:44,maxHeight:120,fontFamily:'inherit'}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}}/>
          <button onClick={sendMessage} disabled={!composeTxt.trim()} style={{width:44,height:44,borderRadius:12,background:composeTxt.trim()?'#1e40af':'#e2e8f0',color:composeTxt.trim()?'white':'#94a3b8',border:'none',cursor:composeTxt.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>;
  };

  // ─── HAMBURGER DRAWER ───
  const renderDrawer=()=>{
    const navItems=[
      {id:'home',label:'Home',icon:'home'},
      {id:'orders',label:'Sales Orders',icon:'box'},
      {id:'messages',label:'Messages',icon:'mail',badge:unreadForMeCount},
      {id:'customers',label:'Customers',icon:'users'},
      {id:'estimates',label:'Estimates',icon:'dollar',sub:true},
      {id:'invoices',label:'Invoices',icon:'file',sub:true},
      {id:'inventory',label:'Inventory',icon:'warehouse',sub:true},
      {id:'jobs',label:'Jobs',icon:'grid',sub:true},
      {id:'production',label:'Production',icon:'package',sub:true},
      {id:'warehouse',label:'Warehouse',icon:'box',sub:true},
      {id:'reports',label:'Reports',icon:'dollar',sub:true},
    ];
    return<>
      <div className={`mp-drawer-backdrop${drawerOpen?' open':''}`} onClick={()=>setDrawerOpen(false)}/>
      <div className={`mp-drawer${drawerOpen?' open':''}`}>
        <div style={{padding:'20px 16px',borderBottom:'1px solid #1e293b',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <img src="/NEW NSA Logo on white.png" alt="NSA" style={{height:28,filter:'brightness(0) invert(1)'}}/>
          <button onClick={()=>setDrawerOpen(false)} style={{background:'none',border:'none',color:'#94a3b8',fontSize:20,cursor:'pointer',padding:4}}><MIcon name="x" size={20}/></button>
        </div>
        <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
          {navItems.map(item=>{
            const isActive=(item.sub&&moreSubPage===item.id&&tab==='more')||(!item.sub&&tab===item.id);
            return<button key={item.id} onClick={()=>{
              setDrawerOpen(false);setDetail(null);
              if(item.sub){setTab('more');setMoreSubPage(item.id)}
              else{setTab(item.id);setMoreSubPage(null)}
            }} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',width:'100%',background:isActive?'#1e3a5f':'transparent',color:isActive?'white':'#94a3b8',border:'none',fontSize:14,fontWeight:isActive?700:500,cursor:'pointer',textAlign:'left',minHeight:44,borderRight:isActive?'3px solid #3b82f6':'none'}}>
              <MIcon name={item.icon} size={18}/>{item.label}
              {item.badge>0&&<span style={{marginLeft:'auto',background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:800,minWidth:18,textAlign:'center'}}>{item.badge}</span>}
            </button>})}
        </nav>
        <div style={{padding:'12px 16px',borderTop:'1px solid #1e293b'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div><div style={{fontWeight:600,color:'#e2e8f0',fontSize:13}}>{cu.name}</div><div style={{color:'#64748b',fontSize:11,textTransform:'capitalize'}}>{cu.role}</div></div>
            <div style={{display:'flex',gap:4}}>
              <button onClick={()=>{setDrawerOpen(false);onSwitchDesktop()}} style={{background:'none',border:'1px solid #475569',borderRadius:6,padding:'4px 8px',color:'#94a3b8',cursor:'pointer',fontSize:10,minHeight:32}}>Desktop</button>
              <button onClick={()=>{setDrawerOpen(false);onLogout()}} style={{background:'none',border:'1px solid #475569',borderRadius:6,padding:'4px 8px',color:'#94a3b8',cursor:'pointer',fontSize:10,minHeight:32}}>Log Out</button>
            </div>
          </div>
        </div>
      </div>
    </>;
  };

  // ─── MAIN RENDER ───
  return<div className="mp-app">
    {renderDrawer()}
    {showSearch&&renderSearch()}
    {renderSendEstModal()}
    {renderComposeSheet()}
    {/* Header */}
    <div className="mp-header">
      <button className="mp-header-btn" onClick={()=>setDrawerOpen(true)} style={{marginRight:8}}><MIcon name="menu" size={22}/></button>
      <div style={{flex:1,fontWeight:700,fontSize:16}}>{tab==='home'?'Home':tab==='orders'?'Orders':tab==='messages'?'Messages':tab==='customers'?'Customers':moreSubPage||'More'}</div>
      <div style={{display:'flex',gap:4,alignItems:'center'}}>
        {unreadForMeCount>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:800,minWidth:18,textAlign:'center'}}>{unreadForMeCount}</span>}
        <button className="mp-header-btn" onClick={()=>setShowSearch(true)}><MIcon name="search" size={20}/></button>
      </div>
    </div>
    {/* Page content */}
    <div className="mp-content">
      {tab==='home'&&renderHome()}
      {tab==='orders'&&renderOrders()}
      {tab==='messages'&&renderMessages()}
      {tab==='customers'&&renderCustomers()}
      {tab==='more'&&renderMore()}
    </div>
    {/* Bottom tab bar */}
    <div className="mp-tabbar">
      <button className={`mp-tab${tab==='home'?' active':''}`} onClick={()=>{setTab('home');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="home" size={20}/><span className="mp-tab-label">Home</span>
      </button>
      <button className={`mp-tab${tab==='orders'?' active':''}`} onClick={()=>{setTab('orders');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="box" size={20}/><span className="mp-tab-label">Orders</span>
      </button>
      <button className="mp-tab mp-tab-new" onClick={startNewEstimate}>
        <div className="mp-tab-new-btn"><MIcon name="plus" size={22}/></div>
        <span className="mp-tab-label">New Est.</span>
      </button>
      <button className={`mp-tab${tab==='messages'?' active':''}`} onClick={()=>{setTab('messages');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="mail" size={20}/><span className="mp-tab-label">Messages</span>
        {unreadForMeCount>0&&<span className="mp-tab-badge">{unreadForMeCount}</span>}
      </button>
      <button className={`mp-tab${tab==='more'?' active':''}`} onClick={()=>{setTab('more');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="menu" size={20}/><span className="mp-tab-label">More</span>
      </button>
    </div>
  </div>;
}
