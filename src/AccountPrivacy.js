import React,{useState,useEffect} from 'react';
import {sbGetSession} from './lib/auth';
async function requestApi(method='GET',list=false){
 const session=await sbGetSession();if(!session?.access_token)throw new Error('Please sign in again.');
 const response=await fetch('/.netlify/functions/account-deletion-request'+(list?'?list=1':''),{method,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({confirm:'DELETE'})}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data;
}
export function AccountDeletionQueue(){
 const [state,setState]=useState({});
 const load=()=>requestApi('GET',true).then(data=>setState(data)).catch(error=>setState({error:error.message}));
 useEffect(()=>{load();},[]);
 return <div className="card"><div className="card-header"><h3>Account deletion requests</h3><button onClick={load}>Refresh</button></div><div className="card-body">{state.error?<p role="alert">{state.error}</p>:!state.requests?'Loading requests…':state.requests.length?state.requests.map(r=><p key={r.id}>{r.team_member_id} · {r.status} · {new Date(r.requested_at).toLocaleDateString()}</p>):'No requests.'}<p>Requests require the account and personal data deletion process described in the app readiness checklist. A request is not a completed deletion.</p></div></div>;
}
export default function AccountPrivacy({onClose}){
 const [state,setState]=useState({}),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;requestApi().then(data=>{if(alive)setState(data);}).catch(error=>{if(alive)setState({error:error.message});});return()=>{alive=false;};},[]);
 const submit=async()=>{if(busy||confirm!=='DELETE')return;setBusy(true);try{setState(await requestApi('POST'));}catch(error){setState({error:error.message});}finally{setBusy(false);}};
 return <div role="dialog" aria-modal="true" aria-label="Account and privacy" style={{position:'fixed',inset:0,zIndex:11000,background:'rgba(15,23,42,.65)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}><div style={{background:'white',borderRadius:12,padding:24,maxWidth:480,width:'100%',color:'#0f172a'}}><button onClick={onClose} style={{float:'right'}} aria-label="Close account and privacy">×</button><h2>Account and privacy</h2><a href="/privacy.html" target="_blank" rel="noreferrer">Privacy information</a><h3>Request account deletion</h3><p>This starts a request to delete your personal sign-in account and associated personal data. Company orders, invoices and records that must be retained are handled separately. Your account stays active until processing is complete.</p>{state.error&&<p role="alert">{state.error}</p>}{state.request?<p role="status">Deletion request {state.request.status}. Reference: {state.request.id}. Requested {new Date(state.request.requested_at).toLocaleDateString()}.</p>:<><label>Type DELETE to confirm<input value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off"/></label><button disabled={confirm!=='DELETE'||busy} onClick={submit}>{busy?'Submitting…':'Request account deletion'}</button></>}</div></div>;
}
