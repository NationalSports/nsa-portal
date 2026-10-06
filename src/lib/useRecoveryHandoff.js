import {useLayoutEffect,useRef} from 'react';
import {draftJournal,currentDraftOwner} from './draftJournal';

// Closing an editor for recovery must never require a successful cloud save.
// First preserve its actual current contents, not the older banner payload.
export function useRecoveryHandoff(target,{id,table,owner,capture,revision,isSaving}) {
  const paused=useRef(false);
  const latest=useRef(null);
  latest.current={id,table,owner,capture,revision,isSaving};
  useLayoutEffect(()=>{
    if(!target)return;
    paused.current=false;
    let mounted=true;
    const api={id,table,async preserve(expectedOwner,prepare=value=>value){
      if(paused.current)throw new Error('The editor is already preparing a recovery copy.');
      const current=()=>mounted&&target.current===api&&latest.current.id===id&&latest.current.table===table&&String(latest.current.owner)===expectedOwner&&currentDraftOwner()===expectedOwner;
      if(!current()||latest.current.isSaving())throw new Error('Wait for the current save to finish, then try again.');
      paused.current=true;
      try{
        const payload=latest.current.capture();
        if(!payload||payload.id!==id)throw new Error('Finish editing the active field, then try again.');
        const signature=JSON.stringify(payload),version=latest.current.revision();
        const snapshot=prepare(JSON.parse(signature));
        const receipt=await draftJournal.stage(expectedOwner,table,snapshot);
        if(!current()||latest.current.isSaving()||version!==latest.current.revision()||signature!==JSON.stringify(latest.current.capture()))throw new Error('The editor changed while preserving it. Your editor is still open; try again.');
        return {table,id,owner:expectedOwner,payload:{...snapshot,_draftRecovery:{key:receipt.key,owner:receipt.owner,revision:receipt.revision}},ts:receipt.ts,revision:receipt.revision};
      }catch(error){paused.current=false;throw error;}
    }};
    target.current=api;
    return()=>{mounted=false;if(target.current===api)target.current=null;};
  },[target,id,table]);
  return paused;
}
