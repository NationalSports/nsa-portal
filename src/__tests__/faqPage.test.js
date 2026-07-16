/* src/teamshop/FAQPage.js — the "Help Center" mock translated to React, with
 * copy grounded in real system facts (src/teamshop/faqData.js), not the
 * mock's placeholder numbers. This suite covers: the page renders with the
 * hero/search/pillars/accordion/contact band, category chips filter the
 * accordion, the live search filters question+answer text, and the
 * dashed-border "No matches" empty state appears when nothing matches.
 * Also asserts DTF is never presented as a top-level decoration method in
 * the FAQ data — it's a Heat Applications family member only. */
import React from 'react';
import {
  render, screen, fireEvent,
} from '@testing-library/react';
import FAQPage from '../teamshop/FAQPage';
import { FAQS, FAQ_CATEGORIES } from '../teamshop/faqData';

describe('faqData.js — DTF is never a top-level method', () => {
  test('no FAQ category is DTF, and no question names DTF as its own method', () => {
    expect(FAQ_CATEGORIES.some((c) => /dtf/i.test(c.label))).toBe(false);
    FAQS.forEach((item) => {
      expect(item.question.toLowerCase()).not.toContain('dtf');
    });
    // The one FAQ that discusses decoration methods must fold DTF into Heat
    // Applications, not list it as a fourth/separate method.
    const methodsFaq = FAQS.find((f) => f.id === 'deco-methods');
    expect(methodsFaq).toBeTruthy();
    expect(methodsFaq.answer).toMatch(/Embroidery, Heat Applications, and Screen Print/);
    expect(methodsFaq.answer.toLowerCase()).toContain('dtf');
    expect(methodsFaq.answer).toMatch(/Heat Applications is a family that covers full-color DTF/);
  });
});

describe('FAQPage', () => {
  test('renders hero, trust pillars, category chips, accordion, and contact band', () => {
    render(<FAQPage />);
    expect(screen.getByText('Help Center')).toBeTruthy();
    expect(screen.getByText("Questions? We've got answers.")).toBeTruthy();
    expect(screen.getByPlaceholderText('Search questions — sizing, PO, shipping…')).toBeTruthy();
    expect(screen.getByText('No blanket minimums')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ordering & Sizing' })).toBeTruthy();
    // Accordion questions render, closed by default.
    expect(screen.getByText('Is there a minimum order size?')).toBeTruthy();
    expect(screen.queryByText(/Screen print is the one exception — it requires/)).toBeNull();
    // Contact band uses the real support address, not a fabricated one.
    expect(screen.getByText('Chat with us')).toBeTruthy();
    expect(screen.getByText('Mon–Fri, 8a–6p CT')).toBeTruthy();
    expect(screen.getByText('info@nationalsportsapparel.com').getAttribute('href')).toBe('mailto:info@nationalsportsapparel.com');
  });

  test('clicking a question expands its answer, and toggles closed again', () => {
    render(<FAQPage />);
    const question = screen.getByText('Is there a minimum order size?');
    fireEvent.click(question);
    expect(screen.getByText(/Screen print is the one exception — it requires/)).toBeTruthy();
    fireEvent.click(question);
    expect(screen.queryByText(/Screen print is the one exception — it requires/)).toBeNull();
  });

  test('category chips filter the accordion to that category only', () => {
    render(<FAQPage />);
    expect(screen.getByText('Is there a minimum order size?')).toBeTruthy();
    expect(screen.getByText('What decoration methods do you offer?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Decoration' }));

    expect(screen.getByText('What decoration methods do you offer?')).toBeTruthy();
    expect(screen.queryByText('Is there a minimum order size?')).toBeNull();
  });

  test('search filters both question and answer text', () => {
    render(<FAQPage />);
    const search = screen.getByPlaceholderText('Search questions — sizing, PO, shipping…');

    // "clears" only appears in the ACH-timing answer body, not in any
    // question — proves the search matches answer text, not just questions.
    fireEvent.change(search, { target: { value: 'clears' } });
    expect(screen.getByText('When does my order start production after I pay?')).toBeTruthy();
    expect(screen.queryByText('Is there a minimum order size?')).toBeNull();

    fireEvent.change(search, { target: { value: 'School PO' } });
    expect(screen.getByText('How can I pay for an order?')).toBeTruthy();
    expect(screen.queryByText('Is there a minimum order size?')).toBeNull();
  });

  test('no matches renders the dashed-border empty state', () => {
    render(<FAQPage />);
    const search = screen.getByPlaceholderText('Search questions — sizing, PO, shipping…');
    fireEvent.change(search, { target: { value: 'zzzznotaquestionzzzz' } });
    expect(screen.getByText('No matches')).toBeTruthy();
  });
});
