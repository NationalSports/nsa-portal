/**
 * Upload resilience (src/utils.js cloudUpload/fileUpload).
 *
 * Cloudinary answers a saturated processing queue with HTTP 420 "Slow Down, Out of Processing
 * Capacity" — a rep dropping a logo .ai into the Art Library saw that surfaced as a dead upload,
 * because the helpers had no retry at all. These cover the retry, and pin the resource-type
 * routing that the retry must not disturb.
 */
import { cloudUpload, fileUpload } from '../utils';

const throttled = () => ({ ok: false, status: 420, json: async () => ({ error: { message: 'Slow Down, Out of Processing Capacity' } }) });
const ok = (url) => ({ ok: true, status: 200, json: async () => ({ secure_url: url }) });
const rejected = (msg) => ({ ok: false, status: 400, json: async () => ({ error: { message: msg } }) });
const urls = () => global.fetch.mock.calls.map(c => c[0]);

beforeEach(() => {
  // Run the backoff sleeps immediately; leave the 5-minute abort timer alone so it never fires.
  jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => { if (ms < 60000) Promise.resolve().then(fn); return 0; });
  global.fetch = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); document.getElementById('nsa-upload-tray')?.remove(); });

test('retries a transient "Out of Processing Capacity" throttle and resolves', async () => {
  global.fetch.mockResolvedValueOnce(throttled())
    .mockResolvedValueOnce(throttled())
    .mockResolvedValueOnce(ok('https://res.cloudinary.com/x/raw/upload/v1/logo.ai'));
  await expect(fileUpload(new File(['x'], 'logo.ai'), 'nsa-production'))
    .resolves.toBe('https://res.cloudinary.com/x/raw/upload/v1/logo.ai');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('gives up after the retry budget rather than looping forever', async () => {
  global.fetch.mockResolvedValue(throttled());
  await expect(fileUpload(new File(['x'], 'logo.ai'), 'nsa-production'))
    .rejects.toThrow(/Out of Processing Capacity/);
  expect(global.fetch).toHaveBeenCalledTimes(5); // first attempt + UP_RETRIES
});

// Regression guard. A .ai/.eps must keep going to /auto/, which Cloudinary files as an IMAGE
// asset (all 1352 .ai files in so_art_files sit under /image/upload/). Webstores' vectorPreviewUrl
// and QuickMockBuilder's vecThumb rasterize those to a placeable PNG preview, and a raw-uploaded
// asset is not addressable at /image/upload/ — so sending them to /raw/ silently breaks previews.
test('a design source stays on /auto/ so its vector preview still resolves', async () => {
  global.fetch.mockResolvedValue(ok('https://res.cloudinary.com/x/image/upload/v1/logo.ai'));
  await fileUpload(new File(['x'], 'logo.ai'), 'nsa-production');
  expect(urls()[0]).toContain('/auto/upload');
  expect(urls()[0]).not.toContain('/raw/upload');
});

test('an ordinary image still goes to /image/ and a real rejection is not retried', async () => {
  global.fetch.mockResolvedValue(rejected('File size too large'));
  await expect(cloudUpload(new File(['x'], 'shot.png', { type: 'image/png' })))
    .rejects.toThrow('File size too large');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(urls()[0]).toContain('/image/upload');
});
