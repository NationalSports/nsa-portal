import React, { useState, useMemo, useCallback } from 'react';
import './portal.css';

const Icon = ({ name, size = 18 }) => {
  const p = {
    home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
    users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
    building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,
    package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,
    box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,
    search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,
    edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    back:<polyline points="15 18 9 12 15 6"/>,
    mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    sortUp:<path d="M7 14l5-5 5 5"/>,sortDown:<path d="M7 10l5 5 5-5"/>,
    sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,
    image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,
    dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
    grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,
    trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
    eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    check:<polyline points="20 6 9 17 4 12"/>,
    clock:<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    copy:<><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>;
};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin'},{id:'r2',name:'Laura Chen',role:'rep'},{id:'r3',name:'Mike Torres',role:'rep'}];
const CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
const CONTACT_ROLES=['Head Coach','Assistant','Accounting','Athletic Director','Primary','Other'];
const roundQ=v=>Math.round(v*4)/4;
const DECO_TYPES=['screen_print','embroidery','number_press','dtf_heat_transfer'];
const DECO_LABELS={screen_print:'Screen Print',embroidery:'Embroidery',number_press:'Number Press',dtf_heat_transfer:'DTF Heat Transfer'};
const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];

// ---- DECORATION PRICING MATRICES (editable) ----
const SCREEN_PRINT_SELL = {
  breaks:[{min:1,max:11,label:'Under 12'},{min:12,max:23,label:'12-23'},{min:24,max:35,label:'24-35'},{min:36,max:47,label:'36-47'},{min:48,max:71,label:'48-71'},{min:72,max:107,label:'72-107'},{min:108,max:143,label:'108-143'},{min:144,max:215,label:'144-215'},{min:216,max:499,label:'250-499'},{min:500,max:99999,label:'500+'}],
  prices:{1:[50,60,70,null,null],2:[5,6.5,8,9,null],3:[3.5,4.5,6,7,8],4:[3.2,4.25,4.75,6,7.5],5:[2.95,3.85,4.25,5,6],6:[2.75,3.5,3.95,4.5,5.25],7:[2.5,3.2,3.7,4,4.75],8:[2.25,3,3.5,3.75,4.25],9:[2.1,2.85,3.1,3.3,4],10:[1.9,2.75,2.9,3.1,3.75]},
  markup:1.5, underbase_pct:0.15
};
const EMBROIDERY_SELL = {
  stitch_breaks:[{min:0,max:10000,label:'0-10k'},{min:10001,max:15000,label:'10-15k'},{min:15001,max:20000,label:'15-20k'},{min:20001,max:999999,label:'20k+'}],
  qty_breaks:[{min:1,max:6,label:'1-6'},{min:7,max:24,label:'7-24'},{min:25,max:48,label:'25-48'},{min:49,max:99999,label:'49+'}],
  prices:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],
  markup:1.6
};
const NUMBER_PRESS = {
  breaks:[{min:1,max:10,label:'Up to 10'},{min:11,max:50,label:'10-50'},{min:51,max:99999,label:'50+'}],
  cost:[4,3,3], sell:[7,6,5], two_color_add_cost:3
};
const DTF_HEAT = {
  sizes:[{label:'4" Sq and Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4" max)',cost:4.5,sell:7.5}]
};

function getScreenPrintPrice(qty, colors, isSell=true) {
  const m = SCREEN_PRINT_SELL;
  const bi = m.breaks.findIndex(b => qty >= b.min && qty <= b.max);
  if (bi < 0 || colors < 1 || colors > 5) return null;
  const sell = bi === 0 ? m.prices[1][colors-1] : m.prices[bi+1]?.[colors-1];
  if (sell == null) return null;
  return isSell ? sell : roundQ(sell / m.markup);
}
function getEmbroideryPrice(stitches, qty, isSell=true) {
  const m = EMBROIDERY_SELL;
  const si = m.stitch_breaks.findIndex(b => stitches >= b.min && stitches <= b.max);
  const qi = m.qty_breaks.findIndex(b => qty >= b.min && qty <= b.max);
  if (si < 0 || qi < 0) return null;
  const sell = m.prices[si][qi];
  return isSell ? sell : roundQ(sell / m.markup);
}
function getNumberPressPrice(qty, twoColor=false, isSell=true) {
  const m = NUMBER_PRESS;
  const bi = m.breaks.findIndex(b => qty >= b.min && qty <= b.max);
  if (bi < 0) return null;
  if (isSell) return m.sell[bi] + (twoColor ? roundQ(m.two_color_add_cost * 1.65) : 0);
  return m.cost[bi] + (twoColor ? m.two_color_add_cost : 0);
}
function getDTFPrice(sizeIdx, isSell=true) {
  const s = DTF_HEAT.sizes[sizeIdx];
  return s ? (isSell ? s.sell : s.cost) : 0;
}

// ---- DEMO DATA (same as v2.3 + estimates/orders) ----
const DEMO_CUSTOMERS=[
{id:'c1',parent_id:null,name:'Orange Lutheran High School',alpha_tag:'OLu',contacts:[{name:'Athletic Director',email:'athletics@orangelutheran.org',phone:'714-555-0100',role:'Athletic Director'},{name:'Janet Wu',email:'jwu@orangelutheran.org',phone:'714-555-0109',role:'Accounting'}],billing_address_line1:'2222 N Santiago Blvd',billing_city:'Orange',billing_state:'CA',billing_zip:'92867',shipping_address_line1:'2222 N Santiago Blvd',shipping_city:'Orange',shipping_state:'CA',shipping_zip:'92867',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.0775,primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:2,_open_invoices:1,_open_balance:4200},
{id:'c1a',parent_id:'c1',name:'OLu Baseball',alpha_tag:'OLuB',contacts:[{name:'Coach Martinez',email:'martinez@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:1,_open_balance:4200},
{id:'c1b',parent_id:'c1',name:'OLu Football',alpha_tag:'OLuF',contacts:[{name:'Coach Davis',email:'davis@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:1,_open_invoices:0,_open_balance:0},
{id:'c1c',parent_id:'c1',name:'OLu Track & Field',alpha_tag:'OLuT',contacts:[{name:'Coach Chen',email:'chen@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c2',parent_id:null,name:'St. Francis High School',alpha_tag:'SF',contacts:[{name:'AD Office',email:'ad@stfrancis.edu',phone:'818-555-0200',role:'Athletic Director'}],billing_city:'La Canada',billing_state:'CA',shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.095,primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c2a',parent_id:'c2',name:'St. Francis Lacrosse',alpha_tag:'SFL',contacts:[{name:'Coach Resch',email:'resch@stfrancis.edu',phone:'',role:'Head Coach'}],shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c3',parent_id:null,name:'Clovis Unified School District',alpha_tag:'CUSD',contacts:[{name:'District Office',email:'purchasing@clovisusd.k12.ca.us',phone:'559-555-0300',role:'Primary'},{name:'AP Department',email:'ap@clovisusd.k12.ca.us',phone:'559-555-0301',role:'Accounting'}],billing_city:'Clovis',billing_state:'CA',shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',tax_rate:0.0863,primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c3a',parent_id:'c3',name:'Clovis High Badminton',alpha_tag:'CHBad',contacts:[{name:'Coach Kim',email:'kim@clovisusd.k12.ca.us',phone:'',role:'Head Coach'}],shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
];
const DEMO_VENDORS=[
{id:'v1',name:'Adidas',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,invoice_scan_enabled:true,is_active:true,contact_email:'teamorders@adidas.com',contact_phone:'800-448-1796',rep_name:'Sarah Johnson',payment_terms:'net60',notes:'Team dealer program.',_open_invoices:3,_invoice_total:12450,_aging_current:4200,_aging_30:5250,_aging_60:3000,_aging_90:0},
{id:'v2',name:'Under Armour',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,invoice_scan_enabled:true,is_active:true,contact_email:'teamdealer@underarmour.com',contact_phone:'888-727-6687',rep_name:'Mike Daniels',payment_terms:'net60',_open_invoices:2,_invoice_total:8200,_aging_current:5200,_aging_30:3000,_aging_60:0,_aging_90:0},
{id:'v3',name:'SanMar',vendor_type:'api',api_provider:'sanmar',nsa_carries_inventory:false,is_active:true,contact_email:'orders@sanmar.com',contact_phone:'800-426-6399',payment_terms:'net30',notes:'API connected.',_open_invoices:1,_invoice_total:2100,_aging_current:2100,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v4',name:'S&S Activewear',vendor_type:'api',api_provider:'ss_activewear',nsa_carries_inventory:false,is_active:true,contact_email:'service@ssactivewear.com',contact_phone:'800-523-2155',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v5',name:'Richardson',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'sales@richardsoncap.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v6',name:'Rawlings',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'teamorders@rawlings.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v7',name:'Badger',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'orders@badgersport.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
];
const DEMO_PRODUCTS=[
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

const DEMO_ESTIMATES=[
{id:'EST-2089',customer_id:'c1b',memo:'Spring 2026 Football Camp Tees',status:'sent',created_by:'r1',created_at:'02/10/26 9:15 AM',updated_at:'02/10/26 2:30 PM',default_markup:1.65,
  items:[{product_id:'p5',sku:'PC61',name:'Port & Company Essential Tee',color:'Jet Black',nsa_cost:2.85,unit_sell:4.75,sizes:{S:8,M:15,L:20,XL:12,'2XL':5},
    decorations:[{type:'screen_print',position:'Front Center',colors:2,underbase:false,cost_each:4.33,sell_each:6.5},{type:'screen_print',position:'Back Center',colors:1,underbase:false,cost_each:1.97,sell_each:2.95}]}]},
{id:'EST-2094',customer_id:'c1b',memo:'Football Coaches Polos',status:'approved',created_by:'r1',created_at:'02/16/26 10:00 AM',updated_at:'02/16/26 10:00 AM',default_markup:1.65,
  items:[{product_id:'p4',sku:'1370399',name:'Under Armour Team Polo',color:'Cardinal/White',nsa_cost:22,unit_sell:39,sizes:{M:2,L:3,XL:2,'2XL':1},
    decorations:[{type:'embroidery',position:'Left Chest',stitches:8000,cost_each:5,sell_each:8}]}]},
{id:'EST-2101',customer_id:'c3a',memo:'Badminton Team Uniforms',status:'draft',created_by:'r3',created_at:'02/12/26 3:00 PM',updated_at:'02/12/26 3:00 PM',default_markup:1.65,items:[]},
];

const DEMO_SALES_ORDERS=[
{id:'SO-1042',customer_id:'c1a',estimate_id:'EST-2088',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26 9:00 AM',expected_date:'03/15/26',
  firm_dates:[{item_desc:'Game Jerseys',date:'03/01/26',approved:true,approved_by:'Production'}],
  items:[{product_id:'p1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',color:'Team Power Red/White',nsa_cost:18.5,unit_sell:33.30,sizes:{S:5,M:12,L:15,XL:8,'2XL':3},
    decorations:[{type:'screen_print',position:'Front Center',colors:3,underbase:true,cost_each:3.25,sell_each:5.46},{type:'number_press',position:'Back Center',two_color:false,cost_each:3,sell_each:5}]}]},
{id:'SO-1045',customer_id:'c1b',estimate_id:null,memo:'Football Spring Practice Gear',status:'waiting_art',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26 2:00 PM',expected_date:'03/20/26',firm_dates:[],items:[]},
{id:'SO-1051',customer_id:'c2a',estimate_id:null,memo:'Lacrosse Team Store - Jan 2026',status:'in_production',created_by:'r2',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26 8:00 AM',expected_date:'03/10/26',firm_dates:[],items:[]},
];

const DEMO_INVOICES=[
{id:'INV-1042',type:'invoice',customer_id:'c1a',date:'02/10/26',total:4200,paid:0,days:8,memo:'Baseball Spring Season Deposit',status:'open'},
{id:'INV-1038',type:'invoice',customer_id:'c2a',date:'01/28/26',total:3400,paid:0,days:21,memo:'Lacrosse Preseason Order',status:'open'},
{id:'INV-1039',type:'invoice',customer_id:'c2a',date:'02/01/26',total:3400,paid:3400,days:17,memo:'Lacrosse Store Batch 1',status:'paid'},
];

// ---- SHARED COMPONENTS ----
function Toast({message,type='success'}){if(!message)return null;return<div className={`toast toast-${type}`}>{message}</div>}
function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:a&&sortDir==='desc'?<Icon name="sortDown" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}
function SearchSelect({options,value,onChange,placeholder}){
  const[open,setOpen]=useState(false);const[q,setQ]=useState('');
  const filtered=options.filter(o=>o.label.toLowerCase().includes(q.toLowerCase()));
  const selected=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}>
    <span style={{flex:1,color:selected?'#0f172a':'#94a3b8'}}>{selected?selected.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}>
      <div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {filtered.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}
      {filtered.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}
    </div>}
  </div>);
}

// ---- ESTIMATE BUILDER ----
function EstimateBuilder({estimate,customer,products,vendors,onSave,onBack,currentUser}){
  const[est,setEst]=useState(estimate||{id:'EST-'+Date.now(),customer_id:customer?.id,memo:'',status:'draft',created_by:currentUser.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:customer?.catalog_markup||1.65,items:[]});
  const[productSearch,setProductSearch]=useState('');const[showAddProduct,setShowAddProduct]=useState(false);
  const set=(k,v)=>setEst(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));
  const isAU=brand=>brand==='Adidas'||brand==='Under Armour';
  const tierDiscount={A:0.4,B:0.35,C:0.3};

  const addProduct=p=>{const brand=p.brand;const au=isAU(brand);
    const unitSell=au?roundQ(p.retail_price*(1-tierDiscount[customer?.adidas_ua_tier||'B'])):roundQ(p.nsa_cost*(est.default_markup||1.65));
    const newItem={product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:unitSell,markup_override:null,sizes:{S:0,M:0,L:0,XL:0,'2XL':0},available_sizes:p.available_sizes,decorations:[]};
    set('items',[...est.items,newItem]);setShowAddProduct(false);setProductSearch('')};
  const updateItem=(idx,k,v)=>set('items',est.items.map((it,i)=>i===idx?{...it,[k]:v}:it));
  const removeItem=idx=>set('items',est.items.filter((_,i)=>i!==idx));
  const updateSize=(idx,sz,qty)=>{const it=est.items[idx];const newSz={...it.sizes,[sz]:parseInt(qty)||0};updateItem(idx,'sizes',newSz)};
  const addDecoration=(idx)=>{const it=est.items[idx];updateItem(idx,'decorations',[...it.decorations,{type:'screen_print',position:'Front Center',colors:1,stitches:8000,underbase:false,two_color:false,dtf_size:0,cost_each:0,sell_each:0}])};
  const updateDeco=(itemIdx,decoIdx,k,v)=>{const it=est.items[itemIdx];const newDecos=it.decorations.map((d,i)=>i===decoIdx?{...d,[k]:v}:d);updateItem(itemIdx,'decorations',newDecos)};
  const removeDeco=(itemIdx,decoIdx)=>{const it=est.items[itemIdx];updateItem(itemIdx,'decorations',it.decorations.filter((_,i)=>i!==decoIdx))};

  const calcDecoPrice=(deco,qty)=>{
    if(deco.type==='screen_print'){const s=getScreenPrintPrice(qty,deco.colors,true);const c=getScreenPrintPrice(qty,deco.colors,false);const ub=deco.underbase?1.15:1;return{sell:s?roundQ(s*ub):deco.sell_each,cost:c?roundQ(c*ub):deco.cost_each}}
    if(deco.type==='embroidery'){const s=getEmbroideryPrice(deco.stitches||8000,qty,true);const c=getEmbroideryPrice(deco.stitches||8000,qty,false);return{sell:s||deco.sell_each,cost:c||deco.cost_each}}
    if(deco.type==='number_press'){const s=getNumberPressPrice(qty,deco.two_color,true);const c=getNumberPressPrice(qty,deco.two_color,false);return{sell:s||deco.sell_each,cost:c||deco.cost_each}}
    if(deco.type==='dtf_heat_transfer'){const s=getDTFPrice(deco.dtf_size||0,true);const c=getDTFPrice(deco.dtf_size||0,false);return{sell:s,cost:c}}
    return{sell:deco.sell_each||0,cost:deco.cost_each||0};
  };

  const totals=useMemo(()=>{let revenue=0,cost=0;
    est.items.forEach(it=>{const qty=Object.values(it.sizes).reduce((a,v)=>a+v,0);if(qty===0)return;
      revenue+=qty*it.unit_sell;cost+=qty*it.nsa_cost;
      it.decorations.forEach(d=>{const dp=calcDecoPrice(d,qty);revenue+=qty*dp.sell;cost+=qty*dp.cost})});
    return{revenue,cost,margin:revenue-cost,pct:revenue>0?((revenue-cost)/revenue*100):0};
  },[est.items]); // eslint-disable-line

  const filteredProds=products.filter(p=>{if(!productSearch)return true;const q=productSearch.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)});

  return(<div>
    <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Estimates</button>
    <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}><span style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{est.id}</span>
            <span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':est.status==='approved'?'badge-green':'badge-red'}`}>{est.status}</span></div>
          <div style={{fontSize:13,color:'#64748b'}}>{customer?.name} ({customer?.alpha_tag}) | Tier {customer?.adidas_ua_tier} | {est.default_markup}x catalog</div>
          <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>Created by {REPS.find(r=>r.id===est.created_by)?.name} · {est.created_at}{est.updated_at!==est.created_at&&` · Updated ${est.updated_at}`}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <div style={{textAlign:'center',padding:'8px 16px',background:'#f0fdf4',borderRadius:6,minWidth:90}}><div style={{fontSize:10,color:'#166534',fontWeight:600}}>REVENUE</div><div style={{fontSize:18,fontWeight:800,color:'#166534'}}>${totals.revenue.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'8px 16px',background:'#fef2f2',borderRadius:6,minWidth:90}}><div style={{fontSize:10,color:'#dc2626',fontWeight:600}}>COST</div><div style={{fontSize:18,fontWeight:800,color:'#dc2626'}}>${totals.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'8px 16px',background:'#dbeafe',borderRadius:6,minWidth:90}}><div style={{fontSize:10,color:'#1e40af',fontWeight:600}}>MARGIN</div><div style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>${totals.margin.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div style={{fontSize:10,color:'#64748b'}}>{totals.pct.toFixed(1)}%</div></div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end'}}>
        <div style={{flex:1}}><label className="form-label">Memo *</label><input className="form-input" value={est.memo} onChange={e=>set('memo',e.target.value)} placeholder="e.g. Spring 2026 Baseball Uniforms"/></div>
        <div style={{width:100}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={est.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;set('default_markup',m);
          set('items',est.items.map(it=>isAU(it.brand)?it:{...it,unit_sell:roundQ(it.nsa_cost*m)}))}}/></div>
        <button className="btn btn-primary" onClick={()=>{onSave(est);}}><Icon name="check" size={14}/> Save</button>
        {est.status==='draft'&&<button className="btn btn-secondary" onClick={()=>{set('status','sent');onSave({...est,status:'sent'})}}><Icon name="send" size={14}/> Send</button>}
      </div>
    </div></div>

    {/* LINE ITEMS */}
    {est.items.map((item,idx)=>{const qty=Object.values(item.sizes).reduce((a,v)=>a+v,0);const itemRev=qty*item.unit_sell;const itemCost=qty*item.nsa_cost;
      let decoRev=0,decoCost=0;item.decorations.forEach(d=>{const dp=calcDecoPrice(d,qty);decoRev+=qty*dp.sell;decoCost+=qty*dp.cost});
      const totalRev=itemRev+decoRev;const totalCost=itemCost+decoCost;const margin=totalRev-totalCost;
      const coreSizes=['S','M','L','XL','2XL'];const showSizes=item.available_sizes?item.available_sizes.filter(s=>{if(coreSizes.includes(s))return true;return!['XS','3XL','4XL'].includes(s)||(item.sizes[s]||0)>0}):coreSizes;
      return(<div key={idx} className="card" style={{marginBottom:12}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',gap:12,alignItems:'flex-start'}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:3}}>{item.sku}</span>
              <span style={{fontWeight:700}}>{item.name}</span><span className="badge badge-gray">{item.color}</span></div>
            <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>Cost: ${item.nsa_cost?.toFixed(2)} | Sell: <input type="number" step="0.25" value={item.unit_sell} onChange={e=>updateItem(idx,'unit_sell',parseFloat(e.target.value)||0)}
              style={{width:70,border:'1px solid #e2e8f0',borderRadius:3,padding:'1px 4px',fontSize:12,fontWeight:700,color:'#166534'}}/> /ea
              {isAU(item.brand)&&<span className="badge badge-blue" style={{marginLeft:6}}>Tier {customer?.adidas_ua_tier}</span>}
              {!isAU(item.brand)&&<span style={{marginLeft:6,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}</div>
          </div>
          <div style={{textAlign:'right',fontSize:11}}>
            <div>Qty: <strong>{qty}</strong> | Rev: <span style={{color:'#166534',fontWeight:700}}>${totalRev.toFixed(0)}</span> | Margin: <span style={{color:margin>0?'#1e40af':'#dc2626',fontWeight:700}}>${margin.toFixed(0)} ({totalRev>0?(margin/totalRev*100).toFixed(0):0}%)</span></div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={()=>removeItem(idx)} style={{color:'#dc2626'}}><Icon name="trash" size={12}/></button>
        </div>
        {/* SIZE MATRIX */}
        <div style={{padding:'8px 16px',display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:11,fontWeight:600,color:'#64748b',marginRight:4}}>Sizes:</span>
          {showSizes.map(sz=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:9,color:'#64748b',fontWeight:600}}>{sz}</div>
            <input type="number" min="0" value={item.sizes[sz]||0} onChange={e=>updateSize(idx,sz,e.target.value)}
              style={{width:40,textAlign:'center',border:'1px solid #e2e8f0',borderRadius:3,padding:'2px',fontSize:13,fontWeight:700}}/></div>)}
          <div style={{textAlign:'center',marginLeft:8}}><div style={{fontSize:9,color:'#1e40af',fontWeight:700}}>TOTAL</div><div style={{fontSize:16,fontWeight:800,color:'#1e40af'}}>{qty}</div></div>
        </div>
        {/* DECORATIONS */}
        <div style={{padding:'4px 16px 12px'}}>
          {item.decorations.map((deco,di)=>{const dp=calcDecoPrice(deco,qty);return(<div key={di} style={{display:'flex',gap:8,alignItems:'center',padding:'6px 0',borderTop:di>0?'1px solid #f8fafc':'',flexWrap:'wrap'}}>
            <select className="form-select" style={{width:140,fontSize:11}} value={deco.type} onChange={e=>updateDeco(idx,di,'type',e.target.value)}>{DECO_TYPES.map(t=><option key={t} value={t}>{DECO_LABELS[t]}</option>)}</select>
            <select className="form-select" style={{width:120,fontSize:11}} value={deco.position} onChange={e=>updateDeco(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}</select>
            {deco.type==='screen_print'&&<><label style={{fontSize:10}}>Colors:</label><input type="number" min="1" max="5" value={deco.colors||1} onChange={e=>updateDeco(idx,di,'colors',parseInt(e.target.value)||1)} style={{width:36,textAlign:'center',fontSize:11,border:'1px solid #e2e8f0',borderRadius:3}}/>
              <label style={{fontSize:10,display:'flex',alignItems:'center',gap:2}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>updateDeco(idx,di,'underbase',e.target.checked)}/>UB</label></>}
            {deco.type==='embroidery'&&<><label style={{fontSize:10}}>Stitches:</label><select className="form-select" style={{width:80,fontSize:11}} value={deco.stitches||8000} onChange={e=>updateDeco(idx,di,'stitches',parseInt(e.target.value))}><option value={8000}>0-10k</option><option value={12000}>10-15k</option><option value={18000}>15-20k</option><option value={25000}>20k+</option></select></>}
            {deco.type==='number_press'&&<label style={{fontSize:10,display:'flex',alignItems:'center',gap:2}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>updateDeco(idx,di,'two_color',e.target.checked)}/>2-Color</label>}
            {deco.type==='dtf_heat_transfer'&&<select className="form-select" style={{width:160,fontSize:11}} value={deco.dtf_size||0} onChange={e=>updateDeco(idx,di,'dtf_size',parseInt(e.target.value))}><option value={0}>4" Sq and Under</option><option value={1}>Front Chest (12"x4")</option></select>}
            <div style={{fontSize:11,marginLeft:'auto'}}>Cost: <strong>${dp.cost.toFixed(2)}</strong> | Sell: <input type="number" step="0.25" value={deco.sell_each||dp.sell} onChange={e=>updateDeco(idx,di,'sell_each',parseFloat(e.target.value)||0)}
              style={{width:55,border:'1px solid #e2e8f0',borderRadius:3,padding:'1px 3px',fontSize:11,fontWeight:700,color:'#166534'}}/></div>
            <button onClick={()=>removeDeco(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}}><Icon name="x" size={12}/></button>
          </div>)})}
          <button className="btn btn-sm btn-secondary" onClick={()=>addDecoration(idx)} style={{marginTop:4}}><Icon name="plus" size={10}/> Add Decoration</button>
        </div>
      </div>)})}

    {/* ADD PRODUCT */}
    <div className="card" style={{marginBottom:16}}><div style={{padding:'12px 16px'}}>
      {!showAddProduct?<button className="btn btn-primary" onClick={()=>setShowAddProduct(true)}><Icon name="plus" size={14}/> Add Product</button>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search products by SKU, name, or brand..." value={productSearch} onChange={e=>setProductSearch(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:200,overflow:'auto'}}>{filteredProds.slice(0,10).map(p=><div key={p.id} style={{padding:'8px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:8}} onClick={()=>addProduct(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span><span style={{fontSize:13}}>{p.name}</span><span className="badge badge-blue">{p.brand}</span>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>Cost: ${p.nsa_cost?.toFixed(2)} | Retail: ${p.retail_price?.toFixed(2)}</span>
        </div>)}</div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAddProduct(false);setProductSearch('')}} style={{marginTop:8}}>Cancel</button>
      </div>}
    </div></div>
  </div>);
}

// ---- CUSTOMER MODAL (same as v2.3) ----
function CustomerModal({isOpen,onClose,onSave,customer,parents}){
  const blank={parent_id:null,name:'',alpha_tag:'',contacts:[{name:'',email:'',phone:'',role:'Head Coach'}],shipping_city:'',shipping_state:'',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30'};
  const[form,setForm]=useState(customer||blank);const[custType,setCustType]=useState(customer?.parent_id?'sub':'parent');const[errors,setErrors]=useState({});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  React.useEffect(()=>{setForm(customer||blank);setCustType(customer?.parent_id?'sub':'parent');setErrors({})},[customer,isOpen]); // eslint-disable-line
  const addContact=()=>set('contacts',[...(form.contacts||[]),{name:'',email:'',phone:'',role:'Head Coach'}]);
  const removeContact=i=>set('contacts',(form.contacts||[]).filter((_,idx)=>idx!==i));
  const updateContact=(i,k,v)=>set('contacts',(form.contacts||[]).map((c,idx)=>idx===i?{...c,[k]:v}:c));
  const validate=()=>{const e={};if(!form.name)e.name=1;if(!form.alpha_tag)e.alpha_tag=1;if(!form.shipping_city)e.shipping_city=1;if(!form.shipping_state)e.shipping_state=1;
    if(custType==='sub'&&!form.parent_id)e.parent_id=1;const ct=form.contacts||[];if(!ct[0]?.name)e.cn=1;if(!ct[0]?.email)e.ce=1;setErrors(e);return !Object.keys(e).length};
  if(!isOpen)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700}}>
  <div className="modal-header"><h2>{customer?.id?'Edit':'New'} Customer</h2><button className="modal-close" onClick={onClose}>x</button></div>
  <div className="modal-body">
    <div style={{display:'flex',gap:8,marginBottom:16}}>{['parent','sub'].map(t=><button key={t} className={`btn btn-sm ${custType===t?'btn-primary':'btn-secondary'}`} onClick={()=>{setCustType(t);if(t==='parent')set('parent_id',null)}}>{t==='parent'?'Parent':'Sub-Customer'}</button>)}</div>
    {custType==='sub'&&<div className="form-group" style={{marginBottom:12}}><label className="form-label">Parent *</label><SearchSelect options={parents.map(p=>({value:p.id,label:`${p.name} (${p.alpha_tag})`}))} value={form.parent_id} onChange={v=>set('parent_id',v)} placeholder="Search parent..."/></div>}
    <div className="form-row form-row-3"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e=>set('name',e.target.value)} style={errors.name?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Alpha Tag *</label><input className="form-input" value={form.alpha_tag||''} onChange={e=>set('alpha_tag',e.target.value)} style={errors.alpha_tag?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Terms</label><select className="form-select" value={form.payment_terms||'net30'} onChange={e=>set('payment_terms',e.target.value)}><option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:8,marginBottom:6,textTransform:'uppercase'}}>Contacts *</div>
    {(form.contacts||[]).map((c,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 100px auto',gap:6,marginBottom:6}}>
      <input className="form-input" placeholder="Name *" value={c.name} onChange={e=>updateContact(i,'name',e.target.value)} style={i===0&&errors.cn&&!c.name?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Email *" value={c.email} onChange={e=>updateContact(i,'email',e.target.value)} style={i===0&&errors.ce&&!c.email?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Phone" value={c.phone} onChange={e=>updateContact(i,'phone',e.target.value)}/>
      <select className="form-select" value={c.role} onChange={e=>updateContact(i,'role',e.target.value)} style={{fontSize:11}}>{CONTACT_ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select>
      {i>0?<button className="btn btn-sm btn-secondary" onClick={()=>removeContact(i)}><Icon name="trash" size={12}/></button>:<div/>}
    </div>)}
    <button className="btn btn-sm btn-secondary" onClick={addContact}><Icon name="plus" size={12}/> Add Contact</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Shipping *</div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:8}}>
      <input className="form-input" placeholder="Street" value={form.shipping_address_line1||''} onChange={e=>set('shipping_address_line1',e.target.value)}/>
      <input className="form-input" placeholder="City *" value={form.shipping_city||''} onChange={e=>set('shipping_city',e.target.value)} style={errors.shipping_city?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="ST *" value={form.shipping_state||''} onChange={e=>set('shipping_state',e.target.value)} style={errors.shipping_state?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="ZIP" value={form.shipping_zip||''} onChange={e=>set('shipping_zip',e.target.value)}/>
    </div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Pricing</div>
    <div className="form-row form-row-2">
      <div className="form-group"><label className="form-label">Adidas/UA Tier</label><select className="form-select" value={form.adidas_ua_tier||'B'} onChange={e=>set('adidas_ua_tier',e.target.value)}><option value="A">A - 40% off</option><option value="B">B - 35% off</option><option value="C">C - 30% off</option></select></div>
      <div className="form-group"><label className="form-label">Catalog Markup</label><input className="form-input" type="number" step="0.05" value={form.catalog_markup||1.65} onChange={e=>set('catalog_markup',parseFloat(e.target.value)||1.65)}/></div>
    </div>
  </div>
  <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{if(!validate())return;onSave({...form,id:form.id||'c'+Date.now(),parent_id:custType==='sub'?form.parent_id:null,is_active:true,_open_estimates:form._open_estimates||0,_open_sos:form._open_sos||0,_open_invoices:form._open_invoices||0,_open_balance:form._open_balance||0});onClose()}}>Save</button></div>
  </div></div>);
}

// ---- MAIN APP ----
export default function App(){
  const[page,setPage]=useState('dashboard');const[toast,setToast]=useState(null);
  const[customers,setCustomers]=useState(DEMO_CUSTOMERS);const[vendors]=useState(DEMO_VENDORS);
  const[products,setProducts]=useState(DEMO_PRODUCTS);
  const[estimates,setEstimates]=useState(DEMO_ESTIMATES);const[salesOrders]=useState(DEMO_SALES_ORDERS);const[invoices]=useState(DEMO_INVOICES);
  const[custModal,setCustModal]=useState({open:false,customer:null});
  const[search,setSearch]=useState('');const[selectedCustomer,setSelectedCustomer]=useState(null);
  const[selectedVendor,setSelectedVendor]=useState(null);const[repFilter,setRepFilter]=useState('all');
  const[editEstimate,setEditEstimate]=useState(null);const[editEstCustomer,setEditEstCustomer]=useState(null);
  const[productFilter,setProductFilter]=useState({category:'all',vendor:'all',stock:'all',color:'all'});
  const[invSort,setInvSort]=useState({field:'value',dir:'desc'});
  const[invFilter,setInvFilter]=useState({category:'all',vendor:'all',color:'all'});
  const currentUser=REPS[0];const isAdmin=currentUser.role==='admin';

  const notify=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500)};
  const parentCustomers=useMemo(()=>customers.filter(c=>!c.parent_id),[customers]);
  const getChildren=useCallback(pid=>customers.filter(c=>c.parent_id===pid),[customers]);
  const colors=useMemo(()=>[...new Set(products.map(p=>p.color).filter(Boolean))].sort(),[products]);
  const saveCustomer=c=>{setCustomers(prev=>{const e=prev.find(x=>x.id===c.id);return e?prev.map(x=>x.id===c.id?c:x):[...prev,c]});notify('Customer saved')};
  const saveEstimate=est=>{setEstimates(prev=>{const e=prev.find(x=>x.id===est.id);return e?prev.map(x=>x.id===est.id?est:x):[...prev,est]});notify('Estimate saved');setEditEstimate(null)};

  const allOrders=useMemo(()=>[
    ...estimates.map(e=>({id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0]||'',total:e.items?.reduce((a,it)=>{const q=Object.values(it.sizes||{}).reduce((s,v)=>s+v,0);return a+q*it.unit_sell},0)||0,memo:e.memo,status:e.status})),
    ...salesOrders.map(s=>({id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0]||'',total:s.items?.reduce((a,it)=>{const q=Object.values(it.sizes||{}).reduce((ss,v)=>ss+v,0);return a+q*it.unit_sell},0)||0,memo:s.memo,status:s.status})),
    ...invoices.map(i=>({...i,type:'invoice'}))
  ],[estimates,salesOrders,invoices]);

  const filteredProducts=useMemo(()=>{let l=products;if(search&&page==='products'){const q=search.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)||p.color?.toLowerCase().includes(q))}
    if(productFilter.category!=='all')l=l.filter(p=>p.category===productFilter.category);if(productFilter.vendor!=='all')l=l.filter(p=>p.vendor_id===productFilter.vendor);
    if(productFilter.stock==='instock')l=l.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(productFilter.color!=='all')l=l.filter(p=>p.color===productFilter.color);return l},[products,search,productFilter,page]);

  const inventoryData=useMemo(()=>{let l=products.filter(p=>Object.values(p._inv||{}).some(v=>v>0));
    if(invFilter.category!=='all')l=l.filter(p=>p.category===invFilter.category);if(invFilter.vendor!=='all')l=l.filter(p=>p.vendor_id===invFilter.vendor);if(invFilter.color!=='all')l=l.filter(p=>p.color===invFilter.color);
    if(search&&page==='inventory'){const q=search.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q))}
    const m=l.map(p=>{const t=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);return{...p,_totalQty:t,_totalValue:t*(p.nsa_cost||0)}});
    m.sort((a,b)=>{const f=invSort.field;let va,vb;if(f==='sku'){va=a.sku;vb=b.sku}else if(f==='name'){va=a.name;vb=b.name}else if(f==='qty'){va=a._totalQty;vb=b._totalQty}else if(f==='value'){va=a._totalValue;vb=b._totalValue}else{va=a.sku;vb=b.sku}
    if(typeof va==='string')return invSort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return invSort.dir==='asc'?va-vb:vb-va});return m},[products,invSort,invFilter,search,page]);

  const totalInvValue=useMemo(()=>inventoryData.reduce((a,p)=>a+p._totalValue,0),[inventoryData]);
  const totalInvUnits=useMemo(()=>inventoryData.reduce((a,p)=>a+p._totalQty,0),[inventoryData]);
  const stockAlerts=useMemo(()=>{const al=[];products.forEach(p=>{if(!p._alerts)return;Object.entries(p._alerts).forEach(([sz,min])=>{const cur=p._inv?.[sz]||0;if(cur<min)al.push({product:p,size:sz,current:cur,minimum:min,needed:min-cur})})});return al},[products]);

  // ---- ESTIMATES PAGE ----
  const renderEstimates=()=>{
    if(editEstimate)return<EstimateBuilder estimate={editEstimate} customer={editEstCustomer} products={products} vendors={vendors} onSave={saveEstimate} onBack={()=>setEditEstimate(null)} currentUser={currentUser}/>;
    return(<>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search estimates..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <button className="btn btn-primary" onClick={()=>{setEditEstimate({id:'EST-'+(2100+estimates.length),customer_id:null,memo:'',status:'draft',created_by:currentUser.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:1.65,items:[]});setEditEstCustomer(null)}}><Icon name="plus" size={14}/> New Estimate</button>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Estimates</div><div className="stat-value">{estimates.length}</div></div>
        <div className="stat-card"><div className="stat-label">Draft</div><div className="stat-value">{estimates.filter(e=>e.status==='draft').length}</div></div>
        <div className="stat-card"><div className="stat-label">Sent</div><div className="stat-value" style={{color:'#d97706'}}>{estimates.filter(e=>e.status==='sent').length}</div></div>
        <div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value" style={{color:'#166534'}}>{estimates.filter(e=>e.status==='approved').length}</div></div>
      </div>
      <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Items</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {estimates.filter(e=>!search||e.id.toLowerCase().includes(search.toLowerCase())||e.memo?.toLowerCase().includes(search.toLowerCase())).map(est=>{
        const cust=customers.find(c=>c.id===est.customer_id);
        return(<tr key={est.id}>
          <td style={{fontWeight:700,color:'#1e40af'}}>{est.id}</td>
          <td>{cust?<span>{cust.name} <span className="badge badge-gray">{cust.alpha_tag}</span></span>:'--'}</td>
          <td style={{fontSize:12,maxWidth:200}}>{est.memo}</td>
          <td>{est.items?.length||0} items</td>
          <td><span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':est.status==='approved'?'badge-green':'badge-red'}`}>{est.status}</span></td>
          <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===est.created_by)?.name}<br/>{est.created_at}</td>
          <td><button className="btn btn-sm btn-primary" onClick={()=>{setEditEstimate(est);setEditEstCustomer(cust)}}>Edit</button>
            {est.status==='approved'&&<button className="btn btn-sm btn-secondary" style={{marginLeft:4}} onClick={()=>notify('Converted to SO (Phase 2)')}>→ SO</button>}</td>
        </tr>)})}
      </tbody></table></div></div>
    </>);
  };

  // ---- SALES ORDERS PAGE ----
  const renderSalesOrders=()=>(<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">Total SOs</div><div className="stat-value">{salesOrders.length}</div></div>
      <div className="stat-card"><div className="stat-label">Waiting Art</div><div className="stat-value" style={{color:'#d97706'}}>{salesOrders.filter(s=>s.status==='waiting_art').length}</div></div>
      <div className="stat-card"><div className="stat-label">In Production</div><div className="stat-value" style={{color:'#2563eb'}}>{salesOrders.filter(s=>s.status==='in_production').length}</div></div>
      <div className="stat-card"><div className="stat-label">Ready to Ship</div><div className="stat-value" style={{color:'#166534'}}>{salesOrders.filter(s=>s.status==='ready_ship').length}</div></div>
    </div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Firm Dates</th><th>Status</th><th>Created</th></tr></thead><tbody>
    {salesOrders.map(so=>{const cust=customers.find(c=>c.id===so.customer_id);
      return(<tr key={so.id}>
        <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td>
        <td>{cust?.name} <span className="badge badge-gray">{cust?.alpha_tag}</span></td>
        <td style={{fontSize:12}}>{so.memo}</td>
        <td style={{fontSize:12}}>{so.expected_date||'--'}</td>
        <td>{so.firm_dates?.length?so.firm_dates.map((fd,i)=><div key={i} style={{fontSize:11}}><span className={`badge ${fd.approved?'badge-green':'badge-amber'}`}>{fd.date}</span> {fd.item_desc}</div>):'--'}</td>
        <td><span className={`badge ${so.status==='waiting_art'?'badge-amber':so.status==='in_production'?'badge-blue':so.status==='ready_ship'?'badge-green':'badge-gray'}`}>{so.status.replace(/_/g,' ')}</span></td>
        <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===so.created_by)?.name}<br/>{so.created_at}</td>
      </tr>)})}</tbody></table></div></div>
  </>);

  // ---- DASHBOARD (from v2.3 + estimates) ----
  const renderDashboard=()=>(<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{estimates.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div>
      <div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{salesOrders.filter(s=>s.status!=='completed'&&s.status!=='shipped').length}</div></div>
      <div className="stat-card"><div className="stat-label">Inventory Value</div><div className="stat-value">${totalInvValue.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div className="stat-sub">{totalInvUnits} units</div></div>
      {isAdmin&&<div className="stat-card" style={stockAlerts.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:stockAlerts.length>0?'#d97706':''}}>{stockAlerts.length}</div></div>}
    </div>
    {isAdmin&&stockAlerts.length>0&&<div className="card" style={{marginBottom:16,borderLeft:'4px solid #d97706'}}><div className="card-header"><h2 style={{color:'#d97706'}}><Icon name="alert" size={16}/> Stock Alerts</h2><button className="btn btn-sm btn-primary" onClick={()=>notify('Draft restock PO generated!')}>Auto-Restock PO</button></div>
      <div className="card-body" style={{padding:0}}><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Current</th><th>Min</th><th>Need</th></tr></thead><tbody>
      {stockAlerts.slice(0,6).map((a,i)=><tr key={i}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{a.product.sku}</td><td style={{fontSize:12}}>{a.product.name}</td><td><span className="badge badge-amber">{a.size}</span></td><td style={{fontWeight:700,color:'#dc2626'}}>{a.current}</td><td>{a.minimum}</td><td style={{fontWeight:700}}>{a.needed}</td></tr>)}
      </tbody></table></div></div>}
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>{setPage('estimates');setEditEstimate({id:'EST-'+(2100+estimates.length),customer_id:null,memo:'',status:'draft',created_by:currentUser.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:1.65,items:[]});setEditEstCustomer(null)}}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-primary" onClick={()=>{setPage('customers');setCustModal({open:true,customer:null})}}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>setPage('estimates')}><Icon name="dollar" size={14}/> View Estimates</button>
      <button className="btn btn-secondary" onClick={()=>setPage('orders')}><Icon name="box" size={14}/> View Sales Orders</button>
    </div></div>
    <div className="card"><div className="card-header"><h2>Recent Estimates</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Status</th><th>Date</th></tr></thead><tbody>
    {estimates.slice(0,5).map(est=>{const c=customers.find(x=>x.id===est.customer_id);return(<tr key={est.id} style={{cursor:'pointer'}} onClick={()=>{setPage('estimates');setEditEstimate(est);setEditEstCustomer(c)}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{est.id}</td><td>{c?.name||'--'} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{est.memo}</td>
      <td><span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':'badge-green'}`}>{est.status}</span></td><td style={{fontSize:11,color:'#94a3b8'}}>{est.created_at}</td></tr>)})}
    </tbody></table></div></div>
  </>);

  // ---- CUSTOMERS PAGE (compact from v2.3) ----
  const renderCustomers=()=>{
    if(selectedCustomer){const custOrders=allOrders.filter(o=>[selectedCustomer.id,...customers.filter(c=>c.parent_id===selectedCustomer.id).map(c=>c.id)].includes(o.customer_id));
      return(<div><button className="btn btn-secondary" onClick={()=>setSelectedCustomer(null)} style={{marginBottom:12}}><Icon name="back" size={14}/> All Customers</button>
        <div className="card" style={{marginBottom:16,padding:'16px 20px'}}>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{selectedCustomer.name}</span><span className="badge badge-blue">{selectedCustomer.alpha_tag}</span><span className="badge badge-green">Tier {selectedCustomer.adidas_ua_tier}</span><span className="badge badge-gray">{selectedCustomer.catalog_markup||1.65}x</span></div>
          <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(selectedCustomer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email} {i<selectedCustomer.contacts.length-1&&'| '}</span>)}</div>
          <div style={{display:'flex',gap:8,marginTop:8}}><button className="btn btn-sm btn-primary" onClick={()=>{setPage('estimates');const est={id:'EST-'+(2100+estimates.length),customer_id:selectedCustomer.id,memo:'',status:'draft',created_by:currentUser.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:selectedCustomer.catalog_markup||1.65,items:[]};setEditEstimate(est);setEditEstCustomer(selectedCustomer)}}><Icon name="file" size={12}/> Create Estimate</button>
            <button className="btn btn-sm btn-secondary" onClick={()=>setCustModal({open:true,customer:selectedCustomer})}><Icon name="edit" size={12}/> Edit</button></div>
        </div>
        {!selectedCustomer.parent_id&&customers.filter(c=>c.parent_id===selectedCustomer.id).length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Sub-Customers</h2></div><div className="card-body" style={{padding:0}}>
          {customers.filter(c=>c.parent_id===selectedCustomer.id).map(s=><div key={s.id} style={{padding:'10px 16px',borderBottom:'1px solid #f1f5f9',cursor:'pointer',display:'flex',alignItems:'center',gap:8}} onClick={()=>setSelectedCustomer(s)}>
            <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{s.name}</span><span className="badge badge-gray">{s.alpha_tag}</span><div style={{flex:1}}/>{(s._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${s._open_balance.toLocaleString()}</span>}</div>)}</div></div>}
        <div className="card"><div className="card-header"><h2>Orders & Invoices</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Type</th><th>Memo</th><th>Total</th><th>Status</th></tr></thead><tbody>
          {custOrders.length?custOrders.map(o=><tr key={o.id}><td style={{fontWeight:700,color:'#1e40af'}}>{o.id}</td><td><span className={`badge ${o.type==='estimate'?'badge-amber':o.type==='sales_order'?'badge-blue':'badge-red'}`}>{o.type==='sales_order'?'SO':o.type==='estimate'?'Est':'Inv'}</span></td><td style={{fontSize:12}}>{o.memo}</td><td style={{fontWeight:700}}>${o.total?.toLocaleString()}</td><td><span className={`badge ${o.status==='draft'?'badge-gray':o.status==='open'||o.status==='sent'?'badge-amber':o.status==='approved'||o.status==='paid'?'badge-green':'badge-blue'}`}>{o.status?.replace(/_/g,' ')}</span></td></tr>)
          :<tr><td colSpan={5} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>}</tbody></table></div></div>
      </div>)}
    const filtered=parentCustomers.filter(p=>{if(repFilter!=='all'&&p.primary_rep_id!==repFilter)return false;if(search){const q=search.toLowerCase();return p.name.toLowerCase().includes(q)||p.alpha_tag?.toLowerCase().includes(q)||getChildren(p.id).some(c=>c.name.toLowerCase().includes(q))}return true});
    return(<>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <select className="form-select" style={{width:160}} value={repFilter} onChange={e=>setRepFilter(e.target.value)}><option value="all">All Reps</option>{REPS.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <button className="btn btn-primary" onClick={()=>setCustModal({open:true,customer:null})}><Icon name="plus" size={14}/> New Customer</button>
      </div>
      {filtered.map(p=>{const kids=getChildren(p.id);const bal=kids.reduce((a,c)=>a+(c._open_balance||0),p._open_balance||0);
        return(<div key={p.id} className="card" style={{marginBottom:8}}>
          <div style={{padding:'10px 16px',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setSelectedCustomer(p)}>
            <div style={{width:32,height:32,borderRadius:6,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="building" size={16}/></div>
            <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><span style={{fontWeight:700}}>{p.name}</span><span className="badge badge-blue">{p.alpha_tag}</span><span className="badge badge-green">Tier {p.adidas_ua_tier}</span></div>
              <div style={{fontSize:11,color:'#94a3b8'}}>{(p.contacts||[])[0]?.name} · {p.billing_city}, {p.billing_state} · Rep: {REPS.find(r=>r.id===p.primary_rep_id)?.name}</div></div>
            {bal>0&&<span style={{fontSize:14,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</span>}
          </div>
          {kids.length>0&&<div style={{borderTop:'1px solid #f1f5f9'}}>{kids.map(c=><div key={c.id} style={{padding:'6px 16px 6px 58px',fontSize:13,cursor:'pointer',display:'flex',gap:8,alignItems:'center'}} onClick={()=>setSelectedCustomer(c)}>
            <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600}}>{c.name}</span><span className="badge badge-gray">{c.alpha_tag}</span><div style={{flex:1}}/>{(c._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${c._open_balance.toLocaleString()}</span>}</div>)}</div>}
        </div>)})}
    </>);
  };

  // ---- VENDORS, PRODUCTS, INVENTORY (compact from v2.3) ----
  const renderVendors=()=>{if(selectedVendor)return(<div><button className="btn btn-secondary" onClick={()=>setSelectedVendor(null)} style={{marginBottom:12}}><Icon name="back" size={14}/> All Vendors</button>
    <div className="card" style={{padding:'16px 20px',marginBottom:16}}><div style={{fontSize:20,fontWeight:800}}>{selectedVendor.name}</div><div style={{fontSize:13,color:'#64748b'}}>{selectedVendor.contact_email} | {selectedVendor.contact_phone} {selectedVendor.rep_name&&`| Rep: ${selectedVendor.rep_name}`}</div></div>
    <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Invoices</div><div className="stat-value">{selectedVendor._open_invoices||0}</div></div><div className="stat-card"><div className="stat-label">Current</div><div className="stat-value" style={{color:'#166534'}}>${(selectedVendor._aging_current||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">30d</div><div className="stat-value" style={{color:'#d97706'}}>${(selectedVendor._aging_30||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">60d+</div><div className="stat-value" style={{color:'#dc2626'}}>${((selectedVendor._aging_60||0)+(selectedVendor._aging_90||0)).toLocaleString()}</div></div></div></div>);
    return(<div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>Terms</th>{isAdmin&&<th>Owed</th>}<th>Status</th></tr></thead><tbody>
      {vendors.map(v=><tr key={v.id} style={{cursor:'pointer'}} onClick={()=>setSelectedVendor(v)}><td style={{fontWeight:700,color:'#1e40af'}}>{v.name}</td><td><span className={`badge ${v.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{v.vendor_type==='api'?'API':'Upload'}</span></td>
        <td style={{fontSize:11}}>{v.contact_email}</td><td><span className="badge badge-gray">{v.payment_terms?.replace('net','Net ')}</span></td>
        {isAdmin&&<td style={{fontWeight:700,color:(v._invoice_total||0)>0?'#dc2626':''}}>{(v._invoice_total||0)>0?'$'+v._invoice_total.toLocaleString():'--'}</td>}<td><span className="badge badge-green">Active</span></td></tr>)}
    </tbody></table></div></div>);
  };

  const renderProducts=()=>(<>
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
      <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={productFilter.stock==='instock'} onChange={e=>setProductFilter(f=>({...f,stock:e.target.checked?'instock':'all'}))}/> In Stock</label>
      <select className="form-select" style={{width:110}} value={productFilter.category} onChange={e=>setProductFilter(f=>({...f,category:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
      <select className="form-select" style={{width:110}} value={productFilter.vendor} onChange={e=>setProductFilter(f=>({...f,vendor:e.target.value}))}><option value="all">Vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <select className="form-select" style={{width:130}} value={productFilter.color} onChange={e=>setProductFilter(f=>({...f,color:e.target.value}))}><option value="all">Color</option>{colors.map(c=><option key={c} value={c}>{c}</option>)}</select>
    </div>
    <div className="card"><div className="card-body" style={{padding:0}}>{filteredProducts.map(p=>{const nsaT=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);const au=p.brand==='Adidas'||p.brand==='Under Armour';
      const coreSizes=['S','M','L','XL','2XL'];const showSizes=p.available_sizes.filter(s=>{if(coreSizes.includes(s))return true;return!['XS','3XL','4XL'].includes(s)||(p._inv?.[s]||0)>0});
      return(<div key={p.id} style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',gap:12}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:700}}>{p.name}</span><span className="badge badge-gray">{p.category}</span></div>
          <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}><span className="badge badge-blue">{p.brand}</span> {p.color} | Cost: ${p.nsa_cost?.toFixed(2)} | Sell: {au?'Tier':'$'+roundQ(p.nsa_cost*1.65).toFixed(2)}</div>
          <div style={{display:'flex',gap:2,marginTop:6}}>{showSizes.map(s=>{const q=p._inv?.[s]||0;return<div key={s} className={`size-cell ${q>10?'in-stock':q>0?'low-stock':'no-stock'}`}><div className="size-label">{s}</div><div className="size-qty">{q}</div></div>})}
            <div className="size-cell total"><div className="size-label">TOT</div><div className="size-qty">{nsaT}</div></div></div>
        </div>
      </div>)})}{filteredProducts.length===0&&<div className="empty">No products</div>}</div></div>
  </>);

  const renderInventory=()=>(<>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-label">Units</div><div className="stat-value">{totalInvUnits}</div></div>
      <div className="stat-card"><div className="stat-label">Value</div><div className="stat-value">${totalInvValue.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
      <div className="stat-card"><div className="stat-label">Products</div><div className="stat-value">{inventoryData.length}</div></div>
      {isAdmin&&<div className="stat-card" style={stockAlerts.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Alerts</div><div className="stat-value" style={{color:stockAlerts.length>0?'#d97706':''}}>{stockAlerts.length}</div></div>}
    </div>
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <select className="form-select" style={{width:110}} value={invFilter.category} onChange={e=>setInvFilter(f=>({...f,category:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
      <select className="form-select" style={{width:110}} value={invFilter.vendor} onChange={e=>setInvFilter(f=>({...f,vendor:e.target.value}))}><option value="all">Vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
    </div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr>
      <SortHeader label="SKU" field="sku" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
      <SortHeader label="Product" field="name" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
      <th>Sizes</th>
      <SortHeader label="Qty" field="qty" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
      <SortHeader label="Value" field="value" sortField={invSort.field} sortDir={invSort.dir} onSort={f=>setInvSort(s=>({field:f,dir:s.field===f&&s.dir==='asc'?'desc':'asc'}))}/>
      <th>Actions</th></tr></thead>
    <tbody>{inventoryData.map(p=>{const coreSizes=['S','M','L','XL','2XL'];const showSizes=p.available_sizes.filter(s=>{if(coreSizes.includes(s))return true;return!['XS','3XL','4XL'].includes(s)||(p._inv?.[s]||0)>0});
      return<tr key={p.id}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</td><td style={{fontSize:12}}>{p.name}<br/><span style={{color:'#94a3b8'}}>{p.color}</span></td>
      <td><div style={{display:'flex',gap:2}}>{showSizes.map(s=>{const q=p._inv?.[s]||0;return<div key={s} className={`size-cell ${q>10?'in-stock':q>0?'low-stock':'no-stock'}`} style={{minWidth:30,padding:'1px 3px'}}><div className="size-label" style={{fontSize:8}}>{s}</div><div className="size-qty" style={{fontSize:11}}>{q}</div></div>})}</div></td>
      <td style={{fontWeight:800,color:p._totalQty<=10?'#d97706':'#166534'}}>{p._totalQty}</td><td style={{fontWeight:700}}>${p._totalValue.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
      <td><div style={{display:'flex',gap:3}}><button className="btn btn-sm btn-secondary" onClick={()=>notify('PO (Phase 2)')}>+PO</button><button className="btn btn-sm btn-secondary" onClick={()=>{setPage('estimates');const est={id:'EST-'+(2100+estimates.length),customer_id:null,memo:'',status:'draft',created_by:currentUser.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:1.65,items:[]};setEditEstimate(est);setEditEstCustomer(null)}}>+EST</button></div></td></tr>})}</tbody>
    </table></div></div>
  </>);

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
          onClick={()=>{if(!item.disabled){setPage(item.id);setSearch('');setSelectedCustomer(null);setSelectedVendor(null);setEditEstimate(null)}}}><Icon name={item.icon}/>{item.label}</button>})}</nav>
      <div className="sidebar-user"><div style={{fontWeight:600,color:'#e2e8f0'}}>{currentUser.name}</div><div>{currentUser.role}</div></div>
    </div>
    <div className="main">
      <div className="topbar"><h1>{editEstimate?editEstimate.id:selectedCustomer?selectedCustomer.name:selectedVendor?selectedVendor.name:(titles[page]||'Dashboard')}</h1><div style={{fontSize:12,color:'#94a3b8'}}>Phase 2</div></div>
      <div className="content">
        {page==='dashboard'&&renderDashboard()}
        {page==='estimates'&&renderEstimates()}
        {page==='orders'&&renderSalesOrders()}
        {page==='customers'&&renderCustomers()}
        {page==='vendors'&&renderVendors()}
        {page==='products'&&renderProducts()}
        {page==='inventory'&&renderInventory()}
      </div>
    </div>
    <CustomerModal isOpen={custModal.open} onClose={()=>setCustModal({open:false,customer:null})} onSave={saveCustomer} customer={custModal.customer} parents={parentCustomers}/>
  </div>);
}
