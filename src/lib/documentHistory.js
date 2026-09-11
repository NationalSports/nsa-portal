import { supabase } from './supabase';
import { createDraftJournal, currentDraftOwner } from './draftJournal';

const JOURNAL_TABLE = 'document_history_snapshot';
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT = 12000;
const clone = value => JSON.parse(JSON.stringify(value));
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const validKind = kind => kind === 'so_history' || kind === 'est_history';
const asError = error => error instanceof Error ? error : new Error(error?.message || String(error || 'Unknown history error'));

export function createHistoryStore({ client = supabase, journal = createDraftJournal({ name: 'nsa-history-pending' }) } = {}) {
  const sending = new Set();
  const active = new Map();
  const pending = new Map();
  const appendCalls = new Set();
  let flushing = null;
  const pendingKey = payload => `${payload.kind}\u0000${payload.document_id}\u0000${payload.id}`;
  const remember = (who, payload) => {
    if (!who) return;
    if (!pending.has(who)) pending.set(who, new Set());
    pending.get(who).add(pendingKey(payload));
  };
  const forget = (who, payload) => pending.get(who)?.delete(pendingKey(payload));

  const request = async (payload) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      let call = client.rpc('append_document_history', {
        p_kind: payload.kind,
        p_document_id: payload.document_id,
        p_entry: payload.entry,
      });
      if (typeof call?.abortSignal === 'function') call = call.abortSignal(controller.signal);
      const result = await call;
      if (!result || !Object.prototype.hasOwnProperty.call(result,'error')) throw new Error('Appending document history returned no acknowledgement');
      if (result.error) throw asError(result.error);
      return result?.data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Appending document history timed out after 12 seconds');
      throw asError(error);
    } finally {
      clearTimeout(timeout);
    }
  };

  const send = async (payload) => {
    const key = pendingKey(payload);
    if (active.has(key)) return active.get(key);
    const promise = (async () => {
      sending.add(key);
      try { return await request(payload); }
      finally { sending.delete(key); active.delete(key); }
    })();
    active.set(key, promise);
    return promise;
  };

  const appendOperation = async (kind, documentId, entry) => {
    if (!validKind(kind)) throw new Error(`Unsupported document history kind: ${kind}`);
    if (documentId === undefined || documentId === null || documentId === '') throw new Error('A document ID is required');
    const payload = {
      kind,
      document_id: String(documentId),
      id: uuid(),
      entry: clone(entry || {}),
    };
    const owner = currentDraftOwner();
    let receipt;
    let stageError;
    if (owner) {
      remember(owner, payload);
      try {
        receipt = await journal.stage(owner, JOURNAL_TABLE, payload);
      } catch (error) {
        stageError = asError(error);
        receipt = error?.draftReceipt;
      }
    }
    if (owner && currentDraftOwner() !== owner) throw new Error('Signed-in owner changed while staging document history; queued snapshot was not sent');
    let sent = false;
    let acknowledgeError;
    try {
      await send(payload);
      sent = true;
      if (receipt) {
        try { await journal.acknowledge(receipt); forget(owner, payload); }
        catch (error) { acknowledgeError = asError(error); }
      }
      if (!receipt) forget(owner, payload);
      if (acknowledgeError) throw new Error(`History was saved online, but local recovery could not be finalized: ${acknowledgeError.message}`);
      return payload.entry;
    } catch (error) {
      const networkError = asError(error);
      // A storage failure must not turn an otherwise successful online append
      // into a user-visible failure; the server's content hash makes retries safe.
      if (sent && stageError && !acknowledgeError) return payload.entry;
      if (stageError) throw new Error(`Could not save document history online, and local recovery also failed: ${networkError.message}; ${stageError.message}`);
      throw networkError;
    }
  };

  const append = (kind, documentId, entry) => {
    // Stage immediately: waiting behind a network request would leave the next
    // snapshot only in memory. captured_at preserves order across delayed retries.
    const flight = appendOperation(kind, documentId, entry);
    appendCalls.add(flight);
    flight.then(() => appendCalls.delete(flight), () => appendCalls.delete(flight));
    return flight;
  };

  const flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      // An append may still be staging its durable receipt. Let it finish so
      // this flush sees and handles its exact row in the same owner lane.
      await Promise.all([...appendCalls].map(call => call.catch(() => undefined)));
      const owner = currentDraftOwner();
      if (!owner) {
        if (appendCalls.size || active.size) throw new Error('Cannot flush document history without a signed-in owner');
        return { sent: 0, failed: 0 };
      }
      const rows = (await journal.list(owner)).filter(row => row.table === JOURNAL_TABLE)
        .sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.sequence || 0) - (b.sequence || 0));
      for (const row of rows) if (row.payload) remember(owner, row.payload);
      let sent = 0; let failed = 0; let firstError;
      for (const row of rows) {
        const payload = row.payload;
        if (currentDraftOwner() !== owner) throw new Error('Signed-in owner changed while flushing document history');
        if (!payload?.id || !payload?.entry) continue;
        const key = pendingKey(payload);
        try {
          if (active.has(key)) await active.get(key);
          else await send(payload);
          await journal.acknowledge(row);
          forget(owner, payload);
          sent++;
        } catch (error) {
          failed++;
          if (!firstError) firstError = asError(error);
          break;
        }
      }
      if (firstError) throw firstError;
      return { sent, failed };
    })().finally(() => { flushing = null; });
    return flushing;
  };

  const loadAll = async () => {
    const result = { so_history: Object.create(null), est_history: Object.create(null) };
    let last;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      let query = client.from('document_history_snapshots')
        .select('seq,kind,document_id,entry,captured_at')
        .order('seq', { ascending: false })
        .limit(PAGE_SIZE);
      if (last !== undefined) query = query.lt('seq', last);
      if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
      let page;
      try { page = await query; }
      catch (error) { if (controller.signal.aborted) throw new Error('Loading document history timed out after 12 seconds'); throw asError(error); }
      finally { clearTimeout(timeout); }
      if (page?.error) throw asError(page.error);
      if (!Array.isArray(page?.data)) throw new Error('Loading document history returned an invalid result');
      const rows = page.data;
      for (const row of rows) {
        if (!validKind(row.kind)) continue;
        (result[row.kind][row.document_id] ||= []).push(row);
      }
      if (rows.length < PAGE_SIZE) break;
      const next = rows[rows.length - 1].seq;
      if (next === undefined || next === last) throw new Error('Loading document history pagination did not advance');
      last = next;
    }
    for (const kind of ['so_history','est_history']) {
      for (const id of Object.keys(result[kind])) {
        result[kind][id].sort((a,b)=>(Date.parse(b.captured_at)||0)-(Date.parse(a.captured_at)||0) || Number(b.seq)-Number(a.seq));
        result[kind][id]=result[kind][id].map(row=>row.entry);
      }
    }
    return result;
  };

  const summary = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let result;
    try {
      let call = client.rpc('document_history_summary');
      if (typeof call?.abortSignal === 'function') call = call.abortSignal(controller.signal);
      if (typeof call?.order === 'function') call = call.order('kind', { ascending: true }).order('document_id', { ascending: true });
      if (typeof call?.range === 'function') {
        const rows = [];
        for (let offset = 0;; offset += PAGE_SIZE) {
          let pageCall = call.range(offset, offset + PAGE_SIZE - 1);
          if (typeof pageCall?.abortSignal === 'function') pageCall = pageCall.abortSignal(controller.signal);
          const page = await pageCall;
          if (page?.error) throw asError(page.error);
          if (!Array.isArray(page?.data)) throw new Error('Loading document history summary returned an invalid result');
          rows.push(...page.data);
          if (page.data.length < PAGE_SIZE) { result = { data: rows }; break; }
        }
      } else result = await call;
    }
    catch (error) { if (controller.signal.aborted) throw new Error('Loading document history summary timed out after 12 seconds'); throw asError(error); }
    finally { clearTimeout(timeout); }
    if (result?.error) throw asError(result.error);
    if (!Array.isArray(result?.data)) throw new Error('Loading document history summary returned an invalid result');
    return result.data;
  };

  const importAll = async data => {
    for (const kind of ['so_history', 'est_history']) {
      const docs = data?.[kind] || {};
      if (!docs || typeof docs !== 'object' || Array.isArray(docs)) throw new Error(`Invalid ${kind} history`);
      for (const documentId of Object.keys(docs)) {
        if (!Array.isArray(docs[documentId])) throw new Error(`Invalid ${kind} history for document ${documentId}`);
        for (const entry of docs[documentId]) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.snapshot || typeof entry.snapshot !== 'object' || Array.isArray(entry.snapshot) || entry.snapshot.id !== documentId) throw new Error(`Invalid ${kind} history entry for document ${documentId}`);
        }
      }
    }
    for (const kind of ['so_history', 'est_history']) {
      const docs = data?.[kind] || {};
      for (const documentId of Object.keys(docs)) {
        for (const entry of [...docs[documentId]].reverse()) await append(kind, documentId, entry);
      }
    }
  };

  const hasPending = () => {
    const owner = currentDraftOwner();
    return appendCalls.size > 0 || active.size > 0 || !!(owner && pending.get(owner)?.size);
  };

  return { append, flush, loadAll, summary, importAll, hasPending };
}
