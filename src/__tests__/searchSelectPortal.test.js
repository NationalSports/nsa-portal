import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchSelect } from '../components';

test('can render its menu outside a clipping modal', () => {
  const { container } = render(<div style={{overflow:'hidden'}}><SearchSelect options={[{value:'adidas',label:'Adidas Golf'}]} value="" onChange={()=>{}} placeholder="Search vendors..." menuPortal/></div>);
  fireEvent.click(screen.getByText('Search vendors...'));
  const menu = document.body.querySelector('[data-search-select-menu]');
  expect(menu).toBeTruthy();
  expect(menu.style.position).toBe('fixed');
  expect(container.contains(menu)).toBe(false);
  expect(screen.getByText('Adidas Golf')).toBeTruthy();
});
