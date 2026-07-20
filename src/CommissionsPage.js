// Commissions page — lifted verbatim out of App() (was `function rCommissions()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import { useAppData } from './AppContext';
import { calcSOStatus } from './components';
import { commissionRepId, isCommissionRep, isDecoOutsourced, outsourcedDecoTypes } from './businessLogic';
import { decoSplitQty, linkedArtCostQty } from './pricing';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP, rQ, parseDate, _decoUnitCostComb } from './App';
import { Fragment, useEffect, useRef, useState } from 'react';
import { supabase } from './lib/dbEngine';
import { sendBrevoEmail } from './utils';
import { canSnapshotLine, snapshotRowFromLine, applySnapshotToLine, overrideSnapshotPatch, isCommissionEarnedInvoice } from './commissionSnapshots';

// The Admin Dashboard tab is visible to this user only (Steve Peterson's seeded
// team_members id — same single-user gate as the App.js to-do list).
const ADMIN_DASH_USER_ID='00000000-0000-0000-0000-000000000001';

export default function CommissionsPage(){
  const {REPS,commMonth,commOverrides,commRep,commTab,cu,cust,invs,setCommMonth,setCommOverrides,setCommRep,setCommTab,setESO,setESOC,setESOTab,setPg,sos,setSOs}=useAppData();

    const isAdmin=cu.role==='admin'||cu.role==='super_admin';
    const isSteve=cu?.id===ADMIN_DASH_USER_ID;
    const salesReps=REPS.filter(isCommissionRep);
    // Admin sees all reps or picks one; rep only sees themselves
    const viewRepId=isAdmin?commRep:cu.id;

    // ── Commission snapshots: frozen money for paid invoices ──
    // A paid invoice's GP/rate/amount/paid-date freeze the first time this page sees the
    // line fully hydrated; later SO edits can't move the rep's statement. null = snapshots
    // not loaded yet (lines render live and NOTHING is written — never freeze blind).
    const[snaps,setSnaps]=useState(null);
    const _snapWriting=useRef(false);
    // Admin Dashboard: which rep rows / invoice rows are expanded
    const[dashOpen,setDashOpen]=useState({});
    const[dashInvOpen,setDashInvOpen]=useState({});
    // Draw & loan settings modal ({id,draw,loan,pct} while open) and the send-report
    // modal ({to,reps:{repId:bool}} while open)
    const[compEdit,setCompEdit]=useState(null);
    const[emailModal,setEmailModal]=useState(null);
    const[emailSending,setEmailSending]=useState(false);
    // Job-cost editor modal (draft of every editable cost input on one SO)
    const[costModal,setCostModal]=useState(null);

    // ── Rep comp settings (Admin Dashboard): monthly draw + employee loans ──
    // Stored in app_state under 'comm_rep_comp', written through the app_state_cas RPC
    // (00181) so two open tabs can't clobber each other; falls back to a plain upsert
    // while the RPC isn't deployed (same fallback App.js uses for comm_overrides).
    // null = not loaded yet — the payout panel renders as loading and edits are
    // disabled, so a failed load can never cause a blind overwrite.
    const[repComp,setRepComp]=useState(null);
    const _repCompVer=useRef(0);
    // Whether this browser has a REAL Supabase auth session. The LoginGate
    // admin-override picker sets cu without one — the DB then sees anon and rejects
    // every write (RLS + function grants), while the UI quietly reverts on the next
    // sync. null = unknown, false = override login: show a banner and block edits.
    const[hasAuth,setHasAuth]=useState(null);
    useEffect(()=>{let c=false;
      if(!supabase||!isSteve)return;
      supabase.auth.getSession().then(({data})=>{if(!c)setHasAuth(!!(data&&data.session))}).catch(()=>{if(!c)setHasAuth(null)});
      return()=>{c=true};
    },[isSteve]);
    useEffect(()=>{let cancelled=false;
      if(!supabase||!isSteve)return;
      supabase.from('app_state').select('value,version').eq('id','comm_rep_comp').maybeSingle().then(({data,error})=>{
        if(cancelled)return;
        if(error){console.warn('[Comm] rep comp settings load failed — payout panel disabled:',error.message);return}
        _repCompVer.current=(data&&data.version)||0;
        let v={};try{v=data&&data.value?JSON.parse(data.value):{}}catch(_){v={}}
        setRepComp(v);
      });
      return()=>{cancelled=true};
    },[isSteve]);
    const saveRepComp=async(next)=>{
      const prev=repComp;setRepComp(next);
      if(!supabase)return;
      const str=JSON.stringify(next);
      // Writes need a real Supabase auth session. The LoginGate admin-override path
      // (master password → user picker) sets cu WITHOUT one, so the DB sees anon and
      // denies the RPC — detect that and say so instead of showing a bare SQL error.
      const _failMsg=async(msg)=>{
        let hint='';
        try{const{data:sess}=await supabase.auth.getSession();if(!sess||!sess.session)hint='\n\nYou are signed in via the admin-override picker (no auth session), so the database rejects writes. Log out and sign in with your email + password, then retry.'}catch(_){/* ignore */}
        alert('Draw/loan save failed: '+msg+hint);
      };
      try{
        const{data,error}=await supabase.rpc('app_state_cas',{p_key:'comm_rep_comp',p_expected:_repCompVer.current,p_value:str});
        if(error){
          const missingFn=error.code==='PGRST202'||error.code==='42883'||/could not find the function|does not exist|schema cache/i.test(error.message||'');
          const denied=error.code==='42501'||/permission denied/i.test(error.message||'');
          if(missingFn||denied){
            const{error:e2}=await supabase.from('app_state').upsert({id:'comm_rep_comp',value:str,updated_at:new Date().toISOString()});
            if(e2){await _failMsg(e2.message);setRepComp(prev)}
            return;
          }
          await _failMsg(error.message);setRepComp(prev);return;
        }
        if(data===-1){
          const{data:row}=await supabase.from('app_state').select('value,version').eq('id','comm_rep_comp').maybeSingle();
          if(row){_repCompVer.current=row.version||0;try{setRepComp(JSON.parse(row.value||'{}'))}catch(_){setRepComp({})}}
          alert('Draw/loan settings were changed in another tab — showing the latest. Re-apply your change.');
          return;
        }
        if(typeof data==='number')_repCompVer.current=data;
      }catch(e){await _failMsg(e?.message||String(e));setRepComp(prev)}
    };
    useEffect(()=>{let cancelled=false;
      if(!supabase)return;
      supabase.from('commission_snapshots').select('*').limit(20000).then(({data,error})=>{
        if(cancelled)return;
        if(error){console.warn('[Comm] snapshot load failed — statement renders live:',error.message);return}
        const m={};(data||[]).forEach(r=>{m[r.invoice_id]=r});setSnaps(m);
      });
      return()=>{cancelled=true};
    },[]);

    // Gross profit calculator for an invoice
    // GP = Invoice Revenue − Garment Cost − Deco Cost − Outbound Shipping (ShipStation) − Inbound Freight (Supplier Bills)
    // dtl (optional array): filled with per-line detail rows for the Admin Dashboard
    // drill-down. Detail is captured as DELTAS of the same running totals the money
    // math already produces — the arithmetic below is untouched, so passing dtl can
    // never change a GP number. Detail rows are SO-level (unscaled); the returned
    // `scale` says what fraction of the SO this invoice covers.
    const calcGP=(inv,dtl)=>{
      // Commission revenue excludes CC surcharges: recordPayment folds card fees into inv.total
      // (tracked in inv.cc_fee), and reps must not earn GP on a processing-fee pass-through.
      const invRev=Math.max(0,safeNum(inv.total)-safeNum(inv.cc_fee||0));
      const so=sos.find(s=>s.id===inv.so_id);
      if(!so)return{rev:invRev,cost:0,gp:invRev,shipRev:0,shipCost:0,inboundFreight:0,scale:1};
      const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+(decoSplitQty(d)!=null?decoSplitQty(d):q2)*(d.reversible?2:1)}})});
      // Combined deco cost when the SO's jobs are manually linked to a shared screen on other SOs.
      const _comb=linkedArtCostQty(so,_aq,sos);
      const af=safeArt(so);let rev=0,cost=0;
      // Garment rev/cost must match the SO detail page and Reports pipeline (rReports.soCalc):
      // per-size sells/costs for 2XL+ upcharges, and actual PO unit_cost over catalog nsa_cost.
      // Commission pays on this GP, so a flat unit_sell/nsa_cost walk paid reps on a wrong number.
      // Outsourced gate mirrors OrderEditor totals / Costs tab — never double-count in-house
      // deco cost against a covering deco PO (SO-1397 understated GP/commission).
      const _poMeta=new Set(['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship','batch_queue_id','batch_po_number','preexisting','email_history','shipping']);
      const outByItem=outsourcedDecoTypes(so);
      safeItems(so).forEach((it,ii)=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sq>0?sq:safeNum(it.est_qty);if(!qty)return;
        const _dr0=rev,_dc0=cost;
        if(it._sizeSells&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)rev+=n*(it._sizeSells[sz]||safeNum(it.unit_sell))})}else{rev+=qty*safeNum(it.unit_sell)}
        let poQty=0,poCost=0;(Array.isArray(it.po_lines)?it.po_lines:[]).forEach(pl=>{if(!pl)return;const u=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);Object.entries(pl).forEach(([k,v])=>{if(k.startsWith('_')||_poMeta.has(k))return;if(typeof v!=='number'||v<=0)return;poQty+=v;poCost+=v*u})});
        if(poQty>0){cost+=poCost;const uncov=Math.max(0,qty-poQty);if(uncov>0){if(it._sizeCosts&&sq>0){const tot=Object.entries(safeSizes(it)).reduce((a,[sz,v])=>{const n=safeNum(v);return n>0?a+n*(it._sizeCosts[sz]||safeNum(it.nsa_cost)):a},0);const avg=sq>0?tot/sq:safeNum(it.nsa_cost);cost+=uncov*avg}else{cost+=uncov*safeNum(it.nsa_cost)}}}
        else if(it._sizeCosts&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)cost+=n*(it._sizeCosts[sz]||safeNum(it.nsa_cost))})}
        else{cost+=qty*safeNum(it.nsa_cost)}
        if(dtl)dtl.push({kind:'item',ii,soId:so.id,sku:it.sku||'',name:it.name||'',color:it.color||'',qty,rev:rev-_dr0,cost:cost-_dc0,poCovered:poQty>0,hasSizeCosts:!!(it._sizeCosts&&sq>0),nsaCost:safeNum(it.nsa_cost)});
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);const eq=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const _ddr=rev,_ddc=cost;const _out=isDecoOutsourced(so,ii,d,outByItem);rev+=eq*dp2.sell;if(!_out)cost+=eq*_decoUnitCostComb(d,qty,af,cq,_comb);
          if(dtl)dtl.push({kind:'deco',ii,type:String(d.type||d.kind||'deco').replace(/_/g,' '),qty:eq,rev:rev-_ddr,cost:cost-_ddc,outsourced:_out});});
      });
      // Outside deco POs — SO-level cost bucket
      const _db0=cost;
      (so.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=safeNum(dp.qty||0)*safeNum(dp.unit_cost||0)});
      if(dtl&&cost-_db0>0)dtl.push({kind:'bucket',label:'Outside deco POs',rev:0,cost:cost-_db0});
      // Shipping revenue (charged to customer)
      const shipRev=so.shipping_type==='pct'?rev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
      // Outbound shipping cost from ShipStation — fallback to shipment records
      const shipCost=safeNum(so._shipping_cost||so._shipstation_cost||0)||(so._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
      // Inbound freight from supplier bills tied to SO (manual override field)
      const inboundFreight=safeNum(so._inbound_freight||0);
      // Club fundraising (webstore/OMG stores) is REVENUE: the club is paid in Fundraiser
      // Dollars (a customer credit, see addFundraiseCredit in App.js), so the collected cash
      // stays with NSA now — the cost lands on the future order where the credit is redeemed
      // (Apply Credit reduces that invoice's total).
      // WEBSTORE fundraise is already INSIDE item unit_sell (the batcher prices lines from
      // collected = product + fundraise, Webstores.js collectedForLine) and therefore inside
      // invRev — dropping the old fundraiseCost is the whole flip; adding it again here
      // double-counts. OMG is the opposite: items are priced at retail and the auto-invoice
      // never bills the fundraise, so it's added on top of invRev.
      // (Pre-2026-07 webstore fundraise was booked as a cost here.)
      const fundraiseRev=safeNum(so._omg_fundraise||0);
      if(dtl){
        if(shipRev||shipCost)dtl.push({kind:'bucket',label:'Shipping (charged to customer vs cost)',rev:shipRev,cost:shipCost});
        if(inboundFreight)dtl.push({kind:'bucket',label:'Inbound freight (supplier bills)',rev:0,cost:inboundFreight});
        if(fundraiseRev)dtl.push({kind:'bucket',label:'OMG fundraise revenue',rev:fundraiseRev,cost:0});
      }
      const totalRev=rev+shipRev;const totalCost=cost+shipCost+inboundFreight;
      // Scale to invoice proportion (invoice may be partial payment of SO)
      const soTotal=totalRev||1;const scale=invRev/soTotal;
      return{rev:invRev+fundraiseRev,cost:Math.round(totalCost*scale*100)/100,gp:Math.round((invRev+fundraiseRev-totalCost*scale)*100)/100,shipRev:Math.round(shipRev*scale*100)/100,shipCost:Math.round(shipCost*scale*100)/100,inboundFreight:Math.round(inboundFreight*scale*100)/100};
    };

    // Build commission line items from paid invoices
    // Commission: 30% of GP if paid within 90 days, 15% if paid after 90 days
    const buildCommLines=(repFilter)=>{
      return invs.filter(inv=>{
        if(!isCommissionEarnedInvoice(inv))return false;
        const so=sos.find(s=>s.id===inv.so_id);
        if(repFilter&&repFilter!=='all'){const cc=cust.find(x=>x.id===inv.customer_id);return commissionRepId(cc,so)===repFilter}
        return true;
      }).map(inv=>{
        const so=sos.find(s=>s.id===inv.so_id);
        const c=cust.find(x=>x.id===inv.customer_id);
        const rep=REPS.find(r=>r.id===commissionRepId(c,so));
        const gp=calcGP(inv);
        // GP cost reflects a shared screen run across manually-linked jobs on other SOs.
        const _combLinked=!!so&&Object.keys(linkedArtCostQty(so,{},sos)).length>0;
        const invDate=parseDate(inv.date);
        // No updated_at fallback: any unrelated invoice edit bumps updated_at, which silently
        // flipped the 30%/15% rate and moved the line to a different statement month whenever
        // payment rows hadn't hydrated. A paid invoice with no payment rows falls back to the
        // invoice date (days-to-pay 0 → standard rate, statement month = invoice month).
        const paidDate=inv.payments?.length>0?parseDate(inv.payments[inv.payments.length-1].date):invDate;
        const daysToPay=paidDate&&invDate?Math.round((paidDate-invDate)/(1000*60*60*24)):null;
        const isLate=daysToPay!==null&&daysToPay>90;
        // Override shape: legacy `true` = restore to 30% on a late invoice; number = explicit per-invoice rate (decimal, e.g. 0.25 for 25%).
        const ovr=commOverrides[inv.id];
        const overridden=ovr!==undefined&&ovr!==false&&ovr!==null;
        const customRate=typeof ovr==='number'?ovr:null;
        // Per-rep basis (team_members.commission_basis, 00198): 'revenue' reps earn
        // commission_rate × commissionable revenue with no 90-day split (Rachel: 1%
        // of sale price). Default (null) keeps the standard 30%/15% of GP policy.
        const revBasis=rep?.commission_basis==='revenue';
        const repRate=revBasis?(safeNum(rep.commission_rate)||0.01):null;
        const commRate=customRate!=null?customRate:revBasis?repRate:(isLate&&!overridden?0.15:0.30);
        const commAmt=Math.round((revBasis?gp.rev:gp.gp)*commRate*100)/100;
        const paidAmt=inv.payments?.reduce((a,p)=>a+safeNum(p.amount),0)||0;
        const invMonth=inv.date?inv.date.substring(0,2)+'/'+inv.date.substring(6,8):'';// MM/YY
        const paidMonth=paidDate?(paidDate.getMonth()+1)+'/'+paidDate.getFullYear():'';
        const line={inv,so,customer:c,rep,gp,daysToPay,isLate,overridden,ovrRaw:ovr,commRate,commAmt,paidAmt,paidDate,invMonth,paidMonth,linked:_combLinked,repId:commissionRepId(c,so),commBasis:revBasis?'revenue':'gp'};
        // Frozen line: money fields come from the snapshot; _live keeps today's computation
        // around for the admin Re-freeze action (deliberate corrections only).
        const snap=snaps&&snaps[inv.id];
        return snap?{...applySnapshotToLine(line,snap,parseDate),_live:line}:line;
      });
    };

    // Build pipeline from open/unpaid invoices + uninvoiced open SOs
    const buildPipeline=(repFilter)=>{
      // Open and partially paid invoices stay in pipeline. Nothing is earned until
      // the invoice reaches fully paid, at which point buildCommLines moves it into
      // the statement using the final payment date.
      const invLines=invs.filter(inv=>{
        if(isCommissionEarnedInvoice(inv))return false;
        const so=sos.find(s=>s.id===inv.so_id);
        // Attribution follows the account owner via commissionRepId (see businessLogic.js): an open
        // invoice on another rep's account must never surface in the SO creator's pipeline.
        if(repFilter&&repFilter!=='all'){const cc=cust.find(x=>x.id===inv.customer_id);return commissionRepId(cc,so)===repFilter}
        return true;
      }).map(inv=>{
        const so=sos.find(s=>s.id===inv.so_id);
        const c=cust.find(x=>x.id===inv.customer_id);
        const rep=REPS.find(r=>r.id===commissionRepId(c,so));
        const gp=calcGP(inv);
        const invDate=new Date(inv.date);
        const now=new Date();const daysOpen=Math.round((now-invDate)/(1000*60*60*24));
        const willBeLate=daysOpen>90;
        const _revB=rep?.commission_basis==='revenue';
        const expRate=_revB?(safeNum(rep.commission_rate)||0.01):(willBeLate?0.15:0.30);
        const expComm=Math.round((_revB?gp.rev:gp.gp)*expRate*100)/100;
        const balance=safeNum(inv.total)-safeNum(inv.paid);
        return{inv,so,customer:c,rep,gp,daysOpen,willBeLate,expRate,expComm,balance,repId:commissionRepId(c,so),type:'invoice'};
      });
      // IDs of SOs that already have invoices
      const invoicedSOIds=new Set(invs.map(i=>i.so_id).filter(Boolean));
      // Open SOs without any invoice (not yet invoiced)
      const soLines=sos.filter(so=>{
        if(so.status==='deleted'||so.status==='cancelled')return false;
        const st=calcSOStatus(so);
        if(st==='complete')return false;
        if(invoicedSOIds.has(so.id))return false;
        if(repFilter&&repFilter!=='all'){const cc=cust.find(x=>x.id===so.customer_id);return commissionRepId(cc,so)===repFilter}
        return true;
      }).map(so=>{
        const c=cust.find(x=>x.id===so.customer_id);
        const rep=REPS.find(r=>r.id===commissionRepId(c,so));
        const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});
        const _comb=linkedArtCostQty(so,_aq,sos);
        const af=safeArt(so);let rev=0,cost=0;
        const outByItem=outsourcedDecoTypes(so);
        safeItems(so).forEach((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          rev+=qty*safeNum(it.unit_sell);cost+=qty*safeNum(it.nsa_cost);
          safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);rev+=qty*dp2.sell;if(!isDecoOutsourced(so,ii,d,outByItem))cost+=qty*_decoUnitCostComb(d,qty,af,cq,_comb)});
        });
        (so.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=safeNum(dp.qty||0)*safeNum(dp.unit_cost||0)});
        const shipRev=so.shipping_type==='pct'?rev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
        const shipCost=safeNum(so._shipping_cost||so._shipstation_cost||0)||(so._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
        const inboundFreight=safeNum(so._inbound_freight||0);
        const fundraiseRev=safeNum(so._omg_fundraise||0);// OMG fundraising = revenue on top (webstore's is already inside unit_sell; mirrors calcGP above)
        const totalRev=rev+shipRev+fundraiseRev;const totalCost=cost+shipCost+inboundFreight;
        const gp={rev:totalRev,cost:totalCost,gp:Math.round((totalRev-totalCost)*100)/100};
        const soStatus=calcSOStatus(so);
        const _revB=rep?.commission_basis==='revenue';
        const expRate=_revB?(safeNum(rep.commission_rate)||0.01):0.30;// on-time assumed since not yet invoiced
        const expComm=Math.round((_revB?gp.rev:gp.gp)*expRate*100)/100;
        return{inv:null,so,customer:c,rep,gp,daysOpen:null,willBeLate:false,expRate,expComm,balance:totalRev,repId:commissionRepId(c,so),type:'so',soStatus};
      });
      return[...invLines,...soLines];
    };

    // Build promo cost lines from SOs with promo_applied
    const buildPromoLines=(repFilter)=>{
      return sos.filter(so=>{
        if(!so.promo_applied)return false;
        if(so.status==='deleted')return false;
        if(repFilter&&repFilter!=='all'){const cc=cust.find(x=>x.id===so.customer_id);return commissionRepId(cc,so)===repFilter}
        return true;
      }).map(so=>{
        const c=cust.find(x=>x.id===so.customer_id);
        const rep=REPS.find(r=>r.id===commissionRepId(c,so));
        const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+q2}})});
        const _comb=linkedArtCostQty(so,_aq,sos);
        const soAf=safeArt(so);let productCost=0,decoCost=0,promoRev=0;
        const outByItem=outsourcedDecoTypes(so);
        safeItems(so).forEach((it,ii)=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!qty)return;
          if(it.is_promo){
            productCost+=qty*safeNum(it.nsa_cost);
            const sellP=safeNum(it.retail_price)||safeNum(it.nsa_cost)*2;promoRev+=qty*sellP;
            safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,soAf,cq);if(!isDecoOutsourced(so,ii,d,outByItem))decoCost+=qty*_decoUnitCostComb(d,qty,soAf,cq,_comb);promoRev+=qty*rQ(dp2.sell*1.25)});
          }
        });
        // Outside deco POs — only if promo-qualifying items are covered. Simpler: add all SO deco.
        (so.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);const c=bc>0?bc:safeNum(dp.qty||0)*safeNum(dp.unit_cost||0);decoCost+=c});
        const totalRev=promoRev;const baseShip=so.shipping_type==='pct'?totalRev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
        const shipCost=rQ(baseShip*1.25);
        const totalCost=productCost+decoCost+shipCost;
        const soDate=so.created_at?so.created_at.substring(0,10):'';
        const soMonth=soDate?soDate.substring(0,7):'';
        return{so,customer:c,rep,productCost:Math.round(productCost*100)/100,decoCost:Math.round(decoCost*100)/100,shipCost:Math.round(shipCost*100)/100,totalCost:Math.round(totalCost*100)/100,promoAmount:safeNum(so.promo_amount),soDate,soMonth,repId:commissionRepId(c,so)};
      });
    };

    const allLines=buildCommLines(viewRepId);
    const allPipeline=buildPipeline(viewRepId);
    const allPromoLines=buildPromoLines(viewRepId);

    // Freeze every fully-hydrated paid line that doesn't have a snapshot yet. Insert-only
    // (ignoreDuplicates) so two open tabs can't overwrite each other's freeze; afterwards
    // the ids are re-read so a row another tab inserted first lands in this map too.
    // Runs against ALL lines (not the rep filter) so an admin viewing one rep still
    // freezes everyone consistently only when viewing All — per-rep views freeze what
    // they can see; the rest freezes on the next All/own-rep visit.
    useEffect(()=>{
      if(!supabase||!snaps||_snapWriting.current)return;
      const missing=allLines.filter(l=>!l.snapped&&!snaps[l.inv.id]&&canSnapshotLine(l));
      if(!missing.length)return;
      _snapWriting.current=true;
      (async()=>{
        try{
          const rows=missing.map(l=>snapshotRowFromLine(l,cu?.name||cu?.email||''));
          for(let i=0;i<rows.length;i+=200){
            const{error}=await supabase.from('commission_snapshots').upsert(rows.slice(i,i+200),{onConflict:'invoice_id',ignoreDuplicates:true});
            if(error)throw error;
          }
          const ids=rows.map(r=>r.invoice_id);const got=[];
          for(let i=0;i<ids.length;i+=200){
            const{data,error}=await supabase.from('commission_snapshots').select('*').in('invoice_id',ids.slice(i,i+200));
            if(error)throw error;got.push(...(data||[]));
          }
          setSnaps(prev=>{const n={...prev};got.forEach(r=>{n[r.invoice_id]=r});return n});
        }catch(e){console.warn('[Comm] snapshot write failed — lines stay live until the next visit:',e?.message||e)}
        finally{_snapWriting.current=false}
      })();
    });

    // An admin override on a frozen line must land in the snapshot (the money of record),
    // not just app_state — otherwise the frozen statement and the override disagree.
    const _applyOvrToSnap=async(invId,ovr)=>{
      const snap=snaps&&snaps[invId];if(!snap||!supabase)return;
      const _rep=REPS.find(r=>r.id===snap.rep_id);
      const _basis=_rep?.commission_basis==='revenue'?'revenue':'gp';
      const patch=overrideSnapshotPatch(snap,ovr,_basis,_basis==='revenue'?(safeNum(_rep?.commission_rate)||0.01):null);
      const{data,error}=await supabase.from('commission_snapshots').update({...patch,updated_at:new Date().toISOString()}).eq('invoice_id',invId).select();
      if(error){alert('Override saved for display, but the frozen statement row failed to update — try again.\n\n'+error.message);return}
      if(data&&data[0])setSnaps(prev=>({...prev,[invId]:data[0]}));
    };
    // Deliberate correction path: recompute from today's live data and overwrite the freeze.
    const _resnap=async(l)=>{
      if(!supabase||!l._live)return;
      if(!window.confirm('Re-freeze '+l.inv.id+' at today\'s live numbers?\n\nOnly do this after deliberately correcting the order (costs, freight, payments) — it changes the rep\'s frozen statement.'))return;
      const row=snapshotRowFromLine(l._live,cu?.name||cu?.email||'');
      const{data,error}=await supabase.from('commission_snapshots').upsert([row],{onConflict:'invoice_id'}).select();
      if(error){alert('Re-freeze failed: '+error.message);return}
      if(data&&data[0])setSnaps(prev=>({...prev,[l.inv.id]:data[0]}));
    };

    // Filter promo lines by selected month
    const monthPromoLines=allPromoLines.filter(l=>l.soMonth===commMonth);
    const monthPromoCost=monthPromoLines.reduce((a,l)=>a+l.totalCost,0);

    // Filter by selected month for statement
    const monthLines=allLines.filter(l=>{
      if(!l.paidDate)return false;
      const ym=l.paidDate.getFullYear()+'-'+String(l.paidDate.getMonth()+1).padStart(2,'0');
      return ym===commMonth;
    });
    const monthTotal=monthLines.reduce((a,l)=>a+l.commAmt,0);
    const monthGP=monthLines.reduce((a,l)=>a+l.gp.gp,0);
    // Open invoices for the selected month (not yet paid)
    const monthPipeline=allPipeline.filter(l=>{
      if(l.type==='so')return false;// only invoices
      if(!l.inv?.date)return false;
      // Parse invoice date to match commMonth (YYYY-MM)
      const d=new Date(l.inv.date);const ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      return ym===commMonth;
    });
    // Net commission after promo costs deducted
    const monthNetComm=Math.round((monthTotal-monthPromoCost)*100)/100;

    // YTD
    const yr=new Date().getFullYear();
    const ytdLines=allLines.filter(l=>l.paidDate&&l.paidDate.getFullYear()===yr);
    const ytdComm=ytdLines.reduce((a,l)=>a+l.commAmt,0);
    const ytdGP=ytdLines.reduce((a,l)=>a+l.gp.gp,0);
    const ytdRev=ytdLines.reduce((a,l)=>a+l.gp.rev,0);
    const ytdPromoLines=allPromoLines.filter(l=>{const y=l.soDate?parseInt(l.soDate.substring(0,4)):0;return y===yr});
    const ytdPromoCost=ytdPromoLines.reduce((a,l)=>a+l.totalCost,0);
    const ytdNetComm=Math.round((ytdComm-ytdPromoCost)*100)/100;

    // By customer
    const byCust={};allLines.forEach(l=>{const cn=l.customer?.name||'Unknown';if(!byCust[cn])byCust[cn]={name:cn,gp:0,comm:0,invCount:0,rev:0,pipeRev:0,pipeGP:0,pipeComm:0,pipeCount:0};byCust[cn].gp+=l.gp.gp;byCust[cn].comm+=l.commAmt;byCust[cn].invCount++;byCust[cn].rev+=l.gp.rev});
    allPipeline.forEach(l=>{const cn=l.customer?.name||'Unknown';if(!byCust[cn])byCust[cn]={name:cn,gp:0,comm:0,invCount:0,rev:0,pipeRev:0,pipeGP:0,pipeComm:0,pipeCount:0};byCust[cn].pipeRev+=l.balance;byCust[cn].pipeGP+=l.gp.gp;byCust[cn].pipeComm+=l.expComm;byCust[cn].pipeCount++});
    const custList=Object.values(byCust).sort((a,b)=>(b.comm+b.pipeComm)-(a.comm+a.pipeComm));

    // Monthly breakdown for YTD chart
    const monthlyData={};ytdLines.forEach(l=>{const m=String(l.paidDate.getMonth()+1).padStart(2,'0');if(!monthlyData[m])monthlyData[m]={month:m,gp:0,comm:0,count:0};monthlyData[m].gp+=l.gp.gp;monthlyData[m].comm+=l.commAmt;monthlyData[m].count++});
    const months=['01','02','03','04','05','06','07','08','09','10','11','12'];
    const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Pipeline total
    const pipeTotal=allPipeline.reduce((a,l)=>a+l.expComm,0);
    const pipeBalance=allPipeline.reduce((a,l)=>a+l.balance,0);

    return(<>
      {/* Header with rep selector (admin only) */}
      <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
        {isAdmin&&<><span style={{fontSize:12,fontWeight:600,color:'#64748b'}}>Rep:</span>
          <select className="form-select" style={{width:180}} value={commRep} onChange={e=>setCommRep(e.target.value)}>
            <option value="all">All Reps</option>
            {salesReps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select></>}
        <div style={{display:'flex',gap:4,marginLeft:isAdmin?'auto':0}}>
          {[['statement','Statement'],['pipeline','Pipeline'],['promo','Promo'],['ytd','YTD'],['byCustomer','By Customer'],...(isAdmin?[['monthly','📤 Monthly Reports']]:[]),...(isSteve?[['adminDash','👑 Admin Dashboard']]:[])].map(([id,label])=>
            <button key={id} className={`btn btn-sm ${commTab===id?'btn-primary':'btn-secondary'}`} onClick={()=>setCommTab(id)}>{label}</button>)}
        </div>
      </div>

      {/* Summary cards */}
      <div className="stats-row" style={{marginBottom:16}}>
        <div className="stat-card"><div className="stat-label">This Month</div><div className="stat-value" style={{color:'#166534'}}>${monthNetComm.toLocaleString(undefined,{maximumFractionDigits:2})}</div>{monthPromoCost>0&&<div style={{fontSize:10,color:'#dc2626',marginTop:2}}>−${monthPromoCost.toLocaleString()} promo</div>}</div>
        <div className="stat-card"><div className="stat-label">YTD Earned</div><div className="stat-value" style={{color:'#1e40af'}}>${ytdNetComm.toLocaleString(undefined,{maximumFractionDigits:2})}</div>{ytdPromoCost>0&&<div style={{fontSize:10,color:'#dc2626',marginTop:2}}>−${ytdPromoCost.toLocaleString()} promo</div>}</div>
        <div className="stat-card"><div className="stat-label">Pipeline</div><div className="stat-value" style={{color:'#7c3aed'}}>${pipeTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
        <div className="stat-card"><div className="stat-label">Promo Costs</div><div className="stat-value" style={{color:'#dc2626'}}>${ytdPromoCost.toLocaleString(undefined,{maximumFractionDigits:2})}</div><div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{allPromoLines.length} orders YTD</div></div>
        <div className="stat-card"><div className="stat-label">Avg GP%</div><div className="stat-value" style={{color:ytdRev>0&&(ytdGP/ytdRev*100)>=30?'#166534':'#d97706'}}>{ytdRev>0?Math.round(ytdGP/ytdRev*100):0}%</div></div>
      </div>

      {/* MONTHLY STATEMENT TAB */}
      {commTab==='statement'&&<div className="card">
        <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h2>Commission Statement</h2>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m-2,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9664;</button>
            <input type="month" className="form-input" style={{width:160}} value={commMonth} onChange={e=>setCommMonth(e.target.value)}/>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9654;</button>
          </div>
        </div>
        <div className="card-body" style={{padding:0}}>
          {monthLines.length===0&&monthPipeline.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No invoices this month</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Invoice</th><th>Customer</th>{isAdmin&&<th>Rep</th>}<th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Gross Profit</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'center'}}>Days</th><th style={{textAlign:'center'}}>Rate</th><th style={{textAlign:'right'}}>Commission</th>{isAdmin&&<th></th>}
          </tr></thead><tbody>
            {monthLines.map(l=><tr key={l.inv.id} style={{background:l.isLate&&!l.overridden?'#fef2f2':''}}>
              <td style={{fontWeight:700,color:'#1e40af',cursor:'pointer'}} onClick={()=>{if(l.so){setESOTab('costs');setESO(l.so);setESOC(l.customer);setPg('orders')}}}>{l.inv.id}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.date}</div></td>
              <td>{l.customer?.name||'\u2014'}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.memo}</div></td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{textAlign:'right'}}>${l.gp.rev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.gp.cost.toLocaleString()}{l.linked&&<span title="Cost reflects one shared screen run across manually-linked jobs on other sales orders — not billed twice. The customer invoice is unaffected." style={{marginLeft:4,fontSize:9,fontWeight:700,color:'#166534'}}>🔗</span>}</td>
              <td style={{textAlign:'right',fontWeight:700,color:l.gp.gp>0?'#166534':'#dc2626'}}>${l.gp.gp.toLocaleString()}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.gp.rev>0&&l.gp.gp/l.gp.rev>=0.3?'#dcfce7':'#fef3c7',color:l.gp.rev>0&&l.gp.gp/l.gp.rev>=0.3?'#166534':'#92400e'}}>{l.gp.rev>0?Math.round(l.gp.gp/l.gp.rev*100):0}%</span></td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.isLate?'#fee2e2':'#dcfce7',color:l.isLate?'#dc2626':'#166534'}}>{l.daysToPay??'\u2014'}d</span></td>
              <td style={{textAlign:'center',fontWeight:600,color:l.commRate===0.30?'#166534':'#d97706'}}>{Math.round(l.commRate*100)}%</td>
              <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:'#166534'}}>${l.commAmt.toLocaleString(undefined,{maximumFractionDigits:2})}{l.snapped&&<span title={'Frozen at payment'+(l.snappedAt?' ('+String(l.snappedAt).substring(0,10)+')':'')+' — later order edits no longer change this line'} style={{marginLeft:4,fontSize:10,cursor:'default'}}>🔒</span>}</td>
              {isAdmin&&<td style={{textAlign:'center'}}>
                <div style={{display:'flex',gap:4,justifyContent:'center',alignItems:'center',flexWrap:'wrap'}}>
                  {l.isLate&&!l.overridden&&l.commBasis!=='revenue'&&<button className="btn btn-sm" style={{fontSize:9,background:'#fef3c7',border:'1px solid #f59e0b',color:'#92400e',padding:'2px 6px'}} title="Approve full 30% commission" onClick={()=>{setCommOverrides(p=>({...p,[l.inv.id]:true}));_applyOvrToSnap(l.inv.id,true)}}>Full 30%</button>}
                  <button className="btn btn-sm" style={{fontSize:9,background:'#eff6ff',border:'1px solid #93c5fd',color:'#1e40af',padding:'2px 6px'}} title="Set a custom commission % for this invoice" onClick={()=>{
                    const cur=Math.round(l.commRate*100);
                    const v=window.prompt(`Set commission % for ${l.inv.id}\n(default: ${l.isLate?'15% late / 30% on-time':'30%'})`,String(cur));
                    if(v===null)return;
                    const t=v.trim();
                    if(t===''){setCommOverrides(p=>{const n={...p};delete n[l.inv.id];return n});_applyOvrToSnap(l.inv.id,null);return}
                    const n=parseFloat(t);
                    if(!isNaN(n)&&n>=0&&n<=100){setCommOverrides(p=>({...p,[l.inv.id]:n/100}));_applyOvrToSnap(l.inv.id,n/100)}
                    else alert('Enter a number 0–100, or leave blank to clear the override.');
                  }}>Edit %</button>
                  {l.snapped&&<button className="btn btn-sm" style={{fontSize:9,background:'#f8fafc',border:'1px solid #cbd5e1',color:'#475569',padding:'2px 6px'}} title="Recompute this frozen line from today's live order data — use after a deliberate cost/payment correction" onClick={()=>_resnap(l)}>Re-freeze</button>}
                  {l.overridden&&<span style={{fontSize:9,color:'#166534',fontWeight:700}}>{typeof l.ovrRaw==='number'?'Custom':'Approved'}</span>}
                </div>
              </td>}
            </tr>)}
            {monthLines.length>0&&(()=>{const earnedRev=monthLines.reduce((a,l)=>a+safeNum(l.inv.total),0);const earnedGpPct=earnedRev>0?Math.round(monthGP/earnedRev*100):0;return<tr style={{fontWeight:800,background:'#f0f9ff',borderTop:'2px solid #1e40af'}}>
              <td colSpan={isAdmin?3:2}>EARNED</td>
              <td style={{textAlign:'right'}}>${earnedRev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthLines.reduce((a,l)=>a+l.gp.cost,0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${monthGP.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'center',color:earnedGpPct>=30?'#166534':'#92400e'}}>{earnedGpPct}%</td>
              <td colSpan={2}></td>
              <td style={{textAlign:'right',fontSize:16,color:'#166534'}}>${monthTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>})()}
            {monthPromoCost>0&&<tr style={{fontWeight:700,background:'#fef2f2',borderTop:'1px dashed #dc2626'}}>
              <td colSpan={isAdmin?3:2} style={{color:'#dc2626'}}>PROMO COST DEDUCTION ({monthPromoLines.length} order{monthPromoLines.length!==1?'s':''})</td>
              <td colSpan={5}></td>
              <td style={{textAlign:'right',fontSize:14,color:'#dc2626'}}>−${monthPromoCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>}
            {monthPromoCost>0&&<tr style={{fontWeight:800,background:'#f0fdf4',borderTop:'2px solid #166534'}}>
              <td colSpan={isAdmin?3:2}>NET COMMISSION</td>
              <td colSpan={5}></td>
              <td style={{textAlign:'right',fontSize:16,color:monthNetComm>=0?'#166534':'#dc2626'}}>${monthNetComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>}
            {monthPipeline.length>0&&<tr style={{background:'#f5f3ff'}}><td colSpan={isAdmin?11:9} style={{fontWeight:700,fontSize:11,color:'#7c3aed',padding:'8px 12px',borderTop:'2px solid #7c3aed'}}>OPEN INVOICES — Awaiting Payment</td></tr>}
            {monthPipeline.map(l=><tr key={l.inv.id} style={{background:'#faf5ff'}}>
              <td style={{fontWeight:700,color:'#7c3aed',cursor:'pointer'}} onClick={()=>{if(l.so){setESOTab('costs');setESO(l.so);setESOC(l.customer);setPg('orders')}}}>{l.inv.id}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.date}</div></td>
              <td>{l.customer?.name||'\u2014'}<div style={{fontSize:10,color:'#94a3b8'}}>{l.inv.memo}</div></td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{textAlign:'right'}}>${l.balance.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.gp.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'right',fontWeight:700,color:l.gp.gp>0?'#166534':'#dc2626'}}>${l.gp.gp.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.balance>0&&l.gp.gp/l.balance>=0.3?'#dcfce7':'#fef3c7',color:l.balance>0&&l.gp.gp/l.balance>=0.3?'#166534':'#92400e'}}>{l.balance>0?Math.round(l.gp.gp/l.balance*100):0}%</span></td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.willBeLate?'#fee2e2':l.daysOpen>60?'#fef3c7':'#dcfce7',color:l.willBeLate?'#dc2626':l.daysOpen>60?'#92400e':'#166534'}}>{l.daysOpen}d</span></td>
              <td style={{textAlign:'center',fontWeight:600,color:l.expRate===0.30?'#166534':'#d97706'}}>{Math.round(l.expRate*100)}%</td>
              <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>${l.expComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>)}
            {monthPipeline.length>0&&(()=>{const pipeRev=monthPipeline.reduce((a,l)=>a+l.balance,0);const pipeGP=monthPipeline.reduce((a,l)=>a+l.gp.gp,0);const pipeGpPct=pipeRev>0?Math.round(pipeGP/pipeRev*100):0;return<tr style={{fontWeight:800,background:'#f5f3ff',borderTop:'2px solid #7c3aed'}}>
              <td colSpan={isAdmin?3:2}>PIPELINE</td>
              <td style={{textAlign:'right'}}>${pipeRev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthPipeline.reduce((a,l)=>a+l.gp.cost,0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${pipeGP.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center',color:pipeGpPct>=30?'#166534':'#92400e'}}>{pipeGpPct}%</td>
              <td colSpan={2}></td>
              <td style={{textAlign:'right',fontSize:14,color:'#7c3aed'}}>${monthPipeline.reduce((a,l)=>a+l.expComm,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td/>}
            </tr>})()}
          </tbody></table>}
        </div>
      </div>}

      {/* PIPELINE TAB */}
      {commTab==='pipeline'&&<div className="card">
        <div className="card-header"><h2>Expected Commissions — Pipeline</h2><span style={{fontSize:12,color:'#64748b'}}>Outstanding: ${pipeBalance.toLocaleString()}</span></div>
        <div className="card-body" style={{padding:0}}>
          {allPipeline.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No open orders or invoices</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Order</th><th>Customer</th>{isAdmin&&<th>Rep</th>}<th style={{textAlign:'center'}}>Status</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Est. GP</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'center'}}>Days Open</th><th style={{textAlign:'center'}}>Est. Rate</th><th style={{textAlign:'right'}}>Expected Comm</th>
          </tr></thead><tbody>
            {allPipeline.sort((a,b)=>(b.type==='so'?1:0)-(a.type==='so'?1:0)||(b.daysOpen||0)-(a.daysOpen||0)).map(l=>{
              const stLabel={need_order:'Need Order',waiting_receive:'Waiting',items_received:'Items In',needs_pull:'Needs Pull',in_production:'In Prod',ready_to_invoice:'Ready Inv',complete:'Complete',booking:'Booking'};
              const isSOLine=l.type==='so';
              return<tr key={isSOLine?l.so.id:l.inv.id} style={{background:l.willBeLate?'#fef2f2':!isSOLine&&l.daysOpen>60?'#fffbeb':''}}>
              <td style={{fontWeight:700,color:isSOLine?'#7c3aed':'#1e40af',cursor:'pointer'}} onClick={()=>{if(l.so){setESOTab('costs');setESO(l.so);setESOC(l.customer);setPg('orders')}}}>{isSOLine?l.so.id:l.inv.id}<div style={{fontSize:10,color:'#94a3b8'}}>{isSOLine?l.so.created_at:l.inv.date}</div></td>
              <td>{l.customer?.name||'\u2014'}<div style={{fontSize:10,color:'#94a3b8'}}>{isSOLine?l.so.memo:l.inv.memo}</div></td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{textAlign:'center'}}>{isSOLine?<span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:'#ede9fe',color:'#6d28d9'}}>{stLabel[l.soStatus]||l.soStatus}</span>:<span style={{padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:600,background:'#dbeafe',color:'#1e40af'}}>Invoiced</span>}</td>
              <td style={{textAlign:'right',fontWeight:600}}>${l.balance.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.gp.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'right',color:l.gp.gp>0?'#166534':'#dc2626'}}>${l.gp.gp.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:l.balance>0&&l.gp.gp/l.balance>=0.3?'#dcfce7':'#fef3c7',color:l.balance>0&&l.gp.gp/l.balance>=0.3?'#166534':'#92400e'}}>{l.balance>0?Math.round(l.gp.gp/l.balance*100):0}%</span></td>
              <td style={{textAlign:'center'}}>{l.daysOpen!=null?<span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:600,background:l.willBeLate?'#fee2e2':l.daysOpen>60?'#fef3c7':'#dcfce7',color:l.willBeLate?'#dc2626':l.daysOpen>60?'#92400e':'#166534'}}>{l.daysOpen}d</span>:'\u2014'}</td>
              <td style={{textAlign:'center',fontWeight:600,color:l.expRate===0.30?'#166534':'#d97706'}}>{Math.round(l.expRate*100)}%</td>
              <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>${l.expComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>})}
            {(()=>{const tpGP=allPipeline.reduce((a,l)=>a+l.gp.gp,0);const tpGpPct=pipeBalance>0?Math.round(tpGP/pipeBalance*100):0;return<tr style={{fontWeight:800,background:'#f5f3ff',borderTop:'2px solid #7c3aed'}}>
              <td colSpan={isAdmin?4:3}>TOTAL PIPELINE</td>
              <td style={{textAlign:'right'}}>${pipeBalance.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${allPipeline.reduce((a,l)=>a+l.gp.cost,0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'right'}}>${tpGP.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center',color:tpGpPct>=30?'#166534':'#92400e'}}>{tpGpPct}%</td>
              <td colSpan={2}></td>
              <td style={{textAlign:'right',fontSize:16,color:'#7c3aed'}}>${pipeTotal.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>})()}
          </tbody></table>}
        </div>
      </div>}

      {/* PROMO COSTS TAB */}
      {commTab==='promo'&&<div className="card">
        <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h2>Promo Order Costs</h2>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m-2,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9664;</button>
            <input type="month" className="form-input" style={{width:160}} value={commMonth} onChange={e=>setCommMonth(e.target.value)}/>
            <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9654;</button>
          </div>
        </div>
        <div className="card-body" style={{padding:0}}>
          {monthPromoLines.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No promo orders this month</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>SO #</th><th>Customer</th>{isAdmin&&<th>Rep</th>}<th>Date</th><th style={{textAlign:'right'}}>Product Cost</th><th style={{textAlign:'right'}}>Deco Cost</th><th style={{textAlign:'right'}}>Shipping</th><th style={{textAlign:'right',fontWeight:800}}>Total Cost</th>
          </tr></thead><tbody>
            {monthPromoLines.map(l=><tr key={l.so.id}>
              <td style={{fontWeight:700,color:'#1e40af',cursor:'pointer'}} onClick={()=>{setESOTab('costs');setESO(l.so);setESOC(l.customer);setPg('orders')}}>{l.so.id}<div style={{fontSize:10,color:'#94a3b8'}}>{l.so.memo}</div></td>
              <td>{l.customer?.name||'\u2014'}</td>
              {isAdmin&&<td style={{fontSize:11}}>{l.rep?.name||'\u2014'}</td>}
              <td style={{fontSize:11,color:'#64748b'}}>{l.soDate}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.productCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.decoCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${l.shipCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',fontWeight:800,color:'#dc2626'}}>${l.totalCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>)}
            <tr style={{fontWeight:800,background:'#fef2f2',borderTop:'2px solid #dc2626'}}>
              <td colSpan={isAdmin?4:3}>TOTAL PROMO COSTS</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthPromoLines.reduce((a,l)=>a+l.productCost,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthPromoLines.reduce((a,l)=>a+l.decoCost,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',color:'#dc2626'}}>${monthPromoLines.reduce((a,l)=>a+l.shipCost,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',fontSize:14,color:'#dc2626'}}>${monthPromoCost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>
          </tbody></table>}
        </div>
        {monthPromoLines.length>0&&<div style={{padding:'12px 16px',background:'#fffbeb',borderTop:'1px solid #fde68a',fontSize:11,color:'#92400e'}}>
          <strong>Impact on Commission:</strong> These costs are deducted from your monthly commission. This month: ${monthTotal.toLocaleString(undefined,{maximumFractionDigits:2})} earned &minus; ${monthPromoCost.toLocaleString(undefined,{maximumFractionDigits:2})} promo costs = <strong>${monthNetComm.toLocaleString(undefined,{maximumFractionDigits:2})} net commission</strong>
        </div>}
      </div>}

      {/* YTD TAB */}
      {commTab==='ytd'&&<>
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h2>Year-to-Date — {yr}</h2></div>
          <div className="card-body">
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Total Revenue</div><div className="stat-value">${(ytdRev/1000).toFixed(1)}k</div></div>
              <div className="stat-card"><div className="stat-label">Total GP</div><div className="stat-value" style={{color:'#166534'}}>${(ytdGP/1000).toFixed(1)}k</div></div>
              <div className="stat-card"><div className="stat-label">Commission Earned</div><div className="stat-value" style={{color:'#1e40af'}}>${ytdComm.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>
              <div className="stat-card"><div className="stat-label">Invoices Paid</div><div className="stat-value">{ytdLines.length}</div></div>
            </div>
            {/* Monthly bar chart */}
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Monthly Breakdown</div>
              <div style={{display:'flex',gap:4,alignItems:'flex-end',height:120}}>
                {months.map((m,mi)=>{const d=monthlyData[m];const maxC=Math.max(1,...Object.values(monthlyData).map(x=>x.comm));const h=d?Math.max(4,d.comm/maxC*100):4;
                  return<div key={m} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                    {d&&<span style={{fontSize:9,color:'#166534',fontWeight:700}}>${Math.round(d.comm)}</span>}
                    <div style={{width:'100%',height:h,background:d?'#3b82f6':'#e2e8f0',borderRadius:3,transition:'height 0.3s'}}/>
                    <span style={{fontSize:9,color:'#94a3b8'}}>{monthNames[mi]}</span>
                  </div>})}
              </div>
            </div>
          </div>
        </div>
        {/* YTD detail table */}
        {isAdmin&&<div className="card">
          <div className="card-header"><h2>Rep Leaderboard — YTD</h2></div>
          <div className="card-body" style={{padding:0}}>
            <table style={{fontSize:12}}><thead><tr><th>Rep</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>GP</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'right'}}>Commission</th><th style={{textAlign:'center'}}>Invoices</th></tr></thead><tbody>
              {salesReps.filter(isCommissionRep).map(r=>{
                const rLines=ytdLines.filter(l=>l.repId===r.id);
                const rRev=rLines.reduce((a,l)=>a+safeNum(l.inv.total),0);
                const rGP=rLines.reduce((a,l)=>a+l.gp.gp,0);
                const rComm=rLines.reduce((a,l)=>a+l.commAmt,0);
                return<tr key={r.id}><td style={{fontWeight:700}}>{r.name}</td>
                  <td style={{textAlign:'right'}}>${rRev.toLocaleString()}</td>
                  <td style={{textAlign:'right',color:'#166534'}}>${rGP.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                  <td style={{textAlign:'center'}}>{rRev>0?Math.round(rGP/rRev*100):0}%</td>
                  <td style={{textAlign:'right',fontWeight:700,color:'#1e40af'}}>${rComm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                  <td style={{textAlign:'center'}}>{rLines.length}</td></tr>})}
            </tbody></table>
          </div>
        </div>}
      </>}

      {/* BY CUSTOMER TAB */}
      {commTab==='byCustomer'&&<div className="card">
        <div className="card-header"><h2>Commission by Customer</h2></div>
        <div className="card-body" style={{padding:0}}>
          {custList.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No commission data</div>:
          <table style={{fontSize:12}}><thead><tr>
            <th>Customer</th><th style={{textAlign:'center'}}>Invoices</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Gross Profit</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'right'}}>Earned</th><th style={{textAlign:'center'}}>Pipeline</th><th style={{textAlign:'right'}}>Pipe Rev</th><th style={{textAlign:'right'}}>Pipe Comm</th><th style={{textAlign:'right'}}>Total</th>
          </tr></thead><tbody>
            {custList.map(c=><tr key={c.name}>
              <td style={{fontWeight:700}}>{c.name}</td>
              <td style={{textAlign:'center'}}>{c.invCount}</td>
              <td style={{textAlign:'right'}}>${c.rev.toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${c.gp.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td style={{textAlign:'center'}}><span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:c.rev>0&&c.gp/c.rev>=0.3?'#dcfce7':'#fef3c7',color:c.rev>0&&c.gp/c.rev>=0.3?'#166534':'#92400e'}}>{c.rev>0?Math.round(c.gp/c.rev*100):0}%</span></td>
              <td style={{textAlign:'right',fontWeight:800,color:'#166534'}}>${c.comm.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'center',color:'#7c3aed'}}>{c.pipeCount||'\u2014'}</td>
              <td style={{textAlign:'right',color:'#7c3aed'}}>{c.pipeRev?'$'+c.pipeRev.toLocaleString():'\u2014'}</td>
              <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>{c.pipeComm?'$'+c.pipeComm.toLocaleString(undefined,{maximumFractionDigits:2}):'\u2014'}</td>
              <td style={{textAlign:'right',fontWeight:800,color:'#1e40af'}}>${(c.comm+c.pipeComm).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>)}
            <tr style={{fontWeight:800,background:'#f0f9ff',borderTop:'2px solid #1e40af'}}>
              <td>TOTAL</td>
              <td style={{textAlign:'center'}}>{custList.reduce((a,c)=>a+c.invCount,0)}</td>
              <td style={{textAlign:'right'}}>${custList.reduce((a,c)=>a+c.rev,0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#166534'}}>${custList.reduce((a,c)=>a+c.gp,0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
              <td></td>
              <td style={{textAlign:'right',color:'#166534'}}>${custList.reduce((a,c)=>a+c.comm,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'center',color:'#7c3aed'}}>{custList.reduce((a,c)=>a+c.pipeCount,0)}</td>
              <td style={{textAlign:'right',color:'#7c3aed'}}>${custList.reduce((a,c)=>a+c.pipeRev,0).toLocaleString()}</td>
              <td style={{textAlign:'right',color:'#7c3aed'}}>${custList.reduce((a,c)=>a+c.pipeComm,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              <td style={{textAlign:'right',fontSize:14,color:'#1e40af'}}>${custList.reduce((a,c)=>a+c.comm+c.pipeComm,0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
            </tr>
          </tbody></table>}
        </div>
      </div>}

      {/* MONTHLY REPORTS TAB — admin only. Per-rep statements for the selected month with a printable view. */}
      {commTab==='monthly'&&isAdmin&&(()=>{
        const reportableReps=salesReps.filter(isCommissionRep);
        const repReports=reportableReps.map(r=>{
          const lines=buildCommLines(r.id).filter(l=>{if(!l.paidDate)return false;const ym=l.paidDate.getFullYear()+'-'+String(l.paidDate.getMonth()+1).padStart(2,'0');return ym===commMonth});
          const promo=buildPromoLines(r.id).filter(l=>l.soMonth===commMonth);
          const earned=lines.reduce((a,l)=>a+l.commAmt,0);
          const promoCost=promo.reduce((a,l)=>a+l.totalCost,0);
          const net=Math.round((earned-promoCost)*100)/100;
          const rev=lines.reduce((a,l)=>a+safeNum(l.inv.total),0);
          const gp=lines.reduce((a,l)=>a+l.gp.gp,0);
          return{rep:r,lines,promo,earned,promoCost,net,rev,gp};
        }).filter(rr=>rr.lines.length>0||rr.promo.length>0).sort((a,b)=>b.net-a.net);
        const monthLabel=(()=>{const[y,m]=commMonth.split('-').map(Number);return new Date(y,m-1,1).toLocaleString('en-US',{month:'long',year:'numeric'})})();
        const fmt=n=>'$'+n.toLocaleString(undefined,{maximumFractionDigits:2});
        const fmt0=n=>'$'+Math.round(n).toLocaleString();
        const printRep=(rr)=>{
          const w=window.open('','_blank','width=900,height=1100');
          if(!w){alert('Popup blocked — please allow popups for this site.');return}
          const css=`body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:24px;max-width:780px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 16px;font-size:14px;color:#64748b;font-weight:500}table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}th{text-align:left;padding:8px 6px;border-bottom:2px solid #1e293b;background:#f8fafc;font-size:11px;text-transform:uppercase;color:#475569}td{padding:8px 6px;border-bottom:1px solid #e2e8f0}tfoot td{border-top:2px solid #1e293b;font-weight:700}.tr{text-align:right}.tc{text-align:center}.muted{color:#64748b;font-size:10px}.pos{color:#166534}.neg{color:#dc2626}.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:8px 0}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}.tile{padding:12px;border-radius:8px;text-align:center}.tile .v{font-size:20px;font-weight:800}.tile .l{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}.t1{background:#f0f9ff;color:#1e40af}.t2{background:#fef2f2;color:#dc2626}.t3{background:#f0fdf4;color:#166534}.t4{background:#f5f3ff;color:#6d28d9}@media print{button{display:none}}`;
          const earnedRows=rr.lines.map(l=>`<tr><td><strong>${l.inv.id}</strong><div class="muted">${l.inv.date||''}</div></td><td>${(l.customer?.name||'—').replace(/</g,'&lt;')}</td><td class="tr">${fmt0(l.gp.rev)}</td><td class="tr neg">${fmt0(l.gp.cost)}</td><td class="tr pos">${fmt0(l.gp.gp)}</td><td class="tc">${l.gp.rev>0?Math.round(l.gp.gp/l.gp.rev*100):0}%</td><td class="tc">${l.daysToPay??'—'}d</td><td class="tc">${Math.round(l.commRate*100)}%</td><td class="tr"><strong>${fmt(l.commAmt)}</strong></td></tr>`).join('');
          const promoRows=rr.promo.map(l=>`<tr><td><strong>${l.so.id}</strong><div class="muted">${l.soDate||''}</div></td><td>${(l.customer?.name||'—').replace(/</g,'&lt;')}</td><td class="tr neg">${fmt(l.productCost)}</td><td class="tr neg">${fmt(l.decoCost)}</td><td class="tr neg">${fmt(l.shipCost)}</td><td class="tr neg"><strong>−${fmt(l.totalCost)}</strong></td></tr>`).join('');
          w.document.write(`<!doctype html><html><head><title>Commission — ${rr.rep.name} — ${monthLabel}</title><style>${css}</style></head><body>
            <h1>Commission Statement</h1>
            <h2>${rr.rep.name} · ${monthLabel}</h2>
            <div class="tiles">
              <div class="tile t1"><div class="l">Earned</div><div class="v">${fmt(rr.earned)}</div></div>
              <div class="tile t2"><div class="l">Promo Costs</div><div class="v">−${fmt(rr.promoCost)}</div></div>
              <div class="tile t3"><div class="l">Net Commission</div><div class="v">${fmt(rr.net)}</div></div>
              <div class="tile t4"><div class="l">GP%</div><div class="v">${rr.rev>0?Math.round(rr.gp/rr.rev*100):0}%</div></div>
            </div>
            ${rr.lines.length>0?`<h3 style="margin-top:20px;font-size:13px">Earned — Paid Invoices</h3>
            <table><thead><tr><th>Invoice</th><th>Customer</th><th class="tr">Revenue</th><th class="tr">Cost</th><th class="tr">GP</th><th class="tc">GP%</th><th class="tc">Days</th><th class="tc">Rate</th><th class="tr">Comm</th></tr></thead>
            <tbody>${earnedRows}</tbody>
            <tfoot><tr><td colspan="2">TOTAL EARNED</td><td class="tr">${fmt0(rr.rev)}</td><td colspan="2"></td><td colspan="3"></td><td class="tr pos">${fmt(rr.earned)}</td></tr></tfoot></table>`:''}
            ${rr.promo.length>0?`<h3 style="margin-top:20px;font-size:13px">Promo Order Cost Deductions</h3>
            <table><thead><tr><th>SO</th><th>Customer</th><th class="tr">Product</th><th class="tr">Deco</th><th class="tr">Shipping</th><th class="tr">Total</th></tr></thead>
            <tbody>${promoRows}</tbody>
            <tfoot><tr><td colspan="5">TOTAL PROMO COSTS</td><td class="tr neg">−${fmt(rr.promoCost)}</td></tr></tfoot></table>`:''}
            <div class="box"><strong>Net Commission for ${monthLabel}: <span class="${rr.net>=0?'pos':'neg'}">${fmt(rr.net)}</span></strong></div>
            <div style="margin-top:24px;font-size:10px;color:#64748b"><strong>Policy:</strong> 30% of gross profit on invoices paid within 90 days of invoice date. 15% on invoices paid after 90 days. Promo costs are deducted from net commission.</div>
            <div style="margin-top:16px;text-align:center"><button onclick="window.print()" style="padding:8px 24px;font-size:13px;background:#1e40af;color:white;border:none;border-radius:6px;cursor:pointer">Print this report</button></div>
          </body></html>`);
          w.document.close();
        };
        return<div className="card">
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>📤 Monthly Commission Reports — {monthLabel}</h2>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m-2,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9664;</button>
              <input type="month" className="form-input" style={{width:160}} value={commMonth} onChange={e=>setCommMonth(e.target.value)}/>
              <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9654;</button>
              <button className="btn btn-sm btn-primary" disabled={repReports.length===0} onClick={()=>repReports.forEach((rr,i)=>setTimeout(()=>printRep(rr),i*250))}>Open all reports</button>
            </div>
          </div>
          <div className="card-body">
            {repReports.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No commission activity for any rep in {monthLabel}.</div>:
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(380px,1fr))',gap:12}}>
              {repReports.map(rr=>{
                const gpPct=rr.rev>0?Math.round(rr.gp/rr.rev*100):0;
                return<div key={rr.rep.id} style={{border:'1px solid #e2e8f0',borderRadius:8,padding:14,background:'white'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                    <div>
                      <div style={{fontSize:15,fontWeight:800,color:'#0f172a'}}>{rr.rep.name}</div>
                      <div style={{fontSize:11,color:'#64748b',textTransform:'capitalize'}}>{rr.rep.role}</div>
                    </div>
                    <button className="btn btn-sm btn-primary" style={{fontSize:11}} onClick={()=>printRep(rr)}>📄 Open / Print</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:10}}>
                    <div style={{padding:8,background:'#f0f9ff',borderRadius:6,textAlign:'center'}}>
                      <div style={{fontSize:9,fontWeight:700,color:'#1e40af',textTransform:'uppercase'}}>Earned</div>
                      <div style={{fontSize:18,fontWeight:800,color:'#1e40af'}}>{fmt(rr.earned)}</div>
                      <div style={{fontSize:10,color:'#64748b'}}>{rr.lines.length} invoice{rr.lines.length!==1?'s':''}</div>
                    </div>
                    <div style={{padding:8,background:rr.promoCost>0?'#fef2f2':'#f8fafc',borderRadius:6,textAlign:'center'}}>
                      <div style={{fontSize:9,fontWeight:700,color:rr.promoCost>0?'#dc2626':'#94a3b8',textTransform:'uppercase'}}>Promo Cost</div>
                      <div style={{fontSize:18,fontWeight:800,color:rr.promoCost>0?'#dc2626':'#94a3b8'}}>−{fmt(rr.promoCost)}</div>
                      <div style={{fontSize:10,color:'#64748b'}}>{rr.promo.length} promo order{rr.promo.length!==1?'s':''}</div>
                    </div>
                    <div style={{padding:8,background:'#f0fdf4',borderRadius:6,textAlign:'center'}}>
                      <div style={{fontSize:9,fontWeight:700,color:'#166534',textTransform:'uppercase'}}>Net Commission</div>
                      <div style={{fontSize:20,fontWeight:800,color:rr.net>=0?'#166534':'#dc2626'}}>{fmt(rr.net)}</div>
                    </div>
                    <div style={{padding:8,background:'#f5f3ff',borderRadius:6,textAlign:'center'}}>
                      <div style={{fontSize:9,fontWeight:700,color:'#6d28d9',textTransform:'uppercase'}}>Revenue · GP%</div>
                      <div style={{fontSize:18,fontWeight:800,color:'#6d28d9'}}>{fmt0(rr.rev)}</div>
                      <div style={{fontSize:10,color:gpPct>=30?'#166534':'#92400e',fontWeight:600}}>{gpPct}% GP</div>
                    </div>
                  </div>
                </div>;
              })}
            </div>}
            <div style={{marginTop:14,padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,fontSize:11,color:'#92400e'}}>
              <strong>How to distribute:</strong> click <em>Open / Print</em> to launch a clean printable statement in a new tab. The reps' page already restricts each rep to their own data; you can hand them the printout, save as PDF, or use <em>Open all reports</em> to pop one window per rep.
            </div>
          </div>
        </div>;
      })()}

      {/* ADMIN DASHBOARD TAB — Steve only. Every rep's commissions for the selected
          paid-month on one page; a rep row expands to the paid invoices (and promo
          deductions) behind it. All money comes from buildCommLines/buildPromoLines —
          the same math, snapshot freezes, and overrides as the Statement tab; nothing
          is recomputed here. */}
      {commTab==='adminDash'&&isSteve&&(()=>{
        const now=new Date();const nowYM=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
        const isMTD=commMonth===nowYM;
        const monthLabel=(()=>{const[y,m]=commMonth.split('-').map(Number);return new Date(y,m-1,1).toLocaleString('en-US',{month:'long',year:'numeric'})})();
        // Whole company regardless of the header rep selector: null filter = all reps.
        const linesM=buildCommLines(null).filter(l=>{if(!l.paidDate)return false;const ym=l.paidDate.getFullYear()+'-'+String(l.paidDate.getMonth()+1).padStart(2,'0');return ym===commMonth});
        const promoM=buildPromoLines(null).filter(l=>l.soMonth===commMonth);
        const byRep={};
        const bucket=id=>byRep[id]||(byRep[id]={repId:id,lines:[],promo:[],rev:0,cost:0,gp:0,comm:0,promoCost:0});
        linesM.forEach(l=>{const b=bucket(l.repId||'_none');b.lines.push(l);b.rev+=l.gp.rev;b.cost+=l.gp.cost;b.gp+=l.gp.gp;b.comm+=l.commAmt});
        promoM.forEach(l=>{const b=bucket(l.repId||'_none');b.promo.push(l);b.promoCost+=l.totalCost});
        const rows=Object.values(byRep).map(b=>({...b,rep:REPS.find(r=>r.id===b.repId),net:Math.round((b.comm-b.promoCost)*100)/100})).sort((a,b)=>b.net-a.net);
        const tot=rows.reduce((a,b)=>({rev:a.rev+b.rev,cost:a.cost+b.cost,gp:a.gp+b.gp,comm:a.comm+b.comm,promoCost:a.promoCost+b.promoCost,net:a.net+b.net,inv:a.inv+b.lines.length}),{rev:0,cost:0,gp:0,comm:0,promoCost:0,net:0,inv:0});
        const totGpPct=tot.rev>0?Math.round(tot.gp/tot.rev*100):0;
        const fmt=n=>'$'+n.toLocaleString(undefined,{maximumFractionDigits:2});
        const fmt0=n=>'$'+Math.round(n).toLocaleString();
        const fmtD=d=>d?(d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2):'—';
        const gpBadge=(gp,rev)=>{const ok=rev>0&&gp/rev>=0.3;return<span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:ok?'#dcfce7':'#fef3c7',color:ok?'#166534':'#92400e'}}>{rev>0?Math.round(gp/rev*100):0}%</span>};
        const openSO=l=>{if(l.so){setESOTab('costs');setESO(l.so);setESOC(l.customer);setPg('orders')}};
        const repName=b=>b.rep?.name||(b.repId==='_none'?'Unassigned':b.repId);
        const avgDays=ls=>{const v=ls.map(l=>l.daysToPay).filter(d=>d!=null);return v.length?Math.round(v.reduce((a,d)=>a+d,0)/v.length):null};
        const daysBadge=d=>d==null?'\u2014':<span style={{padding:'2px 6px',borderRadius:8,fontSize:10,fontWeight:600,background:d>90?'#fee2e2':d>60?'#fef3c7':'#dcfce7',color:d>90?'#dc2626':d>60?'#92400e':'#166534'}}>{d}d</span>;
        // ── Job cost editor: one modal editing every durable cost input on the SO ──
        // Durable fields only (verified against the save path): item nsa_cost (so_items
        // column), PO-line unit_cost (so_item_po_lines jsonb), outside deco PO unit_cost
        // (sales_orders.deco_pos jsonb), _shipping_cost/_shipstation_cost and
        // _inbound_freight (real sales_orders columns). Saved with one setSOs — App's
        // diff-save effect persists through _dbSaveSO (outbox), the same idiom App.js
        // uses for its own single-field SO edits. Per-size vendor costs are session-only
        // (no DB column) and deco pricing-engine costs come from global rate tables, so
        // neither is editable here.
        const openCostModal=(l)=>{
          const so=l.so;if(!so)return;
          const items=safeItems(so).map((it,ii)=>{
            const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)||safeNum(it.est_qty);
            const poLines=(Array.isArray(it.po_lines)?it.po_lines:[]).map((pl,pi)=>pl?{pi,label:(pl.po_id||'PO line '+(pi+1))+(pl.vendor?' · '+pl.vendor:''),unitCost:pl.unit_cost!=null?String(pl.unit_cost):''}:null).filter(Boolean);
            return{ii,label:(it.sku?it.sku+' ':'')+(it.name||'Item')+(it.color?' · '+it.color:''),qty,nsaCost:it.nsa_cost!=null?String(it.nsa_cost):'',poLines,hasSizeCosts:!!it._sizeCosts};
          });
          const decoPos=(so.deco_pos||[]).map((dp,di)=>({di,label:(dp.po_id||'Deco PO '+(di+1))+((dp.deco_vendor||dp.vendor)?' · '+(dp.deco_vendor||dp.vendor):'')+(dp.deco_type?' · '+dp.deco_type:''),qty:safeNum(dp.qty||0),unitCost:dp.unit_cost!=null?String(dp.unit_cost):'',billCost:safeNum(dp._bill_cost||0)}));
          const ship=String(safeNum(so._shipping_cost||so._shipstation_cost||0));
          const freight=String(safeNum(so._inbound_freight||0));
          setCostModal({soId:so.id,invId:l.inv.id,snapped:!!l.snapped,items,decoPos,ship,shipOrig:ship,freight,freightOrig:freight});
        };
        const saveCostModal=()=>{
          const m=costModal;if(!m)return;
          if(hasAuth===false){alert('You are signed in via the admin-override picker — the database rejects writes from this session, so this edit would silently revert.\n\nLog out, sign in with your email + password, and redo the edit.');return}
          const num=v=>{const n=parseFloat(v);return isNaN(n)||n<0?0:n};
          setSOs(prev=>prev.map(s=>{
            if(s.id!==m.soId)return s;
            const items=safeItems(s).map((it,ii)=>{
              const d=m.items.find(x=>x.ii===ii);if(!d)return it;
              const out={...it,nsa_cost:num(d.nsaCost)};
              if(Array.isArray(it.po_lines)&&d.poLines.length)out.po_lines=it.po_lines.map((pl,pi)=>{const pd=d.poLines.find(x=>x.pi===pi);if(!pl||!pd)return pl;const t=String(pd.unitCost).trim();return{...pl,unit_cost:t===''?null:num(pd.unitCost)}});
              return out;
            });
            const deco_pos=(s.deco_pos||[]).map((dp,di)=>{const dd=m.decoPos.find(x=>x.di===di);if(!dd)return dp;return{...dp,unit_cost:num(dd.unitCost)}});
            const next={...s,items,deco_pos,updated_at:new Date().toLocaleString()};
            if(m.ship!==m.shipOrig){const sv2=num(m.ship);next._shipping_cost=sv2;next._shipstation_cost=sv2}
            if(m.freight!==m.freightOrig)next._inbound_freight=num(m.freight);
            return next;
          }));
          setCostModal(null);
          if(m.snapped)setTimeout(()=>alert('Costs saved. '+m.invId+' is frozen at payment — click Re-freeze in the expanded row to update the frozen commission.'),100);
        };
        // ── Payouts: draw + loan math per rep for this month ──
        // The DRAW measures against GROSS PROFIT (per Steve): a rep must generate GP
        // above their monthly draw, and commission pays only on the GP beyond it —
        // payable = net commission × (GP over draw ÷ total GP), i.e. the rep's own
        // blended rate applied to the excess GP. No negative carryover between months.
        // Then loan withholding (loanPct% of payable, capped at the balance, skipped
        // when "pay full this month" is checked) → payout. Once a month is Applied,
        // the stored loanLog amount is authoritative and the row locks until Undone.
        const payoutRows=(()=>{
          // Every commission-eligible rep appears, even at $0 for the month — plus any
          // rep with activity this month and any rep carrying draw/loan settings.
          const ids=new Set(rows.map(b=>b.repId));
          salesReps.forEach(r=>ids.add(r.id));
          Object.entries(repComp||{}).forEach(([id,c])=>{if(c&&(safeNum(c.draw)>0||safeNum(c.loanBalance)>0))ids.add(id)});
          return[...ids].map(id=>{
            const b=rows.find(r=>r.repId===id)||{repId:id,rep:REPS.find(r=>r.id===id),lines:[],promo:[],rev:0,cost:0,gp:0,comm:0,promoCost:0,net:0};
            const s=(repComp||{})[id]||{};
            const draw=safeNum(s.draw);
            const gp=Math.round(b.gp*100)/100;
            const underBy=draw>0?Math.max(0,Math.round((draw-gp)*100)/100):0;
            const excessGP=draw>0?Math.max(0,Math.round((gp-draw)*100)/100):gp;
            const payable=draw>0?(gp>0?Math.max(0,Math.round(b.net*(excessGP/gp)*100)/100):0):Math.max(0,Math.round(b.net*100)/100);
            const loanBal=Math.round(safeNum(s.loanBalance)*100)/100;
            const pct=s.loanPct!=null?safeNum(s.loanPct):50;
            const full=!!(s.fullMonths&&s.fullMonths[commMonth]);
            const appliedAmt=s.loanLog&&s.loanLog[commMonth]!=null?safeNum(s.loanLog[commMonth]):null;
            const withhold=appliedAmt!=null?appliedAmt:(loanBal>0&&!full?Math.min(Math.round(payable*pct)/100,loanBal):0);
            const payout=Math.round((payable-withhold)*100)/100;
            const hasComp=draw>0||loanBal>0||appliedAmt!=null;
            const paidRec=(s.paid&&s.paid[commMonth])||null;
            return{b,s,id,draw,gp,underBy,excessGP,payable,loanBal,pct,full,appliedAmt,withhold,payout,hasComp,paidRec};
          }).sort((a,c)=>c.payout-a.payout);
        })();
        const totPayout=payoutRows.reduce((a,p)=>a+p.payout,0);
        const updateComp=(id,patch)=>{const cur=(repComp||{})[id]||{};saveRepComp({...(repComp||{}),[id]:{...cur,...patch}})};
        const toggleFullMonth=(p)=>{
          if(repComp===null)return;
          if(p.appliedAmt!=null){alert('This month is already applied to the loan — undo it first.');return}
          const fm={...(p.s.fullMonths||{})};if(fm[commMonth])delete fm[commMonth];else fm[commMonth]=true;
          updateComp(p.id,{fullMonths:fm});
        };
        const applyLoan=(p)=>{
          if(repComp===null||p.appliedAmt!=null||p.withhold<=0)return;
          if(!window.confirm('Apply $'+p.withhold.toFixed(2)+' of '+repName(p.b)+"'s "+monthLabel+' commission to their loan?\n\nLoan balance: $'+p.loanBal.toFixed(2)+' \u2192 $'+(Math.round((p.loanBal-p.withhold)*100)/100).toFixed(2)+'\n\nThis locks the month; you can Undo it later.'))return;
          const log={...(p.s.loanLog||{})};log[commMonth]=p.withhold;
          updateComp(p.id,{loanBalance:Math.round((p.loanBal-p.withhold)*100)/100,loanLog:log});
        };
        const undoLoan=(p)=>{
          if(repComp===null||p.appliedAmt==null)return;
          if(!window.confirm('Undo the $'+p.appliedAmt.toFixed(2)+' loan application for '+repName(p.b)+' in '+monthLabel+'? The amount goes back onto the loan balance.'))return;
          const log={...(p.s.loanLog||{})};delete log[commMonth];
          updateComp(p.id,{loanBalance:Math.round((safeNum(p.s.loanBalance)+p.appliedAmt)*100)/100,loanLog:log});
        };
        // Mark a rep's month as PAID — records the payout amount, when, and by whom
        // in comm_rep_comp, so the dashboard shows what was actually disbursed even
        // if the month's numbers move later.
        const markPaid=(p)=>{
          if(repComp===null)return;
          let msg='Mark '+repName(p.b)+"'s "+monthLabel+' commission as PAID?\n\nPayout: $'+p.payout.toFixed(2);
          if(p.withhold>0&&p.appliedAmt==null)msg+='\n\n⚠ $'+p.withhold.toFixed(2)+' loan withholding has NOT been applied to the loan balance yet — usually you Apply to loan first.';
          if(!window.confirm(msg))return;
          const paid={...(p.s.paid||{})};paid[commMonth]={amount:p.payout,at:new Date().toISOString(),by:cu?.name||''};
          updateComp(p.id,{paid});
        };
        const unmarkPaid=(p)=>{
          const rec=p.paidRec;if(!rec)return;
          if(!window.confirm('Un-mark '+repName(p.b)+"'s "+monthLabel+' payment of $'+safeNum(rec.amount).toFixed(2)+'?'))return;
          const paid={...(p.s.paid||{})};delete paid[commMonth];
          updateComp(p.id,{paid});
        };
        const markAllPaid=()=>{
          if(repComp===null)return;
          const unpaid=payoutRows.filter(p=>!p.paidRec);
          if(!unpaid.length){alert('Every rep is already marked paid for '+monthLabel+'.');return}
          const totalUnpaid=unpaid.reduce((a,p)=>a+p.payout,0);
          if(!window.confirm('Mark ALL '+unpaid.length+' remaining reps as PAID for '+monthLabel+'?\n\nTotal payout: $'+totalUnpaid.toFixed(2)))return;
          const next={...(repComp||{})};const at=new Date().toISOString();
          unpaid.forEach(p=>{const cur=next[p.id]||{};next[p.id]={...cur,paid:{...(cur.paid||{}),[commMonth]:{amount:p.payout,at,by:cu?.name||''}}}});
          saveRepComp(next);
        };
        // ── Export / email ──
        const csvCell=v=>{const s=v==null?'':String(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
        const csvString=(selIds)=>{
          const selRows=rows.filter(b=>!selIds||selIds.has(b.repId));
          const sTot=selRows.reduce((a,b)=>({rev:a.rev+b.rev,cost:a.cost+b.cost,gp:a.gp+b.gp,net:a.net+b.net}),{rev:0,cost:0,gp:0,net:0});
          const out=[['Rep','Type','Ref','Customer','Paid / Date','Days to Pay','Rate','Revenue','Cost','GP','GP%','Commission','Frozen']];
          selRows.forEach(b=>{const name=repName(b);
            [...b.lines].sort((a,c)=>(c.paidDate||0)-(a.paidDate||0)).forEach(l=>out.push([name,'Invoice',l.inv.id,l.customer?.name||'',fmtD(l.paidDate),l.daysToPay??'',Math.round(l.commRate*100)+'%',l.gp.rev.toFixed(2),l.gp.cost.toFixed(2),l.gp.gp.toFixed(2),(l.gp.rev>0?Math.round(l.gp.gp/l.gp.rev*100):0)+'%',l.commAmt.toFixed(2),l.snapped?'yes':'no']));
            b.promo.forEach(l=>out.push([name,'Promo deduction',l.so.id,l.customer?.name||'',l.soDate,'','','','','','',(-l.totalCost).toFixed(2),'']));
            const _ad=avgDays(b.lines);
            out.push([name+' — TOTAL','','','','',_ad!=null?_ad+' avg':'','',b.rev.toFixed(2),b.cost.toFixed(2),b.gp.toFixed(2),(b.rev>0?Math.round(b.gp/b.rev*100):0)+'%',b.net.toFixed(2),'']);
          });
          const _adAll=avgDays(selRows.flatMap(b=>b.lines));
          out.push(['TOTAL','','','','',_adAll!=null?_adAll+' avg':'','',sTot.rev.toFixed(2),sTot.cost.toFixed(2),sTot.gp.toFixed(2),(sTot.rev>0?Math.round(sTot.gp/sTot.rev*100):0)+'%',sTot.net.toFixed(2),'']);
          if(repComp!==null){
            const selPay=payoutRows.filter(p=>!selIds||selIds.has(p.id));
            out.push([]);
            out.push(['PAYOUTS — '+monthLabel,'Net Commission','GP','Monthly Draw (GP)','Under Draw By','Payable','To Loan','Loan Balance Remaining','PAYOUT','Paid']);
            selPay.forEach(p=>out.push([repName(p.b),p.b.net.toFixed(2),p.gp.toFixed(2),p.draw>0?p.draw.toFixed(2):'',p.underBy>0?p.underBy.toFixed(2):'',p.payable.toFixed(2),p.withhold>0?p.withhold.toFixed(2):'',p.loanBal>0||p.appliedAmt!=null?p.loanBal.toFixed(2):'',p.payout.toFixed(2),p.paidRec?'paid '+String(p.paidRec.at).substring(0,10):'']));
            out.push(['TOTAL PAYOUT','','','','','','','',selPay.reduce((a,p)=>a+p.payout,0).toFixed(2),'']);
          }
          return out.map(r=>r.map(csvCell).join(',')).join('\r\n');
        };
        const downloadCsv=()=>{
          const blob=new Blob(['\ufeff'+csvString(null)],{type:'text/csv;charset=utf-8;'});
          const url=URL.createObjectURL(blob);const a=document.createElement('a');
          a.href=url;a.download='commissions-'+commMonth+'.csv';document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),1500);
        };
        const openEmailModal=()=>{
          // Owners and departed staff are unchecked by default so accounting's report
          // doesn't tag them as commissionable — they stay in the list and can be
          // re-checked for a one-off send. Match by name (case-insensitive).
          const DEFAULT_EXCLUDE=['steve peterson','gayle peterson','aaron mason'];
          const reps={};payoutRows.forEach(p=>{const nm=(p.b.rep?.name||'').trim().toLowerCase();reps[p.id]=!DEFAULT_EXCLUDE.includes(nm)});
          setEmailModal({to:'accounting@nationalsportsapparel.com',reps});
        };
        const sendReport=async()=>{
          if(!emailModal||emailSending)return;
          const toList=emailModal.to.split(/[,;\s]+/).map(s=>s.trim()).filter(Boolean);
          if(!toList.length||toList.some(t=>!t.includes('@'))){alert('Enter one or more valid email addresses (comma-separated).');return}
          const selIds=new Set(Object.entries(emailModal.reps).filter(([,v])=>v).map(([k])=>k));
          if(!selIds.size){alert('Select at least one rep to include.');return}
          setEmailSending(true);
          try{
            const esc=s=>String(s||'').replace(/</g,'&lt;');
            const td='padding:6px 8px;border-bottom:1px solid #e2e8f0';
            const selPay=payoutRows.filter(p=>selIds.has(p.id));
            const anyComp=repComp!==null&&selPay.some(p=>p.hasComp);
            const summary=selPay.map(p=>{const b=p.b;return`<tr><td style="${td};font-weight:700">${esc(repName(b))}</td><td style="${td};text-align:center">${b.lines.length}</td><td style="${td};text-align:right">${fmt0(b.rev)}</td><td style="${td};text-align:center">${b.rev>0?Math.round(b.gp/b.rev*100):0}%</td><td style="${td};text-align:right">${fmt(b.net)}</td>${anyComp?`<td style="${td};text-align:right;color:#92400e">${p.draw>0?(p.underBy>0?'under draw by '+fmt(p.underBy):'met ('+fmt(p.draw)+' GP)'):'\u2014'}</td><td style="${td};text-align:right;color:#dc2626">${p.withhold>0?'\u2212'+fmt(p.withhold):'\u2014'}</td>`:''}<td style="${td};text-align:right;font-weight:800">${fmt(repComp!==null?p.payout:b.net)}</td></tr>`}).join('');
            const selTotNet=selPay.reduce((a,p)=>a+p.b.net,0);
            const selTotPay=selPay.reduce((a,p)=>a+(repComp!==null?p.payout:p.b.net),0);
            const html=`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:760px">
              <h2 style="margin:0 0 4px">Commission Report \u2014 ${monthLabel}${isMTD?' (Month to Date)':''}</h2>
              <p style="margin:0 0 16px;color:#64748b;font-size:13px">Sent from the NSA Portal admin commissions dashboard by ${esc(cu?.name||'')}. Invoice-level detail is in the attached CSV.${anyComp?' Payout = net commission \u2212 monthly draw \u2212 loan withholding.':''}</p>
              <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>
                <th style="${td};text-align:left">Rep</th><th style="${td}">Invoices</th><th style="${td};text-align:right">Revenue</th><th style="${td}">GP%</th><th style="${td};text-align:right">Net Commission</th>${anyComp?`<th style="${td};text-align:right">Draw (GP)</th><th style="${td};text-align:right">To Loan</th>`:''}<th style="${td};text-align:right">Payout</th>
              </tr></thead><tbody>${summary}
                <tr><td style="${td};font-weight:800" colspan="4">TOTAL</td><td style="${td};text-align:right;font-weight:800">${fmt(selTotNet)}</td>${anyComp?`<td style="${td}" colspan="2"></td>`:''}<td style="${td};text-align:right;font-weight:800">${fmt(selTotPay)}</td></tr>
              </tbody></table>
              <p style="margin:16px 0 0;font-size:11px;color:#64748b">Policy: 30% of GP paid within 90 days, 15% after. Promo order costs deduct from net commission. Revenue is commissionable revenue (excludes CC surcharges, includes OMG fundraise).</p>
            </div>`;
            const b64=btoa(unescape(encodeURIComponent('\ufeff'+csvString(selIds))));
            const res=await sendBrevoEmail({to:toList.map(email=>({email})),subject:'Commission Report \u2014 '+monthLabel+(isMTD?' (MTD)':''),htmlContent:html,senderName:'NSA Portal',senderEmail:'accounting@nationalsportsapparel.com',attachment:[{name:'commissions-'+commMonth+'.csv',content:b64}]});
            if(res?.ok){alert('Report emailed to '+toList.join(', '));setEmailModal(null)}
            else alert('Email failed: '+(res?.error||'unknown error'));
          }finally{setEmailSending(false)}
        };
        return<>
          {hasAuth===false&&<div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,marginBottom:12,fontSize:12,color:'#991b1b',fontWeight:600}}>
            ⚠ You're signed in via the admin-override picker — this session has no auth token, so the database rejects every save (cost edits, draw/loan, overrides, re-freezes) and the screen reverts on the next sync. Log out and sign in with your email + password to make changes stick.
          </div>}
          <div className="card">
            <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
              <h2>👑 Admin Dashboard — {monthLabel}{isMTD?' (Month to Date)':''}</h2>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m-2,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9664;</button>
                <input type="month" className="form-input" style={{width:160}} value={commMonth} onChange={e=>setCommMonth(e.target.value)}/>
                <button className="btn btn-sm btn-secondary" onClick={()=>{const[y,m]=commMonth.split('-').map(Number);const d=new Date(y,m,1);setCommMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}}>&#9654;</button>
                <button className={`btn btn-sm ${isMTD?'btn-primary':'btn-secondary'}`} title="Jump to the current month (month to date)" onClick={()=>setCommMonth(nowYM)}>MTD</button>
              </div>
            </div>
            <div className="card-body">
              <div className="stats-row">
                <div className="stat-card"><div className="stat-label">Commissions{tot.promoCost>0?' (Net)':''}</div><div className="stat-value" style={{color:'#166534'}}>{fmt(tot.net)}</div>{tot.promoCost>0&&<div style={{fontSize:10,color:'#dc2626',marginTop:2}}>{fmt(tot.comm)} earned − {fmt(tot.promoCost)} promo</div>}</div>
                <div className="stat-card"><div className="stat-label">Overall GP%</div><div className="stat-value" style={{color:totGpPct>=30?'#166534':'#d97706'}}>{totGpPct}%</div></div>
                <div className="stat-card"><div className="stat-label">Gross Profit</div><div className="stat-value" style={{color:'#166534'}}>{fmt0(tot.gp)}</div></div>
                <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value">{fmt0(tot.rev)}</div></div>
                <div className="stat-card"><div className="stat-label">Invoices Paid</div><div className="stat-value">{tot.inv}</div></div>
                {repComp!==null&&<div className="stat-card"><div className="stat-label">Payout</div><div className="stat-value" style={{color:'#0f766e'}}>{fmt(Math.round(totPayout*100)/100)}</div><div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>after draws & loans</div></div>}
              </div>
            </div>
          </div>
          <div className="card" style={{marginTop:16}}>
            <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
              <h2>Commissions by Rep</h2>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:11,color:'#64748b'}}>Click a rep → invoices · click an invoice → line items</span>
                <button className="btn btn-sm btn-secondary" disabled={rows.length===0} title="Download this report as a CSV spreadsheet" onClick={downloadCsv}>⬇ Export CSV</button>
                <button className="btn btn-sm btn-primary" disabled={rows.length===0} title="Choose recipients and which reps to include, then email the report (CSV attached)" onClick={openEmailModal}>✉ Send Report…</button>
              </div>
            </div>
            <div className="card-body" style={{padding:0}}>
              {rows.length===0?<div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No paid invoices or promo orders in {monthLabel}.</div>:
              <table style={{fontSize:12}}><thead><tr>
                <th>Rep</th><th style={{textAlign:'center'}}>Invoices</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Gross Profit</th><th style={{textAlign:'center'}}>GP%</th><th style={{textAlign:'center'}}>Days Paid</th><th style={{textAlign:'right'}}>Earned</th><th style={{textAlign:'right'}}>Promo</th><th style={{textAlign:'right'}}>Net Commission</th>
              </tr></thead><tbody>
                {rows.map(b=>{const open=!!dashOpen[b.repId];const name=b.rep?.name||(b.repId==='_none'?'⚠ Unassigned':b.repId);
                  return<Fragment key={b.repId}>
                    <tr style={{cursor:'pointer',background:open?'#f0f9ff':''}} onClick={()=>setDashOpen(p=>({...p,[b.repId]:!p[b.repId]}))}>
                      <td style={{fontWeight:800,color:'#0f172a'}}><span style={{display:'inline-block',width:14,color:'#64748b'}}>{open?'▼':'▶'}</span>{name}</td>
                      <td style={{textAlign:'center'}}>{b.lines.length}</td>
                      <td style={{textAlign:'right'}}>{fmt0(b.rev)}</td>
                      <td style={{textAlign:'right',color:'#dc2626'}}>{fmt0(b.cost)}</td>
                      <td style={{textAlign:'right',fontWeight:700,color:b.gp>0?'#166534':'#dc2626'}}>{fmt0(b.gp)}</td>
                      <td style={{textAlign:'center'}}>{gpBadge(b.gp,b.rev)}</td>
                      <td style={{textAlign:'center'}} title="Average days from invoice to payment">{daysBadge(avgDays(b.lines))}</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'#1e40af'}}>{fmt(b.comm)}</td>
                      <td style={{textAlign:'right',color:b.promoCost>0?'#dc2626':'#94a3b8'}}>{b.promoCost>0?'−'+fmt(b.promoCost):'—'}</td>
                      <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:b.net>=0?'#166534':'#dc2626'}}>{fmt(b.net)}</td>
                    </tr>
                    {open&&[...b.lines].sort((a,c)=>(c.paidDate||0)-(a.paidDate||0)).map(l=>{
                      const iOpen=!!dashInvOpen[l.inv.id];
                      // Verification flags: red = no cost at all (missing purchase price →
                      // GP and commission overstated); yellow = GP over 60% (suspiciously
                      // high — usually the same problem in partial form).
                      const zeroInv=l.gp.cost===0;const lateInv=!!l.isLate;const hotInv=!zeroInv&&!lateInv&&l.gp.rev>0&&l.gp.gp/l.gp.rev>0.6;
                      return<Fragment key={l.inv.id}>
                      <tr style={{background:zeroInv?'#fee2e2':lateInv?'#dbeafe':hotInv?'#fef9c3':iOpen?'#eef2f7':'#f8fafc',cursor:'pointer'}} onClick={()=>setDashInvOpen(p=>({...p,[l.inv.id]:!p[l.inv.id]}))}>
                        <td style={{paddingLeft:28}}><span style={{display:'inline-block',width:12,color:'#94a3b8',fontSize:9}}>{iOpen?'▼':'▶'}</span><span style={{fontWeight:700,color:'#1e40af'}} onClick={e=>{e.stopPropagation();openSO(l)}} title="Open the order's Costs tab">{l.inv.id}</span><span style={{marginLeft:8,color:'#475569'}}>{l.customer?.name||'—'}</span>{l.snapped&&<span title="Frozen at payment — later order edits no longer change this line" style={{marginLeft:4,fontSize:10}}>🔒</span>}{zeroInv&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#dc2626'}}>$0 COST</span>}{lateInv&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#1e40af'}}>PAID {l.daysToPay}d</span>}</td>
                        <td style={{textAlign:'center',fontSize:10,color:'#64748b'}}>paid {fmtD(l.paidDate)}</td>
                        <td style={{textAlign:'right'}}>{fmt0(l.gp.rev)}</td>
                        <td style={{textAlign:'right',color:'#dc2626'}}>{fmt0(l.gp.cost)}</td>
                        <td style={{textAlign:'right',color:l.gp.gp>0?'#166534':'#dc2626'}}>{fmt0(l.gp.gp)}</td>
                        <td style={{textAlign:'center'}}>{gpBadge(l.gp.gp,l.gp.rev)}</td>
                        <td style={{textAlign:'center'}}>{daysBadge(l.daysToPay)}</td>
                        <td style={{textAlign:'right',color:'#1e40af'}}>{fmt(l.commAmt)}<span style={{marginLeft:4,fontSize:9,fontWeight:600,color:l.commRate===0.30||l.commBasis==='revenue'?'#166534':'#d97706'}}>@{l.commBasis==='revenue'?(Math.round(l.commRate*1000)/10)+'% of sale':Math.round(l.commRate*100)+'%'}</span></td>
                        <td colSpan={2} style={{textAlign:'center'}}>{lateInv&&l.commBasis!=='revenue'&&(()=>{
                          // Paid >90 days late: pick the rate. 15% = the default late penalty
                          // (clears any override); 30% = admin restores the full rate. Both
                          // write through the same override + frozen-snapshot path as the
                          // Statement tab, so the two views can never disagree.
                          const at30=l.commRate===0.30,at15=l.commRate===0.15;
                          const bs={fontSize:9,padding:'2px 7px',borderRadius:6,cursor:'pointer',fontWeight:700};
                          return<span style={{display:'inline-flex',gap:4}} onClick={e=>e.stopPropagation()}>
                            <button style={{...bs,background:at15?'#1e40af':'#f8fafc',color:at15?'white':'#64748b',border:'1px solid #93c5fd'}} title="Keep the 15% late rate (clears any override)" onClick={()=>{setCommOverrides(p=>{const n={...p};delete n[l.inv.id];return n});_applyOvrToSnap(l.inv.id,null)}}>15%</button>
                            <button style={{...bs,background:at30?'#166534':'#f8fafc',color:at30?'white':'#64748b',border:'1px solid #86efac'}} title="Restore the full 30% rate on this late invoice" onClick={()=>{setCommOverrides(p=>({...p,[l.inv.id]:true}));_applyOvrToSnap(l.inv.id,true)}}>30%</button>
                          </span>})()}</td>
                      </tr>
                      {iOpen&&(()=>{
                        const dtl=[];const g=calcGP(l.inv,dtl);
                        // Push the "Outside deco POs" SO-level cost back onto the outsourced
                        // deco lines it pays for, so each art/deco line shows a real cost and
                        // margin instead of a misleading $0 / 100%. Display only — total cost is
                        // unchanged (it only moves between rows); the split is proportional to
                        // each outsourced line's revenue, so it's exact in total and approximate
                        // per line across mixed deco types.
                        (()=>{
                          const bkt=dtl.find(d=>d.kind==='bucket'&&d.label==='Outside deco POs');
                          if(!bkt||!(bkt.cost>0))return;
                          const outs=dtl.filter(d=>d.kind==='deco'&&d.outsourced&&(d.cost||0)===0);
                          if(!outs.length)return;
                          const byRev=outs.reduce((a,d)=>a+(d.rev||0),0)>0;
                          const base=byRev?outs.reduce((a,d)=>a+(d.rev||0),0):outs.reduce((a,d)=>a+(d.qty||0),0);
                          if(!(base>0))return;
                          let assigned=0;
                          outs.forEach((d,i)=>{const share=i===outs.length-1?Math.round((bkt.cost-assigned)*100)/100:Math.round(bkt.cost*((byRev?(d.rev||0):(d.qty||0))/base)*100)/100;assigned+=share;d.cost=share;d.allocated=true});
                          bkt._folded=true;// cost now lives on the deco lines — drop the bucket row
                        })();
                        const rows2=dtl.filter(d=>!d._folded);
                        const dRev=rows2.reduce((a,d)=>a+(d.rev||0),0);const dCost=rows2.reduce((a,d)=>a+(d.cost||0),0);
                        const scaled=Math.abs((g.scale!=null?g.scale:1)-1)>0.02;
                        return<tr><td colSpan={10} style={{padding:'0 12px 12px 46px',background:'#f1f5f9'}}>
                          <div style={{display:'flex',gap:8,alignItems:'center',padding:'8px 0 4px',fontSize:10,color:'#64748b',flexWrap:'wrap'}}>
                            <button className="btn btn-sm" style={{fontSize:9,background:'#eff6ff',border:'1px solid #93c5fd',color:'#1e40af',padding:'2px 8px',fontWeight:700}} title="Edit every cost on this job — item purchase costs, PO line costs, outside deco POs, shipping, freight" onClick={()=>openCostModal(l)}>✎ Edit job costs</button>
                            {l.snapped&&<>🔒 The invoice totals above are frozen at payment; the line detail below is live from today's order data.<button className="btn btn-sm" style={{fontSize:9,background:'#f8fafc',border:'1px solid #cbd5e1',color:'#475569',padding:'2px 6px'}} title="Recompute the frozen commission from today's live order data — use after correcting a cost" onClick={()=>_resnap(l)}>Re-freeze</button></>}
                          </div>
                          <table style={{fontSize:11,width:'100%',marginTop:4}}><thead><tr>
                            <th>Line</th><th style={{textAlign:'center'}}>Qty</th><th style={{textAlign:'right'}}>Unit Sell</th><th style={{textAlign:'right'}}>Unit Cost</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>GP</th><th style={{textAlign:'center'}}>GP%</th><th/>
                          </tr></thead><tbody>
                            {rows2.map((d,di)=>{
                              const lgp=(d.rev||0)-(d.cost||0);
                              // $0-cost flag: a real cost input is missing. Outsourced deco with
                              // its PO cost allocated is not zero-cost; an outsourced line left
                              // unallocated (no bucket to spread) genuinely has no cost booked.
                              const zero=((d.kind==='item')||(d.kind==='deco'&&!d.allocated))&&d.qty>0&&(d.cost||0)===0;
                              // >60% GP flag now applies to allocated deco lines too — they carry a
                              // real (approximate) cost, so a high margin there is worth a look.
                              const hot=!zero&&(d.kind==='item'||d.kind==='deco')&&d.rev>0&&lgp/d.rev>0.6;
                              const label=d.kind==='item'?((d.sku?d.sku+' ':'')+(d.name||'Item')+(d.color?' · '+d.color:'')):d.kind==='deco'?('↳ '+d.type+(d.outsourced?(d.allocated?' (outsourced — deco PO allocated)':' (outsourced — cost in Outside deco POs)'):'')):d.label;
                              return<tr key={di} style={{background:zero?'#fee2e2':hot?'#fef9c3':'white'}}>
                                <td style={{fontWeight:d.kind==='item'?600:400,color:d.kind==='bucket'?'#64748b':'#0f172a',paddingLeft:d.kind==='deco'?18:6}}>{label}{zero&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#dc2626'}}>$0 COST</span>}</td>
                                <td style={{textAlign:'center'}}>{d.qty!=null?d.qty:'—'}</td>
                                <td style={{textAlign:'right'}}>{d.qty>0?'$'+(d.rev/d.qty).toFixed(2):'—'}</td>
                                <td style={{textAlign:'right',color:'#dc2626'}}>{d.qty>0?'$'+(d.cost/d.qty).toFixed(2):'—'}{d.kind==='item'&&d.poCovered&&<span title="This unit cost comes from the actual PO line — edit the PO unit cost in ✎ Edit job costs to change it; the catalog cost only covers non-PO quantity" style={{marginLeft:3,fontSize:8,fontWeight:700,color:'#6d28d9',cursor:'help'}}>PO</span>}{d.allocated&&<span title="Outsourced decoration — the outside deco PO cost is allocated onto this line proportional to revenue, so the order total reconciles. Edit the deco PO unit cost in ✎ Edit job costs." style={{marginLeft:3,fontSize:8,fontWeight:700,color:'#0d9488',cursor:'help'}}>alloc</span>}</td>
                                <td style={{textAlign:'right'}}>{fmt(Math.round((d.rev||0)*100)/100)}</td>
                                <td style={{textAlign:'right',color:'#dc2626'}}>{fmt(Math.round((d.cost||0)*100)/100)}</td>
                                <td style={{textAlign:'right',fontWeight:600,color:lgp>=0?'#166534':'#dc2626'}}>{fmt(Math.round(lgp*100)/100)}</td>
                                <td style={{textAlign:'center'}}>{d.rev>0?gpBadge(lgp,d.rev):'—'}</td>
                                <td/>
                              </tr>})}
                            <tr style={{fontWeight:700,borderTop:'1px solid #cbd5e1'}}>
                              <td>Order total{scaled?' (full order)':''}</td><td colSpan={3}/>
                              <td style={{textAlign:'right'}}>{fmt(Math.round(dRev*100)/100)}</td>
                              <td style={{textAlign:'right',color:'#dc2626'}}>{fmt(Math.round(dCost*100)/100)}</td>
                              <td style={{textAlign:'right',color:dRev-dCost>=0?'#166534':'#dc2626'}}>{fmt(Math.round((dRev-dCost)*100)/100)}</td>
                              <td style={{textAlign:'center'}}>{dRev>0?gpBadge(dRev-dCost,dRev):'—'}</td><td/>
                            </tr>
                          </tbody></table>
                          {scaled&&<div style={{marginTop:6,fontSize:10,color:'#92400e'}}>This invoice covers ~{Math.round((g.scale||0)*100)}% of {l.so?.id} — line detail is the full order; the invoice totals above are scaled to this invoice's share.</div>}
                          {dtl.length===0&&<div style={{padding:'8px 0',fontSize:11,color:'#94a3b8'}}>No line detail available — the order behind this invoice isn't loaded or has no items.</div>}
                        </td></tr>})()}
                      </Fragment>})}
                    {open&&b.promo.map(l=><tr key={'p_'+l.so.id} style={{background:'#fef2f2'}}>
                      <td style={{paddingLeft:28}}><span style={{fontWeight:700,color:'#dc2626',cursor:'pointer'}} onClick={()=>openSO(l)}>{l.so.id}</span><span style={{marginLeft:8,color:'#475569'}}>{l.customer?.name||'—'}</span><span style={{marginLeft:8,fontSize:9,fontWeight:700,color:'#dc2626'}}>PROMO</span></td>
                      <td style={{textAlign:'center',fontSize:10,color:'#64748b'}}>{l.soDate}</td>
                      <td colSpan={5}/>
                      <td colSpan={2} style={{textAlign:'right',fontSize:10,color:'#64748b'}}>promo cost deduction</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>−{fmt(l.totalCost)}</td>
                    </tr>)}
                  </Fragment>})}
                <tr style={{fontWeight:800,background:'#f0f9ff',borderTop:'2px solid #1e40af'}}>
                  <td>TOTAL</td>
                  <td style={{textAlign:'center'}}>{tot.inv}</td>
                  <td style={{textAlign:'right'}}>{fmt0(tot.rev)}</td>
                  <td style={{textAlign:'right',color:'#dc2626'}}>{fmt0(tot.cost)}</td>
                  <td style={{textAlign:'right',color:'#166534'}}>{fmt0(tot.gp)}</td>
                  <td style={{textAlign:'center',color:totGpPct>=30?'#166534':'#92400e'}}>{totGpPct}%</td>
                  <td style={{textAlign:'center'}}>{daysBadge(avgDays(rows.flatMap(b=>b.lines)))}</td>
                  <td style={{textAlign:'right',color:'#1e40af'}}>{fmt(tot.comm)}</td>
                  <td style={{textAlign:'right',color:tot.promoCost>0?'#dc2626':'#94a3b8'}}>{tot.promoCost>0?'−'+fmt(tot.promoCost):'—'}</td>
                  <td style={{textAlign:'right',fontSize:15,color:tot.net>=0?'#166534':'#dc2626'}}>{fmt(tot.net)}</td>
                </tr>
              </tbody></table>}
            </div>
            <div style={{padding:'10px 16px',borderTop:'1px solid #e2e8f0',fontSize:11,color:'#64748b'}}>
              Grouped by <strong>payment month</strong> — an invoice lands in the month its last payment came in, same as the Statement tab. Revenue is commissionable revenue (excludes CC surcharges, includes OMG fundraise). 🔒 lines are frozen at payment.
              <span style={{marginLeft:8}}><span style={{background:'#fee2e2',padding:'1px 6px',borderRadius:4,fontWeight:600,color:'#dc2626'}}>Red</span> = $0 cost (missing purchase price — GP overstated). <span style={{background:'#fef9c3',padding:'1px 6px',borderRadius:4,fontWeight:600,color:'#92400e'}}>Yellow</span> = GP over 60% — verify before paying.</span>
            </div>
          </div>

          {/* PAYOUTS — draws & loans applied to this month's net commissions */}
          <div className="card" style={{marginTop:16}}>
            <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
              <h2>💰 Payouts — {monthLabel}{isMTD?' (MTD)':''}</h2>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:11,color:'#64748b'}}>Draw measures against GP — commission pays on GP over the draw, then loan withholding</span>
                <button className="btn btn-sm btn-primary" disabled={repComp===null||payoutRows.length===0||payoutRows.every(p=>p.paidRec)} title="Mark every remaining rep's payout as paid for this month" onClick={markAllPaid}>💵 Mark month paid</button>
              </div>
            </div>
            <div className="card-body" style={{padding:0}}>
              {repComp===null?<div style={{padding:30,textAlign:'center',color:'#94a3b8'}}>Loading draw & loan settings… (edits are disabled until they load)</div>:
              payoutRows.length===0?<div style={{padding:30,textAlign:'center',color:'#94a3b8'}}>No commission activity or draw/loan settings for {monthLabel}.</div>:
              <table style={{fontSize:12}}><thead><tr>
                <th>Rep</th><th style={{textAlign:'right'}}>Net Commission</th><th style={{textAlign:'right'}}>Monthly Draw (GP)</th><th style={{textAlign:'right'}}>Payable</th><th>Loan</th><th style={{textAlign:'right'}}>Payout</th><th style={{textAlign:'center'}}></th>
              </tr></thead><tbody>
                {payoutRows.map(p=>{const name=repName(p.b);
                  return<tr key={p.id} style={{background:p.paidRec?'#f0fdf4':p.hasComp?'#f8fafc':''}}>
                    <td style={{fontWeight:700}}>{name}</td>
                    <td style={{textAlign:'right'}}>{fmt(p.b.net)}</td>
                    <td style={{textAlign:'right',color:p.draw>0?'#92400e':'#94a3b8'}}>{p.draw>0?(p.underBy>0?<><span style={{fontWeight:700}}>−{fmt(p.underBy)}</span><div style={{fontSize:9,color:'#92400e'}}>under draw ({fmt(p.draw)} − {fmt(p.gp)} GP)</div></>:<><span>met</span><div style={{fontSize:9,color:'#166534'}}>GP {fmt(p.gp)} ≥ {fmt(p.draw)}</div></>):'—'}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{fmt(p.payable)}{p.draw>0&&p.excessGP>0&&<div style={{fontSize:9,color:'#94a3b8'}}>on {fmt(p.excessGP)} GP over draw</div>}</td>
                    <td>{p.loanBal>0||p.appliedAmt!=null?<div style={{fontSize:11}}>
                        <div style={{fontWeight:600,color:'#b45309'}}>bal {fmt(p.loanBal)}{p.withhold>0&&<span style={{color:'#dc2626',marginLeft:6,fontWeight:700}}>−{fmt(p.withhold)}{p.appliedAmt==null?' @'+p.pct+'%':''}</span>}</div>
                        {p.appliedAmt!=null?<div style={{fontSize:9,fontWeight:700,color:'#166534'}}>✓ applied to loan</div>
                        :<label style={{fontSize:10,color:'#64748b',display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}><input type="checkbox" checked={p.full} onChange={()=>toggleFullMonth(p)}/>pay full this month</label>}
                      </div>:'—'}</td>
                    <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:'#0f766e'}}>{fmt(p.payout)}
                      {p.paidRec&&<div style={{fontSize:9,fontWeight:700,color:'#166534'}}>✓ PAID {String(p.paidRec.at).substring(0,10)}</div>}
                      {p.paidRec&&Math.abs(safeNum(p.paidRec.amount)-p.payout)>0.005&&<div style={{fontSize:9,fontWeight:700,color:'#dc2626'}} title="The month's numbers changed after this was marked paid">⚠ paid {fmt(safeNum(p.paidRec.amount))}</div>}
                    </td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center',flexWrap:'wrap'}}>
                        <button className="btn btn-sm" style={{fontSize:9,background:'#f8fafc',border:'1px solid #cbd5e1',color:'#475569',padding:'2px 6px'}} title="Set this rep's monthly draw, loan balance, and loan withholding %" onClick={()=>{const s=(repComp||{})[p.id]||{};setCompEdit({id:p.id,draw:s.draw!=null?String(s.draw):'',loan:s.loanBalance!=null?String(s.loanBalance):'',pct:s.loanPct!=null?String(s.loanPct):'50'})}}>⚙ Draw/Loan</button>
                        {p.appliedAmt==null&&p.withhold>0&&<button className="btn btn-sm" style={{fontSize:9,background:'#fefce8',border:'1px solid #eab308',color:'#854d0e',padding:'2px 6px'}} title="Reduce the loan balance by this month's withholding and lock the month" onClick={()=>applyLoan(p)}>Apply to loan</button>}
                        {p.appliedAmt!=null&&<button className="btn btn-sm" style={{fontSize:9,background:'#f8fafc',border:'1px solid #cbd5e1',color:'#475569',padding:'2px 6px'}} title="Put this month's withholding back on the loan balance" onClick={()=>undoLoan(p)}>Undo loan</button>}
                        {!p.paidRec&&<button className="btn btn-sm" style={{fontSize:9,background:'#f0fdf4',border:'1px solid #86efac',color:'#166534',padding:'2px 6px',fontWeight:700}} title="Record this month's payout as paid to this rep" onClick={()=>markPaid(p)}>💵 Mark paid</button>}
                        {p.paidRec&&<button className="btn btn-sm" style={{fontSize:9,background:'#f8fafc',border:'1px solid #cbd5e1',color:'#475569',padding:'2px 6px'}} title="Remove the paid mark for this month" onClick={()=>unmarkPaid(p)}>Undo paid</button>}
                      </div>
                    </td>
                  </tr>})}
                <tr style={{fontWeight:800,background:'#f0fdfa',borderTop:'2px solid #0f766e'}}>
                  <td>TOTAL PAYOUT</td>
                  <td style={{textAlign:'right'}}>{fmt(Math.round(payoutRows.reduce((a,p)=>a+p.b.net,0)*100)/100)}</td>
                  <td style={{textAlign:'right',color:'#92400e'}}>{(()=>{const d=payoutRows.reduce((a,p)=>a+p.underBy,0);return d>0?'−'+fmt(Math.round(d*100)/100)+' under':'—'})()}</td>
                  <td style={{textAlign:'right'}}>{fmt(Math.round(payoutRows.reduce((a,p)=>a+p.payable,0)*100)/100)}</td>
                  <td style={{color:'#dc2626',fontSize:11}}>{(()=>{const w=payoutRows.reduce((a,p)=>a+p.withhold,0);return w>0?'−'+fmt(Math.round(w*100)/100)+' to loans':'—'})()}</td>
                  <td style={{textAlign:'right',fontSize:15,color:'#0f766e'}}>{fmt(Math.round(totPayout*100)/100)}</td>
                  <td/>
                </tr>
              </tbody></table>}
            </div>
            <div style={{padding:'10px 16px',borderTop:'1px solid #e2e8f0',fontSize:11,color:'#64748b'}}>
              <strong>Draw:</strong> the monthly draw measures against gross profit — a rep under their draw shows the shortfall (draw − GP) and pays $0; over it, commission pays on the GP beyond the draw at the rep's own blended rate (no negative carryover between months). <strong>Loan:</strong> the set % of after-draw commission is withheld until the balance reaches $0 — check <em>pay full this month</em> to skip a month. <strong>Apply to loan</strong> permanently reduces the balance and locks the month (Undo puts it back). Settings apply to the month you're viewing.
            </div>
          </div>

          {/* Draw & loan settings modal */}
          {compEdit&&(()=>{const r=REPS.find(x=>x.id===compEdit.id);
            const inp={width:'100%',marginBottom:10};
            return<div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setCompEdit(null)}>
              <div className="card" style={{width:380,maxWidth:'92vw'}} onClick={e=>e.stopPropagation()}>
                <div className="card-header"><h2>⚙ Draw & Loan — {r?.name||compEdit.id}</h2></div>
                <div className="card-body">
                  <label className="form-label">Monthly draw ($)</label>
                  <input type="number" min="0" step="0.01" className="form-input" style={inp} value={compEdit.draw} onChange={e=>setCompEdit(p=>({...p,draw:e.target.value}))} placeholder="0 = no draw"/>
                  <label className="form-label">Loan balance outstanding ($)</label>
                  <input type="number" min="0" step="0.01" className="form-input" style={inp} value={compEdit.loan} onChange={e=>setCompEdit(p=>({...p,loan:e.target.value}))} placeholder="0 = no loan"/>
                  <label className="form-label">Loan withholding (% of after-draw commission)</label>
                  <input type="number" min="0" max="100" step="1" className="form-input" style={inp} value={compEdit.pct} onChange={e=>setCompEdit(p=>({...p,pct:e.target.value}))}/>
                  <div style={{fontSize:11,color:'#64748b',marginBottom:12}}>Withholding stops automatically when the balance reaches $0. Months already applied to the loan are not recalculated when you change these settings.</div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                    <button className="btn btn-sm btn-secondary" onClick={()=>setCompEdit(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" disabled={repComp===null} onClick={()=>{
                      const draw=parseFloat(compEdit.draw)||0;const loan=parseFloat(compEdit.loan)||0;let pct=parseFloat(compEdit.pct);if(isNaN(pct)||pct<0||pct>100)pct=50;
                      if(draw<0||loan<0){alert('Amounts must be ≥ 0.');return}
                      updateComp(compEdit.id,{draw,loanBalance:Math.round(loan*100)/100,loanPct:pct});
                      setCompEdit(null);
                    }}>Save</button>
                  </div>
                </div>
              </div>
            </div>})()}

          {/* Job cost editor modal — every durable cost input on the SO in one place */}
          {costModal&&(()=>{
            const m=costModal;
            const inp={width:110,textAlign:'right'};
            const upd=fn=>setCostModal(p=>fn({...p}));
            return<div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setCostModal(null)}>
              <div className="card" style={{width:620,maxWidth:'94vw',maxHeight:'88vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
                <div className="card-header" style={{position:'sticky',top:0,background:'white',zIndex:1}}><h2>✎ Job Costs — {m.soId} <span style={{fontSize:11,fontWeight:400,color:'#64748b'}}>({m.invId})</span></h2></div>
                <div className="card-body" style={{fontSize:12}}>
                  {m.snapped&&<div style={{padding:'8px 10px',background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:6,fontSize:11,color:'#1e40af',marginBottom:12}}>🔒 This invoice's commission is frozen at payment. Cost edits here update the order and the live line detail, but the frozen commission only changes when you click <strong>Re-freeze</strong> afterwards.</div>}
                  <div style={{fontWeight:700,marginBottom:6,color:'#0f172a'}}>Items — unit purchase cost</div>
                  {m.items.length===0&&<div style={{color:'#94a3b8',marginBottom:10}}>No items on this order.</div>}
                  {m.items.map((d,xi)=><div key={d.ii} style={{padding:'8px 10px',background:'#f8fafc',borderRadius:6,marginBottom:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontWeight:600,flex:1,minWidth:200}}>{d.label}<span style={{marginLeft:6,fontSize:10,color:'#94a3b8'}}>qty {d.qty}</span></span>
                      <label style={{fontSize:10,color:'#64748b'}}>catalog cost $</label>
                      <input type="number" min="0" step="0.01" className="form-input" style={inp} value={d.nsaCost} onChange={e=>upd(p=>{p.items=p.items.map((x,j)=>j===xi?{...x,nsaCost:e.target.value}:x);return p})}/>
                    </div>
                    {d.hasSizeCosts&&<div style={{fontSize:10,color:'#92400e',marginTop:4}}>⚠ Live per-size vendor costs override the catalog cost per size this session.</div>}
                    {d.poLines.length>0&&<div style={{marginTop:6}}>
                      {d.poLines.map((pl,pj)=><div key={pl.pi} style={{display:'flex',alignItems:'center',gap:8,padding:'2px 0 2px 14px'}}>
                        <span style={{fontSize:11,color:'#475569',flex:1}}>↳ {pl.label}</span>
                        <label style={{fontSize:10,color:'#64748b'}}>PO unit cost $</label>
                        <input type="number" min="0" step="0.01" className="form-input" style={inp} placeholder="= catalog" value={pl.unitCost} onChange={e=>upd(p=>{p.items=p.items.map((x,j)=>j===xi?{...x,poLines:x.poLines.map((y,k)=>k===pj?{...y,unitCost:e.target.value}:y)}:x);return p})}/>
                      </div>)}
                      <div style={{fontSize:10,color:'#94a3b8',paddingLeft:14}}>PO unit cost wins for PO-covered quantity; blank falls back to the catalog cost.</div>
                    </div>}
                  </div>)}
                  {m.decoPos.length>0&&<>
                    <div style={{fontWeight:700,margin:'12px 0 6px',color:'#0f172a'}}>Outside deco POs</div>
                    {m.decoPos.map((dp,di2)=><div key={dp.di} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#f8fafc',borderRadius:6,marginBottom:6,flexWrap:'wrap'}}>
                      <span style={{fontWeight:600,flex:1,minWidth:200}}>{dp.label}<span style={{marginLeft:6,fontSize:10,color:'#94a3b8'}}>qty {dp.qty}</span></span>
                      {dp.billCost>0&&<span style={{fontSize:10,color:'#92400e'}}>billed ${dp.billCost.toLocaleString(undefined,{maximumFractionDigits:2})} — the applied supplier bill wins over unit cost</span>}
                      <label style={{fontSize:10,color:'#64748b'}}>unit cost $</label>
                      <input type="number" min="0" step="0.01" className="form-input" style={inp} value={dp.unitCost} onChange={e=>upd(p=>{p.decoPos=p.decoPos.map((x,j)=>j===di2?{...x,unitCost:e.target.value}:x);return p})}/>
                    </div>)}
                  </>}
                  <div style={{fontWeight:700,margin:'12px 0 6px',color:'#0f172a'}}>Order-level costs</div>
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#f8fafc',borderRadius:6,marginBottom:6}}>
                    <span style={{fontWeight:600,flex:1}}>Outbound shipping cost<div style={{fontSize:10,color:'#94a3b8',fontWeight:400}}>A later ShipStation / webstore sync can overwrite a manual value.</div></span>
                    <label style={{fontSize:10,color:'#64748b'}}>$</label>
                    <input type="number" min="0" step="0.01" className="form-input" style={inp} value={m.ship} onChange={e=>upd(p=>{p.ship=e.target.value;return p})}/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#f8fafc',borderRadius:6,marginBottom:12}}>
                    <span style={{fontWeight:600,flex:1}}>Inbound freight (supplier bills)<div style={{fontSize:10,color:'#94a3b8',fontWeight:400}}>Future supplier-bill imports ADD to this number rather than replacing it.</div></span>
                    <label style={{fontSize:10,color:'#64748b'}}>$</label>
                    <input type="number" min="0" step="0.01" className="form-input" style={inp} value={m.freight} onChange={e=>upd(p=>{p.freight=e.target.value;return p})}/>
                  </div>
                  <div style={{fontSize:10,color:'#94a3b8',marginBottom:12}}>Not editable here: per-size vendor costs (session-only, no saved column) and in-house decoration costs (priced from the global rate tables in Settings).</div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                    <button className="btn btn-sm btn-secondary" onClick={()=>setCostModal(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={saveCostModal}>Save costs</button>
                  </div>
                </div>
              </div>
            </div>})()}

          {/* Send-report modal: pick recipients + which reps to include */}
          {emailModal&&<div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>!emailSending&&setEmailModal(null)}>
            <div className="card" style={{width:440,maxWidth:'92vw',maxHeight:'85vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
              <div className="card-header"><h2>✉ Send Commission Report — {monthLabel}</h2></div>
              <div className="card-body">
                <label className="form-label">Send to (comma-separated)</label>
                <input type="text" className="form-input" style={{width:'100%',marginBottom:12}} value={emailModal.to} onChange={e=>setEmailModal(p=>({...p,to:e.target.value}))} placeholder="accounting@nationalsportsapparel.com"/>
                <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>Reps to include
                  <span style={{fontSize:10}}>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'1px 6px',marginRight:4}} onClick={()=>setEmailModal(p=>({...p,reps:Object.fromEntries(Object.keys(p.reps).map(k=>[k,true]))}))}>All</button>
                    <button className="btn btn-sm btn-secondary" style={{fontSize:9,padding:'1px 6px'}} onClick={()=>setEmailModal(p=>({...p,reps:Object.fromEntries(Object.keys(p.reps).map(k=>[k,false]))}))}>None</button>
                  </span>
                </label>
                <div style={{border:'1px solid #e2e8f0',borderRadius:6,padding:'6px 10px',marginBottom:12,maxHeight:200,overflow:'auto'}}>
                  {payoutRows.map(p=><label key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',fontSize:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={!!emailModal.reps[p.id]} onChange={()=>setEmailModal(prev=>({...prev,reps:{...prev.reps,[p.id]:!prev.reps[p.id]}}))}/>
                    <span style={{fontWeight:600}}>{repName(p.b)}</span>
                    <span style={{marginLeft:'auto',color:'#64748b',fontSize:11}}>{repComp!==null?'payout '+fmt(p.payout):fmt(p.b.net)}</span>
                  </label>)}
                </div>
                <div style={{fontSize:11,color:'#64748b',marginBottom:12}}>The email carries a per-rep summary (net commission, draw, loan, payout) for the checked reps only; the attached CSV has their invoice-level detail plus the payout sheet.</div>
                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button className="btn btn-sm btn-secondary" disabled={emailSending} onClick={()=>setEmailModal(null)}>Cancel</button>
                  <button className="btn btn-sm btn-primary" disabled={emailSending} onClick={sendReport}>{emailSending?'Sending…':'Send Report'}</button>
                </div>
              </div>
            </div>
          </div>}
        </>;
      })()}

      {/* Commission policy note */}
      <div style={{marginTop:16,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',fontSize:11,color:'#64748b'}}>
        <strong>Commission Policy:</strong> 30% of gross profit on invoices paid within 90 days of invoice date. 15% on invoices paid after 90 days (50% penalty). Admin may click to restore full 30% on any late invoice or set a custom rate per invoice via <em>Edit %</em>. Gross profit = Revenue &minus; Product Cost &minus; Decoration Cost &minus; Outbound Shipping (ShipStation, default $0) &minus; Inbound Freight (Supplier Bills, manual override until integration live). <strong>Promo orders:</strong> Costs from promo orders (product, decoration, shipping) are deducted from monthly commission as they represent real costs with no customer revenue.
      </div>
    </>);
  }
