// Entry point: reads config, picks the repository (SQL Server or memory) and starts HTTP server.
const config = require('./config');
const { createApp } = require('./app');
const { createMssqlRepo } = require('./mssqlRepo');
const { createMemoryRepo } = require('./memoryRepo');

const repo = config.dbDriver === 'memory' ? createMemoryRepo({ demoData: true }) : createMssqlRepo(config.db);

if (repo.kind === 'memory') console.warn('WARNING: demo mode without SQL Server — data is kept in RAM and lost on restart.');

const app = createApp({ repo, cookieSecure: config.cookieSecure, siteUrl: config.siteUrl });

const server = app.listen(config.port, () => {
  console.log(`Kraken Shop: http://localhost:${config.port}`);
  repo.ping()
    .then(() => console.log(`Database (${repo.kind}) connected`))
    .catch((err) => console.error(`Database (${repo.kind}) is NOT reachable: ${err.message}`));
});

function shutdown() {
  server.close(() => repo.close().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
