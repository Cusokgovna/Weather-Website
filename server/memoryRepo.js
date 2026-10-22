// In-memory implementation of the same repository interface as mssqlRepo.js.
// Used by automated tests and by DB_DRIVER=memory (run the site without SQL Server).

function createMemoryRepo() {
  const db = { users: [], settings: new Map(), sessions: [], cities: [], favorites: [], history: [], snapshots: [] };
  let seq = 0;
  const nextId = () => ++seq;
  const clone = (u) => u && { ...u };
  const cityOut = (c) => ({ cityId: c.cityId, name: c.name, country: c.country, state: c.state, lat: c.lat, lon: c.lon });

  return {
    kind: 'memory',
    _db: db,

    async ping() { return true; },

    async createUser({ name, email, passwordHash }) {
      if (db.users.some((u) => u.email === email)) throw Object.assign(new Error('duplicate'), { code: 'EMAIL_TAKEN' });
      const user = { id: nextId(), name, email, passwordHash, avatar: null, createdAt: new Date() };
      db.users.push(user);
      db.settings.set(user.id, { theme: 'dark', units: 'metric', language: 'en' });
      return clone(user);
    },
    async findUserByEmail(email) { return clone(db.users.find((u) => u.email === email)) || null; },
    async findUserById(id) { return clone(db.users.find((u) => u.id === id)) || null; },
    async updateUser(id, { name, email }) {
      if (db.users.some((u) => u.email === email && u.id !== id)) throw Object.assign(new Error('duplicate'), { code: 'EMAIL_TAKEN' });
      Object.assign(db.users.find((u) => u.id === id), { name, email });
      return this.findUserById(id);
    },
    async updateAvatar(id, avatar) {
      db.users.find((u) => u.id === id).avatar = avatar;
      return this.findUserById(id);
    },

    async getSettings(userId) { return { ...(db.settings.get(userId) || { theme: 'dark', units: 'metric', language: 'en' }) }; },
    async saveSettings(userId, s) { db.settings.set(userId, { ...s }); return this.getSettings(userId); },

    async createSession(userId, tokenHash, expiresAt) { db.sessions.push({ userId, tokenHash, expiresAt }); },
    async findSessionUser(tokenHash) {
      const s = db.sessions.find((x) => x.tokenHash === tokenHash && x.expiresAt > new Date());
      return s ? this.findUserById(s.userId) : null;
    },
    async deleteSession(tokenHash) { db.sessions = db.sessions.filter((x) => x.tokenHash !== tokenHash); },

    async upsertCity({ name, country, state, lat, lon }) {
      let c = db.cities.find((x) => x.lat === lat && x.lon === lon);
      if (!c) { c = { cityId: nextId(), name, country: country || null, state: state || null, lat, lon }; db.cities.push(c); }
      return c.cityId;
    },

    async listFavorites(userId) {
      return db.favorites
        .filter((f) => f.userId === userId)
        .map((f) => ({ ...cityOut(db.cities.find((c) => c.cityId === f.cityId)), addedAt: f.addedAt }));
    },
    async addFavorite(userId, cityId) {
      if (!db.favorites.some((f) => f.userId === userId && f.cityId === cityId)) db.favorites.push({ userId, cityId, addedAt: new Date() });
    },
    async removeFavorite(userId, cityId) {
      const before = db.favorites.length;
      db.favorites = db.favorites.filter((f) => !(f.userId === userId && f.cityId === cityId));
      return db.favorites.length < before;
    },

    async addHistory(userId, cityId) { db.history.push({ id: nextId(), userId, cityId, searchedAt: new Date() }); },
    async listHistory(userId, limit = 10) {
      return db.history
        .filter((h) => h.userId === userId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map((h) => ({ ...cityOut(db.cities.find((c) => c.cityId === h.cityId)), searchedAt: h.searchedAt }));
    },

    async saveSnapshot(cityId, s) { db.snapshots.push({ cityId, ...s, observedAt: new Date() }); },

    async close() {},
  };
}

module.exports = { createMemoryRepo };
