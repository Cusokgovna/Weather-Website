// Profile page: user data, avatar, favorite cities and search history — all stored in SQL Server via /api.
import { fmt } from './utils.js';
import { owFetch, apiFetch } from './api.js';

const $ = (id) => document.getElementById(id);
const toast = (msg, type = 'info') => (window.showToast ? window.showToast(msg, { type }) : alert(msg));

function bytesToSize(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
}
function approxBytesFromDataUrl(dataUrl) {
  return Math.round((dataUrl.length * 3) / 4);
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function resizeImage(dataUrl, maxWidth, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width > maxWidth ? (maxWidth / img.width) : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // jpeg is smaller; transparent PNGs get flattened
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function renderProfile(user) {
  $('pfName').value = user?.name || '';
  $('pfEmail').value = user?.email || '';
  const avatarPreview = $('avatarPreview');
  if (user?.avatar) { avatarPreview.src = user.avatar; avatarPreview.style.display = 'block'; }
  else { avatarPreview.removeAttribute('src'); avatarPreview.style.display = 'none'; }
  $('avatarInfo').textContent = user?.avatar
    ? `Saved: ${bytesToSize(approxBytesFromDataUrl(user.avatar))} (limit ~300 KB)`
    : 'Max avatar size: ~300 KB';
}

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const err = form.querySelector('.error');
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    err.textContent = 'Please check the form fields';
    return;
  }
  try {
    const { user } = await apiFetch('/users/me', { method: 'PUT', body: { name, email } });
    err.textContent = '';
    window.Auth.setUser(user);
    toast('Saved', 'success');
  } catch (e2) {
    err.textContent = e2.message;
  }
});

$('avatarFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Please select an image file.', 'error');

  const MAX_BYTES = 300 * 1024; // target size
  const MAX_WIDTH = 400;        // resize wider images
  let dataUrl = await dataUrlFromFile(file);
  if (approxBytesFromDataUrl(dataUrl) > MAX_BYTES) {
    try { dataUrl = await resizeImage(dataUrl, MAX_WIDTH, 0.8); } catch (err) { console.warn('Resize failed', err); }
  }
  const finalBytes = approxBytesFromDataUrl(dataUrl);
  $('avatarInfo').textContent = `Selected: ${bytesToSize(file.size || 0)}; Will save: ${bytesToSize(finalBytes)}`;
  if (finalBytes > 600 * 1024) return toast('Image is too large after compression. Please choose a smaller image.', 'error');

  try {
    const { user } = await apiFetch('/users/me/avatar', { method: 'PUT', body: { avatar: dataUrl } });
    window.Auth.setUser(user);
    toast('Avatar saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Favorites ----------
async function renderFavorites() {
  const root = $('favorites');
  const list = await apiFetch('/favorites');
  root.innerHTML = '';
  if (!list.length) {
    root.textContent = 'No favorite cities yet. Add one above or press ☆ on the home page.';
    return;
  }
  for (const city of list) {
    const tile = document.createElement('div');
    tile.className = 'fav-tile';
    tile.innerHTML = `
      <div class="fav-head">
        <a class="fav-city"></a>
        <button class="fav-del" aria-label="Remove from favorites">✕</button>
      </div>
      <div class="fav-body">
        <img alt="" width="48" height="48" hidden />
        <div class="fav-temp">—°</div>
        <div class="fav-desc"></div>
      </div>`;
    const title = `${city.name}${city.country ? ', ' + city.country : ''}`;
    const link = tile.querySelector('.fav-city');
    link.textContent = title;
    link.href = `/#q=${encodeURIComponent(title)}`;
    tile.querySelector('.fav-del').addEventListener('click', async () => {
      await apiFetch(`/favorites/${city.cityId}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
      renderFavorites();
    });
    root.appendChild(tile);

    // Current weather for the tile (by stored coordinates)
    owFetch('/data/2.5/weather', { lat: city.lat, lon: city.lon })
      .then((r) => (r.ok ? r.json() : null))
      .then((current) => {
        if (!current) return;
        const icon = current.weather?.[0]?.icon;
        if (icon) {
          const img = tile.querySelector('img');
          img.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
          img.hidden = false;
        }
        tile.querySelector('.fav-temp').textContent = `${fmt.tempKtoC(current.main.temp)}°`;
        tile.querySelector('.fav-desc').textContent = current.weather?.[0]?.description || '';
      })
      .catch(() => {});
  }
}

$('favAdd').addEventListener('click', async () => {
  const input = $('favCity');
  const q = input.value.trim(); if (q.length < 2) return;
  try {
    const r = await owFetch('/geo/1.0/direct', { q, limit: 1 });
    const [loc] = r.ok ? await r.json() : [];
    if (!loc) return toast('City not found', 'error');
    await apiFetch('/favorites', {
      method: 'POST',
      body: { name: loc.name, country: loc.country, state: loc.state, lat: loc.lat, lon: loc.lon },
    });
    input.value = '';
    renderFavorites();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ---------- Search history ----------
async function renderHistory() {
  const root = $('history');
  const list = await apiFetch('/history');
  root.innerHTML = '';
  if (!list.length) { root.textContent = 'Search history is empty.'; return; }
  for (const item of list) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    const title = `${item.name}${item.country ? ', ' + item.country : ''}`;
    a.textContent = title;
    a.href = `/#q=${encodeURIComponent(title)}`;
    const time = document.createElement('span');
    time.className = 'muted';
    time.textContent = ` — ${new Date(item.searchedAt).toLocaleString()}`;
    li.append(a, time);
    root.appendChild(li);
  }
}

// ---------- Page state ----------
async function showForUser(user) {
  $('profileContent').hidden = !user;
  $('profileGuest').hidden = !!user;
  if (!user) return;
  renderProfile(user);
  try {
    await Promise.all([renderFavorites(), renderHistory()]);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// auth:change fires after the initial session check and after every sign in / sign out
window.addEventListener('auth:change', (e) => showForUser(e.detail));
window.Auth.ready.then((user) => {
  if (user) return;
  showForUser(null);
  $('openAuth')?.click();
});
