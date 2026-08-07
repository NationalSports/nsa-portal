// Message attachments: what gets accepted, what gets refused, and what a message
// row ends up carrying. The filtering matters — a rejected file has to come back
// named in `skipped` so the composer can tell the user instead of silently dropping it.
jest.mock('../utils', () => ({
  fileUpload: jest.fn(async (f) => `https://res.cloudinary.com/x/image/upload/v1/${f.name}`),
  openFile: jest.fn(),
  _isImgUrl: () => true,
  _isPdfUrl: () => false,
  _cloudinaryPdfThumb: () => null,
}));

const { fileUpload } = require('../utils');
const { uploadMsgFiles, msgAttachments, MSG_ATTACH_MAX_MB } = require('../lib/msgAttach');

const file = (name, type, size = 1024) => ({ name, type, size });

// CRA's jest config sets resetMocks:true, so the implementation has to be re-installed
// per test — a bare jest.fn() would return undefined and blow up on .then().
beforeEach(() => {
  fileUpload.mockImplementation(async (f) => `https://res.cloudinary.com/x/image/upload/v1/${f.name}`);
});

describe('uploadMsgFiles', () => {
  test('uploads images and PDFs, returning url/name/type/size', async () => {
    const { uploaded, skipped } = await uploadMsgFiles([file('proof.png', 'image/png', 2048), file('spec.pdf', 'application/pdf', 4096)]);
    expect(skipped).toEqual([]);
    expect(uploaded).toHaveLength(2);
    expect(uploaded[0]).toEqual({ url: expect.stringContaining('proof.png'), name: 'proof.png', type: 'image/png', size: 2048 });
    expect(uploaded[1].type).toBe('application/pdf');
  });

  test('a .pdf with no MIME type still counts as a PDF', async () => {
    const { uploaded, skipped } = await uploadMsgFiles([file('scan.PDF', '')]);
    expect(skipped).toEqual([]);
    expect(uploaded[0].type).toBe('application/pdf');
  });

  test('other file types are refused by name, not silently dropped', async () => {
    const { uploaded, skipped } = await uploadMsgFiles([file('roster.xlsx', 'application/vnd.ms-excel')]);
    expect(uploaded).toEqual([]);
    expect(skipped[0]).toContain('roster.xlsx');
    expect(fileUpload).not.toHaveBeenCalled();
  });

  test('oversized files are refused before upload', async () => {
    const { uploaded, skipped } = await uploadMsgFiles([file('huge.png', 'image/png', (MSG_ATTACH_MAX_MB + 1) * 1024 * 1024)]);
    expect(uploaded).toEqual([]);
    expect(skipped[0]).toContain(`over ${MSG_ATTACH_MAX_MB}MB`);
    expect(fileUpload).not.toHaveBeenCalled();
  });

  test('one failed upload does not lose the files that succeeded', async () => {
    fileUpload.mockImplementation(async (f) => { if (f.name === 'a.png') throw new Error('network'); return 'https://res.cloudinary.com/x/image/upload/v1/' + f.name });
    const { uploaded, skipped } = await uploadMsgFiles([file('a.png', 'image/png'), file('b.png', 'image/png')]);
    expect(uploaded.map(u => u.name)).toEqual(['b.png']);
    expect(skipped[0]).toContain('a.png');
  });
});

describe('msgAttachments', () => {
  test('older messages with no attachments column read as empty', () => {
    expect(msgAttachments({ id: 'm1', text: 'hi' })).toEqual([]);
    expect(msgAttachments({ attachments: null })).toEqual([]);
    expect(msgAttachments(undefined)).toEqual([]);
  });

  test('entries without a url are dropped so nothing renders a broken tile', () => {
    expect(msgAttachments({ attachments: [{ url: 'u1' }, { name: 'no url' }, null] })).toEqual([{ url: 'u1' }]);
  });
});
