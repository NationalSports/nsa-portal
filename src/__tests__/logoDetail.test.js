import React from 'react';
import { render, screen } from '@testing-library/react';
import JobGarmentMocks from '../JobGarmentMocks';
import { logoDetailUrl, logoDetailBg, setLogoDetail, removeLogoDetail, jobMissingLogoDetails, garmentLogoDetails } from '../lib/logoDetail';
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

  test('the approval gate names each design / color way still missing a logo detail', () => {
    const order = { items: [line('AT106', 'Medium Grey Heather'), line('JW6597', 'White', 'cw2')], art_files: [art] };
    const twoItems = { ...job, items: job.items.slice(0, 2) };
    expect(jobMissingLogoDetails(twoItems, order)).toEqual(['WVC Water Polo (Grey)', 'WVC Water Polo (White)']);
    const done = { ...order, art_files: setLogoDetail(setLogoDetail([art], 'a', 'cw1', 'g.png'), 'a', 'cw2', 'w.png') };
    expect(jobMissingLogoDetails(twoItems, done)).toEqual([]);
    expect(garmentLogoDetails(twoItems.items[1], done, done.art_files)).toEqual([{ url: 'w.png', artName: 'WVC Water Polo', cwLabel: 'White' }]);
  });

  test('background follows the garment main color', () => {
    expect(logoDetailBg('Light Blue/White')).toBe('#7dd3fc');
    expect(logoDetailBg('Medium Grey Heather')).toBe('#9ca3af');
  });

  test('mock slots carry the color way the logo detail keys on', () => {
    const order = { items: [line('AT106', 'Medium Grey Heather')], art_files: [art] };
    const [group] = jobMockCardGroups({ ...job, items: job.items.slice(0, 1) }, order);
    expect(group.slots[0].cwId).toBe('cw1');
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

  test('embedded in a garment card, a linked garment shows a compact reference', () => {
    render(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={noop} itemIdx={1} />);
    expect(screen.getByText(/Shares the mock from AT106 · Medium Grey Heather/)).toBeTruthy();
    expect(screen.queryByText(/This mock covers/)).toBeNull();
  });
});
