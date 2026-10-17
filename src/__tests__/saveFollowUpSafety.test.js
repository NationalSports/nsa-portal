import fs from 'fs';
import path from 'path';

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const editors = ['OrderEditor.js', 'OrderEditorClassic.js'];
const app = read('App.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe.each(editors)('%s save follow-up safety', file => {
  const source = read(file);

  test('automatic retry can acknowledge the editor exactly once', () => {
    expect(source).toContain('saveOptions:{onConfirmed:acknowledge}');
    expect(source).toContain('let followUpRan=false');
    expect(source).toContain('if(!followUpRan){followUpRan=true;if(onConfirmed)onConfirmed()}');
  });

  test('external sends persist markers before delivery and receipts after', () => {
    const silver = between(source, 'const _sspSendNow=async', 'const[poVendorSearch');
    expect(silver.indexOf("saveSONow(sendingOrder,'Silver Screen send'")).toBeLessThan(silver.indexOf("authFetch('/.netlify/functions/silverscreen-job'"));
    expect(silver).toContain("dp._silverscreen_send?.state==='sending'");
    expect(silver).toContain('client_token:sendToken');
    expect(source).toContain('I Confirmed It Was Not Created');
    expect(silver).toContain("_silverscreen_send:{...sendingDp._silverscreen_send,state:'sent'");
    expect(silver).toContain('Silver Screen accepted the job, but its receipt is still unsaved');

    const coach = between(source, 'const doSendCoach=async', 'return<div className="modal-overlay"');
    expect(coach.indexOf("saveSONow({...markerOrder,jobs:markerJobs")).toBeLessThan(coach.indexOf('sendBrevoEmail('));
    expect(coach).toContain("status:'sending'");
    expect(source).toContain('pendingCoachSend');
    expect(source).toContain('I Confirmed It Was Not Sent');
    expect(coach).toContain('sentUnrecorded:_confirmedSend');

    const poEmail = between(source, 'PO — Email Vendor modal', 'PO FULL PAGE VIEW');
    expect(poEmail.indexOf("saveSONow(markerOrder,'Purchase order email'")).toBeLessThan(poEmail.indexOf('sendBrevoEmail('));
    expect(poEmail).toContain('Retry Saving Receipt');
    expect(poEmail).toContain('sentUnrecorded:true');
    expect(poEmail).toContain('poEmail.sendPending');
  });

  test('accepted API acknowledgements remain as dirty local state on save failure', () => {
    const api = between(source, 'const _recordApiOrder=async', 'const _removeApiOrderLine');
    expect(api).not.toContain('setO(current)');
    expect(api).toContain('dirtyRef2.current=true;setDirty(true)');
    expect(api).toContain('do NOT reload or re-order; retry Save');
  });

  test('production clocks stop only in confirmed follow-ups', () => {
    const recall = between(source, 'const _recallArt=', 'const _sendArtBackToArtist');
    expect(recall).toContain('const _clocksToStop=new Set()');
    expect(recall).toContain("saveSONow(updated,'Art recall'");
    expect(recall.indexOf("saveSONow(updated,'Art recall'")).toBeLessThan(recall.lastIndexOf('onStopJobClock(o.id,id)'));
    expect(source).toContain('_clocksToStop2.forEach(id=>onStopJobClock(o.id,id))');
    expect(source).toContain('_clocksToStop3.forEach(id=>onStopJobClock(o.id,id))');
  });

  test('invoice and SO-close results are reported separately', () => {
    expect(source).toContain('let invoiceSaved=true,soCloseSaved=null');
    expect(source).toContain("if(!invoiceSaved&&onInv)onInv(prev=>prev.filter(existing=>existing.id!==inv.id))");
    expect(source).toContain('if(onInvCommit){');
    expect(source).toContain('if(invoiceSaved){');
    expect(source).toContain("Invoice '+inv.id+' was saved for $");
    expect(source).toContain('but the SO did NOT close. Do not create another invoice');
  });

  test('Decoration PO editors await the real save result', () => {
    expect(source).toContain('const _saveDp=async(updatedDp,msg)=>');
    expect(source).toContain("return saveSONow(updated,'Decoration purchase order'");
    expect(source).toContain("if(await _saveDp(updatedDp,'✎ Updated '+newPoId))");
    expect(source).toContain('const saved=await _saveDp(updatedDp');
  });

  test('status chips and job repair use confirmed saves', () => {
    expect(source).toContain("saveSONow(updated,'Sales order status',o.id+' marked complete')");
    expect(source).toContain("saveSONow(updated,'Sales order status',o.id+' reopened");
    expect(source).toContain("saveSONow({...o,jobs:synced,updated_at:new Date().toLocaleString()},'Job repair',null)");
  });

  test('discrepancy follow-up is stable and deduplicated', () => {
    expect(source).toContain("const issue=discs.length>0?{id:'ISS-'+Date.now()");
    expect(source).toContain("window.dispatchEvent(new CustomEvent('nsa:create-issue',{detail:issue}))");
    expect(app).toContain("prev.some(existing=>existing.id===issue.id)?prev:[issue,...prev]");
  });
});

test('App replays editor callbacks and defers prior-shipping restoration', () => {
  expect(app.match(/if\(opts\?\.onConfirmed\)deferredEffects\.push\(opts\.onConfirmed\)/g)).toHaveLength(2);
  const release = between(app, 'const releasePendingShipFromSO=', 'const savArtFiles=');
  expect(release).toContain('return savSONow(updated,{onConfirmed:async()=>');
  expect(release.indexOf('_writePendingShipRestores(')).toBeLessThan(release.indexOf('return savSONow'));
  expect(app).toContain("const _pendingShipRestoreKey='nsa_pending_ship_restores'");
  expect(app).toContain("supabase.rpc('release_pending_shipping_for_so'");
  expect(app).toContain("Prior shipping was not removed because browser recovery storage is unavailable");
  expect(app).toContain('_readPendingShipRestores().forEach(entry=>{void _finishPendingShipRestore');
});

test('manual batch history and queue commit only after SO promotion', () => {
  const batch = between(app, 'const orderVendorBatch=async', 'const removeQueuedApiLine=');
  expect(batch).toContain('requirePromotionBeforeCommit=false');
  expect(batch).toContain('if(promotionFailed&&requirePromotionBeforeCommit)return null');
  expect(batch.indexOf('if(promotionFailed&&requirePromotionBeforeCommit)return null')).toBeLessThan(batch.indexOf('setSubmittedBatches(prev=>[sb,...prev])'));
  expect(batch).toContain('batch_queue_id:bp.id');
  editors.forEach(file => expect(read(file)).toContain('requirePromotionBeforeCommit:true'));
});

test('automatic fully-invoiced close is result checked', () => {
  const autoClose = between(app, 'const _autoClosedSOs=', 'const savI=');
  expect(autoClose).toContain('savSONow(closed');
  expect(autoClose).toContain('onConfirmed:()=>');
  expect(autoClose).toContain('setSOs(prev=>prev.map(row=>row.id===so.id?so:row))');
  expect(autoClose).toContain('_autoCloseRetryAt.current.set(so.id,Date.now()+30000)');
  expect(autoClose).not.toContain('savSO({...so,status:\'complete\'');
});

test('classic and redesigned coach sends advance prior-art review identically', () => {
  editors.forEach(file => expect(read(file)).toContain('markPriorArtCoachSent(jj)'));
});

test('mail transport preserves uncertain provider outcomes', () => {
  const utils=read('utils.js');
  expect(utils).toContain('uncertain:d.uncertain===true||r.status>=500');
  expect(utils).toContain('if(netErr)return{ok:false,uncertain:true');
  editors.forEach(file=>{
    const source=read(file);
    expect(source).toContain("r.uncertain?{...sendingPo,status:'sending'");
    expect(source).toContain("isTopstar&&dp.status==='sending'");
  });
});

test('pending shipping release is transactional and retry-idempotent in Postgres', () => {
  const migration=read('../supabase/migrations/20261017223000_release_pending_shipping_atomic.sql');
  expect(migration).toContain('create or replace function public.release_pending_shipping_for_so');
  expect(migration).toContain('with target_usage as materialized');
  expect(migration).toContain('and pending_ship_applied is false');
  expect(migration).toContain("jsonb_build_object('ok', false, 'not_ready', true)");
  expect(migration).toContain('set used = greatest(0, pending.used - amounts.amount)');
  expect(migration).toContain('delete from public.customer_pending_shipping_usage');
});
