const { test, expect } = require('@playwright/test');

const proofSvg = (label, color) => `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="420" height="480" viewBox="0 0 420 480">
    <rect width="420" height="480" fill="#f5f6f8"/>
    <path d="M122 94 L165 54 H255 L298 94 L355 130 L326 194 L288 172 L288 416 Q210 448 132 416 L132 172 L94 194 L65 130 Z" fill="${color}"/>
    <path d="M165 54 Q210 92 255 54" fill="none" stroke="#fff" stroke-width="18"/>
    <path d="M115 162 H305" stroke="#fff" stroke-width="42"/>
    <text x="210" y="270" text-anchor="middle" font-family="Arial" font-size="78" font-weight="700" fill="#fff">15</text>
    <text x="210" y="454" text-anchor="middle" font-family="Arial" font-size="18" fill="#172650">${label}</text>
  </svg>
`)}`;

const now = new Date('2026-07-19T18:00:00.000Z').toISOString();

function response(productionStatus = 'proof_ready', approved = false) {
  return {
    ok: true,
    order: {
      id: 'order-1234',
      order_number: 'UB-001234',
      token: 'private-test-token',
      team_name: 'North Stars',
      production_status: productionStatus,
      payment_status: 'po_terms',
      total_qty: 18,
      total: 1440,
      proof_version: 2,
      approved_proof_version: approved ? 2 : null,
      locked_at: null,
      created_at: now,
    },
    proofs: [{
      id: 'proof-2',
      version: 2,
      front_image: proofSvg('FRONT', '#751b26'),
      back_image: proofSvg('BACK', '#751b26'),
      note: 'Please verify the logo, player number, colors, and sleeve bands before approval.',
      customer_decision: approved ? 'approved' : null,
      sent_at: now,
      created_at: now,
    }],
    events: [
      { event_type: 'submitted', message: 'Order submitted', created_at: '2026-07-19T16:00:00.000Z' },
      { event_type: 'rep_review', message: 'Rep review completed', created_at: '2026-07-19T17:00:00.000Z' },
      { event_type: 'proof_published', message: 'Proof version 2 published', created_at: now },
    ],
  };
}

test('private order page shows proof, independent statuses, timeline, and versioned approval', async ({ page }) => {
  let approved = false;
  await page.route('**/.netlify/functions/uniform-order', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON();
    if (payload.action === 'customer_decision') {
      approved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response('approved', true)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response()) });
  });

  await page.goto('/uniform-builder?order=UB-001234&token=private-test-token');

  await expect(page.getByText('Proof ready', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('UB-001234 · North Stars')).toBeVisible();
  await expect(page.getByText('Production', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment', { exact: true })).toBeVisible();
  await expect(page.getByText('Proof version 2 published')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Front proof' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Back proof' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Version 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request Changes' })).toBeDisabled();

  await page.screenshot({ path: 'output/uniform-order-status.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve Version 2' }).click();
  await expect.poll(() => approved).toBe(true);
  await expect(page.getByText('Proof approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
});
