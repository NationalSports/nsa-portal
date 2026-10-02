/* eslint-disable */
// AI Notes: a rep records a meeting, dictates a memo, or pastes text; the
// server transcribes it (AssemblyAI) and drafts notes (Claude). The rep edits
// and approves: approval creates to-dos (assigned_todos) and new contacts on the
// account. Audio is never kept. See docs/AI_MEETING_NOTES_V1_SPEC.md and
// netlify/functions/meeting-notes.js. `AccountNotes` (below) is the account
// page's Notes tab.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchSelect } from './components';
import { createMeetingRecorder, createChunkUploader, recorderSupported } from './meetingRecorder';

const MAX_RECORD_MS = 90 * 60 * 1000;

const callFn=async(supabase,body)=>{
  const{data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Your session expired. Sign in again.');
  const r=await fetch('/.netlify/functions/meeting-notes',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify(body||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
  return d;
};

const fmtWhen=v=>{const d=new Date(v||0);return Number.isNaN(d.getTime())?'':d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const fmtDay=v=>{if(!v)return'';const d=new Date(v+'T12:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})};
const fmtClock=ms=>{const s=Math.floor(ms/1000);const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const ss=String(s%60).padStart(2,'0');return(h?h+':'+String(m).padStart(2,'0'):m)+':'+ss};
const MODE_LABEL={dictated:'Voice memo',recorded:'Meeting',pasted:'Pasted'};
const STATUS_LABEL={recording:'Not finished',processing:'Working on it…',ready:'Ready to review',approved:'Saved',failed:"Couldn't process",discarded:'Discarded'};
const STAGE_LABEL={lead:'Lead',contacted:'Contacted',quoted:'Quoted',won:'Won',reorder_due:'Reorder due'};
const lines=v=>(Array.isArray(v)?v:[]).join('\n');
const unlines=v=>String(v||'').split('\n').map(s=>s.trim()).filter(Boolean);

const box={background:'#fff',border:'1px solid #e2e8f0',borderRadius:8,padding:12};
const lbl={fontSize:12,fontWeight:700,color:'#475569',marginBottom:4,display:'block'};
const inp={width:'100%',boxSizing:'border-box',border:'1px solid #cbd5e1',borderRadius:6,padding:'8px 10px',fontSize:14,color:'#0f172a',background:'#fff',fontFamily:'inherit'};

function useCustomerOptions(customers){
  return useMemo(()=>(customers||[]).filter(c=>c.is_active!==false).map(c=>({value:c.id,label:c.name+(c.alpha_tag?' ('+c.alpha_tag+')':''),searchText:c.alpha_tag||''})),[customers]);
}

// ─── Recording / paste capture ───────────────────────────────────────────────
function Capture({supabase,customers,mode,initialCustomerId,notify,onDone,onCancel}){
  const custOptions=useCustomerOptions(customers);
  const[customerId,setCustomerId]=useState(initialCustomerId||null);
  const[consentOpen,setConsentOpen]=useState(false);
  const[phase,setPhase]=useState('ready');// ready | starting | recording | paused | interrupted | finishing | error
  const[reason,setReason]=useState('');
  const[elapsed,setElapsed]=useState(0);
  const[up,setUp]=useState({uploaded:0,pending:0,retrying:false});
  const[text,setText]=useState('');
  const[busy,setBusy]=useState(false);
  const recRef=useRef(null);const upRef=useRef(null);const meetingRef=useRef(null);

  // Keep the clock ticking and stop at the 90-minute cap.
  useEffect(()=>{
    if(phase!=='recording'&&phase!=='paused')return;
    const t=setInterval(()=>{const ms=recRef.current?.elapsedMs()||0;setElapsed(ms);if(ms>=MAX_RECORD_MS)stop()},500);
    return()=>clearInterval(t);
  },[phase]);// eslint-disable-line
  // Leaving mid-recording loses whatever hasn't uploaded yet.
  useEffect(()=>{
    if(!['recording','paused','interrupted','finishing'].includes(phase))return;
    const h=e=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);
  },[phase]);
  useEffect(()=>()=>{try{recRef.current?.cancel()}catch{}},[]);

  const begin=async(consent)=>{
    setConsentOpen(false);setPhase('starting');
    let meeting=null;
    try{
      const d=await callFn(supabase,{action:'create',mode,customer_id:customerId||null,consent:!!consent});
      meeting=d.meeting;meetingRef.current=meeting;
      upRef.current=createChunkUploader({supabase,folder:d.folder,onProgress:setUp});
      recRef.current=createMeetingRecorder({
        onChunk:(blob,meta)=>upRef.current.add(blob,meta),
        onState:(s,info)=>{
          if(s==='recording')setPhase('recording');
          else if(s==='paused')setPhase('paused');
          else if(s==='interrupted'){setPhase('interrupted');setReason(info.reason||'')}
        },
      });
      await recRef.current.start();
    }catch(e){
      const denied=/denied|notallowed|permission/i.test(String(e?.name||'')+' '+String(e?.message||''));
      setPhase('error');
      setReason(denied?'Microphone access is blocked. Allow the microphone for this site in your browser settings (iPhone: Settings → Safari → Microphone), then try again.':(e.message||'Could not start recording.'));
      if(meeting)callFn(supabase,{action:'discard',id:meeting.id}).catch(()=>{});
    }
  };

  const onRecordTap=()=>{
    if(!recorderSupported()){setPhase('error');setReason('This browser cannot record audio. Use Safari on iPhone or Chrome on Android, or paste text instead.');return}
    if(mode==='recorded')setConsentOpen(true);else begin(false);
  };
  const pause=()=>recRef.current?.pause();
  const resume=async()=>{try{await recRef.current?.resume()}catch(e){setReason(e.message||'Could not resume');}};
  const stop=async()=>{
    if(!recRef.current||!meetingRef.current)return;
    setPhase('finishing');
    try{
      const ms=recRef.current.elapsedMs();
      await recRef.current.stop();
      await upRef.current.flush();
      await callFn(supabase,{action:'finalize',id:meetingRef.current.id,duration_sec:Math.round(ms/1000)});
      notify?.('Working on your notes. They will show up here in a minute or two.','success');
      onDone?.(meetingRef.current.id);
    }catch(e){setPhase('error');setReason('Could not finish: '+(e.message||e)+'. Your audio is saved. Open the note from the list to finish it.')}
  };
  const cancel=async()=>{
    if(meetingRef.current&&['recording','paused','interrupted','starting'].includes(phase)){
      if(!window.confirm('Throw away this recording?'))return;
      try{recRef.current?.cancel()}catch{}
      callFn(supabase,{action:'discard',id:meetingRef.current.id}).catch(()=>{});
    }
    onCancel?.();
  };
  const submitPaste=async()=>{
    setBusy(true);
    try{const d=await callFn(supabase,{action:'paste',text,customer_id:customerId||null});notify?.('Working on your notes…','success');onDone?.(d.meeting.id)}
    catch(e){notify?.(e.message||'Could not process','error')}
    setBusy(false);
  };

  const live=['recording','paused','interrupted','finishing'].includes(phase);
  const title=mode==='recorded'?'Record a meeting':mode==='dictated'?'Voice memo':'Paste text';
  return(<div style={{display:'grid',gap:12,maxWidth:560}}>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{fontWeight:800,fontSize:16,color:'#0f172a'}}>{title}</div>
      <button className="btn btn-sm btn-secondary" style={{marginLeft:'auto'}} onClick={cancel} disabled={phase==='finishing'}>{live?'Discard':'Cancel'}</button>
    </div>
    <div style={box}>
      <label style={lbl}>Account</label>
      {live?<div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{(customers||[]).find(c=>c.id===customerId)?.name||'Not chosen yet (pick it when you review)'}</div>
      :<SearchSelect options={custOptions} value={customerId} onChange={setCustomerId} placeholder="Pick a school or team (optional now)" limit={50}/>}
    </div>

    {mode==='pasted'?<div style={box}>
      <label style={lbl}>Paste an email, text thread, or call transcript</label>
      <textarea style={{...inp,minHeight:220}} value={text} onChange={e=>setText(e.target.value)} placeholder="Paste here…"/>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
        <button className="btn btn-primary" disabled={busy||text.trim().length<20} onClick={submitPaste}>{busy?'Sending…':'Make notes'}</button>
      </div>
    </div>
    :<div style={{...box,textAlign:'center',padding:'24px 12px'}}>
      {phase==='ready'||phase==='starting'?<>
        <button onClick={onRecordTap} disabled={phase==='starting'} aria-label="Start recording"
          style={{width:96,height:96,borderRadius:48,border:'4px solid #fecaca',outline:'none',background:'#dc2626',color:'#fff',fontSize:15,fontWeight:800,cursor:'pointer',boxShadow:'0 6px 18px rgba(220,38,38,.35)'}}>
          {phase==='starting'?'…':'Record'}
        </button>
        <div style={{fontSize:13,color:'#475569',marginTop:12}}>{mode==='recorded'?'Records everyone in the room. You will confirm they know first.':'Just you talking. 30–90 seconds is plenty.'}</div>
        <div style={{fontSize:12,color:'#64748b',marginTop:4}}>Keep the phone face-up and unlocked while recording. Audio isn't saved, only the notes.</div>
      </>
      :phase==='error'?<div style={{fontSize:13,color:'#b91c1c'}}>{reason}</div>
      :<>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
          <span style={{width:14,height:14,borderRadius:7,background:phase==='recording'?'#dc2626':'#94a3b8',display:'inline-block',animation:phase==='recording'?'nsaPulse 1.2s ease-in-out infinite':'none'}}/>
          <span style={{fontSize:34,fontWeight:800,fontVariantNumeric:'tabular-nums',color:'#0f172a'}}>{fmtClock(elapsed)}</span>
        </div>
        <style>{'@keyframes nsaPulse{0%,100%{opacity:1}50%{opacity:.3}}'}</style>
        <div style={{fontSize:12,color:'#64748b',marginTop:6}}>
          {up.uploaded} part{up.uploaded===1?'':'s'} saved{up.pending?' · '+up.pending+' waiting':''}{up.retrying?' · waiting for signal…':''}
        </div>
        {phase==='interrupted'&&<div style={{margin:'12px auto 0',maxWidth:380,padding:10,borderRadius:8,background:'#fef3c7',border:'1px solid #fde68a',fontSize:13,color:'#92400e'}}>
          <b>Recording paused.</b> {reason} Everything recorded so far is kept. Tap Resume to keep going.
        </div>}
        <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:16}}>
          {phase==='recording'&&<button className="btn btn-secondary" onClick={pause}>Pause</button>}
          {(phase==='paused'||phase==='interrupted')&&<button className="btn btn-secondary" onClick={resume}>Resume</button>}
          <button className="btn btn-primary" disabled={phase==='finishing'} onClick={stop}>{phase==='finishing'?(up.pending?'Saving audio…':'Finishing…'):'Stop & make notes'}</button>
        </div>
      </>}
    </div>}

    {consentOpen&&<div className="modal-overlay" onClick={()=>setConsentOpen(false)}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
      <div className="modal-header"><h2>Let everyone know</h2><button className="modal-close" onClick={()=>setConsentOpen(false)}>×</button></div>
      <div className="modal-body" style={{fontSize:14,color:'#1e293b',display:'grid',gap:8}}>
        <div>Let everyone know you're taking notes. Audio isn't saved, only the notes.</div>
        <div style={{fontSize:13,color:'#475569'}}>You could say: <i>"I'm going to have my phone take notes so I get your order right, okay?"</i></div>
      </div>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setConsentOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>begin(true)}>They know. Start</button></div>
    </div></div>}
  </div>);
}

// ─── Draft review + approve ──────────────────────────────────────────────────
function Review({supabase,cu,meeting,customers,notify,onClose,onApproved}){
  const custOptions=useCustomerOptions(customers);
  const d=meeting.draft||{};
  const[customerId,setCustomerId]=useState(meeting.customer_id||null);
  const[headline,setHeadline]=useState(d.headline||'');
  const[summary,setSummary]=useState(d.summary||'');
  const[sec,setSec]=useState({products:lines(d.sections?.products_discussed),pricing:d.sections?.pricing_and_budget||'',timeline:d.sections?.timeline||'',decisions:lines(d.sections?.decisions),concerns:lines(d.sections?.concerns)});
  const[items,setItems]=useState((d.action_items||[]).map(a=>({...a,include:true})));
  const[people,setPeople]=useState((d.people_mentioned||[]).map(p=>({...p,add:!!p.is_new})));
  const[acceptStage,setAcceptStage]=useState(false);
  const[nextDate,setNextDate]=useState(d.suggested_next_action_date||'');
  const[email,setEmail]=useState(d.follow_up_email||{subject:'',body:''});
  const[utterances,setUtterances]=useState(null);
  const[speakers,setSpeakers]=useState({});
  const[showTranscript,setShowTranscript]=useState(false);
  const[busy,setBusy]=useState('');

  const customer=(customers||[]).find(c=>c.id===customerId)||null;
  const contacts=customer?.contacts||[];
  // New people are only "new" relative to the chosen account's contacts.
  const known=useMemo(()=>new Set(contacts.map(c=>String(c.name||'').trim().toLowerCase())),[contacts]);

  useEffect(()=>{
    let off=false;
    supabase.from('meeting_transcripts').select('utterances,source_text').eq('meeting_id',meeting.id).maybeSingle().then(({data})=>{
      if(off||!data)return;
      setUtterances(data.utterances?.length?data.utterances:(data.source_text?[{speaker:null,text:data.source_text}]:[]));
    });
    return()=>{off=true};
  },[supabase,meeting.id]);

  const letters=useMemo(()=>[...new Set((utterances||[]).map(u=>u.speaker).filter(Boolean))].sort(),[utterances]);
  const sampleFor=l=>{const u=(utterances||[]).filter(x=>x.speaker===l).sort((a,b)=>b.text.length-a.text.length)[0];return u?u.text.slice(0,140):''};
  const speakerName=l=>{const v=String(speakers[l]||'').trim();return !v?'Speaker '+l:v==='me'?(cu?.name||'Me'):v};

  const setItem=(i,patch)=>setItems(p=>p.map((x,j)=>j===i?{...x,...patch}:x));
  const setPerson=(i,patch)=>setPeople(p=>p.map((x,j)=>j===i?{...x,...patch}:x));
  const mainEmail=contacts.find(c=>c.email)?.email||'';

  const approve=async()=>{
    if(!customerId){notify?.('Pick the account this note belongs to','error');return}
    if(!headline.trim()&&!summary.trim()){notify?.('Add a headline or summary','error');return}
    setBusy('approve');
    try{
      const final={
        headline,summary,
        sections:{products_discussed:unlines(sec.products),pricing_and_budget:sec.pricing||null,timeline:sec.timeline||null,decisions:unlines(sec.decisions),concerns:unlines(sec.concerns)},
        action_items:items.map(a=>({text:a.text,owner:a.owner,due_date:a.due_date||null,speaker:a.speaker||null,include:a.include})),
        people_mentioned:people.map(p=>({name:p.name,role:p.role,add:p.add&&!known.has(String(p.name||'').trim().toLowerCase())})),
        sports:d.sports||[],suggested_stage:d.suggested_stage||null,accept_stage:acceptStage,
        next_action_date:nextDate||null,follow_up_email:email,confidence:d.confidence,
      };
      const speaker_map={};letters.forEach(l=>{const v=String(speakers[l]||'').trim();if(v)speaker_map[l]=v});
      const res=await callFn(supabase,{action:'approve',id:meeting.id,customer_id:customerId,final,speaker_map});
      const n=res.todo_ids?.length||0;const c=res.contacts_added?.length||0;
      notify?.('Note saved'+(n?' · '+n+' reminder'+(n===1?'':'s'):'')+(c?' · '+c+' new contact'+(c===1?'':'s'):''),'success');
      onApproved?.(customerId,res.contacts_added||[]);
    }catch(e){notify?.('Could not save: '+(e.message||e),'error')}
    setBusy('');
  };
  const discard=async()=>{
    if(!window.confirm('Discard this note? The transcript will be deleted.'))return;
    setBusy('discard');
    try{await callFn(supabase,{action:'discard',id:meeting.id});onClose?.()}catch(e){notify?.(e.message,'error')}
    setBusy('');
  };

  const section=(title,children)=><div style={box}><div style={{...lbl,fontSize:13,color:'#0f172a'}}>{title}</div>{children}</div>;
  return(<div style={{display:'grid',gap:12,maxWidth:760,paddingBottom:80}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-sm btn-secondary" onClick={onClose}>← Notes</button>
      <div style={{fontSize:12,color:'#64748b'}}>{MODE_LABEL[meeting.mode]} · {fmtWhen(meeting.created_at)}{meeting.duration_sec?' · '+fmtClock(meeting.duration_sec*1000):''}</div>
      {d.confidence!=null&&d.confidence<0.5&&<span style={{fontSize:12,color:'#b45309',fontWeight:700}}>Low confidence. Check it carefully.</span>}
    </div>
    {d.audio_gaps>0&&<div style={{fontSize:12,color:'#b45309'}}>Some audio didn't upload, so a few seconds may be missing.</div>}
    {section('Account',<SearchSelect options={custOptions} value={customerId} onChange={setCustomerId} placeholder="Pick a school or team…" limit={50}/>)}
    {section('Headline',<textarea style={{...inp,minHeight:52,resize:'vertical'}} rows={2} value={headline} onChange={e=>setHeadline(e.target.value)}/>)}
    {section('Summary',<textarea style={{...inp,minHeight:90}} value={summary} onChange={e=>setSummary(e.target.value)}/>)}

    {letters.length>0&&section('Who was talking?',<div style={{display:'grid',gap:8}}>
      {letters.map(l=><div key={l} style={{display:'grid',gap:4}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <b style={{fontSize:13}}>Speaker {l}</b>
          <select style={{...inp,width:'auto',minWidth:180,padding:'6px 8px'}} value={['me',...contacts.map(c=>c.name)].includes(speakers[l])?speakers[l]:(speakers[l]?'__other':'')} onChange={e=>{const v=e.target.value;setSpeakers(p=>({...p,[l]:v==='__other'?' ':v}))}}>
            <option value="">Not sure</option>
            <option value="me">Me ({cu?.name||'rep'})</option>
            {contacts.filter(c=>c.name).map(c=><option key={c.name} value={c.name}>{c.name}{c.role?' · '+c.role:''}</option>)}
            <option value="__other">Someone else…</option>
          </select>
          {speakers[l]&&speakers[l]!=='me'&&!contacts.some(c=>c.name===speakers[l])&&<input style={{...inp,width:180,padding:'6px 8px'}} placeholder="Name" value={speakers[l].trim()} onChange={e=>setSpeakers(p=>({...p,[l]:e.target.value||' '}))}/>}
        </div>
        <div style={{fontSize:12,color:'#64748b',fontStyle:'italic'}}>"{sampleFor(l)}"</div>
      </div>)}
    </div>)}

    {section('To-dos (become reminders)',<div style={{display:'grid',gap:8}}>
      {items.length===0&&<div style={{fontSize:13,color:'#64748b'}}>No to-dos found.</div>}
      {items.map((a,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:8,alignItems:'start',opacity:a.include?1:.5}}>
        <input type="checkbox" checked={a.include} onChange={e=>setItem(i,{include:e.target.checked})} style={{marginTop:10,width:18,height:18}}/>
        <div style={{display:'grid',gap:6}}>
          <input style={inp} value={a.text} onChange={e=>setItem(i,{text:e.target.value})}/>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input style={{...inp,width:170,padding:'6px 8px',fontSize:13}} value={a.owner&&/^[A-Z]$/.test(a.owner)?speakerName(a.owner):(a.owner||'')} onChange={e=>setItem(i,{owner:e.target.value})} placeholder="Owner"/>
            <input type="date" style={{...inp,width:160,padding:'6px 8px',fontSize:13}} value={a.due_date||''} onChange={e=>setItem(i,{due_date:e.target.value||null})}/>
            {!a.due_date&&<span style={{fontSize:12,color:'#64748b',alignSelf:'center'}}>No date: stays on your to-do list</span>}
          </div>
        </div>
      </div>)}
      <button className="btn btn-sm btn-secondary" style={{justifySelf:'start'}} onClick={()=>setItems(p=>[...p,{text:'',owner:'rep',due_date:null,include:true}])}>+ Add to-do</button>
    </div>)}

    {people.length>0&&section('People mentioned',<div style={{display:'grid',gap:8}}>
      {people.map((p,i)=>{const exists=known.has(String(p.name||'').trim().toLowerCase());return(<div key={i} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        {exists?<span style={{fontSize:12,color:'#166534',fontWeight:700,minWidth:120}}>Already a contact</span>
        :<label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,minWidth:120}}><input type="checkbox" checked={p.add} onChange={e=>setPerson(i,{add:e.target.checked})} style={{width:18,height:18}}/>Add as contact</label>}
        <input style={{...inp,width:180,padding:'6px 8px'}} value={p.name} onChange={e=>setPerson(i,{name:e.target.value})}/>
        <input style={{...inp,width:160,padding:'6px 8px'}} value={p.role||''} placeholder="Role" onChange={e=>setPerson(i,{role:e.target.value})}/>
      </div>)})}
    </div>)}

    {section('Details',<div style={{display:'grid',gap:8}}>
      <div><label style={lbl}>Products discussed (one per line)</label><textarea style={{...inp,minHeight:60}} value={sec.products} onChange={e=>setSec(s=>({...s,products:e.target.value}))}/></div>
      <div><label style={lbl}>Pricing & budget</label><input style={inp} value={sec.pricing} onChange={e=>setSec(s=>({...s,pricing:e.target.value}))}/></div>
      <div><label style={lbl}>Timeline</label><input style={inp} value={sec.timeline} onChange={e=>setSec(s=>({...s,timeline:e.target.value}))}/></div>
      <div><label style={lbl}>Decisions (one per line)</label><textarea style={{...inp,minHeight:50}} value={sec.decisions} onChange={e=>setSec(s=>({...s,decisions:e.target.value}))}/></div>
      <div><label style={lbl}>Concerns (one per line)</label><textarea style={{...inp,minHeight:50}} value={sec.concerns} onChange={e=>setSec(s=>({...s,concerns:e.target.value}))}/></div>
    </div>)}

    {(d.suggested_stage||d.suggested_next_action_date)&&section('Next step',<div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
      {d.suggested_stage&&<button type="button" onClick={()=>setAcceptStage(v=>!v)} style={{border:'1px solid '+(acceptStage?'#2563eb':'#cbd5e1'),background:acceptStage?'#dbeafe':'#fff',color:acceptStage?'#1e40af':'#334155',borderRadius:16,padding:'6px 12px',fontSize:13,fontWeight:700,cursor:'pointer'}}>{acceptStage?'✓ ':''}Stage: {STAGE_LABEL[d.suggested_stage]}</button>}
      <label style={{fontSize:13,display:'flex',alignItems:'center',gap:6}}>Next touch <input type="date" style={{...inp,width:160,padding:'6px 8px'}} value={nextDate} onChange={e=>setNextDate(e.target.value)}/></label>
    </div>)}

    {section('Follow-up email',<div style={{display:'grid',gap:6}}>
      <input style={inp} value={email.subject} onChange={e=>setEmail(m=>({...m,subject:e.target.value}))} placeholder="Subject"/>
      <textarea style={{...inp,minHeight:120}} value={email.body} onChange={e=>setEmail(m=>({...m,body:e.target.value}))}/>
      <div style={{display:'flex',gap:8}}>
        <a className="btn btn-sm btn-secondary" href={'mailto:'+encodeURIComponent(mainEmail)+'?subject='+encodeURIComponent(email.subject||'')+'&body='+encodeURIComponent(email.body||'')}>Open in Mail</a>
        <button className="btn btn-sm btn-secondary" onClick={()=>{try{navigator.clipboard.writeText((email.subject?email.subject+'\n\n':'')+email.body);notify?.('Copied')}catch{}}}>Copy</button>
      </div>
    </div>)}

    {utterances&&utterances.length>0&&<div style={box}>
      <button className="btn btn-sm btn-secondary" onClick={()=>setShowTranscript(v=>!v)}>{showTranscript?'Hide':'Show'} {meeting.mode==='pasted'?'original text':'transcript'}</button>
      {showTranscript&&<div style={{marginTop:8,maxHeight:360,overflow:'auto',display:'grid',gap:6,fontSize:13,color:'#1e293b',whiteSpace:'pre-wrap'}}>
        {utterances.map((u,i)=><div key={i}>{u.speaker?<b>{speakerName(u.speaker)}: </b>:null}{u.text}</div>)}
      </div>}
    </div>}

    <div style={{position:'sticky',bottom:0,background:'rgba(248,250,252,.96)',padding:'10px 0',display:'flex',gap:8,borderTop:'1px solid #e2e8f0'}}>
      <button className="btn btn-secondary" disabled={!!busy} onClick={discard}>Discard</button>
      <button className="btn btn-primary" style={{flex:1}} disabled={!!busy} onClick={approve}>{busy==='approve'?'Saving…':'Approve & save'}</button>
    </div>
  </div>);
}

// Read-only view of an approved note.
function NoteView({note,customers,reps,onOpenCustomer}){
  const f=note.final||{};const s=f.sections||{};
  const cust=(customers||[]).find(c=>c.id===note.customer_id);
  const who=(reps||[]).find(r=>r.id===note.team_member_id)?.name;
  const list=(t,arr)=>arr&&arr.length?<div><div style={lbl}>{t}</div><ul style={{margin:'0 0 0 18px',padding:0,fontSize:13}}>{arr.map((x,i)=><li key={i}>{x}</li>)}</ul></div>:null;
  const line=(t,v)=>v?<div><div style={lbl}>{t}</div><div style={{fontSize:13}}>{v}</div></div>:null;
  return(<div style={{display:'grid',gap:8,fontSize:13,color:'#1e293b'}}>
    <div style={{fontSize:12,color:'#64748b'}}>{MODE_LABEL[note.mode]} · {fmtWhen(note.created_at)}{who?' · '+who:''}{cust?<> · <a href="#" onClick={e=>{e.preventDefault();onOpenCustomer?.(cust)}}>{cust.name}</a></>:null}</div>
    <div>{f.summary}</div>
    {list('To-dos',(f.action_items||[]).map(a=>a.text+(a.due_date?' (due '+fmtDay(a.due_date)+')':'')+(a.owner&&a.owner!=='rep'?' · '+a.owner:'')))}
    {list('Products',s.products_discussed)}
    {line('Pricing & budget',s.pricing_and_budget)}
    {line('Timeline',s.timeline)}
    {list('Decisions',s.decisions)}
    {list('Concerns',s.concerns)}
    {list('People',(f.people_mentioned||[]).map(p=>p.name+(p.role?' · '+p.role:'')))}
  </div>);
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function MeetingNotes({supabase,cu,customers,reps,notify:notifyProp,initialCustomerId,initialMode,onConsumedInitial,onContactsAdded,onOpenCustomer}){
  const notifyRef=useRef(notifyProp);notifyRef.current=notifyProp;
  const notify=useCallback((...a)=>notifyRef.current?.(...a),[]);
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[capture,setCapture]=useState(null);// {mode, customerId}
  const[reviewId,setReviewId]=useState(null);
  const[openId,setOpenId]=useState(null);
  const[busyId,setBusyId]=useState(null);

  // Arriving from an account page's "New note" button.
  useEffect(()=>{
    if(initialCustomerId||initialMode){setCapture({mode:initialMode||'dictated',customerId:initialCustomerId||null});onConsumedInitial?.()}
  },[initialCustomerId,initialMode]);// eslint-disable-line

  const load=useCallback(async()=>{
    if(!supabase||!cu?.id){setLoading(false);return}
    const{data,error}=await supabase.from('meetings').select('id,team_member_id,customer_id,mode,status,title,duration_sec,draft,final,error,created_at,approved_at')
      .eq('team_member_id',cu.id).neq('status','discarded').order('created_at',{ascending:false}).limit(100);
    if(error)notify('AI Notes could not load: '+error.message,'error');else setRows(data||[]);
    setLoading(false);
  },[supabase,cu?.id,notify]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    if(!supabase||!cu?.id)return;
    const ch=supabase.channel('meetings-'+cu.id).on('postgres_changes',{event:'*',schema:'public',table:'meetings',filter:'team_member_id=eq.'+cu.id},load).subscribe();
    return()=>{supabase.removeChannel(ch)};
  },[supabase,cu?.id,load]);
  // Realtime can miss events; poll while something is processing.
  const processing=rows.some(r=>r.status==='processing');
  useEffect(()=>{if(!processing)return;const t=setInterval(load,5000);return()=>clearInterval(t)},[processing,load]);

  const act=async(id,action)=>{
    setBusyId(id);
    try{await callFn(supabase,{action,id});await load()}catch(e){notify(e.message,'error')}
    setBusyId(null);
  };
  const custName=id=>(customers||[]).find(c=>c.id===id)?.name||'No account yet';

  if(capture)return<Capture supabase={supabase} customers={customers} mode={capture.mode} initialCustomerId={capture.customerId} notify={notify}
    onDone={()=>{setCapture(null);load()}} onCancel={()=>{setCapture(null);load()}}/>;
  const reviewing=rows.find(r=>r.id===reviewId&&r.status==='ready');
  if(reviewing)return<Review supabase={supabase} cu={cu} meeting={reviewing} customers={customers} notify={notify}
    onClose={()=>{setReviewId(null);load()}} onApproved={(cid,added)=>{if(added?.length)onContactsAdded?.(cid,added);setReviewId(null);load()}}/>;

  const ready=rows.filter(r=>r.status==='ready');
  const working=rows.filter(r=>r.status==='processing'||r.status==='recording');
  const failed=rows.filter(r=>r.status==='failed');
  const approved=rows.filter(r=>r.status==='approved');
  const big={display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'14px 10px',borderRadius:10,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontWeight:800,fontSize:14,color:'#0f172a',flex:'1 1 140px'};
  const row=(r,right)=><div key={r.id} className="card" style={{marginBottom:8}}><div className="card-body" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
    <div style={{flex:1,minWidth:200}}>
      <div style={{fontWeight:700,color:'#0f172a',fontSize:14}}>{r.title||r.draft?.headline||MODE_LABEL[r.mode]}</div>
      <div style={{fontSize:12,color:'#64748b'}}>{custName(r.customer_id)} · {MODE_LABEL[r.mode]} · {fmtWhen(r.created_at)}</div>
      {r.status==='failed'&&r.error&&<div style={{fontSize:12,color:'#b91c1c',marginTop:2}}>{r.error}</div>}
    </div>
    {right}
  </div></div>;

  return(<div style={{maxWidth:900}}>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}>
      <button style={big} onClick={()=>setCapture({mode:'dictated'})}><span style={{fontSize:22}}>🎙️</span>Voice memo<span style={{fontSize:11,fontWeight:500,color:'#64748b'}}>Just you, after a visit</span></button>
      <button style={big} onClick={()=>setCapture({mode:'recorded'})}><span style={{fontSize:22}}>👥</span>Record meeting<span style={{fontSize:11,fontWeight:500,color:'#64748b'}}>Everyone in the room</span></button>
      <button style={big} onClick={()=>setCapture({mode:'pasted'})}><span style={{fontSize:22}}>📋</span>Paste text<span style={{fontSize:11,fontWeight:500,color:'#64748b'}}>Email, texts, transcript</span></button>
    </div>
    {loading?<div style={{padding:20,color:'#64748b',fontSize:13}}>Loading…</div>:<>
      {ready.length>0&&<><h3 style={{fontSize:14,margin:'4px 0 8px',color:'#0f172a'}}>Ready to review ({ready.length})</h3>
        {ready.map(r=>row(r,<button className="btn btn-sm btn-primary" onClick={()=>setReviewId(r.id)}>Review</button>))}</>}
      {working.length>0&&<><h3 style={{fontSize:14,margin:'12px 0 8px',color:'#0f172a'}}>In progress</h3>
        {working.map(r=>row(r,r.status==='processing'?<span style={{fontSize:12,color:'#2563eb',fontWeight:700}}>Working on it…</span>
          :<div style={{display:'flex',gap:6}}>
            <button className="btn btn-sm btn-primary" disabled={busyId===r.id} onClick={()=>act(r.id,'finalize')}>Finish with what was saved</button>
            <button className="btn btn-sm btn-secondary" disabled={busyId===r.id} onClick={()=>window.confirm('Discard this recording?')&&act(r.id,'discard')}>Discard</button>
          </div>))}</>}
      {failed.length>0&&<><h3 style={{fontSize:14,margin:'12px 0 8px',color:'#b91c1c'}}>Couldn't process</h3>
        {failed.map(r=>row(r,<div style={{display:'flex',gap:6}}>
          <button className="btn btn-sm btn-primary" disabled={busyId===r.id} onClick={()=>act(r.id,'retry')}>Retry</button>
          <button className="btn btn-sm btn-secondary" disabled={busyId===r.id} onClick={()=>window.confirm('Discard this note?')&&act(r.id,'discard')}>Discard</button>
        </div>))}</>}
      <h3 style={{fontSize:14,margin:'12px 0 8px',color:'#0f172a'}}>Saved notes</h3>
      {approved.length===0?<div className="card"><div className="card-body" style={{fontSize:13,color:'#64748b'}}>No saved notes yet. After a visit, tap Voice memo and talk for a minute. You'll get a clean note, reminders, and new contacts.</div></div>
      :approved.map(r=><div key={r.id} className="card" style={{marginBottom:8}}><div className="card-body">
        <div style={{display:'flex',gap:8,alignItems:'center',cursor:'pointer'}} onClick={()=>setOpenId(openId===r.id?null:r.id)}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:'#0f172a',fontSize:14}}>{r.title||r.final?.headline}</div>
            <div style={{fontSize:12,color:'#64748b'}}>{custName(r.customer_id)} · {fmtWhen(r.created_at)}</div>
          </div>
          <span style={{fontSize:12,color:'#64748b'}}>{openId===r.id?'▲':'▼'}</span>
        </div>
        {openId===r.id&&<div style={{marginTop:8}}><NoteView note={r} customers={customers} reps={reps} onOpenCustomer={onOpenCustomer}/></div>}
      </div></div>)}
    </>}
  </div>);
}

// Account page "Notes" tab: approved notes for this account and its teams.
export function AccountNotes({supabase,customer,allCustomers,reps,onNewNote}){
  const[rows,setRows]=useState(null);
  const[openId,setOpenId]=useState(null);
  const ids=useMemo(()=>{const all=allCustomers||[];return[customer.id,...all.filter(c=>c.parent_id===customer.id).map(c=>c.id)]},[customer.id,allCustomers]);
  useEffect(()=>{
    if(!supabase)return;let off=false;
    supabase.from('meetings').select('id,team_member_id,customer_id,mode,status,title,final,created_at').in('customer_id',ids).eq('status','approved').order('created_at',{ascending:false}).limit(100)
      .then(({data,error})=>{if(!off)setRows(error?[]:(data||[]))});
    return()=>{off=true};
  },[supabase,ids.join(',')]);// eslint-disable-line
  return(<div className="card"><div className="card-header"><h2>Notes</h2>
    <div style={{display:'flex',gap:6}}>
      <button className="btn btn-sm btn-primary" onClick={()=>onNewNote?.(customer,'dictated')}>🎙️ Voice memo</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>onNewNote?.(customer,'recorded')}>👥 Meeting</button>
      <button className="btn btn-sm btn-secondary" onClick={()=>onNewNote?.(customer,'pasted')}>📋 Paste</button>
    </div></div>
    <div className="card-body">
      {rows===null?<div style={{fontSize:13,color:'#64748b'}}>Loading…</div>
      :rows.length===0?<div style={{fontSize:13,color:'#64748b'}}>No notes yet. Record a voice memo after your next visit and it will show up here.</div>
      :rows.map(r=><div key={r.id} style={{borderBottom:'1px solid #f1f5f9',padding:'8px 0'}}>
        <div style={{display:'flex',gap:8,cursor:'pointer'}} onClick={()=>setOpenId(openId===r.id?null:r.id)}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>{r.title||r.final?.headline}</div>
            <div style={{fontSize:11,color:'#64748b'}}>{fmtWhen(r.created_at)} · {(reps||[]).find(x=>x.id===r.team_member_id)?.name||'Rep'}{r.customer_id!==customer.id?' · '+((allCustomers||[]).find(c=>c.id===r.customer_id)?.name||''):''}</div>
          </div>
          <span style={{fontSize:12,color:'#64748b'}}>{openId===r.id?'▲':'▼'}</span>
        </div>
        {openId===r.id&&<div style={{marginTop:6}}><NoteView note={r} customers={allCustomers} reps={reps}/></div>}
      </div>)}
    </div>
  </div>);
}
