import {createQBSyncEngine} from '../qbSyncEngine';
import {QB_LINK_MAPS} from '../qbLinkLedger';

const mapping={income_account:'40000',tax_ca_account:'25200',tax_wa_account:'25230'};
const accounts=[
  {Id:'900',AcctNum:'25230',Name:'WA Sales Tax Payable',AccountType:'Other Current Liability',Active:true},
  {Id:'901',AcctNum:'25200',Name:'CA Sales Tax Payable',AccountType:'Other Current Liability',Active:true},
];
function setup({partnerTax=false,agencies=[],codes=[],rates=[],failCreate=false,accountMapping=mapping,chart=accounts}={}){
  let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping:accountMapping,syncLog:[]};
  const created={};
  const qbApi=jest.fn(async(action,args={})=>{
    if(action==='query'){
      const q=args.query||'';
      if(q.includes('FROM Preferences'))return{QueryResponse:{Preferences:[{TaxPrefs:{PartnerTaxEnabled:partnerTax,UsingSalesTax:false}}]}};
      if(q.includes('FROM TaxAgency'))return{QueryResponse:{TaxAgency:agencies}};
      if(q.includes('FROM TaxCode'))return{QueryResponse:{TaxCode:codes}};
      if(q.includes('FROM TaxRate'))return{QueryResponse:{TaxRate:rates}};
      if(q.includes('FROM Account'))return{QueryResponse:{Account:chart}};
      return{QueryResponse:{}};
    }
    if(action==='upsert_taxagency'){created.agency=args.taxagency;return{TaxAgency:{Id:'55',DisplayName:args.taxagency.DisplayName}}}
    if(action==='create_taxcode'){
      created.taxcode=args.taxcode;
      if(failCreate)return{Fault:{Error:[{Detail:'QBO refused the tax code'}]}};
      const detail=args.taxcode.TaxRateDetails[0];
      rates.push({Id:'77',Name:detail.TaxRateName,RateValue:detail.RateValue,AgencyRef:{value:'55'},Active:true});
      codes.push({Id:'88',Name:args.taxcode.TaxCode,Active:true});
      return{TaxCodeId:'88',TaxRateDetails:[{TaxRateId:'77'}]};
    }
    throw new Error('Unexpected '+action);
  });
  const persistQbLink=jest.fn(async()=>{});
  const engine=createQBSyncEngine({cust:[],sos:[],invs:[],prod:[],vend:[],qbApi,qbConfig:config,persistQbLink,
    nf:jest.fn(),setQbSyncing:jest.fn(),setQBConfig:fn=>{config=fn(config);}});
  return {engine,qbApi,persistQbLink,created,config:()=>config};
}
const wa={state:'WA',agencyName:'Washington Department of Revenue',rateName:'WA Sales Tax',ratePercent:'8.8'};

test('the tax-rate map is a durable link map',()=>{expect(QB_LINK_MAPS).toContain('qbTaxRateMap')});

test('the first call only proposes; nothing is created without explicit approval',async()=>{
  const run=setup();
  expect(await run.engine.syncTaxRateCanary(wa)).toMatchObject({status:'needs_confirmation',state:'WA',percent:8.8,agencyExists:false});
  expect(run.qbApi.mock.calls.some(([a])=>a!=='query')).toBe(false);
});

test('approval creates exactly one agency and one code, verified by read-back',async()=>{
  const run=setup();
  const result=await run.engine.syncTaxRateCanary({...wa,allowCreate:true});
  expect(result).toMatchObject({status:'success',state:'WA',taxCodeId:'88',rateId:'77',ratePercent:8.8});
  expect(run.qbApi.mock.calls.filter(([a])=>a==='upsert_taxagency')).toHaveLength(1);
  expect(run.created.taxcode.TaxRateDetails[0]).toMatchObject({RateValue:8.8,TaxAgencyId:'55',TaxApplicableOn:'Sales'});
  const receipt=run.persistQbLink.mock.calls[0][0];
  expect(receipt).toMatchObject({mapKey:'qbTaxRateMap',sourceIds:['WA'],qboId:'77'});
  expect(receipt.evidence).toMatchObject({state:'WA',tax_code_id:'88',approved_account:'25230',api_readback:true});
  // The account QBO actually uses is reported, not assumed to be the approved one.
  expect(receipt.log.details.join(' ')).toMatch(/confirm on the first taxable invoice which account actually moves/);
});

test('an existing agency is reused rather than duplicated',async()=>{
  const run=setup({agencies:[{Id:'12',DisplayName:'Washington Department of Revenue'}]});
  await run.engine.syncTaxRateCanary({...wa,allowCreate:true});
  expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_taxagency')).toBe(false);
  expect(run.created.taxcode.TaxRateDetails[0].TaxAgencyId).toBe('12');
});

test('Automated Sales Tax being on stops the whole thing before any write',async()=>{
  const run=setup({partnerTax:true});
  expect(await run.engine.syncTaxRateCanary({...wa,allowCreate:true}))
    .toMatchObject({status:'blocked',error:expect.stringMatching(/Automated Sales Tax is enabled/)});
  expect(run.qbApi.mock.calls.some(([a])=>a!=='query')).toBe(false);
});

test('duplicate names and ambiguous agencies block before writing',async()=>{
  expect(await setup({codes:[{Id:'9',Name:'WA Sales Tax',Active:true}]}).engine.syncTaxRateCanary({...wa,allowCreate:true}))
    .toMatchObject({status:'blocked',error:expect.stringMatching(/already exists/)});
  expect(await setup({agencies:[{Id:'1',DisplayName:'Washington Department of Revenue'},{Id:'2',DisplayName:'washington department of revenue'}]})
    .engine.syncTaxRateCanary({...wa,allowCreate:true})).toMatchObject({status:'blocked',error:expect.stringMatching(/Multiple QBO tax agencies/)});
});

test.each([['unmapped state',{state:'ZZ'}],['zero percent',{ratePercent:'0'}],['absurd percent',{ratePercent:'40'}],['no agency name',{agencyName:'  '}]])
('%s is refused before any QBO call',async(_label,override)=>{
  const run=setup();
  expect(await run.engine.syncTaxRateCanary({...wa,...override,allowCreate:true})).toMatchObject({status:'blocked'});
  expect(run.qbApi).not.toHaveBeenCalled();
});

test('an unresolvable liability account does not discard a rate that was already created',async()=>{
  // The approved 25230 account is absent from the QBO chart. The rate itself exists and
  // was verified, so the receipt must still be saved, flagged rather than thrown away.
  const run=setup({chart:[]});
  const result=await run.engine.syncTaxRateCanary({...wa,allowCreate:true});
  expect(result.status).toBe('success');
  expect(run.persistQbLink).toHaveBeenCalledTimes(1);
  expect(run.persistQbLink.mock.calls[0][0].evidence.approved_account).toBeNull();
  expect(run.persistQbLink.mock.calls[0][0].log.details.join(' ')).toMatch(/created and verified, but the approved WA liability account could not be resolved/);
});

test('a failed create saves no link',async()=>{
  const run=setup({failCreate:true});
  expect(await run.engine.syncTaxRateCanary({...wa,allowCreate:true})).toMatchObject({status:'blocked'});
  expect(run.persistQbLink).not.toHaveBeenCalled();
});
