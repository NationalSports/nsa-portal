const { randomUUID } = require('crypto');
const { corsHeaders, verifyUser } = require('./_shared');
const BUCKET = 'vendor-price-lists';
const TYPES = { pdf: 'application/pdf', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const reply = (statusCode, data) => ({ statusCode, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
const check = (result) => { if (result.error) throw result.error; return result.data; };
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0,max) : '';
function date(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Use a valid date');
  return value;
}
function validateUpload(body) {
  const fileName = clean(body.file_name);
  const ext = fileName.split('.').pop().toLowerCase();
  if (!TYPES[ext]) throw new Error('Choose a PDF, XLS or XLSX file');
  if (!Number.isInteger(body.file_size) || body.file_size < 1 || body.file_size > 20*1024*1024) throw new Error('File must be between 1 byte and 20 MB');
  const effective = date(body.effective_date), expires = date(body.expires_on);
  if (effective && expires && expires < effective) throw new Error('Expiry must be on or after the effective date');
  return { file_name: fileName, file_size: body.file_size, effective_date: effective, expires_on: expires, ext };
}
function validateChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > 2000) throw new Error('Document must contain 1–2,000 searchable sections');
  let total = 0;
  const result = chunks.map(c => {
    if (!c || typeof c.content !== 'string' || !c.content.trim() || c.content.length > 12000 || typeof c.location !== 'string' || !c.location.trim() || c.location.length > 200) throw new Error('Invalid document text or source location');
    total += c.content.length;
    return { content: c.content, location: c.location };
  });
  if (total > 2000000) throw new Error('Extracted document is too large; split the file into smaller lists');
  return result;
}
// Exact SKU tokens only. Never use fuzzy product matching for quantities.
function skuTokens(text) { return [...new Set((String(text).toUpperCase().match(/[A-Z0-9]+(?:[-/][A-Z0-9]+)*/g)||[]).filter(t => /\d/.test(t) && t.length >= 5 && t.length <= 32))].slice(0,60); }
function stockSource(vendor) {
  const keys = [vendor?.api_provider, vendor?.name].map(v=>String(v||'').trim().toLowerCase());
  if (keys.includes('adidas')) return 'adidas';
  if (keys.some(k=>['ua','under armour','under armor'].includes(k))) return 'ua';
  return null;
}
async function search(admin, body) {
  const query = clean(body.query);
  if (!query) return { matches: [], stock: [], warnings: [] };
  const vendorName = clean(body.vendor,120);
  let vendor = null;
  if (body.vendor_id) {
    vendor=check(await admin.from('vendors').select('id,name,api_provider').eq('id',clean(body.vendor_id)).maybeSingle());
    if(!vendor) throw new Error('Vendor not found');
  } else if (vendorName) {
    // Do not permit PostgREST wildcard syntax from model/user input.
    const name = vendorName.toLowerCase() === 'ua' ? 'Under Armour' : vendorName;
    const vendors = check(await admin.from('vendors').select('id,name,api_provider').ilike('name',`%${name.replace(/[%_]/g,'')}%`).limit(10)) || [];
    vendor = vendors.find(v=>v.name.toLowerCase()===name.toLowerCase()) || (vendors.length===1?vendors[0]:null);
    if (!vendor) throw new Error('Vendor name is missing or ambiguous. Use the full vendor name.');
  }
  const matches = check(await admin.rpc('search_vendor_price_lists',{p_query:query,p_vendor_id:vendor?.id||null})) || [];
  const stock = [], warnings = [];
  for (const source of ['adidas','ua']) {
    if (vendor && stockSource(vendor) !== source) continue;
    const relevant = matches.filter(m=>stockSource({name:m.vendor_name})===source);
    const tokens = skuTokens([query,...relevant.map(m=>m.content)].join(' '));
    if (!tokens.length) continue;
    try {
      const rows = check(await admin.from(source+'_inventory').select('sku,size,stock_qty,future_delivery_date,future_delivery_qty,last_synced,source').in('sku',tokens).limit(301)) || [];
      if (rows.length > 300) warnings.push(`${source.toUpperCase()} stock results truncated; search a specific SKU.`);
      stock.push(...rows.slice(0,300).map(r=>({...r,feed:r.source,source})));
    } catch { warnings.push(`${source.toUpperCase()} stock sync could not be read. Availability is unknown.`); }
  }
  return { query, matches, stock, warnings, limited: matches.length===20 };
}
exports.handler = async (event) => {
  if (event.httpMethod==='OPTIONS') return reply(200,{});
  if (event.httpMethod!=='POST') return reply(405,{error:'POST required'});
  const auth = await verifyUser(event);
  if (!auth.ok) return reply(auth.status,{error:auth.error});
  const admin = auth.admin;
  let body;
  try { if ((event.body||'').length > 3000000) throw new Error(); body=JSON.parse(event.body||'{}'); } catch { return reply(400,{error:'Invalid or oversized request'}); }
  try {
    if (body.action==='search') return reply(200,await search(admin,body));
    if (body.action==='list') {
      const rows = check(await admin.from('vendor_price_lists').select('id,file_name,file_size,status,effective_date,expires_on,created_at,indexed_at').eq('vendor_id',clean(body.vendor_id)).order('created_at',{ascending:false}).limit(100));
      return reply(200,{documents:rows||[]});
    }
    if (body.action==='begin') {
      const input=validateUpload(body), id=randomUUID(), vendorId=clean(body.vendor_id);
      const vendor=check(await admin.from('vendors').select('id').eq('id',vendorId).maybeSingle());
      if (!vendor) return reply(404,{error:'Vendor not found'});
      const path=`${id}/source.${input.ext}`;
      const {ext,...fields}=input;
      check(await admin.from('vendor_price_lists').insert({...fields,id,vendor_id:vendorId,storage_path:path,created_by:auth.userId}));
      const signed=check(await admin.storage.from(BUCKET).createSignedUploadUrl(path));
      return reply(200,{id,path,token:signed.token,content_type:TYPES[ext]});
    }
    const doc=check(await admin.from('vendor_price_lists').select('*').eq('id',clean(body.id)).maybeSingle());
    if (!doc) return reply(404,{error:'Price list not found'});
    if (body.action==='complete') {
      if (doc.created_by!==auth.userId || doc.status!=='uploading') return reply(409,{error:'Upload is not pending for this user'});
      const chunks=validateChunks(body.chunks);
      // Signed upload must have actually completed before publishing the search index.
      const files=check(await admin.storage.from(BUCKET).list(doc.id,{limit:10}));
      const file=(files||[]).find(f=>f.name===doc.storage_path.split('/').pop());
      if (!file || Number(file.metadata?.size)!==doc.file_size) return reply(409,{error:'Source upload is incomplete; upload the file again'});
      check(await admin.rpc('publish_vendor_price_list',{p_id:doc.id,p_actor:auth.userId,p_chunks:chunks}));
      return reply(200,{ok:true});
    }
    if (body.action==='archive') {
      check(await admin.from('vendor_price_lists').update({status:'archived'}).eq('id',doc.id));
      return reply(200,{ok:true});
    }
    if (body.action==='download') {
      const signed=check(await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path,120));
      return reply(200,{url:signed.signedUrl});
    }
    return reply(400,{error:'Unknown action'});
  } catch (e) { console.error('[vendor-price-lists]',e.message); return reply(400,{error:e.message||'Price-list request failed'}); }
};
exports._test={validateUpload,validateChunks,skuTokens,stockSource,search};
