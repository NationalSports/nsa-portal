import React, { useState } from 'react';
import { readable, legibleOn } from '../lib/a11y';
import baseball from './assets/baseball.webp';
import football from './assets/football.webp';
import soccer from './assets/soccer.webp';
import softball from './assets/softball.webp';
import track from './assets/track.webp';
import volleyball from './assets/volleyball.webp';
import wrestling from './assets/wrestling.webp';
import './allSchoolStorefront.css';

const sportPhotos = { baseball, football, soccer, softball, track, volleyball, wrestling };
const settingsOf = (store) => store.all_school_settings || {};
export const schoolPrograms = (store) => (Array.isArray(settingsOf(store).programs) ? settingsOf(store).programs : [])
  .filter((p) => p && p.id && p.name && p.enabled !== false)
  .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
export function schoolVariantGroupKey(product, baseKey) {
  return JSON.stringify([baseKey, [...(Array.isArray(product.school_program_ids) ? product.school_program_ids : [])].sort(), product.school_shared === true]);
}
export function schoolProductMatches(product, program) {
  const ids = Array.isArray(product.school_program_ids) ? product.school_program_ids : [];
  if (program === 'all') return true;
  if (program === 'spirit') return ids.length === 0;
  return ids.includes(program) || product.school_shared === true;
}
export function schoolOrderShipmentDate(store, order) {
  if (order.ship_target_at && Number.isFinite(Date.parse(order.ship_target_at))) return { date: new Date(order.ship_target_at), approximate: false };
  const placed = Date.parse(order.created_at || '');
  if (!Number.isFinite(placed)) return { date: null, approximate: true };
  const days = Math.max(1, Number(order.target_ship_days) || targetDays(store));
  return { date: new Date(placed + days * 86400000), approximate: true };
}
const shortName = (name) => String(name || 'School').replace(/\s+(?:team\s+store|school\s+store|webstore|store)\s*$/i, '').trim();
const initials = (name) => shortName(name).split(/\s+/).slice(0, 3).map((s) => s[0]).join('');
const targetDays = (store) => Math.max(1, Number(settingsOf(store).target_ship_days) || 14);
const shipLabel = (store) => targetDays(store) % 7 === 0 ? `${targetDays(store) / 7} weeks` : `${targetDays(store)} days`;
const photoOf = (program) => program.image_url || sportPhotos[Object.keys(sportPhotos).find((name) => `${program.name} ${program.slug || ''}`.toLowerCase().includes(name))];

export function AllSchoolHeader({ store, theme, cartCount, onHome, onCart, onAllItems, onPrograms, onSpirit }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (handler) => { setMenuOpen(false); handler(); };
  return <>
    <div className="as-utility" style={{ background: theme.deepest }}>
      <div className="as-wrap as-utility-inner">
        <a href="https://nationalsportsapparel.com">National Sports Apparel <span aria-hidden>↗</span></a>
        <span>Made for your school <span aria-hidden>★</span> Shipped to your door</span>
        <a href="tel:+17142798777">(714) 279-8777</a>
      </div>
    </div>
    <header className="as-header" style={{ background: theme.band }}>
      <div className="as-wrap as-header-inner">
        <button className="as-brand" onClick={() => go(onHome)} aria-label={`${store.name} store home`}>
          {store.logo_url && <span className="as-brand-logo"><img src={store.logo_url} alt="" /></span>}
          <span><small>Official School Store</small><strong>{shortName(store.name)}</strong></span>
        </button>
        <nav className="as-desktop-nav" aria-label="Store navigation">
          <button onClick={onSpirit}>School Spirit</button><button onClick={onPrograms}>Shop by Sport</button><button onClick={onAllItems}>All Items</button>
        </nav>
        <button className="as-cart" onClick={() => go(onCart)} style={{ color: readable(theme.accent, '#fff') }} aria-label={`View cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
          <svg width="19" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></svg><span>Cart</span><b>{cartCount}</b>
        </button>
        <button className="as-menu-toggle" aria-expanded={menuOpen} aria-controls="as-mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
      </div>
      {menuOpen && <nav id="as-mobile-menu" className="as-mobile-nav" aria-label="Mobile store navigation"><button onClick={() => go(onSpirit)}>School Spirit</button><button onClick={() => go(onPrograms)}>Shop by Sport</button><button onClick={() => go(onAllItems)}>All Items</button></nav>}
      <div className="as-header-rule" aria-hidden />
    </header>
  </>;
}

export function AllSchoolIntro({ store, theme, products, selectedProgram, onProgram, onShop }) {
  const programs = schoolPrograms(store);
  const settings = settingsOf(store);
  const school = shortName(store.name);
  const featuredWord = settings.hero_background_text == null ? school.split(' ').slice(-1)[0] : String(settings.hero_background_text).trim().slice(0, 40);
  return <>
    <section className={`as-hero${store.banner_url ? ' as-hero-photo' : ''}`} style={{ backgroundColor: theme.band }} aria-label={`${school} school store`}>
      {store.banner_url && <img className="as-hero-background" src={store.banner_url} alt="" loading="eager" />}
      <div className="as-hero-wash" aria-hidden style={{ background: 'linear-gradient(90deg,rgba(0,0,0,.45),rgba(0,0,0,.12))' }} />
      <div className="as-hero-texture" aria-hidden />
      <div className="as-hero-edge" aria-hidden />
      <div className="as-wrap as-hero-inner">
        <div className="as-hero-ribbon" style={{ color: readable(theme.accent, '#fff') }}><span>One school. Every program.</span><span aria-hidden>✕ ✕ ✕</span></div>
        <div className="as-hero-stage">
          <span className="as-hero-word" aria-hidden>{featuredWord}</span>
          <div className="as-hero-crest">{store.logo_url ? <img src={store.logo_url} alt="" /> : <span className="as-initials">{initials(store.name)}</span>}</div>
        </div>
        <div className="as-hero-bottom"><div><p className="as-eyebrow">The official {school} store</p><h1>{settings.hero_heading || 'Your school. Your colors.'}</h1><p className="as-hero-copy">{settings.hero_subheading || store.hero_blurb || 'Gear for game day, every day, and everyone who calls this school home.'}</p></div><button className="as-primary-button" onClick={onShop} style={{ color: readable(theme.accent, '#fff') }}>Shop all gear <span aria-hidden>↗</span></button></div>
      </div>
    </section>
    <div className="as-promise" style={{ background: theme.deepest, '--as-on-dark-accent': legibleOn(theme.accent, theme.deepest) }}><div className="as-wrap"><span><i aria-hidden>★</i> Official school gear</span><span><i aria-hidden>★</i> Decorated in Orange, CA</span><span><i aria-hidden>★</i> Ships in about {shipLabel(store)}</span></div></div>
    {programs.length > 0 && <section className="as-programs" id="shop-programs" aria-labelledby="as-program-heading"><div className="as-wrap">
      <div className="as-section-heading"><div><p className="as-eyebrow">Every program, one store</p><h2 id="as-program-heading">Shop by <em>Sport</em></h2></div><button className="as-text-button" onClick={() => onProgram('all')}>Explore all gear <span aria-hidden>↗</span></button></div>
      <div className="as-program-grid">{programs.map((program) => {
        const photo = photoOf(program);
        const count = products.filter((p) => schoolProductMatches(p, program.id)).length;
        return <button className={`as-program-card${selectedProgram === program.id ? ' as-selected' : ''}`} key={program.id} onClick={() => onProgram(program.id)} aria-pressed={selectedProgram === program.id}>
          {photo ? <img src={photo} loading="lazy" alt="" /> : <span className="as-program-monogram" aria-hidden>{program.name.slice(0, 2)}</span>}
          <span className="as-program-shade" aria-hidden />
          <span className="as-program-index" aria-hidden>↗</span>
          <span className="as-program-copy"><strong>{program.name}</strong><span><i aria-hidden />{count ? 'Shop the collection' : 'Explore the program'}</span></span>
        </button>;
      })}</div>
    </div></section>}
    <section className="as-spirit" aria-labelledby="as-spirit-heading"><div className="as-wrap as-spirit-inner"><div className="as-spirit-art" aria-hidden><span>School<br />Spirit.</span>{store.logo_url && <img src={store.logo_url} alt="" loading="lazy" />}</div><div className="as-spirit-content"><p className="as-eyebrow">For the whole school</p><h2 id="as-spirit-heading">Wear your <em>pride.</em></h2><p>Students, families, staff, and alumni. Your school favorites belong everywhere.</p><button className="as-primary-button" onClick={() => onProgram('spirit')} style={{ color: readable(theme.accent, '#fff') }}>Shop school spirit <span aria-hidden>↗</span></button></div></div></section>
  </>;
}

export function AllSchoolBrowse({ store, program, onProgram, categories, category, onCategory, query, setQuery, count, onReset }) {
  const programs = schoolPrograms(store);
  const title = program === 'spirit' ? 'School Spirit' : programs.find((p) => p.id === program)?.name || 'All Gear';
  return <div className="as-browse">
    <div className="as-section-heading"><div><p className="as-eyebrow">{query ? 'Find your favorites' : program === 'all' ? 'Made for your school' : 'Shop the collection'}</p><h2>{title}</h2></div><label className="as-search"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 6 6" /></svg><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find your gear" aria-label="Search school store products" /></label></div>
    <div className="as-filter-row"><label className="as-program-select">Program<select value={program} onChange={(e) => onProgram(e.target.value)}><option value="all">All programs</option><option value="spirit">School Spirit</option>{programs.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="as-category-tabs" aria-label="Product categories"><button aria-pressed={category === 'all'} className={category === 'all' ? 'as-active' : ''} onClick={() => onCategory('all')}>All products</button>{categories.map((c) => <button aria-pressed={category === c} className={category === c ? 'as-active' : ''} key={c} onClick={() => onCategory(c)}>{c}</button>)}</div></div>
    <div className="as-result-row"><span role="status" aria-live="polite">{count} product{count === 1 ? '' : 's'}{query ? ` matching “${query}”` : ''}</span>{(program !== 'all' || category !== 'all' || query) && <button className="as-text-button" onClick={onReset}>Clear filters <span aria-hidden>✕</span></button>}</div>
  </div>;
}
