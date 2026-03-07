#!/usr/bin/env node
/**
 * NSA Portal — Automated Test Runner with Report
 *
 * Runs all business logic tests and generates:
 * 1. Console output (pass/fail summary)
 * 2. HTML report file (test-report.html)
 * 3. JSON results file (test-results.json) — for email/Claude Code import
 *
 * Usage:
 *   node scripts/run-tests.js              # Run tests + generate report
 *   node scripts/run-tests.js --email      # Run tests + email report
 *
 * SAFE: Only tests pure functions. Never touches database, UI, or production data.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'test-reports');
const JSON_REPORT = path.join(REPORT_DIR, 'test-results.json');
const HTML_REPORT = path.join(REPORT_DIR, 'test-report.html');
const SUMMARY_REPORT = path.join(REPORT_DIR, 'test-summary.txt');

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

console.log('\n🧪 NSA Portal — Running Business Logic Tests\n');
console.log('=' .repeat(50));

let rawOutput = '';
let exitCode = 0;

try {
  rawOutput = execSync(
    'npx react-scripts test --watchAll=false --verbose --json --outputFile=' + JSON_REPORT,
    { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }
  );
} catch (err) {
  rawOutput = (err.stdout || '') + '\n' + (err.stderr || '');
  exitCode = err.status || 1;
}

// Parse JSON results
let results = null;
try {
  if (fs.existsSync(JSON_REPORT)) {
    results = JSON.parse(fs.readFileSync(JSON_REPORT, 'utf8'));
  }
} catch (e) {
  console.error('Could not parse JSON results:', e.message);
}

// Build summary
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
let totalTests = 0, passed = 0, failed = 0, failedTests = [];
let suiteResults = [];

if (results && results.testResults) {
  results.testResults.forEach(suite => {
    const suiteName = path.basename(suite.name);
    const suiteData = { name: suiteName, tests: [] };

    suite.assertionResults.forEach(test => {
      totalTests++;
      const status = test.status === 'passed' ? 'PASS' : 'FAIL';
      if (test.status === 'passed') passed++;
      else {
        failed++;
        failedTests.push({
          suite: suiteName,
          test: test.ancestorTitles.join(' > ') + ' > ' + test.title,
          message: (test.failureMessages || []).join('\n').slice(0, 500)
        });
      }
      suiteData.tests.push({
        name: test.ancestorTitles.join(' > ') + ' > ' + test.title,
        status,
        duration: test.duration || 0,
        message: status === 'FAIL' ? (test.failureMessages || []).join('\n').slice(0, 500) : ''
      });
    });
    suiteResults.push(suiteData);
  });
}

// Console summary
console.log(`\n📊 Test Results — ${now}`);
console.log(`   Total: ${totalTests}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log(`   Pass Rate: ${totalTests > 0 ? Math.round(passed / totalTests * 100) : 0}%`);

if (failedTests.length > 0) {
  console.log('\n❌ FAILED TESTS:');
  failedTests.forEach((f, i) => {
    console.log(`\n   ${i + 1}. ${f.test}`);
    console.log(`      ${f.message.split('\n')[0]}`);
  });
}

console.log('\n' + '='.repeat(50));

// Generate plain text summary (for loading into Claude Code)
const summaryLines = [
  `NSA Portal — Test Report`,
  `Date: ${now}`,
  `Total: ${totalTests} | Passed: ${passed} | Failed: ${failed} | Pass Rate: ${totalTests > 0 ? Math.round(passed / totalTests * 100) : 0}%`,
  '',
];

if (failedTests.length > 0) {
  summaryLines.push('FAILED TESTS:');
  summaryLines.push('');
  failedTests.forEach((f, i) => {
    summaryLines.push(`${i + 1}. ${f.test}`);
    summaryLines.push(`   Error: ${f.message.split('\n').slice(0, 3).join('\n   ')}`);
    summaryLines.push('');
  });
  summaryLines.push('ACTION REQUIRED: Fix the above failures and re-run tests.');
} else {
  summaryLines.push('ALL TESTS PASSED — No issues found.');
}

fs.writeFileSync(SUMMARY_REPORT, summaryLines.join('\n'), 'utf8');

// Generate HTML report
const statusColor = failed > 0 ? '#dc2626' : '#16a34a';
const statusLabel = failed > 0 ? 'FAILURES DETECTED' : 'ALL TESTS PASSED';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NSA Portal — Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header h1 { font-size: 22px; margin-bottom: 8px; }
    .header .date { color: #64748b; font-size: 14px; }
    .summary { display: flex; gap: 16px; margin: 16px 0; }
    .stat { background: #f1f5f9; border-radius: 8px; padding: 16px; flex: 1; text-align: center; }
    .stat .num { font-size: 28px; font-weight: 700; }
    .stat .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .stat.pass .num { color: #16a34a; }
    .stat.fail .num { color: #dc2626; }
    .stat.total .num { color: #2563eb; }
    .status-bar { background: ${statusColor}; color: white; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 16px 0; }
    .suite { background: white; border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .suite-header { padding: 14px 20px; font-weight: 600; font-size: 15px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .test-row { padding: 10px 20px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 12px; font-size: 14px; }
    .test-row:last-child { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .badge.pass { background: #dcfce7; color: #16a34a; }
    .badge.fail { background: #fef2f2; color: #dc2626; }
    .test-name { flex: 1; }
    .test-time { color: #94a3b8; font-size: 12px; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px; margin: 8px 20px 12px; font-size: 13px; color: #991b1b; font-family: monospace; white-space: pre-wrap; word-break: break-word; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px; }
    .claude-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .claude-note strong { color: #1d4ed8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>NSA Portal — Test Report</h1>
      <div class="date">Generated: ${now}</div>
      <div class="summary">
        <div class="stat total"><div class="num">${totalTests}</div><div class="label">TOTAL</div></div>
        <div class="stat pass"><div class="num">${passed}</div><div class="label">PASSED</div></div>
        <div class="stat fail"><div class="num">${failed}</div><div class="label">FAILED</div></div>
        <div class="stat"><div class="num">${totalTests > 0 ? Math.round(passed / totalTests * 100) : 0}%</div><div class="label">PASS RATE</div></div>
      </div>
      <div class="status-bar">${statusLabel}</div>
    </div>

    ${failed > 0 ? `<div class="claude-note"><strong>To fix failures:</strong> Copy the file <code>test-reports/test-summary.txt</code> and paste it into Claude Code with the prompt: "Fix these test failures"</div>` : ''}

    ${suiteResults.map(suite => `
    <div class="suite">
      <div class="suite-header">${suite.name}</div>
      ${suite.tests.map(t => `
      <div class="test-row">
        <span class="badge ${t.status === 'PASS' ? 'pass' : 'fail'}">${t.status}</span>
        <span class="test-name">${t.name}</span>
        <span class="test-time">${t.duration}ms</span>
      </div>
      ${t.status === 'FAIL' ? `<div class="error-box">${t.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
      `).join('')}
    </div>
    `).join('')}

    <div class="footer">NSA Portal Automated Tests — Safe, read-only, no database or UI impact</div>
  </div>
</body>
</html>`;

fs.writeFileSync(HTML_REPORT, html, 'utf8');

console.log(`\n📄 Reports generated:`);
console.log(`   HTML:    ${HTML_REPORT}`);
console.log(`   JSON:    ${JSON_REPORT}`);
console.log(`   Summary: ${SUMMARY_REPORT}`);

// Check if --email flag is present
if (process.argv.includes('--email')) {
  console.log('\n📧 Sending email report...');
  require('./email-report.js')(html, { totalTests, passed, failed, now })
    .then(() => {
      console.log('   Email sent successfully!');
      process.exit(exitCode);
    })
    .catch(e => {
      console.error('   Email failed:', e.message);
      console.log('   Make sure REACT_APP_BREVO_API_KEY is set in your .env file');
      process.exit(exitCode);
    });
} else {
  process.exit(exitCode);
}
