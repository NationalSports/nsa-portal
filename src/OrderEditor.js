/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import * as fabric from 'fabric';
import ImageTracer from 'imagetracerjs';
import { _pick, _estCols, _soCols, _itemCols, _decoCols, _itemExtraCols, _estExtraCols, _soExtraCols, _decoExtraCols, _sanitizeDeco, _msgCols, _msgExtraCols, _artCols, _artExtraCols, _jobExtraCols, _jobCols, ART_FILE_LABELS, ART_FILE_SC, ART_LABELS, PROD_FILES_STATUSES, prodFilesStatusFor, isDstFile, artProdFilesReady, BATCH_VENDORS, APPAREL_SIZES, FOOTWEAR_SIZES, FOOTWEAR_DEFAULT_SIZES, SZ_ORD, SC, PANTONE_MAP, pantoneHex, pantoneSearch, THREAD_COLORS, threadHex, D_V, PRINT_CSS, MACHINES, NSA } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeObj, safeStr, safeArt, safeJobs, safeFirm, skusMissingMockups, soLineKey, buildInvoicedQtyMap, sumDepositInvoiced } from './safeHelpers';
import { Icon, SortHeader, SearchSelect, Bg, $In, EmailBadge, getAddrs, calcSOStatus, SendModal, PantoneAdder, PantoneQuickPicks, ThreadQuickPicks, ImgGallery } from './components';
import { CustModal } from './modals';
import SanMarPreviewModal from './SanMarPreviewModal';
import QuickMockBuilder from './QuickMockBuilder';
import { dP, rQ, rT, normSzName, showSz, spP, emP, npP, SP, EM, NP, DTF, POSITIONS, _decoVendorPrice, mergeColors, auTierDisc } from './pricing';
import { sendBrevoEmail, sendBrevoSms, fileUpload, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, openFile, buildDocHtml, printDoc, printQrLabel, downloadQrLabel, downloadQrSheet, openDocPDF, downloadDoc, buildPdfAttachment, nextInvId, _brevoKey, _smsUiEnabled, getBillingContacts, pdfDecoLabel, invokeEdgeFn, enrichAiLinesWithVendors, buildBrandedEmailHtml } from './utils';
import { sanmarGetProduct, sanmarGetPricing, sanmarGetInventory, sanmarGetPromoInventory, ssApiCall, momentecApiCall, momentecSearchProducts, momentecGetProductByPartNumber, momentecGetProductById, richardsonGetStockInventory, richardsonSearchStyles } from './vendorApis';
import { getRichardsonLevel4Price } from './richardsonPrices';

// Prefix a line item's display name with its manufacturer/brand (e.g. "PTS30" → "Richardson PTS30").
// No-ops when brand is empty or the name already leads with the brand, so vendors that
// already embed the brand (SanMar, S&S) don't get it duplicated.
const nameWithBrand=(name,brand)=>{
  const n=(name||'').trim();const b=(brand||'').trim();
  if(!b)return n;
  if(!n)return b;
  if(n.toLowerCase().startsWith(b.toLowerCase()))return n;
  return b+' '+n;
};

function OrderEditor({order,mode,customer:ic,allCustomers,products,vendors:vendorsProp,onSave,onBack,onConvertSO,onCopyEstimate,onCopySalesOrder,onRevertToEst,cu,nf,msgs,onMsg,dirtyRef,onAdjustInv,allOrders,onInv,allInvoices,batchPOs,onBatchPO,nextBatchPONumber,initTab,onNavCustomer,onNewEstimate,scrollToItem,scrollToJob,scrollToJobRef,onScrollJobConsumed,openPOId,onOpenPOConsumed,reps:REPS,ssConnected,ssShipping,onShipSS,onCheckShipStatus,onDelete,onNavInvoice,onSaveProduct,onViewEstimate,onViewSO,returnToPage,onReturnToJob,onAssignTodo,portalSettings,decoVendors:decoVendorsProp,decoVendorPricing:decoVendorPricingProp,changeLog:changeLogProp,dbSavePromoPeriod:_dbSavePromoPeriod,onSavePromoPeriod,onSavePromoUsage,onDeletePromoUsage,companyInfo:companyInfoProp,fetchAdidasInventory:fetchAdidasInventoryProp,searchProducts:searchProductsProp,onSaveCustomer,onScheduleEmail,supabase}){
  const fetchAdidasInventory=fetchAdidasInventoryProp||(async()=>({sizes:{},lastSynced:null}));
  const _ci=companyInfoProp||NSA;// use company info from state (reacts to Supabase loads) with fallback to mutable NSA
  const vendorList=vendorsProp||D_V;// use DB-loaded vendors if available, fallback to defaults
  const cuEmail=(cu?.email)||(REPS||[]).find(r=>r.id===cu?.id)?.email||'';
  const isE=mode==='estimate';const isSO=mode==='so';
  const[o,setO]=useState(order);const[cust,setCust]=useState(ic);const[pS,setPS]=useState('');const[showAdd,setShowAdd]=useState(false);
  const[tab,setTab]=useState(initTab||'items');const[dirty,setDirty]=useState(false);const[selJob,setSelJob]=useState(null);const[jobNote,setJobNote]=useState('');const[msgDept,setMsgDept]=useState('all');const[replyTo,setReplyTo]=useState(null);const[editingJobName,setEditingJobName]=useState(null);
  // selJob is stored as a numeric index into the jobs array. The array can re-order
  // when external updates merge in (coach approval, warehouse picks), making the
  // index point at the wrong job or nothing. We capture the selected job's stable
  // id here so the detail-view lookup can recover when the index goes stale.
  const selJobIdRef=useRef(null);
  // Always-current jobs snapshot so the navigate-to-job resolver below can read the
  // post-sync job list (with healed/distinct ids and correct art_file_ids) rather
  // than the possibly-stale array captured when the dashboard fired the navigation.
  const _navJobsRef=useRef(o);_navJobsRef.current=o;
  React.useEffect(()=>{
    if(selJob!=null){
      const _j=safeJobs(o)[selJob];
      if(_j)selJobIdRef.current=_j.id;
    }else{
      selJobIdRef.current=null;
    }
  },[selJob]);
  const[mentionQuery,setMentionQuery]=useState(null);const[mentionIdx,setMentionIdx]=useState(0);const mentionRef=useRef(null);const msgInputRef=useRef(null);
    // Sync from external updates (e.g., coach approval from portal) — merge job art_status + art_files
    // Use a ref to track the last order we synced from, to avoid re-triggering on format differences
    const lastSyncRef=React.useRef(order.id+':'+(order.updated_at||''));
    React.useEffect(()=>{
      const pickCount=safeItems(order).reduce((a,it)=>(safePicks(it).length)+a,0);
      const key=order.id+':'+(order.updated_at||'')+':'+pickCount;
      if(key===lastSyncRef.current)return;
      lastSyncRef.current=key;
      const extJobs=safeJobs(order);
      const hasExternalJobChange=extJobs.some(ej=>{const lj=safeJobs(o).find(j=>j.id===ej.id);return lj&&(ej.art_status!==lj.art_status||ej.coach_approved_at!==lj.coach_approved_at||ej.coach_rejected!==lj.coach_rejected)});
      const hasExternalArtChange=JSON.stringify(order.art_files||[])!==JSON.stringify(o.art_files||[])&&!dirty;
      // Detect external pick_line changes (e.g., warehouse pulled an IF on another tab)
      const hasExternalPickChange=safeItems(order).some((ei,idx)=>{const li=safeItems(o)[idx];if(!li)return!!ei.pick_lines?.length;const ePicks=safePicks(ei);const lPicks=safePicks(li);if(ePicks.length!==lPicks.length)return true;return ePicks.some((ep,pi)=>ep.status!==lPicks[pi]?.status||ep.pick_id!==lPicks[pi]?.pick_id)});
      if(!hasExternalJobChange&&!hasExternalArtChange&&!hasExternalPickChange)return;
      setO(prev=>{const mergedJobs=safeJobs(prev).map(j=>{const ext=extJobs.find(ej=>ej.id===j.id);if(ext&&(ext.art_status!==j.art_status||ext.coach_approved_at!==j.coach_approved_at||ext.coach_rejected!==j.coach_rejected)){return{...j,art_status:ext.art_status,coach_approved_at:ext.coach_approved_at,coach_rejected:ext.coach_rejected,rejections:ext.rejections,sent_to_coach_at:ext.sent_to_coach_at}}return j});
        // Merge pick_line changes from external source (warehouse pulls, new IFs from other tabs)
        const mergedItems=hasExternalPickChange?safeItems(prev).map((it,idx)=>{const ext=safeItems(order)[idx];if(!ext)return it;const ePicks=safePicks(ext);const lPicks=safePicks(it);if(JSON.stringify(ePicks)===JSON.stringify(lPicks))return it;return{...it,pick_lines:ePicks}}):prev.items;
        return{...prev,jobs:mergedJobs,items:mergedItems||prev.items,art_files:hasExternalArtChange?order.art_files:prev.art_files,updated_at:order.updated_at}})
    },[order.updated_at,order.items]);
    React.useEffect(()=>{if(initTab)setTab(initTab)},[initTab]);
    React.useEffect(()=>{if(scrollToItem!=null){setTab('items');setTimeout(()=>{const el=document.getElementById('so-item-'+scrollToItem);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #3b82f6';setTimeout(()=>{el.style.boxShadow=''},2000)}},150)}},[scrollToItem]);
    React.useEffect(()=>{if(scrollToJob!=null){setTab('jobs');setSelJob(scrollToJob);setTimeout(()=>{const el=document.getElementById('so-job-'+scrollToJob);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #7c3aed';setTimeout(()=>{el.style.boxShadow=''},2000)}},200)}},[scrollToJob]);
    // Resolve a navigate-to-job request by stable identifier against THIS editor's own
    // (post-sync) job list. The dashboard can't reliably compute the index because its
    // copy of so.jobs may be stale or have duplicate ids; here we match on art_file_id
    // first (unique per art), then key, then id. Deferred so auto-sync has committed.
    React.useEffect(()=>{if(!scrollToJobRef)return;setTab('jobs');const _go=()=>{const _j=safeJobs(_navJobsRef.current);const a=scrollToJobRef;let idx=a.artId?_j.findIndex(x=>x.art_file_id===a.artId||(x._art_ids||[]).includes(a.artId)):-1;if(idx<0&&a.key)idx=_j.findIndex(x=>x.key===a.key);if(idx<0&&a.id)idx=_j.findIndex(x=>x.id===a.id);if(idx>=0){setSelJob(idx);const el=document.getElementById('so-job-'+idx);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #7c3aed';setTimeout(()=>{el.style.boxShadow=''},2000)}}onScrollJobConsumed&&onScrollJobConsumed()};setTimeout(_go,250)},[scrollToJobRef]);// eslint-disable-line
    React.useEffect(()=>{if(openPOId){
      // Check SO-level deco_pos first — decoration POs are cost buckets, not per-item line items.
      const decoPO=(o.deco_pos||[]).find(dp=>dp.po_id===openPOId);
      if(decoPO){setPoFullPage({decoPo:decoPO,soId:o.id,soItems:safeItems(o)});onOpenPOConsumed&&onOpenPOConsumed();return}
      // Fallback: item-level po_lines (blanks POs).
      const items=safeItems(o);for(let i=0;i<items.length;i++){const poIdx=(items[i].po_lines||[]).findIndex(p=>p.po_id===openPOId);if(poIdx>=0){const poLine=items[i].po_lines[poIdx];const allLines=items.map((_,idx)=>({lineIdx:idx})).filter(ln=>items[ln.lineIdx]?.po_lines?.some(p=>p.po_id===openPOId));setPoFullPage({po:poLine,item:items[i],allLines,soId:o.id,soItems:items});break}}
      // Reset the parent's pending-PO token so re-selecting the same PO from global search re-fires this effect.
      onOpenPOConsumed&&onOpenPOConsumed();
    }},[openPOId]);
    const origRef=React.useRef(JSON.stringify(o));
    const markDirty=()=>setDirty(true);const[saved,setSaved]=useState(!!order.customer_id);const[showSend,setShowSend]=useState(false);const[showActionsDD,setShowActionsDD]=useState(false);const actionsRef=useRef(null);const[showPick,setShowPick]=useState(false);const[pickId,setPickId]=useState(()=>{let max=1000;(allOrders||[]).concat([order]).forEach(so=>safeItems(so).forEach(it=>safePicks(it).forEach(pk=>{const m=parseInt((pk.pick_id||'').replace('IF-',''))||0;if(m>max)max=m})));return'IF-'+String(max+1)});const[showPO,setShowPO]=useState(null);const[batchReadyPopup,setBatchReadyPopup]=useState(null);const[sanmarPreviewBatch,setSanMarPreviewBatch]=useState(null);const[poCounter,setPOCounter]=useState(()=>{let max=3000;(allOrders||[]).concat([order]).forEach(so=>safeItems(so).forEach(it=>safePOs(it).forEach(po=>{if(po.preexisting)return;const m=parseInt(((po.po_id||'').match(/^D?PO[\s-]+(\d+)/)||[])[1])||0;if(m>max)max=m})));return max+1});
    const[pickNotes,setPickNotes]=useState('');const[pickShipDest,setPickShipDest]=useState('in_house');const[pickDecoVendor,setPickDecoVendor]=useState('');const[pickShipAddr,setPickShipAddr]=useState('default');const[pickSel,setPickSel]=useState({});/* selected item indexes for IF multi-select */
    const[rosterSendModal,setRosterSendModal]=useState(null);// {idx,di,item,rosterUrl,linkData}
    const[rosterUploadModal,setRosterUploadModal]=useState(null);// {idx,di,item,roster,sizedQtys}
    const[rosterUploadDragOver,setRosterUploadDragOver]=useState(false);
    const[rsmTo,setRsmTo]=useState('');const[rsmCustom,setRsmCustom]=useState('');const[rsmName,setRsmName]=useState('Coach');const[rsmSending,setRsmSending]=useState(false);const[rsmCopied,setRsmCopied]=useState(false);
    React.useEffect(()=>{if(rosterSendModal){const contacts=(cust?.contacts||[]).filter(c=>c.email);setRsmTo(contacts.length>0?contacts[0].email:'');setRsmCustom('');setRsmName(contacts.length>0?(contacts[0].name||'Coach'):'Coach');setRsmSending(false);setRsmCopied(false)}},[rosterSendModal]);
    const[preexistingPO,setPreexistingPO]=useState(false);const[preexistingPOId,setPreexistingPOId]=useState('');const[poExcluded,setPOExcluded]=useState({});const[poCalcTick,setPoCalcTick]=useState(0);const[poShipTo,setPoShipTo]=useState('warehouse');
    const[topstarService,setTopstarService]=useState('dst');const[topstarImgs,setTopstarImgs]=useState([]);const[topstarNotes,setTopstarNotes]=useState('');const[topstarSending,setTopstarSending]=useState(false);
    const decoVendors=decoVendorsProp||[];const decoVendorPricing=decoVendorPricingProp||[];
    const DECO_VENDORS=(()=>{const names=decoVendors.filter(v=>v.is_active!==false).map(v=>v.name);return names.length>0?[...names,'Other']:['Silver Screen','Olympic Embroidery','WePrintIt','Pacific Screen Print','BYOG Screenprinting','GraphiC323','Frontier Screen Printing','Other']})();
  const[showFirmReq,setShowFirmReq]=useState(false);const[firmReqDate,setFirmReqDate]=useState('');const[firmReqNote,setFirmReqNote]=useState('');
  const[showFirmApprove,setShowFirmApprove]=useState(false);const[firmRushPct,setFirmRushPct]=useState(0);
  const[showInvCreate,setShowInvCreate]=useState(false);const[invSelItems,setInvSelItems]=useState([]);const[invMemo,setInvMemo]=useState('');const[invType,setInvType]=useState('final');const[invDepositPct,setInvDepositPct]=useState(50);const[invBilling,setInvBilling]=useState('');const[invDate,setInvDate]=useState(()=>new Date().toLocaleDateString('en-CA'));
  const[invReview,setInvReview]=useState(null);const[invSendModal,setInvSendModal]=useState(false);const[invSendMsg,setInvSendMsg]=useState('');const[invSendTo,setInvSendTo]=useState('');const[invSendCustomEmail,setInvSendCustomEmail]=useState('');const[invSendAt,setInvSendAt]=useState('');const[invSentStatus,setInvSentStatus]=useState(null);
  const[invSmsEnabled,setInvSmsEnabled]=useState(false);const[invSmsPhone,setInvSmsPhone]=useState('');const[invSmsMsg,setInvSmsMsg]=useState('');
  const[invFollowUpDays,setInvFollowUpDays]=useState(7);
  const[splitModal,setSplitModal]=useState(null);// {jIdx, mode:'received'|'sku'|null}
  const[mergeMode,setMergeMode]=useState(null);// {selected:[jobIdx,...]} — select jobs to merge
  const[jobWizard,setJobWizard]=useState(null);// {groups: [{name,deco_type,items:[...]},...]} — Job Setup Wizard
  const[mockBuilder,setMockBuilder]=useState(null);// {gi} — Quick Mock Builder open for jobWizard group index
  const[editMockJob,setEditMockJob]=useState(null);// job object whose quick mock is being re-edited in place
  const[countDiscModal,setCountDiscModal]=useState(null);// {open,entries:[{sku,name,color,size,expected,actual}],notes}
  const[artReqModal,setArtReqModal]=useState(null);// {jIdx, artist:'', instructions:'', files:[]}
  const[artRevisionNote,setArtRevisionNote]=useState('');
  const[showPrevArt,setShowPrevArt]=useState(false);// Previous Artwork picker modal
  const[retagMockupModal,setRetagMockupModal]=useState(null);// {artIdx} — opens admin retag tool for legacy general mockups on an art
  const[expandedArt,setExpandedArt]=useState({});// Track expanded art groups by id (default collapsed)
  const[collapsedNames,setCollapsedNames]=useState({});// Track collapsed Names decos by `idx-di`
  // In-progress size-cell edits, keyed `idx+'_'+sz`. Lets the user type intermediate values
  // (e.g. clear "8" then type "13") without the per-keystroke "Cannot reduce below X" guard firing.
  // Validation runs in uSz on blur instead — see input at the size grid below.
  const[sizingDraft,setSizingDraft]=useState({});
  const[coachApprovalModal,setCoachApprovalModal]=useState(null);// {jIdx, contact, portalUrl, method, message}
  const[mockupLightbox,setMockupLightbox]=useState(null);// url string for image lightbox overlay
  const[copySkuModal,setCopySkuModal]=useState(null);// {itemIdx, search:''}
  const[colorPickerModal,setColorPickerModal]=useState(null);// {itemIdx, sku, source:'ss'|'sm'|'mt'|'rs'}

  // ─── Vendor Inventory Cache (S&S Activewear) ───

  // Check if item is from S&S (handles both local D_V and Supabase UUID vendors)
  const isSSItem=useCallback((item)=>{
    if(item._ss_live)return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return vRec.api_provider==='ss_activewear'||vRec.name==='S&S Activewear';
    if(item.brand==='S&S Activewear')return true;
    return false;
  },[products,vendorList]);

  // Check if item is from SanMar
  const isSanMarItem=useCallback((item)=>{
    if(item._sm_live)return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return vRec.api_provider==='sanmar'||vRec.name==='SanMar';
    return false;
  },[products,vendorList]);

  // Check if item is from Momentec
  const isMomentecItem=useCallback((item)=>{
    if(item._mt_live)return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return vRec.api_provider==='momentec'||vRec.name==='Momentec';
    return false;
  },[products,vendorList]);

  // Check if item is from Richardson (live StockInventory feed available)
  const isRichardsonItem=useCallback((item)=>{
    if(item._rs_live)return true;
    if((item.brand||'').toLowerCase()==='richardson')return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return vRec.api_provider==='richardson'||vRec.name==='Richardson';
    return false;
  },[products,vendorList]);

  // Check if item is from Adidas (for B2B inventory display)
  const isAdidasItem=useCallback((item)=>{
    if((item.brand||'').toLowerCase()==='adidas')return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return(vRec.name||'').toLowerCase()==='adidas';
    return false;
  },[products,vendorList]);

  // Keyed by style (sku base), stores {sizes:{S:qty,M:qty,...}, price:{S:cost,...}, fetchedAt:timestamp}
  const vendorInvCache=useRef({});
  const[vendorInv,setVendorInv]=useState({});// {sku: {sizes:{S:qty,...}, loading:bool, error:str}}
  const vendorInvFetching=useRef({});// track in-flight fetches

  // ─── Adidas B2B Inventory Cache ───
  const adidasInvCache=useRef({});// {sku: {sizes:{...}, lastSynced, fetchedAt}}
  const[adidasInv,setAdidasInv]=useState({});// {sku: {sizes:{S:{qty,futureDate,futureQty},...}, lastSynced, loading, error}}
  const adidasInvFetching=useRef({});
  const[catalogUpdatedSkus,setCatalogUpdatedSkus]=useState({});// track SKUs whose catalog cost was updated this session

  const fetchAdidasInv=useCallback(async(sku)=>{
    if(!sku)return;
    const cached=adidasInvCache.current[sku];
    if(cached&&(Date.now()-cached.fetchedAt)<600000){
      setAdidasInv(prev=>({...prev,[sku]:{sizes:cached.sizes,lastSynced:cached.lastSynced,loading:false,error:null}}));
      return;
    }
    if(adidasInvFetching.current[sku])return;
    adidasInvFetching.current[sku]=true;
    setAdidasInv(prev=>({...prev,[sku]:{sizes:{},lastSynced:null,loading:true,error:null}}));
    try{
      const result=await fetchAdidasInventory(sku);
      adidasInvCache.current[sku]={...result,fetchedAt:Date.now()};
      setAdidasInv(prev=>({...prev,[sku]:{...result,loading:false,error:null}}));
    }catch(e){
      setAdidasInv(prev=>({...prev,[sku]:{sizes:{},lastSynced:null,loading:false,error:e.message}}));
    }finally{delete adidasInvFetching.current[sku]}
  },[]);

  // Vendor product image cache — {sku+color: {front:url, back:url}}
  const vendorImgCache=useRef({});
  const vendorImgFetching=useRef({});
  const[vendorImgs,setVendorImgs]=useState({});// {sku+color: {front:url, back:url}}
  const fetchVendorImage=useCallback(async(sku,color,vendorId,item)=>{
    const itemRef=item||{vendor_id:vendorId,sku};
    const isSS=isSSItem(itemRef);const isSM=isSanMarItem(itemRef);const isMT=isMomentecItem(itemRef);
    if(!isSS&&!isSM&&!isMT)return;
    const cacheKey=sku+'|'+(color||'').toLowerCase();
    if(vendorImgCache.current[cacheKey]){setVendorImgs(prev=>({...prev,[cacheKey]:vendorImgCache.current[cacheKey]}));return}
    if(vendorImgFetching.current[cacheKey])return;
    vendorImgFetching.current[cacheKey]=true;
    try{
      let front='',back='';
      if(isSS){
        // S&S: fetch products for this style, find matching color
        try{
          let data;
          try{let sid=null;try{const st=await ssApiCall('/Styles?search='+encodeURIComponent(sku));const sa=Array.isArray(st)?st:st?[st]:[];const exact=sa.find(s=>String(s.partNumber||s.styleName||'').toLowerCase()===String(sku).toLowerCase());if(exact)sid=exact.styleID;else if(sa.length>0)sid=sa[0].styleID}catch(e){}
            if(sid){data=await ssApiCall('/Products/?style='+encodeURIComponent(sid))}else{data=await ssApiCall('/Products?style='+encodeURIComponent(sku))}}
          catch(e){data=[]}
          const items=Array.isArray(data)?data:data?[data]:[];
          const colorLower=(color||'').toLowerCase();
          const match=items.find(it=>(it.colorName||'').toLowerCase()===colorLower)||items[0];
          if(match){
            front=match.colorFrontImage||match.colorSideImage||'';
            back=match.colorBackImage||'';
            if(front&&front.startsWith('http://'))front=front.replace('http://','https://');
            if(back&&back.startsWith('http://'))back=back.replace('http://','https://');
          }
        }catch(e){console.warn('[SS] Image fetch error for',sku,e.message)}
      }else if(isSM){
        // SanMar: fetch product info for images
        try{
          const prodData=await sanmarGetProduct(sku,color||'','');
          const prodItems=prodData?.items||[];
          if(prodItems.length){
            // SanMar nests image fields in productImageInfo — flatten before reading (same fields as the catalog builder).
            const raw=prodItems[0];const it={...(raw.productBasicInfo||{}),...(raw.productImageInfo||{}),...raw};
            // Prefer the full-resolution product image over the thumbnail — the mock canvas is large.
            front=it.colorProductImage||it.productImage||it.colorProductImageThumbnail||it.thumbnailImage||it.colorSwatchImage||'';
            back=it.colorProductImageBack||it.colorProductBackImage||it.colorProductImageBackThumbnail||'';
          }
        }catch(e){console.warn('[SM] Image fetch error for',sku,e.message)}
      }else if(isMT){
        // Momentec: fetch product detail for images
        try{
          const detail=await momentecGetProductByPartNumber(sku);
          const entry=detail?.CatalogEntryView?.[0];
          if(entry){front=entry.thumbnail||entry.fullImage||'';back=entry.fullImageBack||entry.backImage||''}
        }catch(e){console.warn('[MT] Image fetch error for',sku,e.message)}
      }
      const result={front,back};
      // Don't cache an empty result — a failed/blocked fetch should be retryable on the next request.
      if(front||back)vendorImgCache.current[cacheKey]=result;
      setVendorImgs(prev=>({...prev,[cacheKey]:result}));
    }catch(e){console.warn('[Vendor] Image fetch failed for',sku,e)}
    finally{delete vendorImgFetching.current[cacheKey]}
  },[products,vendorList]);
  // Helper to get vendor image for an item (used in itemDetails builders)
  const _vImg=(it,field)=>{const k=(it?.sku||'')+'|'+(it?.color||'').toLowerCase();const c=vendorImgs[k];return field==='front'?c?.front||'':c?.back||''};
  // Resolve the best front-image URL for a line item (same priority as itemDetails)
  const _itemImg=(it)=>{const prd=products.find(pp=>pp.id===it.product_id||pp.sku===it.sku);return prd?.image_url||(prd?.images&&prd.images[0])||it._colorImage||_vImg(it,'front')||''};
  // Copy a line item's product image to the clipboard so the rep can paste it to the customer.
  // Tries the actual image first; falls back to copying the URL when the browser/host blocks it (CORS, no ClipboardItem).
  const copyItemImage=async(it)=>{
    const url=_itemImg(it);
    if(!url){nf('No image available for this item','error');return}
    const copyUrl=()=>{navigator.clipboard?.writeText(url).then(()=>nf('📋 Image link copied — paste it to share')).catch(()=>{window.prompt('Copy image link:',url)})};
    if(!navigator.clipboard||!window.ClipboardItem){copyUrl();return}
    try{
      const resp=await fetch(url,{mode:'cors'});
      if(!resp.ok)throw new Error('fetch failed');
      let blob=await resp.blob();
      if(blob.type!=='image/png'){
        blob=await new Promise((resolve,reject)=>{
          const img=new Image();img.crossOrigin='anonymous';
          img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>b?resolve(b):reject(new Error('toBlob failed')),'image/png')};
          img.onerror=()=>reject(new Error('img load failed'));
          img.src=URL.createObjectURL(blob);
        });
      }
      await navigator.clipboard.write([new window.ClipboardItem({'image/png':blob})]);
      nf('🖼️ Image copied — paste it into your email or text');
    }catch(e){copyUrl()}
  };

  const fetchVendorInventory=useCallback(async(sku,vendorId,item)=>{
    const itemRef=item||{vendor_id:vendorId,sku};
    const isSS=isSSItem(itemRef);
    const isSM=isSanMarItem(itemRef);
    const isMT=isMomentecItem(itemRef);
    const isRS=isRichardsonItem(itemRef);
    if(!isSS&&!isSM&&!isMT&&!isRS)return;
    const cacheKey=sku;
    const cached=vendorInvCache.current[cacheKey];
    if(cached&&(Date.now()-cached.fetchedAt)<600000){
      setVendorInv(prev=>({...prev,[sku]:{sizes:cached.sizes,price:cached.price,loading:false,error:null,source:cached.source,nextAvail:cached.nextAvail,sizeNextAvail:cached.sizeNextAvail||{}}}));
      return;
    }
    if(vendorInvFetching.current[cacheKey])return;
    vendorInvFetching.current[cacheKey]=true;
    setVendorInv(prev=>({...prev,[sku]:{sizes:{},price:{},loading:true,error:null,source:isRS?'rs':isMT?'mt':isSM?'sm':'ss'}}));
    try{
      if(isRS){
        // Richardson: pull StockInventory feed grouped by Style; pick the color match for this item
        const sizeQty={};const sizePrice={};const sizeNextAvail={};
        let nextAvail='';
        try{
          const data=await richardsonGetStockInventory(sku);
          const byColor=data?.byColor||{};
          const itemColor=(item?.color||'').toLowerCase().trim();
          // Tokenize a color string for fuzzy match: drop punctuation, split on /, -, space; ignore filler words
          const tokenize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 /-]/g,'').split(/[\s/-]+/).filter(t=>t&&!['solid','heather','dark','light'].includes(t));
          const itemTokens=new Set(tokenize(itemColor));
          // Score colors: count of overlapping tokens (exact match wins outright)
          let pickedColor=null;
          if(itemColor){
            const colors=Object.keys(byColor);
            pickedColor=colors.find(c=>c.toLowerCase()===itemColor);
            if(!pickedColor&&itemTokens.size){
              let bestScore=0;
              colors.forEach(c=>{const ct=new Set(tokenize(c));let s=0;ct.forEach(t=>{if(itemTokens.has(t))s++});if(s>bestScore){bestScore=s;pickedColor=c}});
            }
          }
          // Only collapse feed sizes to OSFA if the product explicitly carries a single OSFA size
          // (older catalog entries set this up manually); otherwise keep feed sizes verbatim.
          const itemSizes=(item?.available_sizes||Object.keys(item?.sizes||{}));
          const productIsOSFA=itemSizes.length===1&&normSzName(itemSizes[0])==='OSFA';
          const normSize=raw=>productIsOSFA?'OSFA':String(raw||'').trim();
          const aggregate=(entry)=>{
            if(!entry)return;
            Object.entries(entry.sizes||{}).forEach(([sz,q])=>{
              const norm=normSize(sz);
              sizeQty[norm]=(sizeQty[norm]||0)+(parseInt(q)||0);
            });
            Object.entries(entry.sizeNextAvail||{}).forEach(([sz,d])=>{
              const norm=normSize(sz);
              if(d&&(!sizeNextAvail[norm]||new Date(d)<new Date(sizeNextAvail[norm])))sizeNextAvail[norm]=d;
            });
            if(entry.nextAvail&&(!nextAvail||new Date(entry.nextAvail)<new Date(nextAvail)))nextAvail=entry.nextAvail;
          };
          if(pickedColor){
            aggregate(byColor[pickedColor]);
          }else{
            // No color match — sum all colors so the user sees style-level availability
            Object.values(byColor).forEach(aggregate);
          }
        }catch(e){console.warn('[Richardson] Inventory fetch error for',sku,e.message);throw e}
        console.log('[Richardson] Inventory result for',sku,':',JSON.stringify(sizeQty),'next:',nextAvail);
        const result={sizes:sizeQty,price:sizePrice,nextAvail,sizeNextAvail,fetchedAt:Date.now(),source:'rs'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,nextAvail,sizeNextAvail,loading:false,error:null,source:'rs'}}));
      }else if(isMT){
        // Momentec: fetch product detail via HCL Commerce to get child SKUs + inventory
        const sizeQty={};const sizePrice={};
        const mtId=item?._mtId;
        try{
          // Get product detail — prefer byId (fast), fall back to search
          let entry=null;
          if(mtId){
            try{const d=await momentecGetProductById(mtId);entry=d?.CatalogEntryView?.[0]}
            catch(e){console.warn('[Momentec] byId failed for',mtId)}
          }
          if(!entry){
            try{const d=await momentecGetProductByPartNumber(sku);entry=d?.CatalogEntryView?.[0]}
            catch(e){console.warn('[Momentec] byPartNumber failed for',sku)}
          }
          if(!entry){
            try{const sr=await momentecSearchProducts(sku,5,1);
              const entries=sr?.CatalogEntryView||sr?.catalogEntryView||[];
              const match=entries.find(e=>(e.partNumber||'')===sku)||entries[0];
              if(match){
                const uid=match.uniqueID;
                if(uid){try{const d2=await momentecGetProductById(uid);entry=d2?.CatalogEntryView?.[0]}catch(e){}}
                if(!entry)entry=match;
              }
            }catch(e){console.warn('[Momentec] Search failed for',sku)}
          }
          if(entry){
            const skus=entry.SKUs||entry.sKUs||[];
            console.log('[Momentec] Product',sku,': SKUs=',skus.length,skus.length>0?'sample:'+JSON.stringify(skus[0]).slice(0,300):'');
            const getSkSize=(e)=>{const attrs=e.Attributes||e.attributes||e.definingAttributes||[];if(Array.isArray(attrs)){for(const a of attrs){const id=(a.identifier||'').toLowerCase();const n=(a.name||'').toLowerCase();if(id==='asgswatchsize'||n==='available sizes'||n==='size'){const vals=a.values||a.Values||[];if(vals.length)return(vals[0].values||vals[0].value||vals[0].identifier||'').trim()}}}return''};
            const getSkColor=(e)=>{const attrs=e.Attributes||e.attributes||e.definingAttributes||[];if(Array.isArray(attrs)){for(const a of attrs){const n=(a.name||a.identifier||'').toLowerCase();if(n==='color'||n==='colour'||n==='clr'||n==='asgswatchcolor'){const vals=a.values||a.Values||[];if(vals.length)return vals.map(v=>v.values||v.value||v.Value||v.identifier||v).join('/')}}}return''};
            const itemColor=(item?.color||'').toLowerCase();
            // Map child SKUs to sizes and extract any inventory data
            const childParts=[];
            for(const sk of skus){
              const skColor=(getSkColor(sk)||'').toLowerCase();
              if(itemColor&&skColor&&!skColor.includes(itemColor.split('/')[0].split(' ')[0].toLowerCase())&&!itemColor.includes(skColor.split('/')[0].split(' ')[0].toLowerCase()))continue;
              const sz=normSzName(getSkSize(sk));
              if(!sz)continue;
              const qty=parseInt(sk.buyQuantity||sk.inventoryQuantity||sk.quantity||0)||0;
              if(qty>0)sizeQty[sz]=(sizeQty[sz]||0)+qty;
              const pn=sk.partNumber||sk.SKUPartNumber||'';
              const uid=sk.uniqueID||'';
              const skuUid=sk.SKUUniqueID||sk.skuUniqueID||uid;
              if(pn||skuUid)childParts.push({pn,uid,skuUid,sz});
            }
            // Try HCL Commerce inventory availability endpoint for child SKUs
            // Correct endpoint: /inventoryavailability/{id} (not /byProductId/ or /byPartNumber/)
            if(Object.keys(sizeQty).length===0&&childParts.length>0){
              // Use SKUUniqueID for child SKU inventory lookups
              const skuIds=childParts.filter(x=>x.skuUid||x.uid).map(x=>x.skuUid||x.uid);
              if(skuIds.length>0){
                try{
                  const invData=await momentecApiCall(`/inventoryavailability/${skuIds.join(',')}`);
                  const invItems=invData?.InventoryAvailability||[];
                  console.log('[Momentec] Inventory:',invItems.length,'items');
                  for(const inv of invItems){
                    const pid=inv.productId||inv.inventoryAvailabilityByProductId||'';
                    const status=(inv.inventoryStatus||'').toLowerCase();
                    const isAvail=status==='available'||status==='instock'||status==='in stock';
                    // Momentec only publishes a binary in-stock flag (availableQuantity comes back
                    // as MAX_DOUBLE), never a real count. Map available→999 ("In Stock"), out→0 ("Out").
                    // Use max so any in-stock SKU wins for a size, and so duplicates don't sum.
                    const rawQty=parseFloat(inv.availableQuantity||0);
                    const qty=(rawQty>999999||isAvail)?999:parseInt(rawQty)||0;
                    const match=childParts.find(x=>(x.skuUid||x.uid)===pid);
                    if(match)sizeQty[match.sz]=Math.max(sizeQty[match.sz]||0,qty);
                  }
                }catch(e){console.warn('[Momentec] Inventory error:',e.message)}
              }
            }
          }
        }catch(e){console.warn('[Momentec] Product detail fetch error for',sku,e.message)}
        // Fallback: if no child SKUs found, try direct inventory check on the parent style
        if(Object.keys(sizeQty).length===0){
          try{
            const invData=await momentecApiCall(`/inventoryavailability/${encodeURIComponent(sku)}`);
            const invItems=invData?.InventoryAvailability||[];
            console.log('[Momentec] Direct inventory for',sku,':',invItems.length,'items');
            for(const inv of invItems){
              const status=(inv.inventoryStatus||'').toLowerCase();
              const isAvail=status==='available'||status==='instock'||status==='in stock';
              const rawQty=parseFloat(inv.availableQuantity||0);
              if(isAvail||rawQty>0){
                // No size breakdown available — mark all sizes as available
                const itemSizes=Object.keys(item?.sizes||{}).filter(s=>s);
                const displaySizes=itemSizes.length>0?itemSizes:(item?.available_sizes||['S','M','L','XL','2XL']);
                displaySizes.forEach(sz=>{sizeQty[normSzName(sz)]=999});
              }
            }
          }catch(e){console.warn('[Momentec] Direct inventory error for',sku,e.message)}
        }
        console.log('[Momentec] Inventory result for',sku,':',JSON.stringify(sizeQty));
        const hasMtInv=Object.values(sizeQty).some(v=>v>0);
        const result={sizes:hasMtInv?sizeQty:{},price:sizePrice,fetchedAt:Date.now(),source:'mt'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:hasMtInv?sizeQty:{},price:sizePrice,loading:false,error:null,source:'mt'}}));
      }else if(isSM){
        // SanMar: fetch inventory + pricing via SOAP API (now returns JSON)
        const prod3=products.find(p=>p.sku===sku);
        const prodColor=prod3?.color||item?.color||'';
        const sizeQty={};const sizePrice={};
        // Primary: PromoStandards getInventoryLevels (more reliable than legacy SOAP)
        let invSuccess=false;
        try{
          console.log('[SanMar] Trying PromoStandards inventory for',sku);
          const promoData=await sanmarGetPromoInventory(sku);
          // Full response dump for diagnostic — past versions kept truncating this
          // to 800 chars and we never saw what the parser was missing.
          console.log('[SanMar] PromoStandards response keys:',Object.keys(promoData||{}),'full:',JSON.stringify(promoData));
          // PromoStandards returns inventory in various nested structures
          const invArr=promoData?.ProductVariationInventoryArray?.ProductVariationInventory
            ||promoData?.productVariationInventoryArray?.productVariationInventory
            ||promoData?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory
            ||promoData?.inventory?.productVariationInventoryArray?.productVariationInventory
            // Also check for direct array of items
            ||promoData?.items||promoData?.Inventory||promoData?.inventory||[];
          const variations=Array.isArray(invArr)?invArr:[invArr];
          console.log('[SanMar] PromoStandards parsed',variations.length,'variations from',Object.keys(promoData||{}).join(','));
          variations.forEach(v=>{
            const sz=normSzName(v?.attributeSize||v?.size||v?.labelSize||'OSFA');
            const color=v?.attributeColor||v?.color||'';
            // Filter by color if we have one
            if(prodColor&&color){
              const pc=prodColor.toLowerCase().split('/')[0].split(' ')[0];
              const vc=color.toLowerCase().split('/')[0].split(' ')[0];
              if(pc&&vc&&!vc.includes(pc)&&!pc.includes(vc))return;
            }
            // QuantityAvailable in partInventoryArray > partInventory
            let qty=0;
            const partArr=v?.partInventoryArray?.partInventory||v?.PartInventoryArray?.PartInventory;
            if(partArr){
              const parts=Array.isArray(partArr)?partArr:[partArr];
              parts.forEach(p=>{
                const q=parseInt(p?.quantityAvailable?.Quantity||p?.quantityAvailable?.quantity||p?.quantityAvailable||0)||0;
                if(q>0)qty+=q;
              });
            }
            if(qty<=0)qty=parseInt(v?.quantityAvailable||v?.totalQty||v?.qty||0)||0;
            if(qty>0){sizeQty[sz]=(sizeQty[sz]||0)+qty;invSuccess=true}
          });
        }catch(e){console.warn('[SanMar] PromoStandards inventory error:',e.message)}
        // Fallback A: legacy getInventoryQtyForStyleColorSize, called per-size.
        // Calling once without a size returns SanMar's aggregate (single row, no
        // per-size breakdown), so we end up with no per-size data. Iterating the
        // item's known sizes makes the result deterministic regardless of how the
        // legacy SOAP groups things.
        if(!invSuccess){
          const knownSizes=Object.keys(item?.sizes||{}).filter(s=>s);
          // If item.sizes is empty (e.g. just-added with no qtys), fall back to a
          // standard SanMar size set so the badges have something to populate.
          const sizesToTry=knownSizes.length>0?knownSizes:['XS','S','M','L','XL','2XL','3XL','4XL'];
          console.log('[SanMar] Per-size legacy fallback for',sku,'sizes:',sizesToTry.join(','),'color:',prodColor||'(any)');
          let perSizeLogged=false;
          // Try the item's color first; if every size comes back empty, retry with no color filter.
          for(const tryColor of [prodColor,'']){
            const before=Object.keys(sizeQty).length;
            await Promise.all(sizesToTry.map(async sz=>{
              try{
                const invData=await sanmarGetInventory(sku,tryColor,sz);
                if(!perSizeLogged){perSizeLogged=true;console.log('[SanMar] RAW per-size response',sku,sz,'=>',JSON.stringify(invData))}
                // Normalize to a list — the legacy SOAP wraps rows in items/listResponse/return,
                // or returns a single root-level object. Mirror smLiveSearch's parser exactly
                // since that path is proven against SanMar's real response shape.
                let rows=invData?.items||[];
                if(!rows.length&&invData?.listResponse)rows=Array.isArray(invData.listResponse)?invData.listResponse:[invData.listResponse];
                if(!rows.length&&invData?.return)rows=Array.isArray(invData.return)?invData.return:[invData.return];
                if(!rows.length&&invData&&(invData.size||invData.totalQty||invData.qty||invData.warehouseInfo))rows=[invData];
                rows=rows.filter(it=>it&&it.errorOccurred!=='true'&&it.errorOccured!=='true');
                let qty=0;
                rows.forEach(it=>{
                  let q=parseInt(it.totalQty||it.qty||it.quantity||0)||0;
                  if(q<=0&&it.warehouseInfo){
                    const details=it.warehouseInfo.inventoryDetail||it.warehouseInfo;
                    const arr=Array.isArray(details)?details:[details];
                    arr.forEach(d=>{if(d&&d.quantity)q+=parseInt(d.quantity)||0});
                  }
                  // Last resort: scan any leftover numeric string field (e.g. inventoryQty)
                  // that isn't a known price/size/identifier — matches smLiveSearch behavior.
                  if(q<=0){Object.entries(it).forEach(([k,v])=>{if(typeof v==='string'&&!['size','labelSize','color','catalogColor','colorName','style','piecePrice','salePrice','programPrice','casePrice','caseQty','customerPrice','myPrice'].includes(k)){const n=parseInt(v)||0;if(n>0)q+=n}})}
                  qty+=q;
                });
                if(qty>0){sizeQty[normSzName(sz)]=(sizeQty[normSzName(sz)]||0)+qty;invSuccess=true}
              }catch(e){console.warn('[SanMar] Per-size inventory error',sku,sz,e.message)}
            }));
            // If this color pass picked up any new sizes, stop here — don't double-count.
            if(Object.keys(sizeQty).length>before)break;
          }
        }
        // Fallback B: original aggregate call. Kept as a last resort in case
        // per-size calls all fail (e.g. for OSFA-only items where the size keys
        // don't match SanMar's catalog spelling). This is the legacy behavior.
        if(!invSuccess){
          for(const tryColor of [prodColor,'']){
            if(invSuccess)break;
            try{
              const invData=await sanmarGetInventory(sku,tryColor,'');
              const firstItem=(invData?.items||[])[0];
              if(firstItem?.errorOccurred==='true'||firstItem?.errorOccured==='true')continue;
              if(invData?.errorOccurred==='true'||invData?.errorOccured==='true')continue;
              let invItems=invData?.items||[];
              if(!invItems.length&&invData?.listResponse){invItems=Array.isArray(invData.listResponse)?invData.listResponse:[invData.listResponse]}
              if(!invItems.length&&invData?.return){invItems=Array.isArray(invData.return)?invData.return:[invData.return]}
              if(!invItems.length&&(invData?.size||invData?.totalQty||invData?.warehouseInfo)){invItems=[invData]}
              invItems.forEach(it=>{
                if(it.errorOccurred==='true'||it.errorOccured==='true')return;
                const sz=normSzName(it.size||it.labelSize||'OSFA');
                let qty=parseInt(it.totalQty||it.qty||it.quantity||0)||0;
                if(qty<=0&&it.warehouseInfo){
                  const details=it.warehouseInfo.inventoryDetail||it.warehouseInfo;
                  const arr=Array.isArray(details)?details:[details];
                  arr.forEach(d=>{if(d&&d.quantity)qty+=parseInt(d.quantity)||0});
                }
                if(qty>0){sizeQty[sz]=(sizeQty[sz]||0)+qty;invSuccess=true}
              });
            }catch(e){console.warn('[SanMar] Legacy inventory error for',sku,'color='+tryColor,e.message)}
          }
        }
        // Fetch pricing
        try{
          const prData=await sanmarGetPricing(sku,prodColor,'');
          const prItems=prData?.items||[];
          prItems.forEach(it=>{
            const sz=normSzName(it.size||it.labelSize||'OSFA');
            const mp=parseFloat(it.myPrice||0);const sp=parseFloat(it.salePrice||0);const pp=parseFloat(it.piecePrice||0);
            const price=mp>0?mp:sp>0?sp:pp>0?pp:0;
            if(price>0)sizePrice[sz]=price;
          });
        }catch(e){console.warn('[SanMar] Pricing fetch error for',sku,e.message)}
        // If we got no inventory data from the inventory endpoint, try product info
        if(Object.keys(sizeQty).length===0){
          try{
            const prodData=await sanmarGetProduct(sku,prodColor,'');
            const prodItems=prodData?.items||[];
            prodItems.forEach(raw=>{
              const bi=raw.productBasicInfo||{};const pi=raw.productPriceInfo||{};
              const it={...bi,...pi,...raw};
              const sz=normSzName(it.size||it.labelSize||'OSFA');
              const qty=parseInt(it.inventoryQty||it.qty||0)||0;
              if(qty>0)sizeQty[sz]=(sizeQty[sz]||0)+qty;
              const price=parseFloat(it.pieceSalePrice||it.piecePrice||it.customerPrice||0);
              if(price>0&&!sizePrice[sz])sizePrice[sz]=price;
            });
          }catch(e){console.warn('[SanMar] Product info fetch error for',sku,e.message)}
        }
        console.log('[SanMar] Inventory result for',sku,':',JSON.stringify(sizeQty),'price:',JSON.stringify(sizePrice));
        const result={sizes:sizeQty,price:sizePrice,fetchedAt:Date.now(),source:'sm'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,loading:false,error:null,source:'sm'}}));
      }else{
        // S&S Activewear: fetch via REST API
        let data;
        try{
          let sid=null;
          try{const st=await ssApiCall('/Styles?search='+encodeURIComponent(sku));const sa=Array.isArray(st)?st:st?[st]:[];const exact=sa.find(s=>String(s.partNumber||s.styleName||'').toLowerCase()===String(sku).toLowerCase());if(exact)sid=exact.styleID;else if(sa.length>0)sid=sa[0].styleID}catch(e){}
          if(sid){data=await ssApiCall('/Products/?style='+encodeURIComponent(sid))}
          else{data=await ssApiCall('/Products?style='+encodeURIComponent(sku))}
        }catch(e){
          try{const padded=sku.length<5&&/^\d+$/.test(sku)?sku.padStart(5,'0'):sku;data=await ssApiCall('/Products?style='+encodeURIComponent(padded))}
          catch(e2){throw e}
        }
        const items=Array.isArray(data)?data:data?[data]:[];
        if(items.length>0)console.log('[S&S] Products sample item:',JSON.stringify(items[0]).slice(0,500));
        const sizeQty={};const sizePrice={};
        const prod3=products.find(p=>p.sku===sku);
        const itemColor=(item?.color||'').toLowerCase();
        const prodColor=prod3?.color?.toLowerCase()||itemColor;
        console.log('[S&S] Inventory for',sku,'color filter:',prodColor,'total items:',items.length);
        items.forEach(it=>{
          const itColor=(it.colorName||'').toLowerCase();
          if(prodColor&&itColor&&!itColor.includes(prodColor.split('/')[0].split(' ')[0].toLowerCase())&&!prodColor.includes(itColor.split('/')[0].split(' ')[0].toLowerCase()))return;
          const sz=it.sizeName||'OSFA';
          const qty=typeof it.qty==='number'?it.qty:parseInt(it.qty)||0;
          sizeQty[sz]=(sizeQty[sz]||0)+qty;
          if(it.customerPrice!=null)sizePrice[sz]=parseFloat(it.customerPrice)||parseFloat(it.piecePrice)||0;
          else if(it.piecePrice!=null)sizePrice[sz]=parseFloat(it.piecePrice)||0;
        });
        console.log('[S&S] Inventory result for',sku,':',JSON.stringify(sizeQty));
        const result={sizes:sizeQty,price:sizePrice,fetchedAt:Date.now(),source:'ss'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,loading:false,error:null,source:'ss'}}));
      }
    }catch(err){
      console.error('[Vendor] Inventory fetch failed for',sku,err);
      setVendorInv(prev=>({...prev,[sku]:{sizes:{},price:{},loading:false,error:err.message,source:isRS?'rs':isMT?'mt':isSM?'sm':'ss'}}));
    }finally{
      delete vendorInvFetching.current[cacheKey];
    }
  },[products,isRichardsonItem,isMomentecItem,isSanMarItem,isSSItem]);

  // Auto-fetch vendor inventory for all S&S, SanMar, Momentec, and Richardson items on the order
  React.useEffect(()=>{
    const items=safeItems(o);
    items.forEach(item=>{
      if((isSSItem(item)||isSanMarItem(item)||isMomentecItem(item)||isRichardsonItem(item))&&!vendorInv[item.sku]&&!vendorInvFetching.current[item.sku]){
        fetchVendorInventory(item.sku,item.vendor_id,item);
      }
    });
  },[o.items?.length]);// only re-run when items are added/removed

  // Sync SanMar line-item cost to the live program price. SanMar's getPricing returns
  // the account's program/contract price (myPrice); without this an item keeps whatever
  // cost was captured when it was first added (often a stale catalog value), so the cost
  // shown drifts from the real program price. Cost-only — never touches unit_sell, so the
  // customer-facing price is left untouched. Skips custom items and any item with a PO/IF
  // already committed (their cost reflects what was actually ordered).
  React.useEffect(()=>{
    if(!Object.keys(vendorInv).length)return;
    const items=safeItems(o);
    if(!items.length)return;
    let changed=false;
    const next=items.map(item=>{
      if(item.is_custom||!isSanMarItem(item))return item;
      if(safePOs(item).length||safePicks(item).length)return item;
      const price=vendorInv[item.sku]?.price;
      if(!price)return item;
      const vals=Object.values(price).map(v=>safeNum(v)).filter(v=>v>0);
      if(!vals.length)return item;
      const base=Math.min(...vals);
      const mergedSizeCosts={...(item._sizeCosts||{})};
      Object.entries(price).forEach(([sz,c])=>{const n=safeNum(c);if(n>0)mergedSizeCosts[sz]=n});
      const costChanged=Math.abs(base-safeNum(item.nsa_cost))>0.005;
      const scChanged=JSON.stringify(mergedSizeCosts)!==JSON.stringify(item._sizeCosts||{});
      if(!costChanged&&!scChanged)return item;
      changed=true;
      return {...item,nsa_cost:base,_sizeCosts:mergedSizeCosts};
    });
    if(changed){setO(e=>({...e,items:next,updated_at:new Date().toLocaleString()}));setDirty(true)}
  },[vendorInv]);// eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch Adidas B2B inventory for Adidas items on the order
  React.useEffect(()=>{
    const items=safeItems(o);
    items.forEach(item=>{
      if(isAdidasItem(item)&&!adidasInv[item.sku]&&!adidasInvFetching.current[item.sku]){
        fetchAdidasInv(item.sku);
      }
    });
  },[o.items?.length]);// only re-run when items are added/removed

  // Auto-fetch vendor product images for API items missing images (for artist dashboard)
  React.useEffect(()=>{
    const items=safeItems(o);
    items.forEach(item=>{
      if(!(isSSItem(item)||isSanMarItem(item)||isMomentecItem(item)))return;
      const prd=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
      const hasImg=prd?.image_url||(prd?.images&&prd.images[0])||item._colorImage;
      if(hasImg)return;
      const cacheKey=item.sku+'|'+(item.color||'').toLowerCase();
      if(vendorImgCache.current[cacheKey]||vendorImgFetching.current[cacheKey])return;
      fetchVendorImage(item.sku,item.color,item.vendor_id,item);
    });
  },[o.items?.length,products]);

  // Sync dirty state to parent dirtyRef
  React.useEffect(()=>{if(dirtyRef)dirtyRef.current=dirty},[dirty,dirtyRef]);
  // Auto-save: persist dirty changes every 30s to prevent data loss on timeout/crash
  // NOTE: does NOT save on unmount — user may have chosen "Leave without saving" via Back button
  // Uses refs for onSave/o/dirty because onSave is an inline arrow (recreated every parent render)
  const oRef=React.useRef(o);React.useEffect(()=>{oRef.current=o},[o]);
  const dirtyRef2=React.useRef(dirty);React.useEffect(()=>{dirtyRef2.current=dirty},[dirty]);
  const onSaveRef=React.useRef(onSave);React.useEffect(()=>{onSaveRef.current=onSave},[onSave]);
  React.useEffect(()=>{
    const doAutoSave=()=>{if(dirtyRef2.current&&oRef.current){onSaveRef.current(oRef.current);dirtyRef2.current=false;setDirty(false)}};
    const iv=setInterval(doAutoSave,30000);
    const handleUnload=()=>doAutoSave();
    window.addEventListener('beforeunload',handleUnload);
    return()=>{clearInterval(iv);window.removeEventListener('beforeunload',handleUnload)};
  },[]);
  // Warn user before closing tab if there are unsaved order changes
  React.useEffect(()=>{
    const h=e=>{if(dirty){e.preventDefault();e.returnValue=''}};
    window.addEventListener('beforeunload',h);
    return()=>window.removeEventListener('beforeunload',h);
  },[dirty]);
  // Adjust inventory when pick is pulled or un-pulled
  const adjustInvForPick=(pick,item,direction)=>{
    // direction: -1 = pulling (decrement inv), +1 = un-pulling (restore inv)
    if(!onAdjustInv)return;
    const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
    if(!p)return;
    const newInv={...p._inv};
    Object.entries(pick).forEach(([k,v])=>{if(k!=='status'&&k!=='pick_id'&&typeof v==='number'&&v>0){newInv[k]=Math.max(0,(newInv[k]||0)+(direction*v))}});
    onAdjustInv(p.id,newInv);
    // Check other SOs for open (unpulled) picks on the same product that now exceed inventory
    if(direction===-1&&allOrders){
      const warnings=[];
      allOrders.forEach(so=>{
        if(so.id===o.id)return; // skip current order
        safeItems(so).forEach(it=>{
          if(it.sku!==item.sku&&it.product_id!==item.product_id)return;
          safePicks(it).forEach(pk=>{
            if(pk.status==='pulled')return; // already pulled, not affected
            const overSizes=[];
            Object.entries(pk).forEach(([sz,qty])=>{
              if(sz==='status'||sz==='pick_id'||typeof qty!=='number'||qty<=0)return;
              if(qty>(newInv[sz]||0))overSizes.push(sz+': needs '+qty+', only '+(newInv[sz]||0));
            });
            if(overSizes.length>0)warnings.push({so:so.id,pick:pk.pick_id||'IF',sizes:overSizes});
          });
        });
      });
      if(warnings.length>0){
        const msg=warnings.map(w=>w.so+' '+w.pick+' ('+w.sizes.join(', ')+')').join('\n');
        setTimeout(()=>nf('⚠️ Inventory conflict! These open IFs now exceed available stock:\n'+msg,'error'),500);
      }
    }
  };
  const[editPick,setEditPick]=useState(null);const[editPO,setEditPO]=useState(null);const[editBatchPO,setEditBatchPO]=useState(null);const[poFullPage,setPoFullPage]=useState(null);const[poEmail,setPoEmail]=useState(null);
  // Shown after a PO partial/full receive — summary modal with Print/Download label actions for the box that was just received.
  const[receivedConfirm,setReceivedConfirm]=useState(null);
  // Open the IF (pick) modal aggregating ALL line items that share the same pick_id.
  // Falls back to single-line edit when no pick_id is set (legacy/unsaved picks).
  const openPickModal=(pickId,fallbackLineIdx,fallbackPickIdx)=>{
    const picks=[];
    if(pickId){
      safeItems(o).forEach((it,li)=>{(it.pick_lines||[]).forEach((pl,pi)=>{if(pl.pick_id===pickId)picks.push({lineIdx:li,pickIdx:pi,pick:{...pl}})})});
    }
    if(picks.length===0){
      const pl=o.items?.[fallbackLineIdx]?.pick_lines?.[fallbackPickIdx];
      if(!pl)return;
      picks.push({lineIdx:fallbackLineIdx,pickIdx:fallbackPickIdx,pick:{...pl}});
    }
    setEditPick({pickId:pickId||picks[0].pick.pick_id||'',picks});
  };
  // Helper: effective PO committed qty for a size (ordered minus cancelled)
  const poCommitted=(poLines,sz)=>(poLines||[]).reduce((a,pk)=>{const ordered=pk[sz]||0;const cancelled=(pk.cancelled||{})[sz]||0;return a+(ordered-cancelled)},0);
  const[newAddr,setNewAddr]=useState('');const[showNA,setShowNA]=useState(false);const[showCustEdit,setShowCustEdit]=useState(false);const[showSzPicker,setShowSzPicker]=useState(null);const[showItemMenu,setShowItemMenu]=useState(null);const[itemMenuPos,setItemMenuPos]=useState(null);const[editingItemName,setEditingItemName]=useState(null);const[showCustom,setShowCustom]=useState(false);const[custItem,setCustItem]=useState({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:'',saveToCatalog:false,image_url:'',images:[],item_type:'apparel'});
  const[aiBuild,setAiBuild]=useState(null);// {step:'input'|'review', inputMode:'text'|'image'|'url', text:'', images:[], url:'', loading:false, error:null, parsed:[], warnings:[], build_id:null}

  // ─── Live S&S Product Search ───
  const[ssResults,setSsResults]=useState([]);// grouped: [{style,styleName,brand,colors:[{colorName,sku,piecePrice,customerPrice,sizes:[{sizeName,qty}]}]}]
  const[ssSearching,setSsSearching]=useState(false);
  const ssSearchTimer=useRef(null);
  const ssSearchCache=useRef({});// cache search results by query
  const ssSearchGen=useRef(0);// generation counter to discard stale results

  const ssLiveSearch=useCallback(async(query)=>{
    if(!query||query.length<2){setSsResults([]);return}
    const cacheKey=query.toLowerCase().trim();
    const cached=ssSearchCache.current[cacheKey];
    if(cached&&(cached.length>0||cached._ts>Date.now()-30000)){setSsResults(cached.length?cached:[]);return}
    const gen=ssSearchGen.current;// track this search generation
    setSsSearching(true);
    try{
      // Search S&S Styles by keyword, then fetch products for matched styles
      let items=[];
      let styleMatches=[];
      try{
        const styles=await ssApiCall('/Styles?search='+encodeURIComponent(query));
        styleMatches=Array.isArray(styles)?styles:styles?[styles]:[];
        console.log('[S&S] Styles search for "'+query+'" →',styleMatches.length,'matches');
      }catch(e){console.warn('[S&S] Styles search failed:',e.message)}
      if(styleMatches.length>0){
        const styleIDs=[...new Set(styleMatches.map(s=>s.styleID).filter(Boolean))].slice(0,5);
        if(styleIDs.length){
          try{
            const data=await ssApiCall('/Products/?style='+encodeURIComponent(styleIDs.join(',')));
            items=Array.isArray(data)?data:data?[data]:[];
            console.log('[S&S] Got',items.length,'products for styles',styleIDs);
          }catch(e){console.warn('[S&S] Products fetch failed:',e.message)}
        }
      }
      if(!items.length){
        // Cache empty result with TTL so we can retry after 30s
        ssSearchCache.current[cacheKey]={length:0,_ts:Date.now()};
        if(gen===ssSearchGen.current)setSsResults([]);
        return;
      }
      // Group by style → one entry per style, with colors array inside
      const styleMap={};
      items.forEach(it=>{
        const sid=it.styleID||it.styleName||query;
        let imgUrl=it.colorFrontImage||it.colorSideImage||'';
        if(imgUrl&&imgUrl.startsWith('http://'))imgUrl=imgUrl.replace('http://','https://');
        let backUrl=it.colorBackImage||'';
        if(backUrl&&backUrl.startsWith('http://'))backUrl=backUrl.replace('http://','https://');
        if(!styleMap[sid]){
          const sInfo=styleMatches.find(s=>String(s.styleID)===String(sid))||{};
          styleMap[sid]={
            styleID:sid,
            styleName:sInfo.title||(it.brandName?(it.brandName+' '+(it.styleName||query)):it.styleName||query),
            brandName:it.brandName||sInfo.brandName||'',
            sku:(it.styleName||sInfo.partNumber||query).toUpperCase(),
            styleImage:sInfo.styleImage||imgUrl||'',
            customerPrice:0,piecePrice:0,totalQty:0,
            colors:{},_source:'ss'
          };
        }
        const color=it.colorName||'';
        const cKey=sid+'|'+color;
        if(!styleMap[sid].colors[cKey])styleMap[sid].colors[cKey]={
          colorName:color,colorFrontImage:imgUrl,colorBackImage:backUrl,
          customerPrice:parseFloat(it.customerPrice)||0,
          piecePrice:parseFloat(it.piecePrice)||0,
          sizes:[],totalQty:0
        };
        const cEntry=styleMap[sid].colors[cKey];
        if(imgUrl&&!cEntry.colorFrontImage)cEntry.colorFrontImage=imgUrl;
        if(backUrl&&!cEntry.colorBackImage)cEntry.colorBackImage=backUrl;
        const sz=it.sizeName||'OSFA';
        const qty=typeof it.qty==='number'?it.qty:parseInt(it.qty)||0;
        const p=parseFloat(it.customerPrice)||parseFloat(it.piecePrice)||0;
        cEntry.sizes.push({sizeName:sz,qty,price:p});
        cEntry.totalQty+=qty;
        if(p>0&&(cEntry.customerPrice===0||p<cEntry.customerPrice))cEntry.customerPrice=p;
        // Aggregate at style level
        styleMap[sid].totalQty+=qty;
        if(p>0&&(styleMap[sid].customerPrice===0||p<styleMap[sid].customerPrice))styleMap[sid].customerPrice=p;
      });
      // Convert colors objects to arrays
      const results=Object.values(styleMap).map(s=>({...s,colors:Object.values(s.colors)}));
      ssSearchCache.current[cacheKey]=results;
      if(gen===ssSearchGen.current)setSsResults(results);
    }catch(err){
      console.error('[S&S] Search failed:',err);
      if(gen===ssSearchGen.current)setSsResults([]);
    }finally{if(gen===ssSearchGen.current)setSsSearching(false)}
  },[]);

  // ─── Live SanMar Product Search ───
  const[smResults,setSmResults]=useState([]);
  const[smSearching,setSmSearching]=useState(false);
  const smSearchTimer=useRef(null);
  const smSearchCache=useRef({});
  const smSearchGen=useRef(0);

  const smLiveSearch=useCallback(async(query)=>{
    if(!query||query.length<2){setSmResults([]);return}
    const cacheKey=query.toLowerCase().trim();
    const cached=smSearchCache.current[cacheKey];
    if(cached&&(cached.length>0||cached._ts>Date.now()-30000)){setSmResults(cached.length?cached:[]);return}
    const gen=smSearchGen.current;
    setSmSearching(true);
    try{
      // SanMar: search by style via product info service (uppercase — SanMar is case-sensitive)
      const q=query.toUpperCase().trim();
      const prodData=await sanmarGetProduct(q);
      const rawItems=prodData?.items||[];
      // Filter out bogus results: SanMar returns empty/partial items for styles it doesn't carry
      const items=rawItems.filter(raw=>{
        const bi=raw.productBasicInfo||raw;
        const pi=raw.productPriceInfo||raw;
        // Must have a real brand name AND a non-zero price — bogus results have neither
        return !!(bi.brandName)&&parseFloat(pi.piecePrice||pi.casePrice||0)>0;
      });
      if(!items.length){smSearchCache.current[cacheKey]={length:0,_ts:Date.now()};if(gen===smSearchGen.current)setSmResults([]);return}
      // Fetch inventory and program pricing in parallel
      let invData={};
      let pricingMap={};// key: color|size → program price
      try{
        const [invRes,priceRes]=await Promise.all([
          sanmarGetInventory(q,'','').catch(e=>{console.warn('[SanMar] Inventory fetch failed:',e);return null}),
          sanmarGetPricing(q,'','').catch(e=>{console.warn('[SanMar] Pricing fetch failed:',e);return null})
        ]);
        if(priceRes)console.log('[SanMar] Raw pricing response keys:',Object.keys(priceRes),priceRes.items?'items:'+priceRes.items.length:'no items');
        // Parse inventory response — try multiple paths (items, listResponse, return, or root-level)
        if(invRes)console.log('[SanMar] Inventory response keys:',Object.keys(invRes));
        let smInvItems=invRes?.items||[];
        if(!smInvItems.length&&invRes?.listResponse){smInvItems=Array.isArray(invRes.listResponse)?invRes.listResponse:[invRes.listResponse]}
        if(!smInvItems.length&&invRes?.return){smInvItems=Array.isArray(invRes.return)?invRes.return:[invRes.return]}
        if(!smInvItems.length&&invRes&&(invRes.size||invRes.totalQty||invRes.warehouseInfo)){smInvItems=[invRes]}
        // Filter out error items
        smInvItems=smInvItems.filter(it=>it.errorOccurred!=='true'&&it.errorOccured!=='true');
        if(smInvItems.length>0)console.log('[SanMar] Inventory sample:',JSON.stringify(smInvItems[0]).slice(0,400));
        smInvItems.forEach(it=>{
          const key=(it.color||it.colorName||'')+'|'+normSzName(it.size||it.labelSize||'');
          let qty=parseInt(it.totalQty||it.qty||it.quantity||0)||0;
          if(qty<=0&&it.warehouseInfo){const d=it.warehouseInfo.inventoryDetail||it.warehouseInfo;const arr=Array.isArray(d)?d:[d];arr.forEach(w=>{if(w&&w.quantity)qty+=parseInt(w.quantity)||0})}
          if(qty<=0){Object.entries(it).forEach(([k,v])=>{if(typeof v==='string'&&!['size','labelSize','color','catalogColor','colorName','style','piecePrice','salePrice','programPrice','casePrice','caseQty','customerPrice','myPrice'].includes(k)){const n=parseInt(v)||0;if(n>0)qty+=n}})}
          invData[key]=qty;
        });
        const priceItems=priceRes?.items||[];
        if(priceItems.length>0)console.log('[SanMar] Pricing sample item:',JSON.stringify(priceItems[0]));
        priceItems.forEach(it=>{
          const color=it.catalogColor||it.color||it.colorName||'';
          const sz=normSzName(it.size||it.labelSize||'');
          // myPrice = customer/program price, salePrice = sale price, piecePrice = list price
          const mp=parseFloat(it.myPrice||0);
          const sp=parseFloat(it.salePrice||0);
          const pp=parseFloat(it.piecePrice||0);
          const price=mp>0?mp:sp>0?sp:pp>0?pp:0;
          if(price>0)pricingMap[color+'|'+sz]=price;
        });
        console.log('[SanMar] Pricing loaded:',Object.keys(pricingMap).length,'entries, sample prices:', Object.entries(pricingMap).slice(0,3));
      }catch(e){/* inventory/pricing fetch optional */}
      // Group by style → one entry per style, with colors array inside
      // SanMar items have nested sub-objects: productBasicInfo, productImageInfo, productPriceInfo
      const styleMap={};
      items.forEach(raw=>{
        // Flatten nested SanMar product structure into a single object
        const bi=raw.productBasicInfo||{};
        const ii=raw.productImageInfo||{};
        const pi=raw.productPriceInfo||{};
        if(!styleMap[query]&&Object.keys(styleMap).length===0)console.log('[SanMar] Product priceInfo fields:',Object.keys(pi),'values:',JSON.stringify(pi));
        const it={...bi,...ii,...pi,...raw};
        const sid=it.style||it.styleNumber||query;
        const color=it.catalogColor||it.color||it.colorName||it.productColor||'';
        if(!styleMap[sid])styleMap[sid]={
          styleID:sid,
          styleName:(it.brandName||it.brand||'')+' '+(it.productTitle||it.styleName||it.description||query),
          brandName:it.brandName||it.brand||'',
          sku:sid,
          styleImage:it.colorProductImageThumbnail||it.thumbnailImage||it.colorProductImage||it.productImage||'',
          customerPrice:0,piecePrice:0,totalQty:0,
          colors:{},_source:'sm',_availSizes:it.availableSizes||''
        };
        const cKey=sid+'|'+color;
        if(!styleMap[sid].colors[cKey])styleMap[sid].colors[cKey]={
          colorName:color,
          colorFrontImage:it.colorProductImageThumbnail||it.colorProductImage||it.colorSwatchImage||it.productImage||'',
          colorBackImage:it.colorProductImageBackThumbnail||it.colorProductImageBack||it.colorProductBackImage||'',
          customerPrice:0,
          piecePrice:0,
          sizes:[],totalQty:0
        };
        const cEntry=styleMap[sid].colors[cKey];
        const sz=normSzName(it.size||it.labelSize||it.sizeCode||'OSFA');
        const invKey=color+'|'+sz;
        const qty=invData[invKey]||parseInt(it.inventoryQty||it.qty||0)||0;
        // Prefer program price from pricing API, fall back to product info price
        const progPrice=pricingMap[color+'|'+sz]||0;
        const price=progPrice>0?progPrice:parseFloat(it.pieceSalePrice||it.piecePrice||it.price||it.customerPrice||0);
        cEntry.sizes.push({sizeName:sz,qty,price});
        cEntry.totalQty+=qty;
        if(price>0&&(cEntry.customerPrice===0||price<cEntry.customerPrice))cEntry.customerPrice=price;
        styleMap[sid].totalQty+=qty;
        if(price>0&&(styleMap[sid].customerPrice===0||price<styleMap[sid].customerPrice))styleMap[sid].customerPrice=price;
      });
      // Filter out styles with no price or no real colors (bogus SanMar results)
      const results=Object.values(styleMap).map(s=>({...s,colors:Object.values(s.colors)})).filter(s=>s.customerPrice>0&&s.colors.length>0);
      smSearchCache.current[cacheKey]=results;
      if(gen===smSearchGen.current)setSmResults(results);
    }catch(err){
      console.error('[SanMar] Search failed:',err);
      if(gen===smSearchGen.current)setSmResults([]);
    }finally{if(gen===smSearchGen.current)setSmSearching(false)}
  },[]);

  // ─── Live Momentec Product Search ───
  const[mtResults,setMtResults]=useState([]);
  const[mtSearching,setMtSearching]=useState(false);
  const mtSearchTimer=useRef(null);
  const mtSearchCache=useRef({});
  const mtSearchGen=useRef(0);

  const mtLiveSearch=useCallback(async(query)=>{
    if(!query||query.length<2){setMtResults([]);return}
    const cacheKey=query.toLowerCase().trim();
    const cached=mtSearchCache.current[cacheKey];
    if(cached&&(cached.length>0||cached._ts>Date.now()-30000)){setMtResults(cached.length?cached:[]);return}
    const gen=mtSearchGen.current;
    setMtSearching(true);
    try{
      const data=await momentecSearchProducts(query,50,1);
      const rawEntries=data?.CatalogEntryView||[];
      // Filter results to those whose partNumber or name actually match the search term
      const qLower=query.toLowerCase().trim();
      const entries=rawEntries.filter(e=>{
        const pn=(e.partNumber||'').toLowerCase();
        const nm=(e.name||'').toLowerCase();
        return pn.includes(qLower)||nm.includes(qLower);
      });
      if(!entries.length){mtSearchCache.current[cacheKey]={length:0,_ts:Date.now()};if(gen===mtSearchGen.current)setMtResults([]);return}
      // Helper: extract wholesale/offer price from an HCL Commerce entry
      const getOfferPrice=(e)=>{
        const prices=e.Price||e.price||[];
        if(!prices.length)console.warn('[Momentec] No Price array on',e.partNumber||e.name,{keys:Object.keys(e),offerPrice:e.offerPrice,salePrice:e.salePrice,listPrice:e.listPrice});
        // Prefer Offer usage (wholesale/dealer price)
        let offer=0,display=0;
        if(prices.length){for(const p of prices){const u=(p.usage||p.priceUsage||'').toLowerCase();const v=parseFloat(p.SKUPriceValue||p.priceValue||0);if(v>0){if(u==='offer'||u==='sale')offer=v;else if(u==='display'||u==='list')display=v}}}
        if(offer>0)return offer;
        // Try offerPrice/salePrice fields
        const op=parseFloat(e.offerPrice||e.salePrice||0);if(op>0)return op;
        // Fall back to Display/List * 0.5 (retail-to-wholesale estimate) — this is a guess, not real pricing.
        // Log it so we can identify entries where Momentec didn't return an Offer price.
        if(display>0){console.warn('[Momentec] No Offer price on',e.partNumber||e.name,'— estimating wholesale as Display * 0.5 =',(display*0.5).toFixed(2));return display*0.5}
        const lp=parseFloat(e.listPrice||0);if(lp>0){console.warn('[Momentec] No Offer/Display price on',e.partNumber||e.name,'— estimating wholesale as listPrice * 0.5 =',(lp*0.5).toFixed(2));return lp*0.5}
        // Last resort: lowest price in array
        let min=Infinity;if(prices.length){for(const p of prices){const v=parseFloat(p.SKUPriceValue||p.priceValue||0);if(v>0&&v<min)min=v}}
        return min<Infinity?min:0;
      };
      // Helper: extract color name from attributes array (handles both Attributes and attributes, HCL Commerce field casing)
      const getColor=(e)=>{
        const attrs=e.Attributes||e.attributes||e.definingAttributes||[];
        if(Array.isArray(attrs)){for(const a of attrs){const n=(a.name||a.identifier||'').toLowerCase();if(n==='color'||n==='colour'||n==='clr'||n==='asgswatchcolor'){const vals=a.values||a.Values||[];if(vals.length)return vals.map(v=>v.values||v.value||v.Value||v.identifier||v).join('/')}}}
        return '';
      };
      // Helper: extract size from SKU attributes
      const getSize=(e)=>{
        const attrs=e.Attributes||e.attributes||e.definingAttributes||[];
        if(Array.isArray(attrs)){for(const a of attrs){const id=(a.identifier||'').toLowerCase();const n=(a.name||'').toLowerCase();if(id==='asgswatchsize'||n==='available sizes'||n==='size'){const vals=a.values||a.Values||[];if(vals.length)return(vals[0].values||vals[0].value||vals[0].identifier||'').trim()}}}
        return '';
      };
      // Collect unique base part numbers from search results (limit to first 10)
      const baseSkus=[];const seenBase=new Set();
      for(const e of entries){
        const fullSku=e.partNumber||'';
        const isItem=e.catalogEntryTypeCode==='ItemBean';
        const baseSku=isItem&&fullSku.includes('-')?fullSku.split('-')[0]:fullSku;
        if(!seenBase.has(baseSku)){seenBase.add(baseSku);baseSkus.push({baseSku,entry:e})}
      }
      // Fetch full product details for each base SKU (prices, colors, child SKUs)
      // Try byPartNumber first, fall back to byId using uniqueID from search result
      const detailPromises=baseSkus.slice(0,10).map(async({baseSku,entry})=>{
        try{const d=await momentecGetProductByPartNumber(baseSku);return{baseSku,entry,detail:d?.CatalogEntryView?.[0]||null}}
        catch(e){
          // byPartNumber often 404s — try byId using the uniqueID from search
          const uid=entry.uniqueID;
          if(uid){try{const d2=await momentecGetProductById(uid);return{baseSku,entry,detail:d2?.CatalogEntryView?.[0]||null}}catch(e2){}}
          return{baseSku,entry,detail:null}
        }
      });
      const details=await Promise.all(detailPromises);
      if(gen!==mtSearchGen.current)return;// stale
      // Momentec dealer discount (15% off wholesale)
      const mtVendor=vendorList.find(v=>v.api_provider==='momentec'||v.name==='Momentec');
      const mtDiscount=mtVendor?.api_price_discount||0.15;
      const mtCost=p=>{const v=p*(1-mtDiscount);return Math.round(v*100)/100};
      // Build style map from detailed results
      const styleMap={};
      for(const{baseSku,entry,detail}of details){
        const src=detail||entry;// prefer detail if available
        const price=mtCost(getOfferPrice(src));
        const mtBackImg=src.fullImageBack||src.backImage||entry.fullImageBack||entry.backImage||'';
        // Build color→swatch image map from top-level Attributes (per-color product images aren't available from API)
        const colorImgMap={};
        const topAttrs=src.Attributes||src.attributes||[];
        if(Array.isArray(topAttrs)){for(const a of topAttrs){const aId=(a.identifier||'').toLowerCase();if(aId==='asgswatchcolor'||aId==='asgswatchcolorfamily'||(a.name||'').toLowerCase()==='color'||(a.name||'').toLowerCase()==='colorfamily'){const vals=a.values||a.Values||[];for(const v of vals){const cName=v.values||v.value||v.identifier||'';const ext=v.extendedValue||[];const imgEntry=ext.find(e=>e.key==='Image1Path')||ext.find(e=>e.key==='Image1');if(cName&&imgEntry){const imgPath=imgEntry.value||'';if(imgPath)colorImgMap[cName]='https://www.momentecbrands.com/wcsstore/'+imgPath}}}}}
        styleMap[baseSku]={sku:baseSku,styleName:src.title||src.name||entry.name||baseSku,brandName:src.manufacturer||entry.manufacturer||'Momentec',
          styleImage:src.thumbnail||src.fullImage||entry.thumbnail||entry.fullImage||'',
          styleBackImage:mtBackImg,
          colors:{},_mtId:src.uniqueID||entry.uniqueID,_mtPrice:price>0?price:0};
        const style=styleMap[baseSku];
        // Process child SKUs from detailed response for colors (HCL Commerce uses both SKUs and sKUs casing)
        const skus=src.SKUs||src.sKUs||detail?.SKUs||detail?.sKUs||[];
        if(skus.length){
          // Sizes considered "base" (no upcharge) — use these to set the color's base price
          const BASE_SIZES=new Set(['XS','S','SM','M','MD','L','LG','XL']);
          for(const sk of skus){
            const skPrice=mtCost(getOfferPrice(sk));const skColor=getColor(sk)||'Default';const skSize=getSize(sk);
            const skImg=colorImgMap[skColor]||sk.thumbnail||sk.fullImage||'';
            const skBackImg=sk.fullImageBack||sk.backImage||'';
            const isBaseSize=skSize&&BASE_SIZES.has(skSize.toUpperCase());
            if(!style.colors[skColor]){
              style.colors[skColor]={colorName:skColor,sku:sk.partNumber||sk.SKUPartNumber||baseSku,piecePrice:skPrice,customerPrice:skPrice,
                colorFrontImage:skImg||style.styleImage,colorBackImage:skBackImg||style.styleBackImage||'',sizes:[],totalQty:0,_basePriceFromBaseSize:isBaseSize};
            }else{const c=style.colors[skColor];
              // Prefer base-size pricing: if we haven't locked in a base-size price yet, or this is a base size with a lower price, update.
              // This avoids the bug where a color's "base" price is set to a 2XL+ upcharge because base-size SKUs were missing/late.
              if(skPrice>0){
                const shouldUpdate=isBaseSize&&!c._basePriceFromBaseSize
                  ||isBaseSize&&c._basePriceFromBaseSize&&skPrice<c.customerPrice
                  ||!isBaseSize&&!c._basePriceFromBaseSize&&(c.customerPrice===0||skPrice<c.customerPrice);
                if(shouldUpdate){c.customerPrice=skPrice;c.piecePrice=skPrice;if(isBaseSize)c._basePriceFromBaseSize=true}
              }
              if(skImg&&!c.colorFrontImage)c.colorFrontImage=skImg;if(skBackImg&&!c.colorBackImage)c.colorBackImage=skBackImg}
            // Add size entry with per-size price (sizes like 3XL+ are more expensive)
            if(skSize){const c=style.colors[skColor];if(!c.sizes.find(s=>s.sizeName===skSize)){c.sizes.push({sizeName:skSize,qty:0,price:skPrice})}}
            if(skPrice>0&&(style._mtPrice===0||skPrice<style._mtPrice))style._mtPrice=skPrice;
          }
          // Normalize base-size per-size prices to the color's locked base price.
          // Momentec sometimes omits Offer pricing on individual base-size SKUs, causing
          // getOfferPrice to fall back to display*0.5 (a guess) — that produces phantom
          // upcharges on S/M/L/XL that contradict the customerPrice shown in search.
          // Upcharge sizes (2XL+) keep their per-SKU price.
          Object.values(style.colors).forEach(c=>{
            if(c.customerPrice>0){
              c.sizes.forEach(s=>{
                if(s.sizeName&&BASE_SIZES.has(s.sizeName.toUpperCase()))s.price=c.customerPrice;
              });
            }
            delete c._basePriceFromBaseSize;
          });
        }
        // If no child SKUs found, add single color from attributes or default
        if(!Object.keys(style.colors).length){
          const colorName=getColor(src)||'Default';
          style.colors[colorName]={colorName,sku:baseSku,piecePrice:price,customerPrice:price,
            colorFrontImage:colorImgMap[colorName]||style.styleImage,colorBackImage:style.styleBackImage||'',sizes:[],totalQty:0};
        }
      }
      // Convert colors map to array
      for(const k of Object.keys(styleMap)){styleMap[k].colors=Object.values(styleMap[k].colors)}
      const results=Object.values(styleMap);
      mtSearchCache.current[cacheKey]=results;
      if(gen===mtSearchGen.current)setMtResults(results);
    }catch(err){
      console.error('[Momentec] Search failed:',err);
      if(gen===mtSearchGen.current)setMtResults([]);
    }finally{if(gen===mtSearchGen.current)setMtSearching(false)}
  },[]);

  // ─── Live Richardson Product Search (StockInventory feed) ───
  const[rsResults,setRsResults]=useState([]);
  const[rsSearching,setRsSearching]=useState(false);
  const rsSearchTimer=useRef(null);
  const rsSearchCache=useRef({});
  const rsSearchGen=useRef(0);

  const rsLiveSearch=useCallback(async(query)=>{
    if(!query||query.length<2){setRsResults([]);return}
    const cacheKey=query.toLowerCase().trim();
    const cached=rsSearchCache.current[cacheKey];
    if(cached&&(cached.length>0||cached._ts>Date.now()-30000)){setRsResults(cached.length?cached:[]);return}
    const gen=rsSearchGen.current;
    setRsSearching(true);
    try{
      const data=await richardsonSearchStyles(query);
      const matches=data?.results||[];
      // Try to enrich pricing from any matching catalog product (Richardson pricing isn't in the feed)
      const rsVendor=vendorList.find(v=>v.api_provider==='richardson'||v.name==='Richardson');
      const rsVendorId=rsVendor?.id||'v5';
      const results=matches.map(m=>{
        const catMatch=products.find(p=>p.sku.toLowerCase()===m.style.toLowerCase());
        // Prefer catalog cost; fall back to Richardson Level-4 price list; 0 only if neither
        const rsLevel4=getRichardsonLevel4Price(m.style);
        const baseCost=catMatch?.nsa_cost||rsLevel4||0;
        const baseRetail=catMatch?.retail_price||0;
        // Build colors array in the shape addSearchProduct + UI expect
        const colors=Object.entries(m.byColor||{}).map(([colorName,info])=>{
          const sizes=Object.entries(info.sizes||{}).map(([sz,qty])=>({sizeName:sz,qty:parseInt(qty)||0,price:baseCost,nextAvail:info.sizeNextAvail?.[sz]||''}));
          const totalQty=Object.values(info.sizes||{}).reduce((a,v)=>a+(parseInt(v)||0),0);
          return {colorName,sku:m.style,piecePrice:baseCost,customerPrice:baseCost,
            colorFrontImage:'',colorBackImage:'',sizes,totalQty,
            nextAvail:info.nextAvail||'',sizeNextAvail:info.sizeNextAvail||{}};
        });
        return {
          sku:m.style,
          styleName:catMatch?.name||m.style,
          brandName:'Richardson',
          styleImage:catMatch?.image_front_url||'',
          styleBackImage:catMatch?.image_back_url||'',
          colors,
          customerPrice:baseCost,
          totalQty:m.totalQty||0,
          _rsVendorId:rsVendorId,
          _rsCatalogMatch:!!catMatch,
          _rsPriceSource:catMatch?.nsa_cost?'catalog':(rsLevel4?'level4':'none'),
        };
      });
      rsSearchCache.current[cacheKey]=results;
      if(gen===rsSearchGen.current)setRsResults(results);
    }catch(err){
      console.error('[Richardson] Search failed:',err);
      if(gen===rsSearchGen.current)setRsResults([]);
    }finally{if(gen===rsSearchGen.current)setRsSearching(false)}
  },[products,vendorList]);

  // Debounced S&S + SanMar + Momentec + Richardson search when typing in Add Product search OR Copy SKU modal
  React.useEffect(()=>{
    if(ssSearchTimer.current)clearTimeout(ssSearchTimer.current);
    if(smSearchTimer.current)clearTimeout(smSearchTimer.current);
    if(mtSearchTimer.current)clearTimeout(mtSearchTimer.current);
    if(rsSearchTimer.current)clearTimeout(rsSearchTimer.current);
    // Determine active query: Add Product takes precedence, else Copy SKU modal
    const copyQ=copySkuModal?.search||'';
    const activeQ=showAdd?pS:copyQ;
    const isActive=showAdd||!!copySkuModal;
    if(!isActive||!activeQ||activeQ.length<2){setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);ssSearchGen.current++;smSearchGen.current++;mtSearchGen.current++;rsSearchGen.current++;setExpandedStyle(null);return}
    // Bump generation to discard in-flight results from previous keystrokes
    ssSearchGen.current++;smSearchGen.current++;mtSearchGen.current++;rsSearchGen.current++;setExpandedStyle(null);
    const localCount=allFp.length;
    const delay=localCount>5?800:400;
    ssSearchTimer.current=setTimeout(()=>ssLiveSearch(activeQ),delay);
    smSearchTimer.current=setTimeout(()=>smLiveSearch(activeQ),delay+100);
    mtSearchTimer.current=setTimeout(()=>mtLiveSearch(activeQ),delay+200);
    rsSearchTimer.current=setTimeout(()=>rsLiveSearch(activeQ),delay+50);
    return()=>{if(ssSearchTimer.current)clearTimeout(ssSearchTimer.current);if(smSearchTimer.current)clearTimeout(smSearchTimer.current);if(mtSearchTimer.current)clearTimeout(mtSearchTimer.current);if(rsSearchTimer.current)clearTimeout(rsSearchTimer.current)};
  },[pS,showAdd,copySkuModal?.search]);

  // When color picker modal opens, fetch the SKU's vendor data to populate colors list
  React.useEffect(()=>{
    if(!colorPickerModal)return;
    const{sku,source}=colorPickerModal;if(!sku||!source)return;
    ssSearchGen.current++;smSearchGen.current++;mtSearchGen.current++;rsSearchGen.current++;
    if(source==='ss')ssLiveSearch(sku);
    else if(source==='sm')smLiveSearch(sku);
    else if(source==='mt')mtLiveSearch(sku);
    else if(source==='rs')rsLiveSearch(sku);
  },[colorPickerModal,ssLiveSearch,smLiveSearch,mtLiveSearch,rsLiveSearch]);

  // Add a vendor search result as a line item (works for S&S, SanMar, and Momentec)
  // style = the style-level result, color = the selected color from style.colors
  const addSearchProduct=(style,color,source)=>{
    const isSM=source==='sm';
    const isMT=source==='mt';
    const isRS=source==='rs';
    const vendor=vendorList.find(v=>isRS?(v.api_provider==='richardson'||v.name==='Richardson'):isMT?(v.api_provider==='momentec'||v.name==='Momentec'):isSM?(v.api_provider==='sanmar'||v.name==='SanMar'):(v.api_provider==='ss_activewear'||v.name==='S&S Activewear'));
    const vId=vendor?.id||(isRS?'v5':isMT?'v8':isSM?'v3':'v4');
    const cost=color.customerPrice||color.piecePrice||0;
    const sell=rQ(cost*(o.default_markup||1.65));
    // Try to match a catalog product for this SKU to get its full available_sizes
    const catMatch=products.find(p=>p.sku===style.sku&&(!color.colorName||p.color===color.colorName))||products.find(p=>p.sku===style.sku);
    // Build available sizes: start with sizes from API, merge with catalog product sizes and standard sizes.
    // For Richardson, trust the feed's size tokens verbatim (e.g. "Y", "XS-SM", "SM-MD", "LG-XL").
    const apiSizes=isRS?color.sizes.map(s=>s.sizeName).filter(Boolean):color.sizes.map(s=>s.sizeName).filter(s=>s&&SZ_ORD.includes(s));
    const catSizes=isRS?(catMatch?.available_sizes||[]):(catMatch?.available_sizes||[]).filter(s=>SZ_ORD.includes(s));
    // SanMar provides availableSizes as comma-separated string
    const smSizes=style._availSizes?style._availSizes.split(/[,;]\s*/).map(s=>normSzName(s.trim())).filter(s=>s&&SZ_ORD.includes(s)):[];
    // For non-RS items keep the legacy default; for Richardson use only what the feed gives us.
    const STD_SIZES=isRS?[]:['S','M','L','XL','2XL'];
    let availSizes=[...new Set([...apiSizes,...catSizes,...smSizes,...STD_SIZES])];
    availSizes=availSizes.sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
    const vInv={};const vNextBySize={};
    color.sizes.forEach(s=>{
      // Skip qty=0 — see comment at the other call sites: live-search aggregate
      // inventory often reports 0 for sizes that actually have stock, and seeding
      // 0s here makes every size badge render "0 sm" until a manual refresh.
      if(s.qty>0)vInv[s.sizeName]=(vInv[s.sizeName]||0)+s.qty;
      if(s.nextAvail&&(!vNextBySize[s.sizeName]||new Date(s.nextAvail)<new Date(vNextBySize[s.sizeName])))vNextBySize[s.sizeName]=s.nextAvail;
    });
    const liveFlag=isRS?'_rs_live':isMT?'_mt_live':isSM?'_sm_live':'_ss_live';
    const fallbackSizes=isRS?(availSizes.length?availSizes:['OSFA']):['S','M','L','XL','2XL'];
    const newItem={
      product_id:catMatch?.id||null,sku:style.sku,name:nameWithBrand(style.styleName,style.brandName),brand:style.brandName,
      vendor_id:vId,color:color.colorName,nsa_cost:cost,retail_price:catMatch?.retail_price||0,
      unit_sell:sell,available_sizes:availSizes.length?availSizes:fallbackSizes,
      sizes:{},qty_only:false,decorations:[],no_deco:true,
      is_custom:false,[liveFlag]:true,
      _colorImage:color.colorFrontImage||style.styleImage||'',
      _colorBackImage:color.colorBackImage||'',
      ...(isMT&&style._mtId?{_mtId:style._mtId}:{})
    };
    // Build per-size cost map (e.g. 2XL+ costs more than S-XL)
    const sizePrice={};color.sizes.forEach(s=>{sizePrice[s.sizeName]=s.price||cost});
    newItem._sizeCosts=sizePrice;
    // Build per-size sell map (apply markup to each size's cost)
    const mk=o.default_markup||1.65;
    const sizeSell={};Object.entries(sizePrice).forEach(([sz,c])=>{sizeSell[sz]=rQ(c*mk)});
    newItem._sizeSells=sizeSell;
    sv('items',[...o.items,newItem]);
    // Pre-cache only when the live-search returned real per-size qty data; otherwise
    // let fetchVendorInventory do a per-size lookup so badges actually populate. If
    // we cached an empty {} here, the auto-fetch effect would short-circuit on it.
    if(Object.keys(vInv).length>0){
      vendorInvCache.current[style.sku]={sizes:vInv,price:sizePrice,fetchedAt:Date.now(),source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize};
      setVendorInv(prev=>({...prev,[style.sku]:{sizes:vInv,price:sizePrice,loading:false,error:null,source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize}}));
    }else{
      fetchVendorInventory(style.sku,vId,newItem);
    }
    setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);setExpandedStyle(null);
  };
  // State for expanded style in search results (shows color picker)
  const[expandedStyle,setExpandedStyle]=useState(null);// {key:'ss-0', style:{...}}
  const[expandColorQ,setExpandColorQ]=useState('');// color filter for the expanded style's swatch list
  useEffect(()=>{setExpandColorQ('')},[expandedStyle]);
  const filterExpColors=(arr)=>{const q=expandColorQ.trim().toLowerCase();return q?(arr||[]).filter(c=>(c.colorName||'').toLowerCase().includes(q)):(arr||[])};
  const expColorSearchInput=(borderColor)=><input value={expandColorQ} onChange={e=>setExpandColorQ(e.target.value)} onClick={e=>e.stopPropagation()} placeholder="Search colors..." autoFocus style={{flexBasis:'100%',padding:'4px 8px',fontSize:11,border:'1px solid '+borderColor,borderRadius:4,marginBottom:4}}/>;
  const expColorNoMatch=<div style={{fontSize:11,color:'#94a3b8',padding:'4px 2px',flexBasis:'100%'}}>No colors match "{expandColorQ}"</div>;
  const sv=(k,v)=>{setO(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));setDirty(true)};
  const isAU=b=>{const l=(b||'').toLowerCase();return l==='adidas'||l==='under armour'||l==='new balance'};
  // AU footwear gets 5% less discount than apparel (school pays more for shoes).
  // pricingGroup ('lockerroom') selects a reduced tier schedule.
  const auDisc=(isFw,pricingGroup)=>{const base=auTierDisc(cust?.adidas_ua_tier||'B',pricingGroup);return isFw?Math.max(0,base-0.05):base};
  const selC=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);sv('customer_id',id);sv('default_markup',c.catalog_markup||1.65)}};
  const addP=p=>{const au=isAU(p.brand);const isFw=(p.category||'').toLowerCase()==='footwear';const sell=au?rQ(p.retail_price*(1-auDisc(isFw,p.pricing_group))):rQ(p.nsa_cost*(o.default_markup||1.65));
    const avail=(p.available_sizes&&p.available_sizes.length)?[...p.available_sizes]:(isFw?[...FOOTWEAR_DEFAULT_SIZES]:['S','M','L','XL','2XL']);
    sv('items',[...o.items,{product_id:p.id,sku:p.sku,name:nameWithBrand(p.name,p.brand),brand:p.brand,vendor_id:p.vendor_id||null,pricing_group:p.pricing_group||null,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:avail,_colors:au?null:(p._colors||null),...(p._sizeCosts&&Object.keys(p._sizeCosts).length>1?{_sizeCosts:p._sizeCosts}:{}),sizes:{},qty_only:false,decorations:[],no_deco:true,is_footwear:isFw}]);setShowAdd(false);setPS('')};
  const mvI=(i,dir)=>{const items=safeItems(o);const j=i+dir;if(j<0||j>=items.length)return;const next=[...items];[next[i],next[j]]=[next[j],next[i]];sv('items',next)};
  const uI=(i,k,v)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===i?{...it,[k]:v}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};const rmI=i=>{const item=safeItems(o)[i];if(item&&isSO){const pos=safePOs(item);if(pos.length>0){const hasReceived=pos.some(po=>Object.values(po.received||{}).some(v=>v>0));const hasBilled=pos.some(po=>Object.values(po.billed||{}).some(v=>v>0));if(hasReceived||hasBilled){nf('Cannot delete — this item has '+(hasReceived?'received':'')+(hasReceived&&hasBilled?' and ':'')+(hasBilled?'billed':'')+' PO quantities. Remove billing/receiving first.','error');return}nf('Cannot delete — this item has PO(s). Delete the PO(s) first before removing the item.','error');return}}sv('items',safeItems(o).filter((_,x)=>x!==i))};
  const copyI=(i)=>{const it=o.items[i];const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];sv('items',[...o.items,clone]);nf('📋 Copied '+it.sku+' with all sizes & decorations')};
  const copyIWithSku=(i,p)=>{const it=o.items[i];const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];clone.product_id=p.id;clone.sku=p.sku;clone.name=nameWithBrand(p.name,p.brand);clone.brand=p.brand;clone.color=p.color;clone.nsa_cost=p.nsa_cost;clone.retail_price=p.retail_price;clone.vendor_id=p.vendor_id||null;clone.pricing_group=p.pricing_group||null;
    // Preserve source's available_sizes (union with new product's) so manually-added sizes survive the swap
    const srcSizes=Array.isArray(it.available_sizes)?it.available_sizes:[];const newSizes=Array.isArray(p.available_sizes)?p.available_sizes:[];clone.available_sizes=[...new Set([...srcSizes,...newSizes])];
    const isFw=(p.category||'').toLowerCase()==='footwear';clone.is_footwear=isFw;const au=isAU(p.brand);clone._colors=au?null:(p._colors||null);clone.unit_sell=au?rQ(p.retail_price*(1-auDisc(isFw,p.pricing_group))):rQ(p.nsa_cost*(o.default_markup||1.65));sv('items',[...o.items,clone]);setCopySkuModal(null);nf('📋 Copied decorations from '+it.sku+' → '+p.sku)};
  // Copy item to a vendor-search result (S&S/SanMar/Momentec/Richardson). Mirrors addSearchProduct
  // but preserves source item's decorations + sizes by cloning it.
  const copyIWithVendorResult=(i,style,color,source)=>{
    const it=o.items[i];if(!it)return;
    const isSM=source==='sm';const isMT=source==='mt';const isRS=source==='rs';
    const vendor=vendorList.find(v=>isRS?(v.api_provider==='richardson'||v.name==='Richardson'):isMT?(v.api_provider==='momentec'||v.name==='Momentec'):isSM?(v.api_provider==='sanmar'||v.name==='SanMar'):(v.api_provider==='ss_activewear'||v.name==='S&S Activewear'));
    const vId=vendor?.id||(isRS?'v5':isMT?'v8':isSM?'v3':'v4');
    const cost=color.customerPrice||color.piecePrice||0;
    const sell=rQ(cost*(o.default_markup||1.65));
    const catMatch=products.find(p=>p.sku===style.sku&&(!color.colorName||p.color===color.colorName))||products.find(p=>p.sku===style.sku);
    const apiSizes=isRS?color.sizes.map(s=>s.sizeName).filter(Boolean):color.sizes.map(s=>s.sizeName).filter(s=>s&&SZ_ORD.includes(s));
    const catSizes=isRS?(catMatch?.available_sizes||[]):(catMatch?.available_sizes||[]).filter(s=>SZ_ORD.includes(s));
    const smSizes=style._availSizes?style._availSizes.split(/[,;]\s*/).map(s=>normSzName(s.trim())).filter(s=>s&&SZ_ORD.includes(s)):[];
    const STD_SIZES=isRS?[]:['S','M','L','XL','2XL'];
    let availSizes=[...new Set([...apiSizes,...catSizes,...smSizes,...STD_SIZES])];
    availSizes=availSizes.sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
    const vInv={};const vNextBySize={};
    // Only cache sizes with a real inventory hit. SanMar/S&S live-search rows often
    // come back with qty=0 because the search-time inventory fetch is a single
    // aggregate call (not per-size); seeding those 0s into the cache makes every
    // size badge render "0 sm" forever until a per-size refresh happens.
    color.sizes.forEach(s=>{if(s.qty>0)vInv[s.sizeName]=(vInv[s.sizeName]||0)+s.qty;if(s.nextAvail&&(!vNextBySize[s.sizeName]||new Date(s.nextAvail)<new Date(vNextBySize[s.sizeName])))vNextBySize[s.sizeName]=s.nextAvail});
    const liveFlag=isRS?'_rs_live':isMT?'_mt_live':isSM?'_sm_live':'_ss_live';
    const fallbackSizes=isRS?(availSizes.length?availSizes:['OSFA']):['S','M','L','XL','2XL'];
    // Clone source item to preserve decorations, then override SKU/product fields
    const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];
    // Clear stale live-vendor flags from the source
    delete clone._ss_live;delete clone._sm_live;delete clone._mt_live;delete clone._rs_live;delete clone._mtId;delete clone._colors;
    clone.product_id=catMatch?.id||null;clone.sku=style.sku;clone.name=nameWithBrand(style.styleName,style.brandName);clone.brand=style.brandName;
    clone.vendor_id=vId;clone.color=color.colorName;clone.nsa_cost=cost;clone.retail_price=catMatch?.retail_price||0;
    clone.unit_sell=sell;clone.available_sizes=availSizes.length?availSizes:fallbackSizes;
    clone.is_custom=false;clone[liveFlag]=true;
    clone._colorImage=color.colorFrontImage||style.styleImage||'';
    clone._colorBackImage=color.colorBackImage||'';
    if(isMT&&style._mtId)clone._mtId=style._mtId;
    const sizePrice={};color.sizes.forEach(s=>{sizePrice[s.sizeName]=s.price||cost});
    clone._sizeCosts=sizePrice;
    const mk=o.default_markup||1.65;
    const sizeSell={};Object.entries(sizePrice).forEach(([sz,c])=>{sizeSell[sz]=rQ(c*mk)});
    clone._sizeSells=sizeSell;
    sv('items',[...o.items,clone]);
    if(Object.keys(vInv).length>0){
      vendorInvCache.current[style.sku]={sizes:vInv,price:sizePrice,fetchedAt:Date.now(),source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize};
      setVendorInv(prev=>({...prev,[style.sku]:{sizes:vInv,price:sizePrice,loading:false,error:null,source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize}}));
    }else{
      fetchVendorInventory(style.sku,vId,clone);
    }
    setCopySkuModal(null);setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);setExpandedStyle(null);
    nf('📋 Copied decorations from '+it.sku+' → '+style.sku);
  };
  // Change the SKU/product on an existing item in place (keeps decorations + sizes).
  // Only allowed when no PO/IF has been created on the item.
  const changeItemSku=(i,p)=>{
    const it=o.items[i];if(!it)return;
    if(safePicks(it).length>0||safePOs(it).length>0){nf('Cannot change SKU — item has PO or IF. Remove them first.','error');return}
    const au=isAU(p.brand);const isFw=(p.category||'').toLowerCase()==='footwear';
    const sell=au?rQ(p.retail_price*(1-auDisc(isFw,p.pricing_group))):rQ(p.nsa_cost*(o.default_markup||1.65));
    setO(e=>({...e,items:safeItems(e).map((x,xi)=>{
      if(xi!==i)return x;
      const next={...x};
      delete next._ss_live;delete next._sm_live;delete next._mt_live;delete next._rs_live;delete next._mtId;
      delete next._sizeCosts;delete next._sizeSells;delete next._colorImage;delete next._colorBackImage;
      next.product_id=p.id;next.sku=p.sku;next.name=nameWithBrand(p.name,p.brand);next.brand=p.brand;
      next.vendor_id=p.vendor_id||null;next.pricing_group=p.pricing_group||null;next.color=p.color;
      next.nsa_cost=p.nsa_cost;next.retail_price=p.retail_price;next.unit_sell=sell;
      next.available_sizes=[...(p.available_sizes||['S','M','L','XL','2XL'])];
      next._colors=au?null:(p._colors||null);
      next.is_custom=false;
      return next;
    }),updated_at:new Date().toLocaleString()}));
    setDirty(true);
    setCopySkuModal(null);
    nf('🔄 Changed SKU → '+p.sku+' (decorations kept)');
  };
  // Change SKU in place to a vendor-search result (S&S/SanMar/Momentec/Richardson). Mirrors
  // copyIWithVendorResult but updates the existing item rather than appending a clone.
  const changeItemWithVendorResult=(i,style,color,source)=>{
    const it=o.items[i];if(!it)return;
    if(safePicks(it).length>0||safePOs(it).length>0){nf('Cannot change SKU — item has PO or IF. Remove them first.','error');return}
    const isSM=source==='sm';const isMT=source==='mt';const isRS=source==='rs';
    const vendor=vendorList.find(v=>isRS?(v.api_provider==='richardson'||v.name==='Richardson'):isMT?(v.api_provider==='momentec'||v.name==='Momentec'):isSM?(v.api_provider==='sanmar'||v.name==='SanMar'):(v.api_provider==='ss_activewear'||v.name==='S&S Activewear'));
    const vId=vendor?.id||(isRS?'v5':isMT?'v8':isSM?'v3':'v4');
    const cost=color.customerPrice||color.piecePrice||0;
    const sell=rQ(cost*(o.default_markup||1.65));
    const catMatch=products.find(p=>p.sku===style.sku&&(!color.colorName||p.color===color.colorName))||products.find(p=>p.sku===style.sku);
    const apiSizes=isRS?color.sizes.map(s=>s.sizeName).filter(Boolean):color.sizes.map(s=>s.sizeName).filter(s=>s&&SZ_ORD.includes(s));
    const catSizes=isRS?(catMatch?.available_sizes||[]):(catMatch?.available_sizes||[]).filter(s=>SZ_ORD.includes(s));
    const smSizes=style._availSizes?style._availSizes.split(/[,;]\s*/).map(s=>normSzName(s.trim())).filter(s=>s&&SZ_ORD.includes(s)):[];
    const STD_SIZES=isRS?[]:['S','M','L','XL','2XL'];
    let availSizes=[...new Set([...apiSizes,...catSizes,...smSizes,...STD_SIZES])];
    availSizes=availSizes.sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
    const vInv={};const vNextBySize={};
    // Only cache sizes with a real inventory hit. SanMar/S&S live-search rows often
    // come back with qty=0 because the search-time inventory fetch is a single
    // aggregate call (not per-size); seeding those 0s into the cache makes every
    // size badge render "0 sm" forever until a per-size refresh happens.
    color.sizes.forEach(s=>{if(s.qty>0)vInv[s.sizeName]=(vInv[s.sizeName]||0)+s.qty;if(s.nextAvail&&(!vNextBySize[s.sizeName]||new Date(s.nextAvail)<new Date(vNextBySize[s.sizeName])))vNextBySize[s.sizeName]=s.nextAvail});
    const liveFlag=isRS?'_rs_live':isMT?'_mt_live':isSM?'_sm_live':'_ss_live';
    const fallbackSizes=isRS?(availSizes.length?availSizes:['OSFA']):['S','M','L','XL','2XL'];
    const sizePrice={};color.sizes.forEach(s=>{sizePrice[s.sizeName]=s.price||cost});
    const mk=o.default_markup||1.65;
    const sizeSell={};Object.entries(sizePrice).forEach(([sz,c])=>{sizeSell[sz]=rQ(c*mk)});
    setO(e=>({...e,items:safeItems(e).map((x,xi)=>{
      if(xi!==i)return x;
      const next={...x};
      delete next._ss_live;delete next._sm_live;delete next._mt_live;delete next._rs_live;delete next._mtId;delete next._colors;
      next.product_id=catMatch?.id||null;next.sku=style.sku;next.name=style.styleName;next.brand=style.brandName;
      next.vendor_id=vId;next.color=color.colorName;next.nsa_cost=cost;next.retail_price=catMatch?.retail_price||0;
      next.unit_sell=sell;next.available_sizes=availSizes.length?availSizes:fallbackSizes;
      next.is_custom=false;next[liveFlag]=true;
      next._colorImage=color.colorFrontImage||style.styleImage||'';
      next._colorBackImage=color.colorBackImage||'';
      if(isMT&&style._mtId)next._mtId=style._mtId;
      next._sizeCosts=sizePrice;next._sizeSells=sizeSell;
      return next;
    }),updated_at:new Date().toLocaleString()}));
    setDirty(true);
    if(Object.keys(vInv).length>0){
      vendorInvCache.current[style.sku]={sizes:vInv,price:sizePrice,fetchedAt:Date.now(),source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize};
      setVendorInv(prev=>({...prev,[style.sku]:{sizes:vInv,price:sizePrice,loading:false,error:null,source,nextAvail:color.nextAvail||'',sizeNextAvail:vNextBySize}}));
    }else{
      // SKU change doesn't trigger the items.length auto-fetch effect, so kick off
      // a per-size fetch directly so badges populate for the swapped-in SKU.
      fetchVendorInventory(style.sku,vId,{vendor_id:vId,sku:style.sku,color:color.colorName,sizes:{},available_sizes:availSizes.length?availSizes:fallbackSizes});
    }
    setCopySkuModal(null);setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);setExpandedStyle(null);
    nf('🔄 Changed SKU → '+style.sku+' (decorations kept)');
  };
  // Change the color on an existing vendor-live item without losing decorations/sizes.
  const changeItemVendorColor=(itemIdx,style,color)=>{
    setO(e=>({...e,items:safeItems(e).map((it,x)=>x===itemIdx?{
      ...it,
      color:color.colorName,
      _colorImage:color.colorFrontImage||style.styleImage||it._colorImage||'',
      _colorBackImage:color.colorBackImage||it._colorBackImage||''
    }:it),updated_at:new Date().toLocaleString()}));
    setDirty(true);
    setColorPickerModal(null);setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);
    nf('🎨 Color changed to '+color.colorName);
  };
  const uSz=(i,sz,v)=>{
    const n=v===''?0:parseInt(v)||0;
    const item=o.items[i];if(!item)return;
    if(n===(item.sizes[sz]||0))return;// no-op: value unchanged, skip render + side effects
    // Guard: don't allow reducing below committed qty (pulled picks + net POs)
    const pickedQty=safePicks(item).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+(pk[sz]||0),0);
    const poQty=poCommitted(item.po_lines,sz);
    const committed=pickedQty+poQty;
    if(n<committed&&committed>0){
      nf('Cannot reduce '+sz+' below '+committed+' ('+pickedQty+' picked + '+poQty+' on PO)','error');return;
    }
    const newSizes={...item.sizes,[sz]:n};
    const newTotal=Object.values(newSizes).reduce((a,v)=>a+safeNum(v),0);
    uI(i,'sizes',newSizes);
    if(newTotal>0&&item.est_qty)uI(i,'est_qty',0);
  };
  const addSzToItem=(i,sz)=>{const it=o.items[i];const cur=it.available_sizes||[];if(!cur.includes(sz))uI(i,'available_sizes',[...cur,sz])};
  const removeSzFromItem=(i,sz)=>{const it=o.items[i];if(safeNum(it.sizes[sz])>0){nf('Cannot remove '+sz+' — it has quantity. Set to 0 first.','error');return}const newSizes={...it.sizes};delete newSizes[sz];uI(i,'sizes',newSizes);uI(i,'available_sizes',(it.available_sizes||[]).filter(s=>s!==sz))};
  const NUM_SZ={heat_transfer:['1"','1.5"','2"','3"','4"','5"','6"','8"','10"'],embroidery:['0.5"','0.75"','1"','1.5"','2"'],screen_print:['4"','6"','8"','10"']};
  const itemIsReversible=i=>{const it=o.items[i];return!!(it&&safeDecos(it).some(d=>d.reversible))};
  const addArtDeco=i=>{const rev=itemIsReversible(i);sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'art',position:'Front Center',art_file_id:null,sell_override:null,...(rev?{reversible:true}:{})}]}:x))};
  const addNumDeco=i=>{const rev=itemIsReversible(i);sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'numbers',position:'Back',num_method:'screen_print',num_size:'6"',two_color:false,sell_override:null,custom_font_art_id:null,roster:{},...(rev?{reversible:true}:{})}]}:x))};
  const addNameDeco=i=>{const rev=itemIsReversible(i);sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'names',position:'Back Center',name_method:'heat_press',sell_override:null,sell_each:6,cost_each:3,names:{},...(rev?{reversible:true}:{})}]}:x))};
  const addOutsideDeco=i=>{const rev=itemIsReversible(i);sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'outside_deco',position:'Front Center',vendor:'',deco_type:'embroidery',cost_each:0,sell_each:0,notes:'',sell_override:null,...(rev?{reversible:true}:{})}]}:x))};
  const uD=(ii,di,k,v)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,[k]:v}:d)}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  const uDM=(ii,di,updates)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,...updates}:d)}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  // Swap art on a decoration. If it's part of a released or in-progress art job, recall the
  // existing request and drop the released flag so syncJobs regenerates the job under the new art name.
  const changeArtFileId=(ii,di,newId)=>{
    setO(e=>{
      const newItems=safeItems(e).map((it,x)=>x===ii?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,art_file_id:newId}:d)}:it);
      const oldArtIds=new Set();let touched=false;
      const updJobs=safeArr(e.jobs).flatMap(j=>{
        const inJob=(j.items||[]).some(gi=>{
          if(gi.item_idx!==ii)return false;
          const dis=Array.isArray(gi.deco_idxs)&&gi.deco_idxs.length?gi.deco_idxs:[gi.deco_idx];
          return dis.includes(di);
        });
        if(!inJob)return[j];
        const hasActiveReq=(j.art_requests||[]).some(r=>r.status!=='recalled');
        if(!j._released&&!hasActiveReq)return[j];
        (j._art_ids||[j.art_file_id].filter(Boolean)).forEach(aid=>{if(aid&&aid!=='__tbd')oldArtIds.add(aid)});
        touched=true;
        // Released jobs are dropped so syncJobs regenerates fresh under the new art (and new name).
        if(j._released)return[];
        // Non-released jobs with active requests: reset status and mark requests as recalled.
        return[{...j,art_status:'needs_art',
          art_requests:(j.art_requests||[]).map(r=>['requested','in_progress','completed','waiting_approval'].includes(r.status)?{...r,status:'recalled'}:r),
          assigned_artist:''}];
      });
      const updArt=touched?safeArr(e.art_files).map(a=>oldArtIds.has(a.id)?{...a,status:'waiting_for_art'}:a):e.art_files;
      if(touched)setTimeout(()=>nf('Art changed — previous request recalled, job will refresh'),0);
      return{...e,items:newItems,jobs:updJobs,art_files:updArt,updated_at:new Date().toLocaleString()};
    });
    setDirty(true);
  };
  // Item-level reversible: a single toggle that syncs `reversible` across every decoration on the item.
  // Reversible is a property of the GARMENT (both sides need decoration), not of an individual deco — but the
  // existing data model stores it per-deco and pricing logic reads it per-deco. To keep the data model stable
  // (no schema change, no migration) we treat any deco being reversible as the item being reversible, and
  // toggling cascades to every deco so all CW/Side-A/B pickers and qty multipliers stay consistent.
  const setItemReversible=(ii,v)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:safeDecos(it).map(d=>({...d,reversible:v}))}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  const rmD=(ii,di)=>{const next=o.items[ii].decorations.filter((_,i)=>i!==di);setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:next,...(next.length===0?{no_deco:true}:{})}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  // Art files (SO)
  const af=o.art_files||[];
  // Art-folder mutators use the functional setO form so they always read the
  // latest art_files. Closure-captured `af` would be stale across async gaps
  // (file uploads, auto-save flips of dirty, parent prop refreshes), and
  // writing back a stale snapshot would clobber unsaved color ways / size.
  const addArt=()=>{setO(e=>({...e,art_files:[...(e.art_files||[]),{id:'af'+Date.now(),name:'',deco_type:'screen_print',ink_colors:'',thread_colors:'',art_size:'',color_ways:[],files:[],mockup_files:[],preview_url:'',prod_files:[],notes:'',status:'waiting_for_art',uploaded:new Date().toLocaleDateString()}],updated_at:new Date().toLocaleString()}));setDirty(true)};
  const uArt=(i,k,v)=>{setO(e=>({...e,art_files:(e.art_files||[]).map((f,x)=>x===i?{...f,[k]:v}:f),updated_at:new Date().toLocaleString()}));setDirty(true)};
  // Remove a single mockup image (by URL) from the artwork's item_mockups / mockup_files so a rep
  // can clear stale or wrong mockups from a job. Source art (files/prod_files) is left untouched.
  // Persists immediately so the deletion survives a page refresh.
  const removeMockupUrl=url=>{if(!url)return;const _u=f=>typeof f==='string'?f:(f&&f.url)||'';const _strip=arr=>(arr||[]).filter(f=>_u(f)!==url);const updated={...o,art_files:safeArt(o).map(a=>{const im={...(a.item_mockups||{})};let changed=false;Object.keys(im).forEach(k=>{const before=im[k]||[];const after=_strip(before);if(after.length!==before.length){im[k]=after;changed=true}});const mf=_strip(a.mockup_files);if(mf.length!==(a.mockup_files||[]).length)changed=true;if(!changed)return a;return{...a,item_mockups:im,mockup_files:mf}}),updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setSaved(true);setDirty(false);nf&&nf('Mockup removed')};
  // Side a mockup represents (front/back), from the stored tag or the filename suffix.
  const _mockSide=f=>{const s=typeof f!=='string'&&f&&f.side;if(s==='front'||s==='back')return s;const n=(typeof f!=='string'&&(f?.name||f?.url))||(typeof f==='string'?f:'');if(/-front\.png/i.test(n))return 'front';if(/-back\.png/i.test(n))return 'back';return ''};
  // Display order for a mockup: explicit ord if set, else front before back before others.
  const _mockOrd=f=>{if(typeof f!=='string'&&f&&f.ord!=null)return f.ord;const s=_mockSide(f);return s==='front'?0:s==='back'?1:2};
  // Persist an explicit display order (front-first by default) by writing `ord` onto each mock entry.
  const setMockupOrder=orderedUrls=>{const pos={};orderedUrls.forEach((u,i)=>{pos[u]=i});const _ap=arr=>(arr||[]).map(f=>{if(typeof f==='string')return f;const u=f?.url;return (u&&pos[u]!=null)?{...f,ord:pos[u]}:f});const updated={...o,art_files:safeArt(o).map(a=>({...a,item_mockups:Object.fromEntries(Object.entries(a.item_mockups||{}).map(([k,v])=>[k,_ap(v)])),mockup_files:_ap(a.mockup_files)})),updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setSaved(true);setDirty(false)};
  const moveMock=(orderedUrls,i,dir)=>{const j=i+dir;if(j<0||j>=orderedUrls.length)return;const arr=[...orderedUrls];[arr[i],arr[j]]=[arr[j],arr[i]];setMockupOrder(arr)};
  const rmArt=i=>{setO(e=>{const arr=e.art_files||[];const removedId=arr[i]?.id||null;const newAf=arr.filter((_,x)=>x!==i);const newItems=removedId?safeItems(e).map(it=>({...it,decorations:safeDecos(it).map(d=>d.art_file_id===removedId?{...d,art_file_id:null}:d)})):e.items;return{...e,art_files:newAf,items:newItems,updated_at:new Date().toLocaleString()}});setDirty(true)};

  const addFileToArt=i=>{const a=af[i];if(!a)return;uArt(i,'files',[...(a.files||[]),'new_file_'+((a.files||[]).length+1)+'.ai'])};

  // Promo auto-repair removed — use "Apply Promo Funds" in Actions dropdown instead

  const addrs=useMemo(()=>getAddrs(cust,allCustomers),[cust,allCustomers]);
  const artQty=useMemo(()=>{const m={};safeItems(o).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q=sq>0?sq:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){m[d.art_file_id]=(m[d.art_file_id]||0)+q*(d.reversible?2:1)}})});return m},[o]);
  const totals=useMemo(()=>{
    // PO size-key exclusion list — matches the per-PO modal so we count only true size qty fields.
    const _poMeta=new Set(['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship','batch_queue_id','batch_po_number','preexisting','email_history','shipping']);
    let rev=0,cost=0;safeItems(o).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q=sq>0?sq:safeNum(it.est_qty);if(!q)return;
    // Use per-size sells when available (vendor items have _sizeSells for 2XL+ upcharges)
    if(it._sizeSells&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)rev+=n*(it._sizeSells[sz]||safeNum(it.unit_sell))})}else{rev+=q*safeNum(it.unit_sell)}
    // Garment cost — prefer actual PO unit costs when POs exist. Each PO line's covered qty
    // is costed at its own unit_cost; any remaining uncovered qty falls back to catalog cost
    // (with _sizeCosts upcharges if present).
    let poQty=0,poCost=0;(Array.isArray(it.po_lines)?it.po_lines:[]).forEach(pl=>{if(!pl)return;const u=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);Object.entries(pl).forEach(([k,v])=>{if(k.startsWith('_')||_poMeta.has(k))return;if(typeof v!=='number'||v<=0)return;poQty+=v;poCost+=v*u})});
    if(poQty>0){
      cost+=poCost;
      const uncov=Math.max(0,q-poQty);
      if(uncov>0){
        if(it._sizeCosts&&sq>0){const tot=Object.entries(safeSizes(it)).reduce((a,[sz,v])=>{const n=safeNum(v);return n>0?a+n*(it._sizeCosts[sz]||safeNum(it.nsa_cost)):a},0);const avg=sq>0?tot/sq:safeNum(it.nsa_cost);cost+=uncov*avg}
        else{cost+=uncov*safeNum(it.nsa_cost)}
      }
    }else if(it._sizeCosts&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)cost+=n*(it._sizeCosts[sz]||safeNum(it.nsa_cost))})}
    else{cost+=q*safeNum(it.nsa_cost)}
    safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);rev+=eq*dp.sell;cost+=eq*dp.cost});
    });
    // Outside-deco POs live at SO level (so.deco_pos), not under items
    (o.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=safeNum(dp.qty||0)*safeNum(dp.unit_cost||0)});
    // OMG team-store fees NSA is charged (e.g. processing) are a real cost, so
    // fold them into cost — the order's margin then reflects NSA's true net
    // after OMG's cut rather than a product-only number.
    const omgFee=safeNum(o._omg_processing||0);cost+=omgFee;
    const ship=o.shipping_type==='pct'?rev*(o.shipping_value||0)/100:(o.shipping_value||0);const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);const tax=rev*taxRate;
    return{rev,cost,ship,tax,taxRate,omgFee,grand:rev+ship+tax,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[o,artQty,cust]); // eslint-disable-line

  // Promo totals — separate calc to not disturb existing totals
  const promoTotals=useMemo(()=>{
    if(!o.promo_applied)return null;
    let promoRev=0,promoCost=0,normalRev=0,normalCost=0,origPromoRev=0;
    safeItems(o).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q=sq>0?sq:safeNum(it.est_qty);if(!q)return;
      if(it.is_promo){
        promoRev+=q*safeNum(it.unit_sell);promoCost+=q*safeNum(it.nsa_cost);
        // Track original revenue (pre-promo sell) for shipping base
        origPromoRev+=q*safeNum(it._pre_promo_sell||it.unit_sell);
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);promoRev+=eq*rQ(dp.sell*1.25);promoCost+=eq*dp.cost;origPromoRev+=eq*dp.sell});
      }else{
        normalRev+=q*safeNum(it.unit_sell);normalCost+=q*safeNum(it.nsa_cost);
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);normalRev+=eq*dp.sell;normalCost+=eq*dp.cost});
      }});
    // Shipping: use original (pre-promo) revenue for base to avoid inflation, then apply 25% to promo portion
    const origTotalRev=origPromoRev+normalRev;
    const baseShip=o.shipping_type==='pct'?origTotalRev*(o.shipping_value||0)/100:(o.shipping_value||0);
    const promoPct=origTotalRev>0?origPromoRev/origTotalRev:(promoRev>0?1:0);
    const promoShip=rQ(baseShip*promoPct*1.25);const normalShip=rQ(baseShip*(1-promoPct));
    const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);const normalTax=normalRev*taxRate;
    // Include _promo_credit from partially covered items
    const promoCredit=safeItems(o).reduce((a,it)=>a+safeNum(it._promo_credit),0);
    const promoAmount=promoRev+promoShip+promoCredit;const customerPays=normalRev+normalShip+normalTax;
    return{promoRev,promoCost,promoShip,promoAmount,promoCredit,normalRev,normalCost,normalShip,normalTax,customerPays};
  },[o,artQty,cust,af]); // eslint-disable-line

  // AUTO-SYNC JOBS from decorations — one job per unique decoration combination per deco type
  // Items that share the exact same set of decorations AND deco type are grouped into one job
  // Different deco types (e.g. screen_print vs embroidery) always create separate jobs
  const syncJobs=useCallback(()=>{
    // Released jobs (submitted via the wizard) are frozen — their items are
    // committed to art and shouldn't be re-merged into auto-generated groups.
    // Build a set of (item_idx, deco_idx) pairs already covered by a released
    // job so we can skip them when assembling itemSigs below.
    const releasedJobs=safeJobs(o).filter(j=>j._released);
    // Manually merged jobs combine several decoration signatures into one job by hand. Like
    // released jobs, their item/deco pairs must not be re-grouped or re-split by the auto-builder.
    // (Unlike released jobs, their unit counts are still refreshed below as item sizes change.)
    const mergedJobs=safeJobs(o).filter(j=>j._merged&&!j._released);
    const frozenItemDecos=new Set();
    [...releasedJobs,...mergedJobs].forEach(j=>(j.items||[]).forEach(gi=>{
      const dis=Array.isArray(gi.deco_idxs)&&gi.deco_idxs.length?gi.deco_idxs:[gi.deco_idx];
      dis.forEach(di=>frozenItemDecos.add(gi.item_idx+'::'+di));
    }));
    // Step 1: Build decoration entries per item, grouped by deco type
    // Each item may produce multiple entries if it has decorations with different deco types
    const itemSigs=[];
    safeItems(o).forEach((it,ii)=>{
      // Item sent to an outside decorator — via an item-level outside-deco PO line or an
      // SO-level deco PO covering this item. The in-house team doesn't produce decoration
      // for these items, so they must not generate any production job.
      const sentOutside=(it.po_lines||[]).some(pl=>pl&&pl.po_type==='outside_deco')
        ||(o.deco_pos||[]).some(dp=>(dp.item_idxs||[]).includes(ii));
      if(sentOutside)return;
      // First, classify each decoration by its resolved deco type
      const decosByType={};
      safeDecos(it).forEach((d,di)=>{
        if(frozenItemDecos.has(ii+'::'+di))return;
        if(d.kind==='art'){
          const artF=d.art_file_id?af.find(a=>a.id===d.art_file_id):null;
          const dt=artF?.deco_type||d.deco_type||'screen_print';
          const part=d.art_file_id?'art_'+d.art_file_id+'@'+safeStr(d.position):'unassigned@'+safeStr(d.position);
          if(!decosByType[dt])decosByType[dt]=[];
          decosByType[dt].push({part,d,di});
        } else if(d.kind==='numbers'){
          const dt=d.num_method||'heat_transfer';
          const part='numbers_'+dt+'@'+safeStr(d.position);
          if(!decosByType[dt])decosByType[dt]=[];
          decosByType[dt].push({part,d,di});
        } else if(d.kind==='names'){
          const dt=d.name_method||'heat_press';
          const part='names_'+dt+'@'+safeStr(d.position);
          if(!decosByType[dt])decosByType[dt]=[];
          decosByType[dt].push({part,d,di});
        }
      });
      // Create one signature entry per deco type group
      Object.entries(decosByType).forEach(([dt,decos])=>{
        const parts=decos.map(x=>x.part).sort();
        const sig=dt+'::'+parts.join('|');
        itemSigs.push({ii,it,sig,decos,decoType:dt});
      });
    });
    // Step 2: Group items by their decoration signature (now split by deco type)
    const sigGroups={};
    itemSigs.forEach(({ii,it,sig,decos,decoType})=>{
      if(!sigGroups[sig])sigGroups[sig]={sig,items:[],decoType};
      sigGroups[sig].items.push({ii,it,decos});
    });
    // Step 3: Build jobs from each group
    const jobMap={};
    Object.values(sigGroups).forEach(grp=>{
      const firstEntry=grp.items[0];
      const positions=new Set();const artIds=[];const artNames=[];const decoTypes=[];let worstArtSt='art_complete';let hasArtDeco=false;
      firstEntry.decos.forEach(({d})=>{
        if(d.kind==='art'){
          hasArtDeco=true;
          positions.add(safeStr(d.position));
          if(d.art_file_id){
            const artF=af.find(a=>a.id===d.art_file_id);
            artIds.push(d.art_file_id);
            artNames.push(artF?.name||'Unknown Art');
            decoTypes.push(artF?.deco_type||d.deco_type||'screen_print');
            const st=artF?.status==='approved'?(artProdFilesReady(artF)?'art_complete':prodFilesStatusFor(artF?.deco_type||d.deco_type)):artF?.status==='needs_approval'?'waiting_approval':'needs_art';
            if(st!=='art_complete')worstArtSt=st;
          } else {
            artNames.push('Unassigned Art ('+safeStr(d.position)+')');
            decoTypes.push(d.deco_type||'screen_print');
            worstArtSt='needs_art';
          }
        } else if(d.kind==='numbers'){
          positions.add(safeStr(d.position));
          artNames.push('Numbers — '+(d.num_method||'heat_transfer').replace(/_/g,' '));
          decoTypes.push(d.num_method||'heat_transfer');
        } else if(d.kind==='names'){
          positions.add(safeStr(d.position));
          artNames.push('Names — '+(d.name_method||'heat_press').replace(/_/g,' '));
          decoTypes.push(d.name_method||'heat_press');
        }
      });
      // Numbers-only jobs (no art decoration) still need a mockup / setup — they
      // should start in 'needs_art' so the rep can submit them, not 'art_complete'.
      if(!hasArtDeco)worstArtSt='needs_art';
      const jobKey=grp.sig;
      const job={key:jobKey,art_file_id:artIds[0]||null,art_name:artNames.join(' + '),
        deco_type:decoTypes[0]||'screen_print',positions,items:[],art_status:worstArtSt,
        total_units:0,fulfilled_units:0,_art_ids:artIds};
      // Add each item in the group
      grp.items.forEach(({ii,it,decos})=>{
        const szEntries=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0);
        let itemTotal=0,itemFulfilled=0;
        szEntries.forEach(([sz,v])=>{
          itemTotal+=v;
          const pulledQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
          const rcvdQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
          itemFulfilled+=Math.min(v,pulledQ+rcvdQ);
        });
        const decoIdxs=decos.map(x=>x.di);
        job.items.push({item_idx:ii,deco_idx:decoIdxs[0]||0,deco_idxs:decoIdxs,sku:it.sku||'—',name:safeStr(it.name)||'Unknown',color:safeStr(it.color),units:itemTotal,fulfilled:itemFulfilled});
        job.total_units+=itemTotal;job.fulfilled_units+=itemFulfilled;
      });
      jobMap[jobKey]=job;
    });
    // Build map of existing NON-split jobs keyed by job key AND by art_file_id (skip splits so they don't collide)
    const existingJobMap={};const existingByArtId={};
    safeJobs(o).forEach(j=>{if(!j.split_from){existingJobMap[j.key||j.id]=j;const jArtIds=j._art_ids||[j.art_file_id].filter(Boolean);jArtIds.forEach(aid=>{existingByArtId[aid]=existingByArtId[aid]||j})}});
    const soNum=o.id?.replace('SO-','')||'0';
    // Guard against duplicate job ids. A collision makes two jobs share an id, and
    // id-based lookups (e.g. dashboard "Review Mockup" todos) then resolve to the
    // wrong job. _reserved holds every id an existing job legitimately owns so freshly
    // minted ids never steal one; _usedIds tracks ids handed out this pass so a
    // preserved id that's already taken (pre-existing corruption) gets re-minted.
    const _reserved=new Set(safeJobs(o).map(j=>j.id).filter(Boolean));
    const _usedIds=new Set();
    let jIdx=1;
    const _nextJobId=()=>{let id;do{id='JOB-'+soNum+'-'+String(jIdx).padStart(2,'0');jIdx++}while(_reserved.has(id)||_usedIds.has(id));_usedIds.add(id);return id};
    const newJobs=Object.values(jobMap).map(j=>{
      // Try matching by key first, then by art_file_id as fallback to prevent data loss on key changes
      const existing=existingJobMap[j.key]||(j.art_file_id?existingByArtId[j.art_file_id]:null);
      const itemSt=j.fulfilled_units>=j.total_units&&j.total_units>0?'items_received':j.fulfilled_units>0?'partially_received':'need_to_order';
      let prodSt=existing?.prod_status||'hold';
      const artFile=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);
      const hasProdFiles=!artFile||(artFile.prod_files||[]).length>0;
      // Jobs stay in 'hold' (Ready for Prod) until warehouse manually moves them to production
      let id=existing?.id;
      if(!id||_usedIds.has(id))id=_nextJobId();else _usedIds.add(id);
      return{
        id,key:j.key,art_file_id:j.art_file_id,art_name:existing?._name_locked?(existing.art_name||j.art_name):j.art_name,deco_type:j.deco_type,
        positions:[...j.positions].filter(Boolean).join(', '),items:j.items,
        art_status:existing?.art_status||j.art_status,item_status:itemSt,prod_status:prodSt,
        total_units:j.total_units,fulfilled_units:j.fulfilled_units,
        assigned_machine:existing?.assigned_machine||null,assigned_to:existing?.assigned_to||null,
        ship_method:existing?.ship_method||(o.ship_preference==='rep_delivery'?'rep_delivery':'ship_customer'),
        split_from:existing?.split_from||null,created_at:existing?.created_at||new Date().toLocaleDateString(),
        counted_at:existing?.counted_at||null,counted_by:existing?.counted_by||null,
        count_discrepancy:existing?.count_discrepancy||null,notes:existing?.notes||null,
        _auto:existing?._auto!=null?existing._auto:true,
        _name_locked:existing?._name_locked||false,
        // Preserve art workflow fields from existing job
        art_requests:existing?.art_requests||[],art_messages:existing?.art_messages||[],
        assigned_artist:existing?.assigned_artist||null,rep_notes:existing?.rep_notes||null,
        rejections:existing?.rejections||null,
        sent_to_coach_at:existing?.sent_to_coach_at||null,coach_approved_at:existing?.coach_approved_at||null,coach_email_opened_at:existing?.coach_email_opened_at||null,
        coach_rejected:existing?.coach_rejected||null,
        _art_ids:j._art_ids||[],
        // Preserve dual-run order fields
        run_order:existing?.run_order||null,run1_done:existing?.run1_done||false,run2_done:existing?.run2_done||false,
        // Preserve embroidery digitized-names file link
        emb_names_link:existing?.emb_names_link||null,
      };
    });
    // Preserve per-item sizes/fulSizes overrides from prior custom splits so the parent job keeps
    // an accurate per-size remainder instead of being rebuilt from full order-item sizes.
    newJobs.forEach(nj=>{
      const existing=existingJobMap[nj.key]||(nj.art_file_id?existingByArtId[nj.art_file_id]:null);
      if(!existing||!Array.isArray(existing.items))return;
      let hasOverride=false;
      nj.items=nj.items.map(gi=>{
        const ex=existing.items.find(g=>g.item_idx===gi.item_idx&&g.sku===gi.sku);
        if(!ex||!ex.sizes)return gi;
        hasOverride=true;
        const sizes={...ex.sizes};
        const fulSizes=ex.fulSizes?{...ex.fulSizes}:{};
        const u=Object.values(sizes).reduce((a,v)=>a+safeNum(v),0);
        const f=Object.values(fulSizes).reduce((a,v)=>a+safeNum(v),0);
        return{...gi,sizes,fulSizes,units:u,fulfilled:f};
      });
      if(hasOverride){
        const total=nj.items.reduce((a,gi)=>a+safeNum(gi.units),0);
        const ful=nj.items.reduce((a,gi)=>a+safeNum(gi.fulfilled),0);
        nj.total_units=total;nj.fulfilled_units=ful;
        nj.item_status=ful>=total&&total>0?'items_received':ful>0?'partially_received':'need_to_order';
        nj._hasSplitOverrides=true;
      }
    });
    // Preserve manually split jobs — they won't be auto-generated from decorations
    const splitJobs=safeJobs(o).filter(j=>j.split_from&&!newJobs.find(nj=>nj.id===j.id));
    // Subtract split-off units from parent jobs so totals stay correct (skip parents that already
    // have per-item size overrides — those totals are derived from the preserved sizes).
    splitJobs.forEach(sj=>{
      const parent=newJobs.find(nj=>nj.id===sj.split_from);
      if(parent&&!parent._hasSplitOverrides){parent.total_units=Math.max(0,parent.total_units-sj.total_units);parent.fulfilled_units=Math.max(0,parent.fulfilled_units-sj.fulfilled_units)}
    });
    // Recalculate item_status on parents after unit adjustment
    newJobs.forEach(nj=>{
      if(!nj._hasSplitOverrides&&splitJobs.some(sj=>sj.split_from===nj.id)){
        nj.item_status=nj.fulfilled_units>=nj.total_units&&nj.total_units>0?'items_received':nj.fulfilled_units>0?'partially_received':'need_to_order';
      }
      delete nj._hasSplitOverrides;
    });
    // Released jobs aren't in newJobs (their items were skipped); preserve them as-is.
    // Gate: a job that was already submitted to art must not fall off the SO just because its item
    // decoration went missing (e.g. a decoration that was dropped on a bad save). As long as the job's
    // artwork still exists in the SO's Art Library, keep the job so it stays visible and isn't lost.
    // Merged jobs are preserved as-is except for refreshed unit counts so their totals track
    // item size/receiving edits — without re-splitting the hand-merged grouping.
    const recalcedMerged=mergedJobs.map(j=>{
      let total=0,fulfilled=0;
      (j.items||[]).forEach(gi=>{const it=safeItems(o)[gi.item_idx];if(!it)return;Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{total+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulfilled+=Math.min(v,pQ+rQ)})});
      const itemSt=fulfilled>=total&&total>0?'items_received':fulfilled>0?'partially_received':'need_to_order';
      return{...j,total_units:total,fulfilled_units:fulfilled,item_status:itemSt};
    });
    const _kept=[...newJobs,...splitJobs,...releasedJobs,...recalcedMerged];
    const _keptIds=new Set(_kept.map(j=>j.id));
    const _keptKeys=new Set(_kept.map(j=>j.key));
    // Recycled-number carry-over guard: when an SO number is reused (e.g. after a purge/re-import),
    // jobs+art from the order that previously held this id can stay attached by so_id. Such a job was
    // created before this order's row existed, so its created_at predates the SO's created_at. A real
    // dropped-deco job (the case the preservation below protects) is always created during this order's
    // life, so it parses as same-day-or-later. Use a 24h margin to absorb clock/timezone skew, and fail
    // safe (keep the job) whenever either date is missing/unparseable.
    const _soCreatedMs=(()=>{const t=Date.parse(o?.created_at);return Number.isNaN(t)?null:t})();
    const _isCarryOver=j=>{if(_soCreatedMs==null)return false;const jt=Date.parse(j?.created_at);if(Number.isNaN(jt))return false;return jt<_soCreatedMs-864e5;};
    // Decoration coverage of the current jobs — every (item_idx, deco_idx) pair a kept job
    // already produces. Used to drop stale "submitted" auto-jobs whose decorations are now
    // represented by another job (e.g. an art-location change rebuilt the job under a new
    // signature, or a released/merged job absorbed the decoration). Without this, those
    // duplicates linger as branched-off jobs covering the same items.
    const _coveredPairs=new Set();
    const _jobDecoPairs=j=>{const out=[];(j.items||[]).forEach(gi=>{const dis=Array.isArray(gi.deco_idxs)&&gi.deco_idxs.length?gi.deco_idxs:(gi.deco_idx!=null?[gi.deco_idx]:[]);dis.forEach(di=>out.push(gi.item_idx+'::'+di))});return out;};
    _kept.forEach(j=>_jobDecoPairs(j).forEach(p=>_coveredPairs.add(p)));
    const orphanedSubmitted=safeJobs(o).filter(j=>{
      if(!j||j._released||j._merged||j.split_from)return false;// already handled above
      if(_keptIds.has(j.id)||_keptKeys.has(j.key))return false;// already represented by a rebuilt job
      if(_isCarryOver(j))return false;// stale job from a prior order that reused this SO number
      // Stale duplicate — its decorations are already covered by a current job. Only the
      // orphan-preservation case (decoration genuinely missing) should fall through below.
      const pairs=_jobDecoPairs(j);
      if(pairs.length&&pairs.every(p=>_coveredPairs.has(p)))return false;
      const artIds=(Array.isArray(j._art_ids)&&j._art_ids.length?j._art_ids:[j.art_file_id]).filter(Boolean);
      const hasRealArt=artIds.some(aid=>aid&&aid!=='__tbd'&&af.some(a=>a.id===aid));
      const wasSubmitted=j.art_status&&j.art_status!=='needs_art';
      return hasRealArt&&wasSubmitted;
    });
    return[..._kept,...orphanedSubmitted];
  },[o,af]);// eslint-disable-line

  // Auto-sync jobs whenever decorations or items change (does NOT mark dirty — auto-sync is not a user edit).
  // syncJobs preserves manually merged/split/released jobs, so it's safe to run on every change — newly
  // added items (e.g. a different deco type) always spawn their own job here.
  React.useEffect(()=>{
    if(!isSO)return;
    const currentJobs=safeJobs(o);
    const synced=syncJobs();
    const _keySig=js=>js.map(j=>j.key).sort().join(',');
    const _unitSig=js=>js.map(j=>(j.id||j.key)+':'+j.total_units+'-'+j.fulfilled_units).sort().join(',');
    if(_keySig(currentJobs)!==_keySig(synced)||_unitSig(currentJobs)!==_unitSig(synced)){
      setO(e=>({...e,jobs:synced}));// don't bump updated_at for auto-sync — avoids false dirty/conflict detection
    }
  },[syncJobs]);// eslint-disable-line

  const fp=products.filter(p=>{if(!pS||pS.length<2)return false;if(p.is_archived)return false;const tokens=pS.toLowerCase().split(/\s+/).filter(Boolean);if(!tokens.length)return false;const sku=p.sku.toLowerCase(),name=p.name.toLowerCase(),brand=(p.brand||'').toLowerCase(),color=(p.color||'').toLowerCase();return tokens.every(t=>sku.includes(t)||name.includes(t)||brand.includes(t)||color.includes(t))});
  // Server-side product search fallback when local products don't match
  const[serverProducts,setServerProducts]=useState([]);
  const serverSearchTimer=useRef(null);
  React.useEffect(()=>{
    if(serverSearchTimer.current)clearTimeout(serverSearchTimer.current);
    if(!showAdd||!pS||pS.length<2||fp.length>0||!searchProductsProp){setServerProducts([]);return}
    serverSearchTimer.current=setTimeout(async()=>{
      try{
        const res=await searchProductsProp(pS,{},0,12);
        if(res?.products?.length)setServerProducts(res.products);
        else setServerProducts([]);
      }catch(e){setServerProducts([])}
    },300);
    return()=>{if(serverSearchTimer.current)clearTimeout(serverSearchTimer.current)};
  },[pS,showAdd,fp.length]);
  const allFp=fp.length>0?fp:serverProducts;
  const statusFlow=['need_order','waiting_receive','needs_pull','items_received','in_production','ready_to_invoice','complete'];

  return(<div>
    {/* ── Mockup lightbox overlay ── */}
    {mockupLightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setMockupLightbox(null)}>
      <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setMockupLightbox(null)}>×</button>
      {_isImgUrl(mockupLightbox)?<img src={mockupLightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
      :_isPdfUrl(mockupLightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(mockupLightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
      :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
    </div>}
    {/* Quick Mock re-edit — reopen the builder for an existing quick-mock job and write the
        updated composites back to the artwork in place (status unchanged, live to coach portal). */}
    {editMockJob&&(()=>{
      const j2=safeJobs(o).find(jj=>jj.id===editMockJob.id)||editMockJob;
      const artIds=((j2._art_ids&&j2._art_ids.length?j2._art_ids:[j2.art_file_id])||[]).filter(a=>a&&a!=='__tbd');
      const primaryId=artIds[0];
      const _back=full=>{const prd=products.find(pp=>pp.id===full?.product_id||pp.sku===full?.sku);return prd?.back_image_url||(prd?.images&&prd.images[1])||full?._colorBackImage||_vImg(full,'back')||''};
      const garments=[];const seenG=new Set();
      (j2.items||[]).forEach(it0=>{const full=safeItems(o)[it0.item_idx];const sku=it0.sku||full?.sku||'';const color=it0.color||full?.color||'';const key=sku+'|'+color;if(seenG.has(key))return;seenG.add(key);garments.push({key,sku,color,name:it0.name||full?.name||'',frontUrl:full?_itemImg(full):'',backUrl:full?_back(full):''})});
      const _renderable=f=>{const u=typeof f==='string'?f:(f?.url||'');return !!u&&(_isImgUrl(u)||/\.svg(\?|$)/i.test(u))};
      const _filePreview=f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u)return null;if(_renderable(f))return{url:u};if(u.includes('cloudinary.com')&&/\.(ai|eps|pdf)(\?|$)/i.test(u)){const png=_cloudinaryPdfThumb(u);if(png)return{url:png,vectorSrc:u}}return null};
      const _fileName=f=>{const u=typeof f==='string'?f:(f?.url||'');return (typeof f!=='string'&&f?.name)||u.split('?')[0].split('/').pop()||'art'};
      const locations=[];
      artIds.forEach(aid=>{const art=safeArt(o).find(a=>a.id===aid);if(!art)return;
        const _onfile=[...(art.files||[]),...(art.prod_files||[])].filter(f=>typeof f==='string'||f?.url);
        const files=[];const _seenF=new Set();
        [art.preview_url,...(art.mockup_files||[]),..._onfile].forEach(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seenF.has(u))return;const pv=_filePreview(f);if(!pv)return;_seenF.add(u);files.push({name:_fileName(f),url:u,preview:pv})});
        locations.push({artFileId:aid,name:art.name||j2.art_name||'',position:j2.positions||'',existingFiles:_onfile,files,preview:files.length?files[0].preview:null});
      });
      const initialMocks={};const initialScene={};
      artIds.forEach(aid=>{const art=safeArt(o).find(a=>a.id===aid);if(!art)return;Object.entries(art.item_mockups||{}).forEach(([k,arr])=>{if(arr&&arr.length)initialMocks[k]=[...(initialMocks[k]||[]),...arr]});Object.entries(art.qm_scenes||{}).forEach(([k,objs])=>{if(objs&&objs.length&&!initialScene[k])initialScene[k]=objs})});
      return<QuickMockBuilder garments={garments} locations={locations} initialMocks={initialMocks} initialScene={initialScene} nf={nf}
        onClose={()=>setEditMockJob(null)}
        onSave={({mocksByGarment,filesByLocation,sceneByGarment})=>{
          const _fUrl=f=>typeof f==='string'?f:(f?.url||'');
          const updArt=safeArt(o).map(a=>{
            if(!artIds.includes(a.id))return a;
            const upd={...a};
            const locFiles=(filesByLocation||{})[a.id]||[];
            if(locFiles.length){const have=new Set((a.files||[]).map(_fUrl));upd.files=[...(a.files||[]),...locFiles.filter(f=>!have.has(_fUrl(f)))]}
            if(a.id===primaryId){const im={};Object.entries(mocksByGarment||{}).forEach(([k,arr])=>{if(arr&&arr.length)im[k]=arr.map(m=>({...m,art_file_id:primaryId}))});upd.item_mockups=im;if(sceneByGarment)upd.qm_scenes=sceneByGarment}
            return upd;
          });
          const updated={...o,art_files:updArt,updated_at:new Date().toLocaleString()};
          setO(updated);onSave(updated);setDirty(false);setEditMockJob(null);
          nf('Mockup updated — the coach portal now shows the new version');
        }}/>;
    })()}
    {/* Sticky header — appears when scrolling */}
    <div style={{position:'sticky',top:52,zIndex:40,background:'white',borderBottom:'1px solid #e2e8f0',padding:'8px 16px',marginBottom:0,display:'flex',alignItems:'center',gap:12,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',flexWrap:'wrap'}}>
      <button className="btn btn-sm btn-secondary" onClick={()=>{if(dirty&&!window.confirm('You have unsaved changes. Leave without saving?'))return;onBack()}} style={{fontSize:10,padding:'4px 10px'}}><Icon name="back" size={12}/> Back</button>
      {returnToPage&&onReturnToJob&&<button className="btn btn-sm" onClick={()=>{if(dirty&&!window.confirm('You have unsaved changes. Leave without saving?'))return;onReturnToJob()}} style={{fontSize:10,padding:'4px 10px',background:'#7c3aed',color:'white',border:'none',fontWeight:700}}>← Return to {returnToPage.page==='production'?'Production Board':'Decoration'}</button>}
      {isE&&onNewEstimate&&<button className="btn btn-sm btn-secondary" onClick={()=>{if(dirty&&!window.confirm('Unsaved changes. Continue?'))return;onNewEstimate()}} style={{fontSize:10,padding:'4px 10px'}}><Icon name="plus" size={12}/> New Est</button>}
      <span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{o.id}</span>
      {isSO&&<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:SC[o.status]?.bg||'#f1f5f9',color:SC[o.status]?.c||'#475569'}}>{o.status?.replace(/_/g,' ')}</span>}
      {cust&&<span style={{fontSize:12,fontWeight:600,color:'#1e40af',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted',textUnderlineOffset:2}} onClick={()=>{if(onNavCustomer&&cust)onNavCustomer(cust)}} title={'View '+cust.name}>{cust.name}</span>}
      <span style={{fontSize:11,color:'#94a3b8',flex:1}}>{o.memo||''}</span>
      {dirty&&<span style={{fontSize:10,color:'#d97706',fontWeight:600}}>● Unsaved</span>}
      <button className="btn btn-sm btn-primary" onClick={()=>{
        if(!cust){nf('Select a customer first','error');return}
        if(!o.memo?.trim()){nf('Memo is required','error');return}
        const validItems=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
        if(validItems.length===0){nf('Add at least one item with quantities','error');return}
        onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved locally — syncing to cloud…`)}} style={{padding:'6px 20px',fontSize:13,fontWeight:700}}><Icon name="check" size={14}/> Save</button>
    </div>
    {/* COACH APPROVED BANNER */}
    {isE&&o.status==='approved'&&o.approved_by==='Coach'&&<div style={{margin:'8px 0',padding:'12px 16px',background:'#f0fdf4',border:'2px solid #22c55e',borderRadius:10}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:16}}>✅</span>
        <div style={{flex:1}}>
          <span style={{fontWeight:800,fontSize:14,color:'#166534'}}>Coach Approved This Estimate</span>
          {o.approved_at&&<span style={{fontSize:11,color:'#15803d',marginLeft:8}}>{new Date(o.approved_at).toLocaleDateString()}</span>}
        </div>
        {onConvertSO&&<button className="btn btn-sm" style={{fontSize:11,background:'#166534',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={()=>{const validItems=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});if(validItems.length===0){nf('Add items first','error');return}onConvertSO(o)}}>Convert to Sales Order</button>}
      </div>
    </div>}
    {/* UPDATE REQUESTS BANNER — shows when coach has requested changes */}
    {isE&&(o.update_requests||[]).filter(r=>r.status==='pending').length>0&&<div style={{margin:'8px 0',padding:'12px 16px',background:'#fffbeb',border:'2px solid #f59e0b',borderRadius:10}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}><span style={{fontSize:16}}>📝</span><span style={{fontWeight:800,fontSize:14,color:'#92400e'}}>Coach Update Requests ({(o.update_requests||[]).filter(r=>r.status==='pending').length})</span></div>
      {(o.update_requests||[]).filter(r=>r.status==='pending').map((req,ri)=><div key={ri} style={{padding:'8px 12px',background:'white',borderRadius:8,marginBottom:6,border:'1px solid #fde68a'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:'#92400e',fontWeight:600}}>{req.from} · {new Date(req.at).toLocaleDateString()}</div>
            <div style={{fontSize:13,color:'#78350f',marginTop:2}}>{req.text}</div>
          </div>
          <div style={{display:'flex',gap:4,flexShrink:0,marginLeft:8}}>
            <button className="btn btn-sm" style={{fontSize:10,background:'#3b82f6',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>{if(onAssignTodo){onAssignTodo({title:'Coach update request: '+(o.memo||o.id),description:req.text,so_id:'',customer_id:o.customer_id||'',priority:1})}const upd=(o.update_requests||[]).map(r=>r.id===req.id?{...r,status:'in_progress'}:r);const updated={...o,update_requests:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setSaved(true);setDirty(false);nf('Assigned to CSR')}}>Assign to CSR</button>
            <button className="btn btn-sm" style={{fontSize:10,background:'#22c55e',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>{const upd=(o.update_requests||[]).map(r=>r.id===req.id?{...r,status:'completed',completed_at:new Date().toISOString()}:r);const updated={...o,update_requests:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setSaved(true);setDirty(false);nf('Update request completed')}}>Done</button>
          </div>
        </div>
      </div>)}
    </div>}
    {/* HEADER */}
    <div className="card" style={{marginBottom:16,marginTop:8}}><div style={{padding:'16px 20px'}}>
      <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}><span style={{fontSize:22,fontWeight:800,color:'#1e40af'}}>{o.id}</span>
            {isE&&<span className={`badge ${o.status==='draft'||o.status==='open'?'badge-blue':o.status==='sent'?'badge-amber':o.status==='approved'?'badge-green':'badge-blue'}`}>{o.status}</span>}
            {isSO&&<span style={{padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700,background:SC[o.status]?.bg||'#f1f5f9',color:SC[o.status]?.c||'#475569'}}>{o.status?.replace(/_/g,' ')}</span>}
            {isSO&&o.order_type==='booking'&&<span style={{padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700,background:'#e0e7ff',color:'#4338ca'}}>Booking{o.booking_confirmed?' (Confirmed)':''}</span>}
            {isE&&<EmailBadge e={o}/>}</div>
          {isE&&(o.sent_history||[]).length>0&&<div style={{marginTop:6,padding:'8px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8}}>
            <div style={{fontSize:11,fontWeight:700,color:'#475569',marginBottom:4}}>Send History</div>
            {(o.sent_history||[]).map((h,hi)=><div key={hi} style={{fontSize:11,color:'#64748b',display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
              <span style={{color:'#2563eb'}}>✉️</span>
              <span>{new Date(h.sent_at).toLocaleDateString()} @ {new Date(h.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}</span>
              <span style={{color:'#94a3b8'}}>by {h.sent_by}</span>
              {h.methods&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'#eff6ff',color:'#1e40af'}}>{h.methods.join(', ')}</span>}
              {h.to&&<span style={{fontSize:9,color:'#94a3b8'}}>→ {h.to}</span>}
            </div>)}
            {o.email_opened_at&&<div style={{fontSize:11,color:'#1e40af',marginTop:4,fontWeight:600}}>👁️ Opened: {o.email_opened_at}</div>}
            {o.follow_up_at&&<div style={{fontSize:11,color:'#92400e',marginTop:2}}>⏰ Follow-up: {new Date(o.follow_up_at).toLocaleDateString()}{new Date(o.follow_up_at)<new Date()?' (overdue)':''}</div>}
          </div>}
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>{const par=c.parent_id?allCustomers.find(p=>p.id===c.parent_id):null;const tags=[...(c.search_tags||[]),...(par?.search_tags||[])].filter(Boolean).join(' ');return{value:c.id,label:`${c.name} (${c.alpha_tag})`,searchText:tags}})} value={o.customer_id} onChange={selC} placeholder="Search customer..."/></div>
          :<div><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:18,fontWeight:800}}>{cust.name}</span> <span style={{fontSize:14,color:'#64748b'}}>({cust.alpha_tag})</span>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:10,textDecoration:'underline',padding:0}} onClick={()=>{if(window.confirm('Change customer for '+o.id+'? This will update pricing tier.'))selC(null);setCust(null)}}>change</button></div>
            <div style={{fontSize:13,color:'#64748b'}}>Tier {cust.adidas_ua_tier} | {o.default_markup||1.65}x | Tax: {(isSO&&o.tax_rate!=null?o.tax_rate:cust.tax_rate)?(((isSO&&o.tax_rate!=null?o.tax_rate:cust.tax_rate))*100).toFixed(3)+'%':'N/A'}</div></div>}
          {isSO&&o.estimate_id&&onViewEstimate&&<div style={{fontSize:11,color:'#7c3aed'}}>From: <span style={{cursor:'pointer',textDecoration:'underline',fontWeight:600}} onClick={()=>onViewEstimate(o.estimate_id)} title="Open source estimate">{o.estimate_id}</span></div>}
          {isE&&o.status==='converted'&&(()=>{const linkedSO=(allOrders||[]).find(s=>s.estimate_id===o.id);return linkedSO&&onViewSO?<div style={{fontSize:11,color:'#7c3aed'}}>Converted to: <span style={{cursor:'pointer',textDecoration:'underline',fontWeight:600}} onClick={()=>onViewSO(linkedSO.id)} title="Open sales order">{linkedSO.id}</span></div>:null})()}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>By {REPS.find(r=>r.id===o.created_by)?.name} · {o.created_at}</div>
          {cust?.alpha_tag&&<div style={{fontSize:11,marginTop:2}}><a href={'/?portal='+cust.alpha_tag} target="_blank" rel="noreferrer" style={{color:'#7c3aed',textDecoration:'none',fontWeight:500}}>🔗 Customer Portal</a></div>}
          {isSO&&(o._shipments||[]).length>0&&<div style={{padding:8,background:'#f0fdf4',borderRadius:6,marginTop:8}}>
            <strong>Shipped:</strong> {(o._shipments||[]).length} package{(o._shipments||[]).length!==1?'s':''} —{' '}
            {(o._shipments||[]).map((s,si)=>s.tracking_number?<a key={si} href={s.tracking_url||((/^1Z/i.test(s.tracking_number))?'https://www.ups.com/track?tracknum='+s.tracking_number:'https://www.fedex.com/fedextrack/?trknbr='+s.tracking_number)} target="_blank" rel="noreferrer" style={{fontFamily:'monospace',fontSize:11,marginRight:6}}>{s.tracking_number}</a>:<span key={si} style={{fontSize:11,color:'#94a3b8',marginRight:6}}>Box {si+1} (no tracking)</span>)}
            <button className="btn btn-sm btn-secondary" style={{fontSize:10,marginLeft:4}} onClick={()=>setTab('tracking')}>View All</button>
          </div>}
          {isSO&&!(o._shipments||[]).length&&o._tracking_number&&<div style={{padding:8,background:'#f0fdf4',borderRadius:6,marginTop:8}}>
            <strong>Shipped:</strong> Tracking #{o._tracking_number} via {o._carrier} on {o._ship_date}
            {o._tracking_url&&<a href={o._tracking_url} target="_blank" rel="noreferrer" style={{marginLeft:8}}>Track Package</a>}
          </div>}
          {isSO&&o.status==='in_production'&&!o._shipped&&ssConnected&&onShipSS&&<div style={{display:'flex',gap:8,marginTop:8}}>
            <button className="btn btn-sm btn-primary" style={{background:'#7c3aed',fontSize:11}} onClick={()=>onShipSS(o)} disabled={ssShipping}>
              {ssShipping?'Submitting...':'Ship via ShipStation'}
            </button>
            {o._shipstation_order_id&&<button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>onCheckShipStatus(o.id)}>Check Shipping Status</button>}
          </div>}
          {isSO&&o._shipstation_order_id&&!o._tracking_number&&!(o._shipments||[]).length&&<div style={{padding:6,background:'#eff6ff',borderRadius:6,marginTop:6,fontSize:11,color:'#1e40af'}}>
            Submitted to ShipStation (ID: {o._shipstation_order_id})
            <button className="btn btn-sm btn-secondary" style={{marginLeft:8,fontSize:10}} onClick={()=>onCheckShipStatus&&onCheckShipStatus(o.id)}>Refresh Status</button>
          </div>}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{l:'REV',v:totals.rev,bg:'#f0fdf4',c:'#166534'},{l:'COST',v:totals.cost,bg:'#fef2f2',c:'#dc2626'},{l:'MARGIN',v:totals.margin,bg:'#dbeafe',c:'#1e40af',s:`${totals.pct.toFixed(1)}%`},
            ...(totals.omgFee>0?[{l:'OMG FEE',v:totals.omgFee,bg:'#fff7ed',c:'#9a3412',s:'in cost'}]:[]),
            ...(totals.ship>0?[{l:'SHIP',v:totals.ship,bg:'#f0f9ff',c:'#0369a1'}]:[]),
            ...(totals.tax>0?[{l:'TAX',v:totals.tax,bg:'#fefce8',c:'#a16207',s:(totals.taxRate*100).toFixed(3)+'%'}]:[]),
            ...(o.omg_store_id&&o.tax_exempt?[{l:'TAX',v:0,bg:'#f0fdf4',c:'#166534',s:'OMG remits'}]:cust?.tax_exempt?[{l:'TAX',v:0,bg:'#fef2f2',c:'#dc2626',s:'EXEMPT'}]:[]),
            {l:'TOTAL',v:(()=>{let t=o.promo_applied&&promoTotals?promoTotals.customerPays:totals.grand;if(o.credit_applied)t=Math.max(0,t-safeNum(o.credit_amount));return t})(),bg:o.promo_applied||o.credit_applied?'#dcfce7':'#faf5ff',c:o.promo_applied||o.credit_applied?'#166534':'#7c3aed'},
            ...(o.credit_applied?[{l:'CREDIT',v:safeNum(o.credit_amount),bg:'#d1fae5',c:'#065f46',s:'deducted'}]:[])].map(x=>
            <div key={x.l} style={{textAlign:'center',padding:'8px 12px',background:x.bg,borderRadius:8,minWidth:72}}><div style={{fontSize:9,color:x.c,fontWeight:700}}>{x.l}</div><div style={{fontSize:17,fontWeight:800,color:x.c}}>${x.v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>{x.s&&<div style={{fontSize:9,color:'#94a3b8'}}>{x.s}</div>}</div>)}</div>
          {isSO&&(()=>{const actualShip=safeNum(o._shipping_cost||o._shipstation_cost||0)||(o._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);const quotedShip=o.shipping_type==='pct'?totals.rev*(o.shipping_value||0)/100:safeNum(o.shipping_value||0);const overage=actualShip-quotedShip;
            return actualShip>0&&overage>0?<div style={{fontSize:10,padding:'4px 10px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,color:'#dc2626',fontWeight:600,marginTop:4}}>
              ⚠️ Shipping cost ${actualShip.toFixed(2)} exceeds quoted ${quotedShip.toFixed(2)} by <strong>${overage.toFixed(2)}</strong>
            </div>:null})()}
      {isSO&&safeFirm(o).length>0&&(()=>{const fd=safeFirm(o)[0];const approved=fd.approved;return<div style={{padding:'8px 16px',background:approved?'#f5f3ff':'#faf5ff',border:approved?'2px solid #7c3aed':'2px solid #c4b5fd',borderRadius:8,marginTop:8,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:14}}>{approved?'✅':'📌'}</span>
        <div style={{flex:1,fontSize:12}}>
          {approved?<><strong style={{color:'#7c3aed'}}>Firm Date Approved:</strong> <strong>{fd.date}</strong></>
          :<><strong style={{color:'#7c3aed'}}>Firm Date Requested:</strong> <strong>{fd.date}</strong> <span style={{color:'#94a3b8'}}>— Pending GM approval</span>{fd.note&&<span style={{color:'#64748b'}}> · {fd.note}</span>}</>}
          {fd.rush_pct>0&&<span style={{marginLeft:8,padding:'1px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e'}}>+{fd.rush_pct}% deco rush fee</span>}
        </div>
        {!approved&&<button className="btn btn-sm" style={{fontSize:10,background:'#7c3aed',color:'white',border:'none',padding:'4px 10px',fontWeight:700}} onClick={()=>{setShowFirmApprove(true)}}>Review & Approve</button>}
      </div>})()}
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,alignItems:'end',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180}}><label className="form-label">Memo</label><input className="form-input" value={o.memo} onChange={e=>sv('memo',e.target.value)} style={{fontSize:14}}/></div>
        {isSO&&<div style={{width:140}}><label className="form-label">School PO #</label><input className="form-input" value={o.po_number||''} onChange={e=>sv('po_number',e.target.value)} placeholder="e.g. PO-12345" style={{fontSize:13,fontFamily:'monospace',fontWeight:600}}/></div>}
        {isE&&<div style={{width:70}}><label className="form-label">Markup</label><input className="form-input" type="number" step="0.05" value={o.default_markup} onChange={e=>{const m=parseFloat(e.target.value)||1.65;sv('default_markup',m);sv('items',safeItems(o).map(it=>isAU(it.brand)?it:{...it,unit_sell:rQ(it.nsa_cost*m)}))}}/></div>}
        {isSO&&<div style={{width:120}}>
          <label className="form-label">Order Type</label>
          <select className="form-select" value={o.order_type||'at_once'} onChange={e=>{sv('order_type',e.target.value);if(e.target.value==='at_once'){sv('expected_ship_date',null);sv('booking_confirmed',false);sv('booking_alert_days',100)}}}>
            <option value="at_once">At-Once</option><option value="booking">Booking</option></select>
        </div>}
        {isSO&&<div style={{width:140}}>
          <label className="form-label">Expected</label>
          <input className="form-input" type="date" value={o.expected_date||''} onChange={e=>sv('expected_date',e.target.value)}/>
        </div>}
        {isSO&&o.order_type==='booking'&&<div style={{width:140}}>
          <label className="form-label">Ship Date</label>
          <input className="form-input" type="date" value={o.expected_ship_date||''} onChange={e=>sv('expected_ship_date',e.target.value)}/>
        </div>}
        {isSO&&o.order_type==='booking'&&<div style={{width:80}}>
          <label className="form-label">Alert Days</label>
          <input className="form-input" type="number" min="60" max="180" value={o.booking_alert_days||100} onChange={e=>sv('booking_alert_days',parseInt(e.target.value)||100)}/>
          <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>before ship</div>
        </div>}
        <button className="btn btn-primary" onClick={()=>{
          if(!cust){nf('Select a customer first','error');return}
          if(!o.memo?.trim()){nf('Memo is required','error');return}
          const validItems=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
          if(validItems.length===0){nf('Add at least one item with quantities','error');return}
          const noSku=validItems.find(it=>!it.sku?.trim()&&!it.is_custom);
          if(noSku){nf('Item '+(noSku.name||'#?')+' needs a SKU or mark as custom','error');return}
          const noPrice=validItems.find(it=>safeNum(it.unit_sell)<=0);
          if(noPrice){nf('Item '+(noPrice.sku||noPrice.name||'#?')+' needs a sell price','error');return}
          onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved locally — syncing to cloud…`)}} style={{padding:'10px 28px',fontSize:16,fontWeight:800}}><Icon name="check" size={16}/> Save</button>
        {isE&&saved&&(o.status==='sent'||o.status==='draft'||o.status==='open')&&<button className="btn btn-primary" style={{background:'#22c55e'}} onClick={()=>{sv('status','approved');onSave({...o,status:'approved'});nf('Estimate approved')}}><Icon name="check" size={14}/> Approve</button>}
        {isE&&o.status==='approved'&&<button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>{
          if(!cust){nf('Select a customer first','error');return}
          if(!o.memo?.trim()){nf('Memo is required','error');return}
          const validItems=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
          if(validItems.length===0){nf('Cannot convert — add at least one item with quantities','error');return}
          /* Items with est_qty only (no size breakdown) are allowed — sizes can be added on the SO */
          const noSku=validItems.find(it=>!it.sku?.trim()&&!it.is_custom);
          if(noSku){nf('Item '+(noSku.name||'#?')+' needs a SKU or mark as custom','error');return}
          const noPrice=validItems.find(it=>safeNum(it.unit_sell)<=0);
          if(noPrice){nf('Item '+(noPrice.sku||noPrice.name||'#?')+' needs a sell price','error');return}
          onConvertSO(o)}}><Icon name="box" size={14}/> Convert to SO</button>}
        {/* Actions dropdown */}
        <div style={{position:'relative'}}>
          <button ref={actionsRef} className="btn btn-sm btn-secondary" style={{fontSize:11,padding:'6px 12px'}} onClick={()=>setShowActionsDD(!showActionsDD)}>Actions <span style={{fontSize:9}}>▾</span></button>
          {showActionsDD&&(()=>{const r=actionsRef.current?.getBoundingClientRect();
            // Build the printable/downloadable doc options. Shared by Print and Download.
            const _makeDocOpts=()=>{
              const items=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
              const _pAQ={};items.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
              const isRolled=(o.pricing_mode||'itemized')==='rolled_up';
              const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);
              const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              const rows=[];let subTotal=0;
              items.forEach(it=>{
                const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);
                const decos=safeDecos(it);
                const decoSell=decos.reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);return a+dp2.sell},0);
                const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
                const unitPrice=isRolled?safeNum(it.unit_sell)+decoSell:safeNum(it.unit_sell);
                const lineAmt=qty*unitPrice;subTotal+=lineAmt;
                let itemName=(it.name||'')+(it.color?' - '+it.color:'');
                if(szStr)itemName+='<br/><span>'+szStr+'</span>';
                if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
                rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
                decos.forEach(d=>{
                  const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);
                  const artF=af.find(a2=>a2.id===d.art_file_id);
                  const decoLabel=pdfDecoLabel(d,artF);
                  const posLabel=d.position?' — '+d.position:'';
                  let numHtml='';
                  if(d.kind==='numbers'&&d.roster){const szOrd2=['XS','S','M','L','XL','2XL','3XL','4XL'];
                    const sorted=Object.entries(d.roster).sort((a,b)=>(szOrd2.indexOf(a[0])===-1?99:szOrd2.indexOf(a[0]))-(szOrd2.indexOf(b[0])===-1?99:szOrd2.indexOf(b[0])));
                    const szRows=sorted.filter(([,arr])=>(arr||[]).some(v=>v)).map(([sz,arr])=>'<tr><td style="font-weight:700;padding:1px 6px;font-size:10px">'+sz+'</td><td style="font-size:10px;padding:1px 4px">'+(arr||[]).filter(v=>v).join(', ')+'</td></tr>');
                    if(szRows.length>0)numHtml='<table style="margin:2px 0 0 20px;border-collapse:collapse">'+szRows.join('')+'</table>'}
                  if(d.kind==='names'&&d.names){const szOrd2=['XS','S','M','L','XL','2XL','3XL','4XL'];
                    const sorted=Object.entries(d.names).sort((a,b)=>(szOrd2.indexOf(a[0])===-1?99:szOrd2.indexOf(a[0]))-(szOrd2.indexOf(b[0])===-1?99:szOrd2.indexOf(b[0])));
                    const szRows=sorted.filter(([,arr])=>(arr||[]).some(v=>v)).map(([sz,arr])=>'<tr><td style="font-weight:700;padding:1px 6px;font-size:10px">'+sz+'</td><td style="font-size:10px;padding:1px 4px">'+(arr||[]).filter(v=>v).join(', ')+'</td></tr>');
                    if(szRows.length>0)numHtml='<table style="margin:2px 0 0 20px;border-collapse:collapse">'+szRows.join('')+'</table>'}
                  if(isRolled){
                    rows.push({_class:'deco-row',cells:[{value:'',style:'text-align:center;border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'<span style="padding-left:16px">'+decoLabel+posLabel+'</span>'+numHtml,style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'}]});
                  }else{
                    const decoAmt=qty*dp2.sell;subTotal+=decoAmt;
                    rows.push({_class:'deco-row',cells:[{value:qty,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+decoLabel+posLabel+'</span>'+numHtml},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
                  }
                });
              });
              const shipAmt=o.shipping_type==='pct'?subTotal*(o.shipping_value||0)/100:(o.shipping_value||0);
              const _pdfCredit=o.credit_applied?safeNum(o.credit_amount):0;
              const _pdfCreditOnSub=Math.min(_pdfCredit,subTotal);
              const _pdfReducedSub=Math.max(0,subTotal-_pdfCreditOnSub);
              const taxAmt=_pdfCredit>0?_pdfReducedSub*taxRate:subTotal*taxRate;
              const _pdfCreditApplied=Math.min(_pdfCredit,subTotal+shipAmt+taxAmt);
              const total=subTotal+shipAmt+taxAmt-_pdfCreditApplied;
              const ddBillAddr=cust?.shipping_address_line1?cust.shipping_address_line1+(cust.shipping_city?'<br/>'+cust.shipping_city+(cust.shipping_state?' '+cust.shipping_state:'')+(cust.shipping_zip?' '+cust.shipping_zip:''):'')+'<br/>United States':(cust?.billing_address_line1?cust.billing_address_line1+(cust.billing_city?'<br/>'+cust.billing_city+(cust.billing_state?' '+cust.billing_state:'')+(cust.billing_zip?' '+cust.billing_zip:''):'')+'<br/>United States':'');
              return{
                title:cust?.name||'Customer',docNum:o.id,docType:isE?'ESTIMATE':'SALES ORDER',
                headerRight:'<div class="ta">'+_$(total)+'</div>'+(isE?'<div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>':''),
                infoBoxes:[
                  {label:'Bill To',value:cust?.name||'—',sub:ddBillAddr||''},
                  {label:isE?'Expires':'Expected',value:isE?new Date(Date.now()+30*86400000).toLocaleDateString():(o.expected_date||'TBD')},
                  {label:'Sales Rep',value:REPS.find(r2=>r2.id===o.created_by)?.name||'—'},
                  {label:isE?'Estimate':'Sales Order',value:o.id},
                  {label:'Memo',value:o.memo||'—'},
                ],
                tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
                  rows:[...rows,
                    {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                    ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(shipAmt),style:'text-align:right;border:none'}]}]:[]),
                    ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(taxRate*100).toFixed(3)+'%)</strong>',style:'text-align:right;border:none'},{value:_$(taxAmt),style:'text-align:right;border:none'}]}]:[]),
                    ...(_pdfCreditApplied>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$(_pdfCreditApplied)+'</strong>',style:'text-align:right;border:none'}]}]:[]),
                    {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(total)+'</strong>',style:'text-align:right'}]},
                  ]}],
                footer:isE?'This estimate is valid for 30 days. Prices subject to change. '+_ci.depositTerms:_ci.terms,
                portalLink:cust?.alpha_tag?(window.location.origin+'?portal='+cust.alpha_tag):undefined
              };
            };
            return<><div style={{position:'fixed',inset:0,zIndex:98}} onClick={()=>setShowActionsDD(false)}/><div style={{position:'fixed',top:(r?r.bottom+4:0),right:(r?window.innerWidth-r.right:0),background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:99,minWidth:180}}>
            {saved&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);setShowSend(true)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="send" size={12}/> Send</button>}
            <button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);
              printDoc(_makeDocOpts());
              const ph=[...(o.print_history||[]),{printed_at:new Date().toLocaleString(),printed_by:cu.name||cu.id}];sv('print_history',ph);onSave({...o,print_history:ph});
            }} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>🖨️ Print</button>
            {isSO&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);
              const packItems=safeItems(o);
              const _szSort=(a,b)=>{const ai=SZ_ORD.indexOf(a),bi=SZ_ORD.indexOf(b);return (ai<0?999:ai)-(bi<0?999:bi)};
              const packRows=packItems.map(it=>{
                const szObj=safeSizes(it);
                const sizeEntries=Object.entries(szObj).filter(([,v])=>safeNum(v)>0).sort((a,b)=>_szSort(a[0],b[0]));
                const totalFromSizes=sizeEntries.reduce((a,[,v])=>a+safeNum(v),0);
                const szStr=sizeEntries.map(([sz,v])=>sz+': '+v).join('  ');
                const qty=totalFromSizes>0?totalFromSizes:safeNum(it.est_qty);
                if(!it.sku&&!it.name&&qty<=0)return null;
                return{cells:[{value:it.sku||'',style:'font-family:monospace;font-weight:700'},{value:it.name||''},{value:it.color||'—'},{value:szStr||'—',style:'font-size:11px'},{value:qty||'—',style:'text-align:center;font-weight:700'}]};
              }).filter(Boolean);
              const totalUnits=packRows.reduce((a,r)=>{const v=r.cells[4].value;return a+(typeof v==='number'?v:0)},0);
              const shipAddrSub=(()=>{
                if(o.ship_to_id==='custom'&&o.ship_to_custom)return o.ship_to_custom;
                if(cust?.shipping_address_line1){let a=cust.shipping_address_line1;if(cust.shipping_address_line2)a+='<br/>'+cust.shipping_address_line2;a+='<br/>'+(cust.shipping_city||'')+', '+(cust.shipping_state||'')+' '+(cust.shipping_zip||'');return a}
                if(cust?.billing_address_line1){let a=cust.billing_address_line1;if(cust.billing_address_line2)a+='<br/>'+cust.billing_address_line2;a+='<br/>'+(cust.billing_city||'')+', '+(cust.billing_state||'')+' '+(cust.billing_zip||'');return a}
                return '';
              })();
              const packOpts={
                title:cust?.name||'Customer',docNum:o.id,docType:'PACKING LIST',showPricing:false,
                headerRight:'<div class="ta" style="font-size:20px">'+totalUnits+' Total Units</div>',
                infoBoxes:[
                  {label:'Ship To',value:cust?.name||'—',sub:shipAddrSub},
                  {label:'Ship Date',value:new Date().toLocaleDateString()},
                  {label:'Sales Order',value:o.id},
                  ...(o.memo?[{label:'Memo',value:o.memo}]:[]),
                ],
                tables:[{title:'Items in this Shipment',headers:['SKU','Item','Color','Sizes','Qty'],aligns:['left','left','left','left','center'],rows:packRows}],
                notes:'Please inspect all items upon receipt. Report any discrepancies within 48 hours.',
                footer:'NO PRICING — Packing List'
              };
              openDocPDF(packOpts,'Packing-List-'+o.id).catch(err=>{console.warn('PDF open failed, falling back to print:',err);printDoc(packOpts)});
              nf('📦 Packing list opened for '+(cust?.name||o.id));
            }} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>📦 Pack Slip</button>}
            <button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={async()=>{setShowActionsDD(false);
              try{await downloadDoc(_makeDocOpts(),(isE?'Estimate-':'SO-')+o.id+(cust?.name?'-'+cust.name:''));nf('📥 Downloaded '+o.id+'.pdf');}
              catch(err){console.warn('PDF download failed:',err);nf('Download failed: '+(err?.message||'unknown error'),'error');}
            }} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>📥 Download</button>
            {isE&&onCopyEstimate&&saved&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(!window.confirm('Create a copy of this estimate?'))return;onCopyEstimate(o)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="file" size={12}/> Copy</button>}
            {isSO&&onCopySalesOrder&&saved&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(!window.confirm('Create a copy of this sales order?'))return;onCopySalesOrder(o)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="file" size={12}/> Copy</button>}
            {isE&&o.status==='approved'&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#d97706',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(!window.confirm('Unapprove estimate '+o.id+'? Status will be set back to open.'))return;sv('status','open');const updated={...o,status:'open',approved_by:null,approved_at:null};setO(updated);onSave(updated);nf('Estimate unapproved')}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="back" size={12}/> Unapprove</button>}
            {isSO&&onRevertToEst&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(!window.confirm('Revert '+o.id+' back to estimate? The SO will be deleted and '+(o.estimate_id?'the original estimate reopened.':'a new estimate created.')))return;onRevertToEst(o)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="back" size={12}/> Revert to Estimate</button>}
            {isSO&&o.estimate_id&&onViewEstimate&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);onViewEstimate(o.estimate_id)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="dollar" size={12}/> View Estimate</button>}
            {/* Promo Funds — show when customer has promo programs and funds available (auto-allocate period if needed) */}
            {cust&&(cust.promo_programs||[]).length>0&&!o.promo_applied&&(()=>{const _now=new Date(),_y=_now.getFullYear(),_m=_now.getMonth();const _pStart=_m<6?_y+'-01-01':_y+'-07-01';const _ps=(cust.promo_periods||[]).filter(p=>p.period_start===_pStart);const _bal=_ps.reduce((a,p)=>a+(p.allocated||0)-(p.used||0),0);if(_bal>0)return true;const progs=(cust.promo_programs||[]).filter(p=>p.is_active!==false);return progs.some(p=>p.type==='fixed'&&safeNum(p.fixed_amount)>0)})()&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#92400e',textAlign:'left'}} onClick={async()=>{setShowActionsDD(false);
              // Calculate available promo balance, auto-allocate period if needed
              const _now=new Date(),_y=_now.getFullYear(),_m=_now.getMonth();
              const _pStart=_m<6?_y+'-01-01':_y+'-07-01';const _pEnd=_m<6?_y+'-06-30':_y+'-12-31';
              let _ps=(cust.promo_periods||[]).filter(p=>p.period_start===_pStart);
              let promoBudget=_ps.reduce((a,p)=>a+(p.allocated||0)-(p.used||0),0);
              // Auto-allocate period from fixed programs if no period exists
              if(_ps.length===0){
                const progs=(cust.promo_programs||[]).filter(p=>p.is_active!==false&&p.type==='fixed'&&safeNum(p.fixed_amount)>0);
                const totalFixed=progs.reduce((a,p)=>a+safeNum(p.fixed_amount),0);
                if(totalFixed>0){
                  const newPeriod={id:'pp_'+(cust.parent_id||cust.id)+'_'+_pStart,customer_id:cust.parent_id||cust.id,period_start:_pStart,period_end:_pEnd,allocated:totalFixed,used:0,created_at:new Date().toISOString()};
                  await _dbSavePromoPeriod(newPeriod);
                  const updatedCust={...cust,promo_periods:[...(cust.promo_periods||[]),newPeriod]};
                  setCust(updatedCust);
                  _ps=[newPeriod];promoBudget=totalFixed;
                  nf('Auto-allocated $'+totalFixed.toLocaleString()+' promo for '+(_m<6?'H1 '+_y:'H2 '+_y));
                }
              }
              if(promoBudget<=0){nf('No promo funds available','error');return}
              // Calculate promo cost per item (retail price + 25% deco markup)
              const items=safeItems(o);const _aq={};items.forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});
              let remaining=promoBudget;const newItems=[];let fullCount=0;let partialItem=false;
              // Pre-compute original revenue per item so flat shipping can be allocated proportionally,
              // matching how promoTotals.promoShip distributes flat ship across promo items.
              const _origRev=items.map(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);let r=q2*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:q2;const dp=dP(d,q2,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q2*2:q2);r+=eq*dp.sell});return r});
              const _totalOrigRev=_origRev.reduce((a,v)=>a+v,0);
              const _flatShip=o.shipping_type==='flat'?safeNum(o.shipping_value):0;
              items.forEach((it,_ix)=>{
                const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!q){newItems.push(it);return}
                if(remaining<=0){newItems.push(it);return}
                const promoSell=safeNum(it.retail_price)||safeNum(it.nsa_cost)*2;
                let itemPromoCost=q*promoSell;
                safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);itemPromoCost+=eq*rQ(dp.sell*1.25)});
                // Add proportional shipping estimate (25% markup on promo portion). For flat shipping,
                // allocate by share of original revenue so the budget deduction matches promoTotals.promoAmount.
                const shipBase=o.shipping_type==='pct'?itemPromoCost*(o.shipping_value||0)/100:(_totalOrigRev>0?_flatShip*_origRev[_ix]/_totalOrigRev:0);
                const itemTotal=itemPromoCost+rQ(shipBase*1.25);
                if(remaining>=itemTotal){
                  // Fully covered by promo
                  remaining-=itemTotal;fullCount++;
                  newItems.push({...it,is_promo:true,_pre_promo_sell:it.unit_sell,unit_sell:promoSell});
                }else{
                  // Partially covered — cover N whole units fully at retail (discard the leftover),
                  // then blend the savings across the line by scaling both unit_sell and each deco
                  // sell down by (1 - N/q). Customer pays equivalent of (q-N) units at original sells.
                  const perUnitRetail=q>0?itemTotal/q:0;
                  const N=perUnitRetail>0?Math.floor(remaining/perUnitRetail):0;
                  if(N<=0){newItems.push(it)}
                  else{
                    const coveredFraction=N/q;
                    const newGarmentSell=rQ(safeNum(it.unit_sell)*(1-coveredFraction));
                    const promoSpent=rQ(N*perUnitRetail);
                    const scaledDecos=safeDecos(it).map(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:q;const dp=dP(d,q,af,cq);const blendedSell=rQ(dp.sell*(1-coveredFraction));return{...d,_pre_promo_sell_override:d.sell_override,sell_override:blendedSell}});
                    partialItem=true;
                    newItems.push({...it,is_promo:false,_pre_promo_sell:it.unit_sell,unit_sell:newGarmentSell,decorations:scaledDecos,_promo_credit:promoSpent,_promo_partial_qty:N});
                    // Subtract only what was actually spent; the rounded-off leftover stays in the customer's budget.
                    remaining=Math.max(0,remaining-promoSpent);
                  }
                }
              });
              sv('promo_applied',true);sv('items',newItems);
              // On SOs (committed orders), deduct from balance + record usage immediately so the Promo $ tab and balance reflect the spend.
              // Estimates skip this — their promo is provisional until conversion to SO (handled in App.convertSO).
              if(isSO){
                const promoUsed=promoBudget-remaining;
                const targetPeriod=_ps[0];
                if(promoUsed>0&&targetPeriod){
                  const updatedPeriod={...targetPeriod,used:safeNum(targetPeriod.used)+promoUsed};
                  const usageRec={period_id:targetPeriod.id,amount:promoUsed,description:o.memo||('Promo on '+o.id),created_by:cu?.name||'System',so_id:o.id,estimate_id:o.estimate_id||null,created_at:new Date().toISOString()};
                  if(onSavePromoPeriod)await onSavePromoPeriod(updatedPeriod);else if(_dbSavePromoPeriod)await _dbSavePromoPeriod(updatedPeriod);
                  if(onSavePromoUsage)await onSavePromoUsage(usageRec);
                  setCust(c=>c?{...c,promo_periods:(c.promo_periods||[]).map(p=>p.id===targetPeriod.id?updatedPeriod:p),promo_usage:[...(c.promo_usage||[]),usageRec]}:c);
                  sv('promo_amount',promoUsed);
                }
              }
              const totalItems=items.filter(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0).length;
              if(fullCount===totalItems){nf('Promo mode enabled — all items set to retail pricing')}
              else if(partialItem){nf(fullCount+' item(s) fully covered, 1 partially discounted — customer pays the rest')}
              else{nf('Promo applied to '+fullCount+' of '+totalItems+' items — customer pays for rest')}
            }} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='none'}>💰 Apply Promo Funds</button>}
            {o.promo_applied&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#d97706',textAlign:'left'}} onClick={async()=>{setShowActionsDD(false);
              // On SOs, reverse the deduction by deleting any usage tied to this SO and restoring the period balance.
              if(isSO&&cust){
                const usages=(cust.promo_usage||[]).filter(u=>u.so_id===o.id);
                for(const u of usages){
                  const period=(cust.promo_periods||[]).find(p=>p.id===u.period_id);
                  if(period){
                    const restored={...period,used:Math.max(0,safeNum(period.used)-safeNum(u.amount))};
                    if(onSavePromoPeriod)await onSavePromoPeriod(restored);else if(_dbSavePromoPeriod)await _dbSavePromoPeriod(restored);
                  }
                }
                if(usages.length&&onDeletePromoUsage)await onDeletePromoUsage(usages[0].period_id,o.id);
                if(usages.length){setCust(c=>c?{...c,promo_periods:(c.promo_periods||[]).map(p=>{const u=usages.find(x=>x.period_id===p.id);return u?{...p,used:Math.max(0,safeNum(p.used)-safeNum(u.amount))}:p}),promo_usage:(c.promo_usage||[]).filter(u=>u.so_id!==o.id)}:c)}
              }
              sv('promo_applied',false);sv('promo_amount',0);sv('items',safeItems(o).map(it=>({...it,is_promo:false,unit_sell:it._pre_promo_sell!=null?it._pre_promo_sell:it.unit_sell,decorations:safeDecos(it).map(d=>d._pre_promo_sell_override!==undefined?{...d,sell_override:d._pre_promo_sell_override,_pre_promo_sell_override:undefined}:d),_pre_promo_sell:undefined,_promo_credit:undefined,_promo_partial_qty:undefined})));nf('Promo mode disabled')}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='none'}>💰 Remove Promo</button>}
            {/* Credit — show when customer has credits available */}
            {cust&&!o.credit_applied&&(()=>{const _credits=(cust.credits||[]);const _bal=_credits.reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0);return _bal>0})()&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#065f46',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);
              const credits=(cust.credits||[]).filter(cr=>(cr.amount||0)-(cr.used||0)>0);
              const totalBal=credits.reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0);
              if(totalBal<=0){nf('No credits available','error');return}
              // Calculate order total (subtotal + shipping + tax) to determine credit to apply
              const orderTotal=totals.grand;
              const creditToApply=Math.min(totalBal,orderTotal);
              // Calculate how credit reduces tax: credit reduces taxable subtotal proportionally
              // Credit is applied to the invoice total (subtotal + ship + tax), but tax is recalculated on reduced amount
              sv('credit_applied',true);sv('credit_amount',Math.round(creditToApply*100)/100);
              nf('Credit of $'+creditToApply.toFixed(2)+' applied (available: $'+totalBal.toFixed(2)+')');
            }} onMouseEnter={e=>e.currentTarget.style.background='#ecfdf5'} onMouseLeave={e=>e.currentTarget.style.background='none'}>🏷️ Apply Credit</button>}
            {o.credit_applied&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#065f46',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);sv('credit_applied',false);sv('credit_amount',0);nf('Credit removed')}} onMouseEnter={e=>e.currentTarget.style.background='#ecfdf5'} onMouseLeave={e=>e.currentTarget.style.background='none'}>🏷️ Remove Credit</button>}
            {onAssignTodo&&<><div style={{borderTop:'1px solid #e2e8f0',margin:'2px 0'}}/><button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);onAssignTodo({title:'',description:'',so_id:isSO?o.id:'',customer_id:o.customer_id||'',priority:2,doc_label:o.id})}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>📋 Assign TODO</button></>}
            {isSO&&<><div style={{borderTop:'1px solid #e2e8f0',margin:'2px 0'}}/><button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#7c3aed',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);setFirmReqDate(o.expected_date||'');setFirmReqNote('');setShowFirmReq(true)}} onMouseEnter={e=>e.currentTarget.style.background='#f5f3ff'} onMouseLeave={e=>e.currentTarget.style.background='none'}>📌 Request Firm Date</button></>}
            {(isE||onDelete)&&<><div style={{borderTop:'1px solid #e2e8f0',margin:'2px 0'}}/><button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#dc2626',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(onDelete){onDelete(o.id)}else{nf('Delete not available','error')}}} onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="trash" size={12}/> Delete</button></>}
          </div></>})()}
        </div>
      </div>
      {isSO&&<div style={{display:'flex',gap:6,marginTop:8,alignItems:'center'}}>
        <button className="btn btn-secondary" onClick={()=>setShowPO('select')}><Icon name="cart" size={14}/> Create PO</button>
        {(()=>{
          // Decide which invoicing actions to show. If any SO line still has un-invoiced qty,
          // surface "Create Invoice" alongside "Close Sales Order" so the user can bill the remainder.
          const _hasAnyInv=(allInvoices||[]).some(inv=>inv.so_id===o.id);
          const _invMap=_hasAnyInv?buildInvoicedQtyMap(o,(allInvoices||[]).filter(inv=>inv.so_id===o.id)):new Map();
          const _hasRemaining=safeItems(o).some((it,idx)=>{
            const tot=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            const inv=_invMap.get(soLineKey(it,idx))||0;
            return tot-inv>0;
          });
          const _openCreateInv=(typeHint)=>{
            // Pre-select only items that still have remaining qty
            const remIdxs=safeItems(o).map((it,idx)=>{
              const tot=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
              const inv=_invMap.get(soLineKey(it,idx))||0;
              return tot-inv>0?idx:null;
            }).filter(i=>i!==null);
            setInvSelItems(remIdxs.length?remIdxs:safeItems(o).map((_,i)=>i));
            setInvMemo(o.memo||'');setInvType(typeHint||(_hasAnyInv?'partial':'final'));setInvDepositPct(50);setInvDate(new Date().toLocaleDateString('en-CA'));setShowInvCreate(true);
          };
          if(o.promo_applied)return null;// promo flow handled below
          if(o.status==='complete')return<span style={{padding:'6px 10px',fontSize:12,fontWeight:700,color:'#166534',background:'#dcfce7',borderRadius:6,border:'1px solid #86efac'}}>✓ Sales Order Closed</span>;
          if(!_hasAnyInv)return<button className="btn btn-secondary" style={{color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>_openCreateInv('final')}><Icon name="dollar" size={14}/> Create Invoice</button>;
          // Has prior invoices with un-billed remaining qty: only show Create Invoice — nothing left to "close ahead of".
          if(_hasRemaining)return<button className="btn btn-secondary" style={{color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>_openCreateInv('partial')}><Icon name="dollar" size={14}/> Create Invoice</button>;
          // Fully invoiced but SO still open — this is the "invoiced ahead" case; offer Close Sales Order.
          return<button className="btn btn-secondary" style={{color:'#166534',borderColor:'#86efac'}} onClick={()=>{
            if(!window.confirm('Close sales order '+o.id+'? It will be marked complete.'))return;
            const updated={...o,status:'complete',updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);nf(o.id+' closed');
          }}><Icon name="check" size={14}/> Close Sales Order</button>;
        })()}
        {o.promo_applied&&(o.status==='complete'?<span style={{padding:'6px 10px',fontSize:12,fontWeight:700,color:'#166534',background:'#dcfce7',borderRadius:6,border:'1px solid #86efac'}}>✓ Promo Order Closed</span>:<button className="btn btn-secondary" style={{color:'#166534',borderColor:'#86efac'}} onClick={async()=>{
          if(!window.confirm('Mark promo order '+o.id+' as complete? No invoice needed — costs are tracked on the SO.'))return;
          // Backfill: if this SO has promo applied but never recorded a usage row (e.g. converted before deduction was wired up), record it now.
          if(isSO&&cust&&!(cust.promo_usage||[]).some(u=>u.so_id===o.id)){
            const promoAmt=promoTotals?promoTotals.promoAmount:safeNum(o.promo_amount);
            if(promoAmt>0){
              const _now=new Date(),_y=_now.getFullYear(),_m=_now.getMonth();const _pStart=_m<6?_y+'-01-01':_y+'-07-01';
              const period=(cust.promo_periods||[]).find(p=>p.period_start===_pStart)||(cust.promo_periods||[])[0];
              if(period){
                const updatedPeriod={...period,used:safeNum(period.used)+promoAmt};
                const usageRec={period_id:period.id,amount:promoAmt,description:o.memo||('Promo on '+o.id),created_by:cu?.name||'System',so_id:o.id,estimate_id:o.estimate_id||null,created_at:new Date().toISOString()};
                if(onSavePromoPeriod)await onSavePromoPeriod(updatedPeriod);
                if(onSavePromoUsage)await onSavePromoUsage(usageRec);
                setCust(c=>c?{...c,promo_periods:(c.promo_periods||[]).map(p=>p.id===period.id?updatedPeriod:p),promo_usage:[...(c.promo_usage||[]),usageRec]}:c);
              }
            }
          }
          const updated={...o,status:'complete',updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);nf(o.id+' promo order closed');
        }}><Icon name="check" size={14}/> Close Promo Order</button>)}
        {o.order_type==='booking'&&!o.booking_confirmed&&<button style={{fontSize:13,padding:'7px 14px',borderRadius:6,background:'#059669',border:'none',color:'white',cursor:'pointer',fontWeight:700}} onClick={()=>{if(!window.confirm('Confirm this booking order with coach? It will enter the active pipeline.'))return;sv('booking_confirmed',true);sv('booking_confirmed_at',new Date().toISOString());sv('booking_confirmed_by',cu?.id||'');nf('Booking order confirmed — entering pipeline')}}><Icon name="check" size={14}/> Confirm with Coach</button>}
        {o.order_type==='booking'&&o.booking_confirmed&&<span style={{fontSize:12,color:'#059669',fontWeight:600,padding:'6px 8px',background:'#ecfdf5',borderRadius:6,border:'1px solid #86efac'}}>✓ Confirmed with Coach</span>}
      </div>}
      {/* SHIPPING */}
      <div style={{display:'flex',gap:12,marginTop:12,alignItems:'end',flexWrap:'wrap',borderTop:'1px solid #f1f5f9',paddingTop:12}}>
        <div><label className="form-label">Shipping</label><div style={{display:'flex',gap:4,alignItems:'center'}}>
          <Bg options={[{value:'pct',label:'% of Total'},{value:'flat',label:'Flat $'}]} value={o.shipping_type||'pct'} onChange={v=>sv('shipping_type',v)}/>
          {o.shipping_type==='pct'?<span style={{display:'inline-flex',alignItems:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'2px 6px',background:'white'}}><input value={o.shipping_value||0} onChange={e=>sv('shipping_value',parseFloat(e.target.value)||0)} style={{width:40,border:'none',outline:'none',fontSize:15,fontWeight:800,textAlign:'center',background:'transparent'}}/><span style={{fontWeight:700}}>%</span></span>
          :<$In value={o.shipping_value||0} onChange={v=>sv('shipping_value',v)} w={60}/>}
          <span style={{fontSize:12,color:'#64748b'}}>= ${totals.ship.toFixed(2)}</span>
        </div></div>
        <div style={{flex:1,minWidth:180}}><label className="form-label">Ship To</label>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            <select className="form-select" style={{flex:1}} value={o.ship_to_id||'default'} onChange={e=>{if(e.target.value==='new')setShowCustEdit(true);else sv('ship_to_id',e.target.value)}}>
              {addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}<option value="new">+ New Address</option></select>
            {(()=>{const sel=addrs.find(a=>a.id===o.ship_to_id)||addrs[0];return sel&&sel.addr?<button type="button" className="btn btn-sm btn-secondary" title="Copy address" style={{flexShrink:0,padding:'6px 10px',fontSize:13}} onClick={()=>{navigator.clipboard.writeText(sel.addr).then(()=>nf('📋 Address copied'),()=>nf('Could not copy address','error'))}}>📋</button>:null})()}
          </div>
        </div>
        <div style={{fontSize:12,color:'#64748b'}}>Tax: <strong>${totals.tax.toFixed(2)}</strong></div>
        {/* Promo Active Badge (toggle moved to Actions dropdown) */}
        {o.promo_applied&&<span style={{padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700,background:'#fef3c7',color:'#92400e'}}>💰 PROMO ACTIVE</span>}
        {o.credit_applied&&<span style={{padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700,background:'#d1fae5',color:'#065f46'}}>🏷️ CREDIT ${safeNum(o.credit_amount).toFixed(2)}</span>}
      </div>
      {/* Promo Summary */}
      {o.promo_applied&&promoTotals&&<div style={{margin:'8px 0',padding:'10px 16px',background:'#fffbeb',borderRadius:8,border:'1px solid #fde68a',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'#92400e'}}>💰 PROMO ORDER</span>
        <span style={{fontSize:12}}>Promo Items: <strong style={{color:'#92400e'}}>${promoTotals.promoRev.toLocaleString(undefined,{maximumFractionDigits:2})}</strong> (retail + 25% deco)</span>
        <span style={{fontSize:12}}>Promo Ship: <strong>${promoTotals.promoShip.toFixed(2)}</strong></span>
        {promoTotals.promoCredit>0&&<span style={{fontSize:12}}>Promo Discount: <strong style={{color:'#92400e'}}>${promoTotals.promoCredit.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></span>}
        <span style={{fontSize:12,fontWeight:700,color:'#92400e'}}>Promo Total: ${promoTotals.promoAmount.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
        {promoTotals.normalRev>0&&<span style={{fontSize:12}}>Customer Pays: <strong style={{color:'#166534'}}>${promoTotals.customerPays.toFixed(2)}</strong></span>}
        {promoTotals.normalRev===0&&promoTotals.promoCredit===0&&<span style={{fontSize:12,fontWeight:700,color:'#166534'}}>$0.00 Order</span>}
        {(()=>{if(!cust)return null;const _now=new Date(),_y=_now.getFullYear(),_m=_now.getMonth();const _ps=(cust.promo_periods||[]).filter(p=>p.period_start===(_m<6?_y+'-01-01':_y+'-07-01'));const _bal=_ps.reduce((a,p)=>a+(p.allocated||0)-(p.used||0),0);const _ownDeducted=(cust.promo_usage||[]).filter(u=>u.so_id===o.id).reduce((a,u)=>a+safeNum(u.amount),0);const _availableForThis=_bal+_ownDeducted;if(promoTotals.promoAmount>_availableForThis)return<span style={{fontSize:12,fontWeight:700,color:'#dc2626',background:'#fef2f2',padding:'2px 8px',borderRadius:6}}>⚠️ Exceeds available funds — ${_availableForThis.toLocaleString(undefined,{maximumFractionDigits:2})} available</span>;return<span style={{fontSize:11,color:'#64748b'}}>Remaining: ${_bal.toLocaleString(undefined,{maximumFractionDigits:2})}</span>})()}
      </div>}
      {/* Credit Summary */}
      {o.credit_applied&&safeNum(o.credit_amount)>0&&<div style={{margin:'8px 0',padding:'10px 16px',background:'#ecfdf5',borderRadius:8,border:'1px solid #a7f3d0',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'#065f46'}}>🏷️ CREDIT APPLIED</span>
        <span style={{fontSize:12}}>Credit: <strong style={{color:'#065f46'}}>${safeNum(o.credit_amount).toFixed(2)}</strong></span>
        <span style={{fontSize:12}}>Order Total: <strong>${totals.grand.toFixed(2)}</strong></span>
        <span style={{fontSize:12,fontWeight:700,color:'#065f46'}}>After Credit: ${Math.max(0,totals.grand-safeNum(o.credit_amount)).toFixed(2)}</span>
        {(()=>{if(!cust)return null;const _bal=(cust.credits||[]).reduce((a,cr)=>a+(cr.amount||0)-(cr.used||0),0);return<span style={{fontSize:11,color:'#64748b'}}>Account Balance: ${_bal.toLocaleString(undefined,{maximumFractionDigits:2})}</span>})()}
      </div>}
      {/* SO STATUS — fully auto-calculated from items/jobs */}
      {isSO&&(()=>{
        const autoSt=calcSOStatus(o);
        // Auto-sync status
        if(o.status!==autoSt&&o.status!=='complete'){setTimeout(()=>sv('status',autoSt),0)}
        const stLabels={need_order:'Need to Order',waiting_receive:'Waiting to Receive',needs_pull:'Needs Pull',items_received:'Items Received',in_production:'In Production',ready_to_invoice:'Ready to Invoice',complete:'Complete'};
        const displaySt=o.status==='complete'?'complete':autoSt;
        return<div style={{display:'flex',gap:8,marginTop:12,borderTop:'1px solid #f1f5f9',paddingTop:12,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#64748b',fontWeight:600}}>Order Status:</span>
          {statusFlow.map((sf)=>{const sc=SC[sf]||{};const cur=sf===displaySt;
            return<span key={sf} style={{padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:cur?800:500,
              background:cur?sc.bg:'#f8fafc',color:cur?sc.c:'#94a3b8',border:cur?`2px solid ${sc.c}`:'1px solid #e2e8f0',
              cursor:sf==='complete'?'pointer':'default',opacity:cur?1:0.5}}
              onClick={()=>{if(sf==='complete')sv('status','complete')}}
              title={sf==='complete'?'Click to manually mark complete':'Auto-calculated'}>
              {stLabels[sf]||sf}</span>})}
          {o.status==='complete'&&autoSt!=='complete'&&<button className="btn btn-sm btn-secondary" style={{fontSize:9,marginLeft:4}} onClick={()=>sv('status',autoSt)}>↩️ Reset to Auto</button>}
        </div>})()}
      {isSO&&<div style={{display:'flex',gap:12,marginTop:10,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div>
          <label className="form-label" style={{fontSize:11}}>Ship Preference</label>
          <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
            {[{v:'ship_as_ready',l:'Ship as Ready',icon:'📦',desc:'Each IF/job ships as completed'},{v:'wait_complete',l:'Wait to Ship Complete',icon:'⏳',desc:'Wait for entire order to complete'},{v:'rep_delivery',l:'Rep Delivery',icon:'🚗',desc:'Rep delivers when jobs complete'},{v:'warehouse_delivery',l:'Deliver',icon:'🚚',desc:'Warehouse delivers when jobs complete'},{v:'deliver_on_date',l:'Deliver on Date',icon:'🗓️',desc:'Warehouse delivers on a specific date — appears on Delivery tab when due'},{v:'ship_on_date',l:'Ship on Date',icon:'📅',desc:'Hold until specific date'}].map(sp=>{
              const cur=(o.ship_preference||'ship_as_ready')===sp.v;
              return<button key={sp.v} className={`btn btn-sm ${cur?'btn-primary':'btn-secondary'}`}
                style={{fontSize:10,padding:'3px 8px',whiteSpace:'nowrap'}} title={sp.desc}
                onClick={()=>sv('ship_preference',sp.v)}>{sp.icon} {sp.l}</button>})}
          </div>
        </div>
        {o.ship_preference==='ship_on_date'&&<div>
          <label className="form-label" style={{fontSize:11}}>Ship Date</label>
          <input type="date" className="form-input" style={{fontSize:11,padding:'4px 8px'}} value={o.ship_on_date||''} onChange={e=>sv('ship_on_date',e.target.value)}/>
        </div>}
        {o.ship_preference==='deliver_on_date'&&<div>
          <label className="form-label" style={{fontSize:11}}>Deliver Date</label>
          <input type="date" className="form-input" style={{fontSize:11,padding:'4px 8px'}} value={o.deliver_on_date||''} onChange={e=>sv('deliver_on_date',e.target.value)}/>
        </div>}
      </div>}
      {isSO&&<div style={{marginTop:8}}><label className="form-label">Production Notes</label><input className="form-input" value={o.production_notes||''} onChange={e=>sv('production_notes',e.target.value)} placeholder="Internal notes..."/></div>}
    </div></div>
    {/* TABS */}
    <div className="tabs" style={{marginBottom:16}}>
      <button className={`tab ${tab==='items'?'active':''}`} onClick={()=>setTab('items')}>Line Items</button>
      <button className={`tab ${tab==='art'?'active':''}`} onClick={()=>setTab('art')}>Art Library ({af.length})</button>
      <button className={`tab ${tab==='messages'?'active':''}`} onClick={()=>setTab('messages')}>Messages {(()=>{const entityMsgs=(msgs||[]).filter(m=>(m.entity_id===o.id)||(m.so_id===o.id));const unread=entityMsgs.filter(m=>!(m.read_by||[]).includes(cu.id)).length;return unread>0?<span style={{background:'#dc2626',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:4}}>{unread}</span>:` (${entityMsgs.length})`})()}</button>
      {isSO&&<button className={`tab ${tab==='transactions'?'active':''}`} onClick={()=>setTab('transactions')}>Linked</button>}
      {isSO&&<button className={`tab ${tab==='jobs'?'active':''}`} onClick={()=>setTab('jobs')}>Jobs {(()=>{const jc=(o.jobs||[]).length;return jc>0?` (${jc})`:''})()}</button>}
      {isSO&&<button className={`tab ${tab==='tracking'?'active':''}`} onClick={()=>setTab('tracking')}>Tracking {(()=>{const sc=(o._shipments||[]).length||(o._tracking_number?1:0);return sc>0?<span style={{background:'#166534',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:4}}>{sc}</span>:''})()}</button>}
      {isSO&&<button className={`tab ${tab==='costs'?'active':''}`} onClick={()=>setTab('costs')} style={tab==='costs'?{background:'#166534',color:'white'}:{}}>💰 Costs</button>}
      <button className={`tab ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>History</button>
    </div>

    {/* LINE ITEMS */}
    {tab==='items'&&(()=>{
      const _invsForSO=isSO?(allInvoices||[]).filter(inv=>inv.so_id===o.id):[];
      const _itemInvoicedMap=isSO?buildInvoicedQtyMap(o,_invsForSO):new Map();
      return<>{safeItems(o).map((item,idx)=>{const szQty=Object.values(safeSizes(item)).reduce((a,v)=>a+safeNum(v),0);const qty=szQty>0?szQty:safeNum(item.est_qty);
      const _itemInvoicedQty=_itemInvoicedMap.get(soLineKey(item,idx))||0;
      const _itemFullyInvoiced=_itemInvoicedQty>0&&_itemInvoicedQty>=qty;
      let dR=0,dC=0;const decoBreak=[];safeDecos(item).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp=dP(d,qty,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);const pds=item.is_promo&&o.promo_applied?rQ(dp.sell*1.25):dp.sell;const dr=eq*pds;const dc=eq*dp.cost;dR+=dr;dC+=dc;
        const artF=d.kind==='art'?af.find(f=>f.id===d.art_file_id):null;const label=d.kind==='art'?(artF?artF.deco_type?.replace('_',' '):d.position)+(d.reversible?' (Rev)':''):'Numbers @ '+d.position+(d.front_and_back?' (F+B)':'')+(d.reversible?' (Rev)':'');
        decoBreak.push({label,sell:pds,cost:dp.cost,rev:dr,costTot:dc,margin:dr-dc,pct:dr>0?((dr-dc)/dr*100):0})});
      const pRev=(()=>{if(item._sizeSells&&szQty>0){let r=0;Object.entries(safeSizes(item)).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)r+=n*(item._sizeSells[sz]||item.unit_sell)});return r}return qty*item.unit_sell})();
      const pCost=(()=>{if(item._sizeCosts&&szQty>0){let c=0;Object.entries(safeSizes(item)).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)c+=n*(item._sizeCosts[sz]||item.nsa_cost)});return c}return qty*item.nsa_cost})();
      const pMg=pRev-pCost;
      const iR=pRev+dR;const iC=pCost+dC;const mg=iR-iC;
      const defaultSzList=item.is_footwear?FOOTWEAR_DEFAULT_SIZES:['S','M','L','XL','2XL'];
      const sizePool=item.is_footwear?FOOTWEAR_SIZES:APPAREL_SIZES;
      const szs=((item.available_sizes&&item.available_sizes.length)?item.available_sizes:defaultSzList).filter(s=>SZ_ORD.includes(s)).sort((a,b)=>SZ_ORD.indexOf(a)-SZ_ORD.indexOf(b));
      const addable=sizePool.filter(s=>!(item.available_sizes||[]).includes(s));
      const removable=sizePool.filter(s=>(item.available_sizes||[]).includes(s));
      return(<div key={idx} id={'so-item-'+idx} className="card" style={{marginBottom:12,transition:'box-shadow 0.3s'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <div style={{display:'flex',flexDirection:'column',gap:0,marginRight:-4}}>
              <button title="Move up" disabled={idx===0} onClick={()=>mvI(idx,-1)} style={{background:'none',border:'none',cursor:idx===0?'not-allowed':'pointer',color:idx===0?'#cbd5e1':'#94a3b8',padding:0,lineHeight:0}}><Icon name="sortUp" size={14}/></button>
              <button title="Move down" disabled={idx===safeItems(o).length-1} onClick={()=>mvI(idx,1)} style={{background:'none',border:'none',cursor:idx===safeItems(o).length-1?'not-allowed':'pointer',color:idx===safeItems(o).length-1?'#cbd5e1':'#94a3b8',padding:0,lineHeight:0}}><Icon name="sortDown" size={14}/></button>
            </div>
            <div style={{flex:1}}>
              {isSO&&_itemInvoicedQty>0&&<div style={{marginBottom:4}}>
                <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:_itemFullyInvoiced?'#dcfce7':'#fef3c7',color:_itemFullyInvoiced?'#166534':'#92400e',fontWeight:700,letterSpacing:0.3}}>
                  {_itemFullyInvoiced?'✓ Fully Invoiced':'Invoiced '+_itemInvoicedQty+' of '+qty}
                </span>
              </div>}
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {item.is_custom?<input className="form-input" value={item.sku} onChange={e=>uI(idx,'sku',e.target.value)} style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15,width:100,border:'1px solid #93c5fd'}}/>
                  :<span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>}
                {item.is_custom||editingItemName===idx?<input className="form-input" autoFocus={editingItemName===idx} value={item.name} onChange={e=>uI(idx,'name',e.target.value)} onBlur={()=>{if(editingItemName===idx)setEditingItemName(null)}} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')e.target.blur()}} style={{fontWeight:700,fontSize:15,flex:1,minWidth:150}} placeholder="Item name..."/>
                  :<span style={{fontWeight:700,fontSize:15}}>{item.name}</span>}
                {item._colors&&!isAU(item.brand)?(()=>{const opts=[...new Set([item.color,...item._colors].filter(Boolean))];return<select className="form-select" style={{fontSize:12,width:150}} value={item.color||opts[0]} onChange={e=>uI(idx,'color',e.target.value)}>{opts.map(c=><option key={c}>{c}</option>)}</select>})()
                  :item.is_custom?<input className="form-input" value={item.color||''} onChange={e=>uI(idx,'color',e.target.value)} style={{fontSize:12,width:100}} placeholder="Color"/>
                  :(()=>{const liveSrc=item._ss_live?'ss':item._sm_live?'sm':item._mt_live?'mt':item._rs_live?'rs':(isSSItem(item)?'ss':isSanMarItem(item)?'sm':isMomentecItem(item)?'mt':isRichardsonItem(item)?'rs':null);
                    return liveSrc?<button onClick={()=>setColorPickerModal({itemIdx:idx,sku:item.sku,source:liveSrc})} className="badge badge-gray" style={{cursor:'pointer',border:'1px dashed #94a3b8',display:'inline-flex',alignItems:'center',gap:4}} title="Click to change color">{item.color||'(set color)'} ▾</button>
                      :<span className="badge badge-gray">{item.color}</span>;
                  })()}
                {item.is_custom&&!item.vendor_source&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Custom</span>}
                {item.vendor_source&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#dbeafe',color:'#1e40af',fontWeight:700}}>{item.vendor_source==='sanmar'?'🟦 via SanMar':item.vendor_source==='ss'?'🟪 via S&S':item.vendor_source==='momentec'?'🟧 via Momentec':'via vendor'}</span>}
                {(o.deco_pos||[]).filter(dp=>(dp.item_idxs||[]).includes(idx)).map(dp=><span key={dp.id||dp.po_id} style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#ede9fe',color:'#7c3aed',fontWeight:700,cursor:'pointer'}} title={dp.vendor+' — '+dp.deco_type?.replace(/_/g,' ')} onClick={()=>setPoFullPage({decoPo:dp,soId:o.id,soItems:safeItems(o)})}>{dp.po_id} · {dp.vendor}</span>)}
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}
                {(item.is_footwear||(item.available_sizes||[]).join(',')==='OSFA')&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:10,fontWeight:700,background:item.is_footwear?'#dcfce7':'#fef3c7',color:item.is_footwear?'#166534':'#92400e'}}>{item.is_footwear?'👟 Footwear':'🧢 OSFA'}</span>}
                {o.promo_applied&&<label style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,cursor:'pointer',background:item.is_promo?'#fef3c7':'#f1f5f9',color:item.is_promo?'#92400e':'#94a3b8',border:item.is_promo?'1px solid #fde68a':'1px solid #e2e8f0'}}><input type="checkbox" checked={item.is_promo||false} onChange={e=>{const checked=e.target.checked;if(checked){uI(idx,'_pre_promo_sell',item.unit_sell);uI(idx,'unit_sell',safeNum(item.retail_price)||safeNum(item.nsa_cost)*2);uI(idx,'is_promo',true)}else{uI(idx,'unit_sell',item._pre_promo_sell!=null?item._pre_promo_sell:item.unit_sell);uI(idx,'_pre_promo_sell',undefined);uI(idx,'is_promo',false)}}} style={{width:12,height:12}}/> Promo{item.is_promo&&item.retail_price?' ($'+item.retail_price+')':''}</label>}
                {o.promo_applied&&!item.is_promo&&safeNum(item._promo_partial_qty)>0&&<span title={'Promo covers '+item._promo_partial_qty+' of '+qty+' units at retail. Sell prices on this line are blended across all '+qty+' units.'} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e',border:'1px solid #fde68a',cursor:'help'}}>🎁 {item._promo_partial_qty}/{qty} at retail (blended)</span>}</div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
                <span style={{fontSize:13,fontWeight:600}}>Sell: <$In value={item._sizeSells&&szQty>0?rQ(pRev/szQty):item.unit_sell} onChange={v=>{if(item._sizeSells&&item._sizeCosts){const ratio=item.nsa_cost>0?v/rQ(item.nsa_cost*(o.default_markup||1.65)):1;const ns={};Object.entries(item._sizeCosts).forEach(([sz,c])=>{ns[sz]=rQ(c*(o.default_markup||1.65)*ratio)});uI(idx,'_sizeSells',ns)}uI(idx,'unit_sell',v)}}/>/ea</span>
                {item._sizeSells&&szQty>0&&Object.keys(item._sizeSells).length>1&&<span style={{fontSize:9,color:'#94a3b8'}}>(avg)</span>}
                {item.is_custom&&<span style={{fontSize:12,color:'#64748b'}}>Cost: <$In value={item.nsa_cost} onChange={v=>{uI(idx,'nsa_cost',v);if(!isAU(item.brand)&&v>0){uI(idx,'unit_sell',rQ(v*(o.default_markup||1.65)))}}}/></span>}
                {item.is_custom&&isAU(item.brand)&&<span style={{fontSize:12,color:'#64748b'}}>Retail: <$In value={item.retail_price||0} onChange={v=>{uI(idx,'retail_price',v);if(isAU(item.brand)&&v>0){const costMult=item.is_footwear?(item.brand==='Adidas'?0.55*0.75:0.55*0.85):(item.brand==='Adidas'?0.375:0.425);uI(idx,'nsa_cost',Math.floor(v*costMult*100)/100);uI(idx,'unit_sell',rQ(v*(1-auDisc(item.is_footwear,item.pricing_group))))}}}/></span>}
                {!isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:'#64748b'}}>({((item._sizeSells&&szQty>0?pRev/szQty:item.unit_sell)/(item._sizeCosts&&szQty>0?pCost/szQty:item.nsa_cost)).toFixed(2)}x)</span>}
                {isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:item.unit_sell>item.nsa_cost?'#166534':'#dc2626'}}>({Math.round((item.unit_sell-item.nsa_cost)/item.unit_sell*100)}% margin)</span>}
              </div></div>
            <div style={{position:'relative'}}>
              <button title="Item actions" onClick={e=>{if(showItemMenu===idx){setShowItemMenu(null);setItemMenuPos(null)}else{const r=e.currentTarget.getBoundingClientRect();setItemMenuPos({top:r.bottom+4,right:window.innerWidth-r.right});setShowItemMenu(idx)}}} style={{background:'none',border:'1px solid #e2e8f0',borderRadius:6,cursor:'pointer',color:'#475569',padding:'4px 8px',fontSize:14,fontWeight:700,lineHeight:1}}>⋯</button>
              {showItemMenu===idx&&itemMenuPos&&createPortal(<>
                <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:1039}} onClick={()=>{setShowItemMenu(null);setItemMenuPos(null)}}/>
                <div style={{position:'fixed',top:itemMenuPos.top,right:itemMenuPos.right,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:1040,minWidth:200,padding:4}}>
                  {(()=>{const curAvail=item.available_sizes||[];const apparelDef=['S','M','L','XL','2XL'];const curMode=item.is_footwear?'footwear':(curAvail.join(',')==='OSFA'?'osfa':'apparel');
                    const switchMode=(mode)=>{
                      const hasQty=Object.values(item.sizes||{}).some(v=>safeNum(v)>0);
                      if(hasQty&&!window.confirm('This item has quantities filled in. Switching the size mode will clear them. Continue?'))return;
                      if(hasQty)uI(idx,'sizes',{});
                      if(mode==='footwear'){uI(idx,'available_sizes',[...FOOTWEAR_DEFAULT_SIZES]);uI(idx,'is_footwear',true);
                        if(isAU(item.brand)&&safeNum(item.retail_price)>0){const mult=item.brand==='Adidas'?0.55*0.75:0.55*0.85;uI(idx,'nsa_cost',Math.floor(item.retail_price*mult*100)/100)}
                      }else if(mode==='osfa'){uI(idx,'available_sizes',['OSFA']);uI(idx,'is_footwear',false);
                        if(isAU(item.brand)&&safeNum(item.retail_price)>0){const mult=item.brand==='Adidas'?0.375:0.425;uI(idx,'nsa_cost',Math.floor(item.retail_price*mult*100)/100)}
                      }else{uI(idx,'available_sizes',[...apparelDef]);uI(idx,'is_footwear',false);
                        if(isAU(item.brand)&&safeNum(item.retail_price)>0){const mult=item.brand==='Adidas'?0.375:0.425;uI(idx,'nsa_cost',Math.floor(item.retail_price*mult*100)/100)}
                      }
                      setShowItemMenu(null);
                    };
                    return<>
                      <div style={{padding:'4px 10px 2px',fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:0.5}}>Size mode</div>
                      <div style={{display:'flex',gap:3,padding:'2px 6px 6px'}}>
                        {[{k:'apparel',l:'👕 Apparel'},{k:'footwear',l:'👟 Footwear'},{k:'osfa',l:'🧢 OSFA'}].map(m=><button key={m.k} onClick={()=>switchMode(m.k)} style={{flex:1,padding:'4px 4px',fontSize:10,fontWeight:700,borderRadius:4,cursor:'pointer',border:'1px solid '+(curMode===m.k?'#0f172a':'#e2e8f0'),background:curMode===m.k?'#0f172a':'white',color:curMode===m.k?'white':'#475569'}}>{m.l}</button>)}
                      </div>
                      <div style={{height:1,background:'#e2e8f0',margin:'2px 0 4px'}}/>
                    </>})()}
                  <button onClick={()=>{setEditingItemName(idx);setShowItemMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#0f766e',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#f0fdfa'} onMouseLeave={e=>e.currentTarget.style.background='none'}><span style={{display:'inline-block',width:14,textAlign:'center',fontSize:12}}>✏️</span> Edit name</button>
                  <button onClick={()=>{copyI(idx);setShowItemMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#2563eb',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="file" size={14}/> Copy item</button>
                  {_itemImg(item)&&<button onClick={()=>{copyItemImage(item);setShowItemMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#0369a1',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'} onMouseLeave={e=>e.currentTarget.style.background='none'}><span style={{display:'inline-block',width:14,textAlign:'center',fontSize:12}}>🖼️</span> Copy image</button>}
                  <button onClick={()=>{const canReplace=safePicks(item).length===0&&safePOs(item).length===0;setCopySkuModal({itemIdx:idx,search:'',mode:canReplace?'replace':'copy'});setShowItemMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#7c3aed',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#f5f3ff'} onMouseLeave={e=>e.currentTarget.style.background='none'}><span style={{display:'inline-block',width:14,textAlign:'center',fontSize:10,fontWeight:800}}>SKU</span> Change SKU</button>
                  {onAssignTodo&&<button onClick={()=>{onAssignTodo({title:'Pull '+(isSO?o.id:'')+' — '+item.sku,description:item.name+(item.color?' · '+item.color:''),so_id:isSO?o.id:'',customer_id:o.customer_id||'',priority:2,doc_label:isSO?o.id:'',wh_only:true});setShowItemMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#0891b2',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#ecfeff'} onMouseLeave={e=>e.currentTarget.style.background='none'}><span style={{display:'inline-block',width:14,textAlign:'center',fontSize:12}}>👤</span> Assign to warehouse</button>}
                  <div style={{height:1,background:'#e2e8f0',margin:'4px 0'}}/>
                  <button onClick={()=>{rmI(idx);setShowItemMenu(null);setItemMenuPos(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:12,fontWeight:600,textAlign:'left',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="trash" size={14}/> Delete item</button>
                </div>
              </>,document.body)}
            </div>
          </div></div>
        {/* SIZES ROW with financials inline */}
        {/* SIZES ROW — qty-only mode for estimates, or full size grid */}
        {/* Treat as qty-only ONLY when there's genuinely no size breakdown. A stale qty_only flag
            on an item that still has sizes (e.g. a PO was built from a size grid) would otherwise
            hide the grid and show "0 / Add Sizes", making the sizes look lost. */}
        {(()=>{const isQtyOnly=!!item.qty_only&&szQty===0;
        return<div style={{padding:'10px 18px',display:'flex',alignItems:'center',borderBottom:'1px solid #f1f5f9',...(isSO&&!isQtyOnly&&szQty===0&&safeNum(item.est_qty)>0?{border:'2px solid #dc2626',borderRadius:8,background:'#fef2f2'}:{})}}>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            <div style={{width:46,display:'flex',flexDirection:'column',gap:1}}>
              <span style={{fontSize:12,fontWeight:600,color:isSO&&!isQtyOnly&&szQty===0&&safeNum(item.est_qty)>0?'#dc2626':isAdidasItem(item)?'#059669':'#64748b'}}>{isSO&&!isQtyOnly&&szQty===0&&safeNum(item.est_qty)>0?'⚠️ Sizes:':isQtyOnly?'Qty:':isAdidasItem(item)?'ADIDAS':'Sizes:'}</span>
              {isAdidasItem(item)&&!isQtyOnly&&<span style={{fontSize:9,fontWeight:700,color:'#059669'}}>b2b ↓</span>}
            </div>
            {/* In estimate qty-only mode: show just the total input, no size grid */}
            {isQtyOnly?<>
              <div style={{textAlign:'center',padding:'0 10px'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOTAL QTY</div>
                <input value={item.est_qty||''} onChange={e=>uI(idx,'est_qty',e.target.value===''?0:parseInt(e.target.value)||0)} placeholder="0"
                  style={{width:64,textAlign:'center',fontSize:24,fontWeight:800,color:safeNum(item.est_qty)>0?'#1e40af':'#cbd5e1',border:'2px dashed #93c5fd',borderRadius:6,padding:'4px 0',background:'#eff6ff'}}/>
              </div>
              <button className="btn btn-sm btn-secondary" style={{fontSize:10,marginLeft:8,color:'#2563eb'}} onClick={()=>{
                // Expand qty-only into a size grid. If the product is currently OSFA-only
                // (or has no size list), seed it with the standard apparel/footwear sizes
                // so users get a real size breakdown to fill in — not an OSFA bucket that
                // silently swallows the entire qty.
                const curAvail=item.available_sizes||[];
                const isOsfaOnly=curAvail.length===0||(curAvail.length===1&&curAvail[0]==='OSFA');
                const defaults=item.is_footwear?[...FOOTWEAR_DEFAULT_SIZES]:['S','M','L','XL','2XL'];
                if(isOsfaOnly)uI(idx,'available_sizes',defaults);
                uI(idx,'qty_only',false);
                // Leave size quantities blank so the user fills them in; est_qty stays
                // as the target total and renders as a "⚠️ Sizes:" warning until filled.
              }}>+ Add Sizes</button>
            </>:<>
            {szs.map(sz=><div key={sz} style={{textAlign:'center',width:48}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
              <input value={sizingDraft[idx+'_'+sz]??(item.sizes[sz]||'')} onChange={e=>{const k=idx+'_'+sz;const v=e.target.value;setSizingDraft(d=>({...d,[k]:v}))}} onBlur={()=>{const k=idx+'_'+sz;if(!(k in sizingDraft))return;const v=sizingDraft[k];React.startTransition(()=>{uSz(idx,sz,v);setSizingDraft(d=>{const n={...d};delete n[k];return n})})}} placeholder="0"
                style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:((idx+'_'+sz) in sizingDraft?(parseInt(sizingDraft[idx+'_'+sz])||0):(item.sizes[sz]||0))>0?'#0f172a':'#cbd5e1'}}/>
              {(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const stk=p?._inv?.[sz];const need=item.sizes[sz]||0;return<div style={{fontSize:9,fontWeight:600,minHeight:13,color:stk==null?'transparent':stk<=0?'#dc2626':stk<need?'#ca8a04':'#166534'}}>{stk!=null?stk+' inv':'\u00A0'}</div>})()}
              {(()=>{const vi=vendorInv[item.sku];if(!vi||vi.loading)return vi?.loading?<div style={{fontSize:9,color:'#a78bfa',minHeight:12}}>...</div>:null;const vStk=vi.sizes?.[sz];if(vStk==null)return null;const lbl=vi.source==='rs'?'rs':vi.source==='mt'?'':vi.source==='sm'?'sm':'ss';const clr=vi.source==='rs'?'#dc2626':vi.source==='mt'?'#16a34a':vi.source==='sm'?'#0891b2':'#7c3aed';const sizeNext=vi.source==='rs'?(vi.sizeNextAvail?.[sz]||''):'';const shortDate=sizeNext?(()=>{const [m,d]=sizeNext.split('/');return parseInt(m,10)+'/'+parseInt(d,10)})():'';const displayQty=vi.source==='mt'?(vStk>0?'✓ In Stock':'✗ Out'):(vi.source==='rs'&&vStk<=0&&shortDate)?shortDate:vStk.toLocaleString();const srcName=vi.source==='rs'?'Richardson':vi.source==='mt'?'Momentec':vi.source==='sm'?'SanMar':'S&S Activewear';const tip=vi.source==='mt'?('Momentec: '+(vStk>0?'In stock':'Out of stock')+' — Momentec does not publish exact quantities'):(srcName+' stock: '+vStk.toLocaleString()+((vi.source==='rs'&&(sizeNext||vi.nextAvail))?' • next avail '+(sizeNext||vi.nextAvail):''));return<div style={{fontSize:9,fontWeight:700,minHeight:12,color:vStk<=0?(vi.source==='rs'&&shortDate?'#b45309':'#dc2626'):clr}} title={tip}>{displayQty} {lbl}</div>})()}
              {(()=>{if(!isAdidasItem(item))return null;const ai=adidasInv[item.sku];if(!ai||ai.loading)return ai?.loading?<div style={{fontSize:9,color:'#059669',minHeight:12}}>...</div>:null;const b2bStk=ai.sizes?.[sz]?.qty;if(b2bStk==null)return<div style={{fontSize:9,color:'transparent',minHeight:12}}>&nbsp;</div>;const need=item.sizes[sz]||0;const color=b2bStk<=0?'#dc2626':(need>0&&b2bStk<need)?'#ca8a04':'#166534';return<div style={{fontSize:9,fontWeight:700,minHeight:12,color:color}} title={'Adidas B2B stock: '+b2bStk+(ai.sizes[sz]?.futureDate?' (restock '+ai.sizes[sz].futureDate+')':'')}>{b2bStk.toLocaleString()}</div>})()}
              {(()=>{
                // Per-size cost upcharge ($X.XX under larger sizes). Prefer the item's
                // stored _sizeCosts; fall back to the live vendor pricing map so the
                // upcharge label persists after reload (the vendor fetch repopulates
                // vi.price even when _sizeCosts wasn't saved on the item).
                const vi=vendorInv[item.sku];const costMap=item._sizeCosts||vi?.price;
                if(!costMap)return null;
                const sc=costMap[sz];
                if(!sc||Math.abs(sc-item.nsa_cost)<0.01)return<div style={{fontSize:8,minHeight:11}}>{'\u00A0'}</div>;
                return<div style={{fontSize:8,fontWeight:700,minHeight:11,color:'#b45309'}}>{'$'+sc.toFixed(2)}</div>;
              })()}
              </div>)}
            <div style={{textAlign:'center',marginLeft:4,padding:'0 10px',borderLeft:'2px solid #e2e8f0'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>QTY</div>
              <div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div>
            </div>
            </>}
            {(()=>{const vi=vendorInv[item.sku];const isSM=isSanMarItem(item);const isSS=isSSItem(item);const isMT=isMomentecItem(item);const isRS=isRichardsonItem(item);
              if(isSS||isSM||isMT||isRS){const lbl=isRS?'RS':isMT?'MT':isSM?'SM':'S&S';const clr=isRS?'#dc2626':isMT?'#d97706':isSM?'#0891b2':'#7c3aed';const bdr=isRS?'#fca5a5':isMT?'#fbbf24':isSM?'#67e8f9':'#c4b5fd';const name=isRS?'Richardson':isMT?'Momentec':isSM?'SanMar':'S&S';return<button title={vi?.error?'Error: '+vi.error+' — click to retry':'Refresh '+name+' inventory'} onClick={()=>{delete vendorInvCache.current[item.sku];delete vendorInvFetching.current[item.sku];setVendorInv(prev=>{const n={...prev};delete n[item.sku];return n});fetchVendorInventory(item.sku,item.vendor_id,item)}} style={{background:'none',border:'1px solid '+bdr,borderRadius:4,cursor:'pointer',color:vi?.error?'#dc2626':clr,padding:'2px 6px',fontSize:9,fontWeight:700,marginLeft:4,whiteSpace:'nowrap'}}>{vi?.loading?'...':vi?.error?'⚠ '+lbl:'↻ '+lbl}</button>}return null})()}
            {(()=>{if(!isAdidasItem(item))return null;const ai=adidasInv[item.sku];return<button title={ai?.error?'Error: '+ai.error+' — click to retry':'Refresh Adidas B2B inventory'} onClick={()=>{delete adidasInvCache.current[item.sku];delete adidasInvFetching.current[item.sku];setAdidasInv(prev=>{const n={...prev};delete n[item.sku];return n});fetchAdidasInv(item.sku)}} style={{background:'none',border:'1px solid #6ee7b7',borderRadius:4,cursor:'pointer',color:ai?.error?'#dc2626':'#059669',padding:'2px 6px',fontSize:9,fontWeight:700,marginLeft:4,whiteSpace:'nowrap'}}>{ai?.loading?'...':ai?.error?'⚠ B2B':'↻ B2B'}</button>})()}
            {!isQtyOnly&&<div style={{position:'relative',marginLeft:4}}><button className="btn btn-sm btn-secondary" onClick={e=>{if(showSzPicker&&showSzPicker.idx===idx){setShowSzPicker(null)}else{const r=e.currentTarget.getBoundingClientRect();setShowSzPicker({idx,top:r.bottom+4,left:r.left})}}} style={{fontSize:10}}>+ Size</button>
              {showSzPicker&&showSzPicker.idx===idx&&<><div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:39}} onClick={()=>setShowSzPicker(null)}/><div style={{position:'fixed',top:showSzPicker.top,left:showSzPicker.left,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:40,padding:6,display:'flex',gap:3,flexWrap:'wrap',width:260,maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
                  <span style={{fontSize:9,fontWeight:700,color:'#64748b'}}>Click multiple, then Done</span>
                  <button className="btn btn-sm btn-primary" style={{fontSize:10,padding:'2px 8px'}} onClick={()=>setShowSzPicker(null)}>Done</button>
                </div>
                {removable.length>0&&<><div style={{width:'100%',fontSize:9,fontWeight:700,color:'#dc2626',marginBottom:2}}>Remove</div>{removable.map(sz=><button key={'rm-'+sz} className="btn btn-sm" style={{fontSize:10,padding:'2px 6px',color:'#dc2626',border:'1px solid #fca5a5',background:'#fef2f2'}} onClick={()=>removeSzFromItem(idx,sz)}>−{sz}</button>)}<div style={{width:'100%',borderTop:'1px solid #e2e8f0',margin:'3px 0'}}/></>}
                {addable.map(sz=><button key={sz} className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>addSzToItem(idx,sz)}>{sz}</button>)}
                <button className="btn btn-sm" style={{fontSize:10,padding:'2px 6px',color:'#dc2626',border:'1px solid #fca5a5',width:'100%',marginTop:3}} onClick={()=>{uI(idx,'qty_only',true);uI(idx,'est_qty',szQty||safeNum(item.est_qty)||0);uI(idx,'sizes',{});setShowSzPicker(null)}}>Custom (No Sizes / Qty Only)</button>
                </div></>}
            </div>}
          </div>
          {/* Adidas B2B sync details moved to bottom of page */}
          {/* Financial summary — right side of sizes row */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}>
            {isSO&&!isQtyOnly&&szQty===0&&safeNum(item.est_qty)>0&&<span style={{fontSize:11,color:'#dc2626',fontWeight:700}}>Enter sizes ({item.est_qty} total)</span>}
            {isQtyOnly&&safeNum(item.est_qty)>0&&<span style={{fontSize:10,color:'#64748b',fontStyle:'italic'}}>Custom — no size breakdown</span>}
            {isSO&&!isQtyOnly&&(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
              const szList=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const anyUnassigned=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);return v-picked-po>0});
              if(!anyUnassigned)return<span style={{fontSize:10,color:'#166534',fontStyle:'italic',fontWeight:600}}>✓ All assigned</span>;
              const hasInv=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const inv=p?._inv?.[sz]||0;return v-picked-po>0&&inv>0});
              return hasInv?<button className="btn btn-primary" style={{fontSize:12,padding:'8px 16px',fontWeight:700,whiteSpace:'nowrap'}} onClick={()=>{
                setShowPick(true);
              }}><Icon name="grid" size={14}/> Create IF</button>
              :<span style={{fontSize:10,color:'#d97706',fontStyle:'italic'}}>Need to order</span>})()}
            <div style={{textAlign:'right',borderLeft:'1px solid #e2e8f0',paddingLeft:12}}>
              <span style={{fontSize:22,fontWeight:900,color:'#166534'}}>${iR.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
              <div style={{fontSize:10,color:'#64748b'}}>{qty} × ${qty>0?(iR/qty).toFixed(2):'-'}/ea</div>
            </div>
          </div>
        </div>})()}
        {/* FULFILLMENT LINES */}
        {isSO&&(item.pick_lines||[]).length>0&&<div style={{padding:'4px 18px',borderBottom:'1px solid #f1f5f9'}}>
          {safePicks(item).map((pk,pi)=>{const st=pk.status||'pick';
            return<div key={pi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='pulled'?'#166534':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>openPickModal(pk.pick_id,idx,pi)} title="Click to edit">{pk.pick_id||'PICK'}:</span>
              {szs.map(sz=>{const v=pk[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,
                  background:st==='pulled'?'#dcfce7':st==='pick'?'#fef3c7':'#f1f5f9',
                  color:st==='pulled'?'#166534':st==='pick'?'#92400e':'#64748b'}}>{v}</div>})}
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,
                background:st==='pulled'?'#dcfce7':'#fef3c7',color:st==='pulled'?'#166534':'#92400e'}}>{st==='pulled'?'✓ Pulled':'Needs Pull'}</span>
              {pk.ship_dest&&pk.ship_dest!=='in_house'&&<span style={{fontSize:8,padding:'2px 5px',borderRadius:4,fontWeight:700,
                background:pk.ship_dest==='ship_customer'?'#dbeafe':'#ede9fe',color:pk.ship_dest==='ship_customer'?'#1e40af':'#6d28d9'}}>
                {pk.ship_dest==='ship_customer'?'📦 → Customer':'🚚 → '+(pk.deco_vendor||'Deco')}</span>}
            </div>})}
        </div>}
        {isSO&&(item.po_lines||[]).length>0&&<div style={{padding:'4px 18px',borderBottom:'1px solid #f1f5f9'}}>
          {safePOs(item).map((po,pi)=>{
            const rcvd=po.received||{};const cncl=po.cancelled||{};const blld=po.billed||{};const isDS=!!po.drop_ship;
            const szKeysAll=Object.keys(po).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','notes','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type'].includes(k)&&typeof po[k]==='number');
            const totalOrd=szKeysAll.reduce((a,sz)=>a+(po[sz]||0),0);
            const totalRcvd=szKeysAll.reduce((a,sz)=>a+(rcvd[sz]||0),0);
            const totalBlld=szKeysAll.reduce((a,sz)=>a+((blld[sz]||0)),0);
            const totalCncl=szKeysAll.reduce((a,sz)=>a+(cncl[sz]||0),0);
            const totalOpen=szKeysAll.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0)),0);
            const st=isDS?(totalBlld>=totalOrd&&totalOrd>0?'shipped':totalBlld>0?'partial':'waiting'):(totalOpen<=0&&totalRcvd>0?'received':totalRcvd>0?'partial':totalBlld>0?'in_transit':'waiting');
            return<div key={pi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='received'||st==='shipped'?'#166534':st==='in_transit'?'#1e40af':st==='partial'?'#b45309':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{
                // Find all items on this PO
                const poId=po.po_id;const lines=[];
                safeItems(o).forEach((it2,i2)=>{safePOs(it2).forEach((po2,pi2)=>{if(po2.po_id===poId)lines.push({lineIdx:i2,poIdx:pi2})})});
                setEditPO({lineIdx:idx,poIdx:pi,po,allLines:lines.length>0?lines:[{lineIdx:idx,poIdx:pi}]});
              }} title="Click to edit">{po.po_id||'PO'}:</span>
              {szs.map(sz=>{const v=po[sz]||0;const r=isDS?(blld[sz]||0):(rcvd[sz]||0);const cn=cncl[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                const szSt=cn>=v?'cancelled':r>=(v-cn)?(isDS?'shipped':'received'):r>0?'partial':(!isDS&&(blld[sz]||0)>0)?'in_transit':'waiting';
                return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,
                  background:szSt==='cancelled'?'#fef2f2':szSt==='received'||szSt==='shipped'?'#dcfce7':szSt==='in_transit'?'#dbeafe':szSt==='partial'?'#fef3c7':'#fef3c7',
                  color:szSt==='cancelled'?'#dc2626':szSt==='received'||szSt==='shipped'?'#166534':szSt==='in_transit'?'#1e40af':szSt==='partial'?'#b45309':'#92400e'}}>{szSt==='cancelled'?'✕':szSt==='partial'?r+'/'+(v-cn):v-cn}</div>})}
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,
                background:st==='received'||st==='shipped'?'#dcfce7':st==='in_transit'?'#dbeafe':st==='partial'?'#fff7ed':'#fef3c7',
                color:st==='received'||st==='shipped'?'#166534':st==='in_transit'?'#1e40af':st==='partial'?'#b45309':'#92400e'}}>{st==='shipped'?'✓ Shipped':st==='received'?'✓ Received':st==='in_transit'?'In Transit':st==='partial'?(isDS?totalBlld+'/'+(totalOrd-totalCncl)+' Billed':totalRcvd+'/'+(totalOrd-totalCncl)+' Rcvd'):'Waiting'}</span>
              {isDS&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
            </div>})}
        </div>}
        {/* BATCH PO QUEUE INDICATORS */}
        {isSO&&(()=>{
          // Match by item_idx OR sku+color. We saw cases where a batch entry's
          // item_idx pointed at the wrong row (possibly a stale index from before
          // an item was reordered/deleted) and the BATCH row silently vanished.
          // Matching on sku+color too — but only when no OTHER row in the order
          // is already claiming the same batch entry via exact item_idx — keeps
          // the row visible without producing dupes.
          const itemSku=item.sku;
          const itemColor=(item.color||'').toLowerCase().trim();
          const claimedByIdx=new Set();
          (batchPOs||[]).filter(bp=>bp.so_id===o.id).forEach(bp=>(bp.items||[]).forEach(it=>{if(it.item_idx!=null)claimedByIdx.add(bp.id+'|'+it.item_idx)}));
          const bpMatches=(batchPOs||[]).filter(bp=>bp.so_id===o.id).flatMap(bp=>bp.items.filter(it=>{
            if(it.item_idx===idx)return true;
            // Already pinned to a different row by exact index — don't double-match
            if(it.item_idx!=null&&claimedByIdx.has(bp.id+'|'+it.item_idx)&&it.item_idx!==idx)return false;
            // Fall back to SKU+color
            return it.sku===itemSku&&(it.color||'').toLowerCase().trim()===itemColor;
          }).map(it=>({...it,bpo_id:bp.id,vendor_name:bp.vendor_name,created_at:bp.created_at})));
          if(!bpMatches.length)return null;
          return<div style={{padding:'4px 18px',borderBottom:'1px solid #f1f5f9'}}>
            {bpMatches.map((bm,bi)=>{const bmSzKeys=Object.entries(bm.sizes||{}).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              return<div key={bi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
                <span style={{fontSize:10,fontWeight:700,width:46,color:'#dc2626',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setEditBatchPO({bpo_id:bm.bpo_id,item_idx:idx})} title="Click to edit batch PO">BATCH:</span>
                {szs.map(sz=>{const v=(bm.sizes||{})[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                  return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,background:'#fee2e2',color:'#dc2626'}}>{v}</div>})}
                <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,background:'#fee2e2',color:'#dc2626'}}>Queued — {bm.vendor_name}</span>
              </div>})}
          </div>})()}
        {/* DECORATIONS */}
        <div style={{padding:'8px 18px 14px'}}>
          {safeDecos(item).map((deco,di)=>{const cq=deco.kind==='art'&&deco.art_file_id?artQty[deco.art_file_id]:qty;const dp=dP(deco,qty,af,cq);
            const promoDecoSell=item.is_promo&&o.promo_applied?rQ(dp.sell*1.25):dp.sell;
            const eq=dp._nq!=null?dp._nq:(deco.reversible?qty*2:qty);const decoTotal=eq*promoDecoSell;const decoCostTotal=eq*dp.cost;const decoMargin=decoTotal-decoCostTotal;const decoMPct=decoTotal>0?Math.round(decoMargin/decoTotal*100):0;
            const decoCardStyle={padding:'10px 12px',marginBottom:4,borderRadius:6,background:di%2===0?'#fafbfc':'#f8f9fb',borderLeft:'3px solid '+(deco.kind==='art'?'#3b82f6':deco.kind==='numbers'?'#22c55e':deco.kind==='names'?'#f59e0b':deco.kind==='outside_deco'?'#7c3aed':'#94a3b8')};
            if(deco.kind==='art'){const artF=af.find(f=>f.id===deco.art_file_id);const artIcon=artF?(artF.deco_type==='screen_print'?'🎨':artF.deco_type==='embroidery'?'🧵':'🔥'):'';
              const _itemMock=(artF?.item_mockups||{})[item.sku+'|'+(item.color||'')];const _itemMockUrl=_itemMock&&_itemMock.length>0?(typeof _itemMock[0]==='string'?_itemMock[0]:(_itemMock[0]?.url||'')):'';const _thumb=_itemMockUrl||artF?.preview_url||'';
              return(<div key={di} style={decoCardStyle}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  {(!deco.art_file_id||deco.art_file_id==='__tbd')&&<div style={{width:36,height:36,borderRadius:6,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>🎨</div>}
                  {artF&&deco.art_file_id!=='__tbd'&&<div style={{position:'relative'}}><div style={{width:36,height:36,borderRadius:6,background:_thumb?'white':artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,cursor:'pointer',border:_thumb?'1px solid #e2e8f0':'2px solid transparent',overflow:'hidden'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}} title="Click to expand">{_thumb?<img src={_thumb} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:artIcon}</div>
                  <div style={{display:'none',position:'absolute',top:40,left:0,width:260,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:50,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{artF.name||'Untitled'}</div>
                    <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{artF.deco_type?.replace('_',' ')} {artF.art_size&&`· ${artF.art_size}`}</div>
                    {(artF.color_ways||[]).length>0?<div style={{fontSize:11,marginBottom:2}}><strong>{artF.color_ways.length} Color Way{artF.color_ways.length>1?'s':''}:</strong> {artF.color_ways.map((cw,ci)=>'CW'+(ci+1)+(cw.garment_color?' '+cw.garment_color:'')+' ('+cw.inks.filter(c=>c.trim()).join(', ')+')').join(' · ')}</div>
                    :artF.ink_colors?<div style={{fontSize:11,marginBottom:2}}><strong>Ink:</strong> {artF.ink_colors.split('\n').filter(l=>l.trim()).join(', ')}</div>
                    :artF.thread_colors?<div style={{fontSize:11,marginBottom:2}}><strong>Thread:</strong> {artF.thread_colors}</div>:null}
                    <div style={{fontSize:10,color:'#94a3b8',marginBottom:4}}>Files: {artF.files?.join(', ')||'none'}</div>
                    {artF.notes&&<div style={{fontSize:10,color:'#7c3aed'}}>{artF.notes}</div>}
                    <div style={{fontSize:10,marginTop:4,padding:'2px 6px',display:'inline-block',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e'}}>{artF.status}</div>
                  </div></div>}
                  <select className="form-select" style={{width:200,fontSize:12,border:!deco.art_file_id?'2px solid #f59e0b':'1px solid #22c55e'}} value={deco.art_file_id||''} onChange={e=>{const v=e.target.value;if(v==='__tbd'){uDM(idx,di,{art_file_id:'__tbd',art_tbd_type:'screen_print',sell_override:null})}else if(v==='__new_tbd'){const tbdCount=af.filter(f=>f.name&&f.name.startsWith('ART TBD')).length;const newName='ART TBD '+(tbdCount+1);const newTbd={id:'af'+Date.now(),name:newName,deco_type:'screen_print',status:'waiting_for_art',color_ways:[],files:[],mockup_files:[],prod_files:[],notes:'',uploaded:new Date().toLocaleDateString()};setO(e=>({...e,art_files:[...(e.art_files||[]),newTbd],items:safeItems(e).map((it,x)=>x===idx?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,art_file_id:newTbd.id}:d)}:it),updated_at:new Date().toLocaleString()}));setDirty(true);nf('Created '+newName)}else{changeArtFileId(idx,di,v||null)}}}>
                    <option value="">⚠️ Select artwork...</option>
                    <option value="__tbd">🎨 Art TBD (pricing only)</option>
                    <option value="__new_tbd">➕ New Art TBD...</option>{af.map(f=><option key={f.id} value={f.id}>{f.name||'Untitled'}{f.deco_type?' — '+(f.deco_type==='screen_print'?'SP':f.deco_type==='embroidery'?'EMB':f.deco_type==='dtf'?'DTF':f.deco_type==='heat_press'?'HP':f.deco_type.replace(/_/g,' ')):''}</option>)}</select>
                  {deco.art_file_id==='__tbd'&&<><select className="form-select" style={{width:130,fontSize:11,border:'1px solid #f59e0b'}} value={deco.art_tbd_type||'screen_print'} onChange={e=>uDM(idx,di,{art_tbd_type:e.target.value,sell_override:null})}>
                    <option value="screen_print">Screen Print</option><option value="embroidery">Embroidery</option><option value="heat_press">Heat Press</option><option value="dtf">DTF</option></select>
                  {(deco.art_tbd_type||'screen_print')==='screen_print'&&<select className="form-select" style={{width:90,fontSize:10}} value={deco.tbd_colors||1} onChange={e=>uDM(idx,di,{tbd_colors:parseInt(e.target.value),sell_override:null})}>
                    {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} color{n>1?'s':''}</option>)}</select>}
                  {(deco.art_tbd_type||'screen_print')==='screen_print'&&<label style={{fontSize:10,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:deco.underbase?'#fef3c7':'transparent',borderRadius:4,cursor:'pointer'}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uDM(idx,di,{underbase:e.target.checked,sell_override:null})}/> Underbase</label>}
                  {deco.art_tbd_type==='embroidery'&&<select className="form-select" style={{width:110,fontSize:10}} value={deco.tbd_stitches||8000} onChange={e=>uDM(idx,di,{tbd_stitches:parseInt(e.target.value),sell_override:null})}>
                    <option value={8000}>≤10k st</option><option value={12000}>10k-15k</option><option value={18000}>15k-20k</option><option value={25000}>20k+</option></select>}
                  <span style={{fontSize:10,padding:'2px 8px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Art Needed</span></>}
                  <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                  {artF&&<>{(()=>{const afi=af.findIndex(f=>f.id===artF.id);const isTbd=artF.name&&artF.name.startsWith('ART TBD');
                      if(isTbd)return<><select className="form-select" style={{width:130,fontSize:11,border:'1px solid #f59e0b'}} value={artF.deco_type||'screen_print'} onChange={e=>{uArt(afi,'deco_type',e.target.value);uD(idx,di,'sell_override',null)}}><option value="screen_print">Screen Print</option><option value="embroidery">Embroidery</option><option value="heat_press">Heat Press</option><option value="dtf">DTF</option></select>
                        {artF.deco_type==='screen_print'&&<><select className="form-select" style={{width:90,fontSize:10}} value={artF.ink_colors?artF.ink_colors.split('\n').filter(l=>l.trim()).length:1} onChange={e=>{const n=parseInt(e.target.value);const inks=Array.from({length:n},(_,i)=>'Color '+(i+1)).join('\n');uArt(afi,'ink_colors',inks);uD(idx,di,'sell_override',null)}}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} color{n>1?'s':''}</option>)}</select>
                        <label style={{fontSize:10,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:deco.underbase?'#fef3c7':'transparent',borderRadius:4,cursor:'pointer'}}><input type="checkbox" checked={deco.underbase||false} onChange={e=>uDM(idx,di,{underbase:e.target.checked,sell_override:null})}/> Underbase</label></>}
                        {artF.deco_type==='embroidery'&&<select className="form-select" style={{width:110,fontSize:10}} value={artF.stitches||8000} onChange={e=>{uArt(afi,'stitches',parseInt(e.target.value));uD(idx,di,'sell_override',null)}}>
                        <option value={8000}>≤10k st</option><option value={12000}>10k-15k</option><option value={18000}>15k-20k</option><option value={25000}>20k+</option></select>}
                        {(artF.deco_type==='dtf'||artF.deco_type==='heat_press')&&<select className="form-select" style={{width:140,fontSize:10}} value={artF.dtf_size||0} onChange={e=>{uArt(afi,'dtf_size',parseInt(e.target.value));uD(idx,di,'sell_override',null)}}>{DTF.map((t,ti)=><option key={ti} value={ti}>{t.label}</option>)}</select>}
                        <span style={{fontSize:10,padding:'2px 8px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Art Needed</span></>;
                      return<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',color:artF.deco_type==='screen_print'?'#1e40af':artF.deco_type==='embroidery'?'#6d28d9':'#92400e'}}>{artF.deco_type.replace('_',' ')}</span>})()}
                    {(()=>{const afi=af.findIndex(f=>f.id===artF.id);const isTbd=artF.name&&artF.name.startsWith('ART TBD');
                      if(isTbd)return null;
                      if((artF.color_ways||[]).length>0){
                        if(artF.color_ways.length===1&&!deco.color_way_id){setTimeout(()=>uD(idx,di,'color_way_id',artF.color_ways[0].id),0)}
                        const cwOpts=artF.color_ways.map((cw,ci)=><option key={cw.id} value={cw.id}>CW {ci+1}{cw.garment_color?' - '+cw.garment_color:''} ({cw.inks.filter(c=>c.trim()).length}c)</option>);
                        if(deco.reversible&&artF.color_ways.length>=2){
                          return<div style={{display:'flex',flexDirection:'column',gap:4}}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <span style={{fontSize:9,color:'#0891b2',fontWeight:700,textTransform:'uppercase',letterSpacing:0.3,minWidth:46}}>Side A</span>
                              <select className="form-select" style={{width:160,fontSize:11,borderColor:'#67e8f9'}} value={deco.color_way_id||''} onChange={e=>uD(idx,di,'color_way_id',e.target.value||null)}>
                                <option value="">Select CW...</option>{cwOpts}</select>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <span style={{fontSize:9,color:'#0891b2',fontWeight:700,textTransform:'uppercase',letterSpacing:0.3,minWidth:46}}>Side B</span>
                              <select className="form-select" style={{width:160,fontSize:11,borderColor:'#67e8f9'}} value={deco.color_way_id_b||''} onChange={e=>uD(idx,di,'color_way_id_b',e.target.value||null)}>
                                <option value="">Select CW...</option>{cwOpts}</select>
                            </div>
                          </div>;
                        }
                        return<select className="form-select" style={{width:160,fontSize:11}} value={deco.color_way_id||(artF.color_ways.length===1?artF.color_ways[0].id:'')} onChange={e=>uD(idx,di,'color_way_id',e.target.value||null)}>
                        {artF.color_ways.length>1&&<option value="">Select CW...</option>}{cwOpts}</select>}
                      if(artF.ink_colors)return<span style={{fontSize:11,color:'#64748b'}}>{artF.ink_colors.split('\n').filter(l=>l.trim()).length} color(s)</span>;
                      if(artF.thread_colors)return<span style={{fontSize:11,color:'#64748b'}}>Thread: {artF.thread_colors}</span>;
                      return null})()}
                    {artF.art_size&&<span style={{fontSize:11,color:'#94a3b8'}}>{artF.art_size}</span>}</>}
                  <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                    <span style={{fontSize:11}}>Sell: <$In value={promoDecoSell} onChange={v=>uD(idx,di,'sell_override',item.is_promo&&o.promo_applied?rQ(v/1.25):v)} w={50}/></span>
                    {item.is_promo&&o.promo_applied&&<span style={{fontSize:9,color:'#92400e',fontWeight:600}}>+25%</span>}
                    <span style={{fontSize:10,color:decoMPct>0?'#166534':'#dc2626',fontWeight:600}}>{decoMPct}%</span>
                    <span style={{fontSize:11,color:'#475569',fontWeight:700}}>${decoTotal.toFixed(2)}</span>
                    <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                  </div></div>
                  </div>)}
            // NUMBERS decoration
            if(deco.kind==='numbers'){const nm=deco.num_method||'heat_transfer';const szOpts=NUM_SZ[nm]||[];
            const sizedQtys=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
            const roster=deco.roster||{};
            const filledNums=Object.values(roster).flat().filter(v=>v&&v.trim()).length;
            const numQtyOverride=safeNum(deco.num_qty)||0;
            const effectiveNumQty=filledNums||numQtyOverride||qty;
            const showRoster=deco._showRoster||false;
            // Bball numbers: 0-5,10-15,20-25,30-35,40-45,50-55
            const BBALL_NUMS=[0,1,2,3,4,5,10,11,12,13,14,15,20,21,22,23,24,25,30,31,32,33,34,35,40,41,42,43,44,45,50,51,52,53,54,55];
            const autoFillNums=(mode)=>{const nr={};let numIdx=0;
              if(mode==='bball'){sizedQtys.forEach(([sz,sq])=>{nr[sz]=Array(sq).fill('');for(let i=0;i<sq;i++){nr[sz][i]=String(BBALL_NUMS[numIdx%BBALL_NUMS.length]);numIdx++}});}
              else{// small-large: 0,1,2,...99,0,1,2...
                sizedQtys.forEach(([sz,sq])=>{nr[sz]=Array(sq).fill('');for(let i=0;i<sq;i++){nr[sz][i]=String(numIdx%100);numIdx++}});}
              uD(idx,di,'roster',nr);nf(mode==='bball'?'BBall numbers assigned':'Sequential numbers assigned')};
            return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <div style={{width:36,height:36,borderRadius:6,background:'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>#️⃣</div>
                <span style={{fontWeight:700,fontSize:13}}>Numbers</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                {deco.front_and_back&&<span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'#7c3aed',color:'white',fontWeight:700}}>+ Back</span>}
                {deco.reversible&&<span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'#0891b2',color:'white',fontWeight:700}}>Reversible</span>}
                {(()=>{const m=(deco.front_and_back?2:1)*(deco.reversible?2:1);return <span style={{fontSize:11,color:filledNums>0?'#166534':'#64748b',fontWeight:filledNums>0?600:400}}>{filledNums}/{qty} assigned{m>1?' (×'+m+')':''}</span>})()}
                {filledNums===0&&<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#64748b'}}>or Qty: <input type="number" min="0" style={{width:48,border:'1px solid #d1d5db',borderRadius:3,padding:'2px 4px',fontSize:12,fontWeight:600,textAlign:'center'}} value={deco.num_qty||''} placeholder="—" onChange={e=>uD(idx,di,'num_qty',parseInt(e.target.value)||0)}/></span>}
                <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:11}}>Cost: <strong style={{color:'#dc2626'}}>${dp.cost.toFixed(2)}</strong></span>
                  <span style={{fontSize:11}}>Sell: <$In value={promoDecoSell} onChange={v=>uD(idx,di,'sell_override',item.is_promo&&o.promo_applied?rQ(v/1.25):v)} w={50}/></span>
                  {item.is_promo&&o.promo_applied&&<span style={{fontSize:9,color:'#92400e',fontWeight:600}}>+25%</span>}
                  <span style={{fontSize:10,color:decoMPct>0?'#166534':'#dc2626',fontWeight:600}}>{decoMPct}%</span>
                  <span style={{fontSize:11,color:'#475569',fontWeight:700}}>${decoTotal.toFixed(2)}</span>
                  <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                </div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Method:</span>
                <Bg options={[{value:'heat_transfer',label:'Heat Transfer'},{value:'embroidery',label:'Embroidery'},{value:'screen_print',label:'Screen Print'},{value:'sublimated',label:'Sublimated'}]} value={nm} onChange={v=>{const ns=NUM_SZ[v]||[];uDM(idx,di,{num_method:v,num_size:ns[Math.min(2,ns.length-1)]||ns[0]||'',num_font:null,custom_font_art_id:null,sell_override:null})}}/>
                {nm!=='sublimated'&&<><span style={{fontSize:12,fontWeight:600,color:'#64748b',marginLeft:4}}>{deco.front_and_back?'Size (Front):':'Size:'}</span>
                <Bg options={szOpts.map(s=>({value:s,label:s}))} value={deco.num_size||szOpts[0]} onChange={v=>uD(idx,di,'num_size',v)}/>
                <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginLeft:4}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>uD(idx,di,'two_color',e.target.checked)}/> 2-Color (+$3)</label></>}
                {deco.reversible?(()=>{
                  const sideLabels=(()=>{
                    const artD=safeDecos(item).find(dd=>dd.kind==='art'&&dd.reversible&&dd.color_way_id&&dd.color_way_id_b);
                    if(artD){const art=af.find(f=>f.id===artD.art_file_id);if(art&&art.color_ways){
                      const cwA=art.color_ways.find(c=>c.id===artD.color_way_id);
                      const cwB=art.color_ways.find(c=>c.id===artD.color_way_id_b);
                      if(cwA||cwB)return[cwA?.garment_color||'Side A',cwB?.garment_color||'Side B']}}
                    if(item.color&&item.color.includes('/')){const[a,b]=item.color.split('/').map(s=>s.trim());return[a||'Side A',b||'Side B']}
                    return['Side A','Side B']})();
                  const custPantones=mergeColors(cust,allCustomers,'pantone_colors');
                  const renderPicker=(field,placeholder)=>{const val=deco[field];return val
                    ?<div style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 6px',background:'white',border:'1px solid #67e8f9',borderRadius:4}}>
                        <span style={{width:14,height:14,borderRadius:2,background:pantoneHex(val)||'#ccc',border:'1px solid #d1d5db',flexShrink:0}}/>
                        <span style={{fontSize:11,fontWeight:600,color:'#0f172a'}}>{val}</span>
                        <button onClick={()=>uD(idx,di,field,'')} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0,fontSize:14,lineHeight:1}} title="Clear">×</button>
                      </div>
                    :<div style={{display:'flex',flexDirection:'column',gap:2}}>
                        <PantoneAdder onAdd={({code})=>uD(idx,di,field,'PMS '+code)} existingCodes={[]}/>
                        {custPantones.length>0&&<PantoneQuickPicks colors={custPantones} onPick={v=>uD(idx,di,field,v)}/>}
                      </div>};
                  return<div style={{display:'flex',flexDirection:'column',gap:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:'#0891b2',fontWeight:700,textTransform:'uppercase',letterSpacing:0.3,minWidth:90}}>{sideLabels[0]}</span>
                      {renderPicker('print_color','e.g. White')}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:'#0891b2',fontWeight:700,textTransform:'uppercase',letterSpacing:0.3,minWidth:90}}>{sideLabels[1]}</span>
                      {renderPicker('print_color_b','e.g. Navy')}
                    </div>
                  </div>})():(()=>{
                  const custPantones=mergeColors(cust,allCustomers,'pantone_colors');
                  return<><span style={{fontSize:12,fontWeight:600,color:'#64748b',marginLeft:4}}>Color:</span>
                    {deco.print_color
                      ?<div style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 6px',background:'white',border:'1px solid #cbd5e1',borderRadius:4}}>
                          <span style={{width:14,height:14,borderRadius:2,background:pantoneHex(deco.print_color)||'#ccc',border:'1px solid #d1d5db',flexShrink:0}}/>
                          <span style={{fontSize:11,fontWeight:600,color:'#0f172a'}}>{deco.print_color}</span>
                          <button onClick={()=>uD(idx,di,'print_color','')} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0,fontSize:14,lineHeight:1}} title="Clear">×</button>
                        </div>
                      :<div style={{display:'flex',flexDirection:'column',gap:2}}>
                          <PantoneAdder onAdd={({code})=>uD(idx,di,'print_color','PMS '+code)} existingCodes={[]}/>
                          {custPantones.length>0&&<PantoneQuickPicks colors={custPantones} onPick={v=>uD(idx,di,'print_color',v)}/>}
                        </div>}
                  </>})()}
              </div>
              {deco.front_and_back&&nm!=='sublimated'&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Size (Back):</span>
                <Bg options={szOpts.map(s=>({value:s,label:s}))} value={deco.num_size_back||deco.num_size||szOpts[0]} onChange={v=>uD(idx,di,'num_size_back',v)}/>
              </div>}
              {/* Font selection */}
              {nm!=='sublimated'&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Font:</span>
                {nm==='embroidery'&&<span style={{fontSize:12,color:'#475569'}}>Block (standard)</span>}
                {nm==='screen_print'&&<><Bg options={[{value:'block',label:'Block'},{value:'serif',label:'Serif'}]} value={deco.num_font||'block'} onChange={v=>uD(idx,di,'num_font',v)}/>
                  {!deco.custom_font_art_id&&<button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>or Custom Font Art</button>}
                  {deco.custom_font_art_id&&<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
                {nm==='heat_transfer'&&<>{!deco.custom_font_art_id?<><span style={{fontSize:12,color:'#475569'}}>Standard</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>Use Custom Font Art</button></>
                  :<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
              </div>}
              {/* Front + Back toggle + number assignment */}
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:deco.front_and_back?'#7c3aed':'#faf5ff',borderColor:'#c084fc',color:deco.front_and_back?'white':'#7c3aed',fontWeight:deco.front_and_back?700:400}} onClick={()=>{uD(idx,di,'front_and_back',!deco.front_and_back);nf(deco.front_and_back?'Front + Back OFF — single side':'Front + Back ON — qty doubled')}}>↕ Front + Back{deco.front_and_back?' ✓':''}</button>
              {!showRoster?<><button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>uD(idx,di,'_showRoster',true)}>📋 Assign Numbers ({filledNums>0?filledNums+'/':''}{qty} pcs)</button>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#ecfdf5',borderColor:'#6ee7b7',color:'#065f46'}}
                onClick={()=>setRosterUploadModal({idx,di,item,roster,sizedQtys})}>📤 Upload Roster</button>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#eff6ff',borderColor:'#93c5fd',color:'#1e40af'}} onClick={()=>{let csv='Size,Number,Name\n';sizedQtys.forEach(([sz,sqty])=>{for(let i=0;i<sqty;i++)csv+=sz+',,\n'});const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='roster_template_'+(item.sku||'item')+'.csv';a.click();URL.revokeObjectURL(url)}}>📥 Download Template</button>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#fef3c7',borderColor:'#fbbf24',color:'#92400e'}} onClick={()=>{
                const linkData=btoa(JSON.stringify({so:o.id,sku:item.sku||'CUSTOM',item:item.name||'Item',color:item.color||'',sizes:item.sizes,rep_email:cuEmail,rep_name:cu?.name||'',coach_name:'Coach'}));
                setRosterSendModal({idx,di,item,linkData,rosterUrl:window.location.origin+'/roster.html?d='+linkData})}}>📧 Send to Coach</button></>

              :<div style={{marginTop:6,padding:10,background:'#f8fafc',borderRadius:6,border:'1px dashed #d1d5db'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Number Assignment</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {/* Copy numbers from other item's number deco */}
                    {(()=>{const otherNumDecos=[];safeItems(o).forEach((oit,oi)=>{if(oi===idx)return;safeDecos(oit).forEach(od=>{if(od.kind==='numbers'&&od.roster&&Object.values(od.roster).flat().some(v=>v)){otherNumDecos.push({itemIdx:oi,sku:oit.sku,name:oit.name,position:od.position,roster:od.roster})}})});
                      return otherNumDecos.length>0&&<select className="form-select" style={{fontSize:9,padding:'2px 4px',width:'auto',background:'#fef3c7',borderColor:'#fbbf24',color:'#92400e',fontWeight:600}} value="" onChange={e=>{const src=otherNumDecos[parseInt(e.target.value)];if(src){uD(idx,di,'roster',JSON.parse(JSON.stringify(src.roster)));nf('Numbers copied from '+src.sku)}}}>
                        <option value="">📋 Copy from...</option>
                        {otherNumDecos.map((nd,ni)=><option key={ni} value={ni}>{nd.sku} — {nd.position} ({Object.values(nd.roster).flat().filter(v=>v).length} #s)</option>)}
                      </select>})()}
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#dbeafe',borderColor:'#93c5fd',color:'#1e40af'}} onClick={()=>autoFillNums('bball')}>🏀 BBall #s</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#dcfce7',borderColor:'#86efac',color:'#166534'}} onClick={()=>autoFillNums('sequential')}>🔢 Small→Large</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#ecfdf5',borderColor:'#6ee7b7',color:'#065f46'}} onClick={()=>setRosterUploadModal({idx,di,item,roster,sizedQtys})}>📤 Upload Roster</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,background:'#fef3c7',borderColor:'#fbbf24',color:'#92400e'}} onClick={()=>{
                      const linkData=btoa(JSON.stringify({so:o.id,sku:item.sku||'CUSTOM',item:item.name||'Item',color:item.color||'',sizes:item.sizes,rep_email:cuEmail,rep_name:cu?.name||'',coach_name:'Coach'}));
                      setRosterSendModal({idx,di,item,linkData,rosterUrl:window.location.origin+'/roster.html?d='+linkData})}}>📧 Send to Coach</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{
                      let csv='Size,Number,Name\n';sizedQtys.forEach(([sz,sqty])=>{for(let i=0;i<sqty;i++)csv+=sz+',,\n'});
                      const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
                      const a=document.createElement('a');a.href=url;a.download='roster_template_'+(item.sku||'item')+'.csv';a.click();URL.revokeObjectURL(url)}}>📥 Template</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{
                      const csv=prompt('Paste (Size,Number per line):\nM,12\nL,34');
                      if(csv){const nr={...roster};csv.split('\n').forEach(line=>{const[sz,num]=line.split(',').map(s=>s.trim());
                        if(sz&&num){if(!nr[sz])nr[sz]=Array(item.sizes[sz]||0).fill('');const ei=nr[sz].findIndex(v=>!v);if(ei>=0)nr[sz][ei]=num}});
                        uD(idx,di,'roster',nr);nf('Imported')}}}>📋 Paste</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,color:'#dc2626'}} onClick={()=>{uD(idx,di,'roster',{});nf('Cleared')}}>Clear</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>uD(idx,di,'_showRoster',false)}>▲ Close</button>
                  </div></div>
                {sizedQtys.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes above first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {sizedQtys.map(([sz,sqty])=>{const szRoster=roster[sz]||[];
                    return<div key={sz} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{width:50,fontSize:12,fontWeight:700,color:'#1e40af'}}>{sz} ({sqty})</span>
                      {Array.from({length:sqty}).map((_,si)=><input key={si} style={{width:38,textAlign:'center',border:'1px solid #d1d5db',borderRadius:3,padding:'3px 2px',fontSize:12,fontWeight:600,background:szRoster[si]?'#dbeafe':'white'}} value={szRoster[si]||''} placeholder="—" onChange={e=>{const nr={...roster};const arr=[...(nr[sz]||Array(sqty).fill(''))];arr[si]=e.target.value;nr[sz]=arr;uD(idx,di,'roster',nr)}}/>)}
                    </div>})}
                </div>}
                {filledNums>0&&<div style={{fontSize:10,color:'#64748b',marginTop:4}}>{filledNums}/{qty} assigned</div>}
              </div>}
              </div>
            </div>)}
            // OUTSIDE DECORATION
            if(deco.kind==='outside_deco'){return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:18}}>🎨</span>
                <span style={{fontWeight:700,fontSize:13,color:'#7c3aed'}}>Outside Decoration</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <div style={{marginLeft:'auto'}}><button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button></div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6,padding:'8px 10px',background:'#faf5ff',borderRadius:6,border:'1px solid #ede9fe'}}>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#7c3aed'}}>Vendor</span>
                  <select className="form-select" style={{width:160,fontSize:12}} value={deco.vendor||''} onChange={e=>{const vn=e.target.value;uD(idx,di,'vendor',vn);const dv=decoVendors.find(v=>v.name===vn);if(dv){const cost=_decoVendorPrice(decoVendorPricing,dv.id,deco.deco_type||'embroidery',{qty});if(cost!==null)uD(idx,di,'cost_each',cost)}}}>
                    <option value="">Select vendor...</option>{DECO_VENDORS.map(dv=><option key={dv} value={dv}>{dv}</option>)}</select></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#7c3aed'}}>Deco Type</span>
                  <select className="form-select" style={{width:120,fontSize:12}} value={deco.deco_type||'embroidery'} onChange={e=>{const dt=e.target.value;uD(idx,di,'deco_type',dt);if(deco.vendor){const dv=decoVendors.find(v=>v.name===deco.vendor);if(dv){const cost=_decoVendorPrice(decoVendorPricing,dv.id,dt,{qty});if(cost!==null)uD(idx,di,'cost_each',cost)}}}}>
                    {['embroidery','screen_print','dtf','heat_transfer','sublimation','vinyl'].map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}</select></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#dc2626'}}>Cost /ea</span><$In value={deco.cost_each||0} onChange={v=>uD(idx,di,'cost_each',v)} w={60}/></div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:10,fontWeight:600,color:'#166534'}}>Sell /ea{item.is_promo&&o.promo_applied?' +25%':''}</span><$In value={item.is_promo&&o.promo_applied?rQ((deco.sell_each||0)*1.25):(deco.sell_each||0)} onChange={v=>{const base=item.is_promo&&o.promo_applied?rQ(v/1.25):v;uDM(idx,di,{sell_each:base,sell_override:base})}} w={60}/></div>
                <div style={{display:'flex',flexDirection:'column',gap:2,flex:1}}><span style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Notes</span>
                  <input className="form-input" style={{fontSize:11,padding:'4px 6px'}} value={deco.notes||''} onChange={e=>uD(idx,di,'notes',e.target.value)} placeholder="Thread colors, instructions..."/></div>
              </div>
            </div>)}
            // NAMES decoration
            if(deco.kind==='names'){
              const sQ2=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
              const nd=deco.names||{};const isSublimatedName=deco.name_method==='sublimated';const nSell=isSublimatedName?safeNum(deco.sell_override)||0:safeNum(deco.sell_override||deco.sell_each||6);const nCost=isSublimatedName?0:safeNum(deco.cost_each||3);
              const nCt=Object.values(nd).flat().filter(v=>v&&v.trim()).length;
              const nameQtyOverride=safeNum(deco.name_qty)||0;
              const effectiveNameQty=nCt||nameQtyOverride;
              const nKey=idx+'-'+di;const nCollapsed=!!collapsedNames[nKey];
              const importNamesCsv=text=>{const lines=text.split('\n').filter(l=>l.trim());const nn={...nd};let ct=0;
                lines.forEach(line=>{if(line.toLowerCase().startsWith('size'))return;const parts=line.split(',').map(s=>s.trim());const sz=parts[0];const name=parts.length>=3?parts[2]:parts[1]||'';
                  if(sz&&name&&item.sizes[sz]>0){if(!nn[sz])nn[sz]=Array(item.sizes[sz]||0).fill('');const ei=nn[sz].findIndex(v=>!v);if(ei>=0){nn[sz][ei]=name;ct++}}});
                uD(idx,di,'names',nn);nf(ct+' names imported')};
              return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:nCollapsed?0:6}}>
                <span onClick={()=>setCollapsedNames(p=>({...p,[nKey]:!p[nKey]}))} style={{cursor:'pointer',fontSize:11,color:'#92400e',transition:'transform 0.2s',transform:nCollapsed?'rotate(-90deg)':'rotate(0deg)'}}>▼</span>
                <span style={{fontSize:18}}>🏷️</span><span style={{fontWeight:700,fontSize:13,cursor:'pointer'}} onClick={()=>setCollapsedNames(p=>({...p,[nKey]:!p[nKey]}))}>Names</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Method:</span>
                <Bg options={[{value:'heat_press',label:'Heat Press'},{value:'embroidery',label:'Embroidery'},{value:'sublimated',label:'Sublimated'}]} value={deco.name_method||'heat_press'} onChange={v=>uDM(idx,di,{name_method:v,sell_override:null})}/>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Color:</span>
                <input className="form-input" style={{width:90,fontSize:12,padding:'2px 6px'}} placeholder="e.g. White" value={deco.print_color||''} onChange={e=>uD(idx,di,'print_color',e.target.value)}/>
                <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:12}}>$/ea: <$In value={item.is_promo&&o.promo_applied?rQ(nSell*1.25):nSell} onChange={v=>uD(idx,di,'sell_override',item.is_promo&&o.promo_applied?rQ(v/1.25):v)} w={40}/></span>
                  {item.is_promo&&o.promo_applied&&<span style={{fontSize:9,color:'#92400e',fontWeight:600}}>+25%</span>}
                  <span style={{fontSize:11,color:'#64748b'}}>{effectiveNameQty} names = ${ (effectiveNameQty*(item.is_promo&&o.promo_applied?rQ(nSell*1.25):nSell)).toFixed(2)}</span>
                  {nCt===0&&<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#64748b'}}>Qty: <input type="number" min="0" style={{width:48,border:'1px solid #d1d5db',borderRadius:3,padding:'2px 4px',fontSize:12,fontWeight:600,textAlign:'center'}} value={deco.name_qty||''} placeholder="—" onChange={e=>uD(idx,di,'name_qty',parseInt(e.target.value)||0)}/></span>}
                  <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                </div></div>
              {!nCollapsed&&<div style={{padding:10,background:'#fffbeb',borderRadius:6,border:'1px dashed #f59e0b'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#f59e0b'}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#f59e0b';
                  const f=e.dataTransfer.files[0];if(!f)return;const reader=new FileReader();
                  reader.onload=ev=>importNamesCsv(ev.target.result);reader.readAsText(f)}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#92400e'}}>Drag CSV or enter names</span>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{let csv='Size,Number,Name\n';sQ2.forEach(([sz,sq])=>{for(let i=0;i<sq;i++)csv+=sz+',,\n'});const b=new Blob([csv],{type:'text/csv'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='name_template_'+item.sku+'.csv';a.click();URL.revokeObjectURL(u)}}>📥 Template</button>
                    <label className="btn btn-sm btn-secondary" style={{fontSize:9,cursor:'pointer',margin:0}}>📤 Upload<input type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=ev=>importNamesCsv(ev.target.result);reader.readAsText(f);e.target.value=''}}/></label>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,color:'#dc2626'}} onClick={()=>{uD(idx,di,'names',{});nf('Cleared')}}>Clear</button></div></div>
                {sQ2.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {sQ2.map(([sz,sq])=>{const sn=nd[sz]||[];return<div key={sz} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{width:50,fontSize:12,fontWeight:700,color:'#92400e'}}>{sz} ({sq})</span>
                    {Array.from({length:sq}).map((_,si)=><input key={si} style={{width:100,border:'1px solid #d1d5db',borderRadius:3,padding:'3px 6px',fontSize:12,background:sn[si]?'#fef3c7':'white'}} value={sn[si]||''} placeholder="Name" onChange={e=>{const nn2={...nd};const ar=[...(nn2[sz]||Array(sq).fill(''))];ar[si]=e.target.value;nn2[sz]=ar;uD(idx,di,'names',nn2)}}/>)}
                  </div>})}</div>}
              </div>}</div>)}
            return null})}
          <div style={{display:'flex',justifyContent:'space-between',padding:'6px 12px',background:'#f0f9ff',borderRadius:6,marginTop:4,alignItems:'center',flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:'#64748b'}}>Cost: <strong>${(()=>{if(item._sizeCosts&&szQty>0){return(pCost/szQty).toFixed(2)}return item.nsa_cost?.toFixed(2)})()}</strong>/ea{item._sizeCosts&&Object.keys(item._sizeCosts).length>1&&<span style={{fontSize:9,color:'#94a3b8'}}> (avg)</span>}</span>
              <span style={{fontSize:11,color:'#64748b'}}>Sell: <strong>${(()=>{if(item._sizeSells&&szQty>0){return(pRev/szQty).toFixed(2)}return item.unit_sell?.toFixed(2)})()}</strong>/ea{item._sizeSells&&Object.keys(item._sizeSells).length>1&&<span style={{fontSize:9,color:'#94a3b8'}}> (avg)</span>}</span>
              {(isAU(item.brand)||item.retail_price>0)&&<span style={{fontSize:11,color:'#64748b'}}>Retail: ${item.retail_price?.toFixed(2)}</span>}
            </div>
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <span style={{fontSize:11,color:'#64748b'}}>Garment: ${pRev.toFixed(2)}</span>
              {safeDecos(item).length>0&&<span style={{fontSize:11,color:'#64748b'}}>Deco: ${(()=>{let d=0;safeDecos(item).forEach(dd=>{const cq2=dd.kind==='art'&&dd.art_file_id?artQty[dd.art_file_id]:qty;const dp2=dP(dd,qty,af,cq2);const eq2=dp2._nq!=null?dp2._nq:qty;d+=eq2*dp2.sell});return d.toFixed(2)})()}</span>}
              <span style={{fontSize:12,fontWeight:800,color:'#1e40af'}}>All-In: ${iR.toFixed(2)}</span>
            </div>
          </div>
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addArtDeco(idx)}><Icon name="image" size={12}/> + Add Art</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNumDeco(idx)}>#️⃣ + Numbers</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNameDeco(idx)}>🏷️ + Names</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#faf5ff',borderColor:'#ddd6fe',color:'#7c3aed'}} onClick={()=>addOutsideDeco(idx)}>🎨 + Outside Deco</button>
            {(()=>{const sa=item.size_availability||{};const hasAny=Object.keys(sa).length>0;const activeSizes=szs.filter(sz=>(item.sizes[sz]||0)>0);
              if(activeSizes.length===0)return null;
              return<button className="btn btn-sm btn-secondary" style={{fontSize:11,background:hasAny?'#fef3c7':'white',borderColor:hasAny?'#fbbf24':'#d1d5db',color:hasAny?'#92400e':'#64748b'}} onClick={()=>{if(!hasAny){uI(idx,'size_availability',{[activeSizes[0]]:''})}else{uI(idx,'_showAvail',!item._showAvail)}}}>⏳ Later Avail{hasAny?' ✓':''}</button>})()}
            {safeDecos(item).map((d,di)=>d.kind==='art'?<React.Fragment key={'deco-x-'+di}>{(()=>{const artF=af.find(f=>f.id===d.art_file_id);return artF&&artF.deco_type==='screen_print'?<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:d.underbase?'#fef3c7':'#f1f5f9',borderRadius:4,cursor:'pointer',border:'1px solid '+(d.underbase?'#fbbf24':'#e2e8f0')}}><input type="checkbox" checked={d.underbase||false} onChange={e=>uD(idx,di,'underbase',e.target.checked)}/> Underbase</label>:null})()}{(()=>{const artF=af.find(f=>f.id===d.art_file_id);if(!artF)return null;const st=artF.status==='uploaded'?'needs_approval':artF.status;if(!st||st==='waiting_for_art')return null;const label=st==='approved'?'Approved':st==='needs_approval'?'Needs Approval':st.replace(/_/g,' ');return<span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:st==='approved'?'#dcfce7':'#fef3c7',color:st==='approved'?'#166534':'#92400e',fontWeight:600}}>{label}</span>})()}</React.Fragment>:null)}
            {/* Single item-level reversible toggle — applies to every deco on this garment (art + numbers + names) */}
            {(()=>{const itemRev=safeDecos(item).some(d=>d.reversible);return safeDecos(item).length>0?<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:itemRev?'#ecfeff':'#f1f5f9',borderRadius:4,cursor:'pointer',border:'1px solid '+(itemRev?'#67e8f9':'#e2e8f0')}}><input type="checkbox" checked={itemRev} onChange={e=>{setItemReversible(idx,e.target.checked);nf(e.target.checked?'Reversible ON — applies to all decos on this item':'Reversible OFF')}}/> 🔄 Reversible (×2)</label>:null})()}
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:item.notes!=null?'#fef9c3':'white',borderColor:item.notes!=null?'#fde047':'#d1d5db',color:item.notes!=null?'#854d0e':'#475569'}} onClick={()=>uI(idx,'notes',item.notes==null?'':null)}>📝 {item.notes!=null?'Notes ✓':'+ Notes'}</button>
            {safeDecos(item).length===0&&!item.no_deco&&qty>0&&<span style={{fontSize:10,color:'#dc2626',fontWeight:600}}>⚠️ No deco assigned</span>}
          </div>
          {item.notes!=null&&<div style={{display:'flex',gap:6,alignItems:'flex-start',marginTop:6,padding:'6px 10px',background:'#fefce8',borderRadius:6,border:'1px solid #fde047'}}>
            <span style={{fontSize:11,fontWeight:700,color:'#854d0e',paddingTop:4}}>📝 Notes:</span>
            <input value={item.notes||''} onChange={e=>uI(idx,'notes',e.target.value)} placeholder="Notes to show on estimate / sales order / invoice PDF" style={{flex:1,fontSize:12,border:'1px solid #fde047',borderRadius:4,padding:'4px 8px',background:'white'}}/>
            <button onClick={()=>uI(idx,'notes',null)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:14,padding:'2px 4px'}} title="Remove notes">✕</button>
          </div>}
          {(()=>{const sa=item.size_availability||{};const hasAny=Object.keys(sa).length>0;const activeSizes=szs.filter(sz=>(item.sizes[sz]||0)>0);
            if(!hasAny||activeSizes.length===0)return null;
            return<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6,padding:'6px 10px',background:'#fffbeb',borderRadius:6,border:'1px solid #fde68a',alignItems:'center'}}>
              <span style={{fontSize:10,fontWeight:600,color:'#92400e'}}>⏳ Available:</span>
              {activeSizes.map(sz=><div key={sz} style={{display:'flex',alignItems:'center',gap:3}}>
                <span style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</span>
                <input type="date" value={sa[sz]||''} onChange={e=>{const nsa={...sa};if(e.target.value){nsa[sz]=e.target.value}else{delete nsa[sz];if(Object.keys(nsa).length===0){uI(idx,'size_availability',{});return}}uI(idx,'size_availability',nsa)}}
                  style={{fontSize:10,border:'1px solid #fbbf24',borderRadius:4,padding:'1px 3px',width:105,background:sa[sz]?'#fef3c7':'white'}}/>
              </div>)}
              <button onClick={()=>uI(idx,'size_availability',{})} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:11,padding:0,marginLeft:'auto'}}>✕ Clear</button>
            </div>})()}
        </div>
      </div>)})}
    {/* ADD PRODUCT */}
    <div className="card"><div style={{padding:'14px 18px'}}>
      {!showAdd?<div style={{display:'flex',gap:6}}><button className="btn btn-primary" onClick={()=>setShowAdd(true)} disabled={!cust}><Icon name="plus" size={14}/> Add Product</button>
      <button className="btn btn-secondary" onClick={()=>setShowCustom(!showCustom)} disabled={!cust}><Icon name="plus" size={14}/> Custom Item</button>
      <button className="btn btn-secondary" style={{marginLeft:'auto',background:'#7c3aed',color:'white',borderColor:'#6d28d9'}} onClick={()=>setAiBuild({step:'input',inputMode:'text',text:'',images:[],url:'',loading:false,error:null,parsed:[],warnings:[],build_id:null})} disabled={!cust} title="Use AI to parse a coach's order (text, image, or Google Sheets link) into line items">✨ Build with AI</button></div>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search SKU, name, brand... (searches S&S + SanMar live)" value={pS} onChange={e=>setPS(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:350,overflow:'auto'}}>
          {allFp.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addP(p)}>
          <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3}}>{p.sku}</span><span style={{fontWeight:600}}>{p.name}</span>{p.color&&<span style={{fontSize:11,color:'#64748b'}}>— {p.color}</span>}<span className="badge badge-blue">{p.brand}</span>
          {p._colors&&<span style={{fontSize:10,color:'#7c3aed'}}>{p._colors.length} clr</span>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>${p.nsa_cost?.toFixed(2)}</span></div>)}
          {/* S&S Live Search Results */}
          {pS.length>=2&&(ssSearching||ssResults.length>0)&&<>
            <div style={{padding:'6px 12px',background:'#f5f3ff',borderTop:'2px solid #ddd6fe',borderBottom:'1px solid #ede9fe',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:10,fontWeight:800,color:'#7c3aed',textTransform:'uppercase',letterSpacing:1}}>S&S Activewear</span>
              {ssSearching&&<span style={{fontSize:10,color:'#a78bfa'}}>Searching...</span>}
              {!ssSearching&&ssResults.length>0&&<span style={{fontSize:10,color:'#8b5cf6'}}>{ssResults.length} style{ssResults.length!==1?'s':''}</span>}
            </div>
            {ssResults.slice(0,10).map((ss,si)=>{const eKey='ss-'+si;const isExp=expandedStyle===eKey;return<div key={si}>
              <div style={{padding:'8px 12px',borderBottom:'1px solid #f5f3ff',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isExp?'#ede9fe':si%2===0?'#faf8ff':'white'}} onClick={()=>setExpandedStyle(isExp?null:eKey)}>
                {ss.styleImage?<img src={ss.styleImage} alt="" style={{width:32,height:32,objectFit:'contain',borderRadius:4,background:'#f8fafc'}} onError={e=>{e.target.style.display='none'}}/>:<div style={{width:32,height:32,borderRadius:4,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#7c3aed',fontWeight:700,flexShrink:0}}>SS</div>}
                <span style={{fontFamily:'monospace',fontWeight:700,color:'#7c3aed',background:'#ede9fe',padding:'2px 6px',borderRadius:3,fontSize:12}}>{ss.sku}</span>
                <span style={{fontWeight:600,fontSize:13}}>{ss.styleName}</span>
                <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#ede9fe',color:'#6d28d9',fontWeight:600}}>{ss.brandName}</span>
                <span style={{fontSize:10,color:'#8b5cf6'}}>{ss.colors.length} color{ss.colors.length!==1?'s':''}</span>
                <span style={{marginLeft:'auto',display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                  <span style={{fontSize:12,color:'#7c3aed',fontWeight:700}}>from ${ss.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:9,color:ss.totalQty>0?'#7c3aed':'#dc2626',fontWeight:600}}>{ss.totalQty>0?ss.totalQty.toLocaleString()+' avail':'Out of stock'}</span>
                </span>
                <span style={{fontSize:12,color:'#7c3aed'}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&(()=>{const fc=filterExpColors(ss.colors);return<div style={{background:'#faf8ff',borderBottom:'2px solid #ddd6fe',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {ss.colors.length>6&&expColorSearchInput('#ddd6fe')}
                {fc.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #ddd6fe',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(ss,c,'ss')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)+' ('+c.totalQty+' avail)'}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:20,height:20,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#7c3aed',whiteSpace:'nowrap'}}>${c.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:8,color:c.totalQty>0?'#22c55e':'#dc2626'}}>{c.totalQty>0?c.totalQty.toLocaleString():'OOS'}</span>
                </div>)}
                {fc.length===0&&expColorNoMatch}
              </div>})()}
            </div>})}
            {!ssSearching&&ssResults.length===0&&pS.length>=2&&<div style={{padding:'10px 12px',color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>No S&S results for "{pS}"</div>}
          </>}
          {/* SanMar Live Search Results */}
          {pS.length>=2&&(smSearching||smResults.length>0)&&<>
            <div style={{padding:'6px 12px',background:'#ecfeff',borderTop:'2px solid #a5f3fc',borderBottom:'1px solid #cffafe',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:10,fontWeight:800,color:'#0891b2',textTransform:'uppercase',letterSpacing:1}}>SanMar</span>
              {smSearching&&<span style={{fontSize:10,color:'#22d3ee'}}>Searching...</span>}
              {!smSearching&&smResults.length>0&&<span style={{fontSize:10,color:'#0891b2'}}>{smResults.length} style{smResults.length!==1?'s':''}</span>}
            </div>
            {smResults.slice(0,10).map((sm,si)=>{const eKey='sm-'+si;const isExp=expandedStyle===eKey;return<div key={'sm'+si}>
              <div style={{padding:'8px 12px',borderBottom:'1px solid #ecfeff',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isExp?'#cffafe':si%2===0?'#f0fdfa':'white'}} onClick={()=>setExpandedStyle(isExp?null:eKey)}>
                {sm.styleImage?<img src={sm.styleImage} alt="" style={{width:32,height:32,objectFit:'contain',borderRadius:4,background:'#f8fafc'}} onError={e=>{e.target.style.display='none'}}/>:<div style={{width:32,height:32,borderRadius:4,background:'#cffafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#0891b2',fontWeight:700,flexShrink:0}}>SM</div>}
                <span style={{fontFamily:'monospace',fontWeight:700,color:'#0891b2',background:'#cffafe',padding:'2px 6px',borderRadius:3,fontSize:12}}>{sm.sku}</span>
                <span style={{fontWeight:600,fontSize:13}}>{sm.styleName}</span>
                <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#cffafe',color:'#0e7490',fontWeight:600}}>{sm.brandName}</span>
                <span style={{fontSize:10,color:'#06b6d4'}}>{sm.colors.length} color{sm.colors.length!==1?'s':''}</span>
                <span style={{marginLeft:'auto',display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                  <span style={{fontSize:12,color:'#0891b2',fontWeight:700}}>from ${sm.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:9,color:sm.totalQty>0?'#0891b2':'#dc2626',fontWeight:600}}>{sm.totalQty>0?sm.totalQty.toLocaleString()+' avail':'Check stock'}</span>
                </span>
                <span style={{fontSize:12,color:'#0891b2'}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&(()=>{const fc=filterExpColors(sm.colors);return<div style={{background:'#f0fdfa',borderBottom:'2px solid #a5f3fc',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {sm.colors.length>6&&expColorSearchInput('#a5f3fc')}
                {fc.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #a5f3fc',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(sm,c,'sm')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)+' ('+c.totalQty+' avail)'}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:20,height:20,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#0891b2',whiteSpace:'nowrap'}}>${c.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:8,color:c.totalQty>0?'#22c55e':'#dc2626'}}>{c.totalQty>0?c.totalQty.toLocaleString():'OOS'}</span>
                </div>)}
                {fc.length===0&&expColorNoMatch}
              </div>})()}
            </div>})}
            {!smSearching&&smResults.length===0&&pS.length>=2&&<div style={{padding:'10px 12px',color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>No SanMar results for "{pS}"</div>}
          </>}
          {/* Momentec Live Search Results */}
          {pS.length>=2&&(mtSearching||mtResults.length>0)&&<>
            <div style={{padding:'6px 12px',background:'#fef3c7',borderTop:'2px solid #fcd34d',borderBottom:'1px solid #fde68a',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:10,fontWeight:800,color:'#b45309',textTransform:'uppercase',letterSpacing:1}}>Momentec</span>
              {mtSearching&&<span style={{fontSize:10,color:'#d97706'}}>Searching...</span>}
              {!mtSearching&&mtResults.length>0&&<span style={{fontSize:10,color:'#b45309'}}>{mtResults.length} style{mtResults.length!==1?'s':''}</span>}
            </div>
            {mtResults.slice(0,10).map((mt,mi)=>{const eKey='mt-'+mi;const isExp=expandedStyle===eKey;return<div key={'mt'+mi}>
              <div style={{padding:'8px 12px',borderBottom:'1px solid #fef3c7',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isExp?'#fde68a':mi%2===0?'#fffbeb':'white'}} onClick={()=>setExpandedStyle(isExp?null:eKey)}>
                <div style={{width:32,height:32,borderRadius:4,background:'#fde68a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#b45309',fontWeight:700,flexShrink:0}}>MT</div>
                <span style={{fontFamily:'monospace',fontWeight:700,color:'#b45309',background:'#fde68a',padding:'2px 6px',borderRadius:3,fontSize:12}}>{mt.sku}</span>
                <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{mt.styleName}</span>
                <span style={{fontSize:11,color:'#92400e',background:'#fef3c7',padding:'1px 6px',borderRadius:3}}>{mt.brandName}</span>
                {mt.colors.length>0&&<span style={{fontSize:10,color:'#b45309'}}>{mt.colors.length} color{mt.colors.length!==1?'s':''}</span>}
                <span style={{fontWeight:700,color:'#b45309',fontSize:13,marginLeft:'auto'}}>{mt._mtPrice>0?`from $${mt._mtPrice.toFixed(2)}`:'Price TBD'}</span>
                <span style={{fontSize:14,color:'#d97706'}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&(()=>{const fc=filterExpColors(mt.colors);return<div style={{background:'#fffbeb',borderBottom:'2px solid #fcd34d',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {mt.colors.length>6&&expColorSearchInput('#fcd34d')}
                {fc.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #fcd34d',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(mt,c,'mt')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)}>
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#b45309',whiteSpace:'nowrap'}}>{c.customerPrice>0?`$${c.customerPrice.toFixed(2)}`:'TBD'}</span>
                </div>)}
                {fc.length===0&&expColorNoMatch}
              </div>})()}
            </div>})}
            {!mtSearching&&mtResults.length===0&&pS.length>=2&&<div style={{padding:'10px 12px',color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>No Momentec results for "{pS}"</div>}
          </>}
          {/* Richardson Live Search Results (StockInventory feed) */}
          {pS.length>=2&&(rsSearching||rsResults.length>0)&&<>
            <div style={{padding:'6px 12px',background:'#fef2f2',borderTop:'2px solid #fca5a5',borderBottom:'1px solid #fecaca',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:10,fontWeight:800,color:'#dc2626',textTransform:'uppercase',letterSpacing:1}}>Richardson</span>
              {rsSearching&&<span style={{fontSize:10,color:'#f87171'}}>Searching...</span>}
              {!rsSearching&&rsResults.length>0&&<span style={{fontSize:10,color:'#dc2626'}}>{rsResults.length} style{rsResults.length!==1?'s':''}</span>}
            </div>
            {rsResults.slice(0,10).map((rs,ri)=>{const eKey='rs-'+ri;const isExp=expandedStyle===eKey;return<div key={'rs'+ri}>
              <div style={{padding:'8px 12px',borderBottom:'1px solid #fef2f2',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isExp?'#fecaca':ri%2===0?'#fff5f5':'white'}} onClick={()=>setExpandedStyle(isExp?null:eKey)}>
                {rs.styleImage?<img src={rs.styleImage} alt="" style={{width:32,height:32,objectFit:'contain',borderRadius:4,background:'#f8fafc'}} onError={e=>{e.target.style.display='none'}}/>:<div style={{width:32,height:32,borderRadius:4,background:'#fecaca',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#dc2626',fontWeight:700,flexShrink:0}}>RS</div>}
                <span style={{fontFamily:'monospace',fontWeight:700,color:'#dc2626',background:'#fecaca',padding:'2px 6px',borderRadius:3,fontSize:12}}>{rs.sku}</span>
                <span style={{fontWeight:600,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{rs.styleName}</span>
                <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#fecaca',color:'#b91c1c',fontWeight:600}}>Richardson</span>
                <span style={{fontSize:10,color:'#ef4444'}}>{rs.colors.length} color{rs.colors.length!==1?'s':''}</span>
                <span style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                  <span style={{fontSize:12,color:'#dc2626',fontWeight:700}} title={rs._rsPriceSource==='level4'?'Richardson Level 4 dealer price':rs._rsPriceSource==='catalog'?'NSA catalog cost':''}>{rs.customerPrice>0?`from $${rs.customerPrice.toFixed(2)}${rs._rsPriceSource==='level4'?' L4':''}`:(rs._rsCatalogMatch?'Price TBD':'New — set cost')}</span>
                  <span style={{fontSize:9,color:rs.totalQty>0?'#dc2626':'#94a3b8',fontWeight:600}}>{rs.totalQty>0?rs.totalQty.toLocaleString()+' avail':'Out of stock'}</span>
                </span>
                <span style={{fontSize:12,color:'#dc2626'}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&(()=>{const fc=filterExpColors(rs.colors);return<div style={{background:'#fff5f5',borderBottom:'2px solid #fca5a5',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {rs.colors.length>6&&expColorSearchInput('#fca5a5')}
                {fc.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #fca5a5',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(rs,c,'rs')} title={c.colorName+(c.totalQty>0?' — '+c.totalQty.toLocaleString()+' avail':' — out of stock')+(c.nextAvail?' • next '+c.nextAvail:'')}>
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:140}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:8,color:c.totalQty>0?'#16a34a':'#dc2626',fontWeight:700}}>{c.totalQty>0?c.totalQty.toLocaleString():'OOS'}</span>
                  {c.nextAvail&&<span style={{fontSize:8,color:'#b45309'}}>↻{c.nextAvail.slice(0,5)}</span>}
                </div>)}
                {fc.length===0&&expColorNoMatch}
              </div>})()}
            </div>})}
            {!rsSearching&&rsResults.length===0&&pS.length>=2&&<div style={{padding:'10px 12px',color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>No Richardson results for "{pS}"</div>}
          </>}
        </div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([])}} style={{marginTop:8}}>Cancel</button>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([]);setRsResults([]);setShowCustom(true)}} style={{marginTop:8,marginLeft:4}}>+ Custom Item</button></div>}
    </div></div>
    {showCustom&&<div className="card" style={{marginTop:8,borderLeft:'3px solid #d97706'}}><div style={{padding:'14px 18px'}}>
      <div style={{fontWeight:700,marginBottom:8}}>✏️ Custom Item {custItem.name&&<span style={{fontWeight:400,fontSize:12,color:'#64748b'}}>— {custItem.name}</span>}</div>
      <div style={{display:'grid',gridTemplateColumns:'120px 1fr 120px',gap:8,marginBottom:8}}>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Brand / Vendor</label><SearchSelect options={vendorList.map(v=>({value:v.id,label:v.name}))} value={custItem.vendor_id} onChange={vid=>{const vn=vendorList.find(v=>v.id===vid)?.name||'';setCustItem(x=>({...x,vendor_id:vid,brand:vn}))}} placeholder="Search vendors..."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Item Name</label><input className="form-input" value={custItem.name} onChange={e=>setCustItem(x=>({...x,name:e.target.value}))} placeholder="Custom jersey, special order hat, etc."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Color</label><input className="form-input" value={custItem.color} onChange={e=>setCustItem(x=>({...x,color:e.target.value}))} placeholder="Navy"/></div></div>

      {/* Item Type selector — Apparel / Footwear / OSFA */}
      <div style={{marginBottom:8}}>
        <label style={{fontSize:10,fontWeight:600,color:'#64748b',display:'block',marginBottom:4}}>Item Type</label>
        <div style={{display:'inline-flex',gap:4,padding:3,background:'#f1f5f9',borderRadius:6,border:'1px solid #e2e8f0'}}>
          {[{k:'apparel',l:'👕 Apparel',d:'Standard S/M/L/XL/2XL sizing'},
            {k:'footwear',l:'👟 Footwear',d:'Shoe sizes 6–17'},
            {k:'osfa',l:'🧢 OSFA',d:'One size fits all (no size grid)'}].map(o2=>{
            const sel=(custItem.item_type||'apparel')===o2.k;
            return<button key={o2.k} type="button" title={o2.d} onClick={()=>setCustItem(x=>{const nx={...x,item_type:o2.k};
              const brand=vendorList.find(v=>v.id===x.vendor_id)?.name||'';
              const fw=o2.k==='footwear';
              if(isAU(brand)&&safeNum(x.retail_price)>0){
                const mult=fw?(brand==='Adidas'?0.55*0.75:0.55*0.85):(brand==='Adidas'?0.375:0.425);
                nx.nsa_cost=Math.floor(x.retail_price*mult*100)/100;
                nx.unit_sell=rQ(x.retail_price*(1-auDisc(fw,x.pricing_group)));
              }
              return nx;
            })} style={{padding:'5px 12px',fontSize:11,fontWeight:700,borderRadius:4,border:'none',cursor:'pointer',
              background:sel?'white':'transparent',color:sel?'#0f172a':'#64748b',
              boxShadow:sel?'0 1px 2px rgba(0,0,0,0.08)':'none'}}>{o2.l}</button>;
          })}
        </div>
      </div>

      {/* Pricing section — brand-aware */}
      {(()=>{const brandName=vendorList.find(v=>v.id===custItem.vendor_id)?.name||'';const au=isAU(brandName);const isFw=custItem.item_type==='footwear';const tier=cust?.adidas_ua_tier||'B';const disc=auDisc(isFw,custItem.pricing_group);const mk=o.default_markup||1.65;
        return<>
          <div style={{padding:8,background:au?'#eff6ff':'#f8fafc',borderRadius:6,marginBottom:8,fontSize:11}}>
            {au?<><strong>💎 {brandName} {isFw?'Footwear':'Apparel'} — Tier {tier}:</strong> Cost = Retail × {isFw?(brandName==='Adidas'?'0.55 × 0.75 (41.25%)':'0.55 × 0.85 (46.75%)'):(brandName==='Adidas'?'0.5 × 0.75 (37.5%)':'0.5 × 0.85 (42.5%)')}. Sell = Retail × {Math.round((1-disc)*100)}%.</>
                :<><strong>📦 Standard Pricing:</strong> Cost × {mk}x markup = Sell price. {brandName?'Brand: '+brandName:'Select brand above.'}</>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'100px 100px 100px 100px 1fr',gap:8,marginBottom:8,alignItems:'end'}}>
            <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>SKU</label><input className="form-input" value={custItem.sku} onChange={e=>setCustItem(x=>({...x,sku:e.target.value}))}/></div>
            {au&&<div><label style={{fontSize:10,fontWeight:600,color:'#1e40af'}}>Retail $</label><$In value={custItem.retail_price||0} onChange={v=>{const costMult=isFw?(brandName==='Adidas'?0.55*0.75:0.55*0.85):(brandName==='Adidas'?0.375:0.425);const cost=Math.floor(v*costMult*100)/100;const sell=rQ(v*(1-disc));setCustItem(x=>({...x,retail_price:v,nsa_cost:cost,unit_sell:sell}))}}/></div>}
            <div><label style={{fontSize:10,fontWeight:600,color:au?'#64748b':'#166534'}}>{au?'Cost (auto)':'Cost $'}</label><$In value={custItem.nsa_cost} onChange={v=>{const sell=au?v:rQ(v*mk);setCustItem(x=>({...x,nsa_cost:v,...(!au&&{unit_sell:sell})}))}}/></div>
            <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Sell $</label><$In value={custItem.unit_sell} onChange={v=>setCustItem(x=>({...x,unit_sell:v}))}/></div>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              {custItem.nsa_cost>0&&<span style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>
                {au&&custItem.nsa_cost>0&&custItem.unit_sell>0?Math.round((custItem.unit_sell-custItem.nsa_cost)/custItem.unit_sell*100)+'% margin':custItem.nsa_cost>0?(custItem.unit_sell/custItem.nsa_cost).toFixed(2)+'x markup':''}
                {custItem.unit_sell>custItem.nsa_cost&&<span style={{color:'#166534',marginLeft:4}}>(${rQ(custItem.unit_sell-custItem.nsa_cost).toFixed(2)} margin)</span>}
              </span>}
            </div></div>
        </>})()}
      {/* Image Upload Section */}
      <div style={{marginBottom:10,padding:10,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#475569',marginBottom:6}}>Product Images <span style={{fontWeight:400,color:'#94a3b8'}}>(for art mocks & catalog)</span></div>
        <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
          <div style={{flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:600,color:'#64748b',marginBottom:2}}>Front Image</div>
            {custItem.image_url?<img src={custItem.image_url} alt="" style={{width:72,height:72,objectFit:'contain',borderRadius:6,border:'1px solid #e2e8f0',background:'white'}}/>
            :<div style={{width:72,height:72,borderRadius:6,background:'#f1f5f9',border:'2px dashed #cbd5e1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#94a3b8',cursor:'pointer',textAlign:'center'}} onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.onchange=async()=>{if(inp.files[0]){try{const u=await fileUpload(inp.files[0],'nsa-products');setCustItem(x=>({...x,image_url:u}))}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}>Click to upload</div>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:9,fontWeight:600,color:'#64748b',marginBottom:2}}>Additional Images</div>
            <ImgGallery images={custItem.images||[]} onUpdate={imgs=>setCustItem(x=>({...x,images:imgs}))} onError={e=>nf(e,'error')} maxImages={5}/>
          </div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <button className="btn btn-primary" disabled={!custItem.name} onClick={()=>{const brandName=vendorList.find(v=>v.id===custItem.vendor_id)?.name||'Custom';
          const itType=custItem.item_type||'apparel';
          const availSz=itType==='footwear'?[...FOOTWEAR_DEFAULT_SIZES]:itType==='osfa'?['OSFA']:['S','M','L','XL','2XL'];
          const newItem={product_id:null,sku:custItem.sku||'CUSTOM',name:custItem.name,brand:brandName,vendor_id:custItem.vendor_id,color:custItem.color,nsa_cost:custItem.nsa_cost,retail_price:custItem.retail_price||0,unit_sell:custItem.unit_sell,available_sizes:availSz,sizes:{},qty_only:false,decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:null}]:[],is_custom:true,is_footwear:itType==='footwear',image_url:custItem.image_url||'',images:custItem.images||[]};
          if(custItem.saveToCatalog&&onSaveProduct&&custItem.sku&&custItem.sku!=='CUSTOM'){
            const catCategory=itType==='footwear'?'Footwear':itType==='osfa'?'Hats':'Tees';
            const newProd={id:'p'+Date.now(),vendor_id:custItem.vendor_id||null,sku:custItem.sku,name:custItem.name,brand:brandName,color:custItem.color||'',
              category:catCategory,retail_price:custItem.retail_price||0,nsa_cost:custItem.nsa_cost||0,available_sizes:availSz,is_active:true,_inv:{},image_url:custItem.image_url||'',back_image_url:'',images:custItem.images||[]};
            onSaveProduct(newProd);newItem.product_id=newProd.id;nf('Item saved to product catalog')}
          sv('items',[...o.items,newItem]);
          setShowCustom(false);setCustItem({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:'',saveToCatalog:false,image_url:'',images:[],item_type:'apparel'})}}>Add Item</button>
        <button className="btn btn-secondary" onClick={()=>setShowCustom(false)}>Cancel</button>
        {onSaveProduct&&<label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,color:'#475569',marginLeft:8}}>
          <input type="checkbox" checked={custItem.saveToCatalog||false} onChange={e=>setCustItem(x=>({...x,saveToCatalog:e.target.checked}))} style={{width:14,height:14}}/>
          Save to product catalog {custItem.saveToCatalog&&(!custItem.sku||custItem.sku==='CUSTOM')&&<span style={{color:'#d97706',fontSize:10}}>(enter a SKU first)</span>}
        </label>}</div>
    </div></div>}

    {/* BUILD WITH AI WIZARD */}
    {aiBuild&&<div className="modal-overlay" onClick={()=>!aiBuild.loading&&setAiBuild(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:900,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header" style={{background:'linear-gradient(135deg,#ede9fe,#dbeafe)'}}><h2>✨ Build with AI</h2><button className="modal-close" onClick={()=>!aiBuild.loading&&setAiBuild(null)}>×</button></div>
      <div className="modal-body">

      {/* STEP 1: Choose input + submit */}
      {aiBuild.step==='input'&&<>
        <div style={{fontSize:12,color:'#64748b',marginBottom:10}}>
          Paste the coach's order, upload screenshot(s), or paste a Google Sheets link. Claude will read it and pull out the line items — you'll review before anything is added.
        </div>
        <div style={{display:'flex',gap:4,marginBottom:10,borderBottom:'1px solid #e2e8f0'}}>
          {[['text','📝 Paste Text'],['image','📷 Upload Image'],['url','🔗 Sheets / URL']].map(([k,label])=>
            <button key={k} onClick={()=>setAiBuild(x=>({...x,inputMode:k,error:null}))}
              style={{padding:'8px 14px',fontSize:12,fontWeight:600,border:'none',background:'none',cursor:'pointer',
                borderBottom:aiBuild.inputMode===k?'2px solid #7c3aed':'2px solid transparent',
                color:aiBuild.inputMode===k?'#7c3aed':'#64748b'}}>{label}</button>)}
        </div>

        {aiBuild.inputMode==='text'&&<textarea className="form-input" rows={14} value={aiBuild.text}
          onChange={e=>setAiBuild(x=>({...x,text:e.target.value}))}
          placeholder={"Paste whatever the coach sent. Examples:\n\nTechfit Sleeveless Tee (Black) JY6033\nS/40  M/60  L/60  XL/60  2XL/15  3XL/15\n\nM Everyday Pro Reversible (Black) JM5094\nSizing S/50  M/50  L/50  XL/30  2XL/15"}
          style={{fontFamily:'monospace',fontSize:12}}/>}

        {aiBuild.inputMode==='image'&&<div>
          <input type="file" accept="image/*" multiple onChange={async e=>{
            const files=Array.from(e.target.files||[]);
            const imgs=await Promise.all(files.map(f=>new Promise(res=>{const r=new FileReader();r.onload=()=>res({name:f.name,dataUrl:r.result});r.readAsDataURL(f)})));
            setAiBuild(x=>({...x,images:[...(x.images||[]),...imgs]}));
          }} style={{marginBottom:8}}/>
          <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Tip: you can also drop an image directly here, or paste from clipboard.</div>
          <div onDragOver={e=>{e.preventDefault();e.stopPropagation()}} onDrop={async e=>{
              e.preventDefault();e.stopPropagation();
              const files=Array.from(e.dataTransfer.files||[]).filter(f=>f.type.startsWith('image/'));
              if(files.length===0)return;
              const imgs=await Promise.all(files.map(f=>new Promise(res=>{const r=new FileReader();r.onload=()=>res({name:f.name,dataUrl:r.result});r.readAsDataURL(f)})));
              setAiBuild(x=>({...x,images:[...(x.images||[]),...imgs]}));
            }} onPaste={async e=>{
              const items=Array.from(e.clipboardData?.items||[]).filter(it=>it.type.startsWith('image/'));
              if(items.length===0)return;
              const imgs=await Promise.all(items.map(it=>new Promise(res=>{const f=it.getAsFile();const r=new FileReader();r.onload=()=>res({name:f.name||'pasted.png',dataUrl:r.result});r.readAsDataURL(f)})));
              setAiBuild(x=>({...x,images:[...(x.images||[]),...imgs]}));
            }} tabIndex={0}
            style={{border:'2px dashed #c4b5fd',borderRadius:8,padding:20,minHeight:120,background:'#faf5ff',textAlign:'center',color:'#7c3aed',fontSize:12,fontWeight:600,outline:'none',cursor:'text'}}>
            {(aiBuild.images||[]).length===0?'Drop or paste images here':`${aiBuild.images.length} image(s) attached`}
          </div>
          {(aiBuild.images||[]).length>0&&<div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
            {aiBuild.images.map((im,i)=><div key={i} style={{position:'relative',border:'1px solid #e2e8f0',borderRadius:6,padding:4}}>
              <img src={im.dataUrl} alt={im.name} style={{maxWidth:120,maxHeight:120,display:'block'}}/>
              <button onClick={()=>setAiBuild(x=>({...x,images:x.images.filter((_,ii)=>ii!==i)}))}
                style={{position:'absolute',top:2,right:2,background:'#fee2e2',border:'none',borderRadius:'50%',width:18,height:18,cursor:'pointer',fontSize:11,color:'#991b1b'}}>×</button>
            </div>)}
          </div>}
          <textarea className="form-input" rows={3} value={aiBuild.text} placeholder="Optional: additional notes for Claude (e.g. 'youth sizes', 'add 2 of each for staff')"
            onChange={e=>setAiBuild(x=>({...x,text:e.target.value}))} style={{marginTop:8,fontSize:12}}/>
        </div>}

        {aiBuild.inputMode==='url'&&<div>
          <input className="form-input" type="url" value={aiBuild.url} onChange={e=>setAiBuild(x=>({...x,url:e.target.value}))}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..." style={{fontSize:12}}/>
          <div style={{fontSize:11,color:'#64748b',marginTop:6}}>
            Google Sheets must be shared as "Anyone with the link can view" so the server can read it. For private sheets, switch to "Paste Text" and copy the rows in.
          </div>
        </div>}

        {aiBuild.error&&<div style={{marginTop:10,padding:8,background:'#fef2f2',borderRadius:6,fontSize:11,color:'#991b1b'}}>⚠ {aiBuild.error}</div>}

        <div style={{marginTop:14,display:'flex',gap:8,alignItems:'center'}}>
          <button className="btn btn-primary" disabled={aiBuild.loading||(
              (aiBuild.inputMode==='text'&&!aiBuild.text.trim())||
              (aiBuild.inputMode==='image'&&(aiBuild.images||[]).length===0)||
              (aiBuild.inputMode==='url'&&!aiBuild.url.trim()))}
            style={{background:'#7c3aed',borderColor:'#6d28d9'}}
            onClick={async()=>{
              if(!supabase){setAiBuild(x=>({...x,error:'Supabase not configured'}));return}
              setAiBuild(x=>({...x,loading:true,error:null,statusMsg:'Sending to Claude…'}));
              try{
                const catalog=(products||[]).map(p=>({id:p.id,sku:p.sku,name:p.name,brand:p.brand,color:p.color,available_sizes:p.available_sizes}));
                const payload={
                  input_type:aiBuild.inputMode,
                  text:aiBuild.text||'',
                  image_data_urls:(aiBuild.images||[]).map(i=>i.dataUrl),
                  url:aiBuild.url||'',
                  catalog,
                  estimate_id:isE?o.id:null,
                  so_id:isSO?o.id:null,
                };
                // Rotating status messages while we wait — gives the user
                // a "still working" signal even though we don't yet stream
                // real progress from the edge function.
                const statuses=aiBuild.inputMode==='image'
                  ?['Reading the image…','Identifying products…','Matching SKUs to catalog…','Almost done…']
                  :aiBuild.inputMode==='url'
                  ?['Fetching the sheet…','Reading the order…','Matching SKUs to catalog…','Almost done…']
                  :['Reading the order…','Pulling out line items…','Matching SKUs to catalog…','Almost done…'];
                let si=0;
                const ticker=setInterval(()=>{si=(si+1)%statuses.length;setAiBuild(x=>x&&x.loading?{...x,statusMsg:statuses[si]}:x)},3500);
                let d;
                try{d=await invokeEdgeFn(supabase,'ai-order-builder',payload)}
                finally{clearInterval(ticker)}
                if(!d?.ok){setAiBuild(x=>({...x,loading:false,statusMsg:null,error:d?.error||'AI parse failed'}));return}
                let lines=(d.lines||[]).map(l=>({...l,_skip:false}));
                // Vendor enrichment: for SKUs we couldn't match in our internal
                // catalog, fan out to SanMar / S&S / Momentec in parallel for
                // pricing + product names. Keeps the loading bar up.
                const unmatchedCount=lines.filter(l=>!l.product_id&&(l.sku_guess||'').trim()).length;
                if(unmatchedCount>0){
                  setAiBuild(x=>({...x,statusMsg:'Looking up '+unmatchedCount+' SKU'+(unmatchedCount===1?'':'s')+' in vendor catalogs…'}));
                  try{lines=await enrichAiLinesWithVendors(lines,(done,total)=>setAiBuild(x=>({...x,statusMsg:'Vendor lookup: '+done+'/'+total+'…'})))}
                  catch(e){console.warn('[aiBuild] vendor enrichment failed:',e)}
                }
                setAiBuild(x=>({...x,loading:false,statusMsg:null,step:'review',parsed:lines,warnings:d.warnings||[],build_id:d.build_id||null}));
              }catch(err){
                console.error('[aiBuild] parse error:',err);
                setAiBuild(x=>({...x,loading:false,statusMsg:null,error:'Unexpected error: '+(err?.message||String(err))}));
              }
            }}>{aiBuild.loading?'🤖 Working…':'✨ Parse with AI'}</button>
          <button className="btn btn-secondary" disabled={aiBuild.loading} onClick={()=>setAiBuild(null)}>Cancel</button>
        </div>
        {aiBuild.loading&&<div style={{marginTop:10}}>
          <div style={{height:6,background:'#ede9fe',borderRadius:3,overflow:'hidden',position:'relative'}}>
            <div style={{position:'absolute',top:0,bottom:0,width:'30%',background:'linear-gradient(90deg,#a78bfa,#7c3aed,#a78bfa)',borderRadius:3,animation:'aiBuildSlide 1.4s infinite ease-in-out'}}/>
          </div>
          <div style={{marginTop:6,fontSize:11,color:'#7c3aed',fontWeight:600}}>{aiBuild.statusMsg||'Working…'} <span style={{color:'#94a3b8',fontWeight:400}}>(typically 5–20s)</span></div>
          <style>{`@keyframes aiBuildSlide{0%{left:-30%}50%{left:50%}100%{left:100%}}`}</style>
        </div>}
      </>}

      {/* STEP 2: Review parsed items */}
      {aiBuild.step==='review'&&<>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <div style={{padding:8,background:'#f0fdf4',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:'#166534'}}>{aiBuild.parsed.length}</div><div style={{fontSize:10,color:'#64748b'}}>Items Parsed</div></div>
          <div style={{padding:8,background:'#ede9fe',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:'#7c3aed'}}>{aiBuild.parsed.filter(p=>p.product_id).length}</div><div style={{fontSize:10,color:'#64748b'}}>Catalog Matches</div></div>
          <div style={{padding:8,background:aiBuild.parsed.some(p=>p.vendor_source)?'#dbeafe':'#f8fafc',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:aiBuild.parsed.some(p=>p.vendor_source)?'#1e40af':'#94a3b8'}}>{aiBuild.parsed.filter(p=>p.vendor_source).length}</div><div style={{fontSize:10,color:'#64748b'}}>Vendor Matches</div></div>
          <div style={{padding:8,background:aiBuild.parsed.some(p=>!p.product_id&&!p.vendor_source)?'#fffbeb':'#f8fafc',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:aiBuild.parsed.some(p=>!p.product_id&&!p.vendor_source)?'#d97706':'#94a3b8'}}>{aiBuild.parsed.filter(p=>!p.product_id&&!p.vendor_source).length}</div><div style={{fontSize:10,color:'#64748b'}}>Unmatched</div></div>
        </div>

        {(aiBuild.warnings||[]).length>0&&<div style={{marginBottom:8,padding:8,background:'#fef3c7',borderRadius:6}}>
          <div style={{fontSize:11,fontWeight:700,color:'#92400e',marginBottom:4}}>⚠️ Warnings from Claude</div>
          {aiBuild.warnings.map((w,i)=><div key={i} style={{fontSize:10,color:'#92400e'}}>{w}</div>)}
        </div>}

        <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:6}}>📦 Parsed Items — Review & Edit</div>
        <div style={{maxHeight:380,overflow:'auto',border:'1px solid #e2e8f0',borderRadius:6}}>
          <table style={{fontSize:11}}><thead><tr><th style={{width:30}}>✓</th><th>SKU</th><th>Match</th><th>Name</th><th>Brand</th><th>Color</th><th>Sizes</th><th>Qty</th><th>Notes</th></tr></thead>
          <tbody>{aiBuild.parsed.map((it,i)=>{
            const toggle=()=>setAiBuild(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,_skip:!p._skip}:p)}));
            const upd=(k,v)=>setAiBuild(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,[k]:v}:p)}));
            const mq=it.match_quality;
            const isVendor=typeof mq==='string'&&mq.startsWith('vendor_');
            const vendorName=isVendor?mq.slice('vendor_'.length):null;
            const vendorLabel=vendorName==='sanmar'?'🟦 SanMar':vendorName==='ss'?'🟪 S&S':vendorName==='momentec'?'🟧 Momentec':null;
            const mqLabel=vendorLabel||(mq==='exact'?'✓ Exact':mq==='stripped'?'✓ Trimmed':mq==='fuzzy_name'?'~ Fuzzy':mq==='no_sku'?'? No SKU':'✗ Unmatched');
            const mqColor=isVendor?'#1e40af':(mq==='exact'||mq==='stripped'?'#166534':mq==='fuzzy_name'?'#d97706':'#dc2626');
            const mqBg=isVendor?'#dbeafe':(mq==='exact'||mq==='stripped'?'#dcfce7':mq==='fuzzy_name'?'#fef3c7':'#fee2e2');
            const hasResolved=!!it.product_id||isVendor;
            return<tr key={i} style={{opacity:it._skip?0.4:1,background:!hasResolved?'#fffbeb':'white'}}>
              <td><input type="checkbox" checked={!it._skip} onChange={toggle}/></td>
              <td><input className="form-input" value={it.sku_guess||''} onChange={e=>upd('sku_guess',e.target.value)} style={{width:90,fontSize:10,fontFamily:'monospace'}}/></td>
              <td><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:mqBg,color:mqColor,fontWeight:700,whiteSpace:'nowrap'}}>{mqLabel}</span>
                {it.confidence&&!isVendor&&!it.product_id&&<div style={{fontSize:8,color:'#64748b',marginTop:2}}>conf: {it.confidence}</div>}</td>
              <td style={{maxWidth:180}}><input className="form-input" value={it.name||''} onChange={e=>upd('name',e.target.value)} style={{width:'100%',fontSize:10}}/></td>
              <td><input className="form-input" value={it.brand||''} onChange={e=>upd('brand',e.target.value)} style={{width:70,fontSize:10}}/></td>
              <td><input className="form-input" value={it.color||''} onChange={e=>upd('color',e.target.value)} style={{width:80,fontSize:10}}/></td>
              <td style={{fontSize:9}}>{Object.entries(it.sizes||{}).map(([s,q])=>s+':'+q).join(', ')}</td>
              <td style={{textAlign:'center',fontWeight:700}}>{it.total_qty||Object.values(it.sizes||{}).reduce((a,b)=>a+(+b||0),0)}</td>
              <td style={{maxWidth:160}}>
                {it.notes&&<div style={{fontSize:9,color:'#64748b'}}>{it.notes}</div>}
                {it.raw_line&&<div style={{fontSize:8,color:'#94a3b8',fontStyle:'italic',marginTop:2,maxHeight:30,overflow:'hidden'}}>"{it.raw_line.slice(0,80)}"</div>}
              </td>
            </tr>})}</tbody></table>
        </div>

        <div style={{marginTop:8,padding:8,background:'#f8fafc',borderRadius:6,fontSize:11,color:'#64748b'}}>
          💡 Unmatched items will be added as custom items — you can fix the SKU here or in the order, and pricing will pull from the catalog when matched.
        </div>

        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setAiBuild(x=>({...x,step:'input'}))}>← Back</button>
          <button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#6d28d9'}} onClick={()=>{
            const keeping=aiBuild.parsed.filter(p=>!p._skip);
            const newItems=keeping.map(p=>{
              const sku=(p.sku_guess||'').trim();
              const catMatch=p.product_id?products.find(pr=>pr.id===p.product_id):
                (sku?(products.find(pr=>pr.sku===sku)||products.find(pr=>pr.sku.toLowerCase()===sku.toLowerCase())):null);
              const brand=catMatch?.brand||p.brand||'';
              const au=isAU(brand);
              const cost=catMatch?.nsa_cost||p.vendor_price||0;
              const retail=catMatch?.retail_price||p.vendor_retail||0;
              const isFw=(catMatch?.category||'').toLowerCase()==='footwear';
              const sell=au
                ?rQ(retail*(1-auDisc(isFw,catMatch?.pricing_group)))
                :rQ(cost*(o.default_markup||1.65));
              const szKeys=Object.keys(p.sizes||{});
              return{
                product_id:catMatch?.id||null,
                sku:sku||'CUSTOM',
                name:catMatch?.name||p.name||'',
                brand,
                color:catMatch?.color||p.color||'',
                nsa_cost:cost,
                retail_price:retail,
                unit_sell:sell,
                available_sizes:szKeys.length>0?szKeys:(catMatch?.available_sizes||['S','M','L','XL','2XL']),
                sizes:p.sizes||{},
                decorations:[],
                is_custom:!catMatch&&!p.vendor_source,
                vendor_source:p.vendor_source||null,
                pick_lines:[],
                po_lines:[],
              };
            });
            sv('items',[...o.items,...newItems]);
            // Best-effort: record accepted lines on the audit row
            if(supabase&&aiBuild.build_id){
              try{supabase.from('ai_order_builds').update({accepted_lines:keeping,accepted_count:keeping.length}).eq('id',aiBuild.build_id)}catch(_){}
            }
            setAiBuild(null);
            nf('✨ Imported '+newItems.length+' items from AI');
          }}>✅ Import {aiBuild.parsed.filter(p=>!p._skip).length} Items</button>
        </div>
      </>}
      </div>
    </div></div>}
    </>;
    })()}

    {/* ART LIBRARY TAB */}
    {tab==='art'&&<div className="card"><div className="card-header"><h2>Art Library</h2><div style={{display:'flex',gap:6}}>{dirty&&<button className="btn btn-sm btn-primary" onClick={()=>{const updated={...o,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSaved(true);nf('Art saved')}} style={{background:'#166534',borderColor:'#166534'}}>Save</button>}<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',border:'none',fontSize:11}} onClick={()=>setShowPrevArt(true)}>📂 Previous Artwork</button><button className="btn btn-sm btn-primary" onClick={addArt}><Icon name="plus" size={12}/> New Art Group</button></div></div>
      <div className="card-body">{af.length===0?<div className="empty">No art uploaded. Create art groups and add files.</div>:
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {af.map((art,i)=>{const usedIn=safeItems(o).reduce((a,it)=>a+safeDecos(it).filter(d=>d.art_file_id===art.id).length,0);
            const afSt=art.status==='uploaded'?'needs_approval':art.status||'waiting_for_art';
            const isCollapsed=!expandedArt[art.id];
            return(<div key={art.id} style={{padding:0,background:'#f8fafc',borderRadius:8,border:afSt==='approved'?'2px solid #22c55e':afSt==='needs_approval'?'2px solid #f59e0b':'1px solid #e2e8f0'}}>
              {/* Collapsible header */}
              <div style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',cursor:'pointer',userSelect:'none'}} onClick={()=>setExpandedArt(prev=>({...prev,[art.id]:!prev[art.id]}))}>
                <span style={{fontSize:12,color:'#64748b',transition:'transform 0.2s',transform:isCollapsed?'rotate(-90deg)':'rotate(0deg)',flexShrink:0}}>▼</span>
                <div style={{width:36,height:36,borderRadius:6,flexShrink:0,overflow:'hidden',border:'1px solid #e2e8f0',background:art.preview_url?'white':art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':art.deco_type==='dtf'?'#fef3c7':'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {art.preview_url?<img src={art.preview_url} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :<span style={{fontSize:16}}>{art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':art.deco_type==='dtf'?'🔥':'#️⃣'}</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontWeight:700,fontSize:14}}>{art.name||'Untitled'}</span>
                  <span style={{fontSize:11,color:'#64748b',marginLeft:8}}>{(art.deco_type||'').replace(/_/g,' ')}{art.art_size?' · '+art.art_size:''} · {usedIn} deco(s)</span>
                </div>
                <span style={{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600,flexShrink:0,background:ART_FILE_SC[art.status]?.bg||ART_FILE_SC.waiting_for_art.bg,color:ART_FILE_SC[art.status]?.c||ART_FILE_SC.waiting_for_art.c}}>{art.status==='approved'?'Approved':art.status==='needs_approval'?'Needs Approval':'Waiting'}</span>
                <button className="btn btn-sm btn-secondary" style={{fontSize:10,flexShrink:0}} onClick={e=>{e.stopPropagation();rmArt(i)}}><Icon name="trash" size={10}/></button>
              </div>
              {/* Collapsible body */}
              {!isCollapsed&&<div style={{padding:'0 14px 14px 14px'}}>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:64,height:64,borderRadius:8,flexShrink:0,position:'relative',cursor:'pointer',overflow:'hidden',border:'1px solid #e2e8f0',background:art.preview_url?'white':art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':art.deco_type==='dtf'?'#fef3c7':'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center'}}
                  onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.png,.jpg,.jpeg,.webp';inp.onchange=async()=>{const f=inp.files[0];if(!f)return;nf('Uploading preview...');try{const url=await fileUpload(f,'nsa-art-previews');uArt(i,'preview_url',url);nf('Preview uploaded')}catch(e){nf('Upload failed: '+e.message,'error')}};inp.click()}}
                  title={art.preview_url?'Click to change preview image':'Click to upload preview image'}>
                  {art.preview_url?<img src={art.preview_url} alt="Preview" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :<div style={{textAlign:'center'}}><div style={{fontSize:20}}>{art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':art.deco_type==='dtf'?'🔥':'#️⃣'}</div><div style={{fontSize:7,color:'#94a3b8',fontWeight:600}}>+ Preview</div></div>}
                  {art.preview_url&&<button onClick={e=>{e.stopPropagation();uArt(i,'preview_url','')}} style={{position:'absolute',top:1,right:1,background:'rgba(0,0,0,0.5)',color:'white',border:'none',borderRadius:'50%',width:14,height:14,fontSize:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>×</button>}
                </div>
                <div style={{flex:1}}>
                  {/* Name + Status */}
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}>
                    <input className="form-input" value={art.name} onChange={e=>uArt(i,'name',e.target.value)} placeholder="Art group name..." style={{fontWeight:700,fontSize:14,flex:1}} onClick={e=>e.stopPropagation()}/>
                    <select style={{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600,flexShrink:0,border:'1px solid #e2e8f0',background:ART_FILE_SC[art.status]?.bg||ART_FILE_SC.waiting_for_art.bg,color:ART_FILE_SC[art.status]?.c||ART_FILE_SC.waiting_for_art.c,cursor:'pointer'}} value={art.status==='uploaded'?'needs_approval':art.status} onChange={e=>uArt(i,'status',e.target.value)}>
                      <option value="waiting_for_art">Waiting for Art</option><option value="needs_approval">Needs Approval</option><option value="approved">Approved / Needs Files</option>
                    </select>
                  </div>
                  {/* Decoration Type */}
                  <div style={{marginBottom:6}}><span style={{fontSize:11,fontWeight:600,color:'#64748b',marginRight:6}}>Type:</span>
                    <Bg options={[{value:'screen_print',label:'Screen Print'},{value:'embroidery',label:'Embroidery'},{value:'dtf',label:'DTF'}]} value={art.deco_type} onChange={v=>uArt(i,'deco_type',v)}/></div>
                  {/* Size */}
                  <div style={{display:'flex',gap:8,marginBottom:6,alignItems:'flex-end'}}>
                    <div style={{width:140}}><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Size (optional)</label><input className="form-input" value={art.art_size||''} onChange={e=>uArt(i,'art_size',e.target.value)} placeholder='e.g. 12" x 4"' style={{fontSize:12}}/></div>
                  </div>
                  {/* Color Ways */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#475569'}}>COLOR WAYS</span>
                      <span style={{fontSize:9,color:'#94a3b8'}}>{art.deco_type==='embroidery'?'Thread colors per garment':'Ink colors per garment'}</span>
                    </div>
                    {(art.color_ways||[]).length===0&&!art.ink_colors&&!art.thread_colors&&<div style={{fontSize:11,color:'#dc2626',marginBottom:6,fontWeight:600}}>⚠ At least one color way is required. Add one to specify ink/thread colors per garment color.</div>}
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:6}}>
                      {(art.color_ways||[]).map((cw,ci)=><div key={cw.id} style={{flex:'1 1 220px',minWidth:220,maxWidth:360,background:'white',border:'1px solid #e2e8f0',borderRadius:8,padding:10}}>
                        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#475569'}}>CW {ci+1}</span>
                          <input className="form-input" value={cw.garment_color||''} onChange={e=>{const cws=[...(art.color_ways||[])];cws[ci]={...cw,garment_color:e.target.value};uArt(i,'color_ways',cws)}} placeholder="Garment color..." style={{fontSize:11,flex:1}}/>
                          <button onClick={()=>{const cws=(art.color_ways||[]).filter((_,x)=>x!==ci);uArt(i,'color_ways',cws)}} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:2}} title="Remove CW"><Icon name="trash" size={12}/></button>
                        </div>
                        {cw.inks.map((ink,ii)=><div key={ii} style={{display:'flex',gap:4,alignItems:'center',marginBottom:3}}>
                          <span style={{fontSize:10,color:'#94a3b8',width:14,textAlign:'right'}}>{ii+1}</span>
                          {pantoneHex(ink)&&<span style={{width:12,height:12,borderRadius:2,background:pantoneHex(ink),border:'1px solid #d1d5db',flexShrink:0}}/>}
                          <input className="form-input" value={ink} onChange={e=>{const cws=[...(art.color_ways||[])];const inks=[...cw.inks];inks[ii]=e.target.value;cws[ci]={...cw,inks};uArt(i,'color_ways',cws)}} placeholder={art.deco_type==='embroidery'?'Thread color...':'Ink color...'} style={{fontSize:11,flex:1}}/>
                          <button onClick={()=>{const cws=[...(art.color_ways||[])];cws[ci]={...cw,inks:cw.inks.filter((_,x)=>x!==ii)};uArt(i,'color_ways',cws)}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}}><Icon name="x" size={10}/></button>
                        </div>)}
                        {art.deco_type==='embroidery'?<ThreadQuickPicks colors={mergeColors(cust,allCustomers,'thread_colors')} onPick={(v)=>{const cws=[...(art.color_ways||[])];const inks=[...cw.inks];const emptyIdx=inks.findIndex(x=>!x);if(emptyIdx>=0)inks[emptyIdx]=v;else inks.push(v);cws[ci]={...cw,inks};uArt(i,'color_ways',cws)}}/>
                        :<PantoneQuickPicks colors={mergeColors(cust,allCustomers,'pantone_colors')} onPick={(v)=>{const cws=[...(art.color_ways||[])];const inks=[...cw.inks];const emptyIdx=inks.findIndex(x=>!x);if(emptyIdx>=0)inks[emptyIdx]=v;else inks.push(v);cws[ci]={...cw,inks};uArt(i,'color_ways',cws)}}/>}
                        <button onClick={()=>{const cws=[...(art.color_ways||[])];cws[ci]={...cw,inks:[...cw.inks,'']};uArt(i,'color_ways',cws)}} style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'#2563eb',padding:'2px 0'}}>+ Add color</button>
                      </div>)}
                    </div>
                    <button onClick={()=>{const cws=[...(art.color_ways||[]),{id:'cw'+Date.now(),garment_color:'',inks:['']}];uArt(i,'color_ways',cws)}} style={{background:'none',border:'1px dashed #cbd5e1',borderRadius:6,cursor:'pointer',fontSize:11,color:'#475569',padding:'6px 12px',fontWeight:600}}>+ Add Color Way</button>
                  </div>
                  {/* PRODUCTION FILES — internal only */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#d97706'}}>🔧 PRODUCTION FILES</span>
                      <span style={{fontSize:9,color:'#94a3b8'}}>Internal — not shared with customer</span>
                    </div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{(art.prod_files||[]).map((fn,fi)=>{const fnUrl=typeof fn==='string'?fn:(fn?.url||'');return<span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#fef3c7',borderRadius:4,fontSize:11,cursor:isUrl(fnUrl)?'pointer':'default'}} onClick={()=>openFile(fn)} title={isUrl(fnUrl)?'Click to open':'Legacy file — re-upload'}>
                      <Icon name="file" size={10}/>{fileDisplayName(fn)}<button onClick={e=>{e.stopPropagation();uArt(i,'prod_files',(art.prod_files||[]).filter((_,x)=>x!==fi))}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>})}</div>
                    <div style={{border:'2px dashed #fde68a',borderRadius:6,padding:12,textAlign:'center',cursor:'pointer',background:'#fffbeb',transition:'all 0.15s'}}
                      onClick={()=>{const folderId=art.id;const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.ai,.eps,.dst,.png,.jpg,.jpeg';inp.multiple=true;inp.onchange=async()=>{for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');setO(e=>({...e,art_files:(e.art_files||[]).map(fa=>fa.id===folderId?{...fa,prod_files:[...(fa.prod_files||[]),{url,name:f.name}]}:fa),updated_at:new Date().toLocaleString()}));setDirty(true);nf('📎 '+f.name+' attached — click Save to keep')}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}
                      onDragOver={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fef3c7';e.currentTarget.style.borderColor='#f59e0b'}}
                      onDragLeave={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a'}}
                      onDrop={async e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a';const folderId=art.id;const files=Array.from(e.dataTransfer.files);for(const f of files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');setO(ev=>({...ev,art_files:(ev.art_files||[]).map(fa=>fa.id===folderId?{...fa,prod_files:[...(fa.prod_files||[]),{url,name:f.name}]}:fa),updated_at:new Date().toLocaleString()}));setDirty(true);nf('📎 '+f.name+' attached — click Save to keep')}catch(err){nf('Upload failed: '+err.message,'error')}}}}>
                      <div style={{fontSize:11,color:'#d97706',fontWeight:600}}><Icon name="upload" size={14}/> Drop production files here or click to browse</div>
                      <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>DST, AI seps, PDF, PNG, JPG</div></div>
                  </div>
                  {/* Notes */}
                  <input className="form-input" value={art.notes||''} onChange={e=>uArt(i,'notes',e.target.value)} placeholder="Notes..." style={{fontSize:12}}/>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginTop:6}}><span style={{fontSize:10,color:'#94a3b8'}}>Uploaded {art.uploaded} · Applied to {usedIn} decoration(s)</span></div>
                </div>
              </div>
              </div>}
            </div>)})}
          {af.length>1&&<div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#2563eb',fontWeight:600,padding:'4px 8px'}} onClick={()=>setExpandedArt({})}>Collapse All</button>
            <button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#2563eb',fontWeight:600,padding:'4px 8px'}} onClick={()=>{const all={};af.forEach(a=>all[a.id]=true);setExpandedArt(all)}}>Expand All</button>
          </div>}
        </div>}
      </div></div>}

    {/* RETAG MOCKUPS — admin tool to move legacy general mockups into per-item buckets */}
    {retagMockupModal&&(()=>{
      const ai=retagMockupModal.artIdx;const art=af[ai];if(!art)return null;
      const _gen=(art.mockup_files||art.files||[]).filter(f=>f);
      const items=safeItems(o);
      const skuList=[...new Set(items.map(it=>it.sku).filter(Boolean))];
      const _urlOf=f=>typeof f==='string'?f:(f?.url||'');
      const moveToSku=(file,sku)=>{
        const fileUrl=_urlOf(file);
        const cur=(art.mockup_files||art.files||[]);
        const newGen=cur.filter(f=>_urlOf(f)!==fileUrl);
        const tagged={...(typeof file==='string'?{url:file,name:file}:file),art_file_id:art.id,sku};
        const curBucket=(art.item_mockups||{})[sku]||[];
        const newItemMockups={...(art.item_mockups||{}),[sku]:[...curBucket,tagged]};
        const updArt=[...af];
        updArt[ai]={...art,mockup_files:newGen,item_mockups:newItemMockups};
        if(!art.mockup_files)updArt[ai].files=newGen;
        sv('art_files',updArt);
        nf('Tagged "'+(file.name||fileUrl)+'" to '+sku);
      };
      return<div className="modal-overlay" onClick={()=>setRetagMockupModal(null)}><div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2>🏷️ Retag Mockups — {art.name||'Unnamed art'}</h2><button className="modal-close" onClick={()=>setRetagMockupModal(null)}>×</button></div>
        <div className="modal-body" style={{maxHeight:520,overflowY:'auto'}}>
          {_gen.length===0?<div className="empty">No general mockups to retag — all files are already item-tagged.</div>:
          skuList.length===0?<div className="empty" style={{color:'#92400e'}}>This SO has no items yet — add line items before retagging.</div>:
          <>
            <div style={{padding:'10px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,fontSize:11,color:'#92400e',marginBottom:12}}>Move each general mockup into a specific item's bucket so it shows under the right SKU and is correctly attributed in Previous Artwork.</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {_gen.map((f,fi)=>{const url=_urlOf(f);const name=fileDisplayName(f);
                return<div key={fi} style={{display:'flex',gap:10,padding:10,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,alignItems:'center'}}>
                  {_isImgUrl(url,f)?<img src={url} alt={name} style={{width:60,height:60,objectFit:'contain',borderRadius:4,background:'white',border:'1px solid #e2e8f0',cursor:'pointer'}} onClick={()=>openFile(f)}/>:
                    <div style={{width:60,height:60,borderRadius:4,background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,cursor:'pointer'}} onClick={()=>openFile(f)}>📄</div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={name}>{name}</div>
                    <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Tag to SKU:</div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                      {skuList.map(sku=><button key={sku} className="btn btn-sm" style={{fontSize:10,padding:'3px 8px',background:'#ede9fe',color:'#6d28d9',border:'1px solid #ddd6fe',borderRadius:4,fontWeight:700,cursor:'pointer'}} onClick={()=>moveToSku(f,sku)}>{sku}</button>)}
                    </div>
                  </div>
                </div>;})}
            </div>
          </>}
        </div>
      </div></div>;
    })()}

    {/* PREVIOUS ARTWORK PICKER MODAL */}
    {showPrevArt&&(()=>{
      const custId=o.customer_id;const parentCust2=allCustomers.find(c=>c.id===custId);
      // Only cross-pollinate art from the parent account; sibling sub-accounts are segmented (e.g. OLu Basketball shouldn't see OLu Football art).
      const custIds2=parentCust2?.parent_id?[parentCust2.parent_id,custId]:[custId];
      const prevArtList=[];
      const _byKey=new Map();
      const _dedupKey=a=>(a.id||'')+'|'+(a.name||'').toLowerCase().trim()+'|'+(a.deco_type||'')+'|'+(a.art_size||'')+'|'+((a.color_ways||[]).length);
      // Merge all file buckets across sources so the offered logo always carries every mockup AND production file,
      // even if one source (e.g. a library copy saved before the seps were uploaded) is missing some.
      const _fKey=f=>typeof f==='string'?f:(f?.url||'');
      const _mergeFiles=(a=[],b=[])=>{const seen=new Set((a||[]).map(_fKey));const out=[...(a||[])];(b||[]).forEach(f=>{const k=_fKey(f);if(k&&!seen.has(k)){seen.add(k);out.push(f)}});return out};
      const _pushArt=(art,meta)=>{if(art.archived)return;const k=_dedupKey(art);
        if(_byKey.has(k)){const cur=_byKey.get(k);
          cur.prod_files=_mergeFiles(cur.prod_files,art.prod_files);
          cur.mockup_files=_mergeFiles(cur.mockup_files,art.mockup_files);
          cur.files=_mergeFiles(cur.files,art.files);
          const im={...(cur.item_mockups||{})};Object.entries(art.item_mockups||{}).forEach(([ik,arr])=>{im[ik]=_mergeFiles(im[ik],arr)});cur.item_mockups=im;
        }else{const entry={...art,prod_files:[...(art.prod_files||[])],mockup_files:[...(art.mockup_files||[])],files:[...(art.files||[])],item_mockups:{...(art.item_mockups||{})},...meta};_byKey.set(k,entry);prevArtList.push(entry)}};
      // Include customer-level art library
      custIds2.forEach(cid=>{const c=allCustomers.find(cc=>cc.id===cid);(c?.art_files||[]).forEach(art=>_pushArt(art,{_so_id:'Library',_so_memo:c.alpha_tag||c.name||''}))});
      (allOrders||[]).filter(so=>custIds2.includes(so.customer_id)&&so.id!==o.id).forEach(so=>{
        (so.art_files||[]).forEach(art=>_pushArt(art,{_so_id:so.id,_so_memo:so.memo||''}));
      });
      return<div className="modal-overlay" onClick={()=>setShowPrevArt(false)}><div className="modal" style={{maxWidth:700}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2>📂 Previous Artwork</h2><button className="modal-close" onClick={()=>setShowPrevArt(false)}>×</button></div>
        <div className="modal-body" style={{maxHeight:500,overflowY:'auto'}}>
          {prevArtList.length===0?<div className="empty">No previous artwork found for this customer</div>:
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {prevArtList.map((art,i)=>{
              const alreadyAdded=af.some(a=>a.id===art.id||(a.name===art.name&&a.deco_type===art.deco_type&&a.art_size===art.art_size));
              const previewImg=art.preview_url||'';
              // Only include actual mockup sources (not prod seps/AIs) and filter to files tagged for this art when art_file_id is present.
              const _artId=art.id;
              const _tagMatches=f=>{const fid=typeof f==='object'&&f?.art_file_id;return!fid||fid===_artId};
              const _rawMocks=[...(art.mockup_files||[]),...(art.files||[]),...Object.values(art.item_mockups||{}).flat()].filter(f=>f&&_tagMatches(f));
              const _urlOf=f=>typeof f==='string'?f:(f?.url||'');
              const _seenUrls=new Set();
              const mockups=_rawMocks.filter(f=>{const u=_urlOf(f);if(!u||_seenUrls.has(u))return false;_seenUrls.add(u);return true});
              const firstMockup=mockups.find(f=>{const u=_urlOf(f);return _isImgUrl(u,f)})||mockups[0];const imgUrl=previewImg||(firstMockup?_urlOf(firstMockup):'');
              return<div key={art.id+'-'+i} style={{padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  {imgUrl&&_isImgUrl(imgUrl)?<img src={imgUrl} alt="" style={{width:80,height:80,borderRadius:8,objectFit:'contain',flexShrink:0,cursor:'pointer',background:'white',border:'1px solid #e2e8f0'}} onClick={()=>previewImg?window.open(previewImg,'_blank'):openFile(firstMockup)}/>:
                    <div style={{width:80,height:80,borderRadius:8,background:art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0}}>{art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':'🔥'}</div>}
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14}}>{art.name||'Untitled'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{(art.deco_type||'').replace(/_/g,' ')}{(art.color_ways||[]).length>0?' · '+art.color_ways.length+' CW'+(art.color_ways.length>1?'s':''):art.ink_colors?' · '+art.ink_colors.split('\n').filter(l=>l.trim()).length+' color(s)':art.thread_colors?' · '+art.thread_colors:''}{art.art_size?' · '+art.art_size:''}</div>
                    <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{art._so_id} — {art._so_memo}</div>
                    {mockups.length>1&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                      {mockups.slice(1,5).map((f,fi)=>{const fUrl=_urlOf(f);return _isImgUrl(fUrl)?<img key={fi} src={fUrl} alt="" style={{width:48,height:48,borderRadius:4,objectFit:'contain',cursor:'pointer',background:'white',border:'1px solid #e2e8f0'}} onClick={e=>{e.stopPropagation();openFile(f)}}/>:null})}
                      {mockups.length>5&&<span style={{fontSize:10,color:'#64748b',alignSelf:'center'}}>+{mockups.length-5} more</span>}
                    </div>}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end',flexShrink:0}}>
                    {alreadyAdded?<span style={{fontSize:10,color:'#22c55e',fontWeight:600}}>Already added</span>:
                    <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>{
                      const newArt={...JSON.parse(JSON.stringify(art)),id:'af'+Date.now(),uploaded:new Date().toLocaleDateString()};
                      delete newArt._so_id;delete newArt._so_memo;
                      sv('art_files',[...af,newArt]);
                      const _pf=(newArt.prod_files||[]).length;
                      nf('Added "'+art.name+'" from '+art._so_id+(_pf?' — incl. '+_pf+' production file'+(_pf>1?'s':''):''));
                    }}>+ Add</button>}
                    {mockups.length>0&&<span style={{fontSize:10,color:'#2563eb'}}>{mockups.length} mockup(s)</span>}
                    {(art.prod_files||[]).length>0&&<span style={{fontSize:10,color:'#16a34a',fontWeight:600}}>🏭 {art.prod_files.length} prod file(s)</span>}
                  </div>
                </div>
              </div>})}
          </div>}
        </div>
      </div></div>})()}

    {/* MESSAGES TAB */}
    {tab==='messages'&&(()=>{const soMsgs=(msgs||[]).filter(m=>(m.entity_id===o.id)||(m.so_id===o.id)).sort((a,b)=>(a.ts||'').localeCompare(b.ts));const topMsgs=soMsgs.filter(m=>!m.thread_id);const getReplies=(tid)=>soMsgs.filter(m=>m.thread_id===tid);
      const DEPTS=[{id:'all',label:'All',color:'#64748b'},{id:'art',label:'Art',color:'#7c3aed'},{id:'production',label:'Production',color:'#2563eb'},{id:'warehouse',label:'Warehouse',color:'#d97706'},{id:'sales',label:'Sales',color:'#166534'},{id:'accounting',label:'Accounting',color:'#dc2626'}];
      const activeMembers=(REPS||[]).filter(r=>r.is_active!==false);
      const mentionMembers=mentionQuery!=null?activeMembers.filter(r=>r.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0,6):[];
      const renderMsgText=(text,tagged)=>{
        if(!text)return text;
        const parts=[];let last=0;
        const regex=/@(\w[\w\s]*?)(?=\s@|\s*$|[.,!?;:]|\s(?=[^@]))/g;
        let match;
        while((match=regex.exec(text))!==null){
          if(match.index>last)parts.push({type:'text',value:text.slice(last,match.index)});
          const name=match[1].trim();
          const member=activeMembers.find(r=>r.name.toLowerCase()===name.toLowerCase()||r.name.split(' ')[0].toLowerCase()===name.toLowerCase());
          if(member){parts.push({type:'mention',value:'@'+name,id:member.id})}else{parts.push({type:'text',value:match[0]})}
          last=match.index+match[0].length;
        }
        if(last<text.length)parts.push({type:'text',value:text.slice(last)});
        return parts.map((p,i)=>p.type==='mention'?<span key={i} style={{background:'#dbeafe',color:'#1e40af',fontWeight:600,borderRadius:3,padding:'0 3px'}}>{p.value}</span>:<span key={i}>{p.value}</span>);
      };
      const extractTaggedIds=(text)=>{
        const ids=[];
        const regex=/@(\w[\w\s]*?)(?=\s@|\s*$|[.,!?;:]|\s(?=[^@]))/g;
        let match;
        while((match=regex.exec(text))!==null){
          const name=match[1].trim();
          const member=activeMembers.find(r=>r.name.toLowerCase()===name.toLowerCase()||r.name.split(' ')[0].toLowerCase()===name.toLowerCase());
          if(member&&!ids.includes(member.id))ids.push(member.id);
        }
        return ids;
      };
      const insertMention=(member)=>{
        const inp=msgInputRef.current;if(!inp)return;
        const val=inp.value;const pos=inp.selectionStart;
        const before=val.slice(0,pos);const after=val.slice(pos);
        const atIdx=before.lastIndexOf('@');
        if(atIdx>=0){inp.value=before.slice(0,atIdx)+'@'+member.name+' '+after;
          const newPos=atIdx+member.name.length+2;inp.setSelectionRange(newPos,newPos)}
        setMentionQuery(null);setMentionIdx(0);inp.focus();
      };
      const handleMsgInput=(e)=>{
        const val=e.target.value;const pos=e.target.selectionStart;
        const before=val.slice(0,pos);const atIdx=before.lastIndexOf('@');
        if(atIdx>=0){const afterAt=before.slice(atIdx+1);
          if(!afterAt.includes('\n')&&afterAt.length<=30&&!/\s{2}/.test(afterAt)){setMentionQuery(afterAt);setMentionIdx(0)}
          else{setMentionQuery(null)}}
        else{setMentionQuery(null)}
      };
      const handleMsgKeyDown=(e)=>{
        if(mentionQuery!=null&&mentionMembers.length>0){
          if(e.key==='ArrowDown'){e.preventDefault();setMentionIdx(i=>(i+1)%mentionMembers.length);return}
          if(e.key==='ArrowUp'){e.preventDefault();setMentionIdx(i=>(i-1+mentionMembers.length)%mentionMembers.length);return}
          if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();insertMention(mentionMembers[mentionIdx]);return}
          if(e.key==='Escape'){setMentionQuery(null);return}
        }
        if(e.key==='Enter'&&mentionQuery==null&&e.target.value.trim()){
          const text=e.target.value.trim();
          const tagged=extractTaggedIds(text);
          const eType=isSO?'so':'estimate';
          const nm={id:'m'+Date.now(),so_id:isSO?o.id:null,author_id:cu.id,text,ts:new Date().toLocaleString(),read_by:[cu.id],dept:msgDept,tagged_members:tagged,entity_type:eType,entity_id:o.id,thread_id:replyTo||null};
          if(onMsg)onMsg([...msgs,nm]);e.target.value='';setMsgDept('all');setMentionQuery(null);setReplyTo(null);nf(tagged.length?'Message sent — '+tagged.length+' member(s) tagged':'Message sent')}
      };
      const sendMsg=()=>{
        const inp=msgInputRef.current;if(!inp||!inp.value.trim())return;
        const text=inp.value.trim();
        const tagged=extractTaggedIds(text);
        const eType=isSO?'so':'estimate';
        const nm={id:'m'+Date.now(),so_id:isSO?o.id:null,author_id:cu.id,text,ts:new Date().toLocaleString(),read_by:[cu.id],dept:msgDept,tagged_members:tagged,entity_type:eType,entity_id:o.id,thread_id:replyTo||null};
        if(onMsg)onMsg([...msgs,nm]);inp.value='';setMsgDept('all');setMentionQuery(null);setReplyTo(null);nf(tagged.length?'Message sent — '+tagged.length+' member(s) tagged':'Message sent');
      };
      const renderOneBubble=(m,indent)=>{const author=REPS.find(r=>r.id===m.author_id);const isMe=m.author_id===cu.id;const unread=!(m.read_by||[]).includes(cu.id);
        const dept=DEPTS.find(d=>d.id===m.dept);const isTagged=(m.tagged_members||[]).includes(cu.id);const replies=getReplies(m.id);
        return<div key={m.id} style={{marginLeft:indent?24:0}}>
          <div style={{padding:'10px 14px',borderRadius:8,background:isTagged?'#fef3c7':isMe?'#dbeafe':'#f8fafc',border:unread?'2px solid #3b82f6':isTagged?'1px solid #f59e0b':'1px solid #e2e8f0',marginLeft:isMe?40:0,marginRight:isMe?0:40}}
            onClick={()=>{if(unread&&onMsg){onMsg(msgs.map(mm=>mm.id===m.id?{...mm,read_by:[...(mm.read_by||[]),cu.id]}:mm))}}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,color:isMe?'#1e40af':'#475569'}}>{author?.name||'Unknown'}</span>
                {dept&&dept.id!=='all'&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:dept.color+'20',color:dept.color}}>@{dept.label}</span>}
                {isTagged&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:'#fef3c7',color:'#92400e'}}>Tagged you</span>}
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:10,color:'#94a3b8'}}>{m.ts}</span>
                {!indent&&<button style={{fontSize:9,padding:'1px 6px',borderRadius:6,border:'1px solid #e2e8f0',background:replyTo===m.id?'#3b82f6':'white',color:replyTo===m.id?'white':'#64748b',cursor:'pointer'}} onClick={(e)=>{e.stopPropagation();setReplyTo(replyTo===m.id?null:m.id)}}>Reply{replies.length>0?` (${replies.length})`:''}</button>}
              </div>
            </div>
            <div style={{fontSize:13,color:'#0f172a'}}>{renderMsgText(m.text,m.tagged_members)}</div>
            {(m.tagged_members||[]).length>0&&<div style={{display:'flex',gap:4,marginTop:4,flexWrap:'wrap'}}>{(m.tagged_members||[]).map(tid=>{const tm=REPS.find(r=>r.id===tid);return tm?<span key={tid} style={{fontSize:9,padding:'1px 6px',borderRadius:8,background:'#dbeafe',color:'#1e40af',fontWeight:600}}>@{tm.name.split(' ')[0]}</span>:null})}</div>}
            {unread&&<div style={{fontSize:9,color:'#3b82f6',marginTop:2}}>● New</div>}
          </div>
          {replies.length>0&&<div style={{borderLeft:'2px solid #e2e8f0',marginLeft:12,marginTop:4,paddingLeft:0}}>{replies.map(r=>renderOneBubble(r,true))}</div>}
        </div>};
      return<div className="card"><div className="card-header"><h2>Messages</h2><span style={{fontSize:12,color:'#64748b'}}>{soMsgs.length} message(s){!isSO&&<span style={{marginLeft:8,fontSize:10,padding:'2px 8px',borderRadius:10,background:'#f0fdf4',color:'#166534',fontWeight:600}}>Estimate</span>}</span></div>
        <div className="card-body">
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:12,maxHeight:500,overflow:'auto'}}>
            {topMsgs.length===0?<div className="empty">No messages yet. Start the conversation. Type @ to tag a team member.</div>:
            topMsgs.map(m=>renderOneBubble(m,false))}
          </div>
          {/* Reply indicator */}
          {replyTo&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:'#eff6ff',borderRadius:8,marginBottom:8}}>
            <span style={{fontSize:11,color:'#1e40af',fontWeight:600}}>Replying to {(()=>{const rm=soMsgs.find(mm=>mm.id===replyTo);const ra=REPS.find(r=>r.id===rm?.author_id);return ra?.name||'message'})()}</span>
            <button style={{fontSize:10,padding:'1px 6px',borderRadius:4,border:'1px solid #bfdbfe',background:'white',color:'#64748b',cursor:'pointer',marginLeft:'auto'}} onClick={()=>setReplyTo(null)}>Cancel</button>
          </div>}
          {/* Message input with department tag and @mention */}
          <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
            {DEPTS.map(d=><button key={d.id} style={{fontSize:10,padding:'2px 8px',borderRadius:10,border:'1px solid '+(msgDept===d.id?d.color:'#e2e8f0'),background:msgDept===d.id?d.color+'15':'white',color:msgDept===d.id?d.color:'#94a3b8',cursor:'pointer',fontWeight:600}} onClick={()=>setMsgDept(d.id)}>@{d.label}</button>)}
          </div>
          <div style={{position:'relative'}}>
            {mentionQuery!=null&&mentionMembers.length>0&&<div style={{position:'absolute',bottom:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.15)',maxHeight:200,overflow:'auto',zIndex:50,marginBottom:4}}>
              {mentionMembers.map((m,i)=><div key={m.id} style={{padding:'8px 12px',cursor:'pointer',background:i===mentionIdx?'#eff6ff':'white',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #f1f5f9'}}
                onMouseEnter={()=>setMentionIdx(i)} onClick={()=>insertMention(m)}>
                <div style={{width:28,height:28,borderRadius:14,background:'#3b82f6',color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{(m.name||'?')[0]}</div>
                <div><div style={{fontSize:12,fontWeight:600}}>{m.name}</div><div style={{fontSize:10,color:'#94a3b8'}}>{m.role}</div></div>
              </div>)}
            </div>}
            <div style={{display:'flex',gap:8}}>
              <input ref={msgInputRef} className="form-input" placeholder={replyTo?'Type a reply... (@ to tag someone)':'Type a message... (@ to tag someone)'} style={{flex:1}}
                onChange={handleMsgInput} onKeyDown={handleMsgKeyDown}/>
              <button className="btn btn-primary" onClick={sendMsg}>{replyTo?'Reply':'Send'}</button>
            </div>
          </div>
        </div></div>})()}

        {/* Adidas B2B last sync summary */}
    {isSO&&tab==='transactions'&&(()=>{
      let latestSync=null;
      safeItems(o).forEach(it=>{if(!isAdidasItem(it))return;const ai=adidasInv[it.sku];if(!ai||!ai.lastSynced)return;const d=new Date(ai.lastSynced);if(!latestSync||d>latestSync)latestSync=d});
      if(!latestSync)return null;
      const staleHrs=(Date.now()-latestSync.getTime())/3600000;
      return<div style={{padding:'8px 16px',fontSize:11,color:staleHrs>48?'#d97706':'#94a3b8',fontWeight:staleHrs>48?700:400,marginBottom:4}}>
        {staleHrs>48?'⚠ ':''}Last Adidas B2B sync: {latestSync.toLocaleDateString()+' '+latestSync.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
      </div>})()}

        {/* LINKED TRANSACTIONS TAB */}
    {isSO&&tab==='transactions'&&(()=>{
      const _poSkip=['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','deco_vendor','deco_type','notes','billed','tracking_numbers'];
      const _poMap={};safeItems(o).forEach(it=>{safePOs(it).forEach(po=>{if(!po.po_id)return;const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&!_poSkip.includes(k)&&typeof po[k]==='number');const ord=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);const rcvd=po.received||{};const rec=szKeys.reduce((a,sz)=>a+(rcvd[sz]||0),0);const uc=safeNum(po.unit_cost);let e=_poMap[po.po_id];if(!e){e=_poMap[po.po_id]={po_id:po.po_id,vendor:po.vendor||po.deco_vendor||'',memo:po.memo||po.notes||'',totalOrd:0,totalRcvd:0,cost:0,skus:[],created_at:po.created_at||''}}e.totalOrd+=ord;e.totalRcvd+=rec;e.cost+=ord*uc;if(!e.vendor)e.vendor=po.vendor||po.deco_vendor||'';if(!e.memo)e.memo=po.memo||po.notes||'';if(it.sku&&!e.skus.includes(it.sku))e.skus.push(it.sku)})});
      const linkedPOs=Object.values(_poMap).map(e=>({...e,itemCount:e.skus.length,status:e.totalRcvd>=e.totalOrd&&e.totalOrd>0?'received':e.totalRcvd>0?'partial':'waiting'}));
      const linkedIFs=[];safeItems(o).forEach(it=>{safePicks(it).forEach(pk=>{if(pk.pick_id&&!linkedIFs.find(x=>x.pick_id===pk.pick_id)){const szKeys=Object.keys(pk).filter(k=>!['pick_id','status','created_at','memo','ship_dest','ship_addr','deco_vendor','notes'].includes(k)&&typeof pk[k]==='number');const totalQty=szKeys.reduce((a,sz)=>a+(pk[sz]||0),0);linkedIFs.push({pick_id:pk.pick_id,status:pk.status||'pick',totalQty,created_at:pk.created_at||'',memo:pk.memo||''})}})});
      const linkedInvs=(allInvoices||[]).filter(inv=>inv.so_id===o.id);
      // Render each linked transaction as a real anchor with a deep-link href so
      // it can be opened in a new tab (Cmd/Ctrl/middle-click). Plain left-click
      // navigates in-app via the existing handlers.
      const _navHref=(params)=>window.location.pathname+'?'+new URLSearchParams(params).toString();
      const _isNewTabClick=(e)=>e.ctrlKey||e.metaKey||e.shiftKey||e.button===1;
      const _openPOInPage=(poId)=>{const decoPO=(o.deco_pos||[]).find(dp=>dp.po_id===poId);if(decoPO){setPoFullPage({decoPo:decoPO,soId:o.id,soItems:safeItems(o)});return}const items=safeItems(o);for(let i=0;i<items.length;i++){const poIdx=(items[i].po_lines||[]).findIndex(p=>p.po_id===poId);if(poIdx>=0){const poLine=items[i].po_lines[poIdx];const allLines=items.map((_,idx)=>({lineIdx:idx})).filter(ln=>items[ln.lineIdx]?.po_lines?.some(p=>p.po_id===poId));setPoFullPage({po:poLine,item:items[i],allLines,soId:o.id,soItems:items});break}}};
      return<div className="card"><div className="card-header"><h2>Linked Transactions</h2></div><div className="card-body">
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {o.estimate_id&&<a href={_navHref({est:o.estimate_id})} style={{display:'flex',gap:12,alignItems:'center',padding:12,background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff',cursor:onViewEstimate?'pointer':'default',color:'inherit',textDecoration:'none'}} onClick={e=>{if(_isNewTabClick(e))return;e.preventDefault();onViewEstimate&&onViewEstimate(o.estimate_id)}}>
          <div style={{width:40,height:40,background:'#ede9fe',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="dollar" size={20}/></div>
          <div><div style={{fontWeight:700,color:'#7c3aed',textDecoration:'underline',textDecorationStyle:'dotted'}}>{o.estimate_id}</div><div style={{fontSize:12,color:'#64748b'}}>Source Estimate</div></div><span className="badge badge-green">Converted</span></a>}
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Item Fulfillments</div>
          {linkedIFs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No item fulfillments yet</div>:
          linkedIFs.map(pk=><a key={pk.pick_id} href={_navHref({if:pk.pick_id})} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #f1f5f9',cursor:'pointer',color:'inherit',textDecoration:'none'}} onClick={e=>{if(_isNewTabClick(e))return;e.preventDefault();setTab('items')}}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{pk.pick_id}</span>
            <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`} style={{fontSize:10}}>{pk.status}</span>
            <span style={{fontSize:11,color:'#64748b'}}>{pk.totalQty} units</span>
            {pk.memo&&<span style={{fontSize:11,color:'#94a3b8'}}>{pk.memo}</span>}
          </a>)}</div>
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Purchase Orders</div>
          {linkedPOs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No purchase orders yet</div>:
          linkedPOs.map(po=><a key={po.po_id} href={_navHref({po:po.po_id})} style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start',padding:'8px 0',borderBottom:'1px solid #f1f5f9',cursor:'pointer',color:'inherit',textDecoration:'none'}} onClick={e=>{if(_isNewTabClick(e))return;e.preventDefault();_openPOInPage(po.po_id)}}>
            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{po.po_id}</span>
              <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{po.vendor||'—'}</span>
              <span className={`badge ${po.status==='received'?'badge-green':po.status==='partial'?'badge-amber':'badge-blue'}`} style={{fontSize:10}}>{po.status==='received'?'Received':po.status==='partial'?'Partial':'Waiting'}</span>
              <span style={{fontSize:11,color:'#64748b'}}>{po.totalRcvd}/{po.totalOrd} received</span>
              {po.cost>0&&<span style={{fontSize:12,fontWeight:700,color:'#166534'}}>${po.cost.toFixed(2)}</span>}
            </div>
            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:'#64748b'}}>{po.itemCount} item{po.itemCount!==1?'s':''}</span>
              {po.skus.length>0&&<span style={{fontSize:11,color:'#94a3b8',fontFamily:'monospace'}}>{po.skus.slice(0,6).join(', ')}{po.skus.length>6?` +${po.skus.length-6}`:''}</span>}
              {po.memo&&<span style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>"{po.memo}"</span>}
            </div>
          </a>)}</div>
        <div style={{padding:12,background:'#faf5ff',borderRadius:8,border:'1px solid #ede9fe'}}><div style={{fontWeight:600,marginBottom:4,color:'#7c3aed'}}>Decoration POs <span style={{fontSize:10,fontWeight:400,color:'#94a3b8'}}>— outside-decorator cost buckets (not line-item orders)</span></div>
          {(o.deco_pos||[]).length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No decoration POs yet</div>:
          (o.deco_pos||[]).map(dp=>{const expected=safeNum(dp.expected_cost||dp.qty*dp.unit_cost);const actual=safeNum(dp._bill_cost||0);return<a key={dp.id||dp.po_id} href={_navHref({po:dp.po_id})} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #ede9fe',cursor:'pointer',flexWrap:'wrap',color:'inherit',textDecoration:'none'}} onClick={e=>{if(_isNewTabClick(e))return;e.preventDefault();setPoFullPage({decoPo:dp,soId:o.id,soItems:safeItems(o)})}}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#7c3aed',fontSize:12}}>{dp.po_id}</span>
            <span style={{fontSize:11,color:'#64748b'}}>{dp.vendor||'—'}</span>
            {dp.deco_type&&<span style={{fontSize:10,padding:'2px 6px',borderRadius:3,background:'#ede9fe',color:'#7c3aed',fontWeight:600}}>{dp.deco_type.replace(/_/g,' ')}</span>}
            <span className={`badge ${dp.status==='billed'||dp.status==='received'?'badge-green':dp.status==='ordered'?'badge-blue':'badge-gray'}`} style={{fontSize:10}}>{(dp.status||'waiting').replace(/^./,c=>c.toUpperCase())}</span>
            <span style={{fontSize:11,color:'#64748b'}}>Expected ${expected.toFixed(2)}{actual>0?' · Actual $'+actual.toFixed(2):''}</span>
            {(dp.item_idxs||[]).length>0&&<span style={{fontSize:10,color:'#94a3b8'}}>{(dp.item_idxs||[]).length} item{(dp.item_idxs||[]).length!==1?'s':''}</span>}
          </a>})}</div>
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Invoices</div>
          {linkedInvs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No invoices linked yet</div>:
          linkedInvs.map(inv=><a key={inv.id} href={_navHref({inv:inv.id})} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #f1f5f9',cursor:onNavInvoice?'pointer':'default',color:'inherit',textDecoration:'none'}} onClick={e=>{if(_isNewTabClick(e))return;e.preventDefault();onNavInvoice&&onNavInvoice(inv)}}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{inv.id}</span>
            <span style={{fontSize:11,color:'#64748b'}}>${(inv.total||0).toLocaleString()}</span>
            <span className={`badge ${inv.status==='paid'?'badge-green':inv.status==='partial'?'badge-amber':'badge-blue'}`} style={{fontSize:10}}>{inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':'Open'}</span>
            {inv.date&&<span style={{fontSize:11,color:'#94a3b8'}}>{inv.date}</span>}
          </a>)}</div>
      </div></div></div>})()}

    {/* TRACKING TAB */}
    {isSO&&tab==='tracking'&&(()=>{
      const trackUrl=tn=>{if(/^1Z/i.test(tn))return'https://www.ups.com/track?tracknum='+tn;if(/^(94|93|92|91)\d{18,}/.test(tn))return'https://tools.usps.com/go/TrackConfirmAction?tLabels='+tn;return'https://www.fedex.com/fedextrack/?trknbr='+tn};
      const carrierLabel=c=>{if(!c)return'';const cl=c.toLowerCase();if(cl==='rep_delivery')return'Rep Delivery';if(cl.includes('ups'))return'UPS';if(cl.includes('fedex'))return'FedEx';if(cl.includes('usps'))return'USPS';return c};
      // Inbound PO data
      const poData=[];
      safeItems(o).forEach((item,idx)=>{(item.po_lines||[]).forEach((po,pi)=>{
        const billed=po.billed||{};const received=po.received||{};const trackNums=po.tracking_numbers||[];const shipments=po.shipments||[];
        const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship'].includes(k)&&typeof po[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
        const totalOrdered=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);const totalBilled=szKeys.reduce((a,sz)=>a+(billed[sz]||0),0);const totalReceived=szKeys.reduce((a,sz)=>a+(received[sz]||0),0);
        if(totalOrdered>0)poData.push({item,itemIdx:idx,po,szKeys,billed,received,trackNums,shipments,totalOrdered,totalBilled,totalReceived,
          vendor:po.vendor||po.deco_vendor||'',expectedDate:po.expected_date||'',
          shipDate:shipments.length>0?shipments[shipments.length-1].date:po.created_at||'',
          status:po.drop_ship?(totalBilled>=totalOrdered&&totalOrdered>0?'shipped':totalBilled>0?'partial':'waiting'):(totalReceived>=totalOrdered?'received':totalBilled>0?(totalReceived>0?'partial':'in_transit'):'waiting')});
      })});
      // Outbound shipments (multi-package)
      const shipments=o._shipments||[];
      const legacyShipment=o._tracking_number&&!shipments.find(s=>s.tracking_number===o._tracking_number);
      const allOutbound=legacyShipment?[{id:'legacy',tracking_number:o._tracking_number,carrier:o._carrier||'',ship_date:o._ship_date||'',tracking_url:o._tracking_url||'',items:[],notes:'Legacy single-package shipment',created_by:o.created_by,created_at:o._ship_date||''},...shipments]:shipments;
      const totalShippedUnits=allOutbound.reduce((a,s)=>(s.items||[]).reduce((a2,it)=>a2+Object.values(it.sizes||{}).reduce((a3,v)=>a3+v,0),0)+a,0);
      // Shipping cost — use SO field, fallback to sum from shipment records
      const shipCostFromShipments=allOutbound.reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
      const shipCost=safeNum(o._shipping_cost||o._shipstation_cost||0)||shipCostFromShipments;
      const freightCost=safeNum(o._inbound_freight||0);
      const canEditCost=cu?.role==='admin'||cu?.role==='super_admin'||cu?.role==='accounting'||cu?.role==='rep';

      return<div style={{display:'grid',gap:16}}>
        {/* ── OUTBOUND SHIPMENTS ── */}
        <div className="card" style={{borderLeft:'3px solid #166534'}}>
          <div className="card-header" style={{background:'linear-gradient(135deg,#f0fdf4,#dcfce7)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <h2 style={{margin:0,color:'#166534'}}>Outbound Shipments</h2>
              {allOutbound.length>0&&<span className="badge badge-green" style={{fontSize:11}}>{allOutbound.length} package{allOutbound.length!==1?'s':''} · {totalShippedUnits} units</span>}
            </div>
          </div>
          <div className="card-body">
            {allOutbound.length===0?<div style={{padding:20,textAlign:'center',color:'#94a3b8'}}>
              <div style={{fontSize:32,marginBottom:8}}>📦</div>
              <div style={{fontSize:13,fontWeight:600}}>No outbound shipments yet</div>
              <div style={{fontSize:11,marginTop:4}}>Packages are created from the Warehouse → Ready to Ship tab</div>
            </div>:
            <div style={{display:'grid',gap:12}}>
              {allOutbound.map((shp,si)=>{
                const shpUnits=(shp.items||[]).reduce((a,it)=>a+Object.values(it.sizes||{}).reduce((a2,v)=>a2+v,0),0);
                return<div key={shp.id||si} style={{padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,fontWeight:800,color:'#166534',background:'#dcfce7',padding:'2px 8px',borderRadius:4}}>Box {si+1}</span>
                    {shp.tracking_number?<a href={shp.tracking_url||trackUrl(shp.tracking_number)} target="_blank" rel="noreferrer"
                      style={{fontFamily:'monospace',fontWeight:700,color:'#166534',background:'#bbf7d0',padding:'3px 10px',borderRadius:4,textDecoration:'none',fontSize:12}}>
                      {shp.tracking_number}</a>:<span style={{fontSize:11,color:'#d97706',fontWeight:600}}>No tracking yet</span>}
                    {shp.carrier&&<span style={{fontSize:11,color:'#475569'}}>via {carrierLabel(shp.carrier)}</span>}
                    {shp.ship_date&&<span style={{fontSize:11,color:'#64748b'}}>Shipped {shp.ship_date}</span>}
                    {safeNum(shp.shipping_cost)>0&&<span style={{fontSize:10,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'2px 8px',borderRadius:4}}>${safeNum(shp.shipping_cost).toFixed(2)}</span>}
                    {shp.label_url&&<button style={{fontSize:9,background:'#7c3aed',color:'white',border:'none',padding:'3px 8px',borderRadius:4,fontWeight:700,cursor:'pointer'}}
                      onClick={()=>{
                        if(shp.label_url.startsWith('data:application/pdf')){
                          const iframe=document.createElement('iframe');iframe.style.display='none';document.body.appendChild(iframe);
                          iframe.src=shp.label_url;iframe.onload=()=>{try{iframe.contentWindow.print()}catch(e){
                            const a=document.createElement('a');a.href=shp.label_url;a.download='label.pdf';a.click()}
                            setTimeout(()=>{try{document.body.removeChild(iframe)}catch{}},60000)};
                        } else {const pw=window.open(shp.label_url,'_blank');if(pw)setTimeout(()=>{try{pw.print()}catch(e){}},1500)}
                      }}>Print Label</button>}
                    {shpUnits>0&&<span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:'#166534'}}>{shpUnits} units</span>}
                    {/* Edit tracking for reps/admin */}
                    {canEditCost&&<button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px'}} onClick={()=>{
                      const tn=prompt('Tracking number:',shp.tracking_number||'');if(tn===null)return;
                      const carrier=prompt('Carrier (ups/fedex/usps):',shp.carrier||'');
                      const idx=(o._shipments||[]).findIndex(s=>s.id===shp.id);
                      if(idx>=0){const updated=(o._shipments||[]).map((s,i)=>i===idx?{...s,tracking_number:tn,carrier:carrier||'',tracking_url:trackUrl(tn),ship_date:s.ship_date||new Date().toLocaleDateString()}:s);
                        const updatedSO={...o,_shipments:updated,_tracking_number:updated[0]?.tracking_number||'',_carrier:updated[0]?.carrier||'',_tracking_url:updated[0]?.tracking_url||'',updated_at:new Date().toLocaleString()};
                        setO(updatedSO);onSave(updatedSO);setDirty(false)}
                      else if(shp.id==='legacy'){const updatedSO={...o,_tracking_number:tn,_carrier:carrier||o._carrier,_tracking_url:trackUrl(tn),updated_at:new Date().toLocaleString()};
                        setO(updatedSO);onSave(updatedSO);setDirty(false)}
                    }}>Edit</button>}
                    {/* Delete shipment — only for non-legacy shipments */}
                    {shp.id!=='legacy'&&canEditCost&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#fee2e2',color:'#dc2626',border:'1px solid #fecaca',fontWeight:700}} onClick={()=>{
                      if(!window.confirm('Delete this shipment? This will remove the package and its tracking info.'))return;
                      const updated=(o._shipments||[]).filter(s=>s.id!==shp.id);
                      // Revert jobs from 'shipped' back to 'completed' if units no longer fully shipped
                      const shippedByItem={};updated.forEach(s=>{(s.items||[]).forEach(it=>{
                        const k=it.sku+'|'+(it.color||'');shippedByItem[k]=(shippedByItem[k]||0)+Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
                      })});
                      const revertedJobs=safeJobs(o).map(jj=>{
                        if(jj.prod_status!=='shipped')return jj;
                        const jobShipped=(jj.items||[]).reduce((a,gi)=>a+(shippedByItem[gi.sku+'|'+(gi.color||'')]||0),0);
                        return jobShipped>=safeNum(jj.total_units)?jj:{...jj,prod_status:'completed'};
                      });
                      const hasShipments=updated.length>0;const firstShp2=updated[0];
                      const allStillShipped=hasShipments&&revertedJobs.filter(jj=>jj.prod_status!=='draft').every(jj=>jj.prod_status==='shipped');
                      const updatedSO={...o,jobs:revertedJobs,_shipments:updated,_shipped:allStillShipped,
                        _shipping_status:hasShipments?(allStillShipped?'shipped':'partial'):null,
                        _tracking_number:firstShp2?.tracking_number||'',_carrier:firstShp2?.carrier||'',
                        _ship_date:firstShp2?.ship_date||'',_tracking_url:firstShp2?.tracking_url||'',
                        _shipping_cost:updated.reduce((a,s)=>a+safeNum(s.shipping_cost||0),0)||null,
                        updated_at:new Date().toLocaleString()};
                      setO(updatedSO);onSave(updatedSO);setDirty(false);
                      nf('Shipment deleted');
                    }}>Delete</button>}
                  </div>
                  {/* Package contents */}
                  {(shp.items||[]).length>0&&<table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                    <thead><tr style={{borderBottom:'1px solid #e2e8f0'}}>
                      <th style={{padding:'4px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>SKU</th>
                      <th style={{padding:'4px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Item</th>
                      <th style={{padding:'4px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Color</th>
                      <th style={{padding:'4px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Sizes</th>
                      <th style={{padding:'4px 6px',textAlign:'center',fontSize:10,color:'#64748b'}}>Qty</th>
                    </tr></thead>
                    <tbody>{(shp.items||[]).map((it,ii)=>{
                      const szStr=Object.entries(it.sizes||{}).filter(([,v])=>v>0).sort((a,b)=>{const ai=SZ_ORD.indexOf(a[0].toUpperCase()),bi2=SZ_ORD.indexOf(b[0].toUpperCase());return(ai<0?99:ai)-(bi2<0?99:bi2)}).map(([sz,v])=>sz+':'+v).join('  ');
                      const itQty=Object.values(it.sizes||{}).reduce((a,v)=>a+v,0);
                      return<tr key={ii} style={{borderBottom:'1px solid #f1f5f9'}}>
                        <td style={{padding:'4px 6px',fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{it.sku}</td>
                        <td style={{padding:'4px 6px'}}>{it.name}</td>
                        <td style={{padding:'4px 6px',color:'#64748b'}}>{it.color||'—'}</td>
                        <td style={{padding:'4px 6px',fontFamily:'monospace',fontSize:10,fontWeight:600}}>{szStr}</td>
                        <td style={{padding:'4px 6px',textAlign:'center',fontWeight:700}}>{itQty}</td>
                      </tr>})}</tbody>
                  </table>}
                  {shp.notes&&<div style={{fontSize:10,color:'#64748b',marginTop:4,fontStyle:'italic'}}>{shp.notes}</div>}
                </div>})}
            </div>}
          </div>
        </div>

        {/* ── INBOUND (PO Tracking) ── */}
        <div className="card" style={{borderLeft:'3px solid #2563eb'}}>
          <div className="card-header" style={{background:'linear-gradient(135deg,#eff6ff,#dbeafe)'}}>
            <h2 style={{margin:0,color:'#1e40af'}}>Inbound (Purchase Orders)</h2>
          </div>
          <div className="card-body">
            {poData.length===0?<div style={{padding:20,textAlign:'center',color:'#94a3b8'}}>
              <div style={{fontSize:13}}>No purchase orders on this SO</div>
            </div>:
            <div style={{display:'grid',gap:12}}>
            {poData.map((d,i)=>{
              const billDetails=d.po._bill_details||[];
              return<div key={i} style={{background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                {/* PO Header */}
                <div style={{padding:'10px 12px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',borderBottom:'1px solid #e2e8f0',background:'white'}}>
                  <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{d.item.sku}</span>
                  <span style={{fontWeight:600,fontSize:11}}>{d.item.name||''}</span>
                  <span style={{color:'#64748b',fontSize:11}}>{d.item.color}</span>
                  <span style={{fontSize:10,color:'#475569'}}>·</span>
                  <span style={{cursor:'pointer',color:'#1e40af',textDecoration:'underline',fontFamily:'monospace',fontWeight:600}} onClick={()=>{
                    const allLines=safeItems(o).map((it2,idx2)=>({lineIdx:idx2})).filter(ln=>safeItems(o)[ln.lineIdx]?.po_lines?.some(p=>p.po_id===d.po.po_id));
                    setPoFullPage({po:d.po,item:d.item,allLines,soId:o.id,soItems:o.items});
                  }}>{d.po.po_id}</span>
                  <span style={{fontSize:11,color:'#64748b'}}>{d.vendor}</span>
                  <span className={`badge ${d.status==='received'||d.status==='shipped'?'badge-green':d.status==='in_transit'?'badge-blue':d.status==='partial'?'badge-amber':'badge-gray'}`}>{d.status==='shipped'?'Shipped':d.status==='received'?'Received':d.status==='in_transit'?'In Transit':d.status==='partial'?'Partial':'Waiting'}</span>
                  {d.po.drop_ship&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
                  {safeNum(d.po._bill_cost)>0&&<span style={{fontSize:10,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'2px 8px',borderRadius:4}}>Merchandise: ${safeNum(d.po._bill_cost).toFixed(2)}</span>}
                  {d.expectedDate&&<span style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>Expected: {d.expectedDate}</span>}
                </div>
                {/* Size breakdown table */}
                <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                  <thead><tr style={{borderBottom:'1px solid #e2e8f0',background:'#f1f5f9'}}>
                    <th style={{padding:'5px 10px',textAlign:'left',fontSize:10,color:'#64748b',fontWeight:700}}>SIZE</th>
                    <th style={{padding:'5px 10px',textAlign:'center',fontSize:10,color:'#64748b',fontWeight:700}}>ORDERED</th>
                    <th style={{padding:'5px 10px',textAlign:'center',fontSize:10,color:'#64748b',fontWeight:700}}>BILLED</th>
                    <th style={{padding:'5px 10px',textAlign:'center',fontSize:10,color:'#64748b',fontWeight:700}}>RECEIVED</th>
                    <th style={{padding:'5px 10px',textAlign:'left',fontSize:10,color:'#64748b',fontWeight:700}}>SHIPMENTS</th>
                  </tr></thead>
                  <tbody>
                    {d.szKeys.map(sz=>{
                      const ordered=d.po[sz]||0;const billed=d.billed[sz]||0;const received=(d.received[sz]||0);
                      // Find shipments that include this size from bill details
                      const sizeShipments=billDetails.filter(bd=>(bd.sizes||{})[sz]>0);
                      return<tr key={sz} style={{borderBottom:'1px solid #f1f5f9'}}>
                        <td style={{padding:'5px 10px',fontWeight:700,fontFamily:'monospace',fontSize:12}}>{sz}</td>
                        <td style={{padding:'5px 10px',textAlign:'center',fontWeight:600}}>{ordered}</td>
                        <td style={{padding:'5px 10px',textAlign:'center',fontWeight:700,color:billed>=ordered&&ordered>0?'#166534':billed>0?'#d97706':'#d1d5db'}}>{billed>0?billed:'—'}</td>
                        <td style={{padding:'5px 10px',textAlign:'center',fontWeight:700,color:received>=ordered&&ordered>0?'#166534':received>0?'#d97706':'#d1d5db'}}>{received>0?received:'—'}</td>
                        <td style={{padding:'5px 10px'}}>
                          {sizeShipments.length>0?<div style={{display:'flex',flexDirection:'column',gap:2}}>
                            {sizeShipments.map((bd,bi)=><div key={bi} style={{display:'flex',alignItems:'center',gap:6,fontSize:10}}>
                              <span style={{color:'#64748b'}}>{bd.date||''}</span>
                              <span style={{fontWeight:700,color:'#1e40af'}}>{bd.sizes[sz]} units</span>
                              {bd.tracking&&<a href={trackUrl(bd.tracking)} target="_blank" rel="noreferrer" style={{fontFamily:'monospace',fontSize:10,fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'1px 5px',borderRadius:3,textDecoration:'none'}}>{bd.tracking}</a>}
                              {bd.doc&&<span style={{fontSize:9,color:'#94a3b8'}}>Doc #{bd.doc}</span>}
                            </div>)}
                          </div>:<span style={{color:'#d1d5db',fontSize:10}}>—</span>}
                        </td>
                      </tr>})}
                    {/* Totals row */}
                    <tr style={{borderTop:'2px solid #e2e8f0',background:'#f8fafc'}}>
                      <td style={{padding:'5px 10px',fontWeight:800,fontSize:10,color:'#64748b'}}>TOTAL</td>
                      <td style={{padding:'5px 10px',textAlign:'center',fontWeight:800}}>{d.totalOrdered}</td>
                      <td style={{padding:'5px 10px',textAlign:'center',fontWeight:800,color:d.totalBilled>=d.totalOrdered&&d.totalOrdered>0?'#166534':d.totalBilled>0?'#d97706':'#d1d5db'}}>{d.totalBilled>0?d.totalBilled:'—'}</td>
                      <td style={{padding:'5px 10px',textAlign:'center',fontWeight:800,color:d.totalReceived>=d.totalOrdered?'#166534':d.totalReceived>0?'#d97706':'#d1d5db'}}>{d.totalReceived>0?d.totalReceived:'—'}</td>
                      <td style={{padding:'5px 10px'}}>
                        {d.trackNums.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{d.trackNums.map((tn,ti)=><a key={ti} href={trackUrl(tn)} target="_blank" rel="noreferrer" style={{fontFamily:'monospace',fontSize:10,fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:4,textDecoration:'none'}}>{tn}</a>)}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>})}
            </div>}
            {/* Inbound cost summary */}
            {(()=>{const totalMerch=poData.reduce((a,d)=>a+safeNum(d.po._bill_cost||0),0);
              return(totalMerch>0||freightCost>0)?<div style={{display:'flex',gap:12,marginTop:12,padding:'10px 12px',background:'#f0fdf4',borderRadius:8,border:'1px solid #bbf7d0',flexWrap:'wrap'}}>
                {totalMerch>0&&<div><span style={{fontSize:10,color:'#64748b',fontWeight:600}}>Total Merchandise Billed:</span> <span style={{fontSize:13,fontWeight:800,color:'#166534'}}>${totalMerch.toFixed(2)}</span></div>}
                {freightCost>0&&<div><span style={{fontSize:10,color:'#64748b',fontWeight:600}}>Inbound Freight:</span> <span style={{fontSize:13,fontWeight:800,color:'#166534'}}>${freightCost.toFixed(2)}</span></div>}
                {(totalMerch>0||freightCost>0)&&<div><span style={{fontSize:10,color:'#64748b',fontWeight:600}}>Total Inbound Cost:</span> <span style={{fontSize:13,fontWeight:800,color:'#0f172a'}}>${(totalMerch+freightCost).toFixed(2)}</span></div>}
              </div>:null})()}
          </div>
        </div>

        {/* ── SHIPPING COSTS ── */}
        <div className="card" style={{borderLeft:'3px solid #d97706'}}>
          <div className="card-header" style={{background:'linear-gradient(135deg,#fffbeb,#fef3c7)'}}>
            <h2 style={{margin:0,color:'#92400e'}}>Shipping Costs</h2>
          </div>
          <div className="card-body">
            <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
              <div>
                <label className="form-label">Outbound Shipping</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._shipping_cost||o._shipstation_cost||0} onChange={v=>{sv('_shipping_cost',v);sv('_shipstation_cost',v)}} w={100} disabled={!canEditCost}/>
                  {allOutbound.length>0&&<span style={{fontSize:10,color:'#166534'}}>({allOutbound.length} package{allOutbound.length!==1?'s':''})</span>}
                </div>
              </div>
              <div>
                <label className="form-label">Inbound Freight</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._inbound_freight||0} onChange={v=>sv('_inbound_freight',v)} w={100} disabled={!canEditCost}/>
                  <span style={{fontSize:10,color:'#94a3b8'}}>from supplier bills</span>
                </div>
              </div>
              <div style={{padding:'8px 14px',background:(shipCost+freightCost)>0?'#fef2f2':'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:9,fontWeight:700,color:'#64748b',textTransform:'uppercase'}}>Total Shipping Cost</div>
                <div style={{fontSize:18,fontWeight:800,color:(shipCost+freightCost)>0?'#dc2626':'#94a3b8'}}>{(shipCost+freightCost)>0?'$'+(shipCost+freightCost).toFixed(2):'$0.00'}</div>
              </div>
            </div>
            {!canEditCost&&<div style={{fontSize:10,color:'#94a3b8',marginTop:8}}>Only accounting, admin, or reps can edit shipping costs</div>}
          </div>
        </div>
      </div>})()}


    {/* COSTS TAB — Expected vs Actual */}
    {isSO&&tab==='costs'&&(()=>{
        const costLines=[];
        // Pre-compute per-SKU billed totals for correct unit cost on duplicate SKUs
        // (bill cost is split proportionally across items, but billed qty is duplicated on each)
        const _skuBillCost={},_skuBillQtySeen={};
        safeItems(o).forEach(it=>{
          const sk=(it.sku||'').toUpperCase();if(!sk)return;
          const blankPOs=(it.po_lines||[]).filter(pl=>pl.po_type!=='outside_deco');
          const bc=blankPOs.reduce((a,pl)=>a+safeNum(pl._bill_cost||0),0);
          if(bc>0){_skuBillCost[sk]=(_skuBillCost[sk]||0)+bc;
            if(!_skuBillQtySeen[sk]){_skuBillQtySeen[sk]=true;_skuBillCost[sk+'_qty']=blankPOs.reduce((a,pl)=>a+Object.values(pl.billed||{}).reduce((a2,v)=>a2+safeNum(v),0),0)}}
        });
        // In-house deco is accumulated by logo/art group (one screen-print run
        // covers many garments) and pushed as a single grouped row after the
        // item loop — instead of a separate, setup-inflated row per garment.
        const decoGroups={};
        safeItems(o).forEach((it,ii)=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          if(!qty)return;
          const blankPOs=(it.po_lines||[]).filter(pl=>pl.po_type!=='outside_deco');
          const poBlankQty=blankPOs.reduce((a,pl)=>{
            return a+Object.entries(pl).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0)},0);
          // Expected cost: use PO unit_cost when set, otherwise item nsa_cost
          const expectedFromPOs=blankPOs.reduce((a,pl)=>{
            const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0);
            const uc=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);
            return a+poQty*uc},0);
          const expectedBlank=expectedFromPOs+(Math.max(0,qty-poBlankQty))*safeNum(it.nsa_cost);
          // Include inventory picks in actual cost (already-owned stock still has cost basis)
          const pickQty=safePicks(it).reduce((a,pk)=>a+Object.entries(pk).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0),0);
          const accountedQty=poBlankQty+pickQty;
          const hasActual=blankPOs.length>0||pickQty>0;
          // Use actual billed cost from supplier bills when available; no bill = no actual (show "—")
          const billedCostFromPOs=blankPOs.reduce((a,pl)=>a+safeNum(pl._bill_cost||0),0);
          const actualBlank=billedCostFromPOs>0?billedCostFromPOs+(pickQty*safeNum(it.nsa_cost)):(pickQty>0?pickQty*safeNum(it.nsa_cost):0);
          // Use SKU-level totals for unit cost so duplicate SKUs don't halve the price
          const _sk=(it.sku||'').toUpperCase();
          const skuTotalCost=_skuBillCost[_sk]||0;
          const skuBilledQty=_skuBillCost[_sk+'_qty']||0;
          const billedUnitCost=skuTotalCost>0&&skuBilledQty>0?Math.round(skuTotalCost/skuBilledQty*100)/100:null;
          const catalogCost=safeNum(it.nsa_cost);
          const catProduct=products.find(x=>x.id===it.product_id)||(it.sku?products.find(x=>(x.sku||'').toLowerCase()===(it.sku||'').toLowerCase()):null);
          costLines.push({category:'Blanks',sku:it.sku,name:it.name,vendor:D_V.find(v=>v.id===it.vendor_id)?.name||it.brand||'—',
            qty,expected:expectedBlank,actual:actualBlank,poCount:blankPOs.length+(pickQty>0?1:0),
            poIds:blankPOs.map(p=>p.po_id).filter(Boolean).join(', '),
            allReceived:blankPOs.length>0&&blankPOs.every(p=>p.status==='received'),
            _catProduct:catProduct,_productId:it.product_id,_vendorId:it.vendor_id,_brand:it.brand,_color:it.color,_imageUrl:it.image_url,
            billedUnitCost,catalogCost});
          // In-house deco only — outside deco is aggregated below at SO level (one row per
          // outside-deco PO / vendor), since a decorator's bill covers multiple items as a
          // single purchase. Splitting it per-item doesn't match how the cost lands.
          safeDecos(it).forEach(d=>{
            const matchingDPOs=(it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco');
            const isOutside=d.kind==='outside_deco'||matchingDPOs.length>0;
            if(isOutside)return;
            // Price the shared logo at its COMBINED run quantity (cq) so one
            // setup is spread across every garment — matching the header margin.
            const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;
            const dp=dP(d,qty,af,cq);
            if(!(dp.cost>0))return;
            const eqD=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);
            const artF=af.find(a=>a.id===d.art_file_id);
            const gkey=(d.art_file_id&&d.art_file_id!=='__tbd')?('art:'+d.art_file_id):('t:'+(d.deco_type||d.type||d.kind||'deco'));
            const g=decoGroups[gkey]||(decoGroups[gkey]={name:artF?.name||(d.deco_type||d.type||'').replace(/_/g,' ')||'Decoration',expected:0,qty:0,skus:[]});
            g.expected+=eqD*dp.cost;g.qty+=eqD;
            if(it.sku&&!g.skus.includes(it.sku))g.skus.push(it.sku);
          });
        });
        // One In-House Deco row per logo/art group, listing the garments it covers.
        Object.values(decoGroups).forEach(g=>{
          const exp=Math.round(g.expected*100)/100;
          costLines.push({category:'In-House Deco',sku:'',
            name:g.name+(g.skus.length?` · ${g.skus.length} item${g.skus.length>1?'s':''}: ${g.skus.join(', ')}`:''),
            vendor:'NSA In-House',qty:g.qty,expected:exp,actual:exp,poCount:0,poIds:'',allReceived:true});
        });
        // Outside deco — one row per SO-level deco PO (so.deco_pos). Expected = qty × unit_cost
        // from the PO (price-list driven); Actual = _bill_cost (—, when no bill applied yet).
        (o.deco_pos||[]).forEach(dp=>{
          const qty=safeNum(dp.qty||0);
          const unitCost=safeNum(dp.unit_cost||0);
          const expected=safeNum(dp.expected_cost||qty*unitCost);
          const actual=safeNum(dp._bill_cost||0);
          if(expected===0&&actual===0)return;
          const skus=(dp.item_idxs||[]).map(ii=>safeItems(o)[ii]?.sku).filter(Boolean);
          const dtLabel=dp.deco_type?dp.deco_type.replace(/_/g,' '):'';
          const tsLabel=dp.topstar_service?(dp.topstar_service==='vector'?'Vector Logo':'DST File'):'';
          costLines.push({category:dp.topstar_service?'Digitizing':'Outside Deco',
            sku:skus.join(', ')||'—',
            name:dp.topstar_service?'Topstar Digitizing — '+tsLabel:'Outside Deco'+(dtLabel?' — '+dtLabel:''),
            vendor:dp.vendor||'—',
            qty,
            expected:Math.round(expected*100)/100,
            actual:Math.round(actual*100)/100,
            poCount:1,
            poIds:dp.po_id||'',
            allReceived:dp.status==='received'});
        });
        if(costLines.length===0)return<div className="card"><div className="card-body"><div className="empty">No cost data — add items first</div></div></div>;
        const hasActuals=costLines.some(l=>l.actual>0);
        // Shipping & freight costs for GP calculation — fallback to summing shipment records
        const shipCostFromRecs=(o._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
        const shipCostVal=safeNum(o._shipping_cost||o._shipstation_cost||0)||shipCostFromRecs;
        const freightVal=safeNum(o._inbound_freight||0);
        // Expected shipping = what the rep quoted on the SO (% of rev or flat $)
        const quotedShip=o.shipping_type==='pct'?totals.rev*(o.shipping_value||0)/100:safeNum(o.shipping_value||0);
        // Shipping: two detail lines + subtotal row; expected (quoted) only on subtotal
        if(shipCostVal>0||freightVal>0||quotedShip>0){
          costLines.push({category:'Shipping',sku:'—',name:'Outbound Shipping (ShipStation)',vendor:'ShipStation',qty:1,expected:0,actual:shipCostVal,isShipping:true,isShippingDetail:true,poCount:shipCostVal>0?1:0,poIds:'',allReceived:true});
          costLines.push({category:'Shipping',sku:'—',name:'Inbound Freight (Supplier Bills)',vendor:'Supplier',qty:1,expected:0,actual:freightVal,isShipping:true,isShippingDetail:true,poCount:freightVal>0?1:0,poIds:'',allReceived:true});
          costLines.push({category:'Shipping',sku:'',name:'Shipping Total',vendor:'',qty:'',expected:quotedShip,actual:shipCostVal+freightVal,isShipping:true,isShippingSubtotal:true,poCount:1,poIds:'',allReceived:true});
        }
        // OMG team-store fees NSA is charged (processing) — a real order cost,
        // shown here so the Costs tab matches the margin in the header.
        const _omgFee=safeNum(o._omg_processing||0);
        if(_omgFee>0){costLines.push({category:'OMG Fees',sku:'—',name:'OMG Processing Fee',vendor:'OrderMyGear',qty:1,expected:_omgFee,actual:_omgFee,poCount:1,poIds:'',allReceived:true});}
        // Totals computed AFTER shipping lines added
        const totalExpected=costLines.reduce((a,l)=>a+(l.isShippingSubtotal?0:l.expected),0)+quotedShip;
        const totalActual=costLines.reduce((a,l)=>a+(l.isShippingSubtotal?0:l.actual),0);
        // Variance totals only include billed items (items with actual cost > 0)
        const billedExpected=costLines.filter(l=>!l.isShippingSubtotal&&!l.isShippingDetail&&l.actual>0).reduce((a,l)=>a+l.expected,0);
        const billedActual=costLines.filter(l=>!l.isShippingSubtotal&&!l.isShippingDetail&&l.actual>0).reduce((a,l)=>a+l.actual,0);
        // Add shipping subtotal to billed totals if any shipping costs exist
        const shippingSub=costLines.find(l=>l.isShippingSubtotal);
        const shipActual=shippingSub?shippingSub.actual:0;
        const shipExpected=shipActual>0?quotedShip:0;
        const variance=(billedActual+shipActual)-(billedExpected+shipExpected);
        const cats={};costLines.forEach(l=>{if(l.isShippingSubtotal)return;if(!cats[l.category])cats[l.category]={expected:0,actual:0};cats[l.category].expected+=l.expected;cats[l.category].actual+=l.actual});if(cats['Shipping'])cats['Shipping'].expected=quotedShip;

        return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between'}}>
          <h2>💰 Cost Breakdown — Expected vs Actual</h2>
          {hasActuals&&variance!==0&&<span style={{fontSize:12,fontWeight:700,padding:'4px 12px',borderRadius:8,
            background:variance>0?'#fef2f2':'#f0fdf4',color:variance>0?'#dc2626':'#166534'}}>
            {variance>0?'⚠️ Over':'✅ Under'} by ${Math.abs(variance).toFixed(2)}</span>}
        </div>
        <div className="card-body">
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            {Object.entries(cats).map(([cat,v])=>{const diff=v.actual-v.expected;
              return<div key={cat} style={{padding:'10px 14px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',minWidth:150,flex:1}}>
                <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>{cat}</div>
                <div style={{display:'flex',gap:16}}>
                  <div><div style={{fontSize:9,color:'#94a3b8'}}>Expected</div><div style={{fontSize:16,fontWeight:700,color:'#475569'}}>${v.expected.toFixed(2)}</div></div>
                  <div><div style={{fontSize:9,color:'#94a3b8'}}>Actual</div><div style={{fontSize:16,fontWeight:700,color:v.actual>0?'#0f172a':'#94a3b8'}}>{v.actual>0?'$'+v.actual.toFixed(2):'—'}</div></div>
                  {v.actual>0&&diff!==0&&<div><div style={{fontSize:9,color:'#94a3b8'}}>Variance</div><div style={{fontSize:16,fontWeight:700,color:diff>0?'#dc2626':'#166534'}}>{diff>0?'+':''}${diff.toFixed(2)}</div></div>}
                </div>
              </div>})}
            <div style={{padding:'10px 14px',background:variance>0?'#fef2f2':'#f0fdf4',borderRadius:8,border:'2px solid '+(variance>0?'#fca5a5':'#86efac'),minWidth:150}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>Total Cost</div>
              <div style={{display:'flex',gap:16}}>
                <div><div style={{fontSize:9,color:'#94a3b8'}}>Expected</div><div style={{fontSize:18,fontWeight:800,color:'#475569'}}>${totalExpected.toFixed(2)}</div></div>
                <div><div style={{fontSize:9,color:'#94a3b8'}}>Actual</div><div style={{fontSize:18,fontWeight:800,color:totalActual>0?'#0f172a':'#94a3b8'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</div></div>
              </div>
            </div>
          </div>
          <table><thead><tr><th>Category</th><th>Item / Service</th><th>Vendor</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Expected</th><th style={{textAlign:'right'}}>Actual</th><th style={{textAlign:'right'}}>Variance</th><th>PO(s)</th></tr></thead>
            <tbody>{costLines.map((l,i)=>{const diff=l.actual-l.expected;
              if(l.isShippingSubtotal){return<tr key={i} style={{background:'#f0fdf4',borderTop:'1px solid #bbf7d0'}}>
                <td></td><td style={{fontWeight:700,fontSize:12,color:'#166534'}}>{l.name}</td><td></td><td></td>
                <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${l.expected.toFixed(2)}</td>
                <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>${l.actual.toFixed(2)}</td>
                <td style={{textAlign:'right',fontWeight:700,color:diff>0?'#dc2626':diff<0?'#166534':'#94a3b8'}}>{(diff>0?'+':diff<0?'-':'')+'$'+Math.abs(diff).toFixed(2)}</td>
                <td></td>
              </tr>}
              return<tr key={i} style={{background:diff>0&&!l.isShippingDetail?'#fef2f210':''}}>
                <td><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,
                  background:l.category==='Blanks'?'#dbeafe':l.category==='Outside Deco'?'#ede9fe':l.category==='Shipping'?'#dcfce7':'#fef3c7',
                  color:l.category==='Blanks'?'#1e40af':l.category==='Outside Deco'?'#7c3aed':l.category==='Shipping'?'#166534':'#92400e'}}>{l.category}</span></td>
                <td><span style={{fontFamily:'monospace',fontWeight:700,color:'#475569',marginRight:6}}>{l.sku}</span>{l.name}</td>
                <td style={{fontSize:11,color:'#64748b'}}>{l.vendor}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{l.qty}</td>
                <td style={{textAlign:'right'}}>{l.isShippingDetail?'—':'$'+l.expected.toFixed(2)}</td>
                <td style={{textAlign:'right',fontWeight:700,color:l.actual>0?'#0f172a':'#94a3b8'}}>{l.actual>0?'$'+l.actual.toFixed(2):l.isShipping?'$0.00':'—'}</td>
                <td style={{textAlign:'right',fontWeight:700,color:diff>0?'#dc2626':diff<0?'#166534':'#94a3b8'}}>{l.isShippingDetail?'—':(l.actual>0||l.isShipping)?(diff>0?'+':diff<0?'-':'')+'$'+Math.abs(diff).toFixed(2):'—'}
                  {l.billedUnitCost!=null&&!catalogUpdatedSkus[l.sku]&&Math.abs(l.billedUnitCost-l.catalogCost)>0.005&&<div><button style={{fontSize:9,padding:'1px 6px',borderRadius:4,border:'1px solid #93c5fd',background:'#eff6ff',color:'#1e40af',cursor:'pointer',fontWeight:600,marginTop:2}} onClick={()=>{
                    const cp=l._catProduct||products.find(x=>x.id===l._productId)||products.find(x=>(x.sku||'').toLowerCase()===(l.sku||'').toLowerCase());
                    const updated=cp?{...cp,nsa_cost:l.billedUnitCost}:{id:l._productId,sku:l.sku,name:l.name,vendor_id:l._vendorId||null,brand:l._brand||null,color:l._color||null,image_url:l._imageUrl||null,nsa_cost:l.billedUnitCost};
                    if(onSaveProduct)onSaveProduct(updated);
                    setCatalogUpdatedSkus(p=>({...p,[l.sku]:true}));
                    nf(l.sku+' catalog cost updated: $'+l.catalogCost.toFixed(2)+' → $'+l.billedUnitCost.toFixed(2));
                  }}>Update Catalog → ${l.billedUnitCost.toFixed(2)}</button></div>}
                </td>
                <td style={{fontSize:11,color:'#7c3aed',fontWeight:600}}>{l.poIds||<span style={{color:'#94a3b8'}}>No PO</span>}</td>
              </tr>})}</tbody>
            <tfoot><tr style={{fontWeight:800}}>
              <td colSpan={4} style={{textAlign:'right'}}>TOTALS</td>
              <td style={{textAlign:'right'}}>${totalExpected.toFixed(2)}</td>
              <td style={{textAlign:'right'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</td>
              <td style={{textAlign:'right',color:variance>0?'#dc2626':variance<0?'#166534':'#94a3b8'}}>{hasActuals?(variance>0?'+':'')+'$'+variance.toFixed(2):'—'}</td>
              <td></td>
            </tr></tfoot>
          </table>
          {/* Shipping & Freight overrides for GP / Commission calculation */}
          <div style={{marginTop:16,padding:14,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:8}}>Shipping & Freight Costs (for Gross Profit / Commission)</div>
            <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
              <div>
                <label className="form-label">Outbound Shipping (ShipStation)</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._shipstation_cost||o._shipping_cost||0} onChange={v=>{sv('_shipstation_cost',v);sv('_shipping_cost',v)}} w={90}/>
                  <span style={{fontSize:10,color:'#94a3b8'}}>auto-filled from ShipStation labels</span>
                </div>
              </div>
              <div>
                <label className="form-label">Inbound Freight (Supplier Bills)</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <$In value={o._inbound_freight||0} onChange={v=>sv('_inbound_freight',v)} w={90}/>
                  <span style={{fontSize:10,color:'#94a3b8'}}>from supplier bills tied to SO</span>
                </div>
              </div>
              <div style={{padding:'6px 12px',background:'#eff6ff',borderRadius:6,fontSize:11,color:'#1e40af'}}>
                <strong>GP Impact:</strong> These reduce gross profit and commission calculations.
                {(shipCostVal>0||freightVal>0)&&<span style={{marginLeft:6,fontWeight:700,color:'#dc2626'}}>-${(shipCostVal+freightVal).toFixed(2)}</span>}
              </div>
            </div>
          </div>
        </div></div>})()}

    {/* HISTORY TAB */}
    {tab==='history'&&<div className="card" style={{marginBottom:16}}>
      <div className="card-header"><h2 style={{margin:0,fontSize:14}}>Document History</h2></div>
      <div className="card-body" style={{padding:'16px 20px'}}>
        {/* Created */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Created</div>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:6,border:'1px solid #bbf7d0'}}>
            <span style={{fontSize:16}}>📄</span>
            <div><div style={{fontSize:13,fontWeight:600}}>{isE?'Estimate':'Sales Order'} created</div>
            <div style={{fontSize:11,color:'#64748b'}}>by {REPS.find(r=>r.id===o.created_by)?.name||o.created_by} · {o.created_at}</div></div>
          </div>
        </div>
        {/* Send History */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Send History</div>
          {(o.sent_history||[]).length===0?<div style={{fontSize:12,color:'#94a3b8',padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>Not yet sent</div>
          :(o.sent_history||[]).map((h,hi)=><div key={hi} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#eff6ff',borderRadius:6,border:'1px solid #bfdbfe',marginBottom:4}}>
            <span style={{fontSize:16}}>✉️</span>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>Sent to coach</div>
            <div style={{fontSize:11,color:'#64748b'}}>{new Date(h.sent_at).toLocaleDateString()} @ {new Date(h.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})} · by {h.sent_by}{h.to?' · → '+h.to:''}</div>
            {h.methods&&<div style={{fontSize:10,color:'#1e40af',marginTop:2}}>{h.methods.join(', ')}</div>}</div>
          </div>)}
          {/* Email opened tracking */}
          {o.email_status==='opened'&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#dbeafe',borderRadius:6,border:'1px solid #93c5fd',marginTop:4}}>
            <span style={{fontSize:16}}>👁️</span>
            <div><div style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>Coach opened document</div>
            <div style={{fontSize:11,color:'#64748b'}}>{o.email_opened_at||'Timestamp not recorded'}</div></div>
          </div>}
          {o.email_viewed_at&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#dbeafe',borderRadius:6,border:'1px solid #93c5fd',marginTop:4}}>
            <span style={{fontSize:16}}>👁️</span>
            <div><div style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>Coach viewed in portal</div>
            <div style={{fontSize:11,color:'#64748b'}}>{o.email_viewed_at}</div></div>
          </div>}
          {o.follow_up_at&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:new Date(o.follow_up_at)<new Date()?'#fef2f2':'#fffbeb',borderRadius:6,border:'1px solid '+(new Date(o.follow_up_at)<new Date()?'#fecaca':'#fde68a'),marginTop:4}}>
            <span style={{fontSize:16}}>⏰</span>
            <div><div style={{fontSize:13,fontWeight:600,color:new Date(o.follow_up_at)<new Date()?'#dc2626':'#92400e'}}>Follow-up {new Date(o.follow_up_at)<new Date()?'overdue':'scheduled'}</div>
            <div style={{fontSize:11,color:'#64748b'}}>{new Date(o.follow_up_at).toLocaleDateString()}</div></div>
          </div>}
        </div>
        {/* Coach Activity */}
        {(()=>{const coachEvents=[];
          // Document-level email tracking (estimates, SOs, invoices)
          if(o.email_status==='opened'&&o.email_opened_at)coachEvents.push({ts:o.email_opened_at,type:'opened',detail:o._opened_by_email||(o.sent_history||[]).slice(-1)[0]?.to||''});
          if(o.email_viewed_at)coachEvents.push({ts:o.email_viewed_at,type:'viewed',detail:''});
          // Job-level coach tracking (SOs only)
          if(!isE)safeJobs(o).forEach(j=>{if(j.sent_to_coach_at)coachEvents.push({ts:j.sent_to_coach_at,type:'sent',detail:j.art_name||j.key||j.id});if(j.coach_email_opened_at)coachEvents.push({ts:j.coach_email_opened_at,type:'opened',detail:j.art_name||j.key||j.id});if(j.coach_approved_at)coachEvents.push({ts:j.coach_approved_at,type:'approved',detail:j.art_name||j.key||j.id});if(j.coach_rejected)coachEvents.push({ts:j.coach_approved_at||j.sent_to_coach_at,type:'rejected',detail:j.art_name||j.key||j.id})});
          coachEvents.sort((a,b)=>new Date(b.ts)-new Date(a.ts));
          return coachEvents.length>0&&<div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Coach Activity</div>
          {coachEvents.map((ev,ei)=><div key={ei} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:ev.type==='approved'?'#f0fdf4':ev.type==='rejected'?'#fef2f2':ev.type==='opened'||ev.type==='viewed'?'#dbeafe':'#eff6ff',borderRadius:6,border:'1px solid '+(ev.type==='approved'?'#bbf7d0':ev.type==='rejected'?'#fecaca':ev.type==='opened'||ev.type==='viewed'?'#93c5fd':'#bfdbfe'),marginBottom:4}}>
            <span style={{fontSize:16}}>{ev.type==='sent'?'📨':ev.type==='opened'?'👁️':ev.type==='viewed'?'🔗':ev.type==='approved'?'✅':'❌'}</span>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{ev.type==='sent'?'Sent to coach':ev.type==='opened'?'Coach opened email':ev.type==='viewed'?'Coach viewed in portal':ev.type==='approved'?'Coach approved':'Coach rejected'}</div>
            <div style={{fontSize:11,color:'#64748b'}}>{ev.detail?ev.detail+' · ':''}{new Date(ev.ts).toLocaleDateString()} @ {new Date(ev.ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}</div></div>
          </div>)}
        </div>})()}
        {/* Print History */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Print History</div>
          {(o.print_history||[]).length===0?<div style={{fontSize:12,color:'#94a3b8',padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>Not yet printed</div>
          :(o.print_history||[]).map((h,hi)=><div key={hi} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#f5f3ff',borderRadius:6,border:'1px solid #ddd6fe',marginBottom:4}}>
            <span style={{fontSize:16}}>🖨️</span>
            <div><div style={{fontSize:13,fontWeight:600}}>Printed</div>
            <div style={{fontSize:11,color:'#64748b'}}>{h.printed_at} · by {h.printed_by}</div></div>
          </div>)}
        </div>
        {/* Fulfillment History — deliveries & shipments (SOs only) */}
        {!isE&&(()=>{
          const fEvents=[];
          const nameFor=(by)=>REPS.find(r=>r.id===by)?.name||by||'warehouse';
          Object.entries(o.delivered||{}).forEach(([key,v])=>{
            let desc=key;
            if(key.startsWith('job|')){const j=safeJobs(o).find(jj=>jj.id===key.slice(4));desc=j?.art_name||key.slice(4);}
            else if(key.startsWith('nd|')){const it=safeItems(o)[+key.slice(3)];desc=it?((it.sku?it.sku+' ':'')+(it.name||'')).trim():key;}
            fEvents.push({ts:v.at,type:'delivered',detail:desc,by:nameFor(v.by)});
          });
          (o._shipments||[]).forEach((s,si)=>{
            const ts=s.ship_date||s.created_at;
            fEvents.push({ts,type:'shipped',detail:s.tracking_number?((s.carrier?s.carrier.toUpperCase()+' ':'')+s.tracking_number):('Box '+(si+1)),by:nameFor(s.shipped_by)});
          });
          fEvents.sort((a,b)=>new Date(b.ts||0)-new Date(a.ts||0));
          const planned=[];
          if(o.deliver_on_date)planned.push({label:'Scheduled delivery',date:o.deliver_on_date});
          if(o.ship_on_date)planned.push({label:'Scheduled ship',date:o.ship_on_date});
          if(fEvents.length===0&&planned.length===0)return null;
          const fmt=(ts)=>{const d=new Date(ts);return isNaN(d)?(ts||'—'):d.toLocaleDateString()+' @ '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});};
          return<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Fulfillment</div>
            {planned.map((p,pi)=><div key={'p'+pi} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#fffbeb',borderRadius:6,border:'1px solid #fde68a',marginBottom:4}}>
              <span style={{fontSize:16}}>🗓️</span>
              <div><div style={{fontSize:13,fontWeight:600,color:'#92400e'}}>{p.label}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{new Date(p.date).toLocaleDateString()}</div></div>
            </div>)}
            {fEvents.map((ev,ei)=><div key={ei} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:6,border:'1px solid #bbf7d0',marginBottom:4}}>
              <span style={{fontSize:16}}>{ev.type==='delivered'?'🚚':'📦'}</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{ev.type==='delivered'?'Delivered':'Shipped'}{ev.detail?' — '+ev.detail:''}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{fmt(ev.ts)} · by {ev.by}</div></div>
            </div>)}
          </div>;
        })()}
        {/* Change Log */}
        <div>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Changes</div>
          {(()=>{const docLogs=(changeLogProp||[]).filter(c=>c.entityId===o.id);
            return docLogs.length===0?<div style={{fontSize:12,color:'#94a3b8',padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>No changes recorded</div>
            :<div style={{border:'1px solid #e2e8f0',borderRadius:6,overflow:'hidden'}}>{docLogs.slice(0,50).map((c,ci)=><div key={ci} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:ci<docLogs.length-1&&ci<49?'1px solid #f1f5f9':'none',fontSize:12}}>
              <span style={{padding:'1px 6px',borderRadius:6,fontSize:10,fontWeight:600,whiteSpace:'nowrap',
                background:c.action==='created'?'#dcfce7':c.action==='updated'?'#dbeafe':c.action==='deleted'?'#fef2f2':c.action==='split'?'#f5f3ff':'#f1f5f9',
                color:c.action==='created'?'#166534':c.action==='updated'?'#1e40af':c.action==='deleted'?'#dc2626':c.action==='split'?'#7c3aed':'#475569'
              }}>{c.action}</span>
              <span style={{fontWeight:600}}>{c.user?.split(' ')[0]}</span>
              <span style={{color:'#94a3b8',fontSize:10,whiteSpace:'nowrap'}}>{c.ts}</span>
              <span style={{color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{c.detail}</span>
            </div>)}</div>})()}
        </div>
      </div>
    </div>}

    <SendModal isOpen={showSend} onClose={()=>setShowSend(false)} estimate={o} customer={cust} docType={isE?'estimate':'so'} buildAttachmentHtml={()=>{
      const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const items=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
      const _pAQ={};items.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
      const isRolled=(o.pricing_mode||'itemized')==='rolled_up';const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);
      const rows=[];let subTotal=0;
      items.forEach(it=>{
        const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);
        const decos=safeDecos(it);const decoSell=decos.reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);return a+dp2.sell},0);
        const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
        const unitPrice=isRolled?safeNum(it.unit_sell)+decoSell:safeNum(it.unit_sell);const lineAmt=qty*unitPrice;subTotal+=lineAmt;
        let itemName=(it.name||'')+(it.color?' - '+it.color:'');
        if(szStr)itemName+='<br/><span>'+szStr+'</span>';
        if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
        rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
        if(!isRolled){decos.forEach(d=>{
          const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);const artF=af.find(a2=>a2.id===d.art_file_id);
          const decoLabel=pdfDecoLabel(d,artF);
          const posLabel=d.position?' — '+d.position:'';const decoAmt=qty*dp2.sell;subTotal+=decoAmt;
          rows.push({_class:'deco-row',cells:[{value:qty,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+decoLabel+posLabel+'</span>'},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
        })}
      });
      const shipAmt=o.shipping_type==='pct'?subTotal*(o.shipping_value||0)/100:(o.shipping_value||0);
      const _ec=o.credit_applied?safeNum(o.credit_amount):0;const _ecSub=Math.min(_ec,subTotal);const _ecRed=Math.max(0,subTotal-_ecSub);
      const taxAmt=_ec>0?_ecRed*taxRate:subTotal*taxRate;const _ecApp=Math.min(_ec,subTotal+shipAmt+taxAmt);
      const total=subTotal+shipAmt+taxAmt-_ecApp;
      const billAddr=cust?.shipping_address_line1?cust.shipping_address_line1+(cust.shipping_city?'<br/>'+cust.shipping_city+(cust.shipping_state?' '+cust.shipping_state:'')+(cust.shipping_zip?' '+cust.shipping_zip:''):'')+'<br/>United States':(cust?.billing_address_line1?cust.billing_address_line1+(cust.billing_city?'<br/>'+cust.billing_city+(cust.billing_state?' '+cust.billing_state:'')+(cust.billing_zip?' '+cust.billing_zip:''):'')+'<br/>United States':'');
      return buildDocHtml({title:cust?.name||'Customer',docNum:o.id,docType:isE?'ESTIMATE':'SALES ORDER',css:PRINT_CSS,
        headerRight:'<div class="ta">'+_$(total)+'</div>'+(isE?'<div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>':''),
        infoBoxes:[{label:'Bill To',value:cust?.name||'—',sub:billAddr||''},{label:isE?'Expires':'Expected',value:isE?new Date(Date.now()+30*86400000).toLocaleDateString():(o.expected_date||'TBD')},{label:'Sales Rep',value:REPS.find(r=>r.id===o.created_by)?.name||'—'},{label:isE?'Estimate':'Sales Order',value:o.id},{label:'Memo',value:o.memo||'—'}],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],rows:[...rows,
          {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
          ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(shipAmt),style:'text-align:right;border:none'}]}]:[]),
          ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(taxRate*100).toFixed(3)+'%)</strong>',style:'text-align:right;border:none'},{value:_$(taxAmt),style:'text-align:right;border:none'}]}]:[]),
          ...(_ecApp>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$(_ecApp)+'</strong>',style:'text-align:right;border:none'}]}]:[]),
          {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(total)+'</strong>',style:'text-align:right'}]}]}],
        footer:isE?'This estimate is valid for 30 days. Prices subject to change. '+_ci.depositTerms:_ci.terms});
    }} repUser={cu} companyInfo={_ci} defaultFollowUpDays={portalSettings?.estFollowUpDays||portalSettings?.followUpDays||7} onSend={({followUpDays:fuDays,toEmails:_toEmails,messageId:_msgId}={})=>{
      const now=new Date().toLocaleString();const fuAt=fuDays?new Date(Date.now()+fuDays*86400000).toISOString():null;
      const histEntry={sent_at:now,sent_by:cu.name||cu.id,type:isE?'estimate':'so',to:_toEmails||'',messageId:_msgId||null};
      const updates={email_status:'sent',email_sent_at:now,follow_up_at:fuAt,sent_history:[...(o.sent_history||[]),histEntry]};
      if(isE&&o.status!=='approved'&&o.status!=='converted'){sv('status','sent');Object.entries(updates).forEach(([k,v])=>sv(k,v));onSave({...o,status:'sent',...updates});nf('Estimate sent!')}
      else{Object.entries(updates).forEach(([k,v])=>sv(k,v));onSave({...o,...updates});nf((isE?'Estimate':'Sales Order')+' sent!')}}}/>

    {/* ROSTER UPLOAD DRAG & DROP MODAL */}
    {rosterUploadModal&&(()=>{const rum=rosterUploadModal;
      const processFile=(f)=>{if(!f)return;const reader=new FileReader();reader.onload=ev=>{const lines=ev.target.result.split('\n').filter(l=>l.trim());if(lines.length<2){nf('CSV appears empty','error');return}
        const hdr=lines[0].toLowerCase();const hasHeader=hdr.includes('size');const dataLines=hasHeader?lines.slice(1):lines;
        const cols=lines[0].split(',');const numColIdx=cols.findIndex(c=>c.trim().toLowerCase()==='number'||c.trim().toLowerCase()==='#'||c.trim().toLowerCase()==='num');
        const nameColIdx=cols.findIndex(c=>c.trim().toLowerCase()==='name'||c.trim().toLowerCase()==='player');
        const nr={...(rum.roster||{})};let numCt=0;const namesDeco=safeDecos(rum.item).find((dd,ddi)=>dd.kind==='names'&&ddi!==rum.di);const nn=namesDeco?{...(namesDeco.names||{})}:null;let nameCt=0;
        dataLines.forEach(line=>{const parts=line.split(',').map(s=>s.trim());const sz=parts[0];if(!sz||!rum.item.sizes[sz]||rum.item.sizes[sz]<=0)return;
          const num=numColIdx>=1?parts[numColIdx]:parts[1]||'';
          const name=nameColIdx>=1?parts[nameColIdx]:(parts.length>=3?parts[2]:'');
          if(num){if(!nr[sz])nr[sz]=Array(rum.item.sizes[sz]||0).fill('');const ei=nr[sz].findIndex(v=>!v);if(ei>=0){nr[sz][ei]=num;numCt++}}
          if(name&&nn!==null){if(!nn[sz])nn[sz]=Array(rum.item.sizes[sz]||0).fill('');const ei=nn[sz].findIndex(v=>!v);if(ei>=0){nn[sz][ei]=name;nameCt++}}});
        uD(rum.idx,rum.di,'roster',nr);if(nn!==null&&nameCt>0){const ndi=safeDecos(rum.item).findIndex(dd=>dd.kind==='names');if(ndi>=0)uD(rum.idx,ndi,'names',nn)}
        nf(numCt+' numbers'+(nameCt>0?' + '+nameCt+' names':'')+' imported');setRosterUploadModal(null);setRosterUploadDragOver(false)};reader.readAsText(f)};
      return<div className="modal-overlay" onClick={()=>{setRosterUploadModal(null);setRosterUploadDragOver(false)}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
        <div className="modal-header"><h2>📤 Upload Roster</h2><button className="modal-close" onClick={()=>{setRosterUploadModal(null);setRosterUploadDragOver(false)}}>x</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:6,marginBottom:16,fontSize:12}}>
            <strong>{rum.item.sku||'Item'}</strong> · {rum.item.name||''} · {rum.item.color||''} · {rum.sizedQtys.map(([sz,q])=>sz+'('+q+')').join(', ')}
          </div>
          <div
            onDragOver={e=>{e.preventDefault();setRosterUploadDragOver(true)}}
            onDragLeave={e=>{e.preventDefault();setRosterUploadDragOver(false)}}
            onDrop={e=>{e.preventDefault();setRosterUploadDragOver(false);processFile(e.dataTransfer.files[0])}}
            onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.csv,.xlsx,.xls,.txt';inp.onchange=()=>processFile(inp.files[0]);inp.click()}}
            style={{border:'2px dashed '+(rosterUploadDragOver?'#2563eb':'#cbd5e1'),borderRadius:12,padding:'40px 20px',textAlign:'center',cursor:'pointer',
              background:rosterUploadDragOver?'#eff6ff':'#f8fafc',transition:'all 0.2s ease'}}>
            <div style={{fontSize:36,marginBottom:8}}>{rosterUploadDragOver?'📥':'📂'}</div>
            <div style={{fontSize:14,fontWeight:600,color:rosterUploadDragOver?'#2563eb':'#334155',marginBottom:4}}>
              {rosterUploadDragOver?'Drop file here':'Drag & drop your roster file here'}
            </div>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>or click to browse</div>
            <div style={{fontSize:11,color:'#94a3b8'}}>Accepts .csv, .xlsx, .xls, .txt</div>
          </div>
          <div style={{marginTop:16,padding:10,background:'#f0fdf4',borderRadius:6,border:'1px solid #bbf7d0',fontSize:11,color:'#166534'}}>
            <strong>Expected format:</strong> Size, Number, Name (one per line)<br/>
            <span style={{color:'#64748b'}}>Example: M,12,John Smith</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>{setRosterUploadModal(null);setRosterUploadDragOver(false)}}>Cancel</button>
        </div>
      </div></div>})()}

    {/* ROSTER SEND TO COACH MODAL */}
    {rosterSendModal&&(()=>{const rsm=rosterSendModal;const contacts=(cust?.contacts||[]).filter(c=>c.email);
      const resolvedEmail=rsmTo==='_custom'?rsmCustom:rsmTo;
      const doRsmSend=async()=>{
        if(!resolvedEmail||!resolvedEmail.includes('@')){nf('Enter a valid email','error');return}
        setRsmSending(true);
        const linkData=btoa(JSON.stringify({so:o.id,sku:rsm.item.sku||'CUSTOM',item:rsm.item.name||'Item',color:rsm.item.color||'',sizes:rsm.item.sizes,rep_email:cuEmail,rep_name:cu?.name||'',coach_name:rsmName}));
        const rosterUrl=window.location.origin+'/roster.html?d='+linkData;
        try{const res=await sendBrevoEmail({to:[{email:resolvedEmail,name:rsmName}],subject:'Roster Number Assignment — '+(o.id||'Order')+' '+(rsm.item.name||'Item'),
          htmlContent:'<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center"><h2 style="margin:0">🏈 Roster Number Request</h2></div><div style="background:white;padding:20px;border:1px solid #e2e8f0;border-radius:0 0 8px 8px"><p>Hi '+rsmName+',</p><p>'+(cu?.name||'Your sales rep')+' at National Sports Apparel needs jersey numbers assigned for <strong>'+(rsm.item.name||'Item')+'</strong> ('+(o.id||'Order')+').</p><p>Please click the button below to assign numbers to each size:</p><p style="text-align:center;margin:20px 0"><a href="'+rosterUrl+'" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Assign Numbers →</a></p><p style="color:#64748b;font-size:12px">If the button doesn\'t work, copy this link: '+rosterUrl+'</p></div></div>',
          senderName:cu?.name||'National Sports Apparel',senderEmail:'noreply@nationalsportsapparel.com',replyTo:cuEmail?{email:cuEmail,name:cu?.name}:undefined});
          if(res.ok){nf('Roster request sent to '+resolvedEmail);setRosterSendModal(null)}else{nf('Failed: '+(res.error||'Unknown'),'error')}}catch(e){nf('Error: '+e.message,'error')}
        setRsmSending(false)};
      return<div className="modal-overlay" onClick={()=>setRosterSendModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>📧 Send Roster to Coach</h2><button className="modal-close" onClick={()=>setRosterSendModal(null)}>x</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:6,marginBottom:12,fontSize:12}}>
            <strong>{o.id}</strong> · {rsm.item.sku} · {rsm.item.name||'Item'} · {rsm.item.color||''}
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Send To</label>
            {contacts.length>0?<select className="form-select" value={rsmTo} onChange={e=>{setRsmTo(e.target.value);if(e.target.value!=='_custom'){const c=contacts.find(cc=>cc.email===e.target.value);setRsmName(c?.name||'Coach')}}}>
              {contacts.map((c,ci)=><option key={ci} value={c.email}>{c.name||c.email} ({c.email})</option>)}
              <option value="_custom">Other email...</option>
            </select>:<input className="form-input" placeholder="Coach email address" value={rsmCustom} onChange={e=>{setRsmCustom(e.target.value);setRsmTo('_custom')}}/>}
            {rsmTo==='_custom'&&<input className="form-input" style={{marginTop:6}} placeholder="Enter email address" value={rsmCustom} onChange={e=>setRsmCustom(e.target.value)}/>}
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Coach Name</label>
            <input className="form-input" value={rsmName} onChange={e=>setRsmName(e.target.value)} placeholder="Coach"/>
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Roster Link</label>
            <div style={{display:'flex',gap:6}}>
              <input className="form-input" readOnly value={rsm.rosterUrl} style={{fontSize:11,color:'#64748b',flex:1}}/>
              <button className="btn btn-sm btn-secondary" style={{whiteSpace:'nowrap'}} onClick={()=>{navigator.clipboard.writeText(rsm.rosterUrl);setRsmCopied(true);setTimeout(()=>setRsmCopied(false),2000)}}>{rsmCopied?'Copied!':'Copy Link'}</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Share this link directly if you prefer not to send an email</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setRosterSendModal(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={rsmSending||(!resolvedEmail||!resolvedEmail.includes('@'))} onClick={doRsmSend}>{rsmSending?'Sending...':'Send to Coach'}</button>
        </div>
      </div></div>})()}

    {/* FIRM DATE REQUEST MODAL */}
    {showFirmReq&&<div className="modal-overlay" onClick={()=>setShowFirmReq(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
      <div className="modal-header"><h2>📌 Request Firm Date</h2><button className="modal-close" onClick={()=>setShowFirmReq(false)}>x</button></div>
      <div className="modal-body">
        <div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:12}}>
          <div style={{fontWeight:700,color:'#1e40af'}}>{o.id}</div>
          <div style={{fontSize:12,color:'#64748b'}}>{cust?.name} — {o.memo}</div>
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Current expected: {o.expected_date||'Not set'}</div>
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">Requested Firm Date *</label>
          <input className="form-input" type="date" value={firmReqDate} onChange={e=>setFirmReqDate(e.target.value)}/>
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">Note to Production Manager</label>
          <textarea className="form-input" rows={3} value={firmReqNote} onChange={e=>setFirmReqNote(e.target.value)} placeholder="e.g., Coach needs by this date for first game, already confirmed with Adidas they can ship by 3/5..."/>
        </div>
        <div style={{padding:10,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:6,fontSize:11,color:'#6d28d9'}}>
          <strong>Preview message to Production Manager:</strong>
          <div style={{marginTop:4,padding:8,background:'white',borderRadius:4,fontSize:12,color:'#374151'}}>
            <strong>{cu.name}</strong> is requesting a firm date for <strong>{o.id}</strong> ({cust?.name} — {o.memo}).<br/>
            📅 Requested: <strong>{firmReqDate||'—'}</strong><br/>
            {firmReqNote&&<>💬 {firmReqNote}<br/></>}
            <span style={{color:'#7c3aed',textDecoration:'underline'}}>→ Open {o.id}</span>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowFirmReq(false)}>Cancel</button>
        <button className="btn btn-primary" style={{background:'#7c3aed'}} disabled={!firmReqDate} onClick={()=>{
          // Create message in SO thread
          const msg={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,
            text:'📌 FIRM DATE REQUEST: '+firmReqDate+(firmReqNote?' — '+firmReqNote:''),
            ts:new Date().toLocaleString(),read_by:[cu.id],
            firm_request:true,firm_date:firmReqDate,tagged_members:[],entity_type:'so',entity_id:o.id};
          onMsg(prev=>[...prev,msg]);
          // Add to firm_dates on the SO
          const fd=[...safeFirm(o),{item_desc:'Full Order',date:firmReqDate,approved:false,requested_by:cu.name,requested_at:new Date().toLocaleString(),note:firmReqNote}];
          sv('firm_dates',fd);
          setShowFirmReq(false);
          nf('Firm date request sent to GM!');
        }}>📌 Send Request to GM</button>
      </div>
    </div></div>}

    {/* FIRM DATE APPROVE MODAL */}
    {showFirmApprove&&(()=>{const fd=safeFirm(o)[0];if(!fd)return null;return<div className="modal-overlay" onClick={()=>setShowFirmApprove(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:480}}>
      <div className="modal-header"><h2>📌 Review Firm Date Request</h2><button className="modal-close" onClick={()=>setShowFirmApprove(false)}>x</button></div>
      <div className="modal-body">
        <div style={{padding:12,background:'#f8fafc',borderRadius:6,marginBottom:12}}>
          <div style={{fontWeight:700,color:'#1e40af'}}>{o.id} — {cust?.name}</div>
          <div style={{fontSize:12,color:'#64748b'}}>{o.memo}</div>
          <div style={{fontSize:12,marginTop:4}}>Requested by: <strong>{fd.requested_by}</strong> on {fd.requested_at}</div>
          <div style={{fontSize:13,marginTop:4,color:'#7c3aed',fontWeight:700}}>Firm Date: {fd.date}</div>
          {fd.note&&<div style={{fontSize:12,color:'#64748b',marginTop:4}}>Note: {fd.note}</div>}
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">Rush Fee — In-House Decoration Cost Increase</label>
          <div style={{display:'flex',gap:6,marginTop:4}}>
            {[{v:0,l:'No Rush Fee'},{v:10,l:'+10%'},{v:25,l:'+25%'},{v:50,l:'+50%'}].map(opt=>
              <button key={opt.v} className={`btn btn-sm ${firmRushPct===opt.v?'btn-primary':'btn-secondary'}`} style={firmRushPct===opt.v?{background:'#7c3aed',borderColor:'#7c3aed'}:{}} onClick={()=>setFirmRushPct(opt.v)}>{opt.l}</button>)}
          </div>
          <div style={{fontSize:10,color:'#64748b',marginTop:4}}>Applies only to in-house decoration costs, not garment costs.</div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setShowFirmApprove(false)}>Cancel</button>
        <button className="btn btn-primary" style={{background:'#7c3aed'}} onClick={()=>{
          const fds=safeFirm(o).map((f,i)=>i===0?{...f,approved:true,approved_by:cu.name,approved_at:new Date().toLocaleString(),rush_pct:firmRushPct}:f);
          sv('firm_dates',fds);
          sv('expected_date',fd.date);
          const msg={id:'m'+Date.now(),so_id:o.id,author_id:cu.id,
            text:'✅ FIRM DATE APPROVED: '+fd.date+(firmRushPct>0?' — Rush fee: +'+firmRushPct+'% on in-house decoration':''),
            ts:new Date().toLocaleString(),read_by:[cu.id],firm_approved:true,firm_date:fd.date,tagged_members:[],entity_type:'so',entity_id:o.id};
          onMsg(prev=>[...prev,msg]);
          setShowFirmApprove(false);setFirmRushPct(0);
          nf('Firm date approved'+(firmRushPct>0?' with +'+firmRushPct+'% deco rush fee':''));
        }}>✅ Approve Firm Date</button>
      </div>
    </div></div>})()}

    {/* CREATE INVOICE MODAL */}
    {showInvCreate&&(()=>{
      const items=safeItems(o);
      const isPromoOrder=o.promo_applied;
      // Per-SO-item invoiced qty across prior invoices for this SO — used to prevent double-billing the same line
      const _priorInvs=(allInvoices||[]).filter(inv=>inv.so_id===o.id);
      const invoicedQtyMap=buildInvoicedQtyMap(o,_priorInvs);
      const depositCredit=sumDepositInvoiced(_priorInvs);
      // Compute per-item totals — for promo orders, only non-promo items are invoiceable.
      // For non-deposit invoices, the effective qty drops to the remaining-to-invoice
      // qty so the same line can't be billed twice across partial/full/final.
      const itemTotals=items.map((it,idx)=>{const szQty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const fullQty=szQty>0?szQty:safeNum(it.est_qty);
        const invoiced=invoicedQtyMap.get(soLineKey(it,idx))||0;
        const remaining=Math.max(0,fullQty-invoiced);
        const qty=invType==='deposit'?fullQty:remaining;
        const rev=qty*safeNum(it.unit_sell);
        let decoRev=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp2=dP(d,qty,safeArt(o),cq);decoRev+=qty*dp2.sell});
        // Promo items are covered by promo funds — $0 on invoice
        if(isPromoOrder&&it.is_promo)return{qty,fullQty,remaining,invoiced,rev:0,decoRev:0,total:0,isPromo:true};
        // Partially promo items: discount is already baked into unit_sell and deco sell_overrides
        // (new blended-sell format with _promo_partial_qty). Legacy items without the new field fall
        // back to the prior _promo_credit subtraction for backward compatibility.
        const usesBlended=safeNum(it._promo_partial_qty)>0;
        const promoCredit=isPromoOrder&&!usesBlended?safeNum(it._promo_credit):0;
        return{qty,fullQty,remaining,invoiced,rev,decoRev,total:Math.max(0,rev+decoRev-promoCredit),isPromo:false}});

      // For deposit: use full order total * pct
      // For partial: use selected items total (qty already reflects remaining-to-bill)
      // For final: use full order total
      const activeItems=invType==='partial'?invSelItems:items.map((_,i)=>i);
      const selTotals=activeItems.reduce((acc,idx)=>{const t=itemTotals[idx];if(!t)return acc;return{items:acc.items+1,units:acc.units+t.qty,subtotal:acc.subtotal+t.total}},{items:0,units:0,subtotal:0});
      // Prorate shipping & tax against the FULL order subtotal so a partial invoice
      // billing the remaining 5 of 26 units pays its share — not the full shipping
      // line the prior invoice already prorated against.
      const fullSubtotalByItem=items.map((it)=>{const _sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const fq=_sq>0?_sq:safeNum(it.est_qty);const rev=fq*safeNum(it.unit_sell);let dr=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:fq;const dp2=dP(d,fq,safeArt(o),cq);dr+=fq*dp2.sell});if(isPromoOrder&&it.is_promo)return 0;const usesBlended=safeNum(it._promo_partial_qty)>0;const pc=isPromoOrder&&!usesBlended?safeNum(it._promo_credit):0;return Math.max(0,rev+dr-pc)});
      const fullOrderSub=fullSubtotalByItem.reduce((a,v)=>a+v,0)||1;
      const selFraction=Math.min(1,selTotals.subtotal/fullOrderSub);
      // For promo orders: shipping/tax on promo portion is covered by promo, only charge for non-promo portion
      const nonPromoShip=isPromoOrder?(promoTotals?totals.ship-promoTotals.promoShip:0):totals.ship;
      const nonPromoTax=isPromoOrder?0:totals.tax;
      // For deposits, bill the whole shipping/tax (the deposit percentage applies later).
      // For everything else, prorate by the fraction of the order being billed in this invoice.
      const _billingAll=invType==='deposit';
      const invShip=_billingAll?nonPromoShip:Math.round(nonPromoShip*selFraction*100)/100;
      let invTax=_billingAll?nonPromoTax:Math.round(nonPromoTax*selFraction*100)/100;
      // Credit: subtract from subtotal and recalculate tax on reduced amount
      const creditAmt=o.credit_applied?safeNum(o.credit_amount):0;
      let invCredit=0;
      if(creditAmt>0){
        invCredit=Math.min(creditAmt,selTotals.subtotal+invShip+invTax);
        // Recalculate tax: credit reduces the taxable subtotal proportionally
        const taxRate2=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);
        const creditOnSubtotal=Math.min(creditAmt,selTotals.subtotal);
        const reducedSubtotal=Math.max(0,selTotals.subtotal-creditOnSubtotal);
        invTax=Math.round(reducedSubtotal*taxRate2*100)/100;
        invCredit=Math.min(creditAmt,selTotals.subtotal+invShip+invTax);
      }
      const grossTotal=selTotals.subtotal+invShip+invTax-invCredit;
      // Prior deposit $ are already collected against this SO — apply as a credit on
      // non-deposit invoices so the new bill only charges the remaining balance.
      const depositApplied=(invType==='partial'||invType==='full'||invType==='final')?Math.min(depositCredit,grossTotal):0;
      const fullTotal=Math.max(0,grossTotal-depositApplied);
      const invTotal=invType==='deposit'?Math.round(grossTotal*invDepositPct/100*100)/100:fullTotal;

      // Existing invoices on this SO
      const soInvs=(allInvoices||[]).filter(i=>i.so_id===o.id);
      const soInvTotal=soInvs.reduce((a,i)=>a+(i.total||0),0);

      return<div className="modal-overlay" onClick={()=>setShowInvCreate(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
        <div className="modal-header"><h2>{isPromoOrder&&invTotal===0?'Close Promo Order':'Create Invoice'} — {o.id}</h2><button className="modal-close" onClick={()=>setShowInvCreate(false)}>x</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:6,marginBottom:12}}>
            <div style={{fontWeight:700,color:'#1e40af'}}>{o.id}</div>
            <div style={{fontSize:12,color:'#64748b'}}>{cust?.name} — {o.memo}</div>
            <div style={{display:'flex',gap:16,marginTop:4,fontSize:11}}>
              <span>Order total: <strong>${totals.grand.toLocaleString()}</strong></span>{isPromoOrder&&<span style={{color:'#92400e',fontWeight:600}}>Promo covers: ${safeNum(o.promo_amount).toLocaleString()}</span>}
              {soInvTotal>0&&<span>Already invoiced: <strong style={{color:'#d97706'}}>${soInvTotal.toLocaleString()}</strong></span>}
            </div>
          </div>

          {/* Promo order notice */}
          {isPromoOrder&&<div style={{marginBottom:12,padding:12,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8}}>
            <div style={{fontWeight:700,color:'#92400e',fontSize:13,marginBottom:4}}>Promo Order</div>
            <div style={{fontSize:12,color:'#78350f'}}>{invTotal===0?'This order is fully covered by promo funds. No payment is due from the customer.':'Promo covers $'+safeNum(o.promo_amount).toLocaleString()+'. Customer pays $'+invTotal.toFixed(2)+' for the non-promo portion.'}</div>
          </div>}

          {/* Invoice type */}
          <div style={{marginBottom:12}}>
            <label className="form-label">Invoice Type</label>
            <div style={{display:'flex',gap:6}}>
              {[['deposit','Deposit','Percentage of full order total'],['partial','Partial','Invoice selected items only'],['full','Invoice','Full order — SO stays open'],['final','Final','Full order — closes SO']].map(([v,l,desc])=>
                <button key={v} className={`btn btn-sm ${invType===v?'btn-primary':'btn-secondary'}`} style={{flex:1,flexDirection:'column',padding:'8px 10px'}} onClick={()=>{setInvType(v);if(v!=='partial')setInvSelItems(items.map((_,i)=>i))}}>
                  <div style={{fontWeight:700}}>{l}</div>
                  <div style={{fontSize:9,opacity:0.8,fontWeight:400,marginTop:2}}>{desc}</div>
                </button>)}
            </div>
          </div>

          {/* Deposit: percentage selector */}
          {invType==='deposit'&&<div style={{marginBottom:12,padding:12,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8}}>
            <label className="form-label" style={{color:'#1e40af'}}>Deposit Percentage</label>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              {[25,50,75].map(p=><button key={p} className={`btn btn-sm ${invDepositPct===p?'btn-primary':'btn-secondary'}`} onClick={()=>setInvDepositPct(p)}>{p}%</button>)}
              <div style={{display:'flex',alignItems:'center',gap:4,marginLeft:'auto'}}>
                <input type="number" min={1} max={100} value={invDepositPct} onChange={e=>setInvDepositPct(Math.max(1,Math.min(100,parseInt(e.target.value)||0)))} style={{width:60,textAlign:'center',border:'1px solid #93c5fd',borderRadius:4,padding:'4px 6px',fontSize:14,fontWeight:700}}/>
                <span style={{fontSize:12,fontWeight:600}}>%</span>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
              <span style={{color:'#64748b'}}>Full order: ${fullTotal.toFixed(2)}</span>
              <span style={{fontWeight:700,color:'#1e40af'}}>Deposit: ${invTotal.toFixed(2)}</span>
            </div>
          </div>}

          {/* Partial: item selection */}
          {invType==='partial'&&<div style={{marginBottom:12}}>
            <label className="form-label">Select Items to Invoice</label>
            <div style={{display:'flex',gap:4,marginBottom:8}}>
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems(items.map((_,i)=>i).filter(i=>(itemTotals[i]?.remaining||0)>0))}>Select All Remaining</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems([])}>Clear</button>
            </div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
              {items.map((it,idx)=>{
                const sel=invSelItems.includes(idx);const t=itemTotals[idx];
                const fullyInvoiced=t.invoiced>0&&t.remaining===0;
                return<div key={idx} style={{padding:'10px 14px',borderBottom:idx<items.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10,cursor:fullyInvoiced?'not-allowed':'pointer',background:fullyInvoiced?'#f8fafc':(sel?'#eff6ff':'white'),opacity:fullyInvoiced?0.55:1}} onClick={()=>{if(fullyInvoiced)return;setInvSelItems(sel?invSelItems.filter(i=>i!==idx):[...invSelItems,idx])}}>
                  <input type="checkbox" checked={sel&&!fullyInvoiced} disabled={fullyInvoiced} readOnly style={{accentColor:'#2563eb',width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontFamily:'monospace',color:'#1e40af'}}>{it.sku||'—'}</span> {safeStr(it.name)||'Item'}
                      {t.invoiced>0&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:8,background:fullyInvoiced?'#d1d5db':'#fef3c7',color:fullyInvoiced?'#475569':'#92400e',fontWeight:700}}>{fullyInvoiced?'Fully invoiced':t.invoiced+' of '+t.fullQty+' invoiced'}</span>}
                    </div>
                    <div style={{fontSize:11,color:'#64748b'}}>{safeStr(it.color)||'—'} · {t.remaining} of {t.fullQty} units remaining · ${safeNum(it.unit_sell).toFixed(2)}/ea{t.decoRev>0?' + $'+t.decoRev.toFixed(2)+' deco':''}</div>
                  </div>
                  <div style={{fontWeight:700,fontSize:13,color:sel?'#1e40af':'#94a3b8'}}>${t.total.toFixed(2)}</div>
                </div>})}
            </div>
          </div>}

          {/* Full Invoice: SO stays open */}
          {invType==='full'&&<div style={{marginBottom:12,padding:12,background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:8}}>
            <div style={{fontWeight:700,color:'#047857',fontSize:13,marginBottom:4}}>Invoice (Full Order)</div>
            <div style={{fontSize:12,color:'#065f46'}}>This will invoice the full order amount. <strong>{o.id}</strong> will stay open so you can continue working on it.</div>
            {soInvTotal>0&&<div style={{fontSize:11,color:'#047857',marginTop:4,padding:'4px 8px',background:'#d1fae5',borderRadius:4}}>Note: ${soInvTotal.toLocaleString()} already invoiced on this SO.</div>}
          </div>}

          {/* Final: warning about closing SO */}
          {invType==='final'&&<div style={{marginBottom:12,padding:12,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8}}>
            <div style={{fontWeight:700,color:'#dc2626',fontSize:13,marginBottom:4}}>Final Invoice</div>
            <div style={{fontSize:12,color:'#991b1b'}}>This will invoice the full order amount and mark <strong>{o.id}</strong> as <strong>Complete</strong>.</div>
            {soInvTotal>0&&<div style={{fontSize:11,color:'#b91c1c',marginTop:4,padding:'4px 8px',background:'#fee2e2',borderRadius:4}}>Note: ${soInvTotal.toLocaleString()} already invoiced on this SO. This final invoice will be for the full remaining order value.</div>}
          </div>}

          {/* Memo + Invoice Date */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 160px',gap:12,marginBottom:12}}>
            <div>
              <label className="form-label">Invoice Memo</label>
              <input className="form-input" value={invMemo} onChange={e=>setInvMemo(e.target.value)} placeholder={invType==='deposit'?'e.g., '+invDepositPct+'% Deposit — '+o.memo:invType==='partial'?'e.g., Partial — Hats only':invType==='full'?'e.g., Invoice — '+o.memo:'e.g., Final Invoice — '+o.memo}/>
            </div>
            <div>
              <label className="form-label">Invoice Date</label>
              <input className="form-input" type="date" value={invDate} onChange={e=>setInvDate(e.target.value||new Date().toLocaleDateString('en-CA'))}/>
              <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Drives the due date based on customer terms.</div>
            </div>
          </div>

          {/* Billing Address + PO# */}
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,marginBottom:12}}>
            <div>
              <label className="form-label">Bill To</label>
              {(()=>{const parentCust=cust?.parent_id?allCustomers.find(c=>c.id===cust.parent_id):cust;const altAddrs=(parentCust?.alt_billing_addresses||[]).filter(a=>a.label||a.street);
                const defaultLabel=cust?.name+(cust?.billing_address_line1?' — '+cust.billing_address_line1:'');
                return altAddrs.length>0?<select className="form-select" value={invBilling} onChange={e=>setInvBilling(e.target.value)}>
                  <option value="">{defaultLabel}</option>
                  {altAddrs.map((a,i)=><option key={i} value={JSON.stringify(a)}>{a.label||'Alt '+(i+1)} — {a.street} {a.city}, {a.state}</option>)}
                </select>:<div style={{fontSize:12,color:'#475569',padding:'6px 0'}}>{defaultLabel}</div>})()}
            </div>
            {o.po_number&&<div>
              <label className="form-label">School PO#</label>
              <div style={{fontSize:13,fontWeight:700,fontFamily:'monospace',color:'#1e40af',padding:'6px 0'}}>{o.po_number}</div>
            </div>}
          </div>

          {/* Summary */}
          <div style={{background:'#f8fafc',borderRadius:8,padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>{invType==='deposit'||invType==='full'||invType==='final'?'Full order':'Selected items'}</span>
              <span style={{fontSize:12,fontWeight:600}}>{selTotals.items} items · {selTotals.units} units</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>Subtotal</span>
              <span style={{fontSize:12,fontWeight:600}}>${selTotals.subtotal.toFixed(2)}</span>
            </div>
            {invShip>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>Shipping</span>
              <span style={{fontSize:12}}>${(invType==='deposit'?invShip*invDepositPct/100:invShip).toFixed(2)}</span>
            </div>}
            {invTax>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#64748b'}}>Tax</span>
              <span style={{fontSize:12}}>${(invType==='deposit'?invTax*invDepositPct/100:invTax).toFixed(2)}</span>
            </div>}
            {invCredit>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#065f46',fontWeight:600}}>Credit Applied</span>
              <span style={{fontSize:12,fontWeight:700,color:'#065f46'}}>-${(invType==='deposit'?invCredit*invDepositPct/100:invCredit).toFixed(2)}</span>
            </div>}
            {depositApplied>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#065f46',fontWeight:600}}>Deposit Applied</span>
              <span style={{fontSize:12,fontWeight:700,color:'#065f46'}}>-${depositApplied.toFixed(2)}</span>
            </div>}
            {invType==='deposit'&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:'#1e40af',fontWeight:600}}>Deposit ({invDepositPct}%)</span>
              <span style={{fontSize:12,fontWeight:700,color:'#1e40af'}}>${invTotal.toFixed(2)}</span>
            </div>}
            <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,borderTop:'2px solid #e2e8f0'}}>
              <span style={{fontSize:14,fontWeight:800}}>Invoice Total</span>
              <span style={{fontSize:18,fontWeight:800,color:'#dc2626'}}>${invTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setShowInvCreate(false)}>Cancel</button>
          <button className="btn btn-primary" style={invType==='final'?{background:'#dc2626',borderColor:'#dc2626'}:{}} disabled={invType==='partial'&&invSelItems.length===0} onClick={()=>{
            const invId=nextInvId(allInvoices);
            const _invDateStr=invDate||new Date().toLocaleDateString('en-CA');
            const termDays=parseInt((cust?.payment_terms||'net30').replace(/\D/g,''))||30;
            const _dueBase=new Date(_invDateStr+'T00:00:00');_dueBase.setDate(_dueBase.getDate()+termDays);const dueDate=_dueBase.toLocaleDateString('en-CA');
            const lineItems=activeItems.map(idx=>{const it=items[idx];if(!it)return null;const _szQty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const totalQty=_szQty>0?_szQty:safeNum(it.est_qty);
              // Subtract qty already invoiced so the same line can't be billed twice across partial/full/final.
              // Deposits bill a % of the whole order and intentionally use the full qty.
              const alreadyInvoiced=invType==='deposit'?0:(invoicedQtyMap.get(soLineKey(it,idx))||0);
              const qty=Math.max(0,totalQty-alreadyInvoiced);
              if(invType!=='deposit'&&qty===0)return null;
              const decoSell=safeDecos(it).reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp2=dP(d,qty,safeArt(o),cq);return a+dp2.sell},0);
              const lineAmt=qty*(safeNum(it.unit_sell)+decoSell);
              return{desc:it.sku+' '+it.name+(it.color?' — '+it.color:''),qty,rate:safeNum(it.unit_sell)+decoSell,amount:invType==='deposit'?Math.round(lineAmt*invDepositPct/100*100)/100:lineAmt,
                _sku:it.sku,_name:it.name,_color:it.color,_so_line_key:soLineKey(it,idx)}}).filter(Boolean);
            const invShipAmt=invType==='deposit'?Math.round(invShip*invDepositPct/100*100)/100:invShip;
            const invTaxAmt=invType==='deposit'?Math.round(invTax*invDepositPct/100*100)/100:invTax;
            const defaultMemo=invType==='deposit'?invDepositPct+'% Deposit — '+o.memo:invType==='partial'?'Partial — '+o.memo:invType==='full'?'Invoice — '+o.memo:'Final Invoice — '+o.memo;
            const billingOverride=invBilling?JSON.parse(invBilling):null;
            const inv={id:invId,type:'invoice',inv_type:invType,customer_id:o.customer_id,so_id:o.id,
              date:_invDateStr,due_date:dueDate,total:Math.round(invTotal*100)/100,paid:0,
              memo:invMemo||defaultMemo,status:'open',_rep:o.created_by||cu.id,
              tax:Math.round(invTaxAmt*100)/100,tax_rate:o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0),tax_exempt:o.tax_exempt||cust?.tax_exempt||false,shipping:Math.round(invShipAmt*100)/100,
              ...(invType==='deposit'?{deposit_pct:invDepositPct}:{}),
              ...(billingOverride?{billing_name:billingOverride.label||'',billing_address:[billingOverride.street,billingOverride.city,billingOverride.state,billingOverride.zip].filter(Boolean).join(', ')}:{}),
              ...(o.po_number?{_po_number:o.po_number}:{}),
              ...(invCredit>0?{credit_amount:Math.round((invType==='deposit'?invCredit*invDepositPct/100:invCredit)*100)/100}:{}),
              ...(depositApplied>0?{deposit_applied:Math.round(depositApplied*100)/100}:{}),
              line_items:lineItems,
              items:activeItems.map(idx=>{const it=items[idx];const _sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return{sku:it.sku,name:it.name,qty:_sq>0?_sq:safeNum(it.est_qty),unit_sell:safeNum(it.unit_sell)}})};
            onInv(prev=>[...prev,inv]);
            // Final invoice: mark SO as complete
            if(invType==='final'){const updated={...o,status:'complete',updated_at:new Date().toLocaleString()};setO(updated);onSave(updated)}
            setShowInvCreate(false);
            nf('Invoice '+inv.id+' created for $'+invTotal.toFixed(2)+(invType==='final'?' — SO marked complete':''));
            // Show invoice review page instead of navigating away
            setInvReview({...inv,_customer:cust,_so:o,_lineItems:lineItems,_shipAmt:invShipAmt,_taxAmt:invTaxAmt});
            const contact=(cust?.contacts||[])[0];
            const invPortalUrl=cust?.alpha_tag?'https://nsa-portal.netlify.app/?portal='+cust.alpha_tag:'';
            setInvSendMsg('Hi '+(contact?.name||'Coach')+',\n\nPlease find the attached invoice '+inv.id+' for $'+invTotal.toFixed(2)+'. Payment is due by '+dueDate+'.'+(invPortalUrl?'\n\nYou can also view your invoice through your portal:\n'+invPortalUrl:'')+'\n\nThank you,\nNSA Team');
            setInvSmsPhone(contact?.phone||'');setInvSmsEnabled(_smsUiEnabled&&!!contact?.phone);setInvFollowUpDays(portalSettings?.invFollowUpDays||7);setInvSendAt(_invDateStr);
            setInvSmsMsg('Hi '+(contact?.name||'Coach')+', your invoice '+inv.id+' for $'+invTotal.toFixed(2)+' is ready. Due by '+dueDate+'. View: https://nsa-portal.netlify.app/?portal='+(cust?.alpha_tag||''));
          }}>{isPromoOrder&&invTotal===0?(invType==='final'?'Close Promo Order — $0 Invoice':'Create $0 Promo Invoice'):(invType==='final'?'Create Final Invoice — Close SO':invType==='full'?'Create Invoice — SO Stays Open':'Create '+invType.charAt(0).toUpperCase()+invType.slice(1)+' Invoice')} — ${invTotal.toFixed(2)}</button>
        </div>
      </div></div>})()}

    {/* ═══ INVOICE REVIEW PAGE ═══ */}
    {invReview&&(()=>{
      const ir=invReview;const ic=ir._customer||cust;const irSO=ir._so||o;
      const lineItems=ir._lineItems||ir.line_items||[];
      const shipAmt=ir._shipAmt!=null?ir._shipAmt:(ir.shipping||0);
      const taxAmt=ir._taxAmt!=null?ir._taxAmt:(ir.tax||0);
      const bal=ir.total-(ir.paid||0);
      const contact=(ic?.contacts||[])[0];
      const buildInvoiceDocOpts=()=>{
        const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        const rBillName=ir.billing_name||ic?.name||'—';const rBillSub=ir.billing_name?(ir.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':'';
        const rBillAddr=rBillSub||(ic?.billing_address_line1?ic.billing_address_line1+(ic.billing_city?'<br/>'+ic.billing_city+(ic.billing_state?' '+ic.billing_state:'')+(ic.billing_zip?' '+ic.billing_zip:''):'')+'<br/>United States':'');
        const rShipAddr=ic?.shipping_address_line1?ic.shipping_address_line1+(ic.shipping_city?'<br/>'+ic.shipping_city+(ic.shipping_state?' '+ic.shipping_state:'')+(ic.shipping_zip?' '+ic.shipping_zip:''):'')+'<br/>United States':'';
        const rPoNum=ir._po_number||irSO?.po_number;
        // Build rows with decoration detail from SO items
        const rows=[];let subTotal=0;
        const soItems=irSO?safeItems(irSO):[];const soArt=irSO?safeArt(irSO):[];
        const _pAQ={};soItems.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
        const isDeposit=ir.inv_type==='deposit';const depPct=isDeposit?(ir.deposit_pct||50)/100:1;
        if(soItems.length>0){
          soItems.forEach(it=>{
            const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);if(!qty)return;
            const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
            const unitPrice=safeNum(it.unit_sell);const lineAmt=Math.round(qty*unitPrice*depPct*100)/100;subTotal+=lineAmt;
            let itemName=(it.name||'')+(it.color?' - '+it.color:'');
            if(szStr)itemName+='<br/><span>'+szStr+'</span>';
            if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
            rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
            safeDecos(it).forEach(d=>{
              const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soArt,cq);
              const artF=soArt.find(a2=>a2.id===d.art_file_id);
              const decoLabel=pdfDecoLabel(d,artF);
              const posLabel=d.position?' — '+d.position:'';const decoAmt=Math.round(qty*dp2.sell*depPct*100)/100;subTotal+=decoAmt;
              rows.push({_class:'deco-row',cells:[{value:qty,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+decoLabel+posLabel+'</span>'},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
            });
          });
        }else{
          lineItems.forEach(li=>{subTotal+=safeNum(li.amount);rows.push({cells:[li.qty,{value:(li.desc||'').split(' ')[0],style:'font-weight:700'},{value:(li.desc||'').split(' ').slice(1).join(' ')},{value:_$(safeNum(li.rate)),style:'text-align:right'},{value:_$(safeNum(li.amount)),style:'text-align:right;font-weight:600'}]})});
        }
        return{title:rBillName,docNum:ir.id,docType:'INVOICE',
          headerRight:'<div class="ta">'+_$(ir.total)+'</div>'
            +'<div class="ts">Balance Due: <strong>'+_$(bal)+'</strong></div>'+(rPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+rPoNum+'</div>':''),
          infoBoxes:[
            {label:'Bill To',value:rBillName,sub:rBillAddr},
            ...(rShipAddr?[{label:'Ship To',value:ic?.name||'—',sub:rShipAddr}]:[]),
            {label:'Invoice Date',value:ir.date||new Date().toLocaleDateString(),sub:ir.due_date?'Due: '+ir.due_date:''},
            {label:'Sales Order',value:ir.so_id||'—',sub:ir.memo||''+(rPoNum?'<br/><strong>PO# '+rPoNum+'</strong>':'')},
            {label:'Payment Terms',value:ir.inv_type==='deposit'?(ir.deposit_pct||50)+'% Deposit':ir.inv_type==='partial'?'Partial Invoice':ir.inv_type==='full'?'Invoice':'Final Invoice',sub:''}
          ],
          tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
            rows:[...rows,
              {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
              ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(shipAmt),style:'text-align:right;border:none'}]}]:[]),
              ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$(taxAmt),style:'text-align:right;border:none'}]}]:[]),
              ...(safeNum(ir.credit_amount)>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$(safeNum(ir.credit_amount))+'</strong>',style:'text-align:right;border:none'}]}]:[]),
              {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(ir.total)+'</strong>',style:'text-align:right'}]},
              ...(ir.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$(ir.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
              ...(bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$(bal)+'</strong>',style:'text-align:right'}]}]:[]),
            ]}],
          footer:ir.inv_type==='deposit'?_ci.depositTerms:_ci.terms};
      };
      const printInvoice=()=>printDoc(buildInvoiceDocOpts());
      const downloadInvoice=async()=>{
        try{await downloadDoc(buildInvoiceDocOpts(),ir.id+(ic?.name?' - '+ic.name:''));nf('📥 Downloaded '+ir.id+'.pdf')}
        catch(err){console.warn('Invoice PDF download failed:',err);nf('Download failed: '+(err?.message||'unknown'),'error')}
      };
      return<div className="modal-overlay" onClick={()=>{setInvReview(null);setInvSentStatus(null);if(onNavInvoice)onNavInvoice(ir)}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header" style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white'}}>
          <h2 style={{color:'white'}}>Invoice Created — {ir.id}</h2>
          <button className="modal-close" style={{color:'white'}} onClick={()=>{setInvReview(null);setInvSentStatus(null);if(onNavInvoice)onNavInvoice(ir)}}>x</button>
        </div>
        <div className="modal-body" style={{padding:0}}>
          {invSentStatus&&<div style={{margin:'12px 16px 0',padding:'12px 16px',background:invSentStatus.type==='scheduled'?'#eff6ff':'#f0fdf4',border:'1px solid '+(invSentStatus.type==='scheduled'?'#93c5fd':'#86efac'),borderRadius:8,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>{invSentStatus.type==='scheduled'?'📅':'✅'}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:invSentStatus.type==='scheduled'?'#1e40af':'#166534'}}>{invSentStatus.type==='scheduled'?'Invoice scheduled':'Invoice sent'}</div>
              <div style={{fontSize:12,color:invSentStatus.type==='scheduled'?'#1e40af':'#166534',wordBreak:'break-word'}}>{invSentStatus.type==='scheduled'?'Will send on '+invSentStatus.sendAt+' to ':'Sent to '}{invSentStatus.to}</div>
            </div>
            <button onClick={()=>setInvSentStatus(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:18,padding:0,lineHeight:1}}>x</button>
          </div>}
          {/* Invoice preview */}
          <div style={{padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
              <div>
                <div style={{fontSize:22,fontWeight:900,color:'#1e3a5f'}}>INVOICE</div>
                <div style={{fontSize:14,fontWeight:700,color:'#2563eb'}}>{ir.id}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'#64748b'}}>NSA · National Sports Apparel</div>
                <div style={{fontSize:11,color:'#64748b'}}>{_ci.addr}</div>
                <div style={{fontSize:11,color:'#64748b'}}>{_ci.city}, {_ci.state} {_ci.zip}</div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16,padding:12,background:'#f8fafc',borderRadius:8}}>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase'}}>Bill To</div>{ir.billing_name?<><div style={{fontSize:13,fontWeight:700}}>{ir.billing_name}</div><div style={{fontSize:11,color:'#64748b'}}>{ir.billing_address||''}</div><div style={{fontSize:9,color:'#94a3b8'}}>on behalf of {ic?.name}</div></>:<><div style={{fontSize:13,fontWeight:700}}>{ic?.name||'—'}</div>{ic?.alpha_tag&&<div style={{fontSize:11,color:'#64748b'}}>{ic.alpha_tag}</div>}</>}{(ir._po_number||irSO?.po_number)&&<div style={{fontSize:11,fontWeight:700,color:'#1e40af',marginTop:2,fontFamily:'monospace'}}>PO# {ir._po_number||irSO?.po_number}</div>}</div>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase'}}>Date</div><div style={{fontSize:13,fontWeight:600}}>{ir.date||'—'}</div><div style={{fontSize:11,color:'#64748b'}}>Due: {ir.due_date||'—'}</div></div>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase'}}>Sales Order</div><div style={{fontSize:13,fontWeight:600}}>{ir.so_id||'—'}</div><div style={{fontSize:11,color:'#64748b'}}>{ir.memo||''}</div></div>
            </div>
            {/* Line items table */}
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'#f1f5f9',borderBottom:'2px solid #e2e8f0'}}>
                <th style={{padding:'8px 10px',textAlign:'left',fontWeight:700}}>Description</th>
                <th style={{padding:'8px 10px',textAlign:'center',fontWeight:700,width:60}}>Qty</th>
                <th style={{padding:'8px 10px',textAlign:'right',fontWeight:700,width:80}}>Rate</th>
                <th style={{padding:'8px 10px',textAlign:'right',fontWeight:700,width:90}}>Amount</th>
              </tr></thead>
              <tbody>
                {lineItems.map((li,i)=><tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td style={{padding:'8px 10px'}}>{li.desc}</td>
                  <td style={{padding:'8px 10px',textAlign:'center'}}>{li.qty}</td>
                  <td style={{padding:'8px 10px',textAlign:'right'}}>${safeNum(li.rate).toFixed(2)}</td>
                  <td style={{padding:'8px 10px',textAlign:'right',fontWeight:600}}>${safeNum(li.amount).toFixed(2)}</td>
                </tr>)}
              </tbody>
            </table>
            {/* Totals */}
            <div style={{marginTop:12,borderTop:'2px solid #e2e8f0',paddingTop:12,display:'flex',justifyContent:'flex-end'}}>
              <div style={{width:220}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'#64748b'}}>Subtotal</span><span style={{fontWeight:600}}>${lineItems.reduce((a,l)=>a+safeNum(l.amount),0).toFixed(2)}</span>
                </div>
                {shipAmt>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'#64748b'}}>Shipping</span><span>${shipAmt.toFixed(2)}</span>
                </div>}
                {taxAmt>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'#64748b'}}>Tax</span><span>${taxAmt.toFixed(2)}</span>
                </div>}
                {ir.inv_type==='deposit'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'#1e40af',fontWeight:600}}>Deposit ({ir.deposit_pct||50}%)</span><span style={{fontWeight:700,color:'#1e40af'}}>${ir.total.toFixed(2)}</span>
                </div>}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:800,paddingTop:8,borderTop:'2px solid #1e3a5f',color:'#1e3a5f'}}>
                  <span>Total Due</span><span>${ir.total.toFixed(2)}</span>
                </div>
              </div>
            </div>
            {ir.inv_type==='deposit'&&<div style={{marginTop:12,padding:10,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,fontSize:11,color:'#1e40af'}}>{_ci.depositTerms}</div>}
          </div>
        </div>
        <div className="modal-footer" style={{display:'flex',gap:8,justifyContent:'space-between',flexWrap:'wrap'}}>
          <button className="btn btn-secondary" onClick={()=>{setInvReview(null);setInvSentStatus(null);if(onNavInvoice)onNavInvoice(ir)}}>Go to Invoices</button>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={printInvoice}>🖨️ Print Invoice</button>
            <button className="btn btn-secondary" onClick={downloadInvoice}>📥 Download PDF</button>
            <button className="btn btn-primary" style={{background:'#2563eb'}} onClick={()=>{const _c=(cust?.contacts||[]).filter(c=>c.email);const _accts=getBillingContacts(cust,allCustomers).filter(a=>a.email);const _primary=_c.length>0?_c[0].email:null;const _sel=[...(_primary?[_primary]:[]),..._accts.map(a=>a.email).filter(e=>e!==_primary)];setInvSendTo(_sel);setInvSendCustomEmail('');setInvSendModal(true)}}>📧 Send to Coach</button>
          </div>
        </div>
      </div></div>
    })()}

    {/* ═══ SEND TO COACH MODAL ═══ */}
    {invSendModal&&invReview&&(()=>{
      const ir=invReview;const ic=ir._customer||cust;
      const ownContacts=(ic?.contacts||[]).filter(c=>c.email);
      const inheritedAccts=getBillingContacts(ic,allCustomers).filter(a=>a._inherited_from&&a.email&&!ownContacts.find(o=>o.email===a.email));
      const contacts=[...ownContacts,...inheritedAccts];
      const selectedEmails=Array.isArray(invSendTo)?invSendTo:invSendTo?[invSendTo]:[];
      const allRecipients=[...selectedEmails];
      const hasRecipients=allRecipients.length>0;
      return<div className="modal-overlay" style={{zIndex:10001}} onMouseDown={e=>{if(e.target===e.currentTarget)setInvSendModal(false)}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Send Invoice to Coach</h2><button className="modal-close" onClick={()=>setInvSendModal(false)}>x</button></div>
        <div className="modal-body">
          <div style={{marginBottom:12}}>
            <label className="form-label">Sending to</label>
            {contacts.length>0&&<div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:8}}>
              {contacts.map(c=><label key={c.email} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 8px',borderRadius:6,background:selectedEmails.includes(c.email)?'#eff6ff':'#f8fafc',border:'1px solid '+(selectedEmails.includes(c.email)?'#93c5fd':'#e2e8f0'),fontSize:13}}>
                <input type="checkbox" checked={selectedEmails.includes(c.email)} onChange={e=>{if(e.target.checked)setInvSendTo([...selectedEmails,c.email]);else setInvSendTo(selectedEmails.filter(x=>x!==c.email))}} style={{width:15,height:15,accentColor:'#2563eb'}}/>
                <span style={{fontWeight:selectedEmails.includes(c.email)?600:400}}>{c.name||'Contact'} — {c.email}{c.role?' ('+c.role+')':''}</span>
                {c._inherited_from&&<span style={{fontSize:9,padding:'1px 6px',background:'#ede9fe',color:'#6d28d9',borderRadius:8,fontWeight:600,marginLeft:'auto'}}>from {c._inherited_from}</span>}
              </label>)}
            </div>}
            {contacts.length===0&&<div style={{fontSize:12,color:'#94a3b8',marginBottom:8}}>No contacts with email on file</div>}
            <div style={{display:'flex',gap:4}}>
              <input className="form-input" type="email" placeholder="Add email address..." value={invSendCustomEmail} onChange={e=>setInvSendCustomEmail(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&invSendCustomEmail&&invSendCustomEmail.includes('@')&&!selectedEmails.includes(invSendCustomEmail)){setInvSendTo([...selectedEmails,invSendCustomEmail]);setInvSendCustomEmail('')}}} style={{fontSize:13,flex:1}}/>
              <button className="btn btn-secondary" disabled={!invSendCustomEmail||!invSendCustomEmail.includes('@')||selectedEmails.includes(invSendCustomEmail)} onClick={()=>{setInvSendTo([...selectedEmails,invSendCustomEmail]);setInvSendCustomEmail('')}} style={{fontSize:12,whiteSpace:'nowrap'}}>+ Add</button>
            </div>
            {selectedEmails.filter(e=>!contacts.find(c=>c.email===e)).length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:6}}>
              {selectedEmails.filter(e=>!contacts.find(c=>c.email===e)).map(e=><span key={e} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:12,fontSize:11,color:'#1e40af'}}>
                {e}<button onClick={()=>setInvSendTo(selectedEmails.filter(x=>x!==e))} style={{background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:14,padding:0,lineHeight:1}}>x</button>
              </span>)}
            </div>}
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Invoice</label>
            <div style={{padding:8,background:'#eff6ff',borderRadius:6,fontSize:12,display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:700,color:'#1e40af'}}>{ir.id}</span>
              <span style={{fontWeight:700}}>${ir.total.toFixed(2)}</span>
            </div>
          </div>
          <div style={{marginBottom:12}}>
            <label className="form-label">Message to Coach</label>
            <textarea className="form-input" rows={6} value={invSendMsg} onChange={e=>setInvSendMsg(e.target.value)} style={{fontSize:13,lineHeight:1.5}}/>
          </div>
          {/* SMS Toggle — hidden via _smsUiEnabled flag while SMS sending is unreliable */}
          {_smsUiEnabled&&<div style={{marginBottom:12,padding:12,background:invSmsEnabled?'#f0fdf4':'#f8fafc',border:'1px solid '+(invSmsEnabled?'#86efac':'#e2e8f0'),borderRadius:8}}>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:invSmsEnabled?10:0}}>
              <input type="checkbox" checked={invSmsEnabled} onChange={e=>setInvSmsEnabled(e.target.checked)} style={{width:16,height:16,accentColor:'#22c55e'}}/>
              <span style={{fontWeight:700,fontSize:13,color:invSmsEnabled?'#166534':'#64748b'}}>Also Text Coach</span>
              {_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600}}>Sends directly</span>}
            </label>
            {invSmsEnabled&&<div>
              <div style={{marginBottom:8}}><label className="form-label" style={{fontSize:11}}>Phone</label><input className="form-input" value={invSmsPhone} onChange={e=>setInvSmsPhone(e.target.value)} placeholder="Phone number" style={{fontSize:12}}/></div>
              <div><label className="form-label" style={{fontSize:11}}>Text Message <span style={{color:'#94a3b8',fontWeight:400}}>({invSmsMsg.length}/160)</span></label><textarea className="form-input" rows={2} value={invSmsMsg} onChange={e=>setInvSmsMsg(e.target.value)} maxLength={160} style={{fontSize:12,resize:'vertical'}}/></div>
            </div>}
          </div>}
          {/* Send-on date picker — schedule the email for a future date */}
          {(()=>{const _today=new Date().toLocaleDateString('en-CA');const _isFuture=invSendAt&&invSendAt>_today;return<div style={{marginBottom:12,padding:10,background:_isFuture?'#eff6ff':'#f8fafc',border:'1px solid '+(_isFuture?'#93c5fd':'#e2e8f0'),borderRadius:8,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:700,color:_isFuture?'#1e40af':'#475569'}}>Send on</span>
            <input type="date" className="form-input" value={invSendAt||_today} min={_today} onChange={e=>setInvSendAt(e.target.value)} style={{fontSize:12,padding:'4px 6px',width:160}}/>
            {invSendAt&&invSendAt!==_today&&<button type="button" onClick={()=>setInvSendAt(_today)} style={{fontSize:11,background:'none',border:'none',color:'#64748b',cursor:'pointer',padding:0,textDecoration:'underline'}}>Send now</button>}
            <span style={{fontSize:11,color:_isFuture?'#1e40af':'#64748b',flex:1,minWidth:200}}>{_isFuture?'📅 Will be queued and sent automatically on '+invSendAt:'Will send immediately'}</span>
          </div>})()}
          {/* Follow-up reminder */}
          <div style={{padding:10,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>Follow up</span>
            <select className="form-input" value={invFollowUpDays} onChange={e=>setInvFollowUpDays(parseInt(e.target.value))} style={{width:90,fontSize:12,padding:'4px 6px'}}>
              <option value={0}>Never</option>
              {[1,2,3,5,7,10,14,21,30].map(d=><option key={d} value={d}>in {d}</option>)}
            </select>
            {invFollowUpDays>0&&<span style={{fontSize:12,color:'#6d28d9'}}>days if no response</span>}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setInvSendModal(false)}>Cancel</button>
          <button className="btn btn-primary" style={{background:'#2563eb'}} disabled={!hasRecipients} onClick={async()=>{
            setInvSendModal(false);
            const toList=allRecipients.map(em=>{const c=contacts.find(x=>x.email===em);return{email:em,name:c?.name||em}});
            const toEmail=toList.map(t=>t.email).join(', ');
            const toName=toList.map(t=>t.name).join(', ');
            // Build PDF attachment
            const _$e=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
            const irBillName=ir.billing_name||ic?.name||'—';const irBal=ir.total-(ir.paid||0);
            const irPoNum=ir._po_number||irSO?.po_number;
            const eBillSub=ir.billing_name?(ir.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':'';
            const eBillAddr=eBillSub||(ic?.billing_address_line1?ic.billing_address_line1+(ic.billing_city?'<br/>'+ic.billing_city+(ic.billing_state?' '+ic.billing_state:'')+(ic.billing_zip?' '+ic.billing_zip:''):'')+'<br/>United States':'');
            const eShipAddr=ic?.shipping_address_line1?ic.shipping_address_line1+(ic.shipping_city?'<br/>'+ic.shipping_city+(ic.shipping_state?' '+ic.shipping_state:'')+(ic.shipping_zip?' '+ic.shipping_zip:''):'')+'<br/>United States':'';
            // Build rows with decoration detail from SO items
            const eRows=[];let eSubTotal=0;
            const eSoItems=irSO?safeItems(irSO):[];const eSoArt=irSO?safeArt(irSO):[];
            const _eAQ={};eSoItems.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});
            const eIsDeposit=ir.inv_type==='deposit';const eDepPct=eIsDeposit?(ir.deposit_pct||50)/100:1;
            if(eSoItems.length>0){
              eSoItems.forEach(it=>{
                const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);if(!qty)return;
                const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
                const unitPrice=safeNum(it.unit_sell);const lineAmt=Math.round(qty*unitPrice*eDepPct*100)/100;eSubTotal+=lineAmt;
                let itemName=(it.name||'')+(it.color?' - '+it.color:'');
                if(szStr)itemName+='<br/><span>'+szStr+'</span>';
                if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
                eRows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$e(unitPrice),style:'text-align:right'},{value:_$e(lineAmt),style:'text-align:right;font-weight:600'}]});
                safeDecos(it).forEach(d=>{
                  const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eSoArt,cq);
                  const artF=eSoArt.find(a2=>a2.id===d.art_file_id);
                  const decoLabel=pdfDecoLabel(d,artF);
                  const posLabel=d.position?' — '+d.position:'';const decoAmt=Math.round(qty*dp2.sell*eDepPct*100)/100;eSubTotal+=decoAmt;
                  eRows.push({_class:'deco-row',cells:[{value:qty,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+decoLabel+posLabel+'</span>'},{value:_$e(dp2.sell),style:'text-align:right'},{value:_$e(decoAmt),style:'text-align:right'}]});
                });
              });
            }else{
              lineItems.forEach(li=>{eSubTotal+=safeNum(li.amount);eRows.push({cells:[li.qty,{value:(li.desc||'').split(' ')[0],style:'font-weight:700'},{value:(li.desc||'').split(' ').slice(1).join(' ')},{value:_$e(safeNum(li.rate)),style:'text-align:right'},{value:_$e(safeNum(li.amount)),style:'text-align:right;font-weight:600'}]})});
            }
            const brevoAttachments=[];
            try{
              const docHtml=buildDocHtml({title:irBillName,docNum:ir.id,docType:'INVOICE',css:PRINT_CSS,
                headerRight:'<div class="ta">'+_$e(ir.total)+'</div><div class="ts">Balance Due: <strong>'+_$e(irBal)+'</strong></div>'+(irPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+irPoNum+'</div>':''),
                infoBoxes:[
                  {label:'Bill To',value:irBillName,sub:eBillAddr},
                  ...(eShipAddr?[{label:'Ship To',value:ic?.name||'—',sub:eShipAddr}]:[]),
                  {label:'Invoice Date',value:ir.date||'—',sub:ir.due_date?'Due: '+ir.due_date:''},
                  {label:'Sales Order',value:ir.so_id||'—',sub:ir.memo||''+(irPoNum?'<br/><strong>PO# '+irPoNum+'</strong>':'')},
                  {label:'Payment Terms',value:ir.inv_type==='deposit'?(ir.deposit_pct||50)+'% Deposit':ir.inv_type==='partial'?'Partial Invoice':ir.inv_type==='full'?'Invoice':'Final Invoice',sub:''}
                ],
                tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
                  rows:[...eRows,
                    {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$e(eSubTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                    ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$e(shipAmt),style:'text-align:right;border:none'}]}]:[]),
                    ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$e(taxAmt),style:'text-align:right;border:none'}]}]:[]),
                    ...(safeNum(ir.credit_amount)>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$e(safeNum(ir.credit_amount))+'</strong>',style:'text-align:right;border:none'}]}]:[]),
                    {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$e(ir.total)+'</strong>',style:'text-align:right'}]},
                    ...(ir.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$e(ir.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
                    ...(irBal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$e(irBal)+'</strong>',style:'text-align:right'}]}]:[]),
                  ]}],footer:ir.inv_type==='deposit'?_ci.depositTerms:_ci.terms});
              const styleMatch=docHtml.match(/<style>([\s\S]*?)<\/style>/);const bodyMatch=docHtml.match(/<body>([\s\S]*?)<\/body>/);
              const pdfFixCss='.header{display:table!important;width:100%!important;table-layout:fixed}.header>*{display:table-cell!important;vertical-align:top!important}.logo{width:55%!important}.logo img{height:50px;vertical-align:middle;margin-right:8px;float:left}.doc-id{width:45%!important;text-align:right!important}.bill-total{display:table!important;width:100%!important;table-layout:fixed}.bill-total>*{display:table-cell!important;vertical-align:top!important}.total-box{width:200px!important;text-align:left!important}.info-row{display:table!important;width:100%!important;table-layout:fixed}.info-cell{display:table-cell!important;vertical-align:top!important}.footer{display:table!important;width:100%!important}.footer>*{display:table-cell!important}.footer>*:last-child{text-align:right!important}';
              const container=document.createElement('div');container.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:white;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4';
              const styleEl=document.createElement('style');styleEl.textContent=(styleMatch?styleMatch[1]:'')+pdfFixCss;container.appendChild(styleEl);
              const bodyDiv=document.createElement('div');bodyDiv.innerHTML=bodyMatch?bodyMatch[1]:docHtml;container.appendChild(bodyDiv);
              document.body.appendChild(container);await new Promise(r=>setTimeout(r,500));
              const _invPdfName=ir.id+(ic?.name?' - '+ic.name:'')+'.pdf';
              const pdfBlob=await html2pdf().set({margin:[0.4,0.4,0.4,0.4],filename:_invPdfName,image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:'letter',orientation:'portrait'}}).from(bodyDiv).outputPdf('blob');
              document.body.removeChild(container);
              const pdfB64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(pdfBlob)});
              brevoAttachments.push({name:_invPdfName,content:pdfB64});
            }catch(err){console.warn('Failed to build invoice PDF:',err)}
            // Build email with portal link
            const portalUrl=ic?.alpha_tag?'https://nsa-portal.netlify.app/?portal='+ic.alpha_tag:'';
            const emailHtml='<div style="font-family:sans-serif;font-size:14px;line-height:1.6">'+invSendMsg.replace(/\n/g,'<br>')
              +(portalUrl?'<br/><br/><a href="'+portalUrl+'" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:600">View Invoice in Portal</a>':'')
              +'</div>';
            const _toEmailsLc=new Set(toList.map(t=>(t.email||'').toLowerCase()));
            const _invCc=getBillingContacts(ic,allCustomers).filter(a=>a.email&&!_toEmailsLc.has(a.email.toLowerCase())).map(a=>({email:a.email,name:a.name||''}));
            const _today=new Date().toLocaleDateString('en-CA');
            const _scheduleFuture=invSendAt&&invSendAt>_today&&onScheduleEmail;
            const _emailSubject='Invoice '+ir.id+' — $'+ir.total.toFixed(2)+' from National Sports Apparel';
            let res;
            if(_scheduleFuture){
              // Hold for the cron worker to send on the chosen date.
              const _sendAtIso=new Date(invSendAt+'T09:00:00').toISOString();
              const schedRes=await onScheduleEmail({
                send_at:_sendAtIso,
                to_emails:toList,
                cc_emails:_invCc,
                subject:_emailSubject,
                html_content:emailHtml,
                sender_name:cu.name||'National Sports Apparel',
                sender_email:'noreply@nationalsportsapparel.com',
                reply_to:cu?.email?{email:cu.email,name:cu.name}:null,
                attachments:brevoAttachments,
                related_type:'invoice',
                related_id:ir.id,
                created_by:cu.name||cu.id||'',
              });
              if(schedRes.ok){
                nf('Invoice '+ir.id+' scheduled to send on '+invSendAt);
                setInvSentStatus({type:'scheduled',to:toEmail,sendAt:invSendAt});
                res={ok:true,messageId:null,scheduledId:schedRes.id};
              }else{
                nf('Failed to schedule invoice: '+(schedRes.error||'Unknown error'),'error');
                res={ok:false,error:schedRes.error};
              }
            }else{
              res=await sendBrevoEmail({
                to:toList,
                cc:_invCc,
                subject:_emailSubject,
                htmlContent:emailHtml,
                senderName:cu.name||'National Sports Apparel',
                senderEmail:'noreply@nationalsportsapparel.com',
                replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined,
                attachment:brevoAttachments.length>0?brevoAttachments:undefined
              });
              if(res.ok){
                nf('Invoice '+ir.id+' sent to '+toEmail);
                setInvSentStatus({type:'sent',to:toEmail});
              }else{
                nf('Failed to send invoice: '+(res.error||'Unknown error'),'error');
              }
              // Send SMS if enabled (UI hidden via _smsUiEnabled but kept for future)
              if(invSmsEnabled&&invSmsPhone&&_brevoKey){
                const smsRes=await sendBrevoSms({to:invSmsPhone,content:invSmsMsg.substring(0,160)});
                if(smsRes.ok){nf('Text sent to '+invSmsPhone)}else{nf('SMS failed: '+(smsRes.error||'Unknown'),'error')}
              }
            }
            if(!res.ok)return;// don't record history on failure
            // Update invoice email status with follow-up and history
            const invNow=new Date().toLocaleString();const invFuAt=invFollowUpDays?new Date(Date.now()+invFollowUpDays*86400000).toISOString():null;
            const invHist={sent_at:invNow,sent_by:cu.name||cu.id,to:toEmail,type:'invoice',methods:['email',...(invSmsEnabled?['sms']:[])],messageId:res.messageId||null,...(_scheduleFuture?{scheduled_for:invSendAt,scheduled_id:res.scheduledId}:{})};
            onInv(prev=>prev.map(i=>i.id===ir.id?{...i,email_status:_scheduleFuture?'scheduled':'sent',email_sent_at:invNow,...(_scheduleFuture?{scheduled_send_at:invSendAt}:{}),follow_up_at:invFuAt,sent_history:[...(i.sent_history||[]),invHist]}:i));
            // Also post to messages
            const _msgVerb=_scheduleFuture?('Scheduled to send on '+invSendAt+' to '):'Sent to ';
            const soMsg={id:'m'+Date.now(),so_id:ir.so_id,author_id:cu.id,text:'[Invoice '+ir.id+'] '+_msgVerb+toName+' ('+toEmail+')'+(invSmsEnabled&&invSmsPhone?' + SMS to '+invSmsPhone:'')+'\n\n'+invSendMsg,ts:new Date().toLocaleString(),read_by:[cu.id],dept:'sales',tagged_members:[],entity_type:'so',entity_id:ir.so_id};
            if(onMsg)onMsg(prev=>[...prev,soMsg]);
          }}>{(()=>{const _today=new Date().toLocaleDateString('en-CA');const _isFuture=invSendAt&&invSendAt>_today;return(_isFuture?'📅 Schedule Invoice for '+invSendAt:'📧 Send Invoice')+(hasRecipients?' to '+allRecipients.length+' recipient'+(allRecipients.length>1?'s':''):' (No email)')})()}</button>
        </div>
      </div></div>
    })()}

    {showPO&&(()=>{
      // Vendor selection or PO form
      const resolveVendor=it=>{
        // 1. Direct vendor_id (if set and valid)
        if(it.vendor_id){const vRec=vendorList.find(v=>v.id===it.vendor_id);if(vRec)return vRec.id}
        // 2. API source flags (_sm_live, _ss_live, _mt_live) — session-only, lost on reload
        if(it._sm_live){const v=vendorList.find(v=>v.api_provider==='sanmar'||v.name==='SanMar');if(v)return v.id}
        if(it._ss_live){const v=vendorList.find(v=>v.api_provider==='ss_activewear'||v.name==='S&S Activewear');if(v)return v.id}
        if(it._mt_live){const v=vendorList.find(v=>v.api_provider==='momentec'||v.name==='Momentec');if(v)return v.id}
        // 3. Product catalog by product_id
        if(it.product_id){const pVid=products.find(p=>p.id===it.product_id)?.vendor_id;if(pVid)return pVid}
        // 4. Product catalog by SKU (e.g. A230 → S&S Activewear)
        if(it.sku){const skuMatch=products.find(p=>p.sku===it.sku&&p.vendor_id);if(skuMatch)return skuMatch.vendor_id}
        // 5. Product catalog by brand (e.g. "Gildan" → SanMar)
        if(it.brand){const catMatch=products.find(p=>p.brand===it.brand&&p.vendor_id);if(catMatch)return catMatch.vendor_id}
        // 6. Brand name matches vendor name exactly (e.g. "Adidas" → Adidas, "Under Armour" → Under Armour)
        if(it.brand){const brandMatch=vendorList.find(v=>v.name===it.brand);if(brandMatch)return brandMatch.id}
        // 7. Fuzzy brand match (e.g. "Badger Sport" → "Badger" vendor)
        if(it.brand){const bl=it.brand.toLowerCase();const fuzzy=vendorList.find(v=>bl.startsWith(v.name.toLowerCase())||v.name.toLowerCase().startsWith(bl));if(fuzzy)return fuzzy.id}
        return null;
      };
      // Open units still needing a PO. Normal items track this per size; qty-only / custom
      // items (and items whose sizes aren't broken out yet) carry their count in est_qty and
      // are ordered against a single 'QTY' line so they aren't silently left off the PO.
      const QTY_SZ='QTY';
      const openSizesFor=it=>{
        const szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
        if(szList.length>0)return szList.map(([sz,v])=>{const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);return[sz,Math.max(0,v-picked-po)]}).filter(([,v])=>v>0);
        const est=safeNum(it.est_qty);
        if(est>0){const picked=safePicks(it).reduce((a,pk)=>a+(pk[QTY_SZ]||0),0);const po=poCommitted(it.po_lines,QTY_SZ);return[[QTY_SZ,Math.max(0,est-picked-po)]].filter(([,v])=>v>0)}
        return[];
      };
      const vendorMap={};safeItems(o).forEach((it,i)=>{const vk=resolveVendor(it);if(!vk)return;if(!vendorMap[vk])vendorMap[vk]=[];vendorMap[vk].push({...it,_idx:i})});
      const unlinkedItems=safeItems(o).filter(it=>{const vk=resolveVendor(it);return!vk&&(Object.values(safeSizes(it)).some(v=>safeNum(v)>0)||safeNum(it.est_qty)>0)});
      if(showPO==='select')return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Create PO — Select Vendor</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">{Object.entries(vendorMap).map(([vk,items])=>{const vn=vendorList.find(v=>v.id===vk)?.name||D_V.find(v=>v.id===vk)?.name||vk;
          const openItems=items.filter(it=>openSizesFor(it).reduce((a,[,v])=>a+v,0)>0);
          const openCount=openItems.reduce((tot,it)=>tot+openSizesFor(it).reduce((a,[,v])=>a+v,0),0);
          if(openCount===0)return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,opacity:0.5,display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:8,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="check" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#166534'}}>All items fully covered</div></div></div>;
          return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,cursor:'pointer',display:'flex',alignItems:'center',gap:12}} onClick={()=>{setShowPO(vk);setPOExcluded({})}}>
            <div style={{width:40,height:40,borderRadius:8,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="package" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#64748b'}}>{openItems.length} item(s) — <span style={{color:'#dc2626',fontWeight:600}}>{openCount} units open</span></div></div>
            <Icon name="back" size={16} style={{transform:'rotate(180deg)'}}/></div>})}
          {unlinkedItems.length>0&&<div style={{borderTop:'2px solid #fca5a5',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',marginBottom:6}}>⚠️ Items Without Vendor</div>
            {unlinkedItems.map((it,i)=>{const idx=safeItems(o).findIndex(x=>x.sku===it.sku&&x.color===it.color&&x.name===it.name);return<div key={i} style={{padding:'8px 12px',border:'1px solid #fca5a5',borderRadius:8,marginBottom:4,background:'#fef2f2'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>{it.sku||'No SKU'} — {it.name||'Unnamed'}</div>
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4}}>
                <select className="form-select" style={{flex:1,fontSize:11,padding:'3px 6px'}} defaultValue="" onChange={e=>{
                  const vid=e.target.value;if(!vid||idx<0)return;
                  const vn=vendorList.find(v=>v.id===vid)?.name||'';
                  uI(idx,'vendor_id',vid);uI(idx,'brand',vn||it.brand);
                  nf('Assigned '+vn+' to '+it.sku);setShowPO(null);setTimeout(()=>setShowPO('select'),100);
                }}>
                  <option value="" disabled>Assign vendor...</option>
                  {vendorList.filter(v=>v.is_active!==false).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>})}
          </div>}
          {/* Outside Decoration PO section */}
          <div style={{borderTop:'2px solid #e2e8f0',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#7c3aed',textTransform:'uppercase',marginBottom:6}}>🎨 Outside Decoration PO</div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <select className="form-select" id="deco-vendor-select" style={{flex:1,fontSize:13}} defaultValue="">
                <option value="" disabled>Select decorator...</option>
                {DECO_VENDORS.filter(dv=>dv!=='Other').map(dv=><option key={dv} value={dv}>{dv}</option>)}
              </select>
              <button className="btn btn-sm" style={{background:'#7c3aed',color:'white',border:'none',whiteSpace:'nowrap'}} onClick={()=>{
                const sel=document.getElementById('deco-vendor-select')?.value;
                if(sel)setShowPO('deco:'+sel);
              }}>Create Deco PO</button>
            </div>
          </div>
          <div style={{borderTop:'1px solid #e2e8f0',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#0891b2',textTransform:'uppercase',marginBottom:6}}>🧵 Digitizing / Vector File — Topstar</div>
            <button className="btn btn-sm" style={{background:'#0891b2',color:'white',border:'none',width:'100%'}} onClick={()=>{setTopstarService('dst');setTopstarImgs([]);setTopstarNotes('');setShowPO('topstar')}}>Order Digitizing / Vector File</button>
          </div>
        </div></div></div>;
      // OUTSIDE DECORATION PO FORM
      if(typeof showPO==='string'&&showPO.startsWith('deco:')){
        const decoVendor=showPO.replace('deco:','');
        const allItems=safeItems(o).map((it,i)=>({...it,_idx:i})).filter(it=>{
          const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return q>0});
        const autoPoId='DPO '+poCounter+(cust?.alpha_tag?' '+cust.alpha_tag:'');
        const poId=preexistingPO?preexistingPOId:autoPoId;
        const dv=decoVendors.find(v=>v.name===decoVendor);
        const _initialDpoQty=allItems.reduce((a,it)=>a+Object.values(safeSizes(it)).reduce((b,v)=>b+safeNum(v),0),0);
        const _initialDpoCost=dv?_decoVendorPrice(decoVendorPricing,dv.id,'embroidery',{qty:_initialDpoQty}):null;
        const _recalcDpo=()=>{
          let qty=0;const selected=[];
          allItems.forEach((it,vi)=>{if(document.getElementById('dpo-sel-'+vi)?.checked){qty+=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);selected.push(vi)}});
          const dt=document.getElementById('dpo-type-'+poId)?.value||'embroidery';
          const price=dv?_decoVendorPrice(decoVendorPricing,dv.id,dt,{qty}):null;
          const qtyEl=document.getElementById('dpo-total-qty');if(qtyEl)qtyEl.value=qty;
          const ucEl=document.getElementById('dpo-unit-cost');
          if(ucEl&&(ucEl.dataset.auto==='1'||!ucEl.value||ucEl.value==='0'||ucEl.value==='0.00')&&price!==null){ucEl.value=price.toFixed(2);ucEl.dataset.auto='1'}
          const uc=parseFloat(ucEl?.value)||0;
          const expEl=document.getElementById('dpo-expected-cost');if(expEl)expEl.value=(qty*uc).toFixed(2);
        };
        return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
          <div className="modal-header"><h2 style={{color:'#7c3aed'}}>🎨 Deco PO — {decoVendor}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
          <div className="modal-body">
            {!preexistingPO?<div style={{padding:10,background:'#faf5ff',border:'1px solid #ddd6fe',borderRadius:8,marginBottom:12,fontSize:12,color:'#6d28d9'}}>
              <strong>{decoVendor}</strong> decoration PO — associates this decorator's bill (and commission) with this sales order. This is a cost bucket, not an order for physical items; pick which items on the SO this PO covers so we can price it and badge them.
            </div>:<div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:'#d97706'}}>Preexisting PO Mode — Enter the PO number from the decorator's bill (or elsewhere). This will not affect sequential PO numbering.</div>
            </div>}
            <div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" checked={preexistingPO} onChange={e=>{setPreexistingPO(e.target.checked);if(!e.target.checked)setPreexistingPOId('')}}/><span style={{fontWeight:600,color:'#d97706'}}>Preexisting PO</span><span style={{fontSize:11,color:'#64748b'}}>— Apply an existing PO number (bypasses sequential numbering)</span></label></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
              <div><label className="form-label">PO Number</label><div style={{display:'flex',gap:4,alignItems:'stretch'}}>{preexistingPO?<input className="form-input" value={preexistingPOId} onChange={e=>setPreexistingPOId(e.target.value)} placeholder="e.g. PO7514" style={{color:'#d97706',fontWeight:700,borderColor:'#f59e0b',flex:1}}/>:<input className="form-input" value={autoPoId} readOnly style={{color:'#7c3aed',fontWeight:700,flex:1}}/>}<button type="button" className="btn btn-sm btn-secondary" title="Copy PO number" onClick={()=>{const v=preexistingPO?preexistingPOId:autoPoId;if(!v)return;navigator.clipboard?.writeText(v).then(()=>nf('📋 Copied '+v)).catch(()=>{window.prompt('Copy:',v)})}} style={{padding:'0 10px',fontSize:12}}>📋</button></div></div>
              <div><label className="form-label">Deco Type</label><select className="form-select" id={'dpo-type-'+poId} defaultValue="embroidery" onChange={()=>{const ucEl=document.getElementById('dpo-unit-cost');if(ucEl)ucEl.dataset.auto='1';_recalcDpo()}}>
                <option value="embroidery">Embroidery</option><option value="screen_print">Screen Print</option><option value="dtf">DTF</option><option value="heat_transfer">Heat Transfer</option><option value="sublimation">Sublimation</option></select></div>
              <div><label className="form-label">Expected Return</label><input className="form-input" type="date" id={'dpo-date-'+poId}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" id={'dpo-dropship-'+poId}/><span style={{fontWeight:600,color:'#7c3aed'}}>📦 Drop Ship</span><span style={{fontSize:11,color:'#64748b'}}>— Ships direct to school, skip warehouse receive</span></label></div>
            <div style={{fontSize:11,fontWeight:700,color:'#475569',marginBottom:6}}>Items covered by this PO</div>
            {allItems.length>1&&<div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8,fontSize:11}}>
              <span style={{color:'#64748b',fontWeight:600}}>{allItems.length} item{allItems.length!==1?'s':''} available</span>
              <button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'3px 10px'}} onClick={()=>{allItems.forEach((_,vi)=>{const el=document.getElementById('dpo-sel-'+vi);if(el)el.checked=true});_recalcDpo()}}>Select All</button>
              <button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'3px 10px'}} onClick={()=>{allItems.forEach((_,vi)=>{const el=document.getElementById('dpo-sel-'+vi);if(el)el.checked=false});_recalcDpo()}}>Deselect All</button>
            </div>}
            {allItems.map((it,vi)=>{const soQ=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
              return<div key={vi} style={{padding:'8px 12px',border:'1px solid #ede9fe',borderRadius:6,marginBottom:6,background:'#faf5ff',display:'flex',alignItems:'center',gap:8}}>
                <input type="checkbox" id={'dpo-sel-'+vi} defaultChecked style={{width:16,height:16}} onChange={_recalcDpo}/>
                <span style={{fontFamily:'monospace',fontWeight:800,color:'#7c3aed'}}>{it.sku}</span>
                <strong style={{flex:1}}>{it.name}</strong>
                <span style={{color:'#64748b',fontSize:12}}>{it.color}</span>
                <span style={{fontSize:11,fontWeight:700,color:'#475569'}}>SO Qty: {soQ}</span>
              </div>})}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginTop:12,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
              <div><label className="form-label" style={{fontSize:10}}>Total Qty (price-list lookup)</label><input className="form-input" id="dpo-total-qty" readOnly defaultValue={_initialDpoQty} style={{fontWeight:700,color:'#1e40af'}}/></div>
              <div><label className="form-label" style={{fontSize:10}}>Unit Cost {_initialDpoCost!==null&&<span style={{color:'#7c3aed',fontWeight:600}}>(from price list · editable)</span>}</label><input className="form-input" id="dpo-unit-cost" type="number" step="0.01" defaultValue={_initialDpoCost!==null?_initialDpoCost.toFixed(2):''} placeholder="0.00" data-auto={_initialDpoCost!==null?'1':'0'} style={{fontWeight:700,color:'#7c3aed'}} onChange={e=>{e.target.dataset.auto='0';_recalcDpo()}}/></div>
              <div><label className="form-label" style={{fontSize:10}}>Expected Cost (qty × rate)</label><input className="form-input" id="dpo-expected-cost" readOnly defaultValue={_initialDpoCost!==null?(_initialDpoQty*_initialDpoCost).toFixed(2):'0.00'} style={{fontWeight:800,color:'#166534'}}/></div>
            </div>
            <div style={{marginTop:12}}><label className="form-label">Notes / Instructions for Decorator</label><textarea className="form-input" rows={2} placeholder="Thread colors, PMS colors, placement notes..." id={'dpo-notes-'+poId} style={{resize:'vertical'}}/></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>{setShowPO('select');setPreexistingPO(false);setPreexistingPOId('')}}>← Back</button>
            <button className="btn btn-secondary" onClick={()=>{setShowPO(null);setPreexistingPO(false);setPreexistingPOId('')}}>Cancel</button>
            <button className="btn btn-primary" style={preexistingPO?{background:'#d97706',borderColor:'#d97706'}:{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>{
              if(preexistingPO&&!preexistingPOId.trim()){nf('Please enter a PO number','error');return}
              const effectivePoId=preexistingPO?preexistingPOId.trim():autoPoId;
              const decoType=document.getElementById('dpo-type-'+poId)?.value||'embroidery';
              const returnDate=document.getElementById('dpo-date-'+poId)?.value||'';
              const notes=document.getElementById('dpo-notes-'+poId)?.value||'';
              const isDropShip=document.getElementById('dpo-dropship-'+poId)?.checked||false;
              const itemIdxs=[];let totalQty=0;
              allItems.forEach((it,vi)=>{if(document.getElementById('dpo-sel-'+vi)?.checked){itemIdxs.push(it._idx);totalQty+=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)}});
              if(itemIdxs.length===0){nf('Pick at least one item for this PO','error');return}
              const unitCost=parseFloat(document.getElementById('dpo-unit-cost')?.value)||0;
              const expectedCost=Math.round(totalQty*unitCost*100)/100;
              const newDecoPO={id:'DECO-'+Date.now()+'-'+Math.floor(Math.random()*10000),
                po_id:effectivePoId,vendor:decoVendor,deco_vendor_id:dv?.id||null,deco_type:decoType,
                item_idxs:itemIdxs,qty:totalQty,unit_cost:unitCost,expected_cost:expectedCost,
                notes,drop_ship:isDropShip||undefined,expected_date:returnDate,preexisting:preexistingPO||undefined,
                status:preexistingPO?'ordered':'waiting',created_at:new Date().toLocaleDateString(),
                _bill_cost:0,_bill_details:[],tracking_numbers:[]};
              const updated={...o,deco_pos:[...(o.deco_pos||[]),newDecoPO],updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);
              if(!preexistingPO)setPOCounter(c=>c+1);
              setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');
              nf('🎨 '+effectivePoId+' '+(preexistingPO?'applied':'sent')+' to '+decoVendor+' — '+itemIdxs.length+' item'+(itemIdxs.length!==1?'s':'')+' ($'+expectedCost.toFixed(2)+')');
            }}>🎨 {preexistingPO?'Apply Preexisting PO':'Create Deco PO — Send to '+decoVendor}</button>
          </div>
        </div></div>;
      }
      // TOPSTAR DIGITIZING / VECTOR PO — file creation vendor, billed back to the customer as a line item
      if(showPO==='topstar'){
        const TOPSTAR={dst:{label:'DST Embroidery File',cost:15,sell:25,deco_type:'embroidery',orderType:'Digitizing',emailService:'Digitizing — DST File'},vector:{label:'Vector Logo',cost:10,sell:15,deco_type:'vector',orderType:'Vector',emailService:'Vector'}};
        const svc=TOPSTAR[topstarService]||TOPSTAR.dst;
        const tsPoId='TS '+poCounter+(cust?.alpha_tag?' '+cust.alpha_tag:'');
        return<div className="modal-overlay" onClick={()=>!topstarSending&&setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:640,maxHeight:'90vh',overflow:'auto'}}>
          <div className="modal-header"><h2 style={{color:'#0891b2'}}>🧵 Topstar Digitizing PO</h2><button className="modal-close" onClick={()=>!topstarSending&&setShowPO(null)}>x</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#ecfeff',border:'1px solid #a5f3fc',borderRadius:8,marginBottom:12,fontSize:12,color:'#0e7490'}}>
              Sends a PO + your artwork to <strong>info@topstardigitizing.com</strong> for file creation. Topstar's fee is recorded as a cost on this order, and the customer is billed a matching line item.
            </div>
            <div style={{fontSize:11,fontWeight:700,color:'#475569',marginBottom:6}}>Service</div>
            <div style={{display:'flex',gap:8,marginBottom:14}}>
              {Object.entries(TOPSTAR).map(([k,v])=>{const sel=topstarService===k;return<button key={k} type="button" onClick={()=>setTopstarService(k)} style={{flex:1,padding:'10px 12px',borderRadius:8,border:sel?'2px solid #0891b2':'1px solid #e2e8f0',background:sel?'#ecfeff':'white',cursor:'pointer',textAlign:'left'}}>
                <div style={{fontWeight:700,fontSize:13,color:sel?'#0e7490':'#1e293b'}}>{v.label}</div>
                <div style={{fontSize:11,color:'#64748b'}}>Cost ${v.cost.toFixed(2)} · Bill customer ${v.sell.toFixed(2)}</div>
              </button>})}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div><label className="form-label">PO Number</label><input className="form-input" value={tsPoId} readOnly style={{color:'#0891b2',fontWeight:700}}/></div>
              <div><label className="form-label">Customer Bill</label><input className="form-input" value={'$'+svc.sell.toFixed(2)} readOnly style={{color:'#166534',fontWeight:800}}/></div>
            </div>
            <div style={{marginBottom:12}}><label className="form-label">Artwork / Logo Images</label>
              <ImgGallery images={topstarImgs} onUpdate={setTopstarImgs} onError={e=>nf(e,'error')} maxImages={10}/>
            </div>
            <div><label className="form-label">Explanation / Instructions for Topstar</label><textarea className="form-input" rows={4} value={topstarNotes} onChange={e=>setTopstarNotes(e.target.value)} placeholder="Describe the logo/name, thread colors, sizing, file format needed, etc." style={{resize:'vertical'}}/></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" disabled={topstarSending} onClick={()=>setShowPO('select')}>← Back</button>
            <button className="btn btn-secondary" disabled={topstarSending} onClick={()=>setShowPO(null)}>Cancel</button>
            <button className="btn btn-primary" style={{background:'#0891b2',borderColor:'#0891b2'}} disabled={topstarSending} onClick={async()=>{
              if(topstarImgs.length===0){nf('Add at least one artwork image for Topstar','error');return}
              setTopstarSending(true);
              const tsPoIdFinal=tsPoId;
              const decoPO={id:'TS-'+Date.now()+'-'+Math.floor(Math.random()*10000),
                po_id:tsPoIdFinal,vendor:'Topstar',deco_vendor_id:null,deco_type:svc.deco_type,
                topstar_service:topstarService,item_idxs:[],qty:1,unit_cost:svc.cost,expected_cost:svc.cost,
                notes:topstarNotes,images:topstarImgs,status:'waiting',created_at:new Date().toLocaleDateString(),
                _bill_cost:0,_bill_details:[],tracking_numbers:[]};
              const lineItem={product_id:null,sku:'DIGITIZING',name:'Topstar — '+svc.label,brand:'Topstar',vendor_id:null,color:'',
                nsa_cost:0,unit_sell:svc.sell,retail_price:0,available_sizes:[],sizes:{},qty_only:true,est_qty:1,
                decorations:[],no_deco:true,is_custom:true,_topstar:true,_topstar_po:tsPoIdFinal};
              const updated={...o,items:[...safeItems(o),lineItem],deco_pos:[...(o.deco_pos||[]),decoPO],updated_at:new Date().toLocaleString()};
              // Persist the PO BEFORE the network email — a slow/failed send (or a background poll firing
              // during the await) must not be able to drop the optimistic deco_pos record.
              setO(updated);onSave(updated);setPOCounter(c=>c+1);
              const custName=cust?.name||cust?.alpha_tag||'';
              const imgList=topstarImgs.map((u,i)=>'<li><a href="'+u+'">Image '+(i+1)+'</a></li>').join('');
              const html='<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">'+
                '<h2 style="color:#0891b2">New '+svc.orderType+' Order — '+tsPoIdFinal+'</h2>'+
                '<p><strong>Service:</strong> '+svc.emailService+' ($'+svc.cost.toFixed(2)+')</p>'+
                (custName?'<p><strong>Customer:</strong> '+custName+'</p>':'')+
                '<p><strong>PO #:</strong> '+tsPoIdFinal+'</p>'+
                '<p><strong>Instructions:</strong><br/>'+(topstarNotes?topstarNotes.replace(/\n/g,'<br/>'):'(none provided)')+'</p>'+
                '<p><strong>Artwork:</strong></p><ul>'+imgList+'</ul>'+
                '<p style="color:#64748b;font-size:12px">Sent from the National Sports Apparel portal. Reply to this email to reach the rep.</p></div>';
              let r={ok:false,error:'not sent'};
              try{r=await sendBrevoEmail({to:[{email:'info@topstardigitizing.com'}],
                subject:'New '+svc.orderType+' Order — '+tsPoIdFinal+' ('+svc.emailService+')',
                htmlContent:html,
                senderName:_ci?.name||'National Sports Apparel',
                replyTo:cuEmail?{email:cuEmail,name:cu?.name||undefined}:undefined,
                attachment:topstarImgs.map((u,i)=>({url:u,name:(svc.deco_type||'art')+'-'+(i+1)+'.'+((u.split('?')[0].split('.').pop())||'png')}))});
              }catch(e){r={ok:false,error:e.message}}
              setShowPO(null);setTopstarImgs([]);setTopstarNotes('');setTopstarService('dst');setTopstarSending(false);
              if(r.ok)nf('🧵 '+tsPoIdFinal+' sent to Topstar — cost $'+svc.cost.toFixed(2)+', customer billed $'+svc.sell.toFixed(2));
              else nf('PO created & customer billed, but email to Topstar failed: '+r.error,'error');
            }}>{topstarSending?'Sending…':'🧵 Create PO & Email Topstar'}</button>
          </div>
        </div></div>;
      }
      // PO form for selected vendor — only show sizes that still need ordering (subtract picks + existing POs)
      const vItems=vendorMap[showPO]||[];const vn=D_V.find(v=>v.id===showPO)?.name||showPO;
      const autoPoId='PO '+poCounter+(cust?.alpha_tag?' '+cust.alpha_tag:'');
      const poId=preexistingPO?preexistingPOId:autoPoId;
      const batchKey=Object.keys(BATCH_VENDORS).find(k=>{const bvName=BATCH_VENDORS[k].name.toLowerCase();const vnL=vn.toLowerCase();return vnL===bvName||vnL.includes(k)||showPO.toLowerCase().includes(k)});
      const isBatchEligible=!!batchKey;
      const isAdidas=batchKey==='adidas';
      const batchConfig=batchKey?BATCH_VENDORS[batchKey]:null;
      const pendingBatches=(batchPOs||[]).filter(bp=>bp.vendor_key===batchKey);
      const pendingBatchTotal=pendingBatches.reduce((a,bp)=>a+bp.total_cost,0);
      const poItems=vItems.map(it=>{const openSizes=openSizesFor(it);
        return{...it,openSizes,totalOpen:openSizes.reduce((a,[,v])=>a+v,0)}}).filter(it=>it.totalOpen>0);
      // Live PO totals — inputs are uncontrolled (defaultValue), so read the
      // DOM when present and fall back to the rendered defaults otherwise.
      // poCalcTick re-renders on input so the displayed totals stay in sync.
      void poCalcTick;
      const _poQtyVal=(vi,sz,fallback)=>{const el=document.getElementById('po-qty-'+vi+'-'+sz);if(!el)return fallback;const n=parseInt(el.value);return isNaN(n)?fallback:n};
      const _poPriceVal=(vi,sz,fallback)=>{const elS=document.getElementById('po-price-'+vi+'-'+sz);const el=elS||document.getElementById('po-price-'+vi);if(!el)return fallback;const v=parseFloat(String(el.value).replace(/[$,\s]/g,''));return isNaN(v)?fallback:v};
      const poLineTotal=(it,vi)=>{const catP=products.find(p=>p.id===it.product_id||p.sku===it.sku);const rawC=catP?safeNum(catP.nsa_cost):safeNum(it.nsa_cost);const cc=isAdidas?Math.floor(rawC*100)/100:rawC;const scMap={...((vendorInv[it.sku]&&vendorInv[it.sku].price)||{}),...(it._sizeCosts||{})};const pFor=sz=>{const sc=safeNum(scMap[sz]);return sc>0?(isAdidas?Math.floor(sc*100)/100:sc):cc};return it.openSizes.reduce((a,[sz,v])=>a+_poQtyVal(vi,sz,v)*_poPriceVal(vi,sz,pFor(sz)),0)};
      const poOrderTotal=poItems.reduce((a,it,vi)=>poExcluded[vi]?a:a+poLineTotal(it,vi),0);
      return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>New PO — {vn}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">
          {o._posHydrated===false&&<div style={{padding:10,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>⚠️ Existing POs for this order didn't finish loading</div>
            <div style={{fontSize:11,color:'#b91c1c',marginTop:2}}>Creating a PO now could duplicate one that already exists. Reload the page so the current POs load first, then create the PO.</div>
          </div>}
          {/* Batch PO banner for eligible vendors */}
          {isBatchEligible&&!preexistingPO&&<div style={{padding:10,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:8,marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:14}}>📦</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>{batchConfig.threshold===0?'Consider batching PO if small order':'Free shipping over $'+batchConfig.threshold+' — Batch eligible!'}</div>
                {pendingBatches.length>0?<div style={{fontSize:11,color:'#6d28d9'}}>{pendingBatches.length} PO{pendingBatches.length!==1?'s':''} in queue · ${pendingBatchTotal.toFixed(2)} total {batchConfig.threshold>0?(pendingBatchTotal>=batchConfig.threshold?'✅ Threshold met!':'· $'+(batchConfig.threshold-pendingBatchTotal).toFixed(2)+' more to free ship'):''}</div>
                :<div style={{fontSize:11,color:'#94a3b8'}}>No POs queued yet for {batchConfig.name}</div>}
              </div>
            </div>
          </div>}
          {preexistingPO&&<div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:'#d97706'}}>Preexisting PO Mode — Enter the PO number from NetSuite. This will not affect sequential PO numbering.</div>
          </div>}
          {poItems.length===0?<div style={{padding:24,textAlign:'center',color:'#64748b'}}><div style={{fontSize:32,marginBottom:8}}>✅</div><div style={{fontWeight:700,fontSize:16,marginBottom:4}}>All items fully covered</div><div style={{fontSize:13}}>Every size has been assigned via IFs or existing POs.</div></div>:<>
          {isAdidas&&<div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" checked={preexistingPO} onChange={e=>{setPreexistingPO(e.target.checked);if(!e.target.checked)setPreexistingPOId('')}}/><span style={{fontWeight:600,color:'#d97706'}}>Preexisting PO</span><span style={{fontSize:11,color:'#64748b'}}>— Apply an existing PO number from NetSuite (bypasses batch queue)</span></label></div>}
          {poItems.length>1&&<div style={{marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
            <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}><input type="checkbox" checked={poItems.every((_,vi)=>!poExcluded[vi])} onChange={e=>{if(e.target.checked)setPOExcluded({});else{const ex={};poItems.forEach((_,vi)=>{ex[vi]=true});setPOExcluded(ex)}}}/><span style={{fontWeight:600}}>Select All</span></label>
            <span style={{fontSize:11,color:'#64748b'}}>{poItems.filter((_,vi)=>!poExcluded[vi]).length} of {poItems.length} items</span>
          </div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
            <div><label className="form-label">PO Number</label><div style={{display:'flex',gap:4,alignItems:'stretch'}}>{preexistingPO?<input className="form-input" value={preexistingPOId} onChange={e=>setPreexistingPOId(e.target.value)} placeholder="e.g. PO2453 OLUF" style={{color:'#d97706',fontWeight:700,borderColor:'#f59e0b',flex:1}}/>:<input className="form-input" value={autoPoId} readOnly style={{color:'#1e40af',fontWeight:700,flex:1}}/>}<button type="button" className="btn btn-sm btn-secondary" title="Copy PO number" onClick={()=>{const v=preexistingPO?preexistingPOId:autoPoId;if(!v)return;navigator.clipboard?.writeText(v).then(()=>nf('📋 Copied '+v)).catch(()=>{window.prompt('Copy:',v)})}} style={{padding:'0 10px',fontSize:12}}>📋</button></div></div>
            <div><label className="form-label">Ship To</label><div style={{display:'flex',gap:4,alignItems:'stretch'}}><select className="form-select" value={poShipTo} onChange={e=>setPoShipTo(e.target.value)} style={{flex:1}}><option value="warehouse">NSA Warehouse — Emerson</option>{addrs.map((a,ai)=><option key={a.id+'-'+ai} value={a.id}>{a.label}</option>)}</select><button type="button" className="btn btn-sm btn-secondary" title="Copy ship-to address" onClick={()=>{const v=poShipTo==='warehouse'?'NSA Warehouse — Emerson':(addrs.find(a=>a.id===poShipTo)?.addr||'');if(!v)return;navigator.clipboard?.writeText(v).then(()=>nf('📋 Copied '+v)).catch(()=>{window.prompt('Copy:',v)})}} style={{padding:'0 10px',fontSize:12}}>📋</button></div></div>
            <div><label className="form-label">Expected Date</label><input className="form-input" type="date" id={'po-date-'+(preexistingPO?'preexisting':autoPoId)}/></div></div>
          <div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" id={'po-dropship-'+(preexistingPO?'preexisting':autoPoId)} onChange={e=>{if(e.target.checked)setPoShipTo(addrs[0]?.id||'warehouse');else setPoShipTo('warehouse')}}/><span style={{fontWeight:600,color:'#7c3aed'}}>📦 Drop Ship</span><span style={{fontSize:11,color:'#64748b'}}>— Ships direct to school/decorator, skip warehouse receive</span></label></div>
          {poItems.map((it,vi)=>{const soQ=Object.values(it.sizes).reduce((a,v)=>a+safeNum(v),0)||safeNum(it.est_qty);const excluded=!!poExcluded[vi];const catP=products.find(p=>p.id===it.product_id||p.sku===it.sku);const rawCost=catP?safeNum(catP.nsa_cost):safeNum(it.nsa_cost);const catCost=isAdidas?Math.floor(rawCost*100)/100:rawCost;
            // Per-size pricing: vendors like Momentec/SanMar charge upcharges for 2XL+. Source the per-size cost from the
            // item's captured _sizeCosts when present, otherwise fall back to live vendor pricing already fetched into
            // vendorInv (e.g. SanMar getPricing), so catalog-added items still render per-size inputs and capture the upcharge.
            const liveSizePrice=(vendorInv[it.sku]&&vendorInv[it.sku].price)||{};
            const sizeCostMap={...liveSizePrice,...(it._sizeCosts||{})};
            const priceForSize=sz=>{const sc=safeNum(sizeCostMap[sz]);return sc>0?(isAdidas?Math.floor(sc*100)/100:sc):catCost};
            const distinctPrices=new Set(it.openSizes.map(([sz])=>priceForSize(sz).toFixed(2)));
            const hasSizeUpcharges=distinctPrices.size>1;
            return<div key={vi} style={{padding:12,border:'1px solid '+(excluded?'#f1f5f9':'#e2e8f0'),borderRadius:6,marginBottom:8,opacity:excluded?0.4:1,transition:'opacity 0.15s'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={!excluded} onChange={()=>setPOExcluded(x=>({...x,[vi]:!x[vi]}))} style={{marginTop:1}}/><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:4}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div>
                <div style={{fontWeight:700}}>SO Qty: {soQ} <span style={{color:'#dc2626',fontSize:12,marginLeft:6}}>Open: {it.totalOpen}</span></div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:64}}>PO Qty:</span>
                {it.openSizes.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-qty-'+vi+'-'+sz} onInput={()=>setPoCalcTick(t=>t+1)} style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}</div>
              {hasSizeUpcharges?<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:64}}>Price/Unit:</span>
                {it.openSizes.map(([sz])=>{const p=priceForSize(sz);const isUpcharge=p.toFixed(2)!==catCost.toFixed(2);return<div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:isUpcharge?'#b45309':'#94a3b8'}}>{sz}</div>
                  <input id={'po-price-'+vi+'-'+sz} onInput={()=>setPoCalcTick(t=>t+1)} style={{width:52,textAlign:'center',border:'1px solid '+(isUpcharge?'#fcd34d':'#d1d5db'),borderRadius:4,padding:'4px 2px',fontSize:13,fontWeight:700,color:isUpcharge?'#b45309':'#0f172a',background:isUpcharge?'#fffbeb':'white'}} defaultValue={p.toFixed(2)}/>
                </div>})}
                <span style={{fontSize:10,color:'#b45309',marginLeft:4}} title="Larger sizes typically carry an upcharge from the vendor">Size upcharges applied</span>
              </div>:<div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',width:64}}>Price/Unit:</span>
                <span style={{fontSize:12,color:'#94a3b8'}}>$</span>
                {/* Default to the live vendor program price (distinctPrices is the merged live/_sizeCosts value) rather than the possibly-stale catalog nsa_cost */}
                <input id={'po-price-'+vi} onInput={()=>setPoCalcTick(t=>t+1)} style={{width:80,border:'1px solid #d1d5db',borderRadius:4,padding:'4px 6px',fontSize:14,fontWeight:700}} defaultValue={[...distinctPrices][0]||catCost.toFixed(2)}/>
              </div>}
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:8,paddingTop:8,borderTop:'1px dashed #e2e8f0',fontSize:13}}>
                <span style={{color:'#64748b'}}>Line total:&nbsp;</span><strong style={{color:'#0f172a'}}>${poLineTotal(it,vi).toFixed(2)}</strong></div>
            </div>})}
          {poItems.filter((_,vi)=>!poExcluded[vi]).length>0&&<div style={{display:'flex',justifyContent:'flex-end',alignItems:'baseline',gap:8,padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,marginTop:4}}>
            <span style={{fontSize:13,fontWeight:600,color:'#475569'}}>PO Total ({poItems.filter((_,vi)=>!poExcluded[vi]).length} item{poItems.filter((_,vi)=>!poExcluded[vi]).length!==1?'s':''}):</span>
            <strong style={{fontSize:18,fontWeight:800,color:'#0f172a'}}>${poOrderTotal.toFixed(2)}</strong></div>}
          <div style={{marginTop:8}}><label className="form-label">Notes</label><input className="form-input" placeholder="PO notes for vendor..." id={'po-notes-'+poId}/></div></>}
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>{setShowPO('select');setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});setPoShipTo('warehouse')}}>← Back</button><button className="btn btn-secondary" onClick={()=>{setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});setPoShipTo('warehouse')}}>Cancel</button>
          {poItems.length>0&&isBatchEligible&&!preexistingPO&&<button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} disabled={poItems.every((_,vi)=>poExcluded[vi])||o._posHydrated===false} onClick={()=>{
            if(o._posHydrated===false){nf("⚠️ This order's existing POs haven't finished loading. Reload the page before creating a PO so you don't create a duplicate.","error");return}
            // Build batch PO entry
            const isDropShip=document.getElementById('po-dropship-'+autoPoId)?.checked||false;
            const batchItems=[];let totalCost=0;
            poItems.forEach((pit,vi)=>{
              if(poExcluded[vi])return;
              const sizes={};
              pit.openSizes.forEach(([sz,v])=>{const el=document.getElementById('po-qty-'+vi+'-'+sz);sizes[sz]=el?parseInt(el.value)||0:v});
              const qty=Object.values(sizes).reduce((a,v)=>a+v,0);
              const batchCatProd=products.find(p=>p.id===pit.product_id||p.sku===pit.sku);
              const fallbackCost=safeNum(batchCatProd?.nsa_cost??pit.nsa_cost);
              // Prefer per-size price inputs (size upcharges); fall back to single Price/Unit input
              const sizePriceEls=pit.openSizes.map(([sz])=>document.getElementById('po-price-'+vi+'-'+sz));
              const hasSizePrices=sizePriceEls.some(el=>el);
              const sizeCosts={};let batchUnitCost=0;let batchLineTotal=0;
              if(hasSizePrices){
                pit.openSizes.forEach(([sz],i)=>{const el=sizePriceEls[i];const p=el?parseFloat(String(el.value).replace(/[$,\s]/g,''))||0:safeNum(pit._sizeCosts?.[sz])||fallbackCost;sizeCosts[sz]=p;batchLineTotal+=(sizes[sz]||0)*p});
                batchUnitCost=qty>0?Math.round((batchLineTotal/qty)*100)/100:fallbackCost;
              }else{
                const batchPriceEl=document.getElementById('po-price-'+vi);
                batchUnitCost=batchPriceEl?parseFloat(String(batchPriceEl.value).replace(/[$,\s]/g,''))||0:fallbackCost;
                batchLineTotal=qty*batchUnitCost;
              }
              totalCost+=batchLineTotal;
              const bItem={sku:pit.sku,name:pit.name,color:pit.color,sizes,qty,unit_cost:batchUnitCost,item_idx:pit._idx};
              if(hasSizePrices&&new Set(Object.values(sizeCosts).map(v=>v.toFixed(2))).size>1)bItem._size_costs=sizeCosts;
              if(isDropShip)bItem.drop_ship=true;
              batchItems.push(bItem);
            });
            const bpId='BPO '+Date.now();
            const bp={id:bpId,vendor_key:batchKey,vendor_name:batchConfig.name,so_id:o.id,so_memo:o.memo||'',customer:cust?.alpha_tag||cust?.name||'',po_id:autoPoId,
              items:batchItems,total_cost:totalCost,created_by:cu.id,created_by_name:cu.name,created_at:new Date().toLocaleString()};
            // Also persist a source PO line on the order so the SO shows its own PO# (e.g. PO-3005-DHF),
            // not just the eventual bulk batch PO. The line stays in "queued" status until the batch is submitted.
            const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
            batchItems.forEach(bit=>{
              const idx=bit.item_idx;if(idx==null||!updatedItems[idx])return;
              const poLine={po_id:autoPoId,vendor:vn,status:'queued',created_at:new Date().toLocaleDateString(),memo:'Batch queue — '+batchConfig.name,received:{},shipments:[],unit_cost:bit.unit_cost,batch_queue_id:bpId};
              if(bit._size_costs)poLine._size_costs=bit._size_costs;
              if(bit.drop_ship)poLine.drop_ship=true;
              Object.entries(bit.sizes).forEach(([sz,v])=>{if(v>0)poLine[sz]=v});
              const hasQty=Object.entries(poLine).some(([k,v])=>k!=='po_id'&&k!=='status'&&typeof v==='number'&&v>0);
              if(hasQty)updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];
            });
            // Queue the batch entry BEFORE saving the SO so its app_state write is in flight
            // before the SO save's post-guard poll runs; avoids a poll clobbering the queue.
            if(onBatchPO)onBatchPO(prev=>[...prev,bp]);
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
            setO(updated);onSave(updated);setPOCounter(c=>c+1);
            setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});setPoShipTo('warehouse');nf('Added to '+batchConfig.name+' batch queue as '+autoPoId+' ($'+totalCost.toFixed(2)+')');
            // If this addition pushes the SanMar batch queue over the free-ship threshold,
            // pop a "ready to order" prompt with a dry-run API preview button.
            const newBatchTotal=pendingBatchTotal+totalCost;
            if(batchKey==='sanmar'&&batchConfig.threshold>0&&newBatchTotal>=batchConfig.threshold){
              setBatchReadyPopup({vendorKey:batchKey,vendorName:batchConfig.name,total:newBatchTotal,threshold:batchConfig.threshold,batchPOs:[...pendingBatches,bp],count:pendingBatches.length+1});
            }
          }}><Icon name="package" size={14}/> Add to Batch ({poItems.filter((_,vi)=>!poExcluded[vi]).length})</button>}
          {poItems.length>0&&(preexistingPO||!batchConfig?.batchOnly)&&<button className="btn btn-primary" style={preexistingPO?{background:'#d97706',borderColor:'#d97706'}:{}} disabled={poItems.every((_,vi)=>poExcluded[vi])||o._posHydrated===false} onClick={()=>{
          if(o._posHydrated===false){nf("⚠️ This order's existing POs haven't finished loading. Reload the page before creating a PO so you don't create a duplicate.","error");return}
          if(preexistingPO&&!preexistingPOId.trim()){nf('Please enter a PO number','error');return}
          const effectivePoId=preexistingPO?preexistingPOId.trim():autoPoId;
          const dropShipElId=preexistingPO?'po-dropship-preexisting':'po-dropship-'+autoPoId;
          // Save PO lines back to order items (immutable)
          const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
          const newPoLines=[];// {lineIdx,poIdx} pairs for the just-created PO so we can auto-open the modal
          poItems.forEach((pit,vi)=>{
            if(poExcluded[vi])return;
            const idx=pit._idx;if(idx==null)return;
            const isDropShip=document.getElementById(dropShipElId)?.checked||false;
            const catProd=products.find(p=>p.id===pit.product_id||p.sku===pit.sku);
            const fallbackCost=safeNum(catProd?.nsa_cost??pit.nsa_cost);
            // Read PO qtys first so we can weight per-size prices
            const lineSizes={};pit.openSizes.forEach(([sz,v])=>{const el=document.getElementById('po-qty-'+vi+'-'+sz);lineSizes[sz]=el?parseInt(el.value)||0:v});
            const lineQty=Object.values(lineSizes).reduce((a,v)=>a+v,0);
            // Prefer per-size price inputs (size upcharges); fall back to single Price/Unit input
            const sizePriceEls=pit.openSizes.map(([sz])=>document.getElementById('po-price-'+vi+'-'+sz));
            const hasSizePrices=sizePriceEls.some(el=>el);
            const sizeCosts={};let unitCostVal=0;
            if(hasSizePrices){
              let lineTotal=0;
              pit.openSizes.forEach(([sz],i)=>{const el=sizePriceEls[i];const p=el?parseFloat(String(el.value).replace(/[$,\s]/g,''))||0:safeNum(pit._sizeCosts?.[sz])||fallbackCost;sizeCosts[sz]=p;lineTotal+=(lineSizes[sz]||0)*p});
              unitCostVal=lineQty>0?Math.round((lineTotal/lineQty)*100)/100:fallbackCost;
            }else{
              const priceEl=document.getElementById('po-price-'+vi);
              unitCostVal=priceEl?parseFloat(String(priceEl.value).replace(/[$,\s]/g,''))||0:fallbackCost;
            }
            const poLine={po_id:effectivePoId,vendor:vn,status:preexistingPO?'ordered':'waiting',created_at:new Date().toLocaleDateString(),memo:preexistingPO?'Preexisting PO (NetSuite)':'',received:{},shipments:[],unit_cost:unitCostVal};
            if(hasSizePrices&&new Set(Object.values(sizeCosts).map(v=>v.toFixed(2))).size>1)poLine._size_costs=sizeCosts;
            if(preexistingPO)poLine.preexisting=true;
            if(isDropShip)poLine.drop_ship=true;
            Object.entries(lineSizes).forEach(([sz,v])=>{poLine[sz]=v});
            const hasQty=Object.entries(poLine).some(([k,v])=>k!=='po_id'&&k!=='status'&&typeof v==='number'&&v>0);
            if(hasQty){
              updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];
              newPoLines.push({lineIdx:idx,poIdx:updatedItems[idx].po_lines.length-1});
            }
          });
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
          setO(updated);onSave(updated);
          if(!preexistingPO)setPOCounter(c=>c+1);
          const selCount=poItems.filter((_,vi)=>!poExcluded[vi]).length;
          setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});setPoShipTo('warehouse');nf(effectivePoId+' '+(preexistingPO?'applied':'created')+' for '+vn+' ('+selCount+' item'+(selCount!==1?'s':'')+')');
          // Auto-open the PO modal on the newly created PO so the user can immediately email or download.
          if(newPoLines.length>0&&!preexistingPO){
            const first=newPoLines[0];
            const newPo=updatedItems[first.lineIdx].po_lines[first.poIdx];
            setEditPO({lineIdx:first.lineIdx,poIdx:first.poIdx,po:newPo,allLines:newPoLines});
          }
        }}><Icon name="cart" size={14}/> {preexistingPO?'Apply Preexisting PO':'Create PO'} ({poItems.filter((_,vi)=>!poExcluded[vi]).length})</button>}</div>
      </div></div>})()}

      {/* Batch threshold popup — fires after Add-to-Batch when SanMar queue hits its free-ship threshold.
          Reads live from batchPOs (rather than the popup snapshot) so price edits show immediately. */}
      {batchReadyPopup&&(()=>{
        const liveBatches=(batchPOs||[]).filter(bp=>bp.vendor_key===batchReadyPopup.vendorKey);
        const liveTotal=liveBatches.reduce((a,bp)=>a+(bp.total_cost||0),0);
        const updateLineCost=(bpId,itemIdx,newCost)=>{
          const c=Math.max(0,parseFloat(String(newCost).replace(/[$,\s]/g,''))||0);
          if(onBatchPO)onBatchPO(prev=>(prev||[]).map(bp=>{
            if(bp.id!==bpId)return bp;
            const items=(bp.items||[]).map((it,i)=>i===itemIdx?{...it,unit_cost:c}:it);
            const total_cost=items.reduce((a,it)=>a+(it.qty||0)*(it.unit_cost||0),0);
            return{...bp,items,total_cost};
          }));
          // Sync the matching source PO line on this SO so the order's per-line cost
          // stays consistent with the batch (only for batches that belong to this SO).
          const bp=(batchPOs||[]).find(x=>x.id===bpId);
          if(bp&&bp.so_id===o.id){
            const targetItem=bp.items?.[itemIdx];
            const items2=safeItems(o).map(it=>{
              const pls=(it.po_lines||[]).map(pl=>{
                if(pl.batch_queue_id===bpId&&(targetItem==null||it.sku===targetItem.sku))return{...pl,unit_cost:c};
                return pl;
              });
              return{...it,po_lines:pls};
            });
            const updated={...o,items:items2,updated_at:new Date().toLocaleString()};
            setO(updated);onSave(updated);
          }
        };
        return<div className="modal-overlay" onClick={()=>setBatchReadyPopup(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:780,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>🎯 {batchReadyPopup.vendorName} Batch Ready</h2><button className="modal-close" onClick={()=>setBatchReadyPopup(null)}>x</button></div>
        <div className="modal-body">
          <div style={{padding:14,background:'linear-gradient(135deg,#f0fdf4,#dcfce7)',border:'1px solid #86efac',borderRadius:8,marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
            <div>
              <div style={{fontSize:10,color:'#166534',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>Use this PO# when ordering on sanmar.com</div>
              <div style={{fontSize:24,fontWeight:900,fontFamily:'monospace',color:'#1e40af',letterSpacing:2}}>{nextBatchPONumber||'NSA-####'}</div>
              <button style={{marginTop:4,fontSize:10,padding:'2px 8px',border:'1px solid #86efac',background:'white',borderRadius:4,cursor:'pointer',color:'#166534',fontWeight:700}} onClick={()=>{navigator.clipboard?.writeText(nextBatchPONumber||'');nf('Copied '+(nextBatchPONumber||''))}}>📋 Copy</button>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#166534',fontWeight:600}}>Free-ship threshold hit</div>
              <div style={{fontSize:28,fontWeight:900,color:'#15803d'}}>${liveTotal.toFixed(2)}</div>
              <div style={{fontSize:11,color:'#166534'}}>{liveBatches.length} PO{liveBatches.length!==1?'s':''} queued · threshold ${batchReadyPopup.threshold}</div>
            </div>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Batch contents · {liveBatches.length} PO{liveBatches.length!==1?'s':''} <span style={{fontWeight:500,textTransform:'none',color:'#94a3b8'}}>(unit costs are editable — changes sync to the SO)</span></div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden',marginBottom:12}}>
            {liveBatches.map((bp,bi)=>{
              const bpTotal=(bp.items||[]).reduce((a,it)=>a+(it.qty||0)*(it.unit_cost||0),0);
              return<div key={bp.id||bi} style={{borderTop:bi>0?'1px solid #f1f5f9':'none',background:bi%2?'#fafbfc':'white'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#f8fafc',borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{fontSize:12,fontWeight:700}}>
                    <span style={{fontFamily:'monospace',color:'#1e40af'}}>{bp.po_id||'(no PO#)'}</span>
                    <span style={{color:'#64748b',marginLeft:8,fontWeight:500}}>· {bp.so_id} · {bp.customer||'—'}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:'#15803d'}}>${bpTotal.toFixed(2)}</div>
                </div>
                {(bp.items||[]).map((it,ii)=>{
                  const szList=Object.entries(it.sizes||{}).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
                  return<div key={ii} style={{padding:'8px 12px',borderTop:ii>0?'1px solid #f8fafc':'none'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,gap:8,flexWrap:'wrap'}}>
                      <div style={{fontSize:12,minWidth:0,flex:1}}>
                        <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:6}}>{it.sku}</span>
                        <span style={{fontWeight:600}}>{it.name}</span>
                        {it.color&&<span style={{color:'#64748b'}}> — {it.color}</span>}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>
                        <span>{it.qty} × $</span>
                        <input
                          type="number" step="0.01" min="0"
                          defaultValue={(it.unit_cost||0).toFixed(2)}
                          onBlur={e=>{const v=parseFloat(e.target.value)||0;if(Math.abs(v-(it.unit_cost||0))>=0.005)updateLineCost(bp.id,ii,v)}}
                          onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}}
                          style={{width:64,textAlign:'right',padding:'2px 6px',border:'1px solid #cbd5e1',borderRadius:4,fontSize:12,fontWeight:700,color:'#0f172a'}}
                          title="Edit unit cost — saves on blur and updates the source SO PO line"
                        />
                        <span>= <strong style={{color:'#0f172a'}}>${((it.qty||0)*(it.unit_cost||0)).toFixed(2)}</strong></span>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      {szList.map(([sz,v])=><span key={sz} style={{fontSize:10,padding:'2px 6px',background:'#e0e7ff',color:'#3730a3',borderRadius:3,fontWeight:700}}>{sz}:<span style={{color:'#1e40af'}}>{v}</span></span>)}
                    </div>
                  </div>;
                })}
              </div>;
            })}
          </div>
          <p style={{fontSize:12,color:'#64748b',margin:0}}>
            Use the PO# above when placing the order on sanmar.com. To edit sizes or remove a line, close this popup and use the Batch POs page. Preview the API payload below to see what would be sent once live submit is enabled.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setBatchReadyPopup(null)}>Continue working</button>
          <button className="btn btn-secondary" style={{color:'#6d28d9',borderColor:'#c4b5fd'}} onClick={()=>{
            setSanMarPreviewBatch({poNumber:nextBatchPONumber||'NSA-####',batchPOs:liveBatches,vendorName:batchReadyPopup.vendorName});
            setBatchReadyPopup(null);
          }}>🔍 Preview SanMar API Payload</button>
        </div>
      </div></div>;
      })()}

      {sanmarPreviewBatch&&<SanMarPreviewModal {...sanmarPreviewBatch} onClose={()=>setSanMarPreviewBatch(null)}/>}

        {showPick&&<div className="modal-overlay" onClick={()=>{setShowPick(false);setPickSel({})}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header"><h2>{typeof showPick==='object'?'IF — '+pickId:'Create IF — Select Items'}</h2><button className="modal-close" onClick={()=>{setShowPick(false);setPickSel({})}}>x</button></div>
      {typeof showPick!=='object'?<div className="modal-body">
        <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Select items to include on this IF:</p>
        {(()=>{const availableIdxs=[];safeItems(o).forEach((item,idx)=>{const szList=Object.entries(item.sizes).filter(([,v])=>v>0);const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const hasOpen=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const inv=p?._inv?.[sz]||0;return v-picked-po>0&&inv>0});if(hasOpen)availableIdxs.push(idx)});
        const allChecked=availableIdxs.length>0&&availableIdxs.every(i=>pickSel[i]);
        return<><div style={{marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,fontWeight:600,color:'#475569'}}><input type="checkbox" checked={allChecked} onChange={()=>{if(allChecked){setPickSel({})}else{const sel={};availableIdxs.forEach(i=>{sel[i]=true});setPickSel(sel)}}} style={{width:16,height:16}}/> Select All ({availableIdxs.length})</label></div>
        {safeItems(o).map((item,idx)=>{const q=Object.values(item.sizes).reduce((a,v)=>a+v,0);const szList=Object.entries(item.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=SZ_ORD;return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
          const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
          const hasOpen=szList.some(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const inv=p?._inv?.[sz]||0;return v-picked-po>0&&inv>0});
          if(!hasOpen){
            // hasOpen=false has two meanings: (a) every size is already picked/on PO ("Fully assigned"),
            // or (b) open qty remains but no inventory exists yet ("Need to order"). Only render the
            // Fully-assigned row for case (a); case (b) belongs on a PO, not an IF.
            const trulyFullyAssigned=szList.every(([sz,v])=>{const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);return v-picked-po<=0});
            if(!trulyFullyAssigned)return null;
            return<div key={idx} style={{padding:10,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,opacity:0.5}}><span style={{fontWeight:700}}>{item.sku}</span> {item.name} — <span style={{color:'#166534',fontWeight:600}}>Fully assigned</span></div>;
          }
          return<div key={idx} style={{padding:10,border:pickSel[idx]?'2px solid #3b82f6':'1px solid #e2e8f0',borderRadius:6,marginBottom:6,cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:pickSel[idx]?'#eff6ff':'white'}} onClick={()=>setPickSel(prev=>({...prev,[idx]:!prev[idx]}))}>
            <input type="checkbox" checked={!!pickSel[idx]} readOnly style={{width:18,height:18}}/>
            <div style={{flex:1}}><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:6}}>{item.sku}</span><strong>{item.name}</strong> — {item.color}
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{szList.map(([sz,v])=>{const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,v-picked-po);return open>0?sz+': '+open+' open ('+inv+' inv) ':'';}).filter(Boolean).join(' | ')}</div></div></div>})}</>})()}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12}}>
          <div style={{fontSize:11,color:'#94a3b8'}}>Select items and click Continue. You can adjust quantities on the next screen.</div>
          <button className="btn btn-primary" disabled={!Object.values(pickSel).some(Boolean)} style={{padding:'8px 20px',fontWeight:700}} onClick={()=>{
            const pickItems=safeItems(o).map((it,i)=>{if(!pickSel[i])return null;const szs2=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const pp=products.find(pp2=>pp2.id===it.product_id||pp2.sku===it.sku);
              return{...it,_idx:i,_pick:Object.fromEntries(szs2.map(([sz,v])=>{const inv=pp?._inv?.[sz]||0;const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,inv>0?Math.min(open,inv):0]}))}}).filter(Boolean);
            setShowPick(pickItems);setPickSel({})}}>Continue ({Object.values(pickSel).filter(Boolean).length})</button>
        </div>
      </div>
      :<div className="modal-body">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}><img src={_ci.logoUrl} alt="NSA" style={{height:36}}/><div><div style={{fontSize:12,color:'#64748b'}}>Item Fulfillment</div></div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{pickId}</div><div style={{fontSize:14,fontWeight:700,color:'#475569'}}>{o.id}</div><div style={{fontSize:12,color:'#64748b'}}>{new Date().toLocaleDateString()}</div></div></div>
        <hr style={{border:'2px solid #0f172a',marginBottom:12}}/>
        <div style={{display:'flex',gap:40,marginBottom:12}}><div><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>CUSTOMER</div><div style={{fontWeight:700}}>{cust?.name}</div><div style={{fontSize:12,color:'#64748b'}}>{cust?.alpha_tag}</div></div>
          <div><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>SHIP TO</div><div style={{fontSize:12}}>{addrs.find(a=>a.id===o.ship_to_id)?.label||'—'}</div></div></div>
        {o.prod_notes&&<div style={{padding:'8px 12px',background:'#fef9c3',borderRadius:4,marginBottom:12,fontSize:13}}><strong>Notes:</strong> {o.prod_notes}</div>}
        {/* Shipping Destination */}
        <div style={{padding:12,background:'#f8fafc',borderRadius:8,marginBottom:12,border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>Shipping Destination</div>
          <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
            {[['in_house','🏭 In-House Deco'],['ship_customer','📦 Ship to Customer'],['ship_deco','🚚 Ship to Deco']].map(([v,l])=>
              <button key={v} className={`btn btn-sm ${pickShipDest===v?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setPickShipDest(v)}>{l}</button>)}
          </div>
          {pickShipDest==='ship_customer'&&<div style={{marginTop:6}}>
            <label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Ship To Address</label>
            <select className="form-select" style={{fontSize:12}} value={pickShipAddr} onChange={e=>setPickShipAddr(e.target.value)}>
              {addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}
              {o.ship_to_custom&&<option value="custom">Custom: {o.ship_to_custom}</option>}
            </select>
          </div>}
          {pickShipDest==='ship_deco'&&<div style={{marginTop:6}}>
            <label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Decoration Vendor</label>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {DECO_VENDORS.map(dv=><button key={dv} className={`btn btn-sm ${pickDecoVendor===dv?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setPickDecoVendor(dv)}>{dv}</button>)}
            </div>
            {pickDecoVendor==='Other'&&<input className="form-input" style={{marginTop:6,fontSize:12}} placeholder="Enter vendor name..." onChange={e=>setPickDecoVendor(e.target.value||'Other')}/>}
          </div>}
        </div>
        {/* Warehouse Notes */}
        <div style={{marginBottom:12}}>
          <label style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase'}}>Notes for Warehouse</label>
          <textarea className="form-input" rows={2} value={pickNotes} onChange={e=>setPickNotes(e.target.value)} placeholder="Special instructions for warehouse team..." style={{fontSize:12,resize:'vertical'}}/>
        </div>
        {showPick.map((item,vi)=>{const szList=Object.entries(item._pick).filter(([,v])=>v>0);const q=szList.reduce((a,[,v])=>a+v,0);const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
          return<div key={vi} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{item.sku}</span><strong>{item.name}</strong> — {item.color}</div><div style={{fontWeight:700}}>IF Qty: {q}</div></div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><thead><tr style={{borderBottom:'2px solid #0f172a'}}>{szList.map(([sz])=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:50}}>{sz}</th>)}<th style={{padding:'4px 8px'}}>TOTAL</th></tr></thead>
            <tbody><tr style={{fontSize:10,color:'#64748b'}}>{szList.map(([sz])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'2px 8px',textAlign:'center'}}>open: {open} | inv: {inv}</td>})}<td/></tr>
            <tr>{szList.map(([sz,v])=>{const need=item.sizes[sz]||0;const inv=p?._inv?.[sz]||0;const picked=(item.pick_lines||[]).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(item.po_lines,sz);const open=Math.max(0,need-picked-po);return<td key={sz} style={{padding:'4px 8px',textAlign:'center'}}><input id={'pick-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:v<open?'2px solid #f59e0b':'1px solid #10b981',borderRadius:3,padding:'3px',fontSize:14,fontWeight:700,background:v<open?'#fef3c7':'#dcfce7'}} defaultValue={v}/></td>})}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800,fontSize:14}}>{q}</td></tr></tbody></table>
            {safeDecos(item).filter(d=>d.kind==='art').map((d,di)=>{const art=af.find(a=>a.id===d.art_file_id);return art?<div key={di} style={{fontSize:12,marginTop:6,padding:'4px 8px',background:'#f0fdf4',borderRadius:4}}>🎨 {art.name} — {art.deco_type} @ {d.position}{d.underbase?' [Underbase]':''}{d.reversible?' [Reversible]':''}</div>:null})}
            {safeDecos(item).filter(d=>d.kind==='numbers').map((d,di)=><div key={di} style={{fontSize:12,marginTop:4,padding:'4px 8px',background:'#f0f9ff',borderRadius:4}}>#️⃣ Numbers — {d.num_method} {d.front_and_back?'F:'+d.num_size+' B:'+(d.num_size_back||d.num_size):d.num_size} @ {d.position}{d.front_and_back?' (F+B)':''}{d.reversible?' [Rev]':''}</div>)}
          </div>})}
      </div>}
      <div className="modal-footer">
        {typeof showPick==='object'?<>
          <button className="btn btn-secondary" onClick={()=>setShowPick(true)}>← Back</button>
          <button className="btn btn-secondary" onClick={()=>window.print()}>🖨️ Print</button>
          <button className="btn btn-primary" onClick={()=>{
            // Save pick lines back to order items (immutable)
            const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
            showPick.forEach((pk,vi)=>{
              const idx=pk._idx;if(idx==null)return;
              // Read actual qty values from DOM inputs (user may have edited them)
              const pickLine={status:'pick',pick_id:pickId,created_at:new Date().toLocaleDateString(),memo:pickNotes,ship_dest:pickShipDest,ship_addr:pickShipDest==='ship_customer'?pickShipAddr:'',deco_vendor:pickShipDest==='ship_deco'?pickDecoVendor:''};
              Object.entries(pk._pick).forEach(([sz,v])=>{
                if(typeof v!=='number'||v<=0)return;
                const el=document.getElementById('pick-qty-'+vi+'-'+sz);
                pickLine[sz]=el?Math.max(0,parseInt(el.value)||0):v;
              });
              // Only add if there's actually qty to pick
              const hasQty=Object.entries(pickLine).some(([k,v])=>k!=='status'&&k!=='pick_id'&&v>0);
              if(hasQty){
                updatedItems[idx].pick_lines=[...updatedItems[idx].pick_lines,pickLine];
              }
            });
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
            setO(updated);onSave(updated);
            // NOTE: Inventory is NOT decremented on pick creation (status:'pick')
            // It only decrements when status is changed to 'pulled' via the edit handler
            // This prevents double-decrement: create → edit to pulled
            setShowPick(false);setPickId('IF-'+String((parseInt(pickId.replace('IF-',''))||4000)+1));setPickNotes('');setPickShipDest('in_house');setPickDecoVendor('');setPickShipAddr('default');
            const destLabel=pickShipDest==='ship_customer'?'→ Ship to Customer':pickShipDest==='ship_deco'?'→ '+pickDecoVendor:'→ In-House Deco';
            nf(pickId+' sent to warehouse ('+destLabel+')');
          }} style={{padding:'8px 20px',fontWeight:700}}>📦 Send to Warehouse</button>
        </>:<button className="btn btn-secondary" onClick={()=>{setShowPick(false);setPickSel({})}}>Cancel</button>}
      </div>
    </div></div>}

    {/* JOBS TAB */}
    {isSO&&tab==='jobs'&&(()=>{
      const jobs=safeJobs(o);

      // Manual refresh — rebuild jobs from current items/decorations and persist. Preserves
      // merged/split/released jobs; picks up any newly added items that don't yet have a job.
      const refreshJobs=()=>{const synced=syncJobs();const updated={...o,jobs:synced,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('🔄 Jobs synced — '+synced.length+' job'+(synced.length===1?'':'s'))};

      // Split job modal state
      // Split job modal state is at component level (splitModal/setSplitModal)

      // Helper: copy art-related fields from parent job to split job (deep clones nested arrays so
      // they aren't shared by reference; simple fields are already carried by the {...j} spread).
      const _artFields=j=>({art_file_id:j.art_file_id,_art_ids:j._art_ids?[...j._art_ids]:null,art_name:j.art_name,art_status:j.art_status,deco_type:j.deco_type,positions:j.positions,
        art_requests:j.art_requests?JSON.parse(JSON.stringify(j.art_requests)):[],
        art_messages:j.art_messages?JSON.parse(JSON.stringify(j.art_messages)):[],
        sent_history:j.sent_history?JSON.parse(JSON.stringify(j.sent_history)):[],
        assigned_artist:j.assigned_artist||null,rep_notes:j.rep_notes||null,
        rejections:j.rejections?JSON.parse(JSON.stringify(j.rejections)):null,
        sent_to_coach_at:j.sent_to_coach_at||null,coach_approved_at:j.coach_approved_at||null,coach_approval_comment:j.coach_approval_comment||null,coach_rejected:j.coach_rejected||null,coach_email_opened_at:j.coach_email_opened_at||null,
        follow_up_at:j.follow_up_at||null});

      // Split job by received — create partial job with received items
      const splitByReceived=(jIdx)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length)return;
        const rcvdItems=[];let rcvdTotal=0;
        j.items.forEach(ji=>{
          const it=safeItems(o)[ji.item_idx];if(!it)return;
          let ful=0;
          Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            ful+=Math.min(v,pQ+rQ);
          });
          if(ful>0){rcvdItems.push({...ji,fulfilled:ful,units:ful});rcvdTotal+=ful}
        });
        if(rcvdTotal===0){nf('Nothing received to split','error');return}
        const splitId=j.id+'-S';
        const splitJob2={...j,..._artFields(j),id:splitId,key:j.key+'__split__S',split_from:j.id,item_status:'items_received',items:rcvdItems,
          fulfilled_units:rcvdTotal,total_units:rcvdTotal,
          prod_status:'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,total_units:j.total_units-rcvdTotal,fulfilled_units:Math.max(0,j.fulfilled_units-rcvdTotal),item_status:'need_to_order'};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        const updated={...o,jobs:newJobs2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSplitModal(null);nf('Split! '+splitId+' ready with '+rcvdTotal+' units');
      };

      // Split job by SKU — separate into one job per garment
      const splitBySku=(jIdx,selectedSkus)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length||!selectedSkus?.length)return;
        const keepItems=j.items.filter(gi=>!selectedSkus.includes(gi.sku));
        const splitItems=j.items.filter(gi=>selectedSkus.includes(gi.sku));
        if(splitItems.length===0||keepItems.length===0){nf('Select some (not all) SKUs to split','error');return}
        const splitUnits=splitItems.reduce((a,gi)=>a+gi.units,0);
        const splitFul=splitItems.reduce((a,gi)=>a+gi.fulfilled,0);
        const keepUnits=keepItems.reduce((a,gi)=>a+gi.units,0);
        const keepFul=keepItems.reduce((a,gi)=>a+gi.fulfilled,0);
        const splitId=j.id+'-B';
        const splitJob2={...j,..._artFields(j),id:splitId,key:j.key+'__split__B',split_from:j.id,items:splitItems,
          total_units:splitUnits,fulfilled_units:splitFul,
          prod_status:'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,items:keepItems,total_units:keepUnits,fulfilled_units:keepFul};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        const updated={...o,jobs:newJobs2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSplitModal(null);nf('Split by SKU! '+splitId+' with '+splitItems.length+' garment(s)');
      };
      // Resolve per-size totals/fulfillment for a given job item, honoring any prior split overrides.
      const _giSizes=gi=>{
        if(gi.sizes)return{...gi.sizes};
        const it=safeItems(o)[gi.item_idx];if(!it)return{};
        const out={};
        Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{out[sz]=safeNum(v)});
        return out;
      };
      const _giFulSizes=(gi,maxSizes)=>{
        if(gi.fulSizes)return{...gi.fulSizes};
        const it=safeItems(o)[gi.item_idx];if(!it)return{};
        const out={};
        Object.entries(maxSizes||_giSizes(gi)).forEach(([sz,cap])=>{
          const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
          const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
          out[sz]=Math.min(safeNum(cap),pQ+rQ);
        });
        return out;
      };
      // Combine job items sharing the same item_idx+sku — sums units/fulfilled and merges per-size maps.
      // Used when merging jobs back together so a previously size-split item rejoins as a single line.
      const _mergeJobItems=(items)=>{
        const map=new Map();const order=[];
        (items||[]).forEach(gi=>{
          const key=gi.item_idx+'-'+gi.sku;
          const existing=map.get(key);
          const giDecoIdxs=Array.isArray(gi.deco_idxs)&&gi.deco_idxs.length?gi.deco_idxs:(gi.deco_idx!=null?[gi.deco_idx]:[]);
          if(!existing){
            const copy={...gi,deco_idxs:[...giDecoIdxs]};
            if(gi.sizes)copy.sizes={...gi.sizes};
            if(gi.fulSizes)copy.fulSizes={...gi.fulSizes};
            if(gi.roster)copy.roster=JSON.parse(JSON.stringify(gi.roster));
            map.set(key,copy);order.push(key);return;
          }
          // Same item appearing in two merged jobs covers additional decorations — union the
          // deco indices so the merged job freezes every decoration (else syncJobs regenerates
          // the un-tracked ones as branched-off jobs).
          existing.deco_idxs=[...new Set([...(existing.deco_idxs||[]),...giDecoIdxs])];
          existing.units=safeNum(existing.units)+safeNum(gi.units);
          existing.fulfilled=safeNum(existing.fulfilled)+safeNum(gi.fulfilled);
          if(gi.sizes||existing.sizes){
            const merged={...(existing.sizes||{})};
            Object.entries(gi.sizes||{}).forEach(([sz,v])=>{merged[sz]=safeNum(merged[sz])+safeNum(v)});
            existing.sizes=merged;
          }
          if(gi.fulSizes||existing.fulSizes){
            const merged={...(existing.fulSizes||{})};
            Object.entries(gi.fulSizes||{}).forEach(([sz,v])=>{merged[sz]=safeNum(merged[sz])+safeNum(v)});
            existing.fulSizes=merged;
          }
          if(gi.roster||existing.roster){
            const merged={...(existing.roster||{})};
            Object.entries(gi.roster||{}).forEach(([sz,arr])=>{merged[sz]=[...(merged[sz]||[]),...(arr||[])]});
            existing.roster=merged;
          }
        });
        return order.map(k=>map.get(k));
      };
      // Custom split — split specific sizes per item into a new job; items not flagged stay on the original.
      // splitItemSizes shape: { [item_idx]: { S: 2, M: 1, ... } } — only entries with at least one positive size are split.
      const splitCustom=(jIdx,splitItemSizes)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length)return;
        const splitItems=[];const keepItems=[];
        let splitTotal=0,splitFul=0,keepTotal=0,keepFul=0;
        j.items.forEach(gi=>{
          const curSizes=_giSizes(gi);
          const curFul=_giFulSizes(gi,curSizes);
          const reqSizes=splitItemSizes?.[gi.item_idx]||{};
          const splitSizes={};const remainSizes={};
          let sUnits=0,rUnits=0;
          Object.entries(curSizes).forEach(([sz,v])=>{
            const want=Math.max(0,Math.min(safeNum(reqSizes[sz]),safeNum(v)));
            if(want>0){splitSizes[sz]=want;sUnits+=want}
            const rem=safeNum(v)-want;
            if(rem>0){remainSizes[sz]=rem;rUnits+=rem}
          });
          // Allocate fulfillment proportionally: receipts go to the split portion first up to its size cap.
          const splitFulSizes={};const remainFulSizes={};
          let sFul=0,rFul=0;
          Object.keys(curSizes).forEach(sz=>{
            const ful=safeNum(curFul[sz]);
            const sCap=safeNum(splitSizes[sz]);
            const rCap=safeNum(remainSizes[sz]);
            const sF=Math.min(ful,sCap);
            const rF=Math.min(ful-sF,rCap);
            if(sF>0){splitFulSizes[sz]=sF;sFul+=sF}
            if(rF>0){remainFulSizes[sz]=rF;rFul+=rF}
          });
          // Partition the roster: first N per size go to the split, the remainder stays on the parent.
          // Reads gi.roster if this item is itself a split slice; falls back to the source decoration's roster.
          const _srcIt=safeItems(o)[gi.item_idx];
          const _srcDeco=_srcIt?safeDecos(_srcIt).find(d=>d.kind==='numbers'):null;
          const baseRoster=gi.roster||_srcDeco?.roster||null;
          let splitRoster=null,remainRoster=null;
          if(baseRoster){
            splitRoster={};remainRoster={};
            Object.keys(curSizes).forEach(sz=>{
              const arr=Array.isArray(baseRoster[sz])?baseRoster[sz].slice():[];
              const sCap=safeNum(splitSizes[sz]);
              const rCap=safeNum(remainSizes[sz]);
              if(sCap>0){const head=arr.slice(0,sCap);splitRoster[sz]=head.concat(Array(Math.max(0,sCap-head.length)).fill(''))}
              if(rCap>0){const tail=arr.slice(sCap);remainRoster[sz]=tail.concat(Array(Math.max(0,rCap-tail.length)).fill(''))}
            });
          }
          if(sUnits>0){
            const item={...gi,sizes:splitSizes,fulSizes:splitFulSizes,units:sUnits,fulfilled:sFul};
            if(splitRoster)item.roster=splitRoster;
            splitItems.push(item);
            splitTotal+=sUnits;splitFul+=sFul;
          }
          if(rUnits>0){
            const item={...gi,sizes:remainSizes,fulSizes:remainFulSizes,units:rUnits,fulfilled:rFul};
            if(remainRoster)item.roster=remainRoster;
            keepItems.push(item);
            keepTotal+=rUnits;keepFul+=rFul;
          }
        });
        if(splitTotal===0){nf('Select at least one size to split off','error');return}
        if(keepItems.length===0||keepTotal===0){nf('Must leave some units on the original job','error');return}
        const existingSplits=jobs.filter(jj=>jj.split_from===j.id).length;
        const splitId=j.id+'-C'+(existingSplits+1);
        const splitJob2={...j,..._artFields(j),id:splitId,key:j.key+'__split__C'+(existingSplits+1),split_from:j.id,items:splitItems,
          total_units:splitTotal,fulfilled_units:splitFul,
          item_status:splitFul>=splitTotal&&splitTotal>0?'items_received':splitFul>0?'partially_received':'need_to_order',
          prod_status:'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,items:keepItems,total_units:keepTotal,fulfilled_units:keepFul,
          item_status:keepFul>=keepTotal&&keepTotal>0?'items_received':keepFul>0?'partially_received':'need_to_order'};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        const updated={...o,jobs:newJobs2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSplitModal(null);nf('Custom split! '+splitId+' with '+splitTotal+' units');
      };
      const updJob=(jIdx,k,v)=>{sv('jobs',jobs.map((j,i)=>i===jIdx?{...j,[k]:v}:j))};
      const prodStatuses=['draft','hold','staging','in_process','completed'];
      const prodLabels={draft:'Draft',hold:'On Hold',staging:'In Line',in_process:'In Process',completed:'Completed'};
      const artLabels=ART_LABELS;
      const itemLabels={need_to_order:'Need to Order',needs_pull:'Waiting for Pull',partially_received:'Partially Received',items_received:'Items Received'};
      // Effective item status for display. Items that already have IF (item fulfillment)
      // picks waiting to be pulled are in-house, so show "Waiting for Pull" instead of the
      // misleading "Need to Order". Stored item_status is left untouched (warehouse pull /
      // PO receive flows own that); this only relabels what the rep sees.
      const jItemStatus=j=>{const total=j.total_units||0,ful=j.fulfilled_units||0;if(total>0&&ful>=total)return'items_received';const pendingPull=(j.items||[]).some(gi=>safePicks(safeItems(o)[gi.item_idx]).some(pk=>pk.status==='pick'));if(pendingPull)return'needs_pull';if(ful>0)return'partially_received';return'need_to_order';};

      // Job detail view
      if(selJob!=null){
        const ji=selJob;
        // Try the stored index first; fall back to id-based lookup if the
        // jobs array has reordered or refetched since selJob was set.
        let j=jobs[ji];
        if((!j||(selJobIdRef.current&&j.id!==selJobIdRef.current))&&selJobIdRef.current){
          const _fallback=jobs.find(x=>x.id===selJobIdRef.current);
          if(_fallback)j=_fallback;
        }
        if(!j)return<div className="card"><div className="card-body"><button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)}><Icon name="back" size={12}/> Back to Jobs</button><div style={{padding:20,color:'#94a3b8'}}>Job not found</div></div></div>;
        const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';
        const canOverride=cu.role==="admin"||cu.role==="production"||cu.role==="prod_manager"||cu.role==="gm";
        const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
        const artF=safeArt(o).find(a=>a.id===j.art_file_id);
        const allArtFiles=(j._art_ids||[j.art_file_id].filter(Boolean)).map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);
        // Get full size breakdowns per item — split jobs carry per-item sizes/fulSizes overrides.
        const itemDetails=(j.items||[]).map(gi=>{
          const it=safeItems(o)[gi.item_idx];if(!it)return{...gi,sizes:gi.sizes||{},fulSizes:gi.fulSizes||{}};
          const sizes=gi.sizes?{...gi.sizes}:Object.fromEntries(Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).map(([sz,v])=>[sz,safeNum(v)]));
          const fulSizes={};
          if(gi.fulSizes){Object.entries(gi.fulSizes).forEach(([sz,v])=>{fulSizes[sz]=safeNum(v)})}
          else Object.entries(sizes).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            fulSizes[sz]=Math.min(safeNum(v),pQ+rQ);
          });
          const prd=products.find(pp=>pp.id===it.product_id||pp.sku===it.sku);
          return{...gi,sizes,fulSizes,color:safeStr(it.color),brand:safeStr(it.brand),product_id:prd?.id||null,image_url:prd?.image_url||(prd?.images&&prd.images[0])||it._colorImage||_vImg(it,'front')||'',back_image_url:prd?.back_image_url||(prd?.images&&prd.images[1])||it._colorBackImage||_vImg(it,'back')||'',images:prd?.images||[]};
        });
        const allSizes=[...new Set(itemDetails.flatMap(gi=>Object.keys(gi.sizes||{})))];
        const sizeOrder=['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
        allSizes.sort((a,b)=>(sizeOrder.indexOf(a)===-1?99:sizeOrder.indexOf(a))-(sizeOrder.indexOf(b)===-1?99:sizeOrder.indexOf(b)));

        return<><div>
          <button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)} style={{marginBottom:12}}><Icon name="back" size={12}/> All Jobs</button>
          {/* Job header */}
          <div className="card" style={{marginBottom:12}}>
            <div style={{padding:'16px 20px',display:'flex',gap:16,alignItems:'flex-start'}}>
              <div style={{width:48,height:48,borderRadius:10,background:SC[j.prod_status]?.bg||'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🎨</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{j.id}</span>
                  {(()=>{const fSt=artF?(artF.status==='uploaded'?'needs_approval':artF.status||'waiting_for_art'):null;return fSt?<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:ART_FILE_SC[fSt]?.bg||'#f1f5f9',color:ART_FILE_SC[fSt]?.c||'#64748b'}}>{ART_FILE_LABELS[fSt]||fSt}</span>:null})()}
                  {(()=>{const _is=jItemStatus(j);return<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[_is]?.bg,color:SC[_is]?.c}}>{itemLabels[_is]}</span>})()}
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}}>{prodLabels[j.prod_status]}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,flexWrap:'wrap'}}>
                  {editingJobName===j.id?<input type="text" autoFocus className="form-input" defaultValue={j.art_name||''}
                    style={{fontSize:15,fontWeight:700,padding:'2px 8px',minWidth:240}}
                    onKeyDown={e=>{if(e.key==='Enter')e.target.blur();else if(e.key==='Escape'){setEditingJobName(null)}}}
                    onBlur={e=>{const v=e.target.value.trim();const updJobs=safeJobs(o).map(jj=>jj.id===j.id?{...jj,art_name:v||jj.art_name,_name_locked:true}:jj);setO(e2=>({...e2,jobs:updJobs,updated_at:new Date().toLocaleString()}));setDirty(true);setEditingJobName(null)}}/>
                  :<><span style={{fontSize:15,fontWeight:700}}>{j.art_name}</span>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px'}} onClick={()=>setEditingJobName(j.id)} title="Rename this job">✏️ Rename</button>
                    {(()=>{const _aids=((j._art_ids&&j._art_ids.length?j._art_ids:[j.art_file_id])||[]).filter(Boolean);const canEditMock=j.quick_mock||_aids.some(aid=>{const a=safeArt(o).find(x=>x.id===aid);return a&&a.item_mockups&&Object.values(a.item_mockups).some(arr=>(arr||[]).length>0)});return canEditMock?<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#7c3aed',color:'white',border:'none',fontWeight:700}} title="Edit this Quick Mock — updates the mockup the coach sees, status unchanged" onClick={()=>{(j.items||[]).forEach(gItem=>{const it=safeItems(o)[gItem.item_idx];if(it)fetchVendorImage(it.sku,it.color,it.vendor_id,it)});setEditMockJob(j)}}>✏️ Edit Mock</button>:null})()}
                    {j._name_locked&&<button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'2px 6px'}} onClick={()=>{const updJobs=safeJobs(o).map(jj=>jj.id===j.id?{...jj,_name_locked:false}:jj);setO(e2=>({...e2,jobs:updJobs,updated_at:new Date().toLocaleString()}));setDirty(true);nf('Job name will sync from artwork on next change')}} title="Stop overriding — name will follow the artwork again">🔓 Unlock</button>}
                    {j._name_locked&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'#ede9fe',color:'#6d28d9',fontWeight:700}}>Custom name</span>}
                  </>}
                </div>
                <div style={{fontSize:12,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                {(()=>{const jobItemIdxs=new Set((j.items||[]).map(it=>it.item_idx));
                  const siblings=safeJobs(o).filter(j2=>j2.id!==j.id&&(j2.items||[]).some(it=>jobItemIdxs.has(it.item_idx)));
                  if(siblings.length===0)return null;
                  return<div style={{fontSize:10,marginTop:3,padding:'3px 8px',background:'#fef3c7',borderRadius:4,border:'1px solid #fde68a',color:'#92400e'}}>
                    Multi-job item: {siblings.map(s=><span key={s.id} style={{fontWeight:700}}>{s.art_name||s.deco_type?.replace(/_/g,' ')} <span style={{padding:'1px 4px',borderRadius:3,fontSize:9,background:s.prod_status==='completed'||s.prod_status==='shipped'?'#dcfce7':'#fee2e2',color:s.prod_status==='completed'||s.prod_status==='shipped'?'#166534':'#dc2626'}}>{prodLabels[s.prod_status]||s.prod_status}</span></span>).reduce((acc,el,i)=>i===0?[el]:[...acc,<span key={'sep-'+i}> · </span>,el],[])}
                  </div>})()}
                {j.split_from&&<div style={{fontSize:11,color:'#7c3aed',marginTop:2}}>✂️ Split from {j.split_from}</div>}
                {j.deco_type==='embroidery'&&<div style={{marginTop:6,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <span style={{fontSize:11,fontWeight:700,color:'#6d28d9'}}>🧵 Names File:</span>
                  <input type="text" className="form-input" placeholder="Paste Google Drive link to digitized name files"
                    defaultValue={j.emb_names_link||''} style={{fontSize:11,padding:'2px 8px',flex:'0 1 360px',minWidth:240}}
                    onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}}
                    onBlur={e=>{const v=e.target.value.trim();if(v===(j.emb_names_link||''))return;const updJobs=safeJobs(o).map(jj=>jj.id===j.id?{...jj,emb_names_link:v}:jj);setO(e2=>({...e2,jobs:updJobs,updated_at:new Date().toLocaleString()}));setDirty(true);nf(v?'Names file link saved':'Names file link cleared')}}/>
                  {j.emb_names_link&&<a href={j.emb_names_link} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:11,fontWeight:700,color:'#2563eb',textDecoration:'underline'}}>↗ Open</a>}
                </div>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:24,fontWeight:800,color:pct>=100?'#166534':'#1e40af'}}>{j.fulfilled_units}/{j.total_units}</div>
                <div style={{width:80,background:'#e2e8f0',borderRadius:4,height:6,marginTop:4}}><div style={{height:6,borderRadius:4,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div>
                <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{pct}% fulfilled</div>
              </div>
            </div>
            {/* ── Art Status Banners ── */}
            {j.art_status==='art_requested'&&<div style={{margin:'0 20px',padding:'12px 16px',background:'linear-gradient(135deg,#fce7f3,#fdf2f8)',border:'2px solid #f9a8d4',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{fontSize:16}}>📨</span>
                <span style={{fontWeight:700,fontSize:14,color:'#9d174d'}}>Art Request Sent</span>
                {(()=>{const lastReq=(j.art_requests||[]).slice(-1)[0];return lastReq?<span style={{fontSize:11,color:'#be185d'}}>to {lastReq.artist_name||'artist'} on {new Date(lastReq.created_at).toLocaleDateString()}</span>:null})()}
              </div>
              <div style={{fontSize:12,color:'#831843'}}>Waiting for the artist to complete the mockup. You can request updates or send messages below.</div>
            </div>}
            {j.art_status==='art_in_progress'&&<div style={{margin:'0 20px',padding:'12px 16px',background:'linear-gradient(135deg,#dbeafe,#eff6ff)',border:'2px solid #93c5fd',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>🎨</span>
                <span style={{fontWeight:700,fontSize:14,color:'#1e40af'}}>Artist is Working on This</span>
                {j.assigned_artist&&<span style={{fontSize:11,color:'#2563eb'}}>({REPS.find(r=>r.id===j.assigned_artist)?.name||'Artist'})</span>}
              </div>
              <div style={{fontSize:12,color:'#1e3a8a',marginTop:4}}>The mockup will be sent to you for approval when ready.</div>
            </div>}
            {j.art_status==='waiting_approval'&&(()=>{const artFile2=safeArt(o).find(a=>a.id===j.art_file_id);const _jobArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));(j.items||[]).forEach(gi=>{const it=safeItems(o)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jobArtIds.add(d.art_file_id)})});const _jobArtFiles=[..._jobArtIds].map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);const _mf=_filterDisplayable(_jobArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[]));const _im=_filterDisplayable(_jobArtFiles.flatMap(af3=>Object.values(af3?.item_mockups||{}).flat()));const _seen=new Set();const mockups=[..._mf,..._im].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});const _stca=j.sent_to_coach_at?new Date(j.sent_to_coach_at):null;return<div style={{margin:'0 20px',padding:'16px',background:_stca?'linear-gradient(135deg,#dbeafe,#eff6ff)':'linear-gradient(135deg,#fef3c7,#fffbeb)',border:'2px solid '+(_stca?'#93c5fd':'#fbbf24'),borderRadius:10}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{fontSize:20}}>{_stca?'📤':'⚠️'}</span>
                <span style={{fontWeight:800,fontSize:16,color:_stca?'#1e40af':'#92400e'}}>{_stca?'Sent to Coach for Approval':'Artwork Needs Your Approval'}</span>
              </div>
              {_stca&&<div style={{fontSize:12,color:'#1e40af',marginBottom:8,fontWeight:600}}>
                Sent {_stca.toLocaleDateString('en-US',{weekday:'short'})} {_stca.toLocaleDateString()} @ {_stca.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}
                {j.coach_email_opened_at?<span style={{marginLeft:8,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#dbeafe',color:'#1e40af'}}>Viewed {new Date(j.coach_email_opened_at).toLocaleDateString()} @ {new Date(j.coach_email_opened_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}</span>
                :<span style={{marginLeft:8,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e'}}>Not yet viewed</span>}
                {j.follow_up_at&&<span style={{marginLeft:8,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:new Date(j.follow_up_at)<new Date()?'#fef2f2':'#fffbeb',color:new Date(j.follow_up_at)<new Date()?'#dc2626':'#92400e'}}>⏰ Follow-up {new Date(j.follow_up_at).toLocaleDateString()}{new Date(j.follow_up_at)<new Date()?' (overdue)':''}</span>}
              </div>}
              {(j.sent_history||[]).length>1&&<div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:'#475569',marginBottom:2}}>All Sends:</div>
                {(j.sent_history||[]).map((h,hi)=><div key={hi} style={{fontSize:10,color:'#64748b',marginBottom:1}}>
                  {new Date(h.sent_at).toLocaleDateString()} @ {new Date(h.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}
                  {' by '+(h.sent_by||'—')}
                  {h.methods&&<span style={{fontSize:9,padding:'0 4px',marginLeft:4,borderRadius:3,background:'#eff6ff',color:'#1e40af'}}>{h.methods.join(', ')}</span>}
                </div>)}
              </div>}
              {mockups.length===0&&_jobArtFiles.length===0&&<div style={{padding:12,background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:6,marginBottom:12,fontSize:12,color:'#9a3412'}}>No mockup files attached yet — check the Art Library tab for files.</div>}
              {/* Per-item: mockup + decoration spec + size grid + production files (mirrors Art Dashboard) */}
              {(()=>{
                const _colorMap2={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
                if(itemDetails.length===0)return null;
                return<div style={{marginBottom:12}}>
                  {itemDetails.map((gi,gii)=>{
                    const it=safeItems(o)[gi.item_idx];
                    // Art files referenced by THIS item's decorations, intersected with this job's art set.
                    const itemArtIds=it?[...new Set(safeDecos(it).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'&&_jobArtIds.has(d.art_file_id)).map(d=>d.art_file_id))]:[];
                    const _useIds=itemArtIds.length>0?itemArtIds:(j.art_file_id&&_jobArtIds.has(j.art_file_id)?[j.art_file_id]:[]);
                    const itemArtFiles=_useIds.map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);
                    // Mockups: per-item (scoped to this SKU), then general (only if no per-item mockups exist for this SKU)
                    const _seen=new Set();
                    const _mk=gi.sku+'|'+(gi.color||'');
                    const perSkuMocks=_filterDisplayable(itemArtFiles.flatMap(_af=>{const v=_af?.item_mockups?.[_mk];return v&&v.length>0?v:(_af?.item_mockups?.[gi.sku]||[])}));
                    const generalMocks=perSkuMocks.length===0?_filterDisplayable(itemArtFiles.flatMap(_af=>_af?.mockup_files||_af?.files||[])):[];
                    const itemMockups=[...perSkuMocks,...generalMocks].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});
                    const artDecos=it?safeDecos(it).filter(d=>d.kind==='art'&&(!d.art_file_id||d.art_file_id==='__tbd'||_jobArtIds.has(d.art_file_id))):[];
                    const numDecos=it?safeDecos(it).filter(d=>d.kind==='numbers'):[];
                    const nameDecos=it?safeDecos(it).filter(d=>d.kind==='names'):[];
                    const totalUnits=Object.values(gi.sizes||{}).reduce((a,v)=>a+safeNum(v),0);
                    const _itemPFs=itemArtFiles.flatMap(_af=>(_af?.prod_files||[]).map(f=>({...(typeof f==='string'?{url:f,name:f}:f),_afName:itemArtFiles.length>1?(_af?.name||''):''})));
                    return<div key={gii} style={{marginBottom:gii<itemDetails.length-1?14:0,border:'1px solid #fcd34d',borderRadius:10,overflow:'hidden',background:'white'}}>
                      {/* Item header */}
                      <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'#fffbeb',borderBottom:'1px solid #fde68a'}}>
                        <div style={{display:'flex',gap:4,flexShrink:0}}>
                          {gi.image_url&&<img src={gi.image_url} alt="Front" style={{width:44,height:44,objectFit:'contain',borderRadius:6,border:'1px solid #fde68a',background:'white'}}/>}
                          {gi.back_image_url&&<img src={gi.back_image_url} alt="Back" style={{width:44,height:44,objectFit:'contain',borderRadius:6,border:'1px solid #fde68a',background:'white'}}/>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                            <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'1px 6px',borderRadius:4,fontSize:11}}>{gi.sku}</span>
                            <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{gi.name}</span>
                            {gi.color&&<span style={{color:'#6d28d9',fontWeight:700,fontSize:12}}>— {gi.color}</span>}
                            {gi.brand&&<span style={{fontSize:10,padding:'1px 6px',background:'#f1f5f9',borderRadius:4,color:'#64748b',border:'1px solid #e2e8f0'}}>{gi.brand}</span>}
                          </div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:18,fontWeight:800,color:'#92400e'}}>{totalUnits}</div>
                          <div style={{fontSize:9,color:'#78350f',fontWeight:600,textTransform:'uppercase'}}>units</div>
                        </div>
                      </div>
                      {/* Mockup */}
                      {itemMockups.length>0?(()=>{const _ordered=[...itemMockups].sort((a,b)=>_mockOrd(a)-_mockOrd(b));const _ou=_ordered.map(f=>typeof f==='string'?f:(f?.url||''));return<div style={{padding:10}}>
                        <div style={{display:'grid',gridTemplateColumns:_ordered.length>1?'1fr 1fr':'1fr',gap:8}}>
                          {_ordered.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);const _sd=_mockSide(f);const _lbl=(typeof f!=='string'&&f?.art_label)||'';const _cap=[_lbl,_sd==='front'?'Front':_sd==='back'?'Back':''].filter(Boolean).join(' — ')||name;
                            return<div key={fi} style={{position:'relative',borderRadius:8,border:'2px solid #f59e0b',overflow:'hidden',background:'white'}}>
                              <button title="Remove this mockup" onClick={e=>{e.stopPropagation();if(window.confirm('Remove this mockup from the job?\n\n'+_cap))removeMockupUrl(url)}} style={{position:'absolute',top:6,right:6,zIndex:2,width:24,height:24,borderRadius:'50%',border:'none',background:'rgba(220,38,38,0.92)',color:'#fff',fontSize:14,lineHeight:'24px',cursor:'pointer',padding:0,boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}>×</button>
                              <div style={{cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}>
                              {_isImgUrl(url,f)?<img src={url} alt={name} style={{width:'100%',height:280,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                              :_isPdfUrl(url,f)?<div style={{position:'relative',height:280,display:'flex',alignItems:'center',justifyContent:'center',background:'#fafafa'}}>
                                {_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt={name} style={{width:'100%',height:280,objectFit:'contain',display:'block'}} onError={e=>{e.target.style.display='none';e.target.nextSibling&&(e.target.nextSibling.style.display='flex')}}/>:null}
                                <div style={{display:_cloudinaryPdfThumb(url)?'none':'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                  <span style={{fontSize:32}}>PDF</span><span style={{fontSize:12,color:'#1e40af'}}>{name}</span></div></div>
                              :<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,height:280,background:'#fafafa'}}>
                                <span style={{fontSize:20}}>📄</span><span style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>{name}</span></div>}
                              </div>
                              <div style={{padding:'4px 10px',borderTop:'1px solid #fde68a',fontSize:11,color:'#92400e',fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center',gap:6}}>
                                <span style={{display:'flex',alignItems:'center',gap:4,minWidth:0}}>
                                  {_ordered.length>1&&<>
                                    <button title="Move earlier" disabled={fi===0} onClick={e=>{e.stopPropagation();moveMock(_ou,fi,-1)}} style={{border:'1px solid #fcd34d',background:'#fffbeb',borderRadius:4,fontSize:11,lineHeight:1,padding:'2px 5px',cursor:fi===0?'default':'pointer',opacity:fi===0?0.4:1}}>◀</button>
                                    <button title="Move later" disabled={fi===_ordered.length-1} onClick={e=>{e.stopPropagation();moveMock(_ou,fi,1)}} style={{border:'1px solid #fcd34d',background:'#fffbeb',borderRadius:4,fontSize:11,lineHeight:1,padding:'2px 5px',cursor:fi===_ordered.length-1?'default':'pointer',opacity:fi===_ordered.length-1?0.4:1}}>▶</button>
                                  </>}
                                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{_cap}</span>
                                </span>
                                <span style={{color:'#2563eb',cursor:'pointer',flexShrink:0}} onClick={()=>setMockupLightbox(url)}>Click to enlarge</span>
                              </div>
                            </div>})}
                        </div>
                      </div>})():<div style={{padding:14,margin:10,textAlign:'center',background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:6,color:'#9a3412',fontSize:12,fontWeight:600}}>No mockup uploaded yet for {gi.sku}</div>}
                      {/* Decoration spec */}
                      {(artDecos.length>0||numDecos.length>0||nameDecos.length>0)&&<div style={{padding:'10px 14px',borderTop:'1px solid #fde68a',background:'#f8fafc'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#1e3a5f',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>Decoration Spec</div>
                        {artDecos.map((d,di)=>{
                          const dAf=d.art_file_id?safeArt(o).find(a=>a.id===d.art_file_id):null;
                          const cwObj=d.color_way_id&&dAf?.color_ways?dAf.color_ways.find(c=>c.id===d.color_way_id):null;
                          const _gk2=gi.sku+'|'+(gi.color||'');
                          const _gc2=dAf?.garment_colors?.[_gk2]||{};
                          const _gcCols=Object.values(_gc2).flat().filter(c=>c&&c.trim());
                          const _cwCols=cwObj?cwObj.inks.filter(c=>c&&c.trim()):[];
                          const _fbCols=(dAf?(dAf.ink_colors||dAf.thread_colors||''):'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
                          const _allCwInks=[...new Set((dAf?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
                          const dColors=_gcCols.length>0?_gcCols:_cwCols.length>0?_cwCols:_fbCols.length>0?_fbCols:_allCwInks;
                          const cwLabel=cwObj?.garment_color||'';
                          const method=(d.type||dAf?.deco_type||j.deco_type||'screen_print').replace(/_/g,' ');
                          const size=(dAf?.art_sizes?.[d.position])||dAf?.art_size||'';
                          return<div key={di} style={{display:'flex',alignItems:'flex-start',gap:8,flexWrap:'wrap',padding:'5px 0',borderTop:di>0?'1px solid #e2e8f0':'none'}}>
                            <div style={{minWidth:120}}>
                              <div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{d.position||'—'}</div>
                              {dAf&&<div style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'1px 6px',borderRadius:3,display:'inline-block',marginTop:2}}>{dAf.title||dAf.name||'—'}</div>}
                              {cwLabel&&<div style={{fontSize:10,fontWeight:600,color:'#0369a1',background:'#e0f2fe',padding:'1px 6px',borderRadius:3,display:'inline-block',marginTop:2}}>CW: {cwLabel}</div>}
                            </div>
                            <div style={{flex:1,display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
                              <span style={{fontSize:11,color:'#475569',fontWeight:600}}>{method}</span>
                              {d.underbase&&<span style={{fontSize:10,fontWeight:700,color:'#92400e',background:'#fef3c7',padding:'1px 6px',borderRadius:3,border:'1px solid #fbbf24'}}>Underbase</span>}
                              {d.reversible&&<span style={{fontSize:10,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'1px 6px',borderRadius:3,border:'1px solid #86efac'}}>Reversible</span>}
                              <span style={{fontSize:11,color:'#64748b',fontWeight:600}}>{size||'—'}</span>
                              {dColors.length>0&&<><span style={{fontSize:11,color:'#94a3b8'}}>—</span>
                                <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                  {dColors.map((cl,ci)=>{const sw=_colorMap2[cl]||Object.entries(_colorMap2).find(([k])=>cl.toLowerCase().includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                                    return<span key={ci} style={{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 7px',background:'white',border:'1px solid '+(sw||'#d1d5db'),borderRadius:4,fontSize:11,fontWeight:700}}>
                                      <span style={{width:11,height:11,borderRadius:2,background:sw||'#e2e8f0',border:'1px solid #d1d5db',flexShrink:0}}/>{cl}</span>})}
                                </div></>}
                            </div>
                          </div>})}
                        {numDecos.map((nd,ni)=><div key={'n'+ni} style={{padding:'5px 0',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'1px 7px',borderRadius:3}}>Numbers{nd.front_and_back?' — Front + Back':''}</span>
                          <span style={{fontSize:11,color:'#1e293b'}}>{(nd.num_method||'heat_transfer').replace(/_/g,' ')} · Size {nd.num_size||'—'}{nd.num_font?' · '+nd.num_font:''}{nd.print_color?' · '+nd.print_color:''}</span>
                        </div>)}
                        {nameDecos.map((nd,ni)=><div key={'nm'+ni} style={{padding:'5px 0',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#92400e',background:'#fef3c7',padding:'1px 7px',borderRadius:3}}>Names{nd.front_and_back?' — Front + Back':''}</span>
                        </div>)}
                      </div>}
                      {/* Size grid */}
                      {totalUnits>0&&<div style={{padding:'8px 14px',borderTop:'1px solid #fde68a'}}>
                        <div style={{overflowX:'auto'}}><table style={{fontSize:11,minWidth:240,width:'100%'}}><thead><tr style={{background:'#f0f2f5'}}>
                          <th style={{textAlign:'left',padding:'3px 6px',fontSize:9,fontWeight:700}}>SIZE</th>
                          {allSizes.map(sz=><th key={sz} style={{textAlign:'center',padding:'3px 6px',fontSize:9,fontWeight:700,minWidth:28}}>{sz}</th>)}
                          <th style={{textAlign:'center',padding:'3px 6px',fontSize:9,fontWeight:800}}>TOTAL</th>
                        </tr></thead><tbody>
                          <tr>
                            <td style={{textAlign:'left',padding:'3px 6px',fontWeight:700,color:'#475569'}}>QTY</td>
                            {allSizes.map(sz=>{const v=safeNum(gi.sizes?.[sz]);return<td key={sz} style={{textAlign:'center',padding:'3px 6px',fontWeight:v>0?800:400,color:v>0?'#1e40af':'#cbd5e1',background:v>0?'#eef2ff':''}}>{v>0?v:'—'}</td>})}
                            <td style={{textAlign:'center',padding:'3px 6px',fontWeight:800,color:'#1e40af',background:'#f0f2f5'}}>{totalUnits}</td>
                          </tr>
                        </tbody></table></div>
                      </div>}
                      {/* Production files (when present) */}
                      {_itemPFs.length>0&&<div style={{padding:'8px 14px',borderTop:'1px solid #fde68a'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#92400e',marginBottom:4}}>Production Files ({_itemPFs.length})</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{_itemPFs.map((f,fi)=>{const url=f?.url||'';const name=f?.name||fileDisplayName(f);return<div key={fi} style={{padding:'4px 8px',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:4,cursor:'pointer',fontSize:10,fontWeight:600,color:'#92400e',display:'flex',alignItems:'center',gap:3}} onClick={()=>openFile(url)}>📁 {name}{f._afName&&<span style={{fontSize:9,fontStyle:'italic',marginLeft:2}}>({f._afName})</span>}</div>;})}
                        </div>
                        {(()=>{const _job2Items=(j.items||[]);
                          const _rosters=_job2Items.map(_gi=>{const _it=safeItems(o)[_gi.item_idx];const _nd=_it?safeDecos(_it).find(d=>d.kind==='numbers'):null;return _gi.roster||_nd?.roster||null}).filter(r=>r&&Object.keys(r).length>0);
                          if(_rosters.length===0)return null;
                          const _agg={};_rosters.forEach(r=>{Object.entries(r).forEach(([sz,arr])=>{(arr||[]).forEach(v=>{if(v&&String(v).trim()){if(!_agg[sz])_agg[sz]=[];_agg[sz].push(String(v))}})})});
                          const _szOrd=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT'];
                          const _szRows=Object.entries(_agg).sort((a,b)=>(_szOrd.indexOf(a[0])<0?99:_szOrd.indexOf(a[0]))-(_szOrd.indexOf(b[0])<0?99:_szOrd.indexOf(b[0])));
                          if(_szRows.length===0)return null;
                          return<div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #bbf7d0'}}>
                            {_szRows.map(([sz,nums])=><div key={sz} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                              <div style={{fontSize:10,fontWeight:700,color:'#64748b',minWidth:56,flexShrink:0}}>{sz} ({nums.length})</div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                                {nums.slice().sort((a,b)=>Number(a)-Number(b)).map((n,ni)=>
                                  <span key={ni} style={{display:'inline-block',minWidth:30,textAlign:'center',padding:'2px 6px',background:'white',border:'1px solid #bbf7d0',borderRadius:4,fontSize:11,fontWeight:700,color:'#166534'}}>{n}</span>)}
                              </div>
                            </div>)}
                          </div>})()}
                      </div>}
                    </div>;
                  })}
                </div>;
              })()}
              {/* Artist notes / messages */}
              {(()=>{const artMsgs=(j.art_messages||[]).filter(m=>!m.is_system);const artFileNotes=artFile2?.notes;
                return(artMsgs.length>0||artFileNotes)?<div style={{marginBottom:12,padding:'10px 14px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:6}}>🎨 Artist Notes</div>
                  {artFileNotes&&<div style={{fontSize:12,color:'#1e293b',marginBottom:6,padding:'6px 10px',background:'white',borderRadius:6,border:'1px solid #e0f2fe'}}>{artFileNotes}</div>}
                  {artMsgs.map((m,mi)=><div key={mi} style={{fontSize:12,color:'#1e293b',marginBottom:4,padding:'6px 10px',background:'white',borderRadius:6,border:'1px solid #e0f2fe'}}>
                    <span style={{fontWeight:600,color:'#0369a1'}}>{m.from_name}:</span> {m.text}
                    <span style={{fontSize:10,color:'#94a3b8',marginLeft:6}}>{new Date(m.ts).toLocaleDateString()}</span>
                  </div>)}
                </div>:null})()}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                <button className="btn" style={{fontSize:13,padding:'8px 20px',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'white',border:'none',borderRadius:8,fontWeight:800,boxShadow:'0 2px 8px rgba(34,197,94,0.3)'}} onClick={()=>{const _apDeco=(af.find(a=>a.id===j.art_file_id)?.deco_type)||j.deco_type;const _apSt=prodFilesStatusFor(_apDeco);const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:_apSt,art_requests:(jj.art_requests||[]).map(r=>r.status==='requested'||r.status==='in_progress'?{...r,status:'completed'}:r)}:jj);const updArt2=j.art_file_id?af.map(a=>a.id===j.art_file_id?{...a,status:'approved'}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setArtRevisionNote('');nf('✅ Art approved — '+(_apSt==='order_dtf_transfers'?'order DTF transfers':_apSt==='upload_emb_files'?'upload embroidery files':'awaiting prod files'))}}>✅ Approve Artwork</button>
                <button className="btn" style={{fontSize:13,padding:'8px 20px',background:'linear-gradient(135deg,#3b82f6,#2563eb)',color:'white',border:'none',borderRadius:8,fontWeight:800,boxShadow:'0 2px 8px rgba(59,130,246,0.3)'}} onClick={()=>{const c2=ic||allCustomers?.find?.(x=>x.id===o.customer_id);const contacts=(c2?.contacts||[]).filter(ct2=>ct2.email||ct2.phone);const ct=contacts[0]||{};const pUrl=c2?.alpha_tag?(window.location.origin+'/?portal='+c2.alpha_tag):'';const _label=(o.memo&&o.memo.trim())||j.art_name;const defMsg='Hi '+(ct.name||'Coach')+',\n\nYour artwork mockup for "'+_label+'" is ready for review!\n\nPlease review and approve it through your portal:\n'+(pUrl||'(portal link unavailable)')+'\n\nLet us know if you\'d like any changes.\n\n'+cu.name+'\nNational Sports Apparel';setCoachApprovalModal({jIdx:ji,contacts,contact:ct,portalUrl:pUrl,sendEmail:!!ct.email,sendText:_smsUiEnabled&&!!ct.phone,checkedEmails:Object.fromEntries((c2?.contacts||[]).filter(ct2=>ct2.email).map(ct2=>[ct2.email,true])),customEmails:[],addingEmail:'',message:defMsg,sending:false,followUpDays:portalSettings?.followUpDays||7})}}>📤 Send to Coach</button>
              </div>
              <div style={{borderTop:'1px solid #fde68a',paddingTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:'#92400e',marginBottom:4}}>Something wrong? Send it back to the artist:</div>
                <textarea className="form-input" rows={2} placeholder="Describe what needs to change — colors, sizing, placement, etc." value={artRevisionNote} onChange={e=>setArtRevisionNote(e.target.value)} style={{fontSize:12,resize:'vertical',marginBottom:6,borderColor:'#fbbf24'}}/>
                <button className="btn btn-sm" style={{fontSize:12,padding:'5px 14px',background:artRevisionNote.trim()?'linear-gradient(135deg,#dc2626,#b91c1c)':'#e5e7eb',color:artRevisionNote.trim()?'white':'#9ca3af',border:'none',borderRadius:6,fontWeight:700,cursor:artRevisionNote.trim()?'pointer':'not-allowed'}} disabled={!artRevisionNote.trim()} onClick={()=>{
                  const rejection={by:cu.name,at:new Date().toISOString(),reason:artRevisionNote.trim()};
                  const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'art_in_progress',rejections:[...(jj.rejections||[]),rejection]}:jj);
                  const updArt2=af.map(a=>a.id===j.art_file_id?{...a,status:'waiting_for_art'}:a);
                  const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setDirty(false);setArtRevisionNote('');
                  nf('Art sent back to artist for revision');
                }}>🔄 Request Update</button>
              </div>
            </div>})()}
            {PROD_FILES_STATUSES.includes(j.art_status)&&(()=>{const _pIds=(j._art_ids||[j.art_file_id].filter(Boolean)).filter(id=>id&&id!=='__tbd');const _pDeco=(af.find(a=>_pIds.includes(a.id))?.deco_type)||j.deco_type;const _pEmb=_pDeco==='embroidery';const _pDtf=_pDeco==='dtf';const _pTarget=_pIds[0];const _pPFCount=_pIds.reduce((n,aid)=>{const a=af.find(x=>x.id===aid);return n+((a?.prod_files||[]).length)},0);const _pDst=_pIds.some(aid=>{const a=af.find(x=>x.id===aid);return a&&[...(a.prod_files||[]),...(a.files||[])].some(isDstFile)});const _pTitle=_pEmb?(_pDst?'Art Approved — DST On File':'Art Approved — Upload Embroidery Production Files'):_pDtf?'Art Approved — Order DTF Transfers':'Art Approved — Waiting for Production Files';const _pMsg=_pEmb?(_pDst?'The coach approved this art and a DST is already attached — production files are ready. Mark complete to send it to production.':'The coach approved this art. Upload the DST + PDF for the printer, then mark it complete. Already sent them? Just mark complete.'):_pDtf?'The coach approved this art. Order the DTF transfer films, then click Films Ordered to complete this job.':'The artist needs to upload final production files before this job can go to production.';
              const _completeEmb=()=>{const _by=cu?.name||'Rep';const updArt2=af.map(a=>{if(!_pIds.includes(a.id))return a;return(a.prod_files||[]).length>0?{...a,status:'approved'}:{...a,status:'approved',prod_files:[{name:'Embroidery files sent to printer',emb_sent:true,at:new Date().toISOString(),by:_by}]}});const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'art_complete'}:jj);const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('🧵 Embroidery production files marked complete')};
              const _orderDtf=()=>{const marker={name:'DTF films ordered',dtf_order:true,at:new Date().toISOString(),by:cu?.name||'Rep'};const updArt2=af.map(a=>_pIds.includes(a.id)?{...a,status:'approved',prod_files:[...(a.prod_files||[]),marker]}:a);const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'art_complete'}:jj);const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('🎞️ DTF films marked ordered — art complete')};
              const _completeProd=()=>{const updArt2=af.map(a=>_pIds.includes(a.id)?{...a,status:'approved'}:a);const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'art_complete'}:jj);const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('✅ Art complete — production files attached')};
              const _uploadEmb=()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.dst,.pdf,.png,.jpg,.jpeg,.ai,.eps';inp.multiple=true;inp.onchange=async()=>{for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');setO(e=>({...e,art_files:(e.art_files||[]).map(fa=>fa.id===_pTarget?{...fa,prod_files:[...(fa.prod_files||[]),{url,name:f.name}]}:fa),updated_at:new Date().toLocaleString()}));setDirty(true);nf('📎 '+f.name+' attached — click Save to keep')}catch(err){nf('Upload failed: '+err.message,'error')}}};inp.click()};
              return<div style={{margin:'0 20px',padding:'12px 16px',background:'linear-gradient(135deg,#fef9c3,#fefce8)',border:'2px solid #fde047',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>✅</span>
                <span style={{fontWeight:700,fontSize:14,color:'#854d0e'}}>{_pTitle}</span>
                {(_pEmb||_pDtf)&&<span style={{fontSize:10,fontWeight:700,color:'#854d0e',background:'#fde68a',padding:'1px 8px',borderRadius:10,marginLeft:'auto'}}>Your to-do</span>}
              </div>
              <div style={{fontSize:12,color:'#713f12',marginTop:4}}>{_pMsg}</div>
              {_pPFCount>0&&<div style={{fontSize:11,color:'#15803d',fontWeight:700,marginTop:6}}>🏭 {_pPFCount} production file{_pPFCount!==1?'s':''} attached</div>}
              {_pDst&&_pPFCount===0&&<div style={{fontSize:11,color:'#15803d',fontWeight:700,marginTop:6}}>🧵 DST detected on the art file — production files ready</div>}
              {_pEmb&&<div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                <button className="btn btn-sm" style={{fontSize:12,fontWeight:700,background:'#7c3aed',color:'white',border:'none',padding:'6px 14px',borderRadius:6}} onClick={_uploadEmb}>📎 Upload DST + PDF</button>
                <button className="btn btn-sm" style={{fontSize:12,fontWeight:700,background:'#166534',color:'white',border:'none',padding:'6px 14px',borderRadius:6}} onClick={_completeEmb}>✓ {(_pPFCount>0||_pDst)?'Mark Art Complete':'Files Sent — Mark Complete'}</button>
              </div>}
              {_pDtf&&<div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                <button className="btn btn-sm" style={{fontSize:12,fontWeight:700,background:'#0891b2',color:'white',border:'none',padding:'6px 14px',borderRadius:6}} onClick={_orderDtf}>🎞️ Films Ordered — Mark Complete</button>
              </div>}
              {!_pEmb&&!_pDtf&&(_pPFCount>0||_pDst)&&<div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                <button className="btn btn-sm" style={{fontSize:12,fontWeight:700,background:'#166534',color:'white',border:'none',padding:'6px 14px',borderRadius:6}} onClick={_completeProd}>✓ Production Files Attached — Mark Art Complete</button>
              </div>}
            </div>;})()}
            {j.art_status==='art_complete'&&<div style={{margin:'0 20px',padding:'10px 16px',background:'linear-gradient(135deg,#dcfce7,#f0fdf4)',border:'2px solid #86efac',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>🎉</span>
                <span style={{fontWeight:700,fontSize:14,color:'#166534'}}>Art Complete — Ready for Production</span>
              </div>
            </div>}
            {(j.art_status==='art_complete'||PROD_FILES_STATUSES.includes(j.art_status))&&(()=>{
                // Per-item layout: mockup + decoration spec + size grid + production files (mirrors Art Dashboard).
                const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
                (j.items||[]).forEach(_gi=>{const _it=safeItems(o)[_gi.item_idx];if(!_it)return;safeDecos(_it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});
                const _colorMap3={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
                if(itemDetails.length===0)return null;
                return<div style={{margin:'8px 20px'}}>
                  {itemDetails.map((gi,gii)=>{
                    const it=safeItems(o)[gi.item_idx];
                    const itemArtIds=it?[...new Set(safeDecos(it).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'&&_jArtIds.has(d.art_file_id)).map(d=>d.art_file_id))]:[];
                    const _useIds=itemArtIds.length>0?itemArtIds:(j.art_file_id&&_jArtIds.has(j.art_file_id)?[j.art_file_id]:[]);
                    const itemArtFiles=_useIds.map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);
                    const _seen=new Set();
                    const _mk=gi.sku+'|'+(gi.color||'');
                    const perSkuMocks=_filterDisplayable(itemArtFiles.flatMap(_af=>{const v=_af?.item_mockups?.[_mk];return v&&v.length>0?v:(_af?.item_mockups?.[gi.sku]||[])}));
                    const generalMocks=perSkuMocks.length===0?_filterDisplayable(itemArtFiles.flatMap(_af=>_af?.mockup_files||_af?.files||[])):[];
                    const itemMockups=[...perSkuMocks,...generalMocks].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});
                    const artDecos=it?safeDecos(it).filter(d=>d.kind==='art'&&(!d.art_file_id||d.art_file_id==='__tbd'||_jArtIds.has(d.art_file_id))):[];
                    const numDecos=it?safeDecos(it).filter(d=>d.kind==='numbers'):[];
                    const nameDecos=it?safeDecos(it).filter(d=>d.kind==='names'):[];
                    const totalUnits=Object.values(gi.sizes||{}).reduce((a,v)=>a+safeNum(v),0);
                    const _itemPFs=itemArtFiles.flatMap(_af=>(_af?.prod_files||[]).map(f=>({...(typeof f==='string'?{url:f,name:f}:f),_afName:itemArtFiles.length>1?(_af?.name||''):''})));
                    return<div key={gii} style={{marginBottom:gii<itemDetails.length-1?14:0,border:'1px solid #86efac',borderRadius:10,overflow:'hidden',background:'white'}}>
                      {/* Item header */}
                      <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'#f0fdf4',borderBottom:'1px solid #bbf7d0'}}>
                        <div style={{display:'flex',gap:4,flexShrink:0}}>
                          {gi.image_url&&<img src={gi.image_url} alt="Front" style={{width:44,height:44,objectFit:'contain',borderRadius:6,border:'1px solid #bbf7d0',background:'white'}}/>}
                          {gi.back_image_url&&<img src={gi.back_image_url} alt="Back" style={{width:44,height:44,objectFit:'contain',borderRadius:6,border:'1px solid #bbf7d0',background:'white'}}/>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                            <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'1px 6px',borderRadius:4,fontSize:11}}>{gi.sku}</span>
                            <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{gi.name}</span>
                            {gi.color&&<span style={{color:'#6d28d9',fontWeight:700,fontSize:12}}>— {gi.color}</span>}
                            {gi.brand&&<span style={{fontSize:10,padding:'1px 6px',background:'#f1f5f9',borderRadius:4,color:'#64748b',border:'1px solid #e2e8f0'}}>{gi.brand}</span>}
                          </div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:18,fontWeight:800,color:'#166534'}}>{totalUnits}</div>
                          <div style={{fontSize:9,color:'#15803d',fontWeight:600,textTransform:'uppercase'}}>units</div>
                        </div>
                      </div>
                      {/* Mockup */}
                      {itemMockups.length>0?(()=>{const _ordered=[...itemMockups].sort((a,b)=>_mockOrd(a)-_mockOrd(b));const _ou=_ordered.map(f=>typeof f==='string'?f:(f?.url||''));return<div style={{padding:10}}>
                        <div style={{display:'grid',gridTemplateColumns:_ordered.length>1?'1fr 1fr':'1fr',gap:8}}>
                          {_ordered.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);const _sd=_mockSide(f);const _lbl=(typeof f!=='string'&&f?.art_label)||'';const _cap=[_lbl,_sd==='front'?'Front':_sd==='back'?'Back':''].filter(Boolean).join(' — ')||name;
                            return<div key={fi} style={{position:'relative',borderRadius:8,border:'2px solid #86efac',overflow:'hidden',background:'white'}}>
                              <button title="Remove this mockup" onClick={e=>{e.stopPropagation();if(window.confirm('Remove this mockup from the job?\n\n'+_cap))removeMockupUrl(url)}} style={{position:'absolute',top:6,right:6,zIndex:2,width:24,height:24,borderRadius:'50%',border:'none',background:'rgba(220,38,38,0.92)',color:'#fff',fontSize:14,lineHeight:'24px',cursor:'pointer',padding:0,boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}>×</button>
                              <div style={{cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}>
                              {_isImgUrl(url,f)?<img src={url} alt={name} style={{width:'100%',height:280,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                              :_isPdfUrl(url,f)?<div style={{position:'relative',height:280,display:'flex',alignItems:'center',justifyContent:'center',background:'#fafafa'}}>
                                {_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt={name} style={{width:'100%',height:280,objectFit:'contain',display:'block'}} onError={e=>{e.target.style.display='none';e.target.nextSibling&&(e.target.nextSibling.style.display='flex')}}/>:null}
                                <div style={{display:_cloudinaryPdfThumb(url)?'none':'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                  <span style={{fontSize:32}}>PDF</span><span style={{fontSize:12,color:'#1e40af'}}>{name}</span></div></div>
                              :<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,height:280,background:'#fafafa'}}>
                                <span style={{fontSize:20}}>📄</span><span style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>{name}</span></div>}
                              </div>
                              <div style={{padding:'4px 10px',borderTop:'1px solid #bbf7d0',fontSize:11,color:'#166534',fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center',gap:6}}>
                                <span style={{display:'flex',alignItems:'center',gap:4,minWidth:0}}>
                                  {_ordered.length>1&&<>
                                    <button title="Move earlier" disabled={fi===0} onClick={e=>{e.stopPropagation();moveMock(_ou,fi,-1)}} style={{border:'1px solid #bbf7d0',background:'#f0fdf4',borderRadius:4,fontSize:11,lineHeight:1,padding:'2px 5px',cursor:fi===0?'default':'pointer',opacity:fi===0?0.4:1}}>◀</button>
                                    <button title="Move later" disabled={fi===_ordered.length-1} onClick={e=>{e.stopPropagation();moveMock(_ou,fi,1)}} style={{border:'1px solid #bbf7d0',background:'#f0fdf4',borderRadius:4,fontSize:11,lineHeight:1,padding:'2px 5px',cursor:fi===_ordered.length-1?'default':'pointer',opacity:fi===_ordered.length-1?0.4:1}}>▶</button>
                                  </>}
                                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{_cap}</span>
                                </span>
                                <span style={{color:'#2563eb',cursor:'pointer',flexShrink:0}} onClick={()=>setMockupLightbox(url)}>Click to enlarge</span>
                              </div>
                            </div>})}
                        </div>
                      </div>})():<div style={{padding:14,margin:10,textAlign:'center',background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:6,color:'#9a3412',fontSize:12,fontWeight:600}}>No mockup uploaded yet for {gi.sku}</div>}
                      {/* Decoration spec */}
                      {(artDecos.length>0||numDecos.length>0||nameDecos.length>0)&&<div style={{padding:'10px 14px',borderTop:'1px solid #bbf7d0',background:'#f8fafc'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#1e3a5f',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>Decoration Spec</div>
                        {artDecos.map((d,di)=>{
                          const dAf=d.art_file_id?safeArt(o).find(a=>a.id===d.art_file_id):null;
                          const cwObj=d.color_way_id&&dAf?.color_ways?dAf.color_ways.find(c=>c.id===d.color_way_id):null;
                          const _gk2=gi.sku+'|'+(gi.color||'');
                          const _gc2=dAf?.garment_colors?.[_gk2]||{};
                          const _gcCols=Object.values(_gc2).flat().filter(c=>c&&c.trim());
                          const _cwCols=cwObj?cwObj.inks.filter(c=>c&&c.trim()):[];
                          const _fbCols=(dAf?(dAf.ink_colors||dAf.thread_colors||''):'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
                          const _allCwInks=[...new Set((dAf?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
                          const dColors=_gcCols.length>0?_gcCols:_cwCols.length>0?_cwCols:_fbCols.length>0?_fbCols:_allCwInks;
                          const cwLabel=cwObj?.garment_color||'';
                          const method=(d.type||dAf?.deco_type||j.deco_type||'screen_print').replace(/_/g,' ');
                          const size=(dAf?.art_sizes?.[d.position])||dAf?.art_size||'';
                          return<div key={di} style={{display:'flex',alignItems:'flex-start',gap:8,flexWrap:'wrap',padding:'5px 0',borderTop:di>0?'1px solid #e2e8f0':'none'}}>
                            <div style={{minWidth:120}}>
                              <div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{d.position||'—'}</div>
                              {dAf&&<div style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'1px 6px',borderRadius:3,display:'inline-block',marginTop:2}}>{dAf.title||dAf.name||'—'}</div>}
                              {cwLabel&&<div style={{fontSize:10,fontWeight:600,color:'#0369a1',background:'#e0f2fe',padding:'1px 6px',borderRadius:3,display:'inline-block',marginTop:2}}>CW: {cwLabel}</div>}
                            </div>
                            <div style={{flex:1,display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
                              <span style={{fontSize:11,color:'#475569',fontWeight:600}}>{method}</span>
                              {d.underbase&&<span style={{fontSize:10,fontWeight:700,color:'#92400e',background:'#fef3c7',padding:'1px 6px',borderRadius:3,border:'1px solid #fbbf24'}}>Underbase</span>}
                              {d.reversible&&<span style={{fontSize:10,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'1px 6px',borderRadius:3,border:'1px solid #86efac'}}>Reversible</span>}
                              <span style={{fontSize:11,color:'#64748b',fontWeight:600}}>{size||'—'}</span>
                              {dColors.length>0&&<><span style={{fontSize:11,color:'#94a3b8'}}>—</span>
                                <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                  {dColors.map((cl,ci)=>{const sw=_colorMap3[cl]||Object.entries(_colorMap3).find(([k])=>cl.toLowerCase().includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                                    return<span key={ci} style={{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 7px',background:'white',border:'1px solid '+(sw||'#d1d5db'),borderRadius:4,fontSize:11,fontWeight:700}}>
                                      <span style={{width:11,height:11,borderRadius:2,background:sw||'#e2e8f0',border:'1px solid #d1d5db',flexShrink:0}}/>{cl}</span>})}
                                </div></>}
                            </div>
                          </div>})}
                        {numDecos.map((nd,ni)=>{
                          // Prefer this job item's roster slice (set by splitCustom) so split jobs only show their own numbers.
                          const _itRoster=gi.roster||nd.roster||null;
                          const _szOrd=['XS','S','M','L','XL','2XL','3XL','4XL','LT','XLT','2XLT','3XLT'];
                          const _rosterRows=_itRoster?Object.entries(_itRoster).map(([sz,arr])=>[sz,(arr||[]).filter(v=>v&&String(v).trim())]).filter(([,nums])=>nums.length>0).sort((a,b)=>(_szOrd.indexOf(a[0])<0?99:_szOrd.indexOf(a[0]))-(_szOrd.indexOf(b[0])<0?99:_szOrd.indexOf(b[0]))):[];
                          return<div key={'n'+ni} style={{padding:'5px 0',borderTop:'1px solid #e2e8f0'}}>
                            <div style={{display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                              <span style={{fontSize:11,fontWeight:700,color:'#166534',background:'#dcfce7',padding:'1px 7px',borderRadius:3}}>Numbers{nd.front_and_back?' — Front + Back':''}</span>
                              <span style={{fontSize:11,color:'#1e293b'}}>{(nd.num_method||'heat_transfer').replace(/_/g,' ')} · Size {nd.num_size||'—'}{nd.num_font?' · '+nd.num_font:''}{nd.print_color?' · '+nd.print_color:''}</span>
                            </div>
                            {_rosterRows.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:'1px dashed #bbf7d0'}}>
                              {_rosterRows.map(([sz,nums])=><div key={sz} style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                                <div style={{fontSize:10,fontWeight:700,color:'#64748b',minWidth:56,flexShrink:0}}>{sz} ({nums.length})</div>
                                <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                                  {nums.slice().sort((a,b)=>Number(a)-Number(b)).map((n,nii)=>
                                    <span key={nii} style={{display:'inline-block',minWidth:28,textAlign:'center',padding:'1px 6px',background:'white',border:'1px solid #bbf7d0',borderRadius:4,fontSize:11,fontWeight:700,color:'#166534'}}>{n}</span>)}
                                </div>
                              </div>)}
                            </div>}
                          </div>})}
                        {nameDecos.map((nd,ni)=><div key={'nm'+ni} style={{padding:'5px 0',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#92400e',background:'#fef3c7',padding:'1px 7px',borderRadius:3}}>Names{nd.front_and_back?' — Front + Back':''}</span>
                        </div>)}
                      </div>}
                      {/* Size grid */}
                      {totalUnits>0&&<div style={{padding:'8px 14px',borderTop:'1px solid #bbf7d0'}}>
                        <div style={{overflowX:'auto'}}><table style={{fontSize:11,minWidth:240,width:'100%'}}><thead><tr style={{background:'#f0f2f5'}}>
                          <th style={{textAlign:'left',padding:'3px 6px',fontSize:9,fontWeight:700}}>SIZE</th>
                          {allSizes.map(sz=><th key={sz} style={{textAlign:'center',padding:'3px 6px',fontSize:9,fontWeight:700,minWidth:28}}>{sz}</th>)}
                          <th style={{textAlign:'center',padding:'3px 6px',fontSize:9,fontWeight:800}}>TOTAL</th>
                        </tr></thead><tbody>
                          <tr>
                            <td style={{textAlign:'left',padding:'3px 6px',fontWeight:700,color:'#475569'}}>QTY</td>
                            {allSizes.map(sz=>{const v=safeNum(gi.sizes?.[sz]);return<td key={sz} style={{textAlign:'center',padding:'3px 6px',fontWeight:v>0?800:400,color:v>0?'#1e40af':'#cbd5e1',background:v>0?'#eef2ff':''}}>{v>0?v:'—'}</td>})}
                            <td style={{textAlign:'center',padding:'3px 6px',fontWeight:800,color:'#1e40af',background:'#f0f2f5'}}>{totalUnits}</td>
                          </tr>
                        </tbody></table></div>
                      </div>}
                      {/* Production files */}
                      {_itemPFs.length>0&&<div style={{padding:'8px 14px',borderTop:'1px solid #bbf7d0'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#92400e',marginBottom:4}}>Production Files ({_itemPFs.length})</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{_itemPFs.map((f,fi)=>{const url=f?.url||'';const name=f?.name||fileDisplayName(f);return<div key={fi} style={{padding:'4px 8px',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:4,cursor:'pointer',fontSize:10,fontWeight:600,color:'#92400e',display:'flex',alignItems:'center',gap:3}} onClick={()=>openFile(url)}>📁 {name}{f._afName&&<span style={{fontSize:9,fontStyle:'italic',marginLeft:2}}>({f._afName})</span>}</div>;})}
                        </div>
                      </div>}
                    </div>;
                  })}
                </div>;
              })()}
            {/* Status controls */}
            <div style={{padding:'10px 20px',borderTop:'1px solid #f1f5f9',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Art:</div>
              <select className="form-select" style={{width:150,fontSize:11}} value={j.art_status} onChange={e=>{const ns=e.target.value;const artIds=j._art_ids||[j.art_file_id].filter(Boolean);if(ns==='art_complete'){const missingProd=artIds.some(aid=>{const af2=af.find(a=>a.id===aid);return af2&&!artProdFilesReady(af2)});if(missingProd){nf('Upload production files for all art first','error');return}}if(ns==='waiting_approval'){const missing=skusMissingMockups(j,o);if(missing.length>0){nf('Cannot move to Waiting Approval — mockups missing for: '+missing.join(', '),'error');return}}const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;const upd={...jj,art_status:ns};/* warehouse must explicitly Move to Deco — no auto-transition */if((ns==='art_complete'||PROD_FILES_STATUSES.includes(ns))&&upd.art_requests)upd.art_requests=upd.art_requests.map(r=>r.status==='requested'||r.status==='in_progress'?{...r,status:'completed'}:r);return upd});const afSt=ns==='waiting_approval'?'needs_approval':(PROD_FILES_STATUSES.includes(ns)||ns==='art_complete')?'approved':(ns==='needs_art'||ns==='art_requested')?'waiting_for_art':ns==='art_in_progress'?'waiting_for_art':null;const updArt2=afSt?af.map(a=>artIds.includes(a.id)?{...a,status:afSt}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false)}}>
                {Object.entries(artLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
              {(()=>{const _artIds3=j._art_ids||[j.art_file_id].filter(Boolean);const isTbd=_artIds3.length===0||(_artIds3.length===1&&_artIds3[0]==='__tbd');const hasActiveReqs=(j.art_requests||[]).some(r=>r.status!=='recalled');const hasAnyReqs=(j.art_requests||[]).length>0;if(isTbd&&!hasAnyReqs)return null;const activeReq=(j.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
                return<>{hasActiveReqs&&<span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:activeReq?'#fef3c7':'#dcfce7',color:activeReq?'#92400e':'#166534',marginRight:4,animation:activeReq?'pulse 2s infinite':'none'}}>
                  {activeReq?(activeReq.status==='in_progress'?'Art In Progress':'Art Requested'):'Art Complete'}</span>}
                {(hasActiveReqs||(j.art_status&&j.art_status!=='needs_art'))&&<button className="btn btn-sm" style={{fontSize:10,background:'#dc2626',color:'white',border:'none',padding:'3px 8px',marginRight:4}} onClick={()=>{const artIds=j._art_ids||[j.art_file_id].filter(Boolean);const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;return{...jj,art_status:'needs_art',art_requests:(jj.art_requests||[]).map(r=>['requested','in_progress','completed','waiting_approval'].includes(r.status)?{...r,status:'recalled'}:r),assigned_artist:''}});const updArt=af.map(a=>artIds.includes(a.id)?{...a,status:'waiting_for_art'}:a);const updated={...o,jobs:updJobs,art_files:updArt,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art recalled — you can re-request with new instructions')}}>Recall Art</button>}
                {hasAnyReqs&&<button className="btn btn-sm" style={{fontSize:10,background:'#6d28d9',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>setArtReqModal({jIdx:ji,artist:j.assigned_artist||'',instructions:'',files:[]})}>
                  Update Art</button>}</>})()}
              {(j.art_status==='waiting_approval')&&<button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>{const _apDeco=(af.find(a=>(j._art_ids||[j.art_file_id]).includes(a.id))?.deco_type)||j.deco_type;const _apSt=prodFilesStatusFor(_apDeco);const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:_apSt,art_requests:(jj.art_requests||[]).map(r=>r.status==='requested'||r.status==='in_progress'?{...r,status:'completed'}:r)}:jj);const _appArtIds=j._art_ids||[j.art_file_id].filter(Boolean);const updArt2=_appArtIds.length>0?af.map(a=>_appArtIds.includes(a.id)?{...a,status:'approved'}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art approved — '+(_apSt==='order_dtf_transfers'?'order DTF transfers':_apSt==='upload_emb_files'?'upload embroidery files':'awaiting prod files'))}}>Approve Art</button>}
              <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:8}}>Artist:</div>
              <select className="form-select" style={{width:130,fontSize:11}} value={j.assigned_artist||''} onChange={e=>updJob(ji,'assigned_artist',e.target.value)}>
                <option value="">Unassigned</option>
                {REPS.filter(r=>r.role==='art'||r.role==='artist').filter(r=>r.is_active!==false).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:8}}>Production:</div>
              {j.prod_status==='hold'&&!canProduce&&!canOverride?<span style={{fontSize:11,color:'#94a3b8'}}>Waiting items/art</span>
              :<><select className="form-select" style={{width:150,fontSize:11}} value={j.prod_status} onChange={e=>updJob(ji,'prod_status',e.target.value)}>
                {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>
              {!canProduce&&j.prod_status!=='hold'&&<span style={{fontSize:9,color:'#d97706',marginLeft:4}}>⚠️ Items/art incomplete</span>}</>}
              <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                {j.art_status==='needs_art'&&(j.items||[]).length>0&&<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:10,fontWeight:700}} title="Set up just this job — assign an artist, skip the artist, or build a quick mock" onClick={()=>{
                  const grpItems=(j.items||[]).map(gItem=>{const it=safeItems(o)[gItem.item_idx];const af2=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);return{item_idx:gItem.item_idx,deco_idx:gItem.deco_idx,deco_idxs:Array.isArray(gItem.deco_idxs)&&gItem.deco_idxs.length?gItem.deco_idxs:(gItem.deco_idx!=null?[gItem.deco_idx]:[]),sku:gItem.sku||it?.sku||'',name:gItem.name||safeStr(it?.name),color:gItem.color||it?.color||'',units:gItem.units||Object.values(safeSizes(it||{})).reduce((a,v)=>a+v,0),fulfilled:gItem.fulfilled||0,art_file_id:j.art_file_id,art_name:af2?.name||j.art_name||'',position:j.positions||'Front Center'};});
                  const group={name:j.art_name||j.deco_type.replace(/_/g,' '),deco_type:j.deco_type,items:grpItems,artist:j.assigned_artist||'',notes:j.rep_notes||'',files:[],_split:!!j.split_from,_existingJobId:j.id,_merged:!!j._merged};
                  setSelJob(null);
                  setJobWizard({groups:[group],scopeJobId:j.id});
                }}>🎨 Set up job</button>}
                {(j.items||[]).length>0&&j.total_units>1&&<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:10}} onClick={()=>setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}>✂️ Split Job</button>}
                <button className="btn btn-sm btn-secondary" onClick={()=>{
                  const w=window.open('','_blank','width=700,height=900');
                  w.document.write('<html><head><title>'+j.id+' — '+j.art_name+'</title><style>body{font-family:sans-serif;padding:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:12px}th{background:#f0f0f0;font-weight:700}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.info div{padding:8px;background:#f8f8f8;border-radius:4px}.label{font-size:10px;color:#666;font-weight:600;text-transform:uppercase}@media print{body{padding:12px}}</style></head><body>');
                  w.document.write('<h1>'+j.id+' — '+j.art_name+'</h1>');
                  w.document.write('<p>'+j.deco_type?.replace(/_/g,' ')+' · '+(j.positions||'').replace(/^,\s*/,'')+' · '+j.total_units+' total units</p>');
                  w.document.write('<p>SO: '+o.id+' — '+(o.memo||'')+'</p>');
                  // Mockup image at top
                  const _jsMocks=[...(artF?.mockup_files||artF?.files||[]),...Object.values(artF?.item_mockups||{}).flat()].filter(f=>f);
                  const _jsMockUrl=(()=>{for(const f of _jsMocks){const u=typeof f==='string'?f:(f?.url||'');if(_isImgUrl(u,f))return u;const pt=_isPdfUrl(u,f)?_cloudinaryPdfThumb(u):null;if(pt)return pt}return itemDetails.find(gi=>gi.image_url&&_isImgUrl(gi.image_url))?.image_url||null})();
                  if(_jsMockUrl){w.document.write('<div style="text-align:center;margin:12px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><img src="'+_jsMockUrl+'" style="max-width:100%;max-height:350px;object-fit:contain;border-radius:6px"/><div style="font-size:10px;color:#666;margin-top:4px">Mockup Preview</div></div>')}
                  w.document.write('<div class="info"><div><div class="label">Art Status</div>'+artLabels[j.art_status]+'</div><div><div class="label">Item Status</div>'+itemLabels[jItemStatus(j)]+'</div><div><div class="label">Production</div>'+prodLabels[j.prod_status]+'</div><div><div class="label">Fulfilled</div>'+j.fulfilled_units+'/'+j.total_units+' ('+pct+'%)</div></div>');
                  if(artF){w.document.write('<h2>Art Details</h2><div class="info"><div><div class="label">Deco Type</div>'+(artF.deco_type?.replace(/_/g,' ')||'—')+'</div><div><div class="label">Art Size</div>'+(artF.art_size||'—')+'</div><div><div class="label">Ink Colors</div>'+(artF.ink_colors||'—')+'</div><div><div class="label">Thread Colors</div>'+(artF.thread_colors||'—')+'</div></div>')}
                  w.document.write('<h2>Items & Sizes</h2>');
                  itemDetails.forEach(gi=>{
                    w.document.write('<p style="margin:12px 0 4px;font-weight:700">'+gi.sku+' — '+(gi.name||'Unknown')+' ('+gi.color+')</p>');
                    w.document.write('<table><thead><tr><th></th>');
                    allSizes.forEach(sz=>{w.document.write('<th>'+sz+'</th>')});
                    w.document.write('<th>Total</th></tr></thead><tbody>');
                    w.document.write('<tr><td style="font-weight:700;text-align:left">Ordered</td>');
                    let rowT=0;allSizes.forEach(sz=>{const v=gi.sizes[sz]||0;rowT+=v;w.document.write('<td>'+(v||'')+'</td>')});
                    w.document.write('<td style="font-weight:700">'+rowT+'</td></tr>');
                    w.document.write('<tr><td style="font-weight:700;text-align:left">In Hand</td>');
                    let fulT=0;allSizes.forEach(sz=>{const v=gi.fulSizes[sz]||0;fulT+=v;w.document.write('<td style="color:'+(v>0?'green':'#ccc')+'">'+(v||'—')+'</td>')});
                    w.document.write('<td style="font-weight:700;color:'+(fulT>=rowT?'green':'orange')+'">'+fulT+'</td></tr>');
                    w.document.write('</tbody></table>');
                  });
                  // Production files
                  const _jsProdFiles=(artF?.prod_files||[]).filter(f=>f);
                  if(_jsProdFiles.length>0||_jsMocks.length>0){
                    w.document.write('<h2>Production Files</h2><table><thead><tr><th style="text-align:left">Type</th><th style="text-align:left">Filename</th></tr></thead><tbody>');
                    _jsProdFiles.forEach(f=>{w.document.write('<tr><td>Production</td><td>'+fileDisplayName(f)+'</td></tr>')});
                    _jsMocks.forEach(f=>{w.document.write('<tr><td>Mockup</td><td>'+fileDisplayName(f)+'</td></tr>')});
                    w.document.write('</tbody></table>');
                  }
                  if(j.notes){w.document.write('<h2>Notes</h2><p>'+j.notes+'</p>')}
                  w.document.write('<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ccc;font-size:10px;color:#999">Printed '+new Date().toLocaleString()+' · NSA Portal</div>');
                  w.document.write('</body></html>');w.document.close();w.print();
                }}>🖨️ Print Job Sheet</button>
              </div>
            </div>
          </div>


          {/* Art Requests Log */}
          {(j.art_requests||[]).length>0&&<div className="card" style={{marginBottom:12}}>
            <div className="card-header"><h2>🎨 Art Requests</h2></div>
            <div className="card-body" style={{padding:0}}>
              {(j.art_requests||[]).map((r,ri)=><div key={ri} style={{padding:'10px 16px',borderBottom:ri<(j.art_requests||[]).length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'flex-start',gap:12}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <strong style={{fontSize:13}}>{r.artist_name||'Unknown'}</strong>
                    <span className={`badge ${r.status==='completed'?'badge-green':r.status==='in_progress'?'badge-blue':'badge-amber'}`} style={{fontSize:9}}>{r.status==='completed'?'Completed':r.status==='in_progress'?'In Progress':'Requested'}</span>
                    <span style={{fontSize:10,color:'#94a3b8',marginLeft:'auto'}}>{new Date(r.created_at).toLocaleDateString()} by {r.created_by||'—'}</span>
                  </div>
                  {r.instructions&&<div style={{fontSize:12,color:'#475569',marginBottom:4}}>{r.instructions}</div>}
                  {(r.files||[]).length>0&&<div style={{fontSize:10,color:'#64748b'}}>📎 {r.files.length} file(s) attached</div>}
                </div>
                <div style={{display:'flex',gap:4}}>
                  {r.status==='requested'&&<button className="btn btn-sm" style={{fontSize:9,background:'#3b82f6',color:'white',border:'none'}} onClick={()=>{const upd=jobs.map((jj,i)=>i===ji?{...jj,art_requests:(jj.art_requests||[]).map((rr,rri)=>rri===ri?{...rr,status:'in_progress'}:rr)}:jj);const updated={...o,jobs:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false)}}>Start Working</button>}
                  {r.status==='in_progress'&&<button className="btn btn-sm" style={{fontSize:9,background:'#166534',color:'white',border:'none'}} onClick={()=>{const upd=jobs.map((jj,i)=>i===ji?{...jj,art_requests:(jj.art_requests||[]).map((rr,rri)=>rri===ri?{...rr,status:'completed'}:rr)}:jj);const updated={...o,jobs:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false)}}>Mark Done</button>}
                </div>
              </div>)}
            </div>
          </div>}

          {/* Items & Size Matrix */}
          <div className="card" style={{marginBottom:12}}>
            <div className="card-header"><h2>📦 Items & Sizes</h2></div>
            <div className="card-body" style={{padding:0}}>
              {itemDetails.map((gi,gii)=>{
                const rowTotal=Object.values(gi.sizes||{}).reduce((a,v)=>a+safeNum(v),0);
                const fulTotal=Object.values(gi.fulSizes||{}).reduce((a,v)=>a+safeNum(v),0);
                const srcItem=safeItems(o)[gi.item_idx];
                const itemArtDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'):[];
                const itemNumDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='numbers'):[];
                const _cm4={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
                return<div key={gii} style={{padding:'12px 16px',borderBottom:gii<itemDetails.length-1?'1px solid #f1f5f9':'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    {gi.image_url?<img src={gi.image_url} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:6,border:'1px solid #e2e8f0',flexShrink:0}}/>
                    :<div style={{width:44,height:44,borderRadius:6,background:'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,color:'#94a3b8',flexShrink:0}}>👕</div>}
                    <div style={{flex:1}}>
                      <div><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:3,marginRight:6}}>{gi.sku}</span>
                      <span style={{fontWeight:600}}>{gi.name||'Unknown'}</span>
                      <span style={{color:'#94a3b8',marginLeft:6}}>({gi.color||'—'})</span>
                      {gi.brand&&<span className="badge badge-gray" style={{marginLeft:6}}>{gi.brand}</span>}</div>
                    </div>
                    <div style={{fontWeight:700,color:fulTotal>=rowTotal&&rowTotal>0?'#166534':'#64748b',flexShrink:0}}>{fulTotal}/{rowTotal} units</div>
                  </div>
                  {/* Per-SKU art details */}
                  {(itemArtDecos.length>0||itemNumDecos.length>0)&&<div style={{marginBottom:8}}>
                    {itemArtDecos.map((d,di)=>{const af2=d.art_file_id?safeArt(o).find(a=>a.id===d.art_file_id):null;
                      const gk=gi.sku+'|'+(gi.color||'');const gc=af2?.garment_colors?.[gk]||{};
                      const gcColors=Object.values(gc).flat().filter((v,idx2,arr)=>v&&arr.indexOf(v)===idx2);
                      const fallbackColors=(af2?(af2.ink_colors||af2.thread_colors||''):'').split(/[,\n]/).map(c3=>c3.trim()).filter(Boolean);
                      const itemColors=gcColors.length>0?gcColors:fallbackColors;
                      const isE4=af2?.deco_type==='embroidery';
                      return<div key={'a'+di} style={{padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:4}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:itemColors.length>0?8:0}}>
                          <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{(af2?.deco_type||d.deco_type||'screen_print').replace(/_/g,' ')}</div></div>
                          <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Location</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{d.position||'Front Center'}</div></div>
                          <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{af2?.art_size||'—'}</div></div>
                        </div>
                        {itemColors.length>0&&<div>
                          <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>{isE4?'Thread Colors':'Ink Colors'} ({itemColors.length})</div>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {itemColors.map((cl,ci)=>{const clL=cl.toLowerCase();const sw=_cm4[cl]||Object.entries(_cm4).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||null;
                              return<div key={ci} style={{display:'flex',alignItems:'center',gap:4,padding:'2px 8px',background:'white',border:'1px solid #e2e8f0',borderRadius:5,fontSize:10,fontWeight:600}}>
                                <div style={{width:12,height:12,borderRadius:3,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                                <span>{cl}</span></div>})}
                          </div>
                        </div>}
                      </div>})}
                    {itemNumDecos.map((nd,ni)=><div key={'n'+ni} style={{padding:'10px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,marginBottom:4}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Numbers</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{(nd.num_method||'heat_transfer').replace(/_/g,' ')}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Location</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{nd.position||'Back Center'}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Size</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{nd.num_size||'—'}{nd.front_and_back?' / Back: '+(nd.num_size_back||nd.num_size||'—'):''}</div></div>
                      </div>
                      <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                        {nd.print_color&&<span style={{fontSize:10}}>Color: <strong>{nd.print_color}</strong></span>}
                        {nd.front_and_back&&<span style={{padding:'1px 6px',borderRadius:4,background:'#7c3aed',color:'white',fontSize:9,fontWeight:700}}>Front + Back</span>}
                        {nd.reversible&&<span style={{padding:'1px 6px',borderRadius:4,background:'#f59e0b',color:'white',fontSize:9,fontWeight:700}}>Reversible</span>}
                      </div>
                    </div>)}
                  </div>}
                  {/* Size grid */}
                  <div style={{overflowX:'auto'}}>
                    <table style={{fontSize:11,minWidth:300}}><thead><tr><th style={{textAlign:'left',width:80}}></th>
                      {allSizes.map(sz=><th key={sz} style={{minWidth:40,textAlign:'center'}}>{sz}</th>)}
                      <th style={{minWidth:50,textAlign:'center',fontWeight:800}}>Total</th></tr></thead><tbody>
                      <tr><td style={{fontWeight:600}}>Ordered</td>
                        {allSizes.map(sz=><td key={sz} style={{textAlign:'center',fontWeight:gi.sizes[sz]?700:400,color:gi.sizes[sz]?'#0f172a':'#cbd5e1'}}>{gi.sizes[sz]||'—'}</td>)}
                        <td style={{textAlign:'center',fontWeight:800,background:'#f1f5f9'}}>{rowTotal}</td></tr>
                      <tr><td style={{fontWeight:600,color:'#166534'}}>In Hand</td>
                        {allSizes.map(sz=>{const v=gi.fulSizes[sz]||0;const ord=gi.sizes[sz]||0;return<td key={sz} style={{textAlign:'center',fontWeight:600,color:v>=ord&&ord>0?'#166534':v>0?'#d97706':'#cbd5e1'}}>{v||'—'}</td>})}
                        <td style={{textAlign:'center',fontWeight:800,background:fulTotal>=rowTotal&&rowTotal>0?'#dcfce7':'#fef3c7',color:fulTotal>=rowTotal&&rowTotal>0?'#166534':'#92400e'}}>{fulTotal}</td></tr>
                      <tr><td style={{fontWeight:600,color:'#dc2626'}}>Need</td>
                        {allSizes.map(sz=>{const need=Math.max(0,(gi.sizes[sz]||0)-(gi.fulSizes[sz]||0));return<td key={sz} style={{textAlign:'center',fontWeight:need>0?700:400,color:need>0?'#dc2626':'#cbd5e1'}}>{need||'—'}</td>})}
                        <td style={{textAlign:'center',fontWeight:800,background:rowTotal-fulTotal>0?'#fee2e2':'#dcfce7',color:rowTotal-fulTotal>0?'#dc2626':'#166534'}}>{Math.max(0,rowTotal-fulTotal)}</td></tr>
                    </tbody></table>
                  </div>
                </div>})}
            </div>
          </div>

          {/* Count-in & Notes */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="card">
              <div className="card-header"><h2>📋 Count-In at Decoration</h2></div>
              <div className="card-body">
                {j.counted_at?<div style={{padding:10,background:j.count_discrepancies?.length?'#fef2f2':'#f0fdf4',borderRadius:6}}>
                  <div style={{fontSize:12,fontWeight:700,color:j.count_discrepancies?.length?'#dc2626':'#166534'}}>{j.count_discrepancies?.length?'⚠️ Counted In — Discrepancies Found':'✅ All Confirmed'}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{j.counted_by||'—'} · {j.counted_at}</div>
                  {j.count_discrepancy&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>Note: {j.count_discrepancy}</div>}
                  {j.count_discrepancies?.length>0&&<div style={{marginTop:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#dc2626',marginBottom:4}}>Missing / Short Items:</div>
                    <table style={{fontSize:11,width:'100%'}}><thead><tr><th style={{textAlign:'left'}}>SKU</th><th>Size</th><th style={{textAlign:'center'}}>Expected</th><th style={{textAlign:'center'}}>Actual</th><th style={{textAlign:'center'}}>Short</th></tr></thead>
                    <tbody>{j.count_discrepancies.map((d2,di)=><tr key={di} style={{background:'#fef2f2'}}>
                      <td style={{fontFamily:'monospace',fontWeight:600,color:'#1e40af'}}>{d2.sku}</td>
                      <td style={{fontWeight:600}}>{d2.size}</td>
                      <td style={{textAlign:'center'}}>{d2.expected}</td>
                      <td style={{textAlign:'center',fontWeight:700,color:'#dc2626'}}>{d2.actual}</td>
                      <td style={{textAlign:'center',fontWeight:700,color:'#dc2626'}}>{d2.expected-d2.actual}</td>
                    </tr>)}</tbody></table>
                  </div>}
                </div>:<>
                  <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>Confirm inventory received at decoration station</div>
                  {/* SKU/Size summary for reference */}
                  <div style={{marginBottom:10,background:'#f8fafc',borderRadius:6,padding:8}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>Expected Items:</div>
                    {itemDetails.map((gi,gii)=>{const rowTotal=Object.values(gi.sizes||{}).reduce((a,v)=>a+safeNum(v),0);
                      return<div key={gii} style={{fontSize:11,padding:'2px 0',display:'flex',gap:8,alignItems:'center'}}>
                        <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{gi.sku}</span>
                        <span style={{color:'#64748b'}}>{gi.color||'—'}</span>
                        <span style={{marginLeft:'auto',fontWeight:700}}>{rowTotal} pcs</span>
                        <span style={{fontSize:9,color:'#94a3b8'}}>{Object.entries(gi.sizes||{}).filter(([,v])=>safeNum(v)>0).map(([sz,v])=>sz+':'+v).join(' ')}</span>
                      </div>})}
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-sm btn-primary" style={{background:'#166534',borderColor:'#166534'}} onClick={()=>{
                      const upd=jobs.map((jj,i)=>i===ji?{...jj,counted_at:new Date().toLocaleString(),counted_by:cu?.name||'Unknown',count_discrepancies:[]}:jj);
                      const updated={...o,jobs:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);
                      nf('✅ Count-in confirmed — all items match');
                    }}>✅ All Confirmed</button>
                    <button className="btn btn-sm btn-secondary" style={{color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
                      // Build discrepancy modal data
                      const entries=[];
                      itemDetails.forEach(gi=>{Object.entries(gi.sizes||{}).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
                        entries.push({sku:gi.sku,name:gi.name,color:gi.color||'',size:sz,expected:safeNum(v),actual:safeNum(v)})})});
                      setCountDiscModal({open:true,entries,notes:''});
                    }}>Count Is Off</button>
                  </div>
                </>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>📝 Job Notes</h2></div>
              <div className="card-body">
                <textarea className="form-input" rows={3} placeholder="Production notes for this job..." style={{fontSize:12}} value={j.notes||''} onChange={e=>updJob(ji,'notes',e.target.value)}/>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Visible to decoration team & printed on job sheet</div>
              </div>
            </div>
          </div>
        </div>
      {/* Count Discrepancy Modal */}
      {countDiscModal?.open&&<div className="modal-overlay" onClick={()=>setCountDiscModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
        <div className="modal-header" style={{background:'#fef2f2'}}><h2>⚠️ Count Discrepancy — {j.art_name||j.id}</h2><button className="modal-close" onClick={()=>setCountDiscModal(null)}>x</button></div>
        <div className="modal-body">
          <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>Adjust the <strong>Actual</strong> count for any items that don't match the expected quantity. Items with discrepancies will be flagged for the production team.</div>
          <div style={{maxHeight:350,overflow:'auto'}}>
            <table style={{fontSize:12}}><thead><tr><th style={{textAlign:'left'}}>SKU</th><th>Color</th><th>Size</th><th style={{textAlign:'center'}}>Expected</th><th style={{textAlign:'center'}}>Actual</th><th style={{textAlign:'center'}}>Diff</th></tr></thead>
            <tbody>{(countDiscModal.entries||[]).map((e,ei)=>{const diff=e.actual-e.expected;
              return<tr key={ei} style={{background:diff<0?'#fef2f2':undefined}}>
                <td style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{e.sku}</td>
                <td style={{fontSize:11,color:'#64748b'}}>{e.color}</td>
                <td style={{fontWeight:600}}>{e.size}</td>
                <td style={{textAlign:'center'}}>{e.expected}</td>
                <td style={{textAlign:'center'}}><input type="number" min="0" className="form-input" style={{width:60,textAlign:'center',fontWeight:700,color:e.actual<e.expected?'#dc2626':'#166534'}} value={e.actual} onChange={ev=>setCountDiscModal(m=>({...m,entries:m.entries.map((x,xi)=>xi===ei?{...x,actual:parseInt(ev.target.value)||0}:x)}))}/></td>
                <td style={{textAlign:'center',fontWeight:700,color:diff<0?'#dc2626':diff>0?'#d97706':'#166534'}}>{diff<0?diff:diff>0?'+'+diff:'✓'}</td>
              </tr>})}</tbody></table>
          </div>
          <div style={{marginTop:12}}><label className="form-label">Notes</label><input className="form-input" placeholder="Additional notes about discrepancy..." value={countDiscModal.notes||''} onChange={e=>setCountDiscModal(m=>({...m,notes:e.target.value}))}/></div>
          <div style={{display:'flex',gap:8,marginTop:16}}>
            <button className="btn btn-primary" style={{background:'#dc2626',borderColor:'#dc2626'}} onClick={()=>{
              const discs=(countDiscModal.entries||[]).filter(e=>e.actual!==e.expected).map(e=>({sku:e.sku,name:e.name,color:e.color,size:e.size,expected:e.expected,actual:e.actual}));
              const upd=jobs.map((jj,i)=>i===ji?{...jj,
                counted_at:new Date().toLocaleString(),counted_by:cu?.name||'Unknown',
                count_discrepancies:discs,
                count_discrepancy:countDiscModal.notes||(discs.length>0?discs.map(d2=>d2.sku+' '+d2.size+': expected '+d2.expected+' got '+d2.actual).join('; '):'')
              }:jj);
              const updated={...o,jobs:upd,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);
              // Create production team issue for missing pieces
              if(discs.length>0){
                const missingSummary=discs.map(d2=>d2.sku+' '+d2.size+': short '+(d2.expected-d2.actual)).join(', ');
                const issue={id:'ISS-'+Date.now(),status:'open',description:'Count-in discrepancy on '+j.id+' ('+j.art_name+'): '+missingSummary+(countDiscModal.notes?' — '+countDiscModal.notes:''),priority:'high',page:'jobs',viewing:o.id+' / '+j.id,reported_by:cu?.name||'Unknown',role:cu?.role||'production',timestamp:new Date().toISOString(),recent_errors:[],resolved_at:null,resolution:null};
                setIssues(prev=>[issue,...prev]);
                nf('⚠️ Count-in recorded with discrepancies — Issue '+issue.id+' created for production team');
              } else {
                nf('✅ Count-in recorded');
              }
              setCountDiscModal(null);
            }}>Submit Count-In with Discrepancies</button>
            <button className="btn btn-secondary" onClick={()=>setCountDiscModal(null)}>Cancel</button>
          </div>
        </div>
      </div></div>}
      {/* Art Request Modal (also needed in job detail view) */}
      {artReqModal&&(()=>{
        const j2=jobs[artReqModal.jIdx];if(!j2)return null;
        const _artIds2=(j2._art_ids||[j2.art_file_id]).filter(Boolean);
        const existingFiles2=_artIds2.flatMap(aid=>{const af=safeArt(o).find(a=>a.id===aid);return(af?.sample_art||[]).concat(af?.mockup_files||[]).concat(af?.prod_files||[])});
        const artists2=REPS.filter(r=>r.role==='art');
        const submitArtReq2=()=>{
          const req={id:'AR-'+Date.now(),artist:artReqModal.artist,artist_name:(artists2.find(a=>a.id===artReqModal.artist)||{}).name||'',instructions:artReqModal.instructions,files:artReqModal.files||[],existing_files:existingFiles2.map(f=>f.name||f),status:'requested',created_at:new Date().toISOString(),created_by:cu.name};
          const j2job=jobs[artReqModal.jIdx];
          const updatedJobs=jobs.map((jj,i)=>i===artReqModal.jIdx?{...jj,art_requests:[...(jj.art_requests||[]),req],art_status:(jj.art_status==='needs_art'||jj.art_status==='waiting_approval'||PROD_FILES_STATUSES.includes(jj.art_status))?'art_requested':jj.art_status,assigned_artist:artReqModal.artist||jj.assigned_artist}:jj);
          // Store rep files as sample_art on the art file (not mockups)
          const repFiles=artReqModal.files||[];
          let updArtFiles2=safeArt(o);
          if(repFiles.length>0&&j2job){
            const artIds2=j2job._art_ids||[j2job.art_file_id].filter(Boolean);
            updArtFiles2=updArtFiles2.map(a=>artIds2.includes(a.id)?{...a,sample_art:[...(a.sample_art||[]),...repFiles]}:a);
          }
          const updated={...o,jobs:updatedJobs,art_files:updArtFiles2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setArtReqModal(null);nf('Art request sent to '+(artists2.find(a=>a.id===artReqModal.artist)||{}).name||'artist');
        };
        const hasExistingReqs2=(j2.art_requests||[]).length>0;
        const activeReq2=(j2.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
        return<div className="modal-overlay" onClick={()=>setArtReqModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
          <div className="modal-header" style={hasExistingReqs2?{background:'#faf5ff'}:undefined}><h2>{hasExistingReqs2?'Update Art Request':'🎨 Request Art'} — {j2.art_name}</h2><button className="modal-close" onClick={()=>setArtReqModal(null)}>×</button></div>
          <div className="modal-body">
            {hasExistingReqs2&&<div style={{padding:'10px 14px',marginBottom:12,borderRadius:8,border:'2px solid '+(activeReq2?'#fbbf24':'#86efac'),background:activeReq2?'#fffbeb':'#f0fdf4'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:18}}>{activeReq2?(activeReq2.status==='in_progress'?'🎨':'📩'):'✅'}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:activeReq2?'#92400e':'#166534'}}>{activeReq2?(activeReq2.status==='in_progress'?'Art In Progress — '+activeReq2.artist_name:'Art Requested — Awaiting '+activeReq2.artist_name):'All Requests Complete'}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{(j2.art_requests||[]).length} request(s) total · Last: {new Date((j2.art_requests||[])[(j2.art_requests||[]).length-1]?.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            </div>}
            <div style={{marginBottom:12}}>
              <div className="form-label">Artist *</div>
              <select className="form-select" value={artReqModal.artist} onChange={e=>setArtReqModal(m=>({...m,artist:e.target.value}))}>
                <option value="">Select artist...</option>
                {artists2.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <div className="form-label">{hasExistingReqs2?'Update / Additional Instructions':'Instructions'}</div>
              <textarea className="form-input" rows={4} placeholder={hasExistingReqs2?'Add revision notes, feedback, or additional instructions...':'Describe what you need — mockup, revision, specific colors, placement notes, etc.'} value={artReqModal.instructions} onChange={e=>setArtReqModal(m=>({...m,instructions:e.target.value}))} style={{resize:'vertical'}}/>
            </div>
            <div style={{marginBottom:12}}>
              <div className="form-label">Sample Art / Reference Files</div>
              <div style={{border:'2px dashed #cbd5e1',borderRadius:8,padding:16,textAlign:'center',cursor:'pointer',background:'#f8fafc'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6';e.currentTarget.style.background='#eff6ff'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#f8fafc'}}
                onDrop={async e=>{e.preventDefault();e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#f8fafc';for(const f of Array.from(e.dataTransfer.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');setArtReqModal(m=>m?{...m,files:[...(m.files||[]),{name:f.name,size:f.size,type:f.type,url}]}:m)}catch(err){nf('Upload failed: '+err.message,'error')}}}}
                onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.onchange=async()=>{for(const f of Array.from(inp.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');setArtReqModal(m=>m?{...m,files:[...(m.files||[]),{name:f.name,size:f.size,type:f.type,url}]}:m)}catch(err){nf('Upload failed: '+err.message,'error')}}};inp.click()}}>
                <div style={{fontSize:12,color:'#64748b'}}>Drop files here or click to browse</div>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>PNG, PDF, AI, EPS, JPG</div>
              </div>
              {(artReqModal.files||[]).length>0&&<div style={{marginTop:8}}>{(artReqModal.files||[]).map((f,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',background:'#f1f5f9',borderRadius:4,fontSize:11,marginBottom:4}}>
                <span>{f.name}</span><span style={{color:'#94a3b8',marginLeft:'auto'}}>{(f.size/1024).toFixed(0)}KB</span>
                <button style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:14,padding:0}} onClick={()=>setArtReqModal(m=>({...m,files:(m.files||[]).filter((_,fi)=>fi!==i)}))}>×</button>
              </div>)}</div>}
            </div>
            {existingFiles2.length>0&&<div style={{marginBottom:12}}>
              <div className="form-label">Existing Art Files (auto-included)</div>
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:6,padding:8}}>{existingFiles2.map((f,i)=><div key={i} style={{fontSize:11,color:'#166534',padding:'2px 0'}}>✓ {f.name||f}</div>)}</div>
            </div>}
            {(j2.art_requests||[]).length>0&&<div style={{marginBottom:12}}>
              <div className="form-label">Previous Requests ({(j2.art_requests||[]).length})</div>
              <div style={{maxHeight:120,overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:6}}>{(j2.art_requests||[]).map((r,i)=><div key={i} style={{padding:'6px 10px',borderBottom:'1px solid #f1f5f9',fontSize:11}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><strong>{r.artist_name||'Unknown'}</strong><span style={{color:'#94a3b8'}}>{new Date(r.created_at).toLocaleDateString()}</span></div>
                <div style={{color:'#64748b',marginTop:2}}>{r.instructions||'No instructions'}</div>
                <span className={`badge ${r.status==='completed'?'badge-green':r.status==='in_progress'?'badge-blue':'badge-amber'}`} style={{fontSize:9,marginTop:2}}>{r.status==='completed'?'Done':r.status==='in_progress'?'Working':'Requested'}</span>
              </div>)}</div>
            </div>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setArtReqModal(null)}>Cancel</button>
            <button className="btn btn-primary" style={hasExistingReqs2?{background:'#6d28d9',borderColor:'#6d28d9'}:{}} disabled={!artReqModal.artist} onClick={submitArtReq2}>{hasExistingReqs2?'Send Update':'Send Art Request'}</button>
          </div>
        </div></div>
      })()}
      {coachApprovalModal&&(()=>{
        const j3=jobs[coachApprovalModal.jIdx];if(!j3)return null;
        const cam=coachApprovalModal;
        const allEmails=[...new Set((cam.contacts||[]).filter(c3=>c3.email).map(c3=>c3.email))];
        const allTargets=[...allEmails,...(cam.customEmails||[])].filter(em=>cam.checkedEmails?.[em]);
        // Subject + body label: prefer the SO memo (customer-facing), fall back to the internal art name.
        const _emailLabel=(o.memo&&o.memo.trim())||j3.art_name;
        const _emailSubject='Artwork ready for approval — '+_emailLabel;
        // Build absolute URL for the logo so it renders in external email clients.
        const _logoRaw=_ci.logoUrl||NSA.logoUrl||'/nsa-logo.svg';
        const _logoSrc=/^https?:/i.test(_logoRaw)?_logoRaw:(window.location.origin+_logoRaw);
        const _emailLogoHtml='<div style="text-align:center;padding:12px 0 18px;border-bottom:2px solid #e2e8f0;margin-bottom:18px"><img src="'+_logoSrc+'" alt="National Sports Apparel" style="max-height:60px;display:inline-block"/></div>';
        const doSendCoach=async()=>{
          const actions=[];
          if(cam.sendEmail&&allTargets.length>0){
            if(_brevoKey){
              setCoachApprovalModal(m=>({...m,sending:true}));
              const htmlMsg=cam.message.replace(/\n/g,'<br/>');
              const toList=allTargets.map(em=>({email:em}));
              const res=await sendBrevoEmail({to:toList,subject:_emailSubject,htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto">'+_emailLogoHtml+htmlMsg+'</div>',senderName:cu.name||'National Sports Apparel',senderEmail:cu?.email||'noreply@nationalsportsapparel.com',replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined});
              if(res.ok){actions.push('email sent to '+allTargets.join(', '));actions._messageId=res.messageId}else{nf('Email failed: '+res.error,'error');setCoachApprovalModal(m=>({...m,sending:false}));return}
            }else{
              const subj=encodeURIComponent(_emailSubject);
              const body=encodeURIComponent(cam.message);
              window.open('mailto:'+allTargets.join(',')+'?subject='+subj+'&body='+body,'_blank');
              actions.push('email draft opened for '+allTargets.length+' recipient(s)');
            }
          }
          if(cam.sendText&&cam.contact.phone){
            if(_brevoKey){
              const smsRes=await sendBrevoSms({to:cam.contact.phone,content:cam.message.substring(0,160)});
              if(smsRes.ok){actions.push('text sent to '+cam.contact.phone)}else{nf('SMS failed: '+smsRes.error,'error')}
            }else{
              const smsBody=encodeURIComponent(cam.message);
              window.open('sms:'+cam.contact.phone+'?body='+smsBody,'_blank');
              actions.push('text opened');
            }
          }
          // Record sent_to_coach_at timestamp, follow-up, and history on the job
          const fuAt=cam.followUpDays?new Date(Date.now()+cam.followUpDays*86400000).toISOString():null;
          const histEntry={sent_at:new Date().toISOString(),sent_by:cu.name||cu.id,type:'art_approval',methods:actions,to:allTargets.join(', '),messageId:actions._messageId||null};
          const updJobs3=safeJobs(o).map((jj,i)=>i===coachApprovalModal.jIdx?{...jj,sent_to_coach_at:new Date().toISOString(),follow_up_at:fuAt,sent_history:[...(jj.sent_history||[]),histEntry]}:jj);
          const updated3={...o,jobs:updJobs3,updated_at:new Date().toLocaleString()};setO(updated3);onSave(updated3);setDirty(false);
          setCoachApprovalModal(null);
          nf(actions.length>0?'Sent to coach — '+actions.join(' + '):'No notification method selected');
        };
        return<div className="modal-overlay" style={{zIndex:10001}} onClick={()=>setCoachApprovalModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
          <div className="modal-header" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb)',color:'white'}}>
            <h2 style={{color:'white',margin:0}}>Send to Coach for Approval</h2>
            <button className="modal-close" style={{color:'white'}} onClick={()=>setCoachApprovalModal(null)}>×</button>
          </div>
          <div className="modal-body">
            <div style={{padding:'10px 14px',background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:'#6d28d9'}}>{j3.art_name}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{o.id}{o.memo?' — '+o.memo:''}</div>
            </div>

            {/* ── Email toggle + selector ── */}
            <div style={{marginBottom:12,padding:12,background:cam.sendEmail?'#eff6ff':'#f8fafc',border:'1px solid '+(cam.sendEmail?'#93c5fd':'#e2e8f0'),borderRadius:8}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:cam.sendEmail?10:0}}>
                <input type="checkbox" checked={cam.sendEmail} onChange={e=>setCoachApprovalModal(m=>({...m,sendEmail:e.target.checked}))} style={{width:16,height:16,accentColor:'#2563eb'}}/>
                <span style={{fontWeight:700,fontSize:13,color:cam.sendEmail?'#1e40af':'#64748b'}}>Email Coach</span>
                {_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600}}>Sends directly</span>}
                {!_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Opens email app</span>}
              </label>
              {cam.sendEmail&&<div>
                <div className="form-label" style={{fontSize:11,marginBottom:6}}>Send to</div>
                {allEmails.map(em=>{const ct2=(cam.contacts||[]).find(c3=>c3.email===em);return<label key={em} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 8px',borderRadius:6,background:cam.checkedEmails?.[em]?'#dbeafe':'transparent',marginBottom:4}}>
                  <input type="checkbox" checked={!!cam.checkedEmails?.[em]} onChange={e=>setCoachApprovalModal(m=>({...m,checkedEmails:{...m.checkedEmails,[em]:e.target.checked}}))} style={{width:14,height:14,accentColor:'#2563eb'}}/>
                  <span style={{fontSize:12}}><strong>{ct2?.name||'Contact'}</strong> — {em}{ct2?.role?' ('+ct2.role+')':''}</span>
                </label>})}
                {(cam.customEmails||[]).map(em=><label key={em} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 8px',borderRadius:6,background:cam.checkedEmails?.[em]?'#dbeafe':'transparent',marginBottom:4}}>
                  <input type="checkbox" checked={!!cam.checkedEmails?.[em]} onChange={e=>setCoachApprovalModal(m=>({...m,checkedEmails:{...m.checkedEmails,[em]:e.target.checked}}))} style={{width:14,height:14,accentColor:'#2563eb'}}/>
                  <span style={{fontSize:12}}>{em} <span style={{fontSize:10,color:'#64748b'}}>(added)</span></span>
                  <button style={{marginLeft:'auto',background:'none',border:'none',color:'#94a3b8',cursor:'pointer',fontSize:14,padding:0}} onClick={()=>setCoachApprovalModal(m=>{const ce={...m.checkedEmails};delete ce[em];return{...m,customEmails:m.customEmails.filter(x=>x!==em),checkedEmails:ce}})}>x</button>
                </label>)}
                <div style={{display:'flex',gap:6,marginTop:6}}>
                  <input className="form-input" type="email" placeholder="+ Add another email..." value={cam.addingEmail||''} onChange={e=>setCoachApprovalModal(m=>({...m,addingEmail:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&cam.addingEmail?.includes('@')){e.preventDefault();setCoachApprovalModal(m=>({...m,customEmails:[...(m.customEmails||[]),m.addingEmail.trim()],checkedEmails:{...m.checkedEmails,[m.addingEmail.trim()]:true},addingEmail:''}))}}} style={{fontSize:12,flex:1}}/>
                  <button className="btn btn-sm btn-secondary" disabled={!cam.addingEmail?.includes('@')} onClick={()=>setCoachApprovalModal(m=>({...m,customEmails:[...(m.customEmails||[]),m.addingEmail.trim()],checkedEmails:{...m.checkedEmails,[m.addingEmail.trim()]:true},addingEmail:''}))}>Add</button>
                </div>
              </div>}
            </div>

            {/* ── Text toggle — hidden via _smsUiEnabled flag while SMS sending is unreliable ── */}
            {_smsUiEnabled&&<div style={{marginBottom:12,padding:12,background:cam.sendText?'#f0fdf4':'#f8fafc',border:'1px solid '+(cam.sendText?'#86efac':'#e2e8f0'),borderRadius:8}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                <input type="checkbox" checked={cam.sendText} onChange={e=>setCoachApprovalModal(m=>({...m,sendText:e.target.checked}))} style={{width:16,height:16,accentColor:'#22c55e'}}/>
                <span style={{fontWeight:700,fontSize:13,color:cam.sendText?'#166534':'#64748b'}}>Text Coach</span>
                {cam.contact.phone?<><span style={{fontSize:11,color:'#64748b'}}>{cam.contact.phone}</span>{_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600,marginLeft:4}}>Sends directly</span>}</>:<span style={{fontSize:11,color:'#dc2626'}}>No phone on file</span>}
              </label>
            </div>}

            {/* ── Portal Link ── */}
            {cam.portalUrl&&<div style={{marginBottom:14}}>
              <div className="form-label" style={{fontSize:11}}>Portal Link</div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <input className="form-input" readOnly value={cam.portalUrl} style={{flex:1,fontSize:11,background:'#f8fafc'}}/>
                <button className="btn btn-sm btn-secondary" onClick={()=>{navigator.clipboard?.writeText(cam.portalUrl).then(()=>nf('Portal link copied!')).catch(()=>{window.prompt('Copy:',cam.portalUrl)})}}>Copy Link</button>
              </div>
              <div style={{fontSize:10,color:'#64748b',marginTop:4}}>Coach can review and approve artwork directly from this link</div>
            </div>}
            {!cam.portalUrl&&<div style={{padding:10,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,marginBottom:14,fontSize:12,color:'#dc2626'}}>No portal link available — set the customer's alpha tag to enable the coach portal.</div>}

            {/* ── Message ── */}
            <div style={{marginBottom:12}}>
              <div className="form-label" style={{fontSize:11}}>Message</div>
              <textarea className="form-input" rows={6} value={cam.message} onChange={e=>setCoachApprovalModal(m=>({...m,message:e.target.value}))} style={{resize:'vertical',fontSize:12}}/>
            </div>
            {/* ── Follow-up ── */}
            <div style={{padding:10,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>Follow up</span>
              <select className="form-input" value={cam.followUpDays==null?7:cam.followUpDays} onChange={e=>setCoachApprovalModal(m=>({...m,followUpDays:parseInt(e.target.value)}))} style={{width:90,fontSize:12,padding:'4px 6px'}}>
                <option value={0}>Never</option>
                {[1,2,3,5,7,10,14,21,30].map(d=><option key={d} value={d}>in {d}</option>)}
              </select>
              {(cam.followUpDays==null?7:cam.followUpDays)>0&&<span style={{fontSize:12,color:'#6d28d9'}}>days if no response</span>}
            </div>
          </div>
          <div className="modal-footer" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button className="btn btn-secondary" onClick={()=>setCoachApprovalModal(null)}>Cancel</button>
            <button className="btn" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb)',color:'white',border:'none',fontWeight:700,padding:'8px 20px',opacity:(!cam.sendEmail&&!cam.sendText)||cam.sending?0.5:1}} disabled={(!cam.sendEmail&&!cam.sendText)||cam.sending||(cam.sendEmail&&allTargets.length===0)} onClick={doSendCoach}>
              {cam.sending?'Sending...':((cam.sendEmail&&cam.sendText)?'Send Email + Text':(cam.sendEmail?('Send Email to '+allTargets.length+' recipient'+(allTargets.length!==1?'s':'')):'Send Text'))}
            </button>
          </div>
        </div></div>
      })()}
      </>}

      // Draft jobs & wizard state
      const draftJobs=jobs.filter(j=>j.prod_status==='draft'||j._draft);
      const activeJobs=jobs.filter(j=>j.prod_status!=='draft'&&!j._draft);
      const DECO_LABELS_W={screen_print:'Screen Print',embroidery:'Embroidery',heat_transfer:'Heat Transfer',dtg:'DTG',sublimation:'Sublimation',vinyl:'Vinyl',patch:'Patch'};
      const openJobWizard=()=>{
        // Only wizard-load jobs that still need art submission. Already-submitted
        // jobs (art_requested / waiting_approval / art_complete / etc.) are
        // preserved untouched and stay visible in the Jobs list.
        const existingJobs=safeJobs(o).filter(j=>j.art_status==='needs_art');
        // If needs_art jobs exist, rebuild wizard groups from them (respecting splits)
        if(existingJobs.length>0){
          const groups=existingJobs.map(j=>{
            const items=(j.items||[]).map(ji=>{
              const it=safeItems(o)[ji.item_idx];
              const af2=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);
              return{item_idx:ji.item_idx,deco_idx:ji.deco_idx,deco_idxs:Array.isArray(ji.deco_idxs)&&ji.deco_idxs.length?ji.deco_idxs:(ji.deco_idx!=null?[ji.deco_idx]:[]),sku:ji.sku||it?.sku||'',name:ji.name||safeStr(it?.name),color:ji.color||it?.color||'',
                units:ji.units||Object.values(safeSizes(it||{})).reduce((a,v)=>a+v,0),fulfilled:ji.fulfilled||0,art_file_id:j.art_file_id,
                art_name:af2?.name||j.art_name||'',position:j.positions||'Front Center'};
            });
            return{name:j.art_name||j.deco_type.replace(/_/g,' '),deco_type:j.deco_type,items,
              artist:j.assigned_artist||'',notes:j.rep_notes||'',files:[],
              _split:!!j.split_from,_existingJobId:j.id,_merged:!!j._merged};
          });
          setJobWizard({groups});
          return;
        }
        // No existing jobs — build groups from all decorated items, grouped by deco type
        const dtMap={};
        safeItems(o).forEach((it,idx)=>{
          if(it.no_deco)return;
          safeDecos(it).forEach((d,di)=>{
            if(d.kind!=='art'||!d.art_file_id)return;
            const af2=safeArr(o?.art_files).find(f=>f.id===d.art_file_id);
            const dt=af2?.deco_type||d.deco_type||'screen_print';
            if(!dtMap[dt])dtMap[dt]={name:DECO_LABELS_W[dt]||dt.replace(/_/g,' '),deco_type:dt,items:[]};
            dtMap[dt].items.push({item_idx:idx,deco_idx:di,sku:it.sku,name:safeStr(it.name),color:it.color||'',
              units:Object.values(safeSizes(it)).reduce((a,v)=>a+v,0),fulfilled:0,art_file_id:d.art_file_id,
              art_name:af2?.name||'',position:d.position||'Front Center'});
          });
        });
        setJobWizard({groups:Object.values(dtMap)});
      };
      const wizActivate=(groups,activateAll)=>{
        // Block art submission when reversible Numbers decos are missing their
        // Pantone ink colors — the artist needs to see both sides' colors.
        if(activateAll){
          const missing=[];
          groups.forEach(g=>{
            g.items.filter(it=>!it._excluded).forEach(it=>{
              const item=safeItems(o)[it.item_idx];if(!item)return;
              safeDecos(item).forEach(d=>{
                if(d.kind==='numbers'&&d.reversible&&(!d.print_color||!d.print_color_b)){
                  const label=(item.sku||('Item '+(it.item_idx+1)))+(item.color?' ('+item.color+')':'');
                  if(!missing.includes(label))missing.push(label);
                }
              });
            });
          });
          if(missing.length>0){
            nf('Cannot submit to art — set both Pantone ink colors on reversible Numbers for: '+missing.join(', '));
            return;
          }
        }
        // Preserve already-submitted jobs (anything past needs_art) so re-running
        // the wizard doesn't wipe their art_requests, prod state, etc.
        // When the wizard was launched for a single job (scopeJobId), only that job
        // is being set up — preserve every OTHER job (including other needs_art ones)
        // so they aren't dropped and regenerated.
        const _scopeId=jobWizard?.scopeJobId;
        const preservedJobs=_scopeId
          ?safeJobs(o).filter(jj=>jj.id!==_scopeId)
          :safeJobs(o).filter(jj=>jj.art_status!=='needs_art');
        const wizArtistsAll=REPS.filter(r=>r.role==='art'||r.role==='artist').filter(r=>r.is_active!==false);
        const newJobs=[];
        let releasedItemCount=0,heldItemCount=0;
        groups.forEach((g,gi)=>{
          // Only items the user actually wants to submit are included in the new
          // job. Excluded items stay behind — syncJobs will regenerate a
          // needs_art auto-job for them on the next render.
          const releaseItems=g.items.filter(it=>!it._excluded);
          heldItemCount+=g.items.length-releaseItems.length;
          if(releaseItems.length===0)return;
          releasedItemCount+=releaseItems.length;
          const artIds=[...new Set(releaseItems.map(it=>it.art_file_id).filter(Boolean))];
          const allApproved=artIds.every(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&af2.status==='approved'});
          const allProdFiles=artIds.every(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&artProdFilesReady(af2)});
          const anyUploaded=artIds.some(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&(af2.status==='uploaded'||af2.status==='needs_approval')});
          const _actDeco=(safeArt(o).find(f=>f.id===artIds[0])?.deco_type)||'';
          let artStatus=allApproved&&allProdFiles?'art_complete':allApproved?prodFilesStatusFor(_actDeco):anyUploaded?'waiting_approval':'needs_art';
          // Skip artist — rep approved the art directly
          if(g.skipArtist&&activateAll){artStatus='art_complete'}
          // Quick mock — rep built the mockup themselves; send to coach for approval,
          // skipping the artist on the mockup phase. Artist still does separations after approval.
          if(g.quickMock&&activateAll){artStatus='waiting_approval'}
          // When releasing for art with an assigned artist, create a proper art request
          const hasArtist=activateAll&&g.artist&&!g.skipArtist&&!g.quickMock;
          const allArtTbd=artIds.length===0||artIds.every(aid=>aid==='__tbd');
          const autoArtRequest=activateAll&&!g.skipArtist&&!g.quickMock&&artStatus==='needs_art'&&!allArtTbd;
          if(autoArtRequest)artStatus='art_requested';
          const totalUnits=releaseItems.reduce((a,it)=>a+it.units,0);
          const positions=[...new Set(releaseItems.map(it=>it.position))].join(', ');
          const artistObj=hasArtist?wizArtistsAll.find(a=>a.id===g.artist):null;
          // Reuse existing job id when re-releasing a previously-loaded needs_art job
          const baseIdNum=gi+1+preservedJobs.length;
          const jobId=g._existingJobId||(o.id.replace('SO-','JOB-')+'-'+(baseIdNum<10?'0':'')+baseIdNum);
          // Suffix the job key so syncJobs doesn't merge unsubmitted items with
          // the released signature (which would otherwise re-pollute this job).
          const jobKey='released_'+g.deco_type+'_'+jobId;
          newJobs.push({
            id:jobId,
            key:jobKey,
            art_file_id:artIds[0]||null,_art_ids:artIds,
            art_name:g.name,deco_type:g.deco_type,positions,
            art_status:artStatus,item_status:'need_to_order',
            prod_status:activateAll?'hold':'draft',
            ship_method:o.ship_preference==='rep_delivery'?'rep_delivery':'ship_customer',
            total_units:totalUnits,fulfilled_units:0,split_from:null,
            // Mark as released so syncJobs preserves it and skips its items
            _released:activateAll?true:false,
            ...(g._merged?{_merged:true}:{}),
            created_at:new Date().toLocaleDateString(),
            ...(g.quickMock&&activateAll?{sent_to_coach_at:new Date().toISOString(),quick_mock:true}:{}),
            assigned_artist:g.artist||'',
            rep_notes:g.notes||'',
            ...(autoArtRequest?{art_requests:[{id:'AR-'+Date.now()+'-'+gi,artist:g.artist||'',artist_name:artistObj?.name||'',instructions:g.notes||'Requested on release',files:g.files||[],status:'requested',created_at:new Date().toISOString(),created_by:cu?.name||'System',auto:false}]}:{}),
            items:releaseItems.map(({item_idx,deco_idx,deco_idxs,sku,name,color,units,fulfilled})=>({item_idx,deco_idx,deco_idxs:Array.isArray(deco_idxs)&&deco_idxs.length?deco_idxs:(deco_idx!=null?[deco_idx]:[]),sku,name,color,units,fulfilled:fulfilled||0}))
          });
        });
        // Store rep's sample art files on the art file records (separate from artist mockups)
        // For skip-artist jobs, also promote sample art to mockup_files and mark art as approved
        let updArtFiles=[...safeArt(o)];
        let njCursor=0;
        groups.forEach(g=>{
          const releaseItems=g.items.filter(it=>!it._excluded);
          if(releaseItems.length===0)return;
          const nj=newJobs[njCursor++];
          if(!nj)return;
          const repFiles=g.files||[];
          const artIds=nj._art_ids||[nj.art_file_id].filter(Boolean);
          if(repFiles.length>0){
            artIds.forEach(aid=>{
              updArtFiles=updArtFiles.map(a=>a.id===aid?{...a,sample_art:[...(a.sample_art||[]),...repFiles]}:a);
            });
          }
          // Skip artist: promote sample art to mockups and mark art file as approved
          if(g.skipArtist&&activateAll){
            artIds.forEach(aid=>{
              updArtFiles=updArtFiles.map(a=>{
                if(a.id!==aid)return a;
                const existingMocks=a.mockup_files||[];
                const newMocks=repFiles.length>0&&existingMocks.length===0?repFiles:existingMocks;
                return{...a,mockup_files:newMocks,status:'approved'};
              });
            });
          }
          // Quick mock: persist the rep-built mockups (per garment color) and the source art
          // files onto the artwork records, then mark them pending the coach's approval.
          if(g.quickMock&&activateAll){
            const mocksByGarment=g.qmMocks||{};// {sku|color:[{url,name,sku}]}
            const filesByLocation=g.qmFiles||{};// {artFileId:[{name,url,size,type}]}
            const realArtIds=artIds.filter(aid=>aid&&aid!=='__tbd');
            let targetIds=realArtIds;
            // No real artwork record yet — create one so the mockups have somewhere to live.
            if(targetIds.length===0){
              const newAf={id:'af'+Date.now()+'-qm',name:g.name||'Quick Mock',deco_type:g.deco_type,ink_colors:'',thread_colors:'',art_size:'',color_ways:[],files:[],mockup_files:[],item_mockups:{},sample_art:[],prod_files:[],preview_url:'',notes:'',status:'needs_approval',uploaded:new Date().toLocaleDateString()};
              updArtFiles=[...updArtFiles,newAf];
              targetIds=[newAf.id];
              nj.art_file_id=newAf.id;nj._art_ids=[newAf.id];
            }
            const primaryId=targetIds[0];
            updArtFiles=updArtFiles.map(a=>{
              if(!targetIds.includes(a.id))return a;
              let upd={...a,status:'needs_approval'};
              // Attach each location's source file to its own artwork so it persists for separations.
              const locFiles=filesByLocation[a.id]||[];
              if(locFiles.length>0)upd.files=[...(a.files||[]),...locFiles];
              // Composite per-color mockups live on the job's primary artwork.
              if(a.id===primaryId){
                const im={...(a.item_mockups||{})};
                Object.entries(mocksByGarment).forEach(([key,arr])=>{
                  if(!arr||!arr.length)return;
                  const tagged=arr.map(m=>({...m,art_file_id:primaryId}));
                  im[key]=[...(im[key]||[]),...tagged];
                });
                upd.item_mockups=im;
                if(g.qmScene)upd.qm_scenes={...(a.qm_scenes||{}),...g.qmScene};
              }
              return upd;
            });
          }
        });
        const updated={...o,jobs:[...preservedJobs,...newJobs],art_files:updArtFiles,updated_at:new Date().toLocaleString()};
        setO(updated);onSave(updated);setDirty(false);setJobWizard(null);
        const artSent=activateAll?newJobs.filter(j=>j.art_status==='art_requested'&&(j.art_requests||[]).length>0).length:0;
        const artSkipped=activateAll?newJobs.filter(j=>j.art_status==='art_complete').length:0;
        const quickMocked=activateAll?newJobs.filter(j=>j.quick_mock).length:0;
        const msgs=[];if(artSent>0)msgs.push(artSent+' art job'+(artSent!==1?'s':'')+' sent to Art Dashboard');if(quickMocked>0)msgs.push(quickMocked+' quick mock'+(quickMocked!==1?'s':'')+' sent to coach for approval');if(artSkipped>0)msgs.push(artSkipped+' job'+(artSkipped!==1?'s':'')+' marked art complete');
        if(heldItemCount>0)msgs.push(heldItemCount+' item'+(heldItemCount!==1?'s':'')+' kept on hold');
        nf(activateAll?(msgs.length>0?'Jobs released! '+msgs.join(', '):'Jobs released for art!'):'Draft jobs saved — activate when ready');
      };

      // Job Setup Wizard Modal
      const wizArtists=REPS.filter(r=>r.role==='art'||r.role==='artist').filter(r=>r.is_active!==false);
      if(jobWizard)return<div className="card"><div className="card-header" style={{background:'linear-gradient(135deg,#7c3aed,#a78bfa)',color:'white'}}>
        <h2 style={{color:'white',margin:0}}>Job Setup Wizard</h2>
      </div><div className="card-body" style={{padding:16}}>
        <div style={{fontSize:12,color:'#64748b',marginBottom:10}}>Organize items into production jobs. Items are grouped by decoration type. Confirm grouping, split if needed, and assign an artist with notes for each job before releasing. Uncheck any items you want to keep on hold — they'll stay in the Jobs list as "Needs Art" and can be submitted later.</div>
        {(()=>{const totItems=jobWizard.groups.reduce((a,g)=>a+g.items.length,0);const incItems=jobWizard.groups.reduce((a,g)=>a+g.items.filter(it=>!it._excluded).length,0);const setAll=on=>setJobWizard(w=>({...w,groups:w.groups.map(g=>({...g,items:g.items.map(it=>({...it,_excluded:!on}))}))}));return<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,fontSize:11,color:'#475569'}}>
          <span style={{fontWeight:600}}>{incItems} of {totItems} items selected</span>
          <button className="btn btn-sm" style={{fontSize:10,padding:'3px 10px',background:'#f1f5f9',border:'1px solid #cbd5e1',borderRadius:4,color:'#1e40af',fontWeight:600,cursor:'pointer'}} onClick={()=>setAll(true)}>Select All</button>
          <button className="btn btn-sm" style={{fontSize:10,padding:'3px 10px',background:'#f1f5f9',border:'1px solid #cbd5e1',borderRadius:4,color:'#475569',fontWeight:600,cursor:'pointer'}} onClick={()=>setAll(false)}>Deselect All</button>
        </div>})()}
        {/* Single artist selector — applies to all non-skip groups in this submission */}
        {(()=>{const nonSkip=jobWizard.groups.filter(g=>!g.skipArtist&&!g.quickMock&&g.items.some(it=>!it._excluded));if(nonSkip.length===0)return null;const distinct=[...new Set(nonSkip.map(g=>g.artist||''))];const cur=distinct.length===1?distinct[0]:'';return<div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:10,background:'#faf5ff',borderRadius:6,border:'1px solid #e9d5ff'}}>
          <div style={{fontSize:11,fontWeight:700,color:'#6d28d9',whiteSpace:'nowrap'}}>Artist *</div>
          <select className="form-select" style={{fontSize:12,minWidth:220,flex:1,maxWidth:320}} value={cur} onChange={e=>{const v=e.target.value;setJobWizard(w=>({...w,groups:w.groups.map(g=>(g.skipArtist||g.quickMock)?g:({...g,artist:v}))}))}}>
            <option value="">Select artist...</option>
            {wizArtists.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span style={{fontSize:10,color:'#6d28d9'}}>Applied to all jobs in this submission. Per-job notes and reference files are below.</span>
        </div>})()}
        {jobWizard.groups.map((g,gi)=><div key={gi} style={{padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:700,color:'white',background:'#7c3aed',padding:'2px 8px',borderRadius:4,textTransform:'uppercase'}}>{g.deco_type.replace(/_/g,' ')}</span>
            <input className="form-input" value={g.name} style={{fontSize:13,fontWeight:700,padding:'4px 8px',flex:1}}
              onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],name:e.target.value};setJobWizard({...jobWizard,groups:gs})}}/>
            {(()=>{const incU=g.items.filter(it=>!it._excluded).reduce((a,it)=>a+it.units,0);const totU=g.items.reduce((a,it)=>a+it.units,0);return<span style={{fontSize:11,fontWeight:700,color:'#475569'}}>{incU===totU?totU+' units':incU+' / '+totU+' units'}</span>})()}
            {jobWizard.groups.length>1&&g.items.length===0&&<button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:14,fontWeight:700}}
              onClick={()=>{const gs=[...jobWizard.groups];gs.splice(gi,1);setJobWizard({...jobWizard,groups:gs})}}>×</button>}
          </div>
          {g.items.length===0?<div style={{padding:12,textAlign:'center',color:'#94a3b8',fontSize:11}}>No items — drag items here or remove this group</div>:
          <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #e2e8f0'}}>
              <th style={{padding:'3px 6px',textAlign:'center',fontSize:10,color:'#64748b',width:24}} title="Include in this submission">
                <input type="checkbox" style={{width:13,height:13,cursor:'pointer'}}
                  checked={g.items.length>0&&g.items.every(it=>!it._excluded)}
                  ref={el=>{if(el)el.indeterminate=g.items.some(it=>!it._excluded)&&g.items.some(it=>it._excluded)}}
                  onChange={e=>{const on=e.target.checked;const gs=[...jobWizard.groups];gs[gi]={...gs[gi],items:gs[gi].items.map(it=>({...it,_excluded:!on}))};setJobWizard({...jobWizard,groups:gs})}}/>
              </th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>SKU</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Item</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Art</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Art Location</th>
              <th style={{padding:'3px 6px',textAlign:'center',fontSize:10,color:'#64748b'}}>Units</th>
              <th style={{padding:'3px 6px',textAlign:'right',fontSize:10,color:'#64748b'}}></th>
            </tr></thead>
            <tbody>{g.items.map((it,ii)=><tr key={ii} style={{borderBottom:'1px solid #f1f5f9',opacity:it._excluded?0.4:1}}>
              <td style={{padding:'3px 6px',textAlign:'center'}}>
                <input type="checkbox" style={{width:13,height:13,cursor:'pointer'}} checked={!it._excluded}
                  onChange={e=>{const gs=[...jobWizard.groups];const items=[...gs[gi].items];items[ii]={...items[ii],_excluded:!e.target.checked};gs[gi]={...gs[gi],items};setJobWizard({...jobWizard,groups:gs})}}/>
              </td>
              <td style={{padding:'3px 6px',fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{it.sku}</td>
              <td style={{padding:'3px 6px'}}>{it.name} <span style={{color:'#94a3b8'}}>{it.color}</span></td>
              <td style={{padding:'3px 6px',fontSize:10,color:it.art_name?'#1e40af':'#94a3b8',fontWeight:it.art_name?600:400}}>{it.art_name||'—'}</td>
              <td style={{padding:'3px 6px',fontSize:10}}><span style={{background:'#ede9fe',color:'#6d28d9',padding:'1px 6px',borderRadius:3,fontWeight:600}}>{it.position}</span></td>
              <td style={{padding:'3px 6px',textAlign:'center',fontWeight:700}}>{it.units}</td>
              <td style={{padding:'3px 6px',textAlign:'right'}}>
                {g.items.length>1?<button style={{fontSize:9,padding:'2px 8px',background:'#f1f5f9',border:'1px solid #d1d5db',borderRadius:4,cursor:'pointer',fontWeight:600,color:'#475569'}} onClick={()=>{
                  const gs=jobWizard.groups.map(gg=>({...gg,items:[...gg.items]}));
                  gs[gi].items.splice(ii,1);
                  gs.push({name:it.art_name||'New Job',deco_type:g.deco_type,items:[it],_split:true,artist:'',notes:'',files:[]});
                  setJobWizard({...jobWizard,groups:gs});
                }}>Split</button>:g._split?<button style={{fontSize:9,padding:'2px 8px',background:'#ede9fe',border:'1px solid #c4b5fd',borderRadius:4,cursor:'pointer',fontWeight:600,color:'#6d28d9'}} onClick={()=>{
                  const gs=jobWizard.groups.map(gg=>({...gg,items:[...gg.items]}));
                  const mainGi=gs.findIndex(gg=>gg.deco_type===g.deco_type&&!gg._split);
                  if(mainGi>=0){gs[mainGi].items.push(it);gs.splice(gi,1)}
                  setJobWizard({...jobWizard,groups:gs});
                }}>Merge Back</button>:null}
              </td>
            </tr>)}</tbody>
          </table>}
          {/* Per-job artist selection and notes */}
          {g.items.length>0&&(()=>{const qmCount=Object.values(g.qmMocks||{}).filter(a=>(a||[]).length>0).length;const greenMode=g.skipArtist||g.quickMock;return<div style={{marginTop:10,padding:10,background:greenMode?'#f0fdf4':'white',borderRadius:6,border:'1px solid '+(greenMode?'#86efac':'#e2e8f0')}}>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:5,textTransform:'uppercase',letterSpacing:0.4}}>How should art be handled for this job?</div>
              <div style={{display:'flex',gap:6}}>
                {[{k:'artist',label:'Send to Artist',desc:'Artist builds the mockup',accent:'#7c3aed',bg:'#faf5ff',txt:'#6d28d9'},
                  {k:'skip',label:'Skip Artist',desc:'Art already approved',accent:'#16a34a',bg:'#f0fdf4',txt:'#166534'},
                  {k:'quick',label:'⚡ Quick Mock',desc:"I'll build it myself",accent:'#16a34a',bg:'#f0fdf4',txt:'#166534'}].map(opt=>{
                  const active=(opt.k==='skip'&&g.skipArtist)||(opt.k==='quick'&&g.quickMock)||(opt.k==='artist'&&!g.skipArtist&&!g.quickMock);
                  return<button key={opt.k} type="button" onClick={()=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],skipArtist:opt.k==='skip',quickMock:opt.k==='quick'};setJobWizard({...jobWizard,groups:gs})}}
                    style={{flex:1,padding:'8px 10px',borderRadius:8,border:'2px solid '+(active?opt.accent:'#e2e8f0'),background:active?opt.bg:'#fff',cursor:'pointer',textAlign:'left',transition:'all 0.12s'}}>
                    <div style={{fontSize:12,fontWeight:800,color:active?opt.txt:'#475569'}}>{opt.label}</div>
                    <div style={{fontSize:10,color:active?opt.accent:'#94a3b8',marginTop:1}}>{opt.desc}</div>
                  </button>;
                })}
              </div>
            </div>
            {g.skipArtist&&<div style={{fontSize:10,color:'#166534',marginBottom:8,marginLeft:2}}>Art status will be set to complete. Upload sample art below if you have files to attach.</div>}
            {g.quickMock&&<div style={{marginBottom:8,padding:10,background:'#f0fdf4',borderRadius:6,border:'1px solid #bbf7d0'}}>
              <div style={{fontSize:10,color:'#166534',marginBottom:6}}>Build a mockup per garment color and send it straight to the coach for approval. Your source art stays on each artwork — the artist still makes separation files after approval.</div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <button className="btn btn-sm" style={{fontSize:11,background:'#7c3aed',color:'white',border:'none',padding:'6px 14px',fontWeight:700}} onClick={()=>{
                  const seenImg=new Set();
                  g.items.filter(it=>!it._excluded).forEach(it=>{const full=safeItems(o)[it.item_idx];if(!full)return;const k=(full.sku||'')+'|'+(full.color||'');if(seenImg.has(k))return;seenImg.add(k);fetchVendorImage(full.sku,full.color,full.vendor_id,full)});
                  setMockBuilder({gi});
                }}>{qmCount>0?'Edit Mockups':'⚡ Build Mockups'}</button>
                {(()=>{const colors=[...new Set(g.items.filter(it=>!it._excluded).map(it=>it.sku+'|'+(it.color||'')))].length;return<span style={{fontSize:11,color:qmCount>0?'#166534':'#d97706',fontWeight:700}}>{qmCount}/{colors} color{colors===1?'':'s'} mocked{qmCount===0?' — none yet':''}</span>})()}
              </div>
            </div>}
            {!g.skipArtist&&!g.quickMock&&<div>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>Notes for Artist</div>
              <textarea className="form-input" rows={2} style={{fontSize:11,width:'100%',resize:'vertical'}} placeholder="Mockup details, color notes, placement instructions..." value={g.notes||''} onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],notes:e.target.value};setJobWizard({...jobWizard,groups:gs})}}/>
            </div>}
            {!g.quickMock&&<div style={{marginTop:6}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>Sample Art / Reference Files</div>
              {(()=>{const uploadFiles=async(fileList)=>{for(const f of Array.from(fileList||[])){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');const gs=[...jobWizard.groups];gs[gi]={...gs[gi],files:[...(gs[gi].files||[]),{name:f.name,size:f.size,type:f.type,url}]};setJobWizard({...jobWizard,groups:gs})}catch(err){nf('Upload failed: '+err.message,'error')}}};
              return<div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',padding:'4px 6px',border:'1px dashed #cbd5e1',borderRadius:4,background:'#fafafa',transition:'border-color 0.15s, background 0.15s'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#7c3aed';e.currentTarget.style.background='#f5f3ff'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#fafafa'}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#fafafa';uploadFiles(e.dataTransfer.files)}}>
                <button style={{fontSize:10,padding:'3px 10px',background:'#f1f5f9',border:'1px solid #d1d5db',borderRadius:4,cursor:'pointer',color:'#475569',fontWeight:600}} onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.onchange=()=>uploadFiles(inp.files);inp.click()}}>+ Add Files</button>
                <span style={{fontSize:10,color:'#94a3b8'}}>or drop files here</span>
                {(g.files||[]).map((f,fi)=><span key={fi} style={{fontSize:10,padding:'2px 6px',background:'#ede9fe',borderRadius:3,color:'#6d28d9',fontWeight:600,display:'flex',alignItems:'center',gap:3}}>{f.name}<button style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:12,padding:0,lineHeight:1}} onClick={()=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],files:(gs[gi].files||[]).filter((_,i)=>i!==fi)};setJobWizard({...jobWizard,groups:gs})}}>×</button></span>)}
              </div>})()}
            </div>}
          </div>})()}
        </div>)}
        <div style={{display:'flex',gap:6,marginBottom:16}}>
          <button className="btn btn-sm btn-secondary" onClick={()=>{
            const gs=[...jobWizard.groups,{name:'New Job',deco_type:jobWizard.groups[0]?.deco_type||'screen_print',items:[],artist:'',notes:'',files:[]}];
            setJobWizard({...jobWizard,groups:gs});
          }}>+ Add Group</button>
        </div>
        {(()=>{const activeGroups=jobWizard.groups.filter(g=>g.items.some(it=>!it._excluded));const qmReady=g=>Object.values(g.qmMocks||{}).filter(a=>(a||[]).length>0).length>0;const allReady=activeGroups.length>0&&activeGroups.every(g=>g.skipArtist||(g.quickMock?qmReady(g):g.artist));const notReady=!allReady;const qmPending=activeGroups.some(g=>g.quickMock&&!qmReady(g));
          return<div style={{display:'flex',gap:8,borderTop:'1px solid #e2e8f0',paddingTop:12,alignItems:'center'}}>
          <button className="btn btn-primary" style={{background:'#166534',borderColor:'#166534',fontWeight:800,opacity:notReady?0.5:1}} disabled={notReady}
            onClick={()=>wizActivate(jobWizard.groups,true)}>Release Jobs for Art</button>
          <button className="btn btn-secondary" style={{fontWeight:700}}
            onClick={()=>wizActivate(jobWizard.groups,false)}>Save as Drafts</button>
          <button className="btn btn-secondary" onClick={()=>setJobWizard(null)}>Cancel</button>
          {notReady&&<span style={{fontSize:11,color:'#dc2626',fontWeight:600}}>{qmPending?'Build at least one mockup for each Quick Mock job':'Select an artist, "Skip Artist", or "Quick Mock" for each job'}</span>}
        </div>})()}
        {mockBuilder&&(()=>{
          const g=jobWizard.groups[mockBuilder.gi];if(!g)return null;
          const rel=g.items.filter(it=>!it._excluded);
          const _back=full=>{const prd=products.find(pp=>pp.id===full?.product_id||pp.sku===full?.sku);return prd?.back_image_url||(prd?.images&&prd.images[1])||full?._colorBackImage||_vImg(full,'back')||''};
          const garments=[];const seenG=new Set();
          rel.forEach(it=>{const key=it.sku+'|'+(it.color||'');if(seenG.has(key))return;seenG.add(key);const full=safeItems(o)[it.item_idx];const front=_itemImg(full),back=_back(full);const vendorItem=!!(full&&(isSSItem(full)||isSanMarItem(full)||isMomentecItem(full)));const vKey=it.sku+'|'+(it.color||'').toLowerCase();const pending=vendorItem&&!front&&vendorImgs[vKey]===undefined;garments.push({key,sku:it.sku,color:it.color||'',name:it.name||'',frontUrl:front,backUrl:back,pending})});
          const locations=[];const seenL=new Set();
          const _renderable=f=>{const u=typeof f==='string'?f:(f?.url||'');return !!u&&(_isImgUrl(u)||/\.svg(\?|$)/i.test(u))};
          // One location per distinct artwork on the included items. An item can carry several
          // art decorations (e.g. front + back), so scan the items' decorations rather than the
          // group's single art reference — otherwise a second piece of art wouldn't show up.
          rel.forEach(it=>{const full=safeItems(o)[it.item_idx];if(!full)return;
            safeDecos(full).forEach(d=>{
              if(d.kind!=='art'||!d.art_file_id||d.art_file_id==='__tbd')return;
              const aid=d.art_file_id;if(seenL.has(aid))return;
              const art=safeArt(o).find(a=>a.id===aid);
              if(art&&art.deco_type&&art.deco_type!==g.deco_type)return;// keep this job's deco type only
              seenL.add(aid);
              // Source art a rep already attached lives in prod_files (Art Library uploads) and files.
              const _onfile=(art?[...(art.files||[]),...(art.prod_files||[])]:[]).filter(f=>typeof f==='string'||f?.url);
              // Build a previewable source for one file: a renderable image/SVG as-is, else rasterize an .ai/.eps/.pdf to PNG.
              const _filePreview=f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u)return null;if(_renderable(f))return{url:u};if(u.includes('cloudinary.com')&&/\.(ai|eps|pdf)(\?|$)/i.test(u)){const png=_cloudinaryPdfThumb(u);if(png)return{url:png,vectorSrc:u}}return null};
              const _fileName=f=>{const u=typeof f==='string'?f:(f?.url||'');return (typeof f!=='string'&&f?.name)||u.split('?')[0].split('/').pop()||'art'};
              // Every previewable attachment, so the rep can flip between the files on this artwork in the mock builder.
              const files=[];const _seenF=new Set();
              [art?.preview_url,...(art?.mockup_files||[]),..._onfile].forEach(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seenF.has(u))return;const pv=_filePreview(f);if(!pv)return;_seenF.add(u);files.push({name:_fileName(f),url:u,preview:pv})});
              const preview=files.length?files[0].preview:null;
              locations.push({artFileId:aid,name:art?.name||it.art_name||DECO_LABELS_W[g.deco_type]||g.name,position:d.position||'',existingFiles:_onfile,files,preview});
            });});
          return<QuickMockBuilder garments={garments} locations={locations} initialMocks={g.qmMocks} initialScene={g.qmScene} initialFiles={g.qmFiles} nf={nf}
            onClose={()=>setMockBuilder(null)}
            onSave={({mocksByGarment,filesByLocation,sceneByGarment})=>{const gs=[...jobWizard.groups];gs[mockBuilder.gi]={...gs[mockBuilder.gi],qmMocks:mocksByGarment,qmFiles:filesByLocation,qmScene:sceneByGarment};setJobWizard({...jobWizard,groups:gs});setMockBuilder(null);nf('Mockups attached — release the job to send to the coach')}}/>;
        })()}
      </div></div>;

      // Draft jobs banner
      const hasDrafts=draftJobs.length>0;

      return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2>Production Jobs ({activeJobs.length}{hasDrafts?' + '+draftJobs.length+' drafts':''})</h2>
        <div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm" style={{fontSize:10,background:'#0891b2',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={refreshJobs} title="Rebuild jobs from current line items & decorations — picks up newly added items. Keeps merges, splits & submitted art.">🔄 Sync Jobs</button>
          {jobs.some(j=>j.art_status==='needs_art')&&<button className="btn btn-sm" style={{fontSize:10,background:'#7c3aed',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={openJobWizard}>Submit to Art</button>}
          {jobs.length>1&&!mergeMode&&<button className="btn btn-sm" style={{fontSize:10,background:'#1e40af',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={()=>setMergeMode({selected:[]})}>Merge Jobs</button>}
          {mergeMode&&<><button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} disabled={mergeMode.selected.length<2} onClick={()=>{
            const sel=mergeMode.selected.sort((a,b)=>a-b);const target=jobs[sel[0]];const allItems=[...(target.items||[])];
            sel.slice(1).forEach(ji=>{const mj=jobs[ji];allItems.push(...(mj.items||[]))});
            const mergeItems=_mergeJobItems(allItems);
            const mergeUnits=mergeItems.reduce((a,gi)=>a+safeNum(gi.units),0);
            const mergeFulfilled=mergeItems.reduce((a,gi)=>a+safeNum(gi.fulfilled),0);
            // Merging combines items only — it doesn't submit or finish art. Keep the
            // least-complete art_status across the merged jobs so a finished job can't
            // mask others that still need art (which would hide the Submit to Art button).
            const _artRank={needs_art:0,art_requested:1,art_in_progress:2,waiting_approval:3,production_files_needed:4,order_dtf_transfers:4,upload_emb_files:4,art_complete:5};
            const _mergedArtStatus=sel.reduce((worst,ji)=>{const st=jobs[ji].art_status;return (_artRank[st]??0)<(_artRank[worst]??0)?st:worst;},target.art_status);
            const merged={...target,items:mergeItems,total_units:mergeUnits,fulfilled_units:mergeFulfilled,art_status:_mergedArtStatus,_merged:true};
            const removeIdxs=new Set(sel.slice(1));const newJobs=jobs.map((j,i)=>i===sel[0]?merged:j).filter((j,i)=>!removeIdxs.has(i));
            const updated={...o,jobs:newJobs,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setMergeMode(null);
            nf('Merged '+sel.length+' jobs into '+target.id);
          }}>Merge {mergeMode.selected.length} Selected</button>
          <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>setMergeMode(null)}>Cancel</button></>}
        </div>
      </div><div className="card-body" style={{padding:0}}>
        {mergeMode&&<div style={{padding:'8px 16px',background:'#dbeafe',borderBottom:'1px solid #93c5fd',fontSize:12,color:'#1e40af',fontWeight:600}}>Select 2 or more jobs of the same type to merge together. Items will be combined into the first selected job.</div>}
        {hasDrafts&&<div style={{padding:'10px 16px',background:'#fef9c3',borderBottom:'1px solid #fde68a',display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:'#a16207'}}>{draftJobs.length} draft job{draftJobs.length!==1?'s':''} need review</span>
          <span style={{fontSize:11,color:'#92400e'}}>— Draft jobs won't appear on the production board until activated</span>
          <button className="btn btn-sm" style={{marginLeft:'auto',fontSize:10,background:'#166534',color:'white',border:'none',padding:'4px 12px',fontWeight:700}}
            onClick={()=>{const newJobs=jobs.map(j=>{if(j.prod_status!=='draft'&&!j._draft)return j;
              return{...j,prod_status:'hold',_draft:false}});
              const updated={...o,jobs:newJobs,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('All draft jobs activated! Use the wizard to release jobs for art with artist assignments.')}}>Activate All</button>
          <button className="btn btn-sm" style={{fontSize:10,background:'#7c3aed',color:'white',border:'none',padding:'4px 10px',fontWeight:700}} onClick={openJobWizard}>Edit Jobs</button>
        </div>}
        {jobs.length===0&&<div style={{padding:24,textAlign:'center',color:'#94a3b8'}}>No decorations assigned yet. Add artwork to items — jobs will populate automatically, then click "Submit to Art" when ready.</div>}
        {jobs.length>0&&<table style={{fontSize:12}}><thead><tr>{mergeMode&&<th style={{width:30}}></th>}<th>Job ID</th><th>Artwork / Decoration</th><th>Items</th><th>Units</th><th>Items Status</th><th>Art</th><th>Production</th><th></th></tr></thead><tbody>
          {jobs.map((j,ji)=>{
            const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';const canOverride2=cu.role==='admin'||cu.role==='super_admin'||cu.role==='production'||cu.role==='prod_manager'||cu.role==='gm';
            const canSplit=(j.items||[]).length>0&&j.total_units>1;
            const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
            const isMergeSel=mergeMode&&mergeMode.selected.includes(ji);
            return<React.Fragment key={j.id}>
              <tr id={'so-job-'+ji} style={{background:isMergeSel?'#dbeafe':j.prod_status==='completed'||j.prod_status==='shipped'?'#f0fdf4':undefined,cursor:'pointer',transition:'box-shadow 0.3s'}} onClick={()=>mergeMode?setMergeMode({selected:isMergeSel?mergeMode.selected.filter(x=>x!==ji):[...mergeMode.selected,ji]}):setSelJob(ji)}>
              {mergeMode&&<td onClick={e=>e.stopPropagation()}><input type="checkbox" checked={!!isMergeSel} onChange={()=>setMergeMode({selected:isMergeSel?mergeMode.selected.filter(x=>x!==ji):[...mergeMode.selected,ji]})}/></td>}
              <td><span style={{fontWeight:700,color:'#1e40af'}}>{j.id}</span>
                {j.split_from&&<div style={{fontSize:9,color:'#7c3aed'}}>split from {j.split_from}</div>}
                {j.counted_at&&<div style={{fontSize:9,color:'#166534'}}>✅ counted</div>}</td>
              <td><div style={{display:'flex',gap:6,alignItems:'center'}}><span style={{fontWeight:600}}>{j.art_name}</span>{(()=>{const afs=j.art_file_id&&af.find(a=>a.id===j.art_file_id);const fSt=afs?(afs.status==='uploaded'?'needs_approval':afs.status||'waiting_for_art'):null;return fSt?<span style={{padding:'1px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:ART_FILE_SC[fSt]?.bg||'#f1f5f9',color:ART_FILE_SC[fSt]?.c||'#64748b'}}>{ART_FILE_LABELS[fSt]||fSt}</span>:null})()}</div>
                {(()=>{const firstGi=(j.items||[])[0];const jIt=firstGi?safeItems(o)[firstGi.item_idx]:null;
                  const jDecos=jIt?safeDecos(jIt).filter(d=>d.kind==='art'||d.kind==='numbers'):[];
                  if(jDecos.length>1)return<div style={{fontSize:10,color:'#64748b'}}>{jDecos.map((d,di)=>{
                    const artF2=d.art_file_id?af.find(a=>a.id===d.art_file_id):null;const dt=artF2?.deco_type||d.deco_type||'screen_print';
                    return<div key={di}>{dt.replace(/_/g,' ')} · {d.position||'—'}</div>}).reduce((a,v)=>[...a,v],[])}</div>;
                  return<div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>})()}</td>
              <td style={{fontSize:11}}>{(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</td>
              <td style={{fontWeight:700}}>{j.fulfilled_units}/{j.total_units}
                <div style={{width:50,background:'#e2e8f0',borderRadius:3,height:4,marginTop:2}}><div style={{height:4,borderRadius:3,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div></td>
              <td>{(()=>{const _is=jItemStatus(j);return<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[_is]?.bg,color:SC[_is]?.c}}>{itemLabels[_is]}</span>})()}</td>
              <td>{(()=>{const sentCust=j.art_status==='waiting_approval'&&j.sent_to_coach_at;const aLbl=sentCust?'Sent to Customer':(artLabels[j.art_status]||j.art_status);const aSt=sentCust?{bg:'#ede9fe',c:'#6d28d9'}:SC[j.art_status];return<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:aSt?.bg,color:aSt?.c}}>{aLbl}</span>})()}</td>
              <td>{(()=>{const readyForProd=j.prod_status==='hold'&&canProduce;const pSt=readyForProd?{bg:'#dcfce7',c:'#166534'}:(SC[j.prod_status]||{bg:'#f1f5f9',c:'#475569'});return<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:pSt.bg,color:pSt.c}}>{readyForProd?'Ready for Prod':(prodLabels[j.prod_status]||j.prod_status)}</span>})()}</td>
              <td style={{whiteSpace:'nowrap'}}>
                {onAssignTodo&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#0891b2',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();onAssignTodo({title:'Deco: '+(j.art_name||j.id),description:(j.deco_type||'').replace(/_/g,' ')+' · '+j.total_units+' units',so_id:isSO?o.id:'',customer_id:o.customer_id||'',priority:2,doc_label:j.id,wh_only:true})}} title="Assign this job to a warehouse worker">👤 Assign</button>}
                {(()=>{const _artIds4=j._art_ids||[j.art_file_id].filter(Boolean);if(_artIds4.length===0||(_artIds4.length===1&&_artIds4[0]==='__tbd'))return null;const hasActiveReqs=(j.art_requests||[]).some(r=>r.status!=='recalled');const hasAnyReqs=(j.art_requests||[]).length>0;const activeReq=(j.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
                  const artReturned=j.art_status==='waiting_approval';
                  return<>{hasActiveReqs&&activeReq&&<span style={{fontSize:8,padding:'1px 5px',borderRadius:8,fontWeight:700,background:artReturned?'#dbeafe':'#fef3c7',color:artReturned?'#1e40af':'#92400e',marginRight:3}}>{artReturned?'Returned':activeReq.status==='in_progress'?'In Progress':'Requested'}</span>}
                  {(hasActiveReqs||(j.art_status&&j.art_status!=='needs_art'))&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#dc2626',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();const artIds=j._art_ids||[j.art_file_id].filter(Boolean);const wasReleased=!!j._released;
                  // For wizard-released jobs, drop them entirely so syncJobs
                  // regenerates a fresh needs_art auto-job covering their items
                  // (which can then be re-submitted via the wizard).
                  const updJobs=wasReleased?safeJobs(o).filter((_,i2)=>i2!==ji):safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;return{...jj,art_status:'needs_art',art_requests:(jj.art_requests||[]).map(r=>['requested','in_progress','completed','waiting_approval'].includes(r.status)?{...r,status:'recalled'}:r),assigned_artist:''}});
                  const updArt=af.map(a=>artIds.includes(a.id)?{...a,status:'waiting_for_art'}:a);const updated={...o,jobs:updJobs,art_files:updArt,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art recalled — you can re-submit with new instructions')}} title="Recall art request and reset status">Recall Art</button>}
                  {hasAnyReqs&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#6d28d9',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();setArtReqModal({jIdx:ji,artist:j.assigned_artist||'',instructions:'',files:[]})}} title="Send updated instructions to artist">Update Art</button>}</>})()}
                {canSplit&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#7c3aed',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}} title="Split job">✂️ Split</button>}
                {j.split_from&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#1e40af',color:'white',borderRadius:4}} onClick={e=>{e.stopPropagation();const parentIdx=jobs.findIndex(pj=>pj.id===j.split_from);if(parentIdx<0){nf('Parent job '+j.split_from+' not found','error');return}const parent=jobs[parentIdx];const mergedItems=_mergeJobItems([...(parent.items||[]),...(j.items||[])]);const mergedUnits=mergedItems.reduce((a,gi)=>a+safeNum(gi.units),0);const mergedFulfilled=mergedItems.reduce((a,gi)=>a+safeNum(gi.fulfilled),0);const updJobs=jobs.map((jj,i2)=>i2===parentIdx?{...jj,items:mergedItems,total_units:mergedUnits,fulfilled_units:mergedFulfilled}:jj).filter((_,i2)=>i2!==ji);const updated={...o,jobs:updJobs,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Merged back into '+j.split_from)}} title="Merge back into parent job">Merge Back</button>}
              </td>
            </tr>
            {/* Grouped items under this job */}
            {(j.items||[]).map((gi,gii)=>{
              const giSizes=_giSizes(gi);const giFul=_giFulSizes(gi,giSizes);
              const _giSzOrd=['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','OSFA'];
              const giSzEntries=Object.entries(giSizes).filter(([,v])=>safeNum(v)>0).sort(([a],[b])=>{const ai=_giSzOrd.indexOf(a),bi=_giSzOrd.indexOf(b);return(ai===-1?99:ai)-(bi===-1?99:bi)});
              return<tr key={gii} style={{background:'#fafbfc',cursor:'pointer'}} onClick={()=>setSelJob(ji)}>
              <td style={{paddingLeft:24,color:'#94a3b8',fontSize:10}}>↳</td>
              <td colSpan={2} style={{fontSize:11,color:'#475569'}}><span style={{fontWeight:600}}>{gi.sku}</span> {gi.name} <span style={{color:'#94a3b8'}}>({gi.color||'—'})</span></td>
              <td style={{fontSize:11}}>{gi.fulfilled}/{gi.units}</td>
              <td colSpan={4} style={{fontSize:11}}>
                {giSzEntries.length>0&&<div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{giSzEntries.map(([sz,qty])=>{const f=safeNum(giFul[sz]);const done=f>=qty&&qty>0;return<span key={sz} style={{display:'inline-flex',gap:3,alignItems:'baseline'}}><span style={{fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase'}}>{sz}</span><span style={{fontWeight:700,color:done?'#166534':f>0?'#d97706':'#475569'}}>{f}/{qty}</span></span>})}</div>}
              </td>
            </tr>})}
            </React.Fragment>})}
        </tbody></table>}

      {/* Split Job Modal */}
      {splitModal&&(()=>{
        const j=jobs[splitModal.jIdx];if(!j)return null;
        const _szOrd=['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
        const items=(j.items||[]).map(gi=>{
          const sizes=_giSizes(gi);
          const fulSizes=_giFulSizes(gi,sizes);
          const received=Object.values(fulSizes).reduce((a,v)=>a+safeNum(v),0);
          return{...gi,sizes,fulSizes,received};
        });
        const totalReceived=items.reduce((a,gi)=>a+gi.received,0);
        return<div className="modal-overlay" onClick={()=>setSplitModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
          <div className="modal-header"><h2>✂️ Split Job — {j.id}</h2><button className="modal-close" onClick={()=>setSplitModal(null)}>×</button></div>
          <div className="modal-body">
            <p style={{fontSize:13,color:'#64748b',marginBottom:12}}>Choose how to split <strong>{j.art_name}</strong> ({j.total_units} total units, {totalReceived} received)</p>

            {/* Mode selection */}
            {!splitModal.mode&&<div style={{display:'flex',gap:12,flexDirection:'column'}}>
              <button className="btn" style={{padding:16,background:'#f0fdf4',border:'2px solid #86efac',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'received'}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#166534',marginBottom:4}}>📦 Split by Received Inventory</div>
                <div style={{fontSize:12,color:'#475569'}}>Creates a new job with the <strong>{totalReceived} units</strong> that have been received/pulled. Remaining {j.total_units-totalReceived} units stay on the original job.</div>
                {totalReceived===0&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠️ No units received yet — nothing to split</div>}
              </button>
              <button className="btn" style={{padding:16,background:'#eff6ff',border:'2px solid #93c5fd',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'sku',selectedSkus:[]}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#1e40af',marginBottom:4}}>👕 Split by SKU / Garment</div>
                <div style={{fontSize:12,color:'#475569'}}>Select which garments to move to a new job. Useful when different garments arrive at different times or need separate production runs.</div>
                {items.length<2&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠️ Only 1 garment on this job — can't split by SKU</div>}
              </button>
              <button className="btn" style={{padding:16,background:'#faf5ff',border:'2px solid #c4b5fd',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'custom',customSizes:{},customInclude:{}}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#7c3aed',marginBottom:4}}>✏️ Custom Split — Choose Items & Sizes</div>
                <div style={{fontSize:12,color:'#475569'}}>Pick which garments to split, then choose specific sizes from each. Art and approvals carry over to the new job.</div>
              </button>
            </div>}

            {/* Split by received confirmation */}
            {splitModal.mode==='received'&&<div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Items with received inventory:</div>
              {items.map((gi,i)=><div key={i} style={{padding:8,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center',background:gi.received>0?'#f0fdf4':'#fafafa'}}>
                <div><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color})</span></div>
                <div style={{textAlign:'right'}}><span style={{fontWeight:700,color:gi.received>0?'#166534':'#94a3b8'}}>{gi.received}</span><span style={{color:'#94a3b8'}}>/{gi.units}</span> <span style={{fontSize:10,color:'#64748b'}}>received</span></div>
              </div>)}
              <div style={{padding:10,background:'#fef9c3',borderRadius:6,marginTop:8,fontSize:12}}>
                <strong>New job ({j.id}-S):</strong> {totalReceived} units (received) → Ready for Prod<br/>
                <strong>Remaining ({j.id}):</strong> {j.total_units-totalReceived} units → Waiting for items
              </div>
            </div>}

            {/* Split by SKU selection */}
            {splitModal.mode==='sku'&&<div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Select garments to split into a new job:</div>
              {items.map((gi,i)=>{const sel=(splitModal.selectedSkus||[]).includes(gi.sku);
                return<div key={i} style={{padding:10,border:sel?'2px solid #3b82f6':'1px solid #e2e8f0',borderRadius:6,marginBottom:6,cursor:'pointer',display:'flex',gap:10,alignItems:'center',background:sel?'#eff6ff':'white'}}
                  onClick={()=>setSplitModal(m=>{const ss=m.selectedSkus||[];return{...m,selectedSkus:ss.includes(gi.sku)?ss.filter(s=>s!==gi.sku):[...ss,gi.sku]}})}>
                  <input type="checkbox" checked={sel} readOnly style={{width:18,height:18}}/>
                  <div style={{flex:1}}><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color})</span></div>
                  <div style={{fontWeight:700,fontSize:13}}>{gi.units} <span style={{fontSize:10,color:'#64748b',fontWeight:400}}>units</span></div>
                  <div style={{fontSize:11,color:gi.received>0?'#166534':'#94a3b8'}}>{gi.received} rcvd</div>
                </div>})}
              {(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length<items.length&&<div style={{padding:10,background:'#eff6ff',borderRadius:6,marginTop:8,fontSize:12}}>
                <strong>New job ({j.id}-B):</strong> {items.filter(gi=>(splitModal.selectedSkus||[]).includes(gi.sku)).map(gi=>gi.sku).join(', ')} ({items.filter(gi=>(splitModal.selectedSkus||[]).includes(gi.sku)).reduce((a,gi)=>a+gi.units,0)} units)<br/>
                <strong>Remaining ({j.id}):</strong> {items.filter(gi=>!(splitModal.selectedSkus||[]).includes(gi.sku)).map(gi=>gi.sku).join(', ')} ({items.filter(gi=>!(splitModal.selectedSkus||[]).includes(gi.sku)).reduce((a,gi)=>a+gi.units,0)} units)
              </div>}
              {(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length>=items.length&&<div style={{padding:8,background:'#fef2f2',borderRadius:6,marginTop:8,fontSize:12,color:'#dc2626'}}>Can't move all garments — deselect at least one to keep on the original job.</div>}
            </div>}

            {/* Custom split — choose items + per-size quantities */}
            {splitModal.mode==='custom'&&(()=>{
              const cs=splitModal.customSizes||{};
              const ci=splitModal.customInclude||{};
              const _itemSplitQty=gi=>Object.entries(cs[gi.item_idx]||{}).reduce((a,[sz,v])=>a+(ci[gi.item_idx]?Math.min(safeNum(v),safeNum(gi.sizes[sz])):0),0);
              const totalSplit=items.reduce((a,gi)=>a+_itemSplitQty(gi),0);
              const totalRemain=j.total_units-totalSplit;
              const _setSizes=(item_idx,upd)=>setSplitModal(m=>({...m,customSizes:{...m.customSizes,[item_idx]:{...(m.customSizes?.[item_idx]||{}),...upd}}}));
              const _toggleInclude=(item_idx,on)=>setSplitModal(m=>{
                const next={...(m.customInclude||{}),[item_idx]:on};
                // When turning on for the first time and no sizes selected yet, default to all sizes for convenience.
                let nextSizes=m.customSizes||{};
                if(on&&(!m.customSizes?.[item_idx]||Object.values(m.customSizes[item_idx]).every(v=>!safeNum(v)))){
                  const gi=items.find(g=>g.item_idx===item_idx);
                  if(gi)nextSizes={...nextSizes,[item_idx]:{...gi.sizes}};
                }
                return{...m,customInclude:next,customSizes:nextSizes};
              });
              return<div>
                <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>Pick the garments and sizes to split off:</div>
                <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>Tick a garment to include it in the new job, then dial in the sizes. Art status, mockups, and coach approval will carry over.</div>
                {items.map((gi,i)=>{
                  const incl=!!ci[gi.item_idx];
                  const itemSplit=_itemSplitQty(gi);
                  const sizesList=Object.entries(gi.sizes).filter(([,v])=>safeNum(v)>0).sort((a,b)=>{const ai=_szOrd.indexOf(a[0]),bi=_szOrd.indexOf(b[0]);return(ai===-1?99:ai)-(bi===-1?99:bi)});
                  return<div key={i} style={{padding:10,border:incl?'2px solid #c4b5fd':'1px solid #e2e8f0',borderRadius:6,marginBottom:6,background:incl?'#faf5ff':'white'}}>
                    <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:incl?8:0,cursor:'pointer'}} onClick={()=>_toggleInclude(gi.item_idx,!incl)}>
                      <input type="checkbox" checked={incl} readOnly style={{width:18,height:18}}/>
                      <div style={{flex:1}}>
                        <div><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color||'—'})</span></div>
                        <div style={{fontSize:10,color:'#64748b'}}>{gi.units} total · {gi.received} received</div>
                      </div>
                      <div style={{fontSize:12,fontWeight:700,color:incl?'#7c3aed':'#94a3b8'}}>{itemSplit}<span style={{fontSize:10,color:'#94a3b8',fontWeight:400}}> / {gi.units} splitting</span></div>
                    </div>
                    {incl&&<div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                        <button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();_setSizes(gi.item_idx,gi.sizes)}}>All sizes</button>
                        {gi.received>0&&<button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();_setSizes(gi.item_idx,gi.fulSizes)}}>Received only ({gi.received})</button>}
                        <button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();const z={};Object.keys(gi.sizes).forEach(sz=>z[sz]=0);_setSizes(gi.item_idx,z)}}>Clear</button>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(72px,1fr))',gap:6}}>
                        {sizesList.map(([sz,max])=>{
                          const cur=safeNum(cs[gi.item_idx]?.[sz]);
                          const fulMax=safeNum(gi.fulSizes?.[sz]);
                          return<div key={sz} style={{padding:'4px 6px',background:'white',border:'1px solid #e2e8f0',borderRadius:5}}>
                            <div style={{fontSize:9,fontWeight:700,color:'#64748b',display:'flex',justifyContent:'space-between'}}><span>{sz}</span>{fulMax>0&&<span style={{color:'#166534'}}>{fulMax} rcvd</span>}</div>
                            <div style={{display:'flex',alignItems:'center',gap:3}}>
                              <input type="number" className="form-input" min={0} max={max} value={cur||''} placeholder="0"
                                style={{width:'100%',fontSize:12,fontWeight:700,textAlign:'center',padding:'2px 4px'}}
                                onChange={e=>_setSizes(gi.item_idx,{[sz]:Math.max(0,Math.min(parseInt(e.target.value)||0,max))})}/>
                              <span style={{fontSize:10,color:'#94a3b8'}}>/{max}</span>
                            </div>
                          </div>})}
                      </div>
                    </div>}
                  </div>})}
                {totalSplit>0&&totalRemain>0&&<div style={{padding:10,background:'#faf5ff',borderRadius:6,marginTop:8,fontSize:12}}>
                  <strong>New split job:</strong> {totalSplit} units<br/>
                  <strong>Remaining on {j.id}:</strong> {totalRemain} units
                </div>}
                {totalSplit>0&&totalRemain<=0&&<div style={{padding:8,background:'#fef2f2',borderRadius:6,marginTop:8,fontSize:12,color:'#dc2626'}}>Must leave some units on the original job.</div>}
              </div>})()}
          </div>
          <div className="modal-footer">
            {splitModal.mode&&<button className="btn btn-secondary" onClick={()=>setSplitModal(m=>({...m,mode:null}))}>← Back</button>}
            <button className="btn btn-secondary" onClick={()=>setSplitModal(null)}>Cancel</button>
            {splitModal.mode==='received'&&totalReceived>0&&<button className="btn btn-primary" onClick={()=>splitByReceived(splitModal.jIdx)}>✂️ Split by Received ({totalReceived} units)</button>}
            {splitModal.mode==='sku'&&(splitModal.selectedSkus||[]).length>0&&(splitModal.selectedSkus||[]).length<items.length&&<button className="btn btn-primary" onClick={()=>splitBySku(splitModal.jIdx,splitModal.selectedSkus)}>✂️ Split Selected SKUs</button>}
            {splitModal.mode==='custom'&&(()=>{
              const cs=splitModal.customSizes||{};const ci=splitModal.customInclude||{};
              const ts=items.reduce((a,gi)=>a+Object.entries(cs[gi.item_idx]||{}).reduce((b,[sz,v])=>b+(ci[gi.item_idx]?Math.min(safeNum(v),safeNum(gi.sizes[sz])):0),0),0);
              const tr=j.total_units-ts;
              if(!(ts>0&&tr>0))return null;
              // Build payload: only included items, capped per size.
              const payload={};items.forEach(gi=>{if(!ci[gi.item_idx])return;const out={};Object.entries(cs[gi.item_idx]||{}).forEach(([sz,v])=>{const want=Math.min(safeNum(v),safeNum(gi.sizes[sz]));if(want>0)out[sz]=want});if(Object.keys(out).length)payload[gi.item_idx]=out});
              return<button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>splitCustom(splitModal.jIdx,payload)}>✂️ Split {ts} Units</button>;
            })()}
          </div>
        </div></div>})()}

      {/* Art Request Modal */}
      {artReqModal&&(()=>{
        const j=jobs[artReqModal.jIdx];if(!j)return null;
        const _artIds=(j._art_ids||[j.art_file_id]).filter(Boolean);
        const existingFiles=_artIds.flatMap(aid=>{const af=safeArt(o).find(a=>a.id===aid);return(af?.sample_art||[]).concat(af?.mockup_files||[]).concat(af?.prod_files||[])});
        const artists=REPS.filter(r=>r.role==='art');
        const hasExistingReqs=(j.art_requests||[]).length>0;
        const activeReq=(j.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
        const submitArtReq=()=>{
          const req={id:'AR-'+Date.now(),artist:artReqModal.artist,artist_name:(artists.find(a=>a.id===artReqModal.artist)||{}).name||'',instructions:artReqModal.instructions,files:artReqModal.files||[],existing_files:existingFiles.map(f=>f.name||f),status:'requested',created_at:new Date().toISOString(),created_by:cu.name};
          const updatedJobs=jobs.map((jj,i)=>i===artReqModal.jIdx?{...jj,art_requests:[...(jj.art_requests||[]),req],art_status:(jj.art_status==='needs_art'||jj.art_status==='waiting_approval'||PROD_FILES_STATUSES.includes(jj.art_status))?'art_requested':jj.art_status,assigned_artist:artReqModal.artist||jj.assigned_artist}:jj);
          // Store rep files as sample_art on the art file (not mockups)
          const repFiles=artReqModal.files||[];
          let updArtFiles3=safeArt(o);
          if(repFiles.length>0&&j){
            const artIds3=j._art_ids||[j.art_file_id].filter(Boolean);
            updArtFiles3=updArtFiles3.map(a=>artIds3.includes(a.id)?{...a,sample_art:[...(a.sample_art||[]),...repFiles]}:a);
          }
          const updated={...o,jobs:updatedJobs,art_files:updArtFiles3,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setArtReqModal(null);nf('Art request sent to '+(artists.find(a=>a.id===artReqModal.artist)||{}).name||'artist');
        };
        return<div className="modal-overlay" onClick={()=>setArtReqModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
          <div className="modal-header" style={hasExistingReqs?{background:'#faf5ff'}:undefined}><h2>{hasExistingReqs?'Update Art Request':'🎨 Request Art'} — {j.art_name}</h2><button className="modal-close" onClick={()=>setArtReqModal(null)}>×</button></div>
          <div className="modal-body">
            {hasExistingReqs&&<div style={{padding:'10px 14px',marginBottom:12,borderRadius:8,border:'2px solid '+(activeReq?'#fbbf24':'#86efac'),background:activeReq?'#fffbeb':'#f0fdf4'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:18}}>{activeReq?(activeReq.status==='in_progress'?'🎨':'📩'):'✅'}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:activeReq?'#92400e':'#166534'}}>{activeReq?(activeReq.status==='in_progress'?'Art In Progress — '+activeReq.artist_name:'Art Requested — Awaiting '+activeReq.artist_name):'All Requests Complete'}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{(j.art_requests||[]).length} request(s) total · Last: {new Date((j.art_requests||[])[(j.art_requests||[]).length-1]?.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            </div>}
            <div style={{marginBottom:12}}>
              <div className="form-label">Artist *</div>
              <select className="form-select" value={artReqModal.artist} onChange={e=>setArtReqModal(m=>({...m,artist:e.target.value}))}>
                <option value="">Select artist...</option>
                {artists.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <div className="form-label">{hasExistingReqs?'Update / Additional Instructions':'Instructions'}</div>
              <textarea className="form-input" rows={4} placeholder={hasExistingReqs?'Add revision notes, feedback, or additional instructions...':'Describe what you need — mockup, revision, specific colors, placement notes, etc.'} value={artReqModal.instructions} onChange={e=>setArtReqModal(m=>({...m,instructions:e.target.value}))} style={{resize:'vertical'}}/>
            </div>
            <div style={{marginBottom:12}}>
              <div className="form-label">Sample Art / Reference Files</div>
              <div style={{border:'2px dashed #cbd5e1',borderRadius:8,padding:16,textAlign:'center',cursor:'pointer',background:'#f8fafc'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6';e.currentTarget.style.background='#eff6ff'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#f8fafc'}}
                onDrop={async e=>{e.preventDefault();e.currentTarget.style.borderColor='#cbd5e1';e.currentTarget.style.background='#f8fafc';for(const f of Array.from(e.dataTransfer.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');setArtReqModal(m=>m?{...m,files:[...(m.files||[]),{name:f.name,size:f.size,type:f.type,url}]}:m)}catch(err){nf('Upload failed: '+err.message,'error')}}}}
                onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.onchange=async()=>{for(const f of Array.from(inp.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');setArtReqModal(m=>m?{...m,files:[...(m.files||[]),{name:f.name,size:f.size,type:f.type,url}]}:m)}catch(err){nf('Upload failed: '+err.message,'error')}}};inp.click()}}>
                <div style={{fontSize:12,color:'#64748b'}}>Drop files here or click to browse</div>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>PNG, PDF, AI, EPS, JPG</div>
              </div>
              {(artReqModal.files||[]).length>0&&<div style={{marginTop:8}}>{(artReqModal.files||[]).map((f,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',background:'#f1f5f9',borderRadius:4,fontSize:11,marginBottom:4}}>
                <span>{f.name}</span><span style={{color:'#94a3b8',marginLeft:'auto'}}>{(f.size/1024).toFixed(0)}KB</span>
                <button style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:14,padding:0}} onClick={()=>setArtReqModal(m=>({...m,files:(m.files||[]).filter((_,fi)=>fi!==i)}))}>×</button>
              </div>)}</div>}
            </div>
            {existingFiles.length>0&&<div style={{marginBottom:12}}>
              <div className="form-label">Existing Art Files (auto-included)</div>
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:6,padding:8}}>{existingFiles.map((f,i)=><div key={i} style={{fontSize:11,color:'#166534',padding:'2px 0'}}>✓ {f.name||f}</div>)}</div>
            </div>}
            {(j.art_requests||[]).length>0&&<div style={{marginBottom:12}}>
              <div className="form-label">Previous Requests ({(j.art_requests||[]).length})</div>
              <div style={{maxHeight:120,overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:6}}>{(j.art_requests||[]).map((r,i)=><div key={i} style={{padding:'6px 10px',borderBottom:'1px solid #f1f5f9',fontSize:11}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><strong>{r.artist_name||'Unknown'}</strong><span style={{color:'#94a3b8'}}>{new Date(r.created_at).toLocaleDateString()}</span></div>
                <div style={{color:'#64748b',marginTop:2}}>{r.instructions||'No instructions'}</div>
                <span className={`badge ${r.status==='completed'?'badge-green':r.status==='in_progress'?'badge-blue':'badge-amber'}`} style={{fontSize:9,marginTop:2}}>{r.status==='completed'?'Done':r.status==='in_progress'?'Working':'Requested'}</span>
              </div>)}</div>
            </div>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setArtReqModal(null)}>Cancel</button>
            <button className="btn btn-primary" style={hasExistingReqs?{background:'#6d28d9',borderColor:'#6d28d9'}:{}} disabled={!artReqModal.artist} onClick={submitArtReq}>{hasExistingReqs?'Send Update':'Send Art Request'}</button>
          </div>
        </div></div>
      })()}

      </div></div>})()}

    {/* LINKED DOCUMENTS: Item Fulfillments & Purchase Orders */}
    {isSO&&(()=>{
      const allPickIds=[];const allPoIds=[];
      safeItems(o).forEach((it,i)=>{
        safePicks(it).forEach((pk,pi)=>{if(pk.pick_id){
          const qty=Object.entries(pk).reduce((a,[k,v])=>k!=='status'&&k!=='pick_id'&&typeof v==='number'?a+v:a,0);
          const itemTotal=qty*it.unit_sell;
          const existing=allPickIds.find(x=>x.id===pk.pick_id);
          if(existing){existing.qty+=qty;existing.total+=itemTotal;existing.skus.push({sku:it.sku,name:it.name,color:it.color});if(pk.status!=='pulled')existing.status='pick';}
          else allPickIds.push({id:pk.pick_id,status:pk.status||'pick',qty,lineIdx:i,pickIdx:pi,sku:it.sku,name:it.name,color:it.color,total:itemTotal,created_at:pk.created_at,memo:pk.memo,skus:[{sku:it.sku,name:it.name,color:it.color}]})}});
        safePOs(it).forEach((po,pi)=>{if(po.po_id){
          const szKeysP=Object.keys(po).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','notes','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type'].includes(k)&&typeof po[k]==='number');
          const qty=szKeysP.reduce((a,sz)=>a+(po[sz]||0),0);
          const rcvdQty=szKeysP.reduce((a,sz)=>a+((po.received||{})[sz]||0),0);
          const openQty=szKeysP.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-((po.received||{})[sz]||0)-((po.cancelled||{})[sz]||0)),0);
          const costTotal=qty*(po.unit_cost!=null?safeNum(po.unit_cost):safeNum(it.nsa_cost));
          const vk=it.vendor_id||it.brand;const vn=D_V.find(v=>v.id===vk)?.name||vk;
          const pst=openQty<=0&&rcvdQty>0?'received':rcvdQty>0?'partial':'waiting';
          const shipDates=(po.shipments||[]).map(s=>s.date);
          const existing=allPoIds.find(x=>x.id===po.po_id);
          if(existing){
            // Same PO on another item — aggregate quantities and track all line references
            existing.qty+=qty;existing.rcvdQty+=rcvdQty;existing.openQty+=openQty;existing.costTotal+=costTotal;
            existing.status=existing.openQty<=0&&existing.rcvdQty>0?'received':existing.rcvdQty>0?'partial':'waiting';
            existing.lines.push({lineIdx:i,poIdx:pi});
            existing.skus.push({sku:it.sku,name:it.name,color:it.color});
          }else{
            const unitPrice=po.unit_cost!=null?safeNum(po.unit_cost):safeNum(it.nsa_cost);
            allPoIds.push({id:po.po_id,status:pst,qty,rcvdQty,openQty,vendor:vn,lineIdx:i,poIdx:pi,sku:it.sku,name:it.name,color:it.color,costTotal,unitPrice,shipDates,created_at:po.created_at,memo:po.memo,
              lines:[{lineIdx:i,poIdx:pi}],skus:[{sku:it.sku,name:it.name,color:it.color}]})
          }
        }});
      });
      if(allPickIds.length===0&&allPoIds.length===0)return null;
      return<div className="card" style={{marginTop:16}}><div className="card-header"><h2>Linked Documents</h2></div><div className="card-body">
        {allPickIds.length>0&&<><div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Item Fulfillments</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:allPoIds.length>0?16:0}}>
            {allPickIds.map(pk=><div key={pk.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',background:pk.status==='pulled'?'#f0fdf4':'#fffbeb',transition:'box-shadow 0.15s'}} className="hover-card" onClick={()=>openPickModal(pk.id,pk.lineIdx,pk.pickIdx)}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Icon name="grid" size={14}/><span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{pk.id}</span>
                <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`} style={{fontSize:9}}>{pk.status==='pulled'?'✓ Pulled':'Needs Pull'}</span>
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:14,color:'#166534'}}>${pk.total.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,color:'#64748b',flexWrap:'wrap'}}>
                {(pk.skus||[{sku:pk.sku,name:pk.name,color:pk.color}]).map((s,si)=><span key={si}><strong style={{color:'#1e40af'}}>{s.sku}</strong> {s.name} <span style={{color:'#94a3b8'}}>{s.color}</span></span>)}
                <span>{pk.qty} units</span>
                {pk.created_at&&<span>📅 {pk.created_at}</span>}
              </div>
              {pk.memo&&<div style={{fontSize:11,color:'#475569',marginTop:3,fontStyle:'italic'}}>💬 {pk.memo}</div>}
            </div>)}
          </div></>}
        {allPoIds.length>0&&<><div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Purchase Orders</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {allPoIds.map(po=><div key={po.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',background:po.status==='received'?'#f0fdf4':po.status==='partial'?'#fffbeb':'#fff',transition:'box-shadow 0.15s'}} className="hover-card" onClick={()=>{const poData=o.items[po.lineIdx]?.po_lines?.[po.poIdx];if(poData)setEditPO({lineIdx:po.lineIdx,poIdx:po.poIdx,po:poData,allLines:po.lines})}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Icon name="cart" size={14}/><span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{po.id}</span>
                <span style={{fontSize:11,color:'#64748b'}}>{po.vendor}</span>
                <span className={`badge ${po.status==='received'?'badge-green':po.status==='partial'?'badge-amber':'badge-gray'}`} style={{fontSize:9}}>{po.status==='received'?'✓ Received':po.status==='partial'?po.rcvdQty+'/'+po.qty+' Rcvd':'Waiting'}</span>
                {po.unitPrice>0&&<span style={{fontSize:11,color:'#475569'}}>${po.unitPrice.toFixed(2)}/unit</span>}
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:14,color:'#64748b'}}>${po.costTotal.toLocaleString(undefined,{maximumFractionDigits:2})} cost</span>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,color:'#64748b',flexWrap:'wrap'}}>
                {po.skus.map((s,si)=><span key={si}><strong style={{color:'#1e40af'}}>{s.sku}</strong> {s.name} <span style={{color:'#94a3b8'}}>{s.color}</span></span>)}
                <span>{po.qty} units{po.openQty>0?' · '+po.openQty+' open':''}</span>
                {po.created_at&&<span>📅 {po.created_at}</span>}
                {po.shipDates.length>0&&<span>📦 Last recv: {po.shipDates[po.shipDates.length-1]}</span>}
              </div>
              {po.memo&&<div style={{fontSize:11,color:'#475569',marginTop:3,fontStyle:'italic'}}>💬 {po.memo}</div>}
            </div>)}
          </div></>}
      </div></div>})()}

    {/* RECEIVED CONFIRMATION MODAL — pops up after a PO partial/full receive with Print + Download label buttons */}
    {receivedConfirm&&(()=>{
      const rc=receivedConfirm;
      const qrData=window.location.origin+window.location.pathname+'?scan='+encodeURIComponent(rc.poId);
      const buildLines=()=>{const lines=[];if(rc.custName)lines.push({text:rc.custName,cls:'team'});lines.push({text:rc.soId,cls:'so'});lines.push({text:'RECEIVED — '+rc.date,cls:'sub',style:'color:#166534;font-weight:800;'});rc.items.forEach(it=>{lines.push({text:(it.sku||'')+' '+(it.name||''),cls:'sku'});lines.push({text:(it.color||'')+' — '+it.qty+' units'});lines.push({text:Object.entries(it.sizes).map(([sz,v])=>sz+': '+v).join(' &nbsp; '),cls:'sz'})});if(rc.items.length>1)lines.push({text:'TOTAL: '+rc.totalQty+' units',cls:'sz'});return lines};
      return<div className="modal-overlay" onClick={()=>setReceivedConfirm(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
        <div className="modal-header"><h2>📦 Received — {rc.poId}</h2>
          <button className="modal-close" onClick={()=>setReceivedConfirm(null)}>x</button></div>
        <div className="modal-body">
          <div style={{padding:'10px 12px',marginBottom:12,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,fontSize:12,color:'#166534'}}>
            Shipment received on <strong>{rc.poId}</strong> · {rc.date} · <strong>{rc.totalQty}</strong> unit{rc.totalQty===1?'':'s'} across {rc.items.length} item{rc.items.length===1?'':'s'}
          </div>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>What was just received</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
            {rc.items.map((it,i)=><div key={i} style={{padding:'8px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:12}}>{it.sku}</span>
                <span style={{fontWeight:600,fontSize:12}}>{it.name}</span>
                {it.color&&<span className="badge badge-gray">{it.color}</span>}
                <span style={{marginLeft:'auto',fontWeight:800,fontSize:13,color:'#166534'}}>{it.qty} units</span>
              </div>
              <div style={{marginTop:4,fontFamily:'monospace',fontSize:11,color:'#475569'}}>{Object.entries(it.sizes).map(([sz,v])=>sz+':'+v).join('  ')}</div>
            </div>)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setReceivedConfirm(null)}>Close</button>
          <button className="btn btn-secondary" onClick={()=>printQrLabel({id:rc.poId,qrData,shipBadge:null,lines:buildLines()})}>🖨️ Print Label (4×6)</button>
          <button className="btn btn-primary" onClick={async()=>{try{await downloadQrLabel({id:rc.poId,qrData,shipBadge:null,lines:buildLines()});nf('Label downloaded')}catch(err){nf('Download failed: '+err.message,'error')}}}>⬇️ Download (PDF)</button>
        </div>
      </div></div>;
    })()}

    {/* EDIT PICK MODAL — shows every item that shares the pick_id, since one IF can span multiple line items */}
    {editPick&&(()=>{
      const picks=editPick.picks||[];
      if(picks.length===0)return null;
      const firstPk=picks[0].pick;
      const pickId=editPick.pickId||firstPk.pick_id||'Pick';
      const NON_SZ=['pick_id','status','created_at','memo','ship_dest','ship_addr','deco_vendor','notes'];
      const itemInfos=picks.map((p,i)=>{
        const it=o.items[p.lineIdx]||{};const pk=p.pick;
        const szKeys=Object.keys(pk).filter(k=>!NON_SZ.includes(k)&&typeof pk[k]==='number'&&pk[k]>0);
        const total=szKeys.reduce((a,sz)=>a+(pk[sz]||0),0);
        return{idx:i,item:it,pick:pk,szKeys,total,lineIdx:p.lineIdx,pickIdx:p.pickIdx};
      });
      const grandTotal=itemInfos.reduce((a,x)=>a+x.total,0);
      const overallStatus=picks.every(p=>p.pick.status==='pulled')?'pulled':'pick';
      const qrData=window.location.origin+window.location.pathname+'?scan='+encodeURIComponent(pickId);
      // Build shared ship badge from first pick that has ship info
      const shipPk=picks.map(p=>p.pick).find(pk=>pk.ship_dest&&pk.ship_dest!=='in_house')||firstPk;
      const buildShipBadge=()=>{
        if(!shipPk.ship_dest||shipPk.ship_dest==='in_house')return null;
        const destLabel=shipPk.ship_dest==='ship_customer'?'SHIP TO CUSTOMER':'SHIP TO DECO'+(shipPk.deco_vendor?' — '+shipPk.deco_vendor:'');
        const addr=shipPk.ship_dest==='ship_customer'?(addrs.find(a=>a.id===shipPk.ship_addr)||addrs[0])?.label||'':'';
        return{text:destLabel+(addr?' — '+addr:''),color:shipPk.ship_dest==='ship_customer'?'#3b82f6':'#d97706',bg:shipPk.ship_dest==='ship_customer'?'#eff6ff':'#fffbeb'};
      };
      const buildLabelLines=()=>{
        const lines=[];
        if(cust?.name)lines.push({text:cust.name,cls:'team'});
        lines.push({text:o.id,cls:'so'});
        itemInfos.forEach(info=>{
          lines.push({text:(info.item.sku||'')+' '+(info.item.name||''),cls:'sku'});
          lines.push({text:(info.item.color||'')+' — '+info.total+' units'});
          lines.push({text:info.szKeys.map(sz=>sz+': '+info.pick[sz]).join(' &nbsp; '),cls:'sz'});
        });
        if(itemInfos.length>1)lines.push({text:'TOTAL: '+grandTotal+' units',cls:'sz'});
        return lines;
      };
      return<div className="modal-overlay" onClick={()=>setEditPick(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:640}}>
      <div className="modal-header"><h2>Pick — {pickId}{itemInfos.length>1?<span style={{marginLeft:8,fontSize:12,padding:'2px 8px',borderRadius:8,background:'#dbeafe',color:'#1e40af',fontWeight:700}}>{itemInfos.length} items</span>:null}</h2>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span className={`badge ${overallStatus==='pulled'?'badge-green':'badge-amber'}`}>{overallStatus==='pulled'?'Pulled':'Needs Pull'}</span>
          <button className="modal-close" onClick={()=>setEditPick(null)}>x</button>
        </div></div>
      <div className="modal-body">
        {/* Ship Destination */}
        {shipPk.ship_dest&&shipPk.ship_dest!=='in_house'&&<div style={{padding:'10px 14px',marginBottom:12,borderRadius:8,border:'2px solid '+(shipPk.ship_dest==='ship_customer'?'#3b82f6':'#d97706'),background:shipPk.ship_dest==='ship_customer'?'#eff6ff':'#fffbeb'}}>
          <div style={{fontSize:12,fontWeight:800,color:shipPk.ship_dest==='ship_customer'?'#1e40af':'#92400e'}}>{shipPk.ship_dest==='ship_customer'?'📦 Ship to Customer':'🚚 Ship to Deco'}</div>
          {shipPk.ship_dest==='ship_customer'&&(()=>{const addr=addrs.find(a=>a.id===shipPk.ship_addr)||addrs[0];return addr?<div style={{fontSize:12,color:'#475569',marginTop:4}}>{addr.label}</div>:null})()}
          {shipPk.ship_dest==='ship_deco'&&shipPk.deco_vendor&&<div style={{fontSize:12,color:'#475569',marginTop:4}}>Vendor: {shipPk.deco_vendor}</div>}
        </div>}
        {firstPk.ship_dest==='in_house'&&<div style={{padding:'8px 14px',marginBottom:12,borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569'}}>🏭 In-House Deco</div>
        </div>}
        {/* Status (applies to all items on this IF) */}
        <div style={{marginBottom:12}}><label className="form-label">Status</label>
          <div style={{display:'flex',gap:6}}>{['pick','pulled'].map(s=><button key={s} className={`btn btn-sm ${overallStatus===s?'btn-primary':'btn-secondary'}`} onClick={()=>setEditPick(p=>({...p,picks:p.picks.map(pp=>({...pp,pick:{...pp.pick,status:s,...(s==='pulled'&&!pp.pick.pulled_at?{pulled_at:new Date().toLocaleString()}:{})}}))}))}>{s==='pulled'?'✓ Pulled':'Needs Pull'}</button>)}</div></div>
        {/* Per-item product info + quantities */}
        {itemInfos.map(info=><div key={info.idx} style={{marginBottom:12,padding:10,border:'1px solid #e2e8f0',borderRadius:6,background:'#fafafa'}}>
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
            <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:13}}>{info.item.sku}</span>
            <span style={{fontWeight:600,fontSize:13}}>{info.item.name}</span>
            {info.item.color&&<span className="badge badge-gray">{info.item.color}</span>}
          </div>
          <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:6}}>Quantities by size:</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {info.szKeys.map(sz=><div key={sz} style={{textAlign:'center'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
              <input style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={info.pick[sz]} onChange={e=>{const v=parseInt(e.target.value)||0;setEditPick(p=>({...p,picks:p.picks.map((pp,i)=>i===info.idx?{...pp,pick:{...pp.pick,[sz]:v}}:pp)}))}}/>
            </div>)}
            <div style={{textAlign:'center',borderLeft:'2px solid #e2e8f0',paddingLeft:8}}><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>QTY</div><div style={{fontSize:18,fontWeight:800}}>{info.total}</div></div>
          </div>
        </div>)}
        {itemInfos.length>1&&<div style={{padding:'6px 10px',marginBottom:12,background:'#eff6ff',borderRadius:6,fontSize:12,fontWeight:700,color:'#1e40af',textAlign:'right'}}>Total: {grandTotal} units across {itemInfos.length} items</div>}
        {/* QR / Print Label */}
        <div style={{padding:12,border:'1px dashed #d1d5db',borderRadius:8,background:'#fafafa'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>📋 Label / QR Code</div>
          <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
            <div style={{padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
              <img src={'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data='+encodeURIComponent(qrData)} alt="QR" style={{width:80,height:80,display:'block'}}/>
            </div>
            <div style={{flex:1,fontSize:11}}>
              <div style={{fontWeight:800,fontSize:14}}>{pickId}</div>
              <div style={{color:'#64748b'}}>{o.id} — {cust?.name}</div>
              {itemInfos.map(info=><div key={info.idx} style={{marginTop:4}}>
                <div style={{fontWeight:600}}>{info.item.sku} {info.item.name}</div>
                <div>{info.item.color} — {info.total} units</div>
                <div style={{color:'#475569'}}>{info.szKeys.map(sz=>sz+':'+info.pick[sz]).join('  ')}</div>
              </div>)}
              {itemInfos.length>1&&<div style={{marginTop:4,fontWeight:700}}>Total: {grandTotal} units</div>}
            </div>
          </div>
          <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>printQrLabel({id:pickId,qrData,shipBadge:buildShipBadge(),lines:buildLabelLines()})}>🖨️ Print Label (4×6)</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={async()=>{try{await downloadQrSheet({id:pickId,qrData,shipBadge:buildShipBadge(),title:cust?.name||o.id,subtitle:o.id,totalUnits:grandTotal,items:itemInfos.map(info=>({sku:info.item.sku||'',name:info.item.name||'',color:info.item.color||'',units:info.total,sizes:info.szKeys.map(sz=>sz+': '+info.pick[sz]).join('  ')}))});nf('Pick ticket downloaded')}catch(err){nf('Download failed: '+err.message,'error')}}}>⬇️ Download (PDF)</button>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setEditPick(null)}>Close</button>
        <button className="btn btn-sm" style={{background:'#dc2626',color:'white'}} onClick={()=>{
          // Reverse inventory for any pulled picks before removing
          picks.forEach(p=>{const oldPick=o.items[p.lineIdx]?.pick_lines?.[p.pickIdx];const it=o.items[p.lineIdx];if(oldPick&&it&&oldPick.status==='pulled')adjustInvForPick(oldPick,it,1)});
          const removeMap=new Map();picks.forEach(p=>{if(!removeMap.has(p.lineIdx))removeMap.set(p.lineIdx,new Set());removeMap.get(p.lineIdx).add(p.pickIdx)});
          const updatedItems=o.items.map((it,i)=>removeMap.has(i)?{...it,pick_lines:(it.pick_lines||[]).filter((_,pi)=>!removeMap.get(i).has(pi))}:it);
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPick(null);nf('Pick deleted');
        }}><Icon name="trash" size={12}/> Delete</button>
        <button className="btn btn-primary" onClick={()=>{
          // Apply inventory adjustments per line based on status transitions
          picks.forEach(p=>{const oldPick=o.items[p.lineIdx]?.pick_lines?.[p.pickIdx];const it=o.items[p.lineIdx];const newPick=p.pick;if(!oldPick||!it)return;if(oldPick.status!=='pulled'&&newPick.status==='pulled')adjustInvForPick(newPick,it,-1);else if(oldPick.status==='pulled'&&newPick.status!=='pulled')adjustInvForPick(oldPick,it,1)});
          const writeMap=new Map();picks.forEach(p=>{if(!writeMap.has(p.lineIdx))writeMap.set(p.lineIdx,new Map());writeMap.get(p.lineIdx).set(p.pickIdx,p.pick)});
          const updatedItems=o.items.map((it,i)=>writeMap.has(i)?{...it,pick_lines:(it.pick_lines||[]).map((pl,pi)=>writeMap.get(i).has(pi)?writeMap.get(i).get(pi):pl)}:it);
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPick(null);nf('Pick updated');
        }}>Save Changes</button>
      </div>
    </div></div>})()}

    {/* EDIT PO MODAL — supports partial receiving with shipment log */}
    {editPO&&(()=>{
      // All items on this PO (may be multiple if same PO across different line items)
      const allLines=editPO.allLines||[{lineIdx:editPO.lineIdx,poIdx:editPO.poIdx}];
      const activeLineIdx=editPO._activeLineIdx||0;
      const activeLine=allLines[activeLineIdx]||allLines[0];
      const po=o.items[activeLine.lineIdx]?.po_lines?.[activeLine.poIdx]||editPO.po;
      const item=o.items[activeLine.lineIdx];
      const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof po[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
      const received=po.received||{};const cancelled=po.cancelled||{};const billed=po.billed||{};
      const shipments=po.shipments||[];const trackingNums=po.tracking_numbers||[];
      const getRcvd=sz=>(received[sz]||0);
      const getCncl=sz=>(cancelled[sz]||0);
      const getBilled=sz=>(billed[sz]||0);
      const getOpen=sz=>Math.max(0,(po[sz]||0)-getRcvd(sz)-getCncl(sz));
      const totalOrdered=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);
      const totalReceived=szKeys.reduce((a,sz)=>a+getRcvd(sz),0);
      const totalCancelled=szKeys.reduce((a,sz)=>a+getCncl(sz),0);
      const totalBilled=szKeys.reduce((a,sz)=>a+getBilled(sz),0);
      const totalOpen=szKeys.reduce((a,sz)=>a+getOpen(sz),0);
      const totalInTransit=Math.max(0,totalBilled-totalReceived);
      const hasOpen=szKeys.some(sz=>getOpen(sz)>0);
      const isDropShip=!!po.drop_ship;
      const poStatus=isDropShip?(totalBilled>=totalOrdered&&totalOrdered>0?'shipped':totalBilled>0?'partial':'waiting'):(totalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting');
      // PO-wide totals across every line on this PO. The active tab is a single item, but a PO can
      // span multiple SKUs/colors — the header status and the receive gate must reflect the whole
      // PO, otherwise it shows "Fully Received" (and hides receiving) when only one line is done.
      const NON_SZ_PO_KEYS=['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type','notes','shipping'];
      const _poWide=allLines.reduce((acc,ln)=>{const it=o.items[ln.lineIdx];const pl=it?.po_lines?.[ln.poIdx];if(!it||!pl)return acc;Object.keys(pl).filter(k=>!k.startsWith('_')&&!NON_SZ_PO_KEYS.includes(k)&&typeof pl[k]==='number').forEach(sz=>{acc.ord+=pl[sz]||0;acc.rcvd+=(pl.received||{})[sz]||0;acc.bld+=(pl.billed||{})[sz]||0;acc.open+=Math.max(0,(pl[sz]||0)-((pl.received||{})[sz]||0)-((pl.cancelled||{})[sz]||0))});return acc},{ord:0,rcvd:0,bld:0,open:0});
      const poWideStatus=isDropShip?(_poWide.bld>=_poWide.ord&&_poWide.ord>0?'shipped':_poWide.bld>0?'partial':'waiting'):(_poWide.open<=0&&_poWide.rcvd>0?'received':_poWide.rcvd>0?'partial':'waiting');
      const hasOpenAnywhere=_poWide.open>0;
      const qrData=window.location.origin+window.location.pathname+'?scan='+encodeURIComponent(po.po_id);

      return<div className="modal-overlay" onClick={()=>setEditPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:750,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>PO — {po.po_id||'PO'}<button className="btn btn-sm btn-secondary" title="Copy PO number" style={{fontSize:10,padding:'2px 8px',marginLeft:8,verticalAlign:'middle'}} onClick={()=>{navigator.clipboard?.writeText(po.po_id||'').then(()=>nf('Copied '+(po.po_id||'PO number'))).catch(()=>nf('Copy failed','error'))}}>📋 Copy</button>{po.batch_po_number&&<span style={{fontSize:12,fontWeight:600,color:'#7c3aed',marginLeft:10}}>· part of {po.batch_po_number}</span>}</h2>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {po.status==='queued'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#fef3c7',color:'#b45309'}}>Queued in batch</span>}
            {po.batch_po_number&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#f5f3ff',color:'#7c3aed',fontFamily:'monospace'}}>Batch: {po.batch_po_number}</span>}
            {isDropShip&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
            <span className={`badge ${poWideStatus==='received'||poWideStatus==='shipped'?'badge-green':poWideStatus==='partial'?'badge-amber':'badge-gray'}`}>{poWideStatus==='shipped'?'Shipped':poWideStatus==='received'?'Fully Received':poWideStatus==='partial'?(isDropShip?_poWide.bld+'/'+_poWide.ord+' Billed':'Partial — '+_poWide.open+' open'):'Waiting'}</span>
            <button className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 8px'}} onClick={()=>{setPoFullPage({po,item,allLines,soId:o.id,soItems:o.items});setEditPO(null)}}>View Full Page</button>
            <button className="modal-close" onClick={()=>setEditPO(null)}>x</button>
          </div>
        </div>
        <div className="modal-body">
          {/* All items on this PO */}
          {allLines.length>1&&<div style={{marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Items on this PO ({allLines.length})</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {allLines.map((ln,li)=>{const it=o.items[ln.lineIdx];return<div key={li} style={{padding:'6px 10px',borderRadius:6,cursor:'pointer',border:li===activeLineIdx?'2px solid #2563eb':'1px solid #e2e8f0',background:li===activeLineIdx?'#dbeafe':'#f8fafc',fontSize:12,display:'flex',gap:6,alignItems:'center'}} onClick={()=>setEditPO(p=>({...p,_activeLineIdx:li}))}>
                <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af'}}>{it?.sku}</span>
                <span style={{fontWeight:600}}>{it?.name}</span>
                <span style={{color:'#64748b'}}>{it?.color}</span>
              </div>})}
            </div>
          </div>}
          {/* Product info */}
          {item&&<div style={{padding:'8px 12px',background:'#f8fafc',borderRadius:6,marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:13}}>{item.sku}</span>
            <span style={{fontWeight:600,fontSize:13}}>{item.name}</span>
            <span className="badge badge-gray">{item.color}</span>
          </div>}

          {/* Tracking Numbers */}
          {trackingNums.length>0&&<div style={{padding:'8px 12px',background:'#eff6ff',borderRadius:6,marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:10,fontWeight:700,color:'#1e40af',textTransform:'uppercase'}}>Tracking:</span>
            {trackingNums.map((tn,ti)=><span key={ti} style={{fontFamily:'monospace',fontSize:12,fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4}}>{tn}</span>)}
          </div>}

          {/* PO Summary Table */}
          {(()=>{const unitCost=po.unit_cost!=null?safeNum(po.unit_cost):safeNum(item?.nsa_cost);const poTotal=totalOrdered*unitCost;const rcvdTotal=totalReceived*unitCost;const openTotal=totalOpen*unitCost;
          // Grand totals across every item on this PO (not just the active tab) so the "PO Total"
          // at the bottom reflects the entire purchase order. Falls back to active-line totals when
          // there is only one item on the PO.
          const _grand=allLines.reduce((acc,ln)=>{const it=o.items[ln.lineIdx];const pl=it?.po_lines?.[ln.poIdx];if(!it||!pl)return acc;const sk=Object.keys(pl).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='batch_queue_id'&&k!=='batch_po_number'&&k!=='preexisting'&&k!=='email_history'&&k!=='shipping'&&typeof pl[k]==='number');const u=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);const ord=sk.reduce((a,sz)=>a+(pl[sz]||0),0);const rcvd=sk.reduce((a,sz)=>a+((pl.received||{})[sz]||0),0);const opn=sk.reduce((a,sz)=>a+Math.max(0,(pl[sz]||0)-((pl.received||{})[sz]||0)-((pl.cancelled||{})[sz]||0)),0);acc.ord+=ord*u;acc.rcvd+=rcvd*u;acc.open+=opn*u;return acc},{ord:0,rcvd:0,open:0});
          return<>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',marginBottom:12}}>
            <thead><tr style={{borderBottom:'2px solid #0f172a'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}></th>{szKeys.map(sz=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:48}}>{sz}</th>)}<th style={{padding:'4px 8px',textAlign:'center'}}>TOTAL</th><th style={{padding:'4px 8px',textAlign:'right',minWidth:70}}>$</th></tr></thead>
            <tbody>
              <tr><td style={{padding:'3px 8px',fontSize:10,color:'#64748b'}}>Ordered</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700}}>{po[sz]||0}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalOrdered}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800}}>${poTotal.toFixed(2)}</td></tr>
              {(isDropShip||totalBilled>0)&&<tr style={{color:'#1e40af'}}><td style={{padding:'3px 8px',fontSize:10}}>Billed</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:getBilled(sz)>0?'#1e40af':'#d1d5db'}}>{getBilled(sz)||'—'}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalBilled}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800,color:'#1e40af'}}>${(totalBilled*unitCost).toFixed(2)}</td></tr>}
              {!isDropShip&&<tr style={{color:'#166534'}}><td style={{padding:'3px 8px',fontSize:10}}>Received</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:getRcvd(sz)>0?'#166534':'#d1d5db'}}>{getRcvd(sz)||'—'}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalReceived}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800,color:'#166534'}}>${rcvdTotal.toFixed(2)}</td></tr>}
              {totalCancelled>0&&<tr style={{color:'#dc2626'}}><td style={{padding:'3px 8px',fontSize:10}}>Cancelled</td>{szKeys.map(sz=><td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:getCncl(sz)>0?'#dc2626':'#d1d5db'}}>{getCncl(sz)||'—'}</td>)}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalCancelled}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800,color:'#dc2626'}}>${(totalCancelled*unitCost).toFixed(2)}</td></tr>}
              {totalInTransit>0&&<tr style={{color:'#7c3aed'}}><td style={{padding:'3px 8px',fontSize:10}}>In Transit</td>{szKeys.map(sz=>{const it=Math.max(0,getBilled(sz)-getRcvd(sz));return<td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:it>0?'#7c3aed':'#d1d5db'}}>{it>0?it:'—'}</td>})}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalInTransit}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800,color:'#7c3aed'}}>${(totalInTransit*unitCost).toFixed(2)}</td></tr>}
              {hasOpen&&<tr style={{borderTop:'1px solid #e2e8f0',color:'#b45309'}}><td style={{padding:'3px 8px',fontSize:10,fontWeight:600}}>Open</td>{szKeys.map(sz=>{const op=getOpen(sz);return<td key={sz} style={{padding:'3px 8px',textAlign:'center',fontWeight:700,color:op>0?'#b45309':'#d1d5db'}}>{op>0?op:'—'}</td>})}<td style={{padding:'3px 8px',textAlign:'center',fontWeight:800}}>{totalOpen}</td><td style={{padding:'3px 8px',textAlign:'right',fontWeight:800,color:'#b45309'}}>${openTotal.toFixed(2)}</td></tr>}
            </tbody>
          </table>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#f0f9ff',borderRadius:6,marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',gap:16,fontSize:12,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{color:'#64748b',display:'flex',alignItems:'center',gap:4}}>Unit Cost: $<input key={unitCost} defaultValue={unitCost.toFixed(2)} style={{width:64,fontWeight:800,color:'#0f172a',border:'1px solid #cbd5e1',borderRadius:4,padding:'2px 4px',fontSize:12,textAlign:'right',background:'white'}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}} onBlur={e=>{const val=parseFloat(String(e.target.value).replace(/[$,\s]/g,''));if(isNaN(val)||val===unitCost)return;const updatedPO={...po,unit_cost:val};const updatedItems=o.items.map((it,i)=>i===activeLine.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===activeLine.poIdx?updatedPO:p)}:it);const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPO(prev=>({...prev,po:updatedPO}));nf('Unit cost updated to $'+val.toFixed(2))}}/></span>
              <span style={{color:'#64748b',display:'flex',alignItems:'center',gap:4}}>Shipping: $<input key={'ship-'+(po.shipping||0)} defaultValue={safeNum(po.shipping).toFixed(2)} placeholder="0.00" style={{width:70,fontWeight:800,color:'#0f172a',border:'1px solid #cbd5e1',borderRadius:4,padding:'2px 4px',fontSize:12,textAlign:'right',background:'white'}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}} onBlur={e=>{const val=parseFloat(String(e.target.value).replace(/[$,\s]/g,''))||0;const cur=safeNum(po.shipping);if(val===cur)return;// Shipping is PO-level — mirror to every po_line sharing this po_id.
                const updatedItems=o.items.map(it=>({...it,po_lines:(it.po_lines||[]).map(p=>p.po_id===po.po_id?{...p,shipping:val}:p)}));
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);
                setEditPO(prev=>({...prev,po:{...prev.po,shipping:val}}));
                nf('Shipping updated to $'+val.toFixed(2));
              }}/></span>
              {po.po_type==='outside_deco'&&<span className="badge badge-blue" style={{fontSize:10}}>Decoration PO</span>}
              {allLines.length>1&&<span style={{color:'#64748b',fontSize:11}}>Line Total: <strong style={{color:'#0f172a'}}>${poTotal.toFixed(2)}</strong></span>}
            </div>
            <div style={{textAlign:'right'}}>
              {safeNum(po.shipping)>0&&<div style={{fontSize:11,color:'#64748b'}}>Subtotal: ${_grand.ord.toFixed(2)} · Shipping: ${safeNum(po.shipping).toFixed(2)}</div>}
              <div style={{fontWeight:800,fontSize:16,color:'#0f172a'}}>PO Total{allLines.length>1?' ('+allLines.length+' items)':''}: ${(_grand.ord+safeNum(po.shipping)).toFixed(2)}</div>
            </div>
          </div></>})()}

          {/* Edit PO — cancel sizes or add back previously cancelled */}
          {(hasOpen||totalCancelled>0)&&<div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',gap:4}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}}>
              ✏️ <span style={{textDecoration:'underline'}}>Edit PO</span> <span style={{fontSize:9}}>(cancel sizes or add back previously cancelled)</span>
            </div>
            <div style={{display:'none',marginTop:8,padding:10,border:'1px dashed #f59e0b',borderRadius:6,background:'#fffbeb'}}>
              <div style={{fontSize:11,color:'#92400e',marginBottom:6}}>Set the cancelled quantity for each size. Lower a number to add sizes back; raise it to cancel (cancelled sizes become available for new picks/POs):</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                {szKeys.filter(sz=>getOpen(sz)>0||getCncl(sz)>0).map(sz=>{const maxCancel=Math.max(0,(po[sz]||0)-getRcvd(sz));return<div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-cancel-'+sz} style={{width:42,textAlign:'center',border:'1px solid #f59e0b',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getCncl(sz)}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open · max {maxCancel}</div>
                </div>})}
              </div>
              <button className="btn btn-sm" style={{background:'#f59e0b',color:'white',fontSize:11}} onClick={()=>{
                const newCancelled={...cancelled};
                let anyChange=false;
                szKeys.filter(sz=>getOpen(sz)>0||getCncl(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-cancel-'+sz);
                  const maxCancel=Math.max(0,(po[sz]||0)-getRcvd(sz));
                  const qty=el?Math.max(0,Math.min(parseInt(el.value)||0,maxCancel)):getCncl(sz);
                  if(qty!==getCncl(sz))anyChange=true;
                  newCancelled[sz]=qty;
                });
                if(!anyChange){nf('No changes to apply','error');return}
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(received[sz]||0)-(newCancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
                const updatedPO={...po,cancelled:newCancelled,status:newStatus};
                const updatedItems=o.items.map((it,i)=>i===activeLine.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===activeLine.poIdx?updatedPO:p)}:it);
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO});nf('PO '+po.po_id+' updated');
              }}>✏️ Update PO</button>
            </div>
          </div>}

          {/* Shipment history */}
          {shipments.length>0&&<>
            <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:6}}>Shipment history:</div>
            {shipments.map((sh,si)=>{
              const shQrData=JSON.stringify({type:'PO_RECV',id:po.po_id,shipment:si+1,so:o.id,sku:item?.sku,date:sh.date});
              const isEditing=editPO._editShipIdx===si;
              const shSzKeys=szKeys.filter(sz=>sh[sz]);
              return<div key={si} style={{marginBottom:4}}>
              <div style={{padding:'6px 10px',background:isEditing?'#dbeafe':'#f0fdf4',borderRadius:isEditing?'6px 6px 0 0':'6px',fontSize:11,display:'flex',gap:12,alignItems:'center',cursor:'pointer'}} onClick={()=>setEditPO(p=>({...p,_editShipIdx:isEditing?null:si}))}>
              <span style={{fontWeight:700,color:'#166534'}}>📦 {sh.date}</span>
              {szKeys.map(sz=>sh[sz]?<span key={sz} style={{color:'#374151'}}>{sz}:<strong>{sh[sz]}</strong></span>:null)}
              <span style={{marginLeft:'auto',fontSize:9,color:'#64748b'}}>{isEditing?'▲ close':'✏️ edit'}</span>
              <button style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'#64748b',textDecoration:'underline'}} onClick={e=>{e.stopPropagation();
                printQrLabel({
                  id:po.po_id+' — Shipment #'+(si+1),
                  qrData:shQrData,
                  lines:[
                    {text:'Received: '+sh.date,cls:'sub'},
                    {text:o.id+' — '+(cust?.name||'')},
                    {text:'<strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')},
                    {text:szKeys.filter(sz=>sh[sz]).map(sz=>sz+': '+sh[sz]).join(' &nbsp; '),cls:'sz'},
                  ]
                });
              }}>🖨️</button>
            </div>
            {isEditing&&<div style={{padding:10,border:'1px solid #bfdbfe',borderRadius:'0 0 6px 6px',background:'#eff6ff',marginBottom:2}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
                <input type="date" id={'sh-edit-date-'+si} className="form-input" style={{width:140,fontSize:12}} defaultValue={sh.date}/>
                <span style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:8}}>Quantities:</span>
                {szKeys.map(sz=>{const v=sh[sz]||0;if(!v&&!shSzKeys.includes(sz))return null;return<div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'sh-edit-'+si+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #93c5fd',borderRadius:4,padding:'3px 2px',fontSize:13,fontWeight:700,background:'white'}} defaultValue={v}/>
                </div>})}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>{
                  const dateEl=document.getElementById('sh-edit-date-'+si);
                  const updatedSh={date:dateEl?.value||sh.date};
                  szKeys.forEach(sz=>{const el=document.getElementById('sh-edit-'+si+'-'+sz);if(el){const v=parseInt(el.value)||0;if(v>0)updatedSh[sz]=v}else if(sh[sz])updatedSh[sz]=sh[sz]});
                  // Recalculate received totals from all shipments
                  const newShipments=shipments.map((s,i)=>i===si?updatedSh:s);
                  const newReceived={};newShipments.forEach(s=>{szKeys.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
                  const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                  const updatedItems=o.items.map((it,i)=>i===activeLine.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===activeLine.poIdx?updatedPO:p)}:it);
                  const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO,_editShipIdx:null});nf('Shipment #'+(si+1)+' updated');
                }}>Save</button>
                <button className="btn btn-sm" style={{background:'#dc2626',color:'white',fontSize:11}} onClick={()=>{
                  if(!window.confirm('Delete this shipment receipt? Received quantities will be recalculated.'))return;
                  const newShipments=shipments.filter((_,i)=>i!==si);
                  const newReceived={};newShipments.forEach(s=>{szKeys.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
                  const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                  const updatedItems=o.items.map((it,i)=>i===activeLine.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===activeLine.poIdx?updatedPO:p)}:it);
                  const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO,_editShipIdx:null});nf('Shipment deleted');
                }}><Icon name="trash" size={10}/> Delete</button>
                <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>setEditPO(p=>({...p,_editShipIdx:null}))}>Cancel</button>
              </div>
            </div>}
            </div>})}
          </>}

          {/* Receive shipment form — not for drop ship POs, click-to-add multi-item.
              Gated on PO-wide open qty so other lines stay receivable even when the active tab is done. */}
          {hasOpenAnywhere&&!isDropShip&&(()=>{
            // Build all receivable lines
            const allRecvLines=allLines.map((ln,li)=>{
              const it=o.items[ln.lineIdx];const p=it?.po_lines?.[ln.poIdx];if(!it||!p)return null;
              const sk=Object.keys(p).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof p[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
              const rcvd=p.received||{};const cncl=p.cancelled||{};
              const getOp=sz=>Math.max(0,(p[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0));
              const hasOp=sk.some(sz=>getOp(sz)>0);
              return hasOp?{li,ln,item:it,po:p,szKeys:sk,rcvd,cncl,getOp}:null;
            }).filter(Boolean);
            if(!allRecvLines.length)return null;
            // For single-item POs, auto-select that item
            const selectedIdxs=allLines.length<=1?[activeLineIdx]:(editPO._selectedRecvLines||[]);
            const recvLines=allRecvLines.filter(r=>selectedIdxs.includes(r.li));
            const unselectedLines=allRecvLines.filter(r=>!selectedIdxs.includes(r.li));
            return<div key={'recv-multi'} style={{marginTop:12,padding:12,border:'2px solid #22c55e',borderRadius:8,background:'#f0fdf4'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:8}}>Receive Shipment{recvLines.length>1?' ('+recvLines.length+' items)':''}</div>
            {/* Clickable item pills to add/remove from receive */}
            {allLines.length>1&&<div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:600,color:'#64748b',marginBottom:4}}>Click items to add to this shipment:</div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {allRecvLines.map(r=>{const isSel=selectedIdxs.includes(r.li);return<div key={r.li} style={{padding:'4px 8px',borderRadius:5,cursor:'pointer',border:isSel?'2px solid #22c55e':'1px dashed #94a3b8',background:isSel?'#dcfce7':'white',fontSize:11,display:'flex',gap:4,alignItems:'center',transition:'all 0.15s'}} onClick={()=>setEditPO(p=>{const prev=p._selectedRecvLines||[];return{...p,_selectedRecvLines:isSel?prev.filter(x=>x!==r.li):[...prev,r.li]}})}>
                  {isSel?<span style={{color:'#16a34a',fontWeight:800,fontSize:13}}>✓</span>:<span style={{color:'#94a3b8',fontSize:13}}>+</span>}
                  <span style={{fontFamily:'monospace',fontWeight:700,color:isSel?'#1e40af':'#64748b'}}>{r.item.sku}</span>
                  <span style={{fontWeight:600,color:isSel?'#0f172a':'#94a3b8'}}>{r.item.name}</span>
                  <span style={{color:isSel?'#64748b':'#cbd5e1'}}>{r.item.color}</span>
                </div>})}
              </div>
            </div>}
            {recvLines.length>0&&<>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
              <input type="date" id="po-recv-date" className="form-input" style={{width:140,fontSize:12}} defaultValue={new Date().toISOString().split('T')[0]}/>
            </div>
            {recvLines.map(({ln,item:rit,po:rpo,szKeys:rsk,rcvd:rrcvd,cncl:rcncl,getOp},ri)=><div key={ln.lineIdx+'-'+ln.poIdx} style={{marginBottom:8,padding:recvLines.length>1?'8px':'0',background:recvLines.length>1?'rgba(255,255,255,0.6)':'transparent',borderRadius:6}}>
              {recvLines.length>1&&<div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4}}>
                <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',fontSize:11}}>{rit.sku}</span>
                <span style={{fontWeight:600,fontSize:11}}>{rit.name}</span>
                <span style={{fontSize:11,color:'#64748b'}}>{rit.color}</span>
              </div>}
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:11,fontWeight:600,color:'#64748b',width:40}}>Qty:</span>
                {rsk.filter(sz=>getOp(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-recv-'+ln.lineIdx+'-'+ln.poIdx+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #22c55e',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getOp(sz)} onChange={e=>{const v=parseInt(e.target.value)||0;e.target.style.borderColor=v>getOp(sz)?'#dc2626':'#22c55e';e.target.style.background=v>getOp(sz)?'#fef2f2':'white'}}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOp(sz)} open</div>
                </div>)}
              </div>
            </div>)}
            <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>{
              const dateEl=document.getElementById('po-recv-date');
              const date=dateEl?.value||new Date().toLocaleDateString();
              let anyQty=false;const overSizes=[];
              const updates=recvLines.map(({ln,po:rpo,szKeys:rsk,rcvd:rrcvd,cncl:rcncl,getOp})=>{
                const shipment={date};const newReceived={...(rpo.received||{})};
                rsk.filter(sz=>getOp(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-recv-'+ln.lineIdx+'-'+ln.poIdx+'-'+sz);
                  const qty=el?parseInt(el.value)||0:0;
                  if(qty>0){shipment[sz]=qty;newReceived[sz]=(newReceived[sz]||0)+qty;anyQty=true}
                  if(qty>getOp(sz))overSizes.push((o.items[ln.lineIdx]?.sku||'')+' '+sz+': receiving '+qty+' but only '+getOp(sz)+' open');
                });
                const newShipments=[...(rpo.shipments||[]),shipment];
                const newTotalOpen=rsk.reduce((a,sz)=>a+Math.max(0,(rpo[sz]||0)-(newReceived[sz]||0)-((rpo.cancelled||{})[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':newTotalOpen>0?'partial':'waiting';
                return{ln,updatedPO:{...rpo,received:newReceived,shipments:newShipments,status:newStatus}};
              });
              if(!anyQty){nf('Enter quantities to receive','error');return}
              if(overSizes.length>0&&!window.confirm('⚠️ MISSHIP WARNING — Receiving more than ordered:\n\n'+overSizes.join('\n')+'\n\nProceed anyway?'))return;
              let updatedItems=[...o.items];
              updates.forEach(({ln,updatedPO})=>{updatedItems=updatedItems.map((it,i)=>i===ln.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===ln.poIdx?updatedPO:p)}:it)});
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);
              const activeLnUpdate=updates.find(u=>u.ln.lineIdx===activeLine.lineIdx&&u.ln.poIdx===activeLine.poIdx);
              setEditPO({...editPO,po:activeLnUpdate?activeLnUpdate.updatedPO:editPO.po,_selectedRecvLines:[]});
              // Capture received items for the confirmation modal so the user can print/download a box label.
              const rcItems=updates.map(({ln,updatedPO})=>{const it=o.items[ln.lineIdx]||{};const rsk=Object.keys(updatedPO).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type'].includes(k)&&typeof updatedPO[k]==='number');const lastShip=updatedPO.shipments[updatedPO.shipments.length-1]||{};const sizes={};rsk.forEach(sz=>{if(lastShip[sz]>0)sizes[sz]=lastShip[sz]});return{sku:it.sku||'',name:it.name||'',color:it.color||'',sizes,qty:Object.values(sizes).reduce((a,v)=>a+v,0)}}).filter(x=>x.qty>0);
              const rcTotal=rcItems.reduce((a,x)=>a+x.qty,0);
              setReceivedConfirm({poId:po.po_id,soId:o.id,date,custName:cust?.name||'',items:rcItems,totalQty:rcTotal});
            }}>✓ Receive These Items</button>
            </>}
            {recvLines.length===0&&<div style={{fontSize:12,color:'#64748b',fontStyle:'italic'}}>Select items above to receive</div>}
          </div>})()}

          {/* QR / Print Label for full PO */}
          <div style={{marginTop:16,padding:12,border:'1px dashed #d1d5db',borderRadius:8,background:'#fafafa'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>📋 PO Label / QR Code</div>
            <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
              <div style={{padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
                <img src={'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data='+encodeURIComponent(qrData)} alt="QR" style={{width:80,height:80,display:'block'}}/>
              </div>
              <div style={{flex:1,fontSize:11}}>
                <div style={{fontWeight:800,fontSize:14}}>{po.po_id} {isDropShip&&<span style={{fontSize:10,fontWeight:700,color:'#7c3aed'}}>(Drop Ship)</span>} <span style={{fontSize:10,fontWeight:600,color:poStatus==='received'||poStatus==='shipped'?'#166534':poStatus==='partial'?'#b45309':'#64748b'}}>({poStatus==='shipped'?'Shipped':poStatus==='received'?'Fully Received':poStatus==='partial'?(isDropShip?totalBilled+'/'+totalOrdered+' billed':totalReceived+'/'+totalOrdered+' received'):'Waiting'})</span></div>
                <div style={{color:'#64748b'}}>{o.id} — {cust?.name}</div>
                <div style={{fontWeight:600}}>{item?.sku} {item?.name}</div>
                <div>{item?.color} — {totalOrdered} ordered{isDropShip?(totalBilled>0?', '+totalBilled+' billed':''):(totalReceived>0?', '+totalReceived+' received':'')}</div>
                <div style={{marginTop:4}}>Ordered: {szKeys.map(sz=>sz+':'+po[sz]).join('  ')}</div>
                {totalBilled>0&&<div style={{color:'#1e40af'}}>Billed: {szKeys.filter(sz=>getBilled(sz)>0).map(sz=>sz+':'+getBilled(sz)).join('  ')}</div>}
                {!isDropShip&&totalReceived>0&&<div style={{color:'#166534'}}>Received: {szKeys.filter(sz=>getRcvd(sz)>0).map(sz=>sz+':'+getRcvd(sz)).join('  ')}</div>}
                {totalOpen>0&&!isDropShip&&<div style={{color:'#b45309'}}>Open: {szKeys.filter(sz=>getOpen(sz)>0).map(sz=>sz+':'+getOpen(sz)).join('  ')}</div>}
                {trackingNums.length>0&&<div style={{color:'#1e40af',marginTop:2}}>Tracking: {trackingNums.join(', ')}</div>}
              </div>
            </div>
            <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>{
              const lines=[
                {text:o.id+' — '+(cust?.name||''),cls:'sub'},
                {text:'<strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')},
                {text:totalOrdered+' ordered'+(totalReceived>0?' · '+totalReceived+' received':'')},
                {text:'Ordered: '+szKeys.map(sz=>sz+': '+po[sz]).join(' &nbsp; '),cls:'sz'},
              ];
              if(totalReceived>0)lines.push({text:'Received: '+szKeys.filter(sz=>getRcvd(sz)>0).map(sz=>sz+': '+getRcvd(sz)).join(' &nbsp; '),cls:'sz',style:'color:#166534'});
              if(totalOpen>0)lines.push({text:'Open: '+szKeys.filter(sz=>getOpen(sz)>0).map(sz=>sz+': '+getOpen(sz)).join(' &nbsp; '),cls:'sz',style:'color:#b45309'});
              printQrLabel({id:po.po_id,qrData,lines});
            }}>🖨️ Print PO Label (4×6)</button>
            {(()=>{
              // Build PO doc options once, shared by Print / Download / Email so the PDF format
              // matches the SO PDF (same buildDocHtml pipeline, same _PRINT_CSS).
              const vendorRec=po.po_type==='outside_deco'?null:vendorList.find(v=>v.id===item?.vendor_id);
              const vendor=po.po_type==='outside_deco'?(po.deco_vendor||'Outside Decorator'):(vendorRec?.name||D_V.find(v=>v.id===item?.vendor_id)?.name||item?.brand||'Vendor');
              const vendorEmail=po.po_type==='outside_deco'?'':(vendorRec?.contact_email||'');
              const isDPO=po.po_type==='outside_deco';
              // Drop-ship POs ship directly from the vendor to the customer, so the Ship To
              // on the PO should be the customer's shipping address, not NSA's address.
              const _shipTo=(()=>{
                if(!isDropShip)return{name:_ci.name,sub:_ci.fullAddr};
                let addr='';
                if(o.ship_to_id==='custom'&&o.ship_to_custom){addr=o.ship_to_custom}
                else{
                  const sel=addrs.find(a=>a.id===o.ship_to_id);
                  if(sel&&sel.addr){addr=sel.addr}
                  else if(cust?.shipping_address_line1){
                    addr=cust.shipping_address_line1;
                    if(cust.shipping_address_line2)addr+='<br/>'+cust.shipping_address_line2;
                    addr+='<br/>'+(cust.shipping_city||'')+', '+(cust.shipping_state||'')+' '+(cust.shipping_zip||'');
                  }else if(cust?.billing_address_line1){
                    addr=cust.billing_address_line1;
                    if(cust.billing_address_line2)addr+='<br/>'+cust.billing_address_line2;
                    addr+='<br/>'+(cust.billing_city||'')+', '+(cust.billing_state||'')+' '+(cust.billing_zip||'');
                  }
                }
                return{name:(cust?.name||'Customer')+' (Drop Ship)',sub:addr};
              })();
              // Per-line data for every item on this PO (not just the active one) so the PDF
              // captures the full purchase order. Re-derive size keys / totals from the live
              // po line for each item, since the user may have different sizes per line.
              const _excludeKeys=new Set(['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship','batch_queue_id','batch_po_number','preexisting','email_history','shipping']);
              const linesData=allLines.map(ln=>{
                const it=o.items[ln.lineIdx];const pl=it?.po_lines?.[ln.poIdx];
                if(!it||!pl)return null;
                const sk=Object.keys(pl).filter(k=>!k.startsWith('_')&&!_excludeKeys.has(k)&&typeof pl[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
                const rcvd=pl.received||{};const cncl=pl.cancelled||{};const billed=pl.billed||{};
                const gR=sz=>(rcvd[sz]||0),gC=sz=>(cncl[sz]||0),gB=sz=>(billed[sz]||0),gO=sz=>Math.max(0,(pl[sz]||0)-gR(sz)-gC(sz));
                const tOrd=sk.reduce((a,sz)=>a+(pl[sz]||0),0);
                const tR=sk.reduce((a,sz)=>a+gR(sz),0);const tC=sk.reduce((a,sz)=>a+gC(sz),0);
                const tB=sk.reduce((a,sz)=>a+gB(sz),0);const tO=sk.reduce((a,sz)=>a+gO(sz),0);
                const u=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);
                return{it,pl,sk,tOrd,tR,tC,tB,tO,u,lineTotal:tOrd*u,gR,gC,gB,gO};
              }).filter(Boolean);
              const grandSubtotal=linesData.reduce((a,l)=>a+l.lineTotal,0);
              const grandOrdered=linesData.reduce((a,l)=>a+l.tOrd,0);
              const shipping=safeNum(po.shipping);
              const grandTotal=grandSubtotal+shipping;
              const _makePoDocOpts=()=>({
                title:vendor,docNum:po.po_id,
                docType:isDPO?'DECORATION PURCHASE ORDER':'PURCHASE ORDER',
                headerRight:'<div class="ta" style="font-size:18px">Status: '+(poStatus==='received'?'Received':poStatus==='partial'?'Partial':poStatus==='shipped'?'Shipped':'Open')+'</div><div class="ts">'+grandOrdered+' unit'+(grandOrdered!==1?'s':'')+' · Total: <strong>$'+grandTotal.toFixed(2)+'</strong></div>',
                infoBoxes:[
                  {label:'Vendor',value:vendor,sub:isDPO?(po.deco_type||'').replace(/_/g,' '):(vendorEmail||undefined)},
                  {label:'Ship To',value:_shipTo.name,sub:_shipTo.sub},
                  {label:'Sales Order',value:o.id,sub:(cust?.name||'')+(o.memo?' — '+o.memo:'')},
                  {label:'Expected Date',value:o.expected_date||'TBD',sub:'Rep: '+(REPS.find(r=>r.id===o.created_by)?.name||'—')},
                ],
                tables:[
                  ...linesData.map(ld=>({
                    title:(ld.it.sku||'')+' — '+(ld.it.name||'')+(ld.it.color?' · '+ld.it.color:''),
                    headers:['Size',...ld.sk.filter(sz=>ld.pl[sz]>0).map(s=>s),'Total','Unit $','Amount'],
                    aligns:['left',...ld.sk.filter(sz=>ld.pl[sz]>0).map(()=>'center'),'center','right','right'],
                    rows:(()=>{
                      const szH=ld.sk.filter(sz=>ld.pl[sz]>0);
                      const rows=[
                        {cells:[{value:'<strong>Ordered</strong>',style:'font-weight:700'},...szH.map(s=>({value:ld.pl[s]||0,style:(ld.pl[s]>0?'font-weight:800;color:#1e3a5f':'')})),{value:ld.tOrd,style:'font-weight:800'},{value:'$'+ld.u.toFixed(2),style:'text-align:right'},{value:'$'+ld.lineTotal.toFixed(2),style:'text-align:right;font-weight:800'}]},
                      ];
                      if(ld.tB>0)rows.push({cells:[{value:'Billed',style:'color:#1e40af'},...szH.map(s=>({value:ld.gB(s)||'—',style:'color:#1e40af'})),{value:ld.tB,style:'color:#1e40af;font-weight:700'},{value:'',style:''},{value:'$'+(ld.tB*ld.u).toFixed(2),style:'text-align:right;color:#1e40af'}]});
                      if(ld.tR>0)rows.push({cells:[{value:'Received',style:'color:#166534'},...szH.map(s=>({value:ld.gR(s)||'—',style:'color:#166534'})),{value:ld.tR,style:'color:#166534;font-weight:700'},{value:'',style:''},{value:'$'+(ld.tR*ld.u).toFixed(2),style:'text-align:right;color:#166534'}]});
                      if(ld.tO>0)rows.push({cells:[{value:'Open',style:'color:#b45309'},...szH.map(s=>({value:ld.gO(s)||'—',style:'color:#b45309'})),{value:ld.tO,style:'color:#b45309;font-weight:700'},{value:'',style:''},{value:'$'+(ld.tO*ld.u).toFixed(2),style:'text-align:right;color:#b45309'}]});
                      return rows;
                    })()
                  })),
                  // Totals summary — Subtotal + (optional) Shipping + Total
                  {
                    title:'PO Totals',
                    headers:['','Amount'],
                    aligns:['right','right'],
                    rows:[
                      {cells:[{value:'Subtotal ('+grandOrdered+' unit'+(grandOrdered!==1?'s':'')+')',style:'text-align:right'},{value:'$'+grandSubtotal.toFixed(2),style:'text-align:right;font-weight:700'}]},
                      ...(shipping>0?[{cells:[{value:'Shipping',style:'text-align:right'},{value:'$'+shipping.toFixed(2),style:'text-align:right'}]}]:[]),
                      {_class:'totals-row',cells:[{value:'<strong>PO Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:13px">$'+grandTotal.toFixed(2)+'</strong>',style:'text-align:right'}]},
                    ]
                  },
                ],
                notes:(()=>{const parts=[];if(isDPO)parts.push('Deco Type: '+(po.deco_type||'—').replace(/_/g,' '));if(po.notes)parts.push(po.notes);if(isDropShip)parts.push('<strong>DROP SHIP</strong> — Please ship directly to the customer address above.');return parts.length?parts.join('<br/>'):null})(),
                footer:isDPO?'Expected return: '+(po.expected_date||'TBD'):'Please confirm receipt and expected ship date.'
              });
              const _pdfFilename='PO-'+po.po_id+(vendor?'-'+vendor.replace(/[^a-z0-9]+/gi,'_'):'');
              return<>
                <button className="btn btn-sm btn-primary" style={{marginTop:8,marginLeft:6,fontSize:11}} onClick={()=>printDoc(_makePoDocOpts())}>🖨️ Print Full PO</button>
                <button className="btn btn-sm btn-secondary" style={{marginTop:8,marginLeft:6,fontSize:11}} onClick={async()=>{
                  try{await downloadDoc(_makePoDocOpts(),_pdfFilename);nf('📥 Downloaded '+po.po_id+'.pdf')}
                  catch(err){console.warn('PO PDF download failed:',err);nf('Download failed: '+(err?.message||'unknown'),'error')}
                }}>📥 Download PDF</button>
                <button className="btn btn-sm" style={{marginTop:8,marginLeft:6,fontSize:11,background:'#2563eb',color:'white'}} onClick={()=>{
                  if(isDPO){nf('Decoration PO — vendor record not linked. Use Download PDF and attach manually.','error');return}
                  const defaultMsg='Hi,\n\nPlease find attached PO '+po.po_id+' for '+totalOrdered+' unit'+(totalOrdered!==1?'s':'')+' of '+(item?.sku||'')+' '+(item?.name||'')+(item?.color?' ('+item.color+')':'')+'.\n\nExpected delivery: '+(o.expected_date||'TBD')+'.\n\nPlease confirm receipt and let us know your expected ship date.\n\nThank you,\n'+(cu?.name||'')+'\nNational Sports Apparel';
                  setPoEmail({
                    poId:po.po_id,lineIdx:activeLine.lineIdx,poIdx:activeLine.poIdx,
                    to:vendorEmail||'',
                    subject:'PO '+po.po_id+' from National Sports Apparel',
                    message:defaultMsg,
                    sending:false,
                    docOpts:_makePoDocOpts(),
                    filename:_pdfFilename,
                    vendorName:vendor,
                  });
                }}>📧 Email Vendor{vendorEmail?'':' ⚠'}</button>
              </>;
            })()}
          </div>
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn btn-sm btn-secondary" style={{fontSize:10,color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
            if(!window.confirm('Delete entire PO'+(allLines.length>1?' from all '+allLines.length+' items':'')+'? All sizes will go back to open.'))return;
            const updatedItems=[...o.items];
            allLines.forEach(ln=>{updatedItems[ln.lineIdx].po_lines=updatedItems[ln.lineIdx].po_lines.filter((_,i)=>i!==ln.poIdx)});
            const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPO(null);nf('PO deleted');
          }}><Icon name="trash" size={10}/> Delete PO</button>
          <button className="btn btn-primary" onClick={()=>setEditPO(null)}>Close</button>
        </div>
      </div></div>})()}

    {/* PO — Email Vendor modal: sends the same SO-format PDF as Download PDF, pre-fills the vendor's contact_email */}
    {poEmail&&<div className="modal-overlay" onClick={()=>{if(!poEmail.sending)setPoEmail(null)}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
      <div className="modal-header"><h2>📧 Email PO {poEmail.poId} to Vendor</h2><button className="modal-close" onClick={()=>{if(!poEmail.sending)setPoEmail(null)}}>x</button></div>
      <div className="modal-body">
        <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>Vendor: <strong style={{color:'#0f172a'}}>{poEmail.vendorName}</strong> · PDF attached: <strong style={{color:'#0f172a'}}>{poEmail.filename}.pdf</strong></div>
        <div style={{marginBottom:10}}>
          <label className="form-label" style={{fontSize:11}}>To{!poEmail.to&&<span style={{color:'#dc2626',marginLeft:6}}>⚠ No email on vendor record</span>}</label>
          <input className="form-input" type="email" value={poEmail.to} onChange={e=>setPoEmail(p=>({...p,to:e.target.value}))} placeholder="vendor@example.com"/>
        </div>
        <div style={{marginBottom:10}}>
          <label className="form-label" style={{fontSize:11}}>Subject</label>
          <input className="form-input" value={poEmail.subject} onChange={e=>setPoEmail(p=>({...p,subject:e.target.value}))}/>
        </div>
        <div style={{marginBottom:4}}>
          <label className="form-label" style={{fontSize:11}}>Message</label>
          <textarea className="form-input" rows={9} value={poEmail.message} onChange={e=>setPoEmail(p=>({...p,message:e.target.value}))} style={{fontSize:12,resize:'vertical',fontFamily:'inherit'}}/>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" disabled={poEmail.sending} onClick={()=>setPoEmail(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={poEmail.sending||!poEmail.to||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(poEmail.to.trim())} onClick={async()=>{
          setPoEmail(p=>({...p,sending:true}));
          try{
            const attach=await buildPdfAttachment(poEmail.docOpts,poEmail.filename);
            const html=buildBrandedEmailHtml('<div style="white-space:pre-wrap">'+poEmail.message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>',_ci);
            const res=await sendBrevoEmail({
              to:[{email:poEmail.to.trim(),name:poEmail.vendorName}],
              subject:poEmail.subject,
              htmlContent:html,
              senderName:cu?.name||'National Sports Apparel',
              senderEmail:'noreply@nationalsportsapparel.com',
              replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined,
              attachment:[attach],
            });
            if(res.ok){
              nf('PO '+poEmail.poId+' emailed to '+poEmail.to);
              // Record send on the PO line so it shows in history.
              const sentEntry={sent_at:new Date().toLocaleString(),sent_by:cu?.name||cu?.id||'',to:poEmail.to,method:'email',messageId:res.messageId||null};
              const updatedItems=o.items.map((it,i)=>i===poEmail.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===poEmail.poIdx?{...p,email_history:[...(p.email_history||[]),sentEntry]}:p)}:it);
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);
              setPoEmail(null);
            }else{
              nf('Failed to send: '+(res.error||'Unknown error'),'error');
              setPoEmail(p=>({...p,sending:false}));
            }
          }catch(err){
            console.warn('PO email send failed:',err);
            nf('Send failed: '+(err?.message||'unknown'),'error');
            setPoEmail(p=>({...p,sending:false}));
          }
        }}>{poEmail.sending?'Sending...':'📧 Send Email'}</button>
      </div>
    </div></div>}

    {/* PO FULL PAGE VIEW */}
    {poFullPage&&(()=>{
      // Decoration POs (so.deco_pos) — cost buckets, not per-item line items. Render a
      // simplified view: header, totals card, bills history, tracking, notes. Reuse the
      // outer wrapper by synthesizing a fake "po" shape so the existing JSX below works.
      if(poFullPage.decoPo){
        const dp=poFullPage.decoPo;const soId=poFullPage.soId;const soItems=poFullPage.soItems||[];
        const expected=safeNum(dp.expected_cost||dp.qty*dp.unit_cost);
        const actual=safeNum(dp._bill_cost||0);
        const coveredItems=(dp.item_idxs||[]).map(ii=>soItems[ii]).filter(Boolean);
        return<div className="po-fullpage">
          <div style={{maxWidth:900,margin:'0 auto',padding:'24px 20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setPoFullPage(null)}>&larr; Back</button>
                <h1 style={{margin:0,fontSize:22}}>{dp.po_id}</h1>
                <button className="btn btn-sm" style={{background:'#fee2e2',color:'#b91c1c',border:'1px solid #fecaca',fontWeight:700}} onClick={()=>{
                  if(!window.confirm('Delete decoration PO '+(dp.po_id||'')+'? This removes it from '+(soId||'this order')+' and unlinks the covered items. This cannot be undone.'))return;
                  const updated={...o,deco_pos:(o.deco_pos||[]).filter(x=>dp.id?x.id!==dp.id:x.po_id!==dp.po_id),updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setPoFullPage(null);nf('Deleted '+(dp.po_id||'decoration PO'));
                }}>🗑 Delete PO</button>
                <span className={`badge ${dp.status==='billed'||dp.status==='received'?'badge-green':dp.status==='ordered'?'badge-blue':'badge-gray'}`} style={{fontSize:11}}>{(dp.status||'waiting').replace(/^./,c=>c.toUpperCase())}</span>
                <span className="badge badge-blue" style={{fontSize:10}}>Decoration PO</span>
                {dp.preexisting&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:700}}>Preexisting</span>}
                {dp.drop_ship&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,background:'#ede9fe',color:'#7c3aed',fontWeight:700}}>Drop Ship</span>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'#64748b'}}>SO: <span style={{fontWeight:700,color:'#1e40af',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setPoFullPage(null)} title="Back to Sales Order">{soId}</span></div>
                <div style={{fontSize:11,color:'#64748b'}}>Vendor: <strong>{dp.vendor||'—'}</strong></div>
                {dp.deco_type&&<div style={{fontSize:11,color:'#64748b'}}>Type: {dp.deco_type.replace(/_/g,' ')}</div>}
                {dp.created_at&&<div style={{fontSize:10,color:'#94a3b8'}}>Created: {dp.created_at}</div>}
                {dp.expected_date&&<div style={{fontSize:10,color:'#94a3b8'}}>Expected return: {dp.expected_date}</div>}
              </div>
            </div>
            <div className="card" style={{marginBottom:16,background:'#0f172a',color:'white'}}>
              <div className="card-body" style={{display:'flex',justifyContent:'space-around',textAlign:'center',padding:'16px 12px'}}>
                <div><div style={{fontSize:11,opacity:0.7}}>Units Covered</div><div style={{fontSize:24,fontWeight:800}}>{dp.qty||0}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Unit Cost</div><div style={{fontSize:24,fontWeight:800}}>${safeNum(dp.unit_cost).toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Expected</div><div style={{fontSize:24,fontWeight:800,color:'#fbbf24'}}>${expected.toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Actual (billed)</div><div style={{fontSize:24,fontWeight:800,color:actual>0?'#4ade80':'#94a3b8'}}>${actual.toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Bills</div><div style={{fontSize:24,fontWeight:800,color:'#38bdf8'}}>{(dp._bill_details||[]).length}</div></div>
              </div>
            </div>
            {coveredItems.length>0&&<div className="card" style={{marginBottom:16}}>
              <div className="card-header"><h2>Items covered (for price-list lookup and badges)</h2></div>
              <div className="card-body"><div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {coveredItems.map((it,i)=><span key={i} style={{padding:'6px 10px',borderRadius:6,background:'#faf5ff',border:'1px solid #ede9fe',fontSize:12}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#7c3aed'}}>{it.sku}</span>{' '}<strong>{it.name}</strong>{it.color?' — '+it.color:''}</span>)}
              </div></div>
            </div>}
            {dp.notes&&<div className="card" style={{marginBottom:16}}><div className="card-header"><h2>Notes</h2></div><div className="card-body"><div style={{fontSize:13,whiteSpace:'pre-wrap'}}>{dp.notes}</div></div></div>}
            {(dp.tracking_numbers||[]).length>0&&<div className="card" style={{marginBottom:16,borderLeft:'3px solid #1e40af'}}>
              <div className="card-header" style={{background:'#eff6ff'}}><h2 style={{color:'#1e40af'}}>Tracking Numbers</h2></div>
              <div className="card-body"><div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {dp.tracking_numbers.map((tn,i)=><span key={i} style={{fontFamily:'monospace',fontSize:12,padding:'4px 10px',borderRadius:6,background:'#eff6ff',color:'#1e40af',fontWeight:700}}>{tn}</span>)}
              </div></div>
            </div>}
            {(dp._bill_details||[]).length>0&&<div className="card" style={{marginBottom:16,borderLeft:'3px solid #166534'}}>
              <div className="card-header" style={{background:'#f0fdf4'}}><h2 style={{color:'#166534'}}>Billing Details ({dp._bill_details.length})</h2></div>
              <div className="card-body"><table style={{width:'100%',fontSize:12}}>
                <thead><tr style={{borderBottom:'1px solid #e2e8f0'}}><th style={{padding:'4px 8px',textAlign:'left'}}>Doc #</th><th style={{padding:'4px 8px',textAlign:'left'}}>Date</th><th style={{padding:'4px 8px',textAlign:'left'}}>Supplier</th><th style={{padding:'4px 8px',textAlign:'right'}}>Cost</th><th style={{padding:'4px 8px',textAlign:'right'}}>Freight</th><th style={{padding:'4px 8px',textAlign:'left'}}>Tracking</th></tr></thead>
                <tbody>{dp._bill_details.map((bd,bi)=><tr key={bi} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td style={{padding:'4px 8px',fontFamily:'monospace'}}>{bd.doc||'—'}</td>
                  <td style={{padding:'4px 8px'}}>{bd.date||'—'}</td>
                  <td style={{padding:'4px 8px'}}>{bd.supplier||'—'}</td>
                  <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700,color:'#166534'}}>${safeNum(bd.cost).toFixed(2)}</td>
                  <td style={{padding:'4px 8px',textAlign:'right',color:'#64748b'}}>{bd.freight?'$'+safeNum(bd.freight).toFixed(2):'—'}</td>
                  <td style={{padding:'4px 8px',fontFamily:'monospace',fontSize:11}}>{bd.tracking||'—'}</td>
                </tr>)}</tbody>
              </table></div>
            </div>}
          </div>
        </div>;
      }
      const{po,item,allLines,soId,soItems}=poFullPage;
      const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof po[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
      const received=po.received||{};const cancelled=po.cancelled||{};const shipments=po.shipments||[];
      const getRcvd=sz=>(received[sz]||0);const getCncl=sz=>(cancelled[sz]||0);const getOpen=sz=>Math.max(0,(po[sz]||0)-getRcvd(sz)-getCncl(sz));
      const totalOrdered=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);const totalReceived=szKeys.reduce((a,sz)=>a+getRcvd(sz),0);
      const totalCancelled=szKeys.reduce((a,sz)=>a+getCncl(sz),0);const totalOpen=szKeys.reduce((a,sz)=>a+getOpen(sz),0);
      const isDropShipFP=!!po.drop_ship;const totalBilledFP=szKeys.reduce((a,sz)=>a+((po.billed||{})[sz]||0),0);const trackNumsFP=po.tracking_numbers||[];
      const poStatus=isDropShipFP?(totalBilledFP>=totalOrdered&&totalOrdered>0?'shipped':totalBilledFP>0?'partial':'waiting'):(totalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting');
      const unitCost=po.unit_cost!=null?safeNum(po.unit_cost):safeNum(item?.nsa_cost);
      const poTotal=totalOrdered*unitCost;
      const vendorName=po.deco_vendor||D_V.find(v=>v.id===(item?.vendor_id||item?.brand))?.name||item?.brand||'';
      // Gather all items on this PO from the SO
      const poItems=(allLines||[{lineIdx:0}]).map(ln=>({item:soItems?.[ln.lineIdx],po:soItems?.[ln.lineIdx]?.po_lines?.find(p=>p.po_id===po.po_id)||po})).filter(x=>x.item);
      const grandTotal=poItems.reduce((a,{item:it,po:p})=>{
        const sk=Object.keys(p).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof p[k]==='number');
        const qty=sk.reduce((s,sz)=>s+(p[sz]||0),0);const uc=p.unit_cost!=null?safeNum(p.unit_cost):safeNum(it.nsa_cost);return a+qty*uc},0);
      // Decoration PO (service, not per-size goods): sum _bill_cost across po_lines for the
      // deco total; sum _bill_details[].freight for the shipping attributed to this PO.
      const isDecoPO=po.po_type==='outside_deco';
      const decoBillDetails=isDecoPO?poItems.flatMap(({po:p})=>p._bill_details||[]):[];
      const decoCostTotal=isDecoPO?poItems.reduce((a,{po:p})=>a+safeNum(p._bill_cost||0),0):0;
      const decoShipTotal=isDecoPO?decoBillDetails.reduce((a,bd)=>a+safeNum(bd.freight||0),0):0;
      const decoGrand=decoCostTotal+decoShipTotal;
      // Grand totals across every line on this PO (the original code summed only the active line,
      // so multi-SKU POs displayed only the first line's units in the summary banner).
      const NON_SZ_PO=['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type','notes'];
      const allLineSz=poItems.map(({item:it,po:p})=>{
        const sk=Object.keys(p).filter(k=>!k.startsWith('_')&&!NON_SZ_PO.includes(k)&&typeof p[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
        const rcvd=p.received||{};const cncl=p.cancelled||{};const billed=p.billed||{};
        const ordered=sk.reduce((a,sz)=>a+(p[sz]||0),0);
        const received=sk.reduce((a,sz)=>a+(rcvd[sz]||0),0);
        const cancelled=sk.reduce((a,sz)=>a+(cncl[sz]||0),0);
        const billedT=sk.reduce((a,sz)=>a+(billed[sz]||0),0);
        const open=sk.reduce((a,sz)=>a+Math.max(0,(p[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0)),0);
        return{item:it,po:p,szKeys:sk,ordered,received,cancelled,billedT,open,getRcvd:sz=>rcvd[sz]||0,getCncl:sz=>cncl[sz]||0,getBilled:sz=>billed[sz]||0,getOpen:sz=>Math.max(0,(p[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0))};
      });
      const grandOrdered=allLineSz.reduce((a,x)=>a+x.ordered,0);
      const grandReceived=allLineSz.reduce((a,x)=>a+x.received,0);
      const grandCancelled=allLineSz.reduce((a,x)=>a+x.cancelled,0);
      const grandBilled=allLineSz.reduce((a,x)=>a+x.billedT,0);
      const grandOpen=allLineSz.reduce((a,x)=>a+x.open,0);
      // Status across the whole PO (all lines), not just the active line, so the header badge
      // doesn't read "Fully Received" when only one of several lines is done.
      const poStatusWide=isDropShipFP?(grandBilled>=grandOrdered&&grandOrdered>0?'shipped':grandBilled>0?'partial':'waiting'):(grandOpen<=0&&grandReceived>0?'received':grandReceived>0?'partial':'waiting');
      return<div className="po-fullpage">
        <div style={{maxWidth:900,margin:'0 auto',padding:'24px 20px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPoFullPage(null)}>&larr; Back</button>
              <h1 style={{margin:0,fontSize:22}}>{po.po_id} {poFullPage.customerTag||''}</h1>
              <span className={`badge ${poStatusWide==='received'||poStatusWide==='shipped'?'badge-green':poStatusWide==='partial'?'badge-amber':'badge-gray'}`} style={{fontSize:11}}>{poStatusWide==='shipped'?'Shipped':poStatusWide==='received'?'Fully Received':poStatusWide==='partial'?'Partial':'Waiting'}</span>
              {po.status==='queued'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#fef3c7',color:'#b45309'}}>Queued in batch</span>}
              {po.batch_po_number&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#f5f3ff',color:'#7c3aed',fontFamily:'monospace'}}>Batch: {po.batch_po_number}</span>}
              {isDropShipFP&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
              {po.po_type==='outside_deco'&&<span className="badge badge-blue" style={{fontSize:10}}>Decoration PO</span>}
              <button className="btn btn-sm btn-secondary" style={{marginLeft:8,fontSize:11}} onClick={()=>{setEditPO({lineIdx:allLines?.[0]?.lineIdx||0,poIdx:soItems?.[allLines?.[0]?.lineIdx]?.po_lines?.findIndex(p=>p.po_id===po.po_id)||0,po,allLines:allLines||[{lineIdx:0,poIdx:0}]});setPoFullPage(null)}}>Edit PO</button>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#64748b'}}>SO: <span style={{fontWeight:700,color:'#1e40af',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setPoFullPage(null)} title="Back to Sales Order">{soId}</span></div>
              <div style={{fontSize:11,color:'#64748b'}}>Vendor: <strong>{vendorName}</strong></div>
              {po.created_at&&<div style={{fontSize:10,color:'#94a3b8'}}>Created: {po.created_at}</div>}
              {po.expected_date&&<div style={{fontSize:10,color:'#94a3b8'}}>Expected: {po.expected_date}</div>}
            </div>
          </div>

          {/* PO Total Summary */}
          <div className="card" style={{marginBottom:16,background:'#0f172a',color:'white'}}>
            <div className="card-body" style={{display:'flex',justifyContent:'space-around',textAlign:'center',padding:'16px 12px'}}>
              {isDecoPO?<>
                <div><div style={{fontSize:11,opacity:0.7}}>Decoration</div><div style={{fontSize:24,fontWeight:800}}>${decoCostTotal.toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Shipping</div><div style={{fontSize:24,fontWeight:800,color:'#fbbf24'}}>${decoShipTotal.toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>Bills Applied</div><div style={{fontSize:24,fontWeight:800,color:'#4ade80'}}>{decoBillDetails.length}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>PO Total</div><div style={{fontSize:24,fontWeight:800,color:'#38bdf8'}}>${decoGrand.toFixed(2)}</div></div>
              </>:<>
                <div><div style={{fontSize:11,opacity:0.7}}>Total Units</div><div style={{fontSize:24,fontWeight:800}}>{grandOrdered}</div></div>
                {isDropShipFP?<div><div style={{fontSize:11,opacity:0.7}}>Billed</div><div style={{fontSize:24,fontWeight:800,color:grandBilled>=grandOrdered?'#4ade80':'#fbbf24'}}>{grandBilled}</div></div>
                :<div><div style={{fontSize:11,opacity:0.7}}>Received</div><div style={{fontSize:24,fontWeight:800,color:'#4ade80'}}>{grandReceived}</div></div>}
                {!isDropShipFP&&<div><div style={{fontSize:11,opacity:0.7}}>Open</div><div style={{fontSize:24,fontWeight:800,color:grandOpen>0?'#fbbf24':'#4ade80'}}>{grandOpen}</div></div>}
                <div><div style={{fontSize:11,opacity:0.7}}>Unit Cost</div><div style={{fontSize:24,fontWeight:800}}>${unitCost.toFixed(2)}</div></div>
                <div><div style={{fontSize:11,opacity:0.7}}>PO Total</div><div style={{fontSize:24,fontWeight:800,color:'#38bdf8'}}>${grandTotal.toFixed(2)}</div></div>
              </>}
            </div>
          </div>

          {/* Items on this PO — hidden for decoration POs (they're a service, not per-size goods) */}
          {!isDecoPO&&<div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>Line Items</h2></div>
            <div className="card-body">
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead><tr style={{borderBottom:'2px solid #0f172a'}}>
                  <th style={{padding:'6px 8px',textAlign:'left'}}>SKU</th>
                  <th style={{padding:'6px 8px',textAlign:'left'}}>Product</th>
                  <th style={{padding:'6px 8px',textAlign:'left'}}>Color</th>
                  <th style={{padding:'6px 8px',textAlign:'center'}}>Qty</th>
                  <th style={{padding:'6px 8px',textAlign:'right'}}>Unit Cost</th>
                  <th style={{padding:'6px 8px',textAlign:'right'}}>Line Total</th>
                </tr></thead>
                <tbody>
                  {poItems.map(({item:it,po:p},idx)=>{
                    const sk=Object.keys(p).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof p[k]==='number');
                    const qty=sk.reduce((s,sz)=>s+(p[sz]||0),0);const uc=p.unit_cost!=null?safeNum(p.unit_cost):safeNum(it.nsa_cost);
                    return<tr key={idx} style={{borderBottom:'1px solid #e2e8f0'}}>
                      <td style={{padding:'6px 8px',fontFamily:'monospace',fontWeight:800,color:'#1e40af'}}>{it.sku}</td>
                      <td style={{padding:'6px 8px',fontWeight:600}}>{it.name}</td>
                      <td style={{padding:'6px 8px',color:'#64748b'}}>{it.color}</td>
                      <td style={{padding:'6px 8px',textAlign:'center',fontWeight:700}}>{qty}<div style={{fontSize:10,color:'#94a3b8'}}>{sk.map(sz=>sz+':'+p[sz]).join(' ')}</div></td>
                      <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600}}>${uc.toFixed(2)}</td>
                      <td style={{padding:'6px 8px',textAlign:'right',fontWeight:800,fontSize:14}}>${(qty*uc).toFixed(2)}</td>
                    </tr>})}
                  <tr style={{borderTop:'2px solid #0f172a',fontWeight:800}}>
                    <td colSpan={3} style={{padding:'6px 8px',textAlign:'right'}}>Grand Total</td>
                    <td style={{padding:'6px 8px',textAlign:'center'}}>{grandOrdered}</td>
                    <td></td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontSize:16,color:'#166534'}}>${grandTotal.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>}

          {/* Size Breakdown — one table per line item (multi-SKU/color POs need each item's own grid) */}
          {!isDecoPO&&<div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>Size Breakdown</h2></div>
            <div className="card-body">
              {allLineSz.map((x,xi)=>{
                const allSz=x.szKeys;
                return<div key={xi} style={{marginBottom:xi<allLineSz.length-1?14:0}}>
                  {allLineSz.length>1&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                    <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:12}}>{x.item.sku}</span>
                    <span style={{fontWeight:600,fontSize:13}}>{x.item.name}</span>
                    {x.item.color&&<span className="badge badge-gray">{x.item.color}</span>}
                    <span style={{marginLeft:'auto',fontSize:11,color:'#64748b'}}>{x.ordered} ordered{!isDropShipFP?' · '+x.received+' rcvd · '+x.open+' open':' · '+x.billedT+' billed'}</span>
                  </div>}
                  <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                    <thead><tr style={{borderBottom:'2px solid #0f172a'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}></th>{allSz.map(sz=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:48}}>{sz}</th>)}<th style={{padding:'4px 8px',textAlign:'center'}}>TOTAL</th></tr></thead>
                    <tbody>
                      <tr><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Ordered</td>{allSz.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700}}>{x.po[sz]||0}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{x.ordered}</td></tr>
                      {isDropShipFP?<tr style={{color:'#1e40af'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Billed</td>{allSz.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:x.getBilled(sz)>0?'#1e40af':'#d1d5db'}}>{x.getBilled(sz)||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{x.billedT}</td></tr>
                      :<tr style={{color:'#166534'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Received</td>{allSz.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:x.getRcvd(sz)>0?'#166534':'#d1d5db'}}>{x.getRcvd(sz)||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{x.received}</td></tr>}
                      {x.cancelled>0&&<tr style={{color:'#dc2626'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Cancelled</td>{allSz.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:x.getCncl(sz)>0?'#dc2626':'#d1d5db'}}>{x.getCncl(sz)||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{x.cancelled}</td></tr>}
                      {x.open>0&&!isDropShipFP&&<tr style={{borderTop:'1px solid #e2e8f0',color:'#b45309'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Open</td>{allSz.map(sz=>{const op=x.getOpen(sz);return<td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:op>0?'#b45309':'#d1d5db'}}>{op>0?op:'—'}</td>})}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{x.open}</td></tr>}
                    </tbody>
                  </table>
                </div>;
              })}
            </div>
          </div>}

          {/* Tracking Numbers from Bill Uploads */}
          {trackNumsFP.length>0&&(()=>{const trackUrl=tn=>{if(/^1Z/i.test(tn))return'https://www.ups.com/track?tracknum='+tn;if(/^(94|93|92|91)\d{18,}/.test(tn))return'https://tools.usps.com/go/TrackConfirmAction?tLabels='+tn;return'https://www.fedex.com/fedextrack/?trknbr='+tn};return<div className="card" style={{marginBottom:16,borderLeft:'3px solid #1e40af'}}>
            <div className="card-header" style={{background:'#eff6ff'}}><h2 style={{color:'#1e40af'}}>Tracking Numbers</h2></div>
            <div className="card-body">
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{trackNumsFP.map((tn,ti)=><a key={ti} href={trackUrl(tn)} target="_blank" rel="noreferrer" style={{fontFamily:'monospace',fontSize:13,fontWeight:700,color:'#1e40af',background:'#dbeafe',padding:'4px 12px',borderRadius:6,textDecoration:'none',display:'inline-block'}}>{tn}</a>)}</div>
            </div>
          </div>})()}

          {/* Billing Details from Supplier Bills */}
          {(()=>{const allBillDetails=poItems.flatMap(({item:it,po:p})=>(p._bill_details||[]).map(bd=>({...bd,sku:it.sku,name:it.name,color:it.color})));
            return allBillDetails.length>0?<div className="card" style={{marginBottom:16,borderLeft:'3px solid #6366f1'}}>
              <div className="card-header" style={{background:'#eef2ff'}}><h2 style={{color:'#4338ca'}}>Billing Details ({allBillDetails.length})</h2></div>
              <div className="card-body">
                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                  <thead><tr style={{borderBottom:'2px solid #e2e8f0'}}>
                    <th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>DATE</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>DOC #</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>ITEM</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>SIZES BILLED</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>TRACKING</th>
                  </tr></thead>
                  <tbody>{allBillDetails.map((bd,bi)=>{const szStr=Object.entries(bd.sizes||{}).filter(([,v])=>v>0).sort(([a],[b])=>SZ_ORD.indexOf(a)-SZ_ORD.indexOf(b)).map(([s,q])=>s+':'+q).join('  ');
                    const bdQty=Object.values(bd.sizes||{}).reduce((a,v)=>a+v,0);
                    return<tr key={bi} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'6px 8px',fontWeight:600}}>{bd.date||'—'}</td>
                      <td style={{padding:'6px 8px',fontFamily:'monospace',color:'#6366f1'}}>{bd.doc||'—'}</td>
                      <td style={{padding:'6px 8px'}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{bd.sku}</span> <span style={{color:'#64748b'}}>{bd.color}</span></td>
                      <td style={{padding:'6px 8px'}}><span style={{fontFamily:'monospace',fontWeight:600}}>{szStr}</span><span style={{fontSize:10,color:'#94a3b8',marginLeft:6}}>({bdQty} units)</span></td>
                      <td style={{padding:'6px 8px'}}>{bd.tracking?<span style={{fontFamily:'monospace',fontSize:11,fontWeight:600,color:'#1e40af',background:'#dbeafe',padding:'2px 6px',borderRadius:4}}>{bd.tracking}</span>:'—'}</td>
                    </tr>})}</tbody>
                </table>
              </div>
            </div>:null})()}

          {/* Shipment History — walk every line on this PO so multi-SKU POs show every receipt with its SKU/color */}
          {(()=>{
            const NON_SZ=['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type','notes'];
            const allShipments=[];
            (allLines||[{lineIdx:0}]).forEach(ln=>{
              const it=o.items?.[ln.lineIdx];if(!it)return;
              const pl=it.po_lines?.find(p=>p.po_id===po.po_id);if(!pl)return;
              const sk=Object.keys(pl).filter(k=>!k.startsWith('_')&&!NON_SZ.includes(k)&&typeof pl[k]==='number');
              (pl.shipments||[]).forEach((sh,si)=>{
                const sizes={};sk.forEach(sz=>{if(sh[sz]>0)sizes[sz]=sh[sz]});
                const qty=Object.values(sizes).reduce((a,v)=>a+v,0);
                if(qty===0&&!sh.memo&&!sh.date)return;
                allShipments.push({lineIdx:ln.lineIdx,poIdx:it.po_lines.indexOf(pl),shipIdx:si,date:sh.date||'',sizes,qty,memo:sh.memo||'',sku:it.sku,name:it.name,color:it.color||'',szKeys:sk,raw:sh});
              });
            });
            // Newest first within each line, but globally sort by date desc with original index as tiebreaker
            allShipments.sort((a,b)=>{const dA=a.date||'';const dB=b.date||'';if(dA===dB)return a.shipIdx-b.shipIdx;return dB.localeCompare(dA)});
            if(allShipments.length===0)return null;
            const fpEdit=poFullPage._editShip||null;// `${lineIdx}-${shipIdx}`
            const isEditing=key=>fpEdit===key;
            const writeShipUpdate=(lineIdx,poIdx,newShipmentsBuilder)=>{
              const it=o.items[lineIdx];if(!it)return;
              const pl=it.po_lines[poIdx];if(!pl)return;
              const sk=Object.keys(pl).filter(k=>!k.startsWith('_')&&!NON_SZ.includes(k)&&typeof pl[k]==='number');
              const newShipments=newShipmentsBuilder(pl.shipments||[]);
              const newReceived={};newShipments.forEach(s=>{sk.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
              const newTotalOpen=sk.reduce((a,sz)=>a+Math.max(0,(pl[sz]||0)-(newReceived[sz]||0)-((pl.cancelled||{})[sz]||0)),0);
              const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
              const updatedPO={...pl,received:newReceived,shipments:newShipments,status:newStatus};
              const updatedItems=o.items.map((it2,i)=>i===lineIdx?{...it2,po_lines:it2.po_lines.map((p,j)=>j===poIdx?updatedPO:p)}:it2);
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);
              // If the active editPO row is this one, refresh its snapshot too
              setPoFullPage(prev=>prev?{...prev,po:lineIdx===prev.allLines?.[0]?.lineIdx?updatedPO:prev.po,_editShip:null}:prev);
              return updatedPO;
            };
            return<div className="card" style={{marginBottom:16}}>
              <div className="card-header"><h2>{isDropShipFP?'Billing':'Shipment'} History ({allShipments.length})</h2></div>
              <div className="card-body">
                {allShipments.map((sh,gi)=>{const key=sh.lineIdx+'-'+sh.shipIdx;const editing=isEditing(key);return<div key={key} style={{border:'1px solid '+(editing?'#bfdbfe':'#e2e8f0'),borderRadius:6,marginBottom:8,background:editing?'#eff6ff':(gi%2===0?'#f8fafc':'#fff')}}>
                  <div style={{padding:'10px 12px',display:'flex',alignItems:'center',gap:10,cursor:'pointer',flexWrap:'wrap'}} onClick={()=>setPoFullPage(p=>({...p,_editShip:editing?null:key}))}>
                    <span style={{fontWeight:700,fontSize:13,color:'#166534',whiteSpace:'nowrap'}}>📦 {sh.date||'No date'}</span>
                    <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:11}}>{sh.sku}</span>
                    <span style={{fontSize:12,fontWeight:600}}>{sh.name}</span>
                    {sh.color&&<span style={{fontSize:11,color:'#64748b'}}>{sh.color}</span>}
                    <div style={{display:'flex',gap:5,flexWrap:'wrap',marginLeft:8}}>
                      {Object.entries(sh.sizes).map(([sz,q])=><span key={sz} style={{padding:'2px 7px',background:'#dcfce7',color:'#166534',borderRadius:4,fontWeight:700,fontSize:11}}>{sz}:{q}</span>)}
                    </div>
                    <span style={{marginLeft:'auto',fontWeight:800,fontSize:13}}>{sh.qty} units</span>
                    <span style={{fontSize:10,color:'#64748b'}}>{editing?'▲ close':'✏️ edit'}</span>
                  </div>
                  {sh.memo&&!editing&&<div style={{padding:'0 12px 8px',fontSize:11,color:'#475569',fontStyle:'italic'}}>{sh.memo}</div>}
                  {editing&&<div style={{padding:'10px 12px',borderTop:'1px solid #bfdbfe'}}>
                    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
                      <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
                      <input type="date" id={'fp-sh-date-'+key} className="form-input" style={{width:150,fontSize:12}} defaultValue={sh.date}/>
                      <span style={{fontSize:11,fontWeight:600,color:'#64748b',marginLeft:6}}>Quantities:</span>
                      {sh.szKeys.map(sz=><div key={sz} style={{textAlign:'center'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                        <input id={'fp-sh-'+key+'-'+sz} style={{width:44,textAlign:'center',border:'1px solid #93c5fd',borderRadius:4,padding:'3px 2px',fontSize:13,fontWeight:700,background:'white'}} defaultValue={sh.sizes[sz]||0}/>
                      </div>)}
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>{
                        const dateEl=document.getElementById('fp-sh-date-'+key);
                        const updatedSh={date:dateEl?.value||sh.date};
                        sh.szKeys.forEach(sz=>{const el=document.getElementById('fp-sh-'+key+'-'+sz);if(el){const v=parseInt(el.value)||0;if(v>0)updatedSh[sz]=v}});
                        if(sh.raw.memo)updatedSh.memo=sh.raw.memo;
                        writeShipUpdate(sh.lineIdx,sh.poIdx,prev=>prev.map((s,i)=>i===sh.shipIdx?updatedSh:s));
                        nf('Shipment updated');
                      }}>Save</button>
                      <button className="btn btn-sm" style={{background:'#dc2626',color:'white',fontSize:11}} onClick={()=>{
                        if(!window.confirm('Delete this shipment? Received quantities will be recalculated.'))return;
                        writeShipUpdate(sh.lineIdx,sh.poIdx,prev=>prev.filter((_,i)=>i!==sh.shipIdx));
                        nf('Shipment deleted');
                      }}><Icon name="trash" size={10}/> Delete</button>
                      <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>setPoFullPage(p=>({...p,_editShip:null}))}>Cancel</button>
                    </div>
                  </div>}
                </div>;})}
              </div>
            </div>;
          })()}

          {po.memo&&<div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>Notes</h2></div>
            <div className="card-body"><p style={{margin:0,fontSize:13,color:'#475569'}}>{po.memo}</p></div>
          </div>}

          {/* Receive Shipment — inline on full page, click-to-add multi-item.
              Hidden for decoration POs (service, not size-based goods). */}
          {grandOpen>0&&!isDropShipFP&&!isDecoPO&&(()=>{
            const allFpRecvLines=(allLines||[{lineIdx:0}]).map((ln,li)=>{
              const it=soItems?.[ln.lineIdx];const p=it?.po_lines?.find(pl=>pl.po_id===po.po_id);if(!it||!p)return null;
              const sk=Object.keys(p).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&k!=='shipping'&&typeof p[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
              const rcvd=p.received||{};const cncl=p.cancelled||{};
              const getOp=sz=>Math.max(0,(p[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0));
              const hasOp=sk.some(sz=>getOp(sz)>0);
              const poIdx=it.po_lines.findIndex(pl=>pl.po_id===po.po_id);
              return hasOp?{li,ln:{lineIdx:ln.lineIdx,poIdx},item:it,po:p,szKeys:sk,rcvd,cncl,getOp}:null;
            }).filter(Boolean);
            if(!allFpRecvLines.length)return null;
            // For single-item POs auto-select; multi-item starts empty
            const fpSelectedIdxs=allFpRecvLines.length<=1?[0]:(poFullPage._selectedFpRecvLines||[]);
            const fpRecvLines=allFpRecvLines.filter(r=>fpSelectedIdxs.includes(r.li));
            return<div className="card" style={{marginBottom:16,borderLeft:'3px solid #22c55e'}}>
            <div className="card-header" style={{background:'#f0fdf4'}}><h2 style={{color:'#166534'}}>Receive Shipment{fpRecvLines.length>0&&fpRecvLines.length>1?' ('+fpRecvLines.length+' items)':''}</h2></div>
            <div className="card-body">
              {/* Clickable item pills */}
              {allFpRecvLines.length>1&&<div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:6}}>Click items that arrived in this shipment:</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {allFpRecvLines.map(r=>{const isSel=fpSelectedIdxs.includes(r.li);return<div key={r.li} style={{padding:'5px 10px',borderRadius:6,cursor:'pointer',border:isSel?'2px solid #22c55e':'1px dashed #94a3b8',background:isSel?'#dcfce7':'white',fontSize:12,display:'flex',gap:5,alignItems:'center',transition:'all 0.15s'}} onClick={()=>setPoFullPage(p=>{const prev=p._selectedFpRecvLines||[];return{...p,_selectedFpRecvLines:isSel?prev.filter(x=>x!==r.li):[...prev,r.li]}})}>
                    {isSel?<span style={{color:'#16a34a',fontWeight:800,fontSize:14}}>✓</span>:<span style={{color:'#94a3b8',fontSize:14}}>+</span>}
                    <span style={{fontFamily:'monospace',fontWeight:700,color:isSel?'#1e40af':'#64748b'}}>{r.item.sku}</span>
                    <span style={{fontWeight:600,color:isSel?'#0f172a':'#94a3b8'}}>{r.item.name}</span>
                    <span style={{color:isSel?'#64748b':'#cbd5e1'}}>{r.item.color}</span>
                  </div>})}
                </div>
                {allFpRecvLines.length>2&&<div style={{marginTop:6}}>
                  <button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#16a34a',textDecoration:'underline',padding:0}} onClick={()=>setPoFullPage(p=>({...p,_selectedFpRecvLines:allFpRecvLines.map(r=>r.li)}))}>Select all</button>
                  {fpSelectedIdxs.length>0&&<button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#64748b',textDecoration:'underline',padding:0,marginLeft:12}} onClick={()=>setPoFullPage(p=>({...p,_selectedFpRecvLines:[]}))}>Clear</button>}
                </div>}
              </div>}
              {fpRecvLines.length>0&&<>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Date:</span>
                <input type="date" id="po-fp-recv-date" className="form-input" style={{width:150,fontSize:12}} defaultValue={new Date().toISOString().split('T')[0]}/>
              </div>
              {fpRecvLines.map(({ln,item:rit,szKeys:rsk,getOp})=><div key={ln.lineIdx+'-'+ln.poIdx} style={{marginBottom:10,padding:fpRecvLines.length>1?'8px 10px':'0',background:fpRecvLines.length>1?'#f8fafc':'transparent',borderRadius:6,border:fpRecvLines.length>1?'1px solid #e2e8f0':'none'}}>
                {fpRecvLines.length>1&&<div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                  <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',fontSize:12}}>{rit.sku}</span>
                  <span style={{fontWeight:600,fontSize:12}}>{rit.name}</span>
                  <span style={{fontSize:11,color:'#64748b'}}>{rit.color}</span>
                </div>}
                <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Qty:</span>
                  {rsk.filter(sz=>getOp(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                    <input id={'po-fp-recv-'+ln.lineIdx+'-'+ln.poIdx+'-'+sz} style={{width:48,textAlign:'center',border:'1px solid #22c55e',borderRadius:4,padding:'5px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getOp(sz)}/>
                    <div style={{fontSize:9,color:'#64748b'}}>{getOp(sz)} open</div>
                  </div>)}
                </div>
              </div>)}
              <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>{
                const dateEl=document.getElementById('po-fp-recv-date');
                const date=dateEl?.value||new Date().toLocaleDateString();
                let anyQty=false;
                const updates=fpRecvLines.map(({ln,po:rpo,szKeys:rsk,getOp})=>{
                  const shipment={date};const newReceived={...(rpo.received||{})};
                  rsk.filter(sz=>getOp(sz)>0).forEach(sz=>{
                    const el=document.getElementById('po-fp-recv-'+ln.lineIdx+'-'+ln.poIdx+'-'+sz);
                    const qty=el?parseInt(el.value)||0:0;
                    if(qty>0){shipment[sz]=qty;newReceived[sz]=(newReceived[sz]||0)+qty;anyQty=true}
                  });
                  const newShipments=[...(rpo.shipments||[]),shipment];
                  const newTotalOpen=rsk.reduce((a,sz)=>a+Math.max(0,(rpo[sz]||0)-(newReceived[sz]||0)-((rpo.cancelled||{})[sz]||0)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  return{ln,updatedPO:{...rpo,received:newReceived,shipments:newShipments,status:newStatus}};
                });
                if(!anyQty){nf('Enter quantities to receive','error');return}
                let updatedItems=[...o.items];
                updates.forEach(({ln,updatedPO})=>{updatedItems=updatedItems.map((it,i)=>i===ln.lineIdx?{...it,po_lines:it.po_lines.map((p,j)=>j===ln.poIdx?updatedPO:p)}:it)});
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);
                const firstUpdate=updates[0];
                setPoFullPage({...poFullPage,po:firstUpdate?firstUpdate.updatedPO:po,_selectedFpRecvLines:[]});
                const rcItems=updates.map(({ln,updatedPO})=>{const it=o.items[ln.lineIdx]||{};const rsk=Object.keys(updatedPO).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','billed','tracking_numbers','deco_vendor','deco_type'].includes(k)&&typeof updatedPO[k]==='number');const lastShip=updatedPO.shipments[updatedPO.shipments.length-1]||{};const sizes={};rsk.forEach(sz=>{if(lastShip[sz]>0)sizes[sz]=lastShip[sz]});return{sku:it.sku||'',name:it.name||'',color:it.color||'',sizes,qty:Object.values(sizes).reduce((a,v)=>a+v,0)}}).filter(x=>x.qty>0);
                const rcTotal=rcItems.reduce((a,x)=>a+x.qty,0);
                setReceivedConfirm({poId:po.po_id,soId:o.id,date,custName:cust?.name||'',items:rcItems,totalQty:rcTotal});
              }}>Receive These Items</button>
              </>}
              {fpRecvLines.length===0&&allFpRecvLines.length>1&&<div style={{fontSize:12,color:'#64748b',fontStyle:'italic'}}>Select items above to receive</div>}
            </div>
          </div>})()}

          {/* Edit PO — cancel sizes or add back previously cancelled */}
          {(totalOpen>0||totalCancelled>0)&&!isDropShipFP&&<div className="card" style={{marginBottom:16,borderLeft:'3px solid #f59e0b'}}>
            <div className="card-header" style={{background:'#fffbeb',cursor:'pointer'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}}><h2 style={{color:'#92400e',fontSize:14}}>Edit PO — Cancel / Add Back Sizes</h2></div>
            <div className="card-body" style={{display:'none'}}>
              <div style={{fontSize:12,color:'#92400e',marginBottom:8}}>Set the cancelled quantity for each size. Lower a number to add sizes back; raise it to cancel (cancelled sizes become available for new picks/POs):</div>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                {szKeys.filter(sz=>getOpen(sz)>0||getCncl(sz)>0).map(sz=>{const maxCancel=Math.max(0,(po[sz]||0)-getRcvd(sz));return<div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-fp-cancel-'+sz} style={{width:48,textAlign:'center',border:'1px solid #f59e0b',borderRadius:4,padding:'5px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getCncl(sz)}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open · max {maxCancel}</div>
                </div>})}
              </div>
              <button className="btn btn-sm" style={{background:'#f59e0b',color:'white',fontSize:12}} onClick={()=>{
                const newCancelled={...cancelled};let anyChange=false;
                szKeys.filter(sz=>getOpen(sz)>0||getCncl(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-fp-cancel-'+sz);
                  const maxCancel=Math.max(0,(po[sz]||0)-getRcvd(sz));
                  const qty=el?Math.max(0,Math.min(parseInt(el.value)||0,maxCancel)):getCncl(sz);
                  if(qty!==getCncl(sz))anyChange=true;
                  newCancelled[sz]=qty;
                });
                if(!anyChange){nf('No changes to apply','error');return}
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(received[sz]||0)-(newCancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
                const updatedPO={...po,cancelled:newCancelled,status:newStatus};
                // Update all items on this PO
                const affectedIdxs=new Set((allLines||[{lineIdx:0}]).map(ln=>ln.lineIdx));
                let updatedItems=[...o.items];
                affectedIdxs.forEach(idx=>{updatedItems=updatedItems.map((it,i)=>i===idx?{...it,po_lines:it.po_lines.map(p=>p.po_id===po.po_id?{...p,cancelled:newCancelled,status:newStatus}:p)}:it)});
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setPoFullPage({...poFullPage,po:updatedPO});nf('PO '+po.po_id+' updated');
              }}>✏️ Update PO</button>
            </div>
          </div>}

          {/* Delete PO */}
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:24}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
              if(!window.confirm('Delete entire PO? All sizes will go back to open.'))return;
              const lineIdx=allLines?.[0]?.lineIdx||0;
              const affectedIdxs=new Set((allLines||[{lineIdx}]).map(ln=>ln.lineIdx));
              const updatedItems=o.items.map((it,i)=>affectedIdxs.has(i)?{...it,po_lines:(it.po_lines||[]).filter(p=>p.po_id!==po.po_id)}:it);
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);setPoFullPage(null);nf('PO deleted');
            }}>Delete PO</button>
          </div>
        </div>
      </div>})()}

    {/* EDIT BATCH PO MODAL */}
    {editBatchPO&&(()=>{
      const bp=(batchPOs||[]).find(b=>b.id===editBatchPO.bpo_id);
      if(!bp)return null;
      const bItem=bp.items.find(it=>it.item_idx===editBatchPO.item_idx);
      const szEntries=bItem?Object.entries(bItem.sizes||{}).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0]))):[];
      return<div className="modal-overlay" onClick={()=>setEditBatchPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2 style={{color:'#7c3aed'}}>Batch PO — {bp.vendor_name}</h2>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span className="badge" style={{background:'#fee2e2',color:'#dc2626'}}>Queued</span>
            <button className="modal-close" onClick={()=>setEditBatchPO(null)}>x</button>
          </div>
        </div>
        <div className="modal-body">
          <div style={{padding:'8px 12px',background:'#f8fafc',borderRadius:6,marginBottom:12,fontSize:12}}>
            <div><strong>SO:</strong> {bp.so_id} — {bp.customer}</div>
            <div><strong>Added:</strong> {bp.created_at} by {bp.created_by_name}</div>
            <div><strong>Total:</strong> ${bp.total_cost.toFixed(2)}</div>
          </div>
          {bp.items.map((it,ii)=>{const itSzs=Object.entries(it.sizes||{}).filter(([,v])=>v>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
            return<div key={ii} style={{padding:12,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <div><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:8}}>{it.sku}</span><strong>{it.name}</strong>{it.color?' — '+it.color:''}</div>
                <div style={{fontWeight:700}}>{it.qty} units · ${(it.qty*it.unit_cost).toFixed(2)}</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Qty:</span>
                {itSzs.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'bpo-edit-'+bp.id+'-'+ii+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}
              </div>
            </div>})}
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn btn-sm btn-secondary" style={{fontSize:10,color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
            if(!window.confirm('Remove this batch PO from the queue?'))return;
            if(onBatchPO)onBatchPO(prev=>prev.filter(b=>b.id!==bp.id));
            setEditBatchPO(null);nf('Batch PO removed from queue');
          }}><Icon name="trash" size={10}/> Remove from Queue</button>
          <div style={{display:'flex',gap:6}}>
            <button className="btn btn-secondary" onClick={()=>setEditBatchPO(null)}>Cancel</button>
            <button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>{
              const updatedItems=bp.items.map((it,ii)=>{const itSzs=Object.entries(it.sizes||{}).filter(([,v])=>v>0);
                const newSizes={};let newQty=0;
                itSzs.forEach(([sz])=>{const el=document.getElementById('bpo-edit-'+bp.id+'-'+ii+'-'+sz);const v=el?Math.max(0,parseInt(el.value)||0):0;if(v>0){newSizes[sz]=v;newQty+=v}});
                return{...it,sizes:newSizes,qty:newQty}}).filter(it=>it.qty>0);
              if(updatedItems.length===0){if(onBatchPO)onBatchPO(prev=>prev.filter(b=>b.id!==bp.id));setEditBatchPO(null);nf('Batch PO removed (all quantities zeroed)');return}
              const newTotal=updatedItems.reduce((a,it)=>a+it.qty*it.unit_cost,0);
              if(onBatchPO)onBatchPO(prev=>prev.map(b=>b.id===bp.id?{...b,items:updatedItems,total_cost:newTotal}:b));
              setEditBatchPO(null);nf('Batch PO updated');
            }}>Save Changes</button>
          </div>
        </div>
      </div></div>})()}

      {/* Copy Item → New SKU Modal */}
      {copySkuModal&&(()=>{const srcIt=o.items[copySkuModal.itemIdx];if(!srcIt)return null;const sq=copySkuModal.search?.toLowerCase()||'';
        const canReplace=safePicks(srcIt).length===0&&safePOs(srcIt).length===0;
        const mode=canReplace?(copySkuModal.mode||'replace'):'copy';
        const isReplace=mode==='replace';
        const onPickCatalog=p=>isReplace?changeItemSku(copySkuModal.itemIdx,p):copyIWithSku(copySkuModal.itemIdx,p);
        const onPickVendor=(st,c,src)=>isReplace?changeItemWithVendorResult(copySkuModal.itemIdx,st,c,src):copyIWithVendorResult(copySkuModal.itemIdx,st,c,src);
        const matches=sq.length>=2?products.filter(p=>p.sku.toLowerCase().includes(sq)||p.name.toLowerCase().includes(sq)||p.brand?.toLowerCase().includes(sq)||p.color?.toLowerCase().includes(sq)).slice(0,8):[];
        const anyVendor=ssResults.length>0||smResults.length>0||mtResults.length>0||rsResults.length>0;
        const anySearching=ssSearching||smSearching||mtSearching||rsSearching;
        const renderVendorBlock=(label,color,bg,results,searching,source)=>(results.length>0||searching)&&<div style={{marginTop:8,border:'1px solid '+bg,borderRadius:6,overflow:'hidden'}}>
          <div style={{padding:'4px 10px',background:bg,fontSize:10,fontWeight:800,color,textTransform:'uppercase',letterSpacing:1,display:'flex',alignItems:'center',gap:6}}>
            <span>{label}</span>{searching&&<span style={{fontWeight:500,opacity:0.7}}>Searching...</span>}{!searching&&<span style={{fontWeight:500,opacity:0.7}}>{results.length} style{results.length!==1?'s':''}</span>}
          </div>
          <div style={{maxHeight:200,overflowY:'auto'}}>
            {results.slice(0,8).map((st,si)=>{const eKey=source+'-cp-'+si;const isExp=expandedStyle===eKey;return<div key={eKey}>
              <div style={{padding:'6px 10px',borderBottom:'1px solid #f1f5f9',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:12}} onClick={()=>setExpandedStyle(isExp?null:eKey)}>
                <span style={{fontFamily:'monospace',fontWeight:700,color,background:bg,padding:'1px 6px',borderRadius:3,fontSize:11}}>{st.sku}</span>
                <span style={{fontWeight:600,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{st.styleName}</span>
                <span style={{fontSize:9,color}}>{st.colors.length} clr</span>
                <span style={{fontSize:11,color,fontWeight:700}}>{st.customerPrice>0?'$'+st.customerPrice.toFixed(2):'TBD'}</span>
                <span style={{fontSize:10,color}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&<div style={{background:'#fafafa',padding:'6px 10px',display:'flex',flexWrap:'wrap',gap:4}}>
                {st.colors.map((c,ci)=><div key={ci} style={{padding:'3px 7px',borderRadius:4,border:'1px solid '+bg,background:'white',cursor:'pointer',fontSize:10,display:'flex',alignItems:'center',gap:4}} onClick={()=>onPickVendor(st,c,source)} title={c.colorName+(c.customerPrice?' — $'+c.customerPrice.toFixed(2):'')}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:16,height:16,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.colorName||'Default'}</span>
                  {c.customerPrice>0&&<span style={{fontSize:9,color}}>${c.customerPrice.toFixed(2)}</span>}
                </div>)}
              </div>}
            </div>})}
          </div>
        </div>;
        return<div className="modal-overlay" style={{zIndex:10001}} onClick={()=>setCopySkuModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
          <div className="modal-header"><h2>{isReplace?'Change SKU':'Copy Item → New SKU'}</h2><button className="modal-close" onClick={()=>setCopySkuModal(null)}>×</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12,fontSize:12}}>
              <div style={{fontWeight:700}}>{isReplace?'Changing':'Copying from'}: {srcIt.sku} — {srcIt.name}</div>
              <div style={{color:'#64748b'}}>{safeDecos(srcIt).length} decoration(s) + sizes will {isReplace?'be kept on this line':'carry over'}</div>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:10,padding:4,background:'#f1f5f9',borderRadius:8}}>
              <button onClick={()=>canReplace&&setCopySkuModal(m=>({...m,mode:'replace'}))} disabled={!canReplace} title={canReplace?'Update this line in place — keep decorations, sizes, qty':'Disabled — item has PO or IF. Remove them first to edit in place.'} style={{flex:1,padding:'6px 10px',borderRadius:6,border:'none',cursor:canReplace?'pointer':'not-allowed',fontSize:11,fontWeight:700,background:isReplace?'#7c3aed':'transparent',color:isReplace?'white':canReplace?'#475569':'#cbd5e1'}}>🔄 Change SKU on this line{!canReplace&&' (locked)'}</button>
              <button onClick={()=>setCopySkuModal(m=>({...m,mode:'copy'}))} style={{flex:1,padding:'6px 10px',borderRadius:6,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,background:!isReplace?'#7c3aed':'transparent',color:!isReplace?'white':'#475569'}}>📋 Copy as new line</button>
            </div>
            <label className="form-label">Search for {isReplace?'replacement':'new'} product/SKU (catalog + S&S, SanMar, Momentec, Richardson live)</label>
            <input className="form-input" placeholder="Type SKU, name, or brand..." value={copySkuModal.search||''} onChange={e=>setCopySkuModal(m=>({...m,search:e.target.value}))} autoFocus/>
            {matches.length>0&&<div style={{maxHeight:200,overflowY:'auto',marginTop:8,border:'1px solid #e2e8f0',borderRadius:6}}>
              <div style={{padding:'4px 10px',background:'#eff6ff',fontSize:10,fontWeight:800,color:'#1e40af',textTransform:'uppercase',letterSpacing:1}}>NSA Catalog · {matches.length}</div>
              {matches.map(p=><div key={p.id} style={{padding:'6px 10px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12}} onClick={()=>onPickCatalog(p)} onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                <div><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span> <span style={{fontWeight:600}}>{p.name}</span>{p.color&&<span style={{color:'#64748b',fontSize:11}}> — {p.color}</span>}</div>
                <span className="badge badge-blue" style={{fontSize:9}}>{p.brand}</span>
              </div>)}
            </div>}
            {renderVendorBlock('S&S Activewear','#7c3aed','#ede9fe',ssResults,ssSearching,'ss')}
            {renderVendorBlock('SanMar','#0891b2','#cffafe',smResults,smSearching,'sm')}
            {renderVendorBlock('Momentec','#b45309','#fde68a',mtResults,mtSearching,'mt')}
            {renderVendorBlock('Richardson','#dc2626','#fecaca',rsResults,rsSearching,'rs')}
            {sq.length>=2&&matches.length===0&&!anyVendor&&!anySearching&&<div style={{textAlign:'center',padding:16,color:'#94a3b8',fontSize:12}}>No products found</div>}
            {sq.length>=2&&anySearching&&!anyVendor&&matches.length===0&&<div style={{textAlign:'center',padding:16,color:'#94a3b8',fontSize:12}}>Searching vendors...</div>}
          </div>
        </div></div>})()}

      {/* Change Color Modal — for vendor-live items where the SKU stays the same but color varies */}
      {colorPickerModal&&(()=>{const{itemIdx,sku,source}=colorPickerModal;const item=o.items[itemIdx];if(!item)return null;
        const results=source==='ss'?ssResults:source==='sm'?smResults:source==='mt'?mtResults:source==='rs'?rsResults:[];
        const searching=source==='ss'?ssSearching:source==='sm'?smSearching:source==='mt'?mtSearching:source==='rs'?rsSearching:false;
        const skuU=(sku||'').toUpperCase();
        const style=results.find(r=>(r.sku||'').toUpperCase()===skuU)||results[0];
        const colors=style?.colors||[];
        const label=source==='ss'?'S&S Activewear':source==='sm'?'SanMar':source==='mt'?'Momentec':'Richardson';
        const accent=source==='ss'?'#7c3aed':source==='sm'?'#0891b2':source==='mt'?'#b45309':'#dc2626';
        const bg=source==='ss'?'#ede9fe':source==='sm'?'#cffafe':source==='mt'?'#fde68a':'#fecaca';
        return<div className="modal-overlay" style={{zIndex:10001}} onClick={()=>setColorPickerModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
          <div className="modal-header"><h2>Change Color — {item.sku}</h2><button className="modal-close" onClick={()=>setColorPickerModal(null)}>×</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12,fontSize:12}}>
              <div style={{fontWeight:700}}>{item.name}</div>
              <div style={{color:'#64748b'}}>Current color: <strong>{item.color||'(none)'}</strong> · Source: {label}</div>
            </div>
            {searching&&colors.length===0&&<div style={{textAlign:'center',padding:16,color:'#94a3b8',fontSize:12}}>Loading colors from {label}...</div>}
            {!searching&&colors.length===0&&<div style={{textAlign:'center',padding:16,color:'#94a3b8',fontSize:12}}>No colors available for this SKU.</div>}
            {colors.length>0&&(()=>{const q=(colorPickerModal.q||'').toLowerCase().trim();const shown=q?colors.filter(c=>(c.colorName||'').toLowerCase().includes(q)):colors;return<>
              <input className="form-input" placeholder="Search colors..." value={colorPickerModal.q||''} onChange={e=>{const v=e.target.value;setColorPickerModal(m=>m&&{...m,q:v})}} style={{fontSize:12,marginBottom:8}} autoFocus/>
              <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{q?shown.length+' of '+colors.length+' color'+(colors.length!==1?'s':'')+' match':colors.length+' color'+(colors.length!==1?'s':'')+' available'}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,maxHeight:360,overflowY:'auto'}}>
                {shown.map((c,ci)=>{const isCurrent=(c.colorName||'').toLowerCase()===(item.color||'').toLowerCase();return<button key={ci} onClick={()=>!isCurrent&&changeItemVendorColor(itemIdx,style,c)} disabled={isCurrent} style={{padding:'6px 10px',borderRadius:6,border:'1px solid '+(isCurrent?accent:bg),background:isCurrent?bg:'white',cursor:isCurrent?'default':'pointer',fontSize:11,display:'flex',alignItems:'center',gap:6,minWidth:0,opacity:isCurrent?0.7:1}} title={c.colorName+(c.customerPrice?' — $'+c.customerPrice.toFixed(2):'')+(c.totalQty?' · '+c.totalQty.toLocaleString()+' avail':'')}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:24,height:24,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:130}}>{c.colorName||'Default'}</span>
                  {c.customerPrice>0&&<span style={{fontSize:9,color:accent}}>${c.customerPrice.toFixed(2)}</span>}
                  {c.totalQty>0&&<span style={{fontSize:9,color:'#22c55e'}}>{c.totalQty.toLocaleString()}</span>}
                  {isCurrent&&<span style={{fontSize:9,color:accent,fontWeight:700}}>✓</span>}
                </button>})}
                {shown.length===0&&<div style={{padding:12,color:'#94a3b8',fontSize:12,width:'100%',textAlign:'center'}}>No colors match "{colorPickerModal.q}"</div>}
              </div>
            </>})()}
          </div>
        </div></div>})()}

    <CustModal isOpen={showCustEdit} onClose={()=>setShowCustEdit(false)} onSave={(updated)=>{if(onSaveCustomer)onSaveCustomer(updated);setCust(updated);setShowCustEdit(false)}} customer={cust} parents={allCustomers.filter(c=>!c.parent_id)} reps={REPS}/>
  </div>);
}



export default OrderEditor;
