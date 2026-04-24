/* eslint-disable */
import { NSA as _NSA_CONST } from './constants';

// ── Brevo Email ──
export const _brevoKey = process.env.REACT_APP_BREVO_API_KEY || '';
export const sendBrevoEmail=async({to,subject,htmlContent,textContent,senderName,senderEmail,replyTo,attachment})=>{
  if(!_brevoKey){return{ok:false,error:'Brevo API key not configured (set REACT_APP_BREVO_API_KEY)'}}
  try{const payload={sender:{name:senderName||'National Sports Apparel',email:senderEmail||'noreply@nationalsportsapparel.com'},to:Array.isArray(to)?to:[{email:to}],subject,htmlContent:htmlContent||undefined,textContent:textContent||undefined};
    if(replyTo)payload.replyTo={email:replyTo.email,name:replyTo.name||senderName||'National Sports Apparel'};
    if(attachment&&attachment.length>0)payload.attachment=attachment;
    const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'accept':'application/json','content-type':'application/json','api-key':_brevoKey},
    body:JSON.stringify(payload)});
    const d=await r.json();if(!r.ok)return{ok:false,error:d.message||'Send failed'};return{ok:true,messageId:d.messageId}}
  catch(e){return{ok:false,error:e.message}}
};

// ── Cloudinary Upload ──
const CLOUDINARY_CLOUD='dwlyljyuz';
const CLOUDINARY_PRESET='ml_default_nsaportal';
export const cloudUpload=async(file,folder='nsa-products')=>{const fd=new FormData();fd.append('file',file);fd.append('upload_preset',CLOUDINARY_PRESET);fd.append('folder',folder);const resType=file.type?.startsWith('image/')?'image':'auto';const r=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resType}/upload`,{method:'POST',body:fd});const d=await r.json();if(d.error)throw new Error(d.error.message);return d.secure_url};
export const fileUpload=async(file,folder='nsa-art-files')=>{const fd=new FormData();fd.append('file',file);fd.append('upload_preset',CLOUDINARY_PRESET);fd.append('folder',folder);fd.append('filename_override',file.name);const r=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`,{method:'POST',body:fd});const d=await r.json();if(d.error)throw new Error(d.error.message);return d.secure_url};

// ── File helpers ──
export const isUrl=s=>typeof s==='string'&&(s.startsWith('http://')||s.startsWith('https://'));
export const fileDisplayName=f=>{if(typeof f==='object'&&f?.name)return f.name;const s=typeof f==='string'?f:(f?.url||'');return isUrl(s)?decodeURIComponent(s.split('/').pop().split('?')[0]):s};
export const _urlExt=u=>{if(!u||typeof u!=='string')return '';const clean=u.split('?')[0].split('#')[0];const m=clean.match(/\.(\w+)$/);return m?m[1].toLowerCase():''};
export const _isDownloadOnly=u=>{const e=_urlExt(u);return['ai','eps','dst','psd','tiff','tif','cdr'].includes(e)};
export const _isImgUrl=(u,f)=>{if(_isPdfUrl(u,f))return false;const e=_urlExt(u);if(_isDownloadOnly(u))return false;if(['png','jpg','jpeg','gif','webp','svg','bmp'].includes(e))return true;if(typeof f==='object'&&f?.type?.startsWith('image/'))return true;if(u&&typeof u==='string'&&u.includes('cloudinary.com')&&u.includes('/image/upload/'))return true;return false};
export const _isPdfUrl=(u,f)=>{if(_urlExt(u)==='pdf')return true;if(typeof f==='object'&&f?.type==='application/pdf')return true;if(typeof f==='string'&&f.endsWith('.pdf'))return true;return false};
export const _isDisplayableFile=(u,f)=>_isImgUrl(u,f)||_isPdfUrl(u,f);

// ── File open helper ──
export const openFile=f=>{const u=typeof f==='string'?f:(f?.url||'');if(isUrl(u)){if(_isPdfUrl(u,f)){window.open(u,'_blank')}else if(_isDownloadOnly(u)){const a=document.createElement('a');a.href=u;a.download=typeof f==='object'&&f?.name?f.name:decodeURIComponent(u.split('/').pop().split('?')[0]);a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();document.body.removeChild(a)}else{window.open(u,'_blank')}}};

// ── File filtering helpers ──
export const _filterDisplayable=files=>(files||[]).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');return u&&_isDisplayableFile(u,f)});
export const _cloudinaryPdfThumb=u=>{if(!u||!u.includes('cloudinary.com'))return null;
  let t=u.replace('/raw/upload/','/image/upload/').replace('/video/upload/','/image/upload/');
  return t.replace('/image/upload/','/image/upload/pg_1,f_png/')};

// ── Brevo SMS ──
export const _brevoSmsSender='NSA';
export const sendBrevoSms=async({to,content,sender})=>{
  const _brevoKey2=process.env.REACT_APP_BREVO_API_KEY||'';
  if(!_brevoKey2){return{ok:false,error:'Brevo API key not configured'}}
  try{
    const phone=to.replace(/[^\d+]/g,'');
    if(phone.length<10)return{ok:false,error:'Invalid phone number'};
    const formatted=phone.startsWith('+')?phone:(phone.startsWith('1')&&phone.length===11?'+'+phone:'+1'+phone);
    const payload={type:'transactional',unicodeEnabled:false,sender:sender||_brevoSmsSender,recipient:formatted,content:content.substring(0,160),tag:'invoice'};
    const r=await fetch('https://api.brevo.com/v3/transactionalSMS/send',{method:'POST',headers:{'accept':'application/json','content-type':'application/json','api-key':_brevoKey2},
    body:JSON.stringify(payload)});
    const d=await r.json();if(!r.ok)return{ok:false,error:d.message||d.code||'SMS send failed ('+r.status+')'};return{ok:true,messageId:d.messageId,reference:d.reference}}
  catch(e){return{ok:false,error:e.message}}
};

// ── Document/print helpers ──
export const buildDocHtml=({title,docNum,docType,date,headerRight,infoBoxes,tables,notes,footer,showPricing,portalLink,css,companyInfo})=>{
  const _NSA=companyInfo||_NSA_CONST||{name:'National Sports Apparel',legal:'National Sports Apparel LLC',addr:'9340 Cabot Dr, Suite A',city:'San Diego',state:'CA',zip:'91941',logoUrl:'/nsa-logo.svg'};
  let h='';
  // Header: logo/address left, doc type/number right
  h+='<div class="header"><div class="logo"><img src="'+_NSA.logoUrl+'" alt="NSA"/><div class="co-addr"><strong>'+(_NSA.legal||_NSA.name)+'</strong>'+_NSA.addr+'<br/>'+_NSA.city+', '+_NSA.state+' '+_NSA.zip+'<br/>United States</div></div>';
  h+='<div class="doc-id"><div class="doc-type">'+docType+'</div><div class="doc-num">#'+docNum+'</div><div class="doc-date">'+(date||new Date().toLocaleDateString())+'</div></div></div>';
  // Bill-to & total box
  if(infoBoxes||headerRight){
    const billBox=(infoBoxes||[]).find(b=>b.label==='Bill To');
    h+='<div class="bill-total">';
    if(billBox){h+='<div class="bill-to"><div class="label">'+billBox.label+'</div><div class="value"><strong>'+billBox.value+'</strong>'+(billBox.sub?'<br/>'+billBox.sub:'')+'</div></div>'}
    if(headerRight){h+='<div class="total-box">'+headerRight+'</div>'}
    h+='</div>';
  }
  // Info row
  if(infoBoxes&&infoBoxes.length>0){
    const boxes=infoBoxes.filter(b=>b.label!=='Bill To');
    if(boxes.length>0){
      h+='<div class="info-row">';
      boxes.forEach(b=>{h+='<div class="info-cell"><div class="label">'+b.label+'</div><div class="value">'+b.value+(b.sub?'<br/><span style="font-size:10px;color:#666">'+b.sub+'</span>':'')+'</div></div>'});
      h+='</div>';
    }
  }
  // Tables
  if(tables&&tables.length>0){
    tables.forEach(tbl=>{
      if(tbl.title)h+='<div style="font-weight:700;font-size:12px;margin:10px 0 4px;color:#333">'+tbl.title+'</div>';
      h+='<table><thead><tr>';
      const aligns=tbl.aligns||[];
      tbl.headers.forEach((hd,i)=>{h+='<th style="'+(aligns[i]?'text-align:'+aligns[i]:'')+'">'+hd+'</th>'});
      h+='</tr></thead><tbody>';
      (tbl.rows||[]).forEach(row=>{
        const cls=row._class?' class="'+row._class+'"':'';
        const sty=row._style?' style="'+row._style+'"':'';
        h+='<tr'+cls+sty+'>';
        const cells=row.cells||row;
        (Array.isArray(cells)?cells:[]).forEach((cell,i)=>{
          const isObj=cell&&typeof cell==='object'&&!Array.isArray(cell);
          const val=isObj?cell.value:cell;
          const cellStyle=isObj&&cell.style?cell.style:(aligns[i]?'text-align:'+aligns[i]:'');
          h+='<td style="'+cellStyle+'">'+(val!=null?val:'')+'</td>';
        });
        h+='</tr>';
      });
      h+='</tbody></table>';
    });
  }
  // Notes
  if(notes)h+='<div class="notes"><div class="label">Notes</div>'+notes+'</div>';
  // Footer
  if(footer||portalLink){
    h+='<div class="footer"><div>'+(footer||'')+'</div>';
    if(portalLink)h+='<div style="text-align:right"><a href="'+portalLink+'" style="color:#2563eb;text-decoration:none">View Online Portal</a></div>';
    h+='</div>';
  }
  // Wrap with full page HTML for email attachment use
  const _css=css||'';
  const _title=docNum+(title?' - '+title:'');
  return'<html><head><title>'+_title+'</title><style>'+_css+'</style></head><body>'+h+'</body></html>';
};
export const printDoc=opts=>{
  const _PRINT_CSS=`*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #ccc}.logo{display:flex;align-items:center;gap:8px}.logo img{height:50px}.co-addr{font-size:11px;color:#333;line-height:1.4}.co-addr strong{display:block;font-size:12px}.doc-id{text-align:right}.doc-id .doc-type{font-size:28px;font-weight:800;color:#333}.doc-id .doc-num{font-size:14px;color:#333;font-weight:700}.doc-id .doc-date{font-size:11px;color:#666}.bill-total{display:flex;justify-content:space-between;align-items:flex-start;margin:8px 0;gap:20px}.bill-to{flex:1}.bill-to .label{font-size:10px;font-weight:700;color:#333;background:#e8e8e8;padding:3px 6px;display:inline-block;margin-bottom:4px}.bill-to .value{font-size:12px;color:#1a1a1a;line-height:1.5}.total-box{background:#e8e8e8;padding:12px 20px;min-width:200px}.total-box .tl{font-size:13px;font-weight:800;color:#333}.total-box .ta{font-size:36px;font-weight:900;color:#1a1a1a;margin:4px 0}.total-box .ts{font-size:11px;color:#666}.info-row{display:flex;border:1px solid #ccc;margin-bottom:6px}.info-cell{flex:1;padding:3px 6px;border-right:1px solid #ccc}.info-cell:last-child{border-right:none}.info-cell .label{font-size:9px;font-weight:700;color:#333;background:#e8e8e8;padding:1px 4px;display:inline-block;margin-bottom:2px}.info-cell .value{font-size:11px;color:#1a1a1a}table{width:100%;border-collapse:collapse;margin:4px 0}th{background:#e8e8e8;padding:3px 6px;text-align:left;font-size:10px;font-weight:700;color:#333;border:1px solid #ccc}td{padding:2px 6px;border-bottom:1px solid #ddd;font-size:10px;line-height:1.3}.sz-table th,.sz-table td{text-align:center;padding:3px 5px;font-size:10px;min-width:30px}.sz-table td.has-qty{font-weight:800;color:#1e3a5f;background:#eef2ff}.totals-row td{font-weight:800;border-top:2px solid #333;font-size:11px}.notes{margin-top:8px;padding:8px 10px;background:#fffbe6;border:1px solid #f0e6b8;font-size:10px}.notes .label{font-weight:700;color:#8b6914;margin-bottom:2px}.footer{margin-top:10px;padding-top:6px;border-top:1px solid #ddd;font-size:8px;color:#999;display:flex;justify-content:space-between}.amount{text-align:right;font-weight:700}.highlight{background:#e8e8e8;color:#166534}.badge{display:inline-block;padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700}.no-price td:nth-child(n+5){display:none}.no-price th:nth-child(n+5){display:none}.sep-line{border-top:2px solid #c00;margin:2px 0}@media print{body{padding:14px 20px}th{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.total-box{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.info-cell .label,.bill-to .label{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}@page{margin:0.4in;size:letter}`;
  const docHtml=buildDocHtml({...opts,css:opts.css||_PRINT_CSS});
  const w=window.open('','_blank');if(!w)return;
  w.document.write(docHtml);w.document.close();setTimeout(()=>w.print(),300);
};
export const nextInvId=invs=>{const nums=(invs||[]).map(i=>{const m=String(i.id).match(/(\d+)$/);return m?parseInt(m[1]):0});return'INV-'+(Math.max(1000,...nums)+1)};

// ── Supabase Edge Function helper ──
export async function invokeEdgeFn(supabase,fnName,body){
  const r=await supabase.functions.invoke(fnName,{body});
  let d=r.data;
  console.log('[invokeEdgeFn]',fnName,'raw response:',{data:d,error:r.error,dataType:typeof d});
  if(d&&typeof d==='object'&&typeof d.getReader==='function'){d=await new Response(d).json()}
  else if(d&&typeof d==='object'&&typeof d.text==='function'){
    try{const txt=await d.text();d=JSON.parse(txt)}catch(e){console.error('[invokeEdgeFn] parse error:',e);d=null}
  }
  else if(typeof d==='string'){try{d=JSON.parse(d)}catch(e){d=null}}
  if(!d&&r.error){const ctx=r.error?.context;if(ctx&&typeof ctx.json==='function'){try{d=await ctx.json()}catch(e){}}if(!d)d={ok:false,error:r.error?.message||String(r.error)}}
  console.log('[invokeEdgeFn]',fnName,'parsed:',d);
  if(d&&d.error&&typeof d.error!=='string'){d.error=d.error?.message||JSON.stringify(d.error)}
  return d||{ok:false,error:'No response from edge function'};
}
