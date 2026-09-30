import fs from 'fs';
import path from 'path';

const APP=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');
const fnBody=(name)=>{const i=APP.indexOf('const '+name+'=');const j=APP.indexOf('\n    };',i);return APP.slice(i,j)};

describe('auto-send bills to QuickBooks after a Portal push',()=>{
  const auto=fnBody('_autoSendBillsToQB');

  it('does nothing unless the shared switch, migration approval and a live preflight are all in place',()=>{
    expect(auto).toContain("cfg.autoPushBillsToQB!==true||!qbOperator||!cfg.connected||cfg.initialMigrationApproved!==true");
    expect(auto).toContain("cfg.preflight?.status!=='success'");
    expect(APP).toContain('_qbCfgRef.current=qbConfig');
  });

  it('sends only bills this browser just applied, shaped like the backfill, never credits or already-synced bills',()=>{
    expect(auto).toContain("b.portalStatus==='success'&&qbBillNeedsSync(b.qbStatus)");
    expect(auto).toContain('buildQboBackfillRows(applied,');
    expect(auto).toContain('.filter(_billIsReadyForQB)');
  });

  it('never re-applies the Portal side and uses the one shared QuickBooks path',()=>{
    expect(auto).toContain('_sendBillRowsToQB(next,{portalAlreadyApplied:true,');
    expect(APP).toContain('const portalWasAlreadyApplied=portalAlreadyApplied||(');
    expect(APP.split('await _sendBillRowsToQB(').length-1).toBe(2);
  });

  it('never runs alongside a manual QuickBooks push from the same browser',()=>{
    expect(auto).toContain("if(_qbBillPushBusy.current==='manual')return;");
    const manual=fnBody('pushBillsToQB');
    expect(manual).toContain("if(_qbBillPushBusy.current){nf(");
    expect(manual).toContain("_qbBillPushBusy.current='manual'");
    expect(manual).toContain('finally{_qbBillPushBusy.current=false');
  });

  it('hooks every Portal push path (auto, button, problems modal, retry, parked) and no QBO-internal apply',()=>{
    expect(APP).toContain('const pushed=await _applyBillsToPortalThenQB(autoBills);');
    expect(APP).toContain('_applyBillsToPortalThenQB(selected).then(');
    expect(APP).toContain('await _applyBillsToPortalThenQB(m.cleanBills)');
    expect(APP).toContain('await _applyBillsToPortalThenQB(all)');
    expect(APP).toContain('await _applyBillsToPortalThenQB([b],{retry:true})');
    expect(APP).toContain('await _applyBillsToPortalThenQB([billObj])');
    // The QuickBooks path's own Portal apply must not trigger another auto-send.
    expect(fnBody('_sendBillRowsToQB')).toContain('await _applyBillsToPortal([b])');
    expect(fnBody('_sendBillRowsToQB')).not.toContain('_applyBillsToPortalThenQB');
  });

  it('offers the switch only to QuickBooks operators, off by default, locked until migration approval',()=>{
    expect(APP).toContain("const on=qbConfig.autoPushBillsToQB===true;");
    expect(APP).toContain("disabled={locked&&!on}");
    expect(APP).toContain("setQBConfig(prev=>({...prev,autoPushBillsToQB:!on}))");
  });
});
