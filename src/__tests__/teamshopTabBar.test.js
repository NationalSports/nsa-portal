/* src/teamshop/TabBar.js — the mobile bottom tab bar (Home/Shop/Stores/
 * Account) added for the mobile polish pass. It's a plain-CSS component
 * (`.nts-tabbar` is display:none by default, grid at <=640px in
 * theme.js) — jsdom doesn't evaluate the shared stylesheet's media query,
 * so this test asserts the CONTENT contract (all four tabs render with
 * their nav class, clicking one calls the matching handler, the active
 * tab is marked aria-current) rather than measured layout.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from '../teamshop/TabBar';

test('renders all four tabs and routes each click to its handler', () => {
  const onHome = jest.fn();
  const onShop = jest.fn();
  const onStores = jest.fn();
  const onAccount = jest.fn();

  render(<TabBar active="shop" onHome={onHome} onShop={onShop} onStores={onStores} onAccount={onAccount} />);

  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(nav.className).toContain('nts-tabbar');

  ['Home', 'Shop', 'Stores', 'Account'].forEach((label) => {
    expect(screen.getByText(label)).toBeTruthy();
  });

  fireEvent.click(screen.getByText('Home'));
  expect(onHome).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Stores'));
  expect(onStores).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Account'));
  expect(onAccount).toHaveBeenCalledTimes(1);
  expect(onShop).not.toHaveBeenCalled();
});

test('marks the active tab with aria-current', () => {
  render(<TabBar active="stores" onHome={() => {}} onShop={() => {}} onStores={() => {}} onAccount={() => {}} />);
  const storesBtn = screen.getByText('Stores').closest('button');
  expect(storesBtn.getAttribute('aria-current')).toBe('page');
  const homeBtn = screen.getByText('Home').closest('button');
  expect(homeBtn.getAttribute('aria-current')).toBeNull();
});
