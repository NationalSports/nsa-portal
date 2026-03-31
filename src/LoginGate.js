/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { DEFAULT_REPS, NSA } from './constants';

function LoginGate({onLogin,reps,supabase,sbSignIn:_sbSignIn,sbSignUp:_sbSignUp,sbGetSession:_sbGetSession,sbLinkTeamAuth:_sbLinkTeamAuth,sbGetMyProfile:_sbGetMyProfile}){
  const REPS=(reps||DEFAULT_REPS).filter(r=>r.is_active!==false);
  const roleColors={admin:'#1e40af',gm:'#7c3aed',prod_manager:'#b45309',production:'#d97706',prod_assistant:'#a16207',rep:'#166534',csr:'#0891b2',warehouse:'#9333ea',accounting:'#dc2626',art:'#ec4899'};
  const roleLabels={admin:'Admin',gm:'General Manager',prod_manager:'Production Mgr',production:'Production',prod_assistant:'Prod Assistant',rep:'Sales Rep',csr:'CSR',warehouse:'Warehouse',accounting:'Accounting',art:'Artist'};
  const deptOrder=['admin','rep','csr','accounting','warehouse','prod_manager','production','prod_assistant','art'];
  const grouped=deptOrder.map(role=>({role,label:roleLabels[role]||role,color:roleColors[role]||'#475569',members:REPS.filter(r=>r.role===role)})).filter(g=>g.members.length>0);
  const[selDept,setSelDept]=React.useState(null);
  // Auth mode: 'pick' (legacy click-to-login) or 'password' (Supabase Auth)
  const[authMode,setAuthMode]=React.useState('pick');
  const[authUser,setAuthUser]=React.useState(null);// selected user for password login
  const[authEmail,setAuthEmail]=React.useState('');
  const[authPass,setAuthPass]=React.useState('');
  const[authErr,setAuthErr]=React.useState('');
  const[authLoading,setAuthLoading]=React.useState(false);
  const[authSetup,setAuthSetup]=React.useState(false);// true = creating password for first time
  const[authPass2,setAuthPass2]=React.useState('');

  // Check for existing Supabase session on mount
  React.useEffect(()=>{
    (async()=>{
      const session=await _sbGetSession();
      if(session?.user){
        const profile=await _sbGetMyProfile();
        if(profile){onLogin({...profile,_authSession:true});return}
      }
    })();
  },[]);// eslint-disable-line

  // Handle password-based login
  const handleAuthSubmit=async(e)=>{
    e.preventDefault();setAuthErr('');setAuthLoading(true);
    const email=authEmail||(authUser?.email);
    if(!email){setAuthErr('No email address on file for this user');setAuthLoading(false);return}
    if(authSetup){
      // First-time password setup
      if(authPass.length<8){setAuthErr('Password must be at least 8 characters');setAuthLoading(false);return}
      if(authPass!==authPass2){setAuthErr('Passwords do not match');setAuthLoading(false);return}
      const res=await _sbSignUp(email,authPass);
      if(res.error){setAuthErr(res.error);setAuthLoading(false);return}
      // Link auth account to team member
      if(res.user&&authUser)await _sbLinkTeamAuth(authUser.id,res.user.id);
      // Auto sign-in after setup
      const signIn=await _sbSignIn(email,authPass);
      if(signIn.error){setAuthErr('Account created. Please sign in.');setAuthSetup(false);setAuthLoading(false);return}
      onLogin({...authUser,_authSession:true});
    }else{
      // Normal sign-in
      const res=await _sbSignIn(email,authPass);
      if(res.error){setAuthErr(res.error);setAuthLoading(false);return}
      // Look up team member profile
      const profile=await _sbGetMyProfile();
      if(profile){onLogin({...profile,_authSession:true})}
      else if(authUser){
        // Link if not yet linked
        if(res.user)await _sbLinkTeamAuth(authUser.id,res.user.id);
        onLogin({...authUser,_authSession:true});
      }else{setAuthErr('No team member profile found for this account');setAuthLoading(false);return}
    }
    setAuthLoading(false);
  };

  // Handle click-to-login (legacy) — when user has password_set, require it
  const handleUserClick=(r)=>{
    if(r.password_set&&supabase){
      setAuthMode('password');setAuthUser(r);setAuthEmail(r.email||'');setAuthErr('');
    }else if(supabase&&r.email){
      // Offer to set up password, but allow skip for now
      setAuthMode('password');setAuthUser(r);setAuthEmail(r.email||'');setAuthSetup(!r.password_set);setAuthErr('');
    }else{
      onLogin(r);// fallback: no Supabase or no email → legacy click login
    }
  };

  return(
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <div style={{width:480,padding:0}}>
        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src={NSA.logoUrl} alt="National Sports Apparel" style={{height:70,marginBottom:8,filter:'brightness(0) invert(1)'}}/>
          <div style={{fontSize:13,color:'#94a3b8',letterSpacing:3,textTransform:'uppercase'}}>Portal</div>
        </div>

        {/* Login Card */}
        <div style={{background:'white',borderRadius:16,padding:28,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
          {authMode==='password'&&authUser?(
            /* Password login form */
            <form onSubmit={handleAuthSubmit}>
              <button type="button" onClick={()=>{setAuthMode('pick');setAuthUser(null);setAuthErr('');setAuthSetup(false)}}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:'#3b82f6',marginBottom:12,padding:0}}>
                &larr; Back to team list
              </button>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
                <div style={{width:40,height:40,borderRadius:20,background:roleColors[authUser.role]||'#475569',color:'white',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:800}}>
                  {authUser.name[0]}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>{authUser.name}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{roleLabels[authUser.role]||authUser.role}</div>
                </div>
              </div>
              {authSetup&&<div style={{fontSize:12,color:'#059669',background:'#ecfdf5',padding:'8px 12px',borderRadius:8,marginBottom:12}}>
                Set up your password to secure your account. You'll use this to sign in going forward.
              </div>}
              <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email"
                style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,fontSize:13,boxSizing:'border-box'}}/>
              <input type="password" value={authPass} onChange={e=>setAuthPass(e.target.value)} placeholder={authSetup?'Create password (min 8 chars)':'Password'} autoFocus
                style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,fontSize:13,boxSizing:'border-box'}}/>
              {authSetup&&<input type="password" value={authPass2} onChange={e=>setAuthPass2(e.target.value)} placeholder="Confirm password"
                style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,fontSize:13,boxSizing:'border-box'}}/>}
              {authErr&&<div style={{color:'#dc2626',fontSize:12,marginBottom:8,animation:'shake 0.3s'}}>{authErr}</div>}
              <button type="submit" disabled={authLoading}
                style={{width:'100%',padding:'10px',background:'#1e40af',color:'white',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',opacity:authLoading?0.6:1}}>
                {authLoading?'Signing in...':authSetup?'Create Account & Sign In':'Sign In'}
              </button>
              {authSetup&&<button type="button" onClick={()=>onLogin(authUser)}
                style={{width:'100%',padding:'8px',background:'none',border:'1px solid #e2e8f0',borderRadius:8,fontSize:12,color:'#64748b',cursor:'pointer',marginTop:6}}>
                Skip for now (less secure)
              </button>}
            </form>
          ):(
            /* Team member selection (legacy + enhanced) */
            <>
              <div style={{fontSize:14,fontWeight:700,color:'#1e293b',marginBottom:4}}>Who's logging in?</div>
              <div style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>Select your department, then your name</div>

              {/* Department pills */}
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
                {grouped.map(g=><button key={g.role} onClick={()=>setSelDept(selDept===g.role?null:g.role)}
                  style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:10,
                    border:selDept===g.role?'2px solid '+g.color:'1px solid #e2e8f0',
                    background:selDept===g.role?g.color+'12':'white',cursor:'pointer',transition:'all 0.15s'}}
                  onMouseEnter={e=>{if(selDept!==g.role)e.currentTarget.style.borderColor=g.color}}
                  onMouseLeave={e=>{if(selDept!==g.role)e.currentTarget.style.borderColor='#e2e8f0'}}>
                  <div style={{width:8,height:8,borderRadius:4,background:g.color,flexShrink:0}}/>
                  <span style={{fontSize:12,fontWeight:600,color:selDept===g.role?g.color:'#475569'}}>{g.label}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{g.members.length}</span>
                </button>)}
              </div>

              {/* Members grid - show selected department or all */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,maxHeight:340,overflow:'auto'}}>
                {(selDept?grouped.find(g=>g.role===selDept)?.members||[]:REPS).map(r=>
                  <button key={r.id} onClick={()=>handleUserClick(r)}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',border:'1px solid #e2e8f0',
                      borderRadius:10,background:'white',cursor:'pointer',transition:'all 0.15s',textAlign:'left'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='#f8fafc';e.currentTarget.style.borderColor='#3b82f6';e.currentTarget.style.transform='translateY(-1px)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.transform='none'}}>
                    <div style={{width:34,height:34,borderRadius:17,background:roleColors[r.role]||'#475569',color:'white',
                      display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:800,flexShrink:0}}>
                      {r.name[0]}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:'#0f172a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</div>
                      <div style={{fontSize:10,color:roleColors[r.role]||'#64748b',fontWeight:600}}>
                        {roleLabels[r.role]||r.role}{r.password_set?' \u{1F512}':''}
                      </div>
                    </div>
                  </button>)}
              </div>
            </>
          )}
        </div>

        <div style={{textAlign:'center',marginTop:20,fontSize:10,color:'#475569'}}>
          {NSA.name} · {NSA.fullAddr}
        </div>
      </div>

      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}



export default LoginGate;
