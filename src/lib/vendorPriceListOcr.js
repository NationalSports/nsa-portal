// One lazy OCR worker per upload; page images stay in the browser.
export function withDeadline(promise, label, ms=120000) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out. Please retry or split the PDF into smaller files.`)),ms);})]).finally(()=>clearTimeout(timer));
}
export function createPriceListOcr() {
  let worker, loading, closed=false;
  return {
    async recognize(page, pageNumber, progress) {
      if(!loading) loading=import('tesseract.js').then(({createWorker})=>createWorker('eng')).then(async result=>{
        if(closed) {await result.terminate();throw new Error('OCR upload was closed');}
        worker=result;return result;
      });
      progress(`Reading scanned PDF page ${pageNumber} with OCR…`);
      const active=await withDeadline(loading,'OCR initialization');
      const base=page.getViewport({scale:1});
      // Aim for 216 dpi, capped at 8 megapixels for browser memory usage.
      const scale=Math.min(3,Math.sqrt(8000000/(base.width*base.height)));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      let render;
      try {
        const context=canvas.getContext('2d');
        if(!context) throw new Error('This browser cannot render scanned PDF pages.');
        render=page.render({canvasContext:context,viewport,background:'rgb(255,255,255)'});
        await withDeadline(render.promise,`Rendering page ${pageNumber}`);
        const {data}=await withDeadline(active.recognize(canvas),`OCR on page ${pageNumber}`);
        const text=String(data?.text||'').trim();
        if(!/[a-z0-9]/i.test(text)) throw new Error(`OCR could not read page ${pageNumber}. Please upload a clearer scan or an Excel price list.`);
        const confidence=Number.isFinite(data.confidence)?Math.round(data.confidence):null;
        return {text,label:`OCR${confidence===null?'':` ${confidence}% confidence`} · ${confidence===null||confidence<85?'LOW CONFIDENCE — ':''}verify prices and SKUs`};
      } finally {render?.cancel();canvas.width=0;canvas.height=0;}
    },
    async close() {closed=true;if(worker) await worker.terminate();}
  };
}
export async function pageNeedsOcr(page,pdfjs,text) {
  if(text.replace(/\s/g,'').length<15) return true;
  // A scanned table can have a selectable title/footer. Check image operators
  // too, instead of mistaking those few words for a fully searchable page.
  const imageOps=['paintImageXObject','paintInlineImageXObject','paintImageXObjectRepeat','paintImageMaskXObject','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup','paintInlineImageXObjectGroup','paintJpegXObject'].map(k=>pdfjs.OPS?.[k]).filter(v=>v!==undefined);
  const ops=await page.getOperatorList();
  return ops.fnArray.some(op=>imageOps.includes(op));
}
