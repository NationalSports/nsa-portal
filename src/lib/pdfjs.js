/* eslint-disable */
// ── PDF.js loader (shared: NetSuite PDF import in App.js, .ai → SVG art previews) ──
const PDFJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let _pdfjsLoaded=false;
let _pdfjsLoadPromise=null;
// Load pdf.js from the CDN. Hardened against the "Parsing PDFs… forever" freeze:
//  • a throw inside script.onload (e.g. the pdfjsLib global is missing) now REJECTS instead of
//    leaving the promise unsettled — the old onload accessed window.pdfjsLib.GlobalWorkerOptions
//    with no guard, so if that threw, neither resolve nor reject ever ran and every caller hung,
//  • a 30s watchdog rejects if the script never fires load or error (offline / blocked CDN),
//  • concurrent callers share one in-flight promise (and one <script>); a failed load clears the
//    cache so a later attempt can retry.
const loadPdfJs=()=>{
  if(_pdfjsLoaded&&window.pdfjsLib)return Promise.resolve();
  if(_pdfjsLoadPromise)return _pdfjsLoadPromise;
  _pdfjsLoadPromise=new Promise((resolve,reject)=>{
    let timer=null;
    const finish=(err)=>{
      if(timer){clearTimeout(timer);timer=null}
      if(err){_pdfjsLoadPromise=null;reject(err)}else{_pdfjsLoaded=true;resolve()}
    };
    if(window.pdfjsLib){
      try{window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_CDN+'/pdf.worker.min.js'}catch(e){/* already configured */}
      finish();return;
    }
    timer=setTimeout(()=>finish(new Error('PDF.js failed to load (timed out after 30s) — check your network connection and retry')),30000);
    const script=document.createElement('script');
    script.src=PDFJS_CDN+'/pdf.min.js';
    script.onload=()=>{try{
      if(!window.pdfjsLib)throw new Error('PDF.js loaded but the pdfjsLib global is missing');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_CDN+'/pdf.worker.min.js';
      finish();
    }catch(e){finish(e)}};
    script.onerror=()=>finish(new Error('Failed to load PDF.js from the CDN'));
    document.head.appendChild(script);
  });
  return _pdfjsLoadPromise;
};

export { loadPdfJs };
