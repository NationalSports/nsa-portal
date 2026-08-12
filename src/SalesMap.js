import React,{useMemo,useState,useRef,useCallback} from 'react';
import {geoAlbersUsa,geoPath} from 'd3-geo';
import {feature,mesh} from 'topojson-client';
import statesTopo from 'us-atlas/states-10m.json';
import ZIPS from './data/zipLatLng.json';

/* ─── Sales Map — where sales are going ───
   Dark-navy vector US map (d3-geo AlbersUSA, no tile service / API keys).
   Each school = a glowing bubble sized by total sales (sqrt scale). Shipping
   routes are animated arcs colored by origin:
     blue  #5B8DEF  ships from the NSA building
     green #2AA07C  via an outside decorator
     amber #C07C1E  drop-shipped direct from the vendor
   (Palette validated for CVD + contrast on the #0F1A38 surface.)
   Customer positions come from zip centroids (Census 2020 ZCTA gazetteer,
   bundled — src/data/zipLatLng.json), so no geocoding calls at runtime. */

const ROUTE_META={
  nsa:{label:'Ships from NSA',color:'#5B8DEF'},
  deco:{label:'Via decorator',color:'#2AA07C'},
  vendor:{label:'Drop-ship from vendor',color:'#C07C1E'},
};
const SURFACE='#0F1A38';
const STATE_BY_FIPS={'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};
const MONEY=(n)=>'$'+Math.round(n).toLocaleString();
const _fmtK=(n)=>Math.abs(n)>=1e6?'$'+(n/1e6).toFixed(1)+'m':Math.abs(n)>=1e3?'$'+(n/1e3).toFixed(n>=1e4?0:1)+'k':MONEY(n);

const _pd=(d)=>{if(!d)return null;const m=String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(m){let y=+m[3];if(y<100)y+=2000;return new Date(y,+m[1]-1,+m[2])}const iso=String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);if(iso)return new Date(+iso[1],+iso[2]-1,+iso[3]);const dt=new Date(d);return isNaN(dt)?null:dt};
const _zip5=(z)=>{const m=String(z||'').match(/\d{5}/);return m?m[0]:null};

// Route of a sales order (mirrors the Order Editor's ships-direct logic):
// fully drop-shipped product POs → vendor; any outside-deco PO → decorator; else NSA.
const soRoute=(so)=>{
  const lines=(so.items||[]).flatMap(it=>(it.po_lines||[])).filter(Boolean);
  const prodLines=lines.filter(l=>l.po_type!=='outside_deco');
  const dropLines=prodLines.filter(l=>l.drop_ship===true);
  const anyInHouse=prodLines.some(l=>l.drop_ship!==true);
  const decoPos=(so.deco_pos||[]).filter(Boolean);
  if(dropLines.length>0&&!anyInHouse)return{route:'vendor',vendorName:dropLines[0].vendor||dropLines[0].deco_vendor||null};
  if(decoPos.length>0)return{route:'deco',vendorName:decoPos[0].vendor||null};
  return{route:'nsa',vendorName:null};
};

export default function SalesMap({customers=[],orders=[],invoices=[],historicalInvoices=[],vendors=[],reps=[],calcMargin,companyInfo,onOpenCustomer,currentUser}){
  const [range,setRange]=useState('12mo');
  const [routesOn,setRoutesOn]=useState({nsa:true,deco:true,vendor:true});
  const [repF,setRepF]=useState('all');
  const [q,setQ]=useState('');
  const [view,setView]=useState('map');
  const [tip,setTip]=useState(null);// {x,y,c:aggregated customer}
  const WEST_VIEW={k:2.1,x:487.5-185*2.1,y:305-300*2.1};// frame CA + the West — where nearly all customers are
  const US_VIEW={k:1,x:0,y:0};
  const [zoom,setZoom]=useState(WEST_VIEW);
  const dragRef=useRef(null);
  const svgRef=useRef(null);

  const {statesFeat,borders}=useMemo(()=>({
    statesFeat:feature(statesTopo,statesTopo.objects.states),
    borders:mesh(statesTopo,statesTopo.objects.states,(a,b)=>a!==b),
  }),[]);
  const projection=useMemo(()=>geoAlbersUsa().scale(1300).translate([487.5,305]),[]);
  const path=useMemo(()=>geoPath(projection),[projection]);

  const custById=useMemo(()=>new Map(customers.map(c=>[c.id,c])),[customers]);
  const vendorZip=useCallback((name)=>{
    if(!name)return null;
    const n=String(name).toLowerCase();
    const v=vendors.find(x=>String(x.name||'').toLowerCase()===n)||vendors.find(x=>String(x.name||'').toLowerCase().includes(n)||n.includes(String(x.name||'').toLowerCase()));
    return v?_zip5(v.zip):null;
  },[vendors]);
  const nsaZip=_zip5(companyInfo?.zip)||'92865';

  // Position for a customer: shipping zip → billing zip → parent's zips.
  const custPoint=useCallback((c)=>{
    let cur=c,hops=0;
    while(cur&&hops<3){
      const z=_zip5(cur.shipping_zip)||_zip5(cur.billing_zip);
      if(z&&ZIPS[z]){const p=projection([ZIPS[z][1],ZIPS[z][0]]);if(p)return{p,zip:z,geo:cur}}
      cur=cur.parent_id?custById.get(cur.parent_id):null;hops++;
    }
    return null;
  },[projection,custById]);

  const rangeStart=useMemo(()=>{
    const now=new Date();
    if(range==='month')return new Date(now.getFullYear(),now.getMonth(),1);
    if(range==='ytd')return new Date(now.getFullYear(),0,1);
    if(range==='12mo')return new Date(now.getFullYear(),now.getMonth()-11,1);
    return null;
  },[range]);

  // Aggregate per customer. Dollars = BILLED revenue — portal invoices + NetSuite history
  // (customer_invoices), deduped on document id exactly like the dashboard Sales box, so the
  // map's totals tie out to Billed. Ship routes/arcs come from portal sales orders (the only
  // era that has PO routing data — the portal cut over in Apr 2026).
  const data=useMemo(()=>{
    const byCust=new Map();
    const arcs=new Map();
    let unmappedRev=0,unmappedCount=0;
    const _custFor=(id)=>custById.get(id);
    const _repOk=(c)=>repF==='all'||(c.primary_rep_id||custById.get(c.parent_id)?.primary_rep_id)===repF;
    const _aggFor=(c,pt)=>{
      const key=c.parent_id&&!(_zip5(c.shipping_zip)||_zip5(c.billing_zip))?c.parent_id:c.id;
      let agg=byCust.get(key);
      if(!agg){agg={c:custById.get(key)||c,pt,total:0,invoices:0,orders:0,routes:{nsa:0,deco:0,vendor:0},routeRev:{nsa:0,deco:0,vendor:0}};byCust.set(key,agg)}
      return agg;
    };
    // 1) Billed dollars (bubble + heat totals)
    const histIds=new Set((historicalInvoices||[]).map(hi=>hi&&hi.id));
    const billedRows=[...(historicalInvoices||[]).filter(hi=>hi&&hi.status!=='void'),
      ...(invoices||[]).filter(iv=>iv&&iv.status!=='void'&&!iv.deleted_at&&!histIds.has(iv.id))];
    billedRows.forEach(row=>{
      const dt=_pd(row.date);
      if(rangeStart&&(!dt||dt<rangeStart))return;
      const rev=Number(row.total)||0;
      if(rev<=0)return;
      const c=_custFor(row.customer_id);
      if(!c||!_repOk(c))return;
      const pt=custPoint(c);
      if(!pt){unmappedRev+=rev;unmappedCount++;return}
      const agg=_aggFor(c,pt);
      agg.total+=rev;agg.invoices++;
    });
    // 2) Ship routes + flow arcs from portal SOs
    orders.forEach(so=>{
      if(!so||so.status==='cancelled'||so.status==='deleted'||so.deleted_at)return;
      const dt=_pd(so.created_at);
      if(rangeStart&&(!dt||dt<rangeStart))return;
      const c=_custFor(so.customer_id);
      if(!c||!_repOk(c))return;
      let rev=0;try{rev=Number(calcMargin?.(so,orders)?.rev)||0}catch{rev=0}
      if(rev<=0)return;
      const {route,vendorName}=soRoute(so);
      const pt=custPoint(c);
      if(!pt)return;
      const agg=_aggFor(c,pt);
      agg.orders++;agg.routes[route]++;agg.routeRev[route]+=rev;
      const originZip=route==='nsa'?nsaZip:route==='vendor'?(vendorZip(vendorName)||null):(vendorZip(vendorName)||nsaZip);
      if(originZip&&ZIPS[originZip]){
        const op=projection([ZIPS[originZip][1],ZIPS[originZip][0]]);
        if(op){
          const ak=originZip+'>'+pt.zip+'>'+route;
          const a=arcs.get(ak)||{from:op,to:pt.p,route,rev:0,n:0};
          a.rev+=rev;a.n++;arcs.set(ak,a);
        }
      }
    });
    byCust.forEach((agg,key)=>{if(agg.total<=0)byCust.delete(key)});
    const custs=[...byCust.values()].sort((a,b)=>b.total-a.total);
    const byState={};
    custs.forEach(a=>{const st=String(a.pt.geo.shipping_state||a.pt.geo.billing_state||'').trim().toUpperCase();if(st)byState[st]=(byState[st]||0)+a.total});
    const flows=[...arcs.values()].sort((a,b)=>b.rev-a.rev).slice(0,300);
    const maxTotal=Math.max(1,...custs.map(x=>x.total));
    const maxFlow=Math.max(1,...flows.map(f=>f.rev));
    return {custs,flows,maxTotal,maxFlow,unmappedRev,unmappedCount,byState};
  },[orders,invoices,historicalInvoices,custById,rangeStart,repF,calcMargin,custPoint,vendorZip,nsaZip,projection]);

  const visCusts=useMemo(()=>{
    const needle=q.trim().toLowerCase();
    return data.custs.filter(a=>{
      if(needle&&!String(a.c.name||'').toLowerCase().includes(needle))return false;
      // Route chips filter customers with known routes; pre-portal customers (no
      // route data) stay visible unless every route is toggled off.
      const hasRouteData=a.orders>0;
      if(!hasRouteData)return routesOn.nsa||routesOn.deco||routesOn.vendor;
      return ['nsa','deco','vendor'].some(r=>routesOn[r]&&a.routeRev[r]>0);
    });
  },[data.custs,q,routesOn]);
  const visKeys=useMemo(()=>new Set(visCusts.map(a=>a.c.id)),[visCusts]);
  const visFlows=useMemo(()=>data.flows.filter(f=>routesOn[f.route]),[data.flows,routesOn]);
  const mappedTotal=visCusts.reduce((s,a)=>s+a.total,0);

  const rScale=useCallback((v)=>2+15*Math.sqrt(v/data.maxTotal),[data.maxTotal]);

  // Wheel zoom (cursor-centered) + drag pan.
  const onWheel=useCallback((e)=>{
    e.preventDefault();
    const svg=svgRef.current;if(!svg)return;
    const r=svg.getBoundingClientRect();
    const mx=(e.clientX-r.left)*(975/r.width),my=(e.clientY-r.top)*(610/r.height);
    setZoom(z=>{
      const nk=Math.max(1,Math.min(10,z.k*(e.deltaY<0?1.25:0.8)));
      if(nk===z.k)return z;
      return{k:nk,x:mx-(mx-z.x)*(nk/z.k),y:my-(my-z.y)*(nk/z.k)};
    });
  },[]);
  const onDown=useCallback((e)=>{dragRef.current={sx:e.clientX,sy:e.clientY,zx:zoom.x,zy:zoom.y,moved:false}},[zoom]);
  const onMove=useCallback((e)=>{
    const d=dragRef.current;if(!d)return;
    const svg=svgRef.current;const r=svg.getBoundingClientRect();
    const dx=(e.clientX-d.sx)*(975/r.width),dy=(e.clientY-d.sy)*(610/r.height);
    if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;
    setZoom(z=>({...z,x:d.zx+dx,y:d.zy+dy}));
  },[]);
  const onUp=useCallback(()=>{setTimeout(()=>{dragRef.current=null},0)},[]);

  const arcPath=(f)=>{
    const [x1,y1]=f.from,[x2,y2]=f.to;
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy)||1;
    const mx=(x1+x2)/2-dy/dist*dist*0.22,my=(y1+y2)/2+dx/dist*dist*0.22;
    return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  };

  const stateTotals=data.byState||{};
  const maxState=Math.max(0,...Object.values(stateTotals));
  const k=zoom.k;
  const isAdmin=['admin','gm','super_admin'].includes(currentUser?.role);

  const chip=(id)=>{
    const on=routesOn[id];const m=ROUTE_META[id];
    return<button key={id} onClick={()=>setRoutesOn(r=>({...r,[id]:!r[id]}))} style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:12,fontWeight:600,padding:'6px 12px',borderRadius:999,cursor:'pointer',border:'1px solid '+(on?'rgba(255,255,255,.25)':'rgba(255,255,255,.12)'),background:on?'rgba(255,255,255,.10)':'transparent',color:on?'#E7ECF7':'#93A1C0'}}>
      <span style={{width:10,height:10,borderRadius:99,background:m.color,opacity:on?1:.35}}/>{m.label}
    </button>;
  };

  return<div style={{background:SURFACE,borderRadius:16,overflow:'hidden',border:'1px solid #1E2C55',position:'relative',color:'#E7ECF7'}}>
    <style>{`
      @keyframes smFlow{to{stroke-dashoffset:-32}}
      .sm-arc{stroke-dasharray:5 11;animation:smFlow 1.6s linear infinite;fill:none;stroke-linecap:round}
      .sm-bub{transition:opacity .15s}
      .sm-bub:hover{opacity:1 !important}
    `}</style>
    {/* Filters row */}
    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',padding:'14px 16px',borderBottom:'1px solid #1E2C55'}}>
      <span style={{fontSize:15,fontWeight:800,letterSpacing:.3,marginRight:4}}>🗺️ Sales Map</span>
      <select value={range} onChange={e=>setRange(e.target.value)} style={{background:'#16234A',color:'#E7ECF7',border:'1px solid #2A3A6B',borderRadius:8,padding:'6px 10px',fontSize:12,fontWeight:600}}>
        <option value="month">This month</option><option value="ytd">Year to date</option><option value="12mo">Last 12 months</option><option value="all">All time</option>
      </select>
      {isAdmin&&<select value={repF} onChange={e=>setRepF(e.target.value)} style={{background:'#16234A',color:'#E7ECF7',border:'1px solid #2A3A6B',borderRadius:8,padding:'6px 10px',fontSize:12,fontWeight:600}}>
        <option value="all">All reps</option>
        {reps.filter(r=>r.role==='rep'||r.role==='admin').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
      </select>}
      {['nsa','deco','vendor'].map(chip)}
      <input placeholder="Find a school…" value={q} onChange={e=>setQ(e.target.value)} style={{background:'#16234A',color:'#E7ECF7',border:'1px solid #2A3A6B',borderRadius:8,padding:'6px 10px',fontSize:12,minWidth:150}}/>
      <div style={{display:'flex',gap:2,background:'#16234A',borderRadius:8,padding:2,border:'1px solid #2A3A6B'}}>
        <button onClick={()=>setZoom(WEST_VIEW)} style={{fontSize:12,fontWeight:700,padding:'5px 12px',borderRadius:6,border:'none',cursor:'pointer',background:'transparent',color:'#93A1C0'}}>West</button>
        <button onClick={()=>setZoom(US_VIEW)} style={{fontSize:12,fontWeight:700,padding:'5px 12px',borderRadius:6,border:'none',cursor:'pointer',background:'transparent',color:'#93A1C0'}}>Whole US</button>
      </div>
      <div style={{marginLeft:'auto',display:'flex',gap:2,background:'#16234A',borderRadius:8,padding:2,border:'1px solid #2A3A6B'}}>
        {['map','list'].map(v=><button key={v} onClick={()=>setView(v)} style={{fontSize:12,fontWeight:700,padding:'5px 14px',borderRadius:6,border:'none',cursor:'pointer',background:view===v?'#5B8DEF':'transparent',color:view===v?'#fff':'#93A1C0'}}>{v==='map'?'Map':'List'}</button>)}
      </div>
    </div>

    {view==='map'&&<div style={{position:'relative'}}>
      <svg ref={svgRef} viewBox="0 0 975 610" style={{width:'100%',height:'auto',display:'block',cursor:dragRef.current?'grabbing':'grab',touchAction:'none'}}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={()=>{onUp();setTip(null)}} onDoubleClick={()=>setZoom(WEST_VIEW)}>
        <defs>
          <radialGradient id="smGlow"><stop offset="0%" stopColor="#FFC24D" stopOpacity="0.5"/><stop offset="55%" stopColor="#FFB347" stopOpacity="0.16"/><stop offset="100%" stopColor="#FFA53D" stopOpacity="0"/></radialGradient>
        </defs>
        <g transform={`translate(${zoom.x},${zoom.y}) scale(${k})`}>
          {statesFeat.features.map(f=>{
            const st=STATE_BY_FIPS[f.id];
            const v=st?(stateTotals[st]||0):0;
            const t=maxState>0?Math.sqrt(v/maxState):0;
            // #16234A → #3A5FB8, sqrt-eased single-hue ramp
            const mix=(a,b)=>Math.round(a+(b-a)*t);
            const fill=v>0?`rgb(${mix(22,58)},${mix(35,95)},${mix(74,184)})`:'#16234A';
            return<path key={f.id} d={path(f)} fill={fill} stroke="none">{st&&v>0&&<title>{st+': '+MONEY(v)}</title>}</path>;
          })}
          <path d={path(borders)} fill="none" stroke="#24335C" strokeWidth={0.8/k}/>
          <path d={path({type:'FeatureCollection',features:statesFeat.features})} fill="none" stroke="#2A3A6B" strokeWidth={0.6/k}/>
          {/* Flow arcs */}
          {visFlows.map((f,i)=>{
            const toKey=f.route;const w=(0.6+2.8*Math.sqrt(f.rev/data.maxFlow))/k;
            return<path key={i} className="sm-arc" d={arcPath(f)} stroke={ROUTE_META[toKey].color} strokeWidth={w} opacity={0.75}/>;
          })}
          {/* Origin markers: NSA HQ */}
          {ZIPS[nsaZip]&&(()=>{const p=projection([ZIPS[nsaZip][1],ZIPS[nsaZip][0]]);return p&&<g transform={`translate(${p[0]},${p[1]})`}>
            <rect x={-5/k} y={-5/k} width={10/k} height={10/k} rx={2/k} fill="#5B8DEF" stroke="#fff" strokeWidth={1/k}/>
            <text y={-8/k} textAnchor="middle" fontSize={9/k} fill="#B9C7EA" fontWeight="700">NSA</text>
          </g>})()}
          {/* Customer bubbles */}
          {visCusts.map(a=>{
            const [x,y]=a.pt.p;const r=rScale(a.total)/Math.sqrt(k);
            return<g key={a.c.id} className="sm-bub" style={{opacity:tip&&tip.c!==a?0.75:1,cursor:'pointer'}}
              onPointerEnter={e=>{const sr=svgRef.current.getBoundingClientRect();setTip({x:e.clientX-sr.left,y:e.clientY-sr.top,c:a})}}
              onPointerMove={e=>{const sr=svgRef.current.getBoundingClientRect();setTip(t=>t&&{...t,x:e.clientX-sr.left,y:e.clientY-sr.top})}}
              onPointerLeave={()=>setTip(null)}
              onClick={()=>{if(!dragRef.current?.moved)onOpenCustomer?.(a.c)}}>
              <circle cx={x} cy={y} r={r*1.9} fill="url(#smGlow)" style={{mixBlendMode:'screen'}}/>
              <circle cx={x} cy={y} r={r} fill="rgba(255,194,77,0.30)" stroke="#FFD9A0" strokeWidth={0.9/k} style={{mixBlendMode:'screen'}}/>
            </g>;
          })}
        </g>
      </svg>
      {/* Tooltip */}
      {tip&&(()=>{const a=tip.c;const m=a.routes;return<div style={{position:'absolute',left:Math.min(tip.x+14,740),top:Math.max(tip.y-10,8),background:'#101D42',border:'1px solid #2A3A6B',borderRadius:10,padding:'10px 13px',pointerEvents:'none',boxShadow:'0 8px 28px rgba(0,0,0,.45)',minWidth:200,zIndex:5}}>
        <div style={{fontSize:13,fontWeight:800}}>{a.c.name}</div>
        <div style={{fontSize:11,color:'#93A1C0',marginBottom:6}}>{[a.pt.geo.shipping_city||a.pt.geo.billing_city,a.pt.geo.shipping_state||a.pt.geo.billing_state].filter(Boolean).join(', ')}</div>
        <div style={{fontSize:17,fontWeight:800,letterSpacing:-.3}}>{MONEY(a.total)}<span style={{fontSize:11,fontWeight:600,color:'#93A1C0',marginLeft:6}}>{a.invoices} invoice{a.invoices!==1?'s':''} billed</span></div>
        <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:7}}>
          {['nsa','deco','vendor'].filter(r=>m[r]>0).map(r=><div key={r} style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#C9D4EE'}}>
            <span style={{width:8,height:8,borderRadius:99,background:ROUTE_META[r].color}}/>{ROUTE_META[r].label}
            <b style={{marginLeft:'auto'}}>{_fmtK(a.routeRev[r])}</b><span style={{color:'#93A1C0'}}>({m[r]})</span>
          </div>)}
        </div>
        <div style={{fontSize:10,color:'#6E7FA8',marginTop:6}}>Click to open customer</div>
      </div>})()}
      {/* Stats overlay */}
      <div style={{position:'absolute',top:12,left:12,background:'rgba(16,29,66,.88)',border:'1px solid #2A3A6B',borderRadius:12,padding:'12px 15px',backdropFilter:'blur(4px)'}}>
        <div style={{fontSize:10.5,fontWeight:700,letterSpacing:.8,color:'#93A1C0',textTransform:'uppercase'}}>Billed on the map</div>
        <div style={{fontSize:24,fontWeight:800,letterSpacing:-.5}}>{_fmtK(mappedTotal)}</div>
        <div style={{fontSize:11.5,color:'#93A1C0'}}>{visCusts.length} schools · {visCusts.reduce((x,a)=>x+a.invoices,0)} invoices</div>
        <div style={{fontSize:10,color:'#6E7FA8'}}>Portal + NetSuite history, deduped · routes from portal orders (Apr '26+)</div>
        {data.unmappedCount>0&&<div style={{fontSize:10.5,color:'#6E7FA8',marginTop:4}}>{data.unmappedCount} invoices unmapped (no address) · {_fmtK(data.unmappedRev)}</div>}
      </div>
      {/* Top schools */}
      <div style={{position:'absolute',bottom:12,right:12,background:'rgba(16,29,66,.88)',border:'1px solid #2A3A6B',borderRadius:12,padding:'11px 14px',minWidth:210,backdropFilter:'blur(4px)'}}>
        <div style={{fontSize:10.5,fontWeight:700,letterSpacing:.8,color:'#93A1C0',textTransform:'uppercase',marginBottom:6}}>Top schools</div>
        {visCusts.slice(0,6).map((a,i)=><div key={a.c.id} onClick={()=>onOpenCustomer?.(a.c)} style={{display:'flex',gap:8,alignItems:'baseline',fontSize:12,padding:'2.5px 0',cursor:'pointer'}}>
          <span style={{color:'#6E7FA8',fontVariantNumeric:'tabular-nums'}}>{i+1}</span>
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}}>{a.c.name}</span>
          <b style={{marginLeft:'auto',fontVariantNumeric:'tabular-nums'}}>{_fmtK(a.total)}</b>
        </div>)}
      </div>
      {/* Legend: size key + zoom hint */}
      <div style={{position:'absolute',bottom:12,left:12,background:'rgba(16,29,66,.88)',border:'1px solid #2A3A6B',borderRadius:12,padding:'10px 14px',backdropFilter:'blur(4px)'}}>
        <div style={{display:'flex',alignItems:'flex-end',gap:10}}>
          {[0.05,0.35,1].map(f=>{const v=data.maxTotal*f;return<div key={f} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
            <span style={{width:rScale(v)*2,height:rScale(v)*2,borderRadius:99,background:'rgba(255,194,77,.30)',border:'1px solid #FFD9A0'}}/>
            <span style={{fontSize:9.5,color:'#93A1C0'}}>{_fmtK(v)}</span>
          </div>})}
        </div>
        <div style={{fontSize:9.5,color:'#6E7FA8',marginTop:6}}>Scroll to zoom · drag to pan · double-click to reset</div>
      </div>
    </div>}

    {view==='list'&&<div style={{maxHeight:560,overflow:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
        <thead><tr style={{position:'sticky',top:0,background:'#101D42'}}>
          {['#','School','City','State','Invoices','Ship mix','Total'].map(h=><th key={h} style={{textAlign:h==='Total'||h==='Orders'?'right':'left',padding:'9px 14px',fontSize:10.5,letterSpacing:.7,textTransform:'uppercase',color:'#93A1C0',borderBottom:'1px solid #2A3A6B'}}>{h}</th>)}
        </tr></thead>
        <tbody>{visCusts.map((a,i)=><tr key={a.c.id} onClick={()=>onOpenCustomer?.(a.c)} style={{cursor:'pointer',borderBottom:'1px solid #1E2C55'}}>
          <td style={{padding:'8px 14px',color:'#6E7FA8'}}>{i+1}</td>
          <td style={{padding:'8px 14px',fontWeight:700}}>{a.c.name}</td>
          <td style={{padding:'8px 14px',color:'#93A1C0'}}>{a.pt.geo.shipping_city||a.pt.geo.billing_city||'—'}</td>
          <td style={{padding:'8px 14px',color:'#93A1C0'}}>{(a.pt.geo.shipping_state||a.pt.geo.billing_state||'—').toUpperCase()}</td>
          <td style={{padding:'8px 14px',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{a.invoices}</td>
          <td style={{padding:'8px 14px'}}>{['nsa','deco','vendor'].filter(r=>a.routes[r]>0).map(r=><span key={r} title={ROUTE_META[r].label+': '+a.routes[r]+' orders'} style={{display:'inline-flex',alignItems:'center',gap:3,marginRight:8,fontSize:11,color:'#C9D4EE'}}><span style={{width:8,height:8,borderRadius:99,background:ROUTE_META[r].color}}/>{a.routes[r]}</span>)}</td>
          <td style={{padding:'8px 14px',textAlign:'right',fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{MONEY(a.total)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
