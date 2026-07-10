/* eslint-disable */
// ── Default decoration pricing — single source of truth ──
// One home for the SP/EM/NP/DTF default tables and the pricing primitives, shared
// by BOTH the webpack client (src/pricing.js re-exports everything and layers the
// localStorage nsa_settings overrides on top) AND the Netlify function runtime
// (netlify/functions/quickorder-quote.js requires this file directly; it ships in
// the function bundle via netlify.toml included_files). Same dual-consumer CJS
// pattern as src/lib/opsRecap.js — keep this file dependency-free CommonJS (no
// import/export keywords, or webpack treats it as ESM and drops module.exports).
//
// The calculators are PURE: every one takes the pricing tables as its first
// argument (T = { SP, EM, NP, DTF }). A server caller passes the defaults
// exported here (ignoring any browser localStorage overrides by construction);
// src/pricing.js passes its own mutable, override-merged bindings so client
// behavior is unchanged.

// ── Utility helpers ──
const rQ = v => Math.round(v * 4) / 4;
const rT = v => Math.round(v * 10) / 10;
// Local copy of safeHelpers.safeNum — this module must stay dependency-free.
const safeNum = v => typeof v === 'number' && !isNaN(v) ? v : 0;

// ── Adidas/UA/NB tier discount off retail ──
// Standard schedule is A=40% / B=35% / C=30% off. Items imported from Lockerroom
// (products.pricing_group === 'lockerroom') use a reduced schedule: A=35% / B=30% / C=25%.
// Footwear discounts 5% less than apparel at each tier (A=35% / B=30% / C=25%).
const _TIER_STD={A:0.40,B:0.35,C:0.30};
const _TIER_LOCKERROOM={A:0.35,B:0.30,C:0.25};
const _TIER_FOOTWEAR={A:0.35,B:0.30,C:0.25};
const auTierDisc=(tier,pricingGroup,category)=>{const tbl=category==='Footwear'?_TIER_FOOTWEAR:(pricingGroup==='lockerroom'?_TIER_LOCKERROOM:_TIER_STD);return tbl[tier]!=null?tbl[tier]:tbl.B;};
// ── Brands that auto-calc cost off retail (MSRP) instead of cost×markup ──
// Agron is an Adidas bag distributor — its product ships on the Adidas contract, so it
// prices identically to Adidas (cost = retail × 0.5 × 0.75).
const isAdidasPriced=b=>{const l=(b||'').toLowerCase();return l==='adidas'||l==='agron'};
const isAU=b=>{const l=(b||'').toLowerCase();return l==='adidas'||l==='under armour'||l==='new balance'||l==='agron'};
// Auto cost from retail. Apparel/OSFA: Adidas/Agron ×0.5×0.75 (0.375), UA/NB ×0.5×0.85 (0.425).
// Footwear: Adidas/Agron ×0.55×0.75 (0.4125), UA/NB ×0.55×0.85 (0.4675).
const auCostMult=(brand,isFootwear)=>{const adi=isAdidasPriced(brand);return isFootwear?(adi?0.55*0.75:0.55*0.85):(adi?0.375:0.425)};

// ── Default pricing tables ──
// _v bumps when default values change so cached localStorage from older versions is ignored.
// _v 3: bracket-0 3-color raised 70→80 and bracket 0 now BILLS as an all-in flat charge (see spFlatShare).
// NOTE: the object literals below are kept byte-identical to the local copies in
// src/App.js — the pricingDrift test compares the source text, so edit both together.
const SP={_v:3,bk:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],pr:{0:[50,60,80,null,null],1:[3.33,4.33,5.33,6,null],2:[2.33,3,4,4.67,5.33],3:[2.13,2.83,3.17,4,5],4:[1.97,2.57,2.83,3.33,4],5:[1.83,2.33,2.63,3,3.5],6:[1.67,2.13,2.47,2.67,3.17],7:[1.5,2,2.33,2.5,2.83],8:[1.4,1.9,2.07,2.2,2.67],9:[1.27,1.83,1.93,2.07,2.5]},mk:1.5,ub:0.15};
// fl = minimum per-piece sell price (floor). Sell never drops below it; tiers already above it keep their higher price.
const EM={_v:4,sb:[10000,15000,20000,999999],qb:[6,24,48,99999],pr:[[4.8,5.1,4.8,4.5],[5.4,5.1,4.8,4.8],[6,5.7,5.4,5.4],[7.2,7.5,7.2,6]],mk:1.6,fl:8};
const NP={bk:[10,50,99999],co:[4,3,3],se:[7,6,5],tc:3};
const DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];

// Default table set for callers that don't layer overrides (i.e. server code).
const DEFAULTS={SP,EM,NP,DTF};

// ── Pricing calculators (pure — tables passed explicitly as T) ──
// Bracket 0 (under 12) stores sell price (flat total); other brackets store cost.
function spP(T,q,c,s=true){const SP=T.SP;const bi=SP.bk.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.pr[bi]?.[c-1];if(v==null)return 0;if(bi===0)return s?v:rQ(v/SP.mk);return s?rT(v*SP.mk):v}
// Under-12 screen print is an ALL-IN charge for the whole run ($50/$60/$80 for 1/2/3 colors), not a
// per-piece rate — billing used to multiply the flat value per piece (EST-1308 showed $46.75/pc on a
// small line). Returns the flat sell/cost as UNROUNDED per-piece shares of the priced qty so every
// caller's `eq × value` reconstructs the exact flat total (multi-line art runs prorate it across
// lines); null outside bracket 0. Underbase scales the flat charge like it scales the tiers.
function spFlatShare(T,q,c,u=1){const SP=T.SP;const b0=SP.bk[0];if(!(q>=b0.min&&q<=b0.max))return null;const v=SP.pr[0]?.[c-1];if(v==null||!(q>0))return null;const fs=v*u;return{sell:fs/q,cost:rQ(fs/SP.mk)/q}}
// EM.pr stores cost; sell = max(rT(cost × EM.mk), EM.fl) so embroidery never sells below the EM.fl floor.
function emP(T,st,q,s=true){const EM=T.EM;const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.pr[si][qi];return s?Math.max(rT(v*EM.mk),EM.fl||0):v}
function npP(T,q,tw=false,s=true){const NP=T.NP;const bi=NP.bk.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.se[bi]+(tw?rQ(NP.tc*1.65):0)):(NP.co[bi]+(tw?NP.tc:0))}
// Per-design quantity for a split-art decoration (one of two+ logos sharing a line's sizes);
// null when the deco isn't part of a split. Used so each design prices & bills at its own qty.
const decoSplitQty=(d)=>(d&&d.split_group&&d.split_sizes)?Object.values(d.split_sizes).reduce((a,v)=>a+safeNum(v),0):null;
function dP(T,d,q,artFiles,cq){
  // Split-art designs bill at their own per-size allocation. cq (the combined tier qty) is
  // already summed per design by the artQty builders, so price the design at its share, then
  // stamp the billed qty (_nq) so every caller's `eq` multiplies by the design's pieces — not
  // the full line. Non-split decos are untouched (decoSplitQty → null).
  const _r=_dPInner(T,d,q,artFiles,cq);
  const _sq=decoSplitQty(d);
  if(_sq!=null&&d.kind==='art'&&_r&&_r._nq==null)_r._nq=_sq*(d.reversible?2:1);
  return _r;
}
function _dPInner(T,d,q,artFiles,cq){
  const SP=T.SP,EM=T.EM,DTF=T.DTF;
  const _revMult=d.reversible?2:1;
  // cq (from artQty) already incorporates the reversible ×2; only apply _revMult as fallback
  const pq=cq!=null?cq:q*_revMult;
  if(d.kind==='art'&&d.art_file_id&&artFiles){
    if(d.art_file_id==='__tbd'){const tType=d.art_tbd_type||'screen_print';
      if(tType==='screen_print'){const nc=d.tbd_colors||1;const u=d.underbase?1+SP.ub:1;const f=spFlatShare(T,pq,nc,u);if(f)return{sell:d.sell_override!=null?d.sell_override:f.sell,cost:f.cost};const c=rQ(spP(T,pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
      if(tType==='embroidery'){const c=emP(T,d.tbd_stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
      if(tType==='heat_press'||tType==='dtf'){const t=DTF[d.tbd_dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}};
      return{sell:d.sell_override||0,cost:0}}
    const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    const _cwInkCount=(()=>{if(d.color_way_id&&art.color_ways){const cw=art.color_ways.find(c=>c.id===d.color_way_id);if(cw)return cw.inks.length}return null})();
    if(art.deco_type==='screen_print'){const nc=_cwInkCount||(art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1);const u=d.underbase?1+SP.ub:1;const f=spFlatShare(T,pq,nc,u);if(f)return{sell:d.sell_override!=null?d.sell_override:f.sell,cost:f.cost};const c=rQ(spP(T,pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
    if(art.deco_type==='embroidery'){const c=emP(T,art.stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
    if(art.deco_type==='dtf'||art.deco_type==='heat_press'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;const f=spFlatShare(T,q,d.colors||1,u);if(f)return{sell:d.sell_override!=null?d.sell_override:f.sell,cost:f.cost};const c=rQ(spP(T,q,d.colors||1,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
  if(d.type==='embroidery'){const c=emP(T,d.stitches||8000,q,false);return{sell:d.sell_override!=null?d.sell_override:Math.max(rT(c*EM.mk),EM.fl||0),cost:c}}
  if(d.kind==='numbers'||d.type==='number_press'){if(d.num_method==='sublimated'){const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:0;const useQty=nq||safeNum(d.num_qty)||0;const mult=(d.front_and_back?2:1)*(d.reversible?2:1);return{sell:safeNum(d.sell_override)||0,cost:0,_nq:useQty*mult}}const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:0;const hasAssigned=nq>0;const useQty=hasAssigned?nq:(safeNum(d.num_qty)||q);const mult=(d.front_and_back?2:1)*(d.reversible?2:1);const fnq=useQty*mult;return{sell:d.sell_override!=null?d.sell_override:npP(T,fnq||1,d.two_color,true),cost:npP(T,fnq||1,d.two_color,false),_nq:fnq}};
  if(d.kind==='names'){if(d.name_method==='sublimated')return{sell:safeNum(d.sell_override)||0,cost:0};const nc=d.names?Object.values(d.names).flat().filter(v=>v&&v.trim()).length:0;const useNc=nc||safeNum(d.name_qty)||0;const se=safeNum(d.sell_override||d.sell_each||6);const co=safeNum(d.cost_each||3);return{sell:useNc>0?rQ(useNc*se/q):se,cost:useNc>0?rQ(useNc*co/q):co}};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}
  if(d.kind==='outside_deco')return{sell:d.sell_override||safeNum(d.sell_each),cost:safeNum(d.cost_each)};
  return{sell:0,cost:0}}

module.exports = { rQ, rT, auTierDisc, isAdidasPriced, isAU, auCostMult, SP, EM, NP, DTF, DEFAULTS, spP, spFlatShare, emP, npP, decoSplitQty, dP };
