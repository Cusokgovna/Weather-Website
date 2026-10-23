// API and page tests on the in-memory repository (no SQL Server needed). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRepo } = require('../server/memoryRepo');
const { startServer, apiContract } = require('./helpers');

let ctx;
before(async () => { ctx = await startServer(createMemoryRepo({ demoData: true }), { siteUrl: 'https://kraken.example', ratesUrl: null }); });
after(() => ctx.close());

for (const [name, fn] of apiContract(() => ctx)) test(name, () => fn(assert));

test('API responses carry X-Robots-Tag; every response has security headers', async () => {
  const req = ctx.client();
  for (const path of ['/api/health', '/api/games', '/api/unknown']) {
    assert.equal((await req(path)).headers.get('x-robots-tag'), 'noindex, nofollow', path);
  }
  const page = await req('/');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
});

test('CSRF: POST from another site is rejected', async () => {
  const res = await fetch(`${ctx.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ login: 'demo', password: 'demo1234' }),
  });
  assert.equal(res.status, 403);
});

test('catalog: games and services with categories, search, sorting, paging', async () => {
  const req = ctx.client();
  const games = (await req('/api/games')).json;
  assert.equal(games.filter((g) => g.section === 'game').length, 16);
  assert.deepEqual(games.filter((g) => g.section === 'service').map((g) => g.slug), ['gift-cards', 'special-apps']);
  const stalzone = games.find((g) => g.slug === 'stalzone');
  assert.ok(stalzone.activeListings >= 2);

  const asc = (await req('/api/listings?game=stalzone&sort=price_asc')).json.items.map((l) => l.price);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.equal((await req('/api/listings?q=redline')).json.items[0].title, 'AK-47 | Redline (Field-Tested)', 'case-insensitive search');
  assert.ok((await req('/api/listings?q=stalzone')).json.total >= 2, 'search by game name');
  const page = (await req('/api/listings?limit=2&page=2')).json;
  assert.equal(page.items.length, 2);
  assert.equal(page.page, 2);
  assert.equal((await req('/api/listings/999999')).status, 404);
  assert.equal((await req('/api/users/nobody_here')).status, 404);
});

test('news and exchange rates', async () => {
  const req = ctx.client();
  assert.ok((await req('/api/news')).json.length >= 1);
  const rates = (await req('/api/rates')).json;
  assert.deepEqual(rates.map((r) => r.code).sort(), ['EUR', 'USD']);
});

test('exchange rates are refreshed from the CBR feed and saved', async () => {
  const repo = createMemoryRepo();
  const fakeCbr = async () => Response.json({ Valute: { USD: { Value: 90.5 }, EUR: { Value: 99.1 } } });
  const srv = await startServer(repo, { fetchImpl: fakeCbr, ratesUrl: 'https://cbr.test/daily.json' });
  try {
    await srv.client()('/api/rates');              // old values → starts the refresh
    await new Promise((r) => setTimeout(r, 30));
    const html = (await srv.client()('/')).text;   // next request reads fresh values... after the 60 s cache
    assert.ok(html.includes('Exchange rate'));
    const saved = await repo.getRates();
    assert.equal(saved.find((r) => r.code === 'USD').rate, 90.5);
  } finally {
    await srv.close();
  }
});

test('robots.txt closes private pages; sitemap.xml is built from the database', async () => {
  const req = ctx.client();
  const robots = await req('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type'), /text\/plain/);
  for (const p of ['/account', '/deals', '/chat', '/sell', '/login', '/api/']) assert.match(robots.text, new RegExp(`Disallow: ${p}`));
  assert.match(robots.text, /Sitemap: https:\/\/kraken\.example\/sitemap\.xml/);

  const sitemap = await req('/sitemap.xml');
  assert.match(sitemap.headers.get('content-type'), /xml/);
  for (const u of ['/', '/news', '/faq', '/games/stalzone', '/services/gift-cards', '/users/KrakenTrader']) {
    assert.ok(sitemap.text.includes(`<loc>https://kraken.example${u}</loc>`), u);
  }
  assert.match(sitemap.text, /<loc>https:\/\/kraken\.example\/listings\/\d+<\/loc>/);
  assert.doesNotMatch(sitemap.text, /account|login|chat/, 'closed pages are not in the sitemap');
});

const PUBLIC_PAGES = ['/', '/games/stalzone', '/services/gift-cards', '/categories', '/listings/1', '/users/KrakenTrader', '/news', '/faq', '/about', '/contacts', '/privacy', '/rules'];

test('public pages: lang, charset, viewport, own title and description, canonical, exactly one <h1>', async () => {
  const req = ctx.client();
  const titles = new Set();
  for (const path of PUBLIC_PAGES) {
    const r = await req(path);
    assert.equal(r.status, 200, path);
    assert.match(r.text, /<html lang="en">/, path);
    assert.match(r.text, /<meta charset="utf-8">/, path);
    assert.match(r.text, /<meta name="viewport"/, path);
    assert.match(r.text, /<meta name="description" content="[^"]{40,}"/, path);
    assert.match(r.text, /<link rel="canonical" href="https:\/\/kraken\.example\//, path);
    assert.doesNotMatch(r.text, /noindex/, path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, `${path}: one h1`);
    assert.match(r.text, /Exchange rate/, path);
    titles.add(r.text.match(/<title>(.*)<\/title>/)[1]);
  }
  assert.equal(titles.size, PUBLIC_PAGES.length, 'every page has its own title');
});

test('pages show data from the database', async () => {
  const req = ctx.client();
  const stalzone = (await req('/games/stalzone')).text;
  assert.match(stalzone, /Gauss Gun — Legendary/);
  assert.match(stalzone, /In-game items for cheap!/);
  assert.match((await req('/games/stalzone?category=accounts')).text, /No offers yet/);
  assert.equal((await req('/games/stalzone?category=nope')).status, 404);
  assert.equal((await req('/games/gift-cards')).status, 404, 'services live under /services/');
  assert.match((await req('/listings/1')).text, /24 490 ₽/);
  assert.match((await req('/users/KrakenTrader')).text, /Account information/);
  assert.match((await req('/news')).text, /Kraken Shop is open!/);
  const search = await req('/search?q=gauss');
  assert.match(search.text, /noindex/);
  assert.match(search.text, /Gauss Gun — Epic/);
});

test('user input is escaped in pages (no XSS)', async () => {
  const req = ctx.client();
  await req('/api/auth/register', { method: 'POST', body: { username: 'xss_tester', email: 'xss@example.com', password: 'secret123' } });
  const games = (await req('/api/games')).json;
  const categoryId = games[0].categories[0].categoryId;
  const { listingId } = (await req('/api/listings', { method: 'POST', body: { categoryId, title: '<script>alert(1)</script>', description: '"><img src=x onerror=alert(1)>', price: 10, quantity: 1 } })).json;
  const html = (await req(`/listings/${listingId}`)).text;
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('private pages redirect guests to the login page and are noindex', async () => {
  const guest = ctx.client();
  for (const path of ['/account', '/deals', '/chat', '/chat/1', '/sell']) {
    const r = await guest(path);
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(path)}`);
  }
  const login = await guest('/login?next=//evil.com');
  assert.match(login.text, /<meta name="robots" content="noindex">/);
  assert.match(login.text, /data-next="\/"/, 'no open redirect through ?next=');

  const user = ctx.client();
  await user('/api/auth/login', { method: 'POST', body: { login: 'demo', password: 'demo1234' } });
  for (const path of ['/account', '/deals', '/deals?role=seller', '/chat', '/sell']) {
    const r = await user(path);
    assert.equal(r.status, 200, path);
    assert.match(r.text, /<meta name="robots" content="noindex">/, path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, `${path}: one h1`);
  }
  assert.equal((await user('/login')).headers.get('location'), '/account', 'logged-in user skips the login page');
  assert.equal((await user('/sell?id=999999')).status, 404);
});

test('clean URLs: .html redirects, unknown pages return the 404 page', async () => {
  const req = ctx.client();
  let r = await req('/faq.html');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/faq');
  r = await req('//evil.com/x.html');
  assert.equal(r.headers.get('location'), '/evil.com/x', 'no open redirect');
  r = await req('/no-such-page');
  assert.equal(r.status, 404);
  assert.match(r.text, /noindex/);
  assert.match(r.text, /Page not found/);
  assert.equal((await req('/listings/999999')).status, 404);
  assert.equal((await req('/users/nobody_here')).status, 404);
});
