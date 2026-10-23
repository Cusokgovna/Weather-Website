// Integration tests against a real Microsoft SQL Server (database created by `npm run db:init`).
// Skipped unless DB_INTEGRATION=1 (set in GitHub Actions job "db-test").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { createMssqlRepo } = require('../server/mssqlRepo');
const { startServer, apiContract } = require('./helpers');

const enabled = process.env.DB_INTEGRATION === '1';
const skip = !enabled && 'set DB_INTEGRATION=1';
let ctx;
let repo;

before(async () => {
  if (!enabled) return;
  repo = createMssqlRepo(config.db);
  ctx = await startServer(repo);
});
after(async () => {
  if (!enabled) return;
  await ctx.close();
  await repo.close();
});

test('database is reachable and seeded', { skip }, async () => {
  const req = ctx.client();
  assert.equal((await req('/api/health')).json.dbConnected, true);
  const games = (await req('/api/games')).json;
  assert.equal(games.length >= 6, true);
  assert.ok(games.find((g) => g.slug === 'cs2').activeListings > 0);
  const seller = (await req('/api/users/KrakenTrader')).json;
  assert.equal(seller.avgRating, 5);
});

test('seed demo user can sign in and sees the balance', { skip }, async () => {
  const req = ctx.client();
  const r = await req('/api/auth/login', { method: 'POST', body: { email: 'demo@example.com', password: 'demo1234' } });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.user.balance, 'number');
});

for (const [name, fn] of apiContract(() => ctx)) {
  test(`[mssql] ${name}`, { skip }, () => fn(assert));
}
