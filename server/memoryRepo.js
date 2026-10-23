// In-memory implementation of the same repository interface as mssqlRepo.js.
// Used by automated tests and by DB_DRIVER=memory (run the site without SQL Server).
// Business rules mirror database/03_procedures.sql, including the same error numbers.

const DEMO_HASH = 'scrypt$e0daf5345b875e6b7cab1762bf920107$f621843a8ef15f17a56409a477232dbe0e1d2169f782a03b84ac6d1d3465156345121863d3fe358fb948e561ff51cba6141f18df192d98a9c28ee25394dc124d'; // demo1234

// [name, slug, section, description, [[category, slug, kind], ...]] — same as database/04_seed.sql
const GAMES = [
  ['Dota 2', 'dota2', 'game', 'Items, arcanas, accounts and MMR boosting', [['Items', 'items', 'item'], ['Accounts', 'accounts', 'account'], ['Boosting', 'boosting', 'service']]],
  ['Rust', 'rust', 'game', 'Skins and accounts', [['Skins', 'skins', 'item'], ['Accounts', 'accounts', 'account']]],
  ['EFT (Tarkov)', 'eft', 'game', 'Roubles, loot and accounts for Escape from Tarkov', [['Roubles', 'roubles', 'currency'], ['Items', 'items', 'item'], ['Accounts', 'accounts', 'account']]],
  ['Arena Breakout', 'arena-breakout', 'game', 'Koens, items and accounts', [['Koens', 'koens', 'currency'], ['Items', 'items', 'item'], ['Accounts', 'accounts', 'account']]],
  ['Stalzone', 'stalzone', 'game', 'In-game items for cheap', [['Items', 'items', 'item'], ['Currency', 'currency', 'currency'], ['Accounts', 'accounts', 'account']]],
  ['LoL', 'lol', 'game', 'League of Legends accounts, RP and boosting', [['Accounts', 'accounts', 'account'], ['Boosting', 'boosting', 'service'], ['RP', 'rp', 'currency']]],
  ['War Thunder', 'war-thunder', 'game', 'Golden Eagles, vehicles and accounts', [['Golden Eagles', 'golden-eagles', 'currency'], ['Vehicles', 'vehicles', 'item'], ['Accounts', 'accounts', 'account']]],
  ['Roblox', 'roblox', 'game', 'Robux and rare items', [['Robux', 'robux', 'currency'], ['Items', 'items', 'item']]],
  ['Clash Royale', 'clash-royale', 'game', 'Gems and accounts', [['Gems', 'gems', 'currency'], ['Accounts', 'accounts', 'account']]],
  ['Brawl Stars', 'brawl-stars', 'game', 'Gems and accounts', [['Gems', 'gems', 'currency'], ['Accounts', 'accounts', 'account']]],
  ['Arma 3', 'arma-3', 'game', 'Keys and accounts', [['Keys', 'keys', 'item'], ['Accounts', 'accounts', 'account']]],
  ['Squad', 'squad', 'game', 'Keys and accounts', [['Keys', 'keys', 'item'], ['Accounts', 'accounts', 'account']]],
  ['DayZ', 'dayz', 'game', 'Keys, accounts and services', [['Keys', 'keys', 'item'], ['Accounts', 'accounts', 'account'], ['Services', 'services', 'service']]],
  ['Steam', 'steam', 'game', 'Wallet top-ups, game keys and accounts', [['Wallet', 'wallet', 'currency'], ['Keys', 'keys', 'item'], ['Accounts', 'accounts', 'account']]],
  ['CS 2', 'cs2', 'game', 'Skins, cases and Prime accounts', [['Skins', 'skins', 'item'], ['Accounts', 'accounts', 'account'], ['Cases', 'cases', 'item']]],
  ['Fortnite', 'fortnite', 'game', 'V-Bucks and accounts', [['V-Bucks', 'v-bucks', 'currency'], ['Accounts', 'accounts', 'account']]],
  ['Gift Cards', 'gift-cards', 'service', 'Gift cards for Steam, PlayStation, Xbox and App Store', [['Steam', 'steam', 'giftcard'], ['PlayStation', 'playstation', 'giftcard'], ['Xbox', 'xbox', 'giftcard'], ['App Store', 'app-store', 'giftcard']]],
  ['Special apps', 'special-apps', 'service', 'Subscriptions: Discord Nitro, Spotify, Telegram Premium', [['Discord Nitro', 'discord-nitro', 'app'], ['Spotify', 'spotify', 'app'], ['Telegram Premium', 'telegram-premium', 'app']]],
];

const domainError = (number, message) => Object.assign(new Error(message), { number });
const duplicate = (code) => Object.assign(new Error('duplicate'), { code });
const round2 = (n) => Math.round(n * 100) / 100;
const fmtRub = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function createMemoryRepo({ demoData = false } = {}) {
  const db = {
    users: [], sessions: [], games: [], categories: [], listings: [], conversations: [], messages: [],
    orders: [], transactions: [], reviews: [], news: [],
    rates: [{ code: 'EUR', rate: 95.9299, updatedAt: new Date('2025-01-01') }, { code: 'USD', rate: 81.635, updatedAt: new Date('2025-01-01') }],
  };
  const seq = {};
  const nextId = (t) => (seq[t] = (seq[t] || 0) + 1);
  const now = () => new Date();

  GAMES.forEach(([name, slug, section, description, cats], i) => {
    const gameId = nextId('games');
    db.games.push({ gameId, name, slug, section, description, sortOrder: section === 'game' ? i + 1 : 100 + i });
    for (const [cname, cslug, kind] of cats) db.categories.push({ categoryId: nextId('categories'), gameId, name: cname, slug: cslug, kind });
  });

  const user = (id) => db.users.find((u) => u.id === id);
  const listingRow = (id) => db.listings.find((l) => l.listingId === id);
  const clone = (u) => u && { ...u };

  function stats(userId) {
    const reviews = db.reviews.filter((r) => r.sellerId === userId);
    const completed = db.orders.filter((o) => o.status === 'completed');
    return {
      salesCount: completed.filter((o) => o.sellerId === userId).length,
      dealsCount: completed.filter((o) => o.sellerId === userId || o.buyerId === userId).length,
      reviewsCount: reviews.length,
      avgRating: reviews.length ? round2(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : null,
      activeListings: db.listings.filter((l) => l.sellerId === userId && l.status === 'active').length,
      badSales: db.orders.filter((o) => o.sellerId === userId && ['disputed', 'refunded'].includes(o.status)).length,
      ratingBalance: reviews.reduce((s, r) => s + r.rating - 3, 0),
    };
  }

  const ledger = (userId, orderId, amount, type) => {
    db.transactions.push({ transactionId: nextId('transactions'), userId, orderId, amount, type, balanceAfter: user(userId).balance, createdAt: now() });
  };
  function post(conversationId, senderId, text, attachment = null) {
    db.messages.push({ messageId: nextId('messages'), conversationId, senderId, text, attachment, createdAt: now() });
    db.conversations.find((c) => c.conversationId === conversationId).lastMessageAt = now();
  }

  function listingOut(l) {
    const c = db.categories.find((x) => x.categoryId === l.categoryId);
    const g = db.games.find((x) => x.gameId === c.gameId);
    const s = stats(l.sellerId);
    return {
      listingId: l.listingId, title: l.title, description: l.description, price: l.price, quantity: l.quantity, status: l.status,
      hasImage: !!l.image, createdAt: l.createdAt, updatedAt: l.updatedAt,
      game: { slug: g.slug, name: g.name, section: g.section },
      category: { categoryId: c.categoryId, slug: c.slug, name: c.name, kind: c.kind },
      seller: { userId: l.sellerId, username: user(l.sellerId).username, avgRating: s.avgRating, salesCount: s.salesCount },
    };
  }

  function orderOut(o) {
    const l = listingOut(listingRow(o.listingId));
    return {
      orderId: o.orderId, listingId: o.listingId, conversationId: o.conversationId, title: l.title, game: { slug: l.game.slug, name: l.game.name },
      buyer: { userId: o.buyerId, username: user(o.buyerId).username },
      seller: { userId: o.sellerId, username: user(o.sellerId).username },
      quantity: o.quantity, unitPrice: o.unitPrice, totalPrice: round2(o.quantity * o.unitPrice),
      status: o.status, createdAt: o.createdAt, closedAt: o.closedAt,
      hasReview: db.reviews.some((r) => r.orderId === o.orderId),
    };
  }

  function conversationOut(c) {
    const l = listingRow(c.listingId);
    const last = db.messages.filter((m) => m.conversationId === c.conversationId).at(-1);
    return {
      conversationId: c.conversationId,
      listing: { listingId: l.listingId, title: l.title, price: l.price, status: l.status },
      buyer: { userId: c.buyerId, username: user(c.buyerId).username },
      seller: { userId: c.sellerId, username: user(c.sellerId).username },
      supportRequestedAt: c.supportRequestedAt, lastMessageAt: c.lastMessageAt,
      lastMessage: last ? last.text ?? '[image]' : null,
    };
  }

  function conversationFor(listingId, buyerId) {
    let c = db.conversations.find((x) => x.listingId === listingId && x.buyerId === buyerId);
    if (!c) {
      c = { conversationId: nextId('conversations'), listingId, buyerId, sellerId: listingRow(listingId).sellerId, supportRequestedAt: null, createdAt: now(), lastMessageAt: now() };
      db.conversations.push(c);
    }
    return c.conversationId;
  }

  const repo = {
    kind: 'memory',
    _db: db,

    async ping() { return true; },

    // ---------- Users & sessions ----------
    async createUser({ username, email, passwordHash }) {
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw duplicate('USERNAME_TAKEN');
      if (db.users.some((u) => u.email === email)) throw duplicate('EMAIL_TAKEN');
      const u = { id: nextId('users'), username, email, realName: null, passwordHash, specialCodeHash: null, avatar: null, balance: 0, createdAt: now() };
      db.users.push(u);
      return clone(u);
    },
    async findUserByLogin(login) {
      const l = login.toLowerCase();
      return clone(db.users.find((u) => u.email === l || u.username.toLowerCase() === l)) || null;
    },
    async findUserById(id) { return clone(user(id)) || null; },
    async updateUser(id, { username, email, realName }) {
      if (db.users.some((u) => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) throw duplicate('USERNAME_TAKEN');
      if (db.users.some((u) => u.id !== id && u.email === email)) throw duplicate('EMAIL_TAKEN');
      Object.assign(user(id), { username, email, realName });
      return this.findUserById(id);
    },
    async updateAvatar(id, avatar) { user(id).avatar = avatar; return this.findUserById(id); },
    async setSpecialCode(id, codeHash) { user(id).specialCodeHash = codeHash; },
    async getAvatar(username) { return db.users.find((u) => u.username.toLowerCase() === username.toLowerCase())?.avatar || null; },

    async createSession(userId, tokenHash, expiresAt) { db.sessions.push({ userId, tokenHash, expiresAt }); },
    async findSessionUser(tokenHash) {
      const s = db.sessions.find((x) => x.tokenHash === tokenHash && x.expiresAt > now());
      return s ? this.findUserById(s.userId) : null;
    },
    async deleteSession(tokenHash) { db.sessions = db.sessions.filter((x) => x.tokenHash !== tokenHash); },

    // ---------- Catalog ----------
    async listGames() {
      return [...db.games].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => {
        const categories = db.categories.filter((c) => c.gameId === g.gameId).map((c) => {
          const active = db.listings.filter((l) => l.categoryId === c.categoryId && l.status === 'active');
          return { categoryId: c.categoryId, name: c.name, slug: c.slug, kind: c.kind, activeListings: active.length, minPrice: active.length ? Math.min(...active.map((l) => l.price)) : null };
        });
        const prices = categories.map((c) => c.minPrice).filter((p) => p != null);
        return {
          gameId: g.gameId, name: g.name, slug: g.slug, section: g.section, description: g.description,
          activeListings: categories.reduce((s, c) => s + c.activeListings, 0),
          minPrice: prices.length ? Math.min(...prices) : null,
          categories,
        };
      });
    },

    async searchListings({ game, category, q, sort = 'new', sellerId, status = 'active', limit = 24, offset = 0 } = {}) {
      const needle = q?.toLowerCase();
      let items = db.listings.map(listingOut).filter((l) =>
        (!status || l.status === status) && (!game || l.game.slug === game) && (!category || l.category.slug === category)
        && (!sellerId || l.seller.userId === sellerId)
        && (!needle || l.title.toLowerCase().includes(needle) || l.game.name.toLowerCase().includes(needle)));
      const byNew = (a, b) => b.createdAt - a.createdAt || b.listingId - a.listingId;
      items.sort(sort === 'price_asc' ? (a, b) => a.price - b.price || b.listingId - a.listingId
        : sort === 'price_desc' ? (a, b) => b.price - a.price || b.listingId - a.listingId : byNew);
      const total = items.length;
      items = items.slice(offset, offset + limit);
      return { items, total };
    },

    async getListing(id) { const l = listingRow(id); return l ? listingOut(l) : null; },
    async getListingImage(id) { return listingRow(id)?.image || null; },
    async getCategory(categoryId) { return db.categories.find((c) => c.categoryId === categoryId) || null; },

    async createListing(sellerId, { categoryId, title, description, price, quantity, image = null }) {
      const listingId = nextId('listings');
      db.listings.push({ listingId, sellerId, categoryId, title, description, price, quantity, image, status: quantity > 0 ? 'active' : 'sold', createdAt: now(), updatedAt: now() });
      return listingId;
    },

    async updateListing(listingId, sellerId, { categoryId, title, description, price, quantity, status, image }) {
      const l = db.listings.find((x) => x.listingId === listingId && x.sellerId === sellerId);
      if (!l) return false;
      Object.assign(l, { categoryId, title, description, price, quantity, updatedAt: now(), status: status === 'closed' ? 'closed' : quantity === 0 ? 'sold' : 'active' });
      if (image !== undefined) l.image = image;
      return true;
    },

    // ---------- Users (public profile) ----------
    async getSellerProfile(username) {
      const u = db.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
      if (!u) return null;
      const { badSales, ratingBalance, ...s } = stats(u.id);
      return { userId: u.id, username: u.username, realName: u.realName, createdAt: u.createdAt, hasAvatar: !!u.avatar, ...s, socialCredit: 10 * s.dealsCount + 20 * ratingBalance - 100 * badSales };
    },
    async listReviews(sellerId, limit = 20) {
      return db.reviews.filter((r) => r.sellerId === sellerId).sort((a, b) => b.reviewId - a.reviewId).slice(0, limit).map((r) => ({
        reviewId: r.reviewId, rating: r.rating, text: r.text, createdAt: r.createdAt, author: user(r.authorId).username,
        title: listingRow(db.orders.find((o) => o.orderId === r.orderId).listingId).title,
      }));
    },

    // ---------- Conversations ----------
    async getOrCreateConversation(listingId, buyerId) {
      const l = listingRow(listingId);
      if (!l) throw domainError(50001, 'Offer not found');
      if (l.sellerId === buyerId) throw domainError(50002, 'You cannot chat with yourself about your own offer');
      return conversationFor(listingId, buyerId);
    },
    async getConversation(id) {
      const c = db.conversations.find((x) => x.conversationId === id);
      return c ? conversationOut(c) : null;
    },
    async listConversations(userId) {
      return db.conversations.filter((c) => c.buyerId === userId || c.sellerId === userId)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt || b.conversationId - a.conversationId).map(conversationOut);
    },
    async listMessages(conversationId, afterId = 0) {
      return db.messages.filter((m) => m.conversationId === conversationId && m.messageId > afterId).map((m) => ({
        messageId: m.messageId, text: m.text, attachment: m.attachment, createdAt: m.createdAt,
        sender: m.senderId == null ? null : { userId: m.senderId, username: user(m.senderId).username },
      }));
    },
    async addMessage(conversationId, senderId, text, attachment = null) { post(conversationId, senderId, text, attachment); },
    async requestSupport(conversationId) {
      const c = db.conversations.find((x) => x.conversationId === conversationId);
      if (c.supportRequestedAt) return;
      c.supportRequestedAt = now();
      post(conversationId, null, 'Support was called to this chat.');
    },

    // ---------- Orders (same rules as stored procedures) ----------
    async createOrder(buyerId, listingId, quantity) {
      const l = listingRow(listingId);
      if (!l || l.status !== 'active') throw domainError(50001, 'This offer is not available');
      if (l.sellerId === buyerId) throw domainError(50002, 'You cannot buy your own offer');
      if (quantity < 1 || quantity > l.quantity) throw domainError(50003, 'The seller does not have that many');
      const total = round2(l.price * quantity);
      const buyer = user(buyerId);
      if (buyer.balance < total) throw domainError(50004, 'Not enough money on your balance');
      buyer.balance = round2(buyer.balance - total);
      l.quantity -= quantity;
      if (l.quantity === 0) l.status = 'sold';
      const conversationId = conversationFor(listingId, buyerId);
      const orderId = nextId('orders');
      db.orders.push({ orderId, listingId, conversationId, buyerId, sellerId: l.sellerId, quantity, unitPrice: l.price, status: 'paid', createdAt: now(), closedAt: null });
      ledger(buyerId, orderId, -total, 'purchase');
      post(conversationId, null, `Order #${orderId} paid: ${quantity} × ${l.title} for ${fmtRub(total)} RUB. The money is held by Kraken Shop until the buyer confirms delivery.`);
      return { orderId, conversationId };
    },

    async getOrder(orderId) { const o = db.orders.find((x) => x.orderId === orderId); return o ? orderOut(o) : null; },
    async listOrders(userId, role) {
      return db.orders.filter((o) => (role === 'seller' ? o.sellerId : o.buyerId) === userId).sort((a, b) => b.orderId - a.orderId).map(orderOut);
    },
    async listConversationOrders(conversationId) {
      return db.orders.filter((o) => o.conversationId === conversationId).sort((a, b) => b.orderId - a.orderId).map(orderOut);
    },

    async completeOrder(orderId, buyerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.buyerId === buyerId);
      if (!o) throw domainError(50005, 'Order not found');
      if (!['paid', 'disputed'].includes(o.status)) throw domainError(50006, 'This order is already closed');
      Object.assign(o, { status: 'completed', closedAt: now() });
      const total = round2(o.quantity * o.unitPrice);
      user(o.sellerId).balance = round2(user(o.sellerId).balance + total);
      ledger(o.sellerId, orderId, total, 'sale');
      post(o.conversationId, null, `Order #${orderId} completed. The money was sent to the seller.`);
    },

    async refundOrder(orderId, sellerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.sellerId === sellerId);
      if (!o) throw domainError(50005, 'Order not found');
      if (!['paid', 'disputed'].includes(o.status)) throw domainError(50006, 'This order is already closed');
      Object.assign(o, { status: 'refunded', closedAt: now() });
      const total = round2(o.quantity * o.unitPrice);
      user(o.buyerId).balance = round2(user(o.buyerId).balance + total);
      ledger(o.buyerId, orderId, total, 'refund');
      const l = listingRow(o.listingId);
      l.quantity += o.quantity;
      if (l.status === 'sold') l.status = 'active';
      post(o.conversationId, null, `Order #${orderId} refunded. The money was returned to the buyer.`);
    },

    async disputeOrder(orderId, buyerId) {
      const o = db.orders.find((x) => x.orderId === orderId && x.buyerId === buyerId && x.status === 'paid');
      if (!o) return false;
      o.status = 'disputed';
      post(o.conversationId, null, `Order #${orderId}: the buyer opened a dispute. Support will join the chat.`);
      return true;
    },

    async addReview(orderId, authorId, sellerId, rating, text) {
      if (db.reviews.some((r) => r.orderId === orderId)) throw duplicate('REVIEW_EXISTS');
      db.reviews.push({ reviewId: nextId('reviews'), orderId, authorId, sellerId, rating, text, createdAt: now() });
    },

    // ---------- Wallet ----------
    async listTransactions(userId, limit = 50) {
      return db.transactions.filter((t) => t.userId === userId).sort((a, b) => b.transactionId - a.transactionId).slice(0, limit)
        .map(({ userId: _u, ...t }) => t);
    },
    async deposit(userId, amount) {
      if (!(amount > 0) || amount > 100000) throw domainError(50007, 'Top-up amount must be from 1 to 100 000 RUB');
      user(userId).balance = round2(user(userId).balance + amount);
      ledger(userId, null, amount, 'deposit');
      return user(userId).balance;
    },

    // ---------- News & exchange rates ----------
    async listNews(limit = 20) {
      return [...db.news].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit)
        .map((n) => ({ newsId: n.newsId, title: n.title, body: n.body, publishedAt: n.publishedAt, author: n.authorId ? user(n.authorId).username : null }));
    },
    async getRates() { return db.rates.map((r) => ({ ...r })); },
    async saveRates(rates) {
      for (const { code, rate } of rates) {
        const r = db.rates.find((x) => x.code === code);
        if (r) Object.assign(r, { rate, updatedAt: now() }); else db.rates.push({ code, rate, updatedAt: now() });
      }
    },

    async close() {},
  };

  if (demoData) seedDemo(repo, db, nextId);
  return repo;
}

// A subset of database/04_seed.sql for DB_DRIVER=memory and tests
function seedDemo(repo, db, nextId) {
  const mk = (username, email, realName) => {
    const id = nextId('users');
    db.users.push({ id, username, email, realName, passwordHash: DEMO_HASH, specialCodeHash: null, avatar: null, balance: 0, createdAt: new Date() });
    return id;
  };
  const demo = mk('demo', 'demo@example.com', 'Demo Buyer');
  const kraken = mk('KrakenTrader', 'kraken@example.com', 'Alex Kraken');
  const skins = mk('SkinMaster', 'skins@example.com', null);
  const team = mk('KrakenTeam', 'team@example.com', 'Kraken Shop');
  const cat = (game, slug) => db.categories.find((c) => c.slug === slug && db.games.find((g) => g.gameId === c.gameId).slug === game).categoryId;
  const add = (seller, game, c, title, price, quantity, description) => repo.createListing(seller, { categoryId: cat(game, c), title, description, price, quantity });

  add(kraken, 'stalzone', 'items', 'Gauss Gun — Legendary', 24490, 3, 'Gauss gun with max upgrades. Delivery in game after payment.');
  add(skins, 'stalzone', 'items', 'Gauss Gun — Epic', 12990, 5, 'Epic Gauss gun, no wear.');
  add(kraken, 'cs2', 'skins', 'AK-47 | Redline (Field-Tested)', 1250, 3, 'Steam trade right after payment.');
  add(skins, 'cs2', 'skins', 'AWP | Asiimov (Battle-Scarred)', 7490, 1, 'No stickers.');
  add(kraken, 'dota2', 'items', 'Arcana Terrorblade — Fractal Horns', 2190, 5, 'Steam trade.');
  add(skins, 'eft', 'roubles', '10 000 000 roubles (EU servers)', 1890, 20, 'Transfer via the flea market.');
  add(kraken, 'roblox', 'robux', '1000 Robux (group payout)', 990, 100, 'Instant payout.');
  add(kraken, 'gift-cards', 'steam', 'Steam Wallet card 1000 RUB', 1090, 20, 'Gift card code, RU/CIS region.');
  repo.deposit(demo, 10000);
  db.news.push(
    { newsId: nextId('news'), authorId: team, title: 'Kraken Shop is open!', body: 'Buy and sell in-game items, currency and accounts. Every deal goes through escrow.', publishedAt: new Date(Date.now() - 30 * 864e5) },
    { newsId: nextId('news'), authorId: team, title: 'New sections: Gift Cards and Special apps', body: 'Gift cards and subscriptions are now available in the Services menu.', publishedAt: new Date(Date.now() - 864e5) },
  );
}

module.exports = { createMemoryRepo };
