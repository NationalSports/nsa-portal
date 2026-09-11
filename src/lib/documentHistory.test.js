import { createHistoryStore } from './documentHistory';

const owner = 'history-test-owner';
const makeJournal = rows => ({
  rows,
  stage: jest.fn(async (who, table, payload) => {
    const row = { owner: who, table, payload, revision: payload.id, sequence: rows.length + 1 };
    rows.push(row);
    return row;
  }),
  acknowledge: jest.fn(async row => { const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1); }),
  list: jest.fn(async who => rows.filter(row => row.owner === who)),
});

beforeEach(() => localStorage.setItem('nsa_user', JSON.stringify({ id: owner })));
afterEach(() => localStorage.clear());

test('stages before sending and acknowledges a successful append', async () => {
  const rows = [];
  const journal = makeJournal(rows);
  const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
  const store = createHistoryStore({ client, journal });

  const entry = await store.append('so_history', 'SO-1', { status: 'open' });

  expect(journal.stage.mock.calls[0][2].id).toEqual(expect.any(String));
  expect(journal.stage.mock.invocationCallOrder[0]).toBeLessThan(client.rpc.mock.invocationCallOrder[0]);
  expect(journal.acknowledge).toHaveBeenCalledTimes(1);
  expect(rows).toHaveLength(0);
  expect(client.rpc.mock.calls[0][0]).toBe('append_document_history');
  expect(client.rpc.mock.calls[0][1].p_entry).toEqual(entry);
});

test('reports pending synchronously while an append is in flight', async () => {
  const rows = [];
  const journal = makeJournal(rows);
  let release;
  const client = { rpc: jest.fn(() => new Promise(resolve => { release = resolve; })) };
  const store = createHistoryStore({ client, journal });
  const call = store.append('so_history', 'SO-pending', { status: 'draft' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(store.hasPending()).toBe(true);
  release({ data: null, error: null });
  await call;
  expect(store.hasPending()).toBe(false);
});

test('keeps a failed append queued and flush retries it', async () => {
  const rows = [];
  const journal = makeJournal(rows);
  let attempts = 0;
  const client = { rpc: jest.fn(async name => {
    if (name === 'append_document_history' && attempts++ === 0) return { error: new Error('offline') };
    return { data: null, error: null };
  }) };
  const store = createHistoryStore({ client, journal });
  await expect(store.append('est_history', 'E-1', { total: 10 })).rejects.toThrow('offline');
  expect(rows).toHaveLength(1);
  await store.flush();
  expect(rows).toHaveLength(0);
  expect(client.rpc).toHaveBeenCalledTimes(2);
});

test('loads every page with descending sequence keyset pagination', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ seq: 200 - i, kind: 'so_history', document_id: 'SO-1', entry: { n: i } })),
    [{ seq: 100, kind: 'so_history', document_id: 'SO-1', entry: { n: 100 } }],
  ];
  const queries = [];
  const client = {
    from: jest.fn(() => {
      const pageIndex = queries.length;
      const query = { select: jest.fn(() => query), order: jest.fn(() => query), limit: jest.fn(() => query), lt: jest.fn(() => query), then: resolve => resolve({ data: pages[pageIndex], error: null }) };
      queries.push(query);
      return query;
    }),
  };
  const store = createHistoryStore({ client, journal: makeJournal([]) });
  const loaded = await store.loadAll();
  expect(loaded.so_history['SO-1']).toHaveLength(101);
  expect(queries[1].lt).toHaveBeenCalledWith('seq', 101);
});

test('flushes only the current owner queue in sequence order', async () => {
  const rows = [
    { owner, table: 'history_other', payload: { id: 'x' }, sequence: 0 },
    { owner, table: 'document_history_snapshot', payload: { id: 'late', kind: 'so_history', document_id: '2', entry: { id: 'late' } }, sequence: 2 },
    { owner, table: 'document_history_snapshot', payload: { id: 'early', kind: 'so_history', document_id: '1', entry: { id: 'early' } }, sequence: 1 },
    { owner: 'other', table: 'document_history_snapshot', payload: { id: 'foreign', kind: 'so_history', document_id: '3', entry: { id: 'foreign' } }, sequence: 0 },
  ];
  const journal = makeJournal(rows);
  const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
  await createHistoryStore({ client, journal }).flush();
  expect(client.rpc.mock.calls.map(call => call[1].p_document_id)).toEqual(['1', '2']);
  expect(rows.map(row => row.payload.id)).toEqual(['x', 'foreign']);
});

test('does not send when owner changes after durable staging', async () => {
  let release;
  const rows = [];
  const journal = makeJournal(rows);
  journal.stage.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
  const store = createHistoryStore({ client, journal });
  const call = store.append('so_history', 'SO-owner', { value: 1 });
  await Promise.resolve(); await Promise.resolve();
  localStorage.setItem('nsa_user', JSON.stringify({ id: 'other-owner' }));
  release({ owner, table: 'document_history_snapshot', payload: { id: 'snap', kind: 'so_history', document_id: 'SO-owner', entry: { value: 1 } } });
  await expect(call).rejects.toThrow('owner changed');
  expect(client.rpc).not.toHaveBeenCalled();
});

test('validates the full import before making any writes', async () => {
  const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
  const store = createHistoryStore({ client, journal: makeJournal([]) });
  await expect(store.importAll({ so_history: { one: [{ snapshot: {id:'one'} }], two: [{ bad: true }] }, est_history: {} })).rejects.toThrow('Invalid');
  expect(client.rpc).not.toHaveBeenCalled();
});

test('flush stops after the first failed request and retains later rows', async () => {
  const rows = [
    { owner, table: 'document_history_snapshot', payload: { id: 'a', kind: 'so_history', document_id: 'a', entry: {} }, sequence: 1 },
    { owner, table: 'document_history_snapshot', payload: { id: 'b', kind: 'so_history', document_id: 'b', entry: {} }, sequence: 2 },
  ];
  const journal = makeJournal(rows);
  const client = { rpc: jest.fn(async () => ({ error: new Error('offline') })) };
  await expect(createHistoryStore({ client, journal }).flush()).rejects.toThrow('offline');
  expect(client.rpc).toHaveBeenCalledTimes(1);
  expect(rows).toHaveLength(2);
});

test('hasPending stays true while journal staging is blocked', async () => {
  let release;
  const journal = makeJournal([]);
  journal.stage.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const store = createHistoryStore({ client: { rpc: jest.fn(async () => ({ error: new Error('offline') })) }, journal });
  const call = store.append('est_history', 'E-blocked', { x: 1 });
  expect(store.hasPending()).toBe(true);
  await Promise.resolve(); await Promise.resolve();
  release({ owner, table: 'document_history_snapshot', payload: { id: 'x', kind: 'est_history', document_id: 'E-blocked', entry: { x: 1 } } });
  await expect(call).rejects.toThrow();
});

test('imports real legacy backup entries unchanged, oldest first',async()=>{
  const client={rpc:jest.fn(async()=>({data:null,error:null}))};
  const store=createHistoryStore({client,journal:makeJournal([])});
  const oldest={ts:'old',user:'Rep',snapshot:{id:'SO-1',items:[{}]}};
  const newest={ts:'new',user:'Rep',snapshot:{id:'SO-1',items:[{},{}]}};
  await store.importAll({so_history:{'SO-1':[newest,oldest]}});
  expect(client.rpc.mock.calls.map(c=>c[1].p_entry)).toEqual([oldest,newest]);
});

test('a late retry does not become the newest rollback snapshot',async()=>{
  const rows=[
    {seq:9,kind:'so_history',document_id:'SO-1',captured_at:'2026-09-10T10:00:00Z',entry:{ts:'older delayed'}},
    {seq:8,kind:'so_history',document_id:'SO-1',captured_at:'2026-09-10T11:00:00Z',entry:{ts:'newest'}},
  ];
  const query={select:()=>query,order:()=>query,limit:()=>query,then:resolve=>resolve({data:rows,error:null})};
  const store=createHistoryStore({client:{from:()=>query},journal:makeJournal([])});
  expect((await store.loadAll()).so_history['SO-1'].map(e=>e.ts)).toEqual(['newest','older delayed']);
});

test('append deadline aborts the actual request and retains the queued snapshot',async()=>{
  jest.useFakeTimers();
  try{
    const rows=[];let signal;
    const call={abortSignal:s=>{signal=s;return call;},then:(resolve)=>new Promise(done=>signal.addEventListener('abort',()=>{resolve({error:new Error('aborted')});done();}))};
    const store=createHistoryStore({client:{rpc:()=>call},journal:makeJournal(rows)});
    const outcome=store.append('so_history','SO-1',{snapshot:{id:'SO-1'}}).catch(e=>e);
    for(let i=0;i<5;i++)await Promise.resolve();
    jest.advanceTimersByTime(12000);
    expect((await outcome).message).toContain('12 seconds');
    expect(signal.aborted).toBe(true);expect(rows).toHaveLength(1);expect(store.hasPending()).toBe(true);
  }finally{jest.useRealTimers();}
});

test('summary reads past the first page instead of silently omitting documents',async()=>{
  let offset=0;
  const q={abortSignal:()=>q,order:()=>q,range:start=>{offset=start;return q;},then:resolve=>resolve({data:Array.from({length:offset===0?100:20},(_,i)=>({document_id:'SO-'+(offset+i)})),error:null})};
  const store=createHistoryStore({client:{rpc:()=>q},journal:makeJournal([])});
  expect(await store.summary()).toHaveLength(120);
});
