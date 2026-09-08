import fs from 'fs';
import path from 'path';

const APP=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');
const RECEIPT_MIGRATION=fs.readFileSync(path.join(__dirname,'..','..','supabase','migrations','20260908024500_persist_qbo_bill_receipts.sql'),'utf8');

describe('QBO bill batches after portal auto-push',()=>{
  it('uses a QBO-specific readiness gate for the batch selector',()=>{
    expect(APP).toContain('const _billIsReadyForQB=b=>{');
    expect(APP).toContain("if(b.portalStatus&&b.portalStatus!=='success'&&!b._qbBackfill)return false");
    expect(APP).toContain("if(b.portalStatus!=='success'&&(!_billIsReadyToPush(b)||_billTriage(b)?.issue))return false");
    expect(APP).toContain('if(!_billIsReadyForQB(row)||!qbBillNeedsSync(row.qbStatus))return false');
  });

  it('keeps the QBO batch button enabled for portal-complete pending rows',()=>{
    expect(APP).toContain('const qbReady=billImport.parsed.filter(b=>{');
    expect(APP).toContain('disabled:!qbConfig.connected||billImport.uploading||!qbReady.length');
  });

  it('deduplicates one vendor document before the 20-record cap and UI count',()=>{
    expect(APP).toContain('const _qboBillBatchKey=b=>{');
    expect(APP).toContain('const batchSeen=new Set();');
    expect(APP).toContain('if(key&&batchSeen.has(key))return false');
    expect(APP).toContain('if(key&&_qbReadySeen.has(key))return false');
  });

  it('preserves portal-complete QBO-pending rows across a deploy reload',()=>{
    const recoveryGate="b.portalStatus==='success'&&qbBillNeedsSync(b.qbStatus)";
    expect(APP.split(recoveryGate).length-1).toBeGreaterThanOrEqual(3);
  });

  it('persists verified bill receipts before reporting the batch complete',()=>{
    expect(APP).toContain("supabase.rpc('record_qbo_bill_receipts',{p_receipts:payload})");
    expect(APP).toContain('const receiptOutcome=await _recordQboBillReceipts(');
    expect(APP.indexOf('const receiptOutcome=await _recordQboBillReceipts(')).toBeLessThan(APP.indexOf("QBO receipt(s) saved on this browser only"));
  });

  it('ships the server receipt columns and authenticated upsert RPC',()=>{
    expect(RECEIPT_MIGRATION).toContain('add column if not exists qb_status');
    expect(RECEIPT_MIGRATION).toContain('add column if not exists qb_bill_id');
    expect(RECEIPT_MIGRATION).toContain('on conflict (doc_norm, is_credit) do update');
    expect(RECEIPT_MIGRATION).toContain('grant execute on function public.record_qbo_bill_receipts(jsonb) to authenticated');
  });
});
