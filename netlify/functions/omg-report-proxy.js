// Netlify serverless function to proxy OMG shared report fetches (avoids CORS)
// Usage: /.netlify/functions/omg-report-proxy?id=48ff450f-30dc-46c0-5101-698fe5464e53

const MAX_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 7000;
const RETRY_DELAYS_MS = [250, 750];
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchOmgReport = async (url, options = {}) => {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || wait;
  const maxAttempts = options.maxAttempts || MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }

      console.warn(`[OMG report proxy] attempt ${attempt}/${maxAttempts} returned ${response.status}; retrying`);
    } catch (error) {
      if (attempt === maxAttempts) {
        error.fetchAttempts = attempt;
        throw error;
      }
      console.warn(`[OMG report proxy] attempt ${attempt}/${maxAttempts} failed (${error.name || 'Error'}); retrying`);
    } finally {
      clearTimeout(timeout);
    }

    await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
  }

  throw new Error('OMG report fetch exhausted retries');
};

exports.handler = async (event) => {
  const reportId = event.queryStringParameters?.id;
  if (!reportId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing report id parameter' }) };
  }

  // Validate UUID format to prevent injection
  if (!/^[a-f0-9-]{36}$/i.test(reportId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid report id format' }) };
  }

  const url = `https://report.ordermygear.com/reports/${reportId}`;

  try {
    const { response, attempts } = await fetchOmgReport(url);

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-OMG-Fetch-Attempts': String(attempts),
        },
        body: JSON.stringify({ error: `OMG report API returned ${response.status}`, attempts }),
      };
    }

    const data = await response.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-OMG-Fetch-Attempts': String(attempts),
      },
      body: data,
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    const statusCode = timedOut ? 504 : 502;
    const attempts = error?.fetchAttempts || MAX_ATTEMPTS;
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-OMG-Fetch-Attempts': String(attempts),
      },
      body: JSON.stringify({
        error: timedOut ? 'OMG report API timed out' : `Failed to fetch OMG report: ${error.message}`,
        attempts,
      }),
    };
  }
};

exports.fetchOmgReport = fetchOmgReport;
exports.RETRYABLE_STATUSES = RETRYABLE_STATUSES;
