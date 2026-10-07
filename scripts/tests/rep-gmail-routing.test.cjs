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
  assert.match(block('rep-gmail-scheduled'), /schedule = "0 \* \* \* \*"/);
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
function syncFixture(failSecondPage = false) {
  const saved = [], patches = [], queries = [];
  const module = { exports: {} };
  const admin = { from: () => ({
    select: () => ({ then: resolve => resolve({data:[]}), eq: () => ({ in: async () => ({ data: [] }), maybeSingle: async () => ({ data: { name: 'Steve' } }) }) }),
    upsert: async row => { saved.push(row); return {}; },
    update: patch => ({ eq: async () => { patches.push(patch); return {}; } }),
  }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'netlify/functions/_repGmailSync.js'), 'utf8'), {
    module, Date, console: { error: () => {} }, process: { env: { ANTHROPIC_API_KEY: 'mock' } },
    fetch: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"important":true,"summary":"Reply to coach","tasks":[],"deadlines":[]}' }] }) }),
    require: id => {
      if (id === './_repEmailWork') return { PILOT: 'pilot-only', queueWork: async () => null };
      if (id === './_customerEmailFilter') return require('../../netlify/functions/_customerEmailFilter');
      if (id === './_repGoogle') return { accessTokenForLink: async () => 'mock-token' };
      if (id === './_gmailAi') return {
        gmailFetch: async (token, url) => {
          queries.push(url);
          if (!url.includes('pageToken=')) return { messages: Array.from({length:50}, (_,i) => ({id:String(60-i)})), nextPageToken: 'next/page' };
          if (failSecondPage) throw new Error('Gmail unavailable');
          return { messages: Array.from({length:10}, (_,i) => ({id:String(10-i)})) };
        },
        getMessage: async (token, id) => id,
        parseMessage: id => ({ gmail_message_id: id, received_at: new Date(1790800000000 + Number(id)*1000).toISOString(), to_emails: [], cc_emails: [], subject: 'Coach question' }),
      };
      throw new Error(id);
    },
  });
  return { run: () => module.exports.syncLink(admin, { team_member_id: 'steve', google_email: 'steve@example.com' }, Date.now()+20000), saved, patches, queries };
}
test('uncategorized inbox mail is included and all pages are listed before newest-first import', async () => {
  const f = syncFixture(); const result = await f.run();
  assert.equal(result.error, null); assert.equal(result.analyzed, 6);
  assert.deepEqual(f.saved.map(r => r.gmail_message_id), ['60','59','58','57','56','55']);
  const query = new URL('https://gmail.test'+f.queries[0]).searchParams.get('q');
  assert.doesNotMatch(query, /category:primary/);
  assert.match(query, /in:inbox.*-category:promotions.*-category:social.*-category:forums/);
  assert.match(f.queries[1], /pageToken=next%2Fpage/);
  assert.equal(result.remaining,54);
  assert.equal(f.patches.at(-1).gmail_cursor_ms,null);
});
test('partial listing failure does not advance the cursor or import an incomplete batch', async () => {
  const f = syncFixture(true); assert.equal((await f.run()).error, 'Gmail unavailable');
  assert.equal(f.saved.length, 0);
  assert.ok(f.patches.every(p => !Object.hasOwn(p, 'gmail_cursor_ms')));
});
