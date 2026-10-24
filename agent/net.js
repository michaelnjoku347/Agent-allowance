/**
 * Retry a fetch only when Node reports a dropped connection ("fetch failed").
 * HTTP error statuses are returned as-is so a payment is not sent twice.
 */

export async function fetchWithRetry(fetchImpl, url, options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      lastError = error;
      const message = error?.message ?? '';
      if (!message.includes('fetch failed') || attempt === attempts) throw error;
    }
  }
  throw lastError;
}

export function retryingFetch(fetchImpl = globalThis.fetch, attempts = 3) {
  return (url, options) => fetchWithRetry(fetchImpl, url, options, attempts);
}
