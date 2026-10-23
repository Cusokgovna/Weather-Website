// Account page: profile, avatar, special code, top-up
import { api, say, toast, compressImage } from './common.js';

const $ = (sel) => document.querySelector(sel);

function onSubmit(form, handler) {
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      say(form.querySelector('.form-msg') ? form : $('[data-global-msg]'), err.message);
    } finally {
      button.disabled = false;
    }
  });
}

onSubmit($('[data-profile]'), async (data) => {
  await api('/users/me', { method: 'PUT', body: data });
  toast('Profile saved');
  setTimeout(() => location.reload(), 600);
});

onSubmit($('[data-avatar]'), async (data) => {
  if (!data.file?.size) throw new Error('Choose a picture first');
  const avatar = await compressImage(data.file, { maxWidth: 300, maxBytes: 300 * 1024 });
  await api('/users/me/avatar', { method: 'PUT', body: { avatar } });
  $('[data-avatar-preview]').src = avatar;
  toast('Avatar saved');
});

onSubmit($('[data-special-code]'), async (data, form) => {
  const { specialCodeEnabled } = await api('/users/me/special-code', { method: 'PUT', body: { password: data.password, code: data.code } });
  form.reset();
  toast(specialCodeEnabled ? 'Special code is ON' : 'Special code is OFF');
  setTimeout(() => location.reload(), 600);
});

onSubmit($('[data-deposit]'), async (data) => {
  await api('/wallet/deposit', { method: 'POST', body: { amount: Number(data.amount) } });
  toast('Balance topped up');
  setTimeout(() => location.reload(), 600);
});
