import React, {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';

export default function AllSchoolDtfQueue({storeId}) {
  const [data,setData]=useState({requests:[],batches:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const call=useCallback(async (action,extra={}) => {
    const session=await supabase.auth.getSession();
    const response=await fetch('/.netlify/functions/all-school-dtf',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session.data?.session?.access_token || '')},body:JSON.stringify({action,store_id:storeId,...extra})});
    const json=await response.json();
    if (!response.ok || json.error) throw new Error(json.error || 'Could not load DTF queue');
    return json;
  },[storeId]);
  const reload=useCallback(async()=>{try{setData(await call('list'));setError('');}catch(e){setError(e.message);}},[call]);
  useEffect(()=>{reload();},[reload]);
  async function act(action,extra={}) {
    setBusy(true);setError('');
    try {const result=await call(action,extra);await reload();if(result.reason)setError(result.reason);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const button={border:'1px solid #cbd5e1',borderRadius:8,padding:'8px 12px',background:'#fff',cursor:'pointer',fontWeight:600};
  return <section style={{padding:20,border:'1px solid #dbe3ed',borderRadius:16,background:'#fff'}}>
    <h3 style={{margin:'0 0 6px'}}>DTF supplier orders</h3>
    <p style={{fontSize:13,color:'#64748b'}}>Review production art, dimensions and quantities before preparing supplier batches. Each email keeps the saved artwork version and a garment manifest.</p>
    {!data.sending_enabled&&<p style={{padding:10,background:'#eff6ff',color:'#1e40af',borderRadius:8,fontSize:12}}>Email sending is disabled until the supplier configuration is ready.</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    <div style={{display:'flex',gap:8,marginBottom:15}}>
      <button style={button} disabled={busy} onClick={()=>act('refresh')}>Refresh artwork checks</button>
      <button style={button} disabled={busy} onClick={()=>act('prepare')}>Prepare supplier batches</button>
    </div>
    {data.requests.filter(r=>r.status==='blocked'||r.status==='queued').map(r=><div key={r.id} style={{padding:'10px 0',borderTop:'1px solid #e2e8f0',fontSize:13}}>
      <strong>{r.manifest?.art_name || r.job_id}</strong> · {r.qty} prints · {r.so_id}<br/>
      <span style={{color:r.status==='blocked'?'#b91c1c':'#64748b'}}>{r.error || (r.supplier_id ? 'Ready for '+r.supplier_id:'Choose supplier')}</span>
    </div>)}
    {data.batches.map(b=><div key={b.id} style={{padding:'14px 0',borderTop:'1px solid #e2e8f0',fontSize:13}}>
      <strong>{b.supplier_id}</strong> · {(b.manifest || []).reduce((n,m)=>n+m.qty,0)} prints · {b.status}
      <p style={{margin:'4px 0',color:'#64748b'}}>Batch {b.id.slice(0,8)} · {b.supplier_snapshot?.email}{b.message_id?' · Receipt '+b.message_id:''}</p>
      {b.error&&<p style={{color:'#b91c1c'}}>{b.error}</p>}
      {(b.status==='sending'||b.status==='unknown')&&<p style={{color:'#9a3412'}}>Check the sending account before taking further action. This batch will not be automatically resent.</p>}
      {b.status==='queued'&&<button style={button} disabled={busy||!data.sending_enabled} onClick={()=>act('send',{batch_id:b.id})}>Send saved artwork + manifest</button>}
      {b.status==='blocked'&&!b.message_id&&<button style={button} disabled={busy} onClick={()=>act('retry',{batch_id:b.id})}>Recheck after correction</button>}
      {b.status==='sent'&&<button style={button} disabled={busy} onClick={()=>{const bin=window.prompt('Receiving bin (optional)','');if(bin!==null)act('receive',{batch_id:b.id,bin});}}>Receive prints</button>}
    </div>)}
    {!data.requests.length&&!data.batches.length&&<p style={{color:'#64748b',fontSize:13}}>Paid store orders needing DTF prints will appear here.</p>}
  </section>;
}
