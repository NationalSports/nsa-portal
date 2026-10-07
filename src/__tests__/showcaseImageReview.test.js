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
    expect([...container.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual(['generation-source.png', 'new-hero.png']);
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
});
