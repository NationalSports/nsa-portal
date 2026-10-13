// Two portal customers with the same name can't both sync to QuickBooks (the sync holds
// them as duplicate_portal_customer_name) — e.g. Santiago HS Softball in Garden Grove and
// in Corona. The customer form flags the clash and suggests adding the city.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustModal, sameNameCustomers, cityQualifiedName } from '../modals';

const gardenGrove = { id: 'c1', name: 'Santiago HS Softball', alpha_tag: 'SnSft', shipping_city: 'Garden Grove' };
const others = [gardenGrove, { id: 'c2', name: 'Santiago Canyon College Softball', alpha_tag: 'SANTC', shipping_city: 'Orange' }];

describe('sameNameCustomers', () => {
  test('matches ignoring case and extra spaces, never the customer itself', () => {
    expect(sameNameCustomers('  santiago  hs SOFTBALL ', 'new', others)).toEqual([gardenGrove]);
    expect(sameNameCustomers('Santiago HS Softball', 'c1', others)).toEqual([]);
    expect(sameNameCustomers('Santiago HS Football', 'new', others)).toEqual([]);
    expect(sameNameCustomers('', 'new', others)).toEqual([]);
  });
});

describe('cityQualifiedName', () => {
  test('puts the city right after the school name', () => {
    expect(cityQualifiedName('Santiago HS Softball', 'Corona')).toBe('Santiago (Corona) HS Softball');
    expect(cityQualifiedName('Rancho Buena Vista High School Baseball Boosters', 'Vista'))
      .toBe('Rancho Buena Vista (Vista) High School Baseball Boosters');
  });
  test('appends the city when there is no school word, and title-cases an all-caps city', () => {
    expect(cityQualifiedName('Liberty Softball Club', 'ATASCADERO')).toBe('Liberty Softball Club (Atascadero)');
  });
  test('leaves a name that already carries the city alone', () => {
    expect(cityQualifiedName('Santiago (Corona) HS Softball', 'Corona')).toBe('Santiago (Corona) HS Softball');
  });
});

describe('CustModal duplicate-name flag', () => {
  const draft = { name: 'Santiago HS Softball', alpha_tag: 'SNTSF', shipping_city: 'Corona', shipping_state: 'CA', contacts: [{ name: 'Thomas Celaya', email: 't@cnusd.k12.ca.us', role: 'Head Coach' }] };
  const open = (customer, onSave = jest.fn()) => {
    render(<CustModal isOpen onClose={() => {}} onSave={onSave} customer={customer} parents={[]} reps={[]} allCustomers={others} />);
    return onSave;
  };

  test('warns, offers the city-qualified name, and blocks save until it is different', () => {
    const onSave = open(draft);
    expect(screen.getByText(/Same name as Santiago HS Softball \(SnSft, Garden Grove\)/)).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Customer names must be different/)).toBeTruthy();
    fireEvent.click(screen.getByText('Use "Santiago (Corona) HS Softball"'));
    expect(screen.getByDisplayValue('Santiago (Corona) HS Softball')).toBeTruthy();
    expect(screen.queryByText(/Same name as/)).toBeNull();
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Santiago (Corona) HS Softball' }));
  });

  test('editing an existing customer that already shares a name is not blocked', () => {
    open({ ...gardenGrove, id: 'c9', contacts: draft.contacts, shipping_state: 'CA' });
    expect(screen.queryByText(/Same name as/)).toBeNull();
  });
});
