/* eslint-disable */
import { EXTRA_SIZES, SZ_NORM, CATEGORIES } from './constants';
import { safeNum } from './safeHelpers';

// ── Utility helpers ──
export const rQ=v=>Math.round(v*4)/4;
export const rT=v=>Math.round(v*10)/10;
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
export let SP={bk:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],pr:{0:[50,60,70,null,null],1:[5,6.5,8,9,null],2:[3.5,4.5,6,7,8],3:[3.2,4.25,4.75,6,7.5],4:[2.95,3.85,4.25,5,6],5:[2.75,3.5,3.95,4.5,5.25],6:[2.5,3.2,3.7,4,4.75],7:[2.25,3,3.5,3.75,4.25],8:[2.1,2.85,3.1,3.3,4],9:[1.9,2.75,2.9,3.1,3.75]},mk:1.5,ub:0.15};
export let EM={sb:[10000,15000,20000,999999],qb:[6,24,48,99999],pr:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],mk:1.6};
export let NP={bk:[10,50,99999],co:[4,3,3],se:[7,6,5],tc:3};
export let DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];

// ── Configurable lists ──
export let POSITIONS=['Front','Back','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Collar','Hood','Left Leg','Right Leg','Other'];
export let CONTACT_ROLES=['Primary','Billing','Shipping','Coach','Athletic Director','Equipment Manager','Booster Club','Other'];

// ── Load settings overrides from localStorage ──
try{const _s=JSON.parse(localStorage.getItem('nsa_settings')||'{}');if(_s.SP)SP=_s.SP;if(_s.EM)EM=_s.EM;if(_s.NP)NP=_s.NP;if(_s.DTF)DTF=_s.DTF;if(_s.POSITIONS)POSITIONS=_s.POSITIONS;if(_s.CONTACT_ROLES)CONTACT_ROLES=_s.CONTACT_ROLES}catch{}

// ── Pricing calculators ──
export function spP(q,c,s=true){const bi=SP.bk.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.pr[bi]?.[c-1];if(v==null)return 0;return s?v:rQ(v/SP.mk)}
export function emP(st,q,s=true){const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.pr[si][qi];return s?v:rQ(v/EM.mk)}
export function npP(q,tw=false,s=true){const bi=NP.bk.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.se[bi]+(tw?rQ(NP.tc*1.65):0)):(NP.co[bi]+(tw?NP.tc:0))}
export function dP(d,q,artFiles,cq){
  const pq=cq||q;
  if(d.kind==='art'&&d.art_file_id&&artFiles){
    if(d.art_file_id==='__tbd'){const tType=d.art_tbd_type||'screen_print';
      if(tType==='screen_print'){const nc=d.tbd_colors||1;const u=d.underbase?1+SP.ub:1;const c=rQ(spP(pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
      if(tType==='embroidery'){const c=emP(d.tbd_stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:rT(c*EM.mk),cost:c}}
      if(tType==='heat_press'||tType==='dtf'){const t=DTF[d.tbd_dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}};
      return{sell:d.sell_override||0,cost:0}}
    const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    const _cwInkCount=(()=>{if(d.color_way_id&&art.color_ways){const cw=art.color_ways.find(c=>c.id===d.color_way_id);if(cw)return cw.inks.length}return null})();
    if(art.deco_type==='screen_print'){const nc=_cwInkCount||(art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1);const u=d.underbase?1+SP.ub:1;const c=rQ(spP(pq,nc,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
    if(art.deco_type==='embroidery'){const c=emP(art.stitches||8000,pq,false);return{sell:d.sell_override!=null?d.sell_override:rT(c*EM.mk),cost:c}}
    if(art.deco_type==='dtf'||art.deco_type==='heat_press'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;const c=rQ(spP(q,d.colors||1,false)*u);return{sell:d.sell_override!=null?d.sell_override:rT(c*SP.mk),cost:c}}
  if(d.type==='embroidery'){const c=emP(d.stitches||8000,q,false);return{sell:d.sell_override!=null?d.sell_override:rT(c*EM.mk),cost:c}}
  if(d.kind==='numbers'||d.type==='number_press'){const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:0;const hasAssigned=nq>0;const useQty=hasAssigned?nq:(safeNum(d.num_qty)||q);const mult=(d.front_and_back?2:1)*(d.reversible?2:1);const fnq=useQty*mult;return{sell:d.sell_override||npP(useQty||1,d.two_color,true),cost:npP(useQty||1,d.two_color,false),_nq:fnq}};
  if(d.kind==='names'){const nc=d.names?Object.values(d.names).flat().filter(v=>v&&v.trim()).length:0;const useNc=nc||safeNum(d.name_qty)||0;const se=safeNum(d.sell_override||d.sell_each||6);const co=safeNum(d.cost_each||3);return{sell:useNc>0?rQ(useNc*se/q):se,cost:useNc>0?rQ(useNc*co/q):co}};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}
  if(d.kind==='outside_deco')return{sell:d.sell_override||safeNum(d.sell_each),cost:safeNum(d.cost_each)};
  return{sell:0,cost:0}}

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
    _sDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){artQty[d.art_file_id]=(artQty[d.art_file_id]||0)+q}});
  });
  let rev=0;
  items.forEach(it=>{
    const sq=Object.values(_sSizes(it)).reduce((a,v)=>a+_sNum(v),0);
    const q=sq>0?sq:_sNum(it.est_qty);
    if(!q)return;
    if(it._sizeSells&&sq>0){
      Object.entries(_sSizes(it)).forEach(([sz,v])=>{const n=_sNum(v);if(n>0)rev+=n*(it._sizeSells?.[sz]||_sNum(it.unit_sell))});
    }else{
      rev+=q*_sNum(it.unit_sell);
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

// ── mergeColors — pure function for combining customer + parent colors ──
export const mergeColors=(cust,allCustomers,field)=>{const own=cust?.[field]||[];if(!cust?.parent_id)return own;const parent=allCustomers?.find(c=>c.id===cust.parent_id);const parentColors=parent?.[field]||[];if(!parentColors.length)return own;const key=field==='pantone_colors'?'code':'name';const seen=new Set(own.map(c=>(c[key]||'').toUpperCase()));return[...own,...parentColors.filter(c=>!seen.has((c[key]||'').toUpperCase()))]};
