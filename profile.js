import { cache, fmt } from './utils.js';
import { owFetch, getKey } from './api.js';

const $ = (id) => document.getElementById(id);

function bytesToSize(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
}
function approxBytesFromDataUrl(dataUrl) {
  return Math.round((dataUrl.length * 3) / 4);
}
// Note: UI toasts are provided by global `window.showToast` (see toasts.js). Fallback to alert().

function loadSession() {
  try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; }
}
function saveSession(sess) {
  if (sess) localStorage.setItem('session', JSON.stringify(sess));
  else localStorage.removeItem('session');
}

function loadUser(email) {
  try {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    return users.find(u => u.email === email) || null;
  } catch { return null; }
}
function saveUser(updated) {
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  const idx = users.findIndex(u => u.email === updated.email);
  if (idx >= 0) users[idx] = { ...users[idx], ...updated };
  else users.push(updated);
  localStorage.setItem('users', JSON.stringify(users));
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function getWeatherByCityName(city) {
  // Use owFetch which will call a proxy if configured, or call OpenWeather directly when key is present in config.js
  const geoRes = await owFetch('/geo/1.0/direct', { q: city, limit: 1 });
  if (!geoRes.ok) return null;
  const geo = await geoRes.json();
  const item = geo[0]; if (!item) return null;
  const { lat, lon } = item;
  const r = await owFetch('/data/2.5/weather', { lat, lon });
  if (!r.ok) return null;
  const current = await r.json();
  return { name: city, current };
}

function renderProfile(user) {
  const nameEl = $('pfName');
  const emailEl = $('pfEmail');
  const avatarPreview = $('avatarPreview');
  if (nameEl) nameEl.value = user?.name || '';
  if (emailEl) emailEl.value = user?.email || '';
  if (avatarPreview) {
    if (user?.avatar) { avatarPreview.src = user.avatar; avatarPreview.style.display = 'block'; }
    else { avatarPreview.removeAttribute('src'); avatarPreview.style.display = 'none'; }
  }
  // Avatar info (size/limits)
  const info = $('avatarInfo');
    if (info) {
    if (user?.avatar) {
      const approx = approxBytesFromDataUrl(user.avatar);
      info.textContent = `Saved: ${bytesToSize(approx)} (limit ~300 KB)`;
    } else {
      info.textContent = 'Max avatar size: ~300 KB';
    }
  }
}

function saveProfileHandler(curEmail) {
  const form = $('profileForm'); if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim().toLowerCase();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const err = form.querySelector('.error'); if (err) err.textContent = 'Please check the form fields';
      return;
    }
    const user = loadUser(curEmail) || { email };
    user.name = name; user.email = email;
    saveUser(user);
    saveSession({ email, name });
    try { window.setAuthUI?.(); } catch {}
  if (window.showToast) window.showToast('Saved', { type: 'success' }); else alert('Saved');
    try { window.setAuthUI?.(); } catch {}
  });
}

function bindAvatarUpload(curEmail) {
  const fileInput = $('avatarFile'); if (!fileInput) return;
  // Client-side avatar handling: validate, resize if large, and store as data URL.
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) {
      if (window.showToast) window.showToast('Please select an image file.', { type: 'error' }); else alert('Please select an image file.');
      return;
    }

    // If file is small enough, convert directly. Otherwise resize to max width.
    const MAX_BYTES = 300 * 1024; // 300 KB target limit
    const MAX_WIDTH = 400; // max width in px when resizing

    let dataUrl = await dataUrlFromFile(file);

    // fast size check: try to approximate bytes from base64 length
    const approxBytes = (dataUrl.length * 3) / 4;
    if (approxBytes > MAX_BYTES) {
      // attempt to resize/compress
      try {
        dataUrl = await (async function resizeImageFile(file, maxWidth, quality = 0.8) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const ratio = img.width > maxWidth ? (maxWidth / img.width) : 1;
              const w = Math.round(img.width * ratio);
              const h = Math.round(img.height * ratio);
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              // prefer jpeg for smaller size; if file was png and has transparency it will be flattened
              const out = canvas.toDataURL('image/jpeg', quality);
              resolve(out);
            };
            img.onerror = reject;
            // Use initial data URL to avoid CORS issues
            const reader = new FileReader();
            reader.onload = () => { img.src = reader.result; };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        })(file, MAX_WIDTH, 0.8);
      } catch (e) {
        console.warn('Resize failed', e);
      }
    }

    // Final size guard
    const finalApprox = approxBytesFromDataUrl(dataUrl);
    const info = $('avatarInfo');
    if (info) {
      info.textContent = `Selected: ${bytesToSize((file.size || 0))}; Will save: ${bytesToSize(finalApprox)}`;
    }
    if (finalApprox > 600 * 1024) { // abort if still too large
      if (window.showToast) window.showToast('Image is too large after compression. Please choose a smaller image.', { type: 'error' }); else alert('Image is too large after compression. Please pick a smaller image.');
      return;
    }

    const user = loadUser(curEmail) || { email: curEmail };
    user.avatar = dataUrl;
    saveUser(user);
    renderProfile(user);
    try { window.setAuthUI?.(); } catch {}
  });
}

// Expose a setter to update header UI (name + avatar). Called by profile/save flows.
window.setAuthUI = function () {
  try {
    const sess = JSON.parse(localStorage.getItem('session') || 'null');
    const headerAvatar = document.getElementById('headerAvatar');
    const profileBtn = document.getElementById('profileBtn');
    if (!sess) {
      if (headerAvatar) headerAvatar.style.display = 'none';
      if (profileBtn) profileBtn.textContent = 'Guest';
      return;
    }
    const user = loadUser(sess.email) || { name: sess.name, email: sess.email };
    if (profileBtn) profileBtn.textContent = user.name || 'Account';
    if (headerAvatar) {
      if (user.avatar) { headerAvatar.src = user.avatar; headerAvatar.style.display = 'inline-block'; }
      else { headerAvatar.removeAttribute('src'); headerAvatar.style.display = 'none'; }
    }
  } catch (e) { /* no-op */ }
};

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('favorites') || '[]'); } catch { return []; }
}
function saveFavorites(list) {
  localStorage.setItem('favorites', JSON.stringify(list));
}

async function renderFavorites() {
  const root = $('favorites'); if (!root) return;
  const list = loadFavorites();
  root.innerHTML = '';
  for (const city of list) {
    try {
      const data = await getWeatherByCityName(city);
      if (!data) continue;
      const { current } = data;
      const div = document.createElement('div');
      div.className = 'fav-tile';
      const icon = current.weather?.[0]?.icon;
      div.innerHTML = `
        <div class="fav-head">
          <div class="fav-city">${city}</div>
          <button class="fav-del" data-city="${city}">✕</button>
        </div>
        <div class="fav-body">
          <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="" width="48" height="48" />
          <div class="fav-temp">${fmt.tempKtoC(current.main.temp)}°</div>
          <div class="fav-desc">${current.weather?.[0]?.description || ''}</div>
        </div>
      `;
      root.appendChild(div);
    } catch {}
  }
  // remove handlers
  root.querySelectorAll('.fav-del').forEach(btn => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const city = btn.getAttribute('data-city');
        const list = loadFavorites().filter(c => c !== city);
        saveFavorites(list);
        renderFavorites();
      });
    }
  });
}

function bindFavoritesUI() {
  const addBtn = $('favAdd');
  const input = $('favCity');
  if (addBtn && input && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', async () => {
      const city = input.value.trim(); if (city.length < 2) return;
      const list = loadFavorites();
      if (!list.includes(city)) { list.push(city); saveFavorites(list); }
      input.value = '';
      renderFavorites();
    });
  }
}

// bootstrap profile page
(function initProfile() {
  const sess = loadSession();
  if (!sess) {
    // if not logged in, invite to login
    try { document.getElementById('openAuth')?.click(); } catch {}
  }
  const user = sess ? loadUser(sess.email) || { email: sess.email, name: sess.name } : null;
  renderProfile(user);
  bindAvatarUpload(sess?.email || user?.email || '');
  saveProfileHandler(sess?.email || user?.email || '');
  bindFavoritesUI();
  renderFavorites();
})();


