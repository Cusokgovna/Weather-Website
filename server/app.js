// Express application: JSON API (/api/*), server-rendered pages (views.js) and static files (/public).
// createApp() does not listen on a port and does not connect to the DB by itself,
// so tests can create it with an in-memory repository.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  SESSION_COOKIE, SESSION_TTL_MS, hashPassword, verifyPassword, newSessionToken, hashToken, parseCookies,
} = require('./auth');
const views = require('./views');
const { createRates } = require('./rates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const SPECIAL_CODE_RE = /^\d{4,12}$/;
// Only raster images: an SVG served from our own origin could carry a script
const IMAGE_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const SORTS = ['new', 'price_asc', 'price_desc'];
const PAGE_SIZE = 12;

// Error numbers thrown by stored procedures (database/03_procedures.sql) → HTTP status
const DOMAIN_STATUS = { 50001: 409, 50002: 400, 50003: 409, 50004: 409, 50005: 404, 50006: 409, 50007: 400 };

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const publicUser = (u) => ({
  id: u.id, username: u.username, email: u.email, realName: u.realName || null,
  avatar: u.avatar || null, balance: u.balance, specialCodeEnabled: !!u.specialCodeHash,
});
const toInt = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : NaN);
const money = (v) => Math.round(Number(v) * 100) / 100;
// Only local paths for ?next= (no open redirect to another site)
const safeNext = (v) => (typeof v === 'string' && /^\/(?!\/)[^\\]*$/.test(v) ? v : '/');

function validateImage(v, maxLength, what) {
  if (v == null) return null;
  if (typeof v !== 'string' || !IMAGE_RE.test(v) || v.length > maxLength) {
    throw new HttpError(400, `${what} must be a PNG, JPEG, WEBP or GIF picture up to ~${Math.round(maxLength * 0.75 / 1024)} KB`);
  }
  return v;
}

function validateAccount(body) {
  const username = String(body?.username ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Nickname: 3–32 characters, Latin letters, digits and _');
  if (!EMAIL_RE.test(email) || email.length > 255) throw new HttpError(400, 'Invalid email');
  return { username, email };
}

function validateListing(body) {
  const title = String(body?.title ?? '').trim();
  const description = String(body?.description ?? '').trim();
  const price = money(body?.price);
  const quantity = Number(body?.quantity);
  if (title.length < 3 || title.length > 120) throw new HttpError(400, 'Title: 3 to 120 characters');
  if (description.length > 2000) throw new HttpError(400, 'Description: up to 2000 characters');
  if (!(price >= 1 && price <= 10_000_000)) throw new HttpError(400, 'Price: from 1 to 10 000 000 RUB');
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) throw new HttpError(400, 'Quantity: a whole number from 0 to 100 000');
  return { title, description: description || null, price, quantity };
}

function createApp({
  repo, cookieSecure = false, siteUrl = 'https://example.com', publicDir = path.join(__dirname, '..', 'public'),
  fetchImpl = fetch, ratesUrl,
}) {
  const app = express();
  app.disable('x-powered-by');
  const rates = createRates({ repo, fetchImpl, ...(ratesUrl !== undefined && { url: ratesUrl }) });

  // ---------- Security headers on every response ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "img-src 'self' data:", "style-src 'self' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com', "script-src 'self'", "connect-src 'self'",
        "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  // ---------- SEO: API responses must never be indexed ----------
  app.use('/api', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    next();
  });
  // CSRF: browsers send Origin on cross-site POST/PUT/DELETE — reject requests from other sites
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = null; }
      if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));

  // ---------- Session helpers ----------
  async function currentUser(req) {
    if (req.user !== undefined) return req.user;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.user = token ? await repo.findSessionUser(hashToken(token)) : null;
    return req.user;
  }

  async function requireAuth(req, res, next) {
    if (!(await currentUser(req))) return next(new HttpError(401, 'Please log in'));
    next();
  }

  async function startSession(res, user) {
    const token = newSessionToken();
    await repo.createSession(user.id, hashToken(token), new Date(Date.now() + SESSION_TTL_MS));
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: SESSION_TTL_MS, path: '/' });
  }

  // Conversation / order are visible only to their buyer and seller (no IDOR)
  async function loadConversationFor(req) {
    const id = toInt(req.params.id);
    const c = Number.isNaN(id) ? null : await repo.getConversation(id);
    if (!c || (c.buyer.userId !== req.user.id && c.seller.userId !== req.user.id)) throw new HttpError(404, 'Chat not found');
    return c;
  }
  async function loadOrderFor(req) {
    const id = toInt(req.params.id);
    const order = Number.isNaN(id) ? null : await repo.getOrder(id);
    if (!order || (order.buyer.userId !== req.user.id && order.seller.userId !== req.user.id)) throw new HttpError(404, 'Order not found');
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
    if (password.length < 6 || password.length > 128) throw new HttpError(400, 'Password: 6 to 128 characters');
    let user;
    try {
      user = await repo.createUser({ username, email, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (err.code === 'USERNAME_TAKEN') throw new HttpError(409, 'This nickname is already taken');
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'An account with this email already exists');
      throw err;
    }
    await startSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  // "User Name" accepts a nickname or an email; "Special code" is checked only if the user turned it on
  api.post('/auth/login', async (req, res) => {
    const login = String(req.body?.login ?? req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const specialCode = String(req.body?.specialCode ?? '').trim();
    const user = login ? await repo.findUserByLogin(login.includes('@') ? login.toLowerCase() : login) : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Wrong user name or password');
    if (user.specialCodeHash) {
      if (!specialCode) throw new HttpError(401, 'Enter your special code', 'SPECIAL_CODE_REQUIRED');
      if (!(await verifyPassword(specialCode, user.specialCodeHash))) throw new HttpError(401, 'Wrong special code', 'SPECIAL_CODE_REQUIRED');
    }
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
    const realName = String(req.body?.realName ?? '').trim();
    if (realName.length > 100) throw new HttpError(400, 'Real name: up to 100 characters');
    try {
      res.json({ user: publicUser(await repo.updateUser(req.user.id, { ...data, realName: realName || null })) });
    } catch (err) {
      if (err.code === 'USERNAME_TAKEN') throw new HttpError(409, 'This nickname is already taken');
      if (err.code === 'EMAIL_TAKEN') throw new HttpError(409, 'This email is already used');
      throw err;
    }
  });

  api.put('/users/me/avatar', requireAuth, async (req, res) => {
    const avatar = validateImage(req.body?.avatar, 450_000, 'Avatar');
    res.json({ user: publicUser(await repo.updateAvatar(req.user.id, avatar)) });
  });

  api.put('/users/me/special-code', requireAuth, async (req, res) => {
    if (!(await verifyPassword(String(req.body?.password ?? ''), req.user.passwordHash))) throw new HttpError(403, 'Wrong current password');
    const code = String(req.body?.code ?? '').trim();
    if (code && !SPECIAL_CODE_RE.test(code)) throw new HttpError(400, 'Special code: 4 to 12 digits');
    await repo.setSpecialCode(req.user.id, code ? await hashPassword(code) : null);
    res.json({ specialCodeEnabled: !!code });
  });

  // Public profile: rating, reviews, active offers
  api.get('/users/:username', async (req, res) => {
    const profile = await repo.getSellerProfile(String(req.params.username));
    if (!profile) throw new HttpError(404, 'User not found');
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
    if (!listing) throw new HttpError(404, 'Offer not found');
    res.json(listing);
  });

  async function validCategory(body) {
    const categoryId = toInt(body?.categoryId);
    if (Number.isNaN(categoryId) || !(await repo.getCategory(categoryId))) throw new HttpError(400, 'Choose a game and a category');
    return categoryId;
  }

  api.post('/listings', requireAuth, async (req, res) => {
    const categoryId = await validCategory(req.body);
    const data = validateListing(req.body);
    if (data.quantity < 1) throw new HttpError(400, 'Quantity must be at least 1');
    const image = validateImage(req.body?.image, 600_000, 'Picture');
    const listingId = await repo.createListing(req.user.id, { categoryId, ...data, image });
    res.status(201).json({ listingId });
  });

  api.put('/listings/:id', requireAuth, async (req, res) => {
    const id = toInt(req.params.id);
    const categoryId = await validCategory(req.body);
    const data = validateListing(req.body);
    const status = req.body?.status === 'closed' ? 'closed' : 'active';
    // image: absent = keep the old one, null = remove, data URL = replace
    const image = req.body?.image === undefined ? undefined : validateImage(req.body.image, 600_000, 'Picture');
    if (Number.isNaN(id) || !(await repo.updateListing(id, req.user.id, { categoryId, ...data, status, image }))) throw new HttpError(404, 'Offer not found');
    res.json(await repo.getListing(id));
  });

  api.get('/my/listings', requireAuth, async (req, res) => {
    const { items } = await repo.searchListings({ sellerId: req.user.id, status: null, limit: 100 });
    res.json(items);
  });

  // ---------- Chats («TO CHAT», «CALL SUPPORT») ----------
  api.post('/conversations', requireAuth, async (req, res) => {
    const listingId = toInt(req.body?.listingId);
    if (Number.isNaN(listingId)) throw new HttpError(400, 'Invalid offer');
    res.status(201).json({ conversationId: await repo.getOrCreateConversation(listingId, req.user.id) });
  });

  api.get('/conversations', requireAuth, async (req, res) => {
    res.json(await repo.listConversations(req.user.id));
  });

  api.get('/conversations/:id', requireAuth, async (req, res) => {
    const c = await loadConversationFor(req);
    const [orders, messages] = await Promise.all([repo.listConversationOrders(c.conversationId), repo.listMessages(c.conversationId)]);
    res.json({ ...c, role: c.buyer.userId === req.user.id ? 'buyer' : 'seller', orders, messages });
  });

  // ?after=<last message id> — the chat page polls only new messages
  api.get('/conversations/:id/messages', requireAuth, async (req, res) => {
    const c = await loadConversationFor(req);
    res.json(await repo.listMessages(c.conversationId, toInt(req.query.after) || 0));
  });

  api.post('/conversations/:id/messages', requireAuth, async (req, res) => {
    const c = await loadConversationFor(req);
    const text = String(req.body?.text ?? '').trim();
    const attachment = validateImage(req.body?.attachment, 600_000, 'Attachment');
    if (text.length > 1000) throw new HttpError(400, 'Message: up to 1000 characters');
    if (!text && !attachment) throw new HttpError(400, 'Write a message or attach a picture');
    await repo.addMessage(c.conversationId, req.user.id, text || null, attachment);
    res.status(201).json(await repo.listMessages(c.conversationId, toInt(req.body?.after) || 0));
  });

  api.post('/conversations/:id/support', requireAuth, async (req, res) => {
    const c = await loadConversationFor(req);
    await repo.requestSupport(c.conversationId);
    res.json(await repo.getConversation(c.conversationId));
  });

  // ---------- Orders (deals) ----------
  api.post('/orders', requireAuth, async (req, res) => {
    const listingId = toInt(req.body?.listingId);
    const quantity = toInt(req.body?.quantity ?? 1);
    if (Number.isNaN(listingId) || Number.isNaN(quantity)) throw new HttpError(400, 'Invalid offer or quantity');
    res.status(201).json(await repo.createOrder(req.user.id, listingId, quantity));
  });

  api.get('/my/orders', requireAuth, async (req, res) => {
    res.json(await repo.listOrders(req.user.id, req.query.role === 'seller' ? 'seller' : 'buyer'));
  });

  api.get('/orders/:id', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    res.json({ ...order, role: order.buyer.userId === req.user.id ? 'buyer' : 'seller' });
  });

  api.post('/orders/:id/confirm', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Only the buyer can confirm delivery');
    await repo.completeOrder(order.orderId, req.user.id);
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/refund', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.seller.userId !== req.user.id) throw new HttpError(403, 'Only the seller can refund');
    await repo.refundOrder(order.orderId, req.user.id);
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/dispute', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Only the buyer can open a dispute');
    if (!(await repo.disputeOrder(order.orderId, req.user.id))) throw new HttpError(409, 'A dispute can be opened only for a paid order');
    res.json(await repo.getOrder(order.orderId));
  });

  api.post('/orders/:id/review', requireAuth, async (req, res) => {
    const order = await loadOrderFor(req);
    if (order.buyer.userId !== req.user.id) throw new HttpError(403, 'Only the buyer leaves a review');
    if (order.status !== 'completed') throw new HttpError(409, 'You can leave a review after the deal is completed');
    const rating = toInt(req.body?.rating);
    const text = String(req.body?.text ?? '').trim();
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Rating: from 1 to 5');
    if (text.length > 1000) throw new HttpError(400, 'Review: up to 1000 characters');
    try {
      await repo.addReview(order.orderId, req.user.id, order.seller.userId, rating, text || null);
    } catch (err) {
      if (err.code === 'REVIEW_EXISTS') throw new HttpError(409, 'You already left a review for this deal');
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

  // ---------- News & rates ----------
  api.get('/news', async (req, res) => res.json(await repo.listNews(50)));
  api.get('/rates', async (req, res) => res.json(await rates.get()));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- Images stored in the database (data URLs) ----------
  function sendDataUrl(res, dataUrl, maxAge) {
    const m = dataUrl && IMAGE_RE.exec(dataUrl);
    if (!m) return false;
    res.set('Cache-Control', `public, max-age=${maxAge}`).type(m[1]).send(Buffer.from(m[2], 'base64'));
    return true;
  }
  app.get('/img/listings/:id', async (req, res) => {
    const id = toInt(req.params.id);
    // the URL carries ?v=<updated time>, so the picture can be cached for a day
    if (Number.isNaN(id) || !sendDataUrl(res, await repo.getListingImage(id), 86400)) res.status(404).end();
  });
  app.get('/img/avatars/:username', async (req, res) => {
    if (!sendDataUrl(res, await repo.getAvatar(String(req.params.username)), 60)) res.redirect(302, '/img/user.svg');
  });

  // ---------- SEO: robots.txt with the real site address in the Sitemap line ----------
  app.get('/robots.txt', (req, res, next) => {
    fs.readFile(path.join(publicDir, 'robots.txt'), 'utf8', (err, text) => {
      if (err) return next(err);
      res.type('text/plain').send(text.replace(/https:\/\/example\.com/g, siteUrl));
    });
  });

  // ---------- SEO: sitemap.xml is generated from the database ----------
  app.get('/sitemap.xml', async (req, res) => {
    const [games, listings] = await Promise.all([repo.listGames(), repo.searchListings({ limit: 5000 })]);
    const sellers = [...new Set(listings.items.map((l) => l.seller.username))];
    const urls = [
      '/', '/categories', '/news', '/faq', '/about', '/contacts', '/privacy', '/rules',
      ...games.map(views.catalogUrl),
      ...listings.items.map((l) => `/listings/${l.listingId}`),
      ...sellers.map((u) => `/users/${encodeURIComponent(u)}`),
    ];
    res.type('application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map((u) => `  <url><loc>${siteUrl}${u}</loc></url>`).join('\n')
      + '\n</urlset>\n',
    );
  });

  // ---------- Pages ----------
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

  async function pageContext(req) {
    const [user, games, rateList] = await Promise.all([currentUser(req), repo.listGames(), rates.get()]);
    return { user, games, rates: rateList, siteUrl };
  }
  const send = (res, doc, status = 200) => res.status(status).type('html').send(doc.toString());
  const notFound = async (req, res) => send(res, views.notFound(await pageContext(req)), 404);

  // Private pages: guests go to the login page and come back after it
  const privatePage = (render) => async (req, res) => {
    if (!(await currentUser(req))) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    return render(req, res);
  };

  const page = express.Router();

  page.get('/', async (req, res) => {
    const ctx = await pageContext(req);
    const { items } = await repo.searchListings({ limit: 5, sort: 'new' });
    send(res, views.home(ctx, { offers: items }));
  });

  async function catalogPage(req, res, section) {
    const ctx = await pageContext(req);
    const game = ctx.games.find((g) => g.slug === req.params.slug && g.section === section);
    const category = req.query.category ? String(req.query.category) : undefined;
    if (!game || (category && !game.categories.some((c) => c.slug === category))) return notFound(req, res);
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'new';
    const pageNo = Math.max(toInt(req.query.page) || 1, 1);
    const result = await repo.searchListings({ game: game.slug, category, sort, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE });
    send(res, views.catalog(ctx, { game, category, sort, page: pageNo, result, limit: PAGE_SIZE }));
  }
  page.get('/games/:slug', (req, res) => catalogPage(req, res, 'game'));
  page.get('/services/:slug', (req, res) => catalogPage(req, res, 'service'));

  page.get('/categories', async (req, res) => send(res, views.categories(await pageContext(req))));

  page.get('/search', async (req, res) => {
    const ctx = await pageContext(req);
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const result = q ? await repo.searchListings({ q, limit: 50 }) : { items: [], total: 0 };
    send(res, views.search(ctx, { q, result }));
  });

  page.get('/listings/:id', async (req, res) => {
    const id = toInt(req.params.id);
    const l = Number.isNaN(id) ? null : await repo.getListing(id);
    if (!l) return notFound(req, res);
    send(res, views.listing(await pageContext(req), { l }));
  });

  page.get('/users/:username', async (req, res) => {
    const profile = await repo.getSellerProfile(String(req.params.username));
    if (!profile) return notFound(req, res);
    const [ctx, listings, reviews] = await Promise.all([
      pageContext(req), repo.searchListings({ sellerId: profile.userId, limit: 50 }), repo.listReviews(profile.userId, 20),
    ]);
    send(res, views.userPage(ctx, { profile, listings: listings.items, reviews }));
  });

  for (const mode of ['login', 'register']) {
    page.get(`/${mode}`, async (req, res) => {
      if (await currentUser(req)) return res.redirect(302, safeNext(req.query.next) === '/' ? '/account' : safeNext(req.query.next));
      send(res, views.authPage(await pageContext(req), mode, safeNext(req.query.next)));
    });
  }

  page.get('/account', privatePage(async (req, res) => {
    const me = req.user;
    const profile = await repo.getSellerProfile(me.username);
    const [ctx, listings, reviews, transactions] = await Promise.all([
      pageContext(req), repo.searchListings({ sellerId: me.id, status: null, limit: 100 }),
      repo.listReviews(me.id, 20), repo.listTransactions(me.id, 50),
    ]);
    send(res, views.account(ctx, { profile, listings: listings.items, reviews, transactions }));
  }));

  page.get('/sell', privatePage(async (req, res) => {
    const ctx = await pageContext(req);
    let l = null;
    if (req.query.id) {
      const id = toInt(req.query.id);
      l = Number.isNaN(id) ? null : await repo.getListing(id);
      if (!l || l.seller.userId !== req.user.id) return notFound(req, res);
    }
    send(res, views.sell(ctx, { games: ctx.games, l }));
  }));

  page.get('/deals', privatePage(async (req, res) => {
    const role = req.query.role === 'seller' ? 'seller' : 'buyer';
    const [ctx, orders] = await Promise.all([pageContext(req), repo.listOrders(req.user.id, role)]);
    send(res, views.deals(ctx, { role, orders }));
  }));

  page.get('/chat', privatePage(async (req, res) => {
    const [ctx, conversations] = await Promise.all([pageContext(req), repo.listConversations(req.user.id)]);
    send(res, views.chats(ctx, { conversations }));
  }));

  page.get('/chat/:id', privatePage(async (req, res) => {
    let c;
    try { c = await loadConversationFor(req); } catch { return notFound(req, res); }
    const [ctx, orders, listing] = await Promise.all([
      pageContext(req), repo.listConversationOrders(c.conversationId), repo.getListing(c.listing.listingId),
    ]);
    send(res, views.chat(ctx, { c, orders, listing }));
  }));

  page.get('/news', async (req, res) => {
    const [ctx, items] = await Promise.all([pageContext(req), repo.listNews(50)]);
    send(res, views.news(ctx, { items }));
  });

  for (const key of Object.keys(views.TEXT_PAGES)) {
    page.get(`/${key}`, async (req, res) => send(res, views.textPage(await pageContext(req), key)));
  }

  app.use(page);
  app.use(express.static(publicDir, { maxAge: '1h' }));
  app.use(notFound);

  // ---------- Errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    const isApi = req.path.startsWith('/api/');
    let status = 500;
    let message = 'Internal server error';
    if (err.type === 'entity.too.large') [status, message] = [413, 'Request is too large'];
    else if (err.type === 'entity.parse.failed') [status, message] = [400, 'Invalid JSON'];
    else if (err instanceof HttpError) [status, message] = [err.status, err.message];
    else if (DOMAIN_STATUS[err.number]) [status, message] = [DOMAIN_STATUS[err.number], err.message];
    else {
      const dbDown = ['ConnectionError', 'TransactionError'].includes(err.name) || ['ESOCKET', 'ELOGIN', 'ETIMEOUT'].includes(err.code);
      if (dbDown) [status, message] = [503, 'Database is unavailable'];
      console.error(err);
    }
    if (isApi) return res.status(status).json({ error: message, ...(err.code && err instanceof HttpError && { code: err.code }) });
    // A page failed (usually the database is down): render the error page without DB data
    res.status(status).type('html').send(views.errorPage({ user: null, games: [], rates: [], siteUrl }).toString());
  });

  return app;
}

module.exports = { createApp };
