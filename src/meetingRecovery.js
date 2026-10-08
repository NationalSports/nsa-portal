// Temporary recovery only: acknowledged chunks are deleted, never archived.
export const RECOVERY_TTL_MS = 24 * 3600 * 1000;
export const RECOVERY_MAX_BYTES = 150 * 1024 * 1024;
const DB = 'nsa-meeting-recovery-v1';
const open = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('Audio recovery storage is unavailable in this browser.'));
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('chunks', { keyPath: 'key' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function transaction(mode, work) {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', mode); let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save audio for recovery.'));
    work(tx.objectStore('chunks'), v => { result = v; }, tx);
  }); } finally { db.close(); }
}
export async function recoveryList(folder) {
  return transaction('readwrite', (s, done) => {
    const r = s.getAll(); r.onsuccess = () => {
      const now = Date.now(); const out = [];
      for (const row of r.result) {
        if (now - row.createdAt >= RECOVERY_TTL_MS) s.delete(row.key);
        else if (!folder || row.folder === folder) out.push(row);
      }
      done(out.sort((a,b) => a.segment-b.segment || a.index-b.index));
    };
  });
}
export async function recoveryPut(folder, blob, meta) {
  return transaction('readwrite', (s, done, tx) => {
    const key = `${folder}/s${meta.segment}-c${meta.index}`;
    const r = s.getAll(); r.onsuccess = () => {
      const now = Date.now(); let bytes = blob.size;
      for (const row of r.result) {
        if (now-row.createdAt >= RECOVERY_TTL_MS) s.delete(row.key);
        else if (row.key !== key) bytes += row.blob.size;
      }
      if (bytes > RECOVERY_MAX_BYTES) { tx.abort(); return; }
      s.put({ ...meta, key, folder, blob, createdAt: now }); done(key);
    };
  });
}
export async function recoveryDelete(key) { return transaction('readwrite', s => s.delete(key)); }
export async function recoveryClear(folder) {
  return transaction('readwrite', s => { const r=s.getAll(); r.onsuccess=()=>r.result.filter(x=>x.folder===folder).forEach(x=>s.delete(x.key)); });
}
