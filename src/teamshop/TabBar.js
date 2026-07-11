import React from 'react';
import { RED, TEXT_FAINT } from './theme';

// Mobile bottom tab bar — Home / Shop / Team Stores / Account, per the
// approved "National Team Shop - Mobile" Claude Design mockup's tab-bar
// pattern (that mockup's own 4 tabs are Home/Shop/Logos/Bag; the storefront
// build spec calls for Home/Shop/Stores/Account here instead, since cart
// already has a header icon and Account is a top-level route the mockup's
// build doesn't have). Hidden on desktop — see the `.nts-tabbar` rule in
// theme.js (display:none by default, grid at <=640px). Fixed to the
// viewport bottom; TeamShopApp.js pads `.nts-root` so it never covers page
// content, and ChatWidget.js docks itself above it on the same breakpoint.
//
// props:
//   active — 'home'|'shop'|'stores'|'account', whichever matches the
//     current route (see TeamShopApp's TAB_ROUTE_MATCH).
//   onHome/onShop/onStores/onAccount — () => void, the existing
//     goCatalog()-style navigation handlers already wired in TeamShopApp.

const TABS = [
  {
    key: 'home',
    label: 'Home',
    icon: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  },
  {
    key: 'shop',
    label: 'Shop',
    icon: <><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  },
  {
    key: 'stores',
    label: 'Stores',
    icon: <><path d="M4 5h16M4 12h16M4 19h10" /></>,
  },
  {
    key: 'account',
    label: 'Account',
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  },
];

export default function TabBar({
  active, onHome, onShop, onStores, onAccount,
}) {
  const handlers = {
    home: onHome, shop: onShop, stores: onStores, account: onAccount,
  };
  return (
    <nav className="nts-tabbar" aria-label="Primary">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            className="nts-tabbar-btn"
            onClick={handlers[t.key]}
            aria-current={isActive ? 'page' : undefined}
            style={{ color: isActive ? RED : TEXT_FAINT }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{t.icon}</svg>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
