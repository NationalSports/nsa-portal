import React from 'react';

// Text keystrokes stay in this tiny component — the same draft protocol QuantityDraftInput uses,
// for the same reason. An order editor keystroke that goes straight to `uI`/`sv` replaces the
// whole order object, and the editor re-renders every line, size cell, decoration row, job panel
// and price on the order for one character. Quantities were moved off that path already; the item
// identity fields (sku / name / color) were still on it, so typing a custom item's name crawled.
//
// The parent still owns the draft ref (`data-sizing-draft` marks the field, so Save and the 30s
// autosave force the focused field through its blur commit before persisting) — buffering here
// never risks losing what the rep typed.
//
// onCommit(value, valueAtFocus): the focus-time value is what the caller's mock re-key compares
// against, since the committed item no longer holds the pre-edit value by the time blur runs.
const TextDraftInput=React.memo(function TextDraftInput({value,draftKey,onStage,onCommit,className,style,placeholder,title,autoFocus}){
  const cur=value==null?'':String(value);
  const[raw,setRaw]=React.useState(cur);
  const[focused,setFocused]=React.useState(false);
  const atFocus=React.useRef(cur);
  // While focused the field owns its text — an order state change (autosave stamp, a sibling
  // edit) must not yank the cursor back to the committed value mid-word.
  React.useEffect(()=>{if(!focused)setRaw(cur)},[cur,focused]);
  return <input className={className} data-sizing-draft="true" value={raw} placeholder={placeholder} title={title} autoFocus={autoFocus}
    onFocus={()=>{atFocus.current=raw;setFocused(true)}}
    onChange={e=>{const next=e.target.value;setRaw(next);onStage(draftKey,next)}}
    onBlur={()=>{setFocused(false);onCommit(raw,atFocus.current)}}
    onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')e.currentTarget.blur()}}
    style={style}/>;
});

export default TextDraftInput;
