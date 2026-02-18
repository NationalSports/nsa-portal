import React, { useState, useMemo, useCallback } from 'react';
import './portal.css';
const Icon=({name,size=18})=>{const p={home:<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,users:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,building:<><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,package:<><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,box:<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>,search:<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,plus:<path d="M12 5v14M5 12h14"/>,edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,upload:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,back:<polyline points="15 18 9 12 15 6"/>,mail:<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,sortUp:<path d="M7 14l5-5 5 5"/>,sortDown:<path d="M7 10l5 5 5-5"/>,sort:<><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>,image:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,dollar:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,grid:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,warehouse:<><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,check:<polyline points="20 6 9 17 4 12"/>,send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,};return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>};
const REPS=[{id:'r1',name:'Steve Peterson',role:'admin'},{id:'r2',name:'Laura Chen',role:'rep'},{id:'r3',name:'Mike Torres',role:'rep'}];
const CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
const CONTACT_ROLES=['Head Coach','Assistant','Accounting','Athletic Director','Primary','Other'];
const POSITIONS=['Front Center','Back Center','Left Chest','Right Chest','Left Sleeve','Right Sleeve','Left Leg','Right Leg','Nape','Other'];
const roundQ=v=>Math.round(v*4)/4;
const showSz=(s,inv)=>{const c=['S','M','L','XL','2XL'];if(c.includes(s))return true;return!['XS','3XL','4XL'].includes(s)||(inv||0)>0};
const SP={breaks:[{min:1,max:11},{min:12,max:23},{min:24,max:35},{min:36,max:47},{min:48,max:71},{min:72,max:107},{min:108,max:143},{min:144,max:215},{min:216,max:499},{min:500,max:99999}],prices:{0:[50,60,70,null,null],1:[5,6.5,8,9,null],2:[3.5,4.5,6,7,8],3:[3.2,4.25,4.75,6,7.5],4:[2.95,3.85,4.25,5,6],5:[2.75,3.5,3.95,4.5,5.25],6:[2.5,3.2,3.7,4,4.75],7:[2.25,3,3.5,3.75,4.25],8:[2.1,2.85,3.1,3.3,4],9:[1.9,2.75,2.9,3.1,3.75]},mk:1.5,ub:0.15};
const EM={sb:[10000,15000,20000,999999],qb:[6,24,48,99999],prices:[[8,8.5,8,7.5],[9,8.5,8,8],[10,9.5,9,9],[12,12.5,12,10]],mk:1.6};
const NP={breaks:[10,50,99999],cost:[4,3,3],sell:[7,6,5],tc:3};
const DTF=[{label:'4" Sq & Under',cost:2.5,sell:4.5},{label:'Front Chest (12"x4")',cost:4.5,sell:7.5}];
function spP(q,c,s=true){const bi=SP.breaks.findIndex(b=>q>=b.min&&q<=b.max);if(bi<0||c<1||c>5)return 0;const v=SP.prices[bi]?.[c-1];if(v==null)return 0;return s?v:roundQ(v/SP.mk)}
function emP(st,q,s=true){const si=EM.sb.findIndex(b=>st<=b);const qi=EM.qb.findIndex(b=>q<=b);if(si<0||qi<0)return 0;const v=EM.prices[si][qi];return s?v:roundQ(v/EM.mk)}
function npP(q,tw=false,s=true){const bi=NP.breaks.findIndex(b=>q<=b);if(bi<0)return 0;return s?(NP.sell[bi]+(tw?roundQ(NP.tc*1.65):0)):(NP.cost[bi]+(tw?NP.tc:0))}
function dP(d,q){if(d.type==='screen_print'){const u=d.underbase?1+SP.ub:1;return{sell:d.sell_override||roundQ(spP(q,d.colors||1,true)*u),cost:roundQ(spP(q,d.colors||1,false)*u)}}
  if(d.type==='embroidery')return{sell:d.sell_override||emP(d.stitches||8000,q,true),cost:emP(d.stitches||8000,q,false)};
  if(d.type==='number_press')return{sell:d.sell_override||npP(q,d.two_color,true),cost:npP(q,d.two_color,false)};
  if(d.type==='dtf'){const t=DTF[d.dtf_size||0];return{sell:d.sell_override||t.sell,cost:t.cost}}return{sell:0,cost:0}}

// DEMO DATA
const D_C=[
{id:'c1',parent_id:null,name:'Orange Lutheran High School',alpha_tag:'OLu',contacts:[{name:'Athletic Director',email:'athletics@orangelutheran.org',phone:'714-555-0100',role:'Athletic Director'},{name:'Janet Wu',email:'jwu@orangelutheran.org',phone:'714-555-0109',role:'Accounting'}],billing_address_line1:'2222 N Santiago Blvd',billing_city:'Orange',billing_state:'CA',billing_zip:'92867',shipping_address_line1:'2222 N Santiago Blvd',shipping_city:'Orange',shipping_state:'CA',shipping_zip:'92867',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.0775,primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:2,_open_invoices:1,_open_balance:4200},
{id:'c1a',parent_id:'c1',name:'OLu Baseball',alpha_tag:'OLuB',contacts:[{name:'Coach Martinez',email:'martinez@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:1,_open_balance:4200},
{id:'c1b',parent_id:'c1',name:'OLu Football',alpha_tag:'OLuF',contacts:[{name:'Coach Davis',email:'davis@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:1,_open_sos:1,_open_invoices:0,_open_balance:0},
{id:'c1c',parent_id:'c1',name:'OLu Track & Field',alpha_tag:'OLuT',contacts:[{name:'Coach Chen',email:'chen@orangelutheran.org',phone:'',role:'Head Coach'}],shipping_city:'Orange',shipping_state:'CA',adidas_ua_tier:'A',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r1',is_active:true,_open_estimates:0,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c2',parent_id:null,name:'St. Francis High School',alpha_tag:'SF',contacts:[{name:'AD Office',email:'ad@stfrancis.edu',phone:'818-555-0200',role:'Athletic Director'}],billing_city:'La Canada',billing_state:'CA',shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',tax_rate:0.095,primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c2a',parent_id:'c2',name:'St. Francis Lacrosse',alpha_tag:'SFL',contacts:[{name:'Coach Resch',email:'resch@stfrancis.edu',phone:'',role:'Head Coach'}],shipping_city:'La Canada',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'net30',primary_rep_id:'r2',is_active:true,_open_estimates:0,_open_sos:1,_open_invoices:2,_open_balance:6800},
{id:'c3',parent_id:null,name:'Clovis Unified School District',alpha_tag:'CUSD',contacts:[{name:'District Office',email:'purchasing@clovisusd.k12.ca.us',phone:'559-555-0300',role:'Primary'},{name:'AP Dept',email:'ap@clovisusd.k12.ca.us',phone:'559-555-0301',role:'Accounting'}],billing_city:'Clovis',billing_state:'CA',shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',tax_rate:0.0863,primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
{id:'c3a',parent_id:'c3',name:'Clovis High Badminton',alpha_tag:'CHBad',contacts:[{name:'Coach Kim',email:'kim@clovisusd.k12.ca.us',phone:'',role:'Head Coach'}],shipping_city:'Clovis',shipping_state:'CA',adidas_ua_tier:'B',catalog_markup:1.65,payment_terms:'prepay',primary_rep_id:'r3',is_active:true,_open_estimates:2,_open_sos:0,_open_invoices:0,_open_balance:0},
];
const D_V=[
{id:'v1',name:'Adidas',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamorders@adidas.com',contact_phone:'800-448-1796',rep_name:'Sarah Johnson',payment_terms:'net60',notes:'Team dealer program.',_open_invoices:3,_invoice_total:12450,_aging_current:4200,_aging_30:5250,_aging_60:3000,_aging_90:0},
{id:'v2',name:'Under Armour',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamdealer@underarmour.com',contact_phone:'888-727-6687',rep_name:'Mike Daniels',payment_terms:'net60',_open_invoices:2,_invoice_total:8200,_aging_current:5200,_aging_30:3000,_aging_60:0,_aging_90:0},
{id:'v3',name:'SanMar',vendor_type:'api',api_provider:'sanmar',nsa_carries_inventory:false,is_active:true,contact_email:'orders@sanmar.com',contact_phone:'800-426-6399',payment_terms:'net30',notes:'API connected.',_open_invoices:1,_invoice_total:2100,_aging_current:2100,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v4',name:'S&S Activewear',vendor_type:'api',api_provider:'ss_activewear',nsa_carries_inventory:false,is_active:true,contact_email:'service@ssactivewear.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v5',name:'Richardson',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'sales@richardsoncap.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v6',name:'Rawlings',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'teamorders@rawlings.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
{id:'v7',name:'Badger',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,contact_email:'orders@badgersport.com',payment_terms:'net30',_open_invoices:0,_invoice_total:0,_aging_current:0,_aging_30:0,_aging_60:0,_aging_90:0},
];
const D_P=[
{id:'p1',vendor_id:'v1',sku:'JX4453',name:'Adidas Unisex Pregame Tee',brand:'Adidas',color:'Team Power Red/White',category:'Tees',retail_price:55.5,nsa_cost:18.5,available_sizes:['XS','S','M','L','XL','2XL'],is_active:true,_inv:{XS:0,S:12,M:8,L:5,XL:3,'2XL':0},_alerts:{S:10,M:10,L:8,XL:5},_click:{XS:45,S:120,M:89,L:67,XL:34,'2XL':18}},
{id:'p2',vendor_id:'v1',sku:'HF7245',name:'Adidas Team Issue Hoodie',brand:'Adidas',color:'Team Power Red/White',category:'Hoodies',retail_price:85,nsa_cost:28.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:3,M:6,L:4,XL:2,'2XL':0},_alerts:{S:5,M:8,L:8,XL:5}},
{id:'p3',vendor_id:'v1',sku:'JR9291',name:'Adidas Dropset Control Trainer',brand:'Adidas',color:'Grey Two/FTW White',category:'Footwear',retail_price:120,nsa_cost:37.12,available_sizes:['12','13','14','15'],is_active:true,_inv:{'12':10,'13':4,'14':1,'15':1}},
{id:'p4',vendor_id:'v2',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',category:'Polos',retail_price:65,nsa_cost:22,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:10,L:15,XL:12,'2XL':8},_alerts:{M:8,L:8,XL:5}},
{id:'p5',vendor_id:'v3',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',category:'Tees',retail_price:8.98,nsa_cost:2.85,available_sizes:['S','M','L','XL','2XL','3XL'],is_active:true,_inv:{S:20,M:15,L:10,XL:5,'2XL':0,'3XL':0},_colors:['Jet Black','Navy','Red','White','Athletic Heather','Royal','Forest Green','Charcoal','Ash','Sand']},
{id:'p6',vendor_id:'v3',sku:'K500',name:'Port Authority Silk Touch Polo',brand:'Port Authority',color:'Navy',category:'Polos',retail_price:22.98,nsa_cost:8.2,available_sizes:['XS','S','M','L','XL','2XL','3XL','4XL'],is_active:true,_inv:{},_colors:['Navy','Black','White','Red','Royal','Dark Green','Steel Grey','Burgundy']},
{id:'p7',vendor_id:'v5',sku:'112',name:'Richardson Trucker Cap',brand:'Richardson',color:'Black/White',category:'Hats',retail_price:12,nsa_cost:4.5,available_sizes:['OSFA'],is_active:true,_inv:{OSFA:50},_alerts:{OSFA:20},_colors:['Black/White','Navy/White','Red/White','Royal/White','Charcoal/White','Grey/White']},
{id:'p8',vendor_id:'v1',sku:'EK0100',name:'Adidas Team 1/4 Zip',brand:'Adidas',color:'Team Navy/White',category:'1/4 Zips',retail_price:75,nsa_cost:25,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:2,M:7,L:9,XL:5,'2XL':1},_alerts:{S:5,M:8,L:8,XL:5}},
{id:'p9',vendor_id:'v2',sku:'1376844',name:'Under Armour Tech Short',brand:'Under Armour',color:'Black/White',category:'Shorts',retail_price:45,nsa_cost:15.5,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{S:0,M:4,L:6,XL:3,'2XL':0}},
];
const D_E=[
{id:'EST-2089',customer_id:'c1b',memo:'Spring 2026 Football Camp Tees',status:'sent',created_by:'r1',created_at:'02/10/26 9:15 AM',updated_at:'02/10/26 2:30 PM',default_markup:1.65,shipping_type:'pct',shipping_value:8,ship_to:'',email_status:'opened',email_opened_at:'02/10/26 3:45 PM',items:[{product_id:'p5',sku:'PC61',name:'Port & Company Essential Tee',brand:'Port & Company',color:'Jet Black',nsa_cost:2.85,retail_price:8.98,unit_sell:4.75,sizes:{S:8,M:15,L:20,XL:12,'2XL':5},available_sizes:['S','M','L','XL','2XL','3XL'],decorations:[{type:'screen_print',position:'Front Center',colors:2,underbase:false,sell_override:null,art_group:'A'},{type:'screen_print',position:'Back Center',colors:1,underbase:false,sell_override:null,art_group:'B'}]}]},
{id:'EST-2094',customer_id:'c1b',memo:'Football Coaches Polos',status:'approved',created_by:'r1',created_at:'02/16/26 10:00 AM',updated_at:'02/16/26 10:00 AM',default_markup:1.65,shipping_type:'flat',shipping_value:25,ship_to:'',email_status:'viewed',email_opened_at:'02/16/26 11:30 AM',email_viewed_at:'02/16/26 11:32 AM',items:[{product_id:'p4',sku:'1370399',name:'Under Armour Team Polo',brand:'Under Armour',color:'Cardinal/White',nsa_cost:22,retail_price:65,unit_sell:39,sizes:{M:2,L:3,XL:2,'2XL':1},available_sizes:['S','M','L','XL','2XL'],decorations:[{type:'embroidery',position:'Left Chest',stitches:8000,sell_override:null,art_group:'A'}]}]},
{id:'EST-2101',customer_id:'c3a',memo:'Badminton Team Uniforms',status:'draft',created_by:'r3',created_at:'02/12/26 3:00 PM',updated_at:'02/12/26 3:00 PM',default_markup:1.65,shipping_type:'pct',shipping_value:0,ship_to:'',email_status:null,items:[]},
];
const D_SO=[
{id:'SO-1042',customer_id:'c1a',estimate_id:'EST-2088',memo:'Baseball Spring Season Full Package',status:'in_production',created_by:'r1',created_at:'02/10/26 11:00 AM',updated_at:'02/14/26',expected_date:'03/15/26',firm_dates:[{item_desc:'Game Jerseys',date:'03/01/26',approved:true}],items:[{sku:'JX4453',name:'Adidas Unisex Pregame Tee',nsa_cost:18.5,unit_sell:33.3,sizes:{S:5,M:12,L:15,XL:8,'2XL':3},decorations:[{type:'screen_print',position:'Front Center',colors:3,underbase:true},{type:'number_press',position:'Back Center',two_color:false}]}]},
{id:'SO-1045',customer_id:'c1b',memo:'Football Spring Practice Gear',status:'waiting_art',created_by:'r1',created_at:'02/12/26 2:00 PM',updated_at:'02/12/26',expected_date:'03/20/26',firm_dates:[],items:[]},
{id:'SO-1051',customer_id:'c2a',memo:'Lacrosse Team Store - Jan 2026',status:'in_production',created_by:'r2',created_at:'02/14/26 10:30 AM',updated_at:'02/15/26',expected_date:'03/10/26',firm_dates:[],items:[]},
];
const D_INV=[{id:'INV-1042',type:'invoice',customer_id:'c1a',date:'02/10/26',total:4200,paid:0,memo:'Baseball Season Deposit',status:'open'},{id:'INV-1038',type:'invoice',customer_id:'c2a',date:'01/28/26',total:3400,paid:0,memo:'Lacrosse Preseason',status:'open'},{id:'INV-1039',type:'invoice',customer_id:'c2a',date:'02/01/26',total:3400,paid:3400,memo:'Lacrosse Batch 1',status:'paid'}];

// SHARED
function Toast({message,type='success'}){if(!message)return null;return<div className={`toast toast-${type}`}>{message}</div>}
function SortHeader({label,field,sortField,sortDir,onSort}){const a=sortField===field;return<th onClick={()=>onSort(field)} style={{cursor:'pointer',userSelect:'none'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}>{label}<span style={{opacity:a?1:0.3}}>{a&&sortDir==='asc'?<Icon name="sortUp" size={12}/>:<Icon name="sort" size={12}/>}</span></span></th>}
function SearchSelect({options,value,onChange,placeholder}){const[open,setOpen]=useState(false);const[q,setQ]=useState('');const f=options.filter(o=>o.label.toLowerCase().includes(q.toLowerCase()));const sel=options.find(o=>o.value===value);
  return(<div style={{position:'relative'}}><div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center'}} onClick={()=>setOpen(!open)}><span style={{flex:1,color:sel?'#0f172a':'#94a3b8'}}>{sel?sel.label:placeholder}</span><Icon name="search" size={14}/></div>
    {open&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:50,maxHeight:200,overflow:'auto'}}><div style={{padding:6}}><input className="form-input" placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus style={{fontSize:12}}/></div>
      {f.map(o=><div key={o.value} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,background:o.value===value?'#dbeafe':''}} onClick={()=>{onChange(o.value);setOpen(false);setQ('')}}>{o.label}</div>)}{f.length===0&&<div style={{padding:8,fontSize:12,color:'#94a3b8'}}>No results</div>}</div>}</div>)}
function Bg({options,value,onChange}){return<div style={{display:'flex',gap:2}}>{options.map(o=><button key={o.value} className={`btn btn-sm ${String(value)===String(o.value)?'btn-primary':'btn-secondary'}`} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}
function $Input({value,onChange,width=70}){return<span style={{display:'inline-flex',alignItems:'center',gap:0}}><span style={{fontSize:14,fontWeight:700,color:'#166534'}}>$</span><input value={value} onChange={e=>onChange(parseFloat(e.target.value)||0)} style={{width,border:'1px solid #d1d5db',borderRadius:4,padding:'4px 6px',fontSize:15,fontWeight:800,color:'#166534',textAlign:'center'}}/></span>}

// EMAIL STATUS BADGE
function EmailBadge({est}){if(!est.email_status)return null;const s=est.email_status;
  return<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,padding:'2px 8px',borderRadius:10,background:s==='sent'?'#fef3c7':s==='opened'?'#dbeafe':'#dcfce7',color:s==='sent'?'#92400e':s==='opened'?'#1e40af':'#166534'}}>
    {s==='sent'?'✉️':s==='opened'?'👁️':'🔗'} {s==='sent'?'Sent':s==='opened'?`Opened ${est.email_opened_at||''}`:`Viewed ${est.email_viewed_at||''}`}</span>}

// ESTIMATE BUILDER
function EstBuild({estimate,customer:ic,allCustomers,products,onSave,onBack,onConvertSO,currentUser,onNotify}){
  const[est,setEst]=useState(estimate);const[cust,setCust]=useState(ic);const[pSearch,setPSearch]=useState('');const[showAdd,setShowAdd]=useState(false);const[saved,setSaved]=useState(!!estimate.customer_id);
  const s=(k,v)=>setEst(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));
  const isAU=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';const tD={A:0.4,B:0.35,C:0.3};
  const selCust=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);s('customer_id',id);s('default_markup',c.catalog_markup||1.65);s('ship_to',`${c.shipping_city||''}, ${c.shipping_state||''}`)}};
  const addProd=p=>{const au=isAU(p.brand);const sell=au?roundQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):roundQ(p.nsa_cost*(est.default_markup||1.65));
    s('items',[...est.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:p.available_sizes,_colors:p._colors||null,sizes:{},decorations:[]}]);setShowAdd(false);setPSearch('')};
  const uI=(i,k,v)=>s('items',est.items.map((it,x)=>x===i?{...it,[k]:v}:it));const rmI=i=>s('items',est.items.filter((_,x)=>x!==i));
  const uSz=(i,sz,v)=>{const n=v===''?0:parseInt(v)||0;uI(i,'sizes',{...est.items[i].sizes,[sz]:n})};
  const addD=i=>{const it=est.items[i];uI(i,'decorations',[...it.decorations,{type:'screen_print',position:'Front Center',colors:1,stitches:8000,underbase:false,two_color:false,dtf_size:0,sell_override:null,art_group:null}])};
  const uD=(ii,di,k,v)=>{const it=est.items[ii];uI(ii,'decorations',it.decorations.map((d,i)=>i===di?{...d,[k]:v}:d))};
  const rmD=(ii,di)=>{const it=est.items[ii];uI(ii,'decorations',it.decorations.filter((_,i)=>i!==di))};

  const totals=useMemo(()=>{let rev=0,cost=0;est.items.forEach(it=>{const q=Object.values(it.sizes).reduce((a,v)=>a+v,0);if(!q)return;rev+=q*it.unit_sell;cost+=q*it.nsa_cost;
    it.decorations.forEach(d=>{const dp=dP(d,q);rev+=q*dp.sell;cost+=q*dp.cost})});
    const ship=est.shipping_type==='pct'?rev*(est.shipping_value||0)/100:(est.shipping_value||0);
    const tax=rev*(cust?.tax_rate||0);
    return{rev,cost,ship,tax,grandTotal:rev+ship+tax,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[est]); // eslint-disable-line
  const fp=products.filter(p=>{if(!pSearch)return true;const q=pSearch.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)});

  return(<div>
    <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Estimates</button>
    {/* HEADER */}
    <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{est.id}</span>
            <span className={`badge ${est.status==='draft'?'badge-gray':est.status==='sent'?'badge-amber':est.status==='approved'?'badge-green':'badge-red'}`}>{est.status}</span>
            <EmailBadge est={est}/></div>
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>({value:c.id,label:`${c.name} (${c.alpha_tag})`}))} value={est.customer_id} onChange={selCust} placeholder="Search customer..."/></div>
          :<div><div style={{fontSize:18,fontWeight:800,color:'#0f172a'}}>{cust.name} <span style={{fontSize:14,color:'#64748b'}}>({cust.alpha_tag})</span></div>
            <div style={{fontSize:13,color:'#64748b'}}>Tier {cust.adidas_ua_tier} | {est.default_markup}x catalog | Tax: {cust.tax_rate?(cust.tax_rate*100).toFixed(2)+'%':'Auto'}</div></div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Created by {REPS.find(r=>r.id===est.created_by)?.name} · {est.created_at}{est.updated_at!==est.created_at&&` · Updated ${est.updated_at}`}</div>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <div style={{textAlign:'center',padding:'8px 14px',background:'#f0fdf4',borderRadius:8,minWidth:80}}><div style={{fontSize:9,color:'#166534',fontWeight:700}}>REVENUE</div><div style={{fontSize:20,fontWeight:800,color:'#166534'}}>${totals.rev.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'8px 14px',background:'#fef2f2',borderRadius:8,minWidth:80}}><div style={{fontSize:9,color:'#dc2626',fontWeight:700}}>COST</div><div style={{fontSize:20,fontWeight:800,color:'#dc2626'}}>${totals.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
          <div style={{textAlign:'center',padding:'8px 14px',background:'#dbeafe',borderRadius:8,minWidth:80}}><div style={{fontSize:9,color:'#1e40af',fontWeight:700}}>MARGIN</div><div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>${totals.margin.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div style={{fontSize:10,color:'#64748b'}}>{totals.pct.toFixed(1)}%</div></div>
          <div style={{textAlign:'center',padding:'8px 14px',background:'#faf5ff',borderRadius:8,minWidth:80}}><div style={{fontSize:9,color:'#7c3aed',fontWeight:700}}>TOTAL</div><div style={{fontSize:20,fontWeight:800,color:'#7c3aed'}}>${totals.grandTotal.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div style={{fontSize:9,color:'#94a3b8'}}>+tax+ship</div></div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200}}><label className="form-label">Memo *</label><input className="form-input" value={est.memo} onChange={e=>s('memo',e.target.value)} placeholder="e.g. Spring 2026 Baseball Uniforms" style={{fontSize:14}}/></div>
        <div style={{width:70}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={est.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;s('default_markup',m);s('items',est.items.map(it=>isAU(it.brand)?it:{...it,unit_sell:roundQ(it.nsa_cost*m)}))}}/></div>
        <button className="btn btn-primary" onClick={()=>{onSave(est);setSaved(true);onNotify('Estimate saved')}}><Icon name="check" size={14}/> Save</button>
        {saved&&est.status!=='approved'&&<button className="btn btn-secondary" onClick={()=>{s('status','sent');s('email_status','sent');onSave({...est,status:'sent',email_status:'sent'});onNotify('Estimate sent to coach')}}><Icon name="send" size={14}/> Send to Coach</button>}
        {est.status==='approved'&&<button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>onConvertSO(est)}><Icon name="box" size={14}/> Convert to SO</button>}
      </div>
      {/* SHIPPING + SHIP-TO */}
      <div style={{display:'flex',gap:12,marginTop:12,alignItems:'end',flexWrap:'wrap',borderTop:'1px solid #f1f5f9',paddingTop:12}}>
        <div><label className="form-label">Shipping</label><div style={{display:'flex',gap:4,alignItems:'center'}}>
          <Bg options={[{value:'pct',label:'%'},{value:'flat',label:'Flat $'}]} value={est.shipping_type||'pct'} onChange={v=>s('shipping_type',v)}/>
          <input className="form-input" type="number" step={est.shipping_type==='pct'?1:5} value={est.shipping_value||0} onChange={e=>s('shipping_value',parseFloat(e.target.value)||0)} style={{width:70,textAlign:'center'}}/>
          {est.shipping_type==='pct'&&<span style={{fontSize:12,color:'#64748b'}}>= ${totals.ship.toFixed(2)}</span>}
        </div></div>
        <div style={{flex:1,minWidth:200}}><label className="form-label">Ship To</label><input className="form-input" value={est.ship_to||''} onChange={e=>s('ship_to',e.target.value)} placeholder={cust?`${cust.shipping_city}, ${cust.shipping_state}`:'Select customer first'}/></div>
        <div style={{fontSize:12,color:'#64748b'}}>Tax ({cust?.tax_rate?(cust.tax_rate*100).toFixed(2):0}%): <strong>${totals.tax.toFixed(2)}</strong></div>
      </div>
    </div></div>

    {/* LINE ITEMS */}
    {est.items.map((item,idx)=>{const qty=Object.values(item.sizes).reduce((a,v)=>a+v,0);
      let dRev=0,dCost=0;item.decorations.forEach(d=>{const dp=dP(d,qty);dRev+=qty*dp.sell;dCost+=qty*dp.cost});
      const iRev=qty*item.unit_sell+dRev;const iCost=qty*item.nsa_cost+dCost;const mg=iRev-iCost;
      const szs=item.available_sizes?item.available_sizes.filter(sz=>showSz(sz,item.sizes[sz])):['S','M','L','XL','2XL'];
      return(<div key={idx} className="card" style={{marginBottom:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>
                <span style={{fontWeight:700,fontSize:15}}>{item.name}</span>
                {item._colors?<select className="form-select" style={{fontSize:12,width:150}} value={item.color||item._colors[0]} onChange={e=>uI(idx,'color',e.target.value)}>{item._colors.map(c=><option key={c} value={c}>{c}</option>)}</select>:<span className="badge badge-gray">{item.color}</span>}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:8}}>
                <span style={{fontSize:13,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong></span>
                <span style={{fontSize:14}}>Sell: <$Input value={item.unit_sell} onChange={v=>uI(idx,'unit_sell',v)}/>/ea</span>
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}
                {!isAU(item.brand)&&<span style={{fontSize:12,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
              </div>
            </div>
            <div style={{textAlign:'right',fontSize:12,minWidth:130}}>
              <div>Qty: <strong style={{fontSize:16}}>{qty}</strong></div>
              <div style={{marginTop:2}}>Rev: <strong style={{color:'#166534'}}>${iRev.toFixed(0)}</strong></div>
              <div>Margin: <strong style={{color:mg>=0?'#1e40af':'#dc2626'}}>${mg.toFixed(0)} ({iRev>0?(mg/iRev*100).toFixed(0):0}%)</strong></div>
            </div>
            <button onClick={()=>rmI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={16}/></button>
          </div>
        </div>
        {/* SIZES */}
        <div style={{padding:'10px 18px',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #f1f5f9'}}>
          <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:50}}>Sizes:</span>
          {szs.map(sz=><div key={sz} style={{textAlign:'center',width:48}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
            <input value={item.sizes[sz]||''} onChange={e=>uSz(idx,sz,e.target.value)} placeholder="0"
              style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:(item.sizes[sz]||0)>0?'#0f172a':'#cbd5e1'}}/></div>)}
          <div style={{textAlign:'center',marginLeft:8,padding:'0 12px',borderLeft:'2px solid #e2e8f0'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOTAL</div><div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div></div>
        </div>
        {/* DECORATIONS */}
        <div style={{padding:'8px 18px 14px'}}>
          {item.decorations.map((deco,di)=>{const dp=dP(deco,qty);return(<div key={di} style={{padding:'10px 0',borderTop:di>0?'1px solid #f1f5f9':''}}>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
              <Bg options={[{value:'screen_print',label:'Screen Print'},{value:'embroidery',label:'Embroidery'},{value:'number_press',label:'Numbers'},{value:'dtf',label:'DTF'}]} value={deco.type} onChange={v=>uD(idx,di,'type',v)}/>
              <select className="form-select" style={{width:130,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}</select>
              {est.items.length>1&&<select className="form-select" style={{width:160,fontSize:11}} value={deco.art_group||''} onChange={e=>uD(idx,di,'art_group',e.target.value||null)}>
                <option value="">Unique art (this item only)</option>{est.items.map((oi,oj)=>oj!==idx?<option key={oj} value={`shared-${oj}`}>Same art as {oi.sku} {oi.name?.split(' ')[0]}</option>:null)}</select>}
              <button onClick={()=>rmD(idx,di)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {deco.type==='screen_print'&&<><span style={{fontSize:12,fontWeight:600}}>Colors:</span><Bg options={[1,2,3,4,5].map(n=>({value:n,label:String(n)}))} value={deco.colors||1} onChange={v=>uD(idx,di,'colors',v)}/>
                <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginLeft:8}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uD(idx,di,'underbase',e.target.checked)}/> Underbase (+15%)</label></>}
              {deco.type==='embroidery'&&<><span style={{fontSize:12,fontWeight:600}}>Stitches:</span><Bg options={[{value:8000,label:'0-10k'},{value:12000,label:'10-15k'},{value:18000,label:'15-20k'},{value:25000,label:'20k+'}]} value={deco.stitches||8000} onChange={v=>uD(idx,di,'stitches',v)}/></>}
              {deco.type==='number_press'&&<label style={{fontSize:12,display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>uD(idx,di,'two_color',e.target.checked)}/> 2-Color (+$3 cost)</label>}
              {deco.type==='dtf'&&<Bg options={DTF.map((d,i)=>({value:i,label:d.label}))} value={deco.dtf_size||0} onChange={v=>uD(idx,di,'dtf_size',v)}/>}
              <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
                <span style={{fontSize:14}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                <span style={{fontSize:14}}>Sell: <$Input value={deco.sell_override||dp.sell} onChange={v=>uD(idx,di,'sell_override',v)} width={60}/></span>
              </div>
            </div>
            {deco.art_group&&<div style={{fontSize:10,color:'#7c3aed',marginTop:4}}>🔗 Shared art — linked to another item (one setup charge)</div>}
          </div>)})}
          <button className="btn btn-sm btn-secondary" onClick={()=>addD(idx)} style={{marginTop:6}}><Icon name="plus" size={12}/> Add Decoration</button>
        </div>
      </div>)})}

    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAdd?<button className="btn btn-primary" onClick={()=>setShowAdd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search products by SKU, name, or brand..." value={pSearch} onChange={e=>setPSearch(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:250,overflow:'auto'}}>{fp.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addProd(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:600}}>{p.name}</span><span className="badge badge-blue">{p.brand}</span>
          {p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} colors</span>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>Cost: ${p.nsa_cost?.toFixed(2)}</span></div>)}</div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPSearch('')}} style={{marginTop:8}}>Cancel</button>
      </div>}
    </div></div>
  </div>);
}

// SO DETAIL VIEW
function SODetail({so,customers,onBack,onNotify}){
  const c=customers.find(x=>x.id===so.customer_id);const statusFlow=['waiting_art','in_production','ready_ship','shipped','completed'];const si=statusFlow.indexOf(so.status);
  const[status,setStatus]=useState(so.status);
  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Sales Orders</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'16px 20px'}}>
    <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div style={{flex:1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{so.id}</span>
          <span className={`badge ${status==='waiting_art'?'badge-amber':status==='in_production'?'badge-blue':status==='ready_ship'?'badge-green':'badge-gray'}`}>{status.replace(/_/g,' ')}</span></div>
        <div style={{fontSize:18,fontWeight:800}}>{c?.name} <span style={{fontSize:14,color:'#64748b'}}>({c?.alpha_tag})</span></div>
        <div style={{fontSize:13,color:'#64748b'}}>{so.memo} | Expected: <strong>{so.expected_date||'TBD'}</strong></div>
        {so.estimate_id&&<div style={{fontSize:11,color:'#7c3aed'}}>From estimate: {so.estimate_id}</div>}
        <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Created by {REPS.find(r=>r.id===so.created_by)?.name} · {so.created_at}</div>
      </div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {statusFlow.map((sf,i)=><button key={sf} className={`btn btn-sm ${i<=statusFlow.indexOf(status)?'btn-primary':'btn-secondary'}`} disabled={i<statusFlow.indexOf(status)}
          onClick={()=>{setStatus(sf);onNotify(`Status → ${sf.replace(/_/g,' ')}`)}} style={{fontSize:11}}>{sf.replace(/_/g,' ')}</button>)}
      </div>
    </div>
  </div></div>
  {/* FIRM DATES */}
  {so.firm_dates?.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Firm Date Requests</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>Item</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {so.firm_dates.map((fd,i)=><tr key={i}><td style={{fontWeight:600}}>{fd.item_desc}</td><td><span className="badge badge-amber">{fd.date}</span></td>
      <td>{fd.approved?<span className="badge badge-green">Approved</span>:<span className="badge badge-amber">Pending</span>}</td>
      <td>{!fd.approved&&<button className="btn btn-sm btn-primary" onClick={()=>onNotify('Firm date approved')}>Approve</button>}</td></tr>)}
  </tbody></table></div></div>}
  {/* LINE ITEMS */}
  {so.items?.length>0?so.items.map((item,idx)=>{const qty=Object.values(item.sizes||{}).reduce((a,v)=>a+v,0);
    return(<div key={idx} className="card" style={{marginBottom:12}}><div style={{padding:'14px 18px'}}>
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4}}>{item.sku}</span><span style={{fontWeight:700}}>{item.name}</span></div>
          <div style={{fontSize:13,color:'#64748b',marginTop:4}}>Cost: ${item.nsa_cost?.toFixed(2)} | Sell: ${item.unit_sell?.toFixed(2)}</div>
          {item.sizes&&<div style={{display:'flex',gap:4,marginTop:8}}>{Object.entries(item.sizes).filter(([,v])=>v>0).map(([sz,q])=><div key={sz} className="size-cell in-stock"><div className="size-label">{sz}</div><div className="size-qty">{q}</div></div>)}<div className="size-cell total"><div className="size-label">TOT</div><div className="size-qty">{qty}</div></div></div>}
          {item.decorations?.map((d,di)=><div key={di} style={{marginTop:6,fontSize:12,color:'#475569',padding:'4px 8px',background:'#f8fafc',borderRadius:4,display:'inline-block',marginRight:4}}>
            {d.type==='screen_print'?`Screen Print ${d.colors}c`:d.type==='embroidery'?'Embroidery':d.type==='number_press'?`Numbers${d.two_color?' (2c)':''}`:d.type} @ {d.position} {d.underbase&&'(UB)'}
          </div>)}
        </div>
        <div style={{textAlign:'right',fontSize:13}}><div>Qty: <strong>{qty}</strong></div><div style={{color:'#166534'}}>Rev: <strong>${(qty*(item.unit_sell||0)).toFixed(0)}</strong></div></div>
      </div>
    </div></div>)}):<div className="card"><div className="card-body"><div className="empty">No line items — items populate when converted from estimate</div></div></div>}
  </div>);
}

// CUSTOMER DETAIL (full v2.3)
function CustDetail({customer,allCustomers,allOrders,onBack,onEdit,onSelCust,onNewEst}){
  const[tab,setTab]=useState('activity');const[oF,setOF]=useState('all');const[sF,setSF]=useState('all');const[rR,setRR]=useState('thisyear');
  const isP=!customer.parent_id;const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const tl={prepay:'Prepay',net15:'Net 15',net30:'Net 30',net60:'Net 60'};const tierL={A:'40% off retail',B:'35% off retail',C:'30% off retail'};
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const orders=allOrders.filter(o=>ids.includes(o.customer_id));
  const fo=orders.filter(o=>{if(oF!=='all'&&o.type!==oF)return false;if(sF==='open')return['sent','draft','open','in_production','waiting_art'].includes(o.status);if(sF==='closed')return['approved','paid','completed','shipped'].includes(o.status);return true});
  const gn=id=>{const c=allCustomers.find(x=>x.id===id);return c?.alpha_tag||''};
  return(<div>
  <button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Customers</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="building" size={28}/></div>
  <div style={{flex:1}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{customer.name}</span><span className="badge badge-blue">{customer.alpha_tag}</span><span className="badge badge-green">Tier {customer.adidas_ua_tier}</span><span className="badge badge-gray">{tl[customer.payment_terms]||'Net 30'}</span><span className="badge badge-gray">{customer.catalog_markup||1.65}x</span></div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{(customer.contacts||[]).map((c,i)=><span key={i}>{c.name} ({c.role}) {c.email}{i<customer.contacts.length-1&&' | '}</span>)}{customer.shipping_city&&<span> | {customer.shipping_city}, {customer.shipping_state}</span>}</div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}><button className="btn btn-sm btn-primary" onClick={()=>onNewEst(customer)}><Icon name="file" size={12}/> Create Estimate</button><button className="btn btn-sm btn-primary"><Icon name="cart" size={12}/> Create SO</button><button className="btn btn-sm btn-secondary"><Icon name="mail" size={12}/> Email Portal</button><button className="btn btn-sm btn-secondary"><Icon name="eye" size={12}/> Customer Portal</button><button className="btn btn-sm btn-secondary" onClick={()=>onEdit(customer)}><Icon name="edit" size={12}/> Edit</button></div>
  </div>
  {(customer._open_balance||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>BALANCE</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${customer._open_balance.toLocaleString()}</div></div>}
  </div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value">{customer._open_estimates||0}</div></div><div className="stat-card"><div className="stat-label">Open SOs</div><div className="stat-value">{customer._open_sos||0}</div></div><div className="stat-card"><div className="stat-label">Open Invoices</div><div className="stat-value" style={{color:(customer._open_invoices||0)>0?'#dc2626':''}}>{customer._open_invoices||0}</div></div><div className="stat-card"><div className="stat-label">Balance</div><div className="stat-value" style={{color:(customer._open_balance||0)>0?'#dc2626':''}}>${(customer._open_balance||0).toLocaleString()}</div></div></div>
  {isP&&subs.length>0&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Sub-Customers ({subs.length})</h2></div><div className="card-body" style={{padding:0}}>
  {subs.map(sub=><div key={sub.id} style={{padding:'10px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>onSelCust(sub)}>
    <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontWeight:600,color:'#1e40af'}}>{sub.name}</span><span className="badge badge-gray">{sub.alpha_tag}</span><span style={{fontSize:11,color:'#94a3b8'}}>{(sub.contacts||[])[0]?.name}</span><div style={{flex:1}}/>
    {(sub._open_estimates||0)>0&&<span className="badge badge-amber">{sub._open_estimates} est</span>}{(sub._open_sos||0)>0&&<span className="badge badge-blue">{sub._open_sos} SO</span>}
    {(sub._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${sub._open_balance.toLocaleString()}</span>}
  </div>)}</div></div>}
  <div className="tabs">{['activity','overview','artwork','reporting'].map(t=><button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t==='activity'?'Orders & Invoices':t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
  {tab==='activity'&&<div className="card"><div className="card-header"><h2>Orders & Invoices</h2><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
    {[['all','All'],['estimate','Estimates'],['sales_order','SOs'],['invoice','Invoices']].map(([v,l])=><button key={v} className={`btn btn-sm ${oF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setOF(v)}>{l}</button>)}
    <span style={{width:1,background:'#e2e8f0',margin:'0 4px'}}/>
    {[['all','All Status'],['open','Open'],['closed','Closed']].map(([v,l])=><button key={v} className={`btn btn-sm ${sF===v?'btn-primary':'btn-secondary'}`} onClick={()=>setSF(v)}>{l}</button>)}
  </div></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Type</th><th>Date</th><th>Memo</th>{isP&&<th>Sub</th>}<th>Total</th><th>Status</th></tr></thead><tbody>
    {fo.length===0?<tr><td colSpan={7} style={{textAlign:'center',color:'#94a3b8',padding:20}}>No records</td></tr>:
    fo.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(o=><tr key={o.id}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{o.id}</td>
      <td><span className={`badge ${o.type==='estimate'?'badge-amber':o.type==='sales_order'?'badge-blue':'badge-red'}`}>{o.type==='sales_order'?'SO':o.type==='estimate'?'Est':'Inv'}</span></td>
      <td>{o.date}</td><td style={{fontSize:12}}>{o.memo}</td>{isP&&<td><span className="badge badge-gray">{gn(o.customer_id)}</span></td>}
      <td style={{fontWeight:700}}>${o.total?.toLocaleString()}</td>
      <td><span className={`badge ${o.status==='open'||o.status==='sent'?'badge-amber':o.status==='approved'||o.status==='paid'?'badge-green':o.status==='draft'?'badge-gray':'badge-blue'}`}>{o.status?.replace(/_/g,' ')}</span></td>
    </tr>)}</tbody></table></div></div>}
  {tab==='overview'&&<div className="card"><div className="card-header"><h2>Customer Information</h2></div><div className="card-body">
    <div className="form-row form-row-3"><div><div className="form-label">Billing</div><div style={{fontSize:13}}>{customer.billing_address_line1||'--'}<br/>{customer.billing_city}, {customer.billing_state} {customer.billing_zip}</div></div>
    <div><div className="form-label">Shipping</div><div style={{fontSize:13}}>{customer.shipping_address_line1||'--'}<br/>{customer.shipping_city}, {customer.shipping_state}</div></div>
    <div><div className="form-label">Tax Rate</div><div style={{fontSize:13}}>{customer.tax_rate?(customer.tax_rate*100).toFixed(2)+'%':'Auto'}</div></div></div>
    <div style={{marginTop:16}}><div className="form-label">Pricing</div><div style={{fontSize:13}}>Adidas/UA: Tier {customer.adidas_ua_tier} ({tierL[customer.adidas_ua_tier]})<br/>Catalog: {customer.catalog_markup||1.65}x</div></div>
    <div style={{marginTop:16}}><div className="form-label">Contacts</div>{(customer.contacts||[]).map((c,i)=><div key={i} style={{fontSize:13,padding:'4px 0'}}><strong>{c.name}</strong> ({c.role}) — {c.email} {c.phone&&`| ${c.phone}`}</div>)}</div>
  </div></div>}
  {tab==='artwork'&&<div className="card"><div className="card-body"><div className="empty">Art library in Phase 3</div></div></div>}
  {tab==='reporting'&&<div className="card"><div className="card-header"><h2>Reporting</h2><div style={{display:'flex',gap:4}}>{[['thisyear','This Year'],['lastyear','Last Year'],['rolling','Rolling 12mo'],['alltime','All Time']].map(([v,l])=><button key={v} className={`btn btn-sm ${rR===v?'btn-primary':'btn-secondary'}`} onClick={()=>setRR(v)}>{l}</button>)}</div></div>
    <div className="card-body"><div className="stats-row"><div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{rR==='thisyear'?'$15,600':rR==='lastyear'?'$32,600':rR==='rolling'?'$41,800':'$48,200'}</div></div><div className="stat-card"><div className="stat-label">Orders</div><div className="stat-value">{rR==='thisyear'?'4':'8'}</div></div><div className="stat-card"><div className="stat-label">Avg Order</div><div className="stat-value">{rR==='thisyear'?'$3,900':'$4,075'}</div></div><div className="stat-card"><div className="stat-label">LTV</div><div className="stat-value">$48,200</div></div></div></div></div>}
  </div>);
}

// VENDOR DETAIL
function VendDetail({vendor,onBack}){return(<div><button className="btn btn-secondary" onClick={onBack} style={{marginBottom:12}}><Icon name="back" size={14}/> All Vendors</button>
  <div className="card" style={{marginBottom:16}}><div style={{padding:'20px 24px',display:'flex',gap:16,alignItems:'flex-start'}}>
  <div style={{width:56,height:56,borderRadius:12,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="package" size={28}/></div>
  <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:20,fontWeight:800}}>{vendor.name}</span><span className={`badge ${vendor.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{vendor.vendor_type==='api'?'API':'Upload'}</span><span className="badge badge-gray">{vendor.payment_terms?.replace('net','Net ')}</span>{vendor.nsa_carries_inventory&&<span className="badge badge-green">NSA Stock</span>}</div>
    <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{vendor.contact_email} {vendor.contact_phone&&`| ${vendor.contact_phone}`} {vendor.rep_name&&`| Rep: ${vendor.rep_name}`}</div>{vendor.notes&&<div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{vendor.notes}</div>}</div>
  {(vendor._invoice_total||0)>0&&<div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>OWED</div><div style={{fontSize:24,fontWeight:800,color:'#dc2626'}}>${vendor._invoice_total.toLocaleString()}</div></div>}</div></div>
  <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Invoices</div><div className="stat-value">{vendor._open_invoices||0}</div></div><div className="stat-card"><div className="stat-label">Current</div><div className="stat-value" style={{color:'#166534'}}>${(vendor._aging_current||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">30 Day</div><div className="stat-value" style={{color:(vendor._aging_30||0)>0?'#d97706':''}}>${(vendor._aging_30||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">60+</div><div className="stat-value" style={{color:(vendor._aging_60||0)>0?'#dc2626':''}}>${((vendor._aging_60||0)+(vendor._aging_90||0)).toLocaleString()}</div></div></div>
  <div className="card"><div className="card-header"><h2>Purchase Orders</h2></div><div className="card-body"><div className="empty">PO tracking in Phase 4</div></div></div></div>)}

// CUSTOMER MODAL
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
    <div style={{display:'flex',gap:8,marginBottom:16}}>{['parent','sub'].map(t=><button key={t} className={`btn btn-sm ${ct===t?'btn-primary':'btn-secondary'}`} onClick={()=>{setCt(t);if(t==='parent')sv('parent_id',null)}}>{t==='parent'?'Parent':'Sub-Customer'}</button>)}</div>
    {ct==='sub'&&<div className="form-group" style={{marginBottom:12}}><label className="form-label">Parent *</label><SearchSelect options={parents.map(p=>({value:p.id,label:`${p.name} (${p.alpha_tag})`}))} value={f.parent_id} onChange={v=>sv('parent_id',v)} placeholder="Search parent..."/></div>}
    <div className="form-row form-row-3"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e=>sv('name',e.target.value)} style={err.n?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Alpha Tag *</label><input className="form-input" value={f.alpha_tag||''} onChange={e=>sv('alpha_tag',e.target.value)} style={err.a?{borderColor:'#dc2626'}:{}}/></div>
      <div className="form-group"><label className="form-label">Terms</label><select className="form-select" value={f.payment_terms||'net30'} onChange={e=>sv('payment_terms',e.target.value)}><option value="prepay">Prepay</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></div></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:8,marginBottom:6,textTransform:'uppercase'}}>Contacts</div>
    {(f.contacts||[]).map((c,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 100px auto',gap:6,marginBottom:6}}>
      <input className="form-input" placeholder="Name *" value={c.name} onChange={e=>upC(i,'name',e.target.value)} style={i===0&&err.cn&&!c.name?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Email *" value={c.email} onChange={e=>upC(i,'email',e.target.value)} style={i===0&&err.ce&&!c.email?{borderColor:'#dc2626'}:{}}/>
      <input className="form-input" placeholder="Phone" value={c.phone} onChange={e=>upC(i,'phone',e.target.value)}/>
      <select className="form-select" value={c.role} onChange={e=>upC(i,'role',e.target.value)} style={{fontSize:11}}>{CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}</select>
      {i>0?<button className="btn btn-sm btn-secondary" onClick={()=>rmC(i)}><Icon name="trash" size={12}/></button>:<div/>}</div>)}
    <button className="btn btn-sm btn-secondary" onClick={addC}><Icon name="plus" size={12}/> Contact</button>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Shipping</div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 60px 80px',gap:8}}><input className="form-input" placeholder="Street" value={f.shipping_address_line1||''} onChange={e=>sv('shipping_address_line1',e.target.value)}/><input className="form-input" placeholder="City *" value={f.shipping_city||''} onChange={e=>sv('shipping_city',e.target.value)} style={err.c?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ST *" value={f.shipping_state||''} onChange={e=>sv('shipping_state',e.target.value)} style={err.s?{borderColor:'#dc2626'}:{}}/><input className="form-input" placeholder="ZIP" value={f.shipping_zip||''} onChange={e=>sv('shipping_zip',e.target.value)}/></div>
    <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginTop:12,marginBottom:6,textTransform:'uppercase'}}>Pricing</div>
    <div className="form-row form-row-2"><div className="form-group"><label className="form-label">Tier</label><select className="form-select" value={f.adidas_ua_tier||'B'} onChange={e=>sv('adidas_ua_tier',e.target.value)}><option value="A">A - 40%</option><option value="B">B - 35%</option><option value="C">C - 30%</option></select></div>
      <div className="form-group"><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={f.catalog_markup||1.65} onChange={e=>sv('catalog_markup',parseFloat(e.target.value)||1.65)}/></div></div>
  </div>
  <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{if(!ok())return;onSave({...f,id:f.id||'c'+Date.now(),parent_id:ct==='sub'?f.parent_id:null,is_active:true,_open_estimates:f._open_estimates||0,_open_sos:f._open_sos||0,_open_invoices:f._open_invoices||0,_open_balance:f._open_balance||0});onClose()}}>Save</button></div>
  </div></div>);
}

// ADJ INV MODAL
function AdjModal({isOpen,onClose,product,onSave}){const[a,setA]=useState({});React.useEffect(()=>{if(product)setA({...product._inv})},[product,isOpen]);if(!isOpen||!product)return null;
  return(<div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
    <div className="modal-header"><h2>Adjust Inventory</h2><button className="modal-close" onClick={onClose}>x</button></div>
    <div className="modal-body"><div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:12}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{product.sku}</span> {product.name}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{product.available_sizes.map(sz=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>{sz}</div>
        <input className="form-input" type="number" min="0" style={{width:60,textAlign:'center'}} value={a[sz]||0} onChange={e=>setA(x=>({...x,[sz]:parseInt(e.target.value)||0}))}/><div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>was: {product._inv?.[sz]||0}</div></div>)}</div>
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={()=>{onSave(product.id,a);onClose()}}>Save</button></div>
  </div></div>);
}

// MAIN APP
export default function App(){
  const[pg,setPg]=useState('dashboard');const[toast,setToast]=useState(null);
  const[cust,setCust]=useState(D_C);const[vend]=useState(D_V);const[prod,setProd]=useState(D_P);
  const[ests,setEsts]=useState(D_E);const[sos,setSOs]=useState(D_SO);const[invs]=useState(D_INV);
  const[cM,setCM]=useState({open:false,c:null});const[aM,setAM]=useState({open:false,p:null});
  const[q,setQ]=useState('');const[selC,setSelC]=useState(null);const[selV,setSelV]=useState(null);
  const[eEst,setEEst]=useState(null);const[eEstC,setEEstC]=useState(null);const[selSO,setSelSO]=useState(null);
  const[rF,setRF]=useState('all');const[pF,setPF]=useState({cat:'all',vnd:'all',stk:'all',clr:'all'});
  const[iS,setIS]=useState({f:'value',d:'desc'});const[iF,setIF]=useState({cat:'all',vnd:'all'});
  const cu=REPS[0];const isA=cu.role==='admin';
  const nf=(m,t='success')=>{setToast({msg:m,type:t});setTimeout(()=>setToast(null),3500)};
  const pars=useMemo(()=>cust.filter(c=>!c.parent_id),[cust]);const gK=useCallback(pid=>cust.filter(c=>c.parent_id===pid),[cust]);
  const cols=useMemo(()=>[...new Set(prod.map(p=>p.color).filter(Boolean))].sort(),[prod]);
  const savC=c=>{setCust(p=>{const e=p.find(x=>x.id===c.id);return e?p.map(x=>x.id===c.id?c:x):[...p,c]});nf('Customer saved')};
  const savE=e=>{setEsts(p=>{const ex=p.find(x=>x.id===e.id);return ex?p.map(x=>x.id===e.id?e:x):[...p,e]})};
  const savI=(pid,inv)=>{setProd(p=>p.map(x=>x.id===pid?{...x,_inv:inv}:x));nf('Inventory updated')};

  const newE=c=>{const e={id:'EST-'+(2100+ests.length),customer_id:c?.id||null,memo:'',status:'draft',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),default_markup:c?.catalog_markup||1.65,shipping_type:'pct',shipping_value:0,ship_to:c?`${c.shipping_city||''}, ${c.shipping_state||''}`:'',email_status:null,items:[]};setEEst(e);setEEstC(c||null);setPg('estimates')};

  const convertSO=est=>{const so={id:'SO-'+(1052+sos.length),customer_id:est.customer_id,estimate_id:est.id,memo:est.memo,status:'waiting_art',created_by:cu.id,created_at:new Date().toLocaleString(),updated_at:new Date().toLocaleString(),expected_date:'',firm_dates:[],items:est.items.map(it=>({...it}))};
    setSOs(p=>[...p,so]);setEsts(p=>p.map(e=>e.id===est.id?{...e,status:'converted'}:e));setEEst(null);setSelSO(so);setPg('orders');nf(`${so.id} created from ${est.id}`)};

  const aO=useMemo(()=>[
    ...ests.map(e=>{const t=e.items?.reduce((a,it)=>{const qq=Object.values(it.sizes||{}).reduce((s,v)=>s+v,0);let r=qq*it.unit_sell;it.decorations?.forEach(d=>{const dp=dP(d,qq);r+=qq*dp.sell});return a+r},0)||0;return{id:e.id,type:'estimate',customer_id:e.customer_id,date:e.created_at?.split(' ')[0],total:t,memo:e.memo,status:e.status}}),
    ...sos.map(s=>{const t=s.items?.reduce((a,it)=>{const qq=Object.values(it.sizes||{}).reduce((ss,v)=>ss+v,0);return a+qq*(it.unit_sell||0)},0)||0;return{id:s.id,type:'sales_order',customer_id:s.customer_id,date:s.created_at?.split(' ')[0],total:t,memo:s.memo,status:s.status}}),
    ...invs.map(i=>({...i,type:'invoice'}))],[ests,sos,invs]);

  const fP=useMemo(()=>{let l=prod;if(q&&pg==='products'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s)||p.brand?.toLowerCase().includes(s)||p.color?.toLowerCase().includes(s))}
    if(pF.cat!=='all')l=l.filter(p=>p.category===pF.cat);if(pF.vnd!=='all')l=l.filter(p=>p.vendor_id===pF.vnd);if(pF.stk==='instock')l=l.filter(p=>Object.values(p._inv||{}).some(v=>v>0));if(pF.clr!=='all')l=l.filter(p=>p.color===pF.clr);return l},[prod,q,pF,pg]);
  const iD=useMemo(()=>{let l=prod.filter(p=>Object.values(p._inv||{}).some(v=>v>0));
    if(iF.cat!=='all')l=l.filter(p=>p.category===iF.cat);if(iF.vnd!=='all')l=l.filter(p=>p.vendor_id===iF.vnd);
    if(q&&pg==='inventory'){const s=q.toLowerCase();l=l.filter(p=>p.sku.toLowerCase().includes(s)||p.name.toLowerCase().includes(s))}
    const m=l.map(p=>{const t=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);return{...p,_tQ:t,_tV:t*(p.nsa_cost||0)}});
    m.sort((a,b)=>{const f=iS.f;let va,vb;if(f==='sku'){va=a.sku;vb=b.sku}else if(f==='name'){va=a.name;vb=b.name}else if(f==='qty'){va=a._tQ;vb=b._tQ}else{va=a._tV;vb=b._tV}
    if(typeof va==='string')return iS.d==='asc'?va.localeCompare(vb):vb.localeCompare(va);return iS.d==='asc'?va-vb:vb-va});return m},[prod,iS,iF,q,pg]);
  const tV=useMemo(()=>iD.reduce((a,p)=>a+p._tV,0),[iD]);const tU=useMemo(()=>iD.reduce((a,p)=>a+p._tQ,0),[iD]);
  const al=useMemo(()=>{const r=[];prod.forEach(p=>{if(!p._alerts)return;Object.entries(p._alerts).forEach(([sz,min])=>{const c=p._inv?.[sz]||0;if(c<min)r.push({p,sz,c,min,need:min-c})})});return r},[prod]);

  // DASHBOARD
  const rDash=()=>(<>
    <div className="stats-row"><div className="stat-card"><div className="stat-label">Open Estimates</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='draft'||e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Active SOs</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>!['completed','shipped'].includes(s.status)).length}</div></div><div className="stat-card"><div className="stat-label">Inventory Value</div><div className="stat-value">${tV.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div className="stat-sub">{tU} units</div></div>
      {isA&&<div className="stat-card" style={al.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Stock Alerts</div><div className="stat-value" style={{color:al.length>0?'#d97706':''}}>{al.length}</div></div>}</div>
    {isA&&al.length>0&&<div className="card" style={{marginBottom:16,borderLeft:'4px solid #d97706'}}><div className="card-header"><h2 style={{color:'#d97706'}}><Icon name="alert" size={16}/> Stock Alerts</h2><button className="btn btn-sm btn-primary" onClick={()=>nf('Draft restock PO generated!')}>Auto-Restock PO</button></div>
      <div className="card-body" style={{padding:0}}><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Current</th><th>Min</th><th>Need</th></tr></thead><tbody>
      {al.slice(0,8).map((a,i)=><tr key={i}><td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{a.p.sku}</td><td style={{fontSize:12}}>{a.p.name}</td><td><span className="badge badge-amber">{a.sz}</span></td><td style={{fontWeight:700,color:'#dc2626'}}>{a.c}</td><td>{a.min}</td><td style={{fontWeight:700}}>{a.need}</td></tr>)}</tbody></table></div></div>}
    <div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Quick Actions</h2></div><div className="card-body" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="file" size={14}/> New Estimate</button>
      <button className="btn btn-primary" onClick={()=>nf('New SO — convert from approved estimate')}><Icon name="box" size={14}/> New SO</button>
      <button className="btn btn-secondary" onClick={()=>nf('New PO (Phase 4)')}><Icon name="cart" size={14}/> New PO</button>
      <button className="btn btn-secondary" onClick={()=>{setPg('customers');setCM({open:true,c:null})}}><Icon name="plus" size={14}/> New Customer</button>
      <button className="btn btn-secondary" onClick={()=>nf('New Vendor (coming)')}><Icon name="building" size={14}/> New Vendor</button>
    </div></div>
    <div className="card"><div className="card-header"><h2>Recent Estimates</h2></div><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Status</th><th>Email</th><th>Created</th></tr></thead><tbody>
    {ests.slice(0,5).map(e=>{const c=cust.find(x=>x.id===e.customer_id);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c);setPg('estimates')}}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?.name||'--'} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{e.memo}</td>
      <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
      <td><EmailBadge est={e}/></td><td style={{fontSize:11,color:'#94a3b8'}}>{e.created_at}</td></tr>)})}
    </tbody></table></div></div></>);

  // ESTIMATES
  const rEst=()=>{
    if(eEst)return<EstBuild estimate={eEst} customer={eEstC} allCustomers={cust} products={prod} onSave={e=>{savE(e);setEEst(e)}} onBack={()=>setEEst(null)} onConvertSO={convertSO} currentUser={cu} onNotify={nf}/>;
    const fe=ests.filter(e=>!q||(e.id+' '+e.memo+' '+(cust.find(c=>c.id===e.customer_id)?.name||'')+' '+(cust.find(c=>c.id===e.customer_id)?.alpha_tag||'')).toLowerCase().includes(q.toLowerCase()));
    return(<><div style={{display:'flex',gap:8,marginBottom:16}}><div className="search-bar" style={{flex:1}}><Icon name="search"/><input placeholder="Search by ID, customer, or memo..." value={q} onChange={e=>setQ(e.target.value)}/></div>
      <button className="btn btn-primary" onClick={()=>newE(null)}><Icon name="plus" size={14}/> New Estimate</button></div>
      <div className="stats-row"><div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{ests.length}</div></div><div className="stat-card"><div className="stat-label">Draft</div><div className="stat-value">{ests.filter(e=>e.status==='draft').length}</div></div><div className="stat-card"><div className="stat-label">Sent</div><div className="stat-value" style={{color:'#d97706'}}>{ests.filter(e=>e.status==='sent').length}</div></div><div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value" style={{color:'#166534'}}>{ests.filter(e=>e.status==='approved').length}</div></div></div>
      <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>ID</th><th>Customer</th><th>Memo</th><th>Items</th><th>Status</th><th>Email</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {fe.map(e=>{const c=cust.find(x=>x.id===e.customer_id);return(<tr key={e.id} style={{cursor:'pointer'}} onClick={()=>{setEEst(e);setEEstC(c)}}>
        <td style={{fontWeight:700,color:'#1e40af'}}>{e.id}</td><td>{c?<span>{c.name} <span className="badge badge-gray">{c.alpha_tag}</span></span>:'--'}</td>
        <td style={{fontSize:12}}>{e.memo}</td><td>{e.items?.length||0}</td>
        <td><span className={`badge ${e.status==='draft'?'badge-gray':e.status==='sent'?'badge-amber':e.status==='approved'?'badge-green':'badge-blue'}`}>{e.status}</span></td>
        <td><EmailBadge est={e}/></td>
        <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===e.created_by)?.name}<br/>{e.created_at}</td>
        <td onClick={ev=>ev.stopPropagation()}>{e.status==='approved'&&<button className="btn btn-sm btn-primary" style={{background:'#7c3aed'}} onClick={()=>convertSO(e)}>→ SO</button>}</td>
      </tr>)})}
      </tbody></table></div></div></>);
  };

  // SALES ORDERS
  const rSO=()=>{
    if(selSO)return<SODetail so={selSO} customers={cust} onBack={()=>setSelSO(null)} onNotify={nf}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Total SOs</div><div className="stat-value">{sos.length}</div></div><div className="stat-card"><div className="stat-label">Waiting Art</div><div className="stat-value" style={{color:'#d97706'}}>{sos.filter(s=>s.status==='waiting_art').length}</div></div><div className="stat-card"><div className="stat-label">In Production</div><div className="stat-value" style={{color:'#2563eb'}}>{sos.filter(s=>s.status==='in_production').length}</div></div><div className="stat-card"><div className="stat-label">Ready to Ship</div><div className="stat-value" style={{color:'#166534'}}>{sos.filter(s=>s.status==='ready_ship').length}</div></div></div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>SO</th><th>Customer</th><th>Memo</th><th>Expected</th><th>Firm Dates</th><th>Status</th><th>Created</th></tr></thead><tbody>
    {sos.map(so=>{const c=cust.find(x=>x.id===so.customer_id);return(<tr key={so.id} style={{cursor:'pointer'}} onClick={()=>setSelSO(so)}>
      <td style={{fontWeight:700,color:'#1e40af'}}>{so.id}</td><td>{c?.name} <span className="badge badge-gray">{c?.alpha_tag}</span></td><td style={{fontSize:12}}>{so.memo}</td><td>{so.expected_date||'--'}</td>
      <td>{so.firm_dates?.length?so.firm_dates.map((f,i)=><div key={i} style={{fontSize:11}}><span className={`badge ${f.approved?'badge-green':'badge-amber'}`}>{f.date}</span> {f.item_desc}</div>):'--'}</td>
      <td><span className={`badge ${so.status==='waiting_art'?'badge-amber':so.status==='in_production'?'badge-blue':so.status==='ready_ship'?'badge-green':'badge-gray'}`}>{so.status.replace(/_/g,' ')}</span></td>
      <td style={{fontSize:11,color:'#94a3b8'}}>{REPS.find(r=>r.id===so.created_by)?.name}<br/>{so.created_at}</td></tr>)})}
    </tbody></table></div></div></>);
  };

  // CUSTOMERS
  const rCust=()=>{
    if(selC)return<CustDetail customer={selC} allCustomers={cust} allOrders={aO} onBack={()=>setSelC(null)} onEdit={c=>setCM({open:true,c})} onSelCust={c=>setSelC(c)} onNewEst={c=>newE(c)}/>;
    const f=pars.filter(p=>{if(rF!=='all'&&p.primary_rep_id!==rF)return false;if(q){const s=q.toLowerCase();return p.name.toLowerCase().includes(s)||p.alpha_tag?.toLowerCase().includes(s)||gK(p.id).some(c=>c.name.toLowerCase().includes(s))}return true});
    return(<><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}><div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search customers..." value={q} onChange={e=>setQ(e.target.value)}/></div>
      <select className="form-select" style={{width:160}} value={rF} onChange={e=>setRF(e.target.value)}><option value="all">All Reps</option>{REPS.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button className="btn btn-primary" onClick={()=>setCM({open:true,c:null})}><Icon name="plus" size={14}/> New Customer</button></div>
    {f.map(p=>{const kids=gK(p.id);const bal=kids.reduce((a,c)=>a+(c._open_balance||0),p._open_balance||0);
      const est=kids.reduce((a,c)=>a+(c._open_estimates||0),p._open_estimates||0);const so=kids.reduce((a,c)=>a+(c._open_sos||0),p._open_sos||0);
      return(<div key={p.id} className="card" style={{marginBottom:10}}>
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:36,height:36,borderRadius:8,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}} onClick={()=>setSelC(p)}><Icon name="building" size={18}/></div>
          <div style={{flex:1,cursor:'pointer'}} onClick={()=>setSelC(p)}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:15,fontWeight:700}}>{p.name}</span><span className="badge badge-blue">{p.alpha_tag}</span><span className="badge badge-green">Tier {p.adidas_ua_tier}</span>
              {est>0&&<span className="badge badge-amber">{est} est</span>}{so>0&&<span className="badge badge-blue">{so} SO</span>}</div>
            <div style={{fontSize:12,color:'#94a3b8'}}>{(p.contacts||[])[0]?.name&&`${p.contacts[0].name} · `}{p.billing_city&&`${p.billing_city}, ${p.billing_state}`}<span style={{marginLeft:8,fontSize:11}}>Rep: {REPS.find(r=>r.id===p.primary_rep_id)?.name}</span></div></div>
          {bal>0&&<div style={{textAlign:'right',marginRight:8}}><div style={{fontSize:10,color:'#dc2626',fontWeight:600}}>BAL</div><div style={{fontSize:16,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div></div>}
          <button className="btn btn-sm btn-secondary" title="Estimate" onClick={e=>{e.stopPropagation();newE(p)}}><Icon name="file" size={12}/></button>
          <button className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();setCM({open:true,c:p})}}><Icon name="edit" size={12}/></button>
        </div>
        {kids.length>0&&<div style={{borderTop:'1px solid #f1f5f9'}}>{kids.map(ch=><div key={ch.id} style={{padding:'8px 16px 8px 64px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid #f8fafc',cursor:'pointer'}} onClick={()=>setSelC(ch)}>
          <span style={{color:'#cbd5e1'}}>|_</span><span style={{fontSize:13,fontWeight:600}}>{ch.name}</span><span className="badge badge-gray">{ch.alpha_tag}</span><div style={{flex:1}}/>
          {(ch._open_balance||0)>0&&<span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>${ch._open_balance.toLocaleString()}</span>}
        </div>)}</div>}
      </div>)})}
    </>);
  };

  // VENDORS
  const rVend=()=>{if(selV)return<VendDetail vendor={selV} onBack={()=>setSelV(null)}/>;
    return(<><div className="stats-row"><div className="stat-card"><div className="stat-label">Vendors</div><div className="stat-value">{vend.length}</div></div><div className="stat-card"><div className="stat-label">API</div><div className="stat-value">{vend.filter(v=>v.vendor_type==='api').length}</div></div>
      {isA&&<div className="stat-card"><div className="stat-label">Open AP</div><div className="stat-value" style={{color:'#dc2626'}}>${vend.reduce((a,v)=>a+(v._invoice_total||0),0).toLocaleString()}</div></div>}
      {isA&&<div className="stat-card"><div className="stat-label">60d+</div><div className="stat-value" style={{color:'#d97706'}}>${vend.reduce((a,v)=>a+(v._aging_60||0)+(v._aging_90||0),0).toLocaleString()}</div></div>}</div>
    <div className="card"><div className="card-body" style={{padding:0}}><table><thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>Terms</th><th>NSA Stock</th>{isA&&<th>Owed</th>}{isA&&<th>Aging</th>}<th>Status</th></tr></thead><tbody>
    {vend.map(v=><tr key={v.id} style={{cursor:'pointer'}} onClick={()=>setSelV(v)}>
      <td style={{fontWeight:700,fontSize:14,color:'#1e40af'}}>{v.name}</td><td><span className={`badge ${v.vendor_type==='api'?'badge-purple':'badge-gray'}`}>{v.vendor_type==='api'?'API':'Upload'}</span></td>
      <td style={{fontSize:11}}>{v.contact_email}</td><td><span className="badge badge-gray">{v.payment_terms?.replace('net','Net ')}</span></td>
      <td>{v.nsa_carries_inventory?<span className="badge badge-green">Yes</span>:'--'}</td>
      {isA&&<td style={{fontWeight:700,color:(v._invoice_total||0)>0?'#dc2626':''}}>{(v._invoice_total||0)>0?'$'+v._invoice_total.toLocaleString():'--'}</td>}
      {isA&&<td style={{fontSize:11}}>{(v._invoice_total||0)>0?<>{(v._aging_30||0)>0&&<span style={{color:'#d97706'}}>30d:${v._aging_30.toLocaleString()} </span>}{(v._aging_60||0)>0&&<span style={{color:'#dc2626'}}>60d:${v._aging_60.toLocaleString()}</span>}</>:'--'}</td>}
      <td><span className="badge badge-green">Active</span></td></tr>)}</tbody></table></div></div></>);
  };

  // PRODUCTS
  const rProd=()=>(<><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
    <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search SKU, name, brand, color..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}><input type="checkbox" checked={pF.stk==='instock'} onChange={e=>setPF(f=>({...f,stk:e.target.checked?'instock':'all'}))}/> In Stock</label>
    <select className="form-select" style={{width:120}} value={pF.cat} onChange={e=>setPF(f=>({...f,cat:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
    <select className="form-select" style={{width:120}} value={pF.vnd} onChange={e=>setPF(f=>({...f,vnd:e.target.value}))}><option value="all">Vendor</option>{vend.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
    <select className="form-select" style={{width:140}} value={pF.clr} onChange={e=>setPF(f=>({...f,clr:e.target.value}))}><option value="all">Color</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
  <div className="card"><div className="card-body" style={{padding:0}}>
  {fP.map(p=>{const nsaT=Object.values(p._inv||{}).reduce((a,v)=>a+v,0);const au=p.brand==='Adidas'||p.brand==='Under Armour';
    return(<div key={p.id} style={{padding:'14px 16px',borderBottom:'1px solid #f1f5f9'}}><div style={{display:'flex',gap:14,alignItems:'flex-start'}}>
      <div style={{width:56,height:56,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>&#128085;</div>
      <div style={{flex:1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontFamily:'monospace',fontWeight:800,background:'#dbeafe',padding:'2px 8px',borderRadius:3,color:'#1e40af'}}>{p.sku}</span><span style={{fontWeight:700}}>{p.name}</span><span className="badge badge-gray">{p.category}</span>{p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} colors</span>}</div>
        <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}><span className="badge badge-blue" style={{marginRight:6}}>{p.brand}</span>{p.color} | Cost: ${p.nsa_cost?.toFixed(2)} | Sell: {au?'Tier':'$'+roundQ(p.nsa_cost*1.65).toFixed(2)}</div>
        <div style={{display:'flex',gap:2,marginTop:8,flexWrap:'wrap',alignItems:'center'}}>
          {p.available_sizes.filter(sz=>showSz(sz,p._inv?.[sz])).map(sz=>{const v=p._inv?.[sz]||0;const al2=p._alerts?.[sz];return<div key={sz} className={`size-cell ${v>10?'in-stock':v>0?(al2&&v<al2?'alert-stock':'low-stock'):'no-stock'}`}><div className="size-label">{sz}</div><div className="size-qty">{v}</div></div>})}
          <div className="size-cell total"><div className="size-label">TOT</div><div className="size-qty">{nsaT}</div></div>
        </div></div></div></div>)})}
  {fP.length===0&&<div className="empty">No products found</div>}</div></div></>);

  // INVENTORY
  const rInv=()=>(<><div className="stats-row">
    <div className="stat-card"><div className="stat-label">Units</div><div className="stat-value">{tU}</div></div>
    <div className="stat-card"><div className="stat-label">Value</div><div className="stat-value">${tV.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
    <div className="stat-card"><div className="stat-label">Products</div><div className="stat-value">{iD.length}</div></div>
    {isA&&<div className="stat-card" style={al.length>0?{borderColor:'#fbbf24'}:{}}><div className="stat-label">Alerts</div><div className="stat-value" style={{color:al.length>0?'#d97706':''}}>{al.length}</div></div>}
  </div>
  <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
    <div className="search-bar" style={{flex:1,minWidth:200}}><Icon name="search"/><input placeholder="Search inventory..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <select className="form-select" style={{width:120}} value={iF.cat} onChange={e=>setIF(f=>({...f,cat:e.target.value}))}><option value="all">Category</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
    <select className="form-select" style={{width:120}} value={iF.vnd} onChange={e=>setIF(f=>({...f,vnd:e.target.value}))}><option value="all">Vendor</option>{vend.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
  </div>
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
    <td><div style={{display:'flex',gap:2}}>{p.available_sizes.filter(sz=>showSz(sz,p._inv?.[sz])).map(sz=>{const v=p._inv?.[sz]||0;return<div key={sz} className={`size-cell ${v>10?'in-stock':v>0?'low-stock':'no-stock'}`} style={{minWidth:32,padding:'1px 4px'}}><div className="size-label" style={{fontSize:8}}>{sz}</div><div className="size-qty" style={{fontSize:12}}>{v}</div></div>})}</div></td>
    <td style={{fontWeight:800,fontSize:16,color:p._tQ<=10?'#d97706':'#166534'}}>{p._tQ}</td>
    <td style={{fontWeight:700}}>${p._tV.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    <td><div style={{display:'flex',gap:4}}>
      <button className="btn btn-sm btn-secondary" onClick={()=>nf('PO (Phase 4)')}>+PO</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>newE(null)}>+EST</button>
      {isA&&<button className="btn btn-sm btn-secondary" onClick={()=>setAM({open:true,p})}><Icon name="edit" size={10}/> INV</button>}
    </div></td>
  </tr>)}</tbody></table></div></div></>);

  // NAV & LAYOUT
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
        return<button key={item.id} className={`sidebar-link ${pg===item.id?'active':''}`} disabled={item.disabled} style={item.disabled?{opacity:0.3,cursor:'not-allowed'}:{}}
          onClick={()=>{if(!item.disabled){setPg(item.id);setQ('');setSelC(null);setSelV(null);setEEst(null);setSelSO(null)}}}><Icon name={item.icon}/>{item.label}</button>})}</nav>
      <div className="sidebar-user"><div style={{fontWeight:600,color:'#e2e8f0'}}>{cu.name}</div><div>{cu.role}</div></div>
    </div>
    <div className="main">
      <div className="topbar"><h1>{eEst?eEst.id:selSO?selSO.id:selC?selC.name:selV?selV.name:(titles[pg]||'Dashboard')}</h1><div style={{fontSize:12,color:'#94a3b8'}}>Phase 2 v3</div></div>
      <div className="content">
        {pg==='dashboard'&&rDash()}{pg==='estimates'&&rEst()}{pg==='orders'&&rSO()}{pg==='customers'&&rCust()}{pg==='vendors'&&rVend()}{pg==='products'&&rProd()}{pg==='inventory'&&rInv()}
      </div>
    </div>
    <CustModal isOpen={cM.open} onClose={()=>setCM({open:false,c:null})} onSave={savC} customer={cM.c} parents={pars}/>
    <AdjModal isOpen={aM.open} onClose={()=>setAM({open:false,p:null})} product={aM.p} onSave={savI}/>
  </div>);
}
