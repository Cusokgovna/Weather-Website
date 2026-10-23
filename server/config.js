// Reads settings from environment variables (.env locally, --env-file / env_file in Docker, Secrets in CI).
require('dotenv').config();

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|yes)$/i.test(v));

const config = {
  port: Number(process.env.PORT) || 3000,
  // Public address of the site: used in sitemap.xml and canonical links
  siteUrl: (process.env.SITE_URL || 'https://example.com').replace(/\/+$/, ''),
  cookieSecure: bool(process.env.COOKIE_SECURE),
  // "mssql" (default) or "memory" (no database: demo data in RAM until restart)
  dbDriver: process.env.DB_DRIVER || 'mssql',
  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    instanceName: process.env.DB_INSTANCE || undefined,
    database: process.env.DB_NAME || 'KrakenShop',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    encrypt: bool(process.env.DB_ENCRYPT, true),
    trustServerCertificate: bool(process.env.DB_TRUST_CERT, true),
  },
};

module.exports = config;
