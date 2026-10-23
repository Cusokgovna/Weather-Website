// Shared helpers for all pages + global behaviour (logout, sidebar).

// JSON request to our API. Throws Error with .status/.code and the server message on failure.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Writes a message into the nearest .form-msg of a form (or a given element)
export function say(target, message, type = 'error') {
  const box = target?.classList?.contains('form-msg') ? target : target?.querySelector('.form-msg') || target?.parentElement?.querySelector('.form-msg');
  if (!box) return toast(message, type);
  box.textContent = message;
  box.className = `form-msg ${type}`;
}

// Reads an image file, shrinks it on a canvas and returns a JPEG/PNG data URL under maxBytes
export function compressImage(file, { maxWidth = 800, maxBytes = 300 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Choose a PNG, JPEG, WEBP or GIF picture'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Cannot read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This is not a picture'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.85;
        let url = canvas.toDataURL('image/jpeg', quality);
        while (url.length * 0.75 > maxBytes && quality > 0.35) {
          quality -= 0.1;
          url = canvas.toDataURL('image/jpeg', quality);
        }
        if (url.length * 0.75 > maxBytes) return reject(new Error('The picture is too large even after compression'));
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- global behaviour ----------
document.querySelectorAll('[data-logout]').forEach((btn) => btn.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}));

// Sidebar: filter games by name, collapse on phones
const filter = document.querySelector('[data-game-filter]');
filter?.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  document.querySelectorAll('.sidebar li').forEach((li) => { li.hidden = q && !li.textContent.toLowerCase().includes(q); });
});
const toggle = document.querySelector('.sidebar-toggle');
toggle?.addEventListener('click', () => {
  const open = toggle.closest('.sidebar').classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});
