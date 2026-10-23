// "Purchase" and "To chat" buttons (offer page, seller page, chat page)
import { api, say } from './common.js';

document.querySelectorAll('[data-buy]').forEach((form) => form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const quantity = Number(new FormData(form).get('quantity') || 1);
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const { conversationId } = await api('/orders', { method: 'POST', body: { listingId: Number(form.dataset.buy), quantity } });
    location.href = `/chat/${conversationId}`;
  } catch (err) {
    const msg = err.status === 409 && /money/i.test(err.message) ? `${err.message}. Top up on the Account page.` : err.message;
    say(form.closest('.panel').querySelector('.form-msg'), msg);
    button.disabled = false;
  }
}));

document.querySelectorAll('[data-to-chat]').forEach((btn) => btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const { conversationId } = await api('/conversations', { method: 'POST', body: { listingId: Number(btn.dataset.toChat) } });
    location.href = `/chat/${conversationId}`;
  } catch (err) {
    say(btn.closest('.panel').querySelector('.form-msg'), err.message);
    btn.disabled = false;
  }
}));
