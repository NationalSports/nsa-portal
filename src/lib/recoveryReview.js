import {recoveryContent} from './savedDraftComparison';
import {garmentIdentity, resolveOutgoingLineIds} from './orderLineIdentity';

export function prepareRecoveryDraft(payload, cloud, token, choices = {}) {
  const items = resolveOutgoingLineIds(payload.items || [], cloud.items || []).map((item, index) =>
    !item.line_id && choices[index] && (cloud.items||[]).some(row=>row.line_id===choices[index]&&garmentIdentity(row)===garmentIdentity(item)) ? {...item, line_id:choices[index]} : item);
  const ids = items.map(item => item.line_id).filter(Boolean);
  const unresolved = items.map((item,index) => ({item,index,candidates:(cloud.items || []).filter(row => garmentIdentity(row) === garmentIdentity(item))})).filter(({item}) => !item.line_id);
  return {
    payload:{...cloud,...payload,items,_version:cloud._version,_obBaseVersion:cloud._version,_reviewedSaveToken:token},
    unresolved,
    valid:!unresolved.length && new Set(ids).size === items.length,
  };
}

// A field-by-field review, including quantities, prices and child collections.
// Array order is meaningful here: a moved line is visibly compared at its new position.
export function recoveryDifferences(draft, cloud) {
  const result=[];
  const visit=(a,b,path)=>{
    if(a===b || (a==null&&b==null))return;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
      const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];
      keys.forEach(key=>visit(a[key],b[key],path.concat(Array.isArray(a)?String(Number(key)+1):key)));
    }else result.push({field:path.join(' › ').replace(/_/g,' '),draft:a,cloud:b});
  };
  visit(recoveryContent(draft),recoveryContent(cloud),[]);
  return result;
}
