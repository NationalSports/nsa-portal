import React, {useEffect, useMemo, useState} from 'react';
import {supabase} from './lib/dbEngine';

const labels={completed:'Completed',needs_review:'Needs review',blocked:'Blocked',failed:'Failed',running:'Running',skipped:'Skipped',abandoned:'Lease expired'};
const fmt=value=>value?new Date(value).toLocaleString():'Never';

export default function QBBackgroundSalesCard(){
  const [state,setState]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const runs=state?.runs||[],last=runs[0],lastSuccess=runs.find(run=>['completed','needs_review'].includes(run.status));
  const latestCounters=last?.counters||{};
  const flat=useMemo(()=>Object.entries(latestCounters).flatMap(([group,counts])=>Object.entries(counts||{}).map(([name,value])=>({group,name,value}))).filter(row=>Number(row.value)>0),[latestCounters]);

  async function call(body){
    setError('');const {data,error:invokeError}=await supabase.functions.invoke('qbo-sales-background',{body});
    if(invokeError)throw new Error(invokeError.message||'Server request failed');
    if(!data?.ok)throw new Error(data?.error||data?.error_code||'Server request failed');return data;
  }
  async function load(){setBusy('status');try{setState(await call({action:'status'}));}catch(e){setError(e.message);}finally{setBusy('');}}
  async function run(action){setBusy(action);setNotice('');try{const result=await call({action});setNotice(result.started===false?'No second run started: '+result.reason:`Server run ${result.run_id} finished ${result.status||'successfully'}.`);await load();}catch(e){setError(e.message);setBusy('');}}
  async function kill(enabled){setBusy('kill');try{await call({action:'kill_switch',enabled});setNotice(enabled?'Kill switch enabled. Scheduled writes are stopped.':'Kill switch cleared. Rollout phase and write controls still apply.');await load();}catch(e){setError(e.message);setBusy('');}}
  useEffect(()=>{load();},[]);

  const settings=state?.settings,automationOn=!!settings?.background_enabled&&!settings?.kill_switch;
  return <section className="card" style={{padding:16,marginBottom:16,borderLeft:'4px solid '+(automationOn?'#16a34a':'#dc2626')}} aria-label="Background hourly sales automation">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div><h2 style={{margin:'0 0 6px'}}>Background hourly sales automation: {automationOn?'On':'Off'}</h2>
        <p style={{margin:0,color:'#475569'}}>Server schedule {state?.schedule||'17 * * * *'} · next run {fmt(state?.next_scheduled_run)} · phase {settings?.phase||'unavailable'} · writes {settings?.writes_enabled?'enabled':'disabled'}. No browser tab is required.</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button className="btn btn-secondary" disabled={!!busy} onClick={load}>{busy==='status'?'Refreshing…':'Refresh status'}</button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={()=>run('preflight')}>{busy==='preflight'?'Running…':'Run read-only preflight'}</button>
        <button className="btn btn-primary" disabled={!!busy||settings?.kill_switch} onClick={()=>run('run')}>{busy==='run'?'Running…':settings?.writes_enabled?'Run sales sync now':'Run sales sync now (read-only)'}</button>
        <button className="btn btn-secondary" disabled={!!busy||!settings} style={{color:settings?.kill_switch?'#166534':'#b91c1c'}} onClick={()=>kill(!settings?.kill_switch)}>{settings?.kill_switch?'Clear kill switch':'Enable kill switch'}</button>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginTop:14}}>
      <div><strong>Connection health</strong><br/>{state?.connection?.configured&&state?.connection?.realm_id===settings?.realm_id?'Connected to expected realm':'Needs attention'}</div>
      <div><strong>Last attempted run</strong><br/>{fmt(last?.started_at)} · {labels[last?.status]||last?.status||'None'}</div>
      <div><strong>Last successful run</strong><br/>{fmt(lastSuccess?.completed_at)}</div>
      <div><strong>Current run</strong><br/>{runs.some(run=>run.status==='running')?'Running':'Idle'}</div>
    </div>
    {flat.length>0&&<div style={{overflowX:'auto',marginTop:14}}><table className="data-table"><thead><tr><th>Entity</th><th>Result</th><th>Count</th></tr></thead><tbody>{flat.map(row=><tr key={row.group+row.name}><td>{row.group}</td><td>{row.name.replaceAll('_',' ')}</td><td>{row.value}</td></tr>)}</tbody></table></div>}
    {!!state?.manual_reviews?.length&&<details style={{marginTop:12}}><summary>{state.manual_reviews.length} open manual-review exception{state.manual_reviews.length===1?'':'s'}</summary><div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Entity</th><th>Source</th><th>Reason</th><th>Last seen</th></tr></thead><tbody>{state.manual_reviews.map(row=><tr key={row.id}><td>{row.entity_type}</td><td>{row.source_id}</td><td>{row.reason_code.replaceAll('_',' ')}</td><td>{fmt(row.last_seen_at)}</td></tr>)}</tbody></table></div></details>}
    {notice&&<p role="status" style={{color:'#166534'}}>{notice}</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
