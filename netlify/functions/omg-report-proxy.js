// Netlify serverless function to proxy OMG shared report fetches (avoids CORS)
// Usage: /.netlify/functions/omg-report-proxy?id=48ff450f-30dc-46c0-5101-698fe5464e53

// OMG's report API is slow by nature, not occasionally slow: a small 41 KB report
// measures a steady 6.0-6.8s end to end, and a real store report is bigger. The old
// 7s per-attempt timeout sat UNDER that normal response time, so a healthy-but-large
// report aborted on every attempt and the handler reported a 504 — the "Report fetch
// failed: 504" staff hit when importing a store. Retrying an identical too-short
// request three times never helped, because nothing was transient.
//
// Budget instead of guessing: the function gets 26s (netlify.toml), so spend at most
// TOTAL_BUDGET_MS on fetching and give each attempt whatever is left, capped at
// FETCH_TIMEOUT_MS. Keep MAX_ATTEMPTS for the genuinely transient 5xx case; the budget
// decides how many of them actually run.
const MAX_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 12000;
const TOTAL_BUDGET_MS = 23000;
// No point starting an attempt that cannot outlast a normal response.
const MIN_ATTEMPT_MS = 7000;
const RETRY_DELAYS_MS = [250, 750];
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Staff-facing wording: a gateway status from OMG is OMG being slow or down, not a bad
// link, and the difference decides whether retrying is worth their time. Returns '' for
// statuses that are genuinely about the request (404 on a dead link, 403 on a private
// report) so the caller keeps its own message.
const omgDownMessage = (status) => (
  status === 502 || status === 503 || status === 504
    ? `OrderMyGear's report service did not respond (${status}). This is on their end — wait a minute and try the import again.`
    : ''
);

const fetchOmgReport = async (url, options = {}) => {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || wait;
  const now = options.now || (() => Date.now());
  const maxAttempts = options.maxAttempts || MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
  const totalBudgetMs = options.totalBudgetMs || TOTAL_BUDGET_MS;
  const minAttemptMs = options.minAttemptMs || MIN_ATTEMPT_MS;
  const startedAt = now();
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = totalBudgetMs - (now() - startedAt);
    // Out of budget: hand back the last real response rather than burning the
    // caller's remaining time on an attempt too short to succeed.
    if (attempt > 1 && remaining < minAttemptMs) {
      if (lastResult) return { response: lastResult, attempts: attempt - 1 };
      break;
    }
    const attemptTimeoutMs = attempt === 1 ? Math.min(timeoutMs, Math.max(remaining, minAttemptMs)) : Math.min(timeoutMs, remaining);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }
      lastResult = response;

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
        body: JSON.stringify({ error: omgDownMessage(response.status) || `OMG report API returned ${response.status}`, attempts }),
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
        error: timedOut
          ? "OrderMyGear's report service did not respond in time. This is on their end — wait a minute and try the import again."
          : `Failed to fetch OMG report: ${error.message}`,
        attempts,
      }),
    };
  }
};

exports.fetchOmgReport = fetchOmgReport;
exports.RETRYABLE_STATUSES = RETRYABLE_STATUSES;
