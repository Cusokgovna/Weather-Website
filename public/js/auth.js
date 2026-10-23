// Log In / Sign Up forms
import { api, say } from './common.js';

const form = document.querySelector('[data-auth]');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = form.dataset.auth;
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button');
  if (mode === 'register' && data.password !== data.confirm) return say(form, 'Passwords do not match');
  button.disabled = true;
  try {
    if (mode === 'login') await api('/auth/login', { method: 'POST', body: { login: data.login, password: data.password, specialCode: data.specialCode } });
    else await api('/auth/register', { method: 'POST', body: { username: data.username, email: data.email, password: data.password } });
    location.href = form.dataset.next || '/';
  } catch (err) {
    say(form, err.message);
    if (err.code === 'SPECIAL_CODE_REQUIRED') form.querySelector('[name=specialCode]')?.focus();
  } finally {
    button.disabled = false;
  }
});
