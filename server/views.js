// Server-side page templates in the "Kraken Shop" design.
// Every page = layout (header, sidebar with games, exchange-rate bar, footer) + its own main content.
// Public pages are rendered with data from the database, so search engines get ready HTML.
const { html, fmtRub, fmtUsd, fmtDate, fmtDateTime } = require('./html');

const SITE = 'Kraken Shop';

// ---------- small building blocks ----------
const listingImg = (l) => (l.hasImage ? `/img/listings/${l.listingId}?v=${new Date(l.updatedAt || l.createdAt).getTime()}` : `/img/kinds/${l.category.kind}.svg`);
const avatarImg = (username, has) => (has ? `/img/avatars/${encodeURIComponent(username)}` : '/img/user.svg');
const stars = (r) => (r == null ? 'no rating' : `${r.toFixed(1)} ☆`);
const STATUS = { paid: 'Paid — waiting for delivery', completed: 'Completed', disputed: 'Dispute', refunded: 'Refunded', active: 'Active', sold: 'Sold out', closed: 'Hidden' };
const catalogUrl = (g) => `/${g.section === 'service' ? 'services' : 'games'}/${g.slug}`;
const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

const logo = (cls = '') => html`<a class="logo ${cls}" href="/" aria-label="Kraken Shop — home">KRAKEN<img src="/img/kraken-mark.svg" alt="" width="22" height="22">SHOP</a>`;

const SOCIALS = [
  ['Discord', 'M8 9.5c3-1.5 5-1.5 8 0l1 6c-1.5 1-3 1.5-3 1.5l-.7-1.2M8 9.5l-1 6c1.5 1 3 1.5 3 1.5l.7-1.2M9.5 13h0M14.5 13h0'],
  ['TikTok', 'M13 6v8.5a2.5 2.5 0 1 1-2.5-2.5M13 6c.5 1.8 1.8 3 3.5 3'],
  ['Telegram', 'M6 11.5 17 7l-2 10-4-3-2 2.5V13l6-4.5'],
  ['YouTube', 'M7 8.5h10a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 14v-4A1.5 1.5 0 0 1 7 8.5ZM11 10.5v3l2.5-1.5Z'],
];

function header(user) {
  const right = user
    ? html`<details class="user-menu">
        <summary>${user.username} <img src="/img/user.svg" alt="" width="18" height="18"></summary>
        <ul>
          <li class="balance">Balance: <b>${fmtRub(user.balance)}</b></li>
          <li><a href="/account">Account</a></li>
          <li><a href="/deals">My deals</a></li>
          <li><a href="/chat">Chats</a></li>
          <li><a href="/sell">Sell an item</a></li>
          <li><button type="button" data-logout>Log out</button></li>
        </ul>
      </details>`
    : html`<a href="/login">Log in</a><a class="signup" href="/register">Sign up</a>`;
  return html`<header class="topbar">
    <div class="topbar-inner">
      ${logo()}
      <form class="top-search" action="/search" role="search"><input name="q" type="search" placeholder="Search" aria-label="Search offers"></form>
      <nav class="top-nav" aria-label="Main navigation"><a href="/faq">FAQ</a><a href="/about">About us</a><a href="/news">News</a></nav>
      <div class="top-user">${right}</div>
    </div>
  </header>`;
}

function sidebar(games, activeSlug) {
  const services = games.filter((g) => g.section === 'service');
  const list = games.filter((g) => g.section === 'game');
  const link = (g) => html`<li><a href="${catalogUrl(g)}"${activeSlug === g.slug ? html` aria-current="page"` : ''}>${g.name}</a></li>`;
  return html`<aside class="sidebar" aria-label="Games and services">
    <button class="sidebar-toggle" type="button" aria-expanded="false" aria-controls="sidebarBody">☰ Games</button>
    <div class="sidebar-body" id="sidebarBody">
      <input class="game-search" type="search" placeholder="Search game" aria-label="Search game" data-game-filter>
      <details class="services" open>
        <summary>Services</summary>
        <ul>
          <li><a href="/categories">Categories</a></li>
          ${services.map(link)}
        </ul>
      </details>
      <ul class="game-list">${list.map(link)}</ul>
    </div>
  </aside>`;
}

function ratesBar(rates) {
  const r = Object.fromEntries(rates.map((x) => [x.code, x.rate]));
  const f = (v) => (v ? v.toFixed(4) : '—');
  return html`<section class="rates" aria-label="Exchange rate">
    <span class="rates-title">Exchange rate</span>
    <span class="rate">EURO: <b>${f(r.EUR)}</b> RUB</span>
    <span class="rate">DOLLAR: <b>${f(r.USD)}</b> RUB</span>
  </section>`;
}

function footer() {
  return html`<footer class="footer">
    <div class="footer-inner">
      <span>© KRAKEN SHOP. All right reserved. ${new Date().getUTCFullYear()}</span>
      <nav aria-label="Footer"><a href="/contacts">Contacts</a><a href="/privacy">Privacy policy</a><a href="/rules">Rules</a></nav>
      <div class="socials">${SOCIALS.map(([name, d]) => html`<span class="social" title="${name}" aria-label="${name}" role="img"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="${d}"/></svg></span>`)}</div>
      ${logo('logo-light')}
    </div>
  </footer>`;
}

/**
 * Full HTML document.
 * page: { title, description, path, noindex, sidebar (default true), activeSlug, main, scripts, bodyClass }
 */
function layout(ctx, page) {
  const title = page.title === SITE ? SITE : `${page.title} — ${SITE}`;
  const url = `${ctx.siteUrl}${page.path || ''}`;
  const withSidebar = page.sidebar !== false;
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${page.description}">
  ${page.noindex
    ? html`<meta name="robots" content="noindex">`
    : html`<link rel="canonical" href="${url}">
  <meta property="og:title" content="${title}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ctx.siteUrl}/img/og-image.png">
  <meta property="og:image:alt" content="Kraken Shop — marketplace of in-game items">
  <meta property="og:description" content="${page.description}">
  <meta property="og:site_name" content="${SITE}">`}
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="${page.bodyClass || ''}">
  ${header(ctx.user)}
  <div class="page${withSidebar ? ' with-sidebar' : ''}">
    ${withSidebar ? sidebar(ctx.games, page.activeSlug) : ''}
    <main id="main" class="content">
      ${page.main}
      ${ratesBar(ctx.rates)}
    </main>
  </div>
  ${footer()}
  <script type="module" src="/js/common.js"></script>
  ${(page.scripts || []).map((s) => html`<script type="module" src="/js/${s}.js"></script>`)}
</body>
</html>`;
}

// ---------- reusable pieces ----------
function itemCard(l, rates) {
  return html`<li class="item-card">
    <img class="item-img" src="${listingImg(l)}" alt="" width="140" height="80" loading="lazy">
    <div class="item-body">
      <h2 class="item-title"><a href="/listings/${l.listingId}">${l.title}</a> <span class="price">${fmtRub(l.price)}</span> <small class="usd">${fmtUsd(l.price, rates.USD)}</small></h2>
      <p class="item-desc">${truncate(l.description, 140)}</p>
      <p class="item-meta">${l.game.name} · ${l.category.name} · ${l.quantity} in stock · seller <a href="/users/${l.seller.username}">${l.seller.username}</a> ${stars(l.seller.avgRating)}</p>
    </div>
    <a class="btn" href="/listings/${l.listingId}">Purchase</a>
  </li>`;
}

function itemList(items, rates, empty) {
  return items.length ? html`<ul class="items">${items.map((l) => itemCard(l, rates))}</ul>` : html`<p class="empty">${empty}</p>`;
}

function pager(basePath, query, page, total, limit) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return '';
  const href = (p) => { const q = new URLSearchParams({ ...query, page: String(p) }); return `${basePath}?${q}`; };
  return html`<nav class="pager" aria-label="Pages">
    ${page > 1 ? html`<a href="${href(page - 1)}" rel="prev">← Prev</a>` : ''}
    <span>Page ${page} of ${pages}</span>
    ${page < pages ? html`<a href="${href(page + 1)}" rel="next">Next →</a>` : ''}
  </nav>`;
}

const rateMap = (rates) => Object.fromEntries(rates.map((x) => [x.code, x.rate]));

// ---------- pages ----------
function home(ctx, { offers }) {
  const rates = rateMap(ctx.rates);
  return layout(ctx, {
    title: SITE,
    description: 'Kraken Shop — a marketplace for gamers: buy and sell in-game items, currency, accounts and services for Dota 2, CS 2, Tarkov, Stalzone and more with safe escrow deals.',
    path: '/',
    main: html`<section class="panel hello">
      <h1 class="big-title">Hello!</h1>
      <h2 class="welcome">Welcome to Kraken Shop!</h2>
      <p class="intro">Welcome to our game marketplace — a platform where players buy, sell and exchange in-game items, currency, accounts and services.
        Pick a game on the left, find the offer you need and pay safely: the money is held by Kraken Shop until you confirm that you received the item.
        Have something to sell? <a href="/sell">Create an offer</a> in a minute and start earning on your inventory.</p>
      <div class="hello-grid">
        <section class="special">
          <h2>Special offers for you:</h2>
          <ul class="offers">${offers.map((l) => html`<li><a href="/listings/${l.listingId}">
            <img src="${listingImg(l)}" alt="" width="56" height="32" loading="lazy">
            <span class="offer-title">${l.title}</span>
            <b>${fmtRub(l.price)}</b> <small>${fmtUsd(l.price, rates.USD)}</small></a></li>`)}</ul>
        </section>
        <a class="promo" href="/games/stalzone">
          <img src="/img/promo-kraken.svg" alt="The Kraken holding Gauss guns" width="320" height="210">
          <span class="promo-caption">WOW! Gauss guns in Stalzone are now on sale</span>
        </a>
      </div>
    </section>`,
  });
}

function catalog(ctx, { game, category, sort, page, result, limit }) {
  const rates = rateMap(ctx.rates);
  const base = catalogUrl(game);
  const tagline = game.section === 'service' ? 'Codes and subscriptions for cheap!' : 'In-game items for cheap!';
  const cat = game.categories.find((c) => c.slug === category);
  const query = { ...(category && { category }), ...(sort !== 'new' && { sort }) };
  return layout(ctx, {
    title: cat ? `${game.name} — ${cat.name}` : `${game.name}: buy ${game.categories.map((c) => c.name.toLowerCase()).join(', ')}`,
    description: `${game.description}. ${game.activeListings} offers from verified sellers on Kraken Shop${game.minPrice != null ? `, prices from ${fmtRub(game.minPrice)}` : ''}. Safe deals with escrow.`,
    path: cat ? `${base}?category=${cat.slug}` : base,
    activeSlug: game.slug,
    main: html`<section class="panel catalog">
      <h1 class="big-title">${game.name}</h1>
      <p class="tagline">${tagline}</p>
      <nav class="chips" aria-label="Categories">
        <a class="chip" href="${base}"${!category ? html` aria-current="page"` : ''}>All <small>${game.activeListings}</small></a>
        ${game.categories.map((c) => html`<a class="chip" href="${base}?category=${c.slug}"${c.slug === category ? html` aria-current="page"` : ''}>${c.name} <small>${c.activeListings}</small></a>`)}
      </nav>
      <form class="toolbar" method="get" action="${base}">
        ${category ? html`<input type="hidden" name="category" value="${category}">` : ''}
        <label>Sort by
          <select name="sort">
            <option value="new"${sort === 'new' ? html` selected` : ''}>Newest</option>
            <option value="price_asc"${sort === 'price_asc' ? html` selected` : ''}>Price: low to high</option>
            <option value="price_desc"${sort === 'price_desc' ? html` selected` : ''}>Price: high to low</option>
          </select>
        </label>
        <button class="btn" type="submit">Apply</button>
        <a class="btn btn-dark" href="/sell">Sell here</a>
      </form>
      ${itemList(result.items, rates, html`No offers yet. <a href="/sell">Be the first to sell!</a>`)}
      ${pager(base, query, page, result.total, limit)}
    </section>`,
  });
}

function categories(ctx) {
  const block = (g) => html`<li class="cat-card">
    <h2><a href="${catalogUrl(g)}">${g.name}</a> <small>${g.activeListings} offers</small></h2>
    <ul>${g.categories.map((c) => html`<li><a href="${catalogUrl(g)}?category=${c.slug}">${c.name}</a> <small>${c.activeListings}</small></li>`)}</ul>
  </li>`;
  return layout(ctx, {
    title: 'All games and categories',
    description: 'All games and services on Kraken Shop: items, currency, accounts, boosting, gift cards and app subscriptions.',
    path: '/categories',
    main: html`<section class="panel">
      <h1 class="big-title">Categories</h1>
      <ul class="cat-grid">${ctx.games.map(block)}</ul>
    </section>`,
  });
}

function search(ctx, { q, result }) {
  return layout(ctx, {
    title: q ? `Search: ${q}` : 'Search',
    description: 'Search offers on Kraken Shop.',
    noindex: true,
    main: html`<section class="panel catalog">
      <h1 class="big-title">Search</h1>
      <form class="toolbar" action="/search" role="search">
        <input name="q" type="search" value="${q}" placeholder="Item or game" aria-label="Search offers">
        <button class="btn" type="submit">Find</button>
      </form>
      <p class="tagline">${q ? `${result.total} offers for “${q}”` : 'Type what you are looking for'}</p>
      ${q ? itemList(result.items, rateMap(ctx.rates), 'Nothing found. Try another word or pick a game on the left.') : ''}
    </section>`,
  });
}

function listing(ctx, { l }) {
  const rates = rateMap(ctx.rates);
  const me = ctx.user;
  const own = me && me.id === l.seller.userId;
  const base = catalogUrl(l.game);
  let actions;
  if (l.status !== 'active') actions = html`<p class="notice">This offer is ${STATUS[l.status].toLowerCase()}.</p>`;
  if (own) actions = html`${actions || ''}<a class="btn btn-dark" href="/sell?id=${l.listingId}">Edit</a>`;
  else if (!me) actions = actions || html`<a class="btn btn-dark" href="/login?next=/listings/${l.listingId}">Log in to buy</a>`;
  else if (!actions) {
    actions = html`<form class="buy-form" data-buy="${l.listingId}">
      <label>Quantity <input type="number" name="quantity" min="1" max="${l.quantity}" value="1" required></label>
      <button class="btn btn-dark" type="submit">Purchase</button>
    </form>`;
  }
  return layout(ctx, {
    title: `${l.title} — ${l.game.name} ${l.category.name}`,
    description: `${l.title} for ${fmtRub(l.price)} in ${l.game.name} (${l.category.name}). ${truncate(l.description, 110)} Seller ${l.seller.username}, safe deal with escrow.`,
    path: `/listings/${l.listingId}`,
    activeSlug: l.game.slug,
    scripts: ['listing'],
    main: html`<article class="panel listing">
      <nav class="crumbs" aria-label="Breadcrumbs"><a href="${base}">${l.game.name}</a> › <a href="${base}?category=${l.category.slug}">${l.category.name}</a></nav>
      <h1 class="listing-title">${l.title}</h1>
      <div class="listing-grid">
        <img class="listing-img" src="${listingImg(l)}" alt="${l.title}" width="360" height="200">
        <div class="listing-buy">
          <p class="price-big">${fmtRub(l.price)} <small>${fmtUsd(l.price, rates.USD)}</small></p>
          <p>In stock: <b>${l.quantity}</b> · Status: ${STATUS[l.status]}</p>
          <div class="actions">${actions}${me && !own ? html`<button class="btn" type="button" data-to-chat="${l.listingId}">To chat</button>` : ''}</div>
          <p class="form-msg" role="status"></p>
        </div>
      </div>
      <section>
        <h2>Description</h2>
        <p class="pre">${l.description || 'The seller did not add a description.'}</p>
      </section>
      <section class="seller-line">
        <h2>Seller</h2>
        <p><a href="/users/${l.seller.username}">${l.seller.username}</a> · Rating: ${stars(l.seller.avgRating)} · Sales: ${l.seller.salesCount}</p>
      </section>
      <section>
        <h2>How a safe deal works</h2>
        <ol class="steps">
          <li>You pay from your Kraken Shop balance — the money is frozen, the seller does not get it yet.</li>
          <li>The seller delivers the item and writes to you in the deal chat.</li>
          <li>You check the item and press “Confirm”. Only then the seller gets the money.</li>
          <li>Something went wrong? Open a dispute or call support right in the chat.</li>
        </ol>
      </section>
    </article>`,
  });
}

function authPage(ctx, mode, next) {
  const login = mode === 'login';
  return layout(ctx, {
    title: login ? 'Log in' : 'Sign up',
    description: login ? 'Log in to your Kraken Shop account.' : 'Create a Kraken Shop account to buy and sell in-game items.',
    noindex: true,
    sidebar: false,
    scripts: ['auth'],
    main: html`<section class="auth-card">
      <h1>${login ? 'Log In' : 'Sign Up'}</h1>
      <form data-auth="${mode}" data-next="${next || '/'}" novalidate>
        ${login
          ? html`<label>User Name<input name="login" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <label><span>Special code<sup>*</sup></span><input name="specialCode" autocomplete="one-time-code" inputmode="numeric" maxlength="12"></label>`
          : html`<label>User Name<input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}"></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
        <label>Repeat password<input name="confirm" type="password" autocomplete="new-password" required minlength="6"></label>`}
        <button class="btn" type="submit">${login ? 'Log In' : 'Sign Up'}</button>
        <p class="form-msg" role="status"></p>
      </form>
      ${login
        ? html`<p class="hint"><sup>*</sup> Only if you turned it on in your account settings.</p>
      <p class="hint">No account? <a href="/register">Sign up</a> · Demo: <b>demo</b> / <b>demo1234</b></p>`
        : html`<p class="hint">Already registered? <a href="/login">Log in</a></p>`}
    </section>`,
  });
}

function offersColumn(listings, me, own) {
  return html`<section class="offers-col">
    <h2>${own ? 'My offers:' : 'Active offers:'}</h2>
    ${listings.length ? html`<ul class="mini-offers">${listings.map((l) => html`<li>
      <img src="${listingImg(l)}" alt="" width="64" height="40" loading="lazy">
      <div class="mini-text"><b>${l.seller.username}</b><span>${l.title}</span><small>${l.quantity} count · ${fmtRub(l.price)}${l.status !== 'active' ? ` · ${STATUS[l.status]}` : ''}</small></div>
      <div class="mini-btns">
        ${own ? html`<a class="btn btn-sm" href="/sell?id=${l.listingId}">Edit</a>` : html`<a class="btn btn-sm" href="/listings/${l.listingId}">View</a>`}
        ${own ? html`<a class="btn btn-sm" href="/listings/${l.listingId}">Open</a>` : me ? html`<button class="btn btn-sm" type="button" data-to-chat="${l.listingId}">To chat</button>` : ''}
      </div>
    </li>`)}</ul>` : html`<p class="empty">No active offers.</p>`}
    ${own ? html`<a class="btn btn-dark" href="/sell">+ New offer</a>` : ''}
  </section>`;
}

function infoColumn(p, extra) {
  return html`<section class="info-col">
    <div class="info-box">
      <img class="avatar" src="${avatarImg(p.username, p.hasAvatar)}" alt="Avatar of ${p.username}" width="72" height="72">
      <dl class="facts">
        <div><dt>Date of creation:</dt><dd>${fmtDate(p.createdAt)}</dd></div>
        <div><dt>Nickname:</dt><dd>${p.username}</dd></div>
        <div><dt>Real name:</dt><dd>${p.realName || '—'}</dd></div>
      </dl>
    </div>
    <div class="info-box">
      <dl class="facts">
        <div><dt>Rating:</dt><dd>${stars(p.avgRating)} <small>(${p.reviewsCount} reviews)</small></dd></div>
        <div><dt>Deals conducted:</dt><dd>${p.dealsCount}</dd></div>
        <div><dt>Social credit:</dt><dd class="${p.socialCredit < 0 ? 'neg' : ''}">${p.socialCredit > 0 ? `+ ${p.socialCredit}` : p.socialCredit < 0 ? `- ${-p.socialCredit}` : '0'}</dd></div>
      </dl>
    </div>
    ${extra || ''}
  </section>`;
}

function reviewsBlock(reviews) {
  return html`<section class="reviews">
    <h2>Reviews</h2>
    ${reviews.length ? html`<ul>${reviews.map((r) => html`<li><b>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</b> ${r.author} about “${r.title}” <small>${fmtDate(r.createdAt)}</small><p>${r.text || ''}</p></li>`)}</ul>` : html`<p class="empty">No reviews yet.</p>`}
  </section>`;
}

function userPage(ctx, { profile, listings, reviews }) {
  return layout(ctx, {
    title: `${profile.username} — seller profile`,
    description: `${profile.username} on Kraken Shop: rating ${stars(profile.avgRating)}, ${profile.dealsCount} deals, ${profile.activeListings} active offers.`,
    path: `/users/${profile.username}`,
    scripts: ['listing'],
    main: html`<section class="panel account">
      <h1 class="title-bar">Account information</h1>
      <div class="account-grid">
        ${offersColumn(listings, ctx.user, ctx.user?.id === profile.userId)}
        ${infoColumn(profile)}
      </div>
      <p class="form-msg" role="status"></p>
      ${reviewsBlock(reviews)}
    </section>`,
  });
}

function account(ctx, { profile, listings, reviews, transactions }) {
  const me = ctx.user;
  const TX = { deposit: 'Top-up', purchase: 'Purchase', sale: 'Sale', refund: 'Refund' };
  const wallet = html`<div class="info-box wallet">
    <p class="balance-big">Balance: <b data-balance>${fmtRub(me.balance)}</b></p>
    <form class="inline-form" data-deposit>
      <label>Top up, ₽ <input name="amount" type="number" min="1" max="100000" step="1" value="1000" required></label>
      <button class="btn" type="submit">Top up</button>
    </form>
    <p class="hint">Demo top-up: no real payment is made.</p>
  </div>`;
  return layout(ctx, {
    title: 'My account',
    description: 'Your Kraken Shop account: offers, balance, settings.',
    noindex: true,
    scripts: ['account'],
    main: html`<section class="panel account">
      <h1 class="title-bar">Account information</h1>
      <div class="account-grid">
        ${offersColumn(listings, me, true)}
        ${infoColumn(profile, wallet)}
      </div>
      <p class="form-msg" role="status" data-global-msg></p>

      <section class="settings">
        <h2>Settings</h2>
        <div class="settings-grid">
          <form class="card-form" data-profile>
            <h3>Profile</h3>
            <label>Nickname<input name="username" value="${me.username}" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}"></label>
            <label>Real name<input name="realName" value="${me.realName || ''}" maxlength="100" placeholder="Shown on your public page"></label>
            <label>Email<input name="email" type="email" value="${me.email}" required></label>
            <button class="btn" type="submit">Save</button>
          </form>
          <form class="card-form" data-avatar>
            <h3>Avatar</h3>
            <img class="avatar" src="${avatarImg(me.username, !!me.avatar)}" alt="Your avatar" width="72" height="72" data-avatar-preview>
            <label>Image (up to ~300 KB after compression)<input name="file" type="file" accept="image/*"></label>
            <button class="btn" type="submit">Upload</button>
          </form>
          <form class="card-form" data-special-code>
            <h3>Special code</h3>
            <p class="hint">${me.specialCodeHash ? 'Special code is ON: it is required at every login.' : 'Special code is OFF. Turn it on to protect your account with a second secret.'}</p>
            <label>Current password<input name="password" type="password" autocomplete="current-password" required></label>
            <label>New special code (4–12 digits, empty = turn off)<input name="code" inputmode="numeric" pattern="[0-9]{4,12}" maxlength="12" autocomplete="off"></label>
            <button class="btn" type="submit">Save code</button>
          </form>
        </div>
      </section>

      <section class="wallet-history">
        <h2>Wallet history</h2>
        ${transactions.length ? html`<table class="table">
          <thead><tr><th>Date</th><th>Operation</th><th>Amount</th><th>Balance</th><th>Order</th></tr></thead>
          <tbody>${transactions.map((t) => html`<tr>
            <td>${fmtDateTime(t.createdAt)}</td><td>${TX[t.type]}</td>
            <td class="${t.amount < 0 ? 'neg' : 'pos'}">${t.amount > 0 ? '+' : ''}${fmtRub(t.amount)}</td>
            <td>${fmtRub(t.balanceAfter)}</td><td>${t.orderId ? `#${t.orderId}` : ''}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">No operations yet.</p>`}
      </section>
      ${reviewsBlock(reviews)}
    </section>`,
  });
}

function sell(ctx, { games, l }) {
  const edit = !!l;
  const option = (c, g) => html`<option value="${c.categoryId}"${l && l.category.categoryId === c.categoryId ? html` selected` : ''}>${g.name} — ${c.name}</option>`;
  const group = (label, list) => html`<optgroup label="${label}">${list.flatMap((g) => g.categories.map((c) => option(c, g)))}</optgroup>`;
  return layout(ctx, {
    title: edit ? 'Edit offer' : 'Sell an item',
    description: 'Create an offer on Kraken Shop.',
    noindex: true,
    scripts: ['sell'],
    main: html`<section class="panel">
      <h1 class="big-title">${edit ? 'Edit offer' : 'Sell'}</h1>
      <p class="tagline">${edit ? l.title : 'Put your item up for sale'}</p>
      <form class="card-form sell-form" data-sell="${edit ? l.listingId : ''}">
        <label>Game and category
          <select name="categoryId" required>
            <option value="">Choose…</option>
            ${group('Games', games.filter((g) => g.section === 'game'))}
            ${group('Services', games.filter((g) => g.section === 'service'))}
          </select>
        </label>
        <label>Title<input name="title" required minlength="3" maxlength="120" value="${l?.title || ''}" placeholder="Gauss Gun — Legendary"></label>
        <label>Description<textarea name="description" rows="5" maxlength="2000" placeholder="How and when you deliver the item">${l?.description || ''}</textarea></label>
        <div class="row">
          <label>Price per item, ₽<input name="price" type="number" min="1" max="10000000" step="0.01" required value="${l?.price ?? ''}"></label>
          <label>Quantity<input name="quantity" type="number" min="${edit ? 0 : 1}" max="100000" step="1" required value="${l?.quantity ?? 1}"></label>
        </div>
        <label>Picture (optional)<input name="image" type="file" accept="image/*"></label>
        <img class="sell-preview" src="${l ? listingImg(l) : '/img/kinds/item.svg'}" alt="Preview" width="280" height="160" data-preview>
        ${edit ? html`<label class="check"><input name="closed" type="checkbox"${l.status === 'closed' ? html` checked` : ''}> Hide this offer from the catalog</label>
        <label class="check"><input name="removeImage" type="checkbox"> Remove picture</label>` : ''}
        <button class="btn btn-dark" type="submit">${edit ? 'Save changes' : 'Publish offer'}</button>
        <p class="form-msg" role="status"></p>
      </form>
    </section>`,
  });
}

function deals(ctx, { role, orders }) {
  const tab = (r, label) => html`<a class="chip" href="/deals${r === 'seller' ? '?role=seller' : ''}"${role === r ? html` aria-current="page"` : ''}>${label}</a>`;
  return layout(ctx, {
    title: 'My deals',
    description: 'Your purchases and sales on Kraken Shop.',
    noindex: true,
    main: html`<section class="panel">
      <h1 class="big-title">Deals</h1>
      <nav class="chips" aria-label="Deal type">${tab('buyer', 'Purchases')}${tab('seller', 'Sales')}</nav>
      ${orders.length ? html`<table class="table">
        <thead><tr><th>#</th><th>Item</th><th>${role === 'seller' ? 'Buyer' : 'Seller'}</th><th>Qty</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${orders.map((o) => html`<tr>
          <td>${o.orderId}</td><td><a href="/listings/${o.listingId}">${o.title}</a><br><small>${o.game.name}</small></td>
          <td><a href="/users/${role === 'seller' ? o.buyer.username : o.seller.username}">${role === 'seller' ? o.buyer.username : o.seller.username}</a></td>
          <td>${o.quantity}</td><td>${fmtRub(o.totalPrice)}</td>
          <td><span class="status status-${o.status}">${STATUS[o.status]}</span></td>
          <td>${fmtDate(o.createdAt)}</td>
          <td><a class="btn btn-sm" href="/chat/${o.conversationId}">Open chat</a></td></tr>`)}</tbody>
      </table>` : html`<p class="empty">${role === 'seller' ? 'No sales yet.' : 'No purchases yet.'} <a href="/categories">Browse offers</a></p>`}
    </section>`,
  });
}

function chats(ctx, { conversations }) {
  const me = ctx.user;
  return layout(ctx, {
    title: 'Chats',
    description: 'Your chats with buyers and sellers.',
    noindex: true,
    main: html`<section class="panel">
      <h1 class="big-title">Chat</h1>
      ${conversations.length ? html`<ul class="chat-list">${conversations.map((c) => {
        const other = c.buyer.userId === me.id ? c.seller : c.buyer;
        return html`<li><a href="/chat/${c.conversationId}">
          <b>${c.listing.title}</b> <span>with ${other.username} (${c.buyer.userId === me.id ? 'seller' : 'buyer'})</span>
          ${c.supportRequestedAt ? html`<span class="badge">support</span>` : ''}
          <small>${truncate(c.lastMessage, 80)}</small><time>${fmtDateTime(c.lastMessageAt)}</time></a></li>`;
      })}</ul>` : html`<p class="empty">No chats yet. Press “To chat” on any offer to ask the seller a question.</p>`}
    </section>`,
  });
}

function chat(ctx, { c, orders, listing: l }) {
  const me = ctx.user;
  const isBuyer = c.buyer.userId === me.id;
  const other = isBuyer ? c.seller : c.buyer;
  const orderRow = (o) => {
    const open = ['paid', 'disputed'].includes(o.status);
    return html`<li class="order-row">
      <span>Order #${o.orderId}: ${o.quantity} × ${fmtRub(o.unitPrice)} = <b>${fmtRub(o.totalPrice)}</b></span>
      <span class="status status-${o.status}">${STATUS[o.status]}</span>
      ${isBuyer && open ? html`<button class="btn btn-sm btn-dark" data-order-action="confirm" data-order="${o.orderId}">I received it — confirm</button>` : ''}
      ${isBuyer && o.status === 'paid' ? html`<button class="btn btn-sm" data-order-action="dispute" data-order="${o.orderId}">Open dispute</button>` : ''}
      ${!isBuyer && open ? html`<button class="btn btn-sm" data-order-action="refund" data-order="${o.orderId}">Refund</button>` : ''}
      ${isBuyer && o.status === 'completed' && !o.hasReview ? html`<form class="review-form" data-review="${o.orderId}">
        <label>Rating <select name="rating">${[5, 4, 3, 2, 1].map((n) => html`<option value="${n}">${'★'.repeat(n)}</option>`)}</select></label>
        <input name="text" maxlength="1000" placeholder="Your review" aria-label="Review text">
        <button class="btn btn-sm" type="submit">Leave review</button></form>` : ''}
    </li>`;
  };
  return layout(ctx, {
    title: `Chat: ${c.listing.title}`,
    description: 'Deal chat on Kraken Shop.',
    noindex: true,
    scripts: ['chat', 'listing'],
    main: html`<section class="panel chat" data-conversation="${c.conversationId}" data-me="${me.id}">
      <div class="chat-head">
        <h1 class="big-title">Chat</h1>
        <button class="call-support" type="button" data-support${c.supportRequestedAt ? html` disabled` : ''}>${c.supportRequestedAt ? 'Support called' : 'Call support'}</button>
        <p class="chat-item">Item: <a href="/listings/${c.listing.listingId}">${c.listing.title}</a></p>
      </div>
      <p class="chat-with">${isBuyer ? 'Seller' : 'Buyer'}: <a href="/users/${other.username}">${other.username}</a> · price ${fmtRub(c.listing.price)}</p>
      ${orders.length ? html`<ul class="orders">${orders.map(orderRow)}</ul>` : ''}
      ${isBuyer && l.status === 'active' ? html`<form class="buy-form inline-form" data-buy="${l.listingId}">
        <label>Buy now: quantity <input type="number" name="quantity" min="1" max="${l.quantity}" value="1"></label>
        <button class="btn btn-dark" type="submit">Purchase</button></form>` : ''}
      <p class="form-msg" role="status"></p>
      <div class="messages" data-messages aria-live="polite"></div>
      <form class="chat-input" data-chat-form>
        <input name="text" maxlength="1000" placeholder="Write a message…" aria-label="Message" autocomplete="off">
        <button class="icon-btn" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 20 21 12 3 4v6l12 2-12 2z"/></svg></button>
        <label class="icon-btn" title="Attach a picture"><input name="file" type="file" accept="image/*" hidden><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M16.5 6.5 8 15a2 2 0 0 0 2.8 2.8l8.5-8.5a4 4 0 0 0-5.6-5.6L5 12.4a6 6 0 0 0 8.5 8.5l6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="visually-hidden">Attach a picture</span></label>
      </form>
    </section>`,
  });
}

function news(ctx, { items }) {
  return layout(ctx, {
    title: 'News',
    description: 'Kraken Shop news: new games, sections and site updates.',
    path: '/news',
    main: html`<section class="panel news">
      <h1 class="big-title">News</h1>
      ${items.length ? html`<ul class="news-list">${items.map((n) => html`<li><article>
        <h2>${n.title}</h2>
        <p class="news-meta"><time datetime="${new Date(n.publishedAt).toISOString()}">${fmtDate(n.publishedAt)}</time>${n.author ? ` · ${n.author}` : ''}</p>
        <p>${n.body}</p>
      </article></li>`)}</ul>` : html`<p class="empty">No news yet.</p>`}
    </section>`,
  });
}

const TEXT_PAGES = {
  about: {
    title: 'About us',
    description: 'About Kraken Shop: a marketplace of in-game items with safe escrow deals.',
    body: html`<p>Kraken Shop is a student project of a marketplace where players trade in-game values: items, currency, accounts, boosting, gift cards and app subscriptions.</p>
      <h2>Why Kraken Shop</h2>
      <ul><li>Safe deals: the money is frozen until the buyer confirms delivery.</li><li>Chat with the seller before and after the purchase.</li><li>Public ratings, reviews and the social credit of every user.</li></ul>
      <h2>Technology</h2>
      <p>Node.js + Express, Microsoft SQL Server, Docker and GitHub Actions.</p>`,
  },
  faq: {
    title: 'FAQ',
    description: 'Kraken Shop FAQ: how to buy, how to sell, how escrow, disputes and the special code work.',
    body: html`<div class="faq">
      <details open><summary>How do I buy an item?</summary><p>Top up your balance on the Account page, open an offer and press “Purchase”. The money is frozen until you confirm that you received the item.</p></details>
      <details><summary>How do I sell?</summary><p>Open “Sell an item” in the user menu, choose the game and category, set the price and quantity. Buyers will write to you in the chat.</p></details>
      <details><summary>What if the seller does not deliver?</summary><p>Press “Open dispute” or “Call support” in the deal chat. The seller can also refund the money — then the item goes back on sale.</p></details>
      <details><summary>What is the special code?</summary><p>An optional second secret that you set in the account settings. When it is on, the login form asks for it after the password.</p></details>
      <details><summary>What is social credit?</summary><p>+10 for every completed deal, +20 for every star above 3 in your reviews (−20 below 3) and −100 for every sale that ended with a dispute or refund.</p></details>
      <details><summary>Are payments real?</summary><p>No. This is a training project: top-ups are virtual and no real money is charged.</p></details>
    </div>`,
  },
  contacts: {
    title: 'Contacts',
    description: 'How to contact Kraken Shop support: call a moderator right in the deal chat or write to the support email.',
    body: html`<p>Support works 24/7 inside deal chats: press “Call support” and a moderator will join.</p>
      <p>Email: <a href="mailto:support@example.com">support@example.com</a></p>`,
  },
  privacy: {
    title: 'Privacy policy',
    description: 'Kraken Shop privacy policy: what personal data the marketplace stores, why it is needed and how it is protected.',
    body: html`<p>We store only what the marketplace needs: your nickname, email, optional real name and avatar, offers, deals, chat messages and wallet operations.</p>
      <p>Passwords and special codes are stored as scrypt hashes, never as plain text. The login session is kept in an HttpOnly cookie.</p>
      <p>We do not sell or share your data with third parties.</p>`,
  },
  rules: {
    title: 'Rules',
    description: 'Kraken Shop marketplace rules for buyers and sellers.',
    body: html`<ol class="steps">
      <li>Sell only items you own and can deliver.</li>
      <li>Do not move deals outside Kraken Shop — the escrow protects only deals made here.</li>
      <li>Buyers confirm delivery only after checking the item.</li>
      <li>Insults, scam and cheats are forbidden: accounts are banned.</li>
      <li>Disputes are resolved by support using the deal chat history.</li>
    </ol>`,
  },
};

function textPage(ctx, key) {
  const p = TEXT_PAGES[key];
  return layout(ctx, {
    title: p.title,
    description: p.description,
    path: `/${key}`,
    main: html`<section class="panel text-page"><h1 class="big-title">${p.title}</h1>${p.body}</section>`,
  });
}

function notFound(ctx) {
  return layout(ctx, {
    title: 'Page not found',
    description: 'This page does not exist on Kraken Shop.',
    noindex: true,
    main: html`<section class="panel text-page">
      <h1 class="big-title">404</h1>
      <p class="tagline">Page not found</p>
      <p>The kraken ate this page. Go to the <a href="/">home page</a> or pick a game on the left.</p>
    </section>`,
  });
}

function errorPage(ctx) {
  return layout(ctx, {
    title: 'Error',
    description: 'Something went wrong.',
    noindex: true,
    main: html`<section class="panel text-page">
      <h1 class="big-title">Oops</h1>
      <p class="tagline">Something went wrong on our side</p>
      <p>Please try again in a minute. If the database is not running, start SQL Server (see docs/INSTRUCTIONS.md).</p>
    </section>`,
  });
}

module.exports = {
  catalogUrl, home, catalog, categories, search, listing, authPage, userPage, account, sell, deals, chats, chat, news,
  textPage, notFound, errorPage, TEXT_PAGES,
};
