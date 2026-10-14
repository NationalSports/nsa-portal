import React, {useState} from 'react';
import {supabase} from '../lib/supabase';
import {uploadProductionArtwork} from './productionArtwork';
import {useArtCodes} from '../lib/artIds';
import {colorKey,variantCode,validProductionFile,webLogos,isAtOnceStore,artworkSetup,sameFile} from './atOnceArtwork.shared';

export default function AtOnceArtVariants({store,catalog=[],stockByWp={},artwork=[],transfers=[],onSaved}) {
  const [editing,setEditing]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [codesVersion,setCodesVersion]=useState(0);
  const ownerOf=art=>art._srcCustId || store?.customer_id;
  const codes=useArtCodes(supabase,isAtOnceStore(store)?[store.customer_id,...artwork.map(a=>a._srcCustId)]:[],codesVersion);
  if (!isAtOnceStore(store)) return null;
  const folders = new Map(artwork.map(a=>[a.id,a]));
  const needs = new Map();
  for (const item of catalog) for (const d of item.decorations || []) {
    const art=folders.get(d.art_id || d.art_file_id); if (!art) continue;
    const stock=transfers.find(t=>t.code===d.transfer_code) || transfers.find(t=>t.code===`store-art-${encodeURIComponent(art.id)}`);
    if ((stock?.decoration_type || d.deco_type || d.type || art.deco_type)!=='dtf') continue;
    const color=stockByWp[item.id]?.color || item.color || '';
    needs.set(`${art.id}:${colorKey(color)}`,{art,color});
  }
  const edit = ({art,color}) => {
    const previous=(art.dtf_variants || []).find(v=>colorKey(v.garment_color)===colorKey(color));
    setError(''); setEditing({art,color,web_logo_url:previous?.web_logo_url || '',knockout_color:previous?.knockout_color || (['black','white'].includes(colorKey(color))?colorKey(color):''),width_in:previous?.width_in || '',height_in:previous?.height_in || '',production_file:previous?.production_file || null,file:null,reviewed:false});
  };
  const change=(key,value)=>setEditing(x=>({...x,[key]:value,...(key==='production_file'?{file:null}:{}),reviewed:key==='reviewed'?value:false}));
  const save=async()=>{
    const e=editing;
    if (!e.color || !e.web_logo_url || !e.knockout_color.trim() || !(Number(e.width_in)>0) || !(Number(e.height_in)>0) || !e.reviewed) return setError('Choose the matching Weblogo, knockout treatment and dimensions, then confirm the artwork review.');
    setBusy(true);setError('');
    try {
      const file=e.file?await uploadProductionArtwork(e.file):e.production_file;
      if (!validProductionFile(file)) throw new Error('Upload the exact print-ready .ai variant or choose a saved production file.');
      const customerId=e.art._srcCustId || store.customer_id;
      const read=await supabase.from('customers').select('art_files').eq('id',customerId).single();
      if(read.error) throw read.error;
      const arts=read.data.art_files || [], current=arts.find(a=>a.id===e.art.id);
      if(!current) throw new Error('Save this logo in the customer art folder first.');
      if(!webLogos(current).some(w=>w.url===e.web_logo_url)) throw new Error('The selected Weblogo changed. Refresh the art folder before saving.');
      const previous=(current.dtf_variants || []).find(v=>colorKey(v.garment_color)===colorKey(e.color));
      const reuse=previous && sameFile(previous.production_file,file) && previous.web_logo_url===e.web_logo_url && previous.knockout_color===e.knockout_color.trim() && Number(previous.width_in)===Number(e.width_in) && Number(previous.height_in)===Number(e.height_in);
      const variant={id:reuse?previous.id:crypto.randomUUID(),garment_color:e.color,web_logo_url:e.web_logo_url,knockout_color:e.knockout_color.trim(),width_in:Number(e.width_in),height_in:Number(e.height_in),production_file:file,reviewed:true};
      const code=variantCode(current.id,variant);
      // New revisions receive a new stock code: existing paid orders retain their old file/stock.
      const inventory={store_id:store.id,kind:'design',code,image_url:e.web_logo_url,label:`${current.name} · ${e.color} · DTF (${variant.knockout_color})`,decoration_type:'dtf',application_method:'heat_press',on_hand:0,low_stock_threshold:10,width_in:variant.width_in,height_in:variant.height_in,production_file:{...file,at_once_variant:{id:variant.id,art_id:current.id,garment_color:e.color,knockout_color:variant.knockout_color,web_logo_url:e.web_logo_url}},artwork_version:variant.id,application_instructions:`Garment: ${e.color}. Knockout: ${variant.knockout_color}.`};
      const existing = await supabase.from('webstore_transfers').select('*').eq('store_id',store.id).eq('code',code).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && (existing.data.decoration_type!=='dtf' || !sameFile(existing.data.production_file,file) || Number(existing.data.width_in)!==variant.width_in || Number(existing.data.height_in)!==variant.height_in)) throw new Error('This inventory version has different production details. Correct its inventory record before linking garments.');
      const insert=existing.data?{error:null}:await supabase.from('webstore_transfers').insert(inventory);
      if(insert.error) throw insert.error;
      const next=arts.map(a=>a.id===current.id?{...a,dtf_variants:[...(a.dtf_variants || []).filter(v=>colorKey(v.garment_color)!==colorKey(e.color)),variant],prod_files:[...(a.prod_files || []).filter(f=>!sameFile(f,file)),file]}:a);
      const updated=await supabase.from('customers').update({art_files:next}).eq('id',customerId).eq('art_files',JSON.stringify(arts)).select('id');
      if(updated.error || !updated.data?.length) throw new Error('Art folder changed while saving. Refresh and retry; the unused zero-stock record is not assigned to orders.');
      const nextArt=artwork.filter(a=>a.id!==current.id).concat(next.find(a=>a.id===current.id));
      for(const row of catalog.filter(row=>colorKey(stockByWp[row.id]?.color || row.color)===colorKey(e.color) && (row.decorations || []).some(d=>(d.art_id || d.art_file_id)===current.id && (transfers.find(t=>t.code===d.transfer_code)?.decoration_type || transfers.find(t=>t.code===`store-art-${encodeURIComponent(current.id)}`)?.decoration_type || d.deco_type || d.type || current.deco_type)==='dtf'))) {
        const resolved=artworkSetup({...row,color:e.color},[...transfers.filter(t=>t.code!==code),inventory],nextArt).item;
        const saved=await supabase.from('webstore_products').update({decorations:resolved.decorations,transfer_codes:resolved.transfer_codes,transfer_code:null,image_url:stockByWp[row.id]?.image_front_url || null,image_back_url:stockByWp[row.id]?.image_back_url || null,production_approved_at:null,production_approved_by:null}).eq('id',row.id).eq('store_id',store.id).select('id');
        if(saved.error || !saved.data?.length) throw new Error('Art and inventory saved, but the garment link could not be updated. Refresh and save this version again.');
      }
      // Number the new version now so staff see the same Art ID the supplier will.
      // Best effort: the DTF order assigns it again (idempotently) before sending.
      try { if (typeof supabase.rpc==='function') await supabase.rpc('assign_art_code',{p_customer_id:customerId,p_art_id:current.id,p_variant_key:e.color,p_revision_key:variant.id}); } catch(_) {}
      setCodesVersion(n=>n+1);
      setEditing(null);await onSaved?.();
    } catch(err){setError(err.message);} finally{setBusy(false);}
  };
  return <section className="card" style={{padding:16,marginBottom:16}} aria-label="24/7 artwork requirements">
    <h3>24/7 Weblogos &amp; DTF color versions</h3>
    <p>Every logo used on this store needs a transparent Weblogo in its art folder. DTF also needs a reviewed print file for each garment color. Twill and chenille keep their own inventory.</p>
    {[...needs.values()].map(n=>{const v=(n.art.dtf_variants || []).find(v=>colorKey(v.garment_color)===colorKey(n.color));const code=(v&&codes.version(ownerOf(n.art),n.art.id,v.id)) || codes.master(ownerOf(n.art),n.art.id);return <div key={`${n.art.id}:${n.color}`} style={{margin:'10px 0'}}>{code&&<code style={{marginRight:6}}>{code}</code>}<b>{n.art.name} · {n.color || 'Garment color missing'}</b> — {v?`Knockout: ${v.knockout_color}`:'DTF variant required'} <button className="btn btn-sm btn-secondary" onClick={()=>edit(n)}>Set up DTF version</button></div>;})}
    {!needs.size&&<p>No logos currently use DTF on this store. DTF variants are only required when used.</p>}
    {editing&&<div style={{display:'grid',gap:10,maxWidth:600}}>
      <strong>{editing.art.name} — {editing.color}</strong>
      <label>Matching Weblogo<select className="form-select" value={editing.web_logo_url} onChange={e=>change('web_logo_url',e.target.value)}><option value="">Choose from this art folder</option>{webLogos(editing.art).map((w,i)=><option key={i} value={w.url}>{w.color_way || `Weblogo ${i+1}`}</option>)}</select></label>
      {editing.web_logo_url&&<img src={editing.web_logo_url} alt="Selected garment-specific Weblogo" style={{width:120,height:100,objectFit:'contain',background:colorKey(editing.color)==='black'?'#111':'#eee'}}/>}
      <label>Color removed / knockout treatment<input className="form-input" value={editing.knockout_color} placeholder="Black removed, White removed, or None — no matching color" onChange={e=>change('knockout_color',e.target.value)}/></label>
      <label>Print width (in)<input type="number" min="0.01" step="0.01" value={editing.width_in} onChange={e=>change('width_in',e.target.value)}/></label>
      <label>Print height (in)<input type="number" min="0.01" step="0.01" value={editing.height_in} onChange={e=>change('height_in',e.target.value)}/></label>
      <label>Saved production file<select value={editing.production_file?.path || ''} onChange={e=>change('production_file',(editing.art.prod_files || []).find(f=>f.path===e.target.value))}><option value="">Choose .ai from art folder, or upload below</option>{(editing.art.prod_files || []).filter(validProductionFile).map(f=><option key={f.path} value={f.path}>{f.name}</option>)}</select></label>
      <label>Upload DTF knockout .ai to this art folder<input type="file" accept=".ai" onChange={e=>change('file',e.target.files?.[0] || null)}/></label>
      <label><input type="checkbox" checked={editing.reviewed} onChange={e=>change('reviewed',e.target.checked)}/> I checked that the Weblogo and print file match this garment color and knockout treatment.</label>
      <p>Saving creates separate inventory at zero on hand. Existing paid orders retain their original version.</p>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save art-folder variant & inventory'}</button><button className="btn btn-secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button>
    </div>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
