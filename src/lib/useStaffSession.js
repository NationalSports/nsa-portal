import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {canViewPortalPage} from './pageAccess';
// Never authorize standalone tools from a cached portal user or session presence alone.
export function useStaffSession(section='@staff'){
 const [state,setState]=useState({loading:true,signedIn:false,email:null,profile:null});
 useEffect(()=>{
  let alive=true,sequence=0;
  async function verify(){const run=++sequence;
   try{
    if(!supabase)throw new Error('No connection');
    const {data,error}=await supabase.auth.getUser();if(error||!data?.user)throw new Error('Sign in required');
    const result=await supabase.rpc('get_my_profile');const profile=result.data?.[0];
    if(result.error||!profile||profile.auth_id!==data.user.id||profile.is_active===false)throw new Error('Staff access denied');
    const allowed=section==='@staff'||canViewPortalPage(profile,section);
    if(alive&&run===sequence)setState({loading:false,signedIn:allowed,email:allowed?data.user.email:null,profile:allowed?profile:null});
   }catch{if(alive&&run===sequence)setState({loading:false,signedIn:false,email:null,profile:null});}
  }
  verify();const {data:sub}=supabase?.auth.onAuthStateChange(()=>{setState({loading:true,signedIn:false,email:null,profile:null});setTimeout(verify,0);})||{};
  const onFocus=()=>{if(document.visibilityState==='visible')verify();};
  window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
  const timer=setInterval(onFocus,30000);
  return()=>{alive=false;sequence++;clearInterval(timer);sub?.subscription?.unsubscribe();window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
 },[section]);
 return state;
}
