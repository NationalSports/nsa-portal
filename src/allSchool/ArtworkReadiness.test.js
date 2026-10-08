import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtworkReadiness from './ArtworkReadiness';
test('compact status keeps setup details out of the page and opens launch review', () => {
 const onReview=jest.fn();
 render(<ArtworkReadiness error="Set up the missing logo" onReview={onReview}/>);
 expect(screen.queryByText('Set up the missing logo')).toBeNull();
 fireEvent.click(screen.getByText('Artwork: needs setup'));expect(onReview).toHaveBeenCalled();
});
test('launch review shows blockers and explains that stock on hand is optional', () => {
 render(<ArtworkReadiness expanded error="Set up the missing logo"/>);
 expect(screen.getByText('Set up the missing logo')).toBeTruthy();
 expect(screen.getByText(/Stock on hand is not required/)).toBeTruthy();
});
