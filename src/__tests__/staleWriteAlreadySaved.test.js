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
