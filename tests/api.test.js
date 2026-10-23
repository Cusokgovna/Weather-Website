// API tests on the in-memory repository (no SQL Server needed). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRepo } = require('../server/memoryRepo');
const { startServer, apiContract } = require('./helpers');

let ctx;
before(async () => { ctx = await startServer(createMemoryRepo({ demoData: true }), { siteUrl: 'https://kraken.example' }); });
after(() => ctx.close());

for (const [name, fn] of apiContract(() => ctx)) test(name, () => fn(assert));

test('API responses carry X-Robots-Tag: noindex, nofollow', async () => {
  const req = ctx.client();
  for (const path of ['/api/health', '/api/games', '/api/unknown']) {
    assert.equal((await req(path)).headers.get('x-robots-tag'), 'noindex, nofollow', path);
  }
});

test('catalog: games with categories, search, sorting, paging', async () => {
  const req = ctx.client();
  const games = (await req('/api/games')).json;
  assert.deepEqual(games.map((g) => g.slug), ['cs2', 'dota2', 'genshin', 'wow', 'roblox', 'steam']);
  const cs2 = games.find((g) => g.slug === 'cs2');
  assert.ok(cs2.activeListings >= 2);
  assert.ok(cs2.categories.some((c) => c.slug === 'skins' && c.kind === 'item'));

  const asc = (await req('/api/listings?game=cs2&sort=price_asc')).json.items.map((l) => l.price);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.equal((await req('/api/listings?q=redline')).json.items[0].title, 'AK-47 | Redline (Field-Tested)', 'case-insensitive search');
  const page = (await req('/api/listings?limit=2&page=2')).json;
  assert.equal(page.items.length, 2);
  assert.equal(page.page, 2);
  assert.equal((await req('/api/listings/999999')).status, 404);
  assert.equal((await req('/api/users/nobody_here')).status, 404);
});

test('sitemap.xml is generated from games and active listings', async () => {
  const r = await ctx.client()('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /xml/);
  assert.match(r.text, /<loc>https:\/\/kraken\.example\/<\/loc>/);
  assert.match(r.text, /<loc>https:\/\/kraken\.example\/games\/cs2<\/loc>/);
  assert.match(r.text, /<loc>https:\/\/kraken\.example\/listings\/\d+<\/loc>/);
});
