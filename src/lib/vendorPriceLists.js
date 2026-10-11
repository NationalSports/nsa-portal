import { authFetch } from '../utils';
import { supabase } from './supabase';

export async function priceListCall(action, payload={}) {
  const response=await authFetch('/.netlify/functions/vendor-price-lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
  const data=await response.json();
  if (!response.ok || data.error) throw new Error(data.error||'Price lists are unavailable');
  return data;
}
export async function openPriceList(id) {
  // Open synchronously so browsers do not block the download after awaiting auth.
  const tab=window.open('about:blank','_blank');
  if (tab) tab.opener=null;
  try { const {url}=await priceListCall('download',{id}); if(tab) tab.location.href=url; else window.location.assign(url); }
  catch(e) { if(tab) tab.close(); throw e; }
}
export function sheetChunks(rows, name, firstRow=1) {
  const chunks=[];
  const nonempty=rows.map((cells,index)=>({index:index+firstRow,text:cells.map(v=>String(v??'').replace(/\s+/g,' ').trim()).join(' | ')})).filter(r=>r.text.replace(/[|\s]/g,''));
  // Preserve heading/preamble context for arbitrary vendor spreadsheet layouts.
  const header=nonempty.slice(0,30).find(r=>/\b(sku|style|item|product|description)\b/i.test(r.text) && /\b(price|cost|wholesale|retail|net|msrp)\b/i.test(r.text));
  const headings=header?`Row ${header.index}: ${header.text}`:'Column labels not identified; inspect the original sheet.';
  for(let i=0;i<nonempty.length;i+=8) {
    const group=nonempty.slice(i,i+8);
    const content=`Sheet: ${name}\nColumn labels:\n${headings}\nSource rows:\n${group.map(r=>`Row ${r.index}: ${r.text}`).join('\n')}`;
    if(content.length>12000) throw new Error('A spreadsheet section is too wide. Split it into smaller sheets.');
    chunks.push({location:`${name} · rows ${group[0].index}–${group[group.length-1].index}`,content});
  }
  return chunks;
}
let pdfLoader;
async function loadPdf() {
  if(window.pdfjsLib) return window.pdfjsLib;
  if(!pdfLoader) pdfLoader=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    const timer=setTimeout(()=>{s.remove();reject(new Error('PDF reader timed out; please retry'));},20000);
    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload=()=>{clearTimeout(timer);window.pdfjsLib?resolve(window.pdfjsLib):reject(new Error('PDF reader unavailable'));};
    s.onerror=()=>{clearTimeout(timer);reject(new Error('PDF reader could not load'));};
    document.head.appendChild(s);
  }).catch(e=>{pdfLoader=null;throw e;});
  return pdfLoader;
}
export async function extractPriceList(file, progress=()=>{}) {
  if(!/\.(pdf|xlsx?)$/i.test(file.name)) throw new Error('Choose a PDF, XLS or XLSX file.');
  if(!file.size || file.size>20*1024*1024) throw new Error('Choose a file up to 20 MB.');
  const bytes=await file.arrayBuffer();
  let chunks=[];
  if(/\.pdf$/i.test(file.name)) {
    const pdfjs=await loadPdf();
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // Never evaluate PDF-embedded JavaScript/font programs.
    const task=pdfjs.getDocument({data:bytes,isEvalSupported:false});
    task.onPassword=()=>task.destroy();
    const timer=setTimeout(()=>task.destroy(),120000);
    try {
      const pdf=await task.promise;
      if(pdf.numPages>300) throw new Error('Split PDFs longer than 300 pages into smaller lists.');
      for(let p=1;p<=pdf.numPages;p++) {
        progress(`Reading PDF page ${p} of ${pdf.numPages}…`);
        const page=await pdf.getPage(p), text=await page.getTextContent();
        let lastY=null, line='', lines=[];
        for(const item of text.items) {
          if(!item.str) continue;
          const y=Math.round(item.transform[5]);
          if(lastY!==null && Math.abs(y-lastY)>3) {lines.push(line);line='';}
          line+=(line?' | ':'')+item.str; lastY=y;
          if(item.hasEOL) {lines.push(line);line='';lastY=null;}
        }
        if(line) lines.push(line);
        const content=lines.join('\n').trim();
        // Do not silently mark a partly image-only price list as fully searchable.
        if(content.length<15) throw new Error(`Page ${p} has no readable text. Upload a searchable/OCR PDF or the Excel price list.`);
        for(let i=0;i<content.length;i+=10000) chunks.push({location:`PDF page ${p}${content.length>10000?` · section ${Math.floor(i/10000)+1}`:''}`,content:content.slice(i,i+10000)});
      }
    } finally {clearTimeout(timer);await task.destroy();}
  } else {
    progress('Reading spreadsheet sheets…');
    const XLSX=await import('xlsx');
    const wb=XLSX.read(bytes,{type:'array',cellDates:false});
    for(const name of wb.SheetNames) {
      const sheet=wb.Sheets[name];
      if(!sheet['!ref']) continue;
      const range=XLSX.utils.decode_range(sheet['!ref']);
      if(range.e.r-range.s.r>20000 || range.e.c-range.s.c>150) throw new Error('Sheet is too large. Split the price list into smaller files.');
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true});
      chunks.push(...sheetChunks(rows,name,range.s.r+1));
    }
  }
  if(!chunks.length) throw new Error('No searchable text found in this file.');
  if(chunks.length>2000 || chunks.reduce((n,c)=>n+c.content.length,0)>2000000) throw new Error('Too much text; split the list into smaller files.');
  return chunks;
}
export async function uploadPriceList(vendorId,file,dates,progress) {
  // Extraction happens first: unreadable files never become active price lists.
  const chunks=await extractPriceList(file,progress);
  progress('Uploading original file…');
  const upload=await priceListCall('begin',{vendor_id:vendorId,file_name:file.name,file_size:file.size,...dates});
  const {error}=await supabase.storage.from('vendor-price-lists').uploadToSignedUrl(upload.path,upload.token,new File([file],file.name,{type:upload.content_type}),{contentType:upload.content_type});
  if(error) throw error;
  progress('Indexing price-list text…');
  await priceListCall('complete',{id:upload.id,chunks});
  return upload.id;
}
