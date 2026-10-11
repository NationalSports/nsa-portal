import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AtOnceDashboard from './AtOnceDashboard';
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
test('stage drilldown opens the actual order and period controls remain interactive', () => {
  const onOpenOrder = jest.fn();
  const orders = [{ id: 'SO-PICK', stage: 'needs_pull', created_at: '2026-10-10', value: 100 }, { id: 'SO-PROD', stage: 'in_production', created_at: '2026-10-01', value: 200 }];
  act(() => root.render(<AtOnceDashboard orders={orders} stores={[]} calcStatus={o => o.stage} calcValue={o => o.value} now={new Date(2026, 9, 10)} onOpenOrder={onOpenOrder}/>));
  const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  click([...container.querySelectorAll('.ao-stage')].find(el => el.textContent.includes('Picking')));
  expect(container.querySelectorAll('.ao-order-link')).toHaveLength(1);
  click(container.querySelector('.ao-order-link')); expect(onOpenOrder).toHaveBeenCalledWith(orders[0]);
  click([...container.querySelectorAll('.ao-period button')].find(el => el.textContent === '7 days'));
  expect(container.querySelector('.ao-metric-featured strong').textContent).toBe('$100');
  click(container.querySelector('.ao-legend')); expect(container.querySelector('.ao-legend').getAttribute('aria-pressed')).toBe('false');
});

test.each([['at_once', 'At-Once', '$100'], ['stores', 'Stores', '$200'], ['24_7', '24/7', '$400']])('%s dashboard renders only its own new order value', (dashboard, title, expected) => {
  const stores = [{id:'team',name:'Webstore',org_type:'team'},{id:'club',name:'Club',org_type:'club'},{id:'school',name:'School',org_type:'all_school'}];
  const orders = [null,'team','club','school'].map((webstore_id,i)=>({id:'SO-'+i,webstore_id,created_at:'2026-10-10',value:(i+1)*100,stage:'need_order'}));
  act(() => root.render(<AtOnceDashboard dashboard={dashboard} orders={orders} stores={stores} calcStatus={o=>o.stage} calcValue={o=>o.value} now={new Date(2026,9,10)} onOpenOrder={()=>{}}/>));
  expect(container.querySelector('h1').textContent).toBe(title+', at a glance.');
  expect(container.querySelector('.ao-metric-featured strong').textContent).toBe(expected);
  if(dashboard==='stores'){
    const select=container.querySelector('[aria-label="Store type"]');
    act(()=>{select.value='club';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(container.querySelector('.ao-metric-featured strong').textContent).toBe('$300');
    expect(container.querySelector('[aria-label="Store"]').textContent).not.toContain('School');
  } else expect(container.querySelector('[aria-label="Store type"]')).toBeNull();
});
