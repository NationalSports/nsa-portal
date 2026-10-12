const {getSupabaseAdmin,corsHeaders}=require('./_shared');
const {authorizeCoachPortal}=require('./_coachPortalAuth');
const response=(statusCode,data)=>({statusCode,headers:{...corsHeaders(),'Cache-Control':'no-store'},body:JSON.stringify(data)});
// Never publish internal cost, staff commentary, privileged identities or production files.
const privateKey=/cost|margin|profit|commission|auth_id|password|secret|internal|private|prod_files|^notes$|^created_by$|^updated_by$|^api_/i;
function publicRow(value){
 if(Array.isArray(value))return value.map(publicRow);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey.test(key)).map(([key,v])=>[key,publicRow(v)]));
}
async function rows(admin,table,key,ids,select='*'){
 if(!ids.length)return [];
 const result=[];
 for(let offset=0;offset<20000;offset+=500){
  const {data,error}=await admin.from(table).select(select).in(key,ids).order('id').range(offset,offset+499);
  if(error)throw new Error('Could not load '+table);
  result.push(...(data||[]));if((data||[]).length<500)return result.map(publicRow);
 }
 throw new Error('Portal data exceeds the supported limit. Contact your rep.');
}
exports.publicRow=publicRow;
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return response(204,{});
 if(event.httpMethod!=='POST')return response(405,{error:'Method not allowed'});
 let body;try{body=JSON.parse(event.body||'{}');}catch{return response(400,{error:'Invalid JSON'});}
 const tag=String(body.alpha_tag||'').trim();if(!tag||tag.length>200)return response(400,{error:'Portal code required'});
 try{
  const admin=getSupabaseAdmin(),auth=await authorizeCoachPortal(event,admin,tag);
  if(!auth.ok)return response(auth.status,{error:auth.error});
  const ids=[...auth.fam],tables={};
  const customers=await rows(admin,'customers','id',ids,'id,name,alpha_tag,parent_id,primary_rep_id,billing_address_line1,billing_address_line2,billing_city,billing_state,billing_zip,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_zip,adidas_ua_tier,catalog_markup,payment_terms,tax_rate,is_active,tax_exempt,disable_cc_pay,school_colors,shipping_attention,allowed_brands,coach_ai_builder,coach_livelook,coach_build_orders,coach_roster,teamshop_po_allowed,uniform_discount_percent,coach_stock,logo_url,art_files,pantone_colors,thread_colors');
  // The customer columns below are intentionally selected from the stable schema only.
  tables.customers=customers;
  await Promise.all(['sales_orders','estimates','invoices','customer_contacts','customer_promo_programs','customer_promo_periods','customer_credits','customer_pending_shipping'].map(async table=>{tables[table]=await rows(admin,table,'customer_id',ids);}));
  const soIds=tables.sales_orders.map(r=>r.id),estIds=tables.estimates.map(r=>r.id),invIds=tables.invoices.map(r=>r.id);
  await Promise.all(['so_items','so_art_files','so_firm_dates','so_jobs'].map(async table=>{tables[table]=await rows(admin,table,'so_id',soIds);}));
  await Promise.all(['estimate_items','estimate_art_files'].map(async table=>{tables[table]=await rows(admin,table,'estimate_id',estIds);}));
  await Promise.all(['invoice_items','invoice_payments','invoice_credit_memos'].map(async table=>{tables[table]=await rows(admin,table,'invoice_id',invIds);}));
  tables.so_item_decorations=await rows(admin,'so_item_decorations','so_item_id',tables.so_items.map(r=>r.id));
  tables.estimate_item_decorations=await rows(admin,'estimate_item_decorations','estimate_item_id',tables.estimate_items.map(r=>r.id));
  for(const [table,key,source] of [['customer_promo_usage','period_id','customer_promo_periods'],['customer_credit_usage','credit_id','customer_credits'],['customer_pending_shipping_usage','pending_id','customer_pending_shipping']])tables[table]=await rows(admin,table,key,tables[source].map(r=>r.id));
  tables.products=await rows(admin,'products','id',[...new Set([...tables.so_items,...tables.estimate_items].map(r=>r.product_id).filter(Boolean))],'id,sku,name,brand,color,image_front_url,image_back_url,image_flat_front_url,image_flat_back_url');
  tables.team_members=await rows(admin,'team_members','id',[...new Set(customers.map(c=>c.primary_rep_id).filter(Boolean))],'id,name,email,phone');
  const root=customers.find(c=>String(c.alpha_tag||'').trim().toLowerCase()===tag.toLowerCase())||customers[0];
  return response(200,{tables,customer_id:root.id});
 }catch(e){console.error('[coach-portal-data]',e.message);return response(503,{error:'Your portal could not be loaded. Please try again or contact your rep.'});}
};
