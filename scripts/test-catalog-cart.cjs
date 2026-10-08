// Execute the catalog's actual submission and auth effect with controlled
// dependencies. No network calls or production writes are made by these tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/storefront/AdidasInventory.js'), 'utf8');
const submitSource = source.slice(source.indexOf('  const submit = async () => {'), source.indexOf('\n  return (', source.indexOf('  const submit = async () => {')));

async function submitScenario({ account = null, save, response = { ok: true, id: 'request-1' }, httpOk = true } = {}) {
  const state = { cart: [{ sku: 'KB9113', size: 'L', qty: 1 }], requests: 0, saved: false, warning: '', error: '' };
  const ctx = {
    canSend: true, state: 'idle', account, onSaveOrder: save,
    coach: { name: 'Vince', email: 'vincepieretti@hotmail.com', phone: '', team: 'Memorial' },
    orderName: 'Shortlist', notes: '', list: state.cart, images: [],
    setState: value => { state.status = value; },
    setErrMsg: value => { state.error = value; },
    setSubmitSaved: value => { state.saved = value; },
    setSaveWarning: value => { state.warning = value; },
    setImages: () => {}, clearList: () => { state.cart = []; },
    fetch: async () => { state.requests++; return { ok: httpOk, json: async () => response }; },
  };
  await vm.runInNewContext(`${submitSource}\nsubmit();`, ctx);
  return state;
}

test('guest submission keeps the cart available for further editing', async () => {
  const s = await submitScenario();
  assert.equal(s.status, 'sent');
  assert.equal(s.cart.length, 1);
  assert.equal(s.saved, false);
});
test('account submission marks a confirmed saved order and retains cart', async () => {
  let args;
  const s = await submitScenario({ account: {}, save: async a => { args = a; return { data: { id: 'saved-1' } }; } });
  assert.equal(s.saved, true);
  assert.equal(args.submit.requestId, 'request-1');
  assert.equal(s.cart.length, 1);
});
for (const [label, save] of [
  ['returned error', async () => ({ error: 'session expired' })],
  ['thrown error', async () => { throw new Error('network down'); }],
  ['missing result', async () => undefined],
]) {
  test(`successful request with ${label} warns without encouraging duplicate submission`, async () => {
    const s = await submitScenario({ account: {}, save });
    assert.equal(s.status, 'sent');
    assert.equal(s.saved, false);
    assert.match(s.warning, /request was sent.*could not save/i);
    assert.equal(s.requests, 1);
    assert.equal(s.cart.length, 1);
  });
}
test('request rejection preserves cart and skips account save', async () => {
  let saves = 0;
  const s = await submitScenario({ account: {}, save: async () => { saves++; }, httpOk: false, response: { ok: false, error: 'Could not send' } });
  assert.equal(s.status, 'error');
  assert.equal(s.error, 'Could not send');
  assert.equal(s.cart.length, 1);
  assert.equal(saves, 0);
});

const effectStart = source.indexOf('  useEffect(() => {\n    let alive = true;', source.indexOf('// ── Coach account:'));
const effectEnd = source.indexOf('\n  }, []);', effectStart);
const effectSource = source.slice(effectStart + '  useEffect(() => {'.length, effectEnd);
function authScenario() {
  let callback, cleanup, coach, queries = 0, timerId = 0;
  const timers = new Map();
  const pending = [];
  const supabase = {
    auth: {
      getSession: () => new Promise(() => {}),
      onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) {
      queries++;
      const chain = { select: () => chain, eq: () => chain, limit: () => chain,
        then(resolve) { pending.push({ table, resolve }); } };
      return chain;
    },
  };
  cleanup = vm.runInNewContext(`(() => {${effectSource}})()`, {
    supabase, setCoach: c => { coach = c; },
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    event: session => callback('TOKEN_REFRESHED', session),
    flush: () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } },
    resolve: async data => { await new Promise(resolve => setImmediate(resolve)); pending.shift().resolve({ data }); await new Promise(resolve => setImmediate(resolve)); },
    cleanup,
    get queries() { return queries; }, get coach() { return coach; }, get timers() { return timers.size; },
  };
}
const session = { user: { email: 'vincepieretti@hotmail.com' } };
test('token refresh callback returns before profile queries start', async () => {
  const s = authScenario();
  assert.equal(s.event(session), undefined);
  assert.equal(s.queries, 0);
  s.flush();
  assert.equal(s.queries, 1);
  await s.resolve([{ email: session.user.email, name: 'Vince', customer_id: 'team', status: 'active' }]);
  await s.resolve([{ name: 'Memorial' }]);
  assert.equal(s.coach.email, session.user.email);
});
test('sign-out wins over an older in-flight profile lookup', async () => {
  const s = authScenario();
  s.event(session); s.flush();
  s.event(null);
  await s.resolve([{ customer_id: 'team', status: 'active' }]);
  await s.resolve([{ name: 'Memorial' }]);
  assert.equal(s.coach, null);
});
test('unmount cancels a deferred auth lookup', () => {
  const s = authScenario();
  s.event(session);
  s.cleanup(); s.flush();
  assert.equal(s.timers, 0);
  assert.equal(s.queries, 0);
});
