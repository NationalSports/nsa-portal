import React from 'react';

// Quantity keystrokes stay in this tiny component. The parent editor still owns the draft ref
// (so Save/autosave can flush it safely), but no longer reconciles thousands of order controls
// for every digit typed.
const QuantityDraftInput=React.memo(function QuantityDraftInput({value,draftKey,onStage,onCommit,className,style,filledStyle,emptyStyle,placeholder='0'}){
  const cur=value==null||value===0?'':String(value);const[raw,setRaw]=React.useState(cur);const[focused,setFocused]=React.useState(false);
  React.useEffect(()=>{if(!focused)setRaw(cur)},[cur,focused]);
  const commit=()=>{setFocused(false);onCommit(raw)};const filled=(parseInt(raw,10)||0)>0;
  return <input className={className} data-sizing-draft="true" value={raw} placeholder={placeholder}
    onFocus={()=>setFocused(true)} onChange={e=>{const next=e.target.value;if(!/^\d*$/.test(next))return;setRaw(next);onStage(draftKey,next)}}
    onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
    style={{...style,...(filled?filledStyle:emptyStyle)}}/>;
});

export default QuantityDraftInput;
