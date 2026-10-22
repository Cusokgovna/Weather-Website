// API tests on the in-memory repository (no SQL Server needed). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRepo } = require('../server/memoryRepo');
const { startServer, apiContract } = require('./helpers');

let ctx;
let repo;
before(async () => { repo = createMemoryRepo(); ctx = await startServer(repo); });
after(() => ctx.close());

for (const [name, fn] of apiContract(test, () => ctx)) test(name, () => fn(assert));

test('API responses carry X-Robots-Tag: noindex, nofollow', async () => {
  const r = await ctx.client()('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await ctx.client()('/api/unknown')).headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('OpenWeather proxy hides the key and saves a weather snapshot', async () => {
  const req = ctx.client();
  let r = await req('/api/ow?path=/data/2.5/weather&lat=55.0282171&lon=82.9234509');
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Novosibirsk');
  await new Promise((res) => setTimeout(res, 20)); // snapshot is saved in background
  const snap = repo._db.snapshots.at(-1);
  assert.equal(snap.tempC, 5);
  assert.equal(snap.description, 'clear sky');

  r = await req('/api/ow?path=/data/3.0/onecall&lat=1&lon=1');
  assert.equal(r.status, 400, 'only whitelisted OpenWeather paths');
});

test('proxy reports a missing API key', async () => {
  const noKey = await startServer(createMemoryRepo(), { openWeatherKey: '' });
  try {
    const r = await noKey.client()('/api/ow?path=/data/2.5/weather&lat=1&lon=1');
    assert.equal(r.status, 503);
  } finally {
    await noKey.close();
  }
});

test('robots.txt and sitemap.xml are served as files, not as the home page', async () => {
  const req = ctx.client();
  const robots = await req('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type'), /text\/plain/);
  assert.match(robots.text, /Disallow: \/profile/);
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);

  const sitemap = await req('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /xml/);
  assert.match(sitemap.text, /<loc>https:\/\/example\.com\/<\/loc>/);
  assert.match(sitemap.text, /<loc>https:\/\/example\.com\/faq<\/loc>/);
  assert.doesNotMatch(sitemap.text, /profile/, 'closed pages are not in the sitemap');
});

test('pages: lang, title, description, exactly one <h1>; profile is noindex', async () => {
  const req = ctx.client();
  const titles = new Set();
  for (const path of ['/', '/faq', '/profile']) {
    const r = await req(path);
    assert.equal(r.status, 200, path);
    assert.match(r.text, /<html lang="en">/, path);
    assert.match(r.text, /<meta charset="utf-8"/, path);
    assert.match(r.text, /<meta name="viewport"/, path);
    assert.match(r.text, /<meta name="description" content=".{50,}"/, path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, `${path}: one h1`);
    titles.add(r.text.match(/<title>(.*)<\/title>/)[1]);
  }
  assert.equal(titles.size, 3, 'every page has its own title');
  assert.match((await req('/profile')).text, /<meta name="robots" content="noindex"/);
  assert.doesNotMatch((await req('/')).text, /noindex/);
});

test('clean URLs: .html redirects, unknown pages return 404', async () => {
  const req = ctx.client();
  let r = await req('/faq.html');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/faq');
  r = await req('/index.html');
  assert.equal(r.headers.get('location'), '/');
  r = await req('//evil.com/x.html');
  assert.equal(r.headers.get('location'), '/evil.com/x', 'no open redirect');
  r = await req('/no-such-page');
  assert.equal(r.status, 404);
  assert.match(r.text, /noindex/);
});
