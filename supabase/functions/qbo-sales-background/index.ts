import { QboClient, createAdmin, type QboFailure } from './qbo.ts';
import {
  REALM_ID, allocateUnreflectedPayments, buildInvoiceLines, classifyInvoiceDuplicate,
  classifySourceInvoice, clean, customerDisplayName, customerIdentityRisks, exactCustomerMatches, invoiceNumberForms,
  looseCustomerMatches, money, normalizeName, parseDate, paymentIdentity, paymentReference,
  qboPaymentApplications, sha256, standardDueDate, taxPlan, writeAllowed,
} from './logic.js';

const CORS={
  'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store',
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
const errorCode=(error:unknown)=>clean((error as QboFailure)?.code)||'sales_run_failed';
const safeError=(error:unknown)=>clean((error as Error)?.message||'QBO sales run failed.').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,500);
const escapeQbo=(value:unknown)=>clean(value).replaceAll("'","\\'");
const serviceToken=()=>Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const bearer=(req:Request)=>clean(req.headers.get('authorization')).replace(/^Bearer\s+/i,'');
function jwtRole(token:string){
  try{
    const segment=token.split('.')[1];if(!segment)return'';
    const padded=segment.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-segment.length%4)%4);
    return clean(JSON.parse(atob(padded))?.role);
  }catch{return'';}
}
async function ignore(promise:PromiseLike<unknown>){try{await promise;}catch{/* best effort cleanup */}}

type Actor={service:boolean;userId:string;role:string};

async function authorize(req:Request,admin:any):Promise<Actor|null>{
  const token=bearer(req);if(!token)return null;
  // verify_jwt is enabled at the Edge gateway. Accept its verified service-role
  // claim as well as an exact key match so Vault JWT rotation cannot break Cron.
  if(token===serviceToken()||jwtRole(token)==='service_role')return{service:true,userId:'service_role',role:'service_role'};
  const {data,error}=await admin.auth.getUser(token);if(error||!data?.user?.id)return null;
  const {data:member}=await admin.from('team_members').select('role,is_active').eq('auth_id',data.user.id).maybeSingle();
  if(!member||member.is_active===false||!['admin','super_admin','accounting'].includes(String(member.role)))return null;
  return{service:false,userId:data.user.id,role:String(member.role)};
}

function receiptKey(realm:string,mapKey:string,sourceId:string){
  return '_qb_link_v1_'+encodeURIComponent(JSON.stringify([clean(realm),mapKey,clean(sourceId)]));
}

async function persistLink(admin:any,{realm,mapKey,sourceId,qboId,evidence}:any){
  const id=receiptKey(realm,mapKey,sourceId),verifiedAt=new Date().toISOString();
  const row={realm_id:realm,map_key:mapKey,source_id:sourceId,qbo_id:String(qboId),active:true,verified_at:verifiedAt,evidence};
  const {data:before,error:readError}=await admin.from('app_state').select('id,value,version').eq('id',id).maybeSingle();
  if(readError)throw Object.assign(new Error('Durable QBO mapping could not be read.'),{code:'mapping_read_failed'});
  if(before?.value){
    const existing=JSON.parse(before.value);
    if(existing.active!==false&&String(existing.qbo_id)!==String(qboId))throw Object.assign(new Error('Durable QBO mapping conflicts with the verified record.'),{code:'mapping_conflict'});
  }
  const value=JSON.stringify(row);
  const write=before?.value
    ?await admin.from('app_state').update({value,updated_at:verifiedAt,version:Number(before.version||0)+1}).eq('id',id).eq('value',before.value).select('id')
    :await admin.from('app_state').insert({id,value,updated_at:verifiedAt,version:1}).select('id');
  if(write.error||write.data?.length!==1)throw Object.assign(new Error('Durable QBO mapping could not be saved atomically.'),{code:'mapping_save_failed'});
  const {data:after,error:afterError}=await admin.from('app_state').select('value').eq('id',id).maybeSingle();
  if(afterError||after?.value!==value)throw Object.assign(new Error('Durable QBO mapping failed database read-back.'),{code:'mapping_readback_failed'});
  return row;
}

async function status(admin:any){
  const [{data:settings,error:settingsError},{data:runs,error:runsError},{data:reviews,error:reviewsError},{data:token}]=await Promise.all([
    admin.from('qbo_sales_settings').select('*').eq('company_key','national').maybeSingle(),
    admin.from('qbo_sales_runs').select('*').eq('company_key','national').order('started_at',{ascending:false}).limit(10),
    admin.from('qbo_sales_manual_reviews').select('*').eq('company_key','national').eq('status','open').order('last_seen_at',{ascending:false}).limit(50),
    admin.from('qb_oauth_tokens').select('realm_id,token_created_at,expires_in,updated_at').eq('company_key','national').maybeSingle(),
  ]);
  if(settingsError||runsError||reviewsError)throw new Error('Background sales status is unavailable.');
  const now=new Date(),next=new Date(now);next.setUTCMinutes(17,0,0);if(next<=now)next.setUTCHours(next.getUTCHours()+1);
  return{settings,runs:runs||[],manual_reviews:reviews||[],connection:{configured:!!token,realm_id:token?.realm_id||null,updated_at:token?.updated_at||null},schedule:'17 * * * *',next_scheduled_run:next.toISOString()};
}

function initCounters(){return{
  customers:{examined:0,revalidated:0,linked_existing:0,created:0,manual_review:0,failed:0},
  invoices:{examined:0,already_linked:0,exact_existing:0,created:0,excluded_zero:0,excluded_void:0,held_future:0,manual_review:0,failed:0},
  payments:{examined:0,already_reflected:0,created:0,partial:0,manual_review:0,failed:0},
};}

function resolveTerm(paymentTerms:string,terms:any[],fallback='net30'){
  const raw=clean(paymentTerms||fallback).toLowerCase().replace(/[^a-z0-9]+/g,'');
  const dueDays=['prepay','prepaid','dueonreceipt'].includes(raw)?0:/^net\d+$/.test(raw)?Number(raw.slice(3)):NaN;
  if(!Number.isFinite(dueDays))throw new Error('unsupported_payment_terms');
  const active=terms.filter(row=>row?.Active!==false&&row?.Id);
  const name=active.filter(row=>clean(row.Name).toLowerCase().replace(/[^a-z0-9]+/g,'')===raw);
  const matches=name.length?name:active.filter(row=>Number(row.DueDays)===dueDays&&clean(row.Type||'standard').toLowerCase()==='standard');
  if(matches.length!==1)throw new Error(matches.length?'ambiguous_qbo_term':'missing_qbo_term');
  return{value:String(matches[0].Id),name:String(matches[0].Name||'')};
}

function buildCustomerPayload(customer:any,term:any){
  const payload:any={DisplayName:customerDisplayName(customer),CompanyName:clean(customer.name),SalesTermRef:term,
    Notes:`Portal customer ${clean(customer.id)}. Terms: ${clean(customer.payment_terms)||'net30'}`};
  if(customer.contact_email)payload.PrimaryEmailAddr={Address:clean(customer.contact_email)};
  if(customer.contact_phone)payload.PrimaryPhone={FreeFormNumber:clean(customer.contact_phone)};
  if(customer.billing_address_line1)payload.BillAddr={Line1:customer.billing_address_line1,Line2:customer.billing_address_line2||'',City:customer.billing_city||'',CountrySubDivisionCode:customer.billing_state||'',PostalCode:customer.billing_zip||''};
  if(customer.shipping_address_line1)payload.ShipAddr={Line1:customer.shipping_address_line1,Line2:customer.shipping_address_line2||'',City:customer.shipping_city||'',CountrySubDivisionCode:customer.shipping_state||'',PostalCode:customer.shipping_zip||''};
  return payload;
}

function accountByNumber(accounts:any[],number:string,types:string[]){
  const matches=accounts.filter(row=>row?.Active!==false&&clean(row.AcctNum)===number&&types.includes(clean(row.AccountType)));
  if(matches.length!==1)throw Object.assign(new Error(`Required QBO account ${number} is missing or ambiguous.`),{code:'account_mapping_changed'});
  return matches[0];
}

function itemByName(items:any[],name:string,accountId:string){
  const matches=items.filter(row=>row?.Active!==false&&clean(row.Name)===name);
  if(matches.length!==1||String(matches[0].IncomeAccountRef?.value)!==String(accountId))throw Object.assign(new Error(`Required QBO item "${name}" is missing, ambiguous, or mapped to the wrong account.`),{code:'item_mapping_changed'});
  return matches[0];
}

function phaseSelection<T extends {sourceId:string}>(rows:T[],settings:any,type:string){
  const sorted=[...rows].sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  if(`${type}_canary`===settings.phase){const id=clean(settings[`canary_${type}_source_id`]);return sorted.filter(row=>row.sourceId===id).slice(0,1);}
  if(!['bounded','hourly'].includes(clean(settings.phase)))return[];
  const limit=Number(settings[`${type}_batch_limit`])||25,offset=Math.max(0,Number(settings.continuation_cursor?.[`${type}_offset`])||0);
  if(!sorted.length)return[];const start=offset%sorted.length;return [...sorted.slice(start),...sorted.slice(0,start)].slice(0,Math.min(limit,sorted.length));
}

function boundedWindow<T extends {id?:string;sourceId?:string}>(rows:T[],settings:any,type:string){
  const sorted=[...rows].sort((a,b)=>clean(a.id||a.sourceId).localeCompare(clean(b.id||b.sourceId)));
  const limit=Number(settings[`${type}_batch_limit`])||25,offset=Math.max(0,Number(settings.continuation_cursor?.[`${type}_offset`])||0);
  if(!sorted.length)return[];const start=offset%sorted.length;return [...sorted.slice(start),...sorted.slice(0,start)].slice(0,Math.min(limit,sorted.length));
}

async function runSales(admin:any,{trigger,forceReadOnly=false}:any){
  const cutoff=new Date().toISOString(),deployment=Deno.env.get('DENO_DEPLOYMENT_ID')||'local';
  const {data:claim,error:claimError}=await admin.rpc('acquire_qbo_sales_run',{
    p_trigger_type:trigger,p_deployment_id:deployment,p_source_cutoff:cutoff,p_lease_seconds:840,p_force_read_only:forceReadOnly,
  });
  if(claimError)throw new Error('Could not create the durable QBO sales run.');
  if(!claim?.acquired)return{ok:true,started:false,run_id:claim?.run_id,reason:claim?.reason};
  const runId=String(claim.run_id),leaseToken=String(claim.lease_token),counters=initCounters(),qboIds:any={customers:[],invoices:[],payments:[]};
  const manifest:any[]=[],reviews:any[]=[];let sequence=0,settings:any=null,snapshot:any=null,qbo:QboClient|null=null;
  const add=(entity_type:string,source_id:string,action:string,result:string,qbo_id:string|null=null,evidence:any={})=>manifest.push({run_id:runId,sequence_no:++sequence,entity_type,source_id,action,result,qbo_id,evidence});
  const review=(entity_type:string,source_id:string,reason_code:string,evidence:any={})=>reviews.push({company_key:'national',realm_id:REALM_ID,entity_type,source_id,reason_code,status:'open',evidence,first_seen_run_id:runId,last_seen_run_id:runId,last_seen_at:new Date().toISOString()});
  const renewLease=async()=>{const {data,error}=await admin.rpc('renew_qbo_sales_run_lease',{p_run_id:runId,p_lease_token:leaseToken,p_lease_seconds:840});if(error||data!==true)throw Object.assign(new Error('QBO sales-run lease could not be renewed.'),{code:'run_lease_lost'});};
  const checkpoint=async(stage:string)=>{const {error}=await admin.from('qbo_sales_runs').update({summary:{stage}}).eq('id',runId).eq('status','running').eq('lease_token',leaseToken);if(error)throw new Error('QBO sales-run checkpoint could not be saved.');await renewLease();};
  let terminal='completed',failureCode:string|null=null,failureMessage:string|null=null;
  try{
    const {data:settingRow,error:settingError}=await admin.from('qbo_sales_settings').select('*').eq('company_key','national').single();
    if(settingError||!settingRow)throw Object.assign(new Error('QBO sales settings are unavailable.'),{code:'settings_missing'});settings=settingRow;
    qbo=new QboClient(admin,runId);await qbo.loadConnection();
    if(qbo.realmId!==settings.realm_id||qbo.realmId!==REALM_ID)throw Object.assign(new Error('Connected QBO realm changed unexpectedly.'),{code:'realm_changed'});
    const company=(await qbo.request(`/companyinfo/${qbo.realmId}`))?.CompanyInfo;
    if(!company||clean(company.CompanyName)!==clean(settings.expected_company_name))throw Object.assign(new Error('Connected QBO company changed unexpectedly.'),{code:'company_changed'});
    const {data:source,error:sourceError}=await admin.rpc('qbo_sales_source_snapshot',{p_source_cutoff:cutoff});
    if(sourceError||!source)throw Object.assign(new Error('Portal sales snapshot failed.'),{code:'source_snapshot_failed'});snapshot=source;
    if(clean(snapshot.legacy_config?.realm_id)!==REALM_ID)throw Object.assign(new Error('Portal QBO realm configuration changed unexpectedly.'),{code:'realm_config_changed'});

    const requiredItemNames=['NSA Portal Sales',...['CA','AZ','CO','NV','TX','WA','WI','SD'].map(state=>`NSA Portal Sales Tax — ${state}`)];
    const invoiceFloor=(snapshot.invoices||[]).map((invoice:any)=>parseDate(invoice.date||invoice.created_at)).filter(Boolean).sort()[0]||'2000-01-01';
    const slimCustomer=(row:any)=>({Id:row.Id,DisplayName:row.DisplayName,CompanyName:row.CompanyName,Active:row.Active,SyncToken:row.SyncToken,SalesTermRef:row.SalesTermRef,PrimaryEmailAddr:row.PrimaryEmailAddr,BillAddr:row.BillAddr,ShipAddr:row.ShipAddr,Balance:row.Balance});
    const slimInvoice=(row:any)=>({Id:row.Id,DocNumber:row.DocNumber,CustomerRef:row.CustomerRef,TxnDate:row.TxnDate,TotalAmt:row.TotalAmt,Balance:row.Balance,SalesTermRef:row.SalesTermRef,DueDate:row.DueDate});
    const [accounts,itemResponses,preferenceResponse,terms,qboInvoices]=await Promise.all([
      qbo.queryAll('Account'),
      Promise.all(requiredItemNames.map(name=>qbo!.query(`SELECT * FROM Item WHERE Name = '${escapeQbo(name)}' MAXRESULTS 2`))),
      qbo.request('/preferences'),
      qbo.queryAll('Term'),
      qbo.queryAll('Invoice','*',1000,`TxnDate >= '${escapeQbo(invoiceFloor)}'`,slimInvoice),
    ]);
    const items=itemResponses.flatMap(response=>response?.QueryResponse?.Item||[]);
    const preferences=preferenceResponse?.Preferences;
    const partnerTaxEnabled=!!preferences?.TaxPrefs?.PartnerTaxEnabled;
    if(!partnerTaxEnabled)throw Object.assign(new Error('QBO Automated Sales Tax setting changed; invoice writes are blocked.'),{code:'tax_mode_changed'});
    const income=accountByNumber(accounts,'40000',['Income']),discount=accountByNumber(accounts,'40200',['Income']),ar=accountByNumber(accounts,'11000',['Accounts Receivable']),deposit=accountByNumber(accounts,'11010',['Other Current Asset']);
    const salesItem=itemByName(items,'NSA Portal Sales',String(income.Id));
    const taxItems=new Map<string,any>();for(const [state,number] of Object.entries({CA:'25200',AZ:'25205',CO:'25215',NV:'25220',TX:'25225',WA:'25230',WI:'25201',SD:'25201'})){
      const account=accountByNumber(accounts,number,['Other Current Liability']);
      const matches=items.filter(row=>row?.Active!==false&&clean(row.Name)===`NSA Portal Sales Tax — ${state}`);
      if(matches.length===1&&String(matches[0].IncomeAccountRef?.value)===String(account.Id))taxItems.set(state,matches[0]);
    }
    const sourceHash=await sha256({
      customers:(snapshot.customers||[]).map((row:any)=>[row.id,row.updated_at]),
      invoices:(snapshot.invoices||[]).map((row:any)=>[row.id,row.updated_at,money(row.total),money(row.paid),row.qb_invoice_id]),
      payments:(snapshot.payments||[]).map((row:any)=>[row.id,row.invoice_id,money(row.amount),row.date]),
      link_counts:{customers:Object.keys(snapshot.customer_links||{}).length,invoices:Object.keys(snapshot.invoice_links||{}).length,payments:Object.keys(snapshot.payment_links||{}).length},
    });
    add('configuration','national','preflight','verified',null,{source_hash:sourceHash,source_cutoff:cutoff,realm_id:qbo.realmId,company_name:company.CompanyName,partner_tax_enabled:partnerTaxEnabled,accounts:{income:String(income.Id),discount:String(discount.Id),ar:String(ar.Id),deposit:String(deposit.Id)},sales_item:String(salesItem.Id),oauth_refreshed:qbo.refreshed});
    await checkpoint('preflight_complete');

    // Customers: durable mappings are revalidated first. Only unmapped, unambiguous
    // rows can become link/create candidates; existing reviewed aliases are retained.
    const activeCustomers:any[]=(snapshot.customers||[]).filter((row:any)=>row.is_active!==false);
    const customerBatch:any[]=boundedWindow<any>(activeCustomers,settings,'customer');
    const needsMatchPool=customerBatch.some((row:any)=>!clean(snapshot.customer_links?.[String(row.id)]?.qbo_id));
    const qboCustomers=needsMatchPool?await qbo.queryAll('Customer','*',1000,'',slimCustomer):[];
    const qboCustomerById=new Map(qboCustomers.map((row:any)=>[String(row.Id),row])),effectiveCustomerMap=new Map<string,string>(),claimedCustomerIds=new Set<string>();
    for(const [sourceId,link] of Object.entries(snapshot.customer_links||{})){const qboId=clean((link as any)?.qbo_id);if(qboId){effectiveCustomerMap.set(String(sourceId),qboId);claimedCustomerIds.add(qboId);}}
    const customerCandidates:any[]=[];
    const activeNameCounts=new Map<string,number>();
    for(const row of activeCustomers){const key=clean(row.name).toLowerCase().replace(/[^a-z0-9]+/g,' ');if(key)activeNameCounts.set(key,(activeNameCounts.get(key)||0)+1);}
    for(const customer of customerBatch){
      counters.customers.examined++;
      const sourceId=String(customer.id),link=snapshot.customer_links?.[sourceId],mappedId=clean(link?.qbo_id);
      let mapped:any=mappedId?qboCustomerById.get(mappedId):null;
      if(mappedId&&!mapped){try{mapped=slimCustomer((await qbo.request(`/customer/${mappedId}`)).Customer);if(mapped?.Id){qboCustomerById.set(mappedId,mapped);qboCustomers.push(mapped);}}catch{/* classified below */}}
      if(mapped){
        const reviewedAlias=clean(snapshot.legacy_config?.aliases?.[sourceId])===mappedId;
        if(exactCustomerMatches(customer,[mapped]).length!==1&&!reviewedAlias){counters.customers.manual_review++;review('customer',sourceId,'mapped_customer_identity_changed',{qbo_id:mappedId});add('customer',sourceId,'revalidate','manual_review',mappedId,{reason:'mapped_customer_identity_changed'});continue;}
        effectiveCustomerMap.set(sourceId,mappedId);claimedCustomerIds.add(mappedId);counters.customers.revalidated++;continue;
      }
      if(mappedId&&!mapped){counters.customers.manual_review++;review('customer',sourceId,'mapped_customer_missing',{qbo_id:mappedId});add('customer',sourceId,'revalidate','manual_review',mappedId,{reason:'mapped_customer_missing'});continue;}
      const exact=exactCustomerMatches(customer,qboCustomers),loose=looseCustomerMatches(customer,qboCustomers);
      if(exact.length===1){
        const risks=customerIdentityRisks(customer,exact[0]);
        if(risks.length||claimedCustomerIds.has(String(exact[0].Id))){counters.customers.manual_review++;review('customer',sourceId,'existing_customer_requires_review',{qbo_id:String(exact[0].Id),risks:[...risks,...(claimedCustomerIds.has(String(exact[0].Id))?['already_claimed']:[])]});add('customer',sourceId,'classify','manual_review',String(exact[0].Id),{reason:'existing_customer_requires_review'});continue;}
        customerCandidates.push({sourceId,action:'link_existing',customer,qbo:exact[0]});claimedCustomerIds.add(String(exact[0].Id));continue;
      }
      if(exact.length>1||loose.length){counters.customers.manual_review++;review('customer',sourceId,exact.length>1?'multiple_exact_matches':'possible_name_match',{qbo_ids:(exact.length?exact:loose).map((row:any)=>String(row.Id))});add('customer',sourceId,'classify','manual_review',null,{reason:exact.length>1?'multiple_exact_matches':'possible_name_match'});continue;}
      const nameKey=clean(customer.name).toLowerCase().replace(/[^a-z0-9]+/g,' ');
      if((activeNameCounts.get(nameKey)||0)>1){counters.customers.manual_review++;review('customer',sourceId,'duplicate_portal_customer_name');add('customer',sourceId,'classify','manual_review',null,{reason:'duplicate_portal_customer_name'});continue;}
      try{customerCandidates.push({sourceId,action:'create',customer,term:resolveTerm(customer.payment_terms,terms,settings.blank_terms_default)});}
      catch(error){counters.customers.manual_review++;review('customer',sourceId,safeError(error));add('customer',sourceId,'classify','manual_review',null,{reason:safeError(error)});}
    }
    for(const candidate of customerCandidates)add('customer',candidate.sourceId,candidate.action,writeAllowed(settings,'customer',candidate.sourceId)?'queued_write':'proposed',candidate.qbo?String(candidate.qbo.Id):null,{});
    if(claim.writes_enabled){
      for(const candidate of phaseSelection(customerCandidates,settings,'customer')){
        if(!writeAllowed(settings,'customer',candidate.sourceId))continue;
        const token=crypto.randomUUID();let locked=false;
        try{
          const {data}=await admin.rpc('acquire_qbo_sales_source_claim',{p_realm_id:REALM_ID,p_source_type:'customer',p_source_id:candidate.sourceId,p_claim_token:token,p_run_id:runId,p_lease_seconds:300});
          if(data!==true)throw Object.assign(new Error('Customer source is already being processed.'),{code:'source_busy'});locked=true;
          const fresh=exactCustomerMatches(candidate.customer,await qbo.queryAll('Customer','*',1000,'',slimCustomer));
          let verified:any,result='linked';
          if(fresh.length===1)verified=(await qbo.request(`/customer/${fresh[0].Id}`)).Customer;
          else if(fresh.length>1)throw Object.assign(new Error('Customer became ambiguous before write.'),{code:'customer_ambiguous'});
          else{
            const term=candidate.term||resolveTerm(candidate.customer.payment_terms,terms,settings.blank_terms_default);
            const created=(await qbo.request('/customer',{method:'POST',body:JSON.stringify(buildCustomerPayload(candidate.customer,term))})).Customer;
            if(!created?.Id)throw new Error('QBO customer create returned no ID.');verified=(await qbo.request(`/customer/${created.Id}`)).Customer;result='created';
            if(String(verified.SalesTermRef?.value)!==String(term.value))throw new Error('QBO customer terms failed read-back.');
          }
          if(!verified||verified.Active===false||exactCustomerMatches(candidate.customer,[verified]).length!==1)throw new Error('QBO customer identity failed read-back.');
          await persistLink(admin,{realm:REALM_ID,mapKey:'custQBMap',sourceId:candidate.sourceId,qboId:String(verified.Id),evidence:{result,api_readback:true,run_id:runId}});
          effectiveCustomerMap.set(candidate.sourceId,String(verified.Id));qboCustomerById.set(String(verified.Id),verified);qboCustomers.push(verified);qboIds.customers.push(String(verified.Id));counters.customers[result==='created'?'created':'linked_existing']++;
          add('customer',candidate.sourceId,candidate.action,result,String(verified.Id),{api_readback:true});
        }catch(error){counters.customers.failed++;terminal='needs_review';review('customer',candidate.sourceId,errorCode(error));add('customer',candidate.sourceId,candidate.action,'failed',null,{error_code:errorCode(error)});}
        finally{if(locked)await ignore(admin.rpc('release_qbo_sales_source_claim',{p_realm_id:REALM_ID,p_source_type:'customer',p_source_id:candidate.sourceId,p_claim_token:token}));}
      }
    }
    await checkpoint('customers_complete');

    // Invoices: direct QBO IDs and durable receipts are both accepted mappings.
    // Every unlinked source still receives the two-form/four-field duplicate check.
    const qboInvoiceById=new Map(qboInvoices.map((row:any)=>[String(row.Id),row])),effectiveInvoiceMap=new Map<string,string>(),invoiceCandidates:any[]=[];
    const customerById=new Map((snapshot.customers||[]).map((row:any)=>[String(row.id),row]));
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'});
    for(const invoice of snapshot.invoices||[]){
      if(invoice.deleted_at)continue;counters.invoices.examined++;
      const sourceId=`portal:${invoice.id}`,durable=clean(snapshot.invoice_links?.[sourceId]?.qbo_id),mappedId=clean(invoice.qb_invoice_id)||durable;
      if(String(invoice.id)==='INV-63831'){
        counters.invoices.manual_review++;review('invoice',sourceId,'explicit_manual_block',{qbo_id:mappedId||null});
        add('invoice',sourceId,'manual_block','manual_review',mappedId||null,{reason:'explicit_manual_block'});continue;
      }
      if(mappedId){
        let existing=qboInvoiceById.get(mappedId);
        if(!existing){try{existing=slimInvoice((await qbo.request(`/invoice/${mappedId}`)).Invoice);if(existing?.Id)qboInvoiceById.set(mappedId,existing);}catch{/* classified below */}}
        if(!existing){counters.invoices.manual_review++;review('invoice',sourceId,'mapped_invoice_missing',{qbo_id:mappedId});add('invoice',sourceId,'revalidate','manual_review',mappedId,{reason:'mapped_invoice_missing'});continue;}
        effectiveInvoiceMap.set(String(invoice.id),mappedId);counters.invoices.already_linked++;continue;
      }
      const base=classifySourceInvoice(invoice,today);
      if(base.action!=='eligible'){
        const key=base.action==='excluded_zero'?'excluded_zero':base.action==='excluded_void'?'excluded_void':base.action==='held_future'?'held_future':'manual_review';counters.invoices[key]++;
        add('invoice',sourceId,'classify',base.action,null,{reason:base.reason||base.action,date:parseDate(invoice.date),total:money(invoice.total)});
        if(base.action==='manual_review')review('invoice',sourceId,base.reason||'manual_review');continue;
      }
      const customerId=String(invoice.customer_id),qboCustomerId=effectiveCustomerMap.get(customerId);
      if(!qboCustomerId){counters.invoices.manual_review++;review('invoice',sourceId,'customer_not_verified',{customer_id:customerId});add('invoice',sourceId,'classify','manual_review',null,{reason:'customer_not_verified'});continue;}
      let plan:any=null,taxItem:any=null;
      try{plan=taxPlan(invoice,customerById.get(customerId),partnerTaxEnabled);if(plan){taxItem=taxItems.get(plan.state);if(!taxItem)throw new Error('tax_item_missing');}}
      catch(error){counters.invoices.manual_review++;review('invoice',sourceId,safeError(error));add('invoice',sourceId,'classify','manual_review',null,{reason:safeError(error)});continue;}
      const duplicate=classifyInvoiceDuplicate({documentNumber:invoice.id,qboCustomerId,date:base.date,total:base.total},qboInvoices);
      if(duplicate.disposition==='manual_review'){counters.invoices.manual_review++;review('invoice',sourceId,'invoice_number_conflict',{conflicts:duplicate.conflicts});add('invoice',sourceId,'duplicate_check','manual_review',null,{conflicts:duplicate.conflicts});continue;}
      invoiceCandidates.push({sourceId,invoice,date:base.date,total:base.total,qboCustomerId,plan,taxItem,duplicate});
      add('invoice',sourceId,duplicate.disposition,writeAllowed(settings,'invoice',sourceId)?'queued_write':'proposed',duplicate.qboId||null,{date:base.date,total:base.total,customer_id:qboCustomerId});
    }
    if(claim.writes_enabled){
      let stopInvoices=false;
      for(const candidate of phaseSelection(invoiceCandidates,settings,'invoice')){
        if(stopInvoices||!writeAllowed(settings,'invoice',candidate.sourceId))continue;
        const token=crypto.randomUUID();let locked=false;
        try{
          const {data}=await admin.rpc('acquire_qbo_invoice_sync_claim',{p_realm_id:REALM_ID,p_source_invoice_id:candidate.sourceId,p_claim_token:token,p_lease_seconds:300});
          if(data!==true)throw Object.assign(new Error('Invoice source is already being processed.'),{code:'source_busy'});locked=true;
          const forms=invoiceNumberForms(candidate.invoice.id),freshRows=(await qbo.query(`SELECT * FROM Invoice WHERE DocNumber IN (${forms.map((x:string)=>`'${escapeQbo(x)}'`).join(',')}) MAXRESULTS 10`))?.QueryResponse?.Invoice||[];
          const fresh=classifyInvoiceDuplicate({documentNumber:candidate.invoice.id,qboCustomerId:candidate.qboCustomerId,date:candidate.date,total:candidate.total},freshRows);
          if(fresh.disposition==='manual_review')throw Object.assign(new Error('Invoice identity became ambiguous before write.'),{code:'invoice_conflict'});
          let verified:any,result='linked';
          if(fresh.disposition==='link_existing')verified=(await qbo.request(`/invoice/${fresh.qboId}`)).Invoice;
          else{
            const qboCustomer=(await qbo.request(`/customer/${candidate.qboCustomerId}`)).Customer;
            if(!qboCustomer?.SalesTermRef?.value)throw new Error('QBO customer has no verified payment terms.');
            const dueDate=standardDueDate(candidate.date,qboCustomer.SalesTermRef?.name);
            const so=snapshot.sales_orders?.[candidate.invoice.so_id];
            const description=`Invoice ${candidate.invoice.id}${candidate.invoice.so_id?` for ${candidate.invoice.so_id}`:''}${so?.memo?` — ${so.memo}`:''}`;
            const lines=buildInvoiceLines({invoice:candidate.invoice,description,salesItemId:String(salesItem.Id),taxItemId:candidate.taxItem?String(candidate.taxItem.Id):null,plan:candidate.plan,discountAccountId:String(discount.Id)});
            const payload:any={DocNumber:candidate.invoice.id,TxnDate:candidate.date,CustomerRef:{value:String(candidate.qboCustomerId)},ARAccountRef:{value:String(ar.Id)},SalesTermRef:qboCustomer.SalesTermRef,Line:lines,...(dueDate?{DueDate:dueDate}:{}),...(candidate.plan?{TxnTaxDetail:{TotalTax:0}}:{})};
            const created=(await qbo.request('/invoice',{method:'POST',body:JSON.stringify(payload)})).Invoice;if(!created?.Id)throw new Error('QBO invoice create returned no ID.');
            verified=(await qbo.request(`/invoice/${created.Id}`)).Invoice;result='created';
          }
          const identity=classifyInvoiceDuplicate({documentNumber:candidate.invoice.id,qboCustomerId:candidate.qboCustomerId,date:candidate.date,total:candidate.total},[verified]);
          if(identity.disposition!=='link_existing'||!Number.isFinite(Number(verified.Balance))||Number(verified.Balance)<-.005||Number(verified.Balance)>Number(verified.TotalAmt)+.005)throw new Error('QBO invoice failed identity or balance read-back.');
          if(candidate.plan){const taxLine=(verified.Line||[]).find((line:any)=>line.DetailType==='SalesItemLineDetail'&&String(line.SalesItemLineDetail?.ItemRef?.value)===String(candidate.taxItem.Id));if(!taxLine||money(taxLine.Amount)!==money(candidate.plan.tax)||money(verified.TxnTaxDetail?.TotalTax)!==0)throw new Error('QBO invoice failed tax read-back.');}
          await persistLink(admin,{realm:REALM_ID,mapKey:'qbInvoiceMap',sourceId:candidate.sourceId,qboId:String(verified.Id),evidence:{result,api_readback:true,duplicate_preflight:'normalized_number_customer_date_cents',run_id:runId,date:candidate.date,total:candidate.total}});
          const update=await admin.from('invoices').update({qb_invoice_id:String(verified.Id)}).eq('id',candidate.invoice.id).is('qb_invoice_id',null).select('id');
          if(update.error)throw new Error('Portal invoice link update failed after QBO read-back.');
          effectiveInvoiceMap.set(String(candidate.invoice.id),String(verified.Id));qboInvoiceById.set(String(verified.Id),verified);qboInvoices.push(verified);qboIds.invoices.push(String(verified.Id));counters.invoices[result==='created'?'created':'exact_existing']++;
          add('invoice',candidate.sourceId,candidate.duplicate.disposition,result,String(verified.Id),{api_readback:true,balance:money(verified.Balance),tax_total:money(verified.TxnTaxDetail?.TotalTax)});
        }catch(error){counters.invoices.failed++;terminal='needs_review';stopInvoices=true;review('invoice',candidate.sourceId,errorCode(error));add('invoice',candidate.sourceId,'write','failed',null,{error_code:errorCode(error)});}
        finally{if(locked)await ignore(admin.rpc('release_qbo_invoice_sync_claim',{p_realm_id:REALM_ID,p_source_invoice_id:candidate.sourceId,p_claim_token:token}));}
      }
    }
    await checkpoint('invoices_complete');

    // Payments: source payment IDs are immutable. Existing QBO applications are
    // subtracted before any write, then the invoice and customer payments are
    // re-read inside the per-source lease immediately before posting.
    const sourcePaymentsByInvoice=new Map<string,any[]>();for(const payment of snapshot.payments||[]){const id=String(payment.invoice_id);sourcePaymentsByInvoice.set(id,[...(sourcePaymentsByInvoice.get(id)||[]),payment]);}
    const paymentCandidates:any[]=[];
    for(const invoice of snapshot.invoices||[]){
      if(invoice.deleted_at||clean(invoice.status).toLowerCase()==='void'||String(invoice.id)==='INV-63831')continue;
      const sourceRows=sourcePaymentsByInvoice.get(String(invoice.id))||[];if(!sourceRows.length&&money(invoice.paid)<=0)continue;
      const qboInvoiceId=effectiveInvoiceMap.get(String(invoice.id))||clean(invoice.qb_invoice_id);if(!qboInvoiceId){if(money(invoice.paid)>0){counters.payments.manual_review++;review('payment',`invoice:${invoice.id}`,'verified_invoice_missing');}continue;}
      const qboInvoice=qboInvoiceById.get(String(qboInvoiceId));if(!qboInvoice)continue;
      const qboPaid=money(Number(qboInvoice.TotalAmt)-Number(qboInvoice.Balance));
      if(!sourceRows.length){counters.payments.examined++;if(qboPaid>=money(invoice.paid)-.005){counters.payments.already_reflected++;add('payment',`invoice:${invoice.id}`,'reconcile','already_reflected',null,{portal_paid:money(invoice.paid),qbo_paid:qboPaid,source:'historical_invoice_total'});}else{counters.payments.manual_review++;review('payment',`invoice:${invoice.id}`,'missing_immutable_payment_source',{portal_paid:money(invoice.paid),qbo_paid:qboPaid});}continue;}
      const sourceTotal=money(sourceRows.reduce((sum:number,row:any)=>sum+money(row.amount),0));
      if(sourceTotal!==money(invoice.paid)){counters.payments.manual_review++;review('payment',`invoice:${invoice.id}`,'portal_payment_total_mismatch',{invoice_paid:money(invoice.paid),payment_rows_total:sourceTotal});add('payment',`invoice:${invoice.id}`,'reconcile','manual_review',null,{reason:'portal_payment_total_mismatch'});continue;}
      if(qboPaid>money(invoice.paid)+.005){counters.payments.manual_review++;review('payment',`invoice:${invoice.id}`,'qbo_paid_exceeds_portal',{portal_paid:money(invoice.paid),qbo_paid:qboPaid});continue;}
      const allocated=allocateUnreflectedPayments(sourceRows,qboPaid);
      for(const row of allocated){counters.payments.examined++;const sourceId=paymentIdentity(row);
        if(snapshot.payment_links?.[sourceId]?.qbo_id){counters.payments.already_reflected++;continue;}
        if(!parseDate(row.date)){counters.payments.manual_review++;review('payment',sourceId,'invalid_payment_date');add('payment',sourceId,'classify','manual_review',null,{reason:'invalid_payment_date'});continue;}
        if(row.coveredAmount>0&&row.remainingAmount>0){counters.payments.manual_review++;review('payment',sourceId,'partially_reflected_source_payment',{source_amount:row.sourceAmount,qbo_amount_already_reflected:row.coveredAmount,unreflected_amount:row.remainingAmount});add('payment',sourceId,'reconcile','manual_review',null,{reason:'partially_reflected_source_payment'});continue;}
        if(!(row.remainingAmount>0)){counters.payments.already_reflected++;add('payment',sourceId,'reconcile','already_reflected',null,{qbo_paid:qboPaid});continue;}
        const ref=paymentReference(row);
        paymentCandidates.push({sourceId,row,invoice,qboInvoiceId,qboInvoice,qboCustomerId:String(qboInvoice.CustomerRef?.value),amount:money(row.remainingAmount),ref});
        add('payment',sourceId,'create_or_link',writeAllowed(settings,'payment',sourceId)?'queued_write':'proposed',null,{invoice_id:String(invoice.id),amount:money(row.remainingAmount),date:parseDate(row.date)});
      }
    }
    if(claim.writes_enabled){
      for(const candidate of phaseSelection(paymentCandidates,settings,'payment')){
        if(!writeAllowed(settings,'payment',candidate.sourceId))continue;
        const token=crypto.randomUUID();let locked=false;
        try{
          const {data}=await admin.rpc('acquire_qbo_sales_source_claim',{p_realm_id:REALM_ID,p_source_type:'payment',p_source_id:candidate.sourceId,p_claim_token:token,p_run_id:runId,p_lease_seconds:300});if(data!==true)throw Object.assign(new Error('Payment source is already being processed.'),{code:'source_busy'});locked=true;
          const currentInvoice=(await qbo.request(`/invoice/${candidate.qboInvoiceId}`)).Invoice;if(!currentInvoice)throw new Error('QBO invoice missing before payment write.');
          const currentPayments=(await qbo.query(`SELECT * FROM Payment WHERE CustomerRef = '${escapeQbo(candidate.qboCustomerId)}' MAXRESULTS 1000`))?.QueryResponse?.Payment||[];
          const sameRef=currentPayments.filter((p:any)=>clean(p.PaymentRefNum)===candidate.ref);let verified:any,result='linked';
          if(sameRef.length){if(sameRef.length!==1)throw Object.assign(new Error('Payment reference is ambiguous.'),{code:'payment_reference_conflict'});verified=(await qbo.request(`/payment/${sameRef[0].Id}`)).Payment;}
          else{
            const already=money(qboPaymentApplications(currentPayments,candidate.qboInvoiceId).reduce((sum:number,row:any)=>sum+row.amount,0));
            const needed=money(money(candidate.invoice.paid)-already),balance=money(currentInvoice.Balance);
            if(candidate.amount>needed+.005||candidate.amount>balance+.005)throw Object.assign(new Error('Source payment exceeds the verified unapplied amount or current invoice balance.'),{code:'payment_amount_conflict'});
            const send=candidate.amount;
            if(!(send>0)){counters.payments.already_reflected++;continue;}
            const payload={CustomerRef:{value:candidate.qboCustomerId},DepositToAccountRef:{value:String(deposit.Id)},TotalAmt:send,TxnDate:parseDate(candidate.row.date),PaymentRefNum:candidate.ref,PrivateNote:`Portal payment ${candidate.row.id} for ${candidate.invoice.id}`,Line:[{Amount:send,LinkedTxn:[{TxnId:String(candidate.qboInvoiceId),TxnType:'Invoice'}]}]};
            const created=(await qbo.request('/payment',{method:'POST',body:JSON.stringify(payload)})).Payment;if(!created?.Id)throw new Error('QBO payment create returned no ID.');verified=(await qbo.request(`/payment/${created.Id}`)).Payment;result='created';
            if(send<balance)counters.payments.partial++;
          }
          if(!verified||String(verified.CustomerRef?.value)!==candidate.qboCustomerId||money(verified.TotalAmt)!==candidate.amount||parseDate(verified.TxnDate)!==parseDate(candidate.row.date)||String(verified.DepositToAccountRef?.value)!==String(deposit.Id)||!qboPaymentApplications([verified],candidate.qboInvoiceId).length)throw new Error('QBO payment failed read-back.');
          await persistLink(admin,{realm:REALM_ID,mapKey:'qbPaymentMap',sourceId:candidate.sourceId,qboId:String(verified.Id),evidence:{result,api_readback:true,run_id:runId,invoice_id:String(candidate.invoice.id),qbo_invoice_id:String(candidate.qboInvoiceId),amount:money(verified.TotalAmt),date:parseDate(verified.TxnDate),deposit_account:String(deposit.Id)}});
          qboIds.payments.push(String(verified.Id));counters.payments[result==='created'?'created':'already_reflected']++;add('payment',candidate.sourceId,result==='linked'?'link_existing':'create',result,String(verified.Id),{api_readback:true,amount:money(verified.TotalAmt),date:parseDate(verified.TxnDate),deposit_account:String(deposit.Id)});
        }catch(error){counters.payments.failed++;terminal='needs_review';review('payment',candidate.sourceId,errorCode(error));add('payment',candidate.sourceId,'write','failed',null,{error_code:errorCode(error)});}
        finally{if(locked)await ignore(admin.rpc('release_qbo_sales_source_claim',{p_realm_id:REALM_ID,p_source_type:'payment',p_source_id:candidate.sourceId,p_claim_token:token}));}
      }
    }

    // A distinct postflight query proves the new records are visible through QBO's
    // read path after all writes; per-record read-backs above remain the stronger
    // identity/accounting verification.
    await checkpoint('payments_complete');
    const [postInvoices,postPayments]=await Promise.all([
      Promise.all(qboIds.invoices.map(async(id:string)=>(await qbo!.request(`/invoice/${id}`)).Invoice)),
      Promise.all(qboIds.payments.map(async(id:string)=>(await qbo!.request(`/payment/${id}`)).Payment)),
    ]);
    const postInvoiceIds=new Set(postInvoices.map((row:any)=>String(row.Id))),postPaymentIds=new Set(postPayments.map((row:any)=>String(row.Id)));
    const missingInvoiceIds=qboIds.invoices.filter((id:string)=>!postInvoiceIds.has(id)),missingPaymentIds=qboIds.payments.filter((id:string)=>!postPaymentIds.has(id));
    if(missingInvoiceIds.length||missingPaymentIds.length)throw Object.assign(new Error('QBO postflight could not find every verified sales write.'),{code:'postflight_readback_failed'});
    add('configuration','national','postflight','verified',null,{invoice_ids_verified:qboIds.invoices.length,payment_ids_verified:qboIds.payments.length});

    if(reviews.length)terminal='needs_review';
    for(const row of reviews){
      const {data:existing,error:readError}=await admin.from('qbo_sales_manual_reviews').select('id').eq('company_key','national').eq('entity_type',row.entity_type).eq('source_id',row.source_id).eq('reason_code',row.reason_code).maybeSingle();
      if(readError)throw Object.assign(new Error('Manual-review evidence could not be read.'),{code:'review_save_failed'});
      const write=existing
        ?await admin.from('qbo_sales_manual_reviews').update({status:'open',evidence:row.evidence,last_seen_run_id:runId,last_seen_at:row.last_seen_at,resolved_at:null,resolved_by:null,resolution_note:null}).eq('id',existing.id)
        :await admin.from('qbo_sales_manual_reviews').insert(row);
      if(write.error)throw Object.assign(new Error('Manual-review evidence could not be saved.'),{code:'review_save_failed'});
    }
    const resolvedAt=new Date().toISOString();
    const {error:resolvedSalesError}=await admin.from('qbo_sales_manual_reviews').update({status:'resolved',resolved_at:resolvedAt,resolved_by:'qbo-sales-background',resolution_note:'Condition cleared on a later full read-only evaluation.'}).eq('company_key','national').eq('status','open').in('entity_type',['invoice','payment']).neq('last_seen_run_id',runId);
    if(resolvedSalesError)throw Object.assign(new Error('Cleared sales reviews could not be resolved.'),{code:'review_save_failed'});
    const batchCustomerIds=customerBatch.map((row:any)=>String(row.id));
    if(batchCustomerIds.length){const {error}=await admin.from('qbo_sales_manual_reviews').update({status:'resolved',resolved_at:resolvedAt,resolved_by:'qbo-sales-background',resolution_note:'Condition cleared when this customer mapping was revalidated.'}).eq('company_key','national').eq('status','open').eq('entity_type','customer').in('source_id',batchCustomerIds).neq('last_seen_run_id',runId);if(error)throw Object.assign(new Error('Cleared customer reviews could not be resolved.'),{code:'review_save_failed'});}
    if(manifest.length){const {error}=await admin.from('qbo_sales_run_manifest').insert(manifest);if(error)throw Object.assign(new Error('Run manifest could not be saved.'),{code:'manifest_save_failed'});}
    const cursor={...(settings.continuation_cursor||{}),customer_offset:(Number(settings.continuation_cursor?.customer_offset)||0)+Number(settings.customer_batch_limit||0),invoice_offset:(Number(settings.continuation_cursor?.invoice_offset)||0)+Number(settings.invoice_batch_limit||0),payment_offset:(Number(settings.continuation_cursor?.payment_offset)||0)+Number(settings.payment_batch_limit||0)};
    const summary={mode:claim.writes_enabled?'write':'read_only',phase:settings.phase,source_hash:manifest[0]?.evidence?.source_hash,company:company.CompanyName,realm_id:qbo.realmId,proposed:{customers:customerCandidates.length,invoices:invoiceCandidates.length,payments:paymentCandidates.length},manual_reviews:reviews.length,postflight_verified:'qbo_requery'};
    const {data:finished,error:finishError}=await admin.rpc('finish_qbo_sales_run',{p_run_id:runId,p_lease_token:leaseToken,p_status:terminal,p_counters:counters,p_qbo_ids:qboIds,p_summary:summary,p_continuation_cursor:cursor,p_error_code:null,p_error_message:null});
    if(finishError||finished!==true)throw new Error('Durable QBO sales run could not be finalized.');
    return{ok:true,started:true,run_id:runId,status:terminal,counters,summary};
  }catch(error){
    failureCode=errorCode(error);failureMessage=safeError(error);
    if(manifest.length)await ignore(admin.from('qbo_sales_run_manifest').insert(manifest));
    await ignore(admin.rpc('finish_qbo_sales_run',{p_run_id:runId,p_lease_token:leaseToken,p_status:'failed',p_counters:counters,p_qbo_ids:qboIds,p_summary:{phase:settings?.phase||claim.phase},p_continuation_cursor:settings?.continuation_cursor||{},p_error_code:failureCode,p_error_message:failureMessage}));
    return{ok:false,started:true,run_id:runId,status:'failed',error_code:failureCode};
  }
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  const admin=createAdmin(),actor=await authorize(req,admin);if(!actor)return json({ok:false,error:'Unauthorized'},401);
  try{
    if(req.method==='GET')return json({ok:true,...await status(admin)});
    if(req.method!=='POST')return json({ok:false,error:'POST only'},405);
    const body=await req.json().catch(()=>({}));
    if(body.trigger==='scheduled'){
      if(!actor.service)return json({ok:false,error:'Scheduled invocation requires service authentication.'},403);
      return json(await runSales(admin,{trigger:'scheduled'}));
    }
    if(body.action==='status')return json({ok:true,...await status(admin)});
    if(body.action==='kill_switch'){
      const enabled=body.enabled===true;const {error}=await admin.from('qbo_sales_settings').update({kill_switch:enabled,updated_at:new Date().toISOString(),updated_by:actor.userId}).eq('company_key','national');
      if(error)throw new Error('Kill switch could not be updated.');return json({ok:true,kill_switch:enabled});
    }
    if(body.action==='preflight')return json(await runSales(admin,{trigger:'manual',forceReadOnly:true}));
    if(body.action==='run')return json(await runSales(admin,{trigger:'manual'}));
    return json({ok:false,error:'Unknown action'},400);
  }catch(error){return json({ok:false,error:safeError(error),error_code:errorCode(error)},500);}
});
