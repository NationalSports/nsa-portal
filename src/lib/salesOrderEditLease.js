// One controller per mounted editor; identity is never copied from sessionStorage
// (duplicating a browser tab copies sessionStorage). No automatic reacquisition.
const newSession=()=>{
  if(crypto.randomUUID)return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
};
export function createSalesOrderEditLease({client,id,onChange=()=>{},session=newSession(),now=()=>performance.now()}) {
  let state={phase:'view',session},deadline=0,closed=false,pending=null;
  const emit=next=>{state={...state,...next};if(!closed)onChange(state);return state};
  const rpc=async(action,generation)=>{
    const started=now();
    const {data,error}=await client.rpc('sales_order_edit_lease',{p_so_id:id,p_session:session,p_action:action,p_generation:generation??null});
    if(error){
      console.warn('[Edit ownership]',error);
      const message=error.code==='PGRST202'?'Editing ownership is not available on this deployment yet. The order is still viewable.':
        /EDIT_TAKEOVER_FORBIDDEN/.test(error.message||'')?'Only an administrator can take over another person’s editing session.':
        /SO_WAS_DELETED/.test(error.message||'')?'This order is no longer available.':
        'Could not verify editing ownership. Check your connection and try again.';
      throw new Error(message);
    }
    if(!data||typeof data.owned!=='boolean')throw new Error('Could not verify editing ownership.');
    return {data,started};
  };
  const lose=message=>{deadline=0;return emit({phase:'lost',message:message||'Editing ownership expired or moved to another tab. Your work is still here.'})};
  const canSave=()=>{
    if(closed||state.phase!=='editing')return false;
    if(now()>=deadline){lose();return false;}
    return true;
  };
  const accept=({data,started})=>{
    if(!data.owned)return emit({...data,phase:'view'});
    deadline=started+Number(data.ttl_ms||0)-5000;
    if(!Number.isFinite(deadline)||now()>=deadline)return lose('The connection took too long. Reopen the saved order before editing.');
    return emit({...data,phase:'editing',message:''});
  };
  return {
    get state(){return state},canSave,
    stamp(payload){if(!canSave())return null;return {...payload,_editLease:{session,generation:state.generation}}},
    lose,
    async acquire(takeover=false){
      if(pending||closed||state.phase==='lost')return state;
      emit({phase:'loading',message:''});
      pending=rpc(takeover?'takeover':'acquire',state.generation);
      try{const result=await pending;if(closed){if(result.data.owned)await rpc('release',result.data.generation);return state;}return accept(result)}
      catch(error){return emit({phase:'view',message:error.message})}
      finally{pending=null;}
    },
    async renew(){
      if(pending||!canSave())return state;
      pending=rpc('renew',state.generation);
      try{const result=await pending;if(closed||state.phase==='lost')return state;if(!result.data.owned)return lose();return accept(result)}
      catch{return lose('Connection lost. Editing is paused and your work is still here.')}
      finally{pending=null;}
    },
    async close(){
      const generation=state.generation;closed=true;deadline=0;
      // Serialize release after any renewal so late responses cannot resurrect a lease.
      if(pending)await pending.catch(()=>{});
      if(generation!=null)try{await rpc('release',generation)}catch{/* Expiry is the fallback. */}
    },
  };
}
