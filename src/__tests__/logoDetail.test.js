import React from 'react';
jest.mock('../utils',()=>({fileDisplayName:f=>f.name||f.url||'',_isImgUrl:()=>true,_cloudinaryPdfThumb:()=>null,openFile:jest.fn(),fileUpload:jest.fn()}));
import { render, screen } from '@testing-library/react';
import JobGarmentMocks from '../JobGarmentMocks';
import { logoDetailUrl, logoDetailBg, logoDetailBackground, cwGarmentColor, logoDetailLibraryUpdate, logoDetailCustomerUpdates, mergeWebLogoEdit, reusedLogoDetailNeeds, setLogoDetail, removeLogoDetail, jobMissingLogoDetails, garmentLogoDetails } from '../lib/logoDetail';
import { jobMockCardGroups } from '../lib/jobMockCards';

const art = {
  id: 'a', name: 'WVC Water Polo', deco_type: 'screen_print',
  color_ways: [{ id: 'cw1', garment_color: 'Grey', inks: ['PMS 1665C', '2768C'] }, { id: 'cw2', garment_color: 'White', inks: ['Navy'] }],
};
const line = (sku, color, cw = 'cw1', sizes = { XL: 2 }) => ({ sku, name: sku + ' tee', color, sizes, decorations: [{ kind: 'art', art_file_id: 'a', position: 'Front', color_way_id: cw }] });
const job = { id: 'j', art_file_id: 'a', items: [{ item_idx: 0, deco_idxs: [0] }, { item_idx: 1, deco_idxs: [0] }, { item_idx: 2, deco_idxs: [0] }] };

describe('logo detail helpers', () => {
  test('resolves the color way logo, then the default; a design thumbnail never counts', () => {
    expect(logoDetailUrl({ ...art, preview_url: 'thumb.jpg' }, 'cw1')).toBe('');
    const withDefault = setLogoDetail([art], 'a', null, { url: 'all.png', name: 'all.png' })[0];
    expect(withDefault.web_logo_url).toBe('all.png');
    expect(logoDetailUrl(withDefault, 'cw1')).toBe('all.png');
    const withCw = setLogoDetail([withDefault], 'a', 'cw1', 'grey.png')[0];
    expect(logoDetailUrl(withCw, 'cw1')).toBe('grey.png');
    expect(logoDetailUrl(withCw, 'cw2')).toBe('all.png');
    expect(withCw.web_logos.find(w => w.url === 'grey.png')).toMatchObject({ color_way_id: 'cw1', color_way: 'Grey' });
  });

  test('replacing a color way logo keeps one entry; removing clears the legacy mirror', () => {
    let arts = setLogoDetail([art], 'a', 'cw1', 'one.png');
    arts = setLogoDetail(arts, 'a', 'cw1', 'two.png');
    expect(arts[0].web_logos.map(w => w.url)).toEqual(['two.png']);
    arts = setLogoDetail(arts, 'a', null, 'def.png');
    arts = removeLogoDetail(arts, 'a', 'def.png');
    expect(arts[0].web_logo_url).toBe('');
    expect(arts[0].web_logos.map(w => w.url)).toEqual(['two.png']);
  });

  test('replacing or removing a logo detail is recorded as an intentional delete (no merge resurrection)', () => {
    let arts = setLogoDetail([art], 'a', 'cw1', 'old.png');
    arts = setLogoDetail(arts.map(({ _artDeletes, _artEditedFields, ...a }) => a), 'a', 'cw1', 'new.png');
    expect(arts[0].web_logos[0].url).toBe('new.png');
    expect(arts[0]._artDeletes.web_logos).toEqual(['old.png']);
    const removed = removeLogoDetail(setLogoDetail([art], 'a', null, 'def.png'), 'a', 'def.png');
    expect(removed[0]._artDeletes.web_logos).toContain('def.png');
    expect(removed[0]._artEditedFields).toContain('web_logo_url');
  });

  test('the approval gate names each design / color way still missing a logo detail', () => {
    const order = { items: [line('AT106', 'Medium Grey Heather'), line('JW6597', 'White', 'cw2')], art_files: [art] };
    const twoItems = { ...job, items: job.items.slice(0, 2) };
    expect(jobMissingLogoDetails(twoItems, order)).toEqual(['WVC Water Polo (Grey)', 'WVC Water Polo (White)']);
    const done = { ...order, art_files: setLogoDetail(setLogoDetail([art], 'a', 'cw1', 'g.png'), 'a', 'cw2', 'w.png') };
    expect(jobMissingLogoDetails(twoItems, done)).toEqual([]);
    expect(garmentLogoDetails(twoItems.items[1], done, done.art_files)).toEqual([{ url: 'w.png', artName: 'WVC Water Polo', cwLabel: 'White', side: '' }]);
  });

  test('background follows the garment main color', () => {
    expect(logoDetailBg('Light Blue/White')).toBe('#7dd3fc');
    expect(logoDetailBg('Medium Grey Heather')).toBe('#9ca3af');
  });

  test('a garment named CUSTOM uses its color way color; nothing known falls back to neutral grey', () => {
    const crest = { id: 'c', color_ways: [{ id: 'cwN', garment_color: 'Navy' }] };
    expect(cwGarmentColor(crest, 'cwN')).toBe('Navy');
    expect(logoDetailBackground('CUSTOM', cwGarmentColor(crest, 'cwN'))).toEqual({ bg: '#1f2a44', label: 'Navy', known: true, source: 'colorway' });
    expect(logoDetailBackground('CUSTOM', '')).toMatchObject({ known: false, bg: '#94a3b8' });
    // The line's own real color still wins over the color way (the WVC "Whiute" typo case).
    expect(logoDetailBackground('Medium Grey Heather', 'Whiute')).toMatchObject({ bg: '#9ca3af', label: 'Medium Grey Heather' });
    expect(logoDetailBg('Dark Heather')).toBe('#1f2937');
  });

  test('background edge cases: vendor names, ink-style color way labels, reversible B side', () => {
    expect(logoDetailBackground('Team Light Blue')).toMatchObject({ bg: '#7dd3fc', source: 'garment' });
    expect(logoDetailBackground('Collegiate Navy/White')).toMatchObject({ bg: '#1f2a44', label: 'Collegiate Navy' });
    expect(logoDetailBackground('Heather Navy').bg).toBe('#1f2a44');
    // Reversible: side B prints on the second color.
    expect(logoDetailBackground('Navy/White', '', 'B')).toMatchObject({ bg: '#ffffff', label: 'White' });
    // A color way label that describes INK is not a garment color.
    expect(logoDetailBackground('CUSTOM', 'White ink on dark')).toMatchObject({ source: 'unknown', bg: '#94a3b8' });
    expect(logoDetailBackground('CUSTOM', 'Navy')).toMatchObject({ source: 'colorway', bg: '#1f2a44' });
    // A real garment color always wins over the color way: one color way reused on several colors.
    expect(logoDetailBackground('Black', 'Navy')).toMatchObject({ source: 'garment', bg: '#111827' });
  });

  test('mock slots carry the color way the logo detail keys on', () => {
    const order = { items: [line('AT106', 'Medium Grey Heather')], art_files: [art] };
    const [group] = jobMockCardGroups({ ...job, items: job.items.slice(0, 1) }, order);
    expect(group.slots[0].cwId).toBe('cw1');
  });
});

describe('logo detail reaches the customer Art Library', () => {
  const orderArt = setLogoDetail([art], 'a', 'cw1', 'grey.png');
  test('same design by id: the library copy gets the color way logo, other logos kept', () => {
    const lib = [{ ...art, web_logos: [{ url: 'white.png', color_way_id: 'cw2', color_way: 'White' }] }];
    const out = logoDetailLibraryUpdate(lib, orderArt, { artId: 'a', colorWayId: 'cw1', url: 'grey.png' });
    expect(logoDetailUrl(out[0], 'cw1')).toBe('grey.png');
    expect(logoDetailUrl(out[0], 'cw2')).toBe('white.png');
    expect(out[0]._artDeletes).toBeUndefined();
  });
  test('same design by name + deco with different color way ids: matched by garment color label', () => {
    const lib = [{ id: 'lib1', name: 'wvc water polo', deco_type: 'screen_print', color_ways: [{ id: 'L1', garment_color: 'Grey' }] }];
    const out = logoDetailLibraryUpdate(lib, orderArt, { artId: 'a', colorWayId: 'cw1', url: 'grey.png' });
    expect(logoDetailUrl(out[0], 'L1')).toBe('grey.png');
  });
  test('library design missing the color way gets it added; removal mirrors; unrelated library untouched', () => {
    const lib = [{ id: 'a', name: art.name, deco_type: art.deco_type, color_ways: [] }];
    const added = logoDetailLibraryUpdate(lib, orderArt, { artId: 'a', colorWayId: 'cw1', url: 'grey.png' });
    expect(added[0].color_ways.map(c => c.id)).toEqual(['cw1']);
    const removed = logoDetailLibraryUpdate(added, orderArt, { artId: 'a', colorWayId: 'cw1', removeUrl: 'grey.png' });
    expect(logoDetailUrl(removed[0], 'cw1')).toBe('');
    expect(logoDetailLibraryUpdate([{ id: 'x', name: 'Other', deco_type: 'screen_print' }], orderArt, { artId: 'a', colorWayId: 'cw1', url: 'grey.png' })).toBeNull();
  });
  test('checks the team and its parent program library', () => {
    const customers = [{ id: 'team', parent_id: 'prog', art_files: [] }, { id: 'prog', art_files: [{ ...art }] }, { id: 'other', art_files: [{ ...art }] }];
    const ups = logoDetailCustomerUpdates(customers, 'team', orderArt, { artId: 'a', colorWayId: 'cw1', url: 'grey.png' });
    expect(ups.map(c => c.id)).toEqual(['prog']);
  });
});

describe('Art Library web-logo edits apply only the edit to each copy', () => {
  const cws = [{ id: 'cw1', garment_color: 'Navy' }, { id: 'cw2', garment_color: 'White' }];
  const before = [{ url: 'def.png', color_way: '', is_default: true }];
  test('another order keeps its own color-way logo; the edited default is applied', () => {
    const order = { id: 'o', color_ways: cws, web_logos: [{ url: 'job-navy.png', color_way_id: 'cw1', color_way: 'Navy' }, { url: 'def.png', color_way: '', is_default: true }], web_logo_url: 'def.png' };
    const after = [{ url: 'def2.png', color_way: '', is_default: true }];
    const out = mergeWebLogoEdit(order, before, after);
    expect(logoDetailUrl(out, 'cw1')).toBe('job-navy.png');
    expect(logoDetailUrl(out, 'cw2')).toBe('def2.png');
    expect(out.web_logo_url).toBe('def2.png');
    expect(out._artDeletes.web_logos).toEqual(['def.png']);
  });
  test('a color way added in the library is filled in; a copy missing everything gets the list', () => {
    const after = [...before, { url: 'white.png', color_way: 'White', color_way_id: 'libW' }];
    const out = mergeWebLogoEdit({ id: 'o', color_ways: cws, web_logos: [] }, before, after, { mark: false });
    expect(logoDetailUrl(out, 'cw2')).toBe('white.png'); // foreign library cw id re-stamped by label
    expect(out.web_logos.find(w => w.url === 'white.png').color_way_id).toBe('cw2');
    expect(out._artDeletes).toBeUndefined();
  });
  test('removing the default clears it everywhere, including legacy web_logo_url', () => {
    const out = mergeWebLogoEdit({ id: 'o', web_logos: [], web_logo_url: 'def.png' }, before, []);
    expect(out.web_logo_url).toBe('');
    expect(out._artEditedFields).toContain('web_logo_url');
  });
});

describe('reused art asks for its web logo', () => {
  const mk = (id, cust, arts, jobState = {}) => {
    const so = { id, customer_id: cust, status: 'open', items: [line('AT106', 'Navy')], art_files: arts };
    return { so, job: { id: id + '-J', art_file_id: 'a', art_status: 'art_complete', prod_status: 'hold', items: [{ item_idx: 0, deco_idxs: [0] }], so, ...jobState } };
  };
  test('design in the Art Library, reused without a logo detail, is listed once per color way', () => {
    const { so, job } = mk('SO-2', 'team', [{ ...art }]);
    const need = reusedLogoDetailNeeds([job, { ...job, id: 'dup' }], [so], [{ id: 'team', art_files: [{ ...art, id: 'lib' }] }]);
    expect(need.map(n => n.label)).toEqual(['WVC Water Polo · Grey']);
    expect(need[0].garmentColor).toBe('Navy');
  });
  test('reuse is also detected from another order of the same program', () => {
    const a = mk('SO-1', 'teamA', [{ ...art }]);
    const b = mk('SO-2', 'teamB', [{ ...art }]);
    const customers = [{ id: 'teamA', parent_id: 'prog' }, { id: 'teamB', parent_id: 'prog' }, { id: 'prog' }];
    expect(reusedLogoDetailNeeds([b.job], [a.so, b.so], customers).length).toBe(1);
  });
  test('placeholder names like "ART TBD 1" on several orders are not treated as reuse', () => {
    const tbd = { ...art, name: 'ART TBD 1' };
    const a = mk('SO-1', 'team', [{ ...tbd }]);
    const b = mk('SO-2', 'team', [{ ...tbd }]);
    expect(reusedLogoDetailNeeds([b.job], [a.so, b.so], [{ id: 'team', art_files: [{ ...tbd, id: 'lib' }] }])).toEqual([]);
  });
  test('not listed: brand-new art, art with its logo, jobs still with the artist, finished jobs', () => {
    const fresh = mk('SO-3', 'solo', [{ ...art }]);
    expect(reusedLogoDetailNeeds([fresh.job], [fresh.so], [{ id: 'solo' }])).toEqual([]);
    const lib = [{ id: 'team', art_files: [{ ...art }] }];
    const done = mk('SO-4', 'team', setLogoDetail([art], 'a', 'cw1', 'x.png'));
    expect(reusedLogoDetailNeeds([done.job], [done.so], lib)).toEqual([]);
    const withArtist = mk('SO-5', 'team', [{ ...art }], { art_status: 'art_requested' });
    const shipped = mk('SO-6', 'team', [{ ...art }], { prod_status: 'shipped' });
    expect(reusedLogoDetailNeeds([withArtist.job, shipped.job], [withArtist.so, shipped.so], lib)).toEqual([]);
  });
});

describe('job garment mocks', () => {
  // AT106 and JW6597 share one mock; KV9999 was not picked and keeps its own.
  const linked = { ...art, mock_links: { 'JW6597|Heather Grey': 'AT106|Medium Grey Heather' }, item_mockups: { 'AT106|Medium Grey Heather': [{ url: 'mock.png' }] } };
  const order = { items: [line('AT106', 'Medium Grey Heather', 'cw1', { XL: 2 }), line('JW6597', 'Heather Grey', 'cw1', { M: 3 }), line('KV9999', 'White', 'cw2', { L: 4 })], art_files: [linked] };
  const noop = () => true;

  test('the standalone panel folds a linked garment into its source card with each garment qty', () => {
    render(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={noop} />);
    expect(screen.getByText(/This mock covers 2 garments/)).toBeTruthy();
    expect(screen.getByText('JW6597 · Heather Grey')).toBeTruthy();
    expect(screen.queryByText(/Shares the mock from/)).toBeNull();
    // The garment that was not picked keeps its own card and needs its own mock.
    expect(screen.getByText(/KV9999/)).toBeTruthy();
    expect(screen.getAllByText('Needs mock')).toHaveLength(1);
    expect(screen.getAllByText('Needs logo detail')).toHaveLength(1);
  });

});

test('shared garments are listed together with their received / shipped counts', () => {
  const linked = { ...art, mock_links: { 'JW6597|Heather Grey': 'AT106|Medium Grey Heather' }, item_mockups: { 'AT106|Medium Grey Heather': [{ url: 'mock.png' }] } };
  const order = { items: [line('AT106', 'Medium Grey Heather', 'cw1', { XL: 2 }), line('JW6597', 'Heather Grey', 'cw1', { M: 3 })], art_files: [linked] };
  const twoJob = { ...job, items: job.items.slice(0, 2) };
  const itemDetails = [{ item_idx: 0, sizes: { XL: 2 }, fulSizes: { XL: 2 } }, { item_idx: 1, sizes: { M: 3 }, fulSizes: { M: 1 } }];
  const onView = jest.fn();
  render(<JobGarmentMocks job={twoJob} order={order} getOrder={() => order} onSave={() => true} itemDetails={itemDetails} onViewItem={onView} />);
  expect(screen.getByText(/This mock covers 2 garments/)).toBeTruthy();
  expect(screen.getByText('Received')).toBeTruthy();
  expect(screen.getByText('2/2')).toBeTruthy();
  expect(screen.getByText('1/3')).toBeTruthy();
  // One block for the pair: a single mock card, no separate QTY row per garment.
  expect(document.querySelectorAll('section.garment-mock-card')).toHaveLength(1);
  expect(screen.queryByLabelText('Garment quantities and progress')).toBeNull();
});

test('a shared mock over different colors shows the logo on each color, uploadable where missing', () => {
  const two = { ...art, mock_links: { 'JW6597|Black': 'AT106|Navy' }, item_mockups: { 'AT106|Navy': [{ url: 'mock.png' }] }, web_logos: [{ url: 'navy-logo.png', color_way_id: 'cw1', color_way: 'Grey' }] };
  const order = { items: [line('AT106', 'Navy', 'cw1', { XL: 2 }), line('JW6597', 'Black', 'cw2', { M: 3 })], art_files: [two] };
  const twoJob = { ...job, items: job.items.slice(0, 2) };
  render(<JobGarmentMocks job={twoJob} order={order} getOrder={() => order} onSave={() => true} />);
  const strip = screen.getByLabelText('Logo detail on each garment color');
  expect(strip.textContent).toMatch(/Navy/);
  expect(strip.textContent).toMatch(/Black/);
  // JW6597 prints color way cw2, which has no logo detail yet — it can be uploaded from the tile.
  expect(strip.querySelector('input[type=file]')).toBeTruthy();
});

describe('logo detail pane', () => {
  const GarmentMockCard = require('../GarmentMockCard').default;
  const { fireEvent, waitFor } = require('@testing-library/react');
  const card = onUpload => <GarmentMockCard label="WVC" mocks={[{ url: 'm.png' }]} candidates={[]} onUse={() => true} onRemove={() => true} onUpload={() => true}
    logo={{ url: '', bg: '#9ca3af', colorName: 'Medium Grey Heather', onUpload }} />;

  test('the ? explains what the artist must upload', () => {
    render(card(jest.fn()));
    expect(screen.queryByText(/TRANSPARENT background/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What is a logo detail?' }));
    expect(screen.getByText(/exactly as this color way prints/)).toBeTruthy();
    expect(screen.getByText(/TRANSPARENT background/)).toBeTruthy();
  });

  test('the background can be switched so a white logo is visible on a light garment', () => {
    const { container } = render(<GarmentMockCard label="WVC" mocks={[{ url: 'm.png' }]} candidates={[]} onUse={() => true} onRemove={() => true} onUpload={() => true}
      logo={{ url: 'white-logo.png', bg: '#ffffff', colorName: 'White', onUpload: jest.fn() }} />);
    const frame = container.querySelector('.logo-frame');
    expect(frame.style.background).toMatch(/255, 255, 255|#ffffff/i);
    fireEvent.click(screen.getByRole('button', { name: 'Checkered' }));
    expect(frame.className).toMatch(/bg-checker/);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(frame.className).toMatch(/bg-dark/);
    expect(frame.style.background).toBe('');
  });

  test('a JPG is refused with an explanation instead of uploading', async () => {
    const onUpload = jest.fn();
    const { container } = render(card(onUpload));
    const input = container.querySelector('input[accept=".png"]');
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/PNG with a transparent background/));
    expect(onUpload).not.toHaveBeenCalled();
  });
});
