/* eslint-disable */
import React, { useState, useMemo } from 'react';

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

// ═══════════════════════════════════════════
// MOBILE PORTAL COMPONENT
// ═══════════════════════════════════════════
export default function MobilePortal({cu,cust,sos,ests,invs,msgs,prod,vend,REPS,assignedTodos=[],onLogout,onSwitchDesktop,onNewEstimate,nf}){
  const[tab,setTab]=useState('home');
  const[q,setQ]=useState('');
  const[showSearch,setShowSearch]=useState(false);
  const[detail,setDetail]=useState(null);
  // Filters & sorts (lifted to top level)
  const[ordersFilter,setOrdersFilter]=useState('active');
  const[ordersSort,setOrdersSort]=useState('newest');
  const[estsFilter,setEstsFilter]=useState('pending');
  const[estsSort,setEstsSort]=useState('newest');
  const[invsFilter,setInvsFilter]=useState('open');
  const[invsSort,setInvsSort]=useState('newest');
  const[custQ,setCustQ]=useState('');
  const[moreSubPage,setMoreSubPage]=useState(null);
  // Messages filter
  const[msgFilter,setMsgFilter]=useState('for_me');

  // Derived data
  const repName=(id)=>{const r=REPS.find(x=>x.id===id);return r?r.name:'—'};
  const custObj=(id)=>cust.find(x=>x.id===id);

  // Messages computed
  const myUnreadMsgs=useMemo(()=>msgs.filter(m=>!(m.read_by||[]).includes(cu.id)&&(m.tagged_members||[]).includes(cu.id)),[msgs,cu.id]);
  const allUnreadMsgs=useMemo(()=>msgs.filter(m=>!(m.read_by||[]).includes(cu.id)),[msgs,cu.id]);
  const unreadForMeCount=myUnreadMsgs.length;
  const unreadAllCount=allUnreadMsgs.length;

  // My todos
  const myTodos=useMemo(()=>(assignedTodos||[]).filter(t=>t.status==='open'&&(t.assigned_to===cu.id||t.created_by===cu.id)).sort((a,b)=>(a.priority||9)-(b.priority||9)),[assignedTodos,cu.id]);

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
    const activeOrders=sos.filter(s=>!['completed','shipped','cancelled'].includes(s.status||''));
    const openInvoices=invs.filter(i=>i.status!=='paid'&&i.status!=='cancelled');
    const monthRevenue=invs.filter(i=>i.status==='paid'&&thisMonth(i.paid_date||i.created_at)).reduce((a,i)=>a+(i.total||0),0);
    const urgentOrders=sos.filter(s=>{if(['completed','shipped','cancelled'].includes(s.status||''))return false;if(!s.expected_date)return false;const days=Math.ceil((new Date(s.expected_date)-now)/(1000*60*60*24));return days<=3&&days>=0});
    return{activeOrders:activeOrders.length,openInvoices:openInvoices.length,monthRevenue,urgentOrders:urgentOrders.length};
  },[sos,invs]);

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
          <div className="mp-info-item"><div className="mp-info-label">Phone</div><div className="mp-info-val">{cc.phone||'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Email</div><div className="mp-info-val" style={{fontSize:12,wordBreak:'break-all'}}>{cc.email||'—'}</div></div>
          <div className="mp-info-item"><div className="mp-info-label">Orders</div><div className="mp-info-val">{custSOs.length}</div></div>
        </div>
        {cc.notes&&<div className="mp-memo">{cc.notes}</div>}
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

  // ─── DETAIL VIEW (MESSAGE) ───
  const renderMsgDetail=(msg)=>{
    return<div className="mp-detail">
      <div className="mp-detail-header">
        <button className="mp-back-btn" onClick={()=>setDetail(null)}><MIcon name="back" size={22}/></button>
        <div style={{flex:1}}><div className="mp-detail-id">{repName(msg.from)}</div><div className="mp-detail-sub">{fmtDate(msg.created_at)} · {timeAgo(msg.created_at)}</div></div>
      </div>
      <div className="mp-detail-body">
        <div style={{fontSize:15,lineHeight:1.6,color:'#1e293b',whiteSpace:'pre-wrap'}}>{msg.body||msg.text||'(no content)'}</div>
        {msg.so_id&&<div className="mp-list-card" style={{marginTop:16}} onClick={()=>{const so=sos.find(s=>s.id===msg.so_id);if(so)setDetail({type:'order',data:so})}}>
          <div style={{fontSize:12,color:'#64748b'}}>Related Order</div>
          <div style={{fontWeight:700,color:'#1e40af'}}>{msg.so_id}</div>
        </div>}
      </div>
    </div>;
  };

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
      <div className="mp-greeting">
        <div className="mp-greeting-text">Welcome, {cu.name?.split(' ')[0]}</div>
        <div className="mp-greeting-sub">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      </div>
      {/* Quick stats */}
      <div className="mp-stats-grid">
        <div className="mp-stat-card" onClick={()=>setTab('orders')}>
          <div className="mp-stat-num">{stats.activeOrders}</div><div className="mp-stat-label">Active Orders</div>
        </div>
        <div className="mp-stat-card" onClick={()=>setTab('messages')}>
          <div className="mp-stat-num" style={unreadForMeCount>0?{color:'#dc2626'}:{}}>{unreadForMeCount}</div><div className="mp-stat-label">Messages for Me</div>
        </div>
        <div className="mp-stat-card">
          <div className="mp-stat-num">{stats.openInvoices}</div><div className="mp-stat-label">Open Invoices</div>
        </div>
        <div className="mp-stat-card">
          <div className="mp-stat-num" style={{color:'#16a34a'}}>{fmtMoney(stats.monthRevenue)}</div><div className="mp-stat-label">Month Revenue</div>
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
      {myTodos.slice(0,10).map(t=>{
        const isAssignedToMe=t.assigned_to===cu.id;
        return<div key={t.id} className="mp-list-card">
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <div style={{width:4,minHeight:36,borderRadius:2,background:priColors[t.priority]||'#94a3b8',flexShrink:0,marginTop:2}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>{t.title}</div>
              {t.description&&<div style={{fontSize:12,color:'#64748b',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.description}</div>}
              <div style={{display:'flex',gap:8,marginTop:4,fontSize:11,color:'#94a3b8'}}>
                <span>{isAssignedToMe?'Assigned to you':'Created by you'}</span>
                <span>· {timeAgo(t.created_at)}</span>
                {t.so_id&&<span>· {t.so_id}</span>}
              </div>
            </div>
          </div>
        </div>})}
    </div>;
  };

  // ─── ORDERS TAB ───
  const filteredOrders=useMemo(()=>{
    let list=sos;
    if(ordersFilter==='active')list=sos.filter(s=>!['completed','shipped','cancelled'].includes(s.status||''));
    else if(ordersFilter==='completed')list=sos.filter(s=>['completed','shipped'].includes(s.status||''));
    else if(ordersFilter==='hold')list=sos.filter(s=>(s.status||'')==='hold');
    return sortList(list,ordersSort);
  },[sos,ordersFilter,ordersSort]);
  const renderOrders=()=>{
    return<div className="mp-page">
      <div className="mp-page-title">Sales Orders</div>
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
              <div style={{fontSize:13,color:'#334155',marginTop:2}}>{cc?.alpha_tag||cc?.name||'—'}</div>
              {so.memo&&<div style={{fontSize:12,color:'#94a3b8',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
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
      {filtered.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:30,fontSize:13}}>{msgFilter==='for_me'?'No unread messages for you':'No messages'}</div>}
      {filtered.map(m=>{const isUnread=!(m.read_by||[]).includes(cu.id);const isForMe=(m.tagged_members||[]).includes(cu.id);
        return<div key={m.id} className="mp-list-card" style={isUnread?{borderLeft:'3px solid '+(isForMe?'#dc2626':'#2563eb')}:{}} onClick={()=>setDetail({type:'message',data:m})}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontWeight:isUnread?800:600,fontSize:13}}>{repName(m.from)}</span>
                {isForMe&&isUnread&&<span style={{fontSize:9,background:'#fee2e2',color:'#dc2626',padding:'1px 6px',borderRadius:8,fontWeight:700}}>@you</span>}
              </div>
              <div style={{fontSize:12,color:'#64748b',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(m.body||m.text||'').slice(0,80)}</div>
              {m.so_id&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{m.so_id}</div>}
            </div>
            <div style={{fontSize:11,color:'#94a3b8',flexShrink:0,marginLeft:8}}>{timeAgo(m.created_at)}</div>
          </div>
        </div>})}
    </div>;
  };

  // ─── CUSTOMERS TAB ───
  const filteredCust=useMemo(()=>{
    let list=cust;
    if(custQ.length>=2){const s=custQ.toLowerCase();list=list.filter(c=>(c.name+' '+(c.alpha_tag||'')+' '+(c.email||'')+' '+(c.phone||'')).toLowerCase().includes(s))}
    return list.sort((a,b)=>a.name.localeCompare(b.name));
  },[cust,custQ]);
  const renderCustomers=()=>{
    return<div className="mp-page">
      <div className="mp-page-title">Customers</div>
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

  // ─── MORE TAB (hamburger) ───
  const renderMore=()=>{
    const subPage=moreSubPage;const setSubPage=setMoreSubPage;
    if(subPage==='estimates'){
      const filteredE=(()=>{
        let list=ests;
        if(estsFilter==='pending')list=ests.filter(e=>['draft','pending','sent'].includes(e.status||'draft'));
        else if(estsFilter==='won')list=ests.filter(e=>e.status==='won'||e.status==='approved');
        else if(estsFilter==='lost')list=ests.filter(e=>e.status==='lost'||e.status==='expired');
        return sortList(list,estsSort);
      })();
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Estimates</div>
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
                <div style={{fontSize:13,color:'#334155',marginTop:2}}>{cc?.alpha_tag||cc?.name||'—'}</div>
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
        let list=invs;
        if(invsFilter==='open')list=invs.filter(i=>i.status!=='paid'&&i.status!=='cancelled');
        else if(invsFilter==='paid')list=invs.filter(i=>i.status==='paid');
        else if(invsFilter==='overdue')list=invs.filter(i=>{if(i.status==='paid'||i.status==='cancelled')return false;if(!i.due_date)return false;return new Date(i.due_date)<new Date()});
        return sortList(list,invsSort);
      })();
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Invoices</div>
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
        {filteredI.map(inv=>{const cc=custObj(inv.customer_id);
          return<div key={inv.id} className="mp-list-card" onClick={()=>setDetail({type:'invoice',data:inv})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontWeight:700,color:'#1e40af'}}>{inv.id}</span>
                  <span style={statusBadge(inv.status||'open')}>{inv.status||'open'}</span>
                </div>
                <div style={{fontSize:12,color:'#64748b'}}>{cc?.alpha_tag||cc?.name||'—'}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontWeight:700}}>{fmtMoney(inv.total)}</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{fmtDate(inv.due_date||inv.created_at)}</div>
              </div>
            </div>
          </div>})}
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
      sos.forEach(so=>{const cc=custObj(so.customer_id);safeJobs(so).forEach((j,ji)=>{allJobs.push({...j,so,so_id:so.id,customer:cc?.alpha_tag||cc?.name||'—'})})});
      const activeJobs=allJobs.filter(j=>j.status!=='completed'&&j.status!=='shipped').sort((a,b)=>(b.so?.created_at||'').localeCompare(a.so?.created_at||''));
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Jobs ({activeJobs.length})</div>
        </div>
        {activeJobs.slice(0,30).map((j,i)=><div key={i} className="mp-list-card" onClick={()=>{if(j.so)setDetail({type:'order',data:j.so})}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontWeight:700,color:'#1e40af',fontSize:13}}>{j.id||'Job'}</span>
                <span style={statusBadge(j.status||'pending')}>{j.status||'pending'}</span>
              </div>
              <div style={{fontSize:12,color:'#334155',marginTop:2}}>{j.deco_type||'—'} · {j.art_name||'—'}</div>
              <div style={{fontSize:11,color:'#94a3b8'}}>{j.customer} · {j.so_id}</div>
            </div>
          </div>
        </div>)}
      </div>;
    }
    if(subPage==='production'){
      const allJobs=[];
      sos.forEach(so=>{const cc=custObj(so.customer_id);safeJobs(so).forEach((j,ji)=>{allJobs.push({...j,so,so_id:so.id,customer:cc?.alpha_tag||cc?.name||'—'})})});
      const prodStatuses=['ready','in_process','staging','hold'];
      const prodJobs=allJobs.filter(j=>prodStatuses.includes(j.status)).sort((a,b)=>{
        const ord={hold:0,ready:1,in_process:2,staging:3};return(ord[a.status]||9)-(ord[b.status]||9)});
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Production ({prodJobs.length})</div>
        </div>
        <div className="mp-stats-grid" style={{marginBottom:12}}>
          {prodStatuses.map(st=>{const c=prodJobs.filter(j=>j.status===st).length;
            return<div key={st} className="mp-stat-card"><div className="mp-stat-num">{c}</div><div className="mp-stat-label" style={{textTransform:'capitalize'}}>{st.replace('_',' ')}</div></div>})}
        </div>
        {prodJobs.slice(0,40).map((j,i)=><div key={i} className="mp-list-card" onClick={()=>{if(j.so)setDetail({type:'order',data:j.so})}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontWeight:700,color:'#1e40af',fontSize:13}}>{j.id||'Job'}</span>
                <span style={statusBadge(j.status||'pending')}>{j.status||'pending'}</span>
              </div>
              <div style={{fontSize:13,color:'#334155',marginTop:2}}>{j.deco_type||'—'} · {j.art_name||'—'}</div>
              <div style={{fontSize:12,color:'#94a3b8'}}>{j.customer} · {j.so_id}</div>
            </div>
            <div style={{textAlign:'right',fontSize:11,color:'#64748b'}}>{fmtDate(j.so?.expected_date)}</div>
          </div>
        </div>)}
      </div>;
    }
    if(subPage==='warehouse'){
      const whOrders=sos.filter(s=>{
        if(['completed','shipped','cancelled'].includes(s.status||''))return false;
        const items=safeItems(s);return items.some(it=>(it.pick_lines||[]).some(pk=>pk.status==='pick'));
      }).sort((a,b)=>(a.expected_date||'9').localeCompare(b.expected_date||'9'));
      return<div className="mp-page">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <button className="mp-back-btn" onClick={()=>setSubPage(null)}><MIcon name="back" size={20}/></button>
          <div className="mp-page-title" style={{margin:0}}>Warehouse ({whOrders.length})</div>
        </div>
        {whOrders.length===0&&<div style={{textAlign:'center',color:'#94a3b8',padding:40,fontSize:14}}>No orders pending pick</div>}
        {whOrders.map(so=>{const cc=custObj(so.customer_id);const totalQty=safeItems(so).reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((s,v)=>s+v,0),0);
          const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
          const pickCount=safeItems(so).reduce((a,it)=>a+(it.pick_lines||[]).filter(pk=>pk.status==='pick').length,0);
          return<div key={so.id} className="mp-list-card" onClick={()=>setDetail({type:'order',data:so})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{so.id}</span>
                  <span style={{fontSize:11,background:'#fef3c7',color:'#92400e',padding:'2px 8px',borderRadius:10,fontWeight:700}}>{pickCount} to pull</span>
                </div>
                <div style={{fontSize:13,color:'#334155',marginTop:2}}>{cc?.alpha_tag||cc?.name||'—'}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:12,color:'#64748b'}}>{totalQty} pcs</div>
                {daysOut!=null&&<div style={{fontSize:11,fontWeight:700,color:daysOut<=3?'#dc2626':daysOut<=7?'#d97706':'#64748b'}}>{daysOut<=0?'DUE TODAY':daysOut+'d out'}</div>}
              </div>
            </div>
          </div>})}
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

  // ─── MAIN RENDER ───
  return<div className="mp-app">
    {showSearch&&renderSearch()}
    {/* Header */}
    <div className="mp-header">
      <div className="mp-header-logo">NSA</div>
      <button className="mp-header-btn" onClick={()=>setShowSearch(true)}><MIcon name="search" size={20}/></button>
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
      <button className="mp-tab mp-tab-new" onClick={onNewEstimate}>
        <div className="mp-tab-new-btn"><MIcon name="plus" size={22}/></div>
        <span className="mp-tab-label">New Est.</span>
      </button>
      <button className={`mp-tab${tab==='customers'?' active':''}`} onClick={()=>{setTab('customers');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="users" size={20}/><span className="mp-tab-label">Customers</span>
      </button>
      <button className={`mp-tab${tab==='more'?' active':''}`} onClick={()=>{setTab('more');setDetail(null);setMoreSubPage(null)}}>
        <MIcon name="menu" size={20}/><span className="mp-tab-label">More</span>
        {(unreadForMeCount>0)&&<span className="mp-tab-badge">{unreadForMeCount}</span>}
      </button>
    </div>
  </div>;
}
