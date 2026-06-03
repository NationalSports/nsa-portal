const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let html, filename;
  try {
    ({ html, filename } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdfBytes = await page.pdf({
      format: 'Letter',
      margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' },
      printBackground: true,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filename, content: Buffer.from(pdfBytes).toString('base64') }),
    };
  } finally {
    await browser.close();
  }
};
