// Bounds the caller's wait without treating a late response as a new login/load.
// The underlying request may still settle; consumers must only apply this result.
export async function withStartupDeadline(operation, label, timeoutMs = 20000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' took too long. Please reload and try again.')), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
