// Shared OpenWeather API helper.
// Exports: fetchWithTimeout(resource, options), getKey(), owFetch(path, params, options)

export function fetchWithTimeout(resource, options = {}) {
  const { timeout = 5000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

export function getKey() {
  const key = window.CONFIG?.OPENWEATHER_KEY;
  const proxy = window.CONFIG?.PROXY_URL;
  // If proxy is configured, a client-side key isn't required.
  if (!key && !proxy) {
    if (typeof setStatus === 'function') setStatus('Missing OpenWeather API key. Create `config.js` with window.CONFIG = { OPENWEATHER_KEY: "YOUR_KEY" }', 'error');
    throw new Error('Missing API key');
  }
  return key;
}

// path is like '/geo/1.0/direct' or '/data/2.5/weather'
export async function owFetch(path, params = {}, options = {}) {
  const proxy = window.CONFIG?.PROXY_URL;
  if (proxy) {
    // Build proxy URL. Proxy is expected to forward to OpenWeather and inject server-side key.
    const proxyUrl = new URL(proxy, location.origin);
    proxyUrl.searchParams.set('path', path);
    for (const k of Object.keys(params || {})) {
      if (params[k] !== undefined && params[k] !== null) proxyUrl.searchParams.set(k, params[k]);
    }
    return fetchWithTimeout(proxyUrl.toString(), options);
  }

  // Direct call to OpenWeather (client-side key)
  const key = getKey();
  const url = new URL('https://api.openweathermap.org' + path);
  for (const k of Object.keys(params || {})) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  }
  url.searchParams.set('appid', key);
  return fetchWithTimeout(url.toString(), options);
}
