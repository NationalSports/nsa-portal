import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import ShowcaseImageReview from '../ui/ShowcaseImageReview';

describe('Expandable Showcase image comparison', () => {
  let container;
  let root;
  const item = { name: 'Serra Hoodie', standard_image_url: 'current-source.png', asset: {
    standard_image_url: 'generation-source.png', showcase_image_url: 'new-hero.png', approved_showcase_image_url: 'approved-hero.png',
    status: 'review', showcase_settings: { decoration_type: 'tackle_twill' },
  } };
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn();
    HTMLDialogElement.prototype.close = jest.fn();
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const button = (label) => [...container.querySelectorAll('button')].find((node) => node.textContent === label);

  test('opens a large labeled comparison of the generation source and new candidate, with full-size links', () => {
    act(() => root.render(<ShowcaseImageReview item={item} onClose={() => {}} onAction={() => {}} />));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect([...container.querySelectorAll('img')].map((node) => node.getAttribute('src'))).toEqual(['generation-source.png', 'new-hero.png']);
    expect([...container.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual(['new-hero.png']);
  });

  test('before shows the assigned front colorway once, including when enlarged', () => {
    const decorated = { ...item, color: 'Game Royal', decorations: [
      { art_url: 'wrong-color.png', cw_by_color: { 'game royal': { url: 'serra-logo.png' } }, x: 50, y: 39, w: 30 },
      { art_url: 'baked.png', baked: true }, { art_url: 'back.png', side: 'back' },
    ] };
    act(() => root.render(<ShowcaseImageReview item={decorated} onClose={() => {}} onAction={() => {}} />));
    expect([...container.querySelectorAll('img')].map((node) => node.getAttribute('src')))
      .toEqual(['generation-source.png', 'serra-logo.png', 'new-hero.png']);
    const logo = container.querySelector('img[src="serra-logo.png"]');
    expect(logo.style.left).toBe('50%'); expect(logo.style.top).toBe('39%'); expect(logo.style.width).toBe('30%');
    act(() => container.querySelector('[aria-label="Enlarge decorated standard image"]').click());
    expect(container.querySelectorAll('img[src="serra-logo.png"]')).toHaveLength(1);
    expect(container.querySelector('a[href="generation-source.png"]')).toBeNull();
  });

  test('shows candidate details and makes approval explicitly cover the image set', () => {
    const onAction = jest.fn();
    act(() => root.render(<ShowcaseImageReview item={{...item,asset:{...item.asset,qa_result:{detail_images:[{id:'logo-1',url:'detail.png',label:'Decoration detail'}]},approved_detail_images:[{url:'old.png'}]}}} onClose={()=>{}} onAction={onAction} />));
    expect(container.querySelector('img[src="detail.png"]')).toBeTruthy();
    expect(container.querySelector('img[src="old.png"]')).toBeNull();
    act(() => button('Approve Hero & Details').click());
    expect(onAction).toHaveBeenCalledWith('approve');
  });

  test('queued message does not claim that generation has started', () => {
    act(() => root.render(<ShowcaseImageReview item={{ ...item, asset: { status: 'queued' } }} onClose={() => {}} onAction={() => {}} />));
    expect(container.textContent).toContain('Queued · waiting for generation to start');
    expect(container.textContent).not.toContain('Your new hero image is generating');
  });

  test('approval and generation target this item and regeneration carries finish and feedback', () => {
    const onAction = jest.fn();
    act(() => root.render(<ShowcaseImageReview item={item} onClose={() => {}} onAction={onAction} />));
    act(() => button('Approve Image').click());
    expect(onAction).toHaveBeenLastCalledWith('approve');
    const textarea = container.querySelector('textarea');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Lighter twill depth');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => button('Generate New Image').click());
    expect(onAction).toHaveBeenLastCalledWith('generate', { showcase_settings: { decoration_type: 'tackle_twill', revision_notes: 'Lighter twill depth' } });
  });

  test('blocks approval of stale settings and blocks new generation while a job is running', () => {
    act(() => root.render(<ShowcaseImageReview item={{ ...item, asset: { ...item.asset, needs_regeneration: true } }} onClose={() => {}} onAction={() => {}} />));
    expect(button('Approve Image').disabled).toBe(true);
    act(() => root.render(<ShowcaseImageReview item={{ ...item, asset: { ...item.asset, status: 'generating', showcase_image_url: null } }} onClose={() => {}} onAction={() => {}} />));
    expect(button('Generate New Image')).toBeUndefined();
    expect(button('Cancel generation')).toBeDefined();
    expect(button('Approve Image').disabled).toBe(true);
    expect(container.querySelectorAll('img')[1].getAttribute('src')).toBe('approved-hero.png');
  });
  test('approval shows progress then closes when the server reports success', () => {
    const onClose=jest.fn(), onAction=jest.fn();
    const renderReview=(asset,busy=false,error='')=>act(()=>root.render(<ShowcaseImageReview item={{...item,asset}} busy={busy} error={error} onClose={onClose} onAction={onAction}/>));
    renderReview(item.asset);
    act(()=>button('Approve Image').click());
    renderReview(item.asset,true);
    expect(button('Approving…').disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    renderReview({...item.asset,status:'approved'},true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('failed approval stays open with a visible error and allows retry', () => {
    const onClose=jest.fn(),onAction=jest.fn();
    act(()=>root.render(<ShowcaseImageReview item={item} onClose={onClose} onAction={onAction}/>));
    act(()=>button('Approve Image').click());
    act(()=>root.render(<ShowcaseImageReview item={item} error="Catalog changed" onClose={onClose} onAction={onAction}/>));
    expect(onClose).not.toHaveBeenCalled();
    expect(button('Approve Image').disabled).toBe(false);
    expect(button('Approve Image').parentElement.querySelector('[role="alert"]').textContent).toBe('Catalog changed');
  });

});
