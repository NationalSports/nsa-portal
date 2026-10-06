import {_loadArtRow} from '../constants';

// Read only this document, paging every child collection. A partial/denied read
// must never become a supposedly complete comparison or deletion authority.
export async function loadRecoveryDocument(client,table,id) {
  if(!client||!['estimates','sales_orders'].includes(table))throw new Error('Open this record to review its recovery copy.');
  const estimate=table==='estimates',prefix=estimate?'estimate':'so',parentKey=estimate?'estimate_id':'so_id',itemKey=prefix+'_item_id';
  const tokenName=estimate?'estimate_save_token':'sales_order_save_token';
  const args=estimate?{p_estimate_id:id}:{p_so_id:id};
  const token=async()=>{
    const result=await client.rpc(tokenName,args);
    if(result.error||typeof result.data!=='string')throw new Error('Could not verify the saved document. Your draft is kept.');
    return result.data;
  };
  const before=await token();
  const parent=await client.from(table).select('*').eq('id',id).maybeSingle();
  if(parent.error||!parent.data)throw new Error('Could not load the saved document. It may be deleted or unavailable. Your draft is kept.');
  const rows=async(name,key,value,multiple=false)=>{
    const all=[];
    for(let offset=0;offset<10000;offset+=500){
      let request=client.from(name).select('*').order('id');
      request=multiple?request.in(key,value):request.eq(key,value);
      const result=await request.range(offset,offset+499);
      if(result.error||!Array.isArray(result.data))throw new Error('Could not load all saved document details. Retry review when connected.');
      all.push(...result.data);
      if(result.data.length<500)return all;
    }
    throw new Error('This document is too large to compare safely. Your draft is kept.');
  };
  const [rawItems,rawArt,rawJobs,rawFirm]=await Promise.all([
    rows(prefix+'_items',parentKey,id),rows(prefix+'_art_files',parentKey,id),
    estimate?[]:rows('so_jobs',parentKey,id),estimate?[]:rows('so_firm_dates',parentKey,id),
  ]);
  const children=async name=>{
    const result=[];
    for(let offset=0;offset<rawItems.length;offset+=100)result.push(...await rows(name,itemKey,rawItems.slice(offset,offset+100).map(item=>item.id),true));
    return result;
  };
  const [decos,picks,pos]=await Promise.all([
    children(prefix+'_item_decorations'),estimate?[]:children('so_item_pick_lines'),estimate?[]:children('so_item_po_lines'),
  ]);
  if(new Set(rawItems.map(item=>item.item_index)).size!==rawItems.length)throw new Error('Saved item positions are duplicated. Your draft is kept for support review.');
  const unpack=(row,key)=>{const {[key]:parent,id:dbId,...rest}=row;return rest;};
  const items=rawItems.sort((a,b)=>a.item_index-b.item_index).map(raw=>{
    const {item_index,...item}=unpack(raw,parentKey);
    const decorations=decos.filter(row=>row[itemKey]===raw.id).sort((a,b)=>a.deco_index-b.deco_index).map(row=>{
      const {deco_index,...rest}=unpack(row,itemKey);
      if(!rest.art_file_id&&rest.art_tbd_type)rest.art_file_id='__tbd';
      return rest;
    });
    if(estimate)return {...item,decorations};
    const pick_lines=picks.filter(row=>row[itemKey]===raw.id).map(row=>{
      const {sizes,...rest}=unpack(row,itemKey);return {_sku:item.sku,...rest,...(sizes||{})};
    });
    const po_lines=pos.filter(row=>row[itemKey]===raw.id).map(row=>{
      const {sizes,...rest}=unpack(row,itemKey);const value={...rest,...(sizes||{})};
      if(sizes?._billed&&!value.billed){value.billed=sizes._billed;delete value._billed;}
      if(sizes?._tracking_numbers&&!value.tracking_numbers){value.tracking_numbers=sizes._tracking_numbers;delete value._tracking_numbers;}
      return value;
    });
    return {...item,sizes:item.sizes||{},decorations,pick_lines,po_lines};
  });
  const after=await token();
  if(before!==after)throw new Error('The saved document changed during review. Load the comparison again.');
  const row={...parent.data,items,art_files:rawArt.map(_loadArtRow),_recoveryHydrated:true,_itemsHydrated:true,_decosHydrated:true,_artHydrated:true,_hydratedArtIds:rawArt.map(art=>art.id)};
  if(!estimate)Object.assign(row,{
    jobs:rawJobs.map(({so_id,...job})=>job),firm_dates:rawFirm.map(({item_desc,date,approved})=>({item_desc,date,approved})),
    _jobsHydrated:true,_posHydrated:true,_picksHydrated:true,
    _hydratedPoIds:[...new Set(items.flatMap(item=>item.po_lines.map(line=>line.po_id).filter(Boolean)))],
    _hydratedPickIds:[...new Set(items.flatMap(item=>item.pick_lines.map(line=>line.pick_id).filter(Boolean)))],
  });
  return {row,token:after};
}
