const { fetchOmgReport, RETRYABLE_STATUSES } = require('../../netlify/functions/omg-report-proxy');

const response = (status) => ({ ok: status >= 200 && status < 300, status });

describe('OMG report proxy retries', () => {
  test('retries a transient 503 and returns the successful response', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const sleep = jest.fn().mockResolvedValue();

    const result = await fetchOmgReport('https://example.com/report', { fetchImpl, sleep });

    expect(result).toEqual({ response: response(200), attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('stops after three transient failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(503));
    const sleep = jest.fn().mockResolvedValue();

    const result = await fetchOmgReport('https://example.com/report', { fetchImpl, sleep });

    expect(result).toEqual({ response: response(503), attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('does not retry a permanent upstream error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(404));
    const sleep = jest.fn().mockResolvedValue();

    const result = await fetchOmgReport('https://example.com/report', { fetchImpl, sleep });

    expect(result).toEqual({ response: response(404), attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('retries network failures and records exhausted attempts', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('network unavailable'));
    const sleep = jest.fn().mockResolvedValue();

    await expect(fetchOmgReport('https://example.com/report', { fetchImpl, sleep }))
      .rejects.toMatchObject({ message: 'network unavailable', fetchAttempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('limits retries to transient HTTP statuses', () => {
    expect([...RETRYABLE_STATUSES]).toEqual([408, 425, 429, 500, 502, 503, 504]);
  });
});
