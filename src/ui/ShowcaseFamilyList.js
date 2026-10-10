import React, { useState } from 'react';
import { groupShowcaseItems, needsFamilyGeneration } from '../lib/showcaseFamilies';
import { DECORATION_FINISHES } from '../lib/showcaseSettings';
import ShowcaseImageReview from './ShowcaseImageReview';
import ShowcaseProductImage from './ShowcaseProductImage';
import { approvableImageIds } from '../lib/showcaseApproval';

function FamilyCard({ group, busy, act, onReview }) {
  const [open, setOpen] = useState(false);
  const [uploadError,setUploadError]=useState('');
  const [uploading,setUploading]=useState(false);
  const uploadPhoto=async(item,file)=>{
    if(!file)return;
    setUploadError('');
    if(file.size>3*1024*1024){setUploadError('Choose a photo up to 3 MB.');return;}
    setUploading(true);
    try {
      const image_data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read photo'));reader.readAsDataURL(file);});
      await act(item.webstore_product_id,'save_supplier_photo',{webstore_product_id:item.webstore_product_id,image_data});
    }catch(error){setUploadError(error.message);}finally{setUploading(false);}
  };
  const [finish, setFinish] = useState(group.items[0].asset?.showcase_settings?.decoration_type || 'auto');
  const approved = group.items.filter(({ asset }) => asset?.status === 'approved').length;
  const generated = group.items.filter(({ asset }) => asset?.showcase_image_url || asset?.approved_showcase_image_url).length;
  const approvalIds = approvableImageIds(group.items);
  const needsUpdate = needsFamilyGeneration(group);
  const review = group.items.filter(({ asset }) => asset?.status === 'review').length;
  const errors = [...new Set(group.items.map(({ asset }) => asset?.error_details).filter(Boolean))];
  const thumbnail = group.items.find(i=>i.asset?.showcase_image_url)
    || group.items.find(i=>i.asset?.approved_showcase_image_url) || group.items[0];
  const thumbnailUrl = thumbnail.asset?.showcase_image_url || thumbnail.asset?.approved_showcase_image_url;
  const baked = (thumbnail.decorations || []).some(d=>d.baked && (d.side || 'front')==='front');
  const standardThumbnailUrl = baked ? thumbnail.standard_image_url || thumbnail.supplier_image_url
    : thumbnail.supplier_image_url || thumbnail.standard_image_url;
  const generate = (newMaster = false) => {
    if (newMaster && !window.confirm('Create new poses and lighting for this item’s colors? Each color incurs a new AI image charge. Existing approved images stay in place until replacements are approved.')) return;
    act(group.key,'generate_family',{family_key:group.key,new_master:newMaster,showcase_settings:{decoration_type:finish,revision_notes:group.items[0].asset?.showcase_settings?.revision_notes || ''}});
  };
  return <section style={{ border:'1px solid #e2e8f0',borderRadius:10,marginBottom:12,overflow:'hidden' }}>
    <div style={{ display:'flex',gap:14,padding:16,alignItems:'center',flexWrap:'wrap' }}>
      <div style={{width:68,flexShrink:0}}>
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt={`${group.name} Showcase preview`} width={68} height={82} style={{objectFit:'contain'}} />
          : <ShowcaseProductImage item={thumbnail} url={standardThumbnailUrl} height={82} alt={`${group.name} with decoration`} />}
      </div>
      <div style={{flex:1,minWidth:200}}>
        <div style={{fontSize:14,fontWeight:800}}>{group.name}</div>
        <div style={{fontSize:12,color:'#64748b',marginTop:5}}>{group.colors.length} colors · {group.designs} designs · {group.items.length} combinations</div>
        <div style={{fontSize:12,color:'#64748b',marginTop:5}}>{generated}/{group.items.length} generated · {approved} approved · {review} awaiting review{group.working ? ' · Generation in progress' : ''}</div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <label style={{fontSize:12}}>Decoration finish{' '}
          <select aria-label={`Decoration finish for ${group.name}`} value={finish} disabled={busy || group.working} onChange={(e)=>setFinish(e.target.value)}>
            {DECORATION_FINISHES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button className="btn btn-sm btn-primary" disabled={busy || group.working || !group.eligible} onClick={()=>generate()}>
          {group.working ? 'Creating images…' : generated ? (needsUpdate ? 'Update generated images' : 'Refresh images') : 'Create images'}
        </button>
        {group.working ? <button className="btn btn-sm btn-secondary" disabled={busy} onClick={()=>act(group.key,'cancel_family',{family_key:group.key})}>Cancel item</button>
          : <button className="btn btn-sm btn-secondary" disabled={busy || !group.eligible} onClick={()=>generate(true)}>Change pose & lighting</button>}
        <button className="btn btn-sm btn-primary" disabled={busy || group.working || !approvalIds.length} onClick={()=>act(group.key,'approve_all',{image_ids:approvalIds})}>Approve all ({approvalIds.length})</button>
        <button className="btn btn-sm btn-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide combinations':`Review combinations (${group.items.length})`}</button>
      </div>
    </div>
    {uploadError && <p role="alert" style={{padding:12,color:'#b91c1c'}}>{uploadError}</p>}
    {!group.eligible && <p style={{margin:'0 16px 12px',fontSize:12,color:'#b45309'}}>Add an original supplier photo below. Missing photos are skipped during generation.</p>}
    {errors.map((error)=><p key={error} role="alert" style={{margin:'0 16px 12px',fontSize:12,color:'#b91c1c'}}>{error}</p>)}
    {open && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:12,padding:16,borderTop:'1px solid #e2e8f0',background:'#f8fafc'}}>
      {group.items.map((item)=>{
        const asset=item.asset || {};
        const url=asset.showcase_image_url || asset.approved_showcase_image_url;
        return <div key={item.webstore_product_id} style={{background:'#fff',padding:12,border:'1px solid #e2e8f0',borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:700}}>{item.color || 'Default color'} · {item.school_design_label || 'Original logo'}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
            <div><small>Standard</small><ShowcaseProductImage item={item} url={item.standard_image_url} height={120} alt="Standard garment with logo" /></div>
            <div><small>Showcase</small>{url?<img src={url} alt={`${item.color} Showcase`} loading="lazy" style={{height:120,width:'100%',objectFit:'contain'}}/>:<div style={{height:120,display:'grid',placeItems:'center',fontSize:12,color:'#64748b'}}>{asset.status || 'Missing'}</div>}</div>
          </div>
          <div style={{fontSize:11,color:'#64748b',margin:'8px 0'}}>{asset.error_details?.startsWith('Skipped') ? 'Skipped · Supplier photo needed' : asset.status === 'review' ? 'Generated · Awaiting approval' : asset.status === 'approved' ? 'Generated · Approved' : asset.status || 'Not generated'}</div>
          <label style={{display:'block',fontSize:12,margin:'8px 0'}}>
            {uploading ? 'Uploading photo…' : 'Add / replace supplier photo'}
            <input aria-label={`Supplier photo for ${item.color || 'default color'} · ${item.school_design_label || 'Original logo'}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || uploading || group.working} onChange={e=>{uploadPhoto(item,e.target.files?.[0]);e.target.value='';}} style={{display:'block',maxWidth:'100%',fontSize:11,marginTop:4}} />
            <small>Blank garment, correct color. Applies to this color’s logos in this store.</small>
          </label>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>onReview(item.webstore_product_id)}>Before / After</button>
            <button className="btn btn-sm btn-primary" disabled={busy || group.working || !item.supplier_image_url} onClick={()=>act(item.webstore_product_id,'generate_image',{family_key:group.key,webstore_product_id:item.webstore_product_id,showcase_settings:{decoration_type:finish,revision_notes:asset.showcase_settings?.revision_notes || ''}})}>{url ? 'Refresh this image' : 'Create this image'}</button>
            {asset.status==='review' && <button className="btn btn-sm btn-primary" disabled={busy || asset.needs_regeneration} onClick={()=>onReview(item.webstore_product_id)}>Review & Approve</button>}
            {asset.approved_showcase_image_url && <button className="btn btn-sm btn-secondary" disabled={busy || group.working} onClick={()=>act(item.webstore_product_id,'fallback',{webstore_product_id:item.webstore_product_id})}>Use Standard</button>}
          </div>
        </div>;
      })}
    </div>}
  </section>;
}
export default function ShowcaseFamilyList({ items, busy, error, act }) {
  const [reviewId,setReviewId]=useState(null);
  const groups=groupShowcaseItems(items);
  const approvalIds=approvableImageIds(items);
  const count=groups.filter(needsFamilyGeneration).length;
  const reviewItem=items.find((item)=>item.webstore_product_id===reviewId);
  return <div className="card">
    <div style={{padding:18,borderBottom:'1px solid #e2e8f0'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <strong>Showcase · {groups.length} base items</strong>
        <button className="btn btn-sm btn-primary" disabled={busy || !approvalIds.length} onClick={()=>act('approve_all','approve_all',{image_ids:approvalIds})}>Approve all images ({approvalIds.length})</button>
        {groups.some((g)=>g.working) && <button className="btn btn-sm btn-secondary" disabled={busy} onClick={()=>{
          if(window.confirm('Cancel all active items? Provider requests already in flight may still incur a charge.')) act('cancel_all','cancel_all');
        }}>Cancel all</button>}
        <button className="btn btn-sm btn-primary" disabled={busy || !count} onClick={()=>{
          if(window.confirm(`Generate ${count} base items and all their color/logo combinations? Each color needs a paid image generation, and additional designs use paid edits. Saved color images are reused.`)) act('generate_all','generate_all_families');
        }}>Generate all ({count})</button>
      </div>
      <p style={{fontSize:12,color:'#64748b',marginBottom:0}}>Each color starts from its own supplier photo. Additional designs reuse that color’s finished image. Refresh images requests a design edit that preserves the pose and lighting; review the result for changes. Choose Change pose & lighting to change the pose or lighting. Approve images individually or use Approve all for the generated images awaiting approval.</p>
      <p style={{fontSize:12,color:'#64748b',marginBottom:0}}>Photo lighting can affect color accuracy. Compare fabric texture, manufacturer marks and decoration placement with the original photos. Approved images remain in use until you approve replacements.</p>
    </div>
    <div style={{padding:14}}>{!groups.length && <p>Add products to the catalog first.</p>}{groups.map((group)=><FamilyCard key={group.key} group={group} busy={busy} act={act} onReview={setReviewId}/>)}</div>
    {reviewItem && <ShowcaseImageReview key={reviewId} item={reviewItem} familyMode busy={busy} error={error} onClose={()=>setReviewId(null)}
      onAction={(action,extra={})=>{
        if (action === 'generate_image' || action === 'revise') {
          const group = groups.find(g => g.items.some(i => i.webstore_product_id === reviewId));
          return act(reviewId,'generate_image',{family_key:group.key,webstore_product_id:reviewId,new_master:action==='revise',...extra});
        }
        return act(reviewId,action,{webstore_product_id:reviewId,...extra});
      }}/>}
  </div>;
}
