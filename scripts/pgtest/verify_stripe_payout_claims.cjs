// Isolated claim-gate proof for migration 20261009060239. This uses only
// PGlite and minimal schema shapes; it never calls QBO, Stripe, or Supabase.
// Run: NODE_PATH=/private/tmp/nsa-inventory-pgtest/node_modules node scripts/pgtest/verify_stripe_payout_claims.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20261009060239_stripe_payout_deposit_automation.sql'), 'utf8');
const runId = '10000000-0000-0000-0000-000000000001';
const lease = '20000000-0000-0000-0000-000000000001';
const payoutId = n => `po_Test${n}`;
const payload = (date='2026-10-01', bank='BANK-1') => ({
  DepositToAccountRef: { value: bank },
  TxnDate: date,
  Line: [],
});

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
      create table qbo_sales_settings(
        company_key text primary key, realm_id text not null, expected_company_name text not null,
        background_enabled boolean not null default true, kill_switch boolean not null default false,
        writes_enabled boolean not null default false,
        phase text not null default 'read_only',
        check(phase in ('read_only','customer_canary','invoice_canary','payment_canary','bounded','hourly'))
      );
      create table qbo_sales_runs(
        id uuid primary key, company_key text not null references qbo_sales_settings(company_key),
        realm_id text not null, mode text not null check(mode in ('read_only','write')),
        status text not null check(status in ('running','completed','needs_review','blocked','failed','skipped','abandoned')),
        lease_token uuid, lease_expires_at timestamptz,
        check((status='running')=(lease_token is not null and lease_expires_at is not null))
      );
      create table stripe_payouts(
        stripe_payout_id text primary key, amount_cents bigint not null,
        currency text not null, status text not null, automatic boolean not null default false,
        arrival_date date, reconciliation_status text not null default 'pending',
        qbo_deposit_id text,
        check(stripe_payout_id ~ '^po_[A-Za-z0-9_]+$'),
        check(currency ~ '^[a-z]{3}$'),
        check(reconciliation_status in ('pending','exact','mismatch','unavailable','failed'))
      );
      insert into qbo_sales_settings(company_key,realm_id,expected_company_name)
        values('national','900001','Example Corp');
      insert into qbo_sales_runs(id,company_key,realm_id,mode,status,lease_token,lease_expires_at)
        values('${runId}','national','900001','write','running','${lease}',now()+interval '10 minutes');
    `);
    await db.exec(migration);

    const hasPrivilege = async (role, object, privilege, kind='table') =>
      (await db.query(`select has_${kind}_privilege($1,$2,$3) ok`,[role,object,privilege])).rows[0].ok;
    const insertPayout = async (n, overrides={}) => {
      const row = {
        id:payoutId(n), currency:'usd', status:'paid', automatic:true,
        arrival:'2026-10-01', exact:'exact', qbo:null, ...overrides,
      };
      await db.query(`insert into stripe_payouts
        (stripe_payout_id,amount_cents,currency,status,automatic,arrival_date,reconciliation_status,qbo_deposit_id)
        values($1,10000,$2,$3,$4,$5,$6,$7)`,
      [row.id,row.currency,row.status,row.automatic,row.arrival,row.exact,row.qbo]);
      return row.id;
    };
    const tryClaim = async (id, patch={}) => {
      const p = payload(patch.date, patch.bank);
      return (await db.query(`select claim_qbo_stripe_payout($1,$2,$3,$4,$5,$6) claimed`,
        [id,runId,lease,p,'hash-'+id,'request-'+id])).rows[0].claimed;
    };
    const configure = async (patch={}) => {
      const fields = {
        background_enabled:true, kill_switch:false, writes_enabled:true, phase:'bounded',
        stripe_payouts_enabled:true, stripe_payout_writes_enabled:true,
        stripe_payout_bank_account_id:'BANK-1', stripe_payout_fee_account_id:'FEE-1',
        stripe_payout_start_date:'2026-10-01', stripe_payout_canary_id:null,
        ...patch,
      };
      await db.query(`update qbo_sales_settings set background_enabled=$1,kill_switch=$2,writes_enabled=$3,
        phase=$4,stripe_payouts_enabled=$5,stripe_payout_writes_enabled=$6,
        stripe_payout_bank_account_id=$7,stripe_payout_fee_account_id=$8,
        stripe_payout_start_date=$9,stripe_payout_canary_id=$10 where company_key='national'`,
      [fields.background_enabled,fields.kill_switch,fields.writes_enabled,fields.phase,
        fields.stripe_payouts_enabled,fields.stripe_payout_writes_enabled,
        fields.stripe_payout_bank_account_id,fields.stripe_payout_fee_account_id,
        fields.stripe_payout_start_date,fields.stripe_payout_canary_id]);
    };

    assert.equal((await db.query(`select stripe_payouts_enabled,stripe_payout_writes_enabled
      from qbo_sales_settings where company_key='national'`)).rows[0].stripe_payouts_enabled,false);
    const defaultOff=await insertPayout(1);
    assert.equal(await tryClaim(defaultOff),false,'new payout automation defaults off');
    console.log('PASS migration applies and payout write settings default off');

    await configure();
    const gated=await insertPayout(2);
    for(const [label,patch] of [
      ['background disabled',{background_enabled:false}],
      ['kill switch',{kill_switch:true}],
      ['global writes disabled',{writes_enabled:false}],
      ['read-only phase',{phase:'read_only'}],
      ['unsupported phase',{phase:'invoice_canary'}],
      ['payout domain disabled',{stripe_payouts_enabled:false}],
      ['payout writes disabled',{stripe_payout_writes_enabled:false}],
      ['bank account missing',{stripe_payout_bank_account_id:null}],
      ['fee account missing',{stripe_payout_fee_account_id:null}],
      ['start date missing',{stripe_payout_start_date:null}],
    ]){
      await configure(patch);
      assert.equal(await tryClaim(gated),false,`${label} must block claim`);
    }
    await configure();
    await db.query("update qbo_sales_runs set lease_token=$2,lease_expires_at=now()-interval '1 second' where id=$1",[runId,lease]);
    assert.equal(await tryClaim(gated),false,'expired lease must block claim');
    await db.query("update qbo_sales_runs set lease_expires_at=now()+interval '10 minutes' where id=$1",[runId]);
    await db.query("update qbo_sales_runs set lease_token='30000000-0000-0000-0000-000000000001' where id=$1",[runId]);
    assert.equal(await tryClaim(gated),false,'wrong lease token must block claim');
    await db.query('update qbo_sales_runs set lease_token=$2 where id=$1',[runId,lease]);
    await db.query("update qbo_sales_runs set mode='read_only' where id=$1",[runId]);
    assert.equal(await tryClaim(gated),false,'read-only run must block claim');
    await db.query("update qbo_sales_runs set mode='write',status='completed',lease_token=null,lease_expires_at=null where id=$1",[runId]);
    assert.equal(await tryClaim(gated),false,'completed run must block claim');
    await db.query("update qbo_sales_runs set status='running',lease_token=$2,lease_expires_at=now()+interval '10 minutes' where id=$1",[runId,lease]);
    await configure({phase:'hourly'});
    assert.equal(await tryClaim(await insertPayout(20)),true,'hourly phase should be claimable');
    await configure({phase:'bounded'});
    console.log('PASS global/domain switches, bounded/hourly phases, account IDs, date, exact active write lease all gate claims');

    await configure({stripe_payout_canary_id:payoutId(3)});
    const notCanary=await insertPayout(4);
    assert.equal(await tryClaim(notCanary),false,'canary id restricts writes to exact payout');
    const canary=await insertPayout(3);
    assert.equal(await tryClaim(canary),true,'configured eligible canary is claimable');
    assert.equal((await db.query('select state from qbo_stripe_payout_postings where stripe_payout_id=$1',[canary])).rows[0].state,'submitting');
    assert.equal(await tryClaim(canary),false,'submitting payout cannot be claimed twice');
    await db.query("update qbo_stripe_payout_postings set state='unknown' where stripe_payout_id=$1",[canary]);
    assert.equal(await tryClaim(canary),false,'unknown payout is never reclaimed automatically');
    console.log('PASS exact canary claim is once-only; submitting and unknown states are protected');

    await configure({stripe_payout_canary_id:null});
    const held=await insertPayout(5);
    await db.query(`insert into qbo_stripe_payout_postings(stripe_payout_id,realm_id,state,payload,source_hash,request_id)
      values($1,'900001','held','{}','old-hash','old-request')`,[held]);
    assert.equal(await tryClaim(held),true,'preview held payout may be claimed by an active write run');
    assert.equal((await db.query('select state from qbo_stripe_payout_postings where stripe_payout_id=$1',[held])).rows[0].state,'submitting');
    console.log('PASS preview-held posting transitions to submitting on eligible claim');

    const invalid = [
      [6,{status:'pending'}], [7,{automatic:false}], [8,{currency:'cad'}],
      [9,{exact:'pending'}], [10,{qbo:'QBO-ALREADY-POSTED'}],
      [11,{arrival:'2026-09-30'}],
    ];
    for(const [n,overrides] of invalid){
      const id=await insertPayout(n,overrides);
      assert.equal(await tryClaim(id),false,`ineligible payout ${n} must be held`);
      assert.equal((await db.query('select count(*)::int n from qbo_stripe_payout_postings where stripe_payout_id=$1',[id])).rows[0].n,0);
    }
    const bankMismatch=await insertPayout(12);
    assert.equal(await tryClaim(bankMismatch,{bank:'OTHER-BANK'}),false,'deposit bank must match configured account');
    const dateMismatch=await insertPayout(13);
    assert.equal(await tryClaim(dateMismatch,{date:'2026-10-02'}),false,'payload date must match Stripe arrival date');
    assert.equal(await db.query(`select claim_qbo_stripe_payout($1,$2,$3,$4,null,'req-null-hash') claimed`,
      [await insertPayout(14),runId,lease,payload()]).then(x=>x.rows[0].claimed),false,'source hash is required');
    console.log('PASS only exact paid automatic USD payouts with matching date/account and no existing QBO deposit pass');

    const submitting=await insertPayout(15);
    await db.query(`insert into qbo_stripe_payout_postings(stripe_payout_id,realm_id,state)
      values($1,'900001','submitting')`,[submitting]);
    assert.equal(await tryClaim(submitting),false,'existing submitting state is not reclaimed');
    const unknown=await insertPayout(16);
    await db.query(`insert into qbo_stripe_payout_postings(stripe_payout_id,realm_id,state)
      values($1,'900001','unknown')`,[unknown]);
    assert.equal(await tryClaim(unknown),false,'existing unknown state is not reclaimed');
    console.log('PASS pre-existing submitting and unknown ledgers cannot be retried by claim RPC');

    assert.equal(await hasPrivilege('anon','qbo_stripe_payout_postings','select'),false);
    assert.equal(await hasPrivilege('authenticated','qbo_stripe_payout_postings','select'),false);
    assert.equal(await hasPrivilege('service_role','qbo_stripe_payout_postings','insert'),true);
    assert.equal(await hasPrivilege('service_role','qbo_stripe_payout_postings','update'),true);
    assert.equal(await hasPrivilege('service_role','qbo_stripe_payout_postings','delete'),false);
    assert.equal(await hasPrivilege('anon','public.claim_qbo_stripe_payout(text,uuid,uuid,jsonb,text,text)','execute','function'),false);
    assert.equal(await hasPrivilege('authenticated','public.claim_qbo_stripe_payout(text,uuid,uuid,jsonb,text,text)','execute','function'),false);
    assert.equal(await hasPrivilege('service_role','public.claim_qbo_stripe_payout(text,uuid,uuid,jsonb,text,text)','execute','function'),true);
    console.log('PASS posting ledger and claim RPC remain unavailable to browser roles');
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
