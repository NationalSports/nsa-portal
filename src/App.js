/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './portal.css';
const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,save:<><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin',pin:'1234'},{id:'r2',name:'Denis',role:'gm',pin:'2345'},{id:'r3',name:'Liliana',role:'production',pin:'3456'},{id:'r4',name:'Laura Chen',role:'rep',pin:'4567'},{id:'r5',name:'Mike Torres',role:'rep',pin:'5678'}];
const NSA={name:'National Sports Apparel',legal:'National Sports Apparel LLC',phone:'(619) 555-0127',email:'team@nsa-teamwear.com',
  addr:'9340 Cabot Dr, Suite A',city:'San Diego',state:'CA',zip:'91941',
  fullAddr:'9340 Cabot Dr, Suite A, San Diego, CA 91941',
  logo:'NSA',terms:'Net 30 from invoice date unless otherwise agreed.',
  depositTerms:'50% deposit required to begin production. Balance due upon completion.'};

// ═══════════════════════════════════════════════
// PRINT DOCUMENT HELPER — generates professional print-ready HTML
// ═══════════════════════════════════════════════
const PRINT_CSS=`
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px 32px;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #1e3a5f}
.logo{font-size:28px;font-weight:900;color:#1e3a5f;letter-spacing:-1px}
.logo span{font-size:11px;font-weight:400;color:#666;display:block;letter-spacing:1px}
.company-info{text-align:right;font-size:10px;color:#555;line-height:1.6}
.doc-title{font-size:22px;font-weight:800;color:#1e3a5f;margin:12px 0 4px}
.doc-subtitle{font-size:11px;color:#666;margin-bottom:12px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.info-box{padding:10px 12px;background:#f8f9fa;border-radius:6px;border:1px solid #e8e8e8}
.info-box .label{font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px}
.info-box .value{font-size:13px;font-weight:700;color:#1a1a1a}
.info-box .sub{font-size:10px;color:#666;margin-top:2px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th{background:#f0f2f5;padding:7px 8px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.3px;border-bottom:2px solid #d0d5dd}
td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}
.sz-table th,.sz-table td{text-align:center;padding:4px 6px;font-size:10px;min-width:32px}
.sz-table td.has-qty{font-weight:800;color:#1e3a5f;background:#eef2ff}
.totals-row td{font-weight:800;border-top:2px solid #1e3a5f;font-size:12px}
.notes{margin-top:12px;padding:10px 12px;background:#fffbe6;border-radius:6px;border:1px solid #f0e6b8;font-size:11px}
.notes .label{font-weight:700;color:#8b6914;margin-bottom:2px}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:9px;color:#999;display:flex;justify-content:space-between}
.amount{text-align:right;font-weight:700}
.highlight{background:#eef6ee;color:#166534}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700}
.no-price td:nth-child(n+5){display:none}.no-price th:nth-child(n+5){display:none}
@media print{body{padding:12px 18px}.header{border-bottom-color:#000}th{background:#f0f0f0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@page{margin:0.5in;size:letter}
`;

const printDoc=({title,docNum,docType,headerRight,infoBoxes,tables,notes,footer,showPricing=true})=>{
  const w=window.open('','_blank','width=800,height=1000');
  if(!w)return;
  let html='<!DOCTYPE html><html><head><title>'+docNum+' — '+title+'</title><style>'+PRINT_CSS+'</style></head><body>';
  // Header
  html+='<div class="header"><div><div class="logo">'+NSA.logo+'<span>'+NSA.name+'</span></div></div>';
  html+='<div class="company-info">'+NSA.fullAddr+'<br/>'+NSA.phone+' · '+NSA.email+'</div></div>';
  // Doc title
  html+='<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html+='<div class="doc-title">'+docType+'</div>';
  if(headerRight)html+='<div style="text-align:right">'+headerRight+'</div>';
  html+='</div>';
  html+='<div class="doc-subtitle">#'+docNum+' · '+new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+'</div>';
  // Info boxes
  if(infoBoxes){
    html+='<div class="info-grid">';
    infoBoxes.forEach(b=>{
      html+='<div class="info-box"><div class="label">'+b.label+'</div><div class="value">'+b.value+'</div>';
      if(b.sub)html+='<div class="sub">'+b.sub+'</div>';
      html+='</div>';
    });
    html+='</div>';
  }
  // Tables
  if(tables){tables.forEach(t=>{
    if(t.title)html+='<div style="font-weight:700;font-size:12px;color:#1e3a5f;margin:12px 0 4px;border-bottom:1px solid #eee;padding-bottom:3px">'+t.title+'</div>';
    html+='<table class="'+(t.className||'')+'">';
    if(t.headers){html+='<thead><tr>';t.headers.forEach((h,i)=>{
      const align=t.aligns?.[i]||'left';html+='<th style="text-align:'+align+'">'+h+'</th>'});
      html+='</tr></thead>';}
    html+='<tbody>';
    (t.rows||[]).forEach(r=>{
      html+='<tr'+(r._class?' class="'+r._class+'"':'')+(r._style?' style="'+r._style+'"':'')+'>';
      r.cells.forEach((c,i)=>{
        const align=t.aligns?.[i]||'left';
        html+='<td style="text-align:'+align+';'+(c.style||'')+'">'+(c.value!==undefined?c.value:c)+'</td>'});
      html+='</tr>'});
    html+='</tbody></table>';
  })}
  // Notes
  if(notes)html+='<div class="notes"><div class="label">Notes</div>'+notes+'</div>';
  // Footer
  html+='<div class="footer"><span>'+NSA.name+' · '+NSA.fullAddr+'</span><span>Printed '+(new Date().toLocaleString())+'</span></div>';
  if(footer)html+='<div style="font-size:10px;color:#888;margin-top:6px">'+footer+'</div>';
  html+='</body></html>';
  w.document.write(html);w.document.close();
  setTimeout(()=>w.print(),350);
};
let _idSeq=0;const uid=(prefix)=>prefix+Date.now().toString(36).slice(-4)+String(++_idSeq).padStart(2,'0');
let _estSeq=2101;let _soSeq=1042;
const nextEstId=(ests)=>{const nums=(ests||[]).map(e=>{const m=(e.id||'').match(/EST-(\d+)/);return m?parseInt(m[1]):0});const next=Math.max(_estSeq,...nums)+1;_estSeq=next;return'EST-'+next};
const nextSOId=(sos)=>{const nums=(sos||[]).map(s=>{const m=(s.id||'').match(/SO-(\d+)/);return m?parseInt(m[1]):0});const next=Math.max(_soSeq,...nums)+1;_soSeq=next;return'SO-'+next};
const CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
const CONTACT_ROLES=['Head Coach','Assistant','Accounting','Athletic Director','Primary','Other'];
const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];
const EXTRA_SIZES=['XS','3XL','4XL','LT','XLT','2XLT','3XLT'];
const SZ_ORD=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT','OSFA'];
const rQ=v=>Math.round(v*4)/4;
const showSz=(s,inv)=>{const c=['S','M','L','XL','2XL'];if(c.includes(s))return true;return!EXTRA_SIZES.includes(s)||(inv||0)>0};
const SP={bk:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],pr:{0:[50,60,70,null,null],1:[5,6.5,8,9,null],2:[3.5,4.5,6,7,8],3:[3.2,4.25,4.75,6,7.5],4:[2.95,3.85,4.25,5,6],5:[2.75,3.5,3.95,4.5,5.25],6:[2.5,3.2,3.7,4,4.75],7:[2.25,3,3.5,3.75,4.25],8:[2.1,2.85,3.1,3.3,4],9:[1.9,2.75,2.9,3.1,3.75]},mk:1.5,ub:0.15};
const EM={sb:[10000,15000,20000,999999],qb:[6,24,48,99999],pr:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],mk:1.6};
const NP={bk:[10,50,99999],co:[4,3,3],se:[7,6,5],tc:3};const DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];
function spP(q,c,s=true){const bi=SP.bk.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.pr[bi]?.[c-1];if(v==null)return 0;return s?v:rQ(v/SP.mk)}
function emP(st,q,s=true){const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.pr[si][qi];return s?v:rQ(v/EM.mk)}
function npP(q,tw=false,s=true){const bi=NP.bk.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.se[bi]+(tw?rQ(NP.tc*1.65):0)):(NP.co[bi]+(tw?NP.tc:0))}
function dP(d,q,artFiles,cq){
  const pq=cq||q;
  // Art-based decoration: get type from art file
  if(d.kind==='art'&&d.art_file_id&&artFiles){// Art TBD
    if(d.art_file_id==='__tbd'){const tType=d.art_tbd_type||'screen_print';
      if(tType==='screen_print'){const nc=d.tbd_colors||1;const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(pq,nc,true)*u),cost:rQ(spP(pq,nc,false)*u)}}
      if(tType==='embroidery')return{sell:d.sell_override||emP(d.tbd_stitches||8000,pq,true),cost:emP(d.tbd_stitches||8000,pq,false)};
      if(tType==='heat_press'||tType==='dtf'){const t=DTF[d.tbd_dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}};
      return{sell:d.sell_override||0,cost:0}}
    const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    if(art.deco_type==='screen_print'){const nc=art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1;const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(pq,nc,true)*u),cost:rQ(spP(pq,nc,false)*u)}}
    if(art.deco_type==='embroidery')return{sell:d.sell_override||emP(art.stitches||8000,pq,true),cost:emP(art.stitches||8000,pq,false)};
    if(art.deco_type==='dtf'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  // Legacy/fallback type-based
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(q,d.colors||1,true)*u),cost:rQ(spP(q,d.colors||1,false)*u)}}
  if(d.type==='embroidery')return{sell:d.sell_override||emP(d.stitches||8000,q,true),cost:emP(d.stitches||8000,q,false)};
  // Numbers
  if(d.kind==='numbers'||d.type==='number_press'){const hasRoster=d._showRoster&&d.roster&&Object.values(d.roster).flat().some(v=>v&&v.trim());const nq=hasRoster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:q;return{sell:d.sell_override||npP(nq||1,d.two_color,true),cost:npP(nq||1,d.two_color,false)}};
  if(d.kind==='names'){const nc=d.names?Object.values(d.names).flat().filter(v=>v&&v.trim()).length:0;const se=safeNum(d.sell_override||d.sell_each||6);const co=safeNum(d.cost_each||3);return{sell:nc>0?rQ(nc*se/q):se,cost:nc>0?rQ(nc*co/q):co}};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}
  // Outside decoration — user-entered cost/sell
  if(d.kind==='outside_deco')return{sell:d.sell_override||safeNum(d.sell_each),cost:safeNum(d.cost_each)};
  return{sell:0,cost:0}}
const SC={
  // SO statuses (5)
  need_order:{bg:'#fef3c7',c:'#92400e'},waiting_receive:{bg:'#dbeafe',c:'#1e40af'},items_received:{bg:'#d1fae5',c:'#065f46'},complete:{bg:'#dcfce7',c:'#166534'},in_production:{bg:'#ede9fe',c:'#6d28d9'},ready_to_invoice:{bg:'#fef0c7',c:'#c2410c'},
  // Job item statuses
  need_to_order:{bg:'#fef3c7',c:'#92400e'},partially_received:{bg:'#fef9c3',c:'#854d0e'},items_received:{bg:'#d1fae5',c:'#065f46'},
  // Job production statuses
  staging:{bg:'#fef3c7',c:'#92400e'},in_process:{bg:'#dbeafe',c:'#1e40af'},completed:{bg:'#dcfce7',c:'#166534'},shipped:{bg:'#ede9fe',c:'#6d28d9'},
  // Job art statuses
  needs_art:{bg:'#fef2f2',c:'#dc2626'},waiting_approval:{bg:'#fef3c7',c:'#92400e'},art_complete:{bg:'#dcfce7',c:'#166534'},
  // Legacy
  waiting_art:{bg:'#fef3c7',c:'#92400e'},in_production:{bg:'#dbeafe',c:'#1e40af'},ready_ship:{bg:'#dcfce7',c:'#166534'},
};

// SAFE ACCESSORS — defensive helpers to prevent crashes from missing/null data
const safe=(v,def)=>v!=null?v:def;
const safeArr=(v)=>Array.isArray(v)?v:[];
const safeObj=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const safeNum=(v)=>typeof v==='number'&&!isNaN(v)?v:0;
const safeStr=(v)=>typeof v==='string'?v:'';
const safeSizes=(it)=>safeObj(it?.sizes);
const safePicks=(it)=>safeArr(it?.pick_lines);
const safePOs=(it)=>safeArr(it?.po_lines);
const safeDecos=(it)=>safeArr(it?.decorations);
const safeItems=(o)=>safeArr(o?.items);
const safeArt=(o)=>safeArr(o?.art_files);
const safeJobs=(o)=>safeArr(o?.jobs);
// Build jobs from SO — uses existing jobs array, or auto-generates from decorations
const buildJobs=(o)=>{
  if(o?.jobs&&o.jobs.length>0)return o.jobs;
  // Auto-generate from art decorations on items
  const artMap={};
  safeItems(o).forEach((it,idx)=>{
    if(it.no_deco)return;// Skip blank items
    safeDecos(it).forEach((d,di)=>{
      if(d.kind!=='art'||!d.art_file_id)return;
      const key='art_'+d.art_file_id+'_'+d.position;
      if(!artMap[key])artMap[key]={art_file_id:d.art_file_id,position:d.position,deco_type:null,items:[]};
      artMap[key].items.push({item_idx:idx,deco_idx:di,sku:it.sku,name:safeStr(it.name),color:it.color||'',units:Object.values(safeSizes(it)).reduce((a,v)=>a+v,0),fulfilled:0});
      const af=safeArr(o?.art_files).find(f=>f.id===d.art_file_id);
      if(af){artMap[key].deco_type=af.deco_type;artMap[key].art_name=af.name;artMap[key].art_status=af.status==='approved'?'art_complete':af.status==='uploaded'?'waiting_approval':'needs_art'}
    });
  });
  const jobs=Object.entries(artMap).map(([key,v],idx)=>{
    const totalUnits=v.items.reduce((a,it)=>a+it.units,0);
    const positions=[...new Set(v.items.map(it=>{const d=safeDecos(safeItems(o)[it.item_idx])?.[it.deco_idx];return d?.position||''}).filter(Boolean))].join(', ');
    return{id:o.id.replace('SO-','JOB-')+'-'+(idx+1<10?'0':'')+(idx+1),key,art_file_id:v.art_file_id,
      art_name:v.art_name||'Unnamed',deco_type:v.deco_type||'screen_print',positions,
      art_status:v.art_status||'needs_art',item_status:'need_to_order',prod_status:'hold',
      total_units:totalUnits,fulfilled_units:0,split_from:null,created_at:o.created_at?.split(' ')[0]||'',
      items:v.items,_auto:true};
  });
  return jobs;
};
// Check if a job is ready for production: art approved, prod files exist, items received
const isJobReady=(j,o)=>{
  // Art must be approved
  if(j.art_status!=='art_complete')return false;
  // Check prod files exist for this art
  const af=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);
  if(af&&(af.prod_files||[]).length===0)return false;
  // Check items are received (picked or PO received) for this job's items
  let totalSz=0,fulfilledSz=0;
  (j.items||[]).forEach(gi=>{
    const it=safeItems(o)[gi.item_idx];if(!it)return;
    Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{
      totalSz+=v;
      const picked=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const rcvd=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
      fulfilledSz+=Math.min(v,picked+rcvd);
    });
  });
  return totalSz>0&&fulfilledSz>=totalSz;
};
const safeFirm=(o)=>safeArr(o?.firm_dates);

// DATA
const D_C=[
{id:'c1',parent_id:null,name:'Orange Lutheran High School',alpha_tag:'OLu',contacts:[{name:'Athletic Director',email:'athletics@orangelutheran.org',phone:'714-555-0100',role:'Athletic Director'},{name:'Janet Wu',email:'jwu@orangelutheran.org',phone:'714-555-0109',role:'Accounting'}],billing_address_line1:'2222 N Santiago Blvd',billing_city:'Orange',billing_state:'CA',billing_zip:'92867',shipping_address_line1:'2222 N Santiago Blvd',shipping_city:'Orange',shipping_state:'CA',shipping_zip:'92867',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.0775,primary_rep_id:'r1',is_active:true,_oe:1,_os:2,_oi:1,_ob:4200},
{id:'c1a',parent_id:'c1',name:'OLu Baseball',alpha_tag:'OLuB',contacts:[{name:'Coach Martinez',email:'martinez@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_address_line1:'2222 N Santiago Blvd - Field House',shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:0,_os:1,_oi:1,_ob:4200},
{id:'c1b',parent_id:'c1',name:'OLu Football',alpha_tag:'OLuF',contacts:[{name:'Coach Davis',email:'davis@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_address_line1:'2222 N Santiago Blvd - Athletics',shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:1,_os:1,_oi:0,_ob:0},
{id:'c1c',parent_id:'c1',name:'OLu Track & Field',alpha_tag:'OLuT',contacts:[{name:'Coach Chen',email:'chen@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:0,_os:0,_oi:0,_ob:0},
{id:'c2',parent_id:null,name:'St. Francis High School',alpha_tag:'SF',contacts:[{name:'AD Office',email:'ad@stfrancis.edu',phone:'818-555-0200',role:'Athletic Director'}],billing_city:'La Canada',billing_state:'CA',shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.095,primary_rep_id:'r4',is_active:true,_oe:0,_os:1,_oi:2,_ob:6800},
{id:'c2a',parent_id:'c2',name:'St. Francis Lacrosse',alpha_tag:'SFL',contacts:[{name:'Coach Resch',email:'resch@stfrancis.edu',phone:'',role:'Head Coach'}],shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r4',is_active:true,_oe:0,_os:1,_oi:2,_ob:6800},
{id:'c3',parent_id:null,name:'Clovis Unified School District',alpha_tag:'CUSD',contacts:[{name:'District Office',email:'purchasing@clovisusd.k12.ca.us',phone:'559-555-0300',role:'Primary'}],billing_city:'Clovis',billing_state:'CA',shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',tax_rate:0.0863,primary_rep_id:'r5',is_active:true,_oe:2,_os:0,_oi:0,_ob:0},
{id:'c3a',parent_id:'c3',name:'Clovis High Badminton',alpha_tag:'CHBad',contacts:[{name:'Coach Kim',email:'kim@clovisusd.k12.ca.us',phone:'',role:'Head Coach'}],shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',primary_rep_id:'r5',is_active:true,_oe:2,_os:0,_oi:0,_ob:0},
];
const BATCH_VENDORS={'sss':{name:'S&S Activewear',threshold:200},'sanmar':{name:'SanMar',threshold:200},'richardson':{name:'Richardson',threshold:200},'momentec':{name:'Momentec',threshold:200},'a4':{name:'A4',threshold:200}};
const MACHINES=[
  {id:'auto_press',name:'Auto Press',type:'screen_print'},
  {id:'manual_press',name:'Manual Press',type:'screen_print'},
  {id:'dtf_printer',name:'DTF Printer',type:'dtf'},
  {id:'heat_press_1',name:'Heat Press 1',type:'heat_transfer'},
  {id:'heat_press_2',name:'Heat Press 2',type:'heat_transfer'},
  {id:'emb_1',name:'Embroidery Head 1',type:'embroidery'},
  {id:'emb_2',name:'Embroidery Head 2',type:'embroidery'},
];
const D_V=[
{id:'v1',name:'Adidas',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamorders@adidas.com',contact_phone:'800-448-1796',rep_name:'Sarah Johnson',payment_terms:'net60',notes:'Team dealer program.',_oi:3,_it:12450,_ac:4200,_a3:5250,_a6:3000,_a9:0},
{id:'v2',name:'Under Armour',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamdealer@underarmour.com',rep_name:'Mike Daniels',payment_terms:'net60',_oi:2,_it:8200,_ac:5200,_a3:3000,_a6:0,_a9:0},
{id:'v3',name:'SanMar',vendor_type:'api',api_provider:'sanmar',nsa_carries_inventory:false,is_active:true,contact_email:'orders@sanmar.com',payment_terms:'net30',_oi:1,_it:2100,_ac:2100,_a3:0,_a6:0,_a9:0},
{id:'v4',name:'S&S Activewear',vendor_type:'api',api_provider:'ss_activewear',nsa_carries_inventory:false,is_active:true,contact_email:'service@ssactivewear.com',payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v5',name:'Richardson',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v6',name:'Rawlings',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v7',name:'Badger',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
];
const D_P=[
{id:'p1',vendor_id:'v1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',category:'Tees',retail_price:55.5,nsa_cost:18.5,available_sizes:['XS','S','M','L','XL','2XL'],is_active:true,_inv:{XS:0,S:7,M:0,L:0,XL:0,'2XL':0},_alerts:{S:15,M:15,L:10,XL:8,'2XL':5,'3XL':1}},
{id:'p2',vendor_id:'v1',sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',category:'Hoodies',retail_price:85,nsa_cost:28.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:3,M:6,L:4,XL:2,'2XL':0},_alerts:{S:5,M:8,L:6,XL:4}},
{id:'p4',vendor_id:'v2',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',category:'Polos',retail_price:65,nsa_cost:22,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:10,L:15,XL:12,'2XL':8}},
{id:'p5',vendor_id:'v3',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',category:'Tees',retail_price:8.98,nsa_cost:2.85,available_sizes:['S','M','L','XL','2XL','3XL'],is_active:true,_inv:{S:20,M:15,L:10,XL:5,'2XL':0,'3XL':0},_colors:['Jet Black','Navy','Red','White','Athletic Heather','Royal','Forest Green','Charcoal']},
{id:'p6',vendor_id:'v3',sku:'K500',name:'Port Authority Silk Touch Polo',brand:'Port Authority',color:'Navy',category:'Polos',retail_price:22.98,nsa_cost:8.2,available_sizes:['XS','S','M','L','XL','2XL','3XL','4XL'],is_active:true,_inv:{},_colors:['Navy','Black','White','Red','Royal','Dark Green']},
{id:'p7',vendor_id:'v5',sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',category:'Hats',retail_price:12,nsa_cost:4.5,available_sizes:['OSFA'],is_active:true,_inv:{OSFA:30},_colors:['Black/White','Navy/White','Red/White']},
{id:'p8',vendor_id:'v1',sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',category:'1/4 Zips',retail_price:75,nsa_cost:25,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:2,M:7,L:9,XL:5,'2XL':1}},
{id:'p9',vendor_id:'v2',sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',category:'Shorts',retail_price:45,nsa_cost:15.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:4,L:6,XL:3,'2XL':0}},
];
const D_E=[
{id:'EST-2089',customer_id:'c1b',memo:'Spring 2026 Football Camp Tees',status:'sent',created_by:'r1',created_at:'02/10/26 9:15 AM',updated_at:'02/10/26 2:30 PM',default_markup:1.65,shipping_type:'pct',shipping_value:8,ship_to_id:'default',email_status:'opened',email_opened_at:'02/10/26 3:45 PM',art_files:[],items:[{product_id:'p5',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,sizes:{S:8,M:15,L:20,XL:12,'2XL':5},available_sizes:['S','M','L','XL','2XL','3XL'],_colors:['Jet Black','Navy','Red','White'],decorations:[{kind:'art',position:'Front Center',art_file_id:null,sell_override:null},{kind:'art',position:'Back Center',art_file_id:null,sell_override:null}]}]},
{id:'EST-2094',customer_id:'c1b',memo:'Football Coaches Polos',status:'approved',created_by:'r1',created_at:'02/16/26 10:00 AM',updated_at:'02/16/26 10:00 AM',default_markup:1.65,shipping_type:'flat',shipping_value:25,ship_to_id:'default',email_status:'viewed',email_opened_at:'02/16/26 11:30 AM',email_viewed_at:'02/16/26 11:32 AM',art_files:[],items:[{product_id:'p4',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,sizes:{M:2,L:3,XL:2,'2XL':1},available_sizes:['S','M','L','XL','2XL'],decorations:[{kind:'art',position:'Left Chest',art_file_id:null,sell_override:null}]}]},
{id:'EST-2101',customer_id:'c3a',memo:'Badminton Team Uniforms',status:'draft',created_by:'r5',created_at:'02/12/26 3:00 PM',updated_at:'02/12/26 3:00 PM',default_markup:1.65,shipping_type:'pct',shipping_value:0,ship_to_id:'default',email_status:null,art_files:[],items:[]},
];
const D_SO=[
// SO-1042: Baseball — FULLY IN PRODUCTION. All items ordered/received, art approved, prod files done, jobs on board in process
{id:'SO-1042',customer_id:'c1a',estimate_id:'EST-2088',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26',expected_date:'2026-03-15',production_notes:'Rush - coach needs by spring break',shipping_type:'flat',shipping_value:45,ship_to_id:'default',firm_dates:[{item_desc:'JX4453 - Adidas Pregame Tee',date:'03/01/26',approved:true}],
  art_files:[{id:'af1',name:'OLu Baseball Front Logo',deco_type:'screen_print',ink_colors:'Navy, Gold, White',thread_colors:'',art_size:'12" x 4"',files:[],mockup_files:['OLu_Baseball_Logo_v3.pdf','OLu_Baseball_Mockup_Jersey.png'],prod_files:['OLu_Baseball_Logo_v3.ai','OLu_Baseball_Seps_3color.ai'],notes:'Final approved - navy/gold',status:'approved',uploaded:'02/10/26'},
    {id:'af2',name:'Sleeve Logo Small',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, Gold',art_size:'2" wide',files:[],mockup_files:['OLu_Sleeve_Logo.pdf'],prod_files:['OLu_Sleeve_Logo.dst','OLu_Sleeve_ThreadChart.pdf'],notes:'Small sleeve crest',status:'approved',uploaded:'02/11/26'}],
  items:[
    {sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',nsa_cost:18.5,retail_price:55.5,unit_sell:33.3,product_id:'p1',
      sizes:{S:5,M:20,L:15,XL:8,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[
        {pick_id:'IF-4100',S:5,M:8,L:5,XL:3,status:'pulled',created_at:'02/10/26',memo:'First pull — in-stock sizes',ship_dest:'in_house'},
        {pick_id:'IF-4192',S:0,M:4,L:10,XL:5,'2XL':0,status:'pulled',created_at:'02/14/26',memo:'Second pull',ship_dest:'in_house'}
      ],
      po_lines:[
        {po_id:'PO-3001',S:0,M:0,L:0,XL:0,'2XL':3,received:{'2XL':3},shipments:[{date:'2026-02-19','2XL':3}],status:'received',created_at:'02/11/26',memo:'2XL from Adidas'},
        {po_id:'PO-3088',S:0,M:8,L:0,XL:0,'2XL':0,received:{M:8},shipments:[{date:'2026-02-18',M:8}],status:'received',created_at:'02/12/26',memo:'Rush restock M sizes'}
      ],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af1',sell_override:null},{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,sell_override:null,roster:[]}]},
    {sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',nsa_cost:28.5,retail_price:85,unit_sell:51,product_id:'p2',
      sizes:{S:2,M:4,L:3,XL:2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[{pick_id:'IF-4699',S:2,M:4,L:3,XL:2,status:'pulled',created_at:'02/16/26',memo:'Hoodies — blank ship to customer',ship_dest:'ship_customer',ship_addr:'default'}],
      po_lines:[],no_deco:true,
      decorations:[]},
    {sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,product_id:'p5',
      sizes:{S:10,M:15,L:10,XL:5},available_sizes:['S','M','L','XL','2XL','3XL'],
      pick_lines:[{pick_id:'IF-4327',S:10,M:15,L:10,XL:5,status:'pulled',created_at:'02/17/26',memo:'All PC61 in stock',ship_dest:'in_house'}],
      po_lines:[],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af1',sell_override:3.25}]}
  ],
  jobs:[
    {id:'JOB-1042-01',key:'art_af1_Front Center',art_file_id:'af1',art_name:'OLu Baseball Front Logo',deco_type:'screen_print',
      positions:'Front Center',art_status:'art_complete',item_status:'items_received',prod_status:'in_process',
      total_units:91,fulfilled_units:91,split_from:null,created_at:'02/10/26',
      assigned_machine:'auto_press',assigned_to:'Carlos',ship_method:'rep_delivery',
      items:[
        {item_idx:0,deco_idx:0,sku:'JX4453',name:'Adidas Unisex Pregame Tee',color:'Team Power Red/White',units:51,fulfilled:51},
        {item_idx:2,deco_idx:0,sku:'PC61',name:'Port & Company Essential Tee',color:'Jet Black',units:40,fulfilled:40},
      ]},
  ]},
// SO-1045: Football — WAITING TO RECEIVE. All items covered by POs/picks but not all received yet. Art not approved.
{id:'SO-1045',customer_id:'c1b',memo:'Football Spring Practice Gear',status:'waiting_receive',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26',expected_date:'2026-03-20',production_notes:'Need sizes confirmed by coach',shipping_type:'pct',shipping_value:8,ship_to_id:'default',firm_dates:[],
  art_files:[{id:'af4',name:'OLu Football Helmet Logo',deco_type:'screen_print',ink_colors:'Red, White',thread_colors:'',art_size:'10" x 8"',files:['OLu_Football.ai'],mockup_files:['OLu_Football_Mockup.pdf'],prod_files:[],notes:'Waiting coach approval',status:'uploaded',uploaded:'02/13/26'}],
  items:[
    {sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',nsa_cost:18.5,retail_price:55.5,unit_sell:33.3,product_id:'p1',
      sizes:{S:3,M:5,L:4,XL:2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[{pick_id:'IF-4200',S:3,M:5,L:4,XL:2,status:'pick',created_at:'02/15/26',memo:'Football pregame tees — stock pull'}],
      po_lines:[],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af4',sell_override:null}]},
    {sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',nsa_cost:25,retail_price:75,unit_sell:45,product_id:'p8',
      sizes:{S:2,M:6,L:8,XL:4,'2XL':2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],
      po_lines:[{po_id:'PO-3055',S:2,M:6,L:8,XL:4,'2XL':2,
        received:{S:2,M:6,L:8},
        cancelled:{XL:2},
        shipments:[{date:'2026-02-15',S:2,M:6,L:8}],
        status:'partial',created_at:'02/13/26',memo:'1/4 Zips order — Adidas direct'}],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af4',sell_override:null}]},
    {sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',nsa_cost:4.5,retail_price:12,unit_sell:8,product_id:'p7',
      sizes:{OSFA:20},available_sizes:['OSFA'],
      pick_lines:[{pick_id:'IF-4150',OSFA:20,status:'pulled',created_at:'02/14/26',memo:'Trucker caps — blank, no deco'}],
      po_lines:[],no_deco:true,
      decorations:[]}
  ]},
// SO-1051: Lacrosse — NEED TO ORDER. Nothing ordered yet. Art waiting approval.
{id:'SO-1051',customer_id:'c2a',memo:'Lacrosse Team Store',status:'need_order',created_by:'r4',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26',expected_date:'2026-03-10',production_notes:'Coach wants navy/silver colorway',shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:[],
  art_files:[{id:'af3',name:'SFL Lacrosse Crest',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, White, Silver 877',art_size:'3.5" wide',files:['SFL_Crest.eps','SFL_Crest_preview.png'],mockup_files:['SFL_Crest_Preview.pdf'],prod_files:[],notes:'',status:'uploaded',uploaded:'02/15/26'}],
  items:[
    {sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,product_id:'p4',
      sizes:{M:4,L:6,XL:4,'2XL':2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af3',sell_override:null},{kind:'numbers',position:'Upper Back',num_method:'heat_transfer',num_size:'3"',two_color:false,sell_override:null,roster:[]}]},
    {sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',nsa_cost:15.5,retail_price:45,unit_sell:27,product_id:'p9',
      sizes:{S:4,M:6,L:8,XL:4},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[],
      decorations:[]}
  ]},
// SO-1060: Badminton — empty order, NEED TO ORDER
{id:'SO-1060',customer_id:'c3a',memo:'Badminton Warm-ups',status:'need_order',created_by:'r5',created_at:'02/16/26 9:00 AM',updated_at:'02/16/26',expected_date:null,production_notes:'',shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:null,
  art_files:null,items:[]},
// SO-1061: Rush order — stress test, empty sizes
{id:'SO-1061',customer_id:'c1a',memo:'Rush Order - Coach Martinez',status:'need_order',created_by:'r4',created_at:'02/17/26 8:00 AM',updated_at:null,expected_date:'2026-02-28',production_notes:null,shipping_type:null,shipping_value:null,ship_to_id:null,firm_dates:[],
  art_files:[],items:[
    {sku:'JX4453',name:'Adidas Pregame Tee',brand:'Adidas',color:null,nsa_cost:null,retail_price:null,unit_sell:28,product_id:'p1',
      sizes:{},available_sizes:null,pick_lines:null,po_lines:null,decorations:null},
    {sku:'UNKNOWN_SKU',name:null,brand:null,color:'Red',nsa_cost:0,retail_price:0,unit_sell:0,product_id:null,
      sizes:{S:3,M:5},available_sizes:['S','M','L'],pick_lines:[],po_lines:[],decorations:[]},
  ]},
// SO-1062: Ghost customer — all items pulled → ITEMS RECEIVED (but no jobs, so will be items_received)
{id:'SO-1062',customer_id:'c_deleted',memo:'Ghost Customer Order',status:'items_received',created_by:'r99',created_at:'',updated_at:'',expected_date:'',production_notes:'',shipping_type:'pct',shipping_value:0,ship_to_id:'default',firm_dates:[],
  art_files:[],items:[
    {sku:'PC61',name:'Port Company Tee',brand:'Port Company',color:'White',nsa_cost:3.80,retail_price:null,unit_sell:12,product_id:'p3',
      sizes:{S:10,M:10,L:10},available_sizes:['S','M','L','XL'],
      pick_lines:[{pick_id:'IF-9999',status:'pulled',S:10,M:10,L:10,created_at:'02/17/26',memo:'Pulled all'}],
      po_lines:[],decorations:[{kind:'art',position:'Front Center',art_file_id:'af_missing',sell_override:null}]}
  ]},
// SO-1063: Track & Field — READY TO INVOICE. Jobs on board all completed. Partially received items but jobs done.
{id:'SO-1063',customer_id:'c2',memo:'Track & Field Gear',status:'ready_to_invoice',created_by:'r1',created_at:'02/15/26 4:00 PM',updated_at:'02/15/26',expected_date:'2026-04-01',production_notes:'Long lead time on custom colors',shipping_type:'flat',shipping_value:25,ship_to_id:'default',firm_dates:[{item_desc:'Full Order',date:'03/20/26',approved:false,requested_by:'r1',requested_at:'02/16/26',note:'Meet is April 5'}],
  art_files:[{id:'af_tf1',name:'SFL Track Logo',deco_type:'screen_print',ink_colors:'Navy, Gold',thread_colors:'',art_size:'10" wide',files:[],mockup_files:['SFL_Track_Mockup.pdf'],prod_files:['SFL_Track_Seps.ai'],notes:'',status:'approved',uploaded:'02/15/26'}],
  items:[
    {sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Navy/Gold',nsa_cost:22,retail_price:65,unit_sell:42,product_id:'p4',
      sizes:{S:5,M:8,L:10,XL:6,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[{pick_id:'IF-4500',S:5,M:8,L:10,XL:6,'2XL':3,status:'pulled',created_at:'02/18/26',memo:'All polos pulled'}],
      po_lines:[],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af_tf1',sell_override:null}]},
    {sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Navy',nsa_cost:15.5,retail_price:45,unit_sell:29,product_id:'p9',
      sizes:{S:5,M:8,L:10,XL:6,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[{pick_id:'IF-4501',S:5,M:8,L:10,XL:6,'2XL':3,status:'pulled',created_at:'02/18/26',memo:'All shorts pulled'}],
      po_lines:[],
      decorations:[{kind:'art',position:'Left Leg',art_file_id:'af_tf1',sell_override:3}]}
  ],
  jobs:[
    {id:'JOB-1063-01',key:'art_af_tf1',art_file_id:'af_tf1',art_name:'SFL Track Logo',deco_type:'screen_print',
      positions:'Left Chest, Left Leg',art_status:'art_complete',item_status:'items_received',prod_status:'completed',
      total_units:64,fulfilled_units:64,split_from:null,created_at:'02/16/26',
      assigned_machine:'auto_press',assigned_to:'Mike',ship_method:'ship_customer',
      items:[
        {item_idx:0,deco_idx:0,sku:'1370399',name:'Under Armour Team Polo',color:'Navy/Gold',units:32,fulfilled:32},
        {item_idx:1,deco_idx:0,sku:'1376844',name:'Under Armour Tech Short',color:'Navy',units:32,fulfilled:32},
      ]},
  ]},
];
const D_MSG=[
{id:'m1',so_id:'SO-1042',author_id:'r1',text:'Coach Martinez confirmed navy/gold for front logo. Approved the proof.',ts:'02/10/26 11:30 AM',read_by:['r1','r2']},
{id:'m2',so_id:'SO-1042',author_id:'r5',text:'Warehouse: we have 30 of JX4453 in stock, rest need to be ordered from Adidas.',ts:'02/11/26 9:15 AM',read_by:['r5']},
{id:'m3',so_id:'SO-1042',author_id:'r1',text:'PO placed with Adidas for remaining sizes. Expected 02/20.',ts:'02/11/26 2:00 PM',read_by:['r1']},
{id:'m4',so_id:'SO-1042',author_id:'r4',text:'@Steve - coach called, needs jerseys by 3/10 not 3/15. Can we rush?',ts:'02/14/26 10:00 AM',read_by:['r4']},
{id:'m5',so_id:'SO-1042',author_id:'r1',text:'Updated expected date. Adidas confirmed they can expedite.',ts:'02/14/26 11:30 AM',read_by:['r1']},
{id:'m6',so_id:'SO-1045',author_id:'r1',text:'Waiting on Coach Davis for logo approval. Sent follow-up email.',ts:'02/13/26 3:00 PM',read_by:['r1']},
{id:'m7',so_id:'SO-1051',author_id:'r4',text:'Crest file from coach is low-res. Need vector version.',ts:'02/15/26 11:00 AM',read_by:['r4']},
{id:'m8',so_id:'SO-1063',author_id:'r1',text:'UA says custom navy/gold will ship 3/1. Backordered on XL and 2XL.',ts:'02/16/26 4:30 PM',read_by:['r1']},
{id:'m9',so_id:'SO-1062',author_id:'r99',text:'This message is from a deleted rep — should still render.',ts:'02/17/26 9:00 AM',read_by:[]},
];
const D_INV=[
  {id:'INV-1042',type:'invoice',customer_id:'c1a',so_id:'SO-1042',date:'02/10/26',due_date:'03/12/26',total:2765,paid:0,memo:'Baseball Spring Season Full Package',status:'open',payments:[],cc_fee:0},
  {id:'INV-1038',type:'invoice',customer_id:'c2a',so_id:'SO-1051',date:'01/28/26',due_date:'02/27/26',total:3400,paid:0,memo:'Lacrosse Preseason',status:'open',payments:[],cc_fee:0},
  {id:'INV-1039',type:'invoice',customer_id:'c2a',so_id:null,date:'02/01/26',due_date:'03/03/26',total:3400,paid:3400,memo:'Lacrosse Batch 1',status:'paid',payments:[{amount:3400,method:'check',ref:'Check #4521',date:'02/15/26'}],cc_fee:0},
  {id:'INV-1050',type:'invoice',customer_id:'c1a',so_id:'SO-1042',date:'01/15/26',due_date:'02/14/26',total:1500,paid:1500,memo:'Baseball Deposit — 50%',status:'paid',payments:[{amount:1500,method:'cc',ref:'Visa ending 4242',date:'01/20/26'}],cc_fee:43.50},
  {id:'INV-1055',type:'invoice',customer_id:'c2',so_id:'SO-1063',date:'02/15/26',due_date:'03/17/26',total:2856,paid:0,memo:'Track & Field Gear',status:'open',payments:[],cc_fee:0},
  {id:'INV-1060',type:'invoice',customer_id:'c3a',so_id:null,date:'12/15/25',due_date:'01/14/26',total:980,paid:0,memo:'Badminton Fall Order — OVERDUE',status:'open',payments:[],cc_fee:0},
  {id:'INV-1061',type:'invoice',customer_id:'c1b',so_id:'SO-1045',date:'02/12/26',due_date:'03/14/26',total:1890,paid:945,memo:'Football Practice Gear — Partial',status:'partial',payments:[{amount:945,method:'venmo',ref:'@OLu-Athletics',date:'02/20/26'}],cc_fee:0},
];

// OMG TEAM STORES DEMO DATA
const D_OMG=[
  {id:'OMG-1001',store_name:'OLu Baseball Spring 2026',customer_id:'c1a',rep_id:'r1',status:'closed',open_date:'01/15/26',close_date:'02/10/26',
    orders:12,total_sales:4250,fundraise_total:425,items_sold:87,unique_buyers:12,
    products:[
      {sku:'JX4453',name:'Adidas Pregame Tee',color:'Team Power Red/White',retail:32,cost:18.50,deco_type:'screen_print',deco_cost:3,sizes:{S:3,M:8,L:12,XL:10,'2XL':4}},
      {sku:'HF7245',name:'Adidas Team Issue Hoodie',color:'Team Power Red/White',retail:65,cost:28.50,deco_type:'screen_print',deco_cost:5,sizes:{S:2,M:5,L:8,XL:6,'2XL':3}},
      {sku:'112',name:'Richardson Trucker Cap',color:'Red/White',retail:25,cost:4.50,deco_type:'embroidery',deco_cost:6,sizes:{OSFA:26}}
    ]},
  {id:'OMG-1002',store_name:'St. Francis Football Fan Shop',customer_id:'c2',rep_id:'r4',status:'open',open_date:'02/01/26',close_date:'03/01/26',
    orders:8,total_sales:2890,fundraise_total:289,items_sold:54,unique_buyers:8,
    products:[
      {sku:'PC61',name:'Port & Company Essential Tee',color:'Navy',retail:18,cost:2.85,deco_type:'screen_print',deco_cost:3,sizes:{S:4,M:10,L:12,XL:8,'2XL':3}},
      {sku:'K500',name:'Port Authority Silk Touch Polo',color:'Navy',retail:35,cost:8.20,deco_type:'embroidery',deco_cost:8,sizes:{M:2,L:4,XL:3,'2XL':2}},
      {sku:'112',name:'Richardson Trucker Cap',color:'Navy/White',retail:25,cost:4.50,deco_type:'embroidery',deco_cost:6,sizes:{OSFA:6}}
    ]},
  {id:'OMG-1003',store_name:'OLu Football Booster Store',customer_id:'c1b',rep_id:'r1',status:'closed',open_date:'01/20/26',close_date:'02/15/26',
    orders:18,total_sales:6720,fundraise_total:672,items_sold:142,unique_buyers:18,
    products:[
      {sku:'JX4453',name:'Adidas Pregame Tee',color:'Navy/White',retail:32,cost:18.50,deco_type:'screen_print',deco_cost:3,sizes:{S:5,M:15,L:22,XL:18,'2XL':8}},
      {sku:'EK0100',name:'Adidas Team 1/4 Zip',color:'Team Navy/White',retail:55,cost:25,deco_type:'embroidery',deco_cost:8,sizes:{S:3,M:8,L:12,XL:10,'2XL':5}},
      {sku:'1376844',name:'Under Armour Tech Short',color:'Navy',retail:32,cost:15.50,deco_type:'screen_print',deco_cost:3,sizes:{S:2,M:6,L:10,XL:8,'2XL':4}},
      {sku:'112',name:'Richardson Trucker Cap',color:'Navy/White',retail:25,cost:4.50,deco_type:'embroidery',deco_cost:6,sizes:{OSFA:6}}
    ]},
  {id:'OMG-1004',store_name:'Clovis Badminton Fundraiser',customer_id:'c3a',rep_id:'r5',status:'open',open_date:'02/10/26',close_date:'03/10/26',
    orders:3,total_sales:480,fundraise_total:48,items_sold:9,unique_buyers:3,
    products:[
      {sku:'PC61',name:'Port & Company Essential Tee',color:'Black',retail:18,cost:2.85,deco_type:'screen_print',deco_cost:3,sizes:{M:3,L:3,XL:3}}
    ]},
  {id:'OMG-1005',store_name:'OLu Track & Field Store',customer_id:'c1c',rep_id:'r1',status:'draft',open_date:'',close_date:'',
    orders:0,total_sales:0,fundraise_total:0,items_sold:0,unique_buyers:0,products:[]},
];

// SHARED UI
function Toast({msg,type='success'}){if(!msg)return null;return<div className={`toast toast-${type}`}>{msg}</div>}
function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}
function SearchSelect({options,value,onChange,placeholder}){const[open,setOpen]=useState(false);const[q,setQ]=useState('');const f=options.filter(o=>o.label.toLowerCase().includes(q.toLowerCase()));const sel=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}><span style={{flex:1,color:sel?'#0f172a':'#94a3b8'}}>{sel?sel.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}><div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {f.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}{f.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}</div>}</div>)}
function Bg({options,value,onChange}){return<div style={{display:'flex',gap:2,flexWrap:'wrap'}}>{options.map(o=><button key={o.value} className={`btn btn-sm ${String(value)===String(o.value)?'btn-primary':'btn-secondary'}`} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}
function $In({value,onChange,w=70}){const[raw,setRaw]=React.useState(String(value));React.useEffect(()=>{if(parseFloat(raw)!==value)setRaw(String(value))},[value]);return<span style={{display:'inline-flex',alignItems:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'2px 6px',background:'white'}}><span style={{fontSize:14,fontWeight:700,color:'#166534'}}>$</span><input value={raw} onChange={e=>{const v=e.target.value;setRaw(v);if(v===''||v==='.'){onChange(0);return}if(/^-?\d*\.?\d*$/.test(v)){const n=parseFloat(v);if(!isNaN(n))onChange(n)}}} onBlur={()=>{const n=parseFloat(raw)||0;setRaw(String(n));onChange(n)}} style={{width:w,border:'none',outline:'none',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center',background:'transparent'}}/></span>}
function EmailBadge({e}){if(!e.email_status)return null;const s=e.email_status;return<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,padding:'2px 8px',borderRadius:10,background:s==='sent'?'#fef3c7':s==='opened'?'#dbeafe':'#dcfce7',color:s==='sent'?'#92400e':s==='opened'?'#1e40af':'#166534'}}>{s==='sent'?'✉️ Sent':s==='opened'?`👁️ Opened ${e.email_opened_at||''}`:`🔗 Viewed`}</span>}
function getAddrs(cu,all){const a=[];const add=(c,l)=>{if(c.shipping_address_line1||c.shipping_city)a.push({id:c.id,label:`${l}: ${c.shipping_address_line1||''} ${c.shipping_city||''}, ${c.shipping_state||''}`.trim(),addr:`${c.shipping_address_line1||''} ${c.shipping_city||''}, ${c.shipping_state||''}`.trim()})};
  if(!cu)return a;add(cu,'Default');if(cu.parent_id){const par=all.find(x=>x.id===cu.parent_id);if(par){add(par,par.alpha_tag);all.filter(c=>c.parent_id===par.id&&c.id!==cu.id).forEach(s=>add(s,s.alpha_tag))}}
  else{all.filter(c=>c.parent_id===cu.id).forEach(s=>add(s,s.alpha_tag))}return a}

// SEND ESTIMATE MODAL
function SendModal({isOpen,onClose,estimate,customer,onSend}){
  const[body,setBody]=useState('');const[attachments,setAttachments]=useState([]);
  React.useEffect(()=>{if(isOpen&&customer){setBody(`Hi ${(customer.contacts||[])[0]?.name||'Coach'},\n\nPlease find the attached estimate for ${estimate?.memo||'your order'}. You can view and approve it through your portal.\n\nPortal link: https://nsa-portal.netlify.app/portal/${customer.alpha_tag}\n\nLet me know if you have any questions!\n\nSteve Peterson\nNational Sports Apparel`);setAttachments([])}},[isOpen,customer,estimate]);
  if(!isOpen)return null;const emails=(customer?.contacts||[]).map(c=>c.email).filter(Boolean);
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
    <div className="modal-header"><h2>Send Estimate to Coach</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body">
      <div style={{marginBottom:12}}><label className="form-label">To</label><div style={{fontSize:13,padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>{emails.join(', ')||'No email on file'}</div></div>
      <div style={{marginBottom:12}}><label className="form-label">Subject</label><input className="form-input" value={`Estimate ${estimate?.id} - ${estimate?.memo||''}`} readOnly style={{color:'#64748b'}}/></div>
      <div style={{marginBottom:12}}><label className="form-label">Message</label><textarea className="form-input" rows={8} value={body} onChange={e=>setBody(e.target.value)} style={{fontFamily:'inherit',resize:'vertical'}}/></div>
      <div style={{marginBottom:12}}><label className="form-label">Attachments</label>
        <div style={{border:'2px dashed #d1d5db',borderRadius:8,padding:16,textAlign:'center',cursor:'pointer',background:'#fafafa'}} onClick={()=>setAttachments(a=>[...a,{name:`item_photo_${a.length+1}.jpg`,size:'245 KB'}])}>
          <Icon name="upload" size={20}/><div style={{fontSize:12,color:'#64748b',marginTop:4}}>Drag & drop files here or click to browse</div>
          <div style={{fontSize:10,color:'#94a3b8'}}>Include product photos, mockups, or other files for the coach</div></div>
        {attachments.length>0&&<div style={{marginTop:8}}>{attachments.map((f,i)=><div key={i} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 8px',background:'#f0fdf4',borderRadius:4,marginBottom:4}}>
          <Icon name="file" size={14}/><span style={{fontSize:12,flex:1}}>{f.name}</span><span style={{fontSize:10,color:'#94a3b8'}}>{f.size}</span>
          <button onClick={()=>setAttachments(a=>a.filter((_,x)=>x!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={12}/></button></div>)}</div>}
      </div>
      <div style={{padding:8,background:'#dbeafe',borderRadius:6,fontSize:11,color:'#1e40af'}}>📎 Estimate PDF will be auto-attached | 🔗 Portal link included in message</div>
    </div>
    <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{onSend();onClose()}}><Icon name="send" size={14}/> Send Estimate</button></div>
  </div></div>);
}

// UNIFIED ORDER EDITOR
// Auto-calculate SO status from items
function calcSOStatus(ord){
  // Fully automatic SO status based on item + job state
  let totalSz=0,coveredSz=0,fulfilledSz=0;
  safeItems(ord).forEach(it=>{
    Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
      totalSz+=v;
      const picked=safePicks(it).reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const poOrd=safePOs(it).reduce((a,pk)=>a+safeNum(pk[sz])-safeNum((pk.cancelled||{})[sz]),0);
      coveredSz+=Math.min(v,picked+poOrd);
      const pulledQty=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const rcvdQty=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
      fulfilledSz+=Math.min(v,pulledQty+rcvdQty);
    });
  });
  if(totalSz===0)return'need_order';
  // Check jobs on the board
  const boardJobs=safeJobs(ord);
  const hasJobs=boardJobs.length>0;
  const allJobsShipped=hasJobs&&boardJobs.every(j=>j.prod_status==='shipped');
  const allJobsDone=hasJobs&&boardJobs.every(j=>j.prod_status==='completed'||j.prod_status==='shipped');
  const anyJobActive=hasJobs&&boardJobs.some(j=>j.prod_status==='staging'||j.prod_status==='in_process');
  // Check if SO has any deco at all
  const hasAnyDeco=safeItems(ord).some(it=>!it.no_deco&&safeDecos(it).length>0);
  // If all jobs shipped → complete
  if(allJobsShipped)return'complete';
  // No-deco orders: all items fulfilled → ready_to_invoice (or complete if manually set)
  if(!hasAnyDeco&&!hasJobs&&fulfilledSz>=totalSz)return ord.status==='complete'?'complete':'ready_to_invoice';
  // If all jobs completed → ready to invoice
  if(allJobsDone)return'ready_to_invoice';
  // If any job in staging or in_process → in production
  if(anyJobActive)return'in_production';
  // If all items received → items_received
  if(fulfilledSz>=totalSz)return'items_received';
  // If all items covered (ordered/picked) but not all received → waiting
  if(coveredSz>=totalSz)return'waiting_receive';
  // Otherwise still need to order
  return'need_order';
}

// ═══════════════════════════════════════════════
// LOGIN GATE — PIN-based authentication
// ═══════════════════════════════════════════════
function LoginGate({onLogin}){
  const[selUser,setSelUser]=useState(null);
  const[pin,setPin]=useState('');
  const[error,setError]=useState('');
  const[shake,setShake]=useState(false);

  const tryLogin=()=>{
    if(!selUser)return;
    const user=REPS.find(r=>r.id===selUser);
    if(user&&user.pin===pin){onLogin(user)}
    else{setError('Incorrect PIN');setShake(true);setPin('');setTimeout(()=>setShake(false),500)}
  };

  return(
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <div style={{width:380,padding:0}}>
        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{fontSize:48,fontWeight:900,color:'white',letterSpacing:-2}}>NSA</div>
          <div style={{fontSize:13,color:'#94a3b8',letterSpacing:3,textTransform:'uppercase'}}>Portal</div>
        </div>

        {/* Login Card */}
        <div style={{background:'white',borderRadius:16,padding:32,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
          {!selUser?<>
            <div style={{fontSize:14,fontWeight:700,color:'#1e293b',marginBottom:16}}>Who's logging in?</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {REPS.map(r=>{
                const roleColors={admin:'#1e40af',gm:'#7c3aed',production:'#d97706',rep:'#166534'};
                const roleLabels={admin:'Admin',gm:'General Manager',production:'Production',rep:'Sales Rep'};
                return<button key={r.id} onClick={()=>{setSelUser(r.id);setPin('');setError('')}}
                  style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',border:'1px solid #e2e8f0',
                    borderRadius:10,background:'white',cursor:'pointer',transition:'all 0.15s',textAlign:'left'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='#f8fafc';e.currentTarget.style.borderColor='#3b82f6'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e2e8f0'}}>
                  <div style={{width:40,height:40,borderRadius:20,background:roleColors[r.role]||'#475569',color:'white',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:800,flexShrink:0}}>
                    {r.name[0]}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>{r.name}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{roleLabels[r.role]||r.role}</div>
                  </div>
                </button>})}
            </div>
          </>:<>
            {/* PIN Entry */}
            <div style={{textAlign:'center'}}>
              <button onClick={()=>{setSelUser(null);setPin('');setError('')}} style={{background:'none',border:'none',cursor:'pointer',
                color:'#64748b',fontSize:11,marginBottom:12}}>← Back to user list</button>
              <div style={{width:56,height:56,borderRadius:28,background:'#1e40af',color:'white',
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,fontWeight:800,margin:'0 auto 8px'}}>
                {REPS.find(r=>r.id===selUser)?.name[0]}</div>
              <div style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:4}}>{REPS.find(r=>r.id===selUser)?.name}</div>
              <div style={{fontSize:12,color:'#64748b',marginBottom:20}}>Enter your 4-digit PIN</div>

              <div style={{display:'flex',justifyContent:'center',gap:10,marginBottom:16,
                animation:shake?'shake 0.3s ease':'none'}}>
                {[0,1,2,3].map(i=><div key={i} style={{width:44,height:52,borderRadius:10,
                  border:'2px solid '+(pin.length>i?'#3b82f6':'#d1d5db'),
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:20,fontWeight:800,color:'#0f172a',
                  background:pin.length>i?'#eff6ff':'white',
                  transition:'all 0.15s'}}>{pin[i]?'●':''}</div>)}
              </div>

              {error&&<div style={{color:'#dc2626',fontSize:12,fontWeight:600,marginBottom:12}}>{error}</div>}

              {/* Number pad */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,maxWidth:240,margin:'0 auto'}}>
                {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((n,i)=>{
                  if(n==='')return<div key={i}/>;
                  return<button key={i} onClick={()=>{
                    if(n==='⌫'){setPin(p=>p.slice(0,-1));setError('')}
                    else if(pin.length<4){
                      const np=pin+n;setPin(np);setError('');
                      if(np.length===4){
                        const user=REPS.find(r=>r.id===selUser);
                        if(user&&user.pin===np)setTimeout(()=>onLogin(user),200);
                        else{setError('Incorrect PIN');setShake(true);setTimeout(()=>{setShake(false);setPin('')},500)}
                      }
                    }
                  }} style={{padding:'14px 0',borderRadius:10,border:'1px solid #e2e8f0',background:'white',
                    fontSize:18,fontWeight:700,cursor:'pointer',color:'#0f172a',transition:'all 0.1s'}}
                  onMouseDown={e=>{e.currentTarget.style.background='#f1f5f9'}}
                  onMouseUp={e=>{e.currentTarget.style.background='white'}}>{n}</button>})}
              </div>
            </div>
          </>}
        </div>

        <div style={{textAlign:'center',marginTop:20,fontSize:10,color:'#475569'}}>
          {NSA.name} · {NSA.fullAddr}
        </div>
      </div>

      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

function OrderEditor({order,mode,customer:ic,allCustomers,products,onSave,onBack,onConvertSO,cu,nf,msgs,onMsg,dirtyRef,onAdjustInv,allOrders,onInv,batchPOs,onBatchPO,initTab,onNavCustomer,onNewEstimate,scrollToItem}){
  const isE=mode==='estimate';const isSO=mode==='so';
  const[o,setO]=useState(order);const[cust,setCust]=useState(ic);const[pS,setPS]=useState('');const[showAdd,setShowAdd]=useState(false);
  const[tab,setTab]=useState(initTab||'items');const[dirty,setDirty]=useState(false);const[selJob,setSelJob]=useState(null);const[jobNote,setJobNote]=useState('');const[msgDept,setMsgDept]=useState('all');
    React.useEffect(()=>{if(initTab)setTab(initTab)},[initTab]);
    React.useEffect(()=>{if(scrollToItem!=null){setTab('items');setTimeout(()=>{const el=document.getElementById('so-item-'+scrollToItem);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #3b82f6';setTimeout(()=>{el.style.boxShadow=''},2000)}},150)}},[scrollToItem]);
    const origRef=React.useRef(JSON.stringify(o));
    const markDirty=()=>setDirty(true);const[saved,setSaved]=useState(!!order.customer_id);const[showSend,setShowSend]=useState(false);const[showPick,setShowPick]=useState(false);const[pickId,setPickId]=useState(()=>{let max=4000;(allOrders||[]).concat([order]).forEach(so=>safeItems(so).forEach(it=>safePicks(it).forEach(pk=>{const m=parseInt((pk.pick_id||'').replace('IF-',''))||0;if(m>max)max=m})));return'IF-'+String(max+1)});const[showPO,setShowPO]=useState(null);const[poCounter,setPOCounter]=useState(()=>3001+Math.floor(Math.random()*100));
    const[pickNotes,setPickNotes]=useState('');const[pickShipDest,setPickShipDest]=useState('in_house');const[pickDecoVendor,setPickDecoVendor]=useState('');const[pickShipAddr,setPickShipAddr]=useState('default');
    const DECO_VENDORS=['Silver Screen','Olympic Embroidery','WePrintIt','Pacific Screen Print','Other'];
  const[showFirmReq,setShowFirmReq]=useState(false);const[firmReqDate,setFirmReqDate]=useState('');const[firmReqNote,setFirmReqNote]=useState('');
  const[showInvCreate,setShowInvCreate]=useState(false);const[invSelItems,setInvSelItems]=useState([]);const[invMemo,setInvMemo]=useState('');const[invType,setInvType]=useState('deposit');
  const[splitModal,setSplitModal]=useState(null);// {jIdx, mode:'received'|'sku'|null}
  // Sync dirty state to parent dirtyRef
  React.useEffect(()=>{if(dirtyRef)dirtyRef.current=dirty},[dirty,dirtyRef]);
  // Adjust inventory when pick is pulled or un-pulled
  const adjustInvForPick=(pick,item,direction)=>{
    // direction: -1 = pulling (decrement inv), +1 = un-pulling (restore inv)
    if(!onAdjustInv)return;
    const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
    if(!p)return;
    const newInv={...p._inv};
    Object.entries(pick).forEach(([k,v])=>{if(k!=='status'&&k!=='pick_id'&&typeof v==='number'&&v>0){newInv[k]=Math.max(0,(newInv[k]||0)+(direction*v))}});
    onAdjustInv(p.id,newInv);
    // Check other SOs for open (unpulled) picks on the same product that now exceed inventory
    if(direction===-1&&allOrders){
      const warnings=[];
      allOrders.forEach(so=>{
        if(so.id===o.id)return; // skip current order
        safeItems(so).forEach(it=>{
          if(it.sku!==item.sku&&it.product_id!==item.product_id)return;
          safePicks(it).forEach(pk=>{
            if(pk.status==='pulled')return; // already pulled, not affected
            const overSizes=[];
            Object.entries(pk).forEach(([sz,qty])=>{
              if(sz==='status'||sz==='pick_id'||typeof qty!=='number'||qty<=0)return;
              if(qty>(newInv[sz]||0))overSizes.push(sz+': needs '+qty+', only '+(newInv[sz]||0));
            });
            if(overSizes.length>0)warnings.push({so:so.id,pick:pk.pick_id||'IF',sizes:overSizes});
          });
        });
      });
      if(warnings.length>0){
        const msg=warnings.map(w=>w.so+' '+w.pick+' ('+w.sizes.join(', ')+')').join('\n');
        setTimeout(()=>nf('⚠️ Inventory conflict! These open IFs now exceed available stock:\n'+msg,'error'),500);
      }
    }
  };
  const[editPick,setEditPick]=useState(null);const[editPO,setEditPO]=useState(null);
  // Helper: effective PO committed qty for a size (ordered minus cancelled)
  const poCommitted=(poLines,sz)=>(poLines||[]).reduce((a,pk)=>{const ordered=pk[sz]||0;const cancelled=(pk.cancelled||{})[sz]||0;return a+(ordered-cancelled)},0);
  const[newAddr,setNewAddr]=useState('');const[showNA,setShowNA]=useState(false);const[showSzPicker,setShowSzPicker]=useState(null);const[showCustom,setShowCustom]=useState(false);const[custItem,setCustItem]=useState({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:''});
  const[nsImport,setNsImport]=useState(null);// {step:'paste'|'review'|'confirm', raw:'', parsed:[], decoMap:[], issues:[]}
  const sv=(k,v)=>{setO(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));setDirty(true)};
  const isAU=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';const tD={A:0.4,B:0.35,C:0.3};
  const selC=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);sv('customer_id',id);sv('default_markup',c.catalog_markup||1.65)}};
  const addP=p=>{const au=isAU(p.brand);const sell=au?rQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):rQ(p.nsa_cost*(o.default_markup||1.65));
    sv('items',[...o.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:[...p.available_sizes],_colors:p._colors||null,sizes:{},decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:0}]:[]}]);setShowAdd(false);setPS('')};
  const uI=(i,k,v)=>sv('items',safeItems(o).map((it,x)=>x===i?{...it,[k]:v}:it));const rmI=i=>sv('items',safeItems(o).filter((_,x)=>x!==i));
  const copyI=(i)=>{const it=o.items[i];const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];clone.sizes={};sv('items',[...o.items,clone]);nf('📋 Copied '+it.sku+' — adjust sizes on the new item')};
  const uSz=(i,sz,v)=>{
    const n=v===''?0:parseInt(v)||0;
    const item=o.items[i];if(!item)return;
    // Guard: don't allow reducing below committed qty (pulled picks + net POs)
    const pickedQty=safePicks(item).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+(pk[sz]||0),0);
    const poQty=poCommitted(item.po_lines,sz);
    const committed=pickedQty+poQty;
    if(n<committed&&committed>0){
      nf('Cannot reduce '+sz+' below '+committed+' ('+pickedQty+' picked + '+poQty+' on PO)','error');return;
    }
    uI(i,'sizes',{...item.sizes,[sz]:n});
  };
  const addSzToItem=(i,sz)=>{const it=o.items[i];if(!it.available_sizes.includes(sz))uI(i,'available_sizes',[...it.available_sizes,sz]);setShowSzPicker(null)};
  const NUM_SZ={heat_transfer:['1"','1.5"','2"','3"','4"','5"','6"','8"','10"'],embroidery:['0.5"','0.75"','1"','1.5"','2"'],screen_print:['4"','6"','8"','10"']};
  const addArtDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'art',position:'Front Center',art_file_id:null,sell_override:null}])};
  const addNumDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,sell_override:null,custom_font_art_id:null,roster:{}}])};
  const addNameDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'names',position:'Back Center',sell_override:null,sell_each:6,cost_each:3,names:{}}])};
  const addOutsideDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'outside_deco',position:'Front Center',vendor:'',deco_type:'embroidery',cost_each:0,sell_each:0,notes:'',sell_override:null}])};
  const uD=(ii,di,k,v)=>{uI(ii,'decorations',o.items[ii].decorations.map((d,i)=>i===di?{...d,[k]:v}:d))};
  const uDM=(ii,di,updates)=>{uI(ii,'decorations',o.items[ii].decorations.map((d,i)=>i===di?{...d,...updates}:d))};
  const rmD=(ii,di)=>{uI(ii,'decorations',o.items[ii].decorations.filter((_,i)=>i!==di))};
  // Art files (SO)
  const af=o.art_files||[];
  const addArt=()=>sv('art_files',[...af,{id:'af'+Date.now(),name:'',deco_type:'screen_print',ink_colors:'',thread_colors:'',art_size:'',files:[],mockup_files:[],prod_files:[],notes:'',status:'uploaded',uploaded:new Date().toLocaleDateString()}]);
  const uArt=(i,k,v)=>sv('art_files',af.map((f,x)=>x===i?{...f,[k]:v}:f));
  const rmArt=i=>sv('art_files',af.filter((_,x)=>x!==i));
  const addFileToArt=i=>{const a=af[i];uArt(i,'files',[...a.files,'new_file_'+(a.files.length+1)+'.ai'])};

  const addrs=useMemo(()=>getAddrs(cust,allCustomers),[cust,allCustomers]);
  const artQty=useMemo(()=>{const m={};safeItems(o).forEach(it=>{const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){m[d.art_file_id]=(m[d.art_file_id]||0)+q}})});return m},[o]);
  const totals=useMemo(()=>{let rev=0,cost=0;safeItems(o).forEach(it=>{const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!q)return;rev+=q*safeNum(it.unit_sell);cost+=q*safeNum(it.nsa_cost);
    safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);rev+=q*dp.sell;cost+=q*dp.cost});
    (it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco').forEach(pl=>{const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!['unit_cost'].includes(k)).reduce((a,[,v])=>a+v,0);cost+=poQty*safeNum(pl.unit_cost)})});
    const ship=o.shipping_type==='pct'?rev*(o.shipping_value||0)/100:(o.shipping_value||0);const tax=rev*(cust?.tax_rate||0);
    return{rev,cost,ship,tax,grand:rev+ship+tax,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[o,artQty]); // eslint-disable-line

  // AUTO-SYNC JOBS from decorations — one job per unique artwork across entire SO
  const syncJobs=useCallback(()=>{
    const artJobs={};
    safeItems(o).forEach((it,ii)=>{
      safeDecos(it).forEach((d,di)=>{
        let jobKey,artName,artId,decoType,artSt;
        if(d.kind==='art'){
          if(!d.art_file_id){
            jobKey='unassigned_'+safeStr(d.position);
            artName='Unassigned Art ('+safeStr(d.position)+')';artId=null;
            decoType=d.deco_type||'screen_print';artSt='needs_art';
          } else {
            jobKey='art_'+d.art_file_id;
            const artF=af.find(a=>a.id===d.art_file_id);
            artName=artF?.name||'Unknown Art';artId=d.art_file_id;
            decoType=artF?.deco_type||d.deco_type||'screen_print';
            artSt=artF?.status==='approved'?'art_complete':'waiting_approval';
          }
        } else if(d.kind==='numbers'){
          jobKey='numbers_'+(d.num_method||'ht')+'_'+safeStr(d.position);
          artName='Numbers — '+(d.num_method||'heat_transfer').replace(/_/g,' ');
          artId=null;decoType=d.num_method||'heat_transfer';artSt='art_complete';
        } else return;
        if(!artJobs[jobKey]){
          artJobs[jobKey]={key:jobKey,art_file_id:artId,art_name:artName,deco_type:decoType,
            positions:new Set(),items:[],art_status:artSt,total_units:0,fulfilled_units:0};
        }
        const job=artJobs[jobKey];
        job.positions.add(safeStr(d.position));
        const szEntries=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0);
        let itemTotal=0,itemFulfilled=0;
        szEntries.forEach(([sz,v])=>{
          itemTotal+=v;
          const pulledQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
          const rcvdQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
          itemFulfilled+=Math.min(v,pulledQ+rcvdQ);
        });
        job.items.push({item_idx:ii,deco_idx:di,sku:it.sku||'—',name:safeStr(it.name)||'Unknown',color:safeStr(it.color),units:itemTotal,fulfilled:itemFulfilled});
        job.total_units+=itemTotal;job.fulfilled_units+=itemFulfilled;
      });
    });
    const existingJobMap={};safeJobs(o).forEach(j=>{existingJobMap[j.key||j.id]=j});
    const soNum=o.id?.replace('SO-','')||'0';
    let jIdx=1;
    const newJobs=Object.values(artJobs).map(j=>{
      const existing=existingJobMap[j.key];
      const itemSt=j.fulfilled_units>=j.total_units&&j.total_units>0?'items_received':j.fulfilled_units>0?'partially_received':'need_to_order';
      let prodSt=existing?.prod_status||'hold';
      if(itemSt==='items_received'&&j.art_status==='art_complete'&&prodSt==='hold')prodSt='staging';
      const id=existing?.id||('JOB-'+soNum+'-'+String(jIdx).padStart(2,'0'));
      jIdx++;
      return{
        id,key:j.key,art_file_id:j.art_file_id,art_name:j.art_name,deco_type:j.deco_type,
        positions:[...j.positions].join(', '),items:j.items,
        art_status:j.art_status,item_status:itemSt,prod_status:prodSt,
        total_units:j.total_units,fulfilled_units:j.fulfilled_units,
        assigned_machine:existing?.assigned_machine||null,assigned_to:existing?.assigned_to||null,
        ship_method:existing?.ship_method||null,
        split_from:existing?.split_from||null,created_at:existing?.created_at||new Date().toLocaleDateString(),
        counted_at:existing?.counted_at||null,counted_by:existing?.counted_by||null,
        count_discrepancy:existing?.count_discrepancy||null,notes:existing?.notes||null,
        _auto:existing?._auto!=null?existing._auto:true,
      };
    });
    return newJobs;
  },[o,af]);// eslint-disable-line

  // Auto-sync jobs whenever decorations or items change
  React.useEffect(()=>{
    if(!isSO)return;
    const synced=syncJobs();
    const currentKeys=safeJobs(o).map(j=>j.key).sort().join(',');
    const newKeys=synced.map(j=>j.key).sort().join(',');
    const currentUnits=safeJobs(o).map(j=>j.total_units+'-'+j.fulfilled_units).join(',');
    const newUnits=synced.map(j=>j.total_units+'-'+j.fulfilled_units).join(',');
    if(currentKeys!==newKeys||currentUnits!==newUnits){
      sv('jobs',synced);
    }
  },[syncJobs]);// eslint-disable-line

  const fp=products.filter(p=>{if(!pS)return true;const q=pS.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)});
  const statusFlow=['need_order','waiting_receive','items_received','in_production','ready_to_invoice','complete'];

  return(<div>
    {/* Sticky header — appears when scrolling */}
    <div style={{position:'sticky',top:0,zIndex:40,background:'white',borderBottom:'1px solid #e2e8f0',padding:'8px 16px',marginBottom:0,display:'flex',alignItems:'center',gap:12,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',flexWrap:'wrap'}}>
      <button className="btn btn-sm btn-secondary" onClick={()=>{if(dirty&&!window.confirm('You have unsaved changes. Leave without saving?'))return;onBack()}} style={{fontSize:10,padding:'4px 10px'}}><Icon name="back" size={12}/> Back</button>
      {isE&&onNewEstimate&&<button className="btn btn-sm btn-secondary" onClick={()=>{if(dirty&&!window.confirm('Unsaved changes. Continue?'))return;onNewEstimate()}} style={{fontSize:10,padding:'4px 10px'}}><Icon name="plus" size={12}/> New Est</button>}
      <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{o.id}</span>
      {isSO&&<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:SC[o.status]?.bg||'#f1f5f9',color:SC[o.status]?.c||'#475569'}}>{o.status?.replace(/_/g,' ')}</span>}
      {cust&&<span style={{fontSize:12,fontWeight:600,color:'#1e40af',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted',textUnderlineOffset:2}} onClick={()=>{if(onNavCustomer&&cust)onNavCustomer(cust)}} title={'View '+cust.name}>{cust.name}</span>}
      <span style={{fontSize:11,color:'#94a3b8',flex:1}}>{o.memo||''}</span>
      {dirty&&<span style={{fontSize:10,color:'#d97706',fontWeight:600}}>● Unsaved</span>}
      <button className="btn btn-sm btn-primary" onClick={()=>{const updated={...o,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSaved(true);nf('Saved')}} style={{padding:'4px 14px',fontSize:11}}>✓ Save</button>
    </div>
    {/* HEADER */}
    <div className="card" style={{marginBottom:16,marginTop:8}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{o.id}</span>
            {isE&&<span className={`badge ${o.status==='draft'?'badge-gray':o.status==='sent'?'badge-amber':o.status==='approved'?'badge-green':'badge-blue'}`}>{o.status}</span>}
            {isSO&&<span style={{padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700,background:SC[o.status]?.bg||'#f1f5f9',color:SC[o.status]?.c||'#475569'}}>{o.status?.replace(/_/g,' ')}</span>}
            {isE&&<EmailBadge e={o}/>}</div>
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>({value:c.id,label:`${c.name} (${c.alpha_tag})`}))} value={o.customer_id} onChange={selC} placeholder="Search customer..."/></div>
          :<div><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:18,fontWeight:800}}>{cust.name}</span> <span style={{fontSize:14,color:'#64748b'}}>({cust.alpha_tag})</span>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:10,textDecoration:'underline',padding:0}} onClick={()=>{if(window.confirm('Change customer for '+o.id+'? This will update pricing tier.'))selC(null);setCust(null)}}>change</button></div>
            <div style={{fontSize:13,color:'#64748b'}}>Tier {cust.adidas_ua_tier} | {o.default_markup||1.65}x | Tax: {cust.tax_rate?(cust.tax_rate*100).toFixed(2)+'%':'N/A'}</div></div>}
          {isSO&&o.estimate_id&&<div style={{fontSize:11,color:'#7c3aed'}}>🔗 From: {o.estimate_id}</div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>By {REPS.find(r=>r.id===o.created_by)?.name} · {o.created_at}</div></div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{l:'REV',v:totals.rev,bg:'#f0fdf4',c:'#166534'},{l:'COST',v:totals.cost,bg:'#fef2f2',c:'#dc2626'},{l:'MARGIN',v:totals.margin,bg:'#dbeafe',c:'#1e40af',s:`${totals.pct.toFixed(1)}%`},{l:'TOTAL',v:totals.grand,bg:'#faf5ff',c:'#7c3aed',s:'+tax+ship'}].map(x=>
            <div key={x.l} style={{textAlign:'center',padding:'8px 12px',background:x.bg,borderRadius:8,minWidth:72}}><div style={{fontSize:9,color:x.c,fontWeight:700}}>{x.l}</div><div style={{fontSize:17,fontWeight:800,color:x.c}}>${x.v.toLocaleString(undefined,{maximumFractionDigits:0})}</div>{x.s&&<div style={{fontSize:9,color:'#94a3b8'}}>{x.s}</div>}</div>)}</div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180}}><label className="form-label">Memo</label><input className="form-input" value={o.memo} onChange={e=>sv('memo',e.target.value)} style={{fontSize:14}}/></div>
        {isE&&<div style={{width:70}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={o.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;sv('default_markup',m);sv('items',safeItems(o).map(it=>isAU(it.brand)?it:{...it,unit_sell:rQ(it.nsa_cost*m)}))}}/></div>}
        {isSO&&<div style={{width:140}}>
          <label className="form-label">Expected</label>
          <input className="form-input" type="date" value={o.expected_date||''} onChange={e=>sv('expected_date',e.target.value)}/>
          <button style={{fontSize:10,marginTop:4,padding:'3px 8px',borderRadius:4,background:'#f5f3ff',border:'1px solid #ddd6fe',color:'#7c3aed',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:3}} onClick={()=>{setFirmReqDate(o.expected_date||'');setFirmReqNote('');setShowFirmReq(true)}}>📌 Request Firm Date</button>
        </div>}
        <button className="btn btn-primary" onClick={()=>{
          if(!cust){nf('Select a customer first','error');return}
          if(!o.memo?.trim()){nf('Memo is required','error');return}
          const validItems=safeItems(o).filter(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
          if(validItems.length===0){nf('Add at least one item with sizes','error');return}
          const noSku=validItems.find(it=>!it.sku?.trim()&&!it.is_custom);
          if(noSku){nf('Item '+(noSku.name||'#?')+' needs a SKU or mark as custom','error');return}
          const noPrice=validItems.find(it=>safeNum(it.unit_sell)<=0);
          if(noPrice){nf('Item '+(noPrice.sku||noPrice.name||'#?')+' needs a sell price','error');return}
          onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved`)}} style={{padding:'10px 28px',fontSize:16,fontWeight:800}}><Icon name="check" size={16}/> Save</button>
        {isE&&saved&&o.status!=='approved'&&o.status!=='converted'&&<button className="btn btn-secondary" onClick={()=>setShowSend(true)}><Icon name="send" size={14}/> Send</button>}
        {isE&&saved&&(o.status==='sent'||o.status==='draft')&&<button className="btn btn-primary" style={{background:'#22c55e'}} onClick={()=>{sv('status','approved');onSave({...o,status:'approved'});nf('Estimate approved')}}><Icon name="check" size={14}/> Approve</button>}
        {isE&&o.status==='approved'&&<button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>{
          if(!cust){nf('Select a customer first','error');return}
          if(!o.memo?.trim()){nf('Memo is required','error');return}
          const validItems=safeItems(o).filter(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
          if(validItems.length===0){nf('Cannot convert — add at least one item with sizes','error');return}
          const noSku=validItems.find(it=>!it.sku?.trim()&&!it.is_custom);
          if(noSku){nf('Item '+(noSku.name||'#?')+' needs a SKU or mark as custom','error');return}
          const noPrice=validItems.find(it=>safeNum(it.unit_sell)<=0);
          if(noPrice){nf('Item '+(noPrice.sku||noPrice.name||'#?')+' needs a sell price','error');return}
          onConvertSO(o)}}><Icon name="box" size={14}/> Convert to SO</button>}
        {/* Print Estimate or SO */}
        <button className="btn btn-secondary" style={{fontSize:12}} onClick={()=>{
          const items=safeItems(o).filter(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
          const _pAQ={};items.forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
          const isRolled=(o.pricing_mode||'itemized')==='rolled_up';
          const taxRate=cust?.tax_rate||0;
          const rows=[];let subTotal=0;
          items.forEach(it=>{
            const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            const decos=safeDecos(it);
            const decoSell=decos.reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);return a+dp2.sell},0);
            const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+' '+sz).join(', ');
            const unitPrice=isRolled?safeNum(it.unit_sell)+decoSell:safeNum(it.unit_sell);
            const lineAmt=qty*unitPrice;subTotal+=lineAmt;
            let itemDesc='<strong>'+it.sku+'</strong><br/>'+(it.name||'')+(it.color?' - '+it.color:'');
            if(szStr)itemDesc+='<br/><span style="font-size:10px;color:#555">'+szStr+'</span>';
            rows.push({cells:[{value:itemDesc},{value:qty,style:'text-align:center'},{value:'$'+unitPrice.toFixed(2),style:'text-align:right'},{value:'$'+lineAmt.toFixed(2),style:'text-align:right;font-weight:600'}]});
            decos.forEach(d=>{
              const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);
              const artF=af.find(a2=>a2.id===d.art_file_id);
              const decoLabel=(d.kind==='art'?(artF?.deco_type||d.art_tbd_type||'decoration'):d.kind==='numbers'?'Numbers ('+(d.num_method||'heat transfer').replace(/_/g,' ')+' '+(d.num_size||'4"')+')':d.kind==='names'?'Names':d.kind==='outside_deco'?(d.deco_type||'Decoration'):'Decoration').replace(/_/g,' ');
              const posLabel=d.position?' — '+d.position:'';
              // Build number list for print
              let numHtml='';
              if(d.kind==='numbers'&&d.roster){const szOrd2=['XS','S','M','L','XL','2XL','3XL','4XL'];
                const sorted=Object.entries(d.roster).sort((a,b)=>(szOrd2.indexOf(a[0])===-1?99:szOrd2.indexOf(a[0]))-(szOrd2.indexOf(b[0])===-1?99:szOrd2.indexOf(b[0])));
                const szRows=sorted.filter(([,arr])=>(arr||[]).some(v=>v)).map(([sz,arr])=>'<tr><td style="font-weight:700;padding:1px 6px;font-size:10px">'+sz+'</td><td style="font-size:10px;padding:1px 4px">'+(arr||[]).filter(v=>v).join(', ')+'</td></tr>');
                if(szRows.length>0)numHtml='<table style="margin:2px 0 0 20px;border-collapse:collapse">'+szRows.join('')+'</table>'}
              if(d.kind==='names'&&d.names){const szOrd2=['XS','S','M','L','XL','2XL','3XL','4XL'];
                const sorted=Object.entries(d.names).sort((a,b)=>(szOrd2.indexOf(a[0])===-1?99:szOrd2.indexOf(a[0]))-(szOrd2.indexOf(b[0])===-1?99:szOrd2.indexOf(b[0])));
                const szRows=sorted.filter(([,arr])=>(arr||[]).some(v=>v)).map(([sz,arr])=>'<tr><td style="font-weight:700;padding:1px 6px;font-size:10px">'+sz+'</td><td style="font-size:10px;padding:1px 4px">'+(arr||[]).filter(v=>v).join(', ')+'</td></tr>');
                if(szRows.length>0)numHtml='<table style="margin:2px 0 0 20px;border-collapse:collapse">'+szRows.join('')+'</table>'}
              if(isRolled){
                rows.push({cells:[{value:'<span style="padding-left:20px;color:#666;font-size:11px">'+decoLabel+posLabel+'</span>'+numHtml,style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'}]});
              }else{
                const decoAmt=qty*dp2.sell;subTotal+=decoAmt;
                rows.push({cells:[{value:'<span style="padding-left:20px;color:#666;font-size:11px">'+decoLabel+posLabel+'</span>'+numHtml},{value:qty,style:'text-align:center;color:#888;font-size:11px'},{value:'$'+dp2.sell.toFixed(2),style:'text-align:right;color:#888;font-size:11px'},{value:'$'+decoAmt.toFixed(2),style:'text-align:right;color:#888;font-size:11px'}]});
              }
            });
          });
          const shipAmt=o.shipping_type==='pct'?subTotal*(o.shipping_value||0)/100:(o.shipping_value||0);
          const taxAmt=subTotal*taxRate;const total=subTotal+shipAmt+taxAmt;
          if(shipAmt>0)rows.push({cells:[{value:'<strong>Shipping</strong>'},{value:1,style:'text-align:center'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'}]});
          printDoc({
            title:cust?.name||'Customer',docNum:o.id,docType:isE?'ESTIMATE':'SALES ORDER',
            headerRight:'<div style="font-size:32px;font-weight:900;color:#1e3a5f">$'+total.toFixed(2)+'</div>'+(isE?'<div style="font-size:11px;color:#888">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>':''),
            infoBoxes:[
              {label:'Bill To',value:cust?.name||'—',sub:cust?.address||cust?.alpha_tag||''},
              {label:isE?'Expires':'Expected',value:isE?new Date(Date.now()+30*86400000).toLocaleDateString():(o.expected_date||'TBD'),sub:'Exp. Close: '+new Date().toLocaleDateString()},
              {label:'Sales Rep',value:REPS.find(r=>r.id===o.created_by)?.name||'—'},
              {label:'Memo',value:o.memo||'—'},
            ],
            tables:[{headers:['Item','Qty','Rate','Amount'],aligns:['left','center','right','right'],
              rows:[...rows,
                {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>$'+subTotal.toFixed(2)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'Tax ('+(taxRate*100).toFixed(3)+'%)',style:'text-align:right;border:none;font-size:11px'},{value:'$'+taxAmt.toFixed(2),style:'text-align:right;border:none'}]}]:[]),
                {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">$'+total.toFixed(2)+'</strong>',style:'text-align:right'}]},
              ]}],
            footer:isE?'This estimate is valid for 30 days. Prices subject to change. '+NSA.depositTerms:NSA.terms,
            portalLink:cust?.alpha_tag?(window.location.origin+'?portal='+cust.alpha_tag):undefined
          });
        }}>🖨️ Print {isE?'Estimate':'SO'}</button>
      </div>
      {isSO&&<div style={{display:'flex',gap:6,marginTop:8}}>
        <button className="btn btn-secondary" onClick={()=>setShowPO('select')}><Icon name="cart" size={14}/> Create PO</button>
        <button className="btn btn-secondary" style={{color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
          setInvSelItems(safeItems(o).map((_,i)=>i));setInvMemo(o.memo||'');setInvType('deposit');setShowInvCreate(true);
        }}><Icon name="dollar" size={14}/> Create Invoice</button>
      </div>}
      {/* SHIPPING */}
      <div style={{display:'flex',gap:12,marginTop:12,alignItems:'end',flexWrap:'wrap',borderTop:'1px solid #f1f5f9',paddingTop:12}}>
        <div><label className="form-label">Shipping</label><div style={{display:'flex',gap:4,alignItems:'center'}}>
          <Bg options={[{value:'pct',label:'% of Total'},{value:'flat',label:'Flat $'}]} value={o.shipping_type||'pct'} onChange={v=>sv('shipping_type',v)}/>
          {o.shipping_type==='pct'?<span style={{display:'inline-flex',alignItems:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'2px 6px',background:'white'}}><input value={o.shipping_value||0} onChange={e=>sv('shipping_value',parseFloat(e.target.value)||0)} style={{width:40,border:'none',outline:'none',fontSize:15,fontWeight:800,textAlign:'center',background:'transparent'}}/><span style={{fontWeight:700}}>%</span></span>
          :<$In value={o.shipping_value||0} onChange={v=>sv('shipping_value',v)} w={60}/>}
          <span style={{fontSize:12,color:'#64748b'}}>= ${totals.ship.toFixed(2)}</span>
        </div></div>
        <div style={{flex:1,minWidth:180}}><label className="form-label">Ship To</label>
          {!showNA?<select className="form-select" value={o.ship_to_id||'default'} onChange={e=>{if(e.target.value==='new')setShowNA(true);else sv('ship_to_id',e.target.value)}}>
            {addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}<option value="new">+ New Address</option></select>
          :<div style={{display:'flex',gap:4}}><input className="form-input" placeholder="New address..." value={newAddr} onChange={e=>setNewAddr(e.target.value)} autoFocus style={{flex:1}}/><button className="btn btn-sm btn-primary" onClick={()=>{sv('ship_to_custom',newAddr);sv('ship_to_id','custom');setShowNA(false)}}>OK</button><button className="btn btn-sm btn-secondary" onClick={()=>setShowNA(false)}>×</button></div>}
        </div>
        <div style={{fontSize:12,color:'#64748b'}}>Tax: <strong>${totals.tax.toFixed(2)}</strong></div>
      </div>
      {/* SO STATUS — fully auto-calculated from items/jobs */}
      {isSO&&(()=>{
        const autoSt=calcSOStatus(o);
        // Auto-sync status
        if(o.status!==autoSt&&o.status!=='complete'){setTimeout(()=>sv('status',autoSt),0)}
        const stLabels={need_order:'Need to Order',waiting_receive:'Waiting to Receive',items_received:'Items Received',in_production:'In Production',ready_to_invoice:'Ready to Invoice',complete:'Complete'};
        const displaySt=o.status==='complete'?'complete':autoSt;
        return<div style={{display:'flex',gap:8,marginTop:12,borderTop:'1px solid #f1f5f9',paddingTop:12,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#64748b',fontWeight:600}}>Order Status:</span>
          {statusFlow.map((sf)=>{const sc=SC[sf]||{};const cur=sf===displaySt;
            return<span key={sf} style={{padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:cur?800:500,
              background:cur?sc.bg:'#f8fafc',color:cur?sc.c:'#94a3b8',border:cur?`2px solid ${sc.c}`:'1px solid #e2e8f0',
              cursor:sf==='complete'?'pointer':'default',opacity:cur?1:0.5}}
              onClick={()=>{if(sf==='complete')sv('status','complete')}}
              title={sf==='complete'?'Click to manually mark complete':'Auto-calculated'}>
              {stLabels[sf]||sf}</span>})}
          {o.status==='complete'&&autoSt!=='complete'&&<button className="btn btn-sm btn-secondary" style={{fontSize:9,marginLeft:4}} onClick={()=>sv('status',autoSt)}>↩️ Reset to Auto</button>}
        </div>})()}
      {isSO&&<div style={{marginTop:8}}><label className="form-label">Production Notes</label><input className="form-input" value={o.production_notes||''} onChange={e=>sv('production_notes',e.target.value)} placeholder="Internal notes..."/></div>}
    </div></div>
    {/* TABS */}
    <div className="tabs" style={{marginBottom:16}}>
      <button className={`tab ${tab==='items'?'active':''}`} onClick={()=>setTab('items')}>Line Items</button>
      <button className={`tab ${tab==='art'?'active':''}`} onClick={()=>setTab('art')}>Art Library ({af.length})</button>
      {isSO&&<button className={`tab ${tab==='messages'?'active':''}`} onClick={()=>setTab('messages')}>Messages {(()=>{const unread=(msgs||[]).filter(m=>m.so_id===o.id&&!(m.read_by||[]).includes(cu.id)).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:4}}>{unread}</span>:` (${(msgs||[]).filter(m=>m.so_id===o.id).length})`})()}</button>}
      {isSO&&<button className={`tab ${tab==='transactions'?'active':''}`} onClick={()=>setTab('transactions')}>Linked</button>}
      {isSO&&<button className={`tab ${tab==='jobs'?'active':''}`} onClick={()=>setTab('jobs')}>Jobs {(()=>{const jc=(o.jobs||[]).length;return jc>0?` (${jc})`:''})()}</button>}
      {isSO&&<button className={`tab ${tab==='firm_dates'?'active':''}`} onClick={()=>setTab('firm_dates')}>Firm Dates ({safeFirm(o).length})</button>}
      {isSO&&<button className={`tab ${tab==='costs'?'active':''}`} onClick={()=>setTab('costs')} style={tab==='costs'?{background:'#166534',color:'white'}:{}}>💰 Costs</button>}
    </div>

    {/* LINE ITEMS */}
    {tab==='items'&&<>{safeItems(o).map((item,idx)=>{const qty=Object.values(safeSizes(item)).reduce((a,v)=>a+safeNum(v),0);
      let dR=0,dC=0;const decoBreak=[];safeDecos(item).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp=dP(d,qty,af,cq);const dr=qty*dp.sell;const dc=qty*dp.cost;dR+=dr;dC+=dc;
        const artF=d.kind==='art'?af.find(f=>f.id===d.art_file_id):null;const label=d.kind==='art'?(artF?artF.deco_type?.replace('_',' '):d.position):'Numbers @ '+d.position;
        decoBreak.push({label,sell:dp.sell,cost:dp.cost,rev:dr,costTot:dc,margin:dr-dc,pct:dr>0?((dr-dc)/dr*100):0})});
      const pRev=qty*item.unit_sell;const pCost=qty*item.nsa_cost;const pMg=pRev-pCost;
      const iR=pRev+dR;const iC=pCost+dC;const mg=iR-iC;
      const szs=(item.available_sizes||['S','M','L','XL','2XL']).slice().sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
      const addable=EXTRA_SIZES.filter(s=>!(item.available_sizes||[]).includes(s));
      return(<div key={idx} id={'so-item-'+idx} className="card" style={{marginBottom:12,transition:'box-shadow 0.3s'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {item.is_custom?<input className="form-input" value={item.sku} onChange={e=>uI(idx,'sku',e.target.value)} style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15,width:100,border:'1px solid #93c5fd'}}/>
                  :<span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>}
                {item.is_custom?<input className="form-input" value={item.name} onChange={e=>uI(idx,'name',e.target.value)} style={{fontWeight:700,fontSize:15,flex:1,minWidth:150}} placeholder="Item name..."/>
                  :<span style={{fontWeight:700,fontSize:15}}>{item.name}</span>}
                {item._colors?<select className="form-select" style={{fontSize:12,width:150}} value={item.color||item._colors[0]} onChange={e=>uI(idx,'color',e.target.value)}>{item._colors.map(c=><option key={c}>{c}</option>)}</select>
                  :item.is_custom?<input className="form-input" value={item.color||''} onChange={e=>uI(idx,'color',e.target.value)} style={{fontSize:12,width:100}} placeholder="Color"/>
                  :<span className="badge badge-gray">{item.color}</span>}
                {item.is_custom&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Custom</span>}
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4,flexWrap:'wrap'}}>
                {/* Cost — editable for custom items */}
                {item.is_custom?<span style={{fontSize:12,color:'#64748b'}}>Cost: <$In value={item.nsa_cost} onChange={v=>{uI(idx,'nsa_cost',v);if(!isAU(item.brand)&&v>0){uI(idx,'unit_sell',rQ(v*(o.default_markup||1.65)))}}}/></span>
                  :<span style={{fontSize:12,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong></span>}
                {/* Retail — show for Adidas/UA, editable for custom items with those brands */}
                {(isAU(item.brand)||item.retail_price>0)&&<span style={{fontSize:12,color:'#64748b'}}>Retail: {item.is_custom?<$In value={item.retail_price||0} onChange={v=>{uI(idx,'retail_price',v);if(isAU(item.brand)&&v>0){const tier=tD[cust?.adidas_ua_tier||'B']||0.35;uI(idx,'nsa_cost',rQ(v*(1-tier)));uI(idx,'unit_sell',rQ(v*(1-tier)))}}}/>:<strong>${item.retail_price?.toFixed(2)}</strong>}</span>}
                <span style={{fontSize:13}}>Sell: <$In value={item.unit_sell} onChange={v=>uI(idx,'unit_sell',v)}/>/ea</span>
                {!isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
                {isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:item.unit_sell>item.nsa_cost?'#166534':'#dc2626'}}>({Math.round((item.unit_sell-item.nsa_cost)/item.unit_sell*100)}% margin)</span>}
              </div></div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <button title="Copy item" onClick={()=>copyI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#2563eb',padding:4}}><Icon name="file" size={14}/></button>
              <button title="Delete item" onClick={()=>rmI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={14}/></button>
            </div>
          </div></div>
        {/* SIZES ROW with financials inline */}
        <div style={{padding:'10px 18px',display:'flex',alignItems:'center',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:46}}>Sizes:</span>
            {szs.map(sz=><div key={sz} style={{textAlign:'center',width:48}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
              <input value={item.sizes[sz]||''} onChange={e=>uSz(idx,sz,e.target.value)} placeholder="0"
                style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:(item.sizes[sz]||0)>0?'#0f172a':'#cbd5e1'}}/>
              {(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const stk=p?._inv?.[sz];const need=item.sizes[sz]||0;return<div style={{fontSize:9,fontWeight:600,minHeight:13,color:stk==null?'transparent':stk<=0?'#dc2626':stk<need?'#ca8a04':'#166534'}}>{stk!=null?stk+' inv':'\u00A0'}</div>})()}</div>)}
            <div style={{textAlign:'center',marginLeft:4,padding:'0 10px',borderLeft:'2px solid #e2e8f0'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOT</div><div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div></div>
            <div style={{position:'relative',marginLeft:4}}><button className="btn btn-sm btn-secondary" onClick={()=>setShowSzPicker(showSzPicker===idx?null:idx)} style={{fontSize:10}}>+ Size</button>
              {showSzPicker===idx&&addable.length>0&&<><div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:39}} onClick={()=>setShowSzPicker(null)}/><div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:40,padding:6,display:'flex',gap:3,flexWrap:'wrap',width:180}}>
                {addable.map(sz=><button key={sz} className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>addSzToItem(idx,sz)}>{sz}</button>)}</div></>}
            </div>
          </div>
          {/* Financial summary — right side of sizes row */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}>
            {isSO&&(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
              const szList=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const anyUnassigned=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);return v-picked-po>0});
              if(!anyUnassigned)return<span style={{fontSize:10,color:'#166534',fontStyle:'italic',fontWeight:600}}>✓ All assigned</span>;
              const hasInv=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const inv=p?._inv?.[sz]||0;return v-picked-po>0&&inv>0});
              return hasInv?<button className="btn btn-primary" style={{fontSize:12,padding:'8px 16px',fontWeight:700,whiteSpace:'nowrap'}} onClick={()=>{
                const szs2=szList;const pp=p;
                const pickItem={...item,_idx:idx,_pick:Object.fromEntries(szs2.map(([sz,v])=>{const inv=pp?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,inv>0?Math.min(open,inv):0]}))};
                setShowPick([pickItem]);
              }}><Icon name="grid" size={14}/> Create IF</button>
              :<span style={{fontSize:10,color:'#d97706',fontStyle:'italic'}}>Need to order</span>})()}
            <div style={{textAlign:'right',borderLeft:'1px solid #e2e8f0',paddingLeft:12,minWidth:140}}>
              <div style={{fontSize:10,color:'#64748b',marginBottom:2}}>Cost ${iC.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              <div style={{fontSize:10,color:'#64748b'}}>${qty>0?(iR/qty).toFixed(2):'-'}/ea</div>
              <span style={{fontSize:22,fontWeight:900,color:'#166534'}}>${iR.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
            </div>
          </div>
        </div>
        {/* FULFILLMENT LINES */}
        {isSO&&(item.pick_lines||[]).length>0&&<div style={{padding:'4px 18px',borderBottom:'1px solid #f1f5f9'}}>
          {safePicks(item).map((pk,pi)=>{const st=pk.status||'pick';
            return<div key={pi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='pulled'?'#166534':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setEditPick({lineIdx:idx,pickIdx:pi,pick:pk})} title="Click to edit">{pk.pick_id||'PICK'}:</span>
              {szs.map(sz=>{const v=pk[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,
                  background:st==='pulled'?'#dcfce7':st==='pick'?'#fef3c7':'#f1f5f9',
                  color:st==='pulled'?'#166534':st==='pick'?'#92400e':'#64748b'}}>{v}</div>})}
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,
                background:st==='pulled'?'#dcfce7':'#fef3c7',color:st==='pulled'?'#166534':'#92400e'}}>{st==='pulled'?'✓ Pulled':'Needs Pull'}</span>
              {pk.ship_dest&&pk.ship_dest!=='in_house'&&<span style={{fontSize:8,padding:'2px 5px',borderRadius:4,fontWeight:700,
                background:pk.ship_dest==='ship_customer'?'#dbeafe':'#ede9fe',color:pk.ship_dest==='ship_customer'?'#1e40af':'#6d28d9'}}>
                {pk.ship_dest==='ship_customer'?'📦 → Customer':'🚚 → '+(pk.deco_vendor||'Deco')}</span>}
            </div>})}
        </div>}
        {isSO&&(item.po_lines||[]).length>0&&<div style={{padding:'4px 18px',borderBottom:'1px solid #f1f5f9'}}>
          {safePOs(item).map((po,pi)=>{
            const rcvd=po.received||{};const cncl=po.cancelled||{};
            const szKeysAll=Object.keys(po).filter(k=>k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&typeof po[k]==='number');
            const totalOrd=szKeysAll.reduce((a,sz)=>a+(po[sz]||0),0);
            const totalRcvd=szKeysAll.reduce((a,sz)=>a+(rcvd[sz]||0),0);
            const totalCncl=szKeysAll.reduce((a,sz)=>a+(cncl[sz]||0),0);
            const totalOpen=szKeysAll.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0)),0);
            const st=totalOpen<=0&&totalRcvd>0?'received':totalRcvd>0?'partial':'waiting';
            return<div key={pi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='received'?'#166534':st==='partial'?'#b45309':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setEditPO({lineIdx:idx,poIdx:pi,po})} title="Click to edit">{po.po_id||'PO'}:</span>
              {szs.map(sz=>{const v=po[sz]||0;const r=rcvd[sz]||0;const cn=cncl[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                const szSt=cn>=v?'cancelled':r>=(v-cn)?'received':r>0?'partial':'waiting';
                return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,
                  background:szSt==='cancelled'?'#fef2f2':szSt==='received'?'#dcfce7':szSt==='partial'?'#fef3c7':'#fef3c7',
                  color:szSt==='cancelled'?'#dc2626':szSt==='received'?'#166534':szSt==='partial'?'#b45309':'#92400e'}}>{szSt==='cancelled'?'✕':szSt==='partial'?r+'/'+(v-cn):v-cn}</div>})}
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,
                background:st==='received'?'#dcfce7':st==='partial'?'#fff7ed':'#fef3c7',
                color:st==='received'?'#166534':st==='partial'?'#b45309':'#92400e'}}>{st==='received'?'✓ Received':st==='partial'?totalRcvd+'/'+(totalOrd-totalCncl)+' Rcvd':'Waiting'}</span>
            </div>})}
        </div>}
        {/* DECORATIONS */}
        <div style={{padding:'8px 18px 14px'}}>
          {safeDecos(item).map((deco,di)=>{const cq=deco.kind==='art'&&deco.art_file_id?artQty[deco.art_file_id]:qty;const dp=dP(deco,qty,af,cq);
            const decoTotal=qty*(deco.sell_override||dp.sell);const decoCostTotal=qty*dp.cost;const decoMargin=decoTotal-decoCostTotal;const decoMPct=decoTotal>0?Math.round(decoMargin/decoTotal*100):0;
            const decoCardStyle={padding:'10px 12px',marginBottom:4,borderRadius:6,background:di%2===0?'#fafbfc':'#f8f9fb',borderLeft:'3px solid '+(deco.kind==='art'?'#3b82f6':deco.kind==='numbers'?'#22c55e':deco.kind==='names'?'#f59e0b':deco.kind==='outside_deco'?'#7c3aed':'#94a3b8')};
            if(deco.kind==='art'){const artF=af.find(f=>f.id===deco.art_file_id);const artIcon=artF?(artF.deco_type==='screen_print'?'🎨':artF.deco_type==='embroidery'?'🧵':'🔥'):'';
              return(<div key={di} style={decoCardStyle}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  {(!deco.art_file_id||deco.art_file_id==='__tbd')&&<div style={{width:36,height:36,borderRadius:6,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>🎨</div>}
                  {artF&&deco.art_file_id!=='__tbd'&&<div style={{position:'relative'}}><div style={{width:36,height:36,borderRadius:6,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,cursor:'pointer',border:'2px solid transparent'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}} title="Click to expand">{artIcon}</div>
                  <div style={{display:'none',position:'absolute',top:40,left:0,width:260,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:50,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{artF.name||'Untitled'}</div>
                    <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{artF.deco_type?.replace('_',' ')} {artF.art_size&&`· ${artF.art_size}`}</div>
                    {artF.ink_colors&&<div style={{fontSize:11,marginBottom:2}}><strong>Ink:</strong> {artF.ink_colors.split('\n').filter(l=>l.trim()).join(', ')}</div>}
                    {artF.thread_colors&&<div style={{fontSize:11,marginBottom:2}}><strong>Thread:</strong> {artF.thread_colors}</div>}
                    <div style={{fontSize:10,color:'#94a3b8',marginBottom:4}}>Files: {artF.files?.join(', ')||'none'}</div>
                    {artF.notes&&<div style={{fontSize:10,color:'#7c3aed'}}>{artF.notes}</div>}
                    <div style={{fontSize:10,marginTop:4,padding:'2px 6px',display:'inline-block',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e'}}>{artF.status}</div>
                  </div></div>}
                  <select className="form-select" style={{width:200,fontSize:12,border:!deco.art_file_id?'2px solid #f59e0b':'1px solid #22c55e'}} value={deco.art_file_id||''} onChange={e=>{const v=e.target.value;if(v==='__tbd'){uDM(idx,di,{art_file_id:'__tbd',art_tbd_type:'screen_print',sell_override:0})}else{uD(idx,di,'art_file_id',v||null)}}}>
                    <option value="">⚠️ Select artwork...</option>
                    <option value="__tbd">🎨 Art TBD (pricing only)</option>{af.map(f=><option key={f.id} value={f.id}>{f.name||'Untitled'}</option>)}</select>
                  {deco.art_file_id==='__tbd'&&<><select className="form-select" style={{width:130,fontSize:11,border:'1px solid #f59e0b'}} value={deco.art_tbd_type||'screen_print'} onChange={e=>uDM(idx,di,{art_tbd_type:e.target.value,sell_override:0})}>
                    <option value="screen_print">Screen Print</option><option value="embroidery">Embroidery</option><option value="heat_press">Heat Press</option><option value="dtf">DTF</option></select>
                  {(deco.art_tbd_type||'screen_print')==='screen_print'&&<select className="form-select" style={{width:90,fontSize:10}} value={deco.tbd_colors||1} onChange={e=>uDM(idx,di,{tbd_colors:parseInt(e.target.value),sell_override:0})}>
                    {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} color{n>1?'s':''}</option>)}</select>}
                  {(deco.art_tbd_type||'screen_print')==='screen_print'&&<label style={{fontSize:10,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:deco.underbase?'#fef3c7':'transparent',borderRadius:4,cursor:'pointer'}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uDM(idx,di,{underbase:e.target.checked,sell_override:0})}/> Underbase</label>}
                  {deco.art_tbd_type==='embroidery'&&<select className="form-select" style={{width:110,fontSize:10}} value={deco.tbd_stitches||8000} onChange={e=>uDM(idx,di,{tbd_stitches:parseInt(e.target.value),sell_override:0})}>
                    <option value={8000}>≤10k st</option><option value={12000}>10k-15k</option><option value={18000}>15k-20k</option><option value={25000}>20k+</option></select>}
                  <span style={{fontSize:10,padding:'2px 8px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Art Needed</span></>}
                  <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                  {artF&&<><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',color:artF.deco_type==='screen_print'?'#1e40af':artF.deco_type==='embroidery'?'#6d28d9':'#92400e'}}>{artF.deco_type.replace('_',' ')}</span>
                    {artF.ink_colors&&<span style={{fontSize:11,color:'#64748b'}}>{artF.ink_colors.split('\n').filter(l=>l.trim()).length} color(s)</span>}
                    {artF.thread_colors&&<span style={{fontSize:11,color:'#64748b'}}>Thread: {artF.thread_colors}</span>}
                    {artF.art_size&&<span style={{fontSize:11,color:'#94a3b8'}}>{artF.art_size}</span>}
                    {artF.deco_type==='screen_print'&&<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:deco.underbase?'#fef3c7':'transparent',borderRadius:4}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uD(idx,di,'underbase',e.target.checked)}/> Underbase</label>}
                    <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e'}}>{artF.status}</span></>}
                  <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                    <span style={{fontSize:11}}>Sell: <$In value={deco.sell_override||dp.sell} onChange={v=>uD(idx,di,'sell_override',v)} w={50}/></span>
                    <span style={{fontSize:10,color:decoMPct>0?'#166534':'#dc2626',fontWeight:600}}>{decoMPct}%</span>
                    <span style={{fontSize:11,color:'#475569',fontWeight:700}}>${decoTotal.toFixed(2)}</span>
                    <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                  </div></div></div>)}
            // NUMBERS decoration
            {const nm=deco.num_method||'heat_transfer';const szOpts=NUM_SZ[nm]||[];
            const sizedQtys=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
            const roster=deco.roster||{};
            const filledNums=Object.values(roster).flat().filter(v=>v&&v.trim()).length;
            const showRoster=deco._showRoster||false;
            // Bball numbers: 0-5,10-15,20-25,30-35,40-45,50-55
            const BBALL_NUMS=[0,1,2,3,4,5,10,11,12,13,14,15,20,21,22,23,24,25,30,31,32,33,34,35,40,41,42,43,44,45,50,51,52,53,54,55];
            const autoFillNums=(mode)=>{const nr={};let numIdx=0;
              if(mode==='bball'){sizedQtys.forEach(([sz,sq])=>{nr[sz]=Array(sq).fill('');for(let i=0;i<sq;i++){if(numIdx<BBALL_NUMS.length)nr[sz][i]=String(BBALL_NUMS[numIdx++])}});}
              else{// small-large: 1,2,3... or 0,1,2... if roster has 0
                const startAt=(roster&&Object.values(roster).flat().find(v=>v==='0')!==undefined)?0:1;
                sizedQtys.forEach(([sz,sq])=>{nr[sz]=Array(sq).fill('');for(let i=0;i<sq;i++){nr[sz][i]=String(startAt+numIdx);numIdx++}});}
              uD(idx,di,'roster',nr);nf(mode==='bball'?'BBall numbers assigned':'Sequential numbers assigned')};
            return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <div style={{width:36,height:36,borderRadius:6,background:'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>#️⃣</div>
                <span style={{fontWeight:700,fontSize:13}}>Numbers</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <span style={{fontSize:11,color:'#64748b'}}>{showRoster?filledNums+'/'+qty+' assigned':qty+' pcs'}</span>
                <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:11}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                  <span style={{fontSize:11}}>Sell: <$In value={deco.sell_override||dp.sell} onChange={v=>uD(idx,di,'sell_override',v)} w={50}/></span>
                  <span style={{fontSize:10,color:decoMPct>0?'#166534':'#dc2626',fontWeight:600}}>{decoMPct}%</span>
                  <span style={{fontSize:11,color:'#475569',fontWeight:700}}>${decoTotal.toFixed(2)}</span>
                  <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                </div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Method:</span>
                <Bg options={[{value:'heat_transfer',label:'Heat Transfer'},{value:'embroidery',label:'Embroidery'},{value:'screen_print',label:'Screen Print'}]} value={nm} onChange={v=>{const ns=NUM_SZ[v]||[];const upd={...o.items[idx].decorations[di],num_method:v,num_size:ns[Math.min(2,ns.length-1)]||ns[0]||'4"',num_font:null,custom_font_art_id:null};uI(idx,'decorations',o.items[idx].decorations.map((dd,ii)=>ii===di?upd:dd))}}/>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',marginLeft:4}}>Size:</span>
                <Bg options={szOpts.map(s=>({value:s,label:s}))} value={deco.num_size||szOpts[0]} onChange={v=>uD(idx,di,'num_size',v)}/>
                <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginLeft:4}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>uD(idx,di,'two_color',e.target.checked)}/> 2-Color (+$3)</label>
              </div>
              {/* Font selection */}
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Font:</span>
                {nm==='embroidery'&&<span style={{fontSize:12,color:'#475569'}}>Block (standard)</span>}
                {nm==='screen_print'&&<><Bg options={[{value:'block',label:'Block'},{value:'serif',label:'Serif'}]} value={deco.num_font||'block'} onChange={v=>uD(idx,di,'num_font',v)}/>
                  {!deco.custom_font_art_id&&<button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>or Custom Font Art</button>}
                  {deco.custom_font_art_id&&<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
                {nm==='heat_transfer'&&<>{!deco.custom_font_art_id?<><span style={{fontSize:12,color:'#475569'}}>Standard</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>Use Custom Font Art</button></>
                  :<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
              </div>
              {/* Toggle number assignment */}
              {!showRoster?<button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>uD(idx,di,'_showRoster',true)}>📋 Assign Numbers ({qty} pcs)</button>
              :<div style={{marginTop:6,padding:10,background:'#f8fafc',borderRadius:6,border:'1px dashed #d1d5db'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6';e.currentTarget.style.background='#eff6ff'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='#f8fafc'}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='#f8fafc';
                  const f=e.dataTransfer.files[0];if(!f)return;const reader=new FileReader();
                  reader.onload=ev=>{const lines=ev.target.result.split('\n').filter(l=>l.trim());
                    const nr={...roster};let ct=0;
                    lines.forEach(line=>{if(line.toLowerCase().startsWith('size'))return;
                      const parts=line.split(',').map(s=>s.trim());const[sz,num]=parts;
                      if(sz&&num&&item.sizes[sz]>0){if(!nr[sz])nr[sz]=Array(item.sizes[sz]||0).fill('');
                        const ei=nr[sz].findIndex(v=>!v);if(ei>=0){nr[sz][ei]=num;ct++}}});
                    uD(idx,di,'roster',nr);nf(ct+' numbers imported')};reader.readAsText(f)}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Number Assignment <span style={{fontWeight:400,fontSize:10}}>(drag CSV here)</span></div>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#dbeafe',borderColor:'#93c5fd',color:'#1e40af'}} onClick={()=>autoFillNums('bball')}>🏀 BBall #s</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#dcfce7',borderColor:'#86efac',color:'#166534'}} onClick={()=>autoFillNums('sequential')}>🔢 Small→Large</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{
                      let csv='Size,Number\n';sizedQtys.forEach(([sz,sqty])=>{for(let i=0;i<sqty;i++)csv+=sz+',\n'});
                      const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
                      const a=document.createElement('a');a.href=url;a.download='number_template_'+item.sku+'.csv';a.click();URL.revokeObjectURL(url)}}>📥 Template</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{
                      const csv=prompt('Paste (Size,Number per line):\nM,12\nL,34');
                      if(csv){const nr={...roster};csv.split('\n').forEach(line=>{const[sz,num]=line.split(',').map(s=>s.trim());
                        if(sz&&num){if(!nr[sz])nr[sz]=Array(item.sizes[sz]||0).fill('');const ei=nr[sz].findIndex(v=>!v);if(ei>=0)nr[sz][ei]=num}});
                        uD(idx,di,'roster',nr);nf('Imported')}}}>📋 Paste</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,color:'#dc2626'}} onClick={()=>{uD(idx,di,'roster',{});nf('Cleared')}}>Clear</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>uD(idx,di,'_showRoster',false)}>▲ Close</button>
                  </div></div>
                {sizedQtys.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes above first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {sizedQtys.map(([sz,sqty])=>{const szRoster=roster[sz]||[];
                    return<div key={sz} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{width:50,fontSize:12,fontWeight:700,color:'#1e40af'}}>{sz} ({sqty})</span>
                      {Array.from({length:sqty}).map((_,si)=><input key={si} style={{width:38,textAlign:'center',border:'1px solid #d1d5db',borderRadius:3,padding:'3px 2px',fontSize:12,fontWeight:600,background:szRoster[si]?'#dbeafe':'white'}} value={szRoster[si]||''} placeholder="—" onChange={e=>{const nr={...roster};const arr=[...(nr[sz]||Array(sqty).fill(''))];arr[si]=e.target.value;nr[sz]=arr;uD(idx,di,'roster',nr)}}/>)}
                    </div>})}
                </div>}
                {filledNums>0&&<div style={{fontSize:10,color:'#64748b',marginTop:4}}>{filledNums}/{qty} assigned</div>}
              </div>}
            </div>)}
            // OUTSIDE DECORATION
            if(deco.kind==='outside_deco'){return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:18}}>🎨</span>
                <span style={{fontWeight:700,fontSize:13,color:'#7c3aed'}}>Outside Decoration</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <div style={{marginLeft:'auto'}}><button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button></div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6,padding:'8px 10px',background:'#faf5ff',borderRadius:6,border:'1px solid #ede9fe'}}>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#7c3aed'}}>Vendor</span>
                  <select className="form-select" style={{width:160,fontSize:12}} value={deco.vendor||''} onChange={e=>uD(idx,di,'vendor',e.target.value)}>
                    <option value="">Select vendor...</option>{DECO_VENDORS.map(dv=><option key={dv} value={dv}>{dv}</option>)}</select></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#7c3aed'}}>Deco Type</span>
                  <select className="form-select" style={{width:120,fontSize:12}} value={deco.deco_type||'embroidery'} onChange={e=>uD(idx,di,'deco_type',e.target.value)}>
                    {['embroidery','screen_print','dtf','heat_transfer','sublimation','vinyl'].map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}</select></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#dc2626'}}>Cost /ea</span><$In value={deco.cost_each||0} onChange={v=>uD(idx,di,'cost_each',v)} w={60}/></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#166534'}}>Sell /ea</span><$In value={deco.sell_each||0} onChange={v=>{uDM(idx,di,{sell_each:v,sell_override:v})}} w={60}/></div>
                <div style={{display:'flex',flexDirection:'column',gap:2,flex:1}}><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Notes</span>
                  <input className="form-input" style={{fontSize:11,padding:'4px 6px'}} value={deco.notes||''} onChange={e=>uD(idx,di,'notes',e.target.value)} placeholder="Thread colors, instructions..."/></div>
              </div>
            </div>)}
            // NAMES decoration
            if(deco.kind==='names'){
              const sQ2=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
              const nd=deco.names||{};const nSell=safeNum(deco.sell_override||deco.sell_each||6);const nCost=safeNum(deco.cost_each||3);
              const nCt=Object.values(nd).flat().filter(v=>v&&v.trim()).length;
              return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:18}}>🏷️</span><span style={{fontWeight:700,fontSize:13}}>Names</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:12}}>$/ea: <$In value={nSell} onChange={v=>uD(idx,di,'sell_override',v)} w={40}/></span>
                  <span style={{fontSize:11,color:'#64748b'}}>{nCt} names = ${ (nCt*nSell).toFixed(2)}</span>
                  <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                </div></div>
              <div style={{padding:10,background:'#fffbeb',borderRadius:6,border:'1px dashed #f59e0b'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#f59e0b'}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#f59e0b';
                  const f=e.dataTransfer.files[0];if(!f)return;const reader=new FileReader();
                  reader.onload=ev=>{const lines=ev.target.result.split('\n').filter(l=>l.trim());const nn={...nd};let ct=0;
                    lines.forEach(line=>{if(line.toLowerCase().startsWith('size'))return;const parts=line.split(',').map(s=>s.trim());const sz=parts[0];const name=parts.length>=3?parts[2]:parts[1]||'';
                      if(sz&&name&&item.sizes[sz]>0){if(!nn[sz])nn[sz]=Array(item.sizes[sz]||0).fill('');const ei=nn[sz].findIndex(v=>!v);if(ei>=0){nn[sz][ei]=name;ct++}}});
                    uD(idx,di,'names',nn);nf(ct+' names imported')};reader.readAsText(f)}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#92400e'}}>Drag CSV or enter names</span>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{let csv='Size,Number,Name\n';sQ2.forEach(([sz,sq])=>{for(let i=0;i<sq;i++)csv+=sz+',,\n'});const b=new Blob([csv],{type:'text/csv'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='name_template_'+item.sku+'.csv';a.click();URL.revokeObjectURL(u)}}>📥 Template</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,color:'#dc2626'}} onClick={()=>{uD(idx,di,'names',{});nf('Cleared')}}>Clear</button></div></div>
                {sQ2.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {sQ2.map(([sz,sq])=>{const sn=nd[sz]||[];return<div key={sz} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{width:50,fontSize:12,fontWeight:700,color:'#92400e'}}>{sz} ({sq})</span>
                    {Array.from({length:sq}).map((_,si)=><input key={si} style={{width:100,border:'1px solid #d1d5db',borderRadius:3,padding:'3px 6px',fontSize:12,background:sn[si]?'#fef3c7':'white'}} value={sn[si]||''} placeholder="Name" onChange={e=>{const nn2={...nd};const ar=[...(nn2[sz]||Array(sq).fill(''))];ar[si]=e.target.value;nn2[sz]=ar;uD(idx,di,'names',nn2)}}/>)}
                  </div>})}</div>}
              </div></div>)}
            return null})}
          {safeDecos(item).length>0&&<div style={{display:'flex',justifyContent:'flex-end',padding:'6px 12px',background:'#f0f9ff',borderRadius:6,marginTop:4,gap:16,alignItems:'center'}}>
            <span style={{fontSize:11,color:'#64748b'}}>Garment: ${(qty*safeNum(item.unit_sell)).toFixed(2)}</span>
            <span style={{fontSize:11,color:'#64748b'}}>Deco: ${(()=>{let d=0;safeDecos(item).forEach(dd=>{const cq2=dd.kind==='art'&&dd.art_file_id?artQty[dd.art_file_id]:qty;const dp2=dP(dd,qty,af,cq2);d+=qty*(dd.sell_override||dp2.sell)});return d.toFixed(2)})()}</span>
            <span style={{fontSize:12,fontWeight:800,color:'#1e40af'}}>All-In: ${(()=>{let t=qty*safeNum(item.unit_sell);safeDecos(item).forEach(dd=>{const cq2=dd.kind==='art'&&dd.art_file_id?artQty[dd.art_file_id]:qty;const dp2=dP(dd,qty,af,cq2);t+=qty*(dd.sell_override||dp2.sell)});return t.toFixed(2)})()}</span>
          </div>}
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addArtDeco(idx)}><Icon name="image" size={12}/> + Add Art</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNumDeco(idx)}>#️⃣ + Numbers</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNameDeco(idx)}>🏷️ + Names</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#faf5ff',borderColor:'#ddd6fe',color:'#7c3aed'}} onClick={()=>addOutsideDeco(idx)}>🎨 + Outside Deco</button>
            {safeDecos(item).length===0&&!item.no_deco&&<button className="btn btn-sm" style={{background:'#fef3c7',color:'#92400e',border:'1px solid #f59e0b',fontSize:10}} onClick={()=>uI(idx,'no_deco',true)}>✓ No Deco (Blank)</button>}
            {item.no_deco&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:4,background:'#f1f5f9',color:'#64748b',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>🚫 No Decoration <button onClick={()=>uI(idx,'no_deco',false)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:12,padding:0,marginLeft:2}}>✕</button></span>}
            {safeDecos(item).length===0&&!item.no_deco&&<span style={{fontSize:10,color:'#dc2626',fontWeight:600}}>⚠️ No deco assigned</span>}
          </div>
        </div>
      </div>)})}
    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAdd?<div style={{display:'flex',gap:6}}><button className="btn btn-primary" onClick={()=>setShowAdd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      <button className="btn btn-secondary" onClick={()=>setShowCustom(!showCustom)} disabled={!cust}><Icon name="plus" size={14}/> Custom Item</button>
      <button className="btn btn-secondary" style={{marginLeft:'auto'}} onClick={()=>setNsImport({step:'paste',raw:'',parsed:[],decoLines:[],issues:[]})} disabled={!cust}>📥 Import from NetSuite</button></div>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search SKU, name, brand..." value={pS} onChange={e=>setPS(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:250,overflow:'auto'}}>{fp.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addP(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:600}}>{p.name}</span><span className="badge badge-blue">{p.brand}</span>
          {p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} clr</span>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>${p.nsa_cost?.toFixed(2)}</span></div>)}</div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('')}} style={{marginTop:8}}>Cancel</button>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setShowCustom(true)}} style={{marginTop:8,marginLeft:4}}>+ Custom Item</button></div>}
    </div></div>
    {showCustom&&<div className="card" style={{marginTop:8,borderLeft:'3px solid #d97706'}}><div style={{padding:'14px 18px'}}>
      <div style={{fontWeight:700,marginBottom:8}}>✏️ Custom Item {custItem.name&&<span style={{fontWeight:400,fontSize:12,color:'#64748b'}}>— {custItem.name}</span>}</div>
      <div style={{display:'grid',gridTemplateColumns:'120px 1fr 120px',gap:8,marginBottom:8}}>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Brand / Vendor</label><SearchSelect options={D_V.map(v=>({value:v.id,label:v.name}))} value={custItem.vendor_id} onChange={vid=>{const vn=D_V.find(v=>v.id===vid)?.name||'';setCustItem(x=>({...x,vendor_id:vid,brand:vn}))}} placeholder="Search vendors..."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Item Name</label><input className="form-input" value={custItem.name} onChange={e=>setCustItem(x=>({...x,name:e.target.value}))} placeholder="Custom jersey, special order hat, etc."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Color</label><input className="form-input" value={custItem.color} onChange={e=>setCustItem(x=>({...x,color:e.target.value}))} placeholder="Navy"/></div></div>

      {/* Pricing section — brand-aware */}
      {(()=>{const brandName=D_V.find(v=>v.id===custItem.vendor_id)?.name||'';const au=isAU(brandName);const tier=cust?.adidas_ua_tier||'B';const disc=tD[tier]||0.35;const mk=o.default_markup||1.65;
        return<>
          <div style={{padding:8,background:au?'#eff6ff':'#f8fafc',borderRadius:6,marginBottom:8,fontSize:11}}>
            {au?<><strong>💎 {brandName} — Tier {tier}:</strong> Retail × {Math.round((1-disc)*100)}% = Your Cost. Sell price auto-calculated.</>
                :<><strong>📦 Standard Pricing:</strong> Cost × {mk}x markup = Sell price. {brandName?'Brand: '+brandName:'Select brand above.'}</>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'100px 100px 100px 100px 1fr',gap:8,marginBottom:8,alignItems:'end'}}>
            <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>SKU</label><input className="form-input" value={custItem.sku} onChange={e=>setCustItem(x=>({...x,sku:e.target.value}))}/></div>
            {au&&<div><label style={{fontSize:10,fontWeight:600,color:'#1e40af'}}>Retail $</label><$In value={custItem.retail_price||0} onChange={v=>{const cost=rQ(v*(1-disc));setCustItem(x=>({...x,retail_price:v,nsa_cost:cost,unit_sell:cost}))}}/></div>}
            <div><label style={{fontSize:10,fontWeight:600,color:au?'#64748b':'#166534'}}>{au?'Cost (auto)':'Cost $'}</label><$In value={custItem.nsa_cost} onChange={v=>{const sell=au?v:rQ(v*mk);setCustItem(x=>({...x,nsa_cost:v,...(!au&&{unit_sell:sell})}))}}/></div>
            <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Sell $</label><$In value={custItem.unit_sell} onChange={v=>setCustItem(x=>({...x,unit_sell:v}))}/></div>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              {custItem.nsa_cost>0&&<span style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>
                {au&&custItem.nsa_cost>0&&custItem.unit_sell>0?Math.round((custItem.unit_sell-custItem.nsa_cost)/custItem.unit_sell*100)+'% margin':custItem.nsa_cost>0?(custItem.unit_sell/custItem.nsa_cost).toFixed(2)+'x markup':''}
                {custItem.unit_sell>custItem.nsa_cost&&<span style={{color:'#166534',marginLeft:4}}>(${rQ(custItem.unit_sell-custItem.nsa_cost).toFixed(2)} margin)</span>}
              </span>}
            </div></div>
        </>})()}
      <div style={{display:'flex',gap:4}}>
        <button className="btn btn-primary" disabled={!custItem.name} onClick={()=>{const brandName=D_V.find(v=>v.id===custItem.vendor_id)?.name||'Custom';
          sv('items',[...o.items,{product_id:null,sku:custItem.sku||'CUSTOM',name:custItem.name,brand:brandName,vendor_id:custItem.vendor_id,color:custItem.color,nsa_cost:custItem.nsa_cost,retail_price:custItem.retail_price||0,unit_sell:custItem.unit_sell,available_sizes:['S','M','L','XL','2XL'],sizes:{},decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:0}]:[],is_custom:true}]);
          setShowCustom(false);setCustItem({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:''})}}>Add Item</button>
        <button className="btn btn-secondary" onClick={()=>setShowCustom(false)}>Cancel</button></div>
    </div></div>}

    {/* NETSUITE IMPORT WIZARD */}
    {nsImport&&<div className="modal-overlay" onClick={()=>setNsImport(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:900,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header" style={{background:'#eff6ff'}}><h2>📥 Import from NetSuite</h2><button className="modal-close" onClick={()=>setNsImport(null)}>×</button></div>
      <div className="modal-body">

      {/* STEP 1: Paste data */}
      {nsImport.step==='paste'&&<>
        <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>
          Copy the line items from your NetSuite Sales Order (ITEM through INVOICED columns) and paste below. The parser handles:
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          {['Size-split lines (JJ0605-M, JJ0605-L → one item)','Custom/misc lines with sizes in description','Decoration lines (Screen Print, Embroidery)','PO references and fulfillment data','Shipping lines'].map(t=>
            <span key={t} style={{fontSize:10,padding:'2px 8px',background:'#f0fdf4',borderRadius:8,color:'#166534'}}>✓ {t}</span>)}
        </div>
        <textarea className="form-input" rows={14} value={nsImport.raw} onChange={e=>setNsImport(x=>({...x,raw:e.target.value}))}
          placeholder={"Paste NetSuite lines here...\n\nExample:\nJJ0605 : JJ0605-M\tAdidas PRACTICE 2.0J - Power Red - M\t30\tAdidas Contract\t21.00\t630.00\tPO4133 OLuF\n..."} style={{fontFamily:'monospace',fontSize:11,whiteSpace:'pre'}}/>
        <div style={{marginTop:8,display:'flex',gap:8}}>
          <button className="btn btn-primary" disabled={!nsImport.raw.trim()} onClick={()=>{
            // PARSE NETSUITE DATA
            const lines=nsImport.raw.trim().split('\n').filter(l=>l.trim());
            const items={};const decoLines=[];const issues=[];const shipping=[];
            const SZ_RE=/[-\s](XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|YXS|YS|YM|YL|YXL|OSFA)$/i;
            const SZ_DESC=/\b(\d+)\s*\/\s*(S|M|L|XL|2XL|3XL|4XL|XXS|XS|YS|YM|YL|YXL)\b/gi;
            const DECO_RE=/^(screen\s*print|embroidery|dtf|heat\s*transfer|vinyl|sublimation)/i;

            lines.forEach((line,li)=>{
              const cols=line.split('\t').map(c=>c.trim());
              if(cols.length<4){issues.push({line:li+1,msg:'Too few columns: "'+line.slice(0,60)+'"'});return}
              const rawItem=cols[0]||'';const desc=cols[1]||'';const qty=parseInt(cols[2])||0;
              const priceLevel=cols[3]||'';const rate=parseFloat(cols[4])||0;const amount=parseFloat(cols[5])||0;
              const poRef=cols[6]||'';

              // Skip header rows
              if(rawItem.toUpperCase()==='ITEM'||desc.toUpperCase()==='DESCRIPTION')return;

              // Shipping line
              if(rawItem.toLowerCase().includes('shipping')||desc.toLowerCase().includes('shipping')){
                shipping.push({desc,amount});return}

              // Decoration line
              if(DECO_RE.test(desc)||rawItem.toLowerCase().includes('screen')||rawItem.toLowerCase().includes('embroid')){
                decoLines.push({rawItem,desc,qty,rate,amount,poRef});return}

              // Check if this is a size-suffixed SKU (JJ0605-M, IT0266-XL, JX4452-2XL)
              const skuParts=rawItem.split(/\s*:\s*/);const itemCode=skuParts[0]||rawItem;
              const sizeMatch=(skuParts[1]||itemCode).match(SZ_RE);
              let baseSku,size;
              if(sizeMatch){
                size=sizeMatch[1].toUpperCase();
                baseSku=(skuParts[1]||itemCode).replace(SZ_RE,'').replace(/-$/,'').trim();
                if(!baseSku)baseSku=itemCode.replace(SZ_RE,'').replace(/-$/,'').trim();
              } else {
                // Try extracting from description (Misc Adi lines with sizes in desc)
                baseSku=itemCode;size=null;
              }

              // Extract color from description
              let color='';const colorMatch=desc.match(/[-–]\s*([A-Za-z\s\/]+?)(?:\s*[-–]\s*(?:XXS|XS|S|M|L|XL|2XL|3XL|4XL))?$/);
              if(colorMatch&&size)color=desc.replace(colorMatch[0],'').replace(/^.*?[-–]\s*/,'').replace(/^.*?[-–]\s*/,'').trim();
              if(!color){const cM=desc.match(/[-–]\s*([A-Za-z\s\/]+?)(?:\s*[-–]|$)/);if(cM)color=cM[1].trim()}

              // Determine brand from price level or description
              let brand='';
              if(priceLevel.toLowerCase().includes('adidas'))brand='Adidas';
              else if(priceLevel.toLowerCase().includes('under armour')||priceLevel.toLowerCase().includes('ua'))brand='Under Armour';
              else if(priceLevel.toLowerCase().includes('nike'))brand='Nike';
              else if(desc.toLowerCase().includes('adidas'))brand='Adidas';
              else if(desc.toLowerCase().includes('under armour'))brand='Under Armour';

              if(size&&baseSku){
                // Size-split line — collapse into parent item
                if(!items[baseSku])items[baseSku]={sku:baseSku,name:desc.replace(/\s*[-–]\s*(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i,'').replace(/\s*[-–]\s*[A-Za-z\s\/]+?\s*[-–]\s*(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i,'').trim(),brand,color,rate,sizes:{},totalQty:0,totalAmt:0,poRef,priceLevel,issues:[]};
                items[baseSku].sizes[size]=(items[baseSku].sizes[size]||0)+qty;
                items[baseSku].totalQty+=qty;items[baseSku].totalAmt+=amount;
                if(color&&!items[baseSku].color)items[baseSku].color=color;
              } else {
                // Single-line item — try to parse sizes from description
                const embeddedSizes={};let match;const sizeRe2=/(\d+)\s*\/\s*(S|M|L|XL|2XL|3XL|4XL|XXS|XS|YS|YM|YL|YXL)/gi;
                while((match=sizeRe2.exec(desc))!==null){embeddedSizes[match[2].toUpperCase()]=parseInt(match[1])}
                const hasSizes=Object.keys(embeddedSizes).length>0;
                const key=baseSku+'_'+li;
                items[key]={sku:baseSku==='Misc Adi'?'CUSTOM':baseSku,name:desc,brand,color,rate,
                  sizes:hasSizes?embeddedSizes:{OSFA:qty},totalQty:qty,totalAmt:amount,poRef,priceLevel,
                  is_custom:baseSku.toLowerCase().includes('misc')||priceLevel.toLowerCase()==='custom',
                  issues:hasSizes?[]:['Sizes parsed from description — verify']};
                if(!hasSizes&&qty>1)items[key].issues.push('Single quantity line — may need size breakdown');
              }
            });

            const parsed=Object.values(items);
            setNsImport(x=>({...x,step:'review',parsed,decoLines,issues,shipping}));
          }}>🔍 Parse Data</button>
          <button className="btn btn-secondary" onClick={()=>setNsImport(null)}>Cancel</button>
        </div>
      </>}

      {/* STEP 2: Review parsed items */}
      {nsImport.step==='review'&&<>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <div style={{padding:8,background:'#f0fdf4',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:'#166534'}}>{nsImport.parsed.length}</div><div style={{fontSize:10,color:'#64748b'}}>Items Found</div></div>
          <div style={{padding:8,background:'#ede9fe',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:'#6d28d9'}}>{nsImport.decoLines.length}</div><div style={{fontSize:10,color:'#64748b'}}>Deco Lines</div></div>
          <div style={{padding:8,background:nsImport.issues.length?'#fef2f2':'#f8fafc',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:nsImport.issues.length?'#dc2626':'#94a3b8'}}>{nsImport.issues.length}</div><div style={{fontSize:10,color:'#64748b'}}>Issues</div></div>
        </div>

        {nsImport.issues.length>0&&<div style={{marginBottom:8,padding:8,background:'#fef2f2',borderRadius:6}}>
          <div style={{fontSize:11,fontWeight:700,color:'#dc2626',marginBottom:4}}>⚠️ Parser Issues</div>
          {nsImport.issues.map((is,i)=><div key={i} style={{fontSize:10,color:'#991b1b'}}>Line {is.line}: {is.msg}</div>)}
        </div>}

        <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:6}}>📦 Parsed Items — Review & Edit</div>
        <div style={{maxHeight:350,overflow:'auto',border:'1px solid #e2e8f0',borderRadius:6}}>
          <table style={{fontSize:11}}><thead><tr><th style={{width:30}}>✓</th><th>SKU</th><th>Name</th><th>Brand</th><th>Color</th><th>Rate</th><th>Sizes</th><th>Qty</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>{nsImport.parsed.map((it,i)=>{
            const toggle=()=>setNsImport(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,_skip:!p._skip}:p)}));
            const upd=(k,v)=>setNsImport(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,[k]:v}:p)}));
            return<tr key={i} style={{opacity:it._skip?0.4:1,background:it.issues?.length?'#fffbeb':'white'}}>
              <td><input type="checkbox" checked={!it._skip} onChange={toggle}/></td>
              <td><input className="form-input" value={it.sku} onChange={e=>upd('sku',e.target.value)} style={{width:80,fontSize:10,fontFamily:'monospace'}}/></td>
              <td style={{maxWidth:180}}><input className="form-input" value={it.name} onChange={e=>upd('name',e.target.value)} style={{width:'100%',fontSize:10}}/></td>
              <td><input className="form-input" value={it.brand} onChange={e=>upd('brand',e.target.value)} style={{width:70,fontSize:10}}/></td>
              <td><input className="form-input" value={it.color} onChange={e=>upd('color',e.target.value)} style={{width:70,fontSize:10}}/></td>
              <td style={{textAlign:'right',fontWeight:600}}>${it.rate?.toFixed(2)}</td>
              <td style={{fontSize:9}}>{Object.entries(it.sizes||{}).map(([s,q])=>s+':'+q).join(', ')}</td>
              <td style={{textAlign:'center',fontWeight:700}}>{it.totalQty}</td>
              <td style={{textAlign:'right'}}>${it.totalAmt?.toFixed(2)}</td>
              <td>{it.is_custom&&<span style={{fontSize:8,background:'#fef3c7',padding:'1px 4px',borderRadius:3,color:'#92400e'}}>Custom</span>}
                {(it.issues||[]).map((iss,ii)=><div key={ii} style={{fontSize:8,color:'#d97706'}}>⚠ {iss}</div>)}</td>
            </tr>})}</tbody></table>
        </div>

        {nsImport.decoLines.length>0&&<>
          <div style={{fontSize:12,fontWeight:700,color:'#7c3aed',marginTop:12,marginBottom:6}}>🎨 Decoration Lines — Assign to Items</div>
          {nsImport.decoLines.map((d,di)=><div key={di} style={{padding:8,background:'#f8fafc',borderRadius:6,marginBottom:4,display:'flex',gap:8,alignItems:'center',fontSize:11}}>
            <span style={{fontWeight:700}}>{d.desc}</span>
            <span style={{color:'#64748b'}}>Qty: {d.qty} · ${d.rate?.toFixed(2)}/ea</span>
            <select className="form-select" style={{width:200,fontSize:10}} value={d._assignTo||'all'} onChange={e=>{
              const v=e.target.value;setNsImport(x=>({...x,decoLines:x.decoLines.map((dl,dli)=>dli===di?{...dl,_assignTo:v}:dl)}))}}>
              <option value="all">Apply to all items</option>
              {nsImport.parsed.filter(p=>!p._skip).map((p,pi)=><option key={pi} value={pi}>{p.sku} — {p.name?.slice(0,30)}</option>)}
            </select>
          </div>)}
        </>}

        {(nsImport.shipping||[]).length>0&&<div style={{marginTop:8,fontSize:11,color:'#64748b'}}>📦 Shipping: {nsImport.shipping.map(s=>s.desc+' $'+s.amount?.toFixed(2)).join(', ')}</div>}

        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setNsImport(x=>({...x,step:'paste'}))}>← Back</button>
          <button className="btn btn-primary" onClick={()=>{
            // Convert parsed items to SO line items
            const keeping=nsImport.parsed.filter(p=>!p._skip);
            const newItems=keeping.map(p=>{
              const au=isAU(p.brand);
              const sell=p.rate||0;const cost=au?rQ(sell):rQ(sell/(o.default_markup||1.65));
              const retail=au?rQ(sell/(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):0;
              const szKeys=Object.keys(p.sizes||{});
              return{product_id:null,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:cost,retail_price:retail,unit_sell:sell,
                available_sizes:szKeys.length>0?szKeys:['S','M','L','XL','2XL'],sizes:p.sizes||{},decorations:[],
                is_custom:p.is_custom||false,pick_lines:[],po_lines:[]};
            });
            // Apply deco lines
            nsImport.decoLines.forEach(d=>{
              const decoType=d.desc.toLowerCase().includes('embroid')?'embroidery':d.desc.toLowerCase().includes('dtf')?'dtf':'screen_print';
              const deco={kind:'art',position:'Front Center',art_file_id:null,sell_override:d.rate||0,_imported_desc:d.desc};
              if(d._assignTo==='all'||!d._assignTo){newItems.forEach(it=>{if(!it.decorations)it.decorations=[];it.decorations.push({...deco})})}
              else{const idx=parseInt(d._assignTo);if(newItems[idx]){if(!newItems[idx].decorations)newItems[idx].decorations=[];newItems[idx].decorations.push({...deco})}}
            });
            sv('items',[...o.items,...newItems]);
            if(nsImport.shipping?.length){const shipAmt=nsImport.shipping.reduce((a,s)=>a+s.amount,0);if(shipAmt>0){sv('shipping_type','flat');sv('shipping_value',shipAmt)}}
            setNsImport(null);
            nf('📥 Imported '+newItems.length+' items from NetSuite');
          }}>✅ Import {nsImport.parsed.filter(p=>!p._skip).length} Items</button>
        </div>
      </>}
      </div>
    </div></div>}
    </>}

    {/* ART LIBRARY TAB */}
    {tab==='art'&&<div className="card"><div className="card-header"><h2>Art Library</h2><button className="btn btn-sm btn-primary" onClick={addArt}><Icon name="plus" size={12}/> New Art Group</button></div>
      <div className="card-body">{af.length===0?<div className="empty">No art uploaded. Create art groups and add files.</div>:
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {af.map((art,i)=>{const usedIn=safeItems(o).reduce((a,it)=>a+safeDecos(it).filter(d=>d.art_file_id===art.id).length,0);
            return(<div key={art.id} style={{padding:14,background:'#f8fafc',borderRadius:8,border:art.status==='approved'?'2px solid #22c55e':'1px solid #e2e8f0'}}>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:48,height:48,background:art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':art.deco_type==='dtf'?'#fef3c7':'#f0fdf4',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:20}}>
                  {art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':art.deco_type==='dtf'?'🔥':'#️⃣'}</div>
                <div style={{flex:1}}>
                  {/* Name + Status */}
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}>
                    <input className="form-input" value={art.name} onChange={e=>uArt(i,'name',e.target.value)} placeholder="Art group name..." style={{fontWeight:700,fontSize:14,flex:1}}/>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600,flexShrink:0,background:art.status==='approved'?'#dcfce7':'#fef3c7',color:art.status==='approved'?'#166534':'#92400e'}}>{art.status}</span>
                  </div>
                  {/* Decoration Type */}
                  <div style={{marginBottom:6}}><span style={{fontSize:11,fontWeight:600,color:'#64748b',marginRight:6}}>Type:</span>
                    <Bg options={[{value:'screen_print',label:'Screen Print'},{value:'embroidery',label:'Embroidery'},{value:'dtf',label:'DTF'}]} value={art.deco_type} onChange={v=>uArt(i,'deco_type',v)}/></div>
                  {/* Colors / Thread */}
                  <div style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                    {(art.deco_type==='screen_print'||art.deco_type==='dtf')&&<div style={{flex:1,minWidth:150}}><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Ink Colors (one per line = color count)</label><textarea className="form-input" rows={3} value={art.ink_colors||''} onChange={e=>uArt(i,'ink_colors',e.target.value)} placeholder={"Navy PMS 289\nGold PMS 124\nWhite"} style={{fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>{art.ink_colors&&<div style={{fontSize:10,color:'#1e40af',marginTop:2}}>{art.ink_colors.split('\n').filter(l=>l.trim()).length} color(s)</div>}</div>}
                    {art.deco_type==='embroidery'&&<div style={{flex:1,minWidth:150}}><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Thread Colors</label><input className="form-input" value={art.thread_colors||''} onChange={e=>uArt(i,'thread_colors',e.target.value)} placeholder="e.g. Navy 2767, White, Silver 877" style={{fontSize:12}}/></div>}
                    <div style={{width:120}}><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Size (optional)</label><input className="form-input" value={art.art_size||''} onChange={e=>uArt(i,'art_size',e.target.value)} placeholder='e.g. 12" x 4"' style={{fontSize:12}}/></div>
                  </div>
                  {/* MOCKUP FILES — shared with customer */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#2563eb'}}>📎 MOCKUP FILES</span>
                      <span style={{fontSize:9,color:'#94a3b8'}}>Shared with customer</span>
                    </div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{(art.mockup_files||art.files||[]).map((fn,fi)=><span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#dbeafe',borderRadius:4,fontSize:11}}>
                      <Icon name="file" size={10}/>{fn}<button onClick={()=>{const mf=[...(art.mockup_files||art.files||[])];mf.splice(fi,1);uArt(i,'mockup_files',mf);if(!art.mockup_files)uArt(i,'files',[])}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>)}</div>
                    <div style={{border:'2px dashed #bfdbfe',borderRadius:6,padding:8,textAlign:'center',cursor:'pointer',background:'#eff6ff'}} onClick={()=>{const fn=art.name.replace(/\s+/g,'_')+'_mockup_'+(((art.mockup_files||art.files||[]).length)+1)+'.pdf';const mf=[...(art.mockup_files||art.files||[]),fn];uArt(i,'mockup_files',mf);if(!art.mockup_files)uArt(i,'files',[])}}>
                      <div style={{fontSize:10,color:'#2563eb'}}><Icon name="upload" size={12}/> Add mockup (PDF, PNG, JPG)</div></div>
                  </div>
                  {/* PRODUCTION FILES — internal only */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#d97706'}}>🔧 PRODUCTION FILES</span>
                      <span style={{fontSize:9,color:'#94a3b8'}}>Internal — not shared with customer</span>
                    </div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{(art.prod_files||[]).map((fn,fi)=><span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#fef3c7',borderRadius:4,fontSize:11}}>
                      <Icon name="file" size={10}/>{fn}<button onClick={()=>uArt(i,'prod_files',(art.prod_files||[]).filter((_,x)=>x!==fi))} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>)}</div>
                    <div style={{border:'2px dashed #fde68a',borderRadius:6,padding:8,textAlign:'center',cursor:'pointer',background:'#fffbeb'}} onClick={()=>{const ext=art.deco_type==='embroidery'?'.dst':art.deco_type==='screen_print'?'_seps.ai':'.pdf';const fn=art.name.replace(/\s+/g,'_')+'_prod_'+(((art.prod_files||[]).length)+1)+ext;uArt(i,'prod_files',[...(art.prod_files||[]),fn])}}>
                      <div style={{fontSize:10,color:'#d97706'}}><Icon name="upload" size={12}/> Add production file (DST, AI seps, PDF)</div></div>
                  </div>
                  {/* Notes */}
                  <input className="form-input" value={art.notes||''} onChange={e=>uArt(i,'notes',e.target.value)} placeholder="Notes..." style={{fontSize:12}}/>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginTop:6}}><span style={{fontSize:10,color:'#94a3b8'}}>Uploaded {art.uploaded} · Applied to {usedIn} decoration(s)</span></div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                  {art.status!=='approved'?<button className="btn btn-sm btn-primary" style={{fontSize:10}} onClick={()=>{uArt(i,'status','approved');nf('Art approved')}}>✓ Approve</button>
                  :<button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uArt(i,'status','uploaded')}>Unapprove</button>}
                  <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>rmArt(i)}><Icon name="trash" size={10}/></button>
                </div>
              </div>
            </div>)})}
        </div>}
      </div></div>}

    {/* MESSAGES TAB */}
    {isSO&&tab==='messages'&&(()=>{const soMsgs=(msgs||[]).filter(m=>m.so_id===o.id).sort((a,b)=>(a.ts||'').localeCompare(b.ts));
      const DEPTS=[{id:'all',label:'All',color:'#64748b'},{id:'art',label:'Art',color:'#7c3aed'},{id:'production',label:'Production',color:'#2563eb'},{id:'warehouse',label:'Warehouse',color:'#d97706'},{id:'sales',label:'Sales',color:'#166534'},{id:'accounting',label:'Accounting',color:'#dc2626'}];
      return<div className="card"><div className="card-header"><h2>Messages</h2><span style={{fontSize:12,color:'#64748b'}}>{soMsgs.length} message(s)</span></div>
        <div className="card-body">
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:12,maxHeight:400,overflow:'auto'}}>
            {soMsgs.length===0?<div className="empty">No messages yet. Start the conversation.</div>:
            soMsgs.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const isMe=m.author_id===cu.id;const unread=!(m.read_by||[]).includes(cu.id);
              const dept=DEPTS.find(d=>d.id===m.dept);
              return<div key={m.id} style={{padding:'10px 14px',borderRadius:8,background:isMe?'#dbeafe':'#f8fafc',border:unread?'2px solid #3b82f6':'1px solid #e2e8f0',marginLeft:isMe?40:0,marginRight:isMe?0:40}}
                onClick={()=>{if(unread&&onMsg){onMsg(msgs.map(mm=>mm.id===m.id?{...mm,read_by:[...(mm.read_by||[]),cu.id]}:mm))}}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:isMe?'#1e40af':'#475569'}}>{author?.name||'Unknown'}</span>
                    {dept&&dept.id!=='all'&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:dept.color+'20',color:dept.color}}>@{dept.label}</span>}
                  </div>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{m.ts}</span></div>
                <div style={{fontSize:13,color:'#0f172a'}}>{m.text}</div>
                {unread&&<div style={{fontSize:9,color:'#3b82f6',marginTop:2}}>● New</div>}
              </div>})}
          </div>
          {/* Message input with department tag */}
          <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
            {DEPTS.map(d=><button key={d.id} style={{fontSize:10,padding:'2px 8px',borderRadius:10,border:'1px solid '+(msgDept===d.id?d.color:'#e2e8f0'),background:msgDept===d.id?d.color+'15':'white',color:msgDept===d.id?d.color:'#94a3b8',cursor:'pointer',fontWeight:600}} onClick={()=>setMsgDept(d.id)}>@{d.label}</button>)}
          </div>
          <div style={{display:'flex',gap:8}}><input className="form-input" id="msg-input" placeholder="Type a message..." style={{flex:1}} onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){
            const nm={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,text:e.target.value.trim(),ts:new Date().toLocaleString(),read_by:[cu.id],dept:msgDept};
            if(onMsg)onMsg([...msgs,nm]);e.target.value='';setMsgDept('all');nf('Message sent')}}}/><button className="btn btn-primary" onClick={()=>{
            const inp=document.getElementById('msg-input');if(inp&&inp.value.trim()){
            const nm={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,text:inp.value.trim(),ts:new Date().toLocaleString(),read_by:[cu.id],dept:msgDept};
            if(onMsg)onMsg([...msgs,nm]);inp.value='';setMsgDept('all');nf('Message sent')}}}>Send</button></div>
        </div></div>})()}

        {/* LINKED TRANSACTIONS TAB */}
    {isSO&&tab==='transactions'&&<div className="card"><div className="card-header"><h2>Linked Transactions</h2></div><div className="card-body">
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {o.estimate_id&&<div style={{display:'flex',gap:12,alignItems:'center',padding:12,background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff'}}>
          <div style={{width:40,height:40,background:'#ede9fe',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="dollar" size={20}/></div>
          <div><div style={{fontWeight:700,color:'#7c3aed'}}>{o.estimate_id}</div><div style={{fontSize:12,color:'#64748b'}}>Source Estimate</div></div><span className="badge badge-green">Converted</span></div>}
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Purchase Orders</div><div style={{fontSize:12,color:'#94a3b8'}}>No POs linked yet (Phase 4)</div></div>
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Invoices</div><div style={{fontSize:12,color:'#94a3b8'}}>No invoices linked yet</div></div>
      </div></div></div>}

    {/* FIRM DATES TAB */}
    {isSO&&tab==='firm_dates'&&<div className="card"><div className="card-header"><h2>Firm Date Requests</h2><button className="btn btn-sm btn-primary" onClick={()=>sv('firm_dates',[...safeFirm(o),{item_desc:'',date:'',approved:false}])}><Icon name="plus" size={12}/> Add</button></div>
      <div className="card-body">{safeFirm(o).length===0?<div className="empty">No firm date requests</div>:
        <table><thead><tr><th>Item</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {safeFirm(o).map((fd,i)=>{const itemOpts=safeItems(o).map(it=>`${it.sku} - ${it.name}`);
          return<tr key={i}>
          <td><select className="form-select" value={fd.item_desc} onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}>
            <option value="">Select item...</option>{itemOpts.map(opt=><option key={opt}>{opt}</option>)}<option value="__custom">Other (type below)</option></select>
            {fd.item_desc==='__custom'&&<input className="form-input" style={{marginTop:4,fontSize:12}} placeholder="Custom description..." onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}/>}</td>
          <td><input className="form-input" type="date" value={fd.date||''} onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],date:e.target.value};sv('firm_dates',fds)}}/></td>
          <td>{fd.approved?<span className="badge badge-green">Approved</span>:<span className="badge badge-amber">Pending</span>}</td>
          <td><div style={{display:'flex',gap:4}}>{!fd.approved&&<button className="btn btn-sm btn-primary" onClick={()=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],approved:true};sv('firm_dates',fds);nf('Approved')}}>✓</button>}
            <button className="btn btn-sm btn-secondary" onClick={()=>sv('firm_dates',safeFirm(o).filter((_,x)=>x!==i))}><Icon name="trash" size={10}/></button></div></td></tr>})}</tbody></table>}</div></div>}

    {/* COSTS TAB — Expected vs Actual */}
    {isSO&&tab==='costs'&&(()=>{
        const costLines=[];
        safeItems(o).forEach((it,ii)=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          if(!qty)return;
          const expectedBlank=qty*safeNum(it.nsa_cost);
          const blankPOs=(it.po_lines||[]).filter(pl=>pl.po_type!=='outside_deco');
          const actualBlank=blankPOs.length>0?blankPOs.reduce((a,pl)=>{
            const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0);
            return a+poQty*safeNum(it.nsa_cost)},0):0;
          costLines.push({category:'Blanks',sku:it.sku,name:it.name,vendor:D_V.find(v=>v.id===it.vendor_id)?.name||it.brand||'—',
            qty,expected:expectedBlank,actual:actualBlank,poCount:blankPOs.length,
            poIds:blankPOs.map(p=>p.po_id).filter(Boolean).join(', '),
            allReceived:blankPOs.length>0&&blankPOs.every(p=>p.status==='received')});
          safeDecos(it).forEach(d=>{
            const dp=dP(d,qty,af,qty);
            const expectedDeco=qty*dp.cost;
            const matchingDPOs=(it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco');
            const actualDeco=matchingDPOs.reduce((a,pl)=>{
              const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!['unit_cost'].includes(k)&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0);
              return a+poQty*safeNum(pl.unit_cost)},0);
            const artF=af.find(a=>a.id===d.art_file_id);
            const isOutside=d.kind==='outside_deco'||matchingDPOs.length>0;
            if(dp.cost>0||actualDeco>0){
              costLines.push({category:isOutside?'Outside Deco':'In-House Deco',
                sku:it.sku,name:artF?.name||d.deco_type?.replace(/_/g,' ')||'Decoration',
                vendor:isOutside?(matchingDPOs[0]?.deco_vendor||d.vendor||'—'):'NSA In-House',
                qty,expected:expectedDeco,actual:isOutside?actualDeco:expectedDeco,
                poCount:matchingDPOs.length,poIds:matchingDPOs.map(p=>p.po_id).filter(Boolean).join(', '),
                allReceived:matchingDPOs.length>0&&matchingDPOs.every(p=>p.status==='received')});
            }
          });
        });
        if(costLines.length===0)return<div className="card"><div className="card-body"><div className="empty">No cost data — add items first</div></div></div>;
        const totalExpected=costLines.reduce((a,l)=>a+l.expected,0);
        const totalActual=costLines.reduce((a,l)=>a+l.actual,0);
        const variance=totalActual-totalExpected;
        const hasActuals=costLines.some(l=>l.poCount>0);
        // Shipping & freight costs for GP calculation
        const shipCostVal=safeNum(o._shipstation_cost||0);
        const freightVal=safeNum(o._inbound_freight||0);
        if(shipCostVal>0)costLines.push({category:'Shipping',sku:'—',name:'Outbound Shipping (ShipStation)',vendor:'ShipStation',qty:1,expected:shipCostVal,actual:shipCostVal,poCount:0,poIds:'',allReceived:true});
        if(freightVal>0)costLines.push({category:'Freight',sku:'—',name:'Inbound Freight (Supplier)',vendor:'Supplier',qty:1,expected:freightVal,actual:freightVal,poCount:0,poIds:'',allReceived:true});
        const cats={};costLines.forEach(l=>{if(!cats[l.category])cats[l.category]={expected:0,actual:0};cats[l.category].expected+=l.expected;cats[l.category].actual+=l.actual});

        return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between'}}>
          <h2>💰 Cost Breakdown — Expected vs Actual</h2>
          {hasActuals&&variance!==0&&<span style={{fontSize:12,fontWeight:700,padding:'4px 12px',borderRadius:8,
            background:variance>0?'#fef2f2':'#f0fdf4',color:variance>0?'#dc2626':'#166534'}}>
            {variance>0?'⚠️ Over':'✅ Under'} by ${Math.abs(variance).toFixed(2)}</span>}
        </div>
        <div className="card-body">
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            {Object.entries(cats).map(([cat,v])=>{const diff=v.actual-v.expected;
              return<div key={cat} style={{padding:'10px 14px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',minWidth:150,flex:1}}>
                <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>{cat}</div>
                <div style={{display:'flex',gap:16}}>
                  <div><div style={{fontSize:9,color:'#94a3b8'}}>Expected</div><div style={{fontSize:16,fontWeight:700,color:'#475569'}}>${v.expected.toFixed(2)}</div></div>
                  <div><div style={{fontSize:9,color:'#94a3b8'}}>Actual</div><div style={{fontSize:16,fontWeight:700,color:v.actual>0?'#0f172a':'#94a3b8'}}>{v.actual>0?'$'+v.actual.toFixed(2):'—'}</div></div>
                  {v.actual>0&&diff!==0&&<div><div style={{fontSize:9,color:'#94a3b8'}}>Variance</div><div style={{fontSize:16,fontWeight:700,color:diff>0?'#dc2626':'#166534'}}>{diff>0?'+':''}${diff.toFixed(2)}</div></div>}
                </div>
              </div>})}
            <div style={{padding:'10px 14px',background:variance>0?'#fef2f2':'#f0fdf4',borderRadius:8,border:'2px solid '+(variance>0?'#fca5a5':'#86efac'),minWidth:150}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>Total Cost</div>
              <div style={{display:'flex',gap:16}}>
                <div><div style={{fontSize:9,color:'#94a3b8'}}>Expected</div><div style={{fontSize:18,fontWeight:800,color:'#475569'}}>${totalExpected.toFixed(2)}</div></div>
                <div><div style={{fontSize:9,color:'#94a3b8'}}>Actual</div><div style={{fontSize:18,fontWeight:800,color:totalActual>0?'#0f172a':'#94a3b8'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</div></div>
              </div>
            </div>
          </div>
          <table><thead><tr><th>Category</th><th>Item / Service</th><th>Vendor</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Expected</th><th style={{textAlign:'right'}}>Actual</th><th style={{textAlign:'right'}}>Variance</th><th>PO(s)</th></tr></thead>
            <tbody>{costLines.map((l,i)=>{const diff=l.actual-l.expected;
              return<tr key={i} style={{background:diff>0?'#fef2f210':''}}>
                <td><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,
                  background:l.category==='Blanks'?'#dbeafe':l.category==='Outside Deco'?'#ede9fe':'#fef3c7',
                  color:l.category==='Blanks'?'#1e40af':l.category==='Outside Deco'?'#7c3aed':'#92400e'}}>{l.category}</span></td>
                <td><span style={{fontFamily:'monospace',fontWeight:700,color:'#475569',marginRight:6}}>{l.sku}</span>{l.name}</td>
                <td style={{fontSize:11,color:'#64748b'}}>{l.vendor}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{l.qty}</td>
                <td style={{textAlign:'right'}}>${l.expected.toFixed(2)}</td>
                <td style={{textAlign:'right',fontWeight:700,color:l.actual>0?'#0f172a':'#94a3b8'}}>{l.actual>0?'$'+l.actual.toFixed(2):'—'}</td>
                <td style={{textAlign:'right',fontWeight:700,color:diff>0?'#dc2626':diff<0?'#166534':'#94a3b8'}}>{l.poCount>0?(diff>0?'+':diff<0?'-':'')+'$'+Math.abs(diff).toFixed(2):'—'}</td>
                <td style={{fontSize:11,color:'#7c3aed',fontWeight:600}}>{l.poIds||<span style={{color:'#94a3b8'}}>No PO</span>}</td>
              </tr>})}</tbody>
            <tfoot><tr style={{fontWeight:800}}>
              <td colSpan={4} style={{textAlign:'right'}}>TOTALS</td>
              <td style={{textAlign:'right'}}>${totalExpected.toFixed(2)}</td>
              <td style={{textAlign:'right'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</td>
              <td style={{textAlign:'right',color:variance>0?'#dc2626':variance<0?'#166534':'#94a3b8'}}>{hasActuals?(variance>0?'+':'')+'$'+variance.toFixed(2):'—'}</td>
              <td></td>
            </tr></tfoot>
          </table>
          {/* Shipping & Freight overrides for GP / Commission calculation */}
          <div style={{marginTop:16,padding:14,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:8}}>Shipping & Freight Costs (for Gross Profit / Commission)</div>
            <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
              <div>
                <label className="form-label">Outbound Shipping (ShipStation)</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._shipstation_cost||0} onChange={v=>sv('_shipstation_cost',v)} w={90}/>
                  <span style={{fontSize:10,color:'#94a3b8'}}>default $0 until integration</span>
                </div>
              </div>
              <div>
                <label className="form-label">Inbound Freight (Supplier Bills)</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._inbound_freight||0} onChange={v=>sv('_inbound_freight',v)} w={90}/>
                  <span style={{fontSize:10,color:'#94a3b8'}}>from supplier bills tied to SO</span>
                </div>
              </div>
              <div style={{padding:'6px 12px',background:'#eff6ff',borderRadius:6,fontSize:11,color:'#1e40af'}}>
                <strong>GP Impact:</strong> These reduce gross profit and commission calculations.
                {(shipCostVal>0||freightVal>0)&&<span style={{marginLeft:6,fontWeight:700,color:'#dc2626'}}>-${(shipCostVal+freightVal).toFixed(2)}</span>}
              </div>
            </div>
          </div>
        </div></div>})()}

    <SendModal isOpen={showSend} onClose={()=>setShowSend(false)} estimate={o} customer={cust} onSend={()=>{sv('status','sent');sv('email_status','sent');onSave({...o,status:'sent',email_status:'sent'});nf('Estimate sent!')}}/>

    {/* FIRM DATE REQUEST MODAL */}
    {showFirmReq&&<div className="modal-overlay" onClick={()=>setShowFirmReq(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
      <div className="modal-header"><h2>📌 Request Firm Date</h2><button className="modal-close" onClick={()=>setShowFirmReq(false)}>x</button></div>
      <div className="modal-body">
        <div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:12}}>
          <div style={{fontWeight:700,color:'#1e40af'}}>{o.id}</div>
          <div style={{fontSize:12,color:'#64748b'}}>{cust?.name} — {o.memo}</div>
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Current expected: {o.expected_date||'Not set'}</div>
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">Requested Firm Date *</label>
          <input className="form-input" type="date" value={firmReqDate} onChange={e=>setFirmReqDate(e.target.value)}/>
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">Note to GM (Gayle)</label>
          <textarea className="form-input" rows={3} value={firmReqNote} onChange={e=>setFirmReqNote(e.target.value)} placeholder="e.g., Coach needs by this date for first game, already confirmed with Adidas they can ship by 3/5..."/>
        </div>
        <div style={{padding:10,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:6,fontSize:11,color:'#6d28d9'}}>
          <strong>Preview message to Gayle Peterson (GM):</strong>
          <div style={{marginTop:4,padding:8,background:'white',borderRadius:4,fontSize:12,color:'#374151'}}>
            <strong>{cu.name}</strong> is requesting a firm date for <strong>{o.id}</strong> ({cust?.name} — {o.memo}).<br/>
            📅 Requested: <strong>{firmReqDate||'—'}</strong><br/>
            {firmReqNote&&<>💬 {firmReqNote}<br/></>}
            <span style={{color:'#7c3aed',textDecoration:'underline'}}>→ Open {o.id}</span>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowFirmReq(false)}>Cancel</button>
        <button className="btn btn-primary" style={{background:'#7c3aed'}} disabled={!firmReqDate} onClick={()=>{
          // Create message in SO thread
          const msg={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,
            text:'📌 FIRM DATE REQUEST: '+firmReqDate+(firmReqNote?' — '+firmReqNote:''),
            ts:new Date().toLocaleString(),read_by:[cu.id],
            firm_request:true,firm_date:firmReqDate};
          onMsg(prev=>[...prev,msg]);
          // Add to firm_dates on the SO
          const fd=[...safeFirm(o),{item_desc:'Full Order',date:firmReqDate,approved:false,requested_by:cu.name,requested_at:new Date().toLocaleString(),note:firmReqNote}];
          sv('firm_dates',fd);
          setShowFirmReq(false);
          nf('Firm date request sent to GM!');
        }}>📌 Send Request to GM</button>
      </div>
    </div></div>}

    {/* CREATE INVOICE MODAL */}
    {showInvCreate&&(()=>{
      const items=safeItems(o);
      const selTotals=invSelItems.reduce((acc,idx)=>{
        const it=items[idx];if(!it)return acc;
        const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
        const rev=qty*safeNum(it.unit_sell);
        // Deco cost per item
        let decoRev=0;
        safeDecos(it).forEach(d=>{
          if(d.kind==='art'&&d.art_file_id){
            const artF=safeArt(o).find(a=>a.id===d.art_file_id);
            const dp=dP(d,qty,artF?[artF]:[],qty);
            decoRev+=qty*dp.sell;
          } else if(d.kind==='numbers'){
            const dp=dP(d,qty,[],qty);
            decoRev+=qty*dp.sell;
          }
        });
        return{items:acc.items+1,units:acc.units+qty,subtotal:acc.subtotal+rev+decoRev};
      },{items:0,units:0,subtotal:0});
      const invShip=invSelItems.length===items.length?totals.ship:0;
      const invTax=invSelItems.length===items.length?totals.tax:0;
      const invTotal=selTotals.subtotal+invShip+invTax;
      const pctOfTotal=totals.rev>0?Math.round(selTotals.subtotal/totals.rev*100):0;

      return<div className="modal-overlay" onClick={()=>setShowInvCreate(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
        <div className="modal-header"><h2>💰 Create Invoice — {o.id}</h2><button className="modal-close" onClick={()=>setShowInvCreate(false)}>×</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:6,marginBottom:12}}>
            <div style={{fontWeight:700,color:'#1e40af'}}>{o.id}</div>
            <div style={{fontSize:12,color:'#64748b'}}>{cust?.name} — {o.memo}</div>
            <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Order total: ${totals.total.toLocaleString()}</div>
          </div>

          {/* Invoice type */}
          <div style={{marginBottom:12}}>
            <label className="form-label">Invoice Type</label>
            <div style={{display:'flex',gap:6}}>
              {[['deposit','Deposit'],['progress','Progress'],['final','Final'],['custom','Custom']].map(([v,l])=>
                <button key={v} className={`btn btn-sm ${invType===v?'btn-primary':'btn-secondary'}`} onClick={()=>setInvType(v)}>{l}</button>)}
            </div>
          </div>

          {/* Memo */}
          <div style={{marginBottom:12}}>
            <label className="form-label">Invoice Memo</label>
            <input className="form-input" value={invMemo} onChange={e=>setInvMemo(e.target.value)} placeholder="e.g., Baseball Deposit 50%"/>
          </div>

          {/* Item selection with checkboxes */}
          <div style={{marginBottom:12}}>
            <label className="form-label">Items to Invoice</label>
            <div style={{display:'flex',gap:4,marginBottom:8}}>
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems(items.map((_,i)=>i))}>Select All</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems([])}>Clear</button>
            </div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
              {items.map((it,idx)=>{
                const sel=invSelItems.includes(idx);
                const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                const lineRev=qty*safeNum(it.unit_sell);
                let lineDeco=0;
                safeDecos(it).forEach(d=>{const dp2=dP(d,qty,safeArt(o),qty);lineDeco+=qty*dp2.sell});
                const lineTotal=lineRev+lineDeco;
                return<div key={idx} style={{padding:'10px 14px',borderBottom:idx<items.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10,cursor:'pointer',background:sel?'#eff6ff':'white'}} onClick={()=>setInvSelItems(sel?invSelItems.filter(i=>i!==idx):[...invSelItems,idx])}>
                  <input type="checkbox" checked={sel} readOnly style={{accentColor:'#2563eb',width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}><span style={{fontFamily:'monospace',color:'#1e40af'}}>{it.sku||'—'}</span> {safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{safeStr(it.color)||'—'} · {qty} units · ${safeNum(it.unit_sell).toFixed(2)}/ea{lineDeco>0?' + $'+lineDeco.toFixed(2)+' deco':''}</div>
                  </div>
                  <div style={{fontWeight:700,fontSize:13,color:sel?'#1e40af':'#94a3b8'}}>${lineTotal.toFixed(2)}</div>
                </div>})}
            </div>
          </div>

          {/* Summary */}
          <div style={{background:'#f8fafc',borderRadius:8,padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>Selected items</span>
              <span style={{fontSize:12,fontWeight:600}}>{selTotals.items} items · {selTotals.units} units</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>Line items subtotal</span>
              <span style={{fontSize:12,fontWeight:600}}>${selTotals.subtotal.toFixed(2)}</span>
            </div>
            {invSelItems.length===items.length&&<>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:12,color:'#64748b'}}>Shipping</span>
                <span style={{fontSize:12}}>${invShip.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:12,color:'#64748b'}}>Tax</span>
                <span style={{fontSize:12}}>${invTax.toFixed(2)}</span>
              </div>
            </>}
            {invSelItems.length!==items.length&&<div style={{fontSize:10,color:'#94a3b8',marginBottom:4}}>Shipping & tax apply when all items selected</div>}
            <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,borderTop:'2px solid #e2e8f0'}}>
              <span style={{fontSize:14,fontWeight:800}}>Invoice Total</span>
              <span style={{fontSize:18,fontWeight:800,color:'#dc2626'}}>${invTotal.toFixed(2)}</span>
            </div>
            {pctOfTotal>0&&pctOfTotal<100&&<div style={{fontSize:10,color:'#64748b',textAlign:'right'}}>{pctOfTotal}% of order total</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setShowInvCreate(false)}>Cancel</button>
          <button className="btn btn-primary" style={{background:'#dc2626',borderColor:'#dc2626'}} disabled={invSelItems.length===0} onClick={()=>{
            const invId='INV-'+o.id.replace('SO-','');
            const invDate=new Date().toLocaleDateString('en-CA');
            const termDays=parseInt((cust?.payment_terms||'net30').replace(/\D/g,''))||30;
            const due=new Date();due.setDate(due.getDate()+termDays);const dueDate=due.toLocaleDateString('en-CA');
            const lineItems=invSelItems.map(idx=>{const it=items[idx];if(!it)return null;const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
              const decoSell=safeDecos(it).reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp2=dP(d,qty,safeArt(o),cq);return a+dp2.sell},0);
              return{desc:it.sku+' '+it.name+(it.color?' — '+it.color:''),qty,rate:safeNum(it.unit_sell)+decoSell,amount:qty*(safeNum(it.unit_sell)+decoSell)}}).filter(Boolean);
            const inv={id:invId+'-'+(Date.now()%1000),type:'invoice',customer_id:o.customer_id,so_id:o.id,
              date:invDate,due_date:dueDate,total:Math.round(invTotal*100)/100,paid:0,
              memo:invMemo||invType+' — '+o.memo,status:'open',_rep:o.created_by||cu.id,
              tax:Math.round(invTax*100)/100,shipping:Math.round(invShip*100)/100,
              line_items:lineItems,
              items:invSelItems.map(idx=>{const it=items[idx];return{sku:it.sku,name:it.name,qty:Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0),unit_sell:safeNum(it.unit_sell)}})};
            onInv(prev=>[...prev,inv]);
            setShowInvCreate(false);
            nf('Invoice '+inv.id+' created for $'+invTotal.toFixed(2));
          }}>💰 Create Invoice — ${invTotal.toFixed(2)}</button>
        </div>
      </div></div>})()}

    {showPO&&(()=>{
      // Vendor selection or PO form
      const vendorMap={};safeItems(o).forEach((it,i)=>{const vk=it.vendor_id||D_V.find(v=>v.name===it.brand)?.id;if(!vk)return;if(!vendorMap[vk])vendorMap[vk]=[];vendorMap[vk].push({...it,_idx:i})});
      const unlinkedItems=safeItems(o).filter(it=>{const vk=it.vendor_id||D_V.find(v=>v.name===it.brand)?.id;return!vk&&Object.values(safeSizes(it)).some(v=>safeNum(v)>0)});
      if(showPO==='select')return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Create PO — Select Vendor</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">{Object.entries(vendorMap).map(([vk,items])=>{const vn=D_V.find(v=>v.id===vk)?.name||vk;
          const openCount=items.reduce((tot,it)=>{return tot+Object.entries(it.sizes).filter(([,v])=>v>0).reduce((a,[sz,v])=>{const picked=safePicks(it).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);return a+Math.max(0,v-picked-po)},0)},0);
          if(openCount===0)return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,opacity:0.5,display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:8,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="check" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#166534'}}>All items fully covered</div></div></div>;
          return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,cursor:'pointer',display:'flex',alignItems:'center',gap:12}} onClick={()=>setShowPO(vk)}>
            <div style={{width:40,height:40,borderRadius:8,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="package" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#64748b'}}>{items.length} item(s) — <span style={{color:'#dc2626',fontWeight:600}}>{openCount} units open</span></div></div>
            <Icon name="back" size={16} style={{transform:'rotate(180deg)'}}/></div>})}
          {unlinkedItems.length>0&&<div style={{borderTop:'2px solid #fca5a5',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',marginBottom:6}}>⚠️ Items Without Vendor — Cannot Order</div>
            {unlinkedItems.map((it,i)=><div key={i} style={{padding:'8px 12px',border:'1px solid #fca5a5',borderRadius:8,marginBottom:4,background:'#fef2f2'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>{it.sku||'No SKU'} — {it.name||'Unnamed'}</div>
              <div style={{fontSize:10,color:'#92400e'}}>Assign a vendor/brand to this item before creating a PO</div>
            </div>)}
          </div>}}
          {/* Outside Decoration PO section */}
          <div style={{borderTop:'2px solid #e2e8f0',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#7c3aed',textTransform:'uppercase',marginBottom:6}}>🎨 Outside Decoration PO</div>
            {DECO_VENDORS.filter(dv=>dv!=='Other').map(dv=><div key={dv} style={{padding:'12px 16px',border:'1px solid #ede9fe',borderRadius:8,marginBottom:6,cursor:'pointer',display:'flex',alignItems:'center',gap:12,background:'#faf5ff'}}
              onClick={()=>setShowPO('deco:'+dv)}>
              <div style={{width:40,height:40,borderRadius:8,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🎨</div>
              <div style={{flex:1}}><div style={{fontWeight:700}}>{dv}</div><div style={{fontSize:12,color:'#7c3aed'}}>Send items for outside decoration</div></div>
              <Icon name="back" size={16} style={{transform:'rotate(180deg)'}}/></div>)}
          </div>
        </div></div></div>;
      // OUTSIDE DECORATION PO FORM
      if(typeof showPO==='string'&&showPO.startsWith('deco:')){
        const decoVendor=showPO.replace('deco:','');
        const allItems=safeItems(o).map((it,i)=>({...it,_idx:i})).filter(it=>{
          const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return q>0});
        const poId='DPO-'+poCounter;
        return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
          <div className="modal-header"><h2 style={{color:'#7c3aed'}}>🎨 Deco PO — {decoVendor}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#faf5ff',border:'1px solid #ddd6fe',borderRadius:8,marginBottom:12,fontSize:12,color:'#6d28d9'}}>
              Sending items to <strong>{decoVendor}</strong> for outside decoration. PO #{poId} will be saved to this SO for cost tracking and commission calculation.
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
              <div><label className="form-label">PO Number</label><input className="form-input" value={poId} readOnly style={{color:'#7c3aed',fontWeight:700}}/></div>
              <div><label className="form-label">Deco Type</label><select className="form-select" id={'dpo-type-'+poId}>
                <option value="embroidery">Embroidery</option><option value="screen_print">Screen Print</option><option value="dtf">DTF</option><option value="heat_transfer">Heat Transfer</option><option value="sublimation">Sublimation</option></select></div>
              <div><label className="form-label">Expected Return</label><input className="form-input" type="date" id={'dpo-date-'+poId}/></div>
            </div>
            {allItems.map((it,vi)=>{const szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const soQ=szList.reduce((a,[,v])=>a+v,0);
              return<div key={vi} style={{padding:12,border:'1px solid #ede9fe',borderRadius:6,marginBottom:8,background:'#faf5ff'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#7c3aed',marginRight:8}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div><div style={{fontWeight:700}}>SO Qty: {soQ}</div></div>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Send Qty:</span>
                  {szList.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                    <input id={'dpo-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #ddd6fe',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}
                  <div style={{borderLeft:'2px solid #ede9fe',paddingLeft:8,marginLeft:4}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Unit Cost</div>
                    <input id={'dpo-cost-'+vi} style={{width:60,textAlign:'center',border:'1px solid #ddd6fe',borderRadius:4,padding:'4px 2px',fontSize:13,fontWeight:700}} defaultValue="0.00"/>
                  </div>
                </div>
              </div>})}
            <div style={{marginTop:8}}><label className="form-label">Notes / Instructions for Decorator</label><textarea className="form-input" rows={2} placeholder="Thread colors, PMS colors, placement notes..." id={'dpo-notes-'+poId} style={{resize:'vertical'}}/></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setShowPO('select')}>← Back</button>
            <button className="btn btn-secondary" onClick={()=>setShowPO(null)}>Cancel</button>
            <button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>{
              const updatedItems=o.items.map(it=>({...it,po_lines:[...(it.po_lines||[])]}));
              const decoType=document.getElementById('dpo-type-'+poId)?.value||'embroidery';
              const returnDate=document.getElementById('dpo-date-'+poId)?.value||'';
              const notes=document.getElementById('dpo-notes-'+poId)?.value||'';
              let totalQty=0,totalCost=0;
              allItems.forEach((it,vi)=>{
                const idx=it._idx;const poLine={po_id:poId,status:'waiting',po_type:'outside_deco',deco_vendor:decoVendor,deco_type:decoType,
                  expected_date:returnDate,created_at:new Date().toLocaleDateString(),memo:notes,received:{},shipments:[]};
                const szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0);
                const unitCost=parseFloat(document.getElementById('dpo-cost-'+vi)?.value)||0;
                let itemQty=0;
                szList.forEach(([sz])=>{
                  const el=document.getElementById('dpo-qty-'+vi+'-'+sz);
                  const qty=el?Math.max(0,parseInt(el.value)||0):0;
                  if(qty>0){poLine[sz]=qty;itemQty+=qty}
                });
                poLine.unit_cost=unitCost;
                if(itemQty>0){updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];totalQty+=itemQty;totalCost+=itemQty*unitCost}
              });
              if(totalQty===0){nf('No quantities entered','error');return}
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);
              setPOCounter(c=>c+1);setShowPO(null);
              nf('🎨 '+poId+' sent to '+decoVendor+' — '+totalQty+' units ($'+totalCost.toFixed(2)+')');
            }}>🎨 Create Deco PO — Send to {decoVendor}</button>
          </div>
        </div></div>;
      }
      // PO form for selected vendor — only show sizes that still need ordering (subtract picks + existing POs)
      const vItems=vendorMap[showPO]||[];const vn=D_V.find(v=>v.id===showPO)?.name||showPO;
      const poId='PO-'+poCounter;
      const batchKey=Object.keys(BATCH_VENDORS).find(k=>vn.toLowerCase().includes(k)||showPO.toLowerCase().includes(k));
      const isBatchEligible=!!batchKey;
      const batchConfig=batchKey?BATCH_VENDORS[batchKey]:null;
      const pendingBatches=(batchPOs||[]).filter(bp=>bp.vendor_key===batchKey);
      const pendingBatchTotal=pendingBatches.reduce((a,bp)=>a+bp.total_cost,0);
      const poItems=vItems.map(it=>{const szList=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
        const openSizes=szList.map(([sz,v])=>{const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,open]}).filter(([,v])=>v>0);
        return{...it,openSizes,totalOpen:openSizes.reduce((a,[,v])=>a+v,0)}}).filter(it=>it.totalOpen>0);
      return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>New PO — {vn}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">
          {/* Batch PO banner for eligible vendors */}
          {isBatchEligible&&<div style={{padding:10,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:8,marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:14}}>📦</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>Free shipping over ${batchConfig.threshold} — Batch eligible!</div>
                {pendingBatches.length>0?<div style={{fontSize:11,color:'#6d28d9'}}>{pendingBatches.length} PO{pendingBatches.length!==1?'s':''} in queue · ${pendingBatchTotal.toFixed(2)} total {pendingBatchTotal>=batchConfig.threshold?'✅ Threshold met!':'· $'+(batchConfig.threshold-pendingBatchTotal).toFixed(2)+' more to free ship'}</div>
                :<div style={{fontSize:11,color:'#94a3b8'}}>No POs queued yet for {batchConfig.name}</div>}
              </div>
            </div>
          </div>}
          {poItems.length===0?<div style={{padding:24,textAlign:'center',color:'#64748b'}}><div style={{fontSize:32,marginBottom:8}}>✅</div><div style={{fontWeight:700,fontSize:16,marginBottom:4}}>All items fully covered</div><div style={{fontSize:13}}>Every size has been assigned via IFs or existing POs.</div></div>:<>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
            <div><label className="form-label">PO Number</label><input className="form-input" value={poId} readOnly style={{color:'#1e40af',fontWeight:700}}/></div>
            <div><label className="form-label">Ship To</label><select className="form-select">{addrs.map(a=><option key={a.id}>{a.label}</option>)}</select></div>
            <div><label className="form-label">Expected Date</label><input className="form-input" type="date" id={'po-date-'+poId}/></div></div>
          {poItems.map((it,vi)=>{const soQ=Object.values(it.sizes).reduce((a,v)=>a+v,0);
            return<div key={vi} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div><div style={{fontWeight:700}}>SO Qty: {soQ} <span style={{color:'#dc2626',fontSize:12,marginLeft:6}}>Open: {it.totalOpen}</span></div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>PO Qty:</span>
                {it.openSizes.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}</div>
            </div>})}
          <div style={{marginTop:8}}><label className="form-label">Notes</label><input className="form-input" placeholder="PO notes for vendor..." id={'po-notes-'+poId}/></div></>}
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setShowPO('select')}>← Back</button><button className="btn btn-secondary" onClick={()=>setShowPO(null)}>Cancel</button>
          {poItems.length>0&&isBatchEligible&&<button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>{
            // Build batch PO entry
            const batchItems=[];let totalCost=0;
            poItems.forEach((pit,vi)=>{
              const sizes={};
              pit.openSizes.forEach(([sz,v])=>{const el=document.getElementById('po-qty-'+vi+'-'+sz);sizes[sz]=el?parseInt(el.value)||0:v});
              const qty=Object.values(sizes).reduce((a,v)=>a+v,0);
              totalCost+=qty*safeNum(pit.nsa_cost);
              batchItems.push({sku:pit.sku,name:pit.name,color:pit.color,sizes,qty,unit_cost:safeNum(pit.nsa_cost),item_idx:pit._idx});
            });
            const bp={id:'BPO-'+Date.now(),vendor_key:batchKey,vendor_name:batchConfig.name,so_id:o.id,so_memo:o.memo||'',customer:cust?.alpha_tag||cust?.name||'',
              items:batchItems,total_cost:totalCost,created_by:cu.id,created_by_name:cu.name,created_at:new Date().toLocaleString()};
            if(onBatchPO)onBatchPO(prev=>[...prev,bp]);
            setShowPO(null);nf('Added to '+batchConfig.name+' batch queue ($'+totalCost.toFixed(2)+')');
          }}><Icon name="package" size={14}/> Add to Batch</button>}
          {poItems.length>0&&<button className="btn btn-primary" onClick={()=>{
          // Save PO lines back to order items (immutable)
          const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
          poItems.forEach((pit,vi)=>{
            const idx=pit._idx;if(idx==null)return;
            const poLine={po_id:poId,status:'waiting',created_at:new Date().toLocaleDateString(),memo:'',received:{},shipments:[]};
            pit.openSizes.forEach(([sz,v])=>{
              const el=document.getElementById('po-qty-'+vi+'-'+sz);
              poLine[sz]=el?parseInt(el.value)||0:v;
            });
            const hasQty=Object.entries(poLine).some(([k,v])=>k!=='po_id'&&k!=='status'&&typeof v==='number'&&v>0);
            if(hasQty){
              updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];
            }
          });
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
          setO(updated);onSave(updated);
          setPOCounter(c=>c+1);setShowPO(null);nf(poId+' created for '+vn);
        }}><Icon name="cart" size={14}/> Create PO</button>}</div>
      </div></div>})()}

        {showPick&&<div className="modal-overlay" onClick={()=>setShowPick(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header"><h2>{typeof showPick==='object'?'IF — '+pickId:'Create IF — Select Items'}</h2><button className="modal-close" onClick={()=>setShowPick(false)}>x</button></div>
      {typeof showPick!=='object'?<div className="modal-body">
        <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Select items to include on this IF:</p>
        {safeItems(o).map((item,idx)=>{const q=Object.values(item.sizes).reduce((a,v)=>a+v,0);const szList=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=SZ_ORD;return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
          const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
          const hasOpen=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const inv=p?._inv?.[sz]||0;return v-picked-po>0&&inv>0});
          if(!hasOpen)return<div key={idx} style={{padding:10,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,opacity:0.5}}><span style={{fontWeight:700}}>{item.sku}</span> {item.name} — <span style={{color:'#166534',fontWeight:600}}>Fully assigned</span></div>;
          return<div key={idx} style={{padding:10,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>{
            const pickItems=safeItems(o).map((it,i)=>{if(i!==idx)return null;const szs2=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const pp=products.find(pp2=>pp2.id===it.product_id||pp2.sku===it.sku);
              return{...it,_idx:i,_pick:Object.fromEntries(szs2.map(([sz,v])=>{const inv=pp?._inv?.[sz]||0;const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,inv>0?Math.min(open,inv):0]}))}}).filter(Boolean);
            setShowPick(pickItems)}}>
            <input type="checkbox" checked={false} readOnly style={{width:18,height:18}}/>
            <div style={{flex:1}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:6}}>{item.sku}</span><strong>{item.name}</strong> — {item.color}
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{szList.map(([sz,v])=>{const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,v-picked-po);return open>0?sz+': '+open+' open ('+inv+' inv) ':'';}).filter(Boolean).join(' | ')}</div></div></div>})}
        <div style={{fontSize:11,color:'#94a3b8',marginTop:8}}>Click an item to create a IF for it. Multiple picks per order are supported.</div>
      </div>
      :<div className="modal-body">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div><div style={{fontSize:20,fontWeight:800}}>NATIONAL SPORTS APPAREL</div><div style={{fontSize:12,color:'#64748b'}}>Item Fulfillment</div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{pickId}</div><div style={{fontSize:14,fontWeight:700,color:'#475569'}}>{o.id}</div><div style={{fontSize:12,color:'#64748b'}}>{new Date().toLocaleDateString()}</div></div></div>
        <hr style={{border:'2px solid #0f172a',marginBottom:12}}/>
        <div style={{display:'flex',gap:40,marginBottom:12}}><div><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>CUSTOMER</div><div style={{fontWeight:700}}>{cust?.name}</div><div style={{fontSize:12,color:'#64748b'}}>{cust?.alpha_tag}</div></div>
          <div><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>SHIP TO</div><div style={{fontSize:12}}>{addrs.find(a=>a.id===o.ship_to_id)?.label||'—'}</div></div></div>
        {o.prod_notes&&<div style={{padding:'8px 12px',background:'#fef9c3',borderRadius:4,marginBottom:12,fontSize:13}}><strong>Notes:</strong> {o.prod_notes}</div>}
        {/* Shipping Destination */}
        <div style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:12,border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>Shipping Destination</div>
          <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
            {[['in_house','🏭 In-House Deco'],['ship_customer','📦 Ship to Customer'],['ship_deco','🚚 Ship to Deco']].map(([v,l])=>
              <button key={v} className={`btn btn-sm ${pickShipDest===v?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setPickShipDest(v)}>{l}</button>)}
          </div>
          {pickShipDest==='ship_customer'&&<div style={{marginTop:6}}>
            <label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Ship To Address</label>
            <select className="form-select" style={{fontSize:12}} value={pickShipAddr} onChange={e=>setPickShipAddr(e.target.value)}>
              {addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}
              {o.ship_to_custom&&<option value="custom">Custom: {o.ship_to_custom}</option>}
            </select>
          </div>}
          {pickShipDest==='ship_deco'&&<div style={{marginTop:6}}>
            <label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Decoration Vendor</label>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {DECO_VENDORS.map(dv=><button key={dv} className={`btn btn-sm ${pickDecoVendor===dv?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setPickDecoVendor(dv)}>{dv}</button>)}
            </div>
            {pickDecoVendor==='Other'&&<input className="form-input" style={{marginTop:6,fontSize:12}} placeholder="Enter vendor name..." onChange={e=>setPickDecoVendor(e.target.value||'Other')}/>}
          </div>}
        </div>
        {/* Warehouse Notes */}
        <div style={{marginBottom:12}}>
          <label style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase'}}>Notes for Warehouse</label>
          <textarea className="form-input" rows={2} value={pickNotes} onChange={e=>setPickNotes(e.target.value)} placeholder="Special instructions for warehouse team..." style={{fontSize:12,resize:'vertical'}}/>
        </div>
        {showPick.map((item,vi)=>{const szList=Object.entries(item._pick).filter(([,v])=>v>0);const q=szList.reduce((a,[,v])=>a+v,0);const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
          return<div key={vi} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{item.sku}</span><strong>{item.name}</strong> — {item.color}</div><div style={{fontWeight:700}}>IF Qty: {q}</div></div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><thead><tr style={{borderBottom:'2px solid #0f172a'}}>{szList.map(([sz])=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:50}}>{sz}</th>)}<th style={{padding:'4px 8px'}}>TOTAL</th></tr></thead>
            <tbody><tr style={{fontSize:10,color:'#64748b'}}>{szList.map(([sz])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'2px 8px',textAlign:'center'}}>open: {open} | inv: {inv}</td>})}<td/></tr>
            <tr>{szList.map(([sz,v])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'4px 8px',textAlign:'center'}}><input id={'pick-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:v<open?'2px solid #f59e0b':'1px solid #10b981',borderRadius:3,padding:'3px',fontSize:14,fontWeight:700,background:v<open?'#fef3c7':'#dcfce7'}} defaultValue={v}/></td>})}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800,fontSize:14}}>{q}</td></tr></tbody></table>
            {safeDecos(item).filter(d=>d.kind==='art').map((d,di)=>{const art=af.find(a=>a.id===d.art_file_id);return art?<div key={di} style={{fontSize:12,marginTop:6,padding:'4px 8px',background:'#f0fdf4',borderRadius:4}}>🎨 {art.name} — {art.deco_type} @ {d.position}{d.underbase?' [Underbase]':''}</div>:null})}
            {safeDecos(item).filter(d=>d.kind==='numbers').map((d,di)=><div key={di} style={{fontSize:12,marginTop:4,padding:'4px 8px',background:'#f0f9ff',borderRadius:4}}>#️⃣ Numbers — {d.num_method} {d.num_size} @ {d.position}</div>)}
          </div>})}
      </div>}
      <div className="modal-footer">
        {typeof showPick==='object'?<>
          <button className="btn btn-secondary" onClick={()=>setShowPick(true)}>← Back</button>
          <button className="btn btn-secondary" onClick={()=>window.print()}>🖨️ Print</button>
          <button className="btn btn-primary" onClick={()=>{
            // Save pick lines back to order items (immutable)
            const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
            showPick.forEach((pk,vi)=>{
              const idx=pk._idx;if(idx==null)return;
              // Read actual qty values from DOM inputs (user may have edited them)
              const pickLine={status:'pick',pick_id:pickId,created_at:new Date().toLocaleDateString(),memo:pickNotes,ship_dest:pickShipDest,ship_addr:pickShipDest==='ship_customer'?pickShipAddr:'',deco_vendor:pickShipDest==='ship_deco'?pickDecoVendor:''};
              Object.entries(pk._pick).forEach(([sz,v])=>{
                if(typeof v!=='number'||v<=0)return;
                const el=document.getElementById('pick-qty-'+vi+'-'+sz);
                pickLine[sz]=el?Math.max(0,parseInt(el.value)||0):v;
              });
              // Only add if there's actually qty to pick
              const hasQty=Object.entries(pickLine).some(([k,v])=>k!=='status'&&k!=='pick_id'&&v>0);
              if(hasQty){
                updatedItems[idx].pick_lines=[...updatedItems[idx].pick_lines,pickLine];
              }
            });
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
            setO(updated);onSave(updated);
            // NOTE: Inventory is NOT decremented on pick creation (status:'pick')
            // It only decrements when status is changed to 'pulled' via the edit handler
            // This prevents double-decrement: create → edit to pulled
            setShowPick(false);setPickId('IF-'+String((parseInt(pickId.replace('IF-',''))||4000)+1));setPickNotes('');setPickShipDest('in_house');setPickDecoVendor('');setPickShipAddr('default');
            const destLabel=pickShipDest==='ship_customer'?'→ Ship to Customer':pickShipDest==='ship_deco'?'→ '+pickDecoVendor:'→ In-House Deco';
            nf(pickId+' sent to warehouse ('+destLabel+')');
          }} style={{padding:'8px 20px',fontWeight:700}}>📦 Send to Warehouse</button>
        </>:<button className="btn btn-secondary" onClick={()=>setShowPick(false)}>Cancel</button>}
      </div>
    </div></div>}

    {/* JOBS TAB */}
    {isSO&&tab==='jobs'&&(()=>{
      const jobs=safeJobs(o);

      // Manual refresh recalculates everything
      const refreshJobs=()=>{sv('jobs',syncJobs());nf('Jobs synced')};

      // Split job modal state
      // Split job modal state is at component level (splitModal/setSplitModal)

      // Split job by received — create partial job with received items
      const splitByReceived=(jIdx)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length)return;
        const rcvdItems=[];let rcvdTotal=0;
        j.items.forEach(ji=>{
          const it=safeItems(o)[ji.item_idx];if(!it)return;
          let ful=0;
          Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            ful+=Math.min(v,pQ+rQ);
          });
          if(ful>0){rcvdItems.push({...ji,fulfilled:ful,units:ful});rcvdTotal+=ful}
        });
        if(rcvdTotal===0){nf('Nothing received to split','error');return}
        const splitId=j.id+'-S';
        const splitJob2={...j,id:splitId,split_from:j.id,item_status:'items_received',items:rcvdItems,
          fulfilled_units:rcvdTotal,total_units:rcvdTotal,
          prod_status:j.art_status==='art_complete'?'hold':'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,total_units:j.total_units-rcvdTotal,fulfilled_units:0,item_status:'need_to_order'};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        sv('jobs',newJobs2);setSplitModal(null);nf('✂️ Split! '+splitId+' ready with '+rcvdTotal+' units');
      };

      // Split job by SKU — separate into one job per garment
      const splitBySku=(jIdx,selectedSkus)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length||!selectedSkus?.length)return;
        const keepItems=j.items.filter(gi=>!selectedSkus.includes(gi.sku));
        const splitItems=j.items.filter(gi=>selectedSkus.includes(gi.sku));
        if(splitItems.length===0||keepItems.length===0){nf('Select some (not all) SKUs to split','error');return}
        const splitUnits=splitItems.reduce((a,gi)=>a+gi.units,0);
        const splitFul=splitItems.reduce((a,gi)=>a+gi.fulfilled,0);
        const keepUnits=keepItems.reduce((a,gi)=>a+gi.units,0);
        const keepFul=keepItems.reduce((a,gi)=>a+gi.fulfilled,0);
        const splitId=j.id+'-B';
        const splitJob2={...j,id:splitId,split_from:j.id,items:splitItems,
          total_units:splitUnits,fulfilled_units:splitFul,
          prod_status:'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,items:keepItems,total_units:keepUnits,fulfilled_units:keepFul};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        sv('jobs',newJobs2);setSplitModal(null);nf('✂️ Split by SKU! '+splitId+' with '+splitItems.length+' garment(s)');
      };
      const updJob=(jIdx,k,v)=>{sv('jobs',jobs.map((j,i)=>i===jIdx?{...j,[k]:v}:j))};
      const prodStatuses=['hold','staging','in_process','completed','shipped'];
      const prodLabels={hold:'Ready for Prod',staging:'In Line',in_process:'In Process',completed:'Completed',shipped:'Shipped'};
      const artLabels={needs_art:'Needs Art',waiting_approval:'Waiting Approval',art_complete:'Art Complete'};
      const itemLabels={need_to_order:'Need to Order',partially_received:'Partially Received',items_received:'Items Received'};

      // Job detail view
      if(selJob!=null){
        const ji=selJob;const j=jobs[ji];
        if(!j)return<div className="card"><div className="card-body"><button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)}><Icon name="back" size={12}/> Back to Jobs</button><div style={{padding:20,color:'#94a3b8'}}>Job not found</div></div></div>;
        const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';
        const canOverride=cu.role==="admin"||cu.role==="production"||cu.role==="gm";
        const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
        const artF=safeArt(o).find(a=>a.id===j.art_file_id);
        // Get full size breakdowns per item
        const itemDetails=(j.items||[]).map(gi=>{
          const it=safeItems(o)[gi.item_idx];if(!it)return{...gi,sizes:{},fulSizes:{}};
          const sizes=safeSizes(it);const fulSizes={};
          Object.entries(sizes).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            fulSizes[sz]=Math.min(v,pQ+rQ);
          });
          return{...gi,sizes,fulSizes,color:safeStr(it.color),brand:safeStr(it.brand)};
        });
        const allSizes=[...new Set(itemDetails.flatMap(gi=>Object.keys(gi.sizes||{})))];
        const sizeOrder=['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
        allSizes.sort((a,b)=>(sizeOrder.indexOf(a)===-1?99:sizeOrder.indexOf(a))-(sizeOrder.indexOf(b)===-1?99:sizeOrder.indexOf(b)));

        return<div>
          <button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)} style={{marginBottom:12}}><Icon name="back" size={12}/> All Jobs</button>
          {/* Job header */}
          <div className="card" style={{marginBottom:12}}>
            <div style={{padding:'16px 20px',display:'flex',gap:16,alignItems:'flex-start'}}>
              <div style={{width:48,height:48,borderRadius:10,background:SC[j.prod_status]?.bg||'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🎨</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{j.id}</span>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{artLabels[j.art_status]}</span>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{itemLabels[j.item_status]}</span>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}}>{prodLabels[j.prod_status]}</span>
                </div>
                <div style={{fontSize:15,fontWeight:700,marginTop:4}}>{j.art_name}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                {j.split_from&&<div style={{fontSize:11,color:'#7c3aed',marginTop:2}}>✂️ Split from {j.split_from}</div>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:24,fontWeight:800,color:pct>=100?'#166534':'#1e40af'}}>{j.fulfilled_units}/{j.total_units}</div>
                <div style={{width:80,background:'#e2e8f0',borderRadius:4,height:6,marginTop:4}}><div style={{height:6,borderRadius:4,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div>
                <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{pct}% fulfilled</div>
              </div>
            </div>
            {/* Status controls */}
            <div style={{padding:'10px 20px',borderTop:'1px solid #f1f5f9',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Art:</div>
              <select className="form-select" style={{width:150,fontSize:11}} value={j.art_status} onChange={e=>updJob(ji,'art_status',e.target.value)}>
                {Object.entries(artLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
              <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:8}}>Production:</div>
              {j.prod_status==='hold'&&!canProduce&&!canOverride?<span style={{fontSize:11,color:'#94a3b8'}}>Waiting items/art</span>
              :<><select className="form-select" style={{width:150,fontSize:11}} value={j.prod_status} onChange={e=>updJob(ji,'prod_status',e.target.value)}>
                {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>
              {!canProduce&&j.prod_status!=='hold'&&<span style={{fontSize:9,color:'#d97706',marginLeft:4}}>⚠️ Items/art incomplete</span>}</>}
              <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                {(j.items||[]).length>=1&&j.fulfilled_units<j.total_units&&<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:10}} onClick={()=>setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}>✂️ Split Job</button>}
                <button className="btn btn-sm btn-secondary" onClick={()=>{
                  const w=window.open('','_blank','width=700,height=900');
                  w.document.write('<html><head><title>'+j.id+' — '+j.art_name+'</title><style>body{font-family:sans-serif;padding:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:12px}th{background:#f0f0f0;font-weight:700}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.info div{padding:8px;background:#f8f8f8;border-radius:4px}.label{font-size:10px;color:#666;font-weight:600;text-transform:uppercase}@media print{body{padding:12px}}</style></head><body>');
                  w.document.write('<h1>'+j.id+' — '+j.art_name+'</h1>');
                  w.document.write('<p>'+j.deco_type?.replace(/_/g,' ')+' · '+j.positions+' · '+j.total_units+' total units</p>');
                  w.document.write('<p>SO: '+o.id+' — '+(o.memo||'')+'</p>');
                  w.document.write('<div class="info"><div><div class="label">Art Status</div>'+artLabels[j.art_status]+'</div><div><div class="label">Item Status</div>'+itemLabels[j.item_status]+'</div><div><div class="label">Production</div>'+prodLabels[j.prod_status]+'</div><div><div class="label">Fulfilled</div>'+j.fulfilled_units+'/'+j.total_units+' ('+pct+'%)</div></div>');
                  if(artF){w.document.write('<h2>Art Details</h2><div class="info"><div><div class="label">Deco Type</div>'+(artF.deco_type||'—')+'</div><div><div class="label">Art Size</div>'+(artF.art_size||'—')+'</div><div><div class="label">Ink Colors</div>'+(artF.ink_colors||'—')+'</div><div><div class="label">Thread Colors</div>'+(artF.thread_colors||'—')+'</div></div>')}
                  w.document.write('<h2>Items & Sizes</h2>');
                  itemDetails.forEach(gi=>{
                    w.document.write('<p style="margin:12px 0 4px;font-weight:700">'+gi.sku+' — '+(gi.name||'Unknown')+' ('+gi.color+')</p>');
                    w.document.write('<table><thead><tr><th></th>');
                    allSizes.forEach(sz=>{w.document.write('<th>'+sz+'</th>')});
                    w.document.write('<th>Total</th></tr></thead><tbody>');
                    w.document.write('<tr><td style="font-weight:700;text-align:left">Ordered</td>');
                    let rowT=0;allSizes.forEach(sz=>{const v=gi.sizes[sz]||0;rowT+=v;w.document.write('<td>'+(v||'')+'</td>')});
                    w.document.write('<td style="font-weight:700">'+rowT+'</td></tr>');
                    w.document.write('<tr><td style="font-weight:700;text-align:left">In Hand</td>');
                    let fulT=0;allSizes.forEach(sz=>{const v=gi.fulSizes[sz]||0;fulT+=v;w.document.write('<td style="color:'+(v>0?'green':'#ccc')+'">'+(v||'—')+'</td>')});
                    w.document.write('<td style="font-weight:700;color:'+(fulT>=rowT?'green':'orange')+'">'+fulT+'</td></tr>');
                    w.document.write('</tbody></table>');
                  });
                  if(j.notes){w.document.write('<h2>Notes</h2><p>'+j.notes+'</p>')}
                  w.document.write('<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ccc;font-size:10px;color:#999">Printed '+new Date().toLocaleString()+' · NSA Portal</div>');
                  w.document.write('</body></html>');w.document.close();w.print();
                }}>🖨️ Print Job Sheet</button>
              </div>
            </div>
          </div>

          {/* Mockup / Art preview */}
          <div className="card" style={{marginBottom:12}}>
            <div className="card-header"><h2>🎨 Artwork</h2></div>
            <div className="card-body">
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <div style={{flex:'0 0 200px',background:'#f8fafc',border:'2px dashed #d1d5db',borderRadius:10,padding:30,textAlign:'center'}}>
                  <div style={{fontSize:36,marginBottom:6}}>🖼️</div>
                  <div style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Mockup Preview</div>
                  <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Upload art files to see preview</div>
                  {artF?.files?.length>0&&<div style={{fontSize:10,color:'#2563eb',marginTop:6}}>{artF.files.join(', ')}</div>}
                </div>
                <div style={{flex:1,minWidth:200}}>
                  {artF?<>
                    <div className="form-row form-row-2">
                      <div><div className="form-label">Art File</div><div style={{fontSize:13,fontWeight:600}}>{artF.name}</div></div>
                      <div><div className="form-label">Deco Method</div><div style={{fontSize:13}}>{artF.deco_type?.replace(/_/g,' ')||'—'}</div></div>
                      <div><div className="form-label">Art Size</div><div style={{fontSize:13}}>{artF.art_size||'—'}</div></div>
                      <div><div className="form-label">Status</div><div style={{fontSize:13}}><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{artLabels[j.art_status]}</span></div></div>
                    </div>
                    {artF.ink_colors&&<div style={{marginTop:10}}><div className="form-label">Ink Colors</div><div style={{fontSize:13}}>{artF.ink_colors}</div></div>}
                    {artF.thread_colors&&<div style={{marginTop:6}}><div className="form-label">Thread Colors</div><div style={{fontSize:13}}>{artF.thread_colors}</div></div>}
                    {artF.notes&&<div style={{marginTop:6}}><div className="form-label">Art Notes</div><div style={{fontSize:13,color:'#64748b'}}>{artF.notes}</div></div>}
                    {artF.files?.length>0&&<div style={{marginTop:6}}><div className="form-label">Files</div><div style={{fontSize:12}}>{artF.files.map((f,i)=><span key={i} className="badge badge-blue" style={{marginRight:4}}>{f}</span>)}</div></div>}
                  </>:<div style={{padding:12,background:'#fef2f2',borderRadius:6,fontSize:12,color:'#dc2626'}}>
                    {j.art_file_id?'Art file reference not found':'No art file assigned to this job'}
                  </div>}
                </div>
              </div>
            </div>
          </div>

          {/* Items & Size Matrix */}
          <div className="card" style={{marginBottom:12}}>
            <div className="card-header"><h2>📦 Items & Sizes</h2></div>
            <div className="card-body" style={{padding:0}}>
              {itemDetails.map((gi,gii)=>{
                const rowTotal=Object.values(gi.sizes||{}).reduce((a,v)=>a+safeNum(v),0);
                const fulTotal=Object.values(gi.fulSizes||{}).reduce((a,v)=>a+safeNum(v),0);
                return<div key={gii} style={{padding:'12px 16px',borderBottom:gii<itemDetails.length-1?'1px solid #f1f5f9':'none'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3,marginRight:6}}>{gi.sku}</span>
                      <span style={{fontWeight:600}}>{gi.name||'Unknown'}</span>
                      <span style={{color:'#94a3b8',marginLeft:6}}>({gi.color||'—'})</span>
                      {gi.brand&&<span className="badge badge-gray" style={{marginLeft:6}}>{gi.brand}</span>}</div>
                    <div style={{fontWeight:700,color:fulTotal>=rowTotal&&rowTotal>0?'#166534':'#64748b'}}>{fulTotal}/{rowTotal} units</div>
                  </div>
                  {/* Size grid */}
                  <div style={{overflowX:'auto'}}>
                    <table style={{fontSize:11,minWidth:300}}><thead><tr><th style={{textAlign:'left',width:80}}></th>
                      {allSizes.map(sz=><th key={sz} style={{minWidth:40,textAlign:'center'}}>{sz}</th>)}
                      <th style={{minWidth:50,textAlign:'center',fontWeight:800}}>Total</th></tr></thead><tbody>
                      <tr><td style={{fontWeight:600}}>Ordered</td>
                        {allSizes.map(sz=><td key={sz} style={{textAlign:'center',fontWeight:gi.sizes[sz]?700:400,color:gi.sizes[sz]?'#0f172a':'#cbd5e1'}}>{gi.sizes[sz]||'—'}</td>)}
                        <td style={{textAlign:'center',fontWeight:800,background:'#f1f5f9'}}>{rowTotal}</td></tr>
                      <tr><td style={{fontWeight:600,color:'#166534'}}>In Hand</td>
                        {allSizes.map(sz=>{const v=gi.fulSizes[sz]||0;const ord=gi.sizes[sz]||0;return<td key={sz} style={{textAlign:'center',fontWeight:600,color:v>=ord&&ord>0?'#166534':v>0?'#d97706':'#cbd5e1'}}>{v||'—'}</td>})}
                        <td style={{textAlign:'center',fontWeight:800,background:fulTotal>=rowTotal&&rowTotal>0?'#dcfce7':'#fef3c7',color:fulTotal>=rowTotal&&rowTotal>0?'#166534':'#92400e'}}>{fulTotal}</td></tr>
                      <tr><td style={{fontWeight:600,color:'#dc2626'}}>Need</td>
                        {allSizes.map(sz=>{const need=Math.max(0,(gi.sizes[sz]||0)-(gi.fulSizes[sz]||0));return<td key={sz} style={{textAlign:'center',fontWeight:need>0?700:400,color:need>0?'#dc2626':'#cbd5e1'}}>{need||'—'}</td>})}
                        <td style={{textAlign:'center',fontWeight:800,background:rowTotal-fulTotal>0?'#fee2e2':'#dcfce7',color:rowTotal-fulTotal>0?'#dc2626':'#166534'}}>{Math.max(0,rowTotal-fulTotal)}</td></tr>
                    </tbody></table>
                  </div>
                </div>})}
            </div>
          </div>

          {/* Count-in & Notes */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="card">
              <div className="card-header"><h2>📋 Count-In at Decoration</h2></div>
              <div className="card-body">
                {j.counted_at?<div style={{padding:10,background:'#f0fdf4',borderRadius:6}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#166534'}}>✅ Counted In</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{j.counted_by||'—'} · {j.counted_at}</div>
                  {j.count_discrepancy&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠️ {j.count_discrepancy}</div>}
                </div>:<>
                  <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>Confirm inventory received at decoration station</div>
                  <div style={{marginBottom:8}}><input className="form-input" placeholder="Discrepancy notes (if any)" style={{fontSize:12}} value={jobNote} onChange={e=>setJobNote(e.target.value)}/></div>
                  <button className="btn btn-sm btn-primary" onClick={()=>{
                    updJob(ji,'counted_at',new Date().toLocaleString());
                    updJob(ji,'counted_by',cu?.name||'Unknown');
                    if(jobNote)updJob(ji,'count_discrepancy',jobNote);
                    setJobNote('');nf('✅ Count-in recorded');
                  }}>✅ Confirm Count-In</button>
                </>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>📝 Job Notes</h2></div>
              <div className="card-body">
                <textarea className="form-input" rows={3} placeholder="Production notes for this job..." style={{fontSize:12}} value={j.notes||''} onChange={e=>updJob(ji,'notes',e.target.value)}/>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Visible to decoration team & printed on job sheet</div>
              </div>
            </div>
          </div>
        </div>
      }

      return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2>Production Jobs ({jobs.length})</h2>
        <div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm btn-secondary" onClick={refreshJobs}><Icon name="check" size={12}/> Sync Status</button>
        </div>
      </div><div className="card-body" style={{padding:0}}>
        {jobs.length===0&&<div style={{padding:24,textAlign:'center',color:'#94a3b8'}}>No decorations assigned yet. Add artwork or numbers to items and jobs will appear automatically.</div>}
        {jobs.length>0&&<table style={{fontSize:12}}><thead><tr><th>Job ID</th><th>Artwork / Decoration</th><th>Items</th><th>Units</th><th>Items Status</th><th>Art</th><th>Production</th><th></th></tr></thead><tbody>
          {jobs.map((j,ji)=>{
            const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';const canOverride2=cu.role==='admin'||cu.role==='production'||cu.role==='gm';
            const canSplit=j.item_status==='partially_received'&&!j.split_from;
            const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
            return<React.Fragment key={j.id}>
              <tr style={{background:j.prod_status==='completed'||j.prod_status==='shipped'?'#f0fdf4':undefined,cursor:'pointer'}} onClick={()=>setSelJob(ji)}>
              <td><span style={{fontWeight:700,color:'#1e40af'}}>{j.id}</span>
                {j.split_from&&<div style={{fontSize:9,color:'#7c3aed'}}>split from {j.split_from}</div>}
                {j.counted_at&&<div style={{fontSize:9,color:'#166534'}}>✅ counted</div>}</td>
              <td><div style={{fontWeight:600}}>{j.art_name}</div>
                <div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions}</div></td>
              <td style={{fontSize:11}}>{(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</td>
              <td style={{fontWeight:700}}>{j.fulfilled_units}/{j.total_units}
                <div style={{width:50,background:'#e2e8f0',borderRadius:3,height:4,marginTop:2}}><div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div></td>
              <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{itemLabels[j.item_status]}</span></td>
              <td><select style={{fontSize:10,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}} value={j.art_status} onChange={e=>{e.stopPropagation();updJob(ji,'art_status',e.target.value)}}>
                {Object.entries(artLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
              <td>{j.prod_status==='hold'&&!canProduce&&!canOverride2?<span style={{fontSize:10,color:'#94a3b8',fontStyle:'italic'}}>Waiting items/art</span>
                :<select style={{fontSize:10,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}} value={j.prod_status} onChange={e=>{e.stopPropagation();updJob(ji,'prod_status',e.target.value)}}>
                  {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>}</td>
              <td>{canSplit&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#7c3aed',color:'white',borderRadius:4}} onClick={e=>{e.stopPropagation();setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}} title="Split job">✂️ Split</button>}</td>
            </tr>
            {/* Grouped items under this job */}
            {(j.items||[]).map((gi,gii)=><tr key={gii} style={{background:'#fafbfc',cursor:'pointer'}} onClick={()=>setSelJob(ji)}>
              <td style={{paddingLeft:24,color:'#94a3b8',fontSize:10}}>↳</td>
              <td colSpan={2} style={{fontSize:11,color:'#475569'}}><span style={{fontWeight:600}}>{gi.sku}</span> {gi.name} <span style={{color:'#94a3b8'}}>({gi.color||'—'})</span></td>
              <td style={{fontSize:11}}>{gi.fulfilled}/{gi.units}</td>
              <td colSpan={4}/>
            </tr>)}
            </React.Fragment>})}
        </tbody></table>}

      {/* Split Job Modal */}
      {splitModal&&(()=>{
        const j=jobs[splitModal.jIdx];if(!j)return null;
        const items=(j.items||[]).map(gi=>{
          const it=safeItems(o)[gi.item_idx];
          let ful=0;
          if(it)Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            ful+=Math.min(v,pQ+rQ);
          });
          return{...gi,received:ful};
        });
        const totalReceived=items.reduce((a,gi)=>a+gi.received,0);
        return<div className="modal-overlay" onClick={()=>setSplitModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
          <div className="modal-header"><h2>✂️ Split Job — {j.id}</h2><button className="modal-close" onClick={()=>setSplitModal(null)}>×</button></div>
          <div className="modal-body">
            <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Choose how to split <strong>{j.art_name}</strong> ({j.total_units} total units, {totalReceived} received)</p>

            {/* Mode selection */}
            {!splitModal.mode&&<div style={{display:'flex',gap:12,flexDirection:'column'}}>
              <button className="btn" style={{padding:16,background:'#f0fdf4',border:'2px solid #86efac',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'received'}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#166534',marginBottom:4}}>📦 Split by Received Inventory</div>
                <div style={{fontSize:12,color:'#475569'}}>Creates a new job with the <strong>{totalReceived} units</strong> that have been received/pulled. Remaining {j.total_units-totalReceived} units stay on the original job.</div>
                {totalReceived===0&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠️ No units received yet — nothing to split</div>}
              </button>
              <button className="btn" style={{padding:16,background:'#eff6ff',border:'2px solid #93c5fd',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'sku',selectedSkus:[]}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#1e40af',marginBottom:4}}>👕 Split by SKU / Garment</div>
                <div style={{fontSize:12,color:'#475569'}}>Select which garments to move to a new job. Useful when different garments arrive at different times or need separate production runs.</div>
                {items.length<2&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠️ Only 1 garment on this job — can't split by SKU</div>}
              </button>
            </div>}

            {/* Split by received confirmation */}
            {splitModal.mode==='received'&&<div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Items with received inventory:</div>
              {items.map((gi,i)=><div key={i} style={{padding:8,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center',background:gi.received>0?'#f0fdf4':'#fafafa'}}>
                <div><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color})</span></div>
                <div style={{textAlign:'right'}}><span style={{fontWeight:700,color:gi.received>0?'#166534':'#94a3b8'}}>{gi.received}</span><span style={{color:'#94a3b8'}}>/{gi.units}</span> <span style={{fontSize:10,color:'#64748b'}}>received</span></div>
              </div>)}
              <div style={{padding:10,background:'#fef9c3',borderRadius:6,marginTop:8,fontSize:12}}>
                <strong>New job ({j.id}-S):</strong> {totalReceived} units (received) → Ready for Prod<br/>
                <strong>Remaining ({j.id}):</strong> {j.total_units-totalReceived} units → Waiting for items
              </div>
            </div>}

            {/* Split by SKU selection */}
            {splitModal.mode==='sku'&&<div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Select garments to split into a new job:</div>
              {items.map((gi,i)=>{const sel=(splitModal.selectedSkus||[]).includes(gi.sku);
                return<div key={i} style={{padding:10,border:sel?'2px solid #3b82f6':'1px solid #e2e8f0',borderRadius:6,marginBottom:6,cursor:'pointer',display:'flex',gap:10,alignItems:'center',background:sel?'#eff6ff':'white'}}
                  onClick={()=>setSplitModal(m=>{const ss=m.selectedSkus||[];return{...m,selectedSkus:ss.includes(gi.sku)?ss.filter(s=>s!==gi.sku):[...ss,gi.sku]}})}>
                  <input type="checkbox" checked={sel} readOnly style={{width:18,height:18}}/>
                  <div style={{flex:1}}><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color})</span></div>
                  <div style={{fontWeight:700,fontSize:13}}>{gi.units} <span style={{fontSize:10,color:'#64748b',fontWeight:400}}>units</span></div>
                  <div style={{fontSize:11,color:gi.received>0?'#166534':'#94a3b8'}}>{gi.received} rcvd</div>
                </div>})}
              {(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length<items.length&&<div style={{padding:10,background:'#eff6ff',borderRadius:6,marginTop:8,fontSize:12}}>
                <strong>New job ({j.id}-B):</strong> {items.filter(gi=>(splitModal.selectedSkus||[]).includes(gi.sku)).map(gi=>gi.sku).join(', ')} ({items.filter(gi=>(splitModal.selectedSkus||[]).includes(gi.sku)).reduce((a,gi)=>a+gi.units,0)} units)<br/>
                <strong>Remaining ({j.id}):</strong> {items.filter(gi=>!(splitModal.selectedSkus||[]).includes(gi.sku)).map(gi=>gi.sku).join(', ')} ({items.filter(gi=>!(splitModal.selectedSkus||[]).includes(gi.sku)).reduce((a,gi)=>a+gi.units,0)} units)
              </div>}
              {(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length>=items.length&&<div style={{padding:8,background:'#fef2f2',borderRadius:6,marginTop:8,fontSize:12,color:'#dc2626'}}>Can't move all garments — deselect at least one to keep on the original job.</div>}
            </div>}
          </div>
          <div className="modal-footer">
            {splitModal.mode&&<button className="btn btn-secondary" onClick={()=>setSplitModal(m=>({...m,mode:null}))}>← Back</button>}
            <button className="btn btn-secondary" onClick={()=>setSplitModal(null)}>Cancel</button>
            {splitModal.mode==='received'&&totalReceived>0&&<button className="btn btn-primary" onClick={()=>splitByReceived(splitModal.jIdx)}>✂️ Split by Received ({totalReceived} units)</button>}
            {splitModal.mode==='sku'&&(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length<items.length&&<button className="btn btn-primary" onClick={()=>splitBySku(splitModal.jIdx,splitModal.selectedSkus)}>✂️ Split Selected SKUs</button>}
          </div>
        </div></div>})()}

      </div></div>})()}

    {/* LINKED DOCUMENTS: Item Fulfillments & Purchase Orders */}
    {isSO&&(()=>{
      const allPickIds=[];const allPoIds=[];
      safeItems(o).forEach((it,i)=>{
        safePicks(it).forEach((pk,pi)=>{if(pk.pick_id&&!allPickIds.find(x=>x.id===pk.pick_id)){
          const qty=Object.entries(pk).reduce((a,[k,v])=>k!=='status'&&k!=='pick_id'&&typeof v==='number'?a+v:a,0);
          const itemTotal=qty*it.unit_sell;
          allPickIds.push({id:pk.pick_id,status:pk.status||'pick',qty,lineIdx:i,pickIdx:pi,sku:it.sku,name:it.name,color:it.color,total:itemTotal,created_at:pk.created_at,memo:pk.memo})}});
        safePOs(it).forEach((po,pi)=>{if(po.po_id&&!allPoIds.find(x=>x.id===po.po_id)){
          const szKeysP=Object.keys(po).filter(k=>k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='created_at'&&k!=='memo'&&typeof po[k]==='number');
          const qty=szKeysP.reduce((a,sz)=>a+(po[sz]||0),0);
          const rcvdQty=szKeysP.reduce((a,sz)=>a+((po.received||{})[sz]||0),0);
          const openQty=szKeysP.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-((po.received||{})[sz]||0)-((po.cancelled||{})[sz]||0)),0);
          const costTotal=qty*it.nsa_cost;
          const vk=it.vendor_id||it.brand;const vn=D_V.find(v=>v.id===vk)?.name||vk;
          const pst=openQty<=0&&rcvdQty>0?'received':rcvdQty>0?'partial':'waiting';
          const shipDates=(po.shipments||[]).map(s=>s.date);
          allPoIds.push({id:po.po_id,status:pst,qty,rcvdQty,openQty,vendor:vn,lineIdx:i,poIdx:pi,sku:it.sku,name:it.name,color:it.color,costTotal,shipDates,created_at:po.created_at,memo:po.memo})}});
      });
      if(allPickIds.length===0&&allPoIds.length===0)return null;
      return<div className="card" style={{marginTop:16}}><div className="card-header"><h2>Linked Documents</h2></div><div className="card-body">
        {allPickIds.length>0&&<><div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Item Fulfillments</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:allPoIds.length>0?16:0}}>
            {allPickIds.map(pk=><div key={pk.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',background:pk.status==='pulled'?'#f0fdf4':'#fffbeb',transition:'box-shadow 0.15s'}} className="hover-card" onClick={()=>{const pickData=o.items[pk.lineIdx]?.pick_lines?.[pk.pickIdx];if(pickData)setEditPick({lineIdx:pk.lineIdx,pickIdx:pk.pickIdx,pick:pickData})}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Icon name="grid" size={14}/><span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{pk.id}</span>
                <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`} style={{fontSize:9}}>{pk.status==='pulled'?'✓ Pulled':'Needs Pull'}</span>
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:14,color:'#166534'}}>${pk.total.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,color:'#64748b'}}>
                <span><strong style={{color:'#1e40af'}}>{pk.sku}</strong> {pk.name}</span>
                <span>{pk.color}</span>
                <span>{pk.qty} units</span>
                {pk.created_at&&<span>📅 {pk.created_at}</span>}
              </div>
              {pk.memo&&<div style={{fontSize:11,color:'#475569',marginTop:3,fontStyle:'italic'}}>💬 {pk.memo}</div>}
            </div>)}
          </div></>}
        {allPoIds.length>0&&<><div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Purchase Orders</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {allPoIds.map(po=><div key={po.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',background:po.status==='received'?'#f0fdf4':po.status==='partial'?'#fffbeb':'#fff',transition:'box-shadow 0.15s'}} className="hover-card" onClick={()=>{const poData=o.items[po.lineIdx]?.po_lines?.[po.poIdx];if(poData)setEditPO({lineIdx:po.lineIdx,poIdx:po.poIdx,po:poData})}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Icon name="cart" size={14}/><span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{po.id}</span>
                <span style={{fontSize:11,color:'#64748b'}}>{po.vendor}</span>
                <span className={`badge ${po.status==='received'?'badge-green':po.status==='partial'?'badge-amber':'badge-gray'}`} style={{fontSize:9}}>{po.status==='received'?'✓ Received':po.status==='partial'?po.rcvdQty+'/'+po.qty+' Rcvd':'Waiting'}</span>
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:14,color:'#64748b'}}>${po.costTotal.toLocaleString(undefined,{maximumFractionDigits:0})} cost</span>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,color:'#64748b'}}>
                <span><strong style={{color:'#1e40af'}}>{po.sku}</strong> {po.name}</span>
                <span>{po.color}</span>
                <span>{po.qty} units{po.openQty>0?' · '+po.openQty+' open':''}</span>
                {po.created_at&&<span>📅 {po.created_at}</span>}
                {po.shipDates.length>0&&<span>📦 Last recv: {po.shipDates[po.shipDates.length-1]}</span>}
              </div>
              {po.memo&&<div style={{fontSize:11,color:'#475569',marginTop:3,fontStyle:'italic'}}>💬 {po.memo}</div>}
            </div>)}
          </div></>}
      </div></div>})()}

    {/* EDIT PICK MODAL */}
    {editPick&&(()=>{
      const pk=editPick.pick;const item=o.items[editPick.lineIdx];
      const pkSzKeys=Object.keys(pk).filter(k=>k!=='status'&&k!=='pick_id'&&typeof pk[k]==='number'&&pk[k]>0);
      const pkTotal=pkSzKeys.reduce((a,sz)=>a+(pk[sz]||0),0);
      const qrData=JSON.stringify({type:'PICK',id:pk.pick_id,so:o.id,sku:item?.sku,qty:pkTotal});
      return<div className="modal-overlay" onClick={()=>setEditPick(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
      <div className="modal-header"><h2>Pick — {pk.pick_id||'Pick'}</h2>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`}>{pk.status==='pulled'?'Pulled':'Needs Pull'}</span>
          <button className="modal-close" onClick={()=>setEditPick(null)}>x</button>
        </div></div>
      <div className="modal-body">
        {/* Product info */}
        {item&&<div style={{padding:'8px 12px',background:'#f8fafc',borderRadius:6,marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:13}}>{item.sku}</span>
          <span style={{fontWeight:600,fontSize:13}}>{item.name}</span>
          <span className="badge badge-gray">{item.color}</span>
        </div>}
        <div style={{marginBottom:12}}><label className="form-label">Status</label>
          <div style={{display:'flex',gap:6}}>{['pick','pulled'].map(s=><button key={s} className={`btn btn-sm ${pk.status===s?'btn-primary':'btn-secondary'}`} onClick={()=>setEditPick(p=>({...p,pick:{...p.pick,status:s}}))}>{s==='pulled'?'✓ Pulled':'Needs Pull'}</button>)}</div></div>
        <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:6}}>Quantities by size:</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          {pkSzKeys.map(sz=><div key={sz} style={{textAlign:'center'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
            <input style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={pk[sz]} onChange={e=>setEditPick(p=>({...p,pick:{...p.pick,[sz]:parseInt(e.target.value)||0}}))}/>
          </div>)}
          <div style={{textAlign:'center',borderLeft:'2px solid #e2e8f0',paddingLeft:8}}><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>TOT</div><div style={{fontSize:18,fontWeight:800}}>{pkTotal}</div></div>
        </div>
        {/* QR / Print Label */}
        <div style={{padding:12,border:'1px dashed #d1d5db',borderRadius:8,background:'#fafafa'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>📋 Label / QR Code</div>
          <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
            <div style={{padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
              <img src={'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data='+encodeURIComponent(qrData)} alt="QR" style={{width:80,height:80,display:'block'}}/>
            </div>
            <div style={{flex:1,fontSize:11}}>
              <div style={{fontWeight:800,fontSize:14}}>{pk.pick_id}</div>
              <div style={{color:'#64748b'}}>{o.id} — {cust?.name}</div>
              <div style={{fontWeight:600}}>{item?.sku} {item?.name}</div>
              <div>{item?.color} — {pkTotal} units</div>
              <div style={{marginTop:4}}>{pkSzKeys.map(sz=>sz+':'+pk[sz]).join('  ')}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>{
            const w=window.open('','_blank','width=400,height=300');
            w.document.write('<html><head><title>'+pk.pick_id+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:24px;margin:0}p{margin:4px 0;font-size:14px}.sz{font-size:16px;font-weight:bold}</style></head><body>');
            w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(qrData)+'" width="120" height="120"/><div>');
            w.document.write('<h1>'+pk.pick_id+'</h1><p>'+o.id+' — '+(cust?.name||'')+'</p><p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong></p><p>'+(item?.color||'')+' — '+pkTotal+' units</p>');
            w.document.write('<p class="sz">'+pkSzKeys.map(sz=>sz+': '+pk[sz]).join(' &nbsp; ')+'</p>');
            w.document.write('</div></div></body></html>');w.document.close();w.print();
          }}>🖨️ Print Label</button>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setEditPick(null)}>Close</button>
        <button className="btn btn-sm" style={{background:'#dc2626',color:'white'}} onClick={()=>{
          const oldPick=o.items[editPick.lineIdx].pick_lines[editPick.pickIdx];
          const item=o.items[editPick.lineIdx];
          if(oldPick.status==='pulled'){adjustInvForPick(oldPick,item,1)}
          const updatedItems=[...o.items];updatedItems[editPick.lineIdx].pick_lines=updatedItems[editPick.lineIdx].pick_lines.filter((_,i)=>i!==editPick.pickIdx);
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPick(null);nf('Pick deleted');
        }}><Icon name="trash" size={12}/> Delete</button>
        <button className="btn btn-primary" onClick={()=>{
          const oldPick=o.items[editPick.lineIdx].pick_lines[editPick.pickIdx];
          const newPick=editPick.pick;
          const item=o.items[editPick.lineIdx];
          // Adjust inventory if status changed
          if(oldPick.status!=='pulled'&&newPick.status==='pulled'){adjustInvForPick(newPick,item,-1)}
          else if(oldPick.status==='pulled'&&newPick.status!=='pulled'){adjustInvForPick(oldPick,item,1)}
          const updatedItems=[...o.items];updatedItems[editPick.lineIdx].pick_lines[editPick.pickIdx]=newPick;
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPick(null);nf('Pick updated');
        }}>Save Changes</button>
      </div>
    </div></div>})()}

    {/* EDIT PO MODAL — supports partial receiving with shipment log */}
    {editPO&&(()=>{
      const po=editPO.po;const item=o.items[editPO.lineIdx];
      const szKeys=Object.keys(po).filter(k=>k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&typeof po[k]==='number');
      const received=po.received||{};const cancelled=po.cancelled||{};
      const shipments=po.shipments||[];
      const getRcvd=sz=>(received[sz]||0);
      const getCncl=sz=>(cancelled[sz]||0);
      const getOpen=sz=>Math.max(0,(po[sz]||0)-getRcvd(sz)-getCncl(sz));
      const totalOrdered=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);
      const totalReceived=szKeys.reduce((a,sz)=>a+getRcvd(sz),0);
      const totalCancelled=szKeys.reduce((a,sz)=>a+getCncl(sz),0);
      const totalOpen=szKeys.reduce((a,sz)=>a+getOpen(sz),0);
      const hasOpen=szKeys.some(sz=>getOpen(sz)>0);
      const poStatus=totalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
      const qrData=JSON.stringify({type:'PO',id:po.po_id,so:o.id,sku:item?.sku,qty:totalOrdered});

      return<div className="modal-overlay" onClick={()=>setEditPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:750,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>PO — {po.po_id||'PO'}</h2>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span className={`badge ${poStatus==='received'?'badge-green':poStatus==='partial'?'badge-amber':'badge-gray'}`}>{poStatus==='received'?'Fully Received':poStatus==='partial'?'Partial — '+totalOpen+' open':'Waiting'}</span>
            <button className="modal-close" onClick={()=>setEditPO(null)}>x</button>
          </div>
        </div>
        <div className="modal-body">
          {/* Product info */}
          {item&&<div style={{padding:'8px 12px',background:'#f8fafc',borderRadius:6,marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:13}}>{item.sku}</span>
            <span style={{fontWeight:600,fontSize:13}}>{item.name}</span>
            <span className="badge badge-gray">{item.color}</span>
          </div>}

          {/* PO Summary Table */}
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',marginBottom:12}}>
            <thead><tr style={{borderBottom:'2px solid #0f172a'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}></th>{szKeys.map(sz=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:48}}>{sz}</th>)}<th style={{padding:'4px 8px',textAlign:'center'}}>TOTAL</th></tr></thead>
            <tbody>
              <tr><td style={{padding:'3px 8px',fontSize:10,color:'#64748b'}}>Ordered</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700}}>{po[sz]||0}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalOrdered}</td></tr>
              <tr style={{color:'#166534'}}><td style={{padding:'3px 8px',fontSize:10}}>Received</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:getRcvd(sz)>0?'#166534':'#d1d5db'}}>{getRcvd(sz)||'—'}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalReceived}</td></tr>
              {totalCancelled>0&&<tr style={{color:'#dc2626'}}><td style={{padding:'3px 8px',fontSize:10}}>Cancelled</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:getCncl(sz)>0?'#dc2626':'#d1d5db'}}>{getCncl(sz)||'—'}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalCancelled}</td></tr>}
              {hasOpen&&<tr style={{borderTop:'1px solid #e2e8f0',color:'#b45309'}}><td style={{padding:'3px 8px',fontSize:10,fontWeight:600}}>Open</td>{szKeys.map(sz=>{const op=getOpen(sz);return<td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:op>0?'#b45309':'#d1d5db'}}>{op>0?op:'—'}</td>})}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalOpen}</td></tr>}
            </tbody>
          </table>

          {/* Cancel sizes from PO */}
          {hasOpen&&<div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',gap:4}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}}>
              ⚠️ <span style={{textDecoration:'underline'}}>Cancel sizes from this PO</span> <span style={{fontSize:9}}>(vendor cancelled / shorted)</span>
            </div>
            <div style={{display:'none',marginTop:8,padding:10,border:'1px dashed #f59e0b',borderRadius:6,background:'#fffbeb'}}>
              <div style={{fontSize:11,color:'#92400e',marginBottom:6}}>Enter quantities to cancel (these sizes will become available for new picks/POs):</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-cancel-'+sz} style={{width:42,textAlign:'center',border:'1px solid #f59e0b',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={0}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
                </div>)}
              </div>
              <button className="btn btn-sm" style={{background:'#f59e0b',color:'white',fontSize:11}} onClick={()=>{
                const newCancelled={...cancelled};
                let anyCancelled=false;
                szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-cancel-'+sz);
                  const qty=el?Math.min(parseInt(el.value)||0,getOpen(sz)):0;
                  if(qty>0){newCancelled[sz]=(newCancelled[sz]||0)+qty;anyCancelled=true}
                });
                if(!anyCancelled){nf('Enter quantities to cancel','error');return}
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(received[sz]||0)-(newCancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
                const updatedPO={...po,cancelled:newCancelled,status:newStatus};
                const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines[editPO.poIdx]=updatedPO;
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO});nf('Sizes cancelled from '+po.po_id);
              }}>⚠️ Cancel These Sizes</button>
            </div>
          </div>}

          {/* Shipment history */}
          {shipments.length>0&&<>
            <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:6}}>Shipment history:</div>
            {shipments.map((sh,si)=>{
              const shQrData=JSON.stringify({type:'PO_RECV',id:po.po_id,shipment:si+1,so:o.id,sku:item?.sku,date:sh.date});
              const isEditing=editPO._editShipIdx===si;
              const shSzKeys=szKeys.filter(sz=>sh[sz]);
              return<div key={si} style={{marginBottom:4}}>
              <div style={{padding:'6px 10px',background:isEditing?'#dbeafe':'#f0fdf4',borderRadius:isEditing?'6px 6px 0 0':'6px',fontSize:11,display:'flex',gap:12,alignItems:'center',cursor:'pointer'}} onClick={()=>setEditPO(p=>({...p,_editShipIdx:isEditing?null:si}))}>
              <span style={{fontWeight:700,color:'#166534'}}>📦 {sh.date}</span>
              {szKeys.map(sz=>sh[sz]?<span key={sz} style={{color:'#374151'}}>{sz}:<strong>{sh[sz]}</strong></span>:null)}
              <span style={{marginLeft:'auto',fontSize:9,color:'#64748b'}}>{isEditing?'▲ close':'✏️ edit'}</span>
              <button style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'#64748b',textDecoration:'underline'}} onClick={e=>{e.stopPropagation();
                const w=window.open('','_blank','width=400,height=300');
                w.document.write('<html><head><title>'+po.po_id+' Recv #'+(si+1)+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:22px;margin:0}p{margin:4px 0;font-size:13px}.sz{font-size:15px;font-weight:bold}</style></head><body>');
                w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(shQrData)+'" width="120" height="120"/><div>');
                w.document.write('<h1>'+po.po_id+' — Shipment #'+(si+1)+'</h1><p>Received: '+sh.date+'</p><p>'+o.id+' — '+(cust?.name||'')+'</p><p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')+'</p>');
                w.document.write('<p class="sz">'+szKeys.filter(sz=>sh[sz]).map(sz=>sz+': '+sh[sz]).join(' &nbsp; ')+'</p>');
                w.document.write('</div></div></body></html>');w.document.close();w.print();
              }}>🖨️</button>
            </div>
            {isEditing&&<div style={{padding:10,border:'1px solid #bfdbfe',borderRadius:'0 0 6px 6px',background:'#eff6ff',marginBottom:2}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
                <input type="date" id={'sh-edit-date-'+si} className="form-input" style={{width:140,fontSize:12}} defaultValue={sh.date}/>
                <span style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:8}}>Quantities:</span>
                {szKeys.map(sz=>{const v=sh[sz]||0;if(!v&&!shSzKeys.includes(sz))return null;return<div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'sh-edit-'+si+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #93c5fd',borderRadius:4,padding:'3px 2px',fontSize:13,fontWeight:700,background:'white'}} defaultValue={v}/>
                </div>})}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>{
                  const dateEl=document.getElementById('sh-edit-date-'+si);
                  const updatedSh={date:dateEl?.value||sh.date};
                  szKeys.forEach(sz=>{const el=document.getElementById('sh-edit-'+si+'-'+sz);if(el){const v=parseInt(el.value)||0;if(v>0)updatedSh[sz]=v}else if(sh[sz])updatedSh[sz]=sh[sz]});
                  // Recalculate received totals from all shipments
                  const newShipments=[...shipments];newShipments[si]=updatedSh;
                  const newReceived={};newShipments.forEach(s=>{szKeys.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
                  const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                  const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines[editPO.poIdx]=updatedPO;
                  const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO,_editShipIdx:null});nf('Shipment #'+(si+1)+' updated');
                }}>Save</button>
                <button className="btn btn-sm" style={{background:'#dc2626',color:'white',fontSize:11}} onClick={()=>{
                  if(!window.confirm('Delete this shipment receipt? Received quantities will be recalculated.'))return;
                  const newShipments=shipments.filter((_,i)=>i!==si);
                  const newReceived={};newShipments.forEach(s=>{szKeys.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
                  const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                  const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines[editPO.poIdx]=updatedPO;
                  const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO,_editShipIdx:null});nf('Shipment deleted');
                }}><Icon name="trash" size={10}/> Delete</button>
                <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>setEditPO(p=>({...p,_editShipIdx:null}))}>Cancel</button>
              </div>
            </div>}
            </div>})}
          </>}

          {/* Receive shipment form */}
          {hasOpen&&<div style={{marginTop:12,padding:12,border:'2px solid #22c55e',borderRadius:8,background:'#f0fdf4'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:8}}>Receive Shipment</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
              <input type="date" id="po-recv-date" className="form-input" style={{width:140,fontSize:12}} defaultValue={new Date().toISOString().split('T')[0]}/>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b',width:40}}>Qty:</span>
              {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                <input id={'po-recv-'+sz} style={{width:42,textAlign:'center',border:'1px solid #22c55e',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getOpen(sz)}/>
                <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
              </div>)}
            </div>
            <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>{
              const dateEl=document.getElementById('po-recv-date');
              const date=dateEl?.value||new Date().toLocaleDateString();
              const shipment={date};
              const newReceived={...received};
              szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                const el=document.getElementById('po-recv-'+sz);
                const qty=el?parseInt(el.value)||0:0;
                if(qty>0){shipment[sz]=qty;newReceived[sz]=(newReceived[sz]||0)+qty}
              });
              const hasShipQty=Object.entries(shipment).some(([k,v])=>k!=='date'&&v>0);
              if(!hasShipQty){nf('Enter quantities to receive','error');return}
              const newShipments=[...shipments,shipment];
              const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
              const newStatus=newTotalOpen<=0&&(totalReceived+Object.values(newReceived).reduce((a,v)=>a+v,0))>0?'received':newTotalOpen>0?'partial':'waiting';
              const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
              const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines[editPO.poIdx]=updatedPO;
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO});nf('Shipment received on '+po.po_id);
            }}>✓ Receive These Items</button>
          </div>}

          {/* QR / Print Label for full PO */}
          <div style={{marginTop:16,padding:12,border:'1px dashed #d1d5db',borderRadius:8,background:'#fafafa'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>📋 PO Label / QR Code</div>
            <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
              <div style={{padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
                <img src={'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data='+encodeURIComponent(qrData)} alt="QR" style={{width:80,height:80,display:'block'}}/>
              </div>
              <div style={{flex:1,fontSize:11}}>
                <div style={{fontWeight:800,fontSize:14}}>{po.po_id} <span style={{fontSize:10,fontWeight:600,color:poStatus==='received'?'#166534':poStatus==='partial'?'#b45309':'#64748b'}}>({poStatus==='received'?'Fully Received':poStatus==='partial'?totalReceived+'/'+totalOrdered+' received':'Waiting'})</span></div>
                <div style={{color:'#64748b'}}>{o.id} — {cust?.name}</div>
                <div style={{fontWeight:600}}>{item?.sku} {item?.name}</div>
                <div>{item?.color} — {totalOrdered} ordered{totalReceived>0?', '+totalReceived+' received':''}</div>
                <div style={{marginTop:4}}>Ordered: {szKeys.map(sz=>sz+':'+po[sz]).join('  ')}</div>
                {totalReceived>0&&<div style={{color:'#166534'}}>Received: {szKeys.filter(sz=>getRcvd(sz)>0).map(sz=>sz+':'+getRcvd(sz)).join('  ')}</div>}
                {totalOpen>0&&<div style={{color:'#b45309'}}>Open: {szKeys.filter(sz=>getOpen(sz)>0).map(sz=>sz+':'+getOpen(sz)).join('  ')}</div>}
              </div>
            </div>
            <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>{
              const w=window.open('','_blank','width=500,height=400');
              w.document.write('<html><head><title>'+po.po_id+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:24px;margin:0}p{margin:4px 0;font-size:14px}.sz{font-size:14px;font-weight:bold}.g{color:#166534}.a{color:#b45309}</style></head><body>');
              w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(qrData)+'" width="120" height="120"/><div>');
              w.document.write('<h1>'+po.po_id+'</h1><p>'+o.id+' — '+(cust?.name||'')+'</p><p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')+'</p>');
              w.document.write('<p>'+totalOrdered+' ordered'+(totalReceived>0?' · '+totalReceived+' received':'')+'</p>');
              w.document.write('<p class="sz">Ordered: '+szKeys.map(sz=>sz+': '+po[sz]).join(' &nbsp; ')+'</p>');
              if(totalReceived>0)w.document.write('<p class="sz g">Received: '+szKeys.filter(sz=>getRcvd(sz)>0).map(sz=>sz+': '+getRcvd(sz)).join(' &nbsp; ')+'</p>');
              if(totalOpen>0)w.document.write('<p class="sz a">Open: '+szKeys.filter(sz=>getOpen(sz)>0).map(sz=>sz+': '+getOpen(sz)).join(' &nbsp; ')+'</p>');
              w.document.write('</div></div></body></html>');w.document.close();w.print();
            }}>🖨️ Print PO Label</button>
            <button className="btn btn-sm btn-primary" style={{marginTop:8,marginLeft:6,fontSize:11}} onClick={()=>{
              const vendor=po.po_type==='outside_deco'?(po.deco_vendor||'Outside Decorator'):(D_V.find(v=>v.id===item?.vendor_id)?.name||item?.brand||'Vendor');
              const isDPO=po.po_type==='outside_deco';
              const szHeaders=szKeys.filter(sz=>po[sz]>0);
              printDoc({
                title:vendor,docNum:po.po_id,
                docType:isDPO?'DECORATION PURCHASE ORDER':'PURCHASE ORDER',
                headerRight:'<div style="font-size:11px;color:#666">Status: <strong>'+(poStatus==='received'?'Received':poStatus==='partial'?'Partial':'Open')+'</strong></div>',
                infoBoxes:[
                  {label:'Vendor',value:vendor,sub:isDPO?(po.deco_type||'').replace(/_/g,' '):undefined},
                  {label:'Ship To',value:NSA.name,sub:NSA.fullAddr},
                  {label:'Sales Order',value:o.id,sub:(cust?.name||'')+(o.memo?' — '+o.memo:'')},
                  {label:'Expected Date',value:o.expected_date||'TBD',sub:'Rep: '+(REPS.find(r=>r.id===o.created_by)?.name||'—')},
                ],
                tables:[{
                  title:item?.sku+' — '+(item?.name||'')+(item?.color?' · '+item.color:''),
                  headers:['Size',...szHeaders.map(s=>s),'Total'],
                  aligns:['left',...szHeaders.map(()=>'center'),'center'],
                  rows:[
                    {cells:[{value:'<strong>Ordered</strong>',style:'font-weight:700'},...szHeaders.map(s=>({value:po[s]||0,style:(po[s]>0?'font-weight:800;color:#1e3a5f':'')})),{value:totalOrdered,style:'font-weight:800'}]},
                    ...(totalReceived>0?[{cells:[{value:'Received',style:'color:#166534'},...szHeaders.map(s=>({value:getRcvd(s)||'—',style:'color:#166534'})),{value:totalReceived,style:'color:#166534;font-weight:700'}]}]:[]),
                    ...(totalOpen>0?[{cells:[{value:'Open',style:'color:#b45309'},...szHeaders.map(s=>({value:getOpen(s)||'—',style:'color:#b45309'})),{value:totalOpen,style:'color:#b45309;font-weight:700'}]}]:[]),
                  ]
                }],
                notes:isDPO?('Deco Type: '+(po.deco_type||'—').replace(/_/g,' ')+(po.notes?'<br/>'+po.notes:'')):(po.notes||null),
                footer:isDPO?'Expected return: '+(po.expected_date||'TBD'):null
              });
            }}>🖨️ Print Full PO</button>
          </div>
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn btn-sm btn-secondary" style={{fontSize:10,color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
            if(!window.confirm('Delete entire PO? All sizes will go back to open.'))return;
            const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines=updatedItems[editPO.lineIdx].po_lines.filter((_,i)=>i!==editPO.poIdx);
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPO(null);nf('PO deleted');
          }}><Icon name="trash" size={10}/> Delete PO</button>
          <button className="btn btn-primary" onClick={()=>setEditPO(null)}>Close</button>
        </div>
      </div></div>})()}

  </div>);
}

// CUSTOMER DETAIL
function CustDetail({customer:initCust,allCustomers,allOrders,onBack,onEdit,onSelCust,onNewEst,sos,msgs,cu,onOpenSO,ests,onSaveSO}){
  const[tab,setTab]=useState('activity');const[oF,setOF]=useState('all');const[sF,setSF]=useState('all');const[rR,setRR]=useState('thisyear');
  const[editContact,setEditContact]=useState(null);const[custLocal,setCustLocal]=useState(initCust);
  const[showInvEmail,setShowInvEmail]=useState(false);const[invEmailMsg,setInvEmailMsg]=useState('');const[showPortal,setShowPortal]=useState(false);
  const[subsCollapsed,setSubsCollapsed]=useState(false);
  const[portalJobView,setPortalJobView]=useState(null);// {job,so} when viewing a job mockup
  const[portalComment,setPortalComment]=useState('');
  const[portalContactEdit,setPortalContactEdit]=useState(null);
  const[portalContactMsg,setPortalContactMsg]=useState('');
  const[portalInvView,setPortalInvView]=useState(null);// viewing an invoice detail
  React.useEffect(()=>setCustLocal(initCust),[initCust]);
  const customer=custLocal;
  const isP=!customer.parent_id;const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const tl={prepay:'Prepay',net15:'Net 15',net30:'Net 30',net60:'Net 60'};
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const custSOs=(sos||[]).filter(o=>ids.includes(o.customer_id));
  const custEsts=(ests||[]).filter(e=>ids.includes(e.customer_id));
  const orders=allOrders.filter(o=>ids.includes(o.customer_id));
  const fo=orders.filter(o=>{if(oF!=='all'&&o.type!==oF)return false;if(sF==='open')return['sent','draft','open','need_order','waiting_receive'].includes(o.status)||calcSOStatus(o)!=='complete';if(sF==='closed')return['approved','paid','complete'].includes(o.status)||calcSOStatus(o)==='complete';return true});
  const gn=id=>allCustomers.find(x=>x.id===id)?.alpha_tag||'';
  // Contact editing
  const saveContact=(idx,updated)=>{const newContacts=[...(customer.contacts||[])];newContacts[idx]=updated;const newCust={...customer,contacts:newContacts};setCustLocal(newCust);onEdit(newCust);setEditContact(null)};
  const addContact=()=>{const newContacts=[...(customer.contacts||[]),{name:'',email:'',phone:'',role:''}];setCustLocal({...customer,contacts:newContacts});setEditContact(newContacts.length-1)};
  const rmContact=(idx)=>{const newContacts=(customer.contacts||[]).filter((_,i)=>i!==idx);const newCust={...customer,contacts:newContacts};setCustLocal(newCust);onEdit(newCust)};
  // Unread messages for this customer
  const custUnread=(msgs||[]).filter(m=>custSOs.some(s=>s.id===m.so_id)&&!(m.read_by||[]).includes(cu?.id||'')).length;

  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Customers</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="building" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{customer.name}</span><span className="badge badge-blue">{customer.alpha_tag}</span><span className="badge badge-green">Tier {customer.adidas_ua_tier}</span><span className="badge badge-gray">{tl[customer.payment_terms]||'Net 30'}</span>
      {custUnread>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{custUnread} unread</span>}
    </div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(customer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email}{i<customer.contacts.length-1&&' | '}</span>)}</div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
      <button className="btn btn-sm btn-primary" onClick={()=>onNewEst(customer)}><Icon name="file" size={12}/> Estimate</button>
      <button className="btn btn-sm btn-secondary"><Icon name="mail" size={12}/> Email</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>onEdit(customer)}><Icon name="edit" size={12}/> Edit</button>
      {(customer._oi||0)>0&&<>
        <span style={{width:1,background:'#e2e8f0',margin:'0 2px'}}/>
        <button className="btn btn-sm" style={{background:'#dc2626',color:'white',fontSize:11}} onClick={()=>{setInvEmailMsg('Hi '+(customer.contacts||[])[0]?.name+',\n\nPlease find attached your open invoice(s). Let us know if you have any questions.\n\nThank you,\nNSA Team');setShowInvEmail(true)}}>📄 Email Invoices ({customer._oi})</button>
      </>}
      <button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:11}} onClick={()=>setShowPortal(true)}>🔗 Portal</button>
    </div>
  </div>
  {(customer._ob||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>BALANCE</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${customer._ob.toLocaleString()}</div></div>}</div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Est</div><div className="stat-value">{custEsts.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Open SOs</div><div className="stat-value">{custSOs.filter(s=>calcSOStatus(s)!=='complete').length}</div></div><div className="stat-card"><div className="stat-label">Open Inv</div><div className="stat-value" style={{color:(customer._oi||0)>0?'#dc2626':''}}>{customer._oi||0}</div></div><div className="stat-card"><div className="stat-label">Balance</div><div className="stat-value" style={{color:(customer._ob||0)>0?'#dc2626':''}}>${(customer._ob||0).toLocaleString()}</div></div></div>
  {isP&&subs.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header" style={{cursor:'pointer'}} onClick={()=>setSubsCollapsed(!subsCollapsed)}><h2>{subsCollapsed?'▶':'▼'} Sub-Customers ({subs.length})</h2></div>
  {!subsCollapsed&&<div className="card-body" style={{padding:0}}>
  {subs.map(sub=><div key={sub.id} style={{padding:'10px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>onSelCust(sub)}>
    <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{sub.name}</span><span className="badge badge-gray">{sub.alpha_tag}</span><div style={{flex:1}}/>
    {(sub._ob||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${sub._ob.toLocaleString()}</span>}</div>)}</div>}</div>}
  <div className="tabs">{['activity','contacts','overview','artwork','reporting'].map(t=><button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t==='activity'?'Orders':t==='contacts'?'Contacts'+(customer.contacts?.length?' ('+customer.contacts.length+')':''):t[0].toUpperCase()+t.slice(1)}</button>)}</div>

  {/* ORDERS TAB — with live SO status */}
  {tab==='activity'&&<>
    {/* Active SOs with fulfillment progress + nested jobs */}
    {custSOs.filter(s=>calcSOStatus(s)!=='complete').length>0&&<div className="card" style={{marginBottom:12}}><div className="card-header"><h2>Active Sales Orders</h2></div><div className="card-body" style={{padding:0}}>
      <table style={{fontSize:12}}><thead><tr><th>SO</th><th>Memo</th>{isP&&<th>Customer</th>}{isP&&<th>Rep</th>}<th>Status</th><th>Items</th><th>Fulfillment</th><th>Expected</th></tr></thead><tbody>
      {custSOs.filter(s=>calcSOStatus(s)!=='complete').map(so=>{
        const st=calcSOStatus(so);const stL={need_order:'Need to Order',waiting_receive:'Waiting to Receive',items_received:'Items Received',in_production:'In Production',ready_to_invoice:'Ready to Invoice',complete:'Complete'};
        let totalU=0,fulU=0;
        safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+(pk[sz]||0),0);const rQ=safePOs(it).reduce((a,pk)=>a+((pk.received||{})[sz]||0),0);fulU+=Math.min(v,pQ+rQ)})});
        const pct=totalU>0?Math.round(fulU/totalU*100):0;
        const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
        const jobs=so.jobs||[];
        const subC=allCustomers.find(c=>c.id===so.customer_id);
        const rep=REPS.find(r=>r.id===so.created_by);
        const jobArtLabels={needs_art:'Needs Art',waiting_approval:'Wait Approval',art_complete:'Art ✓'};
        const jobProdLabels={hold:'Ready',staging:'In Line',in_process:'In Process',completed:'Done',shipped:'Shipped'};
        const jobItemLabels={need_to_order:'Need Order',partially_received:'Partial',items_received:'Received'};
        return<React.Fragment key={so.id}>
          <tr style={{cursor:'pointer',background:'white'}} onClick={()=>onOpenSO&&onOpenSO(so)}>
            <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td>
            <td>{so.memo}</td>
            {isP&&<td><span className="badge badge-gray">{subC?.alpha_tag}</span></td>}
            {isP&&<td style={{fontSize:11,color:'#64748b'}}>{rep?.name?.split(' ')[0]||'—'}</td>}
            <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[st]?.bg,color:SC[st]?.c}}>{stL[st]}</span></td>
            <td>{safeItems(so).length} items · {totalU} units</td>
            <td><div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:60,background:'#e2e8f0',borderRadius:3,height:5,overflow:'hidden'}}><div style={{height:5,borderRadius:3,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%'}}/></div>
              <span style={{fontSize:11,fontWeight:600}}>{pct}% ({fulU}/{totalU})</span></div></td>
            <td style={{color:daysOut!=null&&daysOut<=7?'#dc2626':'#64748b',fontWeight:daysOut!=null&&daysOut<=7?700:400}}>{so.expected_date||'—'}{daysOut!=null&&daysOut>=0&&<span style={{fontSize:10,color:'#94a3b8',marginLeft:4}}>({daysOut}d)</span>}</td>
          </tr>
          {/* Nested jobs under this SO */}
          {jobs.length>0&&jobs.map(j=><tr key={j.id} style={{background:'#f8fafc',cursor:'pointer'}} onClick={()=>onOpenSO&&onOpenSO(so)}>
            <td style={{paddingLeft:28,color:'#64748b',fontSize:11}}>↳ {j.id}</td>
            <td style={{fontSize:11}}>{j.art_name} <span style={{color:'#94a3b8'}}>({j.deco_type?.replace(/_/g,' ')})</span></td>
            {isP&&<td/>}{isP&&<td/>}
            <td><div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
              <span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{jobItemLabels[j.item_status]||j.item_status}</span>
              <span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{jobArtLabels[j.art_status]||j.art_status}</span>
            </div></td>
            <td style={{fontSize:11}}>{(j.items||[]).map(gi=>gi.sku).join(', ')||'—'}</td>
            <td><div style={{display:'flex',alignItems:'center',gap:4}}>
              <div style={{width:40,background:'#e2e8f0',borderRadius:3,height:4,overflow:'hidden'}}><div style={{height:4,borderRadius:3,background:j.fulfilled_units>=j.total_units?'#22c55e':j.fulfilled_units>0?'#f59e0b':'#e2e8f0',width:(j.total_units>0?j.fulfilled_units/j.total_units*100:0)+'%'}}/></div>
              <span style={{fontSize:10}}>{j.fulfilled_units}/{j.total_units}</span></div></td>
            <td><span style={{padding:'1px 5px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#64748b'}}>{jobProdLabels[j.prod_status]||j.prod_status}</span></td>
          </tr>)}
          {jobs.length===0&&<tr style={{background:'#f8fafc'}}><td colSpan={isP?8:6} style={{paddingLeft:28,fontSize:10,color:'#94a3b8',fontStyle:'italic'}}>No decorations assigned yet</td></tr>}
        </React.Fragment>})}
      </tbody></table>
    </div></div>}
    {/* All transactions — unified: est, SO, inv, IF, PO, payments */}
    {(()=>{
      // Build unified transaction list
      const txns=[];
      // Existing orders (est, SO, inv)
      orders.forEach(o=>{txns.push({id:o.id,type:o.type,date:o.date||o.created_at?.split(' ')[0],memo:o.memo,customer_id:o.customer_id,total:o.total,status:o.status,so_id:o.type==='sales_order'?o.id:null,_src:'order',_o:o})});
      // IFs and POs from SOs
      custSOs.forEach(so=>{
        const subC=allCustomers.find(c=>c.id===so.customer_id);
        safeItems(so).forEach(it=>{
          safePicks(it).forEach(pk=>{
            if(!pk.pick_id)return;
            const qty=Object.entries(pk).filter(([k,v])=>k!=='status'&&k!=='pick_id'&&k!=='created_at'&&k!=='memo'&&typeof v==='number'&&v>0).reduce((a,[,v])=>a+v,0);
            txns.push({id:pk.pick_id,type:'if',date:pk.created_at||'',memo:it.name+' ('+it.sku+')'+' — '+so.memo,customer_id:so.customer_id,total:null,status:pk.status,so_id:so.id,_src:'if'});
          });
          safePOs(it).forEach(po=>{
            if(!po.po_id)return;
            const qty=Object.entries(po).filter(([k,v])=>k!=='status'&&k!=='po_id'&&k!=='vendor'&&k!=='created_at'&&k!=='memo'&&k!=='received'&&k!=='ship_dates'&&typeof v==='number'&&v>0).reduce((a,[,v])=>a+v,0);
            const cost=qty*(it.unit_cost||0);
            txns.push({id:po.po_id,type:'po',date:po.created_at||'',memo:it.name+' ('+it.sku+')'+' — '+(po.vendor||'Vendor'),customer_id:so.customer_id,total:cost>0?cost:null,status:po.status,so_id:so.id,_src:'po'});
          });
        });
      });
      // Deduplicate IFs and POs by id (same IF can appear on multiple items)
      const seen=new Set();const deduped=[];
      txns.forEach(t=>{const key=t.id+t._src;if(!seen.has(key)){seen.add(key);deduped.push(t)}});

      const typeLabels={estimate:'Est',sales_order:'SO',invoice:'Inv',if:'IF',po:'PO',payment:'Pmt'};
      const typeBadge={estimate:'badge-amber',sales_order:'badge-blue',invoice:'badge-red',if:'badge-green',po:'badge-purple',payment:'badge-green'};
      const statusBadge=st=>{if(!st)return'badge-gray';if(['open','sent','waiting','needs_pull'].includes(st))return'badge-amber';if(['approved','paid','pulled','received','complete'].includes(st))return'badge-green';if(['draft','cancelled'].includes(st))return'badge-gray';return'badge-blue'};

      // Filter
      const filt=deduped.filter(t=>{
        if(oF!=='all'&&t.type!==oF)return false;
        if(sF==='open')return['sent','draft','open','waiting','needs_pull','in_production','need_order','waiting_receive','partial'].includes(t.status);
        if(sF==='closed')return['approved','paid','pulled','received','complete','completed','shipped','cancelled'].includes(t.status);
        return true;
      }).sort((a,b)=>(b.date||'').localeCompare(a.date||''));

      return<div className="card"><div className="card-header"><h2>All Transactions</h2><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {[['all','All'],['estimate','Est'],['sales_order','SO'],['invoice','Inv'],['if','IF'],['po','PO']].map(([v,l])=><button key={v} className={`btn btn-sm ${oF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOF(v)}>{l}</button>)}
        <span style={{width:1,background:'#e2e8f0',margin:'0 4px'}}/>
        {[['all','All'],['open','Open'],['closed','Closed']].map(([v,l])=><button key={v} className={`btn btn-sm ${sF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setSF(v)}>{l}</button>)}
      </div></div><div className="card-body" style={{padding:0}}><table style={{fontSize:12}}><thead><tr><th>ID</th><th>Type</th><th>Date</th><th>SO</th><th>Memo</th>{isP&&<th>Sub</th>}<th>Amount</th><th>Status</th></tr></thead><tbody>
        {filt.length===0?<tr><td colSpan={8} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>:
        filt.map((t,i)=><tr key={t.id+'-'+i} style={{cursor:t._src==='order'?'pointer':undefined}} onClick={()=>{if(t._src==='order'){const so2=(sos||[]).find(s=>s.id===t.id);if(so2&&onOpenSO)onOpenSO(so2)}else if(t.so_id){const so2=(sos||[]).find(s=>s.id===t.so_id);if(so2&&onOpenSO)onOpenSO(so2)}}}>
          <td style={{fontWeight:700,color:'#1e40af'}}>{t.id}</td>
          <td><span className={`badge ${typeBadge[t.type]||'badge-gray'}`}>{typeLabels[t.type]||t.type}</span></td>
          <td style={{fontSize:11,color:'#64748b'}}>{t.date}</td>
          <td style={{fontSize:11,color:'#94a3b8'}}>{t.so_id&&t._src!=='order'?t.so_id:'—'}</td>
          <td>{t.memo}</td>
          {isP&&<td><span className="badge badge-gray">{gn(t.customer_id)}</span></td>}
          <td style={{fontWeight:t.total?700:400,color:t.type==='invoice'&&t.status==='open'?'#dc2626':t.total?'#374151':'#94a3b8'}}>{t.total?'$'+t.total.toLocaleString():'—'}</td>
          <td><span className={`badge ${statusBadge(t.status)}`}>{t.status?.replace(/_/g,' ')||'—'}</span></td>
        </tr>)}</tbody></table></div></div>})()}
  </>}

  {/* CONTACTS TAB — editable */}
  {tab==='contacts'&&<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
    <h2>Contacts</h2><button className="btn btn-sm btn-primary" onClick={addContact}><Icon name="plus" size={12}/> Add Contact</button>
  </div><div className="card-body" style={{padding:0}}>
    {(customer.contacts||[]).length===0&&<div style={{padding:20,textAlign:'center',color:'#94a3b8'}}>No contacts</div>}
    {(customer.contacts||[]).map((c,i)=>editContact===i?
      <div key={i} style={{padding:14,borderBottom:'1px solid #f1f5f9',background:'#fffbeb'}}>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Name</label><input className="form-input" value={c.name} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],name:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Role</label><input className="form-input" value={c.role} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],role:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:180}}><label className="form-label">Email</label><input className="form-input" type="email" value={c.email} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],email:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
          <div style={{flex:1,minWidth:140}}><label className="form-label">Phone</label><input className="form-input" value={c.phone||''} onChange={e=>{const nc=[...(customer.contacts||[])];nc[i]={...nc[i],phone:e.target.value};setCustLocal({...customer,contacts:nc})}}/></div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm btn-primary" onClick={()=>saveContact(i,customer.contacts[i])}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={()=>{setCustLocal(initCust);setEditContact(null)}}>Cancel</button>
          <button className="btn btn-sm" style={{background:'#dc2626',color:'white',marginLeft:'auto'}} onClick={()=>{if(window.confirm('Delete this contact?'))rmContact(i)}}>Delete</button>
        </div>
      </div>
    :<div key={i} style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:36,height:36,borderRadius:18,background:'#e0e7ff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#3730a3',fontSize:14}}>{(c.name||'?')[0]}</div>
        <div style={{flex:1}}>
          <div><strong>{c.name}</strong> <span style={{fontSize:11,color:'#64748b'}}>({c.role})</span></div>
          <div style={{fontSize:12,color:'#64748b'}}>{c.email}{c.phone&&` · ${c.phone}`}</div>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={()=>setEditContact(i)}><Icon name="edit" size={12}/></button>
      </div>)}
  </div></div>}

  {tab==='overview'&&<div className="card"><div className="card-header"><h2>Info</h2></div><div className="card-body">
    <div className="form-row form-row-3"><div><div className="form-label">Billing</div><div style={{fontSize:13}}>{customer.billing_address_line1||'--'}<br/>{customer.billing_city}, {customer.billing_state} {customer.billing_zip}</div></div>
    <div><div className="form-label">Shipping</div><div style={{fontSize:13}}>{customer.shipping_address_line1||'--'}<br/>{customer.shipping_city}, {customer.shipping_state}</div></div>
    <div><div className="form-label">Tax</div><div style={{fontSize:13}}>{customer.tax_rate?(customer.tax_rate*100).toFixed(2)+'%':'Auto'}</div></div></div>
  </div></div>}
  {tab==='artwork'&&<div className="card"><div className="card-body"><div className="empty">Customer art library — aggregates from SOs (Phase 3)</div></div></div>}
  {tab==='reporting'&&<div className="card"><div className="card-header"><h2>Reporting</h2><div style={{display:'flex',gap:4}}>{[['thisyear','This Year'],['lastyear','Last Year'],['rolling','Rolling 12'],['alltime','All']].map(([v,l])=><button key={v} className={`btn btn-sm ${rR===v?'btn-primary':'btn-secondary'}`} onClick={()=>setRR(v)}>{l}</button>)}</div></div>
    <div className="card-body"><div className="stats-row"><div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{rR==='thisyear'?'$15,600':'$32,600'}</div></div><div className="stat-card"><div className="stat-label">Orders</div><div className="stat-value">{rR==='thisyear'?'4':'8'}</div></div><div className="stat-card"><div className="stat-label">Avg Order</div><div className="stat-value">{rR==='thisyear'?'$3,900':'$4,075'}</div></div></div></div></div>}

  {/* EMAIL INVOICE MODAL */}
  {showInvEmail&&(()=>{
    const openInvs=allOrders.filter(oo=>ids.includes(oo.customer_id)&&oo.type==='invoice'&&oo.status==='open');
    const acctContact=(customer.contacts||[]).find(c=>c.role==='Accounting')||(customer.contacts||[])[0];
    const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
    return<div className="modal-overlay" onClick={()=>setShowInvEmail(false)}><div className="modal" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
      <div className="modal-header"><h2>📄 Email Invoices</h2><button className="modal-close" onClick={()=>setShowInvEmail(false)}>×</button></div>
      <div className="modal-body">
        {/* Sending to */}
        <div style={{background:'#f8fafc',borderRadius:8,padding:12,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>SENDING TO</div>
          <div style={{fontSize:14,fontWeight:600}}>{acctContact?.name||'—'} <span style={{fontSize:12,color:'#64748b'}}>({acctContact?.role||'Primary'})</span></div>
          <div style={{fontSize:13,color:'#2563eb'}}>{acctContact?.email||'No email on file'}</div>
          {(customer.contacts||[]).length>1&&<div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Tip: Set a contact's role to "Accounting" to auto-send invoices there</div>}
        </div>
        {/* Invoice list */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>INVOICES TO INCLUDE</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
            {openInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
              return<div key={inv.id} style={{padding:'10px 14px',borderBottom:i<openInvs.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:'#1e40af'}}>{inv.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{inv.memo||'Invoice'} · {inv.date||'—'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:700,color:'#dc2626'}}>${bal.toLocaleString()}</div>
                  <div style={{fontSize:10,color:age>30?'#dc2626':age>14?'#d97706':'#64748b'}}>{age>0?age+' days old':'Current'}</div>
                </div>
              </div>})}
            <div style={{padding:'10px 14px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:700,color:'#dc2626'}}>Total Due</span>
              <span style={{fontSize:18,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
            </div>
          </div>
        </div>
        {/* Message */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>MESSAGE</div>
          <textarea className="form-input" rows={5} value={invEmailMsg} onChange={e=>setInvEmailMsg(e.target.value)} style={{fontFamily:'inherit',fontSize:13}}/>
        </div>
        {/* Preview */}
        <div style={{background:'#f8fafc',borderRadius:8,padding:12,marginTop:14,fontSize:11,color:'#64748b'}}>
          <strong>Preview:</strong> Email will include this message + PDF attachment{openInvs.length>1?'s':''} for {openInvs.map(i=>i.id).join(', ')}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowInvEmail(false)}>Cancel</button>
        <button className="btn btn-primary" style={{background:'#dc2626'}} onClick={()=>{setShowInvEmail(false);alert('📧 Invoice email sent to '+acctContact?.email+' with '+openInvs.length+' invoice(s)! (demo)')}}>📧 Send {openInvs.length} Invoice{openInvs.length>1?'s':''}</button>
      </div>
    </div></div>})()}

  {/* CUSTOMER PORTAL VIEW */}
  {showPortal&&(()=>{
    const activeSOs=custSOs.filter(s=>calcSOStatus(s)!=='complete');
    const completedSOs=custSOs.filter(s=>calcSOStatus(s)==='complete');
    const openInvs=allOrders.filter(oo=>ids.includes(oo.customer_id)&&oo.type==='invoice'&&oo.status==='open');
    const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
    const rep=REPS.find(r=>r.id===customer.primary_rep_id);
    // Collect all jobs across customer's SOs
    const allPortalJobs=[];activeSOs.forEach(so=>{safeJobs(so).forEach(j=>{allPortalJobs.push({...j,so,soMemo:so.memo})})});
    const artLabelsP={needs_art:'Art Needed',waiting_approval:'Awaiting Your Approval',art_complete:'Approved'};
    const prodLabelsP={hold:'Ready for Production',staging:'In Line',in_process:'In Production',completed:'Done',shipped:'Shipped'};

    // Job detail view inside portal
    if(portalJobView){
      const j=portalJobView.job;const so=portalJobView.so;
      const items=(j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return{...gi,brand:it?.brand||'',fullName:safeStr(it?.name)||gi.name}});
      return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:640,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',borderRadius:'12px 12px 0 0',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setPortalJobView(null)}>← Back</button>
          <button style={{position:'absolute',top:8,right:12,background:'none',border:'none',color:'white',fontSize:18,cursor:'pointer',opacity:0.7}} onClick={()=>{setPortalJobView(null);setShowPortal(false)}}>×</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ARTWORK PROOF</div>
            <div style={{fontSize:18,fontWeight:800}}>{j.art_name}</div>
            <div style={{fontSize:12,opacity:0.7}}>{so.memo} · {j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* Per-item mockups */}
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>🖼️ Mockups per Garment</div>
          {items.map((gi,i)=><div key={i} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10,display:'flex',gap:14,alignItems:'center'}}>
            <div style={{width:80,height:80,background:'#f8fafc',border:'2px dashed #d1d5db',borderRadius:8,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <div style={{fontSize:24}}>👕</div>
              <div style={{fontSize:8,color:'#94a3b8',textAlign:'center'}}>{j.deco_type?.replace(/_/g,' ')}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{gi.fullName}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{gi.sku} · {gi.color||'—'} {gi.brand&&'· '+gi.brand}</div>
              <div style={{fontSize:11,color:'#64748b',marginTop:2}}>📍 {j.positions} · {gi.units} units</div>
              <div style={{fontSize:10,color:'#94a3b8',marginTop:4,fontStyle:'italic'}}>Mockup preview when art files are uploaded</div>
            </div>
          </div>)}

          {/* Approve / Reject */}
          {j.art_status==='waiting_approval'&&<div style={{border:'2px solid #f59e0b',background:'#fffbeb',borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontWeight:700,color:'#92400e',marginBottom:8}}>⏳ This artwork needs your approval</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center'}} onClick={()=>{
                const artId=j.art_file_id;if(artId&&onSaveSO){const updatedSO={...so,art_files:(so.art_files||[]).map(af=>af.id===artId?{...af,status:'approved'}:af),updated_at:new Date().toLocaleString()};onSaveSO(updatedSO)}
                setPortalJobView(null)}}>✅ Approve</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center'}} onClick={()=>{if(portalComment.trim()){alert('❌ Rejected with feedback. (demo)');setPortalComment('');setPortalJobView(null)}else{alert('Please add a comment.')}}}>❌ Request Changes</button>
            </div>
          </div>}
          {j.art_status==='art_complete'&&<div style={{background:'#f0fdf4',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#166534',fontWeight:600}}>✅ You approved this artwork</div>}
          {/* Status */}
          {j.prod_status!=='hold'&&<div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:16}}>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PRODUCTION STATUS</div>
            <div style={{fontSize:14,fontWeight:700,color:'#1e40af',marginTop:2}}>{prodLabelsP[j.prod_status]||j.prod_status}</div>
          </div>}
          {/* Comments */}
          <div>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>💬 Comments</div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:8,marginBottom:8,minHeight:40}}>
              <div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No comments yet</div>
            </div>
            <div style={{display:'flex',gap:6}}>
              <input className="form-input" placeholder="Add a comment..." value={portalComment} onChange={e=>setPortalComment(e.target.value)} style={{flex:1,fontSize:12}}/>
              <button className="btn btn-sm btn-primary" onClick={()=>{if(portalComment.trim()){alert('Comment sent! (demo)');setPortalComment('')}}}>Send</button>
            </div>
          </div>
        </div>
      </div></div>
    }

    // Invoice detail view inside portal
    if(portalInvView){
      const inv=portalInvView;const bal=(inv.total||0)-(inv.paid||0);
      return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:550,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{background:'linear-gradient(135deg,#991b1b,#dc2626)',color:'white',padding:'20px 24px',borderRadius:'12px 12px 0 0',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setPortalInvView(null)}>← Back</button>
          <button style={{position:'absolute',top:8,right:12,background:'none',border:'none',color:'white',fontSize:18,cursor:'pointer',opacity:0.7}} onClick={()=>{setPortalInvView(null);setShowPortal(false)}}>×</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>INVOICE</div>
            <div style={{fontSize:20,fontWeight:800}}>{inv.id}</div>
            <div style={{fontSize:13,opacity:0.8}}>{inv.memo||'—'}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Amount Due</div>
            <div style={{fontSize:36,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div>
            {inv.paid>0&&<div style={{fontSize:12,color:'#64748b'}}>Paid: ${inv.paid.toLocaleString()} of ${inv.total.toLocaleString()}</div>}
          </div>
          {/* Line items */}
          {inv.items?.length>0&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Items</div>
            {inv.items.map((li,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{li.name||li.sku}</div><div style={{fontSize:11,color:'#64748b'}}>{li.qty} × ${safeNum(li.unit_sell).toFixed(2)}</div></div>
              <div style={{fontWeight:700,fontSize:13}}>${(li.qty*safeNum(li.unit_sell)).toFixed(2)}</div>
            </div>)}
          </div>}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:'2px solid #e2e8f0'}}>
            <span style={{fontWeight:800}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#dc2626'}}>${inv.total?.toLocaleString()}</span>
          </div>
          {bal>0&&<button style={{width:'100%',marginTop:16,padding:'14px 20px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer'}} onClick={()=>alert('Pay $'+bal.toLocaleString()+' (demo)')}>
            💳 Pay ${bal.toLocaleString()}
          </button>}
          {bal<=0&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Paid in Full</div>}
        </div>
      </div></div>
    }

    return<div className="modal-overlay" onClick={()=>setShowPortal(false)}><div className="modal" style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
      {/* Portal header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'24px 28px',borderRadius:'12px 12px 0 0',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:11,opacity:0.7,letterSpacing:1,marginBottom:4}}>NATIONAL SPORTS APPAREL</div>
            <div style={{fontSize:22,fontWeight:800}}>{customer.name}</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>Customer Portal</div>
          </div>
          <div style={{textAlign:'right'}}>
            {totalDue>0&&<><div style={{fontSize:10,opacity:0.7}}>BALANCE DUE</div><div style={{fontSize:24,fontWeight:800}}>${totalDue.toLocaleString()}</div></>}
          </div>
        </div>
        <button style={{position:'absolute',top:12,right:16,background:'none',border:'none',color:'white',fontSize:20,cursor:'pointer',opacity:0.7}} onClick={()=>setShowPortal(false)}>×</button>
      </div>
      <div style={{padding:'20px 28px'}}>

        {/* Pay Now button */}
        {totalDue>0&&<div style={{marginBottom:16}}>
          <button style={{width:'100%',padding:'14px 20px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10}} onClick={()=>alert('Payment portal opening... (demo)\n\nThis would connect to Stripe for CC + Apple Pay processing.\nAmount: $'+totalDue.toLocaleString())}>
            💳 Pay Now — ${totalDue.toLocaleString()}
          </button>
          <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:6}}>
            <span style={{fontSize:10,color:'#94a3b8'}}>💳 Credit Card</span>
            <span style={{fontSize:10,color:'#94a3b8'}}> Apple Pay</span>
            <span style={{fontSize:10,color:'#94a3b8'}}>🏦 ACH/Bank</span>
          </div>
        </div>}

        {/* Open Estimates */}
        {(()=>{const pEsts=custEsts.filter(e=>e.status==='sent'||e.status==='draft');
          return pEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>📋 Estimates ({pEsts.length})</div>
          {pEsts.map(est=>{const t=(est.items||[]).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const dp2=dP(d,qq,[],qq);r+=qq*dp2.sell});return a+r},0);
            return<div key={est.id} style={{border:'1px solid #f59e0b',borderRadius:10,padding:14,marginBottom:10,background:'#fffbeb'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{est.memo||est.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#92400e'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                  <span className={'badge '+(est.status==='sent'?'badge-amber':'badge-gray')}>{est.status}</span></div>
              </div></div>})}
          </>})()}

        {/* Active orders with clickable jobs */}
        {activeSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f',marginBottom:10}}>📦 Active Orders</div>
          {activeSOs.map(so=>{
            let totalU=0,fulU=0;
            safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
            const pct=totalU>0?Math.round(fulU/totalU*100):0;
            const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
            const soJobs=safeJobs(so);
            return<div key={so.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{so.memo||so.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Order {so.id} · {so.created_at?.split(' ')[0]}</div>
                </div>
                {so.expected_date&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'#64748b'}}>EXPECTED</div>
                  <div style={{fontSize:14,fontWeight:700,color:daysOut!=null&&daysOut<=7?'#dc2626':'#1e3a5f'}}>{so.expected_date}</div>
                </div>}
              </div>
              {/* Progress */}
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
                  <span style={{fontSize:11,fontWeight:700,color:pct>=100?'#166534':'#1e3a5f'}}>{pct}%</span>
                </div>
                <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
                  <div style={{height:8,borderRadius:6,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>
              </div>
              {/* Items */}
              <div style={{fontSize:12,marginBottom:soJobs.length>0?10:0}}>
                {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                  return<div key={ii} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #f8fafc'}}>
                    <span>{safeStr(it.name)||'Item'} <span style={{color:'#94a3b8'}}>({safeStr(it.color)||'—'})</span></span>
                    <span style={{fontWeight:600,color:'#64748b'}}>{qty} units</span></div>})}
              </div>
              {/* Clickable jobs — artwork proofs */}
              {soJobs.length>0&&<>
                <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>🎨 Artwork & Decoration</div>
                {soJobs.map(j=><div key={j.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',border:'1px solid '+(j.art_status==='waiting_approval'?'#f59e0b':'#e2e8f0'),background:j.art_status==='waiting_approval'?'#fffbeb':'#fafbfc',borderRadius:8,marginBottom:6,cursor:'pointer'}} onClick={()=>{setPortalJobView({job:j,so});setPortalComment('')}}>
                  <div style={{width:36,height:36,borderRadius:6,background:j.art_status==='art_complete'?'#dcfce7':j.art_status==='waiting_approval'?'#fef3c7':'#fee2e2',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
                    {j.art_status==='art_complete'?'✅':j.art_status==='waiting_approval'?'⏳':'🎨'}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:12}}>{j.art_name}</div>
                    <div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:j.art_status==='art_complete'?'#dcfce7':j.art_status==='waiting_approval'?'#fef3c7':'#fee2e2',color:j.art_status==='art_complete'?'#166534':j.art_status==='waiting_approval'?'#92400e':'#dc2626'}}>{artLabelsP[j.art_status]}</span>
                    {j.prod_status!=='hold'&&<div style={{fontSize:9,color:'#64748b',marginTop:2}}>{prodLabelsP[j.prod_status]}</div>}
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>)}
              </>}
              {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534'}}>
                📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
            </div>})}
        </>}

        {/* Completed orders */}
        {completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between'}}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <span className="badge badge-green">Complete</span></div>)}
        </>}

        {/* Open invoices with pay buttons */}
        {openInvs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#dc2626',marginBottom:10,marginTop:16}}>💰 Open Invoices</div>
          <div style={{border:'1px solid #fecaca',borderRadius:10,overflow:'hidden'}}>
            {openInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
              return<div key={inv.id} style={{padding:'12px 16px',borderBottom:i<openInvs.length-1?'1px solid #fef2f2':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setPortalInvView(inv)}>
                <div>
                  <div style={{fontWeight:700}}>{inv.id} <span style={{fontSize:11,color:'#64748b'}}>{inv.memo}</span></div>
                  <div style={{fontSize:11,color:age>30?'#dc2626':'#64748b'}}>{inv.date} · {age>0?age+' days ago':'Current'}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:800,fontSize:16,color:'#dc2626'}}>${bal.toLocaleString()}</span>
                  <button className="btn btn-sm" style={{background:'#22c55e',color:'white',fontSize:10}} onClick={e=>{e.stopPropagation();setPortalInvView(inv)}}>View</button>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
            <div style={{padding:'12px 16px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:800,color:'#dc2626'}}>Total Balance Due</span>
              <span style={{fontSize:20,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
            </div>
          </div>
        </>}

        {/* Your rep */}
        <div style={{marginTop:20,padding:14,background:'#f8fafc',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>YOUR NSA REP</div>
          <div style={{fontSize:14,fontWeight:600}}>{rep?.name||'NSA Team'}</div>
          <div style={{fontSize:12,color:'#64748b'}}>National Sports Apparel · team@nsa-teamwear.com</div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>alert('Message to '+rep?.name+' (demo)')}>💬 Message Your Rep</button>
        </div>

        {/* Contact update — sends to rep for approval */}
        <div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:6}}>📋 Update Contact / Shipping Info</div>
          {!portalContactEdit?<>
            <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Current: {(customer.contacts||[])[0]?.name} · {(customer.contacts||[])[0]?.email}{customer.shipping_city&&' · '+customer.shipping_city+', '+customer.shipping_state}</div>
            <button className="btn btn-sm btn-secondary" onClick={()=>setPortalContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})}>✏️ Request Update</button>
          </>:<>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Name" style={{flex:1,fontSize:12}} value={portalContactEdit.name} onChange={e=>setPortalContactEdit(p=>({...p,name:e.target.value}))}/><input className="form-input" placeholder="Email" style={{flex:1,fontSize:12}} value={portalContactEdit.email} onChange={e=>setPortalContactEdit(p=>({...p,email:e.target.value}))}/></div>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Phone" style={{flex:1,fontSize:12}} value={portalContactEdit.phone} onChange={e=>setPortalContactEdit(p=>({...p,phone:e.target.value}))}/><input className="form-input" placeholder="Shipping Address" style={{flex:1,fontSize:12}} value={portalContactEdit.shipping} onChange={e=>setPortalContactEdit(p=>({...p,shipping:e.target.value}))}/></div>
              <textarea className="form-input" placeholder="Notes for your rep (optional)" rows={2} style={{fontSize:12}} value={portalContactMsg} onChange={e=>setPortalContactMsg(e.target.value)}/>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{alert('📩 Update request sent to '+rep?.name+' for approval! (demo)\n\nYour rep will review and update your info.');setPortalContactEdit(null);setPortalContactMsg('')}}>Send Request</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setPortalContactEdit(null);setPortalContactMsg('')}}>Cancel</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6}}>Changes will be reviewed by your rep before updating</div>
          </>}
        </div>
      </div>
    </div></div>})()}

  </div>)}

// VENDOR DETAIL
function VendDetail({vendor,onBack}){return(<div><button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Vendors</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="package" size={28}/></div>
  <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{vendor.name}</span><span className={`badge ${vendor.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{vendor.vendor_type==='api'?'API':'Upload'}</span><span className="badge badge-gray">{vendor.payment_terms?.replace('net','Net ')}</span>{vendor.nsa_carries_inventory&&<span className="badge badge-green">Stock</span>}</div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{vendor.contact_email} {vendor.rep_name&&`| Rep: ${vendor.rep_name}`}</div>{vendor.notes&&<div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{vendor.notes}</div>}</div>
  {(vendor._it||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>OWED</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${vendor._it.toLocaleString()}</div></div>}</div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Invoices</div><div className="stat-value">{vendor._oi||0}</div></div><div className="stat-card"><div className="stat-label">Current</div><div className="stat-value" style={{color:'#166534'}}>${(vendor._ac||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">30 Day</div><div className="stat-value" style={{color:(vendor._a3||0)>0?'#d97706':''}}>${(vendor._a3||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">60+</div><div className="stat-value" style={{color:(vendor._a6||0)>0?'#dc2626':''}}>${((vendor._a6||0)+(vendor._a9||0)).toLocaleString()}</div></div></div>
  <div className="card"><div className="card-header"><h2>Purchase Orders</h2></div><div className="card-body"><div className="empty">PO tracking — Phase 4</div></div></div></div>)}

// MODALS
function CustModal({isOpen,onClose,onSave,customer,parents}){
  const b={parent_id:null,name:'',alpha_tag:'',contacts:[{name:'',email:'',phone:'',role:'Head Coach'}],shipping_city:'',shipping_state:'',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30'};
  const[f,setF]=useState(customer||b);const[ct,setCt]=useState(customer?.parent_id?'sub':'parent');const[err,setErr]=useState({});
  const sv=(k,v)=>setF(x=>({...x,[k]:v}));React.useEffect(()=>{setF(customer||b);setCt(customer?.parent_id?'sub':'parent');setErr({})},[customer,isOpen]); // eslint-disable-line
  const addC=()=>sv('contacts',[...(f.contacts||[]),{name:'',email:'',phone:'',role:'Head Coach'}]);const rmC=i=>sv('contacts',(f.contacts||[]).filter((_,x)=>x!==i));
  const upC=(i,k,v)=>sv('contacts',(f.contacts||[]).map((c,x)=>x===i?{...c,[k]:v}:c));
  const ok=()=>{const e={};if(!f.name)e.n=1;if(!f.alpha_tag)e.a=1;if(!f.shipping_city)e.c=1;if(!f.shipping_state)e.s=1;if(ct==='sub'&&!f.parent_id)e.p=1;if(!(f.contacts||[])[0]?.name)e.cn=1;if(!(f.contacts||[])[0]?.email)e.ce=1;setErr(e);return!Object.keys(e).length};
  if(!isOpen)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700}}>
  <div className="modal-header"><h2>{customer?.id?'Edit':'New'} Customer</h2><button className="modal-close" onClick={onClose}>x</button></div>
  <div className="modal-body">
    <div style={{display:'flex',gap:8,marginBottom:16}}>{['parent','sub'].map(t=><button key={t} className={`btn btn-sm ${ct===t?'btn-primary':'btn-secondary'}`} onClick={()=>{setCt(t);if(t==='parent')sv('parent_id',null)}}>{t==='parent'?'Parent':'Sub'}</button>)}</div>
    {ct==='sub'&&<div style={{marginBottom:12}}><label className="form-label">Parent *</label><SearchSelect options={parents.map(p=>({value:p.id,label:`${p.name} (${p.alpha_tag})`}))} value={f.parent_id} onChange={v=>sv('parent_id',v)} placeholder="Search parent..."/></div>}
    <div className="form-row form-row-3"><div><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e=>sv('name',e.target.value)} style={err.n?{borderColor:'#dc2626'}:{}}/></div>
      <div><label className="form-label">Alpha Tag *</label><input className="form-input" value={f.alpha_tag||''} onChange={e=>sv('alpha_tag',e.target.value)} style={err.a?{borderColor:'#dc2626'}:{}}/></div>
      <div><label className="form-label">Terms</label><select className="form-select" value={f.payment_terms||'net30'} onChange={e=>sv('payment_terms',e.target.value)}><option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:8,marginBottom:6,textTransform:'uppercase'}}>Contacts</div>
    {(f.contacts||[]).map((c,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 100px auto',gap:6,marginBottom:6}}>
      <input className="form-input" placeholder="Name *" value={c.name} onChange={e=>upC(i,'name',e.target.value)}/>
      <input className="form-input" placeholder="Email *" value={c.email} onChange={e=>upC(i,'email',e.target.value)}/>
      <input className="form-input" placeholder="Phone" value={c.phone} onChange={e=>upC(i,'phone',e.target.value)}/>
      <select className="form-select" value={c.role} onChange={e=>upC(i,'role',e.target.value)} style={{fontSize:11}}>{CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}</select>
      {i>0?<button className="btn btn-sm btn-secondary" onClick={()=>rmC(i)}><Icon name="trash" size={12}/></button>:<div/>}</div>)}
    <button className="btn btn-sm btn-secondary" onClick={addC}><Icon name="plus" size={12}/> Contact</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Shipping</div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:8}}><input className="form-input" placeholder="Street" value={f.shipping_address_line1||''} onChange={e=>sv('shipping_address_line1',e.target.value)}/><input className="form-input" placeholder="City *" value={f.shipping_city||''} onChange={e=>sv('shipping_city',e.target.value)} style={err.c?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ST" value={f.shipping_state||''} onChange={e=>sv('shipping_state',e.target.value)} style={err.s?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ZIP" value={f.shipping_zip||''} onChange={e=>sv('shipping_zip',e.target.value)}/></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Pricing</div>
    <div className="form-row form-row-2"><div><label className="form-label">Tier</label><select className="form-select" value={f.adidas_ua_tier||'B'} onChange={e=>sv('adidas_ua_tier',e.target.value)}><option value="A">A - 40%</option><option value="B">B - 35%</option><option value="C">C - 30%</option></select></div>
      <div><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={f.catalog_markup||1.65} onChange={e=>sv('catalog_markup',parseFloat(e.target.value)||1.65)}/></div></div>
  </div>
  <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{if(!ok())return;onSave({...f,id:f.id||'c'+Date.now(),parent_id:ct==='sub'?f.parent_id:null,is_active:true,_oe:f._oe||0,_os:f._os||0,_oi:f._oi||0,_ob:f._ob||0});onClose()}}>Save</button></div></div></div>);
}
function AdjModal({isOpen,onClose,product,onSave}){const[a,setA]=useState({});const[d,setD]=useState({});React.useEffect(()=>{if(product){setA({...product._inv});setD({})}},[product,isOpen]);if(!isOpen||!product)return null;
  const applyDelta=(sz,val)=>{const cur=product._inv?.[sz]||0;const delta=parseInt(val)||0;setD(x=>({...x,[sz]:delta}));setA(x=>({...x,[sz]:Math.max(0,cur+delta)}))};
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
    <div className="modal-header"><h2>Adjust Inventory</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body"><div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:16}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{product.sku}</span> {product.name}</div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{product.available_sizes.map(sz=>{const cur=product._inv?.[sz]||0;const delta=d[sz]||0;const newVal=Math.max(0,cur+delta);
        return<div key={sz} style={{textAlign:'center',minWidth:56}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:2}}>{sz}</div>
          <div style={{fontSize:18,fontWeight:800,color:'#0f172a',marginBottom:2}}>{cur}</div>
          <div style={{fontSize:9,color:'#94a3b8',marginBottom:4}}>current</div>
          <input style={{width:52,textAlign:'center',border:'2px solid '+(delta>0?'#22c55e':delta<0?'#ef4444':'#d1d5db'),borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,color:delta>0?'#166534':delta<0?'#dc2626':'#0f172a',background:delta>0?'#f0fdf4':delta<0?'#fef2f2':'white'}}
            value={delta===0?'':((delta>0?'+':'')+delta)} placeholder="±0"
            onChange={e=>{const raw=e.target.value.replace(/[^0-9\-+]/g,'');if(raw===''||raw==='-'||raw==='+'){setD(x=>({...x,[sz]:0}));setA(x=>({...x,[sz]:cur}));return}applyDelta(sz,raw)}}/>
          <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>= <strong style={{color:delta!==0?'#1e40af':'#94a3b8'}}>{newVal}</strong></div>
        </div>})}</div>
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{onSave(product.id,a);onClose()}}>Save</button></div></div></div>);
}

// MAIN APP
export default function App(){
  const[pg,setPg]=useState('dashboard');const[toast,setToast]=useState(null);
  const[dashView,setDashView]=useState('admin');// admin|sales|warehouse|decorator|production|csr
  const[qbConfig,setQBConfig]=useState({connected:false,companyId:'',companyName:'',lastSync:null,autoSync:'manual',syncInterval:'daily',
    mapping:{income_account:'Sales',cogs_account:'Cost of Goods Sold',deco_account:'Subcontractor - Decoration',ar_account:'Accounts Receivable',ap_account:'Accounts Payable'},
    syncLog:[],pendingSync:{sos:[],pos:[],invoices:[]}});
  // Persistent state — loads from localStorage, falls back to demo data
  const loadState=(key,fallback)=>{try{const s=localStorage.getItem('nsa_'+key);return s?JSON.parse(s):fallback}catch{return fallback}};
  const[cust,setCust]=useState(()=>loadState('cust',D_C));const[vend]=useState(D_V);const[prod,setProd]=useState(()=>loadState('prod',D_P));
  const[ests,setEsts]=useState(()=>loadState('ests',D_E));const[sos,setSOs]=useState(()=>loadState('sos',D_SO));const[invs,setInvs]=useState(()=>loadState('invs',D_INV));
  // Batch PO system
  const[batchPOs,setBatchPOs]=useState([]);// pending queue
  const[submittedBatches,setSubmittedBatches]=useState([]);// submitted batches for scan lookup
  const[batchCounter,setBatchCounter]=useState(4501);// sequential PO numbers: NSA-4501, NSA-4502...
  const[batchScan,setBatchScan]=useState('');// scan/lookup field
  // Changelog & backup system
  const[changeLog,setChangeLog]=useState([]);// [{ts,user,action,entity,entityId,detail}]
  const[lastBackup,setLastBackup]=useState(null);
  const[autoBackupEnabled,setAutoBackupEnabled]=useState(true);
  const logChange=(action,entity,entityId,detail)=>{setChangeLog(prev=>[{ts:new Date().toLocaleString(),user:cu.name,action,entity,entityId,detail},...prev].slice(0,500))};
  // SO version history
  const[soHistory,setSOHistory]=useState({});// {soId:[{ts,user,snapshot}]}
  const[msgs,setMsgs]=useState(()=>loadState('msgs',D_MSG));const[cM,setCM]=useState({open:false,c:null});const[aM,setAM]=useState({open:false,p:null});
  // Auto-save state to localStorage on change
  React.useEffect(()=>{try{localStorage.setItem('nsa_cust',JSON.stringify(cust))}catch{}},[cust]);
  React.useEffect(()=>{try{localStorage.setItem('nsa_prod',JSON.stringify(prod))}catch{}},[prod]);
  React.useEffect(()=>{try{localStorage.setItem('nsa_ests',JSON.stringify(ests))}catch{}},[ests]);
  React.useEffect(()=>{try{localStorage.setItem('nsa_sos',JSON.stringify(sos))}catch{}},[sos]);
  React.useEffect(()=>{try{localStorage.setItem('nsa_invs',JSON.stringify(invs))}catch{}},[invs]);
  React.useEffect(()=>{try{localStorage.setItem('nsa_msgs',JSON.stringify(msgs))}catch{}},[msgs]);
  const[q,setQ]=useState('');const[selC,setSelC]=useState(null);const[selV,setSelV]=useState(null);
  const[eEst,setEEst]=useState(null);const[eEstC,setEEstC]=useState(null);const[eSO,setESO]=useState(null);const[eSOC,setESOC]=useState(null);const[eSOTab,setESOTab]=useState(null);const[eSOScrollItem,setESOScrollItem]=useState(null);
  const[gQ,setGQ]=useState('');const[gOpen,setGOpen]=useState(false);const[mF,setMF]=useState('all');const[rF,setRF]=useState('all');const[pF,setPF]=useState({cat:'all',vnd:'all',stk:'all',clr:'all'});
  const[qPC,setQPC]=useState({open:false,mode:'single',items:[],bulkRaw:''});
  // OMG Team Stores
  const[omgFilter,setOmgFilter]=useState({rep:'all',status:'all',search:''});const[omgSel,setOmgSel]=useState(null);
  const[soF,setSOF]=useState({status:'all',rep:'all',search:'',sort:'date_desc'});
  const[iS,setIS]=useState({f:'value',d:'desc'});const[iF,setIF]=useState({cat:'all',vnd:'all'});
  const dirtyRef=React.useRef(false);
  const[favSkus,setFavSkus]=useState(()=>{try{return JSON.parse(localStorage.getItem('nsa_fav_skus')||'[]')}catch{return[]}});
  const toggleFav=sku=>{setFavSkus(f=>{const n=f.includes(sku)?f.filter(s=>s!==sku):[...f,sku];try{localStorage.setItem('nsa_fav_skus',JSON.stringify(n))}catch{}return n})};
  const[iShowFav,setIShowFav]=useState(false);
  const[cu,setCu]=useState(()=>{try{const s=localStorage.getItem('nsa_user');return s?JSON.parse(s):null}catch{return null}});
  const handleLogin=(user)=>{setCu(user);try{localStorage.setItem('nsa_user',JSON.stringify(user))}catch{}};
  const handleLogout=()=>{setCu(null);try{localStorage.removeItem('nsa_user')}catch{}};
  const isA=cu?.role==='admin';
  const nf=(m,t='success')=>{setToast({msg:m,type:t});setTimeout(()=>setToast(null),3500)};
  const pars=useMemo(()=>cust.filter(c=>!c.parent_id),[cust]);const gK=useCallback(pid=>cust.filter(c=>c.parent_id===pid),[cust]);
  const cols=useMemo(()=>[...new Set(prod.map(p=>p.color).filter(Boolean))].sort(),[prod]);
  const savC=c=>{setCust(p=>{const e=p.find(x=>x.id===c.id);return e?p.map(x=>x.id===c.id?c:x):[...p,c]});nf('Saved')};
  const savE=e=>{setEsts(p=>{const ex=p.find(x=>x.id===e.id);return ex?p.map(x=>x.id===e.id?e:x):[...p,e]});logChange(ests.find(x=>x.id===e.id)?'updated':'created','Estimate',e.id,e.memo||'')};
  const savSO=s=>{
    // Save version history before overwriting
    const prev=sos.find(x=>x.id===s.id);
    if(prev){setSOHistory(h=>{const existing=h[s.id]||[];return{...h,[s.id]:[{ts:new Date().toLocaleString(),user:cu.name,snapshot:JSON.parse(JSON.stringify(prev))},...existing].slice(0,20)}})}
    setSOs(p=>{const ex=p.find(x=>x.id===s.id);return ex?p.map(x=>x.id===s.id?s:x):[...p,s]});
    logChange(prev?'updated':'created','SO',s.id,s.memo||'');
    // Auto-invoice: when SO reaches ready_to_invoice, create draft invoice if none exists
    const newStatus=calcSOStatus(s);
    const prevStatus=prev?calcSOStatus(prev):null;
    if(newStatus==='ready_to_invoice'&&prevStatus!=='ready_to_invoice'&&prevStatus!=='complete'){
      const hasInv=invs.some(iv=>iv.so_id===s.id);
      if(!hasInv){
        const _aq={};safeItems(s).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});
        const saf=safeArt(s);let total=0;
        safeItems(s).forEach(it=>{const qq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);total+=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qq;const dp2=dP(d,qq,saf,cq);total+=qq*dp2.sell})});
        if(s.shipping_type==='pct')total+=total*(safeNum(s.shipping_value)/100);else total+=safeNum(s.shipping_value);
        const invId=uid('INV-');const today=new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'});
        const dueDate=new Date();dueDate.setDate(dueDate.getDate()+30);const due=dueDate.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'});
        const newInv={id:invId,type:'invoice',customer_id:s.customer_id,so_id:s.id,date:today,due_date:due,total:rQ(total),paid:0,memo:s.memo||'',status:'open',payments:[],cc_fee:0};
        setInvs(prev2=>[newInv,...prev2]);
        nf('Auto-generated invoice '+invId+' for $'+rQ(total).toLocaleString());
      }
    }
  };
  const savI=(pid,inv)=>{setProd(p=>p.map(x=>x.id===pid?{...x,_inv:inv}:x));nf('Updated')};
  const newE=(c,product)=>{const mk=c?.catalog_markup||1.65;const items=[];
    if(product){const au=product.brand==='Adidas'||product.brand==='Under Armour'||product.brand==='New Balance';const sell=au?rQ(product.retail_price*(1-(({A:0.4,B:0.35,C:0.3})[c?.adidas_ua_tier||'B']||0.35))):rQ(product.nsa_cost*mk);
      items.push({product_id:product.id,sku:product.sku,name:product.name,brand:product.brand,color:product.color,nsa_cost:product.nsa_cost,retail_price:product.retail_price,unit_sell:sell,available_sizes:[...product.available_sizes],_colors:product._colors||null,sizes:{},decorations:[]})}
    const e={id:nextEstId(ests),customer_id:c?.id||null,memo:'',status:'draft',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:mk,shipping_type:'pct',shipping_value:5,ship_to_id:'default',email_status:null,art_files:[],items};setEEst(e);setEEstC(c||null);setPg('estimates')};
  const convertSO=est=>{const fourWeeks=new Date();fourWeeks.setDate(fourWeeks.getDate()+28);const defExp=fourWeeks.toISOString().split('T')[0];const so={id:nextSOId(sos),customer_id:est.customer_id,estimate_id:est.id,memo:est.memo,status:'need_order',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:est.default_markup,expected_date:defExp,production_notes:'',shipping_type:est.shipping_type,shipping_value:est.shipping_value,ship_to_id:est.ship_to_id,firm_dates:[],art_files:[...(est.art_files||[])],items:safeItems(est).map(it=>({...it,decorations:safeDecos(it).map(d=>({...d}))}))};
    setSOs(p=>[...p,so]);setEsts(p=>p.map(e=>e.id===est.id?{...e,status:'converted'}:e));setEEst(null);
    const c=cust.find(x=>x.id===so.customer_id);setESO(so);setESOC(c);setPg('orders');nf(`${so.id} created from ${est.id}`)};
  const aO=useMemo(()=>[
    ...ests.map(e=>{const _eAQ={};safeItems(e).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});const eaf=safeArt(e);const t=e.items?.reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+v,0);let r=qq*it.unit_sell;it.decorations?.forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp=dP(d,qq,eaf,cq);r+=qq*dp.sell});return a+r},0)||0;return{id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0],total:t,memo:e.memo,status:e.status}}),
    ...sos.map(s=>{const _sAQ={};safeItems(s).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((ss,v)=>ss+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_sAQ[d.art_file_id]=(_sAQ[d.art_file_id]||0)+q2}})});const saf=safeArt(s);const t=s.items?.reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((ss,v)=>ss+v,0);let r=qq*(it.unit_sell||0);(it.decorations||[]).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_sAQ[d.art_file_id]:qq;const dp=dP(d,qq,saf,cq);r+=qq*dp.sell});return a+r},0)||0;return{id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0],total:t,memo:s.memo,status:s.status}}),
    ...invs.map(i=>({...i,type:'invoice'}))],[ests,sos,invs]);
  const fP=useMemo(()=>{let l=prod;if(q&&pg==='products'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s)||p.brand?.toLowerCase().includes(s)||p.color?.toLowerCase().includes(s))}
    if(pF.cat!=='all')l=l.filter(p=>p.category===pF.cat);if(pF.vnd!=='all')l=l.filter(p=>p.vendor_id===pF.vnd);if(pF.stk==='instock')l=l.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(pF.clr!=='all')l=l.filter(p=>p.color===pF.clr);return l},[prod,q,pF,pg]);
  const iD=useMemo(()=>{let l=prod.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(iF.cat!=='all')l=l.filter(p=>p.category===iF.cat);if(iF.vnd!=='all')l=l.filter(p=>p.vendor_id===iF.vnd);
    if(iShowFav&&favSkus.length>0)l=l.filter(p=>favSkus.includes(p.sku));
    if(q&&pg==='inventory'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s))}
    const m=l.map(p=>{const t=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);return{...p,_tQ:t,_tV:t*(p.nsa_cost||0)}});
    m.sort((a,b)=>{const f=iS.f;let va,vb;if(f==='sku'){va=a.sku;vb=b.sku}else if(f==='name'){va=a.name;vb=b.name}else if(f==='qty'){va=a._tQ;vb=b._tQ}else{va=a._tV;vb=b._tV}
    if(typeof va==='string')return iS.d==='asc'?va.localeCompare(vb):vb.localeCompare(va);return iS.d==='asc'?va-vb:vb-va});return m},[prod,iS,iF,q,pg,iShowFav,favSkus]);
  const tV=useMemo(()=>iD.reduce((a,p)=>a+p._tV,0),[iD]);const tU=useMemo(()=>iD.reduce((a,p)=>a+p._tQ,0),[iD]);
  const al=useMemo(()=>{const r=[];prod.forEach(p=>{if(!p._alerts)return;Object.entries(p._alerts).forEach(([sz,min])=>{const c=p._inv?.[sz]||0;if(c<min)r.push({p,sz,c,min,need:min-c})})});return r},[prod]);

  // DASHBOARD
  const rDash=()=>{
    // Unread messages for this user
    const unreadMsgs=(msgs||[]).filter(m=>!(m.read_by||[]).includes(cu?.id));
    const myUnread=unreadMsgs.sort((a,b)=>(b.ts||'').localeCompare(a.ts)).slice(0,10);
    // Build to-do items from jobs and SOs
    const todos=[];
    sos.forEach(so=>{
      const c=cust.find(x=>x.id===so.customer_id);const tag=c?.alpha_tag||so.id;
      buildJobs(so).forEach(j=>{
        if(j.art_status==='waiting_approval')todos.push({type:'art',priority:2,msg:'⏳ Art awaiting approval: '+j.art_name,detail:tag+' · '+so.id,so,action:'Review art',role:'sales'});
        const ready=isJobReady(j,so);const onBoard=safeJobs(so).some(ej=>ej.id===j.id);
        if(ready&&!onBoard)todos.push({type:'schedule',priority:1,msg:'🏭 Ready for production — send to board: '+j.art_name,detail:tag+' · '+j.id,so,action:'Open Jobs',role:'production'});
        if(j.item_status==='partially_received'&&!j.split_from&&j.fulfilled_units>0)todos.push({type:'split',priority:3,msg:'✂️ Can split: '+j.art_name+' ('+j.fulfilled_units+'/'+j.total_units+')',detail:tag+' · '+j.id,so,action:'Review split',role:'production'});
      });
      safeFirm(so).filter(f=>!f.approved).forEach(f=>{todos.push({type:'firm',priority:2,msg:'📌 Firm date request: '+(f.item_desc||'Full order'),detail:tag+' · '+so.id+' · '+f.date,so,action:'Approve',role:'sales'})});
      if(so.expected_date){const dOut=Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24));
        if(dOut<=3&&dOut>=0&&calcSOStatus(so)!=='complete')todos.push({type:'deadline',priority:0,msg:'⚠️ Due in '+dOut+' day'+(dOut!==1?'s':'')+': '+(so.memo||so.id),detail:tag+' · '+so.expected_date,so,action:'Open SO',role:'all'})};
      if(calcSOStatus(so)==='need_order')todos.push({type:'order',priority:2,msg:'🛒 Items need ordering: '+(so.memo||so.id),detail:tag,so,action:'Create PO',role:'sales'});
    });
    // Stale estimate follow-up alerts
    ests.filter(e=>e.status==='sent').forEach(e=>{
      const c2=cust.find(x=>x.id===e.customer_id);const tag2=c2?.alpha_tag||e.id;
      const sentDate=e.updated_at||e.created_at;if(!sentDate)return;
      const m=sentDate.match(/(\d{2})\/(\d{2})\/(\d{2})/);
      const d=m?new Date('20'+m[3],m[1]-1,m[2]):new Date(sentDate);
      const days=Math.floor((new Date()-d)/(1000*60*60*24));
      if(days>=3&&days<7)todos.push({type:'follow_up',priority:2,msg:'📧 Follow up on estimate ('+days+'d): '+(e.memo||e.id),detail:tag2+' · Sent '+days+' days ago',action:'Follow Up',role:'sales',est:e,estC:c2});
      else if(days>=7&&days<14)todos.push({type:'follow_up',priority:1,msg:'⚠️ Estimate going cold ('+days+'d): '+(e.memo||e.id),detail:tag2+' · No response in '+days+' days',action:'Follow Up',role:'sales',est:e,estC:c2});
      else if(days>=14)todos.push({type:'follow_up',priority:0,msg:'🔴 Stale estimate ('+days+'d): '+(e.memo||e.id),detail:tag2+' · '+days+' days with no response',action:'Close or Re-send',role:'sales',est:e,estC:c2});
    });
    todos.sort((a,b)=>a.priority-b.priority);

    // Shared data builders
    const{pullTasks,shipTasks,decoTasks}=buildWarehouseData();
    const activeJobs=[];sos.forEach(so=>{safeJobs(so).forEach(j=>{if(!['completed','shipped'].includes(j.prod_status))activeJobs.push({...j,so,cName:cust.find(x=>x.id===so.customer_id)?.name})})});

    const ROLE_TABS=[
      {id:'admin',label:'🏢 Admin Overview',icon:'home'},
      {id:'sales',label:'💼 Sales Rep',icon:'dollar'},
      {id:'warehouse',label:'📦 Warehouse',icon:'warehouse'},
      {id:'decorator',label:'🎨 Decorator',icon:'image'},
      {id:'production',label:'🏭 Production Mgr',icon:'grid'},
      {id:'csr',label:'📞 CSR',icon:'mail'},
    ];

    return(<>
    {/* Role Selector */}
    <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap',background:'#f8fafc',padding:6,borderRadius:8,border:'1px solid #e2e8f0'}}>
      {ROLE_TABS.map(r=><button key={r.id} className={`btn btn-sm ${dashView===r.id?'btn-primary':'btn-secondary'}`}
        style={{fontSize:11,padding:'5px 12px',background:dashView===r.id?'#1e293b':'',borderColor:dashView===r.id?'#1e293b':''}}
        onClick={()=>setDashView(r.id)}>{r.label}</button>)}
    </div>

    {/* ═══ ADMIN VIEW ═══ */}
    {dashView==='admin'&&<>
    <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>calcSOStatus(s)!=='complete').length}</div></div><div className="stat-card"><div className="stat-label">Active Jobs</div><div className="stat-value" style={{color:'#7c3aed'}}>{activeJobs.length}</div></div><div className="stat-card"><div className="stat-label">Unread Msgs</div><div className="stat-value" style={{color:unreadMsgs.length>0?'#dc2626':''}}>{unreadMsgs.length}</div></div>
      {isA&&al.length>0&&<div className="stat-card" style={{borderColor:'#fbbf24'}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:'#d97706'}}>{al.length}</div></div>}</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      <div className="card"><div className="card-header"><h2>📋 To-Do ({todos.length})</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {todos.length===0?<div className="empty" style={{padding:20}}>All clear!</div>:
          todos.slice(0,12).map((t,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>{if(t.so){setESO(t.so);setESOC(cust.find(cc=>cc.id===t.so.customer_id));setPg('orders')}}}>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{t.msg}</div><div style={{fontSize:11,color:'#64748b'}}>{t.detail}</div></div>
            <span style={{fontSize:10,padding:'2px 8px',borderRadius:8,background:'#eff6ff',color:'#2563eb',fontWeight:600,whiteSpace:'nowrap'}}>{t.action}</span>
          </div>)}
        </div></div>
      <div className="card"><div className="card-header"><h2>💬 Unread ({unreadMsgs.length})</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {myUnread.length===0?<div className="empty" style={{padding:20}}>No unread messages</div>:
          myUnread.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const so=sos.find(s=>s.id===m.so_id);const c2=cust.find(cc=>cc.id===so?.customer_id);
            return<div key={m.id} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{if(so){setESO(so);setESOC(c2);setPg('orders')}}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:2}}>
                <span style={{fontSize:12,fontWeight:700}}>{author?.name?.split(' ')[0]}</span><span style={{fontSize:10,color:'#1e40af'}}>{so?.id}</span>
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{m.ts}</span></div>
              <div style={{fontSize:12,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.text}</div>
            </div>})}
        </div></div>
    </div>
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-secondary" onClick={()=>{setPg('customers');setCM({open:true,c:null})}}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>setPg('production')}><Icon name="grid" size={14}/> Prod Board</button>
      <button className="btn btn-secondary" onClick={()=>setPg('messages')}><Icon name="mail" size={14}/> Messages</button></div></div>
    </>}

    {/* ═══ SALES REP VIEW ═══ */}
    {dashView==='sales'&&<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">My Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>(e.status==='draft'||e.status==='sent')&&e.created_by===cu.id).length}</div></div>
      <div className="stat-card"><div className="stat-label">My Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>s.created_by===cu.id&&calcSOStatus(s)!=='complete').length}</div></div>
      <div className="stat-card"><div className="stat-label">Pending Approvals</div><div className="stat-value" style={{color:'#7c3aed'}}>{todos.filter(t=>t.type==='art').length}</div></div>
      <div className="stat-card"><div className="stat-label">Due This Week</div><div className="stat-value" style={{color:'#dc2626'}}>{todos.filter(t=>t.type==='deadline').length}</div></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      <div className="card"><div className="card-header"><h2>🎯 My Action Items</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {todos.filter(t=>t.role==='sales'||t.role==='all').length===0?<div className="empty" style={{padding:20}}>Nothing pending!</div>:
          todos.filter(t=>t.role==='sales'||t.role==='all').slice(0,12).map((t,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>{if(t.so){setESO(t.so);setESOC(cust.find(cc=>cc.id===t.so.customer_id));setPg('orders')}}}>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{t.msg}</div><div style={{fontSize:11,color:'#64748b'}}>{t.detail}</div></div>
            <span style={{fontSize:10,padding:'2px 8px',borderRadius:8,background:'#eff6ff',color:'#2563eb',fontWeight:600}}>{t.action}</span>
          </div>)}</div></div>
      <div className="card"><div className="card-header"><h2>📊 My Pipeline</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {sos.filter(s=>s.created_by===cu.id&&calcSOStatus(s)!=='complete').slice(0,10).map(so=>{const c=cust.find(x=>x.id===so.customer_id);const st=calcSOStatus(so);
            return<div key={so.id} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{setESO(so);setESOC(c);setPg('orders')}}>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <span style={{fontWeight:700,fontSize:12}}>{c?.alpha_tag||c?.name} — {so.memo||so.id}</span>
                <span style={{fontSize:9,padding:'2px 6px',borderRadius:8,background:SC[st]?.bg,color:SC[st]?.c,fontWeight:600}}>{st.replace(/_/g,' ')}</span>
              </div></div>})}
        </div></div>
    </div>
    <div className="card"><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newE(null)}>📝 New Estimate</button>
      <button className="btn btn-secondary" onClick={()=>setPg('orders')}>📋 My Orders</button>
      <button className="btn btn-secondary" onClick={()=>setPg('omg')}>🏪 OMG Stores</button>
      <button className="btn btn-secondary" onClick={()=>setPg('invoices')}>💰 Invoices</button>
      <button className="btn btn-secondary" onClick={()=>setPg('commissions')}>💵 My Commissions</button></div></div>
    </>}

    {/* ═══ WAREHOUSE VIEW ═══ */}
    {dashView==='warehouse'&&<>
    <div className="stats-row">
      <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}><div className="stat-label">To Pull</div><div className="stat-value" style={{color:'#d97706'}}>{pullTasks.length}</div><div style={{fontSize:10,color:'#94a3b8'}}>{pullTasks.reduce((a,t)=>a+t.needsPull,0)} units</div></div>
      <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Ship Today</div><div className="stat-value" style={{color:'#166534'}}>{shipTasks.length}</div><div style={{fontSize:10,color:'#94a3b8'}}>{shipTasks.reduce((a,t)=>a+t.units,0)} units</div></div>
      <div className="stat-card" style={{borderLeft:'3px solid #dc2626'}}><div className="stat-label">Rush Orders</div><div className="stat-value" style={{color:'#dc2626'}}>{pullTasks.filter(t=>t.urgent).length}</div></div>
      <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}><div className="stat-label">Active Timers</div><div className="stat-value" style={{color:'#2563eb'}}>{Object.keys(activeTimers).length}</div></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      <div className="card" style={{borderLeft:'3px solid #d97706'}}><div className="card-header"><h2>🏗️ Next to Pull</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('warehouse')}>Full List →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {pullTasks.slice(0,8).map((t,i)=><div key={i} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer',background:t.urgent?'#fef2f2':''}} onClick={()=>{setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              {t.urgent&&<span>🔥</span>}<span style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{t.soId}</span>
              <span style={{fontWeight:600,fontSize:12}}>{t.cName}</span>
              <span style={{marginLeft:'auto',fontWeight:800,color:'#d97706'}}>{t.needsPull}</span>
            </div>
            <div style={{fontSize:10,color:'#64748b'}}>{t.sku} · {t.name}</div>
          </div>)}
        </div></div>
      <div className="card" style={{borderLeft:'3px solid #166534'}}><div className="card-header"><h2>📦 Ready to Ship</h2><button className="btn btn-sm btn-secondary" onClick={()=>{setPg('warehouse');setWhTab('ship')}}>Full List →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {shipTasks.slice(0,8).map((t,i)=><div key={i} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{t.soId}</span>
              <span style={{fontWeight:600,fontSize:12}}>{t.cName}</span>
              <span style={{marginLeft:'auto',fontWeight:700,color:'#166534'}}>{t.units}u</span>
            </div></div>)}
        </div></div>
    </div>
    <div className="card"><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>setPg('warehouse')}>📦 Warehouse</button>
      <button className="btn btn-secondary" onClick={()=>setPg('inventory')}>📊 Inventory</button></div></div>
    </>}

    {/* ═══ DECORATOR VIEW ═══ */}
    {dashView==='decorator'&&<>
    {(()=>{
      const inProcess=activeJobs.filter(j=>j.prod_status==='in_process');
      const inLine=activeJobs.filter(j=>j.prod_status==='staging');
      const myTimers=Object.entries(activeTimers);
      const todayLogs=jobTimeLogs.filter(l=>{try{return new Date(l.clockOut).toDateString()===new Date().toDateString()}catch{return false}});
      const todayMins=todayLogs.reduce((a,l)=>a+l.minutes,0);
      return<>
      <div className="stats-row">
        <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}><div className="stat-label">In Process</div><div className="stat-value" style={{color:'#2563eb'}}>{inProcess.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}><div className="stat-label">In Line (next)</div><div className="stat-value" style={{color:'#d97706'}}>{inLine.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Clocked In</div><div className="stat-value" style={{color:myTimers.length>0?'#166534':'#94a3b8'}}>{myTimers.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}><div className="stat-label">Today's Time</div><div className="stat-value" style={{color:'#7c3aed'}}>{todayMins}m</div><div style={{fontSize:10,color:'#94a3b8'}}>{(todayMins/60).toFixed(1)} hrs</div></div>
      </div>
      {myTimers.length>0&&<div className="card" style={{marginBottom:12,borderLeft:'3px solid #22c55e',background:'#f0fdf4'}}>
        <div style={{padding:'10px 14px'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:6}}>⏱️ Active Now</div>
          {myTimers.map(([key,timer])=>{const[soId,jobId]=key.split('|');const mins=Math.round((Date.now()-timer.clockIn)/60000);
            return<div key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
              <span style={{width:8,height:8,borderRadius:4,background:'#22c55e'}}/> 
              <span style={{fontWeight:700}}>{timer.person}</span>
              <span style={{color:'#64748b',fontSize:11}}>{jobId} ({soId})</span>
              <span style={{marginLeft:'auto',fontWeight:800,color:'#d97706',fontSize:14}}>{mins}m</span>
              <button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#dc2626',color:'white',border:'none'}} onClick={()=>{
                setJobTimeLogs(prev=>[...prev,{jobId,soId,person:timer.person,clockIn:new Date(timer.clockIn).toLocaleString(),clockOut:new Date().toLocaleString(),minutes:mins}]);
                setActiveTimers(prev=>{const n={...prev};delete n[key];return n});
                nf('⏱️ Clocked out — '+mins+'m');
              }}>Clock Out</button>
            </div>})}
        </div></div>}
      <div className="card" style={{marginBottom:12}}><div className="card-header"><h2>🖨️ My Queue — In Process</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('production')}>Prod Board →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:350,overflow:'auto'}}>
          {inProcess.length===0?<div className="empty" style={{padding:20}}>Nothing running right now</div>:
          inProcess.map(j=><div key={j.id+j.so?.id} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{setESOTab('jobs');setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so?.customer_id));setPg('orders')}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontWeight:800,color:'#7c3aed'}}>{j.art_name}</span>
              <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dbeafe',color:'#1e40af',fontWeight:600}}>{j.deco_type?.replace(/_/g,' ')}</span>
              <span style={{fontSize:10,color:'#64748b',marginLeft:'auto'}}>{j.cName} · {j.so?.id}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
              <span style={{fontSize:12,fontWeight:700}}>{j.fulfilled_units}/{j.total_units}</span>
              <div style={{flex:1,background:'#e2e8f0',borderRadius:3,height:4}}><div style={{height:4,borderRadius:3,background:'#3b82f6',width:(j.total_units>0?j.fulfilled_units/j.total_units*100:0)+'%'}}/></div>
              {j.assigned_machine&&<span style={{fontSize:9,color:'#92400e',fontWeight:600}}>🖨️ {MACHINES.find(m=>m.id===j.assigned_machine)?.name}</span>}
            </div>
          </div>)}
        </div></div>
      <div className="card"><div className="card-header"><h2>📋 Up Next — In Line</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:300,overflow:'auto'}}>
          {inLine.length===0?<div className="empty" style={{padding:20}}>Nothing queued</div>:
          inLine.slice(0,8).map(j=><div key={j.id+j.so?.id} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontWeight:700,color:'#475569'}}>{j.art_name}</span>
              <span style={{fontSize:10,color:'#64748b'}}>{j.cName}</span>
              <span style={{marginLeft:'auto',fontWeight:700,fontSize:11}}>{j.total_units}u</span>
            </div></div>)}
        </div></div>
      </>})()}
    </>}

    {/* ═══ PRODUCTION MANAGER VIEW ═══ */}
    {dashView==='production'&&<>
    {(()=>{
      const byStatus={hold:0,staging:0,in_process:0,completed:0,shipped:0};
      activeJobs.forEach(j=>{byStatus[j.prod_status]=(byStatus[j.prod_status]||0)+1});
      const totalActive=activeJobs.length;
      const readyForBoard=todos.filter(t=>t.type==='schedule').length;
      return<>
      <div className="stats-row">
        <div className="stat-card" style={{borderLeft:'3px solid #94a3b8'}}><div className="stat-label">Ready (Hold)</div><div className="stat-value">{byStatus.hold}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #f59e0b'}}><div className="stat-label">In Line</div><div className="stat-value" style={{color:'#d97706'}}>{byStatus.staging}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}><div className="stat-label">In Process</div><div className="stat-value" style={{color:'#2563eb'}}>{byStatus.in_process}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Completed</div><div className="stat-value" style={{color:'#166534'}}>{byStatus.completed}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}><div className="stat-label">Not on Board</div><div className="stat-value" style={{color:'#7c3aed'}}>{readyForBoard}</div></div>
      </div>
      {readyForBoard>0&&<div className="card" style={{marginBottom:12,borderLeft:'3px solid #7c3aed',background:'#faf5ff'}}>
        <div style={{padding:'10px 14px',fontSize:12}}><strong>{readyForBoard} job{readyForBoard!==1?'s':''} ready for the production board</strong> — art approved + items received but not yet scheduled.</div></div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div className="card"><div className="card-header"><h2>🏭 Active Production</h2><button className="btn btn-sm btn-primary" onClick={()=>setPg('production')}>Open Board →</button></div>
          <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
            {activeJobs.filter(j=>j.prod_status==='in_process'||j.prod_status==='staging').map(j=><div key={j.id+j.so?.id} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9'}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:SC[j.prod_status]?.bg,color:SC[j.prod_status]?.c,fontWeight:700}}>{j.prod_status==='in_process'?'RUN':'LINE'}</span>
                <span style={{fontWeight:700,fontSize:12}}>{j.art_name}</span>
                <span style={{fontSize:10,color:'#64748b'}}>{j.cName}</span>
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:11}}>{j.fulfilled_units}/{j.total_units}</span>
              </div></div>)}
          </div></div>
        <div className="card"><div className="card-header"><h2>⏱️ Time Today</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('decoration')}>Deco Page →</button></div>
          <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
            {Object.entries(activeTimers).length>0?Object.entries(activeTimers).map(([key,timer])=>{const[soId,jobId]=key.split('|');
              return<div key={key} style={{padding:'8px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:8,height:8,borderRadius:4,background:'#22c55e'}}/> 
                <span style={{fontWeight:700,fontSize:12}}>{timer.person}</span>
                <span style={{fontSize:11,color:'#64748b'}}>{jobId}</span>
                <span style={{marginLeft:'auto',fontWeight:700,color:'#d97706'}}>{Math.round((Date.now()-timer.clockIn)/60000)}m</span>
              </div>}):<div className="empty" style={{padding:20}}>No one clocked in</div>}
          </div></div>
      </div>
      </>})()}
    </>}

    {/* ═══ CSR VIEW ═══ */}
    {dashView==='csr'&&<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">Unread Msgs</div><div className="stat-value" style={{color:'#dc2626'}}>{unreadMsgs.length}</div></div>
      <div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>calcSOStatus(s)!=='complete').length}</div></div>
      <div className="stat-card"><div className="stat-label">Pending Invoices</div><div className="stat-value" style={{color:'#d97706'}}>{invs.filter(i=>i.status!=='paid').length}</div></div>
      <div className="stat-card"><div className="stat-label">Due This Week</div><div className="stat-value" style={{color:'#dc2626'}}>{todos.filter(t=>t.type==='deadline').length}</div></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      <div className="card"><div className="card-header"><h2>💬 Messages</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('messages')}>All →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {myUnread.length===0?<div className="empty" style={{padding:20}}>All caught up!</div>:
          myUnread.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const so=sos.find(s=>s.id===m.so_id);const c2=cust.find(cc=>cc.id===so?.customer_id);
            return<div key={m.id} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{if(so){setESO(so);setESOC(c2);setPg('orders')}}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{fontWeight:700,fontSize:12}}>{author?.name?.split(' ')[0]}</span><span style={{fontSize:10,color:'#1e40af'}}>{so?.id}</span><span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{m.ts}</span></div>
              <div style={{fontSize:12,color:'#475569'}}>{m.text}</div>
            </div>})}
        </div></div>
      <div className="card"><div className="card-header"><h2>📋 Order Status Lookup</h2></div>
        <div className="card-body">
          <input className="form-input" placeholder="Search by SO#, customer, or memo..." style={{marginBottom:8}}
            onChange={e=>{const q2=e.target.value.toLowerCase();if(!q2)return;
              const match=sos.find(s=>(s.id+' '+(s.memo||'')+' '+(cust.find(c=>c.id===s.customer_id)?.name||'')).toLowerCase().includes(q2));
              if(match){setESO(match);setESOC(cust.find(c=>c.id===match.customer_id));setPg('orders')}}}/>
          <div style={{fontSize:11,color:'#64748b'}}>Type to search and jump to any order — great for when coaches call in asking about their order status.</div>
        </div></div>
    </div>
    <div className="card"><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>setPg('messages')}>💬 Messages</button>
      <button className="btn btn-secondary" onClick={()=>setPg('orders')}>📋 Orders</button>
      <button className="btn btn-secondary" onClick={()=>setPg('invoices')}>💰 Invoices</button>
      <button className="btn btn-secondary" onClick={()=>setPg('customers')}>👥 Customers</button></div></div>
    </>}

    </>)};



  // ESTIMATES LIST
  const rEst=()=>{
    if(eEst)return<OrderEditor order={eEst} mode="estimate" customer={eEstC} allCustomers={cust} products={prod} onSave={e=>{savE(e);setEEst(e)}} onBack={()=>setEEst(null)} onConvertSO={convertSO} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs} dirtyRef={dirtyRef} onAdjustInv={savI} allOrders={sos} onInv={setInvs} batchPOs={batchPOs} onBatchPO={setBatchPOs} onNavCustomer={c2=>{setEEst(null);setSelC(c2);setPg('customers')}} onNewEstimate={()=>{setEEst(null);setTimeout(()=>newE(null),50)}}/>;
    const fe=ests.filter(e=>!q||(e.id+' '+e.memo+' '+(cust.find(c=>c.id===e.customer_id)?.name||'')+' '+(cust.find(c=>c.id===e.customer_id)?.alpha_tag||'')).toLowerCase().includes(q.toLowerCase()));
    return(<><div style={{display:'flex',gap:8,marginBottom:16}}><div className="search-bar" style={{flex:1}}><Icon name="search"/><input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)}/></div>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="plus" size={14}/> New Estimate</button></div>
      <div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{ests.length}</div></div><div className="stat-card"><div className="stat-label">Draft</div><div className="stat-value">{ests.filter(e=>e.status==='draft').length}</div></div><div className="stat-card"><div className="stat-label">Sent</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value" style={{color:'#166534'}}>{ests.filter(e=>e.status==='approved').length}</div></div></div>
      <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Items</th><th>Rep</th><th>Status</th><th>Email</th><th></th></tr></thead><tbody>
      {fe.map(e=>{const c=cust.find(x=>x.id===e.customer_id);const rep=REPS.find(r=>r.id===e.created_by);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c)}}>
        <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?<>{c.name} <span className="badge badge-gray">{c.alpha_tag}</span></>:'--'}</td>
        <td style={{fontSize:12}}>{e.memo}</td><td>{e.items?.length||0}</td>
        <td><span style={{fontSize:11,color:'#64748b'}}>{rep?.name?.split(' ')[0]||'—'}</span></td>
        <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
        <td><EmailBadge e={e}/></td>
        <td onClick={ev=>ev.stopPropagation()}>{e.status==='approved'&&<button className="btn btn-sm btn-primary" style={{background:'#7c3aed'}} onClick={()=>convertSO(e)}>→ SO</button>}</td>
      </tr>)})}</tbody></table></div></div></>);};


  // SALES ORDERS LIST
  const rSO=()=>{
    if(eSO)return<OrderEditor order={eSO} mode="so" customer={eSOC} allCustomers={cust} products={prod} onSave={s=>{savSO(s);setESO(s)}} onBack={()=>{setESO(null);setESOTab(null);setESOScrollItem(null)}} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs} dirtyRef={dirtyRef} onAdjustInv={savI} allOrders={sos} onInv={setInvs} batchPOs={batchPOs} onBatchPO={setBatchPOs} initTab={eSOTab} scrollToItem={eSOScrollItem} onNavCustomer={c2=>{setESO(null);setSelC(c2);setPg('customers')}}/>;
    // Filter SOs
    let fSOs=[...sos];
    if(soF.status!=='all')fSOs=fSOs.filter(s=>calcSOStatus(s)===soF.status);
    if(soF.rep!=='all')fSOs=fSOs.filter(s=>s.created_by===soF.rep);
    if(soF.search){const ss=soF.search.toLowerCase();fSOs=fSOs.filter(s=>{const c2=cust.find(x=>x.id===s.customer_id);return s.id.toLowerCase().includes(ss)||(s.memo||'').toLowerCase().includes(ss)||(c2?.name||'').toLowerCase().includes(ss)||(c2?.alpha_tag||'').toLowerCase().includes(ss)||safeItems(s).some(it=>(it.sku||'').toLowerCase().includes(ss)||(it.name||'').toLowerCase().includes(ss))})}
    // Sort
    if(soF.sort==='date_desc')fSOs.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    else if(soF.sort==='date_asc')fSOs.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
    else if(soF.sort==='expected')fSOs.sort((a,b)=>(a.expected_date||'9999').localeCompare(b.expected_date||'9999'));
    else if(soF.sort==='customer')fSOs.sort((a,b)=>{const ca=cust.find(x=>x.id===a.customer_id)?.name||'';const cb=cust.find(x=>x.id===b.customer_id)?.name||'';return ca.localeCompare(cb)});
    // Status counts using actual so.status
    const stCounts={need_order:sos.filter(s=>calcSOStatus(s)==='need_order').length,waiting_receive:sos.filter(s=>calcSOStatus(s)==='waiting_receive').length,items_received:sos.filter(s=>calcSOStatus(s)==='items_received').length,in_production:sos.filter(s=>calcSOStatus(s)==='in_production').length,ready_to_invoice:sos.filter(s=>calcSOStatus(s)==='ready_to_invoice').length,complete:sos.filter(s=>calcSOStatus(s)==='complete').length};
    const activeFilters=soF.status!=='all'||soF.rep!=='all'||soF.search;

    return(<>
      {/* Clickable status stat cards */}
      <div className="stats-row">
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='all'?'2px solid #2563eb':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:'all'}))}>
          <div className="stat-label">Total</div><div className="stat-value">{sos.length}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='need_order'?'2px solid #d97706':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='need_order'?'all':'need_order'}))}>
          <div className="stat-label">Need Order</div><div className="stat-value" style={{color:'#d97706'}}>{stCounts.need_order}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='waiting_receive'?'2px solid #2563eb':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='waiting_receive'?'all':'waiting_receive'}))}>
          <div className="stat-label">Waiting</div><div className="stat-value" style={{color:'#2563eb'}}>{stCounts.waiting_receive}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='items_received'?'2px solid #065f46':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='items_received'?'all':'items_received'}))}>
          <div className="stat-label">Items In</div><div className="stat-value" style={{color:'#065f46'}}>{stCounts.items_received}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='in_production'?'2px solid #7c3aed':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='in_production'?'all':'in_production'}))}>
          <div className="stat-label">In Production</div><div className="stat-value" style={{color:'#7c3aed'}}>{stCounts.in_production}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='ready_to_invoice'?'2px solid #c2410c':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='ready_to_invoice'?'all':'ready_to_invoice'}))}>
          <div className="stat-label">Ready to Invoice</div><div className="stat-value" style={{color:'#c2410c'}}>{stCounts.ready_to_invoice}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:soF.status==='complete'?'2px solid #166534':'none',borderRadius:8}} onClick={()=>setSOF(f=>({...f,status:f.status==='complete'?'all':'complete'}))}>
          <div className="stat-label">Complete</div><div className="stat-value" style={{color:'#166534'}}>{stCounts.complete}</div></div>
      </div>

      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search SOs, customers, SKUs..." value={soF.search} onChange={e=>setSOF(f=>({...f,search:e.target.value}))}/></div>
        <select className="form-select" style={{width:140}} value={soF.rep} onChange={e=>setSOF(f=>({...f,rep:e.target.value}))}>
          <option value="all">All Reps</option>{REPS.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="form-select" style={{width:150}} value={soF.sort} onChange={e=>setSOF(f=>({...f,sort:e.target.value}))}>
          <option value="date_desc">Newest First</option><option value="date_asc">Oldest First</option><option value="expected">By Expected Date</option><option value="customer">By Customer</option></select>
        {activeFilters&&<button className="btn btn-sm btn-secondary" onClick={()=>setSOF({status:'all',rep:'all',search:'',sort:'date_desc'})}>\u2715 Clear</button>}
        <span style={{fontSize:11,color:'#64748b'}}>{fSOs.length}{fSOs.length!==sos.length?' of '+sos.length:''} orders</span>
      </div>

    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Rep</th><th>Art</th><th>Items</th><th>Msgs</th><th>Status</th></tr></thead><tbody>
    {fSOs.map(so=>{const c=cust.find(x=>x.id===so.customer_id);const ac=(so.art_files||[]).length;const aa=(so.art_files||[]).filter(f=>f.status==='approved').length;const rep=REPS.find(r=>r.id===so.created_by);
      // Item fulfillment progress (for Items column)
      const allItems=so.items||[];let totalSz=0,pickedSz=0,poSz=0,rcvdSz=0;
      allItems.forEach(it=>{Object.entries(it.sizes).filter(([,v])=>v>0).forEach(([sz,v])=>{totalSz+=v;
        pickedSz+=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);
        const poQty=safePOs(it).reduce((a,pk)=>a+(pk[sz]||0),0);poSz+=poQty;
        rcvdSz+=safePOs(it).reduce((a,pk)=>a+((pk.received||{})[sz]||0),0)})});
      const fulfilledSz=pickedSz+rcvdSz;
      const itemStatus=totalSz===0?null:fulfilledSz>=totalSz?'received':fulfilledSz>0?'partial':poSz>0?'on_order':'needs_items';
      // Status badge uses the actual SO status field (what the user set)
      const displayStatus=calcSOStatus(so);
      const statusLabel={need_order:'Need to Order',waiting_receive:'Waiting to Receive',items_received:'Items Received',in_production:'In Production',ready_to_invoice:'Ready to Invoice',complete:'Complete'}[displayStatus]||displayStatus.replace(/_/g,' ');
      return(<tr key={so.id} style={{cursor:'pointer'}} onClick={()=>{setESO(so);setESOC(c)}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td><td>{c?.name} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{so.memo}</td><td>{so.expected_date||'--'}</td>
      <td><span style={{fontSize:11,color:'#64748b'}}>{rep?.name?.split(' ')[0]||'\u2014'}</span></td>
      <td>{ac>0?<span style={{fontSize:11}}>{aa}/{ac} \u2713</span>:<span style={{fontSize:11,color:'#d97706'}}>\u2014</span>}</td>
      <td>{itemStatus&&<span style={{fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:4,
        background:itemStatus==='received'?'#dcfce7':itemStatus==='partial'?'#fef3c7':itemStatus==='on_order'?'#dbeafe':'#fef2f2',
        color:itemStatus==='received'?'#166534':itemStatus==='partial'?'#92400e':itemStatus==='on_order'?'#1e40af':'#dc2626'}}>
        {itemStatus==='received'?'\u2713 All In':itemStatus==='partial'?fulfilledSz+'/'+totalSz:itemStatus==='on_order'?'On Order':'Needs Items'}</span>}</td>
      <td>{(()=>{const unread=msgs.filter(m=>m.so_id===so.id&&!(m.read_by||[]).includes(cu.id)).length;const total=msgs.filter(m=>m.so_id===so.id).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{unread} new</span>:total>0?<span style={{fontSize:11,color:'#94a3b8'}}>{total}</span>:null})()}</td>
      <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,background:SC[displayStatus]?.bg||'#f1f5f9',color:SC[displayStatus]?.c||'#475569'}}>{statusLabel}</span></td></tr>)})}
    </tbody></table></div></div></>);
  };
  // CUSTOMERS
  const rCust=()=>{
    if(selC)return<CustDetail customer={selC} allCustomers={cust} allOrders={aO} onBack={()=>setSelC(null)} onEdit={c=>{setCM({open:true,c});setCust(prev=>prev.map(pp=>pp.id===c.id?c:pp))}} onSelCust={c=>setSelC(c)} onNewEst={c=>newE(c)} sos={sos} msgs={msgs} cu={cu} onOpenSO={so=>{const c3=cust.find(cc=>cc.id===so.customer_id);setESO(so);setESOC(c3);setPg('orders')}} ests={ests} onSaveSO={savSO}/>;
    const f=pars.filter(p=>{if(rF!=='all'&&p.primary_rep_id!==rF)return false;if(q){const s=q.toLowerCase();return p.name.toLowerCase().includes(s)||p.alpha_tag?.toLowerCase().includes(s)||gK(p.id).some(c=>c.name.toLowerCase().includes(s))}return true});
    return(<><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}><div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)}/></div>
      <select className="form-select" style={{width:150}} value={rF} onChange={e=>setRF(e.target.value)}><option value="all">All Reps</option>{REPS.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button className="btn btn-primary" onClick={()=>setCM({open:true,c:null})}><Icon name="plus" size={14}/> New</button></div>
    {f.map(p=>{const kids=gK(p.id);const bal=kids.reduce((a,c)=>a+(c._ob||0),p._ob||0);
      return(<div key={p.id} className="card" style={{marginBottom:10}}>
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:36,height:36,borderRadius:8,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}} onClick={()=>setSelC(p)}><Icon name="building" size={18}/></div>
          <div style={{flex:1,cursor:'pointer'}} onClick={()=>setSelC(p)}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:15,fontWeight:700}}>{p.name}</span><span className="badge badge-blue">{p.alpha_tag}</span><span className="badge badge-green">Tier {p.adidas_ua_tier}</span></div>
            <div style={{fontSize:12,color:'#94a3b8'}}>{(p.contacts||[])[0]?.name&&`${p.contacts[0].name} · `}{p.billing_city&&`${p.billing_city}, ${p.billing_state}`}</div></div>
          {bal>0&&<div style={{textAlign:'right'}}><div style={{fontSize:16,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div></div>}
          <button className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();newE(p)}}><Icon name="file" size={12}/></button>
          <button className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();setCM({open:true,c:p})}}><Icon name="edit" size={12}/></button></div>
        {kids.length>0&&<div style={{borderTop:'1px solid #f1f5f9'}}>{kids.map(ch=><div key={ch.id} style={{padding:'8px 16px 8px 64px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid #f8fafc',cursor:'pointer'}} onClick={()=>setSelC(ch)}>
          <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontSize:13,fontWeight:600}}>{ch.name}</span><span className="badge badge-gray">{ch.alpha_tag}</span><div style={{flex:1}}/>
          {(ch._ob||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${ch._ob.toLocaleString()}</span>}</div>)}</div>}
      </div>)})}
    </>);};

  // VENDORS
  const rVend=()=>{if(selV)return<VendDetail vendor={selV} onBack={()=>setSelV(null)}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Vendors</div><div className="stat-value">{vend.length}</div></div><div className="stat-card"><div className="stat-label">API</div><div className="stat-value">{vend.filter(v=>v.vendor_type==='api').length}</div></div>
      {isA&&<div className="stat-card"><div className="stat-label">Open AP</div><div className="stat-value" style={{color:'#dc2626'}}>${vend.reduce((a,v)=>a+(v._it||0),0).toLocaleString()}</div></div>}</div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>Terms</th>{isA&&<th>Owed</th>}<th>Status</th></tr></thead><tbody>
    {vend.map(v=><tr key={v.id} style={{cursor:'pointer'}} onClick={()=>setSelV(v)}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{v.name}</td><td><span className={`badge ${v.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{v.vendor_type==='api'?'API':'Upload'}</span></td>
      <td style={{fontSize:11}}>{v.contact_email}</td><td><span className="badge badge-gray">{v.payment_terms?.replace('net','Net ')}</span></td>
      {isA&&<td style={{fontWeight:700,color:(v._it||0)>0?'#dc2626':''}}>{(v._it||0)>0?'$'+v._it.toLocaleString():'--'}</td>}
      <td><span className="badge badge-green">Active</span></td></tr>)}</tbody></table></div></div></>);};

  // PRODUCTS
  const rProd=()=>(<><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
    <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={pF.stk==='instock'} onChange={e=>setPF(f=>({...f,stk:e.target.checked?'instock':'all'}))}/> In Stock</label>
    <select className="form-select" style={{width:110}} value={pF.cat} onChange={e=>setPF(f=>({...f,cat:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
    <select className="form-select" style={{width:110}} value={pF.vnd} onChange={e=>setPF(f=>({...f,vnd:e.target.value}))}><option value="all">Vendor</option>{vend.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
    <select className="form-select" style={{width:130}} value={pF.clr} onChange={e=>setPF(f=>({...f,clr:e.target.value}))}><option value="all">Color</option>{cols.map(c=><option key={c}>{c}</option>)}</select></div>
  <div className="card"><div className="card-body" style={{padding:0}}>
  {fP.map(p=>{const nt=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);const au=p.brand==='Adidas'||p.brand==='Under Armour';
    return(<div key={p.id} style={{padding:'14px 16px',borderBottom:'1px solid #f1f5f9'}}><div style={{display:'flex',gap:14,alignItems:'flex-start'}}>
      <div style={{width:48,height:48,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>👕</div>
      <div style={{flex:1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontFamily:'monospace',fontWeight:800,background:'#dbeafe',padding:'2px 8px',borderRadius:3,color:'#1e40af'}}>{p.sku}</span><span style={{fontWeight:700}}>{p.name}</span>{p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} clr</span>}</div>
        <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}><span className="badge badge-blue" style={{marginRight:4}}>{p.brand}</span>{p.color} | ${p.nsa_cost?.toFixed(2)} | {au?'Tier':'$'+rQ(p.nsa_cost*1.65).toFixed(2)}</div>
        <div style={{display:'flex',gap:2,marginTop:6,flexWrap:'wrap'}}>
          {p.available_sizes.filter(sz=>showSz(sz,p._inv?.[sz])).map(sz=>{const v=p._inv?.[sz]||0;return<div key={sz} className={`size-cell ${v>10?'in-stock':v>0?'low-stock':'no-stock'}`}><div className="size-label">{sz}</div><div className="size-qty">{v}</div></div>})}
          <div className="size-cell total"><div className="size-label">TOT</div><div className="size-qty">{nt}</div></div></div></div></div></div>)})}
  {fP.length===0&&<div className="empty">No products</div>}</div></div></>);

  // INVENTORY
  const rInv=()=>(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Units</div><div className="stat-value">{tU}</div></div><div className="stat-card"><div className="stat-label">Value</div><div className="stat-value">${tV.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div><div className="stat-card"><div className="stat-label">Products</div><div className="stat-value">{iD.length}</div></div>
    {isA&&al.length>0&&<div className="stat-card" style={{borderColor:'#fbbf24'}}><div className="stat-label">Alerts</div><div className="stat-value" style={{color:'#d97706'}}>{al.length}</div></div>}</div>
  <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}><div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <button className={`btn btn-sm ${iShowFav?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setIShowFav(f=>!f)}>⭐ Favorites{favSkus.length>0?` (${favSkus.length})`:''}</button>
    <select className="form-select" style={{width:110}} value={iF.cat} onChange={e=>setIF(f=>({...f,cat:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
    <select className="form-select" style={{width:110}} value={iF.vnd} onChange={e=>setIF(f=>({...f,vnd:e.target.value}))}><option value="all">Vendor</option>{vend.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
  <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr>
    <SortHeader label="SKU" field="sku" sortField={iS.f} sortDir={iS.d} onSort={f=>setIS(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}))}/>
    <SortHeader label="Product" field="name" sortField={iS.f} sortDir={iS.d} onSort={f=>setIS(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}))}/>
    <th>Sizes</th>
    <SortHeader label="Qty" field="qty" sortField={iS.f} sortDir={iS.d} onSort={f=>setIS(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}))}/>
    <SortHeader label="Value" field="value" sortField={iS.f} sortDir={iS.d} onSort={f=>setIS(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}))}/>
    <th>Actions</th></tr></thead>
  <tbody>{iD.map(p=><tr key={p.id}>
    <td><div style={{display:'flex',alignItems:'center',gap:4}}><button style={{background:'none',border:'none',cursor:'pointer',fontSize:14,padding:0,color:favSkus.includes(p.sku)?'#f59e0b':'#d1d5db'}} onClick={()=>toggleFav(p.sku)}>{favSkus.includes(p.sku)?'★':'☆'}</button><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span></div></td>
    <td style={{fontSize:12}}>{p.name}<br/><span style={{color:'#94a3b8'}}>{p.color}</span></td>
    <td><div style={{display:'flex',gap:2}}>{p.available_sizes.filter(sz=>showSz(sz,p._inv?.[sz])).map(sz=>{const v=p._inv?.[sz]||0;return<div key={sz} className={`size-cell ${v>10?'in-stock':v>0?'low-stock':'no-stock'}`} style={{minWidth:30,padding:'1px 3px'}}><div className="size-label" style={{fontSize:8}}>{sz}</div><div className="size-qty" style={{fontSize:11}}>{v}</div></div>})}</div></td>
    <td style={{fontWeight:800,fontSize:15,color:p._tQ<=10?'#d97706':'#166534'}}>{p._tQ}</td>
    <td style={{fontWeight:700}}>${p._tV.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    <td><div style={{display:'flex',gap:4}}><button className="btn btn-sm btn-secondary" onClick={()=>newE(null,p)}>+EST</button>
      {isA&&<button className="btn btn-sm btn-secondary" onClick={()=>setAM({open:true,p})}>INV</button>}</div></td>
  </tr>)}</tbody></table></div></div></>);

  // JOBS LIST
  const[jobFilters,setJobFilters]=useState({statuses:['hold','staging','in_process'],rep:'all',deco:'all',artSt:'all',dueBefore:'',search:''});
  const[jobSortField,setJobSortField]=useState('expected');const[jobSortDir,setJobSortDir]=useState('asc');
  const[savedJobFilters,setSavedJobFilters]=useState([
    {name:'Ready to Print',filters:{statuses:['staging'],rep:'all',deco:'screen_print',artSt:'art_complete',dueBefore:'',search:''}},
    {name:'Needs Art',filters:{statuses:['hold','staging','in_process'],rep:'all',deco:'all',artSt:'needs_art',dueBefore:'',search:''}},
    {name:'All Active',filters:{statuses:['hold','staging','in_process'],rep:'all',deco:'all',artSt:'all',dueBefore:'',search:''}},
  ]);

  const rJobs=()=>{
    // Build flat jobs list
    const allJobs=[];
    sos.forEach(so=>{const c=cust.find(x=>x.id===so.customer_id);
      buildJobs(so).forEach(j=>{allJobs.push({...j,so,soId:so.id,soMemo:so.memo,customer:c?.name||'Unknown',alpha:c?.alpha_tag||'',
        repId:so.created_by,rep:REPS.find(r=>r.id===so.created_by)?.name||'—',
        expected:so.expected_date,daysOut:so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null})})});
    // Apply filters
    let fj=allJobs;
    const jf=jobFilters;
    if(jf.statuses.length>0)fj=fj.filter(j=>jf.statuses.includes(j.prod_status));
    if(jf.rep!=='all')fj=fj.filter(j=>j.repId===jf.rep);
    if(jf.deco!=='all')fj=fj.filter(j=>j.deco_type===jf.deco);
    if(jf.artSt!=='all')fj=fj.filter(j=>j.art_status===jf.artSt);
    if(jf.dueBefore)fj=fj.filter(j=>j.expected&&j.expected<=jf.dueBefore);
    if(jf.search){const s=jf.search.toLowerCase();fj=fj.filter(j=>(j.art_name||'').toLowerCase().includes(s)||(j.soId||'').toLowerCase().includes(s)||(j.customer||'').toLowerCase().includes(s)||(j.id||'').toLowerCase().includes(s)||(j.items||[]).some(gi=>(gi.sku||'').toLowerCase().includes(s)||(gi.name||'').toLowerCase().includes(s)))}
    // Sort
    fj.sort((a,b)=>{let va,vb;
      if(jobSortField==='expected'){va=a.expected||'9999';vb=b.expected||'9999'}
      else if(jobSortField==='units'){va=a.total_units;vb=b.total_units}
      else if(jobSortField==='customer'){va=a.customer;vb=b.customer}
      else if(jobSortField==='art'){va=a.art_name;vb=b.art_name}
      else{va=a.id;vb=b.id}
      return jobSortDir==='asc'?(va>vb?1:-1):(va<vb?1:-1)});
    const decoTypes=[...new Set(allJobs.map(j=>j.deco_type).filter(Boolean))];
    const STATUSES=[['hold','Ready for Prod'],['staging','In Line'],['in_process','In Process'],['completed','Completed'],['shipped','Shipped']];
    const toggleStatus=st=>{setJobFilters(prev=>{const ss=prev.statuses.includes(st)?prev.statuses.filter(s=>s!==st):[...prev.statuses,st];return{...prev,statuses:ss}})};
    const setJF=(k,v)=>setJobFilters(prev=>({...prev,[k]:v}));
    const toggleSort=f=>{if(jobSortField===f)setJobSortDir(d=>d==='asc'?'desc':'asc');else{setJobSortField(f);setJobSortDir('asc')}};
    const sortIcon=f=>jobSortField===f?(jobSortDir==='asc'?'↑':'↓'):'';
    // Promote a job to the prod board (saves it to so.jobs[])
    const promoteJob=(j)=>{
      const jso=sos.find(s=>s.id===j.soId);if(!jso)return;
      const existing=safeJobs(jso);
      if(existing.find(ej=>ej.id===j.id)){nf('Already on prod board','warn');return;}
      const cleanJob={id:j.id,key:j.key,art_file_id:j.art_file_id,art_name:j.art_name,deco_type:j.deco_type,
        positions:j.positions,art_status:j.art_status,item_status:j.item_status,prod_status:'hold',
        total_units:j.total_units,fulfilled_units:j.fulfilled_units,split_from:null,
        created_at:j.created_at,items:j.items,_auto:false};
      savSO({...jso,jobs:[...existing,cleanJob]});
      nf('🏭 '+j.id+' added to Production Board');
    };

    return(<>
      {/* Filter bar */}
      <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:'12px 16px'}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
          <div className="search-bar" style={{flex:1,minWidth:200,maxWidth:300}}><Icon name="search"/><input placeholder="Search jobs, SKUs, customers..." value={jf.search} onChange={e=>setJF('search',e.target.value)}/></div>
          <select className="form-select" style={{width:130,fontSize:11}} value={jf.rep} onChange={e=>setJF('rep',e.target.value)}>
            <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <select className="form-select" style={{width:140,fontSize:11}} value={jf.deco} onChange={e=>setJF('deco',e.target.value)}>
            <option value="all">All Deco Types</option>{decoTypes.map(d=><option key={d} value={d}>{d.replace(/_/g,' ')}</option>)}</select>
          <select className="form-select" style={{width:130,fontSize:11}} value={jf.artSt} onChange={e=>setJF('artSt',e.target.value)}>
            <option value="all">All Art Status</option><option value="needs_art">Needs Art</option><option value="waiting_approval">Awaiting Approval</option><option value="art_complete">Art Complete</option></select>
          <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#64748b'}}><span>Due by:</span><input type="date" className="form-input" style={{width:130,padding:'3px 6px',fontSize:11}} value={jf.dueBefore} onChange={e=>setJF('dueBefore',e.target.value)}/></div>
          {(jf.search||jf.rep!=='all'||jf.deco!=='all'||jf.artSt!=='all'||jf.dueBefore)&&<button className="btn btn-sm btn-secondary" onClick={()=>setJobFilters({statuses:jf.statuses,rep:'all',deco:'all',artSt:'all',dueBefore:'',search:''})}>Clear</button>}
        </div>
        {/* Status toggle chips */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:10,fontWeight:700,color:'#64748b',marginRight:4}}>STATUS:</span>
          {STATUSES.map(([id,label])=>{const active=jf.statuses.includes(id);const ct=allJobs.filter(j=>j.prod_status===id).length;
            return<button key={id} style={{fontSize:10,padding:'3px 10px',borderRadius:12,border:'1px solid '+(active?SC[id]?.c||'#2563eb':'#e2e8f0'),
              background:active?(SC[id]?.bg||'#eff6ff'):'white',color:active?(SC[id]?.c||'#2563eb'):'#94a3b8',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:4}}
              onClick={()=>toggleStatus(id)}>{label} <span style={{fontSize:9,opacity:0.7}}>({ct})</span></button>})}
          <span style={{fontSize:10,color:'#cbd5e1',margin:'0 6px'}}>|</span>
          <span style={{fontSize:10,fontWeight:700,color:'#64748b',marginRight:4}}>SAVED:</span>
          {savedJobFilters.map((sf,i)=><button key={i} style={{fontSize:10,padding:'2px 8px',borderRadius:10,border:'1px solid #ddd6fe',background:'#f5f3ff',color:'#7c3aed',cursor:'pointer',fontWeight:600}}
            onClick={()=>setJobFilters(sf.filters)}>{sf.name}</button>)}
          <button style={{fontSize:10,padding:'2px 8px',borderRadius:10,border:'1px solid #e2e8f0',background:'white',color:'#94a3b8',cursor:'pointer'}}
            onClick={()=>{const name=prompt('Save current filter as:');if(name)setSavedJobFilters(prev=>[...prev,{name,filters:{...jf}}])}}>+ Save Filter</button>
        </div>
      </div></div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Showing</div><div className="stat-value">{fj.length}<span style={{fontSize:12,fontWeight:400,color:'#94a3b8'}}>/{allJobs.length}</span></div></div>
        <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{fj.reduce((a,j)=>a+j.total_units,0)}</div></div>
        <div className="stat-card"><div className="stat-label">Fulfilled</div><div className="stat-value" style={{color:'#166534'}}>{fj.reduce((a,j)=>a+j.fulfilled_units,0)}</div></div>
        <div className="stat-card"><div className="stat-label">Needs Art</div><div className="stat-value" style={{color:fj.filter(j=>j.art_status!=='art_complete').length>0?'#d97706':''}}>{fj.filter(j=>j.art_status!=='art_complete').length}</div></div>
      </div>

      {/* Jobs table */}
      <div className="card"><div className="card-body" style={{padding:0}}>
        {fj.length===0?<div className="empty" style={{padding:30}}>No jobs match filters</div>:
        <table><thead><tr>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('id')}>Job {sortIcon('id')}</th>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('art')}>Artwork {sortIcon('art')}</th>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('customer')}>Customer {sortIcon('customer')}</th>
          <th>SO</th><th>Rep</th>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('units')}>Units {sortIcon('units')}</th>
          <th>Art</th><th>Items</th><th>Ready?</th><th>Board</th>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('expected')}>Due {sortIcon('expected')}</th>
        </tr></thead><tbody>
        {fj.map(j=>{const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
          const ready=isJobReady(j,j.so);
          const onBoard=safeJobs(j.so).some(ej=>ej.id===j.id);
          return<tr key={j.id+j.soId} style={{cursor:'pointer',background:j.daysOut!=null&&j.daysOut<=3?'#fef2f2':ready&&!onBoard?'#f0fdf4':undefined}} onClick={()=>{setESOTab('jobs');setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>
            <td style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{j.id}</td>
            <td><div style={{fontWeight:600,fontSize:12}}>{j.art_name}</div><div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions}</div></td>
            <td style={{fontSize:12}}>{j.customer} <span className="badge badge-gray">{j.alpha}</span></td>
            <td style={{fontSize:11,color:'#64748b'}}>{j.soId}</td>
            <td style={{fontSize:11}}>{j.rep?.split(' ')[0]}</td>
            <td><span style={{fontWeight:700}}>{j.fulfilled_units}/{j.total_units}</span>
              <div style={{width:40,background:'#e2e8f0',borderRadius:3,height:4,marginTop:2}}><div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div></td>
            <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{j.art_status==='art_complete'?'Done':j.art_status==='waiting_approval'?'Waiting':'Need'}</span></td>
            <td style={{fontSize:11}}>{(j.items||[]).length} <span style={{color:'#94a3b8'}}>garment{(j.items||[]).length!==1?'s':''}</span></td>
            <td>{ready?<span style={{fontSize:10,fontWeight:700,color:'#166534'}}>✅ Ready</span>
              :<span style={{fontSize:9,color:'#94a3b8'}}>{j.art_status!=='art_complete'?'🎨 Art':
                (() => {const af2=safeArr(j.so?.art_files).find(f=>f.id===j.art_file_id);return af2&&(af2.prod_files||[]).length===0?'🔧 Files':'📦 Items'})()
              }</span>}</td>
            <td onClick={e=>e.stopPropagation()}>{onBoard?<span style={{fontSize:9,fontWeight:700,color:'#2563eb'}}>On Board</span>
              :<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:ready?'#166534':'#64748b',color:'white',border:'none'}}
                onClick={()=>promoteJob(j)}>→ Board</button>}</td>
            <td style={{fontSize:11,color:j.daysOut!=null&&j.daysOut<=7?'#dc2626':'#64748b',fontWeight:j.daysOut!=null&&j.daysOut<=3?700:400}}>{j.expected||'—'}{j.daysOut!=null&&j.daysOut<=3?' ⚠️':''}</td>
          </tr>})}
        </tbody></table>}
      </div></div>
    </>);
  };

  // PRODUCTION BOARD
  const[prodView,setProdView]=useState('board');const[prodFilter,setProdFilter]=useState('all');const[expandedJob,setExpandedJob]=useState(null);
  const[prodSort,setProdSort]=useState({f:'expected',d:'asc'});const[prodStatF,setProdStatF]=useState('active');const[prodDecoF,setProdDecoF]=useState('all');
  const[assignModal,setAssignModal]=useState(null);// {job, soId, targetStatus}
  const[jobTimeLogs,setJobTimeLogs]=useState([]);// [{jobId,soId,person,clockIn,clockOut,minutes}]
  const[activeTimers,setActiveTimers]=useState({});// {jobId:{person,clockIn,soId}}
  const[assignTo,setAssignTo]=useState({machine:'',person:'',shipMethod:''});
  const moveJobStatus=(j,newStatus)=>{
    // If moving to staging (In Line), prompt for assignment
    if(newStatus==='staging'&&j.prod_status!=='staging'){
      setAssignModal({job:j,soId:j.soId,targetStatus:newStatus});
      setAssignTo({machine:j.assigned_machine||'',person:j.assigned_to||'',shipMethod:j.ship_method||''});
      return;
    }
    applyJobMove(j,newStatus,j.assigned_machine||'',j.assigned_to||'',j.ship_method||'');
  };
  const applyJobMove=(j,newStatus,machine,person,shipMethod)=>{
    const so=sos.find(s=>s.id===j.soId);
    if(!so)return;
    const updatedJobs=safeJobs(so).map(jj=>jj.id===j.id?{...jj,prod_status:newStatus,assigned_machine:machine||jj.assigned_machine,assigned_to:person||jj.assigned_to,ship_method:shipMethod||jj.ship_method}:jj);
    savSO({...so,jobs:updatedJobs});
    // Auto-clock-out if job moves to completed/shipped
    if(newStatus==='completed'||newStatus==='shipped'){
      const timerKey=j.soId+'|'+j.id;
      const active=activeTimers[timerKey];
      if(active){
        const mins=Math.round((Date.now()-active.clockIn)/60000);
        setJobTimeLogs(prev=>[...prev,{jobId:j.id,soId:j.soId,person:active.person,clockIn:new Date(active.clockIn).toLocaleString(),clockOut:new Date().toLocaleString(),minutes:mins}]);
        setActiveTimers(prev=>{const n={...prev};delete n[timerKey];return n});
      }
    }
    const labels={hold:'Ready for Prod',staging:'In Line',in_process:'In Process',completed:'Completed',shipped:'Shipped'};
    nf('🏭 '+j.id+' → '+labels[newStatus]+(machine?' · '+MACHINES.find(m=>m.id===machine)?.name:'')+(person?' · '+person:''));
  };
  const[showColPicker,setShowColPicker]=useState(false);
  const ALL_PROD_COLS=[
    {id:'so',label:'SO',default:true},
    {id:'customer',label:'Customer',default:true},
    {id:'memo',label:'Memo',default:true},
    {id:'rep',label:'Rep',default:true},
    {id:'units',label:'Units',default:true},
    {id:'fulfilled',label:'Fulfilled',default:true},
    {id:'art',label:'Art',default:true},
    {id:'expected',label:'Expected',default:true},
    {id:'rev',label:'Revenue',default:true},
    {id:'status',label:'Status',default:true},
    {id:'msgs',label:'Messages',default:true},
    {id:'flags',label:'Flags',default:true},
    {id:'items',label:'# Items',default:false},
    {id:'created',label:'Created',default:false},
    {id:'notes',label:'Prod Notes',default:false},
  ];
  const defaultCols=ALL_PROD_COLS.filter(c=>c.default).map(c=>c.id);
  const[prodCols,setProdCols]=useState(()=>{try{const s=localStorage.getItem('nsa_prod_cols');return s?JSON.parse(s):defaultCols}catch{return defaultCols}});
  const toggleCol=id=>{setProdCols(prev=>{const n=prev.includes(id)?prev.filter(c=>c!==id):[...prev,id];try{localStorage.setItem('nsa_prod_cols',JSON.stringify(n))}catch{}return n})};
  const resetCols=()=>{setProdCols(defaultCols);try{localStorage.setItem('nsa_prod_cols',JSON.stringify(defaultCols))}catch{}};
  const[roleView,setRoleView]=useState(()=>{try{return localStorage.getItem('nsa_role_view')||'sales'}catch{return'sales'}});
  const changeRoleView=v=>{setRoleView(v);try{localStorage.setItem('nsa_role_view',v)}catch{}};
  const rProd2=()=>{
    // Build flat list of SAVED jobs only (must be explicitly on SO.jobs[])
    const allJobs=[];
    sos.forEach(so=>{
      const c=cust.find(x=>x.id===so.customer_id);
      safeJobs(so).forEach(j=>{
        allJobs.push({...j,so,soId:so.id,soMemo:so.memo,customer:c?.name||'Unknown',alpha:c?.alpha_tag||'',
          rep:REPS.find(r=>r.id===so.created_by)?.name?.split(' ')[0]||'—',
          expected:so.expected_date,daysOut:so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null,
        });
      });
    });
    const filtered=prodFilter==='all'?allJobs:allJobs.filter(j=>j.so.created_by===prodFilter);
    const byDeco=prodDecoF==='all'?filtered:filtered.filter(j=>j.deco_type===prodDecoF);
    const byStatus=prodStatF==='active'?byDeco.filter(j=>j.prod_status!=='completed'&&j.prod_status!=='shipped'):prodStatF==='all'?byDeco:byDeco.filter(j=>j.prod_status===prodStatF);
    const totalUnits=byStatus.reduce((a,j)=>a+j.total_units,0);
    const fulfilledUnits=byStatus.reduce((a,j)=>a+j.fulfilled_units,0);
    const needsArt=byStatus.filter(j=>j.art_status!=='art_complete').length;
    const inProcess=byStatus.filter(j=>j.prod_status==='in_process').length;
    const allDecoTypes=[...new Set(allJobs.map(j=>j.deco_type).filter(Boolean))];
    const kanbanCols=[
      {id:'hold',label:'Ready for Prod',color:'#6366f1',bg:'#eef2ff'},
      {id:'staging',label:'In Line',color:'#d97706',bg:'#fffbeb'},
      {id:'in_process',label:'In Process',color:'#2563eb',bg:'#eff6ff'},
      {id:'completed',label:'Completed',color:'#166534',bg:'#f0fdf4'},
      {id:'shipped',label:'Shipped',color:'#6b7280',bg:'#f9fafb'},
    ];
    return(<>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:4}}>
          {[['active','Active'],['all','All'],['hold','Ready'],['staging','In Line'],['in_process','In Process'],['completed','Done']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${prodStatF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setProdStatF(v)}>{l}</button>)}
        </div>
        <select className="form-select" style={{width:140,fontSize:11}} value={prodFilter} onChange={e=>setProdFilter(e.target.value)}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="form-select" style={{width:150,fontSize:11}} value={prodDecoF} onChange={e=>setProdDecoF(e.target.value)}>
          <option value="all">All Deco Types</option>{allDecoTypes.map(d=><option key={d} value={d}>{d.replace(/_/g,' ')}</option>)}
        </select>
        <div style={{marginLeft:'auto',display:'flex',gap:4}}>
          <button className={`btn btn-sm ${prodView==='board'?'btn-primary':'btn-secondary'}`} onClick={()=>setProdView('board')}>Board</button>
          <button className={`btn btn-sm ${prodView==='list'?'btn-primary':'btn-secondary'}`} onClick={()=>setProdView('list')}>List</button>
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Jobs</div><div className="stat-value">{byStatus.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{totalUnits}</div></div>
        <div className="stat-card"><div className="stat-label">Fulfilled</div><div className="stat-value" style={{color:'#166534'}}>{fulfilledUnits}</div></div>
        <div className="stat-card"><div className="stat-label">Needs Art</div><div className="stat-value" style={{color:needsArt>0?'#d97706':''}}>{needsArt}</div></div>
        <div className="stat-card"><div className="stat-label">In Process</div><div className="stat-value" style={{color:'#2563eb'}}>{inProcess}</div></div>
      </div>
      {prodView==='board'&&<div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:12}}>
        {kanbanCols.map(col=>{const colJobs=byStatus.filter(j=>j.prod_status===col.id);
          return<div key={col.id} style={{minWidth:220,flex:1,background:col.bg,borderRadius:8,padding:8}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
              <div style={{width:8,height:8,borderRadius:8,background:col.color}}/>
              <span style={{fontSize:11,fontWeight:700,color:col.color,textTransform:'uppercase'}}>{col.label}</span>
              <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{colJobs.length}</span>
            </div>
            {colJobs.length===0&&<div style={{padding:12,textAlign:'center',color:'#cbd5e1',fontSize:11}}>No jobs</div>}
            {colJobs.map(j=>{
              const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
              const gCount=(j.items||[]).length;
              const machine=MACHINES.find(m=>m.id===j.assigned_machine);
              const isExp=expandedJob===j.id+j.soId;
              const urgent=j.daysOut!=null&&j.daysOut<=3;

              return<div key={j.id+j.soId} className="card" style={{marginBottom:4,border:urgent?'2px solid #dc2626':'1px solid #e2e8f0',transition:'all 0.15s'}}>
                {/* COMPACT ROW — key info visible at a glance */}
                <div style={{padding:'6px 10px',cursor:'pointer'}} onClick={()=>setExpandedJob(isExp?null:j.id+j.soId)}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:12,fontWeight:800,color:'#334155',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.customer}</span>
                    <span style={{fontSize:11,fontWeight:800,color:pct>=100?'#166534':'#1e40af'}}>{j.total_units}<span style={{fontSize:9,fontWeight:400,color:'#94a3b8'}}> u</span></span>
                    {urgent&&<span style={{fontSize:9}}>🔥</span>}
                    <span style={{fontSize:10,color:'#94a3b8',transition:'transform 0.15s',transform:isExp?'rotate(180deg)':'rotate(0deg)'}}>▾</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                    <span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'#f1f5f9',color:'#475569',fontWeight:600}}>{j.deco_type?.replace(/_/g,' ')||'—'}</span>
                    <span style={{fontSize:9,color:'#64748b',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{gCount} garment{gCount!==1?'s':''} · {j.art_name}</span>
                    <span style={{fontSize:9,color:'#94a3b8'}}>{j.rep}</span>
                  </div>
                  {j.so?.memo&&<div style={{fontSize:9,color:'#94a3b8',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.so.memo}</div>}
                </div>
                {/* Thin progress bar under compact row */}
                {!isExp&&<div style={{height:3,background:'#e2e8f0'}}><div style={{height:3,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>}

                {/* EXPANDED — full details + actions */}
                {isExp&&<div style={{padding:'6px 10px 10px',borderTop:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:12,fontWeight:600,color:'#475569',marginBottom:2}}>{j.art_name}</div>
                  <div style={{fontSize:10,color:'#64748b',marginBottom:6}}>{j.deco_type?.replace(/_/g,' ')} · {j.soId} · {gCount} garment{gCount!==1?'s':''}</div>

                  {/* Badges */}
                  <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>
                    <span style={{padding:'1px 5px',borderRadius:6,fontSize:8,fontWeight:700,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{j.art_status==='art_complete'?'✅ Art':j.art_status==='waiting_approval'?'⏳ Art':'🎨 Art'}</span>
                    {machine&&<span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:6,background:'#fef3c7',color:'#92400e'}}>🖨️ {machine.name}</span>}
                    {j.assigned_to&&<span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:6,background:'#ede9fe',color:'#6d28d9'}}>👤 {j.assigned_to}</span>}
                    {j.ship_method&&<span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:6,
                      background:j.ship_method==='ship_customer'?'#dbeafe':j.ship_method==='rep_delivery'?'#dcfce7':j.ship_method==='customer_pickup'?'#fef3c7':'#f1f5f9',
                      color:j.ship_method==='ship_customer'?'#1e40af':j.ship_method==='rep_delivery'?'#166534':j.ship_method==='customer_pickup'?'#92400e':'#64748b'}}>
                      {j.ship_method==='ship_customer'?'📦 Ship':j.ship_method==='rep_delivery'?'🚗 Rep':j.ship_method==='customer_pickup'?'🏫 Pickup':'⏸️ Hold'}</span>}
                  </div>

                  {/* Units + progress */}
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:800,color:pct>=100?'#166534':'#1e40af'}}>{j.fulfilled_units}/{j.total_units}</span>
                    <div style={{flex:1,background:'#e2e8f0',borderRadius:4,height:5,overflow:'hidden'}}>
                      <div style={{height:5,borderRadius:4,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%'}}/></div>
                    <span style={{fontSize:9,color:'#64748b'}}>{pct}%</span>
                  </div>

                  {j.expected&&<div style={{fontSize:10,color:urgent?'#dc2626':'#64748b',marginBottom:6}}>📅 Due: {j.expected}{urgent?' — RUSH':''}  </div>}

                  {/* Open SO / Job links */}
                  <div style={{display:'flex',gap:8,marginBottom:6}}>
                    <div style={{fontSize:10,color:'#7c3aed',cursor:'pointer',textDecoration:'underline',fontWeight:600}} onClick={e=>{e.stopPropagation();
                      const jso=j.so;const jc=cust.find(c2=>c2.id===jso.customer_id);
                      setESOTab('jobs');setESO(jso);setESOC(jc);setPg('orders');
                    }}>🔍 Open Job Detail</div>
                    <div style={{fontSize:10,color:'#2563eb',cursor:'pointer',textDecoration:'underline'}} onClick={e=>{e.stopPropagation();setESOTab(null);setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>→ Open {j.soId}</div>
                  </div>

                  {/* Time Tracking — clock in/out for active jobs */}
                  {(col.id==='in_process'||col.id==='staging')&&(()=>{
                    const timerKey=j.soId+'|'+j.id;
                    const active=activeTimers[timerKey];
                    const logs=jobTimeLogs.filter(l=>l.jobId===j.id&&l.soId===j.soId);
                    const totalMins=logs.reduce((a,l)=>a+(l.minutes||0),0);
                    return<div style={{background:active?'#dcfce7':'#f8fafc',border:'1px solid '+(active?'#86efac':'#e2e8f0'),borderRadius:6,padding:'4px 8px',marginBottom:6}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        {active?<>
                          <span style={{fontSize:10,fontWeight:700,color:'#166534'}}>⏱️ {active.person} clocked in</span>
                          <span style={{fontSize:9,color:'#64748b',marginLeft:'auto'}}>{Math.round((Date.now()-active.clockIn)/60000)}m</span>
                          <button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#dc2626',color:'white',border:'none'}} onClick={e=>{e.stopPropagation();
                            const mins=Math.round((Date.now()-active.clockIn)/60000);
                            setJobTimeLogs(prev=>[...prev,{jobId:j.id,soId:j.soId,person:active.person,clockIn:new Date(active.clockIn).toLocaleString(),clockOut:new Date().toLocaleString(),minutes:mins}]);
                            setActiveTimers(prev=>{const n={...prev};delete n[timerKey];return n});
                            nf('⏱️ '+active.person+' clocked out — '+mins+' min on '+j.id);
                          }}>Clock Out</button>
                        </>:<>
                          <span style={{fontSize:9,color:'#64748b'}}>⏱️ {totalMins>0?totalMins+'m logged':'No time logged'}</span>
                          <button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px',marginLeft:'auto'}} onClick={e=>{e.stopPropagation();
                            const person=prompt('Who is working on this?',cu.name);
                            if(!person)return;
                            setActiveTimers(prev=>({...prev,[timerKey]:{person,clockIn:Date.now(),soId:j.soId}}));
                            nf('⏱️ '+person+' clocked in on '+j.id);
                          }}>Clock In</button>
                        </>}
                      </div>
                    </div>})()}

                  {/* Move buttons */}
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',borderTop:'1px solid #e2e8f0',paddingTop:6}}>
                    {col.id==='hold'&&<button className="btn btn-sm btn-primary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'staging')}}>→ In Line</button>}
                    {col.id==='staging'&&<><button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'hold')}}>← Ready</button><button className="btn btn-sm btn-primary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'in_process')}}>→ In Process</button></>}
                    {col.id==='in_process'&&<><button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'staging')}}>← In Line</button><button className="btn btn-sm btn-primary" style={{fontSize:9,padding:'3px 8px',background:'#166534',borderColor:'#166534'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'completed')}}>✓ Done</button></>}
                    {col.id==='completed'&&<><button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'in_process')}}>← Back</button><button className="btn btn-sm btn-primary" style={{fontSize:9,padding:'3px 8px',background:'#6d28d9',borderColor:'#6d28d9'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'shipped')}}>📦 Ship</button></>}
                    {col.id==='shipped'&&<button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'3px 8px'}} onClick={e=>{e.stopPropagation();moveJobStatus(j,'completed')}}>← Back</button>}
                  </div>
                </div>}
              </div>})}
          </div>})}
      </div>}
      {prodView==='list'&&<div className="card"><div className="card-body" style={{padding:0}}>
        <table><thead><tr><th>Job</th><th>Artwork</th><th>Customer</th><th>SO</th><th>Rep</th><th>Units</th><th>Art</th><th>Items</th><th>Production</th><th>Expected</th></tr></thead><tbody>
        {byStatus.map(j=>{const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
          return<tr key={j.id+j.soId} style={{cursor:'pointer'}} onClick={()=>{setESOTab('jobs');setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>
            <td style={{fontWeight:700,color:'#1e40af'}}>{j.id}</td>
            <td><div style={{fontWeight:600,fontSize:12}}>{j.art_name}</div><div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')}</div></td>
            <td>{j.customer} <span className="badge badge-gray">{j.alpha}</span></td>
            <td style={{fontSize:11,color:'#64748b'}}>{j.soId}</td>
            <td style={{fontSize:11}}>{j.rep}</td>
            <td><span style={{fontWeight:700}}>{j.fulfilled_units}/{j.total_units}</span>
              <div style={{width:40,background:'#e2e8f0',borderRadius:3,height:4,marginTop:2}}><div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div></td>
            <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{j.art_status==='art_complete'?'Done':j.art_status==='waiting_approval'?'Wait':'Need'}</span></td>
            <td style={{fontSize:11}}>{(j.items||[]).length}</td>
            <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#64748b'}}>{j.prod_status?.replace(/_/g,' ')}</span></td>
            <td style={{fontSize:11,color:j.daysOut!=null&&j.daysOut<=7?'#dc2626':'#64748b'}}>{j.expected||'—'}</td>
          </tr>})}
        </tbody></table>
      </div></div>}

      {/* Assignment Modal — appears when moving to In Line */}
      {assignModal&&<div className="modal-overlay" onClick={()=>setAssignModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
        <div className="modal-header" style={{background:'#fffbeb'}}><h2>📋 Assign to Machine / Person</h2><button className="modal-close" onClick={()=>setAssignModal(null)}>×</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12}}>
            <div style={{fontWeight:700,color:'#1e40af'}}>{assignModal.job.id}</div>
            <div style={{fontSize:13,fontWeight:600}}>{assignModal.job.customer} — {assignModal.job.art_name}</div>
            <div style={{fontSize:11,color:'#64748b'}}>{assignModal.job.deco_type?.replace(/_/g,' ')} · {(assignModal.job.items||[]).length} garment(s) · {assignModal.job.total_units} units</div>
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Machine / Station</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {MACHINES.filter(m=>!assignModal.job.deco_type||m.type===assignModal.job.deco_type||assignTo.machine===m.id).map(m=>
                <button key={m.id} className={`btn btn-sm ${assignTo.machine===m.id?'btn-primary':'btn-secondary'}`}
                  onClick={()=>setAssignTo(a=>({...a,machine:a.machine===m.id?'':m.id}))} style={{fontSize:11}}>
                  🖨️ {m.name}
                </button>)}
              {MACHINES.filter(m=>!assignModal.job.deco_type||m.type!==assignModal.job.deco_type).length>0&&
                <button className="btn btn-sm btn-secondary" style={{fontSize:10,color:'#94a3b8'}}
                  onClick={()=>setAssignTo(a=>({...a,machine:''}))}
                  title="Show all machines">Other...</button>}
            </div>
            {assignTo.machine===''&&<div style={{marginTop:6}}>
              <select className="form-select" style={{fontSize:12}} value="" onChange={e=>setAssignTo(a=>({...a,machine:e.target.value}))}>
                <option value="">All machines...</option>
                {MACHINES.map(m=><option key={m.id} value={m.id}>{m.name} ({m.type.replace(/_/g,' ')})</option>)}
              </select>
            </div>}
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Assign to Person (optional)</label>
            <input className="form-input" value={assignTo.person} onChange={e=>setAssignTo(a=>({...a,person:e.target.value}))} placeholder="e.g. Mike, Carlos, etc."/>
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">After Production — How is this shipping?</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[['ship_customer','📦 Ship to Customer'],['rep_delivery','🚗 Rep Delivery'],['customer_pickup','🏫 Customer Pickup'],['hold','⏸️ Hold']].map(([v,l])=>
                <button key={v} className={`btn btn-sm ${assignTo.shipMethod===v?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setAssignTo(a=>({...a,shipMethod:a.shipMethod===v?'':v}))}>{l}</button>)}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>{
            applyJobMove(assignModal.job,assignModal.targetStatus,'','','');
            setAssignModal(null);
          }}>Skip — Move Anyway</button>
          <button className="btn btn-primary" onClick={()=>{
            applyJobMove(assignModal.job,assignModal.targetStatus,assignTo.machine,assignTo.person,assignTo.shipMethod);
            setAssignModal(null);
          }}>✓ Assign & Move to In Line</button>
        </div>
      </div></div>}
    </>);
  };
  const rBatchPOs=()=>{
    const byVendor={};
    batchPOs.forEach(bp=>{if(!byVendor[bp.vendor_key])byVendor[bp.vendor_key]={name:bp.vendor_name,threshold:BATCH_VENDORS[bp.vendor_key]?.threshold||200,pos:[]};byVendor[bp.vendor_key].pos.push(bp)});
    const vendorGroups=Object.entries(byVendor);
    // Universal PO lookup — searches submitted batches AND all PO lines across every SO
    const q2=batchScan.trim().toLowerCase();
    const batchMatch=q2?submittedBatches.find(sb=>sb.po_number.toLowerCase()===q2):null;
    // Build flat PO line list across all SOs
    const allPOLines=[];
    sos.forEach(so=>{const c2=cust.find(x=>x.id===so.customer_id);
      safeItems(so).forEach((it,idx)=>{(it.po_lines||[]).forEach((pl,pli)=>{
        allPOLines.push({so,soId:so.id,customer:c2?.alpha_tag||'',soMemo:so.memo,item:it,itemIdx:idx,poLine:pl,poLineIdx:pli,poId:pl.po_id||''})})})});
    // Group by PO ID
    const poGroups={};allPOLines.forEach(pl=>{const k=pl.poId;if(!poGroups[k])poGroups[k]={poId:k,lines:[]};poGroups[k].lines.push(pl)});
    const matchedPO=q2?poGroups[Object.keys(poGroups).find(k=>k.toLowerCase()===q2)]||null:null;
    // Label print helper
    const printLabel=(items,poId,boxLabel)=>{
      const w=window.open('','_blank','width=400,height=600');if(!w)return;
      const qrData=encodeURIComponent(poId);
      const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=150x150&data='+qrData;
      w.document.write('<html><head><title>Box Label</title><style>@page{size:4in 6in;margin:0.2in}body{font-family:Arial,sans-serif;margin:0;padding:12px;width:3.6in}');
      w.document.write('.po{font-size:28px;font-weight:900;font-family:monospace;letter-spacing:2px;text-align:center;margin:8px 0}');
      w.document.write('.box-label{font-size:14px;font-weight:700;text-align:center;color:#666;margin-bottom:8px}');
      w.document.write('table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}th{background:#f0f0f0;font-weight:700}');
      w.document.write('.sz{font-weight:700;font-size:10px}.footer{font-size:9px;color:#999;text-align:center;margin-top:8px;border-top:1px solid #ddd;padding-top:4px}');
      w.document.write('</style></head><body>');
      w.document.write('<div style="text-align:center"><img src="'+qrUrl+'" width="120" height="120"/></div>');
      w.document.write('<div class="po">'+poId+'</div>');
      if(boxLabel)w.document.write('<div class="box-label">'+boxLabel+'</div>');
      w.document.write('<table><thead><tr><th>SKU</th><th>Product</th><th>Color</th><th>Sizes</th><th>Qty</th></tr></thead><tbody>');
      items.forEach(it=>{
        const szStr=Object.entries(it.sizes||{}).filter(([,v])=>v>0).map(([sz,v])=>sz+':'+v).join(' ');
        const qty=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
        w.document.write('<tr><td style="font-weight:700">'+it.sku+'</td><td>'+it.name+'</td><td>'+(it.color||'—')+'</td><td class="sz">'+szStr+'</td><td style="font-weight:700">'+qty+'</td></tr>');
      });
      w.document.write('</tbody></table>');
      const totalQty=items.reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((a2,v)=>a2+v,0),0);
      w.document.write('<div style="text-align:right;font-size:14px;font-weight:900;margin-top:6px">TOTAL: '+totalQty+' units</div>');
      w.document.write('<div class="footer">NSA · '+new Date().toLocaleDateString()+' · Scan QR to look up this PO</div>');
      w.document.write('</body></html>');w.document.close();
      setTimeout(()=>w.print(),400);
    };

    return(<>
      {/* Scan / Lookup bar */}
      <div className="card" style={{marginBottom:16}}><div className="card-body" style={{padding:'14px 18px'}}>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <span style={{fontSize:20}}>📱</span>
          <div style={{flex:1}}>
            <div className="search-bar" style={{maxWidth:400}}><Icon name="search"/><input placeholder="Scan or type PO number (e.g. NSA-4501)..." value={batchScan} onChange={e=>setBatchScan(e.target.value)} style={{fontSize:14,fontWeight:600}}/></div>
          </div>
          {batchScan&&<button className="btn btn-sm btn-secondary" onClick={()=>setBatchScan('')}>Clear</button>}
        </div>
        {batchScan.trim()&&!batchMatch&&!matchedPO&&<div style={{marginTop:10,padding:10,background:'#fef2f2',borderRadius:6,color:'#dc2626',fontSize:13,fontWeight:600}}>No PO found matching "{batchScan}"</div>}
      </div></div>

      {/* ===== PO LOOKUP RESULT ===== */}
      {(batchMatch||matchedPO)&&(()=>{
        // Build unified flat item list for this PO
        const poId=batchMatch?batchMatch.po_number:matchedPO.poId;
        const vendor=batchMatch?batchMatch.vendor_name:'';
        const isBatch=!!batchMatch;
        // Flat items: every line item on this PO
        const poItems=[];
        if(isBatch){
          batchMatch.source_pos.forEach(sp=>{sp.items.forEach(it=>{poItems.push({sku:it.sku,name:it.name,color:it.color||'',sizes:it.sizes,qty:it.qty,soId:sp.so_id,customer:sp.customer,soMemo:sp.so_memo})})});
        } else {
          matchedPO.lines.forEach(pl=>{
            const szs={};Object.entries(pl.poLine).forEach(([k,v])=>{if(typeof v==='number'&&v>0&&!['po_id','status'].includes(k))szs[k]=v});
            poItems.push({sku:pl.item.sku,name:safeStr(pl.item.name),color:pl.item.color||'',sizes:szs,qty:Object.values(szs).reduce((a,v)=>a+v,0),soId:pl.soId,customer:pl.customer,soMemo:pl.soMemo,_pl:pl});
          });
        }
        const totalUnits=poItems.reduce((a,it)=>a+it.qty,0);
        const submittedInfo=batchMatch;
        const statusBadge=submittedInfo?.status==='received'?'badge-green':'badge-amber';

        return<div className="card" style={{marginBottom:16,borderLeft:'4px solid #2563eb'}}>
          {/* PO Header */}
          <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'16px 20px',borderRadius:'8px 8px 0 0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:10,opacity:0.6,fontWeight:600}}>PURCHASE ORDER</div>
                <div style={{fontSize:24,fontWeight:900,fontFamily:'monospace',letterSpacing:2}}>{poId}</div>
                {vendor&&<div style={{fontSize:12,opacity:0.8}}>{vendor}</div>}
                {submittedInfo&&<div style={{fontSize:11,opacity:0.6}}>Submitted {submittedInfo.submitted_at} by {submittedInfo.submitted_by}</div>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:24,fontWeight:900}}>{totalUnits}</div>
                <div style={{fontSize:11,opacity:0.7}}>total units · {poItems.length} line{poItems.length!==1?'s':''}</div>
                {submittedInfo&&<span className={`badge ${statusBadge}`} style={{marginTop:4}}>{submittedInfo.status||'waiting'}</span>}
              </div>
            </div>
          </div>

          {/* Flat item list — this is what warehouse sees */}
          <div className="card-body" style={{padding:0}}>
            <table><thead><tr>
              <th style={{width:30}}>#</th>
              <th>SKU</th><th>Product</th><th>Color</th>
              <th>Sizes Ordered</th><th>Total</th>
              <th>Receive</th>
            </tr></thead><tbody>
            {poItems.map((it,i)=>{
              const szEntries=Object.entries(it.sizes).filter(([,v])=>v>0);
              return<tr key={i} id={'po-recv-row-'+i}>
                <td style={{fontWeight:700,color:'#94a3b8',fontSize:11}}>{i+1}</td>
                <td style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af'}}>{it.sku}</td>
                <td style={{fontSize:12}}>{it.name}</td>
                <td style={{fontSize:12,color:'#64748b'}}>{it.color||'—'}</td>
                <td><div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{szEntries.map(([sz,v])=><span key={sz} style={{padding:'2px 6px',background:'#f1f5f9',borderRadius:4,fontSize:10,fontWeight:700}}>{sz}: {v}</span>)}</div></td>
                <td style={{fontWeight:800,fontSize:14}}>{it.qty}</td>
                <td><div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{szEntries.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:8,fontWeight:700,color:'#64748b'}}>{sz}</div><input id={'rcv-'+i+'-'+sz} type="number" className="form-input" style={{width:40,padding:'3px 4px',textAlign:'center',fontSize:12,fontWeight:700}} defaultValue={v} min={0}/></div>)}</div></td>
              </tr>})}
            </tbody></table>
            {/* SO reference — small, for back-office context */}
            <div style={{padding:'8px 16px',background:'#f8fafc',borderTop:'1px solid #e2e8f0'}}>
              <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',marginBottom:4}}>AFFECTS SALES ORDERS</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[...new Set(poItems.map(it=>it.soId))].map(sid=>{const it=poItems.find(p=>p.soId===sid);
                  return<span key={sid} style={{fontSize:10,padding:'2px 8px',background:'#eff6ff',borderRadius:6,color:'#1e40af',fontWeight:600}}>{sid} <span style={{color:'#64748b',fontWeight:400}}>{it?.customer}</span></span>})}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{padding:'12px 16px',borderTop:'2px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-secondary" onClick={()=>{
                const labelItems=poItems.map(it=>({sku:it.sku,name:it.name,color:it.color,sizes:it.sizes}));
                printLabel(labelItems,poId,'RECEIVING — '+new Date().toLocaleDateString());
                nf('🖨️ Label printed for '+poId);
              }}>🖨️ Print Box Label (4×6)</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{navigator.clipboard?.writeText(poId);nf('Copied '+poId)}}>📋 Copy PO#</button>
            </div>
            <div style={{display:'flex',gap:6}}>
              {submittedInfo?.status==='received'?
                <span className="badge badge-green" style={{padding:'6px 12px',fontSize:12}}>✅ Received {submittedInfo.received_at||''}</span>:
                <button className="btn btn-primary" style={{background:'#22c55e',borderColor:'#22c55e',padding:'8px 20px'}} onClick={()=>{
                  // Update submitted batch status
                  if(batchMatch)setSubmittedBatches(prev=>prev.map(sb=>sb.po_number===poId?{...sb,status:'received',received_at:new Date().toLocaleString(),received_by:cu.name}:sb));
                  // Update PO lines on SOs to received
                  const matchedLines=allPOLines.filter(pl=>pl.poId.toLowerCase()===poId.toLowerCase());
                  matchedLines.forEach(ml=>{
                    const so=sos.find(s=>s.id===ml.soId);if(!so)return;
                    const updItems=[...safeItems(so)];
                    const it=updItems[ml.itemIdx];if(!it)return;
                    const pls=[...(it.po_lines||[])];
                    if(pls[ml.poLineIdx]){
                      const rcv={};
                      Object.entries(pls[ml.poLineIdx]).forEach(([k,v])=>{if(typeof v==='number'&&v>0&&!['po_id','status'].includes(k)){
                        const el=document.getElementById('rcv-'+allPOLines.indexOf(ml)+'-'+k);rcv[k]=el?parseInt(el.value)||0:v}});
                      pls[ml.poLineIdx]={...pls[ml.poLineIdx],status:'received',received:rcv,received_at:new Date().toLocaleString(),received_by:cu.name};
                      updItems[ml.itemIdx]={...it,po_lines:pls};
                    }
                    savSO({...so,items:updItems,updated_at:new Date().toLocaleString()});
                  });
                  nf('✅ '+poId+' received — '+totalUnits+' units. SO items updated.');
                  // Print label after receiving
                  const labelItems=poItems.map(it2=>({sku:it2.sku,name:it2.name,color:it2.color,sizes:it2.sizes}));
                  printLabel(labelItems,poId,'RECEIVED — '+new Date().toLocaleDateString());
                }}>✅ Confirm Received ({totalUnits} units)</button>}
            </div>
          </div>
        </div>})()}

      {/* Regular (non-batch) PO match — handled above now */}

      {/* Submitted batches history */}
      {!batchScan.trim()&&submittedBatches.length>0&&<div className="card" style={{marginBottom:16}}>
        <div className="card-header"><h2>Submitted Batch POs</h2></div>
        <div className="card-body" style={{padding:0}}>
          <table><thead><tr><th>PO#</th><th>Vendor</th><th>SOs</th><th>Units</th><th>Total</th><th>Submitted</th><th>By</th><th>Status</th></tr></thead><tbody>
          {submittedBatches.map(sb=><tr key={sb.po_number} style={{cursor:'pointer'}} onClick={()=>setBatchScan(sb.po_number)}>
            <td style={{fontWeight:800,color:'#1e40af',fontFamily:'monospace'}}>{sb.po_number}</td>
            <td>{sb.vendor_name}</td>
            <td style={{fontSize:11}}>{sb.source_pos.map(sp=>sp.so_id).join(', ')}</td>
            <td style={{fontWeight:600}}>{sb.total_units}</td>
            <td style={{fontWeight:700}}>${sb.total_cost.toFixed(2)}</td>
            <td style={{fontSize:11,color:'#64748b'}}>{sb.submitted_at}</td>
            <td style={{fontSize:11}}>{sb.submitted_by?.split(' ')[0]}</td>
            <td><span className={`badge ${sb.status==='received'?'badge-green':'badge-amber'}`}>{sb.status||'waiting'}</span></td>
          </tr>)}
          </tbody></table>
        </div>
      </div>}

      {/* Pending queue */}
      {!batchScan.trim()&&<>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Queued</div><div className="stat-value">{batchPOs.length}</div></div>
        <div className="stat-card"><div className="stat-label">Vendors</div><div className="stat-value">{vendorGroups.length}</div></div>
        <div className="stat-card"><div className="stat-label">Queue Value</div><div className="stat-value">${batchPOs.reduce((a,bp)=>a+bp.total_cost,0).toFixed(2)}</div></div>
        <div className="stat-card"><div className="stat-label">Submitted</div><div className="stat-value">{submittedBatches.length}</div></div>
      </div>
      {vendorGroups.length===0&&submittedBatches.length===0&&<div className="card"><div className="empty" style={{padding:40}}>
        <div style={{fontSize:32,marginBottom:8}}>📦</div>
        <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>No batch POs queued</div>
        <div style={{maxWidth:400,margin:'0 auto'}}>When creating a PO for S&S, SanMar, Richardson, Momentec, or A4 — click "Add to Batch" to queue it. Submit when the batch hits free shipping threshold.</div>
      </div></div>}
      {vendorGroups.map(([vk,vg])=>{
        const total=vg.pos.reduce((a,bp)=>a+bp.total_cost,0);
        const totalUnits=vg.pos.reduce((a,bp)=>a+bp.items.reduce((a2,it)=>a2+it.qty,0),0);
        const hitThreshold=total>=vg.threshold;
        const nextPO='NSA-'+batchCounter;
        return<div key={vk} className="card" style={{marginBottom:16,borderLeft:hitThreshold?'4px solid #22c55e':'4px solid #d97706'}}>
          <div className="card-header">
            <div><h2>{vg.name}</h2><div style={{fontSize:12,color:'#64748b'}}>{vg.pos.length} queued · {totalUnits} units</div></div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:20,fontWeight:800,color:hitThreshold?'#166534':'#d97706'}}>${total.toFixed(2)}</div>
              <div style={{fontSize:11,color:hitThreshold?'#166534':'#d97706',fontWeight:600}}>{hitThreshold?'\u2705 Free shipping!':'$'+(vg.threshold-total).toFixed(2)+' to free ship'}</div>
            </div>
          </div>
          <div className="card-body" style={{padding:0}}>
            {vg.pos.map((bp,bpi)=><div key={bp.id} style={{padding:'12px 16px',borderBottom:bpi<vg.pos.length-1?'1px solid #f1f5f9':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <div><span style={{fontWeight:700,color:'#1e40af'}}>{bp.so_id}</span><span style={{fontSize:12,color:'#64748b',marginLeft:8}}>{bp.customer} — {bp.so_memo}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:700}}>${bp.total_cost.toFixed(2)}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{bp.created_by_name?.split(' ')[0]}</span>
                  <button className="btn btn-sm" style={{color:'#dc2626',borderColor:'#fca5a5',padding:'2px 6px'}} onClick={()=>setBatchPOs(prev=>prev.filter(p=>p.id!==bp.id))}>\u2715</button>
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {bp.items.map((it,i)=><div key={i} style={{fontSize:11,padding:'3px 8px',background:'#f8fafc',borderRadius:4,border:'1px solid #e2e8f0'}}>
                  <span style={{fontFamily:'monospace',fontWeight:600}}>{it.sku}</span> {it.name} <span style={{color:'#64748b'}}>({it.qty})</span>
                </div>)}
              </div>
            </div>)}
          </div>
          <div style={{padding:'14px 16px',background:'#f8fafc',borderTop:'1px solid #e2e8f0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div>
                <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PO NUMBER FOR VENDOR B2B</div>
                <div style={{fontSize:22,fontWeight:800,fontFamily:'monospace',color:'#1e40af',letterSpacing:2}}>{nextPO}</div>
                <div style={{fontSize:10,color:'#94a3b8'}}>Enter this exact number in {vg.name}'s B2B. Warehouse scans this barcode on receiving.</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <button className="btn btn-sm btn-secondary" onClick={()=>{navigator.clipboard?.writeText(nextPO);nf('Copied '+nextPO)}}>\uD83D\uDCCB Copy PO#</button>
                <button className="btn btn-sm btn-secondary" onClick={()=>{if(window.confirm('Clear all '+vg.pos.length+' POs?'))setBatchPOs(prev=>prev.filter(p=>p.vendor_key!==vk))}}>Clear</button>
              </div>
            </div>
            <button style={{width:'100%',padding:'12px 20px',borderRadius:8,border:'none',cursor:'pointer',fontWeight:800,fontSize:14,
              background:hitThreshold?'linear-gradient(135deg,#22c55e,#16a34a)':'linear-gradient(135deg,#2563eb,#1d4ed8)',color:'white'}}
              onClick={()=>{
                const poNum=nextPO;
                const sb={po_number:poNum,vendor_key:vk,vendor_name:vg.name,total_cost:total,total_units:totalUnits,
                  submitted_at:new Date().toLocaleString(),submitted_by:cu.name,status:'waiting',
                  source_pos:vg.pos.map(bp=>({so_id:bp.so_id,so_memo:bp.so_memo,customer:bp.customer,items:bp.items,total_cost:bp.total_cost}))};
                setSubmittedBatches(prev=>[sb,...prev]);
                vg.pos.forEach(bp=>{
                  const so=sos.find(s=>s.id===bp.so_id);if(!so)return;
                  const updatedItems=safeItems(so).map(it=>({...it,po_lines:[...(it.po_lines||[])]}));
                  bp.items.forEach(bpIt=>{
                    const idx=bpIt.item_idx;if(idx==null||!updatedItems[idx])return;
                    const poLine={po_id:poNum,status:'waiting',created_at:new Date().toLocaleDateString(),memo:'Batch: '+vg.pos.map(b=>b.so_id).join('+'),received:{},shipments:[]};
                    Object.entries(bpIt.sizes).forEach(([sz,v])=>{if(v>0)poLine[sz]=v});
                    updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];
                  });
                  savSO({...so,items:updatedItems,updated_at:new Date().toLocaleString()});
                });
                setBatchPOs(prev=>prev.filter(p=>p.vendor_key!==vk));
                setBatchCounter(ct=>ct+1);
                nf('\uD83D\uDE80 '+poNum+' submitted to '+vg.name+' ($'+total.toFixed(2)+')');
              }}>\uD83D\uDE80 Submit {nextPO} to {vg.name}{hitThreshold?' \u2014 FREE SHIP':''} (${total.toFixed(2)})</button>
            <div style={{fontSize:10,color:'#64748b',marginTop:6,textAlign:'center'}}>
              Contains: {vg.pos.map(bp=>bp.so_id+' ('+bp.customer+')').join(' \u00B7 ')}
            </div>
          </div>
        </div>})}

      {/* Batch-eligible vendors */}
      <div className="card"><div className="card-header"><h2>Batch-Eligible Vendors</h2></div><div className="card-body">
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {Object.entries(BATCH_VENDORS).map(([k,v])=>{const queued=(batchPOs||[]).filter(bp=>bp.vendor_key===k);const qTotal=queued.reduce((a,bp)=>a+bp.total_cost,0);
            return<div key={k} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,minWidth:150}}>
              <div style={{fontWeight:700,fontSize:13}}>{v.name}</div>
              <div style={{fontSize:11,color:'#64748b'}}>Free ship: ${v.threshold}+</div>
              {queued.length>0&&<div style={{fontSize:11,marginTop:4,color:qTotal>=v.threshold?'#166534':'#d97706',fontWeight:600}}>{queued.length} queued \u00B7 ${qTotal.toFixed(2)}</div>}
            </div>})}
        </div>
        <div style={{fontSize:11,color:'#94a3b8',marginTop:10}}>The PO number assigned here (e.g. NSA-4501) goes into the vendor's B2B portal. When the box arrives, scan that PO number to see every SO and item inside.</div>
      </div></div>
      </>}
    </>);
  };


  // BACKUP & DATA PAGE
  const getFullState=()=>({
    _meta:{version:'1.0',exported_at:new Date().toISOString(),exported_by:cu.name,app:'NSA Portal'},
    customers:cust,estimates:ests,sales_orders:sos,products:prod,messages:msgs,invoices:invs,
    batch_queue:batchPOs,submitted_batches:submittedBatches,batch_counter:batchCounter,
    change_log:changeLog,so_history:soHistory
  });
  const exportBackup=()=>{
    const data=getFullState();
    const json=JSON.stringify(data,null,2);
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const ts=new Date().toISOString().split('T')[0];
    a.href=url;a.download='NSA-backup-'+ts+'.json';a.click();
    URL.revokeObjectURL(url);
    setLastBackup(new Date().toLocaleString());
    logChange('backup','system','full','Full system backup exported');
    nf('💾 Backup exported: NSA-backup-'+ts+'.json');
  };
  const importBackup=(file)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const data=JSON.parse(e.target.result);
        if(!data._meta)throw new Error('Not a valid NSA backup file');
        if(window.confirm('⚠️ This will REPLACE all current data with the backup from '+data._meta.exported_at+' by '+data._meta.exported_by+'. Are you sure?')){
          if(data.customers)setCust(data.customers);
          if(data.estimates)setEsts(data.estimates);
          if(data.sales_orders)setSOs(data.sales_orders);
          if(data.products)setProd(data.products);
          if(data.messages)setMsgs(data.messages);
          if(data.invoices)setInvs(data.invoices);
          if(data.batch_queue)setBatchPOs(data.batch_queue);
          if(data.submitted_batches)setSubmittedBatches(data.submitted_batches);
          if(data.batch_counter)setBatchCounter(data.batch_counter);
          if(data.change_log)setChangeLog(data.change_log);
          if(data.so_history)setSOHistory(data.so_history);
          logChange('restore','system','full','Restored from backup: '+data._meta.exported_at);
          nf('✅ Data restored from backup ('+data._meta.exported_at+')');
        }
      }catch(err){nf('❌ Failed to import: '+err.message)}
    };
    reader.readAsText(file);
  };
  // Auto-backup to localStorage every 5 minutes
  React.useEffect(()=>{
    if(!autoBackupEnabled)return;
    const interval=setInterval(()=>{
      try{
        const data=JSON.stringify({_meta:{version:'1.0',auto_backup:true,saved_at:new Date().toISOString()},
          customers:cust,estimates:ests,sales_orders:sos,products:prod,messages:msgs,invoices:invs,
          batch_queue:batchPOs,submitted_batches:submittedBatches,batch_counter:batchCounter,
          change_log:changeLog,so_history:soHistory});
        localStorage.setItem('nsa_auto_backup',data);
        localStorage.setItem('nsa_auto_backup_ts',new Date().toISOString());
      }catch{}
    },300000);// 5 min
    return()=>clearInterval(interval);
  },[autoBackupEnabled,cust,ests,sos,prod,msgs,invs,batchPOs,submittedBatches,batchCounter,changeLog,soHistory]);

  const restoreAutoBackup=()=>{
    try{
      const raw=localStorage.getItem('nsa_auto_backup');
      if(!raw){nf('No auto-backup found');return}
      const data=JSON.parse(raw);
      const ts=localStorage.getItem('nsa_auto_backup_ts')||'unknown';
      if(window.confirm('Restore auto-backup from '+new Date(ts).toLocaleString()+'?')){
        if(data.customers)setCust(data.customers);
        if(data.estimates)setEsts(data.estimates);
        if(data.sales_orders)setSOs(data.sales_orders);
        if(data.products)setProd(data.products);
        if(data.messages)setMsgs(data.messages);
        if(data.invoices)setInvs(data.invoices);
        if(data.batch_queue)setBatchPOs(data.batch_queue);
        if(data.submitted_batches)setSubmittedBatches(data.submitted_batches);
        if(data.batch_counter)setBatchCounter(data.batch_counter);
        if(data.change_log)setChangeLog(data.change_log);
        if(data.so_history)setSOHistory(data.so_history);
        nf('✅ Restored from auto-backup');
      }
    }catch{nf('❌ No valid auto-backup found')}
  };

  // INVOICES PAGE
  const CC_FEE_PCT=0.029;// 2.9% credit card surcharge
  const PAY_METHODS=[{id:'check',label:'Check',icon:'📝'},{id:'ach',label:'ACH/Wire',icon:'🏦'},{id:'venmo',label:'Venmo',icon:'💜'},{id:'zelle',label:'Zelle',icon:'⚡'},{id:'cash',label:'Cash',icon:'💵'},{id:'cc',label:'Credit Card (+2.9%)',icon:'💳'}];
  const[invF,setInvF]=useState({search:'',status:'all',group:'list',aging:'all',rep:'all'});
  const[invSort,setInvSort]=useState({f:'due_date',d:'asc'});
  const[invEdit,setInvEdit]=useState(null);
  const[payModal,setPayModal]=useState(null);

  const rInvoices=()=>{
    const today=new Date();
    const parseD=(ds)=>{if(!ds)return null;const m=ds.match(/(\d{2})\/(\d{2})\/(\d{2})/);return m?new Date('20'+m[3],m[1]-1,m[2]):new Date(ds)};
    const agingDays=(dateStr)=>{const d=parseD(dateStr);return d?Math.floor((today-d)/(1000*60*60*24)):0};
    const dueDays=(dateStr)=>{const d=parseD(dateStr);return d?Math.floor((d-today)/(1000*60*60*24)):null};
    const invSortFn=(f)=>setInvSort(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}));
    const sortIcon=(f)=>invSort.f===f?(invSort.d==='asc'?'▲':'▼'):'⇅';

    // Enrich invoices with computed fields
    let fi=invs.map(i=>{const age=agingDays(i.date);const dd=dueDays(i.due_date);const bal=i.total-i.paid;
      const overdue=dd!==null&&dd<0&&i.status!=='paid';
      const so=sos.find(s=>s.id===i.so_id);const rep=so?so.created_by:null;
      return{...i,_age:age,_dd:dd,_bal:bal,_overdue:overdue,_rep:rep,_cname:cust.find(c=>c.id===i.customer_id)?.name||'Unknown'}});

    // Filters
    if(invF.status==='open')fi=fi.filter(i=>i.status==='open'||i.status==='partial');
    else if(invF.status==='paid')fi=fi.filter(i=>i.status==='paid');
    if(invF.aging==='30')fi=fi.filter(i=>i._age>=1&&i._age<=30&&i.status!=='paid');
    else if(invF.aging==='60')fi=fi.filter(i=>i._age>=31&&i._age<=60&&i.status!=='paid');
    else if(invF.aging==='90')fi=fi.filter(i=>i._age>=61&&i._age<=90&&i.status!=='paid');
    else if(invF.aging==='120')fi=fi.filter(i=>i._age>90&&i.status!=='paid');
    else if(invF.aging==='overdue')fi=fi.filter(i=>i._overdue);
    if(invF.rep!=='all')fi=fi.filter(i=>i._rep===invF.rep);
    if(invF.search){const s=invF.search.toLowerCase();fi=fi.filter(i=>(i.id||'').toLowerCase().includes(s)||(i.memo||'').toLowerCase().includes(s)||i._cname.toLowerCase().includes(s))}

    // Sort
    fi.sort((a,b)=>{let va,vb;
      if(invSort.f==='id'){va=a.id;vb=b.id}
      else if(invSort.f==='customer'){va=a._cname;vb=b._cname}
      else if(invSort.f==='date'){va=parseD(a.date);vb=parseD(b.date)}
      else if(invSort.f==='due_date'){va=parseD(a.due_date);vb=parseD(b.due_date)}
      else if(invSort.f==='age'){va=a._age;vb=b._age}
      else if(invSort.f==='total'){va=a.total;vb=b.total}
      else if(invSort.f==='paid'){va=a.paid;vb=b.paid}
      else if(invSort.f==='balance'){va=a._bal;vb=b._bal}
      else if(invSort.f==='status'){va=a.status;vb=b.status}
      else{va=a.id;vb=b.id}
      if(va==null)va='';if(vb==null)vb='';
      const cmp=va<vb?-1:va>vb?1:0;
      return invSort.d==='asc'?cmp:-cmp;
    });

    // Stats (from all invs, not filtered)
    const allOpen=invs.filter(i=>i.status==='open'||i.status==='partial');
    const totalOpen=allOpen.reduce((a,i)=>a+(i.total-i.paid),0);
    const totalOverdue=allOpen.filter(i=>dueDays(i.due_date)<0).reduce((a,i)=>a+(i.total-i.paid),0);
    const totalPaid=invs.filter(i=>i.status==='paid').reduce((a,i)=>a+i.paid,0);
    const agingBuckets={current:0,d30:0,d60:0,d90:0,d120p:0};
    allOpen.forEach(i=>{const dd=dueDays(i.due_date);const bal=i.total-i.paid;
      if(dd>=0)agingBuckets.current+=bal;
      else if(dd>=-30)agingBuckets.d30+=bal;
      else if(dd>=-60)agingBuckets.d60+=bal;
      else if(dd>=-90)agingBuckets.d90+=bal;
      else agingBuckets.d120p+=bal;
    });
    const agingCounts={d30:allOpen.filter(i=>agingDays(i.date)>=1&&agingDays(i.date)<=30).length,d60:allOpen.filter(i=>agingDays(i.date)>=31&&agingDays(i.date)<=60).length,d90:allOpen.filter(i=>agingDays(i.date)>=61&&agingDays(i.date)<=90).length,d120p:allOpen.filter(i=>agingDays(i.date)>90).length};

    const recordPayment=(inv,amount,method,ref)=>{
      const fee=method==='cc'?Math.round(amount*CC_FEE_PCT*100)/100:0;
      const newPaid=inv.paid+amount;
      const newStatus=newPaid>=inv.total?'paid':newPaid>0?'partial':'open';
      const payment={amount,method,ref,date:new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'}),cc_fee:fee};
      const updated={...inv,paid:newPaid,status:newStatus,cc_fee:(inv.cc_fee||0)+fee,payments:[...(inv.payments||[]),payment]};
      setInvs(prev=>prev.map(i=>i.id===inv.id?updated:i));
      setPayModal(null);
      nf('💰 $'+amount.toLocaleString()+' recorded on '+inv.id+(fee>0?' (+$'+fee.toFixed(2)+' CC fee)':''));
    };

    // Grouped by customer
    const grouped={};
    fi.forEach(i=>{const cid=i.customer_id;if(!grouped[cid])grouped[cid]={customer:cust.find(c=>c.id===cid),invoices:[]};grouped[cid].invoices.push(i)});

    const SH=({label,field,w})=><th style={{cursor:'pointer',userSelect:'none',width:w,whiteSpace:'nowrap'}} onClick={()=>invSortFn(field)}>
      <span style={{display:'inline-flex',alignItems:'center',gap:3}}>{label}<span style={{fontSize:9,opacity:invSort.f===field?1:0.3}}>{sortIcon(field)}</span></span></th>;

    const ageBadge=(age)=>{
      if(age<=0)return null;
      const color=age<=30?'#64748b':age<=60?'#d97706':age<=90?'#ea580c':'#dc2626';
      const bg=age<=30?'#f1f5f9':age<=60?'#fef3c7':age<=90?'#ffedd5':'#fecaca';
      return<span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:bg,color}}>{age}d</span>;
    };

    return(<>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='all'&&invF.aging==='all'?'2px solid #2563eb':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'all',aging:'all'}))}>
          <div className="stat-label">All Invoices</div><div className="stat-value">{invs.length}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='open'&&invF.aging==='all'?'2px solid #d97706':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'open',aging:'all'}))}>
          <div className="stat-label">Open</div><div className="stat-value" style={{color:'#d97706'}}>${totalOpen.toLocaleString()}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.aging==='overdue'?'2px solid #dc2626':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'all',aging:f.aging==='overdue'?'all':'overdue'}))}>
          <div className="stat-label">Overdue</div><div className="stat-value" style={{color:'#dc2626'}}>${totalOverdue.toLocaleString()}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='paid'?'2px solid #166534':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'paid',aging:'all'}))}>
          <div className="stat-label">Paid</div><div className="stat-value" style={{color:'#166534'}}>${totalPaid.toLocaleString()}</div></div>
      </div>

      {/* Aging Summary — clickable to filter */}
      <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:'12px 16px'}}>
        <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>AGING SUMMARY <span style={{fontWeight:400,fontSize:10}}>(click to filter)</span></div>
        <div style={{display:'flex',gap:4}}>
          {[['Current','current','#166534','all'],['1-30 Days','d30','#d97706','30'],['31-60 Days','d60','#ea580c','60'],['61-90 Days','d90','#dc2626','90'],['90+ Days','d120p','#991b1b','120']].map(([label,key,color,fKey])=>
            <div key={key} style={{flex:1,padding:'8px 12px',background:invF.aging===fKey?color+'20':agingBuckets[key]>0?color+'08':'#f8fafc',borderRadius:6,
              border:invF.aging===fKey?`2px solid ${color}`:`1px solid ${agingBuckets[key]>0?color+'40':'#e2e8f0'}`,textAlign:'center',cursor:'pointer'}}
              onClick={()=>setInvF(f=>({...f,aging:f.aging===fKey?'all':fKey,status:fKey==='all'?f.status:'all'}))}>
              <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>{label}</div>
              <div style={{fontSize:16,fontWeight:800,color:agingBuckets[key]>0?color:'#94a3b8'}}>${agingBuckets[key].toLocaleString()}</div>
              {key!=='current'&&<div style={{fontSize:9,color:'#94a3b8'}}>{agingCounts[key]||0} inv</div>}
            </div>)}
        </div>
      </div></div>

      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <div className="search-bar" style={{flex:1,minWidth:200,maxWidth:300}}><Icon name="search"/><input placeholder="Search invoices, customers..." value={invF.search} onChange={e=>setInvF(f=>({...f,search:e.target.value}))}/></div>
        <select className="form-select" style={{width:130,fontSize:11}} value={invF.rep} onChange={e=>setInvF(f=>({...f,rep:e.target.value}))}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <div style={{display:'flex',gap:4}}>
          {[['list','📋 List'],['customer','👥 By Customer']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${invF.group===v?'btn-primary':'btn-secondary'}`} onClick={()=>setInvF(f=>({...f,group:v}))}>{l}</button>)}
        </div>
        {(invF.status!=='all'||invF.aging!=='all'||invF.rep!=='all'||invF.search)&&
          <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>setInvF({search:'',status:'all',group:invF.group,aging:'all',rep:'all'})}>✕ Clear Filters</button>}
      </div>

      {/* Results count */}
      <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{fi.length} invoice{fi.length!==1?'s':''} · Balance: ${fi.reduce((a,i)=>a+i._bal,0).toLocaleString()}</div>

      {/* List view */}
      {invF.group==='list'&&<div className="card"><div className="card-body" style={{padding:0}}>
        {fi.length===0?<div className="empty" style={{padding:30}}>No invoices match filters</div>:
        <table><thead><tr>
          <SH label="Invoice" field="id"/>
          <SH label="Customer" field="customer"/>
          <th style={{fontSize:11}}>SO</th>
          <th style={{fontSize:11}}>Rep</th>
          <SH label="Date" field="date"/>
          <SH label="Age" field="age" w={50}/>
          <SH label="Due" field="due_date"/>
          <SH label="Total" field="total"/>
          <SH label="Paid" field="paid"/>
          <SH label="Balance" field="balance"/>
          <SH label="Status" field="status"/>
          <th>Action</th>
        </tr></thead>
        <tbody>{fi.map(inv=>{
          const repObj=REPS.find(r=>r.id===inv._rep);
          return<tr key={inv.id} style={{background:inv._overdue?'#fef2f2':undefined}}>
            <td style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{inv.id}</td>
            <td style={{fontSize:12}}>{inv._cname}</td>
            <td style={{fontSize:11,color:'#7c3aed',cursor:inv.so_id?'pointer':'default',textDecoration:inv.so_id?'underline':'none'}}
              onClick={()=>{if(inv.so_id){const so=sos.find(s=>s.id===inv.so_id);if(so){setESO(so);setESOC(cust.find(c=>c.id===so.customer_id));setPg('orders')}}}}>{inv.so_id||'—'}</td>
            <td style={{fontSize:10,color:'#64748b'}}>{repObj?.name||'—'}</td>
            <td style={{fontSize:11}}>{inv.date}</td>
            <td style={{textAlign:'center'}}>{ageBadge(inv._age)}</td>
            <td style={{fontSize:11,color:inv._overdue?'#dc2626':'#64748b',fontWeight:inv._overdue?700:400}}>{inv.due_date||'—'}{inv._overdue?' ⚠️':''}</td>
            <td style={{fontWeight:600,textAlign:'right'}}>${inv.total.toLocaleString()}</td>
            <td style={{color:'#166534',textAlign:'right'}}>${inv.paid.toLocaleString()}{inv.cc_fee>0?<span style={{fontSize:8,color:'#94a3b8'}}> +${inv.cc_fee.toFixed(0)}fee</span>:''}</td>
            <td style={{fontWeight:700,color:inv._bal>0?'#dc2626':'#166534',textAlign:'right'}}>${inv._bal.toLocaleString()}</td>
            <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,
              background:inv.status==='paid'?'#dcfce7':inv.status==='partial'?'#fef3c7':inv._overdue?'#fecaca':'#dbeafe',
              color:inv.status==='paid'?'#166534':inv.status==='partial'?'#92400e':inv._overdue?'#991b1b':'#1e40af'}}>
              {inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':inv._overdue?'Overdue':'Open'}</span></td>
            <td>{inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#166534',color:'white',border:'none'}}
              onClick={()=>setPayModal({inv,amount:inv._bal,method:'check',ref:''})}>💰 Pay</button>}
              <button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',marginLeft:2}} onClick={()=>{
                const so=sos.find(s=>s.id===inv.so_id);const ic=cust.find(c=>c.id===inv.customer_id);
                const invItems=(inv.line_items||[]).length>0?inv.line_items:
                  (so?safeItems(so).map(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!qty)return null;
                    const decoSell=safeDecos(it).reduce((a,d)=>{const dp=dP(d,qty,af,qty);return a+dp.sell},0);
                    return{desc:it.sku+' '+it.name+(it.color?' — '+it.color:''),qty,rate:safeNum(it.unit_sell)+decoSell,amount:qty*(safeNum(it.unit_sell)+decoSell)}}).filter(Boolean):[]);
                const shipAmt=inv.shipping!=null?inv.shipping:so?(()=>{const sub=invItems.reduce((a,l)=>a+l.amount,0);return(so.shipping_type==='pct'?sub*(so.shipping_value||0)/100:so.shipping_value||0)})():0;
                const taxAmt=inv.tax||0;
                printDoc({
                  title:ic?.name||'Customer',docNum:inv.id,docType:'INVOICE',
                  headerRight:'<div style="font-size:24px;font-weight:900;color:'+(inv._bal>0?'#dc2626':'#166534')+'">$'+inv.total.toLocaleString()+'</div>'
                    +'<div style="font-size:11px;color:#666">Balance Due: <strong style="color:'+(inv._bal>0?'#dc2626':'#166534')+'">$'+inv._bal.toLocaleString()+'</strong></div>',
                  infoBoxes:[
                    {label:'Bill To',value:ic?.name||'—',sub:ic?.alpha_tag},
                    {label:'Invoice Date',value:inv.date||new Date().toLocaleDateString(),sub:inv.due_date?'Due: '+inv.due_date:''},
                    {label:'Sales Order',value:inv.so_id||'—',sub:inv.memo||so?.memo||''},
                    {label:'Payment Terms',value:inv.type==='deposit'?'50% Deposit':'Final Invoice',sub:'Rep: '+(REPS.find(r=>r.id===inv._rep)?.name||'—')},
                  ],
                  tables:[{
                    headers:['Description','Qty','Rate','Amount'],
                    aligns:['left','center','right','right'],
                    rows:[
                      ...invItems.map(li=>({cells:[li.desc,li.qty,'$'+safeNum(li.rate).toFixed(2),'$'+safeNum(li.amount).toFixed(2)]})),
                      ...(shipAmt>0?[{cells:[{value:'Shipping',style:'font-style:italic'},'','','$'+shipAmt.toFixed(2)]}]:[]),
                      ...(taxAmt>0?[{cells:[{value:'Tax',style:'font-style:italic'},'','','$'+taxAmt.toFixed(2)]}]:[]),
                      {_class:'totals-row',cells:['','','Total','$'+inv.total.toLocaleString()]},
                      ...(inv.paid>0?[{cells:['','',{value:'Paid',style:'color:#166534'},'$'+inv.paid.toLocaleString()]}]:[]),
                      ...(inv._bal>0?[{_style:'background:#fef2f2',cells:['','',{value:'<strong>Balance Due</strong>',style:'color:#dc2626'},'<strong style="color:#dc2626;font-size:14px">$'+inv._bal.toLocaleString()+'</strong>']}]:[]),
                    ]
                  }],
                  footer:inv.type==='deposit'?NSA.depositTerms:NSA.terms
                });
              }}>🖨️</button></td>
          </tr>})}</tbody></table>}
      </div></div>}

      {/* Customer grouped view */}
      {invF.group==='customer'&&Object.entries(grouped).map(([cid,g])=>{
        const openBal=g.invoices.filter(i=>i.status!=='paid').reduce((a,i)=>a+i._bal,0);
        const overdueAmt=g.invoices.filter(i=>i._overdue).reduce((a,i)=>a+i._bal,0);
        return<div key={cid} className="card" style={{marginBottom:12}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div><h2 style={{margin:0}}>{g.customer?.name||'Unknown Customer'}</h2>
              <span style={{fontSize:11,color:'#64748b'}}>{g.customer?.alpha_tag} · {g.invoices.length} invoice{g.invoices.length!==1?'s':''}</span></div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:18,fontWeight:800,color:openBal>0?'#dc2626':'#166534'}}>${openBal.toLocaleString()} <span style={{fontSize:11,fontWeight:400,color:'#64748b'}}>open</span></div>
              {overdueAmt>0&&<div style={{fontSize:12,color:'#dc2626',fontWeight:600}}>⚠️ ${overdueAmt.toLocaleString()} overdue</div>}
            </div>
          </div>
          <div className="card-body" style={{padding:0}}>
            <table><thead><tr><th>Invoice</th><th>SO</th><th>Memo</th><th>Date</th><th>Age</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>{g.invoices.map(inv=>
              <tr key={inv.id} style={{background:inv._overdue?'#fef2f2':undefined}}>
                <td style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{inv.id}</td>
                <td style={{fontSize:11,color:'#7c3aed',cursor:inv.so_id?'pointer':'default',textDecoration:inv.so_id?'underline':'none'}}
                  onClick={()=>{if(inv.so_id){const so=sos.find(s=>s.id===inv.so_id);if(so){setESO(so);setESOC(cust.find(c=>c.id===so.customer_id));setPg('orders')}}}}>{inv.so_id||'—'}</td>
                <td style={{fontSize:11}}>{inv.memo}</td>
                <td style={{fontSize:11}}>{inv.date}</td>
                <td style={{textAlign:'center'}}>{ageBadge(inv._age)}</td>
                <td style={{fontSize:11,color:inv._overdue?'#dc2626':'#64748b',fontWeight:inv._overdue?700:400}}>{inv.due_date||'—'}{inv._overdue?' ⚠️':''}</td>
                <td style={{fontWeight:600,textAlign:'right'}}>${inv.total.toLocaleString()}</td>
                <td style={{fontWeight:700,color:inv._bal>0?'#dc2626':'#166534',textAlign:'right'}}>${inv._bal.toLocaleString()}</td>
                <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,
                  background:inv.status==='paid'?'#dcfce7':inv.status==='partial'?'#fef3c7':inv._overdue?'#fecaca':'#dbeafe',
                  color:inv.status==='paid'?'#166534':inv.status==='partial'?'#92400e':inv._overdue?'#991b1b':'#1e40af'}}>
                  {inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':inv._overdue?'Overdue':'Open'}</span></td>
                <td>{inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#166534',color:'white',border:'none'}}
                  onClick={()=>setPayModal({inv,amount:inv._bal,method:'check',ref:''})}>💰 Pay</button>}</td>
              </tr>)}</tbody></table>
            {/* Payment history */}
            {g.invoices.some(i=>(i.payments||[]).length>0)&&<div style={{padding:'8px 16px',borderTop:'1px solid #f1f5f9'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>PAYMENT HISTORY</div>
              {g.invoices.flatMap(i=>(i.payments||[]).map(p=>({...p,inv_id:i.id}))).sort((a,b)=>new Date(b.date)-new Date(a.date)).map((p,pi)=>
                <div key={pi} style={{fontSize:11,padding:'2px 0',display:'flex',gap:8}}>
                  <span style={{color:'#94a3b8',width:60}}>{p.date}</span>
                  <span style={{fontWeight:600,width:70}}>${p.amount.toLocaleString()}</span>
                  <span>{PAY_METHODS.find(m=>m.id===p.method)?.icon} {PAY_METHODS.find(m=>m.id===p.method)?.label||p.method}</span>
                  <span style={{color:'#64748b'}}>{p.ref}</span>
                  <span style={{color:'#94a3b8',marginLeft:'auto'}}>{p.inv_id}</span>
                  {p.cc_fee>0&&<span style={{fontSize:9,color:'#d97706'}}>+${p.cc_fee.toFixed(2)} CC fee</span>}
                </div>)}
            </div>}
          </div>
        </div>})}

      {/* Payment Modal */}
      {payModal&&<div className="modal-overlay" onClick={()=>setPayModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>💰 Record Payment — {payModal.inv.id}</h2><button className="modal-close" onClick={()=>setPayModal(null)}>×</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Invoice Total</span><span style={{fontWeight:700}}>${payModal.inv.total.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Already Paid</span><span style={{color:'#166534'}}>${payModal.inv.paid.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #e2e8f0',paddingTop:4,marginTop:4}}><span style={{fontWeight:700}}>Balance Due</span><span style={{fontWeight:800,color:'#dc2626'}}>${(payModal.inv.total-payModal.inv.paid).toLocaleString()}</span></div>
          </div>

          <div style={{marginBottom:12}}>
            <label className="form-label">Payment Method</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {PAY_METHODS.map(m=><button key={m.id} className={`btn btn-sm ${payModal.method===m.id?'btn-primary':'btn-secondary'}`}
                style={{fontSize:11}} onClick={()=>setPayModal(p=>({...p,method:m.id}))}>{m.icon} {m.label}</button>)}
            </div>
          </div>

          {payModal.method==='cc'&&<div style={{padding:8,background:'#fef3c7',borderRadius:6,marginBottom:12,fontSize:12}}>
            <strong>💳 Credit Card Surcharge:</strong> 2.9% (${(payModal.amount*CC_FEE_PCT).toFixed(2)}) will be added to the invoice.
            <div style={{fontSize:11,color:'#92400e',marginTop:2}}>Suggest Venmo, Zelle, ACH, or Check to avoid the fee.</div>
          </div>}

          <div className="form-row form-row-2">
            <div><label className="form-label">Amount</label>
              <input className="form-input" type="number" value={payModal.amount} onChange={e=>setPayModal(p=>({...p,amount:parseFloat(e.target.value)||0}))}/>
            </div>
            <div><label className="form-label">Reference / Note</label>
              <input className="form-input" value={payModal.ref} onChange={e=>setPayModal(p=>({...p,ref:e.target.value}))}
                placeholder={payModal.method==='check'?'Check #...':payModal.method==='venmo'?'@username':payModal.method==='cc'?'Card ending...':'Reference...'}/>
            </div>
          </div>

          {payModal.method==='cc'&&<div style={{marginTop:8,padding:8,background:'#f0fdf4',borderRadius:6,fontSize:12}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span>Payment:</span><span>${payModal.amount.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',color:'#d97706'}}><span>CC Fee (2.9%):</span><span>+${(payModal.amount*CC_FEE_PCT).toFixed(2)}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',fontWeight:700,borderTop:'1px solid #e2e8f0',paddingTop:4,marginTop:4}}><span>Customer Total:</span><span>${(payModal.amount+payModal.amount*CC_FEE_PCT).toFixed(2)}</span></div>
          </div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setPayModal(null)}>Cancel</button>
          <button className="btn btn-primary" style={{background:'#166534'}} onClick={()=>{
            if(payModal.amount<=0){nf('Enter a valid amount','error');return}
            recordPayment(payModal.inv,payModal.amount,payModal.method,payModal.ref);
          }}>💰 Record ${payModal.amount.toLocaleString()}{payModal.method==='cc'?' + $'+(payModal.amount*CC_FEE_PCT).toFixed(2)+' fee':''}</button>
        </div>
      </div></div>}
    </>);
  };

  // REPORTS & ANALYTICS PAGE
  const[rptTab,setRptTab]=useState('overview');
  const[rptRep,setRptRep]=useState('all');
  const[rptWidgets,setRptWidgets]=useState({pipeline:true,repLeaderboard:true,custHealth:true,productMix:true,convFunnel:true,margins:true,seasonality:true,retention:true});
  const[commOverrides,setCommOverrides]=useState({});// {invoiceId: true} = admin approved full commission on late invoice
  const[commMonth,setCommMonth]=useState(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});
  const[commTab,setCommTab]=useState('statement');// statement, pipeline, ytd, byCustomer
  const toggleWidget=(k)=>setRptWidgets(w=>({...w,[k]:!w[k]}));

  const rReports=()=>{
    const soCalc=(so)=>{let rev=0,cost=0,units=0;const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});const af=safeArt(so);safeItems(so).forEach(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);units+=qty;rev+=qty*safeNum(it.unit_sell);cost+=qty*safeNum(it.nsa_cost);(it.decorations||[]).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp=dP(d,qty,af,cq);rev+=qty*dp.sell;cost+=qty*dp.cost});(it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco').forEach(pl=>{const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&k!=='unit_cost').reduce((a,[,v])=>a+v,0);cost+=poQty*safeNum(pl.unit_cost)})});return{rev,cost,margin:rev-cost,pct:rev>0?Math.round((rev-cost)/rev*100):0,units}};

    const filtSOs=rptRep==='all'?sos:sos.filter(s=>s.created_by===rptRep);
    const filtInvs=rptRep==='all'?invs:invs.filter(i=>{const so=sos.find(s=>s.id===i.so_id);return so?.created_by===rptRep});

    // Pipeline data
    const pipeline=filtSOs.map(so=>{const m=soCalc(so);const c=cust.find(x=>x.id===so.customer_id);const st=calcSOStatus(so);
      return{...so,_rev:m.rev,_cost:m.cost,_margin:m.margin,_pct:m.pct,_units:m.units,_cname:c?.name||'Unknown',_status:st}});
    const totalRev=pipeline.reduce((a,s)=>a+s._rev,0);
    const totalMargin=pipeline.reduce((a,s)=>a+s._margin,0);
    const totalUnits=pipeline.reduce((a,s)=>a+s._units,0);
    const avgMarginPct=totalRev>0?Math.round(totalMargin/totalRev*100):0;
    const avgOrderSize=pipeline.length>0?Math.round(totalRev/pipeline.length):0;

    // Rep leaderboard
    const repData=REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=>{
      const rSOs=sos.filter(s=>s.created_by===r.id);const rEsts=ests.filter(e=>e.created_by===r.id);
      const rev=rSOs.reduce((a,s)=>a+soCalc(s).rev,0);const margin=rSOs.reduce((a,s)=>a+soCalc(s).margin,0);
      const rInv=invs.filter(i=>{const so=sos.find(s=>s.id===i.so_id);return so?.created_by===r.id});
      const collected=rInv.filter(i=>i.status==='paid').reduce((a,i)=>a+i.paid,0);
      const openAR=rInv.filter(i=>i.status!=='paid').reduce((a,i)=>a+(i.total-i.paid),0);
      const uniqueCusts=[...new Set(rSOs.map(s=>s.customer_id))].length;
      const convRate=rEsts.length>0?Math.round(rSOs.filter(s=>s.estimate_id).length/Math.max(1,rEsts.filter(e=>e.status!=='draft').length)*100):0;
      return{...r,rev,margin,soCount:rSOs.length,estCount:rEsts.length,collected,openAR,uniqueCusts,convRate,pct:rev>0?Math.round(margin/rev*100):0};
    }).sort((a,b)=>b.rev-a.rev);

    // Customer health
    const custHealth=cust.filter(c=>c.id!=='c_deleted').map(c=>{
      const cSOs=sos.filter(s=>s.customer_id===c.id);const cInvs=invs.filter(i=>i.customer_id===c.id);
      const rev=cSOs.reduce((a,s)=>a+soCalc(s).rev,0);
      const lastSO=cSOs.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at))[0];
      const daysSince=lastSO?.created_at?Math.floor((new Date()-new Date(lastSO.created_at.replace(/(\d{2})\/(\d{2})\/(\d{2})/,'20$3-$1-$2')))/(86400000)):999;
      const openBal=cInvs.filter(i=>i.status!=='paid').reduce((a,i)=>a+(i.total-i.paid),0);
      const paidBal=cInvs.filter(i=>i.status==='paid').reduce((a,i)=>a+i.paid,0);
      const hasOpen=cSOs.some(s=>calcSOStatus(s)!=='complete');
      const health=daysSince<=14?'active':daysSince<=30?'warm':daysSince<=60?'cooling':'at_risk';
      return{...c,rev,soCount:cSOs.length,daysSince,openBal,paidBal,hasOpen,health,lastMemo:lastSO?.memo};
    }).sort((a,b)=>b.rev-a.rev);

    // Product mix
    const productMix={};
    filtSOs.forEach(so=>{safeItems(so).forEach(it=>{const k=it.sku||'Unknown';const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
      if(!productMix[k])productMix[k]={sku:k,name:it.name||k,brand:it.brand||'',rev:0,cost:0,units:0,soCount:0};
      productMix[k].rev+=qty*safeNum(it.unit_sell);productMix[k].cost+=qty*safeNum(it.nsa_cost);productMix[k].units+=qty;productMix[k].soCount++})});
    const topProducts=Object.values(productMix).sort((a,b)=>b.rev-a.rev).slice(0,10);

    // Conversion funnel
    const funnelEsts=rptRep==='all'?ests:ests.filter(e=>e.created_by===rptRep);
    const fDraft=funnelEsts.filter(e=>e.status==='draft').length;const fSent=funnelEsts.filter(e=>e.status==='sent').length;
    const fApproved=funnelEsts.filter(e=>e.status==='approved').length;const fConverted=filtSOs.filter(s=>s.estimate_id).length;

    const WH=({id,title,icon})=><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px'}}>
      <h2 style={{margin:0,fontSize:14}}>{icon} {title}</h2>
      <button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px'}} onClick={()=>toggleWidget(id)}>{rptWidgets[id]?'▼':'▶'}</button></div>;

    const Bar=({val,max,color})=><div style={{flex:1,background:'#e2e8f0',borderRadius:3,height:14,overflow:'hidden'}}>
      <div style={{height:14,borderRadius:3,background:color||'#3b82f6',width:max>0?(val/max*100)+'%':'0%',transition:'width 0.3s',display:'flex',alignItems:'center',justifyContent:'center'}}>
        {val/max>0.15&&<span style={{fontSize:8,color:'white',fontWeight:700}}>${(val/1000).toFixed(1)}k</span>}
      </div></div>;

    const healthColor={active:'#166534',warm:'#d97706',cooling:'#ea580c',at_risk:'#dc2626'};
    const healthBg={active:'#dcfce7',warm:'#fef3c7',cooling:'#ffedd5',at_risk:'#fecaca'};
    const healthLabel={active:'Active',warm:'Warm',cooling:'Cooling',at_risk:'At Risk'};

    return(<>
      {/* Report controls */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:4}}>
          {[['overview','📊 Overview'],['pipeline','💰 Pipeline'],['customers','👥 Customers'],['products','📦 Products'],['reps','🏆 Reps']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${rptTab===v?'btn-primary':'btn-secondary'}`} onClick={()=>setRptTab(v)}>{l}</button>)}
        </div>
        <select className="form-select" style={{width:140,fontSize:11}} value={rptRep} onChange={e=>setRptRep(e.target.value)}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <div style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>Toggle widgets to customize your view</div>
      </div>

      {/* KPI Bar */}
      <div className="stats-row" style={{marginBottom:16}}>
        <div className="stat-card"><div className="stat-label">Pipeline Revenue</div><div className="stat-value" style={{color:'#1e40af'}}>${(totalRev/1000).toFixed(1)}k</div></div>
        <div className="stat-card"><div className="stat-label">Total Margin</div><div className="stat-value" style={{color:'#166534'}}>${(totalMargin/1000).toFixed(1)}k <span style={{fontSize:12,color:avgMarginPct>=40?'#166534':'#d97706'}}>({avgMarginPct}%)</span></div></div>
        <div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#7c3aed'}}>{pipeline.filter(s=>s._status!=='complete').length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{totalUnits.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Order</div><div className="stat-value" style={{color:'#d97706'}}>${avgOrderSize.toLocaleString()}</div></div>
      </div>

      {/* OVERVIEW / PIPELINE TAB */}
      {(rptTab==='overview'||rptTab==='pipeline')&&<>
        {/* Conversion Funnel */}
        <div className="card" style={{marginBottom:12}}>
          <WH id="convFunnel" title="Estimate → SO Conversion Funnel" icon="🔄"/>
          {rptWidgets.convFunnel&&<div className="card-body">
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {[['Draft',fDraft,'#94a3b8'],['Sent',fSent,'#d97706'],['Approved',fApproved,'#22c55e'],['→ SO',fConverted,'#2563eb']].map(([label,val,color],i)=>
                <div key={i} style={{flex:1,textAlign:'center'}}>
                  <div style={{height:60,background:color+'20',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:4,
                    clipPath:i===0?'polygon(0 0,90% 0,100% 50%,90% 100%,0 100%)':i===3?'polygon(0 0,100% 0,100% 100%,0 100%,10% 50%)':'polygon(0 0,90% 0,100% 50%,90% 100%,0 100%,10% 50%)'}}>
                    <span style={{fontSize:24,fontWeight:900,color}}>{val}</span>
                  </div>
                  <div style={{fontSize:11,fontWeight:700,color}}>{label}</div>
                </div>)}
            </div>
            {funnelEsts.length>0&&<div style={{textAlign:'center',marginTop:8,fontSize:12,color:'#64748b'}}>
              Conversion rate: <strong style={{color:'#2563eb'}}>{Math.round(fConverted/Math.max(1,funnelEsts.length)*100)}%</strong> overall · 
              Sent→Approved: <strong>{fSent>0?Math.round(fApproved/fSent*100):0}%</strong></div>}
          </div>}
        </div>

        {/* Pipeline by Status */}
        <div className="card" style={{marginBottom:12}}>
          <WH id="pipeline" title="Pipeline by Status" icon="💰"/>
          {rptWidgets.pipeline&&<div className="card-body" style={{padding:0}}>
            <table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Revenue</th><th>Margin</th><th>Units</th><th>Status</th><th></th></tr></thead>
            <tbody>{pipeline.sort((a,b)=>b._rev-a._rev).map(s=>{
              const stLabel={need_order:'Need Order',waiting_receive:'Waiting',items_received:'Items In',in_production:'In Prod',ready_to_invoice:'Ready Inv',complete:'Complete'};
              return<tr key={s.id} style={{cursor:'pointer'}} onClick={()=>{setESO(sos.find(x=>x.id===s.id));setESOC(cust.find(c=>c.id===s.customer_id));setPg('orders')}}>
                <td style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{s.id}</td>
                <td style={{fontSize:12}}>{s._cname}</td>
                <td style={{fontSize:11,color:'#64748b',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.memo}</td>
                <td style={{fontWeight:700,textAlign:'right'}}>${s._rev.toLocaleString()}</td>
                <td style={{textAlign:'right',color:s._pct>=40?'#166534':'#d97706',fontWeight:600}}>${s._margin.toLocaleString()} <span style={{fontSize:9}}>({s._pct}%)</span></td>
                <td style={{textAlign:'center'}}>{s._units}</td>
                <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[s._status]?.bg,color:SC[s._status]?.c}}>{stLabel[s._status]||s._status}</span></td>
                <td style={{width:80}}><Bar val={s._rev} max={Math.max(...pipeline.map(p=>p._rev))} color={s._pct>=40?'#22c55e':'#f59e0b'}/></td>
              </tr>})}</tbody></table>
          </div>}
        </div>
      </>}

      {/* REP LEADERBOARD */}
      {(rptTab==='overview'||rptTab==='reps')&&<div className="card" style={{marginBottom:12}}>
        <WH id="repLeaderboard" title="Rep Leaderboard" icon="🏆"/>
        {rptWidgets.repLeaderboard&&<div className="card-body" style={{padding:0}}>
          <table><thead><tr><th>Rank</th><th>Rep</th><th>Revenue</th><th>Margin</th><th>SOs</th><th>Customers</th><th>Conv Rate</th><th>Collected</th><th>Open A/R</th><th></th></tr></thead>
          <tbody>{repData.map((r,i)=>
            <tr key={r.id} style={{background:i===0?'#fefce8':undefined}}>
              <td style={{fontWeight:800,color:i===0?'#d97706':i===1?'#64748b':'#cd7c32',fontSize:16,textAlign:'center'}}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
              <td style={{fontWeight:700}}>{r.name}</td>
              <td style={{fontWeight:700,color:'#1e40af',textAlign:'right'}}>${(r.rev/1000).toFixed(1)}k</td>
              <td style={{textAlign:'right',color:r.pct>=40?'#166534':'#d97706'}}>{r.pct}%</td>
              <td style={{textAlign:'center'}}>{r.soCount}</td>
              <td style={{textAlign:'center'}}>{r.uniqueCusts}</td>
              <td style={{textAlign:'center',fontWeight:600,color:r.convRate>=50?'#166534':'#d97706'}}>{r.convRate}%</td>
              <td style={{textAlign:'right',color:'#166534'}}>${r.collected.toLocaleString()}</td>
              <td style={{textAlign:'right',color:r.openAR>0?'#dc2626':'#94a3b8'}}>{r.openAR>0?'$'+r.openAR.toLocaleString():'—'}</td>
              <td style={{width:100}}><Bar val={r.rev} max={repData[0]?.rev||1} color={i===0?'#d97706':i===1?'#94a3b8':'#cd7c32'}/></td>
            </tr>)}</tbody></table>
        </div>}
      </div>}

      {/* CUSTOMER HEALTH */}
      {(rptTab==='overview'||rptTab==='customers')&&<div className="card" style={{marginBottom:12}}>
        <WH id="custHealth" title="Customer Health & Retention" icon="❤️"/>
        {rptWidgets.custHealth&&<div className="card-body">
          {/* Health summary bar */}
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            {['active','warm','cooling','at_risk'].map(h=>{const cnt=custHealth.filter(c=>c.health===h).length;
              return<div key={h} style={{flex:1,padding:8,background:healthBg[h],borderRadius:6,textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:healthColor[h]}}>{cnt}</div>
                <div style={{fontSize:10,fontWeight:600,color:healthColor[h]}}>{healthLabel[h]}</div>
              </div>})}
          </div>
          <table><thead><tr><th>Customer</th><th>Health</th><th>Revenue</th><th>Orders</th><th>Last Activity</th><th>Open Balance</th><th>Opportunity</th></tr></thead>
          <tbody>{custHealth.filter(c=>c.soCount>0||rptTab==='customers').map(c=>{
            const opp=c.health==='at_risk'?'🔴 Re-engage — '+c.daysSince+' days inactive':c.health==='cooling'?'🟠 Follow up — check on upcoming season':c.openBal>500?'🟡 Collect $'+c.openBal.toLocaleString():c.hasOpen?'🟢 Active order in progress':'🔵 Prospect for next season';
            return<tr key={c.id} style={{cursor:'pointer'}} onClick={()=>{setSelC(cust.find(cc=>cc.id===c.id));setPg('customers')}}>
              <td style={{fontWeight:700}}>{c.name} <span style={{fontSize:9,color:'#94a3b8'}}>{c.alpha_tag}</span></td>
              <td><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:healthBg[c.health],color:healthColor[c.health]}}>{healthLabel[c.health]}</span></td>
              <td style={{fontWeight:600,textAlign:'right'}}>${c.rev.toLocaleString()}</td>
              <td style={{textAlign:'center'}}>{c.soCount}</td>
              <td style={{fontSize:11,color:c.daysSince>30?'#dc2626':'#64748b'}}>{c.daysSince<999?c.daysSince+'d ago':'Never'}</td>
              <td style={{textAlign:'right',color:c.openBal>0?'#dc2626':'#94a3b8'}}>{c.openBal>0?'$'+c.openBal.toLocaleString():'—'}</td>
              <td style={{fontSize:11}}>{opp}</td>
            </tr>})}</tbody></table>
        </div>}
      </div>}

      {/* PRODUCT MIX */}
      {(rptTab==='overview'||rptTab==='products')&&<div className="card" style={{marginBottom:12}}>
        <WH id="productMix" title="Product Mix & Popularity" icon="📦"/>
        {rptWidgets.productMix&&<div className="card-body" style={{padding:0}}>
          <table><thead><tr><th>SKU</th><th>Product</th><th>Brand</th><th>Revenue</th><th>Cost</th><th>Margin</th><th>Units</th><th>SOs</th><th></th></tr></thead>
          <tbody>{topProducts.map(p=>{const pct=p.rev>0?Math.round((p.rev-p.cost)/p.rev*100):0;
            return<tr key={p.sku}>
              <td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{p.sku}</td>
              <td style={{fontSize:12}}>{p.name}</td>
              <td style={{fontSize:11,color:'#64748b'}}>{p.brand}</td>
              <td style={{fontWeight:700,textAlign:'right'}}>${p.rev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#64748b'}}>${p.cost.toLocaleString()}</td>
              <td style={{textAlign:'right',color:pct>=40?'#166534':'#d97706',fontWeight:600}}>{pct}%</td>
              <td style={{textAlign:'center',fontWeight:600}}>{p.units}</td>
              <td style={{textAlign:'center'}}>{p.soCount}</td>
              <td style={{width:100}}><Bar val={p.rev} max={topProducts[0]?.rev||1} color={pct>=40?'#22c55e':'#f59e0b'}/></td>
            </tr>})}</tbody></table>
        </div>}
      </div>}

      {/* MARGIN ANALYSIS */}
      {(rptTab==='overview'||rptTab==='pipeline')&&<div className="card" style={{marginBottom:12}}>
        <WH id="margins" title="Margin Analysis — Where to Improve" icon="📈"/>
        {rptWidgets.margins&&<div className="card-body">
          <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>Orders sorted by margin % — lowest first. Focus on improving pricing on low-margin orders.</div>
          {pipeline.filter(s=>s._rev>0).sort((a,b)=>a._pct-b._pct).slice(0,8).map(s=>
            <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid #f1f5f9'}}>
              <span style={{fontWeight:700,color:'#1e40af',fontSize:11,minWidth:56}}>{s.id}</span>
              <span style={{fontSize:11,flex:1}}>{s._cname} — {s.memo}</span>
              <div style={{width:120}}><Bar val={s._pct} max={100} color={s._pct>=40?'#22c55e':s._pct>=25?'#f59e0b':'#dc2626'}/></div>
              <span style={{fontSize:12,fontWeight:800,minWidth:36,textAlign:'right',color:s._pct>=40?'#166534':s._pct>=25?'#d97706':'#dc2626'}}>{s._pct}%</span>
            </div>)}
        </div>}
      </div>}
    </>);
  };

  // COMMISSIONS PAGE — visible only to admin and the logged-in rep
  const rCommissions=()=>{
    const isAdmin=cu.role==='admin';
    const salesReps=REPS.filter(r=>r.role==='rep'||r.role==='admin');
    // Admin sees all reps or picks one; rep only sees themselves
    const viewRepId=isAdmin?(commTab==='statement'||commTab==='pipeline'||commTab==='ytd'||commTab==='byCustomer'?q||'all':'all'):cu.id;

    // Gross profit calculator for an invoice
    // GP = Invoice Revenue − Garment Cost − Deco Cost − Outbound Shipping (ShipStation) − Inbound Freight (Supplier Bills)
    const calcGP=(inv)=>{
      const so=sos.find(s=>s.id===inv.so_id);
      if(!so)return{rev:inv.total||0,cost:0,gp:inv.total||0,shipRev:0,shipCost:0,inboundFreight:0};
      const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});
      const af=safeArt(so);let rev=0,cost=0;
      safeItems(so).forEach(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
        rev+=qty*safeNum(it.unit_sell);cost+=qty*safeNum(it.nsa_cost);
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);rev+=qty*dp2.sell;cost+=qty*dp2.cost});
        // Outside deco POs
        (it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco').forEach(pl=>{const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&k!=='unit_cost').reduce((a,[,v])=>a+v,0);cost+=poQty*safeNum(pl.unit_cost)});
      });
      // Shipping revenue (charged to customer)
      const shipRev=so.shipping_type==='pct'?rev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
      // Outbound shipping cost — placeholder for ShipStation (defaults $0)
      const shipCost=safeNum(so._shipstation_cost||0);
      // Inbound freight from supplier bills tied to SO (manual override field)
      const inboundFreight=safeNum(so._inbound_freight||0);
      const totalRev=rev+shipRev;const totalCost=cost+shipCost+inboundFreight;
      // Scale to invoice proportion (invoice may be partial payment of SO)
      const soTotal=totalRev||1;const scale=safeNum(inv.total)/soTotal;
      return{rev:inv.total,cost:Math.round(totalCost*scale*100)/100,gp:Math.round((inv.total-totalCost*scale)*100)/100,shipRev:Math.round(shipRev*scale*100)/100,shipCost:Math.round(shipCost*scale*100)/100,inboundFreight:Math.round(inboundFreight*scale*100)/100};
    };

    // Build commission line items from paid invoices
    // Commission: 30% of GP if paid within 90 days, 15% if paid after 90 days
    const buildCommLines=(repFilter)=>{
      return invs.filter(inv=>{
        if(inv.status!=='paid'&&inv.status!=='partial')return false;
        const so=sos.find(s=>s.id===inv.so_id);
        if(repFilter&&repFilter!=='all'){return so?.created_by===repFilter}
        return true;
      }).map(inv=>{
        const so=sos.find(s=>s.id===inv.so_id);
        const c=cust.find(x=>x.id===inv.customer_id);
        const rep=REPS.find(r=>r.id===so?.created_by);
        const gp=calcGP(inv);
        const invDate=new Date(inv.date);
        const paidDate=inv.payments?.length>0?new Date(inv.payments[inv.payments.length-1].date):null;
        const daysToPay=paidDate?Math.round((paidDate-invDate)/(1000*60*60*24)):null;
        const isLate=daysToPay!==null&&daysToPay>90;
        const overridden=commOverrides[inv.id]||false;
        const commRate=isLate&&!overridden?0.15:0.30;
        const commAmt=Math.round(gp.gp*commRate*100)/100;
        const paidAmt=inv.payments?.reduce((a,p)=>a+safeNum(p.amount),0)||0;
        const invMonth=inv.date?inv.date.substring(0,2)+'/'+inv.date.substring(6,8):'';// MM/YY
        const paidMonth=paidDate?(paidDate.getMonth()+1)+'/'+paidDate.getFullYear():'';
        return{inv,so,customer:c,rep,gp,daysToPay,isLate,overridden,commRate,commAmt,paidAmt,paidDate,invMonth,paidMonth,repId:so?.created_by};
      });
    };

    // Build pipeline from open/unpaid invoices
    const buildPipeline=(repFilter)=>{
      return invs.filter(inv=>{
        if(inv.status==='paid')return false;
        const so=sos.find(s=>s.id===inv.so_id);
        if(repFilter&&repFilter!=='all')return so?.created_by===repFilter;
        return true;
      }).map(inv=>{
        const so=sos.find(s=>s.id===inv.so_id);
        const c=cust.find(x=>x.id===inv.customer_id);
        const rep=REPS.find(r=>r.id===so?.created_by);
        const gp=calcGP(inv);
        const invDate=new Date(inv.date);
        const now=new Date();const daysOpen=Math.round((now-invDate)/(1000*60*60*24));
        const willBeLate=daysOpen>90;
        const expRate=willBeLate?0.15:0.30;
        const expComm=Math.round(gp.gp*expRate*100)/100;
        const balance=safeNum(inv.total)-safeNum(inv.paid);
        return{inv,so,customer:c,rep,gp,daysOpen,willBeLate,expRate,expComm,balance,repId:so?.created_by};
      });
    };

    const allLines=buildCommLines(isAdmin?q||'all':cu.id);
    const allPipeline=buildPipeline(isAdmin?q||'all':cu.id);

    // Filter by selected month for statement
    const monthLines=allLines.filter(l=>{
      if(!l.paidDate)return false;
      const ym=l.paidDate.getFullYear()+'-'+String(l.paidDate.getMonth()+1).padStart(2,'0');
      return ym===commMonth;
    });
    const monthTotal=monthLines.reduce((a,l)=>a+l.commAmt,0);
    const monthGP=monthLines.reduce((a,l)=>a+l.gp.gp,0);

    // YTD
    const yr=new Date().getFullYear();
    const ytdLines=allLines.filter(l=>l.paidDate&&l.paidDate.getFullYear()===yr);
    const ytdComm=ytdLines.reduce((a,l)=>a+l.commAmt,0);
    const ytdGP=ytdLines.reduce((a,l)=>a+l.gp.gp,0);
    const ytdRev=ytdLines.reduce((a,l)=>a+safeNum(l.inv.total),0);

    // By customer
    const byCust={};allLines.forEach(l=>{const cn=l.customer?.name||'Unknown';if(!byCust[cn])byCust[cn]={name:cn,gp:0,comm:0,invCount:0,rev:0};byCust[cn].gp+=l.gp.gp;byCust[cn].comm+=l.commAmt;byCust[cn].invCount++;byCust[cn].rev+=safeNum(l.inv.total)});
    const custList=Object.values(byCust).sort((a,b)=>b.comm-a.comm);

    // Monthly breakdown for YTD chart
    const monthlyData={};ytdLines.forEach(l=>{const m=String(l.paidDate.getMonth()+1).padStart(2,'0');if(!monthlyData[m])monthlyData[m]={month:m,gp:0,comm:0,count:0};monthlyData[m].gp+=l.gp.gp;monthlyData[m].comm+=l.commAmt;monthlyData[m].count++});
    const months=['01','02','03','04','05','06','07','08','09','10','11','12'];
    const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Pipeline total
    const pipeTotal=allPipeline.reduce((a,l)=>a+l.expComm,0);
    const pipeBalance=allPipeline.reduce((a,l)=>a+l.balance,0);

    return(<>
      {/* Header with rep selector (admin only) */}
      <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
        {isAdmin&&<><span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Rep:</span>
          <select className="form-select" style={{width:180}} value={q} onChange={e=>setQ(e.target.value)}>
            <option value="all">All Reps</option>
            {salesReps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select></>}
        <div style={{display:'flex',gap:4,marginLeft:isAdmin?'auto':0}}>
          {[['statement','Statement'],['pipeline','Pipeline'],['ytd','YTD'],['byCustomer','By Customer']].map(([id,label])=>
            <button key={id} className={`btn btn-sm ${commTab===id?'btn-primary':'btn-secondary'}`} onClick={()=>setCommTab(id)}>{label}</button>)}
        </div>
      </div>

      {/* Summary cards */}
      <div className="stats-row" style={{marginBottom:16}}>
        <div className="stat-card"><div className="stat-label">This Month</div><div className="stat-value" style={{color:'#166534'}}>${monthTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
        <div className="stat-card"><div className="stat-label">YTD Earned</div><div className="stat-value" style={{color:'#1e40af'}}>${ytdComm.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
        <div className="stat-card"><div className="stat-label">Pipeline</div><div className="stat-value" style={{color:'#7c3aed'}}>${pipeTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
        <div className="stat-card"><div className="stat-label">Avg GP%</div><div className="stat-value" style={{color:ytdRev>0&&(ytdGP/ytdRev*100)>=30?'#166534':'#d97706'}}>{ytdRev>0?Math.round(ytdGP/ytdRev*100):0}%</div></div>
      </div>

      {/* MONTHLY STATEMENT TAB */}
      {commTab==='statement'&&<div className="card">
        <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h2>Commission Statement</h2>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m-2,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9664;</button>
            <input type="month" className="form-input" style={{width:160}} value={commMonth} onChange={e=>setCommMonth(e.target.value)}/>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9654;</button>
          </div>
        </div>
        <div className="card-body" style={{padding:0}}>
          {monthLines.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No paid invoices this month</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Invoice</th><th>Customer</th>{isAdmin&&<th>Rep</th>}<th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Gross Profit</th><th style={{textAlign:'center'}}>Days</th><th style={{textAlign:'center'}}>Rate</th><th style={{textAlign:'right'}}>Commission</th>{isAdmin&&<th></th>}
          </tr></thead><tbody>
            {monthLines.map(l=><tr key={l.inv.id} style={{background:l.isLate&&!l.overridden?'#fef2f2':''}}>
              <td style={{fontWeight:700,color:'#1e40af'}}>{l.inv.id}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.date}</div></td>
              <td>{l.customer?.name||'\u2014'}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.memo}</div></td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{textAlign:'right'}}>${safeNum(l.inv.total).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.gp.cost.toLocaleString()}</td>
              <td style={{textAlign:'right',fontWeight:700,color:l.gp.gp>0?'#166534':'#dc2626'}}>${l.gp.gp.toLocaleString()}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.isLate?'#fee2e2':'#dcfce7',color:l.isLate?'#dc2626':'#166534'}}>{l.daysToPay??'\u2014'}d</span></td>
              <td style={{textAlign:'center',fontWeight:600,color:l.commRate===0.30?'#166534':'#d97706'}}>{Math.round(l.commRate*100)}%</td>
              <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:'#166534'}}>${l.commAmt.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td style={{textAlign:'center'}}>
                {l.isLate&&!l.overridden&&<button className="btn btn-sm" style={{fontSize:9,background:'#fef3c7',border:'1px solid #f59e0b',color:'#92400e',padding:'2px 6px'}} title="Approve full 30% commission" onClick={()=>setCommOverrides(p=>({...p,[l.inv.id]:true}))}>Full 30%</button>}
                {l.isLate&&l.overridden&&<span style={{fontSize:9,color:'#166534',fontWeight:700}}>Approved</span>}
              </td>}
            </tr>)}
            <tr style={{fontWeight:800,background:'#f0f9ff',borderTop:'2px solid #1e40af'}}>
              <td colSpan={isAdmin?3:2}>TOTAL</td>
              <td style={{textAlign:'right'}}>${monthLines.reduce((a,l)=>a+safeNum(l.inv.total),0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthLines.reduce((a,l)=>a+l.gp.cost,0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${monthGP.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td colSpan={2}></td>
              <td style={{textAlign:'right',fontSize:16,color:'#166534'}}>${monthTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>
          </tbody></table>}
        </div>
      </div>}

      {/* PIPELINE TAB */}
      {commTab==='pipeline'&&<div className="card">
        <div className="card-header"><h2>Expected Commissions — Open Invoices</h2><span style={{fontSize:12,color:'#64748b'}}>Outstanding: ${pipeBalance.toLocaleString()}</span></div>
        <div className="card-body" style={{padding:0}}>
          {allPipeline.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No open invoices</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Invoice</th><th>Customer</th>{isAdmin&&<th>Rep</th>}<th style={{textAlign:'right'}}>Balance</th><th style={{textAlign:'right'}}>Est. GP</th><th style={{textAlign:'center'}}>Days Open</th><th style={{textAlign:'center'}}>Est. Rate</th><th style={{textAlign:'right'}}>Expected Comm</th>
          </tr></thead><tbody>
            {allPipeline.sort((a,b)=>b.daysOpen-a.daysOpen).map(l=><tr key={l.inv.id} style={{background:l.willBeLate?'#fef2f2':l.daysOpen>60?'#fffbeb':''}}>
              <td style={{fontWeight:700,color:'#1e40af'}}>{l.inv.id}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.date}</div></td>
              <td>{l.customer?.name||'\u2014'}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.memo}</div></td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{textAlign:'right',fontWeight:600}}>${l.balance.toLocaleString()}</td>
              <td style={{textAlign:'right',color:l.gp.gp>0?'#166534':'#dc2626'}}>${l.gp.gp.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:600,background:l.willBeLate?'#fee2e2':l.daysOpen>60?'#fef3c7':'#dcfce7',color:l.willBeLate?'#dc2626':l.daysOpen>60?'#92400e':'#166534'}}>{l.daysOpen}d</span></td>
              <td style={{textAlign:'center',fontWeight:600,color:l.expRate===0.30?'#166534':'#d97706'}}>{Math.round(l.expRate*100)}%</td>
              <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>${l.expComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>)}
            <tr style={{fontWeight:800,background:'#f5f3ff',borderTop:'2px solid #7c3aed'}}>
              <td colSpan={isAdmin?3:2}>TOTAL PIPELINE</td>
              <td style={{textAlign:'right'}}>${pipeBalance.toLocaleString()}</td>
              <td style={{textAlign:'right'}}>${allPipeline.reduce((a,l)=>a+l.gp.gp,0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td colSpan={2}></td>
              <td style={{textAlign:'right',fontSize:16,color:'#7c3aed'}}>${pipeTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>
          </tbody></table>}
        </div>
      </div>}

      {/* YTD TAB */}
      {commTab==='ytd'&&<>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2>Year-to-Date — {yr}</h2></div>
          <div className="card-body">
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Total Revenue</div><div className="stat-value">${(ytdRev/1000).toFixed(1)}k</div></div>
              <div className="stat-card"><div className="stat-label">Total GP</div><div className="stat-value" style={{color:'#166534'}}>${(ytdGP/1000).toFixed(1)}k</div></div>
              <div className="stat-card"><div className="stat-label">Commission Earned</div><div className="stat-value" style={{color:'#1e40af'}}>${ytdComm.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
              <div className="stat-card"><div className="stat-label">Invoices Paid</div><div className="stat-value">{ytdLines.length}</div></div>
            </div>
            {/* Monthly bar chart */}
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Monthly Breakdown</div>
              <div style={{display:'flex',gap:4,alignItems:'flex-end',height:120}}>
                {months.map((m,mi)=>{const d=monthlyData[m];const maxC=Math.max(1,...Object.values(monthlyData).map(x=>x.comm));const h=d?Math.max(4,d.comm/maxC*100):4;
                  return<div key={m} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                    {d&&<span style={{fontSize:9,color:'#166534',fontWeight:700}}>${Math.round(d.comm)}</span>}
                    <div style={{width:'100%',height:h,background:d?'#3b82f6':'#e2e8f0',borderRadius:3,transition:'height 0.3s'}}/>
                    <span style={{fontSize:9,color:'#94a3b8'}}>{monthNames[mi]}</span>
                  </div>})}
              </div>
            </div>
          </div>
        </div>
        {/* YTD detail table */}
        {isAdmin&&<div className="card">
          <div className="card-header"><h2>Rep Leaderboard — YTD</h2></div>
          <div className="card-body" style={{padding:0}}>
            <table style={{fontSize:12}}><thead><tr><th>Rep</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>GP</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'right'}}>Commission</th><th style={{textAlign:'center'}}>Invoices</th></tr></thead><tbody>
              {salesReps.filter(r=>r.role==='rep'||r.role==='admin').map(r=>{
                const rLines=ytdLines.filter(l=>l.repId===r.id);
                const rRev=rLines.reduce((a,l)=>a+safeNum(l.inv.total),0);
                const rGP=rLines.reduce((a,l)=>a+l.gp.gp,0);
                const rComm=rLines.reduce((a,l)=>a+l.commAmt,0);
                return<tr key={r.id}><td style={{fontWeight:700}}>{r.name}</td>
                  <td style={{textAlign:'right'}}>${rRev.toLocaleString()}</td>
                  <td style={{textAlign:'right',color:'#166534'}}>${rGP.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                  <td style={{textAlign:'center'}}>{rRev>0?Math.round(rGP/rRev*100):0}%</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#1e40af'}}>${rComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                  <td style={{textAlign:'center'}}>{rLines.length}</td></tr>})}
            </tbody></table>
          </div>
        </div>}
      </>}

      {/* BY CUSTOMER TAB */}
      {commTab==='byCustomer'&&<div className="card">
        <div className="card-header"><h2>Commission by Customer</h2></div>
        <div className="card-body" style={{padding:0}}>
          {custList.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No commission data</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Customer</th><th style={{textAlign:'center'}}>Invoices</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Gross Profit</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'right'}}>Commission</th>
          </tr></thead><tbody>
            {custList.map(c=><tr key={c.name}>
              <td style={{fontWeight:700}}>{c.name}</td>
              <td style={{textAlign:'center'}}>{c.invCount}</td>
              <td style={{textAlign:'right'}}>${c.rev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${c.gp.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:c.rev>0&&c.gp/c.rev>=0.3?'#dcfce7':'#fef3c7',color:c.rev>0&&c.gp/c.rev>=0.3?'#166534':'#92400e'}}>{c.rev>0?Math.round(c.gp/c.rev*100):0}%</span></td>
              <td style={{textAlign:'right',fontWeight:800,color:'#166534'}}>${c.comm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>)}
            <tr style={{fontWeight:800,background:'#f0f9ff',borderTop:'2px solid #1e40af'}}>
              <td>TOTAL</td>
              <td style={{textAlign:'center'}}>{custList.reduce((a,c)=>a+c.invCount,0)}</td>
              <td style={{textAlign:'right'}}>${custList.reduce((a,c)=>a+c.rev,0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${custList.reduce((a,c)=>a+c.gp,0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td></td>
              <td style={{textAlign:'right',fontSize:14,color:'#166534'}}>${custList.reduce((a,c)=>a+c.comm,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>
          </tbody></table>}
        </div>
      </div>}

      {/* Commission policy note */}
      <div style={{marginTop:16,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',fontSize:11,color:'#64748b'}}>
        <strong>Commission Policy:</strong> 30% of gross profit on invoices paid within 90 days of invoice date. 15% on invoices paid after 90 days (50% penalty). Admin may click to restore full 30% on any late invoice. Gross profit = Revenue &minus; Product Cost &minus; Decoration Cost &minus; Outbound Shipping (ShipStation, default $0) &minus; Inbound Freight (Supplier Bills, manual override until integration live).
      </div>
    </>);
  };

  // OMG TEAM STORES PAGE
  const rOMG=()=>{
    const stores=D_OMG;
    const filtered=stores.filter(s=>{
      if(omgFilter.rep!=='all'&&s.rep_id!==omgFilter.rep)return false;
      if(omgFilter.status!=='all'&&s.status!==omgFilter.status)return false;
      if(omgFilter.search){const q=omgFilter.search.toLowerCase();const c=cust.find(x=>x.id===s.customer_id);
        if(!(s.store_name+' '+s.id+' '+(c?.name||'')+' '+(c?.alpha_tag||'')).toLowerCase().includes(q))return false}
      return true;
    });
    const totalSales=filtered.reduce((a,s)=>a+s.total_sales,0);
    const totalFund=filtered.reduce((a,s)=>a+s.fundraise_total,0);
    const totalOrders=filtered.reduce((a,s)=>a+s.orders,0);

    // Store detail view
    if(omgSel){
      const s=omgSel;const c=cust.find(x=>x.id===s.customer_id);const rep=REPS.find(r=>r.id===s.rep_id);
      const totalCost=s.products.reduce((a,p)=>{const q=Object.values(p.sizes).reduce((a2,v)=>a2+v,0);return a+q*(p.cost+p.deco_cost)},0);
      const totalRetail=s.products.reduce((a,p)=>{const q=Object.values(p.sizes).reduce((a2,v)=>a2+v,0);return a+q*p.retail},0);
      const margin=totalRetail-totalCost;const pct=totalRetail>0?Math.round(margin/totalRetail*100):0;

      return(<>
        <button className="btn btn-sm btn-secondary" onClick={()=>setOmgSel(null)} style={{marginBottom:12}}>← Back to All Stores</button>

        <div className="card" style={{marginBottom:12}}><div style={{padding:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:20,fontWeight:800}}>{s.store_name}</div>
              <div style={{fontSize:13,color:'#64748b'}}>{c?.name} ({c?.alpha_tag}) · Rep: {rep?.name} · {s.id}</div>
              <div style={{marginTop:4}}><span style={{padding:'3px 10px',borderRadius:8,fontSize:11,fontWeight:700,
                background:s.status==='open'?'#dcfce7':s.status==='closed'?'#dbeafe':s.status==='draft'?'#f1f5f9':'#fef3c7',
                color:s.status==='open'?'#166534':s.status==='closed'?'#1e40af':s.status==='draft'?'#64748b':'#92400e'}}>{s.status.toUpperCase()}</span>
                {s.open_date&&<span style={{marginLeft:8,fontSize:11,color:'#64748b'}}>📅 {s.open_date} → {s.close_date}</span>}
              </div>
            </div>
            {s.status==='closed'&&!sos.some(so=>so.omg_store_id===s.id)&&<button className="btn btn-primary" style={{background:'#166534'}} onClick={()=>{
              // PULL FROM OMG → Create SO
              if(sos.some(so=>so.omg_store_id===s.id)){nf('Already pulled — SO exists for this store','error');return}
              const newItems=s.products.map(p=>{
                const catP=prod.find(cp=>cp.sku===p.sku);
                return{product_id:catP?.id||null,sku:p.sku,name:p.name,brand:catP?.brand||'',color:p.color,
                  nsa_cost:p.cost,retail_price:catP?.retail_price||p.retail,unit_sell:p.retail,
                  available_sizes:Object.keys(p.sizes),sizes:p.sizes,
                  decorations:[{kind:'art',position:'Front Center',art_file_id:null,deco_type:p.deco_type,sell_override:null,cost_override:p.deco_cost}],
                  is_custom:false,pick_lines:[],po_lines:[]};
              });
              const newSO={id:uid('SO-'),customer_id:s.customer_id,memo:'OMG Store Pull: '+s.store_name,status:'need_order',
                created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),
                expected_date:'',production_notes:'Pulled from OMG store '+s.id+'. Orders: '+s.orders+', Buyers: '+s.unique_buyers,
                shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:[],art_files:[],items:newItems,omg_store_id:s.id};
              setSOs(prev=>[newSO,...prev]);setESO(newSO);setESOC(c);setPg('orders');
              nf('🎉 Pulled '+newItems.length+' items from '+s.store_name+' into new SO');
            }}>🔄 Pull to Sales Order</button>}
            {s.status==='closed'&&sos.some(so=>so.omg_store_id===s.id)&&<div style={{padding:'6px 12px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534',fontWeight:600}}>
              ✅ Already pulled → {sos.find(so=>so.omg_store_id===s.id)?.id}</div>}
          </div>
        </div></div>

        <div className="stats-row" style={{marginBottom:12}}>
          <div className="stat-card"><div className="stat-label">Orders</div><div className="stat-value">{s.orders}</div></div>
          <div className="stat-card"><div className="stat-label">Total Sales</div><div className="stat-value" style={{color:'#1e40af'}}>${s.total_sales.toLocaleString()}</div></div>
          <div className="stat-card"><div className="stat-label">Fundraise</div><div className="stat-value" style={{color:'#166534'}}>${s.fundraise_total.toLocaleString()}</div></div>
          <div className="stat-card"><div className="stat-label">NSA Cost</div><div className="stat-value" style={{color:'#d97706'}}>${totalCost.toLocaleString()}</div></div>
          <div className="stat-card"><div className="stat-label">Margin</div><div className="stat-value" style={{color:pct>=30?'#166534':'#dc2626'}}>{pct}%</div></div>
        </div>

        <div className="card" style={{marginBottom:12}}><div className="card-header"><h2>📦 Store Products</h2></div>
          <div className="card-body" style={{padding:0}}>
            <table><thead><tr><th>SKU</th><th>Product</th><th>Color</th><th>Deco</th><th>Retail</th><th>Cost</th><th>Deco $</th><th>Sizes</th><th>Units</th><th>Revenue</th><th>Margin</th></tr></thead>
            <tbody>{s.products.map((p,i)=>{const q=Object.values(p.sizes).reduce((a,v)=>a+v,0);const rev=q*p.retail;const cost=q*(p.cost+p.deco_cost);const mg=rev-cost;
              const catP=prod.find(cp=>cp.sku===p.sku);
              return<tr key={i}>
                <td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku} {catP&&<span style={{fontSize:8,color:'#22c55e'}}>✓</span>}</td>
                <td>{p.name}</td><td style={{fontSize:11}}>{p.color}</td>
                <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:p.deco_type==='screen_print'?'#dbeafe':'#ede9fe',
                  color:p.deco_type==='screen_print'?'#1e40af':'#6d28d9'}}>{p.deco_type.replace(/_/g,' ')}</span></td>
                <td style={{textAlign:'right'}}>${p.retail}</td><td style={{textAlign:'right'}}>${p.cost}</td><td style={{textAlign:'right'}}>${p.deco_cost}</td>
                <td style={{fontSize:9}}>{Object.entries(p.sizes).map(([sz,q2])=>sz+':'+q2).join(' ')}</td>
                <td style={{fontWeight:700,textAlign:'center'}}>{q}</td>
                <td style={{textAlign:'right',fontWeight:600}}>${rev.toLocaleString()}</td>
                <td style={{textAlign:'right',color:mg>0?'#166534':'#dc2626'}}>${mg.toLocaleString()} <span style={{fontSize:9}}>({Math.round(mg/rev*100)}%)</span></td>
              </tr>})}</tbody></table>
          </div>
        </div>

        {/* Step-by-step guide */}
        <div className="card" style={{borderLeft:'3px solid #2563eb'}}><div className="card-header"><h2>📋 OMG Store Pull Process — Step by Step</h2></div>
          <div className="card-body">
            <div style={{display:'grid',gap:12}}>
              {[
                {n:1,title:'Store Closes in OMG',desc:'Wait for the store close date. All orders are finalized and no more changes can be made.',icon:'🔒'},
                {n:2,title:'Review Store Data',desc:'Click into the store above to verify all products, sizes, quantities, and pricing. Check that fundraise amounts are correct.',icon:'👀'},
                {n:3,title:'Pull to Sales Order',desc:'Click "🔄 Pull to Sales Order" button. This creates a new SO with all items, sizes, deco already filled in. Cost and sell prices carry over from the store.',icon:'📋'},
                {n:4,title:'Review the New SO',desc:'The SO opens automatically. Verify items, update any pricing, add art files, and adjust shipping. Products matched to the catalog show ✓.',icon:'✏️'},
                {n:5,title:'Create POs for Inventory',desc:'Go to each item and create Purchase Orders for any blanks not in stock. Use Batch PO for efficiency.',icon:'🛒'},
                {n:6,title:'Production & Decoration',desc:'Once items are received, send jobs to the Production Board. Art should already be assigned from the store setup.',icon:'🏭'},
                {n:7,title:'Invoice & Ship',desc:'After production is complete, create invoice from the SO and arrange shipping to the customer.',icon:'📦'},
              ].map(step=><div key={step.n} style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:36,height:36,borderRadius:18,background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,color:'#1e40af',flexShrink:0,fontSize:14}}>{step.n}</div>
                <div><div style={{fontWeight:700,fontSize:13}}>{step.icon} {step.title}</div><div style={{fontSize:12,color:'#64748b'}}>{step.desc}</div></div>
              </div>)}
            </div>
          </div>
        </div>
      </>);
    }

    return(<>
      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <div className="search-bar" style={{flex:1,maxWidth:300}}><Icon name="search"/><input placeholder="Search stores..." value={omgFilter.search} onChange={e=>setOmgFilter(x=>({...x,search:e.target.value}))}/></div>
        <select className="form-select" style={{width:130,fontSize:11}} value={omgFilter.rep} onChange={e=>setOmgFilter(x=>({...x,rep:e.target.value}))}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <div style={{display:'flex',gap:4}}>
          {[['all','All'],['open','Open'],['closed','Closed'],['draft','Draft']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${omgFilter.status===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOmgFilter(x=>({...x,status:v}))}>{l}</button>)}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row" style={{marginBottom:12}}>
        <div className="stat-card"><div className="stat-label">Total Stores</div><div className="stat-value">{filtered.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Sales</div><div className="stat-value" style={{color:'#1e40af'}}>${(totalSales/1000).toFixed(1)}k</div></div>
        <div className="stat-card"><div className="stat-label">Fundraised</div><div className="stat-value" style={{color:'#166534'}}>${(totalFund/1000).toFixed(1)}k</div></div>
        <div className="stat-card"><div className="stat-label">Orders</div><div className="stat-value">{totalOrders}</div></div>
        <div className="stat-card"><div className="stat-label">Open Now</div><div className="stat-value" style={{color:'#d97706'}}>{filtered.filter(s=>s.status==='open').length}</div></div>
      </div>

      {/* Store cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:12}}>
        {filtered.map(s=>{const c=cust.find(x=>x.id===s.customer_id);const rep=REPS.find(r=>r.id===s.rep_id);
          return<div key={s.id} className="card hover-card" style={{cursor:'pointer',border:s.status==='open'?'2px solid #22c55e':undefined}} onClick={()=>setOmgSel(s)}>
            <div style={{padding:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <div style={{fontSize:14,fontWeight:800}}>{s.store_name}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{c?.name} · {rep?.name?.split(' ')[0]}</div>
                </div>
                <span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:700,
                  background:s.status==='open'?'#dcfce7':s.status==='closed'?'#dbeafe':'#f1f5f9',
                  color:s.status==='open'?'#166534':s.status==='closed'?'#1e40af':'#94a3b8'}}>{s.status}</span>
              </div>
              {s.open_date&&<div style={{fontSize:10,color:'#94a3b8',marginBottom:8}}>📅 {s.open_date} → {s.close_date}</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                <div style={{textAlign:'center',padding:6,background:'#f8fafc',borderRadius:4}}>
                  <div style={{fontSize:16,fontWeight:800,color:'#1e40af'}}>${s.total_sales.toLocaleString()}</div><div style={{fontSize:9,color:'#64748b'}}>Sales</div></div>
                <div style={{textAlign:'center',padding:6,background:'#f0fdf4',borderRadius:4}}>
                  <div style={{fontSize:16,fontWeight:800,color:'#166534'}}>{s.orders}</div><div style={{fontSize:9,color:'#64748b'}}>Orders</div></div>
                <div style={{textAlign:'center',padding:6,background:'#fef3c7',borderRadius:4}}>
                  <div style={{fontSize:16,fontWeight:800,color:'#92400e'}}>${s.fundraise_total.toLocaleString()}</div><div style={{fontSize:9,color:'#64748b'}}>Fundraised</div></div>
              </div>
              <div style={{marginTop:6,fontSize:10,color:'#64748b'}}>{s.products.length} products · {s.items_sold} items sold · {s.unique_buyers} buyers</div>
              {s.status==='closed'&&!sos.some(so=>so.omg_store_id===s.id)&&<div style={{marginTop:6,padding:4,background:'#fef3c7',borderRadius:4,fontSize:10,color:'#92400e',fontWeight:600,textAlign:'center'}}>
                ⚠️ Ready to pull — not yet converted to SO</div>}
              {sos.some(so=>so.omg_store_id===s.id)&&<div style={{marginTop:6,padding:4,background:'#dcfce7',borderRadius:4,fontSize:10,color:'#166534',fontWeight:600,textAlign:'center'}}>
                ✅ Pulled → {sos.find(so=>so.omg_store_id===s.id)?.id}</div>}
            </div>
          </div>})}
      </div>
    </>);
  };

  // WAREHOUSE DASHBOARD
  const[whTab,setWhTab]=useState('pull');const[whSearch,setWhSearch]=useState('');const[whRepF,setWhRepF]=useState('all');
  const[stockPOs,setStockPOs]=useState([
    {id:'PO-5001-NSA',vendor_id:'v1',vendor_name:'Adidas',status:'partial',created_at:'02/12/26',notes:'Restock pregame tees',items:[{sku:'JX4453',name:'Adidas Unisex Pregame Tee',color:'Team Power Red/White',sizes:{S:20,M:30,L:25,XL:15,'2XL':10},received:{S:20,M:30,L:0,XL:0,'2XL':0}}]},
    {id:'PO-5002-NSA',vendor_id:'v2',vendor_name:'Under Armour',status:'waiting',created_at:'02/18/26',notes:'Stock up on polos for spring',items:[{sku:'1370399',name:'Under Armour Team Polo',color:'Cardinal/White',sizes:{S:10,M:20,L:20,XL:15,'2XL':8},received:{}}]},
  ]);const[showStockPO,setShowStockPO]=useState(null);const[stockPOCounter,setStockPOCounter]=useState(5003);
  const[decoSearch,setDecoSearch]=useState('');const[decoRepF,setDecoRepF]=useState('all');const[decoStatF,setDecoStatF]=useState('active');const[decoTypeF,setDecoTypeF]=useState('all');

  // Shared data builder for warehouse + deco pages
  const buildWarehouseData=()=>{
    const pullTasks=[];const shipTasks=[];const decoTasks=[];
    sos.filter(so=>{const st=calcSOStatus(so);return st!=='complete'}).forEach(so=>{
      const c=cust.find(x=>x.id===so.customer_id);const cName=c?.name||'Unknown';const alpha=c?.alpha_tag||'';
      const rep=REPS.find(r=>r.id===so.created_by)?.name?.split(' ')[0]||'—';
      const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
      const urgent=daysOut!=null&&daysOut<=3;

      safeItems(so).forEach((item,ii)=>{
        const szKeys=Object.keys(item.sizes||{}).filter(k=>SZ_ORD.includes(k)||(item.sizes[k]>0));
        const totalOrdered=szKeys.reduce((a,s)=>a+(item.sizes[s]||0),0);
        if(totalOrdered===0)return;
        const picks=safePicks(item);
        const pulled={};picks.forEach(pk=>{szKeys.forEach(s=>{pulled[s]=(pulled[s]||0)+(pk[s]||0)})});
        const totalPulled=Object.values(pulled).reduce((a,v)=>a+v,0);
        // Only show in Pull & Stage if there's an active pick ticket (IF not yet pulled)
        const hasActivePick=picks.some(pk=>pk.status!=='pulled');
        if(hasActivePick){
          const needsPull=totalOrdered-totalPulled;
          if(needsPull>0){
            pullTasks.push({so,soId:so.id,item,itemIdx:ii,cName,alpha,rep,daysOut,urgent,
              sku:item.sku,name:item.name,brand:item.brand||'',color:item.color||'',
              sizes:item.sizes,pulled,needsPull,totalOrdered,totalPulled,szKeys,
              noDeco:item.no_deco||!item.decorations?.length,
              shipDest:picks.find(p=>p.ship_dest)?.ship_dest||'in_house'});
          }
        }
        // No-deco items fully pulled → ready to ship
        if((!item.decorations?.length||item.no_deco)&&totalPulled>=totalOrdered&&totalOrdered>0){
          const dest=picks.find(p=>p.ship_dest)?.ship_dest||'in_house';
          shipTasks.push({so,soId:so.id,type:'no_deco',cName,alpha,rep,daysOut,urgent,
            desc:item.sku+' · '+item.name,units:totalOrdered,shipMethod:dest});
        }
      });
      // Completed deco jobs → ready to ship
      safeJobs(so).forEach(j=>{
        if(j.prod_status==='completed'){
          shipTasks.push({so,soId:so.id,type:'deco_done',cName,alpha,rep,daysOut,urgent,
            desc:j.art_name+' ('+j.deco_type?.replace(/_/g,' ')+')',units:j.total_units,
            shipMethod:j.ship_method||'pending'});
        }
        // Deco tasks
        if(j.prod_status!=='completed'&&j.prod_status!=='shipped'){
          const isReady=j.art_status==='art_complete'&&j.item_status==='items_received';
          decoTasks.push({so,soId:so.id,job:j,cName,alpha,rep,daysOut,urgent,
            artName:j.art_name,decoType:j.deco_type,totalUnits:j.total_units,fulfilledUnits:j.fulfilled_units,
            prodStatus:j.prod_status,artStatus:j.art_status,itemStatus:j.item_status,isReady,
            machine:MACHINES.find(m=>m.id===j.assigned_machine)?.name,assignedTo:j.assigned_to});
        }
      });
    });
    const sortU=(a,b)=>{if(a.urgent&&!b.urgent)return -1;if(!a.urgent&&b.urgent)return 1;return(a.daysOut||999)-(b.daysOut||999)};
    pullTasks.sort(sortU);shipTasks.sort(sortU);decoTasks.sort(sortU);
    return{pullTasks,shipTasks,decoTasks};
  };

  const rWarehouse=()=>{
    const{pullTasks,shipTasks}=buildWarehouseData();
    const filt=(arr)=>arr.filter(t=>{
      if(whRepF!=='all'&&t.so?.created_by!==whRepF)return false;
      if(whSearch){const s=whSearch.toLowerCase();
        if(!(t.cName||'').toLowerCase().includes(s)&&!(t.sku||'').toLowerCase().includes(s)&&
          !(t.soId||'').toLowerCase().includes(s)&&!(t.desc||'').toLowerCase().includes(s))return false}
      return true;
    });
    const fPull=filt(pullTasks);const fShip=filt(shipTasks);
    const openStockPOs=stockPOs.filter(p=>p.status!=='received');
    const tabs=[
      {id:'pull',label:'🏗️ Pull & Stage',count:fPull.length,color:'#d97706'},
      {id:'ship',label:'📦 Ready to Ship',count:fShip.length,color:'#166534'},
      {id:'stockpo',label:'📋 Stock POs',count:openStockPOs.length,color:'#6366f1'},
    ];

    return(<>
      {/* Stats */}
      <div className="stats-row" style={{marginBottom:12}}>
        <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}>
          <div className="stat-label">To Pull</div>
          <div className="stat-value" style={{color:'#d97706'}}>{pullTasks.length}</div>
          <div style={{fontSize:10,color:'#94a3b8'}}>{pullTasks.reduce((a,t)=>a+t.needsPull,0)} units</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}>
          <div className="stat-label">Ready to Ship</div>
          <div className="stat-value" style={{color:'#166534'}}>{shipTasks.length}</div>
          <div style={{fontSize:10,color:'#94a3b8'}}>{shipTasks.reduce((a,t)=>a+t.units,0)} units</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #dc2626'}}>
          <div className="stat-label">Rush (≤3 days)</div>
          <div className="stat-value" style={{color:'#dc2626'}}>{pullTasks.filter(t=>t.urgent).length+shipTasks.filter(t=>t.urgent).length}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <input className="form-input" placeholder="Search SO#, customer, SKU..." value={whSearch}
          onChange={e=>setWhSearch(e.target.value)} style={{width:220}}/>
        <select className="form-select" style={{width:140,fontSize:11}} value={whRepF} onChange={e=>setWhRepF(e.target.value)}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div style={{display:'flex',gap:2,marginLeft:'auto'}}>
          {tabs.map(t=><button key={t.id} className={`btn btn-sm ${whTab===t.id?'btn-primary':'btn-secondary'}`}
            style={{background:whTab===t.id?t.color:'',borderColor:whTab===t.id?t.color:''}}
            onClick={()=>setWhTab(t.id)}>{t.label} ({t.count})</button>)}
        </div>
      </div>

      {/* ── PULL & STAGE ── */}
      {whTab==='pull'&&<>
        {fPull.length===0?<div className="empty" style={{padding:32,textAlign:'center'}}>Nothing to pull right now 👍</div>:
        <div className="card"><div className="card-body" style={{padding:0}}>
          <table style={{fontSize:11}}><thead><tr>
            <th style={{width:20}}></th><th>SO#</th><th>Customer</th><th>SKU</th><th>Item</th>
            <th style={{textAlign:'center'}}>Need</th><th style={{textAlign:'center'}}>On Hand</th><th>Sizes to Pull</th><th>Rep</th><th style={{width:60}}></th>
          </tr></thead><tbody>
          {fPull.map((t,ti)=><tr key={ti} style={{cursor:'pointer',background:t.urgent?'#fef2f2':'',borderLeft:t.urgent?'3px solid #dc2626':''}}
            onClick={()=>{setESOTab('items');setESOScrollItem(t.itemIdx);setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
            <td>{t.urgent&&<span title={'Due in '+t.daysOut+'d'}>🔥</span>}{t.noDeco&&<span title="No decoration">📦</span>}</td>
            <td style={{fontWeight:700,color:'#1e40af',whiteSpace:'nowrap'}}>{t.soId}</td>
            <td style={{fontWeight:600,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.cName}</td>
            <td style={{fontFamily:'monospace',fontWeight:700,fontSize:10,color:'#475569'}}>{t.sku}</td>
            <td style={{fontSize:10,color:'#64748b',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.name}{t.color?' · '+t.color:''}</td>
            <td style={{textAlign:'center',fontWeight:800,color:'#d97706'}}>{t.needsPull}</td>
            <td style={{textAlign:'center'}}>{(()=>{const p=prod.find(pp=>pp.sku===t.sku);if(!p||!p._inv)return<span style={{color:'#cbd5e1'}}>—</span>;
              const total=Object.values(p._inv).reduce((a,v)=>a+(typeof v==='number'?v:0),0);
              return<span style={{fontWeight:700,color:total>=t.needsPull?'#166534':total>0?'#d97706':'#dc2626'}}>{total}</span>})()}</td>
            <td><div style={{display:'flex',gap:2,flexWrap:'wrap'}}>
              {t.szKeys.filter(s=>(t.sizes[s]||0)-(t.pulled[s]||0)>0).map(s=>{const need=(t.sizes[s]||0)-(t.pulled[s]||0);
                return<span key={s} style={{padding:'1px 4px',borderRadius:3,fontSize:9,fontWeight:700,
                  background:'#fef3c7',color:'#92400e',whiteSpace:'nowrap'}}>{s}:{need}</span>})}
            </div></td>
            <td style={{fontSize:10,color:'#94a3b8'}}>{t.rep}</td>
            <td><button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px'}}
              onClick={e=>{e.stopPropagation();setESOTab('items');setESOScrollItem(t.itemIdx);setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
              Pick →</button></td>
          </tr>)}
          </tbody></table>
        </div></div>}
      </>}

      {/* ── READY TO SHIP ── */}
      {whTab==='ship'&&<>
        {fShip.length===0?<div className="empty" style={{padding:32,textAlign:'center'}}>Nothing ready to ship right now</div>:<>
        {/* Group by customer for combining boxes */}
        {(()=>{
          const byCustomer={};
          fShip.forEach(t=>{
            const key=t.cName+'|'+(t.shipMethod||'pending');
            if(!byCustomer[key])byCustomer[key]={cName:t.cName,shipMethod:t.shipMethod,items:[],totalUnits:0,soIds:new Set()};
            byCustomer[key].items.push(t);byCustomer[key].totalUnits+=t.units;byCustomer[key].soIds.add(t.soId);
          });
          return<div style={{display:'grid',gap:10}}>
            {Object.values(byCustomer).map((grp,gi)=><div key={gi} className="card" style={{borderLeft:'3px solid #166534'}}>
              <div style={{padding:'10px 14px'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{fontSize:14,fontWeight:800}}>{grp.cName}</span>
                  <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,
                    background:grp.shipMethod==='ship_customer'?'#dbeafe':grp.shipMethod==='rep_delivery'?'#dcfce7':grp.shipMethod==='customer_pickup'?'#fef3c7':'#fef2f2',
                    color:grp.shipMethod==='ship_customer'?'#1e40af':grp.shipMethod==='rep_delivery'?'#166534':grp.shipMethod==='customer_pickup'?'#92400e':'#dc2626'}}>
                    {grp.shipMethod==='ship_customer'?'📦 Ship':grp.shipMethod==='rep_delivery'?'🚗 Rep Delivery':grp.shipMethod==='customer_pickup'?'🏫 Pickup':'⚠️ Not set'}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{[...grp.soIds].join(', ')}</span>
                  <span style={{marginLeft:'auto',fontSize:12,fontWeight:800,color:'#166534'}}>{grp.totalUnits} units</span>
                  <span style={{fontSize:10,color:'#64748b'}}>{grp.items.length} item{grp.items.length!==1?'s':''}</span>
                </div>
                <table style={{fontSize:11,width:'100%'}}><tbody>
                  {grp.items.map((t,ti)=><tr key={ti} style={{cursor:'pointer',borderBottom:'1px solid #f1f5f9'}}
                    onClick={()=>{setESOTab(null);setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
                    <td style={{padding:'4px 0',fontWeight:700,color:'#1e40af',whiteSpace:'nowrap',width:80}}>{t.soId}</td>
                    <td style={{fontSize:10,color:'#475569'}}>{t.desc}</td>
                    <td style={{textAlign:'center',fontWeight:700,width:50}}>{t.units}</td>
                    <td style={{width:40}}>{t.urgent&&<span>🔥</span>}</td>
                  </tr>)}
                </tbody></table>
                <div style={{display:'flex',gap:6,marginTop:8,borderTop:'1px solid #e2e8f0',paddingTop:6}}>
                  <input className="form-input" placeholder="Scan SKU to verify..." style={{flex:1,fontSize:11,padding:'4px 8px'}}
                    onKeyDown={e=>{if(e.key==='Enter'){
                      const sku=e.target.value.trim().toUpperCase();
                      const match=grp.items.find(t=>(t.desc||'').toUpperCase().includes(sku)||(t.soId||'').toUpperCase().includes(sku));
                      if(match)nf('✅ Verified: '+sku+' found in '+match.soId);
                      else nf('❌ '+sku+' not found in this shipment','error');
                      e.target.value='';
                    }}}/>
                  <button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'4px 10px'}}
                    onClick={()=>{
                      printDoc({
                        title:grp.cName,docNum:grp.items.map(t=>t.soId).filter((v,i,a)=>a.indexOf(v)===i).join(', '),
                        docType:'PACKING SLIP',showPricing:false,
                        headerRight:'<div style="font-size:14px;font-weight:700;color:#166534">'+grp.totalUnits+' Total Units</div><div style="font-size:11px;color:#666">Ship: '+(grp.shipMethod||'TBD')+'</div>',
                        infoBoxes:[
                          {label:'Ship To',value:grp.cName,sub:grp.items[0]?.so?.ship_to_id==='default'?'Default address on file':'Custom address'},
                          {label:'Ship Date',value:new Date().toLocaleDateString(),sub:'Method: '+(grp.shipMethod||'Ground')},
                        ],
                        tables:[{
                          title:'Items in this Shipment',
                          headers:['SO#','Item','Units','Type'],
                          aligns:['left','left','center','left'],
                          rows:grp.items.map(t=>({cells:[t.soId,t.desc,t.units,t.type==='deco_done'?'Decorated':'Plain']}))
                        }],
                        notes:'Please inspect all items upon receipt. Report any discrepancies within 48 hours.',
                        footer:'NO PRICING — Customer Copy'
                      });
                      nf('📦 Packing slip printed for '+grp.cName);
                    }}>🖨️ Pack Slip</button>
                  <button className="btn btn-sm" style={{fontSize:10,background:'#1e40af',color:'white',border:'none',padding:'4px 10px'}}
                    onClick={()=>{nf('📦 Marked shipped for '+grp.cName)}}>✓ Ship</button>
                </div>
              </div>
            </div>)}
          </div>})()}
        </>}
      </>}

      {/* ── STOCK POs ── */}
      {whTab==='stockpo'&&<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:13,color:'#64748b'}}>Purchase orders for NSA warehouse stock (not tied to a sales order)</div>
          <button className="btn btn-sm btn-primary" style={{background:'#6366f1',borderColor:'#6366f1'}} onClick={()=>setShowStockPO({vendor_id:'',items:[{sku:'',name:'',color:'',sizes:{S:0,M:0,L:0,XL:0,'2XL':0}}],notes:''})}>+ New Stock PO</button>
        </div>
        {stockPOs.length===0?<div className="empty" style={{padding:32,textAlign:'center'}}>No stock POs yet</div>:
        <div style={{display:'grid',gap:10}}>
          {stockPOs.map((po,pi)=>{
            const totalOrd=po.items.reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((a2,v)=>a2+v,0),0);
            const totalRcvd=po.items.reduce((a,it)=>a+Object.values(it.received||{}).reduce((a2,v)=>a2+v,0),0);
            const st=po.status==='received'?'received':totalRcvd>0?'partial':'waiting';
            return<div key={pi} className="card" style={{borderLeft:'3px solid '+(st==='received'?'#166534':st==='partial'?'#d97706':'#6366f1')}}>
              <div style={{padding:'12px 16px'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{fontFamily:'monospace',fontWeight:900,fontSize:15,color:'#6366f1'}}>{po.id}</span>
                  <span className="badge" style={{background:st==='received'?'#dcfce7':st==='partial'?'#fef3c7':'#eef2ff',color:st==='received'?'#166534':st==='partial'?'#92400e':'#4338ca',fontWeight:700,fontSize:10}}>{st==='received'?'Received':st==='partial'?totalRcvd+'/'+totalOrd+' Received':'Waiting'}</span>
                  <span style={{fontSize:11,color:'#94a3b8'}}>{po.vendor_name}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{po.created_at}</span>
                  <span style={{marginLeft:'auto',fontWeight:800,fontSize:13}}>{totalOrd} units</span>
                </div>
                {po.notes&&<div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{po.notes}</div>}
                <table style={{fontSize:11,width:'100%'}}><thead><tr style={{background:'#f8fafc'}}>
                  <th style={{padding:'4px 6px',textAlign:'left'}}>SKU</th><th style={{textAlign:'left'}}>Item</th><th style={{textAlign:'left'}}>Color</th>
                  {['S','M','L','XL','2XL'].map(sz=><th key={sz} style={{textAlign:'center',width:40}}>{sz}</th>)}
                  <th style={{textAlign:'center',width:50}}>Total</th>
                </tr></thead><tbody>
                  {po.items.map((it,ii)=>{const itTotal=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
                    return<tr key={ii} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'4px 6px',fontFamily:'monospace',fontWeight:700}}>{it.sku}</td>
                      <td style={{fontSize:10}}>{it.name}</td>
                      <td style={{fontSize:10,color:'#64748b'}}>{it.color||'—'}</td>
                      {['S','M','L','XL','2XL'].map(sz=>{const ord=it.sizes?.[sz]||0;const rcvd=(it.received||{})[sz]||0;
                        return<td key={sz} style={{textAlign:'center',fontWeight:700,fontSize:10,
                          color:ord===0?'#d1d5db':rcvd>=ord?'#166534':rcvd>0?'#d97706':'#475569',
                          background:rcvd>=ord&&ord>0?'#dcfce7':rcvd>0?'#fef3c7':''}}>
                          {ord===0?'—':rcvd>0?rcvd+'/'+ord:ord}</td>})}
                      <td style={{textAlign:'center',fontWeight:800}}>{itTotal}</td>
                    </tr>})}
                </tbody></table>
                {st!=='received'&&<div style={{display:'flex',gap:6,marginTop:8,borderTop:'1px solid #e2e8f0',paddingTop:6}}>
                  <button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'4px 10px'}}
                    onClick={()=>{setStockPOs(prev=>prev.map((p,i)=>i===pi?{...p,status:'received',items:p.items.map(it=>({...it,received:{...it.sizes}}))}:p));nf('✓ Marked '+po.id+' fully received')}}>✓ Mark All Received</button>
                  <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>{
                    const updated=prompt('Enter received sizes (e.g. S:5,M:10,L:8)');if(!updated)return;
                    const rcvd={};updated.split(',').forEach(p=>{const[sz,v]=p.trim().split(':');if(sz&&v)rcvd[sz.trim()]=parseInt(v)||0});
                    setStockPOs(prev=>prev.map((p,i)=>i===pi?{...p,status:'partial',items:p.items.map((it,ii)=>ii===0?{...it,received:{...(it.received||{}),...rcvd}}:it)}:p));
                    nf('Updated received quantities for '+po.id);
                  }}>Partial Receive</button>
                </div>}
              </div>
            </div>})}
        </div>}

        {/* Stock PO Create Modal */}
        {showStockPO&&<div className="modal-overlay" onClick={()=>setShowStockPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
          <div className="modal-header" style={{background:'#eef2ff'}}><h2>📋 New Stock PO</h2><button className="modal-close" onClick={()=>setShowStockPO(null)}>×</button></div>
          <div className="modal-body">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              <div><label className="form-label">Vendor *</label><select className="form-select" value={showStockPO.vendor_id} onChange={e=>{const v=D_V.find(x=>x.id===e.target.value);setShowStockPO(x=>({...x,vendor_id:e.target.value,vendor_name:v?.name||''}))}}>
                <option value="">Select vendor...</option>{D_V.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
              <div><label className="form-label">Notes</label><input className="form-input" value={showStockPO.notes||''} onChange={e=>setShowStockPO(x=>({...x,notes:e.target.value}))} placeholder="Restock reason..."/></div>
            </div>
            <label className="form-label">Items</label>
            {(showStockPO.items||[]).map((it,ii)=>{
              const vProds=showStockPO.vendor_id?prod.filter(p=>p.vendor_id===showStockPO.vendor_id):prod;
              return<div key={ii} style={{padding:8,background:'#f8fafc',borderRadius:6,marginBottom:6}}>
                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                  <select className="form-select" style={{flex:1,fontSize:11}} value={it.sku||''} onChange={e=>{const p=prod.find(x=>x.sku===e.target.value);setShowStockPO(x=>({...x,items:x.items.map((xi,xii)=>xii===ii?{...xi,sku:p?.sku||e.target.value,name:p?.name||'',color:p?.color||'',sizes:Object.fromEntries((p?.available_sizes||['S','M','L','XL','2XL']).map(s=>[s,0]))}:xi)}))}}>
                    <option value="">Select product...</option>{vProds.map(p=><option key={p.id} value={p.sku}>{p.sku} — {p.name}</option>)}</select>
                  <input className="form-input" value={it.color||''} onChange={e=>setShowStockPO(x=>({...x,items:x.items.map((xi,xii)=>xii===ii?{...xi,color:e.target.value}:xi)}))} placeholder="Color" style={{width:120,fontSize:11}}/>
                  {(showStockPO.items||[]).length>1&&<button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}} onClick={()=>setShowStockPO(x=>({...x,items:x.items.filter((_,xii)=>xii!==ii)}))}>×</button>}
                </div>
                {it.sku&&<div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                  {Object.keys(it.sizes||{}).map(sz=><div key={sz} style={{textAlign:'center'}}>
                    <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <input className="form-input" type="number" min="0" value={it.sizes[sz]||0} onChange={e=>setShowStockPO(x=>({...x,items:x.items.map((xi,xii)=>xii===ii?{...xi,sizes:{...xi.sizes,[sz]:parseInt(e.target.value)||0}}:xi)}))} style={{width:44,textAlign:'center',fontSize:12,fontWeight:700,padding:'3px 2px'}}/>
                  </div>)}
                </div>}
              </div>})}
            <button className="btn btn-sm btn-secondary" style={{marginTop:4}} onClick={()=>setShowStockPO(x=>({...x,items:[...x.items,{sku:'',name:'',color:'',sizes:{S:0,M:0,L:0,XL:0,'2XL':0}}]}))}>+ Add Item</button>
            <div style={{marginTop:12,display:'flex',gap:8}}>
              <button className="btn btn-primary" style={{background:'#6366f1',borderColor:'#6366f1'}} onClick={()=>{
                if(!showStockPO.vendor_id){nf('Select a vendor','error');return}
                const validItems=showStockPO.items.filter(it=>it.sku&&Object.values(it.sizes||{}).some(v=>v>0));
                if(validItems.length===0){nf('Add at least one item with quantities','error');return}
                const poId='PO-'+stockPOCounter+'-NSA';
                const newPO={id:poId,vendor_id:showStockPO.vendor_id,vendor_name:showStockPO.vendor_name||D_V.find(v=>v.id===showStockPO.vendor_id)?.name||'',
                  status:'waiting',created_at:new Date().toLocaleDateString(),notes:showStockPO.notes||'',
                  items:validItems.map(it=>({sku:it.sku,name:it.name,color:it.color||'',sizes:{...it.sizes},received:{}}))};
                setStockPOs(prev=>[newPO,...prev]);setStockPOCounter(c=>c+1);setShowStockPO(null);
                nf('📋 Created '+poId+' — '+validItems.length+' item'+(validItems.length>1?'s':''));
              }}>Create PO</button>
              <button className="btn btn-secondary" onClick={()=>setShowStockPO(null)}>Cancel</button>
            </div>
          </div>
        </div></div>}
      </>}
    </>);
  };

  // DECORATION DASHBOARD (separate from warehouse)
  const rDeco=()=>{
    const{decoTasks}=buildWarehouseData();
    const filt=(arr)=>arr.filter(t=>{
      if(decoRepF!=='all'&&t.so?.created_by!==decoRepF)return false;
      if(decoSearch){const s=decoSearch.toLowerCase();
        if(!(t.cName||'').toLowerCase().includes(s)&&!(t.artName||'').toLowerCase().includes(s)&&
          !(t.soId||'').toLowerCase().includes(s))return false}
      return true;
    });
    const active=decoTasks.filter(t=>t.prodStatus!=='completed'&&t.prodStatus!=='shipped');
    const completed=decoTasks.filter(t=>t.prodStatus==='completed');
    const list=decoStatF==='active'?filt(active):decoStatF==='completed'?filt(completed):filt(decoTasks);
    const readyCount=active.filter(t=>t.isReady).length;
    const inProcessCount=active.filter(t=>t.prodStatus==='in_process').length;
    const waitingCount=active.filter(t=>!t.isReady).length;
    const allDecoTypes=[...new Set(decoTasks.map(t=>t.decoType).filter(Boolean))];
    const filtered=decoTypeF==='all'?list:list.filter(t=>t.decoType===decoTypeF);

    return(<>
      {/* Stats */}
      <div className="stats-row" style={{marginBottom:12}}>
        <div className="stat-card" style={{borderLeft:'3px solid #22c55e'}}>
          <div className="stat-label">Ready to Go</div>
          <div className="stat-value" style={{color:'#166534'}}>{readyCount}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}>
          <div className="stat-label">In Process</div>
          <div className="stat-value" style={{color:'#2563eb'}}>{inProcessCount}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}>
          <div className="stat-label">Waiting (Art/Items)</div>
          <div className="stat-value" style={{color:'#d97706'}}>{waitingCount}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}>
          <div className="stat-label">Total Active</div>
          <div className="stat-value" style={{color:'#7c3aed'}}>{active.length}</div>
          <div style={{fontSize:10,color:'#94a3b8'}}>{active.reduce((a,t)=>a+t.totalUnits,0)} units</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:2}}>
          {[['active','Active'],['completed','Done'],['all','All']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${decoStatF===v?'btn-primary':'btn-secondary'}`}
              onClick={()=>setDecoStatF(v)}>{l}</button>)}
        </div>
        <select className="form-select" style={{width:140,fontSize:11}} value={decoTypeF} onChange={e=>setDecoTypeF(e.target.value)}>
          <option value="all">All Deco Types</option>{allDecoTypes.map(d=><option key={d} value={d}>{d.replace(/_/g,' ')}</option>)}
        </select>
        <select className="form-select" style={{width:140,fontSize:11}} value={decoRepF} onChange={e=>setDecoRepF(e.target.value)}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input className="form-input" placeholder="Search..." value={decoSearch}
          onChange={e=>setDecoSearch(e.target.value)} style={{width:180}}/>
        <button className="btn btn-sm btn-secondary" style={{marginLeft:'auto'}} onClick={()=>setPg('production')}>
          Full Prod Board →</button>
      </div>

      {/* Active Timers & Time Log Summary */}
      {(Object.keys(activeTimers).length>0||jobTimeLogs.length>0)&&<div className="card" style={{marginBottom:12,borderLeft:'3px solid #f59e0b'}}>
        <div style={{padding:'10px 14px'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#92400e',marginBottom:6}}>⏱️ Time Tracking</div>
          {Object.keys(activeTimers).length>0&&<div style={{marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:600,color:'#166534',marginBottom:4}}>ACTIVE NOW:</div>
            {Object.entries(activeTimers).map(([key,timer])=>{
              const[soId,jobId]=key.split('|');const mins=Math.round((Date.now()-timer.clockIn)/60000);
              return<div key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',fontSize:11}}>
                <span style={{width:8,height:8,borderRadius:4,background:'#22c55e',animation:'pulse 2s infinite'}}/> 
                <span style={{fontWeight:700}}>{timer.person}</span>
                <span style={{color:'#64748b'}}>on {jobId} ({soId})</span>
                <span style={{marginLeft:'auto',fontWeight:700,color:'#d97706'}}>{mins}m</span>
              </div>})}
          </div>}
          {jobTimeLogs.length>0&&<div>
            <div style={{fontSize:10,fontWeight:600,color:'#64748b',marginBottom:4}}>RECENT LOGS:</div>
            {jobTimeLogs.slice(-5).reverse().map((log,i)=><div key={i} style={{display:'flex',gap:8,fontSize:10,color:'#475569',padding:'2px 0'}}>
              <span style={{fontWeight:600}}>{log.person}</span>
              <span>{log.jobId}</span>
              <span style={{color:'#94a3b8'}}>{log.clockOut}</span>
              <span style={{marginLeft:'auto',fontWeight:700,color:'#7c3aed'}}>{log.minutes}m</span>
            </div>)}
            <div style={{fontSize:10,color:'#64748b',marginTop:4,borderTop:'1px solid #f1f5f9',paddingTop:4}}>
              Total logged: <strong>{jobTimeLogs.reduce((a,l)=>a+l.minutes,0)} min</strong> ({(jobTimeLogs.reduce((a,l)=>a+l.minutes,0)/60).toFixed(1)} hrs)
            </div>
          </div>}
        </div>
      </div>}

      {/* Job Cards */}
      {filtered.length===0?<div className="empty" style={{padding:32,textAlign:'center'}}>No decoration jobs match your filters</div>:
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:8}}>
        {filtered.map((t,ti)=>{
          const pct=t.totalUnits>0?Math.round(t.fulfilledUnits/t.totalUnits*100):0;
          return<div key={ti} className="card" style={{
            border:t.isReady?'2px solid #22c55e':t.urgent?'2px solid #dc2626':'1px solid #e2e8f0',
            background:t.isReady?'#f0fdf4':t.prodStatus==='in_process'?'#eff6ff':'white',cursor:'pointer'}}
            onClick={()=>{setESOTab('jobs');setESO(t.so);setESOC(cust.find(c2=>c2.id===t.so.customer_id));setPg('orders')}}>
            <div style={{padding:'10px 12px'}}>
              {/* Header row */}
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                {t.urgent&&<span style={{fontSize:9,fontWeight:800,color:'#dc2626',background:'#fef2f2',padding:'1px 5px',borderRadius:3}}>🔥 {t.daysOut}d</span>}
                {t.isReady&&!t.urgent&&<span style={{fontSize:9,fontWeight:800,color:'#166534',background:'#dcfce7',padding:'1px 5px',borderRadius:3}}>✅ READY</span>}
                <span style={{fontSize:13,fontWeight:800,color:'#1e293b',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.cName}</span>
                <span style={{fontSize:10,color:'#94a3b8'}}>{t.soId}</span>
              </div>
              {/* Art + deco info */}
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>{t.artName}</span>
                <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                  background:t.decoType==='embroidery'?'#f3e8ff':t.decoType==='screen_print'?'#dbeafe':t.decoType==='dtf'?'#fef3c7':'#f1f5f9',
                  color:t.decoType==='embroidery'?'#6b21a8':t.decoType==='screen_print'?'#1e40af':t.decoType==='dtf'?'#92400e':'#475569'}}>
                  {t.decoType?.replace(/_/g,' ')}</span>
              </div>
              {/* Status badges */}
              <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>
                <span style={{padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:SC[t.artStatus]?.bg,color:SC[t.artStatus]?.c}}>
                  {t.artStatus==='art_complete'?'✅ Art':'⏳ Art'}</span>
                <span style={{padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:SC[t.itemStatus]?.bg,color:SC[t.itemStatus]?.c}}>
                  {t.itemStatus==='items_received'?'✅ Items':'⏳ Items'}</span>
                <span style={{padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:SC[t.prodStatus]?.bg,color:SC[t.prodStatus]?.c}}>
                  {t.prodStatus==='hold'?'⏸ Hold':t.prodStatus==='staging'?'📋 In Line':t.prodStatus==='in_process'?'🖨️ Running':'✓ '+t.prodStatus}</span>
                {t.machine&&<span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:4,background:'#fef3c7',color:'#92400e'}}>🖨️ {t.machine}</span>}
                {t.assignedTo&&<span style={{fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:4,background:'#ede9fe',color:'#6d28d9'}}>👤 {t.assignedTo}</span>}
              </div>
              {/* Progress */}
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,fontWeight:800,color:pct>=100?'#166534':'#7c3aed'}}>{t.fulfilledUnits}/{t.totalUnits}</span>
                <div style={{flex:1,background:'#e2e8f0',borderRadius:3,height:4,overflow:'hidden'}}>
                  <div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%'}}/></div>
                <span style={{fontSize:9,color:'#64748b'}}>{pct}%</span>
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{t.rep}</span>
              </div>
            </div>
          </div>})}
      </div>}
    </>);
  };

  // NETSUITE IMPORT PAGE
  const[imp,setImp]=useState({step:'upload',raw:'',docType:'so',custId:'',parsed:[],decoLines:[],issues:[],questions:[],shipping:[],memo:'',poRef:''});
  const SZ_ORD_I=['XXS','XS','YXS','YS','YM','YL','YXL','S','M','L','XL','2XL','3XL','4XL','5XL','OSFA'];

  const parseNSData=(raw)=>{
    const lines=raw.trim().split('\
').filter(l=>l.trim());
    const items={};const decoLines=[];const issues=[];const shipping=[];const questions=[];
    const SZ_RE=/[-\s](XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|YXS|YS|YM|YL|YXL|OSFA)$/i;

    lines.forEach((line,li)=>{
      const cols=line.split('\	').map(c=>c.trim());
      if(cols.length<3){if(line.trim().length>5)issues.push({line:li+1,msg:'Could not parse: "'+line.slice(0,80)+'"'});return}
      const rawItem=cols[0]||'';const desc=cols[1]||'';const qty=parseInt(cols[2])||0;
      const priceLevel=cols[3]||'';const rate=parseFloat(cols[4])||0;const amount=parseFloat(cols[5])||0;
      const poRef=cols[6]||'';const onHand=cols[7]!==undefined?parseInt(cols[7]):null;

      if(rawItem.toUpperCase()==='ITEM'||desc.toUpperCase()==='DESCRIPTION')return;
      if(rawItem.toLowerCase().includes('shipping')||desc.toLowerCase().includes('shipping')){shipping.push({desc,amount,rate});return}
      if(/^(screen\s*print|embroid|dtf|heat\s*trans|vinyl|sublim)/i.test(desc)||rawItem.toLowerCase().includes('screen')||rawItem.toLowerCase().includes('embroid')){
        decoLines.push({rawItem,desc,qty,rate,amount,poRef,_assignTo:'all'});return}

      const skuParts=rawItem.split(/\s*:\s*/);const itemCode=skuParts[0]||rawItem;
      const fullSku=skuParts[1]||itemCode;
      const sizeMatch=fullSku.match(SZ_RE);
      let baseSku,size;
      if(sizeMatch){
        size=sizeMatch[1].toUpperCase();
        baseSku=fullSku.replace(SZ_RE,'').replace(/-$/,'').trim();
        if(!baseSku)baseSku=itemCode.replace(SZ_RE,'').replace(/-$/,'').trim();
      } else {baseSku=itemCode;size=null}

      let color='';
      if(size){const cM=desc.match(/[-–]\s*([A-Za-z\s\/]+?)\s*[-–]\s*(?:XXS|XS|S|M|L|XL|2XL|3XL|4XL)/i);if(cM)color=cM[1].trim()}
      if(!color){const cM2=desc.match(/[-–]\s*([A-Za-z\s\/,]+?)$/);if(cM2&&!sizeMatch)color=cM2[1].trim()}

      let brand='';
      if(priceLevel.toLowerCase().includes('adidas'))brand='Adidas';
      else if(priceLevel.toLowerCase().includes('under armour')||priceLevel.toLowerCase().includes('ua'))brand='Under Armour';
      else if(priceLevel.toLowerCase().includes('nike'))brand='Nike';
      else if(priceLevel.toLowerCase().includes('richardson'))brand='Richardson';
      else if(desc.toLowerCase().includes('adidas'))brand='Adidas';
      else if(desc.toLowerCase().includes('under armour'))brand='Under Armour';

      // Try to match to existing product catalog
      const catMatch=prod.find(p=>p.sku===baseSku)||(baseSku.length>3?prod.find(p=>p.sku.toLowerCase()===baseSku.toLowerCase()):null);

      if(size&&baseSku){
        if(!items[baseSku])items[baseSku]={sku:baseSku,name:catMatch?.name||desc.replace(/\s*[-–]\s*[A-Za-z\s\/]+?\s*[-–]\s*\w+$/,'').trim(),
          brand:catMatch?.brand||brand,color:color||catMatch?.color||'',rate,sizes:{},totalQty:0,totalAmt:0,poRef,priceLevel,
          catMatch:catMatch||null,is_custom:!catMatch&&(baseSku.toLowerCase().includes('misc')||priceLevel.toLowerCase()==='custom'),issues:[],onHand:null};
        items[baseSku].sizes[size]=(items[baseSku].sizes[size]||0)+qty;
        items[baseSku].totalQty+=qty;items[baseSku].totalAmt+=amount;
        if(onHand!==null)items[baseSku].onHand=onHand;
        if(color&&!items[baseSku].color)items[baseSku].color=color;
      } else {
        const embSizes={};let m;const sr=/(\d+)\s*\/\s*(S|M|L|XL|2XL|3XL|4XL|XXS|XS|YS|YM|YL|YXL)/gi;
        while((m=sr.exec(desc))!==null)embSizes[m[2].toUpperCase()]=parseInt(m[1]);
        const hasSz=Object.keys(embSizes).length>0;
        const key=baseSku+'_'+li;
        items[key]={sku:catMatch?.sku||baseSku,name:catMatch?.name||desc,brand:catMatch?.brand||brand,color,rate,
          sizes:hasSz?embSizes:{OSFA:qty},totalQty:qty,totalAmt:amount,poRef,priceLevel,
          catMatch:catMatch||null,is_custom:!catMatch,
          issues:hasSz?['Sizes parsed from description — verify']:['Could not detect sizes — entered as bulk qty']};
      }
    });

    const parsed=Object.values(items);

    // Generate questions for ambiguous items
    parsed.forEach((it,i)=>{
      if(!it.catMatch&&!it.is_custom)questions.push({idx:i,type:'match',msg:`"${it.sku}" not found in catalog. Is this a known product or a custom/special order?`,options:['match_catalog','custom','skip'],answer:null});
      if(it.is_custom&&it.sku==='Misc Adi')questions.push({idx:i,type:'sku',msg:`Custom item "${it.name.slice(0,50)}..." — do you know the real SKU?`,answer:''});
      if(!it.color)questions.push({idx:i,type:'color',msg:`What color is "${it.sku} — ${it.name.slice(0,40)}"?`,answer:''});
    });

    return{parsed,decoLines,issues,questions,shipping};
  };

  // Customer detection from text
  const detectCustomer=(text)=>{
    const lower=text.toLowerCase();
    return cust.find(c=>{
      if(c.alpha_tag&&lower.includes(c.alpha_tag.toLowerCase()))return true;
      if(c.name&&lower.includes(c.name.toLowerCase()))return true;
      return c.contacts?.some(ct=>ct.name&&lower.includes(ct.name.toLowerCase()));
    });
  };

  const rImport=()=>{

    const applyAnswer=(qi,val)=>setImp(x=>({...x,questions:x.questions.map((q,i)=>i===qi?{...q,answer:val}:q)}));
    const updItem=(pi,k,v)=>setImp(x=>({...x,parsed:x.parsed.map((p,i)=>i===pi?{...p,[k]:v}:p)}));

    return(<>
      {/* Step indicators */}
      <div style={{display:'flex',gap:4,marginBottom:16}}>
        {[['upload','1. Upload / Paste'],['review','2. Review Items'],['questions','3. Answer Questions'],['confirm','4. Confirm & Create']].map(([id,label])=>
          <div key={id} style={{flex:1,padding:'8px 12px',borderRadius:6,textAlign:'center',fontSize:11,fontWeight:700,
            background:imp.step===id?'#1e40af':'#f1f5f9',color:imp.step===id?'white':'#64748b'}}>{label}</div>)}
      </div>

      {/* STEP 1: Upload */}
      {imp.step==='upload'&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {/* Left: upload area */}
          <div className="card"><div className="card-header"><h2>?? Upload PDF or Paste Data</h2></div>
            <div className="card-body">
              <div style={{marginBottom:12}}>
                <label className="form-label">Document Type</label>
                <div style={{display:'flex',gap:4}}>
                  {[['so','Sales Order'],['est','Estimate'],['po','Purchase Order']].map(([v,l])=>
                    <button key={v} className={`btn btn-sm ${imp.docType===v?'btn-primary':'btn-secondary'}`} onClick={()=>setImp(x=>({...x,docType:v}))}>{l}</button>)}
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <label className="form-label">Upload PDF <span style={{fontSize:10,color:'#94a3b8'}}>(coming soon — use paste for now)</span></label>
                <div style={{padding:24,border:'2px dashed #d1d5db',borderRadius:8,textAlign:'center',color:'#94a3b8',fontSize:12}}>
                  ?? Drag & drop PDF here or click to browse<br/>
                  <span style={{fontSize:10}}>NetSuite PDF export or printed SO/Estimate</span>
                </div>
              </div>
              <div>
                <label className="form-label">Or paste tab-separated data from NetSuite</label>
                <textarea className="form-input" rows={10} value={imp.raw} onChange={e=>{
                  const v=e.target.value;setImp(x=>({...x,raw:v}));
                  // Auto-detect customer
                  if(v.length>20&&!imp.custId){const det=detectCustomer(v);if(det)setImp(x=>({...x,custId:det.id}))}
                }} placeholder="Copy lines from NetSuite (ITEM → INVOICED columns) and paste here..." style={{fontFamily:'monospace',fontSize:10,whiteSpace:'pre'}}/>
              </div>
            </div>
          </div>

          {/* Right: customer + settings */}
          <div className="card"><div className="card-header"><h2>?? Customer & Settings</h2></div>
            <div className="card-body">
              <div style={{marginBottom:12}}>
                <label className="form-label">Customer {imp.custId&&<span style={{color:'#22c55e',fontSize:10}}>✓ Detected</span>}</label>
                <select className="form-select" value={imp.custId} onChange={e=>setImp(x=>({...x,custId:e.target.value}))}>
                  <option value="">Select customer...</option>
                  {cust.filter(c=>c.is_active!==false).map(c=><option key={c.id} value={c.id}>{c.name} ({c.alpha_tag})</option>)}
                </select>
              </div>
              {imp.custId&&(()=>{const c=cust.find(x=>x.id===imp.custId);if(!c)return null;
                return<div style={{padding:10,background:'#f0fdf4',borderRadius:6,marginBottom:12}}>
                  <div style={{fontWeight:700}}>{c.name} <span className="badge badge-gray">{c.alpha_tag}</span></div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                    Tier {c.adidas_ua_tier} · {c.catalog_markup}x markup · {c.payment_terms}
                    {c.primary_rep_id&&<> · Rep: {REPS.find(r=>r.id===c.primary_rep_id)?.name}</>}
                  </div>
                </div>})()}
              <div style={{marginBottom:12}}>
                <label className="form-label">Order Memo / Description</label>
                <input className="form-input" value={imp.memo} onChange={e=>setImp(x=>({...x,memo:e.target.value}))} placeholder="e.g. Spring Football 2026 — from NS SO#12345"/>
              </div>
              <div style={{marginBottom:12}}>
                <label className="form-label">NetSuite Reference # (optional)</label>
                <input className="form-input" value={imp.poRef} onChange={e=>setImp(x=>({...x,poRef:e.target.value}))} placeholder="NS SO# or PO#"/>
              </div>
              <div style={{padding:10,background:'#eff6ff',borderRadius:6,fontSize:11,color:'#1e40af'}}>
                <strong>How this works:</strong> Paste your NetSuite data → we parse and collapse size-split lines → match items to the NSA catalog → you review and answer questions → create as Estimate or SO.
              </div>
            </div>
          </div>
        </div>

        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button className="btn btn-primary" disabled={!imp.raw.trim()||!imp.custId} onClick={()=>{
            const result=parseNSData(imp.raw);
            setImp(x=>({...x,step:result.questions.length>0?'questions':'review',...result}));
          }}>?? Parse & Review →</button>
        </div>
      </>}

      {/* STEP 2: Review Items */}
      {imp.step==='review'&&<>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <div style={{padding:8,background:'#f0fdf4',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#166534'}}>{imp.parsed.length}</div><div style={{fontSize:10}}>Items Parsed</div></div>
          <div style={{padding:8,background:'#dbeafe',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{imp.parsed.filter(p=>p.catMatch).length}</div><div style={{fontSize:10}}>Catalog Matches</div></div>
          <div style={{padding:8,background:'#fef3c7',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#92400e'}}>{imp.parsed.filter(p=>!p.catMatch).length}</div><div style={{fontSize:10}}>Custom / Unmatched</div></div>
          <div style={{padding:8,background:'#ede9fe',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#6d28d9'}}>{imp.decoLines.length}</div><div style={{fontSize:10}}>Decorations</div></div>
          <div style={{padding:8,background:imp.issues.length?'#fecaca':'#f8fafc',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:imp.issues.length?'#dc2626':'#94a3b8'}}>{imp.issues.length}</div><div style={{fontSize:10}}>Issues</div></div>
        </div>

        {imp.issues.length>0&&<div style={{marginBottom:8,padding:8,background:'#fef2f2',borderRadius:6}}>
          <div style={{fontSize:11,fontWeight:700,color:'#dc2626'}}>⚠️ Parser Issues</div>
          {imp.issues.map((is,i)=><div key={i} style={{fontSize:10,color:'#991b1b'}}>Line {is.line}: {is.msg}</div>)}
        </div>}

        <div className="card" style={{marginBottom:12}}><div className="card-header"><h2>?? Parsed Items</h2></div>
          <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
            <table style={{fontSize:11}}><thead><tr><th style={{width:28}}>✓</th><th>SKU</th><th>Name</th><th>Brand</th><th>Color</th><th>Rate</th><th>Sizes</th><th>Qty</th><th>$</th><th>Match</th></tr></thead>
            <tbody>{imp.parsed.map((it,i)=>{
              return<tr key={i} style={{opacity:it._skip?0.3:1,background:it.catMatch?'#f0fdf4':it.is_custom?'#fffbeb':'#fef2f2'}}>
                <td><input type="checkbox" checked={!it._skip} onChange={()=>updItem(i,'_skip',!it._skip)}/></td>
                <td><input className="form-input" value={it.sku} onChange={e=>updItem(i,'sku',e.target.value)} style={{width:80,fontSize:10,fontFamily:'monospace',fontWeight:700}}/></td>
                <td><input className="form-input" value={it.name} onChange={e=>updItem(i,'name',e.target.value)} style={{width:'100%',fontSize:10}}/></td>
                <td><input className="form-input" value={it.brand} onChange={e=>updItem(i,'brand',e.target.value)} style={{width:70,fontSize:10}}/></td>
                <td><input className="form-input" value={it.color} onChange={e=>updItem(i,'color',e.target.value)} style={{width:70,fontSize:10}}/></td>
                <td style={{textAlign:'right'}}>${it.rate?.toFixed(2)}</td>
                <td style={{fontSize:9,maxWidth:120}}>{Object.entries(it.sizes).sort(([a],[b])=>SZ_ORD_I.indexOf(a)-SZ_ORD_I.indexOf(b)).map(([s,q])=>s+':'+q).join(' ')}</td>
                <td style={{fontWeight:700,textAlign:'center'}}>{it.totalQty}</td>
                <td style={{textAlign:'right'}}>${it.totalAmt?.toFixed(0)}</td>
                <td>{it.catMatch?<span style={{fontSize:9,background:'#dcfce7',padding:'1px 5px',borderRadius:4,color:'#166534',fontWeight:600}}>✅ {it.catMatch.sku}</span>
                  :<div><select className="form-select" style={{fontSize:9,width:120}} value={it._manualMatch||''} onChange={e=>{
                    const pId=e.target.value;const pm=prod.find(p=>p.id===pId);
                    if(pm)updItem(i,'catMatch',pm);updItem(i,'_manualMatch',pId)}}>
                    <option value="">No match — custom</option>
                    {prod.filter(p=>p.sku.toLowerCase().includes(it.sku.toLowerCase().slice(0,3))||p.name.toLowerCase().includes(it.name.toLowerCase().split(' ')[0])).slice(0,8).map(p=>
                      <option key={p.id} value={p.id}>{p.sku} — {p.name.slice(0,25)}</option>)}
                    <option disabled>──────</option>
                    {prod.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name.slice(0,25)}</option>)}
                  </select></div>}</td>
              </tr>})}</tbody></table>
          </div>
        </div>

        {imp.decoLines.length>0&&<div className="card" style={{marginBottom:12}}><div className="card-header"><h2>?? Decorations</h2></div>
          <div className="card-body">{imp.decoLines.map((d,di)=>
            <div key={di} style={{padding:8,background:'#f8fafc',borderRadius:6,marginBottom:4,display:'flex',gap:8,alignItems:'center',fontSize:11}}>
              <span style={{fontWeight:700,flex:1}}>{d.desc}</span>
              <span style={{color:'#64748b'}}>Qty:{d.qty} · ${d.rate}/ea</span>
              <select className="form-select" style={{width:200,fontSize:10}} value={d._assignTo||'all'} onChange={e=>setImp(x=>({...x,decoLines:x.decoLines.map((dl,dli)=>dli===di?{...dl,_assignTo:e.target.value}:dl)}))}>
                <option value="all">Apply to all items</option>
                {imp.parsed.filter(p=>!p._skip).map((p,pi)=><option key={pi} value={String(pi)}>{p.sku} — {p.name?.slice(0,30)}</option>)}
              </select>
            </div>)}</div>
        </div>}

        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setImp(x=>({...x,step:'upload'}))}>← Back</button>
          <button className="btn btn-primary" onClick={()=>setImp(x=>({...x,step:x.questions.filter(q=>!q.answer).length>0?'questions':'confirm'}))}>{imp.questions.filter(q=>!q.answer).length>0?'Answer Questions →':'Confirm →'}</button>
        </div>
      </>}

      {/* STEP 3: Questions */}
      {imp.step==='questions'&&<>
        <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>?? A few questions about your import</div>
        <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>Some items need your input to import correctly. Answer these and we'll finalize everything.</div>

        {imp.questions.map((q,qi)=>{const it=imp.parsed[q.idx];
          return<div key={qi} className="card" style={{marginBottom:8,borderLeft:q.answer?'3px solid #22c55e':'3px solid #d97706'}}>
            <div style={{padding:'12px 16px'}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>{q.msg}</div>
              <div style={{fontSize:10,color:'#64748b',marginBottom:8}}>
                Item: {it?.sku} — {it?.name?.slice(0,50)} · Qty: {it?.totalQty} · ${it?.rate}/ea
              </div>

              {q.type==='match'&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className={`btn btn-sm ${q.answer==='custom'?'btn-primary':'btn-secondary'}`} onClick={()=>applyAnswer(qi,'custom')}>?? Custom / Special Order</button>
                <button className={`btn btn-sm ${q.answer==='skip'?'btn-primary':'btn-secondary'}`} style={{color:q.answer==='skip'?'white':'#dc2626'}} onClick={()=>applyAnswer(qi,'skip')}>⏭ Skip This Item</button>
                <div style={{display:'flex',gap:4,alignItems:'center'}}>
                  <span style={{fontSize:10}}>Or match to:</span>
                  <select className="form-select" style={{fontSize:10,width:200}} value={q.answer?.startsWith?.('match_')?q.answer:''} onChange={e=>{applyAnswer(qi,e.target.value);
                    if(e.target.value){const pm=prod.find(p=>p.id===e.target.value.replace('match_',''));if(pm)updItem(q.idx,'catMatch',pm)}}}>
                    <option value="">Search catalog...</option>
                    {prod.map(p=><option key={p.id} value={'match_'+p.id}>{p.sku} — {p.name.slice(0,30)} ({p.brand})</option>)}
                  </select>
                </div>
              </div>}

              {q.type==='sku'&&<div style={{display:'flex',gap:6,alignItems:'center'}}>
                <input className="form-input" value={q.answer||''} onChange={e=>applyAnswer(qi,e.target.value)} placeholder="Enter real SKU..." style={{width:120,fontSize:11}}/>
                <select className="form-select" style={{fontSize:10,width:200}} onChange={e=>{if(e.target.value){applyAnswer(qi,e.target.value);const pm=prod.find(p=>p.sku===e.target.value);if(pm)updItem(q.idx,'catMatch',pm)}}}>
                  <option value="">Or pick from catalog...</option>
                  {prod.map(p=><option key={p.id} value={p.sku}>{p.sku} — {p.name.slice(0,30)}</option>)}
                </select>
                <button className={`btn btn-sm ${q.answer==='keep_custom'?'btn-primary':'btn-secondary'}`} onClick={()=>applyAnswer(qi,'keep_custom')}>Keep as Custom</button>
              </div>}

              {q.type==='color'&&<input className="form-input" value={q.answer||''} onChange={e=>applyAnswer(qi,e.target.value)} placeholder="Enter color..." style={{width:200,fontSize:11}}/>}
            </div>
          </div>})}

        <div style={{display:'flex',gap:8,marginTop:12}}>
          <button className="btn btn-secondary" onClick={()=>setImp(x=>({...x,step:'review'}))}>← Back</button>
          <button className="btn btn-primary" onClick={()=>setImp(x=>({...x,step:'confirm'}))}>Review Final →</button>
        </div>
      </>}

      {/* STEP 4: Confirm & Create */}
      {imp.step==='confirm'&&<>
        {(()=>{
          const c=cust.find(x=>x.id===imp.custId);
          const keeping=imp.parsed.filter(p=>!p._skip&&!imp.questions.find(q=>q.idx===imp.parsed.indexOf(p)&&q.answer==='skip'));
          const isAUi=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';
          const mk=c?.catalog_markup||1.65;const tier=c?.adidas_ua_tier||'B';const disc=tD[tier]||0.35;
          const totalRev=keeping.reduce((a,it)=>a+it.totalAmt,0);
          const shipAmt=imp.shipping.reduce((a,s)=>a+s.amount,0);

          return<>
            <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:18,fontWeight:800}}>{imp.docType==='so'?'New Sales Order':'New Estimate'}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>{c?.name} ({c?.alpha_tag}) · {keeping.length} items · {imp.memo||'Imported from NetSuite'}</div></div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:24,fontWeight:800,color:'#1e40af'}}>${totalRev.toLocaleString()}</div>
                  {shipAmt>0&&<div style={{fontSize:11,color:'#64748b'}}>+ ${shipAmt.toFixed(2)} shipping</div>}
                </div>
              </div>
            </div></div>

            <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:0}}>
              <table style={{fontSize:11}}><thead><tr><th>SKU</th><th>Name</th><th>Brand</th><th>Color</th><th>Cost</th><th>Sell</th><th>Sizes</th><th>Qty</th><th>Total</th></tr></thead>
              <tbody>{keeping.map((it,i)=>{
                const au=isAUi(it.brand);
                const sell=it.rate;const cost=au?rQ(sell):rQ(sell/mk);
                return<tr key={i}>
                  <td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{it.sku}</td>
                  <td>{it.catMatch?<span style={{color:'#166534'}}>✅ {it.name.slice(0,35)}</span>:it.name.slice(0,35)}</td>
                  <td style={{fontSize:10}}>{it.brand}</td>
                  <td style={{fontSize:10}}>{it.color}</td>
                  <td style={{textAlign:'right'}}>${cost.toFixed(2)}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>${sell.toFixed(2)}</td>
                  <td style={{fontSize:9}}>{Object.entries(it.sizes).sort(([a],[b])=>SZ_ORD_I.indexOf(a)-SZ_ORD_I.indexOf(b)).map(([s,q])=>s+':'+q).join(' ')}</td>
                  <td style={{fontWeight:700,textAlign:'center'}}>{it.totalQty}</td>
                  <td style={{textAlign:'right'}}>${it.totalAmt.toFixed(0)}</td>
                </tr>})}</tbody></table>
            </div></div>

            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-secondary" onClick={()=>setImp(x=>({...x,step:'questions'}))}>← Back</button>
              <button className="btn btn-primary" style={{background:'#166534'}} onClick={()=>{
                const newItems=keeping.map(it=>{
                  const au=isAUi(it.brand);const sell=it.rate;const cost=au?rQ(sell):rQ(sell/mk);
                  const retail=au?rQ(sell/(1-disc)):0;const szKeys=Object.keys(it.sizes);
                  return{product_id:it.catMatch?.id||null,sku:it.sku,name:it.catMatch?.name||it.name,brand:it.catMatch?.brand||it.brand,
                    color:it.color||it.catMatch?.color||'',nsa_cost:cost,retail_price:retail,unit_sell:sell,
                    available_sizes:szKeys.length>0?szKeys.sort((a,b)=>SZ_ORD_I.indexOf(a)-SZ_ORD_I.indexOf(b)):['S','M','L','XL','2XL'],
                    sizes:it.sizes,decorations:[],is_custom:it.is_custom||false,pick_lines:[],po_lines:[]};
                });
                // Apply decos
                imp.decoLines.forEach(d=>{
                  const dt=d.desc.toLowerCase().includes('embroid')?'embroidery':d.desc.toLowerCase().includes('dtf')?'dtf':'screen_print';
                  const deco={kind:'art',position:'Front Center',art_file_id:null,sell_override:d.rate||0};
                  if(d._assignTo==='all')newItems.forEach(it=>it.decorations.push({...deco}));
                  else{const idx=parseInt(d._assignTo);if(newItems[idx])newItems[idx].decorations.push({...deco})}
                });
                // Create the SO or Estimate
                if(imp.docType==='so'){
                  const newSO={id:uid('SO-'),customer_id:imp.custId,memo:imp.memo||'Imported from NetSuite',status:'need_order',
                    created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),
                    expected_date:'',production_notes:imp.poRef?'NS Ref: '+imp.poRef:'',shipping_type:shipAmt>0?'flat':'pct',shipping_value:shipAmt||0,
                    ship_to_id:'default',firm_dates:[],art_files:[],items:newItems};
                  setSOs(prev=>[newSO,...prev]);
                  setESO(newSO);setESOC(c);setPg('orders');
                  nf('?? Imported SO with '+newItems.length+' items from NetSuite');
                } else {
                  const newEst={id:uid('EST-'),customer_id:imp.custId,memo:imp.memo||'Imported from NetSuite',status:'draft',
                    created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),
                    default_markup:mk,shipping_type:shipAmt>0?'flat':'pct',shipping_value:shipAmt||0,
                    ship_to_id:'default',email_status:null,art_files:[],items:newItems};
                  setEsts(prev=>[newEst,...prev]);
                  setEEst(newEst);setEEstC(c);setPg('estimates');
                  nf('?? Imported Estimate with '+newItems.length+' items from NetSuite');
                }
                setImp({step:'upload',raw:'',docType:'so',custId:'',parsed:[],decoLines:[],issues:[],questions:[],shipping:[],memo:'',poRef:''});
              }}>?? Create {imp.docType==='so'?'Sales Order':'Estimate'} ({keeping.length} items)</button>
            </div>
          </>})()}
      </>}
    </>);
  };



  const rBackup=()=>{
    const stateSize=JSON.stringify({customers:cust,estimates:ests,sales_orders:sos,products:prod,messages:msgs,invoices:invs}).length;
    const sizeMB=(stateSize/1024/1024).toFixed(2);
    const autoTs=typeof localStorage!=='undefined'?localStorage.getItem('nsa_auto_backup_ts'):null;
    const soCount=sos.length;const estCount=ests.length;const custCount=cust.length;const msgCount=msgs.length;
    let jobCount=0;sos.forEach(so=>{jobCount+=buildJobs(so).length});

    return(<>
      {/* Backup Actions */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div className="card">
          <div className="card-header"><h2>💾 Export Backup</h2></div>
          <div className="card-body">
            <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Download a complete snapshot of all NSA data as a JSON file. Keep this somewhere safe — Google Drive, Dropbox, local folder.</p>
            <div style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,fontSize:12}}>
                <div><span style={{color:'#64748b'}}>Customers:</span> <strong>{custCount}</strong></div>
                <div><span style={{color:'#64748b'}}>Estimates:</span> <strong>{estCount}</strong></div>
                <div><span style={{color:'#64748b'}}>Sales Orders:</span> <strong>{soCount}</strong></div>
                <div><span style={{color:'#64748b'}}>Jobs:</span> <strong>{jobCount}</strong></div>
                <div><span style={{color:'#64748b'}}>Messages:</span> <strong>{msgCount}</strong></div>
                <div><span style={{color:'#64748b'}}>File size:</span> <strong>{sizeMB} MB</strong></div>
              </div>
            </div>
            <button className="btn btn-primary" style={{width:'100%',padding:'12px 20px',fontSize:14}} onClick={exportBackup}>
              <Icon name="save" size={16}/> Export Full Backup
            </button>
            {lastBackup&&<div style={{fontSize:11,color:'#166534',marginTop:8,textAlign:'center'}}>Last manual backup: {lastBackup}</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>📂 Restore from Backup</h2></div>
          <div className="card-body">
            <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Upload a previously exported NSA backup file to restore all data. This will replace everything currently in the system.</p>
            <div style={{border:'2px dashed #d1d5db',borderRadius:8,padding:24,textAlign:'center',marginBottom:12,cursor:'pointer',position:'relative'}}>
              <input type="file" accept=".json" style={{position:'absolute',inset:0,opacity:0,cursor:'pointer'}} onChange={e=>{if(e.target.files[0])importBackup(e.target.files[0])}}/>
              <div style={{fontSize:24,marginBottom:8}}>📁</div>
              <div style={{fontWeight:600,color:'#64748b'}}>Drop backup file or click to browse</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>Accepts .json files exported from NSA Portal</div>
            </div>
            <div style={{borderTop:'1px solid #e2e8f0',paddingTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:6}}>Auto-Backup Recovery</div>
              {autoTs?<div>
                <div style={{fontSize:11,color:'#64748b'}}>Last auto-save: {new Date(autoTs).toLocaleString()}</div>
                <button className="btn btn-sm btn-secondary" style={{marginTop:6}} onClick={restoreAutoBackup}>Restore Auto-Backup</button>
              </div>:<div style={{fontSize:11,color:'#94a3b8'}}>No auto-backup found in browser storage</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Auto-backup toggle */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-body" style={{padding:'12px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontWeight:700}}>Auto-Backup to Browser</div>
            <div style={{fontSize:12,color:'#64748b'}}>Saves a snapshot to localStorage every 5 minutes. Survives page refreshes but NOT browser cache clears.</div>
          </div>
          <button className={`btn btn-sm ${autoBackupEnabled?'btn-primary':'btn-secondary'}`} onClick={()=>setAutoBackupEnabled(!autoBackupEnabled)}>
            {autoBackupEnabled?'✅ Enabled':'Disabled'}
          </button>
        </div>
      </div>

      {/* Google Drive Backup */}
      <div className="card" style={{marginBottom:16,borderLeft:'4px solid #4285f4'}}>
        <div className="card-header">
          <h2>☁️ Google Drive Backup</h2>
        </div>
        <div className="card-body">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <button className="btn btn-primary" style={{background:'#4285f4',borderColor:'#4285f4',padding:'12px 20px',fontSize:13}} onClick={()=>{
              const data=getFullState();
              const json=JSON.stringify(data,null,2);
              const blob=new Blob([json],{type:'application/json'});
              const ts=new Date().toISOString().split('T')[0];
              const fileName='NSA-backup-'+ts+'.json';
              // Use native share / save-as which on most devices offers Drive
              if(navigator.share&&navigator.canShare&&navigator.canShare({files:[new File([blob],fileName,{type:'application/json'})]})){
                navigator.share({files:[new File([blob],fileName,{type:'application/json'})],title:'NSA Portal Backup',text:'Daily backup '+ts}).then(()=>{
                  setLastBackup(new Date().toLocaleString()+' (Drive)');logChange('backup','system','drive','Shared to Drive: '+fileName);nf('☁️ Shared to Drive');
                }).catch(()=>{});
              } else {
                // Fallback: download + open Drive upload page
                const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;a.click();URL.revokeObjectURL(url);
                window.open('https://drive.google.com/drive/my-drive','_blank');
                setLastBackup(new Date().toLocaleString()+' (downloaded)');logChange('backup','system','drive-download','Downloaded for Drive: '+fileName);
                nf('💾 Downloaded — upload to Drive in the tab that opened');
              }
            }}>☁️ Save to Google Drive</button>
            <button className="btn btn-secondary" style={{padding:'12px 20px',fontSize:13}} onClick={()=>{
              window.open('https://drive.google.com/drive/search?q=NSA-backup','_blank');
              nf('Opening Drive to find backup files...');
            }}>📂 Find Backups in Drive</button>
          </div>
          <div style={{padding:10,background:'#e8f0fe',borderRadius:6}}>
            <div style={{fontSize:12,fontWeight:600,color:'#1a73e8',marginBottom:4}}>Daily Backup Recommendation</div>
            <div style={{fontSize:11,color:'#5f6368'}}>Export a backup at the end of each day. On mobile/tablet, "Save to Drive" uses your device's share sheet to save directly. On desktop, it downloads the file — drag it into the Google Drive tab that opens. Name your backups with the date so you can find them: <strong>NSA-backup-YYYY-MM-DD.json</strong></div>
          </div>
        </div>
      </div>

      {/* SO Version History */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-header"><h2>📜 SO Version History</h2><span style={{fontSize:12,color:'#64748b'}}>{Object.keys(soHistory).length} SOs tracked</span></div>
        <div className="card-body" style={{padding:0}}>
          {Object.keys(soHistory).length===0?<div className="empty" style={{padding:20}}>No version history yet. Changes to SOs will be tracked here.</div>:
          <table><thead><tr><th>SO</th><th>Versions</th><th>Latest Save</th><th>Action</th></tr></thead><tbody>
          {Object.entries(soHistory).map(([soId,versions])=><tr key={soId}>
            <td style={{fontWeight:700,color:'#1e40af'}}>{soId}</td>
            <td>{versions.length} version{versions.length!==1?'s':''}</td>
            <td style={{fontSize:11,color:'#64748b'}}>{versions[0]?.ts} by {versions[0]?.user?.split(' ')[0]}</td>
            <td><button className="btn btn-sm btn-secondary" onClick={()=>{
              const v=versions[0];
              if(v&&window.confirm('Rollback '+soId+' to version from '+v.ts+'?')){
                savSO(v.snapshot);nf('⏪ '+soId+' rolled back to '+v.ts);
              }
            }}>⏪ Rollback</button></td>
          </tr>)}
          </tbody></table>}
        </div>
      </div>

      {/* Change Log */}
      <div className="card">
        <div className="card-header"><h2>📋 Change Log</h2><span style={{fontSize:12,color:'#64748b'}}>{changeLog.length} entries</span>
          {changeLog.length>0&&<button className="btn btn-sm btn-secondary" onClick={()=>{
            const csv='Timestamp,User,Action,Entity,ID,Detail\n'+changeLog.map(c2=>[c2.ts,c2.user,c2.action,c2.entity,c2.entityId,'"'+(c2.detail||'')+'"'].join(',')).join('\n');
            const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=url;a.download='nsa-changelog-'+new Date().toISOString().split('T')[0]+'.csv';a.click();
            nf('📋 Change log exported');
          }}>Export CSV</button>}
        </div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {changeLog.length===0?<div className="empty" style={{padding:20}}>No changes logged yet. Activity will appear here as you work.</div>:
          <table style={{fontSize:12}}><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>Detail</th></tr></thead><tbody>
          {changeLog.slice(0,100).map((c2,i)=><tr key={i}>
            <td style={{fontSize:10,color:'#64748b',whiteSpace:'nowrap'}}>{c2.ts}</td>
            <td style={{fontWeight:600}}>{c2.user?.split(' ')[0]}</td>
            <td><span style={{padding:'1px 6px',borderRadius:6,fontSize:10,fontWeight:600,
              background:c2.action==='created'?'#dcfce7':c2.action==='updated'?'#dbeafe':c2.action==='backup'?'#f5f3ff':c2.action==='restore'?'#fef3c7':'#f1f5f9',
              color:c2.action==='created'?'#166534':c2.action==='updated'?'#1e40af':c2.action==='backup'?'#7c3aed':c2.action==='restore'?'#92400e':'#475569'
            }}>{c2.action}</span></td>
            <td>{c2.entity}</td>
            <td style={{fontWeight:600,color:'#1e40af'}}>{c2.entityId}</td>
            <td style={{color:'#64748b',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c2.detail}</td>
          </tr>)}
          </tbody></table>}
        </div>
      </div>
    </>);
  };

  // MESSAGES PAGE
  const rMsg=()=>{const allM=[...msgs].sort((a,b)=>(b.ts||'').localeCompare(a.ts));

  // QUICKBOOKS ONLINE INTEGRATION
  const rQB=()=>{
    // Build sync queue — SOs/POs/Invoices that need pushing to QB
    const unsyncedSOs=sos.filter(so=>{
      const hasItems=safeItems(so).some(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
      return hasItems&&!so._qb_synced;
    });
    const unsyncedPOs=[];
    sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{if(!pl._qb_synced)unsyncedPOs.push({...pl,soId:so.id,sku:it.sku,itemName:it.name,vendor:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand})})})});
    const unsyncedInvs=invs.filter(i=>!i._qb_synced);

    // Build what a QB sync would push
    const buildQBSalesOrder=(so)=>{
      const c=cust.find(x=>x.id===so.customer_id);
      const lines=[];
      safeItems(so).forEach(it=>{
        const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
        if(!qty)return;
        lines.push({type:'SalesItemLine',desc:it.sku+' '+it.name+(it.color?' - '+it.color:''),qty,rate:it.unit_sell,amount:qty*it.unit_sell,account:qbConfig.mapping.income_account});
        safeDecos(it).forEach(d=>{
          const sell=safeNum(d.sell_override||d.sell_each||0);
          if(sell>0)lines.push({type:'SalesItemLine',desc:'Decoration: '+(d.position||d.deco_type||'Art'),qty,rate:sell,amount:qty*sell,account:qbConfig.mapping.income_account});
        });
      });
      return{docType:'SalesOrder',docNumber:so.id,customerRef:c?.name||'Unknown',date:so.created_at,memo:so.memo,lines,total:lines.reduce((a,l)=>a+l.amount,0)};
    };

    const buildQBPurchaseOrder=(pl,so,it)=>{
      const qty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!['unit_cost'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
      const rate=pl.po_type==='outside_deco'?safeNum(pl.unit_cost):safeNum(it.nsa_cost);
      return{docType:'PurchaseOrder',docNumber:pl.po_id,vendorRef:pl.deco_vendor||D_V.find(v=>v.id===it.vendor_id)?.name||it.brand,
        date:pl.created_at,soRef:so.id,lines:[{desc:it.sku+' '+it.name,qty,rate,amount:qty*rate}],
        account:pl.po_type==='outside_deco'?qbConfig.mapping.deco_account:qbConfig.mapping.cogs_account,
        total:qty*rate};
    };

    const buildQBInvoice=(inv)=>{
      const so=sos.find(s=>s.id===inv.so_id);
      return{docType:'Invoice',docNumber:inv.id,customerRef:cust.find(c=>c.id===inv.customer_id)?.name,
        date:inv.created_at,soRef:inv.so_id,amount:inv.total,paid:inv.paid,balance:inv.total-inv.paid,
        account:qbConfig.mapping.ar_account};
    };

    // Simulate a sync
    const runSync=(type)=>{
      const log={ts:new Date().toLocaleString(),type,status:'success',details:[]};
      if(type==='all'||type==='sales_orders'){
        unsyncedSOs.forEach(so=>{
          const qbSO=buildQBSalesOrder(so);
          log.details.push('SO: '+so.id+' → QB SalesOrder ($'+qbSO.total.toFixed(2)+')');
        });
      }
      if(type==='all'||type==='purchase_orders'){
        sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).filter(pl=>!pl._qb_synced).forEach(pl=>{
          const qbPO=buildQBPurchaseOrder(pl,so,it);
          log.details.push('PO: '+pl.po_id+' → QB PurchaseOrder to '+qbPO.vendorRef+' ($'+qbPO.total.toFixed(2)+')');
        })})});
      }
      if(type==='all'||type==='invoices'){
        unsyncedInvs.forEach(inv=>{
          const qbInv=buildQBInvoice(inv);
          log.details.push('INV: '+inv.id+' → QB Invoice ($'+qbInv.amount.toFixed(2)+')');
        });
      }
      if(log.details.length===0){log.details.push('Nothing to sync');log.status='skipped'}
      setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,50),lastSync:new Date().toLocaleString()}));
      nf('🔄 QB Sync: '+log.details.length+' items processed');
    };

    return(<>
      {/* Connection Status */}
      <div className="card" style={{marginBottom:16,borderLeft:'4px solid '+(qbConfig.connected?'#22c55e':'#d97706')}}>
        <div className="card-body">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:48,height:48,borderRadius:12,background:qbConfig.connected?'#dcfce7':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>
              {qbConfig.connected?'✅':'⚠️'}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:qbConfig.connected?'#166534':'#92400e'}}>
                {qbConfig.connected?'Connected to QuickBooks Online':'QuickBooks Not Connected'}
              </div>
              {qbConfig.connected?
                <div style={{fontSize:12,color:'#64748b'}}>Company: {qbConfig.companyName} · Last sync: {qbConfig.lastSync||'Never'}</div>:
                <div style={{fontSize:12,color:'#92400e'}}>Connect your QBO account to enable automatic sync of SOs, POs, and Invoices</div>}
            </div>
            {qbConfig.connected?
              <button className="btn btn-secondary" style={{color:'#dc2626'}} onClick={()=>setQBConfig(prev=>({...prev,connected:false,companyId:'',companyName:''}))}>Disconnect</button>:
              <button className="btn btn-primary" style={{background:'#2CA01C',borderColor:'#2CA01C',padding:'10px 20px',fontSize:14,fontWeight:700}} onClick={()=>{
                // In production: window.location.href = '/auth/quickbooks' → OAuth2 flow
                // For demo, simulate connection
                setQBConfig(prev=>({...prev,connected:true,companyId:'4620816365181050610',companyName:'National Sports Apparel LLC'}));
                nf('✅ Connected to QuickBooks Online');
              }}>Connect to QuickBooks</button>}
          </div>
        </div>
      </div>

      {qbConfig.connected&&<>
      {/* Sync Queue Stats */}
      <div className="stats-row" style={{marginBottom:16}}>
        <div className="stat-card" style={{borderLeft:'3px solid #2563eb'}}><div className="stat-label">SOs to Sync</div><div className="stat-value" style={{color:'#2563eb'}}>{unsyncedSOs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #7c3aed'}}><div className="stat-label">POs to Sync</div><div className="stat-value" style={{color:'#7c3aed'}}>{unsyncedPOs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #d97706'}}><div className="stat-label">Invoices to Sync</div><div className="stat-value" style={{color:'#d97706'}}>{unsyncedInvs.length}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid #166534'}}><div className="stat-label">Last Sync</div><div className="stat-value" style={{fontSize:12,color:'#166534'}}>{qbConfig.lastSync||'Never'}</div></div>
      </div>

      {/* Sync Controls */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div className="card">
          <div className="card-header"><h2>🔄 Sync Controls</h2></div>
          <div className="card-body">
            <div style={{marginBottom:12}}>
              <label className="form-label">Sync Mode</label>
              <div style={{display:'flex',gap:4}}>
                {[['manual','Manual'],['hourly','Hourly'],['daily','Daily'],['realtime','Real-time']].map(([v,l])=>
                  <button key={v} className={`btn btn-sm ${qbConfig.autoSync===v?'btn-primary':'btn-secondary'}`}
                    onClick={()=>setQBConfig(prev=>({...prev,autoSync:v}))}>{l}</button>)}
              </div>
              <div style={{fontSize:10,color:'#64748b',marginTop:4}}>
                {qbConfig.autoSync==='manual'?'Push changes manually when ready':
                 qbConfig.autoSync==='hourly'?'Auto-syncs every hour':
                 qbConfig.autoSync==='daily'?'Auto-syncs once daily at midnight':
                 'Syncs immediately when changes are saved'}
              </div>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={()=>runSync('all')}>🔄 Sync Everything</button>
              <button className="btn btn-secondary" onClick={()=>runSync('sales_orders')}>SOs</button>
              <button className="btn btn-secondary" onClick={()=>runSync('purchase_orders')}>POs</button>
              <button className="btn btn-secondary" onClick={()=>runSync('invoices')}>Invoices</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>🗂️ Account Mapping</h2></div>
          <div className="card-body">
            <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Map NSA line items to your QB Chart of Accounts</div>
            {[['income_account','Item Revenue','Sales'],['cogs_account','Blank Goods COGS','Cost of Goods Sold'],['deco_account','Outside Decoration','Subcontractor - Decoration'],['ar_account','Accounts Receivable','Accounts Receivable'],['ap_account','Accounts Payable','Accounts Payable']].map(([key,label,def])=>
              <div key={key} style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:600,color:'#475569',width:140}}>{label}</span>
                <input className="form-input" style={{flex:1,fontSize:11,padding:'3px 6px'}} value={qbConfig.mapping[key]||def}
                  onChange={e=>setQBConfig(prev=>({...prev,mapping:{...prev.mapping,[key]:e.target.value}}))}/>
              </div>)}
          </div>
        </div>
      </div>

      {/* Preview — what would sync */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-header"><h2>📋 Sync Preview — What Will Go to QB</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {unsyncedSOs.length===0&&unsyncedPOs.length===0&&unsyncedInvs.length===0?
            <div className="empty" style={{padding:20}}>Everything is synced!</div>:
          <table style={{fontSize:11}}>
            <thead><tr style={{background:'#f8fafc'}}><th>Type</th><th>Doc #</th><th>Customer/Vendor</th><th>SO Ref</th><th>QB Account</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {unsyncedSOs.map(so=>{const qb=buildQBSalesOrder(so);
                return<tr key={so.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dbeafe',color:'#1e40af',fontWeight:600}}>Sales Order</span></td>
                  <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td>
                  <td>{qb.customerRef}</td><td>—</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping.income_account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${qb.total.toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>})}
              {sos.map(so=>safeItems(so).map(it=>(it.po_lines||[]).filter(pl=>!pl._qb_synced).map((pl,pi)=>{
                const qb=buildQBPurchaseOrder(pl,so,it);
                return<tr key={so.id+pl.po_id+pi} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:pl.po_type==='outside_deco'?'#ede9fe':'#fef3c7',
                    color:pl.po_type==='outside_deco'?'#7c3aed':'#92400e',fontWeight:600}}>{pl.po_type==='outside_deco'?'Deco PO':'Blank PO'}</span></td>
                  <td style={{fontWeight:700,color:pl.po_id?.startsWith('DPO')?'#7c3aed':'#1e40af'}}>{pl.po_id}</td>
                  <td>{qb.vendorRef}</td><td style={{fontSize:10,color:'#64748b'}}>{so.id}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qb.account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>${qb.total.toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>}))).flat(2)}
              {unsyncedInvs.map(inv=>{const qb=buildQBInvoice(inv);
                return<tr key={inv.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td><span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'#dcfce7',color:'#166534',fontWeight:600}}>Invoice</span></td>
                  <td style={{fontWeight:700,color:'#166534'}}>{inv.id}</td>
                  <td>{qb.customerRef}</td><td style={{fontSize:10,color:'#64748b'}}>{qb.soRef}</td>
                  <td style={{fontSize:10,color:'#64748b'}}>{qbConfig.mapping.ar_account}</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${qb.amount.toFixed(2)}</td>
                  <td><span style={{fontSize:8,padding:'1px 4px',borderRadius:3,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Pending</span></td>
                </tr>})}
            </tbody>
          </table>}
        </div>
      </div>

      {/* Sync Log */}
      <div className="card">
        <div className="card-header"><h2>📜 Sync History</h2></div>
        <div className="card-body" style={{padding:0,maxHeight:300,overflow:'auto'}}>
          {qbConfig.syncLog.length===0?<div className="empty" style={{padding:20}}>No sync history yet</div>:
          qbConfig.syncLog.map((log,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                background:log.status==='success'?'#dcfce7':log.status==='skipped'?'#f1f5f9':'#fef2f2',
                color:log.status==='success'?'#166534':log.status==='skipped'?'#64748b':'#dc2626'}}>{log.status}</span>
              <span style={{fontSize:11,fontWeight:700}}>{log.type==='all'?'Full Sync':log.type.replace(/_/g,' ')}</span>
              <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{log.ts}</span>
            </div>
            {log.details.map((d,di)=><div key={di} style={{fontSize:10,color:'#64748b',paddingLeft:8}}>• {d}</div>)}
          </div>)}
        </div>
      </div>
      </>}

      {/* API Documentation for developer */}
      <div className="card" style={{marginTop:16}}>
        <div className="card-header"><h2>🔧 Integration Notes</h2></div>
        <div className="card-body" style={{fontSize:12,color:'#64748b'}}>
          <div style={{marginBottom:8}}><strong>QB Online API endpoints used:</strong></div>
          <div style={{fontFamily:'monospace',fontSize:10,background:'#f8fafc',padding:10,borderRadius:6,marginBottom:8}}>
            POST /v3/company/{'{'}{'{'}companyId{'}'}{'}' }/salesorder — Create/update Sales Orders<br/>
            POST /v3/company/{'{'}{'{'}companyId{'}'}{'}' }/purchaseorder — Create POs (blanks + deco)<br/>
            POST /v3/company/{'{'}{'{'}companyId{'}'}{'}' }/invoice — Create Invoices<br/>
            POST /v3/company/{'{'}{'{'}companyId{'}'}{'}' }/payment — Record payments<br/>
            GET  /v3/company/{'{'}{'{'}companyId{'}'}{'}' }/query — Sync back QB data
          </div>
          <div style={{marginBottom:4}}><strong>What syncs:</strong></div>
          <div>• <strong>Sales Orders</strong> → QB Sales Order with line items (products + decoration as separate lines)</div>
          <div>• <strong>Blank POs</strong> → QB Purchase Order to vendor (SanMar, S&S, etc.) linked to SO</div>
          <div>• <strong>Deco POs</strong> → QB Purchase Order to decorator (Silver Screen, Olympic, etc.) posted to "{qbConfig.mapping.deco_account}" account</div>
          <div>• <strong>Invoices</strong> → QB Invoice with A/R tracking, payment application</div>
          <div style={{marginTop:8,padding:8,background:'#fef3c7',borderRadius:6,color:'#92400e'}}>
            <strong>Setup required:</strong> QBO OAuth2 app credentials (Client ID + Secret) from <a href="https://developer.intuit.com" target="_blank" rel="noreferrer" style={{color:'#1e40af'}}>developer.intuit.com</a>. 
            Add your redirect URI and scopes: <code>com.intuit.quickbooks.accounting</code>
          </div>
        </div>
      </div>
    </>);
  };
    const unread=allM.filter(m=>!(m.read_by||[]).includes(cu.id));
    const filtered=mF==='unread'?unread:mF==='mine'?allM.filter(m=>sos.some(s=>s.id===m.so_id&&s.created_by===cu.id)):allM;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{allM.length}</div></div><div className="stat-card"><div className="stat-label">Unread</div><div className="stat-value" style={{color:unread.length>0?'#dc2626':''}}>{unread.length}</div></div></div>
    <div style={{display:'flex',gap:4,marginBottom:12}}>{[['all','All'],['unread','Unread'],['mine','My SOs']].map(([v,l])=><button key={v} className={`btn btn-sm ${mF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setMF(v)}>{l}</button>)}
      <button className="btn btn-sm btn-secondary" style={{marginLeft:'auto'}} onClick={()=>{setMsgs(msgs.map(m=>({...m,read_by:[...new Set([...(m.read_by||[]),cu.id])]})));nf('All marked read')}}>Mark All Read</button></div>
    <div className="card"><div className="card-body" style={{padding:0}}>
      {filtered.length===0?<div className="empty" style={{padding:20}}>No messages</div>:
      filtered.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const so=sos.find(s=>s.id===m.so_id);const c2=cust.find(cc=>cc.id===so?.customer_id);const isUnread=!(m.read_by||[]).includes(cu.id);
        return<div key={m.id} style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9',cursor:'pointer',background:isUnread?'#eff6ff':'white'}}
          onClick={()=>{if(so){const c3=cust.find(cc=>cc.id===so.customer_id);setESO(so);setESOC(c3);setPg('orders')}setMsgs(msgs.map(mm=>mm.id===m.id?{...mm,read_by:[...new Set([...(mm.read_by||[]),cu.id])]}:mm))}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{width:36,height:36,borderRadius:18,background:isUnread?'#3b82f6':'#e2e8f0',color:isUnread?'white':'#64748b',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,flexShrink:0}}>{(author?.name||'?')[0]}</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:2}}>
                <span style={{fontWeight:700,fontSize:13}}>{author?.name}</span>
                <span style={{fontSize:11,color:'#1e40af',fontWeight:600}}>{m.so_id}</span>
                {c2&&<span style={{fontSize:11,color:'#64748b'}}>{c2.alpha_tag}</span>}
                {so?.memo&&<span style={{fontSize:10,color:'#94a3b8'}}>— {so.memo}</span>}
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{m.ts}</span>
              </div>
              <div style={{fontSize:13,color:'#374151'}}>{m.text}</div>
            </div>
            {isUnread&&<div style={{width:8,height:8,borderRadius:4,background:'#3b82f6',flexShrink:0,marginTop:6}}/>}
          </div></div>})}</div></div></>)};

    // NAV
  const nav=[{section:'Overview'},{id:'dashboard',label:'Dashboard',icon:'home'},{id:'reports',label:'Reports',icon:'dollar'},{id:'commissions',label:'Commissions',icon:'dollar',roles:['admin','rep']},{section:'Sales'},{id:'estimates',label:'Estimates',icon:'dollar'},{id:'orders',label:'Sales Orders',icon:'box'},{id:'invoices',label:'Invoices',icon:'dollar'},{id:'omg',label:'OMG Stores',icon:'cart'},{section:'Production'},{id:'jobs',label:'Jobs',icon:'grid'},{id:'production',label:'Prod Board',icon:'package'},{id:'decoration',label:'Decoration',icon:'image'},{id:'warehouse',label:'Warehouse',icon:'warehouse'},{id:'batch_pos',label:'Batch POs',icon:'cart'},{section:'People'},{id:'customers',label:'Customers',icon:'users'},{id:'vendors',label:'Vendors',icon:'building'},{section:'Comms'},{id:'messages',label:'Messages',icon:'mail'},{section:'Catalog'},{id:'products',label:'Products',icon:'package'},{id:'inventory',label:'Inventory',icon:'warehouse'},{section:'System'},{id:'import',label:'NetSuite Import',icon:'save'},{id:'qb',label:'QuickBooks Sync',icon:'dollar'},{id:'backup',label:'Backup & Data',icon:'save'}];
  const titles={dashboard:'Dashboard',reports:'Reports & Analytics',commissions:'Commissions',estimates:'Estimates',orders:'Sales Orders',invoices:'Invoices',omg:'OMG Team Stores',jobs:'Jobs',production:'Production Board',decoration:'Decoration',warehouse:'Warehouse',batch_pos:'Batch PO Queue',customers:'Customers',vendors:'Vendors',products:'Products',inventory:'Inventory',messages:'Messages',import:'NetSuite Import',qb:'QuickBooks Online',backup:'Backup & Data'};
  // LOGIN GATE
  if(!cu)return<LoginGate onLogin={handleLogin}/>;

  return(<div className="app"><Toast msg={toast?.msg} type={toast?.type}/>
    <div className="sidebar"><div className="sidebar-logo">NSA<span>Portal</span></div>
      <nav className="sidebar-nav">{nav.map((item,i)=>{if(item.section)return<div key={i} className="sidebar-section">{item.section}</div>;
        if(item.roles&&!item.roles.includes(cu.role))return null;
        const ubadge=item.id==='messages'?msgs.filter(m=>!(m.read_by||[]).includes(cu.id)).length:0;
        return<button key={item.id} className={`sidebar-link ${pg===item.id?'active':''}`}
          onClick={()=>{if(dirtyRef.current&&!window.confirm('You have unsaved changes. Leave without saving?'))return;dirtyRef.current=false;setPg(item.id);setQ('');setSelC(null);setSelV(null);setEEst(null);setESO(null)}}><Icon name={item.icon}/>{item.label}{item.id==='messages'&&ubadge>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:'auto'}}>{ubadge}</span>}{item.id==='batch_pos'&&batchPOs.length>0&&<span style={{background:'#7c3aed',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:'auto'}}>{batchPOs.length}</span>}</button>})}</nav>
      <div className="sidebar-user"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontWeight:600,color:'#e2e8f0'}}>{cu.name}</div><div>{cu.role}</div></div><button onClick={handleLogout} style={{background:'none',border:'1px solid #475569',borderRadius:6,padding:'3px 8px',color:'#94a3b8',cursor:'pointer',fontSize:10}} title="Log out">↪ Out</button></div></div></div>
    <div className="main"><div className="topbar"><h1>{eEst?eEst.id:eSO?eSO.id:selC?selC.name:selV?selV.name:(titles[pg]||'Dashboard')}</h1>
        <div style={{flex:1,maxWidth:400,margin:'0 20px',position:'relative'}}>
          <div className="search-bar" style={{margin:0}}><Icon name="search"/><input placeholder="Search everything... (customers, orders, products)" value={gQ} onChange={e=>setGQ(e.target.value)} onFocus={()=>setGOpen(true)}/>{gQ&&<button onClick={()=>{setGQ('');setGOpen(false)}} style={{background:'none',border:'none',cursor:'pointer',padding:2}}><Icon name="x" size={14}/></button>}</div>
          {gOpen&&gQ.length>=2&&(()=>{const s=gQ.toLowerCase();
            const rc=cust.filter(cc=>(cc.name+' '+cc.alpha_tag).toLowerCase().includes(s)).slice(0,4);
            const re=ests.filter(e=>(e.id+' '+e.memo).toLowerCase().includes(s)).slice(0,4);
            const rs=sos.filter(so=>(so.id+' '+so.memo).toLowerCase().includes(s)).slice(0,4);
            const rp=prod.filter(p=>(p.sku+' '+p.name+' '+p.brand).toLowerCase().includes(s)).slice(0,4);
            // Build IF index from all SOs
            const allPicks=[];sos.forEach(so=>{safeItems(so).forEach(it=>{safePicks(it).forEach(pk=>{if(pk.pick_id&&pk.pick_id.toLowerCase().includes(s)&&!allPicks.find(x=>x.pick_id===pk.pick_id)){allPicks.push({pick_id:pk.pick_id,so_id:so.id,so,status:pk.status||'pick'})}})})});
            const rpk=allPicks.slice(0,4);
            const tot=rc.length+re.length+rs.length+rp.length+rpk.length;
            return tot>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:60,maxHeight:350,overflow:'auto'}}>
              {rc.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Customers</div>
                {rc.map(cc=><div key={cc.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setSelC(cc);setPg('customers');setGQ('');setGOpen(false)}}><Icon name="users" size={14}/><span style={{fontWeight:600}}>{cc.name}</span><span className="badge badge-gray">{cc.alpha_tag}</span></div>)}</>}
              {re.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Estimates</div>
                {re.map(e=>{const cc=cust.find(x=>x.id===e.customer_id);return<div key={e.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setEEst(e);setEEstC(cc);setPg('estimates');setGQ('');setGOpen(false)}}><Icon name="dollar" size={14}/><span style={{fontWeight:700,color:'#1e40af'}}>{e.id}</span><span>{e.memo}</span></div>})}</>}
              {rs.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Sales Orders</div>
                {rs.map(so=>{const cc=cust.find(x=>x.id===so.customer_id);return<div key={so.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setESO(so);setESOC(cc);setPg('orders');setGQ('');setGOpen(false)}}><Icon name="box" size={14}/><span style={{fontWeight:700,color:'#1e40af'}}>{so.id}</span><span>{so.memo}</span></div>})}</>}
              {rp.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Products</div>
                {rp.map(p=><div key={p.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setPg('products');setQ(p.sku);setGQ('');setGOpen(false)}}><Icon name="package" size={14}/><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span><span>{p.name}</span></div>)}</>}
              {rpk.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Item Fulfillments</div>
                {rpk.map(pk=>{const cc=cust.find(x=>x.id===pk.so?.customer_id);return<div key={pk.pick_id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setESO(pk.so);setESOC(cc);setPg('orders');setGQ('');setGOpen(false)}}><Icon name="grid" size={14}/><span style={{fontWeight:700,color:'#1e40af'}}>{pk.pick_id}</span><span>→ {pk.so_id}</span><span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`}>{pk.status}</span></div>})}</>}
            </div>})()}
          {gOpen&&<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:59}} onClick={()=>setGOpen(false)}/>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}><button className="btn btn-sm btn-primary" onClick={()=>newE(null)} style={{fontSize:11}}><Icon name="plus" size={12}/> Estimate</button><button className="btn btn-sm btn-secondary" onClick={()=>setCM({open:true,c:null})} style={{fontSize:11}}><Icon name="plus" size={12}/> Customer</button><button className="btn btn-sm btn-secondary" onClick={()=>setQPC({open:true,mode:'single',items:[{sku:'',name:'',brand:'',color:'',category:'Tees',retail_price:0,nsa_cost:0,available_sizes:['S','M','L','XL','2XL'],vendor_id:''}]})} style={{fontSize:11}}><Icon name="plus" size={12}/> Product</button></div></div>
      <div className="content">{pg==='dashboard'&&rDash()}{pg==='estimates'&&rEst()}{pg==='orders'&&rSO()}{pg==='jobs'&&rJobs()}{pg==='production'&&rProd2()}{pg==='decoration'&&rDeco()}{pg==='warehouse'&&rWarehouse()}{pg==='batch_pos'&&rBatchPOs()}{pg==='customers'&&rCust()}{pg==='vendors'&&rVend()}{pg==='products'&&rProd()}{pg==='inventory'&&rInv()}{pg==='messages'&&rMsg()}{pg==='invoices'&&rInvoices()}{pg==='commissions'&&rCommissions()}{pg==='omg'&&rOMG()}{pg==='reports'&&rReports()}{pg==='import'&&rImport()}{pg==='qb'&&rQB()}{pg==='backup'&&rBackup()}</div></div>
    <CustModal isOpen={cM.open} onClose={()=>setCM({open:false,c:null})} onSave={savC} customer={cM.c} parents={pars}/>
    <AdjModal isOpen={aM.open} onClose={()=>setAM({open:false,p:null})} product={aM.p} onSave={savI}/>

    {/* QUICK PRODUCT CREATE MODAL */}
    {qPC.open&&<div className="modal-overlay" onClick={()=>setQPC(x=>({...x,open:false}))}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:qPC.mode==='bulk'?800:550,maxHeight:'85vh',overflow:'auto'}}>
      <div className="modal-header" style={{background:'#eff6ff'}}><h2>📦 Quick Add Product{qPC.mode==='bulk'?'s':''}</h2><button className="modal-close" onClick={()=>setQPC(x=>({...x,open:false}))}>×</button></div>
      <div className="modal-body">
        <div style={{display:'flex',gap:4,marginBottom:12}}>
          <button className={`btn btn-sm ${qPC.mode==='single'?'btn-primary':'btn-secondary'}`} onClick={()=>setQPC(x=>({...x,mode:'single'}))}>Single Item</button>
          <button className={`btn btn-sm ${qPC.mode==='multi'?'btn-primary':'btn-secondary'}`} onClick={()=>setQPC(x=>({...x,mode:'multi'}))}>Multiple Items</button>
          <button className={`btn btn-sm ${qPC.mode==='bulk'?'btn-primary':'btn-secondary'}`} onClick={()=>setQPC(x=>({...x,mode:'bulk'}))}>📥 Bulk Upload</button>
        </div>

        {qPC.mode==='single'&&(()=>{const it=qPC.items[0]||{};const up=(k,v)=>setQPC(x=>({...x,items:[{...x.items[0],[k]:v}]}));
          return<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><label className="form-label">SKU *</label><input className="form-input" value={it.sku} onChange={e=>up('sku',e.target.value)} placeholder="JJ0605"/></div>
            <div><label className="form-label">Brand</label><select className="form-select" value={it.vendor_id} onChange={e=>{const v=D_V.find(x=>x.id===e.target.value);const bn=v?.name||'';const rp=it.retail_price||0;const cat=it.category||'Tees';if(bn==='Adidas'&&rp>0){setQPC(x=>({...x,items:[{...x.items[0],vendor_id:e.target.value,brand:bn,nsa_cost:Math.round(rp*(cat==='Custom'?0.4125:0.375)*100)/100}]}))}else if(bn==='Under Armour'&&rp>0){setQPC(x=>({...x,items:[{...x.items[0],vendor_id:e.target.value,brand:bn,nsa_cost:Math.round(rp*0.425*100)/100}]}))}else{up('vendor_id',e.target.value);if(v)up('brand',v.name)}}}><option value="">Select...</option>{D_V.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div style={{gridColumn:'1/3'}}><label className="form-label">Product Name *</label><input className="form-input" value={it.name} onChange={e=>up('name',e.target.value)} placeholder="Adidas Practice Jersey 2.0"/></div>
            <div><label className="form-label">Color</label><input className="form-input" value={it.color} onChange={e=>up('color',e.target.value)} placeholder="Power Red/White"/></div>
            <div><label className="form-label">Category</label><select className="form-select" value={it.category} onChange={e=>{const cat=e.target.value;const bn=it.brand||D_V.find(x=>x.id===it.vendor_id)?.name||'';const rp=it.retail_price||0;if(bn==='Adidas'&&rp>0){setQPC(x=>({...x,items:[{...x.items[0],category:cat,nsa_cost:Math.round(rp*(cat==='Custom'?0.4125:0.375)*100)/100}]}))}else{up('category',cat)}}}>
              {['Tees','Polos','Hoodies','1/4 Zips','Shorts','Pants','Hats','Bags','Accessories','Jackets','Jerseys','Custom'].map(c=><option key={c}>{c}</option>)}</select></div>
            <div><label className="form-label">Retail Price</label><$In value={it.retail_price||0} onChange={v=>{const bn=it.brand||D_V.find(x=>x.id===it.vendor_id)?.name||'';const cat=it.category||'Tees';if(bn==='Adidas'){setQPC(x=>({...x,items:[{...x.items[0],retail_price:v,nsa_cost:Math.round(v*(cat==='Custom'?0.4125:0.375)*100)/100}]}))}else if(bn==='Under Armour'){setQPC(x=>({...x,items:[{...x.items[0],retail_price:v,nsa_cost:Math.round(v*0.425*100)/100}]}))}else{up('retail_price',v)}}}/></div>
            <div><label className="form-label">NSA Cost{(it.brand==='Adidas'||it.brand==='Under Armour')&&it.retail_price>0?<span style={{fontSize:9,color:'#16a34a',marginLeft:4}}>auto</span>:''}</label><$In value={it.nsa_cost||0} onChange={v=>{const bn=it.brand||D_V.find(x=>x.id===it.vendor_id)?.name||'';const cat=it.category||'Tees';if(bn==='Adidas'&&v>0){setQPC(x=>({...x,items:[{...x.items[0],nsa_cost:v,retail_price:Math.round(v/(cat==='Custom'?0.4125:0.375)*100)/100}]}))}else if(bn==='Under Armour'&&v>0){setQPC(x=>({...x,items:[{...x.items[0],nsa_cost:v,retail_price:Math.round(v/0.425*100)/100}]}))}else{up('nsa_cost',v)}}}/></div>
            <div style={{gridColumn:'1/3'}}><label className="form-label">Available Sizes</label>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','OSFA'].map(sz=>
                <button key={sz} className={`btn btn-sm ${(it.available_sizes||[]).includes(sz)?'btn-primary':'btn-secondary'}`} style={{fontSize:10,padding:'3px 8px'}}
                  onClick={()=>{const cur=it.available_sizes||[];up('available_sizes',cur.includes(sz)?cur.filter(s=>s!==sz):[...cur,sz])}}>{sz}</button>)}</div>
            </div>
          </div>})()}

        {qPC.mode==='multi'&&<>
          {qPC.items.map((it,i)=><div key={i} style={{padding:8,background:'#f8fafc',borderRadius:6,marginBottom:6}}>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <input className="form-input" value={it.sku} onChange={e=>setQPC(x=>({...x,items:x.items.map((ii,ix)=>ix===i?{...ii,sku:e.target.value}:ii)}))} placeholder="SKU" style={{width:90,fontSize:11}}/>
              <input className="form-input" value={it.name} onChange={e=>setQPC(x=>({...x,items:x.items.map((ii,ix)=>ix===i?{...ii,name:e.target.value}:ii)}))} placeholder="Product name" style={{flex:1,fontSize:11}}/>
              <select className="form-select" value={it.vendor_id||''} onChange={e=>{const bn=D_V.find(v=>v.id===e.target.value)?.name||'';setQPC(x=>({...x,items:x.items.map((ii,ix)=>{if(ix!==i)return ii;const upd={...ii,vendor_id:e.target.value,brand:bn};if(bn==='Adidas'&&ii.retail_price>0)upd.nsa_cost=Math.round(ii.retail_price*0.375*100)/100;else if(bn==='Under Armour'&&ii.retail_price>0)upd.nsa_cost=Math.round(ii.retail_price*0.425*100)/100;return upd})}))}} style={{width:100,fontSize:10}}>
                <option value="">Brand</option>{D_V.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
              <$In value={it.nsa_cost||0} onChange={v=>{const bn=it.brand||D_V.find(x=>x.id===it.vendor_id)?.name||'';setQPC(x=>({...x,items:x.items.map((ii,ix)=>{if(ix!==i)return ii;const upd={...ii,nsa_cost:v};if(bn==='Adidas'&&v>0)upd.retail_price=Math.round(v/0.375*100)/100;else if(bn==='Under Armour'&&v>0)upd.retail_price=Math.round(v/0.425*100)/100;return upd})}))}} w={50}/>
              <$In value={it.retail_price||0} onChange={v=>{const bn=it.brand||D_V.find(x=>x.id===it.vendor_id)?.name||'';setQPC(x=>({...x,items:x.items.map((ii,ix)=>{if(ix!==i)return ii;const upd={...ii,retail_price:v};if(bn==='Adidas')upd.nsa_cost=Math.round(v*0.375*100)/100;else if(bn==='Under Armour')upd.nsa_cost=Math.round(v*0.425*100)/100;return upd})}))}} w={50}/>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}} onClick={()=>setQPC(x=>({...x,items:x.items.filter((_,ix)=>ix!==i)}))}>×</button>
            </div>
          </div>)}
          <button className="btn btn-sm btn-secondary" onClick={()=>setQPC(x=>({...x,items:[...x.items,{sku:'',name:'',brand:'',color:'',category:'Tees',retail_price:0,nsa_cost:0,available_sizes:['S','M','L','XL','2XL'],vendor_id:''}]}))}>+ Add Row</button>
        </>}

        {qPC.mode==='bulk'&&<>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><div style={{fontSize:11,color:'#64748b'}}>Paste tab-separated: <strong>SKU, Name, Brand, Color, Cost, Retail, Sizes</strong> (one per line)</div><button className="btn btn-sm btn-secondary" onClick={()=>{const tpl="SKU\tName\tBrand\tColor\tCost\tRetail\tSizes\nJJ0605\tAdidas Practice 2.0\tAdidas\tPower Red\t20.81\t55.50\tS,M,L,XL,2XL\n1370399\tUnder Armour Team Polo\tUnder Armour\tCardinal/White\t27.63\t65.00\tS,M,L,XL,2XL";const blob=new Blob([tpl],{type:'text/tab-separated-values'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='product_upload_template.tsv';a.click();URL.revokeObjectURL(url)}} style={{fontSize:10,whiteSpace:'nowrap'}}>⬇ Download Template</button></div>
          <textarea className="form-input" rows={8} value={qPC.bulkRaw||''} onChange={e=>setQPC(x=>({...x,bulkRaw:e.target.value}))}
            placeholder={"JJ0605\tAdidas Practice 2.0\tAdidas\tPower Red\t21.00\t55.50\tS,M,L,XL,2XL\nHF7245\tAdidas Team Hoodie\tAdidas\tNavy\t28.50\t85.00\tS,M,L,XL,2XL"} style={{fontFamily:'monospace',fontSize:10}}/>
          <div style={{marginTop:6,padding:8,border:'2px dashed #d1d5db',borderRadius:6,textAlign:'center',fontSize:11,color:'#94a3b8',cursor:'pointer'}}
            onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=[...e.dataTransfer.files][0];if(f){const r=new FileReader();r.onload=ev=>setQPC(x=>({...x,bulkRaw:ev.target.result}));r.readAsText(f)}}}
            onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.csv,.tsv,.txt';inp.onchange=e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>setQPC(x=>({...x,bulkRaw:ev.target.result}));r.readAsText(f)}};inp.click()}}>
            📎 Drop CSV/TSV file or click to browse
          </div>
        </>}

        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button className="btn btn-primary" onClick={()=>{
            let toAdd=[];
            if(qPC.mode==='single'){const it=qPC.items[0];if(it.sku&&it.name)toAdd=[it]}
            else if(qPC.mode==='multi'){toAdd=qPC.items.filter(it=>it.sku&&it.name)}
            else if(qPC.mode==='bulk'&&qPC.bulkRaw){
              qPC.bulkRaw.trim().split('\n').forEach(line=>{
                const cols=line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c=>c.trim().replace(/^"|"$/g,''));
                if(cols.length>=2&&cols[0]){toAdd.push({sku:cols[0],name:cols[1],brand:cols[2]||'',color:cols[3]||'',
                  nsa_cost:parseFloat(cols[4])||0,retail_price:parseFloat(cols[5])||0,
                  available_sizes:cols[6]?cols[6].split(/[,\s]+/).map(s=>s.trim()).filter(Boolean):['S','M','L','XL','2XL'],
                  category:'Tees',vendor_id:''})}
              });
            }
            if(toAdd.length===0){nf('Enter at least one product with SKU and name');return}
            const newProds=toAdd.map((it,i)=>({id:'p'+(prod.length+i+1),vendor_id:it.vendor_id||D_V.find(v=>v.name===it.brand)?.id||'',
              sku:it.sku,name:it.name,brand:it.brand||D_V.find(v=>v.id===it.vendor_id)?.name||'',color:it.color||'',
              category:it.category||'Tees',retail_price:it.retail_price||0,nsa_cost:it.nsa_cost||0,
              available_sizes:it.available_sizes||['S','M','L','XL','2XL'],is_active:true,_inv:{}}));
            setProd(p=>[...p,...newProds]);
            setQPC({open:false,mode:'single',items:[{sku:'',name:'',brand:'',color:'',category:'Tees',retail_price:0,nsa_cost:0,available_sizes:['S','M','L','XL','2XL'],vendor_id:''}],bulkRaw:''});
            nf('📦 Added '+newProds.length+' product'+(newProds.length>1?'s':''));
          }}>{qPC.mode==='bulk'?'📥 Import Products':'💾 Save Product'+(qPC.mode==='multi'?'s':'')}</button>
          <button className="btn btn-secondary" onClick={()=>setQPC(x=>({...x,open:false}))}>Cancel</button>
        </div>
      </div>
    </div></div>}
  </div>);
}
