// Starts the app on a random port with the given repository and a fake OpenWeather.
const { createApp } = require('../server/app');

// Fake OpenWeather: returns fixed JSON depending on the requested path
async function fakeOpenWeather(url) {
  const u = new URL(url);
  if (u.searchParams.get('appid') !== 'test-key') return Response.json({ message: 'Invalid API key' }, { status: 401 });
  if (u.pathname === '/data/2.5/weather') {
    return Response.json({
      name: 'Novosibirsk', sys: { country: 'RU' },
      main: { temp: 273.15 + 5, feels_like: 273.15 + 2, humidity: 60, pressure: 1015 },
      wind: { speed: 3 }, weather: [{ description: 'clear sky', icon: '01d' }],
    });
  }
  if (u.pathname === '/geo/1.0/direct') return Response.json([{ name: 'Novosibirsk', country: 'RU', lat: 55.0282171, lon: 82.9234509 }]);
  return Response.json({});
}

async function startServer(repo, opts = {}) {
  const app = createApp({ repo, openWeatherKey: 'test-key', fetchImpl: fakeOpenWeather, ...opts });
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

// Shared API contract: the same checks run against the memory repo and against real SQL Server.
function apiContract(t, getCtx) {
  const unique = `u${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

  return [
    ['register → me → logout → login', async (assert) => {
      const req = getCtx().client();
      let r = await req('/api/auth/register', { method: 'POST', body: { name: 'Tester', email: unique, password: 'secret123' } });
      assert.equal(r.status, 201);
      assert.equal(r.json.user.email, unique);
      assert.equal(r.json.user.passwordHash, undefined, 'password hash must not leak');

      r = await req('/api/auth/me');
      assert.equal(r.status, 200);
      assert.equal(r.json.user.name, 'Tester');

      r = await req('/api/auth/register', { method: 'POST', body: { name: 'Tester', email: unique, password: 'secret123' } });
      assert.equal(r.status, 409, 'duplicate email');

      r = await req('/api/auth/logout', { method: 'POST' });
      assert.equal(r.status, 204);
      r = await req('/api/auth/me');
      assert.equal(r.status, 200);
      assert.equal(r.json.user, null, 'signed out');

      r = await req('/api/auth/login', { method: 'POST', body: { email: unique, password: 'wrong-pass' } });
      assert.equal(r.status, 401);
      r = await req('/api/auth/login', { method: 'POST', body: { email: unique.toUpperCase(), password: 'secret123' } });
      assert.equal(r.status, 200);
    }],

    ['profile, settings, favorites and history', async (assert) => {
      const req = getCtx().client();
      const email = 'p' + unique;
      await req('/api/auth/register', { method: 'POST', body: { name: 'Profile', email, password: 'secret123' } });

      let r = await req('/api/users/me', { method: 'PUT', body: { name: 'Renamed', email } });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.name, 'Renamed');

      r = await req('/api/users/me/avatar', { method: 'PUT', body: { avatar: 'data:image/png;base64,AAAA' } });
      assert.equal(r.json.user.avatar, 'data:image/png;base64,AAAA');
      r = await req('/api/users/me/avatar', { method: 'PUT', body: { avatar: 'javascript:alert(1)' } });
      assert.equal(r.status, 400);

      r = await req('/api/users/me/settings', { method: 'PUT', body: { theme: 'light' } });
      assert.equal(r.json.theme, 'light');
      r = await req('/api/users/me/settings', { method: 'PUT', body: { theme: 'pink' } });
      assert.equal(r.status, 400);

      const city = { name: 'Novosibirsk', country: 'ru', lat: 55.0282171, lon: 82.9234509 };
      r = await req('/api/favorites', { method: 'POST', body: city });
      assert.equal(r.status, 201);
      const { cityId } = r.json;
      r = await req('/api/favorites', { method: 'POST', body: city });
      assert.equal(r.json.cityId, cityId, 'same coordinates → same city');

      r = await req('/api/favorites');
      assert.equal(r.json.length, 1);
      assert.equal(r.json[0].country, 'RU');
      assert.equal(r.json[0].lat, 55.0282);

      r = await req('/api/history', { method: 'POST', body: city });
      assert.equal(r.status, 201);
      r = await req('/api/history');
      assert.equal(r.json.length, 1);
      assert.equal(r.json[0].name, 'Novosibirsk');

      r = await req(`/api/favorites/${cityId}`, { method: 'DELETE' });
      assert.equal(r.status, 204);
      r = await req(`/api/favorites/${cityId}`, { method: 'DELETE' });
      assert.equal(r.status, 404);

      r = await req('/api/favorites', { method: 'POST', body: { name: 'Nowhere', lat: 200, lon: 0 } });
      assert.equal(r.status, 400);
    }],

    ['protected endpoints require sign in', async (assert) => {
      const req = getCtx().client();
      for (const path of ['/api/favorites', '/api/history', '/api/users/me/settings']) {
        assert.equal((await req(path)).status, 401, path);
      }
    }],
  ];
}

module.exports = { startServer, apiContract };
