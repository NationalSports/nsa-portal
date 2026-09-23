/* eslint-disable */
// "My Email": the rep's own Gmail, triaged by AI.
// netlify/functions/rep-gmail-sync.js reads the rep's Primary inbox and stores
// a summary + suggested tasks/deadlines per email in rep_email_insights. This
// page shows the important ones; one tap turns a task or deadline into a
// workspace_items reminder (the same notes/reminders panel on the dashboard).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, SearchSelect } from './components';

const callFn=async(supabase,fn,body)=>{
  const{data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Your session expired. Sign in again.');
  const r=await fetch('/.netlify/functions/'+fn,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify(body||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
  return d;
};

const localDate=(offsetDays=0)=>{const d=new Date();d.setDate(d.getDate()+offsetDays);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtWhen=v=>{const d=new Date(v||0);return Number.isNaN(d.getTime())?'':d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const fmtDay=v=>{if(!v)return'';const d=new Date(v+'T12:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})};

const CALLBACK_MESSAGES={
  connected:['Google connected. Your inbox will be checked every 10 minutes.','success'],
  denied:['Google access was not granted.','error'],
  no_refresh_token:['Google did not return offline access. Disconnect and try again.','error'],
  state_mismatch:['Google sign-in expired or was started in another tab. Try again.','error'],
  state_invalid:['Google sign-in expired. Try again.','error'],
  error:['Google sign-in failed. Try again.','error'],
};

export default function MyEmail({supabase,cu,customers,sos,ests,notify:notifyProp}){
  // App's notify is recreated every render; read it through a ref so loaders stay stable.
  const notifyRef=useRef(notifyProp);notifyRef.current=notifyProp;
  const notify=useCallback((...a)=>notifyRef.current?.(...a),[]);
  const[status,setStatus]=useState(null);
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[filter,setFilter]=useState('important');
  const[busy,setBusy]=useState('');
  const[added,setAdded]=useState({});
  const[tagEdit,setTagEdit]=useState(null);// {id, customer_id, so_id, estimate_id}

  const custName=useCallback(id=>(customers||[]).find(c=>c.id===id)?.name||null,[customers]);
  const custOptions=useMemo(()=>(customers||[]).filter(c=>c.is_active!==false).map(c=>({value:c.id,label:c.name+(c.alpha_tag?' ('+c.alpha_tag+')':''),searchText:c.alpha_tag||''})),[customers]);
  // An account's orders include its sub-accounts' (teams under a school) and its parent's.
  const familyIds=useCallback(cid=>{
    const all=customers||[];const me=all.find(c=>c.id===cid);
    return new Set([cid,...all.filter(c=>c.parent_id===cid).map(c=>c.id),...(me?.parent_id?[me.parent_id]:[])]);
  },[customers]);
  const docLabel=d=>d.id+(d.memo?' · '+String(d.memo).slice(0,50):'')+(d.status?' · '+d.status:'');

  const loadStatus=useCallback(async()=>{
    if(!supabase)return;
    try{setStatus(await callFn(supabase,'google-connect',{action:'status'}))}
    catch(e){setStatus({error:e.message})}
  },[supabase]);

  const loadRows=useCallback(async()=>{
    if(!supabase||!cu?.id){setLoading(false);return}
    const{data,error}=await supabase.from('rep_email_insights').select('*').eq('team_member_id',cu.id).order('received_at',{ascending:false}).limit(200);
    if(error)notify?.('My Email could not load: '+error.message,'error');
    else setRows(data||[]);
    setLoading(false);
  },[supabase,cu?.id,notify]);

  useEffect(()=>{loadStatus();loadRows()},[loadStatus,loadRows]);

  // Google redirects back to /?pg=my_email&google=<result>; show it once, then tidy the URL.
  useEffect(()=>{
    try{
      const url=new URL(window.location.href);
      const g=url.searchParams.get('google');
      if(!g)return;
      const[msg,kind]=CALLBACK_MESSAGES[g]||CALLBACK_MESSAGES.error;
      notify?.(msg,kind);
      url.searchParams.delete('google');
      window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    }catch{}
  },[notify]);

  const connect=async()=>{
    setBusy('connect');
    try{const d=await callFn(supabase,'google-connect',{action:'connect'});window.location.href=d.authUrl}
    catch(e){notify?.(e.message,'error');setBusy('')}
  };
  const disconnect=async()=>{
    if(!window.confirm('Disconnect Google? The portal will stop reading your email. Insights already saved stay here.'))return;
    setBusy('disconnect');
    try{await callFn(supabase,'google-connect',{action:'disconnect'});notify?.('Google disconnected');await loadStatus()}
    catch(e){notify?.(e.message,'error')}
    setBusy('');
  };
  const checkNow=async()=>{
    setBusy('sync');
    try{
      const d=await callFn(supabase,'rep-gmail-sync',{});
      notify?.(d.analyzed?('Checked '+d.analyzed+' new email'+(d.analyzed===1?'':'s')+' ('+d.important+' important)'):'No new email');
      await Promise.all([loadRows(),loadStatus()]);
    }catch(e){notify?.('Check failed: '+e.message,'error');await loadStatus()}
    setBusy('');
  };

  const setRowStatus=async(row,next)=>{
    setRows(prev=>prev.map(r=>r.id===row.id?{...r,status:next}:r));
    const{error}=await supabase.from('rep_email_insights').update({status:next,updated_at:new Date().toISOString()}).eq('id',row.id);
    if(error){notify?.('Could not update: '+error.message,'error');loadRows()}
  };

  // Manual re-tag. Changing the account clears an order/quote from a different account.
  const saveTags=async()=>{
    const t=tagEdit;if(!t)return;
    const patch={customer_id:t.customer_id||null,so_id:t.so_id||null,estimate_id:t.estimate_id||null,updated_at:new Date().toISOString()};
    patch.link_source=(patch.customer_id||patch.so_id||patch.estimate_id)?'manual':null;
    setBusy('tags');
    const{error}=await supabase.from('rep_email_insights').update(patch).eq('id',t.id);
    setBusy('');
    if(error){notify?.('Could not save tags: '+error.message,'error');return}
    setRows(prev=>prev.map(r=>r.id===t.id?{...r,...patch}:r));
    setTagEdit(null);
    notify?.('Tags saved');
  };
  const pickTagCustomer=cid=>setTagEdit(t=>{
    const fam=familyIds(cid);
    const soOk=t.so_id&&fam.has((sos||[]).find(o=>o.id===t.so_id)?.customer_id);
    const estOk=t.estimate_id&&fam.has((ests||[]).find(o=>o.id===t.estimate_id)?.customer_id);
    return{...t,customer_id:cid,so_id:soOk?t.so_id:'',estimate_id:estOk?t.estimate_id:''};
  });

  const addReminder=async(row,key,{title,date,label})=>{
    const t=String(title||'').trim().slice(0,180);
    if(!t)return;
    setBusy(key);
    try{
      const{data:dupe}=await supabase.from('workspace_items').select('id').eq('created_by',cu.id).eq('item_kind','reminder').eq('status','open').eq('title',t).limit(1);
      if(dupe?.length){notify?.('Already on your reminders');setAdded(p=>({...p,[key]:true}));setBusy('');return}
      const who=row.sender_name||row.sender_email||'';
      const{error}=await supabase.from('workspace_items').insert({
        item_kind:'reminder',
        title:t,
        body:('From email: '+(row.subject||'(no subject)')+(who?' — '+who:'')).slice(0,5000),
        label,
        created_by:cu.id,
        visibility:'personal',
        // workspace_items holds one link: the order when tagged, else the account.
        so_id:row.so_id||null,
        customer_id:row.so_id?null:(row.customer_id||null),
        remind_on:date||localDate(1),
      });
      if(error)throw error;
      setAdded(p=>({...p,[key]:true}));
      notify?.('Reminder added for '+fmtDay(date||localDate(1)));
    }catch(e){notify?.('Could not add reminder: '+(e.message||e),'error')}
    setBusy('');
  };

  const visible=useMemo(()=>rows.filter(r=>{
    if(filter==='important')return r.important&&r.status==='new';
    if(filter==='done')return r.status!=='new';
    return true;
  }),[rows,filter]);
  const importantCount=rows.filter(r=>r.important&&r.status==='new').length;

  const gmailLink=r=>'https://mail.google.com/mail/u/'+encodeURIComponent(status?.google_email||'0')+'/#all/'+encodeURIComponent(r.gmail_thread_id||r.gmail_message_id);

  const chip={display:'inline-flex',alignItems:'center',gap:6,padding:'4px 8px',borderRadius:6,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:12,color:'#1e293b'};
  const addBtn=(done)=>({border:'none',borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:700,cursor:done?'default':'pointer',background:done?'#dcfce7':'#dbeafe',color:done?'#166534':'#1e40af'});

  return(<div>
    <div className="card" style={{marginBottom:12}}>
      <div className="card-body" style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <Icon name="mail" size={18}/>
        <div style={{flex:1,minWidth:220}}>
          <div style={{fontWeight:800,color:'#1e293b'}}>My Email</div>
          {!status?<div style={{fontSize:12,color:'#64748b'}}>Checking connection…</div>
          :status.error?<div style={{fontSize:12,color:'#b91c1c'}}>{status.error}</div>
          :status.connected?<div style={{fontSize:12,color:'#64748b'}}>
            Connected as <b>{status.google_email}</b>{status.last_synced_at?' · last checked '+fmtWhen(status.last_synced_at):' · first check pending'}
            {status.last_error&&<div style={{color:'#b91c1c',marginTop:2}}>{status.last_error}</div>}
          </div>
          :<div style={{fontSize:12,color:'#64748b'}}>
            Connect your Google account and AI will read new mail in your Primary inbox, flag what matters, and pull out tasks and deadlines. Only summaries are saved — never full emails. Nothing is sent without you.
            {status.configured===false&&<div style={{color:'#b45309',marginTop:2}}>Google sign-in isn't set up on the server yet.</div>}
          </div>}
        </div>
        {status?.connected?<>
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={checkNow}>{busy==='sync'?'Checking…':'Check now'}</button>
          <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={disconnect}>Disconnect</button>
          {status.last_error&&/reconnect/i.test(status.last_error)&&<button className="btn btn-sm btn-primary" disabled={!!busy} onClick={connect}>Reconnect Google</button>}
        </>:status&&!status.error&&<button className="btn btn-sm btn-primary" disabled={!!busy||status.configured===false} onClick={connect}>{busy==='connect'?'Opening Google…':'Connect Google'}</button>}
      </div>
    </div>

    <div style={{display:'flex',gap:6,marginBottom:10}}>
      {[['important','Important'+(importantCount?' ('+importantCount+')':'')],['all','All'],['done','Done']].map(([id,label])=>
        <button key={id} className={'btn btn-sm '+(filter===id?'btn-primary':'btn-secondary')} onClick={()=>setFilter(id)}>{label}</button>)}
    </div>

    {loading?<div style={{padding:24,color:'#64748b',fontSize:13}}>Loading…</div>
    :visible.length===0?<div className="card"><div className="card-body" style={{color:'#64748b',fontSize:13}}>
      {filter==='important'?(status?.connected?'Nothing important waiting. New email is checked every 10 minutes.':'Connect Google to get started.'):'No email here yet.'}
    </div></div>
    :visible.map(r=>{
      const cname=custName(r.customer_id);
      return(<div key={r.id} className="card" style={{marginBottom:8,opacity:r.status==='new'?1:0.7}}>
        <div className="card-body" style={{display:'grid',gap:6}}>
          <div style={{display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
            {r.important&&<span style={{width:8,height:8,borderRadius:4,background:'#2563eb',display:'inline-block'}} title="Important"/>}
            <span style={{fontWeight:800,color:'#1e293b'}}>{r.sender_name||r.sender_email}</span>
            <span style={{marginLeft:'auto',fontSize:11,color:'#94a3b8'}}>{fmtWhen(r.received_at)}</span>
          </div>
          <div style={{fontSize:13,fontWeight:600,color:'#334155'}}>{r.subject||'(no subject)'}</div>
          {r.summary?<div style={{fontSize:13,color:'#1e293b'}}>{r.summary}</div>:<div style={{fontSize:12,color:'#64748b'}}>{r.snippet}</div>}
          {r.importance_reason&&<div style={{fontSize:11,color:'#64748b'}}>Why: {r.importance_reason}</div>}
          {tagEdit?.id===r.id?<div style={{display:'grid',gap:6,padding:8,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6}}>
            <div style={{fontSize:11,fontWeight:700,color:'#64748b'}}>ACCOUNT</div>
            <SearchSelect options={custOptions} value={tagEdit.customer_id||null} onChange={pickTagCustomer} placeholder="Pick an account…" limit={50}/>
            {tagEdit.customer_id&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <select className="form-select" style={{flex:1,minWidth:180,fontSize:12}} value={tagEdit.so_id||''} onChange={e=>setTagEdit(t=>({...t,so_id:e.target.value}))}>
                <option value="">No sales order</option>
                {(sos||[]).filter(o=>familyIds(tagEdit.customer_id).has(o.customer_id)).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,100).map(o=><option key={o.id} value={o.id}>{docLabel(o)}</option>)}
              </select>
              <select className="form-select" style={{flex:1,minWidth:180,fontSize:12}} value={tagEdit.estimate_id||''} onChange={e=>setTagEdit(t=>({...t,estimate_id:e.target.value}))}>
                <option value="">No estimate</option>
                {(ests||[]).filter(o=>familyIds(tagEdit.customer_id).has(o.customer_id)).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,100).map(o=><option key={o.id} value={o.id}>{docLabel(o)}</option>)}
              </select>
            </div>}
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" disabled={busy==='tags'} onClick={saveTags}>{busy==='tags'?'Saving…':'Save tags'}</button>
              {(tagEdit.customer_id||tagEdit.so_id||tagEdit.estimate_id)&&<button className="btn btn-sm btn-secondary" onClick={()=>setTagEdit(t=>({...t,customer_id:'',so_id:'',estimate_id:''}))}>Clear</button>}
              <button className="btn btn-sm btn-secondary" onClick={()=>setTagEdit(null)}>Cancel</button>
            </div>
          </div>
          :<div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',fontSize:11}}>
            {cname||r.so_id||r.estimate_id?<>
              {cname&&<span style={{...chip,fontSize:11,padding:'2px 6px'}}>{cname}</span>}
              {r.so_id&&<span style={{...chip,fontSize:11,padding:'2px 6px'}}>{r.so_id}</span>}
              {r.estimate_id&&<span style={{...chip,fontSize:11,padding:'2px 6px'}}>{r.estimate_id}</span>}
              <span style={{color:'#94a3b8'}}>{r.link_source==='manual'?'tagged by you':'auto-tagged'}</span>
            </>:<span style={{color:'#94a3b8'}}>Not tagged to an account</span>}
            <button style={{border:'none',background:'none',color:'#2563eb',cursor:'pointer',fontSize:11,fontWeight:700,padding:0}} onClick={()=>setTagEdit({id:r.id,customer_id:r.customer_id||'',so_id:r.so_id||'',estimate_id:r.estimate_id||''})}>{cname||r.so_id||r.estimate_id?'Edit tags':'Tag account / order'}</button>
          </div>}
          {(r.tasks?.length>0||r.deadlines?.length>0)&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:2}}>
            {(r.tasks||[]).map((t,i)=>{const key=r.id+':t'+i;return(
              <span key={key} style={chip}>
                <b style={{fontSize:10,color:'#64748b'}}>TASK</b>{t.title}{t.due_date&&<span style={{color:'#64748b'}}>· {fmtDay(t.due_date)}</span>}
                <button style={addBtn(added[key])} disabled={added[key]||busy===key} onClick={()=>addReminder(r,key,{title:t.title,date:t.due_date,label:'follow_up'})}>{added[key]?'Added':'+ Reminder'}</button>
              </span>)})}
            {(r.deadlines||[]).map((d,i)=>{const key=r.id+':d'+i;return(
              <span key={key} style={{...chip,background:'#fff7ed',borderColor:'#fed7aa'}}>
                <b style={{fontSize:10,color:'#9a3412'}}>DEADLINE</b>{d.label}<span style={{color:'#64748b'}}>· {fmtDay(d.date)}</span>
                <button style={addBtn(added[key])} disabled={added[key]||busy===key} onClick={()=>addReminder(r,key,{title:d.label,date:d.date,label:'deadline'})}>{added[key]?'Added':'+ Reminder'}</button>
              </span>)})}
          </div>}
          <div style={{display:'flex',gap:6,marginTop:4}}>
            <a className="btn btn-sm btn-secondary" href={gmailLink(r)} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
            {r.status==='new'?<>
              <button className="btn btn-sm btn-secondary" onClick={()=>setRowStatus(r,'done')}>Done</button>
              {r.important&&<button className="btn btn-sm btn-secondary" onClick={()=>setRowStatus(r,'dismissed')}>Not important</button>}
            </>:<button className="btn btn-sm btn-secondary" onClick={()=>setRowStatus(r,'new')}>Move back</button>}
          </div>
        </div>
      </div>)})}
  </div>);
}
