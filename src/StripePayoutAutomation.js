import React, {useCallback, useEffect, useState} from 'react';
import {supabase} from './lib/dbEngine';

const initialConfig={
  stripe_payouts_enabled:false,
  stripe_payout_writes_enabled:false,
  stripe_payout_bank_account_id:'',
  stripe_payout_fee_account_id:'',
  stripe_payout_start_date:'',
  stripe_payout_canary_id:'',
};
const stamp=value=>value?new Date(value).toLocaleString():'—';
const stateLabel=value=>String(value||'unknown').replaceAll('_',' ');
const previewSummary=value=>{
  const summary=value?.summary?.stripe_payouts;
  if(!summary||typeof summary!=='object')return '';
  return Object.entries(summary).map(([key,count])=>`${stateLabel(key)}: ${typeof count==='object'?JSON.stringify(count):count}`).join(' · ');
};

function AccountPicker({label,value,options,onChange}){
  const listed=options.some(account=>String(account.id)===String(value));
  return <label style={{fontSize:11,fontWeight:600}}>{label}<select className="form-input" value={value||''} onChange={e=>onChange(e.target.value)}>
    <option value="">Select an account…</option>
    {value&&!listed&&<option value={value}>Saved account selection (not in current account list)</option>}
    {options.map(account=><option key={account.id} value={account.id}>{account.number?account.number+' · ':''}{account.name}</option>)}
  </select>{value&&!listed&&<span style={{display:'block',fontWeight:400,color:'#92400e'}}>This saved selection is missing from the latest account preflight. Choose a listed account to replace it.</span>}</label>;
}

export default function StripePayoutAutomation({accountChoices=[]}){
  const [status,setStatus]=useState(null);
  const [config,setConfig]=useState(initialConfig);
  const [savedConfig,setSavedConfig]=useState(initialConfig);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [preview,setPreview]=useState(null);

  const call=useCallback(async body=>{
    const {data,error:invokeError}=await supabase.functions.invoke('qbo-sales-background',{body});
    if(invokeError)throw new Error(invokeError.message||'Server request failed');
    if(!data?.ok)throw new Error(data?.error||data?.error_code||'Server request failed');
    return data;
  },[]);
  const configFromStatus=useCallback(data=>{
    const values=data?.settings||{};
    const next={...initialConfig,...Object.fromEntries(Object.keys(initialConfig).map(key=>[key,values[key]??initialConfig[key]]))};
    setConfig(next);setSavedConfig(next);
  },[]);
  const load=useCallback(async()=>{
    setError('');
    try{const data=await call({action:'status'});setStatus(data);configFromStatus(data);}
    catch(e){setError(e.message);}
  },[call,configFromStatus]);
  useEffect(()=>{load();},[load]);
  const settings=status?.settings||{};
  const globalWrites=!!settings.writes_enabled&&!settings.kill_switch;
  const startDateReady=!!config.stripe_payout_start_date;
  const bankAccounts=accountChoices.filter(account=>account.types?.includes('Bank'));
  const feeAccounts=accountChoices.filter(account=>account.types?.includes('Expense'));
  const accountMapReady=!!config.stripe_payout_bank_account_id.trim()&&!!config.stripe_payout_fee_account_id.trim();
  const configDirty=Object.keys(initialConfig).some(key=>String(config[key]??'')!==String(savedConfig[key]??''));
  const canSave=!!status&&!busy&&(!(config.stripe_payout_writes_enabled||config.stripe_payouts_enabled)||startDateReady)&&(!(config.stripe_payout_writes_enabled||config.stripe_payouts_enabled)||accountMapReady)&&(!config.stripe_payout_writes_enabled||(globalWrites&&config.stripe_payouts_enabled));

  async function save(){
    setBusy('save');setError('');setNotice('');
    try{
      const data=await call({action:'configure_stripe_payouts',...config,
        stripe_payout_bank_account_id:config.stripe_payout_bank_account_id.trim(),
        stripe_payout_fee_account_id:config.stripe_payout_fee_account_id.trim(),
        stripe_payout_canary_id:config.stripe_payout_canary_id.trim()});
      setNotice(data.message||'Stripe payout settings saved.');
      await load();
    }catch(e){setError(e.message);}finally{setBusy('');}
  }
  async function runPreview(){
    setBusy('preview');setError('');setNotice('');setPreview(null);
    try{
      const data=await call({action:'preflight'});
      setPreview(data);setNotice('Read-only preflight finished. No QuickBooks deposits were created.');
      await load();
    }catch(e){setError(e.message);}finally{setBusy('');}
  }

  const postings=status?.payout_postings||[];
  return <section className="card" style={{marginBottom:16,borderLeft:'4px solid '+(config.stripe_payout_writes_enabled?'#d97706':'#94a3b8')}} aria-label="Stripe payout deposits in QuickBooks">
    <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <div><h2 style={{margin:0}}>Stripe payout deposits in QuickBooks</h2><div style={{fontSize:11,color:'#64748b',marginTop:4}}>Optional automation · {config.stripe_payout_writes_enabled?'Automatic posting enabled':'Automatic posting off'}</div></div>
      <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={()=>{setBusy('status');load().finally(()=>setBusy(''));}}>{busy==='status'?'Refreshing…':'Refresh status'}</button>
    </div>
    <div className="card-body">
      <p style={{fontSize:12,color:'#475569',marginTop:0}}>Preview scans inspect eligible Stripe payouts. Automatic posting creates one QuickBooks bank deposit per eligible payout. Stripe payments already recorded in QuickBooks are grouped into the deposit and their actual Stripe fees are subtracted, so sales are not recorded twice. Refunds, disputes, mixed payouts, or payments that cannot be matched are held for review.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
        <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12}}><input type="checkbox" checked={!!config.stripe_payouts_enabled} onChange={e=>setConfig(c=>({...c,stripe_payouts_enabled:e.target.checked}))}/><span><strong>Enable payout preview scans</strong><br/><span style={{color:'#64748b'}}>Find eligible payouts from the start date; this setting alone never creates deposits.</span></span></label>
        <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12}}><input type="checkbox" checked={!!config.stripe_payout_writes_enabled} disabled={!globalWrites&&!config.stripe_payout_writes_enabled} onChange={e=>setConfig(c=>({...c,stripe_payout_writes_enabled:e.target.checked}))}/><span><strong>Automatically create QuickBooks deposits</strong><br/><span style={{color:globalWrites?'#64748b':'#b91c1c'}}>{globalWrites?'Posts only eligible payout groups after preview checks.':'Enable QuickBooks posting in the global controls first. You can turn this off here.'}</span></span></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:14}}>
        <label style={{fontSize:11,fontWeight:600}}>Start date *<input className="form-input" type="date" value={config.stripe_payout_start_date||''} onChange={e=>setConfig(c=>({...c,stripe_payout_start_date:e.target.value}))}/><span style={{display:'block',fontWeight:400,color:'#64748b'}}>Only payouts on or after this date are considered. No historical payouts are included by default.</span></label>
        <AccountPicker label="QuickBooks deposit account" value={config.stripe_payout_bank_account_id} options={bankAccounts} onChange={value=>setConfig(c=>({...c,stripe_payout_bank_account_id:value}))}/>
        <AccountPicker label="Stripe fee expense account" value={config.stripe_payout_fee_account_id} options={feeAccounts} onChange={value=>setConfig(c=>({...c,stripe_payout_fee_account_id:value}))}/>
        <label style={{fontSize:11,fontWeight:600}}>Optional single-payout canary<input className="form-input" value={config.stripe_payout_canary_id||''} onChange={e=>setConfig(c=>({...c,stripe_payout_canary_id:e.target.value}))} placeholder="po_… (leave blank for all eligible payouts)"/><span style={{display:'block',fontWeight:400,color:'#64748b'}}>When set, automatic posting is limited to this one payout.</span></label>
      </div>
      {(!bankAccounts.length||!feeAccounts.length)&&<p style={{fontSize:11,color:'#92400e',marginBottom:0}}>To choose accounts, go to QuickBooks Overview and run Read-Only Live Preflight first.</p>}
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:12}}>
        <button className="btn btn-secondary" disabled={!canSave} onClick={save}>{busy==='save'?'Saving…':'Save payout settings'}</button>
        <button className="btn btn-primary" disabled={!!busy||configDirty||!config.stripe_payouts_enabled||!startDateReady} onClick={runPreview}>{busy==='preview'?'Previewing…':'Run read-only payout preview'}</button>
        <span style={{fontSize:11,color:'#64748b'}}>QuickBooks posting: {globalWrites?'enabled':'disabled'}{settings.kill_switch?' · stopped globally':''}</span>
      </div>
      {configDirty&&<p style={{fontSize:11,color:'#92400e',marginBottom:0}}>Save these settings before running the preview.</p>}
      {config.stripe_payouts_enabled&&!accountMapReady&&<p style={{fontSize:11,color:'#92400e',marginBottom:0}}>Choose both the payout bank and fee expense accounts before enabling preview scans.</p>}
      {config.stripe_payout_writes_enabled&&(!globalWrites||!config.stripe_payouts_enabled||!startDateReady||!accountMapReady)&&<p style={{fontSize:11,color:'#92400e',marginBottom:0}}>Automatic posting needs preview scans, a start date, both account selections, and QuickBooks posting enabled in the global controls.</p>}
      {notice&&<p role="status" style={{color:'#166534',fontSize:12}}>{notice}</p>}{error&&<p role="alert" style={{color:'#b91c1c',fontSize:12}}>{error}</p>}
      {preview&&<div style={{marginTop:10,padding:10,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,fontSize:11}}><strong>Preview result</strong>{preview.run_id&&<> · run {preview.run_id}</>}{preview.status&&<> · {stateLabel(preview.status)}</>}{previewSummary(preview)&&<div>{previewSummary(preview)}</div>}</div>}
      <div style={{marginTop:16}}><strong style={{fontSize:12}}>Recent automatic deposits</strong>
        {postings.length===0?<div style={{fontSize:11,color:'#64748b',marginTop:5}}>No automatic deposit attempts recorded.</div>:<div style={{overflowX:'auto',marginTop:6}}><table className="data-table"><thead><tr><th>Stripe payout</th><th>State</th><th>QBO deposit</th><th>Details</th><th>Updated</th></tr></thead><tbody>{postings.slice(0,20).map((row,i)=><tr key={row.stripe_payout_id||i}><td style={{fontFamily:'monospace'}}>{row.stripe_payout_id||'—'}</td><td>{stateLabel(row.state)}</td><td>{row.qbo_deposit_id||'—'}</td><td>{row.error_code?stateLabel(row.error_code):'—'}</td><td>{stamp(row.updated_at)}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  </section>;
}
