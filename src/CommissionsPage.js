// Commissions page — lifted verbatim out of App() (was `function rCommissions()`)
// as step 3 of the App.js decomposition. All shared state comes from useAppData();
// this component holds no state of its own, so mount/unmount on page switch is
// behavior-identical to the old closure call.
import { useAppData } from './AppContext';
import { calcSOStatus } from './components';
import { commissionRepId } from './businessLogic';
import { decoSplitQty, linkedArtCostQty } from './pricing';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { dP, rQ, parseDate, _decoUnitCostComb } from './App';

export default function CommissionsPage(){
  const {REPS,commMonth,commOverrides,commRep,commTab,cu,cust,invs,setCommMonth,setCommOverrides,setCommRep,setCommTab,setESO,setESOC,setESOTab,setPg,sos}=useAppData();

    const isAdmin=cu.role==='admin'||cu.role==='super_admin';
    const salesReps=REPS.filter(r=>r.role==='rep'||r.role==='admin');
    // Admin sees all reps or picks one; rep only sees themselves
    const viewRepId=isAdmin?commRep:cu.id;

    // Gross profit calculator for an invoice
    // GP = Invoice Revenue − Garment Cost − Deco Cost − Outbound Shipping (ShipStation) − Inbound Freight (Supplier Bills)
    const calcGP=(inv)=>{
      // Commission revenue excludes CC surcharges: recordPayment folds card fees into inv.total
      // (tracked in inv.cc_fee), and reps must not earn GP on a processing-fee pass-through.
      const invRev=Math.max(0,safeNum(inv.total)-safeNum(inv.cc_fee||0));
      const so=sos.find(s=>s.id===inv.so_id);
      if(!so)return{rev:invRev,cost:0,gp:invRev,shipRev:0,shipCost:0,inboundFreight:0};
      const _aq={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_aq[d.art_file_id]=(_aq[d.art_file_id]||0)+(decoSplitQty(d)!=null?decoSplitQty(d):q2)*(d.reversible?2:1)}})});
      // Combined deco cost when the SO's jobs are manually linked to a shared screen on other SOs.
      const _comb=linkedArtCostQty(so,_aq,sos);
      const af=safeArt(so);let rev=0,cost=0;
      // Garment rev/cost must match the SO detail page and Reports pipeline (rReports.soCalc):
      // per-size sells/costs for 2XL+ upcharges, and actual PO unit_cost over catalog nsa_cost.
      // Commission pays on this GP, so a flat unit_sell/nsa_cost walk paid reps on a wrong number.
      const _poMeta=new Set(['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship','batch_queue_id','batch_po_number','preexisting','email_history','shipping']);
      safeItems(so).forEach(it=>{const sq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sq>0?sq:safeNum(it.est_qty);if(!qty)return;
        if(it._sizeSells&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)rev+=n*(it._sizeSells[sz]||safeNum(it.unit_sell))})}else{rev+=qty*safeNum(it.unit_sell)}
        let poQty=0,poCost=0;(Array.isArray(it.po_lines)?it.po_lines:[]).forEach(pl=>{if(!pl)return;const u=pl.unit_cost!=null?safeNum(pl.unit_cost):safeNum(it.nsa_cost);Object.entries(pl).forEach(([k,v])=>{if(k.startsWith('_')||_poMeta.has(k))return;if(typeof v!=='number'||v<=0)return;poQty+=v;poCost+=v*u})});
        if(poQty>0){cost+=poCost;const uncov=Math.max(0,qty-poQty);if(uncov>0){if(it._sizeCosts&&sq>0){const tot=Object.entries(safeSizes(it)).reduce((a,[sz,v])=>{const n=safeNum(v);return n>0?a+n*(it._sizeCosts[sz]||safeNum(it.nsa_cost)):a},0);const avg=sq>0?tot/sq:safeNum(it.nsa_cost);cost+=uncov*avg}else{cost+=uncov*safeNum(it.nsa_cost)}}}
        else if(it._sizeCosts&&sq>0){const sizes=safeSizes(it);Object.entries(sizes).forEach(([sz,v])=>{const n=safeNum(v);if(n>0)cost+=n*(it._sizeCosts[sz]||safeNum(it.nsa_cost))})}
        else{cost+=qty*safeNum(it.nsa_cost)}
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);const eq=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);rev+=eq*dp2.sell;cost+=eq*_decoUnitCostComb(d,qty,af,cq,_comb)});
      });
      // Outside deco POs — SO-level cost bucket
      (so.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=safeNum(dp.qty||0)*safeNum(dp.unit_cost||0)});
      // Shipping revenue (charged to customer)
      const shipRev=so.shipping_type==='pct'?rev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
      // Outbound shipping cost from ShipStation — fallback to shipment records
      const shipCost=safeNum(so._shipping_cost||so._shipstation_cost||0)||(so._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
      // Inbound freight from supplier bills tied to SO (manual override field)
      const inboundFreight=safeNum(so._inbound_freight||0);
      // Club fundraising passthrough (webstore SOs) — money owed to the team, not rep margin.
      const fundraiseCost=safeNum(so._webstore_fundraise||0);
      const totalRev=rev+shipRev;const totalCost=cost+shipCost+inboundFreight+fundraiseCost;
      // Scale to invoice proportion (invoice may be partial payment of SO)
      const soTotal=totalRev||1;const scale=invRev/soTotal;
      return{rev:invRev,cost:Math.round(totalCost*scale*100)/100,gp:Math.round((invRev-totalCost*scale)*100)/100,shipRev:Math.round(shipRev*scale*100)/100,shipCost:Math.round(shipCost*scale*100)/100,inboundFreight:Math.round(inboundFreight*scale*100)/100};
    };

    // Build commission line items from paid invoices
    // Commission: 30% of GP if paid within 90 days, 15% if paid after 90 days
    const buildCommLines=(repFilter)=>{
      return invs.filter(inv=>{
        if(inv.status!=='paid'&&inv.status!=='partial')return false;
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
        const paidDate=inv.payments?.length>0?parseDate(inv.payments[inv.payments.length-1].date):(inv.updated_at?parseDate(inv.updated_at):invDate);
        const daysToPay=paidDate&&invDate?Math.round((paidDate-invDate)/(1000*60*60*24)):null;
        const isLate=daysToPay!==null&&daysToPay>90;
        // Override shape: legacy `true` = restore to 30% on a late invoice; number = explicit per-invoice rate (decimal, e.g. 0.25 for 25%).
        const ovr=commOverrides[inv.id];
        const overridden=ovr!==undefined&&ovr!==false&&ovr!==null;
        const customRate=typeof ovr==='number'?ovr:null;
        const commRate=customRate!=null?customRate:(isLate&&!overridden?0.15:0.30);
        const commAmt=Math.round(gp.gp*commRate*100)/100;
        const paidAmt=inv.payments?.reduce((a,p)=>a+safeNum(p.amount),0)||0;
        const invMonth=inv.date?inv.date.substring(0,2)+'/'+inv.date.substring(6,8):'';// MM/YY
        const paidMonth=paidDate?(paidDate.getMonth()+1)+'/'+paidDate.getFullYear():'';
        return{inv,so,customer:c,rep,gp,daysToPay,isLate,overridden,commRate,commAmt,paidAmt,paidDate,invMonth,paidMonth,linked:_combLinked,repId:commissionRepId(c,so)};
      });
    };

    // Build pipeline from open/unpaid invoices + uninvoiced open SOs
    const buildPipeline=(repFilter)=>{
      // Open invoices only. Exclude 'partial' as well as 'paid': buildCommLines already
      // credits a partial invoice's FULL gp as EARNED (calcGP uses inv.total, not the paid
      // amount), so also counting it here as pipeline double-counts the same commission —
      // a rep saw ~2x in the combined (earned + pipeline) total. A partial is booked as
      // earned; it has no remaining pipeline.
      const invLines=invs.filter(inv=>{
        if(inv.status==='paid'||inv.status==='partial')return false;
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
        const expRate=willBeLate?0.15:0.30;
        const expComm=Math.round(gp.gp*expRate*100)/100;
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
        safeItems(so).forEach(it=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          rev+=qty*safeNum(it.unit_sell);cost+=qty*safeNum(it.nsa_cost);
          safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,af,cq);rev+=qty*dp2.sell;cost+=qty*_decoUnitCostComb(d,qty,af,cq,_comb)});
        });
        (so.deco_pos||[]).forEach(dp=>{const bc=safeNum(dp._bill_cost);if(bc>0){cost+=bc;return}cost+=safeNum(dp.qty||0)*safeNum(dp.unit_cost||0)});
        const shipRev=so.shipping_type==='pct'?rev*(safeNum(so.shipping_value)/100):safeNum(so.shipping_value);
        const shipCost=safeNum(so._shipping_cost||so._shipstation_cost||0)||(so._shipments||[]).reduce((a,s)=>a+safeNum(s.shipping_cost||0),0);
        const inboundFreight=safeNum(so._inbound_freight||0);
        const fundraiseCost=safeNum(so._webstore_fundraise||0);// club fundraising passthrough, not rep margin
        const totalRev=rev+shipRev;const totalCost=cost+shipCost+inboundFreight+fundraiseCost;
        const gp={rev:totalRev,cost:totalCost,gp:Math.round((totalRev-totalCost)*100)/100};
        const soStatus=calcSOStatus(so);
        const expRate=0.30;// assume on-time since not yet invoiced
        const expComm=Math.round(gp.gp*expRate*100)/100;
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
        safeItems(so).forEach(it=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);if(!qty)return;
          if(it.is_promo){
            productCost+=qty*safeNum(it.nsa_cost);
            const sellP=safeNum(it.retail_price)||safeNum(it.nsa_cost)*2;promoRev+=qty*sellP;
            safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;const dp2=dP(d,qty,soAf,cq);decoCost+=qty*_decoUnitCostComb(d,qty,soAf,cq,_comb);promoRev+=qty*rQ(dp2.sell*1.25)});
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
          {[['statement','Statement'],['pipeline','Pipeline'],['promo','Promo'],['ytd','YTD'],['byCustomer','By Customer'],...(isAdmin?[['monthly','📤 Monthly Reports']]:[])].map(([id,label])=>
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
              <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:'#166534'}}>${l.commAmt.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
              {isAdmin&&<td style={{textAlign:'center'}}>
                <div style={{display:'flex',gap:4,justifyContent:'center',alignItems:'center',flexWrap:'wrap'}}>
                  {l.isLate&&!l.overridden&&<button className="btn btn-sm" style={{fontSize:9,background:'#fef3c7',border:'1px solid #f59e0b',color:'#92400e',padding:'2px 6px'}} title="Approve full 30% commission" onClick={()=>setCommOverrides(p=>({...p,[l.inv.id]:true}))}>Full 30%</button>}
                  <button className="btn btn-sm" style={{fontSize:9,background:'#eff6ff',border:'1px solid #93c5fd',color:'#1e40af',padding:'2px 6px'}} title="Set a custom commission % for this invoice" onClick={()=>{
                    const cur=Math.round(l.commRate*100);
                    const v=window.prompt(`Set commission % for ${l.inv.id}\n(default: ${l.isLate?'15% late / 30% on-time':'30%'})`,String(cur));
                    if(v===null)return;
                    const t=v.trim();
                    if(t===''){setCommOverrides(p=>{const n={...p};delete n[l.inv.id];return n});return}
                    const n=parseFloat(t);
                    if(!isNaN(n)&&n>=0&&n<=100)setCommOverrides(p=>({...p,[l.inv.id]:n/100}));
                    else alert('Enter a number 0–100, or leave blank to clear the override.');
                  }}>Edit %</button>
                  {l.overridden&&<span style={{fontSize:9,color:'#166534',fontWeight:700}}>{typeof commOverrides[l.inv.id]==='number'?'Custom':'Approved'}</span>}
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
              {salesReps.filter(r=>r.role==='rep'||r.role==='admin').map(r=>{
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
        const reportableReps=salesReps.filter(r=>r.role==='rep'||r.role==='admin');
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

      {/* Commission policy note */}
      <div style={{marginTop:16,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',fontSize:11,color:'#64748b'}}>
        <strong>Commission Policy:</strong> 30% of gross profit on invoices paid within 90 days of invoice date. 15% on invoices paid after 90 days (50% penalty). Admin may click to restore full 30% on any late invoice or set a custom rate per invoice via <em>Edit %</em>. Gross profit = Revenue &minus; Product Cost &minus; Decoration Cost &minus; Outbound Shipping (ShipStation, default $0) &minus; Inbound Freight (Supplier Bills, manual override until integration live). <strong>Promo orders:</strong> Costs from promo orders (product, decoration, shipping) are deducted from monthly commission as they represent real costs with no customer revenue.
      </div>
    </>);
  }
