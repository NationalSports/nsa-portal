import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ARWorkspace from '../ARWorkspace';
import { AppDataProvider } from '../AppContext';

jest.mock('../lib/supabase', () => ({ supabase: null }));

const reps = [
  { id: 'R1', name: 'Rep One', role: 'rep', email: 'rep1@nationalsportsapparel.com', is_active: true },
  { id: 'R2', name: 'Rep Two', role: 'rep', email: 'rep2@nationalsportsapparel.com', is_active: true },
  { id: 'A1', name: 'Andrea Accounting', role: 'accounting', email: 'andrea@nationalsportsapparel.com', is_active: true },
];
const customers = [
  { id: 'C1', name: 'Alpha Athletics', primary_rep_id: 'R1', payment_terms: 'net30', contacts: [{ name: 'Alex', role: 'Billing', email: 'billing@alpha.test' }] },
  { id: 'C2', name: 'Beta Athletics', primary_rep_id: 'R2', payment_terms: 'net30', contacts: [{ name: 'Bea', role: 'Billing', email: 'billing@beta.test' }] },
];
const invoices = [
  { id: 'I1', customer_id: 'C1', date: '2026-06-01', due_date: '2026-07-01', total: 1200, paid: 200, status: 'partial' },
  { id: 'I2', customer_id: 'C2', date: '2026-07-01', due_date: '2026-08-01', total: 2500, paid: 0, status: 'open' },
];

function renderWorkspace(user, props={}, overrides={}) {
  const setMsgs=jest.fn(),setAssignedTodos=jest.fn(),setESO=jest.fn(),setESOC=jest.fn(),setPg=jest.fn();
  const value={
    sos:[],invs:invoices,histInvs:[],cust:customers,REPS:reps,cu:user,
    msgs:[],setMsgs,assignedTodos:[],setAssignedTodos,nf:jest.fn(),companyInfo:{name:'NSA'},
    setSelC:jest.fn(),setPg,setInvF:jest.fn(),setESO,setESOC,
    ...overrides,
  };
  render(<AppDataProvider value={value}><ARWorkspace mode="report" {...props}/></AppDataProvider>);
  return {setMsgs,setAssignedTodos,setESO,setESOC,setPg};
}

afterEach(()=>window.localStorage.clear());

describe('ARWorkspace',()=>{
  test('a rep is locked to their own accounts even if another rep scope is requested',()=>{
    renderWorkspace(reps[0],{scopeRepId:'R2'});
    expect(screen.getByText('My Receivables')).toBeTruthy();
    expect(screen.getByText('Alpha Athletics')).toBeTruthy();
    expect(screen.queryByText('Beta Athletics')).toBeNull();
    expect(screen.getAllByText('$1,000').length).toBeGreaterThan(0);
  });

  test('shows a complete past-due aging ladder that reconciles to the total',()=>{
    renderWorkspace(reps[2],{scopeRepId:'all'});
    const aging=screen.getByTestId('past-due-aging');
    expect(within(aging).getByText('1–30 days')).toBeTruthy();
    expect(within(aging).getByText('31–60 days')).toBeTruthy();
    expect(within(aging).getByText('61–90 days')).toBeTruthy();
    expect(within(aging).getByText('90+ days')).toBeTruthy();
    expect(within(aging).getByText('$2,500')).toBeTruthy();
    expect(within(aging).getByText('$1,000')).toBeTruthy();
    expect(within(aging).getByText('$3,500 total')).toBeTruthy();
  });

  test('accounting sees the full portfolio and can open an account conversation',()=>{
    const api=renderWorkspace(reps[2],{scopeRepId:'all'});
    expect(screen.getByText('Alpha Athletics')).toBeTruthy();
    expect(screen.getByText('Beta Athletics')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Open workspace')[1]);
    expect(screen.getByText('Internal AR conversation')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Message Rep One/),{target:{value:'Can you confirm the billing contact?'}});
    fireEvent.click(screen.getByText('Post message'));
    expect(api.setMsgs).toHaveBeenCalled();
    const updater=api.setMsgs.mock.calls[api.setMsgs.mock.calls.length-1][0];
    const rows=updater([]);
    expect(rows[0]).toMatchObject({entity_type:'customer',entity_id:'C1',dept:'accounting',tagged_members:['R1']});
  });

  test('does not auto-open an unlinked account or leak unrelated null-customer tasks',()=>{
    renderWorkspace(reps[2],{}, {
      invs:[],
      histInvs:[{id:'H-UNLINKED',customer_id:null,date:'2026-01-01',total:900,open_balance:900,status:'open',raw_customer_name:'Unlinked Historical Account'}],
      assignedTodos:[{id:'T-NULL',customer_id:null,title:'Unrelated system task',status:'open'}],
    });
    expect(screen.getByText('Unlinked Historical Account')).toBeTruthy();
    expect(screen.queryByText('Internal AR conversation')).toBeNull();
    expect(screen.queryByText('Unrelated system task')).toBeNull();
    expect(screen.getByText('Link customer first')).toBeTruthy();
  });

  test('includes status-only NetSuite invoices at full value and clearly discloses the assumption',()=>{
    renderWorkspace(reps[2],{}, {
      invs:[],
      histInvs:[{id:'H-LEGACY',customer_id:'C1',date:'2022-01-01',total:24500,status:'open',raw_customer_name:'Alpha Athletics'}],
    });
    expect(screen.getByText('NetSuite full-balance assumption is active.')).toBeTruthy();
    expect(screen.getByText(/full \$24,500 original face value is included/)).toBeTruthy();
    expect(screen.getAllByText('Open AR')[0].parentElement.textContent).toContain('$24,500');
    const accountRow=screen.getByText('Alpha Athletics').closest('tr');
    expect(accountRow.textContent).toContain('$24,500');
  });

  test('uses exact cents in customer-facing collection email and shows payment-speed sections',()=>{
    renderWorkspace(reps[2],{}, {
      invs:[{id:'I-CENTS',customer_id:'C1',date:'2026-07-01',due_date:'2026-08-01',total:1234.49,paid:0,status:'open'}],
    });
    const row=screen.getByText('Alpha Athletics').closest('tr');
    fireEvent.click(within(row).getByText('Open workspace'));
    fireEvent.click(screen.getByText('Email account'));
    expect(screen.getByDisplayValue(/\$1,234\.49 open balance/)).toBeTruthy();
    expect(screen.getByText('Average days to pay by rep')).toBeTruthy();
    expect(screen.getByText('Slowest-paying accounts')).toBeTruthy();
  });

  test('shows the exact completed order list, links the order, and seeds one rep TODO',()=>{
    const api=renderWorkspace(reps[2],{}, {
      sos:[{id:'SO-READY',customer_id:'C1',created_by:'R1',created_at:'2026-07-01',status:'complete',memo:'Championship uniforms',items:[{sizes:{M:10},unit_sell:100,nsa_cost:50,no_deco:true,decos:[]}]}],
      invs:[{id:'I-PART',so_id:'SO-READY',customer_id:'C1',date:'2026-08-01',due_date:'2026-08-15',total:250,tax:0,paid:0,status:'open'}],
    });
    expect(screen.getByText('Completed, uninvoiced orders')).toBeTruthy();
    const row=screen.getAllByText('SO-READY')[0].closest('tr');
    expect(row.textContent).toContain('Alpha Athletics');
    expect(row.textContent).toContain('$1,000');
    expect(row.textContent).toContain('$250');
    expect(row.textContent).toContain('$750');
    fireEvent.click(within(row).getByText('Open order'));
    expect(api.setESO).toHaveBeenCalledWith(expect.objectContaining({id:'SO-READY'}));
    expect(api.setPg).toHaveBeenCalledWith('orders');
    const todoUpdater=api.setAssignedTodos.mock.calls.find(call=>typeof call[0]==='function')[0];
    const todos=todoUpdater([]);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({id:'todo-completed-uninvoiced-SO-READY',source:'completed_uninvoiced:SO-READY',assigned_to:'R1',so_id:'SO-READY',customer_id:'C1',priority:1,status:'open'});
    expect(todoUpdater(todos)).toBe(todos);
  });
});
