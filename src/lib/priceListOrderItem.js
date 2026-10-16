import {priceListTable} from './priceListTable';

export function priceListOrderCandidates(result,query) {
  const found=[],seen=new Set();
  for(const match of result.matches||[]){
    const table=priceListTable(match.content,query);
    if(!table||!table.matched||!match.vendor_id)continue;
    const one=re=>{const cols=table.columns.filter(c=>re.test(c.label));return cols.length===1?cols[0]:null;};
    const sku=one(/^(sku|item|item #|item number|style|style #|product code)$/i);
    const name=one(/^(description|product description|item description|name|product name)$/i);
    const cost=one(/^(cost|unit cost|dealer cost|wholesale|net cost)$/i)||one(/^price$/i);
    if(!sku||!name)continue;
    for(const row of table.rows){
      if(!row.cells[sku.index]||!row.cells[name.index])continue;
      const key=`${match.document_id}:${match.location}:${row.number}`;
      if(seen.has(key))continue;seen.add(key);
      const value=cost?row.cells[cost.index]:'';
      // Only plain decimal / US-dollar values can prefill the portal's dollar cost.
      const amount=/^(?:USD\s*|\$\s*)?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)?Number(value.replace(/USD|\$|,|\s/g,'')):null;
      found.push({key,sku:row.cells[sku.index],name:row.cells[name.index],vendor_id:match.vendor_id,vendor_name:match.vendor_name,cost:amount>0?amount:null,priceLabel:cost?.label||'Unspecified',sourceValue:value,document_id:match.document_id,file_name:match.file_name,location:match.location,row:row.number});
    }
  }
  return found;
}
export function priceListCustomDraft(candidate,markup=1.65){
  const cost=candidate.cost||0;
  return {vendor_id:candidate.vendor_id,sku:candidate.sku,name:candidate.name,brand:candidate.vendor_name,color:'',nsa_cost:cost,unit_sell:Math.round(cost*markup*100)/100,retail_price:0,saveToCatalog:false,image_url:'',images:[],item_type:'osfa',priceListSource:candidate};
}
export function priceListLineFields(draft){
  const source=draft.priceListSource;
  if(!source)return {};
  return {qty_only:true,est_qty:1,available_sizes:[],no_deco:true,notes:`Price list: ${source.file_name} · ${source.location} · row ${source.row}. Source ${source.priceLabel}: ${source.sourceValue||'unspecified'}. Cost reviewed at entry.`};
}
