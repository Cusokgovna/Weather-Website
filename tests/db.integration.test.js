// Integration tests against a real Microsoft SQL Server (database created by `npm run db:init`).
// Skipped unless DB_INTEGRATION=1 (set in GitHub Actions job "db-test").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { createMssqlRepo } = require('../server/mssqlRepo');
const { startServer, apiContract } = require('./helpers');

const enabled = process.env.DB_INTEGRATION === '1';
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

test('database is reachable and seeded', { skip: !enabled && 'set DB_INTEGRATION=1' }, async () => {
  const r = await ctx.client()('/api/health');
  assert.equal(r.json.dbConnected, true);
  const demo = await repo.findUserByEmail('demo@example.com');
  assert.ok(demo, 'seed user exists');
  assert.equal((await repo.listFavorites(demo.id)).length >= 2, true);
});

test('seed demo user can sign in', { skip: !enabled && 'set DB_INTEGRATION=1' }, async () => {
  const r = await ctx.client()('/api/auth/login', { method: 'POST', body: { email: 'demo@example.com', password: 'demo1234' } });
  assert.equal(r.status, 200);
});

for (const [name, fn] of apiContract(test, () => ctx)) {
  test(`[mssql] ${name}`, { skip: !enabled && 'set DB_INTEGRATION=1' }, () => fn(assert));
}
