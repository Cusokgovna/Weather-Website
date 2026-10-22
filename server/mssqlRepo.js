// Data access for Microsoft SQL Server (package "mssql"). All queries are parameterized.
const sql = require('mssql');

function toMssqlConfig(db) {
  const cfg = {
    server: db.server,
    database: db.database,
    user: db.user,
    password: db.password,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: db.encrypt,
      trustServerCertificate: db.trustServerCertificate,
    },
  };
  // Named instance (e.g. SQLEXPRESS) is resolved via SQL Browser; otherwise use a TCP port.
  if (db.instanceName) cfg.options.instanceName = db.instanceName;
  else cfg.port = db.port || 1433;
  return cfg;
}

const mapUser = (r) => r && {
  id: r.UserId,
  name: r.Name,
  email: r.Email,
  avatar: r.AvatarDataUrl || null,
  passwordHash: r.PasswordHash,
  createdAt: r.CreatedAt,
};

const mapCity = (r) => ({
  cityId: r.CityId,
  name: r.Name,
  country: r.Country,
  state: r.State,
  lat: Number(r.Latitude),
  lon: Number(r.Longitude),
});

function createMssqlRepo(dbConfig) {
  let poolPromise = null;

  function getPool() {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(toMssqlConfig(dbConfig)).connect().catch((err) => {
        poolPromise = null; // retry on the next request
        throw err;
      });
    }
    return poolPromise;
  }

  async function query(text, params = {}) {
    const pool = await getPool();
    const req = pool.request();
    for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
    return req.query(text);
  }

  const USER_COLS = 'UserId, Name, Email, PasswordHash, AvatarDataUrl, CreatedAt';

  return {
    kind: 'mssql',

    async ping() {
      await query('SELECT 1 AS ok');
      return true;
    },

    async createUser({ name, email, passwordHash }) {
      try {
        const r = await query(
          `INSERT INTO dbo.Users (Name, Email, PasswordHash)
           OUTPUT INSERTED.UserId, INSERTED.Name, INSERTED.Email, INSERTED.PasswordHash,
                  INSERTED.AvatarDataUrl, INSERTED.CreatedAt
           VALUES (@name, @email, @hash);`,
          { name: [sql.NVarChar(100), name], email: [sql.NVarChar(255), email], hash: [sql.NVarChar(255), passwordHash] },
        );
        const user = mapUser(r.recordset[0]);
        await query('INSERT INTO dbo.UserSettings (UserId) VALUES (@id);', { id: [sql.Int, user.id] });
        return user;
      } catch (err) {
        // 2627 / 2601 = unique constraint violation
        if (err.number === 2627 || err.number === 2601) err.code = 'EMAIL_TAKEN';
        throw err;
      }
    },

    async findUserByEmail(email) {
      const r = await query(`SELECT ${USER_COLS} FROM dbo.Users WHERE Email = @email;`, {
        email: [sql.NVarChar(255), email],
      });
      return mapUser(r.recordset[0]) || null;
    },

    async findUserById(id) {
      const r = await query(`SELECT ${USER_COLS} FROM dbo.Users WHERE UserId = @id;`, { id: [sql.Int, id] });
      return mapUser(r.recordset[0]) || null;
    },

    async updateUser(id, { name, email }) {
      try {
        await query(
          `UPDATE dbo.Users SET Name = @name, Email = @email, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @id;`,
          { id: [sql.Int, id], name: [sql.NVarChar(100), name], email: [sql.NVarChar(255), email] },
        );
      } catch (err) {
        if (err.number === 2627 || err.number === 2601) err.code = 'EMAIL_TAKEN';
        throw err;
      }
      return this.findUserById(id);
    },

    async updateAvatar(id, avatar) {
      await query(
        `UPDATE dbo.Users SET AvatarDataUrl = @avatar, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @id;`,
        { id: [sql.Int, id], avatar: [sql.NVarChar(sql.MAX), avatar] },
      );
      return this.findUserById(id);
    },

    async getSettings(userId) {
      const r = await query('SELECT Theme, Units, Language FROM dbo.UserSettings WHERE UserId = @id;', {
        id: [sql.Int, userId],
      });
      const s = r.recordset[0];
      return s ? { theme: s.Theme, units: s.Units, language: s.Language } : { theme: 'dark', units: 'metric', language: 'en' };
    },

    async saveSettings(userId, { theme, units, language }) {
      await query(
        `MERGE dbo.UserSettings AS t
         USING (SELECT @id AS UserId) AS s ON t.UserId = s.UserId
         WHEN MATCHED THEN UPDATE SET Theme = @theme, Units = @units, Language = @lang
         WHEN NOT MATCHED THEN INSERT (UserId, Theme, Units, Language) VALUES (@id, @theme, @units, @lang);`,
        {
          id: [sql.Int, userId],
          theme: [sql.NVarChar(10), theme],
          units: [sql.NVarChar(10), units],
          lang: [sql.NVarChar(5), language],
        },
      );
      return this.getSettings(userId);
    },

    async createSession(userId, tokenHash, expiresAt) {
      await query('INSERT INTO dbo.Sessions (UserId, TokenHash, ExpiresAt) VALUES (@id, @token, @exp);', {
        id: [sql.Int, userId],
        token: [sql.Char(64), tokenHash],
        exp: [sql.DateTime2(0), expiresAt],
      });
    },

    async findSessionUser(tokenHash) {
      const r = await query(
        `SELECT u.UserId, u.Name, u.Email, u.PasswordHash, u.AvatarDataUrl, u.CreatedAt
         FROM dbo.Sessions AS s JOIN dbo.Users AS u ON u.UserId = s.UserId
         WHERE s.TokenHash = @token AND s.ExpiresAt > SYSUTCDATETIME();`,
        { token: [sql.Char(64), tokenHash] },
      );
      return mapUser(r.recordset[0]) || null;
    },

    async deleteSession(tokenHash) {
      await query('DELETE FROM dbo.Sessions WHERE TokenHash = @token OR ExpiresAt <= SYSUTCDATETIME();', {
        token: [sql.Char(64), tokenHash],
      });
    },

    // Returns CityId; creates the city if a city with the same coordinates does not exist yet.
    async upsertCity({ name, country, state, lat, lon }) {
      const r = await query(
        `SET XACT_ABORT ON;
         BEGIN TRAN;
           DECLARE @cityId INT = (SELECT CityId FROM dbo.Cities WITH (UPDLOCK, HOLDLOCK)
                                  WHERE Latitude = @lat AND Longitude = @lon);
           IF @cityId IS NULL
           BEGIN
             INSERT INTO dbo.Cities (Name, Country, State, Latitude, Longitude)
             VALUES (@name, @country, @state, @lat, @lon);
             SET @cityId = SCOPE_IDENTITY();
           END
         COMMIT;
         SELECT @cityId AS CityId;`,
        {
          name: [sql.NVarChar(150), name],
          country: [sql.NVarChar(2), country || null],
          state: [sql.NVarChar(150), state || null],
          lat: [sql.Decimal(8, 4), lat],
          lon: [sql.Decimal(8, 4), lon],
        },
      );
      return r.recordset[0].CityId;
    },

    async listFavorites(userId) {
      const r = await query(
        `SELECT c.CityId, c.Name, c.Country, c.State, c.Latitude, c.Longitude, f.AddedAt
         FROM dbo.FavoriteCities AS f JOIN dbo.Cities AS c ON c.CityId = f.CityId
         WHERE f.UserId = @id ORDER BY f.AddedAt;`,
        { id: [sql.Int, userId] },
      );
      return r.recordset.map((row) => ({ ...mapCity(row), addedAt: row.AddedAt }));
    },

    async addFavorite(userId, cityId) {
      await query(
        `IF NOT EXISTS (SELECT 1 FROM dbo.FavoriteCities WHERE UserId = @uid AND CityId = @cid)
           INSERT INTO dbo.FavoriteCities (UserId, CityId) VALUES (@uid, @cid);`,
        { uid: [sql.Int, userId], cid: [sql.Int, cityId] },
      );
    },

    async removeFavorite(userId, cityId) {
      const r = await query('DELETE FROM dbo.FavoriteCities WHERE UserId = @uid AND CityId = @cid;', {
        uid: [sql.Int, userId],
        cid: [sql.Int, cityId],
      });
      return r.rowsAffected[0] > 0;
    },

    async addHistory(userId, cityId) {
      await query('INSERT INTO dbo.SearchHistory (UserId, CityId) VALUES (@uid, @cid);', {
        uid: [sql.Int, userId],
        cid: [sql.Int, cityId],
      });
    },

    async listHistory(userId, limit = 10) {
      const r = await query(
        `SELECT TOP (@limit) h.SearchId, h.SearchedAt, c.CityId, c.Name, c.Country, c.State, c.Latitude, c.Longitude
         FROM dbo.SearchHistory AS h JOIN dbo.Cities AS c ON c.CityId = h.CityId
         WHERE h.UserId = @uid ORDER BY h.SearchedAt DESC, h.SearchId DESC;`,
        { uid: [sql.Int, userId], limit: [sql.Int, limit] },
      );
      return r.recordset.map((row) => ({ ...mapCity(row), searchedAt: row.SearchedAt }));
    },

    async saveSnapshot(cityId, s) {
      await query(
        `INSERT INTO dbo.WeatherSnapshots (CityId, TempC, FeelsLikeC, Humidity, PressureHPa, WindSpeedMs, Description, Icon)
         VALUES (@cid, @temp, @feels, @hum, @press, @wind, @desc, @icon);`,
        {
          cid: [sql.Int, cityId],
          temp: [sql.Decimal(5, 2), s.tempC],
          feels: [sql.Decimal(5, 2), s.feelsLikeC],
          hum: [sql.TinyInt, s.humidity],
          press: [sql.SmallInt, s.pressure],
          wind: [sql.Decimal(5, 2), s.windSpeed],
          desc: [sql.NVarChar(100), s.description],
          icon: [sql.NVarChar(10), s.icon],
        },
      );
    },

    async close() {
      if (poolPromise) (await poolPromise).close();
      poolPromise = null;
    },
  };
}

module.exports = { createMssqlRepo, toMssqlConfig };
