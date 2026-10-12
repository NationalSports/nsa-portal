import {supabaseCoach} from './supabaseCoach';
import {supabase} from './supabase';
// Coach credentials are isolated from staff credentials. Staff preview is a deliberate fallback.
export async function coachPortalFetch(url,options={}){
 const coach=await supabaseCoach.auth.getSession();
 const staff=coach.data?.session?null:await supabase?.auth.getSession();
 const token=coach.data?.session?.access_token||staff?.data?.session?.access_token;
 return fetch(url,{...options,headers:{...(options.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})}});
}
