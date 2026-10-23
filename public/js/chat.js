// Deal chat: messages (polling every 4 s), pictures, "Call support", order actions, review
import { api, say, toast, compressImage } from './common.js';

const panel = document.querySelector('[data-conversation]');
const id = panel.dataset.conversation;
const me = Number(panel.dataset.me);
const box = panel.querySelector('[data-messages]');
const form = panel.querySelector('[data-chat-form]');
let lastId = 0;

const time = (d) => new Date(d).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function render(messages) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  for (const m of messages) {
    lastId = Math.max(lastId, m.messageId);
    const el = document.createElement('div');
    el.className = `msg ${m.sender == null ? 'system' : m.sender.userId === me ? 'mine' : ''}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${m.sender ? m.sender.username : 'Kraken Shop'} · ${time(m.createdAt)}`;
    el.append(meta);
    if (m.text) el.append(document.createTextNode(m.text));       // textContent only — no HTML from users
    if (m.attachment) {
      const img = document.createElement('img');
      img.src = m.attachment;
      img.alt = 'Attached picture';
      el.append(img);
    }
    box.append(el);
  }
  if (messages.length && (atBottom || messages.some((m) => m.sender?.userId === me))) box.scrollTop = box.scrollHeight;
}

async function poll() {
  try { render(await api(`/conversations/${id}/messages?after=${lastId}`)); } catch { /* offline: try again later */ }
}

async function send(body) {
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    render(await api(`/conversations/${id}/messages`, { method: 'POST', body: { ...body, after: lastId } }));
    form.reset();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = form.text.value.trim();
  if (text) send({ text });
});

form.file.addEventListener('change', async () => {
  const file = form.file.files[0];
  if (!file) return;
  try { send({ text: form.text.value.trim() || undefined, attachment: await compressImage(file, { maxWidth: 1000, maxBytes: 400 * 1024 }) }); }
  catch (err) { toast(err.message, 'error'); }
  form.file.value = '';
});

panel.querySelector('[data-support]')?.addEventListener('click', async (e) => {
  try {
    await api(`/conversations/${id}/support`, { method: 'POST' });
    e.target.disabled = true;
    e.target.textContent = 'Support called';
    poll();
  } catch (err) { toast(err.message, 'error'); }
});

const CONFIRM = {
  confirm: 'Confirm that you received the item? The money will be sent to the seller.',
  dispute: 'Open a dispute? Support will join the chat.',
  refund: 'Refund the money to the buyer? The item goes back on sale.',
};
panel.querySelectorAll('[data-order-action]').forEach((btn) => btn.addEventListener('click', async () => {
  const action = btn.dataset.orderAction;
  if (!window.confirm(CONFIRM[action])) return;
  btn.disabled = true;
  try {
    await api(`/orders/${btn.dataset.order}/${action}`, { method: 'POST' });
    location.reload();
  } catch (err) {
    say(panel.querySelector('.form-msg'), err.message);
    btn.disabled = false;
  }
}));

panel.querySelectorAll('[data-review]').forEach((f) => f.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/orders/${f.dataset.review}/review`, { method: 'POST', body: { rating: Number(f.rating.value), text: f.text.value } });
    toast('Thank you for the review!');
    setTimeout(() => location.reload(), 600);
  } catch (err) { say(panel.querySelector('.form-msg'), err.message); }
}));

poll();
setInterval(poll, 4000);
