import {useMemo} from 'react';

// Search only when the catalog or query changes, not when another order control
// renders. Keep original catalog ordering and the live Momentec exclusion.
export function filterOrderCatalog(products,query){
  if(!query||query.length<2)return [];
  const tokens=query.toLowerCase().split(/\s+/).filter(Boolean);
  if(!tokens.length)return [];
  return products.filter(p=>{
    if(p.is_archived||(p.brand||'').toLowerCase()==='momentec')return false;
    const fields=[p.sku||'',p.name||'',p.brand||'',p.color||''].map(s=>s.toLowerCase());
    return tokens.every(token=>fields.some(field=>field.includes(token)));
  });
}

export function useOrderCatalogResults(products,query){
  return useMemo(()=>filterOrderCatalog(products,query),[products,query]);
}
