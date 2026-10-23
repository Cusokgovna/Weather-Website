// In-memory implementation of the same repository interface as mssqlRepo.js.
// Used by automated tests and by DB_DRIVER=memory (run the site without SQL Server).
// Business rules mirror database/03_procedures.sql, including the same error numbers.

const DEMO_HASH = 'scrypt$e0daf5345b875e6b7cab1762bf920107$f621843a8ef15f17a56409a477232dbe0e1d2169f782a03b84ac6d1d3465156345121863d3fe358fb948e561ff51cba6141f18df192d98a9c28ee25394dc124d'; // demo1234

const GAMES = [
  ['Counter-Strike 2', 'cs2', 'Скины, кейсы и Prime-аккаунты CS2', [['Скины', 'skins', 'item'], ['Аккаунты', 'accounts', 'account']]],
  ['Dota 2', 'dota2', 'Предметы, арканы, аккаунты и буст MMR', [['Предметы', 'items', 'item'], ['Буст MMR', 'boosting', 'service']]],
  ['Genshin Impact', 'genshin', 'Аккаунты и кристаллы Сотворения', [['Аккаунты', 'accounts', 'account'], ['Кристаллы', 'crystals', 'currency']]],
  ['World of Warcraft', 'wow', 'Золото и услуги на европейских серверах', [['Золото', 'gold', 'currency'], ['Услуги', 'services', 'service']]],
  ['Roblox', 'roblox', 'Robux и редкие предметы', [['Robux', 'robux', 'currency'], ['Предметы', 'items', 'item']]],
  ['Steam', 'steam', 'Подарочные карты и ключи игр', [['Пополнение', 'wallet', 'currency'], ['Ключи игр', 'keys', 'item']]],
];

const domainError = (number, message) => Object.assign(new Error(message), { number });
const round2 = (n) => Math.round(n * 100) / 100;

function createMemoryRepo({ demoData = false } = {}) {
  const db = { users: [], sessions: [], games: [], categories: [], listings: [], orders: [], transactions: [], reviews: [], messages: [] };
  const seq = {};
  const nextId = (t) => (seq[t] = (seq[t] || 0) + 1);
  const now = () => new Date();

  GAMES.forEach(([name, slug, description, cats], i) => {
    const gameId = nextId('games');
    db.games.push({ gameId, name, slug, description, sortOrder: i + 1 });
    for (const [cname, cslug, kind] of cats) db.categories.push({ categoryId: nextId('categories'), gameId, name: cname, slug: cslug, kind });
  });

  const user = (id) => db.users.find((u) => u.id === id);
  const clone = (u) => u && { ...u };
  const sellerStats = (userId) => {
    const reviews = db.reviews.filter((r) => r.sellerId === userId);
    return {
      salesCount: db.orders.filter((o) => o.sellerId === userId && o.status === 'completed').length,
      reviewsCount: reviews.length,
      avgRating: reviews.length ? round2(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : null,
      activeListings: db.listings.filter((l) => l.sellerId === userId && l.status === 'active').length,
    };
  };
  const ledger = (userId, orderId, amount, type) => {
    db.transactions.push({ transactionId: nextId('transactions'), userId, orderId, amount, type, balanceAfter: user(userId).balance, createdAt: now() });
  };

  function listingOut(l) {
    const c = db.categories.find((x) => x.categoryId === l.categoryId);
    const g = db.games.find((x) => x.gameId === c.gameId);
    const s = sellerStats(l.sellerId);
    return {
      listingId: l.listingId, title: l.title, description: l.description, price: l.price, quantity: l.quantity, status: l.status, createdAt: l.createdAt,
      game: { slug: g.slug, name: g.name },
      category: { categoryId: c.categoryId, slug: c.slug, name: c.name, kind: c.kind },
      seller: { userId: l.sellerId, username: user(l.sellerId).username, avgRating: s.avgRating, salesCount: s.salesCount },
    };
  }

  function orderOut(o) {
    const l = listingOut(db.listings.find((x) => x.listingId === o.listingId));
    return {
      orderId: o.orderId, listingId: o.listingId, title: l.title, game: l.game,
      buyer: { userId: o.buyerId, username: user(o.buyerId).username },
      seller: { userId: o.sellerId, username: user(o.sellerId).username },
      quantity: o.quantity, unitPrice: o.unitPrice, totalPrice: round2(o.quantity * o.unitPrice),
      status: o.status, createdAt: o.createdAt, closedAt: o.closedAt,
      hasReview: db.reviews.some((r) => r.orderId === o.orderId),
    };
  }

  const repo = {
    kind: 'memory',
    _db: db,

    async ping() { return true; },

    // ---------- Users & sessions ----------
    async createUser({ username, email, passwordHash }) {
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: 'USERNAME_TAKEN' });
      if (db.users.some((u) => u.email === email)) throw Object.assign(new Error('duplicate'), { code: 'EMAIL_TAKEN' });
      const u = { id: nextId('users'), username, email, passwordHash, avatar: null, balance: 0, createdAt: now() };
      db.users.push(u);
      return clone(u);
    },
    async findUserByEmail(email) { return clone(db.users.find((u) => u.email === email)) || null; },
    async findUserById(id) { return clone(user(id)) || null; },
    async updateUser(id, { username, email }) {
      if (db.users.some((u) => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: 'USERNAME_TAKEN' });
      if (db.users.some((u) => u.id !== id && u.email === email)) throw Object.assign(new Error('duplicate'), { code: 'EMAIL_TAKEN' });
      Object.assign(user(id), { username, email });
      return this.findUserById(id);
    },
    async updateAvatar(id, avatar) { user(id).avatar = avatar; return this.findUserById(id); },

    async createSession(userId, tokenHash, expiresAt) { db.sessions.push({ userId, tokenHash, expiresAt }); },
    async findSessionUser(tokenHash) {
      const s = db.sessions.find((x) => x.tokenHash === tokenHash && x.expiresAt > now());
      return s ? this.findUserById(s.userId) : null;
    },
    async deleteSession(tokenHash) { db.sessions = db.sessions.filter((x) => x.tokenHash !== tokenHash); },

    // ---------- Catalog ----------
    async listGames() {
      return db.games.map((g) => {
        const categories = db.categories.filter((c) => c.gameId === g.gameId).map((c) => {
          const active = db.listings.filter((l) => l.categoryId === c.categoryId && l.status === 'active');
          return { categoryId: c.categoryId, name: c.name, slug: c.slug, kind: c.kind, activeListings: active.length, minPrice: active.length ? Math.min(...active.map((l) => l.price)) : null };
        });
        const prices = categories.map((c) => c.minPrice).filter((p) => p != null);
        return {
          gameId: g.gameId, name: g.name, slug: g.slug, description: g.description,
          activeListings: categories.reduce((s, c) => s + c.activeListings, 0),
          minPrice: prices.length ? Math.min(...prices) : null,
          categories,
        };
      });
    },

    async searchListings({ game, category, q, sort = 'new', sellerId, status = 'active', limit = 24, offset = 0 } = {}) {
      let items = db.listings.map(listingOut).filter((l) =>
        (!status || l.status === status) && (!game || l.game.slug === game) && (!category || l.category.slug === category)
        && (!sellerId || l.seller.userId === sellerId) && (!q || l.title.toLowerCase().includes(q.toLowerCase())));
      const byNew = (a, b) => b.createdAt - a.createdAt || b.listingId - a.listingId;
      items.sort(sort === 'price_asc' ? (a, b) => a.price - b.price || b.listingId - a.listingId
        : sort === 'price_desc' ? (a, b) => b.price - a.price || b.listingId - a.listingId : byNew);
      const total = items.length;
      items = items.slice(offset, offset + limit);
      return { items, total };
    },

    async getListing(id) {
      const l = db.listings.find((x) => x.listingId === id);
      return l ? listingOut(l) : null;
    },
    async getCategory(categoryId) { return db.categories.find((c) => c.categoryId === categoryId) || null; },

    async createListing(sellerId, { categoryId, title, description, price, quantity }) {
      const listingId = nextId('listings');
      db.listings.push({ listingId, sellerId, categoryId, title, description, price, quantity, status: quantity > 0 ? 'active' : 'sold', createdAt: now() });
      return listingId;
    },

    async updateListing(listingId, sellerId, { title, description, price, quantity, status }) {
      const l = db.listings.find((x) => x.listingId === listingId && x.sellerId === sellerId);
      if (!l) return false;
      Object.assign(l, { title, description, price, quantity, status: status === 'closed' ? 'closed' : quantity === 0 ? 'sold' : 'active' });
      return true;
    },

    // ---------- Sellers ----------
    async getSellerProfile(username) {
      const u = db.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
      return u ? { userId: u.id, username: u.username, createdAt: u.createdAt, ...sellerStats(u.id) } : null;
    },
    async listReviews(sellerId, limit = 20) {
      return db.reviews.filter((r) => r.sellerId === sellerId).sort((a, b) => b.reviewId - a.reviewId).slice(0, limit).map((r) => ({
        reviewId: r.reviewId, rating: r.rating, text: r.text, createdAt: r.createdAt, author: user(r.authorId).username,
        title: db.listings.find((l) => l.listingId === db.orders.find((o) => o.orderId === r.orderId).listingId).title,
      }));
    },

    // ---------- Orders (same rules as stored procedures) ----------
    async createOrder(buyerId, listingId, quantity) {
      const l = db.listings.find((x) => x.listingId === listingId);
      if (!l || l.status !== 'active') throw domainError(50001, 'Лот недоступен');
      if (l.sellerId === buyerId) throw domainError(50002, 'Нельзя купить свой собственный лот');
      if (quantity < 1 || quantity > l.quantity) throw domainError(50003, 'У продавца нет такого количества');
      const total = round2(l.price * quantity);
      const buyer = user(buyerId);
      if (buyer.balance < total) throw domainError(50004, 'Недостаточно средств на балансе');
      buyer.balance = round2(buyer.balance - total);
      l.quantity -= quantity;
      if (l.quantity === 0) l.status = 'sold';
      const orderId = nextId('orders');
      db.orders.push({ orderId, listingId, buyerId, sellerId: l.sellerId, quantity, unitPrice: l.price, status: 'paid', createdAt: now(), closedAt: null });
      ledger(buyerId, orderId, -total, 'purchase');
      return orderId;
    },

    async getOrder(orderId) {
      const o = db.orders.find((x) => x.orderId === orderId);
      return o ? orderOut(o) : null;
    },
    async listOrders(userId, role) {
      return db.orders.filter((o) => (role === 'seller' ? o.sellerId : o.buyerId) === userId).sort((a, b) => b.orderId - a.orderId).map(orderOut);
    },

    async completeOrder(orderId, buyerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.buyerId === buyerId);
      if (!o) throw domainError(50005, 'Сделка не найдена');
      if (!['paid', 'disputed'].includes(o.status)) throw domainError(50006, 'Сделка уже закрыта');
      Object.assign(o, { status: 'completed', closedAt: now() });
      const total = round2(o.quantity * o.unitPrice);
      user(o.sellerId).balance = round2(user(o.sellerId).balance + total);
      ledger(o.sellerId, orderId, total, 'sale');
    },

    async refundOrder(orderId, sellerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.sellerId === sellerId);
      if (!o) throw domainError(50005, 'Сделка не найдена');
      if (!['paid', 'disputed'].includes(o.status)) throw domainError(50006, 'Сделка уже закрыта');
      Object.assign(o, { status: 'refunded', closedAt: now() });
      const total = round2(o.quantity * o.unitPrice);
      user(o.buyerId).balance = round2(user(o.buyerId).balance + total);
      ledger(o.buyerId, orderId, total, 'refund');
      const l = db.listings.find((x) => x.listingId === o.listingId);
      l.quantity += o.quantity;
      if (l.status === 'sold') l.status = 'active';
    },

    async disputeOrder(orderId, buyerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.buyerId === buyerId && x.status === 'paid');
      if (!o) return false;
      o.status = 'disputed';
      return true;
    },

    async listMessages(orderId) {
      return db.messages.filter((m) => m.orderId === orderId).map((m) => ({
        messageId: m.messageId, text: m.text, createdAt: m.createdAt, sender: { userId: m.senderId, username: user(m.senderId).username },
      }));
    },
    async addMessage(orderId, senderId, text) { db.messages.push({ messageId: nextId('messages'), orderId, senderId, text, createdAt: now() }); },

    async addReview(orderId, authorId, sellerId, rating, text) {
      if (db.reviews.some((r) => r.orderId === orderId)) throw Object.assign(new Error('duplicate'), { code: 'REVIEW_EXISTS' });
      db.reviews.push({ reviewId: nextId('reviews'), orderId, authorId, sellerId, rating, text, createdAt: now() });
    },

    // ---------- Wallet ----------
    async listTransactions(userId, limit = 50) {
      return db.transactions.filter((t) => t.userId === userId).sort((a, b) => b.transactionId - a.transactionId).slice(0, limit).map((t) => ({ ...t, userId: undefined }));
    },
    async deposit(userId, amount) {
      if (!(amount > 0) || amount > 100000) throw domainError(50007, 'Сумма пополнения должна быть от 1 до 100 000 ₽');
      user(userId).balance = round2(user(userId).balance + amount);
      ledger(userId, null, amount, 'deposit');
      return user(userId).balance;
    },

    async close() {},
  };

  if (demoData) seedDemo(repo, db, nextId);
  return repo;
}

// A small subset of database/04_seed.sql for DB_DRIVER=memory
function seedDemo(repo, db, nextId) {
  const mk = (username, email) => { const id = nextId('users'); db.users.push({ id, username, email, passwordHash: DEMO_HASH, avatar: null, balance: 0, createdAt: new Date() }); return id; };
  const demo = mk('demo', 'demo@example.com');
  const kraken = mk('KrakenTrader', 'kraken@example.com');
  const skins = mk('SkinMaster', 'skins@example.com');
  const cat = (game, slug) => db.categories.find((c) => c.slug === slug && db.games.find((g) => g.gameId === c.gameId).slug === game).categoryId;
  const add = (seller, game, c, title, price, quantity, description) => repo.createListing(seller, { categoryId: cat(game, c), title, description, price, quantity });
  return Promise.all([
    add(kraken, 'cs2', 'skins', 'AK-47 | Redline (Field-Tested)', 1250, 3, 'Передача через трейд Steam сразу после оплаты.'),
    add(skins, 'cs2', 'skins', 'AWP | Asiimov (Battle-Scarred)', 7490, 1, 'Без наклеек.'),
    add(kraken, 'dota2', 'items', 'Arcana Terrorblade — Fractal Horns', 2190, 5, 'Передача через трейд.'),
    add(kraken, 'genshin', 'crystals', '6480 кристаллов Сотворения (по UID)', 6990, 50, 'Пополнение по UID.'),
    add(skins, 'wow', 'gold', '100 000 золота — EU Gordunni (Орда)', 590, 30, 'Передача через почту.'),
    add(kraken, 'roblox', 'robux', '1000 Robux (выплата через группу)', 990, 100, 'Начисление моментально.'),
  ]).then(() => repo.deposit(demo, 10000));
}

module.exports = { createMemoryRepo };
