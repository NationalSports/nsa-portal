/**
 * NSA Portal — Email Test Report via Brevo
 *
 * Sends the HTML test report to the configured email.
 * Uses the same Brevo API key already in the portal's .env.
 *
 * Usage:
 *   Called automatically by run-tests.js --email
 *   Or standalone: EMAIL_TO=you@example.com node scripts/email-report.js
 *
 * Required env vars:
 *   REACT_APP_BREVO_API_KEY  — already in your .env
 *   TEST_REPORT_EMAIL        — recipient email (set in .env)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env manually (no dotenv dependency needed)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
  return env;
}

function sendReport(htmlContent, stats) {
  const env = loadEnv();
  const apiKey = process.env.REACT_APP_BREVO_API_KEY || env.REACT_APP_BREVO_API_KEY;
  // Route through the static-IP relay when configured (see /brevo-relay) so this
  // doesn't trip Brevo's "new IP" alerts when run from CI. Falls back to direct.
  const relayUrl = process.env.BREVO_RELAY_URL || env.BREVO_RELAY_URL;
  const relaySecret = process.env.BREVO_RELAY_SECRET || env.BREVO_RELAY_SECRET;
  const emailTo = process.env.TEST_REPORT_EMAIL || env.TEST_REPORT_EMAIL;

  if (!apiKey && !relayUrl) throw new Error('Set BREVO_RELAY_URL (preferred) or REACT_APP_BREVO_API_KEY in environment or .env file');
  if (!emailTo) throw new Error('TEST_REPORT_EMAIL not set. Add TEST_REPORT_EMAIL=you@example.com to your .env file');

  const statusEmoji = stats.failed > 0 ? '❌' : '✅';
  const subject = `${statusEmoji} NSA Portal Tests — ${stats.passed}/${stats.totalTests} passed (${stats.now})`;

  const payload = JSON.stringify({
    sender: { name: 'NSA Portal Tests', email: 'tests@nationalsportsapparel.com' },
    to: [{ email: emailTo }],
    subject,
    htmlContent
  });

  // Resolve target (relay or Brevo direct) and auth header.
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  };
  let transport, hostname, port, reqPath;
  if (relayUrl) {
    const u = new URL(relayUrl.replace(/\/+$/, '') + '/v3/smtp/email');
    transport = u.protocol === 'http:' ? http : https;
    hostname = u.hostname;
    port = u.port || (u.protocol === 'http:' ? 80 : 443);
    reqPath = u.pathname;
    headers['x-relay-secret'] = relaySecret || '';
  } else {
    transport = https;
    hostname = 'api.brevo.com';
    port = 443;
    reqPath = '/v3/smtp/email';
    headers['api-key'] = apiKey;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname,
      port,
      path: reqPath,
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Brevo API returned ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Allow both module.exports and direct execution
module.exports = sendReport;

if (require.main === module) {
  // Direct execution — read the saved HTML report
  const reportPath = path.join(__dirname, '..', 'test-reports', 'test-report.html');
  if (!fs.existsSync(reportPath)) {
    console.error('No test report found. Run "npm run test:report" first.');
    process.exit(1);
  }
  const html = fs.readFileSync(reportPath, 'utf8');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  sendReport(html, { totalTests: '?', passed: '?', failed: '?', now })
    .then(() => console.log('Email sent!'))
    .catch(e => { console.error('Email failed:', e.message); process.exit(1); });
}
