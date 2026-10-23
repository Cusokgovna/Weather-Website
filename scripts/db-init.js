// Runs database/01_create_database.sql … 04_seed.sql against SQL Server.
// Same scripts you can run by hand in SSMS. Usage: npm run db:init  (reads .env)
// Batches are split by "GO" lines, exactly like SSMS/sqlcmd do.
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const config = require('../server/config');
const { toMssqlConfig } = require('../server/mssqlRepo');

const SCRIPTS = ['01_create_database.sql', '02_schema.sql', '03_procedures.sql', '04_seed.sql'];
const dir = path.join(__dirname, '..', 'database');

async function main() {
  // Connect to master: the KrakenShop database may not exist yet. One connection so USE persists.
  const cfg = { ...toMssqlConfig(config.db), database: 'master', pool: { max: 1, min: 0 } };
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    for (const file of SCRIPTS) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const batches = text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
      for (const batch of batches) await pool.request().batch(batch);
      console.log(`✔ ${file} (${batches.length} batches)`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Database init failed:', err.message);
  process.exit(1);
});
