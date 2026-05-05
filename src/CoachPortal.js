/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { SZ_ORD, pantoneHex, NSA } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs, safeFirm, safeArt } from './safeHelpers';
import { calcSOStatus } from './components';
import { dP, rQ, SP } from './pricing';
import { sendBrevoEmail, _brevoKey, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, printDoc, buildDocHtml, getBillingContacts } from './utils';

function CoachPortal({customer,allCustomers,sos,ests,invs:initInvs,REPS,prod,onUpdateInvs,onUpdateSOs,onUpdateEsts,savSOFn,portalSettings,dbSaveEstimate:_dbSaveEstimate}){
  const _portalDisclaimer=portalSettings?.disclaimer||'';
  const[jobView,setJobView]=useState(null);
  const[invView,setInvView]=useState(null);
  const[estView,setEstView]=useState(null);
  const[soView,setSoView]=useState(null);
  const[comment,setComment]=useState('');
  const[contactEdit,setContactEdit]=useState(null);
  const[contactMsg,setContactMsg]=useState('');
  const[updateRequestText,setUpdateRequestText]=useState('');
  const[updateRequestSent,setUpdateRequestSent]=useState(false);
  const[showPay,setShowPay]=useState(null);// null | 'all' | inv object
  const[payLoading,setPayLoading]=useState(false);// loading state for pay button feedback
  const[paySuccess,setPaySuccess]=useState(null);// {amount,fee,invoices}
  const[invs,setInvs]=useState(initInvs);
  const[lightbox,setLightbox]=useState(null);// url string for lightbox overlay
  useEffect(()=>setInvs(initInvs),[initInvs]);
  const isP=!customer.parent_id;
  const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const custSOs=sos.filter(s=>ids.includes(s.customer_id));
  const custEsts=ests.filter(e=>ids.includes(e.customer_id));
  const activeSOs=custSOs.filter(s=>calcSOStatus(s)!=='complete');
  const completedSOs=custSOs.filter(s=>calcSOStatus(s)==='complete');
  const custInvs=invs.filter(inv=>ids.includes(inv.customer_id));
  const openInvs=custInvs.filter(inv=>inv.status==='open'||inv.status==='partial');
  const paidInvs=custInvs.filter(inv=>inv.status==='paid');
  const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
  const rep=REPS.find(r=>r.id===customer.primary_rep_id);
  const allPortalJobs=[];activeSOs.forEach(so=>{safeJobs(so).forEach(j=>{allPortalJobs.push({...j,so,soMemo:so.memo})})});
  const artLabelsP={needs_art:'Art Needed',art_requested:'Art Requested',art_in_progress:'Art In Progress',waiting_approval:'Awaiting Your Approval',production_files_needed:'Finalizing Files',art_complete:'Approved'};
  const prodLabelsP={hold:'On Hold',staging:'In Line',in_process:'In Production',completed:'Done',shipped:'Shipped'};
  const contactEmail=(customer.contacts||[])[0]?.email||'';

  // Track portal visit — mark sent documents as viewed by coach
  const _portalTracked=useRef(false);
  useEffect(()=>{
    if(_portalTracked.current)return;_portalTracked.current=true;
    const now=new Date().toLocaleString();
    // Mark estimates with email_status='sent' as viewed
    const sentEsts=custEsts.filter(e=>e.email_status==='sent'&&!e.email_viewed_at);
    if(sentEsts.length&&onUpdateEsts)onUpdateEsts(prev=>prev.map(e=>sentEsts.some(se=>se.id===e.id)?{...e,email_status:'opened',email_viewed_at:now,updated_at:now}:e));
    // Mark SOs with email_status='sent' as viewed
    const sentSOs=custSOs.filter(s=>s.email_status==='sent'&&!s.email_viewed_at);
    if(sentSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>sentSOs.some(ss=>ss.id===s.id)?{...s,email_status:'opened',email_viewed_at:now,updated_at:now}:s));
    // Mark invoices with email_status='sent' as viewed
    const sentInvs=custInvs.filter(i=>i.email_status==='sent'&&!i.email_viewed_at);
    if(sentInvs.length){
      const updater=prev=>prev.map(i=>sentInvs.some(si=>si.id===i.id)?{...i,email_status:'opened',email_viewed_at:now,updated_at:now}:i);
      setInvs(updater);if(onUpdateInvs)onUpdateInvs(updater);
    }
    // Mark job art approvals as viewed when coach opens portal
    const jobSOs=custSOs.filter(s=>safeJobs(s).some(j=>j.sent_to_coach_at&&!j.coach_email_opened_at));
    if(jobSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>{if(!jobSOs.some(js=>js.id===s.id))return s;const updJobs=safeJobs(s).map(j=>j.sent_to_coach_at&&!j.coach_email_opened_at?{...j,coach_email_opened_at:new Date().toISOString()}:j);return{...s,jobs:updJobs,updated_at:now}}));
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePaymentSuccess=(result)=>{
    // Update invoices locally and in parent (persists to Supabase/localStorage/QB)
    const paidInvIds=result.invoices.map(i=>i.id);
    const updater=prev=>prev.map(inv=>{
      if(!paidInvIds.includes(inv.id))return inv;
      const bal=(inv.total||0)-(inv.paid||0);
      const fee=Math.round(bal*CC_FEE_PORTAL*100)/100;
      const newTotal=(inv.total||0)+fee; // CC surcharge added to invoice total
      const newPaid=(inv.paid||0)+bal+fee; // Customer pays balance + fee
      const payment={amount:bal+fee,method:'cc',ref:'Stripe '+result.intentId,date:new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}),cc_fee:fee};
      return{...inv,total:newTotal,paid:newPaid,status:newPaid>=newTotal?'paid':'partial',cc_fee:(inv.cc_fee||0)+fee,payments:[...(inv.payments||[]),payment],updated_at:new Date().toLocaleString()};
    });
    setInvs(updater);
    if(onUpdateInvs)onUpdateInvs(updater);// persist to parent → Supabase + localStorage + QB sync
    setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices});
    setShowPay(null);setInvView(null);setPayLoading(false);
  };

  // Estimate detail view
  if(estView){
    const est=estView;
    const eaf=safeArt(est);const _eAQ={};(est.items||[]).forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});
    const estSubtotal=(est.items||[]).reduce((a,it)=>{const sqq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=sqq>0?sqq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);
    const estShip=est.shipping_type==='pct'?estSubtotal*(est.shipping_value||0)/100:(est.shipping_value||0);
    const estTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const estTax=estSubtotal*estTaxRate;
    const estTotal=estSubtotal+estShip+estTax;
    const canApprove=est.status==='sent'||est.status==='open';
    // Generate printable estimate PDF — uses shared printDoc for consistent style
    const downloadEstPdf=()=>{
      const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const rows=[];const eTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
      (est.items||[]).forEach((it,i)=>{
        const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const lineTotal=qty*safeNum(it.unit_sell);
        const szText=Object.entries(safeSizes(it)).filter(([,v])=>v>0).map(([sz,q])=>sz+':'+q).join(' ');
        let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'')+(szText?'<br/><span style="color:#555">'+szText+'</span>':'');
        if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
        rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(safeNum(it.unit_sell)),style:'text-align:right'},{value:_$(lineTotal),style:'text-align:right;font-weight:600'}]});
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qty;const decoAmt=eq2*dp2.sell;
          const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors2=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
          const decoType2=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel2=decoType2?decoType2.replace(/_/g,' '):'';
          const colorCount2=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors2;const stitchCount2=safeNum(d.stitches)||safeNum(d.tbd_stitches);
          const decoDetail2=decoType2==='embroidery'&&stitchCount2?stitchCount2.toLocaleString()+' stitches':colorCount2?colorCount2+' color'+(colorCount2>1?'s':''):'';
          const label=d.kind==='numbers'?'Numbers — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel2||d.position||'Decoration')+(decoDetail2?' — '+decoDetail2:'')+(decoTypeLabel2&&d.position?' — '+d.position:'');
          rows.push({cells:[{value:eq2,style:'text-align:center;color:#888'},{value:'',style:''},{value:'<span style="padding-left:16px;color:#666">'+label+'</span>'},{value:_$(dp2.sell),style:'text-align:right;color:#888'},{value:_$(decoAmt),style:'text-align:right;color:#888'}]});
        });
      });
      const eBillAddr=customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':(customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':'');
      printDoc({
        title:customer?.name||'Customer',docNum:est.id,docType:'ESTIMATE',
        headerRight:'<div class="ta">'+_$(estTotal)+'</div><div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>',
        infoBoxes:[
          {label:'Bill To',value:customer?.name||'—',sub:eBillAddr||''},
          {label:'Expires',value:new Date(Date.now()+30*86400000).toLocaleDateString()},
          {label:'Sales Rep',value:rep?.name||'—'},
          {label:'Estimate',value:est.id},
          {label:'Memo',value:est.memo||'—'},
        ],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
          rows:[...rows,
            {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'},{value:'<strong>'+_$(estSubtotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'}]},
            ...(estShip>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(estShip),style:'text-align:right;border:none'}]}]:[]),
            ...(estTax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(estTaxRate*100).toFixed(2)+'%)</strong>',style:'text-align:right;border:none'},{value:_$(estTax),style:'text-align:right;border:none'}]}]:[]),
            {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong>'+_$(estTotal)+'</strong>',style:'text-align:right'}]},
          ]}],
        footer:'This estimate is valid for 30 days. Prices subject to change. '+NSA.depositTerms
      });
    };
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#92400e,#d97706)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setEstView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ESTIMATE</div>
            <div style={{fontSize:20,fontWeight:800}}>{est.memo||est.id}</div>
            <div style={{fontSize:12,opacity:0.8}}>{est.id} · {est.created_at?.split(' ')[0]}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:16,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Estimated Total</div>
            <div style={{fontSize:36,fontWeight:800,color:'#92400e'}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <span style={{padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700,background:est.status==='approved'?'#dcfce7':est.status==='converted'?'#dbeafe':'#fef3c7',color:est.status==='approved'?'#166534':est.status==='converted'?'#1e40af':'#92400e'}}>{est.status==='converted'?'Converted to Order':est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
            <div style={{marginTop:10}}><button style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:8,padding:'8px 20px',fontSize:13,fontWeight:700,cursor:'pointer'}} onClick={downloadEstPdf}>📄 Download Estimate PDF</button></div>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Items</div>
          {(est.items||[]).map((it,i)=>{const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const lineTotal=qty*safeNum(it.unit_sell);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0).sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);decoTotal+=qty*dp2.sell});
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'} {it.brand&&'· '+it.brand}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:14,color:'#1e3a5f'}}>${(lineTotal+decoTotal).toFixed(2)}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{qty} × ${safeNum(it.unit_sell).toFixed(2)}</div>
                </div>
              </div>
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
                {sizes.map(([sz,q])=>{const avail=(it.size_availability||{})[sz];return<div key={sz} style={{textAlign:'center',padding:'3px 6px',background:avail?'#fffbeb':'#f8fafc',borderRadius:5,minWidth:32,border:avail?'1px solid #fde68a':'none'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:12,fontWeight:800,color:'#1e3a5f'}}>{q}</div>
                  {avail&&<div style={{fontSize:8,color:'#92400e',fontWeight:600,whiteSpace:'nowrap'}}>Avail {new Date(avail+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}
                </div>})}
              </div>}
              {(()=>{const sa=it.size_availability||{};const delayed=Object.entries(sa).filter(([sz,d])=>d&&(it.sizes||{})[sz]>0);
                if(delayed.length===0)return null;
                return<div style={{fontSize:10,color:'#92400e',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:5,padding:'4px 8px',marginBottom:6}}>
                  ⏳ Some sizes available later: {delayed.map(([sz,d])=>sz+' ('+new Date(d+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})+')').join(', ')}
                </div>})()}
              {safeDecos(it).length>0&&<div style={{fontSize:11,color:'#64748b',borderTop:'1px solid #f1f5f9',paddingTop:4}}>
                {safeDecos(it).map((d,di)=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qty;const decoLine=eq2*dp2.sell;
                  const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
                  const decoType=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel=decoType?decoType.replace(/_/g,' '):'';
                  const colorCount=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors;const stitchCount=safeNum(d.stitches)||safeNum(d.tbd_stitches);
                  const decoDetail=decoType==='embroidery'&&stitchCount?stitchCount.toLocaleString()+' stitches':colorCount?colorCount+' color'+(colorCount>1?'s':''):'';
                  const decoLabel=d.kind==='numbers'?'Numbers · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel||d.position||'Decoration')+(decoDetail?' · '+decoDetail:'')+(decoTypeLabel&&d.position?' · '+d.position:'');
                  return<div key={di} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{d.kind==='numbers'?'#️⃣':d.kind==='names'?'🏷️':'🎨'} {decoLabel}</span>{decoLine>0&&<span style={{fontWeight:600}}>{eq2} × ${dp2.sell.toFixed(2)}/ea = +${decoLine.toFixed(2)}</span>}</div>})}
              </div>}
            </div>})}
          <div style={{borderTop:'2px solid #e2e8f0',paddingTop:12,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Subtotal</span><span style={{fontWeight:700}}>${estSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {estShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Shipping</span><span>${estShip.toFixed(2)}</span></div>}
            {estTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Tax ({(estTaxRate*100).toFixed(2)}%)</span><span>${estTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',borderTop:'2px solid #1e3a5f',marginTop:6}}>
              <span style={{fontWeight:800,fontSize:16}}>Estimated Total</span><span style={{fontWeight:800,fontSize:18,color:'#92400e'}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {canApprove&&<button style={{width:'100%',padding:'14px 20px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer',marginBottom:10}} onClick={()=>{
            const _approvedEst={...est,status:'approved',approved_by:'Coach',approved_at:new Date().toISOString(),updated_at:new Date().toLocaleString()};
            if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_approvedEst:e))}
            _dbSaveEstimate(_approvedEst);
            setEstView({...est,status:'approved'});
            // Email the assigned rep when coach approves estimate
            const rep=REPS.find(r=>r.id===est.created_by);
            if(rep?.email&&_brevoKey){const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));sendBrevoEmail({to:[{email:rep.email}],cc:_accCc,subject:'✅ Estimate approved by coach — '+(est.memo||est.id)+' ('+est.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved estimate <strong>'+est.id+'</strong>'+(est.memo?' — '+est.memo:'')+'.</p><p>This estimate is ready to be converted to a sales order.</p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:rep.email?{email:rep.email,name:rep.name}:undefined})}
          }}>✅ Approve This Estimate</button>}
          {canApprove&&<div style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:'#1e3a5f',marginBottom:8}}>Need changes? Request updates from your rep</div>
            {updateRequestSent?<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:600}}>Your update request has been sent to your rep!</div>
            :<>
              <textarea style={{width:'100%',border:'1px solid #d1d5db',borderRadius:8,padding:10,fontSize:13,resize:'vertical',minHeight:60,fontFamily:'inherit',boxSizing:'border-box'}} placeholder="Tell your rep what you'd like changed (sizes, items, pricing, etc.)..." value={updateRequestText} onChange={e=>setUpdateRequestText(e.target.value)} rows={3}/>
              <button style={{width:'100%',marginTop:8,padding:'12px 20px',background:updateRequestText.trim()?'#d97706':'#e5e7eb',color:updateRequestText.trim()?'white':'#9ca3af',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:updateRequestText.trim()?'pointer':'not-allowed'}} disabled={!updateRequestText.trim()} onClick={()=>{
                if(!updateRequestText.trim())return;
                const req={id:'UR-'+Date.now(),text:updateRequestText.trim(),from:'Coach',at:new Date().toISOString(),status:'pending'};
                const _updatedEst={...est,update_requests:[...(est.update_requests||[]),req],updated_at:new Date().toLocaleString()};
                if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_updatedEst:e))}
                _dbSaveEstimate(_updatedEst);
                setEstView({...est,update_requests:[...(est.update_requests||[]),req]});
                setUpdateRequestText('');setUpdateRequestSent(true);
              }}>Request Updates</button>
            </>}
          </div>}
          {(est.update_requests||[]).length>0&&<div style={{border:'1px solid #fde68a',background:'#fffbeb',borderRadius:10,padding:14,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:'#92400e',marginBottom:8}}>Update Requests</div>
            {(est.update_requests||[]).map((req,ri)=><div key={ri} style={{padding:'8px 0',borderBottom:ri<(est.update_requests||[]).length-1?'1px solid #fde68a':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#92400e'}}>{req.from}</span>
                <span style={{fontSize:10,color:'#b45309'}}>{new Date(req.at).toLocaleDateString()}</span>
              </div>
              <div style={{fontSize:12,color:'#78350f',marginTop:2}}>{req.text}</div>
              <span style={{fontSize:10,padding:'1px 6px',borderRadius:6,fontWeight:600,background:req.status==='completed'?'#dcfce7':req.status==='in_progress'?'#dbeafe':'#fef3c7',color:req.status==='completed'?'#166534':req.status==='in_progress'?'#1e40af':'#92400e'}}>{req.status==='completed'?'Done':req.status==='in_progress'?'In Progress':'Pending'}</span>
            </div>)}
          </div>}
          {est.status==='approved'&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Approved — your rep will convert this to an order</div>}
          {est.status==='converted'&&<div style={{textAlign:'center',padding:12,background:'#dbeafe',borderRadius:8,color:'#1e40af',fontWeight:700}}>📦 This estimate has been converted to an active order</div>}
        </div>
      </div>
    </div>
  }

  // Order detail view (skip if jobView is active — artwork cards set jobView while soView is still set)
  if(soView&&!jobView){
    const so=soView;
    const soAF=safeArt(so);
    const _soAQ={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_soAQ[d.art_file_id]=(_soAQ[d.art_file_id]||0)+q2}})});
    const soSubtotal=safeItems(so).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qq;const dp2=dP(d,qq,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);
    const soShip=so.shipping_type==='pct'?soSubtotal*(so.shipping_value||0)/100:(so.shipping_value||0);
    const soTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const soTax=soSubtotal*soTaxRate;
    const soTotal=soSubtotal+soShip+soTax;
    let soTotalU=0,soFulU=0;
    safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{soTotalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);soFulU+=Math.min(v,pQ+rQ)})});
    const soPct=soTotalU>0?Math.round(soFulU/soTotalU*100):0;
    const soDaysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
    const soJobsList=safeJobs(so);
    const soShipments=so._shipments||[];
    const soLegacy=so._tracking_number&&!soShipments.find(s=>s.tracking_number===so._tracking_number);
    const soAllShipments=soLegacy?[{tracking_number:so._tracking_number,carrier:so._carrier||'',ship_date:so._ship_date||'',tracking_url:so._tracking_url||''},...soShipments]:soShipments;
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setSoView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ORDER</div>
            <div style={{fontSize:20,fontWeight:800}}>{so.memo||so.id}</div>
            <div style={{fontSize:12,opacity:0.8}}>{so.id} · {so.created_at?.split(' ')[0]}{so.expected_date?(' · Expected '+so.expected_date):''}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* Progress bar */}
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
              <span style={{fontSize:11,fontWeight:700,color:soPct>=100?'#166534':'#1e3a5f'}}>{soPct}%</span>
            </div>
            <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
              <div style={{height:8,borderRadius:6,background:soPct>=100?'#22c55e':soPct>50?'#3b82f6':'#f59e0b',width:soPct+'%',transition:'width 0.3s'}}/></div>
            {soDaysOut!=null&&<div style={{fontSize:11,color:soDaysOut<=7?'#dc2626':'#64748b',marginTop:4,textAlign:'right'}}>{soDaysOut>0?soDaysOut+' day'+(soDaysOut!==1?'s':'')+' out':soDaysOut===0?'Due today':'Overdue'}</div>}
          </div>
          {/* Line items */}
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Items</div>
          {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            let recvQ=0;Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);recvQ+=Math.min(v,pQ+rQ)});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:qty;decoTotal+=eq2*dp2.sell});
            const lineTotal=qty*safeNum(it.unit_sell)+decoTotal;
            return<div key={ii} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'} {it.brand&&'· '+it.brand}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:14,color:'#1e3a5f'}}>${lineTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{qty} units</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{flex:1,background:'#f1f5f9',borderRadius:6,height:4,marginRight:10}}>
                  <div style={{height:4,borderRadius:6,background:recvQ>=qty?'#22c55e':recvQ>0?'#3b82f6':'#e2e8f0',width:(qty>0?Math.round(recvQ/qty*100):0)+'%'}}/></div>
                <span style={{fontSize:11,fontWeight:600,color:recvQ>=qty?'#166534':'#64748b',whiteSpace:'nowrap'}}>{recvQ} of {qty} received</span>
              </div>
              {(()=>{const _szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])<0?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])<0?99:SZ_ORD.indexOf(b[0])));
                if(_szList.length===0)return null;
                return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:8}}>
                  {_szList.map(([sz,sq])=><div key={sz} style={{textAlign:'center',padding:'3px 8px',background:'#f8fafc',borderRadius:6,minWidth:34}}>
                    <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:12,fontWeight:800,color:'#1e3a5f'}}>{sq}</div>
                  </div>)}
                </div>})()}
            </div>})}
          {/* Order totals */}
          <div style={{borderTop:'2px solid #e2e8f0',paddingTop:12,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Subtotal</span><span style={{fontWeight:700}}>${soSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {soShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Shipping</span><span>${soShip.toFixed(2)}</span></div>}
            {soTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Tax ({(soTaxRate*100).toFixed(2)}%)</span><span>${soTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',borderTop:'2px solid #1e3a5f',marginTop:6}}>
              <span style={{fontWeight:800,fontSize:16}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#1e3a5f'}}>${soTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {/* Artwork & Decoration jobs */}
          {soJobsList.length>0&&<>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Artwork & Decoration</div>
            {soJobsList.map(j=>{const artFile=soAF.find(a=>a.id===j.art_file_id);const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));(j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);const _jMf=_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[]));const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.values(af3?.item_mockups||{}).flat()));const _jSeen=new Set();const mockups=[..._jMf,..._jIm].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_jSeen.has(u))return false;_jSeen.add(u);return true});
              const _clickJob=()=>{setJobView({job:j,so});setComment('');if(j.sent_to_coach_at&&!j.coach_email_opened_at){const liveSO2=sos.find(s=>s.id===so.id);if(liveSO2){const updSO2={...liveSO2,jobs:(liveSO2.jobs||safeJobs(liveSO2)).map(jj=>jj.id===j.id?{...jj,coach_email_opened_at:new Date().toISOString()}:jj),updated_at:new Date().toLocaleString()};if(savSOFn)savSOFn(updSO2);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO2:s))}}};
              return<div key={j.id} style={{border:'1px solid '+(j.art_status==='waiting_approval'?'#f59e0b':'#e2e8f0'),background:j.art_status==='waiting_approval'?'#fffbeb':'#fafbfc',borderRadius:10,marginBottom:8,overflow:'hidden',cursor:'pointer'}} onClick={_clickJob}>
                {/* Mockup thumbnails — show all images in a grid */}
                {mockups.length>0&&<div style={{display:'grid',gridTemplateColumns:mockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
                  {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);const isPdf=_isPdfUrl(url,f);const pdfThumb=isPdf?_cloudinaryPdfThumb(url):null;
                    return<div key={fi} style={{background:'white'}}>
                      {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                      :isPdf&&pdfThumb?<img src={pdfThumb} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}} onError={e=>{e.target.style.display='none'}}/>
                      :<div style={{height:mockups.length>1?140:200,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                    </div>})}
                </div>}
                {/* Job info bar */}
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px'}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>{j.art_name}</div>
                    <div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                  </div>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:j.art_status==='art_complete'?'#dcfce7':j.art_status==='waiting_approval'?'#fef3c7':'#fee2e2',color:j.art_status==='art_complete'?'#166534':j.art_status==='waiting_approval'?'#92400e':'#dc2626'}}>{artLabelsP[j.art_status]}</span>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </>}
          {/* Shipping / Tracking */}
          {soAllShipments.length>0&&<div style={{marginTop:12}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Shipping & Tracking</div>
            {soAllShipments.map((shp,si)=><div key={si} style={{padding:'10px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,marginBottom:6}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:'#166534'}}>📦 {shp.carrier||'Package'} {soAllShipments.length>1?'#'+(si+1):''}</div>
                  {shp.ship_date&&<div style={{fontSize:10,color:'#64748b'}}>Shipped {shp.ship_date}</div>}
                </div>
                {shp.tracking_number&&<a href={shp.tracking_url||((/^1Z/i.test(shp.tracking_number))?'https://www.ups.com/track?tracknum='+shp.tracking_number:'https://www.fedex.com/fedextrack/?trknbr='+shp.tracking_number)} target="_blank" rel="noreferrer" style={{fontSize:11,fontWeight:600,color:'#2563eb',textDecoration:'none'}}>Track →</a>}
              </div>
              {shp.tracking_number&&<div style={{fontSize:11,fontFamily:'monospace',color:'#64748b',marginTop:4}}>{shp.tracking_number}</div>}
            </div>)}
          </div>}
          {/* Firm dates */}
          {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:8,fontSize:12,color:'#166534'}}>
            📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
        </div>
      </div>
    </div>
  }

  // Job detail view
  if(jobView){
    const _liveSO=sos.find(s=>s.id===jobView.so.id)||jobView.so;
    const _liveJob=(safeJobs(_liveSO)).find(jj=>jj.id===jobView.job.id)||jobView.job;
    const j=_liveJob;const so=_liveSO;
    const artFile=safeArt(so).find(a=>a.id===j.art_file_id);
    const _jobArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
    (j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jobArtIds.add(d.art_file_id)})});
    const _jobArtFiles=[..._jobArtIds].map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
    const mockups=_filterDisplayable(_jobArtFiles.flatMap(_af=>_af?.mockup_files||_af?.files||[]));
    const _hasAnyItemMockup=gi=>_jobArtFiles.some(_af=>_filterDisplayable(_af?.item_mockups?.[gi.sku]||[]).length>0);
    const items=(j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];const prd=it?prod.find(pp=>pp.id===it.product_id||pp.sku===it.sku):null;return{...gi,brand:it?.brand||'',fullName:safeStr(it?.name)||gi.name,image_url:prd?.image_url||(prd?.images&&prd.images[0])||it?._colorImage||'',back_image_url:prd?.back_image_url||(prd?.images&&prd.images[1])||it?._colorBackImage||''}});
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      {/* ── Lightbox overlay ── */}
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>{const _backSO=soView?sos.find(s=>s.id===jobView.so.id):null;setJobView(null);if(_backSO)setSoView(_backSO)}}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ARTWORK PROOF</div>
            <div style={{fontSize:18,fontWeight:800}}>{j.art_name}</div>
            <div style={{fontSize:12,opacity:0.7}}>{so.memo} · {j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* ── Per-item mockups + art details ── */}
          {items.map((gi,i)=>{const srcItem=safeItems(so)[gi.item_idx];
            const _itemArtIds=srcItem?[...new Set(safeDecos(srcItem).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd').map(d=>d.art_file_id))]:[];
            const _itemArtFiles=[...new Set([artFile?.id,...(j._art_ids||[]),..._itemArtIds].filter(Boolean))].map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
            const itemMockups=_filterDisplayable(_itemArtFiles.flatMap(_af=>_af?.item_mockups?.[gi.sku]||[]));
            const artDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'):[];
            const artPos=artDecos.map(d=>d.position||'Front Center').filter((v,idx,arr)=>arr.indexOf(v)===idx);
            const numDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='numbers'):[];
            const nameDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='names'):[];
            const nd=numDecos[0];const _isEmb=artFile?.deco_type==='embroidery';
            const gk=gi.sku+'|'+(gi.color||'');const gc=artFile?.garment_colors?.[gk]||{};
            const gcColors=Object.values(gc).flat().filter((v,idx,arr)=>v&&arr.indexOf(v)===idx);
            const cwColors2=[];artDecos.forEach(d=>{if(d.color_way_id&&artFile?.color_ways){const cw=artFile.color_ways.find(c=>c.id===d.color_way_id);if(cw)cw.inks?.forEach(c=>{if(c&&c.trim()&&!cwColors2.includes(c.trim()))cwColors2.push(c.trim())})}});
            const fallbackColors=(artFile?.ink_colors||artFile?.thread_colors||'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
            // Final fallback: union of all CW inks on the art file. Covers SOs where CWs are defined but
            // decorations don't carry an explicit color_way_id link — without this, colors render as empty.
            const allCwInks=[...new Set((artFile?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
            const itemColors=gcColors.length>0?gcColors:cwColors2.length>0?cwColors2:fallbackColors.length>0?fallbackColors:allCwInks;
            const _cm3={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
            const sizesSrc=gi.sizes?Object.entries(gi.sizes).filter(([,v])=>v>0):(srcItem?Object.entries(safeSizes(srcItem)).filter(([,v])=>v>0):[]);
            const sizes=sizesSrc.sort((a,b)=>{const o2=SZ_ORD;return(o2.indexOf(a[0])<0?99:o2.indexOf(a[0]))-(o2.indexOf(b[0])<0?99:o2.indexOf(b[0]))});
            const roster=gi.roster||(numDecos.length>0?numDecos[0].roster:null);
            const names=nameDecos.length>0?nameDecos[0].names:null;
            const sortedSizes=sizes.map(([sz])=>sz);
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:12,marginBottom:14,overflow:'hidden'}}>
            {/* Item mockup images */}
            {itemMockups.length>0&&<div style={{display:'grid',gridTemplateColumns:itemMockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
              {itemMockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);
                return<div key={fi} style={{background:'white',cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                  {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:itemMockups.length>1?180:280,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                  :<div style={{height:180,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                </div>})}
            </div>}
            {/* Item header */}
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:10}}>
                {gi.image_url?<img src={gi.image_url} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:8,border:'1px solid #e2e8f0',flexShrink:0}}/>
                :<div style={{width:44,height:44,background:'#f8fafc',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><div style={{fontSize:18}}>👕</div></div>}
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{gi.fullName}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{gi.sku} · {gi.color||'—'} {gi.brand&&'· '+gi.brand}</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>📍 {artPos.length>0?artPos.join(', '):(j.positions||'—')} · {gi.units} units</div>
                </div>
              </div>
              {/* Per-item art details */}
              {artFile&&<div style={{padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:10}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:itemColors.length>0||nd?8:0}}>
                  <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{artFile.deco_type?.replace(/_/g,' ')||'—'}</div></div>
                  <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Location</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{artPos.length>0?artPos.join(', '):'—'}</div></div>
                  <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{artFile.art_size||'—'}</div></div>
                </div>
                {itemColors.length>0&&<div style={{marginBottom:nd?8:0}}>
                  <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>{_isEmb?'Thread Colors':'Ink Colors / Pantones'} ({itemColors.length})</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {itemColors.map((cl,ci)=>{const clL=cl.toLowerCase();const sw=_cm3[cl]||Object.entries(_cm3).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                      return<div key={ci} style={{display:'flex',alignItems:'center',gap:4,padding:'2px 8px',background:'white',border:'1px solid #e2e8f0',borderRadius:5,fontSize:10,fontWeight:600}}>
                        <div style={{width:12,height:12,borderRadius:2,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                        {cl}</div>})}
                  </div>
                </div>}
                {nd&&<div>
                  <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>Numbers</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:11}}>
                    <span><strong>{(nd.num_method||'heat_transfer').replace(/_/g,' ')}</strong></span>
                    <span>Size: <strong>{nd.num_size||'—'}</strong></span>
                    {nd.front_and_back&&<span>Back: <strong>{nd.num_size_back||nd.num_size||'—'}</strong></span>}
                    {nd.print_color&&<span>Color: <strong>{nd.print_color}</strong></span>}
                    {nd.front_and_back&&<span style={{padding:'1px 5px',borderRadius:3,background:'#7c3aed',color:'white',fontSize:9,fontWeight:700}}>Front + Back</span>}
                  </div>
                </div>}
              </div>}
              {/* Size breakdown */}
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:roster?10:0}}>
                {sizes.map(([sz,qty])=><div key={sz} style={{textAlign:'center',padding:'4px 8px',background:'#f8fafc',borderRadius:6,minWidth:36}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f'}}>{qty}</div>
                </div>)}
              </div>}
              {/* Numbers roster — grouped by size */}
              {roster&&Object.keys(roster).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#6d28d9',marginBottom:6}}>#️⃣ Numbers</div>
                {sortedSizes.map(sz=>{const nums=(roster[sz]||[]).filter(n=>n!=='');
                  if(nums.length===0)return null;
                  return<div key={sz} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',minWidth:56,flexShrink:0}}>{sz} ({nums.length})</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nums.sort((a,b)=>Number(a)-Number(b)).map((n,ni)=>
                        <span key={ni} style={{display:'inline-block',minWidth:32,textAlign:'center',padding:'3px 6px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:4,fontSize:12,fontWeight:700,color:'#6d28d9'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
              {/* Names */}
              {names&&Object.keys(names).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:6}}>🏷️ Names</div>
                {sortedSizes.map(sz=>{const nms=(names[sz]||[]).filter(n=>n!=='');
                  if(nms.length===0)return null;
                  return<div key={sz} style={{marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>{sz}</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nms.map((n,ni)=>
                        <span key={ni} style={{padding:'3px 8px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:4,fontSize:11,fontWeight:600,color:'#0369a1'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
            </div>
          </div>})}
          {/* General mockups (not per-item) */}
          {mockups.length>0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Artwork Mockups</div>
            {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);const isImg=_isImgUrl(url);
              return<div key={fi} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:10,marginBottom:8,cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                {isImg&&isUrl(url)&&<img src={url} alt={name} style={{width:'100%',borderRadius:8,marginBottom:6,maxHeight:400,objectFit:'contain',background:'#f8fafc'}}/>}
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#1e40af'}}>{name}</span>
                  {isUrl(url)&&<span style={{fontSize:10,color:'#64748b'}}>— tap to enlarge</span>}
                </div>
              </div>})}
          </div>}
          {mockups.length===0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{padding:16,background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:10,marginBottom:16,textAlign:'center'}}>
            <div style={{fontSize:24,marginBottom:4}}>🎨</div>
            <div style={{fontSize:12,color:'#9a3412',fontWeight:600}}>Mockup files haven't been uploaded yet</div>
          </div>}
          {j.art_status==='waiting_approval'&&<div style={{border:'2px solid #f59e0b',background:'#fffbeb',borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontWeight:700,color:'#92400e',marginBottom:10}}>⏳ This artwork needs your approval</div>
            {_portalDisclaimer&&<div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,marginBottom:12,fontSize:12,color:'#991b1b',lineHeight:1.5}}><strong>⚠️ Important:</strong> {_portalDisclaimer}</div>}
            <div style={{marginBottom:10}}>
              <textarea className="form-input" rows={3} placeholder="Add a note (optional for approval, required for rejection)..." value={comment} onChange={e=>setComment(e.target.value)} style={{fontSize:12,resize:'vertical'}}/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'10px 16px'}} onClick={async()=>{
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const jArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const coachComment=comment.trim();
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:'production_files_needed',coach_approved_at:new Date().toISOString(),coach_approval_comment:coachComment||undefined}:jj),art_files:safeArt(liveSO).map(a=>jArtIds.includes(a.id)?{...a,status:'approved'}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                // Email the assigned rep
                const rep=REPS.find(r=>r.id===liveSO.created_by);
                const commentHtml=coachComment?'<p style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px"><strong>Coach\'s note:</strong> '+coachComment+'</p>':'';
                if(rep?.email&&_brevoKey){const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));sendBrevoEmail({to:[{email:rep.email}],cc:_accCc,subject:'✅ Art approved by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p>'+commentHtml+'<p>The job is now ready for production file prep.</p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:rep.email?{email:rep.email,name:rep.name}:undefined})}
                setComment('');setJobView(null);
              }}>✅ Approve Artwork</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'10px 16px'}} onClick={()=>{
                if(!comment.trim()){alert('Please describe what changes you need.');return}
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const rej={reason:comment.trim(),by:'Coach',at:new Date().toISOString()};
                const rArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:'art_requested',coach_rejected:true,rejections:[...(jj.rejections||[]),rej]}:jj),art_files:safeArt(liveSO).map(a=>rArtIds.includes(a.id)?{...a,status:'waiting_for_art',notes:(a.notes?a.notes+'\n':'')+'Coach feedback: '+comment.trim()}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                setComment('');setJobView(null);
              }}>❌ Request Changes</button>
            </div>
          </div>}
          {(j.art_status==='art_complete'||j.art_status==='production_files_needed')&&<div style={{background:'#f0fdf4',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#166534',fontWeight:600}}>✅ You approved this artwork{j.coach_approval_comment&&<div style={{fontWeight:400,marginTop:6,color:'#15803d'}}>Your note: "{j.coach_approval_comment}"</div>}</div>}
          {(j.art_status==='art_requested'&&j.coach_rejected)&&<div style={{background:'#fef2f2',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#dc2626',fontWeight:600}}>🔄 Changes requested — your artist is working on revisions</div>}
          {j.prod_status!=='hold'&&<div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:16}}>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PRODUCTION STATUS</div>
            <div style={{fontSize:14,fontWeight:700,color:'#1e40af',marginTop:2}}>{prodLabelsP[j.prod_status]||j.prod_status}</div>
          </div>}
        </div>
      </div>
    </div>
  }

  // Invoice detail view
  if(invView){
    const inv=invView;const bal=(inv.total||0)-(inv.paid||0);
    const linkedSO=inv.so_id?custSOs.find(s=>s.id===inv.so_id):null;
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:550,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#991b1b,#dc2626)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setInvView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>INVOICE</div>
            <div style={{fontSize:20,fontWeight:800}}>{inv.id}</div>
            <div style={{fontSize:13,opacity:0.8}}>{inv.memo||'—'}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Amount Due</div>
            <div style={{fontSize:36,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div>
            {inv.paid>0&&<div style={{fontSize:12,color:'#64748b'}}>Paid: ${inv.paid.toLocaleString()} of ${inv.total.toLocaleString()}</div>}
          </div>
          {/* Order details from linked sales order */}
          {linkedSO&&(()=>{const soAF=linkedSO.art_files||[];const soJobs=safeJobs(linkedSO);
            const itemSubtotal=safeItems(linkedSO).reduce((a,it)=>{const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);return a+qty*safeNum(it.unit_sell)},0);
            const shipAmt=inv.shipping!=null?inv.shipping:(linkedSO.shipping_type==='pct'?itemSubtotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0));
            const taxAmt=inv.tax||0;
            return<div style={{marginBottom:16,border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden'}}>
            <div style={{padding:'10px 14px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e3a5f'}}>📦 Order Details — {linkedSO.memo||linkedSO.id}</div>
              <span style={{fontSize:10,color:'#64748b'}}>{linkedSO.id}</span>
            </div>
            {safeItems(linkedSO).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0);
              const decos=safeDecos(it).filter(d=>d.type||d.deco_type||d.kind);
              const decoLabels=decos.map(d=>{const t=d.type||d.deco_type||d.kind||'';const pos=d.position||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(pos?' — '+pos:'')}).filter(Boolean);
              const matchedJobs=soJobs.filter(j=>(j.items||[]).some(ji=>ji===it.id||ji===ii)||(!j.items&&soAF.some(af=>af.id===j.art_file_id&&decos.some(d=>d.art_file_id===af.id))));
              const jobDecoLabels=matchedJobs.map(j=>{const t=j.deco_type||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(j.art_name?' — '+j.art_name:'')}).filter(Boolean);
              const allDecoLabels=[...new Set([...decoLabels,...jobDecoLabels])];
              return<div key={ii} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{qty} units</div>
                    <div style={{fontSize:10,color:'#64748b'}}>${safeNum(it.unit_sell).toFixed(2)}/ea</div>
                  </div>
                </div>
                {allDecoLabels.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {allDecoLabels.map((label,di)=><span key={di} style={{padding:'2px 8px',background:'#ede9fe',color:'#6d28d9',borderRadius:6,fontSize:10,fontWeight:600}}>{label}</span>)}
                </div>}
                {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {sizes.sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))}).map(([sz,q])=><div key={sz} style={{textAlign:'center',padding:'2px 5px',background:'#f1f5f9',borderRadius:4,minWidth:28}}>
                    <div style={{fontSize:8,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:11,fontWeight:700,color:'#1e3a5f'}}>{q}</div>
                  </div>)}
                </div>}
              </div>})}
            {linkedSO.expected_date&&<div style={{padding:'8px 14px',background:'#f8fafc',fontSize:11,color:'#64748b',display:'flex',justifyContent:'space-between'}}>
              <span>Expected Date</span><span style={{fontWeight:600,color:'#1e3a5f'}}>{linkedSO.expected_date}</span>
            </div>}
          </div>})()}
          {/* Invoice line items (if no linked SO or for reference) */}
          {inv.items?.length>0&&!linkedSO&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Items</div>
            {inv.items.map((li,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{li.name||li.sku}</div><div style={{fontSize:11,color:'#64748b'}}>{li.qty} × ${safeNum(li.unit_sell).toFixed(2)}</div></div>
              <div style={{fontWeight:700,fontSize:13}}>${(li.qty*safeNum(li.unit_sell)).toFixed(2)}</div>
            </div>)}
          </div>}
          {inv.items?.length>0&&linkedSO&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Invoice Line Items</div>
            {inv.items.map((li,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:12}}>{li.name||li.sku}</div><div style={{fontSize:10,color:'#64748b'}}>{li.qty} × ${safeNum(li.unit_sell).toFixed(2)}</div></div>
              <div style={{fontWeight:700,fontSize:12}}>${(li.qty*safeNum(li.unit_sell)).toFixed(2)}</div>
            </div>)}
          </div>}
          {/* Cost breakdown: subtotal, shipping, tax */}
          {(()=>{const _sub=(inv.total||0)-(inv.shipping||0)-(inv.tax||0);
            const _ship=inv.shipping||0;const _tax=inv.tax||0;
            const soForShip=linkedSO;
            const computedShip=_ship===0&&soForShip?(soForShip.shipping_type==='pct'?_sub*(soForShip.shipping_value||0)/100:(soForShip.shipping_value||0)):_ship;
            const showBreakdown=computedShip>0||_tax>0;
            return showBreakdown&&<div style={{marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Subtotal</span><span>${_sub.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>
              {computedShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Shipping</span><span>${computedShip.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
              {_tax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Tax</span><span>${_tax.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
            </div>})()}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:'2px solid #e2e8f0'}}>
            <span style={{fontWeight:800}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#dc2626'}}>${inv.total?.toLocaleString()}</span>
          </div>
          {bal>0&&<button style={{width:'100%',marginTop:16,padding:'14px 20px',background:payLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:payLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:payLoading?0.8:1,transition:'all 0.2s'}} disabled={payLoading} onClick={()=>{setPayLoading(true);setShowPay(inv)}}>
            {payLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay ${bal.toLocaleString()}</>}
          </button>}
          {bal<=0&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Paid in Full</div>}
        </div>
      </div>
    </div>
  }

  // Main portal view
  return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
    <div style={{width:'100%',maxWidth:700,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'24px 28px',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <img src="/nsa-logo.svg" alt="NSA" style={{height:32,filter:'brightness(0) invert(1)',marginBottom:6}}/>
            <div style={{fontSize:22,fontWeight:800}}>{customer.name}</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>Customer Portal</div>
          </div>
          <div style={{textAlign:'right'}}>
            {totalDue>0&&<><div style={{fontSize:10,opacity:0.7}}>BALANCE DUE</div><div style={{fontSize:24,fontWeight:800}}>${totalDue.toLocaleString()}</div></>}
          </div>
        </div>
      </div>
      <div style={{padding:'20px 28px'}}>

        {/* Payment success banner */}
        {paySuccess&&<div style={{padding:16,background:'#f0fdf4',border:'2px solid #22c55e',borderRadius:12,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>✅</div>
          <div style={{fontSize:18,fontWeight:800,color:'#166534',marginBottom:4}}>Payment Successful!</div>
          <div style={{fontSize:14,color:'#166534'}}>${paySuccess.amount.toLocaleString(undefined,{minimumFractionDigits:2})} paid{paySuccess.fee>0?' + $'+paySuccess.fee.toFixed(2)+' processing fee':''}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>A receipt has been sent to your email. Your account has been updated.</div>
        </div>}

        {/* Pay Now button */}
        {totalDue>0&&<div style={{marginBottom:16}}>
          <button style={{width:'100%',padding:'14px 20px',background:payLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:payLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:payLoading?0.8:1,transition:'all 0.2s'}} disabled={payLoading} onClick={()=>{setPayLoading(true);setShowPay('all')}}>
            {payLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay Now — ${totalDue.toLocaleString()}</>}
          </button>
          <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:6}}>
            <span style={{fontSize:10,color:'#94a3b8'}}>💳 Credit Card</span>
            <span style={{fontSize:10,color:'#94a3b8'}}> Apple Pay</span>
            <span style={{fontSize:10,color:'#94a3b8'}}>🏦 ACH/Bank</span>
          </div>
        </div>}

        {/* Estimates — Open/Approved only (active estimates needing attention) */}
        {(()=>{const openEsts=custEsts.filter(e=>e.status==='sent'||e.status==='open');
          const approvedEsts=custEsts.filter(e=>e.status==='approved');
          const activeEsts=[...openEsts,...approvedEsts];
          const estBadge=(st)=>({background:st==='sent'||st==='open'?'#fef3c7':st==='approved'?'#dcfce7':st==='converted'?'#dbeafe':'#f1f5f9',color:st==='sent'||st==='open'?'#92400e':st==='approved'?'#166534':st==='converted'?'#1e40af':'#64748b'});
          return activeEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>📋 Estimates ({activeEsts.length})</div>
          {openEsts.length>0&&openEsts.map(est=>{const eaf=est.art_files||[];const _eAQ={};(est.items||[]).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});const sub=(est.items||[]).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);const _sh=est.shipping_type==='pct'?sub*(est.shipping_value||0)/100:(est.shipping_value||0);const _tr=customer?.tax_exempt?0:(customer?.tax_rate||0);const t=sub+_sh+sub*_tr;
            return<div key={est.id} style={{border:'2px solid #f59e0b',borderRadius:10,padding:14,marginBottom:10,background:'#fffbeb',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{est.memo||est.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#92400e'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,...estBadge(est.status)}}>{est.status==='sent'?'Awaiting Approval':est.status}</span></div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div></div>})}
          {approvedEsts.length>0&&<div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
            {approvedEsts.map((est,i,arr)=>{const eaf=est.art_files||[];const _eAQ={};(est.items||[]).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});const sub=(est.items||[]).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);const _sh=est.shipping_type==='pct'?sub*(est.shipping_value||0)/100:(est.shipping_value||0);const _tr=customer?.tax_exempt?0:(customer?.tax_rate||0);const t=sub+_sh+sub*_tr;
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,...estBadge(est.status)}}>{est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>}
          </>})()}

        {/* Active orders */}
        {activeSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f',marginBottom:10}}>📦 Active Orders</div>
          {activeSOs.map(so=>{
            let totalU=0,fulU=0;
            safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
            const pct=totalU>0?Math.round(fulU/totalU*100):0;
            const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
            const soJobs=safeJobs(so);
            return<div key={so.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>setSoView(so)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{so.memo||so.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Order {so.id} · {so.created_at?.split(' ')[0]}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {so.expected_date&&<div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'#64748b'}}>EXPECTED</div>
                    <div style={{fontSize:14,fontWeight:700,color:daysOut!=null&&daysOut<=7?'#dc2626':'#1e3a5f'}}>{so.expected_date}</div>
                  </div>}
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
                  <span style={{fontSize:11,fontWeight:700,color:pct>=100?'#166534':'#1e3a5f'}}>{pct}%</span>
                </div>
                <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
                  <div style={{height:8,borderRadius:6,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>
              </div>
              <div style={{fontSize:12}}>
                {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                  return<div key={ii} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #f8fafc'}}>
                    <span>{safeStr(it.name)||'Item'} <span style={{color:'#94a3b8'}}>({safeStr(it.color)||'—'})</span></span>
                    <span style={{fontWeight:600,color:'#64748b'}}>{qty} units</span></div>})}
              </div>
              {soJobs.filter(j=>j.art_status==='waiting_approval').length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#fffbeb',border:'1px solid #f59e0b',borderRadius:6,fontSize:11,color:'#92400e',fontWeight:600}}>
                ⏳ {soJobs.filter(j=>j.art_status==='waiting_approval').length} artwork{soJobs.filter(j=>j.art_status==='waiting_approval').length!==1?'s':''} awaiting your approval</div>}
              {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534'}}>
                📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
            </div>})}
        </>}

        {/* Invoices — Open + Paid */}
        {custInvs.length>0&&<>
          {openInvs.length>0&&<>
            <div style={{fontSize:13,fontWeight:800,color:'#dc2626',marginBottom:10,marginTop:16}}>💰 Open Invoices</div>
            <div style={{border:'1px solid #fecaca',borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {openInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
                return<div key={inv.id} style={{padding:'12px 16px',borderBottom:i<openInvs.length-1?'1px solid #fef2f2':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                  <div>
                    <div style={{fontWeight:700}}>{inv.id} <span style={{fontSize:11,color:'#64748b'}}>{inv.memo}</span></div>
                    <div style={{fontSize:11,color:age>30?'#dc2626':'#64748b'}}>{inv.date} · {age>0?age+' days ago':'Current'}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:800,fontSize:16,color:'#dc2626'}}>${bal.toLocaleString()}</span>
                    <button className="btn btn-sm" style={{background:'#22c55e',color:'white',fontSize:10}} onClick={e=>{e.stopPropagation();setPayLoading(true);setShowPay(inv)}}>Pay</button>
                    <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                  </div>
                </div>})}
              <div style={{padding:'12px 16px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:800,color:'#dc2626'}}>Total Balance Due</span>
                <span style={{fontSize:20,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
              </div>
            </div>
          </>}
          {paidInvs.length>0&&<>
            <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:openInvs.length>0?4:16}}>✅ Paid Invoices</div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {paidInvs.slice(0,10).map((inv,i,arr)=>
                <div key={inv.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                  <div><span style={{fontWeight:600}}>{inv.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{inv.memo}</span>
                    <div style={{fontSize:10,color:'#64748b'}}>{inv.date}</div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:700,fontSize:13,color:'#166534'}}>${(inv.total||0).toLocaleString()}</span>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:'#dcfce7',color:'#166534'}}>Paid</span>
                    <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                  </div>
                </div>)}
            </div>
          </>}
        </>}

        {/* Completed orders — below invoices for reference */}
        {completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setSoView(so)}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span className="badge badge-green">Complete</span><span style={{color:'#94a3b8',fontSize:14}}>›</span></div></div>)}
        </>}

        {/* Past Estimates — converted/draft, de-emphasized at bottom */}
        {(()=>{const pastEsts=custEsts.filter(e=>e.status==='converted'||e.status==='draft');
          const estBadge=(st)=>({background:st==='converted'?'#dbeafe':'#f1f5f9',color:st==='converted'?'#1e40af':'#64748b'});
          return pastEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#94a3b8',marginBottom:10,marginTop:16}}>📋 Past Estimates ({pastEsts.length})</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10,opacity:0.75}}>
            {pastEsts.map((est,i,arr)=>{const eaf=est.art_files||[];const _eAQ={};(est.items||[]).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2}})});const sub=(est.items||[]).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:qq;r+=eq2*dp2.sell});return a+r},0);const _sh=est.shipping_type==='pct'?sub*(est.shipping_value||0)/100:(est.shipping_value||0);const _tr=customer?.tax_exempt?0:(customer?.tax_rate||0);const t=sub+_sh+sub*_tr;
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,...estBadge(est.status)}}>{est.status==='converted'?'Converted':est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>
          </>})()}

        {/* Your rep */}
        <div style={{marginTop:20,padding:14,background:'#f8fafc',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>YOUR NSA REP</div>
          <div style={{fontSize:14,fontWeight:600}}>{rep?.name||'NSA Team'}</div>
          <div style={{fontSize:12,color:'#64748b'}}>National Sports Apparel · team@nsa-teamwear.com</div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>alert('Message to '+rep?.name+' (demo)')}>💬 Message Your Rep</button>
        </div>

        {/* Contact update */}
        <div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:6}}>📋 Update Contact / Shipping Info</div>
          {!contactEdit?<>
            <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Current: {(customer.contacts||[])[0]?.name} · {(customer.contacts||[])[0]?.email}{customer.shipping_city&&' · '+customer.shipping_city+', '+customer.shipping_state}</div>
            <button className="btn btn-sm btn-secondary" onClick={()=>setContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})}>✏️ Request Update</button>
          </>:<>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Name" style={{flex:1,fontSize:12}} value={contactEdit.name} onChange={e=>setContactEdit(p=>({...p,name:e.target.value}))}/><input className="form-input" placeholder="Email" style={{flex:1,fontSize:12}} value={contactEdit.email} onChange={e=>setContactEdit(p=>({...p,email:e.target.value}))}/></div>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Phone" style={{flex:1,fontSize:12}} value={contactEdit.phone} onChange={e=>setContactEdit(p=>({...p,phone:e.target.value}))}/><input className="form-input" placeholder="Shipping Address" style={{flex:1,fontSize:12}} value={contactEdit.shipping} onChange={e=>setContactEdit(p=>({...p,shipping:e.target.value}))}/></div>
              <textarea className="form-input" placeholder="Notes for your rep (optional)" rows={2} style={{fontSize:12}} value={contactMsg} onChange={e=>setContactMsg(e.target.value)}/>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{alert('📩 Update request sent to '+rep?.name+' for approval! (demo)\n\nYour rep will review and update your info.');setContactEdit(null);setContactMsg('')}}>Send Request</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setContactEdit(null);setContactMsg('')}}>Cancel</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6}}>Changes will be reviewed by your rep before updating</div>
          </>}
        </div>
      </div>
    </div>

    {/* Stripe Payment Modal */}
    {showPay&&<StripePaymentModal
      invoices={showPay==='all'?openInvs:[showPay]}
      customerName={customer.name}
      customerEmail={contactEmail}
      alphaTag={customer.alpha_tag}
      onSuccess={handlePaymentSuccess}
      onClose={()=>{setShowPay(null);setPayLoading(false)}}
    />}
  </div>
}

// ─── PO NUMBER EXTRACTION FROM OCR TEXT ───
const extractPOFromText=(text)=>{
  if(!text)return null;
  // Patterns to match PO numbers on shipping labels:
  // "PO-NO : 0902323374", "PO-NO: 0902323374"
  // "TEAM/CUSTOMER PO : PO7540 EXP", "Cust PO#: PO7770 CSM SP"
  // "PO: 7775GBHSTEN-JB", "PO#: 12345", "PO 12345"
  // "SalesOrder#:SO-158374470", "RO12173689"
  const lines=text.split('\n');
  for(const line of lines){
    const l=line.trim();
    // Match "PO-NO" or "PO NO" followed by separator and value
    let m=l.match(/PO[\s-]*NO\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
    // Match "Cust PO#" or "CUSTOMER PO" or "TEAM/CUSTOMER PO" followed by value
    m=l.match(/(?:CUST(?:OMER)?|TEAM\/CUSTOMER)\s*PO\s*#?\s*[:#=]\s*(.+)/i);
    if(m)return m[1].trim().replace(/[.,]+$/,'');
    // Match "PO#:" or "PO:" followed by value
    m=l.match(/\bPO\s*#?\s*[:#=]\s*(.+)/i);
    if(m){const v=m[1].trim();if(v.length>=4)return v.replace(/[.,]+$/,'')}
    // Match "SalesOrder#:" pattern
    m=l.match(/Sales\s*Order\s*#?\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
  }
  return null;
};

// ─── BARCODE / QR CAMERA SCANNER ───
const BarcodeScanner=({onScan,onClose,placeholder='Scan barcode or QR code...'})=>{
  const videoRef=useRef(null);const streamRef=useRef(null);const scanningRef=useRef(false);
  const[active,setActive]=useState(false);const[error,setError]=useState(null);const[manualVal,setManualVal]=useState('');
  const detectorRef=useRef(null);
  const[scanMode,setScanMode]=useState('barcode');// 'barcode' | 'text'
  const[ocrStatus,setOcrStatus]=useState('');// OCR progress status
  const[ocrResults,setOcrResults]=useState([]);// extracted PO numbers from OCR
  const ocrBusyRef=useRef(false);
  const canvasRef=useRef(null);

  const startCamera=async()=>{
    setError(null);setOcrResults([]);setOcrStatus('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}});
      streamRef.current=stream;
      const v=videoRef.current;
      if(v){
        v.srcObject=stream;
        await new Promise((resolve)=>{
          if(v.readyState>=v.HAVE_METADATA){resolve();return}
          v.onloadedmetadata=()=>resolve();
        });
        await v.play();
      }
      setActive(true);
      if(scanMode==='barcode'){
        const DetectorImpl='BarcodeDetector' in window?window.BarcodeDetector:BarcodeDetectorPolyfill;
        detectorRef.current=new DetectorImpl({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','codabar','itf']});
      }
      scanningRef.current=true;
      if(scanMode==='barcode')scanLoop();
    }catch(err){
      if(err.name==='NotAllowedError')setError('Camera permission denied. Please allow camera access and try again.');
      else if(err.name==='NotFoundError')setError('No camera found. Use manual entry below.');
      else setError('Camera error: '+err.message);
    }
  };

  const scanLoop=async()=>{
    if(!scanningRef.current||!videoRef.current||!detectorRef.current)return;
    try{
      const barcodes=await detectorRef.current.detect(videoRef.current);
      if(barcodes.length>0){
        const val=barcodes[0].rawValue;
        if(val){stopCamera();onScan(val);return}
      }
    }catch(err){if(err?.name!=='InvalidStateError')console.warn('[BarcodeScanner] detect error:',err?.message||err)}
    requestAnimationFrame(()=>setTimeout(scanLoop,150));
  };

  // Capture a frame from video for OCR
  const captureFrame=()=>{
    const v=videoRef.current;
    if(!v||!v.videoWidth)return null;
    let canvas=canvasRef.current;
    if(!canvas){canvas=document.createElement('canvas');canvasRef.current=canvas}
    canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(v,0,0);
    return canvas;
  };

  // Run OCR on current camera frame
  const runOCR=async()=>{
    if(ocrBusyRef.current)return;
    ocrBusyRef.current=true;
    setOcrStatus('Reading text...');setOcrResults([]);
    try{
      const canvas=captureFrame();
      if(!canvas){setOcrStatus('No camera frame available');ocrBusyRef.current=false;return}
      const worker=await createWorker('eng');
      const{data:{text}}=await worker.recognize(canvas);
      await worker.terminate();
      if(!text||!text.trim()){setOcrStatus('No text detected — try adjusting angle');ocrBusyRef.current=false;return}
      // Extract PO numbers from OCR text
      const po=extractPOFromText(text);
      if(po){
        setOcrResults([po]);setOcrStatus('Found PO: '+po);
      }else{
        // Show raw text so user can pick out the PO
        const lines=text.split('\n').map(l=>l.trim()).filter(l=>l.length>2);
        setOcrResults(lines.slice(0,10));
        setOcrStatus('No PO pattern found — select a line or try again');
      }
    }catch(err){
      console.warn('[OCR] error:',err?.message||err);
      setOcrStatus('OCR error: '+(err?.message||'Unknown error'));
    }
    ocrBusyRef.current=false;
  };

  const stopCamera=()=>{
    scanningRef.current=false;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null}
    if(videoRef.current){videoRef.current.srcObject=null}
    setActive(false);setOcrStatus('');setOcrResults([]);
  };

  // Cleanup on unmount
  React.useEffect(()=>()=>{scanningRef.current=false;if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop())};},[]);

  // Restart camera when mode changes while active
  const prevMode=useRef(scanMode);
  React.useEffect(()=>{
    if(prevMode.current!==scanMode&&active){stopCamera();setTimeout(()=>startCamera(),200)}
    prevMode.current=scanMode;
  },[scanMode]);// eslint-disable-line react-hooks/exhaustive-deps

  const handleManual=(e)=>{
    if(e.key==='Enter'&&manualVal.trim()){onScan(manualVal.trim());setManualVal('')}
  };

  return<div style={{background:'#0f172a',borderRadius:12,overflow:'hidden',border:'2px solid #334155'}}>
    {/* Mode toggle */}
    <div style={{display:'flex',borderBottom:'1px solid #1e293b'}}>
      <button onClick={()=>setScanMode('barcode')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='barcode'?'#1e293b':'transparent',color:scanMode==='barcode'?'#22c55e':'#64748b',borderBottom:scanMode==='barcode'?'2px solid #22c55e':'2px solid transparent'}}>
        Barcode Scan
      </button>
      <button onClick={()=>setScanMode('text')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='text'?'#1e293b':'transparent',color:scanMode==='text'?'#f59e0b':'#64748b',borderBottom:scanMode==='text'?'2px solid #f59e0b':'2px solid transparent'}}>
        PO Text Scan
      </button>
    </div>
    {/* Single video element always in DOM so ref/stream survive re-renders */}
    <div style={{position:'relative',background:'#000',display:active?'block':'none'}}>
      <video ref={videoRef} style={{width:'100%',maxHeight:280,objectFit:'cover',display:'block'}} autoPlay playsInline muted/>
      {/* Scan overlay */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <div style={{width:scanMode==='text'?280:200,height:scanMode==='text'?160:200,
          border:scanMode==='text'?'2px solid rgba(245,158,11,0.7)':'2px solid rgba(34,197,94,0.7)',borderRadius:12,boxShadow:'0 0 0 9999px rgba(0,0,0,0.3)'}}/>
      </div>
      <div style={{position:'absolute',bottom:scanMode==='text'?40:8,left:0,right:0,textAlign:'center',
        color:scanMode==='text'?'#f59e0b':'#22c55e',fontSize:11,fontWeight:600,textShadow:'0 1px 3px rgba(0,0,0,0.8)'}}>
        {scanMode==='text'?'Point camera at PO label, then tap Capture':'Point camera at barcode or QR code'}
      </div>
      {scanMode==='text'&&<button onClick={runOCR} disabled={ocrBusyRef.current}
        style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50)',background:ocrBusyRef.current?'#475569':'#f59e0b',
          color:ocrBusyRef.current?'#94a3b8':'#000',border:'none',borderRadius:8,padding:'6px 24px',cursor:ocrBusyRef.current?'default':'pointer',fontSize:13,fontWeight:700}}>
        {ocrBusyRef.current?'Reading...':'Capture & Read'}
      </button>}
      <button onClick={stopCamera} style={{position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.6)',border:'none',color:'white',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:12}}>Close Camera</button>
    </div>
    {/* OCR results */}
    {scanMode==='text'&&active&&(ocrStatus||ocrResults.length>0)&&<div style={{padding:'8px 12px',borderBottom:'1px solid #1e293b'}}>
      {ocrStatus&&<div style={{fontSize:11,color:ocrResults.length===1?'#22c55e':'#f59e0b',marginBottom:ocrResults.length>1?6:0,fontWeight:600}}>{ocrStatus}</div>}
      {ocrResults.length===1&&<button onClick={()=>{const v=ocrResults[0];stopCamera();onScan(v)}}
        style={{marginTop:4,width:'100%',background:'#22c55e',color:'#000',border:'none',borderRadius:6,padding:'8px',fontSize:13,fontWeight:700,cursor:'pointer'}}>
        Use: {ocrResults[0]}
      </button>}
      {ocrResults.length>1&&<div style={{maxHeight:120,overflowY:'auto'}}>
        {ocrResults.map((line,i)=><button key={i} onClick={()=>{stopCamera();onScan(line)}}
          style={{display:'block',width:'100%',textAlign:'left',background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155',borderRadius:4,padding:'4px 8px',marginBottom:2,fontSize:11,fontFamily:'monospace',cursor:'pointer',':hover':{background:'#334155'}}}>
          {line}
        </button>)}
      </div>}
    </div>}
    {!active&&<div style={{padding:'20px',textAlign:'center'}}>
      {error?<div style={{color:'#f87171',fontSize:12,marginBottom:10}}>{error}</div>:
      <div style={{color:'#94a3b8',fontSize:12,marginBottom:10}}>
        {scanMode==='text'?'Open the camera to scan PO text from shipping labels':'Open the camera to scan barcodes/QR codes, or type manually below'}
      </div>}
      <button onClick={startCamera} style={{background:scanMode==='text'?'#f59e0b':'#22c55e',color:scanMode==='text'?'#000':'white',border:'none',borderRadius:8,padding:'10px 24px',fontSize:14,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Open Camera
      </button>
    </div>}
    {/* Manual entry always available */}
    <div style={{padding:'10px 16px',borderTop:'1px solid #1e293b',display:'flex',gap:8}}>
      <input value={manualVal} onChange={e=>setManualVal(e.target.value)} onKeyDown={handleManual}
        placeholder={placeholder} style={{flex:1,background:'#1e293b',border:'1px solid #334155',borderRadius:6,padding:'8px 12px',color:'white',fontSize:13,fontWeight:600,fontFamily:'monospace'}}/>
      <button onClick={()=>{if(manualVal.trim()){onScan(manualVal.trim());setManualVal('')}}}
        style={{background:'#2563eb',color:'white',border:'none',borderRadius:6,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Look Up</button>
      {onClose&&<button onClick={onClose} style={{background:'#334155',color:'#94a3b8',border:'none',borderRadius:6,padding:'8px 12px',cursor:'pointer',fontSize:12}}>Cancel</button>}
    </div>
  </div>;
};

// MAIN APP


export default CoachPortal;
