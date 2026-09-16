import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.97.0';

const TOKEN_URL='https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE='https://quickbooks.api.intuit.com';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function ignore(promise:PromiseLike<unknown>){try{await promise;}catch{/* best effort cleanup */}}

export type QboFailure = Error & { code?:string; status?:number };

function failure(code:string,message:string,status?:number):QboFailure {
  const error=new Error(message) as QboFailure;error.code=code;if(status)error.status=status;return error;
}

export class QboClient {
  admin:SupabaseClient;
  runId:string;
  realmId='';
  accessToken='';
  tokenCreatedAt=0;
  expiresIn=3600;
  refreshToken='';
  refreshed=false;

  constructor(admin:SupabaseClient,runId:string){this.admin=admin;this.runId=runId;}

  async loadConnection(){
    const {data,error}=await this.admin.from('qb_oauth_tokens').select('*').eq('company_key','national').maybeSingle();
    if(error||!data)throw failure('oauth_not_connected','QuickBooks connection is unavailable.');
    this.realmId=String(data.realm_id||'');this.accessToken=String(data.access_token||'');this.refreshToken=String(data.refresh_token||'');
    this.tokenCreatedAt=Number(data.token_created_at)||0;this.expiresIn=Number(data.expires_in)||3600;
    if(!/^\d+$/.test(this.realmId)||!this.accessToken||!this.refreshToken)throw failure('oauth_invalid','QuickBooks connection metadata is invalid.');
    if(Date.now()-this.tokenCreatedAt>Math.max(60,(this.expiresIn-300))*1000)await this.refresh();
    return {realmId:this.realmId,refreshed:this.refreshed};
  }

  async refresh(){
    const claimToken=crypto.randomUUID();
    const {data:claimed,error:claimError}=await this.admin.rpc('acquire_qbo_oauth_refresh_claim',{
      p_company_key:'national',p_claim_token:claimToken,p_run_id:this.runId,p_lease_seconds:60,
    });
    if(claimError)throw failure('oauth_lock_failed','QuickBooks authorization refresh could not be locked.');
    if(claimed!==true){
      for(let attempt=0;attempt<5;attempt++){
        await sleep(400*(attempt+1));
        const {data}=await this.admin.from('qb_oauth_tokens').select('*').eq('company_key','national').maybeSingle();
        if(data&&Number(data.token_created_at)>this.tokenCreatedAt&&Date.now()-Number(data.token_created_at)<55*60*1000){
          this.realmId=String(data.realm_id);this.accessToken=String(data.access_token);this.refreshToken=String(data.refresh_token);
          this.tokenCreatedAt=Number(data.token_created_at);this.expiresIn=Number(data.expires_in)||3600;return;
        }
      }
      throw failure('oauth_refresh_busy','Another QuickBooks authorization refresh did not complete in time.');
    }
    try{
      // Re-read after taking the lease. A previous caller may have refreshed while
      // this invocation was waiting for the database lock.
      const {data:latest,error:latestError}=await this.admin.from('qb_oauth_tokens').select('*').eq('company_key','national').maybeSingle();
      if(latestError||!latest)throw failure('oauth_read_failed','QuickBooks authorization could not be read.');
      if(Number(latest.token_created_at)>this.tokenCreatedAt&&Date.now()-Number(latest.token_created_at)<55*60*1000){
        this.realmId=String(latest.realm_id);this.accessToken=String(latest.access_token);this.refreshToken=String(latest.refresh_token);
        this.tokenCreatedAt=Number(latest.token_created_at);this.expiresIn=Number(latest.expires_in)||3600;return;
      }
      const clientId=Deno.env.get('QBO_CLIENT_ID')||'',clientSecret=Deno.env.get('QBO_CLIENT_SECRET')||'';
      if(!clientId||!clientSecret)throw failure('oauth_secret_missing','QuickBooks server credentials are unavailable.');
      const oldRefresh=String(latest.refresh_token), response=await fetch(TOKEN_URL,{method:'POST',headers:{
        Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json',
      },body:new URLSearchParams({grant_type:'refresh_token',refresh_token:oldRefresh})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body?.access_token)throw failure('oauth_refresh_failed','QuickBooks authorization refresh failed.',response.status);
      const now=Date.now(),rotated=String(body.refresh_token||oldRefresh);
      const {data:saved,error:saveError}=await this.admin.from('qb_oauth_tokens').update({
        access_token:String(body.access_token),refresh_token:rotated,expires_in:Number(body.expires_in)||3600,
        token_created_at:now,updated_at:new Date(now).toISOString(),
      }).eq('company_key','national').eq('refresh_token',oldRefresh).select('realm_id');
      if(saveError)throw failure('oauth_save_failed','Refreshed QuickBooks authorization could not be saved.');
      if(!saved?.length){
        const {data:current}=await this.admin.from('qb_oauth_tokens').select('*').eq('company_key','national').maybeSingle();
        if(!current||Number(current.token_created_at)<=this.tokenCreatedAt)throw failure('oauth_rotation_conflict','QuickBooks authorization changed concurrently.');
        this.realmId=String(current.realm_id);this.accessToken=String(current.access_token);this.refreshToken=String(current.refresh_token);
        this.tokenCreatedAt=Number(current.token_created_at);this.expiresIn=Number(current.expires_in)||3600;return;
      }
      this.accessToken=String(body.access_token);this.refreshToken=rotated;this.tokenCreatedAt=now;this.expiresIn=Number(body.expires_in)||3600;this.refreshed=true;
    } finally {
      await ignore(this.admin.rpc('release_qbo_oauth_refresh_claim',{p_company_key:'national',p_claim_token:claimToken}));
    }
  }

  async request(path:string,init:RequestInit={},allowRefresh=true):Promise<any>{
    let lastStatus=0;
    for(let attempt=0;attempt<4;attempt++){
      const separator=path.includes('?')?'&':'?';
      const response=await fetch(`${API_BASE}/v3/company/${this.realmId}${path}${separator}minorversion=75`,{...init,headers:{
        Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${this.accessToken}`,...(init.headers||{}),
      }});lastStatus=response.status;
      if(response.status===401&&allowRefresh){await this.refresh();return this.request(path,init,false);}
      if(response.status===429||response.status>=500){if(attempt<3){await sleep(Math.min(4000,500*2**attempt));continue;}}
      const body=await response.json().catch(()=>({}));
      if(!response.ok||body?.Fault){
        const fault=body?.Fault?.Error?.[0];
        const code=response.status===429?'qbo_rate_limited':response.status>=500?'qbo_temporary_failure':'qbo_request_failed';
        throw failure(code,`QuickBooks request failed${fault?.code?` (${fault.code})`:''}.`,response.status);
      }
      return body;
    }
    throw failure(lastStatus===429?'qbo_rate_limited':'qbo_temporary_failure','QuickBooks request retry limit reached.',lastStatus);
  }

  query(sql:string){return this.request(`/query?query=${encodeURIComponent(sql)}`);}

  async queryAll(entity:string,_fields='*',pageSize=1000,where='',project:(row:any)=>any=(row:any)=>row){
    const rows:any[]=[];
    for(let start=1;;start+=pageSize){
      // QBO Query Language is not general SQL: entity reads use SELECT *.
      // Keep the unused field parameter for call-site readability and to avoid
      // accidentally interpolating unsupported projections into the query.
      const data=await this.query(`SELECT * FROM ${entity}${where?` WHERE ${where}`:''} STARTPOSITION ${start} MAXRESULTS ${pageSize}`);
      const batch=data?.QueryResponse?.[entity]||[];rows.push(...batch.map(project));if(batch.length<pageSize)break;
      if(rows.length>50000)throw failure('qbo_query_limit','QuickBooks query exceeded the safety limit.');
    }
    return rows;
  }
}

export function createAdmin(){
  const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||!key)throw failure('server_config_missing','Supabase server configuration is unavailable.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
