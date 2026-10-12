import { AI_INBOX_OWNER_ID, canViewAiInbox, resolveAccessUser, canViewPortalPage, effectivePageAccess } from '../lib/pageAccess';

describe('page-access hydration', () => {
  test('uses the authoritative team permissions as soon as they load', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'invoices'] };
    const resolved = resolveAccessUser(cached, [
      { id: 'acct-1', role: 'accounting', access: ['dashboard', 'orders', 'invoices', 'customers'] },
    ]);
    expect(resolved.access).toContain('orders');
    expect(resolved.access).toContain('customers');
  });

  test('keeps cached permissions while the team load is still pending', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'orders'] };
    expect(resolveAccessUser(cached, [], false)).toBe(cached);
  });

  test('does not substitute another team member permissions', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'invoices'] };
    expect(resolveAccessUser(cached, [{ id: 'rep-1', role: 'rep', access: ['orders'] }])).toBe(null);
  });
});

describe('AI Inbox access', () => {
  test('allows Steve by stable team-member identity', () => {
    expect(canViewAiInbox({ id: AI_INBOX_OWNER_ID, role: 'admin' })).toBe(true);
  });

  test('does not grant access to another admin or through page access', () => {
    expect(canViewAiInbox({
      id: '00000000-0000-0000-0000-000000000010',
      role: 'admin',
      access: ['ai_inbox'],
    })).toBe(false);
  });
});

describe('one section policy for menus, routes and mobile',()=>{
 test('hidden admin sections cannot be reached by an ordinary staff deep link',()=>{
  for(const role of ['rep','csr','warehouse','artist','production','accounting'])for(const page of ['settings','team','backup'])
   expect(canViewPortalPage({id:'staff',role,access:[page]},page)).toBe(false);
 });
 test('explicit grants are honored, including empty and restricted admin assignments',()=>{
  expect(effectivePageAccess({role:'rep',access:[]})).toEqual([]);
  expect(canViewPortalPage({role:'rep',access:['orders']},'import')).toBe(false);
  expect(canViewPortalPage({role:'admin',access:['orders']},'settings')).toBe(false);
  expect(canViewPortalPage({id:'admin',role:'admin',access:null},'settings')).toBe(true);
 });
 test('webstores and mobile detail sections require the assigned page',()=>{
  const artist={id:'artist',role:'artist',access:['art','messages']};
  for(const page of ['orders','estimates','invoices','customers','webstores','marketing','uniforms'])expect(canViewPortalPage(artist,page)).toBe(false);
  expect(canViewPortalPage({...artist,access:['webstores']},'webstores')).toBe(true);
 });
 test('inactive profiles and unknown routes fail closed',()=>{
  expect(resolveAccessUser({id:'a',role:'admin'},[{id:'a',role:'admin',is_active:false}])).toBe(null);
  expect(canViewPortalPage({role:'admin',is_active:false},'settings')).toBe(false);
  expect(canViewPortalPage({role:'admin'},'new_unmapped_page')).toBe(false);
 });
 test('identity gates cannot be overridden by role or checkboxes',()=>{
  const user={id:'other',role:'admin',access:['financials','receive_payments','ai_inbox','methodic']};
  for(const p of user.access)expect(canViewPortalPage(user,p)).toBe(false);
 });
});


describe('admin commissions identity',()=>{
 const steve={id:'00000000-0000-0000-0000-000000000001',role:'admin',access:['commissions']};
 test('only Steve receives the admin entitlement, including when another admin checks every section',()=>{expect(canViewPortalPage(steve,'commission_admin')).toBe(true);expect(canViewPortalPage({...steve,id:'other',access:['commissions','financials','commission_admin']},'commission_admin')).toBe(false);});
 test('empty grants, inactivity and non-admin role cannot acquire admin commission access',()=>{for(const patch of [{access:[]},{is_active:false},{role:'rep'}])expect(canViewPortalPage({...steve,...patch},'commission_admin')).toBe(false);});
 test('reps keep ordinary Commissions without the admin report entitlement',()=>{const rep={id:'rep',role:'rep',access:['commissions']};expect(canViewPortalPage(rep,'commissions')).toBe(true);expect(canViewPortalPage(rep,'commission_admin')).toBe(false);});
});
