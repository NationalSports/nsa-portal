import React, { useState, useMemo, useCallback } from 'react';
import './portal.css';
const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sortDown:<path d="M7 10l5 5 5-5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin'},{id:'r2',name:'Laura Chen',role:'rep'},{id:'r3',name:'Mike Torres',role:'rep'}];
const CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
const CONTACT_ROLES=['Head Coach','Assistant','Accounting','Athletic Director','Primary','Other'];
const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];
const roundQ=v=>Math.round(v*4)/4;
const showSize=(s,inv)=>{const core=['S','M','L','XL','2XL'];if(core.includes(s))return true;return!['XS','3XL','4XL'].includes(s)||(inv||0)>0};

// DECORATION MATRICES
const SP_SELL={breaks:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],prices:{0:[50,60,70,null,null],1:[5,6.5,8,9,null],2:[3.5,4.5,6,7,8],3:[3.2,4.25,4.75,6,7.5],4:[2.95,3.85,4.25,5,6],5:[2.75,3.5,3.95,4.5,5.25],6:[2.5,3.2,3.7,4,4.75],7:[2.25,3,3.5,3.75,4.25],8:[2.1,2.85,3.1,3.3,4],9:[1.9,2.75,2.9,3.1,3.75]},markup:1.5,ub_pct:0.15};
const EMB_SELL={sb:[{max:10000},{max:15000},{max:20000},{max:999999}],qb:[{max:6},{max:24},{max:48},{max:99999}],prices:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],markup:1.6};
const NUM_PRESS={breaks:[{max:10},{max:50},{max:99999}],cost:[4,3,3],sell:[7,6,5],two_color_add:3};
const DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];
function spPrice(qty,colors,sell=true){const bi=SP_SELL.breaks.findIndex(b=>qty>=b.min&&qty<=b.max);if(bi<0||colors<1||colors>5)return 0;const s=SP_SELL.prices[bi]?.[colors-1];if(s==null)return 0;return sell?s:roundQ(s/SP_SELL.markup)}
function embPrice(stitches,qty,sell=true){const si=EMB_SELL.sb.findIndex(b=>stitches<=b.max);const qi=EMB_SELL.qb.findIndex(b=>qty<=b.max);if(si<0||qi<0)return 0;const s=EMB_SELL.prices[si][qi];return sell?s:roundQ(s/EMB_SELL.markup)}
function numPrice(qty,two=false,sell=true){const bi=NUM_PRESS.breaks.findIndex(b=>qty<=b.max);if(bi<0)return 0;return sell?(NUM_PRESS.sell[bi]+(two?roundQ(NUM_PRESS.two_color_add*1.65):0)):(NUM_PRESS.cost[bi]+(two?NUM_PRESS.two_color_add:0))}
function decoPrice(d,qty){
  if(d.type==='screen_print'){const ub=d.underbase?1+SP_SELL.ub_pct:1;return{sell:d.sell_override||roundQ(spPrice(qty,d.colors||1,true)*ub),cost:roundQ(spPrice(qty,d.colors||1,false)*ub)}}
  if(d.type==='embroidery'){return{sell:d.sell_override||embPrice(d.stitches||8000,qty,true),cost:embPrice(d.stitches||8000,qty,false)}}
  if(d.type==='number_press'){return{sell:d.sell_override||numPrice(qty,d.two_color,true),cost:numPrice(qty,d.two_color,false)}}
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0]||DTF[0];return{sell:d.sell_override||t.sell,cost:t.cost}}
  return{sell:0,cost:0};
}

// ---- DEMO DATA ----
const D_CUST=[
{id:'c1',parent_id:null,name:'Orange Lutheran High School',alpha_tag:'OLu',contacts:[{name:'Athletic Director',email:'athletics@orangelutheran.org',phone:'714-555-0100',role:'Athletic Director'},{name:'Janet Wu',email:'jwu@orangelutheran.org',phone:'714-555-0109',role:'Accounting'}],billing_address_line1:'2222 N Santiago Blvd',billing_city:'Orange',billing_state:'CA',billing_zip:'92867',shipping_address_line1:'2222 N Santiago Blvd',shipping_city:'Orange',shipping_state:'CA',shipping_zip:'92867',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.0775,primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:2,_open_invoices:1,_open_balance:4200},
{id:'c1a',parent_id:'c1',name:'OLu Baseball',alpha_tag:'OLuB',contacts:[{name:'Coach Martinez',email:'martinez@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:1,_open_balance:4200},
{id:'c1b',parent_id:'c1',name:'OLu Football',alpha_tag:'OLuF',contacts:[{name:'Coach Davis',email:'davis@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:1,_open_invoices:0,_open_balance:0},
{id:'c1c',parent_id:'c1',name:'OLu Track & Field',alpha_tag:'OLuT',contacts:[{name:'Coach Chen',email:'chen@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c2',parent_id:null,name:'St. Francis High School',alpha_tag:'SF',contacts:[{name:'AD Office',email:'ad@stfrancis.edu',phone:'818-555-0200',role:'Athletic Director'}],billing_city:'La Canada',billing_state:'CA',shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.095,primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c2a',parent_id:'c2',name:'St. Francis Lacrosse',alpha_tag:'SFL',contacts:[{name:'Coach Resch',email:'resch@stfrancis.edu',phone:'',role:'Head Coach'}],shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c3',parent_id:null,name:'Clovis Unified School District',alpha_tag:'CUSD',contacts:[{name:'District Office',email:'purchasing@clovisusd.k12.ca.us',phone:'559-555-0300',role:'Primary'},{name:'AP Department',email:'ap@clovisusd.k12.ca.us',phone:'559-555-0301',role:'Accounting'}],billing_city:'Clovis',billing_state:'CA',shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',tax_rate:0.0863,primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c3a',parent_id:'c3',name:'Clovis High Badminton',alpha_tag:'CHBad',contacts:[{name:'Coach Kim',email:'kim@clovisusd.k12.ca.us',phone:'',role:'Head Coach'}],shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
];
const D_VEND=[
{id:'v1',name:'Adidas',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,invoice_scan_enabled:true,is_active:true,contact_email:'teamorders@adidas.com',contact_phone:'800-448-1796',rep_name:'Sarah Johnson',payment_terms:'net60',notes:'Team dealer program. Min order $500.',_open_invoices:3,_invoice_total:12450,_aging_current:4200,_aging_30:5250,_aging_60:3000,_aging_90:0},
{id:'v2',name:'Under Armour',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,invoice_scan_enabled:true,is_active:true,contact_email:'teamdealer@underarmour.com',contact_phone:'888-727-6687',rep_name:'Mike Daniels',payment_terms:'net60',_open_invoices:2,_invoice_total:8200,_aging_current:5200,_aging_30:3000,_aging_60:0,_aging_90:0},
{id:'v3',name:'SanMar',vendor_type:'api',api_provider:'sanmar',nsa_carries_inventory:false,is_active:true,contact_email:'orders@sanmar.com',contact_phone:'800-426-6399',payment_terms:'net30',notes:'API connected.',_open_invoices:1,_invoice_total:2100,_aging_current:2100,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v4',name:'S&S Activewear',vendor_type:'api',api_provider:'ss_activewear',nsa_carries_inventory:false,is_active:true,contact_email:'service@ssactivewear.com',contact_phone:'800-523-2155',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v5',name:'Richardson',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'sales@richardsoncap.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v6',name:'Rawlings',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'teamorders@rawlings.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v7',name:'Badger',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'orders@badgersport.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
];
const D_PROD=[
{id:'p1',vendor_id:'v1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',category:'Tees',retail_price:55.5,nsa_cost:18.5,available_sizes:['XS','S','M','L','XL','2XL'],is_active:true,_inv:{XS:0,S:12,M:8,L:5,XL:3,'2XL':0},_alerts:{S:10,M:10,L:8,XL:5},_click:{XS:45,S:120,M:89,L:67,XL:34,'2XL':18}},
{id:'p2',vendor_id:'v1',sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',category:'Hoodies',retail_price:85,nsa_cost:28.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:3,M:6,L:4,XL:2,'2XL':0},_alerts:{S:5,M:8,L:8,XL:5},_click:{S:55,M:78,L:92,XL:41,'2XL':22}},
{id:'p3',vendor_id:'v1',sku:'JR9291',name:'Adidas Dropset Control Trainer',brand:'Adidas',color:'Grey Two/FTW White',category:'Footwear',retail_price:120,nsa_cost:37.12,available_sizes:['12','13','14','15'],is_active:true,_inv:{'12':10,'13':4,'14':1,'15':1}},
{id:'p4',vendor_id:'v2',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',category:'Polos',retail_price:65,nsa_cost:22,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:10,L:15,XL:12,'2XL':8},_alerts:{M:8,L:8,XL:5}},
{id:'p5',vendor_id:'v3',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',category:'Tees',retail_price:8.98,nsa_cost:2.85,available_sizes:['S','M','L','XL','2XL','3XL'],is_active:true,_inv:{S:20,M:15,L:10,XL:5,'2XL':0,'3XL':0},_sanmar:{S:4521,M:3890,L:5102,XL:2847,'2XL':1203,'3XL':445}},
{id:'p6',vendor_id:'v3',sku:'K500',name:'Port Authority Silk Touch Polo',brand:'Port Authority',color:'Navy',category:'Polos',retail_price:22.98,nsa_cost:8.2,available_sizes:['XS','S','M','L','XL','2XL','3XL','4XL'],is_active:true,_inv:{XS:0,S:0,M:0,L:0,XL:0,'2XL':0,'3XL':0,'4XL':0},_sanmar:{XS:890,S:3200,M:4100,L:5600,XL:3800,'2XL':2100,'3XL':890,'4XL':320}},
{id:'p7',vendor_id:'v5',sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',category:'Hats',retail_price:12,nsa_cost:4.5,available_sizes:['OSFA'],is_active:true,_inv:{OSFA:50},_alerts:{OSFA:20}},
{id:'p8',vendor_id:'v1',sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',category:'1/4 Zips',retail_price:75,nsa_cost:25,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:2,M:7,L:9,XL:5,'2XL':1},_alerts:{S:5,M:8,L:8,XL:5},_click:{S:44,M:88,L:102,XL:55,'2XL':28}},
{id:'p9',vendor_id:'v2',sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',category:'Shorts',retail_price:45,nsa_cost:15.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:4,L:6,XL:3,'2XL':0}},
];
const D_EST=[
{id:'EST-2089',customer_id:'c1b',memo:'Spring 2026 Football Camp Tees',status:'sent',created_by:'r1',created_at:'02/10/26 9:15 AM',updated_at:'02/10/26 2:30 PM',default_markup:1.65,items:[{product_id:'p5',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,sizes:{S:8,M:15,L:20,XL:12,'2XL':5},available_sizes:['S','M','L','XL','2XL','3XL'],decorations:[{type:'screen_print',position:'Front Center',colors:2,underbase:false,sell_override:null},{type:'screen_print',position:'Back Center',colors:1,underbase:false,sell_override:null}]}]},
{id:'EST-2094',customer_id:'c1b',memo:'Football Coaches Polos',status:'approved',created_by:'r1',created_at:'02/16/26 10:00 AM',updated_at:'02/16/26 10:00 AM',default_markup:1.65,items:[{product_id:'p4',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,sizes:{M:2,L:3,XL:2,'2XL':1},available_sizes:['S','M','L','XL','2XL'],decorations:[{type:'embroidery',position:'Left Chest',stitches:8000,sell_override:null}]}]},
{id:'EST-2101',customer_id:'c3a',memo:'Badminton Team Uniforms',status:'draft',created_by:'r3',created_at:'02/12/26 3:00 PM',updated_at:'02/12/26 3:00 PM',default_markup:1.65,items:[]},
];
const D_SO=[
{id:'SO-1042',customer_id:'c1a',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26',expected_date:'03/15/26',firm_dates:[{item_desc:'Game Jerseys',date:'03/01/26',approved:true}],items:[{product_id:'p1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',nsa_cost:18.5,unit_sell:33.3,sizes:{S:5,M:12,L:15,XL:8,'2XL':3},decorations:[{type:'screen_print',position:'Front Center',colors:3,underbase:true},{type:'number_press',position:'Back Center',two_color:false}]}]},
{id:'SO-1045',customer_id:'c1b',memo:'Football Spring Practice Gear',status:'waiting_art',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26',expected_date:'03/20/26',firm_dates:[],items:[]},
{id:'SO-1051',customer_id:'c2a',memo:'Lacrosse Team Store - Jan 2026',status:'in_production',created_by:'r2',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26',expected_date:'03/10/26',firm_dates:[],items:[]},
];
const D_INV=[
{id:'INV-1042',type:'invoice',customer_id:'c1a',date:'02/10/26',total:4200,paid:0,memo:'Baseball Spring Season Deposit',status:'open'},
{id:'INV-1038',type:'invoice',customer_id:'c2a',date:'01/28/26',total:3400,paid:0,memo:'Lacrosse Preseason Order',status:'open'},
{id:'INV-1039',type:'invoice',customer_id:'c2a',date:'02/01/26',total:3400,paid:3400,memo:'Lacrosse Store Batch 1',status:'paid'},
];

// ---- SHARED UI ----
function Toast({message,type='success'}){if(!message)return null;return<div className={`toast toast-${type}`}>{message}</div>}
function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:a&&sortDir==='desc'?<Icon name="sortDown" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}
function SearchSelect({options,value,onChange,placeholder}){
  const[open,setOpen]=useState(false);const[q,setQ]=useState('');const filtered=options.filter(o=>o.label.toLowerCase().includes(q.toLowerCase()));const selected=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}>
    <span style={{flex:1,color:selected?'#0f172a':'#94a3b8'}}>{selected?selected.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}>
      <div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {filtered.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}
      {filtered.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}</div>}
  </div>)}
function BtnGroup({options,value,onChange,size='sm'}){return<div style={{display:'flex',gap:2}}>{options.map(o=><button key={o.value} className={`btn btn-${size} ${value===o.value?'btn-primary':'btn-secondary'}`} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}

// ---- ESTIMATE BUILDER (Phase 2 core) ----
function EstimateBuilder({estimate,customer:initCust,allCustomers,products,onSave,onBack,currentUser,onNotify}){
  const[est,setEst]=useState(estimate);const[cust,setCust]=useState(initCust);
  const[productSearch,setProductSearch]=useState('');const[showAddProd,setShowAddProd]=useState(false);const[saved,setSaved]=useState(false);
  const set=(k,v)=>setEst(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));
  const isAU=b=>b==='Adidas'||b==='Under Armour';const tierD={A:0.4,B:0.35,C:0.3};

  const selectCustomer=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);set('customer_id',id);set('default_markup',c.catalog_markup||1.65)}};
  const addProduct=p=>{const au=isAU(p.brand);const sell=au?roundQ(p.retail_price*(1-(tierD[cust?.adidas_ua_tier||'B']||0.35))):roundQ(p.nsa_cost*(est.default_markup||1.65));
    set('items',[...est.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:p.available_sizes,sizes:{},decorations:[]}]);setShowAddProd(false);setProductSearch('')};
  const updateItem=(i,k,v)=>set('items',est.items.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const removeItem=i=>set('items',est.items.filter((_,idx)=>idx!==i));
  const updateSize=(i,sz,val)=>{const v=val===''?0:parseInt(val)||0;updateItem(i,'sizes',{...est.items[i].sizes,[sz]:v})};
  const addDeco=i=>{const it=est.items[i];updateItem(i,'decorations',[...it.decorations,{type:'screen_print',position:'Front Center',colors:1,stitches:8000,underbase:false,two_color:false,dtf_size:0,sell_override:null}])};
  const updateDeco=(ii,di,k,v)=>{const it=est.items[ii];updateItem(ii,'decorations',it.decorations.map((d,i)=>i===di?{...d,[k]:v,sell_override:k==='sell_override'?v:d.sell_override}:d))};
  const removeDeco=(ii,di)=>{const it=est.items[ii];updateItem(ii,'decorations',it.decorations.filter((_,i)=>i!==di))};

  const totals=useMemo(()=>{let rev=0,cost=0;est.items.forEach(it=>{const qty=Object.values(it.sizes).reduce((a,v)=>a+v,0);if(!qty)return;rev+=qty*it.unit_sell;cost+=qty*it.nsa_cost;
    it.decorations.forEach(d=>{const dp=decoPrice(d,qty);rev+=qty*dp.sell;cost+=qty*dp.cost})});return{rev,cost,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[est.items]);

  const filteredProds=products.filter(p=>{if(!productSearch)return true;const q=productSearch.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)});

  return(<div>
    <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Estimates</button>

    {/* HEADER */}
    <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{est.id}</span>
            <span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':est.status==='approved'?'badge-green':'badge-red'}`}>{est.status}</span></div>
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>({value:c.id,label:`${c.name} (${c.alpha_tag})`}))} value={est.customer_id} onChange={selectCustomer} placeholder="Search customer..."/></div>
          :<div style={{fontSize:13,color:'#64748b'}}>{cust.name} ({cust.alpha_tag}) | Tier {cust.adidas_ua_tier} | {est.default_markup}x catalog</div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Created by {REPS.find(r=>r.id===est.created_by)?.name} · {est.created_at}{est.updated_at!==est.created_at&&` · Updated ${est.updated_at}`}</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <div style={{textAlign:'center',padding:'10px 18px',background:'#f0fdf4',borderRadius:8}}><div style={{fontSize:10,color:'#166534',fontWeight:700}}>REVENUE</div><div style={{fontSize:22,fontWeight:800,color:'#166534'}}>${totals.rev.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'10px 18px',background:'#fef2f2',borderRadius:8}}><div style={{fontSize:10,color:'#dc2626',fontWeight:700}}>COST</div><div style={{fontSize:22,fontWeight:800,color:'#dc2626'}}>${totals.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'10px 18px',background:'#dbeafe',borderRadius:8}}><div style={{fontSize:10,color:'#1e40af',fontWeight:700}}>MARGIN</div><div style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>${totals.margin.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div style={{fontSize:11,color:'#64748b'}}>{totals.pct.toFixed(1)}%</div></div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end'}}>
        <div style={{flex:1}}><label className="form-label">Memo *</label><input className="form-input" value={est.memo} onChange={e=>set('memo',e.target.value)} placeholder="e.g. Spring 2026 Baseball Uniforms" style={{fontSize:14}}/></div>
        <div style={{width:80}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={est.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;set('default_markup',m);set('items',est.items.map(it=>isAU(it.brand)?it:{...it,unit_sell:roundQ(it.nsa_cost*m)}))}}/></div>
        <button className="btn btn-primary" onClick={()=>{onSave(est);setSaved(true);onNotify('Estimate saved')}}><Icon name="check" size={14}/> Save</button>
        {saved&&<button className="btn btn-secondary" onClick={()=>{const emails=cust?.contacts?.map(c=>c.email).filter(Boolean).join(', ');onNotify(`Email ready for: ${emails} (Phase 2 email integration)`)}}><Icon name="send" size={14}/> Email to Coach</button>}
        {est.status==='draft'&&<button className="btn btn-secondary" onClick={()=>{set('status','sent');onSave({...est,status:'sent'});setSaved(true);onNotify('Estimate sent')}}><Icon name="send" size={14}/> Mark Sent</button>}
      </div>
    </div></div>

    {/* LINE ITEMS */}
    {est.items.map((item,idx)=>{const qty=Object.values(item.sizes).reduce((a,v)=>a+v,0);
      let decoRev=0,decoCost=0;item.decorations.forEach(d=>{const dp=decoPrice(d,qty);decoRev+=qty*dp.sell;decoCost+=qty*dp.cost});
      const itemRev=qty*item.unit_sell+decoRev;const itemCost=qty*item.nsa_cost+decoCost;const margin=itemRev-itemCost;
      const sizes=item.available_sizes?item.available_sizes.filter(s=>showSize(s,item.sizes[s])):['S','M','L','XL','2XL'];
      return(<div key={idx} className="card" style={{marginBottom:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>
                <span style={{fontWeight:700,fontSize:15}}>{item.name}</span><span className="badge badge-gray">{item.color}</span></div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:8}}>
                <span style={{fontSize:13,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong></span>
                <span style={{fontSize:13}}>Sell: <input value={item.unit_sell} onChange={e=>updateItem(idx,'unit_sell',parseFloat(e.target.value)||0)} style={{width:70,border:'1px solid #d1d5db',borderRadius:4,padding:'4px 8px',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center'}}/>/ea</span>
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}
                {!isAU(item.brand)&&<span style={{fontSize:12,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
              </div>
            </div>
            <div style={{textAlign:'right',fontSize:12}}>
              <div>Qty: <strong style={{fontSize:16}}>{qty}</strong></div>
              <div style={{marginTop:2}}>Rev: <strong style={{color:'#166534'}}>${itemRev.toFixed(0)}</strong></div>
              <div>Margin: <strong style={{color:margin>0?'#1e40af':'#dc2626'}}>${margin.toFixed(0)} ({itemRev>0?(margin/itemRev*100).toFixed(0):0}%)</strong></div>
            </div>
            <button onClick={()=>removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={16}/></button>
          </div>
        </div>
        {/* SIZES */}
        <div style={{padding:'10px 18px',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #f1f5f9'}}>
          <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:50}}>Sizes:</span>
          {sizes.map(sz=><div key={sz} style={{textAlign:'center',width:48}}>
            <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
            <input value={item.sizes[sz]||''} onChange={e=>updateSize(idx,sz,e.target.value)} placeholder="0"
              style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:(item.sizes[sz]||0)>0?'#0f172a':'#cbd5e1'}}/>
          </div>)}
          <div style={{textAlign:'center',marginLeft:8,padding:'0 12px',borderLeft:'2px solid #e2e8f0'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOTAL</div>
            <div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div>
          </div>
        </div>
        {/* DECORATIONS */}
        <div style={{padding:'8px 18px 14px'}}>
          {item.decorations.map((deco,di)=>{const dp=decoPrice(deco,qty);return(<div key={di} style={{padding:'10px 0',borderTop:di>0?'1px solid #f8fafc':''}}>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
              <BtnGroup options={[{value:'screen_print',label:'Screen Print'},{value:'embroidery',label:'Embroidery'},{value:'number_press',label:'Numbers'},{value:'dtf',label:'DTF'}]} value={deco.type} onChange={v=>updateDeco(idx,di,'type',v)}/>
              <select className="form-select" style={{width:130,fontSize:12}} value={deco.position} onChange={e=>updateDeco(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}</select>
              <button onClick={()=>removeDeco(idx,di)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {deco.type==='screen_print'&&<><span style={{fontSize:12,fontWeight:600}}>Colors:</span><BtnGroup options={[1,2,3,4,5].map(n=>({value:n,label:String(n)}))} value={deco.colors||1} onChange={v=>updateDeco(idx,di,'colors',v)} size="sm"/>
                <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginLeft:8}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>updateDeco(idx,di,'underbase',e.target.checked)}/> Underbase (+15%)</label></>}
              {deco.type==='embroidery'&&<><span style={{fontSize:12,fontWeight:600}}>Stitches:</span><BtnGroup options={[{value:8000,label:'0-10k'},{value:12000,label:'10-15k'},{value:18000,label:'15-20k'},{value:25000,label:'20k+'}]} value={deco.stitches||8000} onChange={v=>updateDeco(idx,di,'stitches',v)} size="sm"/></>}
              {deco.type==='number_press'&&<label style={{fontSize:12,display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>updateDeco(idx,di,'two_color',e.target.checked)}/> 2-Color (+$3 cost)</label>}
              {deco.type==='dtf'&&<BtnGroup options={DTF.map((d,i)=>({value:i,label:d.label}))} value={deco.dtf_size||0} onChange={v=>updateDeco(idx,di,'dtf_size',v)} size="sm"/>}
              <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
                <span style={{fontSize:14}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                <span style={{fontSize:14}}>Sell: <input value={deco.sell_override||dp.sell} onChange={e=>updateDeco(idx,di,'sell_override',parseFloat(e.target.value)||null)}
                  style={{width:60,border:'1px solid #d1d5db',borderRadius:4,padding:'3px 6px',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center'}}/></span>
              </div>
            </div>
          </div>)})}
          <button className="btn btn-sm btn-secondary" onClick={()=>addDeco(idx)} style={{marginTop:6}}><Icon name="plus" size={12}/> Add Decoration</button>
        </div>
      </div>)})}

    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAddProd?<button className="btn btn-primary" onClick={()=>setShowAddProd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search products..." value={productSearch} onChange={e=>setProductSearch(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:250,overflow:'auto'}}>{filteredProds.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addProduct(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:600}}>{p.name}</span><span className="badge badge-blue">{p.brand}</span>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>Cost: ${p.nsa_cost?.toFixed(2)}</span>
        </div>)}</div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAddProd(false);setProductSearch('')}} style={{marginTop:8}}>Cancel</button>
      </div>}
    </div></div>
  </div>);
}

// ---- FULL CUSTOMER DETAIL (restored from v2.3) ----
function CustomerDetail({customer,allCustomers,allOrders,onBack,onEdit,onSelectCustomer,onCreateEstimate}){
  const[tab,setTab]=useState('activity');const[orderFilter,setOrderFilter]=useState('all');const[statusFilter,setStatusFilter]=useState('all');const[reportRange,setReportRange]=useState('thisyear');
  const isParent=!customer.parent_id;const subs=isParent?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const tl={prepay:'Prepay',net15:'Net 15',net30:'Net 30',net60:'Net 60'};const tierLabel={A:'40% off retail',B:'35% off retail',C:'30% off retail'};
  const custIds=isParent?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const orders=allOrders.filter(o=>custIds.includes(o.customer_id));
  const filteredOrders=orders.filter(o=>{if(orderFilter!=='all'&&o.type!==orderFilter)return false;if(statusFilter==='open')return['sent','draft','open','in_production','waiting_art'].includes(o.status);if(statusFilter==='closed')return['approved','paid','completed','shipped'].includes(o.status);return true});
  const getCN=id=>{const c=allCustomers.find(x=>x.id===id);return c?.alpha_tag||''};
  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Customers</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="building" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{customer.name}</span><span className="badge badge-blue">{customer.alpha_tag}</span><span className="badge badge-green">Tier {customer.adidas_ua_tier}</span><span className="badge badge-gray">{tl[customer.payment_terms]||'Net 30'}</span><span className="badge badge-gray">{customer.catalog_markup||1.65}x</span></div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(customer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email}{i<customer.contacts.length-1&&' | '}</span>)}{customer.shipping_city&&<span> | {customer.shipping_city}, {customer.shipping_state}</span>}</div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}><button className="btn btn-sm btn-primary" onClick={()=>onCreateEstimate(customer)}><Icon name="file" size={12}/> Create Estimate</button><button className="btn btn-sm btn-primary"><Icon name="cart" size={12}/> Create Sales Order</button><button className="btn btn-sm btn-secondary"><Icon name="mail" size={12}/> Email Portal Link</button><button className="btn btn-sm btn-secondary"><Icon name="eye" size={12}/> View Customer Portal</button><button className="btn btn-sm btn-secondary" onClick={()=>onEdit(customer)}><Icon name="edit" size={12}/> Edit</button></div>
  </div>
  {(customer._open_balance||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>OPEN BALANCE</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${customer._open_balance.toLocaleString()}</div></div>}
  </div></div>
  <div className="stats-row">
    <div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value">{customer._open_estimates||0}</div></div>
    <div className="stat-card"><div className="stat-label">Open Sales Orders</div><div className="stat-value">{customer._open_sos||0}</div></div>
    <div className="stat-card"><div className="stat-label">Open Invoices</div><div className="stat-value" style={{color:(customer._open_invoices||0)>0?'#dc2626':''}}>{customer._open_invoices||0}</div></div>
    <div className="stat-card"><div className="stat-label">Open Balance</div><div className="stat-value" style={{color:(customer._open_balance||0)>0?'#dc2626':''}}>${(customer._open_balance||0).toLocaleString()}</div></div>
  </div>
  {isParent&&subs.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Sub-Customers ({subs.length})</h2></div><div className="card-body" style={{padding:0}}>
  {subs.map(s=><div key={s.id} style={{padding:'10px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>onSelectCustomer(s)}>
    <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{s.name}</span><span className="badge badge-gray">{s.alpha_tag}</span><span style={{fontSize:11,color:'#94a3b8'}}>{(s.contacts||[])[0]?.name}</span><div style={{flex:1}}/>
    {(s._open_estimates||0)>0&&<span className="badge badge-amber">{s._open_estimates} est</span>}{(s._open_sos||0)>0&&<span className="badge badge-blue">{s._open_sos} SO</span>}
    {(s._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${s._open_balance.toLocaleString()}</span>}
  </div>)}</div></div>}
  <div className="tabs">{['activity','overview','artwork','reporting'].map(t=><button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t==='activity'?'Orders & Invoices':t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
  {tab==='activity'&&<div className="card"><div className="card-header"><h2>Orders & Invoices</h2><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
    {[['all','All'],['estimate','Estimates'],['sales_order','SOs'],['invoice','Invoices']].map(([v,l])=><button key={v} className={`btn btn-sm ${orderFilter===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOrderFilter(v)}>{l}</button>)}
    <span style={{width:1,background:'#e2e8f0',margin:'0 4px'}}/>
    {[['all','All Status'],['open','Open'],['closed','Closed']].map(([v,l])=><button key={v} className={`btn btn-sm ${statusFilter===v?'btn-primary':'btn-secondary'}`} onClick={()=>setStatusFilter(v)}>{l}</button>)}
  </div></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Type</th><th>Date</th><th>Memo</th>{isParent&&<th>Sub</th>}<th>Total</th><th>Status</th></tr></thead><tbody>
    {filteredOrders.length===0?<tr><td colSpan={7} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>:
    filteredOrders.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(o=><tr key={o.id}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{o.id}</td>
      <td><span className={`badge ${o.type==='estimate'?'badge-amber':o.type==='sales_order'?'badge-blue':'badge-red'}`}>{o.type==='sales_order'?'SO':o.type==='estimate'?'Est':'Inv'}</span></td>
      <td>{o.date}</td><td style={{fontSize:12,maxWidth:200}}>{o.memo}</td>{isParent&&<td><span className="badge badge-gray">{getCN(o.customer_id)}</span></td>}
      <td style={{fontWeight:700}}>${o.total?.toLocaleString()}</td>
      <td><span className={`badge ${o.status==='open'||o.status==='sent'?'badge-amber':o.status==='approved'||o.status==='paid'?'badge-green':o.status==='draft'?'badge-gray':'badge-blue'}`}>{o.status?.replace(/_/g,' ')}</span></td>
    </tr>)}</tbody></table></div></div>}
  {tab==='overview'&&<div className="card"><div className="card-header"><h2>Customer Information</h2></div><div className="card-body">
    <div className="form-row form-row-3"><div><div className="form-label">Billing Address</div><div style={{fontSize:13}}>{customer.billing_address_line1||'--'}<br/>{customer.billing_city}, {customer.billing_state} {customer.billing_zip}</div></div>
    <div><div className="form-label">Shipping Address</div><div style={{fontSize:13}}>{customer.shipping_address_line1||'--'}<br/>{customer.shipping_city}, {customer.shipping_state}</div></div>
    <div><div className="form-label">Tax Rate</div><div style={{fontSize:13}}>{customer.tax_rate?(customer.tax_rate*100).toFixed(2)+'%':'Auto'}</div></div></div>
    <div style={{marginTop:16}}><div className="form-label">Pricing</div><div style={{fontSize:13}}>Adidas/UA: Tier {customer.adidas_ua_tier} ({tierLabel[customer.adidas_ua_tier]})<br/>Catalog: {customer.catalog_markup||1.65}x from cost</div></div>
    <div style={{marginTop:16}}><div className="form-label">Contacts</div>{(customer.contacts||[]).map((c,i)=><div key={i} style={{fontSize:13,padding:'4px 0'}}><strong>{c.name}</strong> ({c.role}) - {c.email} {c.phone&&`| ${c.phone}`}</div>)}</div>
  </div></div>}
  {tab==='artwork'&&<div className="card"><div className="card-body"><div className="empty">Art library populates in Phase 3</div></div></div>}
  {tab==='reporting'&&<div className="card"><div className="card-header"><h2>Sales Reporting</h2><div style={{display:'flex',gap:4}}>
    {[['thisyear','This Year'],['lastyear','Last Year'],['rolling','Rolling 12mo'],['alltime','All Time']].map(([v,l])=><button key={v} className={`btn btn-sm ${reportRange===v?'btn-primary':'btn-secondary'}`} onClick={()=>setReportRange(v)}>{l}</button>)}</div></div>
    <div className="card-body"><div className="stats-row">
      <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{reportRange==='thisyear'?'$15,600':reportRange==='lastyear'?'$32,600':reportRange==='rolling'?'$41,800':'$48,200'}</div></div>
      <div className="stat-card"><div className="stat-label">Total Orders</div><div className="stat-value">{reportRange==='thisyear'?'4':reportRange==='lastyear'?'8':reportRange==='rolling'?'10':'12'}</div></div>
      <div className="stat-card"><div className="stat-label">Avg Order</div><div className="stat-value">{reportRange==='thisyear'?'$3,900':reportRange==='lastyear'?'$4,075':reportRange==='rolling'?'$4,180':'$4,017'}</div></div>
      <div className="stat-card"><div className="stat-label">Lifetime Value</div><div className="stat-value">$48,200</div></div>
    </div><div style={{color:'#94a3b8',fontSize:13,textAlign:'center',padding:20}}>Monthly chart and sub-customer breakdown populates with real data</div></div></div>}
  </div>);
}

// ---- VENDOR DETAIL (restored) ----
function VendorDetail({vendor,onBack}){
  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Vendors</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="package" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{vendor.name}</span>
      <span className={`badge ${vendor.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{vendor.vendor_type==='api'?'API':'Upload'}</span>
      <span className="badge badge-gray">{vendor.payment_terms?.replace('net','Net ')}</span>
      {vendor.nsa_carries_inventory&&<span className="badge badge-green">NSA Stock</span>}</div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{vendor.contact_email} {vendor.contact_phone&&`| ${vendor.contact_phone}`} {vendor.rep_name&&`| Rep: ${vendor.rep_name}`}</div>
    {vendor.notes&&<div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{vendor.notes}</div>}
  </div>
  {(vendor._invoice_total||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>TOTAL OWED</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${vendor._invoice_total.toLocaleString()}</div></div>}
  </div></div>
  <div className="stats-row">
    <div className="stat-card"><div className="stat-label">Open Invoices</div><div className="stat-value">{vendor._open_invoices||0}</div></div>
    <div className="stat-card"><div className="stat-label">Current</div><div className="stat-value" style={{color:'#166534'}}>${(vendor._aging_current||0).toLocaleString()}</div></div>
    <div className="stat-card"><div className="stat-label">30 Day</div><div className="stat-value" style={{color:(vendor._aging_30||0)>0?'#d97706':''}}>${(vendor._aging_30||0).toLocaleString()}</div></div>
    <div className="stat-card"><div className="stat-label">60+ Day</div><div className="stat-value" style={{color:(vendor._aging_60||0)+(vendor._aging_90||0)>0?'#dc2626':''}}>${((vendor._aging_60||0)+(vendor._aging_90||0)).toLocaleString()}</div></div>
  </div>
  <div className="card"><div className="card-header"><h2>Purchase Orders</h2></div><div className="card-body"><div className="empty">PO tracking in Phase 4</div></div></div>
  </div>);
}

// ---- CUSTOMER MODAL (restored) ----
function CustomerModal({isOpen,onClose,onSave,customer,parents}){
  const blank={parent_id:null,name:'',alpha_tag:'',contacts:[{name:'',email:'',phone:'',role:'Head Coach'}],shipping_city:'',shipping_state:'',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30'};
  const[form,setForm]=useState(customer||blank);const[custType,setCustType]=useState(customer?.parent_id?'sub':'parent');const[errors,setErrors]=useState({});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  React.useEffect(()=>{setForm(customer||blank);setCustType(customer?.parent_id?'sub':'parent');setErrors({})},[customer,isOpen]); // eslint-disable-line
  const addC=()=>set('contacts',[...(form.contacts||[]),{name:'',email:'',phone:'',role:'Head Coach'}]);const rmC=i=>set('contacts',(form.contacts||[]).filter((_,x)=>x!==i));
  const upC=(i,k,v)=>set('contacts',(form.contacts||[]).map((c,x)=>x===i?{...c,[k]:v}:c));
  const ok=()=>{const e={};if(!form.name)e.n=1;if(!form.alpha_tag)e.a=1;if(!form.shipping_city)e.c=1;if(!form.shipping_state)e.s=1;if(custType==='sub'&&!form.parent_id)e.p=1;if(!(form.contacts||[])[0]?.name)e.cn=1;if(!(form.contacts||[])[0]?.email)e.ce=1;setErrors(e);return!Object.keys(e).length};
  if(!isOpen)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700}}>
  <div className="modal-header"><h2>{customer?.id?'Edit':'New'} Customer</h2><button className="modal-close" onClick={onClose}>x</button></div>
  <div className="modal-body">
    <div style={{display:'flex',gap:8,marginBottom:16}}>{['parent','sub'].map(t=><button key={t} className={`btn btn-sm ${custType===t?'btn-primary':'btn-secondary'}`} onClick={()=>{setCustType(t);if(t==='parent')set('parent_id',null)}}>{t==='parent'?'Parent':'Sub-Customer'}</button>)}</div>
    {custType==='sub'&&<div className="form-group" style={{marginBottom:12}}><label className="form-label">Parent *</label><SearchSelect options={parents.map(p=>({value:p.id,label:`${p.name} (${p.alpha_tag})`}))} value={form.parent_id} onChange={v=>set('parent_id',v)} placeholder="Search parent..."/></div>}
    <div className="form-row form-row-3"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e=>set('name',e.target.value)} style={errors.n?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Alpha Tag *</label><input className="form-input" value={form.alpha_tag||''} onChange={e=>set('alpha_tag',e.target.value)} style={errors.a?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Terms</label><select className="form-select" value={form.payment_terms||'net30'} onChange={e=>set('payment_terms',e.target.value)}><option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:8,marginBottom:6,textTransform:'uppercase'}}>Contacts *</div>
    {(form.contacts||[]).map((c,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 100px auto',gap:6,marginBottom:6}}>
      <input className="form-input" placeholder="Name *" value={c.name} onChange={e=>upC(i,'name',e.target.value)} style={i===0&&errors.cn&&!c.name?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Email *" value={c.email} onChange={e=>upC(i,'email',e.target.value)} style={i===0&&errors.ce&&!c.email?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Phone" value={c.phone} onChange={e=>upC(i,'phone',e.target.value)}/>
      <select className="form-select" value={c.role} onChange={e=>upC(i,'role',e.target.value)} style={{fontSize:11}}>{CONTACT_ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select>
      {i>0?<button className="btn btn-sm btn-secondary" onClick={()=>rmC(i)}><Icon name="trash" size={12}/></button>:<div/>}
    </div>)}<button className="btn btn-sm btn-secondary" onClick={addC}><Icon name="plus" size={12}/> Add Contact</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Shipping *</div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:8}}><input className="form-input" placeholder="Street" value={form.shipping_address_line1||''} onChange={e=>set('shipping_address_line1',e.target.value)}/><input className="form-input" placeholder="City *" value={form.shipping_city||''} onChange={e=>set('shipping_city',e.target.value)} style={errors.c?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ST *" value={form.shipping_state||''} onChange={e=>set('shipping_state',e.target.value)} style={errors.s?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ZIP" value={form.shipping_zip||''} onChange={e=>set('shipping_zip',e.target.value)}/></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Pricing</div>
    <div className="form-row form-row-2"><div className="form-group"><label className="form-label">Adidas/UA Tier</label><select className="form-select" value={form.adidas_ua_tier||'B'} onChange={e=>set('adidas_ua_tier',e.target.value)}><option value="A">A - 40% off</option><option value="B">B - 35% off</option><option value="C">C - 30% off</option></select></div>
      <div className="form-group"><label className="form-label">Catalog Markup</label><input className="form-input" type="number" step="0.05" value={form.catalog_markup||1.65} onChange={e=>set('catalog_markup',parseFloat(e.target.value)||1.65)}/></div></div>
  </div>
  <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{if(!ok())return;onSave({...form,id:form.id||'c'+Date.now(),parent_id:custType==='sub'?form.parent_id:null,is_active:true,_open_estimates:form._open_estimates||0,_open_sos:form._open_sos||0,_open_invoices:form._open_invoices||0,_open_balance:form._open_balance||0});onClose()}}>Save</button></div>
  </div></div>);
}

// ---- ADJUST INVENTORY MODAL ----
function AdjInvModal({isOpen,onClose,product,onSave}){
  const[adj,setAdj]=useState({});React.useEffect(()=>{if(product)setAdj({...product._inv})},[product,isOpen]);
  if(!isOpen||!product)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
    <div className="modal-header"><h2>Adjust Inventory</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body"><div style={{padding:'12px',background:'#f8fafc',borderRadius:6,marginBottom:12}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{product.sku}</span> {product.name}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{product.available_sizes.map(s=><div key={s} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>{s}</div>
        <input className="form-input" type="number" min="0" style={{width:60,textAlign:'center'}} value={adj[s]||0} onChange={e=>setAdj(a=>({...a,[s]:parseInt(e.target.value)||0}))}/><div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>was: {product._inv?.[s]||0}</div></div>)}</div>
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{onSave(product.id,adj);onClose()}}>Save</button></div>
  </div></div>);
}

// ---- MAIN APP ----
export default function App(){
  const[page,setPage]=useState('dashboard');const[toast,setToast]=useState(null);
  const[customers,setCustomers]=useState(D_CUST);const[vendors]=useState(D_VEND);const[products,setProducts]=useState(D_PROD);
  const[estimates,setEstimates]=useState(D_EST);const[salesOrders]=useState(D_SO);const[invoices]=useState(D_INV);
  const[custModal,setCustModal]=useState({open:false,customer:null});const[adjInvModal,setAdjInvModal]=useState({open:false,product:null});
  const[search,setSearch]=useState('');const[selectedCustomer,setSelectedCustomer]=useState(null);const[selectedVendor,setSelectedVendor]=useState(null);
  const[editEst,setEditEst]=useState(null);const[editEstCust,setEditEstCust]=useState(null);
  const[repFilter,setRepFilter]=useState('all');
  const[productFilter,setProductFilter]=useState({category:'all',vendor:'all',stock:'all',color:'all'});
  const[invSort,setInvSort]=useState({field:'value',dir:'desc'});const[invFilter,setInvFilter]=useState({category:'all',vendor:'all',color:'all'});
  const cu=REPS[0];const isAdmin=cu.role==='admin';
  const notify=(m,t='success')=>{setToast({msg:m,type:t});setTimeout(()=>setToast(null),3500)};
  const parents=useMemo(()=>customers.filter(c=>!c.parent_id),[customers]);
  const getKids=useCallback(pid=>customers.filter(c=>c.parent_id===pid),[customers]);
  const colors=useMemo(()=>[...new Set(products.map(p=>p.color).filter(Boolean))].sort(),[products]);
  const saveCust=c=>{setCustomers(p=>{const e=p.find(x=>x.id===c.id);return e?p.map(x=>x.id===c.id?c:x):[...p,c]});notify('Customer saved')};
  const saveEst=e=>{setEstimates(p=>{const ex=p.find(x=>x.id===e.id);return ex?p.map(x=>x.id===e.id?e:x):[...p,e]})};
  const saveInv=(pid,inv)=>{setProducts(p=>p.map(x=>x.id===pid?{...x,_inv:inv}:x));notify('Inventory updated')};

  const newEst=(cust)=>{const e={id:'EST-'+(2100+estimates.length),customer_id:cust?.id||null,memo:'',status:'draft',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:cust?.catalog_markup||1.65,items:[]};setEditEst(e);setEditEstCust(cust||null);setPage('estimates')};

  const allOrders=useMemo(()=>[
    ...estimates.map(e=>{const t=e.items?.reduce((a,it)=>{const q=Object.values(it.sizes||{}).reduce((s,v)=>s+v,0);let r=q*it.unit_sell;it.decorations?.forEach(d=>{const dp=decoPrice(d,q);r+=q*dp.sell});return a+r},0)||0;return{id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0],total:t,memo:e.memo,status:e.status}}),
    ...salesOrders.map(s=>{const t=s.items?.reduce((a,it)=>{const q=Object.values(it.sizes||{}).reduce((ss,v)=>ss+v,0);return a+q*(it.unit_sell||0)},0)||0;return{id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0],total:t,memo:s.memo,status:s.status}}),
    ...invoices.map(i=>({...i,type:'invoice'}))
  ],[estimates,salesOrders,invoices]);

  const fProds=useMemo(()=>{let l=products;if(search&&page==='products'){const q=search.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)||p.color?.toLowerCase().includes(q))}
    if(productFilter.category!=='all')l=l.filter(p=>p.category===productFilter.category);if(productFilter.vendor!=='all')l=l.filter(p=>p.vendor_id===productFilter.vendor);
    if(productFilter.stock==='instock')l=l.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(productFilter.color!=='all')l=l.filter(p=>p.color===productFilter.color);return l},[products,search,productFilter,page]);
  const invData=useMemo(()=>{let l=products.filter(p=>Object.values(p._inv||{}).some(v=>v>0));
    if(invFilter.category!=='all')l=l.filter(p=>p.category===invFilter.category);if(invFilter.vendor!=='all')l=l.filter(p=>p.vendor_id===invFilter.vendor);if(invFilter.color!=='all')l=l.filter(p=>p.color===invFilter.color);
    if(search&&page==='inventory'){const q=search.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q))}
    const m=l.map(p=>{const t=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);return{...p,_tQ:t,_tV:t*(p.nsa_cost||0)}});
    m.sort((a,b)=>{const f=invSort.field;let va,vb;if(f==='sku'){va=a.sku;vb=b.sku}else if(f==='name'){va=a.name;vb=b.name}else if(f==='qty'){va=a._tQ;vb=b._tQ}else{va=a._tV;vb=b._tV}
    if(typeof va==='string')return invSort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return invSort.dir==='asc'?va-vb:vb-va});return m},[products,invSort,invFilter,search,page]);
  const tIV=useMemo(()=>invData.reduce((a,p)=>a+p._tV,0),[invData]);const tIU=useMemo(()=>invData.reduce((a,p)=>a+p._tQ,0),[invData]);
  const alerts=useMemo(()=>{const al=[];products.forEach(p=>{if(!p._alerts)return;Object.entries(p._alerts).forEach(([sz,min])=>{const c=p._inv?.[sz]||0;if(c<min)al.push({p,sz,c,min,need:min-c})})});return al},[products]);

  // ---- DASHBOARD ----
  const renderDash=()=>(<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{estimates.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div>
      <div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{salesOrders.filter(s=>!['completed','shipped'].includes(s.status)).length}</div></div>
      <div className="stat-card"><div className="stat-label">Inventory Value</div><div className="stat-value">${tIV.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div className="stat-sub">{tIU} units</div></div>
      {isAdmin&&<div className="stat-card" style={alerts.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:alerts.length>0?'#d97706':''}}>{alerts.length}</div></div>}
    </div>
    {isAdmin&&alerts.length>0&&<div className="card" style={{marginBottom:16,borderLeft:'4px solid #d97706'}}><div className="card-header"><h2 style={{color:'#d97706'}}><Icon name="alert" size={16}/> Stock Alerts</h2><button className="btn btn-sm btn-primary" onClick={()=>notify('Draft restock PO generated!')}>Auto-Restock PO</button></div>
      <div className="card-body" style={{padding:0}}><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Current</th><th>Min</th><th>Need</th></tr></thead><tbody>
      {alerts.slice(0,8).map((a,i)=><tr key={i}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{a.p.sku}</td><td style={{fontSize:12}}>{a.p.name}</td><td><span className="badge badge-amber">{a.sz}</span></td><td style={{fontWeight:700,color:'#dc2626'}}>{a.c}</td><td>{a.min}</td><td style={{fontWeight:700}}>{a.need}</td></tr>)}</tbody></table></div></div>}
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newEst(null)}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-primary" onClick={()=>notify('New SO — convert from approved estimate')}><Icon name="box" size={14}/> New SO</button>
      <button className="btn btn-secondary" onClick={()=>notify('New PO (Phase 4)')}><Icon name="cart" size={14}/> New PO</button>
      <button className="btn btn-secondary" onClick={()=>{setPage('customers');setCustModal({open:true,customer:null})}}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>notify('New Vendor (coming soon)')}><Icon name="building" size={14}/> New Vendor</button>
    </div></div>
    <div className="card"><div className="card-header"><h2>Recent Estimates</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Status</th><th>Created</th></tr></thead><tbody>
    {estimates.slice(0,5).map(est=>{const c=customers.find(x=>x.id===est.customer_id);return(<tr key={est.id} style={{cursor:'pointer'}} onClick={()=>{setEditEst(est);setEditEstCust(c);setPage('estimates')}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{est.id}</td><td>{c?.name||'--'} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{est.memo}</td>
      <td><span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':'badge-green'}`}>{est.status}</span></td><td style={{fontSize:11,color:'#94a3b8'}}>{est.created_at}</td></tr>)})}
    </tbody></table></div></div>
  </>);

  // ---- ESTIMATES PAGE ----
  const renderEst=()=>{
    if(editEst)return<EstimateBuilder estimate={editEst} customer={editEstCust} allCustomers={customers} products={products} onSave={e=>{saveEst(e);setEditEst(e)}} onBack={()=>setEditEst(null)} currentUser={cu} onNotify={notify}/>;
    const fe=estimates.filter(e=>!search||(e.id+' '+e.memo+' '+(customers.find(c=>c.id===e.customer_id)?.name||'')+' '+(customers.find(c=>c.id===e.customer_id)?.alpha_tag||'')).toLowerCase().includes(search.toLowerCase()));
    return(<><div style={{display:'flex',gap:8,marginBottom:16}}><div className="search-bar" style={{flex:1}}><Icon name="search"/><input placeholder="Search by ID, customer, or memo..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <button className="btn btn-primary" onClick={()=>newEst(null)}><Icon name="plus" size={14}/> New Estimate</button></div>
      <div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{estimates.length}</div></div><div className="stat-card"><div className="stat-label">Draft</div><div className="stat-value">{estimates.filter(e=>e.status==='draft').length}</div></div><div className="stat-card"><div className="stat-label">Sent</div><div className="stat-value" style={{color:'#d97706'}}>{estimates.filter(e=>e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value" style={{color:'#166534'}}>{estimates.filter(e=>e.status==='approved').length}</div></div></div>
      <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Items</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {fe.map(est=>{const c=customers.find(x=>x.id===est.customer_id);return(<tr key={est.id} style={{cursor:'pointer'}} onClick={()=>{setEditEst(est);setEditEstCust(c)}}>
        <td style={{fontWeight:700,color:'#1e40af'}}>{est.id}</td><td>{c?<span>{c.name} <span className="badge badge-gray">{c.alpha_tag}</span></span>:'--'}</td>
        <td style={{fontSize:12}}>{est.memo}</td><td>{est.items?.length||0}</td>
        <td><span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':'badge-green'}`}>{est.status}</span></td>
        <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===est.created_by)?.name}<br/>{est.created_at}</td>
        <td onClick={e=>e.stopPropagation()}>{est.status==='approved'&&<button className="btn btn-sm btn-secondary" onClick={()=>notify('→ SO (Phase 2)')}>→ SO</button>}</td>
      </tr>)})}
      </tbody></table></div></div></>);
  };

  // ---- SALES ORDERS PAGE ----
  const renderSO=()=>(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total SOs</div><div className="stat-value">{salesOrders.length}</div></div><div className="stat-card"><div className="stat-label">Waiting Art</div><div className="stat-value" style={{color:'#d97706'}}>{salesOrders.filter(s=>s.status==='waiting_art').length}</div></div><div className="stat-card"><div className="stat-label">In Production</div><div className="stat-value" style={{color:'#2563eb'}}>{salesOrders.filter(s=>s.status==='in_production').length}</div></div><div className="stat-card"><div className="stat-label">Ready to Ship</div><div className="stat-value" style={{color:'#166534'}}>{salesOrders.filter(s=>s.status==='ready_ship').length}</div></div></div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Firm Dates</th><th>Status</th><th>Created</th></tr></thead><tbody>
    {salesOrders.map(so=>{const c=customers.find(x=>x.id===so.customer_id);return(<tr key={so.id}><td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td><td>{c?.name} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{so.memo}</td><td>{so.expected_date||'--'}</td>
      <td>{so.firm_dates?.length?so.firm_dates.map((f,i)=><div key={i} style={{fontSize:11}}><span className={`badge ${f.approved?'badge-green':'badge-amber'}`}>{f.date}</span> {f.item_desc}</div>):'--'}</td>
      <td><span className={`badge ${so.status==='waiting_art'?'badge-amber':so.status==='in_production'?'badge-blue':'badge-gray'}`}>{so.status.replace(/_/g,' ')}</span></td>
      <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===so.created_by)?.name}<br/>{so.created_at}</td></tr>)})}
    </tbody></table></div></div></>);

  // ---- CUSTOMERS (full from v2.3) ----
  const renderCust=()=>{
    if(selectedCustomer)return<CustomerDetail customer={selectedCustomer} allCustomers={customers} allOrders={allOrders} onBack={()=>setSelectedCustomer(null)} onEdit={c=>setCustModal({open:true,customer:c})} onSelectCustomer={c=>setSelectedCustomer(c)} onCreateEstimate={c=>newEst(c)}/>;
    const f=parents.filter(p=>{if(repFilter!=='all'&&p.primary_rep_id!==repFilter)return false;if(search){const q=search.toLowerCase();return p.name.toLowerCase().includes(q)||p.alpha_tag?.toLowerCase().includes(q)||getKids(p.id).some(c=>c.name.toLowerCase().includes(q))}return true});
    return(<><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search customers..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <select className="form-select" style={{width:160}} value={repFilter} onChange={e=>setRepFilter(e.target.value)}><option value="all">All Reps</option>{REPS.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button className="btn btn-primary" onClick={()=>setCustModal({open:true,customer:null})}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>notify('CSV Import (coming)')}><Icon name="upload" size={14}/> Import</button></div>
    {f.map(p=>{const kids=getKids(p.id);const bal=kids.reduce((a,c)=>a+(c._open_balance||0),p._open_balance||0);
      const est=kids.reduce((a,c)=>a+(c._open_estimates||0),p._open_estimates||0);const sos=kids.reduce((a,c)=>a+(c._open_sos||0),p._open_sos||0);const inv=kids.reduce((a,c)=>a+(c._open_invoices||0),p._open_invoices||0);
      return(<div key={p.id} className="card" style={{marginBottom:10}}>
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:36,height:36,borderRadius:8,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}} onClick={()=>setSelectedCustomer(p)}><Icon name="building" size={18}/></div>
          <div style={{flex:1,cursor:'pointer'}} onClick={()=>setSelectedCustomer(p)}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:15,fontWeight:700}}>{p.name}</span><span className="badge badge-blue">{p.alpha_tag}</span><span className="badge badge-green">Tier {p.adidas_ua_tier}</span>
              {est>0&&<span className="badge badge-amber">{est} est</span>}{sos>0&&<span className="badge badge-blue">{sos} SO</span>}{inv>0&&<span className="badge badge-red">{inv} inv</span>}</div>
            <div style={{fontSize:12,color:'#94a3b8'}}>{(p.contacts||[])[0]?.name&&`${p.contacts[0].name} · `}{p.billing_city&&`${p.billing_city}, ${p.billing_state}`}<span style={{marginLeft:8,fontSize:11,color:'#64748b'}}>Rep: {REPS.find(r=>r.id===p.primary_rep_id)?.name}</span></div></div>
          {bal>0&&<div style={{textAlign:'right',marginRight:8}}><div style={{fontSize:10,color:'#dc2626',fontWeight:600}}>BALANCE</div><div style={{fontSize:16,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div></div>}
          <button className="btn btn-sm btn-secondary" title="Create Estimate" onClick={e=>{e.stopPropagation();newEst(p)}}><Icon name="file" size={12}/></button>
          <button className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();setCustModal({open:true,customer:p})}}><Icon name="edit" size={12}/></button>
          <button className="btn btn-sm btn-primary" onClick={e=>{e.stopPropagation();setCustModal({open:true,customer:{parent_id:p.id,adidas_ua_tier:p.adidas_ua_tier,catalog_markup:p.catalog_markup,payment_terms:p.payment_terms,contacts:[{name:'',email:'',phone:'',role:'Head Coach'}]}})}}><Icon name="plus" size={12}/> Sub</button>
        </div>
        {kids.length>0&&<div style={{borderTop:'1px solid #f1f5f9'}}>{kids.map(child=><div key={child.id} style={{padding:'8px 16px 8px 64px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid #f8fafc',cursor:'pointer'}} onClick={()=>setSelectedCustomer(child)}>
          <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontSize:13,fontWeight:600}}>{child.name}</span><span className="badge badge-gray">{child.alpha_tag}</span>{(child.contacts||[])[0]?.name&&<span style={{fontSize:11,color:'#94a3b8'}}>{child.contacts[0].name}</span>}<div style={{flex:1}}/>
          {(child._open_estimates||0)>0&&<span className="badge badge-amber">{child._open_estimates} est</span>}{(child._open_sos||0)>0&&<span className="badge badge-blue">{child._open_sos} SO</span>}
          {(child._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${child._open_balance.toLocaleString()}</span>}
        </div>)}</div>}
      </div>)})}
    </>);
  };

  // ---- VENDORS (full from v2.3) ----
  const renderVend=()=>{
    if(selectedVendor)return<VendorDetail vendor={selectedVendor} onBack={()=>setSelectedVendor(null)}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total Vendors</div><div className="stat-value">{vendors.length}</div></div><div className="stat-card"><div className="stat-label">API Connected</div><div className="stat-value">{vendors.filter(v=>v.vendor_type==='api').length}</div></div>
      {isAdmin&&<div className="stat-card"><div className="stat-label">Open AP</div><div className="stat-value" style={{color:'#dc2626'}}>${vendors.reduce((a,v)=>a+(v._invoice_total||0),0).toLocaleString()}</div></div>}
      {isAdmin&&<div className="stat-card"><div className="stat-label">Over 60 Days</div><div className="stat-value" style={{color:'#d97706'}}>${vendors.reduce((a,v)=>a+(v._aging_60||0)+(v._aging_90||0),0).toLocaleString()}</div></div>}</div>
    <div className="card"><div className="card-body" style={{padding:0}}><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>Terms</th><th>NSA Stock</th><th>Live Inv</th>{isAdmin&&<th>Open Inv</th>}{isAdmin&&<th>Total Owed</th>}{isAdmin&&<th>Aging</th>}<th>Status</th></tr></thead><tbody>
    {vendors.map(v=><tr key={v.id} style={{cursor:'pointer'}} onClick={()=>setSelectedVendor(v)}>
      <td style={{fontWeight:700,fontSize:14,color:'#1e40af'}}>{v.name}</td><td><span className={`badge ${v.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{v.vendor_type==='api'?'API':'Upload'}</span></td>
      <td style={{fontSize:11}}>{v.contact_email&&<div>{v.contact_email}</div>}{v.contact_phone&&<div style={{color:'#94a3b8'}}>{v.contact_phone}</div>}</td>
      <td><span className="badge badge-gray">{v.payment_terms?.replace('net','Net ')}</span></td>
      <td>{v.nsa_carries_inventory?<span className="badge badge-green">Yes</span>:'--'}</td>
      <td>{v.api_provider?<span className="badge badge-blue">Live</span>:v.click_automation?<span className="badge badge-amber">CLICK</span>:'--'}</td>
      {isAdmin&&<td style={{fontWeight:700}}>{v._open_invoices||'--'}</td>}
      {isAdmin&&<td style={{fontWeight:700,color:(v._invoice_total||0)>0?'#dc2626':''}}>{(v._invoice_total||0)>0?'$'+v._invoice_total.toLocaleString():'--'}</td>}
      {isAdmin&&<td style={{fontSize:11}}>{(v._invoice_total||0)>0?<><span style={{color:'#166534'}}>Cur:${(v._aging_current||0).toLocaleString()}</span>{(v._aging_30||0)>0&&<span style={{marginLeft:4,color:'#d97706'}}>30d:${v._aging_30.toLocaleString()}</span>}{(v._aging_60||0)>0&&<span style={{marginLeft:4,color:'#dc2626'}}>60d:${v._aging_60.toLocaleString()}</span>}</>:'--'}</td>}
      <td><span className="badge badge-green">Active</span></td></tr>)}
    </tbody></table></div></div></div></>);
  };

  // ---- INVENTORY (full from v2.3 with +INV restored) ----
  const renderInv=()=>(<><div className="stats-row">
    <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{tIU}</div></div>
    <div className="stat-card"><div className="stat-label">Inventory Value</div><div className="stat-value">${tIV.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
    <div className="stat-card"><div className="stat-label">Products in Warehouse</div><div className="stat-value">{invData.length}</div></div>
    {isAdmin&&<div className="stat-card" style={alerts.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:alerts.length>0?'#d97706':''}}>{alerts.length}</div>{alerts.length>0&&<button className="btn btn-sm btn-primary" style={{marginTop:4,fontSize:10}} onClick={()=>notify('Draft restock PO generated!')}>Auto-Restock PO</button>}</div>}
  </div>
  <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
    <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search inventory..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <select className="form-select" style={{width:120}} value={invFilter.category} onChange={e=>setInvFilter(f=>({...f,category:e.target.value}))}><option value="all">All Categories</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
    <select className="form-select" style={{width:120}} value={invFilter.vendor} onChange={e=>setInvFilter(f=>({...f,vendor:e.target.value}))}><option value="all">All Vendors</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
    <select className="form-select" style={{width:140}} value={invFilter.color} onChange={e=>setInvFilter(f=>({...f,color:e.target.value}))}><option value="all">All Colors</option>{colors.map(c=><option key={c} value={c}>{c}</option>)}</select>
  </div>
  <div className="card"><div className="card-body" style={{padding:0}}><div className="table-wrap"><table>
  <thead><tr>
    <SortHeader label="SKU" field="sku" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
    <SortHeader label="Product" field="name" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
    <th>Category</th><th>Inventory by Size</th>
    <SortHeader label="Total Qty" field="qty" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
    <SortHeader label="Value" field="value" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
    <th>Actions</th></tr></thead>
  <tbody>{invData.map(p=><tr key={p.id}>
    <td><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span></td>
    <td style={{fontSize:12}}>{p.name}<br/><span style={{color:'#94a3b8'}}>{p.color}</span></td>
    <td><span className="badge badge-gray">{p.category}</span></td>
    <td><div style={{display:'flex',gap:2,flexWrap:'wrap'}}>{p.available_sizes.filter(s=>showSize(s,p._inv?.[s])).map(s=>{const q=p._inv?.[s]||0;const al=p._alerts?.[s];const below=al&&q<al;return<div key={s} className={`size-cell ${q>10?'in-stock':q>0?(below?'alert-stock':'low-stock'):'no-stock'}`} style={{minWidth:32,padding:'1px 4px'}}><div className="size-label" style={{fontSize:8}}>{s}</div><div className="size-qty" style={{fontSize:12}}>{q}</div></div>})}</div></td>
    <td style={{fontWeight:800,fontSize:16,color:p._tQ<=10?'#d97706':'#166534'}}>{p._tQ}</td>
    <td style={{fontWeight:700}}>${p._tV.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    <td><div style={{display:'flex',gap:4}}>
      <button className="btn btn-sm btn-secondary" onClick={()=>notify('PO creation (Phase 4)')}>+ PO</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>newEst(null)}>+ EST</button>
      {isAdmin&&<button className="btn btn-sm btn-secondary" onClick={()=>setAdjInvModal({open:true,product:p})}><Icon name="edit" size={10}/> INV</button>}
    </div></td>
  </tr>)}</tbody>
  </table></div></div></div></>);

  // ---- SIDEBAR & LAYOUT ----
  const nav=[{section:'Overview'},{id:'dashboard',label:'Dashboard',icon:'home'},
    {section:'Sales'},{id:'estimates',label:'Estimates',icon:'dollar'},{id:'orders',label:'Sales Orders',icon:'box'},
    {section:'People'},{id:'customers',label:'Customers',icon:'users'},{id:'vendors',label:'Vendors',icon:'building'},
    {section:'Catalog'},{id:'products',label:'Products',icon:'package'},{id:'inventory',label:'Inventory',icon:'warehouse'},
    {section:'Coming in Phase 3'},{id:'production',label:'Production',icon:'grid',disabled:true},{id:'artwork',label:'Artwork',icon:'image',disabled:true}];
  const titles={dashboard:'Dashboard',estimates:'Estimates',orders:'Sales Orders',customers:'Customers',vendors:'Vendors',products:'Products',inventory:'Inventory'};

  return(<div className="app">
    <Toast message={toast?.msg} type={toast?.type}/>
    <div className="sidebar">
      <div className="sidebar-logo">NSA<span>Operations Portal</span></div>
      <nav className="sidebar-nav">{nav.map((item,i)=>{if(item.section)return<div key={i} className="sidebar-section">{item.section}</div>;
        return<button key={item.id} className={`sidebar-link ${page===item.id?'active':''}`} disabled={item.disabled} style={item.disabled?{opacity:0.3,cursor:'not-allowed'}:{}}
          onClick={()=>{if(!item.disabled){setPage(item.id);setSearch('');setSelectedCustomer(null);setSelectedVendor(null);setEditEst(null)}}}><Icon name={item.icon}/>{item.label}</button>})}</nav>
      <div className="sidebar-user"><div style={{fontWeight:600,color:'#e2e8f0'}}>{cu.name}</div><div>{cu.role}</div></div>
    </div>
    <div className="main">
      <div className="topbar"><h1>{editEst?editEst.id:selectedCustomer?selectedCustomer.name:selectedVendor?selectedVendor.name:(titles[page]||'Dashboard')}</h1><div style={{fontSize:12,color:'#94a3b8'}}>Phase 2 v2</div></div>
      <div className="content">
        {page==='dashboard'&&renderDash()}
        {page==='estimates'&&renderEst()}
        {page==='orders'&&renderSO()}
        {page==='customers'&&renderCust()}
        {page==='vendors'&&renderVend()}
        {page==='products'&&renderProd()}
        {page==='inventory'&&renderInv()}
      </div>
    </div>
    <CustomerModal isOpen={custModal.open} onClose={()=>setCustModal({open:false,customer:null})} onSave={saveCust} customer={custModal.customer} parents={parents}/>
    <AdjInvModal isOpen={adjInvModal.open} onClose={()=>setAdjInvModal({open:false,product:null})} product={adjInvModal.product} onSave={saveInv}/>
  </div>);
}
