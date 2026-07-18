// Deterministic Playwright test of the mock CLICK portal.
//
// Drives the exact flow add_to_cart.md prescribes (login → one search with all
// SKUs → ADD ALL TO CART → PO → address → delivery date → sizes) and asserts
// the recorded state, including that a delivery-date change clears quantities
// and that unavailable cells reject input. This validates the harness itself
// so run-agent.mjs failures point at the agent, not the mock.
//
// Run:  node test/spec.mjs

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;

const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${cond ? '' : '  — ' + detail}`);
  if (!cond) failures++;
}

const mock = spawn(process.execPath, [new URL('./mock-portal.mjs', import.meta.url).pathname, String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage();
  const state = async () => (await (await fetch(`${BASE}/api/state`)).json());

  // Step 0: login
  await page.goto(BASE);
  await page.fill('input[name="user"]', 'testrep');
  await page.fill('input[name="pass"]', 'test123');
  await page.click('button:has-text("LOGIN")');
  await page.waitForURL('**/catalog');

  // Step 1: all SKUs in ONE search, press Enter
  await page.click('input[type="search"]');
  await page.fill('input[type="search"]', 'JW6608 JW6600 KB5529 KE9493');
  await page.press('input[type="search"]', 'Enter');
  await page.waitForURL('**/search**');
  check('search shows result cards for all 4 SKUs', (await page.locator('.card:has-text("Article:")').count()) === 4);

  // Step 2: ADD ALL TO CART
  await page.click('button:has-text("ADD ALL TO CART")');
  await page.waitForURL('**/cart');
  check('add-all put all 4 SKUs in the cart', (await state()).cart.length === 4, JSON.stringify((await state()).cart));

  // Step 4 (prompt numbering): replace the pre-filled PO
  check('PO field pre-fills with an account name', await page.inputValue('#po') === 'FPU Soccer');
  await page.click('#po');
  await page.press('#po', 'Control+a');
  await page.fill('#po', 'PO 9999 TEST');
  await page.press('#po', 'Tab');
  await page.waitForTimeout(200);
  check('PO recorded as replaced value', (await state()).po === 'PO 9999 TEST', (await state()).po);

  // Step 5: one-time delivery address
  await page.click('button:has-text("Change delivery location")');
  await page.click('button:has-text("Add one-time delivery location")');
  await page.fill('#a_name', 'Fresno Pacific Tennis');
  await page.fill('#a_line1', '1717 S Chestnut Ave');
  await page.fill('#a_city', 'Fresno');
  await page.fill('#a_state', 'CA');
  await page.fill('#a_zip', '93702');
  await page.click('button:has-text("Use this address")');
  await page.waitForLoadState('load');
  const addr = (await state()).address;
  check('one-time address recorded', addr.type === 'one_time' && addr.line1 === '1717 S Chestnut Ave', JSON.stringify(addr));

  // Step 6: availability — JW6600 L is hatched today with a short restock note
  check('JW6600 L cell hatched with restock note', (await page.locator('td.hatched:has-text("Re-stock")').count()) >= 2);
  check('KE9493 all cells hatched with NO date', (await page.locator('.card:has-text("KE9493") td.hatched').count()) === 8
    && (await page.locator('.card:has-text("KE9493") td.hatched:has-text("Re-stock")').count()) === 0);

  // Enter a quantity BEFORE the date change to prove clearing happens
  await page.fill('input.qty[data-sku="JW6608"][data-size="S"]', '11');
  await page.press('input.qty[data-sku="JW6608"][data-size="S"]', 'Tab');
  await page.waitForTimeout(200);
  check('qty accepted for in-stock cell', (await state()).quantities.JW6608?.S === 11);

  // Move delivery date to the short restock (+7d) → JW6600 L becomes available, qtys clear
  await page.click('#dateChip');
  await page.fill('#datePick', daysFromNow(7));
  await page.click('button:has-text("CHOOSE")');
  // the CHOOSE handler fetches then reloads — wait for the reloaded grid
  await page.waitForSelector('input.qty[data-sku="JW6600"][data-size="L"]', { timeout: 5000 }).catch(() => {});
  const s1 = await state();
  check('delivery date recorded', s1.deliveryDate === daysFromNow(7), s1.deliveryDate);
  check('date change cleared previously entered quantities', Object.keys(s1.quantities).length === 0, JSON.stringify(s1.quantities));
  check('JW6600 L cell now enterable at the new date', (await page.locator('input.qty[data-sku="JW6600"][data-size="L"]').count()) === 1);
  check('KB5529 M (+30d restock) still hatched', (await page.locator('.card:has-text("KB5529") td.hatched').count()) === 1);

  // Re-enter quantities for the non-skipped SKUs
  for (const [sku, size, qty] of [['JW6608', 'XS', 2], ['JW6608', 'S', 11], ['JW6608', 'M', 8], ['JW6608', 'L', 2], ['JW6600', 'S', 5], ['JW6600', 'L', 5]]) {
    await page.fill(`input.qty[data-sku="${sku}"][data-size="${size}"]`, String(qty));
    await page.press(`input.qty[data-sku="${sku}"][data-size="${size}"]`, 'Tab');
  }
  await page.waitForTimeout(300);
  const s2 = await state();
  check('all re-entered quantities recorded under correct sizes',
    s2.quantities.JW6608?.XS === 2 && s2.quantities.JW6608?.S === 11 && s2.quantities.JW6608?.M === 8
    && s2.quantities.JW6608?.L === 2 && s2.quantities.JW6600?.S === 5 && s2.quantities.JW6600?.L === 5,
    JSON.stringify(s2.quantities));
  check('skipped SKU KB5529 has no quantities', !s2.quantities.KB5529);
  check('order was NOT submitted', s2.submitted === false);
} finally {
  await browser.close();
  mock.kill();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll harness checks passed');
process.exit(failures ? 1 : 0);
