const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { verifyUser } = require('./_shared');

// Cap the HTML payload — this renders arbitrary HTML in a headless browser, so
// bound the work an authenticated caller can trigger per request (~8MB of markup).
const MAX_HTML_BYTES = 8 * 1024 * 1024;

// Reuse the browser across warm Lambda invocations — cold-starting Chromium is
// the dominant cost (~7s). On warm containers this drops to ~1-2s total.
let _browser = null;

const getBrowser = async () => {
  if (_browser) {
    try {
      await _browser.pages(); // throws if browser has crashed
      return _browser;
    } catch {
      _browser = null;
    }
  }
  _browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  return _browser;
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Staff-only: the function renders caller-supplied HTML in a headless browser
  // (an SSRF/DoS/brand-forgery surface if left public). Require a valid team member.
  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, body: v.error };

  if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_HTML_BYTES) {
    return { statusCode: 413, body: 'Payload too large' };
  }

  let html, filename, margin, displayHeaderFooter, headerTemplate, footerTemplate;
  try {
    ({ html, filename, margin, displayHeaderFooter, headerTemplate, footerTemplate } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // The logo is inlined as a data URL by the client, but mockup images are
    // remote (Cloudinary) — domcontentloaded does not wait for them, so give
    // them a bounded window to finish loading or they render as empty boxes.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await Promise.race([
      page.evaluate(() => Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => { img.onload = img.onerror = resolve; }))
      )),
      new Promise(resolve => setTimeout(resolve, 6000)),
    ]).catch(() => {});
    // Optional repeating page header (e.g. production job sheets) — rendered by
    // Chromium into each page's top margin. Falls back to the standard margins
    // and no header for every other document type.
    const pdfBytes = await page.pdf({
      format: 'Letter',
      margin: margin || { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' },
      printBackground: true,
      ...(displayHeaderFooter ? {
        displayHeaderFooter: true,
        headerTemplate: headerTemplate || '<span></span>',
        footerTemplate: footerTemplate || '<span></span>',
      } : {}),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filename, content: Buffer.from(pdfBytes).toString('base64') }),
    };
  } finally {
    await page.close(); // close page but keep browser alive for next invocation
  }
};
