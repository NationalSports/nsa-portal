const styleKey = (style) => String(style?.styleID ?? style?.styleId ?? '');
const compareStyleIds = (a, b) => {
  const left = String(a);
  const right = String(b);
  const natural = left.localeCompare(right, 'en', { numeric: true });
  return natural || left.localeCompare(right, 'en');
};

function sortStyles(styles) {
  return [...(styles || [])]
    .filter((style) => styleKey(style))
    .sort((a, b) => compareStyleIds(styleKey(a), styleKey(b)));
}

function stylesAfterCursor(styles, cursor) {
  const sorted = sortStyles(styles);
  const lastStyleId = String(cursor?.last_style_id || '');
  const retries = new Set((cursor?.retry_style_ids || []).map(String));
  const retryStyles = sorted.filter((style) => retries.has(styleKey(style)));
  const after = lastStyleId
    ? sorted.filter((style) => compareStyleIds(styleKey(style), lastStyleId) > 0)
    : sorted;
  return [...new Map([...retryStyles, ...after].map((style) => [styleKey(style), style])).values()];
}

function retryDelayMs(response, attempt, now = Date.now()) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now);
  }
  return Math.min(30_000, 1_250 * (2 ** attempt));
}

async function fetchWithBackoff(makeRequest, {
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 5,
  maxDelayMs = 30_000,
  now = Date.now,
} = {}) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      response = await makeRequest();
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await sleep(retryDelayMs(null, attempt, now()));
      continue;
    }
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable) return response;
    if (attempt === maxAttempts - 1) return response;
    const delayMs = retryDelayMs(response, attempt, now());
    // A long vendor cooldown cannot fit inside a Netlify invocation. Return
    // the 429 and let the durable retry cursor handle it on the next run.
    if (delayMs > maxDelayMs) return response;
    await sleep(delayMs);
  }
  return response;
}

module.exports = {
  compareStyleIds,
  fetchWithBackoff,
  retryDelayMs,
  sortStyles,
  styleKey,
  stylesAfterCursor,
};
