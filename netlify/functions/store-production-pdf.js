const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { _internals: { authorize, loadCurrent, revisionFor } } = require('./store-production-packet');
const { packetPrintHtml, packetImageUrls } = require('../../src/productionPacket/print');
const { getTrustedSiteBaseUrl } = require('./_shared');
const compactImageUrl = value => {
 try {
  const u = new URL(value);
  if (u.hostname === 'b2bprod-res.cloudinary.com') u.pathname = u.pathname.replace(/\/images\/[^/]+\//, '/images/w_800,h_800,c_pad,f_auto,q_auto/');
  else if (u.hostname === 'res.cloudinary.com') u.pathname = u.pathname.replace('/image/upload/', '/image/upload/f_auto,q_auto,c_limit,w_800,h_800/');
  else if (u.hostname === 'images.salsify.com') u.pathname = u.pathname.replace(/\/image\/upload\/s--[^/]+--\/[^/]+\//, '/image/upload/c_pad,w_800,h_800,f_auto,q_auto/');
  return u.href;
 } catch { return value; }
};
const compactPacketImages = packet => {
 const copy = JSON.parse(JSON.stringify(packet));
 copy.decorations.forEach(d => {
  d.mocks = d.mocks.map(f => ({ ...f, url: compactImageUrl(f.url) }));
  if (d.storePreview?.image) d.storePreview.image = compactImageUrl(d.storePreview.image);
  if (d.storePreview?.art) d.storePreview.art = compactImageUrl(d.storePreview.art);
 });
 return copy;
};
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
  const printPacket = compactPacketImages(packet);
  const origin = getTrustedSiteBaseUrl(event);
  // Token goes in the fragment so hosting logs and Referer headers do not receive it.
  const onlineUrl = origin ? `${origin}/production-packet${body.token ? '#token='+body.token : '?store='+encodeURIComponent(ctx.storeId)+(ctx.soId?'&scope='+encodeURIComponent(ctx.soId):'')}` : '';
  const qrDataUrl = onlineUrl ? await QRCode.toDataURL(onlineUrl, {width:240,margin:1}) : '';
  browser = await puppeteer.launch({ args:chromium.args, defaultViewport:chromium.defaultViewport, executablePath:await chromium.executablePath(), headless:chromium.headless });
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  const allowed = new Set(packetImageUrls(printPacket));
  // No arbitrary HTML/URL input. Reject redirects and non-image network traffic.
  await page.setRequestInterception(true);
  page.on('request', req => {
   const url = req.url();
   if(url === qrDataUrl) return req.continue();
   let u; try {u=new URL(url);}catch {return req.abort();}
   const trusted = ['res.cloudinary.com','b2bprod-res.cloudinary.com','images.salsify.com'].includes(u.hostname) || /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);
   if(req.resourceType()==='image' && allowed.has(url) && trusted && u.protocol==='https:' && req.redirectChain().length===0) req.continue(); else req.abort();
  });
  await page.setContent(packetPrintHtml(printPacket,{onlineUrl,qrDataUrl,draft:!revision,generatedAt:revision?.created_at}),{waitUntil:'domcontentloaded',timeout:8000});
  await page.evaluate(()=>Promise.all(Array.from(document.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});setTimeout(resolve,8000);}))))
  await page.evaluate(()=>Array.from(document.images).filter(image=>!image.complete||!image.naturalWidth).forEach(image=>{const fallback=document.createElement('div');fallback.className='draft';fallback.textContent='Image unavailable in this PDF — open the online packet to view it.';image.replaceWith(fallback);}));
  const content = await page.pdf({format:'Letter',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;padding:0 36px;color:#60717d">National Sports Apparel · Production packet <span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',margin:{top:'.55in',bottom:'.65in',left:'.5in',right:'.5in'}});
  return {statusCode:200,headers,body:JSON.stringify({name:`production-packet-${revision?.id || 'draft'}.pdf`,content:Buffer.from(content).toString('base64')})};
 } catch(e) {return {statusCode:e.status || 500,headers,body:JSON.stringify({error:e.status?e.message:'PDF generation failed. Please retry.'})};}
 finally {if(browser) await browser.close();}
};
exports._internals = { compactImageUrl, compactPacketImages };
