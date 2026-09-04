jest.mock('../../netlify/functions/_shared', () => ({
  verifyAdmin: jest.fn(),
}));

const { verifyAdmin } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/richardson-debug');

describe('richardson-debug authorization', () => {
  beforeEach(() => {
    verifyAdmin.mockReset();
    delete process.env.RICHARDSON_DEBUG_ENABLED;
  });

  test('rejects an unauthenticated invocation before any upstream work', async () => {
    verifyAdmin.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    global.fetch = jest.fn();

    const result = await handler({ httpMethod: 'POST', headers: {} });

    expect(result.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('stays unavailable to an admin unless explicitly enabled', async () => {
    verifyAdmin.mockResolvedValue({ ok: true });

    const result = await handler({ httpMethod: 'POST', headers: {} });

    expect(result.statusCode).toBe(404);
  });
});
