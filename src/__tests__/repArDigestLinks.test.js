jest.mock('../../netlify/functions/_shared', () => ({getSupabaseAdmin:jest.fn()}));
const {getSupabaseAdmin} = require('../../netlify/functions/_shared');
const {handler} = require('../../netlify/functions/rep-ar-digest');

test('the real Friday renderer sends its truncated full-list link to the rep overdue invoice list', async () => {
  const rep = {id:'R1', name:'Rep One', email:'rep1@nationalsportsapparel.com'};
  const tables = {
    team_members:[rep],
    customers:Array.from({length:61}, (_,i) => ({id:'C'+i, name:'Account '+i, primary_rep_id:'R1'})),
    invoices:Array.from({length:61}, (_,i) => ({id:'I'+i, customer_id:'C'+i, due_date:'2020-01-01', total:100, paid:0, status:'open'})),
    customer_invoices:[],
  };
  getSupabaseAdmin.mockReturnValue({from:table=>{
    const q={select:()=>q, order:()=>q, range:()=>q, is:()=>q, not:()=>q, gt:()=>q, then:resolve=>Promise.resolve({data:tables[table]}).then(resolve)};
    return q;
  }});
  const originalFetch = global.fetch;
  const originalKey = process.env.BREVO_API_KEY;
  const originalTestKey = process.env.OPS_DIGEST_TEST_KEY;
  process.env.BREVO_API_KEY = 'test-only';
  delete process.env.OPS_DIGEST_TEST_KEY;
  global.fetch = jest.fn().mockResolvedValue({ok:true});
  try {
    const result = await handler({queryStringParameters:{test:rep.email}});
    expect(result.statusCode).toBe(200);
    const email = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(email.htmlContent).toContain('See the full list');
    expect(email.htmlContent).toContain('/?pg=invoices&amp;aging=overdue&amp;rep=R1');
    expect(email.htmlContent).not.toContain('/?pg=reports');
  } finally {
    global.fetch = originalFetch;
    if(originalKey===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=originalKey;
    if(originalTestKey===undefined)delete process.env.OPS_DIGEST_TEST_KEY;else process.env.OPS_DIGEST_TEST_KEY=originalTestKey;
  }
});
