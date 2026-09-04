// Synchronous, render-independent guards for OMG port/invoice actions. React state
// updates are deferred, so checking the current arrays alone leaves a window where
// a second click can start the same write before the first render lands.
export const acquireOmgCreationGuard=(active,key)=>{
  if(!active||!key||active.has(key))return false;
  active.add(key);
  return true;
};

export const omgInvoiceIdempotencyKey=so=>so?.omg_store_id?`omg:${so.omg_store_id}`:null;

export const webstoreInvoiceIdempotencyKey=so=>so?.id?`webstore:${so.id}`:null;

// OMG's row `paid` value includes size upcharges (for example 2XL). Using only
// section.base_price loses those dollars. A blended sell preserves the exact
// collected product revenue while keeping the SO's one-line-per-color shape.
export const omgCollectedUnitPrice=(paid,qty,basePrice)=>{
  const n=Number(qty)||0,p=Number(paid)||0,b=Number(basePrice)||0;
  return n>0&&p>0?p/n:b;
};
