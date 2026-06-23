/* eslint-disable */
import { EXTRA_SIZES, SZ_NORM, CATEGORIES } from './constants';
import { safeNum, safeJobs } from './safeHelpers';

// ── Utility helpers ──
export const rQ=v=>Math.round(v*4)/4;
export const rT=v=>Math.round(v*10)/10;

// ── Adidas/UA/NB tier discount off retail ──
// Standard schedule is A=40% / B=35% / C=30% off. Items imported from Lockerroom
// (products.pricing_group === 'lockerroom') use a reduced schedule: A=35% / B=30% / C=25%.
// Footwear discounts 5% less than apparel at each tier (A=35% / B=30% / C=25%).
const _TIER_STD={A:0.40,B:0.35,C:0.30};
const _TIER_LOCKERROOM={A:0.35,B:0.30,C:0.25};
const _TIER_FOOTWEAR={A:0.35,B:0.30,C:0.25};
export const auTierDisc=(tier,pricingGroup,category)=>{const tbl=category==='Footwear'?_TIER_FOOTWEAR:(pricingGroup==='lockerroom'?_TIER_LOCKERROOM:_TIER_STD);return tbl[tier]!=null?tbl[tier]:tbl.B;};
// ── Brands that auto-calc cost off retail (MSRP) instead of cost×markup ──
// Agron is an Adidas bag distributor — its product ships on the Adidas contract, so it
// prices identically to Adidas (cost = retail × 0.5 × 0.75).
export const isAdidasPriced=b=>{const l=(b||'').toLowerCase();return l==='adidas'||l==='agron'};
export const isAU=b=>{const l=(b||'').toLowerCase();return l==='adidas'||l==='under armour'||l==='new balance'||l==='agron'};
// Auto cost from retail. Apparel/OSFA: Adidas/Agron ×0.5×0.75 (0.375), UA/NB ×0.5×0.85 (0.425).
// Footwear: Adidas/Agron ×0.55×0.75 (0.4125), UA/NB ×0.55×0.85 (0.4675).
export const auCostMult=(brand,isFootwear)=>{const adi=isAdidasPriced(brand);return isFootwear?(adi?0.55*0.75:0.55*0.85):(adi?0.375:0.425)};
export const normSzName=s=>{if(!s)return s;const u=s.toUpperCase().trim();return SZ_NORM[u]||u};
export const showSz=(s,inv)=>{const c=['S','M','L','XL','2XL'];if(c.includes(s))return true;return!EXTRA_SIZES.includes(s)||(inv||0)>0};

// ── Deco vendor price lookup ──
export const _decoVendorPrice=(pricingList,vendorId,decoType,params={})=>{
  const p=pricingList.find(pr=>pr.deco_vendor_id===vendorId&&pr.deco_type===decoType);
  if(!p||!p.pricing_tiers?.tiers?.length)return null;
  const qty=params.qty||1;const tiers=p.pricing_tiers.tiers;
  let tier=null;
  if(decoType==='embroidery'){
    const st=params.stitches||0;
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
// _v bumps when default values change so cached localStorage from older versions is ignored.
export let SP={_v:2,bk:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],pr:{0:[50,60,70,null,null],1:[3.33,4.33,5.33,6,null],2:[2.33,3,4,4.67,5.33],3:[2.13,2.83,3.17,4,5],4:[1.97,2.57,2.83,3.33,4],5:[1.83,2.33,2.63,3,3.5],6:[1.67,2.13,2.47,2.67,3.17],7:[1.5,2,2.33,2.5,2.83],8:[1.4,1.9,2.07,2.2,2.67],9:[1.27,1.83,1.93,2.07,2.5]},mk:1.5,ub:0.15};
// fl = minimum per-piece sell price (floor). Sell never drops below it; tiers already above it keep their higher price.
export let EM={_v:4,sb:[10000,15000,20000,999999],qb:[6,24,48,99999],pr:[[4.8,5.1,4.8,4.5],[5.4,5.1,4.8,4.8],[6,5.7,5.4,5.4],[7.2,7.5,7.2,6]],mk:1.6,fl:8};
export let NP={bk:[10,50,99999],co:[4,3,3],se:[7,6,5],tc:3};
export let DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];

// ── Configurable lists ──
export let POSITIONS=['Front','Back','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Collar','Yoke','Left Leg','Right Leg','Other'];
export let CONTACT_ROLES=['Primary','Billing','Shipping','Coach','Athletic Director','Equipment Manager','Booster Club','Other'];

// ── Load settings overrides from localStorage ──
// Only honor cached SP/EM if they match the current schema version (_v); otherwise use the new defaults.
try{const _s=JSON.parse(localStorage.getItem('nsa_settings')||'{}');if(_s.SP&&_s.SP._v===SP._v)SP=_s.SP;if(_s.EM&&_s.EM._v===EM._v)EM=_s.EM;if(_s.NP)NP=_s.NP;if(_s.DTF)DTF=_s.DTF;if(_s.POSITIONS)POSITIONS=_s.POSITIONS;if(_s.CONTACT_ROLES)CONTACT_ROLES=_s.CONTACT_ROLES}catch{}

// ── Pricing calculators ──
// Bracket 0 (under 12) stores sell price (flat total); other brackets store cost.
export function spP(q,c,s=true){const bi=SP.bk.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.pr[bi]?.[c-1];if(v==null)return 0;if(bi===0)return s?v:rQ(v/SP.mk);return s?rT(v*SP.mk):v}
// EM.pr stores cost; sell = max(rT(cost × EM.mk), EM.fl) so embroidery never sells below the EM.fl floor.
export function emP(st,q,s=true){const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.pr[si][qi];return s?Math.max(rT(v*EM.mk),EM.fl||0):v}
export function npP(q,tw=false,s=true){const bi=NP.bk.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.se[bi]+(tw?rQ(NP.tc*1.65):0)):(NP.co[bi]+(tw?NP.tc:0))}
// Per-design quantity for a split-art decoration (one of two+ logos sharing a line's sizes);
// null when the deco isn't part of a split. Used so each design prices & bills at its own qty.
export const decoSplitQty=(d)=>(d&&d.split_group&&d.split_sizes)?Object.values(d.split_sizes).reduce((a,v)=>a+safeNum(v),0):null;
export function dP(d,q,artFiles,cq){
  // Split-art designs bill at their own per-size allocation. cq (the combined tier qty) is
  // already summed per design by the artQty builders, so price the design at its share, then
  // stamp the billed qty (_nq) so every caller's `eq` multiplies by the design's pieces — not
  // the full line. Non-split decos are untouched (decoSplitQty → null).
  const _r=_dPInner(d,q,artFiles,cq);
  const _sq=decoSplitQty(d);
  if(_sq!=null&&d.kind==='art'&&_r&&_r._nq==null)_r._nq=_sq*(d.reversible?2:1);
  return _r;
}
function _dPInner(d,q,artFiles,cq){
  const _revMult=d.reversible?2:1;
  // cq (from artQty) already incorporates the reversible ×2; only apply _revMult as fallback
  const pq=cq!=null?cq:q*_revMult;
  if(d.kind==='art'&&d.art_file_id&&artFiles){
    if(d.art_file_id==='__tbd'){const tType=d.art_tbd_type||'screen_print';
      if(tType==='screen_print'){const nc=d.tbd_colors||1;const u=d.underbase?1+SP.ub:1;const c=rQ(spP(pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
      if(tType==='embroidery'){const c=emP(d.tbd_stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
      if(tType==='heat_press'||tType==='dtf'){const t=DTF[d.tbd_dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}};
      return{sell:d.sell_override||0,cost:0}}
    const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    const _cwInkCount=(()=>{if(d.color_way_id&&art.color_ways){const cw=art.color_ways.find(c=>c.id===d.color_way_id);if(cw)return cw.inks.length}return null})();
    if(art.deco_type==='screen_print'){const nc=_cwInkCount||(art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1);const u=d.underbase?1+SP.ub:1;const c=rQ(spP(pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
    if(art.deco_type==='embroidery'){const c=emP(art.stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
    if(art.deco_type==='dtf'||art.deco_type==='heat_press'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;const c=rQ(spP(q,d.colors||1,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
  if(d.type==='embroidery'){const c=emP(d.stitches||8000,q,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
  if(d.kind==='numbers'||d.type==='number_press'){if(d.num_method==='sublimated'){const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:0;const useQty=nq||safeNum(d.num_qty)||0;const mult=(d.front_and_back?2:1)*(d.reversible?2:1);return{sell:safeNum(d.sell_override)||0,cost:0,_nq:useQty*mult}}const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:0;const hasAssigned=nq>0;const useQty=hasAssigned?nq:(safeNum(d.num_qty)||q);const mult=(d.front_and_back?2:1)*(d.reversible?2:1);const fnq=useQty*mult;return{sell:d.sell_override!=null?d.sell_override:npP(fnq||1,d.two_color,true),cost:npP(fnq||1,d.two_color,false),_nq:fnq}};
  if(d.kind==='names'){if(d.name_method==='sublimated')return{sell:safeNum(d.sell_override)||0,cost:0};const nc=d.names?Object.values(d.names).flat().filter(v=>v&&v.trim()).length:0;const useNc=nc||safeNum(d.name_qty)||0;const se=safeNum(d.sell_override||d.sell_each||6);const co=safeNum(d.cost_each||3);return{sell:useNc>0?rQ(useNc*se/q):se,cost:useNc>0?rQ(useNc*co/q):co}};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}
  if(d.kind==='outside_deco')return{sell:d.sell_override||safeNum(d.sell_each),cost:safeNum(d.cost_each)};
  return{sell:0,cost:0}}

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
  const taxRate=o.tax_exempt?0:_sNum(o.tax_rate||custTaxRate);
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
  let rev=0,cost=0;
  items.forEach(it=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    if(!it.is_free_promo){
      if(it._sizeSells&&sq>0){Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell))})}
      else{rev+=q*_sNum(it.unit_sell)}
    }
    if(it._sizeCosts&&sq>0){Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)cost+=n*(it._sizeCosts?.[sz]||_sNum(it.nsa_cost))})}
    else{cost+=q*_sNum(it.nsa_cost)}
    _sDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);rev+=eq*_sNum(dp.sell);cost+=decoCostAt(d,q,af,cq,comb)})
  });
  // SO-level decoration POs (outside-deco + Topstar) are a real cost the customer is billed for.
  // calcTotals and the Reports page already count these; include them here too so the dashboard
  // KPI margin matches instead of overstating it. Prefer the actual supplier bill, else expected.
  (o.deco_pos||[]).forEach(dp=>{const bc=_sNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=_sNum(dp.qty||0)*_sNum(dp.unit_cost||0)});
  // Actual shipping spend (outbound from ShipStation + inbound freight) rolls into cost so margin is real
  const actualShipCost=_sNum(o._shipping_cost||o._shipstation_cost||0)||((o._shipments||[]).reduce((a,s)=>a+_sNum(s.shipping_cost||0),0));
  cost+=actualShipCost+_sNum(o._inbound_freight||0);
  return{rev,cost,margin:rev-cost,pct:rev>0?Math.round((rev-cost)/rev*100):0};
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
  let total=0;
  items.forEach(it=>{
    if(it.is_free_promo)return;
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    let rev=0,cost=0;
    if(it._sizeSells&&sq>0){
      Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0){rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell));cost+=n*_sNum(it.nsa_cost)}});
    }else{
      rev+=q*_sNum(it.unit_sell);cost+=q*_sNum(it.nsa_cost);
    }
    _sDecos(it).forEach(d=>{
      const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;
      const dp=dP(d,q,af,cq);
      const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);
      rev+=eq*_sNum(dp.sell);cost+=eq*_sNum(dp.cost);
    });
    const margin=rev>0?(rev-cost)/rev:0;
    if(margin>=minMargin)total+=rev;
  });
  return total;
};

// ── mergeColors — pure function for combining customer + parent colors ──
export const mergeColors=(cust,allCustomers,field)=>{const own=cust?.[field]||[];if(!cust?.parent_id)return own;const parent=allCustomers?.find(c=>c.id===cust.parent_id);const parentColors=parent?.[field]||[];if(!parentColors.length)return own;const key=field==='pantone_colors'?'code':'name';const seen=new Set(own.map(c=>(c[key]||'').toUpperCase()));return[...own,...parentColors.filter(c=>!seen.has((c[key]||'').toUpperCase()))]};
