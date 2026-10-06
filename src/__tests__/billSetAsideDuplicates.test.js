import fs from 'fs';
import path from 'path';
import { billHoldKey, collapseParkedHolds } from '../appliedBillsLedger';

const APP=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

describe('set-aside bills are one entry per bill',()=>{
  it('keys a bill by vendor doc#, SI order# and invoice-vs-credit',()=>{
    expect(billHoldKey({doc_number:' 030714202 ',si_doc_number:24782836})).toBe('0|030714202|24782836');
    expect(billHoldKey({doc_number:'A1',is_credit:true})).toBe('1|a1|');
    expect(billHoldKey({doc_number:'A1'})).not.toBe(billHoldKey({doc_number:'A1',is_credit:true}));
    expect(billHoldKey({})).toBeNull();
  });

  it('keeps the newest parked row per bill and drops older copies, leaving resolved rows and number-less rows alone',()=>{
    const rows=[
      {id:'new',status:'parked',parsed:{doc_number:'030714202',si_doc_number:'24782836'}},
      {id:'old1',status:'parked',parsed:{doc_number:'030714202',si_doc_number:'24782836'}},
      {id:'old2',status:'parked',doc_number:'030714202',si_doc_number:'24782836'},
      {id:'res',status:'resolved',parsed:{doc_number:'030714202',si_doc_number:'24782836'}},
      {id:'credit',status:'parked',parsed:{doc_number:'030714202',si_doc_number:'24782836',is_credit:true}},
      {id:'blank1',status:'parked',parsed:{}},
      {id:'blank2',status:'parked',parsed:{}},
    ];
    const{keep,drop}=collapseParkedHolds(rows);
    expect([...drop].sort()).toEqual(['old1','old2']);
    expect(keep.get('0|030714202|24782836')).toBe('new');
    expect(keep.get('1|030714202|24782836')).toBe('credit');
  });
});

describe('the daily pull waits for the set-aside list',()=>{
  it('loads every hold a page at a time instead of the newest 2000',()=>{
    expect(APP).not.toContain(".in('status',['parked','resolved']).order('held_at',{ascending:false}).limit(2000)");
    expect(APP).toContain(".in('status',['parked','resolved']).order('held_at',{ascending:false}).range(from,from+999)");
    expect(APP).toContain('const{keep:parkedKeep,drop:dropIds}=collapseParkedHolds(data);');
  });

  it('auto-pull only fires once the holds are merged, and a manual pull warns before then',()=>{
    expect(APP).toContain("||!billHoldsReady)return;");
    expect(APP).toContain('},[pg,impTab,billHoldsReady]);');
    expect(APP.indexOf('setBillHoldsReady(true);')).toBeGreaterThan(APP.indexOf('const loadBillHolds=async()=>{'));
    expect(APP).toContain("if(!billHoldsReady&&!window.confirm('Set-aside bills are still loading.");
  });

  it('checks held bills against the live list, not the render the pull started in',()=>{
    expect(APP).toContain('_savedBillsRef.current=savedBills;');
    expect(APP).toContain('return (_savedBillsRef.current||[]).some(sb=>{');
  });
});
