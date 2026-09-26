const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

function worker(fetch, overrides = {}) {
  let handler;
  const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-scheduled-emails/index.ts'), 'utf8').replace(/^import .*;\n/gm, '');
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', EMAIL_ROUTER_URL: 'https://portal.test/.netlify/functions/scheduled-email-send', ...overrides };
  const context = { fetch, URL, Response, Request, console, Deno: { env: { get: (name) => env[name] } }, createClient: () => ({}), serve: (fn) => { handler = fn; } };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { send: (row) => context.sendOne(row), handler };
}
const row = { to_emails: [{ email: 'a@district.edu' }], cc_emails: [], subject: 'Invoice', html_content: 'Hi', attachments: [] };
test('scheduled sends call the authenticated shared router, never Brevo directly', async () => {
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messageId: 'gmail:123' }) }));
  const result = await worker(fetch).send(row);
  expect(result).toMatchObject({ ok: true, messageId: 'gmail:123' });
  expect(fetch.mock.calls[0][0]).toBe('https://portal.test/.netlify/functions/scheduled-email-send');
  expect(fetch.mock.calls[0][1].headers['x-internal-secret']).toBe('secret');
});
test('missing configuration stops sends; uncertain outcomes remain marked uncertain', async () => {
  const fetch = jest.fn();
  expect(await worker(fetch, { EMAIL_ROUTER_URL: '' }).send(row)).toMatchObject({ ok: false });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRejectedValue(new Error('connection closed'));
  expect(await worker(fetch).send(row)).toMatchObject({ ok: false, uncertain: true });
});
