const crypto = require('crypto');
const sharp = require('sharp');
const { inferAthleticFormProfile, cleanDecorations } = require('./_showcase');
const VERSION = 'color-design-v1';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const front = member => (member.decorations || []).filter(d=>d.side !== 'back' && d.placement !== 'full_back');
const colorKey = member => hash([member.product_id, member.color]);
const colorSignature = member => hash([VERSION,member.product_id,member.color,member.supplier_image_url,member.name,member.settings?.revision_notes || '']);
const designSignature = member => hash([front(member), member.settings?.decoration_type || 'auto']);

// Match the existing editor's contain-fitted 4:5 frame. There is no transfer
// to another pose here: this is the authoritative, already-placed reference.
async function decoratedReference(photo, member, art) {
  const base = await sharp(photo.bytes,{limitInputPixels:40000000}).rotate().resize(1000,1250,{fit:'contain',background:'#ffffff'}).png().toBuffer();
  const overlays = [];
  for (const d of front(member)) {
    if (![d.x,d.y,d.w].every(Number.isFinite) || d.w<=0 || d.w>100 || d.x<0 || d.x>100 || d.y<0 || d.y>100) throw new Error('Save a valid logo placement in Art Studio first');
    const image = art.get(d.art_url);
    if (!image) throw new Error('A linked logo is missing its artwork file');
    const {data,info} = await sharp(image.bytes,{limitInputPixels:40000000}).rotate().resize({width:Math.max(1,Math.round(d.w*10))}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const left = Math.round(d.x*10-info.width/2), top = Math.round(d.y*12.5-info.height/2);
    if (left<0 || top<0 || left+info.width>1000 || top+info.height>1250) throw new Error('Saved logo extends outside the supplier reference');
    overlays.push({input:data,raw:info,left,top});
  }
  return {bytes:await sharp(base).composite(overlays).png().toBuffer(),contentType:'image/png'};
}
function prompt(member, stage, storeArt) {
  const fit = inferAthleticFormProfile(member);
  const decorations = cleanDecorations(front(member),member.settings,storeArt,member.color);
  const common = `The actual product is ${JSON.stringify({name:member.name,color:member.color,fit})}. Preserve this exact colorway, fine heather yarn, contrasting panels, construction, proportions, seams, pockets, closures and all manufacturer marks. Customer artwork comes from the supplied exact artwork files and the decorated supplier reference: preserve spelling, shapes and colors, and its physical size and position relative to neckline, pocket, seams and garment center. Follow the reference's actual garment panel, not the image center. Drawstrings and zippers remain naturally in front of the decoration. Never erase broad strips of artwork beside them. Decoration finishes: ${JSON.stringify(decorations)}. Output one complete garment on pure white, with restrained grounding shadow, no person or mannequin. This is a preview requiring human review. Review instructions: ${JSON.stringify(member.settings?.revision_notes || '')}.`;
  return stage === 'color_base'
    ? `Image 1 is the actual blank supplier garment in the sold color. Image 2 shows the saved customer artwork placement on that same garment; remaining images are exact artwork. Create a finished premium product photo with that artwork, modest athletic invisible support appropriate to its fit and a slight 10–12 degree hero turn, level camera. For hoodies the hood rests DOWN behind the neck. Use soft diffuse matte lighting, natural fabric, no shine or overhead spotlight. Keep the full garment visible with breathing room. ${common}`
    : `Image 1 is the finished same-color photo to EDIT. Keep its garment pixels, pose, framing, silhouette, color, fabric texture, folds, lighting, shadows and manufacturer marks unchanged. Replace ONLY customer/team decoration with the design and saved placement shown on image 2, the decorated supplier reference; image 3 is the actual supplier color photo and remaining images are exact artwork. Remove previous customer artwork completely before applying this design once. Do not redraw the whole garment, change the pose or recolor it. ${common}`;
}

async function renderColorDesigns({members,fetched,art,cached,generate,fetchImage,upload,current,cache,storeArt}) {
  const bases = cached?.version === VERSION ? {...cached.color_bases} : {};
  const outputs = [];
  const failedColors = new Map();
  let model = null;
  for (const member of [...members].sort((a,b)=>a.webstore_product_id.localeCompare(b.webstore_product_id))) {
    await current();
    const key = colorKey(member), signature = colorSignature(member);
    try {
      if (failedColors.has(key)) throw new Error(failedColors.get(key));
      if (!front(member).length && member.standard_image_url && member.standard_image_url !== member.supplier_image_url)
        throw new Error('Link this design’s artwork before creating its image');
      const source = fetched.get(member.supplier_image_url);
      const reference = await decoratedReference(source,member,art);
      const logos = front(member).map(d=>art.get(d.art_url));
      let base = bases[key];
      if (base?.signature !== signature) base = null;
      let image, stage;
      if (!base) {
        stage = 'color_base';
        try {
          image = await generate({product:member,decorations:front(member),images:[source,reference,...logos],editPrompt:prompt(member,stage,storeArt),quality:'high'});
        } catch (error) { failedColors.set(key,`This color's initial image could not be created: ${error.message}`); throw error; }
        await current();
        const url = await upload(image.bytes,`${member.webstore_product_id}-color-base`);
        base = {signature,url,model:image.model,seed_design:designSignature(member),seed_product:member.webstore_product_id};
        bases[key] = base;
        await cache({version:VERSION,color_bases:bases});
      } else {
        stage = 'design_edit';
        const baseImage = await fetchImage(base.url);
        image = await generate({product:member,decorations:front(member),images:[baseImage,reference,source,...logos],editPrompt:prompt(member,stage,storeArt),quality:'medium'});
        await current();
      }
      model = image.model;
      const url = stage==='color_base' ? base.url : await upload(image.bytes,member.webstore_product_id);
      outputs.push({webstore_product_id:member.webstore_product_id,url,qa:{renderer_version:VERSION,generation_stage:stage,generation_quality:image.quality || (stage==='color_base'?'high':'medium'),generation_usage:image.usage || null,color_base_url:base.url,supplier_color:member.color,detail_images:[],review_mode:'full_image',human_review_required:true,exact_artwork_verified:false,protected_branding_verified:false,checklist:['Check exact artwork and placement against the standard image','Check fabric color, texture, pose and manufacturer marks','Check that design edits preserved the same-color garment']}});
    } catch (error) {
      // Check cancellation before recording an individual failure or paying for
      // another member. Missing photos/failed edits must not stop other colors.
      await current();
      outputs.push({webstore_product_id:member.webstore_product_id,error:`Image creation failed for ${member.color || 'this design'}: ${error.message}`});
    }
  }
  return {outputs,model};
}
module.exports = { VERSION,colorKey,colorSignature,designSignature,decoratedReference,prompt,renderColorDesigns };
