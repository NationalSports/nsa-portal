import {useMemo} from 'react';

// A4 rows crowd out everything else on keyword searches ("quarter zip", "polo"), so they
// only show when the rep is typing an A4 SKU: some search word has a digit and appears in
// the product's SKU (e.g. "n4014", "nb61"). Words like "a4" alone don't match A4 SKUs.
export function a4Visible(p,tokens){
  if((p.brand||'').trim().toLowerCase()!=='a4')return true;
  const sku=(p.sku||'').toLowerCase();
  return tokens.some(t=>/\d/.test(t)&&sku.includes(t));
}

// Search only when the catalog or query changes, not when another order control
// renders. Keep original catalog ordering and the live Momentec exclusion.
export function filterOrderCatalog(products,query){
  if(!query||query.length<2)return [];
  const tokens=query.toLowerCase().split(/\s+/).filter(Boolean);
  if(!tokens.length)return [];
  return products.filter(p=>{
    if(p.is_archived||(p.brand||'').toLowerCase()==='momentec')return false;
    const fields=[p.sku||'',p.name||'',p.brand||'',p.color||''].map(s=>s.toLowerCase());
    return tokens.every(token=>fields.some(field=>field.includes(token)))&&a4Visible(p,tokens);
  });
}

export function useOrderCatalogResults(products,query){
  return useMemo(()=>filterOrderCatalog(products,query),[products,query]);
}
