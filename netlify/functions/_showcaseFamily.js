const crypto = require('crypto');
const { FAMILY_VERSION, groupShowcaseItems, needsFamilyGeneration } = require('../../src/lib/showcaseFamilies');
const { normalizeShowcaseSettings, showcaseSettingsChanged } = require('../../src/lib/showcaseSettings');
const { fetchRemoteImage, generateWithOpenAI, analyzeWithKimi, cleanDecorations, heroDirection, inferAthleticFormProfile } = require('./_showcase');
const { dispatchShowcaseJob } = require('./_showcaseJobs');
const { markShowcaseBatchPending, notifyShowcaseReady } = require('./_showcaseEmail');
const MASTER_POSE_VERSION = 'athletic-matte-v3';
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function transition(admin, store, key, request, action, payload = {}) {
  const result = await admin.rpc('transition_showcase_family', { p_store: store, p_key: key, p_request: request, p_action: action, p_payload: payload });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function catalogSignature(members) {
  return hash([...members].sort((a,b)=>a.webstore_product_id.localeCompare(b.webstore_product_id)).map((m)=>[m.webstore_product_id,m.product_id,m.supplier_image_url,m.color,m.decorations]));
}
function familyInputs(group, assets, settings, targetId) {
  const members = group.items.map((item) => ({ ...item, settings: normalizeShowcaseSettings(settings || assets.find((a) => a.webstore_product_id === item.webstore_product_id)?.analysis?.showcase_settings) }));
  // Stable selection across catalog reorder; logos never become master inputs.
  const source = (targetId && members.find(m => m.webstore_product_id === targetId)) || [...members].sort((a,b) => a.product_id.localeCompare(b.product_id))[0];
  const selected = targetId ? members.filter(m => m.webstore_product_id === targetId) : members;
  if (!selected.length) throw new Error('Image combination not found in this item');
  return { version: FAMILY_VERSION, members: selected, source, catalog_family_key: group.key, catalog_signature:catalogSignature(members),
    master_signature: hash([FAMILY_VERSION, MASTER_POSE_VERSION, source.product_id, source.supplier_image_url, source.settings.revision_notes]) };
}
async function queueFamilies({ admin, store, catalog, assets, key, all, settings, newMaster, baseUrl, targetId }) {
  if (!baseUrl) throw new Error('Unable to start Showcase worker');
  const byId = new Map(assets.map((a) => [a.webstore_product_id, a]));
  const groups = groupShowcaseItems(catalog.map((item) => ({ ...item, asset: byId.get(item.webstore_product_id) && {
    ...byId.get(item.webstore_product_id), family_version: byId.get(item.webstore_product_id).analysis?.family?.version,
    needs_regeneration: showcaseSettingsChanged(byId.get(item.webstore_product_id).analysis),
  } })));
  const selected = all ? groups.filter(needsFamilyGeneration) : groups.filter((g) => g.key === key);
  if (!all && !selected.length) throw new Error('Base item not found. Refresh the page.');
  const queued = [];
  // Queue all groups before dispatching any, to preserve the batch email boundary.
  for (const group of selected) {
    if (targetId ? !group.items.some(m=>m.webstore_product_id===targetId && m.supplier_image_url && m.kind!=='bundle') : !group.eligible) throw new Error('The selected images need an original supplier photo before generation');
    const inputs = familyInputs(group, assets, settings, targetId);
    const jobKey = targetId ? `${group.key}:image:${targetId}` : group.key;
    if (targetId && !newMaster) {
      const shared = await admin.from('webstore_showcase_families').select('family_key,master').eq('store_id',store.id).in('family_key',[jobKey,group.key]);
      if (shared.error) throw new Error(shared.error.message);
      const canonical = familyInputs(group, assets, settings);
      const own = shared.data?.find(row=>row.family_key===jobKey)?.master;
      const family = shared.data?.find(row=>row.family_key===group.key)?.master;
      if (own?.signature !== inputs.master_signature && family?.signature === canonical.master_signature) {
        inputs.shared_master = family;
        inputs.source = canonical.source;
        inputs.master_signature = canonical.master_signature;
      }
    }
    inputs.store_art = store.store_art || [];
    for (const member of inputs.members) delete member.asset;
    delete inputs.source.asset;
    const result = await admin.rpc('queue_showcase_family', { p_store: store.id, p_key: jobKey,
      p_request: crypto.randomUUID(), p_inputs: inputs, p_new_master: !!newMaster });
    if (result.error) {
      // Earlier groups must not be left queued without dispatch if a later one conflicts.
      for (const q of queued) await transition(admin, store.id, q.family_key, q.generation_request_id, 'fail', { error: 'Batch interrupted while queueing. Retry this item.' });
      throw new Error(result.error.message);
    }
    queued.push(result.data);
  }
  if (queued.length) {
    try { await markShowcaseBatchPending(admin, store.id, crypto.randomUUID()); }
    catch (error) {
      for (const q of queued) await transition(admin,store.id,q.family_key,q.generation_request_id,'fail',{error:'Unable to start the review notification batch. Retry this item.'});
      throw error;
    }
  }
  let failed = 0;
  for (const q of queued) {
    try { await dispatchShowcaseJob(baseUrl, q); }
    catch (error) { failed++; await transition(admin,store.id,q.family_key,q.generation_request_id,'fail',{ error: `Unable to start background worker: ${error.message}` }); }
  }
  return { queued_count: queued.length - failed, failed_count: failed };
}
const MASTER_PROMPT = `Create one premium product-only ecommerce master from the supplied BLANK supplier garment. Preserve the exact cut, seams, pockets, cuffs, closures, material and manufacturer marks. Sculpt it with realistic invisible athletic support and natural folds: a confident premium hero, approximately 10–12 degrees around the vertical axis with the decorated front dominant, level camera at chest height, no looking down into the neckline. For hoodies the hood MUST be DOWN, resting naturally behind the neck and across the upper back, never raised or filled as if around an invisible head. Preserve the hood construction while changing its pose. Use dimensional shoulders and chest, separated relaxed sleeves and a natural substantial drape; large diffuse studio light and balanced soft fill, matte fabric with gentle tonal variation, no overhead spotlight, glossy shoulders, metallic sheen or dramatic highlights, never exaggerated muscles, narrow sloping shoulders or a limp catalog cutout. No person, mannequin or hanger. Whole garment in frame with 6% margin, pure white background and restrained neutral grounding shadow. No customer/team logos or lettering. For subsequent deterministic recoloring, render ALL recolorable main fabric (including its cuffs, hood and matching drawstrings) in saturated chroma green, RGB approximately 30,180,55. Retain realistic luminance shading and fine fabric texture. Do NOT turn manufacturer marks, labels, zippers, hardware, contrasting trim, or the background green. Never add manufacturer marks that are absent in the reference. The main fabric color is deliberately changed; all construction details are locked.`;
function masterPrompt(product) {
  const fit = inferAthleticFormProfile(product);
  const form = fit === 'youth' ? 'Child proportions, narrower shoulders and shorter torso; no adult muscular form.'
    : fit === 'women' ? 'Natural athletic women’s proportions appropriate to the actual cut, never exaggerated.'
    : 'Naturally strong adult male athletic proportions: moderately broad shoulders and chest, trim waist, substantial but not bulky. Preserve the actual fit; no bodybuilder shape.';
  return `${MASTER_PROMPT} FIT: ${form} ITEM DIRECTION (pose only; the diffuse matte lighting specified above overrides any lighting suggestion here): ${heroDirection(product)} REVIEWER REVISION REQUEST: ${JSON.stringify(normalizeShowcaseSettings(product.settings).revision_notes)}. Apply requested presentation changes while preserving garment identity and construction.`;
}
async function validatedMapping(analyze, request, placements, current) {
  const render = require('./_showcaseFamilyRender');
  let reason = '';
  let constructionRejected = false;
  const attempts = [];
  const product = request.product || {};
  const context = JSON.stringify({ name: product.name, sku: product.supplier_sku || product.sku, brand: product.brand, fit: inferAthleticFormProfile(product) });
  const instructions = ` PRODUCT_IDENTITY=${context}. Image 1 is the generated preview base; images 2 onward are supplier references of this same catalog style. The temporary green fabric is intentional and is not a sold color. A lowered hood, modest hero turn and invisible-support drape are intentional presentation changes, not by themselves construction differences. Verify actual seams, pocket shape, closures and manufacturer marks against the references. Inspect sleeve marks closely before claiming they are absent; a side view may reveal marks obscured in a front view. Use catalog fit metadata rather than guessing gender from flat-lay shape. Metadata does not excuse a genuine cut, pocket, seam or branding mismatch; if one is visible, reject it.`;
  for (let attempt=0; attempt<2; attempt++) {
    await current();
    const result = await analyze({ ...request, analysisPrompt: instructions + '\n' + request.analysisPrompt + (attempt ? ` CORRECTION REQUIRED: ${reason}. Reinspect the images and return a complete corrected mapping. Do not reuse invalid regions.` : '') });
    if (result.analysis?.supported !== true) {
      constructionRejected = true;
      attempts.push({ attempt: attempt+1, stage: 'comparison_or_mapping', reason: String(result.analysis?.reason || 'No reason supplied').slice(0,2000) });
      reason = String(result.analysis?.reason || 'The preview could not be reliably compared with the supplier references').slice(0,2000);
      console.warn('[showcase-mapping] comparison rejected', { attempt: attempt+1, sku: product.supplier_sku || product.sku, reason });
      continue;
    }
    constructionRejected = false;
    try {
      const a = result.analysis;
      a.protected_regions = render.normalizeRegions(a.protected_regions);
      if (!Array.isArray(a.logo_strands) || (a.logo_occluders || []).length) throw new Error('Return logo_strands paths and an empty logo_occluders array');
      render.validateStrands(a.logo_strands);
      for (const id of Object.keys(placements)) {
        if (!a.placements?.[id]) throw new Error(`Missing mapped artwork placement ${id}`);
        a.placements[id] = render.normalizeRegions([a.placements[id]])[0];
        render.validateQuad(a.placements[id]);
      }
      return result;
    } catch (error) { reason = error.message; attempts.push({ attempt: attempt+1, stage: 'coordinates', reason }); }
  }
  const reported = reason.replace(/\s+/g,' ').slice(0,600);
  const error = new Error(constructionRejected
    ? `Automatic image review stopped. The image was generated, but the checker reported: ${reported}. This is an automated assessment, not a confirmed garment defect. Use Create images or Refresh images to retry the saved image; changing pose is not required. Approved images are unchanged.`
    : `Artwork placement stopped: ${reported}. The saved base is retained; use Create images or Refresh images to retry placement without creating another pose. Approved images are unchanged.`);
  error.mappingDiagnostics = { attempts };
  throw error;
}

async function runFamilyJob(admin, asset, siteUrl, deps = {}) {
  const key = asset.analysis.family.key, request = asset.generation_request_id, store = asset.store_id;
  const move = (action,payload) => transition(admin,store,key,request,action,payload);
  const job = await move('claim');
  if (!job) return { skipped: true };
  let cachedMaster = job.master || job.inputs.shared_master;
  try {
    const render = deps.render || require('./_showcaseFamilyRender');
    const fetchImage = deps.fetchImage || fetchRemoteImage;
    const analyze = deps.analyze || analyzeWithKimi;
    const generate = deps.generate || generateWithOpenAI;
    const members = job.inputs.members;
    const urls = [...new Set(members.map((m) => m.supplier_image_url))];
    if (urls.length > 16) throw new Error('This item has too many color references for one batch (maximum 16)');
    const checkCatalog = async () => {
      let liveArt = job.inputs.store_art || [];
      if (!deps.getCatalog) {
        const result = await admin.from('webstores').select('store_art').eq('id',store).single();
        if (result.error) throw new Error(result.error.message);
        liveArt = result.data.store_art || [];
      }
      const catalog = await (deps.getCatalog || require('./_showcaseCatalog').getCatalog)(admin,store,liveArt);
      const group = groupShowcaseItems(catalog).find((g)=>g.key===(job.inputs.catalog_family_key || key));
      if (!group || catalogSignature(group.items)!==job.inputs.catalog_signature) throw new Error('The catalog or logo changed during generation. Generate the item again.');
    };
    const artUrls = [...new Set(members.flatMap((m) => (m.decorations || []).filter((d) => d.side !== 'back' && d.placement !== 'full_back').map((d) => d.art_url).filter(Boolean)))];
    if (artUrls.length > 24) throw new Error('This item has too many logo references for one batch (maximum 24)');
    const art = new Map();
    for (const url of artUrls) {
      const image = await fetchImage(url);
      await render.validateArtwork(image.bytes);
      art.set(url,image);
    }
    for (const member of members) {
      if (!(member.decorations || []).length && member.standard_image_url && member.standard_image_url !== member.supplier_image_url)
        throw new Error('Link the logo artwork for every decorated variant before generating this item');
    }
    const placements = {};
    const placementIds = new Map();
    for (const m of members) for (const d of (m.decorations || []).filter((d)=>d.side!=='back' && d.placement!=='full_back')) {
      if (!d.art_url) throw new Error('A linked logo is missing its artwork file');
      if (![d.x,d.y,d.w].every(Number.isFinite)) throw new Error('Save the logo placement in Art Studio before generating this item');
      const signature = hash([d.x,d.y,d.w,d.placement]);
      if (!placementIds.has(signature)) placementIds.set(signature, `p${placementIds.size+1}`);
      const id = placementIds.get(signature);
      placements[id] ||= { x:d.x,y:d.y,w:d.w,supplier_index:urls.indexOf(m.supplier_image_url)+1 };
    }
    await checkCatalog();
    const refs = await Promise.all(urls.map(async url => {
      try { return await fetchImage(url); }
      catch (error) { throw new Error(`Supplier photo for ${members.find(m=>m.supplier_image_url===url)?.color || 'this color'}: ${error.message}`); }
    }));
    const current = async () => { if (!await move('check')) throw new Error('Family was canceled or changed'); };
    await current();
    const preflight = await analyze({ product: job.inputs.source, decorations: [], images: refs,
      analysisPrompt: `Inspect these supplier garment photos as color references for one shared garment master. Return JSON {supported:boolean, reason:string, colors:[{index:number, patches:[[x,y,width,height]], texture:"solid"|"heather"}]}. Coordinates are normalized 0..1 in each original photo; index is zero based image order. For each image choose 3 small rectangles of clean evenly lit main fabric, excluding ALL background, manufacturer marks, labels, hardware, shadows and specular highlights. Do not estimate RGB; code will sample actual pixels. supported must be false if photos differ in garment construction, are not the same style, have a complex print/pattern, multiple contrasting fabric panels, green manufacturer marks that cannot be separated from the chroma-green master, differing manufacturer mark colors that would require a separate branding layer, or if suitable fabric patches cannot be identified. Solid and fine heather fabric are supported. IMAGE_COLORS=${JSON.stringify(urls.map((url) => members.find((m) => m.supplier_image_url===url).color))}` });
    if (preflight.analysis.supported !== true || !Array.isArray(preflight.analysis.colors) || preflight.analysis.colors.length !== urls.length) throw new Error(`Supplier references need review: ${preflight.analysis.reason || 'color sampling unavailable'}`);
    const colors = [];
    for (let i=0;i<urls.length;i++) {
      const color = preflight.analysis.colors.find((c) => c.index===i);
      if (!color || !['solid','heather'].includes(color.texture)) throw new Error('Supplier fabric type needs review');
      colors.push(await render.sampleFabric(refs[i].bytes,color.patches,color.texture));
    }
    await current();
    let master = job.master || job.inputs.shared_master;
    let masterImage;
    const upload = async (bytes, path) => {
      const bucket = admin.storage.from('showcase-images');
      const result = await bucket.upload(`${store}/families/${request}/${path}.png`,bytes,{contentType:'image/png',cacheControl:'31536000',upsert:false});
      if (result.error) throw new Error(result.error.message);
      const url = bucket.getPublicUrl(`${store}/families/${request}/${path}.png`).data?.publicUrl;
      if (!url) throw new Error('Permanent image URL unavailable');
      return url;
    };
    if (master?.url && master.signature===job.inputs.master_signature) {
      masterImage = await fetchImage(master.url);
      if (!await move('cache',master)) throw new Error('Family was canceled');
    }
    else {
      const sourceImage = refs[urls.indexOf(job.inputs.source.supplier_image_url)] || await fetchImage(job.inputs.source.supplier_image_url);
      const generated = await generate({ product:job.inputs.source,decorations:[],images:[sourceImage],editPrompt:masterPrompt(job.inputs.source) });
      await current();
      masterImage = generated;
      master = { url:await upload(generated.bytes,'master'), model:generated.model, signature:job.inputs.master_signature };
      if (!await move('cache',master)) throw new Error('Family was canceled');
    }
    await current();
    cachedMaster = master;
    const framedRefs = await Promise.all(refs.map(async (ref, index) => ({ ...ref, contentType: 'image/png', bytes: await render.placementReference(ref.bytes, Object.entries(placements).filter(([,p]) => p.supplier_index === index+1)) })));
    const mappingRequest = { product:job.inputs.source,decorations:[],images:[masterImage,...framedRefs],
      analysisPrompt:`Map saved logo placements from supplier photos onto the FIRST image, a green garment master. Saved x/y/w coordinates and magenta guides are authoritative. Placement-editor preset names such as left_chest are intentionally omitted: staff can move a preset onto a trouser leg, so infer the physical garment panel from the reference guide, never from a preset name. For bottoms preserve the viewer-left or viewer-right leg shown in the reference; relaxed flat legs becoming naturally separated in the hero is an intentional pose change, not itself a construction mismatch. Other images are supplier photos in the exact editor frame. Magenta outlined squares and center crosses are placement guides, NOT garment features: labels are the complete placement ids (p1, p2, etc.). Return those exact keys in placements. Transfer each outlined square onto the same fabric area of the master, keeping its physical size and center relative to neckline, torso sides and pocket. Never copy the guide marks into protected regions or treat them as garment construction. Return JSON {supported:boolean,reason:string,protected_regions:[[[0.1,0.2],[0.12,0.2],[0.12,0.23]]],logo_occluders:[],logo_strands:[{points:[[x,y,width],...]}],placements:{id:[[x,y],[x,y],[x,y],[x,y]]}}. The protected_regions example is SHAPE ONLY, not coordinates to copy. Every polygon vertex must have exactly two finite numeric values [x,y], at least 3 vertices and no more than 80. All output coordinates are normalized 0..1 to the FIRST image, never pixels or percentages. Use [] for absent regions. Protected regions tightly enclose manufacturer marks, labels, hardware and contrasting trim that must never change color. Keep logo_occluders empty. For each actual drawstring or narrow zipper lying in front of the logo, trace a separate logo_strands centerline with at least 8 points from top to tip, following every bend. Each point is [x,y,full_width]; width is the actual visible strand width as a fraction of image WIDTH, excludes shadows and surrounding fabric, and must not exceed 0.025. Do not mask ordinary fabric folds: the logo continues over them. If no strands overlap artwork return an empty list. Return supported:false if accurate narrow traces cannot be identified. Never substitute bounding rectangles for paths. Each placement quad is top-left,top-right,bottom-right,bottom-left, describing a SQUARE fabric-plane region at the saved width and center relative to the physical garment. The renderer fits exact artwork aspect ratios within this plane. x/y/w in input are percentages of the supplied 4:5 reference FRAME, including white padding, exactly as shown in the placement editor. Width is a percentage of frame WIDTH; y is a percentage of frame HEIGHT. The square therefore has normalized height w*0.8 in that reference. Preserve logo width relative to the torso and vertical distance from neckline and pocket; do not enlarge it to fill the chest or move it down toward the pocket. Map that same physical location and size onto the master. Keep sleeve placements on that sleeve. Never enlarge beyond production bounds. Return supported:false if reliable alignment is impossible or master construction is inaccurate. REVIEWER REVISION REQUEST=${JSON.stringify(job.inputs.source.settings?.revision_notes || "")}. Apply requested placement corrections without changing the original logo artwork. PLACEMENTS=${JSON.stringify(placements)}` };
    const mapping = await validatedMapping(analyze,mappingRequest,placements,current);
    const prepared = await render.prepareMaster(masterImage.bytes,mapping.analysis,2048);
    const outputs = [];
    for (const member of members) {
      await current();
      const sampled = colors[urls.indexOf(member.supplier_image_url)];
      const output = render.recolor(prepared,sampled.rgb,sampled.grain);
      const frontDecorations = (member.decorations || []).filter((d)=>d.side!=='back' && d.placement!=='full_back');
      const detailQuads = [];
      for (const d of frontDecorations) {
        const id = placementIds.get(hash([d.x,d.y,d.w,d.placement]));
        detailQuads.push(await render.applyArtwork(output,prepared,art.get(d.art_url).bytes,mapping.analysis.placements?.[id],cleanDecorations([d],member.settings,job.inputs.store_art,member.color)[0].decoration_type,{ fitSquare:true, finishRelief:true }));
      }
      const details = [];
      for (const [index,d] of frontDecorations.entries()) {
        await current();
        const bytes = await render.decorationDetail(output,prepared,detailQuads[index]);
        details.push({ id:`logo-${index+1}`, url:await upload(bytes,`${member.webstore_product_id}-detail-${index+1}`),
          label:`Decoration detail${frontDecorations.length > 1 ? ` ${index+1}` : ''}`, color:member.color,
          finish:cleanDecorations([d],member.settings,job.inputs.store_art,member.color)[0].decoration_type,
          rendered_preview:true });
      }
      const url = await upload(await render.encode(output,prepared),member.webstore_product_id);
      outputs.push({ webstore_product_id:member.webstore_product_id,url,qa:{ renderer_version:'strand-edges-v2', logo_strands:mapping.analysis.logo_strands, artwork_color_policy:'source-hue-relief-v2',detail_images:details,human_review_required:true,supplier_color_sample:{rgb:sampled.rgb,patches:sampled.patches,pixels:sampled.pixels},
        shared_master_url:master.url,exact_artwork_verified:false,protected_branding_verified:false,
        checklist:['Compare color and fabric texture with supplier photo','Check manufacturer marks across colors','Check logo size, texture and drawstring overlap'] } });
    }
    await checkCatalog();
    const saved = await move('finish',{outputs,model:master.model,analysis_model:mapping.model});
    if (!saved) throw new Error('Family was canceled or changed before completion');
    await notifyShowcaseReady(admin,store,siteUrl).catch((error)=>console.error('[showcase-family] email',error.message));
    return { status:'review' };
  } catch (error) {
    if (error.mappingDiagnostics && cachedMaster?.url) {
      await move('cache', { ...cachedMaster, mapping_diagnostics: error.mappingDiagnostics }).catch(e => console.warn('[showcase-mapping] diagnostic save failed', e.message));
    }
    await move('fail',{error:String(error.message || error).slice(0,1200)});
    await notifyShowcaseReady(admin,store,siteUrl).catch(()=>{});
    throw error;
  }
}
module.exports = { masterPrompt, MASTER_POSE_VERSION, validatedMapping, catalogSignature,familyInputs,queueFamilies,runFamilyJob,transition,MASTER_PROMPT };
