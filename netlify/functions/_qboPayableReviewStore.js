const prefixForRealm=realm=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify([String(realm)]).slice(0,-1)+',');

async function page(queryFactory,limit=20000,size=1000){const out=[];for(let from=0;from<limit;from+=size){const{data,error}=await queryFactory(from,from+size-1);if(error)throw new Error('snapshot_failed');out.push(...(data||[]));if(!data||data.length<size)return out}throw new Error('snapshot_limit')}

const parseValue=value=>{try{return typeof value==='string'?JSON.parse(value):value}catch{return null}};

function payableReviewStore(admin,realm){return{
  async claim(row){const{error}=await admin.from('qbo_payable_review_runs').insert(row);if(error?.code==='23505')return false;if(error)throw new Error('run_claim_failed');return true},
  async snapshot(){
    const prefix=prefixForRealm(realm);
    const [ledger,portalVendors,products,salesOrders,soItems,poLines,receipts,configResult]=await Promise.all([
      page((from,to)=>admin.from('applied_bills').select('*').eq('status','pushed').eq('portal_status','success').order('applied_at',{ascending:false}).order('id',{ascending:false}).range(from,to)),
      page((from,to)=>admin.from('vendors').select('id,name,is_active').order('id',{ascending:true}).range(from,to)),
      page((from,to)=>admin.from('products').select('id,sku').order('id',{ascending:true}).range(from,to),50000),
      page((from,to)=>admin.from('sales_orders').select('*').is('deleted_at',null).order('id',{ascending:true}).range(from,to),50000),
      page((from,to)=>admin.from('so_items').select('id,so_id,product_id,sku,name,brand,nsa_cost').order('id',{ascending:true}).range(from,to),50000),
      page((from,to)=>admin.from('so_item_po_lines').select('*').order('id',{ascending:true}).range(from,to),50000),
      page((from,to)=>admin.from('app_state').select('id,value').gte('id',prefix).lt('id',prefix+'\uffff').order('id',{ascending:true}).range(from,to),50000),
      admin.from('app_state').select('value').eq('id','qb_config').maybeSingle(),
    ]);
    if(configResult.error)throw new Error('snapshot_failed');
    const links={vendorQBMap:{},prodQBMap:{},qbPOMap:{},qbPOBillMap:{},qbPaymentMap:{}};
    for(const item of receipts){const row=parseValue(item.value);if(!row||row.active===false||!links[row.map_key]||!row.source_id||!row.qbo_id)continue;links[row.map_key][row.source_id]=String(row.qbo_id)}
    const qbConfig=parseValue(configResult.data?.value)||{};
    return {ledger,portalVendors,products,salesOrders,soItems,poLines,links,qbConfig};
  },
  async finish(id,row){const{data,error}=await admin.from('qbo_payable_review_runs').update(row).eq('id',id).eq('status','running').select('id');if(error||data?.length!==1)throw new Error('run_finish_failed')},
}}
module.exports={payableReviewStore,prefixForRealm,parseValue};
