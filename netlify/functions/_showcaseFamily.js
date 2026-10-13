const crypto = require('crypto');
const { FAMILY_VERSION, groupShowcaseItems, needsFamilyGeneration } = require('../../src/lib/showcaseFamilies');
const { normalizeShowcaseSettings, showcaseSettingsChanged } = require('../../src/lib/showcaseSettings');
const { fetchRemoteImage, generateWithOpenAI } = require('./_showcase');
const { dispatchShowcaseJob } = require('./_showcaseJobs');
const { markShowcaseBatchPending, notifyShowcaseReady } = require('./_showcaseEmail');
const MASTER_POSE_VERSION = 'color-design-v1';
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
  const source = (targetId && members.find(m => m.webstore_product_id === targetId)) || [...members].filter(m=>m.supplier_image_url).sort((a,b) => a.product_id.localeCompare(b.product_id))[0] || members[0];
  const selected = targetId ? members.filter(m => m.webstore_product_id === targetId) : members;
  if (!selected.length) throw new Error('Image combination not found in this item');
  return { version: FAMILY_VERSION, members: selected, source, catalog_family_key: group.key, catalog_signature:catalogSignature(members),
    master_signature: hash([FAMILY_VERSION, MASTER_POSE_VERSION, group.key]) };
}
async function queueFamilies({ admin, store, catalog, assets, key, all, settings, newMaster, baseUrl, targetId, dispatch = dispatchShowcaseJob, markPending = markShowcaseBatchPending }) {
  if (!baseUrl) throw new Error('Unable to start Showcase worker');
  const byId = new Map(assets.map((a) => [a.webstore_product_id, a]));
  const groups = groupShowcaseItems(catalog.map((item) => ({ ...item, asset: byId.get(item.webstore_product_id) && {
    ...byId.get(item.webstore_product_id), family_version: byId.get(item.webstore_product_id).analysis?.family?.version,
    needs_regeneration: showcaseSettingsChanged(byId.get(item.webstore_product_id).analysis),
  } })));
  const selected = all ? groups.filter(needsFamilyGeneration) : groups.filter((g) => g.key === key);
  if (!all && !selected.length) throw new Error('Base item not found. Refresh the page.');
  const queued = [];
  const batchId = crypto.randomUUID();
  // A color job keeps a batch of expensive edits within the worker lifetime.
  // All jobs are queued before dispatch so completion email covers the batch.
  const { colorKey } = require('./_showcaseColorDesign');
  for (const group of selected) {
    if (group.working) throw new Error('Cancel the active item before starting another generation');
    const colors = new Map();
    for (const member of group.items) {
      if (targetId && member.webstore_product_id!==targetId) continue;
      const color = colorKey(member);
      if (!colors.has(color)) colors.set(color,[]);
      colors.get(color).push(member);
    }
    if (!colors.size) throw new Error('Image combination not found');
    for (const [color,colorMembers] of colors) {
      const inputs = familyInputs({...group,items:colorMembers}, assets, settings, targetId);
      inputs.catalog_signature = catalogSignature(group.items);
      inputs.catalog_family_key = group.key;
      const colorJobKey = `${group.key}:color:${color}`;
      const jobKey = targetId ? `${group.key}:image:${targetId}` : colorJobKey;
      if (targetId && !newMaster) {
        const shared = await admin.from('webstore_showcase_families').select('family_key,master').eq('store_id',store.id).in('family_key',[jobKey,colorJobKey,group.key]);
        if (shared.error) throw new Error(shared.error.message);
        const own = shared.data?.find(row=>row.family_key===jobKey)?.master;
        const family = shared.data?.find(row=>row.family_key===colorJobKey)?.master || shared.data?.find(row=>row.family_key===group.key)?.master;
        if (own?.signature !== inputs.master_signature && family?.signature === inputs.master_signature) inputs.shared_master = family;
      }
      inputs.notification_batch_id = batchId;
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
  }
  if (queued.length) {
    try { await markPending(admin, store.id, batchId); }
    catch (error) {
      for (const q of queued) await transition(admin,store.id,q.family_key,q.generation_request_id,'fail',{error:'Unable to start the review notification batch. Retry this item.'});
      throw error;
    }
  }
  let failed = 0;
  for (const q of queued) {
    try { await dispatch(baseUrl, q); }
    catch (error) { failed++; await transition(admin,store.id,q.family_key,q.generation_request_id,'fail',{ error: `Unable to start background worker: ${error.message}` }); }
  }
  return { queued_count: queued.length - failed, failed_count: failed };
}
async function runFamilyJob(admin, asset, siteUrl, deps = {}) {
  const key = asset.analysis.family.key, request = asset.generation_request_id, store = asset.store_id;
  const move = (action,payload) => transition(admin,store,key,request,action,payload);
  const job = await move('claim');
  if (!job) return { skipped:true };
  try {
    if (job.inputs.version !== FAMILY_VERSION) throw new Error('This generation was queued by an older version. Refresh Store Appearance and create the image again.');
    const fetchImage = deps.fetchImage || fetchRemoteImage;
    const generate = deps.generate || generateWithOpenAI;
    const current = async()=>{if (!await move('check')) throw new Error('Family was canceled or changed');};
    const recover = deps.recoverImage || require('./_sanmarImageRecovery').createSanMarImageRecovery(job.inputs.members,fetchImage);
    const loaded = await require('./_sanmarImageRecovery').loadSupplierImages(job.inputs.members,fetchImage,recover);
    const {members,fetched,skipped} = loaded;
    if (!members.length) throw new Error(skipped[0]?.error || 'No usable supplier photos');
    const checkCatalog = async()=>{
      let liveArt = job.inputs.store_art || [];
      if (!deps.getCatalog) {
        const result = await admin.from('webstores').select('store_art').eq('id',store).single();
        if (result.error) throw new Error(result.error.message);
        liveArt = result.data.store_art || [];
      }
      const catalog = await (deps.getCatalog || require('./_showcaseCatalog').getCatalog)(admin,store,liveArt);
      const group = groupShowcaseItems(catalog).find(g=>g.key===(job.inputs.catalog_family_key || key));
      if (!group || catalogSignature(group.items)!==job.inputs.catalog_signature) throw new Error('The catalog or logo changed during generation. Generate the item again.');
    };
    const upload = async(bytes,path)=>{
      await current();
      const bucket = admin.storage.from('showcase-images');
      const saved = await bucket.upload(`${store}/families/${request}/${path}.png`,bytes,{contentType:'image/png',cacheControl:'31536000',upsert:false});
      if (saved.error) throw new Error(saved.error.message);
      const url = bucket.getPublicUrl(`${store}/families/${request}/${path}.png`).data?.publicUrl;
      if (!url) throw new Error('Permanent image URL unavailable');
      return url;
    };
    const art = new Map();
    for (const member of members) for (const d of (member.decorations || []).filter(d=>d.side!=='back' && d.placement!=='full_back')) {
      if (!d.art_url) throw new Error('A linked logo is missing its artwork file');
      if (!art.has(d.art_url)) { await current(); art.set(d.art_url,await fetchImage(d.art_url)); }
    }
    await current();
    await checkCatalog();
    const result = await (deps.renderColorDesigns || require('./_showcaseColorDesign').renderColorDesigns)({
      members,fetched,art,cached:job.master || job.inputs.shared_master,generate,fetchImage,upload,current,storeArt:job.inputs.store_art || [],
      cache:async master=>{if (!await move('cache',{...master,signature:job.inputs.master_signature})) throw new Error('Family was canceled');}
    });
    await current();
    await checkCatalog();
    const outputs = [...skipped,...result.outputs];
    if (!await move('finish',{outputs,model:result.model,analysis_model:null})) throw new Error('Family was canceled or changed before completion');
    await notifyShowcaseReady(admin,store,siteUrl).catch(error=>console.error('[showcase-family] email',error.message));
    return {status:outputs.some(o=>o.url)?'review':'failed'};
  } catch (error) {
    await move('fail',{error:String(error.message || error).slice(0,1200)});
    await notifyShowcaseReady(admin,store,siteUrl).catch(()=>{});
    throw error;
  }
}
module.exports = { MASTER_POSE_VERSION,catalogSignature,familyInputs,queueFamilies,runFamilyJob,transition };
