// Exchange rates for the "Exchange rate" bar. Stored in the ExchangeRates table and refreshed
// from the Central Bank of Russia JSON feed at most every 12 hours. If the feed is unreachable,
// the site keeps showing the last values from the database.
const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000; // after a failed update wait 10 minutes

function createRates({ repo, fetchImpl = fetch, url = CBR_URL }) {
  let cache = null;      // { rates, loadedAt }
  let refreshing = null;
  let lastAttempt = 0;

  async function refresh() {
    lastAttempt = Date.now();
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = ['USD', 'EUR']
        .map((code) => ({ code, rate: Number(data?.Valute?.[code]?.Value) }))
        .filter((r) => r.rate > 0);
      if (rates.length) await repo.saveRates(rates);
    } catch (err) {
      console.warn('Exchange rates not updated:', err.message);
    }
    cache = null;
  }

  return {
    async get() {
      if (!cache || Date.now() - cache.loadedAt > 60_000) {
        cache = { rates: await repo.getRates(), loadedAt: Date.now() };
      }
      const stale = cache.rates.some((r) => Date.now() - new Date(r.updatedAt).getTime() > MAX_AGE_MS);
      if (url && stale && !refreshing && Date.now() - lastAttempt > RETRY_MS) refreshing = refresh().finally(() => { refreshing = null; });
      return cache.rates;
    },
    refresh,
  };
}

module.exports = { createRates };
