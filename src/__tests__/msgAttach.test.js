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

const React = require('react');
const { render, screen, fireEvent, waitFor } = require('@testing-library/react');
const { fileUpload } = require('../utils');
const { uploadMsgFiles, msgAttachments, MsgDropZone, msgDragHasFiles, MSG_ATTACH_MAX_MB } = require('../lib/msgAttach');

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

describe('msgDragHasFiles', () => {
  test('true for a file drag, false for dragged text or a malformed event', () => {
    expect(msgDragHasFiles({ dataTransfer: { types: ['Files'] } })).toBe(true);
    expect(msgDragHasFiles({ dataTransfer: { types: ['text/plain'] } })).toBe(false);
    expect(msgDragHasFiles({})).toBe(false);
  });
});

describe('MsgDropZone', () => {
  const dt = (types, files = []) => ({ types, files, dropEffect: '' });
  const zone = (props = {}) => {
    const setItems = jest.fn();
    const setBusy = jest.fn();
    render(<MsgDropZone setItems={setItems} setBusy={setBusy} nf={props.nf} label="Drop to attach">
      <div data-testid="child">composer</div>
    </MsgDropZone>);
    return { el: screen.getByTestId('child').parentElement, setItems, setBusy };
  };

  test('dropped images upload and land in the pending list', async () => {
    const { el, setItems, setBusy } = zone();
    fireEvent.drop(el, { dataTransfer: dt(['Files'], [file('floor.jpg', 'image/jpeg', 2048)]) });
    await waitFor(() => expect(setItems).toHaveBeenCalled());
    // setItems is called with an updater, so run it against a prior list to see the result.
    expect(setItems.mock.calls[0][0]([{ url: 'existing' }])).toEqual([
      { url: 'existing' },
      { url: expect.stringContaining('floor.jpg'), name: 'floor.jpg', type: 'image/jpeg', size: 2048 },
    ]);
    await waitFor(() => expect(setBusy).toHaveBeenLastCalledWith(false));
  });

  test('a refused file is reported and nothing is attached', async () => {
    const nf = jest.fn();
    const { el, setItems } = zone({ nf });
    fireEvent.drop(el, { dataTransfer: dt(['Files'], [file('roster.xlsx', 'application/vnd.ms-excel')]) });
    await waitFor(() => expect(nf).toHaveBeenCalledWith(expect.stringContaining('roster.xlsx'), 'error'));
    expect(setItems).not.toHaveBeenCalled();
  });

  test('dragging text is ignored — no overlay, no upload', () => {
    const { el, setBusy } = zone();
    fireEvent.dragEnter(el, { dataTransfer: dt(['text/plain']) });
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.drop(el, { dataTransfer: dt(['text/plain']) });
    expect(setBusy).not.toHaveBeenCalled();
  });

  test('the overlay survives dragging across a child and clears on the real exit', () => {
    const { el } = zone();
    fireEvent.dragEnter(el, { dataTransfer: dt(['Files']) });
    expect(screen.queryByText('Drop to attach')).not.toBeNull();
    // Entering a child fires enter on the child and leave on the parent, in that order.
    fireEvent.dragEnter(screen.getByTestId('child'), { dataTransfer: dt(['Files']) });
    fireEvent.dragLeave(el, { dataTransfer: dt(['Files']) });
    expect(screen.queryByText('Drop to attach')).not.toBeNull();
    fireEvent.dragLeave(el, { dataTransfer: dt(['Files']) });
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });
});
