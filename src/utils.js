/* eslint-disable */
import { NSA as _NSA_CONST } from './constants';
import { supabase as _sbAuthClient } from './lib/supabase';
// pdf-lib is loaded on demand (see printPdfLabels below) to keep it out of the eager bundle.

// fetch() that attaches the signed-in user's Supabase JWT — required by the
// staff-only Netlify functions (qb-api, vectorizer, OMG ingest/notify, Stripe
// refunds, create-quote-request), which verify the caller server-side.
const _getAuthHeader=async()=>{
  let auth={};
  try{
    let{data:{session}}=await _sbAuthClient.auth.getSession();
    // getSession() can return an already-expired JWT when the background auto-refresh
    // timer was throttled (idle/backgrounded tab). The staff-only Netlify functions
    // reject expired tokens with 401, so refresh proactively when it's stale/near-expiry.
    if(session?.expires_at&&session.expires_at-Math.floor(Date.now()/1000)<60){
      try{const{data}=await _sbAuthClient.auth.refreshSession();if(data?.session)session=data.session}catch{}
    }
    if(session?.access_token)auth={Authorization:'Bearer '+session.access_token};
  }catch{}
  return auth;
};
export const authFetch=async(url,opts={})=>{
  const auth=await _getAuthHeader();
  const res=await fetch(url,{...opts,headers:{...(opts.headers||{}),...auth}});
  // The proactive expiry check above still misses cases (silent refresh failed,
  // clock skew, session refreshed by another tab). If the server rejects the token,
  // force a hard refresh and retry once before giving up.
  if(res.status===401){
    try{
      const{data}=await _sbAuthClient.auth.refreshSession();
      const retryAuth=data?.session?.access_token?{Authorization:'Bearer '+data.session.access_token}:{};
      if(retryAuth.Authorization)return fetch(url,{...opts,headers:{...(opts.headers||{}),...retryAuth}});
    }catch{}
  }
  return res;
};

// ── Brevo Email ──
// Public availability flag — NOT the API key. The real key lives only in the
// server-side BREVO_API_KEY env var and is used by netlify/functions/brevo-proxy.
// All browser email/stats calls go through that proxy so the key never ships in
// the bundle. UI gates ("Sends directly" badges, mailto fallbacks) read this flag.
// Defaults on; set REACT_APP_BREVO_ENABLED=false to force mailto fallback.
export const _brevoKey = (process.env.REACT_APP_BREVO_ENABLED || 'true') !== 'false';
const _brevoProxy = '/.netlify/functions/brevo-proxy';

// Returns an absolute URL for the company logo so it renders inside external
// email clients (Gmail, Apple Mail, etc.) which won't follow relative paths.
export const _absLogoUrl=(companyInfo)=>{
  const raw=companyInfo?.logoUrl||(_NSA_CONST&&_NSA_CONST.logoUrl)||'/nsa-logo.svg';
  if(/^https?:/i.test(raw))return raw;
  const origin=(typeof window!=='undefined'&&window.location?.origin)||'https://nsa-portal.netlify.app';
  return origin+raw;
};

// Wraps an HTML email body with a centered logo header so every outgoing
// estimate / SO / invoice email is branded consistently.
export const buildBrandedEmailHtml=(innerHtml,companyInfo)=>{
  const logo=_absLogoUrl(companyInfo);
  const name=(companyInfo&&companyInfo.name)||(_NSA_CONST&&_NSA_CONST.name)||'National Sports Apparel';
  return '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:720px;margin:0 auto">'
    +'<div style="text-align:center;padding:12px 0 18px;border-bottom:2px solid #e2e8f0;margin-bottom:18px">'
    +'<img src="'+logo+'" alt="'+name+'" style="max-height:60px;display:inline-block"/>'
    +'</div>'
    +innerHtml
    +'</div>';
};

// ── Google review CTA (email-safe "bulletproof" button) ──
// Live Google Business Profile review deep-link. Keep this EXACTLY as-is — do not
// wrap, shorten, or re-encode it, or click tracking/rewriting can break the deep link.
export const GOOGLE_REVIEW_URL='https://g.page/r/CfcLJB_RwxCREBM/review';

// Builds the optional "Leave us a Google review" button as an HTML string.
// Bulletproof + Outlook-friendly: the VML <v:roundrect> inside the <!--[if mso]-->
// block renders a solid button in Outlook (Windows), while the <!--[if !mso]--> <a>
// renders everywhere else (Gmail, Apple Mail, etc.). Inline styles + table layout
// only — email clients strip <style> blocks. `color` defaults to the portal blue
// the other CTA buttons in these emails use. Pass leadIn:false to drop the lead-in.
export const buildReviewButtonHtml=({color='#2563eb',leadIn=true}={})=>{
  const lead=leadIn?'<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#475569;text-align:center;">Happy with how we did? A quick Google review means a lot to our team.</p>':'';
  return lead
    +'<!-- Google review button — email-safe (bulletproof, Outlook-friendly). -->'
    +'<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:16px auto;">'
    +'<tr>'
    +'<td align="center" style="border-radius:6px;background:'+color+';">'
    +'<!--[if mso]>'
    +'<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="'+GOOGLE_REVIEW_URL+'" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="13%" strokecolor="'+color+'" fillcolor="'+color+'">'
    +'<w:anchorlock/>'
    +'<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">&#9733; Leave us a Google review</center>'
    +'</v:roundrect>'
    +'<![endif]-->'
    +'<!--[if !mso]><!-- -->'
    +'<a href="'+GOOGLE_REVIEW_URL+'" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;background:'+color+';">&#9733; Leave us a Google review</a>'
    +'<!--<![endif]-->'
    +'</td>'
    +'</tr>'
    +'</table>';
};

// Plain-text version of the review CTA, for the text/plain alternative.
export const reviewTextBlock=()=>'Happy with how we did? A quick Google review means a lot to our team:\n'+GOOGLE_REVIEW_URL;

// Toggles the "Also Text Coach" SMS UI in send modals. Disabled while SMS sending
// is unreliable; flip to true (or wire to env) to re-enable. Send code paths
// remain intact so re-enabling is a one-line change.
export const _smsUiEnabled = false;
export const sendBrevoEmail=async({to,cc,bcc,subject,htmlContent,textContent,senderName,senderEmail,replyTo,attachment})=>{
  try{const payload={sender:{name:senderName||'National Sports Apparel',email:senderEmail||'noreply@nationalsportsapparel.com'},to:Array.isArray(to)?to:[{email:to}],subject,htmlContent:htmlContent||undefined,textContent:textContent||undefined};
    if(replyTo)payload.replyTo={email:replyTo.email,name:replyTo.name||senderName||'National Sports Apparel'};
    if(cc){const ccArr=Array.isArray(cc)?cc:[cc];const _toEmails=new Set(payload.to.map(t=>(t.email||'').toLowerCase()));const _filtered=ccArr.filter(c=>c&&c.email&&!_toEmails.has(c.email.toLowerCase()));if(_filtered.length>0)payload.cc=_filtered}
    if(bcc){const bccArr=Array.isArray(bcc)?bcc:[bcc];if(bccArr.length>0)payload.bcc=bccArr}
    if(attachment&&attachment.length>0)payload.attachment=attachment;
    const r=await authFetch(_brevoProxy,{method:'POST',headers:{'accept':'application/json','content-type':'application/json'},
    body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok){
      // authFetch already retried once with a hard session refresh; a 401 that
      // survives that means the user's session is genuinely gone (signed out
      // elsewhere, revoked, etc.) rather than just a stale-token blip.
      if(r.status===401)return{ok:false,error:'Your session has expired. Please refresh the page and sign in again to send this email.'};
      return{ok:false,error:d.error||d.message||('Send failed (HTTP '+r.status+')')};
    }
    return{ok:true,messageId:d.messageId}}
  catch(e){return{ok:false,error:e.message}}
};

// Coach-portal writes go through this serverless endpoint instead of the browser
// Supabase client: the public portal runs as the anon role, which RLS only lets
// read sales_orders / so_jobs / so_art_files / estimates. The function uses the
// service-role key to persist the change and send the rep notification.
export const _portalAction=async(payload)=>{
  try{
    const r=await fetch('/.netlify/functions/portal-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return{ok:false,error:d.error||('HTTP '+r.status)};
    return{ok:true,...d};
  }catch(e){return{ok:false,error:e.message}}
};

// ── Inherited-contact resolution ──
// Returns contacts of a given role that apply to a customer, including any inherited
// from the parent customer. Sub-customers automatically pick up the parent's contact for
// the role so we only have to set it once at the parent level. Used for Billing and
// Athletic Director contacts today.
export const getInheritedContactsByRole=(customer,allCustomers,role)=>{
  if(!customer)return[];
  const target=(role||'').toLowerCase();
  const out=[];const seen=new Set();
  const push=(c,inheritedFrom)=>{
    (c?.contacts||[]).filter(x=>x&&x.email&&(x.role||'').toLowerCase()===target).forEach(x=>{
      const key=x.email.toLowerCase();if(seen.has(key))return;seen.add(key);
      out.push(inheritedFrom?{...x,_inherited_from:inheritedFrom}:x);
    });
  };
  push(customer,null);
  if(customer.parent_id&&Array.isArray(allCustomers)){
    const parent=allCustomers.find(c=>c.id===customer.parent_id);
    if(parent)push(parent,parent.name||parent.alpha_tag||'parent');
  }
  return out;
};
export const getBillingContacts=(customer,allCustomers)=>getInheritedContactsByRole(customer,allCustomers,'billing');
export const getAthleticDirectorContacts=(customer,allCustomers)=>getInheritedContactsByRole(customer,allCustomers,'athletic director');

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
export const _isImgUrl=(u,f)=>{if(_isPdfUrl(u,f))return false;const e=_urlExt(u);if(_isDownloadOnly(u))return false;if(['png','jpg','jpeg','gif','webp','svg','bmp'].includes(e))return true;if(typeof f==='object'&&f?.type?.startsWith('image/'))return true;if(u&&typeof u==='string'&&u.includes('cloudinary.com')&&u.includes('/image/upload/'))return true;if(u&&typeof u==='string'&&/(?:assetly|assets)\.ordermygear\.com\//.test(u))return true;return false};
export const _isPdfUrl=(u,f)=>{if(_urlExt(u)==='pdf')return true;if(typeof f==='object'&&f?.type==='application/pdf')return true;if(typeof f==='string'&&f.endsWith('.pdf'))return true;return false};
export const _isDisplayableFile=(u,f)=>_isImgUrl(u,f)||_isPdfUrl(u,f);

// ── File open helper ──
export const openFile=f=>{const u=typeof f==='string'?f:(f?.url||'');if(isUrl(u)){if(_isPdfUrl(u,f)){_openPdfSmart(u)}else if(_isDownloadOnly(u)){const a=document.createElement('a');a.href=u;a.download=typeof f==='object'&&f?.name?f.name:decodeURIComponent(u.split('/').pop().split('?')[0]);a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();document.body.removeChild(a)}else{window.open(u,'_blank')}}};

// ── File filtering helpers ──
export const _filterDisplayable=files=>(files||[]).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');return u&&_isDisplayableFile(u,f)});
export const _cloudinaryPdfThumb=u=>{if(!u||!u.includes('cloudinary.com'))return null;
  let t=u.replace('/raw/upload/','/image/upload/').replace('/video/upload/','/image/upload/');
  return t.replace('/image/upload/','/image/upload/pg_1,f_png/')};

// ── Art-file superset merge (data-loss guard for reconciliation) ──
// Background reconciliation (poll/realtime reloadAll) re-reads orders, estimates & customers from
// Supabase and merges the server copy back into state. The merge must NEVER drop a file the user just
// added to an EXISTING art group: a reconciliation read that lands a beat behind the (queued, lightweight)
// art save returns that group with FEWER files, and a wholesale replace silently reverts the just-uploaded
// image — the file stays in Cloudinary, but its URL is dropped from the record. This is the root cause of
// the "I have to upload images twice" / "data keeps disappearing" reports. These helpers union an art
// group's file arrays — keeping any LOCAL file the incoming (server) copy is missing — while otherwise
// adopting the incoming row (status/approval/_version). Symmetric tradeoff, consistent with the existing
// "never drop a local art group" guard (OrderEditor mergedArt): a deliberately-deleted-then-saved file can
// rarely be resurrected by a stale read — a visible, recoverable annoyance vs. today's silent loss.
const _afUrl=f=>typeof f==='string'?f:(f?.url||'');
const _afUnion=(extArr,locArr)=>{const l=Array.isArray(locArr)?locArr:[];if(!l.length)return extArr;const e=Array.isArray(extArr)?extArr:[];const seen=new Set(e.map(_afUrl).filter(Boolean));const add=l.filter(f=>{const u=_afUrl(f);return u&&!seen.has(u)});return add.length?[...e,...add]:extArr};
// Merge one art group: adopt the incoming (server) group's fields but UNION its file arrays with the local
// copy's, so a file the user just added (that the stale server read is missing) is never dropped. Returns
// the incoming group unchanged (same ref) when the local copy adds nothing new.
export const mergeArtGroupFiles=(ext,loc)=>{
  if(!ext)return loc;if(!loc)return ext;
  const mf=_afUnion(ext.mockup_files,loc.mockup_files),pf=_afUnion(ext.prod_files,loc.prod_files),fl=_afUnion(ext.files,loc.files);
  let im=ext.item_mockups||{},imCh=false;const locIM=loc.item_mockups||{};const imKeys=Object.keys(locIM);
  if(imKeys.length){const base={...(ext.item_mockups||{})};imKeys.forEach(k=>{const u=_afUnion(base[k],locIM[k]);if(u!==base[k]){base[k]=u;imCh=true}});if(imCh)im=base}
  // Mock links (garment -> source garment) are a small {key:source} map. Keep any local link the
  // stale incoming copy is missing so a just-made reuse link isn't dropped by a poll/realtime echo
  // (mirrors the file union — same symmetric tradeoff: a deliberate unlink can rarely be resurrected).
  let ml=ext.mock_links,mlCh=false;const locML=loc.mock_links||{};const mlKeys=Object.keys(locML);
  if(mlKeys.length){const base={...(ext.mock_links||{})};mlKeys.forEach(k=>{if(base[k]!==locML[k]){base[k]=locML[k];mlCh=true}});if(mlCh)ml=base}
  if(mf===ext.mockup_files&&pf===ext.prod_files&&fl===ext.files&&!imCh&&!mlCh)return ext;
  return{...ext,mockup_files:mf,prod_files:pf,files:fl,...(imCh?{item_mockups:im}:{}),...(mlCh?{mock_links:ml}:{})};
};
// Array-level: superset-merge an incoming art_files array against the local one, grouped by id. Keeps any
// local-only group (the incoming snapshot is missing it entirely) AND any local-only file within a shared
// group. Returns the incoming array unchanged (same ref) when the local copy adds nothing.
export const mergeArtFileSuperset=(extArr,locArr)=>{
  if(!Array.isArray(locArr)||!locArr.length)return Array.isArray(extArr)?extArr:[];
  if(!Array.isArray(extArr)||!extArr.length)return locArr;
  const locById=new Map(locArr.map(a=>[a&&a.id,a]).filter(([k])=>k!=null));
  let changed=false;
  const out=extArr.map(ea=>{const la=ea&&locById.get(ea.id);if(!la)return ea;const m=mergeArtGroupFiles(ea,la);if(m!==ea)changed=true;return m});
  const extIds=new Set(extArr.map(a=>a&&a.id));
  const locOnly=locArr.filter(a=>a&&!extIds.has(a.id));
  if(locOnly.length)return[...out,...locOnly];
  return changed?out:extArr;
};

// ── PDF open (resilient to Cloudinary's PDF-delivery block) ──
// Cloudinary refuses to deliver PDFs on free/untrusted accounts (HTTP 401,
// x-cld-error "deny or ACL failure"), which the browser shows as a blank
// "Failed to load PDF document" tab — the exact error the decoration team hit.
// Image delivery is never blocked, so when the real PDF is denied we fall back
// to a high-res PNG render of page 1 so the design is still viewable/printable
// instead of a dead end. Once "Allow delivery of PDF and ZIP files" is enabled
// in Cloudinary's Security settings the HEAD probe returns 200 and the original
// (multi-page) PDF opens normally — and we then trust delivery for the rest of
// the session and skip the probe. Non-Cloudinary PDFs open directly. The blank
// tab is grabbed synchronously so pop-up blockers still honour the click.
let _cldPdfDeliveryOk=false;
export const _openPdfSmart=u=>{
  if(!isUrl(u))return;
  const win=window.open('','_blank');
  const go=t=>{try{if(win&&!win.closed){win.location.href=t;return}}catch(_){/* cross-origin guard */}window.open(t,'_blank','noopener')};
  if(_cldPdfDeliveryOk||!u.includes('res.cloudinary.com')){go(u);return}
  const fallback=()=>{const png=_cloudinaryPdfThumb(u);go(png?png.replace('pg_1,f_png','pg_1,f_png,w_2400'):u)};
  fetch(u,{method:'HEAD'}).then(r=>{if(r.ok){_cldPdfDeliveryOk=true;go(u)}else fallback()}).catch(fallback);
};

// ── Brevo SMS ──
// SMS is currently disabled (see _smsUiEnabled). The browser must never hold the
// Brevo key, so this no longer calls Brevo directly. To re-enable SMS, add a
// transactionalSMS branch to netlify/functions/brevo-proxy and route through it.
export const _brevoSmsSender='NSA';
export const sendBrevoSms=async()=>({ok:false,error:'SMS sending is disabled. Route it through the server-side brevo-proxy to re-enable.'});

// ── Document/print helpers ──
export const buildDocHtml=({title,docNum,docType,date,headerRight,infoBoxes,tables,notes,footer,showPricing,portalLink,css,companyInfo,repeatInfoHeader,_runHeaderCss})=>{
  const _NSA={..._NSA_CONST,...(companyInfo||{})};
  let h='';
  // Repeating running header (browser print): a slim band — doc id + the info
  // cells (Customer / Sales Order / Expected Date / Rep) — that repeats on every
  // page via position:fixed, sitting in the reserved top page margin. The NSA
  // logo/address block stays a one-time, page-1-only header below it.
  if(_runHeaderCss){
    const _ihBoxes=(infoBoxes||[]).filter(b=>b.label!=='Bill To');
    h+='<div class="run-header"><span class="rh-id">'+docType+' · #'+docNum+'</span>'
      +_ihBoxes.map(b=>'<span class="rh-cell"><span class="rh-lbl">'+b.label+'</span>'+b.value+'</span>').join('')
      +'</div>';
  }
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
  // Info row — skipped when repeatInfoHeader is on, since those cells live in the
  // repeating running header (page-1 band / Puppeteer header) on every page instead.
  if(infoBoxes&&infoBoxes.length>0&&!repeatInfoHeader){
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
  const _css=(css||'')+(_runHeaderCss?_RUN_HEADER_CSS:'');
  const _title=docNum+(title?' - '+title:'');
  return'<html><head><title>'+_title+'</title><style>'+_css+'</style></head><body>'+h+'</body></html>';
};
const _PRINT_CSS=`*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #ccc}.logo{display:flex;align-items:center;gap:8px}.logo img{height:50px}.co-addr{font-size:11px;color:#333;line-height:1.4}.co-addr strong{display:block;font-size:12px}.doc-id{text-align:right}.doc-id .doc-type{font-size:28px;font-weight:800;color:#333}.doc-id .doc-num{font-size:14px;color:#333;font-weight:700}.doc-id .doc-date{font-size:11px;color:#666}.bill-total{display:flex;justify-content:space-between;align-items:flex-start;margin:8px 0;gap:20px}.bill-to{flex:1}.bill-to .label{font-size:10px;font-weight:700;color:#333;background:#e8e8e8;padding:3px 6px;display:inline-block;margin-bottom:4px}.bill-to .value{font-size:12px;color:#1a1a1a;line-height:1.5}.total-box{background:#e8e8e8;padding:12px 20px;min-width:200px}.total-box .tl{font-size:13px;font-weight:800;color:#333}.total-box .ta{font-size:36px;font-weight:900;color:#1a1a1a;margin:4px 0}.total-box .ts{font-size:11px;color:#666}.info-row{display:flex;border:1px solid #ccc;margin-bottom:6px}.info-cell{flex:1;padding:3px 6px;border-right:1px solid #ccc}.info-cell:last-child{border-right:none}.info-cell .label{font-size:9px;font-weight:700;color:#333;background:#e8e8e8;padding:1px 4px;display:inline-block;margin-bottom:2px}.info-cell .value{font-size:11px;color:#1a1a1a}table{width:100%;border-collapse:collapse;margin:4px 0}th{background:#e8e8e8;padding:3px 6px;text-align:left;font-size:10px;font-weight:700;color:#333;border:1px solid #ccc}td{padding:2px 6px;border-bottom:1px solid #ddd;font-size:10px;line-height:1.3}tr.item-row td{border-bottom:none;padding-bottom:0}tr.deco-row td{padding-top:0;padding-bottom:1px}.sz-table th,.sz-table td{text-align:center;padding:3px 5px;font-size:10px;min-width:30px}.sz-table td.has-qty{font-weight:800;color:#1e3a5f;background:#eef2ff}.totals-row td{font-weight:800;border-top:2px solid #333;font-size:11px}.notes{margin-top:8px;padding:8px 10px;background:#fffbe6;border:1px solid #f0e6b8;font-size:10px}.notes .label{font-weight:700;color:#8b6914;margin-bottom:2px}.footer{margin-top:10px;padding-top:6px;border-top:1px solid #ddd;font-size:8px;color:#999;display:flex;justify-content:space-between}.amount{text-align:right;font-weight:700}.highlight{background:#e8e8e8;color:#166534}.badge{display:inline-block;padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700}.no-price td:nth-child(n+5){display:none}.no-price th:nth-child(n+5){display:none}.sep-line{border-top:2px solid #c00;margin:2px 0}@media print{body{padding:14px 20px}th{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.total-box{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.info-cell .label,.bill-to .label{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}@page{margin:0.4in;size:letter}`;
// Running-header styles for repeatInfoHeader docs (production job sheets), used
// on the browser print path. The canonical Chrome recipe for a header that
// repeats on every page without overlapping content: zero the @page margin so a
// position:fixed band can sit at the paper edge, then reserve the strip below it
// with body top-padding that box-decoration-break:clone repeats on EVERY page
// (plain padding would only apply to page 1). The band wraps to a 2nd line for
// long values rather than overflowing into the content.
const _RUN_HEADER_CSS=`@page{margin:0!important}body{padding:0.8in 0.4in 0.45in!important;-webkit-box-decoration-break:clone;box-decoration-break:clone}.run-header{position:fixed;top:0;left:0;right:0;max-height:0.62in;box-sizing:border-box;padding:0.16in 0.4in 0.06in;display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 16px;background:#fff;overflow:hidden;border-bottom:2px solid #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}.run-header .rh-id{font-weight:800;font-size:12px;color:#111;white-space:nowrap}.run-header .rh-cell{font-size:11px;color:#1a1a1a;white-space:nowrap}.run-header .rh-lbl{font-size:8px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.3px;margin-right:4px}`;
// Puppeteer headerTemplate (server-side PDF path) — repeats the same info cells
// in each page's top margin. Kept to a single (wrapping) line so its height stays
// well under the reserved margin.top; must be fully self-contained inline styles
// since the template renders in an isolated context with no page CSS.
export const _pdfHeaderTemplate=(docType,docNum,infoBoxes)=>{
  const boxes=(infoBoxes||[]).filter(b=>b.label!=='Bill To');
  const cells=boxes.map(b=>'<span style="margin-right:16px;white-space:nowrap"><span style="font-size:7px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.3px;margin-right:4px">'+b.label+'</span><span style="font-size:10px;font-weight:600;color:#1a1a1a">'+b.value+'</span></span>').join('');
  return '<div style="width:100%;box-sizing:border-box;font-size:10px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;padding:0 0.4in;-webkit-print-color-adjust:exact;print-color-adjust:exact">'
    +'<div style="border-bottom:2px solid #333;padding-bottom:4px;line-height:1.35">'
    +'<span style="font-size:11px;font-weight:800;color:#111;margin-right:16px;white-space:nowrap">'+docType+' · #'+docNum+'</span>'
    +cells
    +'</div></div>';
};
export const printDoc=opts=>{
  const docHtml=buildDocHtml({...opts,css:opts.css||_PRINT_CSS,_runHeaderCss:!!opts.repeatInfoHeader});
  const w=window.open('','_blank');if(!w)return;
  w.document.write(docHtml);w.document.close();
  // Wait for every image (mockups, logo) to finish loading before printing — the
  // print preview snapshots the page, so images still loading when print() fires
  // come out as empty boxes.
  let printed=false;
  const go=()=>{if(printed)return;printed=true;setTimeout(()=>{w.focus();w.print()},100)};
  const pending=Array.from(w.document.images||[]).filter(im=>!(im.complete&&im.naturalWidth>0));
  if(pending.length===0){setTimeout(go,200);return}
  let left=pending.length;
  const done=()=>{left--;if(left<=0)go()};
  pending.forEach(im=>{im.addEventListener('load',done);im.addEventListener('error',done)});
  setTimeout(go,10000); // safety: print anyway if an image never loads
};

// Print a 4x6 thermal/label-printer-friendly QR label. The QR image is loaded
// from api.qrserver.com; we wait for it to finish loading (with a safety
// timeout) before triggering print, otherwise the browser prints an empty
// box where the QR should be.
// Merge an array of base64 PDF labels into one multi-page document and print it
// via a hidden iframe. Chrome doesn't reliably rasterize stacked <embed> PDF
// plugins, so a single combined PDF is the dependable path on the PC where bulk
// printing happens. Falls back to opening the merged PDF in a new tab.
export const printPdfLabels=async(base64List)=>{
  const list=(base64List||[]).filter(Boolean);
  if(!list.length)return 0;
  const {PDFDocument}=await import('pdf-lib');
  const out=await PDFDocument.create();
  let added=0,failed=0;
  for(const b64 of list){
    // Merge each label independently so one corrupt/unreadable PDF can't take
    // down the whole batch (that's how "3 labels, only 2 print" happens).
    try{
      const bytes=Uint8Array.from(atob(String(b64).replace(/\s/g,'')),(c)=>c.charCodeAt(0));
      const src=await PDFDocument.load(bytes);
      const pages=await out.copyPages(src,src.getPageIndices());
      pages.forEach((p)=>{
        // ShipStation/FedEx commonly return the 4x6 label printed in the top-left
        // of a full Letter page. Crop each oversized page down to a 4x6 so it
        // prints clean on a thermal/label printer — and so a multi-label batch
        // comes out as one 4x6 page per label instead of full sheets.
        const W=288,H=432; // 4in x 6in at 72dpi
        const sz=p.getSize();
        if(sz.width>W+20&&sz.height>H+20){
          const y=sz.height-H; // top-left region (PDF origin is bottom-left)
          p.setCropBox(0,y,W,H);
          p.setMediaBox(0,y,W,H);
        }
        out.addPage(p);
        added++;
      });
    }catch(e){failed++;}
  }
  if(!added)return 0;
  const url=URL.createObjectURL(new Blob([await out.save()],{type:'application/pdf'}));
  const iframe=document.createElement('iframe');
  iframe.style.display='none';
  iframe.src=url;
  iframe.onload=()=>{
    try{iframe.contentWindow.focus();iframe.contentWindow.print();}
    catch(e){window.open(url,'_blank');}
    setTimeout(()=>{try{document.body.removeChild(iframe);URL.revokeObjectURL(url);}catch{}},60000);
  };
  document.body.appendChild(iframe);
  return added;
};

// ── Per-item incoming-stock tracking + FIFO allocation ──
// Given a store's webstore orders and its linked Sales Order, work out — per
// order line — how many units are Billed (vendor shipped, from the bill-PDF
// parse → so_item_po_lines.billed), Received (so_item_po_lines.received), on IF
// (item-fulfilled from in-house stock → so_item_pick_lines.sizes) and what's
// still needed. Incoming units are allocated to the EARLIEST orders first
// (FIFO by order number) per (product/sku + size) bucket, so the front of the
// line fills before later orders. Pure function — safe to call on every render.
//
//   orders   : [{ id, omg_order_number, items:[{id, product_id, sku, size, qty,
//                 shipped_qty, line_status }] }]
//   so       : the linked Sales Order { items:[{ product_id, sku, po_lines:[{
//                 billed:{size:qty}, received:{size:qty} }], pick_lines:[{
//                 sizes:{size:qty} }] }] } — or null if not batched yet
//   products : catalog rows carrying on-hand inventory as p._inv = {size:qty}
//   includeIF: webstores fulfill from stock, so count on-IF toward coverage
// Returns { [lineId]: { ordered, billed, received, onIf, onHand, need, status } }.
// Non-size metadata keys that live alongside the spread size quantities on a
// loaded pick line — everything else with a numeric value is a size→qty.
const PICK_META = new Set(['pick_id', 'status', 'ship_dest', 'created_at', 'updated_at', 'memo', 'expected_date', 'po_id', 'vendor', 'tracking', 'tracking_numbers', 'billed', 'received', 'cancelled', 'shipments', '_billed', '_tracking_numbers', 'id', 'so_item_id', 'line_status', 'color', 'sku', 'name', 'notes', 'item_index']);
// Non-size keys that can appear inside a sizes JSONB (drop-ship flag, unit cost).
const SIZE_SKIP = new Set(['drop_ship', 'unit_cost', '_billed', '_tracking_numbers']);
export function computeOrderTracking({ orders = [], so = null, products = [], includeIF = false }) {
  const norm = (s) => String(s == null ? '' : s).trim().toUpperCase();
  // Size key for matching. OMG short lines carry an inseam ("M 7\"") while the SO
  // aggregates them under the base size ("M"), so strip a trailing inseam/length
  // before comparing. Leaves plain (S/M/L) and numeric (32) sizes untouched.
  const sizeKey = (s) => { const u = norm(s); const stripped = u.replace(/\s*\d+\s*("|''|IN|INCH|INCHES)?$/, '').trim(); return stripped || u; };
  const isSizeQty = (k, v) => !SIZE_SKIP.has(k) && !PICK_META.has(k) && typeof v !== 'boolean' && Number(v) > 0;

  // On-hand inventory lookup by product_id → {size: qty}.
  const invByPid = {};
  (products || []).forEach((p) => { if (p && p.id) invByPid[p.id] = p._inv || {}; });

  // Build one supply bucket per SO product, carrying its curated sku/name and
  // per-size billed/received/on-IF. SO items merge into the same bucket when
  // they share a sku, product_id, or name.
  const prods = []; // { names:[norm], sku, pid, sizes:{normSize:{billed,received,onIf}} }
  const findOrCreate = (sku, pid, name) => {
    const sk = norm(sku), ns = norm(name);
    let b = prods.find((p) => (sk && norm(p.sku) === sk) || (pid && p.pid === pid) || (ns && p.names.includes(ns)));
    if (!b) { b = { names: [], sku: sku || '', pid: pid || null, sizes: {} }; prods.push(b); }
    if (ns && !b.names.includes(ns)) b.names.push(ns);
    if (!b.sku && sku) b.sku = sku;
    if (!b.pid && pid) b.pid = pid;
    return b;
  };
  (so && so.items ? so.items : []).forEach((it) => {
    const b = findOrCreate(it.sku, it.product_id, it.name);
    const addSize = (size, field, n) => { if (!n) return; const k = sizeKey(size); (b.sizes[k] = b.sizes[k] || { billed: 0, received: 0, onIf: 0 })[field] += n; };
    (it.po_lines || []).forEach((po) => {
      const bi = po.billed || {}, r = po.received || {};
      new Set([...Object.keys(bi), ...Object.keys(r)]).forEach((sz) => {
        if (SIZE_SKIP.has(sz)) return;
        addSize(sz, 'billed', Number(bi[sz]) || 0);
        addSize(sz, 'received', Number(r[sz]) || 0);
      });
    });
    // Pick lines come in two shapes: raw from Supabase (sizes nested under
    // `.sizes`) or hydrated by App load (sizes spread to top-level). Handle both.
    (it.pick_lines || []).forEach((pk) => {
      const szObj = pk && pk.sizes && typeof pk.sizes === 'object' ? pk.sizes : pk;
      Object.keys(szObj || {}).forEach((kk) => { if (isSizeQty(kk, szObj[kk])) addSize(kk, 'onIf', Number(szObj[kk]) || 0); });
    });
  });

  // Resolve an order line to its SO product: exact sku → product_id → name
  // (the SO's clean name is a substring of the order's longer name, which has
  // extra vendor codes; the longest such match wins).
  const resolve = (sku, pid, name) => {
    const sk = norm(sku), ns = norm(name);
    if (sk) { const b = prods.find((p) => norm(p.sku) === sk); if (b) return b; }
    if (pid) { const b = prods.find((p) => p.pid === pid); if (b) return b; }
    if (ns) {
      let best = null, bestLen = 0;
      prods.forEach((p) => p.names.forEach((pn) => { if (pn.length >= 4 && ns.includes(pn) && pn.length > bestLen) { best = p; bestLen = pn.length; } }));
      if (best) return best;
    }
    return null;
  };

  // Demand lines, oldest order first (FIFO front-of-line gets stock first).
  // OMG orders sort by order number; webstore orders by creation time.
  const fifoKey = (o) => String(o.omg_order_number || o.created_at || o.id || '');
  const sorted = [...orders].sort((a, b) => fifoKey(a).localeCompare(fifoKey(b), undefined, { numeric: true }));
  // Clone each bucket's per-size supply into a drawable pool.
  const pools = prods.map((p) => { const s = {}; Object.keys(p.sizes).forEach((k) => { s[k] = { ...p.sizes[k] }; }); return s; });
  const idxOf = new Map(prods.map((p, i) => [p, i]));
  const out = {};
  sorted.forEach((o) => {
    (o.items || []).forEach((i) => {
      if (i.is_bundle_parent) return;
      const qty = Number(i.qty) || 0;
      const b = resolve(i.sku, i.product_id, i.name);
      const pool = b ? pools[idxOf.get(b)][sizeKey(i.size)] : null;
      const take = (field) => { if (!pool) return 0; const n = Math.max(0, Math.min(pool[field] || 0, qty)); pool[field] -= n; return n; };
      const onIf = take('onIf');
      const received = take('received');
      const billed = take('billed');
      const inv = invByPid[i.product_id] || {};
      const onHand = Number(inv[i.size] || inv[norm(i.size)] || inv[sizeKey(i.size)] || 0) || 0;
      const covered = received + (includeIF ? onIf : 0);
      const shipped = i.line_status === 'shipped' || (Number(i.shipped_qty) || 0) >= qty;
      // "Backordered" only when the line is actually flagged; the normal
      // not-yet-received state is the neutral "awaiting".
      const status = shipped ? 'shipped'
        : covered >= qty && qty > 0 ? 'ready'
        : covered > 0 ? 'partial'
        : billed > 0 ? 'incoming'
        : i.backordered ? 'backordered'
        : 'awaiting';
      // sku/soName carry the matched SO line down so the order grid can show
      // the same (possibly re-mapped) SKU that's on the SO.
      out[i.id] = { ordered: qty, billed, received, onIf, onHand, need: Math.max(0, qty - covered), status, sku: (b && b.sku) || i.sku || '', soName: (b && b.names[0]) || '' };
    });
  });
  return out;
}

// Light pre-flight validation of a ship-to address before buying a label —
// catches the common, label-wasting mistakes (missing fields, a state that
// isn't a 2-letter code, a ZIP that isn't 5 or 9 digits). Returns an error
// string, or null when it looks shippable. Note: this is format validation, not
// full USPS/CASS deliverability verification.
export const validateShipAddress = (a = {}) => {
  const miss = [];
  if (!a.street1 || !String(a.street1).trim()) miss.push('street');
  if (!a.city || !String(a.city).trim()) miss.push('city');
  if (!a.state || !String(a.state).trim()) miss.push('state');
  if (!a.zip || !String(a.zip).trim()) miss.push('ZIP');
  if (miss.length) return 'Missing ' + miss.join(', ');
  const country = String(a.country || 'US').toUpperCase();
  if (country === 'US' || country === 'USA') {
    if (!/^[A-Za-z]{2}$/.test(String(a.state).trim())) return 'State must be a 2-letter code (e.g. CA)';
    if (!/^\d{5}(-\d{4})?$/.test(String(a.zip).trim())) return 'ZIP must be 5 digits (or ZIP+4)';
  }
  return null;
};

// Estimate a garment's shipping weight (oz) from its name/SKU — a local,
// rule-based lookup (no network or AI needed, so it's instant, free and
// deterministic): hoodie ≈ 18oz, tee ≈ 6oz, shorts ≈ 7oz, etc. Used to weigh
// shipping labels when a catalog weight isn't set on the product.
export function estimateWeightOz(text) {
  const t = (text || '').toLowerCase();
  const rules = [
    [/back ?pack|duffel|duffle|equipment bag|gear bag/, 28],
    [/tote|sackpack|cinch|drawstring|bag/, 10],
    [/jacket|coat|parka|fleece|pullover|hoodie|hooded|sweatshirt|quarter ?zip|1\/4 ?zip|half ?zip|1\/2 ?zip/, 18],
    [/sweatpant|jogger|tearaway|pant|legging|tight/, 12],
    [/short/, 7],
    [/jersey|tank|singlet/, 5],
    [/tee|t-?shirt|shirt|polo|jersey top|top|warmup|warm-?up/, 6],
    [/beanie|hat|cap|visor/, 3],
    [/sock|glove|belt|headband|wristband|scrunchie/, 2],
    [/bottle|tumbler|mug/, 14],
    [/ball/, 16],
    [/blanket|towel/, 20],
  ];
  for (const [re, oz] of rules) if (re.test(t)) return oz;
  return 8; // generic garment default
}

// Order ship weight (lbs): sum each line's weight (catalog override by
// product_id, else the name/SKU estimate) × qty; fall back to the store's flat
// label weight if nothing resolves. Bundle parents are excluded.
export function labelWeightLbs(items, store = {}, weightByPid = {}) {
  let oz = 0, any = false;
  (items || []).filter((i) => !i.is_bundle_parent).forEach((i) => {
    const w = (weightByPid && weightByPid[i.product_id]) || estimateWeightOz(i.sku || i.name);
    oz += w * (i.qty || 1); any = true;
  });
  if (any && oz > 0) return Math.max(0.1, Math.round(oz / 16 * 10) / 10);
  return Number(store && store.label_weight_lbs) || 1;
}

// ── 4×6 QR LABELS (portrait thermal) ──
// One shared renderer for every warehouse 4×6: receiving, item fulfillment,
// box / deco hand-off. Print stock is PORTRAIT 4in × 6in (@page below pins it
// so the browser targets the label, not Letter). Layout, top→bottom:
//   QR (scan) → CODE (IF#/PO#) → SO# → PROGRAM (team) → status note → items.
// Callers pass either the legacy {id,qrData,lines,shipBadge} shape — lines
// tagged cls:'team'→program, 'so'→subtitle(SO#), 'sku'/'sz'/plain→items,
// 'sub'→note — or explicit {program,subtitle,items,note,code,codeSub} which
// wins over lines.
const _LABEL_CSS=`
  @page{size:4in 6in;margin:0.15in}
  @media print{html,body{width:3.7in}}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;font-family:Helvetica,Arial,sans-serif;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:3.7in;padding:6px 8px;page-break-after:always}
  .page:last-child{page-break-after:auto}
  .qr{text-align:center;margin-bottom:2px}
  .qr img{width:1.3in;height:1.3in;display:inline-block;image-rendering:pixelated}
  .code{font-size:22px;font-weight:800;line-height:1.1;text-align:center;margin:2px 0 0}
  .subtitle{font-size:24px;font-weight:700;line-height:1.1;text-align:center;margin:2px 0 0}
  .program{font-size:28px;font-weight:900;line-height:1.08;text-align:center;margin:5px 0 0;overflow-wrap:break-word}
  .rep{font-size:11px;font-weight:700;color:#334155;text-align:center;margin:4px 0 0}
  .badge{display:block;margin:6px auto 0;max-width:92%;padding:5px 8px;border:2px solid #d97706;border-radius:6px;font-weight:800;font-size:12px;text-align:center}
  .meta{font-size:11px;font-weight:800;text-align:center;margin:6px 0 0;line-height:1.3}
  .meta .mcode{font-weight:700;color:#334155}
  .items{margin-top:8px}
  .item{margin-bottom:6px;text-align:center}
  .item-title{font-size:21px;font-weight:800;line-height:1.15;overflow-wrap:break-word}
  .item-detail{font-size:13px;font-weight:500;color:#475569;margin-top:2px}
  .item-sz{font-size:18px;font-weight:800;letter-spacing:0.5px;margin-top:2px}
  .foot-note{font-size:10px;color:#64748b;font-weight:600;text-align:center;margin-top:8px}
`;
// Wait for every QR image to finish loading before printing (a stacked
// multi-label job has one <img> per page), with a safety timeout so a slow/
// failed QR never wedges the print dialog.
const _LABEL_PRINT_JS=`
  var imgs=[].slice.call(document.images),done=0,printed=false;
  function go(){if(printed)return;printed=true;setTimeout(function(){try{window.focus()}catch(e){}window.print();},90);}
  function tick(){if(++done>=imgs.length)go();}
  if(!imgs.length){go();}else{imgs.forEach(function(im){if(im.complete&&im.naturalWidth>0){tick();}else{im.addEventListener('load',tick);im.addEventListener('error',tick);}});}
  setTimeout(go,4000);
`;
const _qrImgSrc=(label,size)=>'https://api.qrserver.com/v1/create-qr-code/?size='+(size||'360x360')+'&margin=4&data='+encodeURIComponent((label&&(label.qrData||label.id))||'');
// Resolve a label's display zones from either explicit fields or legacy `lines`.
const _labelZones=(label={})=>{
  if(label.items||label.program||label.subtitle){
    return {program:label.program||'',subtitle:label.subtitle||'',rep:label.rep||'',notes:label.note?[{text:label.note,style:label.noteStyle||''}]:[],items:label.items||[],code:label.code||label.id||''};
  }
  const norm=(label.lines||[]).filter(Boolean).map(l=>typeof l==='string'?{text:l}:l);
  let program='',subtitle='',rep='';const notes=[],items=[];let cur=null;
  norm.forEach(l=>{const t=l.text==null?'':l.text,cls=l.cls||'';
    if(cls==='team'&&!program){program=t;return}
    if(cls==='so'&&!subtitle){subtitle=t;return}
    if(cls==='rep'&&!rep){rep=t;return}
    if(cls==='sku'){cur={title:t,detail:'',sizes:''};items.push(cur);return}
    if(cls==='sz'){if(cur){cur.sizes=cur.sizes?cur.sizes+'  '+t:t}else{cur={title:'',detail:'',sizes:t};items.push(cur)}return}
    if(cls==='sub'){notes.push({text:t,style:l.style||''});return}
    if(cur){cur.detail=cur.detail?cur.detail+' · '+t:t}else{notes.push({text:t,style:l.style||''})}
  });
  return {program,subtitle,rep,notes,items,code:label.code||label.id||''};
};
const _labelPageHtml=(label={})=>{
  const z=_labelZones(label);
  const sb=label.shipBadge;
  const badge=sb&&sb.text?`<div class="badge" style="border-color:${sb.color||'#d97706'};color:${sb.color||'#92400e'};background:${sb.bg||'#fffbeb'}">${sb.text}</div>`:'';
  // The scan code (IF#/PO#) is secondary: it rides on the meta line with the
  // status note (e.g. "IF-1005 · PULLED — 6/16/2026"). Only when there's no
  // prominent header at all (program + SO# both blank, e.g. a stock PO) does
  // the code get promoted to its own big line so the label isn't headerless.
  const hasHeader=!!(z.program||z.subtitle);
  const bigCode=(!hasHeader&&z.code)?z.code:'';
  const metaParts=[];
  if(!bigCode&&z.code)metaParts.push(`<span class="mcode">${z.code}</span>`);
  (z.notes||[]).forEach(n=>metaParts.push(`<span style="${n.style||'color:#166534'}">${n.text}</span>`));
  const metaHtml=metaParts.length?`<div class="meta">${metaParts.join(' · ')}</div>`:'';
  const itemsHtml=(z.items||[]).map(it=>`<div class="item"><div class="item-title">${it.title||''}</div>${it.detail?`<div class="item-detail">${it.detail}</div>`:''}${it.sizes?`<div class="item-sz">${it.sizes}</div>`:''}</div>`).join('');
  return `<div class="page">`
    +`<div class="qr"><img src="${_qrImgSrc(label)}" alt="${z.code}"/></div>`
    +(bigCode?`<div class="code">${bigCode}</div>`:'')
    +(z.subtitle?`<div class="subtitle">${z.subtitle}</div>`:'')
    +(z.program?`<div class="program">${z.program}</div>`:'')
    +(z.rep?`<div class="rep">${z.rep}</div>`:'')
    +badge
    +metaHtml
    +`<div class="items">${itemsHtml}</div>`
    +(label.codeSub?`<div class="foot-note">${label.codeSub}</div>`:'')
    +`</div>`;
};
// Print one or more 4×6 portrait labels in a single job — one page per label.
export const printQrLabels=(labels)=>{
  const list=(labels||[]).filter(Boolean);if(!list.length)return;
  const w=window.open('','_blank','width=460,height=680');if(!w)return;
  const title=(list[0].code||list[0].id||'Label')+(list.length>1?(' +'+(list.length-1)):'');
  const html=`<!doctype html><html><head><title>${title}</title><style>${_LABEL_CSS}</style></head><body>`
    +list.map(_labelPageHtml).join('')
    +`<script>${_LABEL_PRINT_JS}</script></body></html>`;
  w.document.write(html);w.document.close();
};
export const printQrLabel=(label)=>printQrLabels([label]);
// PDF twin of `printQrLabel` — same portrait 4×6 layout, saved as a file. The
// QR is fetched and inlined as a data URL so html2canvas isn't blocked by
// api.qrserver.com's CORS headers (a cross-origin image taints the canvas and
// the PDF comes out blank). html2pdf is imported on demand (it's warmed in
// App.js); a bare reference here was an unbound ReferenceError.
export const downloadQrLabel=async(label={})=>{
  const z=_labelZones(label);
  let qrSrc=_qrImgSrc(label,'600x600');
  try{
    const resp=await fetch(qrSrc);
    if(resp.ok){const blob=await resp.blob();qrSrc=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
  }catch(e){/* fall back to direct URL */}
  const sb=label.shipBadge;
  const badge=sb&&sb.text?`<div style="display:block;margin:6px auto 0;max-width:92%;padding:5px 8px;border:2px solid ${sb.color||'#d97706'};color:${sb.color||'#92400e'};background:${sb.bg||'#fffbeb'};border-radius:6px;font-weight:800;font-size:12px;text-align:center">${sb.text}</div>`:'';
  const hasHeader=!!(z.program||z.subtitle);
  const bigCode=(!hasHeader&&z.code)?z.code:'';
  const metaParts=[];
  if(!bigCode&&z.code)metaParts.push(`<span style="font-weight:700;color:#334155">${z.code}</span>`);
  (z.notes||[]).forEach(n=>metaParts.push(`<span style="${n.style||'color:#166534'}">${n.text}</span>`));
  const metaHtml=metaParts.length?`<div style="font-size:11px;font-weight:800;text-align:center;margin:6px 0 0;line-height:1.3">${metaParts.join(' · ')}</div>`:'';
  const itemsHtml=(z.items||[]).map(it=>`<div style="margin-bottom:6px;text-align:center"><div style="font-size:21px;font-weight:800;line-height:1.15;overflow-wrap:break-word">${it.title||''}</div>${it.detail?`<div style="font-size:13px;font-weight:500;color:#475569;margin-top:2px">${it.detail}</div>`:''}${it.sizes?`<div style="font-size:18px;font-weight:800;letter-spacing:0.5px;margin-top:2px">${it.sizes}</div>`:''}</div>`).join('');
  // Off-screen container at position:absolute;left:-9999px (not fixed, no
  // negative z-index) so html2canvas captures the real box, not a blank region.
  const container=document.createElement('div');
  container.style.cssText='position:absolute;left:-9999px;top:0;width:360px;background:#fff';// ~3.7in @96dpi
  const page=document.createElement('div');
  page.style.cssText='width:360px;padding:8px 12px;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif;color:#0f172a';
  page.innerHTML=`<div style="text-align:center;margin-bottom:2px"><img src="${qrSrc}" style="width:125px;height:125px;display:inline-block;image-rendering:pixelated"/></div>`
    +(bigCode?`<div style="font-size:22px;font-weight:800;line-height:1.1;text-align:center;margin:2px 0 0">${bigCode}</div>`:'')
    +(z.subtitle?`<div style="font-size:24px;font-weight:700;line-height:1.1;text-align:center;margin:2px 0 0">${z.subtitle}</div>`:'')
    +(z.program?`<div style="font-size:28px;font-weight:900;line-height:1.08;text-align:center;margin:5px 0 0;overflow-wrap:break-word">${z.program}</div>`:'')
    +(z.rep?`<div style="font-size:11px;font-weight:700;color:#334155;text-align:center;margin:4px 0 0">${z.rep}</div>`:'')
    +badge+metaHtml
    +`<div style="margin-top:8px">${itemsHtml}</div>`
    +(label.codeSub?`<div style="font-size:10px;color:#64748b;font-weight:600;text-align:center;margin-top:8px">${label.codeSub}</div>`:'');
  container.appendChild(page);
  document.body.appendChild(container);
  const fname=String(label.code||label.id||'label').replace(/[^a-z0-9._-]+/gi,'_')+'.pdf';
  try{
    const imgEl=page.querySelector('img');
    if(imgEl&&!(imgEl.complete&&imgEl.naturalWidth>0)){await new Promise(resolve=>{imgEl.onload=resolve;imgEl.onerror=resolve;setTimeout(resolve,3000)})}
    await new Promise(r=>setTimeout(r,400));
    const html2pdf=(await import('html2pdf.js')).default;
    await html2pdf().set({margin:0.15,filename:fname,image:{type:'jpeg',quality:0.98},html2canvas:{scale:3,useCORS:true,allowTaint:true,logging:false,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:[4,6],orientation:'portrait'}}).from(page).save();
  }finally{
    document.body.removeChild(container);
  }
};
// Download a full-page (letter) PDF pick ticket for an item fulfillment, laid
// out like a packing slip via buildDocHtml/downloadDoc. The 4x6 thermal label
// stays on printQrLabel/downloadQrLabel; this is the "Download (PDF)" sheet.
// The QR is fetched and inlined as a data URL so html2canvas doesn't get
// blocked by api.qrserver.com's CORS headers.
export const downloadQrSheet=async({id,qrData,title,subtitle,shipBadge,items,totalUnits})=>{
  const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=4&data='+encodeURIComponent(qrData||id||'');
  let qrSrc=qrUrl;
  try{
    const resp=await fetch(qrUrl);
    if(resp.ok){const blob=await resp.blob();qrSrc=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
  }catch(e){/* fall back to direct URL */}
  const headerRight='<img src="'+qrSrc+'" alt="'+(id||'')+'" style="width:130px;height:130px;display:block;margin:0 0 6px auto;background:#fff;padding:4px;image-rendering:pixelated"/>'+(totalUnits!=null?'<div class="ta" style="font-size:22px">'+totalUnits+' Units</div>':'');
  const infoBoxes=[];
  if(title)infoBoxes.push({label:'Customer / Team',value:title,sub:subtitle||''});
  if(shipBadge&&shipBadge.text)infoBoxes.push({label:'Ship To',value:shipBadge.text});
  else infoBoxes.push({label:'Fulfillment',value:'In-House Deco'});
  const rows=(items||[]).map(it=>({cells:[it.sku||'',it.name||'',it.color||'—',it.sizes||'',it.units!=null?it.units:'']}));
  const opts={
    title:title||id,docNum:id,docType:'PICK TICKET',showPricing:false,
    headerRight,
    infoBoxes,
    tables:[{title:'Items to Pull',headers:['SKU','Item','Color','Sizes','Qty'],aligns:['left','left','left','left','center'],rows}],
    footer:'Item Fulfillment — Warehouse Pick Ticket'
  };
  return downloadDoc(opts,String(id||'pick-ticket'));
};
// Fetch the logo and return it as a base64 data URL so the HTML sent to the
// pdf-generator function is fully self-contained. Puppeteer can then use
// domcontentloaded instead of networkidle0, saving ~500ms+ per request.
const _inlineLogoUrl=async(logoUrl)=>{
  if(!logoUrl||/^data:/i.test(logoUrl))return logoUrl;
  try{
    const r=await fetch(logoUrl);
    if(!r.ok)return logoUrl;
    const blob=await r.blob();
    return await new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>resolve(logoUrl);
      reader.readAsDataURL(blob);
    });
  }catch{return logoUrl;}
};

const _serverPdf=async(html,fname,extra)=>{
  const r=await fetch('/.netlify/functions/pdf-generator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html,filename:fname,...(extra||{})})});
  if(!r.ok)throw new Error('PDF generation failed: '+r.status);
  return r.json();
};

// For repeatInfoHeader docs, tell the Puppeteer PDF function to repeat the info
// cells in each page's top margin (and reserve that margin so content clears it).
const _repeatHeaderPdfOpts=opts=>opts.repeatInfoHeader?{
  displayHeaderFooter:true,
  headerTemplate:_pdfHeaderTemplate(opts.docType,opts.docNum,opts.infoBoxes),
  footerTemplate:'<span></span>',
  margin:{top:'0.8in',right:'0.4in',bottom:'0.4in',left:'0.4in'},
}:undefined;

export const downloadDoc=async(opts,filename)=>{
  const logoUrl=await _inlineLogoUrl(_absLogoUrl(opts.companyInfo));
  const docHtml=buildDocHtml({...opts,css:opts.css||_PRINT_CSS,companyInfo:{...(opts.companyInfo||{}),logoUrl}});
  const safe=String(filename||opts.docNum||'document').replace(/[^a-z0-9._-]+/gi,'_');
  const fname=safe.replace(/\.html?$/i,'')+'.pdf';
  const {content}=await _serverPdf(docHtml,fname,_repeatHeaderPdfOpts(opts));
  const bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fname;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
};

export const buildPdfAttachment=async(opts,filename)=>{
  const logoUrl=await _inlineLogoUrl(_absLogoUrl(opts.companyInfo));
  const docHtml=buildDocHtml({...opts,css:opts.css||_PRINT_CSS,companyInfo:{...(opts.companyInfo||{}),logoUrl}});
  const safe=String(filename||opts.docNum||'document').replace(/[^a-z0-9._-]+/gi,'_');
  const fname=safe.replace(/\.html?$/i,'')+'.pdf';
  return _serverPdf(docHtml,fname,_repeatHeaderPdfOpts(opts));
};

export const openDocPDF=async(opts,filename)=>{
  const logoUrl=await _inlineLogoUrl(_absLogoUrl(opts.companyInfo));
  const docHtml=buildDocHtml({...opts,css:opts.css||_PRINT_CSS,companyInfo:{...(opts.companyInfo||{}),logoUrl}});
  const safe=String(filename||opts.docNum||'document').replace(/[^a-z0-9._-]+/gi,'_');
  const fname=safe.replace(/\.html?$/i,'')+'.pdf';
  const {content}=await _serverPdf(docHtml,fname,_repeatHeaderPdfOpts(opts));
  const bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  window.open(url,'_blank');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
};
export const nextInvId=invs=>{const nums=(invs||[]).map(i=>{const m=String(i.id).match(/(\d+)$/);return m?parseInt(m[1]):0});return'INV-'+(Math.max(1000,...nums)+1)};

// Decoration label used on PDF line-item rows. Includes the decoration name
// (the art file name) when one exists; falls back to the TBD type so a
// not-yet-named screen print still reads as "screen 3 color".
export const pdfDecoLabel = (d, artF) => {
  if (!d) return '';
  if (d.kind === 'numbers') {
    return ('Numbers (' + (d.num_method||'heat transfer').replace(/_/g,' ') + ' ' + (d.front_and_back ? 'F:'+(d.num_size||'4"')+' B:'+(d.num_size_back||d.num_size||'4"') : (d.num_size||'4"')) + (d.print_color ? ' — '+d.print_color : '') + ')' + (d.front_and_back ? ' F+B' : '')).replace(/_/g,' ');
  }
  if (d.kind === 'names') {
    return ('Names' + (d.print_color ? ' ('+d.print_color+')' : '')).replace(/_/g,' ');
  }
  if (d.kind === 'outside_deco') {
    return (d.deco_type || 'Decoration').replace(/_/g,' ');
  }
  // art (default)
  const namePart = artF && artF.name ? String(artF.name).trim() : '';
  const typePart = ((artF && artF.deco_type) || d.art_tbd_type || 'decoration').replace(/_/g,' ');
  return namePart ? (namePart + ' — ' + typePart) : typePart;
};

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

// ── AI order builder: vendor SKU enrichment ──
// When Claude returns a SKU we can't find in our internal `products` table,
// fan out the SKU lookup to SanMar / S&S / Momentec in parallel. First
// real hit wins. Returns a normalized object the wizard and OrderEditor's
// build-with-AI modal can splice straight onto the line.
//
// Vendor helpers are imported lazily to avoid bloating the React entry chunk
// — this function is only called when there are unmatched SKUs.
export async function lookupVendorSku(sku){
  if(!sku)return null;
  const s=String(sku).trim();
  if(!s||s.toUpperCase()==='CUSTOM'||s.length<3)return null;

  let sanmarGetProduct, ssGetProducts, momentecGetProductByPartNumber;
  try{
    const v=await import('./vendorApis');
    sanmarGetProduct=v.sanmarGetProduct;
    ssGetProducts=v.ssGetProducts;
    momentecGetProductByPartNumber=v.momentecGetProductByPartNumber;
  }catch(e){console.warn('[lookupVendorSku] vendorApis import failed:',e);return null}

  const safe=p=>p.then(v=>({ok:true,v})).catch(e=>({ok:false,e}));
  const [sanmarR,ssR,momR]=await Promise.all([
    sanmarGetProduct?safe(sanmarGetProduct(s,'','')):Promise.resolve({ok:false}),
    ssGetProducts?safe(ssGetProducts({sku:s})):Promise.resolve({ok:false}),
    momentecGetProductByPartNumber?safe(momentecGetProductByPartNumber(s)):Promise.resolve({ok:false}),
  ]);

  // SanMar — full product data + pricing + image
  if(sanmarR.ok){
    const items=sanmarR.v?.items||[];
    if(items.length>0){
      const it=items[0];
      const basic=it.productBasicInfo||{};
      const price=it.productPriceInfo||{};
      const img=it.productImageInfo||{};
      const piece=parseFloat(price.piecePrice||price.casePrice||0)||0;
      const cust=parseFloat(price.customerPrice||price.salePrice||piece)||0;
      return{
        source:'sanmar',
        sku:basic.style||basic.styleNumber||s,
        name:basic.productTitle||basic.description||basic.styleNumber||'',
        brand:basic.brandName||'',
        color:basic.colorName||basic.catalogColor||'',
        nsa_cost:piece,
        retail_price:cust>0?cust:piece,
        image_url:img.colorProductImage||img.colorProductImageThumbnail||null,
      };
    }
  }

  // S&S — endpoint returns single object (or array) of product detail
  if(ssR.ok){
    const raw=ssR.v;const v=Array.isArray(raw)?raw[0]:raw;
    if(v&&(v.sku||v.styleID||v.styleNumber||v.style)){
      const cost=parseFloat(v.customerPrice??v.CustomerPrice??v.salePrice??v.SalePrice??v.price??v.Price)||0;
      const retail=parseFloat(v.piecePrice??v.PiecePrice??v.msrp??v.MSRP??v.customerPrice??v.CustomerPrice)||0;
      return{
        source:'ss',
        sku:v.styleNumber||v.style||v.sku||s,
        name:v.styleName||v.title||v.description||'',
        brand:v.brandName||v.brand||'',
        color:v.colorName||v.color||'',
        nsa_cost:cost,
        retail_price:retail>0?retail:cost,
        image_url:v.colorFrontImage||v.styleImage||v.frontImage||null,
      };
    }
  }

  // Momentec — public catalog; pricing requires dealer auth so we surface name/image only
  if(momR.ok){
    const ev=momR.v?.CatalogEntryView||[];
    if(ev.length>0){
      const it=ev[0];
      return{
        source:'momentec',
        sku:it.partNumber||s,
        name:it.name||it.title||'',
        brand:it.manufacturer||'',
        color:'',
        nsa_cost:0,
        retail_price:0,
        image_url:it.thumbnail||it.fullImage||null,
      };
    }
  }

  return null;
}

// Enrich an array of parsed AI lines with vendor pricing/names for any line
// missing an internal catalog match. Mutates a shallow-copied array and
// returns the new array so callers can swap state in one assignment.
export async function enrichAiLinesWithVendors(lines,onProgress){
  if(!Array.isArray(lines))return lines;
  const out=lines.map(l=>({...l}));
  const targets=[];
  out.forEach((l,i)=>{if(!l.product_id&&(l.sku_guess||'').trim()&&l.match_quality!=='no_sku')targets.push(i)});
  if(targets.length===0)return out;
  let done=0;
  await Promise.all(targets.map(async i=>{
    const hit=await lookupVendorSku(out[i].sku_guess);
    done++;if(onProgress)try{onProgress(done,targets.length)}catch(_){}
    if(!hit)return;
    out[i]={
      ...out[i],
      name:out[i].name||hit.name,
      brand:out[i].brand||hit.brand,
      color:out[i].color||hit.color,
      vendor_source:hit.source,
      vendor_price:hit.nsa_cost,
      vendor_retail:hit.retail_price,
      vendor_image:hit.image_url,
      match_quality:'vendor_'+hit.source,
    };
  }));
  return out;
}

