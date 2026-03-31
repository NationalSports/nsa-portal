/* eslint-disable */

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
