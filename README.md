Weather app (demo)

This is a simple client-only weather demo that uses OpenWeather APIs (geocoding, current weather, forecast, air quality). It stores a small amount of user data in localStorage for demonstration purposes.

Notes and small improvements added:

- Avatar upload
  - The profile page now validates avatar files and attempts to resize/compress large images on the client before saving to localStorage.
  - Target avatar size: ~300 KB. Final guard rejects images > ~600 KB after compression.
  - Storing avatars uses data URLs inside the `users` object in localStorage. Keep uploads small to avoid localStorage quota issues.

- Toast notifications
  - Non-blocking toasts (bottom-right) replace alert() for nicer UX when saving profile or reporting avatar errors.

- Modal accessibility
  - The shared auth modal now focuses the first input/button when opened and closes on Escape (improves keyboard navigation).

Security reminder
- The OpenWeather API key is currently in `config.js` as `window.CONFIG.OPENWEATHER_KEY`. For production, keep API keys server-side and proxy requests via a backend or serverless function.

If you want, I can:
- Add a resize preview that shows a before-save preview and estimated size.
- Replace text alerts/messages with localized strings or inline UI messages.
- Implement a simple serverless proxy for the OpenWeather requests so the key is not exposed.

How to keep your API key out of the repo

1) Local development
 - Copy `config.example.js` to `config.js` and replace the placeholder with your API key.
 - `config.js` is ignored by `.gitignore` so it won't be committed.

2) CI / GitHub Pages deployment
 - Add a repository secret named `OPENWEATHER_KEY` (Settings → Secrets → Actions).
 - The included GitHub Actions workflow `./.github/workflows/deploy.yml` will create a `config.js` file from that secret at build time and deploy the site to `gh-pages`.

3) Serverless proxy (recommended for production)
 - Deploy a serverless function (Netlify / Vercel / AWS Lambda) that forwards requests to OpenWeather and reads the key from an environment variable.
 - Example Netlify function included at `netlify/functions/openweather-proxy.js` (reads `process.env.OPENWEATHER_KEY`).
 - Configure your site to use the proxy by setting `window.CONFIG.PROXY_URL` in `config.js`, e.g.:

```js
window.CONFIG = {
  PROXY_URL: '/.netlify/functions/openweather-proxy'
}
```

 - The client will call the proxy (no key exposed in browser). Set the `OPENWEATHER_KEY` on Netlify (Site settings → Build & deploy → Environment) or Vercel environment variables.

Notes and alternatives
 - For maximum security, proxy API requests through a server or serverless function that stores the key in a protected environment variable.
 - If you want, I can add an optional serverless proxy example (Netlify Functions / Vercel Serverless) and adjust the client to call the proxy instead of OpenWeather directly.

