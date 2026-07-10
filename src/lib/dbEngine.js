/* eslint-disable */
// ═══════════════════════════════════════════════════════════════════════
// PERSISTENCE / SYNC ENGINE — extracted verbatim from src/App.js
// (decomposition step 1; see FABLE_SYSTEM_AUDIT_2026-07-03.md).
//
// This is the app's load / diff / save / auth-recovery machinery: the
// Supabase client + circuit breaker, _dbLoad/_dbSeed, the diff engine that
// suppresses no-op writes, optimistic-version conflict healing (including
// the art-file field-level merge), the queued per-entity save pipeline,
// the failed-save ledger, and the localStorage cache budget.
//
// The move is BYTE-IDENTICAL to the code that lived in App.js — only the
// imports above the body, the setter shims, and the export list at the
// bottom are new. Behavior contracts are pinned by
// src/__tests__/dbEngine.characterization.test.js.
// ═══════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { makeBreakerFetch } from './requestBreaker';
import { _sbAuthLock } from './supabase';
import { _pick, _estCols, _soCols, _itemCols, _decoCols, _itemExtraCols, _soExtraCols, _decoExtraCols, _sanitizeDeco, _msgCols, _msgExtraCols, _artCols, _artExtraCols, _loadArtRow, _jobExtraCols, _jobCols, _custCols, _vendCols, _firmDateCols, _omgStoreCols } from '../constants';
import { itemEditReconciles, itemsWithWipedQty } from '../businessLogic';
import { authFetch } from '../utils';

// ─── Supabase Setup ───
const _sbUrl = process.env.REACT_APP_SUPABASE_URL || '';
const _sbKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
let supabase = null;

// Global request circuit breaker (see ./lib/requestBreaker): short-circuits any /rest/v1 endpoint
// a render/effect bug puts into a runaway loop, so a stale tab can never flood the DB again.
const _breakerFetch = makeBreakerFetch({ label: 'circuit-breaker' });

// Auth lock: shares the per-tab in-memory mutex from ./lib/supabase so this
// client and the lib client (same Supabase storage key) serialize auth ops
// through ONE lock, instead of contending on the cross-tab Navigator
// LockManager that deadlocks/times out token refresh when many tabs are open.
try {
  if (_sbUrl && _sbKey && _sbUrl.startsWith('https://') && !_sbUrl.includes('your-project')) {
    supabase = createClient(_sbUrl, _sbKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        lock: _sbAuthLock,
      },
      global: { fetch: _breakerFetch },
    });
  }
}
catch(e) { console.warn('[Supabase] Init failed:', e.message); }

// Inserts a row into scheduled_emails. The cron-driven Edge Function picks
// it up at send_at and POSTs to Brevo. Used for things like "invoice email
// scheduled for the delivery date" — Brevo's native scheduledAt only allows
// 72 hours, so we hold longer-horizon sends ourselves.
const scheduleEmailSend = async (payload) => {
  if (!supabase) return { ok: false, error: 'No DB connection' };
  try {
    const { data, error } = await supabase.from('scheduled_emails').insert(payload).select('id').single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
// Track tables that returned 404 so we skip them on future polls (avoids console spam)
// Uses timestamps so entries expire after 5 minutes and are retried (prevents permanent data loss from transient 404s)
const _missing404Tables=new Map();// table → timestamp
const _MISSING_TABLE_TTL=5*60*1000;// 5 minutes
// Track which tables timed out during the most recent _dbLoad — cleared at start of each load
const _lastLoadTimedOut=new Set();
// Tables whose paged fetch hit the hardLimit row cap with more rows still on the server.
// Anything aggregating over these arrays (Reports especially) is silently missing rows and
// must warn the user. Set/cleared per table on each fetch so partial reloads self-correct.
const _truncatedTables=new Set();
// Sticky per-entity hydration: ids of SOs/estimates whose items loaded cleanly at least once this
// session. A later flaky/timed-out refresh keeps the in-memory items but can flip the per-load
// _itemsHydrated flag to false; the save guards also honor this set so a legitimate edit/addition on a
// once-loaded order isn't blocked. Entities that genuinely never loaded their items stay out of the set
// and remain protected. Cleared only on full session reload (module reload).
const _everHydratedItems=new Set();
let _fetchErrorLoggedAt=0;// throttle fetch error logging to once per 30s
// app_state keys that are large and applied ONLY on the initial load — the poll/realtime reload
// handlers never read them, so routine reloads exclude them rather than drag ~1.1 MB of JSON
// (so_history 662kB + est_history 371kB + qb_config 82kB + …) on every fetch.
const _APPSTATE_INIT_ONLY_KEYS=['so_history','est_history','qb_config','change_log','wh_recent_actions','job_time_logs'];
// Momentec (v8), S&S Activewear (v4), and SanMar (v3) are large API-sourced ("drop-ship") catalogs:
// server-side Netlify sync functions keep their rows in the DB products table for order history and
// server-side search, but at ~41k rows they pushed the in-memory `prod` array past the 20k load cap
// (hiding later-alphabet SKUs like JY6033 from client-side search) and bloated the Products page. We
// exclude them from the LOCAL catalog load only — the rows stay in the DB untouched (no delete path
// exists), line items carry their own sku/name/color snapshots, and the PO modal + global search query
// these vendors server-side. Null-vendor products (Artwork, Wilson balls) are explicitly preserved.
const API_CATALOG_VENDOR_IDS=['v8','v4','v3'];
const _API_CATALOG_VENDOR_OR='vendor_id.is.null,vendor_id.not.in.('+API_CATALOG_VENDOR_IDS.join(',')+')';
// Catalog-load column allowlist: every products column EXCEPT description / description_ai. Those two
// text columns are ~51% of the row width (483B + 257B of ~1460B) yet are never read off the in-memory
// `prod` catalog — the storefront product pages fetch their own rows (PROD_SELECT) and the client save
// path (_dbSaveProduct, ~line 2242) writes an explicit column set that already omits them, so trimming
// the load here can neither break a read nor null a description on write-back. This roughly halves the
// heaviest recurring query (the full-catalog products fetch, historically ~58% of DB CPU) on heap
// fetches, JSON serialization and transfer. Keep this list in sync with the products table columns.
const _CATALOG_PROD_COLS='id,vendor_id,sku,name,brand,color,category,retail_price,nsa_cost,is_active,available_sizes,_colors,created_at,updated_at,image_front_url,image_back_url,color_category,is_archived,is_clearance,clearance_cost,size_costs,pricing_group,bin,catalog_sell_price,inventory_source,is_featured,description_ai_at';
const _safeQuery=(table,opts)=>{
  const cachedAt=_missing404Tables.get(table);
  if(cachedAt&&(Date.now()-cachedAt)<_MISSING_TABLE_TTL)return Promise.resolve({data:[],error:null,status:200});
  if(cachedAt)_missing404Tables.delete(table);// expired — retry
  const hardLimit=opts?.limit||20000;// safety cap to avoid runaway paging
  const pageSize=1000;// PostgREST default max-rows; requesting more is silently capped
  // Paged fetch: .range(start, end) repeatedly until the last chunk returns fewer than pageSize
  // rows (meaning we're done) or we hit hardLimit. Fixes missing rows when tables exceed 1000.
  const fetchPage=(start)=>{
    let q=supabase.from(table).select(opts?.select||'*');
    if(opts?.not)for(const[c,o,v]of opts.not)q=q.not(c,o,v);// raw PostgREST not.<op>.<val> filters
    if(opts?.or)q=q.or(opts.or);// raw PostgREST or=(cond,cond,…) filter — applied to every page
    if(opts?.order)q=q.order(opts.order,opts.orderOpts||{});
    return q.range(start,start+pageSize-1);
  };
  const _classifyPage=(r)=>{
    if(r.status===404||(r.error?.message||'').includes('does not exist')||(r.error?.code==='PGRST204'))return'missing';
    // RLS/grant denial (Postgres 42501): the table is intentionally unreadable for this role — e.g.
    // `messages` after migration 00162 revoked anon access. Empty is the authoritative view for this
    // role, NOT a load failure: the anonymous coach portal (?portal=) boots through _dbLoad, and a
    // fatal error here blanked the whole load and broke every portal link. Matched narrowly by code/
    // message (not HTTP 401) so expired-JWT errors still reach _isAuthError → _recoverSession.
    if(r.error?.code==='42501'||(r.error?.message||'').includes('permission denied'))return'denied';
    if(r.error)return'error';
    return'ok';
  };
  const pagedFetch=async()=>{
    // Fetch page 0 first — most tables fit in one page, and it tells us whether to keep going.
    const first=await fetchPage(0);
    const c0=_classifyPage(first);
    if(c0==='missing'){_missing404Tables.set(table,Date.now());return{data:[],error:null,status:200};}
    // Not cached in _missing404Tables: after a staff login the same table becomes readable, and the
    // next poll should pick it up immediately rather than after the missing-table TTL.
    if(c0==='denied'){console.warn('[DB] '+table+' not readable by current role (permission denied) — treating as empty');return{data:[],error:null,status:200};}
    if(c0==='error'){
      // Partial/incomplete load: a page failed. Treat it exactly like a timeout — mark the table
      // untrusted so reloads SKIP applying it (poll/realtime both bail on _decoTimedOut) and hydration
      // flags turn false, so a half-loaded result can never overwrite real child rows in state or DB.
      // (Source of the stale item-less estimate copies behind the 2026-05-29 wipe.)
      _lastLoadTimedOut.add(table);return first;
    }
    const all=(first.data||[]).slice();
    if(all.length<pageSize){_truncatedTables.delete(table);return{data:all,error:null,status:200};}
    // Larger table: fetch the remaining pages in bounded-concurrency WAVES rather than one sequential
    // round-trip per 1000 rows. First-open paged ~20 (products) / ~10 (app_state) / ~9 (history) pages
    // one at a time — a network round-trip each — which dominated the ~16s load. Pages stay correctly
    // ordered because each is a fixed .range() slice of the same ordered query.
    const WAVE=5;
    let start=pageSize,done=false;
    while(!done&&start<hardLimit){
      const starts=[];
      for(let k=0;k<WAVE&&start<hardLimit;k++,start+=pageSize)starts.push(start);
      const results=await Promise.all(starts.map(s=>fetchPage(s)));
      for(const r of results){
        const c=_classifyPage(r);
        if(c==='missing'||c==='denied'){done=true;break;}// table vanished / access revoked mid-page (unlikely) — stop, keep what we have
        if(c==='error'){_lastLoadTimedOut.add(table);return r;}
        const rows=r.data||[];
        all.push(...rows);
        if(rows.length<pageSize)done=true;// reached the final (short) page
      }
    }
    // Exiting with pages still full means the server has rows beyond hardLimit — flag it.
    if(!done){_truncatedTables.add(table);console.warn('[DB] '+table+' hit the '+hardLimit+'-row cap — loaded data is INCOMPLETE (oldest rows dropped for date-ordered tables)');}
    else _truncatedTables.delete(table);
    return{data:all,error:null,status:200};
  };
  // Add per-query timeout to prevent individual queries from hanging forever
  const timeout=new Promise(resolve=>setTimeout(()=>resolve({data:[],error:{message:'Query timeout for '+table},status:408}),20000));
  return Promise.race([pagedFetch(),timeout]).then(r=>{
    if(r.status===408){_lastLoadTimedOut.add(table);return{data:[],error:null,status:408}}
    return r;
  }).catch(e=>{
    // Catch network/CORS/fetch errors — log at most once per 30s to avoid console spam
    const now=Date.now();
    if(now-_fetchErrorLoggedAt>30000){_fetchErrorLoggedAt=now;console.warn('[DB] Fetch error ('+table+'):',e.message||e)}
    _lastLoadTimedOut.add(table);
    return{data:[],error:{message:e.message||'Fetch failed'},status:0};
  });
};

// ─── Server-side product search (paginated, leverages DB trigram indexes) ───
const _searchProductsServer=async(query,filters={},page=0,pageSize=50)=>{
  if(!supabase)return{products:[],total:0};
  try{
    const{data,error}=await supabase.rpc('search_products',{
      p_query:query||null,
      p_category:filters.cat||null,
      p_vendor_id:filters.vnd||null,
      p_color_category:filters.clr||null,
      p_in_stock:filters.stk==='instock',
      p_limit:pageSize,
      p_offset:page*pageSize
    });
    if(error){console.warn('[DB] search_products RPC failed, falling back to client-side:',error.message);return null}
    const total=data?.[0]?.total_count||0;
    return{products:data||[],total};
  }catch(e){console.warn('[DB] search_products RPC error:',e.message);return null}
};

// ─── Server-side customer search (paginated, leverages DB trigram indexes) ───
const _searchCustomersServer=async(query,repId,page=0,pageSize=50)=>{
  if(!supabase)return null;
  try{
    const{data,error}=await supabase.rpc('search_customers',{
      p_query:query||null,
      p_rep_id:repId||null,
      p_active_only:true,
      p_limit:pageSize,
      p_offset:page*pageSize
    });
    if(error){console.warn('[DB] search_customers RPC failed, falling back to client-side:',error.message);return null}
    const total=data?.[0]?.total_count||0;
    return{customers:data||[],total};
  }catch(e){console.warn('[DB] search_customers RPC error:',e.message);return null}
};

// ─── Supabase Auth helpers ───
const _sbSignIn=async(email,password)=>{
  if(!supabase)return{error:'Supabase not configured'};
  const{data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error)return{error:error.message};
  _sessionDead=false;// a fresh sign-in un-latches the dead-session gate so queued saves resume
  return{user:data.user,session:data.session};
};
const _sbSignUp=async(email,password)=>{
  if(!supabase)return{error:'Supabase not configured'};
  const{data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}});
  if(error)return{error:error.message};
  return{user:data.user};
};
const _sbResendSignup=async(email)=>{
  if(!supabase)return{error:'Supabase not configured'};
  const{error}=await supabase.auth.resend({type:'signup',email,options:{emailRedirectTo:window.location.origin}});
  if(error)return{error:error.message};
  return{success:true};
};
const _sbResetPassword=async(email)=>{
  if(!supabase)return{error:'Supabase not configured'};
  const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/auth/reset'});
  if(error)return{error:error.message};
  return{success:true};
};
const _sbSignOut=async()=>{if(supabase)await supabase.auth.signOut()};
const _sbGetSession=async()=>{
  if(!supabase)return null;
  const{data}=await supabase.auth.getSession();
  return data?.session||null;
};
const _sbLinkTeamAuth=async(teamId,authId)=>{
  if(!supabase)return;
  await supabase.rpc('link_team_auth',{p_team_id:teamId,p_auth_id:authId});
};
const _sbGetMyProfile=async()=>{
  if(!supabase)return null;
  const{data}=await supabase.rpc('get_my_profile');
  return data?.[0]||null;
};
const _dbLoad = async (opts={}) => {
  const {coreOnly=false, histInvoices=false, only=null, fullState=false, essential=false} = opts;
  if (!supabase) return null;
  if (_dbSavingCount>0) { console.log('[DB] Skipping load — save in progress'); return null; }
  try {
    _lastLoadTimedOut.clear();
    // Load tables in batches to avoid overwhelming Supabase connection pool
    const _batch=async(queries,size=5)=>{const results=[];for(let i=0;i<queries.length;i+=size){results.push(...await Promise.all(queries.slice(i,i+size).map(q=>q())));} return results};
    // When coreOnly, skip slow-changing tables (team, vendors, omg, issues, deco, promo, etc.)
    // They'll be loaded on full polls every 5 minutes and via realtime reloadAll()
    const _skip=()=>Promise.resolve({data:[],error:null,status:200});
    // Selective reload: when `only` (a Set of entity-group names) is given, fetch just those
    // groups — a realtime products change shouldn't re-download estimates, SOs, invoices, etc.
    // A group bundles a parent with every child table _dbLoad joins into it, so partial loads
    // always carry full child parity (otherwise snapshots would mis-diff and trigger re-saves).
    const _grp=(g,q,cold)=>()=>{if(only)return only.has(g)?q():_skip();if(cold&&coreOnly)return _skip();return q()};
    const _cold=q=>()=>(coreOnly||only)?_skip():q();
    // Mirror of the _grp('products',…,true) gate: products are (re)built on initial + full polls + a
    // products-realtime reload, but NOT on coreOnly polls or non-products selective reloads. Drives
    // whether app_state needs to carry the _pimg_ image-fallback rows below.
    const _productsLoading=essential?false:(only?only.has('products'):!coreOnly);
    const [rTeam,rCust,rContacts,rVend,rProd,rProdInv,rEst,rEstArt,rEstItems,rEstDecos,
      rSO,rSOArt,rSOFirm,rSOItems,rSODecos,rSOPicks,rSOPOs,rSOJobs,
      rInv,rInvPay,rInvItems,rMsg,rMsgReads,rOMG,rOMGProd,rIssues,rAppState,
      rPromoProg,rPromoPeriods,rPromoUsage,rCredits,rCreditUsage,
      rPendingShip,rPendingShipUsage,
      rRepCsr,rAssignedTodos,rTodoComments,
      rDecoVendors,rDecoVendorPricing,
      rQuoteReqs,rQuoteReqItems,
      rDismissedTodos,rDismissedNotifs,
      rHistInvs] = await _batch([
      _cold(()=>_safeQuery('team_members',{order:'name'})),
      // customers (+ its contacts/promo/credit children) are COLD for the same reason as products:
      // slow-changing, and the customers realtime channel + ~10-min full poll keep them fresh.
      // Parent and ALL children share the cold flag so a coreOnly load skips them together (group
      // parity); setCust below is .length-guarded and the snapshot is preserved on coreOnly so an
      // empty skip can never wipe customer state or the _diffSave baseline.
      _grp('customers',()=>_safeQuery('customers',{order:'name'}),true),
      _grp('customers',()=>_safeQuery('customer_contacts'),true),
      _cold(()=>_safeQuery('vendors',{order:'name'})),
      // products + product_inventory are COLD: a 17k-row catalog that changes only via the daily
      // vendor syncs. Realtime (products channel) + the ~10-min full poll keep them fresh; re-pulling
      // all ~18 pages every 60s was ~58% of DB CPU. Safe because the setters are .length-guarded
      // (poll 4180, realtime 4031) and the poll snapshot is preserved on coreOnly (see prod: below),
      // so a skipped coreOnly load can never empty state or the _diffSave baseline.
      // essential (tier-1 homepage) load skips the heavy ~47k catalog + its inventory; they stream in
      // via a tier-2 background load right after first paint (see the init effect). Realtime/poll keep
      // them fresh as before.
      essential?_skip:_grp('products',()=>_safeQuery('products',{order:'name',or:_API_CATALOG_VENDOR_OR,select:_CATALOG_PROD_COLS}),true),
      essential?_skip:_grp('products',()=>_safeQuery('product_inventory'),true),
      _grp('estimates',()=>_safeQuery('estimates',{order:'id'})),
      _grp('estimates',()=>_safeQuery('estimate_art_files')),
      _grp('estimates',()=>_safeQuery('estimate_items',{order:'item_index'})),
      _grp('estimates',()=>_safeQuery('estimate_item_decorations',{order:'deco_index'})),
      _grp('sales_orders',()=>_safeQuery('sales_orders',{order:'id'})),
      _grp('sales_orders',()=>_safeQuery('so_art_files')),
      _grp('sales_orders',()=>_safeQuery('so_firm_dates')),
      _grp('sales_orders',()=>_safeQuery('so_items',{order:'item_index'})),
      _grp('sales_orders',()=>_safeQuery('so_item_decorations',{order:'deco_index'})),
      _grp('sales_orders',()=>_safeQuery('so_item_pick_lines')),
      _grp('sales_orders',()=>_safeQuery('so_item_po_lines')),
      _grp('sales_orders',()=>_safeQuery('so_jobs')),
      _grp('invoices',()=>_safeQuery('invoices',{order:'id'})),
      _grp('invoices',()=>_safeQuery('invoice_payments')),
      _grp('invoices',()=>_safeQuery('invoice_items')),
      _grp('messages',()=>_safeQuery('messages',{order:'id'})),
      _grp('messages',()=>_safeQuery('message_reads')),
      _cold(()=>_safeQuery('omg_stores',{order:'id'})),
      _cold(()=>_safeQuery('omg_store_products')),
      _cold(()=>_safeQuery('issues')),
      // app_state rides along with products: product image fallbacks (_pimg_) live here, and the
      // products snapshot must include them or every image-only product would mis-diff and re-save.
      // A full SELECT * here was ~1.66 MB/call (~14% of DB CPU). Routine poll/realtime reloads apply
      // only 6 small keys (inv_pos, inv_adj_log, inv_po_counter, submitted_batches, batch_pos,
      // company_info), so fetch the whole table ONLY on the initial load (fullState); otherwise drop
      // the init-only history/config blobs, and drop the _pimg_ rows too unless products are being
      // (re)built this load (they feed product image fallbacks and nothing else).
      ()=>{
        if(only&&!only.has('products')&&!only.has('app_state'))return _skip();
        if(fullState&&!essential)return _safeQuery('app_state');// full incl _pimg_ (non-essential initial load)
        // essential tier-1 load keeps the init-only config blobs but drops the ~10k _pimg_ image rows
        // (those ride with products in tier 2); routine reloads drop the init-only blobs too.
        const not=[];
        if(!fullState)not.push(['id','in','('+_APPSTATE_INIT_ONLY_KEYS.map(k=>'"'+k+'"').join(',')+')']);
        if(!_productsLoading)not.push(['id','like','_pimg_*']);
        return _safeQuery('app_state',not.length?{not}:undefined);
      },
      _grp('customers',()=>_safeQuery('customer_promo_programs'),true),
      _grp('customers',()=>_safeQuery('customer_promo_periods'),true),
      _grp('customers',()=>_safeQuery('customer_promo_usage'),true),
      _grp('customers',()=>_safeQuery('customer_credits'),true),
      _grp('customers',()=>_safeQuery('customer_credit_usage'),true),
      _grp('customers',()=>_safeQuery('customer_pending_shipping'),true),
      _grp('customers',()=>_safeQuery('customer_pending_shipping_usage'),true),
      _cold(()=>_safeQuery('rep_csr_assignments')),
      _grp('assigned_todos',()=>_safeQuery('assigned_todos'),true),
      _grp('assigned_todos',()=>_safeQuery('todo_comments'),true),
      _cold(()=>_safeQuery('deco_vendors',{order:'name'})),
      _cold(()=>_safeQuery('deco_vendor_pricing')),
      _cold(()=>_safeQuery('quote_requests',{order:'created_at',orderOpts:{ascending:false}})),
      _cold(()=>_safeQuery('quote_request_items',{order:'sort_order'})),
      _cold(()=>_safeQuery('dismissed_todos')),
      _cold(()=>_safeQuery('dismissed_notifs')),
      // NetSuite invoice history — read-only sales record separate from portal 'invoices'. This can be ~20k rows;
      // only fetch it when explicitly requested (initial load). Polls and realtime reloads never applied it to
      // state (setHistInvs runs only on initial load), so fetching it there was wasted DB load.
      ()=>histInvoices?_safeQuery('customer_invoices',{order:'invoice_date',orderOpts:{ascending:false},limit:20000}):_skip(),
    ]);
    // Check for critical errors on core tables only (child tables may not exist yet — 404 is OK)
    const coreResults=[{n:'team_members',r:rTeam},{n:'customers',r:rCust},{n:'vendors',r:rVend},{n:'products',r:rProd},{n:'estimates',r:rEst},{n:'sales_orders',r:rSO},{n:'invoices',r:rInv},{n:'messages',r:rMsg},{n:'omg_stores',r:rOMG}];
    const is404=r=>r.status===404||(r.error?.message||'').includes('does not exist')||(r.error?.code==='PGRST204');
    const errs=coreResults.filter(({r})=>r.error&&!is404(r)&&r.status!==0);
    const fetchErrs=coreResults.filter(({r})=>r.status===0);// network/CORS failures already logged by _safeQuery
    if(errs.length){console.error('[DB] Load errors:',errs.map(({n,r})=>`${n}: ${r.error.message}`));if(errs.some(({r})=>_isAuthError(r.error)))_recoverSession();return null}
    if(fetchErrs.length&&!errs.length){return null}// silently return null — _safeQuery already logged the fetch error
    // Helper: return data or empty array (safe for 404 / missing tables)
    const d=r=>r.data||[];
    const team=d(rTeam);const custRaw=d(rCust);const contacts=d(rContacts);
    const vendors=d(rVend);const prodRaw=d(rProd);const prodInv=d(rProdInv);
    const estRaw=d(rEst);const estArt=d(rEstArt);const estItems=d(rEstItems);const estDecos=d(rEstDecos);
    const soRaw=d(rSO);const soArt=d(rSOArt);const soFirm=d(rSOFirm);
    const soItems=d(rSOItems);const soDecos=d(rSODecos);const soPicks=d(rSOPicks);const soPOs=d(rSOPOs);const soJobs=d(rSOJobs);
    const invRaw=d(rInv);const invPay=d(rInvPay);const invItems=d(rInvItems);
    const msgRaw=d(rMsg);const msgReads=d(rMsgReads);
    const omgRaw=d(rOMG);const omgProd=d(rOMGProd);
    const issues=d(rIssues);
    // Promo data
    const promoPrograms=d(rPromoProg);const promoPeriods=d(rPromoPeriods);const promoUsage=d(rPromoUsage);
    const creditRecords=d(rCredits);const creditUsageRecords=d(rCreditUsage);
    const pendingShipRecords=d(rPendingShip);const pendingShipUsageRecords=d(rPendingShipUsage);
    // Quote requests: attach items
    const quoteReqRaw=d(rQuoteReqs);const quoteReqItemsRaw=d(rQuoteReqItems);
    const quote_requests=quoteReqRaw.map(qr=>({...qr,items:quoteReqItemsRaw.filter(i=>i.quote_request_id===qr.id).sort((a,b)=>a.sort_order-b.sort_order)}));
    const repCsrAssignments=d(rRepCsr);const assignedTodos=d(rAssignedTodos).map(t=>({...t,comments:d(rTodoComments).filter(c=>c.todo_id===t.id).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at))}));
    const decoVendors=d(rDecoVendors);const decoVendorPricing=d(rDecoVendorPricing);
    // Parse app_state key-value pairs
    const appStateRaw=d(rAppState);
    const appState={};appStateRaw.forEach(r=>{try{appState[r.id]=JSON.parse(r.value)}catch{appState[r.id]=r.value}
      // Track each row's CAS version + exact server value string (migration 00181) for
      // _saveAppStateCAS. version is undefined until the migration lands — treated as 0.
      if(!r.id.startsWith('_pimg_'))_appStateVersions[r.id]={v:r.version||0,s:r.value};});
    // ─── Reconstruct nested objects ───
    // Product image backups from app_state (reliable fallback when image columns are missing)
    const _pimgMap={};appStateRaw.filter(r=>r.id.startsWith('_pimg_')).forEach(r=>{try{_pimgMap[r.id.slice(6)]=JSON.parse(r.value)}catch{}});
    // Customers: attach contacts array
    // Promo $ is stored on the parent customer; subs inherit so promos can be viewed/applied from any account in the family.
    const customers=custRaw.map(c=>{const promoOwnerId=c.parent_id||c.id;const ownerPeriods=promoPeriods.filter(pp=>pp.customer_id===promoOwnerId);return{...c,contacts:contacts.filter(ct=>ct.customer_id===c.id).sort((a,b)=>a.sort_order-b.sort_order).map(ct=>({name:ct.name,email:ct.email,phone:ct.phone,role:ct.role})),
      promo_programs:promoPrograms.filter(pp=>pp.customer_id===promoOwnerId),
      promo_periods:ownerPeriods,
      promo_usage:promoUsage.filter(pu=>ownerPeriods.some(pp=>pp.id===pu.period_id)),
      credits:creditRecords.filter(cr=>cr.customer_id===c.id),
      credit_usage:creditUsageRecords.filter(cu2=>creditRecords.filter(cr=>cr.customer_id===c.id).some(cr=>cr.id===cu2.credit_id)),
      pending_shipping:pendingShipRecords.filter(ps=>ps.customer_id===c.id),
      pending_shipping_usage:pendingShipUsageRecords.filter(pu=>pendingShipRecords.filter(ps=>ps.customer_id===c.id).some(ps=>ps.id===pu.pending_id))}});
    // Products: attach _inv and _alerts from product_inventory
    const products=prodRaw.map(p=>{const invRows=prodInv.filter(pi=>pi.product_id===p.id);const _inv={};const _alerts={};invRows.forEach(r=>{_inv[r.size]=r.quantity;if(r.alert_threshold)_alerts[r.size]=r.alert_threshold});const _pimg=_pimgMap[p.id];return{...p,image_url:p.image_url||p.image_front_url||(_pimg&&_pimg.front)||'',back_image_url:p.back_image_url||p.image_back_url||(_pimg&&_pimg.back)||'',images:p.images||(_pimg&&_pimg.gallery)||[],_sizeCosts:(p.size_costs&&Object.keys(p.size_costs).length)?p.size_costs:undefined,_inv,_alerts}});
    // Estimates: attach items (with decorations) and art_files
    const estimates=estRaw.map(est=>{
      const art_files=estArt.filter(a=>a.estimate_id===est.id).map(_loadArtRow);
      // Dedup orphaned duplicate estimate_items sharing an item_index. These arise when an "insert-new-then-delete-old"
      // save swap was interrupted after the new rows were inserted but before the old ones were deleted — leaving
      // phantom rows with duplicate item_indexes. Keep, per item_index, the row with the most decorations (the real
      // one; newest id breaks ties).
      const _estItemsRaw=estItems.filter(i=>i.estimate_id===est.id);
      const _itemChildCount=it=>estDecos.filter(d=>d.estimate_item_id===it.id).length;
      const _itemByIdx=new Map();
      _estItemsRaw.forEach(it=>{const cur=_itemByIdx.get(it.item_index);if(!cur){_itemByIdx.set(it.item_index,it);return}const a=_itemChildCount(it),b=_itemChildCount(cur);if(a>b||(a===b&&it.id>cur.id))_itemByIdx.set(it.item_index,it)});
      const items=[..._itemByIdx.values()].sort((a,b)=>a.item_index-b.item_index).map(item=>{
        const decorations=estDecos.filter(d=>d.estimate_item_id===item.id).sort((a,b)=>a.deco_index-b.deco_index).map(d=>{const{id:_,estimate_item_id:__,deco_index:___,...rest}=d;if(!rest.art_file_id&&rest.art_tbd_type)rest.art_file_id='__tbd';return rest});
        const{id:_,estimate_id:__,item_index:___,...rest}=item;return{...rest,decorations}});
      // _itemsHydrated: true only when estimate_items loaded cleanly this session. Lets save guards tell a
      // deliberate rep deletion (hydrated→empty) apart from items vanishing on a timed-out load (never hydrated).
      const _estItemsHydrated=!_lastLoadTimedOut.has('estimate_items');if(_estItemsHydrated)_everHydratedItems.add(est.id);
      return{...est,items,art_files,_itemsHydrated:_estItemsHydrated,_decosHydrated:!_lastLoadTimedOut.has('estimate_item_decorations')&&!_lastLoadTimedOut.has('estimate_items'),_artHydrated:!_lastLoadTimedOut.has('estimate_art_files'),_hydratedArtIds:art_files.map(a=>a.id).filter(Boolean)}});
    // Sales Orders: attach items (with decorations, pick_lines, po_lines), art_files, firm_dates, jobs
    const sales_orders=soRaw.map(so=>{
      // Recycled-number carry-over guard: a reused SO id can inherit jobs/art from the order that
      // previously held it (e.g. after a purge/re-import). Such children were created before this SO's
      // row existed, so a job whose created_at predates the SO's created_at (24h margin to absorb clock
      // skew) is stale carry-over — drop it from state so it can't surface on the art dashboard / order
      // or get re-saved. Drop an art file too when it's referenced only by such carry-over jobs and by no
      // live decoration. Fail safe (keep) whenever a date is missing/unparseable.
      const _soCreatedMs=(()=>{const t=Date.parse(so.created_at);return Number.isNaN(t)?null:t})();
      const _isCarryJob=ca=>{if(_soCreatedMs==null)return false;const t=Date.parse(ca);if(Number.isNaN(t))return false;return t<_soCreatedMs-864e5;};
      const _myItemIds=new Set(soItems.filter(i=>i.so_id===so.id).map(i=>i.id));
      const _liveArtIds=new Set(soDecos.filter(d=>_myItemIds.has(d.so_item_id)&&d.art_file_id).map(d=>d.art_file_id));
      const _rawJobs=soJobs.filter(j=>j.so_id===so.id);
      const _carryArtIds=new Set();
      _rawJobs.forEach(j=>{if(_isCarryJob(j.created_at))(Array.isArray(j._art_ids)&&j._art_ids.length?j._art_ids:[j.art_file_id]).forEach(aid=>{if(aid)_carryArtIds.add(aid)})});
      // All DB art rows for this SO (before carry-over filtering). Kept as _hydratedArtIds so a
      // later save can delete rows we hid at load — otherwise filtered carry-over art stays in
      // so_art_files forever because the delete guard only removes ids the client "knew about".
      const _rawSoArt=soArt.filter(a=>a.so_id===so.id);
      const art_files=_rawSoArt.filter(a=>{
        if(_liveArtIds.has(a.id))return true;// still wired to a live decoration — keep
        if(_carryArtIds.has(a.id))return false;// only referenced by carry-over jobs
        // Recycled-number art can also sit under this so_id with a job minted AFTER the new SO
        // (SO-1057: JOB-1057-01 on 6/29 against March football art). Drop only when the file is
        // archived AND its upload predates the SO by >24h — archived avoids wiping intentional
        // estimate→SO library art that hasn't been wired to a decoration yet.
        if(a.archived&&_soCreatedMs!=null){
          const ut=Date.parse(a.uploaded);if(!Number.isNaN(ut)&&ut<_soCreatedMs-864e5)return false;
        }
        return true;
      }).map(_loadArtRow);
      const firm_dates=soFirm.filter(f=>f.so_id===so.id).map(f=>({item_desc:f.item_desc,date:f.date,approved:f.approved}));
      // Keep dead frozen jobs in the loaded payload so OrderEditor.syncJobs can see them, retire
      // them (no live decorations), and persist jobs:[] — which now deletes so_jobs rows. Filtering
      // them out here would hide the UI symptom without ever writing the delete.
      const jobs=_rawJobs.filter(j=>!_isCarryJob(j.created_at)).map(j=>{const{so_id:_,...rest}=j;return rest});
      // Dedup orphaned duplicate so_items sharing an item_index. These arise when an "insert-new-then-delete-old"
      // save swap was interrupted after the child (deco/pick) deletes but before the parent so_items delete — leaving
      // an empty phantom row alongside the real one. If both reach the client the phantom can land at the canonical
      // index and trip the per-item decoration safety guard ("had N decos in DB but client has 0"), blocking every
      // subsequent save. Keep, per item_index, the row carrying the most children (the real one; newest id breaks ties).
      const _soItemsRaw=soItems.filter(i=>i.so_id===so.id);
      const _itemChildCount=it=>soDecos.filter(d=>d.so_item_id===it.id).length+soPicks.filter(p=>p.so_item_id===it.id).length+soPOs.filter(p=>p.so_item_id===it.id).length;
      const _itemByIdx=new Map();
      _soItemsRaw.forEach(it=>{const cur=_itemByIdx.get(it.item_index);if(!cur){_itemByIdx.set(it.item_index,it);return}const a=_itemChildCount(it),b=_itemChildCount(cur);if(a>b||(a===b&&it.id>cur.id))_itemByIdx.set(it.item_index,it)});
      const items=[..._itemByIdx.values()].sort((a,b)=>a.item_index-b.item_index).map(item=>{
        const decorations=soDecos.filter(d=>d.so_item_id===item.id).sort((a,b)=>a.deco_index-b.deco_index).map(d=>{const{id:_,so_item_id:__,deco_index:___,...rest}=d;if(!rest.art_file_id&&rest.art_tbd_type)rest.art_file_id='__tbd';return rest});
        const pick_lines=soPicks.filter(pk=>pk.so_item_id===item.id).map(pk=>{const{id:_,so_item_id:__,...rest}=pk;const sizes=rest.sizes||{};delete rest.sizes;return{...rest,...sizes}});
        const po_lines=soPOs.filter(po=>po.so_item_id===item.id).map(po=>{const{id:_,so_item_id:__,...rest}=po;const sizes=rest.sizes||{};delete rest.sizes;
          // Recover billed/tracking_numbers from sizes JSONB if they were stored as fallback
          const recovered={...rest,...sizes};
          if(sizes._billed&&!recovered.billed){recovered.billed=sizes._billed;delete recovered._billed}
          if(sizes._tracking_numbers&&!recovered.tracking_numbers){recovered.tracking_numbers=sizes._tracking_numbers;delete recovered._tracking_numbers}
          return recovered});
        const{id:_,so_id:__,item_index:___,...rest}=item;return{...rest,decorations,pick_lines,po_lines}});
      // _itemsHydrated: true only when so_items loaded cleanly this session. Save guards use it to distinguish a
      // deliberate rep deletion (hydrated→empty) from items vanishing on a timed-out load (never hydrated).
      // _hydratedPoIds: the set of PO ids present when this SO loaded cleanly. The save uses it to tell a deliberate
      // PO deletion (loaded then removed) from a PO that simply never reached this client (stale/foreign state).
      const _hydratedPoIds=[...new Set(items.flatMap(it=>(it.po_lines||[]).map(p=>p.po_id).filter(Boolean)))];
      // _hydratedPickIds: same idea for pick lines, keyed by pick_id.
      const _hydratedPickIds=[...new Set(items.flatMap(it=>(it.pick_lines||[]).map(p=>p.pick_id).filter(Boolean)))];
      const _soItemsHydrated=!_lastLoadTimedOut.has('so_items');if(_soItemsHydrated)_everHydratedItems.add(so.id);
      const _decosHydrated=!_lastLoadTimedOut.has('so_item_decorations')&&!_lastLoadTimedOut.has('so_items');
      return{...so,items,art_files,firm_dates,jobs,_itemsHydrated:_soItemsHydrated,_decosHydrated,_artHydrated:!_lastLoadTimedOut.has('so_art_files'),_jobsHydrated:!_lastLoadTimedOut.has('so_jobs'),_posHydrated:!_lastLoadTimedOut.has('so_item_po_lines')&&!_lastLoadTimedOut.has('so_items'),_hydratedPoIds,_picksHydrated:!_lastLoadTimedOut.has('so_item_pick_lines')&&!_lastLoadTimedOut.has('so_items'),_hydratedPickIds,_hydratedArtIds:_rawSoArt.map(a=>a.id).filter(Boolean)}});
    // Invoices: attach payments and items
    const invoices=invRaw.map(inv=>{
      const payments=invPay.filter(p=>p.invoice_id===inv.id).map(p=>({amount:p.amount,method:p.method,ref:p.ref,date:p.date}));
      const items=invItems.filter(i=>i.invoice_id===inv.id).map(i=>({sku:i.sku,name:i.name,qty:i.qty,unit_price:i.unit_price,total:i.total,description:i.description}));
      // Hydration flags so the save can tell a deliberate removal from items/payments that simply never loaded
      // (a timed-out invoice_items / invoice_payments query). _hydratedPayRefs lets payments be restore-merged by ref.
      const _hydratedPayRefs=[...new Set(payments.map(p=>p.ref).filter(Boolean))];
      return{...inv,payments,items:items.length?items:undefined,_itemsHydrated:!_lastLoadTimedOut.has('invoice_items'),_paymentsHydrated:!_lastLoadTimedOut.has('invoice_payments'),_hydratedPayRefs}});
    // NetSuite historical invoices — read-only; reshape invoice_date → date and tag as historical.
    const hist_invoices=d(rHistInvs).map(hi=>({
      id:hi.document_number||hi.id,
      _hist_id:hi.id,
      customer_id:hi.customer_id,
      date:hi.invoice_date,
      total:hi.total!=null?Number(hi.total):null,
      memo:hi.memo||'',
      status:hi.status||'paid',
      type:'invoice',
      _hist:true,
      netsuite_internal_id:hi.netsuite_internal_id,
      document_number:hi.document_number,
      subsidiary:hi.subsidiary,
      rep_name:hi.rep_name,
      subtotal:hi.subtotal!=null?Number(hi.subtotal):null,
      tax:hi.tax!=null?Number(hi.tax):null,
      raw_customer_nsid:hi.raw_customer_nsid,
      raw_customer_name:hi.raw_customer_name,
      invoice_type:hi.type,
    }));
    // Messages: attach read_by array and parse tagged_members
    const messages=msgRaw.map(m=>{const tm=m.tagged_members;const mapped={...m,text:m.body||m.text,ts:m.created_at||m.ts};delete mapped.body;return{...mapped,read_by:msgReads.filter(r=>r.message_id===m.id).map(r=>r.user_id),tagged_members:Array.isArray(tm)?tm:(typeof tm==='string'?(() => {try{return JSON.parse(tm)}catch{return[]}})():[])}});
    // OMG Stores: attach products
    const omg_stores=omgRaw.map(s=>({...s,products:omgProd.filter(p=>p.store_id===s.id).map(p=>{const noDeco=p.deco_type==='no_deco';const dt=noDeco?[]:(p.deco_type||'').split('|').filter(Boolean);const ag=(p.art_group||'').split('|');const ci=(p.art_cust_ids||'').split('|');const decorations=dt.map((t,i)=>({type:t,art_group:ag[i]||'',...(ci[i]?{_cust_art_id:ci[i]}:{})}));return{sku:p.sku,name:p.name,color:p.color,retail:p.retail,cost:p.cost,deco_type:p.deco_type||'',deco_cost:p.deco_cost||0,sizes:p.sizes||{},image_url:p.image_url||'',manufacturer:p.manufacturer||'',_cost_source:p._cost_source||'',vendor_id:p.vendor_id||'',art_group:p.art_group||'',decorations,no_deco:noDeco,art_ready:!!p.art_ready,_artwork:p._artwork||[]}})}));
    // Selective loads may not include customers/sales_orders — judge by whatever was fetched
    const hasData=only?[customers,sales_orders,products,estimates,invoices,messages,assignedTodos].some(a=>a.length>0):((customers.length>0)||(sales_orders.length>0));
    const dismissedTodosDb=d(rDismissedTodos);const dismissedNotifsDb=d(rDismissedNotifs);
    // True if any SO/estimate child-row query timed out — used to skip polls and warn on initial load
    // so transient empty results don't pollute client state and trigger destructive saves
    // so_item_pick_lines / so_item_po_lines MUST be included: a timeout on either loads SOs with empty pick_lines/
    // po_lines, and if the poll/realtime reload doesn't bail here it overwrites the snapshot with un-hydrated SOs,
    // diffing every SO as "changed" → a mass background re-save whose stale (childless) payloads trip the per-SO
    // restore guard and fire one data-loss alert per SO (the 2026-06-30 ~340-email storm).
    const _decoTimedOut=_lastLoadTimedOut.has('estimate_item_decorations')||_lastLoadTimedOut.has('so_item_decorations')||_lastLoadTimedOut.has('so_items')||_lastLoadTimedOut.has('estimate_items')||_lastLoadTimedOut.has('so_jobs')||_lastLoadTimedOut.has('so_art_files')||_lastLoadTimedOut.has('estimate_art_files')||_lastLoadTimedOut.has('so_item_pick_lines')||_lastLoadTimedOut.has('so_item_po_lines');
    return{team,customers,vendors,products,estimates,sales_orders,invoices,hist_invoices,messages,omg_stores,issues,appState,hasData,repCsrAssignments,assignedTodos,decoVendors,decoVendorPricing,quote_requests,dismissedTodosDb,dismissedNotifsDb,_decoTimedOut,_coreOnly:coreOnly};
  }catch(e){console.error('[DB] Load failed:',e);return null}
};
const _dbSeed = async (d) => {
  if (!supabase) return;
  // Seed core tables — team_members MUST succeed first (customers FK to team_members)
  const teamIds=new Set((d.team||[]).map(t=>t.id));
  if(d.team?.length){const{error:tErr}=await supabase.from('team_members').upsert(d.team.map(t=>({id:t.id,name:t.name,role:t.role,email:t.email,phone:t.phone,is_active:t.is_active!==false,access:t.access||null})),{onConflict:'id'});if(tErr)console.error('[DB] seed team_members:',tErr.message)}
  if(d.vendors?.length){const{error:vErr}=await supabase.from('vendors').upsert(d.vendors.map(v=>_pick(v,_vendCols)),{onConflict:'id'});if(vErr)console.error('[DB] seed vendors:',vErr.message)}
  // Customers + contacts — use _pick to strip unknown cols, null out invalid FKs
  const custIds=new Set((d.customers||[]).map(c=>c.id));
  if(d.customers?.length){
    const custRows=d.customers.map(c=>{const clean=_pick(c,_custCols);if(clean.primary_rep_id&&!teamIds.has(clean.primary_rep_id))clean.primary_rep_id=null;if(clean.parent_id&&!custIds.has(clean.parent_id))clean.parent_id=null;return clean});
    // Insert parent-less customers first, then those with parent_id (to satisfy FK)
    const noParent=custRows.filter(c=>!c.parent_id);const withParent=custRows.filter(c=>c.parent_id);
    if(noParent.length){const{error:cErr}=await supabase.from('customers').upsert(noParent,{onConflict:'id'});if(cErr)console.error('[DB] seed customers:',cErr.message)}
    if(withParent.length){const{error:cErr}=await supabase.from('customers').upsert(withParent,{onConflict:'id'});if(cErr)console.error('[DB] seed customers (parents):',cErr.message)}
    const allContacts=[];d.customers.forEach(c=>(c.contacts||[]).forEach((ct,i)=>allContacts.push({customer_id:c.id,name:ct.name,email:ct.email,phone:ct.phone,role:ct.role,sort_order:i})));
    if(allContacts.length){const{error:ctErr}=await supabase.from('customer_contacts').insert(allContacts);if(ctErr)console.error('[DB] seed contacts:',ctErr.message)}
  }
  // Products + inventory — strip extra fields
  if(d.products?.length){
    await supabase.from('products').upsert(d.products.map(p=>{const{_inv,_alerts,_colors,vendor_id,...rest}=p;return{...rest,vendor_id:vendor_id||null,_colors:_colors||null}}),{onConflict:'id'});
    const allInv=[];d.products.forEach(p=>{const inv=p._inv||{};const alerts=p._alerts||{};const allSizes=new Set([...Object.keys(inv),...Object.keys(alerts)]);allSizes.forEach(sz=>allInv.push({product_id:p.id,size:sz,quantity:inv[sz]||0,alert_threshold:alerts[sz]||null}))});
    if(allInv.length) await supabase.from('product_inventory').upsert(allInv,{onConflict:'product_id,size'});
  }
  // Seed estimates (decompose nested items/decorations)
  for(const est of(d.estimates||[])){await _dbSaveEstimate(est)}
  // Seed sales orders (decompose nested items/decorations/picks/pos/jobs)
  for(const so of(d.sales_orders||[])){await _dbSaveSO(so)}
  // Seed invoices (decompose payments)
  for(const inv of(d.invoices||[])){await _dbSaveInvoice(inv)}
  // Seed messages
  if(d.messages?.length){
    await supabase.from('messages').upsert(d.messages.map(m=>{const r=_pick(m,_msgCols);const core={};Object.keys(r).forEach(k=>{if(!_msgExtraCols.has(k))core[k]=r[k]});return core}),{onConflict:'id'});
    // Try saving extra columns (tagged_members, entity fields) — silently fail if columns don't exist
    const extras=d.messages.map(m=>{const r=_pick(m,_msgCols);const ex={id:m.id};_msgExtraCols.forEach(k=>{if(k in r&&r[k]!=null)ex[k]=r[k]});return ex}).filter(e=>Object.keys(e).length>1);
    if(extras.length)await supabase.from('messages').upsert(extras,{onConflict:'id'}).then(r=>{if(r.error)console.warn('[DB] message extras skipped:',r.error.message)});
    const reads=[];d.messages.forEach(m=>(m.read_by||[]).forEach(uid=>reads.push({message_id:m.id,user_id:uid})));
    if(reads.length) await supabase.from('message_reads').upsert(reads,{onConflict:'message_id,user_id'});
  }
  // Seed OMG stores
  if(d.omg_stores?.length){
    await supabase.from('omg_stores').upsert(d.omg_stores.map(s=>_pick(s,_omgStoreCols)),{onConflict:'id'});
    const allProds=[];d.omg_stores.forEach(s=>(s.products||[]).forEach(p=>allProds.push({store_id:s.id,sku:p.sku,name:p.name,color:p.color,retail:p.retail,cost:p.cost,deco_type:p.deco_type,deco_cost:p.deco_cost,sizes:p.sizes,image_url:p.image_url||'',manufacturer:p.manufacturer||'',art_ready:!!p.art_ready,art_cust_ids:(p.decorations||[]).map(d=>d._cust_art_id||'').join('|')})));
    if(allProds.length) await supabase.from('omg_store_products').upsert(allProds,{onConflict:'store_id,sku'}).then(r=>{if(r.error)console.warn('[DB] omg products seed failed (no unique store_id,sku constraint in DB):',r.error.message)});
  }
};
// ─── Auth error guard — set true when a 401/RLS error is detected; stops the
// _diffSave retry loop that would otherwise flood Supabase with failed writes.
let _authErrorDetected=false;
// ─── Optimistic Locking: version conflict detection ───
let _bgSync=0;// background-save depth counter (was a boolean). _diffSave runs from four independent effects
// (ests/sos/invs/msgs); with a single boolean, one batch finishing flipped it back to false while a sibling
// batch was still saving — defeating the item-shrink guards and letting stale/empty saves wipe DB rows.
// A counter stays truthy until ALL in-flight background batches finish. Truthy when >0, falsy at 0, so the
// existing `if(_bgSync...)` / `if(!_bgSync...)` boolean reads continue to work unchanged.
const _diffSaveSkipLogged=new Set();// rate-limit "skipped" warnings to once per snapKey per session
// Strip server-managed fields from diff comparison — _version and updated_at are bumped by the DB on
// every save, so including them causes a phantom save loop: save → version bump → realtime delivers
// new version → _diffSave sees version change → saves again → repeat indefinitely.
const _diffCmp=(o)=>{const{_version,updated_at,...r}=o;return JSON.stringify(r)};
// Phantom-save guard for estimates: compare ONLY the fields save_estimate actually persists.
// Estimates carry session-only data that is recomputed on every reload and never saved —
// per-size _sizeCosts/_sizeSells (from vendor-pricing hooks), _colorImage, _ss_live, plus the
// DB-managed nested _version on art rows. The whole-object _diffCmp counted those as "changes",
// so each reload re-derived them and re-saved the estimate → a multi-tab save_estimate
// version-conflict storm. Mirror the save's projection so only real, persistable changes write.
const _estDiffCmp=(e)=>JSON.stringify({
  ..._pick(e,_estCols),
  items:(e.items||[]).map(it=>({..._pick(it,_itemCols),decorations:(it.decorations||[]).map(d=>_pick(_sanitizeDeco(d),_decoCols))})),
  art_files:(e.art_files||[]).map(a=>_pick(a,_artCols)),
});
// Phantom-save guard for sales orders — DELIBERATELY CONSERVATIVE because the SO save is the most
// data-loss-sensitive path in the app. It differs from _diffCmp ONLY by stripping, from each line
// item, the scalar fields that are NOT in _itemCols — i.e. exactly the fields the SO save itself
// discards (_pick(itemData,_itemCols) in _dbSaveSOInner). Those fields (recomputed-every-load
// _sizeCosts/_sizeSells/_colorImage/etc.) can never be persisted, so dropping them from change-
// detection can never hide a savable change → zero data-loss risk by construction. EVERYTHING else —
// all SO-level fields, jobs, art_files, firm_dates, and each item's decorations/pick_lines/po_lines —
// is still compared WHOLE, exactly as before. Only the per-item session scalars (the storm trigger)
// stop counting as changes.
const _soItemForDiff=(it)=>({..._pick(it,_itemCols),decorations:it.decorations,pick_lines:it.pick_lines,po_lines:it.po_lines});
const _soDiffCmp=(s)=>{const{_version,updated_at,...r}=s;if(Array.isArray(r.items))r.items=r.items.map(_soItemForDiff);return JSON.stringify(r)};
// Phantom-save guard for products: compare ONLY what _dbSaveProduct actually persists — the products
// row, the _pimg_ image backup (front/back/gallery), and product_inventory (_inv/_alerts). It mirrors
// the save exactly, INCLUDING the image_url->image_front_url fold, so it detects a change iff the save
// would write a difference (zero data-loss), while the session-only fields re-derived on every load
// (_colorImage/_colorBackImage/_ss_live/_sizeCosts/_sizeSells and raw image_url mirrors) no longer count
// as changes. This stops the products re-save loop — the ~340k single-row product upserts + paired
// _pimg_ app_state writes that dominated write volume (and WAL) once the catalog grew 4x.
const _prodDiffCmp=(p)=>JSON.stringify({
  id:p.id,vendor_id:p.vendor_id||null,sku:p.sku,name:p.name,brand:p.brand||null,color:p.color||null,
  color_category:p.color_category||null,category:p.category||null,retail_price:p.retail_price||0,nsa_cost:p.nsa_cost||0,
  is_active:p.is_active!==false,is_archived:p.is_archived||false,available_sizes:p.available_sizes||[],_colors:p._colors||null,
  is_clearance:p.is_clearance||false,clearance_cost:p.clearance_cost!=null?p.clearance_cost:null,bin:p.bin||null,
  image_front_url:p.image_url||p.image_front_url||null,image_back_url:p.back_image_url||p.image_back_url||null,
  images:p.images||null,_inv:p._inv||{},_alerts:p._alerts||{},
});
const _checkVersion=async(table,id,localVersion)=>{
  if(!supabase||!localVersion)return true;// skip check if no version tracked
  // Skip version check for records this client recently saved (prevents false conflicts from own realtime echo)
  if(_dbRecentSaves[id]&&Date.now()-_dbRecentSaves[id]<60000)return true;
  try{
    const{data}=await supabase.from(table).select('_version').eq('id',id).single();
    if(!data)return true;// new record
    if(data._version>localVersion){
      console.warn(`[DB] Version conflict on ${table}/${id}: local v${localVersion}, server v${data._version} — auto-healing`);
      _dbRecentSaves[id]=Date.now();// prevent rapid re-conflict from polls during save
      return data._version;// return server version so callers can auto-heal
    }
    return true;
  }catch(e){console.error('[DB] version check failed:',e);if(!_bgSync&&_dbNotify)_dbNotify('Save blocked — unable to verify data version. Check your connection and try again.','error');return false}// if check fails, block save to prevent overwriting newer data
};

// ─── Normalized Save Helpers ───
// Art rows map `stitches` to an INT column. An empty string (or any non-numeric value) must
// become null or Postgres rejects the whole upsert ("invalid input syntax for type integer").
// mock_links must ALWAYS be present and non-null: supabase-js bulk upserts send ?columns= as the
// UNION of keys across all rows, and PostgREST fills a row's missing keys with NULL (not the column
// default). mock_links is NOT NULL in so_art_files/estimate_art_files, so one row carrying the key
// while another lacks it (e.g. fresh OMG-import art next to a library copy) 400s the whole batch
// and aborts the save before items are written (the SO-1459 blank-order bug).
const _sanitizeArtRow=(r)=>{if('stitches' in r){const n=parseInt(r.stitches,10);r.stitches=Number.isFinite(n)?n:null}if(r.mock_links==null)r.mock_links={};return r};
// ─── Art-file field-level merge (optimistic-concurrency conflict resolution) ───
// When an art row's DB copy has advanced past this client's (a _version conflict), we must do neither of the two
// unsafe extremes: blindly overwriting (clobbers another user's concurrent approval/mockup) nor silently dropping
// this client's edit. The drop is the reported data-loss bug — a flood of background reloads/saves keeps bumping
// the DB _version, the open editor's working copy falls behind, and the user's typed name/color-ways/size are then
// filtered out as "stale". Instead we 3-way-merge: start from the DB row (keeps concurrent approval/status/mockup
// changes), overlay THIS client's user-authored content, and union file collections so neither side's uploads are
// lost. _version itself is never written (the DB trigger owns it), so the merged row upserts cleanly.
const _ART_CONTENT_FIELDS=['name','deco_type','ink_colors','thread_colors','stitches','art_size','art_sizes','garment_colors','color_ways','design_id','notes','archived','prod_files_attached'];
const _ART_FILE_COLLECTIONS=['files','mockup_files','prod_files','sample_art'];
const _artFileUrl=f=>typeof f==='string'?f:(f&&(f.url||f.name))||'';
const _unionArtFiles=(dbArr,clientArr)=>{
  // Both scalar (e.g. a single preview/sample url): prefer the client's value, falling back to the DB's.
  if(!Array.isArray(dbArr)&&!Array.isArray(clientArr))return clientArr!==undefined?clientArr:dbArr;
  const out=Array.isArray(dbArr)?dbArr.slice():[];
  const seen=new Set(out.map(_artFileUrl).filter(Boolean));
  (Array.isArray(clientArr)?clientArr:[]).forEach(f=>{const k=_artFileUrl(f);if(!k){out.push(f)}else if(!seen.has(k)){seen.add(k);out.push(f)}});
  return out;
};
const _mergeArtConflict=(clientArt,dbRow)=>{
  const merged={...dbRow};// base = DB row: keeps status/preview/uploaded and anything another user changed
  _ART_CONTENT_FIELDS.forEach(f=>{if(f in clientArt)merged[f]=clientArt[f]});// overlay this client's typed content
  _ART_FILE_COLLECTIONS.forEach(f=>{merged[f]=_unionArtFiles(dbRow[f],clientArt[f])});// union uploads from both sides
  const im={...(dbRow.item_mockups||{})};// per-item mockup map: union each item's url list
  Object.entries(clientArt.item_mockups||{}).forEach(([k,v])=>{im[k]=_unionArtFiles(im[k],v)});
  merged.item_mockups=im;
  // mock_links: small {garmentKey -> sourceKey} map. Shallow-merge so neither side's reuse links are
  // dropped on a concurrent edit; the client's link wins for any key it set.
  merged.mock_links={...(dbRow.mock_links||{}),...(clientArt.mock_links||{})};
  if(!merged.preview_url&&clientArt.preview_url)merged.preview_url=clientArt.preview_url;
  return merged;
};
// Resolve which art rows to persist given the client's art_files and the live full DB rows. Conflicting rows
// (DB _version ahead of the client's) are field-merged onto the DB copy; the rest pass through unchanged. Returns
// {client, row, baseVersion} per file so the caller can upsert `row` and, on success, bump the in-memory `client`
// copy to baseVersion+1 (matching the DB trigger) so its own next save isn't mistaken for stale.
const _resolveArtRows=(clientArtFiles,dbRows,parentId)=>{
  const dbById=new Map((dbRows||[]).map(r=>[r.id,r]));
  let conflicts=0;
  const out=clientArtFiles.map(a=>{
    const db=dbById.get(a.id);
    if(db&&(a._version||0)<(db._version||0)){conflicts++;return{client:a,row:_mergeArtConflict(a,db),baseVersion:db._version||0}}
    return{client:a,row:a,baseVersion:a._version||0};
  });
  if(conflicts)console.warn('[DB]',conflicts,'art file(s) for',parentId,'field-merged with newer DB copy (concurrent edit) — your content preserved');
  return out;
};
const _EST_STATUS_RANK={draft:0,open:1,sent:2,approved:3,converted:4};
const _mergeDbEstStatus=async(est)=>{
  // Fetch DB status; if DB has a higher-ranked status, merge it into est so we never downgrade
  // an approval/conversion through a background save.
  try{const{data:_dbRow}=await supabase.from('estimates').select('status,approved_by,approved_at').eq('id',est.id).single();
    if(_dbRow&&(_EST_STATUS_RANK[_dbRow.status]??-1)>(_EST_STATUS_RANK[est.status]??-1)){
      est.status=_dbRow.status;if(_dbRow.approved_by)est.approved_by=_dbRow.approved_by;if(_dbRow.approved_at)est.approved_at=_dbRow.approved_at;
      if(_onEstStatusMerge)_onEstStatusMerge(est.id,_dbRow.status,_dbRow.approved_by,_dbRow.approved_at);
    }
  }catch(_){}
};
const _dbSaveEstimateInner = async (est) => {
  if(!supabase)return;
  await _ensureFreshSession();// refresh a near-expiry token BEFORE the write, so an idle/slept tab doesn't hit the reactive 401 path (spurious save-failed banner)
  // Never persist a customerless estimate. The "Select Customer *" rule is UI-only and save_estimate
  // permits a null customer, so a draft built before a customer is chosen — or an existing estimate whose
  // customer_id was dropped by a stale background save — would otherwise be written to the shared DB as an
  // un-billable orphan (the EST-1276 case). Skip the DB write (the draft stays safe in local state);
  // selecting a customer fires another _diffSave that persists it. This also blocks a stale save from
  // nulling an already-saved estimate's customer.
  if(!est.customer_id){if(!_bgSync&&typeof _dbNotify==='function')_dbNotify('Add a customer before this estimate can be saved.','error');return;}
  // Stale-write circuit breaker: if a recent save for this estimate was rejected as STALE, don't re-POST
  // until the cooldown elapses (realtime/poll should have healed the copy by then). Prevents a re-firing
  // save effect from flooding the DB with STALE_ESTIMATE_WRITE rejections. Treated as a non-failure 'stale'
  // result so it clears pending and never lands in the failed banner.
  const _cd=_dbStaleCooldown.get(est.id);
  if(_cd&&Date.now()<_cd){return 'stale';}
  // Adopt this client's own last-written version first: a payload cloned before the previous save's
  // version bump landed must not be rejected as stale against our own write (see _dbOwnVersions).
  _rebaseOntoOwnWrite(est);
  // Optimistic locking: check version before saving (auto-heal on conflict)
  if(est._version){const vc=await _checkVersion('estimates',est.id,est._version);if(vc!==true&&typeof vc==='number'){
    await _mergeDbEstStatus(est);
    est._version=vc;
  }}
  // For background _diffSave syncs: if local status is below 'approved', always verify DB hasn't been
  // set higher by an external write (e.g. coach portal approval) before clobbering it.
  if(_bgSync&&(_EST_STATUS_RANK[est.status]??-1)<_EST_STATUS_RANK.approved){await _mergeDbEstStatus(est)}
  return _dbSavingGuard(async()=>{let decoFailed=false;let _failMsg='';try{
    const{items,art_files,...estRow}=est;
    // The estimate row is now written by the atomic save_estimate RPC below — together with its items and
    // decorations in a single transaction. We intentionally no longer upsert it separately here: writing the
    // parent and children in independent calls (and letting a failed parent write fall through) is exactly
    // what produced orphaned stub estimates and the cryptic line-item FK error reps were seeing.
    // Delete old children — must delete grandchildren (decorations) BEFORE estimate_items due to FK constraints
    const _oldEstResp=await _retryNet(()=>supabase.from('estimate_items').select('id,item_index,sku,name,product_id,sizes,qty_only,est_qty').eq('estimate_id',est.id));
    // Fail-closed: if reading existing items errored, refuse to proceed. Otherwise oldItemIds=[] would fail-open
    // and the unconditional `DELETE FROM estimate_items WHERE estimate_id=...` below would wipe whatever was there.
    if(_oldEstResp.error){
      console.error('[DB] SAFETY: Blocking estimate save — failed to read existing items for',est.id,':',_oldEstResp.error.message);
      if(_dbNotify)_dbNotify('Save blocked — could not verify existing items. Please reload the page.','error');
      return false;
    }
    const _oldEstItems=_oldEstResp.data||[];
    const oldItemIds=_oldEstItems.map(i=>i.id);
    // Safety check: if this session never cleanly loaded the items, do NOT let it rewrite them. A timed-out
    // estimate_items load leaves the editor with an untrustworthy item list (blank, partial, or with new rows
    // added on top of a phantom-empty estimate), and the insert-new/delete-old swap below would replace the real
    // DB rows with it — the EST-1119 failure mode (4 real items overwritten by 1). Block on ANY count mismatch
    // while not hydrated (fewer OR more), not just reductions. When items WERE hydrated, the list is trustworthy
    // and the rep can add/remove freely.
    const _clientEstItemCount=(items||[]).length;
    // SAFETY (root cause of the 2026-05-29 multi-estimate item wipe): a background sync (poll/realtime
    // _diffSave, _bgSync=true) must NEVER shrink or empty an estimate's items. Emptying is always a deliberate
    // foreground edit; a background path arriving with fewer items means stale/partial in-memory state
    // (truncated child fetch, merge gap) — which the sticky _everHydratedItems guard below would otherwise
    // wave through. Preserve the DB rows untouched; the estimate row's field changes already upserted above.
    // Zero-wipe guard: block unconditionally when client has 0 items but DB has items.
    // savE already prevents foreground zero-saves, so reaching here with 0 client items always means
    // stale/raced state — not a legitimate edit. Applies regardless of _bgSync or hydration status.
    if(oldItemIds.length>0&&_clientEstItemCount===0){
      console.error('[DB] SAFETY: Blocking estimate zero-wipe for',est.id,'— client has 0 items but DB has',oldItemIds.length);
      if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:est.id,prevCount:oldItemIds.length,newCount:0,reason:'client has 0 items but DB has items (zero-wipe guard — likely stale/raced state)'});
      _dbSaveFailedIds.delete(est.id);_persistFailedIds();return true;
    }
    if(_bgSync&&oldItemIds.length>0&&_clientEstItemCount<oldItemIds.length&&!(est._itemsHydrated||_everHydratedItems.has(est.id))){
      console.warn('[DB] SAFETY: background sync would shrink',est.id,'items ('+_clientEstItemCount+'<'+oldItemIds.length+') — items not hydrated, preserving DB items, skipping child writes');
      if(_dataLossAlert)_dataLossAlert({kind:'bg_shrink_blocked',soId:est.id,prevCount:oldItemIds.length,newCount:_clientEstItemCount,reason:'background estimate save would shrink items'});
      _dbSaveFailedIds.delete(est.id);_persistFailedIds();return true;
    }
    // Client-authored estimate (new/imported): first save inserts the editor's items while the DB has none —
    // they're authoritative, so trust this estimate for the rest of the session (see SO save for rationale).
    if(oldItemIds.length===0&&_clientEstItemCount>0)_everHydratedItems.add(est.id);
    if(oldItemIds.length>0&&_clientEstItemCount!==oldItemIds.length){
      if(est._itemsHydrated||_everHydratedItems.has(est.id)){
        console.warn('[DB] Estimate',est.id,'saving with',_clientEstItemCount,'item(s) (DB had',oldItemIds.length,') — items were hydrated, treating as intentional edit');
      }else if(itemEditReconciles(items,_oldEstItems)){
        // Unhydrated session (bulk estimate_items load timed out → _itemsHydrated false for every estimate), but
        // the client's items reconcile with the freshly-read DB rows by SKU/name — proof this client held the real
        // estimate and the count change is a deliberate add/remove. Trust it and mark hydrated for the session.
        // (A timed-out load can't reach here: it yields 0 items → caught by the zero-wipe guard above.)
        console.warn('[DB] Estimate',est.id,'item count changed ('+_clientEstItemCount+' vs DB '+oldItemIds.length+') on an unhydrated session, but client items reconcile with DB by SKU/name — verified deliberate edit; trusting');
        _everHydratedItems.add(est.id);
      }else{
        console.error('[DB] SAFETY: Blocking estimate save —',_clientEstItemCount,'client item(s) vs',oldItemIds.length,'in DB for',est.id,'(items never hydrated this session)');
        if(_dbNotify)_dbNotify('Save blocked — items may not have loaded fully (database has '+oldItemIds.length+', editor has '+_clientEstItemCount+'). Please reload the page.','error');
        return false;
      }
    }
    // Safety check: if client has 0 decorations but DB has some, abort to prevent data loss — but ONLY when
    // decorations were not cleanly loaded this session. A timed-out estimate_item_decorations load strips decos
    // off the items while the DB still has them, so a save would wipe them. When decos WERE hydrated, the client
    // list is trustworthy and removing the last decoration is a deliberate edit (the user-reported case) — allow it.
    const clientDecoCount=(items||[]).reduce((a,it)=>a+(it.decorations?.length||0),0);
    const allNoDeco=(items||[]).length>0&&(items||[]).every(it=>it.no_deco);
    if(clientDecoCount===0&&!allNoDeco&&oldItemIds.length&&!est._decosHydrated){
      const{count:dbDecoCount}=await supabase.from('estimate_item_decorations').select('id',{count:'exact',head:true}).in('estimate_item_id',oldItemIds);
      if(dbDecoCount>0){console.error('[DB] SAFETY: Blocking estimate save — client has 0 decorations but DB has',dbDecoCount,'for',est.id,'(decorations never hydrated this session)');if(_dbNotify)_dbNotify('Save blocked — decoration data would be lost. Please reload the page.','error');return false}
    }
    // Per-item safety: block save if any single item would lose all its decorations.
    // Catches the partial-loss case the all-zero check above misses (one item drops decos while others retain them).
    // Gated on _decosHydrated: when decos loaded cleanly, a per-item deco removal is a deliberate edit, so skip.
    if(oldItemIds.length&&items?.length&&!est._decosHydrated){
      const{data:_oldDecoRows}=await supabase.from('estimate_item_decorations').select('estimate_item_id').in('estimate_item_id',oldItemIds);
      const _oldDecoByItem=new Map();(_oldDecoRows||[]).forEach(d=>_oldDecoByItem.set(d.estimate_item_id,(_oldDecoByItem.get(d.estimate_item_id)||0)+1));
      for(const oi of _oldEstItems){
        const oldN=_oldDecoByItem.get(oi.id)||0;if(oldN===0)continue;
        const ci=items[oi.item_index];if(!ci)continue;// item removed by user — allowed
        if(ci.no_deco)continue;
        if((ci.decorations?.length||0)===0){
          const label=ci.sku||oi.sku||('item '+oi.item_index);
          console.error('[DB] SAFETY: Blocking estimate save — '+label+' had',oldN,'decoration(s) in DB but client has 0');
          if(_dbNotify)_dbNotify('Save blocked — decoration data for '+label+' would be lost. Please reload the page.','error');
          return false;
        }
      }
    }
    // Per-item quantity-wipe guard: block a save that would zero out a surviving line's quantities (same
    // slot + same sku/product) — the EST-1316 failure, where a 53-unit jersey saved down to sizes:{} and
    // read $0 everywhere. save_estimate upserts `sizes` verbatim and the count/deco guards above never look
    // inside a line at its quantities, so an item whose sizes silently emptied (stale snapshot, size-mode
    // switch, edit side effect) overwrites real units with {} undetected — and since the row is upserted,
    // never DELETEd, no estimate_items_audit snapshot is written either. Partial reductions, replaced slots,
    // est_qty/qty-only lines, and removed items (caught by the count guards) are intentionally not flagged.
    if(oldItemIds.length&&items?.length){
      const _wiped=itemsWithWipedQty(items,_oldEstItems);
      if(_wiped.length){
        const w=_wiped[0];const label=(w.name||'').trim()||w.sku||('item '+w.item_index);
        // A background reconciliation (poll/realtime _diffSave) carrying a never-hydrated snapshot can show a
        // surviving line's sizes as empty while the DB still holds real units — a stale/partial in-memory
        // artifact, not a deliberate wipe. itemsWithWipedQty only fires when the client's sizes total 0, so on a
        // background sync that means this client never loaded the real quantities. Preserve the DB units silently
        // (mirrors the bg_shrink guard above): no write, no alert — nothing was lost, and the next reconciliation
        // re-fills the sizes from the DB so the diff resolves. A FOREGROUND save, or a hydrated client, that
        // empties a surviving line is the real EST-1316 wipe — that still blocks and alerts below.
        const _hydrated=est._itemsHydrated||_everHydratedItems.has(est.id);
        if(_bgSync&&!_hydrated){
          console.warn('[DB] SAFETY: background sync would empty quantities for "'+label+'" on',est.id,'— items not hydrated, preserving DB units, skipping write');
          _dbSaveFailedIds.delete(est.id);_persistFailedIds();return true;
        }
        console.error('[DB] SAFETY: Blocking estimate save — quantities for "'+label+'" would be wiped ('+w.prevQty+' units → 0) for',est.id);
        if(_dataLossAlert)_dataLossAlert({kind:'qty_wipe_blocked',soId:est.id,itemIndex:w.item_index,sku:w.sku,prevQty:w.prevQty,reason:'item quantities would be emptied'});
        if(_dbNotify)_dbNotify('Save blocked — the quantities for "'+label+'" ('+w.prevQty+' units) would be lost. Reload the page to restore them.','error');
        return false;
      }
    }
    // Atomic estimate save (replaces the old separate estimate-upsert + item/decoration writes): one
    // transactional Postgres RPC upserts the estimate and replaces its items + decorations together, so a
    // partial write is impossible and a retry after a dropped connection never duplicates lines or orphans
    // rows. It raises CUSTOMER_MISSING when the estimate's customer isn't in the DB yet (the root-cause
    // failure) — mapped to plain English below instead of leaking a raw constraint string to the rep. The
    // safety guards above still decide WHETHER to save (they only read); this performs the write.
    let _serverVersioned=false;// true when save_estimate returned the post-save version (base is exact, no bump needed)
    {
      const _rpcItems=(items||[]).map((item,idx)=>{const{decorations,...itemData}=item;return{..._pick(itemData,_itemCols),item_index:idx,decorations:(decorations||[]).map(d=>_pick(_sanitizeDeco(d),_decoCols))}});
      const _estPayload=_pick(estRow,_estCols);
      // Optimistic concurrency (server-side): pass the _version this edit is based on so the DB rejects a
      // stale clobber — the multi-tab / realtime-echo fight that silently wiped sizes, deleted items, and
      // dropped customers. Falls back to the un-versioned call when the versioned RPC (migration 00128)
      // isn't deployed yet, so client/DB deploy order can't break saving.
      let _rpcRes=await _retryNet(()=>supabase.rpc('save_estimate',{p_estimate:_estPayload,p_items:_rpcItems,p_base_version:(est._version??null)}));
      if(_rpcRes.error&&(_rpcRes.error.code==='PGRST202'||/Could not find the function|No function matches|does not exist/i.test(_rpcRes.error.message||''))){
        _rpcRes=await _retryNet(()=>supabase.rpc('save_estimate',{p_estimate:_estPayload,p_items:_rpcItems}));
      }
      const _rpcErr=_rpcRes.error;
      // A write rejected by the version guard means another save (usually another open tab) advanced this
      // estimate past the copy we hold. Do NOT clobber it — skip the write; realtime delivers the newer rows
      // and the rep re-applies their edit on the refreshed copy. Not a failure, so no failed-id banner.
      // Return 'stale' (truthy, not false) so _diffSave treats it as non-failure: it clears _dbSavePendingIds
      // and does NOT roll back _dbSnap. Rolling back the snapshot on a stale rejection caused an infinite retry
      // loop (old snap re-queued the item → next _diffSave retried → STALE again → forever), and left
      // _dbSavePendingIds non-empty, which permanently blocked the build-version poller from reloading stale tabs.
      if(_rpcErr&&((_rpcErr.message||'').includes('STALE_ESTIMATE_WRITE')||_rpcErr.code==='40001')){
        console.warn('[DB] save_estimate rejected a stale write for',est.id,'—',_rpcErr.message);
        _emitOutboxConflict('estimates',est);// preserve the rejected edit's content — the conflict card lets the rep re-apply or discard
        if(!_bgSync&&_dbNotify)_dbNotify('This estimate changed in another tab. Your edit was NOT saved but has been preserved — review it in the red banner.','error');
        // Stale = superseded, not failed: clear any prior failed-flag so a stale estimate doesn't linger in the
        // "failed to save" banner or get retried every 60s. With it no longer pending/failed, the realtime/poll
        // merge stops protecting the local copy and heals it to the DB's current version (rep then re-applies).
        _dbSaveFailedIds.delete(est.id);_clearSaveError(est.id);_persistFailedIds();
        _dbStaleCooldown.set(est.id,Date.now()+_STALE_COOLDOWN_MS);// throttle re-POSTs until realtime heals the copy
        return 'stale';
      }
      if(_rpcErr){
        const _m=_rpcErr.message||String(_rpcErr);
        if(_isAuthError(_rpcErr))return _handleAuthSaveFailure(est.id,_rpcErr);
        const _friendly=_m.includes('CUSTOMER_MISSING')
          ?"This customer isn't saved yet. Re-select or re-create the customer, then save."
          :(_m.includes('ESTIMATE_ID_MISSING')||_m.includes('ESTIMATE_PAYLOAD_EMPTY'))
            ?'Estimate could not be saved — required fields are missing. Please reload and try again.'
            :'Estimate save failed — please try again, or reload the page if it keeps happening.';
        console.error('[DB] save_estimate RPC failed:',_m);
        _dbSaveFailedIds.add(est.id);_recordSaveError(est.id,_m);_persistFailedIds();
        if(_dbNotify)_dbNotify(_friendly,'error');
        return false;
      }
      // Stale via return value (migration 00156): save_estimate now RETURNS {stale:true} instead of raising
      // STALE_ESTIMATE_WRITE, so an out-of-date tab can't retry a rejected save into a DB CPU storm (a raised
      // error gets retried with no backoff by old tabs — thousands/sec). Handle identically to the raised-error
      // path above: do NOT advance _version (keep optimistic concurrency protecting the local copy), clear
      // pending/failed, back off via the cooldown, and report non-failure so _diffSave doesn't roll back.
      if(_rpcRes.data&&_rpcRes.data.stale===true){
        console.warn('[DB] save_estimate returned stale for',est.id,'(client base',est._version,'→ DB',_rpcRes.data.version,')');
        _emitOutboxConflict('estimates',est);// preserve the rejected edit's content — the conflict card lets the rep re-apply or discard
        if(!_bgSync&&_dbNotify)_dbNotify('This estimate changed in another tab. Your edit was NOT saved but has been preserved — review it in the red banner.','error');
        _dbSaveFailedIds.delete(est.id);_clearSaveError(est.id);_persistFailedIds();
        _dbStaleCooldown.set(est.id,Date.now()+_STALE_COOLDOWN_MS);
        return 'stale';
      }
      // Advance our base _version from the RPC result so this client's own next save isn't seen as stale.
      if(_rpcRes.data&&typeof _rpcRes.data.version==='number'){est._version=_rpcRes.data.version;_dbOwnVersions[est.id]=est._version;_serverVersioned=true}
    }
    // Sync art_files: upsert current, delete removed. Optimistic concurrency via the _version trigger — never
    // overwrite an art row whose DB copy is newer than the client's, and only delete rows the client had loaded.
    const{data:_dbAf}=await supabase.from('estimate_art_files').select('*').eq('estimate_id',est.id);
    const _dbAfVerById=new Map((_dbAf||[]).map(r=>[r.id,r._version||0]));
    if(art_files?.length){
      const _resolved=_resolveArtRows(art_files,_dbAf,est.id);
      {
        let afRows=_resolved.map(({row})=>_sanitizeArtRow({..._pick(row,_artCols),archived:!!row.archived,estimate_id:est.id}));
        let _afOk=true;
        const{error:afErr}=await supabase.from('estimate_art_files').upsert(afRows,{onConflict:'estimate_id,id'});
        if(afErr){
          // A degraded (anon) session is rejected here by RLS — surface it as a save failure so it routes through
          // session recovery below instead of being swallowed (which would clear the dirty flag and lose the art).
          if(_isAuthError(afErr)){decoFailed=true;_failMsg=_failMsg||('estimate_art_files: '+afErr.message)}
          else if(afErr.message?.includes('art_sizes')||afErr.message?.includes('garment_colors')||afErr.message?.includes('item_mockups')||afErr.message?.includes('schema cache')||afErr.code==='PGRST204'||afErr.message?.includes('not found')){
            console.warn('[DB] Art file columns missing in schema, retrying without extras:',afErr.message);
            const coreRows=afRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_artExtraCols.has(k))cr[k]=r[k]});return cr});
            const{error:afErr2}=await supabase.from('estimate_art_files').upsert(coreRows,{onConflict:'estimate_id,id'});
            if(afErr2){console.error('[DB] estimate_art_files upsert failed (core):',afErr2.message,afErr2.details);_afOk=false;decoFailed=true;_failMsg=_failMsg||('estimate_art_files: '+afErr2.message)}
            else if(typeof nf==='function')nf('Some art fields (sizes/colors/mockups) could not be saved — DB schema may need updating','error');
          }else{console.error('[DB] estimate_art_files upsert failed:',afErr.message,afErr.details);_afOk=false;decoFailed=true;_failMsg=_failMsg||('estimate_art_files: '+afErr.message)}
        }
        // Match the DB trigger's version bump so this client's next save isn't mistaken for stale.
        if(_afOk)_resolved.forEach(({client,baseVersion})=>{client._version=baseVersion+1});
      }
      const currentAfIds=new Set(art_files.map(a=>a.id).filter(Boolean));
      const _knownArtIds=new Set(Array.isArray(est._hydratedArtIds)?est._hydratedArtIds:[]);
      const toDeleteAf=(_dbAf||[]).filter(ea=>!currentAfIds.has(ea.id)&&_knownArtIds.has(ea.id)).map(ea=>ea.id);
      if(toDeleteAf.length)await supabase.from('estimate_art_files').delete().eq('estimate_id',est.id).in('id',toDeleteAf);
    }else if(Array.isArray(art_files)&&est._artHydrated!==false){
      // User removed every art group (art_files === []). Delete only the rows the client had loaded; preserve any
      // added by another user since. Gated on _artHydrated so a timed-out load can't wipe real data.
      const _knownArtIds=(Array.isArray(est._hydratedArtIds)?est._hydratedArtIds:[]).filter(id=>_dbAfVerById.has(id));
      if(_knownArtIds.length)await supabase.from('estimate_art_files').delete().eq('estimate_id',est.id).in('id',_knownArtIds);
    }
    // If art_files is undefined/null (not hydrated), leave existing DB art files untouched to prevent accidental data loss
    // Items + decorations were written atomically by the save_estimate RPC above — no separate insert,
    // delete-old-rows swap, or rollback is needed here. (oldItemIds is still read above for the safety guards.)
    if(decoFailed){if(_isAuthError({message:_failMsg}))return _handleAuthSaveFailure(est.id,{message:_failMsg});_dbSaveFailedIds.add(est.id);_recordSaveError(est.id,_failMsg||'unknown estimate save error');_persistFailedIds();if(_dbNotify)_dbNotify('Estimate save incomplete: '+(_failMsg||'see console'),'error');return false}
    _dbSaveFailedIds.delete(est.id);_clearSaveError(est.id);_persistFailedIds();_dbRecentSaves[est.id]=Date.now();_dbStaleCooldown.delete(est.id);
    // Bump local version to match server (DB trigger increments on UPDATE) — ONLY when the RPC didn't
    // return the post-save version (pre-00128 fallback). When it did, est._version is already exact and
    // bumping on top sets base = server+1, which lets the NEXT save slide past the stale guard after one
    // concurrent foreign write (cur == base) and silently clobber it — defeating optimistic locking for
    // the most common conflict case.
    if(est._version&&!_serverVersioned)est._version=est._version+1;
    if(est._version)_dbOwnVersions[est.id]=est._version;
    return true;
  }catch(e){console.error('[DB] save estimate:',e);if(_isAuthError(e))return _handleAuthSaveFailure(est.id,e);_dbSaveFailedIds.add(est.id);_recordSaveError(est.id,e.message||String(e));_persistFailedIds();if(_dbNotify)_dbNotify('Estimate save failed: '+e.message,'error');return false}});
};
const _dbSaveEstimate = (est) => _outboxWrap('estimates', est, _queuedEntitySave(est.id, est, _dbSaveEstimateInner));
// Resolve which current item a preserved child row (PO/pick line) should re-attach to after the
// order's structure changed. The row's original position wins when its SKU still matches; otherwise
// fall back to SKU matching across all items — removing/reordering a line shifts every item_index
// after it, which used to make these rows unmatchable and hard-block the save (the SO-1132 failure).
// Among same-SKU candidates prefer a known matching color, then the closest index; a candidate whose
// color is known and DIFFERENT is never used (navy's PO line on the red row would mislead receiving).
// Returns the items[] index, or -1 when no current item can safely take the row.
const _matchRestoreItem=(oi,items)=>{
  const pos=items[oi.item_index];
  if(pos&&(!oi.sku||!pos.sku||pos.sku===oi.sku))return oi.item_index;
  if(!oi.sku)return -1;
  const _norm=c=>String(c||'').trim().toLowerCase();
  let best=-1,bestScore=-Infinity;
  items.forEach((it,idx)=>{
    if((it.sku||'')!==oi.sku)return;
    if(oi.color&&it.color&&_norm(it.color)!==_norm(oi.color))return;
    const score=(oi.color&&it.color?1000:0)-Math.abs(idx-oi.item_index);
    if(score>bestScore){bestScore=score;best=idx}
  });
  return best;
};
// Post-insert verification count with the error surfaced. The 2026-07-07 storm: the verify count query
// itself failed (transient 429/timeout hit all in-flight read-backs in the same second), count came back
// null, and `(count||0) < expected` read that as "0 rows persisted" → 8 SOs emailed 🚨 "Items lost" at
// 9:44:08 while every row was intact. An errored read-back is INCONCLUSIVE, not zero — retry the count
// once, and if it still errors report {error} so the caller can say "verification failed" truthfully
// (the save is still queued for retry either way; old rows stay canonical under the insert-first swap).
const _countInsertedChildRows=async(table,itemIds)=>{
  let{count,error}=await supabase.from(table).select('id',{count:'exact',head:true}).in('so_item_id',itemIds);
  if(error)({count,error}=await supabase.from(table).select('id',{count:'exact',head:true}).in('so_item_id',itemIds));
  return{count:count||0,error};
};
const _dbSaveSOInner = async (so) => {
  if(!supabase)return;
  await _ensureFreshSession();// proactive token refresh before the write (see _dbSaveEstimateInner) — fewer reactive 401s from an idle tab
  // Optimistic locking: check version before saving (auto-heal on conflict). Record the conflict
  // rather than only adopting the server version: a bumped server version means ANOTHER session saved
  // this SO after our copy loaded, and the guards below use that fact to refuse writes that would drop
  // items or deco POs the other session added (the SO-1333 wipe, 2026-06-30).
  let _versionConflict=null;
  if(so._version){const vc=await _checkVersion('sales_orders',so.id,so._version);if(vc!==true&&typeof vc==='number'){_versionConflict={local:so._version,server:vc};so._version=vc}}
  return _dbSavingGuard(async()=>{let saveFailed=false;let _failMsg='';try{
    const{items,art_files,firm_dates,jobs,...soRow}=so;
    // Save SO row FIRST (FK constraint requires it before items), but with OLD updated_at
    // We'll bump updated_at LAST so cross-tab polls don't see stale items
    const finalUpdatedAt=soRow.updated_at;
    const soRowInitial={..._pick(soRow,_soCols)};
    // Try to preserve existing updated_at for the initial upsert (only bump it after children are saved)
    const{data:existingSO,error:existErr}=await supabase.from('sales_orders').select('updated_at,deco_pos').eq('id',so.id).maybeSingle();
    if(existingSO)soRowInitial.updated_at=existingSO.updated_at;
    // Confident-new only when the lookup succeeded AND returned no row — never on a network/SELECT error,
    // otherwise we could purge a live order's children below.
    const _isNewSO=!existErr&&!existingSO;
    // deco_pos rides on the SO row, so a whole-row upsert from a stale session silently drops deco POs
    // added by another session since this tab loaded (how DPO 3521 CMSF vanished on 2026-06-30 — the row
    // had no guard while the item/pick/PO children all did). When the version check flagged this save as
    // stale, re-inject any DB deco_pos entry missing from the client's list unless the client deliberately
    // deleted it this session (_deletedDecoPoIds, a session-only tombstone set by the editor's Delete PO).
    if(_versionConflict&&existingSO&&Array.isArray(existingSO.deco_pos)&&existingSO.deco_pos.length){
      const _clientDeco=new Set((Array.isArray(soRowInitial.deco_pos)?soRowInitial.deco_pos:[]).map(d=>d&&d.po_id).filter(Boolean));
      const _deletedDeco=new Set(Array.isArray(so._deletedDecoPoIds)?so._deletedDecoPoIds:[]);
      const _missingDeco=existingSO.deco_pos.filter(d=>d&&d.po_id&&!_clientDeco.has(d.po_id)&&!_deletedDeco.has(d.po_id));
      if(_missingDeco.length){
        soRowInitial.deco_pos=[...(Array.isArray(soRowInitial.deco_pos)?soRowInitial.deco_pos:[]),..._missingDeco];
        console.warn('[DB] Restored',_missingDeco.length,'deco PO(s) a stale save would have dropped for',so.id,':',_missingDeco.map(d=>d.po_id).join(', '));
        if(_dataLossAlert)_dataLossAlert({kind:'po_restored',soId:so.id,restored:_missingDeco.length});
      }
    }
    let{error:soErr}=await supabase.from('sales_orders').upsert(soRowInitial,{onConflict:'id'});
    if(soErr){
      const coreSoRow={};Object.keys(soRowInitial).forEach(k=>{if(!_soExtraCols.has(k))coreSoRow[k]=soRowInitial[k]});
      const retry=await supabase.from('sales_orders').upsert(coreSoRow,{onConflict:'id'});
      if(retry.error){console.error('[DB] sales_orders upsert failed:',retry.error.message);saveFailed=true;_failMsg='sales_orders: '+retry.error.message}
      else console.warn('[DB] SO saved with core columns only')
    }
    // Recycled-number guard: a brand-new SO id can collide with a deleted order whose number was reused.
    // Any so_jobs/so_art_files still sitting under this id are orphans from that prior order — purge them
    // before we write this order's real children, so they can't silently re-attach by so_id. (Orphan
    // items/decorations are already removed by the unconditional so_items delete further below.)
    if(_isNewSO){
      await supabase.from('so_jobs').delete().eq('so_id',so.id);
      await supabase.from('so_art_files').delete().eq('so_id',so.id);
    }
    // Delete old children — must delete grandchildren (decorations/picks/POs) BEFORE so_items due to FK constraints
    const _oldItemsResp=await _retryNet(()=>supabase.from('so_items').select('id,item_index,sku,color,product_id').eq('so_id',so.id));
    // Fail-closed: refuse the save whenever reading existing items errored. A SELECT error returns oldItemIds=[],
    // which would skip the deco/pick/PO deletes' `.in([])` filter but still let the unconditional
    // `DELETE FROM so_items WHERE so_id=...` below wipe everything. Retrying later (via _dbSaveFailedIds) is safer.
    if(_oldItemsResp.error){
      console.error('[DB] SAFETY: Blocking SO save — failed to read existing items for',so.id,':',_oldItemsResp.error.message);
      if(_dbNotify)_dbNotify('Save blocked — could not verify existing items. Please reload the page.','error');
      if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'so_items SELECT errored: '+_oldItemsResp.error.message});
      return false;
    }
    const _oldSoItems=_oldItemsResp.data||[];
    const oldItemIds=_oldSoItems.map(i=>i.id);
    // Use distinct item_index count as the authoritative "how many items does this SO have" — raw row count
    // includes duplicate rows left by interrupted saves (insert-new succeeds, delete-old never runs) and would
    // incorrectly trip the shrink/mismatch guards. Distinct indexes = the real item count; duplicates don't add slots.
    const _oldDistinctItemIndexCount=new Set(_oldSoItems.map(i=>i.item_index).filter(x=>x!=null)).size||oldItemIds.length;
    // Safety check: if this session never cleanly loaded the items, do NOT let it rewrite them. A timed-out
    // so_items load leaves an untrustworthy item list (blank, partial, or with new rows added on top of a
    // phantom-empty SO), and the insert-new/delete-old swap below would replace the real DB rows with it. Block on
    // ANY count mismatch while not hydrated (fewer OR more), not just reductions. When items WERE hydrated, the
    // list is trustworthy and the rep can add/remove freely (further guards below still protect orphaned jobs/decos).
    const _clientSoItemCount=(items||[]).length;
    // Client-authored order (parsed/imported, webstore, converted, copied, new): the DB has no items yet, so
    // this save is inserting the editor's items for the first time — they're authoritative. Trust this order
    // for the rest of the session so a follow-up edit (e.g. adding a line) isn't blocked by the hydration flag,
    // which only turns true after a later clean reload. Orders whose DB already holds items are NOT trusted here;
    // they must still load cleanly to clear the guard.
    if(oldItemIds.length===0&&_clientSoItemCount>0)_everHydratedItems.add(so.id);
    // Zero-wipe guard: same logic as estimate path — block unconditionally when client has 0 items but DB has items.
    if(oldItemIds.length>0&&_clientSoItemCount===0){
      console.error('[DB] SAFETY: Blocking SO zero-wipe for',so.id,'— client has 0 items but DB has',oldItemIds.length);
      if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,prevCount:oldItemIds.length,newCount:0,reason:'client has 0 items but DB has items (zero-wipe guard — likely stale/raced state)'});
      _dbSaveFailedIds.delete(so.id);_persistFailedIds();return true;
    }
    // Stale-content guard: another session saved this SO after our copy loaded (_versionConflict), and
    // the DB holds item rows this client's list doesn't cover (compared as a sku+color multiset). Those
    // rows are almost certainly the OTHER session's work, not deliberate deletions — and hydration can't
    // vouch here: a tab left open across someone else's edits was "cleanly hydrated" long ago, so it
    // passes every hydration gate below (exactly how SO-1333 lost its IND4000 line + S&S PO on
    // 2026-06-30). Block and prompt a reload; a rep who genuinely wants a line removed just reloads and
    // removes it again, conflict-free.
    if(_versionConflict&&oldItemIds.length>0&&_clientSoItemCount>0){
      const _dbKeyCounts={};_oldSoItems.forEach(r=>{const k=((r.sku||'')+'|'+(r.color||'')).toLowerCase();_dbKeyCounts[k]=(_dbKeyCounts[k]||0)+1});
      (items||[]).forEach(it=>{const k=((it.sku||'')+'|'+(it.color||'')).toLowerCase();if(_dbKeyCounts[k])_dbKeyCounts[k]--});
      const _uncovered=Object.entries(_dbKeyCounts).filter(([,n])=>n>0).map(([k])=>k.split('|').filter(Boolean).join(' ')||'(custom line)');
      if(_uncovered.length){
        console.error('[DB] SAFETY: Blocking stale SO save for',so.id,'— server version moved (v'+_versionConflict.local+'→v'+_versionConflict.server+') and DB items missing from this tab\'s copy:',_uncovered.join(', '));
        if(_dbNotify)_dbNotify('Save blocked — '+so.id+' was changed in another session ('+_uncovered.join(', ')+' would be dropped). Please reload the page.','error');
        if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,prevCount:_oldDistinctItemIndexCount,newCount:_clientSoItemCount,reason:'stale-version save would drop DB item(s) ['+_uncovered.join(', ')+'] — local v'+_versionConflict.local+' vs server v'+_versionConflict.server});
        return false;
      }
    }
    // Sync art_files BEFORE the bgSync item-shrink guard so art changes persist even when a background sync
    // cannot safely rewrite items (e.g. duplicate-item state from an interrupted save). Art has its own
    // optimistic locking (_version) and deletion guard (_hydratedArtIds), fully independent of item counts.
    // Wrapped in a block so its consts don't collide with the identical block that runs after item commit.
    {const{data:_dbAf}=await supabase.from('so_art_files').select('*').eq('so_id',so.id);
    const _dbAfVerById=new Map((_dbAf||[]).map(r=>[r.id,r._version||0]));
    if(art_files?.length){
      const _resolved=_resolveArtRows(art_files,_dbAf,so.id);
      {
        let soAfRows=_resolved.map(({row})=>_sanitizeArtRow({..._pick(row,_artCols),archived:!!row.archived,so_id:so.id}));
        let _afOk=true;
        const{error:afErr}=await _retryNet(()=>supabase.from('so_art_files').upsert(soAfRows,{onConflict:'so_id,id'}));
        if(afErr){
          if(afErr.message?.includes('art_sizes')||afErr.message?.includes('garment_colors')||afErr.message?.includes('item_mockups')||afErr.message?.includes('schema cache')||afErr.code==='PGRST204'||afErr.message?.includes('not found')){
            console.warn('[DB] Art file columns missing in schema, retrying without extras:',afErr.message);
            const coreRows=soAfRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_artExtraCols.has(k))cr[k]=r[k]});return cr});
            const{error:afErr2}=await supabase.from('so_art_files').upsert(coreRows,{onConflict:'so_id,id'});
            if(afErr2){console.error('[DB] so_art_files upsert failed (core):',afErr2.message,afErr2.details);saveFailed=true;_failMsg=_failMsg||('so_art_files: '+afErr2.message);_afOk=false}
            else if(typeof nf==='function')nf('Some art fields (sizes/colors/mockups) could not be saved — DB schema may need updating','error');
          }else{console.error('[DB] so_art_files upsert failed:',afErr.message,afErr.details);saveFailed=true;_failMsg=_failMsg||('so_art_files: '+afErr.message);_afOk=false}
        }
        // Match the DB trigger's version bump so this client's next save isn't mistaken for stale.
        if(_afOk)_resolved.forEach(({client,baseVersion})=>{client._version=baseVersion+1});
      }
      // Delete only art the client deliberately removed: it had loaded the row and no longer holds it.
      const currentAfIds=new Set(art_files.map(a=>a.id).filter(Boolean));
      const _knownArtIds=new Set(Array.isArray(so._hydratedArtIds)?so._hydratedArtIds:[]);
      const toDeleteAf=(_dbAf||[]).filter(ea=>!currentAfIds.has(ea.id)&&_knownArtIds.has(ea.id)).map(ea=>ea.id);
      if(toDeleteAf.length)await supabase.from('so_art_files').delete().eq('so_id',so.id).in('id',toDeleteAf);
    }else if(Array.isArray(art_files)&&so._artHydrated!==false){
      // User removed every art group (art_files === []). Delete only the rows the client had loaded; any art
      // added by another user since (not in _hydratedArtIds) is preserved.
      const _knownArtIds=(Array.isArray(so._hydratedArtIds)?so._hydratedArtIds:[]).filter(id=>_dbAfVerById.has(id));
      if(_knownArtIds.length)await supabase.from('so_art_files').delete().eq('so_id',so.id).in('id',_knownArtIds);
    }}
    // SAFETY: a background sync (poll/realtime _diffSave, _bgSync=true) must NEVER shrink or empty an SO's
    // items — same root cause as the estimate item-wipe. Preserve DB rows; the SO row already upserted above.
    // Art files were already synced above so this early return is now safe.
    // Exception: if items were cleanly hydrated this session, shrinkage is a deliberate rep deletion (rmI)
    // that happened to flow through _diffSave — the _bgSync flag alone can't distinguish background stale-state
    // from a user-initiated delete. Trust the hydrated client list and fall through to the normal save path.
    if(_bgSync&&oldItemIds.length>0&&_clientSoItemCount<_oldDistinctItemIndexCount&&!(so._itemsHydrated||_everHydratedItems.has(so.id))){
      console.warn('[DB] SAFETY: background sync would shrink',so.id,'items ('+_clientSoItemCount+'<'+_oldDistinctItemIndexCount+(oldItemIds.length!==_oldDistinctItemIndexCount?' raw='+oldItemIds.length:'')+') — items not hydrated, preserving DB items, skipping item writes; art files already synced');
      if(_dataLossAlert)_dataLossAlert({kind:'bg_shrink_blocked',soId:so.id,prevCount:_oldDistinctItemIndexCount,newCount:_clientSoItemCount,reason:'background SO save would shrink items'});
      if(saveFailed){if(_isAuthError({message:_failMsg}))return _handleAuthSaveFailure(so.id,{message:_failMsg});_dbSaveFailedIds.add(so.id);_recordSaveError(so.id,_failMsg||'so_art_files save error');_persistFailedIds();if(_dbNotify)_dbNotify('Art file save incomplete: '+(_failMsg||'see console'),'error');return false}
      _dbSaveFailedIds.delete(so.id);_persistFailedIds();return true;
    }
    if(oldItemIds.length>0&&_clientSoItemCount!==_oldDistinctItemIndexCount){
      if(so._itemsHydrated||_everHydratedItems.has(so.id)){
        console.warn('[DB] SO',so.id,'saving with',_clientSoItemCount,'item(s) (DB had',_oldDistinctItemIndexCount,(oldItemIds.length!==_oldDistinctItemIndexCount?'distinct /'+oldItemIds.length+' raw':''),') — items were hydrated, treating as intentional edit');
      }else if(itemEditReconciles(items,_oldSoItems)){
        // Unhydrated session (e.g. the bulk so_items load timed out at boot), but the client's items reconcile
        // with the freshly-read DB rows by SKU/name — proof this client held the real order and the count change
        // is a deliberate add/remove, not a hollowed load. Trust it and mark the order hydrated for the session
        // so follow-up edits aren't re-gated. (A timed-out load can't reach here: it yields 0 items → zero-wipe.)
        console.warn('[DB] SO',so.id,'item count changed ('+_clientSoItemCount+' vs DB '+_oldDistinctItemIndexCount+') on an unhydrated session, but client items reconcile with DB by SKU/name — verified deliberate edit; trusting');
        _everHydratedItems.add(so.id);
      }else{
        console.error('[DB] SAFETY: Blocking SO save —',_clientSoItemCount,'client item(s) vs',_oldDistinctItemIndexCount,(oldItemIds.length!==_oldDistinctItemIndexCount?'distinct ('+oldItemIds.length+' raw)':''),'in DB for',so.id,'(items never hydrated this session)');
        if(_dbNotify)_dbNotify('Save blocked — items may not have loaded fully (database has '+_oldDistinctItemIndexCount+', editor has '+_clientSoItemCount+'). Please reload the page.','error');
        if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,prevCount:_oldDistinctItemIndexCount,newCount:_clientSoItemCount,reason:'Client save had '+_clientSoItemCount+' items while DB had '+_oldDistinctItemIndexCount+' distinct ('+oldItemIds.length+' raw) (items not loaded this session)'});
        return false;
      }
    }
    // Extra guard: even if oldItemIds came back empty, be careful when the SO still has jobs in the DB.
    // Jobs reference so_items by item_idx, so if jobs exist there must once have been items (the SO-1001 /
    // SO-1459 failure mode: an art/item save aborts after jobs are written but before items, stranding them).
    // Note this point is reachable ONLY when the DB already has 0 so_items — the zero-wipe guard above
    // (oldItemIds.length>0 && client 0) returns first whenever the DB still holds items, and oldItemIds is a
    // fresh authoritative read. So there is nothing left to wipe here; any jobs are already orphaned.
    if(!items||items.length===0){
      const{count:dbJobCount}=await supabase.from('so_jobs').select('id',{count:'exact',head:true}).eq('so_id',so.id);
      if(dbJobCount&&dbJobCount>0){
        // Only block while the empty item list is UNtrustworthy — a timed-out so_items load could have hollowed
        // it. Keep blocking then; a normal reload (0 rows loads fast, rarely times out) flips _itemsHydrated true
        // and self-clears this. Gate on hydration, mirroring the count-mismatch guard above (see _itemsHydrated).
        if(!(so._itemsHydrated||_everHydratedItems.has(so.id))){
          console.error('[DB] SAFETY: Blocking SO save — client has 0 items but DB has',dbJobCount,'job(s) for',so.id,'(items not hydrated this session)');
          if(_dbNotify)_dbNotify('Save blocked — items would be wiped while '+dbJobCount+' job(s) still exist. Please reload the page.','error');
          if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,prevCount:null,newCount:0,reason:'Client save had 0 items but '+dbJobCount+' job(s) still exist in DB (items not hydrated)'});
          return false;
        }
        // Items loaded cleanly and the order is genuinely empty. The DB items are already gone, so this save
        // wipes nothing — blocking here is a pure deadlock that re-fires on every reload (the SO-1459/1460
        // _version-climb). Allow it as a no-op success so the failed-save retry loop clears. The orphan jobs
        // are left untouched for get_health_report()/so-health-alert to surface for admin cleanup / re-import.
        console.warn('[DB] SO',so.id,'saving empty over',dbJobCount,'orphan job(s) — items hydrated & genuinely empty; no-op save, orphan jobs left for health-report cleanup');
        _dbSaveFailedIds.delete(so.id);_persistFailedIds();return true;
      }
    }
    // Safety check: if client has 0 decorations but DB has some, abort to prevent data loss — but ONLY when
    // decorations were not cleanly loaded this session. A timed-out so_item_decorations load strips decos off the
    // items while the DB still has them, so a save would wipe them. When decos WERE hydrated, the client list is
    // trustworthy and removing the last decoration is a deliberate edit — allow it.
    const clientDecoCount=(items||[]).reduce((a,it)=>a+(it.decorations?.length||0),0);
    const allNoDeco=(items||[]).length>0&&(items||[]).every(it=>it.no_deco);
    if(clientDecoCount===0&&!allNoDeco&&oldItemIds.length&&!so._decosHydrated){
      const{count:dbDecoCount}=await supabase.from('so_item_decorations').select('id',{count:'exact',head:true}).in('so_item_id',oldItemIds);
      if(dbDecoCount>0){console.error('[DB] SAFETY: Blocking SO save — client has 0 decorations but DB has',dbDecoCount,'for',so.id,'(decorations never hydrated this session)');if(_dbNotify)_dbNotify('Save blocked — decoration data would be lost. Please reload the page.','error');return false}
    }
    // Per-item safety: block save if any single item would lose all its decorations.
    // Catches the partial-loss case the all-zero check above misses (one item drops decos while siblings retain them).
    // Gated on _decosHydrated: when decos loaded cleanly, a per-item deco removal is a deliberate edit, so skip.
    if(oldItemIds.length&&items?.length&&!so._decosHydrated){
      const{data:_oldDecoRows}=await supabase.from('so_item_decorations').select('so_item_id').in('so_item_id',oldItemIds);
      const _oldDecoByItem=new Map();(_oldDecoRows||[]).forEach(d=>_oldDecoByItem.set(d.so_item_id,(_oldDecoByItem.get(d.so_item_id)||0)+1));
      for(const oi of _oldSoItems){
        const oldN=_oldDecoByItem.get(oi.id)||0;if(oldN===0)continue;
        const ci=items[oi.item_index];if(!ci)continue;// item removed by user — allowed
        if(ci.no_deco)continue;
        if((ci.decorations?.length||0)===0){
          const label=ci.sku||oi.sku||('item '+oi.item_index);
          console.error('[DB] SAFETY: Blocking SO save — '+label+' had',oldN,'decoration(s) in DB but client has 0');
          if(_dbNotify)_dbNotify('Save blocked — decoration data for '+label+' would be lost. Please reload the page.','error');
          if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'per-item deco safety: '+label+' had '+oldN+' deco(s) in DB, client had 0'});
          return false;
        }
      }
    }
    // PO line preservation: rebuild any purchase-order lines the user did NOT delete.
    // so_items are deleted and reinserted with fresh ids on every save, so po_lines must be re-supplied from the
    // in-memory items below. If the client's PO state is stale — a timed-out so_item_po_lines load (the SO-1038 /
    // "PO 3021/3022 DOHSF vanished" failure) or POs another user/tab added that this client never saw — those rows
    // would be silently wiped. We read the live DB PO lines and re-inject any the client was never aware of, so
    // ONLY deliberate deletions (a PO the client loaded and then removed) actually stick.
    const _restoredLines=[];// restored PO/pick lines, pushed back into React state after both restore passes
    if(oldItemIds.length){
      const{data:_dbPoRows,error:_dbPoErr}=await _retryNet(()=>supabase.from('so_item_po_lines').select('*').in('so_item_id',oldItemIds));
      if(_dbPoErr){
        console.error('[DB] SAFETY: Blocking SO save — failed to read existing PO lines for',so.id,':',_dbPoErr.message);
        if(_dbNotify)_dbNotify('Save blocked — could not verify existing purchase orders. Please reload the page.','error');
        if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'so_item_po_lines SELECT errored: '+_dbPoErr.message});
        return false;
      }
      if(_dbPoRows&&_dbPoRows.length){
        const _oldById=new Map(_oldSoItems.map(oi=>[oi.id,oi]));
        const _clientPoIds=new Set((items||[]).flatMap(it=>(it.po_lines||[]).map(p=>p.po_id).filter(Boolean)));
        // po_ids the client knew about = ones it currently holds ∪ ones present when it loaded. Removing one of
        // these is an intentional deletion; a DB po_id in neither set is one this client never saw.
        const _knownPoIds=new Set([..._clientPoIds,...(Array.isArray(so._hydratedPoIds)?so._hydratedPoIds:[])]);
        const _posHydrated=so._posHydrated!==false;
        let _restored=0,_unrestorable=0;
        _dbPoRows.forEach(row=>{
          const poId=row.po_id;
          // Client still holds this PO somewhere — it will re-save its own (possibly edited) copy. Skip to avoid dupes.
          if(_clientPoIds.has(poId))return;
          // Deliberately deleted: the client loaded this PO cleanly and chose to drop it. Honor the deletion.
          if(_posHydrated&&_knownPoIds.has(poId))return;
          // Otherwise the client never knew about this PO — re-inject it onto its original item so the save preserves it.
          const oi=_oldById.get(row.so_item_id);
          // Match by original position first, falling back to SKU(+color) across all items so a
          // removed/reordered sibling line doesn't make this row unmatchable and block the save.
          const _ti=oi?_matchRestoreItem(oi,items):-1;
          const ci=_ti>=0?items[_ti]:null;
          if(!ci){_unrestorable++;return;}
          const{id:_id,so_item_id:_sid,sizes,...rest}=row;const recovered={...rest,...(sizes||{})};
          if(recovered._billed&&!recovered.billed){recovered.billed=recovered._billed;delete recovered._billed;}
          if(recovered._tracking_numbers&&!recovered.tracking_numbers){recovered.tracking_numbers=recovered._tracking_numbers;delete recovered._tracking_numbers;}
          ci.po_lines=[...(ci.po_lines||[]),recovered];_restored++;
          _restoredLines.push({idx:_ti,sku:ci.sku||null,kind:'po',line:recovered});
        });
        if(_restored){console.warn('[DB] Restored',_restored,'undeleted PO line(s) for',so.id,'(stale/foreign client state)');if(_dataLossAlert)_dataLossAlert({kind:'po_restored',soId:so.id,restored:_restored});}
        if(_unrestorable){
          // An undeleted PO couldn't be matched to a current item — block rather than silently lose it.
          console.error('[DB] SAFETY: Blocking SO save —',_unrestorable,'undeleted PO line(s) for',so.id,'could not be matched to current items');
          if(_dbNotify)_dbNotify('Save blocked — purchase order data could not be safely preserved. Please reload the page.','error');
          if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'PO restore: '+_unrestorable+' undeleted PO line(s) unmatched'});
          return false;
        }
      }
    }
    // Duplicate-PO guard: drop any newly-introduced po_id whose size signature exactly matches
    // a clean (un-received/un-billed/un-shipped) PO line already on the same item. Catches the
    // "two creates raced against a stale open-size view" pattern (SO-1080, SO-1059, SO-1101)
    // where the counter advanced (so the new po_id differs) but the units were already covered.
    if(items&&items.length){
      const _dbPoIdSet=new Set((oldItemIds.length?(await(async()=>{try{const r=await supabase.from('so_item_po_lines').select('po_id').in('so_item_id',oldItemIds);return(r.data||[]).map(x=>x.po_id).filter(Boolean)}catch{return[]}})()):[]));
      const _poMeta=new Set(['po_id','vendor','status','received','shipments','cancelled','created_at','expected_date','memo','po_type','deco_vendor','deco_type','unit_cost','drop_ship','billed','tracking_numbers','preexisting','batch_queue_id','batch_po_number','notes']);
      const _sizeSig=pl=>{const ks=Object.keys(pl||{}).filter(k=>!k.startsWith('_')&&!_poMeta.has(k)&&typeof pl[k]==='number'&&pl[k]>0).sort();return ks.map(k=>k+':'+pl[k]).join('|')};
      const _isClean=pl=>{
        if(pl.status&&pl.status!=='waiting'&&pl.status!=='queued')return false;
        const anyPos=o=>o&&Object.values(o).some(v=>typeof v==='number'&&v>0);
        if(anyPos(pl.received)||anyPos(pl.billed)||anyPos(pl.cancelled))return false;
        if(Array.isArray(pl.shipments)&&pl.shipments.length>0)return false;
        if(Array.isArray(pl.tracking_numbers)&&pl.tracking_numbers.length>0)return false;
        return true;
      };
      let _dupesDropped=0;const _droppedSummary=[];
      items.forEach((it,ii)=>{
        const pls=Array.isArray(it.po_lines)?it.po_lines:[];if(pls.length<2)return;
        const bySig={};
        pls.forEach((pl,pi)=>{const sig=_sizeSig(pl);if(!sig)return;(bySig[sig]=bySig[sig]||[]).push({pl,pi})});
        const drop=new Set();
        Object.values(bySig).forEach(group=>{
          if(group.length<2)return;
          const clean=group.filter(g=>_isClean(g.pl));
          if(clean.length<2)return;
          const dbKnown=clean.filter(g=>g.pl.po_id&&_dbPoIdSet.has(g.pl.po_id));
          const newOnes=clean.filter(g=>!g.pl.po_id||!_dbPoIdSet.has(g.pl.po_id));
          if(dbKnown.length>=1&&newOnes.length>=1){
            newOnes.forEach(g=>drop.add(g.pi));
          }else if(dbKnown.length===0&&newOnes.length>=2){
            // Both new in this save — keep the lowest-sorted po_id, drop the rest.
            newOnes.slice().sort((a,b)=>String(a.pl.po_id||'').localeCompare(String(b.pl.po_id||''))).slice(1).forEach(g=>drop.add(g.pi));
          }
        });
        if(drop.size){
          drop.forEach(pi=>_droppedSummary.push((pls[pi]&&pls[pi].po_id)||'?'));
          items[ii]={...it,po_lines:pls.filter((_,pi)=>!drop.has(pi))};
          _dupesDropped+=drop.size;
        }
      });
      if(_dupesDropped){
        console.warn('[DB] PO dedup: dropped',_dupesDropped,'duplicate PO line(s) on',so.id,'-',_droppedSummary.join(', '));
      }
    }
    // Pick line preservation: same hazard as PO lines — picks are deleted and rebuilt from in-memory items on every
    // save, so a stale/timed-out so_item_pick_lines load (or picks another user added) would be silently wiped.
    // Re-inject any pick the client never deliberately deleted; only intentional removals stick.
    if(oldItemIds.length){
      const{data:_dbPickRows,error:_dbPickErr}=await supabase.from('so_item_pick_lines').select('*').in('so_item_id',oldItemIds);
      if(_dbPickErr){
        console.error('[DB] SAFETY: Blocking SO save — failed to read existing pick lines for',so.id,':',_dbPickErr.message);
        if(_dbNotify)_dbNotify('Save blocked — could not verify existing picks. Please reload the page.','error');
        if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'so_item_pick_lines SELECT errored: '+_dbPickErr.message});
        return false;
      }
      if(_dbPickRows&&_dbPickRows.length){
        const _oldById=new Map(_oldSoItems.map(oi=>[oi.id,oi]));
        const _clientPickIds=new Set((items||[]).flatMap(it=>(it.pick_lines||[]).map(p=>p.pick_id).filter(Boolean)));
        const _knownPickIds=new Set([..._clientPickIds,...(Array.isArray(so._hydratedPickIds)?so._hydratedPickIds:[])]);
        const _picksHydrated=so._picksHydrated!==false;
        let _restored=0,_unrestorable=0;
        _dbPickRows.forEach(row=>{
          const pickId=row.pick_id;
          if(pickId&&_clientPickIds.has(pickId))return;
          if(_picksHydrated&&pickId&&_knownPickIds.has(pickId))return;
          const oi=_oldById.get(row.so_item_id);
          const _ti=oi?_matchRestoreItem(oi,items):-1;
          const ci=_ti>=0?items[_ti]:null;
          if(!ci){_unrestorable++;return;}
          const{id:_id,so_item_id:_sid,sizes,...rest}=row;const recovered={...rest,...(sizes||{})};
          ci.pick_lines=[...(ci.pick_lines||[]),recovered];_restored++;
          _restoredLines.push({idx:_ti,sku:ci.sku||null,kind:'pick',line:recovered});
        });
        if(_restored){console.warn('[DB] Restored',_restored,'undeleted pick line(s) for',so.id,'(stale/foreign client state)');if(_dataLossAlert)_dataLossAlert({kind:'picks_restored',soId:so.id,restored:_restored});}
        if(_unrestorable){
          console.error('[DB] SAFETY: Blocking SO save —',_unrestorable,'undeleted pick line(s) for',so.id,'could not be matched to current items');
          if(_dbNotify)_dbNotify('Save blocked — pick data could not be safely preserved. Please reload the page.','error');
          if(_dataLossAlert)_dataLossAlert({kind:'blocked',soId:so.id,reason:'pick restore: '+_unrestorable+' undeleted pick line(s) unmatched'});
          return false;
        }
      }
    }
    // Push restored lines back into React state (sos + open editor). Without this the restore only
    // patches this save's payload: the editor never learns about the lines, drops them again on its
    // next save, and the guard re-restores forever — turning into a hard block as soon as the
    // line-item structure shifts (the SO-1132 failure).
    if(_restoredLines.length&&_restoredLinesSync){try{_restoredLinesSync(so.id,_restoredLines)}catch(e){console.warn('[DB] restored-line state sync failed:',e)}}
    // DATA-LOSS FIX: do NOT delete old item rows (or their decorations/picks/POs) here. We insert the new rows
    // first and only remove the old ones once the insert is verified (see "Commit/rollback the swap" below).
    // so_items has no unique (so_id,item_index) constraint, so new+old rows can briefly coexist. This closes the
    // window where a committed delete followed by a timed-out insert left the order permanently empty.
    // Sync jobs: upsert current jobs, delete removed ones (avoids DELETE+INSERT race condition)
    if(jobs?.length){
      // Deduplicate jobs by id to prevent "ON CONFLICT DO UPDATE cannot affect row a second time" error
      const _seenJobIds=new Set();const dedupedJobs=jobs.filter(j=>{if(!j.id||_seenJobIds.has(j.id))return false;_seenJobIds.add(j.id);return true});
      const jobRows=dedupedJobs.map(j=>({..._pick(j,_jobCols),so_id:so.id}));
      const{error:jobErr}=await supabase.from('so_jobs').upsert(jobRows,{onConflict:'so_id,id'});
      if(jobErr){
        if(jobErr.message?.includes('schema cache')||jobErr.message?.includes('column')||jobErr.code==='PGRST204'||jobErr.message?.includes('not found')){
          const coreRows=jobRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_jobExtraCols.has(k))cr[k]=r[k]});return cr});
          const{error:jobErr2}=await supabase.from('so_jobs').upsert(coreRows,{onConflict:'so_id,id'});
          if(jobErr2){console.error('[DB] so_jobs upsert failed (core):',jobErr2.message,jobErr2.details);saveFailed=true;_failMsg=_failMsg||('so_jobs: '+jobErr2.message)}
        }else{console.error('[DB] so_jobs upsert failed:',jobErr.message,jobErr.details);saveFailed=true;_failMsg=_failMsg||('so_jobs: '+jobErr.message)}
      }
      // Delete jobs that no longer exist (scoped to this SO so a shared id can't wipe another order's job)
      const currentJobIds=jobs.map(j=>j.id).filter(Boolean);
      if(currentJobIds.length){
        const{data:existingJobs}=await supabase.from('so_jobs').select('id').eq('so_id',so.id);
        const toDelete=(existingJobs||[]).filter(ej=>!currentJobIds.includes(ej.id)).map(ej=>ej.id);
        if(toDelete.length)await supabase.from('so_jobs').delete().eq('so_id',so.id).in('id',toDelete);
      }
    }else if(Array.isArray(jobs)&&so._jobsHydrated!==false){
      // Intentional empty jobs list (syncJobs retired every job after line art was cleared, or admin
      // deleted the last job). Mirror the art_files=[] path: only wipe when jobs hydrated cleanly so a
      // timed-out so_jobs load can't delete real rows. Previously we left DB jobs untouched on empty
      // arrays, which is why JOB-1057-01 survived after decorations were wiped (syncJobs→[] never
      // reached the delete branch).
      // WIPE GUARD (SO-1487, 2026-07-10): a client whose in-memory decorations are transiently
      // stale/empty computes syncJobs()→[] and lands here, blanket-deleting jobs that were just
      // released for art (5 SOs lost their jobs this way in 2 days). Released/submitted jobs carry
      // irreplaceable state (art requests, approvals, artist assignment), so they may only be
      // deleted here when the payload names them explicitly (so._deleteJobIds — set by the admin
      // Delete Job button). Auto needs_art placeholders still delete freely: that is the JOB-1057
      // retirement case, and syncJobs regenerates them from live decorations anyway.
      const _explicitDel=new Set(Array.isArray(so._deleteJobIds)?so._deleteJobIds:[]);
      const{data:_dbJobRows,error:_dbJobErr}=await supabase.from('so_jobs').select('id,key,art_status').eq('so_id',so.id);
      if(_dbJobErr){
        console.error('[DB] SAFETY: skipping so_jobs wipe for',so.id,'— could not read existing jobs:',_dbJobErr.message);
      }else{
        const _isProtectedJob=r=>!_explicitDel.has(r.id)&&((r.key||'').startsWith('released_')||(r.art_status&&r.art_status!=='needs_art'));
        const _blocked=(_dbJobRows||[]).filter(_isProtectedJob);
        const _delIds=(_dbJobRows||[]).filter(r=>!_isProtectedJob(r)).map(r=>r.id);
        if(_delIds.length)await supabase.from('so_jobs').delete().eq('so_id',so.id).in('id',_delIds);
        if(_blocked.length){
          console.error('[DB] SAFETY: blocked wipe of',_blocked.length,'released/submitted job(s) on',so.id,'from an empty jobs save:',_blocked.map(r=>r.id).join(', '));
          if(_dbNotify)_dbNotify('Blocked deletion of '+_blocked.length+' submitted job(s) on '+so.id+' — your view may be out of date. Please reload the page.','error');
          if(_dataLossAlert)_dataLossAlert({kind:'jobs_wipe_blocked',soId:so.id,blocked:_blocked.map(r=>r.id)});
        }
      }
    }
    // If jobs is undefined/null (not hydrated / not present on the payload), leave existing DB jobs
    // untouched. Orphaned jobs from a recycled SO number are cleaned at order creation (new-SO purge)
    // and dead frozen jobs are retired by syncJobs + the load-time live-decoration filter.
    await supabase.from('so_firm_dates').delete().eq('so_id',so.id);
    // Art files already synced above (before the bgSync item-shrink guard). No second sync needed here.
    // If art_files is undefined/null (not hydrated), leave existing DB art files untouched to prevent accidental data loss
    if(firm_dates?.length){const{error:fdErr}=await supabase.from('so_firm_dates').insert(firm_dates.map(f=>({..._pick(f,_firmDateCols),so_id:so.id})));if(fdErr){console.error('[DB] so_firm_dates insert failed:',fdErr.message);saveFailed=true;_failMsg=_failMsg||('so_firm_dates: '+fdErr.message)}}
    if(!items?.length){
      if(saveFailed){if(_isAuthError({message:_failMsg}))return _handleAuthSaveFailure(so.id,{message:_failMsg});_dbSaveFailedIds.add(so.id);_recordSaveError(so.id,_failMsg||'unknown SO save error');_persistFailedIds();if(_dbNotify)_dbNotify('Sales order save incomplete: '+(_failMsg||'see console'),'error');return false}
      // Intentional removal of all items (validated by the safety guards above). Since we no longer delete
      // upfront, remove the old item rows and their children here.
      if(oldItemIds.length){
        await supabase.from('so_item_decorations').delete().in('so_item_id',oldItemIds);
        await supabase.from('so_item_pick_lines').delete().in('so_item_id',oldItemIds);
        await supabase.from('so_item_po_lines').delete().in('so_item_id',oldItemIds);
        await supabase.from('so_items').delete().in('id',oldItemIds);
      }
      _dbSaveFailedIds.delete(so.id);_clearSaveError(so.id);_persistFailedIds();if(so._version)so._version=so._version+1;return true}
    // Batch insert all items at once (much faster than one-by-one)
    const allItemRows=items.map((item,idx)=>{const{decorations,pick_lines,po_lines,...itemData}=item;return{..._pick(itemData,_itemCols),so_id:so.id,item_index:idx}});
    let{data:insertedItems,error:itemErr}=await supabase.from('so_items').insert(allItemRows).select('id');
    if(itemErr){
      if(itemErr.message?.includes('product_id')||itemErr.code==='23503'){
        const fkRows=allItemRows.map(r=>({...r,product_id:null}));
        const fkRetry=await supabase.from('so_items').insert(fkRows).select('id');
        if(!fkRetry.error){insertedItems=fkRetry.data;console.warn('[DB] so items saved with product_id nulled (FK constraint)')}
        else{itemErr=fkRetry.error}
      }
      if(!insertedItems){
        const coreRows=allItemRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_itemExtraCols.has(k))cr[k]=r[k]});return cr});
        const retry=await supabase.from('so_items').insert(coreRows).select('id');
        if(retry.error){
          const coreNullPid=coreRows.map(r=>({...r,product_id:null}));
          const retry2=await supabase.from('so_items').insert(coreNullPid).select('id');
          if(retry2.error){console.error('[DB] so_items batch insert failed:',retry2.error.message,retry2.error.details);saveFailed=true;_failMsg=_failMsg||('so_items: '+retry2.error.message+(retry2.error.details?' ('+retry2.error.details+')':''))}
          else{insertedItems=retry2.data;console.warn('[DB] so items saved with core columns + product_id nulled')}
        }
        else{insertedItems=retry.data;console.warn('[DB] so items saved with core columns only')}
      }
    }
    if(insertedItems?.length){
      // Build all child rows referencing their parent item IDs
      const allDecoRows=[],allPickRows=[],allPoRows=[];
      items.forEach((item,idx)=>{
        const itemId=insertedItems[idx]?.id;if(!itemId)return;
        const{decorations,pick_lines,po_lines}=item;
        if(decorations?.length)decorations.forEach((d,di)=>allDecoRows.push({..._pick(_sanitizeDeco(d),_decoCols),so_item_id:itemId,deco_index:di}));
        if(pick_lines?.length)pick_lines.forEach(pk=>{const{pick_id,status,created_at,memo,ship_dest,ship_addr,deco_vendor,...sizes}=pk;allPickRows.push({so_item_id:itemId,pick_id,status,created_at,memo,ship_dest,ship_addr,deco_vendor,sizes})});
        if(po_lines?.length)po_lines.forEach(po=>{const{po_id,vendor,received,cancelled,shipments,status,created_at,expected_date,memo,po_type,deco_vendor,deco_type,unit_cost,drop_ship,billed,tracking_numbers,_bill_details,_bill_cost,...sizes}=po;
          allPoRows.push({so_item_id:itemId,po_id,vendor,received:received||{},cancelled:cancelled||{},shipments:shipments||[],status,created_at,expected_date,memo,
            billed:billed||{},tracking_numbers:tracking_numbers||[],
            sizes:{...sizes,po_type:po_type||undefined,deco_vendor:deco_vendor||undefined,deco_type:deco_type||undefined,unit_cost:unit_cost||undefined,drop_ship:drop_ship||undefined,_bill_details:_bill_details||undefined,_bill_cost:_bill_cost||undefined}})});
      });
      // Batch insert decorations
      if(allDecoRows.length){
        const{error:decoErr}=await supabase.from('so_item_decorations').insert(allDecoRows);
        if(decoErr){
          const coreRows=allDecoRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_decoExtraCols.has(k))cr[k]=r[k]});return cr});
          const{error:coreErr}=await supabase.from('so_item_decorations').insert(coreRows);
          if(coreErr){saveFailed=true;_failMsg=_failMsg||('so_item_decorations: '+coreErr.message+(coreErr.details?' ('+coreErr.details+')':''));console.error('[DB] so_item_decorations batch failed:',coreErr.message)}
          else console.warn('[DB] so decos saved with core columns only')
        }
        // Post-insert verification: count rows actually persisted; if fewer than expected, mark failed so we retry rather than accept a partial save as canonical.
        if(!saveFailed){
          const{count:_verifyCount,error:_verifyErr}=await _countInsertedChildRows('so_item_decorations',insertedItems.map(i=>i.id));
          if(_verifyErr){
            saveFailed=true;_failMsg=_failMsg||('so_item_decorations: verification read-back failed: '+_verifyErr.message);
            console.error('[DB] SO deco verification read-back failed (inconclusive, save queued for retry):',_verifyErr.message);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allDecoRows.length,got:null,reason:'so_item_decorations: verification read-back failed ('+_verifyErr.message+') — data intact, save queued for retry'});
          }else if(_verifyCount<allDecoRows.length){
            saveFailed=true;_failMsg=_failMsg||('so_item_decorations: only '+_verifyCount+' of '+allDecoRows.length+' rows persisted');
            console.error('[DB] SAFETY: SO deco insert verification failed — expected',allDecoRows.length,'got',_verifyCount);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allDecoRows.length,got:_verifyCount,reason:'so_item_decorations: wrote '+allDecoRows.length+', persisted '+_verifyCount+' — save queued for retry'});
          }
        }
      }
      // Batch insert pick lines
      if(allPickRows.length){
        const{error:pickErr}=await supabase.from('so_item_pick_lines').insert(allPickRows);
        if(pickErr){saveFailed=true;_failMsg=_failMsg||('so_item_pick_lines: '+pickErr.message);console.error('[DB] so_item_pick_lines batch failed:',pickErr.message)}
        // Post-insert verification: confirm rows persisted rather than letting a partial save drop picks silently.
        if(!saveFailed){
          const{count:_verifyPickCount,error:_verifyPickErr}=await _countInsertedChildRows('so_item_pick_lines',insertedItems.map(i=>i.id));
          if(_verifyPickErr){
            saveFailed=true;_failMsg=_failMsg||('so_item_pick_lines: verification read-back failed: '+_verifyPickErr.message);
            console.error('[DB] SO pick-line verification read-back failed (inconclusive, save queued for retry):',_verifyPickErr.message);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allPickRows.length,got:null,reason:'so_item_pick_lines: verification read-back failed ('+_verifyPickErr.message+') — data intact, save queued for retry'});
          }else if(_verifyPickCount<allPickRows.length){
            saveFailed=true;_failMsg=_failMsg||('so_item_pick_lines: only '+_verifyPickCount+' of '+allPickRows.length+' rows persisted');
            console.error('[DB] SAFETY: SO pick-line insert verification failed — expected',allPickRows.length,'got',_verifyPickCount);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allPickRows.length,got:_verifyPickCount,reason:'so_item_pick_lines: wrote '+allPickRows.length+', persisted '+_verifyPickCount+' — save queued for retry'});
          }
        }
      }
      // Batch insert PO lines
      if(allPoRows.length){
        const corePoRows=allPoRows.map(row=>{const{billed:b,tracking_numbers:tn,...coreRow}=row;return{...coreRow,sizes:{...(coreRow.sizes||{}),_billed:b||{},_tracking_numbers:tn||[]}}});
        const{error:poErr}=await supabase.from('so_item_po_lines').insert(allPoRows);
        if(poErr){
          const{error:coreErr}=await supabase.from('so_item_po_lines').insert(corePoRows);
          if(coreErr){saveFailed=true;_failMsg=_failMsg||('so_item_po_lines: '+coreErr.message);console.error('[DB] so_item_po_lines batch failed:',coreErr.message)}
          else console.warn('[DB] PO lines saved without billed/tracking_numbers columns')
        }
        // Post-insert verification: confirm rows actually persisted; if fewer than expected, mark failed so we retry
        // rather than letting a partial save become canonical (and silently drop PO lines).
        if(!saveFailed){
          const{count:_verifyPoCount,error:_verifyPoErr}=await _countInsertedChildRows('so_item_po_lines',insertedItems.map(i=>i.id));
          if(_verifyPoErr){
            saveFailed=true;_failMsg=_failMsg||('so_item_po_lines: verification read-back failed: '+_verifyPoErr.message);
            console.error('[DB] SO PO-line verification read-back failed (inconclusive, save queued for retry):',_verifyPoErr.message);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allPoRows.length,got:null,reason:'so_item_po_lines: verification read-back failed ('+_verifyPoErr.message+') — data intact, save queued for retry'});
          }else if(_verifyPoCount<allPoRows.length){
            saveFailed=true;_failMsg=_failMsg||('so_item_po_lines: only '+_verifyPoCount+' of '+allPoRows.length+' rows persisted');
            console.error('[DB] SAFETY: SO PO-line insert verification failed — expected',allPoRows.length,'got',_verifyPoCount);
            if(_dataLossAlert)_dataLossAlert({kind:'verify_fail',soId:so.id,expected:allPoRows.length,got:_verifyPoCount,reason:'so_item_po_lines: wrote '+allPoRows.length+', persisted '+_verifyPoCount+' — save queued for retry'});
          }
        }
      }
    }
    // Commit/rollback the swap: new rows were inserted alongside the old ones (we no longer delete upfront).
    if(insertedItems?.length){
      if(!saveFailed){
        // New items + children verified — now safe to remove the old rows (delete by id so the new rows survive).
        if(oldItemIds.length){
          await supabase.from('so_item_decorations').delete().in('so_item_id',oldItemIds);
          await supabase.from('so_item_pick_lines').delete().in('so_item_id',oldItemIds);
          await supabase.from('so_item_po_lines').delete().in('so_item_id',oldItemIds);
          await supabase.from('so_items').delete().in('id',oldItemIds);
        }
      }else{
        // New rows did not fully persist — roll them back so the old data stays canonical and the retry starts clean.
        const _newIds=insertedItems.map(i=>i.id).filter(Boolean);
        if(_newIds.length){
          await supabase.from('so_item_decorations').delete().in('so_item_id',_newIds);
          await supabase.from('so_item_pick_lines').delete().in('so_item_id',_newIds);
          await supabase.from('so_item_po_lines').delete().in('so_item_id',_newIds);
          await supabase.from('so_items').delete().in('id',_newIds);
        }
      }
    }
    // Bump updated_at LAST — so cross-tab polls only see the new timestamp after all children are in place
    if(finalUpdatedAt!==existingSO?.updated_at){
      await supabase.from('sales_orders').update({updated_at:finalUpdatedAt}).eq('id',so.id);
    }
    if(saveFailed){if(_isAuthError({message:_failMsg}))return _handleAuthSaveFailure(so.id,{message:_failMsg});_dbSaveFailedIds.add(so.id);_recordSaveError(so.id,_failMsg||'unknown SO save error');_persistFailedIds();if(_dbNotify)_dbNotify('Sales order save incomplete: '+(_failMsg||'see console'),'error');return false}
    _dbSaveFailedIds.delete(so.id);_clearSaveError(so.id);_persistFailedIds();_dbRecentSaves[so.id]=Date.now();
    // Bump local version to match server (DB trigger increments on UPDATE)
    if(so._version)so._version=so._version+1;
    return true;
  }catch(e){console.error('[DB] save SO:',e);if(_isAuthError(e))return _handleAuthSaveFailure(so.id,e);_dbSaveFailedIds.add(so.id);_recordSaveError(so.id,e.message||String(e));_persistFailedIds();if(_dbNotify)_dbNotify('Sales order save failed: '+e.message,'error');return false}});
};
// Shadow-capture hook (OFF unless REACT_APP_SO_CAPTURE==='1'): after a SUCCESSFUL
// SO save, fire-and-forget a copy of the saved order + its persisted state to the
// capture-so-save endpoint (-> so_save_audit), so the future transactional
// save_sales_order RPC can be A/B-validated by replaying real saves. Fully
// isolated — it can never block or fail a save; _dbSaveSO's return value is
// untouched, and every call is wrapped so it can't throw into the save path.
const _SO_CAPTURE_ENABLED = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SO_CAPTURE === '1');
const _captureSoSave = (so, savePromise) => {
  if (!_SO_CAPTURE_ENABLED) return;
  Promise.resolve(savePromise).then((ok) => {
    if (ok !== true) return; // only capture saves that actually succeeded
    try {
      authFetch('/.netlify/functions/capture-so-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ so_id: so.id, payload: so }) }).catch(() => {});
    } catch (_) { /* never let capture affect the save */ }
  }).catch(() => {});
};
const _dbSaveSO = (so) => { const _p = _outboxWrap('sales_orders', so, _queuedEntitySave(so.id, so, _dbSaveSOInner)); _captureSoSave(so, _p); return _p; };
// Lightweight save for art-file-only edits (add/remove/tag a mockup or production file). Syncs ONLY so_art_files —
// never deletes/reinserts items, decorations, or PO lines — so a simple file change can't trip the order-save
// data-loss guards or partially re-persist line items. Mirrors the art_files sync in _dbSaveSOInner.
const _dbSaveArtFilesInner = async (so) => {
  if(!supabase)return false;
  return _dbSavingGuard(async()=>{try{
    const art_files=so.art_files;
    if(!Array.isArray(art_files))return true;// nothing hydrated to sync
    const{data:_dbAf,error:_dbAfErr}=await _retryNet(()=>supabase.from('so_art_files').select('*').eq('so_id',so.id));
    if(_dbAfErr){if(_isAuthError(_dbAfErr))return _handleAuthSaveFailure(so.id,_dbAfErr);console.error('[DB] so_art_files read failed:',_dbAfErr.message);if(_dbNotify)_dbNotify('Could not save artwork file change: '+_dbAfErr.message,'error');return false}
    const _dbAfVerById=new Map((_dbAf||[]).map(r=>[r.id,r._version||0]));
    if(art_files.length){
      const _resolved=_resolveArtRows(art_files,_dbAf,so.id);
      {
        const soAfRows=_resolved.map(({row})=>_sanitizeArtRow({..._pick(row,_artCols),archived:!!row.archived,so_id:so.id}));
        const{error:afErr}=await _retryNet(()=>supabase.from('so_art_files').upsert(soAfRows,{onConflict:'so_id,id'}));
        if(afErr){
          if(_isAuthError(afErr))return _handleAuthSaveFailure(so.id,afErr);
          if(afErr.message?.includes('art_sizes')||afErr.message?.includes('garment_colors')||afErr.message?.includes('item_mockups')||afErr.message?.includes('schema cache')||afErr.code==='PGRST204'||afErr.message?.includes('not found')){
            const coreRows=soAfRows.map(r=>{const cr={};Object.keys(r).forEach(k=>{if(!_artExtraCols.has(k))cr[k]=r[k]});return cr});
            const{error:afErr2}=await supabase.from('so_art_files').upsert(coreRows,{onConflict:'so_id,id'});
            if(afErr2){if(_isAuthError(afErr2))return _handleAuthSaveFailure(so.id,afErr2);console.error('[DB] so_art_files upsert failed (core):',afErr2.message);if(_dbNotify)_dbNotify('Artwork file change failed to save: '+afErr2.message,'error');return false}
          }else{console.error('[DB] so_art_files upsert failed:',afErr.message);if(_dbNotify)_dbNotify('Artwork file change failed to save: '+afErr.message,'error');return false}
        }
        _resolved.forEach(({client,baseVersion})=>{client._version=baseVersion+1});
      }
      const currentAfIds=new Set(art_files.map(a=>a.id).filter(Boolean));
      const _knownArtIds=new Set(Array.isArray(so._hydratedArtIds)?so._hydratedArtIds:[]);
      const toDeleteAf=(_dbAf||[]).filter(ea=>!currentAfIds.has(ea.id)&&_knownArtIds.has(ea.id)).map(ea=>ea.id);
      if(toDeleteAf.length)await _retryNet(()=>supabase.from('so_art_files').delete().eq('so_id',so.id).in('id',toDeleteAf));
    }else if(so._artHydrated!==false){
      const _knownArtIds=(Array.isArray(so._hydratedArtIds)?so._hydratedArtIds:[]).filter(id=>_dbAfVerById.has(id));
      if(_knownArtIds.length)await _retryNet(()=>supabase.from('so_art_files').delete().eq('so_id',so.id).in('id',_knownArtIds));
    }
    // Bump the order's updated_at to the value savArtFiles already set on the local copy. The lightweight art
    // save otherwise never touches the sales_orders row, so the client's updated_at stays permanently ahead of
    // the DB. That mismatch defeats the poll-merge fast-path (App.js mergeSO), which then wholesale-replaces this
    // SO from a possibly-stale DB snapshot and drops a just-added art group from the open editor — even though
    // the row persisted fine. Keeping the timestamps in sync lets the poll recognize there's nothing to change.
    if(so.updated_at)await _retryNet(()=>supabase.from('sales_orders').update({updated_at:so.updated_at}).eq('id',so.id));
    // Register this art save as "recently saved by this client" so the reconciliation art-superset guard (and the
    // version-conflict skip) treats the local copy as the fresher one for the next ~60s. The lightweight art save
    // otherwise never set this, unlike the full SO/estimate/customer saves.
    _dbRecentSaves[so.id]=Date.now();
    return true;
  }catch(e){if(_isAuthError(e))return _handleAuthSaveFailure(so.id,e);console.error('[DB] save art files:',e);if(_dbNotify)_dbNotify('Artwork file change failed to save: '+(e.message||e),'error');return false}});
};
const _dbSaveArtFiles = (so) => _outboxWrap('sales_orders', so, _queuedEntitySave(so.id, so, _dbSaveArtFilesInner), true/*addOnly: art-only success must not clear a failed full-SO payload*/);
const _invCols=['id','customer_id','so_id','date','due_date','total','paid','memo','status','type','inv_type','deposit_pct','tax','tax_rate','tax_exempt','shipping','cc_fee','email_status','email_sent_at','email_opened_at','follow_up_at','sent_history','print_history','line_items','qb_invoice_id','tc_reported','tc_tax','created_at','updated_at','billing_name','billing_address','shipping_name','shipping_address','follow_up_auto','follow_up_interval_days','follow_up_message','follow_up_to','follow_up_count','follow_up_max','follow_up_last_sent_at'];
const _invExtraCols=new Set(['qb_invoice_id','tc_reported','tc_tax','billing_name','billing_address','shipping_name','shipping_address','follow_up_auto','follow_up_interval_days','follow_up_message','follow_up_to','follow_up_count','follow_up_max','follow_up_last_sent_at']);
const _dbSaveInvoiceInner = async (inv) => {
  if(!supabase)return;
  return _dbSavingGuard(async()=>{try{
    // Optimistic concurrency (00180) — same _checkVersion auto-heal the SO/estimate/customer saves
    // use: a numeric return means another session saved after our copy loaded; adopt the server
    // version so the counter doesn't fall behind (the poll/realtime merge guards key off it).
    // _version itself is never written — the DB trigger owns it (not in _invCols).
    if(inv._version){const vc=await _checkVersion('invoices',inv.id,inv._version);if(vc!==true&&typeof vc==='number'){inv._version=vc}}
    const{payments,items,...rest}=inv;
    let invRow=_pick(rest,_invCols);
    const{error:invErr}=await supabase.from('invoices').upsert(invRow,{onConflict:'id'});
    if(invErr){
      console.warn('[DB] invoices upsert failed, retrying without extra cols:',invErr.message);
      const coreRow={};Object.keys(invRow).forEach(k=>{if(!_invExtraCols.has(k))coreRow[k]=invRow[k]});
      const{error:invErr2}=await supabase.from('invoices').upsert(coreRow,{onConflict:'id'});
      if(invErr2){console.error('[DB] invoices upsert failed (core):',invErr2.message);_dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoices: '+invErr2.message);_persistFailedIds();return false}
    }
    // Payment preservation: payments are financial records — never let a stale/timed-out client drop one another
    // user (or this user, before a clean load) recorded. Read the live DB payments and re-inject any ref the client
    // was never aware of, so only a payment the client loaded and then deleted is actually removed.
    let _payments=payments;
    {
      const{data:_dbPays,error:_dbPayErr}=await supabase.from('invoice_payments').select('*').eq('invoice_id',inv.id);
      if(_dbPayErr){
        console.error('[DB] SAFETY: Blocking invoice save — failed to read existing payments for',inv.id,':',_dbPayErr.message);
        if(_dbNotify)_dbNotify('Save blocked — could not verify existing payments. Please reload the page.','error');
        _dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoice_payments SELECT errored: '+_dbPayErr.message);_persistFailedIds();return false;
      }
      if(_dbPays&&_dbPays.length){
        const _clientRefs=new Set((payments||[]).map(p=>p.ref).filter(Boolean));
        const _knownRefs=new Set([..._clientRefs,...(Array.isArray(inv._hydratedPayRefs)?inv._hydratedPayRefs:[])]);
        const _payHydrated=inv._paymentsHydrated!==false;
        const _restore=[];
        _dbPays.forEach(row=>{
          const ref=row.ref;
          if(ref&&_clientRefs.has(ref))return;// client still holds it — it re-saves its own copy
          if(_payHydrated&&ref&&_knownRefs.has(ref))return;// deliberately deleted from a clean load
          _restore.push({amount:row.amount,method:row.method,ref:row.ref,date:row.date});
        });
        if(_restore.length){console.warn('[DB] Restored',_restore.length,'undeleted payment(s) for',inv.id,'(stale/foreign client state)');_payments=[...(payments||[]),..._restore];}
      }
    }
    // Sync payments: upsert current, then delete removed (avoids DELETE+INSERT race condition)
    if(_payments?.length){
      const payRows=_payments.map((p,i)=>({invoice_id:inv.id,amount:p.amount,method:p.method,ref:p.ref||('pay_'+i),date:p.date,cc_fee:p.cc_fee}));
      const{error:payErr}=await supabase.from('invoice_payments').upsert(payRows,{onConflict:'invoice_id,ref'});
      if(payErr){
        // Fallback: DELETE+INSERT if upsert constraint doesn't exist
        await supabase.from('invoice_payments').delete().eq('invoice_id',inv.id);
        await supabase.from('invoice_payments').insert(payRows);
      }else{
        // Delete payments beyond current set
        const{data:existingPays}=await supabase.from('invoice_payments').select('id,ref').eq('invoice_id',inv.id);
        const currentRefs=new Set(payRows.map(p=>p.ref));
        const toDelete=(existingPays||[]).filter(ep=>!currentRefs.has(ep.ref)).map(ep=>ep.id);
        if(toDelete.length)await supabase.from('invoice_payments').delete().in('id',toDelete);
      }
    }
    // Invoice items have no stable client id, so they can't be restore-merged like payments. Instead, fail-closed:
    // block the save if the client would drop items it never loaded (a timed-out invoice_items query yields fewer
    // items than the DB). A clean load that legitimately removed items still goes through.
    {
      const{count:_dbItemCount,error:_dbItemErr}=await supabase.from('invoice_items').select('id',{count:'exact',head:true}).eq('invoice_id',inv.id);
      if(_dbItemErr){
        console.error('[DB] SAFETY: Blocking invoice save — failed to read existing items for',inv.id,':',_dbItemErr.message);
        if(_dbNotify)_dbNotify('Save blocked — could not verify existing invoice items. Please reload the page.','error');
        _dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoice_items COUNT errored: '+_dbItemErr.message);_persistFailedIds();return false;
      }
      const _clientItemCount=(items||[]).length;
      if((_dbItemCount||0)>0&&_clientItemCount<(_dbItemCount||0)&&inv._itemsHydrated===false){
        console.error('[DB] SAFETY: Blocking invoice save —',_clientItemCount,'client item(s) vs',_dbItemCount,'in DB for',inv.id,'(items not hydrated this session)');
        if(_dbNotify)_dbNotify('Save blocked — invoice item data would be lost. Please reload the page.','error');
        _dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoice_items hydration safety: client '+_clientItemCount+' < DB '+_dbItemCount);_persistFailedIds();return false;
      }
      if(items?.length){
        await supabase.from('invoice_items').delete().eq('invoice_id',inv.id);
        const _itemRows=items.map(i=>({sku:i.sku,name:i.name,qty:i.qty,unit_price:i.unit_price,total:i.total,description:i.description,invoice_id:inv.id}));
        const{error:_itemInsErr}=await supabase.from('invoice_items').insert(_itemRows);
        if(_itemInsErr){console.error('[DB] invoice_items insert failed:',_itemInsErr.message);_dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoice_items: '+_itemInsErr.message);_persistFailedIds();return false}
        const{count:_verifyItemCount}=await supabase.from('invoice_items').select('id',{count:'exact',head:true}).eq('invoice_id',inv.id);
        if((_verifyItemCount||0)<_itemRows.length){
          console.error('[DB] SAFETY: invoice item insert verification failed — expected',_itemRows.length,'got',_verifyItemCount);
          _dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,'invoice_items: only '+(_verifyItemCount||0)+' of '+_itemRows.length+' rows persisted');_persistFailedIds();return false;
        }
      }
    }
    _dbSaveFailedIds.delete(inv.id);_clearSaveError(inv.id);_persistFailedIds();_dbRecentSaves[inv.id]=Date.now();
    // Advance the local base _version in place (the caller passed the state object) — the DB
    // trigger bumped the row on upsert-update, and the merge guards treat a strictly-newer local
    // _version as "poll row is stale". Mirrors _dbSaveSOInner.
    if(inv._version)inv._version=inv._version+1;
    return true;
  }catch(e){console.error('[DB] save invoice:',e);_dbSaveFailedIds.add(inv.id);_recordSaveError(inv.id,e.message||String(e));_persistFailedIds();return false}});
};
// Queued per invoice id (same as SOs/estimates) so a direct awaited save — e.g. the final-invoice
// commit that gates closing the SO — can't race the _diffSave effect saving the same invoice.
const _dbSaveInvoice = (inv) => _outboxWrap('invoices', inv, _queuedEntitySave(inv.id, inv, _dbSaveInvoiceInner));
let _dbNotify=null; // set by App component for visible error toasts
let _dataLossAlert=null; // set by App component — logs + emails on item-wipe attempts/events
let _restoredLinesSync=null; // set by App component — merges PO/pick lines the save guard restored back into live state so a restore sticks instead of repeating on every save
let _onEstStatusMerge=null; // set by App component — called when a version-conflict save merges a higher status from DB
// ─── Session-expiry recovery ───
// When a write fails with a 401 / JWT-expired / row-level-security error it means our Supabase auth
// session degraded to the anon role (RLS allows anon SELECT but not INSERT). Retrying the write as-is
// loops forever, so instead we attempt a one-shot session refresh; if that fails the session is truly
// dead and we force a re-login. Without this, a stale session silently spams RLS/401 errors and bogus
// "save incomplete" toasts on every poll/tab-focus regardless of which page the user is on.
let _forceReauth=null; // set by App component — clears the cached user and shows the login screen
let _sessionDead=false; // latched once the session is judged unrecoverable; prevents retry spam + repeat prompts
let _refreshInFlight=null; // de-dupes concurrent refresh attempts
const _isAuthError=(err)=>{
  if(!err)return false;
  const code=err.code||err.status;
  if(code===401||code==='401'||code==='42501'||code==='PGRST301')return true;
  const m=(err.message||'').toLowerCase();
  return m.includes('row-level security')||m.includes('jwt expired')||m.includes('jwt is expired')||m.includes('invalid jwt')||m.includes('not authenticated')||m.includes('no api key');
};
// Classify a refreshSession() outcome. 'ok' = refreshed; 'transient' = a network/blip failure — retry
// and DO NOT sign the user out; 'fatal' = the refresh token itself was rejected (invalid / already-used
// / expired), the ONLY case that should force a re-login. A thrown error is transient (it is almost
// always "Failed to fetch"). This split is what stops a momentary network hiccup — the single most
// common cause of the "it randomly logged me out" reports — from bouncing a user with a good session.
const _classifyRefresh=(error,session,threw)=>{
  if(!threw&&!error&&session)return 'ok';
  if(threw)return 'transient';
  if(error&&_isNetErr(error))return 'transient';
  return 'fatal';
};
// Returns true if the session is healthy/refreshed (caller may retry), false if it's dead.
const _recoverSession=async()=>{
  if(_sessionDead||!supabase)return false;
  if(!_refreshInFlight){
    _refreshInFlight=(async()=>{
      let fatal=false;
      for(let attempt=0;attempt<3;attempt++){
        let cls;
        try{const{data,error}=await supabase.auth.refreshSession();cls=_classifyRefresh(error,data?.session,false)}
        catch(_){cls='transient'}
        if(cls==='ok')return{ok:true};
        if(cls==='fatal'){fatal=true;break}
        if(attempt<2)await new Promise(r=>setTimeout(r,400*Math.pow(3,attempt)));// 0.4s, 1.2s backoff on a blip
      }
      return{ok:false,fatal};
    })();
    _refreshInFlight.finally(()=>{setTimeout(()=>{_refreshInFlight=null},2000)});
  }
  const res=await _refreshInFlight;
  if(res&&res.ok){_sessionDead=false;return true}
  // Only an authoritative refresh-token rejection signs the user out. Before doing so, re-read storage:
  // the SECOND Supabase client (src/lib/supabase.js, same storage key, its own auto-refresh) may have
  // just rotated the token out from under us, making our "already used" rejection benign — the session
  // is actually healthy. A transient/network failure never latches dead: the caller keeps the entity
  // queued and we retry on the next save / poll / tab-focus instead of forcing a login.
  if(res&&res.fatal){
    try{const{data:{session}}=await supabase.auth.getSession();if(session){_sessionDead=false;return true}}catch(_){}
    _sessionDead=true;if(_forceReauth)_forceReauth();
  }
  return false;
};
// A genuine PERMISSION denial (a valid session that simply lacks rights — e.g. a magic-link coach or a
// not-yet-linked account hitting a staff-only RLS policy) is NOT an expired session. It won't be fixed
// by a token refresh, so refreshing / forcing a re-login just yields a misleading "session expired"
// banner and an every-60s retry loop a re-login can never clear. Postgres reports it as 42501 /
// "row-level security" / "permission denied" — but an EXPIRED token degraded to anon also trips
// "row-level security" while carrying a jwt/expired marker and IS recoverable, so those are excluded.
// This split matters now that RLS is being enforced table-by-table.
const _isPermissionDenied=(err)=>{
  if(!err)return false;
  const m=(err.message||'').toLowerCase();
  if(/jwt|not authenticated|no api key|expired/.test(m))return false;// looks like RLS but is really an expiry — recoverable
  return (err.code||err.status)==='42501'||err.code==='42501'||m.includes('row-level security')||m.includes('permission denied');
};
// Routes an auth-related save failure: keeps the entity queued (so it auto-flushes once the session is
// restored) and triggers recovery, but suppresses the misleading per-save error toast. Always returns false.
const _handleAuthSaveFailure=(id,err)=>{
  const perm=_isPermissionDenied(err);
  if(id){_dbSaveFailedIds.add(id);_recordSaveError(id,perm?'permission denied — your account can’t save this change; contact an admin':'session expired — sign in again to save');_persistFailedIds()}
  if(!perm)_recoverSession();// a permission denial can't be refreshed away — don't churn recovery or bounce to login
  else _verifyPermDenialHasSession(id);
  return false;
};
// A "permission denied"/RLS error is only terminal when a REAL session was behind the write. When the
// login has fully expired, supabase-js falls back to sending the anon key, and the anon role hitting a
// staff-only policy produces the exact same RLS message with NO jwt/expiry marker — which used to be
// misclassified as a rights problem, so recovery never ran, no re-login was forced, and the 60s retry
// loop replayed the rejected write forever (the RLS-spam-from-an-expired-login incident, 2026-07-08).
// Async on purpose: _handleAuthSaveFailure's callers need their synchronous `false`; the recovery /
// forced re-login is a side effect. If a live session IS present, the denial is genuine and untouched.
const _verifyPermDenialHasSession=async(id)=>{
  if(!supabase||_sessionDead)return;
  try{
    const{data:{session}}=await supabase.auth.getSession();
    if(session&&!(session.expires_at&&session.expires_at<=Math.floor(Date.now()/1000)))return;// real session behind the write — genuine denial
    if(id)_recordSaveError(id,'session expired — sign in again to save');
    _recoverSession();// no live session behind the "denial" — it's a dead login; refresh or bounce to the login screen
  }catch(_){/* can't tell — keep the permission-denied classification rather than churn recovery */}
};
// Proactive guard: ensure the access token isn't expired/near-expiry *before* a write goes out. A
// hidden/idle/slept tab throttles GoTrue's auto-refresh timer, so the in-memory JWT can be stale; the
// PostgREST write path would send it as-is, the server treats the request as the anon role, and RLS
// rejects every INSERT/UPDATE (reads still work) — the silent "save failed / check your connection"
// users hit on resume. Refresh only when actually near expiry, reusing the de-duped _recoverSession()
// so a proactive refresh never races a reactive one.
const _ensureFreshSession=async()=>{
  if(!supabase||_sessionDead)return;
  try{
    const{data:{session}}=await supabase.auth.getSession();
    if(session?.expires_at&&session.expires_at-Math.floor(Date.now()/1000)<60)await _recoverSession();
  }catch{}
};
const _dbSaveCustomer = (c) => _outboxWrap('customers', c, _dbSaveCustomerInner(c));
const _dbSaveCustomerInner = async (c) => {
  if(!supabase){console.warn('[DB] save customer skipped — no supabase');return false}
  await _ensureFreshSession();
  // Optimistic locking: check version before saving
  if(c._version){const vc=await _checkVersion('customers',c.id,c._version);if(vc!==true){if(typeof vc==='number')c._version=vc;return false}}
  try{
    const{contacts,_oe,_os,_oi,_ob,...custRow}=c;
    custRow.updated_at=new Date().toISOString();
    if(!custRow.created_at)custRow.created_at=custRow.updated_at;
    let{error:custErr}=await _retryNet(()=>supabase.from('customers').upsert(_pick(custRow,_custCols),{onConflict:'id'}));
    if(custErr){
      // A missing OPTIONAL column (search_tags 00085, art_files 00027) fails the WHOLE upsert on an
      // un-migrated DB. Strip optional columns one at a time, dropping art_files LAST — otherwise a
      // missing search_tags column also strips art_files, silently losing customer-library artwork
      // (the "Add Art does nothing" bug: the art never persists, then a realtime reload wipes it).
      const _optional=['search_tags','art_files'];let _saved=false;
      for(let _n=1;_n<=_optional.length&&!_saved;_n++){
        const _drop=new Set(_optional.slice(0,_n));
        const _r=await _retryNet(()=>supabase.from('customers').upsert(_pick(custRow,_custCols.filter(c2=>!_drop.has(c2))),{onConflict:'id'}));
        if(!_r.error){_saved=true;console.warn('[DB] customer saved without '+[..._drop].join(', ')+' (run latest migrations)')}
        else if(_n===_optional.length){if(_isAuthError(_r.error))return _handleAuthSaveFailure(c.id,_r.error);console.error('[DB] save customer upsert error:',_r.error.message);_dbSaveFailedIds.add(c.id);_recordSaveError(c.id,'customers: '+_r.error.message);_persistFailedIds();if(_dbNotify)_dbNotify('Customer save failed: '+_r.error.message,'error');return false}
      }
    }
    // Upsert contacts then delete removed ones (avoids DELETE+INSERT race condition)
    if(contacts?.length){
      const contactRows=contacts.map((ct,i)=>({customer_id:c.id,name:ct.name,email:ct.email,phone:ct.phone,role:ct.role,sort_order:i}));
      const{error:ctErr}=await supabase.from('customer_contacts').upsert(contactRows,{onConflict:'customer_id,sort_order'});
      if(ctErr){console.error('[DB] upsert contacts error:',ctErr.message);
        // Fallback: DELETE+INSERT if upsert constraint doesn't exist
        await supabase.from('customer_contacts').delete().eq('customer_id',c.id);
        await supabase.from('customer_contacts').insert(contactRows);
      }else{
        // Delete contacts beyond current count
        const{data:existingCts}=await supabase.from('customer_contacts').select('sort_order').eq('customer_id',c.id);
        const toDelete=(existingCts||[]).filter(ec=>ec.sort_order>=contacts.length);
        if(toDelete.length)await supabase.from('customer_contacts').delete().eq('customer_id',c.id).gte('sort_order',contacts.length);
      }
    }
    // If contacts is empty/undefined, leave existing DB contacts untouched to prevent accidental data loss
    _dbSaveFailedIds.delete(c.id);_clearSaveError(c.id);_persistFailedIds();_dbRecentSaves[c.id]=Date.now();
    // Bump local version to match server (DB trigger increments on UPDATE)
    if(c._version)c._version=c._version+1;
    console.log('[DB] Customer saved:',c.id,c.name);return true;
  }catch(e){if(_isAuthError(e))return _handleAuthSaveFailure(c.id,e);console.error('[DB] save customer:',e);_dbSaveFailedIds.add(c.id);_recordSaveError(c.id,e.message||String(e));_persistFailedIds();if(_dbNotify)_dbNotify('Customer save failed: '+e.message,'error');return false}
};
const _dbSavePromoProgram = async (prog) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_promo_programs').upsert(prog,{onConflict:'id'});
    if(error){console.error('[DB] save promo program:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save promo program:',e);return false}
};
const _dbDeletePromoProgram = async (id) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_promo_programs').delete().eq('id',id);
    if(error){console.error('[DB] delete promo program:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete promo program:',e);return false}
};
const _dbSavePromoPeriod = async (period) => {
  if(!supabase)return false;
  try{
    // Strip non-schema fields before sending to Supabase
    const{period_label,_label,...dbPeriod}=period;
    const{error}=await supabase.from('customer_promo_periods').upsert(dbPeriod,{onConflict:'id'});
    if(error){console.error('[DB] save promo period:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save promo period:',e);return false}
};
const _dbDeletePromoPeriod = async (id) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_promo_periods').delete().eq('id',id);
    if(error){console.error('[DB] delete promo period:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete promo period:',e);return false}
};
const _dbSavePromoUsage = async (usage) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_promo_usage').insert(usage);
    if(error){console.error('[DB] save promo usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save promo usage:',e);return false}
};
const _dbDeletePromoUsage = async (periodId, soId, estimateId) => {
  if(!supabase)return false;
  try{
    let q=supabase.from('customer_promo_usage').delete().eq('period_id',periodId);
    if(soId)q=q.eq('so_id',soId);
    else if(estimateId)q=q.eq('estimate_id',estimateId).is('so_id',null);
    const{error}=await q;
    if(error){console.error('[DB] delete promo usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete promo usage:',e);return false}
};
// Re-point an estimate's promo usage to the SO it converted into, so the deduction carries
// over (no double-spend) and the Promo $ tab links the spend to the order.
const _dbRelinkPromoUsage = async (estimateId, soId) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_promo_usage').update({so_id:soId}).eq('estimate_id',estimateId).is('so_id',null);
    if(error){console.error('[DB] relink promo usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] relink promo usage:',e);return false}
};
// ── Credit DB functions ──
const _dbSaveCredit = async (credit) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_credits').upsert(credit,{onConflict:'id'});
    if(error){console.error('[DB] save credit:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save credit:',e);return false}
};
const _dbDeleteCredit = async (id) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_credits').delete().eq('id',id);
    if(error){console.error('[DB] delete credit:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete credit:',e);return false}
};
const _dbSaveCreditUsage = async (usage) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_credit_usage').insert(usage);
    if(error){console.error('[DB] save credit usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save credit usage:',e);return false}
};
// ── Pending-shipping DB functions (mirror of credits) ──
const _dbSavePendingShip = async (rec) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_pending_shipping').upsert(rec,{onConflict:'id'});
    if(error){console.error('[DB] save pending ship:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save pending ship:',e);return false}
};
const _dbDeletePendingShip = async (id) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_pending_shipping').delete().eq('id',id);
    if(error){console.error('[DB] delete pending ship:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete pending ship:',e);return false}
};
const _dbSavePendingShipUsage = async (usage) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_pending_shipping_usage').insert(usage);
    if(error){console.error('[DB] save pending ship usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] save pending ship usage:',e);return false}
};
const _dbDeletePendingShipUsage = async (soId) => {
  if(!supabase)return false;
  try{
    const{error}=await supabase.from('customer_pending_shipping_usage').delete().eq('so_id',soId);
    if(error){console.error('[DB] delete pending ship usage:',error.message);return false}
    return true;
  }catch(e){console.error('[DB] delete pending ship usage:',e);return false}
};
const _dbDuplicateSkuIds=new Set(JSON.parse(localStorage.getItem('nsa_duplicate_sku_ids')||'[]'));// product IDs with duplicate SKU — skip saves entirely
const _persistDuplicateSkuIds=()=>{_lsSet('nsa_duplicate_sku_ids',JSON.stringify([..._dbDuplicateSkuIds]))};
const _dbSaveProduct = (p) => _outboxWrap('products', p, _dbSaveProductInner(p));
const _dbSaveProductInner = async (p) => {
  if(!supabase)return;
  if(_dbDuplicateSkuIds.has(p.id))return true;// skip — this ID has a duplicate SKU in DB
  await _ensureFreshSession();// proactive token refresh before the write (see _dbSaveEstimateInner)
  try{
    const row={id:p.id,vendor_id:p.vendor_id||null,sku:p.sku,name:p.name,brand:p.brand||null,color:p.color||null,
      color_category:p.color_category||null,category:p.category||null,retail_price:p.retail_price||0,nsa_cost:p.nsa_cost||0,
      is_active:p.is_active!==false,is_archived:p.is_archived||false,available_sizes:p.available_sizes||[],_colors:p._colors||null,
      is_clearance:p.is_clearance||false,clearance_cost:p.clearance_cost!=null?p.clearance_cost:null,bin:p.bin||null,
      image_front_url:p.image_url||p.image_front_url||null,image_back_url:p.back_image_url||p.image_back_url||null};
    const{error}=await supabase.from('products').upsert(row,{onConflict:'id'});
    if(error){
      // Duplicate SKU: another product already owns this SKU — suppress all future saves for this ID
      if(error.message?.includes('products_sku_unique')||error.message?.includes('duplicate key value')){
        console.warn('[DB] Duplicate SKU',p.sku,'for id',p.id,'— suppressing future saves');
        _dbDuplicateSkuIds.add(p.id);_persistDuplicateSkuIds();_dbSaveFailedIds.delete(p.id);_clearSaveError(p.id);_persistFailedIds();return true;
      }
      // If image columns don't exist yet, retry without them (product data still saves)
      if(error.message?.includes('image_front_url')||error.message?.includes('image_back_url')||error.message?.includes('color_category')||error.message?.includes('is_archived')||error.message?.includes('is_clearance')||error.message?.includes('clearance_cost')||error.message?.includes('bin')){
        const{image_front_url,image_back_url,color_category,is_archived,is_clearance,clearance_cost,bin,...rowNoExtra}=row;
        const{error:e2}=await supabase.from('products').upsert(rowNoExtra,{onConflict:'id'});
        if(e2){if(e2.message?.includes('products_sku_unique')||e2.message?.includes('duplicate key value')){console.warn('[DB] Skipping duplicate SKU:',p.sku);return false}console.error('[DB] save product (no extra cols):',e2.message);_dbSaveFailedIds.add(p.id);_recordSaveError(p.id,'products: '+e2.message);_persistFailedIds();if(_dbNotify)_dbNotify('Product save failed: '+e2.message,'error');return false}
      }else if(error.message?.includes('violates row-level security')||error.code==='42501'||error.status===401||error.message?.includes('JWT')||error.message?.includes('not authenticated')){
        // A product edit lost to a transient token expiry must NOT report success — returning true
        // here cleared the dirty flag and silently dropped the change (gone on next reload, no banner).
        // Route it through the same mark-failed + session-recover path as estimates/SOs/customers so
        // the background retry re-saves it once the session refreshes.
        return _handleAuthSaveFailure(p.id,error);
      }else{console.error('[DB] save product:',error.message);_dbSaveFailedIds.add(p.id);_recordSaveError(p.id,'products: '+error.message);_persistFailedIds();if(_dbNotify)_dbNotify('Product save failed: '+error.message,'error');return false}
    }
    // Always save product images to app_state as reliable backup (works even without image columns)
    const _imgF=p.image_url||p.image_front_url||null;const _imgB=p.back_image_url||p.image_back_url||null;const _imgG=p.images||null;
    if(_imgF||_imgB||(_imgG&&_imgG.length)){
      try{await supabase.from('app_state').upsert({id:'_pimg_'+p.id,value:JSON.stringify({front:_imgF,back:_imgB,gallery:_imgG}),updated_at:new Date().toISOString()},{onConflict:'id'})}catch(_){}
    }
    const _inv=p._inv||{};const _alerts=p._alerts||{};
    const allSizes=new Set([...Object.keys(_inv),...Object.keys(_alerts)]);
    if(allSizes.size>0){
      const rows=[...allSizes].map(sz=>({product_id:p.id,size:sz,quantity:_inv[sz]||0,alert_threshold:_alerts[sz]||null}));
      await supabase.from('product_inventory').upsert(rows,{onConflict:'product_id,size'});
    }
    _dbSaveFailedIds.delete(p.id);_clearSaveError(p.id);_persistFailedIds();return true;
  }catch(e){console.error('[DB] save product:',e);_dbSaveFailedIds.add(p.id);_recordSaveError(p.id,e.message||String(e));_persistFailedIds();return false}
};
// When a product's vendor is changed in the catalog, line items that still carry the product's
// PREVIOUS vendor go stale: the PO builder groups on the line item's snapshotted vendor_id (see
// resolveVendor in OrderEditor), so an order created before the change keeps grouping under the
// old vendor even though the catalog now says otherwise. Re-point the open, not-yet-ordered lines
// so they follow the product. A line is only moved when it (a) still points at the old vendor —
// never overriding a deliberate per-order reassignment — and (b) has no committed PO lines yet;
// already-ordered lines keep their snapshot, and any existing PO keeps its own vendor regardless.
// Returns the affected so_ids so callers can refresh in-memory state / notify.
const _dbPropagateVendorToOpenItems = async (productId, oldVendorId, newVendorId, newBrand) => {
  if(!supabase||!productId||!oldVendorId||!newVendorId||oldVendorId===newVendorId)return[];
  try{
    const{data:cand,error}=await supabase.from('so_items').select('id,so_id').eq('product_id',productId).eq('vendor_id',oldVendorId);
    if(error){console.error('[DB] vendor propagate — read items:',error.message);return[]}
    if(!cand||!cand.length)return[];
    const ids=cand.map(c=>c.id);
    // Skip lines already placed on a PO (ordered from the old vendor).
    const{data:poLines}=await supabase.from('so_item_po_lines').select('so_item_id').in('so_item_id',ids);
    const ordered=new Set((poLines||[]).map(r=>r.so_item_id));
    // Skip lines on deleted orders.
    const soIds=[...new Set(cand.map(c=>c.so_id))];
    const{data:liveSOs}=await supabase.from('sales_orders').select('id').in('id',soIds).is('deleted_at',null);
    const live=new Set((liveSOs||[]).map(s=>s.id));
    const targetIds=cand.filter(c=>!ordered.has(c.id)&&live.has(c.so_id)).map(c=>c.id);
    if(!targetIds.length)return[];
    const patch={vendor_id:newVendorId};if(newBrand)patch.brand=newBrand;
    const{error:upErr}=await supabase.from('so_items').update(patch).in('id',targetIds);
    if(upErr){console.error('[DB] vendor propagate — update items:',upErr.message);return[]}
    return[...new Set(cand.filter(c=>targetIds.includes(c.id)).map(c=>c.so_id))];
  }catch(e){console.error('[DB] vendor propagate:',e);return[]}
};
const _dbSaveMessage = (m) => _outboxWrap('messages', m, _dbSaveMessageInner(m));
const _dbSaveMessageInner = async (m) => {
  if(!supabase)return;
  try{
    const row=_pick(m,_msgCols);
    // Try core columns first (always exist), then full row if core succeeds we try extras
    const coreRow={};Object.keys(row).forEach(k=>{if(!_msgExtraCols.has(k))coreRow[k]=row[k]});
    const{error}=await supabase.from('messages').upsert(coreRow,{onConflict:'id'});
    if(error){
      // FK violation on so_id means the SO hasn't been saved yet — skip silently and retry later
      if(error.message?.includes('messages_so_id_fkey')){console.warn('[DB] message save deferred — SO not yet in DB:',m.so_id);_dbSaveFailedIds.add(m.id);_recordSaveError(m.id,'messages (FK): waiting for SO to save');_persistFailedIds();return false}
      console.error('[DB] save message:',error.message);_dbSaveFailedIds.add(m.id);_recordSaveError(m.id,'messages: '+error.message);_persistFailedIds();return false;
    }
    // Try to save extra columns (tagged_members, entity_type, etc.) — silently ignore if columns don't exist yet
    const extraRow={id:m.id};let hasExtra=false;_msgExtraCols.forEach(k=>{if(k in row&&row[k]!=null){extraRow[k]=row[k];hasExtra=true}});
    if(hasExtra){await supabase.from('messages').upsert(extraRow,{onConflict:'id'}).then(r=>{if(r.error)console.warn('[DB] message extras skipped:',r.error.message)})}
    if(m.read_by?.length){
      const reads=m.read_by.map(uid=>({message_id:m.id,user_id:uid}));
      await supabase.from('message_reads').upsert(reads,{onConflict:'message_id,user_id'});
    }
    _dbSaveFailedIds.delete(m.id);_clearSaveError(m.id);_persistFailedIds();return true;
  }catch(e){console.error('[DB] save message:',e);_dbSaveFailedIds.add(m.id);_recordSaveError(m.id,e.message||String(e));_persistFailedIds();return false}
};
// ─── Delete Helpers ───
const _dbDeleteEstimate = async (id) => {
  if(!supabase)return;
  _outboxRemove('estimates',id);// a deliberate local delete supersedes any stashed unsaved edit
  return _dbSavingGuard(async()=>{try{
    await supabase.from('estimate_item_decorations').delete().in('estimate_item_id',(await supabase.from('estimate_items').select('id').eq('estimate_id',id)).data?.map(i=>i.id)||[]);
    await supabase.from('estimate_items').delete().eq('estimate_id',id);
    await supabase.from('estimate_art_files').delete().eq('estimate_id',id);
    await supabase.from('estimates').delete().eq('id',id);
  }catch(e){console.error('[DB] delete estimate:',e)}});
};
const _dbDeleteSO = async (id) => {
  if(!supabase)return;
  _outboxRemove('sales_orders',id);// a deliberate local delete supersedes any stashed unsaved edit
  return _dbSavingGuard(async()=>{try{
    const itemIds=(await supabase.from('so_items').select('id').eq('so_id',id)).data?.map(i=>i.id)||[];
    await supabase.from('so_item_decorations').delete().in('so_item_id',itemIds);
    await supabase.from('so_item_pick_lines').delete().in('so_item_id',itemIds);
    await supabase.from('so_item_po_lines').delete().in('so_item_id',itemIds);
    await supabase.from('so_items').delete().eq('so_id',id);
    await supabase.from('so_art_files').delete().eq('so_id',id);
    await supabase.from('so_firm_dates').delete().eq('so_id',id);
    await supabase.from('so_jobs').delete().eq('so_id',id);
    await supabase.from('sales_orders').delete().eq('id',id);
  }catch(e){console.error('[DB] delete SO:',e)}});
};
const _dbDeleteInvoice = async (id) => {
  if(!supabase)return;
  _outboxRemove('invoices',id);// a deliberate local delete supersedes any stashed unsaved edit
  return _dbSavingGuard(async()=>{try{
    await supabase.from('invoice_payments').delete().eq('invoice_id',id);
    await supabase.from('invoice_items').delete().eq('invoice_id',id);
    await supabase.from('invoices').delete().eq('id',id);
  }catch(e){console.error('[DB] delete invoice:',e)}});
};
const _dbDeleteHistInvoice = async (id) => {
  if(!supabase)return;
  return _dbSavingGuard(async()=>{try{
    await supabase.from('customer_invoices').delete().eq('id',id);
  }catch(e){console.error('[DB] delete hist invoice:',e)}});
};
// Save-in-progress guard — prevents poll/realtime from loading partial data during delete-and-reinsert
let _dbSavingCount=0;let _dbLastSaveAt=0;
const _dbSavingGuard=async(fn)=>{_dbSavingCount++;try{return await fn()}finally{_dbSavingCount--;_dbLastSaveAt=Date.now()}};
// After a local batch-queue edit, protect it from being clobbered by an
// in-flight realtime/poll reload that may still read a stale app_state.batch_pos
// (the queue is one JSON blob, written separately from the SO save that triggers
// the reload). Reload sites keep the local queue while within this window.
let _batchPosDirtyUntil=0;
// Same protection for the OTHER whole-blob app_state keys a client mutates locally:
// job_time_logs (payroll data!) and wh_recent_actions. Generalized to a small map
// (app_state id → dirty-until epoch ms) instead of two more module vars; hydration
// sites that set those keys keep the local copy while inside the window, exactly
// like the batch_pos guard above.
const _appStateDirtyUntil={};
const _setAppStateDirtyUntil=(key,v)=>{_appStateDirtyUntil[key]=v};
const _appStateDirty=(key)=>Date.now()<(_appStateDirtyUntil[key]||0);
// Per-key app_state row versions + the exact value string last seen on/acked by the server
// (app_state id → {v:version,s:value}). Populated by every _dbLoad app_state parse and by
// App's _saveAppStateCAS on successful CAS writes / conflict refetches. Consumed only by the
// compare-and-swap save path for the money keys (labor_rates, comm_overrides) — migration 00181.
const _appStateVersions={};
// Direct pick_line status update — atomic, bypasses SO delete-and-reinsert for fast cross-tab sync
const _dbUpdatePickLineStatus=async(soId,itemIdx,pickId,status,pulledQtys)=>{
  if(!supabase)return;
  try{
    // Find the so_item_id for this item index
    const{data:items}=await supabase.from('so_items').select('id').eq('so_id',soId).order('item_index');
    const itemRow=items?.[itemIdx];if(!itemRow)return;
    // Update the pick_line status and sizes — pulled_at goes into sizes JSONB (not a top-level column)
    const sizes={...pulledQtys,pulled_at:status==='pulled'?new Date().toLocaleString():undefined};
    const{error}=await supabase.from('so_item_pick_lines').update({status,sizes}).eq('so_item_id',itemRow.id).eq('pick_id',pickId);
    if(error)console.error('[DB] Direct pick_line update failed:',error.message);
    else{console.log('[DB] Direct pick_line update:',pickId,'→',status);
      // Bump SO updated_at so other tabs detect the change
      await supabase.from('sales_orders').update({updated_at:new Date().toLocaleString()}).eq('id',soId);
    }
  }catch(e){console.error('[DB] Direct pick_line update error:',e)}
};
// Per-entity save queue — prevents concurrent saves for the same estimate/SO from racing.
// When a save is in-progress and a newer version arrives, the newer version is queued.
// After the current save finishes, only the LATEST queued version is saved (intermediate versions are skipped).
const _dbSaveInFlight={};// id → true if a save is currently running
const _dbSavePending={};// id → {data, saveFn} latest pending save data
const _queuedEntitySave=async(id,data,saveFn)=>{
  _dbSavePending[id]={data,saveFn};
  if(_dbSaveInFlight[id])return;// save running — pending data will be picked up when it finishes
  _dbSaveInFlight[id]=true;
  let lastResult;
  try{
    while(_dbSavePending[id]){
      const{data:toSave,saveFn:fn}=_dbSavePending[id];
      delete _dbSavePending[id];
      lastResult=await fn(toSave);
    }
  }finally{delete _dbSaveInFlight[id]}
  return lastResult;
};
// Track recently-pulled SOs — prevents poll/realtime from reverting pulls for 30s after a warehouse pull
// This is a safety net for slow connections where the full SO save might not complete before the next poll
const _recentlyPulledSOs=new Map();// soId → timestamp
const _markRecentlyPulled=(soId)=>{_recentlyPulledSOs.set(soId,Date.now())};
const _isRecentlyPulled=(soId)=>{const t=_recentlyPulledSOs.get(soId);if(!t)return false;if(Date.now()-t>30000){_recentlyPulledSOs.delete(soId);return false}return true};
// Track recent local approval-status changes on estimates — protects status/approved_by/approved_at in the
// poll/realtime merge for 60s so a reload that read the DB before the change landed can't snap the status
// back (EST-1227: clicking Unapprove reverted to approved shortly after saving). The estimate merge's only
// other guard is a locale-string updated_at comparison, which is not chronologically reliable.
// baseVersion is the estimate's optimistic-concurrency _version at the moment of the change: the merge only
// honors the mark against rows whose _version hasn't advanced past it, so a LEGITIMATE later write (another
// user's approve/unapprove, convertSO's status:'converted') always wins — the mark can only beat rows that
// provably predate this client's change.
const _recentEstStatusChanges=new Map();// estId → {status,approved_by,approved_at,baseVersion,at}
const _markEstStatusChange=(e)=>{_recentEstStatusChanges.set(e.id,{status:e.status,approved_by:e.approved_by??null,approved_at:e.approved_at??null,baseVersion:(e._version!=null&&isFinite(Number(e._version))?Number(e._version):null),at:Date.now()})};
const _recentEstStatusChange=(id)=>{const r=_recentEstStatusChanges.get(id);if(!r)return null;if(Date.now()-r.at>60000){_recentEstStatusChanges.delete(id);return null}return r};
// Safe localStorage write — catches QuotaExceededError and notifies user instead of silently failing
let _lsQuotaWarned=false;// prevent spamming quota warnings
let _onCacheFullChange=null;// set by App component to show persistent banner
const _LS_MAX_KEY_SIZE=1024*1024;// 1MB per key — skip caching datasets larger than this
const _LS_TOTAL_BUDGET=4*1024*1024;// 4MB total budget — stop caching when localStorage exceeds this
// Small essential keys that should always be written (settings, user prefs, tiny state)
const _LS_ESSENTIAL=new Set(['nsa_user','nsa_settings','nsa_mobile_mode','nsa_role_view','nsa_prod_cols','nsa_save_failed_ids','nsa_save_failed_errors','nsa_outbox','nsa_duplicate_sku_ids','nsa_fav_skus','nsa_dismissed_notifs','nsa_dismissed_todos','nsa_recent','nsa_ups_pickup_check','nsa_auto_backup_ts']);
const _lsTotalSize=()=>{let t=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k)t+=k.length+(localStorage.getItem(k)||'').length}}catch{}return t*2};// ×2 for UTF-16
let _lsBudgetWarned=false;// prevent spamming budget skip logs
const _lsSet=(key,value)=>{try{
  // Essential small keys always get written
  if(!_LS_ESSENTIAL.has(key)){
    if(value&&value.length>_LS_MAX_KEY_SIZE){if(!_lsBudgetWarned){_lsBudgetWarned=true;console.warn('[Storage] Skipping cache for',key,'— size',Math.round(value.length/1024)+'KB exceeds 1MB limit')}return false}
    // Check total budget before writing non-essential keys — silently skip (data is safe in cloud)
    if(_lsTotalSize()>_LS_TOTAL_BUDGET){if(!_lsBudgetWarned){_lsBudgetWarned=true;console.warn('[Storage] Total localStorage over 4MB budget, skipping non-essential cache writes')}return false}
  }
  localStorage.setItem(key,value);return true
}catch(e){if((e.name==='QuotaExceededError'||e.message?.includes('quota'))&&!_lsQuotaWarned){_lsQuotaWarned=true;if(_onCacheFullChange)_onCacheFullChange(true);console.error('[Storage] localStorage quota exceeded writing key:',key)}return false}};
// One-time cleanup: drop legacy heavy/unbounded keys on startup. Cloud is the source of truth.
// The entity caches (nsa_cust/ests/sos/invs/msgs/prod/vend) are purged too: nothing has written
// them since the one-time bad-ID migration, but a years-old copy still seeds boot state, and the
// boot merge prefers that `prev` copy for any failed-save ID — feeding users ancient data. Unsaved
// edits are preserved by the outbox (nsa_outbox), which replaces the only job these caches had left.
try{['nsa_auto_backup','nsa_auto_backup_ts','nsa_change_log','nsa_so_history','nsa_inv_adj_log','nsa_cust','nsa_ests','nsa_sos','nsa_invs','nsa_msgs','nsa_prod','nsa_vend'].forEach(k=>localStorage.removeItem(k));const _snapKeys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('nsa_snap_'))_snapKeys.push(k)}_snapKeys.forEach(k=>localStorage.removeItem(k))}catch{}
// Track IDs of estimates/SOs whose save failed — prevents reload/poll from overwriting local state
// Persisted to localStorage so protection survives page refresh
const _dbSaveFailedIds=new Set(JSON.parse(localStorage.getItem('nsa_save_failed_ids')||'[]'));
// Track WHY each save failed — surfaced in the banner so the team can see real DB errors
// instead of just a count. Persisted alongside the IDs so the diagnosis survives reload.
const _dbSaveFailedErrors=(()=>{try{const raw=localStorage.getItem('nsa_save_failed_errors');return raw?new Map(Object.entries(JSON.parse(raw))):new Map()}catch{return new Map()}})();
const _recordSaveError=(id,msg)=>{if(!id)return;_dbSaveFailedErrors.set(id,{msg:String(msg||'unknown error').slice(0,400),ts:Date.now()});try{_lsSet('nsa_save_failed_errors',JSON.stringify(Object.fromEntries(_dbSaveFailedErrors)))}catch{}};
const _clearSaveError=(id)=>{if(!id)return;if(_dbSaveFailedErrors.delete(id)){try{_lsSet('nsa_save_failed_errors',JSON.stringify(Object.fromEntries(_dbSaveFailedErrors)))}catch{}}};
let _onFailedIdsChange=null;// set by App component to trigger UI updates
const _persistFailedIds=()=>{_lsSet('nsa_save_failed_ids',JSON.stringify([..._dbSaveFailedIds]));if(_onFailedIdsChange)_onFailedIdsChange(_dbSaveFailedIds.size)};
// On startup, clear any duplicate-SKU product IDs from failed saves (they'll never succeed)
_dbDuplicateSkuIds.forEach(id=>{_dbSaveFailedIds.delete(id)});if(_dbDuplicateSkuIds.size)_persistFailedIds();
// Track IDs with unsaved local changes (diffSave skipped because DB not ready) — protects from reload overwrite
const _dbSavePendingIds=new Set();
// ─── Durable edit outbox ───
// The failed-ID ledger above records only IDs — the CONTENT of a failed edit lives solely in React
// memory and dies on reload or forced logout, leaving a banner about data that no longer exists.
// The outbox persists the full entity payload to localStorage keyed `table:id`, carrying the
// _version the edit was based on, so boot can rehydrate it behind a version gate (_outboxGate).
// The gate, not this store, decides whether a payload may re-enter state: a stale outbox entry
// silently overwriting a newer server row would be worse than the loss it prevents.
const _OUTBOX_KEY='nsa_outbox';
const _OUTBOX_MAX_CHARS=768*1024;// ~1.5MB in UTF-16 — self-capped, because essential keys bypass the budget checks above
const _outboxRead=()=>{try{const raw=localStorage.getItem(_OUTBOX_KEY);const box=raw?JSON.parse(raw):{};return box&&typeof box==='object'&&!Array.isArray(box)?box:{}}catch{return{}}};
// Read-modify-write on every mutation (never a cached in-memory blob) so two tabs failing saves
// concurrently merge per-key instead of clobbering each other's whole outbox.
const _outboxWrite=(box)=>{
  let s=JSON.stringify(box);
  const evicted=[];
  const evictOldest=()=>{const ks=Object.keys(box);if(!ks.length)return false;let oldest=ks[0];for(const k of ks)if((box[k].ts||0)<(box[oldest].ts||0))oldest=k;evicted.push(oldest);delete box[oldest];s=JSON.stringify(box);return true};
  while(s.length>_OUTBOX_MAX_CHARS&&evictOldest());
  for(;;){try{localStorage.setItem(_OUTBOX_KEY,s);break}catch(e){if(!evictOldest()){console.error('[Outbox] could not persist outbox:',e?.message||e);return}}}
  // Eviction is data loss — it must never be silent.
  if(evicted.length){console.error('[Outbox] DROPPED unsaved edit(s) to stay within the size cap:',evicted.join(', '));if(_dbNotify)_dbNotify('Storage full — '+evicted.length+' older unsaved edit(s) had to be dropped from the offline backup ('+evicted.join(', ')+'). Check the failed-save list.','error')}
};
const _outboxAdd=(table,entity)=>{try{
  if(!entity||!entity.id)return;
  const box=_outboxRead();const key=table+':'+entity.id;
  const payload={...entity};delete payload._retry;// transient retry-poke marker, not part of the edit
  const prev=box[key];
  box[key]={table,id:entity.id,payload,baseVersion:(payload._version!=null&&isFinite(Number(payload._version))?Number(payload._version):null),ts:Date.now(),attempts:(prev?.attempts||0)+1};
  _outboxWrite(box);
}catch(e){console.error('[Outbox] add failed:',e)}};
const _outboxRemove=(table,id)=>{try{const box=_outboxRead();const key=table+':'+id;if(!(key in box))return;delete box[key];_outboxWrite(box)}catch{}};
const _outboxRemoveById=(id)=>{try{const box=_outboxRead();let hit=false;for(const k of Object.keys(box)){if(box[k]&&box[k].id===id){delete box[k];hit=true}}if(hit)_outboxWrite(box)}catch{}};
const _outboxList=()=>{try{return Object.values(_outboxRead())}catch{return[]}};
// Live conflict surfacing: when a save is rejected because the server moved past the client's base
// version (the estimate stale-guard), the edit's content is preserved in the outbox and the App is
// notified so the conflict card appears IMMEDIATELY — the rep decides view/apply/discard instead of
// retyping. Before this, a stale rejection silently dropped the edit content.
let _onOutboxConflict=null;// set by App — receives the outbox entry to append to the conflict card list
export const _setOnOutboxConflict=(fn)=>{_onOutboxConflict=fn};
const _emitOutboxConflict=(table,entity)=>{try{
  if(!entity||!entity.id)return;
  _outboxAdd(table,entity);
  const en=_outboxRead()[table+':'+entity.id];
  if(en&&_onOutboxConflict)_onOutboxConflict(en);
}catch(e){console.error('[Outbox] conflict emit failed:',e)}};
// Failure/success hook wrapping the exported save entry points. Keys off _dbSaveFailedIds so it
// inherits the interior failure sites' judgment exactly — a false return that deliberately did NOT
// flag the ID (e.g. a permanently-skipped duplicate SKU, or a version-conflict precheck that wants
// a refetch, not a retry) is not outboxed. 'stale' (estimate superseded server-side) clears the
// entry: existing semantics treat that edit as superseded, and the server-side version guard would
// reject a re-apply anyway.
const _outboxWrap=(table,entity,resultPromise,addOnly)=>{
  // Capture-on-attempt: once the session is latched dead this save is doomed (the write goes out
  // with a stale JWT and RLS rejects it). Persist the payload NOW, synchronously — the async
  // failure path may never run if the app unmounts to the login screen first. This is what makes
  // the forced-logout flush (`nsa:version-reload-pending` → editor onSave → save entry point)
  // durable without depending on React commit timing.
  try{if(_sessionDead&&entity&&entity.id)_outboxAdd(table,entity)}catch{}
  return Promise.resolve(resultPromise).then(r=>{
    try{
      if(r===false){if(entity&&entity.id&&_dbSaveFailedIds.has(entity.id))_outboxAdd(table,entity)}
      // addOnly: an art-files-only save success must not clear an outbox entry holding a failed
      // FULL entity payload — only the full save may clear. 'stale' deliberately does NOT clear:
      // the rejected edit's content is preserved for the conflict card (_emitOutboxConflict) so a
      // version rejection no longer silently destroys what the rep typed.
      else if(r===true&&!addOnly){if(entity&&entity.id)_outboxRemove(table,entity.id)}
    }catch(e){console.error('[Outbox] hook failed:',e)}
    return r;
  },err=>{try{if(entity&&entity.id&&_dbSaveFailedIds.has(entity.id))_outboxAdd(table,entity)}catch{}throw err});
};
// Boot-time gate: outbox entry vs the freshly-loaded DB row. Pure — unit-tested in the
// characterization suite. Returns:
//  'apply'    → re-apply payload into state ahead of the DB copy; the normal retry flow saves it.
//  'drop'     → the DB already contains this edit (committed-but-response-lost) — discard silently.
//  'conflict' → the server moved past the edit's base, or there's no version proof of safety, or
//               the row was deleted server-side — surface the conflict card; NEVER silently apply.
const _OUTBOX_IGNORE_KEYS=new Set(['updated_at','created_at']);
const _outboxValEq=(a,b)=>{if(a===b)return true;if(a==null&&b==null)return true;if(a==null||b==null)return false;if(typeof a==='object'&&typeof b==='object'){try{return JSON.stringify(a)===JSON.stringify(b)}catch{return false}}return false};
// "The DB already reflects this edit": every persisted field the payload carries matches the row.
// Client-only keys (_-prefixed) and volatile stamps are ignored. Subset match is the right rule —
// if everything the client tried to write is already there, there is nothing left to save,
// whoever wrote it. A false negative here is safe: it just falls through to the version gate.
const _outboxMatchesRow=(payload,row)=>{if(!payload||!row)return false;
  for(const k of Object.keys(payload)){if(k.startsWith('_'))continue;if(_OUTBOX_IGNORE_KEYS.has(k))continue;if(!_outboxValEq(payload[k],row[k]))return false}
  return true};
const _outboxGate=(entry,dbRow)=>{
  // Row absent: a never-saved new entity (no base version) is safe to apply; a row that HAD a
  // version existed on the server and was deleted there — silently resurrecting it would undo a
  // deliberate delete, so that's a conflict card.
  if(!dbRow)return entry.baseVersion==null?'apply':'conflict';
  if(_outboxMatchesRow(entry.payload,dbRow))return 'drop';
  const v=dbRow._version;const dbV=(v!=null&&isFinite(Number(v)))?Number(v):null;
  if(entry.baseVersion==null||dbV==null)return 'conflict';// no version info on either side → card, never silent overwrite
  return dbV<=entry.baseVersion?'apply':'conflict';
};
// Merge freshly-loaded assigned_todos with the local copy. Keeps the local version of any todo whose
// save is still in-flight or failed (and any local-only todo not yet persisted), so a background
// realtime/poll reload never drops a task the user just created or completed before it round-trips.
const _mergeAssignedTodos=(dbTodos,localTodos)=>{
  const prot=id=>_dbSavePendingIds.has(id)||_dbSaveFailedIds.has(id);
  const dbIds=new Set(dbTodos.map(t=>t.id));
  const merged=dbTodos.map(t=>prot(t.id)?((localTodos||[]).find(p=>p.id===t.id)||t):t);
  const localOnly=(localTodos||[]).filter(t=>!dbIds.has(t.id)&&prot(t.id));
  return localOnly.length?[...localOnly,...merged]:merged;
};
// Track recent saves by this client — prevents false "modified by another user" conflicts from own realtime echo
const _dbRecentSaves={};// {id: timestamp}
// Last _version THIS client successfully wrote, per entity. A save whose payload was cloned before
// the previous save's version bump landed (convertSO's `convertedEst={...est}` copy, an editor copy
// captured mid-save) carries a stale base — and _checkVersion's own-echo skip (_dbRecentSaves, 60s)
// means the auto-heal precheck won't fix it, so save_estimate rejects the write as a conflict WITH
// OURSELVES (the EST-1395 false conflict card, 2026-07-08: the conversion's status:'converted' save
// was rejected against this client's own v8 write seconds earlier, leaving the estimate 'approved'
// in the cloud while the UI showed 'converted'). Rebasing adopts only versions this tab itself
// wrote: after a foreign write the base is still below the server's version, so the stale guard and
// conflict card fire exactly as before.
const _dbOwnVersions={};// id → last _version this client successfully wrote
const _rebaseOntoOwnWrite=(entity)=>{const own=_dbOwnVersions[entity.id];if(own&&(entity._version||0)<own){console.warn('[DB] '+entity.id+': rebasing save base v'+(entity._version||0)+' onto this client\'s own last write v'+own);entity._version=own}};
// True if THIS client saved the record within the last 60s — gates the art-file superset merge so it only
// protects this client's own just-uploaded files (the read-after-own-write race) and otherwise trusts the DB,
// letting another user's/tab's legitimate art deletions reconcile normally instead of being resurrected.
const _recentlySavedByMe=id=>!!_dbRecentSaves[id]&&Date.now()-_dbRecentSaves[id]<60000;
// Stale-write circuit breaker. When save_estimate rejects a write as STALE (the client's copy is older
// than the DB), re-POSTing the same copy can never succeed — only reloading the newer rows (realtime/poll)
// heals it. A save effect that keeps re-firing on a stale estimate therefore floods the API with rejected
// writes (the ~1000/sec STALE_ESTIMATE_WRITE storms). After a stale rejection we skip further save attempts
// for that estimate until the cooldown elapses, capping a misbehaving tab at a trickle instead of a storm.
const _dbStaleCooldown=new Map();// {estimateId: epoch-ms until which to skip saving}
const _STALE_COOLDOWN_MS=10000;
// Retry a network-flaky upsert/select promise factory. Only retries transport errors (TypeError: Failed to fetch),
// not real server-side errors. Backoff: 400ms, 1.2s.
const _isNetErr=(e)=>{const m=(e?.message||e?.error?.message||String(e||'')).toLowerCase();return m.includes('failed to fetch')||m.includes('network')||m.includes('err_ssl')||m.includes('load failed')};
const _retryNet=async(fn,tries=3)=>{let last;for(let i=0;i<tries;i++){try{const r=await fn();if(r&&r.error&&_isNetErr(r.error)){last={error:r.error};if(i<tries-1){await new Promise(res=>setTimeout(res,400*Math.pow(3,i)));continue}}return r}catch(e){last=e;if(!_isNetErr(e)||i===tries-1)throw e;await new Promise(res=>setTimeout(res,400*Math.pow(3,i)))}}throw last};
// Legacy compat — keep old _dbSave for team_members and other simple tables. Retries transient network errors.
const _dbSave = (table, data) => { if(supabase && data) return _retryNet(()=>supabase.from(table).upsert(Array.isArray(data)?data:[data], {onConflict:'id'})).then(r=>{if(r&&r.error)console.error('[DB] save '+table+':', r.error.message)}).catch(e=>{console.error('[DB] save '+table+':', e.message||e)}) };

// ── Component hook-up ─────────────────────────────────────────────────
// App() registers its toast/alert/state callbacks and flips engine flags
// through these setters — ESM import bindings are read-only, so external
// writers can't assign the module-level lets directly. Everything else
// reads the live bindings exported below.
export const _setDbNotify=(fn)=>{_dbNotify=fn};
export const _setDataLossAlert=(fn)=>{_dataLossAlert=fn};
export const _setRestoredLinesSync=(fn)=>{_restoredLinesSync=fn};
export const _setOnEstStatusMerge=(fn)=>{_onEstStatusMerge=fn};
export const _setForceReauth=(fn)=>{_forceReauth=fn};
export const _setOnFailedIdsChange=(fn)=>{_onFailedIdsChange=fn};
export const _setOnCacheFullChange=(fn)=>{_onCacheFullChange=fn};
export const _setSessionDead=(v)=>{_sessionDead=v};
export const _isSessionDead=()=>_sessionDead;// live getter — the bare `_sessionDead` export is a stale snapshot from module init
export const _setBatchPosDirtyUntil=(v)=>{_batchPosDirtyUntil=v};
export {_setAppStateDirtyUntil,_appStateDirty,_appStateVersions};
export const _setLsQuotaWarned=(v)=>{_lsQuotaWarned=v};
export const _bgSyncInc=()=>{_bgSync++};
export const _bgSyncDec=()=>{_bgSync--};

export {
  supabase,
  scheduleEmailSend,
  API_CATALOG_VENDOR_IDS,
  _searchProductsServer,
  _searchCustomersServer,
  _sbSignIn,
  _sbSignUp,
  _sbResendSignup,
  _sbResetPassword,
  _sbSignOut,
  _sbGetSession,
  _sbLinkTeamAuth,
  _sbGetMyProfile,
  _dbLoad,
  _dbSeed,
  _truncatedTables,
  _authErrorDetected,
  _bgSync,
  _diffSaveSkipLogged,
  _diffCmp,
  _estDiffCmp,
  _soDiffCmp,
  _prodDiffCmp,
  _dbSaveEstimate,
  _dbSaveSO,
  _dbSaveArtFiles,
  _dbSaveInvoice,
  _dbNotify,
  _dataLossAlert,
  _restoredLinesSync,
  _onEstStatusMerge,
  _forceReauth,
  _sessionDead,
  _ensureFreshSession,
  _dbSaveCustomer,
  _dbSavePromoProgram,
  _dbDeletePromoProgram,
  _dbSavePromoPeriod,
  _dbDeletePromoPeriod,
  _dbSavePromoUsage,
  _dbDeletePromoUsage,
  _dbRelinkPromoUsage,
  _dbSaveCredit,
  _dbDeleteCredit,
  _dbSaveCreditUsage,
  _dbSavePendingShip,
  _dbDeletePendingShip,
  _dbSavePendingShipUsage,
  _dbDeletePendingShipUsage,
  _dbSaveProduct,
  _dbPropagateVendorToOpenItems,
  _dbSaveMessage,
  _dbDeleteEstimate,
  _dbDeleteSO,
  _dbDeleteInvoice,
  _dbDeleteHistInvoice,
  _dbSavingCount,
  _dbSavingGuard,
  _batchPosDirtyUntil,
  _dbUpdatePickLineStatus,
  _dbSaveInFlight,
  _dbSavePending,
  _queuedEntitySave,
  _recentlyPulledSOs,
  _markRecentlyPulled,
  _isRecentlyPulled,
  _markEstStatusChange,
  _recentEstStatusChange,
  _lsQuotaWarned,
  _onCacheFullChange,
  _lsSet,
  _dbSaveFailedIds,
  _dbSaveFailedErrors,
  _clearSaveError,
  _outboxAdd,
  _outboxRemove,
  _outboxRemoveById,
  _outboxList,
  _outboxGate,
  _outboxMatchesRow,
  _emitOutboxConflict,
  _onFailedIdsChange,
  _persistFailedIds,
  _dbSavePendingIds,
  _mergeAssignedTodos,
  _dbRecentSaves,
  _dbOwnVersions,
  _rebaseOntoOwnWrite,
  _recentlySavedByMe,
  _dbSave,
  // exported for the characterization tests only — internal to the engine otherwise
  _unionArtFiles,
  _mergeArtConflict,
  _resolveArtRows,
  _matchRestoreItem,
  _sanitizeArtRow,
  _isNetErr,
  _retryNet,
  _isAuthError,
  _isPermissionDenied,
  _classifyRefresh,
};
