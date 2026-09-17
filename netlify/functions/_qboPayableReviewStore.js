const prefixForRealm=realm=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify([String(realm)]).slice(0,-1)+',');

async function page(queryFactory,limit=20000,size=1000){const out=[];for(let from=0;from<limit;from+=size){const{data,error}=await queryFactory(from,from+size-1);if(error)throw new Error('snapshot_failed');out.push(...(data||[]));if(!data||data.length<size)return out}throw new Error('snapshot_limit')}

function payableReviewStore(admin,realm){return{
  async claim(row){const{error}=await admin.from('qbo_payable_review_runs').insert(row);if(error?.code==='23505')return false;if(error)throw new Error('run_claim_failed');return true},
  async snapshot(){
    const ledger=await page((from,to)=>admin.from('applied_bills').select('*').eq('status','pushed').eq('portal_status','success').order('applied_at',{ascending:false}).order('id',{ascending:false}).range(from,to));
    const portalVendors=await page((from,to)=>admin.from('vendors').select('id,name,is_active').order('id',{ascending:true}).range(from,to));
    const prefix=prefixForRealm(realm); const receipts=await page((from,to)=>admin.from('app_state').select('id,value').gte('id',prefix).lt('id',prefix+'\uffff').order('id',{ascending:true}).range(from,to));
    const vendorLinks={};for(const item of receipts){try{const row=typeof item.value==='string'?JSON.parse(item.value):item.value;if(row?.map_key==='vendorQBMap'&&row.active!==false&&row.source_id&&row.qbo_id)vendorLinks[row.source_id]=String(row.qbo_id)}catch{}}
    return {ledger,portalVendors,vendorLinks};
  },
  async finish(id,row){const{data,error}=await admin.from('qbo_payable_review_runs').update(row).eq('id',id).eq('status','running').select('id');if(error||data?.length!==1)throw new Error('run_finish_failed')},
}}
module.exports={payableReviewStore,prefixForRealm};
