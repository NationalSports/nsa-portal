// Lost save reply on flaky wifi: the save committed, the client never heard, and its retry was
// rejected as stale. When the cloud already holds exactly this content it is a success, not a
// "saving needs review" card. Anything else must still go to the card.
jest.mock('@supabase/supabase-js', () => ({createClient: () => ({from: () => ({}), rpc: async () => ({}), auth: {onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}})}})}));
const mockLoad = jest.fn();
jest.mock('../lib/loadRecoveryDocument', () => ({loadRecoveryDocument: (...a) => mockLoad(...a)}));
const {_staleWriteAlreadySaved} = require('../lib/dbEngine');

const doc = () => ({id: 'SO-9', memo: 'Fall', _version: 88, _obBaseVersion: 88, items: [{sku: 'TEE', sizes: {M: 2}}], jobs: [], art_files: []});
const cloud = over => ({row: {...doc(), _version: 91, updated_at: 'later', _recoveryHydrated: true, _itemsHydrated: true, _decosHydrated: true, _artHydrated: true, _jobsHydrated: true, _posHydrated: true, _picksHydrated: true, ...over}});

test('cloud already holds this exact save: success, adopts the server version', async () => {
  mockLoad.mockResolvedValue(cloud());
  const d = doc();
  await expect(_staleWriteAlreadySaved('sales_orders', d)).resolves.toBe(true);
  expect(d._version).toBe(91);
  expect(d._obBaseVersion).toBeUndefined();
});

test('cloud differs (someone else changed it): still a conflict', async () => {
  mockLoad.mockResolvedValue(cloud({memo: 'Changed by another rep'}));
  const d = doc();
  await expect(_staleWriteAlreadySaved('sales_orders', d)).resolves.toBe(false);
  expect(d._version).toBe(88);
});

test('cannot read the cloud copy: still a conflict', async () => {
  mockLoad.mockRejectedValue(new Error('offline'));
  await expect(_staleWriteAlreadySaved('sales_orders', doc())).resolves.toBe(false);
});

describe('own lost write followed by a newer edit', () => {
  const {_resolveStaleWrite, _rememberSaveAttempt} = require('../lib/dbEngine');
  test('cloud equals an earlier attempt from this tab: re-save on the server version', async () => {
    const earlier = {...doc(), id: 'SO-10', memo: 'first edit'};
    _rememberSaveAttempt('sales_orders', earlier);           // reply lost
    const newer = {...doc(), id: 'SO-10', memo: 'second edit'};
    _rememberSaveAttempt('sales_orders', newer);             // rejected as stale
    mockLoad.mockResolvedValue(cloud({id: 'SO-10', memo: 'first edit'}));
    await expect(_resolveStaleWrite('sales_orders', newer)).resolves.toEqual({own: true, version: 91});
  });
  test('cloud equals nothing this tab sent (another person saved): conflict card', async () => {
    const mine = {...doc(), id: 'SO-11', memo: 'mine'};
    _rememberSaveAttempt('sales_orders', mine);
    mockLoad.mockResolvedValue(cloud({id: 'SO-11', memo: 'someone else'}));
    await expect(_resolveStaleWrite('sales_orders', {...mine, memo: 'mine again'})).resolves.toBeNull();
  });
  test('another tab or person cannot borrow this tab\'s history', async () => {
    _rememberSaveAttempt('sales_orders', {...doc(), id: 'SO-12', memo: 'a'});
    mockLoad.mockResolvedValue(cloud({id: 'SO-13', memo: 'a'}));
    await expect(_resolveStaleWrite('sales_orders', {...doc(), id: 'SO-13', memo: 'b'})).resolves.toBeNull();
  });
});
