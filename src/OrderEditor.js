/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import * as fabric from 'fabric';
import ImageTracer from 'imagetracerjs';
import { _pick, _estCols, _soCols, _itemCols, _decoCols, _itemExtraCols, _estExtraCols, _soExtraCols, _decoExtraCols, _sanitizeDeco, _msgCols, _msgExtraCols, _artCols, _artExtraCols, _jobExtraCols, _jobCols, ART_FILE_LABELS, ART_FILE_SC, ART_LABELS, BATCH_VENDORS, EXTRA_SIZES, SZ_ORD, SC, PANTONE_MAP, pantoneHex, pantoneSearch, THREAD_COLORS, threadHex, D_V, PRINT_CSS, MACHINES, NSA } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeObj, safeStr, safeArt, safeJobs, safeFirm } from './safeHelpers';
import { Icon, SortHeader, SearchSelect, Bg, $In, EmailBadge, getAddrs, calcSOStatus, SendModal, PantoneQuickPicks, ThreadQuickPicks } from './components';
import { dP, rQ, rT, normSzName, showSz, spP, emP, npP, SP, EM, NP, DTF, POSITIONS, _decoVendorPrice, mergeColors } from './pricing';
import { sendBrevoEmail, sendBrevoSms, fileUpload, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, openFile, buildDocHtml, printDoc, nextInvId } from './utils';

function OrderEditor({order,mode,customer:ic,allCustomers,products,vendors:vendorsProp,onSave,onBack,onConvertSO,onCopyEstimate,onRevertToEst,cu,nf,msgs,onMsg,dirtyRef,onAdjustInv,allOrders,onInv,allInvoices,batchPOs,onBatchPO,initTab,onNavCustomer,onNewEstimate,scrollToItem,scrollToJob,openPOId,reps:REPS,ssConnected,ssShipping,onShipSS,onCheckShipStatus,onDelete,onNavInvoice,onSaveProduct,onViewEstimate,onViewSO,returnToPage,onReturnToJob,onAssignTodo,portalSettings,decoVendors:decoVendorsProp,decoVendorPricing:decoVendorPricingProp,changeLog:changeLogProp,dbSavePromoPeriod:_dbSavePromoPeriod,companyInfo:companyInfoProp}){
  const _ci=companyInfoProp||NSA;// use company info from state (reacts to Supabase loads) with fallback to mutable NSA
  const vendorList=vendorsProp||D_V;// use DB-loaded vendors if available, fallback to defaults
  const cuEmail=(cu?.email)||(REPS||[]).find(r=>r.id===cu?.id)?.email||'';
  const isE=mode==='estimate';const isSO=mode==='so';
  const[o,setO]=useState(order);const[cust,setCust]=useState(ic);const[pS,setPS]=useState('');const[showAdd,setShowAdd]=useState(false);
  const[tab,setTab]=useState(initTab||'items');const[dirty,setDirty]=useState(false);const[selJob,setSelJob]=useState(null);const[jobNote,setJobNote]=useState('');const[msgDept,setMsgDept]=useState('all');const[replyTo,setReplyTo]=useState(null);
  const[mentionQuery,setMentionQuery]=useState(null);const[mentionIdx,setMentionIdx]=useState(0);const mentionRef=useRef(null);const msgInputRef=useRef(null);
    // Sync from external updates (e.g., coach approval from portal) — merge job art_status + art_files
    React.useEffect(()=>{if(order.updated_at&&order.updated_at!==o.updated_at){setO(prev=>{const extJobs=safeJobs(order);const mergedJobs=safeJobs(prev).map(j=>{const ext=extJobs.find(ej=>ej.id===j.id);if(ext&&(ext.art_status!==j.art_status||ext.coach_approved_at!==j.coach_approved_at||ext.coach_rejected!==j.coach_rejected)){return{...j,art_status:ext.art_status,coach_approved_at:ext.coach_approved_at,coach_rejected:ext.coach_rejected,rejections:ext.rejections,sent_to_coach_at:ext.sent_to_coach_at}}return j});return{...prev,jobs:mergedJobs,art_files:order.art_files,updated_at:order.updated_at}})}},[order.updated_at]);
    React.useEffect(()=>{if(initTab)setTab(initTab)},[initTab]);
    React.useEffect(()=>{if(scrollToItem!=null){setTab('items');setTimeout(()=>{const el=document.getElementById('so-item-'+scrollToItem);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #3b82f6';setTimeout(()=>{el.style.boxShadow=''},2000)}},150)}},[scrollToItem]);
    React.useEffect(()=>{if(scrollToJob!=null){setTab('jobs');setSelJob(scrollToJob);setTimeout(()=>{const el=document.getElementById('so-job-'+scrollToJob);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.boxShadow='0 0 0 3px #7c3aed';setTimeout(()=>{el.style.boxShadow=''},2000)}},200)}},[scrollToJob]);
    React.useEffect(()=>{if(openPOId){const items=safeItems(o);for(let i=0;i<items.length;i++){const poIdx=(items[i].po_lines||[]).findIndex(p=>p.po_id===openPOId);if(poIdx>=0){const poLine=items[i].po_lines[poIdx];const allLines=items.map((_,idx)=>({lineIdx:idx})).filter(ln=>items[ln.lineIdx]?.po_lines?.some(p=>p.po_id===openPOId));setPoFullPage({po:poLine,item:items[i],allLines,soId:o.id,soItems:items});break}}}},[openPOId]);
    const origRef=React.useRef(JSON.stringify(o));
    const markDirty=()=>setDirty(true);const[saved,setSaved]=useState(!!order.customer_id);const[showSend,setShowSend]=useState(false);const[showActionsDD,setShowActionsDD]=useState(false);const actionsRef=useRef(null);const[showPick,setShowPick]=useState(false);const[pickId,setPickId]=useState(()=>{let max=4000;(allOrders||[]).concat([order]).forEach(so=>safeItems(so).forEach(it=>safePicks(it).forEach(pk=>{const m=parseInt((pk.pick_id||'').replace('IF-',''))||0;if(m>max)max=m})));return'IF-'+String(max+1)});const[showPO,setShowPO]=useState(null);const[poCounter,setPOCounter]=useState(()=>{let max=3000;(allOrders||[]).concat([order]).forEach(so=>safeItems(so).forEach(it=>safePOs(it).forEach(po=>{const m=parseInt((po.po_id||'').replace('PO-',''))||0;if(m>max)max=m})));return max+1});
    const[pickNotes,setPickNotes]=useState('');const[pickShipDest,setPickShipDest]=useState('in_house');const[pickDecoVendor,setPickDecoVendor]=useState('');const[pickShipAddr,setPickShipAddr]=useState('default');const[pickSel,setPickSel]=useState({});/* selected item indexes for IF multi-select */
    const[rosterSendModal,setRosterSendModal]=useState(null);// {idx,di,item,rosterUrl,linkData}
    const[rosterUploadModal,setRosterUploadModal]=useState(null);// {idx,di,item,roster,sizedQtys}
    const[rosterUploadDragOver,setRosterUploadDragOver]=useState(false);
    const[rsmTo,setRsmTo]=useState('');const[rsmCustom,setRsmCustom]=useState('');const[rsmName,setRsmName]=useState('Coach');const[rsmSending,setRsmSending]=useState(false);const[rsmCopied,setRsmCopied]=useState(false);
    React.useEffect(()=>{if(rosterSendModal){const contacts=(cust?.contacts||[]).filter(c=>c.email);setRsmTo(contacts.length>0?contacts[0].email:'');setRsmCustom('');setRsmName(contacts.length>0?(contacts[0].name||'Coach'):'Coach');setRsmSending(false);setRsmCopied(false)}},[rosterSendModal]);
    const[preexistingPO,setPreexistingPO]=useState(false);const[preexistingPOId,setPreexistingPOId]=useState('');const[poExcluded,setPOExcluded]=useState({});
    const decoVendors=decoVendorsProp||[];const decoVendorPricing=decoVendorPricingProp||[];
    const DECO_VENDORS=(()=>{const names=decoVendors.filter(v=>v.is_active!==false).map(v=>v.name);return names.length>0?[...names,'Other']:['Silver Screen','Olympic Embroidery','WePrintIt','Pacific Screen Print','Other']})();
  const[showFirmReq,setShowFirmReq]=useState(false);const[firmReqDate,setFirmReqDate]=useState('');const[firmReqNote,setFirmReqNote]=useState('');
  const[showInvCreate,setShowInvCreate]=useState(false);const[invSelItems,setInvSelItems]=useState([]);const[invMemo,setInvMemo]=useState('');const[invType,setInvType]=useState('final');const[invDepositPct,setInvDepositPct]=useState(50);const[invBilling,setInvBilling]=useState('');
  const[invReview,setInvReview]=useState(null);const[invSendModal,setInvSendModal]=useState(false);const[invSendMsg,setInvSendMsg]=useState('');const[invSendTo,setInvSendTo]=useState('');const[invSendCustomEmail,setInvSendCustomEmail]=useState('');
  const[invSmsEnabled,setInvSmsEnabled]=useState(false);const[invSmsPhone,setInvSmsPhone]=useState('');const[invSmsMsg,setInvSmsMsg]=useState('');
  const[invFollowUpDays,setInvFollowUpDays]=useState(7);
  const[splitModal,setSplitModal]=useState(null);// {jIdx, mode:'received'|'sku'|null}
  const[mergeMode,setMergeMode]=useState(null);// {selected:[jobIdx,...]} — select jobs to merge
  const[jobWizard,setJobWizard]=useState(null);// {groups: [{name,deco_type,items:[...]},...]} — Job Setup Wizard
  const[countDiscModal,setCountDiscModal]=useState(null);// {open,entries:[{sku,name,color,size,expected,actual}],notes}
  const[artReqModal,setArtReqModal]=useState(null);// {jIdx, artist:'', instructions:'', files:[]}
  const[artRevisionNote,setArtRevisionNote]=useState('');
  const[showPrevArt,setShowPrevArt]=useState(false);// Previous Artwork picker modal
  const[collapsedArt,setCollapsedArt]=useState({});// Track collapsed art groups by id
  const[coachApprovalModal,setCoachApprovalModal]=useState(null);// {jIdx, contact, portalUrl, method, message}
  const[mockupLightbox,setMockupLightbox]=useState(null);// url string for image lightbox overlay
  const[copySkuModal,setCopySkuModal]=useState(null);// {itemIdx, search:''}

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

  // Check if item is from Adidas (for B2B inventory display)
  const isAdidasItem=useCallback((item)=>{
    if(item.brand==='Adidas')return true;
    const vId=item.vendor_id||products.find(p=>p.id===item.product_id||p.sku===item.sku)?.vendor_id;
    if(!vId)return false;
    const vRec=vendorList.find(v=>v.id===vId);
    if(vRec)return vRec.name==='Adidas';
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
          try{let sid=null;try{const st=await ssApiCall('/Styles?style='+encodeURIComponent(sku));const sa=Array.isArray(st)?st:st?[st]:[];if(sa.length>0)sid=sa[0].styleID}catch(e){}
            if(sid){data=await ssApiCall('/Products?styleID='+encodeURIComponent(sid))}else{data=await ssApiCall('/Products?style='+encodeURIComponent(sku))}}
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
          if(prodItems.length){const it=prodItems[0];const bi=it.productBasicInfo||it;front=bi.thumbImageUrl||bi.imageUrl||bi.colorProductImage||'';back=bi.backImageUrl||bi.colorProductBackImage||''}
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
      vendorImgCache.current[cacheKey]=result;
      setVendorImgs(prev=>({...prev,[cacheKey]:result}));
    }catch(e){console.warn('[Vendor] Image fetch failed for',sku,e)}
    finally{delete vendorImgFetching.current[cacheKey]}
  },[products,vendorList]);
  // Helper to get vendor image for an item (used in itemDetails builders)
  const _vImg=(it,field)=>{const k=(it?.sku||'')+'|'+(it?.color||'').toLowerCase();const c=vendorImgs[k];return field==='front'?c?.front||'':c?.back||''};

  const fetchVendorInventory=useCallback(async(sku,vendorId,item)=>{
    const itemRef=item||{vendor_id:vendorId,sku};
    const isSS=isSSItem(itemRef);
    const isSM=isSanMarItem(itemRef);
    const isMT=isMomentecItem(itemRef);
    if(!isSS&&!isSM&&!isMT)return;
    const cacheKey=sku;
    const cached=vendorInvCache.current[cacheKey];
    if(cached&&(Date.now()-cached.fetchedAt)<600000){
      setVendorInv(prev=>({...prev,[sku]:{sizes:cached.sizes,price:cached.price,loading:false,error:null,source:cached.source}}));
      return;
    }
    if(vendorInvFetching.current[cacheKey])return;
    vendorInvFetching.current[cacheKey]=true;
    setVendorInv(prev=>({...prev,[sku]:{sizes:{},price:{},loading:true,error:null,source:isMT?'mt':isSM?'sm':'ss'}}));
    try{
      if(isMT){
        // Momentec: fetch product detail to get child SKUs with inventory from HCL Commerce
        const sizeQty={};const sizePrice={};
        try{
          // Get product detail which includes child SKUs
          const detail=await momentecGetProductByPartNumber(sku);
          const entry=detail?.CatalogEntryView?.[0];
          if(entry){
            // Extract sizes and prices from child SKUs
            const skus=entry.SKUs||entry.sKUs||[];
            const getSkSize=(e)=>{const attrs=e.Attributes||e.attributes||e.definingAttributes||[];if(Array.isArray(attrs)){for(const a of attrs){const id=(a.identifier||'').toLowerCase();const n=(a.name||'').toLowerCase();if(id==='asgswatchsize'||n==='available sizes'||n==='size'){const vals=a.values||a.Values||[];if(vals.length)return(vals[0].values||vals[0].value||vals[0].identifier||'').trim()}}}return''};
            const getSkColor=(e)=>{const attrs=e.Attributes||e.attributes||e.definingAttributes||[];if(Array.isArray(attrs)){for(const a of attrs){const n=(a.name||a.identifier||'').toLowerCase();if(n==='color'||n==='colour'||n==='clr'||n==='asgswatchcolor'){const vals=a.values||a.Values||[];if(vals.length)return vals.map(v=>v.values||v.value||v.Value||v.identifier||v).join('/')}}}return''};
            const itemColor=(item?.color||'').toLowerCase();
            for(const sk of skus){
              const skColor=(getSkColor(sk)||'').toLowerCase();
              // Filter by item color if set
              if(itemColor&&skColor&&!skColor.includes(itemColor.split('/')[0].split(' ')[0].toLowerCase())&&!itemColor.includes(skColor.split('/')[0].split(' ')[0].toLowerCase()))continue;
              const sz=normSzName(getSkSize(sk));
              if(!sz)continue;
              // Get inventory from buyQuantity or inventoryStatus fields
              const qty=parseInt(sk.buyQuantity||sk.inventoryQuantity||sk.quantity||0)||0;
              if(qty>0)sizeQty[sz]=(sizeQty[sz]||0)+qty;
            }
          }
          // Also try HCL Commerce inventory availability endpoint
          if(Object.keys(sizeQty).length===0){
            try{
              const invData=await momentecApiCall(`/inventoryavailability/byPartNumber/${encodeURIComponent(sku)}`);
              const invItems=invData?.InventoryAvailability||[];
              for(const inv of invItems){
                // Each entry may have a partNumber for the child SKU; extract size from it
                const pn=inv.partNumber||'';
                const avail=parseInt(inv.availableQuantity||inv.inventoryQuantity||0)||0;
                // Try to get size from the part number suffix or fetch the SKU detail
                // HCL Commerce part numbers often encode size, e.g., "412000-WHI-S"
                const parts=pn.split('-');
                const lastPart=parts[parts.length-1]||'';
                const sz=normSzName(lastPart);
                if(sz&&avail>0)sizeQty[sz]=(sizeQty[sz]||0)+avail;
              }
            }catch(e){console.warn('[Momentec] Inventory availability fetch error for',sku,e.message)}
          }
        }catch(e){console.warn('[Momentec] Product detail fetch error for',sku,e.message)}
        const result={sizes:sizeQty,price:sizePrice,fetchedAt:Date.now(),source:'mt'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,loading:false,error:null,source:'mt'}}));
      }else if(isSM){
        // SanMar: fetch inventory + pricing via SOAP API (now returns JSON)
        const prod3=products.find(p=>p.sku===sku);
        const prodColor=prod3?.color||item?.color||'';
        const sizeQty={};const sizePrice={};
        // Fetch inventory — returns warehouse quantities
        try{
          const invData=await sanmarGetInventory(sku,prodColor,'');
          // invData.items is array of inventory entries with warehouse quantities
          const invItems=invData?.items||[];
          invItems.forEach(it=>{
            const sz=normSzName(it.size||it.labelSize||'OSFA');
            // SanMar returns quantities per warehouse; sum all warehouses
            const qty=parseInt(it.totalQty||it.qty||it.quantity||0)||0;
            // Also check individual warehouse fields
            if(qty>0){sizeQty[sz]=(sizeQty[sz]||0)+qty}
            else{
              // Sum warehouse-level quantities if totalQty not present
              let whTotal=0;
              Object.entries(it).forEach(([k,v])=>{
                if(/^(qty|warehouse|wh)/i.test(k)&&typeof v==='string'){const n=parseInt(v)||0;if(n>0)whTotal+=n}
              });
              if(whTotal>0)sizeQty[sz]=(sizeQty[sz]||0)+whTotal;
            }
          });
        }catch(e){console.warn('[SanMar] Inventory fetch error for',sku,e.message)}
        // Fetch pricing
        try{
          const prData=await sanmarGetPricing(sku,prodColor,'');
          const prItems=prData?.items||[];
          prItems.forEach(it=>{
            const sz=normSzName(it.size||it.labelSize||'OSFA');
            const price=parseFloat(it.piecePrice||it.customerPrice||it.price||0);
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
              const price=parseFloat(it.piecePrice||it.customerPrice||0);
              if(price>0&&!sizePrice[sz])sizePrice[sz]=price;
            });
          }catch(e){console.warn('[SanMar] Product info fetch error for',sku,e.message)}
        }
        const result={sizes:sizeQty,price:sizePrice,fetchedAt:Date.now(),source:'sm'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,loading:false,error:null,source:'sm'}}));
      }else{
        // S&S Activewear: fetch via REST API
        let data;
        try{
          let sid=null;
          try{const st=await ssApiCall('/Styles?style='+encodeURIComponent(sku));const sa=Array.isArray(st)?st:st?[st]:[];if(sa.length>0)sid=sa[0].styleID}catch(e){}
          if(sid){data=await ssApiCall('/Products?styleID='+encodeURIComponent(sid))}
          else{data=await ssApiCall('/Products?style='+encodeURIComponent(sku))}
        }catch(e){
          try{const padded=sku.length<5&&/^\d+$/.test(sku)?sku.padStart(5,'0'):sku;data=await ssApiCall('/Products?style='+encodeURIComponent(padded))}
          catch(e2){throw e}
        }
        const items=Array.isArray(data)?data:data?[data]:[];
        const sizeQty={};const sizePrice={};
        const prod3=products.find(p=>p.sku===sku);
        const prodColor=prod3?.color?.toLowerCase()||'';
        items.forEach(it=>{
          const itColor=(it.colorName||'').toLowerCase();
          if(prodColor&&itColor&&!itColor.includes(prodColor.split('/')[0].split(' ')[0].toLowerCase())&&!prodColor.includes(itColor.split('/')[0].split(' ')[0].toLowerCase()))return;
          const sz=it.sizeName||'OSFA';
          const qty=typeof it.qty==='number'?it.qty:parseInt(it.qty)||0;
          sizeQty[sz]=(sizeQty[sz]||0)+qty;
          if(it.customerPrice!=null)sizePrice[sz]=parseFloat(it.customerPrice)||parseFloat(it.piecePrice)||0;
          else if(it.piecePrice!=null)sizePrice[sz]=parseFloat(it.piecePrice)||0;
        });
        const result={sizes:sizeQty,price:sizePrice,fetchedAt:Date.now(),source:'ss'};
        vendorInvCache.current[cacheKey]=result;
        setVendorInv(prev=>({...prev,[sku]:{sizes:sizeQty,price:sizePrice,loading:false,error:null,source:'ss'}}));
      }
    }catch(err){
      console.error('[Vendor] Inventory fetch failed for',sku,err);
      setVendorInv(prev=>({...prev,[sku]:{sizes:{},price:{},loading:false,error:err.message,source:isSM?'sm':'ss'}}));
    }finally{
      delete vendorInvFetching.current[cacheKey];
    }
  },[products]);

  // Auto-fetch vendor inventory for all S&S and SanMar items on the order
  React.useEffect(()=>{
    const items=safeItems(o);
    items.forEach(item=>{
      if((isSSItem(item)||isSanMarItem(item)||isMomentecItem(item))&&!vendorInv[item.sku]&&!vendorInvFetching.current[item.sku]){
        fetchVendorInventory(item.sku,item.vendor_id,item);
      }
    });
  },[o.items?.length]);// only re-run when items are added/removed

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
  const[editPick,setEditPick]=useState(null);const[editPO,setEditPO]=useState(null);const[editBatchPO,setEditBatchPO]=useState(null);const[poFullPage,setPoFullPage]=useState(null);
  // Helper: effective PO committed qty for a size (ordered minus cancelled)
  const poCommitted=(poLines,sz)=>(poLines||[]).reduce((a,pk)=>{const ordered=pk[sz]||0;const cancelled=(pk.cancelled||{})[sz]||0;return a+(ordered-cancelled)},0);
  const[newAddr,setNewAddr]=useState('');const[showNA,setShowNA]=useState(false);const[showSzPicker,setShowSzPicker]=useState(null);const[showCustom,setShowCustom]=useState(false);const[custItem,setCustItem]=useState({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:'',saveToCatalog:false,image_url:'',images:[]});
  const[nsImport,setNsImport]=useState(null);// {step:'paste'|'review'|'confirm', raw:'', parsed:[], decoMap:[], issues:[]}

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
      // Search Styles using keyword search (most reliable — finds "1717", "A230", brand names, etc.)
      let styleInfo=null;
      let styleMatches=[];
      try{
        const styles=await ssApiCall('/Styles?search='+encodeURIComponent(query));
        const sArr=Array.isArray(styles)?styles:styles?[styles]:[];
        if(sArr.length>0){styleInfo=sArr[0];styleMatches=sArr}
      }catch(e){/* search returned no results */}

      // Get Products for matched styles
      let items=[];
      if(styleMatches.length>0){
        const styleIDs=[...new Set(styleMatches.map(s=>s.styleID).filter(Boolean))].slice(0,5);
        if(styleIDs.length){
          try{
            const data=await ssApiCall('/Products?style='+encodeURIComponent(styleIDs.join(',')));
            items=Array.isArray(data)?data:data?[data]:[];
          }catch(e){/* style lookup failed */}
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
          const sInfo=styleMatches.find(s=>String(s.styleID)===String(sid))||styleInfo||{};
          styleMap[sid]={
            styleID:sid,
            styleName:sInfo.title||(it.brandName?(it.brandName+' '+(sInfo.partNumber||it.styleName||query)):it.styleName||query),
            brandName:it.brandName||sInfo.brandName||'',
            sku:query.toUpperCase(),
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
      // Also fetch inventory for these items
      let invData={};
      try{
        const inv=await sanmarGetInventory(q,'','');
        (inv?.items||[]).forEach(it=>{
          const key=(it.color||it.colorName||'')+'|'+normSzName(it.size||it.labelSize||'');
          invData[key]=parseInt(it.totalQty||it.qty||it.quantity||0)||0;
        });
      }catch(e){/* inventory fetch optional */}
      // Group by style → one entry per style, with colors array inside
      // SanMar items have nested sub-objects: productBasicInfo, productImageInfo, productPriceInfo
      const styleMap={};
      items.forEach(raw=>{
        // Flatten nested SanMar product structure into a single object
        const bi=raw.productBasicInfo||{};
        const ii=raw.productImageInfo||{};
        const pi=raw.productPriceInfo||{};
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
          customerPrice:parseFloat(it.piecePrice||it.price||it.customerPrice||0),
          piecePrice:parseFloat(it.piecePrice||it.price||0),
          sizes:[],totalQty:0
        };
        const cEntry=styleMap[sid].colors[cKey];
        const sz=normSzName(it.size||it.labelSize||it.sizeCode||'OSFA');
        const invKey=color+'|'+sz;
        const qty=invData[invKey]||parseInt(it.inventoryQty||it.qty||0)||0;
        const price=parseFloat(it.piecePrice||it.price||it.customerPrice||0);
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
        // Prefer Offer usage (wholesale/dealer price)
        let offer=0,display=0;
        if(prices.length){for(const p of prices){const u=(p.usage||p.priceUsage||'').toLowerCase();const v=parseFloat(p.SKUPriceValue||p.priceValue||0);if(v>0){if(u==='offer'||u==='sale')offer=v;else if(u==='display'||u==='list')display=v}}}
        if(offer>0)return offer;
        // Try offerPrice/salePrice fields
        const op=parseFloat(e.offerPrice||e.salePrice||0);if(op>0)return op;
        // Fall back to Display/List * 0.5 (retail-to-wholesale estimate)
        if(display>0)return display*0.5;
        const lp=parseFloat(e.listPrice||0);if(lp>0)return lp*0.5;
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
          for(const sk of skus){
            const skPrice=mtCost(getOfferPrice(sk));const skColor=getColor(sk)||'Default';const skSize=getSize(sk);
            const skImg=colorImgMap[skColor]||sk.thumbnail||sk.fullImage||'';
            const skBackImg=sk.fullImageBack||sk.backImage||'';
            if(!style.colors[skColor]){
              style.colors[skColor]={colorName:skColor,sku:sk.partNumber||sk.SKUPartNumber||baseSku,piecePrice:skPrice,customerPrice:skPrice,
                colorFrontImage:skImg||style.styleImage,colorBackImage:skBackImg||style.styleBackImage||'',sizes:[],totalQty:0};
            }else{const c=style.colors[skColor];if(skPrice>0&&(c.customerPrice===0||skPrice<c.customerPrice)){c.customerPrice=skPrice;c.piecePrice=skPrice}if(skImg&&!c.colorFrontImage)c.colorFrontImage=skImg;if(skBackImg&&!c.colorBackImage)c.colorBackImage=skBackImg}
            // Add size entry with per-size price (sizes like 3XL+ are more expensive)
            if(skSize){const c=style.colors[skColor];if(!c.sizes.find(s=>s.sizeName===skSize)){c.sizes.push({sizeName:skSize,qty:0,price:skPrice})}}
            if(skPrice>0&&(style._mtPrice===0||skPrice<style._mtPrice))style._mtPrice=skPrice;
          }
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

  // Debounced S&S + SanMar + Momentec search when typing in Add Product search
  React.useEffect(()=>{
    if(ssSearchTimer.current)clearTimeout(ssSearchTimer.current);
    if(smSearchTimer.current)clearTimeout(smSearchTimer.current);
    if(mtSearchTimer.current)clearTimeout(mtSearchTimer.current);
    if(!showAdd||!pS||pS.length<2){setSsResults([]);setSmResults([]);setMtResults([]);ssSearchGen.current++;smSearchGen.current++;mtSearchGen.current++;setExpandedStyle(null);return}
    // Bump generation to discard in-flight results from previous keystrokes
    ssSearchGen.current++;smSearchGen.current++;mtSearchGen.current++;setExpandedStyle(null);
    const localCount=fp.length;
    const delay=localCount>5?800:400;
    ssSearchTimer.current=setTimeout(()=>ssLiveSearch(pS),delay);
    smSearchTimer.current=setTimeout(()=>smLiveSearch(pS),delay+100);
    mtSearchTimer.current=setTimeout(()=>mtLiveSearch(pS),delay+200);
    return()=>{if(ssSearchTimer.current)clearTimeout(ssSearchTimer.current);if(smSearchTimer.current)clearTimeout(smSearchTimer.current);if(mtSearchTimer.current)clearTimeout(mtSearchTimer.current)};
  },[pS,showAdd]);

  // Add a vendor search result as a line item (works for S&S, SanMar, and Momentec)
  // style = the style-level result, color = the selected color from style.colors
  const addSearchProduct=(style,color,source)=>{
    const isSM=source==='sm';
    const isMT=source==='mt';
    const vendor=vendorList.find(v=>isMT?(v.api_provider==='momentec'||v.name==='Momentec'):isSM?(v.api_provider==='sanmar'||v.name==='SanMar'):(v.api_provider==='ss_activewear'||v.name==='S&S Activewear'));
    const vId=vendor?.id||(isMT?'v8':isSM?'v3':'v4');
    const cost=color.customerPrice||color.piecePrice||0;
    const sell=rQ(cost*(o.default_markup||1.65));
    // Build available sizes: start with sizes from API, merge with catalog product sizes and standard sizes
    const apiSizes=color.sizes.map(s=>s.sizeName);
    // Try to match a catalog product for this SKU to get its full available_sizes
    const catMatch=products.find(p=>p.sku===style.sku&&(!color.colorName||p.color===color.colorName))||products.find(p=>p.sku===style.sku);
    const catSizes=catMatch?.available_sizes||[];
    // SanMar provides availableSizes as comma-separated string
    const smSizes=style._availSizes?style._availSizes.split(/[,;]\s*/).map(s=>normSzName(s.trim())).filter(Boolean):[];
    // Merge all sources; ensure standard sizes are always included for apparel
    const STD_SIZES=['S','M','L','XL','2XL'];
    let availSizes=[...new Set([...apiSizes,...catSizes,...smSizes,...STD_SIZES])];
    availSizes=availSizes.sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
    const vInv={};color.sizes.forEach(s=>{vInv[s.sizeName]=(vInv[s.sizeName]||0)+s.qty});
    const liveFlag=isMT?'_mt_live':isSM?'_sm_live':'_ss_live';
    const newItem={
      product_id:null,sku:style.sku,name:style.styleName,brand:style.brandName,
      vendor_id:vId,color:color.colorName,nsa_cost:cost,retail_price:0,
      unit_sell:sell,available_sizes:availSizes.length?availSizes:['S','M','L','XL','2XL'],
      sizes:{},qty_only:false,decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:null}]:[],
      is_custom:false,[liveFlag]:true,
      _colorImage:color.colorFrontImage||style.styleImage||'',
      _colorBackImage:color.colorBackImage||''
    };
    sv('items',[...o.items,newItem]);
    const sizePrice={};color.sizes.forEach(s=>{sizePrice[s.sizeName]=s.price||cost});
    vendorInvCache.current[style.sku]={sizes:vInv,price:sizePrice,fetchedAt:Date.now(),source};
    setVendorInv(prev=>({...prev,[style.sku]:{sizes:vInv,price:sizePrice,loading:false,error:null,source}}));
    setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([]);setMtResults([]);setExpandedStyle(null);
  };
  // State for expanded style in search results (shows color picker)
  const[expandedStyle,setExpandedStyle]=useState(null);// {key:'ss-0', style:{...}}
  const sv=(k,v)=>{setO(e=>({...e,[k]:v,updated_at:new Date().toLocaleString()}));setDirty(true)};
  const isAU=b=>b==='Adidas'||b==='Under Armour'||b==='New Balance';const tD={A:0.4,B:0.35,C:0.3};
  const selC=id=>{const c=allCustomers.find(x=>x.id===id);if(c){setCust(c);sv('customer_id',id);sv('default_markup',c.catalog_markup||1.65)}};
  const addP=p=>{const au=isAU(p.brand);const sell=au?rQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):rQ(p.nsa_cost*(o.default_markup||1.65));
    sv('items',[...o.items,{product_id:p.id,sku:p.sku,name:p.name,brand:p.brand,vendor_id:p.vendor_id||null,color:p.color,nsa_cost:p.nsa_cost,retail_price:p.retail_price,unit_sell:sell,available_sizes:[...p.available_sizes],_colors:p._colors||null,sizes:{},qty_only:false,decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:null}]:[]}]);setShowAdd(false);setPS('')};
  const uI=(i,k,v)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===i?{...it,[k]:v}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};const rmI=i=>{const item=safeItems(o)[i];if(item&&isSO){const pos=safePOs(item);if(pos.length>0){const hasReceived=pos.some(po=>Object.values(po.received||{}).some(v=>v>0));const hasBilled=pos.some(po=>Object.values(po.billed||{}).some(v=>v>0));if(hasReceived||hasBilled){nf('Cannot delete — this item has '+(hasReceived?'received':'')+(hasReceived&&hasBilled?' and ':'')+(hasBilled?'billed':'')+' PO quantities. Remove billing/receiving first.','error');return}nf('Cannot delete — this item has PO(s). Delete the PO(s) first before removing the item.','error');return}}sv('items',safeItems(o).filter((_,x)=>x!==i))};
  const copyI=(i)=>{const it=o.items[i];const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];sv('items',[...o.items,clone]);nf('📋 Copied '+it.sku+' with all sizes & decorations')};
  const copyIWithSku=(i,p)=>{const it=o.items[i];const clone=JSON.parse(JSON.stringify(it));clone.pick_lines=[];clone.po_lines=[];clone.product_id=p.id;clone.sku=p.sku;clone.name=p.name;clone.brand=p.brand;clone.color=p.color;clone.nsa_cost=p.nsa_cost;clone.retail_price=p.retail_price;clone.vendor_id=p.vendor_id||null;clone.available_sizes=[...p.available_sizes];clone._colors=p._colors||null;const au=isAU(p.brand);clone.unit_sell=au?rQ(p.retail_price*(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):rQ(p.nsa_cost*(o.default_markup||1.65));sv('items',[...o.items,clone]);setCopySkuModal(null);nf('📋 Copied decorations from '+it.sku+' → '+p.sku)};
  const uSz=(i,sz,v)=>{
    const n=v===''?0:parseInt(v)||0;
    const item=o.items[i];if(!item)return;
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
  const addSzToItem=(i,sz)=>{const it=o.items[i];if(!it.available_sizes.includes(sz))uI(i,'available_sizes',[...it.available_sizes,sz]);setShowSzPicker(null)};
  const NUM_SZ={heat_transfer:['1"','1.5"','2"','3"','4"','5"','6"','8"','10"'],embroidery:['0.5"','0.75"','1"','1.5"','2"'],screen_print:['4"','6"','8"','10"']};
  const addArtDeco=i=>{const it=o.items[i];sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'art',position:'Front Center',art_file_id:null,sell_override:null}]}:x))};
  const addNumDeco=i=>{const it=o.items[i];sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'numbers',position:'Back Center',num_method:'screen_print',num_size:'6"',two_color:false,sell_override:null,custom_font_art_id:null,roster:{}}]}:x))};
  const addNameDeco=i=>{const it=o.items[i];sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'names',position:'Back Center',sell_override:null,sell_each:6,cost_each:3,names:{}}]}:x))};
  const addOutsideDeco=i=>{const it=o.items[i];sv('items',safeItems(o).map((x,xi)=>xi===i?{...x,no_deco:false,decorations:[...x.decorations,{kind:'outside_deco',position:'Front Center',vendor:'',deco_type:'embroidery',cost_each:0,sell_each:0,notes:'',sell_override:null}]}:x))};
  const uD=(ii,di,k,v)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,[k]:v}:d)}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  const uDM=(ii,di,updates)=>{setO(e=>({...e,items:safeItems(e).map((it,x)=>x===ii?{...it,decorations:it.decorations.map((d,i)=>i===di?{...d,...updates}:d)}:it),updated_at:new Date().toLocaleString()}));setDirty(true)};
  const rmD=(ii,di)=>{uI(ii,'decorations',o.items[ii].decorations.filter((_,i)=>i!==di))};
  // Art files (SO)
  const af=o.art_files||[];
  const addArt=()=>sv('art_files',[...af,{id:'af'+Date.now(),name:'',deco_type:'screen_print',ink_colors:'',thread_colors:'',art_size:'',color_ways:[],files:[],mockup_files:[],preview_url:'',prod_files:[],notes:'',status:'waiting_for_art',uploaded:new Date().toLocaleDateString()}]);
  const uArt=(i,k,v)=>sv('art_files',af.map((f,x)=>x===i?{...f,[k]:v}:f));
  const rmArt=i=>{const removed=af[i];sv('art_files',af.filter((_,x)=>x!==i));if(removed?.id){sv('items',safeItems(o).map(it=>({...it,decorations:safeDecos(it).map(d=>d.art_file_id===removed.id?{...d,art_file_id:null}:d)})))}};

  const addFileToArt=i=>{const a=af[i];if(!a)return;uArt(i,'files',[...(a.files||[]),'new_file_'+((a.files||[]).length+1)+'.ai'])};

  // Promo auto-repair removed — use "Apply Promo Funds" in Actions dropdown instead

  const addrs=useMemo(()=>getAddrs(cust,allCustomers),[cust,allCustomers]);
  const artQty=useMemo(()=>{const m={};safeItems(o).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q=sq>0?sq:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){m[d.art_file_id]=(m[d.art_file_id]||0)+q}})});return m},[o]);
  const totals=useMemo(()=>{let rev=0,cost=0;safeItems(o).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q=sq>0?sq:safeNum(it.est_qty);if(!q)return;rev+=q*safeNum(it.unit_sell);cost+=q*safeNum(it.nsa_cost);
    safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);rev+=eq*dp.sell;cost+=eq*dp.cost});
    (it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco').forEach(pl=>{const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!['unit_cost'].includes(k)).reduce((a,[,v])=>a+v,0);cost+=poQty*safeNum(pl.unit_cost)})});
    const ship=o.shipping_type==='pct'?rev*(o.shipping_value||0)/100:(o.shipping_value||0);const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);const tax=rev*taxRate;
    return{rev,cost,ship,tax,taxRate,grand:rev+ship+tax,margin:rev-cost,pct:rev>0?((rev-cost)/rev*100):0}},[o,artQty,cust]); // eslint-disable-line

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
    // Step 1: Build decoration entries per item, grouped by deco type
    // Each item may produce multiple entries if it has decorations with different deco types
    const itemSigs=[];
    safeItems(o).forEach((it,ii)=>{
      // First, classify each decoration by its resolved deco type
      const decosByType={};
      safeDecos(it).forEach((d,di)=>{
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
      const positions=new Set();const artIds=[];const artNames=[];const decoTypes=[];let worstArtSt='art_complete';
      firstEntry.decos.forEach(({d})=>{
        if(d.kind==='art'){
          positions.add(safeStr(d.position));
          if(d.art_file_id){
            const artF=af.find(a=>a.id===d.art_file_id);
            artIds.push(d.art_file_id);
            artNames.push(artF?.name||'Unknown Art');
            decoTypes.push(artF?.deco_type||d.deco_type||'screen_print');
            const st=artF?.status==='approved'?(artF.prod_files?.length?'art_complete':'production_files_needed'):artF?.status==='needs_approval'?'waiting_approval':'needs_art';
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
        }
      });
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
    const existingJobMap={};const existingByArtId={};const existingById={};
    safeJobs(o).forEach(j=>{if(!j.split_from){existingJobMap[j.key||j.id]=j;const jArtIds=j._art_ids||[j.art_file_id].filter(Boolean);jArtIds.forEach(aid=>{existingByArtId[aid]=existingByArtId[aid]||j});existingById[j.id]=j}});
    const soNum=o.id?.replace('SO-','')||'0';
    let jIdx=1;
    const newJobs=Object.values(jobMap).map(j=>{
      // Try matching by key first, then by art_file_id as fallback to prevent data loss on key changes
      const existing=existingJobMap[j.key]||(j.art_file_id?existingByArtId[j.art_file_id]:null);
      const itemSt=j.fulfilled_units>=j.total_units&&j.total_units>0?'items_received':j.fulfilled_units>0?'partially_received':'need_to_order';
      let prodSt=existing?.prod_status||'hold';
      const artFile=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);
      const hasProdFiles=!artFile||(artFile.prod_files||[]).length>0;
      // Jobs stay in 'hold' (Ready for Prod) until warehouse manually moves them to production
      const id=existing?.id||('JOB-'+soNum+'-'+String(jIdx).padStart(2,'0'));
      jIdx++;
      return{
        id,key:j.key,art_file_id:j.art_file_id,art_name:j.art_name,deco_type:j.deco_type,
        positions:[...j.positions].filter(Boolean).join(', '),items:j.items,
        art_status:existing?.art_status||j.art_status,item_status:itemSt,prod_status:prodSt,
        total_units:j.total_units,fulfilled_units:j.fulfilled_units,
        assigned_machine:existing?.assigned_machine||null,assigned_to:existing?.assigned_to||null,
        ship_method:existing?.ship_method||(o.ship_preference==='rep_delivery'?'rep_delivery':'ship_customer'),
        split_from:existing?.split_from||null,created_at:existing?.created_at||new Date().toLocaleDateString(),
        counted_at:existing?.counted_at||null,counted_by:existing?.counted_by||null,
        count_discrepancy:existing?.count_discrepancy||null,notes:existing?.notes||null,
        _auto:existing?._auto!=null?existing._auto:true,
        // Preserve art workflow fields from existing job
        art_requests:existing?.art_requests||[],art_messages:existing?.art_messages||[],
        assigned_artist:existing?.assigned_artist||null,rep_notes:existing?.rep_notes||null,
        rejections:existing?.rejections||null,
        sent_to_coach_at:existing?.sent_to_coach_at||null,coach_approved_at:existing?.coach_approved_at||null,coach_email_opened_at:existing?.coach_email_opened_at||null,
        coach_rejected:existing?.coach_rejected||null,
        _art_ids:j._art_ids||[],
        // Preserve dual-run order fields
        run_order:existing?.run_order||null,run1_done:existing?.run1_done||false,run2_done:existing?.run2_done||false,
      };
    });
    // Preserve manually split jobs — they won't be auto-generated from decorations
    const splitJobs=safeJobs(o).filter(j=>j.split_from&&!newJobs.find(nj=>nj.id===j.id));
    // Subtract split-off units from parent jobs so totals stay correct
    splitJobs.forEach(sj=>{
      const parent=newJobs.find(nj=>nj.id===sj.split_from);
      if(parent){parent.total_units=Math.max(0,parent.total_units-sj.total_units);parent.fulfilled_units=Math.max(0,parent.fulfilled_units-sj.fulfilled_units)}
    });
    // Recalculate item_status on parents after unit adjustment
    newJobs.forEach(nj=>{
      if(splitJobs.some(sj=>sj.split_from===nj.id)){
        nj.item_status=nj.fulfilled_units>=nj.total_units&&nj.total_units>0?'items_received':nj.fulfilled_units>0?'partially_received':'need_to_order';
      }
    });
    return[...newJobs,...splitJobs];
  },[o,af]);// eslint-disable-line

  // Auto-sync jobs whenever decorations or items change (does NOT mark dirty — auto-sync is not a user edit)
  React.useEffect(()=>{
    if(!isSO)return;
    const currentJobs=safeJobs(o);
    // If any jobs were manually merged, only recalculate their units — don't re-split them
    if(currentJobs.some(j=>j._merged)){
      const updatedJobs=currentJobs.map(j=>{
        let total=0,fulfilled=0;
        (j.items||[]).forEach(gi=>{const it=safeItems(o)[gi.item_idx];if(!it)return;Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{total+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulfilled+=Math.min(v,pQ+rQ)});});
        if(j.total_units===total&&j.fulfilled_units===fulfilled)return j;
        return{...j,total_units:total,fulfilled_units:fulfilled};
      });
      if(updatedJobs.some((j,i)=>j!==currentJobs[i]))setO(e=>({...e,jobs:updatedJobs}));
      return;
    }
    const synced=syncJobs();
    const currentKeys=currentJobs.map(j=>j.key).sort().join(',');
    const newKeys=synced.map(j=>j.key).sort().join(',');
    const currentUnits=currentJobs.map(j=>j.total_units+'-'+j.fulfilled_units).join(',');
    const newUnits=synced.map(j=>j.total_units+'-'+j.fulfilled_units).join(',');
    if(currentKeys!==newKeys||currentUnits!==newUnits){
      setO(e=>({...e,jobs:synced,updated_at:new Date().toLocaleString()}));
    }
  },[syncJobs]);// eslint-disable-line

  const fp=products.filter(p=>{if(!pS||pS.length<2)return false;const q=pS.toLowerCase();return p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)||p.brand?.toLowerCase().includes(q)||p.color?.toLowerCase().includes(q)});
  const statusFlow=['need_order','waiting_receive','needs_pull','items_received','in_production','ready_to_invoice','complete'];

  return(<div>
    {/* ── Mockup lightbox overlay ── */}
    {mockupLightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setMockupLightbox(null)}>
      <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setMockupLightbox(null)}>×</button>
      {_isImgUrl(mockupLightbox)?<img src={mockupLightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
      :_isPdfUrl(mockupLightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(mockupLightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
      :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
    </div>}
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
        onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved`)}} style={{padding:'6px 20px',fontSize:13,fontWeight:700}}><Icon name="check" size={14}/> Save</button>
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
          {!cust?<div style={{marginBottom:8}}><label className="form-label">Select Customer *</label><SearchSelect options={allCustomers.map(c=>({value:c.id,label:`${c.name} (${c.alpha_tag})`}))} value={o.customer_id} onChange={selC} placeholder="Search customer..."/></div>
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
            ...(totals.ship>0?[{l:'SHIP',v:totals.ship,bg:'#f0f9ff',c:'#0369a1'}]:[]),
            ...(totals.tax>0?[{l:'TAX',v:totals.tax,bg:'#fefce8',c:'#a16207',s:(totals.taxRate*100).toFixed(3)+'%'}]:[]),
            ...(cust?.tax_exempt?[{l:'TAX',v:0,bg:'#fef2f2',c:'#dc2626',s:'EXEMPT'}]:[]),
            {l:'TOTAL',v:(()=>{let t=o.promo_applied&&promoTotals?promoTotals.customerPays:totals.grand;if(o.credit_applied)t=Math.max(0,t-safeNum(o.credit_amount));return t})(),bg:o.promo_applied||o.credit_applied?'#dcfce7':'#faf5ff',c:o.promo_applied||o.credit_applied?'#166534':'#7c3aed'},
            ...(o.promo_applied&&promoTotals?[{l:'PROMO $',v:promoTotals.promoAmount,bg:'#fef3c7',c:'#92400e',s:'deducted'}]:[]),
            ...(o.credit_applied?[{l:'CREDIT',v:safeNum(o.credit_amount),bg:'#d1fae5',c:'#065f46',s:'deducted'}]:[])].map(x=>
            <div key={x.l} style={{textAlign:'center',padding:'8px 12px',background:x.bg,borderRadius:8,minWidth:72}}><div style={{fontSize:9,color:x.c,fontWeight:700}}>{x.l}</div><div style={{fontSize:17,fontWeight:800,color:x.c}}>${x.v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>{x.s&&<div style={{fontSize:9,color:'#94a3b8'}}>{x.s}</div>}</div>)}</div>
          {isSO&&(()=>{const actualShip=safeNum(o._shipping_cost||o._shipstation_cost||0)||(o._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);const quotedShip=o.shipping_type==='pct'?totals.rev*(o.shipping_value||0)/100:safeNum(o.shipping_value||0);const overage=actualShip-quotedShip;
            return actualShip>0&&overage>0?<div style={{fontSize:10,padding:'4px 10px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,color:'#dc2626',fontWeight:600,marginTop:4}}>
              ⚠️ Shipping cost ${actualShip.toFixed(2)} exceeds quoted ${quotedShip.toFixed(2)} by <strong>${overage.toFixed(2)}</strong>
            </div>:null})()}
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
          <label className="form-label">{o.order_type==='booking'?'Expected':'Expected'}</label>
          <input className="form-input" type="date" value={o.expected_date||''} onChange={e=>sv('expected_date',e.target.value)}/>
          <button style={{fontSize:10,marginTop:4,padding:'3px 8px',borderRadius:4,background:'#f5f3ff',border:'1px solid #ddd6fe',color:'#7c3aed',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:3}} onClick={()=>{setFirmReqDate(o.expected_date||'');setFirmReqNote('');setShowFirmReq(true)}}>📌 Request Firm Date</button>
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
        {isSO&&o.order_type==='booking'&&!o.booking_confirmed&&<div style={{alignSelf:'end'}}>
          <button style={{fontSize:11,padding:'6px 12px',borderRadius:6,background:'#059669',border:'none',color:'white',cursor:'pointer',fontWeight:700}} onClick={()=>{if(!window.confirm('Confirm this booking order with coach? It will enter the active pipeline.'))return;sv('booking_confirmed',true);sv('booking_confirmed_at',new Date().toISOString());sv('booking_confirmed_by',cu?.id||'');nf('Booking order confirmed — entering pipeline')}}>Confirm with Coach</button>
        </div>}
        {isSO&&o.order_type==='booking'&&o.booking_confirmed&&<div style={{alignSelf:'end',fontSize:11,color:'#059669',fontWeight:600,padding:'6px 0'}}>Confirmed</div>}
        <button className="btn btn-primary" onClick={()=>{
          if(!cust){nf('Select a customer first','error');return}
          if(!o.memo?.trim()){nf('Memo is required','error');return}
          const validItems=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
          if(validItems.length===0){nf('Add at least one item with quantities','error');return}
          const noSku=validItems.find(it=>!it.sku?.trim()&&!it.is_custom);
          if(noSku){nf('Item '+(noSku.name||'#?')+' needs a SKU or mark as custom','error');return}
          const noPrice=validItems.find(it=>safeNum(it.unit_sell)<=0);
          if(noPrice){nf('Item '+(noPrice.sku||noPrice.name||'#?')+' needs a sell price','error');return}
          onSave(o);setSaved(true);setDirty(false);nf(`${isE?'Estimate':'SO'} saved`)}} style={{padding:'10px 28px',fontSize:16,fontWeight:800}}><Icon name="check" size={16}/> Save</button>
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
          {showActionsDD&&(()=>{const r=actionsRef.current?.getBoundingClientRect();return<><div style={{position:'fixed',inset:0,zIndex:98}} onClick={()=>setShowActionsDD(false)}/><div style={{position:'fixed',top:(r?r.bottom+4:0),right:(r?window.innerWidth-r.right:0),background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:99,minWidth:180}}>
            {saved&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);setShowSend(true)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="send" size={12}/> Send</button>}
            <button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);
              const items=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
              const _pAQ={};items.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
              const isRolled=(o.pricing_mode||'itemized')==='rolled_up';
              const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);
              const rows=[];let subTotal=0;
              items.forEach(it=>{
                const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);
                const decos=safeDecos(it);
                const decoSell=decos.reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);return a+dp2.sell},0);
                const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+' '+sz).join(', ');
                const unitPrice=isRolled?safeNum(it.unit_sell)+decoSell:safeNum(it.unit_sell);
                const lineAmt=qty*unitPrice;subTotal+=lineAmt;
                let itemDesc='<strong>'+(it.sku||'')+'</strong><br/>'+(it.name||'')+(it.color?' - '+it.color:'');
                if(szStr)itemDesc+='<br/><span style="font-size:10px;color:#555">'+szStr+'</span>';
                rows.push({cells:[{value:qty,style:'text-align:center'},{value:itemDesc},{value:'',style:'text-align:center'},{value:taxRate>0?'Yes':'No',style:'text-align:center'},{value:'$'+unitPrice.toFixed(2),style:'text-align:right'},{value:'$'+lineAmt.toFixed(2),style:'text-align:right;font-weight:600'}]});
                decos.forEach(d=>{
                  const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);
                  const artF=af.find(a2=>a2.id===d.art_file_id);
                  const decoLabel=(d.kind==='art'?(artF?.deco_type||d.art_tbd_type||'decoration'):d.kind==='numbers'?'Numbers ('+(d.num_method||'heat transfer').replace(/_/g,' ')+' '+(d.front_and_back?'F:'+(d.num_size||'4"')+' B:'+(d.num_size_back||d.num_size||'4"'):(d.num_size||'4"'))+(d.print_color?' — '+d.print_color:'')+')'+(d.front_and_back?' F+B':''):d.kind==='names'?'Names'+(d.print_color?' ('+d.print_color+')':''):d.kind==='outside_deco'?(d.deco_type||'Decoration'):'Decoration').replace(/_/g,' ');
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
                    rows.push({cells:[{value:'',style:'text-align:center;border-bottom:none'},{value:'<span style="padding-left:20px;color:#666;font-size:11px">'+decoLabel+posLabel+'</span>'+numHtml,style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'},{value:'',style:'border-bottom:none'}]});
                  }else{
                    const decoAmt=qty*dp2.sell;subTotal+=decoAmt;
                    rows.push({cells:[{value:qty,style:'text-align:center;color:#888;font-size:11px'},{value:'<span style="padding-left:20px;color:#666;font-size:11px">'+decoLabel+posLabel+'</span>'+numHtml},{value:'',style:'text-align:center'},{value:'',style:'text-align:center'},{value:'$'+dp2.sell.toFixed(2),style:'text-align:right;color:#888;font-size:11px'},{value:'$'+decoAmt.toFixed(2),style:'text-align:right;color:#888;font-size:11px'}]});
                  }
                });
              });
              const shipAmt=o.shipping_type==='pct'?subTotal*(o.shipping_value||0)/100:(o.shipping_value||0);
              // Credit: reduce tax on reduced subtotal, then subtract credit from total
              const _pdfCredit=o.credit_applied?safeNum(o.credit_amount):0;
              const _pdfCreditOnSub=Math.min(_pdfCredit,subTotal);
              const _pdfReducedSub=Math.max(0,subTotal-_pdfCreditOnSub);
              const taxAmt=_pdfCredit>0?_pdfReducedSub*taxRate:subTotal*taxRate;
              const _pdfCreditApplied=Math.min(_pdfCredit,subTotal+shipAmt+taxAmt);
              const total=subTotal+shipAmt+taxAmt-_pdfCreditApplied;
              if(shipAmt>0)rows.push({cells:[{value:1,style:'text-align:center'},{value:'<strong>Shipping</strong><br/><span style="font-size:10px;color:#555">Shipping</span>'},{value:'',style:'text-align:center'},{value:'No',style:'text-align:center'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'}]});
              const ddBillAddr=cust?.shipping_address_line1?cust.shipping_address_line1+(cust.shipping_city?'<br/>'+cust.shipping_city+(cust.shipping_state?' '+cust.shipping_state:'')+(cust.shipping_zip?' '+cust.shipping_zip:''):'')+'<br/>United States':(cust?.billing_address_line1?cust.billing_address_line1+(cust.billing_city?'<br/>'+cust.billing_city+(cust.billing_state?' '+cust.billing_state:'')+(cust.billing_zip?' '+cust.billing_zip:''):'')+'<br/>United States':'');
              printDoc({
                title:cust?.name||'Customer',docNum:o.id,docType:isE?'ESTIMATE':'SALES ORDER',
                headerRight:'<div class="ta">$'+total.toFixed(2)+'</div>'+(isE?'<div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>':''),
                infoBoxes:[
                  {label:'Bill To',value:cust?.name||'—',sub:(cust?.alpha_tag?cust.alpha_tag+'<br/>':'')+(ddBillAddr||'')},
                  {label:isE?'Expires':'Expected',value:isE?new Date(Date.now()+30*86400000).toLocaleDateString():(o.expected_date||'TBD')},
                  {label:'Exp. Close',value:new Date().toLocaleDateString()},
                  {label:'Sales Rep',value:REPS.find(r=>r.id===o.created_by)?.name||'—'},
                  {label:isE?'Estimate':'Sales Order',value:o.id},
                  {label:'Memo',value:o.memo||'—'},
                ],
                tables:[{headers:['Quantity','Item','Options','Tax','Rate','Amount'],aligns:['center','left','center','center','right','right'],
                  rows:[...rows,
                    {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>$'+subTotal.toFixed(2)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                    ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(taxRate*100).toFixed(3)+'%)</strong>',style:'text-align:right;border:none'},{value:'$'+taxAmt.toFixed(2),style:'text-align:right;border:none'}]}]:[]),
                    ...(_pdfCreditApplied>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-$'+_pdfCreditApplied.toFixed(2)+'</strong>',style:'text-align:right;border:none'}]}]:[]),
                    {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">$'+total.toFixed(2)+'</strong>',style:'text-align:right'}]},
                  ]}],
                footer:isE?'This estimate is valid for 30 days. Prices subject to change. '+_ci.depositTerms:_ci.terms,
                portalLink:cust?.alpha_tag?(window.location.origin+'?portal='+cust.alpha_tag):undefined
              });
              const ph=[...(o.print_history||[]),{printed_at:new Date().toLocaleString(),printed_by:cu.name||cu.id}];sv('print_history',ph);onSave({...o,print_history:ph});
            }} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>🖨️ Print</button>
            {isE&&onCopyEstimate&&saved&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#374151',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(!window.confirm('Create a copy of this estimate?'))return;onCopyEstimate(o)}} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="file" size={12}/> Copy</button>}
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
                  const newPeriod={id:'pp_'+Date.now(),customer_id:cust.id,period_start:_pStart,period_end:_pEnd,allocated:totalFixed,used:0,created_at:new Date().toISOString()};
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
              items.forEach(it=>{
                const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!q){newItems.push(it);return}
                if(remaining<=0){newItems.push(it);return}
                const promoSell=safeNum(it.retail_price)||safeNum(it.nsa_cost)*2;
                let itemPromoCost=q*promoSell;
                safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:q;const dp=dP(d,q,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?q*2:q);itemPromoCost+=eq*rQ(dp.sell*1.25)});
                // Add proportional shipping estimate (25% markup on promo portion)
                const shipBase=o.shipping_type==='pct'?itemPromoCost*(o.shipping_value||0)/100:0;
                const itemTotal=itemPromoCost+rQ(shipBase*1.25);
                if(remaining>=itemTotal){
                  // Fully covered by promo
                  remaining-=itemTotal;fullCount++;
                  newItems.push({...it,is_promo:true,_pre_promo_sell:it.unit_sell,unit_sell:promoSell});
                }else{
                  // Partially covered — apply remaining promo as discount on this item's sell price
                  const creditPerUnit=rQ(remaining/q);
                  const discountedSell=Math.max(0,safeNum(it.unit_sell)-creditPerUnit);
                  partialItem=true;
                  newItems.push({...it,is_promo:false,_pre_promo_sell:it.unit_sell,unit_sell:discountedSell,_promo_credit:remaining});
                  remaining=0;
                }
              });
              sv('promo_applied',true);sv('items',newItems);
              const totalItems=items.filter(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0).length;
              if(fullCount===totalItems){nf('Promo mode enabled — all items set to retail pricing')}
              else if(partialItem){nf(fullCount+' item(s) fully covered, 1 partially discounted — customer pays the rest')}
              else{nf('Promo applied to '+fullCount+' of '+totalItems+' items — customer pays for rest')}
            }} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='none'}>💰 Apply Promo Funds</button>}
            {o.promo_applied&&<button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#d97706',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);sv('promo_applied',false);sv('promo_amount',0);sv('items',safeItems(o).map(it=>({...it,is_promo:false,unit_sell:it._pre_promo_sell!=null?it._pre_promo_sell:it.unit_sell,_pre_promo_sell:undefined,_promo_credit:undefined})));nf('Promo mode disabled')}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='none'}>💰 Remove Promo</button>}
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
            {(isE||onDelete)&&<><div style={{borderTop:'1px solid #e2e8f0',margin:'2px 0'}}/><button style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',fontSize:12,color:'#dc2626',textAlign:'left'}} onClick={()=>{setShowActionsDD(false);if(onDelete){onDelete(o.id)}else{nf('Delete not available','error')}}} onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Icon name="trash" size={12}/> Delete</button></>}
          </div></>})()}
        </div>
      </div>
      {isSO&&<div style={{display:'flex',gap:6,marginTop:8}}>
        <button className="btn btn-secondary" onClick={()=>setShowPO('select')}><Icon name="cart" size={14}/> Create PO</button>
        {o.promo_applied?<button className="btn btn-secondary" style={{color:'#166534',borderColor:'#86efac'}} onClick={()=>{
          if(!window.confirm('Mark promo order '+o.id+' as complete? No invoice needed — costs are tracked on the SO.'))return;
          const updated={...o,status:'complete',updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);nf(o.id+' promo order closed');
        }}><Icon name="check" size={14}/> Close Promo Order</button>
        :<button className="btn btn-secondary" style={{color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
          setInvSelItems(safeItems(o).map((_,i)=>i));setInvMemo(o.memo||'');setInvType('deposit');setInvDepositPct(50);setShowInvCreate(true);
        }}><Icon name="dollar" size={14}/> Create Invoice</button>}
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
          {!showNA?<select className="form-select" value={o.ship_to_id||'default'} onChange={e=>{if(e.target.value==='new')setShowNA(true);else sv('ship_to_id',e.target.value)}}>
            {addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}<option value="new">+ New Address</option></select>
          :<div style={{display:'flex',gap:4}}><input className="form-input" placeholder="New address..." value={newAddr} onChange={e=>setNewAddr(e.target.value)} autoFocus style={{flex:1}}/><button className="btn btn-sm btn-primary" onClick={()=>{sv('ship_to_custom',newAddr);sv('ship_to_id','custom');setShowNA(false)}}>OK</button><button className="btn btn-sm btn-secondary" onClick={()=>setShowNA(false)}>×</button></div>}
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
        {(()=>{if(!cust)return null;const _now=new Date(),_y=_now.getFullYear(),_m=_now.getMonth();const _ps=(cust.promo_periods||[]).filter(p=>p.period_start===(_m<6?_y+'-01-01':_y+'-07-01'));const _bal=_ps.reduce((a,p)=>a+(p.allocated||0)-(p.used||0),0);if(promoTotals.promoAmount>_bal)return<span style={{fontSize:12,fontWeight:700,color:'#dc2626',background:'#fef2f2',padding:'2px 8px',borderRadius:6}}>⚠️ Exceeds available funds — ${_bal.toLocaleString(undefined,{maximumFractionDigits:2})} remaining</span>;return<span style={{fontSize:11,color:'#64748b'}}>Available: ${_bal.toLocaleString(undefined,{maximumFractionDigits:2})}</span>})()}
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
            {[{v:'ship_as_ready',l:'Ship as Ready',icon:'📦',desc:'Each IF/job ships as completed'},{v:'wait_complete',l:'Wait to Ship Complete',icon:'⏳',desc:'Wait for entire order to complete'},{v:'rep_delivery',l:'Rep Delivery',icon:'🚗',desc:'Rep delivers when jobs complete'},{v:'ship_on_date',l:'Ship on Date',icon:'📅',desc:'Hold until specific date'}].map(sp=>{
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
      {isSO&&<button className={`tab ${tab==='firm_dates'?'active':''}`} onClick={()=>setTab('firm_dates')}>Firm Dates ({safeFirm(o).length})</button>}
      {isSO&&<button className={`tab ${tab==='tracking'?'active':''}`} onClick={()=>setTab('tracking')}>Tracking {(()=>{const sc=(o._shipments||[]).length||(o._tracking_number?1:0);return sc>0?<span style={{background:'#166534',color:'white',borderRadius:10,padding:'1px 6px',fontSize:10,marginLeft:4}}>{sc}</span>:''})()}</button>}
      {isSO&&<button className={`tab ${tab==='costs'?'active':''}`} onClick={()=>setTab('costs')} style={tab==='costs'?{background:'#166534',color:'white'}:{}}>💰 Costs</button>}
      <button className={`tab ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>History</button>
    </div>

    {/* LINE ITEMS */}
    {tab==='items'&&<>{safeItems(o).map((item,idx)=>{const szQty=Object.values(safeSizes(item)).reduce((a,v)=>a+safeNum(v),0);const qty=szQty>0?szQty:safeNum(item.est_qty);
      let dR=0,dC=0;const decoBreak=[];safeDecos(item).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp=dP(d,qty,af,cq);const eq=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);const pds=item.is_promo&&o.promo_applied?rQ(dp.sell*1.25):dp.sell;const dr=eq*pds;const dc=eq*dp.cost;dR+=dr;dC+=dc;
        const artF=d.kind==='art'?af.find(f=>f.id===d.art_file_id):null;const label=d.kind==='art'?(artF?artF.deco_type?.replace('_',' '):d.position)+(d.reversible?' (Rev)':''):'Numbers @ '+d.position+(d.front_and_back?' (F+B)':'')+(d.reversible?' (Rev)':'');
        decoBreak.push({label,sell:pds,cost:dp.cost,rev:dr,costTot:dc,margin:dr-dc,pct:dr>0?((dr-dc)/dr*100):0})});
      const pRev=qty*item.unit_sell;const pCost=qty*item.nsa_cost;const pMg=pRev-pCost;
      const iR=pRev+dR;const iC=pCost+dC;const mg=iR-iC;
      const szs=(item.available_sizes||['S','M','L','XL','2XL']).slice().sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
      const addable=EXTRA_SIZES.filter(s=>!(item.available_sizes||[]).includes(s));
      return(<div key={idx} id={'so-item-'+idx} className="card" style={{marginBottom:12,transition:'box-shadow 0.3s'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {item.is_custom?<input className="form-input" value={item.sku} onChange={e=>uI(idx,'sku',e.target.value)} style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15,width:100,border:'1px solid #93c5fd'}}/>
                  :<span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'3px 10px',borderRadius:4,fontSize:15}}>{item.sku}</span>}
                {item.is_custom?<input className="form-input" value={item.name} onChange={e=>uI(idx,'name',e.target.value)} style={{fontWeight:700,fontSize:15,flex:1,minWidth:150}} placeholder="Item name..."/>
                  :<span style={{fontWeight:700,fontSize:15}}>{item.name}</span>}
                {item._colors?<select className="form-select" style={{fontSize:12,width:150}} value={item.color||item._colors[0]} onChange={e=>uI(idx,'color',e.target.value)}>{item._colors.map(c=><option key={c}>{c}</option>)}</select>
                  :item.is_custom?<input className="form-input" value={item.color||''} onChange={e=>uI(idx,'color',e.target.value)} style={{fontSize:12,width:100}} placeholder="Color"/>
                  :<span className="badge badge-gray">{item.color}</span>}
                {item.is_custom&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#fef3c7',color:'#92400e',fontWeight:600}}>Custom</span>}
                {(item.po_lines||[]).filter(pl=>pl.po_type==='outside_deco').map(pl=><span key={pl.po_id} style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#ede9fe',color:'#7c3aed',fontWeight:700,cursor:'pointer'}} title={pl.deco_vendor+' — '+pl.deco_type?.replace(/_/g,' ')} onClick={()=>setTab('items')}>{pl.po_id}</span>)}
                {isAU(item.brand)&&<span className="badge badge-blue">Tier {cust?.adidas_ua_tier}</span>}
                {o.promo_applied&&<label style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,cursor:'pointer',background:item.is_promo?'#fef3c7':'#f1f5f9',color:item.is_promo?'#92400e':'#94a3b8',border:item.is_promo?'1px solid #fde68a':'1px solid #e2e8f0'}}><input type="checkbox" checked={item.is_promo||false} onChange={e=>{const checked=e.target.checked;if(checked){uI(idx,'_pre_promo_sell',item.unit_sell);uI(idx,'unit_sell',safeNum(item.retail_price)||safeNum(item.nsa_cost)*2);uI(idx,'is_promo',true)}else{uI(idx,'unit_sell',item._pre_promo_sell!=null?item._pre_promo_sell:item.unit_sell);uI(idx,'_pre_promo_sell',undefined);uI(idx,'is_promo',false)}}} style={{width:12,height:12}}/> Promo{item.is_promo&&item.retail_price?' ($'+item.retail_price+')':''}</label>}</div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
                <span style={{fontSize:13,fontWeight:600}}>Sell: <$In value={item.unit_sell} onChange={v=>uI(idx,'unit_sell',v)}/>/ea</span>
                {item.is_custom&&<span style={{fontSize:12,color:'#64748b'}}>Cost: <$In value={item.nsa_cost} onChange={v=>{uI(idx,'nsa_cost',v);if(!isAU(item.brand)&&v>0){uI(idx,'unit_sell',rQ(v*(o.default_markup||1.65)))}}}/></span>}
                {item.is_custom&&isAU(item.brand)&&<span style={{fontSize:12,color:'#64748b'}}>Retail: <$In value={item.retail_price||0} onChange={v=>{uI(idx,'retail_price',v);if(isAU(item.brand)&&v>0){const costMult=item.brand==='Adidas'?0.375:0.425;const tier=tD[cust?.adidas_ua_tier||'B']||0.35;uI(idx,'nsa_cost',Math.floor(v*costMult*100)/100);uI(idx,'unit_sell',rQ(v*(1-tier)))}}}/></span>}
                {!isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:'#64748b'}}>({(item.unit_sell/item.nsa_cost).toFixed(2)}x)</span>}
                {isAU(item.brand)&&item.nsa_cost>0&&<span style={{fontSize:11,color:item.unit_sell>item.nsa_cost?'#166534':'#dc2626'}}>({Math.round((item.unit_sell-item.nsa_cost)/item.unit_sell*100)}% margin)</span>}
              </div></div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <button title="Copy item (same SKU)" onClick={()=>copyI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#2563eb',padding:4}}><Icon name="file" size={14}/></button>
              <button title="Copy item → new SKU" onClick={()=>setCopySkuModal({itemIdx:idx,search:''})} style={{background:'none',border:'none',cursor:'pointer',color:'#7c3aed',padding:4,fontSize:9,fontWeight:700}}>SKU</button>
              <button title="Delete item" onClick={()=>rmI(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:4}}><Icon name="trash" size={14}/></button>
            </div>
          </div></div>
        {/* SIZES ROW with financials inline */}
        {/* SIZES ROW — qty-only mode for estimates, or full size grid */}
        {(()=>{const isQtyOnly=isE&&item.qty_only;
        return<div style={{padding:'10px 18px',display:'flex',alignItems:'center',borderBottom:'1px solid #f1f5f9',...(isSO&&szQty===0&&safeNum(item.est_qty)>0?{border:'2px solid #dc2626',borderRadius:8,background:'#fef2f2'}:{})}}>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:600,color:isSO&&szQty===0&&safeNum(item.est_qty)>0?'#dc2626':isAdidasItem(item)?'#059669':'#64748b',width:46}}>{isSO&&szQty===0&&safeNum(item.est_qty)>0?'⚠️ Sizes:':isQtyOnly?'Qty:':isAdidasItem(item)?'ADIDAS':'Sizes:'}</span>
            {/* In estimate qty-only mode: show just the total input, no size grid */}
            {isQtyOnly?<>
              <div style={{textAlign:'center',padding:'0 10px'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOTAL QTY</div>
                <input value={item.est_qty||''} onChange={e=>uI(idx,'est_qty',e.target.value===''?0:parseInt(e.target.value)||0)} placeholder="0"
                  style={{width:64,textAlign:'center',fontSize:24,fontWeight:800,color:safeNum(item.est_qty)>0?'#1e40af':'#cbd5e1',border:'2px dashed #93c5fd',borderRadius:6,padding:'4px 0',background:'#eff6ff'}}/>
              </div>
              <button className="btn btn-sm btn-secondary" style={{fontSize:10,marginLeft:8,color:'#2563eb'}} onClick={()=>{uI(idx,'qty_only',false);uSz(idx,szs[0]||'S',item.est_qty||0)}}>+ Add Sizes</button>
            </>:<>
            {szs.map(sz=><div key={sz} style={{textAlign:'center',width:48}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
              <input value={item.sizes[sz]||''} onChange={e=>uSz(idx,sz,e.target.value)} placeholder="0"
                style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'5px 2px',fontSize:15,fontWeight:700,color:(item.sizes[sz]||0)>0?'#0f172a':'#cbd5e1'}}/>
              {(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const stk=p?._inv?.[sz];const need=item.sizes[sz]||0;return<div style={{fontSize:9,fontWeight:600,minHeight:13,color:stk==null?'transparent':stk<=0?'#dc2626':stk<need?'#ca8a04':'#166534'}}>{stk!=null?stk+' inv':'\u00A0'}</div>})()}
              {(()=>{const vi=vendorInv[item.sku];if(!vi||vi.loading)return vi?.loading?<div style={{fontSize:8,color:'#a78bfa',minHeight:11}}>...</div>:null;const vStk=vi.sizes?.[sz];if(vStk==null)return null;const lbl=vi.source==='mt'?'mt':vi.source==='sm'?'sm':'ss';const clr=vi.source==='mt'?'#d97706':vi.source==='sm'?'#0891b2':'#7c3aed';return<div style={{fontSize:8,fontWeight:700,minHeight:11,color:vStk<=0?'#dc2626':vStk<20?clr:clr}} title={(vi.source==='mt'?'Momentec':vi.source==='sm'?'SanMar':'S&S Activewear')+' stock: '+vStk}>{vStk} {lbl}</div>})()}
              </div>)}
            <div style={{textAlign:'center',marginLeft:4,padding:'0 10px',borderLeft:'2px solid #e2e8f0'}}><div style={{fontSize:10,fontWeight:700,color:'#1e40af'}}>TOT</div>
              <div style={{fontSize:20,fontWeight:800,color:'#1e40af'}}>{qty}</div>
            </div>
            </>}
            {(()=>{const vi=vendorInv[item.sku];const isSM=isSanMarItem(item);const isSS=isSSItem(item);const isMT=isMomentecItem(item);
              if(isSS||isSM||isMT){const lbl=isMT?'MT':isSM?'SM':'S&S';const clr=isMT?'#d97706':isSM?'#0891b2':'#7c3aed';const bdr=isMT?'#fbbf24':isSM?'#67e8f9':'#c4b5fd';return<button title={vi?.error?'Error: '+vi.error+' — click to retry':'Refresh '+(isMT?'Momentec':isSM?'SanMar':'S&S')+' inventory'} onClick={()=>{delete vendorInvCache.current[item.sku];delete vendorInvFetching.current[item.sku];setVendorInv(prev=>{const n={...prev};delete n[item.sku];return n});fetchVendorInventory(item.sku,item.vendor_id,item)}} style={{background:'none',border:'1px solid '+bdr,borderRadius:4,cursor:'pointer',color:vi?.error?'#dc2626':clr,padding:'2px 6px',fontSize:9,fontWeight:700,marginLeft:4,whiteSpace:'nowrap'}}>{vi?.loading?'...':vi?.error?'⚠ '+lbl:'↻ '+lbl}</button>}return null})()}
            {(()=>{if(!isAdidasItem(item))return null;const ai=adidasInv[item.sku];return<button title={ai?.error?'Error: '+ai.error+' — click to retry':'Refresh Adidas B2B inventory'} onClick={()=>{delete adidasInvCache.current[item.sku];delete adidasInvFetching.current[item.sku];setAdidasInv(prev=>{const n={...prev};delete n[item.sku];return n});fetchAdidasInv(item.sku)}} style={{background:'none',border:'1px solid #6ee7b7',borderRadius:4,cursor:'pointer',color:ai?.error?'#dc2626':'#059669',padding:'2px 6px',fontSize:9,fontWeight:700,marginLeft:4,whiteSpace:'nowrap'}}>{ai?.loading?'...':ai?.error?'⚠ B2B':'↻ B2B'}</button>})()}
            {!(isE&&item.qty_only)&&<div style={{position:'relative',marginLeft:4}}><button className="btn btn-sm btn-secondary" onClick={()=>setShowSzPicker(showSzPicker===idx?null:idx)} style={{fontSize:10}}>+ Size</button>
              {showSzPicker===idx&&<><div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:39}} onClick={()=>setShowSzPicker(null)}/><div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:40,padding:6,display:'flex',gap:3,flexWrap:'wrap',width:180}}>
                {addable.map(sz=><button key={sz} className="btn btn-sm btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>addSzToItem(idx,sz)}>{sz}</button>)}
                {isE&&<button className="btn btn-sm" style={{fontSize:10,padding:'2px 6px',color:'#dc2626',border:'1px solid #fca5a5',width:'100%',marginTop:3}} onClick={()=>{uI(idx,'qty_only',true);uI(idx,'est_qty',szQty||0);uI(idx,'sizes',{});setShowSzPicker(null)}}>No Sizes (Qty Only)</button>}
                </div></>}
            </div>}
          </div>
          {/* Adidas B2B last synced + shortfall indicators */}
          {(()=>{if(!isAdidasItem(item))return null;const ai=adidasInv[item.sku];if(!ai||ai.loading)return null;
            const hasSizes=Object.keys(ai.sizes||{}).length>0;
            const ls=ai.lastSynced?new Date(ai.lastSynced):null;const staleHrs=ls?(Date.now()-ls.getTime())/3600000:999;
            const shortfalls=[];
            if(hasSizes){Object.entries(item.sizes||{}).forEach(([sz,need])=>{if(!need||need<=0)return;const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);const nsaStk=p?._inv?.[sz]||0;const b2bStk=ai.sizes[sz]?.qty||0;const total=nsaStk+b2bStk;if(need>total)shortfalls.push({sz,need,avail:total,short:need-total})})}
            return<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'0 18px 2px',fontSize:10}}>
              {hasSizes&&ls&&<span style={{color:staleHrs>48?'#d97706':'#94a3b8',fontWeight:staleHrs>48?700:400}}>{staleHrs>48?'⚠ ':''}B2B synced: {ls.toLocaleDateString()+' '+ls.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>}
              {!hasSizes&&<span style={{color:'#94a3b8',fontStyle:'italic'}}>No Adidas B2B data — run inventory sync</span>}
              {shortfalls.length>0&&<span style={{color:'#dc2626',fontWeight:700}}>Shortfall: {shortfalls.map(s=>s.sz+' need '+s.short).join(', ')}</span>}
            </div>})()}
          {/* Financial summary — right side of sizes row */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}>
            {isSO&&szQty===0&&safeNum(item.est_qty)>0&&<span style={{fontSize:11,color:'#dc2626',fontWeight:700}}>Enter sizes ({item.est_qty} total)</span>}
            {isE&&item.qty_only&&safeNum(item.est_qty)>0&&<span style={{fontSize:10,color:'#64748b',fontStyle:'italic'}}>Qty only — sizes can be added later</span>}
            {isSO&&(()=>{const p=products.find(pp=>pp.id===item.product_id||pp.sku===item.sku);
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
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='pulled'?'#166534':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>setEditPick({lineIdx:idx,pickIdx:pi,pick:pk})} title="Click to edit">{pk.pick_id||'PICK'}:</span>
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
            const szKeysAll=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='drop_ship'&&typeof po[k]==='number');
            const totalOrd=szKeysAll.reduce((a,sz)=>a+(po[sz]||0),0);
            const totalRcvd=szKeysAll.reduce((a,sz)=>a+(rcvd[sz]||0),0);
            const totalBlld=szKeysAll.reduce((a,sz)=>a+((blld[sz]||0)),0);
            const totalCncl=szKeysAll.reduce((a,sz)=>a+(cncl[sz]||0),0);
            const totalOpen=szKeysAll.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(rcvd[sz]||0)-(cncl[sz]||0)),0);
            const st=isDS?(totalBlld>=totalOrd&&totalOrd>0?'shipped':totalBlld>0?'partial':'waiting'):(totalOpen<=0&&totalRcvd>0?'received':totalRcvd>0?'partial':'waiting');
            return<div key={pi} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,width:46,color:st==='received'||st==='shipped'?'#166534':st==='partial'?'#b45309':'#92400e',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{
                // Find all items on this PO
                const poId=po.po_id;const lines=[];
                safeItems(o).forEach((it2,i2)=>{safePOs(it2).forEach((po2,pi2)=>{if(po2.po_id===poId)lines.push({lineIdx:i2,poIdx:pi2})})});
                setEditPO({lineIdx:idx,poIdx:pi,po,allLines:lines.length>0?lines:[{lineIdx:idx,poIdx:pi}]});
              }} title="Click to edit">{po.po_id||'PO'}:</span>
              {szs.map(sz=>{const v=po[sz]||0;const r=isDS?(blld[sz]||0):(rcvd[sz]||0);const cn=cncl[sz]||0;if(!v)return<div key={sz} style={{width:48,textAlign:'center',fontSize:10,color:'#d1d5db'}}>—</div>;
                const szSt=cn>=v?'cancelled':r>=(v-cn)?(isDS?'shipped':'received'):r>0?'partial':'waiting';
                return<div key={sz} style={{width:48,textAlign:'center',fontSize:12,fontWeight:700,padding:'2px 0',borderRadius:3,
                  background:szSt==='cancelled'?'#fef2f2':szSt==='received'||szSt==='shipped'?'#dcfce7':szSt==='partial'?'#fef3c7':'#fef3c7',
                  color:szSt==='cancelled'?'#dc2626':szSt==='received'||szSt==='shipped'?'#166534':szSt==='partial'?'#b45309':'#92400e'}}>{szSt==='cancelled'?'✕':szSt==='partial'?r+'/'+(v-cn):v-cn}</div>})}
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,
                background:st==='received'||st==='shipped'?'#dcfce7':st==='partial'?'#fff7ed':'#fef3c7',
                color:st==='received'||st==='shipped'?'#166534':st==='partial'?'#b45309':'#92400e'}}>{st==='shipped'?'✓ Shipped':st==='received'?'✓ Received':st==='partial'?(isDS?totalBlld+'/'+(totalOrd-totalCncl)+' Billed':totalRcvd+'/'+(totalOrd-totalCncl)+' Rcvd'):'Waiting'}</span>
              {isDS&&<span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,marginLeft:4,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
            </div>})}
        </div>}
        {/* BATCH PO QUEUE INDICATORS */}
        {isSO&&(()=>{const bpMatches=(batchPOs||[]).filter(bp=>bp.so_id===o.id).flatMap(bp=>bp.items.filter(it=>it.item_idx===idx).map(it=>({...it,bpo_id:bp.id,vendor_name:bp.vendor_name,created_at:bp.created_at})));
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
              return(<div key={di} style={decoCardStyle}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  {(!deco.art_file_id||deco.art_file_id==='__tbd')&&<div style={{width:36,height:36,borderRadius:6,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>🎨</div>}
                  {artF&&deco.art_file_id!=='__tbd'&&<div style={{position:'relative'}}><div style={{width:36,height:36,borderRadius:6,background:artF.preview_url?'white':artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,cursor:'pointer',border:artF.preview_url?'1px solid #e2e8f0':'2px solid transparent',overflow:'hidden'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}} title="Click to expand">{artF.preview_url?<img src={artF.preview_url} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:artIcon}</div>
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
                  <select className="form-select" style={{width:200,fontSize:12,border:!deco.art_file_id?'2px solid #f59e0b':'1px solid #22c55e'}} value={deco.art_file_id||''} onChange={e=>{const v=e.target.value;if(v==='__tbd'){uDM(idx,di,{art_file_id:'__tbd',art_tbd_type:'screen_print',sell_override:null})}else if(v==='__new_tbd'){const tbdCount=af.filter(f=>f.name&&f.name.startsWith('ART TBD')).length;const newName='ART TBD '+(tbdCount+1);const newTbd={id:'af'+Date.now(),name:newName,deco_type:'screen_print',status:'waiting_for_art',color_ways:[],files:[],mockup_files:[],prod_files:[],notes:'',uploaded:new Date().toLocaleDateString()};sv('art_files',[...af,newTbd]);setTimeout(()=>uD(idx,di,'art_file_id',newTbd.id),0);nf('Created '+newName)}else{uD(idx,di,'art_file_id',v||null)}}}>
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
                  {artF&&<><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:artF.deco_type==='screen_print'?'#dbeafe':artF.deco_type==='embroidery'?'#ede9fe':'#fef3c7',color:artF.deco_type==='screen_print'?'#1e40af':artF.deco_type==='embroidery'?'#6d28d9':'#92400e'}}>{artF.deco_type.replace('_',' ')}</span>
                    {(artF.color_ways||[]).length>0?(()=>{
                      if(artF.color_ways.length===1&&!deco.color_way_id){setTimeout(()=>uD(idx,di,'color_way_id',artF.color_ways[0].id),0)}
                      return<select className="form-select" style={{width:160,fontSize:11}} value={deco.color_way_id||(artF.color_ways.length===1?artF.color_ways[0].id:'')} onChange={e=>uD(idx,di,'color_way_id',e.target.value||null)}>
                      {artF.color_ways.length>1&&<option value="">Select CW...</option>}{artF.color_ways.map((cw,ci)=><option key={cw.id} value={cw.id}>CW {ci+1}{cw.garment_color?' - '+cw.garment_color:''} ({cw.inks.filter(c=>c.trim()).length}c)</option>)}</select>})()
                    :artF.ink_colors?<span style={{fontSize:11,color:'#64748b'}}>{artF.ink_colors.split('\n').filter(l=>l.trim()).length} color(s)</span>
                    :artF.thread_colors?<span style={{fontSize:11,color:'#64748b'}}>Thread: {artF.thread_colors}</span>:null}
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
                <Bg options={[{value:'heat_transfer',label:'Heat Transfer'},{value:'embroidery',label:'Embroidery'},{value:'screen_print',label:'Screen Print'}]} value={nm} onChange={v=>{const ns=NUM_SZ[v]||[];uDM(idx,di,{num_method:v,num_size:ns[Math.min(2,ns.length-1)]||ns[0]||'4"',num_font:null,custom_font_art_id:null})}}/>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',marginLeft:4}}>{deco.front_and_back?'Size (Front):':'Size:'}</span>
                <Bg options={szOpts.map(s=>({value:s,label:s}))} value={deco.num_size||szOpts[0]} onChange={v=>uD(idx,di,'num_size',v)}/>
                <label style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginLeft:4}}><input type="checkbox" checked={deco.two_color||false} onChange={e=>uD(idx,di,'two_color',e.target.checked)}/> 2-Color (+$3)</label>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b',marginLeft:4}}>Color:</span>
                <input className="form-input" style={{width:90,fontSize:12,padding:'2px 6px'}} placeholder="e.g. White" value={deco.print_color||''} onChange={e=>uD(idx,di,'print_color',e.target.value)}/>
              </div>
              {deco.front_and_back&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Size (Back):</span>
                <Bg options={szOpts.map(s=>({value:s,label:s}))} value={deco.num_size_back||deco.num_size||szOpts[0]} onChange={v=>uD(idx,di,'num_size_back',v)}/>
              </div>}
              {/* Font selection */}
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Font:</span>
                {nm==='embroidery'&&<span style={{fontSize:12,color:'#475569'}}>Block (standard)</span>}
                {nm==='screen_print'&&<><Bg options={[{value:'block',label:'Block'},{value:'serif',label:'Serif'}]} value={deco.num_font||'block'} onChange={v=>uD(idx,di,'num_font',v)}/>
                  {!deco.custom_font_art_id&&<button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>or Custom Font Art</button>}
                  {deco.custom_font_art_id&&<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
                {nm==='heat_transfer'&&<>{!deco.custom_font_art_id?<><span style={{fontSize:12,color:'#475569'}}>Standard</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id','pending')}>Use Custom Font Art</button></>
                  :<><span style={{fontSize:11,color:'#7c3aed'}}>Custom font art</span><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>uD(idx,di,'custom_font_art_id',null)}>× Clear</button></>}</>}
              </div>
              {/* Front + Back toggle + number assignment */}
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:deco.front_and_back?'#7c3aed':'#faf5ff',borderColor:'#c084fc',color:deco.front_and_back?'white':'#7c3aed',fontWeight:deco.front_and_back?700:400}} onClick={()=>{uD(idx,di,'front_and_back',!deco.front_and_back);nf(deco.front_and_back?'Front + Back OFF — single side':'Front + Back ON — qty doubled')}}>↕ Front + Back{deco.front_and_back?' ✓':''}</button>
              <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:deco.reversible?'#0891b2':'#ecfeff',borderColor:'#67e8f9',color:deco.reversible?'white':'#0891b2',fontWeight:deco.reversible?700:400}} onClick={()=>{uD(idx,di,'reversible',!deco.reversible);nf(deco.reversible?'Reversible OFF':'Reversible ON — qty doubled')}}>🔄 Reversible{deco.reversible?' ✓':''}</button>
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
              const nd=deco.names||{};const nSell=safeNum(deco.sell_override||deco.sell_each||6);const nCost=safeNum(deco.cost_each||3);
              const nCt=Object.values(nd).flat().filter(v=>v&&v.trim()).length;
              const nameQtyOverride=safeNum(deco.name_qty)||0;
              const effectiveNameQty=nCt||nameQtyOverride;
              return(<div key={di} style={decoCardStyle}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:18}}>🏷️</span><span style={{fontWeight:700,fontSize:13}}>Names</span>
                <select className="form-select" style={{width:120,fontSize:12}} value={deco.position} onChange={e=>uD(idx,di,'position',e.target.value)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Color:</span>
                <input className="form-input" style={{width:90,fontSize:12,padding:'2px 6px'}} placeholder="e.g. White" value={deco.print_color||''} onChange={e=>uD(idx,di,'print_color',e.target.value)}/>
                <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:12}}>$/ea: <$In value={item.is_promo&&o.promo_applied?rQ(nSell*1.25):nSell} onChange={v=>uD(idx,di,'sell_override',item.is_promo&&o.promo_applied?rQ(v/1.25):v)} w={40}/></span>
                  {item.is_promo&&o.promo_applied&&<span style={{fontSize:9,color:'#92400e',fontWeight:600}}>+25%</span>}
                  <span style={{fontSize:11,color:'#64748b'}}>{effectiveNameQty} names = ${ (effectiveNameQty*(item.is_promo&&o.promo_applied?rQ(nSell*1.25):nSell)).toFixed(2)}</span>
                  {nCt===0&&<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#64748b'}}>Qty: <input type="number" min="0" style={{width:48,border:'1px solid #d1d5db',borderRadius:3,padding:'2px 4px',fontSize:12,fontWeight:600,textAlign:'center'}} value={deco.name_qty||''} placeholder="—" onChange={e=>uD(idx,di,'name_qty',parseInt(e.target.value)||0)}/></span>}
                  <button onClick={()=>rmD(idx,di)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Icon name="x" size={14}/></button>
                </div></div>
              <div style={{padding:10,background:'#fffbeb',borderRadius:6,border:'1px dashed #f59e0b'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#3b82f6'}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='#f59e0b'}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#f59e0b';
                  const f=e.dataTransfer.files[0];if(!f)return;const reader=new FileReader();
                  reader.onload=ev=>{const lines=ev.target.result.split('\n').filter(l=>l.trim());const nn={...nd};let ct=0;
                    lines.forEach(line=>{if(line.toLowerCase().startsWith('size'))return;const parts=line.split(',').map(s=>s.trim());const sz=parts[0];const name=parts.length>=3?parts[2]:parts[1]||'';
                      if(sz&&name&&item.sizes[sz]>0){if(!nn[sz])nn[sz]=Array(item.sizes[sz]||0).fill('');const ei=nn[sz].findIndex(v=>!v);if(ei>=0){nn[sz][ei]=name;ct++}}});
                    uD(idx,di,'names',nn);nf(ct+' names imported')};reader.readAsText(f)}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#92400e'}}>Drag CSV or enter names</span>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9}} onClick={()=>{let csv='Size,Number,Name\n';sQ2.forEach(([sz,sq])=>{for(let i=0;i<sq;i++)csv+=sz+',,\n'});const b=new Blob([csv],{type:'text/csv'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='name_template_'+item.sku+'.csv';a.click();URL.revokeObjectURL(u)}}>📥 Template</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,color:'#dc2626'}} onClick={()=>{uD(idx,di,'names',{});nf('Cleared')}}>Clear</button></div></div>
                {sQ2.length===0?<div style={{fontSize:11,color:'#94a3b8'}}>Add sizes first</div>:
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {sQ2.map(([sz,sq])=>{const sn=nd[sz]||[];return<div key={sz} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{width:50,fontSize:12,fontWeight:700,color:'#92400e'}}>{sz} ({sq})</span>
                    {Array.from({length:sq}).map((_,si)=><input key={si} style={{width:100,border:'1px solid #d1d5db',borderRadius:3,padding:'3px 6px',fontSize:12,background:sn[si]?'#fef3c7':'white'}} value={sn[si]||''} placeholder="Name" onChange={e=>{const nn2={...nd};const ar=[...(nn2[sz]||Array(sq).fill(''))];ar[si]=e.target.value;nn2[sz]=ar;uD(idx,di,'names',nn2)}}/>)}
                  </div>})}</div>}
              </div></div>)}
            return null})}
          {safeDecos(item).length>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 12px',background:'#f0f9ff',borderRadius:6,marginTop:4,alignItems:'center',flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:'#64748b'}}>Cost: <strong>${item.nsa_cost?.toFixed(2)}</strong>/ea</span>
              <span style={{fontSize:11,color:'#64748b'}}>Sell: <strong>${item.unit_sell?.toFixed(2)}</strong>/ea</span>
              {(isAU(item.brand)||item.retail_price>0)&&<span style={{fontSize:11,color:'#64748b'}}>Retail: ${item.retail_price?.toFixed(2)}</span>}
            </div>
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <span style={{fontSize:11,color:'#64748b'}}>Garment: ${(qty*safeNum(item.unit_sell)).toFixed(2)}</span>
              <span style={{fontSize:11,color:'#64748b'}}>Deco: ${(()=>{let d=0;safeDecos(item).forEach(dd=>{const cq2=dd.kind==='art'&&dd.art_file_id?artQty[dd.art_file_id]:qty;const dp2=dP(dd,qty,af,cq2);const eq2=dp2._nq!=null?dp2._nq:qty;d+=eq2*dp2.sell});return d.toFixed(2)})()}</span>
              <span style={{fontSize:12,fontWeight:800,color:'#1e40af'}}>All-In: ${iR.toFixed(2)}</span>
            </div>
          </div>}
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addArtDeco(idx)}><Icon name="image" size={12}/> + Add Art</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNumDeco(idx)}>#️⃣ + Numbers</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>addNameDeco(idx)}>🏷️ + Names</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,background:'#faf5ff',borderColor:'#ddd6fe',color:'#7c3aed'}} onClick={()=>addOutsideDeco(idx)}>🎨 + Outside Deco</button>
            {(()=>{const sa=item.size_availability||{};const hasAny=Object.keys(sa).length>0;const activeSizes=szs.filter(sz=>(item.sizes[sz]||0)>0);
              if(activeSizes.length===0)return null;
              return<button className="btn btn-sm btn-secondary" style={{fontSize:11,background:hasAny?'#fef3c7':'white',borderColor:hasAny?'#fbbf24':'#d1d5db',color:hasAny?'#92400e':'#64748b'}} onClick={()=>{if(!hasAny){uI(idx,'size_availability',{[activeSizes[0]]:''})}else{uI(idx,'_showAvail',!item._showAvail)}}}>⏳ Later Avail{hasAny?' ✓':''}</button>})()}
            {safeDecos(item).map((d,di)=>d.kind==='art'?<React.Fragment key={'deco-x-'+di}>{(()=>{const artF=af.find(f=>f.id===d.art_file_id);return artF&&artF.deco_type==='screen_print'?<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:d.underbase?'#fef3c7':'#f1f5f9',borderRadius:4,cursor:'pointer',border:'1px solid '+(d.underbase?'#fbbf24':'#e2e8f0')}}><input type="checkbox" checked={d.underbase||false} onChange={e=>uD(idx,di,'underbase',e.target.checked)}/> Underbase</label>:null})()}<label style={{fontSize:11,display:'flex',alignItems:'center',gap:3,padding:'2px 6px',background:d.reversible?'#ecfeff':'#f1f5f9',borderRadius:4,cursor:'pointer',border:'1px solid '+(d.reversible?'#67e8f9':'#e2e8f0')}}><input type="checkbox" checked={d.reversible||false} onChange={e=>{uD(idx,di,'reversible',e.target.checked);nf(e.target.checked?'Reversible ON — qty doubled':'Reversible OFF')}}/> Reversible (×2)</label>{(()=>{const artF=af.find(f=>f.id===d.art_file_id);return artF?<span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:artF.status==='approved'?'#dcfce7':'#fef3c7',color:artF.status==='approved'?'#166534':'#92400e',fontWeight:600}}>{(artF.status||'').replace(/_/g,' ')}</span>:null})()}</React.Fragment>:null)}
            {safeDecos(item).length===0&&!item.no_deco&&qty>0&&<button className="btn btn-sm" style={{background:'#fef3c7',color:'#92400e',border:'1px solid #f59e0b',fontSize:10}} onClick={()=>uI(idx,'no_deco',true)}>✓ No Deco (Blank)</button>}
            {item.no_deco&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:4,background:'#f1f5f9',color:'#64748b',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>🚫 No Decoration <button onClick={()=>uI(idx,'no_deco',false)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:12,padding:0,marginLeft:2}}>✕</button></span>}
            {safeDecos(item).length===0&&!item.no_deco&&qty>0&&<span style={{fontSize:10,color:'#dc2626',fontWeight:600}}>⚠️ No deco assigned</span>}
          </div>
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
      <button className="btn btn-secondary" style={{marginLeft:'auto'}} onClick={()=>setNsImport({step:'paste',raw:'',parsed:[],decoLines:[],issues:[]})} disabled={!cust}>📥 Import from NetSuite</button></div>
      :<div><div className="search-bar" style={{marginBottom:8}}><Icon name="search"/><input placeholder="Search SKU, name, brand... (searches S&S + SanMar live)" value={pS} onChange={e=>setPS(e.target.value)} autoFocus/></div>
        <div style={{maxHeight:350,overflow:'auto'}}>
          {fp.slice(0,12).map(p=><div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #f8fafc',cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onClick={()=>addP(p)}>
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
              {isExp&&<div style={{background:'#faf8ff',borderBottom:'2px solid #ddd6fe',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {ss.colors.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #ddd6fe',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(ss,c,'ss')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)+' ('+c.totalQty+' avail)'}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:20,height:20,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#7c3aed',whiteSpace:'nowrap'}}>${c.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:8,color:c.totalQty>0?'#22c55e':'#dc2626'}}>{c.totalQty>0?c.totalQty.toLocaleString():'OOS'}</span>
                </div>)}
              </div>}
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
              {isExp&&<div style={{background:'#f0fdfa',borderBottom:'2px solid #a5f3fc',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {sm.colors.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #a5f3fc',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(sm,c,'sm')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)+' ('+c.totalQty+' avail)'}>
                  {c.colorFrontImage&&<img src={c.colorFrontImage} alt="" style={{width:20,height:20,objectFit:'contain',borderRadius:2}} onError={e=>{e.target.style.display='none'}}/>}
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#0891b2',whiteSpace:'nowrap'}}>${c.customerPrice?.toFixed(2)}</span>
                  <span style={{fontSize:8,color:c.totalQty>0?'#22c55e':'#dc2626'}}>{c.totalQty>0?c.totalQty.toLocaleString():'OOS'}</span>
                </div>)}
              </div>}
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
                <span style={{fontWeight:700,color:'#b45309',fontSize:13,marginLeft:'auto'}}>from ${mt._mtPrice?.toFixed(2)}</span>
                <span style={{fontSize:14,color:'#d97706'}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&<div style={{background:'#fffbeb',borderBottom:'2px solid #fcd34d',padding:'6px 12px',display:'flex',flexWrap:'wrap',gap:4,maxHeight:200,overflowY:'auto'}}>
                {mt.colors.map((c,ci)=><div key={ci} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #fcd34d',background:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',gap:4,minWidth:0}} onClick={()=>addSearchProduct(mt,c,'mt')} title={c.colorName+' — $'+c.customerPrice?.toFixed(2)}>
                  <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{c.colorName||'Default'}</span>
                  <span style={{fontSize:9,color:'#b45309',whiteSpace:'nowrap'}}>${c.customerPrice?.toFixed(2)}</span>
                </div>)}
              </div>}
            </div>})}
            {!mtSearching&&mtResults.length===0&&pS.length>=2&&<div style={{padding:'10px 12px',color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>No Momentec results for "{pS}"</div>}
          </>}
        </div>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([])}} style={{marginTop:8}}>Cancel</button>
        <button className="btn btn-sm btn-secondary" onClick={()=>{setShowAdd(false);setPS('');setSsResults([]);setSmResults([]);setMtResults([]);setShowCustom(true)}} style={{marginTop:8,marginLeft:4}}>+ Custom Item</button></div>}
    </div></div>
    {showCustom&&<div className="card" style={{marginTop:8,borderLeft:'3px solid #d97706'}}><div style={{padding:'14px 18px'}}>
      <div style={{fontWeight:700,marginBottom:8}}>✏️ Custom Item {custItem.name&&<span style={{fontWeight:400,fontSize:12,color:'#64748b'}}>— {custItem.name}</span>}</div>
      <div style={{display:'grid',gridTemplateColumns:'120px 1fr 120px',gap:8,marginBottom:8}}>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Brand / Vendor</label><SearchSelect options={D_V.map(v=>({value:v.id,label:v.name}))} value={custItem.vendor_id} onChange={vid=>{const vn=D_V.find(v=>v.id===vid)?.name||'';setCustItem(x=>({...x,vendor_id:vid,brand:vn}))}} placeholder="Search vendors..."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Item Name</label><input className="form-input" value={custItem.name} onChange={e=>setCustItem(x=>({...x,name:e.target.value}))} placeholder="Custom jersey, special order hat, etc."/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Color</label><input className="form-input" value={custItem.color} onChange={e=>setCustItem(x=>({...x,color:e.target.value}))} placeholder="Navy"/></div></div>

      {/* Pricing section — brand-aware */}
      {(()=>{const brandName=D_V.find(v=>v.id===custItem.vendor_id)?.name||'';const au=isAU(brandName);const tier=cust?.adidas_ua_tier||'B';const disc=tD[tier]||0.35;const mk=o.default_markup||1.65;
        return<>
          <div style={{padding:8,background:au?'#eff6ff':'#f8fafc',borderRadius:6,marginBottom:8,fontSize:11}}>
            {au?<><strong>💎 {brandName} — Tier {tier}:</strong> Cost = Retail × {brandName==='Adidas'?'0.5 × 0.75 (37.5%)':'0.5 × 0.85 (42.5%)'}. Sell = Retail × {Math.round((1-disc)*100)}%.</>
                :<><strong>📦 Standard Pricing:</strong> Cost × {mk}x markup = Sell price. {brandName?'Brand: '+brandName:'Select brand above.'}</>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'100px 100px 100px 100px 1fr',gap:8,marginBottom:8,alignItems:'end'}}>
            <div><label style={{fontSize:10,fontWeight:600,color:'#64748b'}}>SKU</label><input className="form-input" value={custItem.sku} onChange={e=>setCustItem(x=>({...x,sku:e.target.value}))}/></div>
            {au&&<div><label style={{fontSize:10,fontWeight:600,color:'#1e40af'}}>Retail $</label><$In value={custItem.retail_price||0} onChange={v=>{const costMult=brandName==='Adidas'?0.375:0.425;const cost=Math.floor(v*costMult*100)/100;const sell=rQ(v*(1-disc));setCustItem(x=>({...x,retail_price:v,nsa_cost:cost,unit_sell:sell}))}}/></div>}
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
            <ImgUpload url={custItem.image_url} onUpload={u=>setCustItem(x=>({...x,image_url:u}))} onError={e=>nf(e,'error')} size={72}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:9,fontWeight:600,color:'#64748b',marginBottom:2}}>Additional Images</div>
            <ImgGallery images={custItem.images||[]} onUpdate={imgs=>setCustItem(x=>({...x,images:imgs}))} onError={e=>nf(e,'error')} maxImages={5}/>
          </div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <button className="btn btn-primary" disabled={!custItem.name} onClick={()=>{const brandName=D_V.find(v=>v.id===custItem.vendor_id)?.name||'Custom';
          const newItem={product_id:null,sku:custItem.sku||'CUSTOM',name:custItem.name,brand:brandName,vendor_id:custItem.vendor_id,color:custItem.color,nsa_cost:custItem.nsa_cost,retail_price:custItem.retail_price||0,unit_sell:custItem.unit_sell,available_sizes:['S','M','L','XL','2XL'],sizes:{},qty_only:false,decorations:isE?[{kind:'art',art_file_id:'__tbd',art_tbd_type:'screen_print',position:'',sell_override:null}]:[],is_custom:true,image_url:custItem.image_url||'',images:custItem.images||[]};
          if(custItem.saveToCatalog&&onSaveProduct&&custItem.sku&&custItem.sku!=='CUSTOM'){
            const newProd={id:'p'+Date.now(),vendor_id:custItem.vendor_id||null,sku:custItem.sku,name:custItem.name,brand:brandName,color:custItem.color||'',
              category:'Tees',retail_price:custItem.retail_price||0,nsa_cost:custItem.nsa_cost||0,available_sizes:['S','M','L','XL','2XL'],is_active:true,_inv:{},image_url:custItem.image_url||'',back_image_url:'',images:custItem.images||[]};
            onSaveProduct(newProd);newItem.product_id=newProd.id;nf('Item saved to product catalog')}
          sv('items',[...o.items,newItem]);
          setShowCustom(false);setCustItem({vendor_id:'',name:'',sku:'CUSTOM',nsa_cost:0,unit_sell:0,retail_price:0,color:'',brand:'',saveToCatalog:false,image_url:'',images:[]})}}>Add Item</button>
        <button className="btn btn-secondary" onClick={()=>setShowCustom(false)}>Cancel</button>
        {onSaveProduct&&<label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,color:'#475569',marginLeft:8}}>
          <input type="checkbox" checked={custItem.saveToCatalog||false} onChange={e=>setCustItem(x=>({...x,saveToCatalog:e.target.checked}))} style={{width:14,height:14}}/>
          Save to product catalog {custItem.saveToCatalog&&(!custItem.sku||custItem.sku==='CUSTOM')&&<span style={{color:'#d97706',fontSize:10}}>(enter a SKU first)</span>}
        </label>}</div>
    </div></div>}

    {/* NETSUITE IMPORT WIZARD */}
    {nsImport&&<div className="modal-overlay" onClick={()=>setNsImport(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:900,maxHeight:'90vh',overflow:'auto'}}>
      <div className="modal-header" style={{background:'#eff6ff'}}><h2>📥 Import from NetSuite</h2><button className="modal-close" onClick={()=>setNsImport(null)}>×</button></div>
      <div className="modal-body">

      {/* STEP 1: Paste data */}
      {nsImport.step==='paste'&&<>
        <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>
          Copy the line items from your NetSuite Sales Order (ITEM through INVOICED columns) and paste below. The parser handles:
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
          {['Size-split lines (JJ0605-M, JJ0605-L → one item)','Custom/misc lines with sizes in description','Decoration lines (Screen Print, Embroidery)','PO references and fulfillment data','Shipping lines'].map(t=>
            <span key={t} style={{fontSize:10,padding:'2px 8px',background:'#f0fdf4',borderRadius:8,color:'#166534'}}>✓ {t}</span>)}
        </div>
        <textarea className="form-input" rows={14} value={nsImport.raw} onChange={e=>setNsImport(x=>({...x,raw:e.target.value}))}
          placeholder={"Paste NetSuite lines here...\n\nExample:\nJJ0605 : JJ0605-M\tAdidas PRACTICE 2.0J - Power Red - M\t30\tAdidas Contract\t21.00\t630.00\tPO4133 OLuF\n..."} style={{fontFamily:'monospace',fontSize:11,whiteSpace:'pre'}}/>
        <div style={{marginTop:8,display:'flex',gap:8}}>
          <button className="btn btn-primary" disabled={!nsImport.raw.trim()} onClick={()=>{
            // PARSE NETSUITE DATA
            const lines=nsImport.raw.trim().split('\n').filter(l=>l.trim());
            const items={};const decoLines=[];const issues=[];const shipping=[];
            const SZ_RE=/[-\s](XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|YXS|YS|YM|YL|YXL|OSFA)$/i;
            const SZ_DESC=/\b(\d+)\s*\/\s*(S|M|L|XL|2XL|3XL|4XL|XXS|XS|YS|YM|YL|YXL)\b/gi;
            const DECO_RE=/^(screen\s*print|embroidery|dtf|heat\s*transfer|vinyl|sublimation)/i;

            lines.forEach((line,li)=>{
              const cols=line.split('\t').map(c=>c.trim());
              if(cols.length<4){issues.push({line:li+1,msg:'Too few columns: "'+line.slice(0,60)+'"'});return}
              const rawItem=cols[0]||'';const desc=cols[1]||'';const qty=parseInt(cols[2])||0;
              const priceLevel=cols[3]||'';const rate=parseFloat(cols[4])||0;const amount=parseFloat(cols[5])||0;
              const poRef=cols[6]||'';

              // Skip header rows
              if(rawItem.toUpperCase()==='ITEM'||desc.toUpperCase()==='DESCRIPTION')return;

              // Shipping line
              if(rawItem.toLowerCase().includes('shipping')||desc.toLowerCase().includes('shipping')){
                shipping.push({desc,amount});return}

              // Decoration line
              if(DECO_RE.test(desc)||rawItem.toLowerCase().includes('screen')||rawItem.toLowerCase().includes('embroid')){
                decoLines.push({rawItem,desc,qty,rate,amount,poRef});return}

              // Check if this is a size-suffixed SKU (JJ0605-M, IT0266-XL, JX4452-2XL)
              const skuParts=rawItem.split(/\s*:\s*/);const itemCode=skuParts[0]||rawItem;
              const sizeMatch=(skuParts[1]||itemCode).match(SZ_RE);
              let baseSku,size;
              if(sizeMatch){
                size=sizeMatch[1].toUpperCase();
                baseSku=(skuParts[1]||itemCode).replace(SZ_RE,'').replace(/-$/,'').trim();
                if(!baseSku)baseSku=itemCode.replace(SZ_RE,'').replace(/-$/,'').trim();
              } else {
                // Try extracting from description (Misc Adi lines with sizes in desc)
                baseSku=itemCode;size=null;
              }

              // Extract color from description
              let color='';const colorMatch=desc.match(/[-–]\s*([A-Za-z\s\/]+?)(?:\s*[-–]\s*(?:XXS|XS|S|M|L|XL|2XL|3XL|4XL))?$/);
              if(colorMatch&&size)color=desc.replace(colorMatch[0],'').replace(/^.*?[-–]\s*/,'').replace(/^.*?[-–]\s*/,'').trim();
              if(!color){const cM=desc.match(/[-–]\s*([A-Za-z\s\/]+?)(?:\s*[-–]|$)/);if(cM)color=cM[1].trim()}

              // Determine brand from price level or description
              let brand='';
              if(priceLevel.toLowerCase().includes('adidas'))brand='Adidas';
              else if(priceLevel.toLowerCase().includes('under armour')||priceLevel.toLowerCase().includes('ua'))brand='Under Armour';
              else if(priceLevel.toLowerCase().includes('nike'))brand='Nike';
              else if(desc.toLowerCase().includes('adidas'))brand='Adidas';
              else if(desc.toLowerCase().includes('under armour'))brand='Under Armour';

              if(size&&baseSku){
                // Size-split line — collapse into parent item
                if(!items[baseSku])items[baseSku]={sku:baseSku,name:desc.replace(/\s*[-–]\s*(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i,'').replace(/\s*[-–]\s*[A-Za-z\s\/]+?\s*[-–]\s*(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i,'').trim(),brand,color,rate,sizes:{},totalQty:0,totalAmt:0,poRef,priceLevel,issues:[]};
                items[baseSku].sizes[size]=(items[baseSku].sizes[size]||0)+qty;
                items[baseSku].totalQty+=qty;items[baseSku].totalAmt+=amount;
                if(color&&!items[baseSku].color)items[baseSku].color=color;
              } else {
                // Single-line item — try to parse sizes from description
                const embeddedSizes={};let match;const sizeRe2=/(\d+)\s*\/\s*(S|M|L|XL|2XL|3XL|4XL|XXS|XS|YS|YM|YL|YXL)/gi;
                while((match=sizeRe2.exec(desc))!==null){embeddedSizes[match[2].toUpperCase()]=parseInt(match[1])}
                const hasSizes=Object.keys(embeddedSizes).length>0;
                const key=baseSku+'_'+li;
                items[key]={sku:baseSku==='Misc Adi'?'CUSTOM':baseSku,name:desc,brand,color,rate,
                  sizes:hasSizes?embeddedSizes:{OSFA:qty},totalQty:qty,totalAmt:amount,poRef,priceLevel,
                  is_custom:baseSku.toLowerCase().includes('misc')||priceLevel.toLowerCase()==='custom',
                  issues:hasSizes?[]:['Sizes parsed from description — verify']};
                if(!hasSizes&&qty>1)items[key].issues.push('Single quantity line — may need size breakdown');
              }
            });

            const parsed=Object.values(items);
            setNsImport(x=>({...x,step:'review',parsed,decoLines,issues,shipping}));
          }}>🔍 Parse Data</button>
          <button className="btn btn-secondary" onClick={()=>setNsImport(null)}>Cancel</button>
        </div>
      </>}

      {/* STEP 2: Review parsed items */}
      {nsImport.step==='review'&&<>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <div style={{padding:8,background:'#f0fdf4',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:'#166534'}}>{nsImport.parsed.length}</div><div style={{fontSize:10,color:'#64748b'}}>Items Found</div></div>
          <div style={{padding:8,background:nsImport.issues.length?'#fef2f2':'#f8fafc',borderRadius:6,flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:800,color:nsImport.issues.length?'#dc2626':'#94a3b8'}}>{nsImport.issues.length}</div><div style={{fontSize:10,color:'#64748b'}}>Issues</div></div>
        </div>

        {nsImport.issues.length>0&&<div style={{marginBottom:8,padding:8,background:'#fef2f2',borderRadius:6}}>
          <div style={{fontSize:11,fontWeight:700,color:'#dc2626',marginBottom:4}}>⚠️ Parser Issues</div>
          {nsImport.issues.map((is,i)=><div key={i} style={{fontSize:10,color:'#991b1b'}}>Line {is.line}: {is.msg}</div>)}
        </div>}

        <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:6}}>📦 Parsed Items — Review & Edit</div>
        <div style={{maxHeight:350,overflow:'auto',border:'1px solid #e2e8f0',borderRadius:6}}>
          <table style={{fontSize:11}}><thead><tr><th style={{width:30}}>✓</th><th>SKU</th><th>Name</th><th>Brand</th><th>Color</th><th>Rate</th><th>Sizes</th><th>Qty</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>{nsImport.parsed.map((it,i)=>{
            const toggle=()=>setNsImport(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,_skip:!p._skip}:p)}));
            const upd=(k,v)=>setNsImport(x=>({...x,parsed:x.parsed.map((p,pi)=>pi===i?{...p,[k]:v}:p)}));
            return<tr key={i} style={{opacity:it._skip?0.4:1,background:it.issues?.length?'#fffbeb':'white'}}>
              <td><input type="checkbox" checked={!it._skip} onChange={toggle}/></td>
              <td><input className="form-input" value={it.sku} onChange={e=>upd('sku',e.target.value)} style={{width:80,fontSize:10,fontFamily:'monospace'}}/></td>
              <td style={{maxWidth:180}}><input className="form-input" value={it.name} onChange={e=>upd('name',e.target.value)} style={{width:'100%',fontSize:10}}/></td>
              <td><input className="form-input" value={it.brand} onChange={e=>upd('brand',e.target.value)} style={{width:70,fontSize:10}}/></td>
              <td><input className="form-input" value={it.color} onChange={e=>upd('color',e.target.value)} style={{width:70,fontSize:10}}/></td>
              <td style={{textAlign:'right',fontWeight:600}}>${it.rate?.toFixed(2)}</td>
              <td style={{fontSize:9}}>{Object.entries(it.sizes||{}).map(([s,q])=>s+':'+q).join(', ')}</td>
              <td style={{textAlign:'center',fontWeight:700}}>{it.totalQty}</td>
              <td style={{textAlign:'right'}}>${it.totalAmt?.toFixed(2)}</td>
              <td>{it.is_custom&&<span style={{fontSize:8,background:'#fef3c7',padding:'1px 4px',borderRadius:3,color:'#92400e'}}>Custom</span>}
                {(it.issues||[]).map((iss,ii)=><div key={ii} style={{fontSize:8,color:'#d97706'}}>⚠ {iss}</div>)}</td>
            </tr>})}</tbody></table>
        </div>

        {nsImport.decoLines.length>0&&<div style={{padding:8,background:'#f0f9ff',borderRadius:6,marginTop:12,fontSize:11,color:'#1e40af'}}>
          ℹ️ {nsImport.decoLines.length} decoration line(s) detected but skipped — add decorations manually after import.
        </div>}

        {(nsImport.shipping||[]).length>0&&<div style={{marginTop:8,fontSize:11,color:'#64748b'}}>📦 Shipping: {nsImport.shipping.map(s=>s.desc+' $'+s.amount?.toFixed(2)).join(', ')}</div>}

        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setNsImport(x=>({...x,step:'paste'}))}>← Back</button>
          <button className="btn btn-primary" onClick={()=>{
            // Convert parsed items to SO line items
            const keeping=nsImport.parsed.filter(p=>!p._skip);
            const newItems=keeping.map(p=>{
              const catMatch=prod.find(pr=>pr.sku===p.sku)||(p.sku.length>3?prod.find(pr=>pr.sku.toLowerCase()===p.sku.toLowerCase()):null);
              const au=isAU(p.brand||(catMatch?.brand||''));
              const sell=p.rate||0;const cost=au?rQ(sell):rQ(sell/(o.default_markup||1.65));
              const retail=au?rQ(sell/(1-(tD[cust?.adidas_ua_tier||'B']||0.35))):0;
              const szKeys=Object.keys(p.sizes||{});
              return{product_id:catMatch?.id||null,sku:p.sku,name:catMatch?.name||p.name,brand:catMatch?.brand||p.brand,color:p.color||catMatch?.color||'',nsa_cost:catMatch?.nsa_cost||cost,retail_price:catMatch?.retail_price||retail,unit_sell:sell,
                available_sizes:szKeys.length>0?szKeys:(catMatch?.available_sizes||['S','M','L','XL','2XL']),sizes:p.sizes||{},decorations:[],
                is_custom:!catMatch&&(p.is_custom||false),pick_lines:[],po_lines:[]};
            });
            sv('items',[...o.items,...newItems]);
            if(nsImport.shipping?.length){const shipAmt=nsImport.shipping.reduce((a,s)=>a+s.amount,0);if(shipAmt>0){sv('shipping_type','flat');sv('shipping_value',shipAmt)}}
            setNsImport(null);
            nf('📥 Imported '+newItems.length+' items from NetSuite');
          }}>✅ Import {nsImport.parsed.filter(p=>!p._skip).length} Items</button>
        </div>
      </>}
      </div>
    </div></div>}
    </>}

    {/* ART LIBRARY TAB */}
    {tab==='art'&&<div className="card"><div className="card-header"><h2>Art Library</h2><div style={{display:'flex',gap:6}}>{dirty&&<button className="btn btn-sm btn-primary" onClick={()=>{const updated={...o,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSaved(true);nf('Art saved')}} style={{background:'#166534',borderColor:'#166534'}}>Save</button>}<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',border:'none',fontSize:11}} onClick={()=>setShowPrevArt(true)}>📂 Previous Artwork</button><button className="btn btn-sm btn-primary" onClick={addArt}><Icon name="plus" size={12}/> New Art Group</button></div></div>
      <div className="card-body">{af.length===0?<div className="empty">No art uploaded. Create art groups and add files.</div>:
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {af.map((art,i)=>{const usedIn=safeItems(o).reduce((a,it)=>a+safeDecos(it).filter(d=>d.art_file_id===art.id).length,0);
            const afSt=art.status==='uploaded'?'needs_approval':art.status||'waiting_for_art';
            const isCollapsed=collapsedArt[art.id];
            return(<div key={art.id} style={{padding:0,background:'#f8fafc',borderRadius:8,border:afSt==='approved'?'2px solid #22c55e':afSt==='needs_approval'?'2px solid #f59e0b':'1px solid #e2e8f0'}}>
              {/* Collapsible header */}
              <div style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',cursor:'pointer',userSelect:'none'}} onClick={()=>setCollapsedArt(prev=>({...prev,[art.id]:!prev[art.id]}))}>
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
                  {/* MOCKUP FILES — shared with customer */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#2563eb'}}>📎 MOCKUP FILES</span>
                      <span style={{fontSize:9,color:'#94a3b8'}}>Shared with customer</span>
                    </div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>{(art.mockup_files||art.files||[]).map((fn,fi)=>{const fnUrl=typeof fn==='string'?fn:(fn?.url||'');return<span key={fi} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',background:'#dbeafe',borderRadius:4,fontSize:11,cursor:isUrl(fnUrl)?'pointer':'default'}} onClick={()=>openFile(fn)} title={isUrl(fnUrl)?'Click to open':'Legacy file — re-upload'}>
                      <Icon name="file" size={10}/>{fileDisplayName(fn)}<button onClick={e=>{e.stopPropagation();const mf=[...(art.mockup_files||art.files||[])];mf.splice(fi,1);uArt(i,'mockup_files',mf);if(!art.mockup_files)uArt(i,'files',[])}} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:0}}><Icon name="x" size={10}/></button></span>})}</div>
                    <div style={{border:'2px dashed #bfdbfe',borderRadius:6,padding:12,textAlign:'center',cursor:'pointer',background:'#eff6ff',transition:'all 0.15s'}}
                      onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.png,.jpg,.jpeg,.ai,.eps';inp.multiple=true;inp.onchange=async()=>{let accumulated=[...(art.mockup_files||art.files||[])];for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-mockups');accumulated=[...accumulated,{url,name:f.name}];uArt(i,'mockup_files',accumulated);if(!art.mockup_files)uArt(i,'files',[]);nf('✅ '+f.name+' uploaded')}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}
                      onDragOver={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#dbeafe';e.currentTarget.style.borderColor='#3b82f6'}}
                      onDragLeave={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe'}}
                      onDrop={async e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#eff6ff';e.currentTarget.style.borderColor='#bfdbfe';const files=Array.from(e.dataTransfer.files);let accumulated=[...(art.mockup_files||art.files||[])];for(const f of files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-mockups');accumulated=[...accumulated,{url,name:f.name}];uArt(i,'mockup_files',accumulated);if(!art.mockup_files)uArt(i,'files',[]);nf('✅ '+f.name+' uploaded')}catch(err){nf('Upload failed: '+err.message,'error')}}}}>
                      <div style={{fontSize:11,color:'#2563eb',fontWeight:600}}><Icon name="upload" size={14}/> Drop mockup files here or click to browse</div>
                      <div style={{fontSize:9,color:'#94a3b8',marginTop:2}}>PDF, PNG, JPG, AI, EPS</div></div>
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
                      onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.ai,.eps,.dst,.png,.jpg,.jpeg';inp.multiple=true;inp.onchange=async()=>{let accumulated=[...(art.prod_files||[])];for(const f of inp.files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');accumulated=[...accumulated,{url,name:f.name}];uArt(i,'prod_files',accumulated);nf('✅ '+f.name+' uploaded')}catch(e){nf('Upload failed: '+e.message,'error')}}};inp.click()}}
                      onDragOver={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fef3c7';e.currentTarget.style.borderColor='#f59e0b'}}
                      onDragLeave={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a'}}
                      onDrop={async e=>{e.preventDefault();e.stopPropagation();e.currentTarget.style.background='#fffbeb';e.currentTarget.style.borderColor='#fde68a';const files=Array.from(e.dataTransfer.files);let accumulated=[...(art.prod_files||[])];for(const f of files){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-production');accumulated=[...accumulated,{url,name:f.name}];uArt(i,'prod_files',accumulated);nf('✅ '+f.name+' uploaded')}catch(err){nf('Upload failed: '+err.message,'error')}}}}>
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
            <button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#2563eb',fontWeight:600,padding:'4px 8px'}} onClick={()=>{const all={};af.forEach(a=>all[a.id]=true);setCollapsedArt(all)}}>Collapse All</button>
            <button style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#2563eb',fontWeight:600,padding:'4px 8px'}} onClick={()=>setCollapsedArt({})}>Expand All</button>
          </div>}
        </div>}
      </div></div>}

    {/* PREVIOUS ARTWORK PICKER MODAL */}
    {showPrevArt&&(()=>{
      const custId=o.customer_id;const parentCust2=allCustomers.find(c=>c.id===custId);
      const custIds2=parentCust2?.parent_id?[parentCust2.parent_id,custId,...allCustomers.filter(c=>c.parent_id===parentCust2.parent_id).map(c=>c.id)]:[custId,...allCustomers.filter(c=>c.parent_id===custId).map(c=>c.id)];
      const prevArtList=[];
      // Include customer-level art library
      custIds2.forEach(cid=>{const c=allCustomers.find(cc=>cc.id===cid);(c?.art_files||[]).forEach(art=>{if(!prevArtList.some(a=>a.name===art.name&&a.deco_type===art.deco_type))prevArtList.push({...art,_so_id:'Library',_so_memo:c.alpha_tag||c.name||''})})});
      (allOrders||[]).filter(so=>custIds2.includes(so.customer_id)&&so.id!==o.id).forEach(so=>{
        (so.art_files||[]).forEach(art=>{
          if(!prevArtList.some(a=>a.name===art.name&&a.deco_type===art.deco_type))
            prevArtList.push({...art,_so_id:so.id,_so_memo:so.memo||''});
        });
      });
      return<div className="modal-overlay" onClick={()=>setShowPrevArt(false)}><div className="modal" style={{maxWidth:700}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2>📂 Previous Artwork</h2><button className="modal-close" onClick={()=>setShowPrevArt(false)}>×</button></div>
        <div className="modal-body" style={{maxHeight:500,overflowY:'auto'}}>
          {prevArtList.length===0?<div className="empty">No previous artwork found for this customer</div>:
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {prevArtList.map((art,i)=>{
              const alreadyAdded=af.some(a=>a.name===art.name&&a.deco_type===art.deco_type);
              const previewImg=art.preview_url||'';
              const mockups=[...(art.mockup_files||[]),...(art.files||[]),...(art.prod_files||[]),...Object.values(art.item_mockups||{}).flat()].filter(f=>f);
              const firstMockup=mockups.find(f=>{const u=typeof f==='string'?f:(f?.url||'');return _isImgUrl(u,f)})||mockups[0];const imgUrl=previewImg||(firstMockup?(typeof firstMockup==='string'?firstMockup:firstMockup.url):'');
              return<div key={art.id+'-'+i} style={{padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  {imgUrl&&_isImgUrl(imgUrl)?<img src={imgUrl} alt="" style={{width:80,height:80,borderRadius:8,objectFit:'contain',flexShrink:0,cursor:'pointer',background:'white',border:'1px solid #e2e8f0'}} onClick={()=>previewImg?window.open(previewImg,'_blank'):openFile(firstMockup)}/>:
                    <div style={{width:80,height:80,borderRadius:8,background:art.deco_type==='screen_print'?'#dbeafe':art.deco_type==='embroidery'?'#ede9fe':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0}}>{art.deco_type==='screen_print'?'🎨':art.deco_type==='embroidery'?'🧵':'🔥'}</div>}
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14}}>{art.name||'Untitled'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{(art.deco_type||'').replace(/_/g,' ')}{(art.color_ways||[]).length>0?' · '+art.color_ways.length+' CW'+(art.color_ways.length>1?'s':''):art.ink_colors?' · '+art.ink_colors.split('\n').filter(l=>l.trim()).length+' color(s)':art.thread_colors?' · '+art.thread_colors:''}{art.art_size?' · '+art.art_size:''}</div>
                    <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{art._so_id} — {art._so_memo}</div>
                    {mockups.length>1&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                      {mockups.slice(1,5).map((f,fi)=>{const fUrl=typeof f==='string'?f:(f?.url||'');return _isImgUrl(fUrl)?<img key={fi} src={fUrl} alt="" style={{width:48,height:48,borderRadius:4,objectFit:'contain',cursor:'pointer',background:'white',border:'1px solid #e2e8f0'}} onClick={e=>{e.stopPropagation();openFile(f)}}/>:null})}
                      {mockups.length>5&&<span style={{fontSize:10,color:'#64748b',alignSelf:'center'}}>+{mockups.length-5} more</span>}
                    </div>}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end',flexShrink:0}}>
                    {alreadyAdded?<span style={{fontSize:10,color:'#22c55e',fontWeight:600}}>Already added</span>:
                    <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>{
                      const newArt={...art,id:'af'+Date.now(),uploaded:new Date().toLocaleDateString()};
                      delete newArt._so_id;delete newArt._so_memo;
                      sv('art_files',[...af,newArt]);
                      nf('Added "'+art.name+'" from '+art._so_id);
                    }}>+ Add</button>}
                    {mockups.length>0&&<span style={{fontSize:10,color:'#2563eb'}}>{mockups.length} file(s)</span>}
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

        {/* LINKED TRANSACTIONS TAB */}
    {isSO&&tab==='transactions'&&(()=>{
      const linkedPOs=[];safeItems(o).forEach(it=>{safePOs(it).forEach(po=>{if(po.po_id&&!linkedPOs.find(x=>x.po_id===po.po_id)){const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&!['status','po_id','received','shipments','cancelled','vendor','created_at','expected_date','memo','po_type','unit_cost','drop_ship','deco_vendor','deco_type','notes','billed','tracking_numbers'].includes(k)&&typeof po[k]==='number');const totalOrd=szKeys.reduce((a,sz)=>a+(po[sz]||0),0);const rcvd=po.received||{};const totalRcvd=szKeys.reduce((a,sz)=>a+(rcvd[sz]||0),0);linkedPOs.push({po_id:po.po_id,vendor:po.vendor||po.deco_vendor||'',totalOrd,totalRcvd,status:totalRcvd>=totalOrd&&totalOrd>0?'received':totalRcvd>0?'partial':'waiting',created_at:po.created_at||''})}})});
      const linkedIFs=[];safeItems(o).forEach(it=>{safePicks(it).forEach(pk=>{if(pk.pick_id&&!linkedIFs.find(x=>x.pick_id===pk.pick_id)){const szKeys=Object.keys(pk).filter(k=>!['pick_id','status','created_at','memo','ship_dest','ship_addr','deco_vendor','notes'].includes(k)&&typeof pk[k]==='number');const totalQty=szKeys.reduce((a,sz)=>a+(pk[sz]||0),0);linkedIFs.push({pick_id:pk.pick_id,status:pk.status||'pick',totalQty,created_at:pk.created_at||'',memo:pk.memo||''})}})});
      const linkedInvs=(allInvoices||[]).filter(inv=>inv.so_id===o.id);
      return<div className="card"><div className="card-header"><h2>Linked Transactions</h2></div><div className="card-body">
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {o.estimate_id&&<div style={{display:'flex',gap:12,alignItems:'center',padding:12,background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff',cursor:onViewEstimate?'pointer':'default'}} onClick={()=>onViewEstimate&&onViewEstimate(o.estimate_id)}>
          <div style={{width:40,height:40,background:'#ede9fe',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="dollar" size={20}/></div>
          <div><div style={{fontWeight:700,color:'#7c3aed',textDecoration:'underline',textDecorationStyle:'dotted'}}>{o.estimate_id}</div><div style={{fontSize:12,color:'#64748b'}}>Source Estimate</div></div><span className="badge badge-green">Converted</span></div>}
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Item Fulfillments</div>
          {linkedIFs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No item fulfillments yet</div>:
          linkedIFs.map(pk=><div key={pk.pick_id} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>setTab('items')}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{pk.pick_id}</span>
            <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`} style={{fontSize:10}}>{pk.status}</span>
            <span style={{fontSize:11,color:'#64748b'}}>{pk.totalQty} units</span>
            {pk.memo&&<span style={{fontSize:11,color:'#94a3b8'}}>{pk.memo}</span>}
          </div>)}</div>
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Purchase Orders</div>
          {linkedPOs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No purchase orders yet</div>:
          linkedPOs.map(po=><div key={po.po_id} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #f1f5f9',cursor:'pointer'}} onClick={()=>setTab('items')}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{po.po_id}</span>
            <span style={{fontSize:11,color:'#64748b'}}>{po.vendor}</span>
            <span className={`badge ${po.status==='received'?'badge-green':po.status==='partial'?'badge-amber':'badge-blue'}`} style={{fontSize:10}}>{po.status==='received'?'Received':po.status==='partial'?'Partial':'Waiting'}</span>
            <span style={{fontSize:11,color:'#64748b'}}>{po.totalRcvd}/{po.totalOrd} received</span>
          </div>)}</div>
        <div style={{padding:12,background:'#f8fafc',borderRadius:8}}><div style={{fontWeight:600,marginBottom:4}}>Invoices</div>
          {linkedInvs.length===0?<div style={{fontSize:12,color:'#94a3b8'}}>No invoices linked yet</div>:
          linkedInvs.map(inv=><div key={inv.id} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderBottom:'1px solid #f1f5f9',cursor:onNavInvoice?'pointer':'default'}} onClick={()=>onNavInvoice&&onNavInvoice(inv)}>
            <span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af',fontSize:12}}>{inv.id}</span>
            <span style={{fontSize:11,color:'#64748b'}}>${(inv.total||0).toLocaleString()}</span>
            <span className={`badge ${inv.status==='paid'?'badge-green':inv.status==='partial'?'badge-amber':'badge-blue'}`} style={{fontSize:10}}>{inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':'Open'}</span>
            {inv.date&&<span style={{fontSize:11,color:'#94a3b8'}}>{inv.date}</span>}
          </div>)}</div>
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
      const canEditCost=cu?.role==='admin'||cu?.role==='accounting'||cu?.role==='rep';

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
                      const updated=[...(o._shipments||[])];const idx=updated.findIndex(s=>s.id===shp.id);
                      if(idx>=0){updated[idx]={...updated[idx],tracking_number:tn,carrier:carrier||'',tracking_url:trackUrl(tn),ship_date:updated[idx].ship_date||new Date().toLocaleDateString()};
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

    {/* FIRM DATES TAB */}
    {isSO&&tab==='firm_dates'&&<div className="card"><div className="card-header"><h2>Firm Date Requests</h2><button className="btn btn-sm btn-primary" onClick={()=>sv('firm_dates',[...safeFirm(o),{item_desc:'',date:'',approved:false}])}><Icon name="plus" size={12}/> Add</button></div>
      <div className="card-body">{safeFirm(o).length===0?<div className="empty">No firm date requests</div>:
        <table><thead><tr><th>Item</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {safeFirm(o).map((fd,i)=>{const itemOpts=safeItems(o).map(it=>`${it.sku} - ${it.name}`);
          return<tr key={i}>
          <td><select className="form-select" value={fd.item_desc} onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}>
            <option value="">Select item...</option>{itemOpts.map(opt=><option key={opt}>{opt}</option>)}<option value="__custom">Other (type below)</option></select>
            {fd.item_desc==='__custom'&&<input className="form-input" style={{marginTop:4,fontSize:12}} placeholder="Custom description..." onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],item_desc:e.target.value};sv('firm_dates',fds)}}/>}</td>
          <td><input className="form-input" type="date" value={fd.date||''} onChange={e=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],date:e.target.value};sv('firm_dates',fds)}}/></td>
          <td>{fd.approved?<span className="badge badge-green">Approved</span>:<span className="badge badge-amber">Pending</span>}</td>
          <td><div style={{display:'flex',gap:4}}>{!fd.approved&&<button className="btn btn-sm btn-primary" onClick={()=>{const fds=[...safeFirm(o)];fds[i]={...fds[i],approved:true};sv('firm_dates',fds);nf('Approved')}}>✓</button>}
            <button className="btn btn-sm btn-secondary" onClick={()=>sv('firm_dates',safeFirm(o).filter((_,x)=>x!==i))}><Icon name="trash" size={10}/></button></div></td></tr>})}</tbody></table>}</div></div>}

    {/* COSTS TAB — Expected vs Actual */}
    {isSO&&tab==='costs'&&(()=>{
        const costLines=[];
        safeItems(o).forEach((it,ii)=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          if(!qty)return;
          const expectedBlank=qty*safeNum(it.nsa_cost);
          const blankPOs=(it.po_lines||[]).filter(pl=>pl.po_type!=='outside_deco');
          const poBlankQty=blankPOs.reduce((a,pl)=>{
            return a+Object.entries(pl).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0)},0);
          // Include inventory picks in actual cost (already-owned stock still has cost basis)
          const pickQty=safePicks(it).reduce((a,pk)=>a+Object.entries(pk).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0),0);
          const accountedQty=poBlankQty+pickQty;
          const hasActual=blankPOs.length>0||pickQty>0;
          // Use actual billed cost from supplier bills when available, else fall back to qty*nsa_cost
          const billedCostFromPOs=blankPOs.reduce((a,pl)=>a+safeNum(pl._bill_cost||0),0);
          const actualBlank=billedCostFromPOs>0?billedCostFromPOs+(pickQty*safeNum(it.nsa_cost)):(hasActual?accountedQty*safeNum(it.nsa_cost):0);
          costLines.push({category:'Blanks',sku:it.sku,name:it.name,vendor:D_V.find(v=>v.id===it.vendor_id)?.name||it.brand||'—',
            qty,expected:expectedBlank,actual:actualBlank,poCount:blankPOs.length+(pickQty>0?1:0),
            poIds:blankPOs.map(p=>p.po_id).filter(Boolean).join(', '),
            allReceived:blankPOs.length>0&&blankPOs.every(p=>p.status==='received')});
          safeDecos(it).forEach(d=>{
            const dp=dP(d,qty,af,qty);
            const eqD=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);const expectedDeco=eqD*dp.cost;
            const matchingDPOs=(it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco');
            const actualDeco=matchingDPOs.reduce((a,pl)=>{
              const poQty=Object.entries(pl).filter(([k,v])=>typeof v==='number'&&!['unit_cost'].includes(k)&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0);
              return a+poQty*safeNum(pl.unit_cost)},0);
            const artF=af.find(a=>a.id===d.art_file_id);
            const isOutside=d.kind==='outside_deco'||matchingDPOs.length>0;
            if(dp.cost>0||actualDeco>0){
              costLines.push({category:isOutside?'Outside Deco':'In-House Deco',
                sku:it.sku,name:artF?.name||d.deco_type?.replace(/_/g,' ')||'Decoration',
                vendor:isOutside?(matchingDPOs[0]?.deco_vendor||d.vendor||'—'):'NSA In-House',
                qty,expected:expectedDeco,actual:isOutside?actualDeco:expectedDeco,
                poCount:matchingDPOs.length,poIds:matchingDPOs.map(p=>p.po_id).filter(Boolean).join(', '),
                allReceived:matchingDPOs.length>0&&matchingDPOs.every(p=>p.status==='received')});
            }
          });
        });
        if(costLines.length===0)return<div className="card"><div className="card-body"><div className="empty">No cost data — add items first</div></div></div>;
        const hasActuals=costLines.some(l=>l.poCount>0);
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
        // Totals computed AFTER shipping lines added
        const totalExpected=costLines.reduce((a,l)=>a+(l.isShippingSubtotal?0:l.expected),0)+quotedShip;
        const totalActual=costLines.reduce((a,l)=>a+(l.isShippingSubtotal?0:l.actual),0);
        const variance=totalActual-totalExpected;
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
                <td style={{textAlign:'right',fontWeight:700,color:diff>0?'#dc2626':diff<0?'#166534':'#94a3b8'}}>{l.isShippingDetail?'—':l.poCount>0||l.isShipping?(diff>0?'+':diff<0?'-':'')+'$'+Math.abs(diff).toFixed(2):'—'}</td>
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
      const items=safeItems(o).filter(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return sq>0||safeNum(it.est_qty)>0});
      const _pAQ={};items.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2}})});
      const isRolled=(o.pricing_mode||'itemized')==='rolled_up';const taxRate=o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0);
      const rows=[];let subTotal=0;
      items.forEach(it=>{
        const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);
        const decos=safeDecos(it);const decoSell=decos.reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);return a+dp2.sell},0);
        const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+' '+sz).join(', ');
        const unitPrice=isRolled?safeNum(it.unit_sell)+decoSell:safeNum(it.unit_sell);const lineAmt=qty*unitPrice;subTotal+=lineAmt;
        let itemDesc='<strong>'+(it.sku||'')+'</strong><br/>'+(it.name||'')+(it.color?' - '+it.color:'');
        if(szStr)itemDesc+='<br/><span style="font-size:10px;color:#555">'+szStr+'</span>';
        rows.push({cells:[{value:qty,style:'text-align:center'},{value:itemDesc},{value:'',style:'text-align:center'},{value:taxRate>0?'Yes':'No',style:'text-align:center'},{value:'$'+unitPrice.toFixed(2),style:'text-align:right'},{value:'$'+lineAmt.toFixed(2),style:'text-align:right;font-weight:600'}]});
        if(!isRolled){decos.forEach(d=>{
          const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);const artF=af.find(a2=>a2.id===d.art_file_id);
          const decoLabel=(d.kind==='art'?(artF?.deco_type||d.art_tbd_type||'decoration'):d.kind==='numbers'?'Numbers ('+(d.num_method||'heat transfer').replace(/_/g,' ')+' '+(d.front_and_back?'F:'+(d.num_size||'4"')+' B:'+(d.num_size_back||d.num_size||'4"'):(d.num_size||'4"'))+(d.print_color?' — '+d.print_color:'')+')'+(d.front_and_back?' F+B':''):d.kind==='names'?'Names'+(d.print_color?' ('+d.print_color+')':''):d.kind==='outside_deco'?(d.deco_type||'Decoration'):'Decoration').replace(/_/g,' ');
          const posLabel=d.position?' — '+d.position:'';const decoAmt=qty*dp2.sell;subTotal+=decoAmt;
          rows.push({cells:[{value:qty,style:'text-align:center;color:#888;font-size:11px'},{value:'<span style="padding-left:20px;color:#666;font-size:11px">'+decoLabel+posLabel+'</span>'},{value:'',style:'text-align:center'},{value:'',style:'text-align:center'},{value:'$'+dp2.sell.toFixed(2),style:'text-align:right;color:#888;font-size:11px'},{value:'$'+decoAmt.toFixed(2),style:'text-align:right;color:#888;font-size:11px'}]});
        })}
      });
      const shipAmt=o.shipping_type==='pct'?subTotal*(o.shipping_value||0)/100:(o.shipping_value||0);
      const _ec=o.credit_applied?safeNum(o.credit_amount):0;const _ecSub=Math.min(_ec,subTotal);const _ecRed=Math.max(0,subTotal-_ecSub);
      const taxAmt=_ec>0?_ecRed*taxRate:subTotal*taxRate;const _ecApp=Math.min(_ec,subTotal+shipAmt+taxAmt);
      const total=subTotal+shipAmt+taxAmt-_ecApp;
      if(shipAmt>0)rows.push({cells:[{value:1,style:'text-align:center'},{value:'<strong>Shipping</strong><br/><span style="font-size:10px;color:#555">Shipping</span>'},{value:'',style:'text-align:center'},{value:'No',style:'text-align:center'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'},{value:'$'+shipAmt.toFixed(2),style:'text-align:right'}]});
      const billAddr=cust?.shipping_address_line1?cust.shipping_address_line1+(cust.shipping_city?'<br/>'+cust.shipping_city+(cust.shipping_state?' '+cust.shipping_state:'')+(cust.shipping_zip?' '+cust.shipping_zip:''):'')+'<br/>United States':(cust?.billing_address_line1?cust.billing_address_line1+(cust.billing_city?'<br/>'+cust.billing_city+(cust.billing_state?' '+cust.billing_state:'')+(cust.billing_zip?' '+cust.billing_zip:''):'')+'<br/>United States':'');
      return buildDocHtml({title:cust?.name||'Customer',docNum:o.id,docType:isE?'ESTIMATE':'SALES ORDER',
        headerRight:'<div class="ta">$'+total.toFixed(2)+'</div>'+(isE?'<div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>':''),
        infoBoxes:[{label:'Bill To',value:cust?.name||'—',sub:(cust?.alpha_tag?cust.alpha_tag+'<br/>':'')+(billAddr||'')},{label:isE?'Expires':'Expected',value:isE?new Date(Date.now()+30*86400000).toLocaleDateString():(o.expected_date||'TBD')},{label:'Exp. Close',value:new Date().toLocaleDateString()},{label:'Sales Rep',value:REPS.find(r=>r.id===o.created_by)?.name||'—'},{label:isE?'Estimate':'Sales Order',value:o.id},{label:'Memo',value:o.memo||'—'}],
        tables:[{headers:['Quantity','Item','Options','Tax','Rate','Amount'],aligns:['center','left','center','center','right','right'],rows:[...rows,
          {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>$'+subTotal.toFixed(2)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
          ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(taxRate*100).toFixed(3)+'%)</strong>',style:'text-align:right;border:none'},{value:'$'+taxAmt.toFixed(2),style:'text-align:right;border:none'}]}]:[]),
          ...(_ecApp>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-$'+_ecApp.toFixed(2)+'</strong>',style:'text-align:right;border:none'}]}]:[]),
          {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">$'+total.toFixed(2)+'</strong>',style:'text-align:right'}]}]}],
        footer:isE?'This estimate is valid for 30 days. Prices subject to change. '+_ci.depositTerms:_ci.terms});
    }} repUser={cu} defaultFollowUpDays={portalSettings?.estFollowUpDays||portalSettings?.followUpDays||7} onSend={({followUpDays:fuDays,toEmails:_toEmails,messageId:_msgId}={})=>{
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
          <label className="form-label">Note to GM (Gayle)</label>
          <textarea className="form-input" rows={3} value={firmReqNote} onChange={e=>setFirmReqNote(e.target.value)} placeholder="e.g., Coach needs by this date for first game, already confirmed with Adidas they can ship by 3/5..."/>
        </div>
        <div style={{padding:10,background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:6,fontSize:11,color:'#6d28d9'}}>
          <strong>Preview message to Gayle Peterson (GM):</strong>
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

    {/* CREATE INVOICE MODAL */}
    {showInvCreate&&(()=>{
      const items=safeItems(o);
      const isPromoOrder=o.promo_applied;
      // Compute per-item totals — for promo orders, only non-promo items are invoiceable
      const itemTotals=items.map(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const rev=qty*safeNum(it.unit_sell);
        let decoRev=0;safeDecos(it).forEach(d=>{const dp2=dP(d,qty,safeArt(o),qty);decoRev+=qty*dp2.sell});
        // Promo items are covered by promo funds — $0 on invoice
        if(isPromoOrder&&it.is_promo)return{qty,rev:0,decoRev:0,total:0,isPromo:true};
        // Partially promo items: use _promo_credit to reduce
        const promoCredit=isPromoOrder?safeNum(it._promo_credit):0;
        return{qty,rev,decoRev,total:Math.max(0,rev+decoRev-promoCredit),isPromo:false}});

      // For deposit: use full order total * pct
      // For partial: use selected items total
      // For final: use full order total
      const activeItems=invType==='partial'?invSelItems:items.map((_,i)=>i);
      const selTotals=activeItems.reduce((acc,idx)=>{const t=itemTotals[idx];if(!t)return acc;return{items:acc.items+1,units:acc.units+t.qty,subtotal:acc.subtotal+t.total}},{items:0,units:0,subtotal:0});
      // Prorate shipping & tax based on fraction of order being invoiced
      const orderSubtotal=itemTotals.reduce((a,t)=>a+t.total,0)||1;
      const selFraction=selTotals.subtotal/orderSubtotal;
      // For promo orders: shipping/tax on promo portion is covered by promo, only charge for non-promo portion
      const nonPromoShip=isPromoOrder?(promoTotals?totals.ship-promoTotals.promoShip:0):totals.ship;
      const nonPromoTax=isPromoOrder?0:totals.tax;
      const invShip=activeItems.length===items.length?nonPromoShip:Math.round(nonPromoShip*selFraction*100)/100;
      let invTax=activeItems.length===items.length?nonPromoTax:Math.round(nonPromoTax*selFraction*100)/100;
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
      const fullTotal=selTotals.subtotal+invShip+invTax-invCredit;
      const invTotal=invType==='deposit'?Math.round(fullTotal*invDepositPct/100*100)/100:fullTotal;

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
              {[['deposit','Deposit','Percentage of full order total'],['partial','Partial','Invoice selected items only'],['final','Final','Full order — closes SO']].map(([v,l,desc])=>
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
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems(items.map((_,i)=>i))}>Select All</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>setInvSelItems([])}>Clear</button>
            </div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
              {items.map((it,idx)=>{
                const sel=invSelItems.includes(idx);const t=itemTotals[idx];
                return<div key={idx} style={{padding:'10px 14px',borderBottom:idx<items.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10,cursor:'pointer',background:sel?'#eff6ff':'white'}} onClick={()=>setInvSelItems(sel?invSelItems.filter(i=>i!==idx):[...invSelItems,idx])}>
                  <input type="checkbox" checked={sel} readOnly style={{accentColor:'#2563eb',width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}><span style={{fontFamily:'monospace',color:'#1e40af'}}>{it.sku||'—'}</span> {safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{safeStr(it.color)||'—'} · {t.qty} units · ${safeNum(it.unit_sell).toFixed(2)}/ea{t.decoRev>0?' + $'+t.decoRev.toFixed(2)+' deco':''}</div>
                  </div>
                  <div style={{fontWeight:700,fontSize:13,color:sel?'#1e40af':'#94a3b8'}}>${t.total.toFixed(2)}</div>
                </div>})}
            </div>
          </div>}

          {/* Final: warning about closing SO */}
          {invType==='final'&&<div style={{marginBottom:12,padding:12,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8}}>
            <div style={{fontWeight:700,color:'#dc2626',fontSize:13,marginBottom:4}}>Final Invoice</div>
            <div style={{fontSize:12,color:'#991b1b'}}>This will invoice the full order amount and mark <strong>{o.id}</strong> as <strong>Complete</strong>.</div>
            {soInvTotal>0&&<div style={{fontSize:11,color:'#b91c1c',marginTop:4,padding:'4px 8px',background:'#fee2e2',borderRadius:4}}>Note: ${soInvTotal.toLocaleString()} already invoiced on this SO. This final invoice will be for the full remaining order value.</div>}
          </div>}

          {/* Memo */}
          <div style={{marginBottom:12}}>
            <label className="form-label">Invoice Memo</label>
            <input className="form-input" value={invMemo} onChange={e=>setInvMemo(e.target.value)} placeholder={invType==='deposit'?'e.g., '+invDepositPct+'% Deposit — '+o.memo:invType==='partial'?'e.g., Partial — Hats only':'e.g., Final Invoice — '+o.memo}/>
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
              <span style={{fontSize:12,color:'#64748b'}}>{invType==='deposit'?'Full order':'Selected items'}</span>
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
          <button className="btn btn-primary" style={{background:'#dc2626',borderColor:'#dc2626'}} disabled={invType==='partial'&&invSelItems.length===0} onClick={()=>{
            const invId=nextInvId(allInvoices);
            const invDate=new Date().toLocaleDateString('en-CA');
            const termDays=parseInt((cust?.payment_terms||'net30').replace(/\D/g,''))||30;
            const due=new Date();due.setDate(due.getDate()+termDays);const dueDate=due.toLocaleDateString('en-CA');
            const lineItems=activeItems.map(idx=>{const it=items[idx];if(!it)return null;const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
              const decoSell=safeDecos(it).reduce((a,d)=>{const cq=d.kind==='art'&&d.art_file_id?artQty[d.art_file_id]:qty;const dp2=dP(d,qty,safeArt(o),cq);return a+dp2.sell},0);
              const lineAmt=qty*(safeNum(it.unit_sell)+decoSell);
              return{desc:it.sku+' '+it.name+(it.color?' — '+it.color:''),qty,rate:safeNum(it.unit_sell)+decoSell,amount:invType==='deposit'?Math.round(lineAmt*invDepositPct/100*100)/100:lineAmt}}).filter(Boolean);
            const invShipAmt=invType==='deposit'?Math.round(invShip*invDepositPct/100*100)/100:invShip;
            const invTaxAmt=invType==='deposit'?Math.round(invTax*invDepositPct/100*100)/100:invTax;
            const defaultMemo=invType==='deposit'?invDepositPct+'% Deposit — '+o.memo:invType==='partial'?'Partial — '+o.memo:'Final Invoice — '+o.memo;
            const billingOverride=invBilling?JSON.parse(invBilling):null;
            const inv={id:invId,type:'invoice',inv_type:invType,customer_id:o.customer_id,so_id:o.id,
              date:invDate,due_date:dueDate,total:Math.round(invTotal*100)/100,paid:0,
              memo:invMemo||defaultMemo,status:'open',_rep:o.created_by||cu.id,
              tax:Math.round(invTaxAmt*100)/100,tax_rate:o.tax_exempt?0:(o.tax_rate||cust?.tax_rate||0),tax_exempt:o.tax_exempt||cust?.tax_exempt||false,shipping:Math.round(invShipAmt*100)/100,
              ...(invType==='deposit'?{deposit_pct:invDepositPct}:{}),
              ...(billingOverride?{billing_name:billingOverride.label||'',billing_address:[billingOverride.street,billingOverride.city,billingOverride.state,billingOverride.zip].filter(Boolean).join(', ')}:{}),
              ...(o.po_number?{_po_number:o.po_number}:{}),
              ...(invCredit>0?{credit_amount:Math.round((invType==='deposit'?invCredit*invDepositPct/100:invCredit)*100)/100}:{}),
              line_items:lineItems,
              items:activeItems.map(idx=>{const it=items[idx];return{sku:it.sku,name:it.name,qty:Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0),unit_sell:safeNum(it.unit_sell)}})};
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
            setInvSmsPhone(contact?.phone||'');setInvSmsEnabled(!!contact?.phone);setInvFollowUpDays(portalSettings?.invFollowUpDays||7);
            setInvSmsMsg('Hi '+(contact?.name||'Coach')+', your invoice '+inv.id+' for $'+invTotal.toFixed(2)+' is ready. Due by '+dueDate+'. View: https://nsa-portal.netlify.app/?portal='+(cust?.alpha_tag||''));
          }}>{isPromoOrder&&invTotal===0?(invType==='final'?'Close Promo Order — $0 Invoice':'Create $0 Promo Invoice'):(invType==='final'?'Create Final Invoice — Close SO':'Create '+invType.charAt(0).toUpperCase()+invType.slice(1)+' Invoice')} — ${invTotal.toFixed(2)}</button>
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
      const printInvoice=()=>{
        const rBillName=ir.billing_name||ic?.name||'—';const rBillSub=ir.billing_name?(ir.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':(ic?.alpha_tag||'');
        const rPoNum=ir._po_number||irSO?.po_number;
        printDoc({title:rBillName,docNum:ir.id,docType:'INVOICE',
          headerRight:'<div class="ta">$'+ir.total.toLocaleString()+'</div>'
            +'<div class="ts">Balance Due: <strong>$'+bal.toLocaleString()+'</strong></div>'+(rPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+rPoNum+'</div>':''),
          infoBoxes:[
            {label:'Bill To',value:rBillName,sub:rBillSub},
            {label:'Invoice Date',value:ir.date||new Date().toLocaleDateString(),sub:ir.due_date?'Due: '+ir.due_date:''},
            {label:'Sales Order',value:ir.so_id||'—',sub:ir.memo||''+(rPoNum?'<br/><strong>PO# '+rPoNum+'</strong>':'')},
            {label:'Payment Terms',value:ir.inv_type==='deposit'?(ir.deposit_pct||50)+'% Deposit':ir.inv_type==='partial'?'Partial Invoice':'Final Invoice',sub:''}
          ],
          tables:[{headers:['Description','Qty','Rate','Amount'],aligns:['left','center','right','right'],
            rows:[
              ...lineItems.map(li=>({cells:[li.desc,li.qty,'$'+safeNum(li.rate).toFixed(2),'$'+safeNum(li.amount).toFixed(2)]})),
              ...(shipAmt>0?[{cells:[{value:'Shipping',style:'font-style:italic'},'','','$'+shipAmt.toFixed(2)]}]:[]),
              ...(taxAmt>0?[{cells:[{value:'Tax',style:'font-style:italic'},'','','$'+taxAmt.toFixed(2)]}]:[]),
              ...(safeNum(ir.credit_amount)>0?[{cells:[{value:'Credit Applied',style:'font-style:italic;color:#065f46'},'','',{value:'-$'+safeNum(ir.credit_amount).toFixed(2),style:'color:#065f46'}]}]:[]),
              {_class:'totals-row',cells:['','','Total','$'+ir.total.toLocaleString()]}
            ]}],
          footer:ir.inv_type==='deposit'?_ci.depositTerms:_ci.terms});
      };
      return<div className="modal-overlay" onClick={()=>setInvReview(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:700,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header" style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white'}}>
          <h2 style={{color:'white'}}>Invoice Created — {ir.id}</h2>
          <button className="modal-close" style={{color:'white'}} onClick={()=>setInvReview(null)}>x</button>
        </div>
        <div className="modal-body" style={{padding:0}}>
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
          <button className="btn btn-secondary" onClick={()=>{setInvReview(null);if(onNavInvoice)onNavInvoice(ir)}}>Go to Invoices</button>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={printInvoice}>🖨️ Print Invoice</button>
            <button className="btn btn-primary" style={{background:'#2563eb'}} onClick={()=>{setInvSendTo('');setInvSendCustomEmail('');setInvSendModal(true)}}>📧 Send to Coach</button>
          </div>
        </div>
      </div></div>
    })()}

    {/* ═══ SEND TO COACH MODAL ═══ */}
    {invSendModal&&invReview&&(()=>{
      const ir=invReview;const ic=ir._customer||cust;
      const contacts=(ic?.contacts||[]).filter(c=>c.email);
      const resolvedEmail=invSendTo==='__custom__'?invSendCustomEmail:invSendTo||(contacts[0]?.email||'');
      const resolvedName=invSendTo==='__custom__'?invSendCustomEmail:(contacts.find(c=>c.email===invSendTo)||contacts[0])?.name||'Coach';
      return<div className="modal-overlay" style={{zIndex:10001}} onClick={()=>setInvSendModal(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Send Invoice to Coach</h2><button className="modal-close" onClick={()=>setInvSendModal(false)}>x</button></div>
        <div className="modal-body">
          <div style={{marginBottom:12}}>
            <label className="form-label">Sending to</label>
            <select className="form-input" value={invSendTo||contacts[0]?.email||''} onChange={e=>{setInvSendTo(e.target.value);if(e.target.value!=='__custom__')setInvSendCustomEmail('')}} style={{fontSize:13,marginBottom:invSendTo==='__custom__'?8:0}}>
              {contacts.map(c=><option key={c.email} value={c.email}>{c.name||'Contact'} — {c.email}{c.role?' ('+c.role+')':''}</option>)}
              {contacts.length===0&&<option value="" disabled>No contacts with email on file</option>}
              <option value="__custom__">Enter a different email...</option>
            </select>
            {invSendTo==='__custom__'&&<input className="form-input" type="email" placeholder="Enter email address" value={invSendCustomEmail} onChange={e=>setInvSendCustomEmail(e.target.value)} style={{fontSize:13}}/>}
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
          {/* SMS Toggle */}
          <div style={{marginBottom:12,padding:12,background:invSmsEnabled?'#f0fdf4':'#f8fafc',border:'1px solid '+(invSmsEnabled?'#86efac':'#e2e8f0'),borderRadius:8}}>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:invSmsEnabled?10:0}}>
              <input type="checkbox" checked={invSmsEnabled} onChange={e=>setInvSmsEnabled(e.target.checked)} style={{width:16,height:16,accentColor:'#22c55e'}}/>
              <span style={{fontWeight:700,fontSize:13,color:invSmsEnabled?'#166534':'#64748b'}}>Also Text Coach</span>
              {_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600}}>Sends directly</span>}
            </label>
            {invSmsEnabled&&<div>
              <div style={{marginBottom:8}}><label className="form-label" style={{fontSize:11}}>Phone</label><input className="form-input" value={invSmsPhone} onChange={e=>setInvSmsPhone(e.target.value)} placeholder="Phone number" style={{fontSize:12}}/></div>
              <div><label className="form-label" style={{fontSize:11}}>Text Message <span style={{color:'#94a3b8',fontWeight:400}}>({invSmsMsg.length}/160)</span></label><textarea className="form-input" rows={2} value={invSmsMsg} onChange={e=>setInvSmsMsg(e.target.value)} maxLength={160} style={{fontSize:12,resize:'vertical'}}/></div>
            </div>}
          </div>
          {/* Follow-up reminder */}
          <div style={{padding:10,background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>Follow up in</span>
            <select className="form-input" value={invFollowUpDays} onChange={e=>setInvFollowUpDays(parseInt(e.target.value))} style={{width:70,fontSize:12,padding:'4px 6px'}}>
              {[1,2,3,5,7,10,14,21,30].map(d=><option key={d} value={d}>{d}</option>)}
            </select>
            <span style={{fontSize:12,color:'#6d28d9'}}>days if no response</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setInvSendModal(false)}>Cancel</button>
          <button className="btn btn-primary" style={{background:'#2563eb'}} disabled={!resolvedEmail} onClick={async()=>{
            setInvSendModal(false);
            const toEmail=resolvedEmail;
            const toName=resolvedName;
            // Build PDF attachment
            const irBillName=ir.billing_name||ic?.name||'—';const irBal=ir.total-(ir.paid||0);
            const irPoNum=ir._po_number||irSO?.po_number;
            const brevoAttachments=[];
            try{
              const docHtml=buildDocHtml({title:irBillName,docNum:ir.id,docType:'INVOICE',
                headerRight:'<div class="ta">$'+ir.total.toLocaleString()+'</div><div class="ts">Balance Due: <strong>$'+irBal.toLocaleString()+'</strong></div>'+(irPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+irPoNum+'</div>':''),
                infoBoxes:[{label:'Bill To',value:irBillName},{label:'Invoice Date',value:ir.date||'—',sub:ir.due_date?'Due: '+ir.due_date:''},{label:'Sales Order',value:ir.so_id||'—',sub:ir.memo||''},{label:'Payment Terms',value:ir.inv_type==='deposit'?(ir.deposit_pct||50)+'% Deposit':'Final Invoice',sub:''}],
                tables:[{headers:['Description','Qty','Rate','Amount'],aligns:['left','center','right','right'],rows:[
                  ...lineItems.map(li=>({cells:[li.desc,li.qty,'$'+safeNum(li.rate).toFixed(2),'$'+safeNum(li.amount).toFixed(2)]})),
                  ...(shipAmt>0?[{cells:[{value:'Shipping',style:'font-style:italic'},'','','$'+shipAmt.toFixed(2)]}]:[]),
                  ...(taxAmt>0?[{cells:[{value:'Tax',style:'font-style:italic'},'','','$'+taxAmt.toFixed(2)]}]:[]),
                  ...(safeNum(ir.credit_amount)>0?[{cells:[{value:'Credit Applied',style:'font-style:italic;color:#065f46'},'','',{value:'-$'+safeNum(ir.credit_amount).toFixed(2),style:'color:#065f46'}]}]:[]),
                  {_class:'totals-row',cells:['','','Total','$'+ir.total.toLocaleString()]},
                  ...(ir.paid>0?[{cells:['','',{value:'Paid',style:'color:#166534'},'$'+ir.paid.toLocaleString()]}]:[]),
                  ...(irBal>0?[{_style:'background:#fef2f2',cells:['','',{value:'<strong>Balance Due</strong>',style:'color:#dc2626'},'<strong style="color:#dc2626;font-size:14px">$'+irBal.toLocaleString()+'</strong>']}]:[])
                ]}],footer:ir.inv_type==='deposit'?_ci.depositTerms:_ci.terms});
              const styleMatch=docHtml.match(/<style>([\s\S]*?)<\/style>/);const bodyMatch=docHtml.match(/<body>([\s\S]*?)<\/body>/);
              const pdfFixCss='.header{display:table!important;width:100%!important;table-layout:fixed}.header>*{display:table-cell!important;vertical-align:top!important}.logo{width:55%!important}.logo img{height:50px;vertical-align:middle;margin-right:8px;float:left}.doc-id{width:45%!important;text-align:right!important}.bill-total{display:table!important;width:100%!important;table-layout:fixed}.bill-total>*{display:table-cell!important;vertical-align:top!important}.total-box{width:200px!important;text-align:left!important}.info-row{display:table!important;width:100%!important;table-layout:fixed}.info-cell{display:table-cell!important;vertical-align:top!important}.footer{display:table!important;width:100%!important}.footer>*{display:table-cell!important}.footer>*:last-child{text-align:right!important}';
              const container=document.createElement('div');container.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:white;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4';
              const styleEl=document.createElement('style');styleEl.textContent=(styleMatch?styleMatch[1]:'')+pdfFixCss;container.appendChild(styleEl);
              const bodyDiv=document.createElement('div');bodyDiv.innerHTML=bodyMatch?bodyMatch[1]:docHtml;container.appendChild(bodyDiv);
              document.body.appendChild(container);await new Promise(r=>setTimeout(r,500));
              const pdfBlob=await html2pdf().set({margin:[0.4,0.4,0.4,0.4],filename:ir.id+'.pdf',image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:'letter',orientation:'portrait'}}).from(bodyDiv).outputPdf('blob');
              document.body.removeChild(container);
              const pdfB64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(pdfBlob)});
              brevoAttachments.push({name:ir.id+'.pdf',content:pdfB64});
            }catch(err){console.warn('Failed to build invoice PDF:',err)}
            // Build email with portal link
            const portalUrl=ic?.alpha_tag?'https://nsa-portal.netlify.app/?portal='+ic.alpha_tag:'';
            const emailHtml='<div style="font-family:sans-serif;font-size:14px;line-height:1.6">'+invSendMsg.replace(/\n/g,'<br>')
              +(portalUrl?'<br/><br/><a href="'+portalUrl+'" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:600">View Invoice in Portal</a>':'')
              +'</div>';
            const res=await sendBrevoEmail({
              to:[{email:toEmail,name:toName}],
              subject:'Invoice '+ir.id+' — $'+ir.total.toFixed(2)+' from National Sports Apparel',
              htmlContent:emailHtml,
              senderName:cu.name||'National Sports Apparel',
              senderEmail:'noreply@nationalsportsapparel.com',
              replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined,
              attachment:brevoAttachments.length>0?brevoAttachments:undefined
            });
            if(res.ok){
              nf('Invoice '+ir.id+' sent to '+toEmail);
            }else{
              nf('Failed to send invoice: '+(res.error||'Unknown error'),'error');
            }
            // Send SMS if enabled
            if(invSmsEnabled&&invSmsPhone&&_brevoKey){
              const smsRes=await sendBrevoSms({to:invSmsPhone,content:invSmsMsg.substring(0,160)});
              if(smsRes.ok){nf('Text sent to '+invSmsPhone)}else{nf('SMS failed: '+(smsRes.error||'Unknown'),'error')}
            }
            // Update invoice email status with follow-up and history
            const invNow=new Date().toLocaleString();const invFuAt=invFollowUpDays?new Date(Date.now()+invFollowUpDays*86400000).toISOString():null;
            const invHist={sent_at:invNow,sent_by:cu.name||cu.id,to:toEmail,type:'invoice',methods:['email',...(invSmsEnabled?['sms']:[])],messageId:res.messageId||null};
            onInv(prev=>prev.map(i=>i.id===ir.id?{...i,email_status:'sent',email_sent_at:invNow,follow_up_at:invFuAt,sent_history:[...(i.sent_history||[]),invHist]}:i));
            // Also post to messages
            const soMsg={id:'m'+Date.now(),so_id:ir.so_id,author_id:cu.id,text:'[Invoice '+ir.id+'] Sent to '+toName+' ('+toEmail+')'+(invSmsEnabled&&invSmsPhone?' + SMS to '+invSmsPhone:'')+'\n\n'+invSendMsg,ts:new Date().toLocaleString(),read_by:[cu.id],dept:'sales',tagged_members:[],entity_type:'so',entity_id:ir.so_id};
            if(onMsg)onMsg(prev=>[...prev,soMsg]);
          }}>📧 Send Invoice{resolvedEmail?'':' (No email)'}</button>
        </div>
      </div></div>
    })()}

    {showPO&&(()=>{
      // Vendor selection or PO form
      const resolveVendor=it=>it.vendor_id||D_V.find(v=>v.name===it.brand)?.id||(it.product_id&&products.find(p=>p.id===it.product_id)?.vendor_id)||null;
      const vendorMap={};safeItems(o).forEach((it,i)=>{const vk=resolveVendor(it);if(!vk)return;if(!vendorMap[vk])vendorMap[vk]=[];vendorMap[vk].push({...it,_idx:i})});
      const unlinkedItems=safeItems(o).filter(it=>{const vk=resolveVendor(it);return!vk&&Object.values(safeSizes(it)).some(v=>safeNum(v)>0)});
      if(showPO==='select')return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>Create PO — Select Vendor</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">{Object.entries(vendorMap).map(([vk,items])=>{const vn=D_V.find(v=>v.id===vk)?.name||vk;
          const openCount=items.reduce((tot,it)=>{return tot+Object.entries(it.sizes).filter(([,v])=>v>0).reduce((a,[sz,v])=>{const picked=safePicks(it).reduce((a2,pk)=>a2+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);return a+Math.max(0,v-picked-po)},0)},0);
          if(openCount===0)return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,opacity:0.5,display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:8,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="check" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#166534'}}>All items fully covered</div></div></div>;
          return<div key={vk} style={{padding:'12px 16px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,cursor:'pointer',display:'flex',alignItems:'center',gap:12}} onClick={()=>{setShowPO(vk);setPOExcluded({})}}>
            <div style={{width:40,height:40,borderRadius:8,background:'#ede9fe',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="package" size={20}/></div>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{vn}</div><div style={{fontSize:12,color:'#64748b'}}>{items.length} item(s) — <span style={{color:'#dc2626',fontWeight:600}}>{openCount} units open</span></div></div>
            <Icon name="back" size={16} style={{transform:'rotate(180deg)'}}/></div>})}
          {unlinkedItems.length>0&&<div style={{borderTop:'2px solid #fca5a5',marginTop:8,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',marginBottom:6}}>⚠️ Items Without Vendor — Cannot Order</div>
            {unlinkedItems.map((it,i)=><div key={i} style={{padding:'8px 12px',border:'1px solid #fca5a5',borderRadius:8,marginBottom:4,background:'#fef2f2'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>{it.sku||'No SKU'} — {it.name||'Unnamed'}</div>
              <div style={{fontSize:10,color:'#92400e'}}>Assign a vendor/brand to this item before creating a PO</div>
            </div>)}
          </div>}}
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
        </div></div></div>;
      // OUTSIDE DECORATION PO FORM
      if(typeof showPO==='string'&&showPO.startsWith('deco:')){
        const decoVendor=showPO.replace('deco:','');
        const allItems=safeItems(o).map((it,i)=>({...it,_idx:i})).filter(it=>{
          const q=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return q>0});
        const poId='DPO-'+poCounter+(cust?.alpha_tag?'-'+cust.alpha_tag:'');
        const dv=decoVendors.find(v=>v.name===decoVendor);
        return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
          <div className="modal-header"><h2 style={{color:'#7c3aed'}}>🎨 Deco PO — {decoVendor}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#faf5ff',border:'1px solid #ddd6fe',borderRadius:8,marginBottom:12,fontSize:12,color:'#6d28d9'}}>
              Sending items to <strong>{decoVendor}</strong> for outside decoration. PO #{poId} will be saved to this SO for cost tracking and commission calculation.
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
              <div><label className="form-label">PO Number</label><input className="form-input" value={poId} readOnly style={{color:'#7c3aed',fontWeight:700}}/></div>
              <div><label className="form-label">Deco Type</label><select className="form-select" id={'dpo-type-'+poId} onChange={e=>{
                if(!dv)return;const dt=e.target.value;allItems.forEach((_,vi)=>{const soQ=Object.values(safeSizes(allItems[vi])).reduce((a,v)=>a+safeNum(v),0);const cost=_decoVendorPrice(decoVendorPricing,dv.id,dt,{qty:soQ});const el=document.getElementById('dpo-cost-'+vi);if(el&&cost!==null)el.value=cost.toFixed(2)});
              }}>
                <option value="embroidery">Embroidery</option><option value="screen_print">Screen Print</option><option value="dtf">DTF</option><option value="heat_transfer">Heat Transfer</option><option value="sublimation">Sublimation</option></select></div>
              <div><label className="form-label">Expected Return</label><input className="form-input" type="date" id={'dpo-date-'+poId}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" id={'dpo-dropship-'+poId}/><span style={{fontWeight:600,color:'#7c3aed'}}>📦 Drop Ship</span><span style={{fontSize:11,color:'#64748b'}}>— Ships direct to school, skip warehouse receive</span></label></div>
            {allItems.map((it,vi)=>{const szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])===-1?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])===-1?99:SZ_ORD.indexOf(b[0])));
              const soQ=szList.reduce((a,[,v])=>a+v,0);
              const prefilledCost=dv?_decoVendorPrice(decoVendorPricing,dv.id,'embroidery',{qty:soQ}):null;
              return<div key={vi} style={{padding:12,border:'1px solid #ede9fe',borderRadius:6,marginBottom:8,background:'#faf5ff'}}>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
                  <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',flex:1}}>
                    <input type="checkbox" id={'dpo-sel-'+vi} defaultChecked style={{width:16,height:16}}/>
                    <span style={{fontFamily:'monospace',fontWeight:800,color:'#7c3aed'}}>{it.sku}</span>
                    <strong>{it.name}</strong><span style={{color:'#64748b'}}>— {it.color}</span>
                  </label>
                  <span style={{fontWeight:700}}>SO Qty: {soQ}</span>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Send Qty:</span>
                  {szList.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                    <input id={'dpo-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #ddd6fe',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}
                  <div style={{borderLeft:'2px solid #ede9fe',paddingLeft:8,marginLeft:4}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#64748b'}}>Unit Cost{prefilledCost!==null&&<span style={{color:'#7c3aed',marginLeft:4}}>(auto)</span>}</div>
                    <input id={'dpo-cost-'+vi} style={{width:60,textAlign:'center',border:'1px solid '+(prefilledCost!==null?'#7c3aed':'#ddd6fe'),borderRadius:4,padding:'4px 2px',fontSize:13,fontWeight:700}} defaultValue={prefilledCost!==null?prefilledCost.toFixed(2):'0.00'}/>
                  </div>
                </div>
              </div>})}
            <div style={{marginTop:8}}><label className="form-label">Notes / Instructions for Decorator</label><textarea className="form-input" rows={2} placeholder="Thread colors, PMS colors, placement notes..." id={'dpo-notes-'+poId} style={{resize:'vertical'}}/></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setShowPO('select')}>← Back</button>
            <button className="btn btn-secondary" onClick={()=>setShowPO(null)}>Cancel</button>
            <button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>{
              const updatedItems=o.items.map(it=>({...it,po_lines:[...(it.po_lines||[])]}));
              const decoType=document.getElementById('dpo-type-'+poId)?.value||'embroidery';
              const returnDate=document.getElementById('dpo-date-'+poId)?.value||'';
              const notes=document.getElementById('dpo-notes-'+poId)?.value||'';
              const isDropShip=document.getElementById('dpo-dropship-'+poId)?.checked||false;
              let totalQty=0,totalCost=0;
              allItems.forEach((it,vi)=>{
                const selected=document.getElementById('dpo-sel-'+vi)?.checked;
                if(!selected)return;
                const idx=it._idx;const poLine={po_id:poId,status:'waiting',po_type:'outside_deco',deco_vendor:decoVendor,deco_type:decoType,drop_ship:isDropShip||undefined,
                  expected_date:returnDate,created_at:new Date().toLocaleDateString(),memo:notes,received:{},shipments:[]};
                const szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0);
                const unitCost=parseFloat(document.getElementById('dpo-cost-'+vi)?.value)||0;
                let itemQty=0;
                szList.forEach(([sz])=>{
                  const el=document.getElementById('dpo-qty-'+vi+'-'+sz);
                  const qty=el?Math.max(0,parseInt(el.value)||0):0;
                  if(qty>0){poLine[sz]=qty;itemQty+=qty}
                });
                poLine.unit_cost=unitCost;
                if(itemQty>0){updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];totalQty+=itemQty;totalCost+=itemQty*unitCost}
              });
              if(totalQty===0){nf('No items selected or no quantities entered','error');return}
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);
              setPOCounter(c=>c+1);setShowPO(null);
              nf('🎨 '+poId+' sent to '+decoVendor+' — '+totalQty+' units ($'+totalCost.toFixed(2)+')');
            }}>🎨 Create Deco PO — Send to {decoVendor}</button>
          </div>
        </div></div>;
      }
      // PO form for selected vendor — only show sizes that still need ordering (subtract picks + existing POs)
      const vItems=vendorMap[showPO]||[];const vn=D_V.find(v=>v.id===showPO)?.name||showPO;
      const autoPoId='PO-'+poCounter+(cust?.alpha_tag?'-'+cust.alpha_tag:'');
      const poId=preexistingPO?preexistingPOId:autoPoId;
      const batchKey=Object.keys(BATCH_VENDORS).find(k=>vn.toLowerCase().includes(k)||showPO.toLowerCase().includes(k));
      const isBatchEligible=!!batchKey;
      const isAdidas=batchKey==='adidas';
      const batchConfig=batchKey?BATCH_VENDORS[batchKey]:null;
      const pendingBatches=(batchPOs||[]).filter(bp=>bp.vendor_key===batchKey);
      const pendingBatchTotal=pendingBatches.reduce((a,bp)=>a+bp.total_cost,0);
      const poItems=vItems.map(it=>{const szList=Object.entries(it.sizes).filter(([,v])=>v>0).sort((a,b)=>{const ord=['XS','S','M','L','XL','2XL','3XL','4XL'];return(ord.indexOf(a[0])===-1?99:ord.indexOf(a[0]))-(ord.indexOf(b[0])===-1?99:ord.indexOf(b[0]))});
        const openSizes=szList.map(([sz,v])=>{const picked=safePicks(it).reduce((a,pk)=>a+(pk[sz]||0),0);const po=poCommitted(it.po_lines,sz);const open=Math.max(0,v-picked-po);return[sz,open]}).filter(([,v])=>v>0);
        return{...it,openSizes,totalOpen:openSizes.reduce((a,[,v])=>a+v,0)}}).filter(it=>it.totalOpen>0);
      return<div className="modal-overlay" onClick={()=>setShowPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:800,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>New PO — {vn}</h2><button className="modal-close" onClick={()=>setShowPO(null)}>x</button></div>
        <div className="modal-body">
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
            <div><label className="form-label">PO Number</label>{preexistingPO?<input className="form-input" value={preexistingPOId} onChange={e=>setPreexistingPOId(e.target.value)} placeholder="e.g. PO2453 OLUF" style={{color:'#d97706',fontWeight:700,borderColor:'#f59e0b'}}/>:<input className="form-input" value={autoPoId} readOnly style={{color:'#1e40af',fontWeight:700}}/>}</div>
            <div><label className="form-label">Ship To</label><select className="form-select" defaultValue="warehouse"><option value="warehouse">NSA Warehouse — Emerson</option>{addrs.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
            <div><label className="form-label">Expected Date</label><input className="form-input" type="date" id={'po-date-'+(preexistingPO?'preexisting':autoPoId)}/></div></div>
          <div style={{marginBottom:12}}><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" id={'po-dropship-'+(preexistingPO?'preexisting':autoPoId)}/><span style={{fontWeight:600,color:'#7c3aed'}}>📦 Drop Ship</span><span style={{fontSize:11,color:'#64748b'}}>— Ships direct to school/decorator, skip warehouse receive</span></label></div>
          {poItems.map((it,vi)=>{const soQ=Object.values(it.sizes).reduce((a,v)=>a+v,0);const excluded=!!poExcluded[vi];
            return<div key={vi} style={{padding:12,border:'1px solid '+(excluded?'#f1f5f9':'#e2e8f0'),borderRadius:6,marginBottom:8,opacity:excluded?0.4:1,transition:'opacity 0.15s'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={!excluded} onChange={()=>setPOExcluded(x=>({...x,[vi]:!x[vi]}))} style={{marginTop:1}}/><span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',marginRight:4}}>{it.sku}</span><strong>{it.name}</strong> — {it.color}</div>
                <div style={{fontWeight:700}}>SO Qty: {soQ} <span style={{color:'#dc2626',fontSize:12,marginLeft:6}}>Open: {it.totalOpen}</span></div></div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>PO Qty:</span>
                {it.openSizes.map(([sz,v])=><div key={sz} style={{textAlign:'center'}}><div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-qty-'+vi+'-'+sz} style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={v}/></div>)}</div>
              <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Price/Unit:</span>
                <span style={{fontSize:12,color:'#94a3b8'}}>$</span>
                <input id={'po-price-'+vi} style={{width:80,border:'1px solid #d1d5db',borderRadius:4,padding:'4px 6px',fontSize:14,fontWeight:700}} defaultValue={safeNum(it.nsa_cost).toFixed(2)}/>
              </div>
            </div>})}
          <div style={{marginTop:8}}><label className="form-label">Notes</label><input className="form-input" placeholder="PO notes for vendor..." id={'po-notes-'+poId}/></div></>}
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>{setShowPO('select');setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({})}}>← Back</button><button className="btn btn-secondary" onClick={()=>{setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({})}}>Cancel</button>
          {poItems.length>0&&isBatchEligible&&!preexistingPO&&<button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} disabled={poItems.every((_,vi)=>poExcluded[vi])} onClick={()=>{
            // Build batch PO entry
            const batchItems=[];let totalCost=0;
            poItems.forEach((pit,vi)=>{
              if(poExcluded[vi])return;
              const sizes={};
              pit.openSizes.forEach(([sz,v])=>{const el=document.getElementById('po-qty-'+vi+'-'+sz);sizes[sz]=el?parseInt(el.value)||0:v});
              const qty=Object.values(sizes).reduce((a,v)=>a+v,0);
              const batchPriceEl=document.getElementById('po-price-'+vi);
              const batchUnitCost=batchPriceEl?parseFloat(batchPriceEl.value)||0:safeNum(pit.nsa_cost);
              totalCost+=qty*batchUnitCost;
              batchItems.push({sku:pit.sku,name:pit.name,color:pit.color,sizes,qty,unit_cost:batchUnitCost,item_idx:pit._idx});
            });
            const bp={id:'BPO-'+Date.now(),vendor_key:batchKey,vendor_name:batchConfig.name,so_id:o.id,so_memo:o.memo||'',customer:cust?.alpha_tag||cust?.name||'',
              items:batchItems,total_cost:totalCost,created_by:cu.id,created_by_name:cu.name,created_at:new Date().toLocaleString()};
            if(onBatchPO)onBatchPO(prev=>[...prev,bp]);
            setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});nf('Added to '+batchConfig.name+' batch queue ($'+totalCost.toFixed(2)+')');
          }}><Icon name="package" size={14}/> Add to Batch ({poItems.filter((_,vi)=>!poExcluded[vi]).length})</button>}
          {poItems.length>0&&(preexistingPO||!batchConfig?.batchOnly)&&<button className="btn btn-primary" style={preexistingPO?{background:'#d97706',borderColor:'#d97706'}:{}} disabled={poItems.every((_,vi)=>poExcluded[vi])} onClick={()=>{
          if(preexistingPO&&!preexistingPOId.trim()){nf('Please enter a PO number','error');return}
          const effectivePoId=preexistingPO?preexistingPOId.trim():autoPoId;
          const dropShipElId=preexistingPO?'po-dropship-preexisting':'po-dropship-'+autoPoId;
          // Save PO lines back to order items (immutable)
          const updatedItems=o.items.map(it=>({...it,pick_lines:[...(it.pick_lines||[])],po_lines:[...(it.po_lines||[])]}));
          poItems.forEach((pit,vi)=>{
            if(poExcluded[vi])return;
            const idx=pit._idx;if(idx==null)return;
            const isDropShip=document.getElementById(dropShipElId)?.checked||false;
            const priceEl=document.getElementById('po-price-'+vi);
            const unitCostVal=priceEl?parseFloat(priceEl.value)||0:safeNum(pit.nsa_cost);
            const poLine={po_id:effectivePoId,vendor:vn,status:preexistingPO?'ordered':'waiting',created_at:new Date().toLocaleDateString(),memo:preexistingPO?'Preexisting PO (NetSuite)':'',received:{},shipments:[],unit_cost:unitCostVal};
            if(preexistingPO)poLine.preexisting=true;
            if(isDropShip)poLine.drop_ship=true;
            pit.openSizes.forEach(([sz,v])=>{
              const el=document.getElementById('po-qty-'+vi+'-'+sz);
              poLine[sz]=el?parseInt(el.value)||0:v;
            });
            const hasQty=Object.entries(poLine).some(([k,v])=>k!=='po_id'&&k!=='status'&&typeof v==='number'&&v>0);
            if(hasQty){
              updatedItems[idx].po_lines=[...updatedItems[idx].po_lines,poLine];
            }
          });
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
          setO(updated);onSave(updated);
          if(!preexistingPO)setPOCounter(c=>c+1);
          const selCount=poItems.filter((_,vi)=>!poExcluded[vi]).length;
          setShowPO(null);setPreexistingPO(false);setPreexistingPOId('');setPOExcluded({});nf(effectivePoId+' '+(preexistingPO?'applied':'created')+' for '+vn+' ('+selCount+' item'+(selCount!==1?'s':'')+')');
        }}><Icon name="cart" size={14}/> {preexistingPO?'Apply Preexisting PO':'Create PO'} ({poItems.filter((_,vi)=>!poExcluded[vi]).length})</button>}</div>
      </div></div>})()}

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
          if(!hasOpen)return<div key={idx} style={{padding:10,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,opacity:0.5}}><span style={{fontWeight:700}}>{item.sku}</span> {item.name} — <span style={{color:'#166534',fontWeight:600}}>Fully assigned</span></div>;
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

      // Manual refresh recalculates everything
      const refreshJobs=()=>{sv('jobs',syncJobs());nf('Jobs synced')};

      // Split job modal state
      // Split job modal state is at component level (splitModal/setSplitModal)

      // Helper: copy art-related fields from parent job to split job
      const _artFields=j=>({art_file_id:j.art_file_id,_art_ids:j._art_ids||null,art_name:j.art_name,art_status:j.art_status,deco_type:j.deco_type,positions:j.positions,
        art_requests:j.art_requests?JSON.parse(JSON.stringify(j.art_requests)):[],
        art_messages:j.art_messages?JSON.parse(JSON.stringify(j.art_messages)):[],
        assigned_artist:j.assigned_artist||null,rep_notes:j.rep_notes||null,
        rejections:j.rejections?JSON.parse(JSON.stringify(j.rejections)):null,
        sent_to_coach_at:j.sent_to_coach_at||null,coach_approved_at:j.coach_approved_at||null,coach_rejected:j.coach_rejected||null,coach_email_opened_at:j.coach_email_opened_at||null});

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
      // Custom split — split specific unit counts per item/size
      const splitCustom=(jIdx,splitQtys)=>{
        const j=jobs[jIdx];if(!j||!j.items?.length)return;
        let splitTotal=0;
        const splitItems=[];const keepItems=[];
        j.items.forEach(gi=>{
          const sqty=splitQtys[gi.item_idx]||0;
          if(sqty>0&&sqty<gi.units){
            splitItems.push({...gi,units:sqty,fulfilled:Math.min(gi.fulfilled||0,sqty)});
            keepItems.push({...gi,units:gi.units-sqty,fulfilled:Math.max(0,(gi.fulfilled||0)-sqty)});
            splitTotal+=sqty;
          } else if(sqty>=gi.units){
            splitItems.push({...gi});splitTotal+=gi.units;
          } else {
            keepItems.push({...gi});
          }
        });
        if(splitTotal===0){nf('Enter units to split off','error');return}
        if(keepItems.length===0||keepItems.reduce((a,gi)=>a+gi.units,0)===0){nf('Must leave some units on the original job','error');return}
        const existingSplits=jobs.filter(jj=>jj.split_from===j.id).length;
        const splitId=j.id+'-C'+(existingSplits+1);
        const splitJob2={...j,..._artFields(j),id:splitId,key:j.key+'__split__C'+(existingSplits+1),split_from:j.id,items:splitItems,
          total_units:splitTotal,fulfilled_units:splitItems.reduce((a,gi)=>a+(gi.fulfilled||0),0),
          prod_status:'hold',created_at:new Date().toLocaleDateString()};
        const remainJob={...j,items:keepItems,total_units:keepItems.reduce((a,gi)=>a+gi.units,0),
          fulfilled_units:keepItems.reduce((a,gi)=>a+(gi.fulfilled||0),0)};
        const newJobs2=[...jobs];newJobs2.splice(jIdx,1,remainJob,splitJob2);
        const updated={...o,jobs:newJobs2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setSplitModal(null);nf('Custom split! '+splitId+' with '+splitTotal+' units');
      };
      const updJob=(jIdx,k,v)=>{sv('jobs',jobs.map((j,i)=>i===jIdx?{...j,[k]:v}:j))};
      const prodStatuses=['draft','hold','staging','in_process','completed'];
      const prodLabels={draft:'Draft',hold:'On Hold',staging:'In Line',in_process:'In Process',completed:'Completed'};
      const artLabels=ART_LABELS;
      const itemLabels={need_to_order:'Need to Order',partially_received:'Partially Received',items_received:'Items Received'};

      // Job detail view
      if(selJob!=null){
        const ji=selJob;const j=jobs[ji];
        if(!j)return<div className="card"><div className="card-body"><button className="btn btn-sm btn-secondary" onClick={()=>setSelJob(null)}><Icon name="back" size={12}/> Back to Jobs</button><div style={{padding:20,color:'#94a3b8'}}>Job not found</div></div></div>;
        const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';
        const canOverride=cu.role==="admin"||cu.role==="production"||cu.role==="prod_manager"||cu.role==="gm";
        const pct=j.total_units>0?Math.round(j.fulfilled_units/j.total_units*100):0;
        const artF=safeArt(o).find(a=>a.id===j.art_file_id);
        const allArtFiles=(j._art_ids||[j.art_file_id].filter(Boolean)).map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);
        // Get full size breakdowns per item
        const itemDetails=(j.items||[]).map(gi=>{
          const it=safeItems(o)[gi.item_idx];if(!it)return{...gi,sizes:{},fulSizes:{}};
          const sizes=safeSizes(it);const fulSizes={};
          Object.entries(sizes).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            fulSizes[sz]=Math.min(v,pQ+rQ);
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
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{itemLabels[j.item_status]}</span>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}}>{prodLabels[j.prod_status]}</span>
                </div>
                <div style={{fontSize:15,fontWeight:700,marginTop:4}}>{j.art_name}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                {(()=>{const jobItemIdxs=new Set((j.items||[]).map(it=>it.item_idx));
                  const siblings=safeJobs(o).filter(j2=>j2.id!==j.id&&(j2.items||[]).some(it=>jobItemIdxs.has(it.item_idx)));
                  if(siblings.length===0)return null;
                  return<div style={{fontSize:10,marginTop:3,padding:'3px 8px',background:'#fef3c7',borderRadius:4,border:'1px solid #fde68a',color:'#92400e'}}>
                    Multi-job item: {siblings.map(s=><span key={s.id} style={{fontWeight:700}}>{s.art_name||s.deco_type?.replace(/_/g,' ')} <span style={{padding:'1px 4px',borderRadius:3,fontSize:9,background:s.prod_status==='completed'||s.prod_status==='shipped'?'#dcfce7':'#fee2e2',color:s.prod_status==='completed'||s.prod_status==='shipped'?'#166534':'#dc2626'}}>{prodLabels[s.prod_status]||s.prod_status}</span></span>).reduce((acc,el,i)=>i===0?[el]:[...acc,<span key={'sep-'+i}> · </span>,el],[])}
                  </div>})()}
                {j.split_from&&<div style={{fontSize:11,color:'#7c3aed',marginTop:2}}>✂️ Split from {j.split_from}</div>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:24,fontWeight:800,color:pct>=100?'#166534':'#1e40af'}}>{j.fulfilled_units}/{j.total_units}</div>
                <div style={{width:80,background:'#e2e8f0',borderRadius:4,height:6,marginTop:4}}><div style={{height:6,borderRadius:4,background:pct>=100?'#22c55e':pct>0?'#f59e0b':'#e2e8f0',width:pct+'%'}}/></div>
                <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{pct}% fulfilled</div>
              </div>
            </div>
            {/* ── Shipping Method (Sales Rep selects at job level) ── */}
            <div style={{padding:'8px 20px 12px',borderTop:'1px solid #f1f5f9'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <span style={{fontSize:11,fontWeight:700,color:'#64748b'}}>How is this shipping?</span>
                {[['ship_customer','📦 Ship to Customer'],['rep_delivery','🚗 Rep Delivery'],['customer_pickup','🏫 Customer Pickup'],['hold','⏸️ Hold']].map(([v,l])=>
                  <button key={v} className={`btn btn-sm ${j.ship_method===v?'btn-primary':'btn-secondary'}`} style={{fontSize:10,padding:'3px 8px'}} onClick={()=>updJob(ji,'ship_method',j.ship_method===v?null:v)}>{l}</button>)}
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
            {j.art_status==='waiting_approval'&&(()=>{const artFile2=safeArt(o).find(a=>a.id===j.art_file_id);const _mf=_filterDisplayable(artFile2?.mockup_files||artFile2?.files||[]);const _im=_filterDisplayable(Object.values(artFile2?.item_mockups||{}).flat());const _seen=new Set();const mockups=[..._mf,..._im].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});const _stca=j.sent_to_coach_at?new Date(j.sent_to_coach_at):null;return<div style={{margin:'0 20px',padding:'16px',background:_stca?'linear-gradient(135deg,#dbeafe,#eff6ff)':'linear-gradient(135deg,#fef3c7,#fffbeb)',border:'2px solid '+(_stca?'#93c5fd':'#fbbf24'),borderRadius:10}}>
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
              {mockups.length>0&&<div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:'#78350f',marginBottom:6}}>Review the mockup{mockups.length>1?'s':''}:</div>
                <div style={{display:'grid',gridTemplateColumns:mockups.length>1?'1fr 1fr':'1fr',gap:8}}>
                  {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);
                    return<div key={fi} style={{borderRadius:10,border:'2px solid #f59e0b',overflow:'hidden',background:'white',cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}>
                      {_isImgUrl(url,f)?<img src={url} alt={name} style={{width:'100%',height:300,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                      :_isPdfUrl(url,f)?<div style={{position:'relative',height:300,display:'flex',alignItems:'center',justifyContent:'center',background:'#fafafa'}}>
                        {_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt={name} style={{width:'100%',height:300,objectFit:'contain',display:'block'}} onError={e=>{e.target.style.display='none';e.target.nextSibling&&(e.target.nextSibling.style.display='flex')}}/>:null}
                        <div style={{display:_cloudinaryPdfThumb(url)?'none':'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                          <span style={{fontSize:36}}>PDF</span><span style={{fontSize:13,color:'#1e40af'}}>{name}</span></div></div>
                      :<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,height:300,background:'#fafafa'}}>
                        <span style={{fontSize:20}}>📄</span><span style={{fontSize:14,fontWeight:600,color:'#1e40af'}}>{name}</span></div>}
                      <div style={{padding:'4px 10px',borderTop:'1px solid #fde68a',fontSize:11,color:'#92400e',fontWeight:600,display:'flex',justifyContent:'space-between'}}><span>{name}</span><span style={{color:'#2563eb'}}>Click to enlarge</span></div>
                    </div>})}
                </div>
              </div>}
              {mockups.length===0&&<div style={{padding:12,background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:6,marginBottom:12,fontSize:12,color:'#9a3412'}}>No mockup files attached yet — check the Art Library tab for files.</div>}
              {/* Artwork details — per-art breakdown with correct locations */}
              {(()=>{const _allArt2=(j._art_ids||[j.art_file_id].filter(Boolean)).map(aid=>safeArt(o).find(a=>a.id===aid)).filter(Boolean);
                const _numDecos2=[];(j.items||[]).forEach(gi=>{const it=safeItems(o)[gi.item_idx];if(it)safeDecos(it).forEach(d=>{if(d.kind==='numbers')_numDecos2.push(d)})});
                const _nd2=_numDecos2[0];
                const _colorMap2={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
                if(_allArt2.length===0)return null;
                return<div style={{marginBottom:12}}>
                  {_allArt2.map((af3,afi)=>{
                    const _dp3=new Set();(j.items||[]).forEach(gi=>{const it=safeItems(o)[gi.item_idx];if(it)safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id===af3.id)_dp3.add(d.position||'Front Center')})});
                    const _pl3=_dp3.size>0?[..._dp3]:[];const _as3=af3.art_sizes||{};
                    const _cl3=(af3.ink_colors||af3.thread_colors||'').split(/[,\n]/).map(c3=>c3.trim()).filter(Boolean);const _isE3=af3.deco_type==='embroidery';
                    return<div key={afi} style={{marginBottom:afi<_allArt2.length-1?8:0,padding:'12px 14px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>{af3.name||'Art '+(afi+1)}</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:_cl3.length>0?10:0}}>
                        <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{af3.deco_type?.replace(/_/g,' ')||'—'}</div></div>
                        <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Location{_pl3.length>1?'s':''}</div><div style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{_pl3.join(', ')||'—'}</div></div>
                        {_pl3.length<=1?<div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{af3.art_size||'—'}</div></div>
                        :_pl3.map((pos,pi)=><div key={pi}><div style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Size — {pos}</div><div style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{_as3[pos]||(pi===0?af3.art_size:'')||'—'}</div></div>)}
                      </div>
                      {_cl3.length>0&&<div>
                        <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',marginBottom:4}}>{_isE3?'Thread Colors':'Ink Colors / Pantones'} ({_cl3.length})</div>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          {_cl3.map((cl,i)=>{const clL=cl.toLowerCase();const sw=_colorMap2[cl]||Object.entries(_colorMap2).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                            return<div key={i} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 10px',background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
                              <div style={{width:14,height:14,borderRadius:3,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                              <span style={{fontSize:11,fontWeight:600}}>{cl}</span></div>})}
                        </div>
                      </div>}
                    </div>})}
                  {_nd2&&<div style={{padding:'12px 14px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,marginTop:8}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',marginBottom:4}}>Numbers</div>
                    <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:12}}>
                      <span><strong>{(_nd2.num_method||'heat_transfer').replace(/_/g,' ')}</strong></span>
                      <span>Size: <strong>{_nd2.num_size||'—'}</strong></span>
                      {_nd2.front_and_back&&<span>Back: <strong>{_nd2.num_size_back||_nd2.num_size||'—'}</strong></span>}
                      {_nd2.print_color&&<span>Color: <strong>{_nd2.print_color}</strong></span>}
                      {_nd2.front_and_back&&<span style={{padding:'1px 6px',borderRadius:4,background:'#7c3aed',color:'white',fontSize:10,fontWeight:700}}>Front + Back</span>}
                    </div>
                  </div>}
                </div>})()}
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
                <button className="btn" style={{fontSize:13,padding:'8px 20px',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'white',border:'none',borderRadius:8,fontWeight:800,boxShadow:'0 2px 8px rgba(34,197,94,0.3)'}} onClick={()=>{const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'production_files_needed'}:jj);const updArt2=j.art_file_id?af.map(a=>a.id===j.art_file_id?{...a,status:'approved'}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);setArtRevisionNote('');nf('✅ Art approved — awaiting prod files')}}>✅ Approve Artwork</button>
                <button className="btn" style={{fontSize:13,padding:'8px 20px',background:'linear-gradient(135deg,#3b82f6,#2563eb)',color:'white',border:'none',borderRadius:8,fontWeight:800,boxShadow:'0 2px 8px rgba(59,130,246,0.3)'}} onClick={()=>{const c2=ic||allCustomers?.find?.(x=>x.id===o.customer_id);const contacts=(c2?.contacts||[]).filter(ct2=>ct2.email||ct2.phone);const ct=contacts[0]||{};const pUrl=c2?.alpha_tag?(window.location.origin+'/?portal='+c2.alpha_tag):'';const defMsg='Hi '+(ct.name||'Coach')+',\n\nYour artwork mockup for "'+j.art_name+'" is ready for review!\n\nPlease review and approve it through your portal:\n'+(pUrl||'(portal link unavailable)')+'\n\nLet us know if you\'d like any changes.\n\n'+cu.name+'\nNational Sports Apparel';setCoachApprovalModal({jIdx:ji,contacts,contact:ct,portalUrl:pUrl,sendEmail:!!ct.email,sendText:!!ct.phone,checkedEmails:Object.fromEntries((c2?.contacts||[]).filter(ct2=>ct2.email).map(ct2=>[ct2.email,true])),customEmails:[],addingEmail:'',message:defMsg,sending:false,followUpDays:portalSettings?.followUpDays||7})}}>📤 Send to Coach</button>
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
            {j.art_status==='production_files_needed'&&<div style={{margin:'0 20px',padding:'12px 16px',background:'linear-gradient(135deg,#fef9c3,#fefce8)',border:'2px solid #fde047',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>✅</span>
                <span style={{fontWeight:700,fontSize:14,color:'#854d0e'}}>Art Approved — Waiting for Production Files</span>
              </div>
              <div style={{fontSize:12,color:'#713f12',marginTop:4}}>The artist needs to upload final production files before this job can go to production.</div>
            </div>}
            {j.art_status==='art_complete'&&<div style={{margin:'0 20px',padding:'10px 16px',background:'linear-gradient(135deg,#dcfce7,#f0fdf4)',border:'2px solid #86efac',borderRadius:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>🎉</span>
                <span style={{fontWeight:700,fontSize:14,color:'#166534'}}>Art Complete — Ready for Production</span>
              </div>
            </div>}
            {(j.art_status==='art_complete'||j.art_status==='production_files_needed')&&(()=>{const artFile3=safeArt(o).find(a=>a.id===j.art_file_id);const _mf3=_filterDisplayable(artFile3?.mockup_files||artFile3?.files||[]);const _im3=_filterDisplayable(Object.values(artFile3?.item_mockups||{}).flat());const _seen3=new Set();const mockups3=[..._mf3,..._im3].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen3.has(u))return false;_seen3.add(u);return true});if(mockups3.length===0)return null;return<div style={{margin:'8px 20px'}}>
              <div style={{fontSize:11,fontWeight:700,color:'#166534',marginBottom:6}}>Approved mockup{mockups3.length>1?'s':''}:</div>
              <div style={{display:'grid',gridTemplateColumns:mockups3.length>1?'1fr 1fr':'1fr',gap:8}}>
                {mockups3.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);
                  return<div key={fi} style={{borderRadius:10,border:'2px solid #86efac',overflow:'hidden',background:'white',cursor:'pointer'}} onClick={()=>setMockupLightbox(url)}>
                    {_isImgUrl(url,f)?<img src={url} alt={name} style={{width:'100%',height:300,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                    :_isPdfUrl(url,f)?<div style={{position:'relative',height:300,display:'flex',alignItems:'center',justifyContent:'center',background:'#fafafa'}}>
                      {_cloudinaryPdfThumb(url)?<img src={_cloudinaryPdfThumb(url)} alt={name} style={{width:'100%',height:300,objectFit:'contain',display:'block'}} onError={e=>{e.target.style.display='none';e.target.nextSibling&&(e.target.nextSibling.style.display='flex')}}/>:null}
                      <div style={{display:_cloudinaryPdfThumb(url)?'none':'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                        <span style={{fontSize:36}}>PDF</span><span style={{fontSize:13,color:'#1e40af'}}>{name}</span></div></div>
                    :<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,height:300,background:'#fafafa'}}>
                      <span style={{fontSize:20}}>📄</span><span style={{fontSize:14,fontWeight:600,color:'#1e40af'}}>{name}</span></div>}
                    <div style={{padding:'4px 10px',borderTop:'1px solid #bbf7d0',fontSize:11,color:'#166534',fontWeight:600,display:'flex',justifyContent:'space-between'}}><span>{name}</span><span style={{color:'#2563eb'}}>Click to enlarge</span></div>
                  </div>})}
              </div>
            </div>})()}
            {/* Status controls */}
            <div style={{padding:'10px 20px',borderTop:'1px solid #f1f5f9',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Art:</div>
              <select className="form-select" style={{width:150,fontSize:11}} value={j.art_status} onChange={e=>{const ns=e.target.value;const artIds=j._art_ids||[j.art_file_id].filter(Boolean);if(ns==='art_complete'){const missingProd=artIds.some(aid=>{const af2=af.find(a=>a.id===aid);return af2&&(af2.prod_files||[]).length===0});if(missingProd){nf('Upload production files for all art first','error');return}}const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;const upd={...jj,art_status:ns};/* warehouse must explicitly Move to Deco — no auto-transition */if((ns==='art_complete'||ns==='production_files_needed')&&upd.art_requests)upd.art_requests=upd.art_requests.map(r=>r.status==='requested'||r.status==='in_progress'?{...r,status:'completed'}:r);return upd});const afSt=ns==='waiting_approval'?'needs_approval':(ns==='production_files_needed'||ns==='art_complete')?'approved':(ns==='needs_art'||ns==='art_requested')?'waiting_for_art':ns==='art_in_progress'?'waiting_for_art':null;const updArt2=afSt?af.map(a=>artIds.includes(a.id)?{...a,status:afSt}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false)}}>
                {Object.entries(artLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
              {(()=>{const _artIds3=j._art_ids||[j.art_file_id].filter(Boolean);if(_artIds3.length===0||(_artIds3.length===1&&_artIds3[0]==='__tbd'))return null;const hasReqs=(j.art_requests||[]).length>0;const activeReq=(j.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
                return<>{hasReqs&&<span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:activeReq?'#fef3c7':'#dcfce7',color:activeReq?'#92400e':'#166534',marginRight:4,animation:activeReq?'pulse 2s infinite':'none'}}>
                  {activeReq?(activeReq.status==='in_progress'?'Art In Progress':'Art Requested'):'Art Complete'}</span>}
                {hasReqs&&<button className="btn btn-sm" style={{fontSize:10,background:'#dc2626',color:'white',border:'none',padding:'3px 8px',marginRight:4}} onClick={()=>{const artIds=j._art_ids||[j.art_file_id].filter(Boolean);const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;return{...jj,art_status:'needs_art',art_requests:(jj.art_requests||[]).map(r=>['requested','in_progress','completed','waiting_approval'].includes(r.status)?{...r,status:'recalled'}:r),assigned_artist:''}});const updArt=af.map(a=>artIds.includes(a.id)?{...a,status:'waiting_for_art'}:a);const updated={...o,jobs:updJobs,art_files:updArt,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art recalled — you can re-request with new instructions')}}>Recall Art</button>}
                {hasReqs&&<button className="btn btn-sm" style={{fontSize:10,background:'#6d28d9',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>setArtReqModal({jIdx:ji,artist:j.assigned_artist||'',instructions:'',files:[]})}>
                  Update Art</button>}</>})()}
              {(j.art_status==='waiting_approval')&&<button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'3px 8px'}} onClick={()=>{const updJobs=safeJobs(o).map((jj,i2)=>i2===ji?{...jj,art_status:'production_files_needed'}:jj);const _appArtIds=j._art_ids||[j.art_file_id].filter(Boolean);const updArt2=_appArtIds.length>0?af.map(a=>_appArtIds.includes(a.id)?{...a,status:'approved'}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art approved — awaiting prod files')}}>Approve Art</button>}
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
                {(j.items||[]).length>0&&j.total_units>1&&<button className="btn btn-sm" style={{background:'#7c3aed',color:'white',fontSize:10}} onClick={()=>setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}>✂️ Split Job</button>}
                <button className="btn btn-sm btn-secondary" onClick={()=>{
                  const w=window.open('','_blank','width=700,height=900');
                  w.document.write('<html><head><title>'+j.id+' — '+j.art_name+'</title><style>body{font-family:sans-serif;padding:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:12px}th{background:#f0f0f0;font-weight:700}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.info div{padding:8px;background:#f8f8f8;border-radius:4px}.label{font-size:10px;color:#666;font-weight:600;text-transform:uppercase}@media print{body{padding:12px}}</style></head><body>');
                  w.document.write('<h1>'+j.id+' — '+j.art_name+'</h1>');
                  w.document.write('<p>'+j.deco_type?.replace(/_/g,' ')+' · '+(j.positions||'').replace(/^,\s*/,'')+' · '+j.total_units+' total units</p>');
                  w.document.write('<p>SO: '+o.id+' — '+(o.memo||'')+'</p>');
                  // Mockup image at top
                  const _jsMocks=(artF?.mockup_files||artF?.files||[]).filter(f=>f);
                  const _jsMockUrl=(()=>{for(const f of _jsMocks){const u=typeof f==='string'?f:(f?.url||'');if(_isImgUrl(u,f))return u;const pt=_isPdfUrl(u,f)?_cloudinaryPdfThumb(u):null;if(pt)return pt}return itemDetails.find(gi=>gi.image_url&&_isImgUrl(gi.image_url))?.image_url||null})();
                  if(_jsMockUrl){w.document.write('<div style="text-align:center;margin:12px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><img src="'+_jsMockUrl+'" style="max-width:100%;max-height:350px;object-fit:contain;border-radius:6px"/><div style="font-size:10px;color:#666;margin-top:4px">Mockup Preview</div></div>')}
                  w.document.write('<div class="info"><div><div class="label">Art Status</div>'+artLabels[j.art_status]+'</div><div><div class="label">Item Status</div>'+itemLabels[j.item_status]+'</div><div><div class="label">Production</div>'+prodLabels[j.prod_status]+'</div><div><div class="label">Fulfilled</div>'+j.fulfilled_units+'/'+j.total_units+' ('+pct+'%)</div></div>');
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
                    :<ImgUpload url="" onUpload={u=>{if(gi.product_id&&onSaveProduct){const up=products.find(p=>p.id===gi.product_id);if(up)onSaveProduct({...up,image_url:u});nf('Product image saved')}}} onError={e=>nf(e,'error')} size={44}/>}
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
          const updatedJobs=jobs.map((jj,i)=>i===artReqModal.jIdx?{...jj,art_requests:[...(jj.art_requests||[]),req],art_status:(jj.art_status==='needs_art'||jj.art_status==='waiting_approval'||jj.art_status==='production_files_needed')?'art_requested':jj.art_status,assigned_artist:artReqModal.artist||jj.assigned_artist}:jj);
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
        const doSendCoach=async()=>{
          const actions=[];
          if(cam.sendEmail&&allTargets.length>0){
            if(_brevoKey){
              setCoachApprovalModal(m=>({...m,sending:true}));
              const htmlMsg=cam.message.replace(/\n/g,'<br/>');
              const toList=allTargets.map(em=>({email:em}));
              const res=await sendBrevoEmail({to:toList,subject:'Artwork ready for approval — '+j3.art_name,htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6">'+htmlMsg+'</div>',senderName:cu.name||'National Sports Apparel',senderEmail:cu?.email||'noreply@nationalsportsapparel.com',replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined});
              if(res.ok){actions.push('email sent to '+allTargets.join(', '));actions._messageId=res.messageId}else{nf('Email failed: '+res.error,'error');setCoachApprovalModal(m=>({...m,sending:false}));return}
            }else{
              const subj=encodeURIComponent('Artwork ready for approval — '+j3.art_name);
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

            {/* ── Text toggle ── */}
            <div style={{marginBottom:12,padding:12,background:cam.sendText?'#f0fdf4':'#f8fafc',border:'1px solid '+(cam.sendText?'#86efac':'#e2e8f0'),borderRadius:8}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                <input type="checkbox" checked={cam.sendText} onChange={e=>setCoachApprovalModal(m=>({...m,sendText:e.target.checked}))} style={{width:16,height:16,accentColor:'#22c55e'}}/>
                <span style={{fontWeight:700,fontSize:13,color:cam.sendText?'#166534':'#64748b'}}>Text Coach</span>
                {cam.contact.phone?<><span style={{fontSize:11,color:'#64748b'}}>{cam.contact.phone}</span>{_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600,marginLeft:4}}>Sends directly</span>}</>:<span style={{fontSize:11,color:'#dc2626'}}>No phone on file</span>}
              </label>
            </div>

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
              <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>Follow up in</span>
              <select className="form-input" value={cam.followUpDays||7} onChange={e=>setCoachApprovalModal(m=>({...m,followUpDays:parseInt(e.target.value)}))} style={{width:70,fontSize:12,padding:'4px 6px'}}>
                {[1,2,3,5,7,10,14,21,30].map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <span style={{fontSize:12,color:'#6d28d9'}}>days if no response</span>
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
        const existingJobs=safeJobs(o);
        // If jobs already exist, rebuild wizard groups from existing job structure (respecting splits)
        if(existingJobs.length>0){
          const groups=existingJobs.map(j=>{
            const items=(j.items||[]).map(ji=>{
              const it=safeItems(o)[ji.item_idx];
              const af2=safeArr(o?.art_files).find(f=>f.id===j.art_file_id);
              return{item_idx:ji.item_idx,deco_idx:ji.deco_idx,sku:ji.sku||it?.sku||'',name:ji.name||safeStr(it?.name),color:ji.color||it?.color||'',
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
        const wizArtistsAll=REPS.filter(r=>r.role==='art'||r.role==='artist').filter(r=>r.is_active!==false);
        const newJobs=[];
        groups.forEach((g,gi)=>{
          if(g.items.length===0)return;
          const artIds=[...new Set(g.items.map(it=>it.art_file_id).filter(Boolean))];
          const allApproved=artIds.every(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&af2.status==='approved'});
          const allProdFiles=artIds.every(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&(af2.prod_files||[]).length>0});
          const anyUploaded=artIds.some(aid=>{const af2=safeArt(o).find(f=>f.id===aid);return af2&&(af2.status==='uploaded'||af2.status==='needs_approval')});
          let artStatus=allApproved&&allProdFiles?'art_complete':allApproved?'production_files_needed':anyUploaded?'waiting_approval':'needs_art';
          // Skip artist — rep approved the art directly
          if(g.skipArtist&&activateAll){artStatus='art_complete'}
          // When releasing for art with an assigned artist, create a proper art request
          const hasArtist=activateAll&&g.artist&&!g.skipArtist;
          const autoArtRequest=activateAll&&!g.skipArtist&&artStatus==='needs_art';
          if(autoArtRequest)artStatus='art_requested';
          const totalUnits=g.items.reduce((a,it)=>a+it.units,0);
          const positions=[...new Set(g.items.map(it=>it.position))].join(', ');
          const artistObj=hasArtist?wizArtistsAll.find(a=>a.id===g.artist):null;
          newJobs.push({
            id:o.id.replace('SO-','JOB-')+'-'+(gi+1<10?'0':'')+(gi+1),
            key:'deco_'+g.deco_type+'_'+(gi+1),
            art_file_id:artIds[0]||null,_art_ids:artIds,
            art_name:g.name,deco_type:g.deco_type,positions,
            art_status:artStatus,item_status:'need_to_order',
            prod_status:activateAll?'hold':'draft',
            ship_method:o.ship_preference==='rep_delivery'?'rep_delivery':'ship_customer',
            total_units:totalUnits,fulfilled_units:0,split_from:null,...(g._merged?{_merged:true}:{}),
            created_at:new Date().toLocaleDateString(),
            assigned_artist:g.artist||'',
            rep_notes:g.notes||'',
            ...(autoArtRequest?{art_requests:[{id:'AR-'+Date.now()+'-'+gi,artist:g.artist||'',artist_name:artistObj?.name||'',instructions:g.notes||'Requested on release',files:g.files||[],status:'requested',created_at:new Date().toISOString(),created_by:cu?.name||'System',auto:false}]}:{}),
            items:g.items.map(({item_idx,deco_idx,sku,name,color,units,fulfilled})=>({item_idx,deco_idx,sku,name,color,units,fulfilled:fulfilled||0}))
          });
        });
        // Store rep's sample art files on the art file records (separate from artist mockups)
        // For skip-artist jobs, also promote sample art to mockup_files and mark art as approved
        let updArtFiles=[...safeArt(o)];
        groups.forEach((g,gi2)=>{
          if(g.items.length===0)return;
          const nj=newJobs.find(j2=>j2.key==='deco_'+g.deco_type+'_'+(gi2+1));
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
        });
        const updated={...o,jobs:newJobs,art_files:updArtFiles,updated_at:new Date().toLocaleString()};
        setO(updated);onSave(updated);setDirty(false);setJobWizard(null);
        const artSent=activateAll?newJobs.filter(j=>j.art_status==='art_requested'&&(j.art_requests||[]).length>0).length:0;
        const artSkipped=activateAll?newJobs.filter(j=>j.art_status==='art_complete').length:0;
        const msgs=[];if(artSent>0)msgs.push(artSent+' art job'+(artSent!==1?'s':'')+' sent to Art Dashboard');if(artSkipped>0)msgs.push(artSkipped+' job'+(artSkipped!==1?'s':'')+' marked art complete');
        nf(activateAll?(msgs.length>0?'Jobs released! '+msgs.join(', '):'Jobs released for art!'):'Draft jobs saved — activate when ready');
      };

      // Job Setup Wizard Modal
      const wizArtists=REPS.filter(r=>r.role==='art'||r.role==='artist').filter(r=>r.is_active!==false);
      if(jobWizard)return<div className="card"><div className="card-header" style={{background:'linear-gradient(135deg,#7c3aed,#a78bfa)',color:'white'}}>
        <h2 style={{color:'white',margin:0}}>Job Setup Wizard</h2>
      </div><div className="card-body" style={{padding:16}}>
        <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>Organize items into production jobs. Items are grouped by decoration type. Confirm grouping, split if needed, and assign an artist with notes for each job before releasing.</div>
        {jobWizard.groups.map((g,gi)=><div key={gi} style={{padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:700,color:'white',background:'#7c3aed',padding:'2px 8px',borderRadius:4,textTransform:'uppercase'}}>{g.deco_type.replace(/_/g,' ')}</span>
            <input className="form-input" value={g.name} style={{fontSize:13,fontWeight:700,padding:'4px 8px',flex:1}}
              onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],name:e.target.value};setJobWizard({...jobWizard,groups:gs})}}/>
            <span style={{fontSize:11,fontWeight:700,color:'#475569'}}>{g.items.reduce((a,it)=>a+it.units,0)} units</span>
            {jobWizard.groups.length>1&&g.items.length===0&&<button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:14,fontWeight:700}}
              onClick={()=>{const gs=[...jobWizard.groups];gs.splice(gi,1);setJobWizard({...jobWizard,groups:gs})}}>×</button>}
          </div>
          {g.items.length===0?<div style={{padding:12,textAlign:'center',color:'#94a3b8',fontSize:11}}>No items — drag items here or remove this group</div>:
          <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #e2e8f0'}}>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>SKU</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Item</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Art</th>
              <th style={{padding:'3px 6px',textAlign:'left',fontSize:10,color:'#64748b'}}>Art Location</th>
              <th style={{padding:'3px 6px',textAlign:'center',fontSize:10,color:'#64748b'}}>Units</th>
              <th style={{padding:'3px 6px',textAlign:'right',fontSize:10,color:'#64748b'}}></th>
            </tr></thead>
            <tbody>{g.items.map((it,ii)=><tr key={ii} style={{borderBottom:'1px solid #f1f5f9'}}>
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
          {g.items.length>0&&<div style={{marginTop:10,padding:10,background:g.skipArtist?'#f0fdf4':'white',borderRadius:6,border:'1px solid '+(g.skipArtist?'#86efac':'#e2e8f0')}}>
            <div style={{marginBottom:8}}>
              <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,fontWeight:700,color:g.skipArtist?'#166534':'#475569'}}>
                <input type="checkbox" checked={!!g.skipArtist} onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],skipArtist:e.target.checked};setJobWizard({...jobWizard,groups:gs})}} style={{width:14,height:14,accentColor:'#166534'}}/>
                Skip Artist — I already have approved artwork for this job
              </label>
              {g.skipArtist&&<div style={{fontSize:10,color:'#166534',marginTop:3,marginLeft:20}}>Art status will be set to complete. Upload sample art below if you have files to attach.</div>}
            </div>
            {!g.skipArtist&&<div style={{display:'flex',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
              <div style={{minWidth:180}}>
                <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>Artist *</div>
                <select className="form-select" style={{fontSize:11,width:'100%'}} value={g.artist||''} onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],artist:e.target.value};setJobWizard({...jobWizard,groups:gs})}}>
                  <option value="">Select artist...</option>
                  {wizArtists.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>Notes for Artist</div>
                <textarea className="form-input" rows={2} style={{fontSize:11,width:'100%',resize:'vertical'}} placeholder="Mockup details, color notes, placement instructions..." value={g.notes||''} onChange={e=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],notes:e.target.value};setJobWizard({...jobWizard,groups:gs})}}/>
              </div>
            </div>}
            <div style={{marginTop:6}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>Sample Art / Reference Files</div>
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <button style={{fontSize:10,padding:'3px 10px',background:'#f1f5f9',border:'1px solid #d1d5db',borderRadius:4,cursor:'pointer',color:'#475569',fontWeight:600}} onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.onchange=async()=>{for(const f of Array.from(inp.files)){nf('Uploading '+f.name+'...');try{const url=await fileUpload(f,'nsa-art-requests');const gs=[...jobWizard.groups];gs[gi]={...gs[gi],files:[...(gs[gi].files||[]),{name:f.name,size:f.size,type:f.type,url}]};setJobWizard({...jobWizard,groups:gs})}catch(err){nf('Upload failed: '+err.message,'error')}}};inp.click()}}>+ Add Files</button>
                {(g.files||[]).map((f,fi)=><span key={fi} style={{fontSize:10,padding:'2px 6px',background:'#ede9fe',borderRadius:3,color:'#6d28d9',fontWeight:600,display:'flex',alignItems:'center',gap:3}}>{f.name}<button style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:12,padding:0,lineHeight:1}} onClick={()=>{const gs=[...jobWizard.groups];gs[gi]={...gs[gi],files:(gs[gi].files||[]).filter((_,i)=>i!==fi)};setJobWizard({...jobWizard,groups:gs})}}>×</button></span>)}
              </div>
            </div>
          </div>}
        </div>)}
        <div style={{display:'flex',gap:6,marginBottom:16}}>
          <button className="btn btn-sm btn-secondary" onClick={()=>{
            const gs=[...jobWizard.groups,{name:'New Job',deco_type:jobWizard.groups[0]?.deco_type||'screen_print',items:[],artist:'',notes:'',files:[]}];
            setJobWizard({...jobWizard,groups:gs});
          }}>+ Add Group</button>
        </div>
        {(()=>{const allReady=jobWizard.groups.filter(g=>g.items.length>0).every(g=>g.skipArtist||g.artist);const notReady=!allReady;
          return<div style={{display:'flex',gap:8,borderTop:'1px solid #e2e8f0',paddingTop:12,alignItems:'center'}}>
          <button className="btn btn-primary" style={{background:'#166534',borderColor:'#166534',fontWeight:800,opacity:notReady?0.5:1}} disabled={notReady}
            onClick={()=>wizActivate(jobWizard.groups,true)}>Release Jobs for Art</button>
          <button className="btn btn-secondary" style={{fontWeight:700}}
            onClick={()=>wizActivate(jobWizard.groups,false)}>Save as Drafts</button>
          <button className="btn btn-secondary" onClick={()=>setJobWizard(null)}>Cancel</button>
          {notReady&&<span style={{fontSize:11,color:'#dc2626',fontWeight:600}}>Select an artist or mark "Skip Artist" for each job</span>}
        </div>})()}
      </div></div>;

      // Draft jobs banner
      const hasDrafts=draftJobs.length>0;

      return<div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2>Production Jobs ({activeJobs.length}{hasDrafts?' + '+draftJobs.length+' drafts':''})</h2>
        <div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm" style={{fontSize:10,background:'#7c3aed',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={openJobWizard}>Set Up Jobs</button>
          {jobs.length>1&&!mergeMode&&<button className="btn btn-sm" style={{fontSize:10,background:'#1e40af',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} onClick={()=>setMergeMode({selected:[]})}>Merge Jobs</button>}
          {mergeMode&&<><button className="btn btn-sm" style={{fontSize:10,background:'#166534',color:'white',border:'none',padding:'4px 12px',fontWeight:700}} disabled={mergeMode.selected.length<2} onClick={()=>{
            const sel=mergeMode.selected.sort((a,b)=>a-b);const target=jobs[sel[0]];const mergeItems=[...target.items||[]];let mergeUnits=target.total_units;
            sel.slice(1).forEach(ji=>{const mj=jobs[ji];mergeItems.push(...(mj.items||[]));mergeUnits+=(mj.total_units||0)});
            const merged={...target,items:mergeItems,total_units:mergeUnits,_merged:true};
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
        {jobs.length===0&&<div style={{padding:24,textAlign:'center',color:'#94a3b8'}}>No decorations assigned yet. Add artwork to items, then click "Set Up Jobs" to create production jobs.</div>}
        {jobs.length>0&&<table style={{fontSize:12}}><thead><tr>{mergeMode&&<th style={{width:30}}></th>}<th>Job ID</th><th>Artwork / Decoration</th><th>Items</th><th>Units</th><th>Items Status</th><th>Art</th><th>Production</th><th></th></tr></thead><tbody>
          {jobs.map((j,ji)=>{
            const canProduce=j.item_status==='items_received'&&j.art_status==='art_complete';const canOverride2=cu.role==='admin'||cu.role==='production'||cu.role==='prod_manager'||cu.role==='gm';
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
              <td><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:SC[j.item_status]?.bg,color:SC[j.item_status]?.c}}>{itemLabels[j.item_status]}</span></td>
              <td><select style={{fontSize:10,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontWeight:600,background:SC[j.art_status]?.bg,color:SC[j.art_status]?.c}} value={j.art_status} onChange={e=>{e.stopPropagation();const ns=e.target.value;const artIds=j._art_ids||[j.art_file_id].filter(Boolean);if(ns==='art_complete'){const missingProd=artIds.some(aid=>{const af2=af.find(a=>a.id===aid);return af2&&(af2.prod_files||[]).length===0});if(missingProd){nf('Upload production files for all art first','error');return}}const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;const upd={...jj,art_status:ns};/* warehouse must explicitly Move to Deco — no auto-transition */if((ns==='art_complete'||ns==='production_files_needed')&&upd.art_requests)upd.art_requests=upd.art_requests.map(r=>r.status==='requested'||r.status==='in_progress'?{...r,status:'completed'}:r);return upd});const afSt=ns==='waiting_approval'?'needs_approval':(ns==='production_files_needed'||ns==='art_complete')?'approved':(ns==='needs_art'||ns==='art_requested')?'waiting_for_art':ns==='art_in_progress'?'waiting_for_art':null;const updArt2=afSt?af.map(a=>artIds.includes(a.id)?{...a,status:afSt}:a):af;const updated={...o,jobs:updJobs,art_files:updArt2,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false)}}>
                {Object.entries(artLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
              <td>{j.prod_status==='hold'&&!canProduce&&!canOverride2?<span style={{fontSize:10,color:'#94a3b8',fontStyle:'italic'}}>Waiting items/art</span>
                :<select style={{fontSize:10,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontWeight:600,background:SC[j.prod_status]?.bg||'#f1f5f9',color:SC[j.prod_status]?.c||'#475569'}} value={j.prod_status} onChange={e=>{e.stopPropagation();updJob(ji,'prod_status',e.target.value)}}>
                  {prodStatuses.map(ps=><option key={ps} value={ps}>{prodLabels[ps]}</option>)}</select>}</td>
              <td style={{whiteSpace:'nowrap'}}>
                {(()=>{const _artIds4=j._art_ids||[j.art_file_id].filter(Boolean);if(_artIds4.length===0||(_artIds4.length===1&&_artIds4[0]==='__tbd'))return null;const hasReqs=(j.art_requests||[]).length>0;const activeReq=(j.art_requests||[]).find(r=>r.status==='in_progress'||r.status==='requested');
                  return<>{hasReqs&&activeReq&&<span style={{fontSize:8,padding:'1px 5px',borderRadius:8,fontWeight:700,background:'#fef3c7',color:'#92400e',marginRight:3}}>{activeReq.status==='in_progress'?'In Progress':'Requested'}</span>}
                  {hasReqs&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#dc2626',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();const artIds=j._art_ids||[j.art_file_id].filter(Boolean);const updJobs=safeJobs(o).map((jj,i2)=>{if(i2!==ji)return jj;return{...jj,art_status:'needs_art',art_requests:(jj.art_requests||[]).map(r=>['requested','in_progress','completed','waiting_approval'].includes(r.status)?{...r,status:'recalled'}:r),assigned_artist:''}});const updArt=af.map(a=>artIds.includes(a.id)?{...a,status:'waiting_for_art'}:a);const updated={...o,jobs:updJobs,art_files:updArt,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Art recalled — you can re-request with new instructions')}} title="Recall art request and reset status">Recall Art</button>}
                  {hasReqs&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#6d28d9',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();setArtReqModal({jIdx:ji,artist:j.assigned_artist||'',instructions:'',files:[]})}} title="Send updated instructions to artist">Update Art</button>}</>})()}
                {canSplit&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#7c3aed',color:'white',borderRadius:4,marginRight:3}} onClick={e=>{e.stopPropagation();setSplitModal({jIdx:ji,mode:null,selectedSkus:[]})}} title="Split job">✂️ Split</button>}
                {j.split_from&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',background:'#1e40af',color:'white',borderRadius:4}} onClick={e=>{e.stopPropagation();const parentIdx=jobs.findIndex(pj=>pj.id===j.split_from);if(parentIdx<0){nf('Parent job '+j.split_from+' not found','error');return}const parent=jobs[parentIdx];const existingKeys=new Set((parent.items||[]).map(gi=>gi.item_idx+'-'+gi.sku));const newItems=(j.items||[]).filter(gi=>!existingKeys.has(gi.item_idx+'-'+gi.sku));const mergedItems=[...(parent.items||[]),...newItems];const mergedUnits=mergedItems.reduce((a,gi)=>a+(gi.units||0),0);const mergedFulfilled=mergedItems.reduce((a,gi)=>a+(gi.fulfilled||0),0);const updJobs=jobs.map((jj,i2)=>i2===parentIdx?{...jj,items:mergedItems,total_units:mergedUnits,fulfilled_units:mergedFulfilled}:jj).filter((_,i2)=>i2!==ji);const updated={...o,jobs:updJobs,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setDirty(false);nf('Merged back into '+j.split_from)}} title="Merge back into parent job">Merge Back</button>}
              </td>
            </tr>
            {/* Grouped items under this job */}
            {(j.items||[]).map((gi,gii)=><tr key={gii} style={{background:'#fafbfc',cursor:'pointer'}} onClick={()=>setSelJob(ji)}>
              <td style={{paddingLeft:24,color:'#94a3b8',fontSize:10}}>↳</td>
              <td colSpan={2} style={{fontSize:11,color:'#475569'}}><span style={{fontWeight:600}}>{gi.sku}</span> {gi.name} <span style={{color:'#94a3b8'}}>({gi.color||'—'})</span></td>
              <td style={{fontSize:11}}>{gi.fulfilled}/{gi.units}</td>
              <td colSpan={4}/>
            </tr>)}
            </React.Fragment>})}
        </tbody></table>}

      {/* Split Job Modal */}
      {splitModal&&(()=>{
        const j=jobs[splitModal.jIdx];if(!j)return null;
        const items=(j.items||[]).map(gi=>{
          const it=safeItems(o)[gi.item_idx];
          let ful=0;
          if(it)Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).forEach(([sz,v])=>{
            const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);
            const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);
            ful+=Math.min(v,pQ+rQ);
          });
          return{...gi,received:ful};
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
              <button className="btn" style={{padding:16,background:'#faf5ff',border:'2px solid #c4b5fd',borderRadius:12,textAlign:'left',cursor:'pointer'}} onClick={()=>setSplitModal(m=>({...m,mode:'custom',customQtys:{}}))}>
                <div style={{fontWeight:800,fontSize:14,color:'#7c3aed',marginBottom:4}}>✏️ Custom Split — Choose Quantities</div>
                <div style={{fontSize:12,color:'#475569'}}>Enter exact number of units per garment to split into a new job.</div>
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

            {/* Custom split — enter quantities */}
            {splitModal.mode==='custom'&&(()=>{
              const cq=splitModal.customQtys||{};
              const totalSplit=items.reduce((a,gi)=>a+Math.min(safeNum(cq[gi.item_idx]),gi.units),0);
              const totalRemain=j.total_units-totalSplit;
              return<div>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Enter units to split off per garment:</div>
                {items.map((gi,i)=><div key={i} style={{padding:10,border:'1px solid #e2e8f0',borderRadius:6,marginBottom:6,display:'flex',gap:10,alignItems:'center',background:safeNum(cq[gi.item_idx])>0?'#faf5ff':'white'}}>
                  <div style={{flex:1}}>
                    <div><span style={{fontWeight:700,fontSize:12}}>{gi.sku}</span> <span style={{fontSize:12}}>{gi.name}</span> <span style={{color:'#94a3b8',fontSize:11}}>({gi.color})</span></div>
                    <div style={{fontSize:10,color:'#64748b'}}>{gi.units} total · {gi.received} received</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" className="form-input" min={0} max={gi.units} value={cq[gi.item_idx]||''} placeholder="0"
                      style={{width:70,fontSize:13,fontWeight:700,textAlign:'center'}}
                      onChange={e=>setSplitModal(m=>({...m,customQtys:{...m.customQtys,[gi.item_idx]:Math.min(parseInt(e.target.value)||0,gi.units)}}))}/>
                    <span style={{fontSize:11,color:'#64748b'}}>/ {gi.units}</span>
                  </div>
                </div>)}
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
            {splitModal.mode==='custom'&&(()=>{const cq=splitModal.customQtys||{};const ts=items.reduce((a,gi)=>a+Math.min(safeNum(cq[gi.item_idx]),gi.units),0);const tr=j.total_units-ts;return ts>0&&tr>0?<button className="btn btn-primary" style={{background:'#7c3aed',borderColor:'#7c3aed'}} onClick={()=>splitCustom(splitModal.jIdx,cq)}>✂️ Split {ts} Units</button>:null})()}
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
          const updatedJobs=jobs.map((jj,i)=>i===artReqModal.jIdx?{...jj,art_requests:[...(jj.art_requests||[]),req],art_status:(jj.art_status==='needs_art'||jj.art_status==='waiting_approval'||jj.art_status==='production_files_needed')?'art_requested':jj.art_status,assigned_artist:artReqModal.artist||jj.assigned_artist}:jj);
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
        safePicks(it).forEach((pk,pi)=>{if(pk.pick_id&&!allPickIds.find(x=>x.id===pk.pick_id)){
          const qty=Object.entries(pk).reduce((a,[k,v])=>k!=='status'&&k!=='pick_id'&&typeof v==='number'?a+v:a,0);
          const itemTotal=qty*it.unit_sell;
          allPickIds.push({id:pk.pick_id,status:pk.status||'pick',qty,lineIdx:i,pickIdx:pi,sku:it.sku,name:it.name,color:it.color,total:itemTotal,created_at:pk.created_at,memo:pk.memo})}});
        safePOs(it).forEach((po,pi)=>{if(po.po_id){
          const szKeysP=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='created_at'&&k!=='memo'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='drop_ship'&&typeof po[k]==='number');
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
            {allPickIds.map(pk=><div key={pk.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',background:pk.status==='pulled'?'#f0fdf4':'#fffbeb',transition:'box-shadow 0.15s'}} className="hover-card" onClick={()=>{const pickData=o.items[pk.lineIdx]?.pick_lines?.[pk.pickIdx];if(pickData)setEditPick({lineIdx:pk.lineIdx,pickIdx:pk.pickIdx,pick:pickData})}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Icon name="grid" size={14}/><span style={{fontWeight:800,color:'#1e40af',fontSize:14}}>{pk.id}</span>
                <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`} style={{fontSize:9}}>{pk.status==='pulled'?'✓ Pulled':'Needs Pull'}</span>
                <span style={{marginLeft:'auto',fontWeight:700,fontSize:14,color:'#166534'}}>${pk.total.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,color:'#64748b'}}>
                <span><strong style={{color:'#1e40af'}}>{pk.sku}</strong> {pk.name}</span>
                <span>{pk.color}</span>
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

    {/* EDIT PICK MODAL */}
    {editPick&&(()=>{
      const pk=editPick.pick;const item=o.items[editPick.lineIdx];
      const pkSzKeys=Object.keys(pk).filter(k=>k!=='status'&&k!=='pick_id'&&typeof pk[k]==='number'&&pk[k]>0);
      const pkTotal=pkSzKeys.reduce((a,sz)=>a+(pk[sz]||0),0);
      const qrData=window.location.origin+window.location.pathname+'?scan='+encodeURIComponent(pk.pick_id);
      return<div className="modal-overlay" onClick={()=>setEditPick(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
      <div className="modal-header"><h2>Pick — {pk.pick_id||'Pick'}</h2>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span className={`badge ${pk.status==='pulled'?'badge-green':'badge-amber'}`}>{pk.status==='pulled'?'Pulled':'Needs Pull'}</span>
          <button className="modal-close" onClick={()=>setEditPick(null)}>x</button>
        </div></div>
      <div className="modal-body">
        {/* Ship Destination */}
        {pk.ship_dest&&pk.ship_dest!=='in_house'&&<div style={{padding:'10px 14px',marginBottom:12,borderRadius:8,border:'2px solid '+(pk.ship_dest==='ship_customer'?'#3b82f6':'#d97706'),background:pk.ship_dest==='ship_customer'?'#eff6ff':'#fffbeb'}}>
          <div style={{fontSize:12,fontWeight:800,color:pk.ship_dest==='ship_customer'?'#1e40af':'#92400e'}}>{pk.ship_dest==='ship_customer'?'📦 Ship to Customer':'🚚 Ship to Deco'}</div>
          {pk.ship_dest==='ship_customer'&&(()=>{const addr=addrs.find(a=>a.id===pk.ship_addr)||addrs[0];return addr?<div style={{fontSize:12,color:'#475569',marginTop:4}}>{addr.label}</div>:null})()}
          {pk.ship_dest==='ship_deco'&&pk.deco_vendor&&<div style={{fontSize:12,color:'#475569',marginTop:4}}>Vendor: {pk.deco_vendor}</div>}
        </div>}
        {pk.ship_dest==='in_house'&&<div style={{padding:'8px 14px',marginBottom:12,borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#475569'}}>🏭 In-House Deco</div>
        </div>}
        {/* Product info */}
        {item&&<div style={{padding:'8px 12px',background:'#f8fafc',borderRadius:6,marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontFamily:'monospace',fontWeight:800,color:'#1e40af',background:'#dbeafe',padding:'2px 8px',borderRadius:4,fontSize:13}}>{item.sku}</span>
          <span style={{fontWeight:600,fontSize:13}}>{item.name}</span>
          <span className="badge badge-gray">{item.color}</span>
        </div>}
        <div style={{marginBottom:12}}><label className="form-label">Status</label>
          <div style={{display:'flex',gap:6}}>{['pick','pulled'].map(s=><button key={s} className={`btn btn-sm ${pk.status===s?'btn-primary':'btn-secondary'}`} onClick={()=>setEditPick(p=>({...p,pick:{...p.pick,status:s}}))}>{s==='pulled'?'✓ Pulled':'Needs Pull'}</button>)}</div></div>
        <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:6}}>Quantities by size:</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          {pkSzKeys.map(sz=><div key={sz} style={{textAlign:'center'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
            <input style={{width:42,textAlign:'center',border:'1px solid #d1d5db',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700}} defaultValue={pk[sz]} onChange={e=>setEditPick(p=>({...p,pick:{...p.pick,[sz]:parseInt(e.target.value)||0}}))}/>
          </div>)}
          <div style={{textAlign:'center',borderLeft:'2px solid #e2e8f0',paddingLeft:8}}><div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>TOT</div><div style={{fontSize:18,fontWeight:800}}>{pkTotal}</div></div>
        </div>
        {/* QR / Print Label */}
        <div style={{padding:12,border:'1px dashed #d1d5db',borderRadius:8,background:'#fafafa'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>📋 Label / QR Code</div>
          <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
            <div style={{padding:8,background:'white',border:'1px solid #e2e8f0',borderRadius:6}}>
              <img src={'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data='+encodeURIComponent(qrData)} alt="QR" style={{width:80,height:80,display:'block'}}/>
            </div>
            <div style={{flex:1,fontSize:11}}>
              <div style={{fontWeight:800,fontSize:14}}>{pk.pick_id}</div>
              <div style={{color:'#64748b'}}>{o.id} — {cust?.name}</div>
              <div style={{fontWeight:600}}>{item?.sku} {item?.name}</div>
              <div>{item?.color} — {pkTotal} units</div>
              <div style={{marginTop:4}}>{pkSzKeys.map(sz=>sz+':'+pk[sz]).join('  ')}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>{
            const w=window.open('','_blank','width=400,height=300');
            w.document.write('<html><head><title>'+pk.pick_id+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:24px;margin:0}p{margin:4px 0;font-size:14px}.sz{font-size:16px;font-weight:bold}</style></head><body>');
            w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(qrData)+'" width="120" height="120"/><div>');
            w.document.write('<h1>'+pk.pick_id+'</h1><p>'+o.id+' — '+(cust?.name||'')+'</p>');
            if(pk.ship_dest&&pk.ship_dest!=='in_house'){const destLabel=pk.ship_dest==='ship_customer'?'SHIP TO CUSTOMER':'SHIP TO DECO'+(pk.deco_vendor?' — '+pk.deco_vendor:'');const addr=pk.ship_dest==='ship_customer'?(addrs.find(a=>a.id===pk.ship_addr)||addrs[0])?.label||'':'';w.document.write('<p style="background:#fffbeb;padding:8px;border:2px solid '+(pk.ship_dest==='ship_customer'?'#3b82f6':'#d97706')+';border-radius:6px;font-weight:bold;font-size:16px">'+destLabel+(addr?' — '+addr:'')+'</p>')}
            w.document.write('<p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong></p><p>'+(item?.color||'')+' — '+pkTotal+' units</p>');
            w.document.write('<p class="sz">'+pkSzKeys.map(sz=>sz+': '+pk[sz]).join(' &nbsp; ')+'</p>');
            w.document.write('</div></div></body></html>');w.document.close();w.print();
          }}>🖨️ Print Label</button>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={()=>setEditPick(null)}>Close</button>
        <button className="btn btn-sm" style={{background:'#dc2626',color:'white'}} onClick={()=>{
          const oldPick=o.items[editPick.lineIdx].pick_lines[editPick.pickIdx];
          const item=o.items[editPick.lineIdx];
          if(oldPick.status==='pulled'){adjustInvForPick(oldPick,item,1)}
          const updatedItems=[...o.items];updatedItems[editPick.lineIdx].pick_lines=updatedItems[editPick.lineIdx].pick_lines.filter((_,i)=>i!==editPick.pickIdx);
          const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};setO(updated);onSave(updated);setEditPick(null);nf('Pick deleted');
        }}><Icon name="trash" size={12}/> Delete</button>
        <button className="btn btn-primary" onClick={()=>{
          const oldPick=o.items[editPick.lineIdx].pick_lines[editPick.pickIdx];
          const newPick=editPick.pick;
          const item=o.items[editPick.lineIdx];
          // Adjust inventory if status changed
          if(oldPick.status!=='pulled'&&newPick.status==='pulled'){adjustInvForPick(newPick,item,-1)}
          else if(oldPick.status==='pulled'&&newPick.status!=='pulled'){adjustInvForPick(oldPick,item,1)}
          const updatedItems=[...o.items];updatedItems[editPick.lineIdx].pick_lines[editPick.pickIdx]=newPick;
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
      const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='billed'&&k!=='tracking_numbers'&&k!=='unit_cost'&&k!=='vendor'&&k!=='drop_ship'&&typeof po[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
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
      const qrData=window.location.origin+window.location.pathname+'?scan='+encodeURIComponent(po.po_id);

      return<div className="modal-overlay" onClick={()=>setEditPO(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:750,maxHeight:'90vh',overflow:'auto'}}>
        <div className="modal-header"><h2>PO — {po.po_id||'PO'}</h2>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {isDropShip&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,background:'#ede9fe',color:'#7c3aed'}}>Drop Ship</span>}
            <span className={`badge ${poStatus==='received'||poStatus==='shipped'?'badge-green':poStatus==='partial'?'badge-amber':'badge-gray'}`}>{poStatus==='shipped'?'Shipped':poStatus==='received'?'Fully Received':poStatus==='partial'?(isDropShip?totalBilled+'/'+totalOrdered+' Billed':'Partial — '+totalOpen+' open'):'Waiting'}</span>
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
          {(()=>{const unitCost=po.po_type==='outside_deco'?safeNum(po.unit_cost):safeNum(item?.nsa_cost);const poTotal=totalOrdered*unitCost;const rcvdTotal=totalReceived*unitCost;const openTotal=totalOpen*unitCost;return<>
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
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#f0f9ff',borderRadius:6,marginBottom:12}}>
            <div style={{display:'flex',gap:16,fontSize:12}}>
              <span style={{color:'#64748b'}}>Unit Cost: <strong style={{color:'#0f172a'}}>${unitCost.toFixed(2)}</strong></span>
              {po.po_type==='outside_deco'&&<span className="badge badge-blue" style={{fontSize:10}}>Decoration PO</span>}
            </div>
            <div style={{fontWeight:800,fontSize:16,color:'#0f172a'}}>PO Total: ${poTotal.toFixed(2)}</div>
          </div></>})()}

          {/* Cancel sizes from PO */}
          {hasOpen&&<div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',gap:4}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}}>
              ⚠️ <span style={{textDecoration:'underline'}}>Cancel sizes from this PO</span> <span style={{fontSize:9}}>(vendor cancelled / shorted)</span>
            </div>
            <div style={{display:'none',marginTop:8,padding:10,border:'1px dashed #f59e0b',borderRadius:6,background:'#fffbeb'}}>
              <div style={{fontSize:11,color:'#92400e',marginBottom:6}}>Enter quantities to cancel (these sizes will become available for new picks/POs):</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-cancel-'+sz} style={{width:42,textAlign:'center',border:'1px solid #f59e0b',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={0}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
                </div>)}
              </div>
              <button className="btn btn-sm" style={{background:'#f59e0b',color:'white',fontSize:11}} onClick={()=>{
                const newCancelled={...cancelled};
                let anyCancelled=false;
                szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-cancel-'+sz);
                  const qty=el?Math.min(parseInt(el.value)||0,getOpen(sz)):0;
                  if(qty>0){newCancelled[sz]=(newCancelled[sz]||0)+qty;anyCancelled=true}
                });
                if(!anyCancelled){nf('Enter quantities to cancel','error');return}
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(received[sz]||0)-(newCancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
                const updatedPO={...po,cancelled:newCancelled,status:newStatus};
                const updatedItems=[...o.items];updatedItems[activeLine.lineIdx].po_lines[activeLine.poIdx]=updatedPO;
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO});nf('Sizes cancelled from '+po.po_id);
              }}>⚠️ Cancel These Sizes</button>
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
                const w=window.open('','_blank','width=400,height=300');
                w.document.write('<html><head><title>'+po.po_id+' Recv #'+(si+1)+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:22px;margin:0}p{margin:4px 0;font-size:13px}.sz{font-size:15px;font-weight:bold}</style></head><body>');
                w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(shQrData)+'" width="120" height="120"/><div>');
                w.document.write('<h1>'+po.po_id+' — Shipment #'+(si+1)+'</h1><p>Received: '+sh.date+'</p><p>'+o.id+' — '+(cust?.name||'')+'</p><p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')+'</p>');
                w.document.write('<p class="sz">'+szKeys.filter(sz=>sh[sz]).map(sz=>sz+': '+sh[sz]).join(' &nbsp; ')+'</p>');
                w.document.write('</div></div></body></html>');w.document.close();w.print();
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
                  const newShipments=[...shipments];newShipments[si]=updatedSh;
                  const newReceived={};newShipments.forEach(s=>{szKeys.forEach(sz=>{if(s[sz])newReceived[sz]=(newReceived[sz]||0)+s[sz]})});
                  const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
                  const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                  const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                  const updatedItems=[...o.items];updatedItems[activeLine.lineIdx].po_lines[activeLine.poIdx]=updatedPO;
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
                  const updatedItems=[...o.items];updatedItems[activeLine.lineIdx].po_lines[activeLine.poIdx]=updatedPO;
                  const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                  setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO,_editShipIdx:null});nf('Shipment deleted');
                }}><Icon name="trash" size={10}/> Delete</button>
                <button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>setEditPO(p=>({...p,_editShipIdx:null}))}>Cancel</button>
              </div>
            </div>}
            </div>})}
          </>}

          {/* Receive shipment form — not for drop ship POs */}
          {hasOpen&&!isDropShip&&<div key={'recv-'+activeLineIdx} style={{marginTop:12,padding:12,border:'2px solid #22c55e',borderRadius:8,background:'#f0fdf4'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:8}}>Receive Shipment</div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Date:</span>
              <input type="date" id="po-recv-date" className="form-input" style={{width:140,fontSize:12}} defaultValue={new Date().toISOString().split('T')[0]}/>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b',width:40}}>Qty:</span>
              {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                <input id={'po-recv-'+sz} style={{width:42,textAlign:'center',border:'1px solid #22c55e',borderRadius:4,padding:'4px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getOpen(sz)} onChange={e=>{const v=parseInt(e.target.value)||0;e.target.style.borderColor=v>getOpen(sz)?'#dc2626':'#22c55e';e.target.style.background=v>getOpen(sz)?'#fef2f2':'white'}}/>
                <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
              </div>)}
            </div>
            <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>{
              const dateEl=document.getElementById('po-recv-date');
              const date=dateEl?.value||new Date().toLocaleDateString();
              const shipment={date};
              const newReceived={...received};
              szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                const el=document.getElementById('po-recv-'+sz);
                const qty=el?parseInt(el.value)||0:0;
                if(qty>0){shipment[sz]=qty;newReceived[sz]=(newReceived[sz]||0)+qty}
              });
              const hasShipQty=Object.entries(shipment).some(([k,v])=>k!=='date'&&v>0);
              if(!hasShipQty){nf('Enter quantities to receive','error');return}
              // Check for over-receive (misship warning)
              const overSizes=[];
              szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                const el=document.getElementById('po-recv-'+sz);
                const qty=el?parseInt(el.value)||0:0;
                if(qty>getOpen(sz))overSizes.push(sz+': receiving '+qty+' but only '+getOpen(sz)+' open');
              });
              if(overSizes.length>0&&!window.confirm('⚠️ MISSHIP WARNING — Receiving more than ordered:\n\n'+overSizes.join('\n')+'\n\nProceed anyway?'))return;
              const newShipments=[...shipments,shipment];
              const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-getCncl(sz)),0);
              const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':newTotalOpen>0?'partial':'waiting';
              const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
              const updatedItems=[...o.items];updatedItems[activeLine.lineIdx].po_lines[activeLine.poIdx]=updatedPO;
              const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
              setO(updated);onSave(updated);setEditPO({...editPO,po:updatedPO});nf('Shipment received on '+po.po_id);
            }}>✓ Receive These Items</button>
          </div>}

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
              const w=window.open('','_blank','width=500,height=400');
              w.document.write('<html><head><title>'+po.po_id+'</title><style>body{font-family:sans-serif;padding:20px}h1{font-size:24px;margin:0}p{margin:4px 0;font-size:14px}.sz{font-size:14px;font-weight:bold}.g{color:#166534}.a{color:#b45309}</style></head><body>');
              w.document.write('<div style="display:flex;gap:20px;align-items:flex-start"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(qrData)+'" width="120" height="120"/><div>');
              w.document.write('<h1>'+po.po_id+'</h1><p>'+o.id+' — '+(cust?.name||'')+'</p><p><strong>'+(item?.sku||'')+' '+(item?.name||'')+'</strong> — '+(item?.color||'')+'</p>');
              w.document.write('<p>'+totalOrdered+' ordered'+(totalReceived>0?' · '+totalReceived+' received':'')+'</p>');
              w.document.write('<p class="sz">Ordered: '+szKeys.map(sz=>sz+': '+po[sz]).join(' &nbsp; ')+'</p>');
              if(totalReceived>0)w.document.write('<p class="sz g">Received: '+szKeys.filter(sz=>getRcvd(sz)>0).map(sz=>sz+': '+getRcvd(sz)).join(' &nbsp; ')+'</p>');
              if(totalOpen>0)w.document.write('<p class="sz a">Open: '+szKeys.filter(sz=>getOpen(sz)>0).map(sz=>sz+': '+getOpen(sz)).join(' &nbsp; ')+'</p>');
              w.document.write('</div></div></body></html>');w.document.close();w.print();
            }}>🖨️ Print PO Label</button>
            <button className="btn btn-sm btn-primary" style={{marginTop:8,marginLeft:6,fontSize:11}} onClick={()=>{
              const vendor=po.po_type==='outside_deco'?(po.deco_vendor||'Outside Decorator'):(D_V.find(v=>v.id===item?.vendor_id)?.name||item?.brand||'Vendor');
              const isDPO=po.po_type==='outside_deco';
              const szHeaders=szKeys.filter(sz=>po[sz]>0);
              printDoc({
                title:vendor,docNum:po.po_id,
                docType:isDPO?'DECORATION PURCHASE ORDER':'PURCHASE ORDER',
                headerRight:'<div class="ta" style="font-size:18px">Status: '+(poStatus==='received'?'Received':poStatus==='partial'?'Partial':'Open')+'</div>',
                infoBoxes:[
                  {label:'Vendor',value:vendor,sub:isDPO?(po.deco_type||'').replace(/_/g,' '):undefined},
                  {label:'Ship To',value:_ci.name,sub:_ci.fullAddr},
                  {label:'Sales Order',value:o.id,sub:(cust?.name||'')+(o.memo?' — '+o.memo:'')},
                  {label:'Expected Date',value:o.expected_date||'TBD',sub:'Rep: '+(REPS.find(r=>r.id===o.created_by)?.name||'—')},
                ],
                tables:[{
                  title:item?.sku+' — '+(item?.name||'')+(item?.color?' · '+item.color:''),
                  headers:['Size',...szHeaders.map(s=>s),'Total'],
                  aligns:['left',...szHeaders.map(()=>'center'),'center'],
                  rows:[
                    {cells:[{value:'<strong>Ordered</strong>',style:'font-weight:700'},...szHeaders.map(s=>({value:po[s]||0,style:(po[s]>0?'font-weight:800;color:#1e3a5f':'')})),{value:totalOrdered,style:'font-weight:800'}]},
                    ...(totalBilled>0?[{cells:[{value:'Billed',style:'color:#1e40af'},...szHeaders.map(s=>({value:getBilled(s)||'—',style:'color:#1e40af'})),{value:totalBilled,style:'color:#1e40af;font-weight:700'}]}]:[]),
                    ...(totalReceived>0?[{cells:[{value:'Received',style:'color:#166534'},...szHeaders.map(s=>({value:getRcvd(s)||'—',style:'color:#166534'})),{value:totalReceived,style:'color:#166534;font-weight:700'}]}]:[]),
                    ...(totalOpen>0?[{cells:[{value:'Open',style:'color:#b45309'},...szHeaders.map(s=>({value:getOpen(s)||'—',style:'color:#b45309'})),{value:totalOpen,style:'color:#b45309;font-weight:700'}]}]:[]),
                  ]
                }],
                notes:isDPO?('Deco Type: '+(po.deco_type||'—').replace(/_/g,' ')+(po.notes?'<br/>'+po.notes:'')):(po.notes||null),
                footer:isDPO?'Expected return: '+(po.expected_date||'TBD'):null
              });
            }}>🖨️ Print Full PO</button>
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

    {/* PO FULL PAGE VIEW */}
    {poFullPage&&(()=>{
      const{po,item,allLines,soId,soItems}=poFullPage;
      const szKeys=Object.keys(po).filter(k=>!k.startsWith('_')&&k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='unit_cost'&&k!=='drop_ship'&&typeof po[k]==='number').sort((a,b)=>(SZ_ORD.indexOf(a)===-1?99:SZ_ORD.indexOf(a))-(SZ_ORD.indexOf(b)===-1?99:SZ_ORD.indexOf(b)));
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
        const sk=Object.keys(p).filter(k=>k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='unit_cost'&&k!=='drop_ship'&&typeof p[k]==='number');
        const qty=sk.reduce((s,sz)=>s+(p[sz]||0),0);const uc=p.unit_cost!=null?safeNum(p.unit_cost):safeNum(it.nsa_cost);return a+qty*uc},0);
      return<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#f1f5f9',zIndex:9999,overflow:'auto'}}>
        <div style={{maxWidth:900,margin:'0 auto',padding:'24px 20px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPoFullPage(null)}>&larr; Back</button>
              <h1 style={{margin:0,fontSize:22}}>{po.po_id} {poFullPage.customerTag||''}</h1>
              <span className={`badge ${poStatus==='received'||poStatus==='shipped'?'badge-green':poStatus==='partial'?'badge-amber':'badge-gray'}`} style={{fontSize:11}}>{poStatus==='shipped'?'Shipped':poStatus==='received'?'Fully Received':poStatus==='partial'?'Partial':'Waiting'}</span>
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
              <div><div style={{fontSize:11,opacity:0.7}}>Total Units</div><div style={{fontSize:24,fontWeight:800}}>{totalOrdered}</div></div>
              {isDropShipFP?<div><div style={{fontSize:11,opacity:0.7}}>Billed</div><div style={{fontSize:24,fontWeight:800,color:totalBilledFP>=totalOrdered?'#4ade80':'#fbbf24'}}>{totalBilledFP}</div></div>
              :<div><div style={{fontSize:11,opacity:0.7}}>Received</div><div style={{fontSize:24,fontWeight:800,color:'#4ade80'}}>{totalReceived}</div></div>}
              {!isDropShipFP&&<div><div style={{fontSize:11,opacity:0.7}}>Open</div><div style={{fontSize:24,fontWeight:800,color:totalOpen>0?'#fbbf24':'#4ade80'}}>{totalOpen}</div></div>}
              <div><div style={{fontSize:11,opacity:0.7}}>Unit Cost</div><div style={{fontSize:24,fontWeight:800}}>${unitCost.toFixed(2)}</div></div>
              <div><div style={{fontSize:11,opacity:0.7}}>PO Total</div><div style={{fontSize:24,fontWeight:800,color:'#38bdf8'}}>${grandTotal.toFixed(2)}</div></div>
            </div>
          </div>

          {/* Items on this PO */}
          <div className="card" style={{marginBottom:16}}>
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
                    const sk=Object.keys(p).filter(k=>k!=='status'&&k!=='po_id'&&k!=='received'&&k!=='shipments'&&k!=='cancelled'&&k!=='po_type'&&k!=='deco_vendor'&&k!=='deco_type'&&k!=='created_at'&&k!=='memo'&&k!=='notes'&&k!=='expected_date'&&k!=='unit_cost'&&k!=='drop_ship'&&typeof p[k]==='number');
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
                    <td style={{padding:'6px 8px',textAlign:'center'}}>{totalOrdered}</td>
                    <td></td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontSize:16,color:'#166534'}}>${grandTotal.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Size Breakdown */}
          <div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>Size Breakdown</h2></div>
            <div className="card-body">
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead><tr style={{borderBottom:'2px solid #0f172a'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}></th>{szKeys.map(sz=><th key={sz} style={{padding:'4px 8px',textAlign:'center',minWidth:48}}>{sz}</th>)}<th style={{padding:'4px 8px',textAlign:'center'}}>TOTAL</th></tr></thead>
                <tbody>
                  <tr><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Ordered</td>{szKeys.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700}}>{po[sz]||0}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{totalOrdered}</td></tr>
                  {isDropShipFP?<tr style={{color:'#1e40af'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Billed</td>{szKeys.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:((po.billed||{})[sz]||0)>0?'#1e40af':'#d1d5db'}}>{(po.billed||{})[sz]||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{totalBilledFP}</td></tr>
                  :<tr style={{color:'#166534'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Received</td>{szKeys.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:getRcvd(sz)>0?'#166534':'#d1d5db'}}>{getRcvd(sz)||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{totalReceived}</td></tr>}
                  {totalCancelled>0&&<tr style={{color:'#dc2626'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Cancelled</td>{szKeys.map(sz=><td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:getCncl(sz)>0?'#dc2626':'#d1d5db'}}>{getCncl(sz)||'—'}</td>)}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{totalCancelled}</td></tr>}
                  {totalOpen>0&&!isDropShipFP&&<tr style={{borderTop:'1px solid #e2e8f0',color:'#b45309'}}><td style={{padding:'4px 8px',fontSize:11,fontWeight:600}}>Open</td>{szKeys.map(sz=>{const op=getOpen(sz);return<td key={sz} style={{padding:'4px 8px',textAlign:'center',fontWeight:700,color:op>0?'#b45309':'#d1d5db'}}>{op>0?op:'—'}</td>})}<td style={{padding:'4px 8px',textAlign:'center',fontWeight:800}}>{totalOpen}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

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

          {/* Shipment History */}
          {shipments.length>0&&<div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>{isDropShipFP?'Billing':'Shipment'} History ({shipments.length})</h2></div>
            <div className="card-body">
              {shipments.map((sh,si)=>{const shQty=Object.entries(sh.qty||{}).reduce((a,[,v])=>a+safeNum(v),0);return<div key={si} style={{padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:6,marginBottom:8,background:si%2===0?'#f8fafc':'#fff'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:13}}>Shipment #{si+1}</span>
                  <span style={{fontSize:12,color:'#64748b'}}>{sh.date||'No date'}</span>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',fontSize:12}}>
                  {Object.entries(sh.qty||{}).filter(([,v])=>v>0).map(([sz,q])=><span key={sz} style={{padding:'2px 8px',background:'#dcfce7',color:'#166534',borderRadius:4,fontWeight:600}}>{sz}: {q}</span>)}
                  <span style={{fontWeight:700}}>({shQty} units)</span>
                </div>
                {sh.memo&&<div style={{fontSize:11,color:'#475569',marginTop:4,fontStyle:'italic'}}>{sh.memo}</div>}
              </div>})}
            </div>
          </div>}

          {po.memo&&<div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h2>Notes</h2></div>
            <div className="card-body"><p style={{margin:0,fontSize:13,color:'#475569'}}>{po.memo}</p></div>
          </div>}

          {/* Receive Shipment — inline on full page */}
          {totalOpen>0&&!isDropShipFP&&<div className="card" style={{marginBottom:16,borderLeft:'3px solid #22c55e'}}>
            <div className="card-header" style={{background:'#f0fdf4'}}><h2 style={{color:'#166534'}}>Receive Shipment</h2></div>
            <div className="card-body">
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Date:</span>
                <input type="date" id="po-fp-recv-date" className="form-input" style={{width:150,fontSize:12}} defaultValue={new Date().toISOString().split('T')[0]}/>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Qty:</span>
                {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-fp-recv-'+sz} style={{width:48,textAlign:'center',border:'1px solid #22c55e',borderRadius:4,padding:'5px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={getOpen(sz)}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
                </div>)}
              </div>
              <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>{
                const dateEl=document.getElementById('po-fp-recv-date');
                const date=dateEl?.value||new Date().toLocaleDateString();
                const shipment={date};
                const newReceived={...received};
                szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-fp-recv-'+sz);
                  const qty=el?parseInt(el.value)||0:0;
                  if(qty>0){shipment[sz]=qty;newReceived[sz]=(newReceived[sz]||0)+qty}
                });
                const hasShipQty=Object.entries(shipment).some(([k,v])=>k!=='date'&&v>0);
                if(!hasShipQty){nf('Enter quantities to receive','error');return}
                const newShipments=[...shipments,shipment];
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(newReceived[sz]||0)-(cancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&Object.values(newReceived).some(v=>v>0)?'received':Object.values(newReceived).some(v=>v>0)?'partial':'waiting';
                const updatedPO={...po,received:newReceived,shipments:newShipments,status:newStatus};
                const lineIdx=allLines?.[0]?.lineIdx||0;
                const poIdx=soItems?.[lineIdx]?.po_lines?.findIndex(p=>p.po_id===po.po_id)||0;
                const updatedItems=[...o.items];updatedItems[lineIdx].po_lines[poIdx]=updatedPO;
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setPoFullPage({...poFullPage,po:updatedPO});nf('Shipment received on '+po.po_id);
              }}>Receive These Items</button>
            </div>
          </div>}

          {/* Cancel sizes */}
          {totalOpen>0&&!isDropShipFP&&<div className="card" style={{marginBottom:16,borderLeft:'3px solid #f59e0b'}}>
            <div className="card-header" style={{background:'#fffbeb',cursor:'pointer'}} onClick={e=>{const el=e.currentTarget.nextSibling;if(el)el.style.display=el.style.display==='none'?'block':'none'}}><h2 style={{color:'#92400e',fontSize:14}}>Cancel Sizes from PO</h2></div>
            <div className="card-body" style={{display:'none'}}>
              <div style={{fontSize:12,color:'#92400e',marginBottom:8}}>Enter quantities to cancel (these sizes will become available for new picks/POs):</div>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                {szKeys.filter(sz=>getOpen(sz)>0).map(sz=><div key={sz} style={{textAlign:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569'}}>{sz}</div>
                  <input id={'po-fp-cancel-'+sz} style={{width:48,textAlign:'center',border:'1px solid #f59e0b',borderRadius:4,padding:'5px 2px',fontSize:14,fontWeight:700,background:'white'}} defaultValue={0}/>
                  <div style={{fontSize:9,color:'#64748b'}}>{getOpen(sz)} open</div>
                </div>)}
              </div>
              <button className="btn btn-sm" style={{background:'#f59e0b',color:'white',fontSize:12}} onClick={()=>{
                const newCancelled={...cancelled};let anyCancelled=false;
                szKeys.filter(sz=>getOpen(sz)>0).forEach(sz=>{
                  const el=document.getElementById('po-fp-cancel-'+sz);
                  const qty=el?Math.min(parseInt(el.value)||0,getOpen(sz)):0;
                  if(qty>0){newCancelled[sz]=(newCancelled[sz]||0)+qty;anyCancelled=true}
                });
                if(!anyCancelled){nf('Enter quantities to cancel','error');return}
                const newTotalOpen=szKeys.reduce((a,sz)=>a+Math.max(0,(po[sz]||0)-(received[sz]||0)-(newCancelled[sz]||0)),0);
                const newStatus=newTotalOpen<=0&&totalReceived>0?'received':totalReceived>0?'partial':'waiting';
                const updatedPO={...po,cancelled:newCancelled,status:newStatus};
                const lineIdx=allLines?.[0]?.lineIdx||0;
                const poIdx=soItems?.[lineIdx]?.po_lines?.findIndex(p=>p.po_id===po.po_id)||0;
                const updatedItems=[...o.items];updatedItems[lineIdx].po_lines[poIdx]=updatedPO;
                const updated={...o,items:updatedItems,updated_at:new Date().toLocaleString()};
                setO(updated);onSave(updated);setPoFullPage({...poFullPage,po:updatedPO});nf('Sizes cancelled from '+po.po_id);
              }}>Cancel These Sizes</button>
            </div>
          </div>}

          {/* Delete PO */}
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:24}}>
            <button className="btn btn-sm btn-secondary" style={{fontSize:11,color:'#dc2626',borderColor:'#fca5a5'}} onClick={()=>{
              if(!window.confirm('Delete entire PO? All sizes will go back to open.'))return;
              const lineIdx=allLines?.[0]?.lineIdx||0;
              const updatedItems=[...o.items];
              (allLines||[{lineIdx}]).forEach(ln=>{
                const pidx=updatedItems[ln.lineIdx]?.po_lines?.findIndex(p=>p.po_id===po.po_id);
                if(pidx>=0)updatedItems[ln.lineIdx].po_lines.splice(pidx,1);
              });
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
        const matches=sq.length>=2?products.filter(p=>p.sku.toLowerCase().includes(sq)||p.name.toLowerCase().includes(sq)||p.brand?.toLowerCase().includes(sq)||p.color?.toLowerCase().includes(sq)).slice(0,8):[];
        return<div className="modal-overlay" style={{zIndex:10001}} onClick={()=>setCopySkuModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:480}}>
          <div className="modal-header"><h2>Copy Item → New SKU</h2><button className="modal-close" onClick={()=>setCopySkuModal(null)}>×</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12,fontSize:12}}>
              <div style={{fontWeight:700}}>Copying from: {srcIt.sku} — {srcIt.name}</div>
              <div style={{color:'#64748b'}}>{safeDecos(srcIt).length} decoration(s) + sizes will carry over</div>
            </div>
            <label className="form-label">Search for new product/SKU</label>
            <input className="form-input" placeholder="Type SKU, name, or brand..." value={copySkuModal.search||''} onChange={e=>setCopySkuModal(m=>({...m,search:e.target.value}))} autoFocus/>
            {matches.length>0&&<div style={{maxHeight:240,overflowY:'auto',marginTop:8,border:'1px solid #e2e8f0',borderRadius:8}}>
              {matches.map(p=><div key={p.id} style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}} onClick={()=>copyIWithSku(copySkuModal.itemIdx,p)} onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                <div><span style={{fontFamily:'monospace',fontWeight:700,color:'#1e40af'}}>{p.sku}</span> <span style={{fontWeight:600}}>{p.name}</span>{p.color&&<span style={{color:'#64748b',fontSize:11}}> — {p.color}</span>}</div>
                <span className="badge badge-blue" style={{fontSize:9}}>{p.brand}</span>
              </div>)}
            </div>}
            {sq.length>=2&&matches.length===0&&<div style={{textAlign:'center',padding:16,color:'#94a3b8',fontSize:12}}>No products found</div>}
          </div>
        </div></div>})()}

  </div>);
}



export default OrderEditor;
