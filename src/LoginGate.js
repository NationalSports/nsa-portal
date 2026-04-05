/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { NSA } from './constants';

const ADMIN_PW_HASH=(process.env.REACT_APP_ADMIN_PW_HASH||'').trim();
const hashPassword=async(pw)=>{const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')};

function LoginGate({onLogin,reps,supabase,sbSignIn:_sbSignIn,sbSignUp:_sbSignUp,sbGetSession:_sbGetSession,sbLinkTeamAuth:_sbLinkTeamAuth,sbGetMyProfile:_sbGetMyProfile}){
  const REPS=(reps||[]).filter(r=>r.is_active!==false);
  const roleLabels={admin:'Admin',gm:'General Manager',prod_manager:'Production Mgr',production:'Production',prod_assistant:'Prod Assistant',rep:'Sales Rep',csr:'CSR',warehouse:'Warehouse',accounting:'Accounting',art:'Artist'};
  const roleColors={admin:'#1e40af',gm:'#7c3aed',prod_manager:'#b45309',production:'#d97706',prod_assistant:'#a16207',rep:'#166534',csr:'#0891b2',warehouse:'#9333ea',accounting:'#dc2626',art:'#ec4899'};
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[password2,setPassword2]=useState('');
  const[error,setError]=useState('');
  const[loading,setLoading]=useState(false);
  const[mode,setMode]=useState('login');// 'login', 'setup', or 'admin'
  const[adminFilter,setAdminFilter]=useState('');
  const[sessionChecked,setSessionChecked]=useState(false);

  // Check for existing Supabase session on mount
  useEffect(()=>{
    (async()=>{
      const session=await _sbGetSession();
      if(session?.user){
        const profile=await _sbGetMyProfile();
        if(profile){onLogin({...profile,_authSession:true});return}
      }
      setSessionChecked(true);
    })();
  },[]);// eslint-disable-line

  const handleLogin=async(e)=>{
    e.preventDefault();setError('');setLoading(true);
    if(!email.trim()){setError('Please enter your email');setLoading(false);return}
    if(!password){setError('Please enter your password');setLoading(false);return}

    // Admin override: if password hash matches, show user picker
    if(ADMIN_PW_HASH){
      const h=await hashPassword(password);
      if(h===ADMIN_PW_HASH){setMode('admin');setError('');setLoading(false);return}
    }

    if(mode==='setup'){
      // First-time password setup
      if(password.length<8){setError('Password must be at least 8 characters');setLoading(false);return}
      if(password!==password2){setError('Passwords do not match');setLoading(false);return}
      // Check that this email belongs to a team member
      const member=REPS.find(r=>r.email&&r.email.toLowerCase()===email.trim().toLowerCase());
      if(!member){setError('No team member found with this email. Contact your admin.');setLoading(false);return}
      const res=await _sbSignUp(email.trim(),password);
      if(res.error){setError(res.error);setLoading(false);return}
      // Link auth account to team member
      if(res.user&&member)await _sbLinkTeamAuth(member.id,res.user.id);
      // Auto sign-in after setup
      const signIn=await _sbSignIn(email.trim(),password);
      if(signIn.error){setError('Account created! Please sign in.');setMode('login');setPassword('');setPassword2('');setLoading(false);return}
      onLogin({...member,_authSession:true});
    }else{
      // Normal sign-in
      const res=await _sbSignIn(email.trim(),password);
      if(res.error){setError(res.error.includes('Email not confirmed')?'Please check your email to confirm your account before signing in.':res.error);setLoading(false);return}
      // Look up team member profile
      const profile=await _sbGetMyProfile();
      if(profile){onLogin({...profile,_authSession:true})}
      else{
        // Try to find and link by email
        const member=REPS.find(r=>r.email&&r.email.toLowerCase()===email.trim().toLowerCase());
        if(member&&res.user){
          await _sbLinkTeamAuth(member.id,res.user.id);
          onLogin({...member,_authSession:true});
        }else{
          setError('No team member profile found for this account');setLoading(false);return;
        }
      }
    }
    setLoading(false);
  };

  if(!sessionChecked)return(
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{fontSize:13,color:'#94a3b8',letterSpacing:3}}>Loading...</div>
    </div>
  );

  return(
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <div style={{width:400,padding:0}}>
        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src={NSA.logoUrl} alt="National Sports Apparel" style={{height:70,marginBottom:8,filter:'brightness(0) invert(1)'}}/>
          <div style={{fontSize:13,color:'#94a3b8',letterSpacing:3,textTransform:'uppercase'}}>Portal</div>
        </div>

        {/* Login Card */}
        <div style={{background:'white',borderRadius:16,padding:32,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
          {mode==='admin'?(
            /* Admin impersonation picker */
            <>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                <div style={{fontSize:18,fontWeight:700,color:'#0f172a'}}>Admin Login</div>
                <button type="button" onClick={()=>{setMode('login');setPassword('');setError('');setAdminFilter('')}}
                  style={{background:'none',border:'none',color:'#3b82f6',fontSize:12,cursor:'pointer'}}>
                  &larr; Back
                </button>
              </div>
              <div style={{fontSize:13,color:'#64748b',marginBottom:12}}>Select a user to log in as</div>
              <input type="text" value={adminFilter} onChange={e=>setAdminFilter(e.target.value)} placeholder="Filter by name..."
                autoFocus style={{width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:8,marginBottom:12,fontSize:13,boxSizing:'border-box',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='#d1d5db'}/>
              <div style={{maxHeight:320,overflow:'auto',display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {REPS.filter(r=>!adminFilter||r.name.toLowerCase().includes(adminFilter.toLowerCase())).map(r=>
                  <button key={r.id} onClick={()=>onLogin({...r,_adminOverride:true})}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',border:'1px solid #e2e8f0',
                      borderRadius:8,background:'white',cursor:'pointer',transition:'all 0.15s',textAlign:'left'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='#f8fafc';e.currentTarget.style.borderColor='#3b82f6'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e2e8f0'}}>
                    <div style={{width:30,height:30,borderRadius:15,background:roleColors[r.role]||'#475569',color:'white',
                      display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>
                      {r.name[0]}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:12,color:'#0f172a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</div>
                      <div style={{fontSize:10,color:roleColors[r.role]||'#64748b',fontWeight:600}}>{roleLabels[r.role]||r.role}</div>
                    </div>
                  </button>)}
              </div>
            </>
          ):<>
          <div style={{fontSize:18,fontWeight:700,color:'#0f172a',marginBottom:4}}>
            {mode==='setup'?'Set Up Your Account':'Sign In'}
          </div>
          <div style={{fontSize:13,color:'#64748b',marginBottom:20}}>
            {mode==='setup'?'Create a password to get started':'Enter your email and password'}
          </div>

          <form onSubmit={handleLogin}>
            <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoFocus
              autoComplete="email" name="email"
              style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,marginBottom:12,fontSize:14,boxSizing:'border-box',outline:'none'}}
              onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='#d1d5db'}/>

            <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder={mode==='setup'?'Create password (min 8 characters)':'Enter password'}
              autoComplete={mode==='setup'?'new-password':'current-password'} name="password"
              style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,marginBottom:mode==='setup'?12:4,fontSize:14,boxSizing:'border-box',outline:'none'}}
              onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='#d1d5db'}/>

            {mode==='setup'&&<>
              <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Confirm Password</label>
              <input type="password" value={password2} onChange={e=>setPassword2(e.target.value)} placeholder="Confirm password"
                style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,marginBottom:4,fontSize:14,boxSizing:'border-box',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='#d1d5db'}/>
            </>}

            {error&&<div style={{color:'#dc2626',fontSize:13,marginTop:8,marginBottom:4,padding:'8px 12px',background:'#fef2f2',borderRadius:8,animation:'shake 0.3s'}}>{error}</div>}

            <button type="submit" disabled={loading}
              style={{width:'100%',padding:'11px',background:'#1e40af',color:'white',border:'none',borderRadius:8,fontWeight:700,fontSize:14,cursor:'pointer',marginTop:12,
                opacity:loading?0.6:1,transition:'opacity 0.15s'}}>
              {loading?'Signing in...':(mode==='setup'?'Create Account & Sign In':'Sign In')}
            </button>
          </form>

          <div style={{textAlign:'center',marginTop:16,paddingTop:16,borderTop:'1px solid #f1f5f9'}}>
            {mode==='login'?(
              <button type="button" onClick={()=>{setMode('setup');setError('');setPassword('');setPassword2('')}}
                style={{background:'none',border:'none',color:'#3b82f6',fontSize:13,cursor:'pointer',fontWeight:500}}>
                First time? Set up your account
              </button>
            ):(
              <button type="button" onClick={()=>{setMode('login');setError('');setPassword('');setPassword2('')}}
                style={{background:'none',border:'none',color:'#3b82f6',fontSize:13,cursor:'pointer',fontWeight:500}}>
                Already have an account? Sign in
              </button>
            )}
          </div>
        </>}
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
