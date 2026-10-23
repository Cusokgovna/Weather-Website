// Starts the app on a random port and provides a cookie-keeping HTTP client.
const { createApp } = require('../server/app');

async function startServer(repo, opts = {}) {
  const app = createApp({ repo, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // Tiny client that keeps the session cookie like a browser
  function client() {
    let cookie = '';
    return async function request(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, headers: res.headers, text, json };
    };
  }

  return { base, client, close: () => new Promise((r) => server.close(r)) };
}

// Shared API contract: the same scenarios run against the memory repo and against real SQL Server.
// Every run creates its own users, so it also works on a database with seed data.
function apiContract(getCtx) {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const account = (role) => ({ username: `${role}_${tag}`, email: `${role}.${tag}@example.com`, password: 'secret123' });

  async function signUp(role) {
    const req = getCtx().client();
    const r = await req('/api/auth/register', { method: 'POST', body: account(role) });
    if (r.status !== 201) throw new Error(`register ${role}: ${r.status} ${r.text}`);
    return req;
  }

  async function categoryId(req, game, slug) {
    const games = (await req('/api/games')).json;
    return games.find((g) => g.slug === game).categories.find((c) => c.slug === slug).categoryId;
  }

  return [
    ['auth: register, duplicates, me, logout, login', async (assert) => {
      const req = getCtx().client();
      const acc = account('auth');
      let r = await req('/api/auth/register', { method: 'POST', body: acc });
      assert.equal(r.status, 201);
      assert.equal(r.json.user.username, acc.username);
      assert.equal(r.json.user.balance, 0);
      assert.equal(r.json.user.passwordHash, undefined, 'password hash must not leak');

      r = await getCtx().client()('/api/auth/register', { method: 'POST', body: { ...acc, email: 'other' + acc.email } });
      assert.equal(r.status, 409, 'username taken');
      r = await getCtx().client()('/api/auth/register', { method: 'POST', body: { ...acc, username: acc.username + 'x' } });
      assert.equal(r.status, 409, 'email taken');
      r = await getCtx().client()('/api/auth/register', { method: 'POST', body: { ...acc, username: 'bad name!' } });
      assert.equal(r.status, 400);

      assert.equal((await req('/api/auth/me')).json.user.email, acc.email);
      assert.equal((await req('/api/auth/logout', { method: 'POST' })).status, 204);
      assert.equal((await req('/api/auth/me')).json.user, null);
      assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: acc.email, password: 'wrong-pass' } })).status, 401);
      assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: acc.email.toUpperCase(), password: acc.password } })).status, 200);
    }],

    ['marketplace: listing → purchase → chat → confirm → review', async (assert) => {
      const seller = await signUp('seller');
      const buyer = await signUp('buyer');
      const stranger = await signUp('stranger');
      const catId = await categoryId(seller, 'cs2', 'skins');

      // validation
      assert.equal((await seller('/api/listings', { method: 'POST', body: { categoryId: 999999, title: 'Test', price: 10, quantity: 1 } })).status, 400);
      assert.equal((await seller('/api/listings', { method: 'POST', body: { categoryId: catId, title: 'Test', price: 0, quantity: 1 } })).status, 400);

      const title = `M4A4 Howl ${tag}`;
      let r = await seller('/api/listings', { method: 'POST', body: { categoryId: catId, title, description: 'FN', price: 1000, quantity: 3 } });
      assert.equal(r.status, 201);
      const { listingId } = r.json;

      r = await buyer(`/api/listings?game=cs2&category=skins&q=${encodeURIComponent(tag)}`);
      assert.equal(r.json.total, 1);
      assert.equal(r.json.items[0].seller.username, `seller_${tag}`);
      r = await buyer(`/api/listings/${listingId}`);
      assert.equal(r.json.game.slug, 'cs2');
      assert.equal(r.json.price, 1000);

      // money rules (stored procedure usp_CreateOrder)
      r = await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 2 } });
      assert.equal(r.status, 409, 'not enough money');
      assert.match(r.json.error, /Недостаточно средств/);
      r = await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: 5000 } });
      assert.equal(r.json.balance, 5000);
      assert.equal((await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: -5 } })).status, 400);
      assert.equal((await seller('/api/orders', { method: 'POST', body: { listingId, quantity: 1 } })).status, 400, 'own listing');
      assert.equal((await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 4 } })).status, 409, 'too many');

      r = await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 2 } });
      assert.equal(r.status, 201);
      const { orderId } = r.json;
      assert.equal((await buyer('/api/wallet')).json.balance, 3000);
      assert.equal((await buyer(`/api/listings/${listingId}`)).json.quantity, 1);

      // order is private to its participants
      assert.equal((await stranger(`/api/orders/${orderId}`)).status, 404);
      r = await seller(`/api/orders/${orderId}`);
      assert.equal(r.json.role, 'seller');
      assert.equal(r.json.totalPrice, 2000);
      assert.equal(r.json.status, 'paid');
      assert.equal((await seller('/api/my/orders?role=seller')).json[0].orderId, orderId);

      // chat
      await seller(`/api/orders/${orderId}/messages`, { method: 'POST', body: { text: 'Трейд отправлен' } });
      r = await buyer(`/api/orders/${orderId}/messages`, { method: 'POST', body: { text: 'Получил, спасибо' } });
      assert.deepEqual(r.json.map((m) => m.text), ['Трейд отправлен', 'Получил, спасибо']);
      assert.equal((await buyer(`/api/orders/${orderId}/messages`, { method: 'POST', body: { text: '  ' } })).status, 400);

      // confirm → seller gets money
      assert.equal((await buyer(`/api/orders/${orderId}/review`, { method: 'POST', body: { rating: 5 } })).status, 409, 'review before completion');
      assert.equal((await seller(`/api/orders/${orderId}/confirm`, { method: 'POST' })).status, 403);
      r = await buyer(`/api/orders/${orderId}/confirm`, { method: 'POST' });
      assert.equal(r.json.status, 'completed');
      assert.equal((await seller('/api/wallet')).json.balance, 2000);
      assert.equal((await buyer(`/api/orders/${orderId}/confirm`, { method: 'POST' })).status, 409, 'already closed');

      assert.equal((await buyer(`/api/orders/${orderId}/review`, { method: 'POST', body: { rating: 6 } })).status, 400);
      assert.equal((await buyer(`/api/orders/${orderId}/review`, { method: 'POST', body: { rating: 5, text: 'Супер' } })).status, 201);
      assert.equal((await buyer(`/api/orders/${orderId}/review`, { method: 'POST', body: { rating: 4 } })).status, 409, 'one review per order');

      r = await stranger(`/api/users/seller_${tag}`);
      assert.equal(r.json.salesCount, 1);
      assert.equal(r.json.avgRating, 5);
      assert.equal(r.json.reviews[0].text, 'Супер');
      assert.equal(r.json.listings.length, 1);
    }],

    ['marketplace: dispute → refund returns money and stock; last item → sold', async (assert) => {
      const seller = await signUp('seller2');
      const buyer = await signUp('buyer2');
      const catId = await categoryId(seller, 'wow', 'gold');
      const { listingId } = (await seller('/api/listings', { method: 'POST', body: { categoryId: catId, title: `Gold ${tag}`, price: 250.5, quantity: 1 } })).json;
      await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: 1000 } });

      const { orderId } = (await buyer('/api/orders', { method: 'POST', body: { listingId } })).json;
      assert.equal((await buyer(`/api/listings/${listingId}`)).json.status, 'sold');
      assert.equal((await buyer(`/api/listings?q=${encodeURIComponent('Gold ' + tag)}`)).json.total, 0, 'sold lots are hidden');

      assert.equal((await buyer(`/api/orders/${orderId}/dispute`, { method: 'POST' })).json.status, 'disputed');
      assert.equal((await buyer(`/api/orders/${orderId}/refund`, { method: 'POST' })).status, 403);
      assert.equal((await seller(`/api/orders/${orderId}/refund`, { method: 'POST' })).json.status, 'refunded');

      const wallet = (await buyer('/api/wallet')).json;
      assert.equal(wallet.balance, 1000);
      assert.deepEqual(wallet.transactions.map((t) => t.type), ['refund', 'purchase', 'deposit']);
      const listing = (await buyer(`/api/listings/${listingId}`)).json;
      assert.equal(listing.status, 'active');
      assert.equal(listing.quantity, 1);
    }],

    ['listings: only the owner can edit; closed lots disappear from the catalog', async (assert) => {
      const seller = await signUp('seller3');
      const other = await signUp('other3');
      const catId = await categoryId(seller, 'roblox', 'robux');
      const body = { categoryId: catId, title: `Robux ${tag}`, price: 100, quantity: 10 };
      const { listingId } = (await seller('/api/listings', { method: 'POST', body })).json;

      assert.equal((await other(`/api/listings/${listingId}`, { method: 'PUT', body: { ...body, price: 1 } })).status, 404);
      let r = await seller(`/api/listings/${listingId}`, { method: 'PUT', body: { ...body, price: 90 } });
      assert.equal(r.json.price, 90);
      r = await seller(`/api/listings/${listingId}`, { method: 'PUT', body: { ...body, status: 'closed' } });
      assert.equal(r.json.status, 'closed');
      assert.equal((await other(`/api/listings?q=${encodeURIComponent('Robux ' + tag)}`)).json.total, 0);
      assert.equal((await seller('/api/my/listings')).json[0].status, 'closed', 'owner still sees it');
    }],

    ['protected endpoints require sign in', async (assert) => {
      const req = getCtx().client();
      for (const path of ['/api/wallet', '/api/my/orders', '/api/my/listings', '/api/orders/1']) {
        assert.equal((await req(path)).status, 401, path);
      }
      assert.equal((await req('/api/orders', { method: 'POST', body: { listingId: 1 } })).status, 401);
    }],
  ];
}

module.exports = { startServer, apiContract };
