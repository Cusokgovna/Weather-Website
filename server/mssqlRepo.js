// Data access for Microsoft SQL Server (package "mssql"). All queries are parameterized.
// Money operations go through stored procedures (database/03_procedures.sql).
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

const SORTS = {
  new: 'l.CreatedAt DESC, l.ListingId DESC',
  price_asc: 'l.Price ASC, l.ListingId DESC',
  price_desc: 'l.Price DESC, l.ListingId DESC',
};

// LIKE treats % _ [ as wildcards — escape them in user input
const likeEscape = (s) => s.replace(/[%_[]/g, '[$&]');
const num = (v) => (v == null ? null : Number(v));

const mapUser = (r) => r && {
  id: r.UserId,
  username: r.Username,
  email: r.Email,
  avatar: r.AvatarDataUrl || null,
  balance: Number(r.Balance),
  passwordHash: r.PasswordHash,
  createdAt: r.CreatedAt,
};

const mapListing = (r) => ({
  listingId: r.ListingId,
  title: r.Title,
  description: r.Description,
  price: Number(r.Price),
  quantity: r.Quantity,
  status: r.Status,
  createdAt: r.CreatedAt,
  game: { slug: r.GameSlug, name: r.GameName },
  category: { categoryId: r.CategoryId, slug: r.CategorySlug, name: r.CategoryName, kind: r.CategoryKind },
  seller: { userId: r.SellerId, username: r.SellerName, avgRating: num(r.AvgRating), salesCount: r.SalesCount },
});

const mapOrder = (r) => ({
  orderId: r.OrderId,
  listingId: r.ListingId,
  title: r.Title,
  game: { slug: r.GameSlug, name: r.GameName },
  buyer: { userId: r.BuyerId, username: r.BuyerName },
  seller: { userId: r.SellerId, username: r.SellerName },
  quantity: r.Quantity,
  unitPrice: Number(r.UnitPrice),
  totalPrice: Number(r.TotalPrice),
  status: r.Status,
  createdAt: r.CreatedAt,
  closedAt: r.ClosedAt,
  hasReview: !!r.HasReview,
});

const LISTING_SELECT = `
  SELECT l.ListingId, l.Title, l.Description, l.Price, l.Quantity, l.Status, l.CreatedAt, l.SellerId,
         c.CategoryId, c.Slug AS CategorySlug, c.Name AS CategoryName, c.Kind AS CategoryKind,
         g.Slug AS GameSlug, g.Name AS GameName,
         s.Username AS SellerName, s.AvgRating, s.SalesCount
  FROM dbo.Listings AS l
  JOIN dbo.Categories AS c ON c.CategoryId = l.CategoryId
  JOIN dbo.Games AS g ON g.GameId = c.GameId
  JOIN dbo.vw_SellerStats AS s ON s.UserId = l.SellerId`;

const ORDER_SELECT = `
  SELECT o.OrderId, o.ListingId, o.Quantity, o.UnitPrice, o.TotalPrice, o.Status, o.CreatedAt, o.ClosedAt,
         o.BuyerId, b.Username AS BuyerName, o.SellerId, s.Username AS SellerName,
         l.Title, g.Slug AS GameSlug, g.Name AS GameName,
         CASE WHEN EXISTS (SELECT 1 FROM dbo.Reviews r WHERE r.OrderId = o.OrderId) THEN 1 ELSE 0 END AS HasReview
  FROM dbo.Orders AS o
  JOIN dbo.Users AS b ON b.UserId = o.BuyerId
  JOIN dbo.Users AS s ON s.UserId = o.SellerId
  JOIN dbo.Listings AS l ON l.ListingId = o.ListingId
  JOIN dbo.Categories AS c ON c.CategoryId = l.CategoryId
  JOIN dbo.Games AS g ON g.GameId = c.GameId`;

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

  async function request(params = {}) {
    const req = (await getPool()).request();
    for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
    return req;
  }
  const query = async (text, params) => (await request(params)).query(text);
  const exec = async (proc, params) => (await request(params)).execute(proc);

  // Unique constraint violation → which field is taken
  function uniqueError(err) {
    if (err.number === 2627 || err.number === 2601) {
      err.code = /Username/i.test(err.message) ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN';
    }
    return err;
  }

  const USER_COLS = 'UserId, Username, Email, PasswordHash, AvatarDataUrl, Balance, CreatedAt';

  return {
    kind: 'mssql',

    async ping() {
      await query('SELECT 1 AS ok');
      return true;
    },

    // ---------- Users & sessions ----------
    async createUser({ username, email, passwordHash }) {
      try {
        const r = await query(
          `INSERT INTO dbo.Users (Username, Email, PasswordHash)
           OUTPUT INSERTED.UserId, INSERTED.Username, INSERTED.Email, INSERTED.PasswordHash,
                  INSERTED.AvatarDataUrl, INSERTED.Balance, INSERTED.CreatedAt
           VALUES (@username, @email, @hash);`,
          { username: [sql.NVarChar(32), username], email: [sql.NVarChar(255), email], hash: [sql.NVarChar(255), passwordHash] },
        );
        return mapUser(r.recordset[0]);
      } catch (err) {
        throw uniqueError(err);
      }
    },

    async findUserByEmail(email) {
      const r = await query(`SELECT ${USER_COLS} FROM dbo.Users WHERE Email = @email;`, { email: [sql.NVarChar(255), email] });
      return mapUser(r.recordset[0]) || null;
    },

    async findUserById(id) {
      const r = await query(`SELECT ${USER_COLS} FROM dbo.Users WHERE UserId = @id;`, { id: [sql.Int, id] });
      return mapUser(r.recordset[0]) || null;
    },

    async updateUser(id, { username, email }) {
      try {
        await query(
          'UPDATE dbo.Users SET Username = @username, Email = @email, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @id;',
          { id: [sql.Int, id], username: [sql.NVarChar(32), username], email: [sql.NVarChar(255), email] },
        );
      } catch (err) {
        throw uniqueError(err);
      }
      return this.findUserById(id);
    },

    async updateAvatar(id, avatar) {
      await query('UPDATE dbo.Users SET AvatarDataUrl = @avatar, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @id;', {
        id: [sql.Int, id],
        avatar: [sql.NVarChar(sql.MAX), avatar],
      });
      return this.findUserById(id);
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
        `SELECT u.UserId, u.Username, u.Email, u.PasswordHash, u.AvatarDataUrl, u.Balance, u.CreatedAt
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

    // ---------- Catalog ----------
    async listGames() {
      const r = await query(
        `SELECT g.GameId, g.Name, g.Slug, g.Description, g.SortOrder,
                c.CategoryId, c.Name AS CategoryName, c.Slug AS CategorySlug, c.Kind,
                (SELECT COUNT(*) FROM dbo.Listings l WHERE l.CategoryId = c.CategoryId AND l.Status = 'active') AS ActiveListings,
                (SELECT MIN(l.Price) FROM dbo.Listings l WHERE l.CategoryId = c.CategoryId AND l.Status = 'active') AS MinPrice
         FROM dbo.Games AS g
         LEFT JOIN dbo.Categories AS c ON c.GameId = g.GameId
         ORDER BY g.SortOrder, g.Name, c.CategoryId;`,
      );
      const games = new Map();
      for (const row of r.recordset) {
        if (!games.has(row.GameId)) {
          games.set(row.GameId, {
            gameId: row.GameId, name: row.Name, slug: row.Slug, description: row.Description,
            activeListings: 0, minPrice: null, categories: [],
          });
        }
        const g = games.get(row.GameId);
        if (row.CategoryId == null) continue;
        const minPrice = num(row.MinPrice);
        g.categories.push({ categoryId: row.CategoryId, name: row.CategoryName, slug: row.CategorySlug, kind: row.Kind, activeListings: row.ActiveListings, minPrice });
        g.activeListings += row.ActiveListings;
        if (minPrice != null && (g.minPrice == null || minPrice < g.minPrice)) g.minPrice = minPrice;
      }
      return [...games.values()];
    },

    async searchListings({ game, category, q, sort = 'new', sellerId, status = 'active', limit = 24, offset = 0 } = {}) {
      const where = [];
      const params = { limit: [sql.Int, limit], offset: [sql.Int, offset] };
      if (status) { where.push('l.Status = @status'); params.status = [sql.VarChar(10), status]; }
      if (game) { where.push('g.Slug = @game'); params.game = [sql.VarChar(50), game]; }
      if (category) { where.push('c.Slug = @category'); params.category = [sql.VarChar(50), category]; }
      if (sellerId) { where.push('l.SellerId = @sellerId'); params.sellerId = [sql.Int, sellerId]; }
      if (q) { where.push('l.Title LIKE @q'); params.q = [sql.NVarChar(130), `%${likeEscape(q)}%`]; }
      const r = await query(
        `${LISTING_SELECT.replace('SELECT', 'SELECT COUNT(*) OVER () AS Total,')}
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY ${SORTS[sort] || SORTS.new}
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`,
        params,
      );
      return { items: r.recordset.map(mapListing), total: r.recordset[0]?.Total ?? 0 };
    },

    async getListing(id) {
      const r = await query(`${LISTING_SELECT} WHERE l.ListingId = @id;`, { id: [sql.Int, id] });
      return r.recordset[0] ? mapListing(r.recordset[0]) : null;
    },

    async getCategory(categoryId) {
      const r = await query('SELECT CategoryId FROM dbo.Categories WHERE CategoryId = @id;', { id: [sql.Int, categoryId] });
      return r.recordset[0] || null;
    },

    async createListing(sellerId, { categoryId, title, description, price, quantity }) {
      const r = await query(
        `INSERT INTO dbo.Listings (SellerId, CategoryId, Title, Description, Price, Quantity)
         OUTPUT INSERTED.ListingId VALUES (@seller, @cat, @title, @descr, @price, @qty);`,
        {
          seller: [sql.Int, sellerId],
          cat: [sql.Int, categoryId],
          title: [sql.NVarChar(120), title],
          descr: [sql.NVarChar(2000), description],
          price: [sql.Decimal(12, 2), price],
          qty: [sql.Int, quantity],
        },
      );
      return r.recordset[0].ListingId;
    },

    // Only the owner can change a listing; a listing with quantity > 0 becomes active again
    async updateListing(listingId, sellerId, { title, description, price, quantity, status }) {
      const r = await query(
        `UPDATE dbo.Listings
         SET Title = @title, Description = @descr, Price = @price, Quantity = @qty,
             Status = CASE WHEN @status = 'closed' THEN 'closed' WHEN @qty = 0 THEN 'sold' ELSE 'active' END,
             UpdatedAt = SYSUTCDATETIME()
         WHERE ListingId = @id AND SellerId = @seller;`,
        {
          id: [sql.Int, listingId],
          seller: [sql.Int, sellerId],
          title: [sql.NVarChar(120), title],
          descr: [sql.NVarChar(2000), description],
          price: [sql.Decimal(12, 2), price],
          qty: [sql.Int, quantity],
          status: [sql.VarChar(10), status],
        },
      );
      return r.rowsAffected[0] > 0;
    },

    // ---------- Sellers ----------
    async getSellerProfile(username) {
      const r = await query(
        `SELECT UserId, Username, CreatedAt, SalesCount, ReviewsCount, AvgRating, ActiveListings
         FROM dbo.vw_SellerStats WHERE Username = @username;`,
        { username: [sql.NVarChar(32), username] },
      );
      const s = r.recordset[0];
      return s ? {
        userId: s.UserId, username: s.Username, createdAt: s.CreatedAt, salesCount: s.SalesCount,
        reviewsCount: s.ReviewsCount, avgRating: num(s.AvgRating), activeListings: s.ActiveListings,
      } : null;
    },

    async listReviews(sellerId, limit = 20) {
      const r = await query(
        `SELECT TOP (@limit) r.ReviewId, r.Rating, r.Text, r.CreatedAt, a.Username AS AuthorName, l.Title
         FROM dbo.Reviews AS r
         JOIN dbo.Users AS a ON a.UserId = r.AuthorId
         JOIN dbo.Orders AS o ON o.OrderId = r.OrderId
         JOIN dbo.Listings AS l ON l.ListingId = o.ListingId
         WHERE r.SellerId = @seller ORDER BY r.CreatedAt DESC;`,
        { seller: [sql.Int, sellerId], limit: [sql.Int, limit] },
      );
      return r.recordset.map((x) => ({ reviewId: x.ReviewId, rating: x.Rating, text: x.Text, createdAt: x.CreatedAt, author: x.AuthorName, title: x.Title }));
    },

    // ---------- Orders ----------
    async createOrder(buyerId, listingId, quantity) {
      const r = await exec('dbo.usp_CreateOrder', {
        BuyerId: [sql.Int, buyerId], ListingId: [sql.Int, listingId], Quantity: [sql.Int, quantity],
      });
      return r.recordset[0].OrderId;
    },

    async getOrder(orderId) {
      const r = await query(`${ORDER_SELECT} WHERE o.OrderId = @id;`, { id: [sql.Int, orderId] });
      return r.recordset[0] ? mapOrder(r.recordset[0]) : null;
    },

    async listOrders(userId, role) {
      const col = role === 'seller' ? 'o.SellerId' : 'o.BuyerId';
      const r = await query(`${ORDER_SELECT} WHERE ${col} = @uid ORDER BY o.CreatedAt DESC, o.OrderId DESC;`, { uid: [sql.Int, userId] });
      return r.recordset.map(mapOrder);
    },

    async completeOrder(orderId, buyerId) {
      await exec('dbo.usp_CompleteOrder', { OrderId: [sql.Int, orderId], BuyerId: [sql.Int, buyerId] });
    },

    async refundOrder(orderId, sellerId) {
      await exec('dbo.usp_RefundOrder', { OrderId: [sql.Int, orderId], SellerId: [sql.Int, sellerId] });
    },

    async disputeOrder(orderId, buyerId) {
      const r = await query(
        "UPDATE dbo.Orders SET Status = 'disputed' WHERE OrderId = @id AND BuyerId = @buyer AND Status = 'paid';",
        { id: [sql.Int, orderId], buyer: [sql.Int, buyerId] },
      );
      return r.rowsAffected[0] > 0;
    },

    async listMessages(orderId) {
      const r = await query(
        `SELECT m.MessageId, m.Text, m.CreatedAt, m.SenderId, u.Username
         FROM dbo.Messages AS m JOIN dbo.Users AS u ON u.UserId = m.SenderId
         WHERE m.OrderId = @id ORDER BY m.MessageId;`,
        { id: [sql.Int, orderId] },
      );
      return r.recordset.map((m) => ({ messageId: m.MessageId, text: m.Text, createdAt: m.CreatedAt, sender: { userId: m.SenderId, username: m.Username } }));
    },

    async addMessage(orderId, senderId, text) {
      await query('INSERT INTO dbo.Messages (OrderId, SenderId, Text) VALUES (@id, @sender, @text);', {
        id: [sql.Int, orderId], sender: [sql.Int, senderId], text: [sql.NVarChar(1000), text],
      });
    },

    async addReview(orderId, authorId, sellerId, rating, text) {
      try {
        await query(
          'INSERT INTO dbo.Reviews (OrderId, AuthorId, SellerId, Rating, Text) VALUES (@id, @author, @seller, @rating, @text);',
          { id: [sql.Int, orderId], author: [sql.Int, authorId], seller: [sql.Int, sellerId], rating: [sql.TinyInt, rating], text: [sql.NVarChar(1000), text] },
        );
      } catch (err) {
        if (err.number === 2627 || err.number === 2601) err.code = 'REVIEW_EXISTS';
        throw err;
      }
    },

    // ---------- Wallet ----------
    async listTransactions(userId, limit = 50) {
      const r = await query(
        `SELECT TOP (@limit) TransactionId, OrderId, Amount, Type, BalanceAfter, CreatedAt
         FROM dbo.Transactions WHERE UserId = @uid ORDER BY TransactionId DESC;`,
        { uid: [sql.Int, userId], limit: [sql.Int, limit] },
      );
      return r.recordset.map((t) => ({ transactionId: Number(t.TransactionId), orderId: t.OrderId, amount: Number(t.Amount), type: t.Type, balanceAfter: Number(t.BalanceAfter), createdAt: t.CreatedAt }));
    },

    async deposit(userId, amount) {
      const r = await exec('dbo.usp_Deposit', { UserId: [sql.Int, userId], Amount: [sql.Decimal(12, 2), amount] });
      return Number(r.recordset[0].Balance);
    },

    async close() {
      if (poolPromise) (await poolPromise).close();
      poolPromise = null;
    },
  };
}

module.exports = { createMssqlRepo, toMssqlConfig };
