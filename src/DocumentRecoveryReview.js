import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {prepareRecoveryDraft,recoveryDifferences} from './lib/recoveryReview';

const show=value=>value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);
export default function DocumentRecoveryReview({entry,owner,load,save,onSaved,onClose,canSave=()=>true}) {
  const [loaded,setLoaded]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[choices,setChoices]=useState({});
  const active=useRef(true),running=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const refresh=useCallback(async()=>{
    if(running.current)return;
    running.current=true;setBusy(true);setError('');setLoaded(null);setChoices({});
    try{const result=await load(entry.table,entry.id);if(active.current)setLoaded(result);}
    catch(e){if(active.current)setError(e.message);}
    finally{running.current=false;if(active.current)setBusy(false);}
  },[load,entry.table,entry.id]);
  useEffect(()=>{refresh();},[refresh]); // Mounted anew for each entry/owner.
  const prepared=useMemo(()=>loaded?prepareRecoveryDraft(entry.payload,loaded.row,loaded.token,choices):null,[entry,loaded,choices]);
  // Keep selectors visible after a choice, allowing corrections before saving.
  const matchRows=useMemo(()=>loaded?prepareRecoveryDraft(entry.payload,loaded.row,loaded.token).unresolved:[],[entry,loaded]);
  const differences=useMemo(()=>prepared?recoveryDifferences(prepared.payload,loaded.row):[],[prepared,loaded]);
  const apply=async()=>{
    if(running.current||!prepared?.valid)return;
    if(!canSave()){setError('Save your open document edits and close the editor before recovering this draft.');return;}
    running.current=true;setBusy(true);setError('');
    try{
      const ok=await save(entry.table,prepared.payload,String(owner));
      if(!active.current)return;
      if(ok===true)onSaved(prepared.payload);
      else setError('Save was not confirmed. Your recovery copy is kept. Reload the comparison to check for newer changes or unmatched lines.');
    }catch(e){if(active.current)setError('Save was not confirmed. Your recovery copy is kept. '+e.message);}
    finally{running.current=false;if(active.current)setBusy(false);}
  };
  return <div role="dialog" aria-modal="true" aria-label={'Review recovery '+entry.id} className="modal-overlay">
    <div className="modal" style={{maxWidth:1000,width:'95%',maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header"><h2>Review recovery: {entry.id}</h2><button disabled={busy} onClick={onClose}>Close</button></div>
      <div className="modal-body">
        <p>Compare this browser draft with the current saved document. Saving uses the reviewed draft; a newer cloud change stops the save and keeps your backup.</p>
        {error&&<p role="alert">{error}</p>}
        {busy&&<p role="status">{loaded?'Saving — waiting for confirmation…':'Loading saved document…'}</p>}
        {loaded&&<>
          <p><strong>Draft: {prepared.payload.items.length} item lines. Saved: {loaded.row.items?.length||0} item lines.</strong></p>
          {!!matchRows.length&&<fieldset><legend>Match duplicate product lines</legend><p>Select the saved line that each draft line belongs to. Quantities below describe the saved lines.</p>
            {matchRows.map(({item,index,candidates})=><label key={index} style={{display:'block',margin:'8px 0'}}>Draft line {index+1}: {item.sku} {item.color} · {show(item.sizes)}{' '}
              <select aria-label={'Match draft line '+(index+1)} disabled={busy} value={choices[index]||''} onChange={event=>setChoices(previous=>({...previous,[index]:event.target.value}))}>
                <option value="">Choose saved line</option>
                {candidates.map(row=><option key={row.line_id} value={row.line_id}>Saved line {loaded.row.items.indexOf(row)+1}: {row.name||row.sku} · {show(row.sizes)} · price {show(row.unit_sell)}</option>)}
              </select>
            </label>)}
            {!prepared.valid&&<p>Each draft line must match a different saved line before saving.</p>}
          </fieldset>}
          {differences.length?<table style={{width:'100%',tableLayout:'fixed',fontSize:12}}><thead><tr><th>Field</th><th>Current saved value</th><th>Draft value</th></tr></thead><tbody>
            {differences.map((change,index)=><tr key={index}>{[change.field,show(change.cloud),show(change.draft)].map((text,column)=><td key={column} style={{verticalAlign:'top',overflowWrap:'anywhere',whiteSpace:'pre-wrap',padding:6,borderBottom:'1px solid #ddd'}}>{text}</td>)}</tr>)}
          </tbody></table>:<p>No content differences found.</p>}
        </>}
      </div>
      <div className="modal-footer"><button disabled={busy} onClick={refresh}>Reload comparison</button><button disabled={busy||!prepared?.valid} onClick={apply}>Save reviewed draft</button></div>
    </div>
  </div>;
}
