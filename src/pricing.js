/* eslint-disable */
import { EXTRA_SIZES, SZ_NORM, CATEGORIES } from './constants';
import { safeNum, safeJobs } from './safeHelpers';
// Outsourced gate — same switch Costs tab / syncJobs use. Keep cost walks from counting
// in-house decoCostAt on decorations already covered by a deco PO (SO-1397 double-count).
import { isDecoOutsourced, outsourcedDecoTypes } from './businessLogic';
// Default deco pricing tables + pure calculators live in src/lib/decoPricing.js (CJS,
// shared verbatim with netlify/functions/quickorder-quote.js — same dual-consumer
// pattern as src/lib/opsRecap.js). This file layers the localStorage nsa_settings
// overrides on top and re-exports the same public API it always had, so every
// importer (App.js, OrderEditor.js, ...) is unchanged.
import * as DECO from './lib/decoPricing';

// ── Utility helpers ──
export const rQ=DECO.rQ;
export const rT=DECO.rT;

// ── Adidas/UA/NB tier discount off retail ── (see decoPricing.js for schedules)
export const auTierDisc=DECO.auTierDisc;
// ── Brands that auto-calc cost off retail (MSRP) instead of cost×markup ──
export const isAdidasPriced=DECO.isAdidasPriced;
export const isAU=DECO.isAU;
export const auCostMult=DECO.auCostMult;
// Gender/audience qualifiers that OMG (and some vendors) prepend to a size
// label — e.g. "Mens S", "Women's Large", "Youth M". The size itself is the
// same garment size, so strip the qualifier and normalize the bare size.
// Adult/unisex labels collapse to the plain size (S/M/L…); youth-class labels
// map to the Y-prefixed size (S→YS, M→YM…) to match the catalog/vendor feeds.
// Without this, "Mens S" never matched a vendor's "S", so genuinely in-stock
// OMG items read as out of stock.
const _ADULT_QUAL=/^(?:MEN|MENS|MEN'S|WOMEN|WOMENS|WOMEN'S|LADIES|LADIES'|LADY|ADULT|UNISEX)\s+(.+)$/;
const _YOUTH_QUAL=/^(?:YOUTH|YTH|BOYS|BOY'S|GIRLS|GIRL'S|JUNIOR|JUNIORS|JR)\s+(.+)$/;
const _YOUTH_SZ={'XS':'YXS','S':'YS','SMALL':'YS','SM':'YS','M':'YM','MEDIUM':'YM','MD':'YM','L':'YL','LARGE':'YL','LG':'YL','XL':'YXL','XLARGE':'YXL','X-LARGE':'YXL'};
export const normSzName=s=>{if(!s)return s;const u=s.toUpperCase().trim();if(SZ_NORM[u])return SZ_NORM[u];let m=u.match(_ADULT_QUAL);if(m){const r=m[1].trim();return SZ_NORM[r]||r}m=u.match(_YOUTH_QUAL);if(m){const r=m[1].trim();return _YOUTH_SZ[r]||SZ_NORM[r]||r}return u};
export const showSz=(s,inv)=>{const c=['S','M','L','XL','2XL'];if(c.includes(s))return true;return!EXTRA_SIZES.includes(s)||(inv||0)>0};

// ── Deco vendor price lookup ──
export const _decoVendorPrice=(pricingList,vendorId,decoType,params={})=>{
  const p=pricingList.find(pr=>pr.deco_vendor_id===vendorId&&pr.deco_type===decoType);
  if(!p||!p.pricing_tiers?.tiers?.length)return null;
  const qty=params.qty||1;const tiers=p.pricing_tiers.tiers;
  let tier=null;
  if(decoType==='embroidery'){
    // Default a missing stitch count to the standard left-chest size (8000) — same default the
    // UI uses — so an unspecified design prices at a realistic tier instead of silently matching
    // the cheapest min_stitches:0 tier.
    const st=params.stitches||8000;
    tier=tiers.find(t=>st>=t.min_stitches&&st<=(t.max_stitches||999999));
  }else if(decoType==='screen_print'){
    const colors=params.colors||1;
    tier=tiers.find(t=>t.colors===colors)||tiers[tiers.length-1];
  }else if(decoType==='dtf'){
    tier=tiers.find(t=>t.size_key===params.dtf_size)||tiers[0];
  }
  if(!tier||!tier.qty_breaks?.length)return null;
  const qb=tier.qty_breaks.slice().sort((a,b)=>a.min_qty-b.min_qty);
  let price=qb[0]?.price||0;
  for(const b of qb){if(qty>=b.min_qty)price=b.price}
  if(decoType==='screen_print'&&p.upcharges){
    if(params.underbase&&p.upcharges.underbase)price*=(1+p.upcharges.underbase);
    if(params.fleece&&p.upcharges.fleece)price*=(1+p.upcharges.fleece);
    if(params.mesh&&p.upcharges.mesh)price*=(1+p.upcharges.mesh);
    price=Math.round(price*100)/100;
  }
  return price;
};

// ── Pricing data (mutable, overridden from localStorage) ──
// Defaults come from decoPricing.js (the single source of truth); the bindings stay
// mutable `export let` so the nsa_settings override below can replace them and every
// importer sees the overridden tables (live ESM bindings), exactly as before.
export let SP=DECO.SP;
export let EM=DECO.EM;
export let NP=DECO.NP;
export let DTF=DECO.DTF;

// ── Configurable lists ──
export let POSITIONS=['Front','Back','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Collar','Yoke','Left Leg','Right Leg','Other'];
export let CONTACT_ROLES=['Primary','Billing','Shipping','Coach','Athletic Director','Equipment Manager','Booster Club','Other'];

// ── Load settings overrides from localStorage ──
// Only honor cached SP/EM if they match the current schema version (_v); otherwise use the new defaults.
try{const _s=JSON.parse(localStorage.getItem('nsa_settings')||'{}');if(_s.SP&&_s.SP._v===SP._v)SP=_s.SP;if(_s.EM&&_s.EM._v===EM._v)EM=_s.EM;if(_s.NP)NP=_s.NP;if(_s.DTF)DTF=_s.DTF;if(_s.POSITIONS)POSITIONS=_s.POSITIONS;if(_s.CONTACT_ROLES)CONTACT_ROLES=_s.CONTACT_ROLES}catch{}

// ── Pricing calculators ──
// Thin wrappers over the pure calculators in decoPricing.js. The tables object is
// rebuilt on EVERY call (not captured at module load) so the localStorage-overridden
// bindings above are always the ones that price — identical behavior to the old
// inline calculators that closed over the mutable module bindings.
const _tables=()=>({SP,EM,NP,DTF});
// Bracket 0 (under 12) stores sell price (flat total); other brackets store cost.
export function spP(q,c,s=true){return DECO.spP(_tables(),q,c,s)}
// Under-12 screen print is an ALL-IN flat charge — see decoPricing.spFlatShare (EST-1308).
export function spFlatShare(q,c,u=1){return DECO.spFlatShare(_tables(),q,c,u)}
// EM.pr stores cost; sell = max(rT(cost × EM.mk), EM.fl) so embroidery never sells below the EM.fl floor.
export function emP(st,q,s=true){return DECO.emP(_tables(),st,q,s)}
export function npP(q,tw=false,s=true){return DECO.npP(_tables(),q,tw,s)}
// Per-design quantity for a split-art decoration (one of two+ logos sharing a line's sizes);
// null when the deco isn't part of a split. Used so each design prices & bills at its own qty.
export const decoSplitQty=DECO.decoSplitQty;
export function dP(d,q,artFiles,cq){return DECO.dP(_tables(),d,q,artFiles,cq)}

// ── Combined costing for linked jobs that share a screen ──
// When a rep MANUALLY links jobs that carry the same artwork (so_jobs.link_group), they run
// on one screen / digitized setup instead of recreating it per sales order — so the decoration
// cost (a volume-tiered, in-house cost with no PO behind it) shouldn't be paid in full on each
// order. This returns the COMBINED decoration tier quantity per art file for `order`: its own
// art qty plus the units of every sibling job that shares the same link_group on OTHER orders.
// Feeding that combined qty into dP() prices the per-piece cost at the true combined volume, so
// the setup isn't double-charged and tiny linked runs clear the small-run minimum together.
//
// Manual links only — auto-matched same-art jobs stay production suggestions and never move
// costing until a rep confirms the link (which is also what makes them run together on the
// board). Revenue/sell is intentionally untouched: the customer price stays per-order, and a
// rep can hand-lower the sale price if they want to pass the saving on. Siblings are pooled only
// within the SAME deco_type (process) — a link group can legitimately span differently-named art
// that shares a screen, but a screen-print volume must never pool with an embroidery one even if
// a rep loosely links them by name.
//
// Returns { art_file_id -> combinedTierQty }, with an entry only when a real cross-order linked
// sibling exists; callers fall back to the per-order qty for everything else.
export const linkedArtCostQty=(order,localArtQty,allOrders)=>{
  const out={};
  const jobs=safeJobs(order).filter(j=>j&&j.link_group&&j.art_file_id);
  if(!jobs.length)return out;
  jobs.forEach(j=>{
    let extra=0;
    (allOrders||[]).forEach(s=>{
      if(!s||s.id===order.id)return;
      safeJobs(s).forEach(jj=>{if(jj&&jj.link_group&&jj.link_group===j.link_group&&jj.deco_type===j.deco_type)extra+=safeNum(jj.total_units)});
    });
    if(extra<=0)return; // no same-process sibling actually linked on another order → no combine
    const local=safeNum(localArtQty&&localArtQty[j.art_file_id])||safeNum(j.total_units);
    const combined=local+extra;
    if(combined>(out[j.art_file_id]||0))out[j.art_file_id]=combined;
  });
  return out;
};

// Cost contribution of a single decoration, pricing shared-screen art at the combined linked-job
// tier qty (from linkedArtCostQty) when it beats the per-order qty. Mirrors the `eq * dp.cost`
// term every cost walk already uses, but on the combined volume. Sell is never combined here —
// callers keep their own dP(...).sell for revenue so the customer price is unchanged.
export const decoCostAt=(d,q,af,localCq,combinedQty)=>{
  const cc=(d&&d.kind==='art'&&d.art_file_id&&combinedQty&&combinedQty[d.art_file_id]>localCq)?combinedQty[d.art_file_id]:localCq;
  const dp=dP(d,q,af,cc);
  const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);
  return eq*safeNum(dp.cost);
};

// ── calcOrderTotals — single source of truth for order/estimate/SO totals ──
// Mirrors the calculation in OrderEditor's `totals` memo so list views and the
// editor agree. Returns { rev, ship, tax, grand }.
import { safeNum as _sNum, safeItems as _sItems, safeSizes as _sSizes, safeDecos as _sDecos, safeArt as _sArt } from './safeHelpers';
export const calcOrderTotals=(o,custTaxRate=0)=>{
  if(!o)return{rev:0,ship:0,tax:0,grand:0};
  const items=_sItems(o);const af=_sArt(o);
  // Aggregate art quantities so volume-priced art uses the combined qty
  const artQty={};
  items.forEach(it=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    _sDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){artQty[d.art_file_id]=(artQty[d.art_file_id]||0)+(decoSplitQty(d)!=null?decoSplitQty(d):q)*(d.reversible?2:1)}});
  });
  let rev=0;
  items.forEach(it=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    if(!it.is_free_promo){
      if(it._sizeSells&&sq>0){
        Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell))});
      }else{
        rev+=q*_sNum(it.unit_sell);
      }
    }
    _sDecos(it).forEach(d=>{
      const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;
      const dp=dP(d,q,af,cq);
      const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);
      rev+=eq*_sNum(dp.sell);
    });
  });
  const ship=o.shipping_type==='pct'?rev*_sNum(o.shipping_value)/100:_sNum(o.shipping_value);
  // Webstore SOs collect/remit tax at checkout, so their stored tax_rate (0) is
  // authoritative — never fall back to the customer's default, or we'd double-tax.
  // (0 || custTaxRate picked up the customer rate; webstore SOs must honor the explicit 0.)
  const taxRate=o.tax_exempt?0:(o.source==='webstore'?_sNum(o.tax_rate):_sNum(o.tax_rate||custTaxRate));
  const tax=rev*taxRate;
  return{rev,ship,tax,grand:rev+ship+tax};
};

// ── calcOrderMargin — quick rev/cost/margin for dashboard KPIs ──
// Mirrors calcOrderTotals' revenue walk and adds a parallel cost walk (catalog/size
// cost + deco cost). Lighter than the Reports page (which prefers actual PO costs) — a
// reasonable at-a-glance gross margin. Returns { rev, cost, margin, pct }.
export const calcOrderMargin=(o,allOrders)=>{
  if(!o)return{rev:0,cost:0,margin:0,pct:0};
  const items=_sItems(o);const af=_sArt(o);
  const artQty={};
  items.forEach(it=>{const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);const q=sq>0?sq:_sNum(it.est_qty);if(!q)return;_sDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){artQty[d.art_file_id]=(artQty[d.art_file_id]||0)+(decoSplitQty(d)!=null?decoSplitQty(d):q)*(d.reversible?2:1)}})});
  // Combined deco-cost tier qty for manually-linked jobs sharing a screen across orders. Empty
  // (no combine) when allOrders is omitted, so existing single-arg callers are unchanged.
  const comb=linkedArtCostQty(o,artQty,allOrders);
  // Precompute once — same gate as Costs tab / OrderEditor totals / calcGP (keep in sync).
  const outByItem=outsourcedDecoTypes(o);
  let rev=0,cost=0;
  items.forEach((it,ii)=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    if(!it.is_free_promo){
      if(it._sizeSells&&sq>0){Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell))})}
      else{rev+=q*_sNum(it.unit_sell)}
    }
    if(it._sizeCosts&&sq>0){Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)cost+=n*(it._sizeCosts?.[sz]||_sNum(it.nsa_cost))})}
    else{cost+=q*_sNum(it.nsa_cost)}
    // Sell always counts (customer still pays); in-house cost is suppressed when a deco PO covers it.
    _sDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);rev+=eq*_sNum(dp.sell);if(!isDecoOutsourced(o,ii,d,outByItem))cost+=decoCostAt(d,q,af,cq,comb)})
  });
  // SO-level decoration POs (outside-deco + Topstar) are a real cost the customer is billed for.
  // calcTotals and the Reports page already count these; include them here too so the dashboard
  // KPI margin matches instead of overstating it. Prefer the actual supplier bill, else expected.
  (o.deco_pos||[]).forEach(dp=>{const bc=_sNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=_sNum(dp.qty||0)*_sNum(dp.unit_cost||0)});
  // Actual shipping spend (outbound from ShipStation + inbound freight) rolls into cost so margin is real
  const actualShipCost=_sNum(o._shipping_cost||o._shipstation_cost||0)||((o._shipments||[]).reduce((a,s)=>a+_sNum(s.shipping_cost||0),0));
  cost+=actualShipCost+_sNum(o._inbound_freight||0);
  // Shipping billed to the customer is revenue that offsets the shipping cost — mirrors calcGP in
  // CommissionsPage so margin treats shipping as a wash (only an over/under-quote moves it), not
  // pure cost drag. `rev` stays product+deco (dashboards sum it as sales), so the shipping charge
  // is applied to margin/pct here and returned separately as shipRev — never folded into rev.
  const shipRev=o.shipping_type==='pct'?rev*(_sNum(o.shipping_value)/100):_sNum(o.shipping_value);
  const totalRev=rev+shipRev;const margin=totalRev-cost;
  return{rev,cost,shipRev,margin,pct:totalRev>0?Math.round(margin/totalRev*100):0};
};

// ── calcQualifyingSpend — net sales (product + deco) that qualifies for promo earning ──
// Mirrors calcOrderTotals' revenue walk but also tallies per-line cost, and only counts
// a line's net revenue when its margin (sell−cost)/sell meets `minMargin` (default 20%).
// Used by the co-op "earn % of spend" calculation so thin-margin lines don't earn promo.
export const calcQualifyingSpend=(o,minMargin=0.2)=>{
  if(!o)return 0;
  const items=_sItems(o);const af=_sArt(o);
  const artQty={};
  items.forEach(it=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    _sDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){artQty[d.art_file_id]=(artQty[d.art_file_id]||0)+(decoSplitQty(d)!=null?decoSplitQty(d):q)*(d.reversible?2:1)}});
  });
  // Outside-deco cost lives on deco_pos (not per-line); suppress phantom in-house deco cost
  // so outsourced lines aren't wrongly treated as thin-margin (SO-1397).
  const outByItem=outsourcedDecoTypes(o);
  let total=0;
  items.forEach((it,ii)=>{
    if(it.is_free_promo)return;
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    let rev=0,cost=0;
    if(it._sizeSells&&sq>0){
      Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0){rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell));cost+=n*(it._sizeCosts?.[sz]||_sNum(it.nsa_cost))}});
    }else{
      rev+=q*_sNum(it.unit_sell);cost+=q*_sNum(it.nsa_cost);
    }
    _sDecos(it).forEach(d=>{
      const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;
      const dp=dP(d,q,af,cq);
      const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);
      rev+=eq*_sNum(dp.sell);if(!isDecoOutsourced(o,ii,d,outByItem))cost+=eq*_sNum(dp.cost);
    });
    const margin=rev>0?(rev-cost)/rev:0;
    if(margin>=minMargin)total+=rev;
  });
  return total;
};

// ── Paid-only promo earning (ownership rule 2026-07-06: promo earns from PAID revenue only) ──
// Normalize a date-ish string to 'YYYY-MM-DD'. Handles ISO strings and the locale strings
// legacy rows carry in created_at (e.g. "7/6/2026, 3:04 PM"), which break lexical range checks.
export const promoDateKey=(v)=>{
  const s=String(v||'');
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  const d=new Date(s);
  if(isNaN(d.getTime()))return '';
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
};

// A sales order counts as PAID when it has portal invoices and they are fully paid:
// payments cover the invoiced total (or, when totals are $0, every invoice is marked paid).
export const soIsPaid=(so,invs)=>{
  if(!so)return false;
  const rel=(invs||[]).filter(i=>i&&i.so_id===so.id&&i.status!=='void');
  if(!rel.length)return false;
  const total=rel.reduce((a,i)=>a+safeNum(i.total),0);
  if(total>0)return rel.reduce((a,i)=>a+safeNum(i.paid),0)>=total-0.01;
  return rel.every(i=>i.status==='paid');
};

// Qualifying PAID spend for a customer family within [start,end]. Two sources, combined:
//  - Portal SOs whose invoices are fully paid — line-level calcQualifyingSpend
//    (product+deco only, ≥20% margin; tax and shipping never enter).
//  - NetSuite sales history (customer_invoices rows, status 'paid') — header subtotal
//    (tax excluded; shipping sits inside the subtotal and is not separable), credit memos negative.
// The two sets have no linking key, so the breakdown is returned for the UI to display —
// any overlap must stay visible so a rep can adjust the allocation manually.
export const calcPaidQualifyingSpend=({sos,invs,histInvs,famIds,start,end})=>{
  const fam=new Set(famIds||[]);
  const inRange=(v)=>{const d=promoDateKey(v);return !!d&&d>=start&&d<=end};
  const soSpend=(sos||[]).filter(so=>so&&fam.has(so.customer_id)&&inRange(so.order_date||so.created_at)&&soIsPaid(so,invs))
    .reduce((a,so)=>a+calcQualifyingSpend(so),0);
  const histSpend=(histInvs||[]).filter(hi=>hi&&fam.has(hi.customer_id)&&hi.status==='paid'&&inRange(hi.date||hi.invoice_date))
    .reduce((a,hi)=>{
      const net=hi.subtotal!=null?safeNum(hi.subtotal):safeNum(hi.total)-safeNum(hi.tax);
      return a+(hi.invoice_type==='credit_memo'?-Math.abs(net):net);
    },0);
  return{soSpend:rQ(soSpend),histSpend:rQ(histSpend),total:rQ(soSpend+histSpend)};
};

// ── calcAdidasItemSpend — adidas product revenue ONLY (no decoration, shipping, or tax) ──
// For the coach-portal Adidas-only reporting section. Counts unit_sell × qty for items whose
// brand is adidas/agron; decorations are intentionally excluded. Free-promo items don't count.
export const calcAdidasItemSpend=(o)=>{
  if(!o)return 0;
  const items=_sItems(o);
  let total=0;
  items.forEach(it=>{
    if(it.is_free_promo)return;
    if(!isAdidasPriced(it.brand))return;
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    if(it._sizeSells&&sq>0){Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)total+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell))});}
    else{total+=q*_sNum(it.unit_sell);}
  });
  return total;
};

// ── mergeColors — pure function for combining customer + parent colors ──
export const mergeColors=(cust,allCustomers,field)=>{const own=cust?.[field]||[];if(!cust?.parent_id)return own;const parent=allCustomers?.find(c=>c.id===cust.parent_id);const parentColors=parent?.[field]||[];if(!parentColors.length)return own;const key=field==='pantone_colors'?'code':'name';const seen=new Set(own.map(c=>(c[key]||'').toUpperCase()));return[...own,...parentColors.filter(c=>!seen.has((c[key]||'').toUpperCase()))]};
