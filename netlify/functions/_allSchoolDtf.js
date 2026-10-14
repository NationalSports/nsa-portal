const crypto = require('crypto');
const { sendPortalEmail, loadEmailRegistry } = require('./_emailRouter');
const REQUESTS = 'all_school_dtf_requests';
const BATCHES = 'all_school_dtf_batches';
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k,stable(value[k])])) : value;
const sourceFingerprint = item => hash(Buffer.from(JSON.stringify(stable({qty:item.qty,player_name:item.player_name || '',player_number:item.player_number || '',size:item.size,sku:item.sku,production_recipe:item.production_recipe || {}}))));
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeCsv = value => '"' + String(value == null ? '' : value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
// The supplier matches each chart row to its file by the permanent Art ID, so the
// attachment is named after it (ART-000123-V01-R01.ai). Older manifests keep the
// original file name.
const artworkFileName = m => {
  const original = (m.artwork && (m.artwork.name || String(m.artwork.path || '').split('/').pop())) || '';
  const ext = (original.match(/\.[a-z0-9]+$/i) || ['.ai'])[0];
  return m.art_code ? m.art_code + ext : original;
};
const httpsUrl = value => /^https:\/\/[^\s"'<>]+$/i.test(String(value || '')) ? String(value) : '';
const SIZE_ORDER = ['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL','5XL','6XL','OSFA'];
const sizeRank = size => { const i = SIZE_ORDER.indexOf(String(size || '').toUpperCase()); return i < 0 ? SIZE_ORDER.length : i; };

// Owner of an art-folder entry: the store's customer, else its parent program
// (checkout reads art from exactly those two folders).
async function artOwner(admin, store, artId, cache) {
  if (!cache.has('customer')) {
    const res = await admin.from('customers').select('id,parent_id,art_files').eq('id',store.customer_id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    cache.set('customer',res.data || null);
  }
  const has = c => !!(c && Array.isArray(c.art_files) && c.art_files.some(a => a && a.id === artId));
  const customer = cache.get('customer');
  if (has(customer)) return customer.id;
  if (customer && customer.parent_id) {
    if (!cache.has('parent')) {
      const res = await admin.from('customers').select('id,art_files').eq('id',customer.parent_id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      cache.set('parent',res.data || null);
    }
    if (has(cache.get('parent'))) return cache.get('parent').id;
  }
  return store.customer_id;
}

async function assignArtCode(admin, store, variant, cache) {
  const customerId = await artOwner(admin, store, variant.art_id, cache);
  if (!customerId) throw new Error('store has no customer');
  const res = await admin.rpc('assign_art_code',{p_customer_id:customerId,p_art_id:variant.art_id,p_variant_key:variant.garment_color,p_revision_key:variant.id});
  if (res.error) throw new Error(res.error.message);
  if (!/^ART-\d{6}-V\d{2}-R\d{2}$/.test(res.data || '')) throw new Error('unexpected Art ID '+res.data);
  return res.data;
}

function validateManifest(manifest) {
  const errors = [];
  const art = manifest.artwork || {};
  if (!manifest.supplier_id) errors.push('Choose a DTF supplier');
  if (!art.bucket || !art.path || !/\.ai$/i.test(art.name || art.path)) errors.push('Attach the production .ai file');
  if (!/^[a-f0-9]{64}$/i.test(art.sha256 || '')) errors.push('Production artwork version has not been frozen');
  if (!(Number(manifest.width_in) > 0) || !(Number(manifest.height_in) > 0)) errors.push('Enter positive print width and height in inches');
  if (!manifest.placement) errors.push('Choose a print placement');
  if (!Number.isInteger(manifest.qty) || manifest.qty <= 0) errors.push('Print quantity must be a positive integer');
  return errors;
}

function manifestCsv(manifests) {
  const rows = [['Art ID','Artwork file','Sales order','Job','Artwork','Artwork version','SHA256','Width (in)','Height (in)','Placement','Total print quantity (once per design)','SKU','Color','Garment size','Prints for garment row','Names','Numbers','Instructions','Font','Print color','Artwork role','Customer shipment target','DTF garment color','Knockout treatment','DTF variant']];
  for (const m of manifests) (m.garments && m.garments.length ? m.garments : [{}]).forEach((garment,index) => {
    rows.push([m.art_code || '',artworkFileName(m),m.so_id,m.job_id,m.art_name,m.artwork_version,m.artwork && m.artwork.sha256,m.width_in,m.height_in,m.placement,index===0 ? m.qty:'',garment.sku,garment.color,garment.size,garment.qty,(garment.names || []).join(' | '),(garment.numbers || []).join(' | '),m.instructions,m.font,m.print_color,m.artwork_role || 'production artwork',m.ship_target_at,m.artwork?.at_once_variant?.garment_color,m.artwork?.at_once_variant?.knockout_color,m.artwork?.at_once_variant?.id]);
  });
  return rows.map(r => r.map(safeCsv).join(',')).join('\r\n');
}

async function downloadProductionArt(admin, art) {
  // Supabase's configured storage client is the only download authority. Never
  // fetch a customer-supplied URL (SSRF) or silently use a render/mockup as art.
  const result = await admin.storage.from(art.bucket).download(art.path);
  if (result.error || !result.data) throw new Error('Could not read the production artwork');
  const bytes = Buffer.from(await result.data.arrayBuffer());
  return { bytes, sha256: hash(bytes) };
}

function garmentRows(job, items, decorations) {
  const indexes = new Set((job.items || []).map(i => Number(i.item_idx)));
  const rows = [];
  for (const item of items.filter(i => indexes.has(Number(i.item_index)))) {
    const decos = decorations.filter(d => d.so_item_id === item.id);
    const names = decos.find(d => d.kind === 'names');
    const numbers = decos.find(d => d.kind === 'numbers');
    for (const [size, qty] of Object.entries(item.sizes || {})) if (Number(qty) > 0) rows.push({
      sku:item.sku, color:item.color, size, qty:Number(qty),
      names: names && names.names && names.names[size] || [],
      numbers: numbers && numbers.roster && numbers.roster[size] || [],
    });
  }
  return rows;
}

async function recordAllSchoolDtfForSo(admin, soId, { refreshBlocked = false } = {}) {
  const orderRes = await admin.from('webstore_orders').select('id,store_id,so_id,status,ship_target_at').eq('so_id',soId).limit(1);
  if (orderRes.error) throw new Error(orderRes.error.message);
  const order = (orderRes.data || [])[0];
  if (!order || !['paid','batched'].includes(order.status)) return { recorded:0 };
  const storeRes = await admin.from('webstores').select('id,customer_id,org_type,all_school_settings').eq('id',order.store_id).maybeSingle();
  if (storeRes.error) throw new Error(storeRes.error.message);
  const store = storeRes.data;
  if (!store || store.org_type !== 'all_school') return { recorded:0 };
  const reads = await Promise.all([
    admin.from('so_jobs').select('*').eq('so_id',soId).eq('deco_type','dtf'),
    admin.from('so_items').select('*').eq('so_id',soId),
    admin.from(REQUESTS).select('job_id,status').eq('so_id',soId),
    admin.from('all_school_decoration_allocations').select('*').eq('order_id',order.id),
    admin.from('job_stage_events').select('job_id,payload').eq('so_id',soId).eq('event','created'),
    admin.from('webstore_order_items').select('*').eq('order_id',order.id),
  ]);
  for (const read of reads) if (read.error) throw new Error(read.error.message);
  const [jobRes,itemRes,existingRes,allocationRes,eventRes,sourceRes] = reads;
  const items = itemRes.data || [];
  const decoRes = items.length ? await admin.from('so_item_decorations').select('*').in('so_item_id',items.map(i => i.id)) : {data:[]};
  if (decoRes.error) throw new Error(decoRes.error.message);
  let recorded = 0;
  const owners = new Map();
  for (const job of jobRes.data || []) {
    // Conversion's stock allocation is authoritative. No default to full units:
    // missing shortfall signal must never order prints already in inventory.
    if (['received','ordered'].includes(job.dtf_prints_status)) continue;
    const existing = (existingRes.data || []).find(r => r.job_id === job.id);
    if (existing && !(refreshBlocked && existing.status === 'blocked')) continue;
    const jobItems = items.filter(i => (job.items || []).some(j => Number(i.item_index) === Number(j.item_idx)));
    const sourceIds = new Set(jobItems.flatMap(i => i.source_webstore_item_ids || []));
    const logoRef = ((eventRes.data || []).find(e => e.job_id === job.id) || {}).payload?.logo_ref || '';
    const personalized = /^(name|numbers):/.test(logoRef);
    const relevant = (decoRes.data || []).filter(d => jobItems.some(i => i.id === d.so_item_id) && d.type === 'dtf');
    const codes = [...new Set(relevant.map(d => d.transfer_code).filter(Boolean))];
    const code = logoRef.startsWith('xfer:') ? logoRef.slice(5) : codes.length === 1 ? codes[0] : null;
    // The checkout recipe is immutable: later edits to the store's design must
    // never substitute different production art for an already paid order.
    const transfer = code ? (jobItems[0]?.recipe_snapshot?.transfer_inventory || []).find(t => t.code === code) : null;
    const savedTemplate = jobItems[0]?.recipe_snapshot?.personalization_template;
    const template = personalized && (logoRef.startsWith('numbers:') ? savedTemplate?.number_template || savedTemplate : savedTemplate);
    const artConfig = template || transfer || {};
    const allocations = (allocationRes.data || []).filter(a => sourceIds.has(a.order_item_id) && a.transfer_code === code && a.status !== 'released');
    const qty = personalized ? Number(job.total_units) : allocations.reduce((n,a) => n+Math.max(0,Number(a.required_qty)-Number(a.reserved_qty)),0);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const supplier = artConfig.supplier_id || store.all_school_settings && store.all_school_settings.dtf && store.all_school_settings.dtf.supplier_id || null;
    const manifest = {
      so_id:soId,job_id:job.id,order_id:order.id,ship_target_at:order.ship_target_at,qty,supplier_id:supplier,art_name:transfer && transfer.label || job.art_name,
      transfer_code:personalized ? null:code,personalized,
      allocation_shortfalls:allocations.map(a => ({id:a.id,qty:Math.max(0,Number(a.required_qty)-Number(a.reserved_qty))})).filter(a => a.qty>0),
      source_items:(sourceRes.data || []).filter(s => sourceIds.has(s.id)).map(s => ({id:s.id,fingerprint:sourceFingerprint(s)})),
      artwork_version:artConfig.artwork_version || null,artwork:artConfig.production_file || {},
      width_in:artConfig.width_in,height_in:artConfig.height_in,
      placement:artConfig.placement || job.positions || '',instructions:artConfig.application_instructions || '',
      font:template && template.font || '',print_color:template && template.print_color || '',
      logo_url:artConfig.production_file?.at_once_variant?.web_logo_url || artConfig.image_url || null,
      artwork_role:personalized ? 'Base .ai template: supplier must render the exact personalized text in the manifest':'production artwork',
      garments:allocations.filter(a => Number(a.required_qty)>Number(a.reserved_qty)).map(a => {
        const source=(sourceRes.data || []).find(s => s.id===a.order_item_id) || {};
        const item=jobItems.find(i => (i.source_webstore_item_ids || []).includes(a.order_item_id)) || {};
        return {sku:source.sku || item.sku,color:source.color || item.color,size:source.size,qty:Number(a.required_qty)-Number(a.reserved_qty),names:[],numbers:[],image_url:source.image_url || item.recipe_snapshot?.image_url || null};
      }),
    };
    let artError = null;
    if (job.art_status !== 'art_complete') artError = 'Production artwork/setup is awaiting approval; approve this job before ordering DTF prints';
    if ((sourceRes.data || []).some(s => sourceIds.has(s.id) && ['cancelled','canceled','refunded'].includes(s.line_status))) artError = 'A source garment line was cancelled or refunded; review job quantities';
    if (personalized) {
      manifest.art_name = job.art_name;
      manifest.garments = (sourceRes.data || []).filter(s => sourceIds.has(s.id)).map(s => ({sku:s.sku,color:s.color,size:s.size,qty:s.qty,image_url:s.image_url || null,
        names:logoRef.startsWith('name:') ? Array.from({length:s.qty},() => template && template.uppercase ? String(s.player_name || '').toUpperCase() : s.player_name || ''):[],
        numbers:logoRef.startsWith('numbers:') ? Array.from({length:s.qty},() => s.player_number || ''):[]}));
      if (!template || !template.font || !template.print_color) artError = 'Enter personalization font, print color, dimensions and base .ai template';
      const values = manifest.garments.flatMap(g => logoRef.startsWith('name:') ? g.names:g.numbers);
      if (values.some(v => !String(v).trim() || (template?.max_length && String(v).length > Number(template.max_length)))) artError = 'Personalized text is missing or exceeds the template limit';
    }
    if (manifest.artwork.bucket && manifest.artwork.path && /\.ai$/i.test(manifest.artwork.name || manifest.artwork.path)) {
      try {
        const file = await downloadProductionArt(admin,manifest.artwork);
        if (manifest.artwork.sha256 && manifest.artwork.sha256 !== file.sha256) artError = 'Artwork changed since its saved version; review the production file';
        else manifest.artwork = {...manifest.artwork,sha256:file.sha256};
      } catch (e) { artError = e.message; }
    }
    const variant = manifest.artwork.at_once_variant;
    if (!personalized && !artError && variant && variant.art_id && variant.id) {
      try { manifest.art_code = await assignArtCode(admin,store,variant,owners); }
      catch (e) { artError = 'Could not assign the permanent Art ID ('+e.message+'); the supplier email needs it to match files'; }
    }
    const errors = [...validateManifest(manifest),...(artError ? [artError] : [])];
    const row = {store_id:store.id,so_id:soId,job_id:job.id,supplier_id:supplier,qty,manifest,status:errors.length ? 'blocked':'queued',error:errors.join('; ') || null};
    const write = existing ? await admin.from(REQUESTS).update(row).eq('so_id',soId).eq('job_id',job.id).eq('status','blocked') : await admin.from(REQUESTS).upsert(row,{onConflict:'so_id,job_id',ignoreDuplicates:true});
    if (write.error) throw new Error(write.error.message);
    recorded++;
  }
  return {recorded};
}

async function prepareStoreBatches(admin, storeId) {
  const pending = await admin.from(REQUESTS).select('supplier_id').eq('store_id',storeId).eq('status','queued').limit(1000);
  if (pending.error) throw new Error(pending.error.message);
  const batches = [];
  const issues = [];
  for (const supplier of [...new Set((pending.data || []).map(r => r.supplier_id).filter(Boolean))]) {
    const settingRes = await admin.from('teamshop_auto_po_settings').select('*').eq('vendor',supplier).eq('deco_type','dtf').maybeSingle();
    if (settingRes.error) throw new Error(settingRes.error.message);
    const setting = settingRes.data;
    if (!setting || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(setting.contact_email || '').trim())) {
      issues.push('Configure an existing DTF supplier and contact email for '+supplier);continue;
    }
    const claimed = await admin.rpc('claim_all_school_dtf_batch',{p_store_id:storeId,p_supplier_id:supplier,p_supplier_snapshot:{vendor:supplier,email:String(setting.contact_email).trim(),supplier_account:setting.supplier_account || null}});
    if (claimed.error) throw new Error(claimed.error.message);
    if (claimed.data && claimed.data.id) batches.push(claimed.data);
  }
  return {batches,...(issues.length ? {reason:issues.join('; ')}:{})};
}

// Supplier email: one chart row per artwork + garment, laid out like the approved
// Astra sample (mockup, Art ID / file, garment, print color, size, sizes, qty).
function dtfEmailRows(manifests) {
  const rows = [];
  for (const m of manifests) {
    const groups = new Map();
    for (const g of m.garments || []) {
      const key = (g.sku || '')+'\0'+(g.color || '');
      const row = groups.get(key) || {sku:g.sku || '',color:g.color || '',image_url:'',sizes:new Map(),qty:0};
      row.image_url = row.image_url || httpsUrl(g.image_url);
      row.sizes.set(g.size || '',(row.sizes.get(g.size || '') || 0)+(Number(g.qty) || 0));
      row.qty += Number(g.qty) || 0;
      groups.set(key,row);
    }
    for (const row of groups.values()) rows.push({...row,manifest:m});
  }
  return rows;
}

function dtfEmailHtml(batch, links = []) {
  const manifests = batch.manifest || [];
  const cell = 'padding:10px;border:1px solid #ddd;vertical-align:top';
  const head = 'padding:10px;background:#eee;text-align:left';
  const variantOf = m => (m.artwork && m.artwork.at_once_variant) || {};
  const rows = dtfEmailRows(manifests).map(r => {
    const m = r.manifest, v = variantOf(m);
    const logo = httpsUrl(m.logo_url);
    const mock = (r.image_url ? '<img src="'+escapeHtml(r.image_url)+'" width="110" alt="'+escapeHtml((r.color+' '+r.sku).trim())+' garment"><br>' : '')
      + (logo ? '<img src="'+escapeHtml(logo)+'" width="60" alt="Logo artwork" style="background:#f4f4f4">' : '')
      || 'No image saved';
    const sizes = [...r.sizes.entries()].sort((a,b) => sizeRank(a[0])-sizeRank(b[0]) || String(a[0]).localeCompare(String(b[0])))
      .map(([size,qty]) => escapeHtml(size || 'One size')+': '+qty).join('; ');
    const printColor = m.print_color ? escapeHtml(m.print_color) : v.knockout_color ? 'Knockout: '+escapeHtml(v.knockout_color) : 'As artwork';
    const personalization = m.personalized ? '<br><em>Names/numbers per garment are in the CSV</em>' : '';
    return '<tr><td style="'+cell+'">'+mock+'</td>'
      +'<td style="'+cell+'"><strong>'+escapeHtml(m.art_code || m.art_name || 'Artwork')+'</strong><br>'+escapeHtml(artworkFileName(m))+'</td>'
      +'<td style="'+cell+'">'+escapeHtml(r.color || v.garment_color || '')+'<br>'+escapeHtml(r.sku)+'</td>'
      +'<td style="'+cell+'">'+printColor+'<br>'+escapeHtml(m.placement)+'</td>'
      +'<td style="'+cell+'">'+escapeHtml(m.width_in)+' × '+escapeHtml(m.height_in)+' in</td>'
      +'<td style="'+cell+'">'+sizes+personalization+'</td>'
      +'<td style="'+cell+'">'+r.qty+'</td></tr>';
  }).join('');
  const perFile = new Map();
  for (const m of manifests) {
    const name = artworkFileName(m);
    const entry = perFile.get(name) || {qty:0,label:m.art_code || m.art_name || name,garment:variantOf(m).garment_color || ''};
    entry.qty += Number(m.qty) || 0;
    perFile.set(name,entry);
  }
  const total = [...perFile.values()].reduce((n,f) => n+f.qty,0);
  const totals = [...perFile.values()].map(f => escapeHtml(f.label)+' = '+f.qty+' print'+(f.qty === 1 ? '' : 's')+(f.garment ? ' for '+escapeHtml(f.garment)+' garments' : '')).join('; ');
  const orders = [...new Set(manifests.map(m => m.so_id))].map(escapeHtml).join(', ');
  const jobs = [...new Set(manifests.map(m => m.job_id))].map(escapeHtml).join(', ');
  return '<div style="font-family:Arial,sans-serif"><h2>DTF print order — artwork matching chart</h2>'
    +'<p>Batch '+escapeHtml(batch.id)+'<br>Order: '+orders+' | Job: '+jobs+'</p>'
    +'<p>Match the complete Art ID in each row to its attached file. The same Art ID can be reused on other orders; the SO number stays separate.</p>'
    +'<table style="border-collapse:collapse;font-size:13px"><tr><th style="'+head+'">Mockup</th><th style="'+head+'">Art ID / file</th><th style="'+head+'">Garment / SKU</th><th style="'+head+'">Print color / placement</th><th style="'+head+'">Print size W × H</th><th style="'+head+'">Garment sizes</th><th style="'+head+'">Quantity</th></tr>'+rows+'</table>'
    +'<p><strong>File totals:</strong> '+totals+'. Total = '+total+'. Each artwork file is attached once.</p>'
    +links.map(l => '<p><a href="'+escapeHtml(l.url)+'">Download '+escapeHtml(l.name)+'</a> (expires in 7 days; SHA256 '+escapeHtml(l.sha256)+')</p>').join('')
    +'<p>The attached CSV repeats every row with exact garment sizes, names/numbers and artwork checksums. Mockups are visual references, not dimensioned proofs; print to the size in the chart.</p></div>';
}

async function batchPayload(admin, batch) {
  const soIds = [...new Set(batch.manifest.map(m => m.so_id))];
  const orders = await admin.from('webstore_orders').select('so_id,status').eq('store_id',batch.store_id).in('so_id',soIds);
  if (orders.error || !Array.isArray(orders.data)) throw new Error('Could not verify paid orders; nothing was sent');
  if (soIds.some(id => !(orders.data || []).some(o => o.so_id === id && ['paid','batched'].includes(o.status)))) throw new Error('A source order is cancelled, refunded or no longer paid; review this batch before sending');
  const sources = batch.manifest.flatMap(m => m.source_items || []);
  if (!sources.length) throw new Error('Source garment references are missing; nothing was sent');
  const sourceRes = await admin.from('webstore_order_items').select('*').in('id',[...new Set(sources.map(s => s.id))]);
  if (sourceRes.error || !Array.isArray(sourceRes.data)) throw new Error('Could not verify source garment lines; nothing was sent');
  if (sources.some(s => !(sourceRes.data || []).some(i => i.id === s.id && !['cancelled','canceled','refunded'].includes(i.line_status) && sourceFingerprint(i) === s.fingerprint))) throw new Error('Source quantities, personalization or artwork changed after preparation; review the batch before sending');
  const jobs = await admin.from('so_jobs').select('so_id,id,art_status,dtf_prints_status').in('so_id',soIds);
  if (jobs.error || !Array.isArray(jobs.data)) throw new Error('Could not verify production print status; nothing was sent');
  if (batch.manifest.some(m => !jobs.data.some(j => j.so_id === m.so_id && j.id === m.job_id && j.art_status === 'art_complete' && !['ordered','received'].includes(j.dtf_prints_status)))) throw new Error('A production job is unapproved, already ordered/received or is missing; review the batch before sending');
  const allocations = batch.manifest.flatMap(m => m.allocation_shortfalls || []);
  if (allocations.length) {
    const current = await admin.from('all_school_decoration_allocations').select('id,required_qty,reserved_qty,status').eq('store_id',batch.store_id).in('id',allocations.map(a => a.id));
    if (current.error || !Array.isArray(current.data)) throw new Error('Could not verify decoration shortages; nothing was sent');
    if (allocations.some(a => !current.data.some(c => String(c.id) === String(a.id) && c.status === 'reserved' && Math.max(0,Number(c.required_qty)-Number(c.reserved_qty)) === a.qty))) throw new Error('Decoration stock allocations changed after preparation; refresh reservations and review the batch before sending');
  }
  const attachments = [{name:'DTF-'+batch.id+'.csv',content:Buffer.from(manifestCsv(batch.manifest)).toString('base64')}];
  const files = new Map();
  for (const m of batch.manifest) {
    const errors = validateManifest(m);
    if (errors.length) throw new Error(errors.join('; '));
    const key = m.artwork.bucket+'\0'+m.artwork.path+'\0'+m.artwork.sha256;
    if (!files.has(key)) files.set(key,{...m.artwork,fileName:artworkFileName(m)});
  }
  let bytesAttached = 0;
  const links = [];
  for (const art of files.values()) {
    const file = await downloadProductionArt(admin,art);
    if (file.sha256 !== art.sha256) throw new Error('Production artwork changed after the batch was prepared; nothing was sent');
    // Oversized art gets an immutable, content-addressed copy. Linking the
    // original mutable object would violate the exact-version guarantee.
    if (bytesAttached+file.bytes.length > MAX_ATTACHMENT_BYTES) {
      const path = 'all-school-dtf/'+batch.id+'/'+file.sha256+'.ai';
      const upload = await admin.storage.from(art.bucket).upload(path,file.bytes,{upsert:false,contentType:'application/postscript'});
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message || '')) throw new Error('Could not freeze oversized artwork');
      const signed = await admin.storage.from(art.bucket).createSignedUrl(path,7*86400);
      if (signed.error || !signed.data || !signed.data.signedUrl) throw new Error('Could not create artwork download link');
      links.push({name:art.fileName,url:signed.data.signedUrl,sha256:file.sha256});
    } else {
      bytesAttached+=file.bytes.length;
      attachments.push({name:art.fileName,content:file.bytes.toString('base64')});
    }
  }
  return {sender:{name:'National Sports Apparel',email:'noreply@nationalsportsapparel.com'},to:[{email:batch.supplier_snapshot.email}],subject:'DTF print order '+batch.id+' — National Sports Apparel',attachment:attachments,htmlContent:dtfEmailHtml(batch,links)};
}

async function sendBatch(admin, batch, { enabled = process.env.ALL_SCHOOL_DTF_SEND_ENABLED === 'true', send = sendPortalEmail } = {}) {
  if (!enabled) return {sent:false,reason:'Sending disabled until configured'};
  if (batch.status !== 'queued') return {sent:false,reason:'Batch has already been claimed; reconcile its receipt before retrying'};
  // Prepare all files + recipient routing before the durable send claim. Errors
  // here are safe to retry. After the claim, a crash is permanently review-only.
  let payload, registry;
  try { payload = await batchPayload(admin,batch); }
  catch (e) {
    // Review-only failures leave the automatic candidate set, so one obsolete
    // batch cannot repeatedly occupy the oldest slots and starve valid schools.
    const blocked = await admin.from(BATCHES).update({status:'blocked',error:e.message}).eq('id',batch.id).eq('status','queued');
    if (blocked.error) return {sent:false,error:e.message+'; could not save the review status'};
    return {sent:false,error:e.message};
  }
  try { registry = await loadEmailRegistry(admin); }
  catch (e) { return {sent:false,error:e.message}; }
  const claim = await admin.from(BATCHES).update({status:'sending',error:null}).eq('id',batch.id).eq('status','queued').select('id');
  if (claim.error) throw new Error(claim.error.message);
  if (!(claim.data || []).length) return {sent:false,reason:'Already claimed'};
  let receipt;
  try { receipt = await send(admin,payload,registry); }
  catch (e) { receipt = {uncertain:true,error:e.message}; }
  const sent = !!receipt.messageId && receipt.status >= 200 && receipt.status < 300;
  const status = sent ? 'sent' : receipt.uncertain || (receipt.status >= 200 && receipt.status < 300) ? 'unknown' : 'blocked';
  const update = await admin.from(BATCHES).update({status,message_id:receipt.messageId || null,provider:receipt.via || null,error:sent ? null : receipt.error || 'Provider did not confirm delivery',sent_at:sent ? new Date().toISOString():null}).eq('id',batch.id).eq('status','sending');
  if (update.error) return {sent:false,uncertain:true,error:'Email claim retained; receipt could not be saved. Review before retrying.'};
  if (sent) for (const m of batch.manifest) {
    const stamp = await admin.from('so_jobs').update({dtf_prints_status:'ordered'}).eq('so_id',m.so_id).eq('id',m.job_id);
    if (stamp.error) return {sent:true,message_id:receipt.messageId,warning:'Email sent; job status requires repair'};
  }
  return {sent,status,message_id:receipt.messageId || null,error:sent ? null : receipt.error};
}

module.exports = {REQUESTS,BATCHES,validateManifest,manifestCsv,dtfEmailHtml,artworkFileName,garmentRows,sourceFingerprint,recordAllSchoolDtfForSo,prepareStoreBatches,batchPayload,sendBatch};
