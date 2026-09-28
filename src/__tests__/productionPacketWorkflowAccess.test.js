jest.mock('../../netlify/functions/_shared', () => ({
  verifyUser: jest.fn(),
  getSupabaseAdmin: jest.fn(),
}));
const { verifyUser, getSupabaseAdmin } = require('../../netlify/functions/_shared');
const { _internals: { run } } = require('../../netlify/functions/store-production-packet');
const { productionContent, workflowMessage } = require('../productionPacket/workflow');

function database(seed = {}) {
  const tables = { ...seed };
  const inserted = [];
  const removedFiles = [];
  const db = {
    tables, inserted, removedFiles,
    from(table) {
      const state = { filters: [], mode: 'select', payload: null, start: null, end: null };
      const query = {
        select() { return query; },
        eq(key, value) { state.filters.push(row => row[key] === value); return query; },
        is(key, value) { state.filters.push(row => row[key] == null === (value == null)); return query; },
        in(key, values) { state.filters.push(row => values.includes(row[key])); return query; },
        order() { return query; },
        limit() { return query; },
        range(start, end) { state.start = start; state.end = end; return query; },
        insert(value) { state.mode = 'insert'; state.payload = Array.isArray(value) ? value : [value]; return query; },
        upsert(value) { state.mode = 'upsert'; state.payload = [value]; return query; },
        update(value) { state.mode = 'update'; state.payload = value; return query; },
        delete() { state.mode = 'delete'; return query; },
        async maybeSingle() { const result = await execute(); return { data: result.data[0] || null, error: null }; },
        async single() { const result = await execute(); return { data: result.data[0] || null, error: null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        tables[table] ||= [];
        const rows = tables[table];
        if (state.mode === 'insert' || state.mode === 'upsert') {
          state.payload.forEach(row => { rows.push(row); inserted.push({ table, row }); });
          return { data: state.payload, error: null };
        }
        if (state.mode === 'update') {
          const matches = rows.filter(row => state.filters.every(test => test(row)));
          matches.forEach(row => Object.assign(row, state.payload));
          return { data: matches, error: null };
        }
        if (state.mode === 'delete') {
          const matches = rows.filter(row => state.filters.every(test => test(row)));
          tables[table] = rows.filter(row => !matches.includes(row));
          return { data: matches, error: null };
        }
        let result = rows.filter(row => state.filters.every(test => test(row)));
        if (state.start != null) result = result.slice(state.start, state.end + 1);
        return { data: result, error: null };
      }
      return query;
    },
    storage: { from: () => ({
      upload: async (path, bytes, options) => ({ data: { path, bytes, options }, error: null }),
      getPublicUrl: path => ({ data: { publicUrl: `https://files.example/${path}` } }),
      remove: async paths => { removedFiles.push(...paths); return { data: paths, error: null }; },
    }) },
  };
  return db;
}
const seed = () => ({
  webstores: [{ id: 'store-1', name: 'Falcons' }],
  webstore_orders: [],
  sales_orders: [
    { id: 'SO-1', webstore_id: 'store-1', status: 'active' },
    { id: 'SO-2', webstore_id: 'store-1', status: 'active' },
  ],
  webstore_products: [], production_packet_notes: [], production_packet_message_shares: [],
  so_items: [
    { id: 'item-1', so_id: 'SO-1', item_index: 0, sku: 'TEE', name: 'Shirt', color: 'Navy', sizes: { M: 2 }, no_deco: true },
    { id: 'item-2', so_id: 'SO-2', item_index: 0, sku: 'HAT', name: 'Hat', color: 'Black', sizes: { OS: 1 }, no_deco: true },
  ],
  so_art_files: [], webstore_order_items: [], messages: [], so_jobs: [], products: [], so_item_decorations: [], team_members: [],
});
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });

beforeEach(() => { jest.clearAllMocks(); });

test('workflow acknowledgement and shared conversation leave the production fingerprint unchanged; changed SO data makes it stale', async () => {
  const admin = database(seed());
  verifyUser.mockResolvedValue({ ok: true, admin, teamMemberId: 'staff-1' });
  let response = await run(event({ store_id: 'store-1' }), { store_id: 'store-1', action: 'view' });
  const issuedFingerprint = response.packet.fingerprint;
  const content = productionContent(response.packet);
  const update = workflowMessage({ workflow_status: 'acknowledged', target_so_id: 'SO-1', text: 'Reviewed' }, response.packet);
  expect(update.metadata.fingerprint).toBe(issuedFingerprint);
  expect(productionContent({ ...content, messages: [{ text: update.text, metadata: update.metadata }] })).toEqual(content);
  await run(event({}), { store_id: 'store-1', action: 'workflow', target_so_id: 'SO-1', workflow_status: 'acknowledged', text: 'Reviewed', fingerprint: issuedFingerprint });
  response = await run(event({}), { store_id: 'store-1', action: 'view' });
  expect(response.packet.fingerprint).toBe(issuedFingerprint);
  expect(response.packet.messages).toHaveLength(1);
  admin.tables.so_items[0].sizes.M = 3;
  response = await run(event({}), { store_id: 'store-1', action: 'view' });
  expect(response.packet.fingerprint).not.toBe(issuedFingerprint);
});

test('recipient scope is authoritative and hides private SO notes and unshared conversation', async () => {
  const data = seed();
  data.sales_orders[0].production_notes = 'Staff only';
  data.messages = [
    { id: 'private', so_id: 'SO-1', text: 'Internal discussion', ts: '2026-01-01', attachments: [] },
    { id: 'shared', so_id: 'SO-1', text: 'Shared proof', ts: '2026-01-02', attachments: [{ name: 'photo.jpg', url: 'https://files.example/photo.jpg' }] },
    { id: 'other-so', so_id: 'SO-2', text: 'Other order', ts: '2026-01-03', attachments: [] },
  ];
  data.production_packet_message_shares.push({ message_id: 'shared', store_id: 'store-1', source: 'staff', kind: 'message' });
  data.production_packet_links = [{ id: 'link-1', token_hash: require('crypto').createHash('sha256').update('a'.repeat(64)).digest('hex'), store_id: 'store-1', so_id: 'SO-1', expires_at: '2999-01-01T00:00:00.000Z', label: 'Decorator' }];
  const admin = database(data);
  getSupabaseAdmin.mockReturnValue(admin);
  const response = await run(event({}), { token: 'a'.repeat(64), store_id: 'elsewhere', scope_so_id: 'SO-2', action: 'view' });
  expect(response.scopeSoId).toBe('SO-1');
  expect(response.staff).toBe(false);
  expect(response.packet.salesOrders.map(so => so.id)).toEqual(['SO-1']);
  expect(response.packet.messages.map(message => message.id)).toEqual(['shared']);
  expect(JSON.stringify(response)).not.toContain('Staff only');
  expect(JSON.stringify(response)).not.toContain('Internal discussion');
  expect(JSON.stringify(response)).not.toContain('Other order');
  expect(response.packet.messages[0].attachments).toEqual([{ name: 'photo.jpg', url: 'https://files.example/photo.jpg' }]);
});

test('recipient cannot write staff instructions and cross-SO message targets fail before photo upload', async () => {
  const data = seed();
  data.production_packet_links = [{ id: 'link-1', token_hash: require('crypto').createHash('sha256').update('b'.repeat(64)).digest('hex'), store_id: 'store-1', so_id: 'SO-1', expires_at: '2999-01-01T00:00:00.000Z', label: 'Decorator' }];
  const admin = database(data);
  getSupabaseAdmin.mockReturnValue(admin);
  await expect(run(event({}), { token: 'b'.repeat(64), action: 'note', text: 'change sizes' })).rejects.toMatchObject({ status: 403 });
  await expect(run(event({}), { token: 'b'.repeat(64), action: 'message', target_so_id: 'SO-1', target_id: 'garment:item-2', text: 'Wrong garment', photo: { type: 'image/png', content: 'iVBORw0KGgoAAAANSUhEUg==' } })).rejects.toMatchObject({ status: 400 });
  expect(admin.inserted).toHaveLength(0);
});

function dimensionFixture() {
  const data=seed();
  data.so_items[0].no_deco=false;
  data.so_art_files=[{id:'art-1',so_id:'SO-1',name:'Basketball',art_size:'',art_sizes:{Front:'',Back:'4 in'},status:'approved',deco_type:'screen_print',_version:1}];
  data.so_item_decorations=[{id:'deco-1',so_item_id:'item-1',deco_index:0,kind:'art',art_file_id:'art-1',position:'Front'}];
  data.production_packet_links=[{id:'link-1',token_hash:require('crypto').createHash('sha256').update('c'.repeat(64)).digest('hex'),store_id:'store-1',so_id:'SO-1',expires_at:'2999-01-01T00:00:00.000Z',label:'Decorator'}];
  return data;
}
test('recipient can save dimensions to the linked scoped art folder and live packet updates',async()=>{
 const admin=database(dimensionFixture());getSupabaseAdmin.mockReturnValue(admin);
 const base={token:'c'.repeat(64)};
 const before=await run(event({}),{...base,action:'view'});
 const target=before.packet.decorations[0];expect(target.artId).toBe('art-1');
 await run(event({}),{...base,action:'dimensions',target_id:target.id,dimensions:'8 in wide',fingerprint:before.packet.fingerprint,art_id:'untrusted-other-art'});
 expect(admin.tables.so_art_files[0]).toMatchObject({art_size:'8 in wide',art_sizes:{Front:'8 in wide',Back:'4 in'}});
 const after=await run(event({}),{...base,action:'view'});
 expect(after.packet.decorations[0].dimensions).toBe('8 in wide');
 expect(after.packet.fingerprint).not.toBe(before.packet.fingerprint);
 await expect(run(event({}),{...base,action:'dimensions',target_id:target.id,dimensions:'9 in',fingerprint:before.packet.fingerprint})).rejects.toMatchObject({status:409});
});
test('dimension writes reject unknown targets, historical packets, invalid values and revoked links',async()=>{
 const admin=database(dimensionFixture());getSupabaseAdmin.mockReturnValue(admin);
 const base={token:'c'.repeat(64)};const {packet}=await run(event({}),{...base,action:'view'});
 const request={...base,action:'dimensions',target_id:packet.decorations[0].id,dimensions:'8 in',fingerprint:packet.fingerprint};
 for(const patch of [{target_id:'outside-packet'},{revision_id:'issued'},{dimensions:''},{dimensions:'<script>8</script>'}])await expect(run(event({}),{...request,...patch})).rejects.toMatchObject({status:400});
 admin.tables.production_packet_links[0].revoked_at=new Date().toISOString();
 await expect(run(event({}),request)).rejects.toMatchObject({status:403});
 expect(admin.tables.so_art_files[0].art_size).toBe('');
});
