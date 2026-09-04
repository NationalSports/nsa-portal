const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

describe('supplier bill auto-hold is a hard push gate', () => {
  test('the shared ready selector excludes held bills before Portal or QBO selection', () => {
    const readyGate = APP.match(/const _billIsReadyToPush=b=>\{[\s\S]*?\n    \};/);
    expect(readyGate).not.toBeNull();
    expect(readyGate[0]).toMatch(/billAutoHoldReasons\(b\.parsed\)\.length/);
  });

  test('the Portal write boundary independently refuses a stale held bill', () => {
    const applyBoundary = APP.match(/const _applyBillsToPortal=async\(bills\)=>\{[\s\S]*?await _recordAppliedBills/);
    expect(applyBoundary).not.toBeNull();
    expect(applyBoundary[0]).toMatch(/const holdReasons=billAutoHoldReasons\(p\)/);
    expect(applyBoundary[0]).toMatch(/if\(holdReasons\.length\)\{b\.portalMsg=.*;return\}/);
  });

  test('review triage treats the same safety findings as blocking errors', () => {
    const triage = APP.match(/const _billTriage=b=>\{[\s\S]*?\n    \};/);
    expect(triage).not.toBeNull();
    expect(triage[0]).toMatch(/\.\.\.billAutoHoldReasons\(p\)/);
  });

  test('the Set aside workspace puts held bills in a non-pushable safety bucket', () => {
    expect(APP).toMatch(/const holdReasons=billAutoHoldReasons\(p\);[\s\S]*?holdReasons\.length\?'held':!errs\.length\?'ready'/);
    expect(APP).toMatch(/\['held','🛑','Safety hold'/);
    expect(APP).toMatch(/bucket==='ready'&&!sb\.portalStatus/);
    expect(APP).not.toMatch(/bucket==='held'.*?_pushParkedBill/);
  });

  test('safety is recomputed while auto-push is off and a clean rematch clears a stale hold', () => {
    const sweep = APP.match(/const _autoPushSweep=async\(bills\)=>\{[\s\S]*?\n    \};/);
    expect(sweep).not.toBeNull();
    expect(sweep[0]).toMatch(/_billIsBaseReadyToPush\(b\)/);
    expect(sweep[0]).toMatch(/delete p\._auto_hold/);
    expect(sweep[0]).toMatch(/if\(!autoOn\|\|!autoBills\.length\)return 0/);
  });
});
