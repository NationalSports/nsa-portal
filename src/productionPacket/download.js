import { packetPrintHtml } from './print';
import { safeUrl } from './model';

const HTML2PDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.14.0/html2pdf.bundle.min.js';
let libraryPromise;

function loadPdfLibrary(timeoutMs = 15000) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('PDF download requires a browser.'));
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise((resolve, reject) => {
    let script = [...document.scripts].find(s => s.src === HTML2PDF_SRC);
    let timer;
    const fail = error => { clearTimeout(timer); script?.remove(); libraryPromise = null; reject(error); };
    const loaded = () => { clearTimeout(timer); if (window.html2pdf) resolve(window.html2pdf); else fail(new Error('The PDF generator loaded without its API.')); };
    timer = setTimeout(() => fail(new Error('Timed out loading the PDF generator. Check your connection and try again.')), timeoutMs);
    if (!script) { script = document.createElement('script'); script.src = HTML2PDF_SRC; script.async = true; }
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', () => fail(new Error('Could not load the PDF generator. Check your connection and try again.')), { once: true });
    if (!script.isConnected) document.head.appendChild(script);
  }).catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}

export function validatePacketImages(images, { timeoutMs = 12000 } = {}) {
  return Promise.all(Array.from(images || []).map(image => {
    if (image.complete) return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error(`Could not load packet image: ${image.currentSrc || image.src || 'unknown image'}`));
    return new Promise((resolve, reject) => {
      const src = image.currentSrc || image.src || 'unknown image';
      const timer = setTimeout(() => reject(new Error(`Timed out loading packet image: ${src}`)), timeoutMs);
      image.addEventListener('load', () => { clearTimeout(timer); image.naturalWidth > 0 ? resolve() : reject(new Error(`Could not decode packet image: ${src}`)); }, { once: true });
      image.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Could not load packet image: ${src}`)); }, { once: true });
    });
  }));
}

export function createProductionFileManifest(packet) {
  const rows = [];
  (packet.decorations || []).forEach(d => (d.productionFiles || []).forEach(file => rows.push({ group: `${d.soId || 'Unbatched'} · ${d.sku} · ${d.position}`, name: file.name, url: file.url })));
  (packet.messages || []).forEach(m => (m.attachments || []).forEach(file => rows.push({ group: `${m.soId || 'Message'} · ${m.kind || 'attachment'}`, name: file.name, url: file.url })));
  return rows.reduce((groups, row) => { (groups[row.group] ||= []).push({ name: row.name, url: row.url }); return groups; }, {});
}

export function printPacket(packet, options = {}) {
  if (typeof window === 'undefined') throw new Error('Printing requires a browser.');
  const win = window.open('', '_blank');
  if (!win) throw new Error('The print window was blocked. Allow pop-ups and try again.');
  return new Promise((resolve, reject) => {
    let timer;
    const failed = error => { clearTimeout(timer); try { win.close(); } catch (_) {} reject(error); };
    const ready = async () => {
      clearTimeout(timer);
      try { await validatePacketImages(win.document.images, { timeoutMs: options.imageTimeoutMs || 20000 }); win.focus(); win.print(); resolve(win); }
      catch (error) { failed(error); }
    };
    win.addEventListener('load', ready, { once: true });
    timer = setTimeout(() => failed(new Error('Timed out preparing the print view.')), options.documentTimeoutMs || 20000);
    try { win.document.open(); win.document.write(packetPrintHtml(packet, options)); win.document.close(); }
    catch (error) { failed(error); }
  });
}

export async function bundleProductionFiles(packet, { maxBytes = 100 * 1024 * 1024, fetchImpl = fetch } = {}) {
  if (typeof window === 'undefined') throw new Error('Production file downloads require a browser.');
  const JSZip = (await import('jszip')).default;
  const manifest = createProductionFileManifest(packet), entries = Object.entries(manifest).flatMap(([group, files]) => files.map(file => ({ ...file, group })));
  if (!entries.length) throw new Error('No production files are attached to this packet.');
  const zip = new JSZip(); let total = 0, cursor = 0; const failures = [];
  const safePart = value => String(value || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100);
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const fileIndex=cursor++; const entry = entries[fileIndex], url = safeUrl(entry.url);
      if (!url) { failures.push(`${entry.name}: unsafe or missing URL`); continue; }
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000);
      try {
        const response = await fetchImpl(url, { credentials: 'omit', signal:controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if(Number(response.headers?.get('content-length'))>maxBytes-total)throw new Error('File exceeds the remaining archive size limit');
        const blob = await response.blob(); total += blob.size;
        if (total > maxBytes) throw new Error(`archive exceeds ${maxBytes} bytes`);
        zip.file(`${safePart(entry.group)}/${fileIndex+1}-${safePart(entry.name)}`, blob);
      } catch (error) { failures.push(`${entry.name}: ${error.message}`); } finally { clearTimeout(timer); }
    }
  }));
  if (failures.length) throw new Error(`Could not bundle every production file; no archive was downloaded. ${failures.join('; ')}`);
  const blob = await zip.generateAsync({ type: 'blob' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `production-files-${safePart(packet.revisionId || 'draft')}.zip`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return blob;
}

export async function downloadPacketPdf(packet, { onlineUrl = '', generatedAt = new Date().toISOString(), draft = true, imageTimeoutMs = 12000, scriptTimeoutMs = 15000, ...printOptions } = {}) {
  const html2pdf = await loadPdfLibrary(scriptTimeoutMs);
  const frame = document.createElement('iframe');
  frame.title = 'Production packet PDF renderer';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  try {
    const packetUrl = onlineUrl || window.location.href, qrDataUrl = await createQr(packetUrl);
    await new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error('Could not prepare the PDF layout.'));
      frame.srcdoc = packetPrintHtml(packet, { onlineUrl: packetUrl, qrDataUrl, generatedAt, draft, ...printOptions });
    });
    await validatePacketImages(frame.contentDocument.images, { timeoutMs: imageTimeoutMs });
    const filename = `production-packet-${packet.revisionId || 'draft'}.pdf`;
    const blob = await html2pdf().set({ margin: 0, filename, enableLinks: true, image: { type: 'jpeg', quality: .9 }, html2canvas: { scale: 1, useCORS: true, logging: false, backgroundColor: '#ffffff' }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.instruction', '.deco'] } }).from(frame.contentDocument.body).outputPdf('blob');
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return blob;
  } finally { frame.remove(); }
}

async function createQr(value) {
  const module = await import('qrcode');
  const toDataUrl = module.toDataURL || module.default?.toDataURL;
  return toDataUrl ? toDataUrl(value, { width: 240, margin: 1 }) : '';
}
