// Synchronous emergency backup, with one atomic storage key per owner/session/document.
// IndexedDB draftJournal remains the transactional recovery authority. Never rewrite
// another tab's key or the legacy shared blob: an old bundle may still be writing it.
export const OUTBOX_PREFIX='nsa_outbox_v2:';
const LEGACY='nsa_outbox';
const ACK_PREFIX='nsa_outbox_legacy_ack:';
export const outboxSession=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
export function createSessionOutbox({storage,owner,session=outboxSession()}) {
  const key=(table,id)=>OUTBOX_PREFIX+JSON.stringify([owner(),session,table,id]);
  const read=k=>{try{return JSON.parse(storage().getItem(k)||'null')}catch{return null}};
  const legacyAckKey=(table,id)=>ACK_PREFIX+JSON.stringify([owner(),table,id]);
  const receiptKey=k=>ACK_PREFIX+JSON.stringify([owner(),k]);
  const legacy=()=>{
    const box=read(LEGACY);if(!box||typeof box!=='object'||Array.isArray(box))return [];
    return Object.values(box).filter(e=>e?.id&&e?.table&&JSON.stringify(read(legacyAckKey(e.table,e.id)))!==JSON.stringify(e))
      .map(e=>({...e,legacy:true,reviewOnly:true,storageKey:LEGACY,legacySnapshot:JSON.stringify(e)}));
  };
  const own=(table,id)=>read(key(table,id));
  const write=(table,id,entry)=>{storage().setItem(key(table,id),JSON.stringify({...entry,owner:owner(),session}));return entry.revision};
  const remove=(table,id,revision,storageKey,legacySnapshot)=>{
    const k=storageKey||key(table,id);
    if(k===LEGACY){
      // A receipt hides ONLY the exact legacy value reviewed. No shared-blob deletion.
      const entry=read(LEGACY)?.[table+':'+id];
      if(!entry||!legacySnapshot||JSON.stringify(entry)!==legacySnapshot)return false;
      storage().setItem(legacyAckKey(table,id),JSON.stringify(entry));return true;
    }
    if(!k.startsWith(OUTBOX_PREFIX))return false;
    const current=read(k);
    if(!current||current.owner!==owner()||current.table!==table||current.id!==id||
      (revision&&current.revision!==revision))return false;
    // Foreign lanes are immutable once their tab is gone; require the exact revision
    // for an explicit review/discard. Active tabs only mutate their own lane.
    if(current.session!==session){
      if(!revision||current.revision!==revision)return false;
      storage().setItem(receiptKey(k),JSON.stringify(current));return true;
    }
    storage().removeItem(k);return true;
  };
  return {session,own,write,remove,
    list(){
      const result=[];const s=storage();
      for(let i=0;i<s.length;i++){
        const k=s.key(i);if(!k?.startsWith(OUTBOX_PREFIX))continue;
        const e=read(k);if(e?.owner!==owner()||!e?.table||!e?.id||JSON.stringify(read(receiptKey(k)))===JSON.stringify(e))continue;
        result.push({...e,storageKey:k,reviewOnly:e.session!==session});
      }
      return [...result,...legacy()];
    },
  };
}
