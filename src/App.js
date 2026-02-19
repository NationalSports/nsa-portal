/* eslint-disable */
import React, { useState, useMemo, useCallback } from 'react';
import './portal.css';
const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin'},{id:'r2',name:'Denis',role:'gm'},{id:'r3',name:'Liliana',role:'production'},{id:'r4',name:'Laura Chen',role:'rep'},{id:'r5',name:'Mike Torres',role:'rep'}];
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
  if(d.kind==='art'&&d.art_file_id&&artFiles){const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    if(art.deco_type==='screen_print'){const nc=art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1;const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(pq,nc,true)*u),cost:rQ(spP(pq,nc,false)*u)}}
    if(art.deco_type==='embroidery')return{sell:d.sell_override||emP(art.stitches||8000,pq,true),cost:emP(art.stitches||8000,pq,false)};
    if(art.deco_type==='dtf'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  // Legacy/fallback type-based
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(q,d.colors||1,true)*u),cost:rQ(spP(q,d.colors||1,false)*u)}}
  if(d.type==='embroidery')return{sell:d.sell_override||emP(d.stitches||8000,q,true),cost:emP(d.stitches||8000,q,false)};
  // Numbers
  if(d.kind==='numbers'||d.type==='number_press'){const nq=d.roster?Object.values(d.roster).flat().filter(v=>v&&v.trim()).length:q;return{sell:d.sell_override||npP(nq||1,d.two_color,true),cost:npP(nq||1,d.two_color,false)}};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}return{sell:0,cost:0}}
const SC={
  // SO statuses (3)
  need_order:{bg:'#fef3c7',c:'#92400e'},waiting_receive:{bg:'#dbeafe',c:'#1e40af'},complete:{bg:'#dcfce7',c:'#166534'},
  // Job item statuses
  need_to_order:{bg:'#fef3c7',c:'#92400e'},partially_received:{bg:'#fef9c3',c:'#854d0e'},items_received:{bg:'#d1fae5',c:'#065f46'},
  // Job production statuses
  staging:{bg:'#e0e7ff',c:'#3730a3'},in_process:{bg:'#dbeafe',c:'#1e40af'},completed:{bg:'#dcfce7',c:'#166534'},shipped:{bg:'#ede9fe',c:'#6d28d9'},
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
const safeFirm=(o)=>safeArr(o?.firm_dates);

// PICKS (demo)
const D_PICKS=[{id:'IF-4001',so_id:'SO-1042',status:'sent',items:1},{id:'IF-4002',so_id:'SO-1045',status:'pending',items:1}];
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
{id:'SO-1042',customer_id:'c1a',estimate_id:'EST-2088',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26',expected_date:'2026-03-15',production_notes:'Rush - coach needs by spring break',shipping_type:'flat',shipping_value:45,ship_to_id:'default',firm_dates:[{item_desc:'JX4453 - Adidas Pregame Tee',date:'03/01/26',approved:true}],
  art_files:[{id:'af1',name:'OLu Baseball Front Logo',deco_type:'screen_print',ink_colors:'Navy, Gold, White',thread_colors:'',art_size:'12" x 4"',files:['OLu_Baseball_Logo_v3.ai','OLu_Baseball_Logo_v3.pdf'],notes:'Final approved - navy/gold',status:'approved',uploaded:'02/10/26'},
    {id:'af2',name:'Sleeve Logo Small',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, Gold',art_size:'2" wide',files:['OLu_Sleeve_Logo.ai'],notes:'Small sleeve crest',status:'approved',uploaded:'02/11/26'}],
  items:[
    // Item 1: JX4453 — has pulled IF, open IF, PO with partial receive, and a waiting PO
    {sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',nsa_cost:18.5,retail_price:55.5,unit_sell:33.3,product_id:'p1',
      sizes:{S:5,M:20,L:15,XL:8,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[
        {pick_id:'IF-4100',S:5,M:8,L:5,XL:3,status:'pulled',created_at:'02/10/26',memo:'First pull — in-stock sizes'},
        {pick_id:'IF-4192',S:0,M:4,L:10,XL:5,'2XL':0,status:'pick',created_at:'02/14/26',memo:'Remaining stock sizes'}
      ],
      po_lines:[
        {po_id:'PO-3001',S:0,M:0,L:0,XL:0,'2XL':3,
          received:{'2XL':0},shipments:[],status:'waiting',created_at:'02/11/26',memo:'2XL backorder from Adidas'},
        {po_id:'PO-3088',S:0,M:8,L:0,XL:0,'2XL':0,
          received:{M:8},shipments:[{date:'2026-02-18',M:8}],status:'received',created_at:'02/12/26',memo:'Rush restock M sizes'}
      ],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af1',sell_override:null},{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,sell_override:null,roster:[]}]},
    // Item 2: HF7245 Hoodie — no picks/POs yet, has inventory, no deco marked
    {sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',nsa_cost:28.5,retail_price:85,unit_sell:51,product_id:'p2',
      sizes:{S:2,M:4,L:3,XL:2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[],no_deco:true,
      decorations:[]},
    // Item 3: PC61 Tee — ready to create IF (all inventory available)
    {sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,product_id:'p5',
      sizes:{S:10,M:15,L:10,XL:5},available_sizes:['S','M','L','XL','2XL','3XL'],
      pick_lines:[],po_lines:[],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af1',sell_override:3.25}]}
  ]},
{id:'SO-1045',customer_id:'c1b',memo:'Football Spring Practice Gear',status:'in_production',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26',expected_date:'2026-03-20',production_notes:'Need sizes confirmed by coach',shipping_type:'pct',shipping_value:8,ship_to_id:'default',firm_dates:[],
  art_files:[{id:'af4',name:'OLu Football Helmet Logo',deco_type:'screen_print',ink_colors:'Red, White',thread_colors:'',art_size:'10" x 8"',files:['OLu_Football.ai'],notes:'Waiting coach approval',status:'uploaded',uploaded:'02/13/26'}],
  items:[
    // Item 1: JX4453 — SAME product as SO-1042! Open IF will conflict when SO-1042 pulls
    {sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',nsa_cost:18.5,retail_price:55.5,unit_sell:33.3,product_id:'p1',
      sizes:{S:3,M:5,L:4,XL:2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[{pick_id:'IF-4200',S:3,M:5,L:4,XL:2,status:'pick',created_at:'02/15/26',memo:'Football pregame tees — stock pull'}],
      po_lines:[],
      decorations:[{kind:'art',position:'Front Center',art_file_id:'af4',sell_override:null}]},
    // Item 2: EK0100 — partial PO with cancellation scenario
    {sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',nsa_cost:25,retail_price:75,unit_sell:45,product_id:'p8',
      sizes:{S:2,M:6,L:8,XL:4,'2XL':2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],
      po_lines:[{po_id:'PO-3055',S:2,M:6,L:8,XL:4,'2XL':2,
        received:{S:2,M:6,L:8},
        cancelled:{XL:2},
        shipments:[{date:'2026-02-15',S:2,M:6,L:8}],
        status:'partial',created_at:'02/13/26',memo:'1/4 Zips order — Adidas direct'}],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af4',sell_override:null}]},
    // Item 3: Richardson Cap — fully pulled, no issues
    {sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',nsa_cost:4.5,retail_price:12,unit_sell:8,product_id:'p7',
      sizes:{OSFA:20},available_sizes:['OSFA'],
      pick_lines:[{pick_id:'IF-4150',OSFA:20,status:'pulled',created_at:'02/14/26',memo:'Trucker caps — blank, no deco'}],
      po_lines:[],no_deco:true,
      decorations:[]}
  ]},
{id:'SO-1051',customer_id:'c2a',memo:'Lacrosse Team Store',status:'in_production',created_by:'r4',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26',expected_date:'2026-03-10',production_notes:'Coach wants navy/silver colorway',shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:[],
  art_files:[{id:'af3',name:'SFL Lacrosse Crest',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, White, Silver 877',art_size:'3.5" wide',files:['SFL_Crest.eps','SFL_Crest_preview.png'],notes:'',status:'uploaded',uploaded:'02/15/26'}],
  items:[
    // Item 1: UA Polo — has inventory, ready for IF
    {sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,product_id:'p4',
      sizes:{M:4,L:6,XL:4,'2XL':2},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af3',sell_override:null},{kind:'numbers',position:'Upper Back',num_method:'heat_transfer',num_size:'3"',two_color:false,sell_override:null,roster:[]}]},
    // Item 2: UA Tech Short — partial inventory, needs PO for some sizes  
    {sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',nsa_cost:15.5,retail_price:45,unit_sell:27,product_id:'p9',
      sizes:{S:4,M:6,L:8,XL:4},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[],
      decorations:[]}
  ]},
// STRESS TEST DATA — intentionally messy/incomplete to test defensive coding
// SO with no items at all
{id:'SO-1060',customer_id:'c3a',memo:'Badminton Warm-ups',status:'in_production',created_by:'r5',created_at:'02/16/26 9:00 AM',updated_at:'02/16/26',expected_date:null,production_notes:'',shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:null,
  art_files:null,items:[]},
// SO with item that has no sizes, no decorations, no picks, no POs
{id:'SO-1061',customer_id:'c1a',memo:'Rush Order - Coach Martinez',status:'in_production',created_by:'r4',created_at:'02/17/26 8:00 AM',updated_at:null,expected_date:'2026-02-28',production_notes:null,shipping_type:null,shipping_value:null,ship_to_id:null,firm_dates:[],
  art_files:[],items:[
    {sku:'JX4453',name:'Adidas Pregame Tee',brand:'Adidas',color:null,nsa_cost:null,retail_price:null,unit_sell:28,product_id:'p1',
      sizes:{},available_sizes:null,pick_lines:null,po_lines:null,decorations:null},
    // Item with sizes but missing everything else
    {sku:'UNKNOWN_SKU',name:null,brand:null,color:'Red',nsa_cost:0,retail_price:0,unit_sell:0,product_id:null,
      sizes:{S:3,M:5},available_sizes:['S','M','L'],pick_lines:[],po_lines:[],decorations:[]},
  ]},
// SO referencing a customer that doesn't exist
{id:'SO-1062',customer_id:'c_deleted',memo:'Ghost Customer Order',status:'in_production',created_by:'r99',created_at:'',updated_at:'',expected_date:'',production_notes:'',shipping_type:'pct',shipping_value:0,ship_to_id:'default',firm_dates:[],
  art_files:[],items:[
    {sku:'PC61',name:'Port Company Tee',brand:'Port Company',color:'White',nsa_cost:3.80,retail_price:null,unit_sell:12,product_id:'p3',
      sizes:{S:10,M:10,L:10},available_sizes:['S','M','L','XL'],
      pick_lines:[{pick_id:'IF-9999',status:'pulled',S:10,M:10,L:10,created_at:null,memo:null}],
      po_lines:[],decorations:[{kind:'art',position:'Front Center',art_file_id:'af_missing',sell_override:null}]}
  ]},
// SO with jobs already generated but some jobs reference bad data  
{id:'SO-1063',customer_id:'c2',memo:'Track & Field Gear',status:'in_production',created_by:'r1',created_at:'02/15/26 4:00 PM',updated_at:'02/15/26',expected_date:'2026-04-01',production_notes:'Long lead time on custom colors',shipping_type:'flat',shipping_value:25,ship_to_id:'default',firm_dates:[{item_desc:'Full Order',date:'03/20/26',approved:false,requested_by:'r1',requested_at:'02/16/26',note:'Meet is April 5'}],
  art_files:[{id:'af_tf1',name:'SFL Track Logo',deco_type:'screen_print',ink_colors:'Navy, Gold',thread_colors:'',art_size:'10" wide',files:[],notes:'',status:'approved',uploaded:'02/15/26'}],
  items:[
    {sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Navy/Gold',nsa_cost:22,retail_price:65,unit_sell:42,product_id:'p4',
      sizes:{S:5,M:8,L:10,XL:6,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[{po_id:'PO-4001',vendor:'Under Armour',status:'waiting',S:5,M:8,L:10,XL:6,'2XL':3,received:{},ship_dates:[],created_at:'02/16/26',memo:'Custom color order'}],
      decorations:[{kind:'art',position:'Left Chest',art_file_id:'af_tf1',sell_override:null}]},
    {sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Navy',nsa_cost:15.5,retail_price:45,unit_sell:29,product_id:'p9',
      sizes:{S:5,M:8,L:10,XL:6,'2XL':3},available_sizes:['S','M','L','XL','2XL'],
      pick_lines:[],po_lines:[{po_id:'PO-4002',vendor:'Under Armour',status:'partial',S:5,M:8,L:10,XL:0,'2XL':0,received:{S:5,M:8,L:10},ship_dates:['02/20/26'],created_at:'02/16/26',memo:'Partial ship — XL/2XL backordered'}],
      decorations:[{kind:'art',position:'Left Leg',art_file_id:'af_tf1',sell_override:3}]}
  ],
  jobs:[
    {id:'JOB-1063-01',key:'art_af_tf1',art_file_id:'af_tf1',art_name:'SFL Track Logo',deco_type:'screen_print',
      positions:'Left Chest, Left Leg',art_status:'art_complete',item_status:'partially_received',prod_status:'hold',
      total_units:64,fulfilled_units:23,split_from:null,created_at:'02/16/26',
      items:[
        {item_idx:0,deco_idx:0,sku:'1370399',name:'Under Armour Team Polo',color:'Navy/Gold',units:32,fulfilled:0},
        {item_idx:1,deco_idx:0,sku:'1376844',name:'Under Armour Tech Short',color:'Navy',units:32,fulfilled:23},
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
const D_INV=[{id:'INV-1042',type:'invoice',customer_id:'c1a',date:'02/10/26',total:4200,paid:0,memo:'Baseball Deposit',status:'open'},{id:'INV-1038',type:'invoice',customer_id:'c2a',date:'01/28/26',total:3400,paid:0,memo:'Lacrosse Preseason',status:'open'},{id:'INV-1039',type:'invoice',customer_id:'c2a',date:'02/01/26',total:3400,paid:3400,memo:'Lacrosse Batch 1',status:'paid'}];

// SHARED UI
function Toast({msg,type='success'}){if(!msg)return null;return<div className={`toast toast-${type}`}>{msg}</div>}
function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}
function SearchSelect({options,value,onChange,placeholder}){const[open,setOpen]=useState(false);const[q,setQ]=useState('');const f=options.filter(o=>o.label.toLowerCase().includes(q.toLowerCase()));const sel=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}><span style={{flex:1,color:sel?'#0f172a':'#94a3b8'}}>{sel?sel.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}><div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {f.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}{f.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}</div>}</div>)}
function Bg({options,value,onChange}){return<div style={{display:'flex',gap:2,flexWrap:'wrap'}}>{options.map(o=><button key={o.value} className={`btn btn-sm ${String(value)===String(o.value)?'btn-primary':'btn-secondary'}`} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}
function $In({value,onChange,w=70}){return<span style={{display:'inline-flex',alignItems:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'2px 6px',background:'white'}}><span style={{fontSize:14,fontWeight:700,color:'#166534'}}>$</span><input value={value} onChange={e=>onChange(parseFloat(e.target.value)||0)} style={{width:w,border:'none',outline:'none',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center',background:'transparent'}}/></span>}
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
  let totalSz=0,coveredSz=0,fulfilledSz=0;
  safeItems(ord).forEach(it=>{
    Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
      totalSz+=v;
      const picked=safePicks(it).reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const poOrd=safePOs(it).reduce((a,pk)=>a+safeNum(pk[sz]),0);
      coveredSz+=Math.min(v,picked+poOrd);
      const pulledQty=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
      const rcvdQty=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
      fulfilledSz+=Math.min(v,pulledQty+rcvdQty);
    });
  });
  if(totalSz===0)return'need_order';
  if(fulfilledSz>=totalSz)return'complete';
  if(coveredSz<totalSz)return'need_order';
  return'waiting_receive';
}

function OrderEditor({order,mode,customer:ic,allCustomers,products,onSave,onBack,onConvertSO,cu,nf,msgs,onMsg,dirtyRef,onAdjustInv,allOrders,onInv}){
  const isE=mode==='estimate';const isSO=mode==='so';
  const[o,setO]=useState(order);const[cust,setCust]=useState(ic);const[pS,setPS]=useState('');const[showAdd,setShowAdd]=useState(false);
  const[tab,setTab]=useState('items');const[dirty,setDirty]=useState(false);const[selJob,setSelJob]=useState(null);const[jobNote,setJobNote]=useState('');const[msgDept,setMsgDept]=useState('all');
    const origRef=React.useRef(JSON.stringify(o));
    const markDirty=()=>setDirty(true);const[saved,setSaved]=useState(!!order.customer_id);const[showSend,setShowSend]=useState(false);const[showPick,setShowPick]=useState(false);const[pickId,setPickId]=useState(()=>'IF-'+String(4000+Math.floor(Math.random()*1000)));const[showPO,setShowPO]=useState(null);const[poCounter,setPOCounter]=useState(()=>3001+Math.floor(Math.random()*100));
  const[showFirmReq,setShowFirmReq]=useState(false);const[firmReqDate,setFirmReqDate]=useState('');const[firmReqNote,setFirmReqNote]=useState('');
  const[showInvCreate,setShowInvCreate]=useState(false);const[invSelItems,setInvSelItems]=useState([]);const[invMemo,setInvMemo]=useState('');const[invType,setInvType]=useState('deposit');
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
  const[newAddr,setNewAddr]=useState('');const[showNA,setShowNA]=useState(false);const[showSzPicker,setShowSzPicker]=useState(null);const[showCustom,setShowCustom]=useState(false);const[custItem,setCustItem]=useState({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,color:''});
  const sv=(k,v)=>{setO(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));setDirty(true)};
  const isAU=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';const tD={A:0.4,B:0.35,C:0.3};
  const selC=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);sv('customer_id',id);sv('default_markup',c.catalog_markup||1.65)}};
  const addP=p=>{const au=isAU(p.brand);const sell=au?rQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):rQ(p.nsa_cost*(o.default_markup||1.65));
    sv('items',[...o.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:[...p.available_sizes],_colors:p._colors||null,sizes:{},decorations:[]}]);setShowAdd(false);setPS('')};
  const uI=(i,k,v)=>sv('items',safeItems(o).map((it,x)=>x===i?{...it,[k]:v}:it));const rmI=i=>sv('items',safeItems(o).filter((_,x)=>x!==i));
  const uSz=(i,sz,v)=>{const n=v===''?0:parseInt(v)||0;uI(i,'sizes',{...o.items[i].sizes,[sz]:n})};
  const addSzToItem=(i,sz)=>{const it=o.items[i];if(!it.available_sizes.includes(sz))uI(i,'available_sizes',[...it.available_sizes,sz]);setShowSzPicker(null)};
  const NUM_SZ={heat_transfer:['1"','1.5"','2"','3"','4"','5"','6"','8"','10"'],embroidery:['0.5"','0.75"','1"','1.5"','2"'],screen_print:['4"','6"','8"','10"']};
  const addArtDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'art',position:'Front Center',art_file_id:null,sell_override:null}])};
  const addNumDeco=i=>{uI(i,'decorations',[...o.items[i].decorations,{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,sell_override:null,custom_font_art_id:null,roster:[]}])};
  const uD=(ii,di,k,v)=>{uI(ii,'decorations',o.items[ii].decorations.map((d,i)=>i===di?{...d,[k]:v}:d))};
  const rmD=(ii,di)=>{uI(ii,'decorations',o.items[ii].decorations.filter((_,i)=>i!==di))};
  // Art files (SO)
  const af=o.art_files||[];
  const addArt=()=>sv('art_files',[...af,{id:'af'+Date.now(),name:'',deco_type:'screen_print',ink_colors:'',thread_colors:'',art_size:'',files:[],notes:'',status:'uploaded',uploaded:new Date().toLocaleDateString()}]);
  const uArt=(i,k,v)=>sv('art_files',af.map((f,x)=>x===i?{...f,[k]:v}:f));
  const rmArt=i=>sv('art_files',af.filter((_,x)=>x!==i));
  const addFileToArt=i=>{const a=af[i];uArt(i,'files',[...a.files,'new_file_'+(a.files.length+1)+'.ai'])};

  const addrs=useMemo(()=>getAddrs(cust,allCustomers),[cust,allCustomers]);
  const artQty=useMemo(()=>{const m={};safeItems(o).forEach(it=>{const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){m[d.art_file_id]=(m[d.art_file_id]||0)+q}})});return m},[o]);
  const totals=useMemo(()=>{let rev=0,cost=0;safeItems(o).forEach(it=>{const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!q)return;rev+=q*safeNum(it.unit_sell);cost+=q*safeNum(it.nsa_cost);
    safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);rev+=q*dp.sell;cost+=q*dp.cost})});
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
        split_from:existing?.split_from||null,created_at:existing?.created_at||new Date().toLocaleDateString(),
        counted_at:existing?.counted_at||null,counted_by:existing?.counted_by||null,
        count_discrepancy:existing?.count_discrepancy||null,notes:existing?.notes||null,
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
  const statusFlow=['need_order','waiting_receive','complete'];

  return(<div>
    <button className="btn btn-secondary" onClick={()=>{if(dirty&&!window.confirm('You have unsaved changes. Leave without saving?'))return;onBack()}} style={{marginBottom:12}}><Icon name="back" size={14}/> {isE?'All Estimates':'All Sales Orders'}</button>
    {/* HEADER */}
    <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
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
        <button className="btn btn-primary" onClick={()=>{onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved`)}} style={{padding:'10px 28px',fontSize:16,fontWeight:800}}><Icon name="check" size={16}/> Save</button>
        {isE&&saved&&o.status!=='approved'&&o.status!=='converted'&&<button className="btn btn-secondary" onClick={()=>setShowSend(true)}><Icon name="send" size={14}/> Send</button>}
        {isE&&o.status==='approved'&&<button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>onConvertSO(o)}><Icon name="box" size={14}/> Convert to SO</button>}
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
      {/* SO STATUS — auto-calculated */}
      {isSO&&(()=>{
        const autoSt=calcSOStatus(o);
        const stLabels={need_order:'Need to Order',waiting_receive:'Waiting to Receive',complete:'Complete'};
        return<div style={{display:'flex',gap:8,marginTop:12,borderTop:'1px solid #f1f5f9',paddingTop:12,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#64748b',fontWeight:600}}>Order Status:</span>
          {statusFlow.map((sf,i)=>{const sc=SC[sf]||{};const si=statusFlow.indexOf(autoSt);const active=i<=si;const cur=i===si;
            return<span key={sf} style={{padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:cur?800:500,background:active?sc.bg:'#f8fafc',color:active?sc.c:'#94a3b8',border:cur?`2px solid ${sc.c}`:'1px solid #e2e8f0'}}>{stLabels[sf]||sf}</span>})}
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
      return(<div key={idx} className="card" style={{marginBottom:12}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>
                <span style={{fontWeight:700,fontSize:15}}>{item.name}</span>
                {item._colors?<select className="form-select" style={{fontSize:12,width:150}} value={item.color||item._colors[0]} onChange={e=>uI(idx,'color',e.target.value)}>{item._colors.map(c=><option key={c}>{c}</option>)}</select>:<span className="badge badge-gray">{item.color}</span>}
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4}}>
                <span style={{fontSize:12,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong></span>
                <span style={{fontSize:13}}>Sell: <$In value={item.unit_sell} onChange={v=>uI(idx,'unit_sell',v)}/>/ea</span>
                {!isAU(item.brand)&&<span style={{fontSize:11,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
              </div></div>
            <button onClick={()=>rmI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={16}/></button>
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
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',alignItems:'baseline',marginBottom:2}}>
                <span style={{fontSize:10,color:'#64748b'}}>Cost <strong style={{fontSize:12}}>${iC.toLocaleString(undefined,{maximumFractionDigits:0})}</strong></span>
                <span style={{fontSize:10,color:mg>=0?'#166534':'#dc2626'}}>Margin <strong style={{fontSize:12}}>${mg.toLocaleString(undefined,{maximumFractionDigits:0})}</strong> <span style={{fontSize:9}}>({iR>0?(mg/iR*100).toFixed(0):0}%)</span></span>
              </div>
              <div style={{display:'flex',gap:4,justifyContent:'flex-end',alignItems:'baseline'}}>
                <span style={{fontSize:10,color:'#64748b'}}>${qty>0?(iR/qty).toFixed(2):'-'}/ea</span>
                <span style={{fontSize:22,fontWeight:900,color:'#166534'}}>${iR.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
              </div>
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
            if(deco.kind==='art'){const artF=af.find(f=>f.id===deco.art_file_id);const artIcon=artF?(artF.deco_type==='screen_print'?'🎨':artF.deco_type==='embroidery'?'🧵':'🔥'):'';
              return(<div key={di} style={{padding:'10px 0',borderTop:di>0?'1px solid #f1f5f9':''}}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  {artF&&<div style={{position:'relative'}}><div style={{width:36,height:36,borderRadius:6,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,cursor:'pointer',border:'2px solid transparent'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}} title="Click to expand">{artIcon}</div>
                  <div style={{display:'none',position:'absolute',top:40,left:0,width:260,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:50,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{artF.name||'Untitled'}</div>
                    <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{artF.deco_type?.replace('_',' ')} {artF.art_size&&`· ${artF.art_size}`}</div>
                    {artF.ink_colors&&<div style={{fontSize:11,marginBottom:2}}><strong>Ink:</strong> {artF.ink_colors.split('\n').filter(l=>l.trim()).join(', ')}</div>}
                    {artF.thread_colors&&<div style={{fontSize:11,marginBottom:2}}><strong>Thread:</strong> {artF.thread_colors}</div>}
                    <div style={{fontSize:10,color:'#94a3b8',marginBottom:4}}>Files: {artF.files?.join(', ')||'none'}</div>
                    {artF.notes&&<div style={{fontSize:10,color:'#7c3aed'}}>{artF.notes}</div>}
                    <div style={{fontSize:10,marginTop:4,padding:'2px 6px',display:'inline-block',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e'}}>{artF.status}</div>
                  </div></div>}
                  <select className="form-select" style={{width:200,fontSize:12,border:!deco.art_file_id?'2px solid #f59e0b':'1px solid #22c55e'}} value={deco.art_file_id||''} onChange={e=>uD(idx,di,'art_file_id',e.target.value||null)}>
                    <option value="">⚠️ Select artwork...</option>{af.map(f=><option key={f.id} value={f.id}>{f.name||'Untitled'}</option>)}</select>
                  <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                  {artF&&<><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',color:artF.deco_type==='screen_print'?'#1e40af':artF.deco_type==='embroidery'?'#6d28d9':'#92400e'}}>{artF.deco_type.replace('_',' ')}</span>
                    {artF.ink_colors&&<span style={{fontSize:11,color:'#64748b'}}>{artF.ink_colors.split('\n').filter(l=>l.trim()).length} color(s)</span>}
                    {artF.thread_colors&&<span style={{fontSize:11,color:'#64748b'}}>Thread: {artF.thread_colors}</span>}
                    {artF.art_size&&<span style={{fontSize:11,color:'#94a3b8'}}>{artF.art_size}</span>}
                    {artF.deco_type==='screen_print'&&<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:deco.underbase?'#fef3c7':'transparent',borderRadius:4}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uD(idx,di,'underbase',e.target.checked)}/> Underbase</label>}
                    <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e'}}>{artF.status}</span></>}
                  <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:13}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                    <span style={{fontSize:13}}>Sell: <$In value={deco.sell_override||dp.sell} onChange={v=>uD(idx,di,'sell_override',v)} w={50}/></span>
                    <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                  </div></div></div>)}
            // NUMBERS decoration
            {const nm=deco.num_method||'heat_transfer';const szOpts=NUM_SZ[nm]||[];
            // Build roster grid from parent item sizes
            const sizedQtys=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
            const roster=deco.roster||{};
            return(<div key={di} style={{padding:'10px 0',borderTop:di>0?'1px solid #f1f5f9':''}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <div style={{width:36,height:36,borderRadius:6,background:'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>#️⃣</div>
                <span style={{fontWeight:700,fontSize:13}}>Numbers</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:13}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                  <span style={{fontSize:13}}>Sell: <$In value={deco.sell_override||dp.sell} onChange={v=>uD(idx,di,'sell_override',v)} w={50}/></span>
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
              {/* Roster grid by size */}
              <div style={{marginTop:6,padding:10,background:'#f8fafc',borderRadius:6,border:'1px dashed #d1d5db'}}>
                <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:6}}>Roster / Number Assignment</div>
                {sizedQtys.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes above first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {sizedQtys.map(([sz,sqty])=>{const szRoster=roster[sz]||[];return<div key={sz} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'#1e40af',width:40}}>{sz} ({sqty})</span>
                    {Array.from({length:sqty}).map((_,si)=><input key={si} style={{width:36,textAlign:'center',border:'1px solid #d1d5db',borderRadius:3,padding:'3px 2px',fontSize:12,fontWeight:600,background:szRoster[si]?'#dbeafe':'white'}} value={szRoster[si]||''} placeholder="—" onChange={e=>{const nr={...roster};const arr=[...(nr[sz]||Array(sqty).fill(''))];arr[si]=e.target.value;nr[sz]=arr;uD(idx,di,'roster',nr)}}/>)}
                  </div>})}
                </div>}
                <div style={{display:'flex',gap:4,marginTop:8}}>
                  <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>{const csv=prompt('Paste roster (one per line: Size,Number,Name):\ne.g.\nM,12,Smith\nL,34,Jones');if(csv){const nr={...roster};csv.split('\n').forEach(line=>{const[sz,num]=line.split(',').map(s=>s.trim());if(sz&&num){if(!nr[sz])nr[sz]=Array(item.sizes[sz]||0).fill('');const ei=nr[sz].findIndex(v=>!v);if(ei>=0)nr[sz][ei]=num}});uD(idx,di,'roster',nr);nf('Roster imported')}}}><Icon name="upload" size={10}/> Paste Roster</button>
                  <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>{uD(idx,di,'roster',{});nf('Roster cleared')}}>Clear All</button>
                </div></div>
            </div>)}})}
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>addArtDeco(idx)}><Icon name="image" size={12}/> + Add Art</button>
            <button className="btn btn-sm btn-secondary" onClick={()=>addNumDeco(idx)}>#️⃣ + Add Numbers</button>
            {safeDecos(item).length===0&&!item.no_deco&&<button className="btn btn-sm" style={{background:'#fef3c7',color:'#92400e',border:'1px solid #f59e0b',fontSize:10}} onClick={()=>uI(idx,'no_deco',true)}>✓ No Deco (Blank)</button>}
            {item.no_deco&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:4,background:'#f1f5f9',color:'#64748b',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>🚫 No Decoration <button onClick={()=>uI(idx,'no_deco',false)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:12,padding:0,marginLeft:2}}>✕</button></span>}
            {safeDecos(item).length===0&&!item.no_deco&&<span style={{fontSize:10,color:'#dc2626',fontWeight:600}}>⚠️ No deco assigned</span>}
          </div>
        </div>
      </div>)})}
    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAdd?<div style={{display:'flex',gap:6}}><button className="btn btn-primary" onClick={()=>setShowAdd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      <button className="btn btn-secondary" onClick={()=>setShowCustom(!showCustom)} disabled={!cust}><Icon name="plus" size={14}/> Custom Item</button></div>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search SKU, name, brand..." value={pS} onChange={e=>setPS(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:250,overflow:'auto'}}>{fp.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addP(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:600}}>{p.name}</span><span className="badge badge-blue">{p.brand}</span>
          {p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} clr</span>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>${p.nsa_cost?.toFixed(2)}</span></div>)}</div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('')}} style={{marginTop:8}}>Cancel</button>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setShowCustom(true)}} style={{marginTop:8,marginLeft:4}}>+ Custom Item</button></div>}
    </div></div>
    {showCustom&&<div className="card" style={{marginTop:8}}><div style={{padding:'14px 18px'}}>
      <div style={{fontWeight:700,marginBottom:8}}>Custom Item</div>
      <div style={{display:'grid',gridTemplateColumns:'120px 1fr 100px',gap:8,marginBottom:8}}>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Vendor</label><select className="form-select" value={custItem.vendor_id} onChange={e=>setCustItem(x=>({...x,vendor_id:e.target.value}))}><option value="">Select...</option>{D_V.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Item Name</label><input className="form-input" value={custItem.name} onChange={e=>setCustItem(x=>({...x,name:e.target.value}))} placeholder="Custom jersey, special order hat, etc."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Color</label><input className="form-input" value={custItem.color} onChange={e=>setCustItem(x=>({...x,color:e.target.value}))} placeholder="Navy"/></div></div>
      <div style={{display:'grid',gridTemplateColumns:'100px 100px 100px 1fr',gap:8,marginBottom:8}}>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>SKU (opt)</label><input className="form-input" value={custItem.sku} onChange={e=>setCustItem(x=>({...x,sku:e.target.value}))}/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Cost</label><$In value={custItem.nsa_cost} onChange={v=>setCustItem(x=>({...x,nsa_cost:v}))}/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Sell</label><$In value={custItem.unit_sell} onChange={v=>setCustItem(x=>({...x,unit_sell:v}))}/></div>
        <div style={{display:'flex',gap:4,alignItems:'end'}}><button className="btn btn-primary" disabled={!custItem.name} onClick={()=>{sv('items',[...o.items,{product_id:null,sku:custItem.sku||'CUSTOM',name:custItem.name,brand:D_V.find(v=>v.id===custItem.vendor_id)?.name||'Custom',vendor_id:custItem.vendor_id,color:custItem.color,nsa_cost:custItem.nsa_cost,retail_price:0,unit_sell:custItem.unit_sell,available_sizes:['S','M','L','XL','2XL'],sizes:{},decorations:[],is_custom:true}]);setShowCustom(false);setCustItem({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,color:''})}}>Add</button>
          <button className="btn btn-secondary" onClick={()=>setShowCustom(false)}>Cancel</button></div></div>
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
                  {/* FILES */}
                  <div style={{marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#64748b',marginBottom:4}}>Files ({art.files.length})</div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{art.files.map((fn,fi)=><span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#e0f2fe',borderRadius:4,fontSize:11}}>
                      <Icon name="file" size={10}/>{fn}<button onClick={()=>uArt(i,'files',art.files.filter((_,x)=>x!==fi))} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>)}</div>
                    <div style={{border:'2px dashed #d1d5db',borderRadius:6,padding:10,textAlign:'center',cursor:'pointer',background:'white'}} onClick={()=>addFileToArt(i)}>
                      <div style={{fontSize:11,color:'#64748b'}}><Icon name="upload" size={14}/> Drag & drop or click to add files (AI, EPS, PDF, PNG, JPG)</div></div>
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
            const inv={id:invId+'-'+(Date.now()%1000),type:'invoice',customer_id:o.customer_id,so_id:o.id,
              date:new Date().toLocaleDateString('en-CA'),total:Math.round(invTotal*100)/100,paid:0,
              memo:invMemo||invType+' — '+o.memo,status:'open',
              items:invSelItems.map(idx=>{const it=items[idx];return{sku:it.sku,name:it.name,qty:Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0),unit_sell:safeNum(it.unit_sell)}})};
            onInv(prev=>[...prev,inv]);
            setShowInvCreate(false);
            nf('Invoice '+inv.id+' created for $'+invTotal.toFixed(2));
          }}>💰 Create Invoice — ${invTotal.toFixed(2)}</button>
        </div>
      </div></div>})()}

    {showPO&&(()=>{
      // Vendor selection or PO form
      const vendors=[...new Set(safeItems(o).map(it=>it.vendor_id||it.brand).filter(Boolean))];
      const vendorMap={};safeItems(o).forEach((it,i)=>{const vk=it.vendor_id||D_V.find(v=>v.name===it.brand)?.id||it.brand;if(!vendorMap[vk])vendorMap[vk]=[];vendorMap[vk].push({...it,_idx:i})});
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
        </div></div></div>;
      // PO form for selected vendor — only show sizes that still need ordering (subtract picks + existing POs)
      const vItems=vendorMap[showPO]||[];const vn=D_V.find(v=>v.id===showPO)?.name||showPO;
      const poId='PO-'+poCounter;
      const poItems=vItems.map(it=>{const szList=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
        const openSizes=szList.map(([sz,v])=>{const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,open]}).filter(([,v])=>v>0);
        return{...it,openSizes,totalOpen:openSizes.reduce((a,[,v])=>a+v,0)}}).filter(it=>it.totalOpen>0);
      return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>New PO — {vn}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">
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
        <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setShowPO('select')}>← Back</button><button className="btn btn-secondary" onClick={()=>setShowPO(null)}>Cancel</button>{poItems.length>0&&<button className="btn btn-primary" onClick={()=>{
          // Save PO lines back to order items
          const updatedItems=[...o.items];
          poItems.forEach((pit,vi)=>{
            const idx=pit._idx;if(idx==null)return;
            const poLine={po_id:poId,status:'waiting',created_at:new Date().toLocaleDateString(),memo:'',received:{},shipments:[]};
            pit.openSizes.forEach(([sz,v])=>{
              const el=document.getElementById('po-qty-'+vi+'-'+sz);
              poLine[sz]=el?parseInt(el.value)||0:v;
            });
            const hasQty=Object.entries(poLine).some(([k,v])=>k!=='po_id'&&k!=='status'&&typeof v==='number'&&v>0);
            if(hasQty){
              if(!updatedItems[idx].po_lines)updatedItems[idx].po_lines=[];
              updatedItems[idx].po_lines.push(poLine);
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
        {showPick.map((item,vi)=>{const szList=Object.entries(item._pick).filter(([,v])=>v>0);const q=szList.reduce((a,[,v])=>a+v,0);const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
          return<div key={vi} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{item.sku}</span><strong>{item.name}</strong> — {item.color}</div><div style={{fontWeight:700}}>IF Qty: {q}</div></div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><thead><tr style={{borderBottom:'2px solid #0f172a'}}>{szList.map(([sz])=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:50}}>{sz}</th>)}<th style={{padding:'4px 8px'}}>TOTAL</th></tr></thead>
            <tbody><tr style={{fontSize:10,color:'#64748b'}}>{szList.map(([sz])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'2px 8px',textAlign:'center'}}>open: {open} | inv: {inv}</td>})}<td/></tr>
            <tr>{szList.map(([sz,v])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'4px 8px',textAlign:'center'}}><input style={{width:42,textAlign:'center',border:v<open?'2px solid #f59e0b':'1px solid #10b981',borderRadius:3,padding:'3px',fontSize:14,fontWeight:700,background:v<open?'#fef3c7':'#dcfce7'}} defaultValue={v}/></td>})}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800,fontSize:14}}>{q}</td></tr></tbody></table>
            {safeDecos(item).filter(d=>d.kind==='art').map((d,di)=>{const art=af.find(a=>a.id===d.art_file_id);return art?<div key={di} style={{fontSize:12,marginTop:6,padding:'4px 8px',background:'#f0fdf4',borderRadius:4}}>🎨 {art.name} — {art.deco_type} @ {d.position}{d.underbase?' [Underbase]':''}</div>:null})}
            {safeDecos(item).filter(d=>d.kind==='numbers').map((d,di)=><div key={di} style={{fontSize:12,marginTop:4,padding:'4px 8px',background:'#f0f9ff',borderRadius:4}}>#️⃣ Numbers — {d.num_method} {d.num_size} @ {d.position}</div>)}
          </div>})}
      </div>}
      <div className="modal-footer">
        {typeof showPick==='object'?<>
          <button className="btn btn-secondary" onClick={()=>setShowPick(true)}>← Back</button>
          <button className="btn btn-secondary" onClick={()=>window.print()}>🖨️ Print</button>
          <button className="btn btn-primary" onClick={()=>{
            // Save pick lines back to order items
            const updatedItems=[...o.items];
            showPick.forEach(pk=>{
              const idx=pk._idx;if(idx==null)return;
              const pickLine={...pk._pick,status:'pick',pick_id:pickId,created_at:new Date().toLocaleDateString(),memo:''};
              // Only add if there's actually qty to pick
              const hasQty=Object.entries(pickLine).some(([k,v])=>k!=='status'&&k!=='pick_id'&&v>0);
              if(hasQty){
                if(!updatedItems[idx].pick_lines)updatedItems[idx].pick_lines=[];
                updatedItems[idx].pick_lines.push(pickLine);
              }
            });
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
            setO(updated);onSave(updated);
            setShowPick(false);setPickId('IF-'+String(4000+Math.floor(Math.random()*1000)));nf(pickId+' sent to warehouse');
          }} style={{padding:'8px 20px',fontWeight:700}}>📦 Send to Warehouse</button>
        </>:<button className="btn btn-secondary" onClick={()=>setShowPick(false)}>Cancel</button>}
      </div>
    </div></div>}

    {/* JOBS TAB */}
    {isSO&&tab==='jobs'&&(()=>{
      const jobs=safeJobs(o);

      // Manual refresh recalculates everything
      const refreshJobs=()=>{sv('jobs',syncJobs());nf('Jobs synced')};

      // Split job — create partial job with received items
      const splitJob=(jIdx)=>{
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
          prod_status:j.art_status==='art_complete'?'staging':'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,total_units:j.total_units-rcvdTotal,fulfilled_units:0,item_status:'need_to_order'};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        sv('jobs',newJobs2);nf('Job split! '+splitId+' ready with '+rcvdTotal+' units');
      };
      const updJob=(jIdx,k,v)=>{sv('jobs',jobs.map((j,i)=>i===jIdx?{...j,[k]:v}:j))};
      const prodStatuses=['hold','staging','in_process','completed','shipped'];
      const prodLabels={hold:'On Hold',staging:'Staging',in_process:'In Process',completed:'Completed',shipped:'Shipped'};
      const artLabels={needs_art:'Needs Art',waiting_approval:'Waiting Approval',art_complete:'Art Complete'};
      const itemLabels={need_to_order:'Need to Order',partially_received:'Partially Received',items_received:'Items Received'};

      // Job detail view
      if(selJob!=null){
        const ji=selJob;const j=jobs[ji];
        if(!j)return<div className="card"><div className="card-body"><button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)}><Icon name="back" size={12}/> Back to Jobs</button><div style={{padding:20,color:'#94a3b8'}}>Job not found</div></div></div>;
        const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';
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
              {j.prod_status==='hold'&&!canProduce?<span style={{fontSize:11,color:'#94a3b8'}}>Waiting items/art</span>
              :<select className="form-select" style={{width:150,fontSize:11}} value={j.prod_status} onChange={e=>updJob(ji,'prod_status',e.target.value)}>
                {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>}
              <div style={{marginLeft:'auto'}}>
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
            const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';
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
              <td>{j.prod_status==='hold'&&!canProduce?<span style={{fontSize:10,color:'#94a3b8',fontStyle:'italic'}}>Waiting items/art</span>
                :<select style={{fontSize:10,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}} value={j.prod_status} onChange={e=>{e.stopPropagation();updJob(ji,'prod_status',e.target.value)}}>
                  {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>}</td>
              <td>{canSplit&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#7c3aed',color:'white',borderRadius:4}} onClick={e=>{e.stopPropagation();splitJob(ji)}} title="Split job">✂️</button>}</td>
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
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setEditPO(null)}>Close</button>
          <button className="btn btn-sm" style={{background:'#dc2626',color:'white'}} onClick={()=>{
            if(!window.confirm('Delete entire PO? All sizes will go back to open.'))return;
            const updatedItems=[...o.items];updatedItems[editPO.lineIdx].po_lines=updatedItems[editPO.lineIdx].po_lines.filter((_,i)=>i!==editPO.poIdx);
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPO(null);nf('PO deleted');
          }}><Icon name="trash" size={12}/> Delete PO</button>
        </div>
      </div></div>})()}

  </div>);
}

// CUSTOMER DETAIL
function CustDetail({customer:initCust,allCustomers,allOrders,onBack,onEdit,onSelCust,onNewEst,sos,msgs,cu,onOpenSO,ests}){
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
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Est</div><div className="stat-value">{customer._oe||0}</div></div><div className="stat-card"><div className="stat-label">Open SOs</div><div className="stat-value">{custSOs.filter(s=>calcSOStatus(s)!=='complete').length}</div></div><div className="stat-card"><div className="stat-label">Open Inv</div><div className="stat-value" style={{color:(customer._oi||0)>0?'#dc2626':''}}>{customer._oi||0}</div></div><div className="stat-card"><div className="stat-label">Balance</div><div className="stat-value" style={{color:(customer._ob||0)>0?'#dc2626':''}}>${(customer._ob||0).toLocaleString()}</div></div></div>
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
        const st=calcSOStatus(so);const stL={need_order:'Need to Order',waiting_receive:'Waiting to Receive',complete:'Complete'};
        let totalU=0,fulU=0;
        safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+(pk[sz]||0),0);const rQ=safePOs(it).reduce((a,pk)=>a+((pk.received||{})[sz]||0),0);fulU+=Math.min(v,pQ+rQ)})});
        const pct=totalU>0?Math.round(fulU/totalU*100):0;
        const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
        const jobs=so.jobs||[];
        const subC=allCustomers.find(c=>c.id===so.customer_id);
        const rep=REPS.find(r=>r.id===so.created_by);
        const jobArtLabels={needs_art:'Needs Art',waiting_approval:'Wait Approval',art_complete:'Art ✓'};
        const jobProdLabels={hold:'Hold',staging:'Staging',in_process:'In Process',completed:'Done',shipped:'Shipped'};
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
    const prodLabelsP={hold:'Queued',staging:'Ready for Production',in_process:'In Production',completed:'Done',shipped:'Shipped'};

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
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center'}} onClick={()=>{alert('✅ Art approved! (demo)');setPortalJobView(null)}}>✅ Approve</button>
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
  const[cust,setCust]=useState(D_C);const[vend]=useState(D_V);const[prod,setProd]=useState(D_P);
  const[ests,setEsts]=useState(D_E);const[sos,setSOs]=useState(D_SO);const[invs,setInvs]=useState(D_INV);
  const[msgs,setMsgs]=useState(D_MSG);const[cM,setCM]=useState({open:false,c:null});const[aM,setAM]=useState({open:false,p:null});
  const[q,setQ]=useState('');const[selC,setSelC]=useState(null);const[selV,setSelV]=useState(null);
  const[eEst,setEEst]=useState(null);const[eEstC,setEEstC]=useState(null);const[eSO,setESO]=useState(null);const[eSOC,setESOC]=useState(null);
  const[gQ,setGQ]=useState('');const[gOpen,setGOpen]=useState(false);const[mF,setMF]=useState('all');const[rF,setRF]=useState('all');const[pF,setPF]=useState({cat:'all',vnd:'all',stk:'all',clr:'all'});
  const[iS,setIS]=useState({f:'value',d:'desc'});const[iF,setIF]=useState({cat:'all',vnd:'all'});
  const dirtyRef=React.useRef(false);
  const[favSkus,setFavSkus]=useState(()=>{try{return JSON.parse(localStorage.getItem('nsa_fav_skus')||'[]')}catch{return[]}});
  const toggleFav=sku=>{setFavSkus(f=>{const n=f.includes(sku)?f.filter(s=>s!==sku):[...f,sku];try{localStorage.setItem('nsa_fav_skus',JSON.stringify(n))}catch{}return n})};
  const[iShowFav,setIShowFav]=useState(false);
  const cu=REPS[0];const isA=cu.role==='admin';
  const nf=(m,t='success')=>{setToast({msg:m,type:t});setTimeout(()=>setToast(null),3500)};
  const pars=useMemo(()=>cust.filter(c=>!c.parent_id),[cust]);const gK=useCallback(pid=>cust.filter(c=>c.parent_id===pid),[cust]);
  const cols=useMemo(()=>[...new Set(prod.map(p=>p.color).filter(Boolean))].sort(),[prod]);
  const savC=c=>{setCust(p=>{const e=p.find(x=>x.id===c.id);return e?p.map(x=>x.id===c.id?c:x):[...p,c]});nf('Saved')};
  const savE=e=>{setEsts(p=>{const ex=p.find(x=>x.id===e.id);return ex?p.map(x=>x.id===e.id?e:x):[...p,e]})};
  const savSO=s=>{setSOs(p=>{const ex=p.find(x=>x.id===s.id);return ex?p.map(x=>x.id===s.id?s:x):[...p,s]})};
  const savI=(pid,inv)=>{setProd(p=>p.map(x=>x.id===pid?{...x,_inv:inv}:x));nf('Updated')};
  const newE=(c,product)=>{const mk=c?.catalog_markup||1.65;const items=[];
    if(product){const au=product.brand==='Adidas'||product.brand==='Under Armour'||product.brand==='New Balance';const sell=au?rQ(product.retail_price*(1-(({A:0.4,B:0.35,C:0.3})[c?.adidas_ua_tier||'B']||0.35))):rQ(product.nsa_cost*mk);
      items.push({product_id:product.id,sku:product.sku,name:product.name,brand:product.brand,color:product.color,nsa_cost:product.nsa_cost,retail_price:product.retail_price,unit_sell:sell,available_sizes:[...product.available_sizes],_colors:product._colors||null,sizes:{},decorations:[]})}
    const e={id:'EST-'+(2100+ests.length),customer_id:c?.id||null,memo:'',status:'draft',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:mk,shipping_type:'pct',shipping_value:5,ship_to_id:'default',email_status:null,art_files:[],items};setEEst(e);setEEstC(c||null);setPg('estimates')};
  const convertSO=est=>{const fourWeeks=new Date();fourWeeks.setDate(fourWeeks.getDate()+28);const defExp=fourWeeks.toISOString().split('T')[0];const so={id:'SO-'+(1052+sos.length),customer_id:est.customer_id,estimate_id:est.id,memo:est.memo,status:'need_order',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:est.default_markup,expected_date:defExp,production_notes:'',shipping_type:est.shipping_type,shipping_value:est.shipping_value,ship_to_id:est.ship_to_id,firm_dates:[],art_files:[...(est.art_files||[])],items:safeItems(est).map(it=>({...it,decorations:safeDecos(it).map(d=>d.kind==='art'?{...d,art_file_id:null}:{...d})}))};
    setSOs(p=>[...p,so]);setEsts(p=>p.map(e=>e.id===est.id?{...e,status:'converted'}:e));setEEst(null);
    const c=cust.find(x=>x.id===so.customer_id);setESO(so);setESOC(c);setPg('orders');nf(`${so.id} created from ${est.id}`)};
  const aO=useMemo(()=>[
    ...ests.map(e=>{const t=e.items?.reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+v,0);let r=qq*it.unit_sell;it.decorations?.forEach(d=>{const dp=dP(d,qq,[],qq);r+=qq*dp.sell});return a+r},0)||0;return{id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0],total:t,memo:e.memo,status:e.status}}),
    ...sos.map(s=>{const t=s.items?.reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((ss,v)=>ss+v,0);return a+qq*(it.unit_sell||0)},0)||0;return{id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0],total:t,memo:s.memo,status:s.status}}),
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
    const unreadMsgs=(msgs||[]).filter(m=>!(m.read_by||[]).includes(cu.id));
    const myUnread=unreadMsgs.sort((a,b)=>(b.ts||'').localeCompare(a.ts)).slice(0,10);
    // Build to-do items from jobs and SOs
    const todos=[];
    sos.forEach(so=>{
      const c=cust.find(x=>x.id===so.customer_id);const tag=c?.alpha_tag||so.id;
      // Art needing approval
      safeJobs(so).forEach(j=>{
        if(j.art_status==='waiting_approval')todos.push({type:'art',priority:2,msg:'⏳ Art awaiting approval: '+j.art_name,detail:tag+' · '+so.id,so,action:'Review art'});
        if(j.item_status==='items_received'&&j.art_status==='art_complete'&&j.prod_status==='hold')todos.push({type:'schedule',priority:1,msg:'🏭 Ready to schedule: '+j.art_name,detail:tag+' · '+j.id,so,action:'Schedule job'});
        if(j.item_status==='partially_received'&&!j.split_from&&j.fulfilled_units>0)todos.push({type:'split',priority:3,msg:'✂️ Can split: '+j.art_name+' ('+j.fulfilled_units+'/'+j.total_units+')',detail:tag+' · '+j.id,so,action:'Review split'});
      });
      // Firm date requests pending
      safeFirm(so).filter(f=>!f.approved).forEach(f=>{todos.push({type:'firm',priority:2,msg:'📌 Firm date request: '+(f.item_desc||'Full order'),detail:tag+' · '+so.id+' · '+f.date,so,action:'Approve'})});
      // Deadline approaching
      if(so.expected_date){const dOut=Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24));
        if(dOut<=3&&dOut>=0&&calcSOStatus(so)!=='complete')todos.push({type:'deadline',priority:0,msg:'⚠️ Due in '+dOut+' day'+(dOut!==1?'s':'')+': '+(so.memo||so.id),detail:tag+' · '+so.expected_date,so,action:'Open SO'})};
      // Items needing order
      if(calcSOStatus(so)==='need_order')todos.push({type:'order',priority:2,msg:'🛒 Items need ordering: '+(so.memo||so.id),detail:tag,so,action:'Create PO'});
    });
    todos.sort((a,b)=>a.priority-b.priority);

    return(<>
    <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>!['completed','shipped'].includes(s.status)).length}</div></div><div className="stat-card"><div className="stat-label">Active Jobs</div><div className="stat-value" style={{color:'#7c3aed'}}>{(()=>{let n=0;sos.forEach(so=>{safeJobs(so).forEach(j=>{if(!['completed','shipped'].includes(j.prod_status))n++})});return n})()}</div></div><div className="stat-card"><div className="stat-label">Unread Msgs</div><div className="stat-value" style={{color:unreadMsgs.length>0?'#dc2626':''}}>{unreadMsgs.length}</div></div>
      {isA&&al.length>0&&<div className="stat-card" style={{borderColor:'#fbbf24'}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:'#d97706'}}>{al.length}</div></div>}</div>

    {/* Two column layout: To-Do + Messages */}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      {/* TO-DO LIST */}
      <div className="card"><div className="card-header"><h2>📋 To-Do ({todos.length})</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('jobs')}>All Jobs →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {todos.length===0?<div className="empty" style={{padding:20}}>All clear — nothing to do right now!</div>:
          todos.slice(0,12).map((t,i)=><div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>{if(t.so){setESO(t.so);setESOC(cust.find(cc=>cc.id===t.so.customer_id));setPg('orders')}}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600}}>{t.msg}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{t.detail}</div>
            </div>
            <span style={{fontSize:10,padding:'2px 8px',borderRadius:8,background:'#eff6ff',color:'#2563eb',fontWeight:600,whiteSpace:'nowrap'}}>{t.action}</span>
          </div>)}
        </div>
      </div>

      {/* UNREAD MESSAGES */}
      <div className="card"><div className="card-header"><h2>💬 Unread Messages ({unreadMsgs.length})</h2><button className="btn btn-sm btn-secondary" onClick={()=>setPg('messages')}>All Messages →</button></div>
        <div className="card-body" style={{padding:0,maxHeight:400,overflow:'auto'}}>
          {myUnread.length===0?<div className="empty" style={{padding:20}}>No unread messages</div>:
          myUnread.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const so=sos.find(s=>s.id===m.so_id);const c2=cust.find(cc=>cc.id===so?.customer_id);
            const DEPT_COLORS={art:'#7c3aed',production:'#2563eb',warehouse:'#d97706',sales:'#166534',accounting:'#dc2626'};
            return<div key={m.id} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>{if(so){setESO(so);setESOC(c2);setPg('orders')}setMsgs(msgs.map(mm=>mm.id===m.id?{...mm,read_by:[...new Set([...(mm.read_by||[]),cu.id])]}:mm))}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:2}}>
                <span style={{fontSize:12,fontWeight:700}}>{author?.name?.split(' ')[0]||'?'}</span>
                <span style={{fontSize:10,color:'#1e40af'}}>{so?.id}</span>
                {m.dept&&m.dept!=='all'&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:6,background:(DEPT_COLORS[m.dept]||'#64748b')+'20',color:DEPT_COLORS[m.dept]||'#64748b',fontWeight:600}}>@{m.dept}</span>}
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{m.ts}</span>
              </div>
              <div style={{fontSize:12,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.text}</div>
              {c2&&<div style={{fontSize:10,color:'#94a3b8'}}>{c2.alpha_tag} — {so?.memo}</div>}
            </div>})}
        </div>
      </div>
    </div>

    {isA&&al.length>0&&<div className="card" style={{marginBottom:16,borderLeft:'4px solid #d97706'}}><div className="card-header"><h2 style={{color:'#d97706'}}>Stock Alerts</h2></div>
      <div className="card-body" style={{padding:0}}><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Curr</th><th>Min</th><th>Need</th></tr></thead><tbody>
      {al.slice(0,6).map((a,i)=><tr key={i}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{a.p.sku}</td><td style={{fontSize:12}}>{a.p.name}</td><td><span className="badge badge-amber">{a.sz}</span></td><td style={{fontWeight:700,color:'#dc2626'}}>{a.c}</td><td>{a.min}</td><td style={{fontWeight:700}}>{a.need}</td></tr>)}</tbody></table></div></div>}
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-secondary" onClick={()=>{setPg('customers');setCM({open:true,c:null})}}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>setPg('jobs')}><Icon name="grid" size={14}/> View Jobs</button>
      <button className="btn btn-secondary" onClick={()=>setPg('messages')}><Icon name="mail" size={14}/> Messages</button></div></div>
    <div className="card"><div className="card-header"><h2>Recent Estimates</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Status</th><th>Email</th></tr></thead><tbody>
    {ests.slice(0,5).map(e=>{const c=cust.find(x=>x.id===e.customer_id);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c);setPg('estimates')}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?.name||'--'} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{e.memo}</td>
      <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
      <td><EmailBadge e={e}/></td></tr>)})}
    </tbody></table></div></div></>)};


  // ESTIMATES LIST
  const rEst=()=>{
    if(eEst)return<OrderEditor order={eEst} mode="estimate" customer={eEstC} allCustomers={cust} products={prod} onSave={e=>{savE(e);setEEst(e)}} onBack={()=>setEEst(null)} onConvertSO={convertSO} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs} dirtyRef={dirtyRef} onAdjustInv={savI} allOrders={sos} onInv={setInvs}/>;
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
    if(eSO)return<OrderEditor order={eSO} mode="so" customer={eSOC} allCustomers={cust} products={prod} onSave={s=>{savSO(s);setESO(s)}} onBack={()=>setESO(null)} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs} dirtyRef={dirtyRef} onAdjustInv={savI} allOrders={sos} onInv={setInvs}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{sos.length}</div></div><div className="stat-card"><div className="stat-label">Need Order</div><div className="stat-value" style={{color:'#d97706'}}>{sos.filter(s=>calcSOStatus(s)==='need_order').length}</div></div><div className="stat-card"><div className="stat-label">Waiting</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>calcSOStatus(s)==='waiting_receive').length}</div></div><div className="stat-card"><div className="stat-label">Complete</div><div className="stat-value" style={{color:'#166534'}}>{sos.filter(s=>calcSOStatus(s)==='complete').length}</div></div></div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Rep</th><th>Art</th><th>Items</th><th>Msgs</th><th>Status</th></tr></thead><tbody>
    {sos.map(so=>{const c=cust.find(x=>x.id===so.customer_id);const ac=(so.art_files||[]).length;const aa=(so.art_files||[]).filter(f=>f.status==='approved').length;const rep=REPS.find(r=>r.id===so.created_by);
      // Calculate fulfillment status
      const allItems=so.items||[];let totalSz=0,pickedSz=0,poSz=0,rcvdSz=0;
      allItems.forEach(it=>{Object.entries(it.sizes).filter(([,v])=>v>0).forEach(([sz,v])=>{totalSz+=v;
        pickedSz+=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);
        const poQty=safePOs(it).reduce((a,pk)=>a+(pk[sz]||0),0);poSz+=poQty;
        rcvdSz+=safePOs(it).reduce((a,pk)=>a+((pk.received||{})[sz]||0),0)})});
      const fulfilledSz=pickedSz+rcvdSz;
      const itemStatus=totalSz===0?null:fulfilledSz>=totalSz?'received':fulfilledSz>0?'partial':poSz>0?'on_order':'needs_items';
      return(<tr key={so.id} style={{cursor:'pointer'}} onClick={()=>{setESO(so);setESOC(c)}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td><td>{c?.name} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{so.memo}</td><td>{so.expected_date||'--'}</td>
      <td><span style={{fontSize:11,color:'#64748b'}}>{rep?.name?.split(' ')[0]||'—'}</span></td>
      <td>{ac>0?<span style={{fontSize:11}}>{aa}/{ac} ✓</span>:<span style={{fontSize:11,color:'#d97706'}}>—</span>}</td>
      <td>{itemStatus&&<span style={{fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:4,
        background:itemStatus==='received'?'#dcfce7':itemStatus==='partial'?'#fef3c7':itemStatus==='on_order'?'#dbeafe':'#fef2f2',
        color:itemStatus==='received'?'#166534':itemStatus==='partial'?'#92400e':itemStatus==='on_order'?'#1e40af':'#dc2626'}}>
        {itemStatus==='received'?'✓ All In':itemStatus==='partial'?fulfilledSz+'/'+totalSz:itemStatus==='on_order'?'On Order':'Needs Items'}</span>}</td>
      <td>{(()=>{const unread=msgs.filter(m=>m.so_id===so.id&&!(m.read_by||[]).includes(cu.id)).length;const total=msgs.filter(m=>m.so_id===so.id).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{unread} new</span>:total>0?<span style={{fontSize:11,color:'#94a3b8'}}>{total}</span>:null})()}</td>
      <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,background:SC[so.status]?.bg||'#f1f5f9',color:SC[so.status]?.c||'#475569'}}>{so.status.replace(/_/g,' ')}</span></td></tr>)})}
    </tbody></table></div></div></>);};

  // CUSTOMERS
  const rCust=()=>{
    if(selC)return<CustDetail customer={selC} allCustomers={cust} allOrders={aO} onBack={()=>setSelC(null)} onEdit={c=>{setCM({open:true,c});setCust(prev=>prev.map(pp=>pp.id===c.id?c:pp))}} onSelCust={c=>setSelC(c)} onNewEst={c=>newE(c)} sos={sos} msgs={msgs} cu={cu} onOpenSO={so=>{const c3=cust.find(cc=>cc.id===so.customer_id);setESO(so);setESOC(c3);setPg('orders')}} ests={ests}/>;
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
      safeJobs(so).forEach(j=>{allJobs.push({...j,so,soId:so.id,soMemo:so.memo,customer:c?.name||'Unknown',alpha:c?.alpha_tag||'',
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
    const STATUSES=[['hold','Hold'],['staging','Staging'],['in_process','In Process'],['completed','Completed'],['shipped','Shipped']];
    const toggleStatus=st=>{setJobFilters(prev=>{const ss=prev.statuses.includes(st)?prev.statuses.filter(s=>s!==st):[...prev.statuses,st];return{...prev,statuses:ss}})};
    const setJF=(k,v)=>setJobFilters(prev=>({...prev,[k]:v}));
    const toggleSort=f=>{if(jobSortField===f)setJobSortDir(d=>d==='asc'?'desc':'asc');else{setJobSortField(f);setJobSortDir('asc')}};
    const sortIcon=f=>jobSortField===f?(jobSortDir==='asc'?'↑':'↓'):'';
    return(<>
      {/* Filter bar */}
      <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:'12px 16px'}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
          <div className="search-bar" style={{flex:1,minWidth:200,maxWidth:300}}><Icon name="search"/><input placeholder="Search jobs, SKUs, customers..." value={jf.search} onChange={e=>setJF('search',e.target.value)}/></div>
          <select className="form-select" style={{width:130,fontSize:11}} value={jf.rep} onChange={e=>setJF('rep',e.target.value)}>
            <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
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
          <th>Art</th><th>Items</th><th>Production</th>
          <th style={{cursor:'pointer'}} onClick={()=>toggleSort('expected')}>Due {sortIcon('expected')}</th>
          <th>Counted</th>
        </tr></thead><tbody>
        {fj.map(j=>{const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
          return<tr key={j.id+j.soId} style={{cursor:'pointer',background:j.daysOut!=null&&j.daysOut<=3?'#fef2f2':undefined}} onClick={()=>{setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>
            <td style={{fontWeight:700,color:'#1e40af',fontSize:12}}>{j.id}</td>
            <td><div style={{fontWeight:600,fontSize:12}}>{j.art_name}</div><div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions}</div></td>
            <td style={{fontSize:12}}>{j.customer} <span className="badge badge-gray">{j.alpha}</span></td>
            <td style={{fontSize:11,color:'#64748b'}}>{j.soId}</td>
            <td style={{fontSize:11}}>{j.rep?.split(' ')[0]}</td>
            <td><span style={{fontWeight:700}}>{j.fulfilled_units}/{j.total_units}</span>
              <div style={{width:40,background:'#e2e8f0',borderRadius:3,height:4,marginTop:2}}><div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div></td>
            <td><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{j.art_status==='art_complete'?'Done':j.art_status==='waiting_approval'?'Waiting':'Need'}</span></td>
            <td style={{fontSize:11}}>{(j.items||[]).length} <span style={{color:'#94a3b8'}}>garment{(j.items||[]).length!==1?'s':''}</span></td>
            <td><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#64748b'}}>{j.prod_status?.replace(/_/g,' ')}</span></td>
            <td style={{fontSize:11,color:j.daysOut!=null&&j.daysOut<=7?'#dc2626':'#64748b',fontWeight:j.daysOut!=null&&j.daysOut<=3?700:400}}>{j.expected||'—'}{j.daysOut!=null&&j.daysOut<=3?' ⚠️':''}</td>
            <td>{j.counted_at?<span style={{fontSize:10,color:'#166534'}}>✅ {j.counted_by||''}</span>:<span style={{color:'#cbd5e1'}}>—</span>}</td>
          </tr>})}
        </tbody></table>}
      </div></div>
    </>);
  };

  // PRODUCTION BOARD
  const[prodView,setProdView]=useState('board');const[prodFilter,setProdFilter]=useState('all');
  const[prodSort,setProdSort]=useState({f:'expected',d:'asc'});const[prodStatF,setProdStatF]=useState('active');
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
    // Build flat list of ALL jobs across all SOs
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
    const byStatus=prodStatF==='active'?filtered.filter(j=>j.prod_status!=='completed'&&j.prod_status!=='shipped'):prodStatF==='all'?filtered:filtered.filter(j=>j.prod_status===prodStatF);
    const totalUnits=byStatus.reduce((a,j)=>a+j.total_units,0);
    const fulfilledUnits=byStatus.reduce((a,j)=>a+j.fulfilled_units,0);
    const needsArt=byStatus.filter(j=>j.art_status!=='art_complete').length;
    const inProcess=byStatus.filter(j=>j.prod_status==='in_process').length;
    const kanbanCols=[
      {id:'hold',label:'On Hold',color:'#94a3b8',bg:'#f8fafc'},
      {id:'staging',label:'Staging',color:'#d97706',bg:'#fffbeb'},
      {id:'in_process',label:'In Process',color:'#2563eb',bg:'#eff6ff'},
      {id:'completed',label:'Completed',color:'#166534',bg:'#f0fdf4'},
      {id:'shipped',label:'Shipped',color:'#6b7280',bg:'#f9fafb'},
    ];
    return(<>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:4}}>
          {[['active','Active'],['all','All'],['hold','Hold'],['staging','Staging'],['in_process','In Process'],['completed','Done']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${prodStatF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setProdStatF(v)}>{l}</button>)}
        </div>
        <select className="form-select" style={{width:140,fontSize:11}} value={prodFilter} onChange={e=>setProdFilter(e.target.value)}>
          <option value="all">All Reps</option>{REPS.filter(r=>r.role==='rep').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
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
          return<div key={col.id} style={{minWidth:240,flex:1,background:col.bg,borderRadius:8,padding:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
              <div style={{width:10,height:10,borderRadius:10,background:col.color}}/>
              <span style={{fontSize:12,fontWeight:700,color:col.color,textTransform:'uppercase'}}>{col.label}</span>
              <span style={{fontSize:11,color:'#94a3b8',marginLeft:'auto'}}>{colJobs.length}</span>
            </div>
            {colJobs.length===0&&<div style={{padding:16,textAlign:'center',color:'#cbd5e1',fontSize:12}}>No jobs</div>}
            {colJobs.map(j=>{
              const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
              return<div key={j.id+j.soId} className="card hover-card" style={{marginBottom:8,cursor:'pointer',border:j.daysOut!=null&&j.daysOut<=3?'2px solid #dc2626':undefined}} onClick={()=>{setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>
                <div style={{padding:'10px 12px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    <span style={{fontWeight:800,color:'#1e40af',fontSize:12}}>{j.id}</span>
                    <span style={{fontSize:10,color:'#64748b',flex:1}}>{j.alpha}</span>
                    <span style={{padding:'1px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}}>{j.art_status==='art_complete'?'✅':j.art_status==='waiting_approval'?'⏳':'🎨'}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:600,marginBottom:2}}>{j.art_name}</div>
                  <div style={{fontSize:10,color:'#64748b',marginBottom:4}}>{j.deco_type?.replace(/_/g,' ')} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''} · {j.soId}</div>
                  <div style={{background:'#e2e8f0',borderRadius:4,height:5,marginBottom:4,overflow:'hidden'}}>
                    <div style={{height:5,borderRadius:4,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%'}}/></div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#64748b'}}>
                    <span>{j.fulfilled_units}/{j.total_units} units</span>
                    {j.expected&&<span style={{color:j.daysOut!=null&&j.daysOut<=7?'#dc2626':'#64748b'}}>📅 {j.expected}</span>}
                  </div>
                  {j.counted_at&&<div style={{fontSize:9,color:'#166534',marginTop:3}}>✅ Counted</div>}
                </div></div>})}
          </div>})}
      </div>}
      {prodView==='list'&&<div className="card"><div className="card-body" style={{padding:0}}>
        <table><thead><tr><th>Job</th><th>Artwork</th><th>Customer</th><th>SO</th><th>Rep</th><th>Units</th><th>Art</th><th>Items</th><th>Production</th><th>Expected</th></tr></thead><tbody>
        {byStatus.map(j=>{const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
          return<tr key={j.id+j.soId} style={{cursor:'pointer'}} onClick={()=>{setESO(j.so);setESOC(cust.find(c2=>c2.id===j.so.customer_id));setPg('orders')}}>
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
    </>);
  };

  // MESSAGES PAGE
  const rMsg=()=>{const allM=[...msgs].sort((a,b)=>(b.ts||'').localeCompare(a.ts));
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
  const nav=[{section:'Overview'},{id:'dashboard',label:'Dashboard',icon:'home'},{section:'Sales'},{id:'estimates',label:'Estimates',icon:'dollar'},{id:'orders',label:'Sales Orders',icon:'box'},{section:'Production'},{id:'jobs',label:'Jobs',icon:'grid'},{id:'production',label:'Prod Board',icon:'package'},{section:'People'},{id:'customers',label:'Customers',icon:'users'},{id:'vendors',label:'Vendors',icon:'building'},{section:'Comms'},{id:'messages',label:'Messages',icon:'mail'},{section:'Catalog'},{id:'products',label:'Products',icon:'package'},{id:'inventory',label:'Inventory',icon:'warehouse'}];
  const titles={dashboard:'Dashboard',estimates:'Estimates',orders:'Sales Orders',jobs:'Jobs',production:'Production Board',customers:'Customers',vendors:'Vendors',products:'Products',inventory:'Inventory',messages:'Messages'};
  return(<div className="app"><Toast msg={toast?.msg} type={toast?.type}/>
    <div className="sidebar"><div className="sidebar-logo">NSA<span>Portal</span></div>
      <nav className="sidebar-nav">{nav.map((item,i)=>{if(item.section)return<div key={i} className="sidebar-section">{item.section}</div>;
        const ubadge=item.id==='messages'?msgs.filter(m=>!(m.read_by||[]).includes(cu.id)).length:0;
        return<button key={item.id} className={`sidebar-link ${pg===item.id?'active':''}`}
          onClick={()=>{if(dirtyRef.current&&!window.confirm('You have unsaved changes. Leave without saving?'))return;dirtyRef.current=false;setPg(item.id);setQ('');setSelC(null);setSelV(null);setEEst(null);setESO(null)}}><Icon name={item.icon}/>{item.label}{ubadge>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:'auto'}}>{ubadge}</span>}</button>})}</nav>
      <div className="sidebar-user"><div style={{fontWeight:600,color:'#e2e8f0'}}>{cu.name}</div><div>{cu.role}</div></div></div>
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
        <div style={{display:'flex',gap:6,alignItems:'center'}}><button className="btn btn-sm btn-primary" onClick={()=>newE(null)} style={{fontSize:11}}><Icon name="plus" size={12}/> Estimate</button><button className="btn btn-sm btn-secondary" onClick={()=>setCM({open:true,c:null})} style={{fontSize:11}}><Icon name="plus" size={12}/> Customer</button></div></div>
      <div className="content">{pg==='dashboard'&&rDash()}{pg==='estimates'&&rEst()}{pg==='orders'&&rSO()}{pg==='jobs'&&rJobs()}{pg==='production'&&rProd2()}{pg==='customers'&&rCust()}{pg==='vendors'&&rVend()}{pg==='products'&&rProd()}{pg==='inventory'&&rInv()}{pg==='messages'&&rMsg()}</div></div>
    <CustModal isOpen={cM.open} onClose={()=>setCM({open:false,c:null})} onSave={savC} customer={cM.c} parents={pars}/>
    <AdjModal isOpen={aM.open} onClose={()=>setAM({open:false,p:null})} product={aM.p} onSave={savI}/>
  </div>);
}
