import fs from 'fs';
import path from 'path';
import {
  allocateUnreflectedPayments, classifyInvoiceDuplicate, classifySourceInvoice,
  cardFeeDriftEligible, cardFeeLineUpdate, CARD_FEE_DESCRIPTION, invoiceResyncUpdate, invoiceStillSettling, buildInvoiceLines,
  customerIdentityRisks, invoiceNumberForms, linkedInvoiceTotalDrift, normalizeInvoiceNumber,
  paymentIdentity, paymentReference, writeAllowed,
} from '../../supabase/functions/qbo-sales-background/logic';

const root=path.join(__dirname,'..','..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

describe('server QBO invoice duplicate protection',()=>{
  test('only the optional NS prefix is normalized',()=>{
    expect(normalizeInvoiceNumber('NS-INV-63133')).toBe('INV-63133');
    expect(normalizeInvoiceNumber('INV-63133')).toBe('INV-63133');
    expect(invoiceNumberForms('INV-63133')).toEqual(['INV-63133','NS-INV-63133']);
  });

  test.each(['INV-63133','INV-63199','INV-63255'])('%s alias links only on exact identity',documentNumber=>{
    const source={documentNumber,qboCustomerId:'55',date:'2026-09-16',total:100.25};
    expect(classifyInvoiceDuplicate(source,[{Id:'9',DocNumber:'NS-'+documentNumber,CustomerRef:{value:'55'},TxnDate:'2026-09-16',TotalAmt:100.25}])).toMatchObject({disposition:'link_existing',qboId:'9'});
  });

  test.each([
    ['customer',{CustomerRef:{value:'other'}}],
    ['date',{TxnDate:'2026-09-15'}],
    ['amount',{TotalAmt:100.26}],
  ])('same number with different %s requires manual review',(_field,change)=>{
    const source={documentNumber:'INV-1',qboCustomerId:'55',date:'2026-09-16',total:100.25};
    const qbo={Id:'9',DocNumber:'INV-1',CustomerRef:{value:'55'},TxnDate:'2026-09-16',TotalAmt:100.25,...change};
    expect(classifyInvoiceDuplicate(source,[qbo]).disposition).toBe('manual_review');
  });

  test('multiple same-number records remain ambiguous even when one is exact',()=>{
    const source={documentNumber:'INV-1',qboCustomerId:'55',date:'2026-09-16',total:100};
    expect(classifyInvoiceDuplicate(source,[
      {Id:'1',DocNumber:'INV-1',CustomerRef:{value:'55'},TxnDate:'2026-09-16',TotalAmt:100},
      {Id:'2',DocNumber:'NS-INV-1',CustomerRef:{value:'77'},TxnDate:'2026-09-16',TotalAmt:100},
    ]).disposition).toBe('manual_review');
  });
});

describe('customer linking safety',()=>{
  test('existing balances and conflicting identity fields require review',()=>{
    expect(customerIdentityRisks({contact_email:'a@example.com',billing_address_line1:'1 Main St',billing_city:'Reno'},
      {PrimaryEmailAddr:{Address:'b@example.com'},BillAddr:{Line1:'2 Main St',City:'Sparks'},Balance:25}))
      .toEqual(['email_mismatch','address_mismatch','city_mismatch','existing_balance']);
  });
});

describe('source eligibility',()=>{
  const today='2026-09-16';
  test('zero dollars are excluded',()=>expect(classifySourceInvoice({id:'INV-1',date:today,total:0,status:'open'},today).action).toBe('excluded_zero'));
  test('future invoices are held',()=>expect(classifySourceInvoice({id:'INV-1',date:'2026-09-17',total:1,status:'open'},today).action).toBe('held_future'));
  test('future invoices become eligible on their date',()=>expect(classifySourceInvoice({id:'INV-1',date:'2026-09-17',total:1,status:'open'},'2026-09-17').action).toBe('eligible'));
  test('void invoices are excluded',()=>expect(classifySourceInvoice({id:'INV-1',date:today,total:1,status:'void'},today).action).toBe('excluded_void'));
  test('INV-63831 is always manually blocked',()=>expect(classifySourceInvoice({id:'INV-63831',date:today,total:2149.02,status:'open'},today)).toMatchObject({action:'manual_review',reason:'explicit_manual_block'}));
});

describe('payment idempotency',()=>{
  test('immutable payment ID drives the durable source and deterministic reference',()=>{
    expect(paymentIdentity({id:391})).toBe('payment:391');
    expect(paymentReference({id:391})).toBe('NSA-P391');
  });
  test('already-applied dollars are consumed in source date order',()=>{
    expect(allocateUnreflectedPayments([
      {id:2,date:'2026-09-02',amount:60},{id:1,date:'2026-09-01',amount:50},
    ],70).map(row=>row.remainingAmount)).toEqual([0,40]);
  });
  test('partial source payment remains bounded to the unapplied amount',()=>{
    expect(allocateUnreflectedPayments([{id:1,date:'2026-09-01',amount:100}],35)[0]).toMatchObject({coveredAmount:35,remainingAmount:65});
  });
});

describe('linked invoice total drift',()=>{
  // INV-63804: invoiced to QBO at $456.00, then a 2.9% card surcharge raised the
  // Portal total to $469.22 at payment time, so the $469.22 payment was refused.
  const invoice={id:'INV-63804',total:469.22,status:'paid'};
  test('a surcharge added after linking is reported with both totals',()=>{
    expect(linkedInvoiceTotalDrift(invoice,{TotalAmt:456})).toEqual({
      portal_total:469.22,qbo_total:456,difference:13.22,
    });
  });
  test('the drift itself stays amounts-only; the fee is read from the invoice by the caller',()=>{
    // The snapshot did not carry cc_fee until 20260927160000, so a fee read
    // inside this helper once reported $0 on every surcharge.  Keep the helper
    // to the two totals and let callers attach the (now real) invoice fee.
    expect(linkedInvoiceTotalDrift({...invoice,cc_fee:13.22},{TotalAmt:456}))
      .not.toHaveProperty('cc_fee');
  });
  test('a voided invoice whose QBO counterpart was zeroed is not drift',()=>{
    // INV-63120/INV-63121: $930 each, voided in the Portal, zeroed in QBO on
    // purpose.  The mapped-invoice branch runs before classifySourceInvoice, so
    // without this the void exclusion never reached them and both alerted.
    expect(linkedInvoiceTotalDrift({id:'INV-63120',total:930,status:'void'},{TotalAmt:0})).toBeNull();
    expect(linkedInvoiceTotalDrift({id:'INV-63120',total:930,deleted_at:'2026-09-24T00:00:00Z'},{TotalAmt:0})).toBeNull();
  });
  test('a matching total is not drift',()=>{
    expect(linkedInvoiceTotalDrift(invoice,{TotalAmt:469.22})).toBeNull();
  });
  test('sub-cent float noise is not drift',()=>{
    expect(linkedInvoiceTotalDrift({total:100},{TotalAmt:100.004})).toBeNull();
  });
  test('a Portal total below QBO is reported too',()=>{
    expect(linkedInvoiceTotalDrift({total:400},{TotalAmt:456})).toMatchObject({difference:-56});
  });
  test('a missing QBO total is drift, not a silent zero match',()=>{
    expect(linkedInvoiceTotalDrift({total:456},{})).toMatchObject({qbo_total:0,difference:456});
  });
});

describe('held records carry diagnosable evidence',()=>{
  const edge=read('supabase/functions/qbo-sales-background/index.ts');
  test('a drifted invoice is reviewed instead of silently staying linked',()=>{
    expect(edge).toContain("review('invoice',sourceId,'mapped_invoice_total_changed',{qbo_id:mappedId,...drift,cc_fee:money(invoice.cc_fee)})");
  });
  test('payments for a drifted invoice are suppressed so one alert explains the cause',()=>{
    expect(edge).toContain('if(invoiceTotalDrifted.has(String(invoice.id)))continue;');
  });
  test('a refused payment records the amounts that refused it',()=>{
    expect(edge).toContain("code:'payment_amount_conflict',details:{payment_amount:candidate.amount,qbo_invoice_balance:balance");
    expect(edge).toContain('review(\'payment\',candidate.sourceId,errorCode(error),evidence)');
  });
});

describe('rollout and security contract',()=>{
  const migration=read('supabase/migrations/20260916135649_qbo_background_sales_automation.sql');
  const edge=read('supabase/functions/qbo-sales-background/index.ts');
  const qbo=read('supabase/functions/qbo-sales-background/qbo.ts');

  test('read-only is the migration default and writes need both switches',()=>{
    expect(migration).toContain("writes_enabled boolean not null default false");
    expect(migration).toContain("phase text not null default 'read_only'");
    expect(writeAllowed({writes_enabled:false,phase:'hourly'},'invoice','portal:INV-1')).toBe(false);
    expect(writeAllowed({writes_enabled:true,kill_switch:true,phase:'hourly'},'invoice','portal:INV-1')).toBe(false);
  });
  test('canary phases allow only the configured immutable source',()=>{
    const settings={writes_enabled:true,phase:'invoice_canary',canary_invoice_source_id:'portal:INV-1'};
    expect(writeAllowed(settings,'invoice','portal:INV-1')).toBe(true);
    expect(writeAllowed(settings,'invoice','portal:INV-2')).toBe(false);
  });
  test('Cron is hourly, service authenticated, and the endpoint verifies service scheduling',()=>{
    expect(migration).toContain("'17 * * * *'");
    expect(migration).toContain("decrypted_secret from vault.decrypted_secrets where name='service_role_key'");
    expect(edge).toContain("jwtRole(token)==='service_role'");
    expect(edge).toContain("if(!actor.service)return json({ok:false,error:'Scheduled invocation requires service authentication.'},403)");
  });
  test('global, customer, invoice, payment, and OAuth leases are present',()=>{
    expect(migration).toContain('create unique index qbo_sales_one_running');
    expect(migration).toContain('create function public.acquire_qbo_sales_source_claim');
    expect(edge).toContain("admin.rpc('acquire_qbo_invoice_sync_claim'");
    expect(qbo).toContain("admin.rpc('acquire_qbo_oauth_refresh_claim'");
  });
  test('rotated refresh tokens are persisted with compare-and-swap',()=>{
    expect(qbo).toContain(".eq('company_key','national').eq('refresh_token',oldRefresh).select('realm_id')");
  });
  test('paginated QBO reads use the supported SELECT-star query form',()=>{
    expect(qbo).toContain('`SELECT * FROM ${entity}${where?` WHERE ${where}`:\'\'} STARTPOSITION ${start} MAXRESULTS ${pageSize}`');
    expect(qbo).not.toContain('`SELECT ${fields} FROM ${entity}');
  });
  test('the run does not load every historical QBO payment',()=>{
    expect(edge).not.toContain("qbo.queryAll('Payment')");
    expect(edge).toContain('SELECT * FROM Payment WHERE CustomerRef =');
    expect(edge).toContain("clean(invoice.status).toLowerCase()==='void'");
  });
  test('invoice preflight is bounded to the Portal invoice date range',()=>{
    expect(edge).toContain("qbo.queryAll('Invoice','*',1000,`TxnDate >=");
  });
  test('manifest is append-only and internal tables deny browser roles',()=>{
    expect(migration).toContain('QBO sales run manifests are append-only');
    expect(migration).toContain('revoke all on public.qbo_sales_runs from public, anon, authenticated');
    expect(migration).toContain('revoke all on function public.acquire_qbo_sales_run');
  });
  test('scheduled sales scope contains no purchasing write action',()=>{
    expect(edge).not.toMatch(/upsert_(bill|purchase|vendor)|\/bill|\/purchaseorder|\/journalentry|\/item\W*\{method:'POST'/i);
    expect(edge).toContain("qbo.request('/customer'");
    expect(edge).toContain("qbo.request('/invoice'");
    expect(edge).toContain("qbo.request('/payment'");
  });
  test('every sales write is followed by entity read-back before receipt storage',()=>{
    expect(edge).toContain("qbo.request('/preferences')");
    expect(edge).toMatch(/qbo\.request\('\/customer'.*qbo\.request\(`\/customer\/\$\{created\.Id\}`/s);
    expect(edge).toMatch(/qbo\.request\('\/invoice'.*qbo\.request\(`\/invoice\/\$\{created\.Id\}`/s);
    expect(edge).toMatch(/qbo\.request\('\/payment'.*qbo\.request\(`\/payment\/\$\{created\.Id\}`/s);
    expect(edge).toContain("postflight_verified:'qbo_requery'");
    expect(edge).toContain("money(verified.TotalAmt)!==candidate.amount");
  });
});

describe('card-fee drift the sync may close itself',()=>{
  // Truckee Little League, INV-63232: invoiced to QBO at $553.04, paid online 9/26
  // with the 2.9% surcharge, Portal now $569.08, cc_fee $16.04.
  const invoice={id:'INV-63232',total:569.08,cc_fee:16.04,status:'paid'};
  const qbo={Id:'949',SyncToken:'2',TotalAmt:553.04,TxnTaxDetail:{TotalTax:0},Line:[
    {Id:'1',DetailType:'SalesItemLineDetail',Amount:553.04,Description:'Invoice INV-63232 for SO-1207 — Sleeves',SalesItemLineDetail:{ItemRef:{value:'180'}}},
    {DetailType:'SubTotalLineDetail',Amount:553.04,SubTotalLineDetail:{}},
  ]};

  test('eligible only when the drift is exactly the recorded fee',()=>{
    expect(cardFeeDriftEligible(invoice,{difference:16.04})).toEqual({fee:16.04});
    expect(cardFeeDriftEligible(invoice,{difference:16.05})).toBeNull();
    // QBO above the Portal (INV-64006 shape) is never a fee to add.
    expect(cardFeeDriftEligible(invoice,{difference:-16.04})).toBeNull();
    expect(cardFeeDriftEligible({...invoice,cc_fee:0},{difference:16.04})).toBeNull();
    expect(cardFeeDriftEligible(invoice,null)).toBeNull();
  });

  test('appends the fee line the books already use, keeping every existing line',()=>{
    const update=cardFeeLineUpdate(invoice,qbo,'180');
    expect(update).toMatchObject({Id:'949',SyncToken:'2',sparse:true,TxnTaxDetail:{TotalTax:0}});
    expect(update.Line).toHaveLength(2); // original line kept, subtotal dropped, fee added
    expect(update.Line[0].Id).toBe('1');
    expect(update.Line[1]).toMatchObject({Amount:16.04,Description:CARD_FEE_DESCRIPTION,
      SalesItemLineDetail:{Qty:1,UnitPrice:16.04,ItemRef:{value:'180'},TaxCodeRef:{value:'NON'}}});
    expect(CARD_FEE_DESCRIPTION).toBe('Customer credit-card processing fee');
  });

  test('never adds a second fee line',()=>{
    const fixed={...qbo,Line:[...qbo.Line,{DetailType:'SalesItemLineDetail',Amount:16.04,Description:'Customer credit-card processing fee'}]};
    expect(()=>cardFeeLineUpdate(invoice,fixed,'180')).toThrow('card_fee_line_exists');
  });

  test('refuses when QBO moved since the drift was measured',()=>{
    expect(()=>cardFeeLineUpdate(invoice,{...qbo,TotalAmt:560},'180')).toThrow('card_fee_amount_mismatch');
  });

  test('leaves a taxed invoice to a person',()=>{
    expect(()=>cardFeeLineUpdate(invoice,{...qbo,TxnTaxDetail:{TotalTax:12.5}},'180')).toThrow('card_fee_taxed_invoice');
  });

  test('refusals carry the amounts, so the alert is diagnosable',()=>{
    try{cardFeeLineUpdate(invoice,{...qbo,TotalAmt:560},'180');}catch(error){
      expect(error.details).toEqual({cc_fee:16.04,portal_total:569.08,qbo_total:560});
    }
  });
});

describe('snapshot carries the invoice card fee',()=>{
  const sql=read('supabase/migrations/20260927160000_qbo_sales_snapshot_invoice_cc_fee.sql');
  test('cc_fee is projected on invoices and the function stays service-role only',()=>{
    expect(sql).toContain("'deleted_at',i.deleted_at,'cc_fee',i.cc_fee");
    expect(sql).toContain('revoke all on function public.qbo_sales_source_snapshot_without_links(timestamptz) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.qbo_sales_source_snapshot_without_links(timestamptz) to service_role');
  });
});

describe('card-fee write is gated, fresh, and read back',()=>{
  const edge=read('supabase/functions/qbo-sales-background/index.ts');
  test('only queued when writes are enabled and allowed for this invoice',()=>{
    expect(edge).toContain("if(feeDrift&&claim.writes_enabled&&writeAllowed(settings,'invoice',sourceId)){");
  });
  test('built from a fresh QBO read taken under the invoice claim',()=>{
    expect(edge).toMatch(/acquire_qbo_invoice_sync_claim[\s\S]*const fresh=\(await qbo\.request\(`\/invoice\/\$\{candidate\.qboId\}`\)\)\.Invoice;\s*const update=cardFeeLineUpdate\(candidate\.invoice,fresh,String\(salesItem\.Id\)\);/);
  });
  test('payments are released only after QBO reads back the Portal total',()=>{
    expect(edge).toContain("if(money(verified?.TotalAmt)!==money(candidate.invoice.total)||money(verified?.TxnTaxDetail?.TotalTax)!==0)");
    expect(edge).toMatch(/card_fee_readback_mismatch[\s\S]*invoiceTotalDrifted\.delete\(String\(candidate\.invoice\.id\)\)/);
  });
});

describe('invoice change sync: Portal edits after the QBO write',()=>{
  // Encinitas Express Soccer, INV-64006: written to QBO #18641 at $56,534.77, then
  // re-costed in the Portal to $55,785.82 and paid in full by EFT.
  const invoice={id:'INV-64006',so_id:'SO-1405',customer_id:'c-enc',total:55785.82,tax:3834.5,shipping:2473.87,credit_amount:0,tax_rate:0.0775};
  const plan={tax:3834.5,shipping:2473.87,state:'CA',reconciled:true,ratePct:'7.75',taxable:49477.45};
  const lines=buildInvoiceLines({invoice,description:'Invoice INV-64006 for SO-1405 — Rec order 2026',salesItemId:'180',taxItemId:'1322',plan,discountAccountId:'77'});
  const qbo={Id:'18641',SyncToken:'4',CustomerRef:{value:'555'},TxnDate:'2026-09-17',TotalAmt:56534.77,Balance:748.95,TxnTaxDetail:{TotalTax:0},Line:[
    {DetailType:'SalesItemLineDetail',Amount:50141.70,SalesItemLineDetail:{ItemRef:{value:'180'}}},
    {DetailType:'SalesItemLineDetail',Amount:2507.09,SalesItemLineDetail:{ItemRef:{value:'180'}}},
    {DetailType:'SalesItemLineDetail',Amount:3885.98,SalesItemLineDetail:{ItemRef:{value:'1322'}}},
    {DetailType:'SubTotalLineDetail',Amount:56534.77,SubTotalLineDetail:{}},
  ]};
  const args=over=>({invoice,qboInvoice:qbo,qboCustomerId:'555',lines,knownItemIds:['180','1322'],discountAccountId:'77',bookCloseDate:'2026-08-31',...over});

  test('rebuilt lines carry the Portal amounts exactly',()=>{
    expect(lines.map(line=>line.Amount)).toEqual([49477.45,2473.87,3834.5]);
    expect(Math.round(lines.reduce((sum,line)=>sum+line.Amount,0)*100)/100).toBe(55785.82);
  });
  test('a safe edit becomes a full-line sparse update, every line pinned non-taxable',()=>{
    const update=invoiceResyncUpdate(args());
    expect(update).toMatchObject({Id:'18641',SyncToken:'4',sparse:true,TxnTaxDetail:{TotalTax:0}});
    expect(update.Line).toHaveLength(3);
    expect(update.Line.every(line=>line.SalesItemLineDetail.TaxCodeRef.value==='NON')).toBe(true);
  });
  test('never moves an invoice to another customer',()=>{
    expect(()=>invoiceResyncUpdate(args({qboCustomerId:'999'}))).toThrow('resync_customer_changed');
    expect(()=>invoiceResyncUpdate(args({qboCustomerId:null}))).toThrow('resync_customer_changed');
  });
  test('never rewrites a hand-built or legacy invoice',()=>{
    const legacy={...qbo,Line:[...qbo.Line,{DetailType:'SalesItemLineDetail',Amount:10,SalesItemLineDetail:{ItemRef:{value:'42'}}}]};
    expect(()=>invoiceResyncUpdate(args({qboInvoice:legacy}))).toThrow('resync_foreign_lines');
    const described={...qbo,Line:[...qbo.Line,{DetailType:'DescriptionOnly',Description:'note'}]};
    expect(()=>invoiceResyncUpdate(args({qboInvoice:described}))).toThrow('resync_foreign_lines');
  });
  test('the sync\'s own discount line is recognised; any other discount account is not',()=>{
    const ours={...qbo,Line:[...qbo.Line,{DetailType:'DiscountLineDetail',Amount:5,DiscountLineDetail:{DiscountAccountRef:{value:'77'}}}]};
    expect(()=>invoiceResyncUpdate(args({qboInvoice:ours}))).not.toThrow();
    const theirs={...qbo,Line:[...qbo.Line,{DetailType:'DiscountLineDetail',Amount:5,DiscountLineDetail:{DiscountAccountRef:{value:'88'}}}]};
    expect(()=>invoiceResyncUpdate(args({qboInvoice:theirs}))).toThrow('resync_foreign_lines');
  });
  test('never edits a closed accounting period',()=>{
    expect(()=>invoiceResyncUpdate(args({bookCloseDate:'2026-09-30'}))).toThrow('resync_closed_period');
    expect(()=>invoiceResyncUpdate(args({bookCloseDate:'2026-09-17'}))).toThrow('resync_closed_period');
    expect(()=>invoiceResyncUpdate(args({bookCloseDate:null}))).not.toThrow();
  });
  test('never drops a total below money QBO already applied',()=>{
    // $55,785.82 applied; lowering the invoice under that would make an overpayment.
    const lower={...invoice,total:55000};
    expect(()=>invoiceResyncUpdate(args({invoice:lower}))).toThrow('resync_below_applied');
  });
  test('leaves invoices QBO computes tax on to a person',()=>{
    expect(()=>invoiceResyncUpdate(args({qboInvoice:{...qbo,TxnTaxDetail:{TotalTax:12}}}))).toThrow('resync_taxed_invoice');
  });
  test('refusals carry the amounts',()=>{
    try{invoiceResyncUpdate(args({invoice:{...invoice,total:55000}}));}catch(error){
      expect(error.details).toEqual({portal_total:55000,qbo_total:56534.77,qbo_applied:55785.82});
    }
  });
});

describe('new invoices settle before their first QBO write',()=>{
  const now=Date.parse('2026-09-17T20:00:00Z');
  test('held while touched within the last 2 hours',()=>{
    // INV-64006 was re-created at 18:11 — at 20:00 it has not settled yet.
    expect(invoiceStillSettling({created_at:'2026-09-17T18:11:03Z',updated_at:'2026-09-17T18:11:03Z'},now)).toBe(true);
  });
  test('released once untouched for 2 hours',()=>{
    expect(invoiceStillSettling({created_at:'2026-09-17T17:00:00Z',updated_at:'2026-09-17T17:59:00Z'},now)).toBe(false);
  });
  test('a recent edit restarts the wait',()=>{
    expect(invoiceStillSettling({created_at:'2026-09-17T10:00:00Z',updated_at:'2026-09-17T19:30:00Z'},now)).toBe(true);
  });
  test('never held more than 24 hours after creation, however often it is touched',()=>{
    expect(invoiceStillSettling({created_at:'2026-09-16T19:00:00Z',updated_at:'2026-09-17T19:59:00Z'},now)).toBe(false);
  });
  test('missing timestamps never hold an invoice back',()=>{
    expect(invoiceStillSettling({},now)).toBe(false);
  });
});

describe('change sync and settle are wired into the run',()=>{
  const edge=read('supabase/functions/qbo-sales-background/index.ts');
  test('resync is queued only when writes are enabled and allowed, after the card-fee case',()=>{
    expect(edge).toMatch(/add_card_fee_line','queued_write'[\s\S]*if\(claim\.writes_enabled&&writeAllowed\(settings,'invoice',sourceId\)\)\{\s*resyncCandidates\.push/);
  });
  test('built from a fresh read under the invoice claim, with the books closing date',()=>{
    expect(edge).toMatch(/for\(const candidate of resyncCandidates\)[\s\S]*acquire_qbo_invoice_sync_claim[\s\S]*const fresh=\(await qbo\.request[\s\S]*invoiceResyncUpdate\(\{[^}]*bookCloseDate:preferences\?\.AccountingInfoPrefs\?\.BookCloseDate\}/);
  });
  test('payments are released only after a full read-back',()=>{
    expect(edge).toContain("code:'resync_readback_mismatch'");
    expect(edge).toMatch(/resync_readback_mismatch[\s\S]*invoiceTotalDrifted\.delete\(String\(candidate\.invoice\.id\)\);counters\.invoices\.resynced\+\+/);
  });
  test('create and resync share one description builder',()=>{
    expect(edge).toContain('const description=invoiceLineDescription(candidate.invoice,so);');
    expect(edge).toContain('description:invoiceLineDescription(candidate.invoice,snapshot.sales_orders?.[candidate.invoice.so_id])');
  });
  test('settling invoices are held silently, not raised as reviews',()=>{
    expect(edge).toContain("if(invoiceStillSettling(invoice)){counters.invoices.held_settling++;add('invoice',sourceId,'classify','held_settling',null,");
  });
});

describe('Portal QuickBooks number is restored from the verified link',()=>{
  const edge=read('supabase/functions/qbo-sales-background/index.ts');
  test('only fills a blank, only when writes are enabled, and never blocks the run',()=>{
    expect(edge).toContain("if(!clean(invoice.qb_invoice_id)&&claim.writes_enabled){");
    expect(edge).toContain(".update({qb_invoice_id:mappedId}).eq('id',invoice.id).is('qb_invoice_id',null)");
    expect(edge).toMatch(/restamp_portal_link[\s\S]{0,80}\}catch\{/);
  });
});
