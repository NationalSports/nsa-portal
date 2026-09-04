import fs from 'fs';
import path from 'path';

const APP=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

describe('QBO bill batches after portal auto-push',()=>{
  it('uses a QBO-specific readiness gate for the batch selector',()=>{
    expect(APP).toContain('const _billIsReadyForQB=b=>{');
    expect(APP).toContain("if(b.portalStatus&&b.portalStatus!=='success'&&!b._qbBackfill)return false");
    expect(APP).toContain('.filter(({row})=>_billIsReadyForQB(row)&&qbBillNeedsSync(row.qbStatus))');
  });

  it('keeps the QBO batch button enabled for portal-complete pending rows',()=>{
    expect(APP).toContain('const qbReady=billImport.parsed.filter(b=>_billIsReadyForQB(b)&&qbBillNeedsSync(b.qbStatus))');
    expect(APP).toContain('disabled:!qbConfig.connected||billImport.uploading||!qbReady.length');
  });

  it('preserves portal-complete QBO-pending rows across a deploy reload',()=>{
    const recoveryGate="b.portalStatus==='success'&&qbBillNeedsSync(b.qbStatus)";
    expect(APP.split(recoveryGate).length-1).toBeGreaterThanOrEqual(3);
  });
});
