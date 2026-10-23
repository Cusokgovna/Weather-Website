// Express application: JSON API (/api/*) + pages from /public.
// createApp() does not listen on a port and does not connect to the DB by itself,
// so tests can create it with an in-memory repository.
const path = require('node:path');
const express = require('express');
const {
  SESSION_COOKIE, SESSION_TTL_MS, hashPassword, verifyPassword, newSessionToken, hashToken, parseCookies,
} = require('./auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const SORTS = ['new', 'price_asc', 'price_desc'];

// Error numbers thrown by stored procedures (database/03_procedures.sql) → HTTP status
const DOMAIN_STATUS = { 50001: 409, 50002: 400, 50003: 409, 50004: 409, 50005: 404, 50006: 409, 50007: 400 };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, avatar: u.avatar || null, balance: u.balance });
const toInt = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : NaN);
const money = (v) => Math.round(Number(v) * 100) / 100;

function validateAccount(body) {
  const username = String(body?.username ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Логин: 3–32 символа, латинские буквы, цифры и _');
  if (!EMAIL_RE.test(email) || email.length > 255) throw new HttpError(400, 'Некорректный email');
  return { username, email };
}

function validateListing(body) {
  const title = String(body?.title ?? '').trim();
  const description = String(body?.description ?? '').trim();
  const price = money(body?.price);
  const quantity = Number(body?.quantity);
  if (title.length < 3 || title.length > 120) throw new HttpError(400, 'Название: от 3 до 120 символов');
  if (description.length > 2000) throw new HttpError(400, 'Описание: не больше 2000 символов');
  if (!(price >= 1 && price <= 10_000_000)) throw new HttpError(400, 'Цена: от 1 до 10 000 000 ₽');
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) throw new HttpError(400, 'Количество: целое число от 0 до 100 000');
  return { title, description: description || null, price, quantity };
}

function createApp({ repo, cookieSecure = false, siteUrl = 'https://example.com', publicDir = path.join(__dirname, '..', 'public') }) {
  const app = express();
  app.disable('x-powered-by');
  const page = (name) => path.join(publicDir, name);
  const notFoundPage = (res) => res.status(404).sendFile(page('404.html'));

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
    if (!(await currentUser(req))) return next(new HttpError(401, 'Нужно войти в аккаунт'));
    next();
  }

  async function startSession(res, user) {
    const token = newSessionToken();
    await repo.createSession(user.id, hashToken(token), new Date(Date.now() + SESSION_TTL_MS));
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: SESSION_TTL_MS, path: '/' });
  }

  // Order is visible only to its buyer and seller
  async function loadOrderFor(req) {
    const orderId = toInt(req.params.id);
    const order = Number.isNaN(orderId) ? null : await repo.getOrder(orderId);
    if (!order || (order.buyer.userId !== req.user.id && order.seller.userId !== req.user.id)) throw new HttpError(404, 'Сделка не найдена');
    return order;
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
    const { username, email } = validateAccount(req.body);
    const password = String(req.body?.password ?? '');
    if (password.length < 6 || password.length > 128) throw new HttpError(400, 'Пароль: от 6 до 128 символов');
    let user;
    try {
      user = await repo.createUser({ username, email, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (err.code === 'USERNAME_TAKEN') throw new HttpError(409, 'Этот логин уже занят');
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'Аккаунт с таким email уже есть');
      throw err;
    }
    await startSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  api.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const user = email ? await repo.findUserByEmail(email) : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Неверный email или пароль');
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
    const data = validateAccount(req.body);
    try {
      res.json({ user: publicUser(await repo.updateUser(req.user.id, data)) });
    } catch (err) {
      if (err.code === 'USERNAME_TAKEN') throw new HttpError(409, 'Этот логин уже занят');
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'Этот email уже используется');
      throw err;
    }
  });

  api.put('/users/me/avatar', requireAuth, async (req, res) => {
    const avatar = req.body?.avatar;
    if (avatar !== null && (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 900_000)) {
      throw new HttpError(400, 'Аватар должен быть картинкой до ~600 КБ');
    }
    res.json({ user: publicUser(await repo.updateAvatar(req.user.id, avatar)) });
  });

  // Public seller profile: rating, reviews, active listings
  api.get('/users/:username', async (req, res) => {
    const profile = await repo.getSellerProfile(String(req.params.username));
    if (!profile) throw new HttpError(404, 'Пользователь не найден');
    const [reviews, listings] = await Promise.all([
      repo.listReviews(profile.userId, 20),
      repo.searchListings({ sellerId: profile.userId, limit: 50 }),
    ]);
    res.json({ ...profile, reviews, listings: listings.items });
  });

  // ---------- Catalog ----------
  api.get('/games', async (req, res) => {
    res.json(await repo.listGames());
  });

  api.get('/listings', async (req, res) => {
    const limit = Math.min(toInt(req.query.limit) || 24, 100);
    const page = Math.max(toInt(req.query.page) || 1, 1);
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'new';
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const result = await repo.searchListings({
      game: req.query.game ? String(req.query.game) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      q: q || undefined,
      sort,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ ...result, page, limit });
  });

  api.get('/listings/:id', async (req, res) => {
    const id = toInt(req.params.id);
    const listing = Number.isNaN(id) ? null : await repo.getListing(id);
    if (!listing) throw new HttpError(404, 'Лот не найден');
    res.json(listing);
  });

  api.post('/listings', requireAuth, async (req, res) => {
    const categoryId = toInt(req.body?.categoryId);
    if (Number.isNaN(categoryId) || !(await repo.getCategory(categoryId))) throw new HttpError(400, 'Выберите игру и раздел');
    const data = validateListing(req.body);
    if (data.quantity < 1) throw new HttpError(400, 'Количество должно быть не меньше 1');
    const listingId = await repo.createListing(req.user.id, { categoryId, ...data });
    res.status(201).json({ listingId });
  });

  api.put('/listings/:id', requireAuth, async (req, res) => {
    const id = toInt(req.params.id);
    const data = validateListing(req.body);
    const status = req.body?.status === 'closed' ? 'closed' : 'active';
    if (Number.isNaN(id) || !(await repo.updateListing(id, req.user.id, { ...data, status }))) throw new HttpError(404, 'Лот не найден');
    res.json(await repo.getListing(id));
  });

  api.get('/my/listings', requireAuth, async (req, res) => {
    const { items } = await repo.searchListings({ sellerId: req.user.id, status: null, limit: 100 });
    res.json(items);
  });

  // ---------- Orders (deals) ----------
  api.post('/orders', requireAuth, async (req, res) => {
    const listingId = toInt(req.body?.listingId);
    const quantity = toInt(req.body?.quantity ?? 1);
    if (Number.isNaN(listingId) || Number.isNaN(quantity)) throw new HttpError(400, 'Неверный лот или количество');
    const orderId = await repo.createOrder(req.user.id, listingId, quantity);
    res.status(201).json({ orderId });
  });

  api.get('/my/orders', requireAuth, async (req, res) => {
    res.json(await repo.listOrders(req.user.id, req.query.role === 'seller' ? 'seller' : 'buyer'));
  });

  api.get('/orders/:id', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    res.json({ ...order, messages: await repo.listMessages(order.orderId), role: order.buyer.userId === req.user.id ? 'buyer' : 'seller' });
  });

  api.post('/orders/:id/confirm', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Подтвердить получение может только покупатель');
    await repo.completeOrder(order.orderId, req.user.id);
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/refund', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.seller.userId !== req.user.id) throw new HttpError(403, 'Вернуть деньги может только продавец');
    await repo.refundOrder(order.orderId, req.user.id);
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/dispute', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Открыть спор может только покупатель');
    if (!(await repo.disputeOrder(order.orderId, req.user.id))) throw new HttpError(409, 'Спор можно открыть только по оплаченной сделке');
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/messages', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    const text = String(req.body?.text ?? '').trim();
    if (!text || text.length > 1000) throw new HttpError(400, 'Сообщение: от 1 до 1000 символов');
    await repo.addMessage(order.orderId, req.user.id, text);
    res.status(201).json(await repo.listMessages(order.orderId));
  });

  api.post('/orders/:id/review', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Отзыв оставляет покупатель');
    if (order.status !== 'completed') throw new HttpError(409, 'Отзыв можно оставить после завершения сделки');
    const rating = toInt(req.body?.rating);
    const text = String(req.body?.text ?? '').trim();
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Оценка: от 1 до 5');
    if (text.length > 1000) throw new HttpError(400, 'Отзыв: не больше 1000 символов');
    try {
      await repo.addReview(order.orderId, req.user.id, order.seller.userId, rating, text || null);
    } catch (err) {
      if (err.code === 'REVIEW_EXISTS') throw new HttpError(409, 'Отзыв по этой сделке уже оставлен');
      throw err;
    }
    res.status(201).json({ ok: true });
  });

  // ---------- Wallet ----------
  api.get('/wallet', requireAuth, async (req, res) => {
    const user = await repo.findUserById(req.user.id);
    res.json({ balance: user.balance, transactions: await repo.listTransactions(req.user.id, 50) });
  });

  // Demo top-up: there is no real payment provider in this project
  api.post('/wallet/deposit', requireAuth, async (req, res) => {
    const amount = money(req.body?.amount);
    res.json({ balance: await repo.deposit(req.user.id, Number.isFinite(amount) ? amount : 0) });
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- SEO: sitemap.xml is generated from the database ----------
  app.get('/sitemap.xml', async (req, res) => {
    const [games, listings] = await Promise.all([repo.listGames(), repo.searchListings({ limit: 5000 })]);
    const urls = [
      `${siteUrl}/`, `${siteUrl}/faq`,
      ...games.map((g) => `${siteUrl}/games/${g.slug}`),
      ...listings.items.map((l) => `${siteUrl}/listings/${l.listingId}`),
    ];
    res.type('application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')
      + '\n</urlset>\n',
    );
  });

  // ---------- Pages with readable URLs ----------
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

  app.get('/games/:slug', async (req, res) => {
    const games = await repo.listGames();
    if (!games.some((g) => g.slug === req.params.slug)) return notFoundPage(res);
    res.sendFile(page('catalog.html'));
  });
  app.get('/listings/:id', async (req, res) => {
    const id = toInt(req.params.id);
    if (Number.isNaN(id) || !(await repo.getListing(id))) return notFoundPage(res);
    res.sendFile(page('listing.html'));
  });
  app.get('/users/:username', async (req, res) => {
    if (!(await repo.getSellerProfile(String(req.params.username)))) return notFoundPage(res);
    res.sendFile(page('user.html'));
  });
  app.get('/orders/:id', (req, res) => res.sendFile(page('order.html')));

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));
  app.use((req, res) => notFoundPage(res));

  // ---------- Errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (DOMAIN_STATUS[err.number]) return res.status(DOMAIN_STATUS[err.number]).json({ error: err.message });
    const dbDown = ['ConnectionError', 'TransactionError'].includes(err.name) || ['ESOCKET', 'ELOGIN', 'ETIMEOUT'].includes(err.code);
    console.error(err);
    res.status(dbDown ? 503 : 500).json({ error: dbDown ? 'База данных недоступна' : 'Внутренняя ошибка сервера' });
  });

  return app;
}

module.exports = { createApp };
