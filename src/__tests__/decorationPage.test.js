/* src/teamshop/DecorationPage.js — the approved "Decoration" mockup, one
 * page with three method variants (embroidery|dtf|heat) switched by the
 * `method` prop. This suite covers: default embroidery content renders, the
 * `method` prop swaps content (dtf title present), the "Other methods" cards
 * call onSelectMethod with the right key, and the hero CTA calls
 * onShopMethod. Light render checks only, matching this repo's existing
 * teamshop test style (plain truthy checks, no jest-dom). */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DecorationPage from '../teamshop/DecorationPage';

describe('DecorationPage', () => {
  test('defaults to embroidery content', () => {
    render(<DecorationPage method="embroidery" onSelectMethod={() => {}} onShopMethod={() => {}} />);
    expect(screen.getAllByText('Embroidery').length).toBeGreaterThan(0);
    expect(screen.getByText('Texture you can feel')).toBeTruthy();
    expect(screen.getByText(/Up to 15 thread colors\*/)).toBeTruthy();
  });

  test('method prop switches content to DTF', () => {
    render(<DecorationPage method="dtf" onSelectMethod={() => {}} onShopMethod={() => {}} />);
    expect(screen.getAllByText('DTF Print').length).toBeGreaterThan(0);
    expect(screen.getByText('Color without limits')).toBeTruthy();
  });

  test('method prop switches content to Heat Applications', () => {
    render(<DecorationPage method="heat" onSelectMethod={() => {}} onShopMethod={() => {}} />);
    expect(screen.getAllByText('Heat Applications').length).toBeGreaterThan(0);
    expect(screen.getByText('Sharp, roster-ready lettering')).toBeTruthy();
  });

  test('unknown method falls back to embroidery', () => {
    render(<DecorationPage method="bogus" onSelectMethod={() => {}} onShopMethod={() => {}} />);
    expect(screen.getByText('Texture you can feel')).toBeTruthy();
  });

  test('other-methods cards call onSelectMethod with the matching key', () => {
    const onSelectMethod = jest.fn();
    render(<DecorationPage method="embroidery" onSelectMethod={onSelectMethod} onShopMethod={() => {}} />);
    fireEvent.click(screen.getByText('DTF Print'));
    expect(onSelectMethod).toHaveBeenCalledWith('dtf');
    fireEvent.click(screen.getByText('Heat Applications'));
    expect(onSelectMethod).toHaveBeenCalledWith('heat');
  });

  test('hero CTA calls onShopMethod', () => {
    const onShopMethod = jest.fn();
    render(<DecorationPage method="embroidery" onSelectMethod={() => {}} onShopMethod={onShopMethod} />);
    fireEvent.click(screen.getByText('Shop gear for this method'));
    expect(onShopMethod).toHaveBeenCalledTimes(1);
  });
});
