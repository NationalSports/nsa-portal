import fs from 'fs';
import path from 'path';
import {
  allocateUnreflectedPayments, classifyInvoiceDuplicate, classifySourceInvoice,
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
  test('cc_fee is never reported, because the sync snapshot does not carry it',()=>{
    // The invoices projection in qbo_sales_source_snapshot_without_links has no
    // cc_fee column, so reading it always yielded 0 -- claiming "no card fee" on
    // the very invoices a card fee drifted.  An absent field beats a wrong one.
    expect(linkedInvoiceTotalDrift({...invoice,cc_fee:13.22},{TotalAmt:456}))
      .not.toHaveProperty('cc_fee');
    expect(read('supabase/functions/qbo-sales-background/logic.js')).not.toContain('cc_fee');
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
    expect(edge).toContain("review('invoice',sourceId,'mapped_invoice_total_changed',{qbo_id:mappedId,...drift})");
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
