import React,{useEffect,useState} from 'react';
import CoachPortal from './CoachPortal';
import {supabaseCoach} from './lib/supabaseCoach';
import {coachPortalFetch} from './lib/coachPortalFetch';
import {_dbLoad} from './lib/dbEngine';
export default function CoachPortalEntry({tag}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(true),[sent,setSent]=useState(false),[tick,setTick]=useState(0);
 useEffect(()=>{const {data:sub}=supabaseCoach.auth.onAuthStateChange(()=>setTick(v=>v+1));return()=>sub?.subscription?.unsubscribe();},[]);
 useEffect(()=>{let alive=true;setBusy(true);setData(null);setError('');(async()=>{
  try{const r=await coachPortalFetch('/.netlify/functions/coach-portal-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alpha_tag:tag})});const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not load your portal');const parsed=await _dbLoad({source:body.tables,fullState:true});if(!parsed)throw new Error('Your portal data could not be assembled. Please try again.');if(alive)setData({...parsed,customer_id:body.customer_id});}
  catch(e){if(alive)setError(e.message);}finally{if(alive)setBusy(false);}
 })();return()=>{alive=false;};},[tag,tick]);
 async function signIn(e){e.preventDefault();setBusy(true);setError('');try{const {error:e}=await supabaseCoach.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true,emailRedirectTo:window.location.href}});if(e)throw e;setSent(true);}catch(e){setError(e.message);}finally{setBusy(false);}}
 if(data){const customer=data.customers.find(c=>c.id===data.customer_id);return <CoachPortal customer={customer} allCustomers={data.customers} sos={data.sales_orders} ests={data.estimates} invs={data.invoices} REPS={data.team} prod={data.products} onUpdateInvs={fn=>setData(d=>({...d,invoices:typeof fn==='function'?fn(d.invoices):fn}))} onUpdateSOs={fn=>setData(d=>({...d,sales_orders:typeof fn==='function'?fn(d.sales_orders):fn}))} onUpdateEsts={fn=>setData(d=>({...d,estimates:typeof fn==='function'?fn(d.estimates):fn}))}/>;}
 return <main style={{maxWidth:420,margin:'12vh auto',padding:24,fontFamily:'system-ui'}}><h1>National Sports coach portal</h1>{busy?<p>Loading your portal…</p>:<><p>Sign in with your registered coach email to see your account.</p>{error&&<p role="alert">{error}</p>}{sent?<p role="status">Check your email for your sign-in link.</p>:<form onSubmit={signIn}><label>Coach email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button type="submit">Email sign-in link</button></form>}<button onClick={()=>setTick(v=>v+1)}>Try again</button></>}</main>;
}
