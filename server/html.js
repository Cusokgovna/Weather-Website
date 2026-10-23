// Tiny HTML templating: html`...` escapes every interpolated value unless it is already HTML
// (another html`` result or raw()). This is the only place that produces markup on the server,
// so user input can never break out into the page (XSS).

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function renderValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return escapeHtml(v);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(String(s));

// ---------- formatting ----------
const fmtRub = (n) => `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ /g, ' ')} ₽`;
const fmtUsd = (rub, usdRate) => (usdRate ? `≈ $${(rub / usdRate).toFixed(2)}` : '');
const pad = (n) => String(n).padStart(2, '0');
// 2025.09.18 — as in the design
const fmtDate = (d) => { const x = new Date(d); return `${x.getUTCFullYear()}.${pad(x.getUTCMonth() + 1)}.${pad(x.getUTCDate())}`; };
const fmtDateTime = (d) => { const x = new Date(d); return `${fmtDate(x)} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())} UTC`; };

module.exports = { html, raw, escapeHtml, SafeHtml, fmtRub, fmtUsd, fmtDate, fmtDateTime };
