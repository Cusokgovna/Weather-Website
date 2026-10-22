// Express application: JSON API (/api/*) + static frontend from /public.
// createApp() does not listen on a port and does not connect to the DB by itself,
// so tests can create it with an in-memory repository.
const path = require('node:path');
const express = require('express');
const {
  SESSION_COOKIE, SESSION_TTL_MS, hashPassword, verifyPassword, newSessionToken, hashToken, parseCookies,
} = require('./auth');

const OPENWEATHER_BASE = 'https://api.openweathermap.org';
// Only these OpenWeather endpoints and query params can be requested through the proxy.
const OW_PATHS = new Set(['/geo/1.0/direct', '/geo/1.0/reverse', '/data/2.5/weather', '/data/2.5/forecast', '/data/2.5/air_pollution']);
const OW_PARAMS = ['q', 'limit', 'lat', 'lon', 'units', 'lang'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const round4 = (n) => Math.round(n * 10000) / 10000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar || null });

function validateProfile(body) {
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Name must be 2–100 characters');
  if (!EMAIL_RE.test(email) || email.length > 255) throw new HttpError(400, 'Invalid email');
  return { name, email };
}

function validateCity(body) {
  const name = String(body?.name ?? '').trim();
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  if (!name || name.length > 150) throw new HttpError(400, 'City name is required');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Invalid latitude');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new HttpError(400, 'Invalid longitude');
  const country = body?.country ? String(body.country).trim().toUpperCase().slice(0, 2) : null;
  const state = body?.state ? String(body.state).trim().slice(0, 150) : null;
  return { name, country, state, lat: round4(lat), lon: round4(lon) };
}

function createApp({ repo, openWeatherKey = '', cookieSecure = false, fetchImpl = fetch, publicDir = path.join(__dirname, '..', 'public') }) {
  const app = express();
  app.disable('x-powered-by');

  // ---------- SEO: API responses must never be indexed ----------
  app.use('/api', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  // ---------- Session helpers ----------
  async function currentUser(req) {
    if (req.user !== undefined) return req.user;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.user = token ? await repo.findSessionUser(hashToken(token)) : null;
    return req.user;
  }

  async function requireAuth(req, res, next) {
    if (!(await currentUser(req))) return next(new HttpError(401, 'Sign in required'));
    next();
  }

  async function startSession(res, user) {
    const token = newSessionToken();
    await repo.createSession(user.id, hashToken(token), new Date(Date.now() + SESSION_TTL_MS));
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: SESSION_TTL_MS, path: '/' });
  }

  const api = express.Router();

  // ---------- Health ----------
  api.get('/health', async (req, res) => {
    let dbConnected = false;
    try { dbConnected = await repo.ping(); } catch { dbConnected = false; }
    res.status(dbConnected ? 200 : 503).json({ status: dbConnected ? 'ok' : 'degraded', db: repo.kind, dbConnected });
  });

  // ---------- Auth ----------
  api.post('/auth/register', async (req, res) => {
    const { name, email } = validateProfile(req.body);
    const password = String(req.body?.password ?? '');
    if (password.length < 6 || password.length > 128) throw new HttpError(400, 'Password must be 6–128 characters');
    let user;
    try {
      user = await repo.createUser({ name, email, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'User already exists');
      throw err;
    }
    await startSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  api.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const user = email ? await repo.findUserByEmail(email) : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password');
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await repo.deleteSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  // Guests get { user: null } (not 401), so the browser console stays clean on every page load
  api.get('/auth/me', async (req, res) => {
    const user = await currentUser(req);
    res.json({ user: user ? publicUser(user) : null });
  });

  // ---------- Profile ----------
  api.put('/users/me', requireAuth, async (req, res) => {
    const data = validateProfile(req.body);
    try {
      res.json({ user: publicUser(await repo.updateUser(req.user.id, data)) });
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'Email is already used by another account');
      throw err;
    }
  });

  api.put('/users/me/avatar', requireAuth, async (req, res) => {
    const avatar = req.body?.avatar;
    if (avatar !== null && (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 900_000)) {
      throw new HttpError(400, 'Avatar must be an image data URL up to ~600 KB');
    }
    res.json({ user: publicUser(await repo.updateAvatar(req.user.id, avatar)) });
  });

  api.get('/users/me/settings', requireAuth, async (req, res) => {
    res.json(await repo.getSettings(req.user.id));
  });

  api.put('/users/me/settings', requireAuth, async (req, res) => {
    const prev = await repo.getSettings(req.user.id);
    const theme = req.body?.theme ?? prev.theme;
    const units = req.body?.units ?? prev.units;
    const language = String(req.body?.language ?? prev.language).slice(0, 5);
    if (!['dark', 'light'].includes(theme)) throw new HttpError(400, 'theme must be dark or light');
    if (!['metric', 'imperial'].includes(units)) throw new HttpError(400, 'units must be metric or imperial');
    res.json(await repo.saveSettings(req.user.id, { theme, units, language }));
  });

  // ---------- Favorite cities ----------
  api.get('/favorites', requireAuth, async (req, res) => {
    res.json(await repo.listFavorites(req.user.id));
  });

  api.post('/favorites', requireAuth, async (req, res) => {
    const cityId = await repo.upsertCity(validateCity(req.body));
    await repo.addFavorite(req.user.id, cityId);
    res.status(201).json({ cityId });
  });

  api.delete('/favorites/:cityId', requireAuth, async (req, res) => {
    const cityId = Number(req.params.cityId);
    if (!Number.isInteger(cityId)) throw new HttpError(400, 'Invalid city id');
    if (!(await repo.removeFavorite(req.user.id, cityId))) throw new HttpError(404, 'Not in favorites');
    res.status(204).end();
  });

  // ---------- Search history ----------
  api.get('/history', requireAuth, async (req, res) => {
    res.json(await repo.listHistory(req.user.id, 10));
  });

  api.post('/history', requireAuth, async (req, res) => {
    const cityId = await repo.upsertCity(validateCity(req.body));
    await repo.addHistory(req.user.id, cityId);
    res.status(201).json({ cityId });
  });

  // ---------- OpenWeather proxy (the API key stays on the server) ----------
  api.get('/ow', async (req, res) => {
    const owPath = String(req.query.path || '');
    if (!OW_PATHS.has(owPath)) throw new HttpError(400, 'Unsupported OpenWeather path');
    if (!openWeatherKey) throw new HttpError(503, 'OPENWEATHER_KEY is not configured on the server');

    const url = new URL(OPENWEATHER_BASE + owPath);
    for (const k of OW_PARAMS) if (req.query[k] !== undefined) url.searchParams.set(k, String(req.query[k]));
    url.searchParams.set('appid', openWeatherKey);

    let upstream;
    try {
      upstream = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new HttpError(502, 'OpenWeather is unreachable');
    }
    const body = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(body);

    // Save current weather into WeatherSnapshots (does not block the response).
    if (owPath === '/data/2.5/weather' && upstream.ok && body?.main) {
      const lat = round4(Number(req.query.lat));
      const lon = round4(Number(req.query.lon));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        repo.upsertCity({ name: body.name || `${lat}, ${lon}`, country: body.sys?.country, lat, lon })
          .then((cityId) => repo.saveSnapshot(cityId, {
            tempC: round4(body.main.temp - 273.15),
            feelsLikeC: body.main.feels_like != null ? round4(body.main.feels_like - 273.15) : null,
            humidity: body.main.humidity ?? null,
            pressure: body.main.pressure ?? null,
            windSpeed: body.wind?.speed ?? null,
            description: body.weather?.[0]?.description ?? null,
            icon: body.weather?.[0]?.icon ?? null,
          }))
          .catch((err) => console.warn('Snapshot not saved:', err.message));
      }
    }
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- Frontend ----------
  // One canonical URL per page: /faq.html -> /faq, /index.html -> /
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.endsWith('.html')) {
      // collapse leading slashes so "//evil.com/x.html" can't become an off-site redirect
      const clean = req.path.replace(/^\/+/, '/').replace(/(index)?\.html$/, '');
      const qs = req.originalUrl.slice(req.path.length);
      return res.redirect(301, (clean || '/') + qs);
    }
    next();
  });
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  // ---------- Errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    const dbDown = ['ConnectionError', 'TransactionError'].includes(err.name) || ['ESOCKET', 'ELOGIN', 'ETIMEOUT'].includes(err.code);
    console.error(err);
    res.status(dbDown ? 503 : 500).json({ error: dbDown ? 'Database is unavailable' : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
