import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QBAuditExportCard from '../QBAuditExportCard';
import { authFetch } from '../utils';
jest.mock('../utils', () => ({ authFetch: jest.fn() }));
beforeEach(() => jest.clearAllMocks());

test('requires an explicit read and only submits authorized read actions', async () => {
  authFetch.mockImplementation(async (url, options) => {
    expect(url).toBe('/.netlify/functions/qb-api');
    const body = JSON.parse(options.body);
    expect(body.company).toBe('national'); expect(body.sandbox).toBe(false);
    expect(['connection_status', 'company_info', 'query']).toContain(body.action);
    const data = body.action === 'connection_status' ? { connected: true, realm_id: '9341456492604246' } :
      body.action === 'company_info' ? { CompanyInfo: { CompanyName: 'National Sports Apparel LLC' } } : { QueryResponse: {} };
    return { ok: true, json: async () => data };
  });
  render(<QBAuditExportCard />);
  expect(authFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Read audit data — no changes' }));
  await screen.findByRole('button', { name: 'Download audit JSON' });
  expect(authFetch).toHaveBeenCalledTimes(16);
});

test('a failed read never enables a complete export or silently retries a write', async () => {
  authFetch.mockResolvedValue({ ok: false, status: 403 });
  render(<QBAuditExportCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Read audit data — no changes' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 403'));
  expect(screen.queryByRole('button', { name: 'Download audit JSON' })).toBeNull();
  expect(authFetch).toHaveBeenCalledTimes(1);
});
