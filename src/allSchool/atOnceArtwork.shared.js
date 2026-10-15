// Used only for native Club / All School offerings. Art folders elsewhere stay optional.
const colorKey = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isAtOnceStore = store => ['club', 'all_school'].includes(store?.org_type) && store?.source !== 'omg';
const variantCode = (artId, variant) => `dtf-${encodeURIComponent(String(artId))}-${variant.id}`;
const validProductionFile = file => !!(file?.bucket === 'all-school-art' && file?.path && /\.ai$/i.test(file.name || file.path) && /^[a-f0-9]{64}$/i.test(file.sha256 || ''));
const sameFile = (a,b) => !!(a && b && a.bucket === b.bucket && a.path === b.path && a.sha256 === b.sha256);
const webLogos = art => [...(art?.web_logos || []).filter(w => w?.url), ...(art?.web_logo_url ? [{url:art.web_logo_url}] : [])];
function artworkSetup(item, transfers = [], arts = []) {
  const codes = new Set([...(item.transfer_codes || []), item.transfer_code].filter(Boolean));
  const folders = new Map(arts.filter(Boolean).map(a => [a.id,a]));
  let error = '';
  const fail = message => { if (!error) error = message; };
  const color = colorKey(item.color);
  const decorations = (item.decorations || []).map(d => {
    if (!d || ['perso_name','perso_number'].includes(d.kind)) return d;
    const id = d.art_id || d.art_file_id;
    const art = folders.get(id);
    if (!art) { fail('Link every logo to its art folder.'); return d; }
    const logos = webLogos(art);
    if (!logos.length) fail(`Create a Weblogo in the art folder for ${art.name || id}.`);
    const stock = transfers.find(t => t.code === d.transfer_code) || transfers.find(t => t.code === `store-art-${encodeURIComponent(String(id))}`);
    const method = stock?.decoration_type || d.deco_type || d.type || art.deco_type || art.decoration_type;
    if (method !== 'dtf') return d;
    if (!color) { fail(`Choose the exact garment color for ${art.name || id}.`); return d; }
    const variants = (art.dtf_variants || []).filter(v => colorKey(v.garment_color) === color);
    if (variants.length !== 1) { fail(`Save one DTF production variant for ${art.name || id} on ${item.color} in its art folder.`); return d; }
    const v = variants[0];
    if (!v.id || v.reviewed !== true || !String(v.knockout_color || '').trim() || !validProductionFile(v.production_file) || !(Number(v.width_in)>0) || !(Number(v.height_in)>0)) fail(`Complete the reviewed DTF knockout file and dimensions for ${art.name || id} on ${item.color}.`);
    if (!v.web_logo_url || !logos.some(w => w.url === v.web_logo_url)) fail(`Choose the matching Weblogo from the art folder for ${art.name || id} on ${item.color}.`);
    const code = variantCode(id,v);
    const matches = transfers.filter(t => t.code === code);
    const exact = matches[0];
    if (matches.length !== 1 || exact.decoration_type !== 'dtf' || !sameFile(exact.production_file,v.production_file) || Number(exact.width_in)!==Number(v.width_in) || Number(exact.height_in)!==Number(v.height_in)) fail(`Add the exact DTF variant inventory for ${art.name || id} on ${item.color}.`);
    if (d.transfer_code) codes.delete(d.transfer_code);
    codes.delete(`store-art-${encodeURIComponent(String(id))}`);
    codes.add(code);
    return {...d,type:'dtf',deco_type:'dtf',transfer_code:code,art_url:v.web_logo_url,web_url:v.web_logo_url,cw_pick:true,cw_by_color:{},baked:false,color_way_id:v.color_way_id || null,dtf_variant_id:v.id,garment_color:item.color,knockout_color:v.knockout_color};
  });
  // A loose design stock code cannot bypass the mandatory art-folder mapping.
  for (const code of codes) {
    const stock = transfers.find(t => t.code === code);
    if (stock?.kind === 'design' && !decorations.some(d => d?.transfer_code === code || `store-art-${encodeURIComponent(String(d?.art_id || d?.art_file_id))}` === code)) fail('Link decoration inventory to its logo in the art folder.');
  }
  return {item:{...item,decorations,transfer_code:null,transfer_codes:[...codes]},error};
}
module.exports = {colorKey,isAtOnceStore,variantCode,validProductionFile,sameFile,webLogos,artworkSetup};
