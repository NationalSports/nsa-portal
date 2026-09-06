// Exercise the component's runtime applied-document lookup against the persisted SO shape.
// This protects the invoice/credit key-space split without mounting the large App component.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createBillApplySession, billingAttemptKey } from '../billApplySession';

const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const extract=name=>{
  const start=source.indexOf('    const '+name+'=');
  if(start<0)throw new Error('Missing '+name);
  return source.slice(start,source.indexOf('\n    };',start)+7);
};

const lookupFor=({sos=[],submittedBatches=[],savedBills=[],ledger=[],session}={})=>{
  const c={sos,submittedBatches,savedBills,billingAttemptKey,_billApplySession:{current:session||createBillApplySession()},_appliedLedger:{current:new Set(ledger)},
    _appliedLedgerKey:(space,value,isCredit)=>space+'|'+(isCredit?'1':'0')+'|'+String(value==null?'':value).trim().toLowerCase()};
  vm.createContext(c);
  vm.runInContext(extract('_docAlreadyApplied')+'\nthis.lookup=_docAlreadyApplied;',c);
  return c.lookup;
};

test('same document can be applied once as invoice and once as credit',()=>{
  const so={id:'SO-1',items:[{po_lines:[{po_id:'PO-1',_bill_details:[
    {doc:'SHARED-1',cost:20,sizes:{M:1}},
    {doc:'SHARED-1',cost:-10,sizes:{M:-1}},
  ]}]}]};
  const lookup=lookupFor({sos:[so]});
  expect(lookup('SHARED-1',undefined,false)).toBe(true);
  expect(lookup('SHARED-1',undefined,true)).toBe(true);
});

test('an invoice detail does not suppress a credit with the same document, but a legacy negative credit does',()=>{
  const invoiceOnly={id:'SO-1',items:[{po_lines:[{po_id:'PO-1',_bill_details:[{doc:'SHARED-2',cost:20,sizes:{M:1}}]}]}]};
  expect(lookupFor({sos:[invoiceOnly]})('SHARED-2',undefined,true)).toBe(false);

  const legacyCredit={id:'SO-1',items:[{po_lines:[{po_id:'PO-1',_bill_details:[{doc:'SHARED-2',cost:-20,sizes:{M:-1}}]}]}]};
  expect(lookupFor({sos:[legacyCredit]})('SHARED-2',undefined,true)).toBe(true);
});

test('a repeated credit with the same document is blocked while the invoice remains independently visible',()=>{
  const so={id:'SO-1',items:[{po_lines:[{po_id:'PO-1',_bill_details:[{doc:'CREDIT-7',is_credit:true,cost:-12,sizes:{M:-1}}]}]}]};
  const lookup=lookupFor({sos:[so]});
  expect(lookup('CREDIT-7',undefined,true)).toBe(true);
  expect(lookup('CREDIT-7',undefined,false)).toBe(false);
});

test('an interrupted attempt fails closed until its target is reconciled',()=>{
  const journal={has:key=>key==='invoice|INTERRUPTED'};
  const lookup=lookupFor({session:createBillApplySession(journal)});
  expect(lookup('INTERRUPTED',undefined,false)).toBe(false);
});
