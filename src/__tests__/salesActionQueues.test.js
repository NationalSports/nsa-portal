/* Focused regressions for the sales action queues in App.js.
 *
 * The dashboard and computed mobile todos are intentionally kept inside the
 * App component. These tests extract the small pure branches from that source
 * so the assertions exercise the rules that the app actually runs, rather
 * than a second test-only implementation.
 */
/* eslint-disable */
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const mobileSource = fs.readFileSync(path.join(__dirname, '..', 'MobilePortal.js'), 'utf8');

const {
  isOrderFullyInvoiced,
} = require('../lib/dashboardNotificationRules');
const {
  isOpenInvoice: opsOpenInvoice,
  invoiceBalance: opsInvoiceBalance,
} = require('../lib/opsRecap');

const sectionBetween = (source, start, end) => {
  const startAt = source.indexOf(start);
  expect(startAt).toBeGreaterThanOrEqual(0);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
};

const appParseDate = (value) => {
  if (!value) return null;
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
};

const deadlineBranch = (source, start, end) => {
  const section = sectionBetween(source, start, end);
  const branchStart = section.indexOf('if(so.expected_date');
  expect(branchStart).toBeGreaterThanOrEqual(0);
  const branchEnd = section.indexOf("if(calcSOStatus(so)==='need_order')", branchStart);
  expect(branchEnd).toBeGreaterThan(branchStart);
  return section.slice(branchStart, branchEnd);
};

const runDeadlineBranch = (branch, so) => {
  const factory = new Function(
    'so', 'parseDate', 'calcSOStatus', 'tag', '_repId',
    `const todos=[];${branch};return todos;`,
  );
  return factory(so, appParseDate, () => 'open', 'Acme', 'rep-1');
};

const desktopDeadlineBranch = () => deadlineBranch(
  appSource,
  '// Build to-do items from jobs and SOs',
  '// Coach-approved estimates',
);

const computedDeadlineBranch = () => deadlineBranch(
  appSource,
  '// ─── COMPUTED TODOS (shared between desktop dashboard and mobile portal) ───',
  'const[companyInfo',
);

describe('deadline action queues', () => {
  test.each([
    ['desktop dashboard', desktopDeadlineBranch],
    ['computed mobile todos', computedDeadlineBranch],
  ])('%s includes an overdue open order', (_surface, getBranch) => {
    const overdue = {
      id: 'SO-OVERDUE',
      expected_date: '2000-01-01',
      status: 'open',
      created_by: 'rep-1',
    };
    const todos = runDeadlineBranch(getBranch(), overdue);
    expect(todos).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'deadline', so: overdue }),
    ]));
  });

  test.each([
    ['desktop dashboard', desktopDeadlineBranch],
    ['computed mobile todos', computedDeadlineBranch],
  ])('%s excludes closed, cancelled, void, archived, deleted, and shipped orders', (_surface, getBranch) => {
    const base = {
      id: 'SO-CLOSED',
      expected_date: '2000-01-01',
      status: 'open',
      created_by: 'rep-1',
    };
    ['complete', 'cancelled', 'canceled', 'void', 'archived', 'deleted'].forEach((status) => {
      expect(runDeadlineBranch(getBranch(), { ...base, status })).toHaveLength(0);
    });
    expect(runDeadlineBranch(getBranch(), { ...base, deleted_at: '2026-01-01' })).toHaveLength(0);
    expect(runDeadlineBranch(getBranch(), { ...base, _shipped: true })).toHaveLength(0);
    expect(runDeadlineBranch(getBranch(), { ...base, _shipping_status: 'shipped' })).toHaveLength(0);
  });
});

const invoiceReminderBranch = (source, scopeStart, scopeEnd) => {
  const section = sectionBetween(source, scopeStart, scopeEnd);
  const branchStart = section.indexOf('invs.filter(i=>');
  expect(branchStart).toBeGreaterThanOrEqual(0);
  const branchEnd = section.indexOf("invs.filter(i=>i.status==='paid')", branchStart);
  expect(branchEnd).toBeGreaterThan(branchStart);
  return section.slice(branchStart, branchEnd);
};

const runInvoiceReminderBranch = (branch, invoices) => {
  const factory = new Function(
    'invs', 'opsOpenInvoice', 'opsInvoiceBalance', 'safeNum', 'cust',
    `const todos=[];${branch};return todos;`,
  );
  return factory(invoices, opsOpenInvoice, opsInvoiceBalance, (value) => Number(value) || 0, [{ id: 'C-1', name: 'Acme' }]);
};

const attachTodosBranch = (source, scopeStart, scopeEnd) => {
  const section = sectionBetween(source, scopeStart, scopeEnd);
  const start = section.indexOf('// Attach repId, dismissKey, and fallback date');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = section.indexOf('// Sort by date (newest first)', start);
  expect(end).toBeGreaterThan(start);
  return section.slice(start, end);
};

const runAttachBranch = (branch, todo, customers) => {
  const factory = new Function('todos', 'cust', `${branch};return todos;`);
  return factory([todo], customers);
};

const invoiceFixture = (extra = {}) => ({
  id: 'INV-1',
  customer_id: 'C-1',
  created_by: 'rep-created',
  status: 'open',
  total: 125,
  paid: 0,
  follow_up_at: '2000-01-01',
  ...extra,
});

describe('invoice follow-up action queues', () => {
  const desktopBranch = () => invoiceReminderBranch(
    appSource,
    '// Build to-do items from jobs and SOs',
    '// Open issues → show on to-do list for top admin (Steve) only',
  );
  const computedBranch = () => invoiceReminderBranch(
    appSource,
    '// ─── COMPUTED TODOS (shared between desktop dashboard and mobile portal) ───',
    'const[companyInfo',
  );

  test.each([
    ['desktop dashboard', desktopBranch],
    ['computed mobile todos', computedBranch],
  ])('%s only creates actionable open invoice reminders', (_surface, getBranch) => {
    const open = invoiceFixture();
    const todos = runInvoiceReminderBranch(getBranch(), [open]);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ type: 'inv_followup', inv: open });

    [
      { status: 'paid' },
      { status: 'void' },
      { status: 'cancelled' },
      { status: 'canceled' },
      { deleted_at: '2026-01-01' },
      { paid: 125 },
    ].forEach((closed) => {
      expect(runInvoiceReminderBranch(getBranch(), [invoiceFixture(closed)])).toHaveLength(0);
    });
  });

  test.each([
    ['desktop dashboard', '// Build to-do items from jobs and SOs', '// Filter to person-specific: reps see their customers'],
    ['computed mobile todos', '// ─── COMPUTED TODOS (shared between desktop dashboard and mobile portal) ───', 'const[companyInfo'],
  ])('%s attaches customer ownership and a stable invoice dismiss key', (_surface, scopeStart, scopeEnd) => {
    const inv = invoiceFixture();
    const todo = { type: 'inv_followup', inv, date: inv.follow_up_at };
    const withPrimary = runAttachBranch(
      attachTodosBranch(appSource, scopeStart, scopeEnd),
      todo,
      [{ id: 'C-1', primary_rep_id: 'rep-primary' }],
    )[0];
    expect(withPrimary.repId).toBe('rep-primary');
    expect(withPrimary.dismissKey).toBe('inv_followup:INV-1');

    const fallback = runAttachBranch(
      attachTodosBranch(appSource, scopeStart, scopeEnd),
      todo,
      [{ id: 'C-1' }],
    )[0];
    expect(fallback.repId).toBe('rep-created');
    expect(fallback.dismissKey).toBe('inv_followup:INV-1');
  });
});

const mdBillingHelpers = () => {
  const start = appSource.indexOf('const _mdBillingInvoices=');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = appSource.indexOf('const mdReadyInv=', start);
  expect(end).toBeGreaterThan(start);
  const factory = new Function(
    'invs', 'histInvs', 'isOrderFullyInvoiced', 'getOrderInvoiceCoverage',
    `${appSource.slice(start, end)};return {_mdBillingInvoices,_mdBillingBySo,_mdFullyInvoiced,_mdInvoiceCoverage};`,
  );
  return (invs, histInvs) => factory(invs, histInvs, isOrderFullyInvoiced, require('../lib/dashboardNotificationRules').getOrderInvoiceCoverage);
};

const runMyDayQueue = (queueName, so, billingHelpers) => {
  const start = appSource.indexOf(`const ${queueName}=`);
  expect(start).toBeGreaterThanOrEqual(0);
  const endMarker = queueName === 'mdReadyInv' ? '// Shipped with units still' : '// Past-due invoices';
  const end = appSource.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  const body = appSource.slice(start, end);
  const factory = new Function(
    'sos', '_mdMine', '_mdRepOf', 'opsReadyToInvoice', 'opsShippedNotInvoiced',
    '_mdFF', '_mdFullyInvoiced', 'parseDate',
    `${body};return ${queueName};`,
  );
  return factory(
    [so], () => true, () => 'rep-1', () => true, () => true, () => ({}),
    billingHelpers._mdFullyInvoiced, appParseDate,
  );
};

describe('My Day invoice queues', () => {
  const order = {
    id: 'SO-100',
    customer_id: 'C-1',
    created_by: 'rep-1',
    status: 'open',
    updated_at: '2026-09-01',
    items: [{ sku: 'TEE', color: 'Blue', sizes: { M: 100 } }],
  };
  const lineInvoice = (qty, extra = {}) => ({
    id: 'INV-100',
    so_id: 'SO-100',
    status: 'open',
    total: 100,
    paid: 0,
    line_items: [{ qty, _sku: 'TEE', _color: 'Blue' }],
    ...extra,
  });

  test('portal invoice wins a duplicate history row and duplicate quantities are not double-counted', () => {
    const portal = lineInvoice(50);
    const history = { ...lineInvoice(50), _hist: true };
    const billing = mdBillingHelpers()([portal], [history]);
    expect(billing._mdBillingInvoices).toHaveLength(1);
    expect(billing._mdBillingInvoices[0]).toBe(portal);
    expect(billing._mdBillingBySo.get('SO-100')).toEqual([portal]);
    expect(billing._mdFullyInvoiced(order)).toBe(false);
  });

  test.each(['mdReadyInv', 'mdShipNoInv'])('%s uses remaining per-line coverage', (queueName) => {
    const partial = mdBillingHelpers()([lineInvoice(10)], []);
    const full = mdBillingHelpers()([lineInvoice(100)], []);
    const voided = mdBillingHelpers()([lineInvoice(100, { status: 'void' })], []);

    expect(partial._mdFullyInvoiced(order)).toBe(false);
    expect(runMyDayQueue(queueName, order, partial)).toEqual([order]);
    expect(full._mdFullyInvoiced(order)).toBe(true);
    expect(runMyDayQueue(queueName, order, full)).toHaveLength(0);
    expect(voided._mdFullyInvoiced(order)).toBe(false);
    expect(runMyDayQueue(queueName, order, voided)).toEqual([order]);
  });
});

test('mobile computed invoice reminders retain the invoice and open its detail view', () => {
  expect(mobileSource).toContain('_inv:t.inv');
  expect(mobileSource).toContain("t._type==='inv_followup'&&t._inv");
  expect(mobileSource).toContain("setDetail({type:'invoice',data:t._inv})");
});

test('clicking through an estimate, invoice, or art reminder does not snooze or rewrite follow_up_at', () => {
  const clicked = sectionBetween(appSource, 'const _todoClickedThrough=', 'const[cu,setCu');
  expect(clicked).not.toContain('snoozeTodo(');
  expect(clicked).not.toContain('follow_up_at');
  const snooze = jest.fn();
  const clickedSetEsts = jest.fn();
  const clickedSetInvs = jest.fn();
  const clickedSetSOs = jest.fn();
  const previousGlobals = {
    snoozeTodo: global.snoozeTodo,
    setEsts: global.setEsts,
    setInvs: global.setInvs,
    setSOs: global.setSOs,
  };
  Object.assign(global, { snoozeTodo: snooze, setEsts: clickedSetEsts, setInvs: clickedSetInvs, setSOs: clickedSetSOs });
  const clickedFn = new Function(
    'snoozeTodo', 'snoozeTodoUntil', '_todoIsFollowUp',
    `${clicked};return _todoClickedThrough;`,
  )(snooze, snooze, () => true);
  [
    { type: 'follow_up', est: { id: 'EST-1', follow_up_at: '2000-01-01' } },
    { type: 'inv_followup', inv: { id: 'INV-1', follow_up_at: '2000-01-01' } },
    { type: 'art', so: { id: 'SO-1' } },
    { type: 'coach_followup', so: { id: 'SO-1' }, jobId: 'JOB-1' },
  ].forEach((todo) => clickedFn(todo));
  Object.entries(previousGlobals).forEach(([name, previous]) => {
    if (previous === undefined) delete global[name];
    else global[name] = previous;
  });
  expect(snooze).not.toHaveBeenCalled();
  expect(clickedSetEsts).not.toHaveBeenCalled();
  expect(clickedSetInvs).not.toHaveBeenCalled();
  expect(clickedSetSOs).not.toHaveBeenCalled();

  const snoozeSource = sectionBetween(appSource, 'const snoozeTodo=', '// Navigation is not completion');
  const setEsts = jest.fn();
  const setInvs = jest.fn();
  const setSOs = jest.fn();
  const snoozeFn = new Function('setEsts', 'setInvs', 'setSOs', 'setSnoozeOpenKey', 'nf', `${snoozeSource};return snoozeTodo;`)(
    setEsts, setInvs, setSOs, jest.fn(), jest.fn(),
  );
  const estimate = { id: 'EST-1', follow_up_at: '2000-01-01' };
  snoozeFn({ type: 'follow_up', est: estimate }, 1);
  const estimateUpdate = setEsts.mock.calls[0][0]([estimate])[0];
  expect(new Date(estimateUpdate.follow_up_at).getTime()).toBeGreaterThan(Date.now());
  const invoice = { id: 'INV-1', follow_up_at: '2000-01-01' };
  snoozeFn({ type: 'inv_followup', inv: invoice }, 1);
  const invoiceUpdate = setInvs.mock.calls[0][0]([invoice])[0];
  expect(new Date(invoiceUpdate.follow_up_at).getTime()).toBeGreaterThan(Date.now());
  // The explicit Snooze action remains wired separately.
  expect(appSource).toContain('const doSnooze=(t,days)=>');
  expect(appSource).toContain('snoozeTodoUntil(t,days)');
});
