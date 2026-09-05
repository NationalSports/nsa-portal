// A second, transactional recovery copy for document saves. Each tab owns its
// own lane: a save in tab A cannot replace or acknowledge tab B's draft.
// The legacy outbox remains available during rollout and is never purged here.
const DB_NAME = 'nsa-document-drafts';
const STORE = 'drafts';
const clone = value => JSON.parse(JSON.stringify(value));
const unique = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
export function currentDraftOwner() {
  try { return String(JSON.parse(localStorage.getItem('nsa_user') || 'null')?.id || ''); }
  catch { return ''; }
}

export function createDraftJournal({factory, name = DB_NAME, session = unique()} = {}) {
  let opening;
  let sequence = 0;
  const transient = new Map();
  const changed = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('nsa:drafts-changed'));
  };
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve,reject) => {
      const idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      if (!idb) { reject(new Error('Draft storage is unavailable')); return; }
      let finished = false;
      const request = idb.open(name, 1);
      const timer = setTimeout(() => fail(new Error('Draft storage did not open in time')), 5000);
      const fail = error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath:'key'});
      request.onerror = () => fail(request.error || new Error('Draft storage could not open'));
      request.onblocked = () => fail(new Error('Another tab is blocking draft storage'));
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true; clearTimeout(timer);
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    opening.catch(() => { opening = null; });
    return opening;
  };
  const transact = async (mode, work) => {
    const db = await open();
    return new Promise((resolve,reject) => {
      let tx;
      try { tx = db.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined); }
      catch { tx = db.transaction(STORE,mode); }
      let result;
      const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Draft transaction timed out')); },5000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error('Draft transaction aborted')); };
      try { work(tx.objectStore(STORE),value => { result=value; }); }
      catch(error) { clearTimeout(timer); try { tx.abort(); } catch {} reject(error); }
    });
  };
  const make = (owner,table,payload) => ({
    key:JSON.stringify([owner,session,table,payload.id]), owner, session, table,
    id:payload.id, revision:unique(), sequence:++sequence, ts:Date.now(), payload:clone(payload),
  });
  const compare = (receipt,operation) => transact('readwrite',(store,done) => {
    const get=store.get(receipt.key);
    get.onsuccess=()=>{
      const current=get.result;
      if(!current || current.owner!==receipt.owner || current.revision!==receipt.revision){done(false);return;}
      operation(store,current);done(true);
    };
  });
  return {
    async stage(owner,table,payload) {
      if (!owner || !payload?.id) throw new Error('A signed-in owner and document ID are required');
      const entry=make(owner,table,payload);
      // Keep the new content in this tab even if the browser denies disk space.
      transient.set(entry.key,entry);
      try {
        await transact('readwrite',(store)=>{store.put(entry);});
        if(transient.get(entry.key)?.revision===entry.revision)transient.delete(entry.key);
        changed();return entry;
      } catch(error) { changed();error.draftReceipt=entry;throw error; }
    },
    async update(receipt,payload) {
      const next=clone(payload);
      const pending=transient.get(receipt.key);
      if(pending?.revision===receipt.revision){transient.set(receipt.key,{...pending,id:next.id,payload:next});changed();return true;}
      const updated=await compare(receipt,(store,current)=>store.put({...current,id:next.id,payload:next}));
      changed();return updated;
    },
    async acknowledge(receipt) {
      // Remove the exact revision only, including across independent connections.
      const pending=transient.get(receipt.key);
      if(pending?.revision===receipt.revision)transient.delete(receipt.key);
      const removed=await compare(receipt,(store)=>store.delete(receipt.key));
      changed();return removed;
    },
    async list(owner) {
      if(!owner)return [];
      const rows=await transact('readonly',(store,done)=>{const req=store.getAll();req.onsuccess=()=>done(req.result);}).catch(error=>{
        if(!transient.size)throw error;return [];
      });
      const merged=new Map(rows.filter(r=>r.owner===owner).map(r=>[r.key,{...r,durable:true}]));
      for(const row of transient.values())if(row.owner===owner)merged.set(row.key,{...row,durable:false});
      return [...merged.values()].sort((a,b)=>b.ts-a.ts);
    },
    async close() { if(opening){const db=await opening.catch(()=>null);db?.close();opening=null;} },
  };
}
export const draftJournal=createDraftJournal();

// The disk transaction finishes before run() sends a request. On storage
// failure we still allow an online save, but explicitly report that recovery
// depends on keeping this tab open. A failed cloud save retains its snapshot.
export async function protectDocumentDraft(table,payload,run,onStorageError=()=>{},journal=draftJournal) {
  const owner=currentDraftOwner();
  if(!owner)return run(); // Public/unauthenticated flows do not borrow another staff member's journal.
  let receipt;
  try { receipt=await journal.stage(owner,table,payload); }
  catch(error) { receipt=error.draftReceipt;onStorageError(error); }
  try {
    const result=await run();
    if(receipt){
      try {
        if(result===true){
          await journal.acknowledge(receipt);
          const recovered=payload._draftRecovery;
          if(recovered?.owner===owner)await journal.acknowledge(recovered);
          delete payload._draftRecovery;
        }else await journal.update(receipt,payload);
      }catch(error){onStorageError(error);}
    }
    return result;
  }catch(error){
    if(receipt)try{await journal.update(receipt,payload);}catch(storageError){onStorageError(storageError);}
    throw error;
  }
}
