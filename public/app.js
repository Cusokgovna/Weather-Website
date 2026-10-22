/* Main application logic. Weather data: OpenWeather via our server proxy (/api/ow).
   Accounts, favorites, search history and settings: our API backed by Microsoft SQL Server. */
import { debounce, cache, fmt } from './utils.js';
import { owFetch, apiFetch } from './api.js';

const el = (id) => document.getElementById(id);
const HAS_WEATHER_UI = !!document.getElementById('current');
const q = el('q');
const suggestions = el('suggestions');
const useLocationBtn = el('useLocation');
const toggleTheme = el('toggleTheme');
const favToggle = el('favToggle');
const DEFAULT_CITY = 'Novosibirsk'; // shown on the first visit

const state = {
  place: null,      // { name, country, state, lat, lon } of the city shown on the home page
  favorites: [],    // favorites of the signed-in user (from /api/favorites)
};

const sameCoords = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lon - b.lon) < 1e-3;

// ====== AUTH (server sessions, HttpOnly cookie) ======
// localStorage "session" keeps only { name, email } to paint the header instantly; the cookie is the real auth.
window.Auth = {
  user: null,
  current() {
    if (this.user) return this.user;
    try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; }
  },
  _set(user) {
    this.user = user;
    if (user) localStorage.setItem('session', JSON.stringify({ name: user.name, email: user.email }));
    else localStorage.removeItem('session');
    try { window.setAuthUI(); } catch {}
    window.dispatchEvent(new CustomEvent('auth:change', { detail: user }));
  },
  async refresh() {
    try {
      const { user } = await apiFetch('/auth/me');
      this._set(user);
    } catch {
      // server unreachable: keep the cached header state
    }
    return this.user;
  },
  async register({ name, email, password }) {
    const { user } = await apiFetch('/auth/register', { method: 'POST', body: { name, email, password } });
    this._set(user);
  },
  async login({ email, password }) {
    const { user } = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    this._set(user);
  },
  async logout() {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    this._set(null);
  },
  setUser(user) { this._set(user); },
};

// Header: name + avatar + which menu items are visible
window.setAuthUI = function setAuthUI() {
  const cur = window.Auth.current();
  const profileBtn = el('profileBtn');
  const headerAvatar = el('headerAvatar');
  const logout = el('logout');
  const authBtns = ['openAuth', 'openAuth2', 'openAuthMobile'].map(el).filter(Boolean);

  if (profileBtn) profileBtn.textContent = cur ? (cur.name || cur.email) : 'Guest';
  if (logout) logout.hidden = !cur;
  authBtns.forEach((b) => (b.hidden = !!cur));
  document.body.dataset.auth = cur ? 'on' : 'off';

  const avatar = window.Auth.user?.avatar;
  if (headerAvatar) {
    if (cur && avatar) { headerAvatar.src = avatar; headerAvatar.style.display = 'inline-block'; }
    else { headerAvatar.removeAttribute('src'); headerAvatar.style.display = 'none'; }
  }
};
try { window.setAuthUI(); } catch (e) {}

// Resolves once we know whether the visitor is signed in (other scripts may await it)
window.Auth.ready = window.Auth.refresh();

// ====== THEME (localStorage for guests, UserSettings table for signed-in users) ======
function setTheme(light) {
  document.body.classList.toggle('light', !!light);
  localStorage.setItem('theme', light ? 'light' : 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) setTheme(saved === 'light');
  else setTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
})();
toggleTheme.addEventListener('click', () => {
  const light = !document.body.classList.contains('light');
  setTheme(light);
  if (window.Auth.user) apiFetch('/users/me/settings', { method: 'PUT', body: { theme: light ? 'light' : 'dark' } }).catch(() => {});
});

window.addEventListener('auth:change', async (e) => {
  if (!e.detail) { state.favorites = []; syncFavToggle(); return; }
  try {
    const settings = await apiFetch('/users/me/settings');
    setTheme(settings.theme === 'light');
  } catch {}
  await loadFavorites();
});

async function loadFavorites() {
  try { state.favorites = window.Auth.user ? await apiFetch('/favorites') : []; } catch { state.favorites = []; }
  syncFavToggle();
}

function syncFavToggle() {
  if (!favToggle) return;
  const on = !!state.favorites.find((f) => sameCoords(f, state.place));
  favToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  favToggle.textContent = on ? '★' : '☆';
  favToggle.title = on ? 'Remove from favorites' : 'Add to favorites';
}

function setStatus(msg, type='info') {
  const box = el('status');
  if (!box) return;
  box.textContent = msg || '';
  box.className = 'status ' + type;
  if (!msg) box.removeAttribute('class');
}

async function geocode(city) {
  const ckey = `geocode:${city}`;
  const cached = cache.get(ckey);
  if (cached) return cached;
  const r = await owFetch('/geo/1.0/direct', { q: city, limit: 5 });
  if (!r.ok) throw new Error('Geocoding error');
  const data = await r.json();
  cache.set(ckey, data, 24 * 60 * 60 * 1000);
  return data;
}

async function getWeather(lat, lon) {
  const ckey = `weather2:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cache.get(ckey);
  if (cached) return cached;

  // First fetch current (shows faster), then load forecast and AQI in background
  const currentRes = await owFetch('/data/2.5/weather', { lat, lon }, { timeout: 6000 });
  if (!currentRes.ok) {
    if (currentRes.status === 401) setStatus('OpenWeather API key on the server is invalid', 'error');
    if (currentRes.status === 503) setStatus('OPENWEATHER_KEY is not configured on the server (.env)', 'error');
    throw new Error('Weather API (current)');
  }
  const current = await currentRes.json();

  // Parallel: forecast (may take longer), AQI will be fetched later
  const forecastP = owFetch('/data/2.5/forecast', { lat, lon }, { timeout: 8000 })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  const airP = owFetch('/data/2.5/air_pollution', { lat, lon }, { timeout: 5000 })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const payload = { current, forecast: await forecastP, air: null };
  cache.set(ckey, payload, 3 * 60 * 1000);

  // Return without AQI so UI can render immediately; AQI will be applied when ready
  airP.then(air => {
    const updated = { ...payload, air };
    cache.set(ckey, updated, 3 * 60 * 1000);
    // if we're still on this location — redraw AQI
    try { renderAQI(updated); } catch {}
  });

  return payload;
}

function renderCurrent(placeName, w) {
  if (!HAS_WEATHER_UI) return;
  const { current } = w;
  el('place').textContent = placeName || `${current.name ?? ''}${current.sys?.country ? ', ' + current.sys.country : ''}`;
  el('updated').textContent = new Date().toLocaleString();

  const tzOffset = current.timezone ?? 0;
  el('temp').textContent = `${fmt.tempKtoC(current.main.temp)}°`;
  el('feels').textContent = `${fmt.tempKtoC(current.main.feels_like)}°`;
  el('wind').textContent = fmt.wind(current.wind.speed);
  el('humidity').textContent = `${current.main.humidity}%`;
  el('pressure').textContent = fmt.pressure(current.main.pressure);
  el('desc').textContent = current.weather?.[0]?.description ?? '—';

  const icon = current.weather?.[0]?.icon;
  const iconEl = document.getElementById('icon');
  if (icon) {
    iconEl.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
    iconEl.width = 100; iconEl.height = 100;
    iconEl.style.opacity = '1';
  } else {
    iconEl.removeAttribute('src'); iconEl.style.opacity = '0';
  }

  document.querySelector('.current-wrap').classList.remove('skeleton');

  syncFavToggle();
}

function renderHourly(w) {
  if (!HAS_WEATHER_UI) return;
  const root = el('hourly');
  root.innerHTML = '';
  const list = w.forecast?.list ?? [];
  const tzOffset = w.current?.timezone ?? 0;
  list.slice(0, 8).forEach(item => {
    const div = document.createElement('div');
    div.className = 'tile';
    const icon = item.weather?.[0]?.icon;
    div.innerHTML = `
      <div class="s">${fmt.timeHM(item.dt, tzOffset)}</div>
      <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="" width="50" height="50" />
      <div class="t">${fmt.tempKtoC(item.main.temp)}°</div>
    `;
    root.appendChild(div);
  });
  root.classList.remove('skeleton');
  // Draw hourly chart if canvas exists
  try {
    const canvas = document.getElementById('hourlyChart');
    if (canvas && list.length) {
      renderHourlyChart(canvas, list.slice(0, 24), tzOffset);
    }
  } catch (e) { console.warn('Chart render failed', e); }
}

// Simple canvas line chart for hourly temperatures (expects forecast.list items)
function renderHourlyChart(canvas, items, tzOffset = 0) {
  if (!canvas) return;
  // store latest data on the canvas element for redrawing on resize
  try { canvas._chartData = { items, tzOffset }; } catch {}
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const temps = items.map(it => fmt.tempKtoC(it.main.temp));
  const times = items.map(it => fmt.timeHM(it.dt, tzOffset));
  const padding = { l: 36, r: 12, t: 12, b: 24 };
  const plotW = w - padding.l - padding.r;
  const plotH = h - padding.t - padding.b;
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const range = Math.max(1, maxT - minT);

  // map data to coords
  const points = temps.map((t, i) => {
    const x = padding.l + (i / Math.max(1, temps.length - 1)) * plotW;
    const y = padding.t + (1 - (t - minT) / range) * plotH;
    return { x, y, t, label: times[i] };
  });

  // draw area fill
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length-1].x, padding.t + plotH);
  ctx.lineTo(points[0].x, padding.t + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padding.t, 0, padding.t + plotH);
  grad.addColorStop(0, 'rgba(77,163,255,0.28)');
  grad.addColorStop(1, 'rgba(77,163,255,0.04)');
  ctx.fillStyle = grad;
  ctx.fill();

  // draw line
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4da3ff';
  ctx.moveTo(points[0].x, points[0].y);
  for (let p of points) ctx.lineTo(p.x, p.y);
  ctx.stroke();

  // draw points
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2b6fab';
  points.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  });

  // y-axis labels (min/max)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(maxT + '°', padding.l - 8, padding.t + 6);
  ctx.fillText(minT + '°', padding.l - 8, padding.t + plotH - 6);

  // x-axis labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(200,200,200,0.9)';
  const step = Math.ceil(points.length / 6);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) {
      ctx.fillText(p.label, p.x, padding.t + plotH + 6);
    }
  });
}

// Redraw chart on resize / orientation change (debounced)
(function setupChartResize() {
  let t;
  function redraw() {
    const c = document.getElementById('hourlyChart');
    if (!c || !c._chartData) return;
    try { renderHourlyChart(c, c._chartData.items, c._chartData.tzOffset); } catch (e) { console.warn('Chart redraw failed', e); }
  }
  const handler = () => { clearTimeout(t); t = setTimeout(redraw, 200); };
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
})();

function renderDaily(w) {
  if (!HAS_WEATHER_UI) return;
  const root = el('daily'); root.innerHTML = '';
  // group by date (take midday as the day's representative)
  const byDate = new Map();
  for (const item of (w.forecast?.list ?? [])) {
    const d = new Date(item.dt * 1000);
    const key = d.toISOString().slice(0,10);
    const hour = d.getUTCHours();
    const prev = byDate.get(key);
  // choose the "mid" hours (12:00–15:00) to represent the day
    if (!prev || Math.abs(hour - 13) < Math.abs(prev.hour - 13)) {
      byDate.set(key, { hour, item });
    }
  }
  [...byDate.values()].slice(0,7).forEach(({ item }) => {
    const div = document.createElement('div');
    div.className = 'tile';
    const d = new Date(item.dt * 1000);
    const day = d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short' });
    const icon = item.weather?.[0]?.icon;
    div.innerHTML = `
      <div class="s">${day}</div>
      <img src="https://openweathermap.org/img/wn/${icon}@2x.png" width="50" height="50" alt="" />
      <div class="t">${fmt.tempKtoC(item.main.temp)}°</div>
    `;
    root.appendChild(div);
  });
  root.classList.remove('skeleton');
}

function renderAQI(w) {
  if (!HAS_WEATHER_UI) return;
  const box = el('aqi');
  box.classList.remove('skeleton');
  const aqi = w?.air?.list?.[0]?.main?.aqi; // 1..5
  if (!aqi) { box.textContent = 'No data'; return; }
  const map = {
    1: { label: 'Good', cls: 'good' },
    2: { label: 'Moderate', cls: 'moderate' },
    3: { label: 'Unhealthy (sensitive)', cls: 'unhealthy' },
    4: { label: 'Unhealthy', cls: 'unhealthy' },
    5: { label: 'Very unhealthy', cls: 'unhealthy' },
  };
  const { label, cls } = map[aqi];
  box.innerHTML = `<span>Index: <b>${aqi}</b></span> <span class="badge ${cls}">${label}</span>`;
}



async function loadByCoords(lat, lon, place) {
  try {
    setStatus('Loading…');
    const w = await getWeather(lat, lon);
    state.place = place || { name: w.current.name, country: w.current.sys?.country, lat, lon };
    renderCurrent(place?.title, w);
    if (w.forecast) {
      renderHourly(w);
      renderDaily(w);
    } else {
      // If forecast wasn't ready yet, fetch it separately and render when available
      setTimeout(async () => {
        try {
          const r = await owFetch('/data/2.5/forecast', { lat, lon }, { timeout: 8000 });
          if (r.ok) {
            w.forecast = await r.json();
            renderHourly(w);
            renderDaily(w);
          }
        } catch {}
      }, 0);
    }
    renderAQI(w); // will show "No data" until AQI loads
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus('Failed to retrieve data. Check the server API key or network.', 'error');
  }
}

async function onSearchSubmit(city) {
  if (!HAS_WEATHER_UI) { window.location.href = `/#q=${encodeURIComponent(city)}`; return; }
  let list;
  try {
    list = await geocode(city);
  } catch {
    return setStatus('Failed to retrieve data. Check the server API key or network.', 'error');
  }
  if (!list.length) return setStatus('City not found', 'error');
  const { lat, lon, local_names, name, country, state: region } = list[0];
  const title = local_names?.ru || `${name}${region ? ', ' + region : ''}, ${country}`;
  localStorage.setItem('lastCity', title);
  const place = { title, name, country, state: region, lat, lon };
  // Search history is stored in SQL Server for signed-in users
  if (window.Auth.user) apiFetch('/history', { method: 'POST', body: place }).catch(() => {});
  loadByCoords(lat, lon, place);
}

q.addEventListener('input', debounce(async () => {
  const val = q.value.trim();
  if (val.length < 2) { suggestions.classList.remove('show'); return; }
  try {
    const res = await geocode(val);
    suggestions.innerHTML = '';
    res.forEach(loc => {
      const btn = document.createElement('button');
      const title = loc.local_names?.ru || `${loc.name}${loc.state ? ', '+loc.state : ''}, ${loc.country}`;
      btn.textContent = title;
      btn.addEventListener('click', () => {
        if (!HAS_WEATHER_UI) { window.location.href = `/#q=${encodeURIComponent(title)}`; return; }
        suggestions.classList.remove('show');
        q.value = title;
        onSearchSubmit(title);
      });
      suggestions.appendChild(btn);
    });
    suggestions.classList.toggle('show', res.length > 0);
  } catch { suggestions.classList.remove('show'); }
}, 300));

q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && q.value.trim().length >= 2) {
    suggestions.classList.remove('show');
    onSearchSubmit(q.value.trim());
  }
});

useLocationBtn.addEventListener('click', () => {
  if (!HAS_WEATHER_UI) { window.location.href = '/#geo'; return; }
  if (!navigator.geolocation) return setStatus('Geolocation not supported', 'error');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      loadByCoords(latitude, longitude);
    },
    () => setStatus('Geolocation access denied', 'error'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// Favorites toggle (stored in SQL Server, table FavoriteCities)
if (favToggle && HAS_WEATHER_UI) {
  favToggle.addEventListener('click', async () => {
    if (!window.Auth.user) {
      window.showToast?.('Sign in to save favorite cities', { type: 'info' });
      el('openAuth')?.click();
      return;
    }
    if (!state.place) return;
    const existing = state.favorites.find((f) => sameCoords(f, state.place));
    try {
      if (existing) await apiFetch(`/favorites/${existing.cityId}`, { method: 'DELETE' });
      else await apiFetch('/favorites', { method: 'POST', body: state.place });
      await loadFavorites();
    } catch (e) {
      window.showToast?.(e.message, { type: 'error' });
    }
  });
}

// Start: city from the address (#q=...), last searched city, or geolocation
(async function bootstrap() {
  if (!HAS_WEATHER_UI) return;
  const hash = decodeURIComponent(location.hash || '');
  if (hash.startsWith('#q=')) {
    const city = hash.slice(3);
    q.value = city;
    onSearchSubmit(city);
    return;
  }
  // Geolocation is requested only after a click on "My location" (asking on page load is a bad practice)
  if (hash === '#geo') { useLocationBtn.click(); return; }
  onSearchSubmit(localStorage.getItem('lastCity') || DEFAULT_CITY);
})();

// ====== AUTH FORMS ======
(function () {
  const loginForm = el('loginForm');
  const registerForm = el('registerForm');
  const closeModal = () => document.querySelector('[data-close="authModal"]')?.click();

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    const err = loginForm.querySelector('.error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
      if (err) err.textContent = 'Check email/password';
      return;
    }
    try {
      await window.Auth.login({ email, password });
      if (err) err.textContent = '';
      loginForm.reset();
      closeModal();
      window.showToast?.('Signed in', { type: 'success' });
    } catch (e2) {
      if (err) err.textContent = e2.message;
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = registerForm.name.value.trim();
    const email = registerForm.email.value.trim();
    const password = registerForm.password.value;
    const confirm = registerForm.confirm.value;
    const err = registerForm.querySelector('.error');
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6 || password !== confirm) {
      if (err) err.textContent = 'Please fill the form correctly';
      return;
    }
    try {
      await window.Auth.register({ name, email, password });
      if (err) err.textContent = '';
      registerForm.reset();
      closeModal();
      window.showToast?.('Account created', { type: 'success' });
    } catch (e2) {
      if (err) err.textContent = e2.message;
    }
  });

  el('logout')?.addEventListener('click', () => window.Auth.logout());
})();

// ====== NAV: dropdowns + burger ======
(function () {
  function bindDropdown(btn, menu) {
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('show');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.classList.remove('show');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
  bindDropdown(el('moreMenuBtn'), el('dropdownMore'));
  bindDropdown(el('profileBtn'), el('profileMenu'));

  const burger = el('burger');
  const mobileNav = el('mobileNav');
  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      burger.classList.toggle('active', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('nav-open', open);
    });
  }
})();

// ====== Auth modal open/close + tabs + Clear cache ======
(function () {
  const authModal = el('authModal');
  function selectTab(name) {
    if (!authModal) return;
    authModal.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el('loginForm')?.classList.toggle('active', name === 'login');
    el('registerForm')?.classList.toggle('active', name === 'register');
  }
  function openModal() {
    if (!authModal) return;
    authModal.classList.add('show');
    authModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    selectTab('login');
    authModal.querySelector('input')?.focus();
  }
  function closeModal() {
    if (!authModal) return;
    authModal.classList.remove('show');
    authModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  ['openAuth', 'openAuth2', 'openAuthMobile'].forEach(id => el(id)?.addEventListener('click', openModal));
  document.querySelectorAll('[data-close="authModal"]').forEach(b => b.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  authModal?.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.tab');
    if (tab) selectTab(tab.dataset.tab);
  });

  // Clear cached weather/geocoding responses (account data lives on the server and is not touched)
  el('clearCache')?.addEventListener('click', () => {
    Object.keys(localStorage)
      .filter(k => k.startsWith('geocode:') || k.startsWith('weather2:') || k === 'lastCity')
      .forEach(k => localStorage.removeItem(k));
    window.showToast?.('Cache cleared', { type: 'success' });
  });
})();
