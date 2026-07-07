// Invoices page — lifted verbatim out of App() (was `function rInvoices()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import React from 'react';
import { useAppData } from './AppContext';
import { D_V, PRINT_CSS } from './constants';
import { supabase, _dbSaveInvoice } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safePicks, safeSizes, soLineKey } from './safeHelpers';
import { Icon, FollowUpAutoPanel, seedFollowUp, custShipAddrSub, orderShipToSub, resolveOrderShipTo } from './components';
import { buildDocHtml, printDoc, downloadDoc, sendBrevoEmail, invokeEdgeFn, buildBrandedEmailHtml, buildReviewButtonHtml, reviewTextBlock, getBillingContacts, _smsUiEnabled } from './utils';
import { dP, RowLink, _brevoKey, _buildTabHref, buildInvoicePdfRows, fmtCreatedAt, sendBrevoSms } from './App';

export default function InvoicesPage(){
  const {CC_FEE_PCT,PAY_METHODS,REPS,canDelete,changeDocRep,changeLog,companyInfo,createAndSettleOmgInvoice,createAndSettleWebstoreInvoice,cu,cust,deleteInvoice,editingInvRep,histInvs,invBackPg,invEditModal,invF,invSendModalDirect,invSort,invs,nf,omgStores,payModal,pdBulkModal,portalSettings,setESO,setESOC,setEditingInvRep,setHistInvs,setInvBackPg,setInvEditModal,setInvF,setInvSendModalDirect,setInvSort,setInvs,setPayModal,setPdBulkModal,setPg,setSplitModal,setViewInvoice,sos,splitInvoice,splitModal,viewInvoice,webstoreSettle}=useAppData();

    const today=new Date();
    const parseD=(ds)=>{if(!ds)return null;const m=ds.match(/(\d{2})\/(\d{2})\/(\d{2})/);return m?new Date('20'+m[3],m[1]-1,m[2]):new Date(ds)};
    const agingDays=(dateStr)=>{const d=parseD(dateStr);return d?Math.floor((today-d)/(1000*60*60*24)):0};
    const dueDays=(dateStr)=>{const d=parseD(dateStr);return d?Math.floor((d-today)/(1000*60*60*24)):null};
    // Days for derived due date on NetSuite-imported invoices (mirrors the past-due SQL cron logic).
    const _termDays=(t)=>({prepay:0,net15:15,net30:30,net60:60})[t||'net30']??30;
    const _deriveDue=(invDate,terms)=>{const d=parseD(invDate);if(!d)return null;const x=new Date(d);x.setDate(x.getDate()+_termDays(terms));return x.toISOString().split('T')[0]};
    const invSortFn=(f)=>setInvSort(s=>({f,d:s.f===f&&s.d==='asc'?'desc':'asc'}));
    const sortIcon=(f)=>invSort.f===f?(invSort.d==='asc'?'▲':'▼'):'⇅';

    const recordPayment=(inv,amount,method,ref)=>{
      // NetSuite-imported invoices live in customer_invoices and don't track
      // a `paid` numeric. We just flip the status locally so the portal stops
      // showing them as open; reconciliation back to NetSuite is handled there.
      if(inv._hist){
        const newStatus=amount>=safeNum(inv.total)?'paid':'partial';
        if(supabase&&inv.netsuite_internal_id){
          (async()=>{try{await supabase.from('customer_invoices').update({status:newStatus}).eq('netsuite_internal_id',inv.netsuite_internal_id)}catch(e){console.warn('[recordPayment hist] failed:',e.message)}})();
        }
        setHistInvs(prev=>prev.map(i=>i.netsuite_internal_id===inv.netsuite_internal_id?{...i,status:newStatus}:i));
        setPayModal(null);
        nf('Marked '+inv.id+' as '+newStatus+' (NetSuite — please mark paid in NS to keep AR in sync)');
        return;
      }
      const fee=method==='cc'?Math.round(amount*CC_FEE_PCT*100)/100:0;
      const newTotal=inv.total+fee; // CC surcharge folded into invoice total (cc_fee tracks it; GP/commissions subtract it)
      const newPaid=inv.paid+amount+fee; // Customer pays amount + fee
      const newStatus=newPaid>=newTotal?'paid':newPaid>0?'partial':'open';
      const payment={amount:amount+fee,method,ref,date:new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}),cc_fee:fee};
      const updated={...inv,total:newTotal,paid:newPaid,status:newStatus,cc_fee:(inv.cc_fee||0)+fee,payments:[...(inv.payments||[]),payment]};
      setInvs(prev=>prev.map(i=>i.id===inv.id?updated:i));
      setPayModal(null);
      nf('$'+amount.toLocaleString()+' recorded on '+inv.id+(fee>0?' (+$'+fee.toFixed(2)+' CC fee)':''));
      // Tax filing to TaxCloud is MANUAL — file from the invoice's "File to
      // TaxCloud" button (fileTaxCloud below) so filing stays within the
      // monthly TaxCloud call budget. (Previously auto-fired here on payment.)
    };

    // Manual TaxCloud filing for one paid invoice. Only runs when the user
    // clicks "File to TaxCloud" on the invoice — never automatically.
    const fileTaxCloud=async(inv)=>{
      if(!supabase){nf('Supabase not configured','error');return}
      if(inv.tc_reported){nf('Invoice '+inv.id+' is already filed to TaxCloud','error');return}
      const c=cust.find(x=>x.id===inv.customer_id);
      if(!c||c.tax_exempt){nf('Customer is tax-exempt — nothing to file','error');return}
      if(!(c.shipping_state||c.billing_state)){nf('No shipping/billing state on customer — cannot file','error');return}
      nf('Filing tax for '+inv.id+' to TaxCloud…');
      try{
        const d=await invokeEdgeFn(supabase,'taxcloud-capture',{
          action:'capture',customer_id:inv.customer_id,invoice_id:inv.id,so_id:inv.so_id||inv.id,
          items:(inv.items||inv.line_items||[]).map(it=>({sku:it.sku||it.desc||'ITEM',name:it.name||it.desc||'Item',price:it.rate||it.unit_sell||0,qty:it.qty||1})),
          destination:{state:c.shipping_state||c.billing_state||'',zip5:c.shipping_zip||c.billing_zip||''}});
        if(d?.ok){setInvs(prev=>prev.map(i=>i.id===inv.id?{...i,tc_reported:true,tc_tax:d.total_tax}:i));nf('TaxCloud: $'+d.total_tax+' tax filed for '+inv.id)}
        else{nf('TaxCloud filing failed: '+(d?.error||'unknown error'),'error')}
      }catch(e){nf('TaxCloud error: '+e.message,'error')}
    };

    // ═══ INVOICE DETAIL PAGE ═══
    if(viewInvoice){
      const inv=invs.find(i=>i.id===viewInvoice.id)||viewInvoice;
      const ic=cust.find(c=>c.id===inv.customer_id);
      const so=sos.find(s=>s.id===inv.so_id);
      // Older invoices have no shipping override stored — fall back to the SO's selected ship-to
      const invShipSel=(inv.shipping_name||inv.shipping_address)?null:resolveOrderShipTo(so,ic);
      const repObj=REPS.find(r=>r.id===(ic?.primary_rep_id||so?.created_by))||null;
      const bal=inv.total-(inv.paid??0);
      const storedLineItems=inv.line_items||[];
      // Fallback: compute line items from SO when not stored on invoice
      const soComputedItems=(!storedLineItems.length&&so)?safeItems(so).map((it,_soIdx)=>{
        const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!qty)return null;
        const af=safeArt(so);const aqMap={};safeItems(so).forEach(sit=>{const sq2=Object.values(safeSizes(sit)).reduce((a2,v2)=>a2+safeNum(v2),0);safeDecos(sit).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){aqMap[d2.art_file_id]=(aqMap[d2.art_file_id]||0)+sq2}})});
        const decos=safeDecos(it);
        const decoDetails=decos.map(d=>{
          const cq=d.kind==='art'&&d.art_file_id?aqMap[d.art_file_id]:qty;
          const dp=dP(d,qty,af,cq);
          const artFile=d.kind==='art'&&d.art_file_id?af.find(a=>a.id===d.art_file_id):null;
          const decoType=artFile?artFile.deco_type:d.kind==='numbers'?'numbers':d.kind==='names'?'names':d.kind==='outside_deco'?(d.deco_type||'outside'):(d.type||d.kind||'');
          const decoLabel=decoType==='screen_print'?'Screen Print':decoType==='embroidery'?'Embroidery':decoType==='dtf'?'DTF/Heat Press':decoType==='heat_press'?'Heat Press':decoType==='numbers'?'Numbers':decoType==='names'?'Names':decoType==='outside_deco'||decoType==='outside'?'Outside Deco':decoType;
          return{kind:d.kind,type:decoType,label:decoLabel,position:d.position||'',artName:artFile?.name||'',sell:dp.sell,cost:dp.cost,nq:dp._nq};
        });
        const decoSell=decoDetails.reduce((a,dd)=>a+dd.sell,0);
        return{desc:it.sku+' '+it.name+(it.color?' — '+it.color:''),qty,rate:safeNum(it.unit_sell)+decoSell,amount:qty*(safeNum(it.unit_sell)+decoSell),
          _unitSell:safeNum(it.unit_sell),_decoSell:decoSell,_decos:decoDetails,_sku:it.sku,_name:it.name,_color:it.color,_so_line_key:soLineKey(it,_soIdx)}}).filter(Boolean):[];
      const lineItems=storedLineItems.length>0?storedLineItems:soComputedItems;
      const shipAmt=inv.shipping||0;
      const taxAmt=inv.tax||0;
      const subtotal=lineItems.reduce((a,li)=>a+safeNum(li.amount),0);
      // Build decoration details from SO for display
      const soDecoDetails=so?safeItems(so).map((it,idx)=>{
        const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!qty)return null;
        const af=safeArt(so);const aqMap={};safeItems(so).forEach(sit=>{const sq2=Object.values(safeSizes(sit)).reduce((a2,v2)=>a2+safeNum(v2),0);safeDecos(sit).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){aqMap[d2.art_file_id]=(aqMap[d2.art_file_id]||0)+sq2}})});
        const decos=safeDecos(it).map(d=>{
          const cq=d.kind==='art'&&d.art_file_id?aqMap[d.art_file_id]:qty;
          const dp=dP(d,qty,af,cq);
          const artFile=d.kind==='art'&&d.art_file_id?af.find(a=>a.id===d.art_file_id):null;
          const decoType=artFile?artFile.deco_type:d.kind==='numbers'?'numbers':d.kind==='names'?'names':d.kind==='outside_deco'?(d.deco_type||'outside'):(d.type||d.kind||'');
          const decoLabel=decoType==='screen_print'?'Screen Print':decoType==='embroidery'?'Embroidery':decoType==='dtf'?'DTF/Heat Press':decoType==='heat_press'?'Heat Press':decoType==='numbers'?'Numbers':decoType==='names'?'Names':decoType==='outside_deco'||decoType==='outside'?'Outside Deco':decoType;
          const colors=artFile?.ink_colors?artFile.ink_colors.split('\n').filter(l=>l.trim()):[];
          return{kind:d.kind,type:decoType,label:decoLabel,position:d.position||'',artName:artFile?.name||d.art_tbd_type||'',sell:dp.sell,cost:dp.cost,
            colors,stitches:artFile?.stitches,dtfSize:artFile?.dtf_size,twoColor:d.two_color,numMethod:d.num_method,numSize:d.num_size,vendor:d.vendor,notes:d.notes};
        });
        if(!decos.length)return null;
        return{sku:it.sku,name:it.name,color:it.color,qty,decos};
      }).filter(Boolean):[];
      const dd=dueDays(inv.due_date);
      const overdue=dd!==null&&dd<0&&inv.status!=='paid';
      const contacts=(ic?.contacts||[]).filter(c=>c.email);

      const buildInvDocOpts=()=>{
        const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        const billToName=inv.billing_name||ic?.name||'—';
        const billToSub=inv.billing_name?(inv.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':'';
        const billAddr=billToSub||(ic?.billing_address_line1?ic.billing_address_line1+(ic.billing_city?'<br/>'+ic.billing_city+(ic.billing_state?' '+ic.billing_state:'')+(ic.billing_zip?' '+ic.billing_zip:''):'')+'<br/>United States':'');
        const shipToName=inv.shipping_name||invShipSel?.name||ic?.name||'—';
        const shipToOverrideSub=inv.shipping_name?(inv.shipping_address||'').replace(/\n/g,'<br/>')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':'';
        const shipAddr=shipToOverrideSub||(invShipSel?orderShipToSub(so,ic):'')||custShipAddrSub(ic);
        const poNum=inv._po_number||so?.po_number;
        const {rows:pRows,subtotal:pSubTotal}=buildInvoicePdfRows(inv,so,_$);
        return{title:billToName,docNum:inv.id,docType:'INVOICE',date:inv.date,
          headerRight:'<div class="ta">'+_$(inv.total)+'</div><div class="ts">Balance Due: <strong>'+_$(bal)+'</strong></div>'+(poNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+poNum+'</div>':''),
          infoBoxes:[
            {label:'Bill To',value:billToName,sub:billAddr},
            ...(shipAddr?[{label:'Ship To',value:shipToName,sub:shipAddr}]:[]),
            {label:'Invoice Date',value:inv.date||'—',sub:inv.due_date?'Due: '+inv.due_date:''},
            {label:'PO Number',value:poNum||'—'},
            {label:'Payment Terms',value:inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial Invoice':inv.inv_type==='full'?'Invoice':'Final Invoice',sub:'Rep: '+(repObj?.name||'—')}
          ],
          tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
            rows:[...pRows,
              {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(pSubTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
              ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(shipAmt),style:'text-align:right;border:none'}]}]:[]),
              ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$(taxAmt),style:'text-align:right;border:none'}]}]:[]),
              ...(safeNum(inv.credit_amount)>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$(safeNum(inv.credit_amount))+'</strong>',style:'text-align:right;border:none'}]}]:[]),
              {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(inv.total)+'</strong>',style:'text-align:right'}]},
              ...(inv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$(inv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
              ...(bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$(bal)+'</strong>',style:'text-align:right'}]}]:[]),
            ]}],footer:inv.inv_type==='deposit'?companyInfo.depositTerms:companyInfo.terms,companyInfo:companyInfo};
      };

      return(<>
        {/* Back button + breadcrumb */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <button className="btn btn-secondary" style={{display:'flex',alignItems:'center',gap:6,fontSize:12}} onClick={()=>{setViewInvoice(null);if(invBackPg){const b=invBackPg;setInvBackPg(null);setPg(b)}}}><Icon name="arrow-left" size={14}/> {invBackPg?({customers:'Back to Customer',estimates:'Back to Estimate',orders:'Back to Sales Order',dashboard:'Back to Dashboard'}[invBackPg]||'Back'):'Back to Invoices'}</button>
          <span style={{fontSize:12,color:'#94a3b8'}}>Invoices / {inv.id}</span>
        </div>

        {/* Invoice header card */}
        <div className="card" style={{marginBottom:16}}>
          <div style={{padding:'20px 24px',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',borderRadius:'8px 8px 0 0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontSize:24,fontWeight:900,letterSpacing:1}}>INVOICE</div>
                <div style={{fontSize:18,fontWeight:700,opacity:0.9}}>{inv.id}</div>
                <div style={{fontSize:13,opacity:0.8,marginTop:4}}>{ic?.name||'Unknown Customer'}{ic?.alpha_tag?' — '+ic.alpha_tag:''}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:28,fontWeight:900}}>${inv.total.toLocaleString()}</div>
                <div style={{fontSize:13,opacity:0.8}}>Balance: <span style={{fontWeight:700,color:bal>0?'#fbbf24':'#86efac'}}>${bal.toLocaleString()}</span></div>
                <div style={{marginTop:6}}>
                  <span style={{padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700,
                    background:inv.status==='paid'?'rgba(134,239,172,0.3)':inv.status==='partial'?'rgba(251,191,36,0.3)':overdue?'rgba(252,165,165,0.3)':'rgba(191,219,254,0.3)',
                    color:'white'}}>
                    {inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':overdue?'Overdue':'Open'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Rep field */}
          <div className="card-body" style={{padding:'10px 24px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,fontWeight:600,color:'#475569'}}>Rep:</span>
            {editingInvRep
              ?<><select className="form-select" style={{width:180,fontSize:12,padding:'2px 6px'}} defaultValue={repObj?.id||''} onChange={e=>{changeDocRep(ic,e.target.value,inv.id);setEditingInvRep(false)}}>
                <option value="">— None —</option>
                {REPS.filter(r=>r.is_active!==false&&(r.role==='rep'||r.role==='admin')).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select><button className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={()=>setEditingInvRep(false)}>Cancel</button></>
              :<><span style={{fontSize:12,color:'#1e293b'}}>{repObj?.name||'—'}</span>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:11,padding:'0 4px'}} title="Change rep" onClick={()=>setEditingInvRep(true)}>✏️</button></>}
          </div>

          {/* Sent History */}
          {((inv.sent_history||[]).length>0||inv.email_sent_at)&&<div className="card-body" style={{padding:'12px 24px',borderBottom:'1px solid #e2e8f0'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:'#475569'}}>Send History</span>
              {inv.email_status==='sent'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'#fef3c7',color:'#92400e',fontWeight:600}}>✉️ Sent</span>}
              {inv.email_status==='opened'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'#dbeafe',color:'#1e40af',fontWeight:600}}>👁️ Opened {inv.email_opened_at||''}</span>}
              {inv.follow_up_at&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:new Date(inv.follow_up_at)<new Date()?'#fef2f2':'#fffbeb',color:new Date(inv.follow_up_at)<new Date()?'#dc2626':'#92400e',fontWeight:600}}>⏰ Follow-up {new Date(inv.follow_up_at).toLocaleDateString()}{new Date(inv.follow_up_at)<new Date()?' (overdue)':''}</span>}
            </div>
            {(inv.sent_history||[]).length>0?(inv.sent_history||[]).map((h,hi)=><div key={hi} style={{fontSize:11,color:'#64748b',display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
              <span style={{color:'#2563eb'}}>✉️</span>
              <span>{new Date(h.sent_at).toLocaleDateString()} @ {new Date(h.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}</span>
              <span style={{color:'#94a3b8'}}>by {h.sent_by}</span>
              {h.methods&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'#eff6ff',color:'#1e40af'}}>{h.methods.join(', ')}</span>}
              {h.to&&<span style={{fontSize:9,color:'#94a3b8'}}>→ {h.to}</span>}
            </div>):<div style={{fontSize:11,color:'#64748b'}}>Sent {inv.email_sent_at}</div>}
          </div>}
          {/* Action buttons */}
          <div className="card-body" style={{padding:'12px 24px',borderBottom:'1px solid #e2e8f0',display:'flex',gap:8,flexWrap:'wrap'}}>
            {inv.status!=='paid'&&<button className="btn btn-sm" style={{background:'#166534',color:'white',border:'none',fontSize:12,padding:'6px 14px'}}
              onClick={()=>setPayModal({inv:{...inv,_bal:bal},amount:bal,method:'check',ref:''})}>Record Payment</button>}
            {inv.status==='paid'&&(inv.tax||0)>0&&!inv.tc_reported&&ic&&!ic.tax_exempt&&<button className="btn btn-sm" style={{background:'#1e40af',color:'white',border:'none',fontSize:12,padding:'6px 14px'}}
              onClick={()=>fileTaxCloud(inv)} title="Report this paid invoice to TaxCloud for state filing (1 manual call)">File to TaxCloud</button>}
            {inv.tc_reported&&<span style={{fontSize:12,padding:'6px 10px',color:'#166534',fontWeight:600}}>✓ Filed to TaxCloud{inv.tc_tax?' ($'+Number(inv.tc_tax).toLocaleString()+')':''}</span>}
            <button className="btn btn-sm btn-secondary" style={{fontSize:12,padding:'6px 14px'}}
              onClick={()=>{
                // Seed billing_custom: true if there's an override that doesn't match any alt billing address on the customer
                const _parent=ic?.parent_id?cust.find(c=>c.id===ic.parent_id):ic;
                const _alts=(_parent?.alt_billing_addresses||[]).filter(a=>a.label||a.street);
                const _matchesAlt=inv.billing_name?_alts.some(a=>(a.label||'')===inv.billing_name):false;
                const _billingCustom=!!(inv.billing_name||inv.billing_address)&&!_matchesAlt;
                setInvEditModal({
                  inv,
                  customer_id:inv.customer_id||'',
                  memo:inv.memo||'',
                  date:inv.date||'',
                  due_date:inv.due_date||'',
                  billing_name:inv.billing_name||'',
                  billing_address:inv.billing_address||'',
                  billing_custom:_billingCustom,
                  shipping_name:inv.shipping_name||'',
                  shipping_address:inv.shipping_address||'',
                  shipping_custom:!!(inv.shipping_name||inv.shipping_address),
                  shipping:safeNum(inv.shipping),
                  tax:safeNum(inv.tax),
                  line_items:(lineItems.length?lineItems:[]).map(li=>({...li,qty:safeNum(li.qty),rate:safeNum(li.rate),amount:safeNum(li.amount)})),
                  customerSearch:'',
                  customerSearchOpen:false
                });
              }}>Edit Invoice</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:12,padding:'6px 14px'}}
              onClick={()=>{
                const contact=contacts[0];
                const portalUrl=ic?.alpha_tag?'https://nationalsportsapparel.com/coach?portal='+ic.alpha_tag:'';
                const msg='Hi '+(contact?.name||'Coach')+',\n\nPlease find the attached invoice '+inv.id+' for $'+inv.total.toFixed(2)+'. Payment is due by '+(inv.due_date||'—')+'.'+(portalUrl?'\n\nYou can also view your invoice through your portal:\n'+portalUrl:'')+'\n\nThank you,\nNSA Team';
                const smsText='Hi '+(contact?.name||'Coach')+', your invoice '+inv.id+' for $'+inv.total.toFixed(2)+' is ready. Due by '+(inv.due_date||'—')+'. View: https://nationalsportsapparel.com/coach?portal='+(ic?.alpha_tag||'');
                // Build recipient list: customer's own contacts + inherited billing contacts from parent accounts
                const ownContacts=(ic?.contacts||[]).filter(ct=>ct.email);
                const inheritedBilling=getBillingContacts(ic,cust).filter(a=>a._inherited_from&&a.email&&!ownContacts.find(o=>o.email===a.email));
                const sendContacts=[...ownContacts.map(ct=>({email:ct.email,name:ct.name||'',role:ct.role||'',phone:ct.phone||''})),...inheritedBilling.map(a=>({email:a.email,name:a.name||'',role:a.role||'',_inherited_from:a._inherited_from}))];
                const billingEmails=new Set(getBillingContacts(ic,cust).map(b=>b.email));
                const checked={};sendContacts.forEach(ct=>{checked[ct.email]=billingEmails.has(ct.email)});
                if(Object.values(checked).every(v=>!v)&&sendContacts.length>0)checked[sendContacts[0].email]=true;
                setInvSendModalDirect({inv,sendContacts,checked,customEmail:'',customEmails:[],msg,review:false,smsEnabled:_smsUiEnabled&&!!contact?.phone,smsPhone:contact?.phone||'',smsMsg:smsText,followUpDays:portalSettings?.invFollowUpDays||7,followUp:seedFollowUp(inv)});
              }}>Send Invoice</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:12,padding:'6px 14px'}}
              onClick={()=>{
                printDoc(buildInvDocOpts());
                const ph=[...(inv.print_history||[]),{printed_at:new Date().toLocaleString(),printed_by:cu.name||cu.id}];
                setInvs(prev=>prev.map(i=>i.id===inv.id?{...i,print_history:ph}:i));setViewInvoice(v=>({...v,print_history:ph}));
              }}>Print</button>
            <button className="btn btn-sm btn-secondary" style={{fontSize:12,padding:'6px 14px'}}
              onClick={async()=>{
                try{
                  const billToName=inv.billing_name||ic?.name||'';
                  await downloadDoc(buildInvDocOpts(),'Invoice-'+inv.id+(billToName?'-'+billToName:''));
                }catch(err){console.warn('PDF download failed:',err)}
              }}>📥 Download PDF</button>
            {ic?.alpha_tag&&<button className="btn btn-sm btn-secondary" style={{fontSize:12,padding:'6px 14px'}} title="Copy this customer's coach portal link to share"
              onClick={()=>{const purl='https://nationalsportsapparel.com/coach?portal='+ic.alpha_tag;navigator.clipboard.writeText(purl).then(()=>nf('Coach portal link copied!')).catch(()=>{window.prompt('Copy:',purl)})}}>🔗 Copy Portal Link</button>}
            {lineItems.length>=2&&inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:12,padding:'6px 14px',background:'#7c3aed',color:'white',border:'none'}}
              onClick={()=>{
                // If line_items not stored on invoice, populate from computed items before splitting
                const invForSplit=storedLineItems.length>0?inv:{...inv,line_items:lineItems};
                if(!storedLineItems.length&&lineItems.length>0){setInvs(prev=>prev.map(i=>i.id===inv.id?{...i,line_items:lineItems}:i))}
                setSplitModal({inv:invForSplit,selItems:[],memo:inv.memo||''});
              }}>Split Invoice</button>}
            {canDelete&&<button className="btn btn-sm" style={{fontSize:12,padding:'6px 14px',color:'#dc2626',border:'1px solid #fca5a5',background:'white',marginLeft:'auto'}}
              onClick={()=>{deleteInvoice(inv.id);setViewInvoice(null)}}>Delete</button>}
          </div>

          {/* Invoice info grid */}
          <div className="card-body" style={{padding:'20px 24px'}}>
            <div style={{display:'grid',gridTemplateColumns:(inv.shipping_name||inv.shipping_address||invShipSel||ic?.shipping_address_line1)?'1fr 1fr 1fr 1fr 1fr':'1fr 1fr 1fr 1fr',gap:16,marginBottom:20}}>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',marginBottom:2}}>Bill To</div>
                {inv.billing_name?<><div style={{fontSize:14,fontWeight:700}}>{inv.billing_name}</div><div style={{fontSize:11,color:'#64748b'}}>{inv.billing_address||''}</div><div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>on behalf of {ic?.name}</div></>
                :<><div style={{fontSize:14,fontWeight:700}}>{ic?.name||'—'}</div>{ic?.alpha_tag&&<div style={{fontSize:11,color:'#64748b'}}>{ic.alpha_tag}</div>}{ic?.billing_address_line1&&<div style={{fontSize:11,color:'#64748b',marginTop:2}}>{ic.billing_address_line1}{ic.billing_city?', '+ic.billing_city:''}{ic.billing_state?' '+ic.billing_state:''}{ic.billing_zip?' '+ic.billing_zip:''}</div>}</>}
                {(inv._po_number||so?.po_number)&&<div style={{fontSize:11,fontWeight:700,color:'#1e40af',marginTop:4,fontFamily:'monospace'}}>PO# {inv._po_number||so?.po_number}</div>}
                {(()=>{const parentCust2=ic?.parent_id?cust.find(c=>c.id===ic.parent_id):ic;const altAddrs2=(parentCust2?.alt_billing_addresses||[]).filter(a=>a.label||a.street);
                  return altAddrs2.length>0&&<select className="form-select" style={{fontSize:10,marginTop:4,padding:'2px 4px',width:'auto'}} value={inv.billing_name?JSON.stringify({label:inv.billing_name,street:(inv.billing_address||'').split(',')[0]?.trim(),city:(inv.billing_address||'').split(',')[1]?.trim(),state:(inv.billing_address||'').split(',')[2]?.trim(),zip:(inv.billing_address||'').split(',')[3]?.trim()}):''} onChange={e=>{const v=e.target.value;const upd=v?{...inv,billing_name:JSON.parse(v).label,billing_address:[JSON.parse(v).street,JSON.parse(v).city,JSON.parse(v).state,JSON.parse(v).zip].filter(Boolean).join(', ')}:{...inv,billing_name:null,billing_address:null};setInvs(prev=>prev.map(i=>i.id===inv.id?upd:i));setViewInvoice(upd)}}>
                    <option value="">Bill to: {ic?.name}</option>
                    {altAddrs2.map((a,i)=><option key={i} value={JSON.stringify(a)}>{a.label||'Alt '+(i+1)}</option>)}
                  </select>})()}
              </div>
              {(inv.shipping_name||inv.shipping_address||invShipSel||ic?.shipping_address_line1)&&<div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',marginBottom:2}}>Ship To</div>
                {inv.shipping_name||inv.shipping_address?<><div style={{fontSize:14,fontWeight:700}}>{inv.shipping_name||ic?.name||'—'}</div><div style={{fontSize:11,color:'#64748b',whiteSpace:'pre-line'}}>{inv.shipping_address||''}</div>{inv.shipping_name&&<div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>on behalf of {ic?.name}</div>}</>
                :invShipSel?<><div style={{fontSize:14,fontWeight:700}}>{invShipSel.name||ic?.name||'—'}</div><div style={{fontSize:11,color:'#64748b',marginTop:2,whiteSpace:'pre-line'}}>{invShipSel.text||[invShipSel.attention?'Attn: '+invShipSel.attention:null,invShipSel.street,[invShipSel.city,[invShipSel.state,invShipSel.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n')}</div>{invShipSel.name&&invShipSel.name!==ic?.name&&<div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>on behalf of {ic?.name}</div>}</>
                :<><div style={{fontSize:14,fontWeight:700}}>{ic?.name||'—'}</div>{ic?.shipping_attention&&<div style={{fontSize:11,color:'#64748b',marginTop:1}}>Attn: {ic.shipping_attention}</div>}{ic?.shipping_address_line1&&<div style={{fontSize:11,color:'#64748b',marginTop:2}}>{ic.shipping_address_line1}{ic.shipping_city?', '+ic.shipping_city:''}{ic.shipping_state?' '+ic.shipping_state:''}{ic.shipping_zip?' '+ic.shipping_zip:''}</div>}</>}
              </div>}
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',marginBottom:2}}>Invoice Date</div>
                <div style={{fontSize:14,fontWeight:600}}>{inv.date||'—'}</div>
                <div style={{fontSize:11,color:overdue?'#dc2626':'#64748b',fontWeight:overdue?700:400}}>Due: {inv.due_date||'—'}{overdue?' (Overdue)':''}</div>
              </div>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',marginBottom:2}}>Sales Order</div>
                {inv.so_id?<a href={_buildTabHref({so:inv.so_id})} onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)return;e.preventDefault();if(so){setViewInvoice(null);setESO(so);setESOC(ic);setPg('orders')}}} style={{fontSize:14,fontWeight:600,color:'#7c3aed',textDecoration:'underline',cursor:'pointer'}}>{inv.so_id}</a>
                :<div style={{fontSize:14,fontWeight:600,color:'#94a3b8'}}>—</div>}
                <div style={{fontSize:11,color:'#64748b'}}>{inv.memo||''}</div>
              </div>
              <div><div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',marginBottom:2}}>Type / Rep</div>
                <div style={{fontSize:14,fontWeight:600}}>{inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial':inv.inv_type==='full'?'Invoice':'Final'}</div>
                <div style={{fontSize:11,color:'#64748b'}}>Rep: {repObj?.name||'—'}</div>
              </div>
            </div>

            {/* Line items table */}
            <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Line Items{!storedLineItems.length&&lineItems.length>0&&<span style={{fontWeight:400,fontStyle:'italic',marginLeft:6,textTransform:'none'}}>(from Sales Order)</span>}</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                <th style={{padding:'10px 12px',textAlign:'left',fontWeight:700}}>Description</th>
                <th style={{padding:'10px 12px',textAlign:'center',fontWeight:700,width:70}}>Qty</th>
                <th style={{padding:'10px 12px',textAlign:'right',fontWeight:700,width:90}}>Rate</th>
                <th style={{padding:'10px 12px',textAlign:'right',fontWeight:700,width:100}}>Amount</th>
              </tr></thead>
              <tbody>
                {lineItems.map((li,i)=>{
                  const matchDeco=soDecoDetails.find(sd=>sd.sku&&li.desc&&li.desc.startsWith(sd.sku));
                  return<React.Fragment key={i}>
                  <tr style={{borderBottom:(matchDeco||li._decos?.length)?'none':'1px solid #f1f5f9'}}>
                    <td style={{padding:'10px 12px',fontWeight:600}}>{li.desc}</td>
                    <td style={{padding:'10px 12px',textAlign:'center'}}>{li.qty}</td>
                    <td style={{padding:'10px 12px',textAlign:'right'}}>${safeNum(li.rate).toFixed(2)}</td>
                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:600}}>${safeNum(li.amount).toFixed(2)}</td>
                  </tr>
                  {(matchDeco?matchDeco.decos:li._decos||[]).map((dd,di)=><tr key={'d'+di} style={{borderBottom:di===(matchDeco?matchDeco.decos:li._decos||[]).length-1?'1px solid #f1f5f9':'none'}}>
                    <td colSpan={4} style={{padding:'3px 12px 3px 32px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11}}>
                        <span style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:700,whiteSpace:'nowrap',
                          background:dd.type==='screen_print'?'#dbeafe':dd.type==='embroidery'?'#fce7f3':dd.type==='dtf'||dd.type==='heat_press'?'#fef3c7':dd.type==='numbers'?'#e0e7ff':dd.type==='names'?'#ede9fe':'#f1f5f9',
                          color:dd.type==='screen_print'?'#1e40af':dd.type==='embroidery'?'#be185d':dd.type==='dtf'||dd.type==='heat_press'?'#92400e':dd.type==='numbers'?'#4338ca':dd.type==='names'?'#6d28d9':'#64748b'}}>
                          {dd.label}</span>
                        <span style={{color:'#334155',fontWeight:600}}>{dd.position}{dd.artName?' — '+dd.artName:''}</span>
                        <span style={{color:'#64748b'}}>
                          {dd.colors&&dd.colors.length>0&&<span>{dd.colors.length} color{dd.colors.length>1?'s':''}: {dd.colors.join(', ')} · </span>}
                          {dd.stitches&&<span>{dd.stitches.toLocaleString()} stitches · </span>}
                          {dd.dtfSize!=null&&<span>Size: {['Small','Medium','Large','XL','Oversized'][dd.dtfSize]||dd.dtfSize} · </span>}
                          {dd.twoColor&&<span>Two-color · </span>}
                          {dd.numMethod&&<span>{dd.numMethod.replace(/_/g,' ')} {dd.numSize||''} · </span>}
                          {dd.vendor&&<span>Vendor: {dd.vendor} · </span>}
                          {dd.notes&&<span>{dd.notes} · </span>}
                        </span>
                        <span style={{fontWeight:600,color:'#334155',marginLeft:'auto'}}>+${dd.sell.toFixed(2)}/ea</span>
                      </div>
                    </td>
                  </tr>)}
                </React.Fragment>})}
                {lineItems.length===0&&<tr><td colSpan={4} style={{padding:20,textAlign:'center',color:'#94a3b8',fontSize:12}}>No line items recorded</td></tr>}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{marginTop:12,display:'flex',justifyContent:'flex-end'}}>
              <div style={{width:260,borderTop:'2px solid #e2e8f0',paddingTop:12}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                  <span style={{color:'#64748b'}}>Subtotal</span><span style={{fontWeight:600}}>${subtotal.toFixed(2)}</span></div>
                {shipAmt>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                  <span style={{color:'#64748b'}}>Shipping</span><span>${shipAmt.toFixed(2)}</span></div>}
                {taxAmt>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                  <span style={{color:'#64748b'}}>Tax</span><span>${taxAmt.toFixed(2)}</span></div>}
                {inv.inv_type==='deposit'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                  <span style={{color:'#1e40af',fontWeight:600}}>Deposit ({inv.deposit_pct||50}%)</span><span style={{fontWeight:700,color:'#1e40af'}}>${inv.total.toFixed(2)}</span></div>}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:800,paddingTop:8,borderTop:'2px solid #1e3a5f',color:'#1e3a5f'}}>
                  <span>Total</span><span>${inv.total.toFixed(2)}</span></div>
                {inv.paid>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginTop:6}}>
                  <span style={{color:'#166534',fontWeight:600}}>Paid</span><span style={{color:'#166534',fontWeight:600}}>${inv.paid.toLocaleString()}</span></div>}
                {bal>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:800,marginTop:6,color:'#dc2626'}}>
                  <span>Balance Due</span><span>${bal.toLocaleString()}</span></div>}
              </div>
            </div>

          </div>
        </div>

        {/* Payment History */}
        {(inv.payments||[]).length>0&&<div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2 style={{margin:0,fontSize:14}}>Payment History</h2></div>
          <div className="card-body" style={{padding:0}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'#f8fafc'}}><th style={{padding:'8px 12px',textAlign:'left'}}>Date</th><th style={{padding:'8px 12px',textAlign:'right'}}>Amount</th><th style={{padding:'8px 12px',textAlign:'left'}}>Method</th><th style={{padding:'8px 12px',textAlign:'left'}}>Reference</th><th style={{padding:'8px 12px',textAlign:'right'}}>CC Fee</th></tr></thead>
              <tbody>{(inv.payments||[]).map((p,pi)=><tr key={pi} style={{borderBottom:'1px solid #f1f5f9'}}>
                <td style={{padding:'8px 12px'}}>{p.date}</td>
                <td style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#166534'}}>${p.amount.toLocaleString()}</td>
                <td style={{padding:'8px 12px'}}>{PAY_METHODS.find(m=>m.id===p.method)?.icon} {PAY_METHODS.find(m=>m.id===p.method)?.label||p.method}</td>
                <td style={{padding:'8px 12px',color:'#64748b'}}>{p.ref||'—'}</td>
                <td style={{padding:'8px 12px',textAlign:'right',color:'#d97706'}}>{p.cc_fee>0?'$'+p.cc_fee.toFixed(2):'—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>}

        {/* Email status */}
        {inv.email_sent_at&&<div className="card" style={{marginBottom:16}}>
          <div className="card-body" style={{padding:'12px 16px',fontSize:12,color:'#64748b'}}>
            Email sent: {inv.email_sent_at} · Status: <span style={{fontWeight:600,color:'#166534'}}>{inv.email_status||'sent'}</span>
          </div>
        </div>}

        {/* Document History */}
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2 style={{margin:0,fontSize:14}}>Document History</h2></div>
          <div className="card-body" style={{padding:'16px 20px'}}>
            {/* Created */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Created</div>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:6,border:'1px solid #bbf7d0'}}>
                <span style={{fontSize:16}}>📄</span>
                <div><div style={{fontSize:13,fontWeight:600}}>Invoice created</div>
                <div style={{fontSize:11,color:'#64748b'}}>by {REPS.find(r=>r.id===inv.created_by)?.name||inv.created_by||'—'} · {inv.created_at||inv.date||'—'}</div></div>
              </div>
            </div>
            {/* Send History */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Send History</div>
              {(inv.sent_history||[]).length===0&&!inv.email_sent_at?<div style={{fontSize:12,color:'#94a3b8',padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>Not yet sent</div>
              :(inv.sent_history||[]).length>0?(inv.sent_history||[]).map((h,hi)=><div key={hi} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#eff6ff',borderRadius:6,border:'1px solid #bfdbfe',marginBottom:4}}>
                <span style={{fontSize:16}}>✉️</span>
                <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>Sent to coach</div>
                <div style={{fontSize:11,color:'#64748b'}}>{new Date(h.sent_at).toLocaleDateString()} @ {new Date(h.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})} · by {h.sent_by}{h.to?' · → '+h.to:''}</div>
                {h.methods&&<div style={{fontSize:10,color:'#1e40af',marginTop:2}}>{h.methods.join(', ')}</div>}</div>
              </div>):<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#eff6ff',borderRadius:6,border:'1px solid #bfdbfe'}}>
                <span style={{fontSize:16}}>✉️</span>
                <div><div style={{fontSize:13,fontWeight:600}}>Sent</div><div style={{fontSize:11,color:'#64748b'}}>{inv.email_sent_at}</div></div>
              </div>}
              {inv.email_status==='opened'&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#dbeafe',borderRadius:6,border:'1px solid #93c5fd',marginTop:4}}>
                <span style={{fontSize:16}}>👁️</span>
                <div><div style={{fontSize:13,fontWeight:600,color:'#1e40af'}}>Coach opened invoice</div>
                <div style={{fontSize:11,color:'#64748b'}}>{inv.email_opened_at||'Timestamp not recorded'}</div></div>
              </div>}
              {inv.follow_up_at&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:new Date(inv.follow_up_at)<new Date()?'#fef2f2':'#fffbeb',borderRadius:6,border:'1px solid '+(new Date(inv.follow_up_at)<new Date()?'#fecaca':'#fde68a'),marginTop:4}}>
                <span style={{fontSize:16}}>⏰</span>
                <div><div style={{fontSize:13,fontWeight:600,color:new Date(inv.follow_up_at)<new Date()?'#dc2626':'#92400e'}}>Follow-up {new Date(inv.follow_up_at)<new Date()?'overdue':'scheduled'}</div>
                <div style={{fontSize:11,color:'#64748b'}}>{new Date(inv.follow_up_at).toLocaleDateString()}</div></div>
              </div>}
            </div>
            {/* Coach Activity */}
            {(()=>{const coachEvents=[];
              if(inv.email_status==='opened'&&inv.email_opened_at)coachEvents.push({ts:inv.email_opened_at,type:'opened',detail:inv._opened_by_email||(inv.sent_history||[]).slice(-1)[0]?.to||''});
              coachEvents.sort((a,b)=>new Date(b.ts)-new Date(a.ts));
              return coachEvents.length>0&&<div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Coach Activity</div>
              {coachEvents.map((ev,ei)=><div key={ei} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#dbeafe',borderRadius:6,border:'1px solid #93c5fd',marginBottom:4}}>
                <span style={{fontSize:16}}>👁️</span>
                <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>Coach opened email</div>
                <div style={{fontSize:11,color:'#64748b'}}>{ev.detail?ev.detail+' · ':''}{new Date(ev.ts).toLocaleDateString()} @ {new Date(ev.ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}</div></div>
              </div>)}
            </div>})()}
            {/* Print History */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Print History</div>
              {(inv.print_history||[]).length===0?<div style={{fontSize:12,color:'#94a3b8',padding:'8px 12px',background:'#f8fafc',borderRadius:6}}>Not yet printed</div>
              :(inv.print_history||[]).map((h,hi)=><div key={hi} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#f5f3ff',borderRadius:6,border:'1px solid #ddd6fe',marginBottom:4}}>
                <span style={{fontSize:16}}>🖨️</span>
                <div><div style={{fontSize:13,fontWeight:600}}>Printed</div>
                <div style={{fontSize:11,color:'#64748b'}}>{h.printed_at} · by {h.printed_by}</div></div>
              </div>)}
            </div>
            {/* Change Log */}
            <div>
              <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Changes</div>
              {(()=>{const docLogs=changeLog.filter(c=>c.entityId===inv.id);
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
        </div>

        {/* ═══ COSTS BREAKDOWN ═══ */}
        {so&&(()=>{
          const af=safeArt(so);
          const invSkus=lineItems.map(li=>li._sku||li.sku||(li.desc||'').split(' ')[0]).filter(Boolean);
          const costLines=[];
          safeItems(so).forEach((it,ii)=>{
            const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            if(!qty)return;
            // Only include items that appear on this invoice
            const matchesInv=invSkus.length===0||invSkus.some(s=>s===it.sku||(it.sku+' '+it.name).includes(s));
            if(!matchesInv)return;
            const expectedBlank=qty*safeNum(it.nsa_cost);
            const blankPOs=(it.po_lines||[]).filter(pl=>pl.po_type!=='outside_deco');
            const poBlankQty=blankPOs.reduce((a,pl)=>a+Object.entries(pl).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0),0);
            const pickQty=safePicks(it).reduce((a,pk)=>a+Object.entries(pk).filter(([k,v])=>typeof v==='number'&&safeSizes(it)[k]!==undefined).reduce((a2,[,v])=>a2+v,0),0);
            const accountedQty=poBlankQty+pickQty;
            const hasActual=blankPOs.length>0||pickQty>0;
            const billedCostFromPOs=blankPOs.reduce((a,pl)=>a+safeNum(pl._bill_cost||0),0);
            const actualBlank=billedCostFromPOs>0?billedCostFromPOs+(pickQty*safeNum(it.nsa_cost)):(pickQty>0?pickQty*safeNum(it.nsa_cost):0);
            costLines.push({category:'Blanks',sku:it.sku,name:it.name,vendor:D_V.find(v=>v.id===it.vendor_id)?.name||it.brand||'—',
              qty,expected:expectedBlank,actual:actualBlank,poCount:blankPOs.length+(pickQty>0?1:0),
              poIds:blankPOs.map(p=>p.po_id).filter(Boolean).join(', '),
              allReceived:blankPOs.length>0&&blankPOs.every(p=>p.status==='received')});
            const aqMap={};safeItems(so).forEach(sit=>{const sq2=Object.values(safeSizes(sit)).reduce((a2,v2)=>a2+safeNum(v2),0);safeDecos(sit).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){aqMap[d2.art_file_id]=(aqMap[d2.art_file_id]||0)+sq2}})});
            // In-house deco only — outside deco aggregated below at SO level.
            safeDecos(it).forEach(d=>{
              const matchingDPOs=(it.po_lines||[]).filter(pl=>pl.po_type==='outside_deco');
              const isOutside=d.kind==='outside_deco'||matchingDPOs.length>0;
              if(isOutside)return;
              const cq=d.kind==='art'&&d.art_file_id?aqMap[d.art_file_id]:qty;
              const dp=dP(d,qty,af,cq);
              const eqD=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);const expectedDeco=eqD*dp.cost;
              const artF=af.find(a=>a.id===d.art_file_id);
              if(dp.cost>0){
                costLines.push({category:'In-House Deco',
                  sku:it.sku,name:artF?.name||d.deco_type?.replace(/_/g,' ')||'Decoration',
                  vendor:'NSA In-House',
                  qty,expected:expectedDeco,actual:expectedDeco,
                  poCount:0,poIds:'',allReceived:true});
              }
            });
          });
          // Outside deco — aggregate one line per outside-deco PO (or per pending vendor/type).
          // Outside deco — one row per SO-level deco PO (so.deco_pos)
          (so.deco_pos||[]).forEach(dp=>{
            const qty=safeNum(dp.qty||0);
            const unitCost=safeNum(dp.unit_cost||0);
            const expected=safeNum(dp.expected_cost||qty*unitCost);
            const actual=safeNum(dp._bill_cost||0);
            if(expected===0&&actual===0)return;
            const skus=(dp.item_idxs||[]).map(ii=>safeItems(so)[ii]?.sku).filter(Boolean);
            if(invSkus.length>0&&!skus.some(s=>invSkus.includes(s)))return;
            const dtLabel=dp.deco_type?dp.deco_type.replace(/_/g,' '):'';
            costLines.push({category:'Outside Deco',
              sku:skus.join(', ')||'—',
              name:'Outside Deco'+(dtLabel?' — '+dtLabel:''),
              vendor:dp.vendor||'—',qty,
              expected:Math.round(expected*100)/100,
              actual:Math.round(actual*100)/100,
              poCount:1,poIds:dp.po_id||'',
              allReceived:dp.status==='received'});
          });
          if(costLines.length===0)return null;
          const totalExpected=costLines.reduce((a,l)=>a+l.expected,0);
          const totalActual=costLines.reduce((a,l)=>a+l.actual,0);
          const hasActuals=costLines.some(l=>l.actual>0);
          const variance=totalActual-totalExpected;
          const revenue=Math.max(0,safeNum(inv.total)-safeNum(inv.cc_fee||0));// exclude CC surcharges from GP
          const gp=revenue-totalActual;
          const gpPct=revenue>0?(gp/revenue*100):0;
          const cats={};costLines.forEach(l=>{if(!cats[l.category])cats[l.category]={expected:0,actual:0};cats[l.category].expected+=l.expected;cats[l.category].actual+=l.actual});
          return<div className="card" style={{marginBottom:16}}>
            <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h2 style={{margin:0,fontSize:14}}>Cost Breakdown</h2>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {hasActuals&&<span style={{fontSize:12,fontWeight:700,padding:'4px 12px',borderRadius:8,
                  background:gpPct>=30?'#f0fdf4':gpPct>=20?'#fffbeb':'#fef2f2',
                  color:gpPct>=30?'#166534':gpPct>=20?'#92400e':'#dc2626'}}>
                  GP: ${gp.toFixed(2)} ({gpPct.toFixed(1)}%)</span>}
                {hasActuals&&variance!==0&&<span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:6,
                  background:variance>0?'#fef2f2':'#f0fdf4',color:variance>0?'#dc2626':'#166534'}}>
                  {variance>0?'Over':'Under'} by ${Math.abs(variance).toFixed(2)}</span>}
              </div>
            </div>
            <div className="card-body">
              <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                {Object.entries(cats).map(([cat,v])=>{const diff=v.actual-v.expected;
                  return<div key={cat} style={{padding:'10px 14px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',minWidth:140,flex:1}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>{cat}</div>
                    <div style={{display:'flex',gap:12}}>
                      <div><div style={{fontSize:9,color:'#94a3b8'}}>Expected</div><div style={{fontSize:14,fontWeight:700,color:'#475569'}}>${v.expected.toFixed(2)}</div></div>
                      <div><div style={{fontSize:9,color:'#94a3b8'}}>Actual</div><div style={{fontSize:14,fontWeight:700,color:v.actual>0?'#0f172a':'#94a3b8'}}>{v.actual>0?'$'+v.actual.toFixed(2):'—'}</div></div>
                      {v.actual>0&&diff!==0&&<div><div style={{fontSize:9,color:'#94a3b8'}}>Var</div><div style={{fontSize:14,fontWeight:700,color:diff>0?'#dc2626':'#166534'}}>{diff>0?'+':''}${diff.toFixed(2)}</div></div>}
                    </div>
                  </div>})}
                <div style={{padding:'10px 14px',background:gpPct>=30?'#f0fdf4':'#fffbeb',borderRadius:8,border:'2px solid '+(gpPct>=30?'#86efac':'#fde68a'),minWidth:140}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>Invoice Total vs Cost</div>
                  <div style={{display:'flex',gap:12}}>
                    <div><div style={{fontSize:9,color:'#94a3b8'}}>Revenue</div><div style={{fontSize:14,fontWeight:700}}>${revenue.toFixed(2)}</div></div>
                    <div><div style={{fontSize:9,color:'#94a3b8'}}>Cost</div><div style={{fontSize:14,fontWeight:700,color:totalActual>0?'#0f172a':'#94a3b8'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</div></div>
                    {totalActual>0&&<div><div style={{fontSize:9,color:'#94a3b8'}}>GP</div><div style={{fontSize:14,fontWeight:800,color:gpPct>=30?'#166534':gpPct>=20?'#92400e':'#dc2626'}}>{gpPct.toFixed(1)}%</div></div>}
                  </div>
                </div>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{borderBottom:'2px solid #e2e8f0'}}><th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>Category</th><th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>Item / Service</th><th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>Vendor</th><th style={{padding:'6px 8px',textAlign:'right',fontSize:10,color:'#64748b'}}>Qty</th><th style={{padding:'6px 8px',textAlign:'right',fontSize:10,color:'#64748b'}}>Expected</th><th style={{padding:'6px 8px',textAlign:'right',fontSize:10,color:'#64748b'}}>Actual</th><th style={{padding:'6px 8px',textAlign:'right',fontSize:10,color:'#64748b'}}>Variance</th><th style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'#64748b'}}>PO(s)</th></tr></thead>
                <tbody>{costLines.map((l,i)=>{const diff=l.actual-l.expected;
                  return<tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{padding:'6px 8px'}}><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,fontWeight:600,
                      background:l.category==='Blanks'?'#dbeafe':l.category==='Outside Deco'?'#ede9fe':'#fef3c7',
                      color:l.category==='Blanks'?'#1e40af':l.category==='Outside Deco'?'#7c3aed':'#92400e'}}>{l.category}</span></td>
                    <td style={{padding:'6px 8px'}}><span style={{fontFamily:'monospace',fontWeight:700,color:'#475569',marginRight:6}}>{l.sku}</span>{l.name}</td>
                    <td style={{padding:'6px 8px',color:'#64748b'}}>{l.vendor}</td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600}}>{l.qty}</td>
                    <td style={{padding:'6px 8px',textAlign:'right'}}>${l.expected.toFixed(2)}</td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:l.actual>0?'#0f172a':'#94a3b8'}}>{l.actual>0?'$'+l.actual.toFixed(2):'—'}</td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:diff>0?'#dc2626':diff<0?'#166534':'#94a3b8'}}>{l.poCount>0?(diff>0?'+':'')+'$'+diff.toFixed(2):'—'}</td>
                    <td style={{padding:'6px 8px',fontSize:11,color:'#7c3aed',fontWeight:600}}>{l.poIds||<span style={{color:'#94a3b8'}}>No PO</span>}</td>
                  </tr>})}</tbody>
                <tfoot><tr style={{fontWeight:800,borderTop:'2px solid #e2e8f0'}}>
                  <td colSpan={4} style={{padding:'8px 8px',textAlign:'right'}}>TOTALS</td>
                  <td style={{padding:'8px 8px',textAlign:'right'}}>${totalExpected.toFixed(2)}</td>
                  <td style={{padding:'8px 8px',textAlign:'right'}}>{totalActual>0?'$'+totalActual.toFixed(2):'—'}</td>
                  <td style={{padding:'8px 8px',textAlign:'right',color:variance>0?'#dc2626':variance<0?'#166534':'#94a3b8'}}>{hasActuals?(variance>0?'+':'')+'$'+variance.toFixed(2):'—'}</td>
                  <td></td>
                </tr></tfoot>
              </table>
            </div>
          </div>})()}

        {/* ═══ SPLIT INVOICE MODAL ═══ */}
        {splitModal&&(()=>{
          const si=splitModal.inv;
          const siItems=si.line_items||[];
          const selItems=splitModal.selItems||[];
          const selSub=selItems.reduce((a,idx)=>a+safeNum(siItems[idx]?.amount),0);
          const totalSub=siItems.reduce((a,li)=>a+safeNum(li.amount),0)||1;
          const remainSub=totalSub-selSub;
          const pctSel=selSub/totalSub;
          const pctRemain=remainSub/totalSub;
          const selShip=Math.round((si.shipping||0)*pctSel*100)/100;
          const remainShip=Math.round((si.shipping||0)*pctRemain*100)/100;
          const selTax=Math.round((si.tax||0)*pctSel*100)/100;
          const remainTax=Math.round((si.tax||0)*pctRemain*100)/100;
          const selTotal=Math.round((selSub+selShip+selTax)*100)/100;
          const remainTotal=Math.round((remainSub+remainShip+remainTax)*100)/100;
          return<div className="modal-overlay" onClick={()=>setSplitModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:650,maxHeight:'90vh',overflow:'auto'}}>
            <div className="modal-header" style={{background:'#7c3aed',color:'white'}}><h2 style={{color:'white'}}>Split Invoice — {si.id}</h2><button className="modal-close" style={{color:'white'}} onClick={()=>setSplitModal(null)}>x</button></div>
            <div className="modal-body">
              <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>Select which items stay on <strong>{si.id}</strong>. Unselected items will go to a new invoice. Shipping and tax are split proportionally.</div>
              <div style={{marginBottom:12}}>
                <label className="form-label">Split Memo</label>
                <input className="form-input" value={splitModal.memo} onChange={e=>setSplitModal(s=>({...s,memo:e.target.value}))} placeholder="Optional memo for split invoices"/>
              </div>
              <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden',marginBottom:16}}>
                {siItems.map((li,idx)=>{
                  const sel=selItems.includes(idx);
                  return<div key={idx} style={{padding:'10px 14px',borderBottom:idx<siItems.length-1?'1px solid #f1f5f9':'none',display:'flex',alignItems:'center',gap:10,cursor:'pointer',background:sel?'#f5f3ff':'white'}}
                    onClick={()=>setSplitModal(s=>({...s,selItems:sel?selItems.filter(i=>i!==idx):[...selItems,idx]}))}>
                    <input type="checkbox" checked={sel} readOnly style={{accentColor:'#7c3aed',width:16,height:16}}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:12}}>{li.desc}</div>
                      <div style={{fontSize:11,color:'#64748b'}}>Qty: {li.qty} · ${safeNum(li.rate).toFixed(2)}/ea</div>
                    </div>
                    <div style={{fontWeight:700,fontSize:13,color:sel?'#7c3aed':'#94a3b8'}}>${safeNum(li.amount).toFixed(2)}</div>
                  </div>})}
              </div>
              {/* Split preview */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div style={{padding:12,background:'#f5f3ff',borderRadius:8,border:'1px solid #ddd6fe'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#7c3aed',marginBottom:6}}>{si.id} (Original)</div>
                  <div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Items</span><span style={{fontWeight:600}}>{selItems.length}</span></div>
                  <div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Subtotal</span><span>${selSub.toFixed(2)}</span></div>
                  {selShip>0&&<div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Shipping</span><span>${selShip.toFixed(2)}</span></div>}
                  {selTax>0&&<div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Tax</span><span>${selTax.toFixed(2)}</span></div>}
                  <div style={{fontSize:14,fontWeight:800,borderTop:'1px solid #c4b5fd',marginTop:4,paddingTop:4,display:'flex',justifyContent:'space-between'}}><span>Total</span><span>${selTotal.toFixed(2)}</span></div>
                </div>
                <div style={{padding:12,background:'#eff6ff',borderRadius:8,border:'1px solid #bfdbfe'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#2563eb',marginBottom:6}}>New Invoice</div>
                  <div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Items</span><span style={{fontWeight:600}}>{siItems.length-selItems.length}</span></div>
                  <div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Subtotal</span><span>${remainSub.toFixed(2)}</span></div>
                  {remainShip>0&&<div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Shipping</span><span>${remainShip.toFixed(2)}</span></div>}
                  {remainTax>0&&<div style={{fontSize:12,display:'flex',justifyContent:'space-between'}}><span>Tax</span><span>${remainTax.toFixed(2)}</span></div>}
                  <div style={{fontSize:14,fontWeight:800,borderTop:'1px solid #93c5fd',marginTop:4,paddingTop:4,display:'flex',justifyContent:'space-between'}}><span>Total</span><span>${remainTotal.toFixed(2)}</span></div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setSplitModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#7c3aed'}} disabled={selItems.length===0||selItems.length===siItems.length}
                onClick={()=>splitInvoice(si,selItems,splitModal.memo)}>Split Invoice</button>
            </div>
          </div></div>})()}

        {/* ═══ EDIT INVOICE MODAL ═══ */}
        {invEditModal&&(()=>{
          const em=invEditModal;
          const emCust=cust.find(c=>c.id===em.customer_id);
          const custMatches=em.customerSearch?cust.filter(c=>{const q2=em.customerSearch.toLowerCase();return(c.name||'').toLowerCase().includes(q2)||(c.alpha_tag||'').toLowerCase().includes(q2)||(c.id||'').toLowerCase().includes(q2)}).slice(0,10):[];
          const emSubtotal=em.line_items.reduce((a,l)=>a+safeNum(l.amount),0);
          const emTotal=Math.round((emSubtotal+safeNum(em.shipping)+safeNum(em.tax)-safeNum(em.inv.credit_amount))*100)/100;
          const updateLine=(i,patch)=>setInvEditModal(s=>{
            const next=[...s.line_items];
            const merged={...next[i],...patch};
            if(patch.qty!==undefined||patch.rate!==undefined){merged.amount=Math.round(safeNum(merged.qty)*safeNum(merged.rate)*100)/100}
            next[i]=merged;return{...s,line_items:next};
          });
          const addLine=()=>setInvEditModal(s=>({...s,line_items:[...s.line_items,{desc:'',qty:1,rate:0,amount:0,_sku:'',_name:'',_color:''}]}));
          const rmLine=i=>setInvEditModal(s=>({...s,line_items:s.line_items.filter((_,x)=>x!==i)}));
          return<div className="modal-overlay" onClick={()=>setInvEditModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:980,maxHeight:'92vh',display:'flex',flexDirection:'column'}}>
          <div className="modal-header"><h2>Edit Invoice — {em.inv.id}</h2><button className="modal-close" onClick={()=>setInvEditModal(null)}>x</button></div>
          <div className="modal-body" style={{overflow:'auto',flex:1}}>
            {/* Customer */}
            <div style={{marginBottom:14,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
              <label className="form-label" style={{fontWeight:700}}>Customer</label>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:em.customerSearchOpen?8:0}}>
                <div style={{flex:1,fontSize:13}}>{emCust?<><strong>{emCust.name}</strong>{emCust.alpha_tag?<span style={{color:'#64748b'}}> — {emCust.alpha_tag}</span>:null}</>:<span style={{color:'#94a3b8'}}>No customer</span>}</div>
                <button className="btn btn-sm btn-secondary" onClick={()=>setInvEditModal(s=>({...s,customerSearchOpen:!s.customerSearchOpen,customerSearch:''}))} style={{fontSize:11}}>{em.customerSearchOpen?'Cancel':'Change'}</button>
              </div>
              {em.customerSearchOpen&&<div>
                <input className="form-input" autoFocus placeholder="Search customers by name, alpha tag, or ID..." value={em.customerSearch} onChange={e=>setInvEditModal(s=>({...s,customerSearch:e.target.value}))} style={{fontSize:13}}/>
                {custMatches.length>0&&<div style={{marginTop:6,maxHeight:200,overflow:'auto',border:'1px solid #e2e8f0',borderRadius:6,background:'white'}}>
                  {custMatches.map(c=><div key={c.id} onClick={()=>{
                    // Switching customer clears overrides so the new customer's address shows through.
                    setInvEditModal(s=>({...s,customer_id:c.id,billing_name:'',billing_address:'',shipping_name:'',shipping_address:'',customerSearchOpen:false,customerSearch:''}));
                  }} style={{padding:'8px 10px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                    <div style={{fontWeight:600}}>{c.name}{c.alpha_tag?<span style={{color:'#64748b',fontWeight:400}}> — {c.alpha_tag}</span>:null}</div>
                    <div style={{fontSize:10,color:'#94a3b8'}}>{c.id}</div>
                  </div>)}
                </div>}
                {em.customerSearch&&custMatches.length===0&&<div style={{marginTop:6,fontSize:11,color:'#94a3b8'}}>No matches.</div>}
              </div>}
            </div>

            {/* Memo + Invoice Date + Due Date + Shipping + Tax */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 140px 140px 120px 120px',gap:10,marginBottom:14}}>
              <div><label className="form-label">Memo</label>
                <input className="form-input" value={em.memo} onChange={e=>setInvEditModal(s=>({...s,memo:e.target.value}))} placeholder="Invoice memo"/></div>
              <div><label className="form-label">Invoice Date</label>
                <input className="form-input" type="date" value={(()=>{const d=em.date;if(!d)return'';const m=d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(m){const yr=m[3].length===2?'20'+m[3]:m[3];return yr+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')}return /^\d{4}-\d{2}-\d{2}/.test(d)?d.slice(0,10):''})()}
                  onChange={e=>{const v=e.target.value;setInvEditModal(s=>({...s,date:v||''}))}}/></div>
              <div><label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={(()=>{const d=em.due_date;if(!d)return'';const m=d.match(/(\d{2})\/(\d{2})\/(\d{2})/);return m?'20'+m[3]+'-'+m[1]+'-'+m[2]:d})()}
                  onChange={e=>{const v=e.target.value;if(!v){setInvEditModal(s=>({...s,due_date:''}));return}const d=new Date(v+'T12:00:00');setInvEditModal(s=>({...s,due_date:d.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'})}))}}/></div>
              <div><label className="form-label">Shipping</label>
                <input className="form-input" type="number" step="0.01" value={em.shipping} onChange={e=>setInvEditModal(s=>({...s,shipping:e.target.value===''?'':parseFloat(e.target.value)||0}))}/></div>
              <div><label className="form-label">Tax</label>
                <input className="form-input" type="number" step="0.01" value={em.tax} onChange={e=>setInvEditModal(s=>({...s,tax:e.target.value===''?'':parseFloat(e.target.value)||0}))}/></div>
            </div>

            {/* Bill To / Ship To selector */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
              <div style={{padding:12,background:'#fefce8',borderRadius:8,border:'1px solid #fde68a'}}>
                <label className="form-label" style={{fontWeight:700,marginBottom:6,color:'#92400e'}}>Bill To</label>
                {(()=>{
                  const parentC=emCust?.parent_id?cust.find(c=>c.id===emCust.parent_id):emCust;
                  const altAddrs=(parentC?.alt_billing_addresses||[]).filter(a=>a.label||a.street);
                  const defaultLabel='Customer default'+(emCust?.billing_address_line1?' — '+emCust.billing_address_line1+(emCust.billing_city?', '+emCust.billing_city:'')+(emCust.billing_state?' '+emCust.billing_state:''):' (no address on file)');
                  const matchingAlt=em.billing_name&&!em.billing_custom?altAddrs.find(a=>(a.label||'')===em.billing_name):null;
                  const selValue=em.billing_custom?'__custom__':matchingAlt?JSON.stringify(matchingAlt):'';
                  return<>
                    <select className="form-select" value={selValue} onChange={e=>{
                      const v=e.target.value;
                      if(v==='__custom__')setInvEditModal(s=>({...s,billing_custom:true,billing_name:s.billing_name||emCust?.name||'',billing_address:s.billing_address||''}));
                      else if(v==='')setInvEditModal(s=>({...s,billing_custom:false,billing_name:'',billing_address:''}));
                      else{const a=JSON.parse(v);setInvEditModal(s=>({...s,billing_custom:false,billing_name:a.label||'',billing_address:[a.street,a.city,a.state,a.zip].filter(Boolean).join(', ')}))}
                    }} style={{fontSize:12}}>
                      <option value="">{defaultLabel}</option>
                      {altAddrs.map((a,i)=><option key={i} value={JSON.stringify(a)}>{(a.label||'Alt '+(i+1))+' — '+[a.street,a.city,a.state,a.zip].filter(Boolean).join(', ')}</option>)}
                      <option value="__custom__">✏️ Custom address...</option>
                    </select>
                    {em.billing_custom&&<>
                      <input className="form-input" placeholder="Bill to name" value={em.billing_name} onChange={e=>setInvEditModal(s=>({...s,billing_name:e.target.value}))} style={{fontSize:12,marginTop:6}}/>
                      <textarea className="form-input" placeholder="Bill to address (one address per invoice)" value={em.billing_address} onChange={e=>setInvEditModal(s=>({...s,billing_address:e.target.value}))} style={{fontSize:12,marginTop:6,minHeight:50}} rows={3}/>
                    </>}
                  </>;
                })()}
              </div>
              <div style={{padding:12,background:'#ecfdf5',borderRadius:8,border:'1px solid #a7f3d0'}}>
                <label className="form-label" style={{fontWeight:700,marginBottom:6,color:'#065f46'}}>Ship To</label>
                {(()=>{
                  const defaultLabel='Customer default'+(emCust?.shipping_address_line1?' — '+emCust.shipping_address_line1+(emCust.shipping_city?', '+emCust.shipping_city:'')+(emCust.shipping_state?' '+emCust.shipping_state:''):' (no address on file)');
                  const selValue=em.shipping_custom?'__custom__':'';
                  return<>
                    <select className="form-select" value={selValue} onChange={e=>{
                      const v=e.target.value;
                      if(v==='__custom__')setInvEditModal(s=>({...s,shipping_custom:true,shipping_name:s.shipping_name||emCust?.name||'',shipping_address:s.shipping_address||''}));
                      else setInvEditModal(s=>({...s,shipping_custom:false,shipping_name:'',shipping_address:''}));
                    }} style={{fontSize:12}}>
                      <option value="">{defaultLabel}</option>
                      <option value="__custom__">✏️ Custom address...</option>
                    </select>
                    {em.shipping_custom&&<>
                      <input className="form-input" placeholder="Ship to name" value={em.shipping_name} onChange={e=>setInvEditModal(s=>({...s,shipping_name:e.target.value}))} style={{fontSize:12,marginTop:6}}/>
                      <textarea className="form-input" placeholder="Ship to address" value={em.shipping_address} onChange={e=>setInvEditModal(s=>({...s,shipping_address:e.target.value}))} style={{fontSize:12,marginTop:6,minHeight:50}} rows={3}/>
                    </>}
                  </>;
                })()}
              </div>
            </div>

            {/* Line items */}
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <label className="form-label" style={{margin:0,fontWeight:700}}>Line Items</label>
                <button className="btn btn-sm btn-secondary" onClick={addLine} style={{fontSize:11}}>+ Add Line</button>
              </div>
              <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 70px 90px 90px 32px',gap:0,background:'#f1f5f9',padding:'8px 10px',fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase'}}>
                  <div>Description</div><div style={{textAlign:'center'}}>Qty</div><div style={{textAlign:'right'}}>Rate</div><div style={{textAlign:'right'}}>Amount</div><div></div>
                </div>
                {em.line_items.length===0&&<div style={{padding:'14px 10px',fontSize:12,color:'#94a3b8',textAlign:'center'}}>No line items. Click "+ Add Line" to add one.</div>}
                {em.line_items.map((li,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 70px 90px 90px 32px',gap:6,padding:'8px 10px',alignItems:'center',borderTop:'1px solid #f1f5f9'}}>
                  <input className="form-input" value={li.desc||''} onChange={e=>updateLine(i,{desc:e.target.value})} style={{fontSize:12}} placeholder="Description"/>
                  <input className="form-input" type="number" min="0" value={li.qty||0} onChange={e=>updateLine(i,{qty:parseFloat(e.target.value)||0})} style={{fontSize:12,textAlign:'center'}}/>
                  <input className="form-input" type="number" step="0.01" min="0" value={li.rate||0} onChange={e=>updateLine(i,{rate:parseFloat(e.target.value)||0})} style={{fontSize:12,textAlign:'right'}}/>
                  <div style={{fontSize:12,textAlign:'right',fontWeight:600,padding:'6px 8px'}}>${safeNum(li.amount).toFixed(2)}</div>
                  <button onClick={()=>rmLine(i)} title="Remove line" style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:18,padding:0,lineHeight:1}}>×</button>
                </div>)}
              </div>
              {em.inv.so_id&&<div style={{fontSize:11,color:'#64748b',marginTop:6,fontStyle:'italic'}}>Lines removed here become available to invoice again from <strong>{em.inv.so_id}</strong>.</div>}
            </div>

            {/* Totals preview */}
            <div style={{display:'flex',justifyContent:'flex-end',padding:12,background:'#f8fafc',borderRadius:8}}>
              <div style={{minWidth:240}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}><span style={{color:'#64748b'}}>Subtotal</span><span style={{fontWeight:600}}>${emSubtotal.toFixed(2)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}><span style={{color:'#64748b'}}>Shipping</span><span>${safeNum(em.shipping).toFixed(2)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}><span style={{color:'#64748b'}}>Tax</span><span>${safeNum(em.tax).toFixed(2)}</span></div>
                {safeNum(em.inv.credit_amount)>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3,color:'#065f46'}}><span>Credit</span><span>-${safeNum(em.inv.credit_amount).toFixed(2)}</span></div>}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:15,fontWeight:800,paddingTop:6,borderTop:'2px solid #cbd5e1',color:'#1e3a5f'}}><span>New Total</span><span>${emTotal.toFixed(2)}</span></div>
                {Math.abs(emTotal-em.inv.total)>0.01&&<div style={{fontSize:10,color:'#dc2626',textAlign:'right',marginTop:3}}>Was ${safeNum(em.inv.total).toFixed(2)}</div>}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setInvEditModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={async()=>{
              // Strip transient UI fields off line items before persisting
              const cleanLines=em.line_items.map(li=>{const{...keep}=li;return keep});
              const updated={...em.inv,
                customer_id:em.customer_id,
                memo:em.memo,
                date:em.date,
                due_date:em.due_date,
                billing_name:em.billing_name||null,
                billing_address:em.billing_address||null,
                shipping_name:em.shipping_name||null,
                shipping_address:em.shipping_address||null,
                shipping:safeNum(em.shipping),
                tax:safeNum(em.tax),
                line_items:cleanLines,
                total:emTotal,
                updated_at:new Date().toLocaleString()};
              setInvs(prev=>prev.map(i=>i.id===em.inv.id?updated:i));
              setViewInvoice(updated);
              setInvEditModal(null);
              nf('Invoice '+em.inv.id+' updated');
              try{await _dbSaveInvoice(updated)}catch(err){console.warn('[invoice save]',err);nf('Saved locally — DB sync failed: '+err.message,'error')}
            }}>Save Changes</button>
          </div>
        </div></div>})()}

        {/* ═══ SEND INVOICE MODAL (from detail page) ═══ */}
        {invSendModalDirect&&(()=>{
          const si=invSendModalDirect;
          const siRecipients=[...Object.entries(si.checked||{}).filter(([,v])=>v).map(([k])=>k),...(si.customEmails||[])];
          return<div className="modal-overlay" onClick={()=>setInvSendModalDirect(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
            <div className="modal-header"><h2>Send Invoice — {si.inv.id}</h2><button className="modal-close" onClick={()=>setInvSendModalDirect(null)}>x</button></div>
            <div className="modal-body">
              <div style={{marginBottom:12}}><label className="form-label">Send To</label>
                <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:6}}>
                  {(si.sendContacts||[]).length===0&&(si.customEmails||[]).length===0&&<div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No contacts with email on file — add one below.</div>}
                  {(si.sendContacts||[]).map(ct=>{
                    const sel=!!si.checked[ct.email];
                    return<label key={ct.email} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',borderRadius:4,background:sel?'#eff6ff':'transparent',fontSize:12,cursor:'pointer'}}>
                      <input type="checkbox" checked={sel} onChange={e=>setInvSendModalDirect(s=>({...s,checked:{...s.checked,[ct.email]:e.target.checked}}))} style={{accentColor:'#2563eb'}}/>
                      <span style={{fontWeight:sel?600:400,color:sel?'#1e40af':'#1e293b'}}>{ct.name||'Contact'}</span>
                      <span style={{color:'#64748b'}}>{ct.email}</span>
                      {ct.role&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:(ct.role||'').toLowerCase()==='billing'?'#ede9fe':'#f1f5f9',color:(ct.role||'').toLowerCase()==='billing'?'#6d28d9':'#64748b',fontWeight:600}}>{ct.role}</span>}
                      {ct._inherited_from&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#ede9fe',color:'#6d28d9',fontWeight:600}}>from {ct._inherited_from}</span>}
                    </label>;
                  })}
                  {(si.customEmails||[]).map(em=><label key={em} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',borderRadius:4,background:'#eff6ff',fontSize:12}}>
                    <input type="checkbox" checked readOnly style={{accentColor:'#2563eb'}}/>
                    <span style={{color:'#1e40af',fontWeight:600}}>{em}</span>
                    <span style={{fontSize:9,fontStyle:'italic',color:'#94a3b8'}}>(added)</span>
                    <button onClick={()=>setInvSendModalDirect(s=>({...s,customEmails:s.customEmails.filter(e=>e!==em)}))} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:14,padding:0,lineHeight:1}}>×</button>
                  </label>)}
                </div>
                <div style={{display:'flex',gap:6}}>
                  <input type="email" placeholder="+ Add another email…" value={si.customEmail||''} onChange={e=>setInvSendModalDirect(s=>({...s,customEmail:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&(si.customEmail||'').includes('@')){e.preventDefault();const em=si.customEmail.trim();if(em)setInvSendModalDirect(s=>({...s,customEmails:s.customEmails.includes(em)?s.customEmails:[...s.customEmails,em],customEmail:''}))}}} className="form-input" style={{fontSize:11,padding:'4px 6px',flex:1}}/>
                  <button className="btn btn-sm btn-secondary" disabled={!(si.customEmail||'').includes('@')} onClick={()=>{const em=(si.customEmail||'').trim();if(em)setInvSendModalDirect(s=>({...s,customEmails:s.customEmails.includes(em)?s.customEmails:[...s.customEmails,em],customEmail:''}))}} style={{fontSize:10,whiteSpace:'nowrap'}}>+ Add</button>
                </div>
              </div>
              <div style={{marginBottom:12}}><label className="form-label">Message</label>
                <textarea className="form-input" rows={6} value={si.msg} onChange={e=>setInvSendModalDirect(s=>({...s,msg:e.target.value}))} style={{lineHeight:1.5}}/></div>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:12,padding:10,background:si.review?'#eff6ff':'#f8fafc',border:'1px solid '+(si.review?'#93c5fd':'#e2e8f0'),borderRadius:8}}>
                <input type="checkbox" checked={!!si.review} onChange={e=>setInvSendModalDirect(s=>({...s,review:e.target.checked}))} style={{width:16,height:16,accentColor:'#2563eb'}}/>
                <span style={{fontSize:13,fontWeight:600,color:si.review?'#1e40af':'#475569'}}>★ Include “Leave us a Google review” button</span>
              </label>
              {/* SMS Toggle — hidden via _smsUiEnabled flag while SMS sending is unreliable */}
              {_smsUiEnabled&&<div style={{marginBottom:12,padding:12,background:si.smsEnabled?'#f0fdf4':'#f8fafc',border:'1px solid '+(si.smsEnabled?'#86efac':'#e2e8f0'),borderRadius:8}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:si.smsEnabled?10:0}}>
                  <input type="checkbox" checked={si.smsEnabled||false} onChange={e=>setInvSendModalDirect(s=>({...s,smsEnabled:e.target.checked}))} style={{width:16,height:16,accentColor:'#22c55e'}}/>
                  <span style={{fontWeight:700,fontSize:13,color:si.smsEnabled?'#166534':'#64748b'}}>Also Text Coach</span>
                  {_brevoKey&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#dcfce7',color:'#166534',fontWeight:600}}>Sends directly</span>}
                </label>
                {si.smsEnabled&&<div>
                  <div style={{marginBottom:8}}><label className="form-label" style={{fontSize:11}}>Phone</label><input className="form-input" value={si.smsPhone||''} onChange={e=>setInvSendModalDirect(s=>({...s,smsPhone:e.target.value}))} placeholder="Phone number" style={{fontSize:12}}/></div>
                  <div><label className="form-label" style={{fontSize:11}}>Text Message <span style={{color:'#94a3b8',fontWeight:400}}>({(si.smsMsg||'').length}/160)</span></label><textarea className="form-input" rows={2} value={si.smsMsg||''} onChange={e=>setInvSendModalDirect(s=>({...s,smsMsg:e.target.value}))} maxLength={160} style={{fontSize:12,resize:'vertical'}}/></div>
                </div>}
              </div>}
              {/* Automated follow-ups (server sweep) — falls back to the manual todo reminder below when off */}
              <div style={{marginBottom:12}}>
                <FollowUpAutoPanel value={si.followUp} onChange={val=>setInvSendModalDirect(s=>({...s,followUp:val}))} defaultMessage={'Hi '+((si.sendContacts||[])[0]?.name||'Coach')+',\n\nJust a friendly reminder that invoice '+si.inv.id+' is still open. When you have a moment, please review and submit payment — let us know if you have any questions!\n\nThank you,\nNSA Team'}/>
              </div>
              {!si.followUp?.auto&&<div style={{marginBottom:12,padding:12,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8}}>
                <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:13,color:'#92400e'}}>Follow-up Reminder</span>
                </label>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <select className="form-input" value={si.followUpDays||0} onChange={e=>setInvSendModalDirect(s=>({...s,followUpDays:parseInt(e.target.value)}))} style={{fontSize:12,width:'auto'}}>
                    <option value={0}>No follow-up</option>
                    <option value={3}>3 days</option>
                    <option value={5}>5 days</option>
                    <option value={7}>7 days</option>
                    <option value={10}>10 days</option>
                    <option value={14}>14 days</option>
                    <option value={21}>21 days</option>
                    <option value={30}>30 days</option>
                  </select>
                  <span style={{fontSize:11,color:'#92400e'}}>Create todo if no response</span>
                </div>
              </div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setInvSendModalDirect(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#2563eb'}} disabled={siRecipients.length===0} onClick={async()=>{
                setInvSendModalDirect(null);
                const toEmails=siRecipients;
                const toEmail=toEmails[0];
                const siInv=si.inv;const siSo=sos.find(s=>s.id===siInv.so_id);const siCust=cust.find(c=>c.id===siInv.customer_id);
                const _$si=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
                const siBillName=siInv.billing_name||siCust?.name||'—';
                const siBal=siInv.total-(siInv.paid||0);
                const siShip=siInv.shipping||0;const siTax=siInv.tax||0;
                const siRepObj=REPS.find(r=>r.id===(siCust?.primary_rep_id||siSo?.created_by))||null;
                const siPoNum=siInv._po_number||siSo?.po_number;
                const siBillSub=siInv.billing_name?(siInv.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+siCust?.name+'</span>':'';
                const siBillAddr=siBillSub||(siCust?.billing_address_line1?siCust.billing_address_line1+(siCust.billing_city?'<br/>'+siCust.billing_city+(siCust.billing_state?' '+siCust.billing_state:'')+(siCust.billing_zip?' '+siCust.billing_zip:''):'')+'<br/>United States':'');
                const siShipName=siInv.shipping_name||(!siInv.shipping_address?resolveOrderShipTo(siSo,siCust)?.name:null)||siCust?.name||'—';
                const siShipAddr=(siInv.shipping_name||siInv.shipping_address?(siInv.shipping_address||'').replace(/\n/g,'<br/>'):'')||orderShipToSub(siSo,siCust)||custShipAddrSub(siCust);
                // Build rows from the invoice's own line items (honors per-line price overrides)
                const {rows:siRows,subtotal:siSubTotal}=buildInvoicePdfRows(siInv,siSo,_$si);
                // Build PDF attachment
                const brevoAttachments=[];
                try{
                  const docHtml=buildDocHtml({title:siBillName,docNum:siInv.id,docType:'INVOICE',date:siInv.date,css:PRINT_CSS,
                    headerRight:'<div class="ta">'+_$si(siInv.total)+'</div><div class="ts">Balance Due: <strong>'+_$si(siBal)+'</strong></div>'+(siPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+siPoNum+'</div>':''),
                    infoBoxes:[
                      {label:'Bill To',value:siBillName,sub:siBillAddr},
                      ...(siShipAddr?[{label:'Ship To',value:siShipName,sub:siShipAddr}]:[]),
                      {label:'Invoice Date',value:siInv.date||'—',sub:siInv.due_date?'Due: '+siInv.due_date:''},
                      {label:'PO Number',value:siPoNum||'—'},
                      {label:'Payment Terms',value:siInv.inv_type==='deposit'?(siInv.deposit_pct||50)+'% Deposit':siInv.inv_type==='partial'?'Partial Invoice':siInv.inv_type==='full'?'Invoice':'Final Invoice',sub:'Rep: '+(siRepObj?.name||'—')}
                    ],
                    tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
                      rows:[...siRows,
                        {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$si(siSubTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                        ...(siShip>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$si(siShip),style:'text-align:right;border:none'}]}]:[]),
                        ...(siTax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$si(siTax),style:'text-align:right;border:none'}]}]:[]),
                        ...(safeNum(siInv.credit_amount)>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$si(safeNum(siInv.credit_amount))+'</strong>',style:'text-align:right;border:none'}]}]:[]),
                        {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$si(siInv.total)+'</strong>',style:'text-align:right'}]},
                        ...(siInv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$si(siInv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
                        ...(siBal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$si(siBal)+'</strong>',style:'text-align:right'}]}]:[]),
                      ]}],footer:siInv.inv_type==='deposit'?companyInfo.depositTerms:companyInfo.terms,companyInfo:companyInfo});
                  const styleMatch=docHtml.match(/<style>([\s\S]*?)<\/style>/);const bodyMatch=docHtml.match(/<body>([\s\S]*?)<\/body>/);
                  const pdfFixCss='.header{display:table!important;width:100%!important;table-layout:fixed}.header>*{display:table-cell!important;vertical-align:top!important}.logo{width:55%!important}.logo img{height:50px;vertical-align:middle;margin-right:8px;float:left}.doc-id{width:45%!important;text-align:right!important}.bill-total{display:table!important;width:100%!important;table-layout:fixed}.bill-total>*{display:table-cell!important;vertical-align:top!important}.total-box{width:200px!important;text-align:left!important}.info-row{display:table!important;width:100%!important;table-layout:fixed}.info-cell{display:table-cell!important;vertical-align:top!important}.footer{display:table!important;width:100%!important}.footer>*{display:table-cell!important}.footer>*:last-child{text-align:right!important}';
                  const container=document.createElement('div');container.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:white;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4';
                  const styleEl=document.createElement('style');styleEl.textContent=(styleMatch?styleMatch[1]:'')+pdfFixCss;container.appendChild(styleEl);
                  const bodyDiv=document.createElement('div');bodyDiv.innerHTML=bodyMatch?bodyMatch[1]:docHtml;container.appendChild(bodyDiv);
                  document.body.appendChild(container);await new Promise(r=>setTimeout(r,500));
                  const _siPdfName=siInv.id+(siBillName&&siBillName!=='—'?' - '+siBillName:'')+'.pdf';
                  const html2pdf=(await import('html2pdf.js')).default;
                  const pdfBlob=await html2pdf().set({margin:[0.4,0.4,0.4,0.4],filename:_siPdfName,image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:'letter',orientation:'portrait'}}).from(bodyDiv).outputPdf('blob');
                  document.body.removeChild(container);
                  const pdfB64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(pdfBlob)});
                  brevoAttachments.push({name:_siPdfName,content:pdfB64});
                }catch(err){console.warn('Failed to build invoice PDF:',err)}
                // Build email with portal link
                const portalUrl=siCust?.alpha_tag?'https://nationalsportsapparel.com/coach?portal='+siCust.alpha_tag:'';
                const emailHtml=buildBrandedEmailHtml(si.msg.replace(/\n/g,'<br>')
                  +(portalUrl?'<br/><br/><a href="'+portalUrl+'" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:600">View Invoice in Portal</a>':'')
                  +(si.review?buildReviewButtonHtml():''),companyInfo);
                const _invText=si.review?(si.msg+'\n\n'+reviewTextBlock()):undefined;
                const _invFrom=(cu?.email&&/@nationalsportsapparel\.com$/i.test(cu.email))?cu.email:'noreply@nationalsportsapparel.com';
                const _invSubj='National Sports Invoice - '+siInv.id+(siInv.memo?' - "'+siInv.memo+'"':'');
                const res=await sendBrevoEmail({to:toEmails.map(em=>({email:em,name:em})),subject:_invSubj,
                  htmlContent:emailHtml,textContent:_invText,senderName:cu.name||'National Sports Apparel',senderEmail:_invFrom,replyTo:cu?.email?{email:cu.email,name:cu.name}:undefined,
                  attachment:brevoAttachments.length>0?brevoAttachments:undefined});
                if(res.ok){nf('Invoice '+siInv.id+' sent to '+(toEmails.length>1?toEmails.length+' recipients':toEmail))}else{nf('Failed to send: '+(res.error||'Unknown error'),'error')}
                // Send SMS if enabled
                if(si.smsEnabled&&si.smsPhone&&_brevoKey){
                  const smsRes=await sendBrevoSms({to:si.smsPhone,content:(si.smsMsg||'').substring(0,160)});
                  if(smsRes.ok){nf('Text sent to '+si.smsPhone)}else{nf('SMS failed: '+(smsRes.error||'Unknown'),'error')}
                }
                // Automated follow-ups (server sweep) take priority; else fall back to the manual todo reminder.
                // Never arm auto-sends off a failed initial email — the customer hasn't heard from us yet.
                const _siAuto=si.followUp&&si.followUp.auto&&res.ok;
                const fuAt=_siAuto?new Date(Date.now()+((si.followUp.firstDays||3)*86400000)).toISOString():(si.followUpDays?new Date(Date.now()+si.followUpDays*86400000).toISOString():null);
                const histEntry={sent_at:new Date().toISOString(),sent_by:cu.name||cu.id,type:'invoice',methods:['email',...(si.smsEnabled?['sms']:[])],to:toEmails.join(', '),messageId:res.messageId||null};
                const _siAutoCols=_siAuto?{follow_up_auto:true,follow_up_interval_days:si.followUp.intervalDays||0,follow_up_message:si.followUp.message||'',follow_up_to:toEmails.join(', '),follow_up_max:si.followUp.max||4,follow_up_count:0,follow_up_last_sent_at:null}:{follow_up_auto:false,follow_up_interval_days:null,follow_up_message:null,follow_up_to:null,follow_up_max:null,follow_up_count:0,follow_up_last_sent_at:null};
                setInvs(prev=>prev.map(i=>i.id===si.inv.id?{...i,email_status:'sent',email_sent_at:new Date().toLocaleString(),follow_up_at:fuAt,sent_history:[...(i.sent_history||[]),histEntry],..._siAutoCols}:i));
              }}>Send Invoice</button>
            </div>
          </div></div>})()}

        {/* Payment modal reused from list */}
        {payModal&&<div className="modal-overlay" onClick={()=>setPayModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
          <div className="modal-header"><h2>Record Payment — {payModal.inv.id}</h2><button className="modal-close" onClick={()=>setPayModal(null)}>x</button></div>
          <div className="modal-body">
            <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Invoice Total</span><span style={{fontWeight:700}}>${payModal.inv.total.toLocaleString()}</span></div>
              <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Already Paid</span><span style={{color:'#166534'}}>${payModal.inv.paid.toLocaleString()}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #e2e8f0',paddingTop:4,marginTop:4}}><span style={{fontWeight:700}}>Balance Due</span><span style={{fontWeight:800,color:'#dc2626'}}>${payModal.inv._bal.toLocaleString()}</span></div>
            </div>
            <div style={{marginBottom:12}}><label className="form-label">Payment Method</label>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PAY_METHODS.map(m=><button key={m.id} className={`btn btn-sm ${payModal.method===m.id?'btn-primary':'btn-secondary'}`} style={{fontSize:11}} onClick={()=>setPayModal(p=>({...p,method:m.id}))}>{m.icon} {m.label}</button>)}</div></div>
            {payModal.method==='cc'&&<div style={{padding:8,background:'#fef3c7',borderRadius:6,marginBottom:12,fontSize:12}}><strong>Credit Card Surcharge:</strong> 2.9% (${(payModal.amount*CC_FEE_PCT).toFixed(2)}) will be added.</div>}
            <div className="form-row form-row-2">
              <div><label className="form-label">Amount</label><input className="form-input" type="number" value={payModal.amount} onChange={e=>setPayModal(p=>({...p,amount:parseFloat(e.target.value)||0}))}/></div>
              <div><label className="form-label">Reference</label><input className="form-input" value={payModal.ref} onChange={e=>setPayModal(p=>({...p,ref:e.target.value}))} placeholder="Check #, reference..."/></div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setPayModal(null)}>Cancel</button>
            <button className="btn btn-primary" style={{background:'#166534'}} onClick={()=>{
              if(payModal.amount<=0){nf('Enter a valid amount','error');return}
              recordPayment(payModal.inv,payModal.amount,payModal.method,payModal.ref);
            }}>Record ${payModal.amount.toLocaleString()}</button>
          </div>
        </div></div>}
      </>);
    }

    // Enrich invoices with computed fields — portal invs plus NetSuite invoice history (read-only).
    const enrichedInvs=invs.map(i=>{const age=agingDays(i.date);const dd=dueDays(i.due_date);const bal=i.total-i.paid;
      const overdue=dd!==null&&dd<0&&i.status!=='paid';
      const so=sos.find(s=>s.id===i.so_id);const c=cust.find(x=>x.id===i.customer_id);const rep=c?.primary_rep_id||so?.created_by||null;
      return{...i,_age:age,_dd:dd,_bal:bal,_overdue:overdue,_rep:rep,_cname:cust.find(c=>c.id===i.customer_id)?.name||'Unknown'}});

    // ── Store settlement proposals (OMG deposit funds + webstore Stripe) ──
    // Store/webstore orders are paid from funds the store platform already
    // collected, not billed to a coach. Once the store's sales order is
    // invoiced, those collected funds should settle the invoice. We only
    // PROPOSE the match here and let accounting confirm each with one click —
    // nothing is auto-posted. Idempotent: a store drops off once its invoice
    // carries a payment with our source-tagged ref ('OMG <sale code>' /
    // 'WEB <so id>'). Payment method is inert to commissions and QB sync
    // (neither reads it), so 'store' behaves exactly like a check downstream.
    const _r2=n=>Math.round((+n||0)*100)/100;
    // OMG: funds are collected in a lump by the OMG platform, which deducts its
    // fees before remitting to NSA. The settlement figure is the NET REMIT
    // (collected − OMG & CC fees). COVERAGE model: the remit also contains the
    // tax + processing the parents paid, which are deliberately NOT on the
    // (tax-exempt, product-only) invoice — so remit ≥ balance is the healthy
    // state, we apply the invoice balance, and the leftover surplus is NSA's
    // processing revenue plus tax NSA must remit. Only a remit SHORT of the
    // balance is a real discrepancy. Stores closed with missing data (no
    // Accounting Report, SO never invoiced) surface as actionable rows instead
    // of hiding — that's where the pipeline actually stalls.
    const omgProps=(omgStores||[]).map(s=>{
      if(!s||!s.id)return null;
      const grand=+s._omg_grand_total||0, acct=+s._omg_acct_collected||0;
      const omgFees=+s._omg_omg_fees||0, ccFees=+s._omg_cc_fees||0;
      const proc=+s._omg_processing||0, tax=+s._omg_tax||0;
      if(!(grand>0))return null; // Dollar Report is entered at close — before that, nothing is known
      // Two stores can share a name (e.g. two "Dana Hills Football 2026"), so
      // always disambiguate with the sale code.
      const name=(s.store_name||s.id)+(s._omg_sale_code?' · '+s._omg_sale_code:'');
      const so=(sos||[]).find(x=>x.omg_store_id===s.id);
      const ref='OMG '+(s._omg_sale_code||(so&&so.id)||s.id);
      const soInvs=so?enrichedInvs.filter(i=>i.so_id===so.id):[];
      if(soInvs.some(i=>(i.payments||[]).some(p=>p.ref===ref)))return null; // already settled
      if(!(acct>0))return{key:'omg:'+s.id,source:'omg',name,status:'action',act:'report',reason:'Accounting Report missing — enter it on the OMG page',so:so||null,inv:null,collected:null,teamTab:0};
      if(Math.abs(acct-grand)>=1)return{key:'omg:'+s.id,source:'omg',name,status:'blocked',reason:'Dollar & Accounting reports disagree',so:so||null,inv:null,collected:null,teamTab:0};
      const netRemit=_r2(acct-omgFees-ccFees);
      if(!so)return null; // SO not pulled yet — the OMG page gate walks the rep through that
      const openInvs=soInvs.filter(i=>i.status!=='paid'&&i._bal>0.005);
      if(!openInvs.length){
        if(soInvs.length)return null; // invoiced & fully paid some other way
        return{key:'omg:'+s.id,source:'omg',name,status:'action',act:'invoice',reason:'Funds in hand — one click creates the invoice and settles it',so,inv:null,collected:netRemit,teamTab:0,ref};
      }
      if(openInvs.length>1)return{key:'omg:'+s.id,source:'omg',name,status:'blocked',reason:openInvs.length+' open invoices — settle manually',so,inv:null,collected:netRemit,teamTab:0,ref};
      const inv=openInvs[0];
      const surplus=_r2(netRemit-inv._bal);
      if(surplus>=-1){ // covered (within $1) → apply the balance, close cleanly to 'paid'
        return{key:'omg:'+s.id,source:'omg',name,status:'matched',reason:'',
          note:surplus>1?('+$'+surplus.toFixed(2)+' surplus'+(tax>0?' (incl. $'+tax.toFixed(2)+' collected tax to remit)':proc>0?' (processing revenue)':'')):'',
          so,inv,collected:netRemit,teamTab:0,surplus,applyAmount:_r2(inv._bal),ref};
      }
      // Remit is genuinely short of the invoice — apply what came in so the
      // shortfall stays visible as an open partial balance to chase.
      return{key:'omg:'+s.id,source:'omg',name,status:'mismatch',
        reason:'Collected is $'+Math.abs(surplus).toFixed(2)+' short of the invoice balance',
        note:'',so,inv,collected:netRemit,teamTab:0,surplus,applyAmount:netRemit,ref};
    }).filter(Boolean);
    // Webstore: orders are pre-paid per-order via Stripe at checkout, so the
    // collected figure is the sum of PREPAID order totals (payment_mode='paid',
    // net of refunds) — no fee subtraction (Stripe nets its cut before payout).
    // Team-tab orders (payment_mode='unpaid') were never charged, so we apply
    // only the prepaid funds and leave the team-tab portion as a real open
    // balance the team pays later. Keyed off webstoreSettle (batched orders of
    // genuine source='webstore' stores, fetched async by so_id) — NOT off
    // sales_orders.source, which is 'portal' on every SO in practice. OMG
    // shadow-store orders are excluded by the fetch and by the omg_store_id
    // guard, so a store can never settle through both paths.
    const webProps=Object.keys(webstoreSettle).map(soId=>{
      const so=(sos||[]).find(x=>x.id===soId);
      if(!so||so.omg_store_id)return null; // OMG SOs settle via the OMG path
      const agg=webstoreSettle[soId];
      if(!agg)return null;
      const prepaid=_r2(agg.prepaid), teamTab=_r2(agg.teamTab);
      if(prepaid<=0.5&&teamTab<=0.5)return null; // no money in play yet
      const ref='WEB '+so.id;
      const soInvs=enrichedInvs.filter(i=>i.so_id===so.id);
      if(soInvs.some(i=>(i.payments||[]).some(p=>p.ref===ref)))return null; // already settled
      const name=agg.name||(soInvs[0]&&soInvs[0]._cname)||cust.find(c=>c.id===so.customer_id)?.name||so.id;
      const openInvs=soInvs.filter(i=>i.status!=='paid'&&i._bal>0.005);
      if(!openInvs.length){
        if(soInvs.length)return null; // invoiced & fully paid some other way
        if(prepaid<=0.5)return null;  // pure team-tab store, nothing prepaid — normal AR flow
        return{key:'web:'+so.id,source:'web',name,status:'action',act:'invoice',
          reason:'Stripe funds in hand — one click creates the invoice and settles it',
          so,inv:null,collected:prepaid,teamTab,_agg:agg,ref};
      }
      if(openInvs.length>1)return{key:'web:'+so.id,source:'web',name,status:'blocked',reason:openInvs.length+' open invoices — settle manually',so,inv:null,collected:prepaid,teamTab,ref};
      const inv=openInvs[0];
      // COVERAGE model, same as OMG: the prepaid Stripe gross includes tax,
      // shipping & processing that the product-only SO invoice doesn't bill
      // (the batcher prices items so the SO reconciles to product+fundraise
      // collected). Healthy state: prepaid + still-owed team-tab covers the
      // balance. With a team-tab, apply up to (balance − team-tab) so exactly
      // the team's share stays open; without one, close cleanly at the balance.
      const hasTab=teamTab>1;
      const covered=prepaid+teamTab>=inv._bal-1;
      if(!covered)return{key:'web:'+so.id,source:'web',name,status:'mismatch',
        reason:'Prepaid + team-tab ($'+_r2(prepaid+teamTab).toFixed(2)+') is short of the invoice balance',
        // Never pre-fill more than the open balance — an over-collection is a
        // discrepancy to investigate, not extra money to post onto the invoice.
        note:hasTab?('incl. $'+teamTab.toFixed(2)+' team-tab'):'',so,inv,collected:prepaid,teamTab,applyAmount:Math.min(prepaid,_r2(inv._bal)),ref};
      return{key:'web:'+so.id,source:'web',name,status:'matched',reason:'',
        note:hasTab?('leaves $'+Math.min(teamTab,_r2(inv._bal)).toFixed(2)+' team-tab owed'):'',
        so,inv,collected:prepaid,teamTab,
        applyAmount:hasTab?Math.min(prepaid,Math.max(0,_r2(inv._bal-teamTab))):_r2(inv._bal),ref};
    }).filter(Boolean);
    const storeSettlements=[...omgProps,...webProps];
    const stMatched=storeSettlements.filter(p=>p.status==='matched');
    const stAction=storeSettlements.filter(p=>p.status==='action');
    const stMismatch=storeSettlements.filter(p=>p.status==='mismatch');
    const stBlocked=storeSettlements.filter(p=>p.status==='blocked');
    // Pre-fill the existing payment modal; the modal's "Record $X" button is
    // accounting's one-click confirm (amount stays editable for exceptions).
    const proposeSettlement=(p)=>{
      if(!p||!p.inv)return;
      setPayModal({inv:{...p.inv,_bal:p.inv._bal},amount:_r2(p.applyAmount),method:'store',ref:p.ref});
    };
    const _openSO=(so)=>{if(so){setESO(so);setESOC(cust.find(c=>c.id===so.customer_id));setPg('orders')}};
    // Historical rows from NetSuite — no so_id, no payments, and no due_date column.
    // Treat status='paid' as fully paid; anything else leaves total as balance.
    // Derive due_date from invoice_date + customer payment terms so aging buckets,
    // Overdue stat, and the past-due bulk-email view all work for these rows too.
    const enrichedHist=(histInvs||[]).map(i=>{
      const c2=cust.find(c=>c.id===i.customer_id);
      const baseDate=i.date||i.invoice_date;
      const age=agingDays(baseDate);
      const paid=i.status==='paid'?safeNum(i.total):0;
      const bal=safeNum(i.total)-paid;
      const derivedDue=i.due_date||_deriveDue(baseDate,c2?.payment_terms);
      const dd=dueDays(derivedDue);
      const overdue=bal>0&&dd!==null&&dd<0;
      // Prefer the snapshot rep_name match; fall back to customer.primary_rep_id so
      // imported invoices without a recognizable rep_name still attribute to a rep.
      const rep=REPS.find(r=>r.name&&(i.rep_name||'').toLowerCase()===r.name.toLowerCase())?.id||c2?.primary_rep_id||null;
      return{...i,paid,_age:age,_dd:dd,_bal:bal,_overdue:overdue,_rep:rep,_cname:c2?.name||i.raw_customer_name||'Unknown',due_date:derivedDue,date:baseDate}});
    let fi=[...enrichedInvs,...enrichedHist];

    // Filters. The status and aging chips always apply. The rep filter is the one exception: when the
    // user has typed a search term we skip it, so searching an invoice number or customer name finds
    // the match no matter which rep owns it. Without this, the "My Invoices" default rep filter
    // silently hid invoices owned by a teammate, so an exact INV-#### search returned "No invoices
    // match filters" even though the invoice existed (e.g. INV-1086, owned by Jered — invisible to
    // everyone else who searched for it).
    const _invSearch=(invF.search||'').trim().toLowerCase();
    if(invF.status==='open')fi=fi.filter(i=>i.status==='open'||i.status==='partial');
    else if(invF.status==='paid')fi=fi.filter(i=>i.status==='paid');
    if(invF.aging==='30')fi=fi.filter(i=>i._age>=1&&i._age<=30&&i.status!=='paid');
    else if(invF.aging==='60')fi=fi.filter(i=>i._age>=31&&i._age<=60&&i.status!=='paid');
    else if(invF.aging==='90')fi=fi.filter(i=>i._age>=61&&i._age<=90&&i.status!=='paid');
    else if(invF.aging==='120')fi=fi.filter(i=>i._age>90&&i.status!=='paid');
    else if(invF.aging==='overdue')fi=fi.filter(i=>i._overdue);
    if(!_invSearch){const invRepId=invF.rep==='_me_'?cu?.id:invF.rep;if(invRepId&&invRepId!=='all')fi=fi.filter(i=>i._rep===invRepId);}
    if(_invSearch)fi=fi.filter(i=>(i.id||'').toLowerCase().includes(_invSearch)||(i.memo||'').toLowerCase().includes(_invSearch)||i._cname.toLowerCase().includes(_invSearch));

    // Sort
    fi.sort((a,b)=>{let va,vb;
      if(invSort.f==='id'){va=a.id;vb=b.id}
      else if(invSort.f==='customer'){va=a._cname;vb=b._cname}
      else if(invSort.f==='created_at'){va=a.created_at||'';vb=b.created_at||''}
      else if(invSort.f==='date'){va=parseD(a.date);vb=parseD(b.date)}
      else if(invSort.f==='due_date'){va=parseD(a.due_date);vb=parseD(b.due_date)}
      else if(invSort.f==='age'){va=a._age;vb=b._age}
      else if(invSort.f==='total'){va=a.total;vb=b.total}
      else if(invSort.f==='paid'){va=a.paid;vb=b.paid}
      else if(invSort.f==='balance'){va=a._bal;vb=b._bal}
      else if(invSort.f==='status'){va=a.status;vb=b.status}
      else{va=a.id;vb=b.id}
      if(va==null)va='';if(vb==null)vb='';
      const cmp=va<vb?-1:va>vb?1:0;
      return invSort.d==='asc'?cmp:-cmp;
    });

    // Stats scope: respect the rep filter so the top boxes match what the rep sees in the table.
    // The status/aging chips themselves don't scope the boxes — those still toggle filters via clicks.
    const allInvsCombined=[...enrichedInvs,...enrichedHist];
    const _statsRepId=invF.rep==='_me_'?cu?.id:invF.rep;
    const scopedInvs=(_statsRepId&&_statsRepId!=='all')?allInvsCombined.filter(i=>i._rep===_statsRepId):allInvsCombined;
    const allOpen=scopedInvs.filter(i=>i.status==='open'||i.status==='partial');
    const totalOpen=allOpen.reduce((a,i)=>a+(safeNum(i.total)-safeNum(i.paid)),0);
    const totalOverdue=allOpen.filter(i=>i._dd!==null&&i._dd<0).reduce((a,i)=>a+(safeNum(i.total)-safeNum(i.paid)),0);
    const totalPaid=scopedInvs.filter(i=>i.status==='paid').reduce((a,i)=>a+safeNum(i.paid),0);
    // Aging by due-date offset: NetSuite rows now have a derived due_date from terms.
    // `null >= 0` is true in JS via coercion, so we explicitly skip nulls before bucketing.
    const agingBuckets={current:0,d30:0,d60:0,d90:0,d120p:0};
    allOpen.forEach(i=>{const dd=dueDays(i.due_date);const bal=safeNum(i.total)-safeNum(i.paid);
      if(dd===null)agingBuckets.current+=bal;
      else if(dd>=0)agingBuckets.current+=bal;
      else if(dd>=-30)agingBuckets.d30+=bal;
      else if(dd>=-60)agingBuckets.d60+=bal;
      else if(dd>=-90)agingBuckets.d90+=bal;
      else agingBuckets.d120p+=bal;
    });
    const agingCounts={d30:allOpen.filter(i=>agingDays(i.date)>=1&&agingDays(i.date)<=30).length,d60:allOpen.filter(i=>agingDays(i.date)>=31&&agingDays(i.date)<=60).length,d90:allOpen.filter(i=>agingDays(i.date)>=61&&agingDays(i.date)<=90).length,d120p:allOpen.filter(i=>agingDays(i.date)>90).length};

    // Grouped by customer
    const grouped={};
    fi.forEach(i=>{const cid=i.customer_id;if(!grouped[cid])grouped[cid]={customer:cust.find(c=>c.id===cid),invoices:[]};grouped[cid].invoices.push(i)});

    const SH=({label,field,w})=><th style={{cursor:'pointer',userSelect:'none',width:w,whiteSpace:'nowrap'}} onClick={()=>invSortFn(field)}>
      <span style={{display:'inline-flex',alignItems:'center',gap:3}}>{label}<span style={{fontSize:9,opacity:invSort.f===field?1:0.3}}>{sortIcon(field)}</span></span></th>;

    const ageBadge=(age)=>{
      if(age<=0)return null;
      const color=age<=30?'#64748b':age<=60?'#d97706':age<=90?'#ea580c':'#dc2626';
      const bg=age<=30?'#f1f5f9':age<=60?'#fef3c7':age<=90?'#ffedd5':'#fecaca';
      return<span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:bg,color}}>{age}d</span>;
    };

    return(<>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='all'&&invF.aging==='all'?'2px solid #2563eb':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'all',aging:'all'}))}>
          <div className="stat-label">All Invoices</div><div className="stat-value">{scopedInvs.length}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='open'&&invF.aging==='all'?'2px solid #d97706':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'open',aging:'all'}))}>
          <div className="stat-label">Open</div><div className="stat-value" style={{color:'#d97706'}}>${totalOpen.toLocaleString()}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.aging==='overdue'?'2px solid #dc2626':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'all',aging:f.aging==='overdue'?'all':'overdue'}))}>
          <div className="stat-label">Overdue</div><div className="stat-value" style={{color:'#dc2626'}}>${totalOverdue.toLocaleString()}</div></div>
        <div className="stat-card" style={{cursor:'pointer',outline:invF.status==='paid'?'2px solid #166534':'none',borderRadius:8}} onClick={()=>setInvF(f=>({...f,status:'paid',aging:'all'}))}>
          <div className="stat-label">Paid</div><div className="stat-value" style={{color:'#166534'}}>${totalPaid.toLocaleString()}</div></div>
      </div>

      {/* Aging Summary — clickable to filter */}
      <div className="card" style={{marginBottom:12}}><div className="card-body" style={{padding:'12px 16px'}}>
        <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>AGING SUMMARY <span style={{fontWeight:400,fontSize:10}}>(click to filter)</span></div>
        <div style={{display:'flex',gap:4}}>
          {[['Current','current','#166534','all'],['1-30 Days','d30','#d97706','30'],['31-60 Days','d60','#ea580c','60'],['61-90 Days','d90','#dc2626','90'],['90+ Days','d120p','#991b1b','120']].map(([label,key,color,fKey])=>
            <div key={key} style={{flex:1,padding:'8px 12px',background:invF.aging===fKey?color+'20':agingBuckets[key]>0?color+'08':'#f8fafc',borderRadius:6,
              border:invF.aging===fKey?`2px solid ${color}`:`1px solid ${agingBuckets[key]>0?color+'40':'#e2e8f0'}`,textAlign:'center',cursor:'pointer'}}
              onClick={()=>setInvF(f=>({...f,aging:f.aging===fKey?'all':fKey,status:fKey==='all'?f.status:'all'}))}>
              <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>{label}</div>
              <div style={{fontSize:16,fontWeight:800,color:agingBuckets[key]>0?color:'#94a3b8'}}>${agingBuckets[key].toLocaleString()}</div>
              {key!=='current'&&<div style={{fontSize:9,color:'#94a3b8'}}>{agingCounts[key]||0} inv</div>}
            </div>)}
        </div>
      </div></div>

      {/* Store settlements — apply collected store/webstore funds to invoices */}
      {storeSettlements.length>0&&<div className="card" style={{marginBottom:12,border:'1px solid #c7d2fe'}}><div className="card-body" style={{padding:'12px 16px'}}>
        <div style={{fontSize:12,fontWeight:700,color:'#4338ca',marginBottom:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          🏫 STORE SETTLEMENTS
          {stMatched.length>0&&<span style={{fontSize:10,fontWeight:700,background:'#dcfce7',color:'#166534',padding:'1px 7px',borderRadius:10}}>{stMatched.length} ready</span>}
          {stAction.length>0&&<span style={{fontSize:10,fontWeight:700,background:'#dbeafe',color:'#1e40af',padding:'1px 7px',borderRadius:10}}>{stAction.length} needs action</span>}
          {stMismatch.length>0&&<span style={{fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e',padding:'1px 7px',borderRadius:10}}>{stMismatch.length} short</span>}
          {stBlocked.length>0&&<span style={{fontSize:10,fontWeight:700,background:'#f1f5f9',color:'#64748b',padding:'1px 7px',borderRadius:10}}>{stBlocked.length} blocked</span>}
        </div>
        <div style={{fontSize:10,color:'#64748b',marginBottom:8}}>Store &amp; webstore orders are paid from funds the store already collected (not the coach). "Ready" means the collected funds cover the invoice — confirming applies the invoice balance, and the surplus shown is NSA's processing revenue plus collected tax to remit. OMG collected = net remit (collected − OMG &amp; card fees); webstores = prepaid Stripe total, leaving any team-tab balance owed.</div>
        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><thead><tr style={{textAlign:'left',color:'#94a3b8',fontSize:10}}>
          <th style={{padding:'4px 8px'}}>SRC</th><th style={{padding:'4px 8px'}}>STORE / CUSTOMER</th><th style={{padding:'4px 8px'}}>SO</th><th style={{padding:'4px 8px'}}>INVOICE</th>
          <th style={{padding:'4px 8px',textAlign:'right'}}>COLLECTED</th><th style={{padding:'4px 8px',textAlign:'right'}}>INVOICE BAL</th>
          <th style={{padding:'4px 8px'}}></th></tr></thead><tbody>
          {[...stMatched,...stAction,...stMismatch,...stBlocked].map(p=>{
            const clr=p.status==='matched'?'#166534':p.status==='action'?'#1e40af':p.status==='mismatch'?'#b45309':'#64748b';
            const bg=p.status==='matched'?'#f0fdf4':p.status==='action'?'#eff6ff':p.status==='mismatch'?'#fffbeb':'#f8fafc';
            const $=n=>'$'+(+n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
            return<tr key={p.key} style={{background:bg,borderTop:'1px solid #e2e8f0'}}>
              <td style={{padding:'6px 8px'}}><span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:p.source==='web'?'#e0f2fe':'#ede9fe',color:p.source==='web'?'#0369a1':'#6d28d9'}}>{p.source==='web'?'WEB':'OMG'}</span></td>
              <td style={{padding:'6px 8px',fontWeight:600}}>{p.name}</td>
              <td style={{padding:'6px 8px'}}>{p.so?<span style={{color:'#7c3aed',cursor:'pointer',textDecoration:'underline'}} onClick={()=>_openSO(p.so)}>{p.so.id}</span>:'—'}</td>
              <td style={{padding:'6px 8px'}}>{p.inv?p.inv.id:'—'}</td>
              <td style={{padding:'6px 8px',textAlign:'right'}}>{p.collected!=null?$(p.collected):'—'}{p.teamTab>1&&<div style={{fontSize:9,color:'#b45309'}}>+{$(p.teamTab)} team-tab</div>}</td>
              <td style={{padding:'6px 8px',textAlign:'right'}}>{p.inv?$(p.inv._bal):'—'}</td>
              <td style={{padding:'6px 8px',whiteSpace:'nowrap'}}>
                {(p.status==='matched'||p.status==='mismatch')&&<button className="btn btn-sm" style={{fontSize:11,background:clr,color:'white',border:'none',padding:'5px 12px'}} onClick={()=>proposeSettlement(p)}>
                  {p.status==='matched'?'Confirm & Apply':'Apply Partial'}</button>}
                {p.status==='action'&&<button className="btn btn-sm" style={{fontSize:11,background:clr,color:'white',border:'none',padding:'5px 12px'}} onClick={()=>{
                  if(p.act!=='invoice'||!p.so){setPg('omg');return}
                  if(p.source==='web'){const a=p._agg||{};createAndSettleWebstoreInvoice(p.so,{cardTotal:a.prepaid||0,tabTotal:a.teamTab||0,tabExtras:Math.max(0,Math.round(((a.teamTab||0)-(a.tabProduct||0))*100)/100)});}
                  else createAndSettleOmgInvoice(p.so);
                }}>
                  {p.act==='invoice'?'Invoice & Settle':'OMG Page'}</button>}
                {p.status==='matched'&&p.note&&<span style={{marginLeft:8,fontSize:10,color:'#64748b'}}>{p.note}</span>}
                {p.status==='action'&&<span style={{marginLeft:8,fontSize:11,color:clr}}>{p.reason}</span>}
                {p.status==='mismatch'&&<span style={{marginLeft:8,fontSize:11,color:clr}}>⚠ {p.reason}</span>}
                {p.status==='blocked'&&<span style={{fontSize:11,color:clr}}>{p.reason}</span>}
              </td></tr>;
          })}
        </tbody></table>
      </div></div>}

      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <div className="search-bar" style={{flex:1,minWidth:200,maxWidth:300}}><Icon name="search"/><input placeholder="Search invoices, customers..." value={invF.search} onChange={e=>setInvF(f=>({...f,search:e.target.value}))}/></div>
        <select className="form-select" style={{width:130,fontSize:11}} value={invF.rep} onChange={e=>setInvF(f=>({...f,rep:e.target.value}))}>
          <option value="all">All Reps</option><option value="_me_">My Invoices</option>{REPS.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <div style={{display:'flex',gap:4}}>
          {[['list','📋 List'],['customer','👥 By Customer']].map(([v,l])=>
            <button key={v} className={`btn btn-sm ${invF.group===v?'btn-primary':'btn-secondary'}`} onClick={()=>setInvF(f=>({...f,group:v,status:v==='customer'&&f.status==='all'?'open':f.status}))}>{l}</button>)}
        </div>
        {(invF.status!=='all'||invF.aging!=='all'||invF.rep!=='all'||invF.search)&&
          <button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>setInvF({search:'',status:'all',group:invF.group,aging:'all',rep:'all'})}>✕ Clear Filters</button>}
      </div>

      {/* Results count */}
      <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{fi.length} invoice{fi.length!==1?'s':''} · Balance: ${fi.reduce((a,i)=>a+i._bal,0).toLocaleString()}</div>

      {/* List view */}
      {invF.group==='list'&&<div className="card"><div className="card-body" style={{padding:0}}>
        {fi.length===0?<div className="empty" style={{padding:30}}>No invoices match filters</div>:
        <table><thead><tr>
          <SH label="Invoice" field="id"/>
          <SH label="Created" field="created_at"/>
          <SH label="Customer" field="customer"/>
          <th style={{fontSize:11}}>SO</th>
          <th style={{fontSize:11}}>Rep</th>
          <SH label="Date" field="date"/>
          <SH label="Age" field="age" w={50}/>
          <SH label="Due" field="due_date"/>
          <SH label="Total" field="total"/>
          <SH label="Paid" field="paid"/>
          <SH label="Balance" field="balance"/>
          <SH label="Status" field="status"/>
          <th>Action</th>
        </tr></thead>
        <tbody>{fi.map(inv=>{
          const repObj=REPS.find(r=>r.id===inv._rep);
          const rowKey=inv._hist?'h:'+(inv.netsuite_internal_id||inv.id):inv.id;
          const il=(content)=>inv._hist?content:<RowLink params={{inv:inv.id}} onOpen={()=>setViewInvoice(inv)}>{content}</RowLink>;
          return<tr key={rowKey} style={{background:inv._overdue?'#fef2f2':inv._hist?'#fafbfc':undefined,cursor:inv._hist?'default':'pointer',color:inv._hist?'#475569':undefined}} title={inv._hist?'NetSuite history — read only':undefined}>
            <td style={{fontWeight:700,color:inv._hist?'#64748b':'#1e40af',fontSize:12,cursor:inv._hist?'default':'pointer',textDecoration:inv._hist?'none':'underline'}}>{il(inv.id)}{inv._hist&&<span style={{marginLeft:4,fontSize:8,padding:'1px 4px',borderRadius:3,background:'#e2e8f0',color:'#475569',fontWeight:700,letterSpacing:0.5}}>NS</span>}</td>
            <td style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>{il(fmtCreatedAt(inv.created_at))}</td>
            <td style={{fontSize:12}}>{il(inv._cname||' ')}</td>
            <td style={{fontSize:11,color:'#7c3aed',cursor:inv.so_id?'pointer':'default',textDecoration:inv.so_id?'underline':'none'}}
              onClick={e=>{e.stopPropagation();if(inv.so_id){const so=sos.find(s=>s.id===inv.so_id);if(so){setESO(so);setESOC(cust.find(c=>c.id===so.customer_id));setPg('orders')}}}}>{inv.so_id||'—'}</td>
            <td style={{fontSize:10,color:'#64748b'}}>{il(repObj?.name||'—')}</td>
            <td style={{fontSize:11}}>{il(inv.date||' ')}</td>
            <td style={{textAlign:'center'}}>{il(ageBadge(inv._age))}</td>
            <td style={{fontSize:11,color:inv._overdue?'#dc2626':'#64748b',fontWeight:inv._overdue?700:400}}>{il(<>{inv.due_date||'—'}{inv._overdue?' ⚠️':''}</>)}</td>
            <td style={{fontWeight:600,textAlign:'right'}}>{il('$'+inv.total.toLocaleString())}</td>
            <td style={{color:'#166534',textAlign:'right'}}>{il(<>${inv.paid.toLocaleString()}{inv.cc_fee>0?<span style={{fontSize:8,color:'#94a3b8'}}> +${inv.cc_fee.toFixed(0)}fee</span>:''}</>)}</td>
            <td style={{fontWeight:700,color:inv._bal>0?'#dc2626':'#166534',textAlign:'right'}}>{il('$'+inv._bal.toLocaleString())}</td>
            <td>{il(<><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,
              background:inv.status==='paid'?'#dcfce7':inv.status==='partial'?'#fef3c7':inv._overdue?'#fecaca':'#dbeafe',
              color:inv.status==='paid'?'#166534':inv.status==='partial'?'#92400e':inv._overdue?'#991b1b':'#1e40af'}}>
              {inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':inv._overdue?'Overdue':'Open'}</span>
              {inv.tc_reported&&<span style={{padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:'#dbeafe',color:'#1e40af',marginLeft:3,verticalAlign:'middle'}} title="Reported to TaxCloud for filing">TC</span>}</>)}</td>
            <td onClick={e=>e.stopPropagation()}>{inv._hist?<>{inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#166534',color:'white',border:'none'}} title="Mark this NetSuite-imported invoice as paid in the portal (sync to NetSuite separately)" onClick={()=>setPayModal({inv:{...inv,_bal:safeNum(inv.total)-safeNum(inv.paid),paid:safeNum(inv.paid)},amount:safeNum(inv.total)-safeNum(inv.paid),method:'check',ref:''})}>💰 Pay</button>}{inv.status==='paid'&&<span style={{fontSize:9,color:'#94a3b8',fontStyle:'italic'}}>—</span>}</>:<>{inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#166534',color:'white',border:'none'}}
              onClick={()=>setPayModal({inv,amount:inv._bal,method:'check',ref:''})}>💰 Pay</button>}
              {inv.status==='paid'&&!inv.tc_reported&&inv.tax>0&&<button className="btn btn-sm" style={{fontSize:8,padding:'2px 6px',background:'#1e40af',color:'white',border:'none'}} title="Report this invoice to TaxCloud for state tax filing" onClick={async()=>{const c=cust.find(x=>x.id===inv.customer_id);if(!c)return;if(!supabase){nf('Supabase not configured','error');return}try{const d=await invokeEdgeFn(supabase,'taxcloud-capture',{action:'capture',customer_id:inv.customer_id,invoice_id:inv.id,so_id:inv.so_id||inv.id,items:(inv.items||inv.line_items||[]).map(it=>({sku:it.sku||it.desc||'ITEM',name:it.name||it.desc||'Item',price:it.rate||it.unit_sell||0,qty:it.qty||1})),destination:{state:c.shipping_state||c.billing_state||'',zip5:c.shipping_zip||c.billing_zip||''}});if(d?.ok){setInvs(prev=>prev.map(i=>i.id===inv.id?{...i,tc_reported:true,tc_tax:d.total_tax}:i));nf('Reported to TaxCloud — $'+d.total_tax+' tax filed')}else{nf(d?.error||'TaxCloud capture failed','error')}}catch(e){nf('Error: '+e.message,'error')}}}>TC File</button>}
              <button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',marginLeft:2}} onClick={()=>{
                const _$f=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
                const so=sos.find(s=>s.id===inv.so_id);const ic=cust.find(c=>c.id===inv.customer_id);
                const billToName=inv.billing_name||ic?.name||'—';
                const fBillSub=inv.billing_name?(inv.billing_address||'')+'<br/><span style="font-size:9px;color:#94a3b8">on behalf of '+ic?.name+'</span>':'';
                const fBillAddr=fBillSub||(ic?.billing_address_line1?ic.billing_address_line1+(ic.billing_city?'<br/>'+ic.billing_city+(ic.billing_state?' '+ic.billing_state:'')+(ic.billing_zip?' '+ic.billing_zip:''):'')+'<br/>United States':'');
                const fShipName=inv.shipping_name||(!inv.shipping_address?resolveOrderShipTo(so,ic)?.name:null)||ic?.name||'—';
                const fShipAddr=(inv.shipping_name||inv.shipping_address?(inv.shipping_address||'').replace(/\n/g,'<br/>'):'')||orderShipToSub(so,ic)||custShipAddrSub(ic);
                const fPoNum=inv._po_number||so?.po_number;
                // Build rows from the invoice's own line items (honors per-line price overrides)
                const fStoredLi=inv.line_items||[];
                const {rows:fRows,subtotal:fSubTotal}=buildInvoicePdfRows(inv,so,_$f);
                const shipAmt=inv.shipping!=null?inv.shipping:so?(()=>{const fLi2=fStoredLi.length>0?fStoredLi:safeItems(so).map(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);return{amount:qty*safeNum(it.unit_sell)}});const sub=fLi2.reduce((a,l)=>a+(l.amount||0),0);return(so.shipping_type==='pct'?sub*(so.shipping_value||0)/100:so.shipping_value||0)})():0;
                const taxAmt=inv.tax||0;
                printDoc({
                  title:billToName,docNum:inv.id,docType:'INVOICE',date:inv.date,
                  headerRight:'<div class="ta">'+_$f(inv.total)+'</div>'
                    +'<div class="ts">Balance Due: <strong>'+_$f(inv._bal)+'</strong></div>'+(fPoNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+fPoNum+'</div>':''),
                  infoBoxes:[
                    {label:'Bill To',value:billToName,sub:fBillAddr},
                    ...(fShipAddr?[{label:'Ship To',value:fShipName,sub:fShipAddr}]:[]),
                    {label:'Invoice Date',value:inv.date||new Date().toLocaleDateString(),sub:inv.due_date?'Due: '+inv.due_date:''},
                    {label:'PO Number',value:fPoNum||'—'},
                    {label:'Payment Terms',value:inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial Invoice':inv.inv_type==='full'?'Invoice':'Final Invoice',sub:'Rep: '+(REPS.find(r=>r.id===inv._rep)?.name||'—')},
                  ],
                  tables:[{
                    headers:['Quantity','SKU','Item','Rate','Amount'],
                    aligns:['center','left','left','right','right'],
                    rows:[...fRows,
                      {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$f(fSubTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
                      ...(shipAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$f(shipAmt),style:'text-align:right;border:none'}]}]:[]),
                      ...(taxAmt>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$f(taxAmt),style:'text-align:right;border:none'}]}]:[]),
                      ...(safeNum(inv.credit_amount)>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Credit</strong>',style:'text-align:right;border:none;color:#065f46'},{value:'<strong style="color:#065f46">-'+_$f(safeNum(inv.credit_amount))+'</strong>',style:'text-align:right;border:none'}]}]:[]),
                      {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$f(inv.total)+'</strong>',style:'text-align:right'}]},
                      ...(inv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$f(inv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
                      ...(inv._bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$f(inv._bal)+'</strong>',style:'text-align:right'}]}]:[]),
                    ]
                  }],
                  footer:inv.inv_type==='deposit'?companyInfo.depositTerms:companyInfo.terms,companyInfo:companyInfo
                });
              }}>🖨️</button>{canDelete&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',color:'#dc2626',border:'1px solid #fca5a5',marginLeft:4,background:'white'}} onClick={()=>deleteInvoice(inv.id)}><Icon name="trash" size={10}/></button>}</>}</td>
          </tr>})}</tbody></table>}
      </div></div>}

      {/* Customer grouped view — sorted by open balance desc so biggest debtors come first */}
      {invF.group==='customer'&&Object.entries(grouped).map(([cid,g])=>({cid,g,_open:g.invoices.filter(i=>i.status!=='paid').reduce((a,i)=>a+i._bal,0),_over:g.invoices.filter(i=>i._overdue).reduce((a,i)=>a+i._bal,0)})).sort((a,b)=>b._open-a._open).map(({cid,g})=>{
        const openBal=g.invoices.filter(i=>i.status!=='paid').reduce((a,i)=>a+i._bal,0);
        const overdueAmt=g.invoices.filter(i=>i._overdue).reduce((a,i)=>a+i._bal,0);
        return<div key={cid} className="card" style={{marginBottom:12}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
            <div><h2 style={{margin:0}}>{g.customer?.name||'Unknown Customer'}</h2>
              <span style={{fontSize:11,color:'#64748b'}}>{g.customer?.alpha_tag} · {g.invoices.length} invoice{g.invoices.length!==1?'s':''}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              {(()=>{const openInvs=g.invoices.filter(i=>i.status!=='paid'&&i.status!=='void'&&i._bal>0);return openInvs.length>0&&<button className="btn btn-sm" style={{background:'#dcfce7',color:'#166534',border:'1px solid #86efac',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}} onClick={e=>{e.stopPropagation();const sorted=[...openInvs].sort((a,b)=>(b._age||0)-(a._age||0));const inv=sorted[0];setPayModal({inv,amount:inv._bal,method:'check',ref:''})}} title={'Record a payment ('+openInvs.length+' open invoice'+(openInvs.length===1?'':'s')+')'}>💰 Receive Payment</button>})()}
              {overdueAmt>0&&g.customer&&<button className="btn btn-sm" style={{background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}} onClick={e=>{e.stopPropagation();const overdueInvs=g.invoices.filter(i=>i._overdue&&i._bal>0);if(overdueInvs.length===0)return;const ownContacts=(g.customer.contacts||[]).filter(ct=>ct.email);const inheritedBilling=getBillingContacts(g.customer,cust).filter(a=>a._inherited_from&&a.email&&!ownContacts.find(o=>o.email===a.email));const allContacts=[...ownContacts.map(ct=>({email:ct.email,name:ct.name||'',role:ct.role||''})),...inheritedBilling.map(a=>({email:a.email,name:a.name||'',role:a.role||'',_inherited_from:a._inherited_from}))];const billingEmails=new Set(getBillingContacts(g.customer,cust).map(b=>b.email));const checked={};allContacts.forEach(ct=>{checked[ct.email]=billingEmails.has(ct.email)});if(Object.values(checked).every(v=>!v)&&allContacts.length>0)checked[allContacts[0].email]=true;const greetName=getBillingContacts(g.customer,cust)[0]?.name||(g.customer.contacts||[])[0]?.name||'Coach';const customerObj={customer:g.customer,invoices:overdueInvs,contacts:allContacts,checked,customEmail:'',customEmails:[],total:overdueInvs.reduce((a,i)=>a+i._bal,0)};setPdBulkModal({customers:[customerObj],options:{includeStatement:true,includePayLink:true},senderKey:cu?.email?'rep':'accounting',message:'Hi '+greetName+',\n\nA gentle reminder that we have invoice(s) on your account that have moved past their due date. Please find your account statement below — you can review and pay open balances anytime through your customer portal.\n\nLet us know if you have any questions, or if any of these have already been paid and just need to be reconciled on our end.\n\nThank you,\nNSA Team',sending:false,progress:{done:0,total:0,sent:0,failed:0}})}}>📧 Email Past-Due</button>}
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:18,fontWeight:800,color:'#0f172a'}}>${openBal.toLocaleString()} <span style={{fontSize:11,fontWeight:400,color:'#64748b'}}>open</span></div>
                {overdueAmt>0&&<div style={{fontSize:12,color:'#dc2626',fontWeight:600}}>⚠️ ${overdueAmt.toLocaleString()} overdue</div>}
              </div>
            </div>
          </div>
          <div className="card-body" style={{padding:0}}>
            <table><thead><tr><th>Invoice</th><th>SO</th><th>Memo</th><th>Date</th><th>Age</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>{g.invoices.map(inv=>{const il2=(content)=>inv._hist?content:<RowLink params={{inv:inv.id}} onOpen={()=>setViewInvoice(inv)}>{content}</RowLink>;return(
              <tr key={inv._hist?'h:'+(inv.netsuite_internal_id||inv.id):inv.id} style={{background:inv._overdue?'#fef2f2':inv._hist?'#fafbfc':undefined,cursor:inv._hist?'default':'pointer',color:inv._hist?'#475569':undefined}} title={inv._hist?'NetSuite history — read only':undefined}>
                <td style={{fontWeight:700,color:inv._hist?'#64748b':'#1e40af',fontSize:12,cursor:inv._hist?'default':'pointer',textDecoration:inv._hist?'none':'underline'}}>{il2(inv.id)}{inv._hist&&<span style={{marginLeft:4,fontSize:8,padding:'1px 4px',borderRadius:3,background:'#e2e8f0',color:'#475569',fontWeight:700,letterSpacing:0.5}}>NS</span>}</td>
                <td style={{fontSize:11,color:'#7c3aed',cursor:inv.so_id?'pointer':'default',textDecoration:inv.so_id?'underline':'none'}}
                  onClick={e=>{e.stopPropagation();if(inv.so_id){const so=sos.find(s=>s.id===inv.so_id);if(so){setESO(so);setESOC(cust.find(c=>c.id===so.customer_id));setPg('orders')}}}}>{inv.so_id||'—'}</td>
                <td style={{fontSize:11}}>{il2(inv.memo||' ')}</td>
                <td style={{fontSize:11}}>{il2(inv.date||' ')}</td>
                <td style={{textAlign:'center'}}>{il2(ageBadge(inv._age))}</td>
                <td style={{fontSize:11,color:inv._overdue?'#dc2626':'#64748b',fontWeight:inv._overdue?700:400}}>{il2(<>{inv.due_date||'—'}{inv._overdue?' ⚠️':''}</>)}</td>
                <td style={{fontWeight:600,textAlign:'right'}}>{il2('$'+inv.total.toLocaleString())}</td>
                <td style={{fontWeight:700,color:inv._bal>0?'#dc2626':'#166534',textAlign:'right'}}>{il2('$'+inv._bal.toLocaleString())}</td>
                <td>{il2(<><span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,
                  background:inv.status==='paid'?'#dcfce7':inv.status==='partial'?'#fef3c7':inv._overdue?'#fecaca':'#dbeafe',
                  color:inv.status==='paid'?'#166534':inv.status==='partial'?'#92400e':inv._overdue?'#991b1b':'#1e40af'}}>
                  {inv.status==='paid'?'Paid':inv.status==='partial'?'Partial':inv._overdue?'Overdue':'Open'}</span>
                  {inv.tc_reported&&<span style={{padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:'#dbeafe',color:'#1e40af',marginLeft:3}} title="Reported to TaxCloud">TC</span>}</>)}</td>
                <td onClick={e=>e.stopPropagation()}>{inv.status!=='paid'&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 8px',background:'#166534',color:'white',border:'none'}} title={inv._hist?'Mark this NetSuite invoice paid in portal (sync to NetSuite separately)':undefined}
                  onClick={()=>setPayModal({inv,amount:inv._bal,method:'check',ref:''})}>💰 Pay</button>}
                  {canDelete&&<button className="btn btn-sm" style={{fontSize:9,padding:'2px 6px',color:'#dc2626',border:'1px solid #fca5a5',marginLeft:4,background:'white'}} title={inv._hist?'Delete NetSuite invoice':'Delete invoice'} onClick={()=>deleteInvoice(inv.id)}><Icon name="trash" size={10}/></button>}</td>
              </tr>)})}</tbody></table>
            {/* Payment history */}
            {g.invoices.some(i=>(i.payments||[]).length>0)&&<div style={{padding:'8px 16px',borderTop:'1px solid #f1f5f9'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>PAYMENT HISTORY</div>
              {g.invoices.flatMap(i=>(i.payments||[]).map(p=>({...p,inv_id:i.id}))).sort((a,b)=>new Date(b.date)-new Date(a.date)).map((p,pi)=>
                <div key={pi} style={{fontSize:11,padding:'2px 0',display:'flex',gap:8}}>
                  <span style={{color:'#94a3b8',width:60}}>{p.date}</span>
                  <span style={{fontWeight:600,width:70}}>${p.amount.toLocaleString()}</span>
                  <span>{PAY_METHODS.find(m=>m.id===p.method)?.icon} {PAY_METHODS.find(m=>m.id===p.method)?.label||p.method}</span>
                  <span style={{color:'#64748b'}}>{p.ref}</span>
                  <span style={{color:'#94a3b8',marginLeft:'auto'}}>{p.inv_id}</span>
                  {p.cc_fee>0&&<span style={{fontSize:9,color:'#d97706'}}>+${p.cc_fee.toFixed(2)} CC fee</span>}
                </div>)}
            </div>}
          </div>
        </div>})}

      {/* Payment Modal */}
      {payModal&&<div className="modal-overlay" onClick={()=>setPayModal(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header"><h2>💰 Record Payment — {payModal.inv.id}</h2><button className="modal-close" onClick={()=>setPayModal(null)}>×</button></div>
        <div className="modal-body">
          <div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Invoice Total</span><span style={{fontWeight:700}}>${payModal.inv.total.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Already Paid</span><span style={{color:'#166534'}}>${payModal.inv.paid.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #e2e8f0',paddingTop:4,marginTop:4}}><span style={{fontWeight:700}}>Balance Due</span><span style={{fontWeight:800,color:'#dc2626'}}>${(payModal.inv.total-payModal.inv.paid).toLocaleString()}</span></div>
          </div>

          <div style={{marginBottom:12}}>
            <label className="form-label">Payment Method</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {PAY_METHODS.map(m=><button key={m.id} className={`btn btn-sm ${payModal.method===m.id?'btn-primary':'btn-secondary'}`}
                style={{fontSize:11}} onClick={()=>setPayModal(p=>({...p,method:m.id}))}>{m.icon} {m.label}</button>)}
            </div>
          </div>

          {payModal.method==='cc'&&<div style={{padding:8,background:'#fef3c7',borderRadius:6,marginBottom:12,fontSize:12}}>
            <strong>💳 Credit Card Surcharge:</strong> 2.9% (${(payModal.amount*CC_FEE_PCT).toFixed(2)}) will be added to the invoice.
            <div style={{fontSize:11,color:'#92400e',marginTop:2}}>Suggest Venmo, Zelle, ACH, or Check to avoid the fee.</div>
          </div>}

          <div className="form-row form-row-2">
            <div><label className="form-label">Amount</label>
              <input className="form-input" type="number" value={payModal.amount} onChange={e=>setPayModal(p=>({...p,amount:parseFloat(e.target.value)||0}))}/>
            </div>
            <div><label className="form-label">Reference / Note</label>
              <input className="form-input" value={payModal.ref} onChange={e=>setPayModal(p=>({...p,ref:e.target.value}))}
                placeholder={payModal.method==='check'?'Check #...':payModal.method==='venmo'?'@username':payModal.method==='cc'?'Card ending...':'Reference...'}/>
            </div>
          </div>

          {payModal.method==='cc'&&<div style={{marginTop:8,padding:8,background:'#f0fdf4',borderRadius:6,fontSize:12}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span>Payment:</span><span>${payModal.amount.toLocaleString()}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',color:'#d97706'}}><span>CC Fee (2.9%):</span><span>+${(payModal.amount*CC_FEE_PCT).toFixed(2)}</span></div>
            <div style={{display:'flex',justifyContent:'space-between',fontWeight:700,borderTop:'1px solid #e2e8f0',paddingTop:4,marginTop:4}}><span>Customer Total:</span><span>${(payModal.amount+payModal.amount*CC_FEE_PCT).toFixed(2)}</span></div>
          </div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setPayModal(null)}>Cancel</button>
          <button className="btn btn-primary" style={{background:'#166534'}} onClick={()=>{
            if(payModal.amount<=0){nf('Enter a valid amount','error');return}
            recordPayment(payModal.inv,payModal.amount,payModal.method,payModal.ref);
          }}>💰 Record ${payModal.amount.toLocaleString()}{payModal.method==='cc'?' + $'+(payModal.amount*CC_FEE_PCT).toFixed(2)+' fee':''}</button>
        </div>
      </div></div>}

      {/* PAST-DUE EMAIL MODAL — sends one Brevo email per selected customer */}
      {pdBulkModal&&(()=>{
        const pd=pdBulkModal;
        const upd=fn=>setPdBulkModal(s=>s?fn(s):s);
        const updCustomer=(idx,patch)=>upd(s=>({...s,customers:s.customers.map((c,i)=>i===idx?{...c,...patch}:c)}));
        const recipientsFor=(c)=>{const checkedEmails=Object.entries(c.checked||{}).filter(([,v])=>v).map(([k])=>k);return [...checkedEmails,...(c.customEmails||[])]};
        const sendableCustomers=pd.customers.filter(c=>recipientsFor(c).length>0);
        const totalInv=sendableCustomers.reduce((a,c)=>a+c.invoices.length,0);
        const totalDollars=sendableCustomers.reduce((a,c)=>a+c.total,0);
        // Sender options. The rep's own email shows whenever it's set; if Brevo
        // rejects it as an unverified sender, the rep can fall back to the
        // verified accounting@ / noreply@ options below.
        const senderOpts=[
          ...(cu?.email?[{key:'rep',name:cu.name||'My email',email:cu.email}]:[]),
          {key:'accounting',name:'NSA Accounting',email:'accounting@nationalsportsapparel.com'},
          {key:'noreply',name:'NSA Notifications',email:'noreply@nationalsportsapparel.com'},
        ];
        const activeSender=senderOpts.find(s=>s.key===pd.senderKey)||senderOpts[0];
        const sendAll=async()=>{
          if(sendableCustomers.length===0){nf('Pick at least one recipient','error');return}
          upd(s=>({...s,sending:true,progress:{done:0,total:sendableCustomers.length,sent:0,failed:0}}));
          const portalBase='https://nationalsportsapparel.com/coach?portal=';
          const _$ = n => '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
          for(const t of sendableCustomers){
            const c=t.customer;
            // Build statement HTML — every past-due invoice for this customer.
            const stmtRows=t.invoices.map(inv=>{
              const memo=inv.memo||'—';
              const po=inv._po_number||(sos.find(s=>s.id===inv.so_id)?.po_number)||'—';
              const date=inv.date||inv.invoice_date||'—';
              const due=inv.due_date||'—';
              return '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:600">'+(inv.id||'')+'</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">'+memo+'</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:11px">'+po+'</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">'+date+'</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">'+due+'</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;color:#b91c1c;font-weight:600">'+_$(inv._bal)+'</td></tr>';
            }).join('');
            const stmtTable=pd.options.includeStatement?'<div style="margin:18px 0"><div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px">Past-Due Invoices</div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9"><th style="padding:8px 10px;text-align:left">Invoice</th><th style="padding:8px 10px;text-align:left">Memo</th><th style="padding:8px 10px;text-align:left">PO #</th><th style="padding:8px 10px;text-align:left">Date</th><th style="padding:8px 10px;text-align:left">Due</th><th style="padding:8px 10px;text-align:right">Balance</th></tr></thead><tbody>'+stmtRows+'<tr><td colspan="5" style="padding:8px 10px;text-align:right;font-weight:700;border-top:2px solid #1e293b">Total Owed</td><td style="padding:8px 10px;text-align:right;font-weight:800;color:#b91c1c;border-top:2px solid #1e293b">'+_$(t.total)+'</td></tr></tbody></table></div>':'';
            const portalUrl=c.alpha_tag?(portalBase+c.alpha_tag):'';
            const payButton=(pd.options.includePayLink&&portalUrl)?'<div style="margin:20px 0"><a href="'+portalUrl+'" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px">View & Pay in Portal</a></div>':'';
            const greeting=(getBillingContacts(c,cust)[0]?.name||(c.contacts||[])[0]?.name||'Coach');
            const personalizedMsg=pd.message.replace(/\{name\}/g,greeting).replace(/\n/g,'<br/>');
            const htmlContent='<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:720px">'+personalizedMsg+stmtTable+payButton+'</div>';
            const toList=recipientsFor(t).map(email=>({email}));
            const res=await sendBrevoEmail({
              to:toList,
              subject:'Past-Due Invoices — '+_$(t.total)+' on your '+(c.name||'')+' account',
              htmlContent,
              senderName:activeSender.name,
              senderEmail:activeSender.email,
              replyTo:{email:activeSender.email,name:activeSender.name},
            });
            const ok=res.ok;
            upd(s=>({...s,progress:{...s.progress,done:s.progress.done+1,sent:s.progress.sent+(ok?1:0),failed:s.progress.failed+(ok?0:1)}}));
            if(!ok)console.warn('[past-due] failed for '+c.name+':',res.error);
          }
          upd(s=>({...s,sending:false}));
          nf('Past-due email: '+pd.progress.sent+' sent'+(pd.progress.failed>0?', '+pd.progress.failed+' failed':''));
        };
        return<div className="modal-overlay" onClick={()=>{if(!pd.sending)setPdBulkModal(null)}}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:760,maxHeight:'92vh',display:'flex',flexDirection:'column'}}>
          <div className="modal-header" style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white'}}>
            <h2 style={{color:'white',margin:0}}>📧 Email Past-Due Invoices</h2>
            <button className="modal-close" style={{color:'white'}} disabled={pd.sending} onClick={()=>setPdBulkModal(null)}>×</button>
          </div>
          <div className="modal-body" style={{overflow:'auto'}}>
            {/* Sender + include options */}
            <div style={{padding:10,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <label className="form-label" style={{margin:0,minWidth:78}}>Send from</label>
                <select className="form-input" value={pd.senderKey} onChange={e=>upd(s=>({...s,senderKey:e.target.value}))} style={{fontSize:12,flex:1}}>
                  {senderOpts.map(o=><option key={o.key} value={o.key}>{o.name} — {o.email}</option>)}
                </select>
              </div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#475569',cursor:'pointer'}}>
                  <input type="checkbox" checked={pd.options.includeStatement} onChange={e=>upd(s=>({...s,options:{...s.options,includeStatement:e.target.checked}}))}/>
                  Include account statement
                </label>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#475569',cursor:'pointer'}}>
                  <input type="checkbox" checked={pd.options.includePayLink} onChange={e=>upd(s=>({...s,options:{...s.options,includePayLink:e.target.checked}}))}/>
                  Include portal pay link
                </label>
              </div>
            </div>
            {/* Message template */}
            <div style={{marginBottom:12}}>
              <label className="form-label">Message <span style={{fontWeight:400,color:'#94a3b8',fontSize:10}}>(use {'{name}'} for the contact's first name)</span></label>
              <textarea className="form-input" rows={6} value={pd.message} onChange={e=>upd(s=>({...s,message:e.target.value}))} style={{fontSize:13,lineHeight:1.5}}/>
            </div>
            {/* Per-customer recipients */}
            {pd.customers.map((c,i)=>{
              const recCount=recipientsFor(c).length;
              return<div key={c.customer.id||i} style={{border:'1px solid #e2e8f0',borderRadius:8,padding:12,marginBottom:10,background:recCount>0?'#f8fafc':'#fafafa'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:'#1e293b'}}>{c.customer.name||'—'}</div>
                    {c.customer.alpha_tag&&<div style={{fontSize:10,color:'#64748b'}}>{c.customer.alpha_tag} · {c.invoices.length} past-due invoice{c.invoices.length!==1?'s':''}</div>}
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:'#b91c1c',whiteSpace:'nowrap'}}>${c.total.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                </div>
                <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4,textTransform:'uppercase'}}>Send to</div>
                <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:6}}>
                  {c.contacts.length===0&&<div style={{fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>No contacts with email on file — add one below.</div>}
                  {c.contacts.map(ct=>{
                    const sel=!!c.checked[ct.email];
                    return<label key={ct.email} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',borderRadius:4,background:sel?'#eff6ff':'transparent',fontSize:12,cursor:'pointer'}}>
                      <input type="checkbox" checked={sel} onChange={e=>updCustomer(i,{checked:{...c.checked,[ct.email]:e.target.checked}})} style={{accentColor:'#2563eb'}}/>
                      <span style={{fontWeight:sel?600:400,color:sel?'#1e40af':'#1e293b'}}>{ct.name||'Contact'}</span>
                      <span style={{color:'#64748b'}}>{ct.email}</span>
                      {ct.role&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:(ct.role||'').toLowerCase()==='billing'?'#ede9fe':'#f1f5f9',color:(ct.role||'').toLowerCase()==='billing'?'#6d28d9':'#64748b',fontWeight:600}}>{ct.role}</span>}
                      {ct._inherited_from&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:'#ede9fe',color:'#6d28d9',fontWeight:600}}>from {ct._inherited_from}</span>}
                    </label>;
                  })}
                  {(c.customEmails||[]).map(em=><label key={em} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',borderRadius:4,background:'#eff6ff',fontSize:12}}>
                    <input type="checkbox" checked readOnly style={{accentColor:'#2563eb'}}/>
                    <span style={{color:'#1e40af',fontWeight:600}}>{em}</span>
                    <span style={{fontSize:9,fontStyle:'italic',color:'#94a3b8'}}>(added)</span>
                    <button onClick={()=>updCustomer(i,{customEmails:c.customEmails.filter(e=>e!==em)})} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:14,padding:0,lineHeight:1}}>×</button>
                  </label>)}
                </div>
                <div style={{display:'flex',gap:6}}>
                  <input type="email" placeholder="+ Add another email…" value={c.customEmail||''} onChange={e=>updCustomer(i,{customEmail:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&(c.customEmail||'').includes('@')){e.preventDefault();const em=c.customEmail.trim();if(em&&!(c.customEmails||[]).includes(em))updCustomer(i,{customEmails:[...(c.customEmails||[]),em],customEmail:''})}}} className="form-input" style={{fontSize:11,padding:'4px 6px',flex:1}}/>
                  <button className="btn btn-sm btn-secondary" disabled={!(c.customEmail||'').includes('@')} onClick={()=>{const em=(c.customEmail||'').trim();if(em&&!(c.customEmails||[]).includes(em))updCustomer(i,{customEmails:[...(c.customEmails||[]),em],customEmail:''})}} style={{fontSize:10,whiteSpace:'nowrap'}}>+ Add</button>
                </div>
              </div>;
            })}
            {/* Progress */}
            {pd.sending&&<div style={{padding:10,background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:4}}>Sending… {pd.progress.done}/{pd.progress.total}</div>
              <div style={{height:6,background:'#dbeafe',borderRadius:3,overflow:'hidden'}}><div style={{height:6,background:'#2563eb',width:(pd.progress.total>0?(pd.progress.done/pd.progress.total*100):0)+'%',transition:'width 0.2s'}}/></div>
              <div style={{fontSize:10,color:'#1e40af',marginTop:4}}>✓ {pd.progress.sent} sent · {pd.progress.failed>0?'✗ '+pd.progress.failed+' failed':''}</div>
            </div>}
            {!pd.sending&&pd.progress.done>0&&<div style={{padding:10,background:'#f0fdf4',border:'1px solid #86efac',borderRadius:8,fontSize:12,color:'#166534',fontWeight:600}}>
              ✅ Done — {pd.progress.sent} sent{pd.progress.failed>0?', '+pd.progress.failed+' failed':''}.
            </div>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" disabled={pd.sending} onClick={()=>setPdBulkModal(null)}>{pd.progress.done>0?'Close':'Cancel'}</button>
            <button className="btn btn-primary" style={{background:'#2563eb'}} disabled={pd.sending||sendableCustomers.length===0||pd.progress.done>0} onClick={sendAll}>
              {pd.sending?'Sending…':'📧 Send to '+sendableCustomers.length+' customer'+(sendableCustomers.length===1?'':'s')+' ('+totalInv+' inv · $'+totalDollars.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})+')'}
            </button>
          </div>
        </div></div>;
      })()}
    </>);
  }
