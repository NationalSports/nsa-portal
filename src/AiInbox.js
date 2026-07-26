/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './components';
import { createGmailDraft, queueEmailCart } from './utils';

const STATUS_LABELS={
  queued:'Queued',processing:'AI working',needs_review:'Needs review',
  estimate_created:'Estimate created',draft_created:'Gmail draft ready',
  complete:'Complete',ignored:'Ignored',failed:'Failed',
};

const fmtDate=value=>{
  const d=new Date(value||0);
  return Number.isNaN(d.getTime())?'':d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
};

export default function AiInbox({supabase,customers,onCreateEstimate,notify}){
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selectedId,setSelectedId]=useState(null);
  const[filter,setFilter]=useState('open');
  const[saving,setSaving]=useState(false);
  const[drafting,setDrafting]=useState(false);
  const[queueingCart,setQueueingCart]=useState(false);

  const load=useCallback(async()=>{
    if(!supabase){setLoading(false);return}
    setLoading(true);
    const{data,error}=await supabase.from('ai_inbox_messages').select('*').order('received_at',{ascending:false}).limit(100);
    if(error){notify?.('AI Inbox could not load: '+error.message,'error')}
    else{
      setRows(data||[]);
      let linkedId=null;
      try{linkedId=new URLSearchParams(window.location.search).get('message')}catch{}
      setSelectedId(prev=>prev||((data||[]).some(x=>x.id===linkedId)?linkedId:null)||(data||[])[0]?.id||null);
    }
    setLoading(false);
  },[supabase,notify]);

  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    if(!supabase)return;
    const channel=supabase.channel('ai-inbox-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'ai_inbox_messages'},()=>load())
      .subscribe();
    return()=>{supabase.removeChannel(channel)}
  },[supabase,load]);

  const visible=useMemo(()=>rows.filter(row=>{
    if(filter==='all')return true;
    if(filter==='done')return['draft_created','complete','ignored'].includes(row.status);
    return!['draft_created','complete','ignored'].includes(row.status);
  }),[rows,filter]);
  const selected=rows.find(row=>row.id===selectedId)||visible[0]||null;
  const customer=customers.find(c=>c.id===selected?.customer_id)||null;
  const lines=selected?.analysis?.lines||[];
  const stock=selected?.stock_checks||[];
  const portalContext=selected?.analysis?.portal_context||{};
  const commandCanCart=['queue_cart','queue_cart_from_estimate','build_estimate_and_cart'].includes(selected?.command_type);

  const patch=async(values)=>{
    if(!selected||!supabase)return false;
    setSaving(true);
    const next={...values,updated_at:new Date().toISOString()};
    const{error}=await supabase.from('ai_inbox_messages').update(next).eq('id',selected.id);
    setSaving(false);
    if(error){notify?.('Could not update email: '+error.message,'error');return false}
    setRows(prev=>prev.map(row=>row.id===selected.id?{...row,...next}:row));
    return true;
  };
  const createResponseDraft=async()=>{
    if(!selected?.draft_body_text)return;
    setDrafting(true);
    const safeHtml=selected.draft_body_text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br/>');
    const result=await createGmailDraft(supabase,{
      inboxMessageId:selected.id,
      subject:selected.draft_subject||('Re: '+selected.subject),
      text:selected.draft_body_text,
      html:'<div style="font-family:Arial,sans-serif;line-height:1.5">'+safeHtml+'</div>',
      attachments:[],
    });
    setDrafting(false);
    if(!result.ok){notify?.('Gmail draft failed: '+result.error,'error');return}
    setRows(prev=>prev.map(row=>row.id===selected.id?{...row,status:'draft_created',gmail_draft_id:result.draft_id}:row));
    notify?.('Gmail reply draft created in sales@nationalsportsapparel.com');
  };
  const queueCart=async()=>{
    if(!selected)return;
    const ok=window.confirm('Approve this rep command and let the bot modify the Adidas CLICK cart? It will fill the cart and stop before checkout. Nothing will be ordered.');
    if(!ok)return;
    setQueueingCart(true);
    const result=await queueEmailCart(supabase,{inboxMessageId:selected.id});
    setQueueingCart(false);
    if(!result.ok){notify?.('Cart command could not be queued: '+result.error,'error');return}
    setRows(prev=>prev.map(row=>row.id===selected.id?{...row,command_status:'queued',command_task_id:result.task_id}:row));
    notify?.(result.already_queued?'Cart command was already queued.':'Cart command queued for the bot. It will stop before checkout.');
  };

  if(loading)return<div className="card"><div className="card-body" style={{padding:32,textAlign:'center',color:'#64748b'}}>Loading AI Inbox…</div></div>;
  return<div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
      <div style={{fontSize:13,color:'#64748b',flex:1}}>Customer emails and verified rep forwards sent to <strong>sales@nationalsportsapparel.com</strong> are analyzed here. Cart changes require approval, and nothing is ordered or emailed automatically.</div>
      <button className="btn btn-sm btn-secondary" onClick={load}><Icon name="refresh" size={12}/> Refresh</button>
      <select className="form-input" value={filter} onChange={e=>setFilter(e.target.value)} style={{width:140,fontSize:12}}>
        <option value="open">Open</option><option value="done">Completed</option><option value="all">All</option>
      </select>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(300px,38%) minmax(0,1fr)',gap:14,alignItems:'start'}}>
      <div className="card" style={{margin:0,maxHeight:'calc(100vh - 190px)',overflow:'auto'}}>
        {visible.length===0?<div className="card-body" style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No email requests in this view.</div>:
          visible.map(row=><button key={row.id} onClick={()=>setSelectedId(row.id)} style={{width:'100%',display:'block',textAlign:'left',border:'none',borderBottom:'1px solid #e2e8f0',borderLeft:selected?.id===row.id?'4px solid #7c3aed':'4px solid transparent',padding:'12px 14px',background:selected?.id===row.id?'#faf5ff':'white',cursor:'pointer'}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <strong style={{fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{row.sender_name||row.sender_email}</strong>
              <span style={{fontSize:10,color:'#94a3b8',whiteSpace:'nowrap'}}>{fmtDate(row.received_at)}</span>
            </div>
            <div style={{fontSize:12,color:'#334155',fontWeight:600,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.subject||'(no subject)'}</div>
            <div style={{display:'flex',gap:6,marginTop:7,alignItems:'center'}}>
              <span style={{fontSize:9,padding:'2px 7px',borderRadius:10,background:row.status==='failed'?'#fee2e2':row.status==='draft_created'?'#dcfce7':'#ede9fe',color:row.status==='failed'?'#991b1b':row.status==='draft_created'?'#166534':'#6d28d9',fontWeight:700}}>{STATUS_LABELS[row.status]||row.status}</span>
              {row.is_rep_command&&<span style={{fontSize:9,padding:'2px 7px',borderRadius:10,background:'#dbeafe',color:'#1e40af',fontWeight:700}}>Rep command</span>}
              {row.needs_estimate&&<span style={{fontSize:9,padding:'2px 7px',borderRadius:10,background:'#dbeafe',color:'#1e40af',fontWeight:700}}>Estimate</span>}
              {!row.customer_id&&<span style={{fontSize:9,color:'#b45309'}}>Customer needed</span>}
            </div>
          </button>)}
      </div>
      {!selected?<div className="card"><div className="card-body" style={{padding:32,textAlign:'center',color:'#94a3b8'}}>Select an email.</div></div>:
      <div className="card" style={{margin:0}}>
        <div className="card-header" style={{alignItems:'flex-start'}}>
          <div><h2 style={{margin:0,fontSize:16}}>{selected.subject||'(no subject)'}</h2><div style={{fontSize:11,color:'#64748b',marginTop:4}}>From {selected.sender_name?selected.sender_name+' · ':''}{selected.sender_email} · {fmtDate(selected.received_at)}</div></div>
          <span style={{fontSize:10,padding:'3px 8px',borderRadius:10,background:'#ede9fe',color:'#6d28d9',fontWeight:700}}>{STATUS_LABELS[selected.status]||selected.status}</span>
        </div>
        <div className="card-body">
          {selected.error_message&&<div style={{padding:10,background:'#fef2f2',color:'#991b1b',borderRadius:7,fontSize:12,marginBottom:12}}>⚠ {selected.error_message}</div>}
          {selected.is_rep_command&&<div style={{padding:12,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
              <strong style={{fontSize:12,color:'#1e40af'}}>Rep command</strong>
              <span style={{fontSize:9,padding:'2px 7px',borderRadius:10,background:'#dbeafe',color:'#1e40af',fontWeight:700,textTransform:'uppercase'}}>{selected.command_type||'review'}</span>
              <span style={{fontSize:9,padding:'2px 7px',borderRadius:10,background:selected.command_status==='queued'?'#dcfce7':'#fef3c7',color:selected.command_status==='queued'?'#166534':'#92400e',fontWeight:700}}>{selected.command_status||'proposed'}</span>
            </div>
            <div style={{fontSize:12,color:'#1e3a5f',whiteSpace:'pre-wrap'}}>{selected.rep_instruction||'(No instruction found above the forwarded message)'}</div>
            {(selected.original_sender_email||selected.original_subject)&&<div style={{fontSize:10,color:'#64748b',marginTop:7}}>
              Forwarded customer: {selected.original_sender_name||selected.original_sender_email||'Unknown'}
              {selected.original_sender_email&&selected.original_sender_name?' · '+selected.original_sender_email:''}
              {selected.original_subject?' · “'+selected.original_subject+'”':''}
            </div>}
          </div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div><label className="form-label">Matched customer</label><select className="form-input" value={selected.customer_id||''} onChange={e=>patch({customer_id:e.target.value||null})} disabled={saving}>
              <option value="">Select customer…</option>
              {customers.filter(c=>c.is_active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
            <div><label className="form-label">AI intent</label><div style={{padding:'9px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,fontSize:12,textTransform:'capitalize'}}>{selected.intent||'Processing'}</div></div>
          </div>
          {selected.analysis?.summary&&<div style={{padding:11,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:7,fontSize:12,color:'#5b21b6',marginBottom:14}}><strong>AI summary:</strong> {selected.analysis.summary}</div>}
          {selected.is_rep_command&&((portalContext.estimates||[]).length>0||(portalContext.orders||[]).length>0)&&<div style={{padding:11,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:7,fontSize:11,marginBottom:14}}>
            <div style={{fontWeight:700,color:'#334155',marginBottom:6}}>Matched Connect records</div>
            {(portalContext.estimates||[]).slice(0,3).map(est=><div key={est.id} style={{marginBottom:3}}>
              <span style={{fontWeight:700,color:'#1e40af'}}>{est.id}</span> · {est.customer_name||'Unknown customer'} · {est.memo||'No memo'} · {est.status||'—'}
            </div>)}
            {(portalContext.orders||[]).slice(0,3).map(order=><div key={order.id} style={{marginBottom:3}}>
              <span style={{fontWeight:700,color:'#0f766e'}}>{order.id}</span> · {order.customer_name||'Unknown customer'} · {order.memo||'No memo'} · {order.status||'—'}
              {order._tracking_number?' · Tracking '+order._tracking_number:''}
            </div>)}
          </div>}
          <details style={{marginBottom:14}}><summary style={{fontSize:12,fontWeight:700,cursor:'pointer'}}>Original email</summary><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',fontSize:12,lineHeight:1.5,background:'#f8fafc',padding:12,borderRadius:7,maxHeight:260,overflow:'auto'}}>{selected.text_body}</pre></details>
          {lines.length>0&&<div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Requested items</div>
            <div style={{overflowX:'auto',border:'1px solid #e2e8f0',borderRadius:7}}><table style={{fontSize:11}}><thead><tr><th>SKU</th><th>Item</th><th>Sizes</th><th>Stock check</th></tr></thead><tbody>
              {lines.map((line,i)=>{const check=stock[i]||{};return<tr key={i}><td style={{fontWeight:700}}>{line.sku_guess||'Unmatched'}</td><td>{line.name}{line.color?' · '+line.color:''}</td><td>{Object.entries(line.sizes||{}).map(([s,q])=>s+': '+q).join(', ')||line.total_qty||'—'}</td><td>{!line.product_id?<span style={{color:'#b45309'}}>Needs SKU match</span>:check.fully_available?<span style={{color:'#166534'}}>✓ currently available</span>:<span style={{color:'#b91c1c'}}>Short: {(check.shortages||[]).map(x=>x.size+' '+x.available+'/'+x.requested).join(', ')}</span>}</td></tr>})}
            </tbody></table></div>
          </div>}
          <div style={{marginBottom:12}}><label className="form-label">Proposed Gmail reply</label><textarea className="form-input" rows={10} value={selected.draft_body_text||''} onChange={e=>setRows(prev=>prev.map(row=>row.id===selected.id?{...row,draft_body_text:e.target.value}:row))} onBlur={()=>patch({draft_body_text:selected.draft_body_text})} style={{fontFamily:'inherit',lineHeight:1.5}}/></div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
            <button className="btn btn-secondary" disabled={saving} onClick={()=>patch({status:'ignored'})}>Ignore</button>
            {commandCanCart&&<button className="btn btn-secondary" disabled={!customer||queueingCart||selected.command_status==='queued'||selected.command_task_id} title={!customer?'Match a customer first':selected.command_task_id?'Already queued':'Fills the Adidas CLICK cart and stops before checkout'} onClick={queueCart}><Icon name="cart" size={14}/> {queueingCart?'Queuing…':selected.command_task_id?'Cart queued':'Approve & Queue CLICK Cart'}</button>}
            {selected.needs_estimate&&<button className="btn btn-primary" disabled={!customer||lines.length===0} title={!customer?'Match a customer first':''} onClick={()=>onCreateEstimate(selected)}>Create Draft Estimate</button>}
            {!selected.needs_estimate&&<button className="btn btn-primary" disabled={!selected.draft_body_text||drafting} onClick={createResponseDraft}>{drafting?'Creating…':'Create Gmail Draft'}</button>}
          </div>
        </div>
      </div>}
    </div>
  </div>
}
