import { runStripePayouts } from '../../supabase/functions/qbo-sales-background/stripePayoutRunner';

if (!global.crypto?.subtle) global.crypto = require('crypto').webcrypto;
if (!global.TextEncoder) global.TextEncoder = require('util').TextEncoder;

const realm = '9341456492604246';
const runId = '10000000-0000-0000-0000-000000000001';
const leaseToken = '20000000-0000-0000-0000-000000000001';
const payout = {
  stripe_payout_id: 'po_school_1', status: 'paid', automatic: true, currency: 'usd',
  reconciliation_status: 'exact', amount_cents: 9700, activity_amount_cents: 10000,
  fee_cents: 300, net_cents: 9700, reconciliation_difference_cents: 0,
  balance_transaction_count: 1, arrival_date: '2026-10-01',
  stripe_created_at: '2026-10-01T09:00:00Z', qbo_deposit_id: null,
};
const transaction = {
  stripe_balance_transaction_id: 'txn_1', stripe_payout_id: payout.stripe_payout_id,
  source_id: 'ch_1', source_type: 'charge', payment_intent_id: 'pi_1',
  reporting_category: 'charge', transaction_type: 'charge', status: 'available',
  currency: 'usd', amount_cents: 10000, fee_cents: 300, net_cents: 9700,
  webstore_order_id: 'web_order_1',
};
const portalPayment = {
  id: 'portal_payment_1', invoice_id: 'INV-1', amount: 100,
  method: 'store', ref: 'Stripe pi_1', date: '2026-10-01',
};
const invoice = { id: 'INV-1', customer_id: 'C-1', so_id: 'SO-1', total: 100, status: 'paid' };
const order = { id: 'web_order_1', so_id: 'SO-1', stripe_pi_id: 'pi_1' };
const qboInvoice = { Id: 'QINV-1', TotalAmt: 100, CustomerRef: { value: 'QC-1' } };
const qboPayment = {
  Id: 'QPMT-1', TotalAmt: 100, TxnDate: '2026-10-01', CurrencyRef: { value: 'USD' },
  DepositToAccountRef: { value: 'UND-1' }, CustomerRef: { value: 'QC-1' },
  Line: [{ Amount: 100, LinkedTxn: [{ TxnId: 'QINV-1', TxnType: 'Invoice' }] }],
};
const settings = {
  stripe_payouts_enabled: true, stripe_payout_writes_enabled: true,
  stripe_payout_start_date: '2026-10-01', stripe_payout_bank_account_id: 'BANK-1',
  stripe_payout_fee_account_id: 'FEE-1', stripe_payout_canary_id: null,
  continuation_cursor: {},
};
const accounts = [
  { Id: 'BANK-1', Name: 'Operating Bank', Active: true, AccountType: 'Bank' },
  { Id: 'FEE-1', Name: 'Processing Fees', Active: true, AccountType: 'Expense' },
  { Id: 'UND-1', Name: 'Undeposited Funds', Active: true, AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds' },
];
const mapId = (mapKey, sourceId) => '_qb_link_v1_' + encodeURIComponent(JSON.stringify([realm,mapKey,sourceId]));
const linkRow = (mapKey, sourceId, qboId) => ({
  id: mapId(mapKey,sourceId),
  value: JSON.stringify({ realm_id: realm, map_key: mapKey, source_id: sourceId, qbo_id: qboId, active: true }),
});

function makeAdmin(overrides={}) {
  const data = {
    payouts: [{ ...payout }],
    transactions: [{ ...transaction }],
    invoice_payments: [{ ...portalPayment }],
    invoices: [{ ...invoice }],
    webstore_orders: [{ ...order }],
    app_state: [
      linkRow('qbPaymentMap','payment:portal_payment_1','QPMT-1'),
      linkRow('qbInvoiceMap','portal:INV-1','QINV-1'),
      linkRow('custQBMap','C-1','QC-1'),
    ],
    postings: [],
    ...overrides.data,
  };
  const calls = { from: [], rpc: [], upsert: [], update: [] };
  const config = { truncateTransactions:false, ...overrides };

  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.orders=[]; this.max=null; this.bounds=null; this.action='select'; this.values=null; this.selectOptions={}; }
    select(_columns='*',options={}) { this.selectOptions=options||{}; return this; }
    eq(key,value) { this.filters.push([key,'eq',value]); return this; }
    neq(key,value) { this.filters.push([key,'neq',value]); return this; }
    is(key,value) { this.filters.push([key,'is',value]); return this; }
    gte(key,value) { this.filters.push([key,'gte',value]); return this; }
    order(key,options={}) { this.orders.push([key,options.ascending!==false]); return this; }
    limit(value) { this.max=value; return this; }
    range(from,to) { this.bounds=[from,to]; return this; }
    update(values) { this.action='update'; this.values=values; calls.update.push({table:this.table,values}); return this; }
    upsert(values) { this.action='upsert'; this.values=values; calls.upsert.push({table:this.table,values}); return this; }
    async maybeSingle() { const result=await this.execute(); return { data:result.data?.[0]||null,error:null }; }
    async single() { const result=await this.execute(); return { data:result.data?.[0]||null,error:null }; }
    then(resolve,reject) { return this.execute().then(resolve,reject); }
    async execute() {
      const key={qbo_stripe_payout_postings:'postings',stripe_payouts:'payouts',stripe_balance_transactions:'transactions'}[this.table]||this.table;
      const rows=data[key]||[];
      const matches=row=>this.filters.every(([field,op,value])=>{
        if(op==='eq') return row[field]===value;
        if(op==='neq') return row[field]!==value;
        if(op==='is') return row[field]===value;
        if(op==='gte') return row[field]>=value;
        return false;
      });
      if(this.action==='upsert') {
        const incoming=Array.isArray(this.values)?this.values:[this.values];
        for(const item of incoming){const at=rows.findIndex(row=>row.stripe_payout_id===item.stripe_payout_id);if(at>=0)rows[at]={...rows[at],...item};else rows.push({...item});}
        return {data:incoming,error:null};
      }
      if(this.action==='update') {
        const selected=rows.filter(matches);
        for(const row of selected)Object.assign(row,this.values);
        return {data:selected,error:null};
      }
      let selected=rows.filter(matches).map(row=>({...row}));
      for(const [field,ascending] of this.orders.slice().reverse()) selected.sort((a,b)=>{
        const order=String(a[field]??'').localeCompare(String(b[field]??''));return ascending?order:-order;
      });
      const count=selected.length;
      if(this.table==='stripe_balance_transactions'&&config.truncateTransactions)selected=selected.slice(0,1);
      if(this.max!=null)selected=selected.slice(0,this.max);
      if(this.bounds)selected=selected.slice(this.bounds[0],this.bounds[1]+1);
      if(this.selectOptions.head)return {data:null,count,error:null};
      return {data:selected,count:this.selectOptions.count==='exact'?count:undefined,error:null};
    }
  }
  const admin={
    from:jest.fn(table=>{calls.from.push(table);return new Query(table);}),
    rpc:jest.fn(async(name,args)=>{
      calls.rpc.push({name,args});
      if(name!=='claim_qbo_stripe_payout')return {data:null,error:null};
      const {p_payout_id,p_payload,p_source_hash,p_request_id,p_run_id}=args;
      const existing=data.postings.find(row=>row.stripe_payout_id===p_payout_id);
      if(existing&&!['proposed','held'].includes(existing.state))return {data:false,error:null};
      if(existing)Object.assign(existing,{state:'submitting',payload:p_payload,source_hash:p_source_hash,request_id:p_request_id,run_id:p_run_id});
      else data.postings.push({stripe_payout_id:p_payout_id,realm_id:realm,state:'submitting',payload:p_payload,source_hash:p_source_hash,request_id:p_request_id,run_id:p_run_id});
      return {data:true,error:null};
    }),
  };
  return {admin,data,calls,config};
}

function makeQbo(overrides={}) {
  const deposits=[...(overrides.deposits||[])];
  const requests=[];
  let nextId=1;
  const queryAll=jest.fn(async entity=>entity==='Deposit'?deposits:[]);
  const request=jest.fn(async(path,options={})=>{
    requests.push({path,options});
    if(path==='/invoice/QINV-1')return {Invoice:{...qboInvoice}};
    if(path==='/payment/QPMT-1')return {Payment:{...qboPayment}};
    if(path.startsWith('/deposit?requestid=')&&options.method==='POST'){
      const proposed=JSON.parse(options.body);
      const actual={...proposed,Id:`QDEP-${nextId++}`,TotalAmt:97};
      deposits.push(actual);
      if(overrides.postError)throw new Error('connection reset after QBO accepted the request');
      return {Deposit:actual};
    }
    if(path.startsWith('/deposit/'))return {Deposit:deposits.find(row=>row.Id===path.slice('/deposit/'.length))};
    return {};
  });
  return {realmId:realm,request,queryAll,requests,deposits};
}

const run = ({admin,qbo,settings:overrides={},canWrite=true,renewLease=jest.fn(async()=>{})}) =>
  runStripePayouts({admin,qbo,settings:{...settings,...overrides},accounts,undepositedId:'UND-1',runId,leaseToken,canWrite,renewLease,homeCurrency:'USD'});

describe('Stripe payout runner orchestration',()=>{
  test('disabled payout automation performs no source or QBO reads',async()=>{
    const {admin,calls}=makeAdmin();const qbo=makeQbo();
    const result=await run({admin,qbo,settings:{stripe_payouts_enabled:false}});
    expect(result).toMatchObject({disabled:true,examined:0});
    expect(admin.from).not.toHaveBeenCalled();expect(admin.rpc).not.toHaveBeenCalled();
    expect(qbo.queryAll).not.toHaveBeenCalled();expect(qbo.request).not.toHaveBeenCalled();
    expect(calls.upsert).toHaveLength(0);
  });

  test('preview proposes a verified deposit but never claims or POSTs',async()=>{
    const {admin,data,calls}=makeAdmin();const qbo=makeQbo();
    const result=await run({admin,qbo,canWrite:false});
    expect(result).toMatchObject({examined:1,proposed:1,posted:0,held:0});
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(0);
    expect(data.postings[0]).toMatchObject({state:'proposed',stripe_payout_id:payout.stripe_payout_id});
    expect(calls.upsert).toHaveLength(1);
  });

  test('live run claims once, verifies the QBO read-back, and saves both durable pointers',async()=>{
    const {admin,data}=makeAdmin();const qbo=makeQbo();
    const result=await run({admin,qbo,canWrite:true});
    expect(result).toMatchObject({examined:1,proposed:1,posted:1,held:0});
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith('claim_qbo_stripe_payout',expect.objectContaining({p_payout_id:payout.stripe_payout_id,p_run_id:runId,p_lease_token:leaseToken}));
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(1);
    expect(qbo.requests.some(row=>row.path==='/deposit/QDEP-1')).toBe(true);
    expect(data.postings[0]).toMatchObject({state:'posted',qbo_deposit_id:'QDEP-1'});
    expect(data.payouts[0]).toMatchObject({qbo_deposit_id:'QDEP-1'});
    expect(data.payouts[0].qbo_posted_at).toBeTruthy();
  });

  test('uncertain POST is persisted unknown and later recovered without a second POST',async()=>{
    const {admin,data}=makeAdmin();const qbo=makeQbo({postError:true});
    const first=await run({admin,qbo,canWrite:true});
    expect(first).toMatchObject({examined:1,held:1,posted:0});
    expect(data.postings[0]).toMatchObject({state:'unknown',error_code:'stripe_payout_failed'});
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(1);
    qbo.request.mockImplementation(async(path,options={})=>{
      qbo.requests.push({path,options});
      if(path==='/invoice/QINV-1')return {Invoice:{...qboInvoice}};
      if(path==='/payment/QPMT-1')return {Payment:{...qboPayment}};
      if(path.startsWith('/deposit?requestid=')&&options.method==='POST')throw new Error('second POST must never happen');
      return {};
    });
    const second=await run({admin,qbo,canWrite:true});
    expect(second).toMatchObject({examined:1,recovered:1,posted:0,held:0});
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(1);
    expect(data.postings[0]).toMatchObject({state:'posted',qbo_deposit_id:'QDEP-1'});
    expect(data.payouts[0]).toMatchObject({qbo_deposit_id:'QDEP-1'});
  });

  test('a manual deposit already containing the payment causes a hold',async()=>{
    const manual={Id:'QDEP-MANUAL',PrivateNote:'Entered by staff',Line:[{Amount:100,LinkedTxn:[{TxnId:'QPMT-1',TxnType:'Payment'}]}]};
    const {admin,data}=makeAdmin();const qbo=makeQbo({deposits:[manual]});
    const result=await run({admin,qbo,canWrite:true});
    expect(result).toMatchObject({examined:1,proposed:0,posted:0,held:1});
    expect(data.postings[0]).toMatchObject({state:'held',error_code:'stripe_payout_payment_already_deposited'});
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(0);
  });

  test('missing QBO payment mapping is held before claim or POST',async()=>{
    const overrides={app_state:[]};const {admin,data}=makeAdmin({data:overrides});const qbo=makeQbo();
    const result=await run({admin,qbo,canWrite:true});
    expect(result).toMatchObject({examined:1,held:1,posted:0});
    expect(data.postings[0]).toMatchObject({state:'held',error_code:'stripe_payout_mapping_missing'});
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(0);
  });

  test.each([
    ['oversized payout transaction set', { transactionCount:501, transactions:Array.from({length:501},(_,i)=>({...transaction,stripe_balance_transaction_id:`txn_${i}`})) }],
    ['partial transaction read', { transactionCount:2, transactions:[{...transaction},{...transaction,stripe_balance_transaction_id:'txn_2'}], truncateTransactions:true }],
  ])('%s is held without creating a deposit',async(_label,setup)=>{
    const alteredPayout={...payout,balance_transaction_count:setup.transactionCount};
    const {admin,data}=makeAdmin({data:{payouts:[alteredPayout],transactions:setup.transactions},truncateTransactions:setup.truncateTransactions});
    const qbo=makeQbo();const result=await run({admin,qbo,canWrite:true});
    expect(result).toMatchObject({examined:1,held:1,posted:0});
    expect(data.postings[0]).toMatchObject({state:'held',error_code:'stripe_payout_too_many_transactions'});
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(qbo.requests.filter(row=>row.options.method==='POST')).toHaveLength(0);
  });
});
