const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { _internals: { authorize, loadCurrent, revisionFor } } = require('./store-production-packet');
const { packetPrintHtml } = require('../../src/productionPacket/print');
const { getTrustedSiteBaseUrl } = require('./_shared');
exports.handler = async event => {
 const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
 if(event.httpMethod !== 'POST') return { statusCode:405, headers, body:'{}' };
 let browser;
 try {
  if ((event.body || '').length > 40000) throw Object.assign(new Error('Request too large'), {status:413});
  const body = JSON.parse(event.body || '{}');
  const ctx = await authorize(event, body);
  const revision = body.revision_id ? await revisionFor(ctx, body.revision_id) : null;
  const packet = revision ? { ...revision.snapshot, revisionId: revision.id } : (await loadCurrent(ctx)).packet;
  if (!revision && packet.fingerprint !== body.fingerprint) throw Object.assign(new Error('The packet changed. Refresh before downloading.'), {status:409});
  const origin = getTrustedSiteBaseUrl(event);
  // Token goes in the fragment so hosting logs and Referer headers do not receive it.
  const onlineUrl = origin ? `${origin}/production-packet${body.token ? '#token='+body.token : '?store='+encodeURIComponent(ctx.storeId)+(ctx.soId?'&scope='+encodeURIComponent(ctx.soId):'')}` : '';
  const qrDataUrl = onlineUrl ? await QRCode.toDataURL(onlineUrl, {width:240,margin:1}) : '';
  browser = await puppeteer.launch({ args:chromium.args, defaultViewport:chromium.defaultViewport, executablePath:await chromium.executablePath(), headless:chromium.headless });
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  const allowed = new Set(packet.decorations.flatMap(d=>d.mocks.map(f=>f.url)));
  // No arbitrary HTML/URL input. Reject redirects and non-image network traffic.
  await page.setRequestInterception(true);
  page.on('request', req => {
   const url = req.url();
   if(url === qrDataUrl) return req.continue();
   let u; try {u=new URL(url);}catch {return req.abort();}
   const trusted = u.hostname === 'res.cloudinary.com' || /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);
   if(req.resourceType()==='image' && allowed.has(url) && trusted && u.protocol==='https:' && req.redirectChain().length===0) req.continue(); else req.abort();
  });
  await page.setContent(packetPrintHtml(packet,{onlineUrl,qrDataUrl,draft:!revision,generatedAt:revision?.created_at}),{waitUntil:'networkidle0',timeout:15000});
  const failed = await page.evaluate(()=>Array.from(document.images).filter(i=>!i.complete || !i.naturalWidth).length);
  if(failed) throw Object.assign(new Error(`${failed} mock image(s) could not load. Retry before downloading the production packet.`),{status:409});
  const content = await page.pdf({format:'Letter',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;padding:0 36px;color:#60717d">National Sports Apparel · Production packet <span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',margin:{top:'.55in',bottom:'.65in',left:'.5in',right:'.5in'}});
  return {statusCode:200,headers,body:JSON.stringify({name:`production-packet-${revision?.id || 'draft'}.pdf`,content:Buffer.from(content).toString('base64')})};
 } catch(e) {return {statusCode:e.status || 500,headers,body:JSON.stringify({error:e.status?e.message:'PDF generation failed. Please retry.'})};}
 finally {if(browser) await browser.close();}
};
