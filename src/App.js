import React, { useState, useMemo, useCallback } from 'react';
import './portal.css';
const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin'},{id:'r2',name:'Laura Chen',role:'rep'},{id:'r3',name:'Mike Torres',role:'rep'}];
const CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
const CONTACT_ROLES=['Head Coach','Assistant','Accounting','Athletic Director','Primary','Other'];
const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];
const EXTRA_SIZES=['XS','3XL','4XL','LT','XLT','2XLT','3XLT'];
const rQ=v=>Math.round(v*4)/4;
const showSz=(s,inv)=>{const c=['S','M','L','XL','2XL'];if(c.includes(s))return true;return!EXTRA_SIZES.includes(s)||(inv||0)>0};
const SP={bk:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],pr:{0:[50,60,70,null,null],1:[5,6.5,8,9,null],2:[3.5,4.5,6,7,8],3:[3.2,4.25,4.75,6,7.5],4:[2.95,3.85,4.25,5,6],5:[2.75,3.5,3.95,4.5,5.25],6:[2.5,3.2,3.7,4,4.75],7:[2.25,3,3.5,3.75,4.25],8:[2.1,2.85,3.1,3.3,4],9:[1.9,2.75,2.9,3.1,3.75]},mk:1.5,ub:0.15};
const EM={sb:[10000,15000,20000,999999],qb:[6,24,48,99999],pr:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],mk:1.6};
const NP={bk:[10,50,99999],co:[4,3,3],se:[7,6,5],tc:3};const DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];
function spP(q,c,s=true){const bi=SP.bk.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.pr[bi]?.[c-1];if(v==null)return 0;return s?v:rQ(v/SP.mk)}
function emP(st,q,s=true){const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.pr[si][qi];return s?v:rQ(v/EM.mk)}
function npP(q,tw=false,s=true){const bi=NP.bk.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.se[bi]+(tw?rQ(NP.tc*1.65):0)):(NP.co[bi]+(tw?NP.tc:0))}
function dP(d,q,artFiles){
  // Art-based decoration: get type from art file
  if(d.kind==='art'&&d.art_file_id&&artFiles){const art=artFiles.find(a=>a.id===d.art_file_id);if(art){
    if(art.deco_type==='screen_print'){const nc=art.ink_colors?art.ink_colors.split('\n').filter(l=>l.trim()).length:1;const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(q,nc,true)*u),cost:rQ(spP(q,nc,false)*u)}}
    if(art.deco_type==='embroidery')return{sell:d.sell_override||emP(art.stitches||8000,q,true),cost:emP(art.stitches||8000,q,false)};
    if(art.deco_type==='dtf'){const t=DTF[art.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}}}
  // Legacy/fallback type-based
  if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||rQ(spP(q,d.colors||1,true)*u),cost:rQ(spP(q,d.colors||1,false)*u)}}
  if(d.type==='embroidery')return{sell:d.sell_override||emP(d.stitches||8000,q,true),cost:emP(d.stitches||8000,q,false)};
  // Numbers
  if(d.kind==='numbers'||d.type==='number_press')return{sell:d.sell_override||npP(q,d.two_color,true),cost:npP(q,d.two_color,false)};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}return{sell:0,cost:0}}
const SC={waiting_art:{bg:'#fef3c7',c:'#92400e'},in_production:{bg:'#dbeafe',c:'#1e40af'},ready_ship:{bg:'#dcfce7',c:'#166534'},shipped:{bg:'#ede9fe',c:'#6d28d9'},completed:{bg:'#f1f5f9',c:'#475569'}};

// DATA
const D_C=[
{id:'c1',parent_id:null,name:'Orange Lutheran High School',alpha_tag:'OLu',contacts:[{name:'Athletic Director',email:'athletics@orangelutheran.org',phone:'714-555-0100',role:'Athletic Director'},{name:'Janet Wu',email:'jwu@orangelutheran.org',phone:'714-555-0109',role:'Accounting'}],billing_address_line1:'2222 N Santiago Blvd',billing_city:'Orange',billing_state:'CA',billing_zip:'92867',shipping_address_line1:'2222 N Santiago Blvd',shipping_city:'Orange',shipping_state:'CA',shipping_zip:'92867',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.0775,primary_rep_id:'r1',is_active:true,_oe:1,_os:2,_oi:1,_ob:4200},
{id:'c1a',parent_id:'c1',name:'OLu Baseball',alpha_tag:'OLuB',contacts:[{name:'Coach Martinez',email:'martinez@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_address_line1:'2222 N Santiago Blvd - Field House',shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:0,_os:1,_oi:1,_ob:4200},
{id:'c1b',parent_id:'c1',name:'OLu Football',alpha_tag:'OLuF',contacts:[{name:'Coach Davis',email:'davis@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_address_line1:'2222 N Santiago Blvd - Athletics',shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:1,_os:1,_oi:0,_ob:0},
{id:'c1c',parent_id:'c1',name:'OLu Track & Field',alpha_tag:'OLuT',contacts:[{name:'Coach Chen',email:'chen@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_oe:0,_os:0,_oi:0,_ob:0},
{id:'c2',parent_id:null,name:'St. Francis High School',alpha_tag:'SF',contacts:[{name:'AD Office',email:'ad@stfrancis.edu',phone:'818-555-0200',role:'Athletic Director'}],billing_city:'La Canada',billing_state:'CA',shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.095,primary_rep_id:'r2',is_active:true,_oe:0,_os:1,_oi:2,_ob:6800},
{id:'c2a',parent_id:'c2',name:'St. Francis Lacrosse',alpha_tag:'SFL',contacts:[{name:'Coach Resch',email:'resch@stfrancis.edu',phone:'',role:'Head Coach'}],shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r2',is_active:true,_oe:0,_os:1,_oi:2,_ob:6800},
{id:'c3',parent_id:null,name:'Clovis Unified School District',alpha_tag:'CUSD',contacts:[{name:'District Office',email:'purchasing@clovisusd.k12.ca.us',phone:'559-555-0300',role:'Primary'}],billing_city:'Clovis',billing_state:'CA',shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',tax_rate:0.0863,primary_rep_id:'r3',is_active:true,_oe:2,_os:0,_oi:0,_ob:0},
{id:'c3a',parent_id:'c3',name:'Clovis High Badminton',alpha_tag:'CHBad',contacts:[{name:'Coach Kim',email:'kim@clovisusd.k12.ca.us',phone:'',role:'Head Coach'}],shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',primary_rep_id:'r3',is_active:true,_oe:2,_os:0,_oi:0,_ob:0},
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
{id:'p1',vendor_id:'v1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',category:'Tees',retail_price:55.5,nsa_cost:18.5,available_sizes:['XS','S','M','L','XL','2XL'],is_active:true,_inv:{XS:0,S:12,M:8,L:5,XL:3,'2XL':0},_alerts:{S:10,M:10,L:8,XL:5}},
{id:'p2',vendor_id:'v1',sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',category:'Hoodies',retail_price:85,nsa_cost:28.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:3,M:6,L:4,XL:2,'2XL':0}},
{id:'p4',vendor_id:'v2',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',category:'Polos',retail_price:65,nsa_cost:22,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:10,L:15,XL:12,'2XL':8}},
{id:'p5',vendor_id:'v3',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',category:'Tees',retail_price:8.98,nsa_cost:2.85,available_sizes:['S','M','L','XL','2XL','3XL'],is_active:true,_inv:{S:20,M:15,L:10,XL:5,'2XL':0,'3XL':0},_colors:['Jet Black','Navy','Red','White','Athletic Heather','Royal','Forest Green','Charcoal']},
{id:'p6',vendor_id:'v3',sku:'K500',name:'Port Authority Silk Touch Polo',brand:'Port Authority',color:'Navy',category:'Polos',retail_price:22.98,nsa_cost:8.2,available_sizes:['XS','S','M','L','XL','2XL','3XL','4XL'],is_active:true,_inv:{},_colors:['Navy','Black','White','Red','Royal','Dark Green']},
{id:'p7',vendor_id:'v5',sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',category:'Hats',retail_price:12,nsa_cost:4.5,available_sizes:['OSFA'],is_active:true,_inv:{OSFA:50},_colors:['Black/White','Navy/White','Red/White']},
{id:'p8',vendor_id:'v1',sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',category:'1/4 Zips',retail_price:75,nsa_cost:25,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:2,M:7,L:9,XL:5,'2XL':1}},
{id:'p9',vendor_id:'v2',sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',category:'Shorts',retail_price:45,nsa_cost:15.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:4,L:6,XL:3,'2XL':0}},
];
const D_E=[
{id:'EST-2089',customer_id:'c1b',memo:'Spring 2026 Football Camp Tees',status:'sent',created_by:'r1',created_at:'02/10/26 9:15 AM',updated_at:'02/10/26 2:30 PM',default_markup:1.65,shipping_type:'pct',shipping_value:8,ship_to_id:'default',email_status:'opened',email_opened_at:'02/10/26 3:45 PM',art_files:[],items:[{product_id:'p5',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,sizes:{S:8,M:15,L:20,XL:12,'2XL':5},available_sizes:['S','M','L','XL','2XL','3XL'],_colors:['Jet Black','Navy','Red','White'],decorations:[{kind:'art',position:'Front Center',art_file_id:null,sell_override:null},{kind:'art',position:'Back Center',art_file_id:null,sell_override:null}]}]},
{id:'EST-2094',customer_id:'c1b',memo:'Football Coaches Polos',status:'approved',created_by:'r1',created_at:'02/16/26 10:00 AM',updated_at:'02/16/26 10:00 AM',default_markup:1.65,shipping_type:'flat',shipping_value:25,ship_to_id:'default',email_status:'viewed',email_opened_at:'02/16/26 11:30 AM',email_viewed_at:'02/16/26 11:32 AM',art_files:[],items:[{product_id:'p4',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,sizes:{M:2,L:3,XL:2,'2XL':1},available_sizes:['S','M','L','XL','2XL'],decorations:[{kind:'art',position:'Left Chest',art_file_id:null,sell_override:null}]}]},
{id:'EST-2101',customer_id:'c3a',memo:'Badminton Team Uniforms',status:'draft',created_by:'r3',created_at:'02/12/26 3:00 PM',updated_at:'02/12/26 3:00 PM',default_markup:1.65,shipping_type:'pct',shipping_value:0,ship_to_id:'default',email_status:null,art_files:[],items:[]},
];
const D_SO=[
{id:'SO-1042',customer_id:'c1a',estimate_id:'EST-2088',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26',expected_date:'03/15/26',production_notes:'Rush - coach needs by spring break',shipping_type:'flat',shipping_value:45,ship_to_id:'default',firm_dates:[{item_desc:'JX4453 - Adidas Pregame Tee',date:'03/01/26',approved:true}],
  art_files:[{id:'af1',name:'OLu Baseball Front Logo',deco_type:'screen_print',ink_colors:'Navy, Gold, White',thread_colors:'',art_size:'12" x 4"',files:['OLu_Baseball_Logo_v3.ai','OLu_Baseball_Logo_v3.pdf'],notes:'Final approved - navy/gold',status:'approved',uploaded:'02/10/26'},
    {id:'af2',name:'Sleeve Logo Small',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, Gold',art_size:'2" wide',files:['OLu_Sleeve_Logo.ai'],notes:'Small sleeve crest',status:'approved',uploaded:'02/11/26'}],
  items:[{sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',nsa_cost:18.5,retail_price:55.5,unit_sell:33.3,sizes:{S:5,M:12,L:15,XL:8,'2XL':3},available_sizes:['S','M','L','XL','2XL'],ful:'pick',checked:{S:5,M:10,L:12,XL:6,'2XL':3},decorations:[{kind:'art',position:'Front Center',art_file_id:'af1',sell_override:null},{kind:'numbers',position:'Back Center',num_method:'heat_transfer',num_size:'4"',two_color:false,sell_override:null,roster:[]}]}]},
{id:'SO-1045',customer_id:'c1b',memo:'Football Spring Practice Gear',status:'waiting_art',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26',expected_date:'03/20/26',production_notes:'',shipping_type:'pct',shipping_value:8,ship_to_id:'default',firm_dates:[],art_files:[],items:[]},
{id:'SO-1051',customer_id:'c2a',memo:'Lacrosse Team Store',status:'in_production',created_by:'r2',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26',expected_date:'03/10/26',production_notes:'',shipping_type:'flat',shipping_value:0,ship_to_id:'default',firm_dates:[],art_files:[{id:'af3',name:'SFL Lacrosse Crest',deco_type:'embroidery',ink_colors:'',thread_colors:'Navy 2767, White, Silver 877',art_size:'3.5" wide',files:['SFL_Crest.eps','SFL_Crest_preview.png'],notes:'',status:'uploaded',uploaded:'02/15/26'}],items:[]},
];
const D_MSG=[
{id:'m1',so_id:'SO-1042',author_id:'r1',text:'Coach Martinez confirmed navy/gold for front logo. Approved the proof.',ts:'02/10/26 11:30 AM',read_by:['r1','r2']},
{id:'m2',so_id:'SO-1042',author_id:'r3',text:'Warehouse: we have 30 of JX4453 in stock, rest need to be ordered from Adidas.',ts:'02/11/26 9:15 AM',read_by:['r3']},
{id:'m3',so_id:'SO-1042',author_id:'r1',text:'PO placed with Adidas for remaining sizes. Expected 02/20.',ts:'02/11/26 2:00 PM',read_by:['r1']},
{id:'m4',so_id:'SO-1042',author_id:'r2',text:'@Steve - coach called, needs jerseys by 3/10 not 3/15. Can we rush?',ts:'02/14/26 10:00 AM',read_by:['r2']},
{id:'m5',so_id:'SO-1042',author_id:'r1',text:'Updated expected date. Adidas confirmed they can expedite.',ts:'02/14/26 11:30 AM',read_by:['r1']},
{id:'m6',so_id:'SO-1045',author_id:'r1',text:'Waiting on Coach Davis for logo approval. Sent follow-up email.',ts:'02/13/26 3:00 PM',read_by:['r1']},
{id:'m7',so_id:'SO-1051',author_id:'r2',text:'Crest file from coach is low-res. Need vector version.',ts:'02/15/26 11:00 AM',read_by:['r2']},
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
function OrderEditor({order,mode,customer:ic,allCustomers,products,onSave,onBack,onConvertSO,cu,nf,msgs,onMsg}){
  const isE=mode==='estimate';const isSO=mode==='so';
  const[o,setO]=useState(order);const[cust,setCust]=useState(ic);const[pS,setPS]=useState('');const[showAdd,setShowAdd]=useState(false);
  const[tab,setTab]=useState('items');const[saved,setSaved]=useState(!!order.customer_id);const[showSend,setShowSend]=useState(false);const[showPick,setShowPick]=useState(false);const[showPO,setShowPO]=useState(null);
  const[newAddr,setNewAddr]=useState('');const[showNA,setShowNA]=useState(false);const[showSzPicker,setShowSzPicker]=useState(null);const[showCustom,setShowCustom]=useState(false);const[custItem,setCustItem]=useState({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,color:''});
  const sv=(k,v)=>setO(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));
  const isAU=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';const tD={A:0.4,B:0.35,C:0.3};
  const selC=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);sv('customer_id',id);sv('default_markup',c.catalog_markup||1.65)}};
  const addP=p=>{const au=isAU(p.brand);const sell=au?rQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):rQ(p.nsa_cost*(o.default_markup||1.65));
    sv('items',[...o.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:[...p.available_sizes],_colors:p._colors||null,sizes:{},decorations:[]}]);setShowAdd(false);setPS('')};
  const uI=(i,k,v)=>sv('items',o.items.map((it,x)=>x===i?{...it,[k]:v}:it));const rmI=i=>sv('items',o.items.filter((_,x)=>x!==i));
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
  const artQty=useMemo(()=>{const m={};o.items.forEach(it=>{const q=Object.values(it.sizes).reduce((a,v)=>a+v,0);it.decorations.forEach(d=>{if(d.kind==='art'&&d.art_file_id){m[d.art_file_id]=(m[d.art_file_id]||0)+q}})});return m},[o]);
  const totals=useMemo(()=>{let rev=0,cost=0;o.items.forEach(it=>{const q=Object.values(it.sizes).reduce((a,v)=>a+v,0);if(!q)return;rev+=q*it.unit_sell;cost+=q*it.nsa_cost;
    it.decorations.forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);rev+=q*dp.sell;cost+=q*dp.cost})});
    const ship=o.shipping_type==='pct'?rev*(o.shipping_value||0)/100:(o.shipping_value||0);const tax=rev*(cust?.tax_rate||0);
    return{rev,cost,ship,tax,grand:rev+ship+tax,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[o,artQty]); // eslint-disable-line
  const fp=products.filter(p=>{if(!pS)return true;const q=pS.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)});
  const statusFlow=['waiting_art','in_production','ready_ship','shipped','completed'];

  return(<div>
    <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> {isE?'All Estimates':'All Sales Orders'}</button>
    {/* HEADER */}
    <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{o.id}</span>
            {isE&&<span className={`badge ${o.status==='draft'?'badge-gray':o.status==='sent'?'badge-amber':o.status==='approved'?'badge-green':'badge-blue'}`}>{o.status}</span>}
            {isSO&&<span style={{padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700,background:SC[o.status]?.bg||'#f1f5f9',color:SC[o.status]?.c||'#475569'}}>{o.status?.replace(/_/g,' ')}</span>}
            {isE&&<EmailBadge e={o}/>}</div>
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>({value:c.id,label:`${c.name} (${c.alpha_tag})`}))} value={o.customer_id} onChange={selC} placeholder="Search customer..."/></div>
          :<div><div style={{fontSize:18,fontWeight:800}}>{cust.name} <span style={{fontSize:14,color:'#64748b'}}>({cust.alpha_tag})</span></div>
            <div style={{fontSize:13,color:'#64748b'}}>Tier {cust.adidas_ua_tier} | {o.default_markup||1.65}x | Tax: {cust.tax_rate?(cust.tax_rate*100).toFixed(2)+'%':'N/A'}</div></div>}
          {isSO&&o.estimate_id&&<div style={{fontSize:11,color:'#7c3aed'}}>🔗 From: {o.estimate_id}</div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>By {REPS.find(r=>r.id===o.created_by)?.name} · {o.created_at}</div></div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{l:'REV',v:totals.rev,bg:'#f0fdf4',c:'#166534'},{l:'COST',v:totals.cost,bg:'#fef2f2',c:'#dc2626'},{l:'MARGIN',v:totals.margin,bg:'#dbeafe',c:'#1e40af',s:`${totals.pct.toFixed(1)}%`},{l:'TOTAL',v:totals.grand,bg:'#faf5ff',c:'#7c3aed',s:'+tax+ship'}].map(x=>
            <div key={x.l} style={{textAlign:'center',padding:'8px 12px',background:x.bg,borderRadius:8,minWidth:72}}><div style={{fontSize:9,color:x.c,fontWeight:700}}>{x.l}</div><div style={{fontSize:17,fontWeight:800,color:x.c}}>${x.v.toLocaleString(undefined,{maximumFractionDigits:0})}</div>{x.s&&<div style={{fontSize:9,color:'#94a3b8'}}>{x.s}</div>}</div>)}</div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180}}><label className="form-label">Memo</label><input className="form-input" value={o.memo} onChange={e=>sv('memo',e.target.value)} style={{fontSize:14}}/></div>
        {isE&&<div style={{width:70}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={o.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;sv('default_markup',m);sv('items',o.items.map(it=>isAU(it.brand)?it:{...it,unit_sell:rQ(it.nsa_cost*m)}))}}/></div>}
        {isSO&&<div style={{width:120}}><label className="form-label">Expected</label><input className="form-input" type="date" value={o.expected_date||''} onChange={e=>sv('expected_date',e.target.value)}/></div>}
        <button className="btn btn-primary" onClick={()=>{onSave(o);setSaved(true);nf(`${isE?'Estimate':'SO'} saved`)}}><Icon name="check" size={14}/> Save</button>
        {isE&&saved&&o.status!=='approved'&&o.status!=='converted'&&<button className="btn btn-secondary" onClick={()=>setShowSend(true)}><Icon name="send" size={14}/> Send</button>}
        {isE&&o.status==='approved'&&<button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>onConvertSO(o)}><Icon name="box" size={14}/> Convert to SO</button>}
        {isSO&&<button className="btn btn-secondary" onClick={()=>setShowPick(true)}><Icon name="grid" size={14}/> Pick Ticket</button>}
        {isSO&&<button className="btn btn-secondary" onClick={()=>setShowPO('select')}><Icon name="cart" size={14}/> Create PO</button>}
      </div>
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
      {/* SO STATUS */}
      {isSO&&<div style={{display:'flex',gap:4,marginTop:12,borderTop:'1px solid #f1f5f9',paddingTop:12,flexWrap:'wrap'}}>
        {statusFlow.map((sf,i)=>{const sc=SC[sf]||{};const si=statusFlow.indexOf(o.status);const active=i<=si;const cur=i===si;
          return<button key={sf} className="btn btn-sm" style={{background:active?sc.bg:'#f8fafc',color:active?sc.c:'#94a3b8',border:cur?`2px solid ${sc.c}`:'1px solid #e2e8f0',fontWeight:cur?800:500}}
            onClick={()=>{sv('status',sf);nf(`Status → ${sf.replace(/_/g,' ')}`)}}>{sf.replace(/_/g,' ')}</button>})}
      </div>}
      {isSO&&<div style={{marginTop:8}}><label className="form-label">Production Notes</label><input className="form-input" value={o.production_notes||''} onChange={e=>sv('production_notes',e.target.value)} placeholder="Internal notes..."/></div>}
    </div></div>
    {/* TABS */}
    <div className="tabs" style={{marginBottom:16}}>
      <button className={`tab ${tab==='items'?'active':''}`} onClick={()=>setTab('items')}>Line Items</button>
      <button className={`tab ${tab==='art'?'active':''}`} onClick={()=>setTab('art')}>Art Library ({af.length})</button>
      {isSO&&<button className={`tab ${tab==='messages'?'active':''}`} onClick={()=>setTab('messages')}>Messages {(()=>{const unread=(msgs||[]).filter(m=>m.so_id===o.id&&!(m.read_by||[]).includes(cu.id)).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:4}}>{unread}</span>:` (${(msgs||[]).filter(m=>m.so_id===o.id).length})`})()}</button>}
      {isSO&&<button className={`tab ${tab==='transactions'?'active':''}`} onClick={()=>setTab('transactions')}>Linked</button>}
      {isSO&&<button className={`tab ${tab==='firm_dates'?'active':''}`} onClick={()=>setTab('firm_dates')}>Firm Dates ({(o.firm_dates||[]).length})</button>}
    </div>

    {/* LINE ITEMS */}
    {tab==='items'&&<>{o.items.map((item,idx)=>{const qty=Object.values(item.sizes).reduce((a,v)=>a+v,0);
      let dR=0,dC=0;item.decorations.forEach(d=>{const dp=dP(d,qty,af);dR+=qty*dp.sell;dC+=qty*dp.cost});
      const iR=qty*item.unit_sell+dR;const iC=qty*item.nsa_cost+dC;const mg=iR-iC;
      const SZ_ORD=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT','OSFA'];const szs=(item.available_sizes||['S','M','L','XL','2XL']).slice().sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
      const addable=EXTRA_SIZES.filter(s=>!(item.available_sizes||[]).includes(s));
      return(<div key={idx} className="card" style={{marginBottom:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>
                <span style={{fontWeight:700,fontSize:15}}>{item.name}</span>
                {item._colors?<select className="form-select" style={{fontSize:12,width:150}} value={item.color||item._colors[0]} onChange={e=>uI(idx,'color',e.target.value)}>{item._colors.map(c=><option key={c}>{c}</option>)}</select>:<span className="badge badge-gray">{item.color}</span>}</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:8}}>
                <span style={{fontSize:13,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong></span>
                <span style={{fontSize:14}}>Sell: <$In value={item.unit_sell} onChange={v=>uI(idx,'unit_sell',v)}/>/ea</span>
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}
                {!isAU(item.brand)&&<span style={{fontSize:12,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
              </div></div>
            <div style={{textAlign:'right',fontSize:12,minWidth:120}}>
              <div>Qty: <strong style={{fontSize:16}}>{qty}</strong></div>
              <div>Rev: <strong style={{color:'#166534'}}>${iR.toFixed(0)}</strong></div>
              <div>Margin: <strong style={{color:mg>=0?'#1e40af':'#dc2626'}}>${mg.toFixed(0)} ({iR>0?(mg/iR*100).toFixed(0):0}%)</strong></div>
              {isSO&&<div style={{marginTop:4}}><select className="form-select" style={{fontSize:10,padding:'2px 4px',width:'auto',
                background:item.ful==='pulled'?'#dcfce7':item.ful==='pick'?'#ede9fe':item.ful==='on_order'?'#fef3c7':'#f1f5f9',
                color:item.ful==='pulled'?'#166534':item.ful==='pick'?'#6d28d9':item.ful==='on_order'?'#92400e':'#64748b',
                fontWeight:700,borderRadius:10}} value={item.ful||'not_ordered'} onChange={e=>uI(idx,'ful',e.target.value)}>
                <option value="not_ordered">Not Ordered</option><option value="on_order">On Order</option><option value="pick">Pick</option><option value="pulled">Pulled</option></select></div>}
            </div>
            <button onClick={()=>rmI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={16}/></button>
          </div></div>
        {/* SIZES with + Size button */}
        <div style={{padding:'10px 18px',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #f1f5f9'}}>
          <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:46}}>Sizes:</span>
          {szs.map(sz=><div key={sz} style={{textAlign:'center',width:48}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
            <input value={item.sizes[sz]||''} onChange={e=>uSz(idx,sz,e.target.value)} placeholder="0"
              style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:(item.sizes[sz]||0)>0?'#0f172a':'#cbd5e1'}}/>
            {(()=>{if(isSO&&(item.ful==='on_order'||item.ful==='pick'||item.ful==='pulled')){
              const ck=item.checked?.[sz]||0;const need=item.sizes[sz]||0;
              if(item.ful==='pulled')return<div style={{fontSize:9,color:'#166534',fontWeight:600}}>✓ pulled</div>;
              if(item.ful==='pick')return<div style={{fontSize:9,color:'#6d28d9',fontWeight:600}}>pick</div>;
              if(item.ful==='on_order')return<div style={{fontSize:9,color:ck>0?'#d97706':'#92400e',fontWeight:600}}>{ck>0?ck+'/'+need+' in':'ordered'}</div>;
              return null}
            const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const stk=p?._inv?.[sz];return stk!=null?<div style={{fontSize:9,color:stk>0?'#166534':'#dc2626',fontWeight:600}}>{stk} inv</div>:null})()}</div>)}
          <div style={{textAlign:'center',marginLeft:4,padding:'0 10px',borderLeft:'2px solid #e2e8f0'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOT</div><div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div></div>
          <div style={{position:'relative',marginLeft:4}}><button className="btn btn-sm btn-secondary" onClick={()=>setShowSzPicker(showSzPicker===idx?null:idx)} style={{fontSize:10}}>+ Size</button>
            {showSzPicker===idx&&addable.length>0&&<><div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:39}} onClick={()=>setShowSzPicker(null)}/><div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:40,padding:6,display:'flex',gap:3,flexWrap:'wrap',width:180}}>
              {addable.map(sz=><button key={sz} className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>addSzToItem(idx,sz)}>{sz}</button>)}</div></>}
          </div>
        </div>
        {/* DECORATIONS */}
        <div style={{padding:'8px 18px 14px'}}>
          {item.decorations.map((deco,di)=>{const cq=deco.kind==='art'&&deco.art_file_id?artQty[deco.art_file_id]:qty;const dp=dP(deco,qty,af,cq);
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
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>addArtDeco(idx)}><Icon name="image" size={12}/> + Add Art</button>
            <button className="btn btn-sm btn-secondary" onClick={()=>addNumDeco(idx)}>#️⃣ + Add Numbers</button>
          </div>
        </div>
      </div>)})}
    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAdd?<button className="btn btn-primary" onClick={()=>setShowAdd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      <button className="btn btn-secondary" onClick={()=>setShowCustom(!showCustom)} disabled={!cust}><Icon name="plus" size={14}/> Custom Item</button>
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
          {af.map((art,i)=>{const usedIn=o.items.reduce((a,it)=>a+it.decorations.filter(d=>d.art_file_id===art.id).length,0);
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
      return<div className="card"><div className="card-header"><h2>Messages</h2><span style={{fontSize:12,color:'#64748b'}}>{soMsgs.length} message(s)</span></div>
        <div className="card-body">
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:12,maxHeight:400,overflow:'auto'}}>
            {soMsgs.length===0?<div className="empty">No messages yet. Start the conversation.</div>:
            soMsgs.map(m=>{const author=REPS.find(r=>r.id===m.author_id);const isMe=m.author_id===cu.id;const unread=!(m.read_by||[]).includes(cu.id);
              return<div key={m.id} style={{padding:'10px 14px',borderRadius:8,background:isMe?'#dbeafe':'#f8fafc',border:unread?'2px solid #3b82f6':'1px solid #e2e8f0',marginLeft:isMe?40:0,marginRight:isMe?0:40}}
                onClick={()=>{if(unread&&onMsg){onMsg(msgs.map(mm=>mm.id===m.id?{...mm,read_by:[...(mm.read_by||[]),cu.id]}:mm))}}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:isMe?'#1e40af':'#475569'}}>{author?.name||'Unknown'}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{m.ts}</span></div>
                <div style={{fontSize:13,color:'#0f172a'}}>{m.text}</div>
                {unread&&<div style={{fontSize:9,color:'#3b82f6',marginTop:2}}>● New</div>}
              </div>})}
          </div>
          <div style={{display:'flex',gap:8}}><input className="form-input" id="msg-input" placeholder="Type a message..." style={{flex:1}} onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){
            const nm={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,text:e.target.value.trim(),ts:new Date().toLocaleString(),read_by:[cu.id]};
            if(onMsg)onMsg([...msgs,nm]);e.target.value='';nf('Message sent')}}}/><button className="btn btn-primary" onClick={()=>{
            const inp=document.getElementById('msg-input');if(inp&&inp.value.trim()){
            const nm={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,text:inp.value.trim(),ts:new Date().toLocaleString(),read_by:[cu.id]};
            if(onMsg)onMsg([...msgs,nm]);inp.value='';nf('Message sent')}}}>Send</button></div>
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
    {isSO&&tab==='firm_dates'&&<div className="card"><div className="card-header"><h2>Firm Date Requests</h2><button className="btn btn-sm btn-primary" onClick={()=>sv('firm_dates',[...(o.firm_dates||[]),{item_desc:'',date:'',approved:false}])}><Icon name="plus" size={12}/> Add</button></div>
      <div className="card-body">{(o.firm_dates||[]).length===0?<div className="empty">No firm date requests</div>:
        <table><thead><tr><th>Item</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {(o.firm_dates||[]).map((fd,i)=>{const itemOpts=o.items.map(it=>`${it.sku} - ${it.name}`);
          return<tr key={i}>
          <td><select className="form-select" value={fd.item_desc} onChange={e=>{const fds=[...(o.firm_dates||[])];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}>
            <option value="">Select item...</option>{itemOpts.map(opt=><option key={opt}>{opt}</option>)}<option value="__custom">Other (type below)</option></select>
            {fd.item_desc==='__custom'&&<input className="form-input" style={{marginTop:4,fontSize:12}} placeholder="Custom description..." onChange={e=>{const fds=[...(o.firm_dates||[])];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}/>}</td>
          <td><input className="form-input" type="date" value={fd.date||''} onChange={e=>{const fds=[...(o.firm_dates||[])];fds[i]={...fds[i],date:e.target.value};sv('firm_dates',fds)}}/></td>
          <td>{fd.approved?<span className="badge badge-green">Approved</span>:<span className="badge badge-amber">Pending</span>}</td>
          <td><div style={{display:'flex',gap:4}}>{!fd.approved&&<button className="btn btn-sm btn-primary" onClick={()=>{const fds=[...(o.firm_dates||[])];fds[i]={...fds[i],approved:true};sv('firm_dates',fds);nf('Approved')}}>✓</button>}
            <button className="btn btn-sm btn-secondary" onClick={()=>sv('firm_dates',(o.firm_dates||[]).filter((_,x)=>x!==i))}><Icon name="trash" size={10}/></button></div></td></tr>})}</tbody></table>}</div></div>}

    <SendModal isOpen={showSend} onClose={()=>setShowSend(false)} estimate={o} customer={cust} onSend={()=>{sv('status','sent');sv('email_status','sent');onSave({...o,status:'sent',email_status:'sent'});nf('Estimate sent!')}}/>
    {showPO&&(()=>{
      // Vendor selection or PO form
      const vendors=[...new Set(o.items.map(it=>it.vendor_id||it.brand).filter(Boolean))];
      const vendorMap={};o.items.forEach((it,i)=>{const vk=it.vendor_id||D_V.find(v=>v.name===it.brand)?.id||it.brand;if(!vendorMap[vk])vendorMap[vk]=[];vendorMap[vk].push({...it,_idx:i})});
      if(showPO==='select')return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Create PO — Select Vendor</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">{Object.entries(vendorMap).map(([vk,items])=>{const vn=D_V.find(v=>v.id===vk)?.name||vk;
          return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,cursor:'pointer',display:'flex',alignItems:'center',gap:12}} onClick={()=>setShowPO(vk)}>
            <div style={{width:40,height:40,borderRadius:8,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="package" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#64748b'}}>{items.length} item(s)</div></div>
            <Icon name="back" size={16} style={{transform:'rotate(180deg)'}}/></div>})}
        </div></div></div>;
      // PO form for selected vendor
      const vItems=vendorMap[showPO]||[];const vn=D_V.find(v=>v.id===showPO)?.name||showPO;
      return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>New PO — {vn}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
            <div><label className="form-label">PO Number</label><input className="form-input" value={'PO-'+(3000+Math.floor(Math.random()*100))} readOnly style={{color:'#1e40af',fontWeight:700}}/></div>
            <div><label className="form-label">Ship To</label><select className="form-select">{addrs.map(a=><option key={a.id}>{a.label}</option>)}</select></div>
            <div><label className="form-label">Expected Date</label><input className="form-input" type="date"/></div></div>
          {vItems.map((it,vi)=>{const q=Object.values(it.sizes).reduce((a,v)=>a+v,0);const szList=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
            return<div key={vi} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div><div style={{fontWeight:700}}>SO Qty: {q}</div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>PO Qty:</span>
                {szList.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}</div>
            </div>})}
          <div style={{marginTop:8}}><label className="form-label">Notes</label><input className="form-input" placeholder="PO notes for vendor..."/></div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setShowPO('select')}>← Back</button><button className="btn btn-secondary" onClick={()=>setShowPO(null)}>Cancel</button><button className="btn btn-primary" onClick={()=>{setShowPO(null);nf('PO created (Phase 4 will save to DB)')}}><Icon name="cart" size={14}/> Create PO</button></div>
      </div></div>})()}

        {showPick&&<div className="modal-overlay" onClick={()=>setShowPick(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header"><h2>Pick Ticket — {o.id}</h2><button className="modal-close" onClick={()=>setShowPick(false)}>x</button></div>
      <div className="modal-body" id="pick-ticket-content">
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:16,paddingBottom:12,borderBottom:'2px solid #0f172a'}}>
          <div><div style={{fontSize:20,fontWeight:800}}>NATIONAL SPORTS APPAREL</div><div style={{fontSize:12,color:'#64748b'}}>Pick Ticket</div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{o.id}</div><div style={{fontSize:12}}>{new Date().toLocaleDateString()}</div></div></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
          <div><div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase'}}>Customer</div><div style={{fontSize:14,fontWeight:700}}>{cust?.name}</div><div style={{fontSize:12,color:'#64748b'}}>{cust?.alpha_tag}</div></div>
          <div><div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase'}}>Ship To</div><div style={{fontSize:12}}>{addrs.find(a=>a.id===(o.ship_to_id||'default'))?.addr||o.ship_to_custom||'—'}</div></div></div>
        {o.production_notes&&<div style={{padding:8,background:'#fef3c7',borderRadius:4,marginBottom:12,fontSize:12}}><strong>Notes:</strong> {o.production_notes}</div>}
        {o.items.map((it,i)=>{const q=Object.values(it.sizes).reduce((a,v)=>a+v,0);const szList=Object.entries(it.sizes).filter(([,v])=>v>0);
          return<div key={i} style={{marginBottom:16,padding:12,border:'1px solid #e2e8f0',borderRadius:6}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div><div style={{fontWeight:800}}>Qty: {q}</div></div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><thead><tr style={{borderBottom:'2px solid #0f172a'}}>{szList.map(([sz])=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:40}}>{sz}</th>)}<th style={{padding:'4px 8px'}}>Total</th></tr></thead>
            <tbody><tr style={{fontSize:10,color:'#64748b'}}>{szList.map(([sz,v])=><td key={sz} style={{padding:'2px 8px',textAlign:'center'}}>need: {v}</td>)}<td/></tr>
            <tr>{szList.map(([sz,v])=><td key={sz} style={{padding:'4px 8px',textAlign:'center'}}><input style={{width:36,textAlign:'center',border:'1px solid #d1d5db',borderRadius:3,padding:'3px',fontSize:14,fontWeight:700}} defaultValue={v}/></td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800,fontSize:14}}>{q}</td></tr>
            {it.decorations.some(d=>d.kind==='numbers')&&<tr style={{borderTop:'1px solid #e2e8f0'}}>{szList.map(([sz])=>{const nums=it.decorations.find(d=>d.kind==='numbers');const r=nums?.roster?.[sz]||[];return<td key={sz} style={{padding:'4px 8px',textAlign:'center',fontSize:10,color:'#7c3aed'}}>{r.filter(Boolean).join(', ')}</td>})}<td/></tr>}
            </tbody></table>
            {it.decorations.map((d,di)=>{const artF=d.kind==='art'?af.find(f=>f.id===d.art_file_id):null;
              return<div key={di} style={{fontSize:11,color:'#64748b',marginTop:4,padding:'4px 8px',background:'#f8fafc',borderRadius:4}}>
                {d.kind==='art'&&artF?<span>📎 <strong>{artF.name}</strong> — {artF.deco_type?.replace('_',' ')} @ {d.position} {d.underbase&&'(UB)'} {artF.ink_colors&&`[${artF.ink_colors.split('\n').filter(l=>l.trim()).join(', ')}]`}{artF.thread_colors&&`[${artF.thread_colors}]`}</span>
                :<span>#️⃣ Numbers — {d.num_method?.replace('_',' ')} {d.num_size} @ {d.position} {d.two_color&&'(2-clr)'}</span>}</div>})}
          </div>})}
      </div>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setShowPick(false)}>Close</button><button className="btn btn-primary" onClick={()=>{window.print()}}>🖨️ Print</button></div>
    </div></div>}
  </div>);
}

// CUSTOMER DETAIL
function CustDetail({customer,allCustomers,allOrders,onBack,onEdit,onSelCust,onNewEst}){
  const[tab,setTab]=useState('activity');const[oF,setOF]=useState('all');const[sF,setSF]=useState('all');const[rR,setRR]=useState('thisyear');
  const isP=!customer.parent_id;const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const tl={prepay:'Prepay',net15:'Net 15',net30:'Net 30',net60:'Net 60'};
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];const orders=allOrders.filter(o=>ids.includes(o.customer_id));
  const fo=orders.filter(o=>{if(oF!=='all'&&o.type!==oF)return false;if(sF==='open')return['sent','draft','open','in_production','waiting_art'].includes(o.status);if(sF==='closed')return['approved','paid','completed','shipped'].includes(o.status);return true});
  const gn=id=>allCustomers.find(x=>x.id===id)?.alpha_tag||'';
  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Customers</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="building" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{customer.name}</span><span className="badge badge-blue">{customer.alpha_tag}</span><span className="badge badge-green">Tier {customer.adidas_ua_tier}</span><span className="badge badge-gray">{tl[customer.payment_terms]||'Net 30'}</span></div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(customer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email}{i<customer.contacts.length-1&&' | '}</span>)}</div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}><button className="btn btn-sm btn-primary" onClick={()=>onNewEst(customer)}><Icon name="file" size={12}/> Estimate</button><button className="btn btn-sm btn-secondary"><Icon name="mail" size={12}/> Email</button><button className="btn btn-sm btn-secondary" onClick={()=>onEdit(customer)}><Icon name="edit" size={12}/> Edit</button></div>
  </div>
  {(customer._ob||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>BALANCE</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${customer._ob.toLocaleString()}</div></div>}</div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Est</div><div className="stat-value">{customer._oe||0}</div></div><div className="stat-card"><div className="stat-label">Open SOs</div><div className="stat-value">{customer._os||0}</div></div><div className="stat-card"><div className="stat-label">Open Inv</div><div className="stat-value" style={{color:(customer._oi||0)>0?'#dc2626':''}}>{customer._oi||0}</div></div><div className="stat-card"><div className="stat-label">Balance</div><div className="stat-value" style={{color:(customer._ob||0)>0?'#dc2626':''}}>${(customer._ob||0).toLocaleString()}</div></div></div>
  {isP&&subs.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Sub-Customers ({subs.length})</h2></div><div className="card-body" style={{padding:0}}>
  {subs.map(sub=><div key={sub.id} style={{padding:'10px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>onSelCust(sub)}>
    <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{sub.name}</span><span className="badge badge-gray">{sub.alpha_tag}</span><div style={{flex:1}}/>
    {(sub._ob||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${sub._ob.toLocaleString()}</span>}</div>)}</div></div>}
  <div className="tabs">{['activity','overview','artwork','reporting'].map(t=><button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t==='activity'?'Orders & Invoices':t[0].toUpperCase()+t.slice(1)}</button>)}</div>
  {tab==='activity'&&<div className="card"><div className="card-header"><h2>Orders</h2><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
    {[['all','All'],['estimate','Est'],['sales_order','SO'],['invoice','Inv']].map(([v,l])=><button key={v} className={`btn btn-sm ${oF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOF(v)}>{l}</button>)}
    <span style={{width:1,background:'#e2e8f0',margin:'0 4px'}}/>
    {[['all','All'],['open','Open'],['closed','Closed']].map(([v,l])=><button key={v} className={`btn btn-sm ${sF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setSF(v)}>{l}</button>)}
  </div></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Type</th><th>Date</th><th>Memo</th>{isP&&<th>Sub</th>}<th>Total</th><th>Status</th></tr></thead><tbody>
    {fo.length===0?<tr><td colSpan={7} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>:
    fo.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(o=><tr key={o.id}><td style={{fontWeight:700,color:'#1e40af'}}>{o.id}</td>
      <td><span className={`badge ${o.type==='estimate'?'badge-amber':o.type==='sales_order'?'badge-blue':'badge-red'}`}>{o.type==='sales_order'?'SO':o.type==='estimate'?'Est':'Inv'}</span></td>
      <td>{o.date}</td><td style={{fontSize:12}}>{o.memo}</td>{isP&&<td><span className="badge badge-gray">{gn(o.customer_id)}</span></td>}
      <td style={{fontWeight:700}}>${o.total?.toLocaleString()}</td>
      <td><span className={`badge ${o.status==='open'||o.status==='sent'?'badge-amber':o.status==='approved'||o.status==='paid'?'badge-green':o.status==='draft'?'badge-gray':'badge-blue'}`}>{o.status?.replace(/_/g,' ')}</span></td></tr>)}</tbody></table></div></div>}
  {tab==='overview'&&<div className="card"><div className="card-header"><h2>Info</h2></div><div className="card-body">
    <div className="form-row form-row-3"><div><div className="form-label">Billing</div><div style={{fontSize:13}}>{customer.billing_address_line1||'--'}<br/>{customer.billing_city}, {customer.billing_state} {customer.billing_zip}</div></div>
    <div><div className="form-label">Shipping</div><div style={{fontSize:13}}>{customer.shipping_address_line1||'--'}<br/>{customer.shipping_city}, {customer.shipping_state}</div></div>
    <div><div className="form-label">Tax</div><div style={{fontSize:13}}>{customer.tax_rate?(customer.tax_rate*100).toFixed(2)+'%':'Auto'}</div></div></div>
    <div style={{marginTop:16}}><div className="form-label">Contacts</div>{(customer.contacts||[]).map((c,i)=><div key={i} style={{fontSize:13,padding:'4px 0'}}><strong>{c.name}</strong> ({c.role}) — {c.email} {c.phone&&`| ${c.phone}`}</div>)}</div>
  </div></div>}
  {tab==='artwork'&&<div className="card"><div className="card-body"><div className="empty">Customer art library — aggregates from SOs (Phase 3)</div></div></div>}
  {tab==='reporting'&&<div className="card"><div className="card-header"><h2>Reporting</h2><div style={{display:'flex',gap:4}}>{[['thisyear','This Year'],['lastyear','Last Year'],['rolling','Rolling 12'],['alltime','All']].map(([v,l])=><button key={v} className={`btn btn-sm ${rR===v?'btn-primary':'btn-secondary'}`} onClick={()=>setRR(v)}>{l}</button>)}</div></div>
    <div className="card-body"><div className="stats-row"><div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{rR==='thisyear'?'$15,600':'$32,600'}</div></div><div className="stat-card"><div className="stat-label">Orders</div><div className="stat-value">{rR==='thisyear'?'4':'8'}</div></div><div className="stat-card"><div className="stat-label">Avg Order</div><div className="stat-value">{rR==='thisyear'?'$3,900':'$4,075'}</div></div></div></div></div>}
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
function AdjModal({isOpen,onClose,product,onSave}){const[a,setA]=useState({});React.useEffect(()=>{if(product)setA({...product._inv})},[product,isOpen]);if(!isOpen||!product)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
    <div className="modal-header"><h2>Adjust Inventory</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body"><div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:12}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{product.sku}</span> {product.name}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{product.available_sizes.map(sz=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>{sz}</div>
        <input className="form-input" type="number" min="0" style={{width:60,textAlign:'center'}} value={a[sz]||0} onChange={e=>setA(x=>({...x,[sz]:parseInt(e.target.value)||0}))}/></div>)}</div>
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{onSave(product.id,a);onClose()}}>Save</button></div></div></div>);
}

// MAIN APP
export default function App(){
  const[pg,setPg]=useState('dashboard');const[toast,setToast]=useState(null);
  const[cust,setCust]=useState(D_C);const[vend]=useState(D_V);const[prod,setProd]=useState(D_P);
  const[ests,setEsts]=useState(D_E);const[sos,setSOs]=useState(D_SO);const[invs]=useState(D_INV);
  const[msgs,setMsgs]=useState(D_MSG);const[cM,setCM]=useState({open:false,c:null});const[aM,setAM]=useState({open:false,p:null});
  const[q,setQ]=useState('');const[selC,setSelC]=useState(null);const[selV,setSelV]=useState(null);
  const[eEst,setEEst]=useState(null);const[eEstC,setEEstC]=useState(null);const[eSO,setESO]=useState(null);const[eSOC,setESOC]=useState(null);
  const[gQ,setGQ]=useState('');const[gOpen,setGOpen]=useState(false);const[rF,setRF]=useState('all');const[pF,setPF]=useState({cat:'all',vnd:'all',stk:'all',clr:'all'});
  const[iS,setIS]=useState({f:'value',d:'desc'});const[iF,setIF]=useState({cat:'all',vnd:'all'});
  const cu=REPS[0];const isA=cu.role==='admin';
  const nf=(m,t='success')=>{setToast({msg:m,type:t});setTimeout(()=>setToast(null),3500)};
  const pars=useMemo(()=>cust.filter(c=>!c.parent_id),[cust]);const gK=useCallback(pid=>cust.filter(c=>c.parent_id===pid),[cust]);
  const cols=useMemo(()=>[...new Set(prod.map(p=>p.color).filter(Boolean))].sort(),[prod]);
  const savC=c=>{setCust(p=>{const e=p.find(x=>x.id===c.id);return e?p.map(x=>x.id===c.id?c:x):[...p,c]});nf('Saved')};
  const savE=e=>{setEsts(p=>{const ex=p.find(x=>x.id===e.id);return ex?p.map(x=>x.id===e.id?e:x):[...p,e]})};
  const savSO=s=>{setSOs(p=>{const ex=p.find(x=>x.id===s.id);return ex?p.map(x=>x.id===s.id?s:x):[...p,s]})};
  const savI=(pid,inv)=>{setProd(p=>p.map(x=>x.id===pid?{...x,_inv:inv}:x));nf('Updated')};
  const newE=c=>{const e={id:'EST-'+(2100+ests.length),customer_id:c?.id||null,memo:'',status:'draft',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:c?.catalog_markup||1.65,shipping_type:'pct',shipping_value:0,ship_to_id:'default',email_status:null,art_files:[],items:[]};setEEst(e);setEEstC(c||null);setPg('estimates')};
  const convertSO=est=>{const so={id:'SO-'+(1052+sos.length),customer_id:est.customer_id,estimate_id:est.id,memo:est.memo,status:'waiting_art',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:est.default_markup,expected_date:'',production_notes:'',shipping_type:est.shipping_type,shipping_value:est.shipping_value,ship_to_id:est.ship_to_id,firm_dates:[],art_files:[...(est.art_files||[])],items:est.items.map(it=>({...it,decorations:it.decorations.map(d=>d.kind==='art'?{...d,art_file_id:null}:{...d})}))};
    setSOs(p=>[...p,so]);setEsts(p=>p.map(e=>e.id===est.id?{...e,status:'converted'}:e));setEEst(null);
    const c=cust.find(x=>x.id===so.customer_id);setESO(so);setESOC(c);setPg('orders');nf(`${so.id} created from ${est.id}`)};
  const aO=useMemo(()=>[
    ...ests.map(e=>{const t=e.items?.reduce((a,it)=>{const qq=Object.values(it.sizes||{}).reduce((s,v)=>s+v,0);let r=qq*it.unit_sell;it.decorations?.forEach(d=>{const dp=dP(d,qq,[],qq);r+=qq*dp.sell});return a+r},0)||0;return{id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0],total:t,memo:e.memo,status:e.status}}),
    ...sos.map(s=>{const t=s.items?.reduce((a,it)=>{const qq=Object.values(it.sizes||{}).reduce((ss,v)=>ss+v,0);return a+qq*(it.unit_sell||0)},0)||0;return{id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0],total:t,memo:s.memo,status:s.status}}),
    ...invs.map(i=>({...i,type:'invoice'}))],[ests,sos,invs]);
  const fP=useMemo(()=>{let l=prod;if(q&&pg==='products'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s)||p.brand?.toLowerCase().includes(s)||p.color?.toLowerCase().includes(s))}
    if(pF.cat!=='all')l=l.filter(p=>p.category===pF.cat);if(pF.vnd!=='all')l=l.filter(p=>p.vendor_id===pF.vnd);if(pF.stk==='instock')l=l.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(pF.clr!=='all')l=l.filter(p=>p.color===pF.clr);return l},[prod,q,pF,pg]);
  const iD=useMemo(()=>{let l=prod.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(iF.cat!=='all')l=l.filter(p=>p.category===iF.cat);if(iF.vnd!=='all')l=l.filter(p=>p.vendor_id===iF.vnd);
    if(q&&pg==='inventory'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s))}
    const m=l.map(p=>{const t=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);return{...p,_tQ:t,_tV:t*(p.nsa_cost||0)}});
    m.sort((a,b)=>{const f=iS.f;let va,vb;if(f==='sku'){va=a.sku;vb=b.sku}else if(f==='name'){va=a.name;vb=b.name}else if(f==='qty'){va=a._tQ;vb=b._tQ}else{va=a._tV;vb=b._tV}
    if(typeof va==='string')return iS.d==='asc'?va.localeCompare(vb):vb.localeCompare(va);return iS.d==='asc'?va-vb:vb-va});return m},[prod,iS,iF,q,pg]);
  const tV=useMemo(()=>iD.reduce((a,p)=>a+p._tV,0),[iD]);const tU=useMemo(()=>iD.reduce((a,p)=>a+p._tQ,0),[iD]);
  const al=useMemo(()=>{const r=[];prod.forEach(p=>{if(!p._alerts)return;Object.entries(p._alerts).forEach(([sz,min])=>{const c=p._inv?.[sz]||0;if(c<min)r.push({p,sz,c,min,need:min-c})})});return r},[prod]);

  // DASHBOARD
  const rDash=()=>(<>
    <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>!['completed','shipped'].includes(s.status)).length}</div></div><div className="stat-card"><div className="stat-label">Inv Value</div><div className="stat-value">${tV.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
      {isA&&al.length>0&&<div className="stat-card" style={{borderColor:'#fbbf24'}}><div className="stat-label">Alerts</div><div className="stat-value" style={{color:'#d97706'}}>{al.length}</div></div>}</div>
    {isA&&al.length>0&&<div className="card" style={{marginBottom:16,borderLeft:'4px solid #d97706'}}><div className="card-header"><h2 style={{color:'#d97706'}}>Stock Alerts</h2></div>
      <div className="card-body" style={{padding:0}}><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Curr</th><th>Min</th><th>Need</th></tr></thead><tbody>
      {al.slice(0,6).map((a,i)=><tr key={i}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{a.p.sku}</td><td style={{fontSize:12}}>{a.p.name}</td><td><span className="badge badge-amber">{a.sz}</span></td><td style={{fontWeight:700,color:'#dc2626'}}>{a.c}</td><td>{a.min}</td><td style={{fontWeight:700}}>{a.need}</td></tr>)}</tbody></table></div></div>}
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-secondary" onClick={()=>{setPg('customers');setCM({open:true,c:null})}}><Icon name="plus" size={14}/> New Customer</button></div></div>
    <div className="card"><div className="card-header"><h2>Recent Estimates</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Status</th><th>Email</th></tr></thead><tbody>
    {ests.slice(0,5).map(e=>{const c=cust.find(x=>x.id===e.customer_id);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c);setPg('estimates')}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?.name||'--'} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{e.memo}</td>
      <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
      <td><EmailBadge e={e}/></td></tr>)})}
    </tbody></table></div></div></>);

  // ESTIMATES LIST
  const rEst=()=>{
    if(eEst)return<OrderEditor order={eEst} mode="estimate" customer={eEstC} allCustomers={cust} products={prod} onSave={e=>{savE(e);setEEst(e)}} onBack={()=>setEEst(null)} onConvertSO={convertSO} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs}/>;
    const fe=ests.filter(e=>!q||(e.id+' '+e.memo+' '+(cust.find(c=>c.id===e.customer_id)?.name||'')+' '+(cust.find(c=>c.id===e.customer_id)?.alpha_tag||'')).toLowerCase().includes(q.toLowerCase()));
    return(<><div style={{display:'flex',gap:8,marginBottom:16}}><div className="search-bar" style={{flex:1}}><Icon name="search"/><input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)}/></div>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="plus" size={14}/> New Estimate</button></div>
      <div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{ests.length}</div></div><div className="stat-card"><div className="stat-label">Draft</div><div className="stat-value">{ests.filter(e=>e.status==='draft').length}</div></div><div className="stat-card"><div className="stat-label">Sent</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value" style={{color:'#166534'}}>{ests.filter(e=>e.status==='approved').length}</div></div></div>
      <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Items</th><th>Status</th><th>Email</th><th></th></tr></thead><tbody>
      {fe.map(e=>{const c=cust.find(x=>x.id===e.customer_id);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c)}}>
        <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?<>{c.name} <span className="badge badge-gray">{c.alpha_tag}</span></>:'--'}</td>
        <td style={{fontSize:12}}>{e.memo}</td><td>{e.items?.length||0}</td>
        <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
        <td><EmailBadge e={e}/></td>
        <td onClick={ev=>ev.stopPropagation()}>{e.status==='approved'&&<button className="btn btn-sm btn-primary" style={{background:'#7c3aed'}} onClick={()=>convertSO(e)}>→ SO</button>}</td>
      </tr>)})}</tbody></table></div></div></>);};

  // SALES ORDERS LIST
  const rSO=()=>{
    if(eSO)return<OrderEditor order={eSO} mode="so" customer={eSOC} allCustomers={cust} products={prod} onSave={s=>{savSO(s);setESO(s)}} onBack={()=>setESO(null)} cu={cu} nf={nf} msgs={msgs} onMsg={setMsgs}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{sos.length}</div></div><div className="stat-card"><div className="stat-label">Wait Art</div><div className="stat-value" style={{color:'#d97706'}}>{sos.filter(s=>s.status==='waiting_art').length}</div></div><div className="stat-card"><div className="stat-label">Production</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>s.status==='in_production').length}</div></div><div className="stat-card"><div className="stat-label">Ready</div><div className="stat-value" style={{color:'#166534'}}>{sos.filter(s=>s.status==='ready_ship').length}</div></div></div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Art</th><th>Msgs</th><th>Status</th></tr></thead><tbody>
    {sos.map(so=>{const c=cust.find(x=>x.id===so.customer_id);const ac=(so.art_files||[]).length;const aa=(so.art_files||[]).filter(f=>f.status==='approved').length;
      return(<tr key={so.id} style={{cursor:'pointer'}} onClick={()=>{setESO(so);setESOC(c)}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td><td>{c?.name} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{so.memo}</td><td>{so.expected_date||'--'}</td>
      <td>{ac>0?<span style={{fontSize:11}}>{aa}/{ac} ✓</span>:<span style={{fontSize:11,color:'#d97706'}}>—</span>}</td>
      <td>{(()=>{const unread=msgs.filter(m=>m.so_id===so.id&&!(m.read_by||[]).includes(cu.id)).length;const total=msgs.filter(m=>m.so_id===so.id).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'2px 8px',fontSize:10,fontWeight:700}}>{unread} new</span>:total>0?<span style={{fontSize:11,color:'#94a3b8'}}>{total}</span>:null})()}</td>
      <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,background:SC[so.status]?.bg||'#f1f5f9',color:SC[so.status]?.c||'#475569'}}>{so.status.replace(/_/g,' ')}</span></td></tr>)})}
    </tbody></table></div></div></>);};

  // CUSTOMERS
  const rCust=()=>{
    if(selC)return<CustDetail customer={selC} allCustomers={cust} allOrders={aO} onBack={()=>setSelC(null)} onEdit={c=>setCM({open:true,c})} onSelCust={c=>setSelC(c)} onNewEst={c=>newE(c)}/>;
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
    <td><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span></td>
    <td style={{fontSize:12}}>{p.name}<br/><span style={{color:'#94a3b8'}}>{p.color}</span></td>
    <td><div style={{display:'flex',gap:2}}>{p.available_sizes.filter(sz=>showSz(sz,p._inv?.[sz])).map(sz=>{const v=p._inv?.[sz]||0;return<div key={sz} className={`size-cell ${v>10?'in-stock':v>0?'low-stock':'no-stock'}`} style={{minWidth:30,padding:'1px 3px'}}><div className="size-label" style={{fontSize:8}}>{sz}</div><div className="size-qty" style={{fontSize:11}}>{v}</div></div>})}</div></td>
    <td style={{fontWeight:800,fontSize:15,color:p._tQ<=10?'#d97706':'#166534'}}>{p._tQ}</td>
    <td style={{fontWeight:700}}>${p._tV.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    <td><div style={{display:'flex',gap:4}}><button className="btn btn-sm btn-secondary" onClick={()=>newE(null)}>+EST</button>
      {isA&&<button className="btn btn-sm btn-secondary" onClick={()=>setAM({open:true,p})}>INV</button>}</div></td>
  </tr>)}</tbody></table></div></div></>);

  // MESSAGES PAGE
  const rMsg=()=>{const allM=[...msgs].sort((a,b)=>(b.ts||'').localeCompare(a.ts));
    const unread=allM.filter(m=>!(m.read_by||[]).includes(cu.id));
    const[mF,setMF]=useState('all');
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
                <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{m.ts}</span>
              </div>
              <div style={{fontSize:13,color:'#374151'}}>{m.text}</div>
            </div>
            {isUnread&&<div style={{width:8,height:8,borderRadius:4,background:'#3b82f6',flexShrink:0,marginTop:6}}/>}
          </div></div>})}</div></div></>)};

    // NAV
  const nav=[{section:'Overview'},{id:'dashboard',label:'Dashboard',icon:'home'},{section:'Sales'},{id:'estimates',label:'Estimates',icon:'dollar'},{id:'orders',label:'Sales Orders',icon:'box'},{section:'People'},{id:'customers',label:'Customers',icon:'users'},{id:'vendors',label:'Vendors',icon:'building'},{section:'Comms'},{id:'messages',label:'Messages',icon:'mail'},{section:'Catalog'},{id:'products',label:'Products',icon:'package'},{id:'inventory',label:'Inventory',icon:'warehouse'}];
  const titles={dashboard:'Dashboard',estimates:'Estimates',orders:'Sales Orders',customers:'Customers',vendors:'Vendors',products:'Products',inventory:'Inventory',messages:'Messages'};
  return(<div className="app"><Toast msg={toast?.msg} type={toast?.type}/>
    <div className="sidebar"><div className="sidebar-logo">NSA<span>Portal</span></div>
      <nav className="sidebar-nav">{nav.map((item,i)=>{if(item.section)return<div key={i} className="sidebar-section">{item.section}</div>;
        const ubadge=item.id==='messages'?msgs.filter(m=>!(m.read_by||[]).includes(cu.id)).length:0;
        return<button key={item.id} className={`sidebar-link ${pg===item.id?'active':''}`}
          onClick={()=>{setPg(item.id);setQ('');setSelC(null);setSelV(null);setEEst(null);setESO(null)}}><Icon name={item.icon}/>{item.label}{ubadge>0&&<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:'auto'}}>{ubadge}</span>}</button>})}</nav>
      <div className="sidebar-user"><div style={{fontWeight:600,color:'#e2e8f0'}}>{cu.name}</div><div>{cu.role}</div></div></div>
    <div className="main"><div className="topbar"><h1>{eEst?eEst.id:eSO?eSO.id:selC?selC.name:selV?selV.name:(titles[pg]||'Dashboard')}</h1>
        <div style={{flex:1,maxWidth:400,margin:'0 20px',position:'relative'}}>
          <div className="search-bar" style={{margin:0}}><Icon name="search"/><input placeholder="Search everything... (customers, orders, products)" value={gQ} onChange={e=>setGQ(e.target.value)} onFocus={()=>setGOpen(true)}/>{gQ&&<button onClick={()=>{setGQ('');setGOpen(false)}} style={{background:'none',border:'none',cursor:'pointer',padding:2}}><Icon name="x" size={14}/></button>}</div>
          {gOpen&&gQ.length>=2&&(()=>{const s=gQ.toLowerCase();
            const rc=cust.filter(cc=>(cc.name+' '+cc.alpha_tag).toLowerCase().includes(s)).slice(0,4);
            const re=ests.filter(e=>(e.id+' '+e.memo).toLowerCase().includes(s)).slice(0,4);
            const rs=sos.filter(so=>(so.id+' '+so.memo).toLowerCase().includes(s)).slice(0,4);
            const rp=prod.filter(p=>(p.sku+' '+p.name+' '+p.brand).toLowerCase().includes(s)).slice(0,4);
            const tot=rc.length+re.length+rs.length+rp.length;
            return tot>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:60,maxHeight:350,overflow:'auto'}}>
              {rc.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Customers</div>
                {rc.map(cc=><div key={cc.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setSelC(cc);setPg('customers');setGQ('');setGOpen(false)}}><Icon name="users" size={14}/><span style={{fontWeight:600}}>{cc.name}</span><span className="badge badge-gray">{cc.alpha_tag}</span></div>)}</>}
              {re.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Estimates</div>
                {re.map(e=>{const cc=cust.find(x=>x.id===e.customer_id);return<div key={e.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setEEst(e);setEEstC(cc);setPg('estimates');setGQ('');setGOpen(false)}}><Icon name="dollar" size={14}/><span style={{fontWeight:700,color:'#1e40af'}}>{e.id}</span><span>{e.memo}</span></div>})}</>}
              {rs.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Sales Orders</div>
                {rs.map(so=>{const cc=cust.find(x=>x.id===so.customer_id);return<div key={so.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setESO(so);setESOC(cc);setPg('orders');setGQ('');setGOpen(false)}}><Icon name="box" size={14}/><span style={{fontWeight:700,color:'#1e40af'}}>{so.id}</span><span>{so.memo}</span></div>})}</>}
              {rp.length>0&&<><div style={{padding:'6px 12px',fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',background:'#f8fafc'}}>Products</div>
                {rp.map(p=><div key={p.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,display:'flex',gap:8,alignItems:'center'}} onClick={()=>{setPg('products');setQ(p.sku);setGQ('');setGOpen(false)}}><Icon name="package" size={14}/><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span><span>{p.name}</span></div>)}</>}
            </div>})()}
          {gOpen&&<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:59}} onClick={()=>setGOpen(false)}/>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}><button className="btn btn-sm btn-primary" onClick={()=>newE(null)} style={{fontSize:11}}><Icon name="plus" size={12}/> Estimate</button><button className="btn btn-sm btn-secondary" onClick={()=>setCM({open:true,c:null})} style={{fontSize:11}}><Icon name="plus" size={12}/> Customer</button></div></div>
      <div className="content">{pg==='dashboard'&&rDash()}{pg==='estimates'&&rEst()}{pg==='orders'&&rSO()}{pg==='customers'&&rCust()}{pg==='vendors'&&rVend()}{pg==='products'&&rProd()}{pg==='inventory'&&rInv()}{pg==='messages'&&rMsg()}</div></div>
    <CustModal isOpen={cM.open} onClose={()=>setCM({open:false,c:null})} onSave={savC} customer={cM.c} parents={pars}/>
    <AdjModal isOpen={aM.open} onClose={()=>setAM({open:false,p:null})} product={aM.p} onSave={savI}/>
  </div>);
}
