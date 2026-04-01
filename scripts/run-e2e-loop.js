#!/usr/bin/env node
/**
 * Continuous E2E Test Runner — runs Playwright tests in a loop all day.
 *
 * Usage:
 *   node scripts/run-e2e-loop.js                  # default: 30min intervals, run 24h
 *   node scripts/run-e2e-loop.js --interval 15    # every 15 minutes
 *   node scripts/run-e2e-loop.js --hours 8         # run for 8 hours
 *   node scripts/run-e2e-loop.js --once             # single run with report
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
};

const INTERVAL_MINS = parseInt(getArg('--interval', '30'), 10);
const HOURS = parseInt(getArg('--hours', '24'), 10);
const ONCE = args.includes('--once');
const REPORT_DIR = path.join(__dirname, '..', 'test-reports');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

function runTests() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(REPORT_DIR, `e2e-run-${ts}.log`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`E2E Test Run: ${new Date().toLocaleString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    const output = execSync(
      'npx playwright test --reporter=list 2>&1',
      { cwd: path.join(__dirname, '..'), timeout: 300000, encoding: 'utf8' }
    );
    console.log(output);
    fs.writeFileSync(logFile, `PASS — ${new Date().toLocaleString()}\n\n${output}`);

    // Count pass/fail
    const passed = (output.match(/✓|passed/gi) || []).length;
    const failed = (output.match(/✗|failed/gi) || []).length;
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    return { passed, failed, error: null };
  } catch (e) {
    const output = e.stdout || e.message;
    console.error('TESTS FAILED:\n', output);
    fs.writeFileSync(logFile, `FAIL — ${new Date().toLocaleString()}\n\n${output}`);
    return { passed: 0, failed: 1, error: output };
  }
}

// Track overall stats
const stats = { runs: 0, totalPassed: 0, totalFailed: 0, startedAt: new Date() };

function printSummary() {
  const elapsed = ((Date.now() - stats.startedAt.getTime()) / 3600000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`  Runs: ${stats.runs}`);
  console.log(`  Total passed: ${stats.totalPassed}`);
  console.log(`  Total failed: ${stats.totalFailed}`);
  console.log(`  Elapsed: ${elapsed}h`);
  console.log(`${'='.repeat(60)}`);

  // Write summary file
  const summary = {
    runs: stats.runs,
    totalPassed: stats.totalPassed,
    totalFailed: stats.totalFailed,
    startedAt: stats.startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    elapsedHours: parseFloat(elapsed),
  };
  fs.writeFileSync(
    path.join(REPORT_DIR, 'e2e-loop-summary.json'),
    JSON.stringify(summary, null, 2)
  );
}

async function main() {
  console.log(`NSA Portal E2E Continuous Testing`);
  console.log(`Interval: ${INTERVAL_MINS}min | Duration: ${ONCE ? 'once' : HOURS + 'h'}`);
  console.log(`Reports: ${REPORT_DIR}`);

  if (ONCE) {
    const result = runTests();
    stats.runs++;
    stats.totalPassed += result.passed;
    stats.totalFailed += result.failed;
    printSummary();
    process.exit(result.failed > 0 ? 1 : 0);
  }

  const endTime = Date.now() + HOURS * 3600000;

  while (Date.now() < endTime) {
    const result = runTests();
    stats.runs++;
    stats.totalPassed += result.passed;
    stats.totalFailed += result.failed;
    printSummary();

    if (Date.now() >= endTime) break;

    const waitMs = INTERVAL_MINS * 60000;
    const nextRun = new Date(Date.now() + waitMs);
    console.log(`\nNext run at ${nextRun.toLocaleTimeString()} (in ${INTERVAL_MINS}min)...`);
    await new Promise(r => setTimeout(r, waitMs));
  }

  console.log('\nContinuous testing complete.');
  printSummary();
}

main().catch(e => { console.error(e); process.exit(1); });
