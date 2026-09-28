const ORDER=['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','OS','OSFA'];
const canonical=s=>String(s).trim().toUpperCase().replace(/^XXL$/,'2XL').replace(/^XXXL$/,'3XL');
export function quantityEntries(sizes={}) {
 return Object.entries(sizes).filter(([,n])=>Number(n)>0).sort(([a],[b])=>{
  const ai=ORDER.indexOf(canonical(a)),bi=ORDER.indexOf(canonical(b));
  return ai>=0||bi>=0?(ai<0?999:ai)-(bi<0?999:bi):String(a).localeCompare(String(b),undefined,{numeric:true});
 });
}
