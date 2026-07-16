/* eslint-disable */
// ── Team Shop FAQ facts — single source of truth ──
// One home for the FAQ categories and Q/A facts, shared by BOTH the webpack
// client (src/teamshop/faqData.js re-exports everything for FAQPage/Search)
// AND the Netlify function runtime (netlify/functions/teamshop-assistant.js
// inlines these Q/As into the AI system prompt as the ONLY policy source the
// bot may state; ships in the bundle via netlify.toml included_files). Same
// dual-consumer CJS pattern as src/lib/decoPricing.js and opsRecap.js — keep
// this file dependency-free CommonJS (no import/export keywords, or webpack
// treats it as ESM and drops module.exports).
//
// IMPORTANT: every answer below is grounded in REAL system behavior (owner
// facts), NOT placeholder numbers/claims. In particular:
//   - No invented minimums, ship dates, rush service, free setup, physical
//     samples, SMS notifications, or proof-approval gates.
//   - DTF is never presented as its own top-level decoration method — it's
//     folded into "Heat Applications" alongside vinyl names/numbers and
//     silicone patches, matching DecorationPage.js's METHODS structure.
//   - Support email is the real info@nationalsportsapparel.com.

const FAQ_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'ordering', label: 'Ordering & Sizing' },
  { key: 'decoration', label: 'Decoration' },
  { key: 'team_stores', label: 'Team Stores' },
  { key: 'shipping', label: 'Shipping & Turnaround' },
  { key: 'payment', label: 'Payment & Billing' },
];

const FAQS = [
  {
    id: 'minimums',
    category: 'ordering',
    question: 'Is there a minimum order size?',
    answer: "There's no general piece minimum for most items. Screen print is the one exception — it requires at least 24 pieces per design. Embroidery and heat-applied decoration have no set minimum unless a specific option lists one on the product page.",
  },
  {
    id: 'team-pricing',
    category: 'ordering',
    question: 'Why don’t I see my team’s pricing?',
    answer: "Sign in with your coach account and your program's pricing shows live on every product automatically. Browsing without signing in shows standard retail pricing, including decoration — sign in any time to switch over.",
  },
  {
    id: 'order-tracking',
    category: 'ordering',
    question: 'How do I track an order after I place it?',
    answer: 'Your Account page lists every order you’ve placed with live production status — Received, Queued, In production, Decorated, Shipped — along with a tracker link for each one.',
  },
  {
    id: 'deco-methods',
    category: 'decoration',
    question: 'What decoration methods do you offer?',
    answer: 'Three: Embroidery, Heat Applications, and Screen Print (24+ pieces per design). Heat Applications is a family that covers full-color DTF transfers, vinyl names and numbers, and silicone patches — whichever fits your art and garment best.',
  },
  {
    id: 'logo-format',
    category: 'decoration',
    question: 'What file format should I upload for my logo?',
    answer: 'Vector files (AI, EPS, SVG, or PDF) work best. High-resolution PNG or JPG files are also accepted. Upload your logo once and it’s saved to your coach account for every future order — new embroidery logos are digitized before their first run.',
  },
  {
    id: 'deco-turnaround-link',
    category: 'decoration',
    question: 'Does decoration affect how long my order takes?',
    answer: 'Yes — turnaround is calculated per item and includes decoration time. Screen print adds roughly 2–3 weeks on top of the garment’s own lead time; embroidery and heat applications are built into the per-item estimate you see on the product page.',
  },
  {
    id: 'team-stores-what',
    category: 'team_stores',
    question: 'What is a Team Store?',
    answer: 'A private, branded storefront for your program where teammates, players, and family can order gear directly with your logos and colors already set up. You can optionally add a fundraising markup on top of the price, which goes back to your program.',
  },
  {
    id: 'team-stores-setup',
    category: 'team_stores',
    question: 'How do I get a Team Store set up?',
    answer: 'Reach out to your rep or our support team and we’ll get your program’s store set up with your logos and pricing.',
  },
  {
    id: 'turnaround',
    category: 'shipping',
    question: 'How long will my order take?',
    answer: 'Turnaround is calculated per item and shown live on the product page and in your cart, so you always see the estimate for your exact item and decoration. As a guide: in-stock items run about 1 week; SanMar/S&S blanks about 1.5–2 weeks; Momentec/Richardson about 2 weeks; adidas/Under Armour about 3 weeks; and screen print adds roughly 2–3 weeks.',
  },
  {
    id: 'tax',
    category: 'shipping',
    question: 'Is sales tax included in the price I see?',
    answer: 'Tax isn’t included in the listed price — it’s calculated at checkout based on your ship-to address.',
  },
  {
    id: 'payment-methods',
    category: 'payment',
    question: 'How can I pay for an order?',
    answer: 'Three ways: card (processed securely through Stripe), bank transfer (ACH), or a School PO for rep-approved programs. For a PO, submit your PO number and a PDF of the purchase order at checkout — our staff verify it before production starts, and it’s invoiced on your school’s terms.',
  },
  {
    id: 'ach-timing',
    category: 'payment',
    question: 'When does my order start production after I pay?',
    answer: 'Card payments move into production as soon as they’re confirmed. Bank transfers (ACH) enter production after the transfer clears, which typically takes about 4 business days. School PO orders enter production once our staff verify the PO.',
  },
];

module.exports = { FAQ_CATEGORIES, FAQS };
