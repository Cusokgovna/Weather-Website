// Helpers for talking to our backend.
// OpenWeather requests go through the server proxy (/api/ow), so the API key never reaches the browser.
// Exports: fetchWithTimeout(resource, options), owFetch(path, params, options), apiFetch(path, options)

export function fetchWithTimeout(resource, options = {}) {
  const { timeout = 5000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// path is like '/geo/1.0/direct' or '/data/2.5/weather'
export function owFetch(path, params = {}, options = {}) {
  const url = new URL('/api/ow', location.origin);
  url.searchParams.set('path', path);
  for (const k of Object.keys(params || {})) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  }
  return fetchWithTimeout(url.toString(), options);
}

// JSON request to our own API. Throws Error with .status and server message on failure.
export async function apiFetch(path, { method = 'GET', body, timeout = 8000 } = {}) {
  const res = await fetchWithTimeout('/api' + path, {
    method,
    timeout,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
