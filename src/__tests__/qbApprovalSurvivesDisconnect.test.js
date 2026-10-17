// QuickBooks migration approval must survive transient disconnects (2026-10-17).
//
// On 2026-10-17, 126 supplier bills ($57.9K) were applied in the Portal but never reached
// QuickBooks: the shared qb_config had initialMigrationApproved=false and preflight=null, so
// every push attempt fell into one-bill canary mode and stopped at "Three QBO canary bills are
// complete…". Three code paths cleared the approval on events that are not a human decision:
// a qb-api 409 (the server-sync ownership guard), a 401, and a connection_status:false. The
// approval is a reviewed decision; only connecting to a DIFFERENT QuickBooks company (or an
// explicit Disconnect) may reset it. These are source checks against App.js, the same way
// billAutoHoldPushGate.test.js guards the live bill gate.
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

const block = (startRe, endMarker) => {
  const m = APP.match(startRe);
  expect(m).not.toBeNull();
  const start = m.index;
  const end = APP.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
};

describe('QuickBooks approval survives transient disconnects', () => {
  test('_qbRealmChanged resets only when the realm actually changes', () => {
    const src = APP.match(/const _qbRealmChanged=\(prev,realm\)=>\{[\s\S]*?\n\};/);
    expect(src).not.toBeNull();
    // eslint-disable-next-line no-new-func
    const fn = new Function(src[0] + ' return _qbRealmChanged;')();
    expect(fn({ realm_id: '9341' }, '9341')).toBe(false);
    expect(fn({ realm_id: '9341' }, '1234')).toBe(true);
    expect(fn({ companyId: '9341' }, '1234')).toBe(true);
    expect(fn({}, '9341')).toBe(false); // first connection: nothing approved yet to protect or reset
    expect(fn({ realm_id: '9341' }, '')).toBe(false); // unknown realm in the answer: do not reset
    expect(fn(null, '9341')).toBe(false);
  });

  test('a qb-api 409 (server owns the write) is a message, not a disconnect', () => {
    const b = block(/if\(r\.status===409\)\{/, 'if(r.status===401){');
    expect(b).not.toMatch(/setQBConfig/);
    expect(b).not.toMatch(/initialMigrationApproved/);
    expect(b).toMatch(/return null/);
  });

  test('a qb-api 401 drops connected + preflight but keeps the approval', () => {
    const b = block(/if\(r\.status===401\)\{/, 'return d;');
    expect(b).toMatch(/connected:false/);
    expect(b).toMatch(/preflight:null/);
    expect(b).not.toMatch(/initialMigrationApproved/);
  });

  test('connection_status:false keeps the approval; a realm change resets it', () => {
    const b = block(/body:JSON\.stringify\(\{action:'connection_status'\}\)\}\)\s*\.then\(r=>r\.ok\?r\.json\(\):null\)/, '.catch(()=>{});');
    expect(b).toMatch(/\.\.\.\(d\.connected\?\{\}:\{preflight:null,autoSync:'manual'\}\)/);
    expect(b).toMatch(/_qbRealmChanged\(prev,d\.realm_id\)\?\{preflight:null,initialMigrationApproved:false,autoSync:'manual'\}/);
    expect(b).not.toMatch(/\{preflight:null,initialMigrationApproved:false,autoSync:'manual'\}\)\}\)\);\s*\}\)\.catch/);
  });

  test('both OAuth reconnect paths reset the approval only on a realm change', () => {
    const matches = APP.match(/preflight:null,autoSync:'manual',\.\.\.\(_qbRealmChanged\(prev,[a-zA-Z_.]+\)\?\{initialMigrationApproved:false\}:\{\}\)/g) || [];
    expect(matches).toHaveLength(2);
  });

  test('an explicit Disconnect still resets everything', () => {
    expect(APP).toMatch(/connected:false,connectionError:'',realm_id:'',companyId:'',companyName:'',preflight:null,initialMigrationApproved:false/);
  });

  test('no other path clears the approval behind the owner\'s back', () => {
    // Every remaining literal reset is either the default config shape, the realm-change
    // branches, the explicit disconnect, or the account-mapping change (a mapping edit
    // legitimately requires a re-review — QBPage.js).
    const resets = APP.match(/initialMigrationApproved:false/g) || [];
    const defaults = (APP.match(/syncInterval:'daily',initialMigrationApproved:false/g) || []).length;
    const realmChange = (APP.match(/_qbRealmChanged\(prev,[a-zA-Z_.]+\)\?\{(?:preflight:null,)?initialMigrationApproved:false/g) || []).length;
    const disconnect = (APP.match(/companyName:'',preflight:null,initialMigrationApproved:false/g) || []).length;
    expect(resets.length).toBe(defaults + realmChange + disconnect);
  });
});
