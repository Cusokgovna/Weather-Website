// Create / edit an offer
import { api, say, compressImage } from './common.js';

const form = document.querySelector('[data-sell]');
const preview = document.querySelector('[data-preview]');
let image; // undefined = keep the current picture

form?.image.addEventListener('change', async () => {
  const file = form.image.files[0];
  if (!file) return;
  try {
    image = await compressImage(file, { maxWidth: 800, maxBytes: 400 * 1024 });
    preview.src = image;
    say(form, '');
  } catch (err) {
    image = undefined;
    form.image.value = '';
    say(form, err.message);
  }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = form.dataset.sell;
  const d = new FormData(form);
  const body = {
    categoryId: Number(d.get('categoryId')),
    title: d.get('title'),
    description: d.get('description'),
    price: Number(d.get('price')),
    quantity: Number(d.get('quantity')),
    status: d.get('closed') ? 'closed' : 'active',
  };
  if (d.get('removeImage')) body.image = null;
  else if (image) body.image = image;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const res = id
      ? await api(`/listings/${id}`, { method: 'PUT', body })
      : await api('/listings', { method: 'POST', body });
    location.href = `/listings/${id || res.listingId}`;
  } catch (err) {
    say(form, err.message);
    button.disabled = false;
  }
});
