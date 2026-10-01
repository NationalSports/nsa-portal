const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
function load(name, shared, syncLink) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'netlify/functions', name), 'utf8'), {
    exports, require: id => {
      if (id === './_shared') return shared;
      if (id === './_repGmailSync') return { syncLink };
      throw new Error('Unexpected import: ' + id);
    }, Date, console,
  });
  return exports.handler;
}
test('only the scheduled entry point is configured as scheduled', () => {
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const block = name => toml.split(`[functions."${name}"]`)[1].split('\n[')[0];
  assert.doesNotMatch(block('rep-gmail-sync'), /^\s*schedule\s*=/m);
  assert.match(block('rep-gmail-scheduled'), /schedule = "\*\/10 \* \* \* \*"/);
});
test('forged scheduling markers do not bypass manual authentication', async () => {
  let checked = 0;
  const handler = load('rep-gmail-sync.js', {
    corsHeaders: () => ({}),
    verifyUser: async () => { checked++; return { ok: false, status: 401, error: 'Unauthorized' }; },
  }, () => assert.fail('must not sync'));
  const result = await handler({ httpMethod: 'POST', headers: { 'x-nf-event': 'schedule' }, body: '{"next_run":"tomorrow"}' });
  assert.equal(result.statusCode, 401);
  assert.equal(checked, 1);
});
test('manual sync uses the authenticated rep, ignores body mailbox selection', async () => {
  const link = { team_member_id: 'steve' };
  const admin = { from: table => {
    assert.equal(table, 'rep_google_links');
    return { select: () => ({ eq: (key, value) => {
      assert.equal(key, 'team_member_id'); assert.equal(value, 'steve');
      return { maybeSingle: async () => ({ data: link }) };
    } }) };
  } };
  let synced = 0;
  const handler = load('rep-gmail-sync.js', {
    corsHeaders: () => ({}), verifyUser: async () => ({ ok: true, admin, teamMemberId: 'steve' }),
  }, async (db, actual, deadline) => {
    assert.equal(db, admin); assert.equal(actual, link); assert.ok(deadline >= Date.now());
    synced++; return { analyzed: 2, important: 1, error: null };
  });
  const result = await handler({ httpMethod: 'POST', body: '{"team_member_id":"other"}' });
  assert.equal(result.statusCode, 200); assert.equal(synced, 1);
  assert.equal(JSON.parse(result.body).analyzed, 2);
});
test('disconnected rep receives an actionable error without syncing', async () => {
  const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
  const handler = load('rep-gmail-sync.js', {
    corsHeaders: () => ({}), verifyUser: async () => ({ ok: true, admin, teamMemberId: 'steve' }),
  }, () => assert.fail('must not sync'));
  const result = await handler({ httpMethod: 'POST' });
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).error, 'Connect Google first');
});
test('scheduled worker processes due mailboxes through the same sync implementation', async () => {
  const seen = [];
  const admin = { from: () => ({ select: () => ({ or: filter => {
    assert.match(filter, /last_synced_at.is.null,last_synced_at.lt./);
    return { order: async () => ({ data: [{ team_member_id: 'a' }, { team_member_id: 'b' }] }) };
  } }) }) };
  const handler = load('rep-gmail-scheduled.js', { getSupabaseAdmin: () => admin }, async (db, link) => {
    assert.equal(db, admin); seen.push(link.team_member_id);
  });
  assert.equal((await handler()).statusCode, 200);
  assert.deepEqual(seen, ['a', 'b']);
});
