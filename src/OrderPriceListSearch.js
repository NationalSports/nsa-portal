import React,{useEffect,useState} from 'react';
import {priceListCall,openPriceList} from './lib/vendorPriceLists';
import {priceListOrderCandidates} from './lib/priceListOrderItem';
import './VendorPriceLists.css';

export default function OrderPriceListSearch({query,onSelect}){
  const [state,setState]=useState({query:'',loading:false,result:null,error:''});
  useEffect(()=>{
    let active=true;const text=query.trim();
    if(text.length<2){setState({query:text,loading:false,result:null,error:''});return;}
    setState({query:text,loading:true,result:null,error:''});
    const timer=setTimeout(()=>priceListCall('search',{query:text}).then(result=>{if(active)setState({query:text,loading:false,result,error:''});}).catch(error=>{if(active)setState({query:text,loading:false,result:null,error:error.message});}),350);
    return()=>{active=false;clearTimeout(timer);};
  },[query]);
  if(query.trim().length<2)return null;
  const current=state.query===query.trim();
  const rows=current&&state.result?priceListOrderCandidates(state.result,state.query):[];
  return <section className="vpl-order-search" aria-label="Vendor price list items"><h4>Vendor price lists <span>Use on this order without adding to the catalog</span></h4>
    {(!current||state.loading)&&<p role="status">Searching price lists…</p>}
    {current&&state.error&&<p role="alert">Price-list search unavailable: {state.error}</p>}
    {current&&!state.loading&&!state.error&&!rows.length&&<p>No matching item rows found. For PDF or unusual price lists, use the vendor’s Price lists search and enter a Custom Item.</p>}
    {rows.map(row=><div key={row.key} className="vpl-order-row"><div><strong>{row.sku}</strong><div>{row.name}</div><small>{row.vendor_name} · {row.file_name} · row {row.row}</small></div><div><strong>{row.cost!==null?`$${row.cost.toFixed(2)}`:'Review cost'}</strong><small>{row.priceLabel} in source</small></div><button type="button" className="btn btn-secondary" onClick={()=>openPriceList(row.document_id).catch(error=>setState(s=>({...s,error:error.message})))}>Source</button><button type="button" className="btn btn-primary" onClick={()=>onSelect(row)}>Use item</button></div>)}
    {state.result?.limited&&<p>Showing the first 20 source sections. Refine the SKU or keywords for more precise results.</p>}
  </section>;
}
