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

// 1×1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
      assert.equal((await req('/api/auth/login', { method: 'POST', body: { login: acc.email, password: 'wrong-pass' } })).status, 401);
      assert.equal((await req('/api/auth/login', { method: 'POST', body: { login: acc.email.toUpperCase(), password: acc.password } })).status, 200, 'email, any case');
      assert.equal((await getCtx().client()('/api/auth/login', { method: 'POST', body: { login: acc.username, password: acc.password } })).status, 200, 'nickname');

      // special code: second secret at login
      assert.equal((await req('/api/users/me/special-code', { method: 'PUT', body: { password: 'nope', code: '1234' } })).status, 403);
      assert.equal((await req('/api/users/me/special-code', { method: 'PUT', body: { password: acc.password, code: '12' } })).status, 400);
      assert.equal((await req('/api/users/me/special-code', { method: 'PUT', body: { password: acc.password, code: '4321' } })).json.specialCodeEnabled, true);
      let r2 = await getCtx().client()('/api/auth/login', { method: 'POST', body: { login: acc.username, password: acc.password } });
      assert.equal(r2.status, 401);
      assert.equal(r2.json.code, 'SPECIAL_CODE_REQUIRED');
      r2 = await getCtx().client()('/api/auth/login', { method: 'POST', body: { login: acc.username, password: acc.password, specialCode: '0000' } });
      assert.equal(r2.status, 401);
      r2 = await getCtx().client()('/api/auth/login', { method: 'POST', body: { login: acc.username, password: acc.password, specialCode: '4321' } });
      assert.equal(r2.status, 200);
      assert.equal(r2.json.user.specialCodeEnabled, true);

      // profile: real name, avatar (only raster images)
      r2 = await req('/api/users/me', { method: 'PUT', body: { username: acc.username, email: acc.email, realName: 'Ivan Petrov' } });
      assert.equal(r2.json.user.realName, 'Ivan Petrov');
      assert.equal((await req('/api/users/me/avatar', { method: 'PUT', body: { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400, 'no SVG');
      assert.equal((await req('/api/users/me/avatar', { method: 'PUT', body: { avatar: PNG } })).status, 200);
      const avatar = await req(`/img/avatars/${acc.username}`);
      assert.equal(avatar.status, 200);
      assert.equal(avatar.headers.get('content-type'), 'image/png');
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

      // "To chat" before buying
      assert.equal((await seller('/api/conversations', { method: 'POST', body: { listingId } })).status, 400, 'no chat with yourself');
      const preChat = (await buyer('/api/conversations', { method: 'POST', body: { listingId } })).json.conversationId;
      assert.equal((await buyer('/api/conversations', { method: 'POST', body: { listingId } })).json.conversationId, preChat, 'one chat per offer and buyer');
      await buyer(`/api/conversations/${preChat}/messages`, { method: 'POST', body: { text: 'Is it available?' } });
      assert.equal((await stranger(`/api/conversations/${preChat}`)).status, 404, 'chat is private');

      // money rules (stored procedure usp_CreateOrder)
      r = await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 2 } });
      assert.equal(r.status, 409, 'not enough money');
      assert.match(r.json.error, /Not enough money/);
      r = await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: 5000 } });
      assert.equal(r.json.balance, 5000);
      assert.equal((await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: -5 } })).status, 400);
      assert.equal((await seller('/api/orders', { method: 'POST', body: { listingId, quantity: 1 } })).status, 400, 'own listing');
      assert.equal((await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 4 } })).status, 409, 'too many');

      r = await buyer('/api/orders', { method: 'POST', body: { listingId, quantity: 2 } });
      assert.equal(r.status, 201);
      const { orderId, conversationId } = r.json;
      assert.equal(conversationId, preChat, 'purchase continues the chat that was opened with "To chat"');
      assert.equal((await buyer('/api/wallet')).json.balance, 3000);
      assert.equal((await buyer(`/api/listings/${listingId}`)).json.quantity, 1);

      // order is private to its participants
      assert.equal((await stranger(`/api/orders/${orderId}`)).status, 404);
      r = await seller(`/api/orders/${orderId}`);
      assert.equal(r.json.role, 'seller');
      assert.equal(r.json.totalPrice, 2000);
      assert.equal(r.json.status, 'paid');
      assert.equal((await seller('/api/my/orders?role=seller')).json[0].orderId, orderId);

      // chat: system message about the payment, text, picture, polling with ?after=
      await seller(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: { text: 'Трейд отправлен' } });
      r = await buyer(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: { attachment: PNG } });
      assert.equal(r.status, 201);
      r = await buyer(`/api/conversations/${conversationId}`);
      assert.equal(r.json.role, 'buyer');
      assert.equal(r.json.orders[0].orderId, orderId);
      const texts = r.json.messages.map((m) => m.text);
      assert.equal(texts[0], 'Is it available?');
      assert.match(texts[1], new RegExp(`Order #${orderId} paid`));
      assert.equal(r.json.messages[1].sender, null, 'system message');
      assert.equal(texts[2], 'Трейд отправлен');
      assert.equal(r.json.messages[3].attachment, PNG);
      const lastId = r.json.messages[2].messageId;
      assert.equal((await seller(`/api/conversations/${conversationId}/messages?after=${lastId}`)).json.length, 1);
      assert.equal((await buyer(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: { text: '  ' } })).status, 400);
      assert.equal((await buyer(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: { attachment: 'data:text/html;base64,PGI+' } })).status, 400);
      r = await buyer(`/api/conversations/${conversationId}/support`, { method: 'POST' });
      assert.ok(r.json.supportRequestedAt);
      assert.equal((await seller('/api/conversations')).json[0].conversationId, conversationId);

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
      assert.equal(r.json.socialCredit, 10 + 20 * 2, '+10 per deal, +20 per star above 3');
      assert.equal(r.json.reviews[0].text, 'Супер');
      assert.equal(r.json.listings.length, 1);
    }],

    ['marketplace: dispute → refund returns money and stock; last item → sold', async (assert) => {
      const seller = await signUp('seller2');
      const buyer = await signUp('buyer2');
      const catId = await categoryId(seller, 'eft', 'roubles');
      const { listingId } = (await seller('/api/listings', { method: 'POST', body: { categoryId: catId, title: `Gold ${tag}`, price: 250.5, quantity: 1 } })).json;
      await buyer('/api/wallet/deposit', { method: 'POST', body: { amount: 1000 } });

      const { orderId } = (await buyer('/api/orders', { method: 'POST', body: { listingId } })).json;
      assert.equal((await buyer(`/api/listings/${listingId}`)).json.status, 'sold');
      assert.equal((await buyer(`/api/listings?q=${encodeURIComponent('Gold ' + tag)}`)).json.total, 0, 'sold lots are hidden');

      assert.equal((await buyer(`/api/orders/${orderId}/dispute`, { method: 'POST' })).json.status, 'disputed');
      assert.equal((await buyer(`/api/orders/${orderId}/refund`, { method: 'POST' })).status, 403);
      assert.equal((await seller(`/api/orders/${orderId}/refund`, { method: 'POST' })).json.status, 'refunded');
      assert.equal((await buyer(`/api/users/seller2_${tag}`)).json.socialCredit, -100, '-100 for a refunded sale');

      const wallet = (await buyer('/api/wallet')).json;
      assert.equal(wallet.balance, 1000);
      assert.deepEqual(wallet.transactions.map((t) => t.type), ['refund', 'purchase', 'deposit']);
      const listing = (await buyer(`/api/listings/${listingId}`)).json;
      assert.equal(listing.status, 'active');
      assert.equal(listing.quantity, 1);
    }],

    ['listings: picture, only the owner can edit; closed lots disappear from the catalog', async (assert) => {
      const seller = await signUp('seller3');
      const other = await signUp('other3');
      const catId = await categoryId(seller, 'roblox', 'robux');
      const body = { categoryId: catId, title: `Robux ${tag}`, price: 100, quantity: 10 };
      assert.equal((await seller('/api/listings', { method: 'POST', body: { ...body, image: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400);
      const { listingId } = (await seller('/api/listings', { method: 'POST', body: { ...body, image: PNG } })).json;
      assert.equal((await other(`/api/listings/${listingId}`)).json.hasImage, true);
      const pic = await other(`/img/listings/${listingId}?v=1`);
      assert.equal(pic.headers.get('content-type'), 'image/png');

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
      for (const path of ['/api/wallet', '/api/my/orders', '/api/my/listings', '/api/orders/1', '/api/conversations', '/api/conversations/1']) {
        assert.equal((await req(path)).status, 401, path);
      }
      assert.equal((await req('/api/orders', { method: 'POST', body: { listingId: 1 } })).status, 401);
    }],
  ];
}

module.exports = { startServer, apiContract, PNG };
