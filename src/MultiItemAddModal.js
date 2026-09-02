/* eslint-disable */
import React, {useEffect, useMemo, useState} from 'react';

const blankRow=()=>({id:'mir_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),query:'',item:null,sizes:{},unit_sell:'',artMode:'none',arts:[]});
const fiveRows=()=>Array.from({length:5},blankRow);
const DECO_TYPES=[['screen_print','Screen Print'],['embroidery','Embroidery'],['dtf','DTF'],['heat_press','Heat Press']];

export default function MultiItemAddModal({open,onClose,catalogResults,vendorResults,searching,onActiveQuery,artFiles,positions,onApply}){
  const[rows,setRows]=useState(fiveRows);const[active,setActive]=useState(null);const[draftArts,setDraftArts]=useState([]);const[errors,setErrors]=useState({});
  useEffect(()=>{if(open){setRows(fiveRows());setActive(null);setDraftArts([]);setErrors({});onActiveQuery('')}},[open]);
  const activeRow=active==null?null:rows[active];
  useEffect(()=>{if(open)onActiveQuery(activeRow?.item?'':(activeRow?.query||''))},[open,active,activeRow?.query,activeRow?.item]);
  const local=useMemo(()=>activeRow&&!activeRow.item?catalogResults(activeRow.query):[],[activeRow?.query,activeRow?.item,catalogResults]);
  if(!open)return null;const positionOptions=(positions||[]).includes('Front Center')?positions:['Front Center',...(positions||[])];
  const patchRow=(i,p)=>setRows(rs=>rs.map((r,x)=>x===i?{...r,...p}:r));
  const choose=(i,c)=>{patchRow(i,{query:c.label,item:c.item,unit_sell:String(c.item.unit_sell??''),sizes:{}});setErrors(e=>({...e,[i]:null}))};
  const clear=(i)=>patchRow(i,{query:'',item:null,unit_sell:'',sizes:{},artMode:'none',arts:[]});
  const addArt=(i)=>patchRow(i,{artMode:'assign',arts:[...rows[i].arts,{id:'ma_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),source:'existing',artId:'',position:'Front Center'}]});
  const updateArt=(i,ai,p)=>patchRow(i,{arts:rows[i].arts.map((a,x)=>x===ai?{...a,...p}:a)});
  const newTbd=(i)=>{const key='draft_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);const n=draftArts.length+1;setDraftArts(ds=>[...ds,{key,name:'ART TBD '+n,deco_type:'screen_print',position:'Front Center',notes:''}]);patchRow(i,{artMode:'assign',arts:[...rows[i].arts,{id:'ma_'+Date.now().toString(36),source:'draft',artId:key,position:'Front Center'}]})};
  const removeDraft=key=>{setDraftArts(ds=>ds.filter(d=>d.key!==key));setRows(rs=>rs.map(r=>({...r,arts:r.arts.filter(a=>!(a.source==='draft'&&a.artId===key))})))};
  const submit=()=>{const prepared=rows.map(r=>r.item&&Number(r.unit_sell)!==Number(r.item.unit_sell)?{...r,item:{...r.item,_sizeSells:undefined}}:r);const out=onApply(prepared,draftArts);if(out?.errors){setErrors(out.errors);const first=Number(Object.keys(out.errors)[0]);if(Number.isFinite(first))setActive(first)}};
  const results=[...local,...(vendorResults||[])];
  return <div style={{position:'fixed',inset:0,zIndex:10050,background:'rgba(15,23,42,.48)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'4vh 20px'}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div style={{background:'#f8fafc',width:'min(1180px,96vw)',maxHeight:'92vh',borderRadius:14,boxShadow:'0 24px 70px rgba(15,23,42,.3)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'16px 20px',background:'white',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:12}}><div><div style={{fontWeight:850,fontSize:18,color:'#172554'}}>Add Multiple Items</div><div style={{fontSize:12,color:'#64748b'}}>Five rows are ready. Empty rows are ignored; populated rows are applied together.</div></div><button className="btn btn-sm btn-secondary" style={{marginLeft:'auto'}} onClick={onClose}>✕</button></div>
      <div style={{padding:14,overflowY:'auto'}}>
        {rows.map((r,i)=>{const inv=r.item?._multiInv||{};const sizes=r.item?.available_sizes||[];return <div key={r.id} style={{background:'white',border:errors[i]?'2px solid #ef4444':'1px solid #dbe3ef',borderRadius:10,padding:12,marginBottom:10,position:'relative'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{width:24,height:24,borderRadius:12,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'#e8edff',color:'#2847c7',fontSize:11,fontWeight:800}}>{i+1}</span>
            <div style={{position:'relative',flex:'1 1 360px'}}><input className="form-input" value={r.query} placeholder="Search SKU, product, or description…" onFocus={()=>setActive(i)} onChange={e=>{patchRow(i,{query:e.target.value,item:null,sizes:{}});setActive(i)}} />
              {active===i&&!r.item&&r.query.trim().length>=2&&<div style={{position:'absolute',zIndex:20,top:'calc(100% + 4px)',left:0,right:0,maxHeight:280,overflowY:'auto',background:'white',border:'1px solid #cbd5e1',borderRadius:8,boxShadow:'0 10px 30px rgba(15,23,42,.18)'}}>
                {results.slice(0,30).map(c=><button key={c.key} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>choose(i,c)} style={{display:'flex',width:'100%',textAlign:'left',padding:'8px 10px',border:0,borderBottom:'1px solid #f1f5f9',background:'white',cursor:'pointer',gap:8}}><span style={{fontWeight:800,color:'#1d4ed8',minWidth:90}}>{c.sku}</span><span style={{flex:1}}>{c.label}<small style={{display:'block',color:'#64748b'}}>{c.sub}</small></span><span style={{fontSize:10,color:c.source==='catalog'?'#166534':'#6d28d9',fontWeight:700}}>{c.sourceLabel}</span></button>)}
                {!results.length&&!searching&&<div style={{padding:12,fontSize:12,color:'#64748b'}}>No matches yet.</div>}{searching&&<div style={{padding:8,fontSize:11,color:'#6d28d9'}}>Searching vendor catalogs…</div>}
              </div>}
            </div>
            {r.item&&<><span style={{fontSize:12,fontWeight:700,color:'#334155'}}>{r.item.color||'No color'}</span><label style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#64748b'}}>Sell $<input className="form-input" type="number" min="0" step="0.01" value={r.unit_sell} onChange={e=>patchRow(i,{unit_sell:e.target.value})} style={{width:90,padding:'6px 7px'}}/></label></>}
            {(r.query||r.item)&&<button className="btn btn-sm btn-secondary" onClick={()=>clear(i)} title="Clear row">Clear</button>}
          </div>
          {r.item&&<div style={{marginLeft:32,marginTop:9}}>
            <div style={{fontSize:12,fontWeight:750,color:'#334155',marginBottom:5}}>{r.item.sku} · {r.item.name}</div>
            <div style={{display:'flex',gap:7,alignItems:'flex-end',flexWrap:'wrap'}}>{sizes.map(sz=><label key={sz} style={{fontSize:10,color:'#64748b',textAlign:'center'}}><span style={{display:'block',fontWeight:750,color:'#334155'}}>{sz}</span><input type="number" min="0" step="1" value={r.sizes[sz]||''} onChange={e=>patchRow(i,{sizes:{...r.sizes,[sz]:e.target.value}})} style={{width:52,padding:'5px',border:'1px solid #cbd5e1',borderRadius:5,textAlign:'center'}}/><span style={{display:'block',fontSize:9,color:(inv[sz]||0)>0?'#15803d':'#94a3b8'}}>{inv[sz]??0} avail</span></label>)}</div>
            <div style={{display:'flex',gap:7,alignItems:'center',marginTop:10,flexWrap:'wrap'}}><span style={{fontSize:11,fontWeight:800,color:'#475569'}}>Art:</span>
              <select className="form-select" value={r.artMode} onChange={e=>patchRow(i,{artMode:e.target.value,arts:e.target.value==='assign'?r.arts:[]})} style={{width:150,fontSize:11}}><option value="none">No decoration</option><option value="later">Decide later</option><option value="assign">Apply art</option></select>
              {r.artMode==='assign'&&<><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>addArt(i)}>+ Existing art</button><button className="btn btn-sm btn-secondary" style={{fontSize:10}} onClick={()=>newTbd(i)}>+ Art TBD</button></>}
            </div>
            {r.artMode==='assign'&&r.arts.map((a,ai)=><div key={a.id} style={{display:'flex',gap:6,alignItems:'center',marginTop:6,marginLeft:40}}><select className="form-select" value={(a.source||'existing')+':'+(a.artId||'')} onChange={e=>{const [source,...id]=e.target.value.split(':');updateArt(i,ai,{source,artId:id.join(':')})}} style={{width:260,fontSize:11}}><option value="existing:">Select art…</option>{artFiles.map(f=><option key={f.id} value={'existing:'+f.id}>{f.name||'Untitled'} — {(f.deco_type||'art').replace(/_/g,' ')}</option>)}{draftArts.map(d=><option key={d.key} value={'draft:'+d.key}>TBD: {d.name}</option>)}</select><select className="form-select" value={a.position} onChange={e=>updateArt(i,ai,{position:e.target.value})} style={{width:160,fontSize:11}}>{positionOptions.map(p=><option key={p} value={p}>{p}</option>)}</select><button className="btn btn-sm btn-secondary" onClick={()=>patchRow(i,{arts:r.arts.filter((_,x)=>x!==ai)})}>✕</button></div>)}
          </div>}
          {errors[i]&&<div style={{marginLeft:32,marginTop:7,fontSize:11,color:'#dc2626',fontWeight:700}}>⚠ {errors[i]}</div>}
        </div>})}
        <button className="btn btn-sm btn-secondary" onClick={()=>setRows(rs=>[...rs,...fiveRows()])}>+ Add 5 More Rows</button>
        {draftArts.length>0&&<div style={{background:'white',border:'1px solid #ddd6fe',borderRadius:10,padding:12,marginTop:12}}><div style={{fontWeight:800,color:'#5b21b6',fontSize:13,marginBottom:8}}>Art TBDs created in this module</div>{draftArts.map((d,di)=><div key={d.key} style={{display:'grid',gridTemplateColumns:'1.1fr .8fr 1fr 1.5fr auto',gap:7,marginTop:7}}><input className="form-input" value={d.name} placeholder="Art name" onChange={e=>setDraftArts(ds=>ds.map((x,i)=>i===di?{...x,name:e.target.value}:x))}/><select className="form-select" value={d.deco_type} onChange={e=>setDraftArts(ds=>ds.map((x,i)=>i===di?{...x,deco_type:e.target.value}:x))}>{DECO_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select className="form-select" value={d.position} onChange={e=>setDraftArts(ds=>ds.map((x,i)=>i===di?{...x,position:e.target.value}:x))}>{positionOptions.map(p=><option key={p} value={p}>{p}</option>)}</select><input className="form-input" value={d.notes} placeholder="Notes (optional)" onChange={e=>setDraftArts(ds=>ds.map((x,i)=>i===di?{...x,notes:e.target.value}:x))}/><button className="btn btn-sm btn-secondary" onClick={()=>removeDraft(d.key)}>Remove</button></div>)}</div>}
      </div>
      <div style={{padding:'12px 18px',background:'white',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Apply All Items</button></div>
    </div>
  </div>;
}
