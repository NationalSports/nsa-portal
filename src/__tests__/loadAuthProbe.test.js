import fs from 'fs';
import path from 'path';

// A revoked/expired login fails every boot-load table with 401. The load must verify the session
// (and so reach the login screen) instead of only marking the table "timed out" and retrying forever.
test('a failed page that is an auth error probes the session before being treated as a timeout', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dbEngine.js'), 'utf8');
  const branch = src.slice(src.indexOf("if(c0==='error'){"), src.indexOf("_lastLoadTimedOut.add(table);return first;"));
  expect(branch).toMatch(/first\.status===401\|\|_isAuthError\(first\.error\)\)_probeDeniedSession\(table\)/);
});
