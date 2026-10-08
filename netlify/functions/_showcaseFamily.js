const crypto = require('crypto');
const { FAMILY_VERSION, groupShowcaseItems, needsFamilyGeneration } = require('../../src/lib/showcaseFamilies');
const { normalizeShowcaseSettings, showcaseSettingsChanged } = require('../../src/lib/showcaseSettings');
const { fetchRemoteImage, generateWithOpenAI, analyzeWithKimi, cleanDecorations, heroDirection, inferAthleticFormProfile } = require('./_showcase');
const { dispatchShowcaseJob } = require('./_showcaseJobs');
const { markShowcaseBatchPending, notifyShowcaseReady } = require('./_showcaseEmail');
const MASTER_POSE_VERSION = 'athletic-hood-down-v2';
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function transition(admin, store, key, request, action, payload = {}) {
  const result = await admin.rpc('transition_showcase_family', { p_store: store, p_key: key, p_request: request, p_action: action, p_payload: payload });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function catalogSignature(members) {
  return hash([...members].sort((a,b)=>a.webstore_product_id.localeCompare(b.webstore_product_id)).map((m)=>[m.webstore_product_id,m.product_id,m.supplier_image_url,m.color,m.decorations]));
}
function familyInputs(group, assets, settings) {
  const members = group.items.map((item) => ({ ...item, settings: normalizeShowcaseSettings(settings || assets.find((a) => a.webstore_product_id === item.webstore_product_id)?.analysis?.showcase_settings) }));
  // Stable selection across catalog reorder; logos never become master inputs.
  const source = [...members].sort((a,b) => a.product_id.localeCompare(b.product_id))[0];
  return { version: FAMILY_VERSION, members, source, catalog_signature:catalogSignature(members),
    master_signature: hash([FAMILY_VERSION, MASTER_POSE_VERSION, source.product_id, source.supplier_image_url]) };
}
async function queueFamilies({ admin, store, catalog, assets, key, all, settings, newMaster, baseUrl }) {
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
    if (!group.eligible) throw new Error('Each color needs an original supplier photo before shared-base generation');
    const inputs = familyInputs(group, assets, settings);
    inputs.store_art = store.store_art || [];
    for (const member of inputs.members) delete member.asset;
    delete inputs.source.asset;
    const result = await admin.rpc('queue_showcase_family', { p_store: store.id, p_key: group.key,
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
const MASTER_PROMPT = `Create one premium product-only ecommerce master from the supplied BLANK supplier garment. Preserve the exact cut, seams, pockets, cuffs, closures, material and manufacturer marks. Sculpt it with realistic invisible athletic support and natural folds: a confident premium hero, approximately 10–12 degrees around the vertical axis with the decorated front dominant, level camera at chest height, no looking down into the neckline. For hoodies the hood MUST be DOWN, resting naturally behind the neck and across the upper back, never raised or filled as if around an invisible head. Preserve the hood construction while changing its pose. Use dimensional shoulders and chest, separated relaxed sleeves and a natural substantial drape; controlled directional key light and soft fill, never exaggerated muscles, narrow sloping shoulders or a limp catalog cutout. No person, mannequin or hanger. Whole garment in frame with 6% margin, pure white background and restrained neutral grounding shadow. No customer/team logos or lettering. For subsequent deterministic recoloring, render ALL recolorable main fabric (including its cuffs, hood and matching drawstrings) in saturated chroma green, RGB approximately 30,180,55. Retain realistic luminance shading and fine fabric texture. Do NOT turn manufacturer marks, labels, zippers, hardware, contrasting trim, or the background green. Never add manufacturer marks that are absent in the reference. The main fabric color is deliberately changed; all construction details are locked.`;
function masterPrompt(product) {
  const fit = inferAthleticFormProfile(product);
  const form = fit === 'youth' ? 'Child proportions, narrower shoulders and shorter torso; no adult muscular form.'
    : fit === 'women' ? 'Natural athletic women’s proportions appropriate to the actual cut, never exaggerated.'
    : 'Naturally strong adult male athletic proportions: moderately broad shoulders and chest, trim waist, substantial but not bulky. Preserve the actual fit; no bodybuilder shape.';
  return `${MASTER_PROMPT} FIT: ${form} ITEM DIRECTION: ${heroDirection(product)}`;
}
async function validatedMapping(analyze, request, placements, current) {
  const render = require('./_showcaseFamilyRender');
  let reason = '';
  for (let attempt=0; attempt<2; attempt++) {
    await current();
    const result = await analyze({ ...request, analysisPrompt: request.analysisPrompt + (attempt ? ` CORRECTION REQUIRED: ${reason}. Reinspect the images and return a complete corrected mapping. Do not reuse invalid regions.` : '') });
    if (result.analysis?.supported !== true) throw new Error(`Master needs review: ${result.analysis?.reason || 'unreliable logo placement'}`);
    try {
      const a = result.analysis;
      a.protected_regions = render.normalizeRegions(a.protected_regions);
      if (!Array.isArray(a.logo_strands) || (a.logo_occluders || []).length) throw new Error('Return logo_strands paths and an empty logo_occluders array');
      render.validateStrands(a.logo_strands);
      for (const id of Object.keys(placements)) render.validateQuad(a.placements?.[id]);
      return result;
    } catch (error) { reason = error.message; }
  }
  throw new Error(`Unable to map garment details after two attempts. The saved base is retained; retry generation. ${reason}`);
}

async function runFamilyJob(admin, asset, siteUrl, deps = {}) {
  const key = asset.analysis.family.key, request = asset.generation_request_id, store = asset.store_id;
  const move = (action,payload) => transition(admin,store,key,request,action,payload);
  const job = await move('claim');
  if (!job) return { skipped: true };
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
      const group = groupShowcaseItems(catalog).find((g)=>g.key===key);
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
    for (const m of members) for (const d of (m.decorations || []).filter((d)=>d.side!=='back' && d.placement!=='full_back')) {
      if (!d.art_url) throw new Error('A linked logo is missing its artwork file');
      if (![d.x,d.y,d.w].every(Number.isFinite)) throw new Error('Save the logo placement in Art Studio before generating this item');
      const id = hash([d.x,d.y,d.w,d.placement]);
      placements[id] ||= { x:d.x,y:d.y,w:d.w,placement:d.placement,supplier_index:urls.indexOf(m.supplier_image_url)+1 };
    }
    await checkCatalog();
    const refs = await Promise.all(urls.map(fetchImage));
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
    let master = job.master;
    let masterImage;
    const upload = async (bytes, path) => {
      const bucket = admin.storage.from('showcase-images');
      const result = await bucket.upload(`${store}/families/${request}/${path}.png`,bytes,{contentType:'image/png',cacheControl:'31536000',upsert:false});
      if (result.error) throw new Error(result.error.message);
      const url = bucket.getPublicUrl(`${store}/families/${request}/${path}.png`).data?.publicUrl;
      if (!url) throw new Error('Permanent image URL unavailable');
      return url;
    };
    if (master?.url && master.signature===job.inputs.master_signature) masterImage = await fetchImage(master.url);
    else {
      const generated = await generate({ product:job.inputs.source,decorations:[],images:[refs[urls.indexOf(job.inputs.source.supplier_image_url)]],editPrompt:masterPrompt(job.inputs.source) });
      await current();
      masterImage = generated;
      master = { url:await upload(generated.bytes,'master'), model:generated.model, signature:job.inputs.master_signature };
      if (!await move('cache',master)) throw new Error('Family was canceled');
    }
    await current();
    const mappingRequest = { product:job.inputs.source,decorations:[],images:[masterImage,...refs],
      analysisPrompt:`Map saved logo placements from supplier photos onto the FIRST image, a green garment master. Other images are supplier photos. Return JSON {supported:boolean,reason:string,protected_regions:[[[0.1,0.2],[0.12,0.2],[0.12,0.23]]],logo_occluders:[],logo_strands:[{points:[[x,y,width],...]}],placements:{id:[[x,y],[x,y],[x,y],[x,y]]}}. The protected_regions example is SHAPE ONLY, not coordinates to copy. Every polygon vertex must have exactly two finite numeric values [x,y], at least 3 vertices and no more than 80. All output coordinates are normalized 0..1 to the FIRST image, never pixels or percentages. Use [] for absent regions. Protected regions tightly enclose manufacturer marks, labels, hardware and contrasting trim that must never change color. Keep logo_occluders empty. For each actual drawstring or narrow zipper lying in front of the logo, trace a separate logo_strands centerline with at least 8 points from top to tip, following every bend. Each point is [x,y,full_width]; width is the actual visible strand width as a fraction of image WIDTH, excludes shadows and surrounding fabric, and must not exceed 0.025. Do not mask ordinary fabric folds: the logo continues over them. If no strands overlap artwork return an empty list. Return supported:false if accurate narrow traces cannot be identified. Never substitute bounding rectangles for paths. Each placement quad is top-left,top-right,bottom-right,bottom-left, describing a SQUARE fabric-plane region at the saved width and center relative to the physical garment. The renderer fits exact artwork aspect ratios within this plane. x/y/w in input are percentages of the corresponding original supplier photo; map them to the same physical location on the master. Keep sleeve placements on that sleeve. Never enlarge beyond production bounds. Return supported:false if reliable alignment is impossible or master construction is inaccurate. PLACEMENTS=${JSON.stringify(placements)}` };
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
        const id = hash([d.x,d.y,d.w,d.placement]);
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
    await move('fail',{error:String(error.message || error).slice(0,1200)});
    await notifyShowcaseReady(admin,store,siteUrl).catch(()=>{});
    throw error;
  }
}
module.exports = { masterPrompt, MASTER_POSE_VERSION, validatedMapping, catalogSignature,familyInputs,queueFamilies,runFamilyJob,transition,MASTER_PROMPT };
